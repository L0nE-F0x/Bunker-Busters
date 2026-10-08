import * as THREE from 'three/webgpu';
import { XP_REWARDS } from '@/content/progression';
import type { BunkerSecurity } from '@/content/types';
import type { GameContext, Interactable } from '../context';
import type { Bunker } from './Bunker';
import type { Laser, SecurityCamera, Tripwire } from './shell';
import { isTouch } from '@/engine/device';

/**
 * The bunker runtime's hazards. Each one is driven by `Bunker` (flags, interactables, per-frame)
 * and reports through it (`triggerAlarm`, `flag`). Geometry is the builder's.
 */

type Player = GameContext['player'];
const CROUCH_KEY = isTouch ? 'crouch' : 'crouch [C]';
const crouchText = (t: string) => t.replace('{crouch}', CROUCH_KEY);

function segIntersect(p1: THREE.Vector2, p2: THREE.Vector2, q1: THREE.Vector2, q2: THREE.Vector2) {
  const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
  const v = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/**
 * Tin-can tripwires: crossing one standing (feet path vs the wire, on the ground) rings the alarm;
 * crouched you step over. Disarm (Electronics) or yank (Demolition; quiet at 4 when crouched).
 * Flag: `<bunker>.<wire>.disarmed`.
 */
export class Tripwires {
  private cooldown: Record<string, number> = {};
  private shownHint = false;
  private readonly a2 = new THREE.Vector2();
  private readonly b2 = new THREE.Vector2();

  constructor(private bunker: Bunker, readonly wires: Tripwire[], private text: NonNullable<BunkerSecurity['tripwires']>) {}

  private get s() {
    return this.bunker.state;
  }

  applyFlags(has: (f: string) => boolean) {
    for (const tw of this.wires) {
      tw.armed = !has(this.bunker.flag(`${tw.id}.disarmed`));
      tw.mesh.visible = tw.armed;
    }
  }

  interactables(): Interactable[] {
    const { text } = this;
    return this.wires.map((tw) => ({
      id: tw.id,
      pos: tw.a.clone().lerp(tw.b, 0.5),
      radius: 2.4,
      visible: () => tw.armed,
      primary: {
        label: text.disarm.label,
        available: () => (this.s.skill('electronics') >= text.disarm.electronics ? true : crouchText(text.disarm.lacking)),
        run: () => {
          tw.armed = false;
          tw.mesh.visible = false;
          this.s.set(this.bunker.flag(`${tw.id}.disarmed`));
          this.bunker.ctx.audio.play('disarm');
          this.s.addXP(XP_REWARDS.tripwireDisarmed, 'Tripwire disarmed');
        },
      },
      secondary: {
        label: text.yank.label,
        available: () => (this.s.skill('demolition') >= text.yank.demolition ? true : crouchText(text.yank.lacking)),
        run: () => this.yank(tw),
      },
    }));
  }

  private yank(tw: Tripwire) {
    const { ctx } = this.bunker;
    tw.armed = false;
    tw.mesh.visible = false;
    this.s.set(this.bunker.flag(`${tw.id}.disarmed`));
    const quiet = this.s.skill('demolition') >= 4 && ctx.player.crouching;
    const at = tw.a.clone().lerp(tw.b, 0.5);
    if (quiet) {
      ctx.audio.play('disarm');
      this.s.events.emit('toast', { text: this.text.yank.quiet, kind: 'good' });
      this.s.addXP(XP_REWARDS.tripwireDisarmed, this.text.yank.quietReason);
    } else {
      ctx.audio.play('cans', { pos: at });
      this.bunker.triggerAlarm(at, this.text.yank.loud);
      this.s.addXP(8, 'Tripwire yanked');
    }
  }

  /** `prev` → `now`: the feet's ground-plane path this frame. */
  update(dt: number, player: Player, prev: THREE.Vector2, now: THREE.Vector2) {
    for (const tw of this.wires) {
      this.cooldown[tw.id] = Math.max(0, (this.cooldown[tw.id] ?? 0) - dt);
      if (!tw.armed || this.cooldown[tw.id] > 0) continue;
      const a = this.a2.set(tw.a.x, tw.a.z), b = this.b2.set(tw.b.x, tw.b.z);
      if (segIntersect(prev, now, a, b) && player.grounded) {
        if (player.crouching) {
          if (!this.shownHint) { this.shownHint = true; this.s.events.emit('toast', { text: this.text.stepped, kind: 'info' }); }
        } else {
          this.cooldown[tw.id] = 4;
          this.bunker.ctx.audio.play('cans', { pos: tw.a.clone().lerp(tw.b, 0.5) });
          this.bunker.triggerAlarm(tw.a.clone().lerp(tw.b, 0.5), this.text.tripped);
        }
      } else if (!this.shownHint && Math.hypot(now.x - (a.x + b.x) / 2, now.y - (a.y + b.y) / 2) < 4.5) {
        this.shownHint = true;
        this.s.events.emit('toast', { text: crouchText(this.text.ahead), kind: 'info' });
      }
    }
  }
}

/**
 * Laser beams across the inside: break one (your body spans its height, inside its x span, within
 * 0.3 m of its z) and the alarm rings. A power box kills them all. Flag: `<bunker>.lasers.off`.
 */
export class LaserGrid {
  private cooldownT = 0;

  constructor(private bunker: Bunker, readonly beams: Laser[], private def: NonNullable<BunkerSecurity['lasers']>) {}

  private get s() {
    return this.bunker.state;
  }

  get off() {
    return this.s.has(this.bunker.flag('lasers.off'));
  }

  applyFlags(has: (f: string) => boolean) {
    for (const l of this.beams) l.mesh.visible = !has(this.bunker.flag('lasers.off'));
  }

  interactables(): Interactable[] {
    const { bunker } = this, { ctx } = bunker, pw = this.def.power;
    return [{
      id: pw.id,
      pos: bunker.b.points[pw.point],
      radius: pw.radius,
      visible: () => !this.off,
      primary: {
        label: pw.label,
        available: () => true,
        run: async () => {
          const elec = this.s.skill('electronics');
          if (elec >= pw.expert) {
            this.s.addXP(pw.xp, pw.reason);
            this.s.events.emit('toast', { text: pw.expertToast, kind: 'good' });
          } else if (elec >= 1) {
            const ok = await ctx.ui.circuit({ title: pw.circuit.title, difficulty: pw.circuit.difficulty });
            if (!ok) return;
            this.s.addXP(pw.xp, pw.reason);
          } else {
            ctx.audio.play('zap');
            ctx.post.damage.value = 0.8;
            ctx.cam.addTrauma(0.5);
            this.s.damage(pw.shock.damage);
            this.s.events.emit('toast', { text: pw.shock.toast, kind: 'bad' });
          }
          this.kill();
        },
      },
    }];
  }

  /** Power off, with sparks at the box and every emitter. */
  kill() {
    const { bunker } = this, { b } = bunker, [ox, oy, oz] = this.def.power.sparkOffset;
    this.s.set(bunker.flag('lasers.off'));
    bunker.applyFlags();
    bunker.ctx.audio.play('disarm');
    const box = b.points[this.def.power.point];
    bunker.sparks.emit(box.clone().add(new THREE.Vector3(ox, oy, oz)), 36, 3, { up: 1, floorY: b.origin.y + 0.1, size: 0.025, life: 0.8 });
    for (const l of this.beams) for (const e of [l.a, l.b]) bunker.sparks.emit(e, 10, 1.6, { up: 0.5, floorY: b.origin.y + 0.1, size: 0.02, life: 0.5 });
  }

  update(dt: number, t: number, alarm: boolean, player: Player, inside: boolean) {
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    if (this.off) return;
    const p = player.position;
    for (const l of this.beams) {
      const pulse = 0.85 + Math.sin(t * 12) * 0.15;
      l.intensity.value = (alarm ? 14 : 7) * pulse;
      if (this.cooldownT > 0 || !inside) continue;
      const dz = Math.abs(p.z - l.a.z);
      const bottom = p.y, top = p.y + player.height;
      if (dz < 0.3 && bottom < l.a.y && top > l.a.y && p.x > l.a.x && p.x < l.b.x) {
        this.cooldownT = 5;
        this.bunker.ctx.audio.play('droneAlert');
        this.bunker.triggerAlarm(this.bunker.b.points[this.def.alarmPoint].clone(), this.def.tripped[l.id] ?? this.def.tripped.default);
        this.bunker.ctx.post.alert.value = 1;
      }
    }
  }
}

/**
 * Security cameras: each sweeps its arc; a clear look at you (range, cone, line of sight) builds
 * up over `detectTime` (slower crouched, in the dark or with stealth) and then rings the alarm,
 * pointing drones at where it saw you. Flag: `<bunker>.cameras.off` (a SPLICE daemon or a power box).
 * Not used by the Garage; written for Tier 2.
 */
export class CameraGrid {
  /** 0..1 per camera: how close it is to calling it in. */
  readonly seen: number[];
  private cooldownT = 0;
  private readonly to = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(private bunker: Bunker, readonly cams: SecurityCamera[], private def: NonNullable<BunkerSecurity['cameras']>) {
    this.seen = cams.map(() => 0);
  }

  get off() {
    return this.bunker.state.has(this.bunker.flag('cameras.off'));
  }

  applyFlags(has: (f: string) => boolean) {
    const off = has(this.bunker.flag('cameras.off'));
    for (const c of this.cams) c.lens.value = off ? 0 : 1;
  }

  kill() {
    this.bunker.state.set(this.bunker.flag('cameras.off'));
    this.bunker.applyFlags();
    this.seen.fill(0);
  }

  /** `chest`: the player's chest in world space; `stealth`: the same multiplier drones use. */
  update(dt: number, t: number, chest: THREE.Vector3, stealth: number, collider: unknown) {
    this.cooldownT = Math.max(0, this.cooldownT - dt);
    const off = this.off;
    this.cams.forEach((c, i) => {
      if (off) { this.seen[i] = 0; return; }
      const yaw = c.yaw0 + Math.sin((t / c.period) * Math.PI * 2) * c.sweep;
      c.pivot.rotation.y = yaw;
      this.to.copy(chest).sub(c.eye);
      const d = this.to.length();
      this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      let sees = d < c.range && this.to.normalize().dot(this.fwd) > Math.cos(c.halfAngle);
      if (sees) {
        const hit = this.bunker.ctx.physics.raycast(c.eye, this.to, d, collider as never);
        sees = hit === null || hit > d - 0.4;
      }
      this.seen[i] = THREE.MathUtils.clamp(this.seen[i] + (sees ? dt * stealth / this.def.detectTime : -dt * 0.5), 0, 1);
      c.lens.value = this.seen[i] > 0.05 ? 2 : 1;
      if (this.seen[i] >= 1 && this.cooldownT <= 0) {
        this.cooldownT = 6;
        this.seen[i] = 0.5;
        this.bunker.ctx.audio.play('droneAlert', { pos: c.eye });
        this.bunker.triggerAlarm(chest.clone(), this.def.tripped);
      }
    });
  }
}
