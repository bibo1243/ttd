import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M, Vehicle, axle, box, mat, shadowed } from './parts.js';

const CAR_COLORS = [0x4a90c8, 0xf2a541, 0x7bc67b, 0xe8789a, 0x9b7fd1, 0x56c2c2];

export class Locomotive extends Vehicle {
  constructor() {
    super(1.75, 0.55);
    const b = this.body;
    const red = mat(0xd94a3a);
    const green = mat(0x2f8f6b);

    const chassis = box(0.62, 0.14, 1.7, M.chassis, 0.04);
    chassis.position.y = 0.36;
    b.add(chassis);

    for (const z of [0.5, 0.05, -0.4]) this.group.add(axle(0.17, z, this.wheels));
    // Coupling rods tie the driving wheels together and swing with them.
    this.rods = [];
    const rodGeo = new RoundedBoxGeometry(0.03, 0.04, 1.0, 2, 0.012);
    for (const side of [-1, 1]) {
      const rod = shadowed(new THREE.Mesh(rodGeo, M.steel));
      rod.userData.base = new THREE.Vector3(side * 0.33, 0.22, 0.05);
      this.group.add(rod);
      this.rods.push(rod);
    }
    // Running boards along both sides
    for (const side of [-1, 1]) {
      const board = box(0.1, 0.03, 1.1, M.black, 0.01);
      board.position.set(side * 0.33, 0.46, 0.3);
      b.add(board);
    }
    this.group.add(axle(0.1, 0.78, this.wheels));

    // Boiler
    const boilerGeo = new THREE.CylinderGeometry(0.27, 0.27, 1.0, 24);
    boilerGeo.rotateX(Math.PI / 2);
    const boiler = shadowed(new THREE.Mesh(boilerGeo, green));
    boiler.position.set(0, 0.68, 0.32);
    b.add(boiler);

    const capGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 24);
    capGeo.rotateX(Math.PI / 2);
    const cap = shadowed(new THREE.Mesh(capGeo, M.black));
    cap.position.set(0, 0.68, 0.84);
    b.add(cap);

    const bandGeo = new THREE.TorusGeometry(0.275, 0.02, 8, 28);
    for (const z of [0.0, 0.32, 0.64]) {
      const band = new THREE.Mesh(bandGeo, M.gold);
      band.position.set(0, 0.68, z);
      b.add(band);
    }

    // Headlight
    const lampGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16);
    lampGeo.rotateX(Math.PI / 2);
    const lamp = new THREE.Mesh(lampGeo, M.light);
    lamp.position.set(0, 0.84, 0.89);
    const lampRim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 8, 20), M.gold);
    lampRim.position.set(0, 0.84, 0.93);
    // Smokebox door handle
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), M.gold);
    handle.position.set(0, 0.64, 0.885);
    b.add(lamp, lampRim, handle);

    // Chimney
    const chimney = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.3, 16), M.black));
    chimney.position.set(0, 1.07, 0.62);
    const rim = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.08, 16), M.black));
    rim.position.set(0, 1.24, 0.62);
    b.add(chimney, rim);
    this.chimneyTop = new THREE.Object3D();
    this.chimneyTop.position.set(0, 1.3, 0.62);
    b.add(this.chimneyTop);

    // Steam dome
    const dome = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.gold));
    dome.position.set(0, 0.93, 0.22);
    b.add(dome);

    // Cab
    const cab = box(0.68, 0.62, 0.6, red, 0.07);
    cab.position.set(0, 0.76, -0.45);
    b.add(cab);
    const cabRoof = box(0.8, 0.08, 0.74, M.black, 0.04);
    cabRoof.position.set(0, 1.1, -0.45);
    b.add(cabRoof);
    for (const side of [-1, 1]) {
      const win = box(0.02, 0.22, 0.3, M.window, 0.01);
      win.position.set(side * 0.345, 0.88, -0.45);
      b.add(win);
    }
    const frontWin = box(0.18, 0.16, 0.02, M.window, 0.01);
    for (const side of [-1, 1]) {
      const w = frontWin.clone();
      w.position.set(side * 0.2, 0.92, -0.145);
      b.add(w);
    }

    // Cowcatcher
    const cowGeo = new THREE.CylinderGeometry(0.01, 0.3, 0.22, 4, 1);
    cowGeo.rotateY(Math.PI / 4);
    cowGeo.scale(1.05, 1, 0.55);
    const cow = shadowed(new THREE.Mesh(cowGeo, red));
    cow.rotation.x = Math.PI / 2 + 0.5;
    cow.position.set(0, 0.24, 0.92);
    b.add(cow);

    // Buffers
    for (const side of [-1, 1]) {
      const buf = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 10), M.gold));
      buf.rotation.x = Math.PI / 2;
      buf.position.set(side * 0.22, 0.38, -0.88);
      b.add(buf);
    }
  }
}

export class Carriage extends Vehicle {
  constructor(index) {
    super(1.5, 0.48);
    const b = this.body;
    const color = CAR_COLORS[index % CAR_COLORS.length];
    const paint = mat(color);
    const trim = mat(new THREE.Color(color).multiplyScalar(0.7));

    const chassis = box(0.58, 0.1, 1.44, M.chassis, 0.03);
    chassis.position.y = 0.34;
    b.add(chassis);

    for (const z of [0.6, 0.36, -0.36, -0.6]) this.group.add(axle(0.12, z, this.wheels, M.carWheel, M.steel));
    for (const z of [0.48, -0.48]) {
      const bogie = box(0.5, 0.08, 0.42, M.chassis, 0.02);
      bogie.position.set(0, 0.2, z);
      this.group.add(bogie);
    }

    const body = box(0.66, 0.5, 1.4, paint, 0.1);
    body.position.y = 0.66;
    b.add(body);

    const stripe = box(0.68, 0.06, 1.36, trim, 0.02);
    stripe.position.y = 0.48;
    b.add(stripe);

    const winGeo = new RoundedBoxGeometry(0.02, 0.18, 0.2, 2, 0.02);
    const frameGeo = new RoundedBoxGeometry(0.016, 0.23, 0.25, 2, 0.03);
    const doorGeo = new RoundedBoxGeometry(0.016, 0.36, 0.16, 2, 0.02);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -0.32 + i * 0.32;
        const f = new THREE.Mesh(frameGeo, M.frame);
        f.position.set(side * 0.332, 0.73, z);
        const w = new THREE.Mesh(winGeo, M.window);
        w.position.set(side * 0.338, 0.73, z);
        b.add(f, w);
      }
      for (const z of [-0.58, 0.58]) {
        const d = new THREE.Mesh(doorGeo, trim);
        d.position.set(side * 0.334, 0.68, z);
        const dw = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.1, 0.1, 2, 0.02), M.window);
        dw.position.set(side * 0.341, 0.77, z);
        b.add(d, dw);
      }
    }
    // Rubber gangways at each end
    for (const z of [-0.74, 0.74]) {
      const g = box(0.34, 0.42, 0.08, M.black, 0.03);
      g.position.set(0, 0.68, z);
      b.add(g);
    }

    const roof = box(0.72, 0.1, 1.46, M.roof, 0.05);
    roof.position.y = 0.95;
    b.add(roof);
    const roofTop = box(0.5, 0.06, 1.2, M.roof, 0.03);
    roofTop.position.y = 1.02;
    b.add(roofTop);
    const ventGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.05, 12);
    for (const z of [-0.4, 0, 0.4]) {
      const vent = shadowed(new THREE.Mesh(ventGeo, M.steel));
      vent.position.set(0, 1.07, z);
      b.add(vent);
    }

    // Couplers
    for (const z of [-0.74, 0.74]) {
      const c = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), M.black));
      c.position.set(0, 0.36, z);
      b.add(c);
    }
  }
}
