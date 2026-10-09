import * as THREE from 'three/webgpu';
import type { Combat, Hostile } from './Combat';

/**
 * Aim assist for controllers, only while the pad is the device in use (`Input.device === 'pad'`):
 *  - Friction: the right stick slows as the crosshair crosses a hostile (more so aimed), so a thumb can
 *    stop on a target it would sail past.
 *  - A light pull: bringing the sights up eases the aim part of the way (~55% over a fifth of a second)
 *    toward the nearest hostile inside a small cone. It never finishes the job: you still aim.
 * Never through walls or smoke, never at the dead, never at mines; nothing at all on mouse or touch.
 * The pad module asks once a frame (`pad.assist`); the pull moves the camera itself.
 */

const FRICTION_HIP = 0.55;
const FRICTION_ADS = 0.4;
/** Extra angle (rad) round a target where friction starts. */
const EDGE = 0.04;
/** Pull cone (rad) beyond the target's own size, and how much of the way it pulls. */
const PULL_CONE = 0.12;
const PULL_SHARE = 0.55;
const PULL_TIME = 0.2;

const _to = new THREE.Vector3();
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export interface AssistView { yaw: number; pitch: number; readonly forward: THREE.Vector3 }

export class AimAssist {
  private adsWas = false;
  private pullT = 0;
  private pullTo: Hostile | null = null;
  /** Last frame's look-speed scale (debug / tests). */
  slow = 1;

  constructor(private combat: Combat, private smoked: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false) {}

  /** The nearest live hostile to the crosshair (angle past its own size), within `range`, or null. */
  private best(eye: THREE.Vector3, fwd: THREE.Vector3, range: number, cone: number) {
    let best: Hostile | null = null, bs = cone, bAng = 0, bR = 0;
    for (const pr of this.combat.providers) for (const h of pr.hostiles()) {
      if (!h.alive || h.kind === 'mine') continue;
      _to.subVectors(h.center, eye);
      const d = _to.length();
      if (d < 1 || d > range) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(_to.dot(fwd) / d, -1, 1));
      // the body, not the generous bounding sphere
      const angR = Math.atan(Math.min(h.radius, 0.55) * 0.8 / d);
      const s = ang - angR;
      if (s < bs) { bs = s; best = h; bAng = ang; bR = angR; }
    }
    if (!best) return null;
    const c = best.center;
    if (!this.combat.clearLine(eye, c, this.combat.target.collider) || this.smoked(eye, c)) return null;
    return { h: best, ang: bAng, angR: bR };
  }

  /** One frame: returns the look-speed scale for the stick; on ADS it nudges `view` itself. */
  frame(dt: number, view: AssistView, eye: THREE.Vector3, ads: boolean, range = 160): number {
    const fwd = view.forward;
    const t = this.best(eye, fwd, range, Math.max(EDGE, PULL_CONE));
    // friction: full at the centre of the body, easing out to EDGE beyond its edge
    this.slow = 1;
    if (t && t.ang < t.angR + EDGE) {
      const k = THREE.MathUtils.smoothstep(t.ang, t.angR * 0.4, t.angR + EDGE);
      this.slow = THREE.MathUtils.lerp(ads ? FRICTION_ADS : FRICTION_HIP, 1, k);
    }
    // the pull: once, as the sights come up
    if (ads && !this.adsWas && t && t.ang < t.angR + PULL_CONE) { this.pullT = PULL_TIME; this.pullTo = t.h; }
    if (!ads) this.pullT = 0;
    this.adsWas = ads;
    if (this.pullT > 0 && this.pullTo?.alive) {
      const step = Math.min(dt, this.pullT);
      this.pullT -= dt;
      _to.subVectors(this.pullTo.center, eye);
      const yaw = Math.atan2(-_to.x, -_to.z);
      const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      // PULL_SHARE of the way over PULL_TIME, spread evenly per frame
      const f = 1 - Math.pow(1 - PULL_SHARE, step / PULL_TIME);
      view.yaw += angDiff(view.yaw, yaw) * f;
      view.pitch += (pitch - view.pitch) * f;
    }
    return this.slow;
  }
}
