import * as THREE from 'three';

const GAUGE = 0.5; // distance between the two rails
const UP = new THREE.Vector3(0, 1, 0);

// A closed loop track. Distances along it are in world units.
export class Track {
  constructor(controlPoints) {
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = Math.max(2000, controlPoints.length * 8);
    this.length = this.curve.getLength();
    this.group = new THREE.Group();
    this.#build();
    // Points every ~0.1 units for nearest-point lookups.
    const n = Math.ceil(this.length / 0.1);
    this.samples = this.curve.getSpacedPoints(n).slice(0, n);
  }

  // Distance along the track of the point nearest to (x, z), and how far away it is.
  nearest(x, z) {
    let best = 0;
    let bestD = Infinity;
    this.samples.forEach((p, i) => {
      const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return { d: (best / this.samples.length) * this.length, dist: Math.sqrt(bestD) };
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }

  // Position on the track at distance d (wraps around).
  pointAt(d, target = new THREE.Vector3()) {
    const u = THREE.MathUtils.euclideanModulo(d, this.length) / this.length;
    return this.curve.getPointAt(u, target);
  }

  tangentAt(d, target = new THREE.Vector3()) {
    const u = THREE.MathUtils.euclideanModulo(d, this.length) / this.length;
    return this.curve.getTangentAt(u, target);
  }

  #offsetCurve(offset, y, samples) {
    const pts = [];
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < samples; i++) {
      const u = i / samples;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      side.crossVectors(t, UP).normalize();
      pts.push(p.clone().addScaledVector(side, offset).setY(p.y + y));
    }
    return new THREE.CatmullRomCurve3(pts, true);
  }

  #build() {
    const samples = Math.ceil(this.length * 6);

    // Gravel bed: a flat ribbon under the sleepers.
    const bedGeo = this.#ribbon(0.62, 0.02, samples);
    const bed = new THREE.Mesh(
      bedGeo,
      new THREE.MeshStandardMaterial({ color: 0xb7a99a, roughness: 1, flatShading: true }),
    );
    bed.receiveShadow = true;
    this.group.add(bed);

    // Sleepers
    const sleeperGap = 0.32;
    const count = Math.floor(this.length / sleeperGap);
    const sleeperGeo = new THREE.BoxGeometry(0.78, 0.06, 0.14);
    const sleepers = new THREE.InstancedMesh(
      sleeperGeo,
      new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.9 }),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const d = (i / count) * this.length;
      this.pointAt(d, p);
      this.tangentAt(d, t);
      q.setFromAxisAngle(UP, Math.atan2(t.x, t.z));
      p.y += 0.05;
      m.compose(p, q, s);
      sleepers.setMatrixAt(i, m);
    }
    sleepers.castShadow = true;
    sleepers.receiveShadow = true;
    this.group.add(sleepers);

    // Rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.7, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const c = this.#offsetCurve((side * GAUGE) / 2, 0.11, samples);
      const geo = new THREE.TubeGeometry(c, samples, 0.035, 6, true);
      const rail = new THREE.Mesh(geo, railMat);
      rail.castShadow = true;
      this.group.add(rail);
    }
  }

  #ribbon(width, y, samples) {
    const positions = [];
    const indices = [];
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      const u = (i % samples) / samples;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      side.crossVectors(t, UP).normalize().multiplyScalar(width / 2);
      positions.push(p.x - side.x, p.y + y, p.z - side.z, p.x + side.x, p.y + y, p.z + side.z);
      if (i < samples) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
}
