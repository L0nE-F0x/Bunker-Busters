import * as THREE from 'three/webgpu';
import { MeshBatch, shadowProxy } from '../../world/kit';
import { plainStandard, glow } from '../../world/materials';
import { laserMaterial } from '../../combat/Machines';
import { capsuleRay, sphereRay, type Combat, type Hostile, type HostileProvider, type RayHit, type Damage } from '../../combat/Combat';
import type { AudioEngine } from '@/engine/audio';
import type { Interactable } from '../../context';
import type { SentinelSpot } from './SpireBuilder';

/**
 * Careful Sentinels, the Spire's polite turrets. Unlike Kade's Compliance Sentry they keep to a
 * policy:
 * - seen with a weapon in hand (or carrying the plant's core, which counts as one), a sentinel
 *   apologises out loud first. The apology is a grace period: break its line of sight before it ends
 *   and it logs a near miss and goes back to scanning. Its length shrinks as the safety level rises,
 *   and during the pause there isn't one.
 * - seen unarmed, it never fires. It files a report instead (the safety level goes up) and watches.
 * - an EMP blinds it, a breaker on its back (Electronics 1) or Noor's test mode switches it off, and
 *   its eye is the weak point.
 * The Spire owns the rules round it (`SentinelHost`); this file is the machine.
 */

export interface SentinelHost {
  combat: Combat;
  audio: AudioEngine;
  /** A line out of this sentinel's speaker. */
  say(text: { speaker: string; text: string }, pos: THREE.Vector3): void;
  /** Seconds of apology right now (0 during the pause). */
  apology(): number;
  /** The player has a weapon out (or is carrying the core). */
  armed(): boolean;
  carrying(): boolean;
  paused(): boolean;
  skill(id: 'electronics'): number;
  xp(n: number, why: string): void;
  /** Policy events: an unarmed report, a near miss, being shot, switched off/destroyed. */
  onReport(s: Sentinel): void;
  onNearMiss(s: Sentinel): void;
  onShot(s: Sentinel): void;
  onOff(s: Sentinel, how: 'breaker' | 'dead'): void;
  lines: {
    sorry: { speaker: string; text: string }[];
    nearMiss: { speaker: string; text: string }[];
    unarmed: { speaker: string; text: string }[];
    paused: { speaker: string; text: string };
    core: { speaker: string; text: string };
    breaker: { speaker: string; text: string };
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Ring colours by state: resting terracotta, apologising amber, firing red, reporting white-blue, test green. */
const RING = { rest: '#d0704c', sorry: '#ffb340', fire: '#ff2a1e', report: '#cfe6ff', test: '#5fe08a', off: '#000000' };

export class Sentinel implements Hostile {
  readonly kind = 'turret' as const;
  readonly surface = 'metal' as const;
  readonly center = new THREE.Vector3();
  radius = 0.9;
  alive = true;
  hp = 120;
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  private barrel: THREE.Object3D;
  private eye: ReturnType<typeof glow>;
  private ring: ReturnType<typeof glow>;
  private laser: THREE.Mesh;
  private pivot = new THREE.Vector3();
  yaw: number;
  pitch = 0;
  state: 'scan' | 'sorry' | 'fire' | 'track' | 'report' | 'watch' | 'blind' | 'off' | 'dead' = 'scan';
  private stateT = 0;
  private scanT = Math.random() * 6;
  private seeT = 0;
  private lostT = 0;
  private fireT = 0;
  private burst = 0;
  private shotT = 0;
  private lineI = Math.floor(Math.random() * 4);
  private readonly lastSeen = new THREE.Vector3();
  /** Test mode (Noor) or a breaker: it stays off until `wake()`. */
  readonly breaker: Interactable;
  private extend = 0;
  readonly range: number;

  constructor(private host: SentinelHost, readonly spot: SentinelSpot, readonly label: string) {
    this.yaw = spot.yaw;
    this.range = spot.ceiling ? 13 : 30;
    const white = plainStandard('#f1eee8', 0.35, 0.15);
    const dark = plainStandard('#1b1b1c', 0.45, 0.4);
    const terra = plainStandard('#b9583a', 0.7, 0.02);
    // the mount: a short drum on the plinth, or a stem down from the ceiling
    const mb = new MeshBatch();
    if (spot.ceiling) {
      mb.add(white, new THREE.CylinderGeometry(0.22, 0.22, 0.06, 18).translate(0, -0.03, 0));
      mb.add(dark, new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8).translate(0, -0.25, 0));
    } else {
      mb.add(white, new THREE.CylinderGeometry(0.3, 0.34, 0.22, 20).translate(0, 0.11, 0));
      mb.add(terra, new THREE.CylinderGeometry(0.305, 0.305, 0.05, 20).translate(0, 0.2, 0));
      mb.add(dark, new THREE.BoxGeometry(0.2, 0.14, 0.04).translate(0, 0.1, -0.33)); // the breaker panel, at its back
    }
    const base = mb.build('sentinel:base');
    this.group.add(base);
    // the head: a white sphere with a dark visor band, the eye on the visor, a ring light round its neck
    const hb = new MeshBatch();
    hb.add(white, new THREE.SphereGeometry(0.3, 20, 14).scale(1, 0.86, 1.05));
    hb.add(dark, new THREE.CylinderGeometry(0.296, 0.296, 0.1, 24, 1, true, -1.0, 2.0).translate(0, 0.02, 0));
    hb.add(dark, new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0.0, 0.3));
    const headParts = hb.build('sentinel:head');
    this.head.add(headParts);
    this.eye = glow('#ffd0a8', 3);
    const eyeMesh = new THREE.Mesh(new THREE.CircleGeometry(0.035, 14), this.eye.material);
    eyeMesh.position.set(0, 0.03, 0.302);
    this.head.add(eyeMesh);
    this.ring = glow(RING.rest, 2.5);
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 28).rotateX(Math.PI / 2), this.ring.material);
    ringMesh.position.y = -0.24;
    this.head.add(ringMesh);
    // the barrel: tucked into the sphere at rest, slides out while it apologises
    const bb = new MeshBatch();
    bb.add(dark, new THREE.CylinderGeometry(0.03, 0.035, 0.52, 10).rotateX(Math.PI / 2).translate(0, 0, 0.26));
    bb.add(dark, new THREE.CylinderGeometry(0.042, 0.042, 0.06, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5));
    this.barrel = bb.build('sentinel:barrel');
    this.barrel.position.set(0, -0.09, -0.3);
    this.head.add(this.barrel);
    // a thin aim line while it fires
    const lg = new THREE.PlaneGeometry(1, 0.016).translate(0.5, 0, 0).rotateY(-Math.PI / 2);
    this.laser = new THREE.Mesh(lg, laserMaterial());
    this.laser.position.set(0, -0.09, 0.3);
    this.laser.frustumCulled = false;
    const lg2 = this.laser.clone();
    lg2.rotation.z = Math.PI / 2;
    lg2.position.set(0, 0, 0);
    this.laser.add(lg2);
    this.laser.visible = false;
    this.head.add(this.laser);
    this.head.position.set(0, spot.ceiling ? -0.62 : 0.5, 0);
    this.group.add(this.head);
    this.group.position.copy(spot.pos);
    this.pivot.copy(spot.pos).setY(spot.pos.y + (spot.ceiling ? -0.62 : 0.5));
    this.center.copy(this.pivot);
    for (const m of [base, headParts]) m.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    shadowProxy(base);
    shadowProxy(headParts);
    // the breaker on its back (floor ones only; the ceiling one is Noor's)
    const back = spot.pos.clone().add(_a.set(-Math.sin(spot.yaw) * 0.6, 0.2, -Math.cos(spot.yaw) * 0.6));
    this.breaker = {
      id: `sentinel:${spot.id}`,
      pos: back,
      radius: 1.5,
      visible: () => !spot.ceiling && this.alive && this.state !== 'off',
      primary: {
        label: `Pull ${label}'s breaker`,
        available: () => (this.host.skill('electronics') >= 1 ? (this.state === 'fire' || this.state === 'sorry' ? 'It\'s looking right at you' : true) : 'Needs Electronics 1'),
        run: () => {
          this.switchOff();
          this.host.say(this.host.lines.breaker, this.pivot);
          this.host.xp(25, `${label} switched off`);
          this.host.onOff(this, 'breaker');
        },
      },
    };
  }

  /** Off (a breaker, test mode, a saved flag). */
  switchOff() {
    if (!this.alive) return;
    this.state = 'off';
    this.host.audio.combat?.machine('down', this.pivot, 0.6);
  }

  /** Back on (a reload that cleared its flag). */
  wake() {
    if (this.alive && this.state === 'off') this.state = 'scan';
  }

  /** Dead from a save: no explosion, no XP. */
  kill() {
    this.alive = false;
    this.state = 'dead';
    this.hp = 0;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (!this.alive || !this.group.visible) return null;
    const eye = _a.set(0, 0.03, 0.3).applyMatrix4(this.head.matrixWorld);
    const te = sphereRay(o, d, eye, 0.08);
    const th = sphereRay(o, d, this.pivot, 0.32);
    const tb = this.spot.ceiling ? null : capsuleRay(o, d, _b.copy(this.group.position), _c.copy(this.group.position).setY(this.group.position.y + 0.25), 0.3);
    let best: RayHit | null = null;
    if (th !== null && th <= max) best = { t: th, zone: 'body' };
    if (tb !== null && tb <= max && (!best || tb < best.t)) best = { t: tb, zone: 'limb' };
    if (te !== null && te <= max && (!best || te <= best.t + 0.05)) best = { t: te, zone: 'head' };
    return best;
  }

  damage(d: Damage): boolean {
    if (!this.alive) return false;
    this.hp -= d.amount * (d.zone === 'head' ? 2 : d.zone === 'limb' ? 0.4 : 1) * (d.source === 'blast' ? 1.5 : 1);
    this.host.combat.sparks?.emit(d.point, 8, 3, { size: 0.02, life: 0.4, floorY: this.group.position.y - 1 });
    if (this.shotT <= 0) { this.shotT = 4; this.host.onShot(this); }
    if (this.state === 'scan' || this.state === 'watch' || this.state === 'report') { this.lastSeen.copy(this.host.combat.target.chest); this.startSorry(); }
    if (this.hp <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.host.combat.explode(this.pivot.clone(), 1.8, 15, { source: 'player', ignore: this });
      this.host.audio.combat?.machine('down', this.pivot, 1);
      this.host.xp(25, `${this.label} destroyed`);
      this.host.onOff(this, 'dead');
      return true;
    }
    return false;
  }

  emp(dur: number) {
    if (!this.alive || this.state === 'off') return;
    this.state = 'blind';
    this.stateT = dur;
    this.host.combat.sparks?.emit(this.pivot, 30, 3, { electric: true, size: 0.025, life: 0.5, floorY: this.group.position.y - 1 });
  }

  private sees(): boolean {
    const T = this.host.combat.target;
    if (!T.alive) return false;
    const to = _a.subVectors(T.chest, this.pivot);
    const d = to.length();
    const dark = T.night > 0.5 && !T.torch ? 0.55 + 0.45 * T.light : 1;
    if (d > this.range * (0.4 + 0.6 * T.visibility) * (this.spot.ceiling ? 1 : dark)) return false;
    const look = this.state === 'scan' ? 0.7 : 1.3;
    const yawTo = Math.atan2(to.x, to.z);
    if (Math.abs(angDiff(this.yaw, yawTo)) > look && d > 2) return false;
    if (!this.spot.ceiling && Math.abs(angDiff(this.spot.yaw, yawTo)) > 2.2) return false;
    return this.host.combat.clearLine(_b.copy(this.pivot), T.chest, T.collider);
  }

  private say(lines: { speaker: string; text: string }[]) {
    this.host.say(lines[this.lineI++ % lines.length], this.pivot);
  }

  /** Seen with a weapon: apologise (or, paused, don't). */
  private startSorry() {
    const host = this.host;
    const t = host.apology();
    if (t <= 0) {
      this.state = 'fire';
      this.fireT = 0.25;
      this.burst = 0;
      host.say(host.lines.paused, this.pivot);
      host.audio.combat?.machine('spinup', this.pivot, 1);
      return;
    }
    this.state = 'sorry';
    this.stateT = t;
    this.lostT = 0;
    host.audio.combat?.machine('chime', this.pivot, 1);
    if (host.carrying()) host.say(host.lines.core, this.pivot);
    else this.say(host.lines.sorry);
  }

  update(dt: number) {
    if (!this.group.visible) return;
    const host = this.host, T = host.combat.target;
    this.stateT -= dt;
    this.shotT -= dt;
    let ring = RING.rest, ringK = 2.5, eyeK = 3, laser = 0, out = 0;
    const armed = host.armed();
    switch (this.state) {
      case 'scan': {
        this.scanT += dt;
        const target = this.spot.yaw + Math.sin(this.scanT * 0.5) * 0.95;
        this.yaw += angDiff(this.yaw, target) * Math.min(1, dt * 2);
        this.pitch += (-0.08 - this.pitch) * Math.min(1, dt * 2);
        if (this.stateT > 0) break; // just logged something: a beat before it looks again
        if (this.sees()) {
          this.seeT += dt;
          if (this.seeT > 0.3 / host.combat.diff.react) {
            this.seeT = 0;
            this.lastSeen.copy(T.chest);
            if (armed) this.startSorry();
            else {
              this.state = 'report';
              this.stateT = 1.6;
              host.audio.combat?.machine('chime', this.pivot, 0.6);
              this.say(host.lines.unarmed);
            }
          }
        } else this.seeT = 0;
        break;
      }
      case 'report':
      case 'watch':
      case 'sorry':
      case 'fire':
      case 'track': {
        const see = this.sees();
        if (see) { this.lastSeen.copy(T.chest); this.lostT = 0; } else this.lostT += dt;
        const to = _a.subVectors(this.lastSeen, this.pivot);
        this.yaw += angDiff(this.yaw, Math.atan2(to.x, to.z)) * Math.min(1, dt * 5);
        this.pitch += (Math.atan2(to.y, Math.hypot(to.x, to.z)) - this.pitch) * Math.min(1, dt * 5);
        if (this.state === 'report' || this.state === 'watch') {
          ring = RING.report;
          if (this.state === 'report' && this.stateT <= 0) { host.onReport(this); this.state = 'watch'; this.stateT = 10; }
          // a weapon comes out while it's watching you: now it apologises
          if (armed && see) { this.startSorry(); break; }
          if (this.state === 'watch' && (this.stateT <= 0 || this.lostT > 3)) { this.state = 'scan'; this.stateT = 2; }
          break;
        }
        if (this.state === 'sorry') {
          ring = RING.sorry;
          out = 1;
          eyeK = 5;
          if (!armed && !host.carrying()) { this.state = 'watch'; this.stateT = 6; break; }
          if (this.lostT > 0.6) {
            this.say(host.lines.nearMiss);
            host.onNearMiss(this);
            this.state = 'scan';
            this.stateT = 3;
            break;
          }
          if (this.stateT <= 0) {
            this.state = see ? 'fire' : 'track';
            this.stateT = 3;
            this.fireT = 0.2;
            this.burst = 0;
            host.audio.combat?.machine('spinup', this.pivot, 1);
          }
          break;
        }
        ring = RING.fire;
        out = 1;
        laser = 1.4;
        eyeK = 6;
        if (!armed && !host.carrying()) { this.state = 'watch'; this.stateT = 6; break; }
        if (this.state === 'fire') {
          if (!see) { this.state = 'track'; this.stateT = 3; break; }
          this.fireT -= dt;
          if (this.fireT <= 0 && this.extend > 0.9) {
            const muzzle = _b.set(0, -0.09, 0.56).applyMatrix4(this.head.matrixWorld).clone();
            host.combat.enemyRound(muzzle, T.chest, 0.03 / host.combat.diff.aim, 7, 'turret');
            host.combat.enemyFlash(muzzle, _c.subVectors(T.chest, muzzle).normalize(), 0.6);
            host.audio.combat?.gunshot('turret', muzzle);
            host.combat.noise(this.pivot, 90, 'gunshot');
            this.burst++;
            this.fireT = this.burst % 4 === 0 ? 1.0 : 0.13;
          }
        } else if (see) { this.state = 'fire'; this.fireT = 0.3; } else if (this.stateT <= 0) { this.state = 'scan'; this.stateT = 2; }
        break;
      }
      case 'blind':
        eyeK = Math.random() < 0.3 ? 2 : 0;
        ring = '#7fe8ff';
        ringK = Math.random() < 0.3 ? 2 : 0.4;
        this.pitch += (-0.4 - this.pitch) * Math.min(1, dt * 3);
        if (this.stateT <= 0) this.state = 'scan';
        break;
      case 'off':
        eyeK = 0;
        ring = RING.test;
        ringK = 0.6;
        this.pitch += (-0.5 - this.pitch) * Math.min(1, dt * 2);
        break;
      case 'dead':
        eyeK = 0;
        ringK = 0;
        this.pitch += (-0.7 - this.pitch) * Math.min(1, dt * 4);
        if (Math.random() < dt * 2) host.combat.debris.emit('smoke', this.pivot, 1, _a.set(0, 0.6, 0), 0.2, 0.25, undefined, 0.6);
        break;
    }
    this.extend += (out - this.extend) * Math.min(1, dt * 4);
    this.barrel.position.z = -0.3 + this.extend * 0.3;
    this.head.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    (this.ring.color.value as THREE.Color).set(ring);
    this.ring.intensity.value = ringK;
    this.eye.intensity.value = eyeK;
    this.laser.visible = laser > 0;
    if (laser > 0) {
      this.head.updateMatrixWorld();
      const from = _a.set(0, -0.09, 0.58).applyMatrix4(this.head.matrixWorld);
      const dir = _b.set(0, 0, 1).transformDirection(this.head.matrixWorld);
      const hit = host.combat.worldRay(_c.copy(from).addScaledVector(dir, 0.3), dir, 40);
      this.laser.scale.set(laser, laser, (hit ? hit.t : 40) + 0.3);
    }
  }
}

/** The Spire's sentinels as one hostile provider (Game registers it with Combat). */
export class Sentinels implements HostileProvider {
  readonly group = new THREE.Group();
  readonly list: Sentinel[] = [];

  constructor(host: SentinelHost, spots: SentinelSpot[], labels: Record<string, string>) {
    this.group.name = 'sentinels';
    for (const spot of spots) {
      const s = new Sentinel(host, spot, labels[spot.id] ?? spot.id);
      this.list.push(s);
      this.group.add(s.group);
    }
  }

  hostiles() {
    return this.list;
  }

  get(id: string) {
    return this.list.find((s) => s.spot.id === id);
  }

  /** EMP at `pos`: sentinels in reach go blind. */
  emp(pos: THREE.Vector3, radius: number, dur: number) {
    let any = false;
    for (const s of this.list) if (s.alive && s.center.distanceTo(pos) < radius + 0.5) { s.emp(dur); any = true; }
    return any;
  }

  update(dt: number, cam: THREE.Vector3) {
    for (const s of this.list) {
      const d = cam.distanceTo(s.center);
      s.group.visible = d < 160;
      s.update(dt);
    }
  }
}
