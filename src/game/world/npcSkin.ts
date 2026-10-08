import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { boundSkinned } from './kit';

/**
 * The named townsfolk as Meshy models (scripts/models/build-glb.mjs: rig + clips renamed to roles:
 * `idle`, `alt` (an occasional variation), `near` (you're within talking range), `listen`).
 *
 * Clips are sampled by hand, like the wolf (world/wolfSkin.ts): every bone starts from its bind
 * pose each frame, two clips crossfade, and the head-turn toward the player is layered on top as
 * world-axis rotations. An AnimationMixer would skip rewriting unchanged bones, and the layered
 * turns would then pile up. Seated clips put the hips in different places; each clip is offset so
 * the hips stay put on the seat, and the body is lowered onto the game's seat height.
 */

const BASE = `${import.meta.env.BASE_URL}models/`;
/** Characters that have a model: Dry Creek's six and the camp's four. */
export const NPC_MODELS = ['nia', 'doc', 'inez', 'sol', 'ren', 'wick', 'mara', 'hollis', 'pip', 'dez'] as const;
/** Head props, in Head-bone space (1 unit = 1 cm there; fits from Assets/MESHY_ASSETS.md §5). */
const PROPS: Record<string, { file: string; pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  hollis: { file: 'truckercap', pos: [-1.7, 20.3, 2.6], rot: [-7.5, 3.2, 3.6], scale: 16 },
  dez: { file: 'headset', pos: [-1.0, 10.3, -14.2], rot: [-20.9, 2.3, 3.3], scale: 13.5 },
};

interface Track { bone: string; rot?: THREE.Interpolant; pos?: THREE.Interpolant }
interface Clip { name: string; dur: number; tracks: Track[]; hips: THREE.Vector3 }
interface Template { scene: THREE.Object3D; clips: Map<string, Clip>; bind: Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>; prop?: THREE.Object3D }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class NpcModels {
  private t = new Map<string, Template>();

  static async load(): Promise<NpcModels | null> {
    if (new URLSearchParams(location.search).has('procnpc')) return null;
    const out = new NpcModels();
    const L = new GLTFLoader();
    await Promise.all(NPC_MODELS.map(async (id) => {
      try {
        const g = await L.loadAsync(`${BASE}${id}.glb`);
        const T = template(g.scene, g.animations);
        const P = PROPS[id];
        if (P) {
          const pg = await L.loadAsync(`${BASE}${P.file}.glb`);
          let mat: THREE.MeshStandardNodeMaterial | null = null;
          pg.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            mat ??= new THREE.MeshStandardNodeMaterial({ map: (m.material as THREE.MeshStandardMaterial).map, roughness: 0.7, metalness: 0 });
            m.material = mat;
            m.castShadow = false;
            m.frustumCulled = true; // rigid on the Head bone: its own bounds follow it
          });
          const d = Math.PI / 180;
          pg.scene.position.set(...P.pos);
          pg.scene.rotation.set(P.rot[0] * d, P.rot[1] * d, P.rot[2] * d);
          pg.scene.scale.setScalar(P.scale);
          T.prop = pg.scene;
        }
        out.t.set(id, T);
      } catch (e) {
        console.warn(`[npc] ${id} model failed to load; keeping the procedural figure`, e);
      }
    }));
    return out.t.size ? out : null;
  }

  has(id: string) {
    return this.t.has(id);
  }

  /** A posed, animated copy of `id`. `seated`: lower the hips onto `hipY` (the game's seat). */
  make(id: string, seated: boolean, hipY: number) {
    const T = this.t.get(id);
    return T ? new NpcActor(T, seated, hipY) : null;
  }
}

function template(scene: THREE.Object3D, anims: THREE.AnimationClip[]): Template {
  // one node material per character (the loader's is a physical one)
  let mat: THREE.MeshStandardNodeMaterial | null = null;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const old = m.material as THREE.MeshStandardMaterial;
    mat ??= new THREE.MeshStandardNodeMaterial({ map: old.map, roughness: 0.88, metalness: 0 });
    m.material = mat;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // until the actor bounds it (boundSkinned, per update)
  });
  scene.updateMatrixWorld(true);
  const bones: Record<string, THREE.Bone> = {};
  scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
  const bind = new Map(Object.entries(bones).map(([n, b]) => [n, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const clips = new Map<string, Clip>();
  for (const a of anims) {
    const tracks: Track[] = [];
    const interp = (t?: THREE.KeyframeTrack) => (t ? (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() : undefined);
    for (const name of Object.keys(bones)) {
      const rot = interp(a.tracks.find((t) => t.name === `${name}.quaternion`));
      const pos = name === 'Hips' ? interp(a.tracks.find((t) => t.name === `${name}.position`)) : undefined;
      if (rot || pos) tracks.push({ bone: name, rot, pos });
    }
    // where the hips sit at the clip's first frame (model space): seated clips differ by ~0.3 m
    const clip: Clip = { name: a.name, dur: a.duration || 1, tracks, hips: new THREE.Vector3() };
    sample(bones, bind, clip, 0, 1, true);
    scene.updateMatrixWorld(true);
    bones.Hips?.getWorldPosition(clip.hips);
    clips.set(a.name, clip);
  }
  // back to bind for cloning
  for (const [n, b] of Object.entries(bones)) { b.quaternion.copy(bind.get(n)!.q); b.position.copy(bind.get(n)!.p); }
  scene.updateMatrixWorld(true);
  return { scene, clips, bind };
}

/** Blend `clip` at time `t` into the bones with weight `w` (`reset`: start from the bind pose). */
function sample(B: Record<string, THREE.Bone>, bind: Template['bind'], clip: Clip, t: number, w: number, reset: boolean) {
  if (reset) for (const [n, b] of Object.entries(B)) { const k = bind.get(n); if (k) { b.quaternion.copy(k.q); b.position.copy(k.p); } }
  for (const tr of clip.tracks) {
    const b = B[tr.bone];
    if (!b) continue;
    if (tr.rot) b.quaternion.slerp(_q.fromArray(tr.rot.evaluate(t) as unknown as number[]), w);
    if (tr.pos) b.position.lerp(_v.fromArray(tr.pos.evaluate(t) as unknown as number[]), w);
  }
}

export class NpcActor {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private B: Record<string, THREE.Bone> = {};
  private skinned: THREE.SkinnedMesh[] = [];
  private cur: Clip;
  private prev: Clip | null = null;
  private tCur = Math.random() * 3;
  private tPrev = 0;
  private fade = 1;
  private altT = 8 + Math.random() * 12;
  private anchor: THREE.Vector3;

  constructor(private T: Template, seated: boolean, hipY: number) {
    this.model = cloneSkinned(T.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.B[o.name] = o as THREE.Bone;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
    });
    if (T.prop && this.B.Head) this.B.Head.add(T.prop.clone(true));
    this.cur = T.clips.get('idle') ?? [...T.clips.values()][0];
    // hips stay where the idle clip puts them; seated people sink onto the game's seat
    this.anchor = this.cur.hips.clone();
    // seated, the game's point is the seat (the procedural figure's hips sit straight over it, feet
    // ~0.44 m in front): put the model's hips there, not its feet, or it sits behind its log
    if (seated) { this.anchor.x = 0; this.anchor.z = 0; }
    // (a short person on a high seat sits up on it with their feet off the ground, like Pip on the log)
    if (seated) this.root.position.y = THREE.MathUtils.clamp(hipY - this.anchor.y, -0.16, 0.32);
  }

  private play(name: string) {
    const c = this.T.clips.get(name);
    if (!c || c === this.cur) return;
    this.prev = this.cur;
    this.tPrev = this.tCur;
    this.cur = c;
    this.tCur = 0;
    this.fade = 0;
  }

  /**
   * One frame. `near`: the player is within talking range. `look`/`nod`: head turn toward them
   * (radians, already clamped and smoothed by the crowd).
   */
  update(dt: number, near: boolean, look: number, nod: number) {
    const C = this.T.clips;
    // what to play: talk when you're close, the idle (and now and then its variation) otherwise
    if (near && C.has('near')) this.play('near');
    else if (!near) {
      if (this.cur.name === 'near' || this.cur.name === 'listen') this.play('idle');
      if ((this.altT -= dt) <= 0) {
        this.altT = 14 + Math.random() * 16;
        if (C.has('alt')) this.play(this.cur.name === 'alt' ? 'idle' : 'alt');
      }
      // a variation plays once, then back to the idle
      if (this.cur.name === 'alt' && this.tCur > this.cur.dur - 0.4) this.play('idle');
    }
    this.tCur = (this.tCur + dt) % this.cur.dur;
    this.fade = Math.min(1, this.fade + dt / 0.6);
    const f = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.prev && f < 1) {
      this.tPrev = (this.tPrev + dt) % this.prev.dur;
      sample(this.B, this.T.bind, this.prev, this.tPrev, 1, true);
      sample(this.B, this.T.bind, this.cur, this.tCur, f, false);
    } else {
      this.prev = null;
      sample(this.B, this.T.bind, this.cur, this.tCur, 1, true);
    }
    // keep the hips over the same spot whatever the clip (seated clips sit in different places)
    const off = _v2.copy(this.anchor).sub(this.cur.hips);
    if (this.prev && f < 1) off.lerp(_v.copy(this.anchor).sub(this.prev.hips), 1 - f);
    this.model.position.set(off.x, 0, off.z);
    this.root.updateMatrixWorld(true);
    // the head (and a little of the neck) turns toward the player
    const H = this.B.Head, N = this.B.neck;
    if (H || N) {
      this.root.getWorldQuaternion(_q2);
      const lat = _v.set(-1, 0, 0).applyQuaternion(_q2); // + lifts the chin
      if (N) { this.turn(N, UP, look * 0.4); this.turn(N, lat, -nod * 0.4); }
      if (H) { this.turn(H, UP, look * 0.6); this.turn(H, lat, -nod * 0.6); }
    }
    // a sphere round the hips holds the pose (seated or standing), so both passes can cull it
    const hips = this.B.Hips;
    if (hips) {
      _c.setFromMatrixPosition(hips.matrixWorld);
      for (const sk of this.skinned) boundSkinned(sk, _c, 1.3);
    }
  }

  /** Rotate a bone about a world axis at its own joint (independent of the rig's bone axes). */
  private turn(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    if (Math.abs(angle) < 1e-4) return;
    // (the actor's matrices were just refreshed top-down, so the parent's is current)
    _pq.setFromRotationMatrix(_m.extractRotation(bone.parent!.matrixWorld));
    _q.setFromAxisAngle(axis, angle).multiply(_pq);
    bone.quaternion.premultiply(_pq.invert().multiply(_q));
    bone.updateMatrixWorld(true);
  }
}
