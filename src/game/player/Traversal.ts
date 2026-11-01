import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { ladders, ladderAt, ladderYaw, noMantle, type Ladder } from '../world/ladders';

/**
 * Climbing: ladders and mantling. The player's own movement (Player.ts) hands over to this while
 * you're on a ladder or pulling yourself up onto something; everything here moves the body along a
 * path, without the character controller (the path is checked for room before it starts).
 *
 * - Ladders (world/ladders.ts): walk into one facing it, or press Use. Forward climbs (back, or
 *   forward while looking well down, goes down; sprint is quicker; crouch on the way down slides),
 *   jump lets go, the top steps you off onto the landing, walking off a landing at the ladder's top
 *   climbs down onto it. The bottom steps you off.
 * - Mantling: jump into an edge whose top is 0.42–1.7 m above the ground you jumped from (and that
 *   you can stand on: 0.45 m deep, room for the body, crouched if that's all there is), or hold jump
 *   while you're in the air against one. Thin tops (fences, walls) don't count.
 *
 * The hands are placed in world space (`holds`, smoothed here) and Game turns them into view-space
 * poses each frame. Nothing here allocates per frame.
 */

const RADIUS = 0.33;
const STAND_HALF = 0.5;
const CROUCH_HALF = 0.2;
/** Capsule axis from the rung line while climbing. */
export const STANDOFF = 0.55;
const EYE = 1.62;
const UP_SPEED = 1.55;
const DOWN_SPEED = 1.9;
const SLIDE_SPEED = 4.4;
/** Mantle reach: the top of what you climb onto, above the ground you jumped from. */
export const MANTLE_MAX = 1.7;
const MANTLE_MIN = 0.42;

export type TravKind = 'mount' | 'ladder' | 'topIn' | 'topOut' | 'mantle';

/** One hand's hold, in world space: grip point, finger direction, back-of-hand direction. */
export interface Hold {
  on: boolean;
  p: THREE.Vector3;
  fingers: THREE.Vector3;
  back: THREE.Vector3;
  curl: number;
  thumb: number;
  oppose: number;
  spread: number;
  // smoothing (world space: a grip on a rung doesn't move, so there's no lag while it holds)
  vel: THREE.Vector3;
  tp: THREE.Vector3;
  tf: THREE.Vector3;
  tb: THREE.Vector3;
  fresh: boolean;
  /** Mid-reach for a rung (its knock sounds when it lands). */
  knock: boolean;
}

const mkHold = (): Hold => ({
  on: false, p: new THREE.Vector3(), fingers: new THREE.Vector3(0, 1, 0), back: new THREE.Vector3(0, 0, 1),
  curl: 0.85, thumb: 0.7, oppose: 0.6, spread: 0,
  vel: new THREE.Vector3(), tp: new THREE.Vector3(), tf: new THREE.Vector3(0, 1, 0), tb: new THREE.Vector3(0, 0, 1), fresh: true, knock: false,
});

/** What Traversal needs from the Player (kept narrow so the two don't reach into each other). */
export interface TravBody {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  crouching: boolean;
  grounded: boolean;
  collider: { handle: number };
  /** Put the feet at `p` (no collision: the path was checked). */
  placeFeet(p: THREE.Vector3): void;
  /** Stand or crouch without the headroom test (a mantle that only fits crouched). */
  crouchNow(c: boolean): void;
}

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);
const angleTo = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Traversal {
  kind: TravKind | null = null;
  ladder: Ladder | null = null;
  /** Feet height above the ladder's base while on it. */
  h = 0;
  /** Climb speed along the ladder (m/s, + up). */
  v = 0;
  /** Right, left. */
  readonly holds: [Hold, Hold] = [mkHold(), mkHold()];
  /** Set while a move turns the view (onto a ladder from its top): Game writes it to the camera. */
  turnYaw: number | null = null;
  /** Camera offsets for this frame (m, rad): the pull of a mantle, the rhythm of a climb. */
  readonly camOff = { y: 0, pitch: 0, roll: 0 };
  /** Last ground the feet stood on (mantle reach is measured from here). */
  lastGroundY = 0;
  /** No grabbing (a ladder you just left, a mantle that just ended). */
  private cooldown = 0;
  /** Forward is still held from leaving a ladder at its foot: don't grab it again until it's let go. */
  private holdOff = false;
  // the scripted move
  private t = 0;
  private dur = 0;
  private from = V();
  private to = V();
  private yaw0 = 0;
  private yaw1 = 0;
  private crouchEnd = false;
  private planted = false;
  private climbT = 0;
  private lastRung = 0;
  private foot = 0;
  // the mantle's edge (world): where the hands go, and which way is "in"
  private edge = V();
  private handY = [0, 0];
  private handLat = [0.21, 0.21];
  private handIn = 0.05;
  private inDir = V();
  private side = V();
  // scratch
  private _a = V();
  private _b = V();
  private _c = V();
  private ray: InstanceType<Physics['R']['Ray']>;
  private capStand: InstanceType<Physics['R']['Capsule']>;
  private capCrouch: InstanceType<Physics['R']['Capsule']>;
  /** A slimmer crouched capsule, swept along a mantle's path (grazing the ledge it climbs isn't a hit). */
  private capSweep: InstanceType<Physics['R']['Capsule']>;
  private heightfield: number;
  private rot = { x: 0, y: 0, z: 0, w: 1 };
  private flags: number;

  /** Events for Game: a rung under a foot or a hand (clank), a mantle's phases, the ladder in/out (stow/draw the gun). */
  onRung: ((foot: boolean, k: number) => void) | null = null;
  onMantle: ((phase: 'start' | 'plant' | 'end', at: THREE.Vector3, k: number) => void) | null = null;
  onLadder: ((on: boolean) => void) | null = null;

  constructor(private physics: Physics, private body: TravBody) {
    const R = physics.R;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.capStand = new R.Capsule(STAND_HALF, RADIUS);
    this.capCrouch = new R.Capsule(CROUCH_HALF, RADIUS);
    this.capSweep = new R.Capsule(CROUCH_HALF, RADIUS - 0.04);
    this.heightfield = R.ShapeType.HeightField;
    this.flags = R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_SENSORS;
  }

  get active() {
    return this.kind !== null;
  }
  /** Both hands on a ladder (the gun is put away). */
  get onRungs() {
    return this.kind === 'mount' || this.kind === 'ladder' || this.kind === 'topIn' || this.kind === 'topOut';
  }
  /** 0..1 through the current scripted move. */
  get progress() {
    return this.dur > 0 ? Math.min(1, this.t / this.dur) : 0;
  }

  /** Out of whatever you were doing (a teleport, death, Quit): no events. */
  cancel() {
    const was = this.onRungs;
    this.kind = null;
    this.ladder = null;
    this.turnYaw = null;
    this.v = 0;
    this.camOff.y = this.camOff.pitch = this.camOff.roll = 0;
    this.holds[0].on = this.holds[1].on = false;
    this.cooldown = 0.3;
    if (was) this.onLadder?.(false);
  }

  /** Where the body is safe to be saved (a ladder's foot or its landing, a mantle's end). */
  safeFeet(out: THREE.Vector3) {
    const l = this.ladder;
    if (this.kind === 'mantle' || this.kind === 'topOut') return out.copy(this.to);
    if (l) {
      const span = l.top.y - l.base.y;
      if (l.exit && this.h > span * 0.5) return out.copy(l.exit);
      return ladderAt(l, 0, out).addScaledVector(l.out, STANDOFF + 0.1);
    }
    return out.copy(this.body.position);
  }

  // ------------------------------------------------------------------ queries

  private cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    return this.physics.world.castRayAndGetNormal(r, max, true, this.flags, undefined, this.body.collider as never);
  }

  /** Is a capsule with its feet at (x, y, z) clear of everything? */
  private clear(x: number, y: number, z: number, crouch: boolean) {
    const half = crouch ? CROUCH_HALF : STAND_HALF;
    const hit = this.physics.world.intersectionWithShape({ x, y: y + RADIUS + half + 0.04, z }, this.rot, crouch ? this.capCrouch : this.capStand, this.flags, undefined, this.body.collider as never);
    return !hit;
  }

  /** Does the body (slim, crouched) get from feet (x, y, z) along (dx, dy, dz) for `len` m without touching anything? */
  private sweep(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number) {
    if (len < 1e-3) return true;
    const hit = this.physics.world.castShape({ x, y: y + RADIUS + CROUCH_HALF, z }, this.rot, { x: dx, y: dy, z: dz }, this.capSweep, 0, len, false, this.flags, undefined, this.body.collider as never);
    return !hit;
  }

  /**
   * Look for an edge to pull up onto, facing `yaw`. `air`: already off the ground (holding jump into
   * it). Starts the mantle and returns true if there is one.
   */
  tryMantle(yaw: number, air: boolean): boolean {
    if (this.kind || this.cooldown > 0) return false;
    const p = this.body.position;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // 1. a face in front: the nearest of a few rays from the body's axis (knees to chest)
    let best = Infinity, nx = 0, nz = 0, hx = 0, hz = 0;
    for (const hh of air ? [0.06, 0.35, 0.8, 1.25] : [0.3, 0.75, 1.2]) {
      const hit = this.cast(p.x, p.y + hh, p.z, fx, 0, fz, RADIUS + 0.6);
      if (!hit || hit.timeOfImpact >= best) continue;
      // (the ground itself isn't something you climb onto: slopes and banks are walked)
      if (hit.collider.shapeType() === this.heightfield) continue;
      const n = hit.normal;
      if (Math.abs(n.y) > 0.7) continue;
      const h = Math.hypot(n.x, n.z);
      if (h < 1e-3 || (n.x * fx + n.z * fz) / h > -0.5) continue; // a face that faces you (within 60°)
      best = hit.timeOfImpact;
      nx = n.x / h; nz = n.z / h;
      hx = p.x + fx * best; hz = p.z + fz * best;
    }
    if (best === Infinity) return false;
    // into the obstacle, square to its face
    const ix = -nx, iz = -nz;
    // 2. the top: straight down onto it, just past the edge
    const ground = air ? Math.min(this.lastGroundY, p.y + 0.6) : p.y;
    const maxTop = Math.min(ground + MANTLE_MAX, p.y + MANTLE_MAX);
    const minTop = air ? p.y - 0.05 : p.y + MANTLE_MIN;
    if (maxTop < minTop) return false;
    const oy = maxTop + 0.3;
    const ex = hx + ix * 0.16, ez = hz + iz * 0.16;
    const top = this.cast(ex, oy, ez, 0, -1, 0, oy - minTop + 0.02);
    // (no top within reach, or the start is inside it: taller than you can reach)
    if (!top || top.timeOfImpact < 1e-3 || top.normal.y < 0.75) return false;
    const topY = oy - top.timeOfImpact;
    if (topY > maxTop || topY < minTop) return false;
    // the edge is solid under its top: the top of what you ran into, not a floor beyond a thin wall,
    // a rail or a pane of glass that goes on up out of reach
    const under = this.cast(ex, topY - 0.05, ez, 0, -1, 0, 0.05);
    if (!under || under.timeOfImpact > 1e-3) return false;
    // 3. somewhere to stand: the body's width in from the edge, about as high (a fence or a wall top isn't)
    const sx = hx + ix * (RADIUS + 0.16), sz = hz + iz * (RADIUS + 0.16);
    const stand = this.cast(sx, topY + 0.5, sz, 0, -1, 0, 0.8);
    if (!stand || stand.timeOfImpact < 1e-3 || stand.normal.y < 0.7) return false;
    const sy = topY + 0.5 - stand.timeOfImpact;
    if (Math.abs(sy - topY) > 0.25) return false;
    // 4. room for the body up there (crouched if that's all), and on the way up over where you are now
    let crouch = false;
    if (!this.clear(sx, sy, sz, false)) {
      if (!this.clear(sx, sy, sz, true)) return false;
      crouch = true;
    }
    if (!this.clear(p.x, Math.max(sy, p.y) + 0.06, p.z, true)) return false;
    // the whole way: straight up where you stand, then in over the edge (a capsule swept along both)
    const upY = Math.max(sy, p.y) + 0.06;
    if (!this.sweep(p.x, p.y + 0.1, p.z, 0, 1, 0, upY - p.y - 0.1)) return false;
    const ddx = sx - p.x, ddz = sz - p.z, dl = Math.hypot(ddx, ddz);
    if (!this.sweep(p.x, upY, p.z, ddx / dl, 0, ddz / dl, dl)) return false;
    // overhead from the head up to there
    const head = p.y + (this.body.crouching ? 1.06 : 1.66);
    const lift = sy + (crouch ? 1.06 : 1.66) + 0.08 - head;
    if (lift > 0) {
      const up = this.cast(p.x, head - 0.05, p.z, 0, 1, 0, lift + 0.05);
      if (up) return false;
    }
    // a bunker's no-climb places (a laser stairwell, a guarded road)
    this._c.set(sx, sy, sz);
    if (noMantle.has(p) || noMantle.has(this._c)) return false;
    // go
    this.kind = 'mantle';
    this.ladder = null;
    this.t = 0;
    const rise = sy - p.y;
    this.dur = THREE.MathUtils.clamp(0.33 + 0.17 * (rise / MANTLE_MAX), 0.3, 0.5);
    this.from.copy(p);
    this.to.set(sx, sy + 0.01, sz);
    this.crouchEnd = crouch;
    this.planted = false;
    this.inDir.set(ix, 0, iz);
    this.side.set(-iz, 0, ix); // your right as you face in
    // the hands go on the top's real edge (a stack's top crate can sit back from the face you ran into),
    // each at the height it finds under it; a hand with nothing under it stays down
    let edgeT = 0.16;
    for (let t = -0.2; t <= 0.16; t += 0.03) {
      const hit = this.cast(hx + ix * t, topY + 0.25, hz + iz * t, 0, -1, 0, 0.32);
      if (hit && Math.abs(topY + 0.25 - hit.timeOfImpact - topY) < 0.06) { edgeT = t; break; }
    }
    this.edge.set(hx + ix * (edgeT + 0.05), topY, hz + iz * (edgeT + 0.05));
    // (on something low the hands go further in, where the eye can follow them down)
    this.handIn = 0.05 + 0.28 * (1 - THREE.MathUtils.clamp(rise / MANTLE_MAX, 0.3, 1));
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      this.handY[i] = NaN;
      for (const lat of [0.21, 0.13, 0.06]) {
        const x = this.edge.x + this.side.x * lat * sgn + ix * this.handIn, z = this.edge.z + this.side.z * lat * sgn + iz * this.handIn;
        const hit = this.cast(x, topY + 0.25, z, 0, -1, 0, 0.5);
        if (hit && hit.timeOfImpact > 1e-3 && Math.abs(topY + 0.25 - hit.timeOfImpact - topY) < 0.12) {
          this.handY[i] = topY + 0.25 - hit.timeOfImpact;
          this.handLat[i] = lat;
          break;
        }
      }
    }
    this.body.velocity.set(0, 0, 0);
    this.body.grounded = false;
    this.initHands();
    this.onMantle?.('start', this.edge, THREE.MathUtils.clamp(rise / MANTLE_MAX, 0, 1));
    return true;
  }

  // ------------------------------------------------------------------ ladders

  /**
   * Called every frame from the player's normal movement: grab a ladder you walk into (facing it, or
   * off its top). `fwd` is the forward input (−1..1).
   */
  watch(dt: number, yaw: number, pitch: number, fwd: number, blocked: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (fwd < 0.2) this.holdOff = false;
    if (blocked || this.kind || this.cooldown > 0 || !ladders.list.length) return;
    const p = this.body.position;
    const vx = this.body.velocity.x, vz = this.body.velocity.z;
    const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
    for (const l of ladders.list) {
      // (cheap reject: nowhere near this one)
      if (Math.abs(p.x - l.base.x) > 4 || Math.abs(p.z - l.base.z) > 4) continue;
      if (l.usable && !l.usable()) continue;
      const span = l.top.y - l.base.y;
      const ox = l.out.x, oz = l.out.z;
      const sx = oz, sz = -ox;
      const h = p.y - l.base.y;
      // from below (or alongside, jumping onto it): facing it and pushing into it
      if (h > -0.6 && h < this.hMax(l) + 0.2 && !this.holdOff) {
        const a = ladderAt(l, THREE.MathUtils.clamp(h, 0, span), this._a);
        const dx = p.x - a.x, dz = p.z - a.z;
        const front = dx * ox + dz * oz, lat = dx * sx + dz * sz;
        const facing = -(lx * ox + lz * oz);
        const into = -(vx * ox + vz * oz);
        if (front > 0.02 && front < STANDOFF + 0.34 && Math.abs(lat) < l.half + 0.12 && facing > 0.55 && pitch > -0.75 && (fwd > 0.35 || into > 0.8)) {
          this.grab(l, THREE.MathUtils.clamp(h, 0, this.hMax(l)), yaw);
          return;
        }
      }
      // off the top: walking out over the edge where it is
      if (l.exit && Math.abs(p.y - l.top.y) < 0.45) {
        const dx = p.x - l.top.x, dz = p.z - l.top.z;
        const behind = -(dx * ox + dz * oz), lat = dx * sx + dz * sz;
        const outward = vx * ox + vz * oz;
        const looking = lx * ox + lz * oz;
        if (behind > -0.2 && behind < 0.8 && Math.abs(lat) < l.half + 0.15 && outward > 0.6 && looking > 0.2) {
          this.climbDown(l, yaw);
          return;
        }
      }
    }
  }

  /** Highest the feet go on `l`: a landing's edge to step over, or just short of the rails' top. */
  hMax(l: Ladder) {
    const span = l.top.y - l.base.y;
    return l.exit ? Math.max(0, span - 0.55) : Math.max(0, span - 1.2);
  }

  /** Onto `l` from in front of it, feet at `h` above its base (Use, or walking into it), looking along `yaw`. */
  grab(l: Ladder, h: number, yaw: number) {
    if (this.kind) return;
    this.kind = 'mount';
    // (from Use, standing off to one side: the view comes round to the ladder)
    this.yaw0 = yaw;
    this.yaw1 = ladderYaw(l);
    this.ladder = l;
    this.h = THREE.MathUtils.clamp(h, 0, this.hMax(l));
    this.v = 0;
    this.t = 0;
    this.dur = 0.24;
    this.from.copy(this.body.position);
    this.standPoint(l, this.h, this.to);
    this.body.velocity.set(0, 0, 0);
    this.lastRung = this.rungOf(l, this.h);
    this.initHands();
    this.onLadder?.(true);
  }

  /** Onto `l` from its landing: turn round and step down onto the top rungs. */
  climbDown(l: Ladder, yaw: number) {
    if (this.kind) return;
    this.kind = 'topIn';
    this.ladder = l;
    this.h = this.hMax(l);
    this.v = 0;
    this.t = 0;
    this.dur = 0.72;
    this.from.copy(this.body.position);
    this.standPoint(l, this.h, this.to);
    this.yaw0 = yaw;
    this.yaw1 = ladderYaw(l);
    this.body.velocity.set(0, 0, 0);
    this.lastRung = this.rungOf(l, this.h);
    this.initHands();
    this.onLadder?.(true);
  }

  private standPoint(l: Ladder, h: number, out: THREE.Vector3) {
    return ladderAt(l, h, out).addScaledVector(l.out, STANDOFF);
  }

  private rungOf(l: Ladder, h: number) {
    return Math.floor((h - l.first) / l.pitch + 0.5);
  }

  /** Off the ladder, wherever you are on it: `push` m/s away from it, `hop` up. */
  private letGo(push: number, hop: number) {
    const l = this.ladder!;
    this.kind = null;
    this.ladder = null;
    this.turnYaw = null;
    this.v = 0;
    this.body.velocity.set(l.out.x * push, hop, l.out.z * push);
    this.cooldown = hop > 0 ? 0.55 : 0.3;
    this.holdOff = true;
    this.holds[0].on = this.holds[1].on = false;
    this.onLadder?.(false);
  }

  // ------------------------------------------------------------------ frame

  /**
   * While active: move the body (returns true: the player's own movement is skipped this frame).
   * `fwd` forward input (−1..1); `jump` pressed this frame; `sprint`/`crouch` held.
   */
  update(dt: number, yaw: number, pitch: number, input: { fwd: number; jump: boolean; sprint: boolean; crouch: boolean }, frozen: boolean): boolean {
    this.camOff.y = this.camOff.pitch = this.camOff.roll = 0;
    if (!this.kind) {
      if (this.body.grounded) this.lastGroundY = this.body.position.y;
      return false;
    }
    const l = this.ladder;
    const p = this._b;
    if (this.kind === 'mantle') {
      this.t += dt;
      const u = this.progress;
      // the hands land first, then the pull (slow, fast, slow), and over once the eye is past the top
      const k0 = THREE.MathUtils.clamp((this.to.y - this.from.y) / MANTLE_MAX, 0, 1);
      const rise = smooth(0.06, 0.8, u);
      const over = smooth(0.32 + 0.15 * k0, 1, u);
      p.set(
        this.from.x + (this.to.x - this.from.x) * over,
        this.from.y + (this.to.y - this.from.y) * rise,
        this.from.z + (this.to.z - this.from.z) * over,
      );
      this.body.placeFeet(p);
      // the view: a pull down into the hands, then up and over
      const k = THREE.MathUtils.clamp((this.to.y - this.from.y) / MANTLE_MAX, 0.3, 1);
      // (a low ledge's edge is well under the eye: the head drops further to watch the hands onto it)
      this.camOff.pitch = -Math.sin(Math.PI * Math.min(1, u / 0.85)) * (0.1 * k + 0.34 * (1 - k));
      this.camOff.y = -Math.sin(Math.PI * Math.min(1, u / 0.3)) * 0.04 * k;
      this.camOff.roll = Math.sin(Math.PI * u) * 0.018;
      this.mantleHands(u, dt);
      if (u >= 1) {
        this.kind = null;
        if (this.crouchEnd) this.body.crouchNow(true);
        // a little of the move carries on (nothing worse than stopping dead on top)
        this.body.velocity.set(this.inDir.x * 1.1, -2, this.inDir.z * 1.1);
        this.body.grounded = true;
        this.lastGroundY = this.to.y;
        this.cooldown = 0.2;
        this.holds[0].on = this.holds[1].on = false;
        this.onMantle?.('end', this.to, k);
      }
      return true;
    }
    if (!l) { this.kind = null; return false; }

    if (this.kind === 'mount') {
      this.t += dt;
      const u = smooth(0, 1, this.progress);
      p.lerpVectors(this.from, this.to, u);
      this.body.placeFeet(p);
      const off = angleTo(this.yaw1, this.yaw0);
      this.turnYaw = Math.abs(off) > 0.6 ? this.yaw1 + off - (off - Math.sign(off) * 0.6) * u : null;
      this.ladderHands(l, dt);
      if (this.progress >= 1) { this.kind = 'ladder'; this.turnYaw = null; }
      return true;
    }

    if (this.kind === 'topIn') {
      this.t += dt;
      const u = this.progress;
      // back to the edge first, turning round, then down onto the rungs
      const across = smooth(0, 0.62, u);
      const down = smooth(0.3, 1, u);
      p.set(
        this.from.x + (this.to.x - this.from.x) * across,
        this.from.y + (this.to.y - this.from.y) * down,
        this.from.z + (this.to.z - this.from.z) * across,
      );
      this.body.placeFeet(p);
      this.turnYaw = this.yaw0 + angleTo(this.yaw0, this.yaw1) * smooth(0, 0.7, u);
      this.camOff.pitch = -Math.sin(Math.PI * u) * 0.12;
      this.ladderHands(l, dt, u < 0.3 ? -1 : 1);
      if (u >= 1) { this.kind = 'ladder'; this.turnYaw = null; }
      return true;
    }

    if (this.kind === 'topOut') {
      this.t += dt;
      const u = this.progress;
      const rise = easeOut(u / 0.6);
      const over = smooth(0.3, 1, u);
      p.set(
        this.from.x + (this.to.x - this.from.x) * over,
        this.from.y + (this.to.y - this.from.y) * rise,
        this.from.z + (this.to.z - this.from.z) * over,
      );
      this.body.placeFeet(p);
      this.camOff.pitch = -Math.sin(Math.PI * Math.min(1, u / 0.8)) * 0.07;
      this.camOff.y = -Math.sin(Math.PI * Math.min(1, u / 0.45)) * 0.035;
      this.topOutHands(l, u, dt);
      if (u >= 1) {
        this.kind = null;
        this.ladder = null;
        this.body.velocity.set(-l.out.x * 0.9, -2, -l.out.z * 0.9);
        this.body.grounded = true;
        this.lastGroundY = this.to.y;
        this.cooldown = 0.4;
        this.holds[0].on = this.holds[1].on = false;
        this.onRung?.(true, 0.9);
        this.onLadder?.(false);
      }
      return true;
    }

    // ---- on the ladder
    if (input.jump && !frozen) {
      this.letGo(2.2, 1.4);
      return false;
    }
    let dir = frozen ? 0 : input.fwd;
    // looking well down, forward goes down (and back goes up), as in most games
    if (pitch < -0.42) dir = -dir;
    let target = dir > 0 ? dir * UP_SPEED * (input.sprint ? 1.4 : 1) : dir * DOWN_SPEED * (input.sprint ? 1.3 : 1);
    const sliding = dir < -0.2 && input.crouch;
    if (sliding) target = -SLIDE_SPEED;
    const accel = Math.abs(target) < Math.abs(this.v) || target * this.v < 0 ? 12 : sliding ? 7 : 9;
    this.v += THREE.MathUtils.clamp(target - this.v, -accel * dt, accel * dt);
    this.h += this.v * dt;
    const hMax = this.hMax(l);
    if (this.h <= 0) {
      this.h = 0;
      if (this.v < 0) {
        // feet on the ground: step back off it
        this.standPoint(l, 0, p);
        this.body.placeFeet(p);
        if (sliding) this.onRung?.(true, 1.1);
        this.letGo(dir < 0 && pitch >= -0.42 ? 1.2 : 0.4, 0);
        this.body.velocity.y = -2;
        this.body.grounded = true;
        this.lastGroundY = p.y;
        return true;
      }
    }
    if (this.h >= hMax) {
      this.h = hMax;
      if (this.v > 0 && l.exit) {
        this.kind = 'topOut';
        this.t = 0;
        this.dur = 0.62;
        this.from.copy(this.body.position);
        this.to.copy(l.exit);
        this.v = 0;
        return true;
      }
      this.v = Math.min(0, this.v);
    }
    this.standPoint(l, this.h, p);
    this.body.placeFeet(p);
    // a rung under a foot: a clank (the slide is one long scrape, a clank now and then)
    const r = this.rungOf(l, this.h);
    if (r !== this.lastRung) {
      if (!sliding || (r & 3) === 0) this.onRung?.(true, sliding ? 0.5 : 0.55 + Math.min(0.5, Math.abs(this.v) * 0.2));
      this.lastRung = r;
      this.foot ^= 1;
    }
    // the climb's rhythm: a small lift and lean with each pull (Settings → Head bob scales it in Game)
    this.climbT += this.v * dt / l.pitch;
    const moving = Math.min(1, Math.abs(this.v) / UP_SPEED);
    this.camOff.y = -Math.abs(Math.sin(this.climbT * Math.PI)) * 0.014 * moving;
    this.camOff.roll = Math.sin(this.climbT * Math.PI) * 0.012 * moving * (sliding ? 0 : 1);
    this.ladderHands(l, dt, sliding ? 0 : 1);
    return true;
  }

  // ------------------------------------------------------------------ hands

  /** Hands come up into the grip from below the view, not from wherever they hung. */
  private initHands() {
    const p = this.body.position;
    for (const hd of this.holds) {
      hd.on = true;
      hd.fresh = true;
      hd.p.set(p.x, p.y + 1.0, p.z);
      hd.vel.set(0, 0, 0);
    }
  }

  /** Smooth each hand toward its target (world-space spring: exact while the target is still). */
  private settle(dt: number, w = 30) {
    for (const hd of this.holds) {
      if (!hd.on) continue;
      if (hd.fresh) {
        hd.fresh = false;
        hd.fingers.copy(hd.tf);
        hd.back.copy(hd.tb);
      }
      const a = this._c.copy(hd.tp).sub(hd.p).multiplyScalar(w * w).addScaledVector(hd.vel, -2 * w);
      hd.vel.addScaledVector(a, dt);
      hd.p.addScaledVector(hd.vel, dt);
      const k = 1 - Math.exp(-22 * dt);
      hd.fingers.lerp(hd.tf, k).normalize();
      hd.back.lerp(hd.tb, k).normalize();
    }
  }

  /**
   * Hand over hand: the right hand takes the even rungs, the left the odd ones, each reaching for the
   * next of its own as the one it holds drops to the chest. Above the top rung they hold the rails.
   * `mode`: 1 climbing, 0 sliding (hands loose on the rails), −1 reaching for the rails' tops.
   */
  private ladderHands(l: Ladder, dt: number, mode = 1) {
    const ox = l.out.x, oz = l.out.z;
    const sx = oz, sz = -ox; // the climber's right
    const lat = Math.min(l.half - 0.07, 0.15);
    const reach = this.h + EYE + 0.05;
    const topRung = l.first + (l.count - 1) * l.pitch;
    for (let i = 0; i < 2; i++) {
      const hd = this.holds[i];
      hd.on = true;
      const sgn = i === 0 ? 1 : -1;
      let hy: number, rail = false, swing = 0;
      if (mode === 0 || mode === -1) {
        // sliding: both hands on the rails, sliding with you. Reaching for the top: the rails' tops
        hy = mode === 0 ? this.h + 1.25 + sgn * 0.08 : Math.min(l.rail - 0.15, this.h + EYE + 0.15);
        rail = true;
      } else {
        const q = i === 0 ? 0 : 1;
        const u = (reach - (l.first + q * l.pitch)) / (2 * l.pitch);
        const kk = Math.floor(u);
        const f = u - kk;
        const k0 = q + 2 * kk, k1 = k0 + 2;
        // the rung for each (above the last rung, the rails up to their tops)
        let y0 = l.first + Math.max(0, k0) * l.pitch, y1 = l.first + Math.max(0, k1) * l.pitch;
        const r0 = y0 > topRung + 1e-3, r1 = y1 > topRung + 1e-3;
        if (r0) y0 = Math.min(y0, l.rail - 0.12);
        if (r1) y1 = Math.min(y1, l.rail - 0.12);
        // hold for most of the cycle, then the reach: up and back off the rungs, and on
        const m = smooth(0.62, 1, f);
        hy = y0 + (y1 - y0) * m;
        rail = m < 0.5 ? r0 : r1;
        swing = y1 !== y0 ? Math.sin(Math.PI * m) : 0;
      }
      const a = ladderAt(l, Math.min(hy, l.rail - 0.05), this._a);
      const lx = rail ? l.half : lat;
      hd.tp.set(a.x + sx * lx * sgn, a.y, a.z + sz * lx * sgn)
        // the wrist sits just proud of the rung (the hand wraps it), swinging out on a reach
        .addScaledVector(l.out, 0.03 + swing * 0.09);
      if (rail) {
        // round the rail: fingers toward the ladder, back of the hand outward
        hd.tf.set(-ox, 0.25, -oz).normalize();
        hd.tb.set(sx * sgn, 0, sz * sgn).addScaledVector(l.out, 0.4).normalize();
      } else {
        // over the rung: fingers up and over, back of the hand to you
        hd.tf.set(-ox * 0.45, 1, -oz * 0.45).normalize();
        hd.tb.set(ox, -0.35, oz).normalize();
      }
      hd.curl = 0.9 - swing * 0.75;
      hd.thumb = 0.75 - swing * 0.5;
      hd.oppose = 0.62;
      hd.spread = swing * 0.2;
      // a hand taking a new rung: a lighter knock than a boot
      if (mode === 1 && swing > 0.92) hd.knock = true;
      else if (mode === 1 && swing < 0.1 && hd.knock) { hd.knock = false; this.onRung?.(false, 0.35); }
    }
    this.settle(dt, mode === 0 ? 40 : 30);
  }

  /** Over the top: both hands on the rails' tops, pushing as you rise past them, then away. */
  private topOutHands(l: Ladder, u: number, dt: number) {
    const ox = l.out.x, oz = l.out.z;
    const sx = oz, sz = -ox;
    const y = l.rail - 0.15;
    for (let i = 0; i < 2; i++) {
      const hd = this.holds[i];
      const sgn = i === 0 ? 1 : -1;
      hd.on = u < 0.72;
      const a = ladderAt(l, y, this._a);
      hd.tp.set(a.x + sx * l.half * sgn, a.y, a.z + sz * l.half * sgn).addScaledVector(l.out, 0.02);
      hd.tf.set(-ox, 0.25, -oz).normalize();
      hd.tb.set(sx * sgn, 0, sz * sgn).addScaledVector(l.out, 0.4).normalize();
      hd.curl = 0.88;
      hd.thumb = 0.7;
    }
    this.settle(dt, 34);
  }

  /** The mantle: both palms come up onto the edge, flat, take the weight, and let go as you pass over them. */
  private mantleHands(u: number, dt: number) {
    const e = this.edge, s = this.side, n = this.inDir;
    for (let i = 0; i < 2; i++) {
      const hd = this.holds[i];
      const sgn = i === 0 ? 1 : -1;
      hd.on = u < 0.82 && !Number.isNaN(this.handY[i]);
      const lat = this.handLat[i];
      hd.tp.set(e.x + s.x * lat * sgn, this.handY[i] + 0.035, e.z + s.z * lat * sgn).addScaledVector(n, this.handIn);
      // fingers in over the top and a little outward, palms down
      hd.tf.copy(n).addScaledVector(s, 0.25 * sgn).normalize();
      hd.tb.copy(UP).addScaledVector(n, -0.15).normalize();
      hd.curl = 0.12;
      hd.thumb = 0.2;
      hd.oppose = 0.1;
      hd.spread = 0.35;
    }
    if (u > 0.14 && !this.planted) { this.planted = true; this.onMantle?.('plant', this.edge, 1); }
    this.settle(dt, 38);
  }
}
