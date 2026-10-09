import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, instanceIndex, hash, uv, length, smoothstep, mix, max, min, pow, dot, normalize,
  clamp, attribute, cameraPosition, cross, viewportLinearDepth, linearDepth, cameraNear, cameraFar,
  instancedBufferAttribute, exp, atan, sin, cos, varying,
} from 'three/tsl';
import type { Atmosphere } from '../world/Atmosphere';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Combat effects. Three systems, one draw call each, all animated on the GPU from spawn data the CPU
 * writes into ring buffers (the same pattern as DustPuffs and Sparks):
 *  - Tracers: bright streaks racing from a muzzle to where the round landed (additive ribbons).
 *  - Debris: lit, normal-blended particles: blood droplets and mist, dirt clods, chunks, smoke.
 *  - Flames: additive fire: muzzle stars, fireballs and their glowing cores.
 * Every program exists from boot (warmed with the scene); idle systems skip their draw.
 */

const SOFT = (k: number): N => clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(k), 0, 1);

export class Tracers {
  readonly mesh: THREE.Mesh;
  private readonly N = 64;
  private A: THREE.BufferAttribute;
  private B: THREE.BufferAttribute;
  private C: THREE.BufferAttribute;
  private next = 0;
  private now = 0;
  private last = -99;
  private uTime = uniform(0);

  constructor() {
    const N = this.N, V = N * 4;
    const g = new THREE.BufferGeometry();
    // positions are computed in the vertex shader; this only gives three.js a vertex count and bounds
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
    this.A = new THREE.BufferAttribute(new Float32Array(V * 4).fill(-1e4), 4); // start xyz, spawn time
    this.B = new THREE.BufferAttribute(new Float32Array(V * 4), 4); // end xyz, speed m/s
    this.C = new THREE.BufferAttribute(new Float32Array(V * 4), 4); // corner (0 tail, 1 head), side, width, streak length
    const corner = new Float32Array(V * 2);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = i * 4;
      corner.set([0, -1, 0, 1, 1, -1, 1, 1], v * 2);
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    g.setAttribute('tA', this.A);
    g.setAttribute('tB', this.B);
    g.setAttribute('tC', this.C);
    g.setAttribute('tK', new THREE.BufferAttribute(corner, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const A: N = attribute('tA', 'vec4'), B: N = attribute('tB', 'vec4'), C: N = attribute('tC', 'vec4'), K: N = attribute('tK', 'vec2');
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const age: N = this.uTime.sub(A.w);
    const total: N = length(B.xyz.sub(A.xyz)).max(0.01);
    const dir: N = B.xyz.sub(A.xyz).div(total);
    const head: N = min(total, B.w.mul(age));
    const tail: N = clamp(head.sub(C.w), 0, total);
    const along: N = mix(tail, head, K.x);
    const p: N = A.xyz.add(dir.mul(along));
    const side: N = normalize(cross(dir, p.sub(cameraPosition)));
    // width grows a touch with distance so a far tracer stays a line, not a flicker
    const w: N = C.z.mul(float(1).add(length(p.sub(cameraPosition)).mul(0.012)));
    const alive: N = age.greaterThan(0).and(tail.lessThan(total.sub(0.01)));
    mat.positionNode = alive.select(p.add(side.mul(K.y).mul(w)), vec3(0, -1e4, 0));
    const vK: N = varying(K);
    // a round passing the lens would fill the screen: fade tracers out inside a few metres of the eye
    const camD: N = length(p.sub(cameraPosition));
    const vFade: N = varying(clamp(float(1).sub(age.mul(0.8)), 0, 1).mul(smoothstep(2.0, 9.0, camD)));
    mat.colorNode = Fn(() => {
      const across = float(1).sub(vK.y.mul(vK.y));
      const core = pow(across, 3);
      const grad = pow(vK.x, 1.6); // bright head, fading tail
      const c = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.92, 0.7), core);
      return vec4(c.mul(core.mul(3.2).add(across.mul(0.35))).mul(grad).mul(vFade), 1);
    })();
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 24;
    this.mesh.name = 'tracers';
  }

  /** A round from `a` to `b`. `speed` is visual (m/s); `len` the streak length; `width` in metres. */
  emit(a: THREE.Vector3, b: THREE.Vector3, speed = 320, len = 7, width = 0.022) {
    const j = this.next;
    this.next = (this.next + 1) % this.N;
    const A = this.A.array as Float32Array, B = this.B.array as Float32Array, C = this.C.array as Float32Array;
    for (let v = 0; v < 4; v++) {
      const o = (j * 4 + v) * 4;
      A[o] = a.x; A[o + 1] = a.y; A[o + 2] = a.z; A[o + 3] = this.now;
      B[o] = b.x; B[o + 1] = b.y; B[o + 2] = b.z; B[o + 3] = speed;
      C[o] = 0; C[o + 1] = 0; C[o + 2] = width; C[o + 3] = len;
    }
    this.A.needsUpdate = this.B.needsUpdate = this.C.needsUpdate = true;
    this.last = this.now;
    this.mesh.visible = true;
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
    if (this.now - this.last > 1.5) this.mesh.visible = false;
  }
}

/** Kinds of debris particle (spawn presets). */
export type DebrisKind = 'blood' | 'mist' | 'dirt' | 'dust' | 'chunk' | 'smoke' | 'oil' | 'screen';

const PRESET: Record<DebrisKind, { col: [number, number, number]; a: number; life: number; grav: number; drag: number; grow: number }> = {
  blood: { col: [0.22, 0.015, 0.01], a: 0.95, life: 0.9, grav: 1, drag: 0.6, grow: 0.2 },
  mist: { col: [0.3, 0.03, 0.02], a: 0.55, life: 0.55, grav: 0.05, drag: 4, grow: 2.4 },
  dirt: { col: [0.42, 0.3, 0.19], a: 0.9, life: 1.1, grav: 1, drag: 0.4, grow: 0.1 },
  dust: { col: [0.62, 0.5, 0.36], a: 0.5, life: 1.4, grav: -0.04, drag: 3, grow: 1.6 },
  chunk: { col: [0.16, 0.14, 0.12], a: 1, life: 1.4, grav: 1, drag: 0.2, grow: 0 },
  smoke: { col: [0.2, 0.19, 0.18], a: 0.55, life: 4.5, grav: -0.12, drag: 1.4, grow: 1.1 },
  oil: { col: [0.05, 0.05, 0.05], a: 0.8, life: 2.6, grav: -0.08, drag: 1.2, grow: 0.9 },
  // a smoke screen: thick, pale, slow to rise and slow to thin
  screen: { col: [0.62, 0.62, 0.6], a: 0.8, life: 8.5, grav: -0.02, drag: 1.7, grow: 0.34 },
};

export class Debris {
  readonly sprite: THREE.Sprite;
  private a: THREE.InstancedBufferAttribute; // pos, t0
  private b: THREE.InstancedBufferAttribute; // vel, size
  private c: THREE.InstancedBufferAttribute; // rgb, alpha
  private d: THREE.InstancedBufferAttribute; // life, gravity, drag, grow
  private next = 0;
  private now = 0;
  private last = -99;
  private uTime = uniform(0);
  private uWind = uniform(new THREE.Vector3());

  /** `N`: the ring's size (a smoke screen keeps its own, so blood and dirt can't overwrite it). */
  constructor(private atmo: Atmosphere, private readonly N = 256) {
    // static usage: three re-uploads a DynamicDrawUsage attribute on every draw; these upload on emit
    const mk = (fill = 0) => new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(fill), 4);
    this.a = mk(-1e4); this.b = mk(); this.c = mk(); this.d = mk(1);
    const A: N = instancedBufferAttribute(this.a, 'vec4');
    const B: N = instancedBufferAttribute(this.b, 'vec4');
    const C: N = instancedBufferAttribute(this.c, 'vec4');
    const D: N = instancedBufferAttribute(this.d, 'vec4');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const age: N = this.uTime.sub(A.w);
    const life: N = D.x;
    const alive: N = age.greaterThan(0).and(age.lessThan(life));
    const k: N = D.z.max(0.01);
    const travel: N = B.xyz.mul(float(1).sub(exp(age.mul(k).negate())).div(k));
    const fall: N = float(-9.8).mul(D.y).mul(age.mul(age)).mul(0.5);
    const pos: N = A.xyz.add(travel).add(vec3(0, fall, 0)).add(this.uWind.mul(age.mul(D.w.min(1)).mul(0.6)));
    mat.positionNode = pos;
    const t: N = age.div(life);
    const size: N = B.w.mul(float(1).add(D.w.mul(age))).mul(alive.select(float(1), float(0)));
    mat.scaleNode = vec2(size, size);
    mat.rotationNode = hash(instanceIndex).mul(6.28).add(age.mul(0.4));
    const vT: N = varying(t);
    const vC: N = varying(C);
    const vGrow: N = varying(D.w);
    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const n = noise(p.mul(0.45).add(hash(instanceIndex.add(7)).mul(9))).r.sub(0.5);
      // soft puffs for things that grow (mist, smoke), harder clods for droplets and chunks
      const soft = smoothstep(0.1, 1.5, vGrow);
      const edge = mix(float(0.75), float(0.15), soft);
      const shape = smoothstep(1.0, edge, length(p).add(n.mul(mix(float(0.35), float(0.8), soft))));
      const fade = pow(float(1).sub(vT), mix(float(0.6), float(1.6), soft)).mul(smoothstep(0.0, 0.04, vT.mul(life)));
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      const night = float(1).sub(atmo.uNight.mul(0.8));
      const light = atmo.uHaze.mul(0.55).add(atmo.uSunColor.mul(pow(mu, 3).mul(0.5).add(0.35))).mul(night);
      return vec4(vC.rgb.mul(light).mul(1.6), shape.mul(fade).mul(vC.a).mul(SOFT(0.3)));
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 13;
    this.sprite.name = 'debris';
  }

  /**
   * `n` particles of `kind` from `p`: velocity `dir` (m/s) plus `spread` m/s random, `size` metres.
   * `tint` overrides the preset colour (e.g. the ground's own dust colour).
   */
  emit(kind: DebrisKind, p: THREE.Vector3, n: number, dir: THREE.Vector3 | null, spread: number, size: number, tint?: THREE.Color, lifeMul = 1) {
    const pr = PRESET[kind];
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, C = this.c.array as Float32Array, D = this.d.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % this.N;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = spread * (0.3 + Math.random() * 0.9);
      A[j * 4] = p.x + (Math.random() - 0.5) * 0.05;
      A[j * 4 + 1] = p.y + (Math.random() - 0.5) * 0.05;
      A[j * 4 + 2] = p.z + (Math.random() - 0.5) * 0.05;
      A[j * 4 + 3] = this.now - Math.random() * 0.02;
      B[j * 4] = (dir?.x ?? 0) * (0.6 + Math.random() * 0.6) + s * Math.cos(th) * sp;
      B[j * 4 + 1] = (dir?.y ?? 0) * (0.6 + Math.random() * 0.6) + Math.abs(u) * sp * 0.8;
      B[j * 4 + 2] = (dir?.z ?? 0) * (0.6 + Math.random() * 0.6) + s * Math.sin(th) * sp;
      B[j * 4 + 3] = size * (0.6 + Math.random() * 0.8);
      const c = tint ?? null;
      const jit = 0.85 + Math.random() * 0.3;
      C[j * 4] = (c ? c.r : pr.col[0]) * jit;
      C[j * 4 + 1] = (c ? c.g : pr.col[1]) * jit;
      C[j * 4 + 2] = (c ? c.b : pr.col[2]) * jit;
      C[j * 4 + 3] = pr.a;
      D[j * 4] = pr.life * lifeMul * (0.7 + Math.random() * 0.6);
      D[j * 4 + 1] = pr.grav;
      D[j * 4 + 2] = pr.drag;
      D[j * 4 + 3] = pr.grow;
    }
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = this.d.needsUpdate = true;
    this.last = this.now;
    this.sprite.visible = true;
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
    const w = this.atmo.wind;
    (this.uWind.value as THREE.Vector3).set(w.x, 0, w.y);
    if (this.now - this.last > 6) this.sprite.visible = false;
  }
}

/** Additive fire: 0 = fireball puff, 1 = muzzle star, 2 = flash core. */
export class Flames {
  readonly sprite: THREE.Sprite;
  private readonly N = 128;
  private a: THREE.InstancedBufferAttribute; // pos, t0
  private b: THREE.InstancedBufferAttribute; // vel, size
  private c: THREE.InstancedBufferAttribute; // life, kind, grow, intensity
  private next = 0;
  private now = 0;
  private last = -99;
  private uTime = uniform(0);

  constructor() {
    const N = this.N;
    // static usage: three re-uploads a DynamicDrawUsage attribute on every draw; these upload on emit
    const mk = (fill = 0) => new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(fill), 4);
    this.a = mk(-1e4); this.b = mk(); this.c = mk(1);
    const A: N = instancedBufferAttribute(this.a, 'vec4');
    const B: N = instancedBufferAttribute(this.b, 'vec4');
    const C: N = instancedBufferAttribute(this.c, 'vec4');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const age: N = this.uTime.sub(A.w);
    const life: N = C.x;
    const alive: N = age.greaterThan(0).and(age.lessThan(life));
    const k = float(2.2);
    const travel: N = B.xyz.mul(float(1).sub(exp(age.mul(k).negate())).div(k));
    const pos: N = A.xyz.add(travel).add(vec3(0, age.mul(age).mul(1.2), 0));
    mat.positionNode = pos;
    const t: N = age.div(life);
    const size: N = B.w.mul(float(1).add(C.z.mul(pow(t, 0.5)))).mul(alive.select(float(1), float(0)));
    mat.scaleNode = vec2(size, size);
    mat.rotationNode = hash(instanceIndex).mul(6.28).add(age.mul(1.5));
    const vT: N = varying(t);
    const vC: N = varying(C);
    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const a = atan(p.y, p.x);
      const seed = hash(instanceIndex.add(3)).mul(10);
      const n = noise(p.mul(0.5).add(seed)).r.sub(0.5);
      const kind = vC.y;
      // fireball: a turbulent ball that cools from white-gold to deep red and frays apart
      const ball = smoothstep(1.0, 0.2, r.add(n.mul(0.9)).add(vT.mul(0.35)));
      // muzzle star: a bright core with 4–6 jagged spikes
      const spikes = pow(cos(a.mul(float(5).add(seed.floor().mod(2)))).abs(), 6).mul(smoothstep(1.0, 0.0, r)).mul(0.9);
      const star = smoothstep(0.55, 0.0, r).add(spikes);
      const core = smoothstep(0.7, 0.0, r);
      const shape = mix(mix(ball, star, smoothstep(0.5, 1.0, kind).mul(smoothstep(1.5, 1.0, kind))), core, smoothstep(1.5, 2.0, kind));
      const heat = float(1).sub(vT);
      const col = mix(mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.42, 0.08), smoothstep(0.1, 0.5, heat)), vec3(1.0, 0.9, 0.62), smoothstep(0.6, 1.0, heat));
      const fade = pow(heat, 1.4).mul(smoothstep(0.0, 0.05, vT));
      return vec4(col.mul(shape).mul(fade).mul(vC.w).mul(SOFT(0.6)), 1);
    })();
    void sin;
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = N;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 25;
    this.sprite.name = 'flames';
  }

  emit(kind: 0 | 1 | 2, p: THREE.Vector3, n: number, dir: THREE.Vector3 | null, spread: number, size: number, life: number, grow = 1.5, intensity = 4) {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, C = this.c.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % this.N;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = spread * (0.3 + Math.random() * 0.8);
      A[j * 4] = p.x; A[j * 4 + 1] = p.y; A[j * 4 + 2] = p.z; A[j * 4 + 3] = this.now - Math.random() * 0.01;
      B[j * 4] = (dir?.x ?? 0) + s * Math.cos(th) * sp;
      B[j * 4 + 1] = (dir?.y ?? 0) + u * sp;
      B[j * 4 + 2] = (dir?.z ?? 0) + s * Math.sin(th) * sp;
      B[j * 4 + 3] = size * (0.7 + Math.random() * 0.6);
      C[j * 4] = life * (0.75 + Math.random() * 0.5);
      C[j * 4 + 1] = kind;
      C[j * 4 + 2] = grow;
      C[j * 4 + 3] = intensity;
    }
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = true;
    this.last = this.now;
    this.sprite.visible = true;
  }

  update(dt: number) {
    this.now += dt;
    this.uTime.value = this.now;
    if (this.now - this.last > 3) this.sprite.visible = false;
  }
}
