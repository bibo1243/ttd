import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const UP = new THREE.Vector3(0, 1, 0);
const PLATFORM_Y = 0.3;
const PLATFORM_LEN = 8;
const PLATFORM_X = 0.95; // platform centre, measured outward from the rails

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

export const STATION_DEFS = [
  { name: '森林站', color: 0x3f9b5f, at: [10, 0] },
  { name: '湖畔站', color: 0x3a86d4, at: [0, 10.6] },
  { name: '小鎮站', color: 0xe8893a, at: [0.5, -10.5] },
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

class FloatText {
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

// ---------- Robots ----------

const G = {
  body: new RoundedBoxGeometry(0.16, 0.13, 0.12, 2, 0.04),
  head: new RoundedBoxGeometry(0.19, 0.14, 0.15, 3, 0.055),
  visor: new RoundedBoxGeometry(0.15, 0.075, 0.02, 2, 0.03),
  eye: new THREE.SphereGeometry(0.016, 10, 8),
  stalk: new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6),
  ball: new THREE.SphereGeometry(0.02, 10, 8),
  leg: new THREE.CapsuleGeometry(0.022, 0.03, 4, 8),
  arm: new THREE.SphereGeometry(0.03, 10, 8),
};
const RM = {
  white: new THREE.MeshPhysicalMaterial({ color: 0xf6f7f9, roughness: 0.3, clearcoat: 0.5 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.1, metalness: 0.5 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x4fe0ff, emissiveIntensity: 1.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6 }),
};
const paintCache = new Map();
const paint = (color) => {
  if (!paintCache.has(color)) {
    paintCache.set(color, new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.4 }));
  }
  return paintCache.get(color);
};
const glowCache = new Map();
const glow = (color) => {
  if (!glowCache.has(color)) {
    glowCache.set(color, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
  }
  return glowCache.get(color);
};

function makeRobot(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); // hops and sways
  g.add(inner);
  const legs = [];
  const body = new THREE.Mesh(G.body, paint(color));
  body.position.y = 0.13;
  const head = new THREE.Mesh(G.head, RM.white);
  head.position.y = 0.27;
  const visor = new THREE.Mesh(G.visor, RM.visor);
  visor.position.set(0, 0.275, 0.07);
  inner.add(body, head, visor);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(G.eye, RM.eye);
    eye.position.set(side * 0.035, 0.278, 0.082);
    eye.scale.set(1, 1.3, 0.5);
    const leg = new THREE.Mesh(G.leg, RM.dark);
    leg.position.set(side * 0.045, 0.045, 0);
    const arm = new THREE.Mesh(G.arm, paint(color));
    arm.position.set(side * 0.1, 0.14, 0);
    arm.scale.set(0.8, 1.2, 0.8);
    inner.add(eye, leg, arm);
    legs.push(leg);
  }
  const stalk = new THREE.Mesh(G.stalk, RM.dark);
  stalk.position.y = 0.37;
  const ball = new THREE.Mesh(G.ball, glow(color));
  ball.position.y = 0.41;
  inner.add(stalk, ball);
  g.userData.inner = inner;
  g.userData.legs = legs;
  shadowed(g);
  // Robots ride inside cars, where the roof's shadow would make them murky.
  g.traverse((c) => (c.receiveShadow = false));
  return g;
}

class Robot {
  constructor(dest, origin, color) {
    this.dest = dest;
    this.origin = origin;
    this.mesh = makeRobot(color);
    this.path = [];
    this.onArrive = null;
    this.phase = Math.random() * 10;
    this.speed = 0.9 + Math.random() * 0.25;
    this.scale = 1;
  }

  walkTo(points, onArrive) {
    this.path = points.map((p) => p.clone());
    this.onArrive = onArrive;
  }

  sit(seat) {
    this.seated = true;
    this.path = [];
    this.mesh.position.copy(seat.pos);
    this.mesh.rotation.y = 0;
    for (const leg of this.mesh.userData.legs) {
      leg.rotation.x = Math.PI / 2;
      leg.position.set(leg.position.x, 0.072, 0.055);
    }
  }

  stand() {
    this.seated = false;
    for (const leg of this.mesh.userData.legs) {
      leg.rotation.x = 0;
      leg.position.set(leg.position.x, 0.045, 0);
    }
  }

  update(dt, time) {
    const inner = this.mesh.userData.inner;
    if (this.path.length) {
      const target = this.path[0];
      const pos = this.mesh.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (dist <= step) {
        pos.copy(target);
        this.path.shift();
        if (!this.path.length && this.onArrive) {
          const cb = this.onArrive;
          this.onArrive = null;
          cb(this);
        }
      } else {
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        pos.y += (target.y - pos.y) * Math.min(1, dt * 10);
        const want = Math.atan2(dx, dz);
        const diff = THREE.MathUtils.euclideanModulo(want - this.mesh.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        this.mesh.rotation.y += diff * Math.min(1, dt * 12);
      }
      inner.position.y = Math.abs(Math.sin(time * 13 + this.phase)) * 0.035;
      inner.rotation.z = Math.sin(time * 13 + this.phase) * 0.12;
    } else if (this.seated) {
      // Gentle sway with the ride.
      inner.position.y = 0;
      inner.rotation.z = Math.sin(time * 3 + this.phase) * 0.03;
    } else {
      inner.position.y = Math.max(0, Math.sin(time * 2.5 + this.phase)) * 0.012;
      inner.rotation.z = Math.sin(time * 1.3 + this.phase) * 0.04;
    }
    if (this.grow) {
      this.scale = Math.min(1, this.scale + dt * 3);
      if (this.scale >= 1) this.grow = false;
    }
    this.mesh.scale.setScalar(this.scale);
  }
}

// ---------- Stations ----------

function makePlatform(color) {
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
  return shadowed(g);
}

class Station {
  constructor(index, def, track) {
    this.index = index;
    this.name = def.name;
    this.color = def.color;
    this.d = nearestDistance(track, def.at[0], def.at[1]);
    this.waiting = [];
    this.spawnTimer = 1 + Math.random() * 2;

    const p = track.pointAt(this.d);
    const t = track.tangentAt(this.d);
    this.group = makePlatform(def.color);
    this.group.position.copy(p);
    this.group.rotation.y = Math.atan2(t.x, t.z);
    this.group.updateMatrixWorld(true);
    this.outward = new THREE.Vector3().crossVectors(t, UP).normalize().negate();
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

  contains(x, z, margin) {
    const v = this.group.worldToLocal(new THREE.Vector3(x, 0, z));
    return v.x > -0.6 - margin && v.x < PLATFORM_X + 0.6 + margin && Math.abs(v.z) < PLATFORM_LEN / 2 + margin;
  }
}

function nearestDistance(track, x, z) {
  let best = 0;
  let bestD = Infinity;
  const p = new THREE.Vector3();
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * track.length;
    track.pointAt(d, p);
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

export function createStations(scene, track) {
  return STATION_DEFS.map((def, i) => {
    const s = new Station(i, def, track);
    scene.add(s.group, s.label.sprite);
    return s;
  });
}

// ---------- Passenger flow ----------

const MAX_WAITING = 10;
const BOARD_INTERVAL = 0.22;
const MIN_DWELL = 1.4;

export class PassengerSystem {
  constructor(scene, track, train, stations) {
    this.scene = scene;
    this.track = track;
    this.train = train;
    this.stations = [...stations].sort((a, b) => a.d - b.d);
    this.robots = new Set(); // robots visible in the world
    this.onboard = [];
    this.transit = new Set();
    this.floaters = [];
    this.money = 0;
    this.delivered = 0;
    this.state = 'running';
    this.next = this.#nearestAhead();
    this.listeners = [];
    for (const s of this.stations) for (let i = 0; i < 3; i++) this.#spawn(s);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this);
  }

  get capacity() {
    return this.train.capacity;
  }

  get statusText() {
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

  #spawn(station) {
    if (station.waiting.length >= MAX_WAITING) return;
    const others = this.stations.filter((s) => s !== station);
    const dest = others[Math.floor(Math.random() * others.length)];
    const r = new Robot(dest, station, dest.color);
    const spot = station.waitingSpot(station.waiting.length);
    // Robots stroll in from the back of the platform.
    r.mesh.position.copy(spot).addScaledVector(station.outward, 0.2);
    r.scale = 0.2;
    r.grow = true;
    r.walkTo([spot], () => this.#faceTrack(r, station));
    station.waiting.push(r);
    this.robots.add(r);
    this.scene.add(r.mesh);
    station.label.draw(station.waiting.length);
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
    this.next = (this.next + 1) % this.stations.length;
    this.#emit();
  }

  // Called each frame before the train moves.
  control(dt) {
    const train = this.train;
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

    for (const s of this.stations) {
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0) {
        s.spawnTimer = 2.5 + Math.random() * 2.5;
        if (!(this.state !== 'running' && this.current === s)) this.#spawn(s);
      }
    }

    if (this.state === 'dwell') this.#dwell(dt);
    else if (this.state === 'closing') {
      this.timer -= dt;
      if (this.timer <= 0) this.#depart();
    }

    for (const r of this.robots) {
      r.update(dt, time);
      if (r.vanishing) {
        r.scale -= dt * 4;
        if (r.scale <= 0.05) {
          r.mesh.removeFromParent();
          this.robots.delete(r);
        }
      }
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
    const exit = r.mesh.position.clone().addScaledVector(s.outward, 0.75);
    r.walkTo([exit], () => this.#vanish(r));
    this.#emit();
  }

  #vanish(r) {
    r.vanishing = true;
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
        r.mesh.removeFromParent();
        this.robots.delete(r);
      }
      r.transit = null;
    }
    for (const r of [...this.onboard]) {
      if (alive.has(r.vehicle)) continue;
      const free = this.train.vehicles.flatMap((v) => (v.seats ?? []).filter((s) => !s.robot).map((s) => [v, s]));
      if (!free.length) {
        this.onboard.splice(this.onboard.indexOf(r), 1);
        r.mesh.removeFromParent();
        this.robots.delete(r);
        continue;
      }
      const [v, seat] = free[0];
      seat.robot = r;
      r.vehicle = v;
      r.seat = seat;
      v.body.add(r.mesh);
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
