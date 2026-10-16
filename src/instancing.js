import * as THREE from 'three';

// Draws many copies of small static props (trees, houses, rocks...) cheaply.
//
// Each prop is made of "parts" (a geometry + material). Instead of one mesh
// per part, every part type becomes one InstancedMesh per map chunk, so a
// forest of thousands of trees costs a handful of draw calls. Chunks are
// culled when off screen, and each chunk is a THREE.LOD that switches to
// lighter geometry in the distance and disappears past the fog.
//
//   const scatter = new Scatter();
//   const trunk = scatter.part(trunkGeo, barkMat, { low: trunkLowGeo });
//   scatter.add(trunk, matrix, color);
//   scene.add(scatter.build());
export class Scatter {
  constructor({ chunkSize = 20, lodDistance = 60, hideDistance = 145 } = {}) {
    this.chunkSize = chunkSize;
    this.lodDistance = lodDistance;
    this.hideDistance = hideDistance;
    this.parts = [];
    this.chunks = new Map();
    this.props = []; // {x, z, removed} per prop, so whole props can be removed later
    this.meshes = []; // {mesh, props: prop index per instance}
    this.prop = -1;
  }

  // Start a new prop (a tree, a house...) rooted at x, z. Parts added until
  // the next beginProp belong to it and are removed together.
  beginProp(x, z) {
    this.prop = this.props.push({ x, z, removed: false }) - 1;
  }

  // low: geometry used far away (defaults to the same one); null drops the
  // part entirely at that range.
  part(geometry, material, { low = geometry, castShadow = true, receiveShadow = true } = {}) {
    const p = { id: this.parts.length, geometry, low, material, castShadow, receiveShadow };
    this.parts.push(p);
    return p;
  }

  // matrix: the part's world transform. color: optional per-instance tint
  // (multiplies the material colour, so leave the material white).
  add(part, matrix, color) {
    const e = matrix.elements;
    const cx = Math.floor(e[12] / this.chunkSize);
    const cz = Math.floor(e[14] / this.chunkSize);
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = { cx, cz, items: new Map() };
      this.chunks.set(key, chunk);
    }
    let list = chunk.items.get(part.id);
    if (!list) chunk.items.set(part.id, (list = []));
    list.push(matrix.clone(), color === undefined ? null : new THREE.Color(color), this.prop);
  }

  build() {
    const root = new THREE.Group();
    root.name = 'scatter';
    const local = new THREE.Matrix4();
    for (const chunk of this.chunks.values()) {
      const s = this.chunkSize;
      const center = new THREE.Vector3((chunk.cx + 0.5) * s, 0, (chunk.cz + 0.5) * s);
      const toLocal = new THREE.Matrix4().makeTranslation(-center.x, 0, -center.z);
      const lod = new THREE.LOD();
      lod.position.copy(center);
      const near = new THREE.Group();
      const far = new THREE.Group();
      for (const [id, list] of chunk.items) {
        const part = this.parts[id];
        for (const [group, geo] of [[near, part.geometry], [far, part.low]]) {
          if (!geo) continue;
          const count = list.length / 3;
          const mesh = new THREE.InstancedMesh(geo, part.material, count);
          const props = [];
          for (let i = 0; i < count; i++) {
            mesh.setMatrixAt(i, local.multiplyMatrices(toLocal, list[i * 3]));
            const c = list[i * 3 + 1];
            if (c) mesh.setColorAt(i, c);
            props.push(list[i * 3 + 2]);
          }
          this.meshes.push({ mesh, props });
          mesh.castShadow = part.castShadow;
          mesh.receiveShadow = part.receiveShadow;
          mesh.computeBoundingSphere();
          group.add(mesh);
        }
      }
      // Distances are measured to the chunk centre, which sits up to half a
      // chunk diagonal away from its nearest prop.
      lod.addLevel(near, 0);
      lod.addLevel(far, this.lodDistance, 0.08);
      lod.addLevel(new THREE.Object3D(), this.hideDistance, 0.05);
      root.add(lod);
    }
    return root;
  }

  // Remove every prop rooted within r of (x, z), e.g. to clear the ground for
  // newly built track. Returns how many props were removed.
  removeNear(x, z, r) {
    const hit = new Set();
    this.props.forEach((p, i) => {
      if (!p.removed && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) {
        p.removed = true;
        hit.add(i);
      }
    });
    if (!hit.size) return 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { mesh, props } of this.meshes) {
      let changed = false;
      props.forEach((p, i) => {
        if (hit.has(p)) {
          mesh.setMatrixAt(i, zero);
          changed = true;
        }
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
    return hit.size;
  }
}
