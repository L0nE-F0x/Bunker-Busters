import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { Input } from '@/engine/input';
import { CharacterModel, LOOKS } from './CharacterModel';
import { damp, dampAngle } from '@/engine/noise';

const STAND_HALF = 0.5;
const CROUCH_HALF = 0.2;
const RADIUS = 0.33;
const GRAVITY = 9.81;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * 0.55); // ~0.55 m standing jump
const GROUND_ACCEL = 10; // m/s² from a standstill up to walking pace
const SPRINT_ACCEL = 5; // m/s² building from a jog to a full sprint
const GROUND_DECEL = 16; // m/s² stopping / reversing (feet planted)
const AIR_ACCEL = 1.2; // m/s² of mid-air steering
const DRAG = GRAVITY / (55 * 55); // quadratic drag coefficient → terminal velocity ~55 m/s
const MAX_CLIMB = (50 * Math.PI) / 180;
const WALL_NY = Math.cos(MAX_CLIMB); // contact normals flatter than this are walls

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
  /** Set each frame from the Stealth skill. */
  stealthRank = 0;
  /** '' | 'still' | 'lowlight', set each frame from the Stealth focus. */
  stealthFocus = '';
  private body: ReturnType<Physics['world']['createRigidBody']>;
  collider: ReturnType<Physics['world']['createCollider']>;
  private controller: ReturnType<Physics['world']['createCharacterController']>;
  private halfHeight = STAND_HALF;
  private coyote = 0;
  private jumpBuffer = 0;
  private lastYaw = 0;
  private turnRate = 0;
  private snapping = false; // vy is the artificial ground-snap velocity, not a real fall
  private recover = 0; // post-landing beat before the next jump
  private grade = 0; // terrain rise/run along the direction of travel
  /** 0..1 after a hard landing; slows you and blocks sprinting while it wears off. */
  stumble = 0;
  /** Sprint reserve 0..1. Run it dry and you're winded until you've caught your breath. */
  stamina = 1;
  winded = false;
  /** Smoothed 0..1 "how out of breath" (drives breathing audio + view heave). */
  exertion = 0;
  /** `k` 0..1 for effects, `speed` = impact speed in m/s. */
  onLand: ((k: number, speed: number) => void) | null = null;
  /** Mid-air tuck/untuck moved the feet by `dy` while the head stayed put. */
  onTuck: ((dy: number) => void) | null = null;
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
    this.controller.setMaxSlopeClimbAngle(MAX_CLIMB);
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
    const delta = STAND_HALF - CROUCH_HALF;
    // airborne: crouching tucks the legs up (head stays put, feet rise), so a tuck-jump clears more
    let tuck = !this.grounded;
    if (!c) {
      if (tuck) {
        // un-tuck downward only if the legs have room, otherwise stand up from the feet
        const below = this.physics.raycast({ x: t.x, y: t.y - this.halfHeight - RADIUS + 0.02, z: t.z }, { x: 0, y: -1, z: 0 }, delta * 2 + 0.1, this.collider);
        if (below !== null) tuck = false;
      }
      if (!tuck) {
        // headroom check before standing up
        const dist = this.physics.raycast({ x: t.x, y: t.y + this.halfHeight + RADIUS - 0.05, z: t.z }, { x: 0, y: 1, z: 0 }, delta * 2 + 0.1, this.collider);
        if (dist !== null) return;
      }
    }
    this.crouching = c;
    const newHalf = c ? CROUCH_HALF : STAND_HALF;
    const dy = newHalf - this.halfHeight;
    this.halfHeight = newHalf;
    this.collider.setHalfHeight(newHalf);
    // grounded: keep the feet planted. tucking: keep the head where it is (feet move by 2·dy)
    const shift = tuck ? -dy : dy;
    this.body.setTranslation({ x: t.x, y: t.y + shift, z: t.z }, true);
    if (tuck) this.onTuck?.(2 * dy);
  }

  /** `faceCamera`: first person — the body always faces the view heading. */
  update(dt: number, input: Input, camYaw: number, faceCamera = false) {
    let mx = 0, mz = 0;
    if (!this.frozen) {
      if (input.act('forward')) mz += 1;
      if (input.act('back')) mz -= 1;
      if (input.act('left')) mx -= 1;
      if (input.act('right')) mx += 1;
      if (input.enabled) { mx += input.moveX + input.padX; mz += input.moveZ + input.padZ; } // touch / controller stick (analog)
      // keys and a stick together never go faster than full
      const m = Math.hypot(mx, mz);
      if (m > 1) { mx /= m; mz /= m; }
    }
    const wantCrouch = !this.frozen && input.act('crouch');
    this.setCrouch(wantCrouch);
    const moving = mx !== 0 || mz !== 0;
    this.sprinting = moving && !this.crouching && input.act('sprint') && mz > 0 && this.stumble < 0.3 && !this.winded;

    // keys give full speed; a half-pushed stick walks slower (but never crawls)
    const push = Math.hypot(mx, mz);
    const len = push || 1;
    mx /= len; mz /= len;
    const analog = push > 0 && push < 1 ? 0.45 + 0.55 * push : 1;
    // camera-relative: camYaw is the camera's heading (0 = looking -z)
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const dirX = mx * cos - mz * sin;
    const dirZ = -mx * sin - mz * cos;
    // backpedalling and strafing are slower than walking forward; uphill is slower, downhill a touch faster
    const dirMult = mz < -0.3 ? 0.7 : mz < 0.3 ? 0.88 : 1;
    const slopeMult = THREE.MathUtils.clamp(1 - this.grade * 0.9, 0.55, 1.1);
    const speed = (this.crouching ? 1.8 : this.sprinting ? 6.4 : 3.4) * this.speedMult * analog * dirMult * slopeMult * (1 - this.stumble * 0.6);
    const tx = moving ? dirX * speed : 0, tz = moving ? dirZ * speed : 0;

    // acceleration-limited ground movement: a body has mass, it takes a moment to get going and to
    // stop. In the air there's nothing to push against — momentum carries, with only a little steering.
    let dvx = tx - this.velocity.x, dvz = tz - this.velocity.z;
    const dv = Math.hypot(dvx, dvz);
    if (dv > 1e-5) {
      const hs0 = Math.hypot(this.velocity.x, this.velocity.z);
      const braking = !moving || tx * this.velocity.x + tz * this.velocity.z < 0;
      const accel = this.grounded
        ? braking ? GROUND_DECEL : THREE.MathUtils.lerp(GROUND_ACCEL, SPRINT_ACCEL, THREE.MathUtils.clamp((hs0 - 3.4) / 3, 0, 1))
        : moving ? AIR_ACCEL : 0;
      const k = Math.min(1, (accel * dt) / dv);
      dvx *= k; dvz *= k;
      this.velocity.x += dvx;
      this.velocity.z += dvz;
    }

    // jump with coyote time + buffer; a landing needs a beat of recovery before the next jump
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = input.actPressed('jump') && !this.frozen ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    this.recover = Math.max(0, this.recover - dt);
    this.stumble = Math.max(0, this.stumble - dt * 1.4);
    let jumped = false;
    // stamina: ~14 s of flat-out sprinting, back in ~5 s standing still (slower on the move)
    const hsNow = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.sprinting && hsNow > 4) this.stamina -= dt / 14;
    else this.stamina += dt * (hsNow < 0.5 ? 0.2 : this.crouching ? 0.15 : 0.11);
    this.stamina = THREE.MathUtils.clamp(this.stamina, 0, 1);
    if (this.stamina <= 0) this.winded = true;
    else if (this.winded && this.stamina > 0.4) this.winded = false;
    this.exertion = damp(this.exertion, THREE.MathUtils.clamp((0.92 - this.stamina) * 1.4 + (this.sprinting ? 0.15 : 0), 0, 1), this.exertion < 0.1 ? 0.8 : 1.6, dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching && this.recover <= 0) {
      this.stamina = Math.max(0, this.stamina - 0.03);
      this.velocity.y = JUMP_SPEED * (1 - this.stumble * 0.5) * (this.winded ? 0.85 : 1);
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.grounded = false;
      this.snapping = false;
      jumped = true;
      this.onJump?.();
    }
    // walking off an edge: the fall starts from rest, not at the ground-snap velocity
    if (!this.grounded && this.snapping) { this.velocity.y = 0; this.snapping = false; }
    // gravity + quadratic air drag (terminal velocity ≈ 55 m/s for a person)
    this.velocity.y -= GRAVITY * dt;
    if (!this.grounded) {
      const v = this.velocity.length();
      const drag = Math.min(1, DRAG * v * dt);
      this.velocity.multiplyScalar(1 - drag);
    }
    if (this.grounded && this.velocity.y < 0 && !jumped) { this.velocity.y = -2; this.snapping = true; }

    // on the ground, snapToGround keeps the feet planted. Pushing down into a slope instead makes the
    // controller slide that push along it, i.e. downhill, every frame (it read as an invisible wall uphill)
    const desired = { x: this.velocity.x * dt, y: this.snapping ? 0 : this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, this.physics.R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const prevVy = this.velocity.y;
    // still rising isn't standing: at high frame rates a frame of jump is less than the controller's
    // skin, so it reports "grounded" and the landing below would cancel the jump (no jumping at 144 Hz)
    this.grounded = this.controller.computedGrounded() && this.velocity.y <= 0;
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    if (dt > 0) {
      // blocked by a wall or a face too steep to climb: lose the velocity into it (no sticking, no
      // sliding back out). Ground contacts don't count, or every upslope would read as a wall.
      for (let i = 0, n = this.controller.numComputedCollisions(); i < n; i++) {
        const nrm = this.controller.computedCollision(i)?.normal1; // points from the obstacle to us
        if (!nrm || Math.abs(nrm.y) > WALL_NY) continue;
        const h = Math.hypot(nrm.x, nrm.z);
        if (h < 1e-4) continue;
        const nx = nrm.x / h, nz = nrm.z / h;
        const into = this.velocity.x * nx + this.velocity.z * nz;
        if (into < 0) { this.velocity.x -= into * nx; this.velocity.z -= into * nz; }
      }
      // pinned against something whose contact still reads as floor (the shoulder of a boulder):
      // slopes we can climb keep well over a quarter of the motion, so this is an obstacle too
      const ax = mv.x / dt, az = mv.z / dt;
      const want = Math.hypot(this.velocity.x, this.velocity.z);
      if (want > 0.5 && Math.hypot(ax, az) < want * 0.25) { this.velocity.x = ax; this.velocity.z = az; }
      // bumped your head
      if (this.velocity.y > 0 && mv.y / dt < this.velocity.y - 0.5) this.velocity.y = Math.max(0, mv.y / dt);
      // terrain grade along the direction of travel (rise / run), smoothed
      const run = Math.hypot(mv.x, mv.z);
      if (this.grounded && run > 0.004) this.grade = damp(this.grade, THREE.MathUtils.clamp(mv.y / run, -1, 1), 6, dt);
      else if (!this.grounded) this.grade = damp(this.grade, 0, 4, dt);
    }
    if (!wasGrounded && this.grounded) {
      const impact = -prevVy;
      if (impact > 2) {
        this.recover = 0.12 + Math.min(0.5, impact * 0.03);
        // a hard landing knocks the wind out of you: brief slowdown, scaled by the impact
        if (impact > 6) this.stumble = Math.min(1, (impact - 6) / 6 + 0.35);
        // horizontal momentum bleeds off on impact
        const keep = THREE.MathUtils.clamp(1 - (impact - 3) * 0.06, 0.45, 1);
        this.velocity.x *= keep; this.velocity.z *= keep;
      }
      this.velocity.y = -2;
      this.snapping = true;
      if (impact > 2.5) this.onLand?.(Math.min(1, impact / 14), impact);
    }
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
    // Stealth 3: a torch is a tell, not a flare.
    const light = !this.flashlight ? 1
      : this.stealthFocus === 'lowlight' ? 1.08
      : this.stealthRank >= 3 ? 1.25 : 1.6;
    let n: number;
    if (this.crouching) n = (0.45 + hs * 0.05) * (this.stealthRank >= 1 ? 0.7 : 1);
    else if (this.sprinting) n = 1.5 * (this.stealthRank >= 4 ? 0.65 : 1);
    else n = 0.75 + hs * 0.08;
    if (this.stealthRank >= 5) n *= 0.8;
    if (this.stealthFocus === 'still') n *= 0.82;
    return n * light;
  }
}
