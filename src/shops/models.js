import * as THREE from 'three';
import { Robot } from '../robots.js';
import {
  C,
  GLASS,
  brickMat,
  cone,
  cyl,
  floorMat,
  glow,
  iconMat,
  matte,
  mesh,
  metal,
  paint,
  rbox,
  signMat,
  sphere,
  stripeMat,
  torus,
  warm,
} from './kit.js';

// Shop buildings, one builder per type. Each is a tiny Q-style model at the
// robots' scale (a robot is ~0.45 tall, doors ~0.62), front facing +z and
// standing on y = 0. A builder returns:
//   group    the building
//   keep     objects that move (left out of the static bake)
//   anim     (dt, time, working) => void, animates the moving parts
//   workers  robots inside, at their work spots
//   door     local point outside the entrance where porters come and go
//   pallet   local point where finished goods are stacked in crates

const TAU = Math.PI * 2;

// ---------- Workers ----------

function worker(look, extra) {
  const r = new Robot({ glasses: null, item: null, neck: null, hat: null, body: 'plain', ...look });
  if (extra) extra(r.mesh.userData.inner);
  r.mesh.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return r;
}

const chefHat = (g) => {
  const white = matte(0xffffff, 0.85);
  g.add(cyl(0.07, 0.07, 0.06, 20, white, 0, 0.365, 0));
  const puff = sphere(0.085, white, 0, 0.41, 0, 18, 12);
  puff.scale.set(1, 0.6, 1);
  g.add(puff);
};
const apron = (color) => (g) => {
  g.add(rbox(0.13, 0.11, 0.012, 0.006, matte(color, 0.9), 0, 0.1, 0.062));
  g.add(rbox(0.11, 0.008, 0.008, 0.003, matte(color, 0.9), 0, 0.155, 0.06));
};
const hardHat = (color) => (g) => {
  const m = paint(color);
  const dome = mesh(new THREE.SphereGeometry(0.1, 20, 10, 0, TAU, 0, Math.PI / 2), m, 0, 0.335, 0);
  dome.scale.set(1, 0.72, 0.9);
  g.add(dome, cyl(0.115, 0.115, 0.01, 24, m, 0, 0.338, 0.01));
  g.add(rbox(0.02, 0.02, 0.02, 0.008, glow(0xfff2b0, 1.6), 0, 0.37, 0.085));
};
const strawHat = (g) => {
  const m = matte(0xe9cf8f, 0.85);
  g.add(cyl(0.15, 0.15, 0.012, 24, m, 0, 0.35, 0));
  g.add(cyl(0.075, 0.085, 0.05, 20, m, 0, 0.375, 0));
  g.add(cyl(0.086, 0.086, 0.014, 20, matte(0xd94a3a), 0, 0.36, 0));
};
const both = (...fns) => (g) => fns.forEach((f) => f(g));

// A working robot sways and taps its arms; called from each shop's anim.
function busy(r, dt, time, working, speed = 6) {
  r.update(dt, time);
  const inner = r.mesh.userData.inner;
  if (working) {
    inner.position.y = Math.abs(Math.sin(time * speed + r.phase)) * 0.018;
    inner.rotation.x = Math.sin(time * speed + r.phase) * 0.06;
  } else inner.rotation.x = 0;
}

function walkBob(r, time) {
  const inner = r.mesh.userData.inner;
  inner.position.y = Math.abs(Math.sin(time * 11 + r.phase)) * 0.03;
  inner.rotation.z = Math.sin(time * 11 + r.phase) * 0.1;
}

// ---------- Common pieces ----------

function pendant(g, x, y, z, color = 0xf2c14e) {
  (g.userData.lamps ??= []).push(new THREE.Vector3(x, y - 0.2, z));
  g.add(cyl(0.004, 0.004, 0.14, 4, matte(0x2f3440), x, y - 0.07, z));
  const shade = mesh(new THREE.SphereGeometry(0.055, 16, 8, 0, TAU, 0, Math.PI / 2), paint(color), x, y - 0.17, z);
  g.add(shade);
  g.add(sphere(0.026, glow(0xffe2a8, 2.2), x, y - 0.18, z, 10, 8));
}

function pottedPlant(g, x, z, h = 0.18, color = 0x4f9a52) {
  g.add(cyl(0.06, 0.045, 0.09, 16, matte(0xc96a4a, 0.8), x, 0.045, z));
  g.add(cyl(0.064, 0.064, 0.015, 16, matte(0xb35a3c, 0.8), x, 0.09, z));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    const leaf = sphere(0.045, paint(color), x + Math.cos(a) * 0.025, 0.12 + h * 0.35 + (i % 2) * 0.04, z + Math.sin(a) * 0.025, 10, 8);
    leaf.scale.set(0.8, 1.5, 0.8);
    leaf.rotation.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
    g.add(leaf);
  }
}

function lampPost(g, x, z, h = 0.75) {
  const dark = paint(0x2f3a48);
  g.add(cyl(0.035, 0.045, 0.04, 14, dark, x, 0.02, z));
  g.add(cyl(0.012, 0.016, h, 10, dark, x, h / 2, z));
  g.add(cyl(0.03, 0.045, 0.03, 12, dark, x, h + 0.015, z));
  const lamp = sphere(0.045, glow(0xffe7b0, 1.8), x, h + 0.07, z, 14, 10);
  g.add(lamp, cone(0.055, 0.04, 14, dark, x, h + 0.13, z));
}

// A wooden crate; when `fill` is a colour, goods peek out of the top.
export function crate(fill) {
  const g = new THREE.Group();
  const wood = matte(0xc08a55, 0.8);
  const dark = matte(0x8a5a33, 0.8);
  g.add(rbox(0.16, 0.11, 0.12, 0.012, wood, 0, 0.055, 0));
  for (const y of [0.025, 0.085]) g.add(rbox(0.165, 0.018, 0.125, 0.006, dark, 0, y, 0));
  if (fill != null) {
    for (let i = 0; i < 4; i++) g.add(sphere(0.032, paint(fill), ((i % 2) - 0.5) * 0.07, 0.115, (Math.floor(i / 2) - 0.5) * 0.05, 10, 8));
  }
  return g;
}

// A sloped canvas awning with a scalloped valance.
function awning(g, width, y, z, depth, a, b) {
  const sm = stripeMat(a, b);
  const drop = depth * 0.45;
  const slope = Math.hypot(depth, drop);
  const geo = new THREE.PlaneGeometry(width, slope);
  const top = mesh(geo, sm, 0, y - drop / 2, z + depth / 2);
  top.rotation.x = -Math.PI / 2 + Math.atan2(drop, depth);
  top.castShadow = true;
  g.add(top);
  const n = Math.round(width / 0.11);
  const scallop = new THREE.CircleGeometry(width / n / 2, 12, Math.PI, Math.PI);
  const cloth = [a, b].map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.8, sheen: 0.6, side: THREE.DoubleSide }));
  for (let i = 0; i < n; i++) g.add(mesh(scallop, cloth[i % 2], -width / 2 + (i + 0.5) * (width / n), y - drop, z + depth + 0.002));
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(depth, -drop), new THREE.Vector2(0, -drop)]);
    const side = mesh(new THREE.ShapeGeometry(tri), cloth[0], (s * width) / 2, y, z);
    side.rotation.y = -Math.PI / 2;
    g.add(side);
  }
  // Iron support arms.
  for (const s of [-1, 1]) {
    const arm = cyl(0.007, 0.007, slope, 6, metal(0x2f3440), (s * width) / 2 - s * 0.03, y - drop / 2 - 0.02, z + depth / 2);
    arm.rotation.x = Math.PI / 2 - Math.atan2(drop, depth);
    g.add(arm);
  }
}

// A box made of wall slabs with a shop front: display window, glass door,
// sign band, warm interior. Returns handy measurements.
function storefront(g, o) {
  const { w, d, h = 1.0 } = o;
  const t = 0.06;
  const wallMat = o.wall;
  const trim = paint(o.trim ?? C.trim);
  const frame = paint(o.frame ?? C.frame);
  const inside = warm(o.inside ?? 0xfff3e2);
  const front = d / 2;
  const doorW = 0.38;
  const doorH = 0.64;
  const doorX = o.doorX ?? w / 2 - 0.12 - doorW / 2 - 0.06;
  const sill = 0.2;
  const winTop = 0.74;

  // Plinth and floor.
  g.add(rbox(w + 0.12, 0.07, d + 0.12, 0.02, matte(C.stone, 0.9), 0, 0.035, 0));
  g.add(rbox(w - 0.08, 0.02, d - 0.08, 0.004, floorMat(o.floor ?? C.floor), 0, 0.08, 0));
  const fy = 0.09; // interior floor height

  // Back and side walls: outside skin + warm inner face.
  g.add(rbox(w, h, t, 0.015, wallMat, 0, fy + h / 2 - 0.02, -front + t / 2));
  g.add(rbox(w - 2 * t, h - 0.04, 0.01, 0.003, inside, 0, fy + h / 2 - 0.02, -front + t + 0.005));
  for (const s of [-1, 1]) {
    g.add(rbox(t, h, d, 0.015, wallMat, s * (w / 2 - t / 2), fy + h / 2 - 0.02, 0));
    g.add(rbox(0.01, h - 0.04, d - 2 * t, 0.003, inside, s * (w / 2 - t - 0.005), fy + h / 2 - 0.02, 0));
  }

  // Front: piers, kick plate, lintel; glass in the openings.
  const z = front - t / 2;
  const winL = -w / 2 + t + 0.06;
  const winR = doorX - doorW / 2 - 0.08;
  const pier = (x0, x1, y0, y1) => {
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    g.add(rbox(x1 - x0, y1 - y0, t, 0.01, wallMat, (x0 + x1) / 2, (y0 + y1) / 2, z));
  };
  pier(-w / 2, winL, fy - 0.02, fy + h - 0.02);
  pier(winR, doorX - doorW / 2, fy - 0.02, fy + h - 0.02);
  pier(doorX + doorW / 2, w / 2, fy - 0.02, fy + h - 0.02);
  pier(winL, winR, fy - 0.02, sill);
  pier(winL, doorX + doorW / 2, winTop, fy + h - 0.02);
  pier(doorX - doorW / 2, doorX + doorW / 2, doorH + fy, winTop);
  // Window frame, sill and mullion.
  const ww = winR - winL;
  const wx = (winL + winR) / 2;
  const wy = (sill + winTop) / 2;
  const wh = winTop - sill;
  g.add(rbox(ww + 0.03, 0.035, t + 0.05, 0.008, trim, wx, sill, z + 0.01));
  for (const [x, y, fw, fh] of [
    [wx, winTop - 0.01, ww, 0.02],
    [winL + 0.01, wy, 0.02, wh],
    [winR - 0.01, wy, 0.02, wh],
    [wx, wy, 0.016, wh],
    [wx, sill + wh * 0.72, ww, 0.014],
  ]) {
    g.add(rbox(fw, fh, 0.03, 0.005, frame, x, y, z + 0.01));
  }
  const pane = mesh(new THREE.PlaneGeometry(ww, wh), GLASS, wx, wy, z);
  pane.renderOrder = 2;
  g.add(pane);

  // Door: frame, glass leaf, push bar, step, sconce.
  const dy = fy + doorH / 2;
  g.add(rbox(doorW + 0.05, 0.03, t + 0.03, 0.008, trim, doorX, fy + doorH + 0.015, z));
  for (const s of [-1, 1]) g.add(rbox(0.025, doorH, t + 0.03, 0.006, trim, doorX + (s * (doorW + 0.025)) / 2, dy, z));
  const leafW = doorW - 0.02;
  g.add(rbox(leafW, 0.05, 0.025, 0.006, frame, doorX, fy + 0.03, z + 0.01));
  for (const s of [-1, 1]) g.add(rbox(0.02, doorH - 0.02, 0.025, 0.006, frame, doorX + (s * (leafW - 0.02)) / 2, dy, z + 0.01));
  g.add(rbox(leafW, 0.02, 0.025, 0.006, frame, doorX, fy + doorH - 0.02, z + 0.01));
  const dpane = mesh(new THREE.PlaneGeometry(leafW - 0.04, doorH - 0.08), GLASS, doorX, dy + 0.01, z + 0.01);
  dpane.renderOrder = 2;
  g.add(dpane);
  const bar = cyl(0.007, 0.007, 0.16, 8, metal(0xf2c14e, 0.25), doorX - leafW / 2 + 0.06, dy, z + 0.035);
  g.add(bar);
  g.add(rbox(doorW + 0.12, 0.03, 0.14, 0.01, matte(0xcfc8ba, 0.9), doorX, 0.085, front + 0.07));
  g.add(rbox(0.04, 0.06, 0.03, 0.01, frame, doorX + doorW / 2 + 0.08, fy + doorH - 0.03, front + 0.015));
  g.add(sphere(0.022, glow(0xffe2a8, 2), doorX + doorW / 2 + 0.08, fy + doorH - 0.07, front + 0.035, 10, 8));

  // Ceiling, roof slab and cornice.
  g.add(rbox(w - 2 * t, 0.03, d - 2 * t, 0.004, inside, 0, fy + h - 0.035, 0));
  if (o.roof !== 'none') {
    g.add(rbox(w + 0.1, 0.07, d + 0.1, 0.02, trim, 0, fy + h + 0.015, 0));
    g.add(rbox(w + 0.02, 0.05, d + 0.02, 0.012, paint(o.roofColor ?? 0x8d96a3), 0, fy + h + 0.07, 0));
    for (let i = 0; i < Math.floor(w / 0.12); i++) {
      g.add(rbox(0.05, 0.025, 0.02, 0.006, trim, -w / 2 + 0.09 + i * 0.12, fy + h - 0.035, front + 0.04));
    }
  }

  // Sign band.
  if (o.sign) {
    const sw = Math.min(w * 0.72, 1.5);
    g.add(rbox(sw + 0.06, 0.22, 0.03, 0.02, paint(o.signFrame ?? 0x3b3f4a), 0, fy + h - 0.12, front + 0.015));
    const sign = mesh(new THREE.PlaneGeometry(sw, 0.18), signMat(o.sign, o.signBg, o.signFg ?? '#ffffff', o.signSub ?? ''), 0, fy + h - 0.12, front + 0.032);
    g.add(sign);
  }
  // Blade sign with the shop's icon.
  if (o.icon) {
    const bx = -w / 2 + 0.03;
    g.add(rbox(0.12, 0.012, 0.012, 0.004, metal(0x2f3440), bx - 0.06, fy + h - 0.2, front + 0.08));
    const disc = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.015, 24).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), iconMat(o.icon, o.signBg), bx - 0.1, fy + h - 0.3, front + 0.08);
    disc.rotation.y = Math.PI / 2;
    const ring = torus(0.078, 0.006, paint(o.signFrame ?? 0x3b3f4a), bx - 0.1, fy + h - 0.3, front + 0.08);
    ring.rotation.y = Math.PI / 2;
    g.add(disc, ring);
  }
  if (o.awning) awning(g, ww + doorW + 0.3, fy + h - 0.25, front, 0.26, o.awning[0], o.awning[1]);

  return { w, d, h, fy, front, doorX, winL, winR, sill, winTop, door: new THREE.Vector3(doorX, 0, front + 0.35) };
}

// ---------- Bakery ----------

function bread(color = 0xd99a52) {
  return paint(color);
}

function loaf(g, x, y, z, s = 1, rot = 0) {
  const m = sphere(0.05 * s, bread(), x, y, z, 12, 8);
  m.scale.set(1.5, 0.75, 0.95);
  m.rotation.y = rot;
  g.add(m);
  for (let i = -1; i <= 1; i++) {
    const cut = rbox(0.008 * s, 0.005, 0.05 * s, 0.002, matte(0xf6e2b8), x + Math.cos(rot) * i * 0.025 * s, y + 0.035 * s, z - Math.sin(rot) * i * 0.025 * s);
    cut.rotation.y = rot + 0.4;
    g.add(cut);
  }
}

function croissant(g, x, y, z, s = 1) {
  const c = torus(0.03 * s, 0.017 * s, bread(0xd88d3e), x, y, z, Math.PI * 1.2);
  c.rotation.x = -Math.PI / 2;
  c.rotation.z = -Math.PI * 0.1;
  g.add(c);
}

function baguette(g, x, y, z, rot = 0) {
  const b = mesh(new THREE.CapsuleGeometry(0.018, 0.2, 4, 10), bread(0xd49448), x, y, z);
  b.rotation.z = Math.PI / 2 - 0.2;
  b.rotation.y = rot;
  g.add(b);
}

function bakery() {
  const g = new THREE.Group();
  const keep = [];
  const s = storefront(g, {
    w: 2.2,
    d: 1.8,
    wall: brickMat(0xf0c7a8, 0xfbefe2),
    trim: 0xfbf3e6,
    frame: 0x6b3f2a,
    inside: 0xfff0dc,
    floor: 0xc99566,
    roofColor: 0x8a5a3c,
    sign: '麵包坊',
    signSub: 'BAKERY',
    signBg: 0x8a5232,
    signFrame: 0x5a3420,
    icon: '🥐',
    awning: [0xa8643a, 0xfbefdc],
  });
  const { fy, front, winL, winR, sill } = s;
  // Window display: a two-tier wooden stand with loaves and croissants.
  const wx = (winL + winR) / 2;
  const wz = front - 0.2;
  g.add(rbox(winR - winL - 0.1, 0.04, 0.22, 0.01, matte(C.wood, 0.6), wx, sill + 0.01, wz));
  g.add(rbox((winR - winL) * 0.55, 0.12, 0.1, 0.01, matte(C.woodDark, 0.6), wx, sill + 0.08, wz - 0.05));
  for (let i = 0; i < 4; i++) loaf(g, winL + 0.15 + i * 0.2, sill + 0.06, wz + 0.05, 0.9, 0.2 * i);
  for (let i = 0; i < 3; i++) croissant(g, wx - 0.15 + i * 0.15, sill + 0.155, wz - 0.05);
  baguette(g, winR - 0.12, sill + 0.13, wz - 0.06, 0.3);
  // Glass display counter with pastries.
  const cz = -0.15;
  g.add(rbox(1.0, 0.24, 0.26, 0.03, paint(0xfbf3e6), -0.25, fy + 0.12, cz));
  g.add(rbox(1.02, 0.025, 0.28, 0.01, matte(C.woodDark, 0.4), -0.25, fy + 0.25, cz));
  const caseGlass = mesh(new THREE.BoxGeometry(0.96, 0.13, 0.22), GLASS, -0.25, fy + 0.33, cz);
  caseGlass.renderOrder = 2;
  g.add(caseGlass);
  for (let i = 0; i < 5; i++) croissant(g, -0.65 + i * 0.2, fy + 0.29, cz + 0.03, 0.8);
  g.add(rbox(0.12, 0.08, 0.1, 0.015, metal(0x9aa3ad, 0.35), 0.15, fy + 0.3, cz - 0.02)); // till
  g.add(rbox(0.1, 0.03, 0.02, 0.005, glow(0x7ee0a0, 1), 0.15, fy + 0.335, cz + 0.035));
  // Back wall shelves with bread.
  const bz = -s.d / 2 + 0.14;
  for (const y of [0.3, 0.52]) {
    g.add(rbox(1.2, 0.025, 0.14, 0.006, matte(C.wood, 0.6), -0.3, fy + y, bz));
    for (let i = 0; i < 5; i++) loaf(g, -0.8 + i * 0.25, fy + y + 0.04, bz, 0.8, 1.4);
  }
  // Basket of baguettes.
  g.add(cyl(0.08, 0.065, 0.12, 16, matte(0xc9a066, 0.9), 0.65, fy + 0.06, -0.6));
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.CapsuleGeometry(0.016, 0.2, 4, 8), bread(0xd49448), 0.63 + (i % 2) * 0.03, fy + 0.2, -0.6 + (i - 1.5) * 0.025);
    b.rotation.z = (i - 1.5) * 0.12;
    g.add(b);
  }
  // Brick oven on the side wall; its mouth glows while baking.
  const ox = s.w / 2 - 0.3;
  const oz = -0.5;
  const oven = new THREE.Group();
  oven.position.set(ox, fy, oz);
  oven.add(rbox(0.36, 0.3, 0.4, 0.04, brickMat(0xb5553c, 0xe8d8c4), 0, 0.15, 0));
  const dome = mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, TAU, 0, Math.PI / 2), brickMat(0xb5553c, 0xe8d8c4), 0, 0.3, 0);
  dome.scale.set(0.9, 0.7, 1);
  oven.add(dome, cyl(0.035, 0.04, 0.3, 12, brickMat(0xb5553c, 0xe8d8c4), 0, 0.5, -0.08));
  oven.rotation.y = -Math.PI / 2;
  g.add(oven);
  const fireMat = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff6a1a, emissiveIntensity: 2 });
  const mouth = mesh(new THREE.CircleGeometry(0.08, 18, 0, Math.PI), fireMat, ox - 0.181, fy + 0.12, oz);
  mouth.rotation.y = -Math.PI / 2;
  g.add(mouth);
  keep.push(mouth);
  // Pendant lamps.
  pendant(g, -0.5, fy + 0.96, 0, 0x8a5232);
  pendant(g, 0.2, fy + 0.96, 0, 0x8a5232);
  // Outside: menu board, flour sacks, a plant.
  menuBoard(g, -0.5, front + 0.3, '今日\n出爐');
  sack(g, s.w / 2 - 0.08, front + 0.16);
  sack(g, s.w / 2 + 0.05, front + 0.08, 0.85);
  pottedPlant(g, -s.w / 2 + 0.1, front + 0.15);

  const baker = worker({ name: '烘焙師', shirt: 0xfbf3e6, accent: 0x8a5232 }, both(chefHat, apron(0x8a5232)));
  baker.mesh.position.set(-0.25, fy, cz - 0.28);
  g.add(baker.mesh);
  keep.push(baker.mesh);
  const helper = worker({ name: '學徒', shirt: 0xf2a541, accent: 0xffffff }, both(chefHat, apron(0xffffff)));
  helper.mesh.position.set(ox - 0.32, fy, oz);
  helper.mesh.rotation.y = Math.PI / 2;
  g.add(helper.mesh);
  keep.push(helper.mesh);

  return {
    group: g,
    keep,
    workers: [baker, helper],
    door: s.door,
    pallet: new THREE.Vector3(s.w / 2 + 0.25, 0, front - 0.25),
    anim(dt, time, working) {
      fireMat.emissiveIntensity = working ? 1.6 + Math.sin(time * 9) * 0.35 + Math.sin(time * 23) * 0.2 : 0.25;
      busy(baker, dt, time, working, 4);
      busy(helper, dt, time, working, 7);
    },
  };
}

function menuBoard(g, x, z, text) {
  const frame = matte(C.woodDark, 0.6);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const c = canvas.getContext('2d');
  c.fillStyle = '#2d3a33';
  c.fillRect(0, 0, 128, 160);
  c.fillStyle = '#f6f1e2';
  c.textAlign = 'center';
  c.font = `700 30px "Noto Sans TC", "WenQuanYi Zen Hei", sans-serif`;
  text.split('\n').forEach((l, i) => c.fillText(l, 64, 50 + i * 38));
  c.strokeStyle = '#f2c14e';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(24, 128);
  c.lineTo(104, 128);
  c.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Group();
  board.position.set(x, 0, z);
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.rotation.x = s * 0.22;
    leaf.add(rbox(0.2, 0.26, 0.014, 0.006, frame, 0, 0.14, 0));
    const face = mesh(new THREE.PlaneGeometry(0.17, 0.22), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0, 0.145, s * 0.008);
    if (s < 0) face.rotation.y = Math.PI;
    leaf.add(face);
    leaf.position.z = s * 0.03;
    board.add(leaf);
  }
  g.add(board);
}

function sack(g, x, z, s = 1) {
  const m = matte(0xe6d5b0, 0.95);
  const body = sphere(0.08 * s, m, x, 0.075 * s, z, 14, 10);
  body.scale.set(1, 1.15, 0.85);
  g.add(body, cyl(0.03 * s, 0.05 * s, 0.05 * s, 10, m, x, 0.17 * s, z));
  g.add(cyl(0.032 * s, 0.032 * s, 0.012, 10, matte(0x8a5232), x, 0.155 * s, z));
}

// ---------- Café ----------

function cafeTable(g, x, z, parasol, color) {
  const dark = paint(0x2f3a48);
  g.add(cyl(0.05, 0.06, 0.012, 16, dark, x, 0.006, z));
  g.add(cyl(0.01, 0.01, 0.2, 8, dark, x, 0.1, z));
  g.add(cyl(0.11, 0.11, 0.016, 24, paint(0xfbf8f1), x, 0.205, z));
  g.add(cyl(0.022, 0.016, 0.03, 12, paint(0xffffff), x + 0.04, 0.228, z)); // cup
  g.add(cyl(0.032, 0.032, 0.004, 14, paint(0xffffff), x + 0.04, 0.215, z));
  for (const a of [0.4, 0.4 + Math.PI]) {
    const cx = x + Math.cos(a) * 0.19;
    const cz = z + Math.sin(a) * 0.19;
    g.add(cyl(0.055, 0.055, 0.015, 16, paint(color), cx, 0.13, cz));
    for (let i = 0; i < 4; i++) {
      const la = i * (TAU / 4) + 0.6;
      const leg = cyl(0.006, 0.006, 0.13, 6, dark, cx + Math.cos(la) * 0.035, 0.065, cz + Math.sin(la) * 0.035);
      g.add(leg);
    }
    const back = rbox(0.1, 0.09, 0.012, 0.006, dark, cx + Math.cos(a) * 0.05, 0.19, cz + Math.sin(a) * 0.05);
    back.rotation.y = -a + Math.PI / 2;
    g.add(back);
  }
  if (parasol) {
    g.add(cyl(0.006, 0.006, 0.55, 8, metal(0xdfe3e8), x, 0.48, z));
    const top = mesh(new THREE.ConeGeometry(0.3, 0.12, 8, 1, true), new THREE.MeshPhysicalMaterial({ color: parasol, roughness: 0.75, side: THREE.DoubleSide, sheen: 0.5 }), x, 0.74, z);
    top.castShadow = true;
    g.add(top, sphere(0.015, paint(0xfbf8f1), x, 0.81, z, 8, 6));
  }
}

function cafe() {
  const g = new THREE.Group();
  const keep = [];
  const s = storefront(g, {
    w: 2.2,
    d: 1.5,
    wall: paint(0x9cc7b4),
    trim: 0xfbf8f1,
    frame: 0x2f4a3f,
    inside: 0xfff1df,
    floor: 0x8a6448,
    roofColor: 0x2f4a3f,
    sign: '咖啡廳',
    signSub: 'CAFÉ',
    signBg: 0x2f5a48,
    signFrame: 0x1f3a2f,
    icon: '☕',
    awning: [0x2f6a52, 0xfbf8f1],
  });
  g.position.z = 0;
  const { fy, front, winL, winR, sill } = s;
  const back = -s.d / 2;
  // Bar counter along the back with the espresso machine.
  g.add(rbox(1.2, 0.26, 0.26, 0.03, matte(C.woodDark, 0.5), -0.25, fy + 0.13, back + 0.35));
  g.add(rbox(1.24, 0.025, 0.3, 0.01, paint(0xfbf8f1), -0.25, fy + 0.27, back + 0.35));
  const mx = -0.45;
  g.add(rbox(0.26, 0.16, 0.16, 0.025, metal(0xc8ced6, 0.22), mx, fy + 0.365, back + 0.3));
  g.add(rbox(0.27, 0.02, 0.17, 0.008, metal(0x2f3440, 0.4), mx, fy + 0.45, back + 0.3));
  for (const sx of [-0.06, 0.06]) {
    g.add(cyl(0.015, 0.012, 0.04, 10, metal(0x2f3440), mx + sx, fy + 0.31, back + 0.4));
    g.add(cyl(0.02, 0.016, 0.03, 12, paint(0xffffff), mx + sx, fy + 0.295, back + 0.4));
  }
  for (const sx of [-0.08, 0, 0.08]) g.add(sphere(0.012, glow(sx ? 0x7ee0a0 : 0xff7a5a, 1.4), mx + sx, fy + 0.41, back + 0.385, 8, 6));
  // Cups stacked on the machine and a cake dome.
  for (let i = 0; i < 3; i++) g.add(cyl(0.02, 0.015, 0.025, 12, paint(0xffffff), mx - 0.08 + i * 0.05, fy + 0.475, back + 0.3));
  g.add(cyl(0.07, 0.07, 0.01, 18, paint(0xffffff), 0.1, fy + 0.29, back + 0.38));
  const cake = cyl(0.05, 0.05, 0.05, 18, paint(0xf7c6d0), 0.1, fy + 0.32, back + 0.38);
  g.add(cake, cyl(0.051, 0.051, 0.01, 18, paint(0xfbf8f1), 0.1, fy + 0.345, back + 0.38));
  const domeG = mesh(new THREE.SphereGeometry(0.07, 18, 10, 0, TAU, 0, Math.PI / 2), GLASS, 0.1, fy + 0.295, back + 0.38);
  domeG.renderOrder = 2;
  g.add(domeG);
  // Chalk menu board on the back wall.
  const menu = mesh(new THREE.PlaneGeometry(0.5, 0.26), signMat('MENU', 0x2d3a33, '#f6f1e2', '拿鐵・可頌・早午餐'), 0.1, fy + 0.7, back + 0.075);
  g.add(rbox(0.54, 0.3, 0.015, 0.008, matte(C.woodDark, 0.6), 0.1, fy + 0.7, back + 0.066), menu);
  // Bar stools.
  for (const x of [-0.6, -0.3]) {
    g.add(cyl(0.012, 0.03, 0.2, 8, metal(0x2f3440), x, fy + 0.1, back + 0.62));
    g.add(cyl(0.05, 0.05, 0.025, 16, paint(0xc96a4a), x, fy + 0.21, back + 0.62));
  }
  // Window bench with a seated customer and a little table.
  g.add(rbox(winR - winL - 0.1, 0.03, 0.18, 0.01, matte(C.wood, 0.5), (winL + winR) / 2, sill + 0.02, front - 0.16));
  g.add(rbox(winR - winL - 0.1, 0.14, 0.16, 0.02, paint(0x2f6a52), (winL + winR) / 2, fy + 0.07, front - 0.18));
  pottedPlant(g, winL + 0.08, front - 0.15, 0.1);
  pendant(g, -0.55, fy + 0.96, -0.05, 0x2f6a52);
  pendant(g, 0.1, fy + 0.96, -0.05, 0x2f6a52);
  pendant(g, 0.7, fy + 0.96, -0.05, 0x2f6a52);
  // Terrace in front.
  cafeTable(g, -0.55, front + 0.5, 0xf2efe6, 0x2f6a52);
  cafeTable(g, 0.25, front + 0.62, null, 0xc96a4a);
  pottedPlant(g, -s.w / 2 + 0.05, front + 0.2, 0.24);
  lampPost(g, s.w / 2 + 0.12, front + 0.45);

  const barista = worker({ name: '咖啡師', shirt: 0x2f3a48, accent: 0xffffff }, apron(0x2f6a52));
  barista.mesh.position.set(-0.25, fy, back + 0.14);
  g.add(barista.mesh);
  keep.push(barista.mesh);
  const guest = worker({ name: '客人', shirt: 0xe8789a, accent: 0xffffff, hat: 'beanie' });
  guest.sit({ pos: new THREE.Vector3(-0.3, fy + 0.03, front - 0.36) });
  guest.mesh.rotation.y = Math.PI;
  guest.mesh.position.set(-0.3, fy + 0.04, front - 0.2);
  guest.mesh.rotation.y = Math.PI;
  g.add(guest.mesh);
  keep.push(guest.mesh);
  // Steam curls from the espresso cups while working.
  const steam = [];
  for (let i = 0; i < 3; i++) {
    const puff = sphere(0.02, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), mx, fy + 0.32, back + 0.4, 8, 6);
    g.add(puff);
    steam.push(puff);
    keep.push(puff);
  }

  return {
    group: g,
    keep,
    workers: [barista, guest],
    door: s.door,
    pallet: null,
    anim(dt, time, working) {
      busy(barista, dt, time, working, 5);
      guest.update(dt, time);
      steam.forEach((p, i) => {
        const t = (time * 0.6 + i / 3) % 1;
        p.visible = working;
        p.position.y = fy + 0.33 + t * 0.2;
        p.position.x = mx + Math.sin(t * 6 + i) * 0.02 + (i - 1) * 0.04;
        p.material.opacity = 0.5 * (1 - t);
        p.scale.setScalar(0.6 + t);
      });
    },
  };
}

// ---------- Grocery ----------

function produceCrate(g, x, z, color, tilt = 0.25) {
  const c = crate(null);
  c.position.set(x, 0.07, z);
  c.rotation.x = -tilt;
  g.add(c);
  for (let i = 0; i < 6; i++) {
    const f = sphere(0.03, paint(color), x + ((i % 3) - 1) * 0.045, 0.19 + Math.floor(i / 3) * -0.01, z + (Math.floor(i / 3) - 0.5) * 0.045, 10, 8);
    g.add(f);
  }
}

function grocery() {
  const g = new THREE.Group();
  const keep = [];
  const s = storefront(g, {
    w: 2.4,
    d: 1.7,
    wall: paint(0xd7e6f2),
    trim: 0xffffff,
    frame: 0x2a4e78,
    inside: 0xf6fbff,
    floor: 0xe2dccf,
    roofColor: 0x2a4e78,
    sign: '雜貨店',
    signSub: 'GROCERY',
    signBg: 0x2a64a8,
    signFrame: 0x1f3e66,
    icon: '🍎',
    awning: [0x3a7cc8, 0xffffff],
  });
  const { fy, front, winL, winR, sill } = s;
  // Shelves with colourful packages.
  const colors = [0xe85d4a, 0xf2c14e, 0x4cc47a, 0x4a90c8, 0xf7a6c1, 0xf08a3c, 0x9b7fd1, 0xffffff];
  const shelf = (x, z, rot) => {
    const sh = new THREE.Group();
    sh.position.set(x, fy, z);
    sh.rotation.y = rot;
    sh.add(rbox(0.7, 0.5, 0.16, 0.015, paint(0xffffff), 0, 0.25, 0));
    for (let r = 0; r < 3; r++) {
      sh.add(rbox(0.72, 0.016, 0.18, 0.004, matte(0xb0b8c2, 0.4), 0, 0.12 + r * 0.15, 0.01));
      for (let i = 0; i < 6; i++) {
        const col = colors[(i * 3 + r * 5 + Math.abs(Math.round(x * 10))) % colors.length];
        const tall = 0.06 + ((i + r) % 3) * 0.015;
        sh.add(rbox(0.07, tall, 0.06, 0.008, paint(col), -0.28 + i * 0.112, 0.128 + r * 0.15 + tall / 2, 0.05));
      }
    }
    g.add(sh);
  };
  shelf(-0.3, -s.d / 2 + 0.16, 0);
  shelf(0.5, -s.d / 2 + 0.16, 0);
  shelf(-0.85, -0.15, Math.PI / 2);
  // Chiller with glowing front.
  g.add(rbox(0.3, 0.5, 0.2, 0.02, paint(0xffffff), s.w / 2 - 0.25, fy + 0.25, -0.35));
  const chill = mesh(new THREE.PlaneGeometry(0.24, 0.4), glow(0xd8f2ff, 0.7), s.w / 2 - 0.351, fy + 0.27, -0.35);
  chill.rotation.y = -Math.PI / 2;
  g.add(chill);
  for (let i = 0; i < 3; i++) g.add(cyl(0.02, 0.02, 0.07, 10, paint([0xf6f4ee, 0x7bc67b, 0xf2a541][i]), s.w / 2 - 0.36, fy + 0.15 + i * 0.13, -0.42 + i * 0.05));
  // Checkout counter with register and belt.
  const cx = 0.25;
  const cz = 0.15;
  g.add(rbox(0.6, 0.22, 0.24, 0.02, paint(0x2a64a8), cx, fy + 0.11, cz));
  g.add(rbox(0.62, 0.02, 0.26, 0.006, matte(0x3b3f4a, 0.4), cx, fy + 0.23, cz));
  g.add(rbox(0.12, 0.07, 0.1, 0.012, paint(0xf6f7f9), cx + 0.18, fy + 0.275, cz));
  g.add(rbox(0.09, 0.04, 0.01, 0.004, glow(0x7ee0a0, 1), cx + 0.18, fy + 0.3, cz + 0.05));
  g.add(cyl(0.02, 0.02, 0.24, 10, metal(0x2f3440), cx - 0.1, fy + 0.25, cz).rotateZ(Math.PI / 2));
  // Window: fruit pyramid.
  const wx = (winL + winR) / 2;
  g.add(rbox(winR - winL - 0.12, 0.04, 0.2, 0.01, matte(C.wood, 0.6), wx, sill + 0.01, front - 0.18));
  const fruit = [0xe0473a, 0xf08a3c, 0x8cc63f, 0xf2c14e];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6 - row * 2; i++) {
      g.add(sphere(0.035, paint(fruit[(i + row) % 4]), wx - 0.18 + row * 0.07 + i * 0.07, sill + 0.065 + row * 0.055, front - 0.18, 12, 8));
    }
  }
  // Produce crates out front.
  produceCrate(g, -0.85, front + 0.2, 0xe0473a);
  produceCrate(g, -0.65, front + 0.2, 0xf08a3c);
  produceCrate(g, -0.45, front + 0.2, 0x8cc63f);
  // Shopping trolley.
  trolley(g, s.w / 2 + 0.05, front + 0.3);
  pendant(g, -0.4, fy + 0.96, 0, 0xffffff);
  pendant(g, 0.4, fy + 0.96, 0, 0xffffff);

  const clerk = worker({ name: '店員', shirt: 0x3a7cc8, accent: 0xffffff, hat: 'cap' }, apron(0xffffff));
  clerk.mesh.position.set(cx + 0.05, fy, cz - 0.24);
  g.add(clerk.mesh);
  keep.push(clerk.mesh);
  const shopper = worker({ name: '顧客', shirt: 0xf2a541, accent: 0x2f3440, item: 'shopping' });
  shopper.mesh.position.set(-0.45, fy, -0.3);
  shopper.mesh.rotation.y = -Math.PI / 2;
  g.add(shopper.mesh);
  keep.push(shopper.mesh);

  return {
    group: g,
    keep,
    workers: [clerk, shopper],
    door: s.door,
    pallet: null,
    anim(dt, time, working) {
      busy(clerk, dt, time, working, 5);
      shopper.update(dt, time);
      shopper.mesh.position.z = -0.3 + Math.sin(time * 0.4) * 0.25;
      shopper.mesh.rotation.y = Math.cos(time * 0.4) > 0 ? Math.PI : 0;
    },
  };
}

function trolley(g, x, z) {
  const m = metal(0xc8ced6, 0.3);
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  t.rotation.y = 0.5;
  t.add(rbox(0.16, 0.1, 0.22, 0.01, new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.8, roughness: 0.3, wireframe: false }), 0, 0.15, 0));
  t.add(rbox(0.14, 0.08, 0.2, 0.01, paint(0x2a64a8), 0, 0.16, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    t.add(cyl(0.005, 0.005, 0.1, 6, m, sx * 0.07, 0.05, sz * 0.09));
    const w = cyl(0.015, 0.015, 0.01, 10, matte(0x2f3440), sx * 0.07, 0.015, sz * 0.09);
    w.rotation.z = Math.PI / 2;
    t.add(w);
  }
  const h = cyl(0.008, 0.008, 0.18, 8, paint(0xe85d4a), 0, 0.25, -0.13);
  h.rotation.z = Math.PI / 2;
  t.add(h);
  g.add(t);
}

// ---------- Furniture store ----------

function sofa(g, x, y, z, color, rot = 0) {
  const s = new THREE.Group();
  s.position.set(x, y, z);
  s.rotation.y = rot;
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 0.8, sheenColor: new THREE.Color(0xffffff) });
  s.add(rbox(0.42, 0.08, 0.18, 0.03, m, 0, 0.07, 0));
  s.add(rbox(0.42, 0.14, 0.05, 0.025, m, 0, 0.14, -0.075));
  for (const sx of [-1, 1]) s.add(rbox(0.05, 0.11, 0.18, 0.025, m, sx * 0.21, 0.1, 0));
  for (const sx of [-1, 1]) s.add(rbox(0.18, 0.04, 0.14, 0.02, m, sx * 0.095, 0.125, 0.01));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.add(cyl(0.008, 0.006, 0.03, 6, matte(C.woodDark), sx * 0.19, 0.015, sz * 0.07));
  s.add(rbox(0.08, 0.07, 0.03, 0.015, paint(0xf2c14e), -0.12, 0.17, -0.03));
  g.add(s);
}

function floorLamp(g, x, y, z) {
  g.add(cyl(0.035, 0.04, 0.012, 14, metal(0xc9a24e, 0.3), x, y + 0.006, z));
  g.add(cyl(0.005, 0.005, 0.36, 6, metal(0xc9a24e, 0.3), x, y + 0.18, z));
  g.add(cyl(0.04, 0.06, 0.07, 16, warm(0xfff1d6, 0.6), x, y + 0.38, z));
  g.add(sphere(0.02, glow(0xffe2a8, 2.4), x, y + 0.36, z, 8, 6));
}

function chair(g, x, y, z, rot, color) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  c.rotation.y = rot;
  const m = paint(color);
  c.add(rbox(0.12, 0.016, 0.12, 0.006, m, 0, 0.12, 0));
  c.add(rbox(0.12, 0.12, 0.014, 0.006, m, 0, 0.19, -0.055));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.add(cyl(0.006, 0.006, 0.12, 6, m, sx * 0.05, 0.06, sz * 0.05));
  g.add(c);
}

function furniture() {
  const g = new THREE.Group();
  const keep = [];
  const s = storefront(g, {
    w: 2.4,
    d: 1.7,
    wall: paint(0xe8ddd0),
    trim: 0xfbf8f1,
    frame: 0x4a3a2e,
    inside: 0xfff2e2,
    floor: 0xb98a5e,
    roofColor: 0x5a4a3e,
    sign: '家具行',
    signSub: 'FURNITURE',
    signBg: 0xc98a2e,
    signFrame: 0x6b4a22,
    icon: '🛋️',
    awning: [0xe0a83a, 0xfbf8f1],
  });
  const { fy, front, winL, winR } = s;
  const wx = (winL + winR) / 2;
  // Window display: a rug, sofa, lamp and side table.
  const rug = rbox(0.75, 0.006, 0.42, 0.003, matte(0xc96a4a, 0.95), wx, fy + 0.005, front - 0.3);
  g.add(rug, rbox(0.65, 0.007, 0.32, 0.003, matte(0xf2e2c4, 0.95), wx, fy + 0.007, front - 0.3));
  sofa(g, wx - 0.05, fy, front - 0.38, 0x5c8a9a, 0);
  floorLamp(g, wx + 0.3, fy, front - 0.42);
  g.add(cyl(0.05, 0.05, 0.012, 16, matte(C.wood, 0.4), wx - 0.36, fy + 0.13, front - 0.3));
  g.add(cyl(0.008, 0.008, 0.13, 6, matte(C.woodDark), wx - 0.36, fy + 0.065, front - 0.3));
  pottedPlant(g, wx - 0.36, front - 0.3, 0.06);
  g.children[g.children.length - 1].position.y += fy + 0.14;
  // Workshop area at the back: workbench, a chair being made, tools on the wall.
  const back = -s.d / 2;
  g.add(rbox(0.8, 0.04, 0.26, 0.01, matte(C.wood, 0.6), -0.3, fy + 0.22, back + 0.25));
  for (const sx of [-1, 1]) g.add(rbox(0.04, 0.22, 0.22, 0.008, matte(C.woodDark, 0.6), -0.3 + sx * 0.36, fy + 0.11, back + 0.25));
  const plank = rbox(0.4, 0.02, 0.08, 0.004, matte(0xd9a46a, 0.6), -0.35, fy + 0.25, back + 0.25);
  plank.rotation.y = 0.2;
  g.add(plank);
  const saw = new THREE.Group();
  saw.position.set(-0.05, fy + 0.25, back + 0.22);
  saw.add(rbox(0.12, 0.004, 0.05, 0.002, metal(0xdfe3e8, 0.2), 0, 0, 0), rbox(0.05, 0.02, 0.02, 0.006, paint(0xe85d4a), -0.08, 0.01, 0));
  g.add(saw);
  // Pegboard with tools.
  g.add(rbox(0.7, 0.32, 0.012, 0.006, matte(0xd9c4a0, 0.9), -0.3, fy + 0.58, back + 0.07));
  for (let i = 0; i < 5; i++) {
    const tx = -0.58 + i * 0.14;
    g.add(rbox(0.012, 0.13, 0.012, 0.004, matte(C.woodDark), tx, fy + 0.56, back + 0.085));
    g.add(rbox(0.05, 0.03, 0.02, 0.006, metal(0x8d96a3, 0.3), tx, fy + 0.63, back + 0.085));
  }
  // Showroom: chairs, a wardrobe and a table.
  chair(g, 0.45, fy, -0.1, 0.4, 0xe0a83a);
  chair(g, 0.75, fy, -0.15, -0.3, 0x5c8a9a);
  g.add(rbox(0.36, 0.6, 0.18, 0.02, paint(0xf2e8da), s.w / 2 - 0.25, fy + 0.3, back + 0.2));
  g.add(rbox(0.005, 0.56, 0.005, 0.002, matte(0x4a3a2e), s.w / 2 - 0.25, fy + 0.3, back + 0.292));
  for (const sx of [-1, 1]) g.add(sphere(0.008, metal(0xc9a24e), s.w / 2 - 0.25 + sx * 0.02, fy + 0.32, back + 0.295, 8, 6));
  g.add(rbox(0.4, 0.02, 0.26, 0.008, matte(C.wood, 0.4), 0.6, fy + 0.2, 0.3));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(cyl(0.01, 0.008, 0.19, 6, matte(C.woodDark), 0.6 + sx * 0.17, fy + 0.095, 0.3 + sz * 0.1));
  pendant(g, -0.3, fy + 0.96, -0.1, 0xc98a2e);
  pendant(g, 0.55, fy + 0.96, 0.05, 0xc98a2e);
  // Outside: a bench made in the shop, a lamp.
  g.add(rbox(0.46, 0.025, 0.12, 0.008, matte(C.wood, 0.6), -0.55, 0.14, front + 0.25));
  g.add(rbox(0.46, 0.08, 0.015, 0.006, matte(C.wood, 0.6), -0.55, 0.2, front + 0.195));
  for (const sx of [-1, 1]) g.add(rbox(0.02, 0.13, 0.1, 0.006, metal(0x2f3440), -0.55 + sx * 0.2, 0.07, front + 0.25));
  lampPost(g, s.w / 2 + 0.12, front + 0.35);

  const carpenter = worker({ name: '木工', shirt: 0xc96a4a, accent: 0xf2c14e, body: 'overalls', hat: 'beanie' });
  carpenter.mesh.position.set(-0.3, fy, back + 0.48);
  carpenter.mesh.rotation.y = Math.PI;
  g.add(carpenter.mesh);
  keep.push(carpenter.mesh, saw);

  return {
    group: g,
    keep,
    workers: [carpenter],
    door: s.door,
    pallet: null,
    anim(dt, time, working) {
      busy(carpenter, dt, time, working, 8);
      if (working) saw.position.x = -0.05 + Math.sin(time * 10) * 0.04;
    },
  };
}

// ---------- Forge ----------

function forge() {
  const g = new THREE.Group();
  const keep = [];
  const w = 2.3;
  const d = 1.8;
  const h = 0.95;
  const fy = 0.09;
  const wall = brickMat(0xa8503c, 0xe2d4c4);
  const steelBlue = paint(0x3d5a73);
  const inside = warm(0xf6e6d4);
  g.add(rbox(w + 0.12, 0.07, d + 0.12, 0.02, matte(0xb9b4aa, 0.9), 0, 0.035, 0));
  g.add(rbox(w - 0.08, 0.02, d - 0.08, 0.004, warm(0xc9c2b6, 0.85), 0, 0.08, 0));
  const t = 0.07;
  g.add(rbox(w, h, t, 0.015, wall, 0, fy + h / 2, -d / 2 + t / 2));
  g.add(rbox(w - 2 * t, h - 0.05, 0.01, 0.003, inside, 0, fy + h / 2, -d / 2 + t + 0.005));
  for (const s of [-1, 1]) {
    g.add(rbox(t, h, d, 0.015, wall, s * (w / 2 - t / 2), fy + h / 2, 0));
    g.add(rbox(0.01, h - 0.05, d - 2 * t, 0.003, inside, s * (w / 2 - t - 0.005), fy + h / 2, 0));
  }
  // Front with a big open roller door and a small window.
  const front = d / 2 - t / 2;
  const doorW = 0.9;
  const doorH = 0.66;
  const dx = 0.25;
  g.add(rbox(dx - doorW / 2 + w / 2, h, t, 0.015, wall, (-w / 2 + dx - doorW / 2) / 2, fy + h / 2, front));
  g.add(rbox(w / 2 - dx - doorW / 2, h, t, 0.015, wall, (w / 2 + dx + doorW / 2) / 2, fy + h / 2, front));
  g.add(rbox(doorW, h - doorH, t, 0.015, wall, dx, fy + doorH + (h - doorH) / 2, front));
  // Rolled-up shutter and its yellow-black safety frame.
  g.add(cyl(0.05, 0.05, doorW + 0.04, 16, steelBlue, dx, fy + doorH + 0.05, front + 0.06).rotateZ(Math.PI / 2));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      g.add(rbox(0.035, doorH / 6, 0.02, 0.004, paint(i % 2 ? 0x2f3440 : 0xf2c14e), dx + s * (doorW / 2 + 0.02), fy + (i + 0.5) * (doorH / 6), front + 0.04));
    }
  }
  // Small window with bars.
  const wxl = -0.75;
  const win = mesh(new THREE.PlaneGeometry(0.34, 0.28), GLASS, wxl, fy + 0.5, front + t / 2 + 0.002);
  win.renderOrder = 2;
  g.add(win);
  g.add(mesh(new THREE.PlaneGeometry(0.34, 0.28), warm(0x6b4a3a, 0.8), wxl, fy + 0.5, front - t / 2 + 0.001));
  for (let i = -1; i <= 1; i++) g.add(rbox(0.012, 0.3, 0.02, 0.004, steelBlue, wxl + i * 0.1, fy + 0.5, front + t / 2 + 0.01));
  g.add(rbox(0.4, 0.03, 0.06, 0.008, matte(0xd9cfc0), wxl, fy + 0.35, front + 0.04));
  // Sawtooth roof with north-light skylights.
  const gableWall = brickMat(0xa8503c, 0xe2d4c4).clone();
  gableWall.side = THREE.DoubleSide;
  const skyGlass = new THREE.MeshPhysicalMaterial({ color: 0x9cc4e4, roughness: 0.08, metalness: 0.2, clearcoat: 1, emissive: 0xffd9a0, emissiveIntensity: 0.18, side: THREE.DoubleSide });
  const teeth = 3;
  const tw = d / teeth;
  for (let i = 0; i < teeth; i++) {
    const z0 = -d / 2 + i * tw;
    const slope = rbox(w + 0.06, 0.035, Math.hypot(tw, 0.22), 0.01, steelBlue, 0, fy + h + 0.11, z0 + tw / 2);
    slope.rotation.x = -Math.atan2(0.22, tw);
    g.add(slope);
    g.add(mesh(new THREE.PlaneGeometry(w - 0.1, 0.2), skyGlass, 0, fy + h + 0.11, z0 + tw - 0.005));
    for (let k = 1; k < 4; k++) g.add(rbox(0.02, 0.21, 0.02, 0.005, matte(0x2f3440), -w / 2 + (k * w) / 4, fy + h + 0.11, z0 + tw - 0.004));
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(tw, 0), new THREE.Vector2(tw, 0.22)]);
    for (const sx of [-1, 1]) g.add(mesh(new THREE.ShapeGeometry(tri).rotateY(-Math.PI / 2), gableWall, sx * (w / 2 - 0.002), fy + h, z0));
    g.add(rbox(w + 0.06, 0.025, 0.03, 0.006, matte(0x2f3440), 0, fy + h + 0.225, z0 + tw - 0.01));
  }
  g.add(rbox(w - 2 * t, 0.02, d - 2 * t, 0.004, inside, 0, fy + h - 0.01, 0));
  // Chimney with smoke.
  const chx = -w / 2 + 0.3;
  const chz = -d / 2 + 0.25;
  g.add(rbox(0.22, 1.0, 0.22, 0.02, brickMat(0x8a3e30, 0xd8c8b8), chx, fy + h + 0.4, chz));
  g.add(rbox(0.26, 0.05, 0.26, 0.015, matte(0x3b3f4a), chx, fy + h + 0.92, chz));
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 1, transparent: true, opacity: 0.6, depthWrite: false });
  const smoke = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), smokeMat.clone());
    g.add(p);
    smoke.push(p);
    keep.push(p);
  }
  // Interior: hearth (glowing), anvil, quench tub, tool rack.
  const hx = -0.55;
  const hz = -d / 2 + 0.3;
  g.add(rbox(0.5, 0.26, 0.34, 0.03, brickMat(0x6b5a50, 0xb8aca0), hx, fy + 0.13, hz));
  const coalMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff4a10, emissiveIntensity: 2.2, roughness: 0.6 });
  const coals = new THREE.Group();
  for (let i = 0; i < 9; i++) coals.add(sphere(0.035, coalMat, hx - 0.14 + (i % 3) * 0.14, fy + 0.27, hz - 0.08 + Math.floor(i / 3) * 0.08, 8, 6));
  g.add(coals);
  keep.push(coals);
  const hood = mesh(new THREE.CylinderGeometry(0.08, 0.26, 0.24, 4, 1, true).rotateY(Math.PI / 4), metal(0x4a4f58, 0.5), hx, fy + 0.62, hz);
  hood.material.side = THREE.DoubleSide;
  g.add(hood, cyl(0.06, 0.06, 0.25, 12, metal(0x4a4f58, 0.5), hx, fy + 0.85, hz));
  // Anvil.
  const ax = 0.0;
  const az = -0.15;
  g.add(cyl(0.07, 0.09, 0.14, 12, matte(C.woodDark, 0.7), ax, fy + 0.07, az));
  g.add(rbox(0.2, 0.06, 0.09, 0.012, metal(0x3b3f4a, 0.4), ax, fy + 0.17, az));
  g.add(cone(0.035, 0.08, 10, metal(0x3b3f4a, 0.4), ax + 0.13, fy + 0.18, az).rotateZ(-Math.PI / 2));
  const hotBar = rbox(0.12, 0.015, 0.025, 0.005, new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6010, emissiveIntensity: 1.8 }), ax - 0.02, fy + 0.21, az);
  g.add(hotBar);
  keep.push(hotBar);
  // Quench tub.
  g.add(cyl(0.11, 0.1, 0.15, 18, matte(C.woodDark, 0.7), 0.6, fy + 0.075, -0.45));
  g.add(cyl(0.1, 0.1, 0.01, 18, new THREE.MeshPhysicalMaterial({ color: 0x3a6a8a, roughness: 0.05, transmission: 0, clearcoat: 1 }), 0.6, fy + 0.14, -0.45));
  for (const y of [0.03, 0.12]) g.add(torus(0.106, 0.008, metal(0x3b3f4a), 0.6, fy + y, -0.45).rotateX(Math.PI / 2));
  // Tool rack on the side wall.
  for (let i = 0; i < 5; i++) {
    const tz = -0.5 + i * 0.16;
    g.add(rbox(0.012, 0.16, 0.012, 0.004, matte(C.wood), w / 2 - 0.09, fy + 0.5, tz));
    g.add(rbox(0.03, 0.04, 0.06, 0.006, metal(0x8d96a3), w / 2 - 0.09, fy + 0.58, tz));
  }
  // Ore barrels out front, a gear sign.
  for (let i = 0; i < 2; i++) {
    const bx = -w / 2 + 0.2 + i * 0.22;
    g.add(cyl(0.08, 0.08, 0.2, 16, paint(0x4a6a52), bx, 0.1, d / 2 + 0.2));
    for (const y of [0.04, 0.16]) g.add(torus(0.081, 0.006, metal(0x3b3f4a), bx, y, d / 2 + 0.2).rotateX(Math.PI / 2));
    for (let k = 0; k < 4; k++) g.add(sphere(0.03, matte(0x8d96a3, 0.6), bx + (k % 2) * 0.03 - 0.015, 0.21, d / 2 + 0.2 + (k > 1 ? 0.02 : -0.02), 6, 5));
  }
  g.add(rbox(1.2, 0.2, 0.03, 0.02, matte(0x2f3440), dx, fy + h - 0.1, d / 2 + 0.02));
  g.add(mesh(new THREE.PlaneGeometry(1.14, 0.16), signMat('鐵工坊', 0x3d5a73, '#ffffff', 'FORGE'), dx, fy + h - 0.1, d / 2 + 0.036));
  const gear = gearMesh(paint(0xf2c14e));
  gear.position.set(-w / 2 - 0.02, fy + h - 0.1, d / 2 - 0.15);
  gear.rotation.y = Math.PI / 2;
  g.add(gear);
  keep.push(gear);
  lampPost(g, w / 2 + 0.12, d / 2 + 0.3);

  const smith = worker({ name: '鐵匠', shirt: 0x5c6b7a, accent: 0x2f3440, body: 'overalls' }, both(hardHat(0xf2c14e), apron(0x6b4a3a)));
  smith.mesh.position.set(ax, fy, az + 0.2);
  smith.mesh.rotation.y = Math.PI;
  g.add(smith.mesh);
  keep.push(smith.mesh);
  const hammer = new THREE.Group();
  hammer.add(rbox(0.012, 0.1, 0.012, 0.004, matte(C.wood), 0, 0.05, 0), rbox(0.05, 0.03, 0.03, 0.006, metal(0x3b3f4a), 0, 0.1, 0));
  hammer.position.set(0.1, 0.16, 0.02);
  smith.mesh.userData.inner.add(hammer);

  return {
    group: g,
    keep,
    workers: [smith],
    door: new THREE.Vector3(dx, 0, d / 2 + 0.35),
    pallet: new THREE.Vector3(dx + 0.6, 0, d / 2 + 0.25),
    anim(dt, time, working) {
      smith.update(dt, time);
      const strike = working ? Math.max(0, Math.sin(time * 7)) : 0;
      hammer.rotation.x = -strike * 1.4;
      coalMat.emissiveIntensity = working ? 1.8 + Math.sin(time * 6) * 0.4 + Math.sin(time * 17) * 0.2 : 0.4;
      hotBar.visible = working;
      gear.rotation.x += dt * (working ? 1.2 : 0.1);
      smoke.forEach((p, i) => {
        const t = (time * 0.25 + i / smoke.length) % 1;
        p.visible = working;
        p.position.set(chx + Math.sin(t * 4 + i) * 0.08 + t * 0.15, fy + h + 1.0 + t * 0.9, chz - t * 0.1);
        p.scale.setScalar(0.6 + t * 1.8);
        p.material.opacity = 0.55 * (1 - t);
      });
    },
  };
}

function gearMesh(material) {
  const shape = new THREE.Shape();
  const n = 10;
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * TAU;
    const a1 = ((i + 1) / (n * 2)) * TAU;
    const r = i % 2 ? 0.1 : 0.125;
    if (i === 0) shape.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    else shape.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    shape.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.035, 0, TAU, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
  geo.center();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

// ---------- Recycling centre ----------

function recycle() {
  const g = new THREE.Group();
  const keep = [];
  const w = 2.3;
  const d = 1.6;
  const h = 0.85;
  const fy = 0.09;
  const clad = paint(0x6aa86a);
  const inside = warm(0xeef6ea);
  g.add(rbox(w + 0.12, 0.07, d + 0.12, 0.02, matte(0xbab6ac, 0.9), 0, 0.035, 0));
  g.add(rbox(w - 0.08, 0.02, d - 0.08, 0.004, matte(0x9a968e, 0.9), 0, 0.08, 0));
  // A warehouse with corrugated green walls (ribs) and a curved roof.
  const t = 0.06;
  g.add(rbox(w, h, t, 0.015, clad, 0, fy + h / 2, -d / 2 + t / 2));
  g.add(rbox(w - 2 * t, h - 0.05, 0.01, 0.003, inside, 0, fy + h / 2, -d / 2 + t + 0.005));
  for (const s of [-1, 1]) {
    g.add(rbox(t, h, d, 0.015, clad, s * (w / 2 - t / 2), fy + h / 2, 0));
    g.add(rbox(0.01, h - 0.05, d - 2 * t, 0.003, inside, s * (w / 2 - t - 0.005), fy + h / 2, 0));
  }
  const rib = paint(0x5a965a);
  for (let i = 0; i < 18; i++) {
    const x = -w / 2 + 0.06 + i * ((w - 0.12) / 17);
    g.add(rbox(0.02, h - 0.04, 0.012, 0.004, rib, x, fy + h / 2, -d / 2 - 0.004));
  }
  const front = d / 2 - t / 2;
  const doorW = 0.8;
  const doorH = 0.62;
  const dx = -0.35;
  g.add(rbox(dx - doorW / 2 + w / 2, h, t, 0.015, clad, (-w / 2 + dx - doorW / 2) / 2, fy + h / 2, front));
  g.add(rbox(w / 2 - dx - doorW / 2, h, t, 0.015, clad, (w / 2 + dx + doorW / 2) / 2, fy + h / 2, front));
  g.add(rbox(doorW, h - doorH, t, 0.015, clad, dx, fy + doorH + (h - doorH) / 2, front));
  for (let i = 0; i < 9; i++) {
    const x = dx + doorW / 2 + 0.06 + i * 0.07;
    if (x > w / 2 - 0.04) break;
    g.add(rbox(0.02, h - 0.04, 0.012, 0.004, rib, x, fy + h / 2, d / 2 + 0.004));
  }
  // Curved roof.
  const roof = mesh(new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.08, 28, 1, true, Math.PI / 2 - 0.9, 1.8), paint(0xf2efe6), 0, fy + h - d * 0.62 * Math.cos(0.9) + 0.02, 0);
  roof.rotation.z = Math.PI / 2;
  roof.material.side = THREE.DoubleSide;
  g.add(roof);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CircleGeometry(d * 0.62, 28, Math.PI / 2 - 0.9, 1.8), clad, s * (w / 2), fy + h - d * 0.62 * Math.cos(0.9) + 0.02, 0);
    cap.rotation.y = (s * Math.PI) / 2;
    g.add(cap);
  }
  g.add(rbox(w - 2 * t, 0.02, d - 2 * t, 0.004, inside, 0, fy + h - 0.01, 0));
  // Sign.
  g.add(rbox(1.0, 0.2, 0.03, 0.02, paint(0x2f5a3a), 0.45, fy + h - 0.14, d / 2 + 0.02));
  g.add(mesh(new THREE.PlaneGeometry(0.94, 0.16), signMat('回收站', 0x3e8a4e, '#ffffff', 'RECYCLE'), 0.45, fy + h - 0.14, d / 2 + 0.036));
  // Sorting bins out front: blue paper, yellow plastic, green glass.
  const bins = [[0x3a7cc8, '紙'], [0xf2c14e, '塑'], [0x4cc47a, '玻']];
  bins.forEach(([color, label], i) => {
    const bx = 0.2 + i * 0.26;
    const bz = d / 2 + 0.2;
    g.add(rbox(0.2, 0.24, 0.18, 0.03, paint(color), bx, 0.12, bz));
    g.add(rbox(0.22, 0.03, 0.2, 0.012, paint(new THREE.Color(color).multiplyScalar(0.8).getHex()), bx, 0.255, bz - 0.005));
    g.add(mesh(new THREE.PlaneGeometry(0.12, 0.12), iconMat(label, new THREE.Color(color).multiplyScalar(0.75).getHex()), bx, 0.13, bz + 0.091));
    for (const sx of [-1, 1]) {
      const wh = cyl(0.025, 0.025, 0.02, 12, matte(0x2f3440), bx + sx * 0.07, 0.025, bz - 0.06);
      wh.rotation.z = Math.PI / 2;
      g.add(wh);
    }
  });
  // Inside: conveyor belt, compactor, bales.
  const beltZ = -0.2;
  g.add(rbox(1.2, 0.04, 0.2, 0.01, matte(0x2f3440, 0.5), 0.1, fy + 0.22, beltZ));
  for (let i = 0; i < 4; i++) g.add(rbox(0.03, 0.2, 0.03, 0.006, metal(0x8d96a3), -0.45 + i * 0.37, fy + 0.1, beltZ));
  const parcels = new THREE.Group();
  const parcelColors = [0x3a7cc8, 0xf2c14e, 0x4cc47a, 0xe85d4a, 0xd9c4a0];
  for (let i = 0; i < 6; i++) parcels.add(rbox(0.07, 0.05, 0.07, 0.012, paint(parcelColors[i % 5]), 0, fy + 0.265, beltZ));
  g.add(parcels);
  keep.push(parcels);
  g.add(rbox(0.4, 0.5, 0.36, 0.03, paint(0xf2c14e), w / 2 - 0.35, fy + 0.25, -0.35));
  g.add(rbox(0.3, 0.12, 0.02, 0.01, matte(0x2f3440), w / 2 - 0.35, fy + 0.35, -0.16));
  g.add(sphere(0.02, glow(0x7ee0a0, 1.6), w / 2 - 0.42, fy + 0.45, -0.16, 8, 6));
  const ram = rbox(0.28, 0.06, 0.28, 0.01, metal(0x8d96a3, 0.3), w / 2 - 0.35, fy + 0.4, -0.35);
  g.add(ram);
  keep.push(ram);
  for (let i = 0; i < 3; i++) g.add(rbox(0.18, 0.14, 0.14, 0.02, matte([0xd9c4a0, 0x9ab0c4, 0xa8c49a][i], 0.9), -w / 2 + 0.2, fy + 0.07 + (i === 2 ? 0.14 : 0), -0.5 + (i % 2) * 0.16));
  // Compost heap and scrap pile on the side.
  const heap = mesh(new THREE.SphereGeometry(0.22, 16, 8, 0, TAU, 0, Math.PI / 2), matte(0x6b4a2e, 1), -w / 2 - 0.05, 0.07, d / 2 + 0.15);
  heap.scale.y = 0.6;
  g.add(heap);
  for (let i = 0; i < 5; i++) g.add(sphere(0.03, paint(0x5fae5a), -w / 2 - 0.12 + i * 0.04, 0.17 + (i % 2) * 0.02, d / 2 + 0.12, 8, 6));
  pendant(g, -0.2, fy + h - 0.02, 0.1, 0x3e8a4e);
  pendant(g, 0.5, fy + h - 0.02, 0.1, 0x3e8a4e);

  const sorter = worker({ name: '分類員', shirt: 0x4cc47a, accent: 0xf2c14e, body: 'stripes' }, hardHat(0x4cc47a));
  sorter.mesh.position.set(0.1, fy, beltZ + 0.22);
  sorter.mesh.rotation.y = Math.PI;
  g.add(sorter.mesh);
  keep.push(sorter.mesh);

  return {
    group: g,
    keep,
    workers: [sorter],
    door: new THREE.Vector3(dx, 0, d / 2 + 0.35),
    pallet: new THREE.Vector3(-w / 2 + 0.25, 0, d / 2 + 0.55),
    anim(dt, time, working) {
      busy(sorter, dt, time, working, 6);
      parcels.children.forEach((p, i) => {
        const u = (((working ? time * 0.15 : 0) + i / 6) % 1);
        p.position.x = -0.45 + u * 1.1;
      });
      ram.position.y = fy + 0.4 + (working ? Math.abs(Math.sin(time * 1.5)) * 0.08 : 0.08);
    },
  };
}

// ---------- Farm ----------

function cow() {
  const g = new THREE.Group();
  const white = paint(0xfbf8f1);
  const spot = paint(0x2f3440);
  const body = rbox(0.28, 0.16, 0.16, 0.07, white, 0, 0.17, 0);
  g.add(body);
  g.add(sphere(0.05, spot, 0.04, 0.22, 0.06, 10, 8), sphere(0.04, spot, -0.07, 0.15, -0.065, 10, 8));
  const head = rbox(0.12, 0.11, 0.11, 0.045, white, 0.18, 0.24, 0);
  g.add(head, rbox(0.06, 0.06, 0.1, 0.025, paint(0xf7b8b0), 0.24, 0.21, 0));
  for (const s of [-1, 1]) {
    g.add(sphere(0.012, matte(0x111111, 0.3), 0.235, 0.27, s * 0.035, 8, 6));
    g.add(cone(0.012, 0.04, 8, paint(0xe9dfc8), 0.17, 0.31, s * 0.04));
    const ear = sphere(0.025, paint(0xf7b8b0), 0.15, 0.27, s * 0.07, 8, 6);
    ear.scale.set(0.6, 0.5, 1.2);
    g.add(ear);
  }
  for (const [x, z] of [[-0.09, -0.05], [-0.09, 0.05], [0.09, -0.05], [0.09, 0.05]]) {
    g.add(cyl(0.022, 0.02, 0.1, 8, white, x, 0.05, z), cyl(0.022, 0.022, 0.02, 8, spot, x, 0.01, z));
  }
  g.add(sphere(0.03, paint(0xf7b8b0), -0.02, 0.09, 0, 8, 6));
  const bell = sphere(0.016, metal(0xf2c14e, 0.25), 0.15, 0.17, 0, 8, 6);
  g.add(bell);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function farm() {
  const g = new THREE.Group();
  const keep = [];
  const W = 3.2;
  const D = 2.6;
  // Grass pad with a dirt yard.
  g.add(rbox(W, 0.05, D, 0.02, matte(0x86c46a, 0.95), 0, 0.025, 0));
  // Barn at the back left.
  const bx = -0.75;
  const bz = -0.55;
  const bw = 1.3;
  const bd = 1.1;
  const bh = 0.7;
  const red = paint(0xc8463a);
  const white = paint(0xfbf8f1);
  const barn = new THREE.Group();
  barn.position.set(bx, 0.05, bz);
  barn.add(rbox(bw, bh, bd, 0.02, red, 0, bh / 2, 0));
  // Gable ends.
  const gable = new THREE.Shape([new THREE.Vector2(-bw / 2, 0), new THREE.Vector2(bw / 2, 0), new THREE.Vector2(0, 0.42)]);
  for (const s of [-1, 1]) {
    const gm = mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.04, bevelEnabled: false }), red, 0, bh, s * (bd / 2) - 0.02);
    barn.add(gm);
  }
  // Roof.
  const slopeLen = Math.hypot(bw / 2, 0.42) + 0.08;
  for (const s of [-1, 1]) {
    const r = rbox(slopeLen, 0.05, bd + 0.16, 0.015, paint(0x6b4e3d), (s * bw) / 4 + s * 0.01, bh + 0.22, 0);
    r.rotation.z = -s * Math.atan2(0.42, bw / 2);
    barn.add(r);
  }
  barn.add(cyl(0.025, 0.025, bd + 0.18, 8, white, 0, bh + 0.44, 0).rotateX(Math.PI / 2));
  // Big front door with white X trim; hay loft.
  const doorZ = bd / 2 + 0.005;
  barn.add(rbox(0.5, 0.48, 0.02, 0.01, paint(0xa83a30), 0, 0.24, doorZ));
  for (const [w, h, x, y] of [[0.54, 0.035, 0, 0.48], [0.54, 0.035, 0, 0.01], [0.035, 0.5, -0.255, 0.245], [0.035, 0.5, 0.255, 0.245], [0.035, 0.5, 0, 0.245]]) {
    barn.add(rbox(w, h, 0.03, 0.006, white, x, y, doorZ + 0.005));
  }
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const bar = rbox(0.33, 0.03, 0.03, 0.006, white, sx * 0.127, 0.245, doorZ + 0.01);
      bar.rotation.z = s * 0.95;
      barn.add(bar);
    }
  }
  barn.add(rbox(0.22, 0.18, 0.02, 0.01, paint(0xa83a30), 0, bh + 0.12, doorZ + 0.04));
  barn.add(rbox(0.26, 0.03, 0.03, 0.006, white, 0, bh + 0.22, doorZ + 0.045));
  barn.add(rbox(0.26, 0.03, 0.03, 0.006, white, 0, bh + 0.02, doorZ + 0.045));
  // Hay bales peeking from the loft.
  barn.add(rbox(0.16, 0.08, 0.06, 0.02, matte(0xe9c25a, 0.95), 0, bh + 0.06, doorZ + 0.06));
  // Side windows.
  for (const z of [-0.25, 0.2]) {
    const wm = mesh(new THREE.PlaneGeometry(0.18, 0.16), warm(0xffe2a8, 0.6), bw / 2 + 0.004, 0.42, z);
    wm.rotation.y = Math.PI / 2;
    barn.add(wm);
    for (const [w, h] of [[0.2, 0.025], [0.025, 0.18]]) {
      const f = rbox(0.02, h, w, 0.004, white, bw / 2 + 0.01, 0.42, z);
      barn.add(f);
    }
  }
  barn.add(signBoard('農場', 0x6b8f3a, 0.6, 0, bh - 0.12, doorZ + 0.03));
  g.add(barn);
  // Silo.
  const sx = bx + bw / 2 + 0.28;
  const sz = bz - 0.15;
  const silo = paint(0xd8dde3);
  g.add(cyl(0.24, 0.24, 1.15, 24, silo, sx, 0.05 + 0.575, sz));
  for (let i = 1; i < 6; i++) g.add(torus(0.243, 0.008, metal(0x9aa3ad), sx, 0.05 + i * 0.19, sz).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.SphereGeometry(0.245, 24, 10, 0, TAU, 0, Math.PI / 2), paint(0x4a7fb8), sx, 1.2, sz));
  g.add(sphere(0.03, paint(0x4a7fb8), sx, 1.45, sz, 8, 6));
  for (let i = 0; i < 8; i++) g.add(rbox(0.06, 0.008, 0.012, 0.003, metal(0x8d96a3), sx, 0.15 + i * 0.12, sz + 0.25));
  // Field with crop rows on the right.
  const fx = 0.85;
  const fz = 0.15;
  g.add(rbox(1.3, 0.05, 1.9, 0.02, matte(0x7a5534, 1), fx, 0.055, fz));
  const wheat = [];
  const veg = [];
  for (let r = 0; r < 6; r++) {
    g.add(rbox(0.12, 0.03, 1.8, 0.015, matte(0x6b4a2e, 1), fx - 0.52 + r * 0.21, 0.09, fz));
    for (let i = 0; i < 9; i++) (r < 4 ? wheat : veg).push([fx - 0.52 + r * 0.21, fz - 0.8 + i * 0.2]);
  }
  const wheatGeo = new THREE.ConeGeometry(0.035, 0.18, 6).translate(0, 0.09, 0);
  const wheatMesh = new THREE.InstancedMesh(wheatGeo, paint(0xe9c25a), wheat.length * 3);
  const m4 = new THREE.Matrix4();
  wheat.forEach(([x, z], i) => {
    for (let k = 0; k < 3; k++) {
      m4.makeTranslation(x + (k - 1) * 0.035, 0.1, z + ((k * 7) % 3 - 1) * 0.02);
      wheatMesh.setMatrixAt(i * 3 + k, m4);
    }
  });
  wheatMesh.castShadow = true;
  g.add(wheatMesh);
  keep.push(wheatMesh);
  const leafMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), paint(0x5fae5a), veg.length);
  const carrotMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.02, 0.05, 6).rotateX(Math.PI), paint(0xf08a3c), veg.length);
  veg.forEach(([x, z], i) => {
    leafMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0.14, z), new THREE.Quaternion(), new THREE.Vector3(1, 0.7, 1)));
    carrotMesh.setMatrixAt(i, m4.makeTranslation(x + 0.03, 0.115, z));
  });
  leafMesh.castShadow = carrotMesh.castShadow = true;
  g.add(leafMesh, carrotMesh);
  keep.push(leafMesh, carrotMesh);
  // Wooden fence around the pad.
  const post = matte(0xd9b48a, 0.8);
  const fence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.32));
    const rot = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      g.add(rbox(0.035, 0.2, 0.035, 0.01, post, x0 + (x1 - x0) * t, 0.15, z0 + (z1 - z0) * t));
    }
    for (const y of [0.12, 0.2]) {
      const rail = rbox(0.02, 0.025, len, 0.008, post, (x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = rot;
      g.add(rail);
    }
  };
  const ex = W / 2 - 0.06;
  const ez = D / 2 - 0.06;
  fence(-ex, -ez, ex, -ez);
  fence(-ex, -ez, -ex, ez);
  fence(ex, -ez, ex, ez);
  fence(-ex, ez, -0.55, ez);
  fence(0.05, ez, ex, ez);
  // Milk churns and a trough near the barn.
  for (let i = 0; i < 2; i++) {
    const cx = -1.35 + i * 0.13;
    g.add(cyl(0.05, 0.055, 0.14, 14, metal(0xdfe3e8, 0.3), cx, 0.12, 0.25));
    g.add(cyl(0.03, 0.05, 0.04, 14, metal(0xdfe3e8, 0.3), cx, 0.21, 0.25));
    g.add(cyl(0.032, 0.032, 0.02, 14, metal(0xdfe3e8, 0.3), cx, 0.24, 0.25));
  }
  g.add(rbox(0.36, 0.08, 0.14, 0.02, matte(C.woodDark, 0.8), -0.85, 0.09, 0.6));
  g.add(rbox(0.32, 0.01, 0.1, 0.004, new THREE.MeshPhysicalMaterial({ color: 0x5a9ac8, roughness: 0.05, clearcoat: 1 }), -0.85, 0.13, 0.6));
  // Two cows; one grazes, one wanders.
  const cowA = cow();
  cowA.position.set(-0.5, 0.05, 0.7);
  cowA.rotation.y = 2.4;
  const cowB = cow();
  cowB.position.set(-1.2, 0.05, 0.75);
  g.add(cowA, cowB);
  keep.push(cowA, cowB);
  // A little tractor.
  const tractor = tractorMesh();
  tractor.position.set(0.15, 0.05, -0.85);
  tractor.rotation.y = Math.PI / 2;
  g.add(tractor);

  const farmer = worker({ name: '農夫', shirt: 0x4a90c8, accent: 0xf2c14e, body: 'overalls' }, strawHat);
  farmer.mesh.position.set(fx, 0.1, fz);
  g.add(farmer.mesh);
  keep.push(farmer.mesh);
  const milker = worker({ name: '牧場主', shirt: 0xe85d4a, accent: 0xffffff, body: 'stripes', hat: 'cap' });
  milker.mesh.position.set(-0.6, 0.05, 0.35);
  g.add(milker.mesh);
  keep.push(milker.mesh);

  let rowT = 0;
  return {
    group: g,
    keep,
    workers: [farmer, milker],
    door: new THREE.Vector3(-0.25, 0, D / 2 + 0.25),
    pallet: new THREE.Vector3(-0.25, 0.05, 0.35),
    anim(dt, time, working) {
      // The farmer walks up and down the rows tending crops.
      if (working) rowT += dt * 0.12;
      const lane = Math.floor(rowT) % 6;
      const u = rowT % 1;
      const along = lane % 2 ? 1 - u : u;
      const tx = fx - 0.42 + lane * 0.21 - 0.1;
      farmer.mesh.position.set(tx, 0.08, fz - 0.8 + along * 1.6);
      farmer.mesh.rotation.y = lane % 2 ? Math.PI : 0;
      farmer.update(dt, time);
      if (working) walkBob(farmer, time);
      busy(milker, dt, time, working, 3);
      milker.mesh.rotation.y = -0.6;
      cowA.rotation.z = Math.sin(time * 1.3) * 0.02;
      cowA.children[2].rotation.z = 0;
      cowB.position.x = -1.2 + Math.sin(time * 0.2) * 0.12;
      cowB.rotation.y = Math.cos(time * 0.2) > 0 ? 0 : Math.PI;
    },
  };
}

function signBoard(text, bg, w, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(rbox(w + 0.05, 0.17, 0.025, 0.015, matte(0xfbf8f1), 0, 0, 0));
  g.add(mesh(new THREE.PlaneGeometry(w, 0.13), signMat(text, bg), 0, 0, 0.014));
  return g;
}

function tractorMesh() {
  const g = new THREE.Group();
  const green = paint(0x4caf50);
  g.add(rbox(0.3, 0.1, 0.16, 0.03, green, 0, 0.12, 0));
  g.add(rbox(0.14, 0.14, 0.15, 0.03, green, -0.06, 0.24, 0));
  g.add(rbox(0.16, 0.015, 0.17, 0.006, paint(0xfbf8f1), -0.06, 0.32, 0));
  const glassBox = mesh(new THREE.BoxGeometry(0.12, 0.08, 0.14), GLASS, -0.06, 0.26, 0);
  glassBox.renderOrder = 2;
  g.add(glassBox);
  g.add(cyl(0.012, 0.012, 0.1, 8, metal(0x3b3f4a), 0.1, 0.22, 0.04));
  for (const s of [-1, 1]) {
    const big = cyl(0.085, 0.085, 0.05, 18, matte(0x2f3440, 0.8), -0.08, 0.085, s * 0.1);
    big.rotation.x = Math.PI / 2;
    const hubB = cyl(0.045, 0.045, 0.055, 14, paint(0xf2c14e), -0.08, 0.085, s * 0.1);
    hubB.rotation.x = Math.PI / 2;
    const small = cyl(0.05, 0.05, 0.04, 14, matte(0x2f3440, 0.8), 0.1, 0.05, s * 0.09);
    small.rotation.x = Math.PI / 2;
    const hubS = cyl(0.025, 0.025, 0.045, 12, paint(0xf2c14e), 0.1, 0.05, s * 0.09);
    hubS.rotation.x = Math.PI / 2;
    g.add(big, hubB, small, hubS);
  }
  g.add(sphere(0.015, glow(0xfff2b0, 1.2), 0.155, 0.13, 0.05, 8, 6), sphere(0.015, glow(0xfff2b0, 1.2), 0.155, 0.13, -0.05, 8, 6));
  return g;
}

// ---------- Lumber yard ----------

function endGrainMat() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d');
  c.fillStyle = '#e8c48e';
  c.fillRect(0, 0, 64, 64);
  c.strokeStyle = 'rgba(140,90,50,0.55)';
  c.lineWidth = 2;
  for (let r = 6; r < 32; r += 6) {
    c.beginPath();
    c.arc(32, 32, r, 0, TAU);
    c.stroke();
  }
  c.strokeStyle = '#8a5a33';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(32, 32, 30, 0, TAU);
  c.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
}
let END_GRAIN;

function log(g, x, y, z, len, r, rotY = 0) {
  END_GRAIN ??= endGrainMat();
  const bark = matte(0x8a5a3a, 0.95);
  const geo = new THREE.CylinderGeometry(r, r, len, 14, 1);
  const m = new THREE.Mesh(geo, [bark, END_GRAIN, END_GRAIN]);
  m.position.set(x, y, z);
  m.rotation.set(0, rotY, Math.PI / 2);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
}

function pine(g, x, z, s = 1) {
  g.add(cyl(0.03 * s, 0.04 * s, 0.3 * s, 8, matte(0x8a5a3a), x, 0.15 * s, z));
  for (let i = 0; i < 3; i++) g.add(cone((0.22 - i * 0.05) * s, 0.3 * s, 9, paint(0x3f8a4f), x, (0.35 + i * 0.17) * s, z));
}

function lumber() {
  const g = new THREE.Group();
  const keep = [];
  const W = 2.4;
  const D = 2.0;
  g.add(rbox(W, 0.05, D, 0.02, matte(0x9cc47a, 0.95), 0, 0.025, 0));
  g.add(rbox(1.4, 0.012, 0.9, 0.005, matte(0xc9a87a, 1), 0.3, 0.055, 0.45));
  // Log cabin office.
  const cab = new THREE.Group();
  cab.position.set(-0.55, 0.05, -0.45);
  const cw = 1.0;
  const cd = 0.8;
  const ch = 0.62;
  const logMat = matte(0xa86f42, 0.85);
  for (let i = 0; i < 7; i++) {
    const y = 0.045 + i * 0.085;
    for (const s of [-1, 1]) {
      const a = cyl(0.045, 0.045, cw + 0.1, 12, logMat, 0, y, (s * cd) / 2);
      a.rotation.z = Math.PI / 2;
      const b = cyl(0.045, 0.045, cd + 0.1, 12, logMat, (s * cw) / 2, y + 0.04, 0);
      b.rotation.x = Math.PI / 2;
      cab.add(a, b);
    }
  }
  cab.add(rbox(cw - 0.04, ch - 0.02, cd - 0.04, 0.01, warm(0xf2dcbc, 0.8), 0, ch / 2, 0));
  // Roof with green shingles.
  const roofLen = Math.hypot(cw / 2, 0.3) + 0.12;
  for (const s of [-1, 1]) {
    const r = rbox(roofLen, 0.05, cd + 0.24, 0.015, paint(0x3f6a4a), (s * cw) / 4 + s * 0.02, ch + 0.17, 0);
    r.rotation.z = -s * Math.atan2(0.3, cw / 2);
    cab.add(r);
  }
  const gable = new THREE.Shape([new THREE.Vector2(-cw / 2, 0), new THREE.Vector2(cw / 2, 0), new THREE.Vector2(0, 0.3)]);
  for (const s of [-1, 1]) cab.add(mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.03, bevelEnabled: false }), logMat, 0, ch, s * (cd / 2) - 0.015));
  // Door and lit window.
  cab.add(rbox(0.24, 0.42, 0.03, 0.01, matte(0x6b4a2e, 0.7), -0.2, 0.22, cd / 2 + 0.05));
  cab.add(sphere(0.012, metal(0xf2c14e), -0.12, 0.22, cd / 2 + 0.07, 8, 6));
  cab.add(mesh(new THREE.PlaneGeometry(0.22, 0.18), warm(0xffe2a8, 0.5), 0.2, 0.36, cd / 2 + 0.056));
  for (const [w, h, y, x] of [[0.26, 0.025, 0.46, 0.2], [0.26, 0.025, 0.26, 0.2], [0.025, 0.2, 0.36, 0.08], [0.025, 0.2, 0.36, 0.32], [0.02, 0.2, 0.36, 0.2]]) {
    cab.add(rbox(w, h, 0.02, 0.004, paint(0xfbf8f1), x, y, cd / 2 + 0.065));
  }
  cab.add(cyl(0.05, 0.05, 0.3, 10, brickMat(0x8a7a6e, 0xc8c0b6), 0.32, ch + 0.25, -0.15));
  cab.add(signBoard('林場', 0x3f6a4a, 0.5, 0, ch + 0.1, cd / 2 + 0.09));
  g.add(cab);
  // Log pile.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) log(g, 0.75, 0.11 + row * 0.1, -0.7 + i * 0.12 + row * 0.06, 0.7, 0.055, Math.PI / 2);
  }
  for (const s of [-1, 1]) g.add(rbox(0.04, 0.36, 0.04, 0.01, matte(0x6b4a2e), 0.75 + s * 0.3, 0.2, -0.79));
  // Plank stack.
  for (let i = 0; i < 5; i++) g.add(rbox(0.6, 0.03, 0.12, 0.006, matte(i % 2 ? 0xe2b884 : 0xd9a86e, 0.7), 0.95, 0.07 + i * 0.032, 0.3 + (i % 2) * 0.01));
  // Saw bench with a spinning circular blade.
  const sbx = 0.15;
  const sbz = 0.4;
  g.add(rbox(0.5, 0.04, 0.24, 0.01, matte(C.wood, 0.6), sbx, 0.24, sbz));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(rbox(0.03, 0.2, 0.03, 0.006, metal(0x4a4f58), sbx + sx * 0.22, 0.14, sbz + sz * 0.1));
  const blade = new THREE.Group();
  blade.position.set(sbx, 0.27, sbz);
  const disc = cyl(0.09, 0.09, 0.006, 24, metal(0xdfe3e8, 0.15), 0, 0, 0);
  disc.rotation.x = Math.PI / 2;
  blade.add(disc);
  for (let i = 0; i < 12; i++) {
    const tooth = cone(0.012, 0.025, 4, metal(0xdfe3e8, 0.15), Math.cos((i / 12) * TAU) * 0.095, Math.sin((i / 12) * TAU) * 0.095, 0);
    tooth.rotation.z = (i / 12) * TAU - Math.PI / 2;
    blade.add(tooth);
  }
  g.add(blade);
  keep.push(blade);
  g.add(rbox(0.14, 0.06, 0.04, 0.015, paint(0xf2c14e), sbx, 0.32, sbz - 0.02));
  log(g, sbx + 0.12, 0.3, sbz, 0.36, 0.035, Math.PI / 2 - Math.PI / 2);
  // Stump with an axe, trees around.
  g.add(cyl(0.08, 0.09, 0.1, 14, [matte(0x8a5a3a, 0.95), END_GRAIN, END_GRAIN], 0.6, 0.1, 0.75));
  const axe = new THREE.Group();
  axe.position.set(0.6, 0.15, 0.75);
  axe.rotation.z = 0.5;
  axe.add(rbox(0.014, 0.16, 0.014, 0.005, matte(C.wood), 0, 0.08, 0), rbox(0.06, 0.04, 0.008, 0.004, metal(0xc8ced6), 0.025, 0.14, 0));
  g.add(axe);
  pine(g, -1.0, 0.55, 1.1);
  pine(g, -0.7, 0.8, 0.85);
  pine(g, 1.05, -0.2, 0.75);
  lampPost(g, -0.05, 0.7, 0.6);

  const sawyer = worker({ name: '伐木工', shirt: 0xd94a3a, accent: 0x2f3440, body: 'stripes' }, hardHat(0xf2a541));
  sawyer.mesh.position.set(sbx, 0.06, sbz - 0.25);
  g.add(sawyer.mesh);
  keep.push(sawyer.mesh);

  return {
    group: g,
    keep,
    workers: [sawyer],
    door: new THREE.Vector3(-0.1, 0, D / 2 + 0.2),
    pallet: new THREE.Vector3(0.55, 0.05, 0.75),
    anim(dt, time, working) {
      busy(sawyer, dt, time, working, 5);
      blade.rotation.z -= dt * (working ? 18 : 0);
    },
  };
}

// ---------- Mine ----------

function mine() {
  const g = new THREE.Group();
  const keep = [];
  const W = 2.4;
  const D = 2.2;
  g.add(rbox(W, 0.05, D, 0.02, matte(0xb9a98e, 0.95), 0, 0.025, 0));
  // Rocky hill: a cluster of rounded rocks.
  const rock = [matte(0x9a8f84, 0.95), matte(0x8a8077, 0.95), matte(0xa89d90, 0.95)];
  const hill = [
    [0, 0.25, -0.5, 0.6],
    [-0.55, 0.2, -0.45, 0.45],
    [0.55, 0.18, -0.55, 0.45],
    [-0.25, 0.55, -0.6, 0.42],
    [0.3, 0.5, -0.65, 0.4],
    [0, 0.78, -0.7, 0.3],
    [-0.85, 0.1, -0.2, 0.28],
    [0.85, 0.1, -0.25, 0.3],
  ];
  hill.forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), rock[i % 3]);
    m.position.set(x, y, z);
    m.scale.set(1, 0.8, 0.85);
    m.rotation.set(i, i * 2, 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  });
  // Grass tufts on top.
  for (let i = 0; i < 6; i++) g.add(sphere(0.06, paint(0x6aa85a), -0.4 + i * 0.16, 0.85 - Math.abs(i - 2.5) * 0.09, -0.75, 8, 6));
  // Tunnel mouth: a dark arch with a timber frame.
  const tz = -0.05;
  const mouth = mesh(new THREE.CircleGeometry(0.26, 24, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 1 }), 0, 0.05, tz);
  g.add(mouth);
  g.add(mesh(new THREE.PlaneGeometry(0.52, 0.05), mouth.material, 0, 0.03, tz));
  const timber = matte(0x8a5a33, 0.8);
  for (const s of [-1, 1]) g.add(rbox(0.07, 0.36, 0.07, 0.01, timber, s * 0.25, 0.23, tz + 0.03));
  g.add(rbox(0.66, 0.07, 0.08, 0.01, timber, 0, 0.42, tz + 0.03));
  g.add(signBoard('礦場', 0x6b5a4a, 0.42, 0, 0.53, tz + 0.06));
  // Lantern by the tunnel.
  g.add(rbox(0.02, 0.1, 0.02, 0.004, metal(0x2f3440), 0.3, 0.38, tz + 0.08));
  const lantern = sphere(0.03, glow(0xffc870, 2.2), 0.3, 0.32, tz + 0.1, 10, 8);
  g.add(lantern, cyl(0.035, 0.035, 0.012, 10, metal(0x2f3440), 0.3, 0.355, tz + 0.1));
  // Rails out of the tunnel and a mine cart.
  const railZ0 = tz;
  const railLen = 1.15;
  for (let i = 0; i < 9; i++) g.add(rbox(0.26, 0.02, 0.04, 0.005, timber, 0, 0.06, railZ0 + 0.06 + i * 0.13));
  for (const s of [-1, 1]) g.add(rbox(0.018, 0.022, railLen, 0.004, metal(0x8d96a3, 0.35), s * 0.08, 0.08, railZ0 + railLen / 2));
  const cart = new THREE.Group();
  cart.add(rbox(0.24, 0.12, 0.2, 0.02, paint(0x7a6a5a), 0, 0.16, 0));
  cart.add(rbox(0.26, 0.02, 0.22, 0.006, metal(0x4a4f58), 0, 0.225, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const wh = cyl(0.035, 0.035, 0.02, 12, metal(0x2f3440), sx * 0.08, 0.1, sz * 0.07);
    wh.rotation.z = Math.PI / 2;
    cart.add(wh);
  }
  const oreLoad = new THREE.Group();
  for (let i = 0; i < 7; i++) oreLoad.add(sphere(0.04, matte(0x8d96a3, 0.6), ((i % 3) - 1) * 0.06, 0.23 + (i > 4 ? 0.03 : 0), (Math.floor(i / 3) - 1) * 0.05, 6, 5));
  oreLoad.add(mesh(new THREE.OctahedronGeometry(0.025), glow(0x7ad4ff, 1.3), 0.02, 0.27, 0));
  cart.add(oreLoad);
  cart.rotation.y = Math.PI / 2;
  g.add(cart);
  keep.push(cart);
  // Ore pile with glinting crystals.
  const px = 0.75;
  const pz = 0.55;
  const pile = mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, TAU, 0, Math.PI / 2), matte(0x7d8590, 0.9), px, 0.05, pz);
  pile.scale.y = 0.6;
  g.add(pile);
  for (let i = 0; i < 5; i++) {
    const gem = mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshPhysicalMaterial({ color: [0x7ad4ff, 0xb48cff, 0xff8ca0][i % 3], roughness: 0.05, metalness: 0.1, clearcoat: 1, emissive: [0x2a6a9a, 0x5a3a9a, 0x9a3a4a][i % 3], emissiveIntensity: 0.5 }), px + Math.cos(i * 1.3) * 0.13, 0.15 + (i % 2) * 0.03, pz + Math.sin(i * 1.3) * 0.1);
    gem.rotation.set(i, i * 0.7, 0);
    g.add(gem);
  }
  // Tool shed.
  const shx = -0.8;
  const shz = 0.45;
  g.add(rbox(0.5, 0.4, 0.4, 0.02, paint(0x6b7a8a), shx, 0.25, shz));
  const shRoof = rbox(0.6, 0.04, 0.5, 0.01, paint(0x3b3f4a), shx, 0.47, shz);
  shRoof.rotation.z = 0.15;
  g.add(shRoof);
  g.add(rbox(0.18, 0.28, 0.02, 0.008, paint(0x4a5562), shx + 0.08, 0.19, shz + 0.205));
  for (let i = 0; i < 2; i++) {
    const pick = new THREE.Group();
    pick.position.set(shx - 0.15 + i * 0.08, 0.05, shz + 0.25);
    pick.rotation.z = 0.15 - i * 0.3;
    pick.add(rbox(0.014, 0.28, 0.014, 0.005, matte(C.wood), 0, 0.14, 0));
    const head = mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 12, Math.PI), metal(0x8d96a3), 0, 0.26, 0);
    pick.add(head);
    g.add(pick);
  }
  lampPost(g, 0.45, 0.95, 0.55);

  const miner = worker({ name: '礦工', shirt: 0xf2a541, accent: 0x2f3440, body: 'overalls' }, hardHat(0xf2c14e));
  g.add(miner.mesh);
  keep.push(miner.mesh);

  let t = 0;
  return {
    group: g,
    keep,
    workers: [miner],
    door: new THREE.Vector3(0.3, 0, D / 2 + 0.2),
    pallet: new THREE.Vector3(px - 0.05, 0.05, pz + 0.35),
    anim(dt, time, working) {
      // The miner pushes the cart in and out of the tunnel.
      if (working) t += dt * 0.18;
      const u = (Math.sin(t * TAU) + 1) / 2;
      const z = railZ0 + 0.1 + u * 0.9;
      cart.position.set(0, 0.0, z);
      oreLoad.visible = Math.cos(t * TAU) < 0;
      miner.mesh.position.set(0, 0.05, z + 0.22);
      miner.mesh.rotation.y = Math.PI;
      miner.update(dt, time);
      if (working) walkBob(miner, time);
      lantern.material.emissiveIntensity = 2 + Math.sin(time * 5) * 0.2;
    },
  };
}

export const BUILDERS = { bakery, cafe, grocery, furniture, forge, recycle, farm, lumber, mine };
