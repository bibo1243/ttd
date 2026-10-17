import * as THREE from 'three';
import { loft } from '../parts.js';
import { K, bake, matte, mesh, paint, plateTexture, rbox, rod, tube } from './kit.js';

// Two-wheelers: a Taiwanese-style scooter and a city bicycle with a basket.
// Both face +z.

function thinWheel(r, tireR, mat, spokes) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const tire = mesh(new THREE.TorusGeometry(r, tireR, 10, 32).rotateY(Math.PI / 2), K.rubber);
  spin.add(tire);
  if (spokes) {
    spin.add(mesh(new THREE.TorusGeometry(r - tireR * 0.9, tireR * 0.35, 6, 32).rotateY(Math.PI / 2), K.alloy));
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const s = mesh(new THREE.CylinderGeometry(0.0022, 0.0022, r * 1.9, 4), K.alloy);
      s.rotation.x = a;
      spin.add(s);
    }
    spin.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 10).rotateZ(Math.PI / 2), K.chrome));
  } else {
    const rim = mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, tireR * 1.6, 20).rotateZ(Math.PI / 2), mat);
    spin.add(rim, mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, tireR * 1.9, 14).rotateZ(Math.PI / 2), K.chrome));
    for (let i = 0; i < 5; i++) {
      const s = mesh(new THREE.BoxGeometry(tireR * 1.7, r * 0.7, 0.008), K.trim);
      s.rotation.x = (i / 5) * Math.PI * 2;
      s.position.set(0, 0, 0);
      s.geometry.translate(0, r * 0.3, 0);
      spin.add(s);
    }
  }
  g.add(spin);
  return { obj: g, spin, r };
}

export function makeScooter(color = 0x4a90c8) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const P = paint(color);
  const R = 0.075;
  const wz = [0.22, -0.2];

  // Rear body under the seat: a rounded loft.
  const keys = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const z = -0.33 + t * 0.34;
    const e = Math.abs(t - 0.45) / 0.55;
    const k = Math.sqrt(Math.max(0, 1 - e ** 3));
    keys.push({ z, hw: 0.075 * (0.6 + 0.4 * k), bottom: 0.11 + 0.04 * (1 - k) + (t < 0.4 ? 0.06 * (0.4 - t) : 0), top: 0.27 + 0.02 * k - 0.05 * (1 - k) });
  }
  body.add(mesh(loft(keys, { segments: 28, power: 3 }), P));
  // Floorboard and front shield.
  body.add(rbox(0.12, 0.035, 0.2, 0.015, K.trim, 0, 0.12, 0.06));
  body.add(rbox(0.13, 0.025, 0.21, 0.012, P, 0, 0.1, 0.06));
  const shield = rbox(0.15, 0.27, 0.05, 0.03, P, 0, 0.27, 0.18);
  shield.rotation.x = -0.32;
  body.add(shield);
  const fender = rbox(0.06, 0.03, 0.14, 0.014, P, 0, R * 2 + 0.03, wz[0] + 0.01);
  fender.rotation.x = 0.1;
  body.add(fender);
  // Fork and handlebar column.
  for (const x of [-0.025, 0.025]) body.add(rod(new THREE.Vector3(x, R, wz[0]), new THREE.Vector3(x, 0.33, 0.2), 0.008, K.alloy));
  body.add(rod(new THREE.Vector3(0, 0.33, 0.2), new THREE.Vector3(0, 0.42, 0.17), 0.016, K.trim));
  const bar = rod(new THREE.Vector3(-0.11, 0.43, 0.16), new THREE.Vector3(0.11, 0.43, 0.16), 0.008, K.alloy);
  body.add(bar);
  for (const x of [-0.1, 0.1]) body.add(rod(new THREE.Vector3(x * 0.85, 0.43, 0.16), new THREE.Vector3(x * 1.15, 0.43, 0.16), 0.014, K.rubber));
  // Handlebar cover with headlight, speedo and indicators.
  body.add(rbox(0.13, 0.05, 0.08, 0.022, P, 0, 0.44, 0.18));
  const lamp = mesh(new THREE.SphereGeometry(0.028, 16, 12), K.head, 0, 0.44, 0.22);
  lamp.scale.z = 0.5;
  body.add(lamp, mesh(new THREE.TorusGeometry(0.029, 0.005, 6, 18), K.chrome, 0, 0.44, 0.221));
  for (const x of [-0.06, 0.06]) body.add(rbox(0.025, 0.015, 0.02, 0.006, K.amber, x, 0.44, 0.215));
  body.add(rbox(0.05, 0.012, 0.03, 0.005, matte(0x1d2733, 0.15, { metalness: 0.4 }), 0, 0.468, 0.16));
  // Mirrors.
  for (const x of [-0.1, 0.1]) {
    const tip = new THREE.Vector3(x * 1.05, 0.52, 0.13);
    body.add(rod(new THREE.Vector3(x * 0.8, 0.44, 0.15), tip, 0.004, K.trim));
    const m = mesh(new THREE.SphereGeometry(0.018, 12, 8), K.chrome, tip.x, tip.y + 0.01, tip.z);
    m.scale.set(1.3, 1, 0.4);
    body.add(m);
  }
  // Seat, grab rail, tail light, exhaust, plate.
  body.add(rbox(0.105, 0.04, 0.22, 0.02, matte(0x2b2420, 0.5), 0, 0.295, -0.13));
  body.add(rod(new THREE.Vector3(-0.05, 0.3, -0.26), new THREE.Vector3(0.05, 0.3, -0.26), 0.007, K.alloy));
  body.add(rbox(0.06, 0.025, 0.02, 0.008, K.tail, 0, 0.24, -0.335));
  body.add(mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.14, 12).rotateX(Math.PI / 2 + 0.15), K.chrome, -0.07, 0.11, -0.25));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.035), new THREE.MeshStandardMaterial({ map: plateTexture(`M${Math.floor(Math.random() * 900 + 100)}`), roughness: 0.4 }));
  plate.position.set(0, 0.19, -0.33);
  plate.rotation.set(0.2, Math.PI, 0);
  body.add(plate);
  // Kickstand-side engine cover.
  body.add(rbox(0.04, 0.07, 0.13, 0.02, K.trim, 0.05, 0.12, -0.17));

  const wheels = [];
  for (const z of wz) {
    const w = thinWheel(R, 0.022, K.alloy, 0);
    w.obj.position.set(0, R, z);
    group.add(w.obj);
    wheels.push(w);
  }
  bake(body);
  return {
    kind: 'scooter',
    group,
    body,
    wheels,
    steerers: [],
    seats: [
      { pos: new THREE.Vector3(0, 0.275, -0.06), robot: null, pose: 'scooter' },
      { pos: new THREE.Vector3(0, 0.29, -0.2), robot: null, pose: 'scooter' },
    ],
    len: 0.7,
    hw: 0.11,
    riderScale: 0.9,
    helmets: true,
    lean: true,
  };
}

export function makeBicycle(color = 0x2e8b6e) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const P = paint(color, { metal: 0.4 });
  const R = 0.12;
  const rear = new THREE.Vector3(0, R, -0.22);
  const front = new THREE.Vector3(0, R, 0.24);
  const bb = new THREE.Vector3(0, 0.12, -0.02);
  const seatTop = new THREE.Vector3(0, 0.31, -0.1);
  const headTop = new THREE.Vector3(0, 0.32, 0.16);
  const headBot = new THREE.Vector3(0, 0.25, 0.18);
  const r = 0.009;
  body.add(rod(seatTop, bb, r, P), rod(bb, headBot, r * 1.1, P), rod(seatTop.clone().setY(0.28), headTop.clone().setY(0.29), r, P), rod(headBot, headTop, r * 1.3, P));
  for (const x of [-0.018, 0.018]) {
    body.add(rod(bb.clone().setX(x), rear.clone().setX(x), r * 0.7, P), rod(seatTop.clone().setX(x).setY(0.28), rear.clone().setX(x), r * 0.7, P));
    body.add(rod(headBot.clone().setX(x * 0.8), front.clone().setX(x * 1.2), r * 0.8, K.alloy));
  }
  // Saddle and post.
  body.add(rod(seatTop, seatTop.clone().setY(0.34), 0.007, K.alloy));
  const saddle = rbox(0.07, 0.025, 0.11, 0.012, matte(0x5a3a28, 0.5), 0, 0.35, -0.11);
  body.add(saddle);
  // Handlebar, grips, bell.
  const stemTop = new THREE.Vector3(0, 0.37, 0.15);
  body.add(rod(headTop, stemTop, 0.008, K.alloy));
  const bar = tube([new THREE.Vector3(-0.1, 0.37, 0.11), new THREE.Vector3(-0.05, 0.375, 0.145), new THREE.Vector3(0.05, 0.375, 0.145), new THREE.Vector3(0.1, 0.37, 0.11)], 0.006, K.alloy);
  body.add(bar);
  for (const x of [-0.095, 0.095]) body.add(rod(new THREE.Vector3(x, 0.37, 0.115), new THREE.Vector3(x * 1.05, 0.37, 0.085), 0.011, K.rubber));
  body.add(mesh(new THREE.SphereGeometry(0.012, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), K.chrome, 0.06, 0.38, 0.14));
  // Wicker basket and lamp.
  const wick = matte(0xc89a5a, 0.85);
  const bz = 0.29;
  body.add(rbox(0.13, 0.01, 0.1, 0.004, wick, 0, 0.28, bz));
  for (const [w, d, x, z] of [[0.13, 0.006, 0, bz - 0.05], [0.13, 0.006, 0, bz + 0.05], [0.006, 0.1, -0.065, bz], [0.006, 0.1, 0.065, bz]]) {
    for (let k = 0; k < 3; k++) body.add(rbox(w, 0.012, d, 0.003, wick, x, 0.3 + k * 0.025, z));
  }
  body.add(rod(new THREE.Vector3(0, 0.28, 0.24), headBot, 0.004, K.alloy));
  const lamp = mesh(new THREE.SphereGeometry(0.018, 14, 10), K.head, 0, 0.25, 0.235);
  lamp.scale.z = 0.6;
  body.add(lamp);
  body.add(rbox(0.03, 0.02, 0.012, 0.005, K.tail, 0, 0.27, -0.165));
  // Fenders.
  for (const c of [rear, front]) {
    const f = mesh(new THREE.TorusGeometry(R + 0.018, 0.012, 6, 20, Math.PI * 0.75).rotateY(Math.PI / 2), P, 0, c.y, c.z);
    f.rotation.x = c === rear ? -0.3 : Math.PI * 0.55;
    f.scale.x = 2;
    body.add(f);
  }

  // Crank: turns with the pedalling.
  const crank = new THREE.Group();
  crank.position.copy(bb);
  crank.add(mesh(new THREE.TorusGeometry(0.04, 0.005, 6, 24).rotateY(Math.PI / 2), K.chrome, -0.03, 0, 0));
  for (const s of [-1, 1]) {
    const arm = rbox(0.008, 0.07, 0.014, 0.004, K.alloy, s * 0.04, -s * 0.03, 0);
    const pedal = rbox(0.035, 0.008, 0.02, 0.003, K.trim, s * 0.055, -s * 0.06, 0);
    crank.add(arm, pedal);
  }
  group.add(crank);

  const wheels = [];
  for (const c of [front, rear]) {
    const w = thinWheel(R, 0.011, K.alloy, 14);
    w.obj.position.copy(c);
    group.add(w.obj);
    wheels.push(w);
  }
  bake(body);
  return {
    kind: 'bicycle',
    group,
    body,
    wheels,
    steerers: [],
    crank,
    seats: [{ pos: new THREE.Vector3(0, 0.315, -0.1), robot: null, pose: 'pedal' }],
    len: 0.62,
    hw: 0.11,
    riderScale: 0.9,
    lean: true,
  };
}
