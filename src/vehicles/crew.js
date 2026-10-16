import * as THREE from 'three';
import { BatchedPart } from '../batching.js';
import { Robot, makeDriver, randomLook } from '../robots.js';
import { randomPersonality, residentName } from '../residents.js';

// Robots riding road vehicles: the driver and passengers really sit in the
// seats; riders on two-wheelers wear helmets and pedal or rest their feet.

const HELMETS = [0xf2f0ea, 0xe8574a, 0x2f3440, 0xf4d35e, 0x4a90c8, 0xe8789a];
const helmetMats = new Map();
const helmetGeo = {
  shell: new THREE.SphereGeometry(0.118, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
  visor: new THREE.SphereGeometry(0.121, 22, 10, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.32, Math.PI * 0.2),
  strap: new THREE.TorusGeometry(0.1, 0.006, 6, 20, Math.PI),
};
const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x2a3644, roughness: 0.05, metalness: 0.3, clearcoat: 1 });
const strapMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.7 });

function addHelmet(robot) {
  const color = HELMETS[Math.floor(Math.random() * HELMETS.length)];
  if (!helmetMats.has(color)) helmetMats.set(color, new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const inner = robot.mesh.userData.inner;
  const shell = new BatchedPart(helmetGeo.shell, helmetMats.get(color));
  shell.position.set(0, 0.275, -0.005);
  shell.scale.set(1.0, 0.92, 0.95);
  const visor = new BatchedPart(helmetGeo.visor, visorMat);
  visor.position.copy(shell.position);
  visor.scale.copy(shell.scale);
  const strap = new BatchedPart(helmetGeo.strap, strapMat);
  strap.position.set(0, 0.255, 0);
  strap.rotation.set(0, Math.PI / 2, Math.PI);
  strap.scale.set(1, 0.6, 1);
  for (const p of [shell, visor, strap]) {
    p.castShadow = true;
    inner.add(p);
  }
  // Their antenna would poke through: keep just the glowing tip on top.
  robot.mesh.userData.ball.position.y = 0.39;
}

let made = 0;
export function makeRider({ helmet = false, items = true } = {}) {
  const look = randomLook(made);
  look.name = residentName(400 + made++);
  look.personality = randomPersonality();
  if (helmet) {
    look.hat = null;
    look.glasses = null;
  }
  // Big things stay home when riding: they would stick out of a small car.
  if (!items || ['suitcase', 'guitar', 'umbrella', 'balloon'].includes(look.item)) look.item = items ? 'backpack' : null;
  const r = new Robot(look);
  if (helmet) addHelmet(r);
  return r;
}

export function seatRider(v, seat, robot, driver = false) {
  seat.robot = robot;
  robot.sit(seat);
  robot.scale = v.riderScale;
  robot.vehicle = v;
  robot.seat = seat;
  if (seat.pose === 'scooter' || seat.pose === 'pedal') {
    robot.mesh.userData.inner.scale.x = 1;
    for (const leg of robot.mesh.userData.legs) {
      leg.rotation.x = 1.1;
      leg.position.set(leg.position.x, 0.06, 0.03);
    }
  }
  robot.mesh.rotation.y = seat.rotY ?? 0;
  robot.setIndoor(v.kind !== 'scooter' && v.kind !== 'bicycle');
  v.body.add(robot.mesh);
  if (driver) v.driver = robot;
  return robot;
}

// Put a driver (and `passengers` more riders, for cars) in vehicle `v`.
export function crewVehicle(v, { passengers = 0 } = {}) {
  v.riders = [];
  if (v.kind === 'bus') {
    const d = makeDriver();
    d.name = '公車司機';
    v.riders.push(seatRider(v, { pos: v.driverPos.clone(), robot: null }, d, true));
    return v;
  }
  const helmet = v.kind === 'scooter';
  const items = v.kind !== 'bicycle';
  const seats = v.seats;
  const n = Math.min(seats.length, 1 + passengers);
  for (let i = 0; i < n; i++) {
    const r = makeRider({ helmet, items: items && i > 0 });
    v.riders.push(seatRider(v, seats[i], r, i === 0));
  }
  return v;
}

// Pedalling legs and a gently swaying ride. Call every frame.
export function animateRiders(v, dt, time, speed) {
  for (const r of v.riders ?? []) {
    r.update(dt, time);
    if (r.seat?.pose === 'pedal') {
      const a = v.crankAngle ?? 0;
      r.mesh.userData.legs.forEach((leg, i) => {
        const s = Math.sin(a + i * Math.PI);
        leg.rotation.x = 1.0 + s * 0.45;
        leg.position.y = 0.06 + Math.max(0, -s) * 0.01;
      });
    }
  }
}
