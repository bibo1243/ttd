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
