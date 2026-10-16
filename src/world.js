import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Scatter } from './instancing.js';

const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });

// Deterministic random so the map looks the same every load.
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// Scenery props are drawn through a Scatter (see instancing.js): each part
// shape below is shared by every prop, sized and tinted per instance.
const WHITE = 0xffffff;
const translated = (geo, y) => geo.translate(0, y, 0);
const pineCrown = (segments) =>
  mergeGeometries(
    [0, 1, 2].map((i) => new THREE.ConeGeometry(0.42 - i * 0.1, 0.5, segments).translate(0, 0.1 + i * 0.28, 0)),
  );

function sceneryParts(scatter) {
  const roof = (segments) => new THREE.CylinderGeometry(0.01, 1, 1, segments, 1).rotateY(Math.PI / 4);
  const bark = flat(0x8b5a3c);
  const leaves = flat(WHITE);
  const walls = flat(WHITE);
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.2 });
  return {
    trunk: scatter.part(translated(new THREE.CylinderGeometry(0.06, 0.08, 1, 6), 0.5), bark, {
      low: translated(new THREE.CylinderGeometry(0.06, 0.08, 1, 4), 0.5),
    }),
    pine: scatter.part(pineCrown(7), leaves, { low: pineCrown(5) }),
    ball: scatter.part(new THREE.IcosahedronGeometry(1, 0), leaves),
    body: scatter.part(translated(new RoundedBoxGeometry(1, 1, 1, 2, 0.04), 0.5), walls, {
      low: translated(new THREE.BoxGeometry(1, 1, 1), 0.5),
    }),
    roof: scatter.part(roof(4), walls),
    door: scatter.part(new THREE.BoxGeometry(0.18, 0.3, 0.02), flat(0x6b4e3d)),
    window: scatter.part(new THREE.BoxGeometry(0.16, 0.14, 0.02), glass),
    rock: scatter.part(new THREE.DodecahedronGeometry(1, 0), flat(0xa7a9ac), { receiveShadow: false }),
  };
}

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Emit one part: root transform * local offset/scale.
function put(scatter, part, root, x, y, z, sx = 1, sy = 1, sz = 1, color) {
  _local.compose(_p.set(x, y, z), _q.identity(), _s.set(sx, sy, sz));
  scatter.add(part, _m.multiplyMatrices(root, _local), color);
}

function makeTree(rand, scatter, P, x, z) {
  scatter.beginProp(x, z);
  const h = 0.5 + rand() * 0.5;
  const greens = [0x5fae5a, 0x4c9a52, 0x78c06a, 0x3f8a4f];
  const color = greens[Math.floor(rand() * greens.length)];
  const pine = rand() < 0.5;
  const radius = pine ? 0 : 0.38 + rand() * 0.15;
  const rotation = rand() * Math.PI * 2;
  const scale = 0.8 + rand() * 0.6;
  const root = new THREE.Matrix4().compose(
    _p.set(x, 0, z),
    _q.setFromAxisAngle(UP, rotation),
    _s.setScalar(scale),
  );
  put(scatter, P.trunk, root, 0, 0, 0, 1, h, 1);
  if (pine) put(scatter, P.pine, root, 0, h, 0, 1, 1, 1, color);
  else put(scatter, P.ball, root, 0, h + 0.25, 0, radius, radius, radius, color);
}

function makeHouse(rand, scatter, P, x, z) {
  scatter.beginProp(x, z);
  const walls = [0xf6e7cf, 0xfbd5c0, 0xdbe8f4, 0xf4f0d2];
  const roofs = [0xd65a4a, 0x4e7fb8, 0x6b4e3d, 0x3f8a6b];
  const w = 0.8 + rand() * 0.5;
  const d = 0.8 + rand() * 0.4;
  const h = 0.6 + rand() * 0.3;
  const wall = walls[Math.floor(rand() * walls.length)];
  const roof = roofs[Math.floor(rand() * roofs.length)];
  const root = new THREE.Matrix4().compose(
    _p.set(x, 0, z),
    _q.setFromAxisAngle(UP, rand() * Math.PI * 2),
    _s.setScalar(1),
  );
  put(scatter, P.body, root, 0, 0, 0, w, h, d, wall);
  put(scatter, P.roof, root, 0, h + 0.22, 0, w * 0.78, 0.45, d * 0.78, roof);
  put(scatter, P.door, root, 0, 0.15, d / 2 + 0.01);
  for (const side of [-1, 1]) put(scatter, P.window, root, side * w * 0.28, h * 0.6, d / 2 + 0.01);
}

function makeRock(rand, scatter, P, x, z) {
  scatter.beginProp(x, z);
  const r = 0.15 + rand() * 0.2;
  const root = new THREE.Matrix4().compose(
    _p.set(x, 0.05, z),
    _q.setFromEuler(_e.set(rand(), rand(), rand())),
    _s.setScalar(r),
  );
  scatter.add(P.rock, root);
}

// Clouds move, so they get one InstancedMesh whose puffs follow a light
// anchor object per cloud; main.js just moves the anchors.
function makeClouds(rand, scene, count) {
  const clouds = [];
  const puffs = [];
  for (let c = 0; c < count; c++) {
    const anchor = new THREE.Object3D();
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const r = 0.8 + rand() * 0.6;
      const y = rand() * 0.4;
      const z = (rand() - 0.5) * 0.8;
      puffs.push({ anchor, local: new THREE.Matrix4().compose(_p.set(i * 0.9 - n * 0.45, y, z), _q.identity(), _s.setScalar(r)) });
    }
    anchor.position.set((rand() - 0.5) * 70, 20 + rand() * 5, -15 - rand() * 30);
    anchor.scale.setScalar(1.4 + rand() * 0.8);
    anchor.userData.speed = 0.3 + rand() * 0.4;
    scene.add(anchor);
    clouds.push(anchor);
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    puffs.length,
  );
  mesh.frustumCulled = false; // puffs drift; bounds would go stale
  mesh.onBeforeRender = () => {
    puffs.forEach((p, i) => mesh.setMatrixAt(i, _m.multiplyMatrices(p.anchor.matrixWorld, p.local)));
    mesh.instanceMatrix.needsUpdate = true;
  };
  scene.add(mesh);
  return clouds;
}

export function buildWorld(scene, track, stations = [], opts = {}) {
  const rand = rng(20261016);

  // Island
  const islandGeo = new THREE.CylinderGeometry(24, 25.5, 1.2, 48, 1);
  const island = new THREE.Mesh(islandGeo, flat(0x8fcf6e));
  island.position.y = -0.6;
  island.receiveShadow = true;
  scene.add(island);
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(25.5, 26.5, 1.2, 48, 1, true), flat(0xc9a77a));
  cliff.position.y = -1.6;
  scene.add(cliff);

  // Water
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(200, 64),
    new THREE.MeshStandardMaterial({ color: 0x6cc3e0, roughness: 0.25, metalness: 0.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.4;
  water.receiveShadow = true;
  scene.add(water);

  // Keep scenery off the rails.
  const trackPts = track.curve.getSpacedPoints(400);
  const nearTrack = (x, z, r) => trackPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);

  const isStation = (x, z) => stations.some((s) => s.contains(x, z, 1.2));

  const obstacles = [];
  const scatter = new Scatter();
  const P = sceneryParts(scatter);
  const placeAt = (radiusMax, clearance, make, tries, footprint) => {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radiusMax;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (nearTrack(x, z, clearance) || isStation(x, z)) continue;
      make(rand, scatter, P, x, z);
      obstacles.push({ x, z, r: footprint });
    }
  };
  placeAt(16, 2.4, makeHouse, 14, 1.0);
  placeAt(23, 1.3, makeTree, 140, 0.45);

  // Rocks
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 19;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearTrack(x, z, 1.0) || isStation(x, z)) continue;
    makeRock(rand, scatter, P, x, z);
  }

  if (opts.stress) buildStressLands(scene, rand, scatter, P);
  scene.add(scatter.build());

  // Clouds drift slowly; return them so main can animate.
  const clouds = makeClouds(rand, scene, 9);
  // Clears trees, houses and rocks from ground the player builds on.
  const clearArea = (x, z, r) => {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r) obstacles.splice(i, 1);
    }
    return scatter.removeNear(x, z, r);
  };
  return { clouds, obstacles, clearArea };
}

// A big mainland around the island, packed with scenery. Only used with
// ?stress to measure how the renderer copes with large maps.
function buildStressLands(scene, rand, scatter, P) {
  const ground = new THREE.Mesh(new THREE.RingGeometry(26, 112, 96, 1), flat(0x8fcf6e));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const ringPos = (min, max) => {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(min * min + rand() * (max * max - min * min));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < 6000; i++) makeTree(rand, scatter, P, ...ringPos(28, 108));
  // Villages: houses clustered around a few centres.
  for (let v = 0; v < 40; v++) {
    const [cx, cz] = ringPos(34, 100);
    for (let i = 0; i < 20; i++) {
      makeHouse(rand, scatter, P, cx + (rand() - 0.5) * 9, cz + (rand() - 0.5) * 9);
    }
  }
  for (let i = 0; i < 1000; i++) makeRock(rand, scatter, P, ...ringPos(28, 108));
}
