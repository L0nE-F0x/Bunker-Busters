import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

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
  /** Death 0 (alive) .. 1 (lying on its side), and which side. */
  dead: number;
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
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  bones: Record<string, THREE.Bone>;
  used: boolean;
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion();
const _lat = new THREE.Vector3(), _up = new THREE.Vector3();

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
      m.frustumCulled = false; // skinned bounds don't follow the pose; the whole pack is near anyway
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
      const mixer = new THREE.AnimationMixer(model);
      const walk = mixer.clipAction(gltf.animations[0]);
      walk.play();
      const bones: Record<string, THREE.Bone> = {};
      model.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
      this.slots.push({ root, tilt, model, mixer, walk, bones, used: false });
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
    // death: roll onto its side about the body's centre and sink to the ground
    const d = p.dead;
    const e = d * d * (3 - 2 * d);
    s.tilt.rotation.set(p.pitch, 0, p.roll + p.side * e * 1.45, 'YXZ');
    s.tilt.position.y = this.centre * (1 - e * 0.62);

    // the stride, in step with the wolf's own phase; standing still is the bind pose
    s.walk.weight = d > 0 ? Math.max(0, 1 - e * 1.5) * Math.min(1, p.amp / 0.45) : Math.min(1, p.amp / 0.45);
    s.walk.time = ((((p.phase / (Math.PI * 2)) % 1) + 1) % 1) * this.clipLen;
    s.mixer.update(0);
    s.root.updateMatrixWorld(true);

    // layered on top, about the body's own axes in world space (so they stay right when it pitches
    // on a slope or lies on its side; the rig's bone axes never matter)
    s.tilt.getWorldQuaternion(_bq);
    const lat = _lat.set(-1, 0, 0).applyQuaternion(_bq); // + about this lifts the head
    const up = _up.set(0, 1, 0).applyQuaternion(_bq);
    const B = s.bones;
    if (B.chest) this.turn(B.chest, up, p.look * 0.3);
    if (B.head) {
      this.turn(B.head, up, p.look * 0.6);
      this.turn(B.head, lat, p.nod - p.low * 0.35);
    }
    if (B.tailstart) this.turn(B.tailstart, lat, p.tail);
    if (d > 0) {
      // legs go slack and fold a little as it falls
      for (const [n, a] of [['frontleg', 0.5], ['R_frontleg', 0.35], ['backleg', -0.55], ['R_backleg', -0.4]] as const) {
        const b = B[n];
        if (b) this.turn(b, lat, a * e);
      }
      if (B.head) this.turn(B.head, lat, -0.35 * e);
    }
  }

  /** Rotate `bone` by `angle` about a world axis, at its own joint. */
  private turn(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    if (Math.abs(angle) < 1e-4) return;
    const parent = bone.parent!;
    parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(axis, angle);
    // local delta = parent⁻¹ · R · parent
    const delta = _pq.clone().invert().multiply(_q).multiply(_pq);
    bone.quaternion.premultiply(delta);
    bone.updateMatrixWorld(true);
  }
}
