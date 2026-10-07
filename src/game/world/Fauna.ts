import * as THREE from 'three/webgpu';
import { Plant, FUR, LEAF } from './flora';
import { floraMaterial } from './materials';
import type { Heightfield } from './Heightfield';
import type { AudioEngine, LoopHandle } from '@/engine/audio';

/**
 * The desert's wildlife: vultures on the thermals, ravens on the poles and wrecks, jackrabbits,
 * lizards, butterflies down in the wash, flies over the wrecks, and a wolf pack that keeps its
 * distance. Ambient: nothing here can hurt you, and everything is shy of you.
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

// ------------------------------------------------------------------ the shared mesh

/** One posed creature: a slice of the shared buffers. */
class Body {
  readonly local: THREE.Matrix4[];
  readonly world: THREE.Matrix4[];
  readonly root = new THREE.Matrix4();
  visible = false;
  private wasVisible = true;
  constructor(readonly rig: Rig, readonly v0: number) {
    this.local = rig.parts.map(() => new THREE.Matrix4());
    this.world = rig.parts.map(() => new THREE.Matrix4());
  }
  private static _q = new THREE.Quaternion();
  private static _e = new THREE.Euler(0, 0, 0, 'YXZ');
  private static _one = new THREE.Vector3(1, 1, 1);
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
  /** Write the posed vertices. Returns false when nothing needed writing. */
  write(P: Float32Array, N: Float32Array) {
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
    const nm = new THREE.Matrix3();
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
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
      }
    }
    return true;
  }
}

// ------------------------------------------------------------------ creatures

interface Ctx { hf: Heightfield; player: THREE.Vector3; hour: number; dt: number; t: number; audio?: AudioEngine; sprinting: boolean }
const DAY = (h: number) => h > 6.8 && h < 18.6;

class Vulture {
  center = new THREE.Vector3();
  ang = Math.random() * 6.28;
  R = rnd(22, 40);
  alt = rnd(42, 70);
  dir = Math.random() < 0.5 ? 1 : -1;
  flapT = rnd(4, 12);
  flap = 0;
  repick = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof birdRig>) {}
  update(c: Ctx) {
    const active = DAY(c.hour);
    this.b.visible = active;
    if (!active) { this.repick = 0; return; }
    if ((this.repick -= c.dt) <= 0 || this.center.distanceTo(c.player) > 260) {
      this.repick = rnd(50, 110);
      const a = Math.random() * 6.28, d = rnd(40, 160);
      this.center.set(c.player.x + Math.cos(a) * d, 0, c.player.z + Math.sin(a) * d);
    }
    this.ang += (this.dir * c.dt * 7) / this.R;
    const ground = c.hf.heightAt(this.center.x, this.center.z);
    const p = V(this.center.x + Math.cos(this.ang) * this.R, ground + this.alt + Math.sin(this.ang * 0.5 + this.R) * 3, this.center.z + Math.sin(this.ang) * this.R);
    const yaw = Math.atan2(-Math.sin(this.ang) * this.dir, Math.cos(this.ang) * this.dir);
    // the odd few lazy wingbeats to stay up, otherwise wings flat in a slight V
    if ((this.flapT -= c.dt) <= 0) { this.flapT = rnd(8, 18); this.flap = 2.2; }
    this.flap = Math.max(0, this.flap - c.dt);
    const beat = this.flap > 0 ? Math.sin(c.t * 6) * 0.45 : 0;
    this.b.place(p, yaw, 0, -this.dir * 0.32, 2.4);
    const [li, lo, ri, ro] = this.rig.wings;
    this.b.pose(li, 0, 0, 0.12 + beat); this.b.pose(lo, 0, 0, 0.06 + beat * 0.5);
    this.b.pose(ri, 0, 0, -0.12 - beat); this.b.pose(ro, 0, 0, -0.06 - beat * 0.5);
    this.b.pose(this.rig.head, 0.15, Math.sin(c.t * 0.7 + this.R) * 0.4, 0);
    this.b.pose(this.rig.legs, 1.4, 0, 0);
  }
}

class Raven {
  state: 'perch' | 'fly' | 'gone' = 'gone';
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
      if (d < (c.sprinting ? 16 : 10)) {
        // spooked: up and away from you
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
    if (this.state !== 'flee' && d < (c.sprinting ? 22 : 13)) {
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
      if (d < 3.5 || this.wait <= 0) {
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

class Wolf {
  pos = new THREE.Vector3();
  yaw = 0;
  phase = Math.random() * 6;
  speed = 0;
  howl = 0;
  look = 0;
  constructor(readonly b: Body, readonly rig: ReturnType<typeof wolfRig>) {}
  /** Pose for this frame at `speed` (m/s); `watch` turns the head toward `target`. */
  animate(c: Ctx, target: THREE.Vector3 | null) {
    const sp = this.speed;
    this.phase += c.dt * (sp > 6 ? 9.5 : 3 + sp * 1.6);
    const A = sp < 0.2 ? 0 : sp > 6 ? 0.85 : 0.45;
    const g = c.hf.heightAt(this.pos.x, this.pos.z);
    const bob = A ? Math.abs(Math.sin(this.phase)) * 0.035 : 0;
    // body pitch follows the ground under the shoulders and hips
    const fx = Math.sin(this.yaw) * 0.4, fz = Math.cos(this.yaw) * 0.4;
    const pitch = -Math.atan2(c.hf.heightAt(this.pos.x + fx, this.pos.z + fz) - c.hf.heightAt(this.pos.x - fx, this.pos.z - fz), 0.8);
    this.b.place(V(this.pos.x, g + 0.8 + bob, this.pos.z), this.yaw, pitch, 0, 1.3);
    const { legs, neck, head, tail } = this.rig;
    legs.forEach((l, k) => {
      // trot: diagonal pairs move together
      const ph = this.phase + (k === 0 || k === 3 ? 0 : Math.PI);
      const swing = Math.sin(ph) * A;
      const lift = Math.max(0, Math.cos(ph)) * A;
      if (l.hind) {
        this.b.pose(l.upper, -0.25 + swing, 0, 0);
        this.b.pose(l.lower, 0.55 - lift * 0.9, 0, 0);
      } else {
        this.b.pose(l.upper, swing, 0, 0);
        this.b.pose(l.lower, lift * 1.1, 0, 0);
      }
    });
    let lookYaw = 0;
    if (target) lookYaw = clamp(angDiff(this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z)), -1.1, 1.1);
    this.look = lerp(this.look, lookYaw, Math.min(1, c.dt * 3));
    const howling = this.howl > 0;
    this.b.pose(neck, howling ? -0.9 : sp > 6 ? 0.35 : 0.05, this.look * 0.5, 0);
    this.b.pose(head, howling ? -0.55 : 0.1 + (A ? Math.sin(this.phase * 2) * 0.04 : 0), this.look * 0.5, 0);
    this.b.pose(tail, (sp > 6 ? -0.35 : 0.15) + Math.sin(c.t * 2 + this.phase) * 0.05, Math.sin(c.t * 1.3) * 0.12, 0);
  }
}

/** The pack: a leader picks a line across the land; the others keep station on it. */
class Pack {
  state: 'gone' | 'travel' | 'watch' | 'flee' = 'gone';
  wait = rnd(30, 80);
  goal = new THREE.Vector3();
  watchT = 0;
  nextWatch = 0;
  howlT = 0;
  constructor(readonly wolves: Wolf[]) {}
  private offsets = [V(0, 0, 0), V(1.8, 0, -2.5), V(-1.6, 0, -4.1)];
  update(c: Ctx) {
    const lead = this.wolves[0];
    if (this.state === 'gone') {
      for (const w of this.wolves) w.b.visible = false;
      if ((this.wait -= c.dt) > 0) return;
      const p = openSpot(c, 95, 130, 15);
      if (!p) { this.wait = 5; return; }
      // a line that passes the player at a distance, not through them
      const toward = V(c.player.x - p.x, 0, c.player.z - p.z);
      const side = V(-toward.z, 0, toward.x).normalize().multiplyScalar(rnd(50, 80) * (Math.random() < 0.5 ? 1 : -1));
      this.goal.copy(c.player).add(side).addScaledVector(toward, 0.9);
      this.wolves.forEach((w, i) => { w.pos.copy(p).add(this.offsets[i]); w.yaw = Math.atan2(this.goal.x - p.x, this.goal.z - p.z); });
      this.state = 'travel';
      this.nextWatch = rnd(8, 20);
      return;
    }
    const d = Math.hypot(lead.pos.x - c.player.x, lead.pos.z - c.player.z);
    for (const w of this.wolves) w.b.visible = d < 260;
    const night = c.hour > 19 || c.hour < 5.5;
    if (this.state !== 'flee' && d < (c.sprinting ? 45 : 32)) this.state = 'flee';
    let target: THREE.Vector3 | null = null;
    let speed = 0;
    if (this.state === 'travel') {
      speed = 2.6;
      const to = V(this.goal.x - lead.pos.x, 0, this.goal.z - lead.pos.z);
      if (to.length() < 4 || c.hf.zoneDistance(lead.pos.x + Math.sin(lead.yaw) * 6, lead.pos.z + Math.cos(lead.yaw) * 6) < 10) {
        // re-aim past the player again, the far side
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
        const w = this.wolves[Math.floor(Math.random() * this.wolves.length)];
        w.howl = 3.2;
        c.audio?.howl(w.pos.clone().setY(w.pos.y + 1));
      }
      if (this.watchT <= 0) { this.state = 'travel'; this.nextWatch = rnd(15, 35); }
    } else {
      speed = 10;
      const away = Math.atan2(lead.pos.x - c.player.x, lead.pos.z - c.player.z);
      lead.yaw += clamp(angDiff(lead.yaw, away), -1, 1) * c.dt * 4;
    }
    if (d > 190 || (this.state === 'flee' && d > 150)) { this.state = 'gone'; this.wait = rnd(80, 200); return; }
    lead.speed = lerp(lead.speed, speed, Math.min(1, c.dt * 3));
    lead.pos.x += Math.sin(lead.yaw) * lead.speed * c.dt;
    lead.pos.z += Math.cos(lead.yaw) * lead.speed * c.dt;
    // followers: station-keep on offsets in the leader's frame
    for (let i = 1; i < this.wolves.length; i++) {
      const w = this.wolves[i];
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
    for (const w of this.wolves) {
      w.howl = Math.max(0, w.howl - c.dt);
      w.animate(c, target);
    }
  }
}

// ------------------------------------------------------------------ the system

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
  private pack: Pack;
  private t = 0;

  constructor(private hf: Heightfield, perches: THREE.Vector3[], wrecks: THREE.Vector3[]) {
    _seed = 4711;
    const raven = birdRig({ body: [0.09, 0.09, 0.1], wing: [0.07, 0.07, 0.08], head: [0.09, 0.09, 0.1], beak: [0.12, 0.12, 0.12], span: 1, fingers: false });
    const vulture = birdRig({ body: [0.2, 0.16, 0.13], wing: [0.14, 0.11, 0.09], head: [0.5, 0.26, 0.22], beak: [0.75, 0.7, 0.6], span: 1.25, fingers: true, headScale: 0.65 });
    const rabbit = rabbitRig(), lizard = lizardRig(), wolf = wolfRig(), flies = fliesRig(24);
    const flyCols: [number, number, number][] = [[0.92, 0.55, 0.15], [0.95, 0.92, 0.85], [0.95, 0.85, 0.3], [0.5, 0.6, 0.9]];
    const butterflies = flyCols.map((col) => butterflyRig(col));
    const plan: [Rig, number][] = [[vulture.R, 3], [raven.R, 7], [rabbit.R, 3], [lizard.R, 4], [wolf.R, 3], [flies.R, 1], ...butterflies.map((b) => [b.R, 1] as [Rig, number])];
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
    for (let k = 0; k < 3; k++) this.vultures.push(new Vulture(make(vulture.R), vulture));
    const taken = new Set<THREE.Vector3>();
    for (let k = 0; k < 7; k++) this.ravens.push(new Raven(make(raven.R), raven, perches, taken));
    for (let k = 0; k < 3; k++) this.rabbits.push(new Rabbit(make(rabbit.R), rabbit));
    for (let k = 0; k < 4; k++) this.lizards.push(new Lizard(make(lizard.R), lizard));
    this.pack = new Pack([0, 1, 2].map(() => new Wolf(make(wolf.R), wolf)));
    this.flies = new Flies(make(flies.R), flies, wrecks);
    for (const bf of butterflies) this.butterflies.push(new Butterfly(make(bf.R), bf));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N, 3));
    g.setAttribute('fColor', new THREE.BufferAttribute(col, 4, true));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    (g.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(g, floraMaterial());
    this.mesh.name = 'fauna';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // pose everything once (all hidden) so the buffers are valid from the start
    for (const b of this.bodies) b.write(this.P, this.N);
  }

  /** Counts for debugging (window.game.fauna.census()). */
  census() {
    return {
      vultures: this.vultures.filter((x) => x.b.visible).length,
      ravens: this.ravens.map((x) => x.state),
      rabbits: this.rabbits.map((x) => x.state),
      lizards: this.lizards.map((x) => x.state),
      wolves: this.pack.state,
      wolfPos: this.pack.wolves[0].pos.clone(),
      flies: !!this.flies.center,
      butterflies: this.butterflies.filter((x) => x.on).length,
    };
  }

  /** Debug (prop lab): every creature posed in a row along x around `at`, flat ground at y = at.y. */
  lineup(at: THREE.Vector3) {
    const far = at.clone().add(V(0, 0, 9999));
    const c: Ctx = { hf: this.hf, player: far, hour: 12, dt: 0.016, t: 1.3, sprinting: false };
    const p = (x: number, y: number, z: number) => at.clone().add(V(x, y, z));
    const v = this.vultures[0];
    v.update(c);
    v.b.place(p(-5.2, 1.6, 0), 0.6, 0, -0.25, 2.4);
    const [r0, r1] = this.ravens;
    r0.state = 'perch'; r0.pos.copy(p(-3.4, 0.11, 0.4)); r0.update(c);
    r1.state = 'fly'; r1.pos.copy(p(-3.4, 1.4, -0.4)); r1.vel.set(1, 0.5, 0.3); r1.phase = 1.2; r1.update(c);
    const [a, b] = this.rabbits;
    a.state = 'idle'; a.pos.copy(p(-2, 0, 0.6)); a.wait = 99; a.yaw = 0.8; a.update(c);
    b.state = 'hop'; b.pos.copy(p(-2, 0, -0.6)); b.hops = 9; b.from.copy(b.pos); b.to.copy(b.pos).add(V(0.8, 0, 0)); b.hopU = 0.35; b.speed = 0; b.yaw = 1.57; b.update(c);
    const l = this.lizards[0];
    l.state = 'dash'; l.pos.copy(p(-0.8, 0, 0.5)); l.run = 9; l.yaw = 0.5; l.update(c);
    const w = this.pack.wolves;
    w.forEach((x, i) => { x.pos.copy(p(1.2 + i * 1.6, 0, i % 2 ? 0.8 : -0.4)); x.yaw = 1.2 + i * 0.6; });
    w[0].speed = 2.6; w[0].phase = 0.8; w[0].animate(c, null);
    w[1].speed = 0; w[1].animate(c, at.clone().add(V(0, 0, 10)));
    w[2].speed = 0; w[2].howl = 2; w[2].animate(c, null);
    const bf = this.butterflies[0];
    bf.on = true; bf.home.copy(p(0.2, 0, 1)); bf.pos.copy(p(0.2, 0.9, 1)); bf.update({ ...c, player: at, hour: 12 });
    for (const x of [v.b, r0.b, r1.b, a.b, b.b, l.b, ...w.map((x) => x.b), bf.b]) x.visible = true;
    for (const x of this.bodies) x.write(this.P, this.N);
  }

  /** Debug/test: bring the pack in now at `d` m from the player. */
  summonPack(player: THREE.Vector3, d = 60) {
    const p = this.pack;
    p.state = 'gone';
    p.wait = 0;
    p.update({ hf: this.hf, player, hour: 12, dt: 0, t: this.t, sprinting: false });
    const a = Math.random() * 6.28;
    p.wolves.forEach((w, i) => w.pos.set(player.x + Math.cos(a) * d + i * 1.5, 0, player.z + Math.sin(a) * d - i * 2));
    p.state = 'watch';
    p.watchT = 30;
  }

  update(dt: number, player: THREE.Vector3, hour: number, audio: AudioEngine | undefined, sprinting: boolean) {
    this.t += dt;
    const c: Ctx = { hf: this.hf, player, hour, dt: Math.min(dt, 0.1), t: this.t, audio, sprinting };
    for (const x of this.vultures) x.update(c);
    for (const x of this.ravens) x.update(c);
    for (const x of this.rabbits) x.update(c);
    for (const x of this.lizards) x.update(c);
    for (const x of this.butterflies) x.update(c);
    this.flies.update(c);
    this.pack.update(c);
    let any = false;
    for (const b of this.bodies) any = b.write(this.P, this.N) || any;
    if (any) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  }
}
