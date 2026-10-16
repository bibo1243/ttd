import * as THREE from 'three';
import {
  NOSE_Z,
  ROLLOUT_X,
  RW_Z,
  STANDS,
  TAKEOFF_START,
  TERM_Z,
  TOUCHDOWN_X,
  pushbackPath,
  smoothPath,
  stairTruck,
  taxiInPath,
  taxiOutPath,
} from './airport.js';
import { Plane } from './planes.js';

// One plane and its round of duties: turnaround at the stand, pushback,
// taxi, take-off, a sightseeing lap round the island, landing and taxi in.

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const TAXI = 1.3;
const PUSH = 0.45;

const STATUS = {
  arriving: ['旅客下機', '#8fd0ff'],
  boarding: ['登機中', '#6cf0a0'],
  ready: ['準備推出', '#f2c230'],
  tug: ['準備推出', '#f2c230'],
  pushback: ['推出中', '#f2c230'],
  taxiOut: ['滑行中', '#f2c230'],
  lineup: ['跑道待命', '#ff9a5a'],
  takeoff: ['起飛', '#ff9a5a'],
  lap: ['環島飛行', '#8fd0ff'],
  hold: ['盤旋等待', '#c9a0ff'],
  approach: ['降落中', '#ff9a5a'],
  taxiIn: ['滑行回機坪', '#f2c230'],
};

// A path the plane follows, with a speed plan along it.
class Route {
  constructor(curve, { frame = null, reverse = false, speed, accel = 1.5, stop = true }) {
    this.curve = curve;
    this.length = curve.getLength();
    this.frame = frame; // airport, when the curve is in the airport's frame
    this.reverse = reverse;
    this.speed = speed;
    this.accel = accel;
    this.stop = stop;
  }

  pose(s, pos, dir) {
    const u = THREE.MathUtils.clamp(s / this.length, 0, 1);
    this.curve.getPointAt(u, pos);
    this.curve.getTangentAt(u, dir);
    if (this.frame) {
      pos.copy(this.frame.toWorld(pos));
      dir.copy(this.frame.dirToWorld(dir));
    }
    if (this.reverse) dir.negate();
  }
}

export class Flight {
  constructor(system, type, stand, index) {
    this.sys = system;
    this.airport = system.airport;
    this.index = index;
    this.code = `TT${101 + index}`;
    this.plane = new Plane(type);
    this.type = this.plane.type;
    this.stand = stand;
    this.pax = []; // robots aboard
    this.queue = []; // robots on their way to the plane
    this.state = 'arriving'; // a new plane starts empty at its stand
    this.timer = 0;
    this.v = 0;
    this.s = 0;
    this.route = null;
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.yaw = 0;
    this.bank = 0;
    this.pitch = 0;
    this.altitude = 0;
    this.laps = 0;
    this.boardTarget = 0;
    this.spawned = 0;

    const sx = STANDS[stand];
    this.centerZ = NOSE_Z - (this.plane.L.zc1 + this.plane.L.nose.len);
    this.standPos = V(sx, this.centerZ);
    system.scene.add(this.plane.group);
    this.#park();

    // Each stand has its own stair truck.
    this.truck = stairTruck(this.plane.sill);
    this.truckHome = { pos: V(sx + 2.3, TERM_Z - 0.6), rot: Math.PI };
    this.truckAt = this.#truckPose();
    this.truckT = 0;
    this.airport.ground.add(this.truck);
    this.#placeTruck();
  }

  get status() {
    const st = this.state === 'lap' && this.laps > 0 ? 'hold' : this.state;
    return STATUS[st] ?? ['', '#ffffff'];
  }

  get atStand() {
    return this.state === 'boarding' || this.state === 'arriving' || this.state === 'ready';
  }

  get busyAboard() {
    return this.queue.length > 0 || this.pax.some((r) => r.leaving);
  }

  // ---------- Placement ----------

  #park() {
    const p = this.airport.toWorld(this.standPos);
    this.plane.group.position.copy(p);
    this.yaw = this.airport.rot; // nose toward +z of the airport
    this.plane.group.rotation.set(0, this.yaw, 0);
    this.plane.attitude.rotation.set(0, 0, 0);
    this.plane.gearDown = 1;
    this.plane.airborne = false;
    this.plane.group.updateMatrixWorld(true);
  }

  // Where the stair truck parks against the door, in airport coordinates.
  #truckPose() {
    const out = this.plane.doorOutside;
    const x = this.standPos.x + out.x + 0.02 + this.truck.userData.run / 2 + 0.16;
    return { pos: V(x, this.standPos.z + out.z), rot: -Math.PI / 2 };
  }

  #placeTruck() {
    const k = THREE.MathUtils.smoothstep(this.truckT, 0, 1);
    const a = this.truckHome;
    const b = this.truckAt;
    // Drive out along an L so it doesn't cut through the wing.
    const mid = V(b.pos.x + 0.9, a.pos.z);
    let p;
    if (k < 0.5) p = a.pos.clone().lerp(mid, k * 2);
    else p = mid.clone().lerp(b.pos, (k - 0.5) * 2);
    this.truck.position.copy(p);
    this.truck.rotation.y = THREE.MathUtils.lerp(a.rot, b.rot + Math.PI * 2, Math.min(1, k * 1.6));
  }

  // Stair foot and top, in airport ground coordinates.
  stairPoints() {
    const run = this.truck.userData.run;
    this.truck.updateMatrixWorld(true);
    const ground = this.airport.ground;
    const toG = (v) => ground.worldToLocal(this.truck.localToWorld(v));
    return {
      foot: toG(V(0, -run / 2 - 0.22, 0.03)),
      top: toG(V(0, run / 2 + 0.06, this.plane.sill)),
    };
  }

  // ---------- Routes ----------

  #ground(points, opts) {
    return new Route(smoothPath(points), { frame: this.airport, ...opts });
  }

  #startRoute(state, route) {
    this.state = state;
    this.route = route;
    this.s = 0;
  }

  // Take-off roll and climb, then join the sightseeing circle.
  #departure() {
    const a = this.airport;
    const t = this.type;
    const local = [
      [TAKEOFF_START, 0],
      [TAKEOFF_START + 4, 0],
      [TAKEOFF_START + 8, 0],
      [TAKEOFF_START + 11, 0.02],
      [TAKEOFF_START + 14, 0.4],
      [TAKEOFF_START + 18, 1.3],
      [TAKEOFF_START + 23, 2.8],
      [TAKEOFF_START + 29, 4.6],
    ].map(([x, y]) => a.toWorld(V(x, RW_Z, y)));
    const last = local[local.length - 1];
    const u = a.dirToWorld(V(1, 0));
    const R = this.radius;
    const ang = Math.atan2(last.z, last.x);
    this.turn = Math.sign(last.x * u.z - last.z * u.x) || 1;
    const circle = (th, y = t.alt) => V(Math.cos(th) * R, Math.sin(th) * R, y);
    this.joinAngle = ang + this.turn * 0.75;
    const pts = [...local, circle(this.joinAngle - this.turn * 0.18, (t.alt + last.y) / 2 + 1), circle(this.joinAngle)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    curve.arcLengthDivisions = 400;
    this.liftoffS = 11;
    return new Route(curve, { speed: (s) => t.cruise, accel: 1.9, stop: false });
  }

  get radius() {
    // Wide enough to circle the island, and the airport if it sits offshore.
    const d = Math.hypot(this.airport.x, this.airport.z);
    return Math.max(this.type.radius, d * 0.75 + 8);
  }

  #lap() {
    const t = this.type;
    const R = this.radius;
    const pts = [];
    const n = 36;
    for (let k = 0; k < n; k++) {
      const th = this.joinAngle + this.turn * (k / n) * Math.PI * 2;
      pts.push(V(Math.cos(th) * R, Math.sin(th) * R, t.alt + Math.sin((k / n) * Math.PI * 4) * 0.8));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 600;
    return new Route(curve, { speed: () => t.cruise, accel: 1.2, stop: false });
  }

  // Leave the circle, fly a base leg and line up with the runway.
  #approach() {
    const a = this.airport;
    const t = this.type;
    const R = this.radius;
    const glide = (x) => Math.max(0, (TOUCHDOWN_X - x) * 0.13);
    const ext = a.toWorld(V(TOUCHDOWN_X - 40, RW_Z, glide(TOUCHDOWN_X - 40)));
    const n = a.dirToWorld(V(0, 1));
    const start = V(Math.cos(this.joinAngle) * R, Math.sin(this.joinAngle) * R, t.alt);
    const side = Math.sign(start.clone().sub(ext).dot(n)) || 1;
    const base = a.toWorld(V(TOUCHDOWN_X - 46, RW_Z + side * 10, glide(TOUCHDOWN_X - 46) + 0.6));
    // Follow the circle round to the point nearest the base leg.
    const baseAng = Math.atan2(base.z, base.x);
    let span = THREE.MathUtils.euclideanModulo((baseAng - this.joinAngle) * this.turn, Math.PI * 2) - 0.5;
    if (span < 0.3) span += Math.PI * 2;
    const pts = [];
    for (let th = 0; th <= span; th += 0.22) {
      const ang = this.joinAngle + this.turn * th;
      const k = th / span;
      pts.push(V(Math.cos(ang) * R, Math.sin(ang) * R, THREE.MathUtils.lerp(t.alt, base.y + 1.5, k * k)));
    }
    pts.push(base, ext);
    for (const x of [TOUCHDOWN_X - 30, TOUCHDOWN_X - 20, TOUCHDOWN_X - 12, TOUCHDOWN_X - 6, TOUCHDOWN_X - 2]) {
      pts.push(a.toWorld(V(x, RW_Z, glide(x))));
    }
    for (const x of [TOUCHDOWN_X, TOUCHDOWN_X + 4, TOUCHDOWN_X + 8, ROLLOUT_X]) pts.push(a.toWorld(V(x, RW_Z, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    curve.arcLengthDivisions = 1200;
    const L = curve.getLength();
    // Arc length where the wheels touch: walk back from the end.
    const tdS = L - (ROLLOUT_X - TOUCHDOWN_X);
    this.touchdownS = tdS;
    this.gearS = Math.max(0, tdS - 46);
    const app = t.cruise * 0.55;
    return new Route(curve, {
      speed: (s) => {
        if (s < this.gearS) return THREE.MathUtils.lerp(t.cruise, app, Math.min(1, s / Math.max(1, this.gearS)));
        if (s < tdS) return app;
        return Math.min(app, Math.sqrt(TAXI * TAXI + 2 * 1.8 * Math.max(0, L - s)));
      },
      accel: 1.8,
      stop: false,
    });
  }

  // ---------- Every step ----------

  update(dt, time) {
    const p = this.plane;
    this.timer += dt;
    switch (this.state) {
      case 'arriving':
      case 'boarding':
        this.#turnaround(dt);
        break;
      case 'ready':
        this.truckT = Math.max(0, this.truckT - dt * 0.5);
        this.#placeTruck();
        if (this.truckT === 0 && this.sys.claimGround(this)) {
          this.state = 'tug';
          this.timer = 0;
          p.engineTarget = 0.35;
          this.sys.tug.attach(this);
        }
        break;
      case 'tug':
        if (this.sys.tug.ready) {
          this.#startRoute('pushback', this.#ground(pushbackPath(this.stand, this.centerZ), { reverse: true, speed: () => PUSH, accel: 0.6 }));
        }
        break;
      case 'lineup':
        this.v = 0;
        if (this.timer > 1.2) this.#startRoute('takeoff', this.#departure());
        break;
    }
    if (this.route) this.#fly(dt);
    p.update(dt, time);
    for (const r of this.pax) r.update(dt, time);
  }

  #fly(dt) {
    const r = this.route;
    const p = this.plane;
    let target = r.speed(this.s);
    if (r.stop) target = Math.min(target, Math.sqrt(2 * r.accel * Math.max(0, r.length - this.s)) + 0.03);
    const dv = target - this.v;
    this.v += Math.sign(dv) * Math.min(Math.abs(dv), r.accel * dt);
    this.s += this.v * dt;
    const done = this.s >= r.length;
    if (done && r.stop) this.s = r.length;
    const s = done ? (r.stop ? r.length : this.s % r.length) : this.s;
    r.pose(s, this.pos, this.dir);

    // Heading, climb angle and a bank into turns.
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const dyaw = THREE.MathUtils.euclideanModulo(yaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    this.yaw += dyaw;
    const rate = dt > 0 ? dyaw / dt : 0;
    const flying = this.state === 'takeoff' || this.state === 'lap' || this.state === 'approach';
    const wantBank = flying ? THREE.MathUtils.clamp(-rate * this.v * 0.06, -0.55, 0.55) : 0;
    this.bank += (wantBank - this.bank) * Math.min(1, dt * 2.5);
    let pitch = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1));
    this.altitude = this.pos.y;
    if (this.state === 'approach' && this.s > this.touchdownS - 6 && this.s < this.touchdownS) pitch += 0.06; // flare
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 4);
    p.group.position.copy(this.pos);
    p.group.rotation.set(0, this.yaw, 0);
    p.attitude.rotation.set(-this.pitch, 0, this.bank, 'YXZ');

    // Lights, gear and engines by phase.
    const ground = this.pos.y < 0.15;
    p.airborne = !ground;
    if (this.state === 'takeoff') {
      p.engineTarget = 1;
      p.landingLights = this.pos.y < 6;
      if (this.pos.y > 1.6) {
        p.gearDown = Math.max(0, p.gearDown - dt * 0.6);
        this.sys.releaseGround(this);
      }
    } else if (this.state === 'approach') {
      p.landingLights = this.s > this.gearS - 10;
      if (this.s > this.gearS) p.gearDown = Math.min(1, p.gearDown + dt * 0.6);
      p.engineTarget = this.s > this.touchdownS ? 0.4 : 0.8;
    } else if (this.state === 'lap') {
      p.landingLights = false;
    } else {
      p.landingLights = this.state === 'taxiOut' || this.state === 'taxiIn';
    }

    if (this.state === 'pushback' || this.state === 'tug') this.sys.tug.follow(this);
    if (!done) return;
    switch (this.state) {
      case 'pushback':
        this.sys.tug.release();
        p.engineTarget = 0.35;
        this.#startRoute('taxiOut', this.#ground(taxiOutPath(this.stand), { speed: () => TAXI, accel: 0.8 }));
        break;
      case 'taxiOut':
        this.route = null;
        this.state = 'lineup';
        this.timer = 0;
        p.engineTarget = 1;
        break;
      case 'takeoff':
        this.laps = 0;
        this.#startRoute('lap', this.#lap());
        this.s = this.s - r.length;
        break;
      case 'lap':
        if (this.sys.claimGround(this)) {
          const carry = this.s - r.length;
          this.#startRoute('approach', this.#approach());
          this.s = carry;
        } else {
          this.laps++;
          this.s -= r.length;
        }
        break;
      case 'approach':
        this.#startRoute('taxiIn', this.#ground(taxiInPath(this.stand, this.centerZ), { speed: () => TAXI, accel: 0.9 }));
        p.engineTarget = 0.35;
        break;
      case 'taxiIn':
        this.route = null;
        this.#park();
        p.engineTarget = 0;
        p.landingLights = false;
        this.sys.releaseGround(this);
        this.sys.landed(this);
        this.state = 'arriving';
        this.timer = 0;
        break;
    }
  }

  // Stairs up, door open, passengers off, new passengers on.
  #turnaround(dt) {
    const p = this.plane;
    if (!this.closing) {
      this.truckT = Math.min(1, this.truckT + dt * 0.5);
      this.#placeTruck();
      if (this.truckT < 1) return;
      p.setDoor(true);
      if (p.door.t < 0.9) return;
    }
    if (this.state === 'arriving') {
      if (!this.pax.length) {
        this.state = 'boarding';
        this.timer = 0;
        this.boardTarget = Math.max(1, Math.round(this.plane.seats.length * (0.55 + Math.random() * 0.45)));
        this.spawned = 0;
        this.nextSpawn = 0;
      } else if (this.timer > 0.55) {
        this.timer = 0;
        const r = this.pax.find((x) => x.seated && !x.leaving);
        if (r) this.sys.deboard(this, r);
      }
      return;
    }
    // Boarding.
    if (this.spawned < this.boardTarget) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) {
        this.nextSpawn = 0.7 + Math.random() * 0.6;
        this.spawned++;
        this.sys.sendPassenger(this);
      }
      return;
    }
    if (this.queue.length || this.pax.some((r) => !r.seated)) return;
    if (this.timer < 2) return;
    this.closing = true;
    p.setDoor(false);
    if (p.door.t > 0.03) return;
    this.closing = false;
    this.state = 'ready';
    this.timer = 0;
  }

  freeSeat() {
    return this.plane.seats.find((s) => !s.robot);
  }

  dispose() {
    this.sys.scene.remove(this.plane.group);
    this.airport.ground.remove(this.truck);
    this.plane.dispose();
  }
}
