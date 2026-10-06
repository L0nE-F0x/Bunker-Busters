import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, instanceIndex, hash, time, cameraPosition, fract, uv, length, smoothstep, mix, max,
  pow, dot, normalize, sin, positionLocal, positionWorld, texture, color, clamp,
  normalWorld, abs, viewportLinearDepth, linearDepth, cameraNear, cameraFar, instancedDynamicBufferAttribute, exp,
  cameraViewMatrix, atan, renderGroup, step,
} from 'three/tsl';
import type { Atmosphere } from './Atmosphere';
import type { Heightfield } from './Heightfield';
import { noise } from '@/engine/noiseTex';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Half-float height texture so GPU effects can hug the terrain. */
export function heightTexture(hf: Heightfield) {
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
      const a = shape.mul(fade).mul(soft).mul(atmo.uDust.mul(0.22).add(0.04).add(atmo.uStorm.mul(0.4)));
      return vec4(mix(lit, (atmo.uStormColor as N).mul(1.15), atmo.uStorm.mul(0.6)), a);
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

/**
 * Blowing sand: thin streaks racing low over the ground with the wind, the signature of a dust
 * storm (and a hint of it on gusty days). One sprite draw call; every streak is placed on the GPU
 * from instanceIndex, wraps around the camera, hugs the terrain, and is rotated in screen space to
 * line up with the projected wind direction.
 */
export class SandStreaks {
  sprite: THREE.Sprite;
  readonly uOffset = uniform(new THREE.Vector2());
  readonly uDir = uniform(new THREE.Vector2(1, 0));
  readonly uAmount = uniform(0);
  private offset = new THREE.Vector2();

  constructor(private atmo: Atmosphere, hf: Heightfield, heightTex: THREE.Texture, count = 900) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const B = float(48);
    const seed = vec3(hash(instanceIndex.add(17)), hash(instanceIndex.add(4099)), hash(instanceIndex.add(8191)));
    const speedK = hash(instanceIndex.add(23)).mul(0.7).add(0.65);
    const lxz = fract(seed.xz.add(this.uOffset.mul(speedK).div(B))).sub(0.5).mul(B);
    const wxz = cameraPosition.xz.add(lxz);
    const ground = texture(heightTex, wxz.div(hf.size).add(0.5)).r;
    // most streaks skim the sand; a few loft up to head height
    const lift = pow(seed.y, 2.4).mul(2.6).add(0.04);
    const flutter = sin(time.mul(seed.x.mul(3).add(4)).add(seed.z.mul(40))).mul(0.06).mul(lift);
    const pos = vec3(wxz.x, ground.add(lift).add(flutter), wxz.y);
    mat.positionNode = pos;
    // align with the wind as seen on screen; foreshortened when it blows toward/away from the camera
    const wv = cameraViewMatrix.mul(vec4(this.uDir.x, 0, this.uDir.y, 0)).xy;
    const along = clamp(length(wv), 0.12, 1);
    mat.rotationNode = atan(wv.y, wv.x);
    const len = hash(instanceIndex.add(5)).mul(2.6).add(0.9);
    mat.scaleNode = vec2(len.mul(along), hash(instanceIndex.add(6)).mul(0.06).add(0.025));

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
      const lit = (atmo.uStormColor as N).mul(1.6).add(atmo.uSunColor.mul(pow(mu, 6).mul(0.5).mul(float(1).sub(atmo.uNight))));
      return vec4(lit, head.mul(across).mul(fade).mul(pulse).mul(this.uAmount).mul(0.4));
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
    this.sprite.visible = amount > 0.01;
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
    const size = B.w.mul(age.mul(1.1).add(0.45)).mul(alive.select(float(1), float(0)));
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
      return vec4(lit, shape.mul(fade).mul(soft).mul(0.32));
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 12;
  }

  /** `n` puffs around `p`: `spread` m/s outward, `up` m/s upward, `size` m, optional push `dir`. */
  emit(p: THREE.Vector3, n: number, spread: number, up: number, size: number, dir?: THREE.Vector3) {
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
      B[j * 4 + 3] = size * (0.7 + Math.random() * 0.6);
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
  light: THREE.PointLight;
  private t = Math.random() * 10;

  constructor(scale = 1, lightIntensity = 30) {
    // additive blending is order-independent, so one pass over both faces looks the same as three's
    // default back-then-front double pass for transparent DoubleSide (one draw instead of two)
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
    mat.colorNode = Fn(() => {
      const p = uv();
      const n = noise(vec2(p.x.mul(0.6), p.y.mul(0.45).sub(time.mul(0.5)))).r.sub(0.5).mul(1.8);
      const shapeX = abs(p.x.sub(0.5)).mul(2);
      const flame = smoothstep(0.0, 0.7, float(1).sub(shapeX.mul(float(1.3).add(p.y.mul(1.5)))).sub(p.y.mul(0.8)).add(n.mul(0.6)));
      const core = pow(flame, 3);
      const col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.3), core).mul(flame.mul(9));
      return vec4(col, flame);
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
    this.group.add(new THREE.Mesh(mergeGeometries(cards, false)!, mat));
    // embers
    const em = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const life = fract(time.mul(0.35).add(hash(instanceIndex)));
    const ex = sin(time.mul(1.3).add(hash(instanceIndex.add(5)).mul(20))).mul(0.4).mul(life);
    const ez = sin(time.mul(1.1).add(hash(instanceIndex.add(9)).mul(20))).mul(0.4).mul(life);
    em.positionNode = vec3(ex.add(hash(instanceIndex.add(1)).sub(0.5).mul(0.6)), life.mul(4 * scale), ez);
    em.scaleNode = vec2(0.04 * scale, 0.04 * scale);
    em.colorNode = vec4(vec3(1.0, 0.45, 0.1).mul(float(8).mul(float(1).sub(life))), smoothstep(1, 0.6, life));
    const embers = new THREE.Sprite(em);
    embers.count = 60;
    this.group.add(embers);

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
    const logMat = new THREE.MeshStandardNodeMaterial({ color: '#1a120c', roughness: 1 });
    logMat.emissiveNode = color('#ff4a10').mul(noise(positionWorld.xz.mul(0.8).add(time.mul(0.1))).r.sub(0.5).mul(2).mul(0.5).add(0.5).mul(1.5));
    const logs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      logs.push(at(new THREE.CylinderGeometry(0.07 * scale, 0.08 * scale, 0.9 * scale, 6).toNonIndexed(), 0, 0.15, 0, Math.PI / 2 - 0.3, (i / 4) * Math.PI * 2));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(logs, false)!, logMat));

    this.light = new THREE.PointLight(0xff8a3a, lightIntensity, 22, 1.6);
    this.light.position.y = 1.2 * scale;
    this.group.add(this.light);
    this.baseIntensity = lightIntensity;
  }

  private baseIntensity: number;

  update(dt: number) {
    this.t += dt;
    const f = 0.75 + Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3) * 0.1 + Math.sin(this.t * 23.1) * 0.06;
    this.light.intensity = this.baseIntensity * f;
    this.light.position.x = Math.sin(this.t * 5) * 0.05;
  }
}

/** Storm density 0..1 shared by every light cone (set by Atmosphere): cones are fog-less additive
 *  meshes, so without this their hard edges stayed crisp while the storm swallowed everything else. */
export const coneMurk = uniform(0).setGroup(renderGroup);

/** Additive cone of light for spotlights (drone, floodlights) with drifting dust inside. */
export function lightCone(length: number, radius: number, c: THREE.ColorRepresentation, intensity = 0.6) {
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  const uIntensity = uniform(intensity);
  const uColor = uniform(new THREE.Color(c));
  // additive: single pass over both faces = same result as the back-then-front double pass
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  mat.colorNode = Fn(() => {
    const along = positionLocal.y.negate().div(length); // 0 at tip, 1 at base
    const v = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalWorld, v));
    const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.12).add(time.mul(0.02))).r.sub(0.5).mul(2);
    const a = pow(facing, 2.0).mul(smoothstep(1.0, 0.05, along)).mul(smoothstep(0.0, 0.08, along)).mul(n.mul(0.35).add(0.75));
    const murk = exp(positionWorld.sub(cameraPosition).length().mul(coneMurk).mul(-0.07));
    return vec4((uColor as N).mul(a).mul(uIntensity).mul(murk), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return { mesh, intensity: uIntensity, color: uColor };
}

/** Expanding EMP shockwave sphere. */
export class Shockwave {
  mesh: THREE.Mesh;
  private t = 0;
  private uT = uniform(0);
  done = false;

  constructor(pos: THREE.Vector3, private radius = 8) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
    const t = this.uT;
    mat.colorNode = Fn(() => {
      const v = normalize(cameraPosition.sub(positionWorld));
      const rimF = pow(float(1).sub(abs(dot(normalWorld, v))), 2.5);
      const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.3).add(time.mul(0.6))).r.sub(0.5).mul(2);
      const a = rimF.mul(float(1).sub(t)).mul(n.mul(0.5).add(0.8));
      return vec4(vec3(0.35, 0.8, 1.0).mul(a).mul(6), 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(0.1);
  }

  update(dt: number) {
    this.t += dt / 0.7;
    this.uT.value = Math.min(this.t, 1);
    const e = 1 - Math.pow(1 - Math.min(this.t, 1), 3);
    this.mesh.scale.setScalar(0.1 + e * this.radius);
    if (this.t >= 1) this.done = true;
  }
}

