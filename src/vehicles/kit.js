import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared materials and modelling helpers for road vehicles.

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// Glossy car paint: a sharp clear coat over a slightly metallic base, so the
// studio environment slides across the panels as vehicles turn.
export const paint = (color, { metal = 0.25, rough = 0.3 } = {}) =>
  cached(`paint${color}-${metal}-${rough}`, () =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: metal,
      roughness: rough,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.5,
    }),
  );

export const matte = (color, rough = 0.6, opts = {}) =>
  cached(`matte${color}-${rough}-${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, ...opts }));

export const glow = (color, intensity = 1.4, base = 0xffffff) =>
  cached(`glow${color}-${intensity}-${base}`, () =>
    new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.2 }),
  );

export const K = {
  chrome: new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.12, envMapIntensity: 1.8 }),
  alloy: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.24, envMapIntensity: 1.5 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x25272c, roughness: 0.85, side: THREE.DoubleSide }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.45 }),
  under: new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.9 }),
  bumper: new THREE.MeshPhysicalMaterial({ color: 0xe4e7eb, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  head: new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: 1.6, roughness: 0.05, clearcoat: 1 }),
  tail: new THREE.MeshPhysicalMaterial({ color: 0xff6b5e, emissive: 0xff2414, emissiveIntensity: 1.3, roughness: 0.1, clearcoat: 1 }),
  amber: new THREE.MeshPhysicalMaterial({ color: 0xffc46b, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.1, clearcoat: 1 }),
  cabinLight: new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffd9a0, emissiveIntensity: 1.1 }),
  // Curved glass: a clear, very glossy shell. Mostly reflections, so robots
  // inside stay easy to see.
  bubble: new THREE.MeshPhysicalMaterial({
    color: 0xd6ecf7,
    metalness: 0,
    roughness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0,
    specularIntensity: 1,
    envMapIntensity: 2.8,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
};

export function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const rbox = (w, h, d, r, material, x, y, z) =>
  mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), material, x, y, z);

// A thin tube from a to b.
export function rod(a, b, radius, material, segments = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), segments), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

export const tube = (points, radius, material, closed = false) =>
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), points.length * 4, radius, 8, closed), material);

// ---------- Superellipse sections ----------

export function sectionPoint(s, a, power) {
  const e = 2 / power;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  return new THREE.Vector3(s.hw * Math.sign(c) * Math.abs(c) ** e, cy + hh * Math.sign(n) * Math.abs(n) ** e, s.z);
}

// Angle on the right-hand side of section `s` where it crosses height y.
export function angleAt(s, y, power) {
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  const k = THREE.MathUtils.clamp((y - cy) / hh, -1, 1);
  return Math.asin(Math.sign(k) * Math.abs(k) ** (power / 2));
}

export const widthAt = (s, y, power) => {
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  const k = Math.min(1, Math.abs((y - cy) / hh));
  return s.hw * (1 - k ** power) ** (1 / power);
};

// Points along section `s` from height y0 up over the top to y0 on the
// other side (or just one side's arc from y0 to y1 when `y1` is given).
export function arcPoints(s, power, y0, y1 = null, n = 16, grow = 1) {
  const pts = [];
  const a0 = angleAt(s, y0, power);
  const a1 = y1 === null ? Math.PI - a0 : angleAt(s, y1, power);
  for (let i = 0; i <= n; i++) {
    const p = sectionPoint(s, a0 + ((a1 - a0) * i) / n, power);
    const cy = (s.top + s.bottom) / 2;
    p.x *= grow;
    p.y = cy + (p.y - cy) * grow;
    pts.push(p);
  }
  return pts;
}

// Interpolate a list of sections (each {z, hw, bottom, top}) along a smooth
// curve through their values, `n` sections in all.
export function smoothSections(keys, n) {
  const curve = (f) => new THREE.SplineCurve(keys.map((k) => new THREE.Vector2(k.z, f(k))));
  const hw = curve((k) => k.hw);
  const top = curve((k) => k.top);
  const bottom = curve((k) => k.bottom);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ z: hw.getPoint(t).x, hw: hw.getPoint(t).y, top: top.getPoint(t).y, bottom: bottom.getPoint(t).y });
  }
  return out;
}

// ---------- Wheels ----------

const wheelGeo = new Map();
function wheelParts(r, w) {
  const key = `${r}-${w}`;
  if (wheelGeo.has(key)) return wheelGeo.get(key);
  const ri = r * 0.64;
  const c = Math.min(0.022, r * 0.2);
  const prof = [
    [ri, -w / 2],
    [r - c, -w / 2],
    [r - c * 0.3, -w / 2 + c * 0.3],
    [r, -w / 2 + c],
    [r, w / 2 - c],
    [r - c * 0.3, w / 2 - c * 0.3],
    [r - c, w / 2],
    [ri, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2);
  tire.computeVertexNormals();
  const rim = new THREE.CylinderGeometry(ri, ri, w * 0.82, 24).rotateZ(Math.PI / 2);
  const dish = new THREE.CylinderGeometry(ri * 0.95, ri * 0.7, w * 0.12, 24).rotateZ(Math.PI / 2).translate(w * 0.44, 0, 0);
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(w * 0.1, ri * 0.85, ri * 0.22);
    s.translate(0, ri * 0.45, 0).rotateX((i / 5) * Math.PI * 2).translate(w * 0.47, 0, 0);
    spokes.push(s);
  }
  const hub = new THREE.CylinderGeometry(ri * 0.26, ri * 0.3, w * 0.12, 14).rotateZ(Math.PI / 2).translate(w * 0.52, 0, 0);
  const parts = { tire, rim, dish, spokes: mergeGeometries(spokes), hub };
  wheelGeo.set(key, parts);
  return parts;
}

// A car wheel whose face points toward +x (side = 1) or -x (side = -1).
// Rolls about its local x axis.
export function carWheel(r, w, rimMat = K.alloy) {
  const p = wheelParts(r, w);
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(mesh(p.tire, K.rubber), mesh(p.rim, K.trim), mesh(p.dish, rimMat), mesh(p.spokes, rimMat), mesh(p.hub, K.chrome));
  g.add(spin);
  return { obj: g, spin, r };
}

// ---------- Baking ----------

// Merge every static mesh under `root` into one mesh per material, so a
// detailed vehicle costs a handful of draw calls. Meshes inside `keep`
// subtrees (wheels, doors) and textured meshes are left alone.
export function bake(root, keep = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const keepSet = new Set(keep);
  const groups = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || o.material.map) return;
    for (let p = o; p && p !== root; p = p.parent) if (keepSet.has(p)) return;
    const key = `${o.material.uuid}-${o.castShadow}`;
    if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, geos: [] });
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    groups.get(key).geos.push(g);
    victims.push(o);
  });
  for (const o of victims) o.removeFromParent();
  for (const { material, cast, geos } of groups.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    m.castShadow = cast && !material.transparent;
    m.receiveShadow = true;
    if (material.transparent) m.renderOrder = 2;
    root.add(m);
    for (const g of geos) g.dispose();
  }
}

// ---------- Small textures ----------

const FONT = '"Noto Sans TC", "PingFang TC", system-ui, sans-serif';

export function textTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function plateTexture(text) {
  return textTexture(128, 48, (g, w, h) => {
    g.fillStyle = '#f7f8f4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2b2e35';
    g.lineWidth = 4;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#2b2e35';
    g.font = `800 30px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

export { FONT };
