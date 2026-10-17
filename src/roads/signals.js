import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Traffic lights at every junction of three or more roads. Each approach
// gets a signal on its kerb just behind the stop line: a slim pole with a
// mast arm reaching over the lanes and a rounded three-lamp head (red on
// top). All signals in the town share four instanced meshes, and the lamps
// glow through per-instance colours bright enough for bloom, so no real
// lights are needed.
//
// Each junction runs its own cycle: approaches facing each other share a
// phase; a phase stays green while traffic keeps coming (within limits),
// gives way early when its road is empty and others wait, then shows amber
// and a short all-red before the next phase with traffic gets green.

const UP = new THREE.Vector3(0, 1, 0);
const ARM_Y = 1.6; // mast arm height: clears the bus roof
const HEAD_Y = ARM_Y - 0.27; // head centre under the arm
const LAMP_DY = 0.115;

export const SIGNAL_MATS = {
  pole: new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.38, metalness: 0.55 }),
  housing: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.5, side: THREE.DoubleSide }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};

// Lamp colours, lit and dark, for red, amber and green. Lit values go a
// little past 1 so they read as glowing while staying saturated under tone
// mapping.
const rgb = (r, g, b) => new THREE.Color(r, g, b);
const LIT = [rgb(1.5, 0.05, 0.04), rgb(1.6, 0.62, 0.02), rgb(0.05, 1.25, 0.48)];
const DIM = [rgb(0.16, 0.04, 0.035), rgb(0.16, 0.11, 0.03), rgb(0.03, 0.12, 0.07)];

const MIN_GREEN = 3;
const MAX_GREEN = 9;
const AMBER = 1.5;
const ALL_RED = 1.0;

let geos = null;
function signalGeos() {
  if (geos) return geos;
  const ni = (g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal') x.deleteAttribute(name);
    return x;
  };
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.06, 0.072, 0.05, 16).translate(0, 0.025, 0),
    new THREE.CylinderGeometry(0.034, 0.05, 0.05, 14).translate(0, 0.075, 0),
    new THREE.CylinderGeometry(0.021, 0.026, ARM_Y + 0.02, 10).translate(0, (ARM_Y + 0.02) / 2 + 0.05, 0),
    new THREE.SphereGeometry(0.032, 12, 8).translate(0, ARM_Y + 0.08, 0),
    // Push-button box for pedestrians.
    new RoundedBoxGeometry(0.06, 0.1, 0.05, 2, 0.015).translate(0, 0.5, 0.03),
  ].map(ni));
  // Unit-length arm along local -x; instances stretch it to reach the lanes.
  const arm = mergeGeometries([
    new THREE.CylinderGeometry(0.015, 0.015, 1, 8).rotateZ(Math.PI / 2).translate(-0.5, 0, 0),
  ].map(ni));
  const housing = [new RoundedBoxGeometry(0.15, 0.38, 0.1, 3, 0.04)];
  for (let k = 0; k < 3; k++) {
    // Little visor over each lamp (the top half of a short tube).
    housing.push(new THREE.CylinderGeometry(0.056, 0.056, 0.075, 16, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, LAMP_DY * (1 - k), 0.085));
  }
  housing.push(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8).translate(0, 0.23, 0));
  // Backplate framing the head.
  housing.push(new RoundedBoxGeometry(0.23, 0.46, 0.014, 2, 0.05).translate(0, 0, -0.058));
  const lamp = new THREE.SphereGeometry(0.044, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.5).translate(0, 0, 0.05);
  geos = { pole, arm, housing: mergeGeometries(housing.map(ni)), lamp: ni(lamp) };
  return geos;
}

// Lay out one signal per approach of every junction.
export function buildSignals(net) {
  const heads = [];
  for (const n of net.nodes) {
    if (!n.junction) continue;
    for (const seg of n.segs) {
      if (seg.a === n && seg.b === n) continue;
      const T = seg.type;
      const away = seg.a === n ? 1 : -1;
      const d = Math.min(seg.length / 2, n.radius + 0.62 + 0.14);
      const s = away > 0 ? d : seg.length - d;
      const p = seg.line.pointAt(s);
      const f = seg.line.tangentAt(Math.min(seg.length - 0.01, Math.max(0.01, s))).multiplyScalar(away);
      const side = new THREE.Vector3().crossVectors(f, UP).normalize();
      // On the kerb to the right of traffic heading into the junction.
      const kerb = T.half + (T.kerb ? T.walk * 0.55 : T.walk * 0.6);
      const pos = p.clone().addScaledVector(side, -kerb);
      // Reach over the lane next to the kerb (between the two on avenues).
      const over = T.lanes.length > 1 ? (T.lanes[0] + T.lanes[1]) / 2 : T.lanes[0];
      const arm = T.kerb ? kerb - over : 0;
      heads.push({ node: n, seg, pos, yaw: Math.atan2(f.x, f.z), arm });
    }
  }
  if (!heads.length) return null;
  const G = signalGeos();
  const make = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = mat !== SIGNAL_MATS.lamp;
    m.receiveShadow = mat !== SIGNAL_MATS.lamp;
    return m;
  };
  const pole = make(G.pole, SIGNAL_MATS.pole, heads.length);
  const arms = make(G.arm, SIGNAL_MATS.pole, heads.length);
  const housing = make(G.housing, SIGNAL_MATS.housing, heads.length);
  const lamps = make(G.lamp, SIGNAL_MATS.lamp, heads.length * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const v = new THREE.Vector3();
  heads.forEach((h, i) => {
    q.setFromAxisAngle(UP, h.yaw);
    const base = new THREE.Matrix4().compose(h.pos, q, one);
    pole.setMatrixAt(i, base);
    arms.setMatrixAt(i, m.compose(v.set(0, ARM_Y, 0), new THREE.Quaternion(), new THREE.Vector3(Math.max(0.001, h.arm), 1, 1)).premultiply(base));
    // Hung from the arm's tip, or bolted to the pole on a lane.
    const at = h.arm > 0 ? v.set(-h.arm + 0.02, HEAD_Y, 0) : v.set(0, HEAD_Y - 0.12, 0.075);
    const head = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).premultiply(base);
    housing.setMatrixAt(i, head);
    for (let k = 0; k < 3; k++) {
      lamps.setMatrixAt(i * 3 + k, m.makeTranslation(0, LAMP_DY * (1 - k), 0).premultiply(head));
      lamps.setColorAt(i * 3 + k, DIM[k]);
    }
    if (h.arm <= 0) arms.setMatrixAt(i, m.makeScale(0, 0, 0));
  });
  lamps.instanceColor.setUsage(THREE.DynamicDrawUsage);
  return { heads, lamps, meshes: [pole, arms, housing, lamps] };
}

// Phases and timing for every junction.
export class SignalSystem {
  constructor(built, previous = null) {
    this.lamps = built?.lamps ?? null;
    this.junctions = new Map();
    for (const [i, h] of (built?.heads ?? []).entries()) {
      let j = this.junctions.get(h.node);
      if (!j) this.junctions.set(h.node, (j = { node: h.node, heads: [], approaches: [] }));
      j.heads.push({ ...h, index: i });
      j.approaches.push(h.seg);
    }
    for (const j of this.junctions.values()) {
      j.phases = this.#phases(j);
      j.phaseOf = new Map();
      j.phases.forEach((p, k) => p.forEach((seg) => j.phaseOf.set(seg, k)));
      const old = previous?.junctions.get(j.node);
      if (old && old.phases.length === j.phases.length && j.approaches.every((s) => old.phaseOf.has(s))) {
        Object.assign(j, { phase: old.phase, state: old.state, timer: old.timer, green: old.green });
      } else {
        // Junctions start out of step with each other.
        j.phase = Math.floor(Math.random() * j.phases.length);
        j.state = 'green';
        j.green = MIN_GREEN + 2.5 + Math.random() * 2.5;
        j.timer = Math.random() * j.green;
      }
      j.demand = new Array(j.phases.length).fill(0);
      this.#paint(j);
    }
  }

  // Approaches roughly facing each other share a phase.
  #phases(j) {
    const dir = (seg) => seg.dirAt(j.node);
    const left = [...j.approaches];
    const out = [];
    while (left.length) {
      const a = left.shift();
      const k = left.findIndex((b) => dir(a).dot(dir(b)) < -0.75);
      out.push(k >= 0 ? [a, ...left.splice(k, 1)] : [a]);
    }
    return out;
  }

  // 'green', 'amber' or 'red' for traffic on `seg` heading into `node`.
  state(node, seg) {
    const j = this.junctions.get(node);
    if (!j) return 'green';
    if (j.phaseOf.get(seg) !== j.phase || j.state === 'red') return 'red';
    return j.state;
  }

  // A vehicle on `seg` is waiting at, or rolling up to, `node`.
  want(node, seg) {
    const j = this.junctions.get(node);
    const k = j?.phaseOf.get(seg);
    if (k !== undefined) j.demand[k]++;
  }

  update(dt) {
    for (const j of this.junctions.values()) {
      j.timer += dt;
      const d = j.demand;
      const others = d.some((n, k) => k !== j.phase && n > 0);
      if (j.state === 'green') {
        const done = (j.timer > MAX_GREEN && others) || (j.timer > j.green && (others || d[j.phase] === 0)) || (j.timer > MIN_GREEN && others && d[j.phase] === 0);
        if (done && j.phases.length > 1) this.#set(j, 'amber');
        else if (done) j.timer = 0;
      } else if (j.state === 'amber' && j.timer > AMBER) this.#set(j, 'red');
      else if (j.state === 'red' && j.timer > ALL_RED) {
        // Next phase with traffic waiting, or simply the next one.
        let next = (j.phase + 1) % j.phases.length;
        for (let k = 1; k <= j.phases.length; k++) {
          const c = (j.phase + k) % j.phases.length;
          if (d[c] > 0) {
            next = c;
            break;
          }
        }
        j.phase = next;
        j.green = MIN_GREEN + 2.5 + Math.random() * 2.5;
        this.#set(j, 'green');
      }
      d.fill(0);
    }
  }

  #set(j, state) {
    j.state = state;
    j.timer = 0;
    this.#paint(j);
  }

  #paint(j) {
    const lamps = this.lamps;
    if (!lamps) return;
    for (const h of j.heads) {
      const s = this.state(j.node, h.seg);
      const on = s === 'red' ? 0 : s === 'amber' ? 1 : 2;
      for (let k = 0; k < 3; k++) lamps.setColorAt(h.index * 3 + k, k === on ? LIT[k] : DIM[k]);
    }
    lamps.instanceColor.needsUpdate = true;
  }
}
