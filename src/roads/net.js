import * as THREE from 'three';

// The road network: nodes joined by segments, each segment a dense
// centreline polyline. Every segment carries one lane each way (traffic
// drives on the right); vehicles move along lanes and through connectors
// that join an incoming lane to an outgoing one across a node.

export const ROAD_HALF = 0.72; // half the asphalt width
export const LANE_OFF = 0.36; // lane centre from the road centre
export const WALK = 0.26; // sidewalk width
export const JUNCTION_R = 1.05; // radius of the open area at a junction
export const STOP_BACK = 0.75; // stop line distance before the junction area

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

  // Two segments meeting smoothly: the road just carries on.
  get smooth() {
    if (this.segs.length !== 2) return false;
    const [a, b] = this.segs;
    return a.dirAt(this).dot(b.dirAt(this)) < -0.95;
  }

  // How far lanes stop short of this node.
  get trim() {
    if (this.segs.length <= 1 || this.smooth) return 0;
    return this.junction ? JUNCTION_R + STOP_BACK : JUNCTION_R * 0.75;
  }
}

export class RSeg {
  constructor(a, b, pts, cost = 0) {
    this.id = ids++;
    this.a = a;
    this.b = b;
    this.line = new Polyline(pts.map((p) => p.clone().setY(0)));
    this.cost = cost;
    this.lanes = {};
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

// One direction of travel along a segment.
export class Lane {
  constructor(seg, dir) {
    this.seg = seg;
    this.dir = dir;
    this.from = dir > 0 ? seg.a : seg.b;
    this.to = dir > 0 ? seg.b : seg.a;
    this.key = `${seg.id}${dir > 0 ? '+' : '-'}`;
    const centre = dir > 0 ? seg.pts : [...seg.pts].reverse();
    const full = new Polyline(offsetLine(centre, LANE_OFF));
    this.t0 = Math.min(this.from.trim, full.length * 0.45);
    this.t1 = Math.max(this.t0 + 0.05, full.length - Math.min(this.to.trim, full.length * 0.45));
    this.path = new Polyline(full.slice(this.t0, this.t1));
    this.full = full;
  }

  get length() {
    return this.path.length;
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

  addSeg(a, b, pts, cost) {
    const s = new RSeg(a, b, pts, cost);
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
    const { a, b, cost } = seg;
    this.removeSeg(seg);
    this.nodes.add(a);
    this.nodes.add(b);
    const k = s / seg.length;
    const l = this.addSeg(a, node, left, cost * k);
    const r = this.addSeg(node, b, right, cost * (1 - k));
    l.parent = r.parent = seg;
    return node;
  }

  // Rebuild lanes and forget connectors after any change.
  rebuild() {
    this.lanes = [];
    for (const s of this.segs) {
      s.lanes = { 1: new Lane(s, 1), [-1]: new Lane(s, -1) };
      this.lanes.push(s.lanes[1], s.lanes[-1]);
    }
    this.connectors.clear();
    this.version++;
  }

  // Lanes a vehicle arriving on `lane` may continue on. U-turns only at
  // dead ends.
  exits(lane) {
    const n = lane.to;
    const out = [];
    for (const s of n.segs) {
      const l = s.a === n ? s.lanes[1] : s.lanes[-1];
      if (s === lane.seg && n.segs.length > 1) continue;
      if (s.a === n && s.b === n) out.push(s.lanes[1], s.lanes[-1]);
      else out.push(l);
    }
    return out.filter(Boolean);
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
    c = { path: new Polyline(curve.getSpacedPoints(n)), from: a, to: b, node: a.to, uTurn };
    this.connectors.set(key, c);
    return c;
  }

  nearestSeg(x, z) {
    let best = null;
    for (const s of this.segs) {
      const r = s.line.nearest(x, z);
      if (!best || r.dist < best.dist) best = { seg: s, s: r.s, dist: r.dist };
    }
    if (best) best.pos = best.seg.line.pointAt(best.s);
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
        const d = dist.get(l) + x.length + (x.seg === l.seg ? 3 : 1.5);
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
