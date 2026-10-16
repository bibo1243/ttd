import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Little robot residents. Each one has its own outfit and something it
// carries around; the glowing antenna tip shows where it is heading.

const G = {
  body: new RoundedBoxGeometry(0.16, 0.13, 0.12, 2, 0.04),
  head: new RoundedBoxGeometry(0.19, 0.14, 0.15, 3, 0.055),
  visor: new RoundedBoxGeometry(0.15, 0.075, 0.02, 2, 0.03),
  eye: new THREE.SphereGeometry(0.016, 10, 8),
  stalk: new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6),
  ball: new THREE.SphereGeometry(0.022, 12, 10),
  leg: new THREE.CapsuleGeometry(0.022, 0.03, 4, 8),
  arm: new THREE.SphereGeometry(0.03, 10, 8),
};

const cache = new Map();
const matte = (color, roughness = 0.6) => {
  const key = `m${color}-${roughness}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
  return cache.get(key);
};
const glossy = (color) => {
  const key = `g${color}`;
  if (!cache.has(key)) cache.set(key, new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.4 }));
  return cache.get(key);
};
const glow = (color) => {
  const key = `e${color}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));
  }
  return cache.get(key);
};

const RM = {
  white: new THREE.MeshPhysicalMaterial({ color: 0xf6f7f9, roughness: 0.3, clearcoat: 0.5 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.1, metalness: 0.5 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x4fe0ff, emissiveIntensity: 1.6 }),
  dark: matte(0x3a3f4a),
  idle: new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.4 }),
};

const SHIRTS = [0xe85d4a, 0xf2a541, 0x7bc67b, 0x4a90c8, 0x9b7fd1, 0xe8789a, 0x56c2c2, 0xf4d35e, 0x5c6b7a, 0xf0ebe0];
const ACCENTS = [0xffffff, 0x2f3440, 0xf2c14e, 0xd94a3a, 0x3a86d4, 0x2e7d5b, 0xf7a6c1];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
const rbox = (w, h, d, r, mat, x, y, z) => mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, x, y, z);

// ---------- Outfits ----------

const HATS = {
  straw(g) {
    const m = matte(0xe9cf8f, 0.8);
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.012, 24), m, 0, 0.35, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 20), m, 0, 0.375, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.014, 20), matte(pick([0xd94a3a, 0x3a86d4, 0x2f3440])), 0, 0.36, 0));
  },
  beanie(g, c) {
    const m = matte(c, 0.9);
    const dome = mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.33, 0);
    dome.scale.set(1, 0.75, 0.85);
    g.add(dome, mesh(new THREE.SphereGeometry(0.025, 10, 8), matte(0xffffff, 0.9), 0.06, 0.39, 0));
  },
  cap(g, c) {
    const m = matte(c);
    const dome = mesh(new THREE.SphereGeometry(0.098, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.335, 0);
    dome.scale.set(1, 0.6, 0.8);
    const brim = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16, 1, false, -Math.PI / 2, Math.PI), m, 0, 0.338, 0.07);
    g.add(dome, brim);
  },
  tophat(g) {
    const m = matte(0x24262c, 0.5);
    g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 24), m, 0, 0.345, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.1, 20), m, 0, 0.4, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.016, 20), matte(0xd94a3a), 0, 0.36, 0));
  },
  bow(g, c) {
    const m = glossy(c);
    const l = mesh(new THREE.SphereGeometry(0.035, 12, 8), m, -0.04, 0.35, 0.03);
    const r = mesh(new THREE.SphereGeometry(0.035, 12, 8), m, 0.04, 0.35, 0.03);
    l.scale.set(1.2, 0.8, 0.5);
    r.scale.set(1.2, 0.8, 0.5);
    g.add(l, r, mesh(new THREE.SphereGeometry(0.018, 10, 8), m, 0, 0.35, 0.035));
  },
  headphones(g, c) {
    const m = glossy(c);
    const band = mesh(new THREE.TorusGeometry(0.1, 0.01, 6, 20, Math.PI), m, 0, 0.27, 0);
    g.add(band);
    for (const s of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14), m, s * 0.1, 0.27, 0);
      cup.rotation.z = Math.PI / 2;
      g.add(cup);
    }
  },
};

// Kept out of HATS so only drivers wear it.
function conductorCap(g) {
  const navy = matte(0x1f2d4d, 0.5);
  const crown = mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.05, 24), navy, 0, 0.37, -0.005);
  crown.scale.z = 0.9;
  const band = mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.014, 24), new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.6, roughness: 0.3 }), 0, 0.352, -0.005);
  const brim = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 16, 1, false, -Math.PI / 2, Math.PI), matte(0x111111, 0.3), 0, 0.345, 0.06);
  brim.rotation.x = 0.15;
  const badge = mesh(new THREE.SphereGeometry(0.012, 10, 8), band.material, 0, 0.375, 0.085);
  g.add(crown, band, brim, badge);
}

const NECKS = {
  scarf(g, c) {
    const m = matte(c, 0.9);
    const ring = mesh(new THREE.TorusGeometry(0.06, 0.022, 8, 20), m, 0, 0.2, 0);
    ring.rotation.x = Math.PI / 2;
    const tail = rbox(0.035, 0.08, 0.016, 0.008, m, 0.03, 0.16, 0.065);
    tail.rotation.z = 0.15;
    g.add(ring, tail);
  },
  bowtie(g, c) {
    const m = glossy(c);
    for (const s of [-1, 1]) {
      const wing = mesh(new THREE.ConeGeometry(0.022, 0.04, 4), m, s * 0.02, 0.185, 0.064);
      wing.rotation.z = (s * Math.PI) / 2;
      g.add(wing);
    }
    g.add(mesh(new THREE.SphereGeometry(0.011, 8, 6), m, 0, 0.185, 0.066));
  },
  tie(g, c) {
    const m = glossy(c);
    g.add(rbox(0.026, 0.09, 0.008, 0.004, m, 0, 0.14, 0.063));
  },
  necklace(g) {
    const m = new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.7, roughness: 0.25 });
    const ring = mesh(new THREE.TorusGeometry(0.058, 0.005, 6, 24), m, 0, 0.19, 0.005);
    ring.rotation.x = Math.PI / 2 - 0.35;
    g.add(ring, mesh(new THREE.SphereGeometry(0.012, 10, 8), glossy(0xe8789a), 0, 0.17, 0.062));
  },
};

const BODIES = {
  plain() {},
  stripes(g, c) {
    for (const y of [0.1, 0.15]) g.add(rbox(0.164, 0.014, 0.124, 0.006, matte(c), 0, y, 0));
  },
  overalls(g, c) {
    const m = matte(c, 0.8);
    g.add(rbox(0.166, 0.06, 0.126, 0.02, m, 0, 0.095, 0));
    for (const s of [-1, 1]) g.add(rbox(0.016, 0.06, 0.006, 0.004, m, s * 0.04, 0.155, 0.062));
  },
  skirt(g, c) {
    const sk = mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.06, 20), matte(c, 0.8), 0, 0.085, 0);
    g.add(sk);
  },
  belt(g, c) {
    g.add(rbox(0.166, 0.018, 0.126, 0.008, matte(c), 0, 0.09, 0));
    g.add(rbox(0.024, 0.02, 0.006, 0.004, new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.6, roughness: 0.3 }), 0, 0.09, 0.064));
  },
};

function glasses(g, kind) {
  const m = kind === 'sun' ? new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.4 }) : matte(0x2f3440, 0.4);
  for (const s of [-1, 1]) {
    if (kind === 'sun') {
      g.add(rbox(0.05, 0.03, 0.008, 0.01, m, s * 0.035, 0.28, 0.086));
    } else {
      const rim = mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 16), m, s * 0.035, 0.278, 0.086);
      g.add(rim);
    }
  }
  g.add(rbox(0.02, 0.005, 0.005, 0.002, m, 0, 0.283, 0.087));
}

// ---------- Belongings ----------

const ITEMS = {
  backpack: { label: '背包', make(g) {
    const c = pick(SHIRTS);
    g.add(rbox(0.13, 0.13, 0.06, 0.025, matte(c, 0.8), 0, 0.15, -0.085));
    g.add(rbox(0.1, 0.05, 0.02, 0.01, matte(new THREE.Color(c).multiplyScalar(0.75).getHex(), 0.8), 0, 0.12, -0.12));
    for (const s of [-1, 1]) g.add(rbox(0.016, 0.11, 0.006, 0.004, matte(0x2f3440), s * 0.045, 0.15, 0.062));
  } },
  suitcase: { label: '行李箱', make(g) {
    const c = pick([0xe85d4a, 0x4a90c8, 0xf2a541, 0x9b7fd1, 0x56c2c2]);
    const grp = new THREE.Group();
    grp.position.set(0.15, 0, -0.02);
    grp.add(rbox(0.06, 0.11, 0.1, 0.015, glossy(c), 0, 0.075, 0));
    grp.add(rbox(0.062, 0.012, 0.102, 0.004, matte(0x2f3440), 0, 0.08, 0));
    grp.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6), matte(0x9aa3ad), 0, 0.17, -0.03));
    grp.add(rbox(0.012, 0.012, 0.04, 0.004, matte(0x2f3440), 0, 0.21, -0.03));
    for (const z of [-0.04, 0.04]) {
      const w = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10), matte(0x24262c), 0, 0.014, z);
      w.rotation.z = Math.PI / 2;
      grp.add(w);
    }
    g.add(grp);
  } },
  balloon: { label: '氣球', make(g, r) {
    const c = pick([0xe85d4a, 0xf4d35e, 0xe8789a, 0x56c2c2, 0x9b7fd1]);
    const grp = new THREE.Group();
    const ball = mesh(new THREE.SphereGeometry(0.06, 20, 14), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.15, clearcoat: 1 }), 0.13, 0.62, 0);
    ball.scale.y = 1.15;
    const knot = mesh(new THREE.ConeGeometry(0.012, 0.02, 8), ball.material, 0.13, 0.545, 0);
    knot.rotation.x = Math.PI;
    const string = mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.42, 4), matte(0xffffff), 0.125, 0.33, 0);
    grp.add(ball, knot, string);
    g.add(grp);
    r.indoorHooks.push((inside) => {
      // Pull the string short so it fits under the car roof.
      grp.scale.y = inside ? 0.62 : 1;
    });
    r.bobbers.push(grp);
  } },
  umbrella: { label: '雨傘', make(g, r) {
    const c = pick([0xe85d4a, 0x4a90c8, 0xf4d35e, 0x7bc67b, 0xe8789a]);
    const shaft = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.46, 6), matte(0x5c4a3a), 0.12, 0.34, 0);
    const handle = mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12, Math.PI), matte(0x5c4a3a), 0.138, 0.11, 0);
    handle.rotation.z = Math.PI;
    const canopy = mesh(new THREE.ConeGeometry(0.2, 0.09, 8, 1, true), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, clearcoat: 0.4, side: THREE.DoubleSide }), 0.12, 0.6, 0);
    const closed = mesh(new THREE.ConeGeometry(0.025, 0.2, 8), canopy.material, 0.12, 0.42, 0);
    closed.visible = false;
    g.add(shaft, handle, canopy, closed);
    r.indoorHooks.push((inside) => {
      canopy.visible = !inside;
      closed.visible = inside;
      shaft.scale.y = inside ? 0.6 : 1;
      shaft.position.y = inside ? 0.25 : 0.34;
    });
  } },
  flowers: { label: '花束', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0.09, 0.15, 0.08);
    grp.rotation.x = 0.3;
    const wrap = mesh(new THREE.ConeGeometry(0.035, 0.08, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xf6efe0, side: THREE.DoubleSide }), 0, 0, 0);
    wrap.rotation.x = Math.PI;
    grp.add(wrap);
    const colors = [0xe85d4a, 0xf4d35e, 0xe8789a, 0xffffff, 0x9b7fd1];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      grp.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), glossy(colors[i]), Math.cos(a) * 0.022, 0.05, Math.sin(a) * 0.022));
    }
    grp.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), glossy(0xf2a541), 0, 0.06, 0));
    g.add(grp);
  } },
  briefcase: { label: '公事包', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0.14, 0.06, 0);
    grp.add(rbox(0.03, 0.075, 0.11, 0.01, matte(0x7a4a2c, 0.5), 0, 0, 0));
    grp.add(mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12, Math.PI), matte(0x3a2a20), 0, 0.04, 0));
    grp.children[1].rotation.y = Math.PI / 2;
    grp.add(rbox(0.032, 0.012, 0.016, 0.003, new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.6, roughness: 0.3 }), 0, 0.02, 0));
    g.add(grp);
  } },
  shopping: { label: '購物袋與法國麵包', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0.14, 0.07, 0.01);
    grp.add(rbox(0.05, 0.1, 0.09, 0.008, matte(0xd8b98a, 0.9), 0, 0, 0));
    const bread = mesh(new THREE.CapsuleGeometry(0.014, 0.1, 4, 8), matte(0xc98a3e, 0.7), 0, 0.08, 0.015);
    bread.rotation.x = 0.25;
    grp.add(bread);
    grp.add(mesh(new THREE.SphereGeometry(0.02, 10, 8), glossy(0xd94a3a), 0, 0.055, -0.02));
    g.add(grp);
  } },
  guitar: { label: '吉他', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0, 0.16, -0.09);
    grp.rotation.z = 0.5;
    const wood = matte(0xc98a3e, 0.5);
    const a = mesh(new THREE.SphereGeometry(0.05, 16, 12), wood, 0, -0.03, 0);
    const b = mesh(new THREE.SphereGeometry(0.04, 16, 12), wood, 0, 0.035, 0);
    a.scale.z = 0.35;
    b.scale.z = 0.35;
    const hole = mesh(new THREE.CircleGeometry(0.014, 12), matte(0x2f2018), 0, -0.01, -0.019);
    hole.rotation.y = Math.PI;
    const neck = rbox(0.018, 0.14, 0.012, 0.004, matte(0x5c3a20), 0, 0.12, 0);
    grp.add(a, b, hole, neck);
    g.add(grp);
  } },
  teddy: { label: '泰迪熊', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0, 0.13, 0.09);
    const fur = matte(0xb07a4a, 0.95);
    grp.add(mesh(new THREE.SphereGeometry(0.035, 12, 10), fur, 0, 0, 0));
    grp.add(mesh(new THREE.SphereGeometry(0.028, 12, 10), fur, 0, 0.05, 0.005));
    for (const s of [-1, 1]) grp.add(mesh(new THREE.SphereGeometry(0.011, 8, 6), fur, s * 0.02, 0.075, 0));
    grp.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), matte(0x2f2018), 0, 0.048, 0.03));
    g.add(grp);
  } },
  book: { label: '書', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0.1, 0.13, 0.07);
    grp.rotation.set(-0.5, 0.3, 0);
    grp.add(rbox(0.06, 0.08, 0.014, 0.003, matte(pick([0x3a86d4, 0xd94a3a, 0x2e7d5b])), 0, 0, 0));
    grp.add(rbox(0.054, 0.074, 0.016, 0.002, matte(0xfbf7ef), 0.003, 0, 0));
    g.add(grp);
  } },
  camera: { label: '相機', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0, 0.15, 0.07);
    grp.add(rbox(0.06, 0.035, 0.022, 0.006, matte(0x2f3440, 0.4), 0, 0, 0));
    const lens = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 14), matte(0x111111, 0.2), 0, 0, 0.016);
    lens.rotation.x = Math.PI / 2;
    grp.add(lens, mesh(new THREE.TorusGeometry(0.05, 0.003, 4, 20, Math.PI), matte(0x2f3440), 0, 0.045, -0.05));
    grp.children[2].rotation.x = -0.6;
    g.add(grp);
  } },
  plant: { label: '小盆栽', make(g) {
    const grp = new THREE.Group();
    grp.position.set(0, 0.12, 0.09);
    grp.add(mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.04, 12), matte(0xc96a4a, 0.8), 0, 0, 0));
    for (let i = 0; i < 4; i++) {
      const leaf = mesh(new THREE.SphereGeometry(0.02, 8, 6), glossy(0x5fae5a), Math.cos(i * 1.6) * 0.015, 0.035 + i * 0.008, Math.sin(i * 1.6) * 0.015);
      leaf.scale.set(1, 1.6, 0.5);
      leaf.rotation.z = Math.cos(i * 1.6) * 0.6;
      grp.add(leaf);
    }
    g.add(grp);
  } },
};

const NAMES = ['小波', '阿哲', '咪咪', '豆豆', '小蘋', '阿凱', '露露', '奇奇', '小米', '阿光', '多多', '妮妮', '阿福', '樂樂', '小葵', '球球', '阿星', '可可', '小鈴', '阿寶', '果果', '小宇', '糖糖', '阿布'];

export function randomLook(i) {
  const hatKeys = Object.keys(HATS);
  const neckKeys = Object.keys(NECKS);
  const bodyKeys = Object.keys(BODIES);
  const itemKeys = Object.keys(ITEMS);
  return {
    name: NAMES[i % NAMES.length],
    shirt: pick(SHIRTS),
    accent: pick(ACCENTS),
    body: pick(bodyKeys),
    hat: Math.random() < 0.65 ? pick(hatKeys) : null,
    neck: Math.random() < 0.55 ? pick(neckKeys) : null,
    glasses: Math.random() < 0.35 ? pick(['round', 'sun']) : null,
    item: itemKeys[i % itemKeys.length],
  };
}

function buildRobot(look, r) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); // hops and sways
  g.add(inner);
  const legs = [];
  inner.add(mesh(G.body, glossy(look.shirt), 0, 0.13, 0));
  inner.add(mesh(G.head, RM.white, 0, 0.27, 0));
  inner.add(mesh(G.visor, RM.visor, 0, 0.275, 0.07));
  for (const side of [-1, 1]) {
    const eye = mesh(G.eye, RM.eye, side * 0.035, 0.278, 0.082);
    eye.scale.set(1, 1.3, 0.5);
    const leg = mesh(G.leg, RM.dark, side * 0.045, 0.045, 0);
    const arm = mesh(G.arm, glossy(look.shirt), side * 0.1, 0.14, 0);
    arm.scale.set(0.8, 1.2, 0.8);
    inner.add(eye, leg, arm);
    legs.push(leg);
  }
  inner.add(mesh(G.stalk, RM.dark, 0, 0.37, 0));
  const ball = mesh(G.ball, RM.idle, 0, 0.41, 0);
  inner.add(ball);

  BODIES[look.body](inner, look.accent);
  if (look.hat) HATS[look.hat](inner, look.accent === 0xffffff ? look.shirt : look.accent);
  if (look.neck) NECKS[look.neck](inner, look.accent === look.shirt ? 0xffffff : look.accent);
  if (look.glasses) glasses(inner, look.glasses);
  if (look.item) ITEMS[look.item].make(inner, r);
  if (look.driver) conductorCap(inner);

  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = false; // they ride under car roofs
    }
  });
  g.userData = { inner, legs, ball };
  return g;
}

export class Robot {
  constructor(look) {
    this.look = look;
    this.name = look.name;
    this.itemLabel = look.item ? ITEMS[look.item].label : '';
    this.indoorHooks = [];
    this.bobbers = [];
    this.mesh = buildRobot(look, this);
    this.path = [];
    this.onArrive = null;
    this.phase = Math.random() * 10;
    this.speed = 0.9 + Math.random() * 0.25;
    this.scale = 1;
    this.idle = 0;
  }

  // The antenna tip lights up in the colour of the station it's heading to.
  setDestination(station) {
    this.dest = station;
    this.mesh.userData.ball.material = station ? glow(station.color) : RM.idle;
  }

  setIndoor(inside) {
    for (const fn of this.indoorHooks) fn(inside);
  }

  walkTo(points, onArrive) {
    this.path = points.map((p) => p.clone());
    this.onArrive = onArrive;
    this.idle = 0;
  }

  wait(seconds, then) {
    this.path = [];
    this.idle = seconds;
    this.afterIdle = then;
  }

  sit(seat) {
    this.seated = true;
    this.path = [];
    this.mesh.position.copy(seat.pos);
    this.mesh.rotation.y = 0;
    // Items are carried on the right; mirror window-side riders so luggage
    // sits toward the aisle instead of poking through the car wall.
    this.mesh.userData.inner.scale.x = seat.pos.x > 0 ? -1 : 1;
    for (const leg of this.mesh.userData.legs) {
      leg.rotation.x = Math.PI / 2;
      leg.position.set(leg.position.x, 0.072, 0.055);
    }
  }

  stand() {
    this.seated = false;
    this.mesh.userData.inner.scale.x = 1;
    for (const leg of this.mesh.userData.legs) {
      leg.rotation.x = 0;
      leg.position.set(leg.position.x, 0.045, 0);
    }
  }

  update(dt, time) {
    const inner = this.mesh.userData.inner;
    for (const b of this.bobbers) b.rotation.z = Math.sin(time * 1.7 + this.phase) * 0.06;
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
      inner.position.y = 0;
      inner.rotation.z = Math.sin(time * 3 + this.phase) * 0.03;
    } else {
      inner.position.y = Math.max(0, Math.sin(time * 2.5 + this.phase)) * 0.012;
      inner.rotation.z = Math.sin(time * 1.3 + this.phase) * 0.04;
      if (this.idle > 0) {
        // Looking around while strolling.
        this.mesh.rotation.y += Math.sin(time * 0.9 + this.phase) * dt * 0.8;
        this.idle -= dt;
        if (this.idle <= 0 && this.afterIdle) {
          const cb = this.afterIdle;
          this.afterIdle = null;
          cb(this);
        }
      }
    }
    this.mesh.scale.setScalar(this.scale);
  }
}

// The train driver: navy uniform, conductor's cap and a gold tie.
export function makeDriver() {
  const r = new Robot({ name: '列車長', shirt: 0x24406e, accent: 0xf2c14e, body: 'belt', hat: null, neck: 'tie', glasses: null, item: null, driver: true });
  r.mesh.userData.ball.material = glow(0xf2c14e);
  return r;
}
