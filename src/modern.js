import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M, Vehicle, axle, box, loft, mat, rod, shadowed } from './parts.js';

const glass = mat(0x22303d, { roughness: 0.08, metalness: 0.4, envMapIntensity: 1.6 });
const headLamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c4, emissiveIntensity: 1.4 });
const tailLamp = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
const sign = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffa630, emissiveIntensity: 0.9 });
const under = mat(0x3a3f4a, { roughness: 0.8 });
const bogieMat = mat(0x5a606b, { roughness: 0.6, metalness: 0.3 });

const surface = (paint) =>
  shadowed(
    new THREE.Mesh(
      undefined,
      new THREE.MeshPhysicalMaterial({
        color: paint,
        roughness: 0.32,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
      }),
    ),
  );

function bodyMesh(stations, paint, opts) {
  const m = surface(paint);
  m.geometry = loft(stations, opts);
  return m;
}

function bogie(z, group, wheels, radius) {
  const frame = box(0.5, 0.07, 0.42, bogieMat, 0.02);
  frame.position.set(0, radius + 0.06, z);
  group.add(frame);
  for (const dz of [-0.12, 0.12]) group.add(axle(radius, z + dz, wheels, M.carWheel, M.steel));
}

// Single-arm pantograph, folded at a cute angle.
function pantograph(y, z) {
  const g = new THREE.Group();
  g.position.set(0, y, z);
  const base = box(0.3, 0.03, 0.24, M.black, 0.01);
  g.add(base);
  for (const x of [-0.11, 0.11]) {
    const ins = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8), mat(0xe9e2d0)));
    ins.position.set(x, -0.03, x > 0 ? 0.08 : -0.08);
    g.add(ins);
  }
  const knee = new THREE.Vector3(0, 0.14, 0.1);
  const top = new THREE.Vector3(0, 0.25, -0.1);
  g.add(rod(new THREE.Vector3(0, 0.02, -0.1), knee, 0.012, M.steel));
  g.add(rod(knee, top, 0.01, M.steel));
  const head = rod(new THREE.Vector3(-0.2, 0.25, -0.1), new THREE.Vector3(0.2, 0.25, -0.1), 0.014, M.black);
  g.add(head);
  return g;
}

// ---------- High-speed train ----------

const HSR = { hw: 0.33, bottom: 0.36, top: 0.92 };
const HSR_NOSE = 0.95;

function hsrNose(t) {
  // Long, gently drooping nose that tapers to a rounded tip.
  const hw = HSR.hw * Math.max(0.03, (1 - t ** 2.4) ** 0.55);
  const bottom = HSR.bottom + 0.1 * t ** 2;
  const height = (HSR.top - HSR.bottom) * Math.max(0.05, (1 - t ** 1.3) ** 0.8);
  return { hw, bottom, top: bottom + height };
}

export class BulletCar extends Vehicle {
  // kind: 'head' | 'mid' | 'tail'
  constructor(kind, index = 0) {
    const cab = kind !== 'mid';
    super(cab ? 2.1 : 1.7, 0.6);
    const b = this.body;
    const half = this.length / 2;
    const white = 0xf4f6f8;
    const stripe = mat(0x1f5fbf, { roughness: 0.35 });
    const stripeLight = mat(0x6fb6f0, { roughness: 0.35 });

    const straightEnd = cab ? half - HSR_NOSE : half;
    const stations = [
      { z: -half, ...HSR },
      { z: straightEnd, ...HSR },
    ];
    if (cab) {
      const n = 18;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        stations.push({ z: straightEnd + t * HSR_NOSE, ...hsrNose(t) });
      }
    }
    b.add(bodyMesh(stations, white, { segments: 48, power: 5 }));

    // Livery stripes and windows along the straight section.
    const len = straightEnd + half - 0.12;
    const mid = (straightEnd - half) / 2;
    for (const side of [-1, 1]) {
      const x = side * (HSR.hw + 0.002);
      const s1 = box(0.012, 0.05, len, stripe, 0.006);
      s1.position.set(x, 0.53, mid);
      const s2 = box(0.012, 0.018, len, stripeLight, 0.004);
      s2.position.set(x, 0.585, mid);
      b.add(s1, s2);

      const winGeo = new RoundedBoxGeometry(0.014, 0.13, 0.15, 2, 0.03);
      const start = -half + 0.32;
      const end = straightEnd - (cab ? 0.34 : 0.32);
      const count = Math.floor((end - start) / 0.21) + 1;
      for (let i = 0; i < count; i++) {
        const w = new THREE.Mesh(winGeo, glass);
        w.position.set(x, 0.72, start + i * 0.21);
        b.add(w);
      }
      // Doors near the car ends
      const doorZ = cab ? [-half + 0.14, straightEnd - 0.16] : [-half + 0.14, half - 0.14];
      for (const z of doorZ) {
        const d = box(0.012, 0.36, 0.13, mat(0xdfe4ea, { roughness: 0.4 }), 0.01);
        d.position.set(x, 0.6, z);
        const dw = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.1, 0.07, 2, 0.02), glass);
        dw.position.set(x * 1.002, 0.72, z);
        b.add(d, dw);
      }
    }

    if (cab) {
      // Cockpit windshield sits on the nose's upper slope.
      const t0 = 0.3;
      const t1 = 0.34;
      const p0 = hsrNose(t0);
      const p1 = hsrNose(t1);
      const z0 = straightEnd + t0 * HSR_NOSE;
      const slope = Math.atan2(p0.top - p1.top, (t1 - t0) * HSR_NOSE);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), glass);
      shield.scale.set(p0.hw * 0.7, 0.045, 0.22);
      shield.position.set(0, p0.top - 0.025, z0);
      shield.rotation.x = slope;
      b.add(shield);

      // Lamps low on the nose
      const tl = 0.62;
      const pl = hsrNose(tl);
      const lampGeo = new THREE.SphereGeometry(1, 16, 10);
      for (const side of [-1, 1]) {
        const l = new THREE.Mesh(lampGeo, kind === 'head' ? headLamp : tailLamp);
        l.scale.set(0.05, 0.022, 0.06);
        l.position.set(side * pl.hw * 0.62, pl.bottom + 0.07, straightEnd + tl * HSR_NOSE);
        l.rotation.y = side * 0.5;
        b.add(l);
      }
      // Nose stripe sweeps forward along the lower edge
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = (i / 12) * 0.85;
          const p = hsrNose(t);
          const y = p.bottom + Math.min(0.17, (p.top - p.bottom) * 0.35);
          // Position on the superellipse side at height y.
          const hh = (p.top - p.bottom) / 2;
          const cy = (p.top + p.bottom) / 2;
          const k = Math.min(0.999, Math.abs((y - cy) / hh));
          const x = p.hw * (1 - k ** 5) ** (1 / 5) + 0.003;
          pts.push(new THREE.Vector3(side * x, y, straightEnd + t * HSR_NOSE));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 6), stripe);
        b.add(tube);
      }
      if (kind === 'tail') b.rotation.y = Math.PI;
    } else {
      // Roof equipment, and a pantograph on every other middle car.
      const ac = box(0.36, 0.05, 0.6, mat(0xd9dde3), 0.02);
      ac.position.set(0, HSR.top + 0.01, index % 2 ? -0.35 : 0.35);
      b.add(ac);
      if (index % 2 === 0) b.add(pantograph(HSR.top + 0.02, -0.3));
    }

    // Gangway bellows on coupled ends
    const ends = kind === 'mid' ? [-half, half] : [-half];
    for (const z of ends) {
      const g = box(0.4, 0.42, 0.06, M.black, 0.03);
      g.position.set(0, 0.65, z);
      b.add(g);
    }

    // Underframe skirt and bogies
    const skirt = box(0.6, 0.08, this.length - 0.5, under, 0.03);
    skirt.position.set(0, 0.34, cab ? -0.3 : 0);
    b.add(skirt);
    for (const z of [-0.6, 0.6]) bogie(z, this.group, this.wheels, 0.09);
  }
}

// ---------- Tram ----------

const TRAM = { hw: 0.3, bottom: 0.25, top: 0.98 };

export class TramCar extends Vehicle {
  constructor(kind) {
    const cab = kind !== 'mid';
    super(1.25, 0.36);
    const b = this.body;
    const half = this.length / 2;
    const cream = 0xf7f0de;
    const green = mat(0x2e7d5b, { roughness: 0.4 });
    const gold = mat(0xe6b450, { metalness: 0.4, roughness: 0.35 });

    const stations = [{ z: -half, ...TRAM }];
    const front = cab ? 0.2 : 0;
    stations.push({ z: half - front, ...TRAM });
    if (cab) {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        stations.push({
          z: half - front + t * front,
          hw: TRAM.hw * (1 - 0.22 * t ** 2),
          bottom: TRAM.bottom + 0.03 * t ** 2,
          top: TRAM.top - 0.06 * t ** 2,
        });
      }
    }
    b.add(bodyMesh(stations, cream, { segments: 44, power: 6 }));

    const straight = this.length - front;
    const mid = -front / 2;
    for (const side of [-1, 1]) {
      const x = side * (TRAM.hw + 0.002);
      const band = box(0.012, 0.2, straight - 0.04, green, 0.01);
      band.position.set(x, 0.36, mid);
      const line = box(0.012, 0.02, straight - 0.04, gold, 0.005);
      line.position.set(x, 0.48, mid);
      b.add(band, line);

      // Big panoramic windows, with a glass door in the middle
      const winGeo = new RoundedBoxGeometry(0.014, 0.26, 0.24, 2, 0.04);
      for (const z of [-0.36, 0.3]) {
        const w = new THREE.Mesh(winGeo, glass);
        w.position.set(x, 0.74, z + mid * 0.3);
        b.add(w);
      }
      const door = box(0.014, 0.6, 0.2, green, 0.02);
      door.position.set(x, 0.56, -0.03);
      const doorGlass = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.34, 0.07, 2, 0.02), glass);
      for (const dz of [-0.045, 0.045]) {
        const dg = doorGlass.clone();
        dg.position.set(x * 1.003, 0.64, -0.03 + dz);
        b.add(dg);
      }
      b.add(door);
    }

    // Roof cap
    const roof = box(0.44, 0.05, this.length - 0.2, mat(0xe2dccb), 0.02);
    roof.position.set(0, TRAM.top + 0.005, -front / 2);
    b.add(roof);

    if (cab) {
      const fz = half + 0.001;
      const fhw = TRAM.hw * 0.78;
      const shield = new THREE.Mesh(new RoundedBoxGeometry(fhw * 1.7, 0.3, 0.02, 2, 0.05), glass);
      shield.position.set(0, 0.73, fz);
      const signBox = new THREE.Mesh(new RoundedBoxGeometry(fhw * 1.2, 0.07, 0.02, 2, 0.02), sign);
      signBox.position.set(0, 0.9, fz - 0.004);
      const bumper = box(fhw * 1.9, 0.08, 0.04, green, 0.02);
      bumper.position.set(0, 0.32, fz - 0.01);
      b.add(shield, signBox, bumper);
      for (const side of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), kind === 'head' ? headLamp : tailLamp);
        l.position.set(side * fhw * 0.7, 0.44, fz);
        b.add(l);
      }
      if (kind === 'head') b.add(pantograph(TRAM.top + 0.03, -0.1));
      if (kind === 'tail') b.rotation.y = Math.PI;
    }

    // Articulation bellows
    const ends = kind === 'mid' ? [-half, half] : [-half];
    for (const z of ends) {
      const g = box(0.42, 0.6, 0.04, M.black, 0.03);
      g.position.set(0, 0.6, z);
      b.add(g);
    }

    for (const z of [-0.36, 0.36]) {
      const frame = box(0.46, 0.06, 0.3, bogieMat, 0.02);
      frame.position.set(0, 0.17, z);
      this.group.add(frame);
      for (const dz of [-0.08, 0.08]) this.group.add(axle(0.075, z + dz, this.wheels, M.carWheel, M.steel));
    }
  }
}
