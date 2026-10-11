import * as THREE from 'three/webgpu';
import { measureSole, soleWorld, type Leg } from '../world/legIK';

/**
 * The contractors' legs from real motion capture. The procedural skeleton (Humans.ts) still
 * decides where a contractor is, which way it faces and aims, and holds the gun; but walking legs
 * built from a sine are stiff (no heel strike, no toe-off, no hip roll) and their feet skate. So
 * while one moves, the model's hips and legs play the Meshy library's walk, run and crouch walk
 * (one shared clock, every clip aligned on its left heel strike, blended by speed and crouch), at
 * the rate that keeps a planted foot still on the ground; then the feet are put on the terrain and
 * held where they landed (world/legIK.ts).
 *
 * Measured at load from the clips on the model at bind: each foot's swing height over the cycle,
 * when it lands, how far the body travels per cycle (the stride), and the hips' path.
 */

export const GAIT_CLIPS = ['walk', 'run', 'crouchwalk'] as const;
export type GaitClipName = typeof GAIT_CLIPS[number];

const N = 48;
const SIDES = ['Left', 'Right'] as const;
const LEG_BONES = ['UpLeg', 'Leg', 'Foot', 'ToeBase'];
const frac = (x: number) => x - Math.floor(x);
type Interp = THREE.Interpolant;

export interface GaitClip {
  dur: number;
  /** Clip time (fraction) of the left heel strike: phase 0. */
  t0: number;
  /** Leg bones' and the Hips' rotation tracks, and the Hips' position. */
  rot: Map<string, Interp>;
  hipsPos?: Interp;
  /** Each leg bone's mean rotation over the cycle (shorter steps scale about it). */
  mean: Map<string, THREE.Quaternion>;
  /** Per foot (L, R): sole height above the floor over the cycle (N samples from phase 0). */
  swing: [Float32Array, Float32Array];
  /** Hips over the floor (model space, metres at scale 1), N samples from phase 0: x, y, z. */
  hips: Float32Array;
  /** Metres the body travels per cycle at the clip's own pace, and that pace (m/s). */
  stride: number;
  speed: number;
}

const _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class ContractorGait {
  readonly clips: Record<GaitClipName, GaitClip>;
  /** Heel (Foot space) and toe (ToeBase space) sole points, per side. */
  readonly sole: Record<'Left' | 'Right', { heel: THREE.Vector3; toe: THREE.Vector3 }>;

  private constructor(clips: Record<GaitClipName, GaitClip>, sole: ContractorGait['sole']) {
    this.clips = clips;
    this.sole = sole;
  }

  /** Measure the clips on the source model (at the origin, at bind). Null if any clip is missing. */
  static measure(src: THREE.Object3D, bones: Record<string, THREE.Bone>, body: THREE.SkinnedMesh, anims: THREE.AnimationClip[]) {
    const byName = new Map(anims.map((a) => [a.name, a]));
    if (!GAIT_CLIPS.every((n) => byName.has(n)) || !bones.Hips) return null;
    src.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1);
    const sole = {} as ContractorGait['sole'];
    for (const sd of SIDES) {
      const foot = bones[sd + 'Foot'], toe = bones[sd + 'ToeBase'];
      if (!foot || !toe) return null;
      const [heel] = measureSole(body, foot, fwd);
      // the toe point rides the toe bone (a toe-off bends there instead of lifting the foot)
      const [, toeTip] = measureSole(body, toe, fwd);
      sole[sd] = { heel, toe: toeTip };
    }
    const legs = SIDES.map((sd): Leg => ({ upper: bones[sd + 'UpLeg'], lower: bones[sd + 'Leg'], end: bones[sd + 'Foot'], sole: [sole[sd].heel, sole[sd].toe], soleOn: [undefined, bones[sd + 'ToeBase']] }));
    const bind = new Map(Object.values(bones).map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
    const interp = (t?: THREE.KeyframeTrack) => (t ? (t as unknown as { createInterpolant(): Interp }).createInterpolant() : undefined);
    const names = ['Hips', ...SIDES.flatMap((sd) => LEG_BONES.map((b) => sd + b))];
    const clips = {} as Record<GaitClipName, GaitClip>;
    for (const n of GAIT_CLIPS) {
      const a = byName.get(n)!;
      const rot = new Map<string, Interp>();
      for (const b of names) { const it = interp(a.tracks.find((t) => t.name === `${b}.quaternion`)); if (it) rot.set(b, it); }
      const hipsPos = interp(a.tracks.find((t) => t.name === 'Hips.position'));
      const dur = a.duration || 1;
      // sample the cycle: soles and hips in model space
      const ys = [new Float32Array(N), new Float32Array(N)], zs = [new Float32Array(N), new Float32Array(N)], hp = new Float32Array(N * 3);
      for (let k = 0; k < N; k++) {
        const t = (k / N) * dur;
        for (const [b, v] of bind) { b.quaternion.copy(v.q); b.position.copy(v.p); }
        for (const [b, it] of rot) bones[b].quaternion.fromArray(it.evaluate(t) as unknown as number[]);
        if (hipsPos) bones.Hips.position.fromArray(hipsPos.evaluate(t) as unknown as number[]);
        src.updateMatrixWorld(true);
        legs.forEach((l, i) => { soleWorld(l, _s); ys[i][k] = _s.y; zs[i][k] = _s.z; });
        bones.Hips.getWorldPosition(_s);
        hp.set([_s.x, _s.y, _s.z], k * 3);
      }
      const floor = Math.min(...ys[0], ...ys[1]);
      // the left foot's stance: the longest run within 1.5 cm of its lowest; phase 0 at its start
      const low = Math.min(...ys[0]);
      let best = 0, start = 0;
      for (let k = 0; k < N; k++) {
        const down = (j: number) => ys[0][(j + N) % N] < low + 0.015;
        if (!down(k) || down(k - 1)) continue;
        let m = 0;
        while (m < N && down(k + m)) m++;
        if (m > best) { best = m; start = k; }
      }
      const end = (start + best - 1) % N;
      const sweep = Math.abs(zs[0][start] - zs[0][end]);
      // a planted foot moves back at the body's speed: sweep over the stance's duration
      const speed = best > 1 ? sweep / (((best - 1) / N) * dur) : 1;
      const rotate = (arr: Float32Array, w = 1) => { const o = new Float32Array(arr.length); for (let k = 0; k < arr.length / w; k++) for (let c = 0; c < w; c++) o[k * w + c] = arr[((k + start) % N) * w + c]; return o; };
      const hips = rotate(hp, 3);
      for (let k = 0; k < N; k++) hips[k * 3 + 1] -= floor;
      const mean = new Map<string, THREE.Quaternion>();
      for (const [b, it] of rot) {
        const m = new THREE.Quaternion(0, 0, 0, 0);
        for (let k = 0; k < 16; k++) {
          _q.fromArray(it.evaluate((k / 16) * dur) as unknown as number[]);
          if (k && m.x * _q.x + m.y * _q.y + m.z * _q.z + m.w * _q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
          m.set(m.x + _q.x, m.y + _q.y, m.z + _q.z, m.w + _q.w);
        }
        mean.set(b, m.normalize());
      }
      clips[n] = {
        dur, t0: start / N, rot, hipsPos, mean,
        swing: [rotate(ys[0].map((y) => y - floor)), rotate(ys[1].map((y) => y - floor))],
        hips, speed, stride: speed * dur,
      };
    }
    for (const [b, v] of bind) { b.quaternion.copy(v.q); b.position.copy(v.p); }
    src.updateMatrixWorld(true);
    return new ContractorGait(clips, sole);
  }

  /** A clip's track for `bone` at phase `ph` (0..1 from the left heel strike), stride-scaled by `k` about its mean. */
  rotAt(c: GaitClip, bone: string, ph: number, k: number, out: THREE.Quaternion) {
    const it = c.rot.get(bone);
    if (!it) return null;
    out.fromArray(it.evaluate(frac(ph + c.t0) * c.dur) as unknown as number[]);
    if (k !== 1 && bone !== 'Hips') {
      const m = c.mean.get(bone);
      if (m) out.copy(_q.copy(m).slerp(out, k));
    }
    return out;
  }

  /** A table sampled at phase `ph` (N per cycle, `w` values each), into `out`. */
  static at(arr: Float32Array, ph: number, w: number, c: number) {
    const x = frac(ph) * N, k = Math.floor(x) % N, f = x - Math.floor(x);
    return THREE.MathUtils.lerp(arr[k * w + c], arr[((k + 1) % N) * w + c], f);
  }
}
