import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, instanceIndex, hash, time, cameraPosition, fract, uv, length, smoothstep, mix, max,
  pow, dot, normalize, sin, positionLocal, positionWorld, texture, color, clamp,
  normalWorld, abs, viewportLinearDepth, linearDepth, cameraNear, cameraFar, instancedDynamicBufferAttribute, exp,
  cameraViewMatrix, atan, renderGroup, step, instancedBufferAttribute, uniformArray, varying, select, floor,
} from 'three/tsl';
import type { Atmosphere } from './Atmosphere';
import type { Heightfield } from './Heightfield';
import { noise } from '@/engine/noiseTex';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VirtualLight } from './lights';
import { setGroundHeight } from './materials';
import { canvasTexture } from './kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const _heightTex = new WeakMap<Heightfield, THREE.DataTexture>();

/** Half-float height texture so GPU effects can hug the terrain (one per heightfield; also feeds the
 *  materials' contact layer). */
export function heightTexture(hf: Heightfield) {
  const cached = _heightTex.get(hf);
  if (cached) return cached;
  const S = 256;
  const data = new Uint16Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = ((x + 0.5) / S - 0.5) * hf.size;
      const wz = ((y + 0.5) / S - 0.5) * hf.size;
      data[y * S + x] = THREE.DataUtils.toHalfFloat(hf.heightAt(wx, wz));
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  _heightTex.set(hf, tex);
  setGroundHeight(tex, hf.size);
  return tex;
}

/**
 * Sun-lit floating dust motes. Positions are generated entirely on the GPU from instanceIndex and
 * wrap around the camera, so there is zero CPU cost per particle.
 */
export class DustMotes {
  sprite: THREE.Sprite;
  readonly uWindOffset = uniform(new THREE.Vector3());
  private offset = new THREE.Vector3();

  constructor(private atmo: Atmosphere, count: number, boxSize = 36) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const B = float(boxSize);
    const seed = vec3(hash(instanceIndex), hash(instanceIndex.add(7919)), hash(instanceIndex.add(15485)));
    const wobble = vec3(
      sin(time.mul(0.7).add(seed.y.mul(30))).mul(0.6),
      sin(time.mul(0.5).add(seed.z.mul(30))).mul(0.4),
      sin(time.mul(0.6).add(seed.x.mul(30))).mul(0.6),
    );
    const local = fract(seed.add(this.uWindOffset.div(B)).add(wobble.div(B))).sub(0.5).mul(B);
    const pos = cameraPosition.add(local);
    mat.positionNode = pos;
    const size = hash(instanceIndex.add(3)).mul(0.035).add(0.012);
    mat.scaleNode = vec2(size, size);

    const sunDir = atmo.uSunDir;
    mat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const soft = smoothstep(1, 0.0, d);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, sunDir), 0);
      const phase = pow(mu, 8).mul(6).add(0.25);
      const fade = smoothstep(B.mul(0.5), B.mul(0.2), length(local)).mul(smoothstep(0.3, 1.5, length(local)));
      const night = float(1).sub(atmo.uNight.mul(0.8));
      const c = atmo.uSunColor.mul(phase).add(atmo.uHaze.mul(0.4)).mul(night);
      return vec4(c.mul(soft).mul(fade).mul(atmo.uStorm.mul(1.6).add(0.35)), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 10;
  }

  update(dt: number) {
    const w = this.atmo.wind;
    this.offset.x += w.x * dt * 2.2;
    this.offset.z += w.y * dt * 2.2;
    this.offset.y += Math.sin(performance.now() * 0.0002) * dt * 0.2;
    (this.uWindOffset.value as THREE.Vector3).copy(this.offset);
  }
}

/** Big soft sand clouds that drift low over the ground with the wind. Soft-particle depth fade. */
export class GroundHaze {
  sprite: THREE.Sprite;
  readonly uOffset = uniform(new THREE.Vector2());
  private offset = new THREE.Vector2();

  constructor(private atmo: Atmosphere, hf: Heightfield, heightTex: THREE.Texture, count = 160) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const R = float(150);
    const seed = vec3(hash(instanceIndex.add(11)), hash(instanceIndex.add(101)), hash(instanceIndex.add(1009)));
    const lxz = fract(seed.xy.add(this.uOffset.div(R.mul(2)))).sub(0.5).mul(R.mul(2));
    const wxz = cameraPosition.xz.add(lxz);
    const hUv = wxz.div(hf.size).add(0.5);
    const ground = texture(heightTex, hUv).r;
    const size = seed.z.mul(10).add(6).mul(atmo.uStorm.mul(0.8).add(1));
    const pos = vec3(wxz.x, ground.add(size.mul(0.28)), wxz.y);
    mat.positionNode = pos;
    mat.scaleNode = vec2(size.mul(1.6), size.mul(atmo.uStorm.mul(0.5).add(0.7)));
    mat.rotationNode = seed.x.mul(6.28);

    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const n = noise(p.mul(0.35).add(seed.xy.mul(10)).add(time.mul(0.01))).r.sub(0.5).mul(1.6);
      const shape = smoothstep(1.0, 0.2, length(p).add(n.mul(0.5)));
      const dist = length(lxz);
      const fade = smoothstep(R, R.mul(0.6), dist).mul(smoothstep(4, 18, dist));
      // soft particles
      const sceneDepth = viewportLinearDepth;
      const fragDepth = linearDepth();
      const soft = clamp(sceneDepth.sub(fragDepth).mul(cameraFar.sub(cameraNear)).div(3), 0, 1);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      const lit = atmo.uHaze.mul(0.9).add(atmo.uSunColor.mul(pow(mu, 4).mul(0.6)));
      const a = shape.mul(fade).mul(soft).mul(atmo.uDust.mul(0.22).add(0.04).add(atmo.uStorm.mul(0.5)));
      // in a storm each cloud has its own density: some sun-shot and pale, some dark and ruddy, all
      // heavier underneath, so the murk close by has rolling shapes instead of one flat tint
      const tone = seed.x.mul(0.6).add(0.7).mul(mix(float(0.72), float(1.12), uv().y));
      const stormC = (atmo.uStormColor as N).mul(tone).add(atmo.uSunColor.mul(pow(mu, 4).mul(0.25).mul(float(1).sub(atmo.uNight))));
      return vec4(mix(lit, stormC, atmo.uStorm.mul(0.85)), a);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 11;
  }

  update(dt: number) {
    const w = this.atmo.wind;
    this.offset.x += w.x * dt * 5;
    this.offset.y += w.y * dt * 5;
    (this.uOffset.value as THREE.Vector2).copy(this.offset);
  }
}

/** The first instances of SandStreaks are wind-blown debris instead of streaks. */
const DEBRIS = 48;
const TUMBLEWEEDS = 7;
/** …and the next WISPS are broad, faint sheets of dust sweeping past (the streaks' big brothers). */
const WISPS = 90;

/** Tumbleweed (left half) and four scraps of litter (right half): paper, a dry leaf, a plastic shred, a twig. */
function debrisAtlas() {
  return canvasTexture(256, 128, (ctx) => {
    let sd = 7;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    ctx.clearRect(0, 0, 256, 128);
    // tumbleweed: a ball of dry, wiry stems, denser and darker in the middle
    ctx.lineCap = 'round';
    for (let i = 0; i < 300; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 50;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      const b = a + (rnd() - 0.5) * 2.6, len = 14 + rnd() * 26;
      const ex = Math.max(8, Math.min(120, x + Math.cos(b) * len)), ey = Math.max(8, Math.min(120, y + Math.sin(b) * len));
      const t = rnd();
      const k = 0.55 + 0.45 * (r / 50); // the core is shaded by the stems around it
      ctx.strokeStyle = `rgb(${Math.round((70 + t * 70) * k)},${Math.round((56 + t * 52) * k)},${Math.round((38 + t * 34) * k)})`;
      ctx.lineWidth = 1.2 + rnd() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 24, y + (rnd() - 0.5) * 24, ex, ey);
      ctx.stroke();
    }
    // paper scrap
    ctx.fillStyle = '#d9d2bf';
    ctx.beginPath();
    ctx.moveTo(140, 12); ctx.lineTo(182, 8); ctx.lineTo(186, 50); ctx.lineTo(162, 56); ctx.lineTo(136, 46);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,60,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(144, 20 + i * 8); ctx.lineTo(176, 18 + i * 8); ctx.stroke(); }
    // dry leaf
    ctx.fillStyle = '#8a6a3a';
    ctx.beginPath();
    ctx.ellipse(224, 32, 12, 24, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4424';
    ctx.beginPath(); ctx.moveTo(210, 52); ctx.lineTo(238, 12); ctx.stroke();
    // plastic shred
    ctx.fillStyle = 'rgba(120,150,170,0.85)';
    ctx.beginPath();
    ctx.moveTo(134, 74); ctx.lineTo(186, 70); ctx.lineTo(178, 92); ctx.lineTo(188, 116); ctx.lineTo(140, 108); ctx.lineTo(148, 90);
    ctx.fill();
    // twig with a fork
    ctx.strokeStyle = '#6a5034';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(200, 118); ctx.lineTo(248, 72); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(226, 93); ctx.lineTo(236, 112); ctx.stroke();
  });
}

/**
 * Blowing sand: thin streaks racing low over the ground with the wind, the signature of a dust
 * storm (and a hint of it on gusty days). One sprite draw call; every streak is placed on the GPU
 * from instanceIndex, wraps around the camera, hugs the terrain, and is rotated in screen space to
 * line up with the projected wind direction.
 *
 * The first DEBRIS instances ride the same wind as debris: tumbleweeds bounding along the ground
 * (on windy days too) and, in a storm, scraps of paper, leaves, plastic and twigs flung past at
 * head height. Same draw call, same program.
 */
export class SandStreaks {
  sprite: THREE.Sprite;
  readonly uOffset = uniform(new THREE.Vector2());
  readonly uDir = uniform(new THREE.Vector2(1, 0));
  readonly uAmount = uniform(0);
  readonly uDebris = uniform(new THREE.Vector2());
  private offset = new THREE.Vector2();

  constructor(private atmo: Atmosphere, hf: Heightfield, heightTex: THREE.Texture, count = 900) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const B = float(48);
    const fi = float(instanceIndex);
    const isDeb = fi.lessThan(DEBRIS);
    const isTw = fi.lessThan(TUMBLEWEEDS);
    const seed = vec3(hash(instanceIndex.add(17)), hash(instanceIndex.add(4099)), hash(instanceIndex.add(8191)));
    // tumbleweeds roll a little slower than the wind, litter flies with it
    const speedK = select(isTw, hash(instanceIndex.add(23)).mul(0.25).add(0.5), hash(instanceIndex.add(23)).mul(0.7).add(0.65));
    // debris lives in a tighter box than the streaks, so the few pieces there are stay close by
    const box = select(isDeb, select(isTw, float(40), float(26)), B);
    const lxz = fract(seed.xz.add(this.uOffset.mul(speedK).div(box))).sub(0.5).mul(box);
    const wxz = cameraPosition.xz.add(lxz);
    const ground = texture(heightTex, wxz.div(hf.size).add(0.5)).r;
    // most streaks skim the sand; a few loft up to head height
    const lift = pow(seed.y, 2.4).mul(2.6).add(0.04);
    const flutter = sin(time.mul(seed.x.mul(3).add(4)).add(seed.z.mul(40))).mul(0.06).mul(lift);
    // debris: a tumbleweed bounds along on its own radius; litter flutters between knee and roof height
    const twSize = seed.z.mul(0.45).add(0.5);
    const hop = abs(sin(time.mul(seed.x.mul(1.5).add(2.2)).add(seed.y.mul(30)))).mul(pow(seed.z, 2).mul(0.7).add(0.15));
    const litSize = seed.z.mul(0.12).add(0.07);
    const litY = pow(seed.y, 1.6).mul(3.4).add(0.25).add(sin(time.mul(seed.x.mul(2).add(1.5)).add(seed.z.mul(50))).mul(0.45));
    const debY = select(isTw, twSize.mul(0.45).add(hop), litY);
    const isWisp = fi.lessThan(DEBRIS + WISPS).and(isDeb.not());
    const wispY = pow(seed.y, 1.3).mul(2.4).add(0.35);
    const pos = vec3(wxz.x, ground.add(select(isDeb, debY, select(isWisp, wispY, lift.add(flutter)))), wxz.y);
    mat.positionNode = pos;
    // align with the wind as seen on screen; foreshortened when it blows toward/away from the camera
    const wv = cameraViewMatrix.mul(vec4(this.uDir.x, 0, this.uDir.y, 0)).xy;
    const along = clamp(length(wv), 0.12, 1);
    // tumbleweeds roll the way they travel across the screen; litter spins
    const roll = time.mul(speedK.mul(3.2).div(twSize)).mul(select(wv.x.greaterThan(0), float(-1), float(1)));
    const spin = time.mul(seed.x.mul(6).add(2)).mul(select(seed.y.greaterThan(0.5), float(1), float(-1)));
    mat.rotationNode = select(isDeb, select(isTw, roll, spin), atan(wv.y, wv.x));
    const len = hash(instanceIndex.add(5)).mul(2.6).add(0.9);
    const debS = select(isTw, twSize, litSize);
    const thick = select(isWisp, hash(instanceIndex.add(6)).mul(0.9).add(0.35), hash(instanceIndex.add(6)).mul(0.06).add(0.025));
    const long = select(isWisp, len.mul(2.2).add(2), len);
    mat.scaleNode = select(isDeb, vec2(debS, debS), vec2(long.mul(along), thick));

    const atlas = debrisAtlas();
    mat.colorNode = Fn(() => {
      const p = uv();
      // bright leading head, long fading tail, soft edges across
      const head = smoothstep(0.0, 0.85, p.x).mul(smoothstep(1.0, 0.88, p.x));
      const across = pow(smoothstep(0.5, 0.0, abs(p.y.sub(0.5))), 1.5);
      const dist = length(lxz);
      const fade = smoothstep(B.mul(0.5), B.mul(0.25), dist).mul(smoothstep(0.6, 2.5, dist));
      // streaks pulse in and out so the field never looks like a static pattern
      const pulse = smoothstep(0.2, 0.7, sin(time.mul(speedK.mul(2.3)).add(seed.x.mul(60))).mul(0.5).add(0.5));
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      const day = float(1).sub(atmo.uNight);
      const lit = (atmo.uStormColor as N).mul(1.6).add(atmo.uSunColor.mul(pow(mu, 6).mul(0.5).mul(day)));
      // wisps: a soft, ragged ribbon with no bright head, torn by the noise as it flies
      const rag = noise(vec2(p.x.mul(0.6).add(seed.x.mul(7)), p.y.mul(0.35).add(time.mul(0.15)))).r;
      const wisp = smoothstep(0.0, 0.3, p.x).mul(smoothstep(1.0, 0.6, p.x)).mul(smoothstep(0.5, 0.1, abs(p.y.sub(0.5)))).mul(smoothstep(0.3, 0.7, rag));
      const shape = select(isWisp, wisp.mul(0.32), head.mul(across).mul(0.4));
      const streak = vec4(lit, shape.mul(fade).mul(pulse).mul(this.uAmount));
      // debris: one atlas cell each, lit flat by sky and sun, sinking into the murk with distance
      const cell = floor(hash(instanceIndex.add(31)).mul(3.999));
      const cuv = select(isTw, p.mul(vec2(0.5, 1)), vec2(float(0.5).add(cell.mod(2).mul(0.25)).add(p.x.mul(0.25)), floor(cell.div(2)).mul(0.5).add(p.y.mul(0.5))));
      const tex = texture(atlas, cuv);
      const light = atmo.uHaze.mul(0.35).add(atmo.uSunColor.mul(day.mul(0.4).add(0.05))).add((atmo.uStormColor as N).mul(0.35));
      const dFade = smoothstep(box.mul(0.5), box.mul(0.3), dist).mul(smoothstep(0.4, 1.2, dist));
      // the amount thins the crowd (each piece has its own threshold) rather than ghosting it
      const amt = select(isTw, this.uDebris.x, this.uDebris.y);
      const th = hash(instanceIndex.add(77)).mul(0.9);
      const dAmt = smoothstep(th, th.add(0.1), amt);
      const debris = vec4(tex.rgb.mul(light), tex.a.mul(dFade).mul(dAmt));
      return select(isDeb, debris, streak);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 12;
  }

  update(dt: number) {
    const w = this.atmo.wind;
    const amount = Math.min(1, this.atmo.storm * 1.3 + Math.max(0, this.atmo.windStrength - 1.1) * 0.25);
    this.uAmount.value = amount;
    // tumbleweeds go on any properly windy day; litter only flies in a storm
    const tw = Math.min(1, this.atmo.storm * 2 + Math.max(0, this.atmo.windStrength - 1.0) * 1.5);
    const lit = Math.min(1, Math.max(0, this.atmo.storm - 0.12) * 2.2);
    (this.uDebris.value as THREE.Vector2).set(tw, lit);
    this.sprite.visible = amount > 0.01 || tw > 0.01;
    this.offset.x += w.x * dt * 3.2;
    this.offset.y += w.y * dt * 3.2;
    (this.uOffset.value as THREE.Vector2).copy(this.offset);
    (this.uDir.value as THREE.Vector2).set(w.x, w.y).normalize();
  }
}

/**
 * Dust devils: a few slim whirls of sand wandering the flats on hot, calm afternoons. Each devil is a
 * column of soft sprites spiralling up and fanning out; the whole set is one sprite draw call placed
 * entirely on the GPU (instanceIndex -> devil + ring), world-anchored and wrapped around the camera.
 */
export class DustDevils {
  sprite: THREE.Sprite;
  readonly uAmount = uniform(0);
  /** Debug/screenshots: `pin(x, z)` parks devil 0 there (and keeps it alive). */
  readonly uPin = uniform(new THREE.Vector3(0, 0, 0));
  static readonly DEVILS = 4;
  static readonly RINGS = 36;

  constructor(private atmo: Atmosphere, hf: Heightfield, heightTex: THREE.Texture) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const R = float(220);
    const rings = float(DustDevils.RINGS);
    const devil = instanceIndex.div(DustDevils.RINGS).toFloat();
    const k = instanceIndex.mod(DustDevils.RINGS).toFloat();
    const t = k.div(rings); // 0 at the ground, 1 at the top
    const seed = vec3(hash(devil.add(31)), hash(devil.add(57)), hash(devil.add(97)));
    // each devil lives ~45 s, then a new one spawns somewhere else
    const cycle = time.div(seed.z.mul(20).add(35)).add(seed.x);
    const life = fract(cycle);
    const gen = cycle.floor();
    const spawn = vec2(hash(gen.mul(13).add(devil)), hash(gen.mul(29).add(devil.add(5))));
    const drift = vec2(sin(time.mul(0.05).add(seed.y.mul(9))), sin(time.mul(0.04).add(seed.x.mul(7)))).mul(18);
    const lxz = fract(spawn.add(drift.div(R.mul(2))).add(cameraPosition.xz.div(R.mul(2)).negate())).sub(0.5).mul(R.mul(2));
    const pinned = this.uPin.y.mul(step(devil, 0.5));
    const cxz = mix(cameraPosition.xz.add(lxz), this.uPin.xz, pinned);
    const ground = texture(heightTex, cxz.div(hf.size).add(0.5)).r;
    const H = seed.y.mul(14).add(10);
    const ang = time.mul(float(4).sub(t.mul(1.5))).add(k.mul(2.39)).add(seed.x.mul(20));
    const rad = t.mul(t).mul(2.4).add(0.3).add(sin(time.mul(1.3).add(k)).mul(0.15));
    // the column leans and snakes a little with height
    const sway = vec2(sin(time.mul(0.7).add(t.mul(3)).add(seed.z.mul(10))), sin(time.mul(0.6).add(t.mul(2.5)))).mul(t.mul(1.6));
    const pos = vec3(cxz.x.add(sin(ang).mul(rad)).add(sway.x), ground.add(t.mul(H)), cxz.y.add(sin(ang.add(1.5708)).mul(rad)).add(sway.y));
    mat.positionNode = pos;
    const size = t.mul(2.2).add(0.8);
    mat.scaleNode = vec2(size, size);
    mat.rotationNode = ang;
    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const n = noise(p.mul(0.4).add(hash(instanceIndex).mul(9)).add(time.mul(0.03))).r.sub(0.5);
      const shape = smoothstep(1.0, 0.1, length(p).add(n.mul(0.7)));
      const env = mix(sin(life.mul(Math.PI)).mul(smoothstep(0.0, 0.15, life)).mul(smoothstep(1.0, 0.8, life)), float(1), pinned);
      const dist = length(lxz);
      const fade = mix(smoothstep(R, R.mul(0.7), dist).mul(smoothstep(8, 25, dist)), float(1), pinned);
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(2), 0, 1);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      // denser than the haze around it: ochre sand lit by the sun, so it reads against the bright flats
      const lit = vec3(0.66, 0.47, 0.3).mul(atmo.uSunColor.mul(pow(mu, 4).mul(0.4).add(0.38)).add(atmo.uHaze.mul(0.4)));
      const a = shape.mul(env).mul(fade).mul(soft).mul(float(1).sub(t.mul(0.72))).mul(this.uAmount).mul(0.9);
      return vec4(lit, clamp(a, 0, 1));
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = DustDevils.DEVILS * DustDevils.RINGS;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 11;
  }

  pin(x: number, z: number, on = true) {
    (this.uPin.value as THREE.Vector3).set(x, on ? 1 : 0, z);
  }

  update() {
    const a = this.atmo;
    // hot, bright, calm-ish air only: no storm, sun well up, not on gusty days
    const day = Math.min(1, Math.max(0, (a.sunElevation - 0.05) / 0.2));
    const calm = 1 - Math.min(1, a.storm * 3);
    const v = day * calm;
    this.uAmount.value = v;
    this.sprite.visible = v > 0.01;
  }
}

/**
 * Kicked-up dust: landings, sprinting footfalls, things hitting the ground. One sprite draw call;
 * the CPU writes spawn data into a ring buffer and the GPU animates every puff (drag, wind drift,
 * slow rise, growth and fade), lit like the ground haze so it sits in the scene's light.
 */
export class DustPuffs {
  sprite: THREE.Sprite;
  private readonly N = 96;
  private a: THREE.InstancedBufferAttribute; // xyz = spawn position, w = spawn time
  private b: THREE.InstancedBufferAttribute; // xyz = initial velocity, w = size
  private next = 0;
  private now = 0;
  private uTime = uniform(0);
  private uWind = uniform(new THREE.Vector3());

  constructor(private atmo: Atmosphere) {
    const N = this.N;
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(-1e4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.a.setUsage(THREE.DynamicDrawUsage);
    this.b.setUsage(THREE.DynamicDrawUsage);
    const A: N = instancedDynamicBufferAttribute(this.a, 'vec4');
    const B: N = instancedDynamicBufferAttribute(this.b, 'vec4');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const life = float(1.8);
    const age = this.uTime.sub(A.w);
    const alive = age.greaterThan(0).and(age.lessThan(life));
    const k = float(2.6); // air drag on the grains
    const travel = B.xyz.mul(float(1).sub(exp(age.mul(k).negate())).div(k));
    const pos = A.xyz.add(travel).add(this.uWind.mul(age.mul(0.5))).add(vec3(0, age.mul(0.12), 0));
    mat.positionNode = pos;
    // a negative size marks a puff of dark smoke (a burning motor) instead of sand
    const smoke = B.w.lessThan(0);
    const size: N = abs(B.w).mul(age.mul(smoke.select(float(1.6), float(1.1))).add(0.45)).mul(alive.select(float(1), float(0)));
    mat.scaleNode = vec2(size, size.mul(0.8));
    mat.rotationNode = hash(instanceIndex).mul(6.28).add(age.mul(0.3));
    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const n = noise(p.mul(0.5).add(hash(instanceIndex.add(5)).mul(9))).r.sub(0.5);
      const shape = smoothstep(1.0, 0.15, length(p).add(n.mul(0.6)));
      const t = age.div(life);
      const fade = pow(float(1).sub(t), 2).mul(smoothstep(0.0, 0.06, age));
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(0.4), 0, 1);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      const night = float(1).sub(atmo.uNight.mul(0.75));
      const lit = atmo.uHaze.mul(0.75).add(atmo.uSunColor.mul(pow(mu, 3).mul(0.7).add(0.25))).mul(night);
      const sooty = lit.mul(0.1).add(0.012);
      return vec4(select(smoke, sooty, lit) as N, shape.mul(fade).mul(soft).mul(smoke.select(float(0.55), float(0.32))));
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 12;
  }

  /** `n` puffs around `p`: `spread` m/s outward, `up` m/s upward, `size` m, optional push `dir`. */
  emit(p: THREE.Vector3, n: number, spread: number, up: number, size: number, dir?: THREE.Vector3, smoke = false) {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % this.N;
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const sp = spread * (0.6 + Math.random() * 0.6);
      A[j * 4] = p.x + Math.cos(ang) * 0.12;
      A[j * 4 + 1] = p.y + 0.06;
      A[j * 4 + 2] = p.z + Math.sin(ang) * 0.12;
      A[j * 4 + 3] = this.now - Math.random() * 0.05;
      B[j * 4] = Math.cos(ang) * sp + (dir?.x ?? 0);
      B[j * 4 + 1] = up * (0.5 + Math.random() * 0.8);
      B[j * 4 + 2] = Math.sin(ang) * sp + (dir?.z ?? 0);
      B[j * 4 + 3] = size * (0.7 + Math.random() * 0.6) * (smoke ? -1 : 1);
    }
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
    const w = this.atmo.wind;
    (this.uWind.value as THREE.Vector3).set(w.x, 0, w.y);
  }
}

/** Crossed-billboard fire with scrolling noise, embers and a flickering point light. */
export class Fire {
  group = new THREE.Group();
  light: VirtualLight;
  private t = Math.random() * 10;
  /** Stones, logs and embers: only worth drawing up close. The flame cards carry the fire at range. */
  private detail: THREE.Object3D[] = [];
  private flame!: THREE.Object3D;
  private readonly at = new THREE.Vector3();

  constructor(scale = 1, lightIntensity = 30) {
    // additive blending is order-independent, so one pass over both faces looks the same as three's
    // default back-then-front double pass for transparent DoubleSide (one draw instead of two)
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
    mat.colorNode = Fn(() => {
      const p = uv();
      // each crossed card samples its own patch of turbulence (they overlap from most angles)
      const card = positionLocal.x.add(positionLocal.z).mul(0.37);
      const n1 = noise(vec2(p.x.mul(0.7).add(card), p.y.mul(0.5).sub(time.mul(0.85)))).r.sub(0.5);
      const n2 = noise(vec2(p.x.mul(1.7).add(card.mul(2.3)).add(0.3), p.y.mul(1.2).sub(time.mul(1.6)))).g.sub(0.5);
      // the flame licks sideways more the higher it gets
      const x = p.x.sub(0.5).add(n1.mul(0.9).add(n2.mul(0.5)).mul(0.2).mul(p.y.add(0.1)));
      // teardrop: wide and rounded at the base, drawn up to a ragged tip
      const width = pow(clamp(float(1).sub(p.y), 0, 1), 0.7).mul(0.46).mul(smoothstep(-0.05, 0.12, p.y));
      const body = smoothstep(width, width.mul(0.1), abs(x));
      const tongues = smoothstep(0.05, 0.4, n1.mul(1.1).add(n2.mul(0.9)).sub(p.y.mul(0.55)).add(0.55));
      const flame = body.mul(tongues);
      // heat: hottest low in the core, cooling to deep red at the edges and the tips
      const heat = flame.mul(float(1).sub(p.y.mul(0.75))).mul(smoothstep(width, 0.0, abs(x)).mul(0.6).add(0.4));
      const ramp = mix(
        mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.05, 0.35, heat)),
        mix(vec3(1.0, 0.62, 0.18), vec3(1.0, 0.9, 0.65), smoothstep(0.65, 0.95, heat)),
        smoothstep(0.3, 0.65, heat),
      );
      // (additive with src alpha: the colour is scaled by alpha once more on the way out)
      return vec4(ramp.mul(heat.mul(2.6).add(1.0)), flame);
    })();
    // the three crossed flame cards, stones and logs are each one merged mesh (static relative to the fire)
    const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx: number, ry: number) =>
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1)));
    const cards: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.PlaneGeometry(1.1 * scale, 1.6 * scale);
      geo.translate(0, 0.8 * scale, 0);
      cards.push(at(geo, 0, 0, 0, 0, (i / 3) * Math.PI));
    }
    this.flame = new THREE.Mesh(mergeGeometries(cards, false)!, mat);
    this.group.add(this.flame);
    // embers
    const em = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // scale as a uniform: a literal per fire size compiled one ember program per fire
    const uS = uniform(scale);
    const life = fract(time.mul(0.35).add(hash(instanceIndex)));
    const ex = sin(time.mul(1.3).add(hash(instanceIndex.add(5)).mul(20))).mul(0.4).mul(life);
    const ez = sin(time.mul(1.1).add(hash(instanceIndex.add(9)).mul(20))).mul(0.4).mul(life);
    em.positionNode = vec3(ex.add(hash(instanceIndex.add(1)).sub(0.5).mul(0.6)), life.mul(uS.mul(4)), ez);
    em.scaleNode = vec2(uS.mul(0.04), uS.mul(0.04));
    // a soft round spark: without the disc each ember drew as a hard square (big ones near the eye)
    const disc = smoothstep(1, 0.15, length(uv().sub(0.5)).mul(2));
    em.colorNode = vec4(vec3(1.0, 0.45, 0.1).mul(float(8).mul(float(1).sub(life))), smoothstep(1, 0.6, life).mul(disc));
    const embers = new THREE.Sprite(em);
    embers.count = 60;
    this.group.add(embers);
    this.detail.push(embers);

    // stone ring
    const stone = new THREE.MeshStandardNodeMaterial({ color: '#4a4440', roughness: 0.9, flatShading: true });
    const stones: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      stones.push(at(new THREE.DodecahedronGeometry(0.22 * scale, 0), Math.cos(a) * 0.65 * scale, 0.08, Math.sin(a) * 0.65 * scale, a, a * 2));
    }
    const ring = new THREE.Mesh(mergeGeometries(stones, false)!, stone);
    ring.castShadow = true;
    this.group.add(ring);
    this.detail.push(ring);
    const logMat = new THREE.MeshStandardNodeMaterial({ color: '#1a120c', roughness: 1 });
    logMat.emissiveNode = color('#ff4a10').mul(noise(positionWorld.xz.mul(0.8).add(time.mul(0.1))).r.sub(0.5).mul(2).mul(0.5).add(0.5).mul(1.5));
    const logs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      logs.push(at(new THREE.CylinderGeometry(0.07 * scale, 0.08 * scale, 0.9 * scale, 6).toNonIndexed(), 0, 0.15, 0, Math.PI / 2 - 0.3, (i / 4) * Math.PI * 2));
    }
    const logMesh = new THREE.Mesh(mergeGeometries(logs, false)!, logMat);
    this.group.add(logMesh);
    this.detail.push(logMesh);

    // a virtual light: the pool lends it a real one when this fire matters to the view
    this.light = new VirtualLight(0xff8a3a, lightIntensity, 22, 1.6);
    this.light.parent = this.group;
    this.light.position.y = 1.2 * scale;
    this.baseIntensity = lightIntensity;
  }

  private baseIntensity: number;

  /** `cam`: hide the small parts past ~70 m and the whole fire past ~600 m. */
  update(dt: number, cam?: THREE.Vector3) {
    if (cam) {
      const d = this.group.getWorldPosition(this.at).distanceTo(cam);
      const near = d < 70;
      for (const o of this.detail) o.visible = near;
      this.flame.visible = d < 600;
    }
    this.t += dt;
    const f = 0.75 + Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3) * 0.1 + Math.sin(this.t * 23.1) * 0.06;
    this.light.intensity = this.baseIntensity * f;
    this.light.position.x = Math.sin(this.t * 5) * 0.05;
  }
}

/** Storm density 0..1 shared by every light cone (set by Atmosphere): cones are fog-less additive
 *  meshes, so without this their hard edges stayed crisp while the storm swallowed everything else. */
export const coneMurk = uniform(0).setGroup(renderGroup);

/**
 * Additive cone of light for spotlights (drone, floodlights, beacons): a fake volume. Brightness
 * follows the path length through the cone (view angle to the surface), falls off away from the
 * source, carries drifting dust, and fades softly where it meets geometry instead of cutting hard.
 * Every parameter is a uniform, so all cones share one program. `scan` (0..1) sends sonar-like rings
 * down the beam (the drone).
 */
export function lightCone(length: number, radius: number, c: THREE.ColorRepresentation, intensity = 0.6) {
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  const uIntensity = uniform(intensity);
  const uColor = uniform(new THREE.Color(c));
  const uLen = uniform(length);
  const uScan = uniform(0);
  // additive: single pass over both faces = same result as the back-then-front double pass
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  mat.colorNode = Fn(() => {
    const along = positionLocal.y.negate().div(uLen); // 0 at tip, 1 at base
    const toCam = cameraPosition.sub(positionWorld);
    const dist = toCam.length();
    const facing = abs(dot(normalWorld, toCam.div(dist)));
    // path length through the volume ~ facing; light thins out with distance from the lamp
    const thick = pow(facing, 1.6);
    const fall = pow(float(1).sub(along), 1.5).mul(smoothstep(0.0, 0.05, along)).add(smoothstep(0.35, 0.0, along).mul(0.35));
    // two drifting dust layers: slow billows and finer motes catching the light
    // (two skewed 2D projections multiplied, so the motes don't line up into streaks in 3D)
    const wp = positionWorld;
    const billow = noise(wp.xz.add(wp.y).mul(0.12).add(time.mul(0.02))).r;
    const mA = noise(vec2(wp.x.add(wp.y.mul(0.41)), wp.z.sub(wp.y.mul(0.57))).mul(0.8).add(time.mul(vec2(0.05, -0.03)))).g;
    const mB = noise(vec2(wp.x.sub(wp.y.mul(0.63)), wp.z.add(wp.y.mul(0.29))).mul(0.65).add(0.4).sub(time.mul(vec2(0.02, 0.04)))).r;
    const dust = billow.mul(0.9).add(smoothstep(0.3, 0.6, mA.mul(mB)).mul(0.6)).add(0.15);
    const near = smoothstep(0.6, 5.0, dist);
    // soft intersection with whatever the beam lands on (ground, walls, the player)
    const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(1.2), 0, 1);
    // distance (in beam lengths) to the nearest scan ring travelling away from the lamp
    const ringD = float(0.5).sub(abs(fract(along.sub(time.mul(0.45))).sub(0.5)));
    const ring = smoothstep(0.03, 0.0, ringD).mul(uScan).mul(smoothstep(0.05, 0.3, along)).mul(float(1).sub(along));
    const a = thick.mul(fall).mul(dust).mul(near).mul(soft).mul(0.6).add(ring.mul(facing).mul(soft).mul(0.6));
    const murk = exp(dist.mul(coneMurk).mul(-0.07));
    return vec4((uColor as N).mul(a).mul(uIntensity).mul(murk), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return { mesh, intensity: uIntensity, color: uColor, scan: uScan };
}

/**
 * Soft glow halos around small light sources (bulbs, LEDs, lamps). One instanced sprite for all of
 * them. Each halo reads a brightness "channel" from a uniform array that the CPU sets per frame, so
 * blinking LEDs, night-only lamps and alarm lights stay in sync with their emissive meshes.
 * Channel 0 is always 1.
 */
export class GlowSprites {
  sprite!: THREE.Sprite;
  readonly channels: number[];
  private items: { p: THREE.Vector3; c: THREE.Color; size: number; ch: number }[] = [];
  private uCh: N;

  constructor(nChannels = 24) {
    this.channels = new Array(nChannels).fill(1);
    this.uCh = uniformArray(this.channels, 'float');
  }

  /** `color` may be HDR (components > 1); `size` = halo diameter in metres. */
  add(p: THREE.Vector3, color: THREE.ColorRepresentation, size: number, channel = 0, intensity = 1) {
    this.items.push({ p: p.clone(), c: new THREE.Color(color).multiplyScalar(intensity), size, ch: channel });
    return this;
  }

  build() {
    const n = Math.max(1, this.items.length);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const b = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.items.forEach((it, i) => {
      a.setXYZW(i, it.p.x, it.p.y, it.p.z, it.size);
      b.setXYZW(i, it.c.r, it.c.g, it.c.b, it.ch);
    });
    const A: N = instancedBufferAttribute(a, 'vec4');
    const B: N = instancedBufferAttribute(b, 'vec4');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    mat.positionNode = A.xyz;
    const level: N = this.uCh.element(B.w.toInt());
    const vLevel: N = varying(level);
    // flicker-free size; brightness comes from the channel
    mat.scaleNode = vec2(A.w, A.w).mul(level.greaterThan(0.002).select(float(1), float(0)));
    mat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const core = pow(clamp(float(1).sub(d), 0, 1), 6).mul(2.5);
      const halo = pow(clamp(float(1).sub(d), 0, 1), 2.2).mul(0.55);
      // soft-particle fade so a halo never shows a hard edge where it meets a wall
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(0.25), 0, 1);
      return vec4(B.xyz.mul(core.add(halo)).mul(vLevel).mul(soft), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = this.items.length;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 22;
    this.sprite.name = 'glowHalos';
    return this.sprite;
  }
}

/**
 * Hot sparks: short-lived additive streaks under gravity that skid along the floor. One sprite draw
 * call; CPU writes spawns into a ring buffer, the GPU integrates and stretches each spark along its
 * screen-space velocity. Use for shorting electronics, drone brown-outs/crashes and EMP bursts.
 */
export class Sparks {
  sprite: THREE.Sprite;
  private readonly N = 192;
  private a: THREE.InstancedBufferAttribute; // xyz spawn pos, w spawn time
  private b: THREE.InstancedBufferAttribute; // xyz velocity, w floor y
  private c: THREE.InstancedBufferAttribute; // x palette (0 fire, 1 electric), y size, z life
  private next = 0;
  private now = 0;
  private lastEmit = -99;
  private uTime = uniform(0);

  constructor() {
    const N = this.N;
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(-1e4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(0.5), 4);
    for (const at of [this.a, this.b, this.c]) at.setUsage(THREE.DynamicDrawUsage);
    const A: N = instancedDynamicBufferAttribute(this.a, 'vec4');
    const B: N = instancedDynamicBufferAttribute(this.b, 'vec4');
    const C: N = instancedDynamicBufferAttribute(this.c, 'vec4');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const age: N = this.uTime.sub(A.w);
    const life: N = C.z;
    const alive: N = age.greaterThan(0).and(age.lessThan(life));
    const g: N = float(-9.8);
    const k: N = float(1.4); // drag
    const damp: N = exp(age.mul(k).negate());
    const travel: N = B.xyz.mul(float(1).sub(damp).div(k));
    const fall: N = g.mul(age.mul(age)).mul(0.5);
    const raw: N = A.xyz.add(travel).add(vec3(0, fall, 0));
    const pos: N = vec3(raw.x, max(raw.y, B.w), raw.z);
    mat.positionNode = pos;
    // current velocity → screen-space streak
    const vel: N = B.xyz.mul(damp).add(vec3(0, g.mul(age), 0));
    const vv: N = cameraViewMatrix.mul(vec4(vel, 0)).xyz;
    const depth: N = cameraViewMatrix.mul(vec4(pos, 1)).z.negate().max(0.3);
    const sv: N = vv.xy.div(depth);
    const sLen: N = length(sv);
    const t: N = age.div(life);
    const size: N = C.y.mul(float(1).sub(t.mul(0.5)));
    mat.scaleNode = vec2(size.mul(1.3).add(sLen.mul(depth).mul(0.03)), size.mul(0.8)).mul(alive.select(float(1), float(0)));
    mat.rotationNode = atan(sv.y, sv.x);
    const vT: N = varying(t);
    const vPal: N = varying(C.x);
    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const shape = smoothstep(1.0, 0.0, length(vec2(p.x, p.y.mul(1.6))));
      const heat = float(1).sub(vT);
      const fire = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.85, 0.5), heat.mul(heat));
      const elec = mix(vec3(0.3, 0.7, 1.0), vec3(0.9, 0.97, 1.0), heat.mul(heat));
      const col = mix(fire, elec, vPal);
      return vec4(col.mul(shape).mul(heat.mul(heat).mul(14).add(0.6)), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 23;
    this.sprite.name = 'sparks';
    // starts visible so the scene pre-compile builds its shader; update() hides it while idle
  }

  /**
   * `n` sparks from `p`: random directions with `speed` m/s, biased by `dir` (added velocity) and
   * `up`. `floorY` is where they skid. `electric` = blue-white palette instead of molten orange.
   */
  emit(p: THREE.Vector3, n: number, speed: number, opts: { up?: number; dir?: THREE.Vector3; floorY?: number; electric?: boolean; size?: number; life?: number; spread?: number } = {}) {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, C = this.c.array as Float32Array;
    const up = opts.up ?? 1.5, floor = opts.floorY ?? p.y - 10, spread = opts.spread ?? 0;
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % this.N;
      // random direction on a sphere, squashed so most sparks go sideways/up
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.9);
      A[j * 4] = p.x + (Math.random() - 0.5) * spread;
      A[j * 4 + 1] = p.y + (Math.random() - 0.5) * spread;
      A[j * 4 + 2] = p.z + (Math.random() - 0.5) * spread;
      A[j * 4 + 3] = this.now - Math.random() * 0.03;
      B[j * 4] = s * Math.cos(th) * sp + (opts.dir?.x ?? 0);
      B[j * 4 + 1] = Math.abs(u) * sp * 0.6 + up * (0.4 + Math.random() * 0.8) + (opts.dir?.y ?? 0);
      B[j * 4 + 2] = s * Math.sin(th) * sp + (opts.dir?.z ?? 0);
      B[j * 4 + 3] = floor;
      C[j * 4] = opts.electric ? 1 : 0;
      C[j * 4 + 1] = (opts.size ?? 0.03) * (0.6 + Math.random() * 0.8);
      C[j * 4 + 2] = (opts.life ?? 0.7) * (0.45 + Math.random() * 0.9);
    }
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = true;
    this.lastEmit = this.now;
    this.sprite.visible = true;
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
    // nothing alive → skip the draw call entirely
    if (this.now - this.lastEmit > 2) this.sprite.visible = false;
  }
}

/**
 * EMP burst: a bright core flash, a crackling plasma shell, a shock ring racing along the ground and
 * jagged electric arcs that re-strike every few frames. Owns its meshes; `mesh` is the group to add
 * to the scene. Optionally throws electric sparks through a shared `Sparks`.
 */
export class Shockwave {
  mesh = new THREE.Group();
  private t = 0;
  private uT = uniform(0);
  private shell: THREE.Mesh;
  private ring: THREE.Mesh;
  private flash: THREE.Sprite;
  private arcs: THREE.Mesh;
  private arcPos: THREE.BufferAttribute;
  private arcTimer = 0;
  private center: THREE.Vector3;
  done = false;
  private static readonly ARCS = 7;
  private static readonly SEG = 9;

  constructor(pos: THREE.Vector3, private radius = 8, sparks?: Sparks) {
    this.center = pos.clone();
    this.mesh.position.copy(pos);
    const t = this.uT;

    // plasma shell: fresnel rim + crackling veins from the cell-edge channel of the noise atlas
    const shellMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    shellMat.colorNode = Fn(() => {
      const v = normalize(cameraPosition.sub(positionWorld));
      const rimF = pow(float(1).sub(abs(dot(normalWorld, v))), 3.0);
      const q = positionLocal.xz.add(positionLocal.y).mul(0.6).add(time.mul(1.7));
      // thin cell-edge filaments, only lit where a fast-moving mask passes: crackling, not a grid
      const mask = smoothstep(0.52, 0.72, noise(q.mul(0.21).add(vec2(time.mul(2.3), time.mul(-1.7)))).r);
      const veins = smoothstep(0.07, 0.0, noise(q).b).mul(mask).mul(2.2);
      const fade = pow(float(1).sub(t), 1.5);
      const a = rimF.mul(1.4).add(veins.mul(0.9)).mul(fade);
      return vec4(vec3(0.35, 0.8, 1.0).mul(a).mul(5), 1);
    })();
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), shellMat);
    this.shell.scale.setScalar(0.1);
    this.mesh.add(this.shell);

    // ground shock ring (flat, slightly above the ground)
    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    ringMat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const ang = atan(p.y, p.x);
      const wob = noise(vec2(ang.mul(1.2), time.mul(0.8))).r.sub(0.5).mul(0.08);
      const band = smoothstep(0.16, 0.0, abs(r.add(wob).sub(0.9))).mul(smoothstep(1.0, 0.95, r));
      const inner = smoothstep(0.95, 0.2, r).mul(0.12);
      const scorch = noise(p.mul(1.5)).b; // crackle on the fill
      const fade = pow(float(1).sub(t), 1.2);
      const a = band.mul(3.2).add(inner.mul(smoothstep(0.3, 0.0, scorch).add(0.4))).mul(fade);
      return vec4(vec3(0.4, 0.85, 1.0).mul(a).mul(4), 1);
    })();
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = -0.03;
    this.ring.scale.setScalar(0.1);
    this.mesh.add(this.ring);

    // core flash
    const flashMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    flashMat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const k = pow(clamp(float(1).sub(d), 0, 1), 3).mul(pow(clamp(float(1).sub(t.mul(3.2)), 0, 1), 2));
      return vec4(vec3(0.75, 0.92, 1.0).mul(k).mul(9), 1);
    })();
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.setScalar(4.5);
    this.flash.position.y = 0.4;
    this.mesh.add(this.flash);

    // arcs: camera-facing ribbons rebuilt on the CPU every few frames
    const nV = Shockwave.ARCS * Shockwave.SEG * 6;
    const geo = new THREE.BufferGeometry();
    this.arcPos = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.arcPos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.arcPos);
    const along = new Float32Array(nV * 2);
    for (let i = 0; i < nV; i++) along[i * 2 + 1] = [0, 1, 0, 1, 1, 0][i % 6]; // v = across the ribbon
    geo.setAttribute('uv', new THREE.BufferAttribute(along, 2));
    const arcMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    arcMat.colorNode = Fn(() => {
      const across = abs(uv().y.sub(0.5)).mul(2);
      const core = smoothstep(1.0, 0.0, across);
      const fade = pow(clamp(float(1).sub(t.mul(1.3)), 0, 1), 1.2);
      return vec4(vec3(0.55, 0.85, 1.0).mul(core.mul(core)).mul(fade).mul(10), 1);
    })();
    this.arcs = new THREE.Mesh(geo, arcMat);
    this.arcs.frustumCulled = false;
    this.mesh.add(this.arcs);

    sparks?.emit(pos.clone().setY(pos.y + 0.15), 70, 9, { up: 2.5, floorY: pos.y - 0.05, electric: true, size: 0.035, life: 0.9 });
  }

  /** New random jagged bolts from the centre out to the current shell radius. */
  private strike(r: number, camPos: THREE.Vector3) {
    const P = this.arcPos.array as Float32Array;
    const S = Shockwave.SEG;
    const pts: THREE.Vector3[] = [];
    let o = 0;
    for (let a = 0; a < Shockwave.ARCS; a++) {
      const th = Math.random() * Math.PI * 2;
      const el = Math.random() * 0.9 - 0.05;
      const end = new THREE.Vector3(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el)).multiplyScalar(r * (0.55 + Math.random() * 0.45));
      pts.length = 0;
      for (let i = 0; i <= S; i++) {
        const f = i / S;
        const p = end.clone().multiplyScalar(f);
        const j = (i === 0 || i === S ? 0 : 1) * r * 0.12;
        p.x += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j;
        pts.push(p);
      }
      const w = 0.05 + Math.random() * 0.05;
      for (let i = 0; i < S; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dir = _v1.copy(p1).sub(p0);
        const mid = _v2.copy(p0).add(p1).multiplyScalar(0.5).add(this.center);
        const side = dir.cross(_v3.copy(camPos).sub(mid)).normalize().multiplyScalar(w * (1 - i / S * 0.6));
        const quad = [p0.clone().sub(side), p0.clone().add(side), p1.clone().sub(side), p0.clone().add(side), p1.clone().add(side), p1.clone().sub(side)];
        for (const q of quad) { P[o++] = q.x; P[o++] = q.y; P[o++] = q.z; }
      }
    }
    this.arcPos.needsUpdate = true;
  }

  update(dt: number, camPos?: THREE.Vector3) {
    this.t += dt / 0.8;
    const tt = Math.min(this.t, 1);
    this.uT.value = tt;
    const e = 1 - Math.pow(1 - tt, 3);
    this.shell.scale.setScalar(0.1 + e * this.radius);
    this.ring.scale.setScalar(0.1 + (1 - Math.pow(1 - tt, 2.2)) * this.radius * 1.15);
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) {
      this.arcTimer = 0.045;
      this.strike(Math.max(0.6, e * this.radius * 0.9), camPos ?? this.center.clone().add(new THREE.Vector3(0, 2, 6)));
    }
    if (this.t >= 1) this.done = true;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/**
 * Electric arcs: jagged bolts drawn as crossed ribbons (readable from any side without knowing the
 * camera). Up to `maxBolts` per frame in ONE additive mesh; the CPU rewrites its few hundred
 * vertices only while something is arcing. Points are in the mesh's parent space.
 *   arcs.begin(); arcs.bolt(a, b, { width, jag }); …; arcs.end();
 */
export class ElectricArc {
  readonly mesh: THREE.Mesh;
  readonly intensity = uniform(1);
  private readonly pos: THREE.BufferAttribute;
  private readonly segs: number;
  private n = 0;
  private used = 0;
  private readonly walk: number[] = [];
  private readonly _d = new THREE.Vector3();
  private readonly _s1 = new THREE.Vector3();
  private readonly _s2 = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();

  constructor(private readonly maxBolts = 4, segs = 14, color: THREE.ColorRepresentation = '#8fd0ff') {
    this.segs = segs;
    const vPerRibbon = (segs + 1) * 2;
    const nv = maxBolts * 2 * vPerRibbon;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    const uvA = new Float32Array(nv * 2);
    const idx: number[] = [];
    for (let r = 0; r < maxBolts * 2; r++) {
      const base = r * vPerRibbon;
      for (let i = 0; i <= segs; i++) {
        uvA[(base + i * 2) * 2] = i / segs;
        uvA[(base + i * 2 + 1) * 2] = i / segs;
        uvA[(base + i * 2 + 1) * 2 + 1] = 1;
        if (i < segs) {
          const a = base + i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const c = uniform(new THREE.Color(color));
    const k = this.intensity;
    mat.colorNode = Fn(() => {
      const across = abs(uv().y.sub(0.5)).mul(2);
      // white-hot core inside a blue sheath; the ends fade so bolts don't stop in hard cuts
      const core = smoothstep(0.35, 0.0, across);
      const sheath = pow(float(1).sub(across), 2.2);
      const ends = smoothstep(0.0, 0.06, uv().x).mul(smoothstep(1.0, 0.94, uv().x));
      return vec4(c.mul(sheath.mul(2.5)).add(vec3(1, 1, 1).mul(core.mul(6))).mul(ends).mul(k), 1);
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 24;
    this.mesh.name = 'arcs';
  }

  begin() {
    this.used = 0;
  }

  /** One bolt from `a` to `b`. `jag` = lateral wander per segment (m), `width` = ribbon width (m).
   *  `path` (optional) receives the bolt's jagged centre line, segs + 1 points (for branches). */
  bolt(a: THREE.Vector3, b: THREE.Vector3, opts: { width?: number; jag?: number; path?: THREE.Vector3[] } = {}) {
    if (this.used >= this.maxBolts) return;
    const w = opts.width ?? 0.03, jag = opts.jag ?? 0.12;
    const d = this._d.copy(b).sub(a);
    const len = d.length();
    if (len < 1e-4) return;
    d.divideScalar(len);
    // two sides perpendicular to the bolt and to each other
    const s1 = this._s1.set(0, 1, 0).cross(d);
    if (s1.lengthSq() < 1e-4) s1.set(1, 0, 0).cross(d);
    s1.normalize();
    const s2 = this._s2.copy(d).cross(s1).normalize();
    const S = this.segs, wk = this.walk;
    // a random walk with its drift removed, so it leaves `a` and lands exactly on `b`
    let ox = 0, oy = 0;
    for (let i = 0; i <= S; i++) {
      if (i > 0) { ox += (Math.random() - 0.5) * jag; oy += (Math.random() - 0.5) * jag; }
      wk[i * 2] = ox; wk[i * 2 + 1] = oy;
    }
    const arr = this.pos.array as Float32Array;
    for (let r = 0; r < 2; r++) {
      const side = r === 0 ? s1 : s2;
      const base = (this.used * 2 + r) * (S + 1) * 2;
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        const p = this._p.copy(a).addScaledVector(d, len * t)
          .addScaledVector(s1, wk[i * 2] - t * wk[S * 2]).addScaledVector(s2, wk[i * 2 + 1] - t * wk[S * 2 + 1]);
        if (r === 0 && opts.path) (opts.path[i] ??= new THREE.Vector3()).copy(p);
        const hw = w * (0.6 + 0.4 * Math.sin(t * Math.PI));
        const v0 = (base + i * 2) * 3, v1 = v0 + 3;
        arr[v0] = p.x - side.x * hw; arr[v0 + 1] = p.y - side.y * hw; arr[v0 + 2] = p.z - side.z * hw;
        arr[v1] = p.x + side.x * hw; arr[v1 + 1] = p.y + side.y * hw; arr[v1 + 2] = p.z + side.z * hw;
      }
    }
    this.used++;
  }

  /** Collapse unused ribbons and upload. Hides the mesh when nothing arced. */
  end() {
    if (this.used === 0 && this.n === 0) { this.mesh.visible = false; return; }
    const per = (this.segs + 1) * 2 * 3 * 2;
    if (this.used < this.n) (this.pos.array as Float32Array).fill(0, this.used * per, this.n * per);
    this.n = this.used;
    this.pos.needsUpdate = true;
    this.mesh.visible = this.used > 0;
  }
}

/**
 * Dry lightning inside a dust storm: a forked channel far out in the murk, struck once per stroke
 * (Weather.onLightning) and then lit by the storm's own flash pulses, so re-strikes keep the same
 * shape like real lightning. One additive mesh; farther strokes sink into the dust.
 */
export class StormLightning {
  readonly arcs = new ElectricArc(6, 26, '#c8ceff');
  private readonly path: THREE.Vector3[] = [];
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private vis = 0;

  constructor() {
    this.arcs.mesh.name = 'storm-lightning';
    this.arcs.mesh.renderOrder = -900; // drawn with the sky, behind every other transparent
  }

  get mesh() {
    return this.arcs.mesh;
  }

  /** A new stroke around `cam`: `k` 0..1 = how close (and bright). */
  strike(cam: THREE.Vector3, k: number) {
    const dist = 220 + (1 - k) * 520 + Math.random() * 120;
    const ang = Math.random() * Math.PI * 2;
    const gx = cam.x + Math.cos(ang) * dist, gz = cam.z + Math.sin(ang) * dist;
    const top = this._a.set(gx + (Math.random() - 0.5) * 120, cam.y + 260 + Math.random() * 120, gz + (Math.random() - 0.5) * 120);
    const ground = this._b.set(gx, cam.y - 20, gz);
    const a = this.arcs;
    a.begin();
    a.bolt(top, ground, { width: 2.6, jag: 26, path: this.path });
    // forks peel off the main channel and die out before the ground
    const p = this.path, n = p.length - 1;
    for (let f = 0; f < 4; f++) {
      const from = p[Math.floor(n * (0.15 + Math.random() * 0.55))];
      const len = 50 + Math.random() * 110;
      const dx = Math.random() - 0.5, dz = Math.random() - 0.5;
      _v1.set(from.x + dx * len * 1.4, from.y - len * (0.5 + Math.random() * 0.4), from.z + dz * len * 1.4);
      a.bolt(_v2.copy(from), _v1, { width: 1.3 - f * 0.2, jag: 12 });
    }
    a.end();
    this.vis = 0.35 + 0.65 * k;
  }

  /** `flash` = Weather.flash (0..1), `storm` = strength 0..1. */
  update(flash: number, storm: number) {
    const on = flash > 0.03 && storm > 0.3;
    this.arcs.mesh.visible = on;
    if (on) this.arcs.intensity.value = Math.min(1.4, flash * 1.6) * this.vis * (1.2 - storm * 0.5);
  }
}

/**
 * The leading edge of a dust storm at ground level: a boiling brown wall that rolls in from upwind
 * and over you (the sky's horizon band is the storm body behind it). One arc of a cylinder around
 * the camera, `dist` metres out and centred on the upwind direction; it's depth-tested, so a ridge
 * nearer than the front stands out against it and is swallowed once the front has passed it. The
 * head leans forward over you as it arrives. Unfogged: it carries its own haze. Hidden when calm.
 */
export class StormWall {
  readonly mesh: THREE.Mesh;
  private readonly uDist = uniform(1200);
  private readonly uVis = uniform(0);
  private static readonly SPAN = 1.45; // half the arc (rad)
  private static readonly H = 340; // height of the head (m)

  constructor(atmo: Atmosphere) {
    const A = StormWall.SPAN, H = StormWall.H;
    const cols = 96, rows = 14;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const r = 1 - 0.2 * v * v; // the head overhangs its own foot
      for (let i = 0; i <= cols; i++) {
        const u = i / cols, a = (u * 2 - 1) * A;
        pos.push(Math.sin(a) * r, v, -Math.cos(a) * r);
        uvs.push(u, v);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const u = uv().x, v = uv().y;
    // metres along the front and up it: the billows grow as the wall comes closer
    const s = u.sub(0.5).mul(2 * A).mul(this.uDist);
    const hm = v.mul(H);
    const t = time;
    // cauliflower skyline (a function of s only), slowly morphing
    const crest = noise(vec2(s.div(900), t.mul(0.006))).r.mul(0.55)
      .add(noise(vec2(s.div(260).add(0.37), t.mul(0.015))).g.mul(0.3))
      .add(noise(vec2(s.div(80).add(0.71), t.mul(0.03))).r.mul(0.15));
    const top = crest.mul(0.85).add(0.22);
    // billows boil up out of the skirt and roll forward
    const b1 = noise(vec2(s.div(380), hm.div(300).sub(t.mul(0.018)))).r;
    const b2 = noise(vec2(s.div(130).add(b1.mul(0.35)), hm.div(110).sub(t.mul(0.045)))).g;
    const b3 = noise(vec2(s.div(38).add(b2.mul(0.2)), hm.div(34).sub(t.mul(0.11)))).r;
    const billow = b1.mul(0.45).add(b2.mul(0.38)).add(b3.mul(0.17));
    const edge = smoothstep(top, top.sub(0.1).sub(b2.mul(0.12)), v.add(b3.sub(0.5).mul(0.05)));
    // ragged wisps where the head thins out; the ends of the arc melt into the haze
    const thin = smoothstep(top.sub(0.25), top, v);
    const wisps = mix(float(1), smoothstep(0.32, 0.62, billow), thin);
    const ends = smoothstep(0.0, 0.16, u).mul(smoothstep(1.0, 0.84, u));
    const alpha = edge.mul(wisps).mul(ends).mul(0.97).mul(this.uVis);

    // shading: a dark, ground-hugging skirt; sun-caught tops on the lit side, a silver rim against
    // the sun; lightning glows inside. Far off, the air between thins it toward the storm haze.
    const storm = atmo.uStormColor as N;
    const upwind3 = vec3(atmo.uUpwind.x, 0, atmo.uUpwind.y);
    const sunDir = atmo.uSunDir as N;
    const sunUp = smoothstep(-0.08, 0.06, sunDir.y);
    const lit = max(dot(upwind3.negate(), sunDir), 0).mul(0.6).add(0.4).mul(sunUp);
    const lift = smoothstep(0.0, 0.45, v).mul(0.5).add(billow.mul(billow).mul(0.9));
    const skirt = smoothstep(0.0, 0.12, v).mul(0.4).add(0.6);
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const rim = pow(max(dot(viewDir, sunDir), 0), 4).mul(thin.mul(0.7).add(0.15)).mul(sunUp);
    // each puff's sunward top is bright and its underside dark (the billow field's own vertical
    // slope on screen stands in for a normal), and the folds between puffs hold shadow
    const slopeUp = clamp(b2.mul(0.7).add(b1.mul(0.3)).dFdy().negate().mul(40), -1, 1);
    const fold = smoothstep(0.25, 0.7, billow).mul(0.75).add(0.4);
    const relief = slopeUp.mul(0.35).mul(lit.add(0.2)).add(1);
    let col: N = storm.mul(float(0.3).add(lift.mul(lit.mul(0.9).add(0.25)))).mul(skirt).mul(fold).mul(relief);
    // a haboob is tan-brown, a little less saturated than the storm's own dusk-lit haze
    col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))), 0.22);
    col = col.add((atmo.uSunColor as N).mul(rim).mul(0.35));
    col = col.add(vec3(0.5, 0.48, 0.62).mul(atmo.uFlash).mul(0.5));
    col = mix(col, storm.mul(1.15), smoothstep(300, 1600, this.uDist).mul(0.45));
    mat.colorNode = col;
    mat.opacityNode = alpha;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'storm-wall';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -850; // with the sky's transparents, under dust and particles
    this.mesh.visible = false;
  }

  /** `dist` = metres to the front, `vis` 0..1; `upwind` = Atmosphere.uUpwind (XZ, unit). */
  update(cam: THREE.Vector3, dist: number, vis: number, upwind: THREE.Vector2) {
    this.mesh.visible = vis > 0.002;
    if (!this.mesh.visible) return;
    this.uDist.value = dist;
    this.uVis.value = vis;
    this.mesh.position.set(cam.x, cam.y - 45, cam.z);
    this.mesh.scale.set(dist, StormWall.H, dist);
    this.mesh.rotation.y = Math.atan2(-upwind.x, -upwind.y);
  }
}
