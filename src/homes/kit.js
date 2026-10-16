import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Collects the many small pieces of a house (walls, trims, furniture...) and
// merges them into one mesh per material, so a fully furnished home costs a
// few draw calls instead of hundreds.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export const trs = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));

export class Kit {
  constructor() {
    this.byMat = new Map();
    this.frame = new THREE.Matrix4(); // pieces are placed relative to this
  }

  // Place pieces relative to `m` until the callback returns.
  within(m, fn) {
    const prev = this.frame;
    this.frame = prev.clone().multiply(m);
    fn();
    this.frame = prev;
  }

  // geo is shared and never modified; rx/ry/rz in radians; s may be a number.
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    this.addMatrix(geo, mat, trs(x, y, z, rx, ry, rz, sx, sy, sz));
  }

  addMatrix(geo, mat, m) {
    let list = this.byMat.get(mat);
    if (!list) this.byMat.set(mat, (list = []));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m.multiplyMatrices(this.frame, m));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.clearGroups();
    list.push(g);
  }

  // One mesh per material, added to `group`.
  build(group) {
    for (const [mat, list] of this.byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      const glassy = mat.transparent || mat.userData.noShadow;
      mesh.castShadow = !glassy;
      mesh.receiveShadow = !mat.transparent;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.byMat.clear();
    return group;
  }
}
