import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { Input } from '@/engine/input';
import { damp, clamp, Simplex2 } from '@/engine/noise';

/** Over-the-shoulder orbit camera with collision, sprint FOV kick and trauma-based shake. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = -0.12;
  distance = 4.4;
  private targetDistance = 4.4;
  private curDistance = 4.4;
  private pivot = new THREE.Vector3();
  private trauma = 0;
  private shakeNoise = new Simplex2(99);
  private t = 0;
  private fov = 55;
  private liftS = 0;
  interior = false;
  shoulder = 0.55;
  enabled = true;

  constructor(public camera: THREE.PerspectiveCamera, private physics: Physics) {}

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  snap(head: THREE.Vector3, yaw?: number) {
    this.pivot.copy(head);
    if (yaw !== undefined) this.yaw = yaw;
  }

  update(dt: number, input: Input, head: THREE.Vector3, opts: { sprint: boolean; crouch: boolean; exclude?: unknown }) {
    this.t += dt;
    if (this.enabled) {
      const s = 0.0022 * input.sensitivity;
      this.yaw -= input.mouseDX * s;
      this.pitch -= input.mouseDY * s;
      this.pitch = clamp(this.pitch, -1.25, 0.6);
      if (input.wheel) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.5, 2.2, 8);
    }
    const desiredDist = this.interior ? Math.min(this.targetDistance, 3.2) : this.targetDistance;
    // indoors: lift the pivot so we look over the shoulder and down into the room
    this.liftS = damp(this.liftS, this.interior ? 0.85 : 0, 5, dt);

    // smooth pivot (slightly lagged for weight)
    this.pivot.x = damp(this.pivot.x, head.x, 16, dt);
    this.pivot.y = damp(this.pivot.y, head.y + this.liftS, 10, dt);
    this.pivot.z = damp(this.pivot.z, head.z, 16, dt);

    const cp = Math.cos(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.pivot.clone().addScaledVector(right, this.shoulder * (opts.crouch ? 0.8 : 1) * (this.interior ? 0.6 : 1));

    // collision: cast from the pivot toward the camera
    const dir = back.clone().normalize();
    const hit = this.physics.raycast(origin, dir, desiredDist + 0.3, opts.exclude as never);
    const allowed = hit !== null ? Math.max(0.6, hit - 0.3) : desiredDist;
    // pull in fast, ease out slowly
    this.curDistance = allowed < this.curDistance ? damp(this.curDistance, allowed, 30, dt) : damp(this.curDistance, allowed, 4, dt);
    this.distance = this.curDistance;

    const pos = origin.clone().addScaledVector(dir, this.curDistance);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    const sh = this.trauma * this.trauma;
    const n = this.shakeNoise;
    const k = this.t * 22;
    pos.x += n.noise(k, 0) * 0.25 * sh;
    pos.y += n.noise(0, k) * 0.25 * sh;
    this.camera.position.copy(pos);
    const look = origin.clone().addScaledVector(back, -10);
    this.camera.lookAt(look);
    this.camera.rotateZ(n.noise(k, k) * 0.05 * sh);

    const targetFov = opts.sprint ? 62 : opts.crouch ? 52 : 55;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
