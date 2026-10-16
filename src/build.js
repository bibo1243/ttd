import * as THREE from 'three';
import { arcCurve, joinCurve, minRadius, straightCurve } from './network.js';
import { FloatText, STATION_NAMES, STATION_STYLES, Station, makePlatform, placePlatform } from './stations.js';
import { Train, TRAIN_TYPES } from './train.js';
import { rayToGround, straightenRay } from './planet.js';

// Prices. Building on occupied ground also pays to clear what stands there.
export const COST = { track: 10, station: 600, train: 1500, tree: 15, house: 150, rock: 5 };
const KIND_LABEL = { tree: '棵樹', house: '間房子', rock: '顆石頭' };
const LINE_COLORS = [0xe8504a, 0x3a86d4, 0x3fae5f, 0xf2a33a, 0x8e6cc8, 0x2fa6a0, 0xe46a9a, 0x6b7f99];

const ISLAND_R = 22;
const MIN_RADIUS = 2.2; // tightest curve the longest cars can take
const TRACK_GAP = 1.25; // closest two separate tracks may run
const JOIN_ZONE = 4; // near a junction, tracks may come closer as they part
const CLEAR_R = 0.75;
const SNAP_NODE = 0.8;
const SNAP_EDGE = 0.6;
const MAX_STATIONS = 12;
const MAX_TRAINS = 10;
const SAVE_KEY = 'ttdSave2';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, z) => new THREE.Vector3(x, 0, z);
const money = (n) => `$${Math.round(n).toLocaleString()}`;
const GOOD = new THREE.Color(0x4cc47a);
const BAD = new THREE.Color(0xf0605a);

// An open flat strip along `pts`.
function ribbon(pts, width, offset, y) {
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    const a = offset - width / 2;
    const b = offset + width / 2;
    pos.set([p.x + side.x * a, y, p.z + side.z * a, p.x + side.x * b, y, p.z + side.z * b], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

const reverseCurve = (c) => new THREE.CubicBezierCurve3(c.v3.clone(), c.v2.clone(), c.v1.clone(), c.v0.clone());
const best = (dirs, want) => dirs.reduce((b, d) => (!b || d.dot(want) > b.dot(want) ? d : b), null);

export class BuildController {
  constructor({ scene, camera, dom, passengers, network, world, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.passengers = passengers;
    this.network = network;
    this.scenery = world.scenery;
    this.world = world;
    this.ui = ui;
    this.tool = null;
    this.chain = null; // where the next piece of track starts
    this.lines = [];
    this.editing = null; // line being edited with the line tool
    this.newType = 'steam';
    this.selected = null; // train or robot shown in the info card
    this.listeners = [];
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(UP, 0);
    this.#makeGhosts();
    this.#bindInput();
    this.#bindUI();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  #changed() {
    this.#firstTrain();
    for (const fn of this.listeners) fn(this);
    this.#refreshTools();
    this.#renderLines();
    this.save();
  }

  // The first line with two stations gets a train for free, so a new
  // player sees something run before they have to save up.
  #firstTrain() {
    if (this.loading || this.gaveTrain || this.trains.length) return;
    const line = this.lines.find((l) => l.stations.length >= 2);
    if (!line) return;
    this.gaveTrain = true;
    const t = this.buyTrain(line, true);
    if (t) {
      this.firstTrainNote = t;
      this.#card('第一台列車', `送你一台免費的${TRAIN_TYPES[t.type].label}，已經停在${t.current?.name ?? '車站'}，開始載客了！之後可以在左邊面板的路線旁按「＋」加開列車（每台 ${money(COST.train)}）。`, [
        { label: '好', primary: true, run: () => {
          this.firstTrainNote = null;
          this.#card(null);
          if (this.tool === 'station') this.#stationCard();
        } },
      ]);
    }
  }

  get stations() {
    return this.passengers.stations;
  }

  get trains() {
    return this.passengers.trains;
  }

  // ---------- Ghost previews ----------

  #makeGhosts() {
    const ghost = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.bedMat = ghost(GOOD, 0.5);
    this.railMat = ghost(0xffffff, 0.9);
    this.hotMat = ghost(0xff4433, 0.55);
    this.ghostTrack = new THREE.Group();
    this.hotTrack = new THREE.Group();
    this.scene.add(this.ghostTrack, this.hotTrack);

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.cursor.renderOrder = 6;
    this.cursor.visible = false;
    this.startMark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24),
      new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.4, emissive: 0x6b4a00 }),
    );
    this.startMark.visible = false;
    this.scene.add(this.cursor, this.startMark);

    this.stationGhostMat = new THREE.MeshStandardMaterial({ color: GOOD, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x1d5a35 });
    this.stationGhosts = {};
    for (const key of Object.keys(STATION_STYLES)) {
      const g = makePlatform(0xffffff, key);
      g.traverse((o) => {
        if (o.isMesh) {
          o.material = this.stationGhostMat;
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      g.visible = false;
      this.stationGhosts[key] = g;
      this.scene.add(g);
    }
    this.stationStyle = 'town';
  }

  #clear(group) {
    for (const m of group.children) m.geometry.dispose();
    group.clear();
  }

  #drawGhostTrack(curve, ok) {
    this.#clear(this.ghostTrack);
    if (!curve) return;
    const pts = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / 0.2)));
    this.bedMat.color.copy(ok ? GOOD : BAD);
    this.ghostTrack.add(new THREE.Mesh(ribbon(pts, 0.7, 0, 0.04), this.bedMat));
    for (const s of [-0.25, 0.25]) this.ghostTrack.add(new THREE.Mesh(ribbon(pts, 0.06, s, 0.06), this.railMat));
    for (const m of this.ghostTrack.children) m.renderOrder = 5;
  }

  #hideGhosts() {
    this.#clear(this.ghostTrack);
    this.#clear(this.hotTrack);
    this.cursor.visible = false;
    this.startMark.visible = false;
    for (const g of Object.values(this.stationGhosts)) g.visible = false;
    this.#unhighlight();
  }

  // ---------- Input ----------

  #bindInput() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.tool) this.#hover(e);
    });
    dom.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // that was a camera drag
      if (d.button === 2 && this.tool === 'track') return this.#endChain();
      if (d.button !== 0) return;
      if (!this.tool) return this.#pick(e);
      this.#hover(e);
      this.#click();
    });
    dom.addEventListener('contextmenu', (e) => this.tool && e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.tool === 'track' && this.chain) this.#endChain();
        else if (this.tool) this.setTool(null);
        else this.select(null);
      }
    });
  }

  #ndc(e) {
    const rect = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  #groundAt(e) {
    this.raycaster.setFromCamera(this.#ndc(e), this.camera);
    return rayToGround(this.raycaster.ray);
  }

  #hover(e) {
    const g = this.#groundAt(e);
    if (!g) return;
    this.pointer = g;
    if (this.tool === 'track') this.#previewTrack();
    else if (this.tool === 'station') this.#previewStation();
    else if (this.tool === 'demolish') this.#previewDemolish();
    else if (this.tool === 'line') this.#previewLine();
  }

  #click() {
    if (this.tool === 'track') this.#clickTrack();
    else if (this.tool === 'station') this.#clickStation();
    else if (this.tool === 'demolish') this.#clickDemolish();
    else if (this.tool === 'line') this.#clickLine();
  }

  setTool(tool) {
    if (this.tool === tool) tool = null;
    this.tool = tool;
    this.chain = null;
    this.plan = null;
    this.#hideGhosts();
    this.#refreshTools();
    if (tool) this.select(null);
    if (tool === 'track') this.#trackCard();
    else if (tool === 'station') {
      if (!this.network.edges.size) {
        this.tool = null;
        this.#refreshTools();
        return this.#card('蓋車站', '車站要蓋在鐵路旁，先用「鐵路」鋪一段軌道吧。', [{ label: '知道了', run: () => this.#card(null) }]);
      }
      this.#stationCard();
    } else if (tool === 'line') {
      if (!this.editing) this.editing = this.lines[this.lines.length - 1] ?? null;
      this.#lineCard();
    } else if (tool === 'demolish') {
      this.#card('拆除', '點一段鐵路或一個車站把它拆掉，退回一半的建造費。');
    } else this.#card(null);
  }

  // ---------- Track tool ----------

  // What a point snaps to: an existing node, a point on an edge, or open ground.
  #snap(p) {
    const node = this.network.nearestNode(p.x, p.z, SNAP_NODE);
    if (node && node.edges.length < 3) return { node, pos: node.pos.clone() };
    const ne = this.network.nearestEdge(p.x, p.z);
    if (ne && ne.dist < SNAP_EDGE) {
      const { edge, t } = ne;
      if (t < 0.8 && edge.a.edges.length < 3) return { node: edge.a, pos: edge.a.pos.clone() };
      if (t > edge.length - 0.8 && edge.b.edges.length < 3) return { node: edge.b, pos: edge.b.pos.clone() };
      return { edge, t, pos: ne.pos };
    }
    return { pos: V(Math.round(p.x * 4) / 4, Math.round(p.z * 4) / 4) };
  }

  // Directions new track may leave from / arrive into a snapped point.
  #outDirs(sn) {
    if (sn.node) return sn.node.edges.map((e) => e.dirAt(sn.node).negate());
    if (sn.edge) {
      const t = sn.edge.tangentAt(sn.t);
      return [t, t.clone().negate()];
    }
    return [];
  }

  #inDirs(sn) {
    if (sn.node) return sn.node.edges.map((e) => e.dirAt(sn.node));
    if (sn.edge) {
      const t = sn.edge.tangentAt(sn.t);
      return [t, t.clone().negate()];
    }
    return [];
  }

  #planSegment(start, end) {
    const A = start.pos;
    const B = end.pos;
    const problems = [];
    const len = A.distanceTo(B);
    if (len < 1) return { start, end, curve: null, problems: ['太短了'], ok: false };
    const chord = new THREE.Vector3().subVectors(B, A).normalize();
    const sDir = start.dir ?? best(this.#outDirs(start), chord);
    const eDir = best(this.#inDirs(end), chord);
    let curve;
    if (sDir && eDir) curve = joinCurve(A, sDir, B, eDir);
    else if (sDir) curve = arcCurve(A, sDir, B);
    else if (eDir) {
      const back = arcCurve(B, eDir.clone().negate(), A);
      curve = back && reverseCurve(back);
    } else curve = straightCurve(A, B);
    if (!curve) return { start, end, curve: null, problems: ['轉彎角度太大'], ok: false };

    if ((start.node && start.node === end.node) || (start.edge && start.edge === end.edge)) problems.push('起點和終點不能在同一處');
    if (minRadius(curve) < MIN_RADIUS) problems.push('彎道太急');
    const length = curve.getLength();
    const pts = curve.getSpacedPoints(Math.max(8, Math.ceil(length / 0.25)));
    if (pts.some((p) => p.x * p.x + p.z * p.z > ISLAND_R * ISLAND_R)) problems.push('超出島的範圍');
    for (const sn of [start, end]) {
      if (sn.edge?.reservedBy || (sn.node && sn.node.reservedBy)) problems.push('列車正在使用接點的軌道');
    }
    // Keep clear of other track, except where this piece joins it.
    const joinsA = start.node || start.edge;
    const joinsB = end.node || end.edge;
    const far = pts.filter((p) => !(joinsA && p.distanceTo(A) < JOIN_ZONE) && !(joinsB && p.distanceTo(B) < JOIN_ZONE));
    const near = (p, q, r) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < r * r;
    if (far.some((p) => [...this.network.edges].some((e) => e.samples.some((q) => near(p, q, TRACK_GAP))))) problems.push('太靠近其他鐵路');
    if (pts.some((p) => this.stations.some((s) => this.#onPlatformZone(s, p)))) problems.push('會壓到車站');
    const blocker = this.#blockedBy(pts, 0.75);
    if (blocker) problems.push(`會壓到${blocker}`);

    const props = this.scenery.query((x, z, r) => pts.some((p) => near(p, { x, z }, CLEAR_R + r * 0.6)));
    const cost = Math.round(length * COST.track) + props.reduce((s, p) => s + COST[p.kind], 0);
    if (!problems.length && cost > this.passengers.money) problems.push('資金不足');
    return { start, end, curve, length, props, cost, problems, ok: !problems.length };
  }

  // Feature modules (shops, homes...) register world.blockers: { label, hit(x, z, margin) }.
  #blockedBy(points, margin) {
    const b = this.world.blockers?.find((bl) => points.some((p) => bl.hit(p.x, p.z, margin)));
    return b?.label ?? null;
  }

  #onPlatformZone(s, p) {
    const local = s.group.worldToLocal(p.clone());
    const st = s.style;
    if (local.x > 0.4 && local.x < st.depth + 0.25 && Math.abs(local.z) < st.len / 2 + 0.2) return true;
    // A train shed's columns stand on the far side of the rails.
    return !!st.shed && local.x > -0.95 && local.x < -0.15 && Math.abs(local.z) < st.len / 2;
  }

  #previewTrack() {
    if (!this.pointer) return;
    const end = this.#snap(this.pointer);
    this.cursor.visible = true;
    this.cursor.position.set(end.pos.x, 0.06, end.pos.z);
    this.cursor.material.color.set(end.node || end.edge ? 0xffd34d : 0xffffff);
    if (!this.chain) {
      this.#drawGhostTrack(null);
      return this.#trackCard(end);
    }
    this.plan = this.#planSegment(this.chain, end);
    this.#drawGhostTrack(this.plan.curve, this.plan.ok);
    this.#trackCard(end);
  }

  #trackCard(end) {
    const actions = [];
    if (this.chain) actions.push({ label: '結束這段', run: () => this.#endChain() });
    actions.push({ label: '完成', run: () => this.setTool(null) });
    let info;
    if (!this.chain) {
      info = end?.node || end?.edge
        ? '點一下從這裡接出新的鐵路（黃圈代表接到現有軌道）。'
        : '點一下開始鋪設，再點下一個位置拉出一段鐵路，可以一直接下去。從現有軌道的端點或中間點出去就能分岔。';
    } else {
      const p = this.plan;
      info = p?.curve ? `這段 ${p.length.toFixed(1)} 公尺・費用 <b>${money(p.cost)}</b>${this.#clearText(p.props)}` : '';
      info += p?.ok ? '<br>點一下鋪設；右鍵或 Esc 結束這一段。' : `<br><span class="bad">${p?.problems.join('、') ?? ''}</span>`;
    }
    this.#card('鋪鐵路', info, actions);
  }

  #clearText(props) {
    if (!props?.length) return '';
    const counts = {};
    for (const p of props) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return `<br>需清除 ${Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join('、')}`;
  }

  #clickTrack() {
    const sn = this.#snap(this.pointer);
    if (!this.chain) {
      if (sn.edge?.reservedBy || sn.node?.reservedBy) return this.#card('鋪鐵路', '<span class="bad">列車正在使用這段軌道，等它開走再接。</span>');
      this.chain = sn;
      this.startMark.visible = true;
      this.startMark.position.set(sn.pos.x, 0.04, sn.pos.z);
      return this.#previewTrack();
    }
    const plan = this.#planSegment(this.chain, sn);
    if (!plan.ok) return;
    const edge = this.#commitSegment(plan, true);
    // Carry on from the free end; joining existing track ends the run.
    if (sn.node || sn.edge) this.#endChain();
    else {
      const node = edge.b;
      this.chain = { node, pos: node.pos.clone(), dir: edge.dirAt(node).negate() };
      this.startMark.position.set(node.pos.x, 0.04, node.pos.z);
      this.#previewTrack();
    }
  }

  #endChain() {
    this.chain = null;
    this.plan = null;
    this.startMark.visible = false;
    this.#drawGhostTrack(null);
    this.#trackCard();
  }

  #resolve(sn) {
    if (sn.node) return sn.node;
    if (sn.edge) return this.network.splitEdge(sn.edge, sn.t);
    return this.network.addNode(sn.pos);
  }

  #commitSegment(plan, pay) {
    const a = this.#resolve(plan.start);
    const b = this.#resolve(plan.end);
    const c = plan.curve;
    c.v0.copy(a.pos);
    c.v3.copy(b.pos);
    if (pay) {
      this.passengers.spend(plan.cost);
      this.#float(`-${money(plan.cost)}`, c.getPoint(0.5));
    }
    this.scenery.remove(plan.props);
    const edge = this.network.addEdge(a, b, c, plan.cost);
    this.#changed();
    return edge;
  }

  // ---------- Station tool ----------

  #planStation(p, styleKey = this.stationStyle) {
    const st = STATION_STYLES[styleKey];
    const ne = this.network.nearestEdge(p.x, p.z);
    if (!ne || ne.dist > 3.5) return null;
    const { edge, t, pos } = ne;
    const dir = edge.tangentAt(t);
    const side = (p.x - pos.x) * dir.z - (p.z - pos.z) * dir.x >= 0 ? 1 : -1;
    const g = this.stationGhosts[styleKey];
    placePlatform(g, pos, dir, side);
    g.updateMatrixWorld(true);
    const problems = [];
    const need = st.len + 0.4;
    if (edge.reservedBy) problems.push('列車正在使用這段軌道');
    const run = this.network.straightRun(edge, t, need / 2);
    if (!run) problems.push(`需要一段 ${Math.ceil(need)} 公尺以上、沒有分岔的鐵路`);
    else {
      const bend = Math.max(...run.map((q) => Math.abs((q.x - pos.x) * dir.z - (q.z - pos.z) * dir.x)));
      if (bend > 0.12) problems.push('這段鐵路不夠直');
    }
    if (this.stations.some((s) => s.node.pos.distanceTo(pos) < (s.len + st.len) / 2 + 1)) problems.push('離其他車站太近');
    const local = (q) => g.worldToLocal(q.clone());
    const inZone = (q) => {
      const l = local(q);
      if (l.x > 0.4 && l.x < st.depth + 0.3 && Math.abs(l.z) < st.len / 2 + 0.2) return true;
      return st.shed && l.x > -0.95 && l.x < -0.15 && Math.abs(l.z) < st.len / 2;
    };
    if ([...this.network.edges].some((e) => e.samples.some(inZone))) problems.push('會壓到鐵路');
    const corners = [];
    for (let z = -st.len / 2; z <= st.len / 2 + 1e-6; z += 0.6) for (const x of [-0.6, 0.4, st.px, st.back, st.depth]) corners.push(g.localToWorld(V(x, z)));
    const blocker = this.#blockedBy(corners, 0.1);
    if (blocker) problems.push(`會壓到${blocker}`);
    if (this.stations.some((s) => [[0.5, 0], [st.depth, -st.len / 2], [st.depth, st.len / 2], [st.depth, 0], [0.5, -st.len / 2], [0.5, st.len / 2]].some(([x, z]) => {
      const c = g.localToWorld(V(x, z));
      return s.contains(c.x, c.z, 0.2);
    }))) problems.push('會壓到其他車站');
    for (const [x, z] of [[st.depth + 0.4, -st.len / 2], [st.depth + 0.4, st.len / 2], [-0.6, -st.len / 2], [-0.6, st.len / 2]]) {
      const c = g.localToWorld(V(x, z));
      if (c.x * c.x + c.z * c.z > (ISLAND_R + 0.5) ** 2) {
        problems.push('超出島的範圍');
        break;
      }
    }
    if (this.stations.length >= MAX_STATIONS) problems.push(`最多 ${MAX_STATIONS} 個車站`);
    const props = this.scenery.query((x, z, r) => {
      const l = local(V(x, z));
      const m = r * 0.6 + 0.4;
      return l.x > -0.6 - m && l.x < st.depth + 0.2 + m && Math.abs(l.z) < st.len / 2 + 0.2 + m;
    });
    const cost = st.cost + props.reduce((s, q) => s + COST[q.kind], 0);
    if (!problems.length && cost > this.passengers.money) problems.push('資金不足');
    return { edge, t, pos, dir, side, style: styleKey, props, cost, problems, ok: !problems.length };
  }

  #styleActions() {
    return [
      ...Object.values(STATION_STYLES).map((st) => ({
        label: `${st.label} ${money(st.cost)}`,
        on: st.key === this.stationStyle,
        run: () => {
          this.stationStyle = st.key;
          for (const g of Object.values(this.stationGhosts)) g.visible = false;
          if (this.pointer) this.#previewStation();
          else this.#stationCard();
        },
      })),
      { label: '完成', primary: true, run: () => this.setTool(null) },
    ];
  }

  #stationCard(extra = '') {
    const st = STATION_STYLES[this.stationStyle];
    this.#card('蓋車站', `<b>${st.label}</b>：${st.desc}，月台 ${st.len} 公尺。<br>${extra || '移到鐵路旁，游標在哪一側就蓋在哪一側。'}`, this.#styleActions());
  }

  #previewStation() {
    if (this.firstTrainNote) return; // leave the free-train card up until dismissed
    for (const g of Object.values(this.stationGhosts)) g.visible = false;
    this.plan = this.#planStation(this.pointer);
    if (!this.plan) return this.#stationCard();
    this.stationGhosts[this.plan.style].visible = true;
    this.stationGhostMat.color.copy(this.plan.ok ? GOOD : BAD);
    this.stationGhostMat.emissive.set(this.plan.ok ? 0x1d5a35 : 0x6a1d1a);
    this.#stationCard(`${this.#nextName().name}・費用 <b>${money(this.plan.cost)}</b>${this.#clearText(this.plan.props)}` +
      (this.plan.ok ? '・點一下蓋在這裡' : `<br><span class="bad">${this.plan.problems.join('、')}</span>`));
  }

  #nextName() {
    const used = new Set(this.stations.map((s) => s.name));
    return STATION_NAMES.find((n) => !used.has(n.name)) ?? { name: `${this.stations.length + 1} 號站`, color: 0x888888 };
  }

  #clickStation() {
    if (!this.plan?.ok) return;
    this.firstTrainNote = null;
    this.#buildStation(this.plan, this.#nextName(), true);
    if (!this.firstTrainNote) this.#previewStation();
  }

  #buildStation(plan, def, pay) {
    if (pay) this.passengers.spend(plan.cost);
    this.scenery.remove(plan.props);
    const node = this.network.splitEdge(plan.edge, plan.t);
    const s = new Station(def, node, plan.dir, plan.side, plan.style);
    this.passengers.addStation(s);
    if (pay) this.#float(`-${money(plan.cost)}`, s.local(s.px, 1.2, 0));
    // Until the player plans lines, every new station joins the first one.
    if (!this.loading) {
      if (!this.lines.length) this.#newLine(true);
      const auto = this.lines.find((l) => l.auto);
      if (auto) {
        auto.stations.push(s);
        this.passengers.setLines(this.lines);
      }
    }
    this.#changed();
    return s;
  }

  // ---------- Lines and trains ----------

  #newLine(auto = false) {
    const used = new Set(this.lines.map((l) => l.color));
    const color = LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[this.lines.length % LINE_COLORS.length];
    const line = { name: `路線 ${this.lines.length + 1}`, color, stations: [], auto };
    this.lines.push(line);
    this.editing = line;
    return line;
  }

  #lineCard() {
    const actions = this.lines.map((l) => ({
      label: l.name,
      dot: l.color,
      on: l === this.editing,
      run: () => {
        this.editing = l;
        this.#lineCard();
      },
    }));
    actions.push({ label: '＋ 新路線', run: () => (this.#newLine(), this.#changed(), this.#lineCard()) });
    let info = '依序點車站排出路線，列車會照順序繞行，最後回到第一站；終點站會折返。';
    if (this.editing) {
      const names = this.editing.stations.map((s) => s.name);
      info += `<br><b class="line-name" style="color:#${new THREE.Color(this.editing.color).getHexString()}">${this.editing.name}</b>：${names.length ? names.join(' → ') : '還沒有車站'}`;
      if (names.length >= 2) info += ` → ${names[0]}`;
      actions.push({ label: '清空', run: () => this.#editLine((l) => (l.stations = [])) });
      if (this.editing.stations.length) actions.push({ label: '退一站', run: () => this.#editLine((l) => l.stations.pop()) });
    }
    actions.push({ label: '完成', primary: true, run: () => this.setTool(null) });
    this.#card('路線', info, actions);
  }

  #editLine(fn) {
    const l = this.editing;
    if (!l) return;
    fn(l);
    l.auto = false;
    this.passengers.setLines(this.lines);
    this.#changed();
    this.#lineCard();
  }

  #stationAt(p, margin = 0.3) {
    return this.stations.find((s) => s.contains(p.x, p.z, margin));
  }

  #previewLine() {
    this.#unhighlight();
    const s = this.#stationAt(this.pointer, 0.6);
    if (s) {
      this.hot = { station: s };
      s.highlight(0x1d4a7a);
    }
  }

  #clickLine() {
    const s = this.#stationAt(this.pointer, 0.6);
    if (!s) return;
    if (!this.editing) this.#newLine();
    if (this.editing.stations[this.editing.stations.length - 1] === s) return;
    this.#editLine((l) => l.stations.push(s));
  }

  buyTrain(line, free = false) {
    if (this.trains.length >= MAX_TRAINS) return this.#toast(`最多 ${MAX_TRAINS} 台列車`);
    if (line.stations.length < 2) return this.#toast('路線至少要有兩個車站');
    if (!free && !this.passengers.spend(COST.train)) return this.#toast(`買一台列車要 ${money(COST.train)}，資金不足`);
    const t = new Train(this.scene, this.network, this.newType);
    t.line = line;
    this.passengers.addTrain(t);
    if (this.passengers.placeTrain(t) && !free) this.#float(`-${money(COST.train)}`, t.position.clone().setY(1.2));
    this.#changed();
    return t;
  }

  sellTrain(t) {
    if (this.selected === t) this.select(null);
    this.passengers.removeTrain(t);
    this.passengers.earn(COST.train / 2);
    this.#changed();
  }

  // ---------- Demolish tool ----------

  #unhighlight() {
    if (this.hot?.station) this.hot.station.highlight(null);
    this.#clear(this.hotTrack);
    this.hot = null;
  }

  #previewDemolish() {
    const g = this.pointer;
    this.#unhighlight();
    const station = this.#stationAt(g, 0.05);
    if (station) {
      this.hot = { station };
      station.highlight(0x8a1a12);
      return this.#card('拆除', `拆除${station.name}，退回 ${money(COST.station / 2)}。`);
    }
    const ne = this.network.nearestEdge(g.x, g.z);
    if (ne && ne.dist < 0.6) {
      this.hot = { edge: ne.edge };
      const m = new THREE.Mesh(ribbon(ne.edge.samples, 0.8, 0, 0.16), this.hotMat);
      m.renderOrder = 6;
      this.hotTrack.add(m);
      return this.#card('拆除', `拆除這段 ${ne.edge.length.toFixed(1)} 公尺的鐵路，退回 ${money(ne.edge.cost / 2)}。`);
    }
    this.#card('拆除', '點一段鐵路或一個車站把它拆掉，退回一半的建造費。');
  }

  #clickDemolish() {
    const hot = this.hot;
    if (!hot) return;
    if (hot.station) {
      if (!this.#removeStation(hot.station)) return this.#card('拆除', '<span class="bad">列車正停在這個車站，等它開走再拆。</span>');
    } else {
      const e = hot.edge;
      if (e.reservedBy) return this.#card('拆除', '<span class="bad">列車正在使用或即將經過這段鐵路，等它開走再拆。</span>');
      this.#unhighlight();
      const at = e.pointAt(e.length / 2);
      this.network.removeEdge(e);
      this.passengers.earn(e.cost / 2);
      this.#float(`+${money(e.cost / 2)}`, at.setY(1), '#4a90c8');
      // A station left with no track at all goes too.
      for (const s of [...this.stations]) if (!s.node.edges.length) this.#removeStation(s);
    }
    this.#unhighlight();
    this.#changed();
    this.#previewDemolish();
  }

  #removeStation(s) {
    const at = s.local(s.px, 1.2, 0);
    for (const l of this.lines) l.stations = l.stations.filter((x) => x !== s);
    this.passengers.setLines(this.lines);
    if (!this.passengers.removeStation(s)) return false;
    if (!s.node.edges.length) this.network.nodes.delete(s.node);
    this.passengers.earn(COST.station / 2);
    this.#float(`+${money(COST.station / 2)}`, at, '#4a90c8');
    if (this.hot?.station === s) this.hot = null;
    return true;
  }

  // ---------- Picking trains and robots ----------

  #pick(e) {
    this.raycaster.setFromCamera(this.#ndc(e), this.camera);
    straightenRay(this.raycaster.ray);
    const targets = [];
    for (const t of this.trains) for (const v of t.vehicles) targets.push([v.group, t]);
    for (const r of this.passengers.robots) targets.push([r.mesh, r]);
    let hit = null;
    for (const [obj, owner] of targets) {
      const h = this.raycaster.intersectObject(obj, true)[0];
      if (h && (!hit || h.distance < hit.distance)) hit = { distance: h.distance, owner };
    }
    this.select(hit?.owner ?? null);
  }

  select(x) {
    this.selected = x;
    this.renderInfo();
  }

  // Info card for the selected train or robot; refreshed by main.
  renderInfo() {
    const { info } = this.ui;
    const x = this.selected;
    if (!x || (x instanceof Train && !this.trains.includes(x))) {
      info.hidden = true;
      this.selected = null;
      return;
    }
    info.hidden = false;
    if (x instanceof Train) {
      const key = `t${x.no}${x.state}${x.type}${x.carCount}${x.onboard.length}${x.waitReason}${x.line?.name}`;
      if (info.dataset.key === key) return;
      info.dataset.key = key;
      const stopped = x.state === 'dwell';
      info.innerHTML = `
        <div class="info-title"><span class="dot" style="background:#${new THREE.Color(x.line?.color ?? 0x999999).getHexString()}"></span>${x.name}<small>${x.line?.name ?? ''}</small></div>
        <div class="info-row">${this.passengers.trainStatus(x)}</div>
        <div class="info-row">乘客 ${x.onboard.length} / ${x.capacity}・${x.carCount} 節</div>
        <div class="row seg info-types">${Object.entries(TRAIN_TYPES).map(([k, t]) => `<button data-type="${k}" class="${k === x.type ? 'on' : ''}" ${stopped ? '' : 'disabled'}>${t.label}</button>`).join('')}</div>
        <div class="row"><button data-act="add" ${stopped ? '' : 'disabled'}>＋ 車廂</button><button data-act="remove" ${stopped ? '' : 'disabled'}>－ 車廂</button></div>
        <div class="row"><button data-act="follow">🎥 跟隨</button><button data-act="sell">賣掉（退 ${money(COST.train / 2)}）</button></div>
        ${stopped ? '' : '<div class="hint">列車停靠時可以換車種、加減車廂</div>'}`;
      info.querySelectorAll('[data-type]').forEach((b) =>
        b.addEventListener('click', () => {
          x.setType(b.dataset.type);
          this.passengers.reseat(x);
          this.#changed();
          this.renderInfo();
        }),
      );
      info.querySelector('[data-act="add"]').addEventListener('click', () => (x.addCar(), this.passengers.reseat(x), this.renderInfo()));
      info.querySelector('[data-act="remove"]').addEventListener('click', () => (x.removeCar(), this.passengers.reseat(x), this.renderInfo()));
      info.querySelector('[data-act="follow"]').addEventListener('click', () => this.ui.onFollow?.(x));
      info.querySelector('[data-act="sell"]').addEventListener('click', () => this.sellTrain(x));
    } else {
      const P = x.personality;
      const doing = {
        strolling: '散步中',
        returning: `走去${x.target?.name ?? '車站'}`,
        waiting: `在${x.origin?.name ?? '月台'}等車，要去${x.dest?.name ?? ''}`,
        riding: `搭車中，要去${x.dest?.name ?? ''}`,
        leaving: '剛下車',
      }[x.state] ?? '閒晃中';
      const key = `r${x.name}${doing}`;
      if (info.dataset.key === key) return;
      info.dataset.key = key;
      info.innerHTML = `
        <div class="info-title">${x.name}<small>${P ? P.label : ''}</small></div>
        ${P ? `<div class="info-row muted-row">${P.desc}</div>` : ''}
        <div class="info-row">${doing}</div>
        ${x.itemLabel ? `<div class="info-row">隨身物品：${x.itemLabel}</div>` : ''}`;
    }
  }

  // ---------- Quick start ----------

  quickStart() {
    if (this.network.edges.size) return;
    const steps = [];
    const run = (points, closeTo = null) => {
      let chain = { pos: V(...points[0]) };
      for (let i = 1; i < points.length; i++) {
        const end = { pos: V(...points[i]) };
        const plan = this.#planSegment(chain, end);
        if (!plan.ok) throw new Error(`demo ${i}: ${plan.problems}`);
        const edge = this.#commitSegment(plan, true);
        steps.push(plan.cost);
        chain = { node: edge.b, pos: edge.b.pos.clone(), dir: edge.dirAt(edge.b).negate() };
      }
      if (closeTo) {
        const plan = this.#planSegment(chain, this.#snap(V(...closeTo)));
        if (!plan.ok) throw new Error(`demo close: ${plan.problems}`);
        this.#commitSegment(plan, true);
        steps.push(plan.cost);
      }
    };
    const station = (style, sx, sz) => {
      const plan = this.#planStation(V(sx, sz), style);
      if (!plan?.ok) throw new Error(`demo station ${style} ${sx},${sz}: ${plan?.problems}`);
      steps.push(plan.cost);
      return this.#buildStation(plan, this.#nextName(), true);
    };
    // The demo is a gift: building it costs nothing.
    const funds = this.passengers.money;
    this.passengers.money = Infinity;
    this.gift = true;
    try {
      this.loading = true; // no automatic line while laying out
      this.setTool(null);
      run([[14, -8], [14, 8], [10, 12], [-10, 12], [-14, 8], [-14, -8], [-10, -12], [10, -12]], [14, -8]);
      // A branch line off the west side to a terminus inside the loop.
      const p1 = this.#planSegment(this.#snap(V(-14, 3)), { pos: V(-10, -1) });
      if (!p1.ok) throw new Error(`demo branch: ${p1.problems}`);
      run2.call(this, this.#commitSegment(p1, true), [6, -1]);
      const a = station('town', 15.2, 0);
      const b = station('grand', 0, 13.2);
      const c = station('town', 0, -13.2);
      const d = station('halt', -2, -2.2);
      this.loading = false;
      this.lines = [];
      const l1 = this.#newLine();
      l1.stations = [a, b, c];
      const l2 = this.#newLine();
      l2.stations = [b, d];
      this.passengers.setLines(this.lines);
      this.newType = 'steam';
      this.buyTrain(l1);
      this.newType = 'tram';
      this.buyTrain(l2);
      this.newType = 'steam';
      this.#card('範例路線', '已經蓋好一條環線、一條支線和 4 個車站，兩條路線各有一台列車。號誌會讓它們輪流通過共用的軌道。', [
        { label: '好', primary: true, run: () => this.#card(null) },
      ]);
    } catch (err) {
      console.warn(err);
      this.loading = false;
    }
    this.passengers.money = funds;
    this.gift = false;
    this.passengers.earn(0);
    this.#changed();
    function run2(edge, to) {
      const chain = { node: edge.b, pos: edge.b.pos.clone(), dir: edge.dirAt(edge.b).negate() };
      const plan = this.#planSegment(chain, { pos: V(...to) });
      if (!plan.ok) throw new Error(`demo branch 2: ${plan.problems}`);
      this.#commitSegment(plan, true);
    }
  }

  // ---------- Save / load (this browser only) ----------

  save() {
    if (this.loading) return;
    const net = this.network.serialize();
    const sIndex = new Map(this.stations.map((s, i) => [s, i]));
    const data = {
      network: { nodes: net.nodes, edges: net.edges },
      stations: this.stations.map((s) => ({ node: net.index.get(s.node), dir: [s.dir.x, s.dir.z], side: s.side, name: s.name, style: s.style.key })),
      lines: this.lines.map((l) => ({ name: l.name, color: l.color, auto: l.auto, stations: l.stations.map((s) => sIndex.get(s)) })),
      trains: this.trains.map((t) => ({ line: this.lines.indexOf(t.line), type: t.type, mids: t.mids.length })),
      money: this.passengers.money,
      gaveTrain: !!this.gaveTrain,
      delivered: this.passengers.delivered,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
  }

  load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch {}
    if (!data?.network) return false;
    this.loading = true;
    try {
      const nodes = this.network.load(data.network);
      // Clear scenery under the saved track and stations.
      for (const e of this.network.edges) {
        this.scenery.remove(this.scenery.query((x, z, r) => e.samples.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (CLEAR_R + r * 0.6) ** 2)));
      }
      const stations = (data.stations ?? []).map((st) => {
        const def = STATION_NAMES.find((n) => n.name === st.name) ?? this.#nextName();
        const s = new Station(def, nodes[st.node], V(st.dir[0], st.dir[1]), st.side, st.style ?? 'halt');
        this.scenery.remove(this.scenery.query((x, z, r) => s.contains(x, z, r * 0.6 + 0.4)));
        this.passengers.addStation(s);
        return s;
      });
      this.lines = (data.lines ?? []).map((l) => ({ name: l.name, color: l.color, auto: l.auto, stations: l.stations.map((i) => stations[i]).filter(Boolean) }));
      this.editing = this.lines[0] ?? null;
      this.passengers.setLines(this.lines);
      if (Number.isFinite(data.money)) this.passengers.money = data.money;
      this.gaveTrain = !!data.gaveTrain;
      if (Number.isFinite(data.delivered)) this.passengers.delivered = data.delivered;
      for (const td of data.trains ?? []) {
        const line = this.lines[td.line];
        if (!line) continue;
        const t = new Train(this.scene, this.network, td.type in TRAIN_TYPES ? td.type : 'steam');
        while (t.mids.length < td.mids) t.addCar();
        while (t.mids.length > td.mids) t.removeCar();
        t.line = line;
        this.passengers.addTrain(t);
        this.passengers.placeTrain(t);
      }
    } catch (err) {
      console.warn('Could not load the saved game', err);
    }
    this.loading = false;
    this.#changed();
    return true;
  }

  reset() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {}
    this.loading = true; // don't write the old game back on unload
    location.reload();
  }

  // ---------- UI ----------

  #bindUI() {
    const { tools, quick } = this.ui;
    for (const b of tools.querySelectorAll('[data-tool]')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    quick.addEventListener('click', () => this.quickStart());
    this.#refreshTools();
    this.#renderLines();
  }

  #refreshTools() {
    const { tools, quick } = this.ui;
    for (const b of tools.querySelectorAll('[data-tool]')) {
      b.classList.toggle('on', b.dataset.tool === this.tool);
      b.classList.toggle('dim', (b.dataset.tool === 'station' || b.dataset.tool === 'line') && !this.network.edges.size);
    }
    quick.hidden = this.network.edges.size > 0;
  }

  // Lines and their trains in the side panel.
  #renderLines() {
    const el = this.ui.lines;
    if (!el) return;
    if (!this.lines.length) {
      el.innerHTML = '<div class="hint">蓋好車站後，用「路線」把它們串起來，再加開列車。</div>';
      return;
    }
    el.replaceChildren(
      ...this.lines.map((l) => {
        const row = document.createElement('div');
        row.className = 'line-row';
        const n = this.trains.filter((t) => t.line === l).length;
        row.innerHTML = `<span class="dot" style="background:#${new THREE.Color(l.color).getHexString()}"></span>
          <span class="line-stops"><b>${l.name}</b>${l.stations.map((s) => s.name.replace('站', '')).join('→') || '還沒有車站'}</span>
          <span class="line-count">${n} 台</span>`;
        const add = document.createElement('button');
        add.className = 'mini';
        add.textContent = '＋';
        add.title = `加開列車（${money(COST.train)}）`;
        add.addEventListener('click', () => this.buyTrain(l));
        const sub = document.createElement('button');
        sub.className = 'mini';
        sub.textContent = '－';
        sub.title = '賣掉一台';
        sub.disabled = !n;
        sub.addEventListener('click', () => {
          const t = [...this.trains].reverse().find((x) => x.line === l);
          if (t) this.sellTrain(t);
        });
        row.append(sub, add);
        return row;
      }),
    );
  }

  #card(title, html, actions = []) {
    const { card, cardTitle, cardInfo, cardActions } = this.ui;
    card.hidden = !title;
    if (!title) return;
    cardTitle.textContent = title;
    cardInfo.innerHTML = html;
    cardActions.replaceChildren(
      ...actions.map((a) => {
        const b = document.createElement('button');
        b.textContent = a.label;
        if (a.primary) b.classList.add('primary');
        if (a.on) b.classList.add('on');
        if (a.dot !== undefined) b.style.setProperty('--dot', `#${new THREE.Color(a.dot).getHexString()}`), b.classList.add('has-dot');
        b.addEventListener('click', a.run);
        return b;
      }),
    );
  }

  // For feature modules: a floating price tag, and extra toolbar buttons.
  floatText(text, at, color) {
    this.#float(text, at, color);
  }

  addTool({ id, icon, label, onSelect }) {
    const b = document.createElement('button');
    b.dataset.extTool = id;
    b.innerHTML = `<i>${icon}</i>${label}`;
    b.addEventListener('click', () => {
      this.setTool(null);
      onSelect?.(b);
    });
    this.ui.tools.insertBefore(b, this.ui.quick);
    return b;
  }

  #toast(text) {
    this.#card('提示', `<span class="bad">${text}</span>`, [{ label: '知道了', run: () => this.#card(null) }]);
    return null;
  }

  #float(text, at, color = '#e0533f') {
    if (this.gift) return;
    const f = new FloatText(text, color);
    f.sprite.position.copy(at).add(new THREE.Vector3(0, 0.8, 0));
    f.sprite.scale.multiplyScalar(1.6);
    this.passengers.addFloater(f);
  }
}
