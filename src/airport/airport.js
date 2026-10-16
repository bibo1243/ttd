import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glassMat } from '../parts.js';
import { Robot } from '../robots.js';
import { glowTexture } from './planes.js';

// The airport is one prefab laid out in its own frame: runway along x (take
// off toward +x), taxiway parallel to it, three stands on the apron and the
// terminal behind them (+z). It sits on a slab of reclaimed land, so it can
// be built over the sea as well as on the island.

export const RW_Z = -7;
export const TW_Z = -3.4;
export const NOSE_Z = 4.9; // where parked noses stop, short of the terminal
export const STANDS = [-5.2, 0, 5.2];
export const TERM_Z = 5.3; // terminal glass front
const RW_X0 = -10.6;
const RW_X1 = 10.6;
const RW_W = 1.6;
export const FOOT = { x0: -12.4, x1: 12.4, z0: -9.2, z1: 9.6 }; // reclaimed slab
export const PAD = 0.02; // top of the slab
const Y = { apron: 0.028, taxi: 0.03, runway: 0.034, paint: 0.038 };

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const AM = {
  grass: mat(0x8fcf6e, { roughness: 0.95 }),
  wall: mat(0xd9cfbd, { roughness: 0.9 }),
  foam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
  apron: mat(0xbcc1c6, { roughness: 0.85 }),
  asphalt: mat(0x50555d, { roughness: 0.8 }),
  shoulder: mat(0x8d9399, { roughness: 0.9 }),
  yellow: mat(0xf2c230, { roughness: 0.6 }),
  white: mat(0xf7f7f2, { roughness: 0.5 }),
  cream: mat(0xf1ebde, { roughness: 0.7 }),
  roof: new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.35, clearcoat: 0.6, metalness: 0.1 }),
  wood: mat(0xd6a86c, { roughness: 0.7 }),
  steel: mat(0xaab2bc, { metalness: 0.8, roughness: 0.3 }),
  dark: mat(0x30343c, { roughness: 0.5 }),
  frame: mat(0x5b6470, { metalness: 0.6, roughness: 0.35 }),
  tile: mat(0xe9e4da, { roughness: 0.4 }),
  seat: mat(0x2f7fc4, { roughness: 0.7 }),
  counter: mat(0xf7f3ea, { roughness: 0.45 }),
  plant: mat(0x4f9e4a, { roughness: 0.8 }),
  pot: mat(0xc9774a, { roughness: 0.7 }),
  warm: new THREE.MeshBasicMaterial({ color: 0xfff0d2 }),
  orange: mat(0xf07a2a, { roughness: 0.6 }),
  tyre: mat(0x1f2126, { roughness: 0.8 }),
};

const shadow = (m, cast = true, receive = true) => {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
};
const rbox = (w, h, d, r, material) => shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), material));

// A flat strip along points `pts` (open), lying at height y.
function ribbon(pts, width, y, offset = 0) {
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    const a = offset - width / 2;
    const b = offset + width / 2;
    pos.set([p.x + side.x * a, y, p.z + side.z * a, p.x + side.x * b, y, p.z + side.z * b], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Smooth path through corner points, with long straights kept straight.
export function smoothPath(points) {
  const dense = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.8));
    for (let k = 0; k < steps; k++) dense.push(a.clone().lerp(b, k / steps));
  }
  dense.push(points[points.length - 1].clone());
  const curve = new THREE.CatmullRomCurve3(dense, false, 'centripetal', 0.5);
  curve.arcLengthDivisions = dense.length * 10;
  return curve;
}

// ---------- Ground routes, in the airport's frame ----------

export function pushbackPath(stand, centerZ) {
  const sx = STANDS[stand];
  return [V(sx, centerZ), V(sx, TW_Z + 1.7), V(sx + 0.45, TW_Z + 0.4), V(sx + 1.6, TW_Z)];
}

export function taxiOutPath(stand) {
  const sx = STANDS[stand];
  const r = (TW_Z - RW_Z) / 2;
  const cz = (TW_Z + RW_Z) / 2;
  const cx = RW_X0 + 1.2;
  const pts = [V(sx + 1.6, TW_Z), V(sx + 0.6, TW_Z), V(cx, TW_Z)];
  for (let k = 1; k <= 5; k++) {
    const a = Math.PI / 2 + (k / 6) * Math.PI;
    pts.push(V(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
  }
  pts.push(V(cx, RW_Z), V(cx + 0.8, RW_Z));
  return pts;
}

export const TAKEOFF_START = RW_X0 + 2.0;
export const TOUCHDOWN_X = RW_X0 + 4.2;
export const ROLLOUT_X = RW_X1 - 2.8;

export function taxiInPath(stand, centerZ) {
  const sx = STANDS[stand];
  const r = (TW_Z - RW_Z) / 2;
  const cz = (TW_Z + RW_Z) / 2;
  const cx = RW_X1 - 1.2;
  const pts = [V(ROLLOUT_X, RW_Z), V(cx, RW_Z)];
  for (let k = 1; k <= 5; k++) {
    const a = -Math.PI / 2 + (k / 6) * Math.PI;
    pts.push(V(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
  }
  pts.push(V(cx, TW_Z), V(sx + 1.8, TW_Z), V(sx + 0.55, TW_Z + 0.5), V(sx, TW_Z + 1.8), V(sx, centerZ));
  return pts;
}

// ---------- Textures ----------

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function runwayTexture(len) {
  return canvasTex(2048, 160, (g, W, H) => {
    const px = W / len; // pixels per metre
    g.fillStyle = '#4a4f57';
    g.fillRect(0, 0, W, H);
    // Grain and tyre marks.
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 4, 1 + Math.random() * 2);
    }
    for (const x0 of [4.2 * px, W - 4.2 * px]) {
      g.fillStyle = 'rgba(20,20,22,0.18)';
      g.fillRect(x0 - 2.2 * px, H * 0.32, 4.4 * px, H * 0.12);
      g.fillRect(x0 - 2.2 * px, H * 0.56, 4.4 * px, H * 0.12);
    }
    g.fillStyle = '#f4f4ef';
    g.fillRect(0, 6, W, 4);
    g.fillRect(0, H - 10, W, 4);
    // Centre line.
    for (let x = 3.2 * px; x < W - 3.2 * px; x += 1.1 * px) g.fillRect(x, H / 2 - 2, 0.6 * px, 4);
    // Threshold piano keys, numbers, touchdown and aiming-point marks.
    const ends = [
      { x: 0.25 * px, dir: 1, label: '09' },
      { x: W - 0.25 * px, dir: -1, label: '27' },
    ];
    for (const e of ends) {
      for (let k = 0; k < 8; k++) {
        const y = 18 + k * ((H - 36) / 8);
        g.fillRect(e.dir > 0 ? e.x : e.x - 1.1 * px, y + 2, 1.1 * px, (H - 36) / 8 - 6);
      }
      g.save();
      g.translate(e.x + e.dir * 2.0 * px, H / 2);
      g.rotate(e.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.font = 'bold 74px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.label, 0, 0);
      g.restore();
      for (const [d, w] of [[3.4, 0.5], [4.3, 0.5]]) {
        for (const yy of [0.22, 0.7]) g.fillRect(e.x + e.dir * d * px - (e.dir < 0 ? w * px : 0), H * yy, w * px, H * 0.08);
      }
      g.fillRect(e.x + e.dir * 5.4 * px - (e.dir < 0 ? 1.2 * px : 0), H * 0.2, 1.2 * px, H * 0.14);
      g.fillRect(e.x + e.dir * 5.4 * px - (e.dir < 0 ? 1.2 * px : 0), H * 0.66, 1.2 * px, H * 0.14);
    }
  });
}

function apronTexture() {
  const t = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#c3c7cb';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    g.strokeStyle = 'rgba(90,96,104,0.35)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, H - 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textTexture(text, { w = 512, h = 128, bg = null, color = '#ffffff', font = 'bold 72px sans-serif' } = {}) {
  return canvasTex(w, h, (g, W, H) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = color;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 4);
  });
}

// ---------- Lights ----------

// Many small lamps: instanced fittings plus one additive glow sprite each.
class LightField {
  constructor() {
    this.items = [];
  }

  add(x, z, color, y = 0.07) {
    this.items.push({ p: V(x, z, y), color: new THREE.Color(color) });
    return this.items.length - 1;
  }

  build(parent, size = 0.42) {
    const n = this.items.length;
    const fitting = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.026, 0.05, 8), AM.dark, n);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 });
    const cap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), capMat, n);
    const m = new THREE.Matrix4();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.items.forEach((it, i) => {
      m.makeTranslation(it.p.x, it.p.y - 0.045, it.p.z);
      fitting.setMatrixAt(i, m);
      m.makeTranslation(it.p.x, it.p.y - 0.012, it.p.z);
      cap.setMatrixAt(i, m);
      cap.setColorAt(i, it.color);
      pos.set([it.p.x, it.p.y + 0.03, it.p.z], i * 3);
      col.set([it.color.r, it.color.g, it.color.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.base = col.slice();
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    );
    points.renderOrder = 7;
    this.points = points;
    parent.add(fitting, cap, points);
  }

  // Brightness per lamp, 0..1.
  setLevel(i, k) {
    const col = this.points.geometry.attributes.color;
    col.setXYZ(i, this.base[i * 3] * k, this.base[i * 3 + 1] * k, this.base[i * 3 + 2] * k);
    col.needsUpdate = true;
  }
}

// ---------- Pieces ----------

function slab(group) {
  const { x0, x1, z0, z1 } = FOOT;
  const r = 2.2;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, z0);
  shape.lineTo(x1 - r, z0);
  shape.quadraticCurveTo(x1, z0, x1, z0 + r);
  shape.lineTo(x1, z1 - r);
  shape.quadraticCurveTo(x1, z1, x1 - r, z1);
  shape.lineTo(x0 + r, z1);
  shape.quadraticCurveTo(x0, z1, x0, z1 - r);
  shape.lineTo(x0, z0 + r);
  shape.quadraticCurveTo(x0, z0, x0 + r, z0);
  const depth = 1.62;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.15, bevelSegments: 3, curveSegments: 10 });
  geo.rotateX(Math.PI / 2); // shape y -> world z, extruded downward
  geo.translate(0, PAD - 0.15, 0);
  const m = new THREE.Mesh(geo, [AM.grass, AM.wall]);
  m.receiveShadow = true;
  group.add(m);
  // Surf where the seawall meets the water.
  const outer = new THREE.Shape(shape.getPoints(12).map((p) => new THREE.Vector2(p.x * 1.025, p.y * 1.03)));
  outer.holes.push(new THREE.Path(shape.getPoints(12).map((p) => new THREE.Vector2(p.x * 1.004, p.y * 1.004))));
  const foam = new THREE.Mesh(new THREE.ShapeGeometry(outer, 12), AM.foam);
  foam.rotation.x = Math.PI / 2;
  foam.position.y = -1.37;
  group.add(foam);
}

function pavement(group, lights) {
  // Runway with shoulders and markings.
  const len = RW_X1 - RW_X0;
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.6, RW_W + 0.7), AM.shoulder);
  sh.rotation.x = -Math.PI / 2;
  sh.position.set(0, Y.apron - 0.002, RW_Z);
  sh.receiveShadow = true;
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(len, RW_W), mat(0xffffff, { map: runwayTexture(len), roughness: 0.8 }));
  rw.rotation.x = -Math.PI / 2;
  rw.position.set(0, Y.runway, RW_Z);
  rw.receiveShadow = true;
  group.add(sh, rw);

  // Apron.
  const at = apronTexture();
  const aw = 17.2;
  const ad = TERM_Z - (TW_Z + 0.5);
  at.repeat.set(aw / 1.6, ad / 1.6);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(aw, ad), mat(0xffffff, { map: at, roughness: 0.85 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, Y.apron, (TERM_Z + TW_Z + 0.5) / 2);
  apron.receiveShadow = true;
  group.add(apron);

  // Taxiways: every route the planes drive, paved and lined.
  const routes = [];
  STANDS.forEach((_, i) => {
    routes.push(smoothPath(pushbackPath(i, 1.6)), smoothPath(taxiOutPath(i)), smoothPath(taxiInPath(i, 1.6)));
  });
  const yellowLines = [];
  const pave = (curve, width, line = true) => {
    const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.2));
    const m = new THREE.Mesh(ribbon(pts, width, Y.taxi), AM.asphalt);
    m.receiveShadow = true;
    group.add(m);
    if (line) yellowLines.push(pts);
    return pts;
  };
  // Main taxiway and the two runway turn pads.
  const main = pave(smoothPath([V(RW_X0 + 1.2, TW_Z), V(RW_X1 - 1.2, TW_Z)]), 0.95);
  const outPad = pave(smoothPath(taxiOutPath(0).slice(2)), 1.0);
  const inPad = pave(smoothPath(taxiInPath(0, 1.6).slice(0, 8)), 1.0);
  for (let i = 0; i < STANDS.length; i++) {
    const lead = smoothPath(taxiInPath(i, 1.6).slice(-4));
    const pts = lead.getSpacedPoints(40);
    yellowLines.push(pts);
    const push = smoothPath(pushbackPath(i, 1.6));
    yellowLines.push(push.getSpacedPoints(30));
  }
  for (const pts of yellowLines) group.add(new THREE.Mesh(ribbon(pts, 0.05, Y.paint), AM.yellow));

  // Blue edge lights along taxiways, white/green/red on the runway.
  const edge = (pts, w, every) => {
    for (let i = 0; i < pts.length; i += every) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const p0 = pts[Math.max(0, i - 1)];
      const t = new THREE.Vector3().subVectors(q, p0).normalize();
      const s = new THREE.Vector3().crossVectors(t, UP).normalize();
      for (const k of [-1, 1]) {
        const x = p.x + s.x * k * (w / 2 + 0.08);
        const z = p.z + s.z * k * (w / 2 + 0.08);
        if (z > TW_Z + 0.6 && z < TERM_Z) continue; // not on the apron
        lights.add(x, z, 0x3b7bff);
      }
    }
  };
  edge(main, 0.95, 6);
  edge(outPad, 1.0, 5);
  edge(inPad, 1.0, 5);
  for (let x = RW_X0 + 0.4; x <= RW_X1 - 0.3; x += 1.3) {
    for (const k of [-1, 1]) lights.add(x, RW_Z + k * (RW_W / 2 + 0.12), 0xfff4d6);
  }
  for (let k = -3; k <= 3; k++) {
    lights.add(RW_X0 - 0.12, RW_Z + k * 0.24, 0x39ff7a);
    lights.add(RW_X1 + 0.12, RW_Z + k * 0.24, 0xff3b30);
  }

  // Stand numbers and stop bars.
  STANDS.forEach((sx, i) => {
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.45),
      new THREE.MeshStandardMaterial({ map: textTexture(`${i + 1}`, { w: 128, h: 64, color: '#f2c230', font: 'bold 56px sans-serif' }), transparent: true, roughness: 0.6 }),
    );
    num.rotation.x = -Math.PI / 2;
    num.position.set(sx - 0.8, Y.paint, NOSE_Z - 0.35);
    group.add(num);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07), AM.yellow);
    bar.rotation.x = -Math.PI / 2;
    bar.position.set(sx, Y.paint, NOSE_Z - 0.2);
    group.add(bar);
  });
}

// Lights that run out over the water before the runway, flashing in
// sequence toward the threshold.
function approachLights(group) {
  const field = new LightField();
  const posts = [];
  for (let k = 1; k <= 7; k++) {
    const x = RW_X0 - k * 0.9;
    const outside = x < FOOT.x0 - 0.1;
    const h = outside ? 1.48 : 0.0;
    if (outside) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, h + 0.02, 8), AM.steel));
      post.position.set(x, PAD - h / 2, RW_Z);
      group.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.9), AM.dark);
    bar.position.set(x, PAD + 0.05, RW_Z);
    group.add(bar);
    for (const dz of [-0.36, -0.12, 0.12, 0.36]) field.add(x, RW_Z + dz, 0xffffff, PAD + 0.1);
    posts.push(k);
  }
  field.build(group, 0.5);
  return field;
}

function papi(group) {
  const g = new THREE.Group();
  const units = [];
  for (let i = 0; i < 4; i++) {
    const box = rbox(0.18, 0.12, 0.14, 0.03, AM.white);
    box.position.set(0, 0.06, i * 0.26);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 16),
      new THREE.MeshStandardMaterial({ color: i < 2 ? 0xff3b30 : 0xffffff, emissive: i < 2 ? 0xff3b30 : 0xffffff, emissiveIntensity: 2 }),
    );
    lens.position.set(-0.091, 0.07, i * 0.26);
    lens.rotation.y = -Math.PI / 2;
    g.add(box, lens);
    units.push(lens);
  }
  g.position.set(TOUCHDOWN_X + 0.3, Y.apron, RW_Z + RW_W / 2 + 0.6);
  group.add(g);
}

function windsock(group) {
  const g = new THREE.Group();
  const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.1, 8), AM.white));
  pole.position.y = 0.55;
  g.add(pole);
  const sock = new THREE.Group();
  sock.position.y = 1.08;
  for (let i = 0; i < 5; i++) {
    const r0 = 0.12 - i * 0.017;
    const seg = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.017, r0, 0.16, 16, 1, true), i % 2 ? AM.white : AM.orange));
    seg.material = seg.material.clone();
    seg.material.side = THREE.DoubleSide;
    seg.rotation.z = Math.PI / 2;
    seg.position.x = 0.08 + i * 0.16;
    sock.add(seg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.008, 6, 20), AM.steel);
  ring.rotation.y = Math.PI / 2;
  sock.add(ring);
  g.add(sock);
  g.position.set(RW_X0 + 1.4, PAD, RW_Z - RW_W / 2 - 1.1);
  group.add(g);
  return sock;
}

// ---------- Terminal ----------

function terminal(group) {
  const g = new THREE.Group();
  const x0 = -8.2;
  const x1 = 7.6;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const z0 = TERM_Z;
  const z1 = TERM_Z + 3.1;
  const H = 1.35;
  const floor = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, z1 - z0), AM.tile));
  floor.position.set(cx, 0.04, (z0 + z1) / 2);
  g.add(floor);
  // Back and side walls.
  const back = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.12), AM.cream));
  back.position.set(cx, H / 2, z1 - 0.06);
  g.add(back);
  for (const x of [x0 + 0.06, x1 - 0.06]) {
    const side = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.12, H, z1 - z0), AM.cream));
    side.position.set(x, H / 2, (z0 + z1) / 2);
    g.add(side);
  }
  // Glass front with mullions and a transom; doors at each gate.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, H - 0.08), glassMat);
  glass.position.set(cx, H / 2 + 0.04, z0);
  glass.renderOrder = 2;
  g.add(glass);
  for (let x = x0 + 0.06; x <= x1 + 0.01; x += w / 22) {
    const mul = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.035, H, 0.05), AM.frame), true, false);
    mul.position.set(x, H / 2, z0);
    g.add(mul);
  }
  for (const y of [0.08, 0.95, H - 0.02]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.06), AM.frame);
    tr.position.set(cx, y, z0);
    g.add(tr);
  }
  STANDS.forEach((sx, i) => {
    const dx = sx + 1.5;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.07), AM.frame);
    frame.position.set(dx, 0.82, z0 + 0.01);
    g.add(frame);
    const tex = textTexture(`登機門 ${i + 1}`, { w: 256, h: 80, bg: '#203a5c', font: 'bold 44px sans-serif' });
    const gate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.18),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }),
    );
    gate.position.set(dx, 1.08, z0 - 0.04);
    gate.rotation.y = Math.PI;
    g.add(gate);
  });

  // Wave roof with a warm wooden soffit.
  const prof = new THREE.Shape();
  const pz = [[-0.75, 1.42], [0.6, 1.62], [1.7, 1.72], [2.7, 1.62], [3.4, 1.48]];
  prof.moveTo(pz[0][0], pz[0][1]);
  for (let i = 1; i < pz.length; i++) prof.lineTo(pz[i][0], pz[i][1]);
  for (let i = pz.length - 1; i >= 0; i--) prof.lineTo(pz[i][0], pz[i][1] - (i === 0 || i === pz.length - 1 ? 0.06 : 0.12));
  const roofGeo = new THREE.ExtrudeGeometry(prof, { depth: w + 0.8, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, steps: 1, curveSegments: 1 });
  roofGeo.rotateY(-Math.PI / 2); // profile across z, run along -x
  const roof = shadow(new THREE.Mesh(roofGeo, AM.roof));
  roof.position.set(x1 + 0.4, 0, z0);
  g.add(roof);
  const soffit = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.03, z1 - z0 - 0.2), AM.wood);
  soffit.position.set(cx, H, (z0 + z1) / 2);
  g.add(soffit);
  for (let x = x0 + 0.8; x < x1 - 0.4; x += 1.6) {
    for (const z of [z0 + 0.8, z0 + 2.0]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.22), AM.warm);
      panel.position.set(x, H - 0.022, z);
      g.add(panel);
    }
  }
  // Columns under the roof overhang.
  for (let x = x0 + 0.5; x < x1; x += 3.15) {
    const col = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.45, 10), AM.white));
    col.position.set(x, 0.72, z0 - 0.55);
    g.add(col);
  }
  // Sign on the roof edge.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 0.42),
    new THREE.MeshStandardMaterial({ map: textTexture('迷你國際機場  MINI AIRPORT', { w: 1024, h: 104, color: '#1f4f9a', font: 'bold 64px sans-serif' }), transparent: true }),
  );
  sign.position.set(cx, 1.62, z0 - 0.62);
  sign.rotation.y = Math.PI;
  sign.rotation.x = 0.12;
  g.add(sign);

  // Inside: check-in counters, rows of seats, plants and warm lamps.
  for (let x = x0 + 1.2; x < x1 - 1; x += 2.2) {
    const c = rbox(1.2, 0.3, 0.32, 0.05, AM.counter);
    c.position.set(x, 0.23, z1 - 0.55);
    const top = rbox(1.22, 0.04, 0.34, 0.015, AM.seat);
    top.position.set(x, 0.39, z1 - 0.55);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), new THREE.MeshStandardMaterial({ color: 0x15304d, emissive: 0x3d8fe0, emissiveIntensity: 0.9 }));
    scr.position.set(x, 0.85, z1 - 0.13);
    scr.rotation.y = Math.PI;
    g.add(c, top, scr);
  }
  STANDS.forEach((sx) => {
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Group();
        const cushion = rbox(0.15, 0.04, 0.14, 0.015, AM.seat);
        cushion.position.y = 0.17;
        const back = rbox(0.15, 0.16, 0.035, 0.015, AM.seat);
        back.position.set(0, 0.27, 0.07);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.02), AM.steel);
        leg.position.y = 0.1;
        s.add(cushion, back, leg);
        s.position.set(sx - 1.4 + k * 0.2, 0, z0 + 1.35 + r * 0.42);
        g.add(s);
      }
    }
  });
  for (const x of [x0 + 0.5, cx, x1 - 0.5]) {
    const pot = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 14), AM.pot));
    pot.position.set(x, 0.16, z0 + 0.45);
    const leaves = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), AM.plant));
    leaves.position.set(x, 0.42, z0 + 0.45);
    leaves.scale.y = 1.3;
    g.add(pot, leaves);
  }
  const lamps = [];
  for (const x of [cx - 4, cx + 4]) {
    const l = new THREE.PointLight(0xffd29a, 2.2, 7, 1.6);
    l.position.set(x, 1.1, (z0 + z1) / 2);
    g.add(l);
    lamps.push(l);
  }

  // Departures board facing the apron.
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 224;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.7),
    new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0.8 }),
  );
  board.position.set(cx, 1.0, z0 + 0.9);
  board.rotation.y = Math.PI;
  const boardBack = rbox(1.7, 0.78, 0.05, 0.02, AM.dark);
  boardBack.position.set(cx, 1.0, z0 + 0.93);
  g.add(boardBack, board);

  group.add(g);
  return { canvas: boardCanvas, texture: boardTex, x0, x1, z0, z1, lamps };
}

function tower(group) {
  const g = new THREE.Group();
  const base = rbox(1.6, 0.5, 1.4, 0.06, AM.cream);
  base.position.y = 0.25;
  const shaft = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 2.6, 24), AM.white));
  shaft.position.y = 1.5;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 24), AM.dark);
  ring.position.y = 2.82;
  const floor = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.5, 0.22, 24), AM.white));
  floor.position.y = 2.95;
  const cabGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.72, 0.56, 24, 1, true), glassMat);
  cabGlass.position.y = 3.34;
  cabGlass.renderOrder = 2;
  g.add(base, shaft, ring, floor, cabGlass);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.56, 0.03), AM.frame);
    m.position.set(Math.cos(a) * 0.75, 3.34, Math.sin(a) * 0.75);
    m.rotation.y = -a;
    g.add(m);
  }
  const cap = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.82, 0.14, 24), AM.white));
  cap.position.y = 3.69;
  const dome = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), AM.white));
  dome.position.y = 3.76;
  dome.scale.y = 0.45;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), AM.steel);
  mast.position.y = 4.2;
  g.add(cap, dome, mast);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 }));
  top.position.y = 4.5;
  g.add(top);
  // Inside the cab: a console and a controller.
  const console = rbox(0.9, 0.18, 0.3, 0.04, AM.dark);
  console.position.set(0, 3.15, -0.35);
  g.add(console);
  const ctl = new Robot({ name: '管制員', shirt: 0x2f7d5b, accent: 0xffffff, body: 'plain', hat: 'headphones', neck: null, glasses: null, item: null });
  ctl.mesh.position.set(0, 3.06, 0.05);
  ctl.mesh.rotation.y = Math.PI;
  g.add(ctl.mesh);
  // Rotating beacon and radar on their own little mast.
  const beacon = new THREE.Group();
  beacon.position.y = 4.55;
  const bw = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false }));
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x39ff7a, blending: THREE.AdditiveBlending, depthWrite: false }));
  bw.position.x = 0.04;
  bg.position.x = -0.04;
  bw.scale.setScalar(0.6);
  bg.scale.setScalar(0.6);
  beacon.add(bw, bg);
  g.add(beacon);
  const radarMast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.6, 8), AM.steel);
  radarMast.position.set(-1.2, 0.8, 0.8);
  const radar = new THREE.Group();
  radar.position.set(-1.2, 1.66, 0.8);
  const dish = shadow(new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.16, 0.06, 2, 0.025), AM.white));
  dish.position.z = 0.05;
  radar.add(dish);
  g.add(radarMast, radar);
  g.position.set(10.0, 0, 6.4);
  group.add(g);
  return { beacon, radar, sprites: [bw, bg], controller: ctl };
}

// ---------- Ground vehicles ----------

export function stairTruck(sill) {
  const g = new THREE.Group();
  const body = rbox(0.34, 0.18, 0.66, 0.05, mat(0xf2c14e, { roughness: 0.45 }));
  body.position.set(0, 0.16, 0);
  const cab = rbox(0.3, 0.2, 0.22, 0.05, mat(0xf2c14e, { roughness: 0.45 }));
  cab.position.set(0, 0.33, -0.2);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.1), glassMat);
  win.position.set(0, 0.36, -0.312);
  win.rotation.y = Math.PI;
  g.add(body, cab, win);
  for (const [x, z] of [[-0.16, -0.22], [0.16, -0.22], [-0.16, 0.22], [0.16, 0.22]]) {
    const w = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14).rotateZ(Math.PI / 2), AM.tyre));
    w.position.set(x, 0.07, z);
    g.add(w);
  }
  // The stairs climb toward +z, up to the sill.
  const run = 0.9;
  const steps = 7;
  const stairs = new THREE.Group();
  const rise = sill - 0.25;
  for (let i = 0; i < steps; i++) {
    const s = rbox(0.26, 0.025, run / steps + 0.02, 0.008, AM.steel);
    s.position.set(0, 0.25 + (rise * (i + 1)) / steps, -run / 2 + (run * (i + 0.5)) / steps);
    stairs.add(s);
  }
  for (const x of [-0.14, 0.14]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(run, rise), 6), AM.white);
    rail.position.set(x, 0.25 + rise / 2 + 0.22, 0);
    rail.rotation.x = Math.atan2(run, rise);
    stairs.add(rail);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, Math.hypot(run, rise)), AM.white);
    side.position.set(x, 0.25 + rise / 2, 0);
    side.rotation.x = -Math.atan2(rise, run);
    stairs.add(side);
  }
  const landing = rbox(0.3, 0.03, 0.16, 0.01, AM.steel);
  landing.position.set(0, sill, run / 2 + 0.08);
  stairs.add(landing);
  g.add(stairs);
  g.userData = { run, rise };
  return g;
}

export function tug() {
  const g = new THREE.Group();
  const body = rbox(0.42, 0.14, 0.5, 0.05, mat(0xf2f2ee, { roughness: 0.45 }));
  body.position.y = 0.13;
  const stripe = rbox(0.43, 0.04, 0.51, 0.02, mat(0x2f8fd0));
  stripe.position.y = 0.12;
  const cab = rbox(0.2, 0.14, 0.16, 0.04, mat(0xf2f2ee));
  cab.position.set(0.08, 0.27, -0.12);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xffa020, emissiveIntensity: 2 }));
  lamp.position.set(0.08, 0.37, -0.12);
  g.add(body, stripe, cab, lamp);
  for (const [x, z] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) {
    const w = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14).rotateZ(Math.PI / 2), AM.tyre));
    w.position.set(x, 0.07, z);
    g.add(w);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6).rotateX(Math.PI / 2), AM.dark);
  bar.position.set(0, 0.12, 0.42);
  g.add(bar);
  return g;
}

function baggageTrain(group) {
  const g = new THREE.Group();
  const tractor = rbox(0.3, 0.16, 0.36, 0.05, mat(0x3a86d4, { roughness: 0.45 }));
  tractor.position.set(0, 0.14, 0);
  g.add(tractor);
  const colors = [0xe85d4a, 0x4a90c8, 0xf2a541, 0x9b7fd1, 0x56c2c2, 0x7bc67b];
  for (let c = 0; c < 2; c++) {
    const cart = rbox(0.34, 0.05, 0.5, 0.015, AM.steel);
    cart.position.set(0, 0.12, -0.5 - c * 0.58);
    g.add(cart);
    for (let i = 0; i < 4; i++) {
      const bag = rbox(0.13, 0.1, 0.18, 0.025, mat(colors[(c * 4 + i) % colors.length], { roughness: 0.5 }));
      bag.position.set(i % 2 ? 0.075 : -0.075, 0.2 + (i > 1 ? 0.1 : 0), -0.5 - c * 0.58 + (i % 2 ? 0.06 : -0.08));
      g.add(bag);
    }
    for (const [x, z] of [[-0.15, -0.18], [0.15, -0.18], [-0.15, 0.18], [0.15, 0.18]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10).rotateZ(Math.PI / 2), AM.tyre);
      w.position.set(x, 0.045, -0.5 - c * 0.58 + z);
      g.add(w);
    }
  }
  g.position.set(-9.2, 0.03, 2.2);
  group.add(g);
}

function fuelTruck(group) {
  const g = new THREE.Group();
  const cab = rbox(0.4, 0.3, 0.32, 0.06, mat(0xf2f2ee, { roughness: 0.4 }));
  cab.position.set(0, 0.25, 0.55);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.12), glassMat);
  win.position.set(0, 0.32, 0.712);
  const tank = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.62, 6, 16).rotateX(Math.PI / 2), mat(0xe8eaec, { metalness: 0.5, roughness: 0.25 })));
  tank.position.set(0, 0.3, -0.08);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.08, 20, 1, true).rotateX(Math.PI / 2), mat(0xe8553f));
  band.position.set(0, 0.3, -0.08);
  const frame = rbox(0.36, 0.06, 1.25, 0.02, AM.dark);
  frame.position.y = 0.1;
  g.add(cab, win, tank, band, frame);
  for (const z of [-0.4, -0.15, 0.5]) {
    for (const x of [-0.18, 0.18]) {
      const w = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 14).rotateZ(Math.PI / 2), AM.tyre));
      w.position.set(x, 0.08, z);
      g.add(w);
    }
  }
  g.position.set(9.4, 0.03, 1.4);
  g.rotation.y = -0.3;
  group.add(g);
}

// ---------- The airport ----------

export class Airport {
  constructor({ x, z, rot }) {
    this.x = x;
    this.z = z;
    this.rot = rot;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rot;
    this.ground = new THREE.Group(); // everything that stands on the pad
    this.ground.position.y = PAD;
    this.group.add(this.ground);
    slab(this.group);
    this.lights = new LightField();
    pavement(this.ground, this.lights);
    this.lights.build(this.ground);
    this.approach = approachLights(this.group);
    papi(this.ground);
    this.sock = windsock(this.group);
    this.board = terminal(this.ground);
    this.tower = tower(this.ground);
    baggageTrain(this.ground);
    fuelTruck(this.ground);
    this.group.updateMatrixWorld(true);
  }

  // Airport frame <-> world.
  toWorld(p) {
    return p.clone().setY(p.y + PAD).applyMatrix4(this.group.matrixWorld);
  }

  dirToWorld(d) {
    return d.clone().applyAxisAngle(UP, this.rot);
  }

  // Inside the slab footprint (airport frame), with a margin.
  containsLocal(x, z, margin = 0) {
    return x > FOOT.x0 - margin && x < FOOT.x1 + margin && z > FOOT.z0 - margin && z < FOOT.z1 + margin;
  }

  contains(x, z, margin = 0) {
    const l = this.group.worldToLocal(new THREE.Vector3(x, 0, z));
    return this.containsLocal(l.x, l.z, margin);
  }

  update(dt, time) {
    // Runway rabbit: the approach lights flash one after another.
    const n = this.approach.items.length / 4;
    const step = Math.floor(time * 7) % (n + 3);
    for (let k = 0; k < n; k++) {
      const on = n - 1 - k === step ? 1.6 : 0.35;
      for (let j = 0; j < 4; j++) this.approach.setLevel(k * 4 + j, on);
    }
    this.sock.rotation.y = 0.5 + Math.sin(time * 0.4) * 0.25;
    this.sock.rotation.z = -0.25 + Math.sin(time * 2.1) * 0.06;
    this.tower.beacon.rotation.y = time * 3;
    for (const [i, s] of this.tower.sprites.entries()) {
      const a = time * 3 + i * Math.PI;
      s.material.opacity = Math.max(0, Math.cos(a)) ** 4;
    }
    this.tower.radar.rotation.y = time * 1.4;
    this.tower.controller.update(dt, time);
  }

  // Night (0..1): field lights grow and brighten.
  setNight(k) {
    this.lights.points.material.size = 0.42 * (1 + k * 0.9);
    this.approach.points.material.size = 0.5 * (1 + k * 0.9);
  }

  // The departures board: one row per plane.
  drawBoard(rows) {
    const { canvas, texture } = this.board;
    const g = canvas.getContext('2d');
    g.fillStyle = '#101a2a';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#f2c230';
    g.font = 'bold 30px sans-serif';
    g.textBaseline = 'middle';
    g.fillText('航班 FLIGHTS', 18, 26);
    g.fillStyle = '#5b6b82';
    g.fillRect(14, 46, canvas.width - 28, 2);
    g.font = 'bold 24px sans-serif';
    rows.slice(0, 5).forEach((r, i) => {
      const y = 72 + i * 32;
      g.fillStyle = '#e8eef7';
      g.fillText(r.code, 18, y);
      g.fillText(r.name, 110, y);
      g.fillStyle = r.color;
      g.textAlign = 'right';
      g.fillText(r.status, canvas.width - 18, y);
      g.textAlign = 'left';
    });
    if (!rows.length) {
      g.fillStyle = '#8fa0b8';
      g.fillText('尚無航班，購買飛機開航', 18, 90);
    }
    texture.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isPoints) o.geometry.dispose();
    });
  }
}
