import * as THREE from 'three';

// Draws many small, individually animated parts (robot bodies, hats,
// luggage...) with a few BatchedMeshes instead of one draw call per part.
//
// Model code builds its hierarchy as usual, but uses BatchedPart where it
// would use THREE.Mesh. A BatchedPart is an invisible Object3D carrying a
// geometry and material; every frame the batcher copies each part's world
// matrix, visibility and colour into a shared BatchedMesh. Parts are grouped
// by material settings (colour is per instance), shadow casting and
// handedness, so moving, hiding, re-parenting, mirroring or swapping a
// part's material all keep working.

const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const _m = new THREE.Matrix4();
const _white = new THREE.Color(0xffffff);

const matKeys = new WeakMap();
function materialKey(m) {
  let k = matKeys.get(m);
  if (!k) {
    k = [
      m.type, m.roughness, m.metalness, m.clearcoat, m.emissive?.getHex(), m.emissiveIntensity,
      m.side, m.transparent, m.opacity, m.flatShading,
    ].join('|');
    matKeys.set(m, k);
  }
  return k;
}

// Identical shapes built separately (e.g. every robot's own hat brim) share
// one entry in the batch.
const geoCanon = new Map();
const geoMap = new WeakMap();
function canonicalGeometry(g) {
  let c = geoMap.get(g);
  if (c) return c;
  const pos = g.attributes.position;
  let sum = 0;
  for (let i = 0; i < pos.array.length; i += 7) sum += pos.array[i] * ((i % 13) + 1);
  const key = `${g.type}|${JSON.stringify(g.parameters ?? {})}|${pos.count}|${sum.toFixed(5)}`;
  c = geoCanon.get(key);
  if (!c) {
    c = g.index ? g : g.setIndex([...Array(pos.count).keys()]);
    geoCanon.set(key, c);
  }
  geoMap.set(g, c);
  return c;
}

export class BatchedPart extends THREE.Object3D {
  constructor(geometry, material) {
    super();
    this.isBatchedPart = true;
    this.geometry = geometry;
    this.material = material;
    this.slot = null; // {batch, id, key, material}
    batcher.parts.push(this);
  }
}

class Batch {
  constructor(key, material, castShadow, mirrored) {
    this.key = key;
    const m = material.clone();
    m.color?.copy(_white);
    this.mesh = new THREE.BatchedMesh(8192, 40000, 120000, m);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = false;
    this.mesh.sortObjects = material.transparent;
    this.mesh.frustumCulled = false; // contents move; culled per part instead
    // A mirrored batch flips its own handedness so the renderer reverses
    // face winding; instance matrices are pre-multiplied to cancel it.
    if (mirrored) this.mesh.scale.x = -1;
    this.mirrored = mirrored;
    this.geometryIds = new Map();
    this.full = false;
  }

  add(geometry) {
    let gid = this.geometryIds.get(geometry);
    if (gid === undefined) {
      try {
        gid = this.mesh.addGeometry(geometry);
      } catch {
        this.full = true;
        return null;
      }
      this.geometryIds.set(geometry, gid);
    }
    try {
      return this.mesh.addInstance(gid);
    } catch {
      this.full = true;
      return null;
    }
  }
}

class Batcher {
  constructor() {
    this.parts = [];
    this.batches = new Map(); // key -> [Batch]
    this.root = new THREE.Group();
    this.root.name = 'batched-parts';
    this.scene = null;
  }

  install(scene) {
    this.scene = scene;
    scene.add(this.root);
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      prev.apply(scene, args);
      this.sync();
    };
  }

  #place(part, key, castShadow, mirrored) {
    let list = this.batches.get(key);
    if (!list) this.batches.set(key, (list = []));
    const geometry = canonicalGeometry(part.geometry);
    for (const batch of list) {
      if (batch.full) continue;
      const id = batch.add(geometry);
      if (id !== null) return { batch, id, key };
    }
    const batch = new Batch(key, part.material, castShadow, mirrored);
    this.root.add(batch.mesh);
    batch.mesh.updateMatrixWorld();
    list.push(batch);
    return { batch, id: batch.add(geometry), key };
  }

  // A part is drawn when it and all its ancestors are visible and it hangs
  // off the scene.
  #shown(part) {
    let o = part;
    while (o) {
      if (!o.visible) return false;
      if (o === this.scene) return true;
      o = o.parent;
    }
    return false;
  }

  sync() {
    for (const part of this.parts) {
      const shown = this.#shown(part);
      let slot = part.slot;
      if (!shown) {
        if (slot?.visible) {
          slot.batch.mesh.setVisibleAt(slot.id, false);
          slot.visible = false;
        }
        continue;
      }
      const mirrored = part.matrixWorld.determinant() < 0;
      const key = `${materialKey(part.material)}|${part.castShadow ? 1 : 0}|${mirrored ? 1 : 0}`;
      if (!slot || slot.key !== key) {
        if (slot) slot.batch.mesh.deleteInstance(slot.id);
        slot = part.slot = this.#place(part, key, part.castShadow, mirrored);
        slot.visible = true;
        slot.material = null;
      }
      const mesh = slot.batch.mesh;
      if (!slot.visible) {
        mesh.setVisibleAt(slot.id, true);
        slot.visible = true;
      }
      if (slot.material !== part.material) {
        mesh.setColorAt(slot.id, part.material.color ?? _white);
        slot.material = part.material;
      }
      mesh.setMatrixAt(slot.id, mirrored ? _m.multiplyMatrices(MIRROR, part.matrixWorld) : part.matrixWorld);
    }
  }
}

export const batcher = new Batcher();
