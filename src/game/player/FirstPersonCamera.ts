import * as THREE from 'three/webgpu';
import type { Input } from '@/engine/input';
import { damp, clamp, Simplex2 } from '@/engine/noise';

export interface FPFrame {
  feet: THREE.Vector3;
  crouch: boolean;
  sprint: boolean;
  speed: number;
  grounded: boolean;
  strafe: number; // -1..1 lateral input, for a subtle roll
  exertion?: number; // 0..1 out of breath: the view heaves with each breath
}

/**
 * First-person head camera: mouse look, eye-height easing for crouch, gait head-bob, strafe roll,
 * landing dip, sprint FOV kick and trauma shake. Yaw convention matches the rest of the game:
 * forward = (-sin yaw, 0, -cos yaw).
 */
export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;
  enabled = true;
  bobPhase = 0;
  private eye = 1.62;
  private roll = 0;
  private dip = 0;
  private dipVel = 0;
  private breathPhase = 0;
  private trauma = 0;
  private t = 0;
  private fov = 64;
  private shake = new Simplex2(7);
  readonly baseFov = 64;
  /** Aiming down the sights: the FOV to zoom to, and how far into the zoom (0..1). */
  aimFov = 50;
  aimK = 0;

  constructor(public camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** A blow knocks the head: pitch, yaw, roll offsets on a stiff spring (the aim itself isn't moved). */
  private punchO = new THREE.Vector3();
  private punchV = new THREE.Vector3();
  /** Knocked by a hit from `bearing` (radians, 0 = ahead, + = to the left), strength 0..1. */
  punch(bearing: number, k: number) {
    const s = Math.sin(bearing), c = Math.cos(bearing);
    // the head snaps back from a hit in front, and turns and tilts away from one at the side
    this.punchV.x += c * 6 * k;
    this.punchV.y += -s * 4 * k;
    this.punchV.z += -s * 8 * k;
  }

  /** Footstep callback, fired at the low point of each stride so sound and head-bob agree. */
  onStep: ((intensity: number) => void) | null = null;

  /** Landing: the knees absorb the impact. `speed` = vertical impact speed in m/s. */
  land(speed: number) {
    const depth = Math.min(0.24, speed * 0.022);
    this.dipVel -= depth * 12;
    if (speed > 6) this.addTrauma(Math.min(0.5, (speed - 6) * 0.06));
  }

  /** The body moved under the head (mid-air tuck): keep the eye where it was. */
  shiftEye(dy: number) {
    this.eye -= dy;
  }

  snap(yaw: number, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number, input: Input, f: FPFrame) {
    this.t += dt;
    if (this.enabled) {
      // aimed: look speed follows the zoom, so the sights track the same as the hip
      const zoom = this.camera.fov / this.baseFov;
      const s = 0.0021 * input.sensitivity * (this.aimK > 0.05 ? zoom : 1);
      this.yaw -= input.mouseDX * s;
      this.pitch = clamp(this.pitch - input.mouseDY * s, -1.48, 1.48);
    }
    // eye height eases between standing and crouched
    this.eye = damp(this.eye, f.crouch ? 1.02 : 1.62, 10, dt);

    // gait bob: phase advances with distance travelled
    const move = f.grounded ? Math.min(1, f.speed / 3.4) : 0;
    const stride = f.sprint ? 2.25 : f.crouch ? 1.05 : 1.45;
    const prevPhase = this.bobPhase;
    this.bobPhase += (f.speed / stride) * Math.PI * dt * (f.grounded ? 1 : 0);
    // foot strike = head at its lowest = |cos| crossing zero (phase passes π/2 + kπ)
    if (f.grounded && f.speed > 0.5 && Math.floor(prevPhase / Math.PI + 0.5) !== Math.floor(this.bobPhase / Math.PI + 0.5)) {
      this.onStep?.(Math.min(1.2, 0.35 + f.speed / 6) * (f.crouch ? 0.45 : 1));
    }
    const amp = f.sprint ? 1.6 : f.crouch ? 0.55 : 1;
    const bobY = (Math.abs(Math.cos(this.bobPhase)) - 0.5) * 0.045 * amp * move;
    const bobX = Math.sin(this.bobPhase) * 0.022 * amp * move;

    // landing spring
    this.dipVel += (-this.dip * 70 - this.dipVel * 11) * dt;
    this.dip += this.dipVel * dt;

    this.roll = damp(this.roll, -f.strafe * 0.018 - bobX * 0.35, 8, dt);

    // trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    const sh = this.trauma * this.trauma;
    const k = this.t * 24;

    // breathing heave: slow and invisible at rest, deep and quick when winded
    const ex = f.exertion ?? 0;
    this.breathPhase += dt * Math.PI * 2 / (2.2 - ex * 1.3);
    const heave = Math.sin(this.breathPhase) * (0.0012 + ex * 0.009);

    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(f.feet.x, f.feet.y + this.eye + bobY + this.dip + heave, f.feet.z).addScaledVector(right, bobX);
    // the punch spring (critically damped-ish: a quick knock, a quick settle)
    this.punchV.addScaledVector(this.punchO, -170 * dt).multiplyScalar(Math.exp(-dt * 17));
    this.punchO.addScaledVector(this.punchV, dt);
    const po = this.punchO;
    this.camera.rotation.set(
      this.pitch + this.shake.noise(k, 1) * 0.04 * sh + bobY * 0.15 + this.dip * 0.35 + heave * 0.8 + po.x,
      this.yaw + this.shake.noise(2, k) * 0.04 * sh + po.y,
      this.roll + this.shake.noise(k, k) * 0.05 * sh + po.z,
    );

    const free = this.baseFov + (f.sprint ? 7 : 0) - (f.crouch ? 2 : 0);
    const target = free + (this.aimFov - free) * this.aimK;
    this.fov = this.aimK > 0.01 ? damp(this.fov, target, 18, dt) : damp(this.fov, target, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
