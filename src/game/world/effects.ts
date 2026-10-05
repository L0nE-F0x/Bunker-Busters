import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, instanceIndex, hash, time, cameraPosition, fract, uv, length, smoothstep, mix, max,
  pow, dot, normalize, sin, positionLocal, positionWorld, texture, color, clamp,
  normalWorld, abs, viewportLinearDepth, linearDepth, cameraNear, cameraFar, instancedDynamicBufferAttribute, exp,
  instancedBufferAttribute, uniformArray, varying, atan, cameraViewMatrix,
} from 'three/tsl';
import type { Atmosphere } from './Atmosphere';
import type { Heightfield } from './Heightfield';
import { noise } from '@/engine/noiseTex';

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
      return vec4(c.mul(soft).mul(fade).mul(0.35), 1);
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
    const size = seed.z.mul(10).add(6);
    const pos = vec3(wxz.x, ground.add(size.mul(0.28)), wxz.y);
    mat.positionNode = pos;
    mat.scaleNode = vec2(size.mul(1.6), size.mul(0.7));
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
      const a = shape.mul(fade).mul(soft).mul(atmo.uDust.mul(0.22).add(0.04));
      return vec4(lit, a);
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
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.colorNode = Fn(() => {
      const p = uv();
      const n = noise(vec2(p.x.mul(0.6), p.y.mul(0.45).sub(time.mul(0.5)))).r.sub(0.5).mul(1.8);
      const shapeX = abs(p.x.sub(0.5)).mul(2);
      const flame = smoothstep(0.0, 0.7, float(1).sub(shapeX.mul(float(1.3).add(p.y.mul(1.5)))).sub(p.y.mul(0.8)).add(n.mul(0.6)));
      const core = pow(flame, 3);
      const col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.3), core).mul(flame.mul(9));
      return vec4(col, flame);
    })();
    const geo = new THREE.PlaneGeometry(1.1 * scale, 1.6 * scale);
    geo.translate(0, 0.8 * scale, 0);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = (i / 3) * Math.PI;
      this.group.add(m);
    }
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
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 * scale, 0), stone);
      s.position.set(Math.cos(a) * 0.65 * scale, 0.08, Math.sin(a) * 0.65 * scale);
      s.rotation.set(a, a * 2, 0);
      s.castShadow = true;
      this.group.add(s);
    }
    const logMat = new THREE.MeshStandardNodeMaterial({ color: '#1a120c', roughness: 1 });
    logMat.emissiveNode = color('#ff4a10').mul(noise(positionWorld.xz.mul(0.8).add(time.mul(0.1))).r.sub(0.5).mul(2).mul(0.5).add(0.5).mul(1.5));
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.08 * scale, 0.9 * scale, 6), logMat);
      log.rotation.set(Math.PI / 2 - 0.3, (i / 4) * Math.PI * 2, 0);
      log.position.y = 0.15;
      this.group.add(log);
    }

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

/** Additive cone of light for spotlights (drone, floodlights) with drifting dust inside. */
export function lightCone(length: number, radius: number, c: THREE.ColorRepresentation, intensity = 0.6) {
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  const uIntensity = uniform(intensity);
  const uColor = uniform(new THREE.Color(c));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  mat.colorNode = Fn(() => {
    const along = positionLocal.y.negate().div(length); // 0 at tip, 1 at base
    const v = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalWorld, v));
    const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.12).add(time.mul(0.02))).r.sub(0.5).mul(2);
    const near = smoothstep(0.6, 5.0, positionWorld.sub(cameraPosition).length());
    const a = pow(facing, 2.0).mul(smoothstep(1.0, 0.05, along)).mul(smoothstep(0.0, 0.08, along)).mul(n.mul(0.35).add(0.75)).mul(near);
    return vec4((uColor as N).mul(a).mul(uIntensity), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return { mesh, intensity: uIntensity, color: uColor };
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
    mat.scaleNode = vec2(size.add(sLen.mul(depth).mul(0.022)), size.mul(0.55)).mul(alive.select(float(1), float(0)));
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
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
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
