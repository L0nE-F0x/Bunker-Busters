import * as THREE from 'three/webgpu';
import { texture, uniform, mix, smoothstep, max, min, vec3, float, attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLB } from '@/engine/models';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BONE, type Human } from './Humans';
import { boundSkinned } from '../world/kit';
import { WristTwist, mittFrame } from '../world/limbTwist';

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
 *
 * Arms roll with the elbow's bend (its hinge axis comes from the IK and never flips as the aim moves;
 * the bind pose is taken to bend forward). Each hand is aimed on its own along the procedural hand
 * (wrist → hand, palm toward its +Z: the gun's side on the grip, up under the forend), measured
 * against the mitt's shape at bind, and half of its roll about the forearm is spread into the
 * forearm (no twist bones: limbTwist.ts).
 */

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
  /** The body's skinned mesh(es): bounded each frame so both passes can cull them. */
  skinned: THREE.SkinnedMesh[];
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();
const _dq = { hips: new THREE.Quaternion(), chest: new THREE.Quaternion(), head: new THREE.Quaternion() };
const _root = new THREE.Vector3(), _target = new THREE.Vector3(), _procMid = new THREE.Vector3(), _pole = new THREE.Vector3();
const _mid = new THREE.Vector3(), _twist = new THREE.Vector3(), _twist2 = new THREE.Vector3(), _toe = new THREE.Vector3(), _hipW = new THREE.Vector3();
const _u = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _hd = new THREE.Vector3(), _hz = new THREE.Vector3();
const _fq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _rel = new THREE.Quaternion();

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
  /** Per side: the mitt's frame at bind (model space: wrist → fingers, out of the palm) and the wrist spreading. */
  private mitt: Partial<Record<Side, { long: THREE.Vector3; palm: THREE.Vector3; twist: WristTwist }>> = {};

  static async load(count: number, leader: number[]): Promise<HumanSkins | null> {
    try {
      const [body, hat, mask] = await Promise.all(['contractor', 'hardhat', 'respirator'].map((n) => loadGLB(n)));
      return new HumanSkins(body.scene, hat.scene, mask.scene, count, leader);
    } catch (e) {
      console.warn('[contractor] model failed to load; keeping the procedural bodies', e);
      return null;
    }
  }

  private constructor(src: THREE.Object3D, hatSrc: THREE.Object3D, maskSrc: THREE.Object3D, count: number, leader: number[]) {
    this.group.name = 'contractors';
    // The hard hat and the respirator are skinned into the body (all on the Head bone), so a
    // contractor is one draw and one depth draw, not three: one node material samples the body,
    // hat and mask maps by a per-vertex `gear` tag (0 body, 1 mask, 2 crew hat, 3 leader hat).
    // The hat's shell takes the crew/leader tint; the red KADE badge doesn't (saturation masks it).
    const mapOf = (root: THREE.Object3D) => {
      let map: THREE.Texture | null = null;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) map ??= (m.material as THREE.MeshStandardMaterial).map ?? null; });
      return map as THREE.Texture | null;
    };
    const bodyMap = mapOf(src), hatMap = mapOf(hatSrc), maskMap = mapOf(maskSrc);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
    {
      const gear: N = attribute('gear', 'float');
      const white = vec3(0.8, 0.8, 0.8);
      const tb: N = bodyMap ? texture(bodyMap).rgb : white;
      const tm: N = maskMap ? texture(maskMap).rgb : white;
      const th: N = hatMap ? texture(hatMap).rgb : white;
      const tint: N = gear.greaterThan(2.5).select(uniform(new THREE.Color('#e05a1a')) as N, uniform(new THREE.Color('#e8e4da')) as N);
      const hi: N = max(th.r, max(th.g, th.b));
      const sat: N = hi.sub(min(th.r, min(th.g, th.b))).div(hi.max(0.001));
      const hat: N = hatMap ? mix(th.mul(tint), th, smoothstep(0.3, 0.5, sat)) : tint;
      mat.colorNode = gear.lessThan(0.5).select(tb, gear.lessThan(1.5).select(tm, hat));
      mat.roughnessNode = gear.lessThan(0.5).select(float(0.85), gear.lessThan(1.5).select(float(0.6), float(0.45)));
      mat.metalnessNode = gear.greaterThan(0.5).and(gear.lessThan(1.5)).select(float(0.1), float(0));
    }

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
    // the mitts: their shape at bind (their palms face down there), and the wrist spreading
    let body: THREE.SkinnedMesh | null = null;
    src.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body ??= o as THREE.SkinnedMesh; });
    for (const sd of ['Left', 'Right'] as Side[]) {
      const hand = bones[sd + 'Hand'], fa = bones[sd + 'ForeArm'];
      const m = body && hand && fa ? mittFrame(body, hand, new THREE.Vector3(0, -1, 0)) : null;
      if (!m || !hand || !fa) continue;
      const q = this.bind[sd + 'Hand'].q;
      const rel = this.bind[sd + 'ForeArm'].q.clone().invert().multiply(q);
      this.mitt[sd] = { long: m.long.clone().applyQuaternion(q), palm: m.palm.clone().applyQuaternion(q), twist: new WristTwist(rel, hand.position) };
    }
    const [crewGeo, leadGeo] = this.gearUp(src, bones, hatSrc, maskSrc);

    for (let i = 0; i < count; i++) {
      const model = cloneSkinned(src);
      const root = new THREE.Group();
      root.add(model);
      root.visible = false;
      this.group.add(root);
      const b: Record<string, THREE.Bone> = {};
      model.traverse((o) => { if ((o as THREE.Bone).isBone) b[o.name] = o as THREE.Bone; });
      for (const bone of Object.values(b)) bone.matrixWorldAutoUpdate = true;
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        if (m.isSkinnedMesh) {
          m.geometry = leader.includes(i) ? leadGeo : crewGeo;
          skinned.push(m);
        }
        m.material = mat;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // until pose() bounds it (boundSkinned)
      });
      this.slots.push({ root, model, b, skinned });
    }
  }

  /**
   * The body's geometry with the hat and respirator merged in, skinned 100% to the Head bone where
   * they used to ride it as separate meshes (Head-bone space, 1 unit = 1 cm there; fits from
   * Assets/MESHY_ASSETS.md §5). Returns the crew and leader variants (they differ only in the tag).
   */
  private gearUp(src: THREE.Object3D, bones: Record<string, THREE.Bone>, hatSrc: THREE.Object3D, maskSrc: THREE.Object3D) {
    let body: THREE.SkinnedMesh | null = null;
    src.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body ??= o as THREE.SkinnedMesh; });
    if (!body) throw new Error('contractor: no skinned body');
    const B = body as THREE.SkinnedMesh;
    const tag = (g: THREE.BufferGeometry, v: number) => {
      g.setAttribute('gear', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
      return g;
    };
    // (the models are quantized: slim-glb.mjs packs normals, UVs and weights as normalized integers.
    // Plain floats here, so the parts merge whatever each file's encoding.)
    const keep = (g: THREE.BufferGeometry, names: string[]) => {
      for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k);
      for (const k of ['normal', 'uv', 'skinWeight']) {
        const a = g.getAttribute(k);
        if (!a || a.array instanceof Float32Array) continue;
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      return g;
    };
    const bodyGeo = keep(B.geometry.clone(), ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']);
    const parts: THREE.BufferGeometry[] = [tag(bodyGeo, 0)];
    const head = bones.Head;
    const hi = head ? B.skeleton.bones.indexOf(head) : -1;
    const skinIdx = bodyGeo.attributes.skinIndex as THREE.BufferAttribute;
    if (head && hi >= 0) {
      const bindInv = new THREE.Matrix4().copy(B.bindMatrix).invert();
      const put = (from: THREE.Object3D, pos: [number, number, number], scale: number, v: number) => {
        const prop = from.clone(true);
        prop.position.set(pos[0], pos[1], pos[2]);
        prop.scale.setScalar(scale);
        head.add(prop);
        src.updateMatrixWorld(true);
        prop.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = keep(m.geometry.clone(), ['position', 'normal', 'uv']);
          if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, j) => j));
          g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bindInv, m.matrixWorld));
          const n = g.attributes.position.count;
          const si = new Uint8Array(n * 4), sw = new Float32Array(n * 4);
          for (let j = 0; j < n; j++) { si[j * 4] = hi; sw[j * 4] = 1; }
          g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIdx.array instanceof Uint8Array ? si : new Uint16Array(si), 4, skinIdx.normalized));
          g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
          parts.push(tag(g, v));
        });
        head.remove(prop);
      };
      put(maskSrc, [-1.3, 10, -4], 14.5, 1);
      put(hatSrc, [-1.5, 20, -5], 15, 2);
      src.updateMatrixWorld(true);
    }
    const crew = mergeGeometries(parts, false);
    if (!crew) throw new Error('contractor: gear merge failed');
    crew.computeBoundingSphere();
    // the leader's copy shares every buffer but the tag
    const lead = new THREE.BufferGeometry();
    lead.setIndex(crew.index);
    for (const [k, a] of Object.entries(crew.attributes)) lead.setAttribute(k, a);
    const tagL = (crew.attributes.gear.array as Float32Array).map((x) => (x === 2 ? 3 : x));
    lead.setAttribute('gear', new THREE.Float32BufferAttribute(tagL, 1));
    lead.boundingSphere = crew.boundingSphere;
    return [crew, lead];
  }

  hide(i: number) {
    const s = this.slots[i];
    if (s) s.root.visible = false;
  }

  /** Fit slot `i` onto person `h`'s procedural skeleton for this frame. */
  pose(i: number, h: Human) {
    const s = this.slots[i];
    if (!s) return;
    const H = h.look_.height;
    const m = h.mats;
    s.root.visible = true;
    s.root.position.set(0, 0, 0);
    s.root.scale.setScalar(H * (1.78 / MODEL_H));
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
    const twist2 = _twist2.setFromMatrixColumn(m[P[1]], 2).normalize();
    const mitt = end === 'Hand' ? this.mitt[sd] : undefined;
    if (end === 'Hand') {
      // an arm rolls with its elbow's bend: the upper arm's front faces the way the forearm folds,
      // the forearm's faces away from the upper arm (the bind pose taken as bending forward, +Z).
      // The hinge axis comes from the IK, so it doesn't flip as the aim swings across the body.
      const u = _u.subVectors(mid, root).normalize(), f = _f.subVectors(target, mid).normalize();
      const n = _n.crossVectors(u, f);
      if (n.lengthSq() < 1e-6) n.crossVectors(u, pole);
      if (n.lengthSq() > 1e-8) {
        n.normalize();
        twist.crossVectors(n, u);
        twist2.crossVectors(n, f);
      }
    }
    // upper: bind direction → root→mid
    this.aim(bu, sd + up, _v.subVectors(mid, root), twist);
    if (mitt) {
      // forearm and hand together, then half the hand's roll about the forearm moves into it
      this.aimQ(sd + lo, _v.subVectors(target, mid), twist2, Z, _fq);
      // the hand: along the procedural hand (wrist → hand), palm toward its +Z
      _hd.setFromMatrixColumn(m[P[2]], 1).negate();
      _hz.setFromMatrixColumn(m[P[2]], 2);
      this.aimQ(sd + end, _hd, _hz, mitt.palm, _hq, mitt.long);
      _rel.copy(_fq).invert().multiply(_hq);
      mitt.twist.apply(_fq, _rel, 0.5, 60, 80);
      this.setWorld(bl, _fq);
      this.setWorld(be, _hq.copy(_fq).multiply(_rel));
      return;
    }
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
    this.setWorld(bone, this.aimQ(name, d, hint, Z, _q));
  }

  /**
   * The world rotation that turns bone `name`'s bind direction (or `dir0`) along `d`, with what
   * pointed toward `hint0` at bind (orthogonal to it) now toward `hint`.
   */
  private aimQ(name: string, d: THREE.Vector3, hint: THREE.Vector3, hint0: THREE.Vector3, out: THREE.Quaternion, dir0 = this.dir[name]) {
    basis(d, hint, _q2);
    basis(dir0, hint0, _q3);
    return out.copy(_q2).multiply(_q3.invert()).multiply(this.bind[name].q);
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
