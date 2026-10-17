import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glassMat } from '../parts.js';
import { Robot } from '../robots.js';
import { hullGeometry, sectionPoint, sectionX, wingGeometry } from './shell.js';

// Little aircraft, built from a few families. Every type is plain data, so
// the player can design new ones (livery, size, engines) and save them.

export const FAMILIES = {
  lark: { label: '螺旋槳小飛機', seatsAbreast: 2, minRows: 1, maxRows: 3 },
  gull: { label: '渦輪螺旋槳客機', seatsAbreast: 2, minRows: 3, maxRows: 8 },
  whale: { label: '噴射客機', seatsAbreast: 4, minRows: 3, maxRows: 9 },
};

export const BASE_TYPES = [
  { id: 'lark', family: 'lark', name: '小雲雀', rows: 1, engines: 1, colors: { body: 0xfbfaf6, stripe: 0xe8553f, belly: 0xfbfaf6, tail: 0xe8553f } },
  { id: 'gull', family: 'gull', name: '海鷗號', rows: 5, engines: 2, colors: { body: 0xfbfaf6, stripe: 0x2f8fd0, belly: 0xc9d6e2, tail: 0x2f8fd0 } },
  { id: 'whale', family: 'whale', name: '藍鯨號', rows: 5, engines: 2, colors: { body: 0xfbfaf6, stripe: 0x1f4f9a, belly: 0x1f4f9a, tail: 0x1f4f9a } },
];

// Seats, price, fare and flight style follow from the design.
export function describe(t) {
  const fam = FAMILIES[t.family];
  const rows = THREE.MathUtils.clamp(t.rows | 0, fam.minRows, fam.maxRows);
  const seats = t.family === 'lark' ? 1 + rows * 2 : rows * fam.seatsAbreast;
  const engines = t.family === 'whale' ? (t.engines === 4 ? 4 : 2) : t.family === 'gull' ? 2 : 1;
  const per = { lark: 120, gull: 90, whale: 80 }[t.family];
  const base = { lark: 450, gull: 750, whale: 1100 }[t.family];
  const price = Math.round((base + seats * per + (engines - 2) * 300) / 50) * 50;
  const fare = { lark: 30, gull: 36, whale: 45 }[t.family];
  const flight = {
    lark: { cruise: 9, alt: 7, radius: 30 },
    gull: { cruise: 10, alt: 9.5, radius: 33 },
    whale: { cruise: 12.5, alt: 12, radius: 37 },
  }[t.family];
  return { ...t, rows, seats, engines, price, fare, ...flight, familyLabel: fam.label };
}

// ---------- Shared bits ----------

const paint = () =>
  new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
const solid = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, ...o });
const PM = {
  liner: new THREE.MeshStandardMaterial({ color: 0xf3ece0, roughness: 0.85, side: THREE.BackSide }),
  carpet: new THREE.MeshStandardMaterial({ color: 0x5d6b80, roughness: 0.95 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.55 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x1f2126, roughness: 0.8 }),
  hub: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.7, roughness: 0.3 }),
  fan: new THREE.MeshStandardMaterial({ color: 0x3b414c, metalness: 0.8, roughness: 0.35 }),
  bins: new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.5 }),
  ceiling: new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0d2233, emissive: 0x3fb6ff, emissiveIntensity: 1.1 }),
  screen2: new THREE.MeshStandardMaterial({ color: 0x0d2233, emissive: 0x6cf0a0, emissiveIntensity: 1.0 }),
  disc: new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  beam: new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
};

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function glow(color, size) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  s.renderOrder = 8;
  return s;
}

function lamp(color, r = 0.025) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 })));
  const halo = glow(color, r * 9);
  g.add(halo);
  g.userData.halo = halo;
  return g;
}

const seatGeo = {
  cushion: new RoundedBoxGeometry(0.15, 0.045, 0.14, 2, 0.02),
  back: new RoundedBoxGeometry(0.15, 0.2, 0.04, 2, 0.018),
  head: new RoundedBoxGeometry(0.11, 0.05, 0.03, 2, 0.012),
  arm: new RoundedBoxGeometry(0.018, 0.05, 0.12, 2, 0.008),
  leg: new THREE.BoxGeometry(0.03, 0.07, 0.03),
};

function seat(fabric, trim) {
  const s = new THREE.Group();
  const c = new THREE.Mesh(seatGeo.cushion, fabric);
  c.position.y = 0.09;
  const back = new THREE.Mesh(seatGeo.back, fabric);
  back.position.set(0, 0.2, -0.07);
  back.rotation.x = -0.14;
  const head = new THREE.Mesh(seatGeo.head, trim);
  head.position.set(0, 0.29, -0.083);
  head.rotation.x = -0.14;
  const leg = new THREE.Mesh(seatGeo.leg, PM.dark);
  leg.position.y = 0.035;
  s.add(c, back, head, leg);
  for (const x of [-0.084, 0.084]) {
    const a = new THREE.Mesh(seatGeo.arm, PM.dark);
    a.position.set(x, 0.135, -0.005);
    s.add(a);
  }
  return s;
}

function pilotLook(i) {
  return {
    name: i ? '副機長' : '機長',
    shirt: 0x1f2d4d,
    accent: 0xf2c14e,
    body: 'belt',
    hat: null,
    neck: 'tie',
    glasses: i ? null : 'sun',
    item: null,
    driver: true,
  };
}
const attendantLook = { name: '空服員', shirt: 0xc8324a, accent: 0xf6f0e6, body: 'skirt', hat: null, neck: 'scarf', glasses: null, item: null };

// ---------- Family geometry ----------

// Every number is in the plane's own frame: +z forward, +x left wing, y up
// from the fuselage bottom. The finished plane sits on its wheels at y = 0.
function layout(t) {
  const f = t.family;
  if (f === 'lark') {
    const H = 0.66;
    const hw = 0.31;
    const len = 0.36 + t.rows * 0.34;
    return {
      H, hw, power: 3, floorY: 0.13, gear: 0.24, zc1: len / 2, zc0: -len / 2,
      nose: { len: 0.62, tipHw: 0.62, tipTop: 0.6, tipBottom: 0.16, blunt: true },
      tail: { len: 1.25, top: 0.72, bottom: 0.52, hw: 0.06 },
    };
  }
  if (f === 'gull') {
    const H = 0.84;
    const hw = 0.4;
    const len = 0.95 + t.rows * 0.3;
    return {
      H, hw, power: 2.3, floorY: 0.17, gear: 0.25, zc1: len / 2, zc0: -len / 2,
      nose: { len: 0.95, tipHw: 0.06, tipTop: 0.46, tipBottom: 0.2 },
      tail: { len: 1.3, top: 0.92, bottom: 0.56, hw: 0.07 },
    };
  }
  const H = 1.0;
  const hw = 0.5;
  const len = 1.05 + t.rows * 0.3;
  return {
    H, hw, power: 2.2, floorY: 0.22, gear: 0.34, zc1: len / 2, zc0: -len / 2,
    nose: { len: 1.05, tipHw: 0.05, tipTop: 0.44, tipBottom: 0.2 },
    tail: { len: 1.5, top: 0.92, bottom: 0.58, hw: 0.07 },
  };
}

function noseStations(L, ref) {
  const { H, hw, nose, zc1 } = L;
  const out = [];
  const N = 14;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    let s;
    if (nose.blunt) {
      // Engine cowling: the roof slopes down to the windscreen, then a
      // rounded box runs forward to the propeller.
      const roof = Math.min(1, t / 0.55);
      const k = (1 - roof ** 1.6) ** 0.7;
      const round = t > 0.85 ? ((t - 0.85) / 0.15) ** 2 : 0;
      s = {
        hw: hw * (nose.tipHw + (1 - nose.tipHw) * (1 - t ** 1.5)) * (1 - round * 0.25),
        top: H * (nose.tipTop + (1 - nose.tipTop) * k) - round * 0.05,
        bottom: H * nose.tipBottom * Math.min(1, t * 1.6) + round * 0.04,
      };
    } else {
      const k = Math.max(0, 1 - t ** 2.1) ** 0.5;
      s = {
        hw: hw * Math.max(nose.tipHw, k),
        top: H * (nose.tipTop + (1 - nose.tipTop) * Math.max(0, 1 - t ** 1.35) ** 0.75),
        bottom: H * nose.tipBottom * t ** 1.7,
      };
    }
    out.push({ z: zc1 + t * nose.len, ...s });
  }
  return out;
}

function tailStations(L) {
  const { H, hw, tail, zc0 } = L;
  const out = [];
  const N = 12;
  for (let i = N; i >= 1; i--) {
    const t = i / N;
    out.push({
      z: zc0 - t * tail.len,
      hw: hw * Math.max(tail.hw, (1 - t ** 1.7) ** 0.8),
      top: H * (1 - (1 - tail.top) * t),
      bottom: H * tail.bottom * t ** 1.25,
    });
  }
  return out;
}

function fuselage(p, L, t) {
  const { H, hw, floorY, zc0, zc1, power } = L;
  const ref = { hw, bottom: 0, top: H };
  const fam = t.family;
  const col = t.colors;
  const cuts = [];
  const winY = fam === 'lark' ? [floorY + 0.2, floorY + 0.43] : [floorY + 0.24, floorY + 0.39];
  // Seat rows, front to back.
  const rows = [];
  let doorZ;
  if (fam === 'lark') {
    const front = zc1 - 0.2;
    rows.push(front);
    for (let i = 0; i < t.rows; i++) rows.push(front - 0.34 * (i + 1));
    doorZ = front;
    for (const z of rows) cuts.push({ z0: z - 0.13, z1: z + 0.13, y0: winY[0], y1: winY[1], side: -1, win: true });
    for (const z of rows.slice(1)) cuts.push({ z0: z - 0.13, z1: z + 0.13, y0: winY[0], y1: winY[1], side: 1, win: true });
    cuts.push({ z0: doorZ - 0.15, z1: doorZ + 0.15, y0: floorY + 0.02, y1: floorY + 0.45, side: 1, door: true });
  } else {
    doorZ = zc1 - 0.42;
    const first = zc1 - 0.74;
    for (let i = 0; i < t.rows; i++) rows.push(first - 0.3 * i);
    for (const z of rows) cuts.push({ z0: z - 0.065, z1: z + 0.065, y0: winY[0], y1: winY[1], win: true });
    cuts.push({ z0: doorZ - 0.12, z1: doorZ + 0.12, y0: floorY + 0.02, y1: floorY + 0.5, side: 1, door: true });
  }
  const shield = fam === 'lark'
    ? { z0: zc1 - 0.02, z1: zc1 + L.nose.len * 0.42, y0: H * 0.6, y1: H * 0.93, wrap: true }
    : { z0: zc1 - 0.06, z1: zc1 + L.nose.len * 0.62, y0: H * 0.56, y1: H * 0.8, wrap: true };
  cuts.push(shield);

  const zs = new Set([zc0, zc1]);
  for (const c of cuts) if (!c.wrap) zs.add(c.z0).add(c.z1);
  const mid = [...zs].sort((a, b) => a - b).map((z) => ({ z, ...ref }));
  const stations = [...tailStations(L), ...mid, ...noseStations(L, ref)];

  // Livery: belly, a cheatline that sweeps up the tail, and the body colour.
  const stripeLo = floorY + 0.13;
  const stripeHi = floorY + (fam === 'whale' ? 0.2 : 0.19);
  const bellyY = H * (fam === 'whale' ? 0.26 : 0.22);
  const colorAt = (x, y) => {
    if (y > stripeLo && y < stripeHi) return col.stripe;
    if (y < bellyY) return col.belly;
    return col.body;
  };
  const extraY = [stripeLo, stripeHi, bellyY];
  const opts = { power, segments: 48, extraY, colorAt };
  const hullMat = paint();
  const hull = new THREE.Mesh(hullGeometry(stations, ref, cuts, opts), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  const liner = new THREE.Mesh(hullGeometry(stations, ref, cuts, { power, segments: 48, extraY }), PM.liner);
  p.body.add(hull, liner);

  const glassCuts = cuts.filter((c) => c.win || c.wrap);
  const glass = new THREE.Mesh(hullGeometry(stations, ref, glassCuts, { power, segments: 48, keep: 'cuts' }), glassMat);
  glass.renderOrder = 2;
  glass.scale.set(1.002, 1, 1);
  p.body.add(glass);

  // The door: the exact plug cut from the hull, on a carriage that pushes
  // it out and slides it forward along the fuselage.
  const doorCut = cuts.find((c) => c.door);
  const plug = new THREE.Mesh(hullGeometry(stations, ref, [doorCut], { ...opts, keep: 'cuts' }), hullMat);
  plug.castShadow = true;
  const backing = new THREE.Mesh(plug.geometry, PM.liner);
  const doorGroup = new THREE.Group();
  const xs = sectionX(ref, (doorCut.y0 + doorCut.y1) / 2, power);
  // Airliner doors push out and slide forward; the little plane's door
  // swings open on its front hinge.
  const swing = fam === 'lark';
  if (swing) {
    plug.geometry.translate(-xs, 0, -doorCut.z1);
    doorGroup.position.set(xs, 0, doorCut.z1);
  }
  doorGroup.add(plug, backing);
  p.body.add(doorGroup);
  p.door = { group: doorGroup, t: 0, open: false, w: doorCut.z1 - doorCut.z0, z: doorZ, swing, x: xs, z1: doorCut.z1 };
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.018, 0.05, 2, 0.006), PM.metal);
  handle.position.set(swing ? 0.006 : xs + 0.006, (doorCut.y0 + doorCut.y1) / 2, swing ? -0.22 : doorZ + 0.03);
  doorGroup.add(handle);

  // Floor and carpet.
  const floorLen = zc1 - zc0 + (fam === 'lark' ? 0.25 : 0.35);
  const fw = sectionX(ref, floorY, power) * 2 - 0.02;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.02, floorLen), PM.carpet);
  floor.position.set(0, floorY - 0.01, (zc0 + zc1) / 2 + (fam === 'lark' ? 0 : 0.15));
  p.body.add(floor);

  p.L = L;
  p.rows = rows;
  p.doorZ = doorZ;
  p.ref = ref;
  return { rows, doorZ, winY };
}

function cabin(p, L, t, rows) {
  const { H, floorY, zc1, hw, power } = L;
  const ref = p.ref;
  const fabric = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.colors.stripe).lerp(new THREE.Color(0x404858), 0.25), roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7 });
  p.seats = [];
  const xs = t.family === 'whale' ? [-0.31, -0.12, 0.12, 0.31] : t.family === 'gull' ? [-0.19, 0.19] : [-0.12, 0.12];
  rows.forEach((z, i) => {
    for (const x of xs) {
      // In the little plane the pilot takes the front-left seat.
      if (t.family === 'lark' && i === 0 && x > 0) continue;
      const s = seat(fabric, trim);
      s.position.set(x, floorY, z);
      p.body.add(s);
      p.seats.push({ pos: new THREE.Vector3(x, floorY + 0.045, z + 0.005), robot: null });
    }
  });

  // Cockpit: instrument panel, glare shield and seats for the crew.
  const panelZ = t.family === 'lark' ? zc1 + 0.06 : zc1 + 0.24;
  const panelY = floorY + (t.family === 'lark' ? 0.27 : 0.3);
  const pw = sectionX(ref, panelY, power) * 1.5;
  const panel = new THREE.Mesh(new RoundedBoxGeometry(pw, 0.12, 0.08, 2, 0.02), PM.dark);
  panel.position.set(0, panelY, panelZ);
  p.body.add(panel);
  const nScreens = t.family === 'lark' ? 2 : 4;
  for (let i = 0; i < nScreens; i++) {
    const sx = (i - (nScreens - 1) / 2) * (pw / nScreens) * 0.95;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(pw / nScreens * 0.7, 0.07), i % 2 ? PM.screen2 : PM.screen);
    scr.position.set(sx, panelY + 0.005, panelZ - 0.042);
    scr.rotation.y = Math.PI;
    p.body.add(scr);
  }
  const crewSeats = [];
  const crewZ = t.family === 'lark' ? rows[0] : zc1 - 0.06;
  const crewX = t.family === 'lark' ? [0.12] : [0.13, -0.13];
  for (const x of crewX) {
    if (t.family !== 'lark') {
      const s = seat(new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8 }), trim);
      s.position.set(x, floorY, crewZ);
      p.body.add(s);
    }
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI), PM.dark);
    yoke.position.set(x, panelY - 0.03, panelZ - 0.1);
    yoke.rotation.z = Math.PI;
    p.body.add(yoke);
    crewSeats.push({ pos: new THREE.Vector3(x, floorY + 0.045, crewZ + 0.005) });
  }
  p.crewSeats = crewSeats;

  if (t.family !== 'lark') {
    // Overhead bins and a warm ceiling light strip.
    const zA = rows[rows.length - 1] - 0.18;
    const zB = rows[0] + 0.14;
    const binY = floorY + 0.5;
    for (const s of [-1, 1]) {
      const bin = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.09, zB - zA, 2, 0.03), PM.bins);
      bin.position.set(s * (sectionX(ref, binY, power) - 0.09), binY, (zA + zB) / 2);
      p.body.add(bin);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, zB - zA), PM.ceiling);
    strip.position.set(0, H - 0.07, (zA + zB) / 2);
    p.body.add(strip);
    // Bulkhead between cockpit and cabin, with an open doorway.
    const outline = new THREE.Shape();
    for (let k = 0; k <= 48; k++) {
      const [x, y] = sectionPoint({ ...ref, hw: ref.hw - 0.02, bottom: 0.02, top: H - 0.02 }, (k / 48) * Math.PI * 2, power);
      if (k === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    }
    const hole = new THREE.Path();
    const dw = 0.1;
    hole.moveTo(-dw, floorY).lineTo(dw, floorY).lineTo(dw, floorY + 0.5).lineTo(-dw, floorY + 0.5).lineTo(-dw, floorY);
    outline.holes.push(hole);
    const bh = new THREE.Mesh(new THREE.ShapeGeometry(outline, 4), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7, side: THREE.DoubleSide }));
    bh.position.z = zc1 - 0.22;
    p.body.add(bh);
  }
  // A soft warm light so the windows glow.
  const lamp = new THREE.PointLight(0xffd7a0, 0.5, hw * 7, 1.6);
  lamp.position.set(0, H * 0.75, (rows[0] + rows[rows.length - 1]) / 2);
  p.body.add(lamp);
  p.cabinLight = lamp;
}

function wings(p, L, t) {
  const { H, hw, zc0, zc1 } = L;
  const fam = t.family;
  const wingMat = solid(0xf2f3f5, { clearcoat: 0.5 });
  const accentMat = solid(t.colors.tail);
  const mid = (zc0 + zc1) / 2;
  let w;
  if (fam === 'whale') {
    w = { span: 2.0, root: 1.3, tip: 0.42, sweep: 0.85, dihedral: 0.1, y: H * 0.2, z: mid + 0.55, x: hw * 0.6, thick: 0.13 };
  } else if (fam === 'gull') {
    w = { span: 2.15, root: 0.66, tip: 0.44, sweep: 0.08, dihedral: -0.015, y: H * 0.98, z: mid + 0.28, x: hw * 0.2, thick: 0.15 };
  } else {
    w = { span: 1.55, root: 0.54, tip: 0.46, sweep: 0.03, dihedral: 0.035, y: H * 1.0, z: zc1 + 0.06, x: 0, thick: 0.15 };
  }
  const geo = wingGeometry({ span: w.span, root: w.root, tip: w.tip, sweep: w.sweep, dihedral: w.dihedral, thick: w.thick });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(geo, wingMat);
    m.position.set(s * w.x, w.y, w.z);
    m.scale.x = s;
    m.castShadow = m.receiveShadow = true;
    p.body.add(m);
  }
  const tipX = w.x + w.span;
  const tipY = w.y + Math.tan(w.dihedral) * w.span;
  const tipZ = w.z - w.sweep - w.tip * 0.5;
  if (fam === 'whale') {
    // Winglets in the tail colour.
    const wl = wingGeometry({ span: 0.32, root: w.tip * 0.85, tip: 0.12, sweep: 0.22, thick: 0.1, camber: 0 });
    wl.rotateZ(Math.PI / 2 - 0.12);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(wl, accentMat);
      m.position.set(s * (tipX + 0.02), tipY, w.z - w.sweep - 0.02);
      m.scale.x = s;
      m.castShadow = true;
      p.body.add(m);
    }
    // Belly fairing where the wing meets the body.
    const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), solid(t.colors.belly));
    fair.scale.set(hw * 0.92, 0.16, 1.0);
    fair.position.set(0, H * 0.14, w.z - 0.5);
    p.body.add(fair);
  }
  if (fam === 'gull') {
    const fair = new THREE.Mesh(new RoundedBoxGeometry(hw * 1.1, 0.12, w.root * 1.3, 3, 0.05), solid(t.colors.body));
    fair.position.set(0, H * 0.96, w.z - w.root * 0.45);
    p.body.add(fair);
    // Sponsons that hold the main gear.
    for (const s of [-1, 1]) {
      const sp = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.16, 0.72, 3, 0.07), solid(t.colors.belly));
      sp.position.set(s * (hw * 0.86), 0.12, w.z - 0.32);
      sp.castShadow = true;
      p.body.add(sp);
    }
  }
  if (fam === 'lark') {
    // Wing struts down to the lower fuselage.
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * hw * 0.85, H * 0.18, w.z - 0.24);
      const b = new THREE.Vector3(s * (w.span * 0.55), w.y + Math.tan(w.dihedral) * w.span * 0.55 - 0.02, w.z - 0.24);
      const dir = b.clone().sub(a);
      const strut = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, dir.length(), 4, 8), wingMat);
      strut.position.copy(a).addScaledVector(dir, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      strut.castShadow = true;
      p.body.add(strut);
    }
    // Coloured wingtips.
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, w.tip * 0.9, 2, 0.03), accentMat);
      cap.position.set(s * (tipX - 0.02), tipY, w.z - w.tip * 0.48);
      p.body.add(cap);
    }
  }
  p.wing = { ...w, tipX, tipY, tipZ };
  return w;
}

function tail(p, L, t) {
  const { H, zc0 } = L;
  const fam = t.family;
  const finMat = solid(t.colors.tail);
  const stabMat = solid(0xf2f3f5, { clearcoat: 0.5 });
  const tailEnd = zc0 - L.tail.len;
  let fin;
  let stab;
  if (fam === 'whale') {
    fin = { span: 1.05, root: 1.1, tip: 0.45, sweep: 0.7, z: tailEnd + 1.25, y: H * 0.88 };
    stab = { span: 0.95, root: 0.6, tip: 0.24, sweep: 0.45, z: tailEnd + 0.75, y: H * 0.62, dihedral: 0.12 };
  } else if (fam === 'gull') {
    fin = { span: 0.95, root: 0.85, tip: 0.55, sweep: 0.45, z: tailEnd + 1.0, y: H * 0.88 };
    stab = { span: 0.78, root: 0.44, tip: 0.27, sweep: 0.12, z: tailEnd + 0.48 - 0.45 + 0.02, y: H * 0.88 + 0.95, dihedral: 0 };
  } else {
    fin = { span: 0.6, root: 0.62, tip: 0.32, sweep: 0.36, z: tailEnd + 0.66, y: H * 0.68 };
    stab = { span: 0.68, root: 0.38, tip: 0.26, sweep: 0.08, z: tailEnd + 0.4, y: H * 0.62, dihedral: 0 };
  }
  const fg = wingGeometry({ span: fin.span, root: fin.root, tip: fin.tip, sweep: fin.sweep, thick: 0.12, camber: 0 });
  fg.rotateZ(Math.PI / 2);
  const finMesh = new THREE.Mesh(fg, finMat);
  finMesh.position.set(0, fin.y, fin.z);
  finMesh.castShadow = true;
  p.body.add(finMesh);
  // Emblem on both sides of the fin: a white disc with a little bird.
  const emblem = emblemTexture(t.colors.tail);
  const r = Math.min(fin.root, fin.span) * 0.26;
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshStandardMaterial({ map: emblem, roughness: 0.35, transparent: true }));
    e.position.set(s * 0.03, fin.y + fin.span * 0.48, fin.z - fin.sweep * 0.48 - fin.root * 0.42);
    e.rotation.y = (s * Math.PI) / 2;
    p.body.add(e);
  }
  const sg = wingGeometry({ span: stab.span, root: stab.root, tip: stab.tip, sweep: stab.sweep, dihedral: stab.dihedral, thick: 0.1, camber: 0 });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(sg, fam === 'gull' ? finMat : stabMat);
    m.position.set(0, stab.y, stab.z);
    m.scale.x = s;
    m.castShadow = true;
    p.body.add(m);
  }
  p.finTop = new THREE.Vector3(0, fin.y + fin.span, fin.z - fin.sweep - fin.tip * 0.5);
  p.tailEnd = tailEnd;
}

function emblemTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#' + new THREE.Color(color).getHexString();
  g.fillStyle = g.strokeStyle;
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // A stylised bird in flight.
  g.beginPath();
  g.moveTo(22, 60);
  g.quadraticCurveTo(44, 36, 64, 62);
  g.quadraticCurveTo(84, 36, 106, 60);
  g.stroke();
  g.beginPath();
  g.arc(64, 82, 9, 0, Math.PI * 2);
  g.fillStyle = '#f2c14e';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function propeller(blades, radius, colorMat) {
  const g = new THREE.Group();
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), colorMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.scale.set(1, 1.6, 1);
  const rotor = new THREE.Group();
  const bladeGeo = new RoundedBoxGeometry(radius * 0.17, radius, 0.014, 2, 0.006);
  bladeGeo.translate(0, radius / 2 + radius * 0.12, 0);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(bladeGeo, PM.dark);
    const holder = new THREE.Group();
    b.rotation.y = 0.35;
    holder.add(b);
    holder.rotation.z = (i / blades) * Math.PI * 2;
    rotor.add(holder);
    const tipPaint = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.17, radius * 0.08, 0.016), new THREE.MeshStandardMaterial({ color: 0xf2c14e }));
    tipPaint.position.y = radius * 1.07;
    tipPaint.rotation.y = 0.35;
    holder.add(tipPaint);
  }
  rotor.add(spinner);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.12, 40), PM.disc);
  disc.visible = false;
  g.add(rotor, disc);
  g.userData = { rotor, disc };
  return g;
}

function engines(p, L, t, w) {
  const fam = t.family;
  p.rotors = [];
  const nacMat = solid(fam === 'whale' ? 0xf4f5f7 : t.colors.body);
  const lipMat = PM.metal;
  if (fam === 'lark') {
    const prop = propeller(2, 0.3, solid(t.colors.stripe));
    const tipZ = L.zc1 + L.nose.len;
    prop.position.set(0, L.H * ((L.nose.tipTop + L.nose.tipBottom) / 2) + 0.02, tipZ + 0.01);
    p.body.add(prop);
    p.rotors.push({ obj: prop.userData.rotor, disc: prop.userData.disc, kind: 'prop' });
    return;
  }
  if (fam === 'gull') {
    for (const s of [-1, 1]) {
      const x = s * (w.x + w.span * 0.34);
      const y = w.y + Math.tan(w.dihedral) * w.span * 0.34;
      const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.62, 6, 18), nacMat);
      nac.rotation.x = Math.PI / 2;
      nac.scale.set(1, 1, 1.1);
      nac.position.set(x, y - 0.06, w.z - 0.2);
      nac.castShadow = true;
      p.body.add(nac);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 8, 24), solid(t.colors.stripe));
      ring.position.set(x, y - 0.06, w.z + 0.1);
      p.body.add(ring);
      const prop = propeller(6, 0.36, solid(t.colors.stripe));
      prop.position.set(x, y - 0.05, w.z + 0.36);
      p.body.add(prop);
      p.rotors.push({ obj: prop.userData.rotor, disc: prop.userData.disc, kind: 'prop', dir: s });
    }
    return;
  }
  // Turbofans hung under the wing.
  const R = 0.17;
  const len = 0.66;
  const prof = [
    [R * 0.74, len * 0.36],
    [R * 0.86, len * 0.5],
    [R * 0.97, len * 0.52],
    [R * 1.04, len * 0.44],
    [R * 1.04, len * 0.05],
    [R * 0.88, -len * 0.42],
    [R * 0.62, -len * 0.5],
    [R * 0.56, -len * 0.42],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const nacGeo = new THREE.LatheGeometry(prof, 36);
  nacGeo.rotateX(Math.PI / 2);
  const stations = t.engines === 4 ? [0.3, 0.62] : [0.36];
  for (const s of [-1, 1]) {
    for (const f of stations) {
      const x = s * (w.x + w.span * f);
      const yw = w.y + Math.tan(w.dihedral) * w.span * f;
      const zw = w.z - w.sweep * f;
      const g = new THREE.Group();
      g.position.set(x, yw - R * 1.25, zw + 0.12);
      const nac = new THREE.Mesh(nacGeo, nacMat);
      nac.castShadow = true;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, R * 0.11, 10, 32), lipMat);
      lip.position.z = len * 0.5;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.045, R * 1.045, 0.06, 36, 1, true), solid(t.colors.stripe));
      band.rotation.x = Math.PI / 2;
      band.position.z = len * 0.2;
      const fanFace = new THREE.Mesh(new THREE.CircleGeometry(R * 0.76, 32), PM.fan);
      fanFace.position.z = len * 0.36;
      const rotor = new THREE.Group();
      rotor.position.z = len * 0.37;
      const bladeGeo = new THREE.BoxGeometry(R * 0.16, R * 0.62, 0.012);
      bladeGeo.translate(0, R * 0.38, 0);
      for (let i = 0; i < 14; i++) {
        const b = new THREE.Mesh(bladeGeo, PM.metal);
        b.rotation.set(0, 0.5, (i / 14) * Math.PI * 2);
        rotor.add(b);
      }
      const spin = new THREE.Mesh(new THREE.ConeGeometry(R * 0.24, R * 0.5, 20), new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.6, roughness: 0.3 }));
      spin.rotation.x = Math.PI / 2;
      spin.position.z = 0.04;
      rotor.add(spin);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(R * 0.5, R * 1.1, 24), PM.metal);
      cone.rotation.x = -Math.PI / 2;
      cone.position.z = -len * 0.5 - R * 0.35;
      const pylon = new THREE.Mesh(new RoundedBoxGeometry(0.04, R * 0.6, len * 0.55, 2, 0.015), nacMat);
      pylon.position.set(0, R * 0.9, -len * 0.3);
      g.add(nac, lip, band, fanFace, rotor, cone, pylon);
      p.body.add(g);
      p.rotors.push({ obj: rotor, kind: 'fan' });
    }
  }
}

function gear(p, L, t, w) {
  const fam = t.family;
  const G = L.gear;
  p.gearUnits = [];
  const unit = (x, z, wheelR, pair, pants) => {
    const g = new THREE.Group();
    g.position.set(x, 0.06, z);
    const strutLen = G + 0.06 - wheelR;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, strutLen, 8), PM.metal);
    strut.position.y = -strutLen / 2;
    g.add(strut);
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.05, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.055, 14);
    hubGeo.rotateZ(Math.PI / 2);
    const offs = pair ? [-0.04, 0.04] : [0];
    for (const o of offs) {
      const wh = new THREE.Mesh(wheelGeo, PM.tyre);
      wh.position.set(o, -strutLen, 0);
      wh.castShadow = true;
      const hb = new THREE.Mesh(hubGeo, PM.hub);
      hb.position.copy(wh.position);
      g.add(wh, hb);
    }
    if (pants) {
      const pant = new THREE.Mesh(new THREE.CapsuleGeometry(wheelR * 0.75, wheelR * 1.5, 4, 14), solid(t.colors.stripe));
      pant.rotation.x = Math.PI / 2;
      pant.scale.set(0.7, 1, 1.05);
      pant.position.set(0, -strutLen + wheelR * 0.25, -0.01);
      pant.castShadow = true;
      g.add(pant);
    }
    p.body.add(g);
    p.gearUnits.push({ obj: g, x });
    return g;
  };
  const noseZ = L.zc1 + L.nose.len * (fam === 'lark' ? 0.55 : 0.4);
  if (fam === 'lark') {
    unit(0, noseZ, 0.06, false, true);
    for (const s of [-1, 1]) unit(s * 0.36, w.z - 0.42, 0.07, false, true);
    p.fixedGear = true;
  } else if (fam === 'gull') {
    unit(0, noseZ, 0.06, true);
    for (const s of [-1, 1]) unit(s * L.hw * 0.86, w.z - 0.32, 0.075, true);
  } else {
    unit(0, noseZ, 0.065, true);
    for (const s of [-1, 1]) unit(s * 0.4, w.z - 0.78, 0.085, true);
  }
  p.noseGearZ = noseZ;
}

function lights(p, L, t, w) {
  p.lights = {};
  const tip = (s) => new THREE.Vector3(s * (w.tipX + 0.03), w.tipY, w.z - w.sweep - w.tip * 0.4);
  const red = lamp(0xff3b30);
  red.position.copy(tip(1));
  const green = lamp(0x33ff7a);
  green.position.copy(tip(-1));
  const white = lamp(0xffffff);
  white.position.set(0, L.H * L.tail.top + 0.02, p.tailEnd + 0.02);
  p.body.add(red, green, white);
  const strobes = [];
  for (const s of [-1, 1]) {
    const st = glow(0xffffff, 0.9);
    st.position.copy(tip(s)).add(new THREE.Vector3(0, 0, -0.08));
    st.visible = false;
    p.body.add(st);
    strobes.push(st);
  }
  const beacons = [];
  for (const y of [L.H + 0.02, -0.01]) {
    const b = lamp(0xff2a1a, 0.022);
    b.position.set(0, y, (L.zc0 + L.zc1) / 2 - 0.1);
    p.body.add(b);
    beacons.push(b);
  }
  // Landing lights with a faint beam.
  const landing = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * (w.x + 0.32), w.y + (t.family === 'whale' ? 0.02 : -0.04), w.z + 0.02);
    const halo = glow(0xfff3d0, 0.5);
    const beamGeo = new THREE.ConeGeometry(0.4, 2.4, 24, 1, true);
    beamGeo.translate(0, -1.2, 0);
    beamGeo.rotateX(-Math.PI / 2 + 0.08);
    const beam = new THREE.Mesh(beamGeo, PM.beam);
    beam.renderOrder = 9;
    g.add(halo, beam);
    g.visible = false;
    p.body.add(g);
    landing.push(g);
  }
  p.lights = { strobes, beacons, landing };
}

// ---------- The plane ----------

export class Plane {
  constructor(type) {
    this.type = describe(type);
    const t = this.type;
    this.group = new THREE.Group();
    this.attitude = new THREE.Group(); // pitch about the main wheels
    this.body = new THREE.Group();
    this.group.add(this.attitude);
    this.attitude.add(this.body);
    const L = layout(t);
    this.body.position.y = L.gear;
    const { rows } = fuselage(this, L, t);
    cabin(this, L, t, rows);
    const w = wings(this, L, t);
    tail(this, L, t);
    engines(this, L, t, w);
    gear(this, L, t, w);
    lights(this, L, t, w);
    this.length = L.zc1 + L.nose.len - this.tailEnd;
    this.span = 2 * (w.tipX + 0.1);
    this.gearDown = 1;
    this.engine = 0; // 0 = off, 1 = full
    this.engineTarget = 0;
    this.spin = 0;
    this.landingLights = false;

    // Crew are always aboard.
    this.crew = [];
    const nCrew = t.family === 'lark' ? 1 : 2;
    for (let i = 0; i < nCrew; i++) {
      const r = new Robot(pilotLook(i));
      r.scale = 0.92;
      this.body.add(r.mesh);
      r.sit(this.crewSeats[i]);
      this.crew.push(r);
    }
    if (t.family === 'whale') {
      const a = new Robot(attendantLook);
      a.scale = 0.92;
      this.body.add(a.mesh);
      a.mesh.position.set(-0.22, L.floorY, this.doorZ - 0.02);
      a.mesh.rotation.y = Math.PI / 2;
      this.crew.push(a);
    }
  }

  get floorY() {
    return this.L.floorY;
  }

  // Where boarding robots step in and out, in body coordinates.
  get doorInside() {
    return new THREE.Vector3(this.type.family === 'lark' ? 0.12 : this.L.hw * 0.4, this.L.floorY, this.doorZ);
  }

  get doorOutside() {
    return new THREE.Vector3(this.L.hw + 0.1, this.L.floorY, this.doorZ);
  }

  // Height of the door sill above the ground.
  get sill() {
    return this.L.gear + this.L.floorY;
  }

  setDoor(open) {
    this.door.open = open;
  }

  update(dt, time) {
    const d = this.door;
    d.t += ((d.open ? 1 : 0) - d.t) * Math.min(1, dt * 3);
    if (d.swing) {
      d.group.rotation.y = -d.t * 1.25;
    } else {
      const out = Math.min(1, d.t * 2.5);
      const slide = Math.max(0, (d.t - 0.35) / 0.65);
      d.group.position.set(out * 0.05, 0, slide * (d.w + 0.03));
    }

    this.engine += (this.engineTarget - this.engine) * Math.min(1, dt * 0.8);
    this.spin += dt * (this.engine * 40 + (this.engine > 0.02 ? 4 : 0));
    for (const r of this.rotors) {
      r.obj.rotation.z = this.spin * (r.dir ?? 1);
      if (r.disc) {
        r.disc.visible = this.engine > 0.4;
        r.disc.material.opacity = 0.05 + this.engine * 0.12;
      }
    }

    if (!this.fixedGear) {
      for (const g of this.gearUnits) {
        const k = 1 - this.gearDown;
        g.obj.rotation.x = (g.x === 0 ? -1 : 1) * k * 1.5;
        g.obj.scale.setScalar(1 - k * 0.5);
        g.obj.visible = this.gearDown > 0.02;
      }
    }

    // Beacons pulse while engines run; strobes double-flash in flight.
    const running = this.engine > 0.05 || this.engineTarget > 0;
    const pulse = running ? 0.5 + 0.5 * Math.sin(time * 6) : 0;
    for (const b of this.lights.beacons) {
      b.userData.halo.material.opacity = pulse;
      b.userData.halo.scale.setScalar(0.12 + pulse * 0.25);
    }
    const ph = (time * 1.1) % 1;
    const flash = this.airborne && (ph < 0.04 || (ph > 0.1 && ph < 0.14));
    for (const s of this.lights.strobes) s.visible = flash;
    for (const l of this.lights.landing) l.visible = this.landingLights;

    for (const r of this.crew) r.update(dt, time);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}
