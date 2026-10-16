import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Robot, randomLook } from './robots.js';

const UP = new THREE.Vector3(0, 1, 0);
export const PLATFORM_Y = 0.3;
export const PLATFORM_LEN = 8;
export const PLATFORM_X = 0.95; // platform centre, measured outward from the rails
const RAMP_Z = [-2.25, 2.25];

const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

function shadowed(o) {
  o.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

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

export function makePlatform(color) {
  const g = new THREE.Group();
  const L = PLATFORM_LEN;
  const platform = new THREE.Mesh(new RoundedBoxGeometry(1.0, PLATFORM_Y, L, 2, 0.05), flat(0xd9d2c5));
  platform.position.set(PLATFORM_X, PLATFORM_Y / 2, 0);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, L - 0.1), flat(0xf2c14e));
  edge.position.set(PLATFORM_X - 0.42, PLATFORM_Y + 0.006, 0);
  g.add(platform, edge);
  const pillarGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.82, 10);
  const white = flat(0xf4efe6);
  for (const z of [-3, -1.5, 0, 1.5, 3]) {
    const p = new THREE.Mesh(pillarGeo, white);
    p.position.set(PLATFORM_X + 0.3, PLATFORM_Y + 0.41, z);
    g.add(p);
  }
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.08, 7, 2, 0.04), flat(color));
  roof.position.set(PLATFORM_X + 0.12, PLATFORM_Y + 0.86, 0);
  roof.rotation.z = 0.12;
  g.add(roof);
  const bench = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.1, 0.7, 2, 0.03), flat(0x8b5a3c));
  bench.position.set(PLATFORM_X + 0.36, PLATFORM_Y + 0.08, 1.0);
  g.add(bench);
  // Station sign on two posts
  const signMat = flat(color);
  const sign = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.16, 0.6, 2, 0.03), signMat);
  sign.position.set(PLATFORM_X + 0.42, PLATFORM_Y + 0.62, -1.0);
  g.add(sign);
  for (const dz of [-0.24, 0.24]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8), white);
    post.position.set(PLATFORM_X + 0.42, PLATFORM_Y + 0.3, -1.0 + dz);
    g.add(post);
  }
  // Ramps down to the ground at the back of the platform.
  const rampMat = flat(0xcfc6b8);
  for (const z of RAMP_Z) {
    const ramp = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.05, 0.42, 2, 0.02), rampMat);
    ramp.position.set(PLATFORM_X + 0.74, PLATFORM_Y / 2 - 0.01, z);
    ramp.rotation.z = -Math.atan2(PLATFORM_Y, 0.5);
    g.add(ramp);
  }
  return shadowed(g);
}

export class Station {
  // side: +1 or -1, which side of the rails (relative to the direction of
  // travel) the platform stands on.
  constructor(def, track, d, side = 1) {
    this.name = def.name;
    this.color = def.color;
    this.def = def;
    this.d = d;
    this.side = side;
    this.waiting = [];

    this.group = makePlatform(def.color);
    placePlatform(this.group, track, d, side);
    this.group.updateMatrixWorld(true);
    this.outward = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);
    this.label = new StationLabel(def.name, def.color);
    this.label.sprite.position.copy(this.local(PLATFORM_X, 2.1, 0));
  }

  local(x, y, z) {
    return this.group.localToWorld(new THREE.Vector3(x, y, z));
  }

  // A free spot on the platform for a waiting robot.
  waitingSpot(i) {
    const row = i % 2;
    const col = Math.floor(i / 2);
    const z = -2.9 + col * 0.62 + row * 0.3;
    return this.local(PLATFORM_X + 0.02 + row * 0.24, PLATFORM_Y, z);
  }

  // Top and bottom of the ramp nearest to a world point.
  ramp(near) {
    const local = this.group.worldToLocal(near.clone());
    const z = RAMP_Z.reduce((a, b) => (Math.abs(b - local.z) < Math.abs(a - local.z) ? b : a));
    const jitter = (Math.random() - 0.5) * 0.2;
    return {
      top: this.local(PLATFORM_X + 0.38, PLATFORM_Y, z + jitter),
      bottom: this.local(PLATFORM_X + 1.15, 0, z + jitter),
    };
  }

  // A random spot on the ground behind the station for a stroll.
  wanderPoint(isFree) {
    for (let i = 0; i < 30; i++) {
      const p = this.local(PLATFORM_X + 1.6 + Math.random() * 4.5, 0, (Math.random() - 0.5) * 10);
      if (isFree(p.x, p.z)) return p;
    }
    return this.local(PLATFORM_X + 1.4, 0, (Math.random() - 0.5) * 3);
  }

  contains(x, z, margin) {
    return platformContains(this.group, x, z, margin);
  }

  // Tint the station, e.g. red while the demolish tool hovers it.
  highlight(color) {
    this.group.traverse((o) => {
      if (o.isMesh) o.material.emissive?.set(color ?? 0x000000);
    });
  }

  dispose() {
    this.group.removeFromParent();
    this.label.sprite.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.label.texture.dispose();
    this.label.sprite.material.dispose();
  }
}

// Stand a platform group beside the track at distance d.
export function placePlatform(group, track, d, side) {
  const p = track.pointAt(d);
  const t = track.tangentAt(d);
  group.position.copy(p);
  group.rotation.y = Math.atan2(t.x, t.z) + (side > 0 ? 0 : Math.PI);
}

export function platformContains(group, x, z, margin) {
  const v = group.worldToLocal(new THREE.Vector3(x, 0, z));
  return v.x > -0.6 - margin && v.x < PLATFORM_X + 0.6 + margin && Math.abs(v.z) < PLATFORM_LEN / 2 + margin;
}

// ---------- Passenger flow ----------

const MAX_WAITING = 10;
const BOARD_INTERVAL = 0.22;
const MIN_DWELL = 1.4;
const RESIDENTS_START = 8;
const RESIDENTS_PER_STATION = 6;
export const START_MONEY = 5000;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class PassengerSystem {
  constructor(scene, train, obstacles = []) {
    this.scene = scene;
    this.train = train;
    this.track = null;
    this.stations = [];
    this.robots = new Set(); // every resident on the island
    this.onboard = [];
    this.transit = new Set();
    this.floaters = [];
    this.money = START_MONEY;
    this.delivered = 0;
    this.state = 'running';
    this.next = 0;
    this.listeners = [];
    this.trackPts = [];
    this.obstacles = obstacles;
    this.looks = 0;
    this.#spawnResidents(RESIDENTS_START, null);
  }

  get residents() {
    return this.robots.size;
  }

  // True while a train is stopped at a station; building waits for it.
  get busy() {
    return this.state !== 'running';
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

  // Ground is walkable away from the rails, platforms, trees and houses.
  #isFree = (x, z) => {
    if (x * x + z * z > 21 * 21) return false;
    if (this.trackPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.3 ** 2)) return false;
    if (this.stations.some((s) => s.contains(x, z, 0.3))) return false;
    return !this.obstacles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r);
  };

  #wanderNear(p) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 3;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (this.#isFree(x, z)) return new THREE.Vector3(x, 0, z);
    }
    // Drift back toward the middle of the island if boxed in.
    return new THREE.Vector3(p.x * 0.85, 0, p.z * 0.85);
  }

  #nearestStation(p) {
    let best = null;
    for (const s of this.stations) {
      if (!best || s.group.position.distanceToSquared(p) < best.group.position.distanceToSquared(p)) best = s;
    }
    return best;
  }

  // New residents step out of a house (or arrive from the shore) and either
  // head for `station` or wander about.
  #spawnResidents(n, station) {
    const houses = this.obstacles.filter((o) => o.kind === 'house');
    for (let k = 0; k < n; k++) {
      const r = new Robot(randomLook(this.looks++));
      let start = null;
      const near = station
        ? houses.slice().sort((a, b) => station.group.position.distanceToSquared(new THREE.Vector3(a.x, 0, a.z)) - station.group.position.distanceToSquared(new THREE.Vector3(b.x, 0, b.z))).slice(0, 3)
        : houses;
      for (let i = 0; i < 20 && !start; i++) {
        const h = near.length ? pick(near) : null;
        const a = Math.random() * Math.PI * 2;
        const p = h
          ? new THREE.Vector3(h.x + Math.cos(a) * (h.r + 0.25), 0, h.z + Math.sin(a) * (h.r + 0.25))
          : new THREE.Vector3(Math.cos(a) * 20, 0, Math.sin(a) * 20);
        if (this.#isFree(p.x, p.z)) start = p;
      }
      r.mesh.position.copy(start ?? new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
      r.mesh.rotation.y = Math.random() * Math.PI * 2;
      this.robots.add(r);
      this.scene.add(r.mesh);
      this.#stroll(r, station, station ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3));
    }
  }

  #chooseTrip(r, from) {
    const others = this.stations.filter((x) => x !== from);
    r.origin = from;
    r.setDestination(others[Math.floor(Math.random() * others.length)]);
  }

  // Walk between a few spots (near a station, or wherever the robot is),
  // pausing to look around, then head for a platform.
  #stroll(r, s, legs) {
    r.state = 'strolling';
    r.home = s;
    r.target = null;
    r.setDestination(null);
    r.speed = 0.55 + Math.random() * 0.25;
    const step = (left) => {
      if (left <= 0) return this.#headToPlatform(r, r.home);
      const home = r.home && this.stations.includes(r.home) ? r.home : null;
      const spot = home ? home.wanderPoint(this.#isFree) : this.#wanderNear(r.mesh.position);
      r.walkTo([spot], () => r.wait(1.5 + Math.random() * 3.5, () => step(left - 1)));
    };
    step(legs);
  }

  #headToPlatform(r, s) {
    if (!s || !this.stations.includes(s)) s = this.#nearestStation(r.mesh.position);
    // Trips need somewhere to go: with fewer than two stations, keep strolling.
    if (!s || this.stations.length < 2) return this.#stroll(r, s, 2);
    if (s.waiting.length >= MAX_WAITING) return this.#stroll(r, s, 1);
    r.state = 'returning';
    r.target = s;
    r.speed = 0.9 + Math.random() * 0.2;
    const ramp = s.ramp(r.mesh.position);
    r.walkTo([ramp.bottom, ramp.top], () => {
      r.target = null;
      this.#chooseTrip(r, s);
      r.state = 'waiting';
      s.waiting.push(r);
      this.#regroup(s);
    });
  }

  // Step down off a platform that is being demolished and wander off.
  #leavePlatform(r, s) {
    r.setDestination(null);
    r.target = null;
    r.state = 'leaving';
    const p = r.mesh.position.clone().addScaledVector(s.outward, 1.6);
    p.y = 0;
    r.walkTo([p], () => this.#stroll(r, null, 2));
  }

  // A rider whose train lost its track or stations climbs out beside the car.
  #dropRider(r) {
    const v = r.vehicle;
    if (r.seat) r.seat.robot = null;
    const p = v
      ? v.body.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (v.hw + 0.7), 0, r.seat?.pos.z ?? 0))
      : r.mesh.getWorldPosition(new THREE.Vector3());
    p.y = 0;
    this.scene.attach(r.mesh);
    r.mesh.position.copy(p);
    r.vehicle = null;
    r.seat = null;
    r.transit = null;
    r.boarding = false;
    r.stand();
    r.setIndoor(false);
    this.#stroll(r, null, 2);
  }

  // ---------- Network changes from the build tools ----------

  // Lay the train on a new track, or (null) demolish it along with every
  // station. Returns false while a train is stopped at a platform.
  setTrack(track) {
    if (this.busy) return false;
    if (!track) {
      for (const s of [...this.stations]) this.removeStation(s);
      for (const r of [...this.onboard]) this.#dropRider(r);
      this.onboard = [];
    }
    this.track = track;
    this.train.setTrack(track);
    this.trackPts = track ? track.curve.getSpacedPoints(Math.ceil(track.length / 0.25)) : [];
    this.state = 'running';
    this.next = this.#nearestAhead();
    this.#emit();
    return true;
  }

  addStation(station) {
    this.stations.push(station);
    this.stations.sort((a, b) => a.d - b.d);
    this.scene.add(station.group, station.label.sprite);
    if (!this.busy) this.next = this.#nearestAhead();
    this.#spawnResidents(RESIDENTS_PER_STATION, station);
    // Residents already out strolling can now plan trips too.
    this.#emit();
  }

  removeStation(s) {
    if (this.busy) return false;
    this.stations.splice(this.stations.indexOf(s), 1);
    for (const r of s.waiting) this.#leavePlatform(r, s);
    s.waiting = [];
    for (const r of this.robots) {
      if (r.state === 'returning' && r.target === s) this.#leavePlatform(r, s);
      if (r.home === s) r.home = null;
    }
    // Anyone heading for the demolished station picks another destination.
    for (const st of this.stations) {
      for (const r of [...st.waiting]) {
        if (r.dest !== s) continue;
        const others = this.stations.filter((x) => x !== st);
        if (others.length) r.setDestination(pick(others));
        else {
          st.waiting.splice(st.waiting.indexOf(r), 1);
          this.#leavePlatform(r, st);
        }
      }
      this.#regroup(st);
    }
    for (const r of [...this.onboard]) {
      if (r.dest !== s) continue;
      if (this.stations.length) r.setDestination(pick(this.stations));
      else {
        this.onboard.splice(this.onboard.indexOf(r), 1);
        this.#dropRider(r);
      }
    }
    s.dispose();
    this.next = this.#nearestAhead();
    this.#emit();
    return true;
  }

  addFloater(f) {
    this.scene.add(f.sprite);
    this.floaters.push(f);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this);
  }

  get capacity() {
    return this.track ? this.train.capacity : 0;
  }

  get statusText() {
    if (!this.track) return '先用「鐵路」工具鋪一條環狀鐵路';
    if (!this.stations.length) return '在鐵路旁蓋車站，居民就會來搭車';
    if (this.stations.length === 1) return '再蓋一個車站，乘客才有地方去';
    const s = this.stations[this.next];
    if (this.state !== 'running') return `停靠 ${this.current.name}・上下車中`;
    return `下一站 ${s.name}`;
  }

  #consistLength() {
    const v = this.train.vehicles;
    return v.reduce((sum, x) => sum + x.length, 0) + (v.length - 1) * this.train.config.gap;
  }

  #stopTarget(station) {
    return station.d + this.#consistLength() / 2;
  }

  #remaining(station) {
    return THREE.MathUtils.euclideanModulo(this.#stopTarget(station) - this.train.distance, this.track.length);
  }

  #nearestAhead() {
    if (!this.track) return 0;
    let best = 0;
    let bestR = Infinity;
    this.stations.forEach((s, i) => {
      const r = this.#remaining(s);
      if (r > 0.5 && r < bestR) {
        bestR = r;
        best = i;
      }
    });
    return best;
  }

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
    const local = station.group.worldToLocal(p.clone());
    return Math.abs(local.z) < PLATFORM_LEN / 2 - 0.12;
  }

  // Doors on the platform side whose opening lines up with the platform.
  #usableDoors(v, station) {
    if (!v.doors) return [];
    const side = this.#platformSide(v, station);
    return v.doors.filter((d) => d.side === side && this.#onPlatform(this.#doorWorld(v, d), station));
  }

  // Best free seat for a robot standing at `from`, plus the door to reach it.
  #findSeat(from, station) {
    let best = null;
    for (const v of this.train.vehicles) {
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
    const trip = THREE.MathUtils.euclideanModulo(robot.dest.d - robot.origin.d, this.track.length);
    return Math.round(8 + trip * 0.8);
  }

  #setDoors(station) {
    for (const v of this.train.vehicles) v.openSide = station ? this.#platformSide(v, station) : 0;
  }

  #arrive(station) {
    this.state = 'dwell';
    this.current = station;
    this.dwell = 0;
    this.timer = 0.5; // let the doors slide open first
    this.walkingIn = 0;
    this.walkingOut = 0;
    this.#setDoors(station);
    this.#emit();
  }

  #depart() {
    this.state = 'running';
    this.next = this.#nearestAhead();
    this.#emit();
  }

  // Called each frame before the train moves.
  control(dt) {
    const train = this.train;
    if (!this.track || !this.stations.length) return;
    if (this.state === 'running') {
      const station = this.stations[this.next];
      const rem = this.#remaining(station);
      if (rem > this.track.length - 1.5) {
        // Train was moved past the stop (e.g. it grew longer); skip it.
        this.next = this.#nearestAhead();
        return;
      }
      const decel = 1.4 * train.config.speedScale;
      const cap = Math.sqrt(2 * decel * rem);
      if (train.speed > cap) train.speed = Math.max(cap, train.speed > 0 ? 0.3 : 0);
      if (train.speed > 0 && train.speed * dt >= rem) {
        train.speed = rem / dt;
        this.arriving = station;
      }
    } else {
      train.speed = 0;
    }
  }

  // Called each frame after the train moved.
  update(dt, time) {
    if (this.arriving) {
      const s = this.arriving;
      this.arriving = null;
      this.train.speed = 0;
      this.#arrive(s);
    }

    if (this.state === 'dwell') this.#dwell(dt);
    else if (this.state === 'closing') {
      this.timer -= dt;
      if (this.timer <= 0) this.#depart();
    }

    for (const r of this.robots) {
      r.update(dt, time);
    }
    this.floaters = this.floaters.filter((f) => {
      const alive = f.update(dt);
      if (!alive) {
        this.scene.remove(f.sprite);
        f.dispose();
      }
      return alive;
    });
  }

  #dwell(dt) {
    const s = this.current;
    this.dwell += dt;
    this.timer -= dt;
    if (this.timer > 0) return;

    const leaving = this.onboard.findIndex((r) => r.dest === s);
    if (leaving >= 0) {
      const r = this.onboard.splice(leaving, 1)[0];
      this.#disembark(r, s);
      this.timer = BOARD_INTERVAL;
      return;
    }
    for (const r of s.waiting) {
      if (r.boarding) continue;
      if (this.#board(r, s)) {
        this.timer = BOARD_INTERVAL;
        return;
      }
      break; // no seat reachable from the platform
    }
    if (this.walkingIn === 0 && this.walkingOut === 0 && this.dwell >= MIN_DWELL) {
      this.state = 'closing';
      this.timer = 0.6;
      this.#setDoors(null);
    }
  }

  #board(r, s) {
    const spot = this.#findSeat(r.mesh.position, s);
    if (!spot) return false;
    const { v, door, seat } = spot;
    seat.robot = r;
    r.boarding = true;
    r.vehicle = v;
    r.seat = seat;
    this.walkingIn++;
    r.speed = 1.2;
    r.walkTo([this.#doorWorld(v, door)], () => {
      if (!this.train.vehicles.includes(v)) return; // train was rebuilt meanwhile
      s.waiting.splice(s.waiting.indexOf(r), 1);
      this.#regroup(s);
      v.body.attach(r.mesh);
      r.setIndoor(true);
      r.transit = 'in';
      this.transit.add(r);
      const f = v.floorY;
      const front = seat.pos.z + 0.13;
      r.walkTo(
        [
          new THREE.Vector3(door.insideX, f, door.z),
          new THREE.Vector3(0, f, door.z),
          new THREE.Vector3(0, f, front),
          new THREE.Vector3(seat.pos.x, f, front),
        ],
        () => {
          r.sit(seat);
          r.boarding = false;
          r.transit = null;
          this.transit.delete(r);
          this.walkingIn--;
          this.onboard.push(r);
          this.#emit();
        },
      );
    });
    return true;
  }

  #disembark(r, s) {
    const v = r.vehicle;
    const seat = r.seat;
    let doors = this.#usableDoors(v, s);
    if (!doors.length) doors = v.doors.filter((d) => d.side === this.#platformSide(v, s));
    const door = doors.reduce((a, b) => (Math.abs(b.z - seat.pos.z) < Math.abs(a.z - seat.pos.z) ? b : a));
    const f = v.floorY;
    const front = seat.pos.z + 0.13;
    this.walkingOut++;
    r.transit = 'out';
    this.transit.add(r);
    r.stand();
    r.speed = 1.1;
    r.walkTo(
      [
        new THREE.Vector3(seat.pos.x, f, front),
        new THREE.Vector3(0, f, front),
        new THREE.Vector3(0, f, door.z),
        new THREE.Vector3(door.insideX, f, door.z),
        new THREE.Vector3(door.outsideX, PLATFORM_Y, door.z),
      ],
      () => {
        seat.robot = null;
        r.vehicle = null;
        r.seat = null;
        r.transit = null;
        this.transit.delete(r);
        this.scene.attach(r.mesh);
        r.setIndoor(false);
        this.walkingOut--;
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
    this.scene.add(text.sprite);
    this.floaters.push(text);
    r.setDestination(null);
    const ramp = s.ramp(r.mesh.position);
    r.walkTo([ramp.top, ramp.bottom], () => this.#stroll(r, s, 2 + Math.floor(Math.random() * 3)));
    this.#emit();
  }

  // A rider with no seat left steps off at the nearest station and strolls.
  #release(r) {
    const s = this.current && this.state !== 'running' ? this.current : null;
    if (!s) return this.#dropRider(r);
    r.vehicle = null;
    r.seat = null;
    r.stand();
    r.setIndoor(false);
    this.scene.add(r.mesh);
    r.mesh.position.copy(s.ramp(s.group.position).bottom);
    this.#stroll(r, s, 2);
  }

  // The train was rebuilt (new type or cars added/removed). Riders whose car
  // is gone move to a free seat elsewhere; if none is left they get off.
  reseat() {
    const alive = new Set(this.train.vehicles);
    // Robots caught walking inside a car that just vanished finish instantly.
    for (const r of [...this.transit]) {
      if (alive.has(r.vehicle)) continue;
      this.transit.delete(r);
      if (r.transit === 'in') {
        r.boarding = false;
        this.walkingIn--;
        this.onboard.push(r);
      } else {
        this.walkingOut--;
        this.delivered++;
        this.money += this.#fare(r);
        if (r.seat) r.seat.robot = null;
        this.#release(r);
      }
      r.transit = null;
    }
    for (const r of [...this.onboard]) {
      if (alive.has(r.vehicle)) continue;
      const free = this.train.vehicles.flatMap((v) => (v.seats ?? []).filter((s) => !s.robot).map((s) => [v, s]));
      if (!free.length) {
        this.onboard.splice(this.onboard.indexOf(r), 1);
        this.#release(r);
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
    // Robots still walking to a door of a car that no longer exists go back.
    for (const s of this.stations) {
      for (const r of s.waiting) {
        if (r.boarding && !alive.has(r.vehicle)) {
          r.boarding = false;
          r.vehicle = null;
          r.seat = null;
          this.walkingIn--;
          if (r.mesh.parent !== this.scene) this.scene.attach(r.mesh);
        }
      }
      this.#regroup(s);
    }
    if (this.state !== 'running' && this.current) this.#setDoors(this.state === 'dwell' ? this.current : null);
    this.next = this.state === 'running' ? this.#nearestAhead() : this.next;
    this.#emit();
  }
}
