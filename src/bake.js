import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BatchedPart } from './batching.js';

// Merge a model's static parts into one mesh per material, so a detailed
// station or train car costs a handful of draw calls instead of hundreds.
//
// Parts are merged into the nearest `anchors` ancestor (an object that
// moves as a whole, e.g. a car body that bounces). Anything in `keep`, and
// everything under it, is left alone: wheels that turn, doors that slide,
// objects code holds on to. Meshes with children, multi-materials, skinned
// or instanced meshes, and meshes marked userData.keep are never merged.
export function bakeStatic(root, { anchors = [root], keep = [], batchKept = false } = {}) {
  root.updateMatrixWorld(true);
  const anchorSet = new Set(anchors);
  const keepSet = new Set(keep.filter(Boolean));
  const buckets = new Map();
  const visit = (o, anchor) => {
    if (keepSet.has(o)) {
      if (batchKept) toBatched(o);
      return;
    }
    if (anchorSet.has(o)) anchor = o;
    for (const c of [...o.children]) visit(c, anchor);
    if (
      !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh ||
      o.children.length || Array.isArray(o.material) || o.userData.keep || o.userData.own || o.morphTargetInfluences || !o.visible
    ) {
      return;
    }
    const g = o.geometry;
    const sig = Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : ':n');
    const key = `${anchor.uuid}|${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${sig}`;
    if (!buckets.has(key)) buckets.set(key, { anchor, material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder, parts: [] });
    buckets.get(key).parts.push(o);
  };
  visit(root, root);

  const inv = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  let removed = 0;
  for (const b of buckets.values()) {
    if (b.parts.length < 2) continue;
    inv.copy(b.anchor.matrixWorld).invert();
    const geos = b.parts.map((o) => {
      const geo = o.geometry.clone();
      for (const name of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[name];
      geo.groups = [];
      geo.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
      return geo;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = b.receiveShadow;
    mesh.renderOrder = b.renderOrder;
    mesh.userData.baked = true;
    b.anchor.add(mesh);
    // The originals were never drawn, so they hold no GPU memory.
    for (const o of b.parts) o.removeFromParent();
    removed += b.parts.length - 1;
  }
  return removed;
}

// Moving parts (wheels, doors) can't be merged, but they can still be drawn
// in shared batches with every other car's: swap their meshes for
// BatchedParts (see batching.js), which follow the same transforms.
export function toBatched(root) {
  const swap = [];
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !o.material.transparent && !o.material.map && !o.children.length) swap.push(o);
  });
  for (const o of swap) {
    if (o === root) continue; // the held object itself stays (code points at it)
    const part = new BatchedPart(o.geometry, o.material);
    part.position.copy(o.position);
    part.quaternion.copy(o.quaternion);
    part.scale.copy(o.scale);
    part.castShadow = o.castShadow;
    part.visible = o.visible;
    part.name = o.name;
    o.parent.add(part);
    o.removeFromParent();
  }
}

// Objects a model's code holds on to (properties, arrays, {obj}/{panel}
// records): those keep moving, so they must not be merged away.
export function heldObjects(model, skip = []) {
  const out = [];
  const skipSet = new Set(skip);
  const add = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.isObject3D) {
      if (!skipSet.has(v)) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) add(x);
      return;
    }
    if (v.constructor === Object) for (const x of Object.values(v)) if (x?.isObject3D) add(x);
  };
  for (const v of Object.values(model)) add(v);
  return out;
}
