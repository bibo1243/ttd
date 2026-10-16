import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Track } from './track.js';
import { Train } from './train.js';
import { buildWorld } from './world.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f2);
scene.fog = new THREE.Fog(0xbfe3f2, 50, 130);
// Soft studio reflections give painted metal and glass a polished look.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(20, 16, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 3;
controls.maxDistance = 70;

// Lights
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a8f4e, 0.95));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -28;
sc.right = sc.top = 28;
sc.near = 1;
sc.far = 70;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 3;
scene.add(sun);

const v = (x, z) => new THREE.Vector3(x, 0, z);
const track = new Track([
  v(10, 0), v(10, 6), v(7, 10), v(1, 10), v(-3, 6), v(-7, 8), v(-11, 5),
  v(-12, -1), v(-9, -7), v(-3, -9), v(4, -10), v(9, -7), v(10, -4),
]);
scene.add(track.group);

const { clouds } = buildWorld(scene, track);
const train = new Train(track, scene, 4);
train.distance = 6;

// HUD
const $ = (id) => document.getElementById(id);
let running = true;
let follow = false;
let savedSpeed = train.speed;

const speedInput = $('speed');
const speedOut = $('speedOut');
const updateCount = () => ($('carCount').textContent = `${train.carCount} 節車廂`);
updateCount();

speedInput.addEventListener('input', () => {
  savedSpeed = parseFloat(speedInput.value);
  speedOut.textContent = savedSpeed.toFixed(1);
});
$('toggle').addEventListener('click', (e) => {
  running = !running;
  e.currentTarget.textContent = running ? '⏸ 暫停' : '▶ 出發';
});
$('camera').addEventListener('click', (e) => {
  follow = !follow;
  e.currentTarget.classList.toggle('on', follow);
  e.currentTarget.textContent = follow ? '🎥 自由視角' : '🎥 跟隨火車';
  if (follow) {
    const p = train.loco.group.position;
    camera.position.set(p.x + 6, p.y + 5, p.z + 6);
  }
});
$('addCar').addEventListener('click', () => {
  train.addCar();
  updateCount();
});
$('removeCar').addEventListener('click', () => {
  train.removeCar();
  updateCount();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const lastTarget = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  // Ease toward the target speed so starts and stops feel weighty.
  const target = running ? savedSpeed : 0;
  train.speed += (target - train.speed) * Math.min(1, dt * 1.5);
  if (Math.abs(train.speed) < 0.005) train.speed = 0;
  train.update(dt, time);

  if (follow) {
    lastTarget.copy(controls.target);
    controls.target.lerp(train.loco.group.position, Math.min(1, dt * 4));
    camera.position.add(controls.target.clone().sub(lastTarget));
  }

  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 45) c.position.x = -45;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.__game = { train, camera, controls };
