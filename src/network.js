import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// A free-form rail network: nodes joined by curved edges (cubic Béziers),
// laid piece by piece like a city builder. Trains find their way along it,
// passing only between edges that meet smoothly at a node, and reserve the
// track ahead (block signalling) so they never collide.

const UP = new THREE.Vector3(0, 1, 0);
const GAUGE = 0.5;
const SMOOTH = Math.cos(THREE.MathUtils.degToRad(35)); // largest bend allowed at a node
const REVERSE_COST = 200; // prefer driving on over turning back at a station
export const NODE_CLEAR = 3; // a train within this of a node holds it (switches overlap)

const MAT = {
  bed: new THREE.MeshStandardMaterial({ color: 0xb7a99a, roughness: 1, flatShading: true }),
  sleeper: new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.9 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.3 }),
  bumper: new THREE.MeshStandardMaterial({ color: 0xd94a3d, roughness: 0.5 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.5 }),
  post: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6, metalness: 0.3 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.4 }),
};
const LIGHT = {
  red: new THREE.MeshStandardMaterial({ color: 0xff4a3d, emissive: 0xff2a1a, emissiveIntensity: 2.2 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4dff8a, emissive: 0x1aff5a, emissiveIntensity: 1.8 }),
  off: new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.4 }),
};

let nextId = 1;

export class Node {
  constructor(pos) {
    this.id = nextId++;
    this.pos = pos.clone().setY(0);
    this.edges = [];
    this.station = null;
  }
}

export class Edge {
  constructor(a, b, curve, cost = 0) {
    this.id = nextId++;
    this.a = a;
    this.b = b;
    this.curve = curve;
    curve.arcLengthDivisions = 200;
    this.length = curve.getLength();
    this.cost = cost;
    const n = Math.max(2, Math.ceil(this.length / 0.25));
    this.samples = curve.getSpacedPoints(n);
    this.group = buildTrackMesh(this);
    this.reservedBy = null;
  }

  pointAt(t, target = new THREE.Vector3()) {
    return this.curve.getPointAt(THREE.MathUtils.clamp(t / this.length, 0, 1), target);
  }

  // Direction of travel from a to b.
  tangentAt(t, target = new THREE.Vector3()) {
    return this.curve.getTangentAt(THREE.MathUtils.clamp(t / this.length, 0, 1), target).setY(0).normalize();
  }

  other(node) {
    return node === this.a ? this.b : this.a;
  }

  // Unit direction leaving `node` along this edge.
  dirAt(node) {
    return node === this.a ? this.tangentAt(0) : this.tangentAt(this.length).negate();
  }

  // Edge-local distance of an end node.
  tAt(node) {
    return node === this.a ? 0 : this.length;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => o.isMesh && o.geometry.dispose());
  }
}

// ---------- Track meshes ----------

function offsetPoints(edge, offset, y, step) {
  const n = Math.max(2, Math.ceil(edge.length / step));
  const pts = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * edge.length;
    edge.pointAt(d, p);
    edge.tangentAt(d, t);
    side.crossVectors(t, UP).normalize();
    pts.push(p.clone().addScaledVector(side, offset).setY(y));
  }
  return pts;
}

function ribbonGeometry(edge, width, y) {
  const left = offsetPoints(edge, -width / 2, y, 0.2);
  const right = offsetPoints(edge, width / 2, y, 0.2);
  const pos = [];
  const idx = [];
  for (let i = 0; i < left.length; i++) {
    pos.push(left[i].x, y, left[i].z, right[i].x, y, right[i].z);
    if (i < left.length - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildTrackMesh(edge) {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(ribbonGeometry(edge, 0.62, 0.02), MAT.bed);
  bed.receiveShadow = true;
  g.add(bed);

  const gap = 0.32;
  const count = Math.max(1, Math.round(edge.length / gap));
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 0.06, 0.14), MAT.sleeper, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const d = ((i + 0.5) / count) * edge.length;
    edge.pointAt(d, p);
    edge.tangentAt(d, t);
    q.setFromAxisAngle(UP, Math.atan2(t.x, t.z));
    p.y = 0.05;
    m.compose(p, q, s);
    sleepers.setMatrixAt(i, m);
  }
  sleepers.castShadow = true;
  sleepers.receiveShadow = true;
  g.add(sleepers);

  for (const side of [-1, 1]) {
    const pts = offsetPoints(edge, (side * GAUGE) / 2, 0.11, 0.2);
    const curve = new THREE.CatmullRomCurve3(pts);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.035, 6, false), MAT.rail);
    rail.castShadow = true;
    g.add(rail);
  }
  return g;
}

// Buffer stop at the end of a line.
function makeBumper() {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.16, 0.12, 2, 0.03), MAT.bumper);
  beam.position.set(0, 0.26, 0);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.165, 0.125), MAT.stripe);
  stripe.position.copy(beam.position);
  g.add(beam, stripe);
  for (const x of [-0.25, 0.25]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), MAT.post);
    leg.position.set(x, 0.13, 0.04);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), MAT.post);
    brace.position.set(x, 0.12, -0.12);
    brace.rotation.x = -0.6;
    g.add(leg, brace);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

// Two-light block signal on a post.
function makeSignal() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.72, 8), MAT.post);
  post.position.y = 0.36;
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.2, 0.07, 2, 0.025), MAT.lens);
  head.position.y = 0.78;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), MAT.post);
  g.add(post, head);
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), LIGHT.off);
  red.position.set(0, 0.825, -0.035);
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), LIGHT.off);
  green.position.set(0, 0.735, -0.035);
  for (const l of [red, green]) {
    const h = hood.clone();
    h.position.set(0, l.position.y + 0.032, -0.05);
    g.add(l, h);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.userData = { red, green };
  return g;
}

// ---------- Paths a train follows ----------

// A run along the network: pieces {edge, t0, t1} (t1 < t0 means against the
// edge's direction). Beyond either end it carries on in a straight line.
export class Path {
  constructor(pieces) {
    this.pieces = [];
    let s = 0;
    for (const p of pieces) {
      const len = Math.abs(p.t1 - p.t0);
      if (len < 1e-6) continue;
      this.pieces.push({ ...p, s, len, sign: p.t1 >= p.t0 ? 1 : -1 });
      s += len;
    }
    this.length = s;
  }

  #find(d) {
    const ps = this.pieces;
    let lo = 0;
    let hi = ps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ps[mid].s <= d) lo = mid;
      else hi = mid - 1;
    }
    return ps[lo];
  }

  pointAt(d, target = new THREE.Vector3()) {
    if (!this.pieces.length) return target.set(0, 0, 0);
    if (d < 0) return this.pointAt(0, target).addScaledVector(this.tangentAt(0), d);
    if (d > this.length) return this.pointAt(this.length, target).addScaledVector(this.tangentAt(this.length), d - this.length);
    const p = this.#find(d);
    return p.edge.pointAt(p.t0 + p.sign * (d - p.s), target);
  }

  tangentAt(d, target = new THREE.Vector3()) {
    if (!this.pieces.length) return target.set(0, 0, 1);
    const p = this.#find(THREE.MathUtils.clamp(d, 0, this.length));
    const t = THREE.MathUtils.clamp(p.t0 + p.sign * (THREE.MathUtils.clamp(d, 0, this.length) - p.s), 0, p.edge.length);
    p.edge.tangentAt(t, target);
    return p.sign < 0 ? target.negate() : target;
  }

  // The stretch between distances a and b as pieces, reversed when b < a.
  stretch(a, b) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.length, Math.max(a, b));
    const out = [];
    for (const p of this.pieces) {
      const s0 = Math.max(lo, p.s);
      const s1 = Math.min(hi, p.s + p.len);
      if (s1 - s0 < 1e-6) continue;
      out.push({ edge: p.edge, t0: p.t0 + p.sign * (s0 - p.s), t1: p.t0 + p.sign * (s1 - p.s) });
    }
    if (b < a) return out.reverse().map((p) => ({ edge: p.edge, t0: p.t1, t1: p.t0 }));
    return out;
  }

  // Edges and nodes touched between distances a and b; nodes count when the
  // span comes within NODE_CLEAR of them.
  span(a, b) {
    const edges = new Set();
    const nodes = new Set();
    const entries = [];
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      const end = p.s + p.len;
      if (end < a || p.s > b) continue;
      edges.add(p.edge);
      // The node at each end of this piece, if the piece reaches it.
      const startNode = p.sign > 0 ? (p.t0 <= 1e-6 ? p.edge.a : null) : (p.t0 >= p.edge.length - 1e-6 ? p.edge.b : null);
      const endNode = p.sign > 0 ? (p.t1 >= p.edge.length - 1e-6 ? p.edge.b : null) : (p.t1 <= 1e-6 ? p.edge.a : null);
      if (startNode && p.s >= a - NODE_CLEAR && p.s <= b + NODE_CLEAR) {
        nodes.add(startNode);
        entries.push(`${startNode.id}:${p.edge.id}`);
      }
      if (endNode && end >= a - NODE_CLEAR && end <= b + NODE_CLEAR) nodes.add(endNode);
    }
    return { edges, nodes, entries };
  }
}

// ---------- The network ----------

export class Network {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.decor = new THREE.Group();
    scene.add(this.group, this.decor);
    this.nodes = new Set();
    this.edges = new Set();
    this.signals = [];
    this.version = 0;
  }

  addNode(pos) {
    const n = new Node(pos);
    this.nodes.add(n);
    return n;
  }

  addEdge(a, b, curve, cost = 0) {
    const e = new Edge(a, b, curve, cost);
    a.edges.push(e);
    b.edges.push(e);
    this.edges.add(e);
    this.group.add(e.group);
    this.#changed();
    return e;
  }

  removeEdge(e) {
    for (const n of [e.a, e.b]) {
      n.edges.splice(n.edges.indexOf(e), 1);
      if (!n.edges.length && !n.station) this.nodes.delete(n);
    }
    this.edges.delete(e);
    e.dispose();
    this.#changed();
  }

  // Cut an edge at distance t, returning the new node in the middle.
  splitEdge(e, t) {
    if (t < 0.05) return e.a;
    if (t > e.length - 0.05) return e.b;
    const u = e.curve.getUtoTmapping(t / e.length);
    const [left, right] = splitCubic(e.curve, u);
    const node = this.addNode(left.v3);
    const cost = e.cost;
    const a = e.a;
    const b = e.b;
    this.removeEdge(e);
    this.nodes.add(a);
    this.nodes.add(b);
    this.addEdge(a, node, left, cost * (t / e.length));
    this.addEdge(node, b, right, cost * (1 - t / e.length));
    return node;
  }

  #changed() {
    this.version++;
    this.#rebuildDecor();
  }

  nearestEdge(x, z) {
    let best = null;
    for (const e of this.edges) {
      e.samples.forEach((p, i) => {
        const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (!best || dd < best.dd) best = { edge: e, i, dd };
      });
    }
    if (!best) return null;
    // Refine between neighbouring samples.
    const e = best.edge;
    const n = e.samples.length - 1;
    let t = (best.i / n) * e.length;
    const step = e.length / n;
    let lo = Math.max(0, t - step);
    let hi = Math.min(e.length, t + step);
    const p = new THREE.Vector3();
    for (let k = 0; k < 16; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const d1 = e.pointAt(m1, p).distanceToSquared(new THREE.Vector3(x, 0, z));
      const d2 = e.pointAt(m2, p).distanceToSquared(new THREE.Vector3(x, 0, z));
      if (d1 < d2) hi = m2;
      else lo = m1;
    }
    t = (lo + hi) / 2;
    const pos = e.pointAt(t);
    return { edge: e, t, pos, dist: Math.hypot(pos.x - x, pos.z - z) };
  }

  nearestNode(x, z, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const n of this.nodes) {
      const dd = (n.pos.x - x) ** 2 + (n.pos.z - z) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = n;
      }
    }
    return best;
  }

  // Edges at `node` a train arriving along `edge` may carry on to.
  continuations(node, edge) {
    const arrive = edge.dirAt(node).negate();
    return node.edges.filter((e) => e !== edge && e.dirAt(node).dot(arrive) > SMOOTH);
  }

  // Shortest drivable route from one node to another: a list of
  // {edge, sign}. `facing` (the train's direction at `from`) makes turning
  // back cost extra; turning back is only possible at the start.
  findPath(from, to, facing = null) {
    if (from === to) return null;
    const dist = new Map();
    const prev = new Map();
    const open = [];
    const key = (e, s) => `${e.id}${s > 0 ? '+' : '-'}`;
    for (const e of from.edges) {
      const s = e.a === from ? 1 : -1;
      const c = facing && facing.dot(e.dirAt(from)) < 0 ? REVERSE_COST : 0;
      dist.set(key(e, s), c);
      open.push({ e, s, c });
    }
    while (open.length) {
      open.sort((x, y) => x.c - y.c);
      const { e, s, c } = open.shift();
      if (c > dist.get(key(e, s))) continue;
      const end = s > 0 ? e.b : e.a;
      const total = c + e.length;
      if (end === to) {
        const out = [{ edge: e, sign: s }];
        let k = key(e, s);
        while (prev.has(k)) {
          const p = prev.get(k);
          out.unshift({ edge: p.e, sign: p.s });
          k = key(p.e, p.s);
        }
        return out;
      }
      for (const e2 of this.continuations(end, e)) {
        const s2 = e2.a === end ? 1 : -1;
        const k2 = key(e2, s2);
        if (total < (dist.get(k2) ?? Infinity)) {
          dist.set(k2, total);
          prev.set(k2, { e, s });
          open.push({ e: e2, s: s2, c: total });
        }
      }
    }
    return null;
  }

  // Follow the track from `node` heading `dir` for `length`, taking the
  // straightest way at junctions. Returns pieces (may be short at a dead end).
  trace(node, dir, length) {
    const out = [];
    let e = node.edges.reduce((best, x) => (!best || x.dirAt(node).dot(dir) > best.dirAt(node).dot(dir) ? x : best), null);
    if (!e || e.dirAt(node).dot(dir) < SMOOTH) return out;
    let at = node;
    let left = length;
    while (e && left > 0) {
      const t0 = e.tAt(at);
      const take = Math.min(left, e.length);
      const sign = at === e.a ? 1 : -1;
      out.push({ edge: e, t0, t1: t0 + sign * take });
      left -= take;
      if (left <= 0) break;
      const next = e.other(at);
      const arrive = e.dirAt(next).negate();
      e = this.continuations(next, e).reduce((best, x) => (!best || x.dirAt(next).dot(arrive) > best.dirAt(next).dot(arrive) ? x : best), null);
      at = next;
    }
    return out;
  }

  // Points every `step` from distance t on `edge`, `length` each way,
  // continuing smoothly through plain (two-edge) nodes. Null if the track
  // ends or splits before that.
  straightRun(edge, t, length, step = 0.5) {
    const pts = [];
    for (const dir of [-1, 1]) {
      let e = edge;
      let at = t;
      let sign = dir;
      let left = length;
      while (left > 1e-6) {
        const room = sign > 0 ? e.length - at : at;
        const take = Math.min(room, left);
        for (let k = step; k <= take + 1e-6; k += step) pts.push(e.pointAt(at + sign * k));
        left -= take;
        if (left <= 1e-6) break;
        const node = sign > 0 ? e.b : e.a;
        if (node.edges.length !== 2) return null;
        const next = this.continuations(node, e)[0];
        if (!next) return null;
        sign = next.a === node ? 1 : -1;
        at = next.tAt(node);
        e = next;
      }
    }
    return pts;
  }

  // Sample points of all track, for keeping walkers off the rails.
  allSamples() {
    const out = [];
    for (const e of this.edges) out.push(...e.samples);
    return out;
  }

  // ---------- Buffer stops and signals ----------

  #rebuildDecor() {
    for (const o of this.decor.children) o.traverse((m) => m.isMesh && m.geometry.dispose());
    this.decor.clear();
    this.signals = [];
    for (const n of this.nodes) {
      if (n.edges.length === 1) {
        const e = n.edges[0];
        const out = e.dirAt(n);
        const b = makeBumper();
        b.position.copy(n.pos).addScaledVector(out, -0.12);
        b.rotation.y = Math.atan2(out.x, out.z);
        this.decor.add(b);
      }
      // Signals guard every way into a junction or a station.
      if (n.edges.length >= 3 || (n.station && n.edges.length >= 1)) {
        for (const e of n.edges) {
          // Light faces trains about to enter `e` from this node.
          const dir = e.dirAt(n);
          const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
          const s = makeSignal();
          s.position.copy(n.pos).addScaledVector(dir, n.station ? 0.3 : 0.4).addScaledVector(side, n.station ? -0.55 : 0.55);
          s.rotation.y = Math.atan2(dir.x, dir.z);
          this.decor.add(s);
          this.signals.push({ mesh: s, node: n, edge: e, key: `${n.id}:${e.id}` });
        }
      }
    }
  }

  // Red when the block beyond the signal is held by a train that will not
  // enter it from this side; green otherwise.
  updateSignals() {
    for (const s of this.signals) {
      const holder = s.edge.reservedBy;
      const green = !holder || holder.entries?.has(s.key);
      const { red, green: g } = s.mesh.userData;
      red.material = green ? LIGHT.off : LIGHT.red;
      g.material = green ? LIGHT.green : LIGHT.off;
    }
  }

  // ---------- Save / load ----------

  serialize() {
    const nodes = [...this.nodes];
    const index = new Map(nodes.map((n, i) => [n, i]));
    return {
      nodes: nodes.map((n) => [round(n.pos.x), round(n.pos.z)]),
      edges: [...this.edges].map((e) => ({
        a: index.get(e.a),
        b: index.get(e.b),
        c: [e.curve.v1, e.curve.v2].map((v) => [round(v.x), round(v.z)]),
        cost: Math.round(e.cost),
      })),
      index,
    };
  }

  load(data) {
    const nodes = data.nodes.map(([x, z]) => this.addNode(new THREE.Vector3(x, 0, z)));
    for (const e of data.edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const [c1, c2] = e.c.map(([x, z]) => new THREE.Vector3(x, 0, z));
      this.addEdge(a, b, new THREE.CubicBezierCurve3(a.pos.clone(), c1, c2, b.pos.clone()), e.cost);
    }
    return nodes;
  }
}

const round = (v) => Math.round(v * 1000) / 1000;

// de Casteljau split of a cubic Bézier at parameter u.
function splitCubic(c, u) {
  const lerp = (a, b) => a.clone().lerp(b, u);
  const p01 = lerp(c.v0, c.v1);
  const p12 = lerp(c.v1, c.v2);
  const p23 = lerp(c.v2, c.v3);
  const p012 = p01.clone().lerp(p12, u);
  const p123 = p12.clone().lerp(p23, u);
  const mid = p012.clone().lerp(p123, u);
  const left = new THREE.CubicBezierCurve3(c.v0.clone(), p01, p012, mid.clone());
  const right = new THREE.CubicBezierCurve3(mid, p123, p23, c.v3.clone());
  return [left, right];
}

// ---------- Curve shapes for new track ----------

// Straight piece.
export function straightCurve(a, b) {
  return new THREE.CubicBezierCurve3(a.clone(), a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3), b.clone());
}

// Circular arc leaving `a` along unit `dir` and passing through `b`
// (approximated by a cubic). Null if b is too far round to reach.
export function arcCurve(a, dir, b) {
  const chord = new THREE.Vector3().subVectors(b, a);
  const len = chord.length();
  if (len < 1e-3) return null;
  const c = chord.clone().divideScalar(len);
  const theta = Math.atan2(new THREE.Vector3().crossVectors(dir, c).y, dir.dot(c));
  if (Math.abs(theta) < 0.005) return straightCurve(a, b);
  if (Math.abs(theta) > THREE.MathUtils.degToRad(80)) return null;
  const sweep = 2 * theta;
  const R = len / (2 * Math.sin(Math.abs(theta)));
  const k = (4 / 3) * Math.tan(Math.abs(sweep) / 4) * R;
  const endDir = dir.clone().applyAxisAngle(UP, sweep);
  return new THREE.CubicBezierCurve3(a.clone(), a.clone().addScaledVector(dir, k), b.clone().addScaledVector(endDir, -k), b.clone());
}

// Curve leaving a along dirA and arriving at b travelling along dirB.
export function joinCurve(a, dirA, b, dirB) {
  const len = a.distanceTo(b);
  const h = len * 0.38;
  return new THREE.CubicBezierCurve3(a.clone(), a.clone().addScaledVector(dirA, h), b.clone().addScaledVector(dirB, -h), b.clone());
}

// Tightest radius along a curve.
export function minRadius(curve) {
  const n = 48;
  const pts = curve.getSpacedPoints(n);
  const ds = curve.getLength() / n;
  let maxTurn = 0;
  for (let i = 1; i < n; i++) {
    const h1 = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const h2 = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    maxTurn = Math.max(maxTurn, Math.abs(THREE.MathUtils.euclideanModulo(h2 - h1 + Math.PI, Math.PI * 2) - Math.PI));
  }
  return maxTurn < 1e-6 ? Infinity : ds / maxTurn;
}
