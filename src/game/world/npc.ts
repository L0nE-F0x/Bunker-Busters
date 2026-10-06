import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, positionGeometry, normalGeometry, normalLocal, uniformArray, time, sin, cos, max, min, vec3,
  float, normalize, cameraPosition, positionWorld, normalWorld, dot, pow, mix, smoothstep,
} from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import { rimColor, rimStrength } from './materials';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Townsfolk: stylized low-poly people, all of a site's figures in ONE mesh and ONE material.
 *
 * Each figure is posed once on the CPU (a little two-bone IK for arms and legs), then baked into a
 * merged geometry whose per-vertex attributes carry the paint (`nCol`: linear rgb + roughness) and
 * the rig (`nRig`: figure index, head weight, upper-body weight, breath weight). The vertex shader
 * breathes, sways and turns the head and shoulders from two small uniform arrays, so idle life and
 * "look at the player" cost a few floats per figure per frame and no extra draw calls.
 */

export type Hat = 'none' | 'brim' | 'cap' | 'beanie' | 'hood' | 'bandana';
export type HairStyle = 'short' | 'bun' | 'long' | 'braid' | 'bald' | 'crop';
export type Beard = 'none' | 'stubble' | 'full' | 'long' | 'mustache';

export interface NpcLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard?: Beard;
  /** torso width (0.9 lean … 1.2 heavy) */
  build?: number;
  /** overall scale (1 = 1.75 m) */
  height?: number;
  fem?: boolean;
  shirt: string;
  pants: string;
  boots?: string;
  /** a coat over the shirt; `coatLen` 0 = jacket, 0.5 = hip, 1 = duster to the shin */
  coat?: string;
  coatLen?: number;
  vest?: string;
  scarf?: string;
  apron?: string;
  shawl?: string;
  hat?: Hat;
  hatColor?: string;
  glasses?: boolean;
  gloves?: string;
  sleeves?: 'long' | 'rolled';
  belt?: string;
}

export type NpcPose = 'stand' | 'hip' | 'crossed' | 'counter' | 'clipboard' | 'warm' | 'mug' | 'tend';

export interface NpcDef {
  id: string;
  look: NpcLook;
  pose: NpcPose;
  /** feet, in the crowd's local space */
  x: number; y: number; z: number;
  /** facing: 0 looks down +Z */
  yaw: number;
  /** seated poses: seat height above the feet */
  seat?: number;
  /** counter/tend poses: work-surface height above the feet */
  surface?: number;
  /** how far (m) the figure notices you */
  notice?: number;
}

interface Figure {
  def: NpcDef;
  neck: THREE.Vector3;
  hipY: number;
  yaw: number;
  look: number;
  nod: number;
  idle: number;
}

const MAX = 16;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

class Sink {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  rig: number[] = [];
  /** body-space height used to darken the figure toward the feet (cheap grounding AO) */
  private body = new THREE.Matrix4();
  private bodyInv = new THREE.Matrix4();
  private c = new THREE.Color();
  idx = 0;

  setBody(m: THREE.Matrix4) {
    this.body.copy(m);
    this.bodyInv.copy(m).invert();
  }

  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: string | THREE.Color, rough: number, hw: number, cw: number, bw = 0) {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.applyMatrix4(m);
    const P = geo.attributes.position as THREE.BufferAttribute;
    const Nn = geo.attributes.normal as THREE.BufferAttribute;
    const base = typeof color === 'string' ? new THREE.Color(color) : color;
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.set(P.getX(i), P.getY(i), P.getZ(i));
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      v.applyMatrix4(this.bodyInv);
      const k = 0.74 + 0.26 * Math.min(1, Math.max(0, v.y / 1.35));
      this.c.copy(base).multiplyScalar(k);
      this.col.push(this.c.r, this.c.g, this.c.b, rough);
      this.rig.push(this.idx, hw, cw, bw);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('nCol', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('nRig', new THREE.Float32BufferAttribute(this.rig, 4));
    g.computeBoundingSphere();
    return g;
  }
}

const M4 = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => M4().makeTranslation(x, y, z);
const Rx = (a: number) => M4().makeRotationX(a);
const Ry = (a: number) => M4().makeRotationY(a);
const Rz = (a: number) => M4().makeRotationZ(a);
const S = (x: number, y = x, z = x) => M4().makeScale(x, y, z);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.clone().multiply(b));

/** Matrix that maps +Y onto the segment a→b (origin at the midpoint). */
function along(a: THREE.Vector3, b: THREE.Vector3, twist = 0) {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, twist));
  return M4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1));
}

/** Two-bone IK: elbow/knee position for root→target with lengths la, lb, bending toward `pole`. */
function ik(root: THREE.Vector3, target: THREE.Vector3, la: number, lb: number, pole: THREE.Vector3) {
  const d = target.clone().sub(root);
  const len = Math.min(d.length(), (la + lb) * 0.999);
  const dir = d.normalize();
  const end = root.clone().addScaledVector(dir, len);
  const cosA = THREE.MathUtils.clamp((la * la + len * len - lb * lb) / (2 * la * len), -1, 1);
  const a = Math.acos(cosA);
  // bend plane: dir and the pole's component perpendicular to it
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  p.normalize();
  const mid = root.clone().addScaledVector(dir, Math.cos(a) * la).addScaledVector(p, Math.sin(a) * la);
  return { mid, end };
}

const sphere = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const tube = (r0: number, r1: number, len: number, seg = 9) => new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);

interface Paint { c: string; r: number }

/**
 * Bakes one figure into `out`. Body space: feet at the origin, facing +Z, metres at height 1.
 * Returns the neck pivot and hip height (both in crowd space) for the shader rig.
 */
function figure(out: Sink, def: NpcDef) {
  const L = def.look;
  const h = L.height ?? 1;
  const w = L.build ?? 1;
  const fem = !!L.fem;
  const root = mul(T(def.x, def.y, def.z), Ry(def.yaw), S(h));
  out.setBody(root);
  const seated = def.pose === 'warm' || def.pose === 'mug';
  const seat = (def.seat ?? 0.45) / h;
  const surf = (def.surface ?? 0.98) / h;

  const skin: Paint = { c: L.skin, r: 0.62 };
  const shirt: Paint = { c: L.shirt, r: 0.92 };
  const pants: Paint = { c: L.pants, r: 0.95 };
  const coat: Paint | null = L.coat ? { c: L.coat, r: 0.9 } : null;
  const sleeve = coat ?? (L.vest ? shirt : shirt);
  const bootP: Paint = { c: L.boots ?? '#2b2119', r: 0.7 };
  const hand: Paint = L.gloves ? { c: L.gloves, r: 0.75 } : skin;
  const hairP: Paint = { c: L.hair, r: 0.85 };
  const dark = (c: string, k: number) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();

  // ---- torso frames
  const lean = def.pose === 'counter' ? 0.2 : def.pose === 'tend' ? 0.12 : seated ? 0.32 : def.pose === 'clipboard' ? 0.06 : 0.02;
  const pelvisY = seated ? seat + 0.1 : 0.95;
  const shift = def.pose === 'hip' ? 0.025 : def.pose === 'stand' ? 0.015 : 0;
  const pelvis = mul(T(shift, pelvisY, 0), Rz(shift * 1.6), seated ? Rx(-0.12) : M4());
  const chest = mul(pelvis, T(0, 0.08, 0), Rx(lean), Rz(-shift * 2.2), Ry(def.pose === 'hip' ? -0.08 : 0));
  const neckM = mul(chest, T(0, 0.47, 0.01), Rx(seated ? -0.25 : def.pose === 'counter' ? -0.15 : def.pose === 'clipboard' ? 0.25 : -0.02));
  const head = mul(neckM, T(0, 0.12, 0.012));
  const P = (m: THREE.Matrix4, x: number, y: number, z: number) => V(x, y, z).applyMatrix4(m);
  const add = (g: THREE.BufferGeometry, m: THREE.Matrix4, p: Paint, hw: number, cw: number, bw = 0) => out.add(g, mul(root, m), p.c, p.r, hw, cw, bw);
  const addW = (g: THREE.BufferGeometry, m: THREE.Matrix4, c: string, r: number, hw: number, cw: number, bw = 0) => out.add(g, mul(root, m), c, r, hw, cw, bw);
  /** tapered limb from a to b (body space) with joint balls */
  const limb = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, p: Paint, cw: number, ball = true) => {
    add(tube(r0, r1, a.distanceTo(b)), along(a, b), p, 0, cw);
    if (ball) add(sphere(r1 * 0.94, 10, 7), T(b.x, b.y, b.z), p, 0, cw);
  };

  // ---- pelvis + torso
  const hipW = fem ? 1.22 : 1.1;
  const pelvisGeo = new THREE.LatheGeometry([V(0.001, -0.14), V(0.1, -0.13), V(0.15, -0.06), V(0.158, 0.02), V(0.15, 0.09), V(0.001, 0.09)].map((v) => new THREE.Vector2(v.x, v.y)), 12);
  add(pelvisGeo, mul(pelvis, S(hipW * Math.max(0.95, w * 0.95), 1, 0.78)), pants, 0, 0);
  const prof = (o: number) => [V(0.001, -0.07), V(0.14 + o, -0.07), V(0.145 + o, 0.02), V(0.15 + o, 0.12), V((fem ? 0.162 : 0.168) + o, 0.24), V((fem ? 0.168 : 0.18) + o, 0.33), V(0.168 + o, 0.4), V(0.12 + o, 0.452), V(0.06, 0.475), V(0.001, 0.48)]
    .map((v) => new THREE.Vector2(v.x, v.y));
  const torsoS = S((fem ? 1.1 : 1.24) * w, 1, (fem ? 0.74 : 0.66) + (w - 1) * 0.4);
  const inner = coat ?? (L.vest ? { c: L.vest, r: 0.9 } : shirt);
  add(new THREE.LatheGeometry(prof(coat ? 0.012 : 0), 14), mul(chest, torsoS), inner, 0, 1, 1);
  // open front: shirt strip + lapels
  if (coat || L.vest) {
    add(new THREE.BoxGeometry(0.11, 0.36, 0.03), mul(chest, T(0, 0.27, 0.115 + (w - 1) * 0.05), Rx(-0.1)), shirt, 0, 1, 1);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.24, 0.014), mul(chest, T(s * 0.068, 0.33, 0.12 + (w - 1) * 0.05), Rz(s * 0.32), Rx(-0.12)), { c: dark((coat ?? { c: L.vest! }).c, 0.88), r: 0.9 }, 0, 1, 1);
  }
  if (L.belt || !coat) {
    add(new THREE.CylinderGeometry(0.162, 0.162, 0.045, 14), mul(pelvis, T(0, 0.075, 0), S(hipW * Math.max(0.95, w * 0.95), 1, 0.8)), { c: L.belt ?? '#2a1d14', r: 0.6 }, 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.04, 0.02), mul(pelvis, T(0, 0.075, 0.13)), { c: '#8a7a50', r: 0.35 }, 0, 0);
  }
  // coat skirt
  if (coat && (L.coatLen ?? 0) > 0.05) {
    const len = 0.18 + (L.coatLen ?? 0) * 0.58;
    if (!seated) {
      const g = new THREE.CylinderGeometry(0.17, 0.22 + len * 0.12, len, 14, 1, false);
      add(g, mul(pelvis, T(0, 0.04 - len / 2, 0.01), S(hipW * w, 1, 0.95)), coat, 0, 0);
      add(new THREE.BoxGeometry(0.03, len * 0.96, 0.02), mul(pelvis, T(0, 0.04 - len / 2, 0.172 + len * 0.06), Rx(-0.12)), { c: dark(coat.c, 0.7), r: 0.9 }, 0, 0);
    } else {
      // seated: a flap behind and the tails over the thighs
      add(new THREE.BoxGeometry(0.34 * w, 0.2, 0.05), mul(pelvis, T(0, -0.05, -0.13), Rx(0.15)), coat, 0, 0);
    }
  }
  if (L.apron) {
    const ap: Paint = { c: L.apron, r: 0.95 };
    add(new THREE.BoxGeometry(0.3, 0.22, 0.012), mul(chest, T(0, 0.22, 0.118 + (w - 1) * 0.05), Rx(-0.08)), ap, 0, 1, 1);
    if (!seated) add(new THREE.BoxGeometry(0.4, 0.52, 0.014), mul(pelvis, T(0, -0.19, 0.135), Rx(-0.06)), ap, 0, 0);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.018, 0.2, 0.01), mul(chest, T(s * 0.09, 0.4, 0.09), Rz(s * 0.4), Rx(-0.5)), ap, 0, 1, 1);
  }
  if (L.shawl) {
    const sh = new THREE.CylinderGeometry(0.11, 0.27, 0.26, 16, 1, false);
    add(sh, mul(chest, T(0, 0.36, -0.005), S(w * 1.08, 1, 0.72)), { c: L.shawl, r: 0.95 }, 0, 1, 1);
    add(new THREE.CylinderGeometry(0.268, 0.272, 0.03, 16, 1, false), mul(chest, T(0, 0.235, -0.005), S(w * 1.08, 1, 0.72)), { c: dark(L.shawl, 0.55), r: 0.95 }, 0, 1, 1);
  }

  // ---- neck, head, face
  add(tube(0.056, 0.05, 0.13), mul(neckM, T(0, 0.04, 0)), skin, 0.5, 0.5);
  const skull = mul(head, S(0.9, 1.08, 0.98));
  add(sphere(0.11, 18, 14), skull, skin, 1, 0);
  const jawC = L.beard === 'stubble' ? new THREE.Color(L.skin).lerp(new THREE.Color(L.hair), 0.35).getStyle() : L.skin;
  addW(sphere(0.078, 14, 9), mul(head, T(0, -0.045, 0.022), S(fem ? 0.9 : 1, 0.82, 0.95)), jawC, 0.62, 1, 0);
  // brow ridge, nose, ears, eyes, mouth
  add(sphere(0.05, 12, 7), mul(head, T(0, 0.034, 0.072), S(1.05, 0.34, 0.55)), skin, 1, 0);
  add(new THREE.BoxGeometry(0.024, 0.052, 0.032), mul(head, T(0, -0.002, 0.094), Rx(-0.32)), skin, 1, 0);
  add(sphere(0.016, 8, 6), mul(head, T(0, -0.026, 0.106), S(1.25, 0.9, 1)), skin, 1, 0);
  for (const s of [-1, 1]) {
    add(sphere(0.024, 8, 6), mul(head, T(s * 0.09, -0.005, -0.004), S(0.45, 1, 0.75)), skin, 1, 0);
    // a shadowed socket under the brow and a small wet eye in it: reads as a gaze, not a cartoon
    addW(sphere(0.018, 10, 7), mul(head, T(s * 0.034, 0.012, 0.085), S(1.15, 0.7, 0.45)), dark(L.skin, 0.78), 0.7, 1, 0);
    addW(sphere(0.0105, 8, 6), mul(head, T(s * 0.034, 0.011, 0.0905), S(1, 0.85, 0.7)), '#1c1410', 0.18, 1, 0);
    // brows
    addW(new THREE.BoxGeometry(0.034, 0.009, 0.012), mul(head, T(s * 0.036, 0.034, 0.094), Rz(s * -0.12)), L.hairStyle === 'bald' ? '#b8b0a4' : L.hair, 0.9, 1, 0);
  }
  addW(new THREE.BoxGeometry(0.036, 0.007, 0.012), mul(head, T(0, -0.054, 0.096)), dark(L.skin, 0.45), 0.6, 1, 0);

  // hair
  const hr = 0.112;
  if (L.hairStyle !== 'bald') {
    const cap = new THREE.SphereGeometry(hr, 16, 9, 0, Math.PI * 2, 0, Math.PI * (L.hairStyle === 'crop' ? 0.42 : 0.5));
    add(cap, mul(head, T(0, 0.012, -0.008), Rx(-0.32), S(0.93, 1.05, 1.02)), hairP, 1, 0);
    // sides / back
    // sides and back only (phi = π/2 is the face)
    const back = new THREE.SphereGeometry(hr * 0.99, 14, 6, Math.PI * 0.95, Math.PI * 1.1, Math.PI * 0.3, Math.PI * 0.32);
    add(back, mul(head, T(0, 0.0, -0.004), S(0.95, 1.05, 1.02)), hairP, 1, 0);
  } else {
    const ring = new THREE.SphereGeometry(hr * 0.98, 14, 4, Math.PI * 0.92, Math.PI * 1.16, Math.PI * 0.4, Math.PI * 0.18);
    add(ring, mul(head, S(0.94, 1.05, 1.02)), hairP, 1, 0);
  }
  if (L.hairStyle === 'bun') add(sphere(0.045, 10, 8), mul(head, T(0, 0.055, -0.1)), hairP, 1, 0);
  if (L.hairStyle === 'long') add(new THREE.BoxGeometry(0.18, 0.26, 0.05), mul(head, T(0, -0.1, -0.075), Rx(0.12)), hairP, 1, 0.4);
  if (L.hairStyle === 'braid') {
    for (let i = 0; i < 7; i++) {
      const y = -0.06 - i * 0.055;
      add(sphere(0.026 - i * 0.0015, 8, 6), mul(neckM, T(0.035 + i * 0.006, 0.1 + y, -0.1 - i * 0.012)), hairP, i < 2 ? 0.6 : 0.2, 0.6);
    }
  }
  // beard
  if (L.beard === 'full' || L.beard === 'long') {
    const bd = new THREE.SphereGeometry(0.083, 14, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
    add(bd, mul(head, T(0, -0.035, 0.026), S(0.98, 1.0, 0.92)), hairP, 1, 0);
    add(new THREE.BoxGeometry(0.06, 0.018, 0.02), mul(head, T(0, -0.042, 0.101)), hairP, 1, 0);
    if (L.beard === 'long') add(new THREE.ConeGeometry(0.058, 0.2, 10), mul(head, T(0, -0.17, 0.06), Rx(Math.PI + 0.25)), hairP, 1, 0.2);
  }
  if (L.beard === 'mustache') add(new THREE.BoxGeometry(0.06, 0.016, 0.02), mul(head, T(0, -0.042, 0.101), Rz(0)), hairP, 1, 0);
  if (L.glasses) {
    for (const s of [-1, 1]) addW(new THREE.TorusGeometry(0.021, 0.0035, 5, 12), mul(head, T(s * 0.036, 0.012, 0.102)), '#2a2622', 0.4, 1, 0);
    addW(new THREE.BoxGeometry(0.03, 0.004, 0.004), mul(head, T(0, 0.016, 0.104)), '#2a2622', 0.4, 1, 0);
    for (const s of [-1, 1]) addW(new THREE.BoxGeometry(0.004, 0.004, 0.1), mul(head, T(s * 0.058, 0.014, 0.05)), '#2a2622', 0.4, 1, 0);
  }
  // hats
  const hc = L.hatColor ?? '#4a3a2a';
  if (L.hat === 'brim') {
    addW(new THREE.CylinderGeometry(0.084, 0.1, 0.115, 14), mul(head, T(0, 0.1, -0.005), Rx(-0.08)), hc, 0.9, 1, 0);
    addW(new THREE.CylinderGeometry(0.2, 0.205, 0.012, 20), mul(head, T(0, 0.052, 0.0), Rx(-0.1), S(1, 1, 0.92)), hc, 0.9, 1, 0);
    addW(new THREE.CylinderGeometry(0.102, 0.102, 0.024, 14), mul(head, T(0, 0.068, -0.005), Rx(-0.08)), dark(hc, 0.45), 0.8, 1, 0);
    addW(new THREE.BoxGeometry(0.02, 0.03, 0.15), mul(head, T(0, 0.158, -0.005), Rx(-0.08)), dark(hc, 0.8), 0.9, 1, 0);
  } else if (L.hat === 'cap') {
    addW(new THREE.SphereGeometry(0.112, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), mul(head, T(0, 0.02, -0.004), Rx(-0.15)), hc, 0.9, 1, 0);
    addW(new THREE.BoxGeometry(0.15, 0.012, 0.1), mul(head, T(0, 0.035, 0.12), Rx(0.15)), dark(hc, 0.8), 0.9, 1, 0);
  } else if (L.hat === 'beanie') {
    addW(new THREE.SphereGeometry(0.116, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mul(head, T(0, 0.016, -0.006), Rx(-0.2), S(0.96, 1.12, 1.02)), hc, 0.95, 1, 0);
    addW(new THREE.CylinderGeometry(0.118, 0.118, 0.04, 14), mul(head, T(0, 0.022, -0.006), Rx(-0.2), S(0.96, 1, 1.02)), dark(hc, 0.75), 0.95, 1, 0);
  } else if (L.hat === 'hood') {
    addW(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mul(head, T(0, 0.0, -0.035), Rx(-0.45), S(0.95, 1.05, 1.08)), hc, 0.95, 1, 0);
    addW(new THREE.BoxGeometry(0.22, 0.2, 0.06), mul(neckM, T(0, 0.05, -0.12), Rx(0.3)), hc, 0.95, 0.4, 0.6);
  } else if (L.hat === 'bandana') {
    addW(new THREE.SphereGeometry(0.111, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.46), mul(head, T(0, 0.016, -0.01), Rx(-0.35)), hc, 0.95, 1, 0);
    addW(new THREE.BoxGeometry(0.03, 0.07, 0.02), mul(head, T(0.02, -0.03, -0.11), Rz(0.3)), hc, 0.95, 1, 0);
  }
  if (L.scarf) {
    add(new THREE.TorusGeometry(0.066, 0.032, 7, 14), mul(neckM, T(0, 0.0, 0.004), Rx(Math.PI / 2 + 0.15), S(1.05, 0.95, 1)), { c: L.scarf, r: 0.95 }, 0.3, 0.7, 0.5);
    add(new THREE.BoxGeometry(0.07, 0.24, 0.022), mul(chest, T(0.06, 0.3, 0.125 + (w - 1) * 0.05), Rz(0.1), Rx(-0.2)), { c: L.scarf, r: 0.95 }, 0, 1, 1);
  }

  // ---- arms (IK from the shoulders to pose targets in body space)
  const sw = (fem ? 0.17 : 0.195) * w;
  const la = 0.29, lb = 0.27;
  const sh = (s: number) => P(chest, s * sw, 0.405, -0.01);
  const handT: Record<number, THREE.Vector3> = {};
  const pole: Record<number, THREE.Vector3> = {};
  for (const s of [-1, 1]) {
    pole[s] = V(s * 0.6, -0.2, -1);
    switch (def.pose) {
      case 'stand': handT[s] = V(s * (0.25 + (w - 1) * 0.1), 0.86, 0.04); pole[s] = V(s * 0.3, 0, -1); break;
      case 'hip': handT[s] = s > 0 ? V(0.24 * w + 0.03, 1.0, 0.02) : V(-0.25 * w, 0.86, 0.04); pole[s] = s > 0 ? V(1, 0.1, -0.6) : V(-0.3, 0, -1); break;
      case 'crossed': handT[s] = V(-s * 0.12, 1.2, 0.17 + (w - 1) * 0.06); pole[s] = V(s * 1, -0.6, -0.3); break;
      case 'counter': handT[s] = V(s * 0.3, surf + 0.02, 0.43); pole[s] = V(s * 1, 0.1, -0.5); break;
      case 'tend': handT[s] = s > 0 ? V(0.3, surf + 0.02, 0.42) : V(-0.2, surf + 0.06, 0.36); pole[s] = V(s * 1, 0, -0.5); break;
      case 'clipboard': handT[s] = s > 0 ? V(0.1, 1.13, 0.27) : V(-0.03, 1.16, 0.3); pole[s] = V(s * 1, -0.8, -0.2); break;
      case 'warm': handT[s] = V(s * 0.09, seat + 0.32, 0.56); pole[s] = V(s * 1, -0.4, 0); break;
      case 'mug': handT[s] = V(s * 0.045, seat + 0.36, 0.36); pole[s] = V(s * 1, -0.6, 0); break;
    }
  }
  for (const s of [-1, 1]) {
    const a = sh(s);
    const { mid, end } = ik(a, handT[s], la, lb, pole[s]);
    const restCw = seated || def.pose === 'counter' || def.pose === 'tend' ? 0.15 : 0.5;
    const bag = coat ? 1.12 : 1;
    add(sphere(0.075 * bag, 10, 7), mul(T(a.x, a.y, a.z), S(1.05 * w, 1, 1)), sleeve, 0, 1, 0.6);
    limb(a, mid, 0.068 * Math.sqrt(w) * bag, 0.057 * bag, sleeve, 0.8);
    const rolled = L.sleeves === 'rolled';
    const cuffAt = rolled ? mid.clone().lerp(end, 0.25) : mid.clone().lerp(end, 0.82);
    limb(mid, cuffAt, 0.056 * bag, 0.05 * bag, sleeve, restCw, false);
    limb(cuffAt, end, rolled ? 0.043 : 0.05 * bag, 0.038, rolled ? skin : sleeve, restCw, false);
    if (!rolled) add(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 9), along(cuffAt.clone().lerp(end, 0.1), cuffAt.clone().lerp(end, 0.35)), { c: dark(sleeve.c, 0.7), r: 0.9 }, 0, restCw);
    else add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 9), along(cuffAt.clone().lerp(mid, 0.1), cuffAt.clone().lerp(mid, 0.4)), { c: dark(sleeve.c, 0.85), r: 0.9 }, 0, restCw);
    // hand: a flattened mitten along the forearm, palm turned by pose, plus a thumb
    const fdir = end.clone().sub(mid).normalize();
    const tip = end.clone().addScaledVector(fdir, 0.085);
    const palmDown = def.pose === 'counter' || def.pose === 'tend' || def.pose === 'warm';
    const twist = palmDown ? s * Math.PI / 2 : def.pose === 'mug' || def.pose === 'crossed' || def.pose === 'clipboard' ? 0 : s * 0.3;
    add(sphere(0.056, 10, 8), mul(along(end, tip, twist), T(0, -0.002, 0), S(0.82, 1.0, 0.52)), hand, 0, restCw);
    add(sphere(0.036, 9, 6), mul(along(end, tip, twist), T(0, 0.042, 0.01), S(1.15, 0.85, 0.75)), hand, 0, restCw);
    add(tube(0.019, 0.015, 0.065, 6), mul(along(end, tip, twist), T(s * -0.036, -0.008, 0.02), Rz(s * 0.5)), hand, 0, restCw);
  }

  // ---- legs
  const hip = (s: number) => P(pelvis, s * 0.095 * (fem ? 1.08 : 1) * Math.max(1, w * 0.95), -0.06, 0);
  const lt = 0.44, ls = 0.43;
  for (const s of [-1, 1]) {
    const a = hip(s);
    let foot: THREE.Vector3, kneePole: THREE.Vector3;
    if (seated) { foot = V(s * 0.15, 0.085, 0.44 + (s > 0 ? 0.04 : -0.02)); kneePole = V(s * 0.15, 1, 1); }
    else if (def.pose === 'hip' || def.pose === 'stand') { foot = V(s * 0.12 + shift * 0.5, 0.085, s > 0 ? 0.02 : 0.06); kneePole = V(0, 0, 1); }
    else if (def.pose === 'counter') { foot = V(s * 0.13, 0.085, s > 0 ? -0.06 : 0.04); kneePole = V(0, 0, 1); }
    else { foot = V(s * 0.12, 0.085, 0.0); kneePole = V(0, 0, 1); }
    const { mid, end } = ik(a, foot, lt, ls, kneePole);
    const legP = coat && seated && (L.coatLen ?? 0) > 0.5 ? coat : pants;
    add(sphere(0.086, 10, 7), T(a.x, a.y, a.z), pants, 0, 0);
    limb(a, mid, 0.088, 0.068, legP, 0);
    limb(mid, end, 0.064, 0.05, pants, 0, false);
    // boot: shaft + foot, toe forward along the body's +Z (seated feet splay a little)
    const toeYaw = s * (seated ? 0.18 : 0.12);
    add(new THREE.CylinderGeometry(0.058, 0.062, 0.16, 9), T(end.x, end.y + 0.04, end.z), bootP, 0, 0);
    add(new THREE.CapsuleGeometry(0.055, 0.15, 3, 8), mul(T(end.x, 0.055, end.z + 0.05), Ry(toeYaw), Rx(Math.PI / 2), S(1, 1, 0.78)), bootP, 0, 0);
    addW(new THREE.BoxGeometry(0.11, 0.025, 0.27), mul(T(end.x, 0.0125, end.z + 0.05), Ry(toeYaw)), '#17110c', 0.9, 0, 0);
  }

  // ---- held props
  if (def.pose === 'mug') {
    addW(new THREE.CylinderGeometry(0.042, 0.038, 0.1, 10), T(0, seat + 0.4, 0.4), '#7a2f24', 0.5, 0, 0.15);
    addW(new THREE.TorusGeometry(0.025, 0.008, 5, 8), mul(T(0.05, seat + 0.4, 0.4), Ry(Math.PI / 2)), '#7a2f24', 0.5, 0, 0.15);
  }
  if (def.pose === 'clipboard') {
    const cb = mul(T(0.035, 1.2, 0.31), Rx(-0.75), Ry(0.12));
    addW(new THREE.BoxGeometry(0.24, 0.32, 0.012), cb, '#6b4a2e', 0.8, 0, 0.5);
    addW(new THREE.BoxGeometry(0.21, 0.27, 0.004), mul(cb, T(0, -0.012, 0.008)), '#e8e2d2', 0.9, 0, 0.5);
    addW(new THREE.BoxGeometry(0.08, 0.025, 0.02), mul(cb, T(0, 0.15, 0.01)), '#9a9890', 0.4, 0, 0.5);
  }
  const neck = P(neckM, 0, 0, 0).applyMatrix4(root);
  return { neck, hipY: V(0, pelvisY, 0).applyMatrix4(root).y };
}

/** One mesh for a site's people. `update` breathes them and turns heads toward the camera. */
export class NpcCrowd {
  readonly mesh: THREE.Mesh;
  private figs: Figure[] = [];
  private uA: THREE.Vector4[] = [];
  private uB: THREE.Vector4[] = [];
  private t = Math.random() * 100;
  private local = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  constructor(defs: NpcDef[], name = 'npcs') {
    if (defs.length > MAX) throw new Error('too many npcs in one crowd');
    const sink = new Sink();
    for (let i = 0; i < MAX; i++) { this.uA.push(new THREE.Vector4()); this.uB.push(new THREE.Vector4()); }
    defs.forEach((def, i) => {
      sink.idx = i;
      const { neck, hipY } = figure(sink, def);
      const phase = (i * 2.399) % (Math.PI * 2);
      this.figs.push({ def, neck, hipY, yaw: 0, look: 0, nod: 0, idle: phase * 7 });
      this.uA[i].set(neck.x, neck.y, neck.z, 0);
      this.uB[i].set(hipY, phase, def.yaw, 0);
    });
    this.mesh = new THREE.Mesh(sink.build(), npcMaterial(this.uA, this.uB));
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Where a figure's neck is (crowd space), for interaction spots. */
  neck(id: string) {
    return this.figs.find((f) => f.def.id === id)?.neck.clone();
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    if (!this.mesh.visible) return;
    this.mesh.updateWorldMatrix(true, false);
    this.inv.copy(this.mesh.matrixWorld).invert();
    const c = this.local.copy(cam).applyMatrix4(this.inv);
    const k = 1 - Math.exp(-4 * dt);
    this.figs.forEach((f, i) => {
      const dx = c.x - f.neck.x, dz = c.z - f.neck.z;
      const dist = Math.hypot(dx, dz);
      let rel = Math.atan2(dx, dz) - f.def.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const reach = f.def.notice ?? 5.5;
      let yaw: number, nod: number;
      if (dist < reach && Math.abs(rel) < 2.1) {
        yaw = THREE.MathUtils.clamp(rel, -1.05, 1.05);
        nod = THREE.MathUtils.clamp(-Math.atan2(c.y - f.neck.y - 0.1, Math.max(0.5, dist)) * 0.8, -0.35, 0.3);
      } else {
        // idle: glance around now and then
        const n = Math.sin(this.t * 0.21 + f.idle) * Math.sin(this.t * 0.13 + f.idle * 1.7);
        yaw = n > 0.35 ? 0.55 * Math.sign(Math.sin(this.t * 0.05 + f.idle)) : n < -0.5 ? -0.3 : 0;
        nod = 0.05 * Math.sin(this.t * 0.31 + f.idle);
      }
      f.look += (yaw - f.look) * k;
      f.nod += (nod - f.nod) * k;
      this.uA[i].w = f.look;
      this.uB[i].w = f.nod;
    });
  }
}

let _progress = 0;
/** One material per crowd (it owns that crowd's uniform arrays); every crowd compiles to one program. */
function npcMaterial(A: THREE.Vector4[], B: THREE.Vector4[]) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  m.name = 'npc-' + _progress++;
  const uA: N = uniformArray(A, 'vec4');
  const uB: N = uniformArray(B, 'vec4');
  const rig: N = attribute('nRig', 'vec4');
  const col: N = attribute('nCol', 'vec4');
  m.positionNode = Fn(() => {
    const i = rig.x.toInt();
    const a: N = uA.element(i);
    const b: N = uB.element(i);
    const hw = rig.y, cw = rig.z, bw = rig.w;
    const ph = b.y;
    // breathing: the chest swells along its normals and the shoulders/head rise with it
    const br = sin(time.mul(1.55).add(ph)).mul(0.5).add(0.5);
    const p0: N = positionLocal.add(normalGeometry.mul(br.mul(0.006).mul(bw)));
    const py = p0.y.add(br.mul(0.007).mul(max(hw, cw.mul(0.6))));
    // sway of the upper body around the hips
    const up = max(py.sub(b.x), 0).mul(min(hw.add(cw), 1));
    const px = p0.x.add(sin(time.mul(0.53).add(ph.mul(1.7))).mul(0.012).mul(up));
    const pz = p0.z.add(sin(time.mul(0.41).add(ph.mul(2.3))).mul(0.009).mul(up));
    // turn: head fully, shoulders a third, about the vertical through the neck
    const yaw = a.w.mul(hw.add(cw.mul(0.3)));
    const c = cos(yaw), s = sin(yaw);
    const dx = px.sub(a.x), dz = pz.sub(a.z);
    const rx = a.x.add(dx.mul(c)).add(dz.mul(s));
    const rz = a.z.sub(dx.mul(s)).add(dz.mul(c));
    const n0: N = normalGeometry;
    const n1 = vec3(n0.x.mul(c).add(n0.z.mul(s)), n0.y, n0.x.mul(s).negate().add(n0.z.mul(c)));
    // nod: head only, about the horizontal axis across the face
    const F = b.z.add(a.w);
    const ax = vec3(cos(F), 0, sin(F).negate());
    const ang = b.w.mul(hw);
    const ca = cos(ang), sa = sin(ang);
    const pivot = vec3(a.x, a.y, a.z);
    const d = vec3(rx, py, rz).sub(pivot);
    const rot = (v: N) => v.mul(ca).add(ax.cross(v).mul(sa)).add(ax.mul(ax.dot(v)).mul(float(1).sub(ca)));
    normalLocal.assign(normalize(rot(n1)));
    return pivot.add(rot(d));
  })();
  const g: N = positionGeometry;
  const t: N = noise(g.xy.add(g.z).mul(3.1));
  const fine: N = noise(g.xy.sub(g.z).mul(13)).g;
  m.colorNode = col.xyz.mul(float(0.84).add(t.r.mul(0.24)).add(fine.mul(0.08)));
  m.roughnessNode = col.w;
  const v: N = normalize(cameraPosition.sub(positionWorld));
  const fres: N = pow(float(1).sub(max(dot(normalWorld, v), 0)), 2.6);
  m.emissiveNode = rimColor.mul(fres).mul(rimStrength).mul(mix(float(0.35), float(0.6), smoothstep(0.85, 0.95, col.w)));
  return m;
}
