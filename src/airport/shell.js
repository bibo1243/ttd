import * as THREE from 'three';

// Hull geometry for aircraft: a superellipse section swept along +z, with
// rectangular openings cut out. Adapted from the train cabins in parts.js,
// with a few extras planes need:
//   cut.side  only open one side (+1 = +x, -1 = -x)
//   cut.wrap  open the band all the way round (cockpit glazing)
// Cut heights are read on the reference section and follow each station's
// shape, so a band wraps smoothly round a tapering nose.
//   keep: 'cuts' returns only the faces that were cut away, which is exactly
//   the shape of the opening: used for curved glass and the door plug.
//   colorAt(x, y, z) paints each face (livery) through vertex colours.

export const sectionPoint = (s, a, power) => {
  const e = 2 / power;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  return [s.hw * Math.sign(c) * Math.abs(c) ** e, cy + hh * Math.sign(n) * Math.abs(n) ** e];
};

export const sectionX = (s, y, power) => {
  const cy = (s.top + s.bottom) / 2;
  const hh = (s.top - s.bottom) / 2;
  const k = Math.min(1, Math.abs((y - cy) / hh));
  return s.hw * (1 - k ** power) ** (1 / power);
};

export function hullGeometry(stations, ref, cuts, o = {}) {
  const { segments = 48, power = 2.4, keep = 'solid', extraY = [], colorAt = null } = o;
  const cy = (ref.top + ref.bottom) / 2;
  const hh = (ref.top - ref.bottom) / 2;
  const angles = [];
  for (let k = 0; k < segments; k++) angles.push((k / segments) * Math.PI * 2);
  const ys = [...extraY];
  for (const c of cuts) ys.push(c.y0, c.y1);
  for (const y of ys) {
    const s = THREE.MathUtils.clamp((y - cy) / hh, -0.999, 0.999);
    const ar = Math.asin(Math.sign(s) * Math.abs(s) ** (power / 2));
    angles.push(THREE.MathUtils.euclideanModulo(ar, Math.PI * 2), Math.PI - ar);
  }
  angles.sort((a, b) => a - b);
  const A = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-4);
  const n = A.length;

  const positions = [];
  const indices = [];
  for (const s of stations) {
    for (const a of A) {
      const [x, y] = sectionPoint(s, a, power);
      positions.push(x, y, s.z);
    }
  }
  const eps = 1e-4;
  // Livery is painted by angle round the section (read as the height it has
  // on the reference section), so stripes stay crisp through nose and tail.
  const faceColors = [];
  const paintFace = (x, y, z) => {
    if (colorAt) faceColors.push(colorAt(x, y, z));
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const z0 = stations[i].z;
    const z1 = stations[i + 1].z;
    for (let k = 0; k < n; k++) {
      const a0 = A[k];
      const a1 = k + 1 < n ? A[k + 1] : A[0] + Math.PI * 2;
      const [xm] = sectionPoint(stations[i], (a0 + a1) / 2, power);
      const v = Math.sin((a0 + a1) / 2);
      const ym = cy + hh * Math.sign(v) * Math.abs(v) ** (2 / power); // height on the reference section
      const open = cuts.some(
        (c) =>
          z0 >= c.z0 - eps &&
          z1 <= c.z1 + eps &&
          ym > c.y0 &&
          ym < c.y1 &&
          (c.wrap || (Math.abs(xm) > ref.hw * 0.55 && (c.side == null || Math.sign(xm) === c.side))),
      );
      if (open !== (keep === 'cuts')) continue;
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      indices.push(a, b, a + n, b, b + n, a + n);
      paintFace(xm, ym, (z0 + z1) / 2);
    }
  }
  if (keep === 'solid') {
    const cap = (si, front) => {
      const s = stations[si];
      if (s.hw < 0.005) return;
      const base = positions.length / 3;
      positions.push(0, (s.top + s.bottom) / 2, s.z);
      for (const a of A) {
        const [x, y] = sectionPoint(s, a, power);
        positions.push(x, y, s.z);
      }
      for (let k = 0; k < n; k++) {
        const a = base + 1 + k;
        const b = base + 1 + ((k + 1) % n);
        if (front) indices.push(base, a, b);
        else indices.push(base, b, a);
        if (colorAt) faceColors.push(colorAt(0, (s.top + s.bottom) / 2, s.z), null);
      }
    };
    cap(0, false);
    cap(stations.length - 1, true);
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (colorAt) {
    // Split vertices so livery edges stay crisp; normals stay smooth.
    geo = geo.toNonIndexed();
    const p = geo.attributes.position.array;
    const col = new Float32Array(p.length);
    const c = new THREE.Color();
    // Two triangles per quad share a colour; cap fans pushed [colour, null].
    const tri = [];
    for (let f = 0; f < faceColors.length; f++) {
      if (faceColors[f] === null) continue;
      const capTri = faceColors[f + 1] === null;
      tri.push(faceColors[f]);
      if (!capTri) tri.push(faceColors[f]);
    }
    for (let t = 0, f = 0; t < p.length; t += 9, f++) {
      c.set(tri[f]);
      for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], t + v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

// Symmetric airfoil (NACA 4-digit thickness) with a touch of camber, as a
// closed loop of [z, y] points; leading edge at z = 0, trailing edge at -1.
function airfoil(count, thick, camber) {
  const half = [];
  for (let i = 0; i <= count; i++) {
    const x = (1 - Math.cos((i / count) * Math.PI)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = camber * 4 * x * (1 - x);
    half.push([x, yt, yc]);
  }
  const pts = [];
  for (let i = half.length - 1; i >= 0; i--) pts.push([-half[i][0], half[i][2] + half[i][1]]); // upper, TE -> LE
  for (let i = 1; i < half.length - 1; i++) pts.push([-half[i][0], half[i][2] - half[i][1]]); // lower, LE -> TE
  return pts;
}

// One wing half from the root (x = 0) out along +x. Leading edge at the root
// sits at z = 0; chords run toward -z. Tips are rounded off.
export function wingGeometry({ span, root, tip, sweep = 0, dihedral = 0, thick = 0.14, camber = 0.02, steps = 10 }) {
  const foil = airfoil(14, thick, camber);
  const P = foil.length;
  const positions = [];
  const indices = [];
  const sections = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    sections.push({ x: span * t, c: THREE.MathUtils.lerp(root, tip, t), th: 1 });
  }
  // Rounded tip: two short, thinner sections.
  const last = sections[sections.length - 1];
  sections.push({ x: span + tip * 0.06, c: tip * 0.9, th: 0.6, inset: tip * 0.04 });
  sections.push({ x: span + tip * 0.09, c: tip * 0.7, th: 0.2, inset: tip * 0.13 });
  for (const s of sections) {
    const t = Math.min(1, s.x / span);
    const le = -sweep * t - (s.inset ?? 0);
    const y = Math.tan(dihedral) * s.x;
    for (const [fz, fy] of foil) positions.push(s.x, y + fy * s.c * s.th, le + fz * s.c);
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < P; k++) {
      const a = i * P + k;
      const b = i * P + ((k + 1) % P);
      indices.push(a, a + P, b, b, a + P, b + P);
    }
  }
  const cap = (si, flip) => {
    const base = positions.length / 3;
    const off = si * P;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < P; k++) {
      cx += positions[(off + k) * 3];
      cy += positions[(off + k) * 3 + 1];
      cz += positions[(off + k) * 3 + 2];
    }
    positions.push(cx / P, cy / P, cz / P);
    for (let k = 0; k < P; k++) {
      const a = off + k;
      const b = off + ((k + 1) % P);
      if (flip) indices.push(base, b, a);
      else indices.push(base, a, b);
    }
  };
  cap(0, true);
  cap(sections.length - 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
