import * as THREE from 'three';
import { buildHouse, setHomesNight, bulbMaterial, W, D, SPOTS, ENTRY, THRESHOLD, DOORSTEP } from './house.js';

// Homes for the robot residents. The island's houses become furnished
// cottages at robot scale; residents walk home now and then, open the
// front door, and sit on the sofa, have dinner, cook or take a nap, visible
// through the windows. Zooming in close lifts the roof off for a peek.
//
// Plugs into the game as a module (see ../modules.js); stations.js asks
// `passengers.homes.maybeVisit()` between stroll stops.

const LIGHTS = 4; // own warm room lights, when the game has no lamp system
const PEEK_DISTANCE = 6.5; // camera closer than this lifts the roof
const SEE_IN = 16; // farther than this the rooms are too small to see into
const BLOCK = 0.16; // how far outside the walls strolling robots are kept

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

class Home {
  constructor(id, x, z, ry) {
    const built = buildHouse(id);
    this.id = id;
    this.group = built.group;
    this.roof = built.roof;
    this.leaf = built.leaf;
    this.inner = built.inner;
    this.innerShown = true;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = ry;
    this.group.updateMatrixWorld(true);
    this.ry = ry;
    this.cos = Math.cos(ry);
    this.sin = Math.sin(ry);
    this.prop = { x, z, r: 1.5, kind: 'house', home: this };
    this.residents = new Set();
    this.taken = new Set(); // SPOTS in use
    this.removed = false;
    this.lift = 0;
    this.doorAngle = 0;
  }

  // House-local [x, y, z] to world.
  world(x, y, z) {
    return new THREE.Vector3(this.prop.x + x * this.cos + z * this.sin, y, this.prop.z - x * this.sin + z * this.cos);
  }

  local(p) {
    const dx = p.x - this.prop.x;
    const dz = p.z - this.prop.z;
    return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos];
  }
}

export class HomeSystem {
  constructor({ scene, world, network, passengers, look }) {
    this.scene = scene;
    this.world = world;
    this.network = network;
    this.passengers = passengers;
    this.homes = [];
    this.visits = new Map(); // robot -> visit
    passengers.homes = this;

    this.#replaceHouses();
    this.#wrapScenery();

    // Room lights: the game's lamp system lights the homes nearest the
    // camera when it has one; otherwise a small pool of our own.
    this.lights = [];
    if (look?.addLamp) {
      for (const h of this.homes) {
        const at = new THREE.Object3D();
        at.position.set(-0.05, 0.62, 0);
        h.group.add(at);
        h.unlamp = look.addLamp(at, { color: 0xffb36b, intensity: 0.6, distance: 2.6, bulb: { material: bulbMaterial }, always: true });
      }
      look.onTime?.((night) => setHomesNight(night));
    }
    for (let i = 0; i < (look?.addLamp ? 0 : LIGHTS); i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 2.6, 2);
      l.userData.home = null;
      scene.add(l);
      this.lights.push(l);
    }
    this.lightTimer = 0;
    this.peekDistance = PEEK_DISTANCE; // 0 keeps roofs on
  }

  // Swap the island's plain scenery houses for furnished homes, keeping
  // them a comfortable distance apart.
  #replaceHouses() {
    const { world } = this;
    const old = world.obstacles.filter((o) => o.kind === 'house' && !o.home);
    world.scenery.remove(old);
    // A saved game may already have rails and platforms here.
    const rails = this.network?.allSamples?.() ?? [];
    const stations = this.passengers.stations ?? [];
    const clear = (x, z) =>
      !rails.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2 ** 2) && !stations.some((s) => s.contains?.(x, z, 1.6));
    for (const o of old) {
      const r = Math.hypot(o.x, o.z);
      const k = r > 19 ? 19 / r : 1;
      const x = o.x * k;
      const z = o.z * k;
      if (!clear(x, z)) continue;
      if (this.homes.some((h) => (h.prop.x - x) ** 2 + (h.prop.z - z) ** 2 < 3.2 ** 2)) continue;
      // Face roughly toward the middle of the island.
      const ry = Math.atan2(-x, -z) + (((this.homes.length * 37) % 9) - 4) * 0.12;
      const home = new Home(this.homes.length, x, z, ry);
      world.clearArea(x, z, 1.45);
      const yard = home.world(DOORSTEP.x, 0, DOORSTEP.z + 0.5);
      world.clearArea(yard.x, yard.z, 0.6);
      this.homes.push(home);
      world.obstacles.push(home.prop);
      this.scene.add(home.group);
    }
  }

  // Homes join the scenery the build tools clear (and charge for). The
  // build tools hold on to this object, so its methods are wrapped in place.
  #wrapScenery() {
    const scenery = this.world.scenery;
    const query = scenery.query;
    const remove = scenery.remove;
    scenery.query = (test) => [...query(test), ...this.homes.filter((h) => !h.removed && test(h.prop.x, h.prop.z, h.prop.r)).map((h) => h.prop)];
    scenery.remove = (list) => {
      const mine = list.filter((p) => p.home);
      for (const p of mine) this.#demolish(p.home);
      return [...remove(list.filter((p) => !p.home)), ...mine];
    };
  }

  #demolish(home) {
    if (home.removed) return;
    home.removed = true;
    home.unlamp?.();
    this.scene.remove(home.group);
    const i = this.world.obstacles.indexOf(home.prop);
    if (i >= 0) this.world.obstacles.splice(i, 1);
    for (const [r, v] of this.visits) {
      if (v.home !== home) continue;
      this.#getUp(r, v);
      r.setIndoor(false);
      r.walkTo([], null);
      r.mesh.position.copy(home.world(DOORSTEP.x, 0, DOORSTEP.z + 0.4));
      this.#finish(r, v);
    }
    for (const r of home.residents) r.house = null;
    home.residents.clear();
  }

  // Each resident moves into the nearest home that still has room.
  homeOf(r) {
    if (r.house && !r.house.removed) return r.house;
    const open = this.homes.filter((h) => !h.removed);
    if (!open.length) return null;
    const room = Math.ceil((this.passengers.robots?.size ?? 0) / open.length) + 1;
    const p = r.mesh.position;
    const d = (h) => (h.prop.x - p.x) ** 2 + (h.prop.z - p.z) ** 2;
    const best = open.filter((h) => h.residents.size < room).sort((a, b) => d(a) - d(b))[0] ?? open[0];
    best.residents.add(r);
    r.house = best;
    return best;
  }

  // Between stroll stops: sometimes head home. Lazy robots like it most,
  // restless ones least.
  maybeVisit(r, done) {
    const chance = { lazy: 0.35, dreamy: 0.25, tidy: 0.25, lively: 0.1, hasty: 0.05, curious: 0.12 }[r.personality?.key] ?? 0.2;
    return Math.random() < chance && this.visit(r, done);
  }

  // Send a strolling robot home for a while; `done` runs once it's back
  // outside. Returns false if it has nowhere to go.
  visit(r, done) {
    if (r.mesh.parent !== this.scene || this.visits.has(r)) return false;
    const home = this.homeOf(r);
    if (!home) return false;
    const free = SPOTS.map((s, i) => i).filter((i) => !home.taken.has(i));
    if (!free.length) return false;
    const spot = free[Math.floor(Math.random() * free.length)];
    home.taken.add(spot);
    const v = { home, spot, done, phase: 'going', timer: 0 };
    this.visits.set(r, v);
    r.state = 'home';
    r.target = null;
    r.setDestination(null);
    r.speed = 0.55 + Math.random() * 0.15;
    const s = SPOTS[spot];
    v.inside = [THRESHOLD, ENTRY, ...s.path.map(([x, z]) => new THREE.Vector3(x, ENTRY.y, z))];
    // Walk right up to a seat or counter; a bed is climbed into from beside it.
    const last = s.pose === 'lie' ? [] : [new THREE.Vector3(s.at[0], ENTRY.y, s.at[1])];
    const toWorld = (pts) => pts.map((p) => home.world(p.x, p.y, p.z));
    // Umbrellas fold and balloons tuck away at the front door.
    r.walkTo(toWorld([...this.#approach(home, r.mesh.position), DOORSTEP]), () => {
      r.setIndoor(true);
      r.walkTo(toWorld([...v.inside, ...last]), () => this.#settle(r, v));
    });
    return true;
  }

  // Walk around the house (not through it) to reach the front step.
  #approach(home, p) {
    const [lx, lz] = home.local(p);
    const side = lx < 0 ? -1 : 1;
    const ex = side * (W / 2 + 0.45);
    const pts = [];
    if (lz < -D / 2) pts.push(new THREE.Vector3(ex, 0, -D / 2 - 0.45));
    if (lz < D / 2 + 0.2) pts.push(new THREE.Vector3(ex, 0, D / 2 + 0.45));
    return pts;
  }

  #settle(r, v) {
    const s = SPOTS[v.spot];
    const { home } = v;
    const p = home.world(s.at[0], s.y, s.at[1]);
    if (s.pose === 'sit') {
      r.sit({ pos: p });
      r.mesh.userData.inner.scale.x = 1;
      r.mesh.rotation.y = home.ry + s.ry;
      v.timer = 8 + Math.random() * 10;
    } else if (s.pose === 'lie') {
      r.seated = true;
      r.mesh.position.copy(p);
      r.mesh.rotation.order = 'YXZ';
      r.mesh.rotation.set(-Math.PI / 2, home.ry + s.ry, 0);
      v.timer = 10 + Math.random() * 10;
    } else {
      r.mesh.rotation.y = home.ry + s.ry;
      v.timer = 5 + Math.random() * 6;
    }
    v.phase = 'staying';
  }

  #getUp(r, v) {
    if (v.phase !== 'staying') return;
    if (r.seated) r.stand();
    r.mesh.rotation.x = 0;
    r.mesh.rotation.z = 0;
  }

  #leave(r, v) {
    this.#getUp(r, v);
    v.phase = 'leaving';
    const out = [...v.inside.slice().reverse(), DOORSTEP].map((p) => v.home.world(p.x, p.y, p.z));
    r.walkTo(out, () => {
      r.setIndoor(false);
      this.#finish(r, v);
    });
  }

  #finish(r, v) {
    v.home.taken.delete(v.spot);
    this.visits.delete(r);
    r.state = 'strolling';
    v.done?.(r);
  }

  // Other modules (roads, shops, airport...) set up after the homes and may
  // load saved buildings without clearing scenery. Once everything exists,
  // take down any home standing on a road or another module's building.
  #yieldToNeighbours() {
    if (this.settled) return;
    this.settled = true;
    const blockers = this.world.blockers ?? [];
    const roads = (window.__roads ?? null)?.net;
    const ROAD_CLEAR = 1.15; // road half width + sidewalk + a little lawn
    for (const h of this.homes) {
      if (h.removed) continue;
      // Centre, corners, wall midpoints and the front step.
      const pts = [];
      for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) pts.push(h.world((fx * W) / 2, 0, (fz * D) / 2));
      pts.push(h.world(DOORSTEP.x, 0, DOORSTEP.z));
      const onRoad = roads && [...(roads.segs ?? [])].length > 0 && pts.some((p) => (roads.nearestSeg(p.x, p.z)?.dist ?? Infinity) < ROAD_CLEAR);
      const blocked = blockers.some((b) => pts.some((p) => b.hit(p.x, p.z, 0.2)));
      if (onRoad || blocked) this.#demolish(h);
    }
  }

  // Game logic: stays at home, doors, and keeping strollers out of walls.
  update(dt) {
    this.#yieldToNeighbours();
    for (const [r, v] of this.visits) {
      if (v.phase === 'staying' && (v.timer -= dt) <= 0) this.#leave(r, v);
    }
    for (const h of this.homes) {
      if (h.removed) continue;
      let open = false;
      for (const [r, v] of this.visits) {
        if (v.home !== h || v.phase === 'staying') continue;
        const [lx, lz] = h.local(r.mesh.position);
        if (Math.abs(lx - THRESHOLD.x) < 0.3 && Math.abs(lz - THRESHOLD.z) < 0.45) open = true;
      }
      const target = open ? 1.4 : 0;
      h.doorAngle += (target - h.doorAngle) * Math.min(1, dt * 6);
      h.leaf.rotation.y = h.doorAngle;
    }
    if (this.passengers) this.#keepOut(dt);
  }

  // Robots walk in straight lines; slide them around houses instead of
  // through the walls.
  #keepOut(dt) {
    for (const r of this.passengers.robots) {
      if (r.mesh.parent !== this.scene || r.seated) continue;
      const own = this.visits.get(r)?.home; // its own front door is fine
      const p = r.mesh.position;
      for (const h of this.homes) {
        if (h.removed || h === own || (p.x - h.prop.x) ** 2 + (p.z - h.prop.z) ** 2 > 1.6 ** 2) continue;
        let [lx, lz] = h.local(p);
        const hx = W / 2 + BLOCK;
        const hz = D / 2 + BLOCK;
        if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
        const slide = r.speed * dt * 0.8;
        if (hx - Math.abs(lx) < hz - Math.abs(lz)) {
          lx = Math.sign(lx || 1) * hx;
          lz += Math.sign(lz || 1) * slide;
        } else {
          lz = Math.sign(lz || 1) * hz;
          lx += Math.sign(lx || 1) * slide;
        }
        const w = h.world(lx, p.y, lz);
        p.x = w.x;
        p.z = w.z;
      }
    }
  }

  // Per rendered frame: lift roofs near the camera, move room lights to the
  // homes in view.
  frame(camera, dt) {
    for (const h of this.homes) {
      if (h.removed) continue;
      _v.set(h.prop.x, 0.6, h.prop.z);
      const dist = camera.position.distanceTo(_v);
      const near = dist < this.peekDistance;
      const seeIn = dist < SEE_IN;
      if (seeIn !== h.innerShown) {
        h.innerShown = seeIn;
        for (const m of h.inner) m.visible = seeIn;
      }
      // The roof pops up and away rather than hovering overhead.
      h.lift += ((near ? 1 : 0) - h.lift) * Math.min(1, dt * 7);
      if (Math.abs(h.lift) < 1e-3) h.lift = 0;
      h.roof.position.y = h.lift * 0.5;
      h.roof.scale.setScalar(1 + h.lift * 0.12);
      h.roof.visible = h.lift < 0.5;
    }
    if (!this.lights.length || (this.lightTimer -= dt) > 0) return;
    this.lightTimer = 0.25;
    camera.getWorldDirection(_w);
    const score = (h) => {
      _v.set(h.prop.x, 0.5, h.prop.z).sub(camera.position);
      const d = _v.length();
      return d * (_v.dot(_w) / d > 0.5 ? 1 : 4); // prefer homes on screen
    };
    const ranked = this.homes.filter((h) => !h.removed).sort((a, b) => score(a) - score(b));
    this.lights.forEach((l, i) => {
      const h = ranked[i];
      if (!h) {
        l.intensity = 0;
        return;
      }
      l.position.copy(h.world(-0.05, 0.62, 0.0));
      l.intensity = 0.55;
    });
  }
}

// The game module (registered in ../modules.js).
let system = null;
export const homes = {
  name: 'homes',
  init(game) {
    system = new HomeSystem(game);
    this.camera = game.camera;
    window.__homes = system;
  },
  update(dt) {
    system?.update(dt);
  },
  frame(dt) {
    system?.frame(this.camera, dt);
  },
};
