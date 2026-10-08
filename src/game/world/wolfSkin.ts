import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { boundSkinned } from './kit';

/**
 * The wolf as a real model (Meshy, prepared by scripts/models/prep-glb.mjs): one textured skinned
 * mesh per pack slot, all sharing one material (one program). The baked walk clip is driven by the
 * wolf's own gait phase, so the feet keep time with its speed; everything else the hunt needs
 * (crouch, head tracking, the bite, the howl, the stagger, the death roll) is layered on top as
 * world-axis bone rotations, so it doesn't depend on how the rig's bones are oriented.
 */

/** What Fauna's Wolf wants the model to do this frame. */
export interface WolfPose {
  /** Feet on the ground here (world). */
  pos: THREE.Vector3;
  yaw: number;
  /** Body pitch from the slope, and a rock from a hit. */
  pitch: number;
  roll: number;
  bob: number;
  /** Gait: phase (radians, 2π per stride) and amplitude 0 (standing) .. 1 (running). */
  phase: number;
  amp: number;
  /** Stalking crouch 0..1. */
  low: number;
  /** Head yaw toward its target (radians, already clamped). */
  look: number;
  /** Head pitch: + up (a howl), − down (hackles, the snap of a bite). */
  nod: number;
  /** Tail lift: + up, − tucked. */
  tail: number;
  /** Seconds since it died (−1 alive), and which side it falls to (±1). */
  deadT: number;
  side: number;
}

const URL = `${import.meta.env.BASE_URL}models/wolf.glb`;
/** Ear-tip height of the model in metres (a big desert wolf: ~0.8 m at the shoulder). */
const HEIGHT = 1.02;

interface Slot {
  /** Placed at the wolf (position, yaw). */
  root: THREE.Group;
  /** Pitch/roll about the body's centre. */
  tilt: THREE.Group;
  model: THREE.Object3D;
  bones: Record<string, THREE.Bone>;
  /** The body's skinned mesh(es), bounded each pose so both passes can cull them. */
  skinned: THREE.SkinnedMesh[];
  /** Every animated or turned bone with its bind pose and the walk's tracks for it. */
  rig: { bone: THREE.Bone; q0: THREE.Quaternion; p0: THREE.Vector3; rot?: THREE.Interpolant; pos?: THREE.Interpolant }[];
  used: boolean;
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion();
const _lat = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _m = new THREE.Matrix4();

export class WolfSkins {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private clipLen = 1;
  /** Height of the body's centre above the feet (the death roll pivots here). */
  private centre = 0.5;

  static async load(count: number): Promise<WolfSkins | null> {
    try {
      const gltf = await new GLTFLoader().loadAsync(URL);
      return new WolfSkins(gltf, count);
    } catch (e) {
      console.warn('[wolf] model failed to load; keeping the procedural wolf', e);
      return null;
    }
  }

  private constructor(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, count: number) {
    this.group.name = 'wolves';
    const src = gltf.scene;
    // one material for every slot, in the game's own node material (the loader's is a physical one)
    let mat: THREE.MeshStandardNodeMaterial | null = null;
    src.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const old = m.material as THREE.MeshStandardMaterial;
      mat ??= new THREE.MeshStandardNodeMaterial({ map: old.map, roughness: 0.92, metalness: 0, side: THREE.FrontSide });
      if (old.map) old.map.anisotropy = 4;
      m.material = mat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // until pose() bounds it (skinned bounds don't follow the pose)
    });
    // normalise: measure the bind pose, scale to height, feet at y 0, body centred, head toward +Z
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const head = src.getObjectByName('head'), hips = src.getObjectByName('Hips');
    const fwd = new THREE.Vector3();
    if (head && hips) fwd.subVectors(head.getWorldPosition(new THREE.Vector3()), hips.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const turn = Math.atan2(fwd.x, fwd.z); // model heading in its own frame
    const k = HEIGHT / size.y;
    const centre = box.getCenter(new THREE.Vector3());
    this.centre = (size.y * k) * 0.48;
    this.clipLen = gltf.animations[0]?.duration || 1;

    for (let i = 0; i < count; i++) {
      const model = cloneSkinned(src);
      // in the slot: scaled, turned so the head faces +Z, feet on the floor, centred on the body
      const fit = new THREE.Group();
      fit.scale.setScalar(k);
      fit.rotation.y = -turn;
      fit.add(model);
      model.position.set(-centre.x, -box.min.y, -centre.z);
      const tilt = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.y = -this.centre;
      inner.add(fit);
      tilt.position.y = this.centre;
      tilt.add(inner);
      const root = new THREE.Group();
      root.add(tilt);
      root.visible = false;
      this.group.add(root);
      const bones: Record<string, THREE.Bone> = {};
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      });
      // the walk is sampled by hand, not through an AnimationMixer: the mixer only writes a bone
      // when its value changes, so once the clip's weight is 0 the layered turns below would pile
      // up frame after frame (a dead wolf curled up into a ball). Every frame starts from the bind pose.
      const rig = Object.values(bones).map((bone) => {
        const tr = (path: string) => gltf.animations[0]?.tracks.find((t) => t.name === `${bone.name}.${path}`);
        // createInterpolant is assigned per track at runtime (slerp for quaternions); the typings miss it
        const interp = (t?: THREE.KeyframeTrack) => (t ? (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() : undefined);
        return { bone, q0: bone.quaternion.clone(), p0: bone.position.clone(), rot: interp(tr('quaternion')), pos: interp(tr('position')) };
      });
      this.slots.push({ root, tilt, model, bones, skinned, rig, used: false });
    }
  }

  get size() {
    return this.slots.length;
  }

  hide(i: number) {
    const s = this.slots[i];
    if (s) s.root.visible = false;
  }

  /** Pose slot `i` for this frame. */
  pose(i: number, p: WolfPose) {
    const s = this.slots[i];
    if (!s) return;
    s.root.visible = true;
    s.root.position.set(p.pos.x, p.pos.y + p.bob - p.low * 0.06, p.pos.z);
    s.root.rotation.set(0, p.yaw, 0);
    const t = p.deadT;
    const D = t >= 0 ? death(t) : null;

    // the body: alive it follows the slope; dying it buckles, topples onto its side and settles
    if (D) {
      s.tilt.rotation.set(0.22 * (D.buckle - D.hind * 0.7) * (1 - D.topple), 0, p.side * (1.47 * D.topple + 0.07 * D.bounce), 'YXZ');
      s.tilt.position.y = THREE.MathUtils.lerp(this.centre * (1 - 0.3 * D.buckle), this.centre * 0.36, D.topple);
    } else {
      s.tilt.rotation.set(p.pitch, 0, p.roll, 'YXZ');
      s.tilt.position.y = this.centre;
    }

    // the stride, in step with the wolf's own phase (frozen where it fell); standing is the bind pose
    const w = Math.min(1, p.amp / 0.45) * (D ? 1 - D.release : 1);
    const time = ((((p.phase / (Math.PI * 2)) % 1) + 1) % 1) * this.clipLen;
    for (const r of s.rig) {
      r.bone.quaternion.copy(r.q0);
      r.bone.position.copy(r.p0);
      if (w <= 0) continue;
      if (r.rot) r.bone.quaternion.slerp(_cq.fromArray(r.rot.evaluate(time) as unknown as number[]), w);
      if (r.pos) r.bone.position.lerp(_cp.fromArray(r.pos.evaluate(time) as unknown as number[]), w);
    }
    s.root.updateMatrixWorld(true);
    // a sphere round the body's centre holds it standing, running or lying on its side
    _cp.setFromMatrixPosition(s.tilt.matrixWorld);
    for (const sk of s.skinned) boundSkinned(sk, _cp, 1.4);

    // layered on top, about the body's own axes in world space (so they stay right when it pitches
    // on a slope or lies on its side; the rig's bone axes never matter)
    s.tilt.getWorldQuaternion(_bq);
    const lat = _lat.set(-1, 0, 0).applyQuaternion(_bq); // + lifts the head / swings a hanging paw forward
    const up = _up.set(0, 1, 0).applyQuaternion(_bq);
    const fwd = _fwd.set(0, 0, 1).applyQuaternion(_bq); // + about this swings a paw toward the body's left
    const B = s.bones;
    if (!D) {
      if (B.chest) this.turn(B.chest, up, p.look * 0.3);
      if (B.head) {
        this.turn(B.head, up, p.look * 0.6);
        this.turn(B.head, lat, p.nod - p.low * 0.35);
      }
      if (B.tailstart) this.turn(B.tailstart, lat, p.tail);
      return;
    }
    // ---- dying
    // which way is the ground, sideways, once it's down: legs and head drop toward it
    const drop = -p.side;
    const legs = (pre: string, front: boolean, k: number) => {
      // buckle: front legs fold under the chest first (the nose goes down), then the hind legs
      // give; then everything stretches out, limp
      const b = front ? D.buckle : D.hind;
      const up0 = front ? 0.3 : 0.4, low0 = front ? -1.2 : -0.9;
      const out = front ? 0.45 : -0.5;
      this.turn(B[pre + '0'], lat, up0 * b * (1 - D.relax) + out * D.relax * k);
      this.turn(B[pre + '1'], lat, low0 * b * (1 - D.relax * 0.8));
      this.turn(B[pre + '2'], lat, (front ? -0.5 : 0.6) * b * (1 - D.relax * 0.6));
      // lying, the upper legs sag onto the lower ones
      this.turn(B[pre + '0'], fwd, drop * 0.7 * D.relax * k);
    };
    if (B.frontleg0) legs('frontleg', true, 1);
    if (B.R_frontleg0) legs('R_frontleg', true, 0.85);
    if (B.backleg0) legs('backleg', false, 1);
    if (B.R_backleg0) legs('R_backleg', false, 0.8);
    // a last kick of one hind leg
    if (D.twitch && B.backleg0) this.turn(B.backleg0, lat, -0.35 * D.twitch);
    if (B.head) {
      // the hit snaps the head up; then it drops, and comes to rest on the ground
      this.turn(B.head, lat, 0.18 * D.flinch - 0.45 * D.topple);
      this.turn(B.head, fwd, drop * 0.3 * D.relax);
    }
    if (B.chest) this.turn(B.chest, lat, -0.12 * D.buckle);
    if (B.tailstart) {
      this.turn(B.tailstart, lat, -0.35 * D.buckle);
      this.turn(B.tailstart, fwd, drop * 0.35 * D.relax);
    }
  }

  /** Rotate `bone` by `angle` about a world axis, at its own joint. */
  private turn(bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number) {
    if (!bone || Math.abs(angle) < 1e-4) return;
    // (pose() refreshed the slot's matrices top-down, and every turn refreshes its own subtree, so
    // the parent's matrixWorld is current: no walk up the ancestors per turn)
    _pq.setFromRotationMatrix(_m.extractRotation(bone.parent!.matrixWorld));
    _q.setFromAxisAngle(axis, angle).multiply(_pq);
    // local delta = parent⁻¹ · R · parent
    bone.quaternion.premultiply(_pq.invert().multiply(_q));
    bone.updateMatrixWorld(true);
  }
}

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const bump = (a: number, b: number, t: number) => (t > a && t < b ? Math.sin(((t - a) / (b - a)) * Math.PI) : 0);

/** The death, as overlapping phases over time `t` (seconds since the killing hit). */
function death(t: number) {
  return {
    /** the stride lets go */
    release: smooth(0, 0.22, t),
    /** the head snaps with the hit */
    flinch: bump(0, 0.22, t),
    /** the front legs give way, the body drops nose first */
    buckle: smooth(0.04, 0.32, t),
    /** then the hind legs */
    hind: smooth(0.2, 0.5, t),
    /** over onto its side */
    topple: smooth(0.28, 0.78, t),
    /** a small settle as it lands */
    bounce: bump(0.74, 1.0, t) - bump(1.0, 1.2, t) * 0.4,
    /** everything goes limp */
    relax: smooth(0.7, 1.4, t),
    /** one last kick */
    twitch: bump(1.75, 2.15, t),
  };
}
