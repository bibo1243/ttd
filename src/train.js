import * as THREE from 'three';
import { Carriage, Locomotive } from './steam.js';
import { BulletCar, TramCar } from './modern.js';
import { makeDriver } from './robots.js';

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

export class Train {
  constructor(track, scene, type = 'steam') {
    this.track = track;
    this.scene = scene;
    this.distance = 0;
    this.travelled = 0;
    this.speed = 4;
    this.vehicles = [];
    this.smoke = new Smoke(scene);
    this.setType(type);
  }

  setType(type) {
    for (const v of this.vehicles) this.scene.remove(v.group);
    this.type = type;
    this.config = TRAIN_TYPES[type];
    this.mids = [];
    for (let i = 0; i < this.config.defaultMid; i++) this.mids.push(this.config.mid(i));
    this.#assemble();
  }

  #assemble() {
    const c = this.config;
    this.head ??= null;
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
      v.group.visible = !!this.track;
      this.scene.add(v.group);
    }
  }

  // Put the train on a (new) track, or take it off with null.
  setTrack(track) {
    this.track = track;
    this.distance = 0;
    this.speed = 0;
    for (const v of this.vehicles) v.group.visible = !!track;
  }

  get lead() {
    return this.vehicles[0];
  }

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

  update(dt, time) {
    if (!this.track) return;
    const step = this.speed * dt;
    this.distance += step;
    this.travelled += step;
    let d = this.distance;
    let prevHalf = 0;
    for (const v of this.vehicles) {
      d -= prevHalf + (prevHalf ? this.config.gap : 0) + v.length / 2;
      v.speedFactor = this.speed / 4;
      v.dt = dt;
      v.place(this.track, d, this.travelled, time);
      prevHalf = v.length / 2;
    }
    this.driver?.update(dt, time);
    const top = this.head.chimneyTop?.getWorldPosition(new THREE.Vector3());
    this.smoke.update(dt, top, this.config.smoke ? this.speed : 0);
  }
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
