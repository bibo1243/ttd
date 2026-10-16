import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glassMat } from '../parts.js';
import { Kit, trs } from './kit.js';
import * as TX from './textures.js';

// A cosy cottage sized for the robot residents (about 0.43 tall): real
// door and window openings, glass you can see through, wallpapered rooms,
// furniture, curtains and warm lamps. Front door faces +z.

export const W = 1.8; // outer width (x)
export const D = 1.4; // outer depth (z)
export const T = 0.05; // wall thickness
export const FLOOR = 0.08; // floor height above the ground
export const H = 0.7; // wall height above the floor
const TOP = FLOOR + H;
const RISE = 0.46; // roof ridge above the wall tops
export const DOOR = { x: 0.45, w: 0.3, h: 0.53 };

// ---------- Materials (shared by every house) ----------

const repeat = (t, n) => {
  if (!t) return t;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(n, n);
  return t;
};
const tex = {
  floor: TX.woodFloor(),
  paper: repeat(TX.wallpaper(), 4),
  stucco: repeat(TX.stucco(), 3),
  glow: TX.glow(),
};

const cache = new Map();
const std = (color, o = {}) => {
  const key = `${color}|${JSON.stringify(o)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }));
  return cache.get(key);
};
const phys = (color, o = {}) => {
  const key = `p${color}|${JSON.stringify(o)}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2, ...o }));
  return cache.get(key);
};
const lampLit = (color) => {
  const key = `lamp${color}`;
  if (!cache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, emissive: 0xffb466, emissiveIntensity: 0.9, roughness: 0.6, side: THREE.DoubleSide });
    m.userData.noShadow = true;
    cache.set(key, m);
  }
  return cache.get(key);
};

const M = {
  trim: phys(0xfbf8f1, { roughness: 0.45 }),
  stone: std(0xb9b2a6, { roughness: 0.95 }),
  stoneDark: std(0x8f877b, { roughness: 0.95 }),
  floor: new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.55 }),
  paper: new THREE.MeshStandardMaterial({ map: tex.paper, roughness: 0.9 }),
  wood: std(0xb07a4c, { roughness: 0.6 }),
  woodDark: std(0x7a5236, { roughness: 0.6 }),
  woodLight: std(0xdcb88a, { roughness: 0.6 }),
  white: phys(0xf7f5f0, { roughness: 0.4 }),
  linen: std(0xfbf7ee, { roughness: 0.95 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.85, roughness: 0.25 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd9a94a, metalness: 0.9, roughness: 0.25 }),
  black: std(0x2b2d33, { roughness: 0.5 }),
  counter: phys(0xe9e4dc, { roughness: 0.25 }),
  soil: std(0x5a3d2b, { roughness: 1 }),
  leaf: phys(0x5fae5a, { roughness: 0.5, clearcoat: 0.3 }),
  leafDark: phys(0x3f8a4f, { roughness: 0.5, clearcoat: 0.3 }),
  pot: std(0xc96a4a, { roughness: 0.8 }),
  ceramic: phys(0xffffff, { roughness: 0.15, clearcoat: 1 }),
  bulb: (() => {
    const m = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd28a, emissiveIntensity: 2.2 });
    m.userData.noShadow = true;
    return m;
  })(),
  glass: (() => {
    // A little clearer than the carriage glass so rooms read from outside.
    const m = glassMat.clone();
    m.opacity = 0.5;
    m.envMapIntensity = 2;
    return m;
  })(),
  glowPool: new THREE.MeshBasicMaterial({
    map: tex.glow,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.55,
    toneMapped: false,
  }),
};
const paint = (c) => {
  const key = `paint${c}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color: c, map: tex.stucco, roughness: 0.85 }));
  return cache.get(key);
};

// ---------- Shared geometry ----------

const rb = new Map();
const rbox = (w, h, d, r = Math.min(w, h, d) * 0.3, seg = 2) => {
  const key = `${w},${h},${d},${r},${seg}`;
  if (!rb.has(key)) rb.set(key, new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)));
  return rb.get(key);
};
const cyl = (rt, rbm, h, seg = 16) => new THREE.CylinderGeometry(rt, rbm, h, seg);
const sphere = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

// A wall slab (local x along the wall, y up from its base, +z outward)
// with rectangular openings.
function wallGeo(len, h, depth, holes) {
  // Openings that reach the floor (doors) are notches in the outline.
  const s = new THREE.Shape();
  s.moveTo(-len / 2, 0);
  for (const o of holes.filter((o) => o.y0 <= 0).sort((a, b) => a.x - b.x)) {
    s.lineTo(o.x - o.w / 2, 0).lineTo(o.x - o.w / 2, o.y1).lineTo(o.x + o.w / 2, o.y1).lineTo(o.x + o.w / 2, 0);
  }
  s.lineTo(len / 2, 0).lineTo(len / 2, h).lineTo(-len / 2, h).closePath();
  for (const o of holes.filter((o) => o.y0 > 0)) {
    const p = new THREE.Path();
    p.moveTo(o.x - o.w / 2, o.y0).lineTo(o.x - o.w / 2, o.y1).lineTo(o.x + o.w / 2, o.y1).lineTo(o.x + o.w / 2, o.y0).closePath();
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  return g.translate(0, 0, -depth / 2);
}

// ---------- Exterior pieces ----------

// A window in a wall (wall-local coords): glass, frames on both faces,
// mullions, a sill, and optional curtains, shutters and flower box.
function windowAt(k, o, look) {
  const w = o.w;
  const h = o.y1 - o.y0;
  const cy = (o.y0 + o.y1) / 2;
  const glass = new THREE.PlaneGeometry(w, h);
  k.add(glass, M.glass, o.x, cy, 0);
  const bar = 0.03;
  for (const z of [T / 2 + 0.006, -T / 2 - 0.006]) {
    k.add(rbox(w + bar * 2, bar, 0.02, 0.008), M.trim, o.x, o.y1 + bar / 2 - 0.004, z);
    k.add(rbox(bar, h + bar, 0.02, 0.008), M.trim, o.x - w / 2 - bar / 2 + 0.004, cy, z);
    k.add(rbox(bar, h + bar, 0.02, 0.008), M.trim, o.x + w / 2 + bar / 2 - 0.004, cy, z);
  }
  // Mullions dividing the pane into four lights.
  k.add(rbox(0.012, h, 0.014, 0.005), M.trim, o.x, cy, 0);
  k.add(rbox(w, 0.012, 0.014, 0.005), M.trim, o.x, cy + h * 0.08, 0);
  // Sill sticking out under the window.
  k.add(rbox(w + 0.09, 0.022, T + 0.06, 0.008), M.trim, o.x, o.y0 - 0.008, 0.015);

  if (o.curtains) {
    const zc = -T / 2 - 0.035;
    k.add(cyl(0.006, 0.006, w + 0.16, 8), M.brass, o.x, o.y1 + 0.04, zc, 0, 0, Math.PI / 2);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = o.x + side * (w / 2 + 0.02 - i * 0.022);
        k.add(new THREE.CapsuleGeometry(0.014, h + 0.04, 3, 8), look.curtain, x, cy - 0.01, zc + (i % 2) * 0.008);
      }
      k.add(new THREE.TorusGeometry(0.03, 0.005, 6, 14), look.curtainTie, o.x + side * (w / 2 + 0.0), cy - 0.04, zc, Math.PI / 2, 0, 0);
    }
  }
  if (o.shutters) {
    for (const side of [-1, 1]) {
      const x = o.x + side * (w / 2 + 0.065);
      k.add(rbox(0.09, h + 0.03, 0.014, 0.006), look.shutter, x, cy, T / 2 + 0.012);
      for (let i = 0; i < 5; i++) {
        k.add(rbox(0.072, 0.01, 0.01, 0.004), look.shutter, x, o.y0 + 0.04 + (i * (h - 0.05)) / 5, T / 2 + 0.022, -0.35, 0, 0);
      }
    }
  }
  if (o.flowers) {
    const y = o.y0 - 0.06;
    k.add(rbox(w + 0.04, 0.06, 0.07, 0.012), look.shutter, o.x, y, T / 2 + 0.045);
    k.add(rbox(w, 0.01, 0.055, 0.004), M.soil, o.x, y + 0.03, T / 2 + 0.045);
    const n = Math.round(w / 0.055);
    for (let i = 0; i < n; i++) {
      const fx = o.x - w / 2 + 0.03 + (i * (w - 0.06)) / (n - 1);
      k.add(sphere(0.022, 8, 6), i % 2 ? M.leaf : M.leafDark, fx, y + 0.045, T / 2 + 0.045, 0, 0, 0, 1, 0.8, 1);
      k.add(sphere(0.013, 8, 6), look.flowers[i % look.flowers.length], fx + 0.006, y + 0.07, T / 2 + 0.06);
    }
  }
}

// ---------- Furniture ----------

function bed(k, look, x, z) {
  // Head against the back wall; runs along +z.
  const bw = 0.34;
  const bl = 0.52;
  const cz = z + bl / 2;
  k.add(rbox(bw, 0.06, bl, 0.018), M.wood, x, FLOOR + 0.06, cz);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.add(cyl(0.016, 0.014, 0.05, 10), M.woodDark, x + sx * (bw / 2 - 0.025), FLOOR + 0.025, cz + sz * (bl / 2 - 0.025));
  }
  // Headboard with posts and round finials.
  k.add(rbox(bw, 0.2, 0.03, 0.014), M.wood, x, FLOOR + 0.17, z + 0.015);
  k.add(rbox(bw - 0.07, 0.11, 0.012, 0.005), M.woodLight, x, FLOOR + 0.19, z + 0.032);
  for (const sx of [-1, 1]) {
    k.add(cyl(0.017, 0.017, 0.27, 12), M.woodDark, x + sx * (bw / 2), FLOOR + 0.135, z + 0.015);
    k.add(sphere(0.022), M.woodDark, x + sx * (bw / 2), FLOOR + 0.285, z + 0.015);
  }
  k.add(rbox(0.06, 0.03, 0.012, 0.005), M.wood, x, FLOOR + 0.12, z + bl - 0.01); // footboard lip
  k.add(rbox(bw - 0.03, 0.05, bl - 0.04, 0.02, 3), M.linen, x, FLOOR + 0.11, cz + 0.005);
  // Pillow and a blanket with a folded-back edge.
  k.add(rbox(bw - 0.1, 0.035, 0.09, 0.016, 3), M.linen, x, FLOOR + 0.15, z + 0.08, -0.25, 0, 0);
  k.add(rbox(bw - 0.01, 0.022, bl * 0.58, 0.01, 3), look.blanket, x, FLOOR + 0.138, z + bl * 0.66);
  k.add(rbox(bw - 0.01, 0.012, 0.05, 0.005, 2), M.linen, x, FLOOR + 0.152, z + bl * 0.37);
  k.add(rbox(bw * 0.4, 0.008, 0.03, 0.004), look.accent, x, FLOOR + 0.151, z + bl * 0.6);
}

function lamp(k, x, y, z, shade, h = 0.08) {
  k.add(cyl(0.025, 0.03, 0.012, 16), M.brass, x, y + 0.006, z);
  k.add(cyl(0.005, 0.005, h, 8), M.brass, x, y + h / 2, z);
  k.add(sphere(0.014), M.bulb, x, y + h, z);
  k.add(new THREE.CylinderGeometry(0.03, 0.045, 0.05, 18, 1, true), lampLit(shade), x, y + h + 0.01, z);
}

function nightstand(k, x, z) {
  k.add(rbox(0.12, 0.12, 0.1, 0.014), M.woodLight, x, FLOOR + 0.06, z);
  for (const y of [0.04, 0.085]) {
    k.add(rbox(0.1, 0.035, 0.006, 0.003), M.wood, x, FLOOR + y, z + 0.051);
    k.add(sphere(0.006, 8, 6), M.brass, x, FLOOR + y, z + 0.056);
  }
  lamp(k, x - 0.01, FLOOR + 0.12, z - 0.005, 0xfbe3c0, 0.06);
  k.add(rbox(0.04, 0.012, 0.05, 0.003), M.black, x + 0.035, FLOOR + 0.126, z + 0.02);
}

function sofa(k, look, x, z0, z1) {
  // Against the left wall, facing +x.
  const len = z1 - z0;
  const cz = (z0 + z1) / 2;
  const depth = 0.2;
  k.add(rbox(depth, 0.07, len, 0.025), look.sofa, x, FLOOR + 0.05, cz);
  k.add(rbox(0.06, 0.2, len, 0.025, 3), look.sofa, x - depth / 2 + 0.03, FLOOR + 0.13, cz);
  for (const s of [-1, 1]) {
    k.add(rbox(depth, 0.13, 0.05, 0.022, 3), look.sofa, x, FLOOR + 0.1, cz + s * (len / 2 - 0.025));
  }
  // Two seat cushions and two back cushions.
  for (const s of [-1, 1]) {
    const zz = cz + s * (len / 4 - 0.012);
    k.add(rbox(0.15, 0.04, len / 2 - 0.05, 0.016, 3), look.sofa, x + 0.02, FLOOR + 0.1, zz);
    k.add(rbox(0.05, 0.12, len / 2 - 0.05, 0.022, 3), look.sofa, x - 0.055, FLOOR + 0.17, zz, 0, 0, -0.18);
  }
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) k.add(cyl(0.012, 0.008, 0.025, 8), M.woodDark, x + sx * 0.08, FLOOR + 0.012, cz + sz * (len / 2 - 0.04));
  }
  k.add(rbox(0.035, 0.08, 0.08, 0.02, 3), look.accent, x - 0.03, FLOOR + 0.16, cz + len / 2 - 0.1, 0, 0.3, -0.2);
}

function coffeeTable(k, x, z) {
  k.add(rbox(0.13, 0.016, 0.18, 0.007), M.woodLight, x, FLOOR + 0.075, z);
  k.add(rbox(0.11, 0.01, 0.16, 0.004), M.wood, x, FLOOR + 0.03, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(0.008, 0.008, 0.07, 8), M.woodDark, x + sx * 0.05, FLOOR + 0.035, z + sz * 0.07);
  // A mug and a little stack of books.
  k.add(cyl(0.013, 0.012, 0.025, 14), M.ceramic, x + 0.02, FLOOR + 0.095, z - 0.05);
  k.add(new THREE.TorusGeometry(0.008, 0.0025, 6, 10), M.ceramic, x + 0.034, FLOOR + 0.095, z - 0.05);
  k.add(rbox(0.06, 0.012, 0.08, 0.003), std(0x4a90c8), x - 0.01, FLOOR + 0.089, z + 0.05, 0, 0.2, 0);
  k.add(rbox(0.05, 0.01, 0.07, 0.003), std(0xe85d4a), x - 0.012, FLOOR + 0.1, z + 0.05, 0, -0.1, 0);
}

function rug(k, look, x, z, sx, sz) {
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.006, 40);
  k.add(geo, look.rug, x, FLOOR + 0.003, z, 0, 0, 0, sx, 1, sz);
}

function floorLamp(k, x, z) {
  k.add(cyl(0.035, 0.04, 0.012, 18), M.black, x, FLOOR + 0.006, z);
  k.add(cyl(0.006, 0.006, 0.36, 8), M.brass, x, FLOOR + 0.18, z);
  k.add(sphere(0.016), M.bulb, x, FLOOR + 0.37, z);
  k.add(new THREE.CylinderGeometry(0.04, 0.065, 0.08, 20, 1, true), lampLit(0xfff0d6), x, FLOOR + 0.38, z);
}

function diningSet(k, look, x, z) {
  k.add(cyl(0.13, 0.13, 0.018, 28), M.woodLight, x, FLOOR + 0.13, z);
  k.add(new THREE.TorusGeometry(0.13, 0.009, 6, 28), M.woodLight, x, FLOOR + 0.13, z, Math.PI / 2, 0, 0);
  k.add(cyl(0.02, 0.026, 0.12, 12), M.woodDark, x, FLOOR + 0.065, z);
  k.add(cyl(0.06, 0.07, 0.012, 20), M.woodDark, x, FLOOR + 0.006, z);
  // Plates, a vase with flowers.
  for (const s of [-1, 1]) {
    k.add(cyl(0.035, 0.03, 0.006, 20), M.ceramic, x + s * 0.07, FLOOR + 0.142, z);
    k.add(cyl(0.016, 0.014, 0.006, 14), look.accent, x + s * 0.07, FLOOR + 0.146, z);
  }
  k.add(cyl(0.012, 0.018, 0.045, 14), M.ceramic, x, FLOOR + 0.162, z - 0.02);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    k.add(cyl(0.002, 0.002, 0.05, 4), M.leafDark, x + Math.cos(a) * 0.006, FLOOR + 0.2, z - 0.02 + Math.sin(a) * 0.006, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
    k.add(sphere(0.011, 8, 6), look.flowers[i % look.flowers.length], x + Math.cos(a) * 0.014, FLOOR + 0.228, z - 0.02 + Math.sin(a) * 0.014);
  }
  for (const s of [-1, 1]) chair(k, look, x + s * 0.2, z, s < 0 ? Math.PI / 2 : -Math.PI / 2);
}

// A chair whose seat faces direction `ry` (0 = +z).
function chair(k, look, x, z, ry) {
  k.within(trs(x, FLOOR, z, 0, ry, 0), () => {
    k.add(rbox(0.13, 0.02, 0.12, 0.008), M.wood, 0, 0.1, 0);
    k.add(rbox(0.11, 0.012, 0.1, 0.006), look.sofa, 0, 0.115, 0.004);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) k.add(cyl(0.007, 0.006, 0.1, 8), M.woodDark, sx * 0.05, 0.05, sz * 0.045);
      k.add(cyl(0.007, 0.007, 0.15, 8), M.woodDark, sx * 0.05, 0.175, -0.052);
    }
    k.add(rbox(0.11, 0.05, 0.012, 0.006), M.wood, 0, 0.22, -0.052);
    k.add(rbox(0.1, 0.012, 0.01, 0.004), M.wood, 0, 0.16, -0.052);
  });
}

function kitchen(k, look, x0, x1, z) {
  // Base cabinets along the back wall from x0 to x1, front face toward +z.
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const d = 0.17;
  const cz = z + d / 2;
  k.add(rbox(len, 0.15, d, 0.012), look.cabinet, cx, FLOOR + 0.075, cz);
  k.add(rbox(len + 0.01, 0.02, d + 0.015, 0.006), M.counter, cx, FLOOR + 0.16, cz + 0.004);
  k.add(rbox(len - 0.02, 0.012, 0.01, 0.004), M.black, cx, FLOOR + 0.008, z + d - 0.01); // toe kick
  const doors = Math.round(len / 0.15);
  for (let i = 0; i < doors; i++) {
    const dx = x0 + (i + 0.5) * (len / doors);
    k.add(rbox(len / doors - 0.012, 0.12, 0.008, 0.004), look.cabinet, dx, FLOOR + 0.08, z + d + 0.002);
    k.add(cyl(0.003, 0.003, 0.03, 6), M.metal, dx + (i % 2 ? -1 : 1) * (len / doors / 2 - 0.02), FLOOR + 0.11, z + d + 0.01);
  }
  // Sink with a curved tap.
  const sx = cx - len * 0.22;
  k.add(rbox(0.1, 0.012, 0.08, 0.005), M.metal, sx, FLOOR + 0.168, cz);
  k.add(rbox(0.08, 0.004, 0.06, 0.002), M.black, sx, FLOOR + 0.172, cz);
  k.add(cyl(0.004, 0.004, 0.05, 8), M.metal, sx, FLOOR + 0.195, z + 0.02);
  k.add(new THREE.TorusGeometry(0.018, 0.004, 6, 12, Math.PI), M.metal, sx, FLOOR + 0.22, z + 0.038, 0, Math.PI / 2, 0);
  // Two-ring hob with a pot on it.
  const hx = cx + len * 0.2;
  k.add(rbox(0.12, 0.006, 0.09, 0.003), M.black, hx, FLOOR + 0.171, cz);
  for (const s of [-1, 1]) k.add(new THREE.TorusGeometry(0.018, 0.003, 6, 16), std(0x55585f), hx + s * 0.03, FLOOR + 0.175, cz, Math.PI / 2, 0, 0);
  k.add(cyl(0.024, 0.022, 0.035, 16), look.pot, hx + 0.03, FLOOR + 0.193, cz);
  k.add(cyl(0.025, 0.025, 0.005, 16), look.pot, hx + 0.03, FLOOR + 0.212, cz);
  k.add(sphere(0.006, 8, 6), M.black, hx + 0.03, FLOOR + 0.218, cz);
  // Open shelf above with jars.
  k.add(rbox(len * 0.6, 0.012, 0.07, 0.004), M.woodLight, cx, FLOOR + 0.43, z + 0.035);
  const jars = [0xe8789a, 0xf2a541, 0x7bc67b, 0x4a90c8];
  for (let i = 0; i < 4; i++) {
    const jx = cx - len * 0.24 + i * len * 0.16;
    k.add(cyl(0.015, 0.015, 0.04, 12), M.glass, jx, FLOOR + 0.456, z + 0.035);
    k.add(cyl(0.012, 0.012, 0.025, 10), std(jars[i]), jx, FLOOR + 0.45, z + 0.035);
    k.add(cyl(0.016, 0.016, 0.008, 12), M.woodDark, jx, FLOOR + 0.48, z + 0.035);
  }
}

function fridge(k, look, x, z) {
  k.add(rbox(0.16, 0.42, 0.16, 0.035, 3), look.fridge, x, FLOOR + 0.21, z);
  k.add(rbox(0.15, 0.004, 0.005, 0.002), std(0x9aa0a8), x, FLOOR + 0.27, z + 0.081);
  k.add(rbox(0.012, 0.09, 0.014, 0.005), M.metal, x - 0.055, FLOOR + 0.34, z + 0.088);
  k.add(rbox(0.012, 0.12, 0.014, 0.005), M.metal, x - 0.055, FLOOR + 0.16, z + 0.088);
  k.add(cyl(0.012, 0.012, 0.004, 12), std(0xe85d4a), x + 0.03, FLOOR + 0.35, z + 0.082, Math.PI / 2, 0, 0);
}

function bookshelf(k, x, z) {
  const w = 0.22;
  const h = 0.4;
  k.add(rbox(w, h, 0.012, 0.004), M.woodDark, x, FLOOR + h / 2, z - 0.035);
  for (const s of [-1, 1]) k.add(rbox(0.016, h, 0.08, 0.005), M.wood, x + s * (w / 2 - 0.008), FLOOR + h / 2, z);
  const books = [0xe85d4a, 0x4a90c8, 0xf4d35e, 0x7bc67b, 0x9b7fd1, 0xf2a541, 0x56c2c2, 0x5c6b7a];
  for (let r = 0; r < 4; r++) {
    const y = FLOOR + 0.01 + r * 0.1;
    k.add(rbox(w, 0.014, 0.08, 0.004), M.wood, x, y, z);
    if (r === 3) break;
    let bx = x - w / 2 + 0.022;
    let i = r * 3;
    while (bx < x + w / 2 - 0.04) {
      const bw = 0.014 + ((i * 7) % 5) * 0.003;
      const bh = 0.06 + ((i * 5) % 4) * 0.006;
      const lean = i % 7 === 3 ? 0.25 : 0;
      k.add(rbox(bw, bh, 0.06, 0.003), std(books[i % books.length], { roughness: 0.6 }), bx + bw / 2, y + 0.007 + bh / 2, z + 0.004, 0, 0, lean);
      bx += bw + 0.003 + lean * 0.03;
      i++;
    }
  }
  pottedPlant(k, x + 0.05, FLOOR + h + 0.01, z, 0.5);
}

function pottedPlant(k, x, y, z, s = 1) {
  k.add(cyl(0.05 * s, 0.038 * s, 0.07 * s, 16), M.pot, x, y + 0.035 * s, z);
  k.add(new THREE.TorusGeometry(0.05 * s, 0.006 * s, 6, 16), M.pot, x, y + 0.07 * s, z, Math.PI / 2, 0, 0);
  k.add(cyl(0.045 * s, 0.045 * s, 0.006, 14), M.soil, x, y + 0.066 * s, z);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    const r = 0.025 * s;
    k.add(sphere(0.03 * s, 10, 8), i % 2 ? M.leaf : M.leafDark, x + Math.cos(a) * r, y + (0.1 + (i % 3) * 0.035) * s, z + Math.sin(a) * r, 0, -a, Math.cos(a) * 0.5, 0.8, 1.7, 0.45);
  }
}

function picture(k, look, x, y, z, ry, w, h, map) {
  k.within(trs(x, y, z, 0, ry, 0), () => {
    k.add(rbox(w + 0.025, h + 0.025, 0.012, 0.004), M.woodDark, 0, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.6 });
    k.add(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0.0065);
  });
}

function clock(k, x, y, z, ry) {
  k.within(trs(x, y, z, 0, ry, 0), () => {
    k.add(cyl(0.04, 0.04, 0.012, 24), M.white, 0, 0, 0, Math.PI / 2, 0, 0);
    k.add(new THREE.TorusGeometry(0.04, 0.005, 6, 24), M.brass, 0, 0, 0.004);
    k.add(rbox(0.004, 0.028, 0.002, 0.001), M.black, 0, 0.01, 0.008);
    k.add(rbox(0.004, 0.02, 0.002, 0.001), M.black, 0.007, -0.003, 0.008, 0, 0, -1.2);
  });
}

function coatRack(k, look, x, z) {
  k.add(cyl(0.03, 0.035, 0.01, 14), M.woodDark, x, FLOOR + 0.005, z);
  k.add(cyl(0.007, 0.007, 0.4, 8), M.woodDark, x, FLOOR + 0.2, z);
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + 0.4;
    k.add(cyl(0.004, 0.004, 0.04, 6), M.woodDark, x + Math.cos(a) * 0.015, FLOOR + 0.38, z + Math.sin(a) * 0.015, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
  }
  k.add(sphere(0.012), M.woodDark, x, FLOOR + 0.405, z);
  // A scarf hanging off one hook.
  k.add(new THREE.CapsuleGeometry(0.01, 0.14, 3, 8), look.blanket, x + 0.03, FLOOR + 0.3, z + 0.01, 0, 0, 0.15);
  k.add(new THREE.CapsuleGeometry(0.01, 0.1, 3, 8), look.blanket, x + 0.016, FLOOR + 0.32, z + 0.02, 0, 0, 0.1);
}

function glowPool(k, x, y, z, r) {
  k.add(new THREE.PlaneGeometry(r * 2, r * 2), M.glowPool, x, y, z, -Math.PI / 2, 0, 0);
}

// ---------- The house ----------

const WALLS = [0xf6e7cf, 0xfbd5c0, 0xdbe8f4, 0xf4f0d2, 0xe4f0dc, 0xf3dbe3];
const ROOFS = [0xc85a4a, 0x4e7fb8, 0x6b4e3d, 0x3f8a6b, 0x8a5aa8, 0xd08a3c];
const ACCENTS = [0x4a90c8, 0xe85d4a, 0x7bc67b, 0xf2a541, 0x9b7fd1, 0x56c2c2];
const SOFAS = [0x5c8fb8, 0xd98a6c, 0x7fae7a, 0xc9a2d6, 0xe0b55a, 0x8f9aa6];
const FLOWERS = [0xf7a6c1, 0xffffff, 0xf4d35e, 0xe85d4a, 0xb39ddb];
const PAINT_SKY = ['#9fd3f2', '#f7c6a3', '#c6b8f2'];
const PAINT_HILL = ['#6dbb6a', '#4e9a7a', '#88b85a'];

const pickOf = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

export function buildHouse(seed) {
  const i = seed;
  const wall = pickOf(WALLS, i);
  const roof = pickOf(ROOFS, i * 5 + 1);
  const accent = pickOf(ACCENTS, i * 3 + 2);
  const look = {
    accent: phys(accent),
    shutter: phys(pickOf(ACCENTS, i * 3 + 4), { roughness: 0.5 }),
    curtain: std(pickOf([0xf6d7a7, 0xf3b7b0, 0xc7dcef, 0xe4d4f0], i), { roughness: 0.95 }),
    curtainTie: M.brass,
    blanket: std(pickOf(SOFAS, i + 2), { roughness: 0.9 }),
    sofa: std(pickOf(SOFAS, i), { roughness: 0.85 }),
    cabinet: phys(pickOf([0xf7f5f0, 0x9cc6b6, 0xa9c4e0, 0xf3d9a4], i), { roughness: 0.45 }),
    fridge: phys(pickOf([0xbfe3d8, 0xf6d3d8, 0xfff0c2, 0xd8e3f6], i + 1), { roughness: 0.25, clearcoat: 1 }),
    pot: phys(0xd94a3a, { roughness: 0.3 }),
    rug: new THREE.MeshStandardMaterial({ map: TX.rug(pickOf(['#e9d7b9', '#cfe0ea', '#efd0c4'], i), pickOf(['#b5574a', '#4a6f9b', '#5f8f63'], i)), roughness: 1 }),
    flowers: [pickOf(FLOWERS, i), pickOf(FLOWERS, i + 2), pickOf(FLOWERS, i + 3)].map((c) => phys(c, { roughness: 0.5 })),
  };
  const P = paint(wall);
  const roofMat = phys(roof, { roughness: 0.55, clearcoat: 0.25 });

  const group = new THREE.Group();
  const k = new Kit();

  // Foundation, floor and the front steps.
  k.add(rbox(W + 0.08, FLOOR, D + 0.08, 0.02), M.stone, 0, FLOOR / 2, 0);
  k.add(new THREE.PlaneGeometry(W - 2 * T, D - 2 * T), M.floor, 0, FLOOR + 0.001, 0, -Math.PI / 2, 0, 0);
  k.add(rbox(DOOR.w + 0.14, FLOOR * 0.5, 0.16, 0.012), M.stoneDark, DOOR.x, FLOOR * 0.25, D / 2 + 0.1);
  k.add(rbox(DOOR.w + 0.08, FLOOR * 0.5, 0.08, 0.012), M.stoneDark, DOOR.x, FLOOR * 0.75, D / 2 + 0.06);
  // Stepping stones down the garden path.
  for (let s = 0; s < 4; s++) {
    k.add(cyl(0.075, 0.08, 0.02, 14), M.stone, DOOR.x + (s % 2 ? 0.03 : -0.03), 0.008, D / 2 + 0.32 + s * 0.2, 0, s, 0, 1, 1, 0.8);
  }

  // Walls: each in its own frame with +z pointing out of the house.
  const sideLen = D - 2 * T;
  const walls = [
    {
      m: trs(0, FLOOR, D / 2 - T / 2),
      len: W,
      holes: [
        { x: DOOR.x, w: DOOR.w, y0: 0, y1: DOOR.h, door: true },
        { x: -0.38, w: 0.5, y0: 0.22, y1: 0.54, curtains: true, shutters: true, flowers: true },
      ],
    },
    { m: trs(0, FLOOR, -D / 2 + T / 2, 0, Math.PI, 0), len: W, holes: [{ x: -0.42, w: 0.36, y0: 0.27, y1: 0.54 }] },
    { m: trs(-W / 2 + T / 2, FLOOR, 0, 0, -Math.PI / 2, 0), len: sideLen, holes: [{ x: 0.22, w: 0.4, y0: 0.28, y1: 0.54, curtains: true, flowers: true }] },
    { m: trs(W / 2 - T / 2, FLOOR, 0, 0, Math.PI / 2, 0), len: sideLen, holes: [{ x: -0.12, w: 0.36, y0: 0.24, y1: 0.54, curtains: true, flowers: true }] },
  ];
  for (const wl of walls) {
    k.within(wl.m, () => {
      k.add(wallGeo(wl.len, H, T, wl.holes), P);
      // Wallpaper liner on the inside face, a skirting board and a dado rail.
      const inner = wl.len - (wl.len === W ? 2 * T : 0);
      k.add(wallGeo(inner, H, 0.004, wl.holes), M.paper, 0, 0, -T / 2 - 0.0025);
      const solid = (y0, y1) => wl.holes.filter((o) => o.y0 < y1 && o.y1 > y0);
      const runs = (y0, y1) => {
        // Spans of the wall not interrupted by an opening at these heights.
        const cuts = solid(y0, y1).map((o) => [o.x - o.w / 2 - 0.02, o.x + o.w / 2 + 0.02]).sort((a, b) => a[0] - b[0]);
        const out = [];
        let x = -inner / 2;
        for (const [a, b] of cuts) {
          if (a > x) out.push([x, a]);
          x = Math.max(x, b);
        }
        if (x < inner / 2) out.push([x, inner / 2]);
        return out;
      };
      for (const [a, b] of runs(0, 0.04)) k.add(rbox(b - a, 0.035, 0.012, 0.004), M.white, (a + b) / 2, 0.0175, -T / 2 - 0.008);
      for (const [a, b] of runs(0.19, 0.21)) k.add(rbox(b - a, 0.012, 0.01, 0.004), M.white, (a + b) / 2, 0.2, -T / 2 - 0.007);
      // Eaves trim along the top outside.
      k.add(rbox(wl.len + 0.02, 0.03, 0.02, 0.008), M.trim, 0, H - 0.015, T / 2 + 0.006);
      for (const o of wl.holes) if (!o.door) windowAt(k, o, look);
    });
  }
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(rbox(0.07, H + 0.02, 0.07, 0.02), M.trim, sx * (W / 2 - 0.02), FLOOR + H / 2, sz * (D / 2 - 0.02));
  // Ceiling tie beam the dining pendant hangs from.
  k.add(rbox(0.05, 0.05, D - 2 * T, 0.01), M.woodDark, 0.3, TOP - 0.03, 0);

  // Door frame, awning, wall lamp, house number, doormat.
  const fz = D / 2 + 0.007;
  k.add(rbox(DOOR.w + 0.07, 0.04, 0.025, 0.01), M.trim, DOOR.x, FLOOR + DOOR.h + 0.015, fz);
  for (const s of [-1, 1]) k.add(rbox(0.035, DOOR.h + 0.01, 0.025, 0.01), M.trim, DOOR.x + s * (DOOR.w / 2 + 0.012), FLOOR + DOOR.h / 2, fz);
  k.add(rbox(DOOR.w + 0.16, 0.025, 0.15, 0.01), roofMat, DOOR.x, FLOOR + DOOR.h + 0.09, D / 2 + 0.07, 0.3, 0, 0);
  for (const s of [-1, 1]) k.add(rbox(0.015, 0.07, 0.015, 0.005), M.trim, DOOR.x + s * (DOOR.w / 2 + 0.05), FLOOR + DOOR.h + 0.04, D / 2 + 0.06, -0.7, 0, 0);
  const lx = DOOR.x + DOOR.w / 2 + 0.09;
  k.add(rbox(0.03, 0.05, 0.02, 0.006), M.black, lx, FLOOR + DOOR.h - 0.05, D / 2 + 0.015);
  k.add(cyl(0.022, 0.018, 0.05, 6), M.glass, lx, FLOOR + DOOR.h - 0.04, D / 2 + 0.045);
  k.add(sphere(0.012), M.bulb, lx, FLOOR + DOOR.h - 0.04, D / 2 + 0.045);
  k.add(new THREE.ConeGeometry(0.03, 0.02, 6), M.black, lx, FLOOR + DOOR.h - 0.006, D / 2 + 0.045);
  k.add(rbox(0.07, 0.035, 0.008, 0.004), M.trim, DOOR.x - DOOR.w / 2 - 0.08, FLOOR + 0.42, fz);
  k.add(rbox(0.055, 0.022, 0.004, 0.002), look.accent, DOOR.x - DOOR.w / 2 - 0.08, FLOOR + 0.42, fz + 0.005);
  k.add(rbox(DOOR.w, 0.006, 0.12, 0.003), std(0x9c6b3e, { roughness: 1 }), DOOR.x, FLOOR + 0.004, D / 2 - T - 0.07);

  // Mailbox on a post by the path, and a hedge at two corners.
  const mx = DOOR.x + 0.32;
  const mz = D / 2 + 0.55;
  k.add(cyl(0.012, 0.012, 0.2, 8), M.woodDark, mx, 0.1, mz);
  k.add(rbox(0.07, 0.06, 0.1, 0.025, 3), look.accent, mx, 0.22, mz);
  k.add(rbox(0.006, 0.04, 0.012, 0.002), std(0xe85d4a), mx + 0.04, 0.24, mz - 0.02);
  for (const [hx, hz] of [[-W / 2 - 0.05, D / 2 + 0.08], [W / 2 + 0.06, -D / 2 - 0.02]]) {
    for (let j = 0; j < 3; j++) k.add(sphere(0.08, 12, 10), j % 2 ? M.leaf : M.leafDark, hx + (j - 1) * 0.02, 0.07 + j * 0.02, hz + (j - 1) * 0.07, 0, 0, 0, 1.1, 0.9, 1.1);
  }

  // ---------- Furniture ----------
  const ix = W / 2 - T; // inner half extents
  const iz = D / 2 - T;
  bed(k, look, -ix + 0.2, -iz);
  nightstand(k, -ix + 0.45, -iz + 0.06);
  sofa(k, look, -ix + 0.1, -0.06, 0.52);
  rug(k, look, -0.36, 0.24, 0.32, 0.5);
  coffeeTable(k, -0.4, 0.24);
  floorLamp(k, -ix + 0.07, iz - 0.07);
  diningSet(k, look, 0.3, 0.05);
  kitchen(k, look, 0.02, 0.6, -iz);
  fridge(k, look, ix - 0.09, -iz + 0.09);
  bookshelf(k, 0.06, iz - 0.045);
  pottedPlant(k, -0.06 - 0.08, FLOOR, iz - 0.07, 0.9);
  coatRack(k, look, ix - 0.05, iz - 0.08);
  picture(k, look, -ix + 0.2, FLOOR + 0.44, -iz + 0.004, 0, 0.16, 0.12, TX.painting(pickOf(PAINT_SKY, i), pickOf(PAINT_HILL, i)));
  picture(k, look, -ix + 0.003, FLOOR + 0.47, -0.25, Math.PI / 2, 0.1, 0.08, TX.painting(pickOf(PAINT_SKY, i + 1), pickOf(PAINT_HILL, i + 2)));
  clock(k, ix - 0.003, FLOOR + 0.5, 0.25, -Math.PI / 2);
  // Pendant over the dining table.
  const px = 0.3;
  k.add(cyl(0.003, 0.003, 0.2, 6), M.black, px, TOP - 0.15, 0.05);
  k.add(new THREE.SphereGeometry(0.06, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), lampLit(accent), px, TOP - 0.29, 0.05);
  k.add(sphere(0.018), M.bulb, px, TOP - 0.3, 0.05);
  // Pools of lamp light on the floor and table.
  glowPool(k, -ix + 0.12, FLOOR + 0.008, iz - 0.12, 0.3);
  glowPool(k, px, FLOOR + 0.141, 0.05, 0.2);
  glowPool(k, px, FLOOR + 0.007, 0.05, 0.36);
  glowPool(k, -ix + 0.45, FLOOR + 0.007, -iz + 0.12, 0.2);

  const body = k.build(new THREE.Group());
  group.add(body);

  // ---------- Roof (its own group so it can lift off for a peek) ----------
  const roofGroup = new THREE.Group();
  const rk = new Kit();
  const half = D / 2;
  const over = 0.15;
  const slope = RISE / half;
  const angle = Math.atan(slope);
  const L = (half + over) / Math.cos(angle);
  const thick = 0.05;
  for (const s of [1, -1]) {
    // Slab frame: origin on the ridge line, local +z running down the slope.
    const frame = trs(0, TOP + RISE, 0, s * angle, s > 0 ? 0 : Math.PI, 0);
    rk.within(frame, () => {
      rk.add(rbox(W + 0.26, thick, L, 0.015), roofMat, 0, thick / 2, L / 2);
      // Rows of rounded tiles.
      const rows = 6;
      for (let r = 0; r < rows; r++) {
        const z = 0.07 + (r * (L - 0.08)) / rows;
        rk.add(rbox(W + 0.26, 0.022, L / rows + 0.02, 0.01), roofMat, 0, thick + 0.006 + r * 0.0005, z + 0.04, 0.06, 0, 0);
      }
      // Fascia board along the eave.
      rk.add(rbox(W + 0.28, 0.05, 0.022, 0.008), M.trim, 0, thick / 2 - 0.005, L + 0.004, -angle, 0, 0);
    });
  }
  // Ridge cap.
  rk.add(cyl(0.035, 0.035, W + 0.3, 14), roofMat, 0, TOP + RISE + 0.04, 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) rk.add(sphere(0.04), roofMat, s * (W / 2 + 0.15), TOP + RISE + 0.04, 0);
  // Gable ends with a round vent window.
  const gable = new THREE.Shape();
  gable.moveTo(-half, 0).lineTo(half, 0).lineTo(0, RISE).closePath();
  const vent = new THREE.Path();
  vent.absarc(0, RISE * 0.4, 0.07, 0, Math.PI * 2, true);
  gable.holes.push(vent);
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: T, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -T / 2);
  for (const s of [-1, 1]) {
    rk.within(trs(s * (W / 2 - T / 2), TOP, 0, 0, s * Math.PI / 2, 0), () => {
      rk.add(gableGeo, P);
      rk.add(new THREE.CircleGeometry(0.07, 20), M.glass, 0, RISE * 0.4, 0);
      rk.add(new THREE.TorusGeometry(0.075, 0.012, 8, 24), M.trim, 0, RISE * 0.4, T / 2 + 0.004);
      rk.add(rbox(0.15, 0.012, 0.012, 0.004), M.trim, 0, RISE * 0.4, T / 2 + 0.002);
      rk.add(rbox(0.012, 0.15, 0.012, 0.004), M.trim, 0, RISE * 0.4, T / 2 + 0.002);
    });
  }
  // Brick chimney on the back slope.
  const chx = -0.5;
  const chz = -0.32;
  const chBase = TOP + RISE - (Math.abs(chz) + 0.08) * slope;
  const chTop = TOP + RISE + 0.16;
  rk.add(rbox(0.16, chTop - chBase + 0.05, 0.16, 0.02), std(0xb5574a, { roughness: 0.9 }), chx, (chTop + chBase) / 2, chz);
  rk.add(rbox(0.2, 0.035, 0.2, 0.012), M.stoneDark, chx, chTop + 0.03, chz);
  for (let b = 0; b < 3; b++) rk.add(rbox(0.162, 0.006, 0.162, 0.002), std(0xe6d6c4), chx, chBase + 0.1 + b * 0.07, chz);
  rk.build(roofGroup);
  group.add(roofGroup);

  // ---------- The front door (hinged, swings inward) ----------
  const door = new THREE.Group();
  door.position.set(DOOR.x - DOOR.w / 2, FLOOR, D / 2 - T / 2);
  const leaf = new THREE.Group();
  const dk = new Kit();
  const dw = DOOR.w - 0.006;
  const doorMat = phys(pickOf(ACCENTS, i * 3 + 4), { roughness: 0.4 });
  dk.add(rbox(dw, DOOR.h - 0.005, 0.03, 0.01), doorMat, dw / 2, DOOR.h / 2, 0);
  for (const y of [0.15, 0.37]) {
    for (const z of [0.016, -0.016]) dk.add(rbox(dw - 0.08, 0.14, 0.008, 0.005), doorMat, dw / 2, y, z);
  }
  dk.add(new THREE.CircleGeometry(0.045, 20), M.glass, dw / 2, 0.42, 0.021);
  dk.add(new THREE.TorusGeometry(0.047, 0.007, 6, 20), M.brass, dw / 2, 0.42, 0.021);
  for (const z of [0.024, -0.024]) dk.add(sphere(0.012), M.brass, dw - 0.04, 0.25, z);
  dk.build(leaf);
  door.add(leaf);
  group.add(door);

  return { group, roof: roofGroup, door, leaf };
}

// Places inside the house where a resident can spend time, in house-local
// coords [x, z]. pose: 'sit' (on furniture, facing ry), 'lie' (in bed) or
// 'stand' (facing ry). path: walk from just inside the door to the spot.
const ix = W / 2 - T;
const iz = D / 2 - T;
export const ENTRY = new THREE.Vector3(DOOR.x, FLOOR, iz - 0.12);
export const THRESHOLD = new THREE.Vector3(DOOR.x, FLOOR, D / 2 - T / 2);
export const DOORSTEP = new THREE.Vector3(DOOR.x, 0, D / 2 + 0.3);
const SEAT_Y = FLOOR + 0.055;
const HALL = [[-0.12, 0.3], [-0.12, 0.02]];
export const SPOTS = [
  { pose: 'sit', y: SEAT_Y, at: [-ix + 0.12, 0.1], ry: Math.PI / 2, path: [...HALL, [-0.52, 0.03]] },
  { pose: 'sit', y: SEAT_Y, at: [-ix + 0.12, 0.36], ry: Math.PI / 2, path: [[0.2, 0.44], [-0.52, 0.44]] },
  { pose: 'sit', y: SEAT_Y, at: [0.1, 0.05], ry: Math.PI / 2, path: [[0.1, 0.3]] },
  { pose: 'sit', y: SEAT_Y, at: [0.5, 0.05], ry: -Math.PI / 2, path: [[0.5, 0.3]] },
  { pose: 'lie', y: FLOOR + 0.205, at: [-ix + 0.2, -0.27], ry: 0, path: [...HALL, [-0.12, -0.25], [-0.36, -0.27]] },
  { pose: 'stand', y: FLOOR, at: [0.42, -iz + 0.28], ry: Math.PI, path: [[0.72, 0.32], [0.72, -0.26]] },
  { pose: 'stand', y: FLOOR, at: [0.16, -iz + 0.28], ry: Math.PI, path: [...HALL, [-0.12, -0.3]] },
  { pose: 'stand', y: FLOOR, at: [0.06, iz - 0.2], ry: 0, path: [[0.2, 0.36]] },
];
