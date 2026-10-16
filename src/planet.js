import * as THREE from 'three';

// The island sits on a small planet: everything is drawn bending away
// below the horizon around the point the camera looks at, so the ground
// curves off like the top of a ball.
//
// The bend happens in the vertex shader (drop = distance² / 2R), patched
// into every built-in material, including shadow and depth passes, so
// game logic keeps working on a flat map. Long, straight meshes need
// enough vertices along their length to follow the curve.

const flat = new URLSearchParams(location.search).has('flat');

export const PLANET_RADIUS = 55;

// x, z: centre of the bend; y: 1 / (2R), or 0 for no bend. A plain object
// (not a Vector3) so every material's copy of the uniform shares it.
const curve = { x: 0, y: flat ? 0 : 1 / (2 * PLANET_RADIUS), z: 0 };

const BEND = /* glsl */ `
	vec2 planetD = planetW.xz - planetCurve.xz;
	planetW.y -= dot( planetD, planetD ) * planetCurve.y;
`;

let installed = false;

// Call once, before anything is rendered.
export function installPlanet() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.common += '\nuniform vec3 planetCurve;\n';
  C.project_vertex = C.project_vertex.replace(
    'mvPosition = modelViewMatrix * mvPosition;',
    `vec4 planetW = modelMatrix * mvPosition;${BEND}\tmvPosition = viewMatrix * planetW;`,
  );
  C.worldpos_vertex = C.worldpos_vertex.replace(
    'worldPosition = modelMatrix * worldPosition;',
    `worldPosition = modelMatrix * worldPosition;\n\t{ vec4 planetW = worldPosition;${BEND}\tworldPosition = planetW; }`,
  );
  // Sprites (labels, floating text) bend with their anchor point.
  const sprite = THREE.ShaderLib.sprite;
  sprite.vertexShader = sprite.vertexShader.replace(
    'vec4 mvPosition = modelViewMatrix[ 3 ];',
    `vec4 planetW = modelMatrix[ 3 ];${BEND}\tvec4 mvPosition = viewMatrix * planetW;`,
  );
  for (const [name, lib] of Object.entries(THREE.ShaderLib)) {
    if (/^background|^cube$|^equirect$/.test(name)) continue;
    lib.uniforms.planetCurve = { value: curve };
  }
}

// Keep the curve centred under the camera's focus.
export function setPlanetCentre(x, z) {
  curve.x = x;
  curve.z = z;
}

// How far below flat ground a point is drawn.
export function planetDrop(x, z) {
  return ((x - curve.x) ** 2 + (z - curve.z) ** 2) * curve.y;
}

// Where a ray meets the curved ground, as a point on the flat map (y = 0).
export function rayToGround(ray, target = new THREE.Vector3()) {
  const { origin: o, direction: d } = ray;
  const f = (t) => o.y + d.y * t + planetDrop(o.x + d.x * t, o.z + d.z * t);
  if (f(0) <= 0) return null;
  let lo = 0;
  let hi = 1;
  while (f(hi) > 0) {
    hi *= 2;
    if (hi > 4000) return null; // looking over the horizon
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return target.set(o.x + d.x * hi, 0, o.z + d.z * hi);
}

// Re-bend a picking ray: un-bent geometry is tested against a ray bent
// back by the drop at the point it hits the ground. Good enough near the
// focus, where the player clicks.
export function straightenRay(ray) {
  const g = rayToGround(ray);
  if (!g) return ray;
  const drop = planetDrop(g.x, g.z);
  ray.origin.y += drop;
  return ray;
}

// Cut a geometry's triangles at every `step` along x and z so a long, flat
// piece (a platform, a canopy) follows the curve instead of floating over
// it. Cuts fall on the same planes for neighbouring triangles, so no cracks.
export function sliceForPlanet(geo, step = 0.8) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = bb.max.x - bb.min.x > step * 1.5;
  const sz = bb.max.z - bb.min.z > step * 1.5;
  if (!sx && !sz) return geo;
  const src = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(src.attributes);
  const attrs = names.map((n) => src.attributes[n]);
  // A vertex is an array of all its attribute components.
  const read = (i) => attrs.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
  const lerp = (a, b, t) => a.map((arr, j) => arr.map((v, k) => v + (b[j][k] - v) * t));
  let tris = [];
  const groupOf = (i) => (geo.groups.length > 1 ? geo.groups.findIndex((g) => i >= g.start && i < g.start + g.count) : 0);
  for (let i = 0; i < src.attributes.position.count; i += 3) {
    const t = [read(i), read(i + 1), read(i + 2)];
    t.g = groupOf(i);
    tris.push(t);
  }
  const pos = names.indexOf('position');
  const cut = (axis, lo, hi) => {
    const first = Math.ceil(lo / step) * step;
    for (let c = first; c < hi; c += step) {
      const out = [];
      for (const t of tris) {
        const d = t.map((v) => v[pos][axis] - c);
        const above = d.map((x) => x > 1e-6);
        const below = d.map((x) => x < -1e-6);
        const na = above.filter(Boolean).length;
        const nb = below.filter(Boolean).length;
        if (!na || !nb) {
          out.push(t);
          continue;
        }
        // Split the polygon along the plane, keeping winding.
        const sideA = [];
        const sideB = [];
        for (let k = 0; k < 3; k++) {
          const p = t[k];
          const q = t[(k + 1) % 3];
          const dp = d[k];
          const dq = d[(k + 1) % 3];
          if (dp >= -1e-6) sideA.push(p);
          if (dp <= 1e-6) sideB.push(p);
          if ((dp > 1e-6 && dq < -1e-6) || (dp < -1e-6 && dq > 1e-6)) {
            const m = lerp(p, q, dp / (dp - dq));
            sideA.push(m);
            sideB.push(m);
          }
        }
        for (const poly of [sideA, sideB]) {
          for (let k = 1; k + 1 < poly.length; k++) {
            const n = [poly[0], poly[k], poly[k + 1]];
            n.g = t.g;
            out.push(n);
          }
        }
      }
      tris = out;
    }
  };
  if (sx) cut(0, bb.min.x, bb.max.x);
  if (sz) cut(2, bb.min.z, bb.max.z);
  tris.sort((a, b) => a.g - b.g);
  const out = new THREE.BufferGeometry();
  names.forEach((n, j) => {
    const size = attrs[j].itemSize;
    const arr = new Float32Array(tris.length * 3 * size);
    let o = 0;
    for (const t of tris) for (const v of t) for (const x of v[j]) arr[o++] = x;
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  });
  if (geo.groups.length > 1) {
    let start = 0;
    geo.groups.forEach((g, gi) => {
      const count = tris.filter((t) => t.g === gi).length * 3;
      out.addGroup(start, count, g.materialIndex);
      start += count;
    });
  }
  return out;
}
