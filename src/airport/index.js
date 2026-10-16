import * as THREE from 'three';
import { COST } from '../build.js';
import { Robot, randomLook } from '../robots.js';
import { Airport, FOOT, STANDS, TERM_Z, tug as makeTug } from './airport.js';
import { Flight } from './flights.js';
import { BASE_TYPES, FAMILIES, describe } from './planes.js';

// Airport feature module: a build tool to place the airport (on the island
// or out on the water), a fleet card to buy, sell and follow planes, and a
// designer for new aircraft types.

const SAVE_KEY = 'ttdAirport1';
const AIRPORT_COST = 2500;
const MAX_REACH = 44; // airport centre from the island centre
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;
const KIND_LABEL = { tree: '棵樹', house: '間房子', rock: '顆石頭' };

const CSS = `
#bcInfo .air-list { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; }
#bcInfo .air-row { display: flex; align-items: center; gap: 6px; }
#bcInfo .air-row .sw { width: 12px; height: 12px; border-radius: 4px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
#bcInfo .air-row .nm { flex: 1; color: #2c3440; }
#bcInfo .air-row .st { font-size: 12px; font-weight: 600; }
#bcInfo .air-row button { padding: 3px 8px; font-size: 12px; }
#bcInfo .air-sub { font-weight: 700; color: #2c3440; margin-top: 6px; }
#bcInfo .air-form { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; margin: 4px 0; }
#bcInfo .air-form input[type=text], #bcInfo .air-form select { font: inherit; padding: 3px 6px; border-radius: 8px; border: 1px solid #d5dbe2; }
#bcInfo .air-form input[type=color] { width: 34px; height: 24px; border: none; padding: 0; background: none; }
#bcInfo .air-colors { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
`;

// ---------- Robots that fly ----------

class Crowd {
  constructor() {
    this.free = [];
    this.active = new Set();
    this.made = 0;
  }

  get() {
    const r = this.free.pop() ?? new Robot(randomLook(200 + this.made++));
    r.scale = 0.92;
    r.leaving = false;
    r.seat = null;
    r.stand();
    r.setDestination(null);
    this.active.add(r);
    return r;
  }

  put(r) {
    r.mesh.parent?.remove(r.mesh);
    r.path = [];
    r.onArrive = null;
    this.active.delete(r);
    this.free.push(r);
  }

  update(dt, time) {
    for (const r of this.active) r.update(dt, time);
  }
}

// The pushback tug: drives to a plane's nose, pushes it back, drives home.
class Tug {
  constructor(airport) {
    this.airport = airport;
    this.mesh = makeTug();
    this.home = { pos: V(-8.4, TERM_Z - 0.9), rot: Math.PI / 2 };
    this.mesh.position.copy(this.home.pos);
    this.mesh.rotation.y = this.home.rot;
    airport.ground.add(this.mesh);
    this.state = 'home';
    this.t = 0;
  }

  get ready() {
    return this.state === 'attached';
  }

  #noseTarget(f) {
    const p = f.plane;
    const nose = p.body.localToWorld(V(0, p.L.zc1 + p.L.nose.len + 0.42, 0));
    const pos = this.airport.ground.worldToLocal(nose).setY(0.03);
    return { pos, rot: f.yaw - this.airport.rot + Math.PI };
  }

  attach(f) {
    this.flight = f;
    this.from = { pos: this.mesh.position.clone(), rot: this.mesh.rotation.y };
    this.state = 'going';
    this.t = 0;
  }

  follow(f) {
    const tg = this.#noseTarget(f);
    this.mesh.position.copy(tg.pos);
    this.mesh.rotation.y = tg.rot;
  }

  release() {
    this.from = { pos: this.mesh.position.clone(), rot: this.mesh.rotation.y };
    this.state = 'returning';
    this.t = 0;
    this.flight = null;
  }

  update(dt) {
    if (this.state !== 'going' && this.state !== 'returning') return;
    this.t = Math.min(1, this.t + dt / 3);
    const k = THREE.MathUtils.smoothstep(this.t, 0, 1);
    const to = this.state === 'going' ? this.#noseTarget(this.flight) : this.home;
    // Swing wide so it doesn't drive through the wings.
    const mid = V((this.from.pos.x + to.pos.x) / 2, Math.min(this.from.pos.z, to.pos.z) - 0.6);
    const a = this.from.pos.clone().lerp(mid, k);
    const b = mid.clone().lerp(to.pos, k);
    const prev = this.mesh.position.clone();
    this.mesh.position.copy(a.lerp(b, k));
    const d = this.mesh.position.clone().sub(prev);
    if (d.lengthSq() > 1e-6 && this.t < 0.9) this.mesh.rotation.y = Math.atan2(d.x, d.z);
    else this.mesh.rotation.y += (to.rot - this.mesh.rotation.y) * Math.min(1, dt * 4);
    if (this.t >= 1) {
      this.mesh.rotation.y = to.rot;
      this.state = this.state === 'going' ? 'attached' : 'home';
    }
  }
}

// ---------- The module ----------

class AirportSystem {
  init(game) {
    this.game = game;
    this.scene = game.scene;
    this.airport = null;
    this.flights = [];
    this.custom = [];
    this.crowd = new Crowd();
    this.groundBy = null;
    this.tool = false;
    this.rot = 0;
    this.boardTimer = 0;
    this.follow = null;
    this.raycaster = new THREE.Raycaster();
    this.plane0 = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.obstacles = [];

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.button = game.tools.addTool({ id: 'airport', icon: '✈️', label: '機場', onSelect: () => this.#select() });
    this.ui = {
      card: document.getElementById('buildCard'),
      title: document.getElementById('bcTitle'),
      info: document.getElementById('bcInfo'),
      actions: document.getElementById('bcActions'),
    };
    // Any other build tool ends ours.
    document.getElementById('tools').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b !== this.button) this.#end();
    });
    this.#bindInput();
    game.world.blockers ??= [];
    game.world.blockers.push({ label: '機場', hit: (x, z, m) => !!this.airport?.contains(x, z, m) });
    this.#load();
    // Starting over clears the airport too.
    const reset = game.builder.reset.bind(game.builder);
    game.builder.reset = () => {
      this.resetting = true;
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
      reset();
    };
    setInterval(() => this.save(), 5000);
    window.addEventListener('pagehide', () => this.save());
    window.__airport = this;
  }

  // ---------- Simulation ----------

  update(dt, time) {
    if (!this.airport) return;
    this.airport.update(dt, time);
    this.tug.update(dt);
    for (const f of this.flights) f.update(dt, time);
    this.crowd.update(dt, time);
    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      this.airport.drawBoard(
        this.flights.map((f) => ({ code: f.code, name: f.type.name, status: f.status[0], color: f.status[1] })),
      );
      if (this.cardMode === 'fleet' && !this.ui.card.hidden) this.#refreshFleetStatus();
    }
  }

  frame(dt) {
    const f = this.follow;
    if (!f || !this.flights.includes(f)) return (this.follow = null);
    const { controls, camera } = this.game;
    const before = controls.target.clone();
    controls.target.lerp(f.plane.group.position, Math.min(1, dt * 3));
    camera.position.add(controls.target.clone().sub(before));
  }

  claimGround(f) {
    if (this.groundBy && this.groundBy !== f) return false;
    this.groundBy = f;
    return true;
  }

  releaseGround(f) {
    if (this.groundBy === f) this.groundBy = null;
  }

  landed(f) {
    const n = f.pax.length;
    if (!n) return;
    const fare = n * f.type.fare;
    this.game.money.earn(fare);
    this.game.passengers.delivered += n;
    this.game.money.float(`+${money(fare)}`, f.plane.group.position.clone().add(V(0, 0, 1.2)), '#2e9e5b');
  }

  // A passenger walks from the terminal, up the stairs and to a seat.
  sendPassenger(f) {
    const r = this.crowd.get();
    const g = this.airport.ground;
    const gx = STANDS[f.stand] + 1.5;
    const start = V(gx + (Math.random() - 0.5) * 1.4, TERM_Z + 3.3, 0.08);
    r.mesh.position.copy(start);
    g.add(r.mesh);
    f.queue.push(r);
    const { foot, top } = f.stairPoints();
    r.walkTo([V(gx + (Math.random() - 0.5) * 0.3, TERM_Z + 0.5, 0.08), V(gx, TERM_Z - 0.35, 0.03), foot, top], () => this.#enterPlane(f, r));
  }

  #enterPlane(f, r) {
    const p = f.plane;
    const seat = f.freeSeat();
    if (!seat) return this.#walkHome(f, r);
    seat.robot = r;
    r.seat = seat;
    p.body.attach(r.mesh);
    r.mesh.position.copy(p.doorOutside).setY(p.floorY);
    const inside = p.doorInside;
    const pts = [inside];
    if (f.type.family !== 'lark') pts.push(V(0, inside.z, p.floorY), V(0, seat.pos.z + 0.12, p.floorY));
    pts.push(V(seat.pos.x * 0.6, seat.pos.z + 0.12, p.floorY));
    r.walkTo(pts, () => {
      r.sit(seat);
      f.queue.splice(f.queue.indexOf(r), 1);
      f.pax.push(r);
    });
  }

  deboard(f, r) {
    const p = f.plane;
    r.leaving = true;
    const seat = r.seat;
    r.stand();
    const inside = p.doorInside;
    const pts = [V(seat.pos.x * 0.6, seat.pos.z + 0.12, p.floorY)];
    if (f.type.family !== 'lark') pts.push(V(0, seat.pos.z + 0.12, p.floorY), V(0, inside.z, p.floorY));
    pts.push(inside, p.doorOutside);
    r.walkTo(pts, () => {
      seat.robot = null;
      r.seat = null;
      f.pax.splice(f.pax.indexOf(r), 1);
      this.airport.ground.attach(r.mesh);
      this.#walkHome(f, r);
    });
  }

  #walkHome(f, r) {
    const { foot, top } = f.stairPoints();
    const gx = STANDS[f.stand] + 1.5;
    const pts = r.mesh.position.distanceTo(top) > 0.2 ? [] : [top];
    pts.push(foot, V(gx + 0.2, TERM_Z - 0.35, 0.03), V(gx + 0.2, TERM_Z + 0.6, 0.08), V(gx + (Math.random() - 0.5) * 1.6, TERM_Z + 3.3, 0.08));
    const qi = f.queue.indexOf(r);
    if (qi >= 0) f.queue.splice(qi, 1);
    r.walkTo(pts, () => this.crowd.put(r));
  }

  // ---------- Building ----------

  #footCorners(x, z, rot, margin = 0) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const out = [];
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const lx = THREE.MathUtils.lerp(FOOT.x0 - margin, FOOT.x1 + margin, i / 8);
        const lz = THREE.MathUtils.lerp(FOOT.z0 - margin, FOOT.z1 + margin, j / 8);
        out.push(V(x + lx * c + lz * s, z - lx * s + lz * c));
      }
    }
    return out;
  }

  #inFoot(x, z, cx, cz, rot, margin) {
    const dx = x - cx;
    const dz = z - cz;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return lx > FOOT.x0 - margin && lx < FOOT.x1 + margin && lz > FOOT.z0 - margin && lz < FOOT.z1 + margin;
  }

  #plan(x, z, rot) {
    const problems = [];
    if (Math.hypot(x, z) > MAX_REACH) problems.push('離島太遠了');
    const rails = this.game.network.allSamples();
    if (rails.some((p) => this.#inFoot(p.x, p.z, x, z, rot, 0.6))) problems.push('會壓到鐵路');
    const stations = this.game.passengers.stations;
    if (stations.some((s) => this.#footCorners(x, z, rot, -0.5).some((p) => s.contains(p.x, p.z, 0.4)))) problems.push('會壓到車站');
    const props = this.game.world.scenery.query((px, pz, r) => this.#inFoot(px, pz, x, z, rot, r * 0.6 + 0.3));
    const cost = AIRPORT_COST + props.reduce((sum, p) => sum + (COST[p.kind] ?? 0), 0);
    if (!problems.length && cost > this.game.money.get()) problems.push('資金不足');
    return { x, z, rot, props, cost, problems, ok: !problems.length };
  }

  #build(plan, pay) {
    if (pay) {
      if (!this.game.money.spend(plan.cost)) return;
      this.game.money.float(`-${money(plan.cost)}`, V(plan.x, plan.z, 2), '#e0533f');
    }
    this.game.world.scenery.remove(plan.props);
    this.airport = new Airport(plan);
    this.scene.add(this.airport.group);
    this.#useLamps(this.airport.board.lamps, { color: 0xffd29a, intensity: 2.2, distance: 7, always: true }, this.airport);
    this.game.look?.onTime?.((night) => this.airport?.setNight(night));
    this.tug = new Tug(this.airport);
    this.groundBy = null;
    // Residents keep off the airfield.
    for (const p of this.#footCorners(plan.x, plan.z, plan.rot, -1.5)) {
      if (Math.hypot(p.x, p.z) < 23) {
        const o = { x: p.x, z: p.z, r: 1.8, kind: 'airport' };
        this.obstacles.push(o);
        this.game.world.obstacles.push(o);
      }
    }
  }

  #demolish() {
    if (!this.airport) return;
    let refund = AIRPORT_COST / 2;
    for (const f of [...this.flights]) refund += this.#sell(f, true);
    for (const r of [...this.crowd.active]) this.crowd.put(r);
    this.scene.remove(this.airport.group);
    for (const off of this.airport.unlamp ?? []) off();
    this.airport.dispose();
    this.airport = null;
    const obs = this.game.world.obstacles;
    for (const o of this.obstacles) {
      const i = obs.indexOf(o);
      if (i >= 0) obs.splice(i, 1);
    }
    this.obstacles = [];
    this.game.money.earn(refund);
    this.save();
    this.#card('機場', `機場已拆除，退回 ${money(refund)}。`, [{ label: '好', run: () => this.#card(null) }]);
  }

  // With the shared renderer (game.look), lamps go through its light pool
  // instead of each being a real light.
  #useLamps(lights, opts, owner) {
    const look = this.game.look;
    if (!look?.addLamp) return;
    owner.unlamp = [];
    for (const l of lights) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(l.position);
      l.parent.add(anchor);
      l.parent.remove(l);
      owner.unlamp.push(look.addLamp(anchor, opts));
    }
  }

  // ---------- Fleet ----------

  get types() {
    return [...BASE_TYPES, ...this.custom].map(describe);
  }

  #freeStand() {
    return STANDS.findIndex((_, i) => !this.flights.some((f) => f.stand === i));
  }

  #buy(type, pay = true) {
    const stand = this.#freeStand();
    if (stand < 0) return false;
    const t = describe(type);
    if (pay && !this.game.money.spend(t.price)) return false;
    const used = new Set(this.flights.map((f) => f.index));
    let index = 0;
    while (used.has(index)) index++;
    const f = new Flight(this, type, stand, index);
    this.flights.push(f);
    this.#useLamps([f.plane.cabinLight], { color: 0xffd7a0, intensity: 1.2, distance: 3, always: true }, f);
    if (pay) this.game.money.float(`-${money(t.price)}`, f.plane.group.position.clone().add(V(0, 0, 1.5)), '#e0533f');
    this.save();
    return true;
  }

  // Planes can only be sold while parked with nobody aboard.
  #sell(f, force = false) {
    if (!force && (!f.atStand || f.pax.length || f.queue.length)) return 0;
    for (const r of [...f.pax, ...f.queue]) this.crowd.put(r);
    this.releaseGround(f);
    if (this.tug?.flight === f) this.tug.release();
    for (const off of f.unlamp ?? []) off();
    f.dispose();
    this.flights.splice(this.flights.indexOf(f), 1);
    if (this.follow === f) this.follow = null;
    const back = Math.round(f.type.price / 2);
    if (!force) {
      this.game.money.earn(back);
      this.save();
    }
    return back;
  }

  // ---------- Input & tool ----------

  #bindInput() {
    const dom = this.game.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY, button: e.button }));
    dom.addEventListener('pointermove', (e) => {
      if (this.tool) this.#hover(e);
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!this.tool || !d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      this.#hover(e);
      if (this.plan?.ok) {
        this.#build(this.plan, true);
        this.#end();
        this.save();
        this.#fleetCard('機場蓋好了！先買一架飛機開航吧。');
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.tool) return;
      if (e.key === 'Escape') this.#end();
      if (e.key === 'r' || e.key === 'R') this.#rotate(e.shiftKey ? -1 : 1);
    });
  }

  #rotate(dir) {
    this.rot += (dir * Math.PI) / 12;
    if (this.pointer) this.#preview();
  }

  #select() {
    if (this.airport) return this.#fleetCard();
    if (this.tool) return this.#end();
    this.tool = true;
    this.button.classList.add('on');
    if (!this.ghost) this.#makeGhost();
    this.#card('蓋機場', `移動滑鼠選位置，可以蓋在島上或海上（會填海造陸）。按 R 旋轉跑道方向。<br>費用 <b>${money(AIRPORT_COST)}</b> 起。`, [
      { label: '旋轉', run: () => this.#rotate(1) },
      { label: '取消', run: () => this.#end() },
    ]);
  }

  #end() {
    if (!this.tool) return;
    this.tool = false;
    this.button.classList.remove('on');
    if (this.ghost) this.ghost.visible = false;
    if (this.cardMode === 'place') this.#card(null);
  }

  #makeGhost() {
    const g = new THREE.Group();
    const w = FOOT.x1 - FOOT.x0;
    const d = FOOT.z1 - FOOT.z0;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x4cc47a, transparent: true, opacity: 0.4, depthWrite: false });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.ghostMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set((FOOT.x0 + FOOT.x1) / 2, 0.12, (FOOT.z0 + FOOT.z1) / 2);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(21.2, 1.6), new THREE.MeshBasicMaterial({ color: 0x3a3f47, transparent: true, opacity: 0.7, depthWrite: false }));
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.14, -7);
    const center = new THREE.Mesh(new THREE.PlaneGeometry(19, 0.08), lineMat);
    center.rotation.x = -Math.PI / 2;
    center.position.set(0, 0.15, -7);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 3), lineMat);
    arrow.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    arrow.position.set(11.5, 0.16, -7);
    const term = new THREE.Mesh(new THREE.BoxGeometry(15.8, 1.3, 3.1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    term.position.set(-0.3, 0.65, TERM_Z + 1.55);
    g.add(pad, runway, center, arrow, term);
    for (const o of g.children) o.renderOrder = 6;
    this.ghost = g;
    this.scene.add(g);
  }

  #hover(e) {
    const rect = this.game.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane0, new THREE.Vector3());
    if (!hit) return;
    this.pointer = hit;
    this.#preview();
  }

  #preview() {
    const p = this.pointer;
    const x = Math.round(p.x * 2) / 2;
    const z = Math.round(p.z * 2) / 2;
    this.plan = this.#plan(x, z, this.rot);
    this.ghost.visible = true;
    this.ghost.position.set(x, 0, z);
    this.ghost.rotation.y = this.rot;
    this.ghostMat.color.set(this.plan.ok ? 0x4cc47a : 0xf0605a);
    const clear = this.#clearText(this.plan.props);
    const sea = Math.hypot(x, z) > 18 ? '・填海造陸' : '';
    const info = `費用 <b>${money(this.plan.cost)}</b>${sea}${clear}` +
      (this.plan.ok ? '<br>點一下蓋在這裡，按 R 旋轉。' : `<br><span class="bad">${this.plan.problems.join('、')}</span>`);
    this.#card('蓋機場', info, [
      { label: '旋轉', run: () => this.#rotate(1) },
      { label: '取消', run: () => this.#end() },
    ], 'place');
  }

  #clearText(props) {
    if (!props.length) return '';
    const counts = {};
    for (const p of props) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return `<br>需清除 ${Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? '個'}`).join('、')}`;
  }

  // ---------- Cards ----------

  #card(title, html, actions = [], mode = null) {
    const { card, title: t, info, actions: a } = this.ui;
    this.cardMode = title ? mode : null;
    card.hidden = !title;
    if (!title) return;
    t.textContent = title;
    info.innerHTML = html;
    a.replaceChildren(
      ...actions.map((x) => {
        const b = document.createElement('button');
        b.textContent = x.label;
        if (x.primary) b.classList.add('primary');
        b.addEventListener('click', x.run);
        return b;
      }),
    );
  }

  #fleetCard(note = '') {
    this.game.builder.setTool?.(null);
    const free = this.#freeStand() >= 0;
    let html = note ? `<div>${note}</div>` : '';
    html += '<div class="air-sub">機隊</div><div class="air-list" data-fleet>';
    if (!this.flights.length) html += '<div>還沒有飛機。</div>';
    for (const f of this.flights) {
      html += `<div class="air-row" data-code="${f.code}"><span class="sw" style="background:${hex(f.type.colors.tail)}"></span>
        <span class="nm"><b style="color:#2c3440">${f.code}</b> ${f.type.name}・${f.type.seats} 座</span>
        <span class="st" style="color:${f.status[1]}">${f.status[0]}</span>
        <button data-follow="${f.code}">${this.follow === f ? '停止跟隨' : '跟隨'}</button>
        <button data-sell="${f.code}">賣出</button></div>`;
    }
    html += `</div><div class="air-sub">購買飛機${free ? '' : '（機坪已滿，最多 3 架）'}</div><div class="air-list">`;
    for (const t of this.types) {
      const custom = !BASE_TYPES.some((b) => b.id === t.id);
      html += `<div class="air-row"><span class="sw" style="background:${hex(t.colors.tail)}"></span>
        <span class="nm">${t.name}<span style="color:#8a93a0">・${t.familyLabel}・${t.seats} 座・票價 ${money(t.fare)}</span></span>
        ${custom ? `<button data-del="${t.id}" title="刪除這個機種">✕</button>` : ''}
        <button class="primary" data-buy="${t.id}" ${free && t.price <= this.game.money.get() ? '' : 'disabled'}>${money(t.price)}</button></div>`;
    }
    html += '</div>';
    this.#card('機場', html, [
      { label: '✏️ 設計新機種', run: () => this.#designer() },
      { label: '拆除機場', run: () => this.#confirmDemolish() },
      { label: '關閉', run: () => this.#card(null) },
    ], 'fleet');
    const info = this.ui.info;
    for (const b of info.querySelectorAll('[data-buy]')) {
      b.addEventListener('click', () => {
        const t = [...BASE_TYPES, ...this.custom].find((x) => x.id === b.dataset.buy);
        if (t && this.#buy(t)) this.#fleetCard(`${t.name} 已加入機隊，正在機坪等待旅客登機。`);
      });
    }
    for (const b of info.querySelectorAll('[data-sell]')) {
      b.addEventListener('click', () => {
        const f = this.flights.find((x) => x.code === b.dataset.sell);
        if (!f) return;
        const back = this.#sell(f);
        this.#fleetCard(back ? `${f.code} 已賣出，回收 ${money(back)}。` : `<span class="bad">${f.code} 要停在機坪、機上沒有旅客時才能賣。</span>`);
      });
    }
    for (const b of info.querySelectorAll('[data-follow]')) {
      b.addEventListener('click', () => {
        const f = this.flights.find((x) => x.code === b.dataset.follow);
        this.follow = this.follow === f ? null : f;
        if (this.follow) {
          const p = f.plane.group.position;
          this.game.camera.position.set(p.x + 7, p.y + 5, p.z + 7);
        }
        this.#fleetCard();
      });
    }
    for (const b of info.querySelectorAll('[data-del]')) {
      b.addEventListener('click', () => {
        this.custom = this.custom.filter((t) => t.id !== b.dataset.del);
        this.save();
        this.#fleetCard();
      });
    }
  }

  #refreshFleetStatus() {
    for (const f of this.flights) {
      const st = this.ui.info.querySelector(`[data-code="${f.code}"] .st`);
      if (st) {
        st.textContent = f.status[0];
        st.style.color = f.status[1];
      }
    }
  }

  #confirmDemolish() {
    const refund = AIRPORT_COST / 2 + this.flights.reduce((s, f) => s + Math.round(f.type.price / 2), 0);
    this.#card('拆除機場', `確定要拆除機場和 ${this.flights.length} 架飛機嗎？會退回 ${money(refund)}。`, [
      { label: '確定拆除', primary: true, run: () => this.#demolish() },
      { label: '取消', run: () => this.#fleetCard() },
    ], 'confirm');
  }

  #designer() {
    const fams = Object.entries(FAMILIES);
    const draft = { family: 'whale', name: '我的飛機', rows: 6, engines: 2, colors: { body: 0xffffff, stripe: 0xe8553f, belly: 0xe8553f, tail: 0xe8553f } };
    const html = `<div class="air-form">
      <span>名稱</span><input type="text" id="adName" maxlength="8" value="${draft.name}">
      <span>機型</span><select id="adFam">${fams.map(([k, f]) => `<option value="${k}" ${k === draft.family ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
      <span>排數</span><span><input type="range" id="adRows" min="1" max="9" value="${draft.rows}"> <b id="adRowsOut"></b></span>
      <span>引擎</span><select id="adEng"><option value="2">雙引擎</option><option value="4">四引擎</option></select>
      <span>塗裝</span><span class="air-colors">
        <label>機身 <input type="color" id="adBody" value="${hex(draft.colors.body)}"></label>
        <label>線條 <input type="color" id="adStripe" value="${hex(draft.colors.stripe)}"></label>
        <label>腹部 <input type="color" id="adBelly" value="${hex(draft.colors.belly)}"></label>
        <label>尾翼 <input type="color" id="adTail" value="${hex(draft.colors.tail)}"></label></span>
    </div><div id="adSum"></div>`;
    const read = () => {
      const $ = (id) => document.getElementById(id);
      const fam = $('adFam').value;
      const f = FAMILIES[fam];
      const rows = $('adRows');
      rows.min = f.minRows;
      rows.max = f.maxRows;
      $('adEng').disabled = fam !== 'whale';
      const t = {
        id: `c${Date.now().toString(36)}`,
        family: fam,
        name: ($('adName').value.trim() || '新機種').slice(0, 8),
        rows: +rows.value,
        engines: fam === 'whale' ? +$('adEng').value : 2,
        colors: {
          body: new THREE.Color($('adBody').value).getHex(),
          stripe: new THREE.Color($('adStripe').value).getHex(),
          belly: new THREE.Color($('adBelly').value).getHex(),
          tail: new THREE.Color($('adTail').value).getHex(),
        },
      };
      const d = describe(t);
      $('adRowsOut').textContent = `${d.rows} 排`;
      $('adSum').innerHTML = `${d.seats} 個座位・售價 <b>${money(d.price)}</b>・每位旅客票價 ${money(d.fare)}`;
      return t;
    };
    this.#card('設計新機種', html, [
      {
        label: '儲存並購買',
        primary: true,
        run: () => {
          const t = read();
          this.custom.push(t);
          this.save();
          const ok = this.#buy(t);
          this.#fleetCard(ok ? `新機種「${t.name}」已儲存並加入機隊。` : `新機種「${t.name}」已儲存。<span class="bad">（資金不足或機坪已滿，先不購買）</span>`);
        },
      },
      {
        label: '只儲存',
        run: () => {
          const t = read();
          this.custom.push(t);
          this.save();
          this.#fleetCard(`新機種「${t.name}」已儲存，可以在購買清單找到。`);
        },
      },
      { label: '取消', run: () => this.#fleetCard() },
    ], 'design');
    for (const el of this.ui.info.querySelectorAll('input, select')) el.addEventListener('input', read);
    read();
  }

  // ---------- Save / load ----------

  save() {
    if (this.resetting) return;
    const data = {
      airport: this.airport ? { x: this.airport.x, z: this.airport.z, rot: this.airport.rot } : null,
      fleet: this.flights.map((f) => ({ ...f.type })),
      custom: this.custom,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
  }

  #load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch {}
    if (!data) return;
    this.custom = Array.isArray(data.custom) ? data.custom : [];
    if (data.airport) {
      const { x, z, rot } = data.airport;
      this.#build({ x, z, rot, props: this.game.world.scenery.query((px, pz, r) => this.#inFoot(px, pz, x, z, rot, r * 0.6 + 0.3)) }, false);
      for (const t of data.fleet ?? []) this.#buy(t, false);
    }
  }

  // For tests and the debug console.
  debugBuild(x, z, rot = 0) {
    const plan = this.#plan(x, z, rot);
    if (!plan.ok) return plan.problems;
    this.#build(plan, true);
    return true;
  }

  debugBuy(id) {
    const t = [...BASE_TYPES, ...this.custom].find((x) => x.id === id);
    return this.#buy(t);
  }
}

export const airportModule = new AirportSystem();
airportModule.name = 'airport';
