import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small modelling kit shared by every shop building: cached materials,
// rounded primitives, painted canvas textures (signs, awnings, floors) and a
// pass that merges a finished building's static parts by material.

export const FONT = '"Noto Sans TC", "PingFang TC", "WenQuanYi Zen Hei", system-ui, sans-serif';

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export const matte = (color, roughness = 0.75) =>
  cached(`m${color}-${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness }));
export const paint = (color) =>
  cached(`p${color}`, () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.3 }));
export const metal = (color, roughness = 0.3) =>
  cached(`x${color}-${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.85 }));
export const glow = (color, intensity = 1.4) =>
  cached(`e${color}-${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
// Interior surfaces glow faintly warm, as if lit by the shop's lamps.
export const warm = (color, roughness = 0.7) =>
  cached(`w${color}-${roughness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, emissive: 0xffb36b, emissiveIntensity: 0.16 }),
  );

// Shop-window glass: clear, glossy, reflecting the sky; inside stays visible.
export const GLASS = new THREE.MeshPhysicalMaterial({
  color: 0xeaf6ff,
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.22,
  envMapIntensity: 1.6,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  specularIntensity: 1,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export const C = {
  stone: 0xe9e3d6,
  trim: 0xfbf8f1,
  frame: 0x3b3f4a,
  wood: 0xb57a4a,
  woodDark: 0x7b4f30,
  floor: 0xd9b48a,
};

export const mesh = (geo, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
};

const geoCache = new Map();
const g = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const k = (...a) => a.map((v) => (typeof v === 'number' ? v.toFixed(3) : v)).join(',');

export const rbox = (w, h, d, r, material, x, y, z) => {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = g(k('rb', w, h, d, rr), () => (rr > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d)));
  return mesh(geo, material, x, y, z);
};
export const cyl = (rt, rb, h, seg, material, x, y, z) =>
  mesh(g(k('cy', rt, rb, h, seg), () => new THREE.CylinderGeometry(rt, rb, h, seg)), material, x, y, z);
export const sphere = (r, material, x, y, z, ws = 14, hs = 10) =>
  mesh(g(k('sp', r, ws, hs), () => new THREE.SphereGeometry(r, ws, hs)), material, x, y, z);
export const torus = (r, tube, material, x, y, z, arc = Math.PI * 2) =>
  mesh(g(k('to', r, tube, arc), () => new THREE.TorusGeometry(r, tube, 8, 28, arc)), material, x, y, z);
export const cone = (r, h, seg, material, x, y, z) =>
  mesh(g(k('co', r, h, seg), () => new THREE.ConeGeometry(r, h, seg)), material, x, y, z);

// At night interiors, floors and signs glow brighter (see game.look.onTime).
export function setNight(night) {
  for (const [key, m] of cache) {
    if (key.startsWith('w')) m.emissiveIntensity = 0.16 + night * 0.7;
    else if (key.startsWith('fm')) m.emissiveIntensity = 0.08 + night * 0.4;
    else if (key.startsWith('sg')) m.emissiveIntensity = 0.12 + night * 0.9;
  }
}

// ---------- Painted textures ----------

const texCache = new Map();
function canvasTex(key, w, h, draw, repeat) {
  return cached(`t${key}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(...repeat);
    }
    texCache.set(key, tex);
    return tex;
  });
}

const hex = (c) => `#${new THREE.Color(c).getHexString()}`;

// Canvas awning stripes.
export function stripeMat(a, b) {
  const tex = canvasTex(`stripe${a}-${b}`, 128, 16, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = hex(i % 2 ? b : a);
      c.fillRect((i * w) / 8, 0, w / 8, h);
    }
  });
  return cached(`sm${a}-${b}`, () =>
    new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }),
  );
}

// Plank floor for interiors.
export function floorMat(base = C.floor) {
  const tex = canvasTex(`floor${base}`, 128, 128, (c, w, h) => {
    const col = new THREE.Color(base);
    for (let i = 0; i < 8; i++) {
      const t = col.clone().offsetHSL(0, 0, ((i * 37) % 7) / 100 - 0.03);
      c.fillStyle = `#${t.getHexString()}`;
      c.fillRect(0, (i * h) / 8, w, h / 8);
      c.fillStyle = 'rgba(60,30,10,0.35)';
      c.fillRect(0, (i * h) / 8, w, 1.5);
      c.fillRect(((i * 53) % 100) + 10, (i * h) / 8, 1.5, h / 8);
    }
  });
  return cached(`fm${base}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: 0xffb36b, emissiveIntensity: 0.08 }));
}

// Brick or tiled wall cladding.
export function brickMat(base, mortar = 0xf1e9dc) {
  const tex = canvasTex(`brick${base}-${mortar}`, 128, 128, (c, w, h) => {
    c.fillStyle = hex(mortar);
    c.fillRect(0, 0, w, h);
    const col = new THREE.Color(base);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 16 : 0;
      for (let x = -32; x < w; x += 32) {
        const t = col.clone().offsetHSL(0, 0, (((r * 7 + x) % 5) - 2) / 70);
        c.fillStyle = `#${t.getHexString()}`;
        c.fillRect(x + off + 1.5, r * 16 + 1.5, 29, 13);
      }
    }
  });
  return cached(`bm${base}-${mortar}`, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    return m;
  });
}

// Shop sign: name in bold lettering on a painted board.
export function signMat(text, bg, fg = '#ffffff', sub = '') {
  const tex = canvasTex(`sign${text}${bg}${fg}`, 512, 128, (c, w, h) => {
    const r = 26;
    c.fillStyle = hex(bg);
    c.beginPath();
    c.roundRect(4, 4, w - 8, h - 8, r);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.65)';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(14, 14, w - 28, h - 28, r - 8);
    c.stroke();
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 ${sub ? 58 : 66}px ${FONT}`;
    c.fillText(text, w / 2, sub ? h / 2 - 12 : h / 2 + 3);
    if (sub) {
      c.font = `600 24px ${FONT}`;
      c.globalAlpha = 0.85;
      c.fillText(sub, w / 2, h / 2 + 34);
    }
  });
  return cached(`sg${text}${bg}${fg}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
}

// A round icon disc (blade sign hanging by the door).
export function iconMat(symbol, bg) {
  const tex = canvasTex(`icon${symbol}${bg}`, 128, 128, (c, w, h) => {
    c.fillStyle = hex(bg);
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2);
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = `800 64px "Noto Color Emoji", ${FONT}`;
    c.fillText(symbol, w / 2, h / 2 + 5);
  });
  return cached(`ic${symbol}${bg}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, side: THREE.DoubleSide, alphaTest: 0.5 }));
}

// ---------- Merging ----------

// Bake every static mesh under `root` (except those under `keep`) into one
// mesh per material, in root's local space. Cuts a shop's draw calls from
// hundreds to a couple dozen.
export function bake(root, keep = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const doomed = [];
  const skip = new Set();
  for (const k of keep) k.traverse((o) => skip.add(o));
  root.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.material.transparent) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const entry = byMat.get(o.material) ?? { list: [], cast: false };
    entry.list.push(geo);
    entry.cast ||= o.castShadow !== false && !o.userData.noShadow;
    byMat.set(o.material, entry);
    doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();
  const baked = new THREE.Group();
  for (const [material, { list }] of byMat) {
    const merged = mergeGeometries(list);
    for (const l of list) l.dispose();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = !material.emissiveIntensity || material.emissiveIntensity < 1;
    m.receiveShadow = true;
    baked.add(m);
  }
  root.add(baked);
  return baked;
}
