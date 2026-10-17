import * as THREE from 'three';
import { glassMat } from '../parts.js';
import { FONT, K, bake, carWheel, glow, matte, mesh, paint, plateTexture, rbox, rod, textTexture } from './kit.js';

// A Q-style city bus. Walls are extruded side profiles with real window and
// door openings, so the seated riders show through the glass. Doors are on
// the right (-x), the kerb side for right-hand traffic.

const L = 2.7;
const HW = 0.33;
const FLOOR = 0.22;
const ROOF = 1.0;
const WALL = 0.026;
const WHEEL_R = 0.13;
const WHEEL_Z = [0.86, -0.86];
const WIN = [0.5, 0.9];

const RIGHT_OPEN = [
  { z0: -1.24, z1: -0.76 },
  { z0: -0.68, z1: -0.24 },
  { door: true, z0: -0.15, z1: 0.13 },
  { z0: 0.22, z1: 0.56 },
  { z0: 0.64, z1: 0.88 },
  { door: true, z0: 0.96, z1: 1.24 },
];
const LEFT_OPEN = [
  { z0: -1.24, z1: -0.76 },
  { z0: -0.68, z1: -0.24 },
  { z0: -0.16, z1: 0.3 },
  { z0: 0.38, z1: 0.84 },
  { z0: 0.92, z1: 1.26 },
];

function roundedRectPath(path, x0, y0, x1, y1, r) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
}

// Side profile in (z, y), with wheel-arch notches along the bottom.
function sideShape(openings) {
  const s = new THREE.Shape();
  const z0 = -L / 2;
  const z1 = L / 2;
  const y0 = 0.1;
  const r = 0.12;
  const ar = 0.17;
  s.moveTo(z0 + 0.05, y0);
  for (const wz of [...WHEEL_Z].sort((a, b) => a - b)) {
    s.lineTo(wz - ar, y0);
    s.absarc(wz, WHEEL_R, ar, Math.PI, 0, true);
  }
  s.lineTo(z1 - 0.05, y0);
  s.quadraticCurveTo(z1, y0, z1, y0 + 0.05);
  s.lineTo(z1, ROOF - r);
  s.quadraticCurveTo(z1, ROOF, z1 - r, ROOF);
  s.lineTo(z0 + r, ROOF);
  s.quadraticCurveTo(z0, ROOF, z0, ROOF - r);
  s.lineTo(z0, y0 + 0.05);
  s.quadraticCurveTo(z0, y0, z0 + 0.05, y0);
  for (const o of openings) {
    const h = new THREE.Path();
    if (o.door) roundedRectPath(h, o.z0, FLOOR + 0.02, o.z1, WIN[1], 0.03);
    else roundedRectPath(h, o.z0, WIN[0], o.z1, WIN[1], 0.045);
    s.holes.push(h);
  }
  return s;
}

function wallGeometry(openings) {
  const g = new THREE.ExtrudeGeometry(sideShape(openings), {
    depth: WALL,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.rotateY(-Math.PI / 2); // shape x -> z, depth -> -x
  return g;
}

// Livery painted onto the wall's flat faces (their UVs are the profile's
// own z, y coordinates).
function livery(accent, route, mirror) {
  const tex = textTexture(1024, 384, (g, w, h) => {
    const Y = (y) => h - ((y - 0.1) / 0.9) * h;
    const Z = (z) => ((z + L / 2) / L) * w;
    g.fillStyle = '#f7f4ec';
    g.fillRect(0, 0, w, h);
    const a = '#' + new THREE.Color(accent).getHexString();
    g.fillStyle = a;
    g.fillRect(0, Y(0.42), w, Y(0.1) - Y(0.42));
    g.fillRect(0, Y(0.475), w, Y(0.46) - Y(0.475));
    g.fillRect(0, Y(1.0), w, Y(0.94) - Y(1.0));
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(0, Y(0.37), w, Y(0.355) - Y(0.37));
    // Company name and route number, drawn to read correctly from outside.
    g.save();
    g.translate(Z(-0.45), Y(0.235));
    if (mirror) g.scale(-1, 1);
    g.fillStyle = '#ffffff';
    g.font = `800 42px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(`迷你客運  ${route}`, 0, 0);
    g.restore();
  });
  tex.repeat.set(1 / L, 1 / 0.9);
  tex.offset.set(0.5, -0.1 / 0.9);
  return tex;
}

function seatGroup(material, x, z) {
  const g = new THREE.Group();
  g.add(rbox(0.17, 0.05, 0.16, 0.02, material, 0, 0.1, 0));
  const back = rbox(0.17, 0.22, 0.04, 0.02, material, 0, 0.21, -0.08);
  back.rotation.x = -0.12;
  g.add(back, rbox(0.03, 0.08, 0.1, 0.01, K.trim, 0, 0.04, 0));
  const grip = mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12, Math.PI), K.chrome, 0, 0.33, -0.1);
  g.add(grip);
  g.position.set(x, FLOOR, z);
  return g;
}

// A sliding plug door: two glazed leaves that part outward along the side.
function doorLeaves(z0, z1, side) {
  const leaves = [];
  const w = (z1 - z0) / 2;
  const h = WIN[1] - FLOOR - 0.02;
  for (const dir of [-1, 1]) {
    const g = new THREE.Group();
    const frameMat = K.trim;
    const t = 0.012;
    g.add(rbox(t, h, 0.018, 0.005, frameMat, 0, 0, -w / 2 + 0.009));
    g.add(rbox(t, h, 0.018, 0.005, frameMat, 0, 0, w / 2 - 0.009));
    g.add(rbox(t, 0.02, w, 0.005, frameMat, 0, h / 2 - 0.01, 0));
    g.add(rbox(t, 0.1, w, 0.005, frameMat, 0, -h / 2 + 0.05, 0));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.03, h - 0.13), glassMat);
    pane.rotation.y = Math.PI / 2;
    pane.position.y = 0.04;
    pane.renderOrder = 2;
    g.add(pane);
    const home = (z0 + z1) / 2 + (dir * w) / 2;
    g.position.set(side * (HW + 0.012), FLOOR + 0.02 + h / 2, home);
    leaves.push({ obj: g, home, dir, w });
  }
  return leaves;
}

export function makeBus(accent = 0x2e8b6e, route = '1') {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const right = new THREE.Mesh(wallGeometry(RIGHT_OPEN), new THREE.MeshPhysicalMaterial({ map: livery(accent, route, false), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 }));
  right.position.x = -HW + WALL;
  const left = new THREE.Mesh(wallGeometry(LEFT_OPEN), new THREE.MeshPhysicalMaterial({ map: livery(accent, route, true), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 }));
  left.position.x = HW;
  for (const w of [right, left]) {
    w.castShadow = true;
    w.receiveShadow = true;
    body.add(w);
  }

  const cream = paint(0xf7f4ec, { metal: 0.1 });
  const A = paint(accent);
  const inner = matte(0xefe9dc, 0.8);

  // Window glass.
  for (const [open, side] of [[RIGHT_OPEN, -1], [LEFT_OPEN, 1]]) {
    for (const o of open) {
      if (o.door) continue;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(o.z1 - o.z0, WIN[1] - WIN[0]), glassMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(side * (HW - WALL / 2), (WIN[0] + WIN[1]) / 2, (o.z0 + o.z1) / 2);
      g.renderOrder = 2;
      body.add(g);
    }
  }

  // Roof with a rounded edge, air conditioner and interior ceiling light.
  body.add(rbox(HW * 2 + 0.01, 0.07, L, 0.035, cream, 0, ROOF - 0.01, 0));
  body.add(rbox(0.42, 0.08, 0.7, 0.035, paint(0xdfe3e8, { metal: 0.2 }), 0, ROOF + 0.06, -0.35));
  for (const z of [-0.6, -0.45, -0.3, -0.15]) body.add(rbox(0.34, 0.012, 0.03, 0.005, K.trim, 0, ROOF + 0.1, z));
  body.add(rbox(0.08, 0.012, L - 0.4, 0.005, K.cabinLight, 0, ROOF - 0.05, 0));
  body.add(rbox(HW * 2 - 0.05, 0.02, L - 0.06, 0.008, inner, 0, ROOF - 0.045, 0));

  // Floor and underbody.
  body.add(rbox(HW * 2 - 0.04, 0.03, L - 0.05, 0.01, matte(0x8f8a84, 0.9), 0, FLOOR - 0.015, 0));
  body.add(rbox(HW * 2 - 0.06, FLOOR - 0.1, L - 0.1, 0.02, K.under, 0, (FLOOR + 0.1) / 2, 0));
  for (const z of WHEEL_Z) body.add(rbox(HW * 2 - 0.08, 0.2, 0.36, 0.04, K.under, 0, 0.2, z));

  // Front: windscreen, painted lower panel, lights, bumper and destination sign.
  const fz = L / 2;
  body.add(rbox(HW * 2 + 0.01, 0.34, 0.04, 0.03, A, 0, 0.27, fz - 0.015));
  body.add(rbox(HW * 2 + 0.01, 0.12, 0.04, 0.03, cream, 0, ROOF - 0.045, fz - 0.015));
  body.add(rbox(HW * 2 + 0.01, 0.06, 0.04, 0.02, cream, 0, 0.465, fz - 0.015));
  const shield = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 - 0.04, 0.42), glassMat);
  shield.position.set(0, 0.705, fz - 0.02);
  shield.renderOrder = 2;
  body.add(shield);
  for (const side of [-1, 1]) {
    body.add(rod(new THREE.Vector3(side * (HW - 0.005), 0.49, fz - 0.005), new THREE.Vector3(side * (HW - 0.005), 0.93, fz - 0.005), 0.02, cream));
  }
  const dest = textTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#1b1d22';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb53a';
    g.font = `800 44px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText(route, 18, h / 2 + 2);
    g.font = `700 38px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('迷你環線', w / 2 + 30, h / 2 + 2);
  });
  const destM = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.0625), new THREE.MeshStandardMaterial({ map: dest, emissive: 0xffffff, emissiveMap: dest, emissiveIntensity: 0.9, roughness: 0.3 }));
  destM.position.set(0, ROOF - 0.045, fz + 0.007);
  body.add(destM);
  for (const side of [-1, 1]) {
    body.add(rbox(0.1, 0.05, 0.02, 0.015, K.head, side * 0.21, 0.24, fz + 0.007));
    body.add(rbox(0.04, 0.03, 0.02, 0.01, K.amber, side * 0.29, 0.31, fz + 0.007));
    // Mirrors on stalks, bus style.
    const tip = new THREE.Vector3(side * (HW + 0.07), 0.88, fz + 0.08);
    body.add(rod(new THREE.Vector3(side * (HW - 0.02), 0.92, fz - 0.02), tip, 0.008, K.trim));
    body.add(rbox(0.035, 0.12, 0.05, 0.012, K.trim, tip.x, 0.82, tip.z));
  }
  body.add(rbox(HW * 2 + 0.03, 0.07, 0.07, 0.03, K.trim, 0, 0.13, fz + 0.01));
  const plateFront = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.045), new THREE.MeshStandardMaterial({ map: plateTexture(`BUS-${route}`), roughness: 0.4 }));
  plateFront.position.set(0, 0.13, fz + 0.046);
  body.add(plateFront);

  // Rear: rear window, tail lights, engine grille.
  const bz = -L / 2;
  body.add(rbox(HW * 2 + 0.01, 0.4, 0.04, 0.03, A, 0, 0.3, bz + 0.015));
  body.add(rbox(HW * 2 + 0.01, 0.14, 0.04, 0.03, cream, 0, ROOF - 0.06, bz + 0.015));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 - 0.08, 0.36), glassMat);
  back.position.set(0, 0.7, bz + 0.02);
  back.rotation.y = Math.PI;
  back.renderOrder = 2;
  body.add(back);
  for (const side of [-1, 1]) {
    body.add(rod(new THREE.Vector3(side * (HW - 0.005), 0.5, bz + 0.005), new THREE.Vector3(side * (HW - 0.005), 0.93, bz + 0.005), 0.02, cream));
    body.add(rbox(0.06, 0.12, 0.02, 0.015, K.tail, side * 0.26, 0.33, bz - 0.007));
  }
  for (let i = 0; i < 4; i++) body.add(rbox(0.3, 0.012, 0.012, 0.005, K.trim, 0, 0.2 + i * 0.035, bz - 0.006));
  body.add(rbox(HW * 2 + 0.03, 0.07, 0.07, 0.03, K.trim, 0, 0.13, bz - 0.01));

  // Interior: seats, grab poles, driver's cockpit and fare box.
  const seatMat = matte(0x3f6fb4, 0.7);
  const seats = [];
  const rows = [-1.12, -0.82, -0.52, -0.22, 0.32, 0.62];
  for (const z of rows) {
    for (const x of [0.165, -0.165]) {
      if (x < 0 && z > 0.85) continue;
      body.add(seatGroup(seatMat, x, z));
      seats.push({ pos: new THREE.Vector3(x, FLOOR + 0.125, z + 0.01), robot: null });
    }
  }
  // One more seat opposite the middle door.
  body.add(seatGroup(seatMat, 0.165, 0.02));
  seats.push({ pos: new THREE.Vector3(0.165, FLOOR + 0.125, 0.03), robot: null });
  for (const z of [-0.37, 0.18, 0.92]) {
    for (const x of [-0.06, 0.06]) body.add(rod(new THREE.Vector3(x, FLOOR, z), new THREE.Vector3(x, ROOF - 0.05, z), 0.008, K.chrome));
  }
  body.add(rod(new THREE.Vector3(0, ROOF - 0.12, -1.2), new THREE.Vector3(0, ROOF - 0.12, 1.0), 0.007, K.chrome));
  const driverSeat = seatGroup(matte(0x2b2e35, 0.7), 0.17, 1.03);
  body.add(driverSeat);
  const driverPos = new THREE.Vector3(0.17, FLOOR + 0.125, 1.04);
  body.add(rbox(0.6, 0.12, 0.14, 0.03, K.trim, 0, 0.48, fz - 0.1));
  const wheelPos = new THREE.Vector3(0.17, 0.6, 1.2);
  const steer = mesh(new THREE.TorusGeometry(0.07, 0.01, 8, 28), K.trim, wheelPos.x, wheelPos.y, wheelPos.z);
  steer.rotation.x = -1.0;
  body.add(steer, rod(wheelPos, new THREE.Vector3(0.17, 0.5, 1.28), 0.01, K.trim));
  body.add(rbox(0.08, 0.16, 0.08, 0.015, paint(0xf2c14e, { metal: 0.5 }), -0.05, FLOOR + 0.18, 0.92));
  body.add(rbox(0.05, 0.03, 0.01, 0.005, glow(0x7fffa0, 1), -0.05, FLOOR + 0.24, 0.965));

  // Door leaves (animated) on the kerb side.
  const doors = [];
  for (const o of RIGHT_OPEN.filter((o) => o.door)) {
    const leaves = doorLeaves(o.z0, o.z1, -1);
    for (const l of leaves) body.add(l.obj);
    doors.push({ z: (o.z0 + o.z1) / 2, leaves, t: 0, outside: new THREE.Vector3(-HW - 0.35, 0, (o.z0 + o.z1) / 2), inside: new THREE.Vector3(-0.02, FLOOR, (o.z0 + o.z1) / 2) });
  }

  // Wheels.
  const wheels = [];
  const steerers = [];
  for (const z of WHEEL_Z) {
    for (const side of [-1, 1]) {
      const w = carWheel(WHEEL_R, 0.1);
      w.obj.position.set(side * (HW - 0.06), WHEEL_R, z);
      if (side < 0) w.obj.rotation.y = Math.PI;
      group.add(w.obj);
      wheels.push(w);
      if (z > 0) steerers.push(w.obj);
    }
  }

  bake(body, doors.flatMap((d) => d.leaves.map((l) => l.obj)));
  return {
    kind: 'bus',
    group,
    body,
    wheels,
    steerers,
    seats,
    driverPos,
    doors,
    len: L,
    hw: HW,
    riderScale: 1,
  };
}
