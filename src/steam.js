import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M, Vehicle, axle, box, buildCabin, mat, shadowed } from './parts.js';

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
    // An open-sided cab so the driver can be seen at work.
    const panel = (w, h, d, x, y, z, m = red) => {
      const p = box(w, h, d, m, 0.02);
      p.position.set(x, y, z);
      b.add(p);
    };
    panel(0.68, 0.62, 0.05, 0, 0.76, -0.17); // front wall behind the boiler
    panel(0.68, 0.3, 0.05, 0, 0.6, -0.73); // back wall
    for (const side of [-1, 1]) {
      panel(0.05, 0.3, 0.6, side * 0.315, 0.6, -0.45); // side panels
      panel(0.05, 0.07, 0.6, side * 0.315, 1.035, -0.45); // header
      for (const z of [-0.73, -0.17]) panel(0.05, 0.36, 0.05, side * 0.315, 0.88, z);
      // Brass window rails
      const rail = box(0.02, 0.02, 0.5, M.gold, 0.008);
      rail.position.set(side * 0.33, 0.76, -0.45);
      b.add(rail);
    }
    panel(0.6, 0.02, 0.52, 0, 0.47, -0.45, M.black); // floor
    // Firebox door and gauges inside
    const firebox = box(0.24, 0.18, 0.03, M.black, 0.02);
    firebox.position.set(0, 0.6, -0.205);
    const fire = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6a1a, emissiveIntensity: 1.5 }));
    fire.position.set(0, 0.6, -0.188);
    fire.rotation.y = Math.PI;
    b.add(firebox, fire);
    for (const x of [-0.12, 0.12]) {
      const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.015, 16), M.gold);
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(x, 0.86, -0.2);
      b.add(gauge);
    }
    this.cabin = { pos: new THREE.Vector3(0.04, 0.48, -0.47), rotY: 0.6, scale: 1 };
    const cabRoof = box(0.8, 0.08, 0.74, M.black, 0.04);
    cabRoof.position.set(0, 1.1, -0.45);
    b.add(cabRoof);
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

    buildCabin(this, {
      ref: { hw: 0.33, bottom: 0.41, top: 0.91 },
      z0: -0.7,
      z1: 0.7,
      power: 6,
      paint: mat(color, { roughness: 0.45 }),
      windows: [-0.3, 0, 0.3].map((z) => ({ z, w: 0.2 })),
      winY: [0.6, 0.85],
      doors: [{ z: -0.58, w: 0.14 }, { z: 0.58, w: 0.14 }],
      floorY: 0.45,
      doorTop: 0.87,
      doorMat: trim,
      rows: [-0.3, 0, 0.3],
      seatX: 0.15,
      seatColor: 0xb8433a,
    });

    for (const side of [-1, 1]) {
      const stripe = box(0.012, 0.05, 0.98, trim, 0.01);
      stripe.position.set(side * 0.332, 0.5, 0);
      b.add(stripe);
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
