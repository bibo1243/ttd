import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TRAIN_TYPES } from './train.js';
import { Network } from './network.js';
import { buildWorld } from './world.js';
import { PassengerSystem } from './stations.js';
import { BuildController } from './build.js';
import { params, setupPerf } from './perf.js';
import { batcher } from './batching.js';
import { MODULES } from './modules.js';
import { Look } from './render.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
batcher.install(scene);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(19, 25, 25);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 3;
controls.maxDistance = 70;

// Sky, sun, lamps, time of day and post-processing (render.js).
const look = new Look({ renderer, scene, camera, quality: params.get('quality') });
if (params.has('time')) look.setTime(parseFloat(params.get('time')));

// The island starts empty of rails: the player lays track and builds stations.
const world = buildWorld(scene, { stress: params.has('stress') });
const { clouds } = world;
if (params.has('stress')) controls.maxDistance = 160;
const network = new Network(scene);
const passengers = new PassengerSystem(scene, network, world.obstacles);
const $ = (id) => document.getElementById(id);
let follow = null; // train the camera rides along with
const builder = new BuildController({
  scene,
  camera,
  dom: renderer.domElement,
  passengers,
  network,
  world,
  ui: {
    tools: $('tools'),
    quick: $('quick'),
    card: $('buildCard'),
    cardTitle: $('bcTitle'),
    cardInfo: $('bcInfo'),
    cardActions: $('bcActions'),
    lines: $('lines'),
    info: $('info'),
    onFollow: (t) => {
      follow = follow === t ? null : t;
      if (follow) {
        const p = t.position;
        camera.position.set(p.x + 6, p.y + 5, p.z + 6);
      }
    },
  },
});

// HUD
const speedInput = $('speed');
const speedOut = $('speedOut');
speedInput.addEventListener('input', () => {
  passengers.cruise = parseFloat(speedInput.value);
  speedOut.textContent = passengers.cruise.toFixed(1);
});
$('toggle').addEventListener('click', (e) => {
  passengers.paused = !passengers.paused;
  e.currentTarget.textContent = passengers.paused ? '▶ 出發' : '⏸ 暫停';
});
// Which kind of train the next purchase is.
const typeBar = $('types');
for (const [key, t] of Object.entries(TRAIN_TYPES)) {
  const btn = document.createElement('button');
  btn.textContent = t.label;
  btn.dataset.type = key;
  btn.addEventListener('click', () => {
    builder.newType = key;
    for (const b of typeBar.children) b.classList.toggle('on', b.dataset.type === key);
  });
  typeBar.appendChild(btn);
}
const syncType = () => {
  for (const b of typeBar.children) b.classList.toggle('on', b.dataset.type === builder.newType);
};
syncType();
builder.onChange(syncType);

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
  $('riders').textContent = `${passengers.onboardCount} / ${passengers.capacity}`;
  $('delivered').textContent = passengers.delivered;
  $('residents').textContent = passengers.residents;
  $('status').textContent = passengers.statusText;
};
passengers.onChange(renderStats);
builder.load();
renderStats();
shownMoney = passengers.money;
$('money').textContent = $('miniMoney').textContent = `$${shownMoney.toLocaleString()}`;

// Feature modules share one context (see modules.js).
const game = {
  scene,
  camera,
  renderer,
  controls,
  world,
  network,
  passengers,
  builder,
  look,
  money: {
    get: () => passengers.money,
    spend: (n) => passengers.spend(n),
    earn: (n) => passengers.earn(n),
    float: (text, at, color) => builder.floatText(text, at, color),
  },
  tools: { addTool: (t) => builder.addTool(t) },
};
look.onTime((night) => world.setNight(night));
for (const m of MODULES) m.init?.(game);

// Saved in this browser: on every build, every few seconds, and on leaving.
setInterval(() => builder.save(), 5000);
window.addEventListener('pagehide', () => builder.save());
let resetArmed = null;
$('reset').addEventListener('click', (e) => {
  if (resetArmed) return builder.reset();
  e.currentTarget.textContent = '再按一次確認';
  resetArmed = setTimeout(() => {
    resetArmed = null;
    $('reset').textContent = '重新開始';
  }, 2500);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  look.setSize(window.innerWidth, window.innerHeight);
});

const perf = setupPerf(renderer);
const clock = new THREE.Clock();
const lastTarget = new THREE.Vector3();

function simulate(dt, time) {
  passengers.control(dt);
  for (const t of passengers.trains) t.update(dt, time);
  passengers.update(dt, time);
  for (const m of MODULES) m.update?.(dt, time);
  if (shownMoney !== passengers.money) {
    const diff = passengers.money - shownMoney;
    const step = Math.max(1, Math.ceil(Math.abs(diff) * dt * 6));
    shownMoney = Math.abs(diff) <= step ? passengers.money : shownMoney + Math.sign(diff) * step;
    $('money').textContent = $('miniMoney').textContent = `$${shownMoney.toLocaleString()}`;
  }
}

let simTime = 0;
let infoTimer = 0;
function tick() {
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, 0.05);
  simTime += dt;
  const time = simTime;
  simulate(dt, time);

  if (follow && !passengers.trains.includes(follow)) follow = null;
  if (follow) {
    lastTarget.copy(controls.target);
    controls.target.lerp(follow.position, Math.min(1, dt * 4));
    camera.position.add(controls.target.clone().sub(lastTarget));
  }

  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 45) c.position.x = -45;
  }

  infoTimer -= dt;
  if (infoTimer <= 0) {
    infoTimer = 0.25;
    builder.renderInfo();
    renderStats();
  }
  for (const m of MODULES) m.frame?.(dt);
  controls.update();
  look.render(frameTime);
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
window.__game = { game, network, camera, controls, passengers, builder, world, look, fastForward };
window.__perf = { ...perf, bench: (n) => perf.bench(() => look.render(), n) };
