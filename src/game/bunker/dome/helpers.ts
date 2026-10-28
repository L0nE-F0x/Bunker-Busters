import * as THREE from 'three/webgpu';
import { capsuleRay, sphereRay, type Combat, type Hostile, type HostileProvider, type RayHit, type Damage } from '../../combat/Combat';
import { viewCull } from '../../world/kit';
import type { NpcActor } from '../../world/npcSkin';
import type { AudioEngine } from '@/engine/audio';

type Line = { speaker: string; text: string };

/** What the Helpers ask of the Dome. */
export interface HelperHost {
  combat: Combat;
  audio: AudioEngine;
  say(line: Line, pos: THREE.Vector3): void;
  /** Ground height under (x, z) for a Helper at y (the dome's floor, the yard's terrain). */
  floor(x: number, z: number, y: number): number;
  /** The patches that matter to them. */
  thermal(): boolean;
  shielded(): boolean;
  armoured(): boolean;
  /** Off for good (the plug pulled) or friendly (the new job): no chasing. */
  standDown(): 'no' | 'off' | 'friendly';
  /** Sight range multiplier for the player right now (stealth skill, archetype, darkness outside). */
  sight(inside: boolean): number;
  insideDome(p: THREE.Vector3): boolean;
  onNotice(h: Helper): void;
  onCatch(h: Helper): void;
  onShot(h: Helper): void;
  onDown(h: Helper, how: 'shot' | 'emp'): void;
  onSlip(h: Helper): void;
  lines: { notice: Line[]; lost: Line[]; catch: Line[]; down: Line; shielded: Line; armoured: Line };
}

const WALK = 1.3, CHASE = 2.2, CATCH = 1.25, CONE = Math.cos(THREE.MathUtils.degToRad(55));
/** The walk clip's own ground speed at 1× (measured: a planted foot stays put at this; at 1× on the 1.3 m/s patrol the feet slid 0.4 m/s). */
const WALK_CLIP = 1.6;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * One Ascend Helper: a humanoid service robot (the Meshy model through an NpcActor) walking its
 * route there and back. It sees in a cone (range from the host: crouching and darkness shorten it,
 * unless thermal is patched in), notices, walks briskly to you, and if it reaches you the Dome walks
 * you out. Shot enough (or EMP'd) it falls over and reboots later, out of your sight. Never hurts you.
 */
export class Helper implements Hostile {
  readonly kind = 'turret' as const;
  readonly surface = 'metal' as const;
  alive = true;
  readonly center = new THREE.Vector3();
  radius = 1.0;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  state: 'patrol' | 'pause' | 'notice' | 'chase' | 'back' | 'down' | 'off' = 'patrol';
  /** 0..1: how sure it is it has seen you. */
  seen = 0;
  hp = 60;
  private seg = 0;
  private dir = 1;
  private t = 0;
  private downT = 0;
  private slipT = 0;
  private trail: THREE.Vector3[] = [];
  private lastSeen = new THREE.Vector3();
  private moving = false;
  private animMoving: boolean | null = null;
  private shotLine = 0;

  constructor(readonly id: string, readonly inside: boolean, readonly route: THREE.Vector3[], readonly actor: NpcActor | null, readonly root: THREE.Object3D, private host: HelperHost) {
    this.pos.copy(route[0]);
    this.pos.y = host.floor(this.pos.x, this.pos.z, this.pos.y + 1);
    this.seg = 0;
    this.face(route[1] ?? route[0], 1);
    this.place();
  }

  private face(target: THREE.Vector3, k: number) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, k);
  }

  private place() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.center.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  /** Walk toward `p` at `speed`; true once there. */
  private step(p: THREE.Vector3, speed: number, dt: number) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    this.face(p, dt * 6);
    if (d < 0.15) return true;
    const s = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * s;
    this.pos.z += (dz / d) * s;
    this.pos.y = this.host.floor(this.pos.x, this.pos.z, this.pos.y + 1);
    this.moving = true;
    this.actor?.matchSpeed(speed, WALK_CLIP);
    return false;
  }

  /** Can it see the player's chest from its eyes right now (cone, range, clear line)? */
  private sees(chest: THREE.Vector3, range: number) {
    const eye = _a.set(this.pos.x, this.pos.y + 1.65, this.pos.z);
    const to = _b.subVectors(chest, eye);
    const d = to.length();
    if (d > range) return 0;
    to.divideScalar(d);
    const fwd = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const cos = to.x * fwd.x + to.z * fwd.z;
    if (cos < CONE && d > 2.2) return 0;
    if (!this.host.combat.clearLine(eye, chest, this.host.combat.target.collider)) return 0;
    return 1 - (d / range) * 0.6;
  }

  update(dt: number, feet: THREE.Vector3, chest: THREE.Vector3, crouch: boolean, playerHidden: boolean) {
    this.t += dt;
    this.moving = false;
    const host = this.host;
    const stand = host.standDown();
    if (stand === 'off') {
      if (this.state !== 'off') { this.state = 'off'; this.alive = false; this.actor?.play('fall', true); }
      this.place();
      return;
    }
    this.slipT = Math.max(0, this.slipT - dt);
    if (this.state === 'down') {
      this.downT -= dt;
      // reboot once its time is up and you aren't looking (or long after, regardless)
      if (this.downT <= 0 && (!viewCull.sees(this.center, 1.2) || this.downT < -25)) {
        this.state = 'back';
        this.alive = true;
        this.hp = 60;
        this.seen = 0;
        this.animMoving = null;
      }
      this.place();
      return;
    }
    const friendly = stand === 'friendly';
    // sight
    const inside = host.insideDome(feet);
    const sameSide = inside === this.inside || feet.distanceTo(this.pos) < 8;
    const range = (this.inside ? 12 : 15) * host.sight(this.inside) * (crouch && !host.thermal() ? 0.55 : 1);
    const v = friendly || playerHidden || !sameSide ? 0 : this.sees(chest, range);
    if (v > 0) {
      this.lastSeen.copy(feet);
      this.seen = Math.min(1, this.seen + dt * v * (crouch ? 1.0 : 1.7));
    } else this.seen = Math.max(0, this.seen - dt * 0.35);
    // slipping past close by, crouched and unseen: the Dome learns that too
    const near = Math.hypot(feet.x - this.pos.x, feet.z - this.pos.z);
    if (!friendly && crouch && near < 4 && this.seen < 0.3 && this.slipT <= 0 && sameSide && this.state !== 'chase') {
      this.slipT = 25;
      host.onSlip(this);
    }

    switch (this.state) {
      case 'patrol': {
        const target = this.route[this.seg + this.dir] ?? null;
        if (!target) { this.state = 'pause'; this.t = 0; break; }
        if (this.step(target, WALK, dt)) {
          this.seg += this.dir;
          if (!this.route[this.seg + this.dir]) { this.state = 'pause'; this.t = 0; }
        }
        if (this.seen >= 1) this.notice();
        break;
      }
      case 'pause': {
        if (this.t > 2.5 + (this.id.charCodeAt(1) % 3)) { this.dir = -this.dir; this.state = 'patrol'; }
        if (this.seen >= 1) this.notice();
        break;
      }
      case 'notice': {
        this.face(this.lastSeen, dt * 5);
        if (this.t > 0.7) { this.state = 'chase'; this.t = 0; this.trail = [this.pos.clone()]; }
        break;
      }
      case 'chase': {
        const go = v > 0 ? feet : this.lastSeen;
        this.step(go, CHASE, dt);
        const last = this.trail[this.trail.length - 1];
        if (!last || last.distanceTo(this.pos) > 0.6) this.trail.push(this.pos.clone());
        if (v > 0 && near < CATCH) {
          this.state = 'back';
          host.onCatch(this);
          break;
        }
        // lost you: look round where it saw you last, then go home
        if (v <= 0 && this.pos.distanceTo(_d.copy(this.lastSeen).setY(this.pos.y)) < 0.6) {
          this.state = 'back';
          host.say(host.lines.lost[Math.floor(Math.random() * host.lines.lost.length)], this.center);
        }
        if (this.t > 30) this.state = 'back';
        break;
      }
      case 'back': {
        const p = this.trail[this.trail.length - 1];
        if (!p) {
          // the nearest point on its route, then carry on
          let best = 0, bd = Infinity;
          this.route.forEach((r, i) => { const d = r.distanceTo(this.pos); if (d < bd) { bd = d; best = i; } });
          if (this.step(this.route[best], WALK, dt)) { this.seg = best; this.state = 'patrol'; this.seen = 0; }
        } else if (this.step(p, WALK, dt)) this.trail.pop();
        if (this.seen >= 1) this.notice();
        break;
      }
    }
    // the walk clip while it moves, the idle while it stands
    if (this.moving !== this.animMoving) {
      this.animMoving = this.moving;
      this.actor?.setIdle([this.moving ? 'walk' : 'idle']);
      if (!this.moving && this.actor) this.actor.pace = 1;
    }
    this.place();
  }

  private notice() {
    this.state = 'notice';
    this.t = 0;
    this.host.say(this.host.lines.notice[Math.floor(Math.random() * this.host.lines.notice.length)], this.center);
    this.host.onNotice(this);
  }

  /** The alarm: go and look at `p`. */
  investigate(p: THREE.Vector3) {
    if (this.state !== 'patrol' && this.state !== 'pause' && this.state !== 'back') return;
    // it walks there in a straight line, so only where nothing solid is in the way (a Doorman walked
    // through Zero's shut clock gate; the yard's technicians through the curtain wall to the pump house).
    // Stops short of the spot itself: an alarm on a wall (a camera) would block its own line
    const to = _c.set(p.x, this.center.y, p.z), len = this.center.distanceTo(to);
    if (len > 1 && !this.host.combat.clearLine(this.center, _d.subVectors(to, this.center).multiplyScalar((len - 0.8) / len).add(this.center))) return;
    this.lastSeen.copy(p);
    this.state = 'chase';
    this.t = 0;
    this.trail = [this.pos.clone()];
  }

  /** Everyone back on their routes (after a catch). */
  reset() {
    if (this.state === 'down' || this.state === 'off') return;
    this.state = 'back';
    this.seen = 0;
  }

  /** Power back on after `standDown` said 'off' (Bunker Zero's board): it gets up and goes back to its route. */
  wake() {
    if (this.state !== 'off') return;
    this.state = 'back';
    this.alive = true;
    this.hp = 60;
    this.seen = 0;
    this.trail = [];
    this.animMoving = null;
  }

  /** Drop it where it stands (shot, EMP). */
  knock(how: 'shot' | 'emp', dur: number) {
    if (this.state === 'down' || this.state === 'off') return;
    this.state = 'down';
    this.alive = how === 'emp';
    this.downT = dur;
    this.seen = 0;
    this.actor?.play('fall', true);
    this.host.audio.combat?.machine('down', this.center, 0.6);
    this.host.say(this.host.lines.down, this.center);
    this.host.onDown(this, how);
  }

  // ------------------------------------------------------------------ Hostile
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): RayHit | null {
    if (this.state === 'down' || this.state === 'off' || !this.root.visible) return null;
    const head = _a.set(this.pos.x, this.pos.y + 1.68, this.pos.z);
    const th = sphereRay(o, d, head, 0.16);
    const tb = capsuleRay(o, d, _b.set(this.pos.x, this.pos.y + 0.95, this.pos.z), _c.set(this.pos.x, this.pos.y + 1.45, this.pos.z), 0.27);
    const tl = capsuleRay(o, d, _d.set(this.pos.x, this.pos.y + 0.1, this.pos.z), _c.set(this.pos.x, this.pos.y + 0.9, this.pos.z), 0.2);
    let best: RayHit | null = null;
    if (tb !== null && tb <= max) best = { t: tb, zone: 'body' };
    if (tl !== null && tl <= max && (!best || tl < best.t)) best = { t: tl, zone: 'limb' };
    if (th !== null && th <= max && (!best || th <= best.t + 0.05)) best = { t: th, zone: 'head' };
    return best;
  }

  damage(d: Damage): boolean {
    if (this.state === 'down' || this.state === 'off') return false;
    this.host.combat.sparks?.emit(d.point, 8, 3, { size: 0.02, life: 0.4, floorY: this.pos.y });
    if (this.host.armoured() && d.source === 'player') {
      if (this.t - this.shotLine > 4) { this.shotLine = this.t; this.host.say(this.host.lines.armoured, this.center); }
      return false;
    }
    this.host.onShot(this);
    this.hp -= d.amount * (d.zone === 'head' ? 2 : d.zone === 'limb' ? 0.5 : 1);
    if (this.hp <= 0) { this.knock('shot', 35); return true; }
    if (this.state !== 'chase') { this.lastSeen.copy(this.host.combat.target.feet); this.notice(); }
    return false;
  }

  unaware() {
    return this.state === 'patrol' || this.state === 'pause';
  }

  facing() {
    return _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  awareness() {
    return this.state === 'chase' || this.state === 'notice' ? 1 : this.seen * 0.8;
  }

  shootable() {
    return this.state !== 'down' && this.state !== 'off';
  }
}

/** The Dome's Helpers, as one hostile provider. */
export class Helpers implements HostileProvider {
  readonly list: Helper[] = [];

  hostiles() {
    return this.list;
  }

  get(id: string) {
    return this.list.find((h) => h.id === id);
  }

  update(dt: number, feet: THREE.Vector3, chest: THREE.Vector3, crouch: boolean, hidden: boolean, near: boolean) {
    for (const h of this.list) {
      if (near) h.update(dt, feet, chest, crouch, hidden);
      // their models: posed only while they could be seen
      const show = near && viewCull.sees(h.center, 1.2);
      h.root.visible = near;
      if (show && h.actor) h.actor.update(dt, false, 0, 0);
    }
  }

  /** An EMP at `pos` (radius `r`): Helpers inside it drop for `dur` s. True if any did. */
  emp(pos: THREE.Vector3, r: number, dur: number, shielded: boolean, say: (h: Helper) => void) {
    let hit = false;
    for (const h of this.list) {
      if (h.state === 'down' || h.state === 'off' || h.center.distanceTo(pos) > r) continue;
      if (shielded) { say(h); continue; }
      h.knock('emp', dur);
      hit = true;
    }
    return hit;
  }

  resetAll() {
    for (const h of this.list) h.reset();
  }
}
