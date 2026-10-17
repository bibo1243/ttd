import * as THREE from 'three';
import { arcCurve, joinCurve, minRadius, straightCurve } from '../network.js';
import { VEHICLE_MODELS } from '../vehicles/models.js';
import { K } from '../vehicles/kit.js';
import { Polyline, ROAD_TYPES, RoadNet, crossings, junctionGap, outerHalf, resample, roadGap, roadType } from './net.js';
import { ROAD_MATS, buildRoadMeshes } from './mesh.js';
import { Traffic } from './traffic.js';
import { makeShelter } from './props.js';
import { injectStyle } from './style.js';
import { rayToGround } from '../planet.js';

// Roads module: lets the player lay roads of several types (lanes, roads
// and avenues, with signalised junctions, dead-end turning circles and
// level crossings), build bus stops, and choose which vehicles drive on the
// roads, including their own custom types.

export const ROAD_COST = { stop: 300, bus: 1200, tree: 15, house: 150, rock: 5 };
const KIND_LABEL = { tree: '棵樹', house: '間房子', rock: '顆石頭' };
const SAVE_KEY = 'ttdRoads1';
const RAIL_SAVE_KEY = 'ttdSave2';
const ISLAND_R = 22;
const MIN_R = 1.4;
const RAIL_GAP = 1.35;
const SNAP = 0.9;
const MAX_VEHICLES = 48;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, z) => new THREE.Vector3(x, 0, z);
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const GOOD = new THREE.Color(0x4cc47a);
const BAD = new THREE.Color(0xf0605a);
const reverseCurve = (c) => new THREE.CubicBezierCurve3(c.v3.clone(), c.v2.clone(), c.v1.clone(), c.v0.clone());

const PALETTE = [0xe8574a, 0xf2a541, 0xf4d35e, 0x56b38a, 0x2e8b6e, 0x56c2c2, 0x3a86d4, 0x9b7fd1, 0xe8789a, 0xf2f0ea, 0x8a8f9c, 0x2f3440];
const DEFAULT_FLEET = { sedan: 3, taxi: 1, van: 1, scooter: 2, bicycle: 1, bus: 0 };
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;

class RoadsModule {
  constructor() {
    this.name = 'roads';
    this.mode = null; // 'road' | 'stop' | 'fleet'
    this.sub = 'build'; // road tool: 'build' | 'demolish'
    this.roadKind = 'road'; // which ROAD_TYPES the road tool lays
    this.chain = null;
    this.buttons = {};
    this.fleet = { ...DEFAULT_FLEET };
    this.custom = [];
    this.spawnTimer = 0;
  }

  init(game) {
    this.game = game;
    this.scene = game.scene;
    this.net = new RoadNet();
    this.traffic = new Traffic(game, this.net);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(UP, 0);
    injectStyle();
    this.#ghosts();
    this.#ui();
    this.#input();
    this.load();
    // Rails and other modules keep clear of bus stops and road junctions.
    const world = game.world;
    world.blockers ??= [];
    this.blockers = [
      { label: '公車站', hit: (x, z, m = 0) => this.traffic.stops.some((s) => (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < (0.9 + m) ** 2) },
      { label: '公路路口', hit: (x, z, m = 0) => [...this.net.nodes].some((n) => n.segs.length >= 3 && (n.pos.x - x) ** 2 + (n.pos.z - z) ** 2 < (n.radius + 0.4 + m) ** 2) },
    ];
    world.blockers.push(...this.blockers);
    game.look?.onTime?.((night) => {
      K.head.emissiveIntensity = 1.6 + night;
      K.tail.emissiveIntensity = 1.3 + 0.7 * night;
      ROAD_MATS.bulb.emissiveIntensity = 1.5 + 1.5 * night;
    });
    window.__roads = this;
  }

  // ---------- Toolbar & card ----------

  #ui() {
    const add = (id, icon, label) => {
      this.buttons[id] = this.game.tools.addTool({ id, icon, label, onSelect: () => this.setMode(id) });
    };
    add('road', '🛣️', '公路');
    add('stop', '🚏', '公車站');
    add('fleet', '🚗', '車輛');
    // The rail tools take over: put ours away.
    const tools = document.getElementById('tools');
    tools?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.dataset.extTool) this.setMode(null, true);
    }, true);
    this.card = {
      el: document.getElementById('buildCard'),
      title: document.getElementById('bcTitle'),
      info: document.getElementById('bcInfo'),
      actions: document.getElementById('bcActions'),
    };
  }

  #card(title, html, actions = []) {
    const c = this.card;
    if (!c.el) return;
    c.el.hidden = !title;
    if (!title) return;
    c.title.textContent = title;
    c.info.innerHTML = html;
    c.actions.replaceChildren(
      ...actions.map((a) => {
        const b = document.createElement('button');
        b.textContent = a.label;
        if (a.primary) b.classList.add('primary');
        if (a.on) b.classList.add('on');
        b.addEventListener('click', a.run);
        return b;
      }),
    );
  }

  setMode(mode, quiet = false) {
    if (this.mode === mode && mode) mode = null;
    const was = this.mode;
    this.mode = mode;
    this.chain = null;
    this.plan = null;
    this.#hideGhosts();
    for (const [id, b] of Object.entries(this.buttons)) b.classList.toggle('on', id === mode);
    if (mode === 'road') this.#roadCard();
    else if (mode === 'stop') {
      if (!this.net.segs.size) {
        this.mode = null;
        this.buttons.stop.classList.remove('on');
        return this.#card('公車站', '公車站要蓋在公路旁，先用「公路」鋪一條路吧。', [{ label: '知道了', run: () => this.#card(null) }]);
      }
      this.#card('公車站', '移到公路旁，游標在哪一側就蓋在哪一側的人行道上。每站 $300。公車會依建站順序繞行各站。');
    } else if (mode === 'fleet') this.#fleetCard();
    else if (was && !quiet) this.#card(null);
  }

  // ---------- Input ----------

  #input() {
    const dom = this.game.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.mode === 'road' || this.mode === 'stop') this.#hover(e);
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || !(this.mode === 'road' || this.mode === 'stop')) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (d.button === 2 && this.chain) return this.#endChain();
      if (d.button !== 0) return;
      this.#hover(e);
      if (this.mode === 'road') this.sub === 'build' ? this.#clickRoad() : this.#clickDemolish();
      else this.#clickStop();
    });
    dom.addEventListener('contextmenu', (e) => this.mode && e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.mode) return;
      if (this.chain) this.#endChain();
      else this.setMode(null);
    });
  }

  #hover(e) {
    const dom = this.game.renderer.domElement;
    const r = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const g = rayToGround(this.raycaster.ray);
    if (!g) return;
    this.pointer = g;
    if (this.mode === 'road') this.sub === 'build' ? this.#previewRoad() : this.#previewDemolish();
    else if (this.mode === 'stop') this.#previewStop();
  }

  // ---------- Ghosts ----------

  #ghosts() {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: GOOD, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghostEdge = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.ghostRoad = new THREE.Group();
    this.ghostRoad.renderOrder = 5;
    this.scene.add(this.ghostRoad);
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.4, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.cursor.renderOrder = 6;
    this.cursor.visible = false;
    this.startMark = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 24), new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x6b4a00 }));
    this.startMark.visible = false;
    this.scene.add(this.cursor, this.startMark);
    this.stopGhostMat = new THREE.MeshStandardMaterial({ color: GOOD, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x1d5a35 });
    this.stopGhost = makeShelter();
    this.stopGhost.traverse((o) => {
      if (o.isMesh) {
        o.material = this.stopGhostMat;
        o.castShadow = o.receiveShadow = false;
      }
    });
    this.stopGhost.visible = false;
    this.scene.add(this.stopGhost);
    this.hotMat = new THREE.MeshBasicMaterial({ color: 0xf0605a, transparent: true, opacity: 0.55, depthWrite: false });
  }

  #hideGhosts() {
    this.#clearGhostRoad();
    this.cursor.visible = false;
    this.startMark.visible = false;
    this.stopGhost.visible = false;
  }

  #clearGhostRoad() {
    for (const m of this.ghostRoad.children) m.geometry.dispose();
    this.ghostRoad.clear();
  }

  #drawGhost(pts, ok, mat = null, type = null) {
    this.#clearGhostRoad();
    if (!pts || pts.length < 2) return;
    const strip = (o0, o1, y, m) => {
      const pos = [];
      const idx = [];
      const t = new THREE.Vector3();
      const side = new THREE.Vector3();
      pts.forEach((p, i) => {
        t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
        side.crossVectors(t, UP).normalize();
        pos.push(p.x + side.x * o0, y, p.z + side.z * o0, p.x + side.x * o1, y, p.z + side.z * o1);
        if (i < pts.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 5;
      this.ghostRoad.add(mesh);
    };
    const m = mat ?? this.ghostMat;
    if (!mat) this.ghostMat.color.copy(ok ? GOOD : BAD);
    const T = type ?? this.type;
    strip(-outerHalf(T), outerHalf(T), 0.07, m);
    if (mat) return;
    // Lane lines, so the ghost shows how many lanes the road will have.
    const marks = T.median ? [-T.median, T.median] : T.kerb ? [0] : [];
    if (T.lanes.length > 1) {
      const div = (T.lanes[0] + T.lanes[1]) / 2;
      marks.push(-div, div);
    }
    marks.push(-T.half, T.half);
    for (const o of marks) strip(o - 0.02, o + 0.02, 0.075, this.ghostEdge);
  }

  get type() {
    return roadType(this.roadKind);
  }

  // ---------- Road tool ----------

  #roadCard(extra = '') {
    const actions = [
      { label: '鋪路', on: this.sub === 'build', run: () => this.#setSub('build') },
      { label: '拆除', on: this.sub === 'demolish', run: () => this.#setSub('demolish') },
    ];
    if (this.chain) actions.push({ label: '結束這條路', run: () => this.#endChain() });
    actions.push({ label: '完成', primary: true, run: () => this.setMode(null) });
    const T = this.type;
    const base = this.sub === 'build'
      ? this.chain
        ? '繼續點下一個點延伸道路；點到其他道路上會自動做成有紅綠燈的路口，穿過鐵路會蓋平交道。右鍵或 Esc 結束這條路。'
        : `在地上點起點，再點下一個點鋪一段${T.label}（每公尺 ${money(T.cost)}）。從路尾或路邊開始可以接成岔路；和其他道路交叉會自動變成有紅綠燈的路口。`
      : '點一段公路把它拆掉，退回一半的建造費。上面的公車站也會一起拆除。';
    const picker = this.sub === 'build'
      ? `<div class="rd-types">${Object.values(ROAD_TYPES).map((t) => `<button class="rd-type ${t.key === this.roadKind ? 'on' : ''}" data-kind="${t.key}">
          <span class="rd-type-icon">${t.icon}</span><span class="rd-type-name">${t.label}</span>
          <span class="rd-type-meta">${t.lanesText}・速限 ${t.kmh}</span><span class="rd-type-meta">${money(t.cost)}/公尺</span></button>`).join('')}</div>
        <div class="hint rd-type-note">${T.note}</div>`
      : '';
    this.#card('公路', picker + (extra || base), actions);
    this.card.info?.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
      this.roadKind = b.dataset.kind;
      this.plan = null;
      if (this.chain && this.pointer) this.#previewRoad();
      else this.#roadCard();
    }));
  }

  #setSub(sub) {
    this.sub = sub;
    this.chain = null;
    this.#hideGhosts();
    this.#unhot();
    this.#roadCard();
  }

  #snap(p) {
    const node = this.net.nearestNode(p.x, p.z, SNAP);
    if (node && node.segs.length < 4) return { node, pos: node.pos.clone() };
    const ns = this.net.nearestSeg(p.x, p.z);
    if (ns && ns.dist < SNAP) {
      if (ns.s < 1.4) return { node: ns.seg.a, pos: ns.seg.a.pos.clone() };
      if (ns.s > ns.seg.length - 1.4) return { node: ns.seg.b, pos: ns.seg.b.pos.clone() };
      return { seg: ns.seg, s: ns.s, pos: ns.pos.clone() };
    }
    return { pos: V(Math.round(p.x * 4) / 4, Math.round(p.z * 4) / 4) };
  }

  #near(a, b, r) {
    return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
  }

  #planRoad(start, end, type = this.type) {
    const A = start.pos;
    const B = end.pos;
    const problems = [];
    if (A.distanceTo(B) < 1.2) return { start, end, problems: ['太短了'], ok: false };
    const sDir = start.dir ?? (start.node?.segs.length === 1 ? start.node.segs[0].dirAt(start.node).negate() : null);
    const eDir = end.node?.segs.length === 1 ? end.node.segs[0].dirAt(end.node) : null;
    let curve;
    if (sDir && eDir) curve = joinCurve(A, sDir, B, eDir);
    else if (sDir) curve = arcCurve(A, sDir, B);
    else if (eDir) {
      const back = arcCurve(B, eDir.clone().negate(), A);
      curve = back && reverseCurve(back);
    } else curve = straightCurve(A, B);
    if (!curve) return { start, end, problems: ['轉彎角度太大，多點幾個點慢慢轉'], ok: false };
    if ((start.node && start.node === end.node) || (start.seg && start.seg === end.seg)) problems.push('起點和終點不能在同一條路上');
    if (minRadius(curve) < MIN_R) problems.push('彎道太急');
    const length = curve.getLength();
    const pts = resample(curve.getSpacedPoints(Math.max(8, Math.ceil(length / 0.1))), 0.2);
    const line = new Polyline(pts);
    if (pts.some((p) => p.x * p.x + p.z * p.z > ISLAND_R * ISLAND_R)) problems.push('超出島的範圍');

    // Crossing other roads makes new junctions.
    const joins = [start, end].filter((s) => s.node || s.seg).map((s) => s.pos);
    const cuts = [];
    for (const seg of this.net.segs) {
      for (const c of crossings(line, seg.line)) {
        if (joins.some((j) => this.#near(j, c.p, 0.6))) continue;
        if (c.angle < 0.55) problems.push('和道路交叉的角度太斜');
        cuts.push({ t: c.ta, p: c.p, seg });
      }
    }
    cuts.sort((a, b) => a.t - b.t);
    const keyPts = [...joins, ...cuts.map((c) => c.p)];
    const nodeGap = (n) => junctionGap(type, n.segs.reduce((w, s) => (s.type.half > w.half ? s.type : w), type));
    for (const n of this.net.nodes) {
      if (n.segs.length >= 3 || (n.segs.length === 2 && !n.smooth)) {
        if (cuts.some((c) => this.#near(c.p, n.pos, nodeGap(n)))) problems.push('離其他路口太近');
      }
    }
    for (let i = 1; i < cuts.length; i++) if (cuts[i].t - cuts[i - 1].t < junctionGap(type, cuts[i].seg.type.half > cuts[i - 1].seg.type.half ? cuts[i].seg.type : cuts[i - 1].seg.type)) problems.push('路口之間太近');
    for (const sn of [start, end]) {
      if (!sn.seg) continue;
      for (const n of [sn.seg.a, sn.seg.b]) if (n.segs.length >= 2 && this.#near(sn.pos, n.pos, nodeGap(n))) problems.push('離其他路口太近');
    }
    // Keep clear of other roads except where they meet.
    const far = pts.filter((p, i) => i % 2 === 0);
    const tooClose = far.some((p) => [...this.net.segs].some((s) => {
      const gap = roadGap(type, s.type);
      if (keyPts.some((k) => this.#near(p, k, gap + 0.3))) return false;
      return s.line.nearest(p.x, p.z).dist < gap;
    }));
    if (tooClose) problems.push('太靠近其他道路');
    const blocker = this.#blockedBy(pts.filter((p, i) => i % 2 === 0), outerHalf(type));
    if (blocker) problems.push(`會壓到${blocker}`);

    // Rails: level crossings are fine at a decent angle.
    const railCross = [];
    for (const e of this.game.network.edges) {
      e._roadPoly ??= new Polyline(e.samples);
      for (const c of crossings(line, e._roadPoly)) {
        if (c.angle < 0.7) problems.push('和鐵路交叉的角度太斜');
        railCross.push(c.p);
      }
    }
    for (const n of this.game.network.nodes) {
      if (n.edges.length >= 3 && railCross.some((p) => this.#near(p, n.pos, 3))) problems.push('不能在道岔上蓋平交道');
    }
    for (const c of railCross) {
      if (cuts.some((x) => this.#near(x.p, c, 3)) || keyPts.some((k) => this.#near(k, c, 2.6))) problems.push('平交道離路口太近');
    }
    const rails = [...this.game.network.edges].flatMap((e) => e.samples);
    if (pts.some((p, i) => i % 2 === 0 && !railCross.some((c) => this.#near(p, c, 1.7)) && rails.some((q) => this.#near(p, q, RAIL_GAP)))) problems.push('太靠近鐵路');
    for (const s of this.game.passengers.stations ?? []) {
      if (pts.some((p) => s.contains?.(p.x, p.z, type.half + 0.2))) {
        problems.push('會壓到車站');
        break;
      }
    }
    for (const stop of this.traffic.stops) if (pts.some((p) => this.#near(p, stop.pos, 1.3))) problems.push('會壓到公車站');

    const props = this.game.world.scenery.query((x, z, r) => pts.some((p) => this.#near(p, { x, z }, outerHalf(type) + r * 0.5)));
    const cost = Math.round(length * type.cost) + props.reduce((s, p) => s + (ROAD_COST[p.kind] ?? 0), 0);
    if (!problems.length && cost > this.game.money.get()) problems.push('資金不足');
    return { start, end, type, curve, pts, line, length, cuts, props, cost, problems: [...new Set(problems)], ok: !problems.length };
  }

  #clearText(props) {
    if (!props?.length) return '';
    const counts = {};
    for (const p of props) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return `<br>需清除 ${Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? '個東西'}`).join('、')}`;
  }

  #previewRoad() {
    if (!this.pointer) return;
    const end = this.#snap(this.pointer);
    this.cursor.visible = true;
    this.cursor.position.set(end.pos.x, 0.08, end.pos.z);
    this.cursor.material.color.set(end.node || end.seg ? 0xffd34d : 0xffffff);
    if (!this.chain) {
      this.#clearGhostRoad();
      return this.#roadCard();
    }
    this.plan = this.#planRoad(this.chain, end);
    this.#drawGhost(this.plan.pts, this.plan.ok);
    const p = this.plan;
    let info = p.pts ? `${p.type.label} ${p.length.toFixed(1)} 公尺・費用 <b>${money(p.cost)}</b>${this.#clearText(p.props)}` : '';
    if (p.cuts?.length) info += `<br>會新增 ${p.cuts.length} 個有紅綠燈的路口`;
    info += p.ok ? '<br>點一下鋪這段路。' : `<br><span class="bad">${p.problems.join('、')}</span>`;
    this.#roadCard(info);
  }

  #clickRoad() {
    const end = this.#snap(this.pointer);
    if (!this.chain) {
      this.chain = end;
      this.startMark.visible = true;
      this.startMark.position.set(end.pos.x, 0.06, end.pos.z);
      return this.#previewRoad();
    }
    const plan = this.#planRoad(this.chain, end);
    if (!plan.ok) {
      this.plan = plan;
      return this.#previewRoad();
    }
    const last = this.#buildRoad(plan, true);
    if (end.node || end.seg) return this.#endChain();
    // Carry on from the end of the new piece, heading the same way.
    const t = plan.curve.getTangentAt(1).setY(0).normalize();
    this.chain = { node: last, pos: last.pos.clone(), dir: t };
    this.startMark.position.set(last.pos.x, 0.06, last.pos.z);
    this.#previewRoad();
  }

  #endChain() {
    this.chain = null;
    this.plan = null;
    this.#clearGhostRoad();
    this.startMark.visible = false;
    this.#roadCard();
  }

  // Lay a planned piece; returns its end node.
  #buildRoad(plan, pay) {
    const net = this.net;
    if (pay) {
      this.game.money.spend(plan.cost);
      this.game.money.float(`-${money(plan.cost)}`, plan.pts[Math.floor(plan.pts.length / 2)].clone().setY(0.4));
    }
    this.game.world.scenery.remove(plan.props ?? []);
    const nodeFor = (sn) => {
      if (sn.node && net.nodes.has(sn.node)) return sn.node;
      if (sn.seg) {
        const ns = net.nearestSeg(sn.pos.x, sn.pos.z);
        return net.split(ns.seg, ns.s);
      }
      return net.addNode(sn.pos);
    };
    const a = nodeFor(plan.start);
    const b = nodeFor(plan.end);
    // Junctions where the new road crosses existing ones.
    const mids = plan.cuts.map((c) => {
      const ns = net.nearestSeg(c.p.x, c.p.z);
      return { t: c.t, node: net.split(ns.seg, ns.s) };
    });
    const stopsAt = [{ t: 0, node: a }, ...mids, { t: plan.line.length, node: b }];
    for (let i = 0; i < stopsAt.length - 1; i++) {
      const p = stopsAt[i];
      const q = stopsAt[i + 1];
      const pts = plan.line.slice(p.t, q.t);
      pts[0] = p.node.pos.clone();
      pts[pts.length - 1] = q.node.pos.clone();
      net.addSeg(p.node, q.node, resample(pts, 0.2), plan.cost * ((q.t - p.t) / plan.line.length), plan.type);
    }
    this.#changed();
    return b;
  }

  #changed() {
    this.net.rebuild();
    this.#redraw();
    this.traffic.networkChanged();
    this.#registerLamps();
    this.save();
  }

  #redraw() {
    this.railSeen = this.game.network.version;
    const rails = [...this.game.network.edges].map((e) => (e._roadPoly ??= new Polyline(e.samples)));
    this.group.clear();
    const meshes = buildRoadMeshes(this.net, rails, this.traffic.stops.map((st) => st.pos));
    this.group.add(meshes);
    this.traffic.setSignals(meshes.userData.signals ?? null);
  }

  #registerLamps() {
    const look = this.game.look;
    if (!look?.addLamp) return;
    this.lampAnchors ??= [];
    for (const [a, off] of this.lampAnchors) {
      off?.();
      a.removeFromParent();
    }
    this.lampAnchors = [];
    const inst = this.group.children[0]?.children.find((m) => m.isInstancedMesh && m.material === ROAD_MATS.bulb);
    if (!inst) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      const o = new THREE.Object3D();
      o.position.set(0, 1.0, 0.15).applyMatrix4(m);
      this.scene.add(o);
      this.lampAnchors.push([o, look.addLamp(o, { color: 0xffd9a0, intensity: 2, distance: 4 })]);
    }
  }

  // ---------- Demolish ----------

  #unhot() {
    if (this.hot) {
      this.#clearGhostRoad();
      this.hot = null;
    }
  }

  #previewDemolish() {
    const g = this.pointer;
    this.#unhot();
    const ns = this.net.nearestSeg(g.x, g.z);
    if (!ns || ns.dist > outerHalf(ns.seg.type)) return this.#roadCard();
    this.hot = ns.seg;
    this.#drawGhost(ns.seg.pts, false, this.hotMat, ns.seg.type);
    const stops = this.traffic.stops.filter((s) => s.seg === ns.seg);
    const refund = this.#refundFor(ns.seg);
    this.#roadCard(`拆除這段 ${ns.seg.length.toFixed(1)} 公尺的${ns.seg.type.label}${stops.length ? `和 ${stops.length} 個公車站` : ''}，退回 ${money(refund)}。`);
  }

  #refundFor(seg) {
    const stops = this.traffic.stops.filter((s) => s.seg === seg);
    return Math.round(seg.cost / 2 + (stops.length * ROAD_COST.stop) / 2);
  }

  #clickDemolish() {
    const seg = this.hot;
    if (!seg) return;
    const refund = this.#refundFor(seg);
    for (const s of this.traffic.stops.filter((x) => x.seg === seg)) this.traffic.removeStop(s);
    const at = seg.line.pointAt(seg.length / 2).setY(0.4);
    this.net.removeSeg(seg);
    this.hot = null;
    this.#clearGhostRoad();
    this.game.money.earn(refund);
    this.game.money.float(`+${money(refund)}`, at, '#4a90c8');
    this.#changed();
    this.#previewDemolish();
  }

  // ---------- Bus stop tool ----------

  // Shops and other modules' buildings (world.blockers), not our own.
  #blockedBy(points, margin) {
    const b = (this.game.world.blockers ?? []).find((bl) => !this.blockers.includes(bl) && points.some((p) => bl.hit(p.x, p.z, margin)));
    return b?.label ?? null;
  }

  #planStop() {
    const g = this.pointer;
    const ns = this.net.nearestSeg(g.x, g.z);
    if (!ns || ns.dist > 2.2) return null;
    const seg = ns.seg;
    const t = seg.line.tangentAt(ns.s);
    const side = new THREE.Vector3().crossVectors(t, UP).dot(new THREE.Vector3().subVectors(g, ns.pos)) >= 0 ? 1 : -1;
    const f = this.traffic.stopFrame(seg, ns.s, side);
    const problems = [];
    for (const n of [seg.a, seg.b]) {
      if (n.segs.length !== 2 || !n.smooth) {
        if (n.segs.length >= 2 && f.p.distanceTo(n.pos) < n.radius + 2.4) problems.push('離路口太近');
      }
    }
    if (ns.s < 1.6 || ns.s > seg.length - 1.6) problems.push('太靠近路的盡頭');
    if (this.traffic.stops.some((s) => s.pos.distanceTo(f.origin) < 3.2)) problems.push('離其他公車站太近');
    if (this.traffic.crossings.some((c) => c.p.distanceTo(f.p) < 3)) problems.push('離平交道太近');
    const pad = f.origin.clone().addScaledVector(f.out, 0.25);
    const corners = [-0.75, 0.75].map((x) => pad.clone().addScaledVector(t, x));
    for (const c of [pad, ...corners]) {
      if (c.x * c.x + c.z * c.z > ISLAND_R * ISLAND_R) {
        problems.push('超出島的範圍');
        break;
      }
    }
    const rails = [...this.game.network.edges].flatMap((e) => e.samples);
    if ([pad, ...corners].some((c) => rails.some((q) => this.#near(c, q, 0.9)))) problems.push('會壓到鐵路');
    if ((this.game.passengers.stations ?? []).some((s) => [pad, ...corners].some((c) => s.contains?.(c.x, c.z, 0.3)))) problems.push('會壓到車站');
    for (const other of this.net.segs) {
      if (other === seg) continue;
      if ([pad, ...corners].some((c) => other.line.nearest(c.x, c.z).dist < outerHalf(other.type) + 0.2)) {
        problems.push('會壓到其他道路');
        break;
      }
    }
    const blocker = this.#blockedBy([pad, ...corners], 0.2);
    if (blocker) problems.push(`會壓到${blocker}`);
    const props = this.game.world.scenery.query((x, z, r) => this.#near(pad, { x, z }, 0.9 + r * 0.5));
    const cost = ROAD_COST.stop + props.reduce((s, p) => s + (ROAD_COST[p.kind] ?? 0), 0);
    if (!problems.length && cost > this.game.money.get()) problems.push('資金不足');
    return { seg, s: ns.s, side, f, props, cost, problems: [...new Set(problems)], ok: !problems.length };
  }

  #previewStop() {
    const plan = this.#planStop();
    this.plan = plan;
    if (!plan) {
      this.stopGhost.visible = false;
      return this.#card('公車站', '移到公路旁，游標在哪一側就蓋在哪一側的人行道上。每站 $300。公車會依建站順序繞行各站。', [{ label: '完成', run: () => this.setMode(null) }]);
    }
    this.stopGhost.visible = true;
    this.stopGhost.position.copy(plan.f.origin);
    this.stopGhost.rotation.y = plan.f.yaw;
    this.stopGhostMat.color.copy(plan.ok ? GOOD : BAD);
    this.stopGhostMat.emissive.set(plan.ok ? 0x1d5a35 : 0x6a1d1a);
    const info = `費用 <b>${money(plan.cost)}</b>${this.#clearText(plan.props)}` + (plan.ok ? '<br>點一下蓋在這裡。每蓋一站會有 3 位通勤族搬來。' : `<br><span class="bad">${plan.problems.join('、')}</span>`);
    this.#card('公車站', info, [{ label: '完成', run: () => this.setMode(null) }]);
  }

  #clickStop() {
    const plan = this.plan;
    if (!plan?.ok) return;
    this.game.money.spend(plan.cost);
    this.game.world.scenery.remove(plan.props);
    const stop = this.traffic.addStop(plan.seg, plan.s, plan.side);
    this.game.money.float(`-${money(plan.cost)}`, stop.pos.clone().setY(1));
    this.#redraw();
    this.#registerLamps();
    this.save();
    this.#previewStop();
    if (this.traffic.stops.length === 2 && !this.traffic.buses.length) {
      this.#card('公車站', '已經有兩個公車站了！到「車輛」加開一台公車，居民就會開始搭公車、付車資。', [
        { label: '加開公車', primary: true, run: () => this.setMode('fleet') },
        { label: '繼續蓋', run: () => this.#previewStop() },
      ]);
    }
  }

  // ---------- Fleet ----------

  get types() {
    const out = Object.entries(VEHICLE_MODELS).map(([key, m]) => ({ key, model: key, name: m.label, icon: m.icon, color: null }));
    for (const c of this.custom) out.push({ key: c.key, model: c.base, name: c.name, icon: VEHICLE_MODELS[c.base].icon, color: c.color, custom: true });
    return out;
  }

  get capacity() {
    // Avenues, with two lanes each way, hold more than their length.
    let room = 0;
    for (const s of this.net.segs) room += s.length * (1 + (s.type.lanes.length - 1) * 0.6);
    return Math.min(MAX_VEHICLES, Math.floor(room / 2.4));
  }

  #count(key) {
    return this.traffic.vehicles.filter((v) => v.type === key).length;
  }

  #fleetCard() {
    const rows = this.types
      .map((t) => {
        const want = this.fleet[t.key] ?? 0;
        const now = this.#count(t.key);
        const dot = t.color !== null ? `<span class="rd-dot" style="background:${hex(t.color)}"></span>` : '';
        const price = t.model === 'bus' ? `<span class="rd-price">${money(ROAD_COST.bus)}</span>` : '';
        const del = t.custom ? `<button class="mini ghosty" data-del="${t.key}" title="刪除這個車種">✕</button>` : '';
        return `<div class="rd-row"><span class="rd-icon">${t.icon}</span><span class="rd-name">${dot}${t.name}${price}</span>
          <span class="rd-count">${now}${now !== want ? `/${want}` : ''}</span>${del}
          <button class="mini" data-sub="${t.key}">－</button><button class="mini" data-add="${t.key}">＋</button></div>`;
      })
      .join('');
    const total = this.traffic.vehicles.length;
    const hint = this.net.segs.size
      ? `路上 ${total} 台・這些道路最多容納 ${this.capacity} 台。居民的車不用錢；公車要花錢買，靠載客收車資。`
      : '還沒有公路，車輛會在鋪好路之後開上路。';
    this.#card('車輛', `<div class="rd-list">${rows}</div><div class="hint rd-hint">${hint}</div>`, [
      { label: '＋ 自訂車種', run: () => this.#customCard() },
      { label: '完成', primary: true, run: () => this.setMode(null) },
    ]);
    const info = this.card.info;
    info.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => this.#change(b.dataset.add, 1)));
    info.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => this.#change(b.dataset.sub, -1)));
    info.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => this.#removeCustom(b.dataset.del)));
  }

  #change(key, d) {
    const t = this.types.find((x) => x.key === key);
    const want = this.fleet[key] ?? 0;
    if (d > 0) {
      const total = Object.values(this.fleet).reduce((s, n) => s + n, 0);
      if (total >= MAX_VEHICLES) return;
      if (t.model === 'bus') {
        if (!this.game.money.spend(ROAD_COST.bus)) return this.#flash('資金不足，公車一台 $1,200');
        this.game.money.float(`-${money(ROAD_COST.bus)}`, this.game.controls.target.clone().setY(1));
      }
      this.fleet[key] = want + 1;
    } else if (want > 0) {
      this.fleet[key] = want - 1;
      if (t.model === 'bus') {
        this.game.money.earn(ROAD_COST.bus / 2);
        this.game.money.float(`+${money(ROAD_COST.bus / 2)}`, this.game.controls.target.clone().setY(1), '#4a90c8');
      }
    }
    this.#syncFleet(true);
    this.save();
    this.#fleetCard();
  }

  #flash(text) {
    const h = this.card.el?.querySelector('.rd-hint');
    if (h) h.innerHTML = `<span class="bad">${text}</span>`;
  }

  #customCard(draft = { base: 'sedan', color: PALETTE[0], name: '' }) {
    const bases = Object.entries(VEHICLE_MODELS)
      .map(([k, m]) => `<button class="mini rd-base ${draft.base === k ? 'on' : ''}" data-base="${k}" title="${m.label}">${m.icon}</button>`)
      .join('');
    const swatches = PALETTE.map((c) => `<button class="rd-swatch ${draft.color === c ? 'on' : ''}" data-color="${c}" style="background:${hex(c)}"></button>`).join('');
    this.#card('自訂車種', `<div class="rd-form">
        <label>車款</label><div class="rd-bases">${bases}</div>
        <label>顏色</label><div class="rd-swatches">${swatches}</div>
        <label>名稱</label><input class="rd-input" maxlength="10" placeholder="例如：${VEHICLE_MODELS[draft.base].label}（紅）" value="${draft.name.replace(/"/g, '&quot;')}" />
      </div>`, [
      { label: '取消', run: () => this.#fleetCard() },
      {
        label: '建立並開上路',
        primary: true,
        run: () => {
          const name = this.card.info.querySelector('.rd-input').value.trim() || `${VEHICLE_MODELS[draft.base].label}`;
          const key = `c${Date.now().toString(36)}`;
          this.custom.push({ key, base: draft.base, color: draft.color, name });
          this.fleet[key] = draft.base === 'bus' ? 0 : 2;
          this.#syncFleet(true);
          this.save();
          this.#fleetCard();
        },
      },
    ]);
    const info = this.card.info;
    const input = info.querySelector('.rd-input');
    info.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => this.#customCard({ ...draft, name: input.value, base: b.dataset.base })));
    info.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => this.#customCard({ ...draft, name: input.value, color: Number(b.dataset.color) })));
  }

  #removeCustom(key) {
    this.custom = this.custom.filter((c) => c.key !== key);
    delete this.fleet[key];
    for (const v of this.traffic.vehicles.filter((x) => x.type === key)) this.traffic.despawn(v);
    this.save();
    this.#fleetCard();
  }

  // Add or remove vehicles to match the chosen counts, a few at a time.
  #syncFleet(now = false) {
    if (!this.net.lanes.length) return;
    const types = this.types;
    let budget = now ? 3 : 1;
    for (const t of types) {
      const want = this.fleet[t.key] ?? 0;
      let have = this.#count(t.key);
      while (have > want && budget > 0) {
        const list = this.traffic.vehicles.filter((v) => v.type === t.key);
        const v = list.find((x) => !x.seats?.some((s) => s.robot && x.kind === 'bus')) ?? list[list.length - 1];
        this.traffic.despawn(v);
        have--;
        budget--;
      }
      while (have < want && budget > 0 && this.traffic.vehicles.length < this.capacity) {
        if (!this.traffic.spawn(t)) break;
        have++;
        budget--;
      }
    }
  }

  // ---------- Module hooks ----------

  update(dt, time) {
    // New rails across a road: redraw it with a gap in the sidewalks.
    if (this.railSeen !== this.game.network.version && this.net.segs.size) {
      this.#redraw();
      this.#registerLamps();
    }
    this.traffic.update(dt, time);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // New vehicles turn up at uneven intervals.
      this.spawnTimer = 0.25 + Math.random() * 1.4;
      this.#syncFleet();
    }
  }

  frame() {
    if (this.mode === 'fleet') {
      this.fleetTick = (this.fleetTick ?? 0) + 1;
      if (this.fleetTick % 30 === 0) {
        const counts = this.card.info.querySelectorAll('.rd-count');
        this.types.forEach((t, i) => {
          if (!counts[i]) return;
          const want = this.fleet[t.key] ?? 0;
          const now = this.#count(t.key);
          counts[i].textContent = `${now}${now !== want ? `/${want}` : ''}`;
        });
      }
    }
  }

  // ---------- Save / load (this browser) ----------

  save() {
    if (this.loading) return;
    const nodes = [...this.net.nodes];
    const segs = [...this.net.segs];
    const r = (x) => Math.round(x * 1000) / 1000;
    // v2 adds each segment's road type; v1 saves load as normal roads.
    const data = {
      v: 2,
      nodes: nodes.map((n) => [r(n.pos.x), r(n.pos.z)]),
      segs: segs.map((s) => ({ a: nodes.indexOf(s.a), b: nodes.indexOf(s.b), cost: Math.round(s.cost), type: s.type.key, pts: s.pts.map((p) => [r(p.x), r(p.z)]) })),
      stops: this.traffic.stops.map((s) => ({ seg: segs.indexOf(s.seg), s: r(s.s), side: s.side, name: s.name })),
      fleet: this.fleet,
      custom: this.custom,
      kind: this.roadKind,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
  }

  load() {
    let data = null;
    try {
      // "Start over" clears the rail save and reloads: roads go with it.
      if (!localStorage.getItem(RAIL_SAVE_KEY)) localStorage.removeItem(SAVE_KEY);
      data = JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch {}
    if (!data?.nodes) return;
    this.loading = true;
    const nodes = data.nodes.map(([x, z]) => this.net.addNode(V(x, z)));
    const segs = data.segs.map((s) => this.net.addSeg(nodes[s.a], nodes[s.b], s.pts.map(([x, z]) => V(x, z)), s.cost, roadType(s.type)));
    if (ROAD_TYPES[data.kind]) this.roadKind = data.kind;
    for (const n of nodes) if (!n.segs.length) this.net.nodes.delete(n);
    this.fleet = { ...DEFAULT_FLEET, ...(data.fleet ?? {}) };
    this.custom = (data.custom ?? []).filter((c) => VEHICLE_MODELS[c.base]);
    this.net.rebuild();
    for (const st of data.stops ?? []) if (segs[st.seg]) this.traffic.addStop(segs[st.seg], st.s, st.side, st.name);
    this.#redraw();
    this.traffic.networkChanged();
    this.loading = false;
    for (let i = 0; i < 20; i++) this.#syncFleet(true);
  }

  // ---------- Debug / demo ----------

  // Lay a small demo town: a loop road with a cross street and two stops.
  demo() {
    const P = (x, z) => ({ pos: V(x, z) });
    const build = (a, b, kind = 'road') => {
      const plan = this.#planRoad(a, b, roadType(kind));
      if (!plan.ok) {
        console.warn('demo road', plan.problems);
        return null;
      }
      return this.#buildRoad(plan, false);
    };
    return { P, build, snap: (x, z) => this.#snap(V(x, z)), plan: (a, b, kind = 'road') => this.#planRoad(a, b, roadType(kind)) };
  }
}

export const roads = new RoadsModule();
