import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { JUNCTION_R, Polyline, ROAD_HALF, WALK, crossings } from './net.js';

// Builds the look of the road network: asphalt with a fine grain, double
// yellow centre lines, white edge lines, stop lines and zebra crossings at
// junctions, paved sidewalks with kerbs, turning circles at dead ends and
// street lamps.

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

export const ROAD_MATS = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  disk: new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c33a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  walk: new THREE.MeshStandardMaterial({ color: 0xffffff, map: paverTex, roughness: 0.85 }),
  kerb: new THREE.MeshStandardMaterial({ color: 0xbfbab0, roughness: 0.8 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.4, metalness: 0.6 }),
  bulb: new THREE.MeshStandardMaterial({ color: 0xfff8e6, emissive: 0xffe2a8, emissiveIntensity: 1.5 }),
};

// A flat strip from offset o0 to o1 (to the right of travel) along pts,
// with uv in world units (u along, v across).
function strip(pts, o0, o1, y, uScale = 1) {
  const line = new Polyline(pts);
  const pos = [];
  const uv = [];
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    t.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    side.crossVectors(t, UP).normalize();
    pos.push(p.x + side.x * o0, y, p.z + side.z * o0, p.x + side.x * o1, y, p.z + side.z * o1);
    uv.push(line.cum[i] * uScale, o0 * uScale, line.cum[i] * uScale, o1 * uScale);
    if (i < pts.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
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
    if (n.junction) return { road: JUNCTION_R * 0.92, mark: JUNCTION_R + 0.62, walk: JUNCTION_R + 0.02, junction: true };
    return { road: 0, mark: ROAD_HALF, walk: ROAD_HALF + 0.05, junction: false, corner: true };
  };
  return [at(seg.a), at(seg.b)];
}

function cut(line, a, b) {
  const s0 = Math.min(a, line.length / 2 - 0.01);
  const s1 = Math.max(s0 + 0.02, line.length - b);
  return line.slice(s0, s1);
}

// The stretches of [a, len - b] left after taking out the gaps.
function pieces(line, a, b, gaps) {
  let runs = [[Math.min(a, line.length / 2 - 0.01), Math.max(Math.min(a, line.length / 2 - 0.01) + 0.02, line.length - b)]];
  for (const [g0, g1] of gaps) {
    runs = runs.flatMap(([r0, r1]) => {
      if (g1 <= r0 || g0 >= r1) return [[r0, r1]];
      const out = [];
      if (g0 - r0 > 0.05) out.push([r0, g0]);
      if (r1 - g1 > 0.05) out.push([g1, r1]);
      return out;
    });
  }
  return runs.map(([r0, r1]) => line.slice(r0, r1));
}

// stops: bus stop positions, kept clear of lamps.
// rails: polylines of railway track; sidewalks and lamps make way for
// level crossings.
export function buildRoadMeshes(net, rails = [], stops = []) {
  const geos = { asphalt: [], disk: [], yellow: [], white: [], walk: [], kerb: [] };
  const lamps = [];

  for (const seg of net.segs) {
    const [ta, tb] = trims(seg);
    const line = seg.line;
    const gaps = rails.flatMap((r) => crossings(line, r)).map((c) => [c.ta - 1.0, c.ta + 1.0]);
    geos.asphalt.push(flipStripWinding(strip(cut(line, ta.road, tb.road), -ROAD_HALF, ROAD_HALF, 0.012)));
    const marks = cut(line, ta.mark, tb.mark);
    for (const o of [-0.035, 0.035]) geos.yellow.push(flipStripWinding(strip(marks, o - 0.013, o + 0.013, 0.016)));
    for (const o of [-(ROAD_HALF - 0.07), ROAD_HALF - 0.07]) geos.white.push(flipStripWinding(strip(marks, o - 0.013, o + 0.013, 0.016)));
    // Sidewalks: paved top and kerb faces on both sides.
    for (const walk of pieces(line, ta.walk, tb.walk, gaps)) {
      if (walk.length < 2) continue;
      for (const side of [-1, 1]) {
        const o0 = side * ROAD_HALF;
        const o1 = side * (ROAD_HALF + WALK);
        geos.walk.push(flipStripWinding(strip(walk, Math.min(o0, o1), Math.max(o0, o1), 0.05, 1 / 0.26)));
        geos.kerb.push(wall(walk, o0, 0, 0.05, -side));
        geos.kerb.push(wall(walk, o1, 0, 0.05, side));
      }
    }
    // Junction ends: stop line across the incoming lane and a zebra crossing.
    for (const [end, t] of [[0, ta], [1, tb]]) {
      if (!t.junction) continue;
      const s = end === 0 ? 0 : line.length;
      const dir = end === 0 ? 1 : -1; // pointing away from the node
      const at = (d) => line.pointAt(s + dir * d);
      const tan = (d) => line.tangentAt(Math.min(line.length - 0.01, Math.max(0.01, s + dir * d))).multiplyScalar(dir);
      // Zebra: stripes across the road between JUNCTION_R+0.05 and +0.5.
      const z0 = JUNCTION_R + 0.06;
      const z1 = JUNCTION_R + 0.5;
      const c = at((z0 + z1) / 2);
      const f = tan((z0 + z1) / 2);
      const side = new THREE.Vector3().crossVectors(f, UP).normalize();
      for (let x = -ROAD_HALF + 0.1; x <= ROAD_HALF - 0.08; x += 0.17) {
        const g = new THREE.PlaneGeometry(0.085, z1 - z0).rotateX(-Math.PI / 2);
        g.rotateY(Math.atan2(f.x, f.z));
        g.translate(c.x + side.x * x, 0.016, c.z + side.z * x);
        geos.white.push(g);
      }
      // Stop line on the lane coming toward the node (its right side when
      // facing the node, i.e. the left side of `f`).
      const sl = at(JUNCTION_R + 0.62);
      const g = new THREE.PlaneGeometry(ROAD_HALF - 0.05, 0.05).rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(f.x, f.z));
      g.translate(sl.x - side.x * (ROAD_HALF / 2), 0.016, sl.z - side.z * (ROAD_HALF / 2));
      geos.white.push(g);
    }
    // Street lamps on alternating sides.
    const spacing = 4.2;
    let k = 0;
    for (let s = 1.6; s < line.length - 1.6; s += spacing, k++) {
      const p = line.pointAt(s);
      if ([...net.nodes].some((n) => n.segs.length !== 2 && n.pos.distanceTo(p) < JUNCTION_R + 0.9)) continue;
      if (gaps.some(([g0, g1]) => s > g0 - 0.6 && s < g1 + 0.6)) continue;
      const t = line.tangentAt(s);
      const side = new THREE.Vector3().crossVectors(t, UP).normalize().multiplyScalar(k % 2 ? 1 : -1);
      const at = p.clone().addScaledVector(side, ROAD_HALF + WALK);
      if (stops.some((q) => q.distanceTo(at) < 1.5)) continue;
      lamps.push({ p: p.clone().addScaledVector(side, ROAD_HALF + WALK - 0.07), toward: side.clone().negate() });
    }
  }

  for (const n of net.nodes) {
    if (n.segs.length >= 3) geos.disk.push(new THREE.CircleGeometry(JUNCTION_R, 40).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
    else if (n.segs.length === 2 && !n.smooth) geos.disk.push(new THREE.CircleGeometry(ROAD_HALF, 32).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
    else if (n.segs.length === 1) {
      // Turning circle with a kerb ring that leaves the road's mouth open.
      const R = 1.15;
      geos.disk.push(new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2).translate(n.pos.x, 0.014, n.pos.z));
      const d = n.segs[0].dirAt(n);
      const ang = Math.atan2(d.z, d.x);
      const gap = Math.asin(Math.min(1, (ROAD_HALF + WALK) / R)) + 0.05;
      const start = ang + gap;
      const len = Math.PI * 2 - gap * 2;
      // RingGeometry runs counter-clockwise in its own xy plane; rotating
      // onto the ground flips the sense of z, so mirror the start angle.
      const ring = new THREE.RingGeometry(R, R + WALK, 40, 1, -start - len, len).rotateX(-Math.PI / 2).translate(n.pos.x, 0.05, n.pos.z);
      geos.walk.push(ring);
      const outer = new THREE.CylinderGeometry(R + WALK, R + WALK, 0.05, 40, 1, true, Math.PI / 2 + start, len).translate(n.pos.x, 0.025, n.pos.z);
      const inner = new THREE.CylinderGeometry(R, R, 0.05, 40, 1, true, Math.PI / 2 + start, len).translate(n.pos.x, 0.025, n.pos.z);
      flipStripWinding(inner);
      geos.kerb.push(outer.toNonIndexed().setIndex(null), inner);
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
    m.castShadow = key === 'walk' || key === 'kerb';
    group.add(m);
  }
  if (lamps.length) group.add(...lampMeshes(lamps));
  return group;
}

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
