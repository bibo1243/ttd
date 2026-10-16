import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sliceForPlanet } from './planet.js';

// Station designs. Every platform's track-side edge sits 0.45 from the rail
// centre; x grows outward from the rails, z runs along the track.
//
//   len      platform length
//   width    platform width
//   ramps    z of each set of steps up from the ground at the back
//   depth    how far out from the rails the whole station reaches
//   shed     the roof also spans the track (needs room on the far side)
//   waiting  how many robots fit on the platform
export const RAIL_EDGE = 0.45;
export const PLATFORM_Y = 0.3;
export const STEP_W = 0.26;
export const STEP_H = PLATFORM_Y / 2;

export const STATION_STYLES = {
  halt: { key: 'halt', label: '小站', desc: '一座候車亭和長椅', len: 8, width: 1.0, ramps: [-2.6, 2.6], cost: 450, waiting: 10, extra: 0.6 },
  town: { key: 'town', label: '一般站', desc: '長雨棚、站房和時鐘', len: 12, width: 1.25, ramps: [-4.1, 4.1], cost: 950, waiting: 16, extra: 1.75 },
  grand: { key: 'grand', label: '大車站', desc: '玻璃拱頂、鐘塔站房', len: 16, width: 1.5, ramps: [-6.4, -4.4, 4.4, 6.4], cost: 1900, waiting: 24, extra: 2.35, shed: true },
};
for (const s of Object.values(STATION_STYLES)) {
  s.px = RAIL_EDGE + s.width / 2; // platform centre
  s.back = RAIL_EDGE + s.width; // platform back edge
  s.stepX = s.back + STEP_W / 2;
  s.depth = s.back + s.extra;
}

// ---------- Materials (shared by every station) ----------

const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const M = {
  slab: std(0xd9d2c5, 0.9),
  paving: std(0xe8e2d6, 0.85),
  coping: std(0xf4f0e8, 0.6),
  tactile: std(0xf2c14e, 0.7),
  line: std(0xffffff, 0.6),
  step: std(0xcfc6b8, 0.9),
  white: std(0xf4efe6, 0.5),
  steel: std(0x59606b, 0.35, { metalness: 0.6 }),
  darkSteel: std(0x3a3f47, 0.4, { metalness: 0.5 }),
  wood: std(0x9a6640, 0.6),
  cream: std(0xf3e6cf, 0.85),
  brick: std(0xb96a4f, 0.9),
  stone: std(0xd8d0c2, 0.85),
  frame: std(0xffffff, 0.45),
  door: std(0x6d4a33, 0.6),
  pot: std(0xc8734e, 0.85),
  leaf: std(0x4f9a52, 0.8),
  flowers: [std(0xf06f8f, 0.7), std(0xf2c14e, 0.7), std(0xffffff, 0.7), std(0xa98be0, 0.7)],
  bin: std(0x3f8f6a, 0.6),
  lampGlow: std(0xfff2cf, 0.4, { emissive: 0xffd58a, emissiveIntensity: 0.9 }),
  window: new THREE.MeshPhysicalMaterial({ color: 0xffe2a8, roughness: 0.15, metalness: 0, clearcoat: 1, emissive: 0xffb85c, emissiveIntensity: 0.35 }),
  shedGlass: new THREE.MeshPhysicalMaterial({ color: 0xcfe7f2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  shelterGlass: new THREE.MeshPhysicalMaterial({ color: 0xd8eef6, roughness: 0.05, transparent: true, opacity: 0.38, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  clockFace: std(0xfffdf6, 0.4),
  board: std(0x1d2128, 0.5),
  amber: std(0x2a2410, 0.5, { emissive: 0xffa630, emissiveIntensity: 0.8 }),
  vend: std(0xe0453a, 0.45),
  vendFront: std(0xdde6ec, 0.2, { emissive: 0x9fc6e0, emissiveIntensity: 0.25 }),
};
const colorMats = new Map();
const tint = (color, roughness = 0.6) => {
  const k = `${color}:${roughness}`;
  if (!colorMats.has(k)) colorMats.set(k, std(color, roughness));
  return colorMats.get(k);
};

// ---------- Small helpers ----------

function add(g, geo, mat, x, y, z, ry = 0) {
  const sliced = sliceForPlanet(geo);
  if (sliced !== geo) geo.dispose();
  const m = new THREE.Mesh(sliced, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  g.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
const cyl = (r, h, n = 12) => new THREE.CylinderGeometry(r, r, h, n);

// A bench facing the track (-x).
function bench(g, x, y, z) {
  add(g, rbox(0.14, 0.022, 0.62, 0.008), M.wood, x, y + 0.11, z);
  add(g, rbox(0.022, 0.1, 0.62, 0.008), M.wood, x + 0.075, y + 0.18, z);
  for (const dz of [-0.26, 0.26]) {
    add(g, rbox(0.15, 0.1, 0.025, 0.006), M.darkSteel, x, y + 0.05, z + dz);
    add(g, rbox(0.02, 0.1, 0.025, 0.006), M.darkSteel, x + 0.075, y + 0.16, z + dz);
  }
}

function lamp(g, x, y, z, h = 0.9) {
  add(g, cyl(0.018, h, 10), M.darkSteel, x, y + h / 2, z);
  add(g, cyl(0.035, 0.04, 12), M.darkSteel, x, y + 0.02, z);
  const arm = add(g, cyl(0.01, 0.16, 8), M.darkSteel, x - 0.07, y + h - 0.02, z);
  arm.rotation.z = Math.PI / 2;
  add(g, new THREE.ConeGeometry(0.06, 0.05, 14, 1, true), M.darkSteel, x - 0.14, y + h - 0.02, z);
  add(g, new THREE.SphereGeometry(0.03, 12, 8), M.lampGlow, x - 0.14, y + h - 0.05, z);
}

function bin(g, x, y, z) {
  add(g, cyl(0.045, 0.13, 14), M.bin, x, y + 0.065, z);
  add(g, cyl(0.05, 0.015, 14), M.darkSteel, x, y + 0.135, z);
}

function planter(g, x, y, z, i = 0) {
  add(g, rbox(0.16, 0.12, 0.34, 0.02), M.pot, x, y + 0.06, z);
  add(g, rbox(0.13, 0.04, 0.3, 0.02), M.leaf, x, y + 0.13, z);
  for (let k = 0; k < 5; k++) {
    add(g, new THREE.SphereGeometry(0.022, 8, 6), M.flowers[(i + k) % M.flowers.length], x + ((k * 37) % 7 - 3) * 0.012, y + 0.16, z - 0.12 + k * 0.06);
  }
}

function vending(g, x, y, z) {
  add(g, rbox(0.15, 0.32, 0.2, 0.015), M.vend, x, y + 0.16, z);
  add(g, rbox(0.01, 0.18, 0.15, 0.004), M.vendFront, x - 0.075, y + 0.21, z);
  add(g, rbox(0.012, 0.03, 0.09, 0.004), M.darkSteel, x - 0.075, y + 0.06, z);
}

// A round clock face on both sides, hands set to a cheerful 10:10.
function clock(g, x, y, z, r = 0.12, axis = 'x') {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  if (axis === 'z') c.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(cyl(r, 0.04, 28), M.darkSteel);
  rim.rotation.z = Math.PI / 2;
  c.add(rim);
  for (const s of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 28), M.clockFace);
    face.position.x = s * 0.021;
    face.rotation.y = s * Math.PI / 2;
    c.add(face);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, h % 3 ? 0.012 : 0.022, 0.006), M.darkSteel);
      tick.position.set(s * 0.024, Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      tick.rotation.x = -a;
      c.add(tick);
    }
    for (const [len, a] of [[0.5, -Math.PI / 3], [0.72, Math.PI / 3.6]]) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.004, r * len, 0.01), M.darkSteel);
      hand.geometry.translate(0, (r * len) / 2, 0);
      hand.position.x = s * 0.026;
      hand.rotation.x = a * s;
      c.add(hand);
    }
  }
  g.add(c);
  return c;
}

// The station's name painted on a board.
function nameTexture(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  c.fillRect(0, 0, 512, 128);
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fillRect(0, 96, 512, 32);
  c.font = '800 66px "Noto Sans TC", "PingFang TC", system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#fff';
  c.fillText(name, 256, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function nameBoard(g, name, color, x, y, z, w = 0.6, onPosts = true) {
  const tex = nameTexture(name, color);
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  // Box faces are +x, -x, +y, -y, +z, -z: the name reads from both sides.
  const board = add(g, new THREE.BoxGeometry(0.03, w / 4, w), [face, face, M.white, M.white, M.white, M.white], x, y, z);
  board.userData.own = [face, tex];
  if (onPosts) {
    for (const dz of [-w * 0.4, w * 0.4]) add(g, cyl(0.014, y, 8), M.darkSteel, x, y / 2, z + dz);
  }
  return board;
}

// A pitched roof prism along z.
function pitchedRoof(w, h, len) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  return geo;
}

// A wall window: glass with a white frame and sill. `nx` is the outward
// direction of the wall (+1 / -1 along x).
function windowAt(g, x, y, z, w, h, nx = -1, arched = false) {
  const o = nx * 0.012;
  add(g, rbox(0.03, h + 0.04, w + 0.04, 0.008), M.frame, x, y, z);
  add(g, new THREE.BoxGeometry(0.02, h, w), M.window, x + o, y, z);
  add(g, new THREE.BoxGeometry(0.035, h, 0.012), M.frame, x + o * 1.5, y, z);
  add(g, new THREE.BoxGeometry(0.035, 0.012, w), M.frame, x + o * 1.5, y + h * 0.1, z);
  add(g, rbox(0.06, 0.02, w + 0.08, 0.006), M.stone, x + nx * 0.02, y - h / 2 - 0.02, z);
  if (arched) {
    const arch = add(g, new THREE.CylinderGeometry(w / 2 + 0.02, w / 2 + 0.02, 0.03, 20, 1, false, 0, Math.PI), M.frame, x, y + h / 2, z);
    arch.rotation.set(0, 0, Math.PI / 2);
    const glass = add(g, new THREE.CylinderGeometry(w / 2, w / 2, 0.02, 20, 1, false, 0, Math.PI), M.window, x + o, y + h / 2, z);
    glass.rotation.set(0, 0, Math.PI / 2);
  }
}

// ---------- Platform shared by every style ----------

function platform(g, s) {
  const { len: L, width: W, px } = s;
  add(g, rbox(W, PLATFORM_Y - 0.03, L, 0.04), M.slab, px, (PLATFORM_Y - 0.03) / 2, 0);
  add(g, rbox(W - 0.06, 0.03, L - 0.06, 0.012), M.paving, px + 0.03, PLATFORM_Y - 0.015, 0);
  // Overhanging coping on the track side, then the yellow tactile strip and a white line.
  add(g, rbox(0.12, 0.035, L, 0.012), M.coping, RAIL_EDGE + 0.05, PLATFORM_Y - 0.012, 0);
  add(g, new THREE.BoxGeometry(0.07, 0.006, L - 0.12), M.tactile, RAIL_EDGE + 0.17, PLATFORM_Y + 0.002, 0);
  add(g, new THREE.BoxGeometry(0.012, 0.004, L - 0.12), M.line, RAIL_EDGE + 0.23, PLATFORM_Y + 0.001, 0);
  // Joints in the paving.
  for (let z = -L / 2 + 1; z < L / 2 - 0.5; z += 1) add(g, new THREE.BoxGeometry(W - 0.32, 0.003, 0.012), M.slab, px + 0.15, PLATFORM_Y + 0.001, z);
  // Two-level steps at the back.
  for (const z of s.ramps) {
    add(g, rbox(STEP_W, STEP_H, 0.55, 0.02), M.step, s.stepX, STEP_H / 2, z);
    add(g, rbox(0.02, 0.012, 0.55, 0.004), M.tactile, s.stepX - STEP_W / 2 + 0.02, STEP_H + 0.002, z);
  }
}

// ---------- Styles ----------

function buildHalt(g, s, color, name) {
  const { px, back } = s;
  const y = PLATFORM_Y;
  // Glass shelter with a curved roof.
  const sx = back - 0.2;
  for (const dz of [-0.7, 0.7]) add(g, cyl(0.02, 0.62, 10), M.darkSteel, sx, y + 0.31, dz);
  add(g, new THREE.BoxGeometry(0.012, 0.5, 1.36), M.shelterGlass, sx + 0.02, y + 0.33, 0);
  for (const dz of [-0.7, 0.7]) add(g, new THREE.BoxGeometry(0.4, 0.5, 0.012), M.shelterGlass, sx - 0.2, y + 0.33, dz);
  const roofMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide });
  const roof = add(g, new THREE.CylinderGeometry(0.9, 0.9, 1.56, 24, 1, true, Math.PI - 0.32, 0.64), roofMat, sx - 0.18, y + 0.68 - 0.9, 0);
  roof.rotation.x = Math.PI / 2;
  roof.userData.own = [roofMat];
  bench(g, sx - 0.12, y, 0);
  bench(g, back - 0.15, y, 2.2);
  bench(g, back - 0.15, y, -2.6);
  lamp(g, back - 0.08, y, -1.4);
  lamp(g, back - 0.08, y, 3.3);
  bin(g, back - 0.12, y, 1.3);
  planter(g, back - 0.12, y, -3.4, 1);
  nameBoard(g, name, color, back - 0.1, y + 0.62, 1.55, 0.56);
  return { blocks: [] };
}

function buildTown(g, s, color, name) {
  const { len: L, px, back } = s;
  const y = PLATFORM_Y;
  // Columns along the back with a cantilevered canopy over the platform.
  const colX = back - 0.14;
  const canopyLen = L - 1.2;
  for (let z = -canopyLen / 2 + 0.5; z <= canopyLen / 2 - 0.5 + 1e-6; z += (canopyLen - 1) / 5) {
    add(g, cyl(0.03, 0.86, 12), M.white, colX, y + 0.43, z);
    add(g, rbox(0.08, 0.04, 0.08, 0.01), M.white, colX, y + 0.02, z);
    const brace = add(g, new THREE.BoxGeometry(0.62, 0.035, 0.03), M.white, colX - 0.3, y + 0.8, z);
    brace.rotation.z = -0.1;
  }
  // Butterfly roof: two panels sloping in to a central gutter, coloured on top.
  const cw = s.width + 0.12;
  for (const k of [-1, 1]) {
    const panel = add(g, rbox(cw / 2 + 0.02, 0.035, canopyLen, 0.012), M.coping, px - 0.05 + (k * cw) / 4, y + 0.9 + 0.025, 0);
    panel.rotation.z = -k * 0.1;
    const top = add(g, rbox(cw / 2, 0.012, canopyLen - 0.04, 0.006), tint(color, 0.55), px - 0.05 + (k * cw) / 4, y + 0.9 + 0.05, 0);
    top.rotation.z = -k * 0.1;
  }
  add(g, rbox(0.06, 0.03, canopyLen, 0.01), M.darkSteel, px - 0.05, y + 0.9, 0);
  for (const k of [-1, 1]) add(g, rbox(0.04, 0.07, canopyLen + 0.02, 0.012), M.white, px - 0.05 + (k * cw) / 2, y + 0.98, 0);
  // Lights under the canopy.
  for (let z = -canopyLen / 2 + 1; z < canopyLen / 2; z += 2) add(g, rbox(0.06, 0.015, 0.4, 0.006), M.lampGlow, px - 0.1, y + 0.85, z);
  // Hanging clock and name boards.
  add(g, cyl(0.008, 0.12, 6), M.darkSteel, px - 0.15, y + 0.79, 0);
  clock(g, px - 0.15, y + 0.62, 0, 0.1);
  nameBoard(g, name, color, px + 0.05, y + 0.74, -2.4, 0.7, false).position.y = y + 0.76;
  add(g, cyl(0.008, 0.1, 6), M.darkSteel, px + 0.05, y + 0.85, -2.65);
  add(g, cyl(0.008, 0.1, 6), M.darkSteel, px + 0.05, y + 0.85, -2.15);
  nameBoard(g, name, color, px + 0.05, y + 0.74, 2.4, 0.7, false).position.y = y + 0.76;
  add(g, cyl(0.008, 0.1, 6), M.darkSteel, px + 0.05, y + 0.85, 2.15);
  add(g, cyl(0.008, 0.1, 6), M.darkSteel, px + 0.05, y + 0.85, 2.65);
  for (const z of [-4.6, -1.2, 1.2, 4.6]) bench(g, back - 0.2, y, z);
  vending(g, back - 0.15, y, 3.1);
  bin(g, back - 0.14, y, -3.2);
  bin(g, back - 0.14, y, 2.1);
  planter(g, back - 0.14, y, -5.5, 0);
  planter(g, back - 0.14, y, 5.5, 2);

  // The station house behind the platform, between the two sets of steps.
  const hx0 = back + 0.04;
  const D = 1.5;
  const hx = hx0 + D / 2;
  const hl = 3.4;
  add(g, rbox(D + 0.08, 0.08, hl + 0.08, 0.02), M.stone, hx, 0.04, 0);
  add(g, rbox(D, 0.95, hl, 0.03), M.cream, hx, 0.5, 0);
  add(g, rbox(D + 0.04, 0.12, hl + 0.04, 0.02), M.brick, hx, 0.08, 0);
  const roof = add(g, pitchedRoof(D + 0.36, 0.5, hl + 0.3), tint(color, 0.55), hx, 0.97, 0);
  add(g, rbox(0.06, 0.05, hl + 0.34, 0.02), M.white, hx, 1.46, 0);
  add(g, rbox(0.18, 0.4, 0.18, 0.02), M.brick, hx + 0.3, 1.45, -1.0);
  // Windows on the platform side and the outside.
  for (const z of [-1.15, 1.15]) {
    windowAt(g, hx0 - 0.005, 0.56, z, 0.42, 0.36, -1);
    windowAt(g, hx0 + D + 0.005, 0.56, z, 0.42, 0.36, 1);
  }
  // Doors.
  add(g, rbox(0.03, 0.56, 0.42, 0.01), M.door, hx0 - 0.005, 0.36, 0);
  add(g, new THREE.BoxGeometry(0.02, 0.26, 0.3), M.window, hx0 - 0.02, 0.45, 0);
  add(g, rbox(0.03, 0.56, 0.42, 0.01), M.door, hx0 + D + 0.005, 0.36, 0);
  add(g, rbox(0.2, 0.025, 0.6, 0.01), tint(color, 0.45), hx0 + D + 0.1, 0.7, 0);
  lamp(g, hx0 + D + 0.25, 0, 0.55, 0.75);
  nameBoard(g, name, color, hx0 + D + 0.02, 0.86, 0, 0.9, false);
  roof.castShadow = true;
  return { blocks: [{ x0: hx0, x1: hx0 + D, z0: -hl / 2, z1: hl / 2, top: 1.5 }] };
}

function buildGrand(g, s, color, name) {
  const { len: L, px, back, width: W } = s;
  const y = PLATFORM_Y;
  // Arched train shed over platform and track: iron ribs and glass.
  const x0 = -0.62;
  const x1 = back - 0.06;
  const cx = (x0 + x1) / 2;
  const R = (x1 - x0) / 2;
  const springY = y + 0.95;
  const shedLen = L - 0.6;
  const ribs = 9;
  const iron = tint(0x445466, 0.4);
  for (let i = 0; i < ribs; i++) {
    const z = -shedLen / 2 + (i * shedLen) / (ribs - 1);
    const rib = add(g, new THREE.TorusGeometry(R, 0.025, 8, 32, Math.PI), iron, cx, springY, z);
    rib.rotation.z = 0;
    add(g, cyl(0.035, springY, 12), iron, x0, springY / 2, z);
    add(g, cyl(0.035, springY - y, 12), iron, x1, y + (springY - y) / 2, z);
    add(g, rbox(0.09, 0.06, 0.09, 0.01), iron, x0, 0.03, z);
  }
  const glass = add(g, new THREE.CylinderGeometry(R - 0.005, R - 0.005, shedLen, 40, 20, true, Math.PI / 2, Math.PI), M.shedGlass, cx, springY, 0);
  glass.rotation.x = Math.PI / 2;
  glass.rotation.y = 0;
  glass.renderOrder = 2;
  // Ridge lantern and purlins along the shed.
  for (const a of [0.35, 0.8, 1.2, Math.PI / 2, Math.PI - 1.2, Math.PI - 0.8, Math.PI - 0.35]) {
    add(g, new THREE.BoxGeometry(0.025, 0.025, shedLen), iron, cx + Math.cos(a) * R, springY + Math.sin(a) * R, 0);
  }
  add(g, rbox(0.3, 0.12, shedLen * 0.7, 0.03), tint(color, 0.5), cx, springY + R + 0.05, 0);
  // Eaves beams.
  add(g, new THREE.BoxGeometry(0.06, 0.08, shedLen), iron, x0, springY, 0);
  add(g, new THREE.BoxGeometry(0.06, 0.08, shedLen), iron, x1, springY, 0);
  // Gable fan windows at each end.
  for (const zEnd of [-shedLen / 2, shedLen / 2]) {
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      const spoke = add(g, new THREE.BoxGeometry(0.018, R, 0.018), iron, cx + (Math.cos(a) * R) / 2, springY + (Math.sin(a) * R) / 2, zEnd);
      spoke.rotation.z = a - Math.PI / 2;
    }
  }
  // Hanging lamps, a departures board and a big clock.
  for (let z = -shedLen / 2 + 1.2; z < shedLen / 2 - 0.5; z += 2.4) {
    add(g, cyl(0.006, 0.5, 6), M.darkSteel, px - 0.15, springY + 0.25, z);
    add(g, new THREE.ConeGeometry(0.08, 0.06, 16, 1, true), M.darkSteel, px - 0.15, springY - 0.02, z);
    add(g, new THREE.SphereGeometry(0.035, 12, 8), M.lampGlow, px - 0.15, springY - 0.05, z);
  }
  const bx = px + 0.1;
  add(g, rbox(0.06, 0.26, 1.1, 0.02), M.board, bx, y + 0.95, 1.9);
  for (let r = 0; r < 4; r++) add(g, new THREE.BoxGeometry(0.01, 0.025, 0.9 - (r % 2) * 0.2), M.amber, bx - 0.032, y + 1.04 - r * 0.055, 1.9 - (r % 2) * 0.1);
  for (const dz of [-0.45, 0.45]) add(g, cyl(0.006, springY - y - 1.08 + 0.3, 6), M.darkSteel, bx, y + 1.08 + (springY - y - 1.08 + 0.3) / 2, 1.9 + dz);
  add(g, cyl(0.008, 0.25, 6), M.darkSteel, px - 0.05, springY - 0.05, -1.9);
  clock(g, px - 0.05, springY - 0.3, -1.9, 0.14);
  for (const z of [-7.2, -3.4, -1.1, 1.1, 3.4, 7.2]) bench(g, back - 0.22, y, z);
  for (const z of [-5.4, 5.4]) nameBoard(g, name, color, px + 0.15, y + 0.66, z, 0.8);
  vending(g, back - 0.15, y, 2.4);
  vending(g, back - 0.15, y, -2.4);
  for (const z of [-7.6, 0, 7.6]) bin(g, back - 0.14, y, z);
  planter(g, px + 0.2, y, -0.4, 0);
  planter(g, px + 0.2, y, 0.4, 3);

  // The station hall with a clock tower, between the inner steps.
  const hx0 = back + 0.04;
  const D = 2.1;
  const hx = hx0 + D / 2;
  const hl = 7.6;
  add(g, rbox(D + 0.12, 0.1, hl + 0.12, 0.02), M.stone, hx, 0.05, 0);
  add(g, rbox(D, 1.25, hl, 0.03), M.brick, hx, 0.66, 0);
  add(g, rbox(D + 0.06, 0.1, hl + 0.06, 0.02), M.stone, hx, 1.3, 0); // cornice
  add(g, rbox(D + 0.04, 0.14, hl + 0.04, 0.02), M.stone, hx, 0.17, 0);
  for (const z of [-hl / 2, -1.25, 1.25, hl / 2]) {
    add(g, rbox(D + 0.06, 1.2, 0.14, 0.02), M.stone, hx, 0.66, z);
  }
  const roof = add(g, pitchedRoof(D + 0.24, 0.45, hl + 0.2), tint(0x55606e, 0.55), hx, 1.35, 0);
  roof.castShadow = true;
  for (const nx of [-1, 1]) {
    const wx = nx < 0 ? hx0 - 0.005 : hx0 + D + 0.005;
    for (const z of [-3.0, -2.0, 2.0, 3.0]) windowAt(g, wx, 0.66, z, 0.36, 0.5, nx, true);
    // Grand arched doorway in the middle.
    add(g, rbox(0.04, 0.72, 0.8, 0.01), M.door, wx, 0.46, 0);
    add(g, new THREE.BoxGeometry(0.02, 0.6, 0.66), M.window, wx + nx * 0.015, 0.47, 0);
    add(g, new THREE.BoxGeometry(0.03, 0.62, 0.025), M.door, wx + nx * 0.025, 0.47, 0);
    const arch = add(g, new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24, 1, false, 0, Math.PI), M.stone, wx, 0.82, 0);
    arch.rotation.z = Math.PI / 2;
    const fan = add(g, new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24, 1, false, 0, Math.PI), M.window, wx + nx * 0.015, 0.82, 0);
    fan.rotation.z = Math.PI / 2;
  }
  // Clock tower.
  const tw = 0.8;
  add(g, rbox(tw, 1.4, tw, 0.03), M.brick, hx, 1.35 + 0.7, 0);
  add(g, rbox(tw + 0.08, 0.08, tw + 0.08, 0.02), M.stone, hx, 2.08, 0);
  add(g, rbox(tw + 0.1, 0.1, tw + 0.1, 0.02), M.stone, hx, 2.75, 0);
  clock(g, hx - tw / 2 - 0.02, 2.4, 0, 0.27);
  clock(g, hx + tw / 2 + 0.02, 2.4, 0, 0.27);
  clock(g, hx, 2.4, tw / 2 + 0.02, 0.27, 'z');
  clock(g, hx, 2.4, -tw / 2 - 0.02, 0.27, 'z');
  const spire = add(g, new THREE.ConeGeometry(tw * 0.72, 0.8, 4), tint(color, 0.5), hx, 3.2, 0);
  spire.rotation.y = Math.PI / 4;
  add(g, cyl(0.012, 0.3, 6), M.darkSteel, hx, 3.7, 0);
  add(g, new THREE.SphereGeometry(0.04, 12, 8), tint(0xf2c14e, 0.3), hx, 3.86, 0);
  nameBoard(g, name, color, hx0 + D + 0.03, 1.05, 0, 1.6, false);
  nameBoard(g, name, color, hx0 - 0.03, 1.05, -2.5, 1.0, false);
  for (const z of [-1.6, 1.6]) lamp(g, hx0 + D + 0.3, 0, z, 0.85);
  return { blocks: [{ x0: hx0, x1: hx0 + D, z0: -hl / 2, z1: hl / 2, top: 1.6 }] };
}

const BUILDERS = { halt: buildHalt, town: buildTown, grand: buildGrand };

// The station model for `style`, with the solid blocks walkers go around.
export function makeStationModel(style, color, name) {
  const g = new THREE.Group();
  platform(g, style);
  const { blocks } = BUILDERS[style.key](g, style, color, name);
  g.traverse((o) => {
    if (o.isMesh) {
      const glassy = o.material === M.shedGlass || o.material === M.shelterGlass;
      o.castShadow = !glassy;
      o.receiveShadow = true;
    }
  });
  return { group: g, blocks };
}

// Materials and textures that belong to one station (its name boards).
export function disposeStationModel(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const x of o.userData.own ?? []) x.dispose();
  });
}

// Shared materials can't be tinted per station; highlighting swaps in a
// tinted copy and back.
export function highlightStation(group, color) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (color == null) {
      if (o.userData.base) {
        o.material = o.userData.base;
        o.userData.base = null;
      }
      return;
    }
    if (!o.userData.base) o.userData.base = o.material;
    o.material = highlightMat(color);
  });
}
const hlMats = new Map();
function highlightMat(color) {
  if (!hlMats.has(color)) hlMats.set(color, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }));
  return hlMats.get(color);
}
