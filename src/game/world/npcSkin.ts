import * as THREE from 'three/webgpu';
import { loadGLB } from '@/engine/models';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { boundSkinned } from './kit';
import { WristTwist, mittFrame } from './limbTwist';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isMobile } from '@/engine/device';

/**
 * The named townsfolk as Meshy models (scripts/models/build-npcs.sh → build-glb.mjs: rig + clips
 * renamed to roles). Roles by prefix: `idle*` loops (a pool: each person drifts between them),
 * `near*` loops while you're within talking range, `ins*`/`alt*` one-shot gestures dropped into the
 * idle now and then. A clip's `src` (glTF extras) names the library motion it came from, so mirrored
 * and borrowed copies count as the same motion when neighbours compare notes (npc.ts).
 *
 * Clips are sampled by hand, like the wolf (world/wolfSkin.ts): every bone starts from its bind
 * pose each frame, two clips crossfade, and the head-turn toward the player is layered on top as
 * world-axis rotations. An AnimationMixer would skip rewriting unchanged bones, and the layered
 * turns would then pile up. Seated clips put the hips in different places; each clip is offset so
 * the hips stay put on the seat, and the body is lowered onto the game's seat height.
 *
 * Nobody moves in lockstep: each person plays at their own speed (0.9–1.1×), every looping clip
 * keeps its own running clock from a random start (a switch crossfades into wherever that clock is,
 * never back to 0), and switches wait a beat (and ask the crowd) instead of firing on the frame
 * something changed.
 */

/** Characters that have a model: Dry Creek's six, the camp's four, the Panopticon's four (Ezra, Ada, two reviewers), the Spire's three, the Dome's three (Hunter, Gil, the Helpers), the Cathedral's two (Orrin, the associates), the Fortress's two (Kit, the technicians), and Agnes in Bunker Zero. */
export const NPC_MODELS = ['nia', 'doc', 'inez', 'sol', 'ren', 'wick', 'mara', 'hollis', 'pip', 'dez', 'ezra', 'ada', 'rev1', 'rev2', 'prudence', 'noor', 'benny', 'hunter', 'gil', 'helper', 'orrin', 'assoc', 'kit', 'tech', 'agnes'] as const;
/** Head props, in Head-bone space (1 unit = 1 cm there; fits from Assets/MESHY_ASSETS.md §5). */
export const NPC_PROPS: Record<string, { file: string; pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  hollis: { file: 'truckercap', pos: [-1.7, 20.3, 2.6], rot: [-7.5, 3.2, 3.6], scale: 16 },
  dez: { file: 'headset', pos: [-1.0, 10.3, -14.2], rot: [-20.9, 2.3, 3.3], scale: 13.5 },
  // the Chip Fortress's cooling technicians wear Kade's respirator (the model came out bare-faced)
  tech: { file: 'respirator', pos: [0.4, 12.4, -2.4], rot: [-6, 0, 0], scale: 13.5 },
};
/**
 * Props in a hand, placed in the mitt's frame (measured from the mesh at bind: X wrist → fingers,
 * Y out of the palm, Z across it; metres from the mitt's centre), since each rig rests its Hand
 * bone at its own roll. `palm`: which way the palm faces at bind (model space), when "down" isn't it.
 */
const HAND_PROPS: Record<string, { side: 'Left' | 'Right'; kind: 'mug' | 'clipboard'; at: [number, number, number]; rot?: [number, number, number]; palm?: [number, number, number] }> = {
  ren: { side: 'Right', kind: 'mug', at: [-0.045, 0.055, 0], palm: [0, 1, 0] },
  pip: { side: 'Right', kind: 'mug', at: [-0.04, 0.05, 0], palm: [0, 1, 0] },
  doc: { side: 'Left', kind: 'clipboard', at: [0.11, 0.02, 0] },
};
/** Seated people who chat among themselves now and then: their `near` clips join the idle pool. */
const CHATS = new Set(['sol', 'mara', 'hollis', 'dez']);
/**
 * Per person and role, a last correction to a hand (axis in the Hand bone's own frame, degrees),
 * after the wrist twist is spread. Only where a close-up shows a miss (prop lab what=npc).
 */
const HAND_FIX: Record<string, Record<string, { L?: [number, number, number, number]; R?: [number, number, number, number] }>> = {};
/**
 * Seated, a talk loop plays this much over the calm loop under it: the library's seated talk
 * (Sitting_Answering_Questions) throws its arms wide and leans back, which on a log by a fire read as
 * someone about to fall off.
 */
const SEATED_TALK = 0.55;
/**
 * A `*_up` clip (a standing talk loop, played seated) moves only these bones, at these shares, over
 * the seated loop under it: the arms gesture fully (a half-blended arm hangs in mid-air), the head
 * nods along, and the hips, spine and legs stay seated.
 */
const UPPER: Record<string, number> = {
  LeftShoulder: 1, LeftArm: 1, LeftForeArm: 1, LeftHand: 1,
  RightShoulder: 1, RightArm: 1, RightForeArm: 1, RightHand: 1,
  neck: 0.5, Head: 0.5,
};
/**
 * Seated, the library's clips were made on a ~45 cm chair and the game's seats differ (the camp's logs
 * are 62 cm): the feet are put back on the ground by leg IK. A foot this high over the clip's floor
 * (ankle, m) is up on the other knee and rides with it instead.
 */
const FOOT_UP = 0.3;
/** A planted boot is levelled (heel and toe at one height) by at most this much (rad). */
const FLAT_MAX = (25 * Math.PI) / 180;
/** How far the feet may slide forward to reach the ground from a high seat (m), and the reach used (× leg length). */
const SEAT_SLIDE = 0.06, SEAT_REACH = 0.97;
/**
 * On a seat with no back (a log, a crate, a stool) the trunk leans back at most this much (rad). The
 * library's seated loop (Sit_Cross_Legged) reclines 13-23° all through, as in a chair with a back; on
 * the camp's logs that read as people falling off them.
 */
const BACKLESS_LEAN = (3 * Math.PI) / 180;
/** Share of a hand's roll about the forearm that the forearm takes, and what the hand may keep (°). */
const TWIST = { k: 0.55, twist: 50, swing: 70 };

interface Track { bone: string; rot?: THREE.Interpolant; pos?: THREE.Interpolant }
interface Clip {
  name: string;
  /** The library motion it was built from (mirrors and borrowed copies share it). */
  src: string;
  /** Index into an actor's clocks. */
  i: number;
  dur: number;
  /** A one-shot gesture (plays from 0, once, then back to the loop it interrupted). */
  once: boolean;
  tracks: Track[];
  hips: THREE.Vector3;
  /** Arms and head only, over the seated loop under it (`*_up`: UPPER). */
  up: boolean;
  /**
   * The clip's mean turn of the hips off the bind pose's facing (radians, about up). Library clips
   * carry one (the talk loops face ~15° aside); standing people cancel it, so they face where the
   * game turned them.
   */
  yaw: number;
}
interface Template {
  id: string;
  scene: THREE.Object3D;
  clips: Map<string, Clip>;
  list: Clip[];
  idle: Clip[];
  near: Clip[];
  ins: Clip[];
  bind: Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>;
  /** Wrist twist spreading, per side. */
  wrist: { side: 'Left' | 'Right'; w: WristTwist }[];
  /** Each mitt's palm normal (Hand-bone space, measured at bind), for the relaxed arms. */
  palm: Partial<Record<'Left' | 'Right', THREE.Vector3>>;
  /** Each boot's sole (measured at bind): heel in the Foot bone's space, toe tip in `tipBone`'s. */
  sole: Partial<Record<'Left' | 'Right', Sole>>;
  prop?: THREE.Object3D;
  /** Held in a hand (on that Hand bone, in its space). */
  held?: { bone: string; obj: THREE.Object3D };
}

/** The crowd's say in what an actor starts next (npc.ts): neighbours don't start one motion together. */
export interface ClipCoord {
  /** What the neighbours are playing now: the motion and how far through it (0..1). */
  playing(): { src: string; at: number }[];
  /** May it start `src` now? (No neighbour switched to it in the last few seconds.) */
  may(src: string): boolean;
  started(src: string): void;
  /** Is a neighbour talking (a talk loop, to the circle or to you)? Then this one listens. */
  talking(): boolean;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _rc = new THREE.Vector3(), _rp = new THREE.Vector3(), _re = new THREE.Vector3();
const _ru = new THREE.Vector3(), _rn = new THREE.Vector3(), _rq = new THREE.Quaternion();
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class NpcModels {
  private t = new Map<string, Template>();

  /** `ids`: only these (the prop lab, the boot's first batch); default every townsperson. */
  static async load(ids: readonly string[] = NPC_MODELS): Promise<NpcModels | null> {
    if (new URLSearchParams(location.search).has('procnpc')) return null;
    const out = new NpcModels();
    await Promise.all(ids.map((id) => out.one(id)));
    return out.t.size ? out : null;
  }

  /**
   * More people into this set, one at a time with `between` awaited after each (a frame, so the
   * title keeps moving while the late cast unpacks): the owners and staff of Tiers 2–8 (game/lateCast.ts).
   */
  async add(ids: readonly string[], between?: () => Promise<unknown>) {
    for (const id of ids) {
      await this.one(id);
      await between?.();
    }
  }

  private async one(id: string) {
    try {
      const g = await loadGLB(id);
      const T = template(id, g.scene, g.animations);
      const P = NPC_PROPS[id];
      if (P) {
        const pg = await loadGLB(P.file);
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
      this.t.set(id, T);
    } catch (e) {
      console.warn(`[npc] ${id} model failed to load; keeping the procedural figure`, e);
    }
  }

  has(id: string) {
    return this.t.has(id);
  }

  /** A posed, animated copy of `id`. `seated`: lower the hips onto `hipY` (the game's seat). */
  /** `backless`: seated on a log, crate or stool (the trunk stays upright: BACKLESS_LEAN). */
  make(id: string, seated: boolean, hipY: number, backless = false) {
    const T = this.t.get(id);
    return T ? new NpcActor(T, seated, hipY, backless) : null;
  }
}

function template(id: string, scene: THREE.Object3D, anims: THREE.AnimationClip[]): Template {
  // one node material per character (the loader's is a physical one)
  let mat: THREE.MeshStandardNodeMaterial | null = null;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const old = m.material as THREE.MeshStandardMaterial;
    // the normal map carries the folds, seams and the shape of the face that 12k triangles can't
    // (GLTFLoader already flipped normalScale.y for a mesh without tangents); roughness from the
    // model's own map where it has one. Metalness stays 0: with no environment map metal reads black.
    mat ??= new THREE.MeshStandardNodeMaterial({
      map: old.map, normalMap: isMobile ? null : old.normalMap, normalScale: old.normalScale?.clone(), // (phones: memory)
      roughnessMap: old.roughnessMap, roughness: old.roughnessMap ? 1 : 0.88, metalness: 0,
    });
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
  const list: Clip[] = [];
  for (const a of anims) {
    const tracks: Track[] = [];
    const interp = (t?: THREE.KeyframeTrack) => (t ? (t as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() : undefined);
    for (const name of Object.keys(bones)) {
      const rot = interp(a.tracks.find((t) => t.name === `${name}.quaternion`));
      const pos = name === 'Hips' ? interp(a.tracks.find((t) => t.name === `${name}.position`)) : undefined;
      if (rot || pos) tracks.push({ bone: name, rot, pos });
    }
    // where the hips sit at the clip's first frame (model space): seated clips differ by ~0.3 m
    const clip: Clip = {
      name: a.name, src: (a.userData?.src as string | undefined) ?? a.name, i: list.length, dur: a.duration || 1,
      once: /^(ins|alt)/.test(a.name), up: /_up$/.test(a.name), tracks, hips: new THREE.Vector3(), yaw: 0,
    };
    // the hips' mean facing over the clip, against the bind pose's
    if (bones.Hips) {
      const facing = () => { bones.Hips.getWorldQuaternion(_q2); _v.set(0, 0, 1).applyQuaternion(_q2); return Math.atan2(_v.x, _v.z); };
      for (const [n, b] of Object.entries(bones)) { const k = bind.get(n); if (k) { b.quaternion.copy(k.q); b.position.copy(k.p); } }
      scene.updateMatrixWorld(true);
      const y0 = facing();
      let sx = 0, sz = 0;
      for (let k = 0; k < 24; k++) {
        sample(bones, bind, clip, (k / 24) * clip.dur, 1, true);
        scene.updateMatrixWorld(true);
        const y = facing() - y0;
        sx += Math.sin(y); sz += Math.cos(y);
      }
      clip.yaw = Math.atan2(sx, sz);
    }
    sample(bones, bind, clip, 0, 1, true);
    scene.updateMatrixWorld(true);
    bones.Hips?.getWorldPosition(clip.hips);
    clips.set(a.name, clip);
    list.push(clip);
  }
  // back to bind for cloning
  for (const [n, b] of Object.entries(bones)) { b.quaternion.copy(bind.get(n)!.q); b.position.copy(bind.get(n)!.p); }
  scene.updateMatrixWorld(true);
  const idle = list.filter((c) => c.name.startsWith('idle'));
  const near = list.filter((c) => c.name.startsWith('near'));
  if (!idle.length) idle.push(list[0]);
  const wrist = (['Left', 'Right'] as const).flatMap((side) => {
    const h = bind.get(side + 'Hand');
    return h && bind.has(side + 'ForeArm') ? [{ side, w: new WristTwist(h.q, h.p) }] : [];
  });
  let body: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body ??= o as THREE.SkinnedMesh; });
  const palm: Template['palm'] = {};
  for (const sd of ['Left', 'Right'] as const) {
    // (Meshy's A-pose holds the palms up and a little forward: checked on each standing rig)
    const m = body && bones[sd + 'Hand'] ? mittFrame(body, bones[sd + 'Hand'], new THREE.Vector3(0, 1, 0.3)) : null;
    if (m) palm[sd] = m.palm;
  }
  const sole: Template['sole'] = {};
  for (const sd of ['Left', 'Right'] as const) {
    const m = body ? soleOf(body, bones[sd + 'Foot'], bones[sd + 'ToeBase']) : null;
    if (m) sole[sd] = m;
  }
  return { id, scene, clips, list, idle, near, ins: list.filter((c) => c.once), bind, wrist, palm, sole, held: heldProp(id, scene, bones) };
}

interface Sole { heel: THREE.Vector3; tip: THREE.Vector3; tipBone: string }
/**
 * Where a boot meets the ground, measured on the mesh at bind (standing, soles flat): of the vertices
 * the foot and toe bones carry, the ones within 2 cm of the lowest, and of those the rearmost (the heel,
 * kept in the Foot bone's space) and the foremost (the toe, in the toe bone's).
 */
function soleOf(mesh: THREE.SkinnedMesh, foot?: THREE.Bone, toe?: THREE.Bone): Sole | null {
  if (!foot) return null;
  const fi = mesh.skeleton.bones.indexOf(foot), ti = toe ? mesh.skeleton.bones.indexOf(toe) : -1;
  if (fi < 0) return null;
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute, si = g.attributes.skinIndex as THREE.BufferAttribute, sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k); if (b === fi || b === ti) w += sw.getComponent(i, k); }
    if (w < 0.5) continue;
    const p = new THREE.Vector3().fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, p);
    pts.push(p.applyMatrix4(mesh.matrixWorld));
  }
  if (pts.length < 10) return null;
  const low = Math.min(...pts.map((p) => p.y));
  const ankle = foot.getWorldPosition(new THREE.Vector3());
  const tipAt = (toe ?? foot).getWorldPosition(new THREE.Vector3());
  const along = tipAt.clone().sub(ankle).setY(0).normalize();
  let heel: THREE.Vector3 | null = null, tip: THREE.Vector3 | null = null;
  for (const p of pts) {
    if (p.y > low + 0.02) continue;
    const d = p.clone().sub(ankle).dot(along);
    if (!heel || d < heel.clone().sub(ankle).dot(along)) heel = p;
    if (!tip || d > tip.clone().sub(ankle).dot(along)) tip = p;
  }
  if (!heel || !tip) return null;
  const inv = new THREE.Matrix4();
  return {
    heel: heel.clone().applyMatrix4(inv.copy(foot.matrixWorld).invert()),
    tip: tip.clone().applyMatrix4(inv.copy((toe ?? foot).matrixWorld).invert()),
    tipBone: (toe ?? foot).name,
  };
}

let _heldMat: THREE.MeshStandardNodeMaterial | null = null;
const _heldGeo: Partial<Record<'mug' | 'clipboard', THREE.BufferGeometry>> = {};
/** The mug (npc.ts's: a cylinder and a handle) and the clipboard, in the mitt frame, vertex-coloured. */
function heldGeometry(kind: 'mug' | 'clipboard') {
  const g = _heldGeo[kind];
  if (g) return g;
  const part = (geo: THREE.BufferGeometry, m: THREE.Matrix4, color: string) => {
    const x = geo.index ? geo.toNonIndexed() : geo;
    x.applyMatrix4(m);
    x.deleteAttribute('uv');
    const c = new THREE.Color(color), n = x.attributes.position.count;
    x.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? c.r : i % 3 === 1 ? c.g : c.b)), 3));
    return x;
  };
  const M = (x = 0, y = 0, z = 0, r?: THREE.Euler) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(r ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
  const parts = kind === 'mug'
    // across the palm (the fingers wrap it), the handle on the far side
    ? [part(new THREE.CylinderGeometry(0.042, 0.038, 0.1, 10), M(0, 0, 0, new THREE.Euler(Math.PI / 2, 0, 0)), '#7a2f24'),
      part(new THREE.TorusGeometry(0.025, 0.008, 5, 8), M(0, 0.05, 0, new THREE.Euler(0, Math.PI / 2, 0)), '#7a2f24'),
      part(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 10), M(0, 0, -0.046, new THREE.Euler(Math.PI / 2, 0, 0)), '#3a2416')]
    // gripped by its top edge: the board lies in the palm's plane, hanging past the fingers
    : [part(new THREE.BoxGeometry(0.32, 0.012, 0.24), M(), '#6b4a2e'),
      part(new THREE.BoxGeometry(0.27, 0.004, 0.21), M(0.01, 0.008, 0), '#e8e2d2'),
      part(new THREE.BoxGeometry(0.025, 0.02, 0.08), M(-0.15, 0.01, 0), '#9a9890')];
  return (_heldGeo[kind] = mergeGeometries(parts)!);
}

/** `id`'s hand prop, built on its Hand bone's mitt frame at bind (null: none, or the mitt unmeasurable). */
function heldProp(id: string, scene: THREE.Object3D, bones: Record<string, THREE.Bone>) {
  const P = HAND_PROPS[id];
  const hand = P && bones[P.side + 'Hand'];
  let body: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body ??= o as THREE.SkinnedMesh; });
  if (!P || !hand || !body) return undefined;
  const m = mittFrame(body, hand, new THREE.Vector3(...(P.palm ?? [0, -1, 0])));
  if (!m) return undefined;
  _heldMat ??= new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  const mesh = new THREE.Mesh(heldGeometry(P.kind), _heldMat);
  mesh.name = `${id}-${P.kind}`;
  mesh.castShadow = false;
  mesh.position.set(...P.at);
  if (P.rot) mesh.rotation.set(...(P.rot.map((d) => (d * Math.PI) / 180) as [number, number, number]));
  // the frame: X along the fingers, Y out of the palm, Z across; bone space is cm, the prop metres
  const obj = new THREE.Group();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(m.long, m.palm, m.side));
  obj.position.copy(m.c);
  obj.scale.setScalar(1 / hand.matrixWorld.getMaxScaleOnAxis());
  obj.add(mesh);
  return { bone: hand.name, obj };
}

/**
 * Blend `clip` at time `t` into the bones with weight `w` (`reset`: start from the bind pose).
 * `mask`: only these bones, each at its share of `w` (and no hips travel).
 */
function sample(B: Record<string, THREE.Bone>, bind: Template['bind'], clip: Clip, t: number, w: number, reset: boolean, mask?: Record<string, number>) {
  if (reset) for (const [n, b] of Object.entries(B)) { const k = bind.get(n); if (k) { b.quaternion.copy(k.q); b.position.copy(k.p); } }
  for (const tr of clip.tracks) {
    const b = B[tr.bone];
    if (!b) continue;
    const k = mask ? (mask[tr.bone] ?? 0) * w : w;
    if (k <= 0) continue;
    if (tr.rot) b.quaternion.slerp(_q.fromArray(tr.rot.evaluate(t) as unknown as number[]), k);
    if (tr.pos && !mask) b.position.lerp(_v.fromArray(tr.pos.evaluate(t) as unknown as number[]), k);
  }
}

const _ja = new THREE.Vector3(), _jb = new THREE.Vector3(), _jc = new THREE.Vector3(), _jq = new THREE.Quaternion(), _jp = new THREE.Quaternion();
/** Turn `bone` about its own joint so that its joint→`from` direction points at `to` (world points). */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) {
  bone.getWorldPosition(_jc);
  _ja.subVectors(from, _jc).normalize();
  _jb.subVectors(to, _jc).normalize();
  bone.getWorldQuaternion(_jq).premultiply(_jp.setFromUnitVectors(_ja, _jb));
  setWorldQuat(bone, _jq);
}
function setWorldQuat(bone: THREE.Bone, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_jp);
  bone.quaternion.copy(_jp.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

const _la = new THREE.Vector3(), _lk = new THREE.Vector3(), _lc = new THREE.Vector3(), _ld = new THREE.Vector3(), _lp = new THREE.Vector3(), _lt = new THREE.Vector3(), _lq = new THREE.Quaternion();
/**
 * Two-bone IK: put `foot`'s joint on `target`, the knee bending the way the clip bent it, the sole
 * kept as the clip held it. Writes the knee's move into `kneeMove`.
 */
function legTo(up: THREE.Bone, knee: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, fwd: THREE.Vector3, kneeMove: THREE.Vector3) {
  const A = up.getWorldPosition(_la), K = knee.getWorldPosition(_lk), C = foot.getWorldPosition(_lc);
  const a = A.distanceTo(K), b = K.distanceTo(C);
  foot.getWorldQuaternion(_lq);
  const dir = _ld.subVectors(target, A);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  dir.normalize();
  const pole = _lp.subVectors(K, A);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-8) pole.copy(fwd).addScaledVector(dir, -fwd.dot(dir));
  pole.normalize();
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const knee2 = _lt.copy(A).addScaledVector(dir, a * cos).addScaledVector(pole, a * Math.sqrt(1 - cos * cos));
  kneeMove.subVectors(knee2, K);
  aim(up, K, knee2);
  knee.getWorldPosition(_lk);
  foot.getWorldPosition(_lc);
  aim(knee, _lc, _lt.copy(A).addScaledVector(dir, d));
  setWorldQuat(foot, _lq);
}
const LEGS = [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']] as const;
const _sr = new THREE.Vector3(), _sh = new THREE.Vector3(), _sf = new THREE.Vector3(), _sq = new THREE.Quaternion();
const _sT = [new THREE.Vector3(), new THREE.Vector3()], _sK = [new THREE.Vector3(), new THREE.Vector3()], _sA = new THREE.Vector3();
const _sN = new THREE.Vector3(), _sX = new THREE.Vector3(), _sQ = new THREE.Quaternion(), _sL = [new THREE.Quaternion(), new THREE.Quaternion()];
const _pH = new THREE.Vector3(), _pT = new THREE.Vector3(), _pD = new THREE.Vector3(), _pA = new THREE.Vector3(), _pK = new THREE.Vector3(), _pQ = new THREE.Quaternion(), _pR = new THREE.Quaternion();

export class NpcActor {
  readonly root = new THREE.Group();
  /** Set by the crowd: lets neighbours keep out of each other's step. */
  coord: ClipCoord | null = null;
  private model: THREE.Object3D;
  private B: Record<string, THREE.Bone> = {};
  private skinned: THREE.SkinnedMesh[] = [];
  /** This person's tempo. */
  private rate = rand(0.9, 1.1);
  /** A walker's playback against its ground speed (`matchSpeed`), × the tempo; 1 standing. */
  pace = 1;

  /** Walking (an in-place walk clip) at `speed` m/s: play it so a planted foot stays planted. `natural`: the clip's own ground speed at 1×. */
  matchSpeed(speed: number, natural: number) {
    this.pace = speed / (natural * this.rate);
  }
  /** One running clock per clip (s), from a random start. */
  private clock: Float64Array;
  private cur: Clip;
  private prev: Clip | null = null;
  /** The last calm loop (not a talk loop): seated, it stays under the talking (SEATED_TALK). */
  private calm: Clip | null = null;
  /** The loop an insert interrupted (and returns to). */
  private base: Clip;
  private fade = 1;
  private fadeDur = 1;
  private pending: { clip: Clip; at: number } | null = null;
  private time = 0;
  private wasNear = false;
  /** Seconds to the next idle variation and the next gesture. */
  private varT = rand(6, 24);
  private insT = rand(15, 40);
  private chat: boolean;
  private seated: boolean;
  private anchor: THREE.Vector3;
  /** Seated: how far the root was raised (lowered) to put the clip's hips on the game's seat. */
  private lift = 0;
  /** The prop lab's frozen pose (no clocks, no switching, no breathing). */
  private pinned = false;
  /** The prop lab: the clips exactly as built (no wrist spreading, no hand fixes). */
  raw = false;
  /** Life on top of the clips: breathing (period, depth, phase) and, standing, a slow weight shift. */
  private breath = { w: (2 * Math.PI) / rand(3.5, 5), a: rand(1.2, 2) * (Math.PI / 180), ph: rand(0, 7) };
  private shift: { w: number; a: number; ph: number } | null;

  constructor(private T: Template, seated: boolean, hipY: number, private backless = false) {
    this.model = cloneSkinned(T.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.B[o.name] = o as THREE.Bone;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
    });
    if (T.prop && this.B.Head) this.B.Head.add(T.prop.clone(true));
    if (T.held) this.B[T.held.bone]?.add(T.held.obj.clone(true));
    this.clock = Float64Array.from(T.list, (c) => (c.once ? 0 : Math.random() * c.dur));
    this.chat = seated && CHATS.has(T.id);
    this.seated = seated;
    this.shift = seated ? null : { w: 2 * Math.PI * rand(0.06, 0.12), a: rand(1.1, 1.6) * (Math.PI / 180), ph: rand(0, 7) };
    this.cur = this.base = this.calm = this.pick(T.idle, null);
    // hips stay where the idle clip puts them; seated people sink onto the game's seat
    this.anchor = (T.clips.get('idle') ?? T.idle[0]).hips.clone();
    // seated, the game's point is the seat (the procedural figure's hips sit straight over it, feet
    // ~0.44 m in front): put the model's hips there, not its feet, or it sits behind its log
    if (seated) { this.anchor.x = 0; this.anchor.z = 0; }
    // (a short person on a high seat sits up on it with their feet off the ground, like Pip on the log)
    if (seated) this.root.position.y = this.lift = THREE.MathUtils.clamp(hipY - this.anchor.y, -0.16, 0.32);
  }

  /** The idle loops in use (the template's, or a set swapped in by `setIdle`). */
  private idles: Clip[] | null = null;
  private get idle() {
    return this.idles ?? this.T.idle;
  }

  /** The loops to drift between right now (near you, the talk loops and, now and then, the idles). */
  private pool(near: boolean) {
    const T = this.T;
    if (near && T.near.length) return [...this.idle, ...T.near];
    // talking among themselves, one at a time: while a neighbour talks this one listens (npc.ts turns
    // its head to them). Everyone gesturing at once was most of what looked wrong round the fire
    if (this.chat && !this.coord?.talking()) return [...this.idle, ...T.near];
    return this.idle;
  }

  /** Playing a talk loop (to you, or to the people round it). */
  get talking() {
    return this.cur.name.startsWith('near');
  }

  /**
   * Swap the loops this person drifts between for these roles (Noor, asleep at her desk and then
   * awake). Ends any scripted beat; crossfades to one of them.
   */
  setIdle(roles: string[]) {
    const list = roles.map((r) => this.T.clips.get(r)).filter((c): c is Clip => !!c);
    if (!list.length) return;
    this.idles = list;
    this.scripted = null;
    this.queue(this.pick(list, null), 0);
  }

  /** A clip from `pool`, never `not`, less likely what a neighbour is playing. */
  private pick(pool: Clip[], not: Clip | null, blocked?: string) {
    const busy = this.coord?.playing() ?? [];
    const cand = pool.filter((c) => c !== not && c.src !== blocked);
    if (!cand.length) return not ?? pool[0];
    const w = cand.map((c) => (busy.some((b) => b.src === c.src) ? 0.25 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cand.length; i++) if ((r -= w[i]) <= 0) return cand[i];
    return cand[cand.length - 1];
  }

  /** Switch to `clip` after `delay` s (replaces anything already waiting). */
  private queue(clip: Clip, delay: number) {
    if (clip === this.cur && !this.pending) return;
    this.pending = { clip, at: this.time + delay };
  }

  private start(clip: Clip) {
    this.pending = null;
    if (clip === this.cur) return;
    this.prev = this.cur;
    this.cur = clip;
    if (clip.once) this.clock[clip.i] = 0;
    else {
      this.base = clip;
      if (!clip.name.startsWith('near')) this.calm = clip;
      this.spread(clip);
      // and it holds a while, whatever started it. Talking comes in spells (to you or to the circle):
      // nobody gestures through half a minute of nothing, and then it's someone else's turn
      this.varT = clip.name.startsWith('near') ? rand(5, 10) : rand(12, 30);
    }
    this.fade = 0;
    this.fadeDur = rand(0.8, 1.2);
    this.coord?.started(clip.src);
  }

  /**
   * A loop picked up while a neighbour plays the same motion (or its mirror image) runs half a
   * loop away from them, not in step: its clock is arbitrary anyway, and the jump hides in the
   * crossfade (or happens before anyone has seen it, at boot).
   */
  spread(clip = this.cur) {
    const them = (this.coord?.playing() ?? []).filter((b) => b.src === clip.src).map((b) => b.at);
    if (!them.length) return;
    const gap = (a: number) => Math.min(...them.map((b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); }));
    const now = this.clock[clip.i] / clip.dur;
    if (gap(now) > 0.2) return;
    let best = now, bestGap = -1;
    for (let k = 0; k < 10; k++) {
      const a = (now + k / 10) % 1, g2 = gap(a);
      if (g2 > bestGap) { best = a; bestGap = g2; }
    }
    this.clock[clip.i] = best * clip.dur;
  }

  /** The prop lab: hold `role` at `t` s (no clocks, no switching, no fade). */
  pin(role: string, t: number) {
    const c = this.T.clips.get(role);
    if (!c) return false;
    this.pinned = true;
    this.cur = this.base = c;
    this.prev = null;
    this.fade = 1;
    this.clock[c.i] = t;
    return true;
  }

  /**
   * A scripted beat: play `role` now (Ada getting up from her desk). It plays once; `hold` keeps its
   * last frame afterwards (no idles), otherwise it goes back to the loop it interrupted.
   */
  play(role: string, hold = false) {
    const c = this.T.clips.get(role);
    if (!c) return false;
    this.pending = null;
    this.prev = this.cur;
    this.cur = c;
    this.clock[c.i] = 0;
    this.fade = 0;
    this.fadeDur = 0.4;
    this.scripted = hold ? 'hold' : 'once';
    return true;
  }

  /** Playing a scripted beat (`play`). */
  private scripted: 'once' | 'hold' | null = null;

  /** A bone by name (the prop lab draws on them). */
  bone(name: string): THREE.Bone | undefined {
    return this.B[name];
  }

  /** The body's skinned mesh (the prop lab). */
  get body() {
    return this.skinned[0];
  }

  /** Role names this person has (the prop lab). */
  roles() {
    return [...this.T.clips.keys()];
  }

  /** The motion it's playing and how far through it (0..1): neighbours compare these. */
  get playing() {
    return { src: this.cur.src, at: this.clock[this.cur.i] / this.cur.dur };
  }

  /** Each wrist's roll about its forearm (°) as the clip had it, before it was spread (the prop lab). */
  wristRoll() {
    return this.T.wrist.map(({ side, w }) => `${side} ${Math.round(w.lastTwist * 180 / Math.PI)}°`).join(', ');
  }

  /** What's playing and where (tests): role, motion, clip time, tempo. */
  state() {
    return { clip: this.cur.name, src: this.cur.src, t: this.clock[this.cur.i], rate: this.rate, fading: this.fade < 1 };
  }

  /**
   * One frame. `near`: the player is within talking range. `look`/`nod`: head turn toward them
   * (radians, already clamped and smoothed by the crowd).
   */
  update(dt: number, near: boolean, look: number, nod: number) {
    this.time += dt;
    if (this.scripted === 'once' && this.clock[this.cur.i] >= this.cur.dur - 0.05 && this.fade >= 1) { this.scripted = null; this.queue(this.base, 0); }
    if (!this.pinned && !this.scripted) this.decide(dt, near);
    const step = this.pinned ? 0 : dt * this.rate * this.pace;
    for (const c of this.T.list) {
      const k = c.i;
      // loops run all the time (a switch picks one up wherever it is); a gesture only while it shows
      if (this.scripted && c === this.cur) this.clock[k] = Math.min(c.dur - 1e-3, this.clock[k] + step);
      else if (!c.once) this.clock[k] = (this.clock[k] + step) % c.dur;
      else if (c === this.cur || c === this.prev) this.clock[k] = Math.min(c.dur, this.clock[k] + step);
    }
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const f = this.fade * this.fade * (3 - 2 * this.fade);
    // seated and talking: the calm loop underneath, the talk loop over it at SEATED_TALK
    const talk = (c: Clip) => c.name.startsWith('near');
    const calm = this.seated && this.calm && (talk(this.cur) || (this.prev && f < 1 && talk(this.prev))) ? this.calm : null;
    // (a `*_up` talk loop moves the arms and head only, fully, over the seated loop)
    // (only the Meshy library's seated talk is held down: Mixamo's seated talks were recorded seated)
    const w = (c: Clip) => (calm && talk(c) && !c.up && c.src === 'Sitting_Answering_Questions' ? SEATED_TALK : 1);
    const m = (c: Clip) => (calm && c.up ? UPPER : undefined);
    if (calm) sample(this.B, this.T.bind, calm, this.clock[calm.i], 1, true);
    if (this.prev && f < 1) {
      sample(this.B, this.T.bind, this.prev, this.clock[this.prev.i], w(this.prev), !calm, m(this.prev));
      sample(this.B, this.T.bind, this.cur, this.clock[this.cur.i], f * w(this.cur), false, m(this.cur));
    } else {
      this.prev = null;
      sample(this.B, this.T.bind, this.cur, this.clock[this.cur.i], w(this.cur), !calm, m(this.cur));
    }
    // the wrists: the clip's forearm roll spread into the forearm (no twist bones), then any fix
    if (!this.raw) this.wrists();
    // keep the hips over the same spot whatever the clip (seated clips sit in different places);
    // standing, turn the body back by the clip's own mean turn, about the hips
    // (an arms-only clip keeps the seated loop's hips)
    const hipsOf = (c: Clip) => (c.up && this.calm ? this.calm.hips : c.hips);
    const off = _v2.copy(this.anchor).sub(hipsOf(this.cur));
    if (this.prev && f < 1) off.lerp(_v.copy(this.anchor).sub(hipsOf(this.prev)), 1 - f);
    let yaw = 0;
    if (!this.seated) {
      yaw = this.cur.yaw;
      if (this.prev && f < 1) yaw = this.prev.yaw + Math.atan2(Math.sin(this.cur.yaw - this.prev.yaw), Math.cos(this.cur.yaw - this.prev.yaw)) * f;
      // (the hips sit at anchor − off; turning by −yaw about them moves the model's origin)
      const hx = this.anchor.x - off.x, hz = this.anchor.z - off.z, c = Math.cos(-yaw), s = Math.sin(-yaw);
      off.x = this.anchor.x - (hx * c + hz * s);
      off.z = this.anchor.z - (-hx * s + hz * c);
    }
    this.model.rotation.y = -yaw;
    this.model.position.set(off.x, 0, off.z);
    this.root.updateMatrixWorld(true);
    if (this.seated && !this.raw) this.sit();
    // everything below turns bones about world axes from the body (the rig's bone axes differ)
    this.root.getWorldQuaternion(_q2);
    const lat = _v.set(-1, 0, 0).applyQuaternion(_q2); // + lifts the chin
    const B = this.B;
    // standing in an idle loop: arms rest closer in, palms toward the legs (the library's idles hold
    // them out, palms forward)
    if (!this.seated && !this.raw) {
      const isIdle = (c: Clip | null) => (c && this.idle.includes(c) ? 1 : 0);
      const w = this.prev && f < 1 ? isIdle(this.cur) * f + isIdle(this.prev) * (1 - f) : isIdle(this.cur);
      if (w > 0.01) this.relaxArms(w, _q2);
    }
    if (!this.pinned) {
      // breathing: the chest rises and falls; the neck takes it back so the head stays level
      const br = Math.sin(this.time * this.breath.w + this.breath.ph) * this.breath.a;
      if (B.Spine02) this.turn(B.Spine02, lat, br * 0.5);
      if (B.Spine01) this.turn(B.Spine01, lat, br * 0.5);
      if (B.neck) this.turn(B.neck, lat, -br * 0.5);
      // standing: the weight drifts from foot to foot (the pelvis tips, the legs and chest stay)
      const sh = this.shift;
      if (sh && B.Hips) {
        const fwd = _v2.set(0, 0, 1).applyQuaternion(_q2);
        const r = Math.sin(this.time * sh.w + sh.ph) * sh.a;
        this.turn(B.Hips, fwd, r);
        if (B.LeftUpLeg) this.turn(B.LeftUpLeg, fwd, -r);
        if (B.RightUpLeg) this.turn(B.RightUpLeg, fwd, -r);
        if (B.Spine02) this.turn(B.Spine02, fwd, -r * 0.8);
      }
    }
    // the head turns toward the player; a bigger turn takes more neck, and then the chest
    const H = B.Head, N = B.neck;
    if (H || N) {
      const big = THREE.MathUtils.smoothstep(Math.abs(look), 0.35, 1.0);
      const chest = B.Spine ? 0.14 * THREE.MathUtils.smoothstep(Math.abs(look), 0.55, 1.05) : 0;
      const neck = N ? 0.3 + 0.2 * big : 0;
      if (chest) this.turn(B.Spine, UP, look * chest);
      if (N) { this.turn(N, UP, look * neck); this.turn(N, lat, -nod * 0.4); }
      if (H) { this.turn(H, UP, look * (1 - neck - chest)); this.turn(H, lat, -nod * (N ? 0.6 : 1)); }
    }
    // a sphere round the hips holds the pose (seated or standing), so both passes can cull it
    const hips = this.B.Hips;
    if (hips) {
      _c.setFromMatrixPosition(hips.matrixWorld);
      for (const sk of this.skinned) boundSkinned(sk, _c, 1.3);
    }
  }

  /**
   * Seated: the hips stay on the seat (a stretch or talk clip lifts them off it by up to 10 cm), and
   * the feet go back on the ground. The clips were made on a ~45 cm chair; on the camp's 62 cm logs
   * the feet hung 15-25 cm in the air. Each planted boot is levelled and its sole (measured at bind:
   * `soleOf`) put on the ground; a foot up on the other knee moves with that knee. Too high a seat for
   * the legs (Pip on the log), and the feet stretch forward a little, then hang.
   */
  private sit() {
    const B = this.B, hips = B.Hips;
    if (!hips) return;
    const root = this.root.getWorldPosition(_sr);
    hips.getWorldPosition(_sh);
    this.model.position.y += root.y + this.anchor.y - _sh.y;
    this.model.updateMatrixWorld(true);
    const fwd = _sf.set(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(_sq));
    fwd.y = 0;
    fwd.normalize();
    // no back to lean on: the trunk sits up (tipped forward about the hips; the thighs stay where they were)
    const top = B.neck ?? B.Spine;
    if (this.backless && top && B.LeftUpLeg && B.RightUpLeg) {
      hips.getWorldPosition(_sh);
      const trunk = top.getWorldPosition(_sN).sub(_sh);
      const back = Math.atan2(-trunk.dot(fwd), trunk.y);
      if (back > BACKLESS_LEAN) {
        B.LeftUpLeg.getWorldQuaternion(_sL[0]);
        B.RightUpLeg.getWorldQuaternion(_sL[1]);
        _sX.set(0, 1, 0).cross(fwd).normalize(); // turning about up × forward tips the top forward
        hips.getWorldQuaternion(_sQ).premultiply(_jp.setFromAxisAngle(_sX, back - BACKLESS_LEAN));
        setWorldQuat(hips, _sQ);
        setWorldQuat(B.LeftUpLeg, _sL[0]);
        setWorldQuat(B.RightUpLeg, _sL[1]);
      }
    }
    const drop = this.lift + this.model.position.y; // the clip's floor over the ground
    const floor = root.y + this.model.position.y, ground = root.y - this.lift;
    const up = [false, false];
    for (let i = 0; i < 2; i++) {
      const foot = B[LEGS[i][2]];
      if (!foot || !B[LEGS[i][0]] || !B[LEGS[i][1]]) return;
      foot.getWorldPosition(_sT[i]);
      up[i] = _sT[i].y - floor > FOOT_UP;
      if (up[i]) continue;
      // the boot flat and its sole on the ground (not the ankle at the clip's height: the toes dug in)
      const low = this.plant(i);
      if (low === null) _sT[i].y -= drop;
      else _sT[i].y = ground - low + 0.003;
    }
    // from a high seat the feet slide forward to reach the ground (the same for both)
    const reach = (i: number, s: number) => {
      const U = B[LEGS[i][0]], K = B[LEGS[i][1]], F = B[LEGS[i][2]];
      const len = U.getWorldPosition(_sA).distanceTo(K.getWorldPosition(_lk)) + _lk.distanceTo(F.getWorldPosition(_lc));
      return _sA.distanceTo(_lt.copy(_sT[i]).addScaledVector(fwd, s)) <= len * SEAT_REACH;
    };
    let slide = 0;
    for (const s of [0, 0.05, 0.1, SEAT_SLIDE]) {
      slide = s;
      if ((up[0] || reach(0, s)) && (up[1] || reach(1, s))) break;
    }
    for (let i = 0; i < 2; i++) {
      _sK[i].set(0, 0, 0);
      if (up[i]) continue;
      _sT[i].addScaledVector(fwd, slide);
      legTo(B[LEGS[i][0]], B[LEGS[i][1]], B[LEGS[i][2]], _sT[i], fwd, _sK[i]);
    }
    // a foot up on the other knee rides with that knee
    for (let i = 0; i < 2; i++) {
      if (!up[i] || up[1 - i]) continue;
      _sT[i].add(_sK[1 - i]);
      legTo(B[LEGS[i][0]], B[LEGS[i][1]], B[LEGS[i][2]], _sT[i], fwd, _sK[i]);
    }
  }

  /**
   * A planted boot: level it (heel and toe at one height, turning it up to FLAT_MAX about the ankle) and
   * return how far its sole's lowest point is below the ankle (m, negative), or null with no sole measured.
   */
  private plant(i: number): number | null {
    const S = this.T.sole[i ? 'Right' : 'Left'], foot = this.B[LEGS[i][2]], tipB = S && this.B[S.tipBone];
    if (!S || !foot || !tipB) return null;
    const heel = _pH.copy(S.heel).applyMatrix4(foot.matrixWorld), tip = _pT.copy(S.tip).applyMatrix4(tipB.matrixWorld);
    const dir = _pD.subVectors(tip, heel), h = Math.hypot(dir.x, dir.z);
    if (h > 0.03) {
      const turn = THREE.MathUtils.clamp(-Math.atan2(dir.y, h), -FLAT_MAX, FLAT_MAX);
      if (Math.abs(turn) > 0.005) {
        _pA.set(dir.x, 0, dir.z).normalize().cross(UP).normalize(); // turning about (toe-ward × up) lifts the toe
        foot.getWorldQuaternion(_pQ).premultiply(_pR.setFromAxisAngle(_pA, turn));
        setWorldQuat(foot, _pQ);
        heel.copy(S.heel).applyMatrix4(foot.matrixWorld);
        tip.copy(S.tip).applyMatrix4(tipB.matrixWorld);
      }
    }
    return Math.min(heel.y, tip.y) - foot.getWorldPosition(_pK).y;
  }

  /** What to play next: talk when you're close, drift between idles (and gestures) otherwise. */
  private decide(dt: number, near: boolean) {
    const T = this.T;
    if (near !== this.wasNear) {
      this.wasNear = near;
      // a beat before reacting (and everyone's beat differs)
      if (near && T.near.length) this.queue(this.pick(T.near, null), rand(0.2, 1.2));
      else if (!near && this.cur.name.startsWith('near') && !this.chat) this.queue(this.pick(this.idle, null), rand(0.2, 1.2));
    }
    const pool = this.pool(near);
    if (!this.cur.once && !this.pending && this.fade >= 1) {
      if ((this.varT -= dt) <= 0) {
        this.varT = rand(12, 30);
        if (pool.length > 1) this.queue(this.pick(pool, this.cur), 0);
      }
      if (!near && T.ins.length && (this.insT -= dt) <= 0) {
        this.insT = rand(25, 50);
        this.queue(T.ins[Math.floor(Math.random() * T.ins.length)], rand(0, 0.5));
      }
    }
    // a gesture plays once, then back to the loop it interrupted
    if (this.cur.once && !this.pending && this.clock[this.cur.i] > this.cur.dur - 1) this.queue(this.base, 0);
    const p = this.pending;
    if (p && this.time >= p.at && this.fade >= 1) {
      if (!this.coord || this.coord.may(p.clip.src)) this.start(p.clip);
      else {
        // a neighbour just started that motion: something else from the pool, or wait a little
        const alt = p.clip.once ? null : this.pick(pool, this.cur, p.clip.src);
        if (alt && alt !== this.cur && alt.src !== p.clip.src) p.clip = alt;
        else p.at = this.time + rand(0.4, 1.5);
      }
    }
  }

  /**
   * Arms at rest, by `w`: an upper arm held out from the side comes in to ~11°, and each forearm and
   * hand roll so the palm faces the leg (a little back), the roll shared between them like the
   * wrist spreading. `body`: the actor's world rotation.
   */
  private relaxArms(w: number, body: THREE.Quaternion) {
    const up = _ra.set(0, 1, 0).applyQuaternion(body), fwd = _rb.set(0, 0, 1).applyQuaternion(body);
    for (const sd of ['Left', 'Right'] as const) {
      const arm = this.B[sd + 'Arm'], fore = this.B[sd + 'ForeArm'], hand = this.B[sd + 'Hand'], palm = this.T.palm[sd];
      if (!arm || !fore || !hand || !palm) continue;
      // the person's left is the model's +X
      const out = _rc.set(sd === 'Left' ? 1 : -1, 0, 0).applyQuaternion(body);
      const S = _rp.setFromMatrixPosition(arm.matrixWorld), E = _re.setFromMatrixPosition(fore.matrixWorld);
      const u = _ru.subVectors(E, S).normalize();
      // only an arm that hangs (a gesture keeps its shape)
      const hang = THREE.MathUtils.smoothstep(-u.dot(up), 0.55, 0.85);
      if (hang <= 0) continue;
      const abd = Math.atan2(u.dot(out), -u.dot(up));
      if (abd > 0.2) {
        const axis = _rn.crossVectors(out, up).negate().normalize(); // turning about it takes `out` toward down
        this.turn(arm, axis, (abd - 0.2) * 0.7 * w * hang);
      }
      // the palm: roll about the forearm until it faces in toward the leg
      E.setFromMatrixPosition(fore.matrixWorld);
      const a = _ru.setFromMatrixPosition(hand.matrixWorld).sub(E).normalize();
      const low = hang * THREE.MathUtils.smoothstep(-a.dot(up), 0.4, 0.8);
      if (low <= 0) continue;
      hand.getWorldQuaternion(_rq);
      const p = _rp.copy(palm).applyQuaternion(_rq);
      const d = _rn.copy(out).negate().addScaledVector(fwd, -0.35);
      p.addScaledVector(a, -p.dot(a));
      d.addScaledVector(a, -d.dot(a));
      if (p.lengthSq() < 1e-6 || d.lengthSq() < 1e-6) continue;
      p.normalize(); d.normalize();
      const roll = THREE.MathUtils.clamp(Math.atan2(_rc.crossVectors(p, d).dot(a), p.dot(d)), -2.4, 2.4) * w * low;
      this.turn(fore, a, roll * 0.55);
      this.turn(hand, a, roll * 0.45);
    }
  }

  /** Spread each wrist's roll into its forearm, then apply this role's hand fix. */
  private wrists() {
    const fix = HAND_FIX[this.T.id]?.[this.cur.name];
    for (const { side, w } of this.T.wrist) {
      const fa = this.B[side + 'ForeArm'], h = this.B[side + 'Hand'];
      if (!fa || !h) continue;
      w.apply(fa.quaternion, h.quaternion, TWIST.k, TWIST.twist, TWIST.swing);
      const f = fix?.[side === 'Left' ? 'L' : 'R'];
      if (f) h.quaternion.multiply(_q.setFromAxisAngle(_v.set(f[0], f[1], f[2]).normalize(), f[3] * (Math.PI / 180)));
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
