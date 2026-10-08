import * as THREE from 'three/webgpu';
import { attribute, positionGeometry, float, mix, smoothstep, vec3, normalize, cameraPosition, positionWorld, normalWorld, dot, pow, max } from 'three/tsl';
import { noise } from '@/engine/noiseTex';
import { rimColor, rimStrength } from '../world/materials';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '../world/Heightfield';
import type { HumanSkins } from './humanSkin';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * People who fight: Kade Holdings' Recovery contractors. Every body on screen is one skinned mesh
 * (one draw, one shadow draw): each person owns a block of bones, and the vertices of their parts
 * hang on those bones rigidly. Animation is procedural and world-space: each frame the joints are
 * placed (gait, crouch, lean, aim, reload, flinch) and every bone's world matrix is built straight
 * from them; skinning reads those matrices. Death hands the bones to a Rapier ragdoll.
 *
 * Bone-local authoring: origin at the joint. Torso bones: +Y up the spine, +Z forward. Limb bones:
 * the limb runs down −Y from the joint, +Z forward. Feet: +Y up, +Z toward the toes. Weapon: origin
 * at the grip, barrel along −Z. +X = Y × Z (the person's left).
 */

export const BONE = {
  hips: 0, chest: 1, head: 2,
  uArmL: 3, fArmL: 4, handL: 5, uArmR: 6, fArmR: 7, handR: 8,
  thighL: 9, shinL: 10, footL: 11, thighR: 12, shinR: 13, footR: 14,
  weapon: 15,
} as const;
const NB = 16;

export type HumanWeapon = 'rifle' | 'shotgun' | 'revolver';

export interface HumanLook {
  vest: string;
  uniform: string;
  pants: string;
  helmet: string;
  boots: string;
  gloves: string;
  skin: string;
  build: number; // 0.9 lean … 1.2 heavy
  height: number; // 1 = 1.78 m
  weapon: HumanWeapon;
  pack?: boolean;
  leader?: boolean;
}

// ------------------------------------------------------------------ geometry sink

class Sink {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  mat: number[] = [];
  skin: number[] = [];
  bone = 0;
  private c = new THREE.Color();
  add(g: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, rough: number, metal = 0, glow = 0, kind = 0) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    const P = geo.attributes.position, Nn = geo.attributes.normal;
    this.c.set(color);
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nrm.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      this.col.push(this.c.r, this.c.g, this.c.b, rough);
      this.mat.push(metal, glow, kind, 0);
      this.skin.push(this.bone);
    }
  }
}

const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);
const R = (x: number, y: number, z: number) => M().makeRotationFromEuler(new THREE.Euler(x, y, z));
const S = (x: number, y = x, z = x) => M().makeScale(x, y, z);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.clone().multiply(b));
const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
/** Tapered tube hanging down −Y from the origin. */
const limb = (r0: number, r1: number, len: number, seg = 10) => new THREE.CylinderGeometry(r0, r1, len, seg, 2).translate(0, -len / 2, 0);
const rbox = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
const lathe = (pts: [number, number][], seg = 14) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const dark = (c: string, k: number) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();

/** Kinds (mat.z): 0 fabric, 1 hi-vis vest, 2 hard plastic, 3 metal, 4 reflective tape, 5 skin, 6 rubber/leather. */
function buildPerson(out: Sink, L: HumanLook, base: number, gunOnly = false) {
  const w = L.build;
  const at = (b: number) => { out.bone = base + b; };
  // with the Meshy bodies (humanSkin.ts) this mesh draws only the guns
  if (gunOnly) { at(BONE.weapon); buildWeapon(out, L.weapon); return; }
  // --- hips: pelvis, belt, pouches, holster
  at(BONE.hips);
  out.add(lathe([[0.001, -0.15], [0.12, -0.14], [0.175, -0.06], [0.178, 0.03], [0.16, 0.1], [0.001, 0.1]]), S(1.12 * w, 1, 0.82), L.pants, 0.95);
  out.add(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 14), mul(T(0, 0.07, 0), S(1.1 * w, 1, 0.82)), '#2a2420', 0.6, 0, 0, 6);
  out.add(rbox(0.05, 0.04, 0.02), T(0, 0.07, 0.135), '#8a7a50', 0.35, 0.6, 0, 3);
  for (const s of [-1, 1]) out.add(rbox(0.07, 0.09, 0.06), T(s * 0.15 * w, 0.04, 0.06), dark(L.pants, 0.7), 0.9);
  out.add(rbox(0.08, 0.1, 0.05), T(0, 0.03, -0.14), dark(L.pants, 0.6), 0.9); // butt pack
  // --- chest: torso, hi-vis vest, tape, lanyard badge, radio
  at(BONE.chest);
  const prof = (o: number): [number, number][] => [[0.001, -0.03], [0.155 + o, -0.03], [0.158 + o, 0.06], [0.165 + o, 0.16], [0.182 + o, 0.27], [0.192 + o, 0.35], [0.18 + o, 0.41], [0.13 + o, 0.45], [0.06, 0.47], [0.001, 0.475]];
  const torsoS = S(1.2 * w, 1, 0.72 + (w - 1) * 0.4);
  out.add(lathe(prof(0)), torsoS, L.uniform, 0.92);
  out.add(lathe(prof(0.018).slice(1, 8), 16), torsoS, L.vest, 0.7, 0, 0, 1);
  for (const y of [0.15, 0.25]) out.add(new THREE.CylinderGeometry(0.177, 0.172, 0.028, 16, 1, true), mul(torsoS, T(0, y, 0)), '#d8dcd8', 0.35, 0, 0, 4);
  // shoulder straps (tape) over the top
  for (const s of [-1, 1]) out.add(rbox(0.045, 0.012, 0.3), mul(T(s * 0.1 * w, 0.43, 0), R(0.0, 0, s * 0.15)), '#d8dcd8', 0.35, 0, 0, 4);
  out.add(rbox(0.055, 0.075, 0.006), mul(T(0.07 * w, 0.31, 0.125 + (w - 1) * 0.05), R(-0.1, 0, 0)), '#f2f2ee', 0.5, 0, 0, 2); // badge
  out.add(rbox(0.012, 0.16, 0.004), mul(T(0.05 * w, 0.4, 0.12 + (w - 1) * 0.05), R(-0.15, 0, 0.25)), '#c8202a', 0.8); // lanyard
  out.add(rbox(0.05, 0.08, 0.03), mul(T(-0.12 * w, 0.37, 0.09), R(-0.1, 0, 0)), '#1c1d1f', 0.5, 0.2, 0, 2); // radio
  out.add(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 5), T(-0.13 * w, 0.45, 0.09), '#111', 0.5);
  if (L.pack) {
    out.add(rbox(0.3 * w, 0.36, 0.17), T(0, 0.26, -0.2 - (w - 1) * 0.05), dark(L.pants, 0.8), 0.9);
    out.add(new THREE.CylinderGeometry(0.06, 0.06, 0.32 * w, 10).rotateZ(Math.PI / 2), T(0, 0.47, -0.2), '#5a4a32', 0.95);
  }
  if (L.leader) out.add(rbox(0.09, 0.05, 0.12), mul(T(0.14 * w, 0.42, 0.04), R(0, 0, 0.3)), '#d02020', 0.6, 0, 0, 2); // shoulder lamp
  // --- head: neck, head, respirator, goggles, hard hat
  at(BONE.head);
  out.add(limb(0.055, 0.06, 0.08).translate(0, 0.08, 0), null, L.uniform, 0.9);
  out.add(sph(0.115, 16, 12), mul(T(0, 0.185, 0.0), S(0.9, 1.06, 0.98)), L.skin, 0.62, 0, 0, 5);
  // respirator: a rounded snout with two filter cans
  out.add(sph(0.075, 12, 9), mul(T(0, 0.14, 0.075), S(1, 0.85, 0.8)), '#26282b', 0.5, 0, 0, 6);
  for (const s of [-1, 1]) out.add(new THREE.CylinderGeometry(0.03, 0.032, 0.035, 12).rotateX(Math.PI / 2), mul(T(s * 0.058, 0.125, 0.105), R(0, s * 0.6, 0)), '#3a3d40', 0.45, 0.3, 0, 2);
  // goggles + strap
  out.add(new THREE.TorusGeometry(0.104, 0.012, 6, 20), mul(T(0, 0.2, 0), R(Math.PI / 2, 0, 0), S(0.98, 1, 1.02)), '#151515', 0.7, 0, 0, 6);
  for (const s of [-1, 1]) out.add(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 12).rotateX(Math.PI / 2), T(s * 0.036, 0.205, 0.095), '#0a0c0e', 0.15, 0.4, 0.35, 2);
  // hard hat: dome, brim, ridge
  const hat = L.helmet;
  out.add(new THREE.SphereGeometry(0.128, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.5), mul(T(0, 0.24, -0.005), S(1.02, 0.95, 1.1)), hat, 0.45, 0, 0, 2);
  out.add(new THREE.CylinderGeometry(0.15, 0.155, 0.012, 20), mul(T(0, 0.243, 0.02), S(1, 1, 1.12)), hat, 0.45, 0, 0, 2);
  out.add(rbox(0.025, 0.03, 0.2), T(0, 0.355, -0.005), dark(hat, 0.85), 0.45, 0, 0, 2);
  out.add(rbox(0.05, 0.03, 0.006), T(0, 0.295, 0.138), '#c8202a', 0.5, 0, 0, 2); // KADE decal
  // --- arms: sleeves, cuffs, gloves; reflective armbands
  for (const side of [1, -1] as const) {
    const ua = side > 0 ? BONE.uArmL : BONE.uArmR;
    const fa = side > 0 ? BONE.fArmL : BONE.fArmR;
    const hd = side > 0 ? BONE.handL : BONE.handR;
    at(ua);
    out.add(sph(0.086 * Math.sqrt(w), 10, 8), S(1.05, 1, 1), L.uniform, 0.9);
    out.add(limb(0.078 * Math.sqrt(w), 0.064, 0.29), null, L.uniform, 0.9);
    out.add(new THREE.CylinderGeometry(0.081, 0.078, 0.035, 12, 1, true), T(0, -0.1, 0), '#d8dcd8', 0.35, 0, 0, 4);
    at(fa);
    out.add(sph(0.064, 8, 6), null, L.uniform, 0.9);
    out.add(limb(0.064, 0.05, 0.25), null, L.uniform, 0.9);
    out.add(new THREE.CylinderGeometry(0.053, 0.053, 0.05, 10), T(0, -0.23, 0), L.gloves, 0.8, 0, 0, 6);
    at(hd);
    out.add(sph(0.056, 10, 8), mul(T(0, -0.045, 0.005), S(0.85, 1.1, 0.62)), L.gloves, 0.8, 0, 0, 6);
    out.add(limb(0.018, 0.015, 0.06, 6), mul(T(side * 0.03, -0.01, 0.02), R(0, 0, side * 0.6)), L.gloves, 0.8, 0, 0, 6);
  }
  // --- legs: trousers, knee pads, boots
  for (const side of [1, -1] as const) {
    const th = side > 0 ? BONE.thighL : BONE.thighR;
    const sh = side > 0 ? BONE.shinL : BONE.shinR;
    const ft = side > 0 ? BONE.footL : BONE.footR;
    at(th);
    out.add(sph(0.108, 10, 8), null, L.pants, 0.95);
    out.add(limb(0.106 * Math.sqrt(w), 0.078, 0.44), null, L.pants, 0.95);
    out.add(rbox(0.06, 0.12, 0.09), T(side * 0.09, -0.22, 0.01), dark(L.pants, 0.82), 0.95); // cargo pocket
    at(sh);
    out.add(sph(0.078, 8, 6), null, L.pants, 0.95);
    out.add(limb(0.076, 0.058, 0.42), null, L.pants, 0.95);
    out.add(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mul(T(0, -0.03, 0.03), R(Math.PI / 2 - 0.2, 0, 0), S(1, 1, 0.6)), '#1e1f21', 0.6, 0, 0, 6); // knee pad
    out.add(new THREE.CylinderGeometry(0.064, 0.07, 0.17, 10), T(0, -0.355, 0), L.boots, 0.7, 0, 0, 6);
    at(ft);
    out.add(new THREE.CapsuleGeometry(0.056, 0.15, 3, 8).rotateX(Math.PI / 2), mul(T(0, -0.035, 0.06), S(1, 0.85, 1)), L.boots, 0.7, 0, 0, 6);
    out.add(rbox(0.115, 0.03, 0.28), T(0, -0.075, 0.06), '#121010', 0.9, 0, 0, 6);
  }
  // --- weapon (bone at the grip, barrel −Z)
  at(BONE.weapon);
  buildWeapon(out, L.weapon);
}

/** The contractor's gun: simpler cousins of the player's. */
function buildWeapon(out: Sink, kind: HumanWeapon) {
  const steel = '#3c3f44', wood = '#6a4024';
  if (kind === 'revolver') {
    out.add(rbox(0.026, 0.045, 0.1), T(0, 0.05, -0.02), steel, 0.35, 0.8, 0, 3);
    out.add(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10).rotateX(Math.PI / 2), T(0, 0.055, -0.035), steel, 0.35, 0.8, 0, 3);
    out.add(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 8).rotateX(Math.PI / 2), T(0, 0.064, -0.11), steel, 0.35, 0.8, 0, 3);
    out.add(rbox(0.028, 0.09, 0.04), mul(T(0, -0.01, 0.015), R(-0.35, 0, 0)), wood, 0.6);
    return;
  }
  const long = kind === 'rifle';
  // stock, receiver, barrel, forend, mag tube
  out.add(rbox(0.035, 0.05, 0.12), mul(T(0, 0.0, 0.04), R(-0.25, 0, 0)), wood, 0.6);
  out.add(rbox(0.04, 0.07, 0.24), mul(T(0, -0.005, 0.2), R(-0.1, 0, 0)), wood, 0.6);
  out.add(rbox(0.036, 0.06, 0.18), T(0, 0.045, -0.1), steel, 0.35, 0.8, 0, 3);
  out.add(new THREE.CylinderGeometry(0.011, 0.011, long ? 0.5 : 0.46, 8).rotateX(Math.PI / 2), T(0, 0.064, long ? -0.43 : -0.41), steel, 0.35, 0.8, 0, 3);
  out.add(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 8).rotateX(Math.PI / 2), T(0, 0.04, -0.37), steel, 0.35, 0.8, 0, 3);
  out.add(rbox(0.042, 0.042, 0.17), T(0, 0.04, long ? -0.3 : -0.36), long ? wood : '#2a2a2a', 0.6);
  if (long) out.add(rbox(0.006, 0.03, 0.06), mul(T(0, -0.02, -0.06), R(0.3, 0, 0)), steel, 0.4, 0.8, 0, 3); // lever
}

/** One shared material for every contractor: per-vertex paint, kind-driven wear and tape glint. */
function humanMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const col: N = attribute('hCol', 'vec4');
  const mat: N = attribute('hMat', 'vec4');
  const p: N = positionGeometry;
  const kind: N = mat.z;
  const tone: N = noise(p.xy.add(p.z).mul(4.1));
  const fine: N = noise(p.xz.sub(p.y).mul(19)).g;
  // fabric: tonal mottling and grime toward the hems; vests sun-faded; tape is bright
  const isVest: N = smoothstep(0.5, 1, kind).mul(smoothstep(1.5, 1, kind));
  const isTape: N = smoothstep(3.5, 4, kind).mul(smoothstep(4.5, 4, kind));
  let c: N = col.xyz.mul(float(0.84).add(tone.r.mul(0.24)).add(fine.mul(0.08)));
  c = mix(c, c.mul(vec3(1.05, 1.0, 0.85)).add(0.03), isVest.mul(tone.g.mul(0.5)));
  m.colorNode = c;
  m.roughnessNode = col.w.add(fine.mul(0.08)).sub(isTape.mul(0.15));
  m.metalnessNode = mat.x;
  // reflective tape catches the light at grazing angles; goggle lenses glint
  const v: N = normalize(cameraPosition.sub(positionWorld));
  const fres: N = pow(float(1).sub(max(dot(normalWorld, v), 0)), 2.4);
  m.emissiveNode = rimColor.mul(fres).mul(rimStrength).mul(0.45).add(vec3(0.8, 0.85, 0.8).mul(isTape).mul(pow(max(dot(normalWorld, v), 0), 6)).mul(0.25)).add(vec3(0.3, 0.5, 0.6).mul(mat.y).mul(0.15));
  return m;
}

// ------------------------------------------------------------------ the crowd mesh

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** World matrix with origin `o`, +Y along `y`, +Z toward `zHint` (orthogonalised). */
function frameTo(out: THREE.Matrix4, o: THREE.Vector3, y: THREE.Vector3, zHint: THREE.Vector3, scale = 1) {
  _y.copy(y).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  out.makeBasis(_x.multiplyScalar(scale), _y.multiplyScalar(scale), _z.multiplyScalar(scale));
  out.setPosition(o);
  return out;
}

/** Two-bone IK: elbow/knee for root→target with lengths a, b, bending toward `pole`. */
function ik(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = _ik1.subVectors(target, root);
  const len = Math.min(d.length(), (a + b) * 0.999);
  d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
  const p = _ik2.copy(pole).addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  p.normalize();
  return out.copy(root).addScaledVector(d, Math.cos(Math.acos(cosA)) * a).addScaledVector(p, Math.sin(Math.acos(cosA)) * a);
}
const _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3();

export type HitZone = 'head' | 'body' | 'arm' | 'leg';
export type HumanPose = 'relaxed' | 'ready' | 'aim' | 'reload' | 'throw' | 'radio' | 'sit';

/** One person's animation state. AI writes the inputs; `pose()` turns them into bone matrices. */
export class Human {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  aimYaw = 0;
  aimPitch = 0;
  readonly vel = new THREE.Vector3();
  crouch = 0;
  pose: HumanPose = 'relaxed';
  /** 0..1: weapon raised (ready) → shouldered (aim). Smoothed. */
  private aimK = 0;
  private readyK = 0;
  private crouchS = 0;
  private phase = Math.random() * 6;
  private speedS = 0;
  readonly flinch = new THREE.Vector3();
  flinchK = 0;
  /**
   * Hit reaction (layered on whatever it's doing): seconds since the hit, how hard (0..1), where it
   * landed and which side of the body (+1 its left, −1 its right). A head shot snaps the head back,
   * a body shot knocks the chest back and the knees give, a leg buckles under it, an arm wrenches
   * the gun off the aim. `hit()` sets it.
   */
  hitT = 99;
  hitK = 0;
  hitZone: HitZone = 'body';
  hitSide = 1;
  readonly hitDir = new THREE.Vector3(0, 0, 1);
  /** Seconds into a collapse on its feet (−1: not dying). The AI hands it to a ragdoll at `dyingDur`. */
  dyingT = -1;
  dyingDur = 0.6;
  /** Under fire: 0..1 how hard it's cowering (rounds cracking past). Set by the AI, smoothed here. */
  cower = 0;
  private cowerS = 0;
  reloadT = 0;
  recoil = 0;
  /** Head turn while idle/listening (radians). */
  look = 0;
  active = false;
  dead = false;
  ragdoll: Ragdoll | null = null;
  readonly mats: THREE.Matrix4[];
  readonly muzzle = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly chestPos = new THREE.Vector3();
  readonly headPos = new THREE.Vector3();
  /** Joint world positions from the last pose (hit tests). */
  readonly joints: Record<string, THREE.Vector3> = {};

  constructor(readonly slot: number, readonly look_: HumanLook, readonly bones: THREE.Bone[]) {
    this.mats = bones.map((b) => b.matrixWorld);
    for (const k of ['pelvis', 'neck', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR']) this.joints[k] = new THREE.Vector3();
  }

  get weapon() {
    return this.look_.weapon;
  }

  /** A round (or a blow) landed: start the reaction. `dir` is the way it travelled. */
  hit(zone: HitZone, dir: THREE.Vector3, k: number, side: number) {
    // a second hit while still reeling stacks, a little
    const left = this.hitT < 0.3 ? this.hitK * 0.5 : 0;
    this.hitT = 0;
    this.hitK = Math.min(1, Math.max(k, left + k * 0.7));
    this.hitZone = zone;
    this.hitSide = side;
    this.hitDir.copy(dir).setY(0);
    if (this.hitDir.lengthSq() < 1e-6) this.hitDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.hitDir.normalize();
  }

  /** Collapse every bone to a point far below the world (an unused slot). */
  hide() {
    this.active = false;
    for (const m of this.mats) m.makeScale(0, 0, 0).setPosition(0, -9999, 0);
  }

  /** Place every bone for this frame. */
  update(dt: number, hf: Heightfield) {
    if (!this.active) return;
    if (this.ragdoll) { this.ragdoll.sync(this.mats); this.updateDerived(); return; }
    const L = this.look_;
    const H = L.height;
    const gy = hf.heightAt(this.pos.x, this.pos.z);
    this.pos.y = gy;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.speedS += (speed - this.speedS) * Math.min(1, dt * 8);
    this.crouchS += (this.crouch - this.crouchS) * Math.min(1, dt * 7);
    // dying on its feet: the arms go slack, the knees go, it folds forward (then the ragdoll)
    const dying = this.dyingT >= 0 ? THREE.MathUtils.smoothstep(this.dyingT / this.dyingDur, 0, 1) : 0;
    if (this.dyingT >= 0) this.dyingT += dt;
    const wantAim = this.pose === 'aim' && this.dyingT < 0 ? 1 : 0;
    const wantReady = this.dyingT < 0 && (this.pose === 'aim' || this.pose === 'ready' || this.pose === 'reload' || this.pose === 'throw') ? 1 : 0;
    this.aimK += (wantAim - this.aimK) * Math.min(1, dt * (this.dyingT >= 0 ? 5 : 9));
    this.readyK += (wantReady - this.readyK) * Math.min(1, dt * (this.dyingT >= 0 ? 4 : 6));
    // the hit: a fast jolt, a slower recovery
    this.hitT += dt;
    const hr = this.hitT < 1.4 ? Math.min(1, this.hitT / 0.045) * Math.exp(-Math.max(0, this.hitT - 0.045) * 4.6) * this.hitK : 0;
    const hz = this.hitZone, hs = this.hitSide, hd = this.hitDir;
    this.cowerS += (this.cower - this.cowerS) * Math.min(1, dt * (this.cower > this.cowerS ? 14 : 3));
    const cw = this.cowerS;
    this.flinchK = Math.max(0, this.flinchK - dt * 3.2);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);

    const f = _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = _l.set(f.z, 0, -f.x);
    const sp = this.speedS;
    const run = THREE.MathUtils.smoothstep(sp, 2.5, 4.5);
    const walk = Math.min(1, sp / 1.1);
    // knees give with a hit (a leg most of all), under fire, and as it dies
    const cr = Math.min(1, this.crouchS + hr * (hz === 'leg' ? 0.75 : hz === 'body' ? 0.24 : 0.1) + cw * 0.35 + dying * 0.95);
    const stride = THREE.MathUtils.lerp(1.3, 2.4, run) * (1 - cr * 0.3);
    this.phase += (sp / stride) * Math.PI * dt;
    const ph = this.phase;
    const bob = Math.abs(Math.cos(ph)) * (0.03 + run * 0.05) * walk;
    const J = this.joints;

    // pelvis
    const pelvis = J.pelvis.copy(this.pos).addScaledVector(UP, (0.95 - cr * 0.36) * H - bob).addScaledVector(f, cr * 0.06 + run * 0.04);
    pelvis.addScaledVector(left, Math.sin(ph) * 0.02 * walk);
    // knocked back a step; a leg hit drops that hip
    pelvis.addScaledVector(hd, hr * (hz === 'leg' ? 0.04 : 0.11)).addScaledVector(left, hs * hr * (hz === 'leg' ? 0.07 : 0));
    // torso: leans into a run, a crouch and an aim; twists toward the aim
    // an arm hit wrenches that shoulder back (round from the front) or forward (from behind)
    const front = -(hd.x * f.x + hd.z * f.z) > 0 ? 1 : -1;
    const twist = THREE.MathUtils.clamp(angDiff(this.yaw, this.aimYaw), -0.9, 0.9) * (0.4 + this.readyK * 0.5)
      + hr * hs * front * (hz === 'arm' ? 0.5 : hz === 'body' ? 0.12 : 0) - cw * 0.25;
    const chestYaw = this.yaw + twist;
    const cf = _cf.set(Math.sin(chestYaw), 0, Math.cos(chestYaw));
    const cl = _cl.set(cf.z, 0, -cf.x);
    const lean = 0.06 + run * 0.25 + cr * 0.32 + this.aimK * 0.08 - (this.pose === 'sit' ? 0 : 0);
    const torsoUp = _tu.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(cf, Math.sin(lean));
    // flinch: knocked back from the hit
    if (this.flinchK > 0) torsoUp.addScaledVector(this.flinch, this.flinchK * 0.5).normalize();
    if (hr > 0.002) torsoUp.addScaledVector(hd, hr * (hz === 'body' ? 0.45 : hz === 'head' ? 0.3 : 0.12)).addScaledVector(left, hs * hr * (hz === 'leg' ? 0.38 : 0)).normalize();
    // dying: it folds forward over the wound; cowering: hunched
    if (dying > 0 || cw > 0) torsoUp.addScaledVector(cf, dying * 0.85 + cw * 0.3).addScaledVector(hd, dying * 0.2).normalize();
    const chestBase = _cb.copy(pelvis).addScaledVector(UP, 0.09 * H);
    frameTo(this.mats[BONE.hips], pelvis, _tmp.copy(UP).addScaledVector(f, cr * 0.15), f, H);
    frameTo(this.mats[BONE.chest], chestBase, torsoUp, cf, H);
    const neck = J.neck.copy(chestBase).addScaledVector(torsoUp, 0.465 * H);
    // head: looks along the aim (or round, idle)
    const hy = chestYaw + (this.readyK > 0.5 ? angDiff(chestYaw, this.aimYaw) : this.look);
    const hp = this.aimPitch * (0.5 + this.readyK * 0.4);
    const hf2 = _hf.set(Math.sin(hy) * Math.cos(hp), Math.sin(hp), Math.cos(hy) * Math.cos(hp));
    const headUp = _hu.copy(UP).addScaledVector(hf2, -Math.sin(hp) * 0.9).addScaledVector(this.flinch, this.flinchK * 0.6)
      .addScaledVector(hd, hr * (hz === 'head' ? 1.5 : 0.35)).addScaledVector(cf, dying * 0.9 + cw * 0.45).normalize();
    frameTo(this.mats[BONE.head], neck, headUp, hf2, H);
    this.headPos.copy(neck).addScaledVector(headUp, 0.185 * H);
    this.eye.copy(this.headPos).addScaledVector(hf2, 0.08);
    this.chestPos.copy(chestBase).addScaledVector(torsoUp, 0.28 * H);

    // legs
    const legL = 0.44 * H, shinL = 0.43 * H;
    const md = sp > 0.05 ? _md.set(this.vel.x, 0, this.vel.z).normalize() : _md.copy(f);
    for (const side of [1, -1] as const) {
      const hip = (side > 0 ? J.hipL : J.hipR).copy(pelvis).addScaledVector(left, side * 0.1 * Math.max(1, L.build * 0.95)).addScaledVector(UP, -0.06 * H);
      const off = side > 0 ? 0 : Math.PI;
      const s = Math.sin(ph + off);
      const lift = Math.max(0, Math.cos(ph + off)) * (0.07 + run * 0.12) * walk;
      const foot = (side > 0 ? J.ftL : J.ftR).copy(this.pos).addScaledVector(left, side * (0.11 + cr * 0.06)).addScaledVector(md, s * stride * 0.22 * walk);
      if (cr > 0.3) foot.addScaledVector(f, side > 0 ? 0.18 * cr : -0.12 * cr);
      foot.y = hf.heightAt(foot.x, foot.z) + 0.085 + lift;
      const knee = ik(hip, foot, legL, shinL, _pole.copy(f).addScaledVector(left, side * 0.15), side > 0 ? J.knL : J.knR);
      frameTo(this.mats[side > 0 ? BONE.thighL : BONE.thighR], hip, _tmp.subVectors(hip, knee), f, H);
      frameTo(this.mats[side > 0 ? BONE.shinL : BONE.shinR], knee, _tmp.subVectors(knee, foot), f, H);
      // foot: flat, toes along the body (a little toe-off mid-stride)
      const toe = _toe.copy(f).addScaledVector(UP, -lift * 1.5).normalize();
      frameTo(this.mats[side > 0 ? BONE.footL : BONE.footR], foot, _tmp.copy(UP).addScaledVector(f, lift * 1.5), toe, H);
    }

    // arms + weapon
    const shL = J.shL.copy(chestBase).addScaledVector(torsoUp, 0.405 * H).addScaledVector(cl, 0.19 * L.build);
    const shR = J.shR.copy(chestBase).addScaledVector(torsoUp, 0.405 * H).addScaledVector(cl, -0.19 * L.build);
    const aimDir = _ad.set(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    const wk = this.weapon;
    const pistol = wk === 'revolver';
    // weapon frame: relaxed (held low across the body) → ready (low, pointing ahead) → aimed (shouldered)
    const relDir = _rd.copy(cf).multiplyScalar(0.55).addScaledVector(cl, 0.5).addScaledVector(UP, -0.65).normalize();
    const readyDir = _rdy.copy(aimDir).addScaledVector(UP, -0.55).normalize();
    const wDir = _wd.copy(relDir).lerp(readyDir, this.readyK).lerp(aimDir, this.aimK).normalize();
    const wPos = _wp;
    if (pistol) {
      const relP = _a.copy(pelvis).addScaledVector(cl, -0.2).addScaledVector(UP, 0.02).addScaledVector(cf, 0.08);
      const aimP = _b.copy(neck).addScaledVector(UP, -0.12).addScaledVector(aimDir, 0.52).addScaledVector(cl, -0.04);
      const rdyP = _c.copy(chestBase).addScaledVector(UP, 0.2).addScaledVector(cf, 0.35).addScaledVector(cl, -0.06);
      wPos.copy(relP).lerp(rdyP, this.readyK).lerp(aimP, this.aimK);
    } else {
      const relP = _a.copy(pelvis).addScaledVector(UP, 0.18).addScaledVector(cf, 0.22).addScaledVector(cl, -0.12);
      const aimP = _b.copy(shR).addScaledVector(aimDir, 0.2).addScaledVector(cl, 0.06).addScaledVector(UP, -0.06);
      const rdyP = _c.copy(chestBase).addScaledVector(UP, 0.22).addScaledVector(cf, 0.26).addScaledVector(cl, -0.1);
      wPos.copy(relP).lerp(rdyP, this.readyK).lerp(aimP, this.aimK);
    }
    // recoil: the gun bucks back and up
    wPos.addScaledVector(wDir, -this.recoil * 0.05);
    wDir.addScaledVector(UP, this.recoil * 0.12).normalize();
    // a hit knocks the muzzle off the aim (an arm hit most of all); dying, it sags
    if (hr > 0.002) wDir.addScaledVector(UP, hr * (hz === 'arm' ? 0.55 : 0.3)).addScaledVector(cl, hs * hr * (hz === 'arm' ? 0.6 : 0.15)).normalize();
    if (dying > 0) wDir.addScaledVector(UP, -dying * 0.8).normalize();
    // reloading: the gun tips up, the left hand goes to a pouch and back
    let reload = 0;
    if (this.reloadT > 0) {
      reload = Math.sin(Math.min(1, this.reloadT / 2.2) * Math.PI);
      wDir.addScaledVector(UP, reload * 0.6).addScaledVector(cl, reload * 0.3).normalize();
    }
    // weapon up vector: mostly world up, rolled a touch when relaxed
    const wUp = _wu.copy(UP).addScaledVector(cl, (1 - this.readyK) * 0.4).normalize();
    frameTo(this.mats[BONE.weapon], wPos, wUp, _tmp.copy(wDir).negate(), 1);
    // re-derive the barrel so the muzzle matches the bone
    const wm = this.mats[BONE.weapon];
    this.muzzle.set(0, 0.064, pistol ? -0.17 : -0.68).applyMatrix4(wm);
    // hands: right on the grip, left on the forend (or cupping the right for a pistol)
    const grip = _a.set(0, -0.01, 0.02).applyMatrix4(wm);
    let fore: THREE.Vector3;
    if (pistol) fore = _b.set(0.035, -0.04, 0.02).applyMatrix4(wm);
    else fore = _b.set(0, 0.02, wk === 'rifle' ? -0.3 : -0.36).applyMatrix4(wm);
    if (reload > 0.05) {
      const pouch = _c.copy(pelvis).addScaledVector(cl, 0.16).addScaledVector(cf, 0.1).addScaledVector(UP, 0.02);
      fore = _b.lerp(pouch, Math.min(1, reload * 1.6));
    }
    if (this.pose === 'radio') fore = _b.copy(neck).addScaledVector(cl, 0.08).addScaledVector(cf, 0.06).addScaledVector(UP, -0.02);
    // dying from a body wound, the free hand goes to it
    if (dying > 0 && hz === 'body' && !pistol) fore = _b.lerp(_c.copy(chestBase).addScaledVector(torsoUp, 0.2 * H).addScaledVector(cf, 0.17).addScaledVector(cl, 0.04), Math.min(1, dying * 1.6));
    const aLen = 0.29 * H, fLen = 0.27 * H;
    for (const side of [1, -1] as const) {
      const sh = side > 0 ? shL : shR;
      const hand = side > 0 ? fore : grip;
      // wrist sits a palm's length back from where the hand closes
      const toHand = _tmp.subVectors(hand, sh).normalize();
      const wrist = (side > 0 ? J.wrL : J.wrR).copy(hand).addScaledVector(toHand, -0.07);
      const elbow = ik(sh, wrist, aLen, fLen, _pole.copy(UP).multiplyScalar(-0.9).addScaledVector(cl, side * 0.7).addScaledVector(cf, -0.25), side > 0 ? J.elL : J.elR);
      frameTo(this.mats[side > 0 ? BONE.uArmL : BONE.uArmR], sh, _tmp.subVectors(sh, elbow), cf, H);
      frameTo(this.mats[side > 0 ? BONE.fArmL : BONE.fArmR], elbow, _tmp.subVectors(elbow, wrist), cf, H);
      frameTo(this.mats[side > 0 ? BONE.handL : BONE.handR], wrist, _tmp.subVectors(wrist, hand), _pole.copy(cl).multiplyScalar(-side), H);
    }
    this.updateDerived();
  }

  private updateDerived() {
    if (this.ragdoll) {
      _a.set(0, 0.28, 0).applyMatrix4(this.mats[BONE.chest]);
      this.chestPos.copy(_a);
      this.headPos.set(0, 0.2, 0).applyMatrix4(this.mats[BONE.head]);
    }
  }

  /** Ray test against the body parts (head sphere, torso capsule, pelvis, limbs). */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, capsule: (o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) => number | null, sphere: (o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) => number | null) {
    let best: { t: number; zone: 'head' | 'body' | 'limb' } | null = null;
    const test = (t: number | null, zone: 'head' | 'body' | 'limb') => { if (t !== null && t <= max && (!best || t < best.t)) best = { t, zone }; };
    const m = this.mats;
    const p = (bone: number, x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(m[bone]);
    // matrices carry the height scale already
    test(sphere(o, d, p(BONE.head, 0, 0.21, 0.01, _h1), 0.13), 'head');
    test(capsule(o, d, p(BONE.chest, 0, 0.06, 0, _h1), p(BONE.chest, 0, 0.38, 0, _h2), 0.2 * this.look_.build), 'body');
    test(sphere(o, d, p(BONE.hips, 0, 0, 0, _h1), 0.17), 'body');
    for (const [a, len, r] of [[BONE.thighL, 0.44, 0.085], [BONE.thighR, 0.44, 0.085], [BONE.shinL, 0.42, 0.065], [BONE.shinR, 0.42, 0.065], [BONE.uArmL, 0.29, 0.065], [BONE.uArmR, 0.29, 0.065], [BONE.fArmL, 0.26, 0.055], [BONE.fArmR, 0.26, 0.055]] as const) {
      test(capsule(o, d, p(a, 0, 0, 0, _h1), p(a, 0, -len, 0, _h2), r), 'limb');
    }
    return best as { t: number; zone: 'head' | 'body' | 'limb' } | null;
  }
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _cf = new THREE.Vector3(), _cl = new THREE.Vector3(), _tu = new THREE.Vector3();
const _cb = new THREE.Vector3(), _tmp = new THREE.Vector3(), _hf = new THREE.Vector3(), _hu = new THREE.Vector3(), _md = new THREE.Vector3();
const _pole = new THREE.Vector3(), _toe = new THREE.Vector3(), _ad = new THREE.Vector3(), _rd = new THREE.Vector3(), _rdy = new THREE.Vector3();
const _wd = new THREE.Vector3(), _wp = new THREE.Vector3(), _wu = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3();

/** Every contractor's body in one skinned mesh. `slots` people max; looks are fixed per slot. */
export class HumanCrowd {
  readonly mesh: THREE.SkinnedMesh;
  readonly people: Human[] = [];
  /** The Meshy bodies fitted onto these skeletons (null: the procedural bodies are drawn). */
  readonly skins: HumanSkins | null;
  constructor(looks: HumanLook[], skins: HumanSkins | null = null) {
    this.skins = skins;
    const sink = new Sink();
    const bones: THREE.Bone[] = [];
    looks.forEach((L, i) => {
      buildPerson(sink, L, i * NB, !!skins);
      const bs: THREE.Bone[] = [];
      for (let b = 0; b < NB; b++) {
        const bone = new THREE.Bone();
        bone.matrixAutoUpdate = false;
        bone.matrixWorldAutoUpdate = false;
        bs.push(bone);
        bones.push(bone);
      }
      this.people.push(new Human(i, L, bs));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sink.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(sink.nrm, 3));
    g.setAttribute('hCol', new THREE.Float32BufferAttribute(sink.col, 4));
    g.setAttribute('hMat', new THREE.Float32BufferAttribute(sink.mat, 4));
    const n = sink.skin.length;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = sink.skin[i]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.mesh = new THREE.SkinnedMesh(g, humanMaterial());
    this.mesh.name = 'recovery';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.bindMode = THREE.DetachedBindMode;
    this.mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    for (const p of this.people) p.hide();
  }

  update(dt: number, hf: Heightfield, eye?: THREE.Vector3) {
    let any = false;
    for (const p of this.people) {
      if (p.active) {
        p.update(dt, hf);
        any = true;
        this.skins?.pose(p.slot, p, !eye || p.pos.distanceToSquared(eye) < 40 * 40);
      } else this.skins?.hide(p.slot);
    }
    this.mesh.visible = any;
  }

  /** Debug / warm-up: everyone standing in a row at `at`. */
  lineup(at: THREE.Vector3, hf: Heightfield) {
    this.people.forEach((p, i) => {
      p.active = true;
      p.pos.set(at.x + (i - this.people.length / 2) * 1.2, 0, at.z);
      p.yaw = Math.PI;
      p.aimYaw = Math.PI;
      p.pose = i % 3 === 0 ? 'aim' : i % 3 === 1 ? 'ready' : 'relaxed';
      for (let k = 0; k < 30; k++) p.update(1 / 30, hf);
      this.skins?.pose(p.slot, p, true);
    });
    this.mesh.visible = true;
  }
}

// ------------------------------------------------------------------ ragdoll

type Body = ReturnType<Physics['world']['createRigidBody']>;
type Joint = ReturnType<Physics['world']['createImpulseJoint']>;

/** Ragdoll parts: bone, capsule half-length, radius, parent part (or -1), joint kind. */
const PARTS: [number, number, number, number, 'ball' | 'hinge'][] = [
  [BONE.hips, 0.06, 0.14, -1, 'ball'],
  [BONE.chest, 0.14, 0.17, 0, 'ball'],
  [BONE.head, 0.05, 0.11, 1, 'ball'],
  [BONE.uArmL, 0.11, 0.06, 1, 'ball'],
  [BONE.fArmL, 0.12, 0.05, 3, 'hinge'],
  [BONE.uArmR, 0.11, 0.06, 1, 'ball'],
  [BONE.fArmR, 0.12, 0.05, 5, 'hinge'],
  [BONE.thighL, 0.17, 0.08, 0, 'ball'],
  [BONE.shinL, 0.17, 0.06, 7, 'hinge'],
  [BONE.thighR, 0.17, 0.08, 0, 'ball'],
  [BONE.shinR, 0.17, 0.06, 9, 'hinge'],
];
/** Bones that ride on a part (hands on forearms, feet on shins). */
const RIDERS: [number, number][] = [[BONE.handL, 4], [BONE.handR, 6], [BONE.footL, 8], [BONE.footR, 10]];

/**
 * A dead contractor: rigid capsules joined at the shoulders, hips, neck and spine (ball joints) and
 * the knees and elbows (hinges). Bones follow their part. It sleeps once it stops moving, and after a
 * few seconds the bodies are removed and the pose is kept (it costs nothing while it lies there).
 */
export class Ragdoll {
  private bodies: Body[] = [];
  private joints: Joint[] = [];
  private offsets: THREE.Matrix4[] = [];
  private riderOff: THREE.Matrix4[] = [];
  private gun: Body | null = null;
  private t = 0;
  frozen = false;
  private scale = 1;

  constructor(private physics: Physics, mats: THREE.Matrix4[], vel: THREE.Vector3, impulse: THREE.Vector3, hitBone: number, more: { bone: number; v: THREE.Vector3 }[] = []) {
    const R = physics.R;
    const world = physics.world;
    // parts collide with the world, never with each other
    const groups = (0x0002 << 16) | 0x0001;
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    PARTS.forEach(([bone, half, r, parent, kind], i) => {
      mats[bone].decompose(pos, quat, scl);
      this.scale = scl.x;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinvel(vel.x, vel.y, vel.z)
        .setLinearDamping(0.4)
        .setAngularDamping(2.2)
        .setCcdEnabled(i < 3));
      // torso parts point up from the joint, limbs hang down
      const up = bone === BONE.hips || bone === BONE.chest || bone === BONE.head;
      const off = up ? (bone === BONE.head ? 0.2 : bone === BONE.chest ? 0.24 : 0) : -(half + r);
      world.createCollider(R.ColliderDesc.capsule(half * scl.x, r * scl.x).setTranslation(0, off * scl.x, 0).setDensity(bone === BONE.chest || bone === BONE.hips ? 1100 : 900).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups), body);
      this.bodies.push(body);
      this.offsets.push(new THREE.Matrix4().makeScale(scl.x, scl.y, scl.z));
      if (parent >= 0) {
        // the joint sits at this bone's origin, expressed in the parent's frame
        const pm = new THREE.Matrix4().copy(mats[PARTS[parent][0]]);
        const pInv = pm.clone().invert();
        const local = pos.clone().applyMatrix4(pInv).multiplyScalar(scl.x);
        // anchors are in body space (unscaled bodies): the parent's local offset times its scale
        const a1 = { x: local.x, y: local.y, z: local.z };
        const data = kind === 'hinge'
          ? R.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
          : R.JointData.spherical(a1, { x: 0, y: 0, z: 0 });
        const j = world.createImpulseJoint(data, this.bodies[parent], body, true);
        if (kind === 'hinge') {
          // knees bend back, elbows forward: allow the current bend plus a sensible range
          const knee = bone === BONE.shinL || bone === BONE.shinR;
          (j as unknown as { setLimits(a: number, b: number): void }).setLimits(knee ? -0.05 : -2.4, knee ? 2.4 : 0.05);
        }
        this.joints.push(j);
      }
    });
    // the shot that killed: an impulse on the part it hit (or the chest)
    const hitPart = Math.max(0, PARTS.findIndex((p) => p[0] === hitBone));
    const b = this.bodies[hitPart >= 0 ? hitPart : 1];
    b.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    // and any others the death calls for (a shotgun's spread through the hips, a twist off a bad leg)
    for (const m of more) {
      const pi = PARTS.findIndex((p) => p[0] === m.bone);
      if (pi >= 0) this.bodies[pi].applyImpulse({ x: m.v.x, y: m.v.y, z: m.v.z }, true);
    }
    // riders: offset from their part at death
    for (const [bone, part] of RIDERS) {
      const pm = new THREE.Matrix4().copy(mats[PARTS[part][0]]).invert();
      this.riderOff.push(pm.multiply(mats[bone]));
    }
    // the gun drops on its own
    mats[BONE.weapon].decompose(pos, quat, scl);
    this.gun = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinvel(vel.x * 0.5 + (Math.random() - 0.5), 1.2, vel.z * 0.5 + (Math.random() - 0.5)).setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }).setAngularDamping(0.8));
    world.createCollider(R.ColliderDesc.cuboid(0.025, 0.04, 0.3).setTranslation(0, 0.03, -0.2).setDensity(700).setFriction(0.8).setCollisionGroups(groups), this.gun);
  }

  private _p = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3(1, 1, 1);

  /** Copy the bodies into the bone matrices; after it settles, drop the bodies and keep the pose. */
  sync(mats: THREE.Matrix4[]) {
    if (this.frozen) return;
    this.t += 1 / 60;
    let moving = 0;
    PARTS.forEach(([bone], i) => {
      const b = this.bodies[i];
      const t = b.translation(), r = b.rotation();
      mats[bone].compose(this._p.set(t.x, t.y, t.z), this._q.set(r.x, r.y, r.z, r.w), this._s.setScalar(this.scale));
      const v = b.linvel();
      moving = Math.max(moving, Math.hypot(v.x, v.y, v.z));
    });
    RIDERS.forEach(([bone, part], i) => mats[bone].multiplyMatrices(mats[PARTS[part][0]], this.riderOff[i]));
    if (this.gun) {
      const t = this.gun.translation(), r = this.gun.rotation();
      mats[BONE.weapon].compose(this._p.set(t.x, t.y, t.z), this._q.set(r.x, r.y, r.z, r.w), this._s.setScalar(1));
    }
    if ((this.t > 1.2 && moving < 0.08) || this.t > 7) this.freeze();
  }

  /** Remove the physics; the bones keep their last pose. */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    const w = this.physics.world;
    for (const j of this.joints) w.removeImpulseJoint(j, false);
    for (const b of this.bodies) w.removeRigidBody(b);
    if (this.gun) w.removeRigidBody(this.gun);
    this.bodies = [];
    this.joints = [];
    this.gun = null;
  }

  /** The pelvis (for loot prompts and despawn checks). */
  where(mats: THREE.Matrix4[], out: THREE.Vector3) {
    return out.setFromMatrixPosition(mats[BONE.hips]);
  }
}

export { NB as BONES_PER_PERSON };
void _m; void _q;
