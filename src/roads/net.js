import * as THREE from 'three';

// The road network: nodes joined by segments, each segment a dense
// centreline polyline of one road type. A segment carries one or more lanes
// each way (traffic drives on the right); vehicles move along lanes and
// through connectors that join an incoming lane to an outgoing one across
// a node.

export const ROAD_HALF = 0.72; // half the asphalt width of a normal road
export const LANE_OFF = 0.36; // lane centre from the road centre
export const WALK = 0.26; // sidewalk width
export const JUNCTION_R = 1.05; // radius of the open area at a normal junction
export const STOP_BACK = 0.75; // stop line distance before the junction area

// Road types the player can lay.
//   half    half the asphalt width
//   walk    sidewalk width (flush paving for lanes without kerbs)
//   lanes   lane centres from the road centre, inner to kerb side
//   pace    how much faster than usual vehicles drive here
//   limit   speed limit (world units per second)
//   kmh     the limit as shown to the player
//   cost    price per metre
export const ROAD_TYPES = {
  lane: { key: 'lane', label: '小巷', icon: '🏘️', half: 0.56, walk: 0.16, lanes: [0.29], lanesText: '單車道雙向', pace: 0.62, limit: 1.45, kmh: 30, cost: 6, kerb: false, note: '窄窄的巷弄，沒有分向線，會車時慢慢錯身。' },
  road: { key: 'road', label: '一般道路', icon: '🛣️', half: ROAD_HALF, walk: WALK, lanes: [LANE_OFF], lanesText: '雙向 2 線', pace: 1, limit: 2.6, kmh: 50, cost: 10, kerb: true, note: '雙向各一線，雙黃線分隔。' },
  avenue: { key: 'avenue', label: '大道', icon: '🌳', half: 1.62, walk: 0.3, lanes: [0.52, 1.24], lanesText: '雙向 4 線', median: 0.16, pace: 1.22, limit: 3.3, kmh: 70, cost: 28, kerb: true, note: '雙向各兩線，中央分隔島種行道樹，可以超車。' },
};
export const DEFAULT_TYPE = ROAD_TYPES.road;
export const roadType = (key) => ROAD_TYPES[key] ?? DEFAULT_TYPE;
// Kerb to kerb plus sidewalks, from the centre line.
export const outerHalf = (type) => type.half + type.walk;
// Closest the centre lines of two separate roads may run.
export const roadGap = (a, b) => outerHalf(a) + outerHalf(b) + 0.09;
// Closest two junctions may be along roads of these types.
export const junctionGap = (a, b) => 2.8 + 2 * Math.max(0, Math.max(a.half, b.half) - ROAD_HALF);

const UP = new THREE.Vector3(0, 1, 0);

// A polyline with arc-length lookups.
export class Polyline {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  #find(s) {
    const c = this.cum;
    if (s <= 0) return 0;
    if (s >= this.length) return c.length - 2;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m] <= s) lo = m;
      else hi = m;
    }
    return lo;
  }

  pointAt(s, target = new THREE.Vector3()) {
    const i = this.#find(s);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    return target.lerpVectors(a, b, THREE.MathUtils.clamp((s - this.cum[i]) / seg, 0, 1));
  }

  tangentAt(s, target = new THREE.Vector3()) {
    const i = this.#find(s);
    return target.subVectors(this.pts[i + 1], this.pts[i]).normalize();
  }

  // Distance along the line of the point nearest (x, z).
  nearest(x, z) {
    let best = { s: 0, dist: Infinity };
    const p = new THREE.Vector3(x, 0, z);
    const ab = new THREE.Vector3();
    const ap = new THREE.Vector3();
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      ab.subVectors(this.pts[i + 1], a);
      const L2 = ab.lengthSq() || 1;
      const t = THREE.MathUtils.clamp(ap.subVectors(p, a).dot(ab) / L2, 0, 1);
      const qx = a.x + ab.x * t;
      const qz = a.z + ab.z * t;
      const d = Math.hypot(qx - x, qz - z);
      if (d < best.dist) best = { s: this.cum[i] + Math.sqrt(L2) * t, dist: d };
    }
    return best;
  }

  // The part of the line between s0 and s1, as points.
  slice(s0, s1) {
    const out = [this.pointAt(s0)];
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > s0 + 1e-4 && this.cum[i] < s1 - 1e-4) out.push(this.pts[i].clone());
    out.push(this.pointAt(s1));
    return out;
  }
}

// Offset a polyline sideways (positive = to the right of travel).
export function offsetLine(pts, d) {
  const out = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    out.push(pts[i].clone().addScaledVector(side, d));
  }
  return out;
}

export function resample(pts, step = 0.2) {
  const line = new Polyline(pts);
  const n = Math.max(2, Math.ceil(line.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(line.pointAt((line.length * i) / n));
  return out;
}

let ids = 1;

export class RNode {
  constructor(pos) {
    this.id = ids++;
    this.pos = pos.clone().setY(0);
    this.segs = [];
  }

  get junction() {
    return this.segs.length >= 3;
  }

  // Two segments of the same type meeting smoothly: the road just carries on.
  get smooth() {
    if (this.segs.length !== 2) return false;
    const [a, b] = this.segs;
    return a.type === b.type && a.dirAt(this).dot(b.dirAt(this)) < -0.95;
  }

  // Half width of the widest road meeting here.
  get half() {
    return this.segs.reduce((m, s) => Math.max(m, s.type.half), 0) || ROAD_HALF;
  }

  // Radius of the open asphalt area at a junction (or a corner).
  get radius() {
    return this.junction ? this.half + (JUNCTION_R - ROAD_HALF) : this.half;
  }

  // How far lanes stop short of this node.
  get trim() {
    if (this.segs.length <= 1 || this.smooth) return 0;
    return this.junction ? this.radius + STOP_BACK : (this.half + (JUNCTION_R - ROAD_HALF)) * 0.75;
  }
}

export class RSeg {
  constructor(a, b, pts, cost = 0, type = DEFAULT_TYPE) {
    this.id = ids++;
    this.a = a;
    this.b = b;
    this.line = new Polyline(pts.map((p) => p.clone().setY(0)));
    this.cost = cost;
    this.type = type;
    this.lanes = {};
  }

  // The kerb-side lane running in direction dir (bus stops use it).
  kerbLane(dir) {
    const l = this.lanes[dir];
    return l?.[l.length - 1] ?? null;
  }

  get pts() {
    return this.line.pts;
  }

  get length() {
    return this.line.length;
  }

  other(n) {
    return n === this.a ? this.b : this.a;
  }

  // Unit direction leaving node n along this segment.
  dirAt(n) {
    const p = this.pts;
    const k = Math.min(3, p.length - 1);
    return n === this.a
      ? new THREE.Vector3().subVectors(p[k], p[0]).normalize()
      : new THREE.Vector3().subVectors(p[p.length - 1 - k], p[p.length - 1]).normalize();
  }
}

// One lane of one direction of travel along a segment; idx 0 is the inner
// (overtaking) lane, the last one runs along the kerb.
export class Lane {
  constructor(seg, dir, idx = 0) {
    this.seg = seg;
    this.dir = dir;
    this.idx = idx;
    this.offset = seg.type.lanes[idx];
    this.count = seg.type.lanes.length;
    this.from = dir > 0 ? seg.a : seg.b;
    this.to = dir > 0 ? seg.b : seg.a;
    this.key = `${seg.id}${dir > 0 ? '+' : '-'}${idx}`;
    const centre = dir > 0 ? seg.pts : [...seg.pts].reverse();
    const full = new Polyline(offsetLine(centre, this.offset));
    this.t0 = Math.min(this.from.trim, full.length * 0.45);
    this.t1 = Math.max(this.t0 + 0.05, full.length - Math.min(this.to.trim, full.length * 0.45));
    this.path = new Polyline(full.slice(this.t0, this.t1));
    this.full = full;
  }

  get length() {
    return this.path.length;
  }

  // The lanes running the same way, this one included.
  get siblings() {
    return this.seg.lanes[this.dir];
  }

  // Lane distance for a distance s along the segment from node a.
  fromSeg(s) {
    const along = this.dir > 0 ? s : this.seg.length - s;
    return along - this.t0;
  }
}

export class RoadNet {
  constructor() {
    this.nodes = new Set();
    this.segs = new Set();
    this.lanes = [];
    this.connectors = new Map();
    this.version = 0;
  }

  addNode(pos) {
    const n = new RNode(pos);
    this.nodes.add(n);
    return n;
  }

  addSeg(a, b, pts, cost, type) {
    const s = new RSeg(a, b, pts, cost, type);
    a.segs.push(s);
    b.segs.push(s);
    this.segs.add(s);
    return s;
  }

  removeSeg(s) {
    for (const n of [s.a, s.b]) {
      const i = n.segs.indexOf(s);
      if (i >= 0) n.segs.splice(i, 1);
      if (!n.segs.length) this.nodes.delete(n);
    }
    this.segs.delete(s);
  }

  // Cut a segment at distance s; returns the new middle node.
  split(seg, s) {
    if (s < 0.15) return seg.a;
    if (s > seg.length - 0.15) return seg.b;
    const node = this.addNode(seg.line.pointAt(s));
    const left = seg.line.slice(0, s);
    const right = seg.line.slice(s, seg.length);
    const { a, b, cost, type } = seg;
    this.removeSeg(seg);
    this.nodes.add(a);
    this.nodes.add(b);
    const k = s / seg.length;
    const l = this.addSeg(a, node, left, cost * k, type);
    const r = this.addSeg(node, b, right, cost * (1 - k), type);
    l.parent = r.parent = seg;
    return node;
  }

  // Rebuild lanes and forget connectors after any change.
  rebuild() {
    this.lanes = [];
    for (const s of this.segs) {
      s.lanes = {};
      for (const dir of [1, -1]) {
        s.lanes[dir] = s.type.lanes.map((_, i) => new Lane(s, dir, i));
        this.lanes.push(...s.lanes[dir]);
      }
    }
    this.connectors.clear();
    this.conflicts = new Map();
    this.version++;
  }

  // Lane groups (every lane of one direction of one segment) a vehicle
  // arriving on `lane` may continue on. U-turns only at dead ends.
  exitGroups(lane) {
    const n = lane.to;
    const out = [];
    for (const s of n.segs) {
      if (s === lane.seg && n.segs.length > 1) continue;
      if (s.a === n && s.b === n) out.push(s.lanes[1], s.lanes[-1]);
      else out.push(s.a === n ? s.lanes[1] : s.lanes[-1]);
    }
    return out.filter((g) => g?.length);
  }

  // Every lane a vehicle arriving on `lane` may continue on.
  exits(lane) {
    return this.exitGroups(lane).flat();
  }

  // How a move from lane a onto lane b turns: -1 left, 0 straight, 1 right.
  turn(a, b) {
    if (a.seg === b.seg) return -1;
    const t0 = a.path.tangentAt(a.length - 0.01);
    const t1 = b.path.tangentAt(0.01);
    // The right of travel is cross(t, up) = (-t.z, 0, t.x).
    const r = -t0.z * t1.x + t0.x * t1.z;
    return r > 0.45 ? 1 : r < -0.45 ? -1 : 0;
  }

  // The lane of group g to take after arriving on `from`. At junctions
  // right turns keep to the kerb, left turns to the inside and straight on
  // keeps its lane; round corners and dead ends every lane keeps its place,
  // so their paths never cross.
  pickLane(from, g) {
    if (g.length === 1) return g[0];
    if (from.to.junction) {
      const t = this.turn(from, g[0]);
      if (t > 0) return g[g.length - 1];
      if (t < 0) return g[0];
    }
    if (from.count < g.length) return g[Math.random() < 0.5 ? 0 : g.length - 1];
    return g[Math.min(g.length - 1, from.idx)];
  }

  // Does traffic arriving at node n need right of way to go through? Not
  // where a road simply carries on.
  guarded(n) {
    return n.segs.length >= 1 && !n.smooth;
  }

  // The lane index on `lane`'s road to be in before moving onto `next`,
  // or -1 when any will do.
  wantIdx(lane, next) {
    if (lane.count === 1 || !next || !lane.to.junction) return -1;
    const t = this.turn(lane, next);
    return t > 0 ? lane.count - 1 : t < 0 ? 0 : -1;
  }

  // Do two connectors through the same node pass close enough that
  // vehicles on them could touch?
  conflict(c1, c2) {
    if (c1 === c2 || c1.from === c2.from) return false;
    const key = c1.key < c2.key ? `${c1.key}|${c2.key}` : `${c2.key}|${c1.key}`;
    let hit = this.conflicts.get(key);
    if (hit !== undefined) return hit;
    hit = c1.to === c2.to;
    const A = c1.path.pts;
    const B = c2.path.pts;
    const clear = 0.64;
    for (let i = 0; i < A.length && !hit; i++) {
      for (let j = 0; j < B.length; j++) {
        if ((A[i].x - B[j].x) ** 2 + (A[i].z - B[j].z) ** 2 < clear * clear) {
          hit = true;
          break;
        }
      }
    }
    this.conflicts.set(key, hit);
    return hit;
  }

  // Smooth path through a node from the end of `a` to the start of `b`.
  connector(a, b) {
    const key = `${a.key}>${b.key}`;
    let c = this.connectors.get(key);
    if (c) return c;
    const p0 = a.path.pointAt(a.length);
    const d0 = a.path.tangentAt(a.length - 0.01);
    const p3 = b.path.pointAt(0);
    const d3 = b.path.tangentAt(0.01);
    const dist = p0.distanceTo(p3);
    const uTurn = a.seg === b.seg;
    const k = uTurn ? 1.0 : Math.max(0.15, dist * 0.45);
    const curve = new THREE.CubicBezierCurve3(p0, p0.clone().addScaledVector(d0, k), p3.clone().addScaledVector(d3, -k), p3);
    const n = Math.max(6, Math.ceil(curve.getLength() / 0.12));
    c = { key, path: new Polyline(curve.getSpacedPoints(n)), from: a, to: b, node: a.to, uTurn };
    this.connectors.set(key, c);
    return c;
  }

  nearestSeg(x, z) {
    let best = null;
    for (const s of this.segs) {
      const r = s.line.nearest(x, z);
      if (!best || r.dist < best.dist) best = { seg: s, s: r.s, dist: r.dist };
    }
    if (best) {
      best.pos = best.seg.line.pointAt(best.s);
      // How much wider than a normal road (with its sidewalks) this one is,
      // for callers that keep a fixed distance from roads.
      best.wide = outerHalf(best.seg.type) - (ROAD_HALF + WALK);
    }
    return best;
  }

  nearestNode(x, z, max) {
    let best = null;
    let bd = max * max;
    for (const n of this.nodes) {
      const d = (n.pos.x - x) ** 2 + (n.pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // Nearest lane whose direction roughly matches `heading`.
  nearestLane(p, heading) {
    let best = null;
    for (const l of this.lanes) {
      const r = l.path.nearest(p.x, p.z);
      const t = l.path.tangentAt(r.s);
      const penalty = heading && t.dot(heading) < 0 ? 5 : 0;
      if (!best || r.dist + penalty < best.score) best = { lane: l, s: r.s, score: r.dist + penalty };
    }
    return best;
  }

  // Shortest lane route from (lane, s) to a target lane: list of lanes
  // after the current one, ending with the target.
  route(from, to) {
    if (from === to) return [];
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = [from];
    while (open.length) {
      open.sort((a, b) => dist.get(a) - dist.get(b));
      const l = open.shift();
      if (l === to) break;
      for (const x of this.exits(l)) {
        const d = dist.get(l) + x.length / x.seg.type.pace + (x.seg === l.seg ? 3 : 1.5) + (x.idx !== l.idx ? 0.3 : 0);
        if (d < (dist.get(x) ?? Infinity)) {
          dist.set(x, d);
          prev.set(x, l);
          if (!open.includes(x)) open.push(x);
        }
      }
    }
    if (!prev.has(to)) return null;
    const out = [];
    for (let l = to; l !== from; l = prev.get(l)) out.unshift(l);
    return out;
  }

  get totalLength() {
    let n = 0;
    for (const s of this.segs) n += s.length;
    return n;
  }
}

// Where two polylines cross: [{i, j, ta, tb, p}] with ta/tb as distances.
export function crossings(A, B) {
  const out = [];
  for (let i = 0; i < A.pts.length - 1; i++) {
    const p = A.pts[i];
    const p2 = A.pts[i + 1];
    for (let j = 0; j < B.pts.length - 1; j++) {
      const q = B.pts[j];
      const q2 = B.pts[j + 1];
      const rx = p2.x - p.x;
      const rz = p2.z - p.z;
      const sx = q2.x - q.x;
      const sz = q2.z - q.z;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q.x - p.x) * sz - (q.z - p.z) * sx) / den;
      const u = ((q.x - p.x) * rz - (q.z - p.z) * rx) / den;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      const ta = A.cum[i] + t * (A.cum[i + 1] - A.cum[i]);
      const tb = B.cum[j] + u * (B.cum[j + 1] - B.cum[j]);
      const da = new THREE.Vector3(rx, 0, rz).normalize();
      const db = new THREE.Vector3(sx, 0, sz).normalize();
      out.push({ ta, tb, p: new THREE.Vector3(p.x + rx * t, 0, p.z + rz * t), angle: Math.acos(Math.min(1, Math.abs(da.dot(db)))) });
    }
  }
  return out;
}
