import * as THREE from 'three';
import { sliceForPlanet } from '../planet.js';

// The world is drawn bent over a small planet in the vertex shader
// (planet.js), so a big flat triangle stays a flat chord while the ground
// round it curves away: runways and aprons would lift off or the sea would
// show through. Every mesh that spans more than `span` across the ground is
// sliced on one shared grid in the root's frame, so neighbouring pieces
// get the same cuts and no cracks open between them.
export function bendable(root, { span = 1.5, step = 0.8 } = {}) {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const toRoot = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    box.setFromObject(o).getSize(size);
    if (Math.max(size.x, size.z) > span) meshes.push(o);
  });
  for (const o of meshes) {
    toRoot.multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.clone().applyMatrix4(toRoot);
    const sliced = sliceForPlanet(g, step);
    if (sliced === g) continue;
    sliced.applyMatrix4(toRoot.clone().invert());
    sliced.computeBoundingSphere();
    o.geometry = sliced;
  }
}
