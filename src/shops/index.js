import * as THREE from 'three';
import { Robot } from '../robots.js';
import { COST } from '../build.js';
import { DEMO_LAYOUT, GOODS, SHOP_TYPES } from './goods.js';
import { BUILDERS, crate } from './models.js';
import { bake, paint, setNight } from './kit.js';
import './shops.css';

// Shops and industry: the player builds shops that make goods from other
// shops' goods. Porter robots carry finished goods to the shops that need
// them; shops selling to residents earn money and leave rubbish that the
// recycling centre turns back into raw materials.
//
// Plugs in as a feature module (see modules.js): `shopsModule` below.
// Other transport (trains, trucks) can move goods with
// game.shops.ship(from, to, good, n); game.shops.shops lists every shop.
// Shops register in world.blockers so rails and stations keep clear.

const SAVE_KEY = 'ttdShops1';
const ISLAND_R = 21.5;
const CAP = 12; // most of one good a shop will hold
const WANT = 4; // a consumer asks for this many cycles' worth of input
const BOOST = 2.5; // how much faster a shop runs with its optional supplies
const CARRY = 4; // crates a porter carries per trip
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const UP = new THREE.Vector3(0, 1, 0);

// Every good a recipe can take, required or optional.
function intake(def) {
  const list = { ...(def.in ?? {}), ...(def.boost ?? {}) };
  for (const [g, sub] of Object.entries(def.subs ?? {})) list[sub] = list[g];
  return list;
}

function outputs(def) {
  const out = { ...(def.out ?? {}) };
  if (def.sell?.trash) out.trash = def.sell.trash;
  return out;
}

// ---------- One shop ----------

class Shop {
  constructor(type, x, z, rot) {
    this.type = type;
    this.def = SHOP_TYPES[type];
    this.x = x;
    this.z = z;
    this.rot = rot;
    this.stock = {};
    this.incoming = {};
    this.progress = 0;
    this.working = false;
    this.starved = 0;
    this.sold = 0;
    this.made = 0;
    for (const [g, n] of Object.entries(this.def.starter ?? {})) this.stock[g] = n;

    const model = BUILDERS[type]();
    this.model = model;
    const root = new THREE.Group();
    root.add(model.group);
    root.position.set(x, 0, z);
    root.rotation.y = rot;
    this.root = root;
    bake(model.group, model.keep);
    this.bounds = localBounds(model.group);
    this.door = root.localToWorld(model.door.clone()).setY(0);
    this.pallet = new THREE.Group();
    if (model.pallet) {
      this.pallet.position.copy(model.pallet);
      model.group.add(this.pallet);
    }
    this.palletCount = -1;
    this.bubble = makeBubble();
    this.bubble.position.set(0, this.bounds.top + 0.55, 0);
    root.add(this.bubble);
    this.box = worldBox(this);
    this.obstacle = { x, z, r: Math.max(this.box.maxX - this.box.minX, this.box.maxZ - this.box.minZ) * 0.5, box: this.box };
  }

  have(g) {
    return this.stock[g] ?? 0;
  }

  // Units of `g` (or its stand-in) on hand.
  avail(g) {
    const sub = this.def.subs?.[g];
    return this.have(g) + (sub ? this.have(sub) : 0);
  }

  take(g, n) {
    const sub = this.def.subs?.[g];
    const own = Math.min(this.have(g), n);
    const tidy = (v) => Math.max(0, Math.round(v * 1000) / 1000);
    this.stock[g] = tidy(this.have(g) - own);
    if (sub && n - own > 0) this.stock[sub] = tidy(this.have(sub) - (n - own));
  }

  needs(g) {
    const recipe = intake(this.def);
    if (!(g in recipe)) return 0;
    const sub = Object.entries(this.def.subs ?? {}).find(([, s]) => s === g)?.[0];
    const key = sub ?? g;
    const want = Math.max(2, Math.ceil(recipe[g] * WANT));
    const have = this.avail(key) + (this.incoming[g] ?? 0) + (sub ? this.incoming[key] ?? 0 : 0) + (!sub && this.def.subs?.[g] ? this.incoming[this.def.subs[g]] ?? 0 : 0);
    return Math.max(0, Math.min(want, CAP) - have);
  }

  missing() {
    return Object.entries(this.def.in ?? {}).filter(([g, n]) => this.avail(g) < n).map(([g]) => g);
  }

  boosted() {
    return Object.entries(this.def.boost ?? {}).every(([g, n]) => this.avail(g) >= n);
  }

  full() {
    return Object.entries(outputs(this.def)).some(([g]) => g !== 'trash' && this.have(g) >= CAP);
  }

  // Advance production; returns money earned this step.
  tick(dt) {
    const missing = this.missing();
    const full = this.full();
    this.working = !missing.length && !full;
    if (!this.working) {
      this.starved += dt;
      this.status = full ? '倉庫滿了，等搬運' : `缺少${missing.map((g) => GOODS[g].label).join('、')}`;
      return 0;
    }
    this.starved = 0;
    const boost = this.def.boost ? (this.boosted() ? 1 : 1 / BOOST) : 1;
    this.status = boost < 1 ? `慢速生產（缺${Object.keys(this.def.boost).filter((g) => this.avail(g) < this.def.boost[g]).map((g) => GOODS[g].label).join('、')}）` : '生產中';
    this.progress += (dt / this.def.cycle) * boost;
    if (this.progress < 1) return 0;
    this.progress -= 1;
    for (const [g, n] of Object.entries(this.def.in ?? {})) this.take(g, n);
    if (boost === 1) for (const [g, n] of Object.entries(this.def.boost ?? {})) this.take(g, n);
    for (const [g, n] of Object.entries(outputs(this.def))) this.stock[g] = Math.min(CAP, this.have(g) + n);
    this.made++;
    if (this.def.sell) {
      this.sold++;
      return this.def.sell.price;
    }
    return 0;
  }

  update(dt, time) {
    this.model.anim(dt, time, this.working);
    // Finished goods wait on the pallet in crates.
    const outs = Object.keys(this.def.out ?? {});
    const total = outs.reduce((s, g) => s + Math.floor(this.have(g)), 0);
    const shown = Math.min(6, total);
    if (shown !== this.palletCount && this.model.pallet) {
      this.palletCount = shown;
      this.pallet.clear();
      const colors = outs.flatMap((g) => Array(Math.floor(this.have(g))).fill(GOODS[g].color));
      for (let i = 0; i < shown; i++) {
        const c = crate(colors[i]);
        c.position.set((i % 3) * 0.17 - 0.17, Math.floor(i / 3) * 0.12, 0);
        c.traverse((o) => o.isMesh && (o.castShadow = true));
        this.pallet.add(c);
      }
    }
    const want = this.starved > 2 ? this.missing()[0] ?? null : null;
    if (want !== this.bubble.userData.good) setBubble(this.bubble, want);
    if (this.bubble.visible) this.bubble.position.y = this.bounds.top + 0.55 + Math.sin(time * 3) * 0.04;
  }
}

function localBounds(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    box.union(tmp);
  });
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, top: box.max.y };
}

// Axis-aligned world footprint (shops turn in quarter turns).
function worldBox({ bounds: b, x, z, rot }) {
  const c = Math.round(Math.cos(rot));
  const s = Math.round(Math.sin(rot));
  const xs = [];
  const zs = [];
  for (const lx of [b.minX, b.maxX]) {
    for (const lz of [b.minZ, b.maxZ]) {
      xs.push(x + lx * c + lz * s);
      zs.push(z - lx * s + lz * c);
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

const inBox = (b, x, z, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const boxesOverlap = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;

// Does segment p→q pass through box b?
function segHits(b, p, q) {
  let t0 = 0;
  let t1 = 1;
  const d = [q.x - p.x, q.z - p.z];
  const o = [p.x, p.z];
  const lo = [b.minX, b.minZ];
  const hi = [b.maxX, b.maxZ];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return false;
      continue;
    }
    let a = (lo[i] - o[i]) / d[i];
    let c = (hi[i] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

// ---------- Status bubble ----------

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.5);
  s.renderOrder = 10;
  s.visible = false;
  s.userData = { canvas, tex, good: null };
  return s;
}

function setBubble(sprite, good) {
  sprite.userData.good = good;
  sprite.visible = !!good;
  if (!good) return;
  const { canvas, tex } = sprite.userData;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, 128, 128);
  c.fillStyle = 'rgba(255,255,255,0.96)';
  c.beginPath();
  c.arc(64, 58, 48, 0, Math.PI * 2);
  c.moveTo(52, 100);
  c.lineTo(64, 122);
  c.lineTo(76, 100);
  c.fill();
  c.strokeStyle = '#f0605a';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(64, 58, 45, 0, Math.PI * 2);
  c.stroke();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '54px "Noto Color Emoji", sans-serif';
  c.fillText(GOODS[good].icon, 64, 62);
  tex.needsUpdate = true;
}

// ---------- Porters ----------

const PORTER_LOOK = (color, i) => ({
  name: `搬運員${i}`,
  shirt: color,
  accent: 0xffffff,
  body: 'overalls',
  hat: 'cap',
  neck: null,
  glasses: null,
  item: null,
});

class Porter {
  constructor(home, i) {
    this.home = home;
    this.robot = new Robot(PORTER_LOOK(home.def.color ?? [0xf2a541, 0x4a90c8, 0x7bc67b, 0xe85d4a][i % 4], i));
    this.robot.mesh.position.copy(home.door);
    this.robot.speed = 1.3;
    this.load = null;
    this.box = crate(0xffffff);
    this.box.position.set(0, 0.2, 0.1);
    this.box.scale.setScalar(0.8);
    this.box.visible = false;
    this.robot.mesh.userData.inner.add(this.box);
  }

  carry(good) {
    this.box.visible = !!good;
    if (!good) return;
    const fill = this.box.children.filter((c) => c.geometry?.type === 'SphereGeometry');
    for (const f of fill) f.material = paint(GOODS[good].color);
  }
}

// ---------- The system ----------

export class ShopSystem {
  constructor(game) {
    const { scene, camera, renderer, passengers, world, builder } = game;
    this.game = game;
    this.scene = scene;
    this.camera = camera;
    this.dom = renderer.domElement;
    this.passengers = passengers;
    this.world = world;
    this.builder = builder;
    this.shops = [];
    this.porters = [];
    this.tool = null;
    this.rot = 0;
    this.selected = null;
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(UP, 0);
    this.ghosts = {};
    this.dispatchT = 0;
    this.earned = 0;
    this.#makeUI();
    this.#bindInput();
    // Rails and platforms must not run through shops.
    world.blockers ??= [];
    this.blocker = {
      label: '店面',
      hit: (x, z, m = 0) => this.shops.some((s) => inBox(s.box, x, z, m)),
    };
    world.blockers.push(this.blocker);
    // Starting over clears the shops too.
    const reset = builder.reset.bind(builder);
    builder.reset = () => {
      this.resetting = true;
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
      reset();
    };
    builder.onChange(() => this.#refreshButton());
    game.look?.onTime?.((night) => setNight(night));
    setInterval(() => this.save(), 5000);
    window.addEventListener('pagehide', () => this.save());
  }

  // ---------- Simulation ----------

  update(dt, time) {
    for (const s of this.shops) {
      const earned = s.tick(dt);
      if (earned) {
        this.game.money.earn(earned);
        this.earned += earned;
        this.#float(`+$${earned}`, s.root.position.clone().setY(s.bounds.top - 0.5), '#2e9a5a');
      }
      s.update(dt, time);
    }
    this.dispatchT -= dt;
    if (this.dispatchT <= 0) {
      this.dispatchT = 0.5;
      this.#dispatch();
    }
    for (const p of this.porters) p.robot.update(dt, time);
    if (this.selected && (this.cardT = (this.cardT ?? 0) - dt) <= 0) {
      this.cardT = 0.25;
      this.#infoCard(this.selected);
    }
  }

  // Hand goods over directly (used by porters; trains and trucks can too).
  ship(from, to, good, n) {
    n = Math.min(n, from.have(good));
    if (n <= 0) return 0;
    from.stock[good] -= n;
    to.stock[good] = Math.min(CAP, to.have(good) + n);
    return n;
  }

  #dispatch() {
    for (const p of this.porters) {
      if (p.busy) continue;
      const src = p.home;
      let best = null;
      for (const g of Object.keys(outputs(src.def))) {
        const have = Math.floor(src.have(g));
        if (have < 1) continue;
        for (const dst of this.shops) {
          if (dst === src) continue;
          const need = dst.needs(g);
          if (need < 1) continue;
          const dist = Math.hypot(dst.door.x - src.door.x, dst.door.z - src.door.z);
          const score = need / (1 + dist * 0.1);
          if (!best || score > best.score) best = { g, dst, n: Math.min(CARRY, have, Math.ceil(need)), score };
        }
      }
      if (best) this.#send(p, best.dst, best.g, best.n);
    }
  }

  #send(p, dst, good, n) {
    const src = p.home;
    src.stock[good] -= n;
    dst.incoming[good] = (dst.incoming[good] ?? 0) + n;
    p.busy = true;
    p.load = { good, n, dst };
    p.carry(good);
    this.#walk(p, src.door, dst.door, [src, dst], () => {
      dst.incoming[good] = Math.max(0, (dst.incoming[good] ?? 0) - n);
      if (this.shops.includes(dst)) dst.stock[good] = Math.min(CAP, dst.have(good) + n);
      p.load = null;
      p.carry(null);
      p.robot.wait(0.6, () => {
        if (!this.shops.includes(src)) return this.#retire(p);
        this.#walk(p, p.robot.mesh.position.clone(), src.door, [src, dst], () => {
          p.busy = false;
          p.robot.mesh.rotation.y = src.rot;
        });
      });
    });
  }

  #walk(p, from, to, ignore, done) {
    const pts = this.#route(from, to, ignore, 0);
    p.robot.walkTo(pts.map((v) => v.clone().setY(0)), done);
  }

  // A path from a to b that walks around other shops.
  #route(a, b, ignore, depth) {
    if (depth > 3) return [b];
    const blocker = this.shops.find((s) => !ignore.includes(s) && segHits(grow(s.box, 0.15), a, b));
    if (!blocker) return [b];
    const e = grow(blocker.box, 0.35);
    const corners = [
      new THREE.Vector3(e.minX, 0, e.minZ),
      new THREE.Vector3(e.maxX, 0, e.minZ),
      new THREE.Vector3(e.maxX, 0, e.maxZ),
      new THREE.Vector3(e.minX, 0, e.maxZ),
    ];
    const inner = grow(blocker.box, 0.2);
    const clear = (pts) => pts.every((q, i) => i === 0 || !segHits(inner, pts[i - 1], q));
    let best = null;
    const tryPath = (via) => {
      const pts = [a, ...via, b];
      if (!clear(pts)) return;
      const len = pts.reduce((s, q, i) => (i ? s + q.distanceTo(pts[i - 1]) : 0), 0);
      if (!best || len < best.len) best = { via, len };
    };
    for (let i = 0; i < 4; i++) {
      tryPath([corners[i]]);
      tryPath([corners[i], corners[(i + 1) % 4]]);
      tryPath([corners[(i + 1) % 4], corners[i]]);
    }
    if (!best) return [b];
    const out = [];
    let from = a;
    for (const v of [...best.via, b]) {
      out.push(...this.#route(from, v, [...ignore, blocker], depth + 1));
      from = v;
    }
    return out;
  }

  #retire(p) {
    this.scene.remove(p.robot.mesh);
    this.porters.splice(this.porters.indexOf(p), 1);
  }

  // ---------- Building ----------

  // Footprint check for a shop of `type` at x, z, rot.
  plan(type, x, z, rot) {
    const ghost = this.#ghost(type);
    const box = worldBox({ bounds: ghost.bounds, x, z, rot });
    const problems = [];
    const corners = [
      [box.minX, box.minZ],
      [box.maxX, box.minZ],
      [box.minX, box.maxZ],
      [box.maxX, box.maxZ],
    ];
    if (corners.some(([cx, cz]) => cx * cx + cz * cz > ISLAND_R * ISLAND_R)) problems.push('超出島的範圍');
    if (this.shops.some((s) => boxesOverlap(s.box, box, 0.25))) problems.push('離其他店面太近');
    if (this.game.network.allSamples().some((p) => inBox(box, p.x, p.z, 0.75))) problems.push('會壓到鐵路');
    const stations = this.passengers.stations;
    const grid = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) grid.push([box.minX + ((box.maxX - box.minX) * i) / 4, box.minZ + ((box.maxZ - box.minZ) * j) / 4]);
    if (stations.some((s) => grid.some(([gx, gz]) => s.contains(gx, gz, 0.3)))) problems.push('會壓到車站');
    // Roads, bus stops, the airport... anything other modules registered.
    const fine = [];
    const nx = Math.ceil((box.maxX - box.minX) / 0.3);
    const nz = Math.ceil((box.maxZ - box.minZ) / 0.3);
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) fine.push([box.minX + ((box.maxX - box.minX) * i) / nx, box.minZ + ((box.maxZ - box.minZ) * j) / nz]);
    const other = (this.world.blockers ?? []).find((b) => b !== this.blocker && fine.some(([fx, fz]) => b.hit(fx, fz, 0.15)));
    if (other) problems.push(`會壓到${other.label}`);
    const props = this.world.scenery.query((px, pz, r) => inBox(box, px, pz, r * 0.6 + 0.1));
    const cost = SHOP_TYPES[type].cost + props.reduce((sum, p) => sum + (COST[p.kind] ?? 0), 0);
    if (!problems.length && cost > this.game.money.get()) problems.push('資金不足');
    return { type, x, z, rot, box, props, cost, problems, ok: !problems.length };
  }

  build(plan, pay = true) {
    if (pay) {
      this.game.money.spend(plan.cost);
      this.#float(`-${money(plan.cost)}`, new THREE.Vector3(plan.x, 0.8, plan.z));
    }
    this.world.scenery.remove(plan.props);
    const shop = new Shop(plan.type, plan.x, plan.z, plan.rot);
    this.scene.add(shop.root);
    this.shops.push(shop);
    this.world.obstacles.push(shop.obstacle);
    // Pendant lamps light up at night (lighting module, when present).
    const look = this.game.look;
    shop.lamps = [];
    if (look?.addLamp) {
      for (const at of (shop.model.group.userData.lamps ?? []).slice(0, 2)) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(at);
        shop.model.group.add(anchor);
        shop.lamps.push(look.addLamp(anchor, { color: 0xffc98a, intensity: 1.6, distance: 2.4 }));
      }
    }
    shop.porters = [];
    const crew = Object.keys(outputs(shop.def)).length ? shop.def.porters ?? 1 : 0;
    for (let i = 0; i < crew; i++) {
      const p = new Porter(shop, this.porters.length);
      p.robot.mesh.position.x += (i - (crew - 1) / 2) * 0.3;
      this.scene.add(p.robot.mesh);
      this.porters.push(p);
      shop.porters.push(p);
    }
    if (!this.loading) this.save();
    return shop;
  }

  demolish(shop) {
    const i = this.shops.indexOf(shop);
    if (i < 0) return;
    this.shops.splice(i, 1);
    this.scene.remove(shop.root);
    const oi = this.world.obstacles.indexOf(shop.obstacle);
    if (oi >= 0) this.world.obstacles.splice(oi, 1);
    const refund = Math.round(shop.def.cost / 2);
    this.game.money.earn(refund);
    this.#float(`+${money(refund)}`, shop.root.position.clone().setY(0.6), '#4a90c8');
    // Its porter finishes any delivery, then leaves.
    for (const p of shop.porters) if (!p.busy) this.#retire(p);
    for (const off of shop.lamps) off();
    if (this.selected === shop) this.#select(null);
    this.save();
  }

  // Lay out the demo industry where it fits.
  quickStart() {
    let built = 0;
    let spent = 0;
    const skipped = [];
    for (const [type, x, z, rot] of DEMO_LAYOUT) {
      if (this.shops.some((s) => s.type === type)) continue;
      const plan = this.plan(type, x, z, rot);
      if (!plan.ok) {
        skipped.push(`${SHOP_TYPES[type].label}（${plan.problems[0]}）`);
        continue;
      }
      this.build(plan);
      spent += plan.cost;
      built++;
    }
    this.#card(
      '範例產業',
      `蓋好了 ${built} 間店，共花費 ${money(spent)}。搬運員會把貨送到需要的店，咖啡廳、雜貨店、家具行賣東西就會賺錢。` +
        (skipped.length ? `<br><span class="bad">沒蓋：${skipped.join('、')}</span>` : ''),
      [{ label: '好', primary: true, run: () => this.setTool(null) }],
    );
  }

  // ---------- Ghost preview ----------

  #ghost(type) {
    if (this.ghosts[type]) return this.ghosts[type];
    const model = BUILDERS[type]();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4cc47a, transparent: true, opacity: 0.5, depthWrite: false, emissive: 0x1d5a35 });
    model.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.material = mat;
        o.castShadow = o.receiveShadow = false;
      }
      if (o.isBatchedPart) o.visible = false; // robots stay out of the preview
    });
    const root = new THREE.Group();
    root.add(model.group);
    root.visible = false;
    this.scene.add(root);
    const ghost = { root, mat, bounds: localBounds(model.group) };
    this.ghosts[type] = ghost;
    return ghost;
  }

  #hideGhosts() {
    for (const g of Object.values(this.ghosts)) g.root.visible = false;
  }

  // ---------- Tool ----------

  setTool(type) {
    this.#hideGhosts();
    this.tool = type;
    this.button.classList.toggle('on', type !== null);
    if (type === null) return this.#card(null);
    if (this.builder.tool) this.builder.setTool(null);
    this.#select(null);
    if (type === 'palette') return this.#palette();
    this.#previewBuild();
  }

  #palette() {
    const rows = Object.entries(SHOP_TYPES).map(([key, d]) => {
      const ins = Object.keys({ ...d.in, ...d.boost }).map((g) => GOODS[g].icon).join('');
      const outs = d.sell ? '💰' : Object.keys(d.out).map((g) => GOODS[g].icon).join('');
      return `<button class="shop-pick" data-type="${key}"><i>${d.icon}</i><b>${d.label}</b><small>${ins || '—'} → ${outs}</small><em>${money(d.cost)}</em></button>`;
    });
    this.#card(
      '蓋店面',
      `<div class="shop-grid">${rows.join('')}</div><div class="shop-note">堆肥 → 農場 → 麵包坊 → 咖啡廳／雜貨店 → 垃圾 → 回收站 → 堆肥，一圈循環。</div>`,
      [
        { label: '✨ 範例產業', run: () => this.quickStart() },
        { label: '關閉', run: () => this.setTool(null) },
      ],
    );
    for (const b of this.ui.info.querySelectorAll('.shop-pick')) b.addEventListener('click', () => this.setTool(b.dataset.type));
  }

  #previewBuild() {
    const type = this.tool;
    const d = SHOP_TYPES[type];
    const ghost = this.#ghost(type);
    const p = this.pointer;
    this.#hideGhosts();
    const actions = [
      { label: '↻ 旋轉', run: () => this.#rotate() },
      { label: '換一種', run: () => this.setTool('palette') },
      { label: '完成', run: () => this.setTool(null) },
    ];
    const recipe = `${Object.entries(d.in ?? {}).map(([g, n]) => `${GOODS[g].icon}${GOODS[g].label}×${n}`).join(' ＋ ') || '不需原料'}` +
      `${d.boost ? `（有 ${Object.keys(d.boost).map((g) => GOODS[g].label).join('、')} 會更快）` : ''} → ` +
      (d.sell ? `賣給居民 ${money(d.sell.price)}` : Object.entries(d.out).map(([g, n]) => `${GOODS[g].icon}${GOODS[g].label}×${n}`).join(' ＋ '));
    if (!p) return this.#card(`${d.icon} ${d.label}`, `${d.desc}<br>${recipe}<br>把滑鼠移到島上，點一下蓋在那裡。按 R 旋轉。`, actions);
    const x = Math.round(p.x * 4) / 4;
    const z = Math.round(p.z * 4) / 4;
    const plan = this.plan(type, x, z, this.rot);
    this.plan_ = plan;
    ghost.root.position.set(x, 0.01, z);
    ghost.root.rotation.y = this.rot;
    ghost.root.visible = true;
    ghost.mat.color.set(plan.ok ? 0x4cc47a : 0xf0605a);
    ghost.mat.emissive.set(plan.ok ? 0x1d5a35 : 0x6a1d1a);
    const clear = plan.props.length ? `・需清除 ${plan.props.length} 樣東西` : '';
    this.#card(
      `${d.icon} ${d.label}`,
      `${recipe}<br>費用 <b>${money(plan.cost)}</b>${clear}<br>` + (plan.ok ? '點一下蓋在這裡，按 R 旋轉。' : `<span class="bad">${plan.problems.join('、')}</span>`),
      actions,
    );
  }

  #rotate() {
    this.rot = (this.rot + Math.PI / 2) % (Math.PI * 2);
    if (this.tool && this.tool !== 'palette') this.#previewBuild();
  }

  // ---------- Selecting a shop ----------

  #select(shop) {
    if (this.selected) this.selected.root.remove(this.ring);
    this.selected = shop;
    if (!shop) return this.tool ? null : this.#card(null);
    this.ring ??= new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    const b = shop.bounds;
    this.ring.position.set((b.minX + b.maxX) / 2, 0.06, (b.minZ + b.maxZ) / 2);
    this.ring.scale.setScalar(Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 0.1);
    shop.root.add(this.ring);
    this.#infoCard(shop);
  }

  #infoCard(shop) {
    const d = shop.def;
    const goodRow = (g, label) => {
      const have = shop.have(g);
      const inc = shop.incoming[g] ?? 0;
      return `<span class="good">${GOODS[g].icon} ${GOODS[g].label} <b>${Math.floor(have)}</b>${inc ? `<small>+${inc} 送貨中</small>` : ''}${label ? `<small>${label}</small>` : ''}</span>`;
    };
    const ins = Object.keys(d.in ?? {}).map((g) => goodRow(g)).concat(Object.keys(d.boost ?? {}).map((g) => goodRow(g, '加速')));
    for (const sub of Object.values(d.subs ?? {})) ins.push(goodRow(sub, '可代替'));
    const outs = Object.keys(outputs(d)).map((g) => goodRow(g));
    const pct = Math.round(shop.progress * 100);
    const html =
      `<div class="shop-status ${shop.working ? 'ok' : 'bad'}">${shop.status ?? ''}</div>` +
      `<div class="bar"><i style="width:${pct}%"></i></div>` +
      `<div class="goods"><div><small>原料</small>${ins.join('') || '<span class="good">不需原料</span>'}</div>` +
      `<div><small>${d.sell ? '販售' : '產出'}</small>${d.sell ? `<span class="good">💰 每份 ${money(d.sell.price)}・已賣 <b>${shop.sold}</b></span>` : ''}${outs.join('')}</div></div>` +
      `<div class="shop-note">員工：${shop.model.workers.map((w) => w.name).join('、')}${shop.porters.length ? `・搬運員 ${shop.porters.length} 位` : ''}</div>`;
    this.#card(`${d.icon} ${d.label}`, html, [
      { label: `拆除（退 ${money(d.cost / 2)}）`, run: () => this.demolish(shop) },
      { label: '關閉', primary: true, run: () => this.#select(null) },
    ]);
  }

  // ---------- Input ----------

  #groundAt(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  // The shop under the pointer: the first shop hit by the ray, or whose footprint holds the ground point.
  #shopAt(e) {
    const g = this.#groundAt(e);
    const roots = this.shops.map((s) => s.root);
    this.raycaster.far = 200;
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    if (hit) return this.shops.find((s) => hit.object.parent && s.root.getObjectById(hit.object.id));
    return g ? this.shops.find((s) => inBox(s.box, g.x, g.z)) : null;
  }

  #bindInput() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.tool || this.tool === 'palette') return;
      this.pointer = this.#groundAt(e);
      this.#previewBuild();
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (this.tool && this.tool !== 'palette') {
        this.pointer = this.#groundAt(e);
        this.#previewBuild();
        if (this.plan_?.ok) {
          this.build(this.plan_);
          this.#previewBuild();
        }
        return;
      }
      if (this.tool || this.builder.tool) return;
      const shop = this.#shopAt(e);
      if (shop || this.selected) this.#select(shop ?? null);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.tool && !this.selected) return;
      if (e.key === 'Escape') {
        this.setTool(null);
        this.#select(null);
      }
      if (e.key === 'r' || e.key === 'R') this.#rotate();
    });
  }

  // ---------- UI ----------

  #makeUI() {
    const tools = document.getElementById('tools');
    let wasOn = false;
    const button = this.game.tools.addTool({ id: 'shops', icon: '🏪', label: '店面', onSelect: () => this.setTool(wasOn ? null : 'palette') });
    button.addEventListener('pointerdown', () => (wasOn = !!this.tool), true);
    this.button = button;
    // The rail tools close the shop tool.
    for (const b of tools.querySelectorAll('[data-tool], #quick')) {
      b.addEventListener('click', () => {
        if (this.tool) this.setTool(null);
        if (this.selected) this.#select(null);
      });
    }
    const card = document.createElement('div');
    card.id = 'shopCard';
    card.hidden = true;
    card.innerHTML = '<div class="sc-title"></div><div class="sc-info"></div><div class="sc-actions"></div>';
    document.getElementById('build').insertBefore(card, tools);
    this.ui = { card, title: card.querySelector('.sc-title'), info: card.querySelector('.sc-info'), actions: card.querySelector('.sc-actions') };
  }

  #refreshButton() {
    if (this.builder.tool && this.tool) this.setTool(null);
  }

  #card(title, html, actions = []) {
    const { card, title: t, info, actions: a } = this.ui;
    card.hidden = !title;
    if (!title) return;
    if (this.builder.tool === null) document.getElementById('buildCard').hidden = true;
    t.textContent = title;
    if (info.innerHTML !== html) info.innerHTML = html;
    const key = actions.map((x) => x.label).join('|');
    if (a.dataset.key === key && this.selectedCardFor === this.selected) {
      [...a.children].forEach((b, i) => (b.onclick = actions[i].run));
      return;
    }
    a.dataset.key = key;
    this.selectedCardFor = this.selected;
    a.replaceChildren(
      ...actions.map((x) => {
        const b = document.createElement('button');
        b.textContent = x.label;
        if (x.primary) b.classList.add('primary');
        b.onclick = x.run;
        return b;
      }),
    );
  }

  #float(text, at, color) {
    this.game.money.float(text, at, color);
  }

  // ---------- Save / load ----------

  save() {
    if (this.loading || this.resetting) return;
    const data = this.shops.map((s) => ({ type: s.type, x: s.x, z: s.z, rot: s.rot, stock: s.stock, progress: s.progress, sold: s.sold }));
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
  }

  load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch {}
    if (!Array.isArray(data)) return false;
    this.loading = true;
    for (const d of data) {
      if (!SHOP_TYPES[d.type]) continue;
      const plan = this.plan(d.type, d.x, d.z, d.rot);
      const shop = this.build(plan, false);
      shop.stock = { ...d.stock };
      shop.progress = d.progress ?? 0;
      shop.sold = d.sold ?? 0;
    }
    this.loading = false;
    return true;
  }
}

const grow = (b, m) => ({ minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });

// The feature module main.js runs (registered in modules.js).
export const shopsModule = {
  name: 'shops',
  init(game) {
    this.system = new ShopSystem(game);
    game.shops = this.system;
    this.system.load();
  },
  update(dt, time) {
    this.system.update(dt, time);
  },
};
