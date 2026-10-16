import * as THREE from 'three';
import { VEHICLE_MODELS, buildVehicle } from '../vehicles/models.js';
import { animateRiders, crewVehicle, makeRider, seatRider } from '../vehicles/crew.js';
import { Polyline, ROAD_HALF, WALK, crossings } from './net.js';
import { STOP_NAMES, StopLabel, makeGate, makeShelter } from './props.js';

// Road traffic: vehicles following lanes with car-following, junction
// right-of-way, braking for pedestrians and level crossings; buses running
// between bus stops where robot commuters queue, board, ride and pay fares.

const UP = new THREE.Vector3(0, 1, 0);
const BRAKE = 2.6; // comfortable deceleration
const ACCEL = 1.3;
const MAX_STOP_WAIT = 8;
const MAX_COMMUTERS = 36;
const PER_STOP = 3;
const BOARD_GAP = 0.45;
const SIDEWALK_Y = 0.05;
const ISLAND_R = 21;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const between = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

let vid = 1;

export class Traffic {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.scene = game.scene;
    this.vehicles = [];
    this.stops = [];
    this.commuters = new Set();
    this.crossings = [];
    this.railVersion = -1;
    this.delivered = 0;
    this.stopSerial = 0;
  }

  // ---------- Vehicles ----------

  get buses() {
    return this.vehicles.filter((v) => v.kind === 'bus');
  }

  // Put a new vehicle of `type` ({key, model, color}) somewhere free.
  spawn(type) {
    const lanes = this.net.lanes.filter((l) => l.length > 1.2);
    if (!lanes.length) return null;
    const v = buildVehicle(type.model, type.color ?? undefined, { route: String(this.buses.length + 1) });
    v.id = vid++;
    v.type = type.key;
    v.maxSpeed = VEHICLE_MODELS[type.model].speed * between(0.88, 1.08);
    const extra = { sedan: [0, 3], taxi: [0, 2], van: [0, 1], scooter: [0, 1], bicycle: [0, 0], bus: [0, 0] }[v.kind] ?? [0, 0];
    crewVehicle(v, { passengers: Math.round(between(extra[0], extra[1] + 0.49)) });
    for (let tries = 0; tries < 40; tries++) {
      const lane = pick(lanes);
      const s = between(Math.min(v.len / 2, lane.length / 2), Math.max(lane.length / 2, lane.length - v.len / 2));
      const p = lane.path.pointAt(s);
      if (this.vehicles.some((o) => o.pos.distanceTo(p) < (o.len + v.len) / 2 + 0.5)) continue;
      this.#putOn(v, lane, s);
      this.scene.add(v.group);
      this.vehicles.push(v);
      if (v.kind === 'bus') this.#nextStop(v);
      return v;
    }
    this.#disposeVehicle(v);
    return null;
  }

  despawn(v) {
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    this.#release(v);
    // Bus riders get off where the bus is.
    for (const seat of v.seats ?? []) {
      const r = seat.robot;
      if (r && this.commuters.has(r)) {
        seat.robot = null;
        this.#dropAt(r, v.group.position);
      }
    }
    for (const s of this.stops) for (const r of s.waiting) if (r.bus === v) r.bus = null;
    this.#disposeVehicle(v);
  }

  #disposeVehicle(v) {
    v.group.removeFromParent();
    for (const r of v.riders ?? []) if (!this.commuters.has(r)) r.mesh.removeFromParent();
  }

  #putOn(v, lane, s) {
    v.lane = lane;
    v.conn = null;
    v.s = s;
    v.speed = v.speed ?? 0;
    v.next = this.#chooseNext(v, lane);
    v.pos = lane.path.pointAt(s);
    const t = lane.path.tangentAt(s);
    v.yaw = Math.atan2(t.x, t.z);
    v.heading = t.clone();
    v.granted = null;
    v.place = true;
  }

  #path(v) {
    return v.conn ? v.conn.path : v.lane.path;
  }

  #release(v) {
    if (v.granted?._occ) v.granted._occ.delete(v);
    v.granted = null;
  }

  #chooseNext(v, lane) {
    const exits = this.net.exits(lane);
    if (!exits.length) return null;
    if (v.route?.length) {
      const want = v.route[0];
      if (exits.includes(want)) {
        v.route.shift();
        return want;
      }
      v.route = null;
    }
    const ahead = exits.filter((l) => l.seg !== lane.seg);
    return pick(ahead.length ? ahead : exits);
  }

  // After the road network changes: move every vehicle onto the nearest
  // lane that runs its way, and re-plan.
  networkChanged() {
    for (const n of this.net.nodes) n._occ = new Set();
    for (const v of [...this.vehicles]) {
      v.granted = null;
      const best = this.net.nearestLane(v.pos, v.heading);
      if (!best || best.score > 1.2) {
        this.despawn(v);
        continue;
      }
      this.#putOn(v, best.lane, best.s);
    }
    this.#remapStops();
    this.railVersion = -1;
    for (const b of this.buses) if (b.state !== 'dwell') this.#nextStop(b, b.target);
  }

  // ---------- Bus stops ----------

  // Where a stop on `seg` at distance s, side ±1, stands.
  stopFrame(seg, s, side) {
    const p = seg.line.pointAt(s);
    const t = seg.line.tangentAt(s);
    const out = new THREE.Vector3().crossVectors(t, UP).normalize().multiplyScalar(side);
    const origin = p.clone().addScaledVector(out, ROAD_HALF + WALK);
    return { p, t, out, origin, yaw: Math.atan2(-out.x, -out.z) };
  }

  addStop(seg, s, side, name) {
    const f = this.stopFrame(seg, s, side);
    const used = new Set(this.stops.map((x) => x.name));
    name ??= STOP_NAMES.find((n) => !used.has(n)) ?? `${STOP_NAMES[this.stops.length % STOP_NAMES.length]}${this.stops.length}`;
    const group = makeShelter();
    group.position.copy(f.origin);
    group.rotation.y = f.yaw;
    const label = new StopLabel(name);
    label.sprite.position.copy(f.origin).addScaledVector(f.out, 0.2).setY(1.75);
    this.scene.add(group, label.sprite);
    const stop = { id: ++this.stopSerial, seg, s, side, name, group, label, waiting: [], pos: f.origin.clone() };
    this.#frameStop(stop);
    this.stops.push(stop);
    this.#spawnCommuters(stop, PER_STOP);
    for (const b of this.buses) if (!b.target && b.state !== 'dwell') this.#nextStop(b);
    return stop;
  }

  removeStop(stop) {
    const i = this.stops.indexOf(stop);
    if (i < 0) return;
    this.stops.splice(i, 1);
    stop.group.removeFromParent();
    stop.label.sprite.removeFromParent();
    stop.label.dispose();
    for (const r of [...stop.waiting]) this.#stroll(r, null, 2);
    stop.waiting = [];
    for (const r of this.commuters) {
      if (r.home === stop) r.home = null;
      if (r.busDest === stop) r.busDest = this.stops.length ? pick(this.stops) : null;
      if (r.state === 'toStop' && r.target === stop) this.#stroll(r, null, 1);
    }
    for (const b of this.buses) {
      if (b.target === stop) {
        if (b.state === 'dwell') this.#endDwell(b);
        else this.#nextStop(b);
      }
      // Riders with nowhere left to go get off here.
      if (!this.stops.length) for (const seat of b.seats) if (seat.robot) this.#alight(seat.robot, b, null);
    }
  }

  #frameStop(stop) {
    stop.lane = stop.seg.lanes[stop.side > 0 ? 1 : -1];
    stop.laneS = stop.lane ? stop.lane.fromSeg(stop.s) : 0;
  }

  #remapStops() {
    for (const stop of [...this.stops]) {
      if (this.net.segs.has(stop.seg)) {
        this.#frameStop(stop);
        continue;
      }
      const best = this.net.nearestSeg(stop.pos.x, stop.pos.z);
      // The stop's sidewalk origin is ROAD_HALF + WALK from the centre line.
      if (!best || best.dist > ROAD_HALF + WALK + 0.3) {
        this.removeStop(stop);
        continue;
      }
      const t = best.seg.line.tangentAt(best.s);
      const side = Math.sign(new THREE.Vector3().crossVectors(t, UP).dot(tmp.subVectors(stop.pos, best.pos))) || 1;
      stop.seg = best.seg;
      stop.s = best.s;
      stop.side = side;
      this.#frameStop(stop);
    }
  }

  // Local spot i in the queue: the first three sit on the bench.
  #queueSpot(stop, i) {
    const local = i < 3 ? new THREE.Vector3(-0.42 + i * 0.25, SIDEWALK_Y, -0.3) : new THREE.Vector3(0.38 - (i - 3) * 0.2, SIDEWALK_Y, 0.1);
    return stop.group.localToWorld(local);
  }

  #bus(v) {
    return v.kind === 'bus';
  }

  // Head for the next stop on the round (stops in the order they were built).
  #nextStop(v, from = v.target) {
    v.state = 'driving';
    if (!this.stops.length) {
      v.target = null;
      v.route = null;
      return;
    }
    const i = from ? this.stops.indexOf(from) : -1;
    v.target = this.stops[(i + 1 + this.stops.length) % this.stops.length] ?? this.stops[0];
    this.#planRoute(v);
  }

  #planRoute(v) {
    const goal = v.target?.lane;
    if (!goal || !v.lane) {
      v.route = null;
      return;
    }
    const busS = this.#busStopS(v, v.target);
    if (v.lane === goal && busS > v.s + 0.3) {
      v.route = [];
      v.next = this.#chooseNext(v, v.lane);
      return;
    }
    let best = null;
    for (const x of this.net.exits(v.lane)) {
      const r = x === goal ? [] : this.net.route(x, goal);
      if (!r) continue;
      const len = r.reduce((s, l) => s + l.length, x.length);
      if (!best || len < best.len) best = { len, route: [x, ...r] };
    }
    v.route = best ? best.route : null;
    v.next = this.#chooseNext(v, v.lane);
  }

  #busStopS(v, stop) {
    // Front door level with the stop's sign pole.
    return THREE.MathUtils.clamp(stop.laneS + 0.62 - 1.1, v.len / 2, Math.max(v.len / 2, stop.lane.length - 0.1));
  }

  // ---------- Commuters ----------

  #spawnCommuters(stop, n) {
    for (let k = 0; k < n && this.commuters.size < MAX_COMMUTERS; k++) {
      const r = makeRider({ items: true });
      r.mesh.position.copy(this.#strollSpot(stop.pos));
      r.mesh.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(r.mesh);
      this.commuters.add(r);
      r.commuter = true;
      this.#stroll(r, stop, 1 + Math.floor(Math.random() * 2));
    }
  }

  #offRoad(x, z, margin = 0.25) {
    if (x * x + z * z > ISLAND_R * ISLAND_R) return false;
    const ns = this.net.nearestSeg(x, z);
    if (ns && ns.dist < ROAD_HALF + margin) return false;
    const stations = this.game.passengers.stations ?? [];
    if (stations.some((s) => s.contains?.(x, z, 0.3))) return false;
    for (const e of this.game.network.edges) if (e.samples.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.1)) return false;
    return !this.game.world.obstacles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r);
  }

  #strollSpot(near) {
    for (let i = 0; i < 25; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.8 + Math.random() * 2.4;
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      if (this.#offRoad(x, z, WALK + 0.1)) return new THREE.Vector3(x, 0, z);
    }
    return near.clone().setY(SIDEWALK_Y);
  }

  #stroll(r, stop, legs) {
    r.state = 'stroll';
    r.home = stop ?? r.home ?? null;
    r.target = null;
    r.setDestination?.(null);
    r.speed = (0.5 + Math.random() * 0.25) * (r.personality?.speed ?? 1);
    const step = (left) => {
      if (r.state !== 'stroll') return;
      if (left <= 0) return this.#goWait(r);
      const centre = r.home && this.stops.includes(r.home) ? r.home.pos : r.mesh.position;
      r.walkTo([this.#strollSpot(centre)], () => r.wait(between(1.5, 4.5), () => step(left - 1)));
    };
    step(legs);
  }

  #goWait(r) {
    let stop = r.home && this.stops.includes(r.home) ? r.home : null;
    if (!stop) {
      stop = this.stops.reduce((b, s) => (!b || s.pos.distanceTo(r.mesh.position) < b.pos.distanceTo(r.mesh.position) ? s : b), null);
    }
    if (!stop || this.stops.length < 2 || stop.waiting.length >= 8) return this.#stroll(r, stop, 2);
    r.state = 'toStop';
    r.target = stop;
    r.busDest = pick(this.stops.filter((s) => s !== stop));
    r.speed = (0.8 + Math.random() * 0.2) * (r.personality?.speed ?? 1);
    r.walkTo([stop.pos.clone().addScaledVector(tmp.set(Math.sin(stop.group.rotation.y), 0, Math.cos(stop.group.rotation.y)), -0.25).setY(SIDEWALK_Y)], () => {
      if (r.state !== 'toStop' || !this.stops.includes(stop)) return this.#stroll(r, null, 1);
      r.state = 'waiting';
      r.origin = stop;
      stop.waiting.push(r);
      this.#regroup(stop);
    });
  }

  // Line the queue up again (after someone boards or arrives).
  #regroup(stop) {
    stop.waiting.forEach((r, i) => {
      const spot = this.#queueSpot(stop, i);
      const sit = i < 3;
      if (r.seated && r.mesh.position.distanceTo(spot) < 0.02) return;
      if (r.seated) r.stand();
      r.walkTo([spot], () => {
        if (r.state !== 'waiting') return;
        if (sit) {
          r.sit({ pos: spot.clone().setY(0.2) });
          r.mesh.userData.inner.scale.x = 1;
        }
        r.mesh.rotation.y = stop.group.rotation.y;
      });
    });
    stop.label.draw(stop.waiting.length);
  }

  #dropAt(r, at) {
    this.scene.attach(r.mesh);
    r.stand();
    r.setIndoor(false);
    r.scale = 1;
    r.vehicle = null;
    r.seat = null;
    const p = this.#strollSpot(at);
    r.mesh.position.set(r.mesh.position.x, 0, r.mesh.position.z);
    r.mesh.rotation.x = r.mesh.rotation.z = 0;
    r.walkTo([p], () => this.#stroll(r, null, 2));
  }

  // ---------- Boarding and alighting ----------

  #door(v, front) {
    return v.doors.reduce((b, d) => (front ? d.z > b.z : d.z < b.z) ? d : b);
  }

  #startDwell(v) {
    v.state = 'dwell';
    v.dwell = 0;
    v.boardTimer = 0.6;
    v.walking = 0;
    v.doorTarget = 1;
    v.atStop = v.target;
  }

  #endDwell(v) {
    v.state = 'closing';
    v.doorTarget = 0;
    v.closeTimer = 0.7;
  }

  #dwellStep(v, dt) {
    const stop = v.atStop;
    v.dwell += dt;
    v.boardTimer -= dt;
    if (v.boardTimer > 0) return;
    // Riders for this stop get off first, through the middle door.
    const off = v.seats.find((s) => s.robot && s.robot.busDest === stop && !s.robot.leaving);
    if (off) {
      this.#alight(off.robot, v, stop);
      v.boardTimer = BOARD_GAP;
      return;
    }
    const free = v.seats.find((s) => !s.robot);
    const next = stop && this.stops.includes(stop) ? stop.waiting.find((r) => !r.boarding) : null;
    if (free && next) {
      this.#board(next, v, free, stop);
      v.boardTimer = BOARD_GAP;
      return;
    }
    if (v.walking <= 0 && v.dwell > 1.8) this.#endDwell(v);
  }

  #board(r, v, seat, stop) {
    r.boarding = true;
    r.state = 'boarding';
    seat.robot = r;
    stop.waiting.splice(stop.waiting.indexOf(r), 1);
    if (r.seated) r.stand();
    this.#regroup(stop);
    v.walking++;
    const door = this.#door(v, true);
    const outside = v.body.localToWorld(door.outside.clone()).setY(SIDEWALK_Y);
    const inside = v.body.localToWorld(door.inside.clone().add(tmp2.set(0, 0, -0.05)));
    inside.jump = true;
    r.speed = 0.95 * (r.personality?.speed ?? 1);
    r.walkTo([outside, inside], () => {
      v.walking--;
      r.boarding = false;
      if (!this.vehicles.includes(v)) return this.#dropAt(r, r.mesh.position);
      r.state = 'riding';
      r.setDestination?.(null);
      seatRider(v, seat, r);
      r.origin = stop;
    });
  }

  #alight(r, v, stop) {
    const seat = r.seat;
    r.leaving = true;
    const door = this.#door(v, false);
    const inside = v.body.localToWorld(door.inside.clone());
    this.scene.attach(r.mesh);
    r.stand();
    r.setIndoor(false);
    r.scale = 1;
    r.mesh.position.copy(inside);
    r.mesh.rotation.x = r.mesh.rotation.z = 0;
    if (seat) seat.robot = null;
    r.vehicle = null;
    r.seat = null;
    r.state = 'alighting';
    const out = v.body.localToWorld(door.outside.clone()).setY(SIDEWALK_Y);
    out.jump = true;
    const away = stop ? this.#strollSpot(stop.pos) : this.#strollSpot(out);
    r.walkTo([out, away], () => {
      r.leaving = false;
      if (stop && r.origin && r.origin !== stop) {
        const fare = Math.round(10 + r.origin.pos.distanceTo(stop.pos) * 2.2);
        this.game.money.earn(fare);
        this.game.money.float(`+$${fare}`, r.mesh.position.clone().setY(0.6), '#2f9e62');
        this.delivered++;
      }
      this.#stroll(r, stop, 1 + Math.floor(Math.random() * 3));
    });
  }

  // ---------- Level crossings ----------

  #rebuildCrossings() {
    for (const c of this.crossings) for (const g of c.gates) g.group.removeFromParent();
    this.crossings = [];
    const rails = [...this.game.network.edges];
    for (const seg of this.net.segs) {
      for (const e of rails) {
        e._roadPoly ??= new Polyline(e.samples);
        for (const x of crossings(seg.line, e._roadPoly)) {
          const t = seg.line.tangentAt(x.ta);
          const gates = [];
          for (const dir of [1, -1]) {
            const td = t.clone().multiplyScalar(dir);
            const right = new THREE.Vector3().crossVectors(td, UP).normalize();
            const gate = makeGate();
            gate.group.position.copy(x.p).addScaledVector(td, -1.05).addScaledVector(right, ROAD_HALF + 0.14);
            gate.group.rotation.y = Math.atan2(-td.x, -td.z);
            gate.angle = -Math.PI / 2;
            gate.boom.rotation.z = gate.angle;
            this.scene.add(gate.group);
            gates.push(gate);
          }
          this.crossings.push({ seg, s: x.ta, p: x.p, gates, active: false, blink: 0 });
        }
      }
    }
  }

  #updateCrossings(dt) {
    if (this.railVersion !== this.game.network.version) {
      this.railVersion = this.game.network.version;
      this.#rebuildCrossings();
    }
    const trains = this.game.passengers.trains ?? [];
    for (const c of this.crossings) {
      c.active = trains.some((t) => t.vehicles?.some((v) => v.group.visible !== false && v.group.position.distanceToSquared(c.p) < 4.2 * 4.2));
      c.blink += dt;
      const on = c.active || c.gates[0].angle > -Math.PI / 2 + 0.05;
      for (const g of c.gates) {
        const want = c.active ? 0 : -Math.PI / 2;
        g.angle += THREE.MathUtils.clamp(want - g.angle, -dt * 1.8, dt * 1.8);
        g.boom.rotation.z = g.angle;
        g.lamps.forEach((l, i) => {
          l.material.emissiveIntensity = on && Math.floor(c.blink * 2.4) % 2 === i ? 2.2 : 0;
        });
      }
    }
  }

  // ---------- Simulation ----------

  update(dt, time) {
    this.#updateCrossings(dt);
    const peds = [];
    for (const r of this.game.passengers.robots ?? []) if (r.mesh.parent === this.scene && !r.seated) peds.push(r.mesh.position);
    for (const r of this.commuters) if (r.mesh.parent === this.scene && !r.seated) peds.push(r.mesh.position);

    for (const v of this.vehicles) this.#drive(v, dt, peds);
    for (const v of this.vehicles) this.#pose(v, dt, time);
    for (const r of this.commuters) if (r.mesh.parent === this.scene) r.update(dt, time);
  }

  // How far ahead (along its own path) the vehicle may go before it must
  // have stopped.
  #limit(v, peds) {
    let limit = Infinity;
    v.blockedBy = null;
    const h = v.heading;
    // Junction: wait at the stop line until the junction is clear.
    if (v.lane && v.lane.to.junction && v.granted !== v.lane.to) {
      const stopAt = v.lane.length - v.len / 2 - 0.03;
      if (stopAt - v.s < 2.2 && v.next) this.#tryGrant(v);
      if (v.granted !== v.lane.to) limit = Math.min(limit, stopAt - v.s);
    }
    // Level crossings with the barrier down.
    if (v.lane) {
      for (const c of this.crossings) {
        if (!c.active || c.seg !== v.lane.seg) continue;
        const at = v.lane.fromSeg(c.s);
        const d = at - 1.2 - v.len / 2 - v.s;
        if (at - v.s > v.len / 2 - 0.1) limit = Math.min(limit, d);
      }
    }
    // Bus stop.
    if (v.kind === 'bus' && v.state === 'driving' && v.target && v.lane === v.target.lane) {
      const at = this.#busStopS(v, v.target);
      if (at >= v.s - 0.05) limit = Math.min(limit, at - v.s);
    }
    // The vehicle ahead.
    for (const o of this.vehicles) {
      if (o === v) continue;
      const rx = o.pos.x - v.pos.x;
      const rz = o.pos.z - v.pos.z;
      const f = rx * h.x + rz * h.z;
      if (f <= 0 || f > 4.5) continue;
      const lat = Math.abs(rx * h.z - rz * h.x);
      if (lat > (v.hw + o.hw) * 0.9 + 0.04) continue;
      if (o.heading.dot(h) < -0.3) continue;
      if (o.blockedBy === v && v.id < o.id) continue;
      const gap = f - (v.len + o.len) / 2 - 0.22;
      if (gap < limit) {
        limit = gap;
        v.blockedBy = o;
      }
    }
    // Robots on the road.
    if (v.pedIgnore > 0) v.pedIgnore -= 1 / 30;
    else {
      let ped = Infinity;
      for (const p of peds) {
        const rx = p.x - v.pos.x;
        const rz = p.z - v.pos.z;
        const f = rx * h.x + rz * h.z;
        if (f <= 0 || f > v.len / 2 + 1.1) continue;
        const lat = rx * h.z - rz * h.x;
        if (Math.abs(lat) > v.hw + 0.16) continue;
        ped = Math.min(ped, f - v.len / 2 - 0.3);
        // Someone dawdling in the road steps aside after a moment.
        if (v.pedWait > 1.2) {
          const k = (lat >= 0 ? 1 : -1) * 0.025;
          p.x += h.z * k;
          p.z -= h.x * k;
        }
      }
      if (ped < Infinity) {
        limit = Math.min(limit, ped);
        v.pedWait = (v.pedWait ?? 0) + 1 / 30;
        if (v.pedWait > 6) {
          v.pedIgnore = 1.5;
          v.pedWait = 0;
        }
      } else v.pedWait = Math.max(0, (v.pedWait ?? 0) - 1 / 60);
    }
    return limit;
  }

  #tryGrant(v) {
    const node = v.lane.to;
    node._occ ??= new Set();
    for (const o of node._occ) if (o.inLane !== v.lane && this.vehicles.includes(o)) return false;
    const out = v.next;
    for (const o of this.vehicles) {
      if (o !== v && o.lane === out && o.s < v.len + 0.5 + o.len / 2) return false;
    }
    node._occ.add(v);
    v.granted = node;
    v.inLane = v.lane;
    return true;
  }

  #drive(v, dt, peds) {
    if (v.state === 'dwell') {
      v.speed = 0;
      this.#dwellStep(v, dt);
      return;
    }
    if (v.state === 'closing') {
      v.speed = 0;
      v.closeTimer -= dt;
      if (v.closeTimer <= 0) this.#nextStop(v, v.atStop);
      return;
    }
    const limit = this.#limit(v, peds);
    let target = v.maxSpeed;
    if (v.conn) target *= v.conn.uTurn ? 0.35 : 0.6;
    else {
      const path = v.lane.path;
      const t0 = path.tangentAt(v.s);
      const t1 = path.tangentAt(Math.min(path.length, v.s + 1.2));
      target *= 0.55 + 0.45 * Math.max(0, t0.dot(t1)) ** 2;
    }
    const allowed = limit <= 0.005 ? 0 : Math.sqrt(2 * BRAKE * limit);
    const want = Math.min(target, allowed);
    v.speed += THREE.MathUtils.clamp(want - v.speed, -BRAKE * 2.5 * dt, ACCEL * dt);
    if (v.speed < 0.01 && want === 0) v.speed = 0;
    const ds = Math.max(0, Math.min(v.speed * dt, Math.max(0, limit)));
    v.travel = (v.travel ?? 0) + ds;
    v.s += ds;

    // Bus pulled up at its stop.
    if (v.kind === 'bus' && v.state === 'driving' && v.target && v.lane === v.target.lane) {
      const at = this.#busStopS(v, v.target);
      if (Math.abs(at - v.s) < 0.04 && v.speed < 0.15) {
        v.speed = 0;
        this.#startDwell(v);
      }
    }

    for (let guard = 0; guard < 4; guard++) {
      const path = this.#path(v);
      if (v.s <= path.length) break;
      const over = v.s - path.length;
      if (v.lane) {
        if (!v.next) v.next = this.#chooseNext(v, v.lane);
        if (!v.next) {
          v.s = path.length;
          break;
        }
        v.conn = this.net.connector(v.lane, v.next);
        v.lane = null;
        v.s = over;
      } else {
        this.#release(v);
        v.lane = v.conn.to;
        v.conn = null;
        v.s = over;
        if (v.kind === 'bus' && v.target && !v.route) this.#planRoute(v);
        v.next = this.#chooseNext(v, v.lane);
      }
    }
  }

  #pose(v, dt, time) {
    const path = this.#path(v);
    path.pointAt(v.s, v.pos);
    const t = path.tangentAt(Math.min(path.length - 0.001, v.s + 0.05), tmp);
    const want = Math.atan2(t.x, t.z);
    const diff = THREE.MathUtils.euclideanModulo(want - v.yaw + Math.PI, Math.PI * 2) - Math.PI;
    const turn = v.place ? diff : diff * Math.min(1, dt * 9);
    v.place = false;
    v.yaw += turn;
    const yawRate = dt > 0 ? turn / dt : 0;
    v.heading.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    v.group.position.copy(v.pos);
    // Lean two-wheelers into corners.
    if (v.kind === 'scooter' || v.kind === 'bicycle') {
      v.lean = (v.lean ?? 0) + (THREE.MathUtils.clamp(-yawRate * v.speed * 0.16, -0.35, 0.35) - (v.lean ?? 0)) * Math.min(1, dt * 5);
      v.group.rotation.set(0, v.yaw, v.lean, 'YXZ');
    } else v.group.rotation.set(0, v.yaw, 0);
    const roll = v.speed * dt;
    for (const w of v.wheels) w.spin.rotation.x += roll / w.r;
    for (const s of v.steerers) s.rotation.y = (s.position.x < 0 ? Math.PI : 0) + THREE.MathUtils.clamp(yawRate * 0.25, -0.45, 0.45);
    v.body.position.y = Math.sin(time * 17 + v.id) * 0.004 * Math.min(1, v.speed);
    if (v.crank) {
      v.crankAngle = (v.crankAngle ?? 0) + roll / 0.07;
      v.crank.rotation.x = v.crankAngle;
    }
    if (v.doors) {
      const k = Math.min(1, dt * 4);
      for (const d of v.doors) {
        d.t += ((v.doorTarget ?? 0) - d.t) * k;
        for (const l of d.leaves) l.obj.position.z = l.home + l.dir * d.t * l.w * 0.92;
      }
    }
    animateRiders(v, dt, time, v.speed);
  }
}
