import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { Input } from '@/engine/input';
import { CharacterModel, LOOKS } from './CharacterModel';
import { damp, dampAngle } from '@/engine/noise';

const STAND_HALF = 0.5;
const CROUCH_HALF = 0.2;
const RADIUS = 0.33;

/** Rapier kinematic character controller + procedural model. */
export class Player {
  model: CharacterModel;
  position = new THREE.Vector3(); // feet
  velocity = new THREE.Vector3();
  yaw = 0; // body facing
  grounded = false;
  crouching = false;
  sprinting = false;
  frozen = false;
  interactPose = 0;
  speedMult = 1;
  flashlight = false;
  private body: ReturnType<Physics['world']['createRigidBody']>;
  collider: ReturnType<Physics['world']['createCollider']>;
  private controller: ReturnType<Physics['world']['createCharacterController']>;
  private halfHeight = STAND_HALF;
  private coyote = 0;
  private jumpBuffer = 0;
  private lastYaw = 0;
  private turnRate = 0;
  onLand: ((impact: number) => void) | null = null;
  onJump: (() => void) | null = null;

  constructor(private physics: Physics, archetype: string, spawn: THREE.Vector3) {
    this.model = new CharacterModel(LOOKS[archetype] ?? LOOKS.infiltrator);
    const R = physics.R;
    this.position.copy(spawn);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + RADIUS + STAND_HALF, spawn.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(STAND_HALF, RADIUS), this.body);
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  get height() {
    return (this.halfHeight + RADIUS) * 2;
  }

  /** Eye-ish pivot for the camera. */
  get headPosition() {
    return new THREE.Vector3(this.position.x, this.position.y + (this.crouching ? 1.05 : 1.55), this.position.z);
  }

  teleport(p: THREE.Vector3) {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.body.setTranslation({ x: p.x, y: p.y + RADIUS + this.halfHeight + 0.05, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + RADIUS + this.halfHeight + 0.05, z: p.z });
  }

  private setCrouch(c: boolean) {
    if (c === this.crouching) return;
    const t = this.body.translation();
    if (!c) {
      // headroom check before standing up
      const dist = this.physics.raycast({ x: t.x, y: t.y + this.halfHeight + RADIUS - 0.05, z: t.z }, { x: 0, y: 1, z: 0 }, (STAND_HALF - CROUCH_HALF) * 2 + 0.1, this.collider);
      if (dist !== null) return;
    }
    this.crouching = c;
    const newHalf = c ? CROUCH_HALF : STAND_HALF;
    const dy = newHalf - this.halfHeight;
    this.halfHeight = newHalf;
    this.collider.setHalfHeight(newHalf);
    this.body.setTranslation({ x: t.x, y: t.y + dy, z: t.z }, true);
  }

  /** `faceCamera`: first person — the body always faces the view heading. */
  update(dt: number, input: Input, camYaw: number, faceCamera = false) {
    let mx = 0, mz = 0;
    if (!this.frozen) {
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) mz += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) mz -= 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
    }
    const wantCrouch = !this.frozen && (input.isDown('KeyC') || input.isDown('ControlLeft'));
    this.setCrouch(wantCrouch);
    const moving = mx !== 0 || mz !== 0;
    this.sprinting = moving && !this.crouching && input.isDown('ShiftLeft') && mz >= 0;

    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    // camera-relative: camYaw is the camera's heading (0 = looking -z)
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dirX = mx * cos - mz * sin;
    const dirZ = -mx * sin - mz * cos;
    const speed = (this.crouching ? 1.8 : this.sprinting ? 6.4 : 3.4) * this.speedMult;
    const target = new THREE.Vector3(dirX * speed, 0, dirZ * speed);
    if (!moving) target.set(0, 0, 0);
    const accel = this.grounded ? (moving ? 12 : 14) : 2.5;
    this.velocity.x = damp(this.velocity.x, target.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, target.z, accel, dt);

    // jump with coyote time + buffer
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.pressed('Space') && !this.frozen ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching) {
      this.velocity.y = 6.0;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.grounded = false;
      this.onJump?.();
    }
    this.velocity.y -= 19 * dt;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -2;

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const prevVy = this.velocity.y;
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    // if we were blocked, bleed velocity
    if (dt > 0) {
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, mv.x / dt, 0.5);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, mv.z / dt, 0.5);
      if (Math.abs(mv.y / dt - this.velocity.y) > 0.5 && this.velocity.y > 0) this.velocity.y = Math.min(this.velocity.y, mv.y / dt);
    }
    if (!wasGrounded && this.grounded && prevVy < -4) this.onLand?.(Math.min(1, -prevVy / 14));
    this.position.set(next.x, next.y - this.halfHeight - RADIUS, next.z);

    // face movement direction (or camera when interacting)
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (faceCamera) this.yaw = camYaw + Math.PI;
    else if (hs > 0.3 && moving) this.yaw = dampAngle(this.yaw, Math.atan2(this.velocity.x, this.velocity.z), 12, dt);
    let dyaw = this.yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.turnRate = damp(this.turnRate, dyaw / Math.max(dt, 1e-4), 8, dt);
    this.lastYaw = this.yaw;

    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.yaw;
    // head looks toward the camera heading
    let look = (camYaw + Math.PI) - this.yaw;
    while (look > Math.PI) look -= Math.PI * 2;
    while (look < -Math.PI) look += Math.PI * 2;
    this.model.update(dt, {
      speed: hs,
      grounded: this.grounded,
      crouch: this.crouching ? 1 : 0,
      vy: this.velocity.y,
      turn: this.turnRate,
      interact: this.interactPose,
      aimPitch: 0,
      lookYaw: faceCamera ? 0 : Math.abs(look) < 1.6 ? look : 0,
    });
  }

  /** How visible/noisy the player is right now (1 = normal walking). */
  get noise() {
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    // a lit torch makes you far easier to spot
    const light = this.flashlight ? 1.6 : 1;
    if (this.crouching) return (0.45 + hs * 0.05) * light;
    if (this.sprinting) return 1.5 * light;
    return (0.75 + hs * 0.08) * light;
  }
}
