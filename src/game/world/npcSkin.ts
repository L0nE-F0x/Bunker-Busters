import * as THREE from 'three/webgpu';
import { loadGLB } from '@/engine/models';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { boundSkinned } from './kit';

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

/** Characters that have a model: Dry Creek's six and the camp's four. */
export const NPC_MODELS = ['nia', 'doc', 'inez', 'sol', 'ren', 'wick', 'mara', 'hollis', 'pip', 'dez'] as const;
/** Head props, in Head-bone space (1 unit = 1 cm there; fits from Assets/MESHY_ASSETS.md §5). */
export const NPC_PROPS: Record<string, { file: string; pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  hollis: { file: 'truckercap', pos: [-1.7, 20.3, 2.6], rot: [-7.5, 3.2, 3.6], scale: 16 },
  dez: { file: 'headset', pos: [-1.0, 10.3, -14.2], rot: [-20.9, 2.3, 3.3], scale: 13.5 },
};
/** Seated people who chat among themselves now and then: their `near` clips join the idle pool. */
const CHATS = new Set(['sol', 'mara', 'hollis', 'dez']);

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
  prop?: THREE.Object3D;
}

/** The crowd's say in what an actor starts next (npc.ts): neighbours don't start one motion together. */
export interface ClipCoord {
  /** What the neighbours are playing now: the motion and how far through it (0..1). */
  playing(): { src: string; at: number }[];
  /** May it start `src` now? (No neighbour switched to it in the last few seconds.) */
  may(src: string): boolean;
  started(src: string): void;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class NpcModels {
  private t = new Map<string, Template>();

  /** `ids`: only these (the prop lab); default every townsperson. */
  static async load(ids: readonly string[] = NPC_MODELS): Promise<NpcModels | null> {
    if (new URLSearchParams(location.search).has('procnpc')) return null;
    const out = new NpcModels();
    await Promise.all(ids.map(async (id) => {
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

function template(id: string, scene: THREE.Object3D, anims: THREE.AnimationClip[]): Template {
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
      once: /^(ins|alt)/.test(a.name), tracks, hips: new THREE.Vector3(),
    };
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
  return { id, scene, clips, list, idle, near, ins: list.filter((c) => c.once), bind };
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
  /** Set by the crowd: lets neighbours keep out of each other's step. */
  coord: ClipCoord | null = null;
  private model: THREE.Object3D;
  private B: Record<string, THREE.Bone> = {};
  private skinned: THREE.SkinnedMesh[] = [];
  /** This person's tempo. */
  private rate = rand(0.9, 1.1);
  /** One running clock per clip (s), from a random start. */
  private clock: Float64Array;
  private cur: Clip;
  private prev: Clip | null = null;
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
  private anchor: THREE.Vector3;
  /** The prop lab's frozen pose (no clocks, no switching). */
  private pinned = false;

  constructor(private T: Template, seated: boolean, hipY: number) {
    this.model = cloneSkinned(T.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.B[o.name] = o as THREE.Bone;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
    });
    if (T.prop && this.B.Head) this.B.Head.add(T.prop.clone(true));
    this.clock = Float64Array.from(T.list, (c) => (c.once ? 0 : Math.random() * c.dur));
    this.chat = seated && CHATS.has(T.id);
    this.cur = this.base = this.pick(T.idle, null);
    // hips stay where the idle clip puts them; seated people sink onto the game's seat
    this.anchor = (T.clips.get('idle') ?? T.idle[0]).hips.clone();
    // seated, the game's point is the seat (the procedural figure's hips sit straight over it, feet
    // ~0.44 m in front): put the model's hips there, not its feet, or it sits behind its log
    if (seated) { this.anchor.x = 0; this.anchor.z = 0; }
    // (a short person on a high seat sits up on it with their feet off the ground, like Pip on the log)
    if (seated) this.root.position.y = THREE.MathUtils.clamp(hipY - this.anchor.y, -0.16, 0.32);
  }

  /** The loops to drift between right now (near you, the talk loops and, now and then, the idles). */
  private pool(near: boolean) {
    const T = this.T;
    return (near && T.near.length) || this.chat ? [...T.idle, ...T.near] : T.idle;
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
      this.spread(clip);
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

  /** Role names this person has (the prop lab). */
  roles() {
    return [...this.T.clips.keys()];
  }

  /** The motion it's playing and how far through it (0..1): neighbours compare these. */
  get playing() {
    return { src: this.cur.src, at: this.clock[this.cur.i] / this.cur.dur };
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
    if (!this.pinned) this.decide(dt, near);
    const step = this.pinned ? 0 : dt * this.rate;
    for (const c of this.T.list) {
      const k = c.i;
      // loops run all the time (a switch picks one up wherever it is); a gesture only while it shows
      if (!c.once) this.clock[k] = (this.clock[k] + step) % c.dur;
      else if (c === this.cur || c === this.prev) this.clock[k] = Math.min(c.dur, this.clock[k] + step);
    }
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const f = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.prev && f < 1) {
      sample(this.B, this.T.bind, this.prev, this.clock[this.prev.i], 1, true);
      sample(this.B, this.T.bind, this.cur, this.clock[this.cur.i], f, false);
    } else {
      this.prev = null;
      sample(this.B, this.T.bind, this.cur, this.clock[this.cur.i], 1, true);
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

  /** What to play next: talk when you're close, drift between idles (and gestures) otherwise. */
  private decide(dt: number, near: boolean) {
    const T = this.T;
    if (near !== this.wasNear) {
      this.wasNear = near;
      // a beat before reacting (and everyone's beat differs)
      if (near && T.near.length) this.queue(this.pick(T.near, null), rand(0.2, 1.2));
      else if (!near && this.cur.name.startsWith('near') && !this.chat) this.queue(this.pick(T.idle, null), rand(0.2, 1.2));
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
