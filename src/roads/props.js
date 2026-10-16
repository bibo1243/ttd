import * as THREE from 'three';
import { FONT, K, bake, glow, matte, mesh, paint, rbox, rod, textTexture } from '../vehicles/kit.js';
import { glassMat } from '../parts.js';

// Roadside furniture: bus stop shelters and level-crossing gates.

export const STOP_NAMES = ['榕樹下', '市場口', '公園前', '小學', '郵局', '老街', '海濱', '圖書館', '診所', '廟口', '花市', '燈塔', '麵包店', '果園', '天文台', '溫泉'];

// Floating name tag with the number of riders waiting.
export class StopLabel {
  constructor(name) {
    this.name = name;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 384;
    this.canvas.height = 112;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
    this.sprite.scale.set(1.75, 0.51, 1);
    this.sprite.renderOrder = 10;
    this.shown = -1;
    this.draw(0);
  }

  draw(waiting) {
    if (waiting === this.shown) return;
    this.shown = waiting;
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 384, 112);
    g.shadowColor = 'rgba(30,60,80,0.25)';
    g.shadowBlur = 12;
    g.shadowOffsetY = 3;
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath();
    g.roundRect(10, 10, 364, 76, 38);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#2f6fd0';
    g.beginPath();
    g.arc(52, 48, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `800 22px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('公車', 52, 49);
    g.textAlign = 'left';
    g.fillStyle = '#3b3f4a';
    g.font = `700 34px ${FONT}`;
    g.fillText(this.name, 86, 50);
    g.fillStyle = '#8a8f9c';
    g.font = `500 26px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(`等候 ${waiting}`, 354, 50);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath();
    g.moveTo(178, 84);
    g.lineTo(206, 84);
    g.lineTo(192, 104);
    g.fill();
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

const signTex = typeof document !== 'undefined'
  ? textTexture(128, 128, (g, w) => {
    g.fillStyle = '#2f6fd0';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    // A little bus pictogram.
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(32, 34, 64, 50, 10);
    g.fill();
    g.fillStyle = '#2f6fd0';
    g.fillRect(38, 42, 52, 18);
    g.fillStyle = '#ffffff';
    g.fillRect(62, 42, 3, 18);
    g.beginPath();
    g.arc(46, 88, 7, 0, Math.PI * 2);
    g.arc(82, 88, 7, 0, Math.PI * 2);
    g.fill();
    g.font = `800 18px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('BUS', 64, 108);
    void w;
  })
  : null;

const posterTex = typeof document !== 'undefined'
  ? textTexture(128, 192, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ffd27a');
    grd.addColorStop(1, '#f2785c');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff6e0';
    g.beginPath();
    g.arc(64, 74, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8574a';
    g.beginPath();
    g.arc(64, 74, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `800 26px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('迷你島', 64, 142);
    g.font = `600 16px ${FONT}`;
    g.fillText('搭公車去玩！', 64, 168);
  })
  : null;

// Shelter facing local +z (the road); local +x runs along the road.
export function makeShelter() {
  const g = new THREE.Group();
  const frame = paint(0x4a5562, { metal: 0.6, rough: 0.35 });
  // Paved pad behind the sidewalk.
  g.add(rbox(1.5, 0.05, 0.62, 0.02, matte(0xcfc8ba, 0.85), 0, 0.025, -0.24));
  // Posts, roof and glass back wall.
  for (const x of [-0.6, 0.6]) {
    g.add(rbox(0.04, 0.78, 0.04, 0.01, frame, x, 0.44, -0.46));
    g.add(rbox(0.04, 0.78, 0.04, 0.01, frame, x, 0.44, -0.12));
  }
  const roof = rbox(1.38, 0.05, 0.54, 0.02, paint(0x2f6fd0, { metal: 0.2 }), 0, 0.85, -0.27);
  roof.rotation.x = -0.06;
  g.add(roof, rbox(1.3, 0.012, 0.46, 0.005, K.cabinLight, 0, 0.82, -0.27));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.62), glassMat);
  back.position.set(0, 0.45, -0.46);
  back.renderOrder = 2;
  g.add(back, rbox(1.2, 0.03, 0.02, 0.008, frame, 0, 0.14, -0.46), rbox(1.2, 0.03, 0.02, 0.008, frame, 0, 0.77, -0.46));
  // Lit poster at one end.
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.45), new THREE.MeshStandardMaterial({ map: posterTex, emissive: 0xffffff, emissiveMap: posterTex, emissiveIntensity: 0.55 }));
  poster.position.set(0.6, 0.47, -0.29);
  poster.rotation.y = -Math.PI / 2;
  g.add(poster, rbox(0.03, 0.5, 0.36, 0.01, frame, 0.6, 0.47, -0.29));
  // Wooden bench.
  const wood = matte(0xc08a52, 0.6);
  for (let i = 0; i < 3; i++) g.add(rbox(0.9, 0.018, 0.045, 0.006, wood, -0.12, 0.22, -0.38 + i * 0.05));
  for (const x of [-0.5, 0.26]) g.add(rbox(0.03, 0.2, 0.12, 0.008, frame, x, 0.11, -0.33));
  // Sign pole at the kerb.
  g.add(rod(new THREE.Vector3(0.62, 0.05, 0.12), new THREE.Vector3(0.62, 1.05, 0.12), 0.018, frame));
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 32), [
    matte(0x2f6fd0, 0.4),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35 }),
  ]);
  sign.rotation.x = Math.PI / 2;
  sign.position.set(0.62, 1.12, 0.12);
  sign.castShadow = true;
  g.add(sign);
  g.add(rbox(0.16, 0.22, 0.02, 0.01, matte(0xf6f4ee, 0.5), 0.62, 0.72, 0.135));
  for (let i = 0; i < 4; i++) g.add(rbox(0.12, 0.012, 0.004, 0.002, K.trim, 0.62, 0.79 - i * 0.04, 0.147));
  bake(g);
  return g;
}

// A level crossing gate: post with crossbuck, twin red lamps and a boom
// that swings down across the lane. Faces local +z (the approaching lane).
export function makeGate() {
  const g = new THREE.Group();
  const white = paint(0xf6f4ee, { metal: 0.1 });
  const black = matte(0x2b2e35, 0.5);
  g.add(rbox(0.16, 0.06, 0.16, 0.02, matte(0x9aa1aa, 0.7), 0, 0.03, 0));
  // Striped post.
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 12), i % 2 ? black : white, 0, 0.14 + i * 0.16, 0));
  // Crossbuck.
  for (const a of [0.6, -0.6]) {
    const b = rbox(0.5, 0.07, 0.015, 0.01, white, 0, 1.02, 0.03);
    b.rotation.z = a;
    g.add(b);
  }
  // Lamp bar and hoods.
  g.add(rbox(0.36, 0.035, 0.03, 0.01, black, 0, 0.78, 0.03));
  const lamps = [];
  for (const x of [-0.13, 0.13]) {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20).rotateX(Math.PI / 2), black, x, 0.78, 0.05));
    const hood = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), black, x, 0.79, 0.09);
    g.add(hood);
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), new THREE.MeshStandardMaterial({ color: 0x5a1e1a, emissive: 0xff2a1a, emissiveIntensity: 0 }));
    lamp.position.set(x, 0.78, 0.077);
    g.add(lamp);
    lamps.push(lamp);
  }
  // Boom, pivoting at the post; extends along local -x when down.
  const boom = new THREE.Group();
  boom.position.set(-0.06, 0.46, 0.06);
  const len = 1.25;
  for (let i = 0; i < 6; i++) {
    const seg = rbox(len / 6, 0.035, 0.025, 0.01, i % 2 ? paint(0xd9483b) : white, -(i + 0.5) * (len / 6), 0, 0);
    boom.add(seg);
  }
  boom.add(rbox(0.08, 0.08, 0.06, 0.015, black, 0.04, 0, 0));
  g.add(boom);
  return { group: g, lamps, boom };
}
