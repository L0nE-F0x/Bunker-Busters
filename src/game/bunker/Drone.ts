import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, float, length, smoothstep, atan, time, sin, uniform, sign, positionLocal, mix, step } from 'three/tsl';
import { rustyMetal, glow, plainStandard } from '../world/materials';
import { lightCone, GlowSprites, type Sparks, type DustPuffs } from '../world/effects';
import { canvasTexture, MeshBatch, merge } from '../world/kit';
import { damp, dampAngle } from '@/engine/noise';
import type { Physics } from '@/engine/physics';

export type DroneState = 'patrol' | 'suspicious' | 'alert' | 'search' | 'sputter' | 'disabled';

const COLORS: Record<string, THREE.Color> = {
  calm: new THREE.Color('#3ff2e0'),
  sus: new THREE.Color('#ffb020'),
  alert: new THREE.Color('#ff2a2a'),
  off: new THREE.Color('#000000'),
};

export interface DroneSense {
  playerChest: THREE.Vector3;
  playerFeet: THREE.Vector3;
  noise: number; // 0.4 crouch … 1.5 sprint
  stealthMult: number; // archetype / skills
  playerCollider: unknown;
  night: number;
  insideHouse: boolean;
}

export interface DroneEvents {
  onStateChange?: (s: DroneState, prev: DroneState) => void;
  onZap?: () => void;
  onSputter?: () => void;
  /** Hit the ground with its rotors dead (k 0..1 = impact strength). */
  onCrash?: (k: number) => void;
}

/** SeedBot: refurbished guard drone with 12% battery health. */
export class Drone {
  group = new THREE.Group();
  private body = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private eye: ReturnType<typeof glow>;
  private spot: THREE.SpotLight;
  private cone: ReturnType<typeof lightCone>;
  private screen: THREE.Mesh;
  private rotorSpin = uniform(1);
  state: DroneState = 'patrol';
  detection = 0;
  position = new THREE.Vector3();
  yaw = 0;
  private vel = new THREE.Vector3();
  private vy = 0; // vertical speed from the thrust model
  private accS = new THREE.Vector3(); // smoothed horizontal acceleration (for banking)
  private prevVel = new THREE.Vector3();
  private crashTilt = new THREE.Vector2(); // resting lean after a crash landing
  private wp = 0;
  private stateTime = 0;
  private sputterTimer = 18 + Math.random() * 8;
  private disabledFor = 0;
  private lastSeen = new THREE.Vector3();
  private searchTarget = new THREE.Vector3();
  private zapCooldown = 0;
  private closeTime = 0;
  private colorNow = COLORS.calm.clone();
  private scanPhase = 0;
  readonly range = 15;
  readonly halfAngle = THREE.MathUtils.degToRad(38);
  canSee = false;
  /** shared FX (set by the owner): sparks for brown-outs / crashes / EMP, puffs for smoke */
  fx: { sparks?: Sparks; puffs?: DustPuffs } = {};
  private halos = new GlowSprites(6);
  private eyeW = [1, 0, 0];
  private uNav = uniform(new THREE.Vector2(1, 0));
  private fxTimer = 0;
  private empFlash = 0;

  constructor(
    private physics: Physics,
    private path: THREE.Vector3[],
    private home: THREE.Vector3,
    private house: THREE.Box3,
    private yard: THREE.Box3,
    private groundY: number,
    public events: DroneEvents = {},
  ) {
    this.position.copy(path[0]);
    const shell = rustyMetal({ base: '#e8e4da', rust: 0.18, metalness: 0.3, roughness: 0.4, rim: 0.6 });
    const orange = rustyMetal({ base: '#ff6a1a', rust: 0.15, metalness: 0.3, roughness: 0.4 });
    const dark = plainStandard('#1a1c1f', 0.4, 0.7);
    // static parts are merged per material (one draw call each instead of ~20 meshes)
    const mb = new MeshBatch();
    const P = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    mb.add(shell, P(new THREE.SphereGeometry(0.42, 24, 16), 0, 0, 0, 1, 0.42, 1.15));
    mb.add(orange, P(new THREE.TorusGeometry(0.42, 0.035, 8, 32), 0, 0, 0, 1, 1, 1.15, Math.PI / 2));
    mb.add(dark, P(new THREE.CylinderGeometry(0.18, 0.24, 0.12, 16), 0, -0.17, 0.05));
    // canopy seam + a sensor dome on top
    mb.add(dark, P(new THREE.TorusGeometry(0.3, 0.008, 4, 28), 0, 0.105, 0, 1, 1, 1.15, Math.PI / 2));
    mb.add(dark, P(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0.12, 0.16, 0.12));
    // eye socket (the glowing eye itself is a separate mesh: its colour follows the state)
    mb.add(dark, P(new THREE.SphereGeometry(0.11, 16, 12), 0, -0.06, 0.42));
    mb.add(orange, P(new THREE.TorusGeometry(0.1, 0.012, 6, 20), 0, -0.06, 0.49));
    this.eye = glow('#3ff2e0', 8);
    const eyeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), this.eye.material);
    eyeMesh.position.set(0, -0.06, 0.47);
    this.body.add(eyeMesh);
    // landing skids
    for (const sx of [-0.22, 0.22]) {
      mb.add(dark, P(new THREE.CylinderGeometry(0.015, 0.015, 0.62, 6), sx, -0.36, 0, 1, 1, 1, Math.PI / 2));
      for (const sz of [-0.16, 0.16]) mb.add(dark, P(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), sx * 0.8, -0.27, sz, 1, 1, 1, 0, 0, sx > 0 ? 0.35 : -0.35));
    }
    // arms, motors, rotor guards; the four rotor discs are one mesh animated in the shader
    const rotorMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const spin = this.rotorSpin;
    rotorMat.colorNode = vec3(0.08, 0.08, 0.09);
    rotorMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const a = atan(p.y, p.x);
      // neighbouring props counter-rotate
      const dir = sign(positionLocal.x.mul(positionLocal.z));
      const blades = smoothstep(0.6, 1.0, sin(a.mul(2).add(time.mul(spin).mul(70).mul(dir))).abs()).mul(0.5).add(0.18);
      return blades.mul(smoothstep(1.0, 0.92, r)).mul(smoothstep(0.08, 0.15, r)).mul(float(0.35).add(spin.mul(0.65)));
    })();
    const discs: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[0.62, 0.52], [-0.62, 0.52], [0.62, -0.52], [-0.62, -0.52]]) {
      mb.add(shell, P(new THREE.BoxGeometry(0.06, 0.05, 0.72), x / 2, 0.02, z / 2, 1, 1, 1, 0, Math.atan2(x, z)));
      mb.add(dark, P(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), x, 0.05, z));
      mb.add(orange, P(new THREE.TorusGeometry(0.37, 0.012, 4, 32), x, 0.12, z, 1, 1, 1, Math.PI / 2));
      mb.add(dark, P(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), x, 0.12, z));
      discs.push(P(new THREE.CircleGeometry(0.34, 24), x, 0.12, z, 1, 1, 1, -Math.PI / 2));
    }
    const rotors = new THREE.Mesh(merge(discs), rotorMat);
    this.body.add(rotors);
    this.rotors.push(rotors);
    // navigation lights: red port, green starboard, white tail strobe (one material, colour by side)
    const navMat = new THREE.MeshBasicNodeMaterial();
    const uNav = this.uNav;
    navMat.colorNode = Fn(() => {
      const pl = positionLocal;
      const side = mix(vec3(1.0, 0.05, 0.03), vec3(0.1, 1.0, 0.25), step(0, pl.x));
      const tail = step(pl.z, -0.3);
      return mix(side.mul(uNav.x), vec3(1, 1, 1).mul(uNav.y), tail).mul(6);
    })();
    const navGeo = [P(new THREE.SphereGeometry(0.025, 8, 6), -0.68, 0.05, 0.58), P(new THREE.SphereGeometry(0.025, 8, 6), 0.68, 0.05, 0.58), P(new THREE.SphereGeometry(0.022, 8, 6), 0, 0.1, -0.46)];
    const nav = new THREE.Mesh(merge(navGeo), navMat);
    this.body.add(nav);
    this.halos.add(new THREE.Vector3(-0.7, 0.05, 0.6), '#ff2010', 0.35, 1, 2.5);
    this.halos.add(new THREE.Vector3(0.7, 0.05, 0.6), '#20ff50', 0.35, 1, 2.5);
    this.halos.add(new THREE.Vector3(0, 0.1, -0.5), '#ffffff', 0.6, 2, 3);
    // eye halo: one per state colour, cross-faded through their channels
    this.halos.add(new THREE.Vector3(0, -0.06, 0.56), COLORS.calm, 0.8, 3, 1.8);
    this.halos.add(new THREE.Vector3(0, -0.06, 0.56), COLORS.sus, 0.8, 4, 1.8);
    this.halos.add(new THREE.Vector3(0, -0.06, 0.56), COLORS.alert, 0.9, 5, 2.2);
    mb.add(dark, P(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 4), -0.15, 0.3, -0.2)); // antenna
    const parts = mb.build('seedbot');
    for (const m of parts.children) m.castShadow = true;
    this.body.add(parts);
    this.body.add(this.halos.build());
    // battery screen
    const tex = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ff3a2a';
      ctx.lineWidth = 8;
      ctx.strokeRect(20, 24, 170, 80);
      ctx.fillRect(190, 48, 16, 32);
      ctx.fillStyle = '#ff3a2a';
      ctx.fillRect(28, 32, 22, 64);
      ctx.font = '700 44px "JetBrains Mono", monospace';
      ctx.fillText('12%', 70, 82);
    });
    const screenMat = new THREE.MeshStandardNodeMaterial({ color: 0x000000, emissiveMap: tex, emissive: new THREE.Color(2.5, 2.5, 2.5) });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), screenMat);
    this.screen.rotation.x = -Math.PI / 2 + 0.4;
    this.screen.position.set(0.0, 0.19, -0.18);
    this.body.add(this.screen);

    // spotlight + visible cone
    this.spot = new THREE.SpotLight(0xbff8ff, 60, this.range + 4, this.halfAngle, 0.45, 1.2);
    this.spot.castShadow = false;
    this.spot.position.set(0, -0.2, 0.25);
    this.body.add(this.spot);
    this.spot.target.position.set(0, -0.2 - Math.sin(0.45) * 6, 6);
    this.body.add(this.spot.target);
    this.cone = lightCone(this.range * 0.9, Math.tan(this.halfAngle) * this.range * 0.9, '#bff8ff', 0.35);
    this.cone.mesh.position.set(0, -0.2, 0.25);
    // aim cone along spot direction
    const dir = new THREE.Vector3(0, -Math.sin(0.45), Math.cos(0.45)).normalize();
    this.cone.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.body.add(this.cone.mesh);

    this.group.add(this.body);
    this.group.position.copy(this.position);
  }

  /** Forward look direction (pitched down) in world space. */
  get lookDir() {
    return new THREE.Vector3(Math.sin(this.yaw), -Math.sin(0.45), Math.cos(this.yaw)).normalize();
  }

  emp(duration: number) {
    this.empFlash = 1.6;
    this.fx.sparks?.emit(this.position, 40, 4, { up: 1.5, electric: true, size: 0.03, life: 0.6, floorY: this.groundY + 0.02, spread: 0.6 });
    this.setState('disabled');
    this.disabledFor = duration;
    this.detection = 0;
  }

  investigate(p: THREE.Vector3) {
    if (this.state === 'disabled' || this.state === 'alert') return;
    this.searchTarget.copy(p).setY(this.path[0].y);
    this.detection = Math.max(this.detection, 0.45);
    this.setState('search');
  }

  private setState(s: DroneState) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    this.events.onStateChange?.(s, prev);
  }

  /**
   * Vertical flight: lift comes from the rotors (∝ spin²) under a PD altitude controller, against
   * real gravity. Kill the rotors (EMP) and it drops like a stone, bounces, and comes to rest
   * tilted on the ground; a brownout leaves it sagging and wobbling on weak thrust.
   */
  private flyVertical(dt: number, targetY: number, t: number) {
    const g = 9.81;
    const spin = this.rotorSpin.value as number;
    const sputter = this.state === 'sputter';
    const goal = sputter ? targetY - 1.3 : targetY;
    const kp = sputter ? 6 : 14, kd = sputter ? 2.5 : 6.5;
    let thrust = g + kp * (goal - this.position.y) - kd * this.vy;
    if (sputter) thrust *= 0.75 + Math.sin(t * 9) * Math.sin(t * 3.3) * 0.35; // stuttering power
    thrust = THREE.MathUtils.clamp(thrust, 0, 2.2 * g * spin * spin);
    this.vy += (thrust - g) * dt - this.vy * Math.abs(this.vy) * 0.02 * dt;
    this.position.y += this.vy * dt;
    const floor = this.groundY + 0.35;
    if (this.position.y < floor) {
      this.position.y = floor;
      if (this.vy < -1.5) {
        this.events.onCrash?.(Math.min(1, -this.vy / 8));
        this.fx.sparks?.emit(this.position.clone().setY(this.groundY + 0.1), 18 + Math.round(-this.vy * 4), 3.5, { up: 1.2, floorY: this.groundY + 0.02, size: 0.025, life: 0.8, spread: 0.5 });
        // land on one skid: lean over a little, more for a harder hit
        const k = Math.min(1, -this.vy / 8);
        this.crashTilt.set((Math.random() - 0.5) * 0.5 * k, (Math.random() < 0.5 ? -1 : 1) * (0.15 + 0.25 * k));
        this.vel.multiplyScalar(0.3);
      }
      this.vy = this.vy < -1.5 ? -this.vy * 0.22 : Math.max(0, this.vy);
    }
    // righting itself once the rotors bite again
    if (spin > 0.5 && this.position.y > floor + 0.05) this.crashTilt.multiplyScalar(Math.exp(-4 * dt));
  }

  private moveToward(target: THREE.Vector3, speed: number, dt: number) {
    const d = target.clone().sub(this.position);
    const dist = d.length();
    const desired = dist > 0.01 ? d.multiplyScalar(Math.min(speed, dist * 2) / dist) : d.set(0, 0, 0);
    desired.y = 0; // altitude is the thrust model's job
    this.vel.lerp(desired, 1 - Math.exp(-3 * dt));
    this.position.addScaledVector(this.vel, dt);
    // stay out of the house volume (slide along walls)
    const hb = this.house;
    const p = this.position;
    if (p.x > hb.min.x && p.x < hb.max.x && p.z > hb.min.z && p.z < hb.max.z && p.y < hb.max.y + 0.6) {
      const dx0 = p.x - hb.min.x, dx1 = hb.max.x - p.x, dz0 = p.z - hb.min.z, dz1 = hb.max.z - p.z;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) p.x = hb.min.x; else if (m === dx1) p.x = hb.max.x; else if (m === dz0) p.z = hb.min.z; else p.z = hb.max.z;
    }
    return dist;
  }

  private faceToward(target: THREE.Vector3, rate: number, dt: number) {
    const a = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    this.yaw = dampAngle(this.yaw, a, rate, dt);
  }

  /** Line-of-sight + cone test. */
  private sees(s: DroneSense) {
    if (s.insideHouse) return false;
    const eye = this.position.clone().add(new THREE.Vector3(0, -0.2, 0));
    const to = s.playerChest.clone().sub(eye);
    const dist = to.length();
    const range = this.state === 'alert' ? this.range * 1.3 : this.range;
    if (dist > range) return false;
    to.normalize();
    // horizontal cone (more forgiving than a strict 3D cone so it reads well in game)
    const flatLook = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    const flatTo = new THREE.Vector2(to.x, to.z).normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(flatLook.dot(flatTo), -1, 1));
    const half = this.state === 'alert' ? this.halfAngle * 1.6 : this.halfAngle;
    if (ang > half && dist > 2.0) return false;
    const hit = this.physics.raycast(eye, to, dist, s.playerCollider as never);
    return hit === null || hit > dist - 0.4;
  }

  update(dt: number, s: DroneSense) {
    this.stateTime += dt;
    this.zapCooldown = Math.max(0, this.zapCooldown - dt);
    const t = performance.now() / 1000;

    // ---- perception ----
    const active = this.state !== 'disabled' && this.state !== 'sputter';
    this.canSee = active && this.sees(s);
    if (this.canSee) {
      const dist = this.position.distanceTo(s.playerChest);
      const closeness = THREE.MathUtils.clamp(1.25 - dist / this.range, 0.15, 1.25);
      const nightMod = 1 - s.night * 0.35;
      const rate = closeness * s.noise * s.stealthMult * nightMod * (this.state === 'alert' ? 3 : 0.85);
      this.detection = Math.min(1, this.detection + rate * dt);
      this.lastSeen.copy(s.playerFeet);
    } else {
      const decay = this.state === 'alert' ? 0.12 : 0.22;
      this.detection = Math.max(0, this.detection - decay * dt);
    }

    // ---- state machine ----
    const hover = this.path[0].y;
    switch (this.state) {
      case 'patrol': {
        const target = this.path[this.wp];
        if (this.moveToward(target, 2.6, dt) < 1.2) this.wp = (this.wp + 1) % this.path.length;
        this.scanPhase += dt * 0.9;
        const ahead = this.path[this.wp];
        const base = Math.atan2(ahead.x - this.position.x, ahead.z - this.position.z);
        this.yaw = dampAngle(this.yaw, base + Math.sin(this.scanPhase) * 0.7, 3, dt);
        this.sputterTimer -= dt;
        if (this.sputterTimer <= 0) {
          this.sputterTimer = 22 + Math.random() * 12;
          this.setState('sputter');
          this.events.onSputter?.();
        }
        if (this.detection > 0.3) this.setState('suspicious');
        break;
      }
      case 'sputter': {
        this.vel.multiplyScalar(Math.exp(-3 * dt));
        this.position.addScaledVector(this.vel, dt);
        if (this.stateTime > 4.5) this.setState('patrol');
        break;
      }
      case 'suspicious': {
        this.vel.multiplyScalar(Math.exp(-4 * dt));
        this.position.addScaledVector(this.vel, dt);
        this.faceToward(this.lastSeen, 4, dt);
        if (this.detection >= 1) this.setState('alert');
        else if (this.detection < 0.12) this.setState('patrol');
        else if (!this.canSee && this.stateTime > 1.5) {
          this.searchTarget.copy(this.lastSeen).setY(hover);
          this.setState('search');
        }
        break;
      }
      case 'alert': {
        const target = s.playerFeet.clone().setY(hover);
        const chase = this.canSee ? target : this.lastSeen.clone().setY(hover);
        if (s.insideHouse) {
          this.searchTarget.copy(this.lastSeen).setY(hover);
          this.setState('search');
          break;
        }
        this.moveToward(chase, 6.2, dt);
        this.faceToward(chase, 8, dt);
        const flatDist = Math.hypot(this.position.x - s.playerFeet.x, this.position.z - s.playerFeet.z);
        this.closeTime = this.canSee && flatDist < 3.6 ? this.closeTime + dt : 0;
        if (this.closeTime > 0.6 && this.zapCooldown <= 0) {
          this.zapCooldown = 4;
          this.closeTime = 0;
          this.events.onZap?.();
        }
        // give up if the player is far outside the yard
        const out = !this.yard.containsPoint(s.playerFeet.clone().setY(this.yard.min.y + 0.1));
        if (out && flatDist > 22) { this.searchTarget.copy(this.lastSeen).setY(hover); this.setState('search'); }
        if (!this.canSee && this.stateTime > 1 && this.detection < 0.6) {
          this.searchTarget.copy(this.lastSeen).setY(hover);
          this.setState('search');
        }
        break;
      }
      case 'search': {
        const d = this.moveToward(this.searchTarget, 3.4, dt);
        if (d < 1.5) this.yaw += dt * 1.6;
        else this.faceToward(this.searchTarget, 4, dt);
        if (this.detection >= 1) this.setState('alert');
        else if (this.canSee && this.detection > 0.5) this.setState('suspicious');
        if (this.stateTime > 9) { this.detection = Math.min(this.detection, 0.1); this.setState('patrol'); }
        break;
      }
      case 'disabled': {
        this.disabledFor -= dt;
        this.vel.multiplyScalar(Math.exp(-2 * dt));
        this.vel.y = 0;
        this.position.addScaledVector(this.vel, dt);
        if (this.disabledFor <= 0) this.setState('patrol');
        break;
      }
    }
    // keep within the yard (plus margin)
    this.position.x = THREE.MathUtils.clamp(this.position.x, this.yard.min.x - 6, this.yard.max.x + 6);
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.yard.min.z - 6, this.yard.max.z + 6);
    this.flyVertical(dt, hover + Math.sin(t * 1.7) * 0.12, t);

    // ---- visuals ----
    this.group.position.copy(this.position);
    const local = this.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.body.rotation.set(0, 0, 0);
    // a multirotor banks into its acceleration (plus a little to hold speed against drag)
    if (dt > 0) {
      const acc = _a.copy(this.vel).sub(this.prevVel).divideScalar(dt).setY(0);
      this.accS.lerp(acc, 1 - Math.exp(-6 * dt));
    }
    this.prevVel.copy(this.vel);
    const accL = _b.copy(this.accS).applyAxisAngle(_up, -this.yaw);
    const airborne = this.state !== 'disabled' || this.position.y > this.groundY + 0.45;
    const pitch = airborne ? THREE.MathUtils.clamp((accL.z + local.z * 0.5) * 0.06, -0.35, 0.35) : 0;
    const roll = airborne ? THREE.MathUtils.clamp(-(accL.x + local.x * 0.5) * 0.06, -0.35, 0.35) : 0;
    this.group.rotation.set(pitch + this.crashTilt.x, this.yaw, roll + this.crashTilt.y, 'YXZ');
    let colorKey = 'calm';
    if (this.state === 'alert') colorKey = 'alert';
    else if (this.state === 'suspicious' || this.state === 'search' || this.detection > 0.25) colorKey = 'sus';
    let power = 1;
    if (this.state === 'disabled') power = this.disabledFor < 1 ? (Math.sin(t * 30) > 0 ? 0.8 : 0) : 0;
    else if (this.state === 'sputter') power = Math.sin(t * 23) * Math.sin(t * 7) > 0.2 ? 0.6 : 0.05;
    this.colorNow.lerp(COLORS[colorKey], 1 - Math.exp(-8 * dt));
    (this.eye.color.value as THREE.Color).copy(this.colorNow);
    this.eye.intensity.value = 8 * power + (this.state === 'alert' ? Math.sin(t * 20) * 3 : 0);
    this.spot.color.copy(this.colorNow).lerp(new THREE.Color(1, 1, 1), 0.55);
    this.spot.intensity = 70 * power * (1 + s.night * 0.6);
    (this.cone.color.value as THREE.Color).copy(this.spot.color);
    this.cone.intensity.value = (0.18 + s.night * 0.4 + (this.state === 'alert' ? 0.25 : 0)) * power;
    this.rotorSpin.value = damp(this.rotorSpin.value as number, this.state === 'disabled' ? 0.02 : this.state === 'sputter' ? 0.7 : 1, 3, dt);
    (this.screen.material as THREE.MeshStandardNodeMaterial).emissiveIntensity = Math.sin(t * 4) > 0 ? 1 : 0.25;
    // nav lights, strobe and the eye halo
    const navOn = this.state === 'disabled' ? (this.disabledFor < 1 ? power : 0) : power > 0.1 ? 1 : 0.15;
    const strobe = (t % 1.3) < 0.07 ? navOn : 0;
    (this.uNav.value as THREE.Vector2).set(navOn * (0.75 + 0.25 * Math.sin(t * 3)), strobe);
    const ch = this.halos.channels;
    ch[1] = navOn;
    ch[2] = strobe;
    const target = colorKey === 'calm' ? 0 : colorKey === 'sus' ? 1 : 2;
    for (let i = 0; i < 3; i++) this.eyeW[i] = damp(this.eyeW[i], i === target ? 1 : 0, 8, dt);
    const eyeK = Math.max(0, this.eye.intensity.value as number) / 8;
    for (let i = 0; i < 3; i++) ch[3 + i] = this.eyeW[i] * eyeK;
    this.emitFx(dt);
    void this.home;
  }

  /** Sparks from a shorting motor during brown-outs, smoke + crackle while knocked out. */
  private emitFx(dt: number) {
    const { sparks, puffs } = this.fx;
    this.fxTimer -= dt;
    this.empFlash = Math.max(0, this.empFlash - dt);
    if (this.fxTimer > 0) return;
    this.group.updateMatrixWorld();
    const motor = () => {
      const m = MOTORS[Math.floor(Math.random() * 4)];
      return this.body.localToWorld(new THREE.Vector3(m[0], 0.06, m[1]));
    };
    if (this.state === 'sputter') {
      this.fxTimer = 0.08 + Math.random() * 0.3;
      if (Math.random() < 0.7) sparks?.emit(motor(), 6 + Math.floor(Math.random() * 8), 2.2, { up: 0.6, floorY: this.groundY + 0.02, size: 0.022, life: 0.55 });
      if (Math.random() < 0.25) puffs?.emit(motor(), 1, 0.15, 0.4, 0.25);
    } else if (this.state === 'disabled') {
      this.fxTimer = this.empFlash > 0 ? 0.07 : 0.28;
      const onGround = this.position.y < this.groundY + 0.6;
      if (this.empFlash > 0) {
        const p = this.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.3, (Math.random() - 0.5) * 0.9));
        sparks?.emit(p, 4 + Math.floor(Math.random() * 4), 1.6, { up: 0.5, electric: true, floorY: this.groundY + 0.02, size: 0.02, life: 0.35 });
      } else if (onGround && Math.random() < 0.15) {
        sparks?.emit(motor(), 3, 1.2, { up: 0.4, floorY: this.groundY + 0.02, size: 0.018, life: 0.4 });
      }
      if (onGround) puffs?.emit(this.position.clone().add(new THREE.Vector3(0, 0.15, 0)), 1, 0.08, 0.55, 0.3);
    } else this.fxTimer = 0.3;
  }
}

const MOTORS = [[0.62, 0.52], [-0.62, 0.52], [0.62, -0.52], [-0.62, -0.52]];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
