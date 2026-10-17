import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Polyline, crossings } from './net.js';
import { buildSignals } from './signals.js';

// Builds the look of the road network for each road type: asphalt with a
// fine grain (pale concrete for lanes), double yellow centre lines or a
// planted median with street trees, white edge and lane lines, stop lines
// and zebra crossings at junctions, paved sidewalks with kerbs, turning
// circles at dead ends, street lamps and traffic lights.

const UP = new THREE.Vector3(0, 1, 0);

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  return t;
}

const asphaltTex = typeof document !== 'undefined'
  ? canvasTex(256, (g, n) => {
    g.fillStyle = '#6a6e75';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 2600; i++) {
      const v = 80 + Math.floor(Math.random() * 70);
      g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.25 + Math.random() * 0.35})`;
      const s = 1 + Math.random() * 2.2;
      g.fillRect(Math.random() * n, Math.random() * n, s, s);
    }
  })
  : null;

const paverTex = typeof document !== 'undefined'
  ? canvasTex(128, (g, n) => {
    g.fillStyle = '#d9d3c7';
    g.fillRect(0, 0, n, n);
    const tiles = [[0, 0], [64, 0], [0, 64], [64, 64]];
    for (const [x, y] of tiles) {
      const v = 210 + Math.floor(Math.random() * 25);
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.fillRect(x + 3, y + 3, 58, 58);
    }
  })
  : null;

// Pale poured concrete for lanes: two slabs with a seam down the middle and
// a joint every metre.
const concreteTex = typeof document !== 'undefined'
  ? canvasTex(256, (g, n) => {
    g.fillStyle = '#a19c92';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1800; i++) {
      const v = 135 + Math.floor(Math.random() * 55);
      g.fillStyle = `rgba(${v},${v - 4},${v - 12},${0.2 + Math.random() * 0.3})`;
      const s = 1 + Math.random() * 2;
      g.fillRect(Math.random() * n, Math.random() * n, s, s);
    }
    g.fillStyle = 'rgba(110,104,96,0.55)';
    g.fillRect(0, 0, 3, n);
    g.fillRect(0, 0, n, 2);
  })
  : null;

export const ROAD_MATS = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xd2cdc4, map: concreteTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x86b86a, roughness: 0.95 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a6142, roughness: 0.8 }),
  crown: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true }),
  disk: new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c33a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  walk: new THREE.MeshStandardMaterial({ color: 0xffffff, map: paverTex, roughness: 0.85 }),
  kerb: new THREE.MeshStandardMaterial({ color: 0xbfbab0, roughness: 0.8 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.4, metalness: 0.6 }),
  bulb: new THREE.MeshStandardMaterial({ color: 0xfff8e6, emissive: 0xffe2a8, emissiveIntensity: 1.5 }),
};

// A flat strip from offset o0 to o1 (to the right of travel) along pts,
// with uv in world units (u along, v across). Wide strips get extra
// vertices across so they follow the planet's curve instead of sinking
// into the ground in the middle.
function strip(pts, o0, o1, y, uScale = 1) {
  const line = new Polyline(pts);
  const pos = [];
  const uv = [];
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const k = Math.max(1, Math.ceil((o1 - o0) / 0.45));
  const row = k + 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    for (let j = 0; j <= k; j++) {
      const o = o0 + ((o1 - o0) * j) / k;
      pos.push(p.x + side.x * o, y, p.z + side.z * o);
      uv.push(line.cum[i] * uScale, o * uScale);
      if (i < pts.length - 1 && j < k) {
        const a = i * row + j;
        idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A vertical wall strip at offset o from y0 to y1 facing `face` (+1 right).
function wall(pts, o, y0, y1, face) {
  const pos = [];
  const nor = [];
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    const x = p.x + side.x * o;
    const z = p.z + side.z * o;
    pos.push(x, y0, z, x, y1, z);
    nor.push(side.x * face, 0, side.z * face, side.x * face, 0, side.z * face);
    if (i < pts.length - 1) {
      const a = i * 2;
      if (face > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  return g;
}

const flipStripWinding = (g) => {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  return g;
};

// Trim distances at each end of a segment, for each layer.
function trims(seg) {
  const at = (n) => {
    if (n.segs.length <= 1 || n.smooth) return { road: 0, mark: 0, walk: 0, junction: false, corner: false };
    const R = n.radius;
    if (n.junction) return { road: R * 0.92, mark: R + 0.62, walk: R + 0.02, junction: true };
    return { road: 0, mark: n.half, walk: n.half + 0.05, junction: false, corner: true };
  };
  return [at(seg.a), at(seg.b)];
}

function cut(line, a, b) {
  const s0 = Math.min(a, line.length / 2 - 0.01);
  const s1 = Math.max(s0 + 0.02, line.length - b);
  return line.slice(s0, s1);
}

// The stretches of [a, len - b] left after taking out the gaps.
function runs(line, a, b, gaps) {
  const s0 = Math.min(a, line.length / 2 - 0.01);
  let out = [[s0, Math.max(s0 + 0.02, line.length - b)]];
  for (const [g0, g1] of gaps) {
    out = out.flatMap(([r0, r1]) => {
      if (g1 <= r0 || g0 >= r1) return [[r0, r1]];
      const keep = [];
      if (g0 - r0 > 0.05) keep.push([r0, g0]);
      if (r1 - g1 > 0.05) keep.push([g1, r1]);
      return keep;
    });
  }
  return out;
}

function pieces(line, a, b, gaps) {
  return runs(line, a, b, gaps).map(([r0, r1]) => line.slice(r0, r1));
}

// A flat disc (in the xy plane, like CircleGeometry) with rings of
// vertices, so even a wide junction follows the planet's curve.
const disc = (r, segments) => new THREE.RingGeometry(0, r, segments, Math.max(1, Math.ceil(r / 0.4)));

// A thin painted line at offset o along pts.
const paint = (pts, o, w = 0.026) => flipStripWinding(strip(pts, o - w / 2, o + w / 2, 0.016));

// A vertical cap across the end of a raised strip from offset o0 to o1.
function cap(line, s, o0, o1, h, face) {
  const p = line.pointAt(s);
  const t = line.tangentAt(Math.min(line.length - 0.01, Math.max(0.01, s)));
  const side = new THREE.Vector3().crossVectors(t, UP).normalize();
  const g = new THREE.PlaneGeometry(o1 - o0, h);
  g.rotateY(Math.atan2(t.x * face, t.z * face));
  const c = p.clone().addScaledVector(side, (o0 + o1) / 2);
  g.translate(c.x, h / 2, c.z);
  return g;
}

// stops: bus stop positions, kept clear of lamps.
// rails: polylines of railway track; sidewalks and lamps make way for
// level crossings.
export function buildRoadMeshes(net, rails = [], stops = []) {
  const geos = { asphalt: [], concrete: [], disk: [], yellow: [], white: [], walk: [], kerb: [], grass: [] };
  const lamps = [];
  const trees = [];
  const ends = [...net.nodes].filter((n) => n.segs.length !== 2 || !n.smooth);

  for (const seg of net.segs) {
    const T = seg.type;
    const H = T.half;
    const W = T.walk;
    const [ta, tb] = trims(seg);
    const line = seg.line;
    const gaps = rails.flatMap((r) => crossings(line, r)).map((c) => [c.ta - 1.0, c.ta + 1.0]);
    geos[T.kerb ? 'asphalt' : 'concrete'].push(flipStripWinding(strip(cut(line, ta.road, tb.road), -H, H, 0.012)));
    const marks = cut(line, ta.mark, tb.mark);
    if (T.median) {
      // Raised planted median with kerbs, and a yellow line along each side.
      const m = T.median;
      for (const [r0, r1] of runs(line, ta.mark + 0.12, tb.mark + 0.12, gaps.map(([g0, g1]) => [g0 - 0.3, g1 + 0.3]))) {
        const mid = line.slice(r0, r1);
        if (new Polyline(mid).length < 0.4) continue;
        geos.grass.push(flipStripWinding(strip(mid, -m, m, 0.07, 1)));
        geos.kerb.push(wall(mid, -m, 0, 0.07, -1), wall(mid, m, 0, 0.07, 1));
        geos.kerb.push(cap(line, r0, -m, m, 0.07, -1), cap(line, r1, -m, m, 0.07, 1));
        for (let s = r0 + 0.55; s < r1 - 0.4; s += 1.55) {
          const p = line.pointAt(s);
          if (ends.some((n) => n.pos.distanceTo(p) < n.radius + 0.6)) continue;
          trees.push(p);
        }
      }
      for (const o of [-(m + 0.06), m + 0.06]) geos.yellow.push(paint(marks, o));
      // Dashed lane dividers.
      const div = (T.lanes[0] + T.lanes[1]) / 2;
      const line2 = new Polyline(marks);
      for (let s = 0.1; s < line2.length - 0.1; s += 0.62) {
        const dash = line2.slice(s, Math.min(line2.length - 0.05, s + 0.32));
        for (const o of [-div, div]) geos.white.push(paint(dash, o, 0.024));
      }
    } else if (T.kerb) {
      for (const o of [-0.035, 0.035]) geos.yellow.push(paint(marks, o));
    }
    for (const o of [-(H - 0.07), H - 0.07]) geos.white.push(paint(marks, o, T.kerb ? 0.026 : 0.02));
    // Sidewalks: paved top and kerb faces on both sides; lanes get a flush
    // strip of paving instead.
    for (const walk of pieces(line, ta.walk, tb.walk, gaps)) {
      if (walk.length < 2) continue;
      for (const side of [-1, 1]) {
        const o0 = side * H;
        const o1 = side * (H + W);
        if (!T.kerb) {
          geos.walk.push(flipStripWinding(strip(walk, Math.min(o0, o1), Math.max(o0, o1), 0.018, 1 / 0.26)));
          continue;
        }
        geos.walk.push(flipStripWinding(strip(walk, Math.min(o0, o1), Math.max(o0, o1), 0.05, 1 / 0.26)));
        geos.kerb.push(wall(walk, o0, 0, 0.05, -side));
        geos.kerb.push(wall(walk, o1, 0, 0.05, side));
      }
    }
    // Junction ends: stop line across the incoming lanes and a zebra crossing.
    for (const [end, t, node] of [[0, ta, seg.a], [1, tb, seg.b]]) {
      if (!t.junction) continue;
      const R = node.radius;
      const s = end === 0 ? 0 : line.length;
      const dir = end === 0 ? 1 : -1; // pointing away from the node
      const at = (d) => line.pointAt(s + dir * d);
      const tan = (d) => line.tangentAt(Math.min(line.length - 0.01, Math.max(0.01, s + dir * d))).multiplyScalar(dir);
      // Zebra: stripes across the road between R+0.06 and R+0.5.
      const z0 = R + 0.06;
      const z1 = R + 0.5;
      const c = at((z0 + z1) / 2);
      const f = tan((z0 + z1) / 2);
      const side = new THREE.Vector3().crossVectors(f, UP).normalize();
      for (let x = -H + 0.1; x <= H - 0.08; x += 0.17) {
        const g = new THREE.PlaneGeometry(0.085, z1 - z0).rotateX(-Math.PI / 2);
        g.rotateY(Math.atan2(f.x, f.z));
        g.translate(c.x + side.x * x, 0.016, c.z + side.z * x);
        geos.white.push(g);
      }
      // Stop line across the lanes coming toward the node (their right side
      // when facing the node, i.e. the left side of `f`).
      const inner = T.median ? T.median + 0.1 : 0.06;
      const w = H - 0.05 - inner;
      const sl = at(R + 0.62);
      const g = new THREE.PlaneGeometry(w, 0.05, Math.ceil(w / 0.4), 1).rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(f.x, f.z));
      g.translate(sl.x - side.x * (inner + w / 2), 0.016, sl.z - side.z * (inner + w / 2));
      geos.white.push(g);
    }
    // Street lamps on alternating sides.
    const spacing = T.median ? 3.6 : 4.2;
    let k = 0;
    for (let s = 1.6; s < line.length - 1.6; s += spacing, k++) {
      const p = line.pointAt(s);
      if (ends.some((n) => n.segs.length !== 2 && n.pos.distanceTo(p) < n.radius + 0.9 + (n.junction ? 0.5 : 0))) continue;
      if (gaps.some(([g0, g1]) => s > g0 - 0.6 && s < g1 + 0.6)) continue;
      const t = line.tangentAt(s);
      const side = new THREE.Vector3().crossVectors(t, UP).normalize().multiplyScalar(k % 2 ? 1 : -1);
      const at = p.clone().addScaledVector(side, H + W);
      if (stops.some((q) => q.distanceTo(at) < 1.5)) continue;
      lamps.push({ p: p.clone().addScaledVector(side, H + W - 0.07), toward: side.clone().negate() });
    }
  }

  for (const n of net.nodes) {
    if (n.segs.length >= 3) geos.disk.push(disc(n.radius, 48).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
    else if (n.segs.length === 2 && !n.smooth) geos.disk.push(disc(n.half, 32).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
    else if (n.segs.length === 1) {
      // Turning circle with a kerb ring that leaves the road's mouth open.
      const T = n.segs[0].type;
      const R = T.half + 0.43;
      geos.disk.push(disc(R, 40).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
      const d = n.segs[0].dirAt(n);
      const ang = Math.atan2(d.z, d.x);
      const gap = Math.asin(Math.min(1, (T.half + T.walk) / (R + 0.05))) + 0.05;
      const start = ang + gap;
      const len = Math.PI * 2 - gap * 2;
      const W = T.walk;
      const top = T.kerb ? 0.05 : 0.018;
      // RingGeometry runs counter-clockwise in its own xy plane; rotating
      // onto the ground flips the sense of z, so mirror the start angle.
      const ring = new THREE.RingGeometry(R, R + W, 40, 1, -start - len, len).rotateX(-Math.PI / 2).translate(n.pos.x, top, n.pos.z);
      geos.walk.push(ring);
      if (T.kerb) {
        const outer = new THREE.CylinderGeometry(R + W, R + W, 0.05, 40, 1, true, Math.PI / 2 + start, len).translate(n.pos.x, 0.025, n.pos.z);
        const inner = new THREE.CylinderGeometry(R, R, 0.05, 40, 1, true, Math.PI / 2 + start, len).translate(n.pos.x, 0.025, n.pos.z);
        flipStripWinding(inner);
        geos.kerb.push(outer.toNonIndexed().setIndex(null), inner);
      }
    }
  }

  const group = new THREE.Group();
  for (const [key, list] of Object.entries(geos)) {
    if (!list.length) continue;
    const norm = list.map((g) => {
      const x = g.index ? g.toNonIndexed() : g;
      if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(x.attributes.position.count * 2).fill(0), 2));
      if (!x.attributes.normal) x.computeVertexNormals();
      for (const name of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(name)) x.deleteAttribute(name);
      return x;
    });
    const m = new THREE.Mesh(mergeGeometries(norm), ROAD_MATS[key]);
    m.receiveShadow = true;
    m.castShadow = key === 'walk' || key === 'kerb' || key === 'grass';
    group.add(m);
  }
  if (lamps.length) group.add(...lampMeshes(lamps));
  if (trees.length) group.add(...treeMeshes(trees));
  const signals = buildSignals(net);
  if (signals) {
    group.add(...signals.meshes);
    group.userData.signals = signals;
  }
  return group;
}

// Street trees for the median: a slim trunk and a faceted round crown,
// each a little different in size, lean and shade of green.
function treeMeshes(spots) {
  const trunk = new THREE.CylinderGeometry(0.022, 0.032, 0.42, 7).translate(0, 0.28, 0);
  const crown = mergeGeometries([
    new THREE.IcosahedronGeometry(0.2, 1).translate(0, 0.62, 0),
    new THREE.IcosahedronGeometry(0.13, 1).translate(0.08, 0.78, 0.03),
    new THREE.IcosahedronGeometry(0.12, 1).translate(-0.09, 0.72, -0.04),
  ].map((g) => (g.index ? g.toNonIndexed() : g)));
  const shades = [0x5fae5a, 0x6dbb5e, 0x4f9e57, 0x7cc067, 0x5aa86a].map((c) => new THREE.Color(c));
  const out = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const looks = spots.map((p, i) => ({ p, yaw: Math.random() * Math.PI * 2, tilt: (Math.random() - 0.5) * 0.12, s: 0.85 + Math.random() * 0.35, shade: shades[i % shades.length] }));
  for (const [geo, mat] of [[trunk, ROAD_MATS.trunk], [crown, ROAD_MATS.crown]]) {
    const inst = new THREE.InstancedMesh(geo, mat, looks.length);
    looks.forEach((l, i) => {
      q.setFromEuler(e.set(l.tilt, l.yaw, l.tilt * 0.5));
      m.compose(tmpV.set(l.p.x, 0.07, l.p.z), q, sc.setScalar(l.s));
      inst.setMatrixAt(i, m);
      if (mat === ROAD_MATS.crown) inst.setColorAt(i, l.shade);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    out.push(inst);
  }
  return out;
}

const tmpV = new THREE.Vector3();

// Street lamps: tapered pole, curved arm, lamp head and glowing bulb.
function lampMeshes(lamps) {
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.045, 0.055, 0.06, 12).translate(0, 0.03, 0),
    new THREE.CylinderGeometry(0.016, 0.024, 0.95, 10).translate(0, 0.5, 0),
    new THREE.TorusGeometry(0.12, 0.012, 6, 14, Math.PI / 2).rotateZ(0).translate(-0.12, 0.97, 0).rotateY(Math.PI / 2),
  ].map((g) => g.toNonIndexed()));
  const head = new THREE.CylinderGeometry(0.035, 0.07, 0.05, 16).translate(0, 1.07, 0.15);
  const bulb = new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, 1.05, 0.15);
  const out = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const [geo, mat] of [[pole, ROAD_MATS.pole], [head, ROAD_MATS.pole], [bulb, ROAD_MATS.bulb]]) {
    const inst = new THREE.InstancedMesh(geo, mat, lamps.length);
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(UP, Math.atan2(l.toward.x, l.toward.z));
      m.compose(l.p, q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = mat !== ROAD_MATS.bulb;
    inst.receiveShadow = true;
    out.push(inst);
  }
  return out;
}
