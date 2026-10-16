import * as THREE from 'three';

// Small canvas textures for the homes: wood floors, wallpaper, stucco,
// a woven rug and the soft glow lamps throw on the floor. Made once and
// shared by every house.

const canvas = (w, h, draw) => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// Deterministic noise so every load looks the same.
const rand = (() => {
  let s = 1234567;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

// Honey oak planks with staggered joints and a little grain.
export const woodFloor = () =>
  canvas(256, 256, (g, w, h) => {
    const rows = 8;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 120;
      while (x < w) {
        const len = 90 + rand() * 80;
        const l = 52 + rand() * 10;
        g.fillStyle = `hsl(${30 + rand() * 6}, ${48 + rand() * 10}%, ${l}%)`;
        g.fillRect(x, r * rh, len, rh);
        g.strokeStyle = 'rgba(90,55,25,0.18)';
        g.lineWidth = 1;
        for (let k = 0; k < 4; k++) {
          const y = r * rh + 4 + rand() * (rh - 8);
          g.beginPath();
          g.moveTo(x + 4, y);
          g.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 4, x + len * 0.7, y + (rand() - 0.5) * 4, x + len - 4, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(70,40,20,0.45)';
        g.fillRect(x, r * rh, 1.5, rh);
        x += len;
      }
      g.fillStyle = 'rgba(70,40,20,0.4)';
      g.fillRect(0, r * rh, w, 1.5);
    }
    // Soft varnish sheen.
    const v = g.createLinearGradient(0, 0, w, h);
    v.addColorStop(0, 'rgba(255,240,210,0.10)');
    v.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  });

// Cream wallpaper with fine vertical stripes and tiny flowers.
export const wallpaper = () =>
  canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#f7ecd8';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(214,170,120,0.22)';
      g.fillRect(x, 0, 3, h);
    }
    for (let y = 8; y < h; y += 32) {
      for (let x = 8; x < w; x += 32) {
        const ox = (y / 32) % 2 ? 16 : 0;
        g.fillStyle = 'rgba(222,120,110,0.45)';
        for (let p = 0; p < 4; p++) {
          g.beginPath();
          g.arc(x + ox + Math.cos(p * 1.57) * 2.2, y + Math.sin(p * 1.57) * 2.2, 1.8, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(240,200,90,0.8)';
        g.beginPath();
        g.arc(x + ox, y, 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  });

// Fine stucco grain, white so the paint colour shows through.
export const stucco = () =>
  canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const a = rand() * 0.07;
      g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 2})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
  });

// An oval woven rug: border bands and a diamond centre.
export const rug = (main, band) =>
  canvas(128, 128, (g, w, h) => {
    g.fillStyle = band;
    g.fillRect(0, 0, w, h);
    g.fillStyle = main;
    g.fillRect(10, 10, w - 20, h - 20);
    g.strokeStyle = band;
    g.lineWidth = 3;
    g.strokeRect(18, 18, w - 36, h - 36);
    g.fillStyle = band;
    g.beginPath();
    g.moveTo(w / 2, 32);
    g.lineTo(w - 32, h / 2);
    g.lineTo(w / 2, h - 32);
    g.lineTo(32, h / 2);
    g.closePath();
    g.fill();
    g.fillStyle = main;
    g.beginPath();
    g.arc(w / 2, h / 2, 9, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.06})`;
      g.fillRect(rand() * w, rand() * h, 2, 1);
    }
  });

// Warm radial pool of light, drawn additively on floors and tables.
export const glow = () =>
  canvas(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,196,120,0.9)');
    r.addColorStop(0.4, 'rgba(255,170,90,0.35)');
    r.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });

// A tiny painting for picture frames: hills under a sky.
export const painting = (sky, hill) =>
  canvas(64, 48, (g, w, h) => {
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, sky);
    s.addColorStop(1, '#fff3d6');
    g.fillStyle = s;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd86b';
    g.beginPath();
    g.arc(w * 0.72, h * 0.32, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hill;
    g.beginPath();
    g.moveTo(0, h);
    g.quadraticCurveTo(w * 0.3, h * 0.35, w * 0.6, h * 0.75);
    g.quadraticCurveTo(w * 0.8, h * 0.55, w, h * 0.7);
    g.lineTo(w, h);
    g.fill();
  });
