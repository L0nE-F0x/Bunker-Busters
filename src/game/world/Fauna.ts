import * as THREE from 'three/webgpu';
import { WolfSkins } from './wolfSkin';
import { viewCull } from './kit';
import { SnakeSkins, ScorpionSkins } from './creatureSkins';
import { Plant, FUR, LEAF } from './flora';
import { floraMaterial } from './materials';
import type { Heightfield } from './Heightfield';
import type { AudioEngine, LoopHandle } from '@/engine/audio';
import type { Combat, Hostile, HostileProvider, NoiseKind, RayHit, Damage } from '../combat/Combat';
import { capsuleRay, sphereRay } from '../combat/Combat';

/**
 * The desert's wildlife: vultures on the thermals, ravens on the poles and wrecks, jackrabbits,
 * lizards, butterflies down in the wash, flies over the wrecks, and a wolf pack that hunts you.
 * Everything else is shy of you. The wolves are not: they track you by noise and scent, stalk,
 * circle and take turns lunging in, flinch from torchlight and fire, and break when they lose
 * enough of the pack (see Pack).
 *
 * Every animal is a rig of rigid procedural parts posed on the CPU each frame and written into ONE
 * shared mesh (the plant material: per-vertex colour), so the whole menagerie costs one draw and
 * one shadow draw, and no shader is new. Creatures far away or not around are collapsed to nothing.
 */

type RGB = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
let _seed = 4711;
const r = () => ((_seed = (_seed * 16807) % 2147483647) / 2147483647);

// ------------------------------------------------------------------ rigs

interface PartDef { parent: number; pivot: THREE.Vector3; pos: Float32Array; nrm: Float32Array; col: Uint8Array; idx: Uint32Array }

/** A creature's parts, each authored around its own pivot (in its parent's frame). +z forward. */
class Rig {
  parts: PartDef[] = [];
  verts = 0;
  tris = 0;
  add(parent: number, pivot: [number, number, number], build: (P: Plant) => void, shade?: (p: THREE.Vector3, c: RGB) => RGB) {
    const P = new Plant();
    build(P);
    if (shade) {
      // recolour by local position (a dark saddle, a pale belly)
      const v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.set(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]);
        const c = shade(v, [Math.pow(P.col[i * 4], 1 / 2.2), Math.pow(P.col[i * 4 + 1], 1 / 2.2), Math.pow(P.col[i * 4 + 2], 1 / 2.2)]);
        P.col[i * 4] = Math.pow(c[0], 2.2); P.col[i * 4 + 1] = Math.pow(c[1], 2.2); P.col[i * 4 + 2] = Math.pow(c[2], 2.2);
      }
    }
    const k = P.pack();
    this.parts.push({ parent, pivot: V(...pivot), ...k });
    this.verts += k.pos.length / 3;
    this.tris += k.idx.length / 3;
    return this.parts.length - 1;
  }
}

/** Blend between colours by a smooth step of `x` over [a, b]. */
const ramp = (x: number, a: number, b: number, c0: RGB, c1: RGB): RGB => {
  const t = clamp((x - a) / (b - a), 0, 1), k = t * t * (3 - 2 * t);
  return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
};

function birdRig(o: { body: RGB; wing: RGB; head: RGB; beak: RGB; span: number; fingers: boolean; headScale?: number }) {
  const R = new Rig();
  const body = R.add(-1, [0, 0, 0], (P) => P.blob(V(0, 0, 0), V(0.075, 0.07, 0.17), 1, o.body, FUR, r, 0.1));
  const hs = o.headScale ?? 1;
  const head = R.add(body, [0, 0.035, 0.14], (P) => {
    P.blob(V(0, 0.02, 0.035), V(0.048, 0.05, 0.06).multiplyScalar(hs), 1, o.head, FUR, r, 0.05);
    P.spike(V(0, 0.015, 0.085), V(0, -0.2, 1), 0.07, 0.014, o.beak, o.beak, FUR);
  });
  R.add(body, [0, 0.01, -0.14], (P) => P.blob(V(0, 0, -0.08), V(0.055, 0.012, 0.1), 0, o.wing, FUR, r, 0.05));
  const wings: number[] = [];
  for (const side of [1, -1]) {
    const inner = R.add(body, [side * 0.05, 0.03, 0.03], (P) => P.blob(V(side * 0.13 * o.span, 0, -0.02), V(0.14 * o.span, 0.012, 0.075), 1, o.wing, FUR, r, 0.05));
    const outer = R.add(inner, [side * 0.26 * o.span, 0, -0.005], (P) => {
      P.blob(V(side * 0.08 * o.span, 0, -0.025), V(0.1 * o.span, 0.01, 0.06), 0, o.wing, FUR, r, 0.05);
      // primaries: splayed fingers on a soaring bird, a closed tip on a crow
      const n = o.fingers ? 5 : 3;
      for (let k = 0; k < n; k++) P.spike(V(side * 0.12 * o.span, 0, -0.03 - k * 0.012), V(side, 0, -0.12 - k * 0.12), (o.fingers ? 0.16 : 0.12) * o.span, 0.018, o.wing, o.wing, FUR);
    });
    wings.push(inner, outer);
  }
  const legs = R.add(body, [0, -0.06, 0.02], (P) => {
    for (const s of [-1, 1]) P.tube([V(s * 0.025, 0, 0), V(s * 0.03, -0.06, 0.01)], [0.007, 0.006], 3, () => [0.12, 0.11, 0.1], FUR);
  });
  return { R, body, head, wings, legs };
}

function rabbitRig() {
  const tan: RGB = [0.58, 0.49, 0.38], pale: RGB = [0.82, 0.76, 0.66], dark: RGB = [0.16, 0.13, 0.11];
  const R = new Rig();
  const fur = (p: THREE.Vector3, c: RGB): RGB => ramp(p.y, -0.07, -0.02, pale, ramp(p.y, 0.03, 0.09, c, [c[0] * 0.8, c[1] * 0.78, c[2] * 0.75]));
  const body = R.add(-1, [0, 0, 0], (P) => P.blob(V(0, 0, 0), V(0.1, 0.105, 0.19), 1, tan, FUR, r, 0.06), fur);
  const head = R.add(body, [0, 0.06, 0.16], (P) => {
    P.blob(V(0, 0.03, 0.05), V(0.058, 0.062, 0.085), 1, tan, FUR, r, 0.05);
    for (const s of [-1, 1]) P.blob(V(s * 0.042, 0.05, 0.08), V(0.012, 0.014, 0.012), 0, dark, FUR, r, 0);
  });
  const ears = [-1, 1].map((s) => R.add(head, [s * 0.025, 0.07, 0.025], (P) => P.blob(V(0, 0.11, 0), V(0.026, 0.12, 0.01), 1, tan, FUR, r, 0.05), (p, c) => ramp(p.y, 0.16, 0.21, c, dark)));
  const front = [-1, 1].map((s) => R.add(body, [s * 0.045, -0.05, 0.12], (P) => P.tube([V(0, 0, 0), V(0, -0.09, 0.015), V(0, -0.11, 0.035)], [0.016, 0.013, 0.01], 4, () => tan, FUR)));
  const hind = [-1, 1].map((s) => R.add(body, [s * 0.07, -0.01, -0.1], (P) => P.blob(V(0, -0.03, 0.02), V(0.04, 0.075, 0.085), 1, tan, FUR, r, 0.05), fur));
  const feet = hind.map((h) => R.add(h, [0, -0.09, 0.0], (P) => P.blob(V(0, -0.005, 0.05), V(0.022, 0.016, 0.085), 0, pale, FUR, r, 0.05)));
  R.add(body, [0, 0.02, -0.19], (P) => P.blob(V(0, 0, -0.01), V(0.035, 0.035, 0.03), 0, [0.9, 0.88, 0.84], FUR, r, 0.1));
  return { R, body, head, ears, front, hind, feet };
}

function lizardRig() {
  const c0: RGB = [0.6, 0.52, 0.4], spot: RGB = [0.35, 0.28, 0.2];
  const R = new Rig();
  const spotted = (p: THREE.Vector3, c: RGB): RGB => (Math.sin(p.x * 140) * Math.sin(p.z * 90) > 0.55 ? spot : c);
  const body = R.add(-1, [0, 0.02, 0], (P) => P.blob(V(0, 0, 0), V(0.032, 0.017, 0.085), 1, c0, FUR, r, 0.05), spotted);
  R.add(body, [0, 0.004, 0.08], (P) => P.blob(V(0, 0, 0.03), V(0.022, 0.014, 0.035), 0, c0, FUR, r, 0.05));
  const tail: number[] = [];
  let parent = body;
  for (let k = 0; k < 3; k++) {
    const rr = 0.014 * (1 - k * 0.3);
    parent = R.add(parent, [0, 0, k === 0 ? -0.08 : -0.07], (P) => P.tube([V(0, 0, 0), V(0, 0, -0.07)], [rr, rr * 0.7], 4, () => c0, FUR), spotted);
    tail.push(parent);
  }
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => R.add(body, [sx * 0.025, -0.004, sz * 0.045], (P) => P.spike(V(0, 0, 0), V(sx, -0.6, sz * 0.4), 0.045, 0.008, c0, c0, FUR)));
  return { R, body, tail, legs };
}

function wolfRig() {
  const coat: RGB = [0.56, 0.5, 0.42], saddle: RGB = [0.3, 0.27, 0.23], belly: RGB = [0.78, 0.73, 0.64], dark: RGB = [0.1, 0.09, 0.08];
  const fur = (p: THREE.Vector3, c: RGB): RGB => ramp(p.y, -0.12, -0.04, belly, ramp(p.y, 0.06, 0.16, c, saddle));
  const R = new Rig();
  const torso = R.add(-1, [0, 0, 0], (P) => {
    P.blob(V(0, 0.01, 0.2), V(0.16, 0.2, 0.3), 1, coat, FUR, r, 0.06);
    P.blob(V(0, 0.03, -0.22), V(0.135, 0.165, 0.28), 1, coat, FUR, r, 0.06);
    P.blob(V(0, 0.1, 0.3), V(0.13, 0.12, 0.16), 1, coat, FUR, r, 0.1); // ruff
  }, fur);
  const neck = R.add(torso, [0, 0.1, 0.4], (P) => P.blob(V(0, 0.06, 0.06), V(0.085, 0.11, 0.12), 1, coat, FUR, r, 0.08), fur);
  const head = R.add(neck, [0, 0.12, 0.12], (P) => {
    P.blob(V(0, 0.02, 0.03), V(0.08, 0.085, 0.1), 1, coat, FUR, r, 0.06);
    P.blob(V(0, -0.015, 0.13), V(0.042, 0.042, 0.1), 1, coat, FUR, r, 0.04);
    P.blob(V(0, -0.005, 0.225), V(0.018, 0.016, 0.014), 0, dark, FUR, r, 0);
    for (const s of [-1, 1]) {
      P.spike(V(s * 0.045, 0.07, -0.01), V(s * 0.3, 1, -0.15), 0.085, 0.035, coat, saddle, FUR);
      P.blob(V(s * 0.04, 0.035, 0.09), V(0.01, 0.009, 0.008), 0, [0.7, 0.55, 0.15], LEAF, r, 0);
    }
  }, (p, c) => ramp(p.y, -0.06, -0.02, belly, ramp(p.y, 0.03, 0.09, c, saddle)));
  const tail = R.add(torso, [0, 0.1, -0.46], (P) => {
    P.tube([V(0, 0, 0), V(0, -0.06, -0.15), V(0, -0.2, -0.3), V(0, -0.36, -0.36)], [0.04, 0.06, 0.055, 0.0], 6, () => coat, FUR);
  }, (p, c) => ramp(p.y, -0.24, -0.34, c, dark));
  // legs: shoulder/hip → elbow/hock → paw
  const legs: { upper: number; lower: number; hind: boolean }[] = [];
  for (const [sx, sz, hind] of [[1, 0.3, false], [-1, 0.3, false], [1, -0.32, true], [-1, -0.32, true]] as [number, number, boolean][]) {
    const upper = R.add(torso, [sx * 0.085, -0.03, sz], (P) => hind
      ? P.blob(V(0, -0.12, 0.02), V(0.06, 0.16, 0.085), 1, coat, FUR, r, 0.05)
      : P.tube([V(0, 0.02, 0), V(0, -0.26, 0)], [0.05, 0.035], 6, () => coat, FUR));
    const lower = R.add(upper, [0, hind ? -0.25 : -0.26, hind ? 0.02 : 0], (P) => {
      P.tube([V(0, 0, 0), V(0, -0.3, 0)], [hind ? 0.032 : 0.03, 0.022], 5, () => coat, FUR);
      P.blob(V(0, -0.31, 0.03), V(0.034, 0.02, 0.05), 0, saddle, FUR, r, 0.05);
    });
    legs.push({ upper, lower, hind });
  }
  return { R, torso, neck, head, tail, legs };
}

function butterflyRig(c: RGB) {
  const R = new Rig();
  const body = R.add(-1, [0, 0, 0], (P) => P.tube([V(0, 0, 0.02), V(0, 0, -0.025)], [0.004, 0.003], 3, () => [0.1, 0.08, 0.06], FUR));
  const wings = [1, -1].map((s) => R.add(body, [0, 0, 0], (P) => {
    P.blob(V(s * 0.022, 0, 0.008), V(0.022, 0.0015, 0.018), 0, c, LEAF, r, 0.1);
    P.blob(V(s * 0.016, 0, -0.016), V(0.015, 0.0015, 0.013), 0, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], LEAF, r, 0.1);
  }));
  return { R, body, wings };
}

function fliesRig(n: number) {
  const R = new Rig();
  const root = R.add(-1, [0, 0, 0], () => undefined);
  const flies: number[] = [];
  for (let i = 0; i < n; i++) flies.push(R.add(root, [0, 0, 0], (P) => P.blob(V(0, 0, 0), V(0.006, 0.005, 0.009), 0, [0.05, 0.05, 0.06], FUR, r, 0)));
  return { R, flies };
}

function snakeRig() {
  const tan: RGB = [0.62, 0.52, 0.38], dia: RGB = [0.3, 0.24, 0.17], belly: RGB = [0.78, 0.7, 0.56];
  // diamonds down the back, pale belly
  const skin = (p: THREE.Vector3, c: RGB): RGB => (p.y < -0.005 ? belly : Math.sin(p.z * 70) * Math.sin(p.x * 120 + 1) > 0.25 ? dia : c);
  const R = new Rig();
  const segs: number[] = [];
  let parent = -1;
  const n = 10, L = 0.11;
  for (let k = 0; k < n; k++) {
    const r0 = 0.036 * (1 - Math.abs(k - 3) / 9), r1 = r0 * 0.94;
    parent = R.add(parent, [0, 0, k === 0 ? 0 : -L], (P) => P.tube([V(0, 0, 0), V(0, 0, -L)], [r0, r1], 6, () => tan, FUR), skin);
    segs.push(parent);
  }
  // the rattle on the last segment
  R.add(parent, [0, 0, -L], (P) => { for (let i = 0; i < 4; i++) P.blob(V(0, 0, -i * 0.012), V(0.011, 0.008, 0.008), 0, [0.7, 0.6, 0.42], FUR, r, 0); });
  // head on the first, facing +z
  const head = R.add(segs[0], [0, 0, 0], (P) => {
    P.blob(V(0, 0.006, 0.04), V(0.038, 0.022, 0.055), 1, tan, FUR, r, 0.05);
    for (const s of [-1, 1]) P.blob(V(s * 0.022, 0.016, 0.06), V(0.006, 0.006, 0.006), 0, [0.08, 0.06, 0.04], LEAF, r, 0);
  }, skin);
  return { R, segs, head };
}

function scorpionRig() {
  const c: RGB = [0.68, 0.56, 0.32], dk: RGB = [0.42, 0.32, 0.18];
  const R = new Rig();
  const body = R.add(-1, [0, 0.025, 0], (P) => P.blob(V(0, 0, 0), V(0.028, 0.012, 0.05), 1, c, FUR, r, 0.05));
  const tail: number[] = [];
  let parent = body;
  for (let k = 0; k < 5; k++) {
    parent = R.add(parent, [0, 0.004, k === 0 ? -0.045 : -0.022], (P) => P.blob(V(0, 0, -0.011), V(0.01 - k * 0.0012, 0.009, 0.013), 0, k === 4 ? dk : c, FUR, r, 0));
    tail.push(parent);
  }
  const sting = R.add(parent, [0, 0, -0.022], (P) => P.spike(V(0, 0, 0), V(0, -0.4, -1), 0.02, 0.006, dk, [0.1, 0.06, 0.03], FUR));
  const claws = [-1, 1].map((sx) => R.add(body, [sx * 0.02, 0, 0.04], (P) => {
    P.tube([V(0, 0, 0), V(sx * 0.02, 0, 0.025), V(sx * 0.012, 0, 0.05)], [0.005, 0.005, 0.004], 4, () => c, FUR);
    P.blob(V(sx * 0.012, 0, 0.06), V(0.009, 0.006, 0.014), 0, c, FUR, r, 0);
  }));
  const legs = [[1, 0.02], [-1, 0.02], [1, 0], [-1, 0], [1, -0.02], [-1, -0.02]].map(([sx, z]) => R.add(body, [sx * 0.022, 0, z], (P) => P.spike(V(0, 0, 0), V(sx, -0.7, 0.2), 0.035, 0.004, c, dk, FUR)));
  return { R, body, tail, sting, claws, legs };
}

// ------------------------------------------------------------------ the shared mesh

/** One posed creature: a slice of the shared buffers. */
class Body {
  readonly local: THREE.Matrix4[];
  readonly world: THREE.Matrix4[];
  readonly root = new THREE.Matrix4();
  visible = false;
  private wasVisible = true;
  /** How many vertices this body owns in the shared buffers (from `v0`). */
  readonly count: number;
  constructor(readonly rig: Rig, readonly v0: number) {
    this.local = rig.parts.map(() => new THREE.Matrix4());
    this.world = rig.parts.map(() => new THREE.Matrix4());
    this.count = rig.parts.reduce((n, p) => n + p.pos.length / 3, 0);
  }
  private static _q = new THREE.Quaternion();
  private static _e = new THREE.Euler(0, 0, 0, 'YXZ');
  private static _one = new THREE.Vector3(1, 1, 1);
  private static _nm = new THREE.Matrix3();
  /** Set part `i`'s local rotation (pivot fixed). */
  pose(i: number, rx = 0, ry = 0, rz = 0, offset?: THREE.Vector3) {
    const p = this.rig.parts[i].pivot;
    Body._e.set(rx, ry, rz);
    const pos = offset ? p.clone().add(offset) : p;
    this.local[i].compose(pos, Body._q.setFromEuler(Body._e), Body._one);
  }
  place(pos: THREE.Vector3, yaw: number, pitch = 0, roll = 0, scale = 1) {
    Body._e.set(pitch, yaw, roll);
    this.root.compose(pos, Body._q.setFromEuler(Body._e), V(scale, scale, scale));
  }
  /** A Meshy model draws this creature (creatureSkins.ts): solve the part matrices, draw nothing. */
  ghost = false;
  private collapsed = false;
  /** World matrices of every part (as `write` computes them), without touching the vertices. */
  solve() {
    const parts = this.rig.parts;
    for (let k = 0; k < parts.length; k++) this.world[k].multiplyMatrices(parts[k].parent < 0 ? this.root : this.world[parts[k].parent], this.local[k]);
  }
  /** Write the posed vertices. Returns false when nothing needed writing. */
  write(P: Float32Array, N: Float32Array) {
    if (this.ghost) {
      if (this.visible) this.solve();
      if (this.collapsed) return false;
      this.collapsed = true;
      let v = this.v0;
      for (const part of this.rig.parts) for (let i = 0; i < part.pos.length; i += 3, v++) { P[v * 3] = 0; P[v * 3 + 1] = -5000; P[v * 3 + 2] = 0; }
      return true;
    }
    if (!this.visible) {
      if (!this.wasVisible) return false;
      this.wasVisible = false;
      // collapse to a point far below the world
      let v = this.v0;
      for (const part of this.rig.parts) for (let i = 0; i < part.pos.length; i += 3, v++) { P[v * 3] = 0; P[v * 3 + 1] = -5000; P[v * 3 + 2] = 0; }
      return true;
    }
    this.wasVisible = true;
    const parts = this.rig.parts;
    let v = this.v0;
    const nm = Body._nm;
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      const w = this.world[k];
      w.multiplyMatrices(part.parent < 0 ? this.root : this.world[part.parent], this.local[k]);
      const e = w.elements;
      nm.setFromMatrix4(w);
      const n = nm.elements;
      const { pos, nrm } = part;
      for (let i = 0; i < pos.length; i += 3, v++) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        P[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        P[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        P[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = nrm[i], b = nrm[i + 1], c = nrm[i + 2];
        let nx = n[0] * a + n[3] * b + n[6] * c, ny = n[1] * a + n[4] * b + n[7] * c, nz = n[2] * a + n[5] * b + n[8] * c;
        // (sqrt, not Math.hypot: hypot boxed every double here, ~110 KB of garbage a frame)
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l; ny /= l; nz /= l;
        N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
      }
    }
    return true;
  }
}

// ------------------------------------------------------------------ creatures

interface Ctx { hf: Heightfield; player: THREE.Vector3; hour: number; dt: number; t: number; audio?: AudioEngine; sprinting: boolean; combat?: Combat; safe: { p: THREE.Vector3; r: number }[]; camFwd?: THREE.Vector3 }
const DAY = (h: number) => h > 6.8 && h < 18.6;

/**
 * A vulture: soaring thermals by day, or, once something has died out here, circling over it, lower
 * with every lap, then spiralling down to feed on the ground beside it, head bobbing, the odd wing
 * flared at a rival. Come close (or fire a shot) and they labour back up into the circle.
 */
class Vulture {
  center = new THREE.Vector3();
  ang = Math.random() * 6.28;
  R = rnd(22, 40);
  alt = rnd(42, 70);
  dir = Math.random() < 0.5 ? 1 : -1;
  flapT = rnd(4, 12);
  flap = 0;
  repick = 0;
  state: 'soar' | 'circle' | 'land' | 'feed' | 'up' = 'soar';
  readonly pos = new THREE.Vector3(0, -999, 0);
  private readonly prev = new THREE.Vector3();
  private stateT = 0;
  private wantAlt = 50;
  readonly spot = new THREE.Vector3();
  private phase = Math.random() * 6;
  private flare = 0;
  private yaw = 0;
  /** Something with a shot or a sprint nearby spooks it (set by Fauna). */
  spook = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof birdRig>, readonly k: number) {}
  update(c: Ctx, carcass: THREE.Vector3 | null) {
    const active = DAY(c.hour);
    this.b.visible = active;
    if (!active) { this.repick = 0; this.state = 'soar'; this.pos.y = -999; return; }
    this.stateT += c.dt;
    this.spook = Math.max(0, this.spook - c.dt);
    const near = (p: THREE.Vector3) => Math.hypot(p.x - c.player.x, p.z - c.player.z);
    // a kill: over to it and circle, lower each lap
    if (carcass && (this.state === 'soar' || (this.state === 'circle' && this.center.distanceToSquared(carcass) > 4))) {
      this.state = 'circle';
      this.stateT = 0;
      this.center.copy(carcass);
      this.R = 9 + this.k * 4.5 + Math.random() * 3;
      this.wantAlt = 30 + this.k * 7;
    }
    if (!carcass && this.state !== 'soar' && this.state !== 'up') { this.state = 'soar'; this.repick = 0; this.wantAlt = rnd(42, 70); }
    if (this.state === 'soar') {
      if ((this.repick -= c.dt) <= 0 || this.center.distanceTo(c.player) > 260) {
        this.repick = rnd(50, 110);
        const a = Math.random() * 6.28, d = rnd(40, 160);
        this.center.set(c.player.x + Math.cos(a) * d, 0, c.player.z + Math.sin(a) * d);
        this.wantAlt = rnd(42, 70);
      }
    }
    const scare = near(this.center) < (c.sprinting ? 34 : 24) || this.spook > 0;
    if (this.state === 'circle') {
      this.wantAlt = Math.max(16 + this.k * 4, this.wantAlt - c.dt * 0.35);
      // after a while, with nobody close, down they go (the first one first)
      if (this.stateT > 22 + this.k * 9 && !scare) {
        this.state = 'land';
        this.stateT = 0;
        const a = this.k * 2.1 + Math.random() * 0.8;
        this.spot.set(this.center.x + Math.cos(a) * rnd(1.6, 2.6), 0, this.center.z + Math.sin(a) * rnd(1.6, 2.6));
        this.spot.y = c.hf.heightAt(this.spot.x, this.spot.z);
      }
    }
    if ((this.state === 'land' || this.state === 'feed') && scare) {
      this.state = 'up';
      this.stateT = 0;
      c.audio?.play('flap', { pos: this.pos, intensity: 1 });
    }
    if (this.state === 'up' && this.pos.y - c.hf.heightAt(this.pos.x, this.pos.z) > 14) { this.state = carcass ? 'circle' : 'soar'; this.stateT = 0; this.wantAlt = 32 + this.k * 6; }

    this.prev.copy(this.pos);
    const [li, lo, ri, ro] = this.rig.wings;
    const ground = c.hf.heightAt(this.center.x, this.center.z);
    if (this.state === 'soar' || this.state === 'circle') {
      this.alt += (this.wantAlt - this.alt) * Math.min(1, c.dt * 0.25);
      this.ang += (this.dir * c.dt * (this.state === 'circle' ? 6 : 7)) / this.R;
      const tx = this.center.x + Math.cos(this.ang) * this.R, tz = this.center.z + Math.sin(this.ang) * this.R;
      const ty = ground + this.alt + Math.sin(this.ang * 0.5 + this.R) * 3;
      // glide over from wherever it was (a new circle, a lift-off) rather than jump there
      if (this.pos.y < -900) this.pos.set(tx, ty, tz);
      else this.pos.lerp(V(tx, ty, tz), Math.min(1, c.dt * 0.7));
      this.yaw = Math.atan2(-Math.sin(this.ang) * this.dir, Math.cos(this.ang) * this.dir);
      if ((this.flapT -= c.dt) <= 0) { this.flapT = rnd(8, 18); this.flap = 2.2; }
      this.flap = Math.max(0, this.flap - c.dt);
      const beat = this.flap > 0 ? Math.sin(c.t * 6) * 0.45 : 0;
      this.b.place(this.pos, this.yaw, 0, -this.dir * 0.32, 2.4);
      this.b.pose(li, 0, 0, 0.12 + beat); this.b.pose(lo, 0, 0, 0.06 + beat * 0.5);
      this.b.pose(ri, 0, 0, -0.12 - beat); this.b.pose(ro, 0, 0, -0.06 - beat * 0.5);
      this.b.pose(this.rig.head, 0.15, Math.sin(c.t * 0.7 + this.R) * 0.4, 0);
      this.b.pose(this.rig.legs, 1.4, 0, 0);
      return;
    }
    if (this.state === 'land') {
      // a spiral down onto the spot, wings wide and cupped, legs out at the end
      const u = Math.min(1, this.stateT / 7);
      const r = 6 * (1 - u);
      const a = this.ang + this.stateT * 0.9 * this.dir;
      const t = V(this.spot.x + Math.cos(a) * r, this.spot.y + 0.3 + (1 - u * u) * 14, this.spot.z + Math.sin(a) * r);
      this.pos.lerp(t, Math.min(1, c.dt * 2.5));
      const v = _vv.subVectors(this.pos, this.prev);
      if (v.x * v.x + v.z * v.z > 1e-6) this.yaw = Math.atan2(v.x, v.z);
      const flare = u > 0.8 ? Math.sin(c.t * 9) * 0.5 : 0;
      this.b.place(this.pos, this.yaw, -0.25 * u, 0, 2.4);
      this.b.pose(li, 0, 0, 0.25 + flare); this.b.pose(lo, 0, 0, 0.15 + flare * 0.5);
      this.b.pose(ri, 0, 0, -0.25 - flare); this.b.pose(ro, 0, 0, -0.15 - flare * 0.5);
      this.b.pose(this.rig.head, 0.3, 0, 0);
      this.b.pose(this.rig.legs, 1.4 - u * 1.4, 0, 0);
      if (u >= 1 && this.pos.distanceTo(t) < 0.4) {
        this.state = 'feed';
        this.stateT = 0;
        // touchdown: wings beat the dust up
        if (near(this.pos) < 120) c.combat?.puffs?.emit(this.pos, 5, 0.9, 0.35, 0.45);
      }
      return;
    }
    if (this.state === 'feed') {
      // hunched over the kill: head down and tugging, now and then a hop and a flared wing
      this.pos.set(this.spot.x, this.spot.y + 0.3, this.spot.z);
      this.yaw = Math.atan2(this.center.x - this.spot.x, this.center.z - this.spot.z) + Math.sin(c.t * 0.3 + this.k) * 0.4;
      if (Math.random() < c.dt * 0.15) this.flare = 1;
      this.flare = Math.max(0, this.flare - c.dt * 1.4);
      const fl = Math.sin(this.flare * Math.PI) * 1.1;
      const hop = this.flare > 0 ? Math.sin(this.flare * Math.PI) * 0.18 : 0;
      this.b.place(V(this.pos.x, this.pos.y + hop, this.pos.z), this.yaw, 0.08, 0, 2.2);
      this.b.pose(li, -0.05, 1.4 - fl, 0.15 + fl * 0.6); this.b.pose(lo, 0, 0.2 - fl * 0.3, 0);
      this.b.pose(ri, -0.05, -1.4 + fl, -0.15 - fl * 0.6); this.b.pose(ro, 0, -0.2 + fl * 0.3, 0);
      const tug = Math.max(0, Math.sin(c.t * 2.2 + this.k * 2));
      this.b.pose(this.rig.head, 0.45 + tug * 0.35, Math.sin(c.t * 1.3 + this.k) * 0.3, 0);
      this.b.pose(this.rig.legs, 0, 0, 0);
      return;
    }
    // up: heavy beats, climbing away from you
    this.phase += c.dt * 7;
    const away = _vv.set(this.pos.x - c.player.x, 0, this.pos.z - c.player.z).normalize();
    this.pos.addScaledVector(away, c.dt * 5).setY(this.pos.y + c.dt * 3.2);
    this.yaw = Math.atan2(away.x, away.z);
    const a = Math.sin(this.phase);
    this.b.place(this.pos, this.yaw, -0.2, 0, 2.4);
    this.b.pose(li, 0, 0, a * 0.8); this.b.pose(lo, 0, 0, Math.sin(this.phase - 0.8) * 0.45);
    this.b.pose(ri, 0, 0, -a * 0.8); this.b.pose(ro, 0, 0, -Math.sin(this.phase - 0.8) * 0.45);
    this.b.pose(this.rig.head, 0, 0, 0);
    this.b.pose(this.rig.legs, 0.9, 0, 0);
  }
}
const _vv = new THREE.Vector3();
const _wz = new THREE.Vector3(), _wz2 = new THREE.Vector3();

class Raven {
  state: 'perch' | 'fly' | 'gone' = 'gone';
  /** A shot nearby: off the perch now. */
  startle = false;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  wait = rnd(2, 10);
  cawT = rnd(4, 16);
  look = 0;
  lookT = 0;
  phase = Math.random() * 6;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof birdRig>, readonly perches: THREE.Vector3[], readonly taken: Set<THREE.Vector3>) {}
  private perch: THREE.Vector3 | null = null;
  update(c: Ctx) {
    if (this.state === 'gone') {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !this.perches.length) return;
      // a free perch between 25 and 110 m away
      for (let k = 0; k < 12; k++) {
        const p = this.perches[Math.floor(Math.random() * this.perches.length)];
        const d = Math.hypot(p.x - c.player.x, p.z - c.player.z);
        if (d < 25 || d > 110 || this.taken.has(p)) continue;
        this.perch = p;
        this.taken.add(p);
        this.pos.copy(p).add(V(0, 0.15, 0));
        this.yaw = Math.random() * 6.28;
        this.state = 'perch';
        return;
      }
      this.wait = 2;
      return;
    }
    const d = Math.hypot(this.pos.x - c.player.x, this.pos.z - c.player.z);
    if (this.state === 'perch') {
      this.b.visible = d < 160;
      if (d < (c.sprinting ? 16 : 10) || this.startle) {
        // spooked: up and away from you
        this.startle = false;
        this.state = 'fly';
        const away = V(this.pos.x - c.player.x, 0, this.pos.z - c.player.z).normalize();
        away.applyAxisAngle(V(0, 1, 0), rnd(-0.6, 0.6));
        this.vel.copy(away).multiplyScalar(5).setY(4);
        if (this.perch) this.taken.delete(this.perch);
        this.perch = null;
        c.audio?.play('flap', { pos: this.pos, intensity: 0.8 });
        if (Math.random() < 0.7) c.audio?.play('caw', { pos: this.pos });
      } else if ((this.cawT -= c.dt) <= 0) {
        this.cawT = rnd(9, 28);
        if (d < 70) c.audio?.play('caw', { pos: this.pos, intensity: 0.7 });
      }
      if ((this.lookT -= c.dt) <= 0) { this.lookT = rnd(0.6, 3); this.look = rnd(-1.2, 1.2); }
      this.b.place(this.pos, this.yaw, 0, 0, 1.35);
      const [li, lo, ri, ro] = this.rig.wings;
      this.b.pose(li, -0.05, 1.4, 0.15); this.b.pose(lo, 0, 0.2, 0);
      this.b.pose(ri, -0.05, -1.4, -0.15); this.b.pose(ro, 0, -0.2, 0);
      this.b.pose(this.rig.head, 0.1, this.look, 0);
      this.b.pose(this.rig.legs, 0, 0, 0);
      return;
    }
    // flying: climb, then level off and glide away with bursts of beats
    this.b.visible = true;
    const ground = c.hf.heightAt(this.pos.x, this.pos.z);
    const climb = this.pos.y - ground < 22;
    this.vel.y = lerp(this.vel.y, climb ? 3.5 : 0.2, c.dt);
    const h = V(this.vel.x, 0, this.vel.z);
    const sp = Math.min(9, h.length() + c.dt * 2);
    h.setLength(sp);
    this.vel.x = h.x; this.vel.z = h.z;
    this.pos.addScaledVector(this.vel, c.dt);
    this.yaw = Math.atan2(this.vel.x, this.vel.z);
    this.phase += c.dt * (climb ? 16 : 11);
    const a = Math.sin(this.phase);
    this.b.place(this.pos, this.yaw, -this.vel.y * 0.05, 0, 1.35);
    const [li, lo, ri, ro] = this.rig.wings;
    this.b.pose(li, 0, 0, a * 0.9); this.b.pose(lo, 0, 0, Math.sin(this.phase - 0.8) * 0.5);
    this.b.pose(ri, 0, 0, -a * 0.9); this.b.pose(ro, 0, 0, -Math.sin(this.phase - 0.8) * 0.5);
    this.b.pose(this.rig.head, 0, 0, 0);
    this.b.pose(this.rig.legs, 1.2, 0, 0);
    if (d > 120) { this.state = 'gone'; this.wait = rnd(15, 50); }
  }
}

/** Somewhere on open ground `d0..d1` m from the player, or null. */
function openSpot(c: Ctx, d0: number, d1: number, clear = 4) {
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * 6.28, d = rnd(d0, d1);
    const x = c.player.x + Math.cos(a) * d, z = c.player.z + Math.sin(a) * d;
    const lim = c.hf.size * 0.44;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (c.hf.zoneDistance(x, z) < clear || c.hf.roadDistanceAt(x, z) < 3 || c.hf.normalAt(x, z).y < 0.85) continue;
    return V(x, c.hf.heightAt(x, z), z);
  }
  return null;
}

class Rabbit {
  state: 'gone' | 'idle' | 'hop' | 'flee' = 'gone';
  startle = false;
  pos = new THREE.Vector3();
  yaw = 0;
  wait = rnd(3, 20);
  hopU = 0;
  hops = 0;
  speed = 0;
  twitch = 0;
  earT = 0;
  from = new THREE.Vector3();
  to = new THREE.Vector3();
  constructor(readonly b: Body, readonly rig: ReturnType<typeof rabbitRig>) {}
  private startHop(c: Ctx, dir: number, len: number, speed: number) {
    this.yaw = dir;
    this.from.copy(this.pos);
    this.to.set(this.pos.x + Math.sin(dir) * len, 0, this.pos.z + Math.cos(dir) * len);
    if (c.hf.zoneDistance(this.to.x, this.to.z) < 1) this.to.copy(this.pos);
    this.to.y = c.hf.heightAt(this.to.x, this.to.z);
    this.hopU = 0;
    this.speed = speed / Math.max(0.3, len);
  }
  update(c: Ctx) {
    if (this.state === 'gone') {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !DAY(c.hour + 1.5)) return;
      const p = openSpot(c, 22, 60);
      if (!p) { this.wait = 3; return; }
      this.pos.copy(p);
      this.yaw = Math.random() * 6.28;
      this.state = 'idle';
      this.wait = rnd(2, 6);
      return;
    }
    const d = Math.hypot(this.pos.x - c.player.x, this.pos.z - c.player.z);
    this.b.visible = d < 120;
    if (this.state !== 'flee' && (d < (c.sprinting ? 22 : 13) || this.startle)) {
      this.startle = false;
      this.state = 'flee';
      this.hops = 0;
      if (d < 30) c.audio?.play('scurry', { pos: this.pos, intensity: 1 });
    }
    if (this.state === 'idle') {
      if ((this.wait -= c.dt) <= 0) {
        this.state = 'hop';
        this.hops = 1 + Math.floor(Math.random() * 3);
        this.startHop(c, this.yaw + rnd(-1.2, 1.2), rnd(0.5, 0.9), 2.2);
      }
    } else {
      this.hopU += c.dt * this.speed;
      if (this.hopU >= 1) {
        this.pos.copy(this.to);
        if (this.state === 'flee') {
          // each bound kicks up a little dust
          if (d < 60) c.combat?.puffs?.emit(this.pos, 2, 0.35, 0.25, 0.22);
          const away = Math.atan2(this.pos.x - c.player.x, this.pos.z - c.player.z);
          // zig-zag
          this.startHop(c, away + (this.hops++ % 2 ? 0.45 : -0.45) * Math.random(), rnd(1.6, 2.4), 10);
          if (d > 75) { this.state = 'gone'; this.wait = rnd(10, 40); }
        } else if (--this.hops > 0) this.startHop(c, this.yaw + rnd(-0.6, 0.6), rnd(0.5, 0.9), 2.2);
        else { this.state = 'idle'; this.wait = rnd(2, 7); }
      }
    }
    const moving = this.state !== 'idle';
    const u = Math.min(1, this.hopU);
    const p = moving ? this.from.clone().lerp(this.to, u) : this.pos.clone();
    const arc = moving ? Math.sin(u * Math.PI) * (this.state === 'flee' ? 0.38 : 0.14) : 0;
    p.y += arc + 0.13;
    const pitch = moving ? -0.45 * Math.cos(u * Math.PI) : -0.35;
    this.b.place(p, this.yaw, pitch);
    const { R: _r, body: _b, head, ears, front, hind, feet } = this.rig;
    void _r; void _b;
    if ((this.earT -= c.dt) <= 0) { this.earT = rnd(0.5, 3); this.twitch = rnd(-0.4, 0.4); }
    const run = this.state === 'flee';
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      this.b.pose(ears[k], run ? 1.1 : -0.1 + (k ? this.twitch : 0) * 0.5, 0, s * (run ? 0.05 : 0.15));
      this.b.pose(front[k], moving ? -1.0 * Math.cos(u * Math.PI) : 0.35, 0, 0);
      this.b.pose(hind[k], moving ? 1.1 * Math.max(0, Math.cos(u * Math.PI)) - 0.3 : -0.25, 0, 0);
      this.b.pose(feet[k], moving ? 0.4 : -0.1, 0, 0);
    }
    this.b.pose(head, moving ? 0.25 : 0.3, moving ? 0 : Math.sin(c.t * 0.5 + this.yaw) * 0.3, 0);
  }
}

class Lizard {
  state: 'gone' | 'still' | 'dash' = 'gone';
  startle = false;
  pos = new THREE.Vector3();
  yaw = 0;
  wait = rnd(1, 6);
  run = 0;
  phase = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof lizardRig>) {}
  update(c: Ctx) {
    if (this.state === 'gone') {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !DAY(c.hour)) return;
      const p = openSpot(c, 5, 22, 1);
      if (!p) { this.wait = 2; return; }
      this.pos.copy(p);
      this.yaw = Math.random() * 6.28;
      this.state = 'still';
      this.wait = rnd(1, 5);
      return;
    }
    const d = Math.hypot(this.pos.x - c.player.x, this.pos.z - c.player.z);
    this.b.visible = d < 40;
    if (d > 45) { this.state = 'gone'; this.wait = rnd(2, 10); return; }
    if (this.state === 'still') {
      this.wait -= c.dt;
      if (d < 3.5 || this.wait <= 0 || this.startle) {
        this.startle = false;
        this.state = 'dash';
        this.run = rnd(0.3, 0.9);
        this.yaw = d < 3.5 ? Math.atan2(this.pos.x - c.player.x, this.pos.z - c.player.z) + rnd(-0.7, 0.7) : this.yaw + rnd(-2, 2);
        if (d < 6) c.audio?.play('scurry', { pos: this.pos, intensity: 0.4 });
      }
    } else {
      this.run -= c.dt;
      this.pos.x += Math.sin(this.yaw) * 3.2 * c.dt;
      this.pos.z += Math.cos(this.yaw) * 3.2 * c.dt;
      this.phase += c.dt * 38;
      if (this.run <= 0) { this.state = 'still'; this.wait = rnd(1.5, 6); }
    }
    this.pos.y = c.hf.heightAt(this.pos.x, this.pos.z);
    const dash = this.state === 'dash';
    const w = dash ? Math.sin(this.phase) : 0;
    this.b.place(this.pos, this.yaw + w * 0.15, 0, 0, 1.3);
    this.rig.tail.forEach((t, k) => this.b.pose(t, 0, (dash ? Math.sin(this.phase - k * 1.1) * 0.5 : Math.sin(c.t * 0.8 + k) * 0.08), 0));
    this.rig.legs.forEach((l, k) => this.b.pose(l, 0, w * (k % 2 ? 0.6 : -0.6) * (k < 2 ? 1 : -1), 0));
    // the odd push-up while it basks
    const push = !dash && Math.sin(c.t * 2.5 + this.yaw * 3) > 0.92 ? 0.012 : 0;
    this.b.pose(this.rig.body, 0, 0, 0, V(0, push, 0));
  }
}

class Butterfly {
  pos = new THREE.Vector3();
  home = new THREE.Vector3();
  vel = new THREE.Vector3();
  on = false;
  wait = rnd(1, 8);
  phase = Math.random() * 6;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof butterflyRig>) {}
  update(c: Ctx) {
    const day = c.hour > 8 && c.hour < 17.5;
    if (!this.on) {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !day) return;
      const p = openSpot(c, 4, 18, 0);
      // they keep to the low, green ground (or the odd one anywhere)
      if (!p || (p.y > -2 && Math.random() < 0.85)) { this.wait = 4; return; }
      this.home.copy(p);
      this.pos.copy(p).add(V(0, 0.8, 0));
      this.on = true;
      return;
    }
    const d = this.pos.distanceTo(c.player);
    if (d > 35 || !day) { this.on = false; this.wait = rnd(3, 12); this.b.visible = false; return; }
    this.b.visible = true;
    // erratic flight around home, 0.3–1.6 m up
    this.vel.add(V(rnd(-1, 1), rnd(-0.8, 0.8), rnd(-1, 1)).multiplyScalar(c.dt * 9));
    this.vel.add(this.home.clone().sub(this.pos).setY(0).multiplyScalar(c.dt * 0.4));
    this.vel.multiplyScalar(1 - c.dt * 1.5);
    this.pos.addScaledVector(this.vel, c.dt);
    const g = c.hf.heightAt(this.pos.x, this.pos.z);
    this.pos.y = clamp(this.pos.y, g + 0.3, g + 1.6);
    this.phase += c.dt * 32;
    this.b.place(this.pos, Math.atan2(this.vel.x, this.vel.z), 0, 0, 1.6);
    const a = Math.sin(this.phase) * 1.1;
    this.b.pose(this.rig.wings[0], 0, 0, a);
    this.b.pose(this.rig.wings[1], 0, 0, -a);
  }
}

/** A cloud of flies over a wreck (a "creature" whose parts are the flies). */
class Flies {
  center: THREE.Vector3 | null = null;
  loop: LoopHandle | null = null;
  seeds: number[];
  constructor(readonly b: Body, readonly rig: ReturnType<typeof fliesRig>, readonly spots: THREE.Vector3[]) {
    this.seeds = rig.flies.map(() => Math.random() * 100);
  }
  update(c: Ctx) {
    let best: THREE.Vector3 | null = null, bd = 30;
    if (c.hour > 7 && c.hour < 19.5) for (const s of this.spots) { const d = s.distanceTo(c.player); if (d < bd) { bd = d; best = s; } }
    if (best !== this.center) {
      this.loop?.stop();
      this.loop = best && c.audio ? c.audio.loop('flies', best) : null;
      this.center = best;
    }
    this.b.visible = !!best;
    if (!best) return;
    this.b.place(best, 0);
    this.rig.flies.forEach((f, k) => {
      const s = this.seeds[k], t = c.t * (1.3 + (s % 1) * 1.5) + s;
      this.b.pose(f, t * 3, t * 2, 0, V(Math.sin(t * 1.7) * 0.7 + Math.sin(t * 4.3 + s) * 0.15, 0.25 + Math.sin(t * 2.3 + s) * 0.35, Math.cos(t * 1.3) * 0.7 + Math.cos(t * 5.1 + s) * 0.15));
    });
  }
}

class Wolf implements Hostile {
  readonly kind = 'wolf' as const;
  readonly surface = 'flesh' as const;
  readonly center = new THREE.Vector3(0, -999, 0);
  radius = 1.1;
  pos = new THREE.Vector3();
  yaw = 0;
  phase = Math.random() * 6;
  speed = 0;
  howl = 0;
  look = 0;
  // --- the hunt
  alive = true;
  /** Out in the world this cycle (false: unspawned, so it can't be shot or seen). */
  out = false;
  hp = 60;
  /** Seconds since it died (−1 alive): the fall plays out, then it lies there. */
  dead = -1;
  deadSide = 1;
  role: 'ring' | 'lunge' | 'retreat' | 'feint' = 'ring';
  /** Lunge wind-up: seconds left crouched and coiled before it goes (the tell). */
  windup = 0;
  /** Seconds into the leap at the end of a lunge (−1: on the ground). */
  leap = -1;
  /** The last hit: seconds since, and which side it came from (+1 its left). */
  hitT = 99;
  hitSide = 1;
  roleT = 0;
  ringA = Math.random() * 6.28;
  ringR = 9;
  fear = 0;
  stagger = 0;
  bite = 0;
  bitten = false;
  snarlT = rnd(1, 4);
  pack: Pack | null = null;
  /** Where it stood last frame (feet): walls are checked along the move from here. */
  readonly prev = new THREE.Vector3(0, -999, 0);
  /** Pinned against a wall: walk along it this way (yaw) for `detourT` seconds before trying again. */
  detour = 0;
  detourT = 0;
  stuckT = 0;
  /** The Meshy model and this wolf's slot in it (null: draw the procedural body). */
  skin: WolfSkins | null = null;
  slot = 0;
  /** Stride amplitude at the moment it died (the fall starts from that pose). */
  deathAmp = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof wolfRig>) {}

  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _f = new THREE.Vector3();
  /** Body capsule (hips → chest) and head sphere, in world space. */
  private shape() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const y = this.center.y;
    this._a.set(this.pos.x - s * 0.5, y, this.pos.z - c * 0.5);
    this._b.set(this.pos.x + s * 0.55, y + 0.05, this.pos.z + c * 0.55);
    return { head: this._f.set(this.pos.x + s * 0.95, y + 0.28, this.pos.z + c * 0.95) };
  }
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.out) return null;
    const { head } = this.shape();
    const th = sphereRay(o, d, head, 0.17);
    const tb = capsuleRay(o, d, this._a, this._b, this.dead >= 0 ? 0.2 : 0.27);
    let best: RayHit | null = null;
    if (tb !== null && tb <= max) best = { t: tb, zone: 'body' };
    if (th !== null && th <= max && (!best || th < best.t)) best = { t: th, zone: 'head' };
    return best;
  }
  damage(d: Damage): boolean {
    if (!this.alive) return false;
    this.hp -= d.amount;
    const at = d.point;
    if (this.hp <= 0) {
      this.alive = false;
      this.dead = 0;
      this.hp = 0;
      // fall away from the hit
      const side = Math.sin(this.yaw) * d.dir.z - Math.cos(this.yaw) * d.dir.x;
      this.deadSide = side > 0 ? 1 : -1;
      this.pack?.onWolfDown(this, at, d);
      return true;
    }
    this.stagger = 0.45;
    this.hitT = 0;
    this.hitSide = Math.sin(this.yaw) * d.dir.z - Math.cos(this.yaw) * d.dir.x > 0 ? 1 : -1;
    this.windup = 0;
    // a hit drives it back a step
    this.pos.addScaledVector(this._a.set(d.dir.x, 0, d.dir.z).normalize(), d.melee ? 0.9 : 0.35);
    this.pack?.onWolfHurt(this, at, d);
    return false;
  }
  unaware() {
    return !this.pack || this.pack.state === 'travel' || this.pack.state === 'gone';
  }
  facing() {
    return this._f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  awareness() {
    if (!this.alive || !this.out || !this.pack) return 0;
    const st = this.pack.state;
    return st === 'circle' || st === 'stalk' ? 1 : st === 'watch' ? 0.5 : 0;
  }

  /** Pose for this frame at `speed` (m/s); `watch` turns the head toward `target`. */
  animate(c: Ctx, target: THREE.Vector3 | null) {
    const g = c.hf.heightAt(this.pos.x, this.pos.z);
    if (this.dead >= 0) {
      // the legs go, the body rolls onto its side and settles
      this.dead += c.dt;
      const k = Math.min(1, this.dead / 0.55);
      const e = k * k * (3 - 2 * k);
      const roll = this.deadSide * e * 1.45;
      if (this.skin) {
        // a wolf shot mid-run skids on a little before it goes down
        if (this.speed > 0.05) {
          const from = V(this.pos.x, c.hf.heightAt(this.pos.x, this.pos.z), this.pos.z);
          this.pos.x += Math.sin(this.yaw) * this.speed * c.dt;
          this.pos.z += Math.cos(this.yaw) * this.speed * c.dt;
          if (c.combat?.slide(from, this.pos, 0.45, 0.4) !== null && c.combat) this.speed = 0; // into a wall: stop there
          this.speed *= Math.exp(-c.dt * 4.5);
        }
        this.skin.pose(this.slot, { pos: V(this.pos.x, c.hf.heightAt(this.pos.x, this.pos.z), this.pos.z), yaw: this.yaw, pitch: 0, roll: 0, bob: 0, phase: this.phase, amp: this.deathAmp, low: 0, look: 0, nod: 0, tail: 0, deadT: this.dead, side: this.deadSide });
        this.b.visible = false;
        this.center.set(this.pos.x, g + 0.32, this.pos.z);
        return;
      }
      this.b.place(V(this.pos.x, g + 0.8 - e * 0.52, this.pos.z), this.yaw, 0, roll, 1.3);
      const { legs, neck, head, tail } = this.rig;
      legs.forEach((l, i) => {
        this.b.pose(l.upper, (l.hind ? -0.6 : 0.5) * e + (i % 2 ? 0.15 : -0.1) * e, 0, 0);
        this.b.pose(l.lower, (l.hind ? 0.9 : 0.4) * e, 0, 0);
      });
      this.b.pose(neck, 0.45 * e, 0, 0);
      this.b.pose(head, 0.3 * e, 0, 0);
      this.b.pose(tail, 0.4 * e, 0, 0);
      this.center.set(this.pos.x, g + 0.32, this.pos.z);
      return;
    }
    const sp = this.speed;
    this.phase += c.dt * (sp > 6 ? 9.5 : 3 + sp * 1.6);
    const A = sp < 0.2 ? 0 : sp > 6 ? 0.85 : 0.45;
    const bob = A ? Math.abs(Math.sin(this.phase)) * 0.035 : 0;
    // body pitch follows the ground under the shoulders and hips
    const fx = Math.sin(this.yaw) * 0.4, fz = Math.cos(this.yaw) * 0.4;
    const pitch = -Math.atan2(c.hf.heightAt(this.pos.x + fx, this.pos.z + fz) - c.hf.heightAt(this.pos.x - fx, this.pos.z - fz), 0.8);
    // stalking: low to the ground; a lunge stretches out; a hit rocks it
    const coiled = this.role === 'lunge' && this.windup > 0;
    const low = coiled ? 0.11 : this.pack && (this.pack.state === 'stalk' || this.pack.state === 'circle') && this.role !== 'lunge' ? 0.08 : 0;
    const rock = this.stagger > 0 ? Math.sin(this.stagger * 30) * this.stagger * 0.5 : 0;
    // a hit: it jerks away and sags on its legs, head whipping round to the wound
    this.hitT += c.dt;
    const hr = this.hitT < 1 ? Math.min(1, this.hitT / 0.05) * Math.exp(-Math.max(0, this.hitT - 0.05) * 5) : 0;
    const LEAP = 0.42;
    if (this.leap >= 0) { this.leap += c.dt; if (this.leap > LEAP) this.leap = -1; }
    const leapU = this.leap >= 0 ? this.leap / LEAP : 0;
    this.center.set(this.pos.x, g + 0.8 - low, this.pos.z);
    if (this.skin) {
      let lookYaw = 0;
      if (target) lookYaw = clamp(angDiff(this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z)), -1.1, 1.1);
      this.look = lerp(this.look, lookYaw, Math.min(1, c.dt * 3));
      const snap = this.bite > 0 ? Math.sin((1 - this.bite / 0.3) * Math.PI) : 0;
      // coiled for the lunge: a shiver through the crouch, head down, hackles up
      const shiver = coiled ? Math.sin(c.t * 38) * 0.012 : 0;
      this.skin.pose(this.slot, {
        pos: V(this.pos.x, g, this.pos.z), yaw: this.yaw, pitch: pitch * 0.8 + (this.bite > 0 ? 0.1 : 0) + (coiled ? 0.06 : 0), roll: this.hitSide * hr * 0.32 + shiver, bob: 0,
        phase: this.phase, amp: A, low: low / 0.08 + hr * 1.6, look: this.look - this.hitSide * hr * 0.9,
        nod: this.howl > 0 ? 0.85 : (sp > 6 ? -0.12 : 0) - snap * 0.45 - (coiled ? 0.2 : 0) + hr * 0.35,
        tail: (sp > 6 ? -0.25 : low ? 0.3 : 0) + Math.sin(c.t * 2 + this.phase) * 0.06 - hr * 0.5 + (coiled ? 0.25 : 0),
        deadT: -1, side: 1, leap: leapU,
      });
      this.deathAmp = A;
      this.b.visible = false;
      return;
    }
    this.b.place(V(this.pos.x, g + 0.8 + bob - low + Math.sin(leapU * Math.PI) * 0.45, this.pos.z), this.yaw, pitch + (this.bite > 0 ? 0.12 : 0) - Math.sin(leapU * Math.PI * 2) * 0.4, rock + this.hitSide * hr * 0.3, 1.3);
    const { legs, neck, head, tail } = this.rig;
    legs.forEach((l, k) => {
      // trot: diagonal pairs move together
      const ph = this.phase + (k === 0 || k === 3 ? 0 : Math.PI);
      const swing = Math.sin(ph) * A;
      const lift = Math.max(0, Math.cos(ph)) * A;
      if (l.hind) {
        this.b.pose(l.upper, -0.25 + swing - low * 2, 0, 0);
        this.b.pose(l.lower, 0.55 - lift * 0.9 + low * 3, 0, 0);
      } else {
        this.b.pose(l.upper, swing + low * 2, 0, 0);
        this.b.pose(l.lower, lift * 1.1 + low * 2, 0, 0);
      }
    });
    let lookYaw = 0;
    if (target) lookYaw = clamp(angDiff(this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z)), -1.1, 1.1);
    this.look = lerp(this.look, lookYaw, Math.min(1, c.dt * 3));
    const howling = this.howl > 0;
    const snap = this.bite > 0 ? Math.sin((1 - this.bite / 0.3) * Math.PI) : 0;
    // hackles: head low and forward while it hunts; the bite snaps forward
    this.b.pose(neck, howling ? -0.9 : sp > 6 ? 0.35 : 0.05 + low * 3 + snap * 0.5, this.look * 0.5, 0);
    this.b.pose(head, howling ? -0.55 : 0.1 + low * 2 - snap * 0.6 + (A ? Math.sin(this.phase * 2) * 0.04 : 0), this.look * 0.5, 0);
    this.b.pose(tail, (sp > 6 ? -0.35 : low ? 0.55 : 0.15) + Math.sin(c.t * 2 + this.phase) * 0.05, Math.sin(c.t * 1.3) * 0.12, 0);
  }
}

/** Venom: what a bite or a sting does on top of the damage (seconds of poison). */
const VENOM = { snake: 26, scorpion: 14 };

/**
 * A rattlesnake in the scrub. Coiled and still until you come close; then it rattles (the warning),
 * rears, and if you keep coming it strikes: a bite plus venom. It can be shot or clubbed. After a
 * strike it slithers off. Daytime and dusk, away from roads.
 */
class Snake implements Hostile {
  readonly kind = 'snake' as const;
  readonly surface = 'flesh' as const;
  readonly center = new THREE.Vector3(0, -999, 0);
  radius = 0.7;
  alive = false;
  state: 'gone' | 'coiled' | 'rattle' | 'strike' | 'slither' | 'dead' = 'gone';
  pos = new THREE.Vector3();
  yaw = 0;
  wait = rnd(10, 40);
  t = 0;
  near = 0;
  rattleT = 0;
  hp = 18;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof snakeRig>) {}
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.alive) return null;
    const t = sphereRay(o, d, this.center, 0.22);
    return t !== null && t <= max ? { t, zone: 'body' } : null;
  }
  damage(d: Damage) {
    if (!this.alive) return false;
    this.hp -= d.amount;
    if (this.hp <= 0) { this.alive = false; this.state = 'dead'; this.t = 0; return true; }
    this.state = 'slither';
    this.t = 0;
    return false;
  }
  unaware() { return this.state === 'coiled'; }
  facing() { return V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  awareness() { return this.state === 'rattle' ? 0.8 : 0; }

  update(c: Ctx) {
    if (this.state === 'gone') {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !(c.hour > 9 && c.hour < 20)) return;
      const p = openSpot(c, 9, 28, 2);
      if (!p || c.safe.some((s) => Math.hypot(p.x - s.p.x, p.z - s.p.z) < s.r)) { this.wait = 4; return; }
      this.pos.copy(p);
      this.yaw = Math.random() * 6.28;
      this.state = 'coiled';
      this.alive = true;
      this.hp = 18;
      return;
    }
    const d = Math.hypot(this.pos.x - c.player.x, this.pos.z - c.player.z);
    this.b.visible = d < 45;
    this.t += c.dt;
    if (d > 55 && this.state !== 'dead') { this.state = 'gone'; this.alive = false; this.wait = rnd(20, 60); return; }
    if (this.state === 'dead' && (d > 40 || this.t > 90)) { this.state = 'gone'; this.wait = rnd(30, 80); return; }
    const toP = Math.atan2(c.player.x - this.pos.x, c.player.z - this.pos.z);
    if (this.state === 'coiled' || this.state === 'rattle') {
      if (d < 6.5) {
        if (this.state === 'coiled') { this.state = 'rattle'; this.rattleT = 0; }
        this.yaw += angDiff(this.yaw, toP) * Math.min(1, c.dt * 3);
        if ((this.rattleT -= c.dt) <= 0) { this.rattleT = 1.25; c.audio?.combat?.voice('rattle', this.pos.clone().setY(this.pos.y + 0.2), 1, d < 3 ? 1.4 : 1); }
        this.near = d < 2.3 ? this.near + c.dt : 0;
        if (this.near > 0.35 || (c.sprinting && d < 2.6)) { this.state = 'strike'; this.t = 0; c.audio?.combat?.voice('hiss', this.pos, 1); }
      } else if (this.state === 'rattle' && d > 8) this.state = 'coiled';
    } else if (this.state === 'strike') {
      if (this.t > 0.18 && this.t - c.dt <= 0.18 && d < 2.6 && c.combat) {
        c.combat.hurtPlayer(9, this.pos.clone().setY(this.pos.y + 0.3), 'bite');
        c.combat.venom(VENOM.snake);
      }
      if (this.t > 0.6) { this.state = 'slither'; this.t = 0; }
    } else if (this.state === 'slither') {
      const away = toP + Math.PI + Math.sin(this.t * 0.7) * 0.6;
      this.yaw += angDiff(this.yaw, away) * Math.min(1, c.dt * 2);
      this.pos.x += Math.sin(this.yaw) * 0.9 * c.dt;
      this.pos.z += Math.cos(this.yaw) * 0.9 * c.dt;
      if (this.t > 8) { this.state = 'coiled'; }
    }
    this.pos.y = c.hf.heightAt(this.pos.x, this.pos.z);
    this.pose(c);
  }

  private pose(c: Ctx) {
    const { segs, head } = this.rig;
    const st = this.state;
    const coil = st === 'coiled' || st === 'rattle' || st === 'strike';
    const rear = st === 'rattle' ? 1 : st === 'strike' ? 1 : 0;
    const strike = st === 'strike' ? Math.sin(Math.min(1, this.t / 0.2) * Math.PI) : 0;
    const dead = st === 'dead';
    this.b.place(V(this.pos.x, this.pos.y + 0.022, this.pos.z), this.yaw, 0, dead ? 2.6 : 0, 1);
    this.center.copy(this.pos).setY(this.pos.y + (rear ? 0.18 : 0.05));
    segs.forEach((sg, k) => {
      let yaw: number, pitch = 0;
      if (dead) { yaw = Math.sin(k * 0.9) * 0.25; }
      else if (coil) {
        // a spiral: the tail wraps round, the neck makes an S and rears
        yaw = k < 3 ? (k === 0 ? 0 : 0.9) : 0.85 + k * 0.02;
        if (k < 3) { pitch = -rear * (k === 0 ? 0.5 : 0.35) + strike * (k === 0 ? 0.6 : 0.4); yaw = k === 0 ? -0.6 + strike * 0.6 : 0.9 - strike * 0.6; }
      } else yaw = Math.sin(this.t * 6 - k * 0.8) * 0.5;
      this.b.pose(sg, k === 0 ? pitch : pitch, k === 0 ? 0 : yaw, 0);
    });
    this.b.pose(head, -rear * 0.3 + strike * 0.2, 0, 0);
    void c;
  }
}

/**
 * Bark scorpions: out at night under the wrecks and rocks, sting if you stand on them. Small, quick,
 * a crowbar or a boot fixes them (they die to anything).
 */
class Scorpion implements Hostile {
  readonly kind = 'scorpion' as const;
  readonly surface = 'flesh' as const;
  readonly center = new THREE.Vector3(0, -999, 0);
  radius = 0.4;
  alive = false;
  state: 'gone' | 'idle' | 'scuttle' | 'sting' | 'dead' = 'gone';
  pos = new THREE.Vector3();
  yaw = 0;
  wait = rnd(5, 30);
  t = 0;
  cd = 0;
  phase = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof scorpionRig>, readonly spots: THREE.Vector3[]) {}
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.alive) return null;
    const t = sphereRay(o, d, this.center, 0.14);
    return t !== null && t <= max ? { t, zone: 'body' } : null;
  }
  damage() {
    if (!this.alive) return false;
    this.alive = false;
    this.state = 'dead';
    this.t = 0;
    return true;
  }
  unaware() { return this.state === 'idle'; }
  facing() { return V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  update(c: Ctx) {
    const night = c.hour > 19.5 || c.hour < 5.5;
    if (this.state === 'gone') {
      this.b.visible = false;
      if ((this.wait -= c.dt) > 0 || !night) return;
      // near a wreck if there's one close, else open ground
      let p: THREE.Vector3 | null = null;
      for (const sp of this.spots) if (sp.distanceTo(c.player) < 30 && Math.random() < 0.5) { p = sp.clone().add(V(rnd(-3, 3), 0, rnd(-3, 3))); break; }
      p ??= openSpot(c, 6, 20, 1);
      if (!p) { this.wait = 4; return; }
      this.pos.copy(p);
      this.state = 'idle';
      this.alive = true;
      this.t = 0;
      return;
    }
    const d = Math.hypot(this.pos.x - c.player.x, this.pos.z - c.player.z);
    this.b.visible = d < 25;
    this.t += c.dt;
    this.cd = Math.max(0, this.cd - c.dt);
    if (d > 35 || (!night && this.state !== 'dead')) { this.state = 'gone'; this.alive = false; this.wait = rnd(10, 40); return; }
    if (this.state === 'dead') { if (this.t > 40) { this.state = 'gone'; this.wait = rnd(20, 60); } }
    else if (d < 0.9 && this.cd <= 0) {
      this.state = 'sting';
      this.t = 0;
      this.cd = 2.2;
      c.combat?.hurtPlayer(5, this.pos.clone().setY(this.pos.y + 0.2), 'bite');
      c.combat?.venom(VENOM.scorpion);
      c.audio?.combat?.voice('click', this.pos, 1);
    } else if (this.state === 'sting' && this.t > 0.4) this.state = 'idle';
    else if (this.state === 'idle' && Math.random() < c.dt * 0.4) { this.state = 'scuttle'; this.t = 0; this.yaw += rnd(-2, 2); }
    else if (this.state === 'scuttle') {
      this.pos.x += Math.sin(this.yaw) * 0.6 * c.dt;
      this.pos.z += Math.cos(this.yaw) * 0.6 * c.dt;
      this.phase += c.dt * 30;
      if (this.t > rnd(0.4, 1.4)) this.state = 'idle';
    }
    this.pos.y = c.hf.heightAt(this.pos.x, this.pos.z);
    const dead = this.state === 'dead';
    this.b.place(this.pos, this.yaw, 0, dead ? Math.PI : 0, 1.8);
    this.center.copy(this.pos).setY(this.pos.y + 0.06);
    const sting = this.state === 'sting' ? Math.sin(Math.min(1, this.t / 0.25) * Math.PI) : 0;
    this.rig.tail.forEach((tl, k) => this.b.pose(tl, -0.55 - k * 0.12 - sting * 0.25, 0, 0));
    this.b.pose(this.rig.sting, 0.3 + sting * 0.6, 0, 0);
    this.rig.legs.forEach((l, k) => this.b.pose(l, 0, (this.state === 'scuttle' ? Math.sin(this.phase + k * 1.7) * 0.35 : 0), 0));
    this.rig.claws.forEach((cl, k) => this.b.pose(cl, 0, (k ? 1 : -1) * (0.2 + Math.sin(c.t * 2 + k) * 0.1), 0));
  }
}

/** Snakes and scorpions, as one hostile provider. */
class Critters implements HostileProvider {
  constructor(readonly snakes: Snake[], readonly scorpions: Scorpion[]) {}
  hostiles() {
    return [...this.snakes, ...this.scorpions];
  }
}

/**
 * The pack. Out on the flats it passes at a distance (travel), stops to watch you (watch), and if it
 * decides you're prey it stalks in low and fast (stalk), rings you at 8–12 m (circle) and sends one
 * wolf at a time in on a lunge while the rest keep pressure. Each wolf has 60 hp: a hurt one yelps
 * and backs off, and losing wolves breaks the pack's nerve (flee). Torchlight on a wolf makes it
 * hesitate; a gunshot rattles them (less at night); they won't go near a fire or a town.
 */
class Pack implements HostileProvider {
  /** Seconds this pack has been running off (stragglers are dropped after a while). */
  fleeT = 0;
  state: 'gone' | 'travel' | 'watch' | 'stalk' | 'circle' | 'flee' = 'gone';
  wait = rnd(30, 80);
  goal = new THREE.Vector3();
  watchT = 0;
  nextWatch = 0;
  howlT = 0;
  /** How many wolves this outing (2–5). */
  size = 3;
  morale = 1;
  lungeT = 3;
  growlT = 0;
  /** Seconds the player has been out of reach (hidden, at a fire): the hunt is abandoned. */
  lostT = 0;
  hunting = false;
  noticeT = 0;
  constructor(readonly wolves: Wolf[]) {
    for (const w of wolves) w.pack = this;
  }
  private offsets = [V(0, 0, 0), V(1.8, 0, -2.5), V(-1.6, 0, -4.1), V(2.4, 0, -5.8), V(-2.2, 0, -7.2)];

  get active() {
    return this.wolves.filter((w) => w.out && w.alive);
  }
  hostiles() {
    return this.wolves;
  }
  /** Gunshots and blasts: rattle the pack (by day it's enough to drive them off). */
  hear(pos: THREE.Vector3, radius: number, kind: NoiseKind) {
    if (this.state === 'gone' || this.state === 'flee') return;
    const lead = this.active[0];
    if (!lead || lead.pos.distanceTo(pos) > radius) return;
    if (kind === 'gunshot' || kind === 'explosion') {
      this.morale -= this.hunting ? 0.07 : 0.25;
      if (!this.hunting && this.morale < 0.75) this.state = 'flee';
    } else if (kind === 'can' && this.state === 'circle') {
      this.morale -= 0.15;
    }
  }
  /**
   * One of your rounds cracked past a wolf: it flinches away from it, a coiled lunge breaks off (the
   * nerve goes before the leap), and the pack's nerve frays a little.
   */
  whizz(o: THREE.Vector3, dir: THREE.Vector3, len: number, hit: Hostile | null) {
    for (const w of this.wolves) {
      if (!w.out || !w.alive || w === hit) continue;
      const c = w.center;
      const along = clamp(_wz.subVectors(c, o).dot(dir), 0, len);
      if (along < 2) continue;
      const miss = _wz2.copy(o).addScaledVector(dir, along).distanceTo(c);
      if (miss > 2) continue;
      w.hitT = 0.2;
      w.hitSide = _wz.subVectors(c, o).cross(dir).y > 0 ? 1 : -1;
      this.morale -= 0.025;
      if (w.role === 'lunge' && w.windup > 0) { w.role = 'retreat'; w.roleT = 0; this.audio?.combat?.voice('snarl', c, 1.1, 0.7); }
    }
  }

  onWolfHurt(w: Wolf, at: THREE.Vector3, d: Damage) {
    this.morale -= 0.12;
    w.role = 'retreat';
    w.roleT = 0;
    this.audio?.combat?.voice('yelp', at, 1 + Math.random() * 0.1);
    // a hurt wolf makes the whole pack commit (or bolt)
    if (this.state === 'travel' || this.state === 'watch') this.hunting = true, this.state = 'circle';
    void d;
  }
  /** A wolf died here (Fauna keeps the carcass for the vultures). */
  onDown: ((at: THREE.Vector3) => void) | null = null;
  onWolfDown(w: Wolf, at: THREE.Vector3, d: Damage) {
    this.onDown?.(at);
    this.morale -= d.takedown ? 0.25 : 0.42;
    this.audio?.combat?.voice(d.takedown ? 'whimper' : 'yelp', at, 0.85);
    if (this.state === 'travel' || this.state === 'watch') this.hunting = true, this.state = 'circle';
    void w;
  }
  audio?: AudioEngine;

  private spawn(c: Ctx) {
    const p = openSpot(c, 95, 130, 15);
    if (!p) { this.wait = 5; return; }
    const night = c.hour > 19.3 || c.hour < 5.2;
    const dusk = !night && (c.hour > 17.8 || c.hour < 6.5);
    this.size = night ? 4 + (Math.random() < 0.5 ? 1 : 0) : dusk ? 3 + (Math.random() < 0.4 ? 1 : 0) : 2 + (Math.random() < 0.5 ? 1 : 0);
    this.morale = night ? 1.25 : 1;
    this.hunting = false;
    this.lostT = 0;
    // a line that passes the player at a distance, not through them
    const toward = V(c.player.x - p.x, 0, c.player.z - p.z);
    const side = V(-toward.z, 0, toward.x).normalize().multiplyScalar(rnd(40, 65) * (Math.random() < 0.5 ? 1 : -1));
    this.goal.copy(c.player).add(side).addScaledVector(toward, 0.9);
    this.wolves.forEach((w, i) => {
      w.out = i < this.size;
      w.alive = w.out;
      w.hp = 60;
      w.dead = -1;
      w.fear = 0;
      w.stagger = 0;
      w.role = 'ring';
      w.ringA = (i / this.size) * Math.PI * 2;
      w.ringR = rnd(8, 11.5);
      w.pos.copy(p).add(this.offsets[i]);
      w.yaw = Math.atan2(this.goal.x - p.x, this.goal.z - p.z);
      w.b.visible = false;
    });
    this.state = 'travel';
    this.nextWatch = rnd(6, 16);
  }

  /** Is the player somewhere wolves won't follow (a fire, a town, indoors)? */
  private safe(c: Ctx) {
    if (c.combat?.target.hidden) return true;
    for (const s of c.safe) if (Math.hypot(c.player.x - s.p.x, c.player.z - s.p.z) < s.r) return true;
    return false;
  }

  update(c: Ctx) {
    if (this.state === 'gone') {
      for (const w of this.wolves) { w.b.visible = false; w.out = false; w.skin?.hide(w.slot); }
      if ((this.wait -= c.dt) > 0) return;
      this.spawn(c);
      return;
    }
    const live = this.active;
    const lead = live[0] ?? this.wolves.find((w) => w.out) ?? this.wolves[0];
    const d = Math.hypot(lead.pos.x - c.player.x, lead.pos.z - c.player.z);
    for (const w of this.wolves) {
      w.b.visible = w.out && Math.hypot(w.pos.x - c.player.x, w.pos.z - c.player.z) < 260;
      if (!w.b.visible) w.skin?.hide(w.slot);
    }
    const night = c.hour > 19.3 || c.hour < 5.2;
    const t = c.combat?.target;
    const safe = this.safe(c);
    // morale breaks: run
    if (this.state !== 'flee' && (this.morale < 0.3 || live.length === 0 || (live.length === 1 && this.size > 2))) this.state = 'flee';

    // noticing you: noise and scent carry further at night and when you sprint; storms and crouching hide you
    if (this.state === 'travel' || this.state === 'watch') {
      const nz = t ? t.noise : c.sprinting ? 1.5 : 0.8;
      const vis = t ? t.visibility : 1;
      const sense = (night ? 80 : 50) * (0.55 + nz * 0.45) * (0.5 + vis * 0.5);
      if (d < sense && !safe && t?.alive !== false) {
        this.noticeT += c.dt;
        // by day a pack may only watch and move on; at night it hunts
        if (this.noticeT > (night ? 0.8 : 2.2)) {
          const hunt = night || d < 28 || Math.random() < 0.55;
          this.noticeT = -6;
          if (hunt) {
            this.hunting = true;
            this.state = 'stalk';
            c.audio?.combat?.voice('growl', lead.pos.clone().setY(lead.pos.y + 0.8), 0.95);
            if (night && Math.random() < 0.6) c.audio?.howl(lead.pos.clone().setY(lead.pos.y + 1));
          }
        }
      } else this.noticeT = Math.max(0, this.noticeT - c.dt);
    }
    if (this.state !== 'flee') this.fleeT = 0;
    if (this.hunting && safe) { this.lostT += c.dt; if (this.lostT > 6) { this.state = 'flee'; this.hunting = false; } }
    else this.lostT = 0;

    let target: THREE.Vector3 | null = null;
    let speed = 0;
    if (this.state === 'travel') {
      speed = 2.6;
      const to = V(this.goal.x - lead.pos.x, 0, this.goal.z - lead.pos.z);
      if (to.length() < 4 || c.hf.zoneDistance(lead.pos.x + Math.sin(lead.yaw) * 6, lead.pos.z + Math.cos(lead.yaw) * 6) < 10) {
        const a = Math.random() * 6.28;
        this.goal.set(c.player.x + Math.cos(a) * 140, 0, c.player.z + Math.sin(a) * 140);
      }
      lead.yaw += clamp(angDiff(lead.yaw, Math.atan2(to.x, to.z)), -1, 1) * c.dt * 1.5;
      if ((this.nextWatch -= c.dt) <= 0 && d < 140) { this.state = 'watch'; this.watchT = rnd(4, 9); this.howlT = night ? rnd(0.5, 2) : 99; }
    } else if (this.state === 'watch') {
      target = c.player;
      this.watchT -= c.dt;
      if ((this.howlT -= c.dt) <= 0) {
        this.howlT = 99;
        const w = live[Math.floor(Math.random() * live.length)] ?? lead;
        w.howl = 3.2;
        c.audio?.howl(w.pos.clone().setY(w.pos.y + 1));
      }
      if (this.watchT <= 0) { this.state = 'travel'; this.nextWatch = rnd(15, 35); }
    } else if (this.state === 'flee') {
      speed = 10;
      // a wolf still boxed in by town clutter long after the rest ran off slips away unseen
      this.fleeT += c.dt;
      if (this.fleeT > 15) {
        for (const w of live) {
          const dx = w.pos.x - c.player.x, dz = w.pos.z - c.player.z, dd = Math.hypot(dx, dz);
          const seen = c.camFwd ? (dx * c.camFwd.x + dz * c.camFwd.z) / Math.max(dd, 1e-3) > 0.2 : true;
          if (dd > 10 && !seen) w.out = false;
        }
      }
      for (const w of live) {
        const away = Math.atan2(w.pos.x - c.player.x, w.pos.z - c.player.z);
        w.yaw += clamp(angDiff(w.yaw, away), -1, 1) * c.dt * 4;
        w.speed = lerp(w.speed, 10, Math.min(1, c.dt * 3));
        w.pos.x += Math.sin(w.yaw) * w.speed * c.dt;
        w.pos.z += Math.cos(w.yaw) * w.speed * c.dt;
      }
    }

    if (this.state === 'stalk' || this.state === 'circle') {
      this.huntStep(c, live, night, safe);
    } else if (this.state !== 'flee') {
      // travel / watch: the leader leads, the rest keep station on it
      lead.speed = lerp(lead.speed, speed, Math.min(1, c.dt * 3));
      lead.pos.x += Math.sin(lead.yaw) * lead.speed * c.dt;
      lead.pos.z += Math.cos(lead.yaw) * lead.speed * c.dt;
      for (let i = 1; i < this.wolves.length; i++) {
        const w = this.wolves[i];
        if (!w.out || !w.alive) continue;
        const o = this.offsets[i].clone().applyAxisAngle(V(0, 1, 0), lead.yaw);
        const want = lead.pos.clone().add(o);
        const to = V(want.x - w.pos.x, 0, want.z - w.pos.z);
        const dist = to.length();
        const sp = clamp(speed + (dist - 0.5) * 1.5, 0, 12);
        if (dist > 0.3) w.yaw += clamp(angDiff(w.yaw, Math.atan2(to.x, to.z)), -1, 1) * c.dt * 4;
        else if (this.state === 'watch') w.yaw += angDiff(w.yaw, Math.atan2(c.player.x - w.pos.x, c.player.z - w.pos.z)) * c.dt * 1.5;
        w.speed = lerp(w.speed, dist > 0.3 ? sp : 0, Math.min(1, c.dt * 3));
        w.pos.x += Math.sin(w.yaw) * w.speed * c.dt;
        w.pos.z += Math.cos(w.yaw) * w.speed * c.dt;
      }
      if (this.state === 'watch') lead.yaw += angDiff(lead.yaw, Math.atan2(c.player.x - lead.pos.x, c.player.z - lead.pos.z)) * c.dt * 1.5;
    }

    // gone for good once far enough (or everyone's down and you've walked off)
    const far = live.every((w) => Math.hypot(w.pos.x - c.player.x, w.pos.z - c.player.z) > (this.state === 'flee' ? 130 : 200));
    const bodiesFar = this.wolves.every((w) => !w.out || w.alive || Math.hypot(w.pos.x - c.player.x, w.pos.z - c.player.z) > 160);
    if (far && bodiesFar) { this.state = 'gone'; this.wait = rnd(70, 180) * (night ? 0.6 : 1); for (const w of this.wolves) { w.out = false; w.skin?.hide(w.slot); } return; }

    // walls: whatever the pack decided, nobody walks through a building
    for (const w of this.wolves) {
      if (!w.out) continue;
      const want = Math.hypot(w.pos.x - w.prev.x, w.pos.z - w.prev.z);
      if (c.combat && w.alive && w.prev.y > -900 && want < 3) {
        w.prev.y = c.hf.heightAt(w.prev.x, w.prev.z);
        if (w.detourT > 0) {
          // committed to going round: follow the wall instead of what the pack wants
          w.detourT -= c.dt;
          const step = Math.max(want, w.speed * c.dt * 0.8, 2.5 * c.dt);
          w.pos.x = w.prev.x + Math.sin(w.detour) * step;
          w.pos.z = w.prev.z + Math.cos(w.detour) * step;
          w.yaw += angDiff(w.yaw, w.detour) * Math.min(1, c.dt * 8);
        }
        const tried = Math.hypot(w.pos.x - w.prev.x, w.pos.z - w.prev.z);
        const triedYaw = tried > 1e-4 ? Math.atan2(w.pos.x - w.prev.x, w.pos.z - w.prev.z) : w.yaw;
        const along = c.combat.slide(w.prev, w.pos, 0.45, 0.55);
        if (along !== null) {
          if (w.role !== 'lunge') w.yaw += angDiff(w.yaw, along) * Math.min(1, c.dt * 6);
          const got = Math.hypot(w.pos.x - w.prev.x, w.pos.z - w.prev.z);
          // pinned (a corner, or steering straight back into the wall): pick a way round and commit
          if (got < tried * 0.35) {
            w.stuckT += c.dt;
            if (w.stuckT > 0.25) {
              // find the gap: the roomiest heading near where it was trying to go
              w.detour = c.combat.openWay(w.prev, triedYaw, 0.55);
              w.detourT = rnd(0.7, 1.3);
              w.stuckT = 0;
            }
          } else w.stuckT = Math.max(0, w.stuckT - c.dt);
        }
      }
      w.prev.set(w.pos.x, 0, w.pos.z);
    }

    for (const w of this.wolves) {
      if (!w.out) continue;
      w.howl = Math.max(0, w.howl - c.dt);
      w.stagger = Math.max(0, w.stagger - c.dt);
      w.bite = Math.max(0, w.bite - c.dt);
      w.animate(c, w.alive && (this.state === 'watch' || this.state === 'circle' || this.state === 'stalk') ? c.player : target);
    }
  }

  /** Stalk in and work the ring: one lunge at a time, the rest circling and snarling. */
  private huntStep(c: Ctx, live: Wolf[], night: boolean, safe: boolean) {
    const P = c.player;
    const t = c.combat?.target;
    const diff = c.combat?.diff;
    const n = live.length;
    let lunging = live.some((w) => w.role === 'lunge');
    this.lungeT -= c.dt * (diff ? 1 / diff.react : 1);
    // a lit torch held on a wolf makes it think twice
    const camF = c.camFwd;
    live.forEach((w, i) => {
      const toW = V(w.pos.x - P.x, 0, w.pos.z - P.z);
      const dist = toW.length();
      if (t?.torch && camF && dist < 16 && toW.normalize().dot(V(camF.x, 0, camF.z).normalize()) > 0.93) w.fear = Math.min(1.5, w.fear + c.dt * 2.5);
      else w.fear = Math.max(0, w.fear - c.dt * 0.8);
      w.roleT += c.dt;
      // spread the ring evenly; it slowly rotates
      const slot = (i / Math.max(1, n)) * Math.PI * 2;
      w.ringA += angDiff(w.ringA, slot + c.t * 0.25) * c.dt * 0.5 + c.dt * 0.25;
      if (w.stagger > 0) { w.speed = lerp(w.speed, 0, Math.min(1, c.dt * 8)); return; }
      let goal: THREE.Vector3;
      let sp: number;
      if (this.state === 'stalk') {
        // close in, fanning out a little
        const dir = Math.atan2(P.x - w.pos.x, P.z - w.pos.z) + (i - (n - 1) / 2) * 0.25;
        goal = V(P.x - Math.sin(dir) * 10, 0, P.z - Math.cos(dir) * 10);
        sp = dist > 30 ? 8.5 : 5;
        if (dist < 20) this.state = 'circle';
      } else if (w.role === 'lunge') {
        goal = P.clone();
        sp = 11.5;
        if (w.windup > 0) {
          // the tell: it stops, drops into a crouch facing you, and snarls; then it goes
          w.windup -= c.dt;
          w.roleT = 0;
          sp = 0;
          goal = w.pos.clone();
          w.yaw += clamp(angDiff(w.yaw, Math.atan2(P.x - w.pos.x, P.z - w.pos.z)), -1.2, 1.2) * c.dt * 8;
          if (w.windup <= 0) c.audio?.combat?.voice('snarl', w.pos.clone().setY(w.pos.y + 0.8), 1.15);
        } else if (w.leap < 0 && dist < 3.8 && !w.bitten) {
          // the last stride is a leap at you
          w.leap = 0;
          w.speed = Math.max(w.speed, 9);
        }
        if (dist < 1.7 && !w.bitten) {
          // the bite
          w.bitten = true;
          w.bite = 0.3;
          c.audio?.combat?.voice('snarl', w.pos.clone().setY(w.pos.y + 0.8), 1.05);
          c.audio?.combat?.voice('bite', w.pos.clone().setY(w.pos.y + 0.9), 1);
          const dmg = (night ? 15 : 12) * (0.85 + Math.random() * 0.3);
          c.combat?.hurtPlayer(dmg, w.pos.clone().setY(w.pos.y + 0.8), 'bite');
          w.role = 'retreat';
          w.roleT = 0;
        } else if (w.roleT > 1.8 || w.fear > 0.8 || safe) { w.role = 'retreat'; w.roleT = 0; }
      } else if (w.role === 'feint') {
        // a false start: a few quick bounds in, a snarl, and back out to the ring
        const away = Math.atan2(w.pos.x - P.x, w.pos.z - P.z);
        const r = Math.max(4.5, w.ringR - 5);
        goal = V(P.x + Math.sin(away) * r, 0, P.z + Math.cos(away) * r);
        sp = 8;
        if (w.roleT > 0.7 || dist < 5) { w.role = 'retreat'; w.roleT = 0.4; }
      } else if (w.role === 'retreat') {
        const away = Math.atan2(w.pos.x - P.x, w.pos.z - P.z);
        goal = V(P.x + Math.sin(away) * (w.ringR + 4), 0, P.z + Math.cos(away) * (w.ringR + 4));
        sp = 7;
        if (w.roleT > 1.1) { w.role = 'ring'; w.roleT = 0; }
      } else {
        const r = w.ringR + w.fear * 6 + (safe ? 14 : 0);
        goal = V(P.x + Math.cos(w.ringA) * r, 0, P.z + Math.sin(w.ringA) * r);
        sp = 4.2;
      }
      const to = V(goal.x - w.pos.x, 0, goal.z - w.pos.z);
      const gd = to.length();
      const want = gd > 0.4 ? Math.min(sp, gd * 2.5) : 0;
      // face the move; on the ring, face the player while drifting
      const faceP = w.role === 'ring' && gd < 3;
      const head = faceP ? Math.atan2(P.x - w.pos.x, P.z - w.pos.z) : Math.atan2(to.x, to.z);
      // in the air it's committed: no turning
      if (w.leap < 0 && !(w.role === 'lunge' && w.windup > 0)) w.yaw += clamp(angDiff(w.yaw, head), -1.2, 1.2) * c.dt * (w.role === 'lunge' ? 9 : 5);
      w.speed = w.leap >= 0 ? Math.max(w.speed * Math.exp(-c.dt * 1.5), 5) : lerp(w.speed, want, Math.min(1, c.dt * (w.role === 'lunge' ? 6 : 3)));
      // move along the facing, plus a little sideways slide toward the goal when circling
      w.pos.x += Math.sin(w.yaw) * w.speed * c.dt;
      w.pos.z += Math.cos(w.yaw) * w.speed * c.dt;
      if (faceP && gd > 0.2) { w.pos.x += (to.x / gd) * Math.min(gd, 3) * c.dt; w.pos.z += (to.z / gd) * Math.min(gd, 3) * c.dt; }
      // never stand inside the player
      const pd = Math.hypot(w.pos.x - P.x, w.pos.z - P.z);
      if (pd < 1.1) { const k = 1.1 / pd; w.pos.x = P.x + (w.pos.x - P.x) * k; w.pos.z = P.z + (w.pos.z - P.z) * k; }
      // snarls round the ring
      if ((w.snarlT -= c.dt) <= 0) {
        w.snarlT = rnd(2.5, 6);
        if (this.state === 'circle' && dist < 25) c.audio?.combat?.voice(Math.random() < 0.6 ? 'growl' : 'snarl', w.pos.clone().setY(w.pos.y + 0.8), 0.9 + Math.random() * 0.2, 0.8);
      }
    });
    // send the next one in
    if (this.state === 'circle' && !lunging && this.lungeT <= 0 && !safe && t?.alive !== false) {
      const ready = live.filter((w) => w.role === 'ring' && w.fear < 0.5 && w.stagger <= 0 && Math.hypot(w.pos.x - P.x, w.pos.z - P.z) < 16);
      if (ready.length) {
        // mostly one you can see coming (in front of you); now and then one from the side
        const inView = (w: Wolf) => !camF || (w.pos.x - P.x) * camF.x + (w.pos.z - P.z) * camF.z > 0.35 * Math.hypot(w.pos.x - P.x, w.pos.z - P.z) * Math.hypot(camF.x, camF.z);
        const seen = ready.filter(inView);
        const pool = seen.length && Math.random() < 0.75 ? seen : ready;
        const w = pool[Math.floor(Math.random() * pool.length)];
        w.role = 'lunge';
        w.roleT = 0;
        w.bitten = false;
        // the tell: shorter at night and on harder settings
        w.windup = (night ? rnd(0.3, 0.45) : rnd(0.42, 0.6)) * (diff ? diff.react : 1);
        lunging = true;
        c.audio?.combat?.voice('growl', w.pos.clone().setY(w.pos.y + 0.8), 1.1);
        this.lungeT = rnd(night ? 1.6 : 2.4, night ? 3.2 : 4.4) * (n <= 2 ? 1.3 : 1);
      }
    } else if (this.state === 'circle' && !lunging && this.lungeT > 1.2 && !safe && n >= 2 && Math.random() < c.dt * 0.35) {
      // between lunges, a feint keeps you turning
      const ring = live.filter((w) => w.role === 'ring' && w.fear < 0.5 && w.stagger <= 0);
      const w = ring[Math.floor(Math.random() * ring.length)];
      if (w) {
        w.role = 'feint';
        w.roleT = 0;
        if (Math.hypot(w.pos.x - P.x, w.pos.z - P.z) < 25) c.audio?.combat?.voice('snarl', w.pos.clone().setY(w.pos.y + 0.8), 0.95 + Math.random() * 0.15, 0.85);
      }
    }
  }
}

// ------------------------------------------------------------------ the system

/**
 * Coyotes: a family of three out after dark on the Meshy wolf model, smaller and tawny. They trot
 * across the flats well clear of you, stop to look back, sometimes howl, and nose round a kill if
 * there is one. Anything loud, or you getting close, sends them off at a flat run. Never hostile.
 */
class Coyote {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  phase = Math.random() * 6;
  look = 0;
  nod = 0;
  low = 0;
  out = false;
  constructor(readonly slot: number) {}
}

class Coyotes implements HostileProvider {
  readonly pack: Coyote[] = [0, 1, 2].map((i) => new Coyote(i));
  state: 'gone' | 'trot' | 'watch' | 'feed' | 'flee' = 'gone';
  wait = rnd(30, 90);
  private goal = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private stopT = 0;
  private stateT = 0;
  private howlT = 0;
  skins: WolfSkins | null = null;
  audio?: AudioEngine;
  /** Where they are (debug). */
  get where() { return this.pack[0].pos; }
  private static readonly none: Hostile[] = [];
  hostiles(): Hostile[] { return Coyotes.none; }
  /** Every shot or blast (Fauna startles the birds and the small things with it). */
  onShot: ((pos: THREE.Vector3, radius: number) => void) | null = null;
  hear(pos: THREE.Vector3, radius: number, kind: NoiseKind) {
    if (kind === 'gunshot' || kind === 'explosion') this.onShot?.(pos, radius);
    if (this.state === 'gone' || this.state === 'flee') return;
    if ((kind === 'gunshot' || kind === 'explosion') && this.pack[0].pos.distanceTo(pos) < Math.min(radius, 160)) this.flee();
  }
  private flee() { this.state = 'flee'; this.stateT = 0; }
  private night(h: number) { return h > 19.9 || h < 5.1; }

  update(c: Ctx, carcass: THREE.Vector3 | null) {
    const S = this.skins;
    if (!S) return;
    const lead = this.pack[0];
    if (this.state === 'gone') {
      for (const k of this.pack) { k.out = false; S.hide(k.slot); }
      if ((this.wait -= c.dt) > 0 || !this.night(c.hour)) return;
      const p = openSpot(c, 80, 120, 4);
      if (!p) { this.wait = 5; return; }
      // a line that passes 45–70 m from you, or a kill to nose round
      if (carcass && carcass.distanceTo(c.player) < 170) { this.goal.copy(carcass); this.state = 'trot'; }
      else {
        const side = _cy.set(p.z - c.player.z, 0, -(p.x - c.player.x)).normalize().multiplyScalar(rnd(45, 70) * (Math.random() < 0.5 ? 1 : -1));
        this.goal.set(c.player.x * 2 - p.x + side.x, 0, c.player.z * 2 - p.z + side.z);
        this.state = 'trot';
      }
      this.pack.forEach((k, i) => { k.out = true; k.pos.set(p.x - i * 1.6 + rnd(-0.5, 0.5), 0, p.z - i * 1.4 + rnd(-0.5, 0.5)); k.speed = 0; });
      this.stopT = rnd(10, 18);
      this.howlT = rnd(8, 30);
      this.stateT = 0;
      return;
    }
    this.stateT += c.dt;
    const dP = Math.hypot(lead.pos.x - c.player.x, lead.pos.z - c.player.z);
    if (this.state !== 'flee' && (dP < (c.sprinting ? 40 : 28) || c.combat && c.combat.heat > 0.4)) this.flee();
    if (dP > 175 || (!this.night(c.hour) && this.state !== 'flee') || (this.state === 'flee' && dP > 150)) {
      this.state = 'gone';
      this.wait = rnd(90, 240);
      return;
    }
    // the lead decides; the others follow in its tracks
    let speed = 2.6;
    let lookAt: THREE.Vector3 | null = null;
    if (this.state === 'trot') {
      this.dir.subVectors(this.goal, lead.pos).setY(0);
      const dg = this.dir.length();
      if (carcass && this.goal.distanceToSquared(carcass) < 1 && dg < 3) { this.state = 'feed'; this.stateT = 0; }
      else if (dg < 4) { this.state = 'gone'; this.wait = rnd(60, 180); return; }
      if ((this.stopT -= c.dt) <= 0) { this.state = 'watch'; this.stateT = 0; this.stopT = rnd(12, 22); }
    } else if (this.state === 'watch') {
      speed = 0;
      lookAt = c.player;
      // the lead lifts its nose and howls; the others answer (audio's own coyote family)
      if ((this.howlT -= c.dt) <= 0 && this.stateT > 0.8) { this.howlT = rnd(25, 60); lead.nod = 1.6; this.audio?.howl(lead.pos); }
      if (this.stateT > rnd(2.5, 4)) this.state = 'trot';
    } else if (this.state === 'feed') {
      speed = 0;
      if (this.stateT > 40) { this.state = 'gone'; this.wait = rnd(120, 300); return; }
    } else {
      // flee: flat out, away from you
      this.dir.set(lead.pos.x - c.player.x, 0, lead.pos.z - c.player.z);
      speed = 8.5;
    }
    this.pack.forEach((k, i) => {
      let sp = speed;
      let want: number | null = null;
      if (i === 0) {
        if (sp > 0) want = Math.atan2(this.dir.x, this.dir.z);
      } else {
        // follow a couple of metres behind and to the side of the one ahead
        const ahead = this.pack[i - 1];
        const fx = Math.sin(ahead.yaw), fz = Math.cos(ahead.yaw);
        const tx = ahead.pos.x - fx * 2.2 + fz * (i === 1 ? 0.9 : -0.9), tz = ahead.pos.z - fz * 2.2 - fx * (i === 1 ? 0.9 : -0.9);
        const dx = tx - k.pos.x, dz = tz - k.pos.z, d = Math.hypot(dx, dz);
        if (this.state === 'feed') {
          // round the kill, each its own side
          const a = i * 2.3 + this.stateT * 0.05;
          const gx = this.goal.x + Math.cos(a) * 1.8 - k.pos.x, gz = this.goal.z + Math.sin(a) * 1.8 - k.pos.z;
          const gd = Math.hypot(gx, gz);
          sp = gd > 0.4 ? Math.min(2, gd * 2) : 0;
          if (sp > 0) want = Math.atan2(gx, gz);
        } else if (d > 0.5) { sp = Math.min(speed > 0 ? speed * 1.15 : 2.8, d * 1.6); want = Math.atan2(dx, dz); }
        else sp = 0;
      }
      if (want !== null) k.yaw += angDiff(k.yaw, want) * Math.min(1, c.dt * 5);
      k.speed = lerp(k.speed, sp, Math.min(1, c.dt * 4));
      k.pos.x += Math.sin(k.yaw) * k.speed * c.dt;
      k.pos.z += Math.cos(k.yaw) * k.speed * c.dt;
      const g = c.hf.heightAt(k.pos.x, k.pos.z);
      k.pos.y = g;
      // the gait: a quicker step than the wolf's (a smaller animal)
      const step = Math.floor(k.phase / Math.PI);
      k.phase += c.dt * (k.speed > 6 ? 11 : 3.6 + k.speed * 1.9);
      // flat out, every other stride throws dust back off the paws
      if (k.speed > 6 && Math.floor(k.phase / Math.PI) !== step && step % 2 === 0) c.combat?.puffs?.emit(k.pos, 1, 0.35, 0.3, 0.35);
      const tgt = lookAt ?? (this.state === 'feed' ? this.goal : null);
      const lookYaw = tgt ? clamp(angDiff(k.yaw, Math.atan2(tgt.x - k.pos.x, tgt.z - k.pos.z)), -1.1, 1.1) : 0;
      k.look = lerp(k.look, lookYaw, Math.min(1, c.dt * 3));
      k.nod = Math.max(0, k.nod - c.dt);
      const feeding = this.state === 'feed' && k.speed < 0.3;
      k.low = lerp(k.low, feeding ? 1 : this.state === 'watch' ? 0.25 : 0, Math.min(1, c.dt * 3));
      if (!viewCull.sees(_cy.set(k.pos.x, g + 0.4, k.pos.z), 1.2)) { S.hide(k.slot); return; }
      const fx = Math.sin(k.yaw) * 0.3, fz = Math.cos(k.yaw) * 0.3;
      const pitch = -Math.atan2(c.hf.heightAt(k.pos.x + fx, k.pos.z + fz) - c.hf.heightAt(k.pos.x - fx, k.pos.z - fz), 0.6);
      const A = k.speed < 0.2 ? 0 : k.speed > 6 ? 0.85 : 0.45;
      S.pose(k.slot, {
        pos: _cy2.set(k.pos.x, g, k.pos.z), yaw: k.yaw, pitch: pitch * 0.8, roll: 0, bob: 0, phase: k.phase, amp: A, low: k.low,
        look: k.look, nod: k.nod > 0 ? 0.85 : feeding ? -0.55 + Math.max(0, Math.sin(c.t * 2.4 + i)) * -0.25 : k.speed > 6 ? -0.12 : 0.05,
        tail: k.speed > 6 ? -0.35 : feeding ? -0.15 : -0.05 + Math.sin(c.t * 1.6 + i) * 0.05, deadT: -1, side: 1,
      });
    });
  }
}
const _cy = new THREE.Vector3(), _cy2 = new THREE.Vector3();

export class Fauna {
  readonly mesh: THREE.Mesh;
  private P: Float32Array;
  private N: Float32Array;
  private bodies: Body[] = [];
  readonly vultures: Vulture[] = [];
  readonly ravens: Raven[] = [];
  readonly rabbits: Rabbit[] = [];
  readonly lizards: Lizard[] = [];
  readonly butterflies: Butterfly[] = [];
  private flies: Flies;
  readonly pack: Pack;
  readonly critters: Critters;
  private snakes: Snake[] = [];
  private scorpions: Scorpion[] = [];
  /** Coyotes at night (only with the Meshy wolf model loaded); registered with Combat to hear shots. */
  readonly coyotes = new Coyotes();
  /** Fresh kills (contractors, wolves): vultures circle them by day, coyotes nose round them by night. */
  private carcasses: { p: THREE.Vector3; t: number }[] = [];
  private t = 0;
  /** Places wolves won't follow you into (the camp fire, Dry Creek); set by Game. */
  safe: { p: THREE.Vector3; r: number }[] = [];
  combat?: Combat;
  /** The camera's forward (torchlight on a wolf). */
  camFwd?: THREE.Vector3;

  constructor(private hf: Heightfield, perches: THREE.Vector3[], wrecks: THREE.Vector3[]) {
    _seed = 4711;
    const raven = birdRig({ body: [0.09, 0.09, 0.1], wing: [0.07, 0.07, 0.08], head: [0.09, 0.09, 0.1], beak: [0.12, 0.12, 0.12], span: 1, fingers: false });
    const vulture = birdRig({ body: [0.2, 0.16, 0.13], wing: [0.14, 0.11, 0.09], head: [0.5, 0.26, 0.22], beak: [0.75, 0.7, 0.6], span: 1.25, fingers: true, headScale: 0.65 });
    const rabbit = rabbitRig(), lizard = lizardRig(), wolf = wolfRig(), flies = fliesRig(24), snake = snakeRig(), scorp = scorpionRig();
    const flyCols: [number, number, number][] = [[0.92, 0.55, 0.15], [0.95, 0.92, 0.85], [0.95, 0.85, 0.3], [0.5, 0.6, 0.9]];
    const butterflies = flyCols.map((col) => butterflyRig(col));
    const plan: [Rig, number][] = [[vulture.R, 3], [raven.R, 7], [rabbit.R, 3], [lizard.R, 4], [wolf.R, 5], [flies.R, 1], [snake.R, 3], [scorp.R, 4], ...butterflies.map((b) => [b.R, 1] as [Rig, number])];
    let verts = 0, tris = 0;
    for (const [rig, n] of plan) { verts += rig.verts * n; tris += rig.tris * n; }
    this.P = new Float32Array(verts * 3);
    this.N = new Float32Array(verts * 3);
    const col = new Uint8Array(verts * 4), idx = new Uint32Array(tris * 3);
    let v = 0, i = 0;
    const make = (rig: Rig) => {
      const b = new Body(rig, v);
      for (const part of rig.parts) {
        col.set(part.col, v * 4);
        for (let k = 0; k < part.idx.length; k++) idx[i + k] = part.idx[k] + v;
        v += part.pos.length / 3;
        i += part.idx.length;
      }
      for (let k = 0; k < rig.parts.length; k++) b.pose(k);
      this.bodies.push(b);
      return b;
    };
    for (let k = 0; k < 3; k++) this.vultures.push(new Vulture(make(vulture.R), vulture, k));
    const taken = new Set<THREE.Vector3>();
    for (let k = 0; k < 7; k++) this.ravens.push(new Raven(make(raven.R), raven, perches, taken));
    for (let k = 0; k < 3; k++) this.rabbits.push(new Rabbit(make(rabbit.R), rabbit));
    for (let k = 0; k < 4; k++) this.lizards.push(new Lizard(make(lizard.R), lizard));
    this.pack = new Pack([0, 1, 2, 3, 4].map(() => new Wolf(make(wolf.R), wolf)));
    this.flies = new Flies(make(flies.R), flies, wrecks);
    for (let k = 0; k < 3; k++) this.snakes.push(new Snake(make(snake.R), snake));
    for (let k = 0; k < 4; k++) this.scorpions.push(new Scorpion(make(scorp.R), scorp, wrecks));
    this.critters = new Critters(this.snakes, this.scorpions);
    this.pack.onDown = (at) => this.addCarcass(at);
    // a shot scatters the desert: ravens off their perches, jackrabbits bolting, lizards gone, the
    // vultures on a kill lifting off
    this.coyotes.onShot = (p, r) => {
      const near = (q: THREE.Vector3, k: number) => Math.hypot(q.x - p.x, q.z - p.z) < Math.min(r, k);
      for (const x of this.ravens) if (x.state === 'perch' && near(x.pos, 110)) x.startle = true;
      for (const x of this.rabbits) if (x.state !== 'gone' && near(x.pos, 70)) x.startle = true;
      for (const x of this.lizards) if (x.state === 'still' && near(x.pos, 25)) x.startle = true;
      for (const x of this.vultures) if (near(x.pos, 140)) x.spook = 4;
    };
    for (const bf of butterflies) this.butterflies.push(new Butterfly(make(bf.R), bf));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N, 3));
    g.setAttribute('fColor', new THREE.BufferAttribute(col, 4, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, floraMaterial());
    this.mesh.name = 'fauna';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // pose everything once (all hidden) so the buffers are valid from the start
    for (const b of this.bodies) b.write(this.P, this.N);
  }

  /** Something died at `p` (Recovery's kills, the pack's losses): carrion for a while (8 play-minutes). */
  addCarcass(p: THREE.Vector3) {
    this.carcasses.push({ p: p.clone(), t: this.t });
    if (this.carcasses.length > 4) this.carcasses.shift();
  }

  /** The freshest kill within `r` of the player, if any. */
  private carcass(player: THREE.Vector3, r: number) {
    if (this.carcasses.length && this.t - this.carcasses[0].t >= 480) this.carcasses = this.carcasses.filter((k) => this.t - k.t < 480);
    let best: THREE.Vector3 | null = null, bt = -1;
    for (const k of this.carcasses) if (k.t > bt && Math.hypot(k.p.x - player.x, k.p.z - player.z) < r) { bt = k.t; best = k.p; }
    return best;
  }

  /** Counts for debugging (window.game.fauna.census()). */
  census() {
    return {
      vultures: this.vultures.filter((x) => x.b.visible).length,
      vultureStates: this.vultures.map((x) => x.state),
      carcasses: this.carcasses.length,
      coyotes: this.coyotes.state,
      ravens: this.ravens.map((x) => x.state),
      rabbits: this.rabbits.map((x) => x.state),
      lizards: this.lizards.map((x) => x.state),
      wolves: this.pack.state,
      wolfPos: this.pack.wolves[0].pos.clone(),
      wolfHp: this.pack.wolves.map((w) => (w.out ? Math.round(w.hp) : -1)),
      morale: +this.pack.morale.toFixed(2),
      flies: !!this.flies.center,
      butterflies: this.butterflies.filter((x) => x.on).length,
      snakes: this.snakes.map((x) => x.state),
      scorpions: this.scorpions.map((x) => x.state),
    };
  }

  /** Debug (prop lab): every creature posed in a row along x around `at`, flat ground at y = at.y. */
  lineup(at: THREE.Vector3) {
    const far = at.clone().add(V(0, 0, 9999));
    const c: Ctx = { hf: this.hf, player: far, hour: 12, dt: 0.016, t: 1.3, sprinting: false, safe: [] };
    const p = (x: number, y: number, z: number) => at.clone().add(V(x, y, z));
    const v = this.vultures[0];
    v.update(c, null);
    v.b.place(p(-5.2, 1.6, 0), 0.6, 0, -0.25, 2.4);
    // a second one down on a kill, feeding
    const v2 = this.vultures[1];
    v2.state = 'feed'; v2.center.copy(p(-6.2, 0, 1.9)); v2.spot.copy(p(-6.6, 0, 0.6)); v2.update(c, v2.center);
    const [r0, r1] = this.ravens;
    r0.state = 'perch'; r0.pos.copy(p(-3.4, 0.11, 0.4)); r0.update(c);
    r1.state = 'fly'; r1.pos.copy(p(-3.4, 1.4, -0.4)); r1.vel.set(1, 0.5, 0.3); r1.phase = 1.2; r1.update(c);
    const [a, b] = this.rabbits;
    a.state = 'idle'; a.pos.copy(p(-2, 0, 0.6)); a.wait = 99; a.yaw = 0.8; a.update(c);
    b.state = 'hop'; b.pos.copy(p(-2, 0, -0.6)); b.hops = 9; b.from.copy(b.pos); b.to.copy(b.pos).add(V(0.8, 0, 0)); b.hopU = 0.35; b.speed = 0; b.yaw = 1.57; b.update(c);
    const l = this.lizards[0];
    l.state = 'dash'; l.pos.copy(p(-0.8, 0, 0.5)); l.run = 9; l.yaw = 0.5; l.update(c);
    const w = this.pack.wolves;
    w.forEach((x, i) => { x.out = i < 3; x.pos.copy(p(1.2 + i * 1.6, 0, i % 2 ? 0.8 : -0.4)); x.yaw = 1.2 + i * 0.6; });
    w[0].speed = 2.6; w[0].phase = 0.8; w[0].animate(c, null);
    w[1].speed = 0; w[1].animate(c, at.clone().add(V(0, 0, 10)));
    w[2].speed = 0; w[2].howl = 2; w[2].animate(c, null);
    const bf = this.butterflies[0];
    bf.on = true; bf.home.copy(p(0.2, 0, 1)); bf.pos.copy(p(0.2, 0.9, 1)); bf.update({ ...c, player: at, hour: 12 });
    for (const x of [v.b, v2.b, r0.b, r1.b, a.b, b.b, l.b, ...w.slice(0, 3).map((x) => x.b), bf.b]) x.visible = true;
    for (const x of this.bodies) x.write(this.P, this.N);
  }

  /** Debug/test: bring the pack in now at `d` m from the player (`hunt`: already on you). */
  summonPack(player: THREE.Vector3, d = 60, hunt = false, size = 0) {
    const p = this.pack;
    p.state = 'gone';
    p.wait = 0;
    p.update(this.ctx(player, 12, 0, false));
    if (size) { p.size = size; p.wolves.forEach((w, i) => { w.out = w.alive = i < size; }); }
    const a = Math.random() * 6.28;
    p.wolves.forEach((w, i) => w.pos.set(player.x + Math.cos(a) * d + i * 1.5, 0, player.z + Math.sin(a) * d - i * 2));
    p.state = hunt ? 'stalk' : 'watch';
    p.hunting = hunt;
    p.watchT = 30;
  }

  /** The Meshy wolf, if it loaded (null: the procedural one). */
  skins: WolfSkins | null = null;
  /** Load the wolf model and hand each pack member its slot. Before the boot shader warm-up. */
  async loadModels() {
    if (new URLSearchParams(location.search).has('procwolf')) return this.models; // A/B against the old wolf
    this.skins = await WolfSkins.load(this.pack.wolves.length);
    if (this.skins) {
      this.pack.wolves.forEach((w, i) => { w.skin = this.skins; w.slot = i; });
      this.models.add(this.skins.group);
      // coyotes: the same model, a third smaller, the coat warmed to tawny
      this.coyotes.skins = await WolfSkins.load(this.coyotes.pack.length, { height: 0.7, tint: [1.32, 1.08, 0.78], name: 'coyotes' });
      if (this.coyotes.skins) this.models.add(this.coyotes.skins.group);
    }
    if (new URLSearchParams(location.search).has('procfauna')) return this.models;
    const [snakes, scorps] = await Promise.all([SnakeSkins.load(this.snakes.length), ScorpionSkins.load(this.scorpions.length)]);
    if (snakes) { this.snakeSkins = snakes; this.models.add(snakes.mesh); for (const x of this.snakes) x.b.ghost = true; }
    if (scorps) { this.scorpSkins = scorps; this.models.add(scorps.mesh); for (const x of this.scorpions) x.b.ghost = true; }
    return this.models;
  }
  /** Every Meshy creature's mesh (wolves, snakes, scorpions): added to the scene by the game. */
  readonly models = new THREE.Group();
  private snakeSkins: SnakeSkins | null = null;
  private scorpSkins: ScorpionSkins | null = null;

  private ctx(player: THREE.Vector3, hour: number, dt: number, sprinting: boolean, audio?: AudioEngine): Ctx {
    return { hf: this.hf, player, hour, dt, t: this.t, audio, sprinting, combat: this.combat, safe: this.safe, camFwd: this.camFwd };
  }

  update(dt: number, player: THREE.Vector3, hour: number, audio: AudioEngine | undefined, sprinting: boolean) {
    this.t += dt;
    const c = this.ctx(player, hour, Math.min(dt, 0.1), sprinting, audio);
    this.pack.audio = audio;
    this.coyotes.audio = audio;
    // the vultures go to the freshest kill near you (by day); the coyotes find it at night
    const kill = this.carcass(player, 260);
    for (const x of this.vultures) x.update(c, kill);
    this.coyotes.update(c, kill);
    for (const x of this.ravens) x.update(c);
    for (const x of this.rabbits) x.update(c);
    for (const x of this.lizards) x.update(c);
    for (const x of this.butterflies) x.update(c);
    this.flies.update(c);
    this.pack.update(c);
    for (const x of this.snakes) x.update(c);
    for (const x of this.scorpions) x.update(c);
    // only the bodies that were rewritten go up to the GPU (runs of neighbours as one range)
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const nrm = this.mesh.geometry.attributes.normal as THREE.BufferAttribute;
    let any = false, s0 = -1, s1 = -1;
    const range = () => {
      if (s0 < 0) return;
      pos.addUpdateRange(s0 * 3, (s1 - s0) * 3);
      nrm.addUpdateRange(s0 * 3, (s1 - s0) * 3);
    };
    for (const b of this.bodies) {
      if (!b.write(this.P, this.N)) continue;
      any = true;
      if (b.v0 === s1) s1 = b.v0 + b.count;
      else { range(); s0 = b.v0; s1 = b.v0 + b.count; }
    }
    range();
    // ranges pile up while the mesh isn't drawn (interior mode): past a few, send the whole buffer
    if (pos.updateRanges.length > 48) { pos.clearUpdateRanges(); nrm.clearUpdateRanges(); }
    // the Meshy snakes and scorpions follow their (ghost) procedural bodies
    // (and their meshes cost no draws, scene or shadow, while none is out)
    if (this.snakeSkins) {
      this.snakes.forEach((x, i) => this.snakeSkins!.set(i, x.b.visible ? x.rig.segs.map((k) => x.b.world[k]) : null, x.b.visible ? x.b.world[x.rig.head] : null));
      this.snakeSkins.mesh.visible = this.snakes.some((x) => x.b.visible);
    }
    if (this.scorpSkins) {
      this.scorpions.forEach((x, i) => this.scorpSkins!.set(i, x.b.visible ? x.b.root : null));
      this.scorpSkins.mesh.visible = this.scorpions.some((x) => x.b.visible);
    }
    if (any) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  }
}
