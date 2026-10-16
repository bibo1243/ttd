import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });

export const M = {
  chassis: mat(0x2f3440, { roughness: 0.7 }),
  wheel: mat(0xc8402f, { roughness: 0.45 }),
  carWheel: mat(0x3a3d45, { roughness: 0.5, metalness: 0.3 }),
  hub: mat(0xf2c14e, { metalness: 0.6, roughness: 0.3 }),
  steel: mat(0xd5d9df, { metalness: 0.8, roughness: 0.25 }),
  frame: mat(0xfbf7ef, { roughness: 0.4 }),
  gold: mat(0xf2c14e, { metalness: 0.5, roughness: 0.3 }),
  black: mat(0x24262c, { roughness: 0.6 }),
  window: mat(0xbfe6ff, { roughness: 0.15, metalness: 0.1, emissive: 0x2a4a60, emissiveIntensity: 0.25 }),
  roof: mat(0xf4efe6),
  light: new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xffe48a, emissiveIntensity: 1.2 }),
};


export function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function box(w, h, d, material, r = 0.06) {
  const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  return shadowed(new THREE.Mesh(geo, material));
}

// A wheel pair on one axle. Spins around local X.
export function axle(radius, z, wheels, wheelMat = M.wheel, hubMat = M.hub) {
  const g = new THREE.Group();
  g.position.set(0, radius + 0.05, z);
  const wheelGeo = new THREE.CylinderGeometry(radius, radius, 0.08, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.1, 10);
  hubGeo.rotateZ(Math.PI / 2);
  // A spoke bar makes the spin visible.
  const spokeGeo = new THREE.BoxGeometry(0.1, radius * 1.7, radius * 0.25);
  const rimGeo = new THREE.TorusGeometry(radius * 0.92, 0.012, 6, 24);
  rimGeo.rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    const x = side * 0.27;
    const w = shadowed(new THREE.Mesh(wheelGeo, wheelMat));
    w.position.x = x;
    const h = new THREE.Mesh(hubGeo, hubMat);
    h.position.x = x + side * 0.01;
    const s = new THREE.Mesh(spokeGeo, hubMat);
    s.position.x = x + side * 0.005;
    const rimRing = new THREE.Mesh(rimGeo, M.steel);
    rimRing.position.x = x + side * 0.042;
    g.add(w, h, s, rimRing);
  }
  wheels.push({ obj: g, radius });
  return g;
}

export class Vehicle {
  constructor(length, bogieOffset) {
    this.length = length;
    this.bogieOffset = bogieOffset;
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // gets a little bounce
    this.group.add(this.body);
    this.wheels = [];
    this.phase = Math.random() * Math.PI * 2;
  }

  place(track, d, travelled, time) {
    const front = track.pointAt(d + this.bogieOffset);
    const back = track.pointAt(d - this.bogieOffset);
    this.group.position.copy(front).add(back).multiplyScalar(0.5);
    this.group.lookAt(front);
    for (const w of this.wheels) w.obj.rotation.x = travelled / w.radius;
    if (this.doors) {
      const k = Math.min(1, (this.dt ?? 0.016) * 5);
      for (const door of this.doors) {
        const target = this.openSide === door.side ? 1 : 0;
        door.t += (target - door.t) * k;
        door.panel.position.z = door.z + door.dir * door.t * door.w * 0.95;
      }
    }
    if (this.rods) {
      const a = travelled / 0.17;
      for (const r of this.rods) {
        const base = r.userData.base;
        r.position.set(base.x, base.y + Math.cos(a) * 0.08, base.z + Math.sin(a) * 0.08);
      }
    }
    this.body.position.y = Math.sin(time * 14 + this.phase) * 0.008 * Math.min(1, this.speedFactor ?? 0);
  }
}

// Build a smooth body by sweeping a rounded-rectangle (superellipse) section
// along +z. Each station is { z, hw, bottom, top }. Ends are capped.
export function loft(stations, { segments = 40, power = 5 } = {}) {
  const positions = [];
  const indices = [];
  const e = 2 / power;
  const ring = (s) => {
    const cy = (s.top + s.bottom) / 2;
    const hh = (s.top - s.bottom) / 2;
    const pts = [];
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const n = Math.sin(a);
      pts.push([s.hw * Math.sign(c) * Math.abs(c) ** e, cy + hh * Math.sign(n) * Math.abs(n) ** e, s.z]);
    }
    return pts;
  };
  const rings = stations.map(ring);
  for (const r of rings) for (const p of r) positions.push(...p);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < segments; k++) {
      const a = i * segments + k;
      const b = i * segments + ((k + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Caps use their own vertices so the side normals stay smooth.
  const cap = (r, s, front) => {
    const base = positions.length / 3;
    positions.push(0, (s.top + s.bottom) / 2, s.z);
    for (const p of r) positions.push(...p);
    for (let k = 0; k < segments; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % segments);
      if (front) indices.push(base, a, b);
      else indices.push(base, b, a);
    }
  };
  cap(rings[0], stations[0], false);
  const last = stations[stations.length - 1];
  if (last.hw > 0.005) cap(rings[rings.length - 1], last, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// A thin rod between two points.
export function rod(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// ---------- Cabins: hollow bodies with window and door openings ----------

export const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff1ff,
  roughness: 0.04,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const linerMat = new THREE.MeshStandardMaterial({ color: 0xf3ede1, roughness: 0.8, side: THREE.BackSide });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x9a8a78, roughness: 0.9 });

// Superellipse section helpers.
const sectionPoint = (s, a, power) => {
  const e = 2 / power;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  return [s.hw * Math.sign(c) * Math.abs(c) ** e, cy + hh * Math.sign(n) * Math.abs(n) ** e];
};
export const sectionX = (s, y, power) => {
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  const k = Math.min(1, Math.abs((y - cy) / hh));
  return s.hw * (1 - k ** power) ** (1 / power);
};

// Like loft(), but rings share an angle list that lands exactly on every
// cut height, so rectangular openings can be removed cleanly.
function shellGeometry(stations, ref, cuts, { segments, power, openFront = false }) {
  const cy = (ref.top + ref.bottom) / 2;
  const hh = (ref.top - ref.bottom) / 2;
  const angles = [];
  for (let k = 0; k < segments; k++) angles.push((k / segments) * Math.PI * 2);
  for (const c of cuts) {
    for (const y of [c.y0, c.y1]) {
      const s = (y - cy) / hh;
      const ar = Math.asin(Math.sign(s) * Math.abs(s) ** (power / 2));
      angles.push(THREE.MathUtils.euclideanModulo(ar, Math.PI * 2), Math.PI - ar);
    }
  }
  angles.sort((a, b) => a - b);
  const A = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-4);
  const n = A.length;

  const positions = [];
  const indices = [];
  for (const s of stations) {
    for (const a of A) {
      const [x, y] = sectionPoint(s, a, power);
      positions.push(x, y, s.z);
    }
  }
  const eps = 1e-4;
  for (let i = 0; i < stations.length - 1; i++) {
    const z0 = stations[i].z;
    const z1 = stations[i + 1].z;
    for (let k = 0; k < n; k++) {
      const a0 = A[k];
      const a1 = k + 1 < n ? A[k + 1] : A[0] + Math.PI * 2;
      const am = (a0 + a1) / 2;
      const [xm, ym] = sectionPoint(stations[i], am, power);
      const open = cuts.some(
        (c) => z0 >= c.z0 - eps && z1 <= c.z1 + eps && ym > c.y0 && ym < c.y1 && Math.abs(xm) > ref.hw * 0.6,
      );
      if (open) continue;
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      indices.push(a, b, a + n, b, b + n, a + n);
    }
  }
  const cap = (si, front) => {
    const s = stations[si];
    const base = positions.length / 3;
    positions.push(0, (s.top + s.bottom) / 2, s.z);
    for (const a of A) {
      const [x, y] = sectionPoint(s, a, power);
      positions.push(x, y, s.z);
    }
    for (let k = 0; k < n; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % n);
      if (front) indices.push(base, a, b);
      else indices.push(base, b, a);
    }
  };
  cap(0, false);
  if (!openFront && stations[stations.length - 1].hw > 0.005) cap(stations.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function frameGeometry(w, h, border, depth) {
  const shape = new THREE.Shape();
  const W = w / 2 + border;
  const H = h / 2 + border;
  shape.moveTo(-W, -H).lineTo(W, -H).lineTo(W, H).lineTo(-W, H).lineTo(-W, -H);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2, -h / 2).lineTo(-w / 2, h / 2).lineTo(w / 2, h / 2).lineTo(w / 2, -h / 2).lineTo(-w / 2, -h / 2);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // face along x
  return geo;
}

const seatGeo = {
  cushion: new RoundedBoxGeometry(0.15, 0.04, 0.13, 2, 0.018),
  back: new RoundedBoxGeometry(0.15, 0.17, 0.035, 2, 0.016),
  leg: new THREE.BoxGeometry(0.03, 0.07, 0.03),
};

// Builds the car body as a painted shell with real openings, glass, sliding
// doors, a floor and seats. Fills vehicle.seats and vehicle.doors.
export function buildCabin(v, o) {
  const power = o.power ?? 5;
  const segments = o.segments ?? 44;
  const ref = o.ref;
  const cuts = [];
  for (const w of o.windows) cuts.push({ z0: w.z - w.w / 2, z1: w.z + w.w / 2, y0: o.winY[0], y1: o.winY[1] });
  for (const d of o.doors) cuts.push({ z0: d.z - d.w / 2, z1: d.z + d.w / 2, y0: o.floorY, y1: o.doorTop });

  const zs = new Set([o.z0, o.z1]);
  for (const c of cuts) zs.add(c.z0).add(c.z1);
  const stations = [...zs].sort((a, b) => a - b).map((z) => ({ z, ...ref }));
  if (o.nose) stations.push(...o.nose);
  const geo = shellGeometry(stations, ref, cuts, { segments, power, openFront: o.openFront });

  const outer = shadowed(new THREE.Mesh(geo, o.paint));
  const liner = new THREE.Mesh(geo, linerMat);
  v.body.add(outer, liner);
  v.hw = ref.hw;
  v.floorY = o.floorY;

  const frameMat = o.frameMat ?? M.frame;
  const winH = o.winY[1] - o.winY[0];
  const winCy = (o.winY[0] + o.winY[1]) / 2;
  const xAtWin = sectionX(ref, winCy, power);
  for (const side of [-1, 1]) {
    for (const w of o.windows) {
      const f = new THREE.Mesh(frameGeometry(w.w, winH, 0.018, 0.016), frameMat);
      f.position.set(side * (xAtWin + 0.004), winCy, w.z);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w.w, winH), glassMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(side * xAtWin, winCy, w.z);
      g.renderOrder = 2;
      v.body.add(f, g);
    }
  }

  // Sliding doors on both sides.
  v.doors = [];
  const doorH = o.doorTop - o.floorY;
  const doorCy = (o.doorTop + o.floorY) / 2;
  const xAtDoor = sectionX(ref, doorCy, power);
  for (const side of [-1, 1]) {
    for (const d of o.doors) {
      const panel = new THREE.Group();
      const leaf = box(0.016, doorH, d.w, o.doorMat, 0.01);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 0.5, doorH * 0.32), glassMat);
      pane.rotation.y = Math.PI / 2;
      pane.position.set(side * 0.009, doorH * 0.18, 0);
      panel.add(leaf, pane);
      panel.position.set(side * (xAtDoor + 0.012), doorCy, d.z);
      const frame = new THREE.Mesh(frameGeometry(d.w, doorH, 0.014, 0.014), frameMat);
      frame.position.set(side * (xAtDoor + 0.003), doorCy, d.z);
      v.body.add(panel, frame);
      v.doors.push({ z: d.z, w: d.w, dir: d.z > 0.01 ? -1 : 1, side, panel, t: 0, outsideX: side * (ref.hw + 0.11), insideX: side * (xAtDoor - 0.1) });
    }
  }

  // Floor
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ref.hw * 1.9, 0.02, o.z1 - o.z0 - 0.04), floorMat);
  floor.position.set(0, o.floorY - 0.01, (o.z0 + o.z1) / 2);
  v.body.add(floor);

  // Seats, all facing the car's front (+z).
  const cushionMat = mat(o.seatColor, { roughness: 0.75 });
  v.seats = [];
  for (const z of o.rows) {
    for (const x of [-o.seatX, o.seatX]) {
      const s = new THREE.Group();
      const c = new THREE.Mesh(seatGeo.cushion, cushionMat);
      c.position.y = 0.09;
      const back = new THREE.Mesh(seatGeo.back, cushionMat);
      back.position.set(0, 0.17, -0.065);
      back.rotation.x = -0.12;
      const leg = new THREE.Mesh(seatGeo.leg, M.black);
      leg.position.y = 0.035;
      s.add(c, back, leg);
      s.position.set(x, o.floorY, z);
      v.body.add(s);
      v.seats.push({ pos: new THREE.Vector3(x, o.floorY + 0.045, z + 0.005), robot: null });
    }
  }
}
