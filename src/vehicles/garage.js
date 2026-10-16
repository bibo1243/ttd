import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VEHICLE_MODELS, buildVehicle } from './models.js';
import { animateRiders, crewVehicle } from './crew.js';
import { batcher } from '../batching.js';

// A showroom for checking vehicle models up close: garage.html (dev only).

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f2);
batcher.install(scene);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a8f4e, 0.95));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 60 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.85 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(3, 2.2, 4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.3, 0);

const shown = [];
let x = -((Object.keys(VEHICLE_MODELS).length - 1) * 1.2) / 2;
for (const key of Object.keys(VEHICLE_MODELS)) {
  const v = buildVehicle(key);
  v.group.position.set(x, 0, 0);
  v.group.rotation.y = 0.6;
  scene.add(v.group);
  crewVehicle(v, { passengers: v.seats.length });
  shown.push(v);
  x += key === 'bus' ? 1.8 : 1.2;
}

const clock = new THREE.Clock();
let t = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  for (const v of shown) animateRiders(v, dt, t, 0);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
window.__garage = { camera, controls, shown, scene, THREE, renderer };
