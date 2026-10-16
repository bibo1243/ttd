import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });

// Deterministic random so the map looks the same every load.
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function shadowed(o) {
  o.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function makeTree(rand) {
  const g = new THREE.Group();
  const h = 0.5 + rand() * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 6), flat(0x8b5a3c));
  trunk.position.y = h / 2;
  g.add(trunk);
  const greens = [0x5fae5a, 0x4c9a52, 0x78c06a, 0x3f8a4f];
  const color = greens[Math.floor(rand() * greens.length)];
  if (rand() < 0.5) {
    // Pine: stacked cones
    for (let i = 0; i < 3; i++) {
      const r = 0.42 - i * 0.1;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 7), flat(color));
      cone.position.y = h + 0.1 + i * 0.28;
      g.add(cone);
    }
  } else {
    // Round tree
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38 + rand() * 0.15, 0), flat(color));
    ball.position.y = h + 0.25;
    g.add(ball);
  }
  g.rotation.y = rand() * Math.PI * 2;
  g.scale.setScalar(0.8 + rand() * 0.6);
  return shadowed(g);
}

function makeHouse(rand) {
  const g = new THREE.Group();
  const walls = [0xf6e7cf, 0xfbd5c0, 0xdbe8f4, 0xf4f0d2];
  const roofs = [0xd65a4a, 0x4e7fb8, 0x6b4e3d, 0x3f8a6b];
  const w = 0.8 + rand() * 0.5;
  const d = 0.8 + rand() * 0.4;
  const h = 0.6 + rand() * 0.3;
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.04), flat(walls[Math.floor(rand() * walls.length)]));
  body.position.y = h / 2;
  g.add(body);
  const roofGeo = new THREE.CylinderGeometry(0.01, 1, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.scale(w * 0.78, 0.45, d * 0.78);
  const roof = new THREE.Mesh(roofGeo, flat(roofs[Math.floor(rand() * roofs.length)]));
  roof.position.y = h + 0.22;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.02), flat(0x6b4e3d));
  door.position.set(0, 0.15, d / 2 + 0.01);
  g.add(door);
  const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.2 });
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.02), winMat);
    win.position.set(side * w * 0.28, h * 0.6, d / 2 + 0.01);
    g.add(win);
  }
  g.rotation.y = rand() * Math.PI * 2;
  return shadowed(g);
}

function makeCloud(rand) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + rand() * 0.6, 1), m);
    s.position.set(i * 0.9 - n * 0.45, rand() * 0.4, (rand() - 0.5) * 0.8);
    g.add(s);
  }
  g.castShadow = true;
  return g;
}

export function buildWorld(scene, track, stations = []) {
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

  const placeAt = (radiusMax, clearance, make, tries) => {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radiusMax;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (nearTrack(x, z, clearance) || isStation(x, z)) continue;
      const o = make(rand);
      o.position.set(x, 0, z);
      scene.add(o);
    }
  };
  placeAt(16, 2.4, makeHouse, 14);
  placeAt(23, 1.3, makeTree, 140);

  // Rocks
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 19;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearTrack(x, z, 1.0) || isStation(x, z)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + rand() * 0.2, 0), flat(0xa7a9ac));
    rock.position.set(x, 0.05, z);
    rock.rotation.set(rand(), rand(), rand());
    rock.castShadow = true;
    scene.add(rock);
  }

  // Clouds drift slowly; return them so main can animate.
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = makeCloud(rand);
    c.position.set((rand() - 0.5) * 70, 20 + rand() * 5, -15 - rand() * 30);
    c.scale.setScalar(1.4 + rand() * 0.8);
    c.userData.speed = 0.3 + rand() * 0.4;
    scene.add(c);
    clouds.push(c);
  }
  return { clouds };
}
