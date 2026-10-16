import * as THREE from 'three';
import { Track } from './track.js';
import {
  FloatText,
  PLATFORM_LEN,
  PLATFORM_X,
  STATION_NAMES,
  Station,
  makePlatform,
  placePlatform,
  platformContains,
} from './stations.js';

// Prices. Building on occupied ground also pays to clear what stands there.
export const COST = { track: 12, station: 600, tree: 15, house: 150, rock: 5 };
const KIND_LABEL = { tree: '棵樹', house: '間房子', rock: '顆石頭' };

const SNAP = 0.5;
const ISLAND_R = 22;
const MIN_RADIUS = 2.2; // tightest curve the longest cars can take
const TRACK_GAP = 1.5; // closest two parts of the loop may come to each other
const CLEAR_R = 0.75;
const MAX_STATIONS = 8;
const SAVE_KEY = 'ttdSave1';

// The layout the first prototype shipped with, offered as a quick start.
const DEMO = {
  points: [[10, -6], [10, 6], [6, 10.6], [-6, 10.6], [-12, 5], [-12, -5], [-6, -10.5], [6, -10.5]],
  stations: [[10, 0], [0, 10.6], [0, -10.5]],
};
const CORNER_R = 4; // preferred curve radius at each corner

// Turn the player's corner points into a loop of straight runs joined by
// circular curves, sampled densely. Corners get CORNER_R where the straights
// are long enough, tighter otherwise.
function roundLoop(pts) {
  const n = pts.length;
  const out = [];
  let minR = Infinity;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const p = pts[i];
    const next = pts[(i + 1) % n];
    const a = new THREE.Vector3().subVectors(p, prev);
    const b = new THREE.Vector3().subVectors(next, p);
    const la = a.length();
    const lb = b.length();
    a.normalize();
    b.normalize();
    const turn = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    if (turn < 0.01 || turn > Math.PI - 0.05) {
      if (turn > 1) minR = 0; // doubles straight back on itself
      out.push(p.clone());
      continue;
    }
    const tanHalf = Math.tan(turn / 2);
    const t = Math.min(CORNER_R * tanHalf, la / 2, lb / 2);
    const R = t / tanHalf;
    minR = Math.min(minR, R);
    const start = p.clone().addScaledVector(a, -t);
    const end = p.clone().addScaledVector(b, t);
    const normal = b.clone().addScaledVector(a, -a.dot(b)).normalize(); // toward the inside of the turn
    const center = start.clone().addScaledVector(normal, R);
    const from = Math.atan2(start.z - center.z, start.x - center.x);
    const to = Math.atan2(end.z - center.z, end.x - center.x);
    const sweep = THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) * R) / 0.25));
    for (let k = 0; k <= steps; k++) {
      const ang = from + sweep * (k / steps);
      out.push(new THREE.Vector3(center.x + Math.cos(ang) * R, 0, center.z + Math.sin(ang) * R));
    }
  }
  // Fill long straights so the spline through these points stays straight.
  const dense = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const q = out[(i + 1) % out.length];
    const len = p.distanceTo(q);
    if (len < 1e-3) continue;
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k < steps; k++) dense.push(p.clone().lerp(q, k / steps));
  }
  return { dense, minR };
}

const UP = new THREE.Vector3(0, 1, 0);
const money = (n) => `$${Math.round(n).toLocaleString()}`;

// A flat strip following closed loop `pts`, `offset` to the side of it.
function ribbon(pts, width, offset, y) {
  const n = pts.length;
  const pos = new Float32Array((n + 1) * 6);
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n];
    t.subVectors(pts[(i + 1) % n], pts[(i - 1 + n) % n]).normalize();
    side.crossVectors(t, UP).normalize();
    const a = offset - width / 2;
    const b = offset + width / 2;
    pos.set([p.x + side.x * a, y, p.z + side.z * a, p.x + side.x * b, y, p.z + side.z * b], i * 6);
    if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

const GOOD = new THREE.Color(0x4cc47a);
const BAD = new THREE.Color(0xf0605a);

export class BuildController {
  constructor({ scene, camera, dom, passengers, world, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.passengers = passengers;
    this.scenery = world.scenery;
    this.ui = ui;
    this.tool = null;
    this.points = [];
    this.track = null;
    this.trackCost = 0;
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
    for (const fn of this.listeners) fn(this);
    this.#refreshTools();
    this.save();
  }

  get stations() {
    return this.passengers.stations;
  }

  // ---------- Ghost previews ----------

  #makeGhosts() {
    const ghost = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.bedMat = ghost(GOOD, 0.45);
    this.railMat = ghost(0xffffff, 0.9);
    this.ghostTrack = new THREE.Group();
    this.ghostTrack.renderOrder = 5;
    this.scene.add(this.ghostTrack);

    this.markerGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20);
    this.markerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    this.startMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.4, emissive: 0x6b4a00 });
    this.markers = new THREE.Group();
    this.scene.add(this.markers);

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.cursor.renderOrder = 6;
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    // Station ghost: a real platform model drawn in translucent green/red.
    this.stationGhostMat = new THREE.MeshStandardMaterial({
      color: GOOD,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      emissive: 0x1d5a35,
    });
    this.stationGhost = makePlatform(0xffffff);
    this.stationGhost.traverse((o) => {
      if (o.isMesh) {
        o.material = this.stationGhostMat;
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.stationGhost.visible = false;
    this.scene.add(this.stationGhost);
  }

  #clearGhostTrack() {
    for (const m of this.ghostTrack.children) m.geometry.dispose();
    this.ghostTrack.clear();
  }

  #drawGhostTrack(samples, ok) {
    this.#clearGhostTrack();
    if (!samples) return;
    this.bedMat.color.copy(ok ? GOOD : BAD);
    this.ghostTrack.add(new THREE.Mesh(ribbon(samples, 0.7, 0, 0.04), this.bedMat));
    for (const s of [-0.25, 0.25]) this.ghostTrack.add(new THREE.Mesh(ribbon(samples, 0.06, s, 0.06), this.railMat));
    for (const m of this.ghostTrack.children) m.renderOrder = 5;
  }

  #drawMarkers(hoverStart) {
    this.markers.clear();
    this.points.forEach((p, i) => {
      const m = new THREE.Mesh(this.markerGeo, i === 0 ? this.startMat : this.markerMat);
      m.position.set(p.x, 0.04, p.z);
      if (i === 0) m.scale.setScalar(hoverStart ? 1.7 : 1.25);
      this.markers.add(m);
    });
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
      if (!d || !this.tool || d.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // that was a camera drag
      this.#hover(e);
      this.#click();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.tool) return;
      if (e.key === 'Escape') this.setTool(null);
      if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') this.#undo();
    });
  }

  #groundAt(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  #hover(e) {
    const g = this.#groundAt(e);
    if (!g) return;
    this.pointer = g;
    if (this.tool === 'track') this.#previewTrack();
    else if (this.tool === 'station') this.#previewStation();
    else if (this.tool === 'demolish') this.#previewDemolish();
  }

  #click() {
    if (this.tool === 'track') this.#clickTrack();
    else if (this.tool === 'station') this.#clickStation();
    else if (this.tool === 'demolish') this.#clickDemolish();
  }

  setTool(tool) {
    if (this.tool === tool) tool = null;
    this.tool = tool;
    this.points = [];
    this.plan = null;
    this.#clearGhostTrack();
    this.markers.clear();
    this.cursor.visible = false;
    this.stationGhost.visible = false;
    this.#unhighlight();
    this.#refreshTools();
    if (tool === 'track') {
      if (this.track) {
        this.tool = null;
        this.#refreshTools();
        return this.#card('鋪鐵路', '島上已經有一條環線了。目前一次經營一條路線，可以用「拆除」把它移除後重新設計。', [
          { label: '知道了', run: () => this.#card(null) },
        ]);
      }
      this.#previewTrack();
    } else if (tool === 'station') {
      if (!this.track) {
        this.tool = null;
        this.#refreshTools();
        return this.#card('蓋車站', '車站要蓋在鐵路旁，先用「鐵路」鋪一條環線吧。', [{ label: '知道了', run: () => this.#card(null) }]);
      }
      this.#card('蓋車站', '把滑鼠移到鐵路旁，選擇要蓋在鐵路的哪一側，點一下就能蓋。車站需要一段平直的鐵路。');
    } else if (tool === 'demolish') {
      this.#card('拆除', '點車站可以拆掉它，點鐵路會拆掉整條環線（連同車站）。拆除會退回一半的建造費。');
    } else this.#card(null);
  }

  // ---------- Track tool ----------

  #snapped() {
    const p = this.pointer;
    return p && new THREE.Vector3(Math.round(p.x / SNAP) * SNAP, 0, Math.round(p.z / SNAP) * SNAP);
  }

  #nearStart(p) {
    return this.points.length >= 3 && p && p.distanceTo(this.points[0]) < 0.9;
  }

  // Lay out and price a closed loop through `pts`.
  #planTrack(pts) {
    if (pts.length < 3) return null;
    const { dense, minR } = roundLoop(pts);
    const curve = new THREE.CatmullRomCurve3(dense, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = dense.length * 8;
    const length = curve.getLength();
    const n = Math.max(24, Math.ceil(length / 0.25));
    const samples = curve.getSpacedPoints(n).slice(0, n);
    const ds = length / n;
    const problems = [];

    if (minR < MIN_RADIUS) problems.push('彎道太急，把點拉開一點');

    if (samples.some((p) => p.x * p.x + p.z * p.z > ISLAND_R * ISLAND_R)) problems.push('超出島的範圍');

    const skip = Math.ceil(4 / ds);
    let tooClose = false;
    for (let i = 0; i < n && !tooClose; i += 2) {
      for (let j = i + skip; j <= i + n - skip; j += 2) {
        const p = samples[i];
        const q = samples[j % n];
        if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < TRACK_GAP * TRACK_GAP) {
          tooClose = true;
          break;
        }
      }
    }
    if (tooClose) problems.push('鐵路交叉或靠得太近');

    const props = this.scenery.query((x, z, r) => {
      const rr = (CLEAR_R + r * 0.6) ** 2;
      return samples.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < rr);
    });
    const cost = Math.round(length * COST.track) + props.reduce((sum, p) => sum + COST[p.kind], 0);
    if (!problems.length && cost > this.passengers.money) problems.push('資金不足');
    return { pts, dense, curve, length, samples, props, cost, problems, ok: !problems.length };
  }

  #previewTrack() {
    const cursor = this.#snapped();
    const closing = this.#nearStart(cursor);
    const pts = closing || !cursor ? [...this.points] : [...this.points, cursor];
    this.plan = this.#planTrack(pts);
    this.#drawGhostTrack(this.plan?.samples, this.plan?.ok);
    this.#drawMarkers(closing);
    if (cursor) {
      this.cursor.visible = true;
      this.cursor.position.set(cursor.x, 0.05, cursor.z);
      this.cursor.material.color.set(closing ? 0xffd34d : 0xffffff);
    }
    this.#trackCard(closing);
  }

  #trackCard(closing) {
    const actions = [];
    if (this.points.length) actions.push({ label: '復原', run: () => this.#undo() });
    actions.push({ label: '取消', run: () => this.setTool(null) });
    if (this.points.length >= 3) actions.push({ label: '完成環線', primary: true, run: () => this.#finishTrack() });
    let info;
    if (this.points.length < 3) {
      info = `在地上點出路線的轉折點（已放 ${this.points.length} 個），至少 3 個點會自動連成一圈。拖曳可以轉動視角。`;
    } else {
      const p = this.plan;
      info = `長度 ${p.length.toFixed(0)} 公尺・費用 <b>${money(p.cost)}</b>${this.#clearText(p.props)}`;
      info += p.ok ? `<br>${closing ? '點黃色起點就能完成。' : '繼續加點，或按「完成環線」。'}` : `<br><span class="bad">${p.problems.join('、')}</span>`;
    }
    this.#card('鋪鐵路', info, actions);
  }

  #clearText(props) {
    if (!props.length) return '';
    const counts = {};
    for (const p of props) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    return `<br>需清除 ${Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join('、')}`;
  }

  #clickTrack() {
    const p = this.#snapped();
    if (!p) return;
    if (this.#nearStart(p)) return this.#finishTrack();
    const last = this.points[this.points.length - 1];
    if (last && last.distanceTo(p) < 0.4) return;
    this.points.push(p);
    this.#previewTrack();
  }

  #undo() {
    if (this.tool !== 'track' || !this.points.length) return;
    this.points.pop();
    this.#previewTrack();
  }

  #finishTrack() {
    const plan = this.#planTrack([...this.points]);
    if (!plan?.ok) {
      this.plan = plan;
      return this.#trackCard(false);
    }
    this.#buildTrack(plan, true);
    this.setTool(null);
    this.#card('鋪鐵路', `環線完成了！花費 ${money(plan.cost)}。接著用「車站」在鐵路旁蓋至少兩個車站。`, [
      { label: '蓋車站', primary: true, run: () => this.setTool('station') },
    ]);
  }

  #buildTrack(plan, pay) {
    if (pay) {
      this.passengers.spend(plan.cost);
      this.#float(`-${money(plan.cost)}`, plan.samples[0]);
    }
    this.scenery.remove(plan.props);
    this.track = new Track(plan.dense);
    this.track.corners = plan.pts.map((p) => p.clone());
    this.trackCost = plan.cost;
    this.scene.add(this.track.group);
    this.passengers.setTrack(this.track);
    this.#changed();
  }

  // ---------- Station tool ----------

  #planStation(d, side) {
    const track = this.track;
    const g = this.stationGhost;
    placePlatform(g, track, d, side);
    g.updateMatrixWorld(true);
    const problems = [];

    const half = PLATFORM_LEN / 2;
    const a = track.pointAt(d - half);
    const b = track.pointAt(d + half);
    const chord = new THREE.Line3(a, b);
    const tmp = new THREE.Vector3();
    let bend = 0;
    for (let k = -half; k <= half; k += 0.5) {
      const p = track.pointAt(d + k);
      bend = Math.max(bend, chord.closestPointToPoint(p, true, tmp).distanceTo(p));
    }
    if (bend > 0.15) problems.push('這段鐵路不夠直');

    const L = track.length;
    const gap = (x) => Math.abs(THREE.MathUtils.euclideanModulo(x - d + L / 2, L) - L / 2);
    if (this.stations.some((s) => gap(s.d) < PLATFORM_LEN + 0.6)) problems.push('離其他車站太近');

    const n = track.samples.length;
    if (track.samples.some((p, i) => gap((i / n) * L) > half + 0.6 && platformContains(g, p.x, p.z, 0.3))) {
      problems.push('會壓到鐵路');
    }
    for (const z of [-half, half]) {
      const c = g.localToWorld(new THREE.Vector3(PLATFORM_X + 1.6, 0, z));
      if (c.x * c.x + c.z * c.z > (ISLAND_R + 0.5) ** 2) {
        problems.push('超出島的範圍');
        break;
      }
    }
    if (this.stations.length >= MAX_STATIONS) problems.push(`最多 ${MAX_STATIONS} 個車站`);

    const props = this.scenery.query((x, z, r) => platformContains(g, x, z, r * 0.6 + 0.5));
    const cost = COST.station + props.reduce((sum, p) => sum + COST[p.kind], 0);
    if (!problems.length && cost > this.passengers.money) problems.push('資金不足');
    return { d, side, props, cost, problems, ok: !problems.length };
  }

  #previewStation() {
    const g = this.pointer;
    const { d, dist } = this.track.nearest(g.x, g.z);
    if (dist > 3.5) {
      this.stationGhost.visible = false;
      this.plan = null;
      return this.#card('蓋車站', '把滑鼠移到鐵路旁，選擇要蓋在鐵路的哪一側，點一下就能蓋。車站需要一段平直的鐵路。');
    }
    const p = this.track.pointAt(d);
    const t = this.track.tangentAt(d);
    const side = (g.x - p.x) * t.z - (g.z - p.z) * t.x >= 0 ? 1 : -1;
    this.plan = this.#planStation(d, side);
    this.stationGhost.visible = true;
    this.stationGhostMat.color.copy(this.plan.ok ? GOOD : BAD);
    this.stationGhostMat.emissive.set(this.plan.ok ? 0x1d5a35 : 0x6a1d1a);
    const name = this.#nextName().name;
    const info = `${name}・費用 <b>${money(this.plan.cost)}</b>${this.#clearText(this.plan.props)}` +
      (this.plan.ok ? '<br>點一下蓋在這裡。' : `<br><span class="bad">${this.plan.problems.join('、')}</span>`);
    this.#card('蓋車站', info, [{ label: '完成', run: () => this.setTool(null) }]);
  }

  #nextName() {
    const used = new Set(this.stations.map((s) => s.name));
    return STATION_NAMES.find((n) => !used.has(n.name)) ?? STATION_NAMES[this.stations.length % STATION_NAMES.length];
  }

  #clickStation() {
    const plan = this.plan;
    if (!plan?.ok) return;
    this.#buildStation(plan, this.#nextName(), true);
    this.#previewStation();
  }

  #buildStation(plan, def, pay) {
    if (pay) this.passengers.spend(plan.cost);
    this.scenery.remove(plan.props);
    const s = new Station(def, this.track, plan.d, plan.side);
    this.passengers.addStation(s);
    if (pay) this.#float(`-${money(plan.cost)}`, s.local(PLATFORM_X, 1.2, 0));
    this.#changed();
    return s;
  }

  // ---------- Demolish tool ----------

  #unhighlight() {
    if (this.hot?.station) this.hot.station.highlight(null);
    if (this.hot?.track) this.#tintTrack(null);
    this.hot = null;
  }

  #tintTrack(color) {
    this.track?.group.traverse((o) => {
      if (o.isMesh) o.material.emissive?.set(color ?? 0x000000);
    });
  }

  #refund() {
    return Math.round(this.trackCost / 2 + (this.stations.length * COST.station) / 2);
  }

  #previewDemolish() {
    const g = this.pointer;
    this.#unhighlight();
    const station = this.stations.find((s) => s.contains(g.x, g.z, 0.05));
    if (station) {
      this.hot = { station };
      station.highlight(0x8a1a12);
      return this.#card('拆除', `拆除${station.name}，退回 ${money(COST.station / 2)}。`);
    }
    if (this.track && this.track.nearest(g.x, g.z).dist < 0.6) {
      this.hot = { track: true };
      this.#tintTrack(0x8a1a12);
      const n = this.stations.length;
      return this.#card('拆除', `拆除整條環線${n ? `和 ${n} 個車站` : ''}，退回 ${money(this.#refund())}。`);
    }
    this.#card('拆除', '點車站可以拆掉它，點鐵路會拆掉整條環線（連同車站）。拆除會退回一半的建造費。');
  }

  #clickDemolish() {
    const hot = this.hot;
    if (!hot) return;
    if (this.passengers.busy) {
      return this.#card('拆除', '<span class="bad">列車正在停靠上下客，等它開走再拆。</span>');
    }
    this.#unhighlight();
    if (hot.station) {
      const at = hot.station.local(PLATFORM_X, 1.2, 0);
      this.passengers.removeStation(hot.station);
      this.passengers.earn(COST.station / 2);
      this.#float(`+${money(COST.station / 2)}`, at, '#4a90c8');
    } else {
      const refund = this.#refund();
      const at = this.track.pointAt(0);
      this.passengers.setTrack(null);
      this.track.dispose();
      this.track = null;
      this.trackCost = 0;
      this.passengers.earn(refund);
      this.#float(`+${money(refund)}`, at.setY(1), '#4a90c8');
    }
    this.#changed();
    this.#previewDemolish();
  }

  // ---------- Quick start ----------

  quickStart() {
    if (this.track) return;
    const plan = this.#planTrack(DEMO.points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const total = plan.cost + DEMO.stations.length * COST.station;
    if (total > this.passengers.money) return this.#card('範例路線', `<span class="bad">資金不足，需要 ${money(total)}。</span>`);
    this.setTool(null);
    this.#buildTrack(plan, true);
    let spent = plan.cost;
    for (const [x, z] of DEMO.stations) {
      // Platforms on the outside of the loop, facing the island's shore.
      const d = this.track.nearest(x, z).d;
      const t = this.track.tangentAt(d);
      const sp = this.#planStation(d, t.z * x - t.x * z >= 0 ? 1 : -1);
      this.#buildStation(sp, this.#nextName(), true);
      spent += sp.cost;
    }
    this.#card('範例路線', `已經照範例鋪好環線和 3 個車站，共花費 ${money(spent)}。`, [
      { label: '好', primary: true, run: () => this.#card(null) },
    ]);
  }

  // ---------- Save / load (this browser only) ----------

  save() {
    if (this.loading) return;
    const data = {
      points: this.track?.corners.map((p) => [p.x, p.z]) ?? null,
      trackCost: this.trackCost,
      stations: this.stations.map((s) => ({ d: s.d, side: s.side, name: s.name })),
      money: this.passengers.money,
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
    if (!data) return false;
    this.loading = true;
    if (data.points?.length >= 3) {
      const plan = this.#planTrack(data.points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      this.#buildTrack(plan, false);
      this.trackCost = data.trackCost ?? plan.cost;
      for (const st of data.stations ?? []) {
        const def = STATION_NAMES.find((n) => n.name === st.name) ?? this.#nextName();
        this.#buildStation(this.#planStation(st.d, st.side), def, false);
      }
    }
    if (Number.isFinite(data.money)) this.passengers.money = data.money;
    if (Number.isFinite(data.delivered)) this.passengers.delivered = data.delivered;
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
  }

  #refreshTools() {
    const { tools, quick } = this.ui;
    for (const b of tools.querySelectorAll('[data-tool]')) {
      b.classList.toggle('on', b.dataset.tool === this.tool);
      b.classList.toggle('dim', (b.dataset.tool === 'track' && !!this.track) || (b.dataset.tool === 'station' && !this.track));
    }
    quick.hidden = !!this.track;
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
        b.addEventListener('click', a.run);
        return b;
      }),
    );
  }

  #float(text, at, color = '#e0533f') {
    const f = new FloatText(text, color);
    f.sprite.position.copy(at).add(new THREE.Vector3(0, 0.8, 0));
    f.sprite.scale.multiplyScalar(1.6);
    this.passengers.addFloater(f);
  }
}

