import * as THREE from 'three/webgpu';
import { texture, uniform, mix, smoothstep, max, min, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BONE, type Human } from './Humans';
import { boundSkinned } from '../world/kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Kade's contractors as the Meshy model (prepared by scripts/models/build-glb.mjs): one textured
 * skinned clone per crowd slot, all sharing one material, with the hard hat and respirator riding
 * the Head bone.
 *
 * The procedural skeleton in Humans.ts stays in charge: it still walks the terrain, crouches, aims,
 * reloads, flinches, holds the gun (the crowd mesh now draws only the guns), drives the hit tests
 * and becomes the ragdoll. Each frame this module fits the Meshy rig onto it: the torso and head
 * take the procedural frames (the spine split between hips and chest), and the arms and legs reach
 * the procedural wrists and ankles by two-bone IK with the model's own limb lengths. So the hands
 * stay on the gun, the feet stay on the ground, and a ragdoll carries the model down with it.
 * Bone axes never matter: everything is solved as world rotations relative to the bind pose.
 */

const BASE = `${import.meta.env.BASE_URL}models/`;
/** Meshy contractor height (m) at bind; procedural `look.height` 1 = 1.78 m. */
const MODEL_H = 1.78;
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

type Side = 'Left' | 'Right';
interface Bind {
  q: THREE.Quaternion; // world rotation at bind (model at the origin, unscaled)
  p: THREE.Vector3; // world position at bind
}
interface Slot {
  root: THREE.Group;
  model: THREE.Object3D;
  b: Record<string, THREE.Bone>;
  props: THREE.Object3D[];
  /** The body's skinned mesh(es): bounded each frame so both passes can cull them. */
  skinned: THREE.SkinnedMesh[];
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();
const _dq = { hips: new THREE.Quaternion(), chest: new THREE.Quaternion(), head: new THREE.Quaternion() };
const _root = new THREE.Vector3(), _target = new THREE.Vector3(), _procMid = new THREE.Vector3(), _pole = new THREE.Vector3();
const _mid = new THREE.Vector3(), _twist = new THREE.Vector3(), _twist2 = new THREE.Vector3(), _toe = new THREE.Vector3(), _hipW = new THREE.Vector3();

/** Rotation of a frame with +Y along `y` and +Z toward `zHint` (the Humans.ts frameTo convention). */
function basis(y: THREE.Vector3, zHint: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}
/** Two-bone IK (as Humans.ts): joint for root→target with lengths a, b, bending toward `pole`. */
function ik(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = _e.subVectors(target, root);
  const len = Math.min(d.length(), (a + b) * 0.999);
  d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
  const p = _s.copy(pole).addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1);
  p.normalize();
  const ang = Math.acos(cosA);
  return out.copy(root).addScaledVector(d, Math.cos(ang) * a).addScaledVector(p, Math.sin(ang) * a);
}

export class HumanSkins {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private bind: Record<string, Bind> = {};
  /** Bind-pose limb directions (bone → child) and lengths (m, at model scale 1). */
  private dir: Record<string, THREE.Vector3> = {};
  private len: Record<string, number> = {};
  private hipsH = 0.996;

  static async load(count: number, leader: number[]): Promise<HumanSkins | null> {
    try {
      const L = new GLTFLoader();
      const [body, hat, mask] = await Promise.all(['contractor', 'hardhat', 'respirator'].map((n) => L.loadAsync(`${BASE}${n}.glb`)));
      return new HumanSkins(body.scene, hat.scene, mask.scene, count, leader);
    } catch (e) {
      console.warn('[contractor] model failed to load; keeping the procedural bodies', e);
      return null;
    }
  }

  private constructor(src: THREE.Object3D, hatSrc: THREE.Object3D, maskSrc: THREE.Object3D, count: number, leader: number[]) {
    this.group.name = 'contractors';
    // one node material per kind (the loader's are physical): body, respirator, and the hard hat in
    // two tints (leader orange, crew white) that share one program through a uniform
    const swap = (root: THREE.Object3D, make: (map: THREE.Texture | null) => THREE.Material, shadow: boolean) => {
      let mat: THREE.Material | null = null;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const old = m.material as THREE.MeshStandardMaterial;
        mat ??= make(old.map ?? null);
        m.material = mat;
        m.castShadow = shadow;
        m.receiveShadow = true;
        // the skinned body gets a sphere per frame (boundSkinned); the rigid head props ride the
        // Head bone, so their own geometry bounds already cull them
        m.frustumCulled = !(m as THREE.SkinnedMesh).isSkinnedMesh;
      });
    };
    swap(src, (map) => new THREE.MeshStandardNodeMaterial({ map, roughness: 0.85, metalness: 0 }), true);
    swap(maskSrc, (map) => new THREE.MeshStandardNodeMaterial({ map, roughness: 0.6, metalness: 0.1 }), false);
    let hatMap: THREE.Texture | null = null;
    hatSrc.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) hatMap = (m.material as THREE.MeshStandardMaterial).map ?? null; });
    const hatMat = (tint: string) => {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0 });
      if (hatMap) {
        // tint the shell, leave the red KADE badge alone (saturation masks it)
        const t: N = texture(hatMap);
        const sat: N = max(t.r, max(t.g, t.b)).sub(min(t.r, min(t.g, t.b))).div(max(t.r, max(t.g, t.b)).max(0.001));
        m.colorNode = mix(t.rgb.mul(uniform(new THREE.Color(tint)) as N), t.rgb, smoothstep(0.3, 0.5, sat));
      } else m.colorNode = vec3(uniform(new THREE.Color(tint)) as N);
      return m;
    };
    const hatCrew = hatMat('#e8e4da'), hatLead = hatMat('#e05a1a');

    // bind data, measured with the model at the origin
    src.updateMatrixWorld(true);
    const bones: Record<string, THREE.Bone> = {};
    src.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
    for (const [n, b] of Object.entries(bones)) this.bind[n] = { q: b.getWorldQuaternion(new THREE.Quaternion()), p: b.getWorldPosition(new THREE.Vector3()) };
    const seg = (a: string, b: string) => {
      const d = new THREE.Vector3().subVectors(this.bind[b].p, this.bind[a].p);
      this.len[a] = d.length();
      this.dir[a] = d.normalize();
    };
    for (const s of ['Left', 'Right'] as Side[]) {
      seg(`${s}Arm`, `${s}ForeArm`); seg(`${s}ForeArm`, `${s}Hand`);
      seg(`${s}UpLeg`, `${s}Leg`); seg(`${s}Leg`, `${s}Foot`); seg(`${s}Foot`, `${s}ToeBase`);
    }
    this.hipsH = this.bind.Hips?.p.y ?? 0.996;

    for (let i = 0; i < count; i++) {
      const model = cloneSkinned(src);
      const root = new THREE.Group();
      root.add(model);
      root.visible = false;
      this.group.add(root);
      const b: Record<string, THREE.Bone> = {};
      model.traverse((o) => { if ((o as THREE.Bone).isBone) b[o.name] = o as THREE.Bone; });
      for (const bone of Object.values(b)) bone.matrixWorldAutoUpdate = true;
      // head props, in Head-bone space (1 unit = 1 cm there; numbers from Assets/MESHY_ASSETS.md §5)
      const props: THREE.Object3D[] = [];
      if (b.Head) {
        const hat = hatSrc.clone(true);
        hat.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = leader.includes(i) ? hatLead : hatCrew; });
        hat.position.set(-1.5, 20, -5);
        hat.scale.setScalar(15);
        const mask = maskSrc.clone(true);
        mask.position.set(-1.3, 10, -4);
        mask.scale.setScalar(14.5);
        b.Head.add(hat, mask);
        props.push(hat, mask);
      }
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
      this.slots.push({ root, model, b, props, skinned });
    }
  }

  hide(i: number) {
    const s = this.slots[i];
    if (s) s.root.visible = false;
  }

  /** Fit slot `i` onto person `h`'s procedural skeleton for this frame. */
  pose(i: number, h: Human, near: boolean) {
    const s = this.slots[i];
    if (!s) return;
    const H = h.look_.height;
    const m = h.mats;
    s.root.visible = true;
    s.root.position.set(0, 0, 0);
    s.root.scale.setScalar(H * (1.78 / MODEL_H));
    for (const p of s.props) p.visible = near;
    const B = s.b;

    // torso frames from the procedural bones (their rotation; the matrices carry the height scale)
    const rot = (bone: number, out: THREE.Quaternion) => {
      m[bone].decompose(_p, out, _s);
      return out;
    };
    rot(BONE.hips, _dq.hips);
    rot(BONE.chest, _dq.chest);
    rot(BONE.head, _dq.head);
    // every setWorld below trusts its parent's matrixWorld (set just before it, top-down), so the
    // chain above the hips is brought up to date once here instead of once per bone
    B.Hips.parent!.updateWorldMatrix(true, false);
    // the pelvis: at the procedural one, lifted to the model's own hip height
    _p.setFromMatrixPosition(m[BONE.hips]);
    _hipW.copy(_p);
    _v.set(0, 1, 0).applyQuaternion(_dq.hips).multiplyScalar((this.hipsH - 0.95) * H);
    this.setWorld(B.Hips, _q.copy(_dq.hips).multiply(this.bind.Hips.q), _w.copy(_p).add(_v));
    // the spine eases from the hips' frame to the chest's
    const spine: [string, number][] = [['Spine02', 0.35], ['Spine01', 0.7], ['Spine', 1]];
    for (const [n, t] of spine) if (B[n]) this.setWorld(B[n], _q.copy(_dq.hips).slerp(_dq.chest, t).multiply(this.bind[n].q));
    if (B.neck) this.setWorld(B.neck, _q.copy(_dq.chest).slerp(_dq.head, 0.5).multiply(this.bind.neck.q));
    if (B.Head) this.setWorld(B.Head, _q.copy(_dq.head).multiply(this.bind.Head.q));
    for (const sd of ['Left', 'Right'] as Side[]) {
      const sh = B[`${sd}Shoulder`];
      if (sh) this.setWorld(sh, _q.copy(_dq.chest).multiply(this.bind[`${sd}Shoulder`].q));
    }

    // arms: reach the procedural wrists; the elbow bends the way the procedural one does
    const L = sd2(BONE.uArmL, BONE.fArmL, BONE.handL), R = sd2(BONE.uArmR, BONE.fArmR, BONE.handR);
    this.limb(B, 'Left', 'Arm', 'ForeArm', 'Hand', L, H, m);
    this.limb(B, 'Right', 'Arm', 'ForeArm', 'Hand', R, H, m);
    // legs: reach the procedural ankles; feet follow the procedural foot frame
    this.limb(B, 'Left', 'UpLeg', 'Leg', 'Foot', sd2(BONE.thighL, BONE.shinL, BONE.footL), H, m);
    this.limb(B, 'Right', 'UpLeg', 'Leg', 'Foot', sd2(BONE.thighR, BONE.shinR, BONE.footR), H, m);
    s.root.updateMatrixWorld(true);
    // a sphere round the pelvis holds the whole pose (it follows a ragdoll too)
    for (const sk of s.skinned) boundSkinned(sk, _hipW, 1.35 * H);
  }

  /** Upper/lower/end bones of a procedural limb. */
  private limb(B: Record<string, THREE.Bone>, sd: Side, up: string, lo: string, end: string, P: [number, number, number], H: number, m: THREE.Matrix4[]) {
    const bu = B[sd + up], bl = B[sd + lo], be = B[sd + end];
    if (!bu || !bl || !be) return;
    // the joint (its parent was just set; limb joints keep their bind offset) and the procedural
    // limb's twist reference (its +Z)
    const root = _root.copy(bu.position).applyMatrix4(bu.parent!.matrixWorld);
    const target = _target.setFromMatrixPosition(m[P[2]]);
    const procMid = _procMid.setFromMatrixPosition(m[P[1]]);
    const k = H * (1.78 / MODEL_H);
    const a = this.len[sd + up] * k, b = this.len[sd + lo] * k;
    // bend toward where the procedural elbow/knee is
    const pole = _pole.subVectors(procMid, root);
    const mid = ik(root, target, a, b, pole, _mid);
    const twist = _twist.setFromMatrixColumn(m[P[0]], 2).normalize();
    // upper: bind direction → root→mid
    this.aim(bu, sd + up, _v.subVectors(mid, root), twist);
    const twist2 = _twist2.setFromMatrixColumn(m[P[1]], 2).normalize();
    this.aim(bl, sd + lo, _v.subVectors(target, mid), twist2);
    if (end === 'Foot') {
      // the foot: toes along the procedural foot's +Z, sole down
      const toe = _toe.setFromMatrixColumn(m[P[2]], 2).normalize();
      const d0 = this.dir[sd + 'Foot'];
      basis(toe, UP, _q2);
      basis(d0, UP, _q3);
      this.setWorld(be, _q.copy(_q2).multiply(_q3.invert()).multiply(this.bind[sd + 'Foot'].q));
    } else {
      // the hand continues the forearm (mitts, no fingers)
      _q2.setFromRotationMatrix(_m.extractRotation(bl.matrixWorld));
      _q3.copy(this.bind[sd + lo].q).invert();
      this.setWorld(be, _q.copy(_q2).multiply(_q3).multiply(this.bind[sd + end].q));
    }
  }

  /** Turn `bone` so its bind direction points along `d`, twisting toward `hint`. */
  private aim(bone: THREE.Bone, name: string, d: THREE.Vector3, hint: THREE.Vector3) {
    const d0 = this.dir[name];
    basis(d, hint, _q2);
    basis(d0, Z, _q3);
    this.setWorld(bone, _q.copy(_q2).multiply(_q3.invert()).multiply(this.bind[name].q));
  }

  /**
   * Give `bone` this world rotation (and position). Its parent's matrixWorld must be current: bones
   * are set top-down, and `pose` refreshes the chain above the hips first. (Walking the parents up
   * on every call cost ~15 matrix updates per bone, ~0.3 ms a frame for a squad in WebKit.)
   */
  private setWorld(bone: THREE.Bone, q: THREE.Quaternion, p?: THREE.Vector3) {
    const parent = bone.parent!;
    _pq.setFromRotationMatrix(_m.extractRotation(parent.matrixWorld));
    bone.quaternion.copy(_pq.invert().multiply(q));
    if (p) bone.position.copy(_p.copy(p).applyMatrix4(_m.copy(parent.matrixWorld).invert()));
    // just this bone: its children are set after it, or refreshed by the root at the end
    bone.updateMatrix();
    bone.matrixWorld.multiplyMatrices(parent.matrixWorld, bone.matrix);
  }
}

const sd2 = (a: number, b: number, c: number): [number, number, number] => [a, b, c];
