import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Robot, randomLook } from './robots.js';
import { between, randomPersonality, residentName } from './residents.js';
import { PLATFORM_Y, STATION_STYLES, STEP_H, STEP_W, disposeStationModel, highlightStation, makeStationModel } from './stationStyles.js';

const UP = new THREE.Vector3(0, 1, 0);
export { PLATFORM_Y, STATION_STYLES };
// Defaults for code that doesn't know a station's style.
export const PLATFORM_LEN = STATION_STYLES.halt.len;
export const PLATFORM_X = STATION_STYLES.halt.px;

const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

// Names and roof colours handed out to stations as the player builds them.
export const STATION_NAMES = [
  { name: '森林站', color: 0x3f9b5f },
  { name: '湖畔站', color: 0x3a86d4 },
  { name: '小鎮站', color: 0xe8893a },
  { name: '山丘站', color: 0x8e6cc8 },
  { name: '花園站', color: 0xe46a9a },
  { name: '港口站', color: 0x2fa6a0 },
  { name: '果園站', color: 0xd8544a },
  { name: '雲朵站', color: 0x6a8fd8 },
];

// ---------- Text sprites ----------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '"Noto Sans TC", "PingFang TC", system-ui, sans-serif';

class StationLabel {
  constructor(name, color) {
    this.name = name;
    this.color = '#' + new THREE.Color(color).getHexString();
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
    this.sprite.scale.set(3.2, 1.0, 1);
    this.sprite.renderOrder = 10;
    this.draw(0);
  }

  draw(waiting) {
    const c = this.canvas.getContext('2d');
    c.clearRect(0, 0, 512, 160);
    c.shadowColor = 'rgba(30,60,80,0.25)';
    c.shadowBlur = 16;
    c.shadowOffsetY = 4;
    c.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(c, 16, 14, 480, 112, 56);
    c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = this.color;
    c.beginPath();
    c.arc(74, 70, 24, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#3b3f4a';
    c.font = `700 46px ${FONT}`;
    c.textBaseline = 'middle';
    c.fillText(this.name, 116, 72);
    c.fillStyle = '#8a8f9c';
    c.font = `500 34px ${FONT}`;
    c.textAlign = 'right';
    c.fillText(`等候 ${waiting}`, 466, 74);
    c.textAlign = 'left';
    // Pointer
    c.fillStyle = 'rgba(255,255,255,0.94)';
    c.beginPath();
    c.moveTo(240, 124);
    c.lineTo(272, 124);
    c.lineTo(256, 146);
    c.fill();
    this.texture.needsUpdate = true;
  }
}

export class FloatText {
  constructor(text, color = '#f2a23a') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const c = canvas.getContext('2d');
    c.font = `800 60px ${FONT}`;
    const w = c.measureText(text).width;
    if (w > 236) c.font = `800 ${Math.floor(60 * 236 / w)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.strokeText(text, 128, 50);
    c.fillStyle = color;
    c.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    this.sprite.scale.set(0.9, 0.34, 1);
    this.sprite.renderOrder = 11;
    this.life = 0;
  }

  update(dt) {
    this.life += dt;
    this.sprite.position.y += dt * 0.7;
    this.sprite.material.opacity = Math.max(0, 1 - (this.life - 0.6) / 0.6);
    return this.life < 1.2;
  }

  dispose() {
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
  }
}

// ---------- Stations ----------

// A station model of the given style (used for build previews too).
export function makePlatform(color, style = 'halt', name = '') {
  return makeStationModel(STATION_STYLES[style] ?? STATION_STYLES.halt, color, name).group;
}

export class Station {
  // Stands beside the track at `node`. dir: the track direction there;
  // side: +1 or -1, which side of the rails (looking along dir) the platform is on.
  constructor(def, node, dir, side = 1, style = 'halt') {
    this.name = def.name;
    this.color = def.color;
    this.def = def;
    this.node = node;
    this.dir = dir.clone().setY(0).normalize();
    this.side = side;
    this.style = STATION_STYLES[style] ?? STATION_STYLES.halt;
    const st = this.style;
    this.len = st.len;
    this.px = st.px;
    this.maxWaiting = st.waiting;
    this.waiting = [];
    node.station = this;

    const model = makeStationModel(st, def.color, def.name);
    this.group = model.group;
    this.extraBlocks = model.blocks;
    placePlatform(this.group, node.pos, this.dir, side);
    this.group.updateMatrixWorld(true);
    this.outward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);
    this.label = new StationLabel(def.name, def.color);
    const top = st.key === 'grand' ? 4.4 : st.key === 'town' ? 2.3 : 2.0;
    this.label.sprite.position.copy(this.local(st.px, top, 0));
  }

  local(x, y, z) {
    return this.group.localToWorld(new THREE.Vector3(x, y, z));
  }

  // A free spot on the platform for a waiting robot: in loose rows along
  // the platform, clear of the edge and of the benches at the back.
  waitingSpot(i) {
    const st = this.style;
    const rows = st.width > 1.2 ? 3 : 2;
    const row = i % rows;
    const col = Math.floor(i / rows);
    const cols = Math.ceil(st.waiting / rows);
    const span = st.len - 2.2;
    const z = -span / 2 + (cols > 1 ? (col * span) / (cols - 1) : span / 2) + row * 0.18;
    return this.local(st.px - st.width / 2 + 0.42 + row * 0.2, PLATFORM_Y, z);
  }

  // Ground, step and platform-top spots of the steps nearest to a point.
  ramp(near) {
    const st = this.style;
    const local = this.group.worldToLocal(near.clone());
    const z = st.ramps.reduce((a, b) => (Math.abs(b - local.z) < Math.abs(a - local.z) ? b : a));
    const jitter = (Math.random() - 0.5) * 0.24;
    return {
      top: this.local(st.back - 0.22, PLATFORM_Y, z + jitter),
      step: this.local(st.stepX, STEP_H, z + jitter),
      bottom: this.local(st.stepX + 0.42, 0, z + jitter),
    };
  }

  // Way up onto the platform from the ground (and reversed, down).
  upPath(near) {
    const r = this.ramp(near);
    return [r.bottom, jump(r.step), jump(r.top)];
  }

  downPath(near) {
    const r = this.ramp(near);
    return [r.top, jump(r.step), jump(r.bottom)];
  }

  // Solid blocks (in the station's frame) walkers must go around:
  // the platform body, the steps and any station building.
  get blocks() {
    const st = this.style;
    return [
      { x0: st.px - st.width / 2, x1: st.back, z0: -st.len / 2, z1: st.len / 2, top: PLATFORM_Y },
      ...st.ramps.map((z) => ({ x0: st.stepX - STEP_W / 2, x1: st.stepX + STEP_W / 2, z0: z - 0.275, z1: z + 0.275, top: STEP_H })),
      ...this.extraBlocks,
    ];
  }

  // A random spot on the ground behind the station for a stroll.
  wanderPoint(isFree) {
    const st = this.style;
    for (let i = 0; i < 30; i++) {
      const p = this.local(st.depth + 0.6 + Math.random() * 4.5, 0, (Math.random() - 0.5) * (st.len + 2));
      if (isFree(p.x, p.z)) return p;
    }
    return this.local(st.depth + 0.5, 0, (Math.random() - 0.5) * 3);
  }

  // Is a point on the station's footprint (platform, steps and buildings)?
  contains(x, z, margin = 0) {
    const v = this.group.worldToLocal(new THREE.Vector3(x, 0, z));
    const st = this.style;
    return v.x > -0.6 - margin && v.x < st.depth + margin && Math.abs(v.z) < st.len / 2 + margin;
  }

  // On the platform itself (where the doors open onto)?
  onPlatform(local) {
    const st = this.style;
    return Math.abs(local.z) < st.len / 2 - 0.12 && local.x > st.px - st.width / 2 - 0.55 && local.x < st.back + 0.05;
  }

  // Tint the station, e.g. red while the demolish tool hovers it.
  highlight(color) {
    highlightStation(this.group, color);
  }

  dispose() {
    if (this.node.station === this) this.node.station = null;
    this.group.removeFromParent();
    this.label.sprite.removeFromParent();
    disposeStationModel(this.group);
    this.label.texture.dispose();
    this.label.sprite.material.dispose();
  }
}

// Stand a platform group beside the track at distance d.
export function placePlatform(group, pos, dir, side) {
  group.position.copy(pos);
  group.rotation.y = Math.atan2(dir.x, dir.z) + (side > 0 ? 0 : Math.PI);
}

// Mark a path point as reached by a hop (up or down a level).
export const jump = (p) => Object.assign(p, { jump: true });

// ---------- Residents and passenger flow ----------

const BOARD_INTERVAL = 0.22;
const MIN_DWELL = 1.4;
const SKIP_AFTER = 8; // seconds held at a red signal before skipping a stop
export const RESIDENTS = 100;
export const START_MONEY = 8000;
const ROBOT_R = 0.1;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const _v = new THREE.Vector3();

// Everyone who lives on the island, and every train carrying them. Trains
// run their line's stations in order; residents walk up, wait, board
// whichever train serves where they want to go, ride, pay and stroll off.
export class PassengerSystem {
  constructor(scene, network, obstacles = []) {
    this.scene = scene;
    this.network = network;
    this.stations = [];
    this.lines = [];
    this.trains = [];
    this.robots = new Set();
    this.floaters = [];
    this.money = START_MONEY;
    this.delivered = 0;
    this.listeners = [];
    this.obstacles = obstacles;
    this.trackPts = [];
    this.netVersion = -1;
    this.cruise = 4;
    this.paused = false;
    this.served = new Set();
    this.looks = 0;
    this.#spawnResidents(RESIDENTS);
  }

  get residents() {
    return this.robots.size;
  }

  get onboardCount() {
    return this.trains.reduce((s, t) => s + t.onboard.length, 0);
  }

  get capacity() {
    return this.trains.reduce((s, t) => s + t.capacity, 0);
  }

  // A train is standing at this station with doors open or about to leave.
  busyAt(station) {
    return this.trains.some((t) => t.current === station && t.state !== 'running');
  }

  spend(amount) {
    if (amount > this.money) return false;
    this.money -= amount;
    this.#emit();
    return true;
  }

  earn(amount) {
    this.money += amount;
    this.#emit();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this);
  }

  addFloater(f) {
    this.scene.add(f.sprite);
    this.floaters.push(f);
  }

  // ---------- Where robots may walk ----------

  #refreshTrack() {
    if (this.netVersion === this.network.version) return;
    this.netVersion = this.network.version;
    this.trackPts = this.network.allSamples();
  }

  #isFree = (x, z) => {
    if (x * x + z * z > 21 * 21) return false;
    if (this.trackPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.1 ** 2)) return false;
    if (this.stations.some((s) => s.contains(x, z, 0.3))) return false;
    // Don't loiter on roads (see roads/).
    const road = window.__roads?.net?.nearestSeg(x, z);
    if (road && road.dist - (road.wide ?? 0) < 1) return false;
    return !this.obstacles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r);
  };

  #wanderNear(p, roam = 1) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (1.2 + Math.random() * 3) * roam;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (this.#isFree(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(p.x * 0.85, 0, p.z * 0.85);
  }

  // Stations some line with at least two stops calls at.
  #updateServed() {
    this.served = new Set(this.lines.filter((l) => l.stations.length >= 2).flatMap((l) => l.stations));
  }

  #destinations(from) {
    const out = new Set();
    for (const l of this.lines) {
      if (l.stations.length < 2 || !l.stations.includes(from)) continue;
      for (const s of l.stations) if (s !== from) out.add(s);
    }
    return [...out];
  }

  #nearestServed(p) {
    let best = null;
    for (const s of this.served) {
      if (!best || s.group.position.distanceToSquared(p) < best.group.position.distanceToSquared(p)) best = s;
    }
    return best;
  }

  // ---------- Residents ----------

  #spawnResidents(n) {
    this.#refreshTrack();
    const houses = this.obstacles.filter((o) => o.kind === 'house');
    for (let k = 0; k < n; k++) {
      const i = this.looks++;
      const look = randomLook(i);
      look.name = residentName(i);
      look.personality = randomPersonality();
      const r = new Robot(look);
      let start = null;
      for (let t = 0; t < 30 && !start; t++) {
        const a = Math.random() * Math.PI * 2;
        const h = houses.length && Math.random() < 0.6 ? pick(houses) : null;
        const p = h
          ? new THREE.Vector3(h.x + Math.cos(a) * (h.r + 0.3), 0, h.z + Math.sin(a) * (h.r + 0.3))
          : new THREE.Vector3(Math.cos(a) * Math.sqrt(Math.random()) * 19, 0, Math.sin(a) * Math.sqrt(Math.random()) * 19);
        if (this.#isFree(p.x, p.z)) start = p;
      }
      r.mesh.position.copy(start ?? new THREE.Vector3());
      r.mesh.rotation.y = Math.random() * Math.PI * 2;
      this.robots.add(r);
      this.scene.add(r.mesh);
      this.#stroll(r, null, 1 + Math.floor(Math.random() * 3));
    }
  }

  // Wander a few stops (near `s`, or wherever the robot is), lingering at
  // each, then go and catch a train. Pace and habits follow personality.
  #stroll(r, s, legs) {
    const P = r.personality;
    r.state = 'strolling';
    r.home = s;
    r.target = null;
    r.setDestination(null);
    r.speed = (0.55 + Math.random() * 0.25) * (P?.speed ?? 1);
    if (legs === undefined) legs = Math.round(between(P?.legs ?? [1, 3]));
    const step = (left) => {
      if (left <= 0) return this.#headToPlatform(r, r.home);
      // Now and then pop home for a sit-down, a meal or a nap (see homes/).
      if (this.homes?.maybeVisit(r, () => step(left - 1))) return;
      const home = r.home && this.stations.includes(r.home) ? r.home : null;
      const buddy = Math.random() < (P?.social ?? 0) ? this.#buddy(r) : null;
      let spot;
      if (buddy) {
        // Walk up to a friend and face them for a chat.
        spot = buddy.mesh.position.clone().add(_v.subVectors(r.mesh.position, buddy.mesh.position).setY(0).setLength(0.34));
      } else spot = home ? home.wanderPoint(this.#isFree) : this.#wanderNear(r.mesh.position, P?.roam ?? 1);
      r.walkTo([spot], () => {
        if (buddy) {
          r.mesh.rotation.y = Math.atan2(buddy.mesh.position.x - r.mesh.position.x, buddy.mesh.position.z - r.mesh.position.z);
          if (buddy.state === 'strolling' && buddy.idle > 0) {
            buddy.mesh.rotation.y = r.mesh.rotation.y + Math.PI;
            buddy.idle = Math.max(buddy.idle, 2.5);
          }
        }
        r.wait(between(P?.wait ?? [1.5, 5]), () => step(left - 1));
      });
    };
    step(legs);
  }

  #buddy(r) {
    let best = null;
    for (const o of this.robots) {
      if (o === r || o.state !== 'strolling' || o.mesh.parent !== this.scene) continue;
      const d = o.mesh.position.distanceToSquared(r.mesh.position);
      if (d < 36 && (!best || d < best.d)) best = { o, d };
    }
    return best?.o ?? null;
  }

  #headToPlatform(r, s) {
    if (!s || !this.served.has(s)) s = this.#nearestServed(r.mesh.position);
    if (!s) return this.#stroll(r, null, 2);
    if (s.waiting.length >= s.maxWaiting) return this.#stroll(r, s, 1);
    r.state = 'returning';
    r.target = s;
    r.speed = (0.9 + Math.random() * 0.2) * (r.personality?.speed ?? 1);
    r.walkTo([...this.#around(s, r.mesh.position), ...s.upPath(r.mesh.position)], () => {
      r.target = null;
      const dests = this.#destinations(s);
      if (!dests.length) return this.#stepDown(r, s);
      r.origin = s;
      r.setDestination(pick(dests));
      r.state = 'waiting';
      s.waiting.push(r);
      this.#regroup(s);
    });
  }

  // Waypoints around the platform for a robot coming from the track side.
  #around(s, from) {
    const local = s.group.worldToLocal(from.clone());
    const st = s.style;
    if (local.x > st.back + 0.4 && (local.x > st.depth + 0.3 || Math.abs(local.z) > st.len / 2)) return [];
    const z = (local.z >= 0 ? 1 : -1) * (st.len / 2 + 0.7);
    if (local.x > st.back + 0.4) return [s.local(st.depth + 0.5, 0, local.z), s.local(st.depth + 0.5, 0, z * 0.85)];
    return [s.local(local.x < -0.8 ? -1.2 : st.px, 0, z), s.local(st.depth + 0.5, 0, z)];
  }

  // Hop down off the platform and stroll away.
  #stepDown(r, s) {
    r.setDestination(null);
    r.state = 'leaving';
    r.walkTo(s.downPath(r.mesh.position), () => this.#stroll(r, s));
  }

  // The platform under this robot is being demolished: get off the spot.
  #leaveDemolished(r, s) {
    r.setDestination(null);
    r.target = null;
    r.state = 'leaving';
    const p = r.mesh.position.clone().addScaledVector(s.outward, 1.8);
    p.y = 0;
    r.walkTo([jump(p)], () => this.#stroll(r, null, 2));
  }

  // A rider whose train is taken away climbs out beside the car.
  #dropRider(r) {
    const v = r.vehicle;
    if (r.seat) r.seat.robot = null;
    const p = v
      ? v.body.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (v.hw + 0.8), 0, r.seat?.pos.z ?? 0))
      : r.mesh.getWorldPosition(new THREE.Vector3());
    const at = r.mesh.getWorldPosition(new THREE.Vector3());
    this.scene.attach(r.mesh);
    r.mesh.position.copy(at);
    p.y = 0;
    r.vehicle = null;
    r.seat = null;
    r.boarding = false;
    r.stand();
    r.setIndoor(false);
    r.setDestination(null);
    r.state = 'leaving';
    r.walkTo([jump(p)], () => this.#stroll(r, null, 2));
  }

  // ---------- Network changes from the build tools ----------

  setLines(lines) {
    this.lines = lines;
    this.#updateServed();
    for (const s of this.stations) {
      for (const r of [...s.waiting]) {
        if (r.boarding) continue;
        const dests = this.#destinations(s);
        if (dests.includes(r.dest)) continue;
        if (dests.length) r.setDestination(pick(dests));
        else {
          s.waiting.splice(s.waiting.indexOf(r), 1);
          this.#stepDown(r, s);
        }
      }
      this.#regroup(s);
    }
    for (const t of this.trains) {
      for (const r of [...t.onboard]) {
        if (t.line?.stations.includes(r.dest)) continue;
        if (t.line?.stations.length) r.setDestination(pick(t.line.stations));
      }
    }
    this.#emit();
  }

  addStation(station) {
    this.stations.push(station);
    this.scene.add(station.group, station.label.sprite);
    this.#refreshTrack();
    this.#emit();
  }

  removeStation(s) {
    if (this.busyAt(s)) return false;
    this.stations.splice(this.stations.indexOf(s), 1);
    for (const r of s.waiting) this.#leaveDemolished(r, s);
    s.waiting = [];
    for (const r of this.robots) {
      if (r.state === 'returning' && r.target === s) this.#leaveDemolished(r, s);
      if (r.home === s) r.home = null;
    }
    s.dispose();
    this.#emit();
    return true;
  }

  addTrain(train) {
    this.trains.push(train);
    train.state = 'idle';
    train.timer = 0;
    train.onboard = [];
    this.#emit();
  }

  removeTrain(train) {
    if (train.state === 'dwell' || train.state === 'closing') this.#setDoors(train, null);
    for (const r of [...train.onboard]) this.#dropRider(r);
    train.onboard = [];
    for (const r of this.robots) {
      if (r.vehicle && train.vehicles.includes(r.vehicle)) {
        if (r.seat) r.seat.robot = null;
        if (r.boarding) {
          r.boarding = false;
          train.walkingIn--;
        }
        if (r.mesh.parent !== this.scene) this.#dropRider(r);
        else {
          r.vehicle = null;
          r.seat = null;
        }
      }
    }
    for (const s of this.stations) this.#regroup(s);
    this.trains.splice(this.trains.indexOf(train), 1);
    train.remove();
    this.#emit();
  }

  // ---------- Status ----------

  get statusText() {
    if (!this.network.edges.size) return '先用「鐵路」工具鋪設軌道';
    if (this.stations.length < 2) return '在鐵路旁蓋至少兩個車站';
    if (!this.lines.some((l) => l.stations.length >= 2)) return '用「路線」把車站串成一條路線';
    if (!this.trains.length) return '在路線上加開列車';
    const moving = this.trains.filter((t) => t.state === 'running').length;
    return `${this.trains.length} 台列車・${moving} 台行駛中`;
  }

  trainStatus(t) {
    if (!t.path) return '找不到可停靠的車站';
    switch (t.state) {
      case 'running':
        return `前往 ${t.target?.name ?? ''}`;
      case 'dwell':
        return t.waitReason === 'signal' ? `${t.current.name}・等待號誌` : t.waitReason === 'noroute' ? `到 ${this.#nextStop(t)?.name} 的路不通` : `${t.current.name}・上下車中`;
      case 'closing':
        return `${t.current.name}・關門`;
      default:
        return '待命中';
    }
  }

  // ---------- Driving trains ----------

  #nextStop(t) {
    const st = t.line?.stations;
    if (!st || st.length < 2) return null;
    const i = st.indexOf(t.current);
    return st[(i + 1) % st.length];
  }

  // Put a newly bought train on its line. False if no station is free.
  placeTrain(t) {
    const st = t.line?.stations ?? [];
    for (const s of st) {
      if (this.trains.some((o) => o !== t && o.current === s && o.state !== 'running')) continue;
      if (t.spawnAt(s)) {
        t.atNode = s.node;
        this.#arrive(t, s);
        return true;
      }
    }
    return false;
  }

  // Called each frame before trains move.
  control(dt) {
    for (const t of this.trains) {
      if (!t.path) {
        t.speed = 0;
        continue;
      }
      if (t.state !== 'running') {
        t.speed = 0;
        continue;
      }
      const cruise = this.paused ? 0 : this.cruise * t.config.speedScale;
      t.speed += (cruise - t.speed) * Math.min(1, dt * 1.5);
      const rem = t.remaining;
      const decel = 1.4 * t.config.speedScale;
      const cap = Math.sqrt(2 * decel * Math.max(0, rem));
      if (t.speed > cap) t.speed = Math.max(cap, this.paused ? 0 : 0.3);
      if (rem <= 1e-3 || t.speed * dt >= rem) {
        t.speed = Math.max(0, rem) / dt;
        t.arriving = true;
      }
    }
  }

  #arrive(t, station) {
    t.atNode = station.node;
    if (!this.stations.includes(station)) {
      // The station was demolished on the way: roll on to the next stop.
      t.current = null;
      t.state = 'dwell';
      t.dwell = MIN_DWELL;
      t.timer = 0;
      t.retry = 0;
      t.walkingIn = t.walkingOut = 0;
      return;
    }
    t.state = 'dwell';
    t.current = station;
    t.dwell = 0;
    t.timer = 0.5; // doors slide open first
    t.retry = 0;
    t.waitReason = null;
    t.walkingIn = 0;
    t.walkingOut = 0;
    this.#setDoors(t, station);
    this.#emit();
  }

  // Ask the signals for the road to the next stop.
  #tryDepart(t) {
    const st = t.line?.stations;
    const next = this.#nextStop(t);
    if (!next) {
      t.waitReason = null;
      t.retry = 1;
      return;
    }
    let target = next;
    let result = t.startLeg(t.atNode, next.node);
    // Two trains each waiting for track the other holds would wait forever:
    // after a while, skip the blocked stop and head for a later one.
    if (result === 'blocked' && t.blockedFor > SKIP_AFTER) {
      const i = st.indexOf(next);
      for (let k = 1; k < st.length - 1 && result !== 'ok'; k++) {
        const alt = st[(i + k) % st.length];
        if (alt === t.current) continue;
        if (t.startLeg(t.atNode, alt.node) === 'ok') {
          result = 'ok';
          target = alt;
        }
      }
    }
    if (result !== 'ok') {
      t.waitReason = result === 'blocked' ? 'signal' : 'noroute';
      t.retry = result === 'blocked' ? 0.4 : 2;
      if (result === 'blocked') t.blockedFor = (t.blockedFor ?? 0) + Math.max(t.retry, 0.4);
      this.#emit();
      return;
    }
    t.blockedFor = 0;
    if (t.current) this.#missed(t.current);
    t.waitReason = null;
    t.target = target;
    t.state = 'closing';
    t.timer = 0.6;
    this.#setDoors(t, null);
    this.#emit();
  }

  // Robots still hurrying to the platform as the doors close get upset.
  #missed(s) {
    for (const r of this.robots) {
      if (r.state !== 'returning' || r.target !== s || r.sulking) continue;
      if (r.mesh.position.distanceTo(s.node.pos) > 7) continue;
      if (Math.random() > (r.personality?.temper ?? 0.5)) continue;
      if (!r.tantrum(2.2 + Math.random() * 1.6)) continue;
      const f = new FloatText(Math.random() < 0.5 ? '💢 等等我！' : '💢', '#e0533f');
      f.sprite.position.copy(r.mesh.position).add(_v.set(0, 0.7, 0));
      f.sprite.scale.multiplyScalar(0.8);
      this.addFloater(f);
    }
  }

  // Called each frame after trains moved.
  update(dt, time) {
    this.#refreshTrack();
    for (const t of this.trains) {
      if (t.arriving) {
        t.arriving = false;
        t.speed = 0;
        this.#arrive(t, t.target);
      }
      if (t.state === 'dwell') this.#dwell(t, dt);
      else if (t.state === 'closing') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.state = 'running';
          this.#emit();
        }
      } else if (t.state === 'idle') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.timer = 1;
          if (!t.path) this.placeTrain(t);
        }
      }
    }
    for (const r of this.robots) r.update(dt, time);
    this.#collide(dt);
    this.floaters = this.floaters.filter((f) => {
      const alive = f.update(dt);
      if (!alive) {
        this.scene.remove(f.sprite);
        f.dispose();
      }
      return alive;
    });
    this.network.updateSignals();
  }

  #dwell(t, dt) {
    const s = t.current;
    t.dwell += dt;
    t.timer -= dt;
    t.retry -= dt;
    if (t.timer > 0) return;
    if (s) {
      const leaving = t.onboard.findIndex((r) => r.dest === s);
      if (leaving >= 0) {
        const r = t.onboard.splice(leaving, 1)[0];
        this.#disembark(t, r, s);
        t.timer = BOARD_INTERVAL;
        return;
      }
      for (const r of s.waiting) {
        if (r.boarding || !t.line?.stations.includes(r.dest)) continue;
        if (this.#board(t, r, s)) {
          t.timer = BOARD_INTERVAL;
          return;
        }
        break; // no seat reachable from the platform
      }
    }
    if (t.walkingIn === 0 && t.walkingOut === 0 && t.dwell >= MIN_DWELL && t.retry <= 0) this.#tryDepart(t);
  }

  // ---------- Getting on and off ----------

  #faceTrack(r, station) {
    r.mesh.rotation.y = Math.atan2(-station.outward.x, -station.outward.z);
  }

  #regroup(station) {
    station.waiting.forEach((r, i) => {
      if (r.boarding) return;
      r.walkTo([station.waitingSpot(i)], () => this.#faceTrack(r, station));
    });
    station.label.draw(station.waiting.length);
  }

  // Which side of a car faces the platform: +1 or -1 in the car body's frame.
  #platformSide(v, station) {
    const q = v.body.getWorldQuaternion(new THREE.Quaternion()).invert();
    return station.outward.clone().applyQuaternion(q).x >= 0 ? 1 : -1;
  }

  #doorWorld(v, door) {
    return v.body.localToWorld(new THREE.Vector3(door.outsideX, PLATFORM_Y, door.z));
  }

  #onPlatform(p, station) {
    return station.onPlatform(station.group.worldToLocal(p.clone()));
  }

  #usableDoors(v, station) {
    if (!v.doors) return [];
    const side = this.#platformSide(v, station);
    return v.doors.filter((d) => d.side === side && this.#onPlatform(this.#doorWorld(v, d), station));
  }

  #findSeat(t, from, station) {
    let best = null;
    for (const v of t.vehicles) {
      if (!v.seats) continue;
      const free = v.seats.filter((s) => !s.robot);
      if (!free.length) continue;
      for (const door of this.#usableDoors(v, station)) {
        const d = this.#doorWorld(v, door).distanceTo(from);
        if (!best || d < best.d) best = { d, v, door, free };
      }
    }
    if (!best) return null;
    const seat = best.free.reduce((a, b) => (Math.abs(b.pos.z - best.door.z) < Math.abs(a.pos.z - best.door.z) ? b : a));
    return { v: best.v, door: best.door, seat };
  }

  #fare(robot) {
    const d = robot.origin && robot.dest ? robot.origin.group.position.distanceTo(robot.dest.group.position) * 1.25 : 10;
    return Math.round(8 + d * 0.8);
  }

  #setDoors(t, station) {
    for (const v of t.vehicles) v.openSide = station ? this.#platformSide(v, station) : 0;
  }

  #board(t, r, s) {
    const spot = this.#findSeat(t, r.mesh.position, s);
    if (!spot) return false;
    const { v, door, seat } = spot;
    seat.robot = r;
    r.boarding = true;
    r.vehicle = v;
    r.seat = seat;
    t.walkingIn++;
    r.speed = 1.2;
    r.walkTo([this.#doorWorld(v, door)], () => {
      if (!t.vehicles.includes(v) || !this.trains.includes(t)) return; // train was rebuilt or sold meanwhile
      s.waiting.splice(s.waiting.indexOf(r), 1);
      this.#regroup(s);
      v.body.attach(r.mesh);
      r.setIndoor(true);
      r.state = 'riding';
      const f = v.floorY;
      const front = seat.pos.z + 0.13;
      // Hop up through the door, then walk the aisle to the seat.
      r.walkTo(
        [
          jump(new THREE.Vector3(door.insideX, f, door.z)),
          new THREE.Vector3(0, f, door.z),
          new THREE.Vector3(0, f, front),
          new THREE.Vector3(seat.pos.x, f, front),
        ],
        () => {
          r.sit(seat);
          r.boarding = false;
          t.walkingIn--;
          t.onboard.push(r);
          this.#emit();
        },
      );
    });
    return true;
  }

  #disembark(t, r, s) {
    const v = r.vehicle;
    const seat = r.seat;
    let doors = this.#usableDoors(v, s);
    if (!doors.length) doors = v.doors.filter((d) => d.side === this.#platformSide(v, s));
    const door = doors.reduce((a, b) => (Math.abs(b.z - seat.pos.z) < Math.abs(a.z - seat.pos.z) ? b : a));
    const f = v.floorY;
    const front = seat.pos.z + 0.13;
    t.walkingOut++;
    r.stand();
    r.speed = 1.1;
    r.walkTo(
      [
        new THREE.Vector3(seat.pos.x, f, front),
        new THREE.Vector3(0, f, front),
        new THREE.Vector3(0, f, door.z),
        new THREE.Vector3(door.insideX, f, door.z),
        jump(new THREE.Vector3(door.outsideX, PLATFORM_Y, door.z)),
      ],
      () => {
        seat.robot = null;
        r.vehicle = null;
        r.seat = null;
        this.scene.attach(r.mesh);
        r.setIndoor(false);
        t.walkingOut--;
        this.#pay(r, s);
      },
    );
  }

  #pay(r, s) {
    const fare = this.#fare(r);
    this.money += fare;
    this.delivered++;
    const text = new FloatText(`+$${fare}`);
    text.sprite.position.copy(r.mesh.position).add(new THREE.Vector3(0, 0.6, 0));
    this.addFloater(text);
    r.setDestination(null);
    r.state = 'leaving';
    r.walkTo(s.downPath(r.mesh.position), () => this.#stroll(r, s));
    this.#emit();
  }

  // The train was rebuilt (new type or cars). Riders move to a free seat
  // elsewhere; if none is left they get off.
  reseat(t) {
    const alive = new Set(t.vehicles);
    for (const r of [...t.onboard]) {
      if (alive.has(r.vehicle)) continue;
      const free = t.vehicles.flatMap((v) => (v.seats ?? []).filter((s) => !s.robot).map((s) => [v, s]));
      if (!free.length) {
        t.onboard.splice(t.onboard.indexOf(r), 1);
        r.vehicle = null;
        this.#dropRider(r);
        continue;
      }
      const [v, seat] = free[0];
      seat.robot = r;
      r.vehicle = v;
      r.seat = seat;
      v.body.add(r.mesh);
      r.setIndoor(true);
      r.sit(seat);
    }
    // Robots walking in or out of a car that no longer exists finish at once.
    for (const r of this.robots) {
      if (!r.vehicle || alive.has(r.vehicle) || !r.vehicle.seats) continue;
      if (!this.trains.some((o) => o.vehicles.includes(r.vehicle))) {
        if (r.boarding) {
          r.boarding = false;
          t.walkingIn--;
          if (r.mesh.parent !== this.scene) this.#dropRider(r);
          else {
            r.vehicle = null;
            r.seat = null;
          }
        } else if (r.mesh.parent !== this.scene) {
          t.walkingOut--;
          this.#dropRider(r);
        }
      }
    }
    for (const s of this.stations) this.#regroup(s);
    if (t.state === 'dwell' && t.current) this.#setDoors(t, t.current);
    this.#emit();
  }

  // ---------- Bumping into things ----------

  // Buildings with a footprint box (shops): slide robots along the walls
  // toward where they are headed instead of letting them walk through.
  #keepOutOfBox(r, b, dt) {
    const p = r.mesh.position;
    const m = ROBOT_R;
    if (p.x < b.minX - m || p.x > b.maxX + m || p.z < b.minZ - m || p.z > b.maxZ + m) return;
    const goal = r.path[r.path.length - 1];
    // Robots heading inside (porters delivering) are let through.
    if (goal && goal.x > b.minX - 0.35 && goal.x < b.maxX + 0.35 && goal.z > b.minZ - 0.35 && goal.z < b.maxZ + 0.35) return;
    const next = r.path[0];
    const slide = (r.speed ?? 0.5) * dt * 0.8;
    const pen = [
      [p.x - (b.minX - m), 'x', b.minX - m],
      [b.maxX + m - p.x, 'x', b.maxX + m],
      [p.z - (b.minZ - m), 'z', b.minZ - m],
      [b.maxZ + m - p.z, 'z', b.maxZ + m],
    ].reduce((a, c) => (c[0] < a[0] ? c : a));
    p[pen[1]] = pen[2];
    const other = pen[1] === 'x' ? 'z' : 'x';
    if (next) p[other] += Math.sign(next[other] - p[other]) * Math.min(slide, Math.abs(next[other] - p[other]));
  }

  #collide(dt) {
    const list = [];
    for (const r of this.robots) {
      if (r.mesh.parent !== this.scene || r.jumping || r.seated) continue;
      list.push(r);
    }
    // Robots keep their personal space.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const pa = a.mesh.position;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const pb = b.mesh.position;
        if (Math.abs(pa.y - pb.y) > 0.1) continue;
        const queue = a.state === 'waiting' && b.state === 'waiting';
        const min = queue ? 0.2 : Math.max(0.2, ((a.personality?.space ?? 0.22) + (b.personality?.space ?? 0.22)) / 2);
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        // Someone standing still gets nudged less than someone walking.
        const wa = a.path.length ? 1 : 0.4;
        const wb = b.path.length ? 1 : 0.4;
        const k = push / d / Math.max(0.5, (wa + wb) / 2);
        pa.x -= dx * k * wa * 0.5;
        pa.z -= dz * k * wa * 0.5;
        pb.x += dx * k * wb * 0.5;
        pb.z += dz * k * wb * 0.5;
      }
    }
    for (const r of list) {
      const p = r.mesh.position;
      if (p.y > 0.05) continue; // up on a platform or step
      // Trees and houses are solid.
      for (const o of this.obstacles) {
        if (o.box) {
          this.#keepOutOfBox(r, o.box, dt);
          continue;
        }
        const solid = o.kind === 'house' ? 0.62 : 0.2;
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const min = solid + ROBOT_R;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = o.x + (dx / d) * min;
          p.z = o.z + (dz / d) * min;
        }
      }
      // So are platforms and their steps.
      for (const s of this.stations) {
        const local = s.group.worldToLocal(p.clone());
        if (Math.abs(local.z) > s.len / 2 + 0.5 || local.x < -0.2 || local.x > s.style.depth + 0.5) continue;
        let moved = false;
        for (const b of s.blocks) {
          if (local.x < b.x0 - ROBOT_R || local.x > b.x1 + ROBOT_R || local.z < b.z0 - ROBOT_R || local.z > b.z1 + ROBOT_R) continue;
          const pen = [
            [local.x - (b.x0 - ROBOT_R), -1, 0],
            [b.x1 + ROBOT_R - local.x, 1, 0],
            [local.z - (b.z0 - ROBOT_R), 0, -1],
            [b.z1 + ROBOT_R - local.z, 0, 1],
          ].reduce((m, x) => (x[0] < m[0] ? x : m));
          local.x += pen[1] * pen[0];
          local.z += pen[2] * pen[0];
          moved = true;
        }
        if (moved) p.copy(s.group.localToWorld(local)).setY(0);
      }
      // Trains shove robots aside.
      for (const t of this.trains) {
        if (!t.path) continue;
        for (const v of t.vehicles) {
          const local = v.group.worldToLocal(p.clone());
          const hw = (v.hw ?? 0.33) + ROBOT_R + 0.05;
          if (Math.abs(local.z) < v.length / 2 + 0.05 && Math.abs(local.x) < hw) {
            local.x = Math.sign(local.x || 1) * hw;
            p.copy(v.group.localToWorld(local)).setY(0);
          }
        }
      }
    }
    // A walker held up for a while picks a way around.
    for (const r of list) {
      if (!r.path.length || r.path[0].jump) {
        r.stuck = 0;
        continue;
      }
      const p = r.mesh.position;
      const moved = r.lastPos ? r.lastPos.distanceTo(p) : 1;
      r.lastPos = (r.lastPos ?? new THREE.Vector3()).copy(p);
      r.stuck = moved < r.speed * dt * 0.3 ? (r.stuck ?? 0) + dt : 0;
      if (r.stuck > 1.2 && p.y < 0.05) {
        r.stuck = 0;
        const to = _v.subVectors(r.path[0], p).setY(0).normalize();
        const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * 0.9);
        r.path.unshift(p.clone().add(side));
      }
    }
  }
}
