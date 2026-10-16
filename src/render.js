import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Lighting and image quality: sky, sun, ambient light, time of day, warm
// local lights, and the post-processing that gives the "ray traced" look
// (ambient occlusion in creases and under objects, glow around lamps and
// lit windows, multisampled edges).
//
// Quality levels, picked automatically from frame time (or ?quality=):
//   high   - MSAA + ambient occlusion + bloom
//   medium - MSAA + bloom
//   low    - plain render, smaller shadow map
export const QUALITY = ['low', 'medium', 'high'];

// Times of day. Values blend smoothly between neighbours by hour.
const TIMES = [
  { h: 0, sky: 0x1b2440, ground: 0x1a2230, sun: 0x9fb4ff, sunI: 0.35, hemiI: 0.35, env: 0.12, exposure: 1.0, bloom: 0.55, elev: 0.9 },
  { h: 5.5, sky: 0x2f3a5c, ground: 0x2a3040, sun: 0xb0b8ff, sunI: 0.4, hemiI: 0.4, env: 0.14, exposure: 1.0, bloom: 0.5, elev: 0.15 },
  { h: 7, sky: 0xf6c9a8, ground: 0x7a8a5e, sun: 0xffc48a, sunI: 1.6, hemiI: 0.7, env: 0.25, exposure: 1.05, bloom: 0.3, elev: 0.25 },
  { h: 10, sky: 0xbfe3f2, ground: 0x6a8f4e, sun: 0xfff1dc, sunI: 2.6, hemiI: 0.95, env: 0.35, exposure: 1.05, bloom: 0.18, elev: 1.0 },
  { h: 16, sky: 0xbfe3f2, ground: 0x6a8f4e, sun: 0xfff1dc, sunI: 2.6, hemiI: 0.95, env: 0.35, exposure: 1.05, bloom: 0.18, elev: 1.0 },
  { h: 18.3, sky: 0xf4a97a, ground: 0x6a6a4e, sun: 0xff9a5c, sunI: 1.5, hemiI: 0.6, env: 0.22, exposure: 1.05, bloom: 0.35, elev: 0.2 },
  { h: 19.5, sky: 0x46406a, ground: 0x2a2c3a, sun: 0xc0a0ff, sunI: 0.45, hemiI: 0.4, env: 0.14, exposure: 1.0, bloom: 0.5, elev: 0.1 },
  { h: 24, sky: 0x1b2440, ground: 0x1a2230, sun: 0x9fb4ff, sunI: 0.35, hemiI: 0.35, env: 0.12, exposure: 1.0, bloom: 0.55, elev: 0.9 },
];

const _a = new THREE.Color();
const _b = new THREE.Color();
const _v = new THREE.Vector3();

function sample(hour) {
  hour = THREE.MathUtils.euclideanModulo(hour, 24);
  let i = 0;
  while (TIMES[i + 1].h < hour) i++;
  const a = TIMES[i];
  const b = TIMES[i + 1];
  const t = THREE.MathUtils.smoothstep(hour, a.h, b.h);
  const mix = (k) => a[k] + (b[k] - a[k]) * t;
  const col = (k) => _a.setHex(a[k]).lerp(_b.setHex(b[k]), t).getHex();
  return {
    sky: col('sky'), ground: col('ground'), sun: col('sun'),
    sunI: mix('sunI'), hemiI: mix('hemiI'), env: mix('env'), exposure: mix('exposure'), bloom: mix('bloom'), elev: mix('elev'),
    // How dark it is: 0 at noon, 1 at night. Lamps and windows use it.
    night: THREE.MathUtils.clamp(1 - (mix('sunI') - 0.35) / (2.6 - 0.35), 0, 1),
  };
}

// Many lamps, few real lights: every lamp registered with addLamp() glows
// (emissive bulb, picked up by bloom), and the nearest MAX_LIGHTS of them to
// the camera also get a real PointLight. Keeping the light count fixed
// avoids shader recompiles and keeps per-pixel cost flat however many lamps
// the town has.
const MAX_LIGHTS = 8;

export class Look {
  constructor({ renderer, scene, camera, quality }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.listeners = [];
    this.lamps = [];
    this.hour = 11;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0xbfe3f2, 50, 130);
    // Soft studio reflections give painted metal and glass a polished look.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x6a8f4e, 0.95);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -28;
    sc.right = sc.top = 28;
    sc.near = 1;
    sc.far = 70;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    this.pool = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 4, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }

    this.#buildComposer();
    this.auto = !quality;
    this.setQuality(quality ?? 'high');
    this.setTime(this.hour);
  }

  #buildComposer() {
    const { renderer, scene, camera } = this;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = (this.composer = new EffectComposer(renderer, target));
    composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.4, samples: 12 });
    this.ao.updatePdMaterial({ radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 1;
    // Labels, glass, smoke and other see-through things must not occlude.
    const cache = this.ao._visibilityCache;
    this.ao.overrideVisibility = () => {
      scene.traverse((o) => {
        cache.set(o, o.visible);
        if (o.isPoints || o.isLine || o.isSprite || o.material?.transparent) o.visible = false;
      });
    };
    if (new URLSearchParams(location.search).get('ao') === 'only') this.ao.output = GTAOPass.OUTPUT.Denoise;
    composer.addPass(this.ao);
    // High threshold: only genuinely bright things (lamps, glowing eyes,
    // lit windows) bloom; sunlit walls stay crisp.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.55, 1.05);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
  }

  setQuality(q) {
    this.quality = q;
    const i = QUALITY.indexOf(q);
    this.ao.enabled = i >= 2;
    const map = i === 0 ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== map) {
      this.sun.shadow.mapSize.set(map, map);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, i === 0 ? 1 : 2));
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setPixelRatio(1);
    this.composer.setSize(s.x, s.y);
  }

  // hour: 0-24. Sun swings across the sky; sky, fog, ambient and lamps follow.
  setTime(hour) {
    this.hour = THREE.MathUtils.euclideanModulo(hour, 24);
    const t = (this.time = sample(this.hour));
    const { scene, sun, hemi } = this;
    scene.background.setHex(t.sky);
    scene.fog.color.setHex(t.sky);
    hemi.color.setHex(t.sky).lerp(_a.setHex(0xffffff), 0.5);
    hemi.groundColor.setHex(t.ground);
    hemi.intensity = t.hemiI;
    sun.color.setHex(t.sun);
    sun.intensity = t.sunI;
    // Day: sun arcs east to west. Night: a high moon keeps soft shadows.
    const day = this.hour > 6 && this.hour < 19;
    const az = day ? ((this.hour - 6) / 13) * Math.PI : 0.6;
    const elev = THREE.MathUtils.clamp(t.elev, 0.12, 1) * (Math.PI / 2.4);
    sun.position.set(Math.cos(az) * Math.cos(elev) * 30, Math.sin(elev) * 30 + 2, 12);
    scene.environmentIntensity = t.env;
    this.renderer.toneMappingExposure = t.exposure;
    this.bloom.strength = t.bloom;
    for (const fn of this.listeners) fn(t.night, t);
  }

  // Called with (night 0..1, sample) whenever the time changes, so models
  // can light windows and street lamps.
  onTime(fn) {
    this.listeners.push(fn);
    fn(this.time.night, this.time);
  }

  // A warm light at `object` (its world position), lit at night. bulb: an
  // optional mesh whose emissive glows with it.
  addLamp(object, { color = 0xffc98a, intensity = 2.5, distance = 4, bulb = null, always = false } = {}) {
    const lamp = { object, color: new THREE.Color(color), intensity, distance, bulb, always };
    this.lamps.push(lamp);
    return () => this.lamps.splice(this.lamps.indexOf(lamp), 1);
  }

  #updateLamps() {
    const night = this.time.night;
    const cam = this.camera.position;
    const lit = this.lamps.filter((l) => (l.always || night > 0.05) && l.object.parent);
    for (const l of lit) l.d = l.object.getWorldPosition(_v).distanceToSquared(cam);
    lit.sort((a, b) => a.d - b.d);
    for (const l of this.lamps) {
      const k = l.always ? 1 : night;
      if (l.bulb) l.bulb.material.emissiveIntensity = 0.2 + 2.2 * k;
    }
    this.pool.forEach((p, i) => {
      const l = lit[i];
      if (!l) {
        p.intensity = 0;
        return;
      }
      l.object.getWorldPosition(p.position);
      p.color.copy(l.color);
      p.distance = l.distance;
      p.intensity = l.intensity * (l.always ? 1 : night);
    });
  }

  render(dt = 0) {
    this.#updateLamps();
    this.#autoQuality(dt);
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  // Step quality down while frames take too long (under ~40 fps).
  #autoQuality(dt) {
    if (!this.auto || !dt) return;
    this.acc = (this.acc ?? 0) + dt;
    this.frames = (this.frames ?? 0) + 1;
    if (this.acc < 3) return;
    const avg = this.acc / this.frames;
    this.acc = this.frames = 0;
    const i = QUALITY.indexOf(this.quality);
    if (avg > 1 / 40 && i > 0) this.setQuality(QUALITY[i - 1]);
  }
}
