import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loft } from '../parts.js';
import {
  K,
  arcPoints,
  bake,
  carWheel,
  glow,
  matte,
  mesh,
  paint,
  plateTexture,
  rbox,
  rod,
  smoothSections,
  textTexture,
  tube,
  widthAt,
  FONT,
} from './kit.js';

// Little cars in the same tiny, rounded style as the trains: a glossy lower
// body, a glass bubble you can see the riders through, and a full interior.
// Every car faces +z, with its left side (driver's side) toward +x.

const BODY_POWER = 4;
const GLASS_POWER = 3.4;

function lowerBody({ L, hw, bottom, top, wheelZ, archR, wheelR }) {
  const n = 64;
  const end = 0.13;
  const s = [];
  for (let i = 0; i <= n; i++) {
    const z = -L / 2 + (L * i) / n;
    const e = Math.max(0, (Math.abs(z) - (L / 2 - end)) / end);
    const round = Math.sqrt(Math.max(0, 1 - e * e));
    let b = bottom + 0.05 * (1 - round);
    for (const wz of wheelZ) {
      const dz = Math.abs(z - wz);
      if (dz < archR) b = Math.max(b, wheelR + Math.sqrt(archR * archR - dz * dz));
    }
    const front = z > 0 ? THREE.MathUtils.smoothstep(z, L / 2 - 0.3, L / 2) * 0.03 : 0;
    s.push({ z, hw: hw * (0.72 + 0.28 * round), bottom: b, top: top - front - (top - bottom) * 0.3 * (1 - round) });
  }
  return s;
}

function seat(material, x, y, z, w = 0.16) {
  const g = new THREE.Group();
  g.add(rbox(w, 0.045, 0.15, 0.018, material, 0, 0.02, 0));
  const back = rbox(w, 0.2, 0.04, 0.018, material, 0, 0.12, -0.075);
  back.rotation.x = -0.14;
  const rest = rbox(w * 0.6, 0.05, 0.035, 0.015, material, 0, 0.245, -0.09);
  g.add(back, rest);
  g.position.set(x, y, z);
  return g;
}

const PLATES = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const plateText = () =>
  `${PLATES[Math.floor(Math.random() * PLATES.length)]}${PLATES[Math.floor(Math.random() * PLATES.length)]}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

function plate(z, y, facing) {
  const tex = plateTexture(plateText());
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.045), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
  m.position.set(0, y, z);
  if (facing < 0) m.rotation.y = Math.PI;
  return m;
}

const SHAPES = {
  sedan: {
    L: 1.2,
    glass: [
      [0.41, 0.3, 0.17],
      [0.33, 0.56, 0.22],
      [0.24, 0.72, 0.235],
      [0.13, 0.79, 0.24],
      [-0.17, 0.795, 0.24],
      [-0.27, 0.745, 0.235],
      [-0.35, 0.58, 0.22],
      [-0.42, 0.3, 0.17],
    ],
    roof: [-0.19, 0.15],
    hoops: [0.215, -0.05, -0.285],
    rows: [0.06, -0.2],
    dash: 0.31,
  },
  van: {
    L: 1.28,
    glass: [
      [0.5, 0.3, 0.17],
      [0.43, 0.56, 0.22],
      [0.35, 0.73, 0.235],
      [0.24, 0.8, 0.24],
      [0.05, 0.805, 0.24],
      [-0.05, 0.8, 0.24],
    ],
    roof: null,
    hoops: [0.31],
    rows: [0.17],
    dash: 0.41,
    cargo: [-0.64, 0.06],
  },
};

// kind: 'sedan' | 'taxi' | 'van'
export function makeCar(kind = 'sedan', color = 0xe8574a) {
  const shape = SHAPES[kind === 'van' ? 'van' : 'sedan'];
  const L = shape.L;
  const hw = 0.27;
  const bottom = 0.1;
  const deck = 0.32;
  const wheelR = 0.11;
  const wheelZ = [L / 2 - 0.22, -L / 2 + 0.22];
  const P = paint(color);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Lower body with wheel arches, and dark wells so the arches read as openings.
  const lower = lowerBody({ L, hw, bottom, top: deck + 0.025, wheelZ, archR: 0.14, wheelR });
  body.add(mesh(loft(lower, { segments: 44, power: BODY_POWER }), P));
  for (const z of wheelZ) body.add(rbox(0.36, 0.14, 0.27, 0.03, K.under, 0, 0.18, z));

  // Interior: floor mat, seats, dashboard and steering wheel.
  const seatMat = matte(kind === 'taxi' ? 0x3b3f48 : 0xd9c7a8, 0.75);
  const midZ = (shape.glass[0][0] + shape.glass[shape.glass.length - 1][0]) / 2;
  body.add(rbox(0.38, 0.01, Math.abs(shape.glass[0][0] - shape.glass[shape.glass.length - 1][0]) - 0.1, 0.004, matte(0x4a4642, 0.9), 0, deck + 0.002, midZ));
  const seats = [];
  for (const z of shape.rows) {
    for (const x of [0.105, -0.105]) {
      body.add(seat(seatMat, x, deck, z));
      seats.push({ pos: new THREE.Vector3(x, deck + 0.04, z + 0.01), robot: null });
    }
  }
  const dash = rbox(0.42, 0.075, 0.1, 0.03, K.trim, 0, deck + 0.05, shape.dash);
  const wheelPos = new THREE.Vector3(0.105, deck + 0.14, shape.dash - 0.08);
  const steer = mesh(new THREE.TorusGeometry(0.042, 0.008, 8, 24), K.trim, wheelPos.x, wheelPos.y, wheelPos.z);
  steer.rotation.x = -0.45;
  body.add(dash, steer, rod(wheelPos, new THREE.Vector3(0.105, deck + 0.08, shape.dash - 0.03), 0.007, K.trim));
  body.add(rbox(0.07, 0.03, 0.02, 0.008, glow(0x6fd6ff, 0.8, 0x123040), -0.02, deck + 0.09, shape.dash - 0.045));

  // Glass bubble.
  const glassKeys = shape.glass.map(([z, top, ghw]) => ({ z, top, hw: ghw, bottom: deck - 0.07 }));
  const glassSecs = smoothSections(glassKeys, 36);
  const bubble = mesh(loft(glassSecs, { segments: 40, power: GLASS_POWER }), K.bubble);
  bubble.castShadow = false;
  bubble.renderOrder = 2;
  body.add(bubble);
  const fine = smoothSections(glassKeys, 240);
  const secAt = (z) => {
    let best = fine[0];
    for (const s of fine) if (Math.abs(s.z - z) < Math.abs(best.z - z)) best = s;
    return best;
  };

  // Pillars follow the bubble's outline; a chrome strip runs along its base.
  shape.hoops.forEach((z, i) => {
    const s = { ...secAt(z), z };
    const m = i === 1 ? K.trim : P;
    body.add(tube(arcPoints(s, GLASS_POWER, deck + 0.01, null, 18, 1.012), i === 1 ? 0.011 : 0.014, m));
  });
  for (const side of [-1, 1]) {
    const pts = glassSecs
      .filter((s, i) => i % 3 === 0 && s.top > deck + 0.06)
      .map((s) => new THREE.Vector3(side * widthAt(s, deck + 0.012, GLASS_POWER) * 1.01, deck + 0.012, s.z));
    body.add(tube(pts, 0.006, K.chrome));
  }
  if (shape.roof) {
    const [r0, r1] = shape.roof;
    const keys = [];
    for (let i = 0; i <= 10; i++) {
      const z = r0 + ((r1 - r0) * i) / 10;
      const s = secAt(z);
      const e = Math.abs(i / 10 - 0.5) * 2;
      const k = Math.sqrt(1 - e ** 6);
      keys.push({ z, hw: widthAt(s, s.top - 0.045, GLASS_POWER) * 1.04 * (0.85 + 0.15 * k), top: s.top + 0.012, bottom: s.top - 0.045 * k - 0.004 });
    }
    body.add(mesh(loft(keys, { segments: 32, power: 6 }), P));
  }

  // Cargo box for the van, with a painted shop logo on each side.
  if (shape.cargo) {
    const [c0, c1] = shape.cargo;
    const box = rbox(0.54, 0.54, c1 - c0, 0.06, paint(0xf6f4ee, { metal: 0.1 }), 0, deck + 0.26, (c0 + c1) / 2);
    body.add(box);
    const logo = textTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#' + new THREE.Color(color).getHexString();
      g.beginPath();
      g.roundRect(10, 22, w - 20, h - 44, 40);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `800 50px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('迷你快遞', w / 2, h / 2 + 3);
    });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.4, transparent: true }));
      m.position.set(side * 0.2705, deck + 0.3, (c0 + c1) / 2);
      m.rotation.y = side * Math.PI / 2;
      body.add(m);
    }
    body.add(rbox(0.5, 0.03, 0.02, 0.01, K.chrome, 0, deck + 0.05, c0 - 0.005));
    body.add(rbox(0.008, 0.42, 0.012, 0.004, K.trim, 0, deck + 0.27, c0 - 0.004));
    for (const side of [-1, 1]) {
      body.add(rbox(0.05, 0.12, 0.02, 0.01, K.tail, side * 0.215, deck + 0.1, c0 - 0.006));
      body.add(rbox(0.05, 0.04, 0.02, 0.01, K.amber, side * 0.215, deck + 0.19, c0 - 0.006));
      body.add(rod(new THREE.Vector3(side * 0.06, deck + 0.18, c0 - 0.012), new THREE.Vector3(side * 0.06, deck + 0.34, c0 - 0.012), 0.008, K.chrome));
    }
  }

  // Front: headlights with chrome bezels, grille, bumper, plate, indicators.
  const fz = L / 2;
  for (const side of [-1, 1]) {
    const lamp = mesh(new THREE.SphereGeometry(0.046, 20, 14), K.head, side * 0.165, 0.255, fz - 0.035);
    lamp.scale.z = 0.55;
    const bezel = mesh(new THREE.TorusGeometry(0.047, 0.008, 8, 24), K.chrome, side * 0.165, 0.255, fz - 0.033);
    const ind = rbox(0.04, 0.022, 0.03, 0.01, K.amber, side * 0.205, 0.19, fz - 0.03);
    body.add(lamp, bezel, ind);
  }
  body.add(rbox(0.17, 0.055, 0.03, 0.015, K.trim, 0, 0.235, fz - 0.025));
  for (const y of [0.225, 0.245]) body.add(rbox(0.15, 0.006, 0.01, 0.003, K.chrome, 0, y, fz - 0.008));
  body.add(rbox(0.52, 0.065, 0.075, 0.03, K.bumper, 0, 0.145, fz - 0.04));
  body.add(plate(fz + 0.0, 0.145, 1));

  // Rear: tail lights, bumper, plate, exhaust.
  const bz = -L / 2;
  for (const side of [-1, 1]) body.add(rbox(0.075, 0.045, 0.03, 0.012, K.tail, side * 0.17, 0.27, bz + 0.03));
  body.add(rbox(0.52, 0.065, 0.075, 0.03, K.bumper, 0, 0.145, bz + 0.04));
  body.add(plate(bz - 0.0, 0.15, -1));
  const pipe = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 12).rotateX(Math.PI / 2), K.chrome, -0.15, 0.1, bz + 0.03);
  body.add(pipe);

  // Sides: door seams, handles, mirrors.
  const mid = lower[Math.floor(lower.length / 2)];
  const sideX = (y) => widthAt(mid, y, BODY_POWER);
  const seams = kind === 'van' ? [shape.rows[0] + 0.15, shape.rows[0] - 0.15] : [0.22, -0.06];
  for (const side of [-1, 1]) {
    for (const z of seams) {
      const at = lower.reduce((b, q) => (Math.abs(q.z - z) < Math.abs(b.z - z) ? q : b));
      const pts = arcPoints({ ...at, z }, BODY_POWER, at.bottom + 0.05, deck + 0.015, 8, 1.004);
      for (const p of pts) p.x *= side;
      body.add(tube(pts, 0.0032, K.trim));
    }
    const handles = kind === 'van' ? [shape.rows[0] - 0.05] : [0.12, -0.15];
    for (const z of handles) body.add(rbox(0.012, 0.014, 0.05, 0.006, K.chrome, side * (sideX(0.28) + 0.004), 0.28, z));
    const mz = shape.hoops[0] - 0.01;
    const arm = rod(new THREE.Vector3(side * 0.21, deck + 0.03, mz), new THREE.Vector3(side * 0.275, deck + 0.06, mz), 0.008, K.trim);
    const mirror = rbox(0.03, 0.045, 0.06, 0.014, P, side * 0.285, deck + 0.065, mz);
    const glassM = rbox(0.006, 0.035, 0.045, 0.002, K.chrome, side * 0.285, deck + 0.065, mz - 0.031);
    glassM.rotation.y = Math.PI / 2;
    body.add(arm, mirror, glassM);
  }

  // Taxi: roof light and a checker band.
  if (kind === 'taxi') {
    const sign = textTexture(128, 48, (g, w, h) => {
      g.fillStyle = '#fff7d6';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2b2e35';
      g.font = `900 34px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TAXI', w / 2, h / 2 + 2);
    });
    const signMat = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffe2a0, emissiveIntensity: 0.55, emissiveMap: sign, roughness: 0.3 });
    const top = secAt(0).top + 0.012;
    body.add(rbox(0.2, 0.06, 0.09, 0.025, matte(0xfff4d0, 0.3), 0, top + 0.03, -0.02));
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), signMat);
      m.position.set(0, top + 0.032, -0.02 + side * 0.0455);
      if (side < 0) m.rotation.y = Math.PI;
      body.add(m);
    }
    const checker = textTexture(256, 16, (g, w, h) => {
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? '#24262c' : '#fff6dc';
          g.fillRect(i * 8, j * 8, 8, 8);
        }
      }
    });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.028), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.35 }));
      m.position.set(side * (sideX(0.235) + 0.003), 0.235, -0.03);
      m.rotation.y = side * Math.PI / 2;
      body.add(m);
    }
  }

  // Wheels: steer at the front, all spin.
  const wheels = [];
  const steerers = [];
  for (const z of wheelZ) {
    for (const side of [-1, 1]) {
      const w = carWheel(wheelR, 0.085);
      w.obj.position.set(side * 0.228, wheelR, z);
      if (side < 0) w.obj.rotation.y = Math.PI;
      group.add(w.obj);
      wheels.push(w);
      if (z > 0) steerers.push(w.obj);
    }
  }

  bake(body);
  return {
    kind,
    group,
    body,
    wheels,
    steerers,
    seats,
    len: L,
    hw,
    riderScale: 0.85,
  };
}
