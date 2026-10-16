import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Track } from './track.js';
import { Train, TRAIN_TYPES } from './train.js';
import { buildWorld } from './world.js';
import { PassengerSystem, createStations } from './stations.js';
import { params, setupPerf } from './perf.js';

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
  v(10, -5), v(10, 0), v(10, 5), v(8.4, 9.2), v(5, 10.6), v(0, 10.6), v(-4.5, 10.6),
  v(-7.5, 9), v(-10.5, 7), v(-12.5, 1), v(-11, -5.5), v(-7.5, -9.4),
  v(-4.5, -10.5), v(0.5, -10.5), v(5.5, -10.5), v(8.8, -8.8),
]);
scene.add(track.group);

const stations = createStations(scene, track);
const { clouds, obstacles } = buildWorld(scene, track, stations, { stress: params.has('stress') });
if (params.has('stress')) controls.maxDistance = 160;
const train = new Train(track, scene, 'steam');
train.distance = 6;
const passengers = new PassengerSystem(scene, track, train, stations, obstacles);

// HUD
const $ = (id) => document.getElementById(id);
let running = true;
let follow = false;
let savedSpeed = train.speed;

const speedInput = $('speed');
const speedOut = $('speedOut');
const updateCount = () => ($('carCount').textContent = `共 ${train.carCount} 節`);
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
    const p = train.lead.group.position;
    camera.position.set(p.x + 6, p.y + 5, p.z + 6);
  }
});
const typeBar = $('types');
for (const [key, t] of Object.entries(TRAIN_TYPES)) {
  const btn = document.createElement('button');
  btn.textContent = t.label;
  btn.dataset.type = key;
  btn.classList.toggle('on', key === train.type);
  btn.addEventListener('click', () => {
    train.setType(key);
    passengers.reseat();
    for (const b of typeBar.children) b.classList.toggle('on', b.dataset.type === key);
    updateCount();
  });
  typeBar.appendChild(btn);
}
$('addCar').addEventListener('click', () => {
  train.addCar();
  updateCount();
  passengers.reseat();
});
$('removeCar').addEventListener('click', () => {
  train.removeCar();
  updateCount();
  passengers.reseat();
});

// Collapsible dashboard; remembered per browser.
const hud = $('hud');
const setCollapsed = (on) => {
  hud.classList.toggle('collapsed', on);
  $('collapse').setAttribute('aria-expanded', String(!on));
  $('collapse').title = on ? '展開面板 (H)' : '收合面板 (H)';
  try {
    localStorage.setItem('hudCollapsed', on ? '1' : '0');
  } catch {}
};
try {
  setCollapsed(localStorage.getItem('hudCollapsed') === '1');
} catch {}
$('collapse').addEventListener('click', () => setCollapsed(!hud.classList.contains('collapsed')));
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') setCollapsed(!hud.classList.contains('collapsed'));
});

// Earnings panel. Money counts up smoothly toward the real total.
let shownMoney = 0;
const renderStats = () => {
  $('riders').textContent = `${passengers.onboard.length} / ${passengers.capacity}`;
  $('delivered').textContent = passengers.delivered;
  $('residents').textContent = passengers.residents;
  $('status').textContent = passengers.statusText;
};
passengers.onChange(renderStats);
renderStats();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const perf = setupPerf(renderer);
const clock = new THREE.Clock();
const lastTarget = new THREE.Vector3();

function simulate(dt, time) {
  // Ease toward the target speed so starts and stops feel weighty.
  const target = running ? savedSpeed * train.config.speedScale : 0;
  train.speed += (target - train.speed) * Math.min(1, dt * 1.5);
  if (Math.abs(train.speed) < 0.005) train.speed = 0;
  passengers.control(dt);
  train.update(dt, time);
  passengers.update(dt, time);
  if (shownMoney !== passengers.money) {
    shownMoney += Math.max(1, Math.ceil((passengers.money - shownMoney) * dt * 6));
    shownMoney = Math.min(shownMoney, passengers.money);
    $('money').textContent = $('miniMoney').textContent = `$${shownMoney.toLocaleString()}`;
  }
}

let simTime = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simTime += dt;
  const time = simTime;
  simulate(dt, time);

  if (follow) {
    lastTarget.copy(controls.target);
    controls.target.lerp(train.lead.group.position, Math.min(1, dt * 4));
    camera.position.add(controls.target.clone().sub(lastTarget));
  }

  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 45) c.position.x = -45;
  }

  controls.update();
  renderer.render(scene, camera);
  perf.frame();
  requestAnimationFrame(tick);
}
tick();

// Debug hook: run the game logic forward without rendering.
const fastForward = (seconds) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    simTime += 1 / 30;
    simulate(1 / 30, simTime);
  }
};
window.__game = { train, camera, controls, passengers, stations, fastForward };
window.__perf = { ...perf, bench: (n) => perf.bench(() => renderer.render(scene, camera), n) };
