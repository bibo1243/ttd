import * as THREE from 'three';
import { Carriage, Locomotive } from './steam.js';
import { BulletCar, TramCar } from './modern.js';
import { makeDriver } from './robots.js';
import { Path } from './network.js';
import { bakeStatic, heldObjects } from './bake.js';

export const TRAIN_TYPES = {
  steam: {
    label: '蒸汽火車',
    head: () => new Locomotive(),
    mid: (i) => new Carriage(i),
    gap: 0.12,
    defaultMid: 4,
    maxMid: 10,
    speedScale: 1,
    smoke: true,
  },
  bullet: {
    label: '高鐵',
    head: () => new BulletCar('head'),
    mid: (i) => new BulletCar('mid', i),
    tail: () => new BulletCar('tail'),
    gap: 0.05,
    defaultMid: 3,
    maxMid: 8,
    speedScale: 1.8,
  },
  tram: {
    label: '路面電車',
    head: () => new TramCar('head'),
    mid: () => new TramCar('mid'),
    tail: () => new TramCar('tail'),
    gap: 0.03,
    defaultMid: 1,
    maxMid: 4,
    speedScale: 0.7,
  },
};

let trainNo = 1;

// A train runs on the rail network along its line's stations. It drives a
// Path rebuilt for every leg, and holds the track it occupies or is about to
// use (block signalling), so trains never share a block.
export class Train {
  constructor(scene, network, type = 'steam') {
    this.scene = scene;
    this.network = network;
    this.no = trainNo++;
    this.path = null;
    this.distance = 0; // of the leading end along the path
    this.travelled = 0;
    this.speed = 0;
    this.reversed = false;
    this.vehicles = [];
    this.held = { edges: new Set(), nodes: new Set() };
    this.entries = new Set();
    this.smoke = new Smoke(scene);
    // Passenger-side state (see PassengerSystem).
    this.line = null;
    this.state = 'idle';
    this.onboard = [];
    this.setType(type);
  }

  get name() {
    return `${this.no} 號車`;
  }

  setType(type) {
    for (const v of this.vehicles) this.scene.remove(v.group);
    this.type = type;
    this.config = TRAIN_TYPES[type];
    this.mids = [];
    for (let i = 0; i < this.config.defaultMid; i++) this.mids.push(this.config.mid(i));
    this.head = null;
    this.#assemble();
  }

  #assemble() {
    const c = this.config;
    if (!this.head || this.head.type !== this.type) {
      this.head = c.head();
      this.head.type = this.type;
      if (this.head.cabin) {
        const { pos, rotY, scale } = this.head.cabin;
        this.driver = makeDriver();
        this.driver.mesh.position.copy(pos);
        this.driver.mesh.rotation.y = rotY;
        this.driver.scale = scale;
        this.driver.mesh.traverse((m) => (m.castShadow = false));
        this.head.body.add(this.driver.mesh);
      }
      this.tail = c.tail ? c.tail() : null;
    }
    for (const v of this.vehicles) this.scene.remove(v.group);
    this.vehicles = [this.head, ...this.mids, ...(this.tail ? [this.tail] : [])];
    for (const v of this.vehicles) {
      // Merge each car's static parts; wheels, rods and doors keep moving.
      if (!v.baked) {
        bakeStatic(v.group, { anchors: [v.group, v.body], keep: heldObjects(v, [v.group, v.body]), batchKept: true });
        v.baked = true;
      }
      v.group.visible = !!this.path;
      this.scene.add(v.group);
    }
    if (this.path) this.#place(0);
  }

  get lead() {
    return this.vehicles[0];
  }

  // Longer trains need more room, so only change length while stopped.
  addCar() {
    if (this.mids.length >= this.config.maxMid) return;
    this.mids.push(this.config.mid(this.mids.length));
    this.#assemble();
  }

  removeCar() {
    if (this.mids.length === 0) return;
    this.mids.pop();
    this.#assemble();
  }

  get capacity() {
    return this.vehicles.reduce((sum, v) => sum + (v.seats?.length ?? 0), 0);
  }

  get carCount() {
    return this.vehicles.length;
  }

  get consistLength() {
    const v = this.vehicles;
    return v.reduce((sum, x) => sum + x.length, 0) + (v.length - 1) * this.config.gap;
  }

  get centre() {
    return this.distance - this.consistLength / 2;
  }

  // World position and heading of the middle of the train.
  get position() {
    return this.path ? this.path.pointAt(this.centre) : null;
  }

  // ---------- Track reservation ----------

  #canHold(span) {
    for (const e of span.edges) if (e.reservedBy && e.reservedBy !== this) return false;
    for (const n of span.nodes) if (n.reservedBy && n.reservedBy !== this) return false;
    return true;
  }

  #hold(span) {
    this.releaseAll();
    for (const e of span.edges) e.reservedBy = this;
    for (const n of span.nodes) n.reservedBy = this;
    this.held = { edges: new Set(span.edges), nodes: new Set(span.nodes) };
    this.entries = new Set(span.entries);
  }

  releaseAll() {
    for (const e of this.held.edges) if (e.reservedBy === this) e.reservedBy = null;
    for (const n of this.held.nodes) if (n.reservedBy === this) n.reservedBy = null;
    this.held = { edges: new Set(), nodes: new Set() };
    this.entries = new Set();
  }

  // Let go of track the whole train has passed.
  #releaseBehind() {
    const span = this.path.span(this.distance - this.consistLength - 0.2, this.reserveTo);
    for (const e of this.held.edges) {
      if (!span.edges.has(e)) {
        if (e.reservedBy === this) e.reservedBy = null;
        this.held.edges.delete(e);
      }
    }
    for (const n of this.held.nodes) {
      if (!span.nodes.has(n)) {
        if (n.reservedBy === this) n.reservedBy = null;
        this.held.nodes.delete(n);
      }
    }
  }

  // Does this train use the given edge now or on its way to the next stop?
  uses(edge) {
    return this.held.edges.has(edge);
  }

  // ---------- Driving ----------

  // Stand the train at a station, centred on its node, facing `dir`.
  // False if that track is held by another train.
  spawnAt(station) {
    const net = this.network;
    const half = this.consistLength / 2;
    const dir = station.dir.clone();
    const back = net.trace(station.node, dir.clone().negate(), half + 6);
    const ahead = net.trace(station.node, dir, half + 6);
    const tail = reversePieces(back);
    const path = new Path([...tail, ...ahead]);
    const tailLen = tail.reduce((s, p) => s + Math.abs(p.t1 - p.t0), 0);
    const span = path.span(tailLen - half - 0.2, tailLen + half + 0.2);
    if (!this.#canHold(span)) return false;
    this.path = path;
    this.reversed = false;
    this.distance = tailLen + half;
    this.stopAt = tailLen;
    this.reserveTo = this.distance + 0.2;
    this.#hold(span);
    for (const v of this.vehicles) v.group.visible = true;
    this.#place(0);
    return true;
  }

  // Plan the run from the node the train stands at to node `to`.
  // Returns 'ok', 'noroute' or 'blocked' (track ahead held: wait at the signal).
  startLeg(from, to) {
    const net = this.network;
    const half = this.consistLength / 2;
    const centre = this.centre;
    const facing = this.path.tangentAt(centre);
    const route = net.findPath(from, to, facing);
    if (!route) return 'noroute';
    const leg = route.map(({ edge, sign }) => (sign > 0 ? { edge, t0: 0, t1: edge.length } : { edge, t0: edge.length, t1: 0 }));
    const legLen = leg.reduce((s, p) => s + Math.abs(p.t1 - p.t0), 0);
    const first = route[0];
    const legDir = first.edge.dirAt(from);
    const turn = legDir.dot(facing) < 0;
    const tail = turn ? this.path.stretch(centre + half + 1, centre) : this.path.stretch(centre - half - 1, centre);
    const arriveDir = route[route.length - 1].edge.dirAt(to).negate();
    const overrun = net.trace(to, arriveDir, half + 3);
    const path = new Path([...tail, ...leg, ...overrun]);
    const tailLen = tail.reduce((s, p) => s + Math.abs(p.t1 - p.t0), 0);
    const stopAt = tailLen + legLen;
    const span = path.span(tailLen - half - 0.2, stopAt + half + 0.2);
    if (!this.#canHold(span)) return 'blocked';
    this.path = path;
    if (turn) this.reversed = !this.reversed;
    this.distance = tailLen + half;
    this.stopAt = stopAt;
    this.reserveTo = stopAt + half + 0.2;
    this.#hold(span);
    return 'ok';
  }

  // Distance left before the train's middle reaches its stop.
  get remaining() {
    return this.stopAt - this.centre;
  }

  // Take the train off the rails entirely.
  remove() {
    this.releaseAll();
    this.path = null;
    for (const v of this.vehicles) v.group.removeFromParent();
    this.smoke.dispose();
  }

  #place(time) {
    let d = this.distance;
    let prevHalf = 0;
    const order = this.reversed ? [...this.vehicles].reverse() : this.vehicles;
    for (const v of order) {
      d -= prevHalf + (prevHalf ? this.config.gap : 0) + v.length / 2;
      v.speedFactor = this.speed / 4;
      v.place(this.path, d, this.travelled, time, this.reversed);
      prevHalf = v.length / 2;
    }
  }

  update(dt, time) {
    if (!this.path) return;
    const step = this.speed * dt;
    this.distance += step;
    this.travelled += step;
    for (const v of this.vehicles) v.dt = dt;
    this.#place(time);
    this.#releaseBehind();
    this.driver?.update(dt, time);
    const top = this.head.chimneyTop?.getWorldPosition(new THREE.Vector3());
    this.smoke.update(dt, top, this.config.smoke ? this.speed : 0);
  }
}

function reversePieces(pieces) {
  return [...pieces].reverse().map((p) => ({ edge: p.edge, t0: p.t1, t1: p.t0 }));
}

class Smoke {
  constructor(scene) {
    this.pool = [];
    this.timer = 0;
    const geo = new THREE.IcosahedronGeometry(0.12, 1);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, flatShading: true }),
      );
      m.visible = false;
      m.userData = { life: 0, max: 1, vel: new THREE.Vector3() };
      scene.add(m);
      this.pool.push(m);
    }
  }

  dispose() {
    for (const m of this.pool) {
      m.removeFromParent();
      m.material.dispose();
    }
    this.pool = [];
  }

  update(dt, origin, speed) {
    this.timer -= dt;
    if (speed > 0.05 && this.timer <= 0) {
      this.timer = 0.6 / (1 + speed * 0.6);
      const p = this.pool.find((m) => !m.visible);
      if (p) {
        p.visible = true;
        p.position.copy(origin);
        p.userData.life = 0;
        p.userData.max = 1.4 + Math.random() * 0.6;
        p.userData.vel.set((Math.random() - 0.5) * 0.25, 0.7 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25);
        p.scale.setScalar(0.6);
      }
    }
    for (const p of this.pool) {
      if (!p.visible) continue;
      const u = p.userData;
      u.life += dt;
      const k = u.life / u.max;
      if (k >= 1) {
        p.visible = false;
        continue;
      }
      p.position.addScaledVector(u.vel, dt);
      p.scale.setScalar(0.6 + k * 1.8);
      p.material.opacity = 0.85 * (1 - k);
    }
  }
}
