import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, float, length, smoothstep, atan, time, sin, uniform } from 'three/tsl';
import { rustyMetal, glow, plainStandard } from '../world/materials';
import { lightCone } from '../world/effects';
import { canvasTexture } from '../world/kit';
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
  sparks: THREE.Points | null = null;

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
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    add(new THREE.SphereGeometry(0.42, 24, 16), shell, 0, 0, 0, 1, 0.42, 1.15);
    add(new THREE.TorusGeometry(0.42, 0.035, 8, 32), orange, 0, 0, 0, 1, 1, 1.15).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.18, 0.24, 0.12, 16), dark, 0, -0.17, 0.05);
    // eye
    this.eye = glow('#3ff2e0', 8);
    add(new THREE.SphereGeometry(0.11, 16, 12), dark, 0, -0.06, 0.42);
    add(new THREE.SphereGeometry(0.075, 16, 12), this.eye.material, 0, -0.06, 0.47);
    // arms + motors + rotors
    const rotorMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const spin = this.rotorSpin;
    rotorMat.colorNode = vec3(0.08, 0.08, 0.09);
    rotorMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const a = atan(p.y, p.x);
      const blades = smoothstep(0.6, 1.0, sin(a.mul(2).add(time.mul(spin).mul(70))).abs()).mul(0.5).add(0.18);
      return blades.mul(smoothstep(1.0, 0.92, r)).mul(smoothstep(0.08, 0.15, r)).mul(float(0.35).add(spin.mul(0.65)));
    })();
    for (const [x, z] of [[0.62, 0.52], [-0.62, 0.52], [0.62, -0.52], [-0.62, -0.52]]) {
      const arm = add(new THREE.BoxGeometry(0.06, 0.05, 0.72), shell, x / 2, 0.02, z / 2);
      arm.rotation.y = Math.atan2(x, z);
      add(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), dark, x, 0.05, z);
      const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), rotorMat);
      rotor.rotation.x = -Math.PI / 2;
      rotor.position.set(x, 0.12, z);
      this.body.add(rotor);
      this.rotors.push(rotor);
    }
    // antenna + battery screen
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 4), dark, -0.15, 0.3, -0.2);
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

  private moveToward(target: THREE.Vector3, speed: number, dt: number) {
    const d = target.clone().sub(this.position);
    const dist = d.length();
    const desired = dist > 0.01 ? d.multiplyScalar(Math.min(speed, dist * 2) / dist) : d.set(0, 0, 0);
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
        this.position.y = damp(this.position.y, hover - 1.3, 2, dt);
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
        this.position.addScaledVector(this.vel, dt);
        this.position.y = damp(this.position.y, this.groundY + 0.35, 3, dt);
        if (this.disabledFor <= 0) this.setState('patrol');
        break;
      }
    }
    // keep within the yard (plus margin)
    this.position.x = THREE.MathUtils.clamp(this.position.x, this.yard.min.x - 6, this.yard.max.x + 6);
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.yard.min.z - 6, this.yard.max.z + 6);
    if (this.state !== 'disabled' && this.state !== 'sputter') this.position.y = damp(this.position.y, hover + Math.sin(t * 1.7) * 0.12, 3, dt);

    // ---- visuals ----
    this.group.position.copy(this.position);
    const local = this.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.body.rotation.set(0, 0, 0);
    this.group.rotation.set(THREE.MathUtils.clamp(local.z * 0.08, -0.3, 0.3), this.yaw, THREE.MathUtils.clamp(-local.x * 0.08, -0.3, 0.3), 'YXZ');
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
    this.rotorSpin.value = damp(this.rotorSpin.value as number, this.state === 'disabled' ? 0.02 : this.state === 'sputter' ? 0.35 : 1, 3, dt);
    for (const r of this.rotors) r.rotation.z += dt * 40 * (this.rotorSpin.value as number);
    (this.screen.material as THREE.MeshStandardNodeMaterial).emissiveIntensity = Math.sin(t * 4) > 0 ? 1 : 0.25;
    void this.home;
  }
}
