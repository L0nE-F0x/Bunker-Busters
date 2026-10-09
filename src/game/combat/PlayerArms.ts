import * as THREE from 'three/webgpu';
import type { Input } from '@/engine/input';
import type { AudioEngine } from '@/engine/audio';
import type { GameState } from '../State';
import type { Hands } from '../player/Hands';
import type { FirstPersonCamera } from '../player/FirstPersonCamera';
import type { Player } from '../player/Player';
import { WEAPONS, WEAPON_ORDER, MODS, falloff, modded, type WeaponId, type WeaponDef } from '@/content/weapons';
import type { Combat, Hostile, Zone } from './Combat';

/**
 * The player's side of a fight: which weapon is up, what's in it, and what the mouse does with it.
 *   LMB fire / swing · RMB aim down the sights · R reload · Q last weapon · wheel cycle · X holster
 *   V melee (crowbar swing, or a butt-stroke with a gun up) · from behind an unaware target: takedown
 * Rounds in a gun live in the save (`data.arms.mags`); the rest are inventory items.
 */

export interface ArmsHud {
  weapon: WeaponId | null;
  name: string;
  mag: number;
  cap: number;
  reserve: number;
  reloading: boolean;
  ads: number;
  /** Spread half-angle (radians) right now, for the crosshair gap. */
  spread: number;
  /** A takedown is on offer (prompt). */
  takedown: boolean;
  melee: boolean;
}

const _fwd = new THREE.Vector3(), _dir = new THREE.Vector3(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3();
const _ej = new THREE.Vector3(), _ejR = new THREE.Vector3(), _ejV = new THREE.Vector3(), _ejP = new THREE.Vector3(), _ejU = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

export class PlayerArms {
  equipped: WeaponId | null = null;
  private last: WeaponId | null = null;
  private cooldown = 0;
  private bloom = 0;
  private reload: { phase: 'open' | 'load' | 'close'; t: number; dur: number; stop: boolean } | null = null;
  private pendingKick = 0;
  private pendingYaw = 0;
  private recoilOut = 0;
  private fireBuffer = 0;
  private autoReloadT = -1;
  private meleeCd = 0;
  /** The last reload started on an empty gun (the pistol's slide is locked back: release it). */
  private wasEmpty = false;
  /** Gear hook: 0..1 scale on recoil (Founder Focus steadies the hands). */
  steadyK: (() => number) | null = null;
  /** Set each frame: a takedown is available on this target. */
  takedownTarget: Hostile | null = null;
  ads = 0;

  constructor(
    private state: GameState,
    private hands: Hands,
    private cam: FirstPersonCamera,
    private camera: THREE.PerspectiveCamera,
    private input: Input,
    private combat: Combat,
    private audio: AudioEngine,
    private player: Player,
  ) {
    const saved = state.data.arms?.equipped ?? null;
    if (saved && this.owned(saved)) this.equip(saved, true);
  }

  // ------------------------------------------------------------------ ownership & ammo

  owned(id: WeaponId) {
    return this.state.count(WEAPONS[id].item) > 0;
  }

  mag(id: WeaponId) {
    return this.state.data.arms?.mags?.[id] ?? 0;
  }

  private setMag(id: WeaponId, n: number) {
    const a = (this.state.data.arms ??= { equipped: null, mags: {} });
    a.mags[id] = n;
  }

  reserve(id: WeaponId) {
    const ammo = WEAPONS[id].ammo;
    return ammo ? this.state.count(ammo) : 0;
  }

  private hasFlag = (f: string) => this.state.has(f);
  /** A scope is fitted to the rifle (Gear draws the scope view when it's aimed). */
  get scoped() {
    return this.equipped === 'rifle' && this.state.has(MODS.scope.flag);
  }

  private get w(): WeaponDef | null {
    return this.equipped ? modded(WEAPONS[this.equipped], this.hasFlag) : null;
  }

  private drawTime(w: WeaponDef) {
    return w.draw * (this.state.focus('firearms') === 'quickdraw' ? 0.5 : 1);
  }

  equip(id: WeaponId | null, instant = false) {
    if (id && !this.owned(id)) return;
    if (id === this.equipped) return;
    if (this.equipped) this.last = this.equipped;
    this.equipped = id;
    this.reload = null;
    this.autoReloadT = -1;
    (this.state.data.arms ??= { equipped: null, mags: {} }).equipped = id;
    this.hands.arms.equip(id, instant ? 0.05 : id ? this.drawTime(WEAPONS[id]) : 0.3);
    if (!instant) this.audio.combat?.foley(id ? 'draw' : 'holster');
    this.cooldown = id ? this.drawTime(WEAPONS[id]) * 0.8 : 0;
  }

  /** Next owned weapon in `dir` (wheel). */
  cycle(dir: 1 | -1) {
    const owned = WEAPON_ORDER.filter((w) => this.owned(w));
    if (!owned.length) return;
    const i = this.equipped ? owned.indexOf(this.equipped) : -1;
    const n = owned[(i + dir + owned.length) % owned.length];
    this.equip(n);
  }

  /** A weapon you no longer carry (dropped with the pack, sold) can't stay in your hand. */
  validate() {
    if (this.equipped && !this.owned(this.equipped)) this.equip(null, true);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, blocked: boolean, interacting: boolean) {
    const input = this.input;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.fireBuffer = Math.max(0, this.fireBuffer - dt);
    this.bloom = Math.max(0, this.bloom - dt * 2.4);
    const w = this.w;
    this.hands.arms.setMods(this.state.has(MODS.scope.flag), this.state.has(MODS.choke.flag));

    // camera recoil: a quick punch up, then most of it settles back
    if (this.pendingKick > 0) {
      const step = Math.min(this.pendingKick, dt * 2.2);
      this.pendingKick -= step;
      this.cam.pitch += step;
      this.recoilOut += step * 0.72;
    }
    if (Math.abs(this.pendingYaw) > 1e-5) {
      const step = this.pendingYaw * Math.min(1, dt * 30);
      this.pendingYaw -= step;
      this.cam.yaw += step;
    }
    if (this.recoilOut > 0) {
      const back = this.recoilOut * (1 - Math.exp(-dt * 7));
      this.recoilOut -= back;
      this.cam.pitch -= back;
    }

    // ADS: hold right mouse (or the touch aim button)
    const wantAds = !blocked && !interacting && !!w && w.kind === 'gun' && input.act('aim') && input.locked;
    this.ads = this.hands.arms.ads;
    const marks = this.state.focus('firearms') === 'marksman';
    if (w && w.kind === 'gun') {
      const fov = w.adsFov * (marks ? 0.82 : 1);
      this.cam.aimFov = fov;
      this.cam.aimK = this.ads;
    } else this.cam.aimK = 0;

    // takedown on offer?
    this.takedownTarget = !blocked && w ? this.findTakedown() : null;

    if (blocked) { this.reloadTick(dt, true); return { wantAds: false }; }

    // weapon selection
    if (input.actPressed('lastWeapon')) this.equip(this.last && this.owned(this.last) ? this.last : WEAPON_ORDER.find((x) => this.owned(x) && x !== this.equipped) ?? null);
    if (input.actPressed('holster')) this.equip(this.equipped ? null : this.last && this.owned(this.last) ? this.last : WEAPON_ORDER.find((x) => this.owned(x)) ?? null);
    if (input.wheel && !wantAds) this.cycle(input.wheel > 0 ? 1 : -1);
    if (input.actPressed('nextWeapon')) this.cycle(1);
    if (input.actPressed('prevWeapon')) this.cycle(-1);

    // fire / swing (a press is buffered for a beat, so a click during the pump still lands)
    const firePress = input.actPressed('fire') && input.locked;
    if (firePress) this.fireBuffer = 0.18;
    if (input.actPressed('melee')) this.melee();
    if (input.actPressed('reload')) this.startReload();

    if (w && this.fireBuffer > 0 && !interacting) {
      if (w.kind === 'melee') { if (!this.hands.arms.swinging && this.meleeCd <= 0) { this.fireBuffer = 0; this.melee(); } }
      else if (this.takedownTarget && this.hands.arms.ads < 0.3) { this.fireBuffer = 0; this.melee(); }
      else if (this.reload) {
        // finish the round in hand, then close up and shoot
        if (this.reload.phase === 'load') this.reload.stop = true;
      } else if (this.cooldown <= 0 && !this.hands.arms.busy) {
        this.fireBuffer = 0;
        this.fire();
      }
    }
    // auto-reload a beat after running dry
    if (this.autoReloadT >= 0) {
      this.autoReloadT -= dt;
      if (this.autoReloadT < 0) this.startReload();
    }
    this.reloadTick(dt, false);
    return { wantAds };
  }

  // ------------------------------------------------------------------ shooting

  private fire() {
    const w = this.w!;
    const id = w.id;
    const mag = this.mag(id);
    if (mag <= 0) {
      this.hands.arms.dryFire();
      this.audio.combat?.foley('dry');
      this.cooldown = 0.25;
      if (this.reserve(id) > 0) this.autoReloadT = 0.25;
      else this.state.events.emit('toast', { text: `${w.name}: empty, and nothing to load it with.`, kind: 'bad' });
      return;
    }
    this.setMag(id, mag - 1);
    this.cooldown = w.interval;
    const fa = this.state.skill('firearms');
    const ads = this.hands.arms.ads;
    // spread: hip → sights, worse moving and jumping, bloom from recent shots, tighter with Firearms
    const v = this.player.velocity;
    const moving = Math.min(1, Math.hypot(v.x, v.z) / 4);
    const air = this.player.grounded ? 0 : 1;
    const base = THREE.MathUtils.lerp(w.hipSpread, w.adsSpread, ads);
    const skillK = fa >= 5 ? 0.55 : fa >= 1 ? 0.85 - (fa - 1) * 0.06 : 1;
    const spread = base * (1 + moving * (ads > 0.5 ? 1.5 : 0.8) + air * 2 + this.bloom) * skillK * (this.player.crouching ? 0.8 : 1);
    this.bloom = Math.min(2.5, this.bloom + (w.id === 'shotgun' ? 1.2 : 0.7));

    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    this.camera.getWorldDirection(_fwd);
    const muzzle = this.hands.arms.muzzleWorld;
    const deadeye = this.state.capstone('firearms') === 'deadeye';
    const headK = w.headMult * (fa >= 3 ? 1.15 : 1) * (deadeye ? 1.5 : 1);
    const dmgFn = (dist: number, zone: Zone) => {
      const z = zone === 'head' ? headK : zone === 'limb' ? 0.72 : 1;
      return w.damage * falloff(w, dist) * z * this.combat.diff.dealt;
    };
    let best: 'hit' | 'head' | 'kill' | null = null;
    let target: Hostile | null = null;
    for (let i = 0; i < w.pellets; i++) {
      const dir = jitter(_fwd, i === 0 && w.pellets > 1 ? spread * 0.3 : spread, _dir);
      const r = this.combat.playerRound(eye, dir, muzzle, id, dmgFn, w.maxRange, !w.suppressed && (w.pellets === 1 || i < 3));
      if (r) {
        const k = r.killed ? 'kill' : r.zone === 'head' ? 'head' : 'hit';
        if (!best || rank(k) > rank(best)) { best = k; target = r.h; }
      }
    }
    if (best && target) {
      this.combat.hooks?.onHit(best, target);
      if (best === 'kill' && deadeye && w.ammo && this.mag(id) < w.mag) this.setMag(id, this.mag(id) + 1);
    }
    // feel: kick, flash, sound, smoke
    const recoilK = (fa >= 4 ? 0.5 : 1 - fa * 0.06) * (1 - ads * 0.3) * (this.player.crouching ? 0.85 : 1) * (this.steadyK?.() ?? 1);
    this.hands.arms.fire(recoilK);
    // a controller kicks with the gun (stronger for the heavy ones)
    this.input.rumble(Math.min(1, w.recoil.pitch * 6) * recoilK, 0.45 * recoilK, 70);
    this.pendingKick += w.recoil.pitch * recoilK * (0.85 + Math.random() * 0.3);
    this.pendingYaw += (Math.random() - 0.5) * 2 * w.recoil.yaw * recoilK;
    this.cam.addTrauma(w.recoil.kick * 0.18 * recoilK);
    this.combat.playerFlash(muzzle, w.id === 'shotgun' ? 1.4 : w.suppressed ? 0.1 : 1);
    this.combat.debris.emit('smoke', muzzle, w.suppressed ? 1 : 2, _fwd.clone().multiplyScalar(1.5), 0.3, w.suppressed ? 0.05 : 0.1, undefined, 0.5);
    if (w.suppressed) this.audio.combat?.suppressedShot();
    else this.audio.combat?.gunshot(id as 'revolver' | 'shotgun' | 'rifle');
    if (w.magFed) { this.eject(0); if (this.mag(id) === 0) this.hands.arms.slideLock(true); }
    if (id === 'shotgun') setTimeout(() => { this.audio.combat?.foley('pumpBack'); this.eject(1); setTimeout(() => this.audio.combat?.foley('pumpFwd'), 170); }, 230);
    if (id === 'rifle') setTimeout(() => { this.audio.combat?.foley('leverOpen'); this.eject(0); setTimeout(() => this.audio.combat?.foley('leverClose'), 210); }, 190);
    if (id !== 'revolver') this.audio.combat?.foley('casing', w.suppressed ? 0.5 : 0.8);
    this.combat.noise(this.player.position, w.noise, 'gunshot');
    if (this.mag(id) === 0 && this.reserve(id) > 0) this.autoReloadT = w.interval + 0.15;
  }

  // ------------------------------------------------------------------ melee

  private melee() {
    const w = this.w;
    if (!w || this.hands.arms.swinging || this.meleeCd > 0 || this.hands.busy) return;
    const crowbar = w.id === 'crowbar';
    const td = this.takedownTarget;
    const dur = crowbar ? 0.62 : 0.5;
    this.meleeCd = dur * 0.85;
    this.reload = null;
    this.hands.arms.reloadCancel();
    this.audio.combat?.foley(crowbar ? 'swing' : 'swingHeavy');
    this.hands.arms.melee(dur, crowbar ? 0.27 : 0.16, () => this.meleeHit(crowbar, td));
  }

  private meleeHit(crowbar: boolean, takedown: Hostile | null) {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    this.camera.getWorldDirection(_fwd);
    const brawler = this.state.capstone('firearms') === 'brawler';
    const reach = crowbar ? 2.3 : 1.9;
    // a little fan of rays: melee should be forgiving
    let hit: { h: Hostile; t: number; zone: Zone } | null = null;
    if (takedown && takedown.alive && takedown.center.distanceTo(eye) < 3) {
      hit = { h: takedown, t: takedown.center.distanceTo(eye), zone: 'body' };
    } else {
      for (const yaw of [0, -0.22, 0.22, -0.4, 0.4]) {
        for (const pitch of [0, -0.25]) {
          const d = _dir.copy(_fwd).applyAxisAngle(_ax.set(0, 1, 0), yaw);
          d.applyAxisAngle(_ay.set(0, 1, 0).cross(d).normalize(), pitch).normalize();
          const r = this.combat.hostileRay(eye, d, reach);
          if (r && (!hit || r.t < hit.t)) hit = r;
        }
        if (hit) break;
      }
    }
    const crowbarDmg = WEAPONS.crowbar.damage;
    if (hit) {
      const isTakedown = hit.h === takedown;
      const base = crowbar ? crowbarDmg : 24;
      const amt = isTakedown ? 999 : base * (brawler ? 2 : 1) * (hit.zone === 'head' ? 1.6 : 1) * this.combat.diff.dealt;
      const point = hit.h.center.clone();
      const killed = hit.h.damage({ amount: amt, dir: _fwd.clone(), point, zone: hit.zone, source: 'player', melee: true, takedown: isTakedown, weapon: this.equipped ?? undefined });
      this.audio.combat?.melee(hit.h.surface === 'metal' ? 'metal' : 'flesh', isTakedown ? 0.7 : 1);
      this.combat.impactFx(hit.h.surface, point, _ax.copy(_fwd).negate(), _fwd, 0.8);
      this.cam.addTrauma(0.22);
      this.hands.jolt(0.35);
      this.combat.hooks?.onHit(killed ? 'kill' : 'hit', hit.h);
      if (!isTakedown) this.combat.noise(this.player.position, 8, 'melee');
      return;
    }
    // swung into the world?
    const wr = this.combat.worldRay(eye, _fwd, reach, this.combat.target.collider);
    if (wr) {
      const p = eye.clone().addScaledVector(_fwd, wr.t);
      const kind = this.combat.surfaceAt(wr.collider, p);
      this.audio.combat?.melee(kind === 'metal' ? 'metal' : 'hard', 0.8);
      this.combat.impactFx(kind, p, wr.normal, _fwd, 0.6);
      this.cam.addTrauma(0.15);
      this.hands.jolt(0.4);
      this.combat.noise(this.player.position, 10, 'melee');
    }
  }

  /** A hostile within reach that hasn't noticed you, and you're not in front of it. */
  private findTakedown(): Hostile | null {
    const eye = this.combat.target.eye;
    const brawler = this.state.capstone('firearms') === 'brawler';
    let best: Hostile | null = null, bd = 2.4;
    for (const pr of this.combat.providers) for (const h of pr.hostiles()) {
      if (!h.alive || !h.unaware || !h.facing || (h.kind !== 'human' && h.kind !== 'wolf')) continue;
      const d = Math.hypot(h.center.x - eye.x, h.center.z - eye.z);
      if (d > bd || Math.abs(h.center.y - eye.y) > 1.6) continue;
      if (!h.unaware()) continue;
      const f = h.facing();
      const to = _ax.set(eye.x - h.center.x, 0, eye.z - h.center.z).normalize();
      // behind (or, with Brawler, anywhere but in front)
      if (f.dot(to) > (brawler ? 0.3 : -0.25)) continue;
      best = h;
      bd = d;
    }
    return best;
  }

  /** Spent brass (0) or a hull (1) out of the action, to the right; `dump` drops it out of a cylinder. */
  private eject(kind: number, dump = false) {
    if (!this.w || this.w.kind !== 'gun') return;
    const eye = this.camera.getWorldPosition(_ej);
    this.camera.getWorldDirection(_fwd);
    const right = _ejR.crossVectors(_fwd, _UP).normalize();
    const v = _ejV.copy(this.player.velocity).setY(this.player.velocity.y * 0.3);
    if (dump) {
      _ejP.copy(eye).addScaledVector(_fwd, 0.32).addScaledVector(right, 0.05).add(_ejU.set(0, -0.22, 0));
      v.addScaledVector(_fwd, 0.4).add(_ejU.set((Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6));
    } else {
      _ejP.copy(eye).addScaledVector(_fwd, 0.34).addScaledVector(right, 0.14).add(_ejU.set(0, -0.1, 0));
      v.addScaledVector(right, 1.8 + Math.random() * 0.9).add(_ejU.set(0, 1.7 + Math.random() * 0.8, 0)).addScaledVector(_fwd, -0.4 + Math.random() * 0.5);
    }
    this.combat.brass.eject(_ejP, v, kind);
  }

  // ------------------------------------------------------------------ reloading

  private reloadSpeed() {
    let k = this.steadyK ? 0.6 + 0.4 * this.steadyK() : 1;
    if (this.state.skill('firearms') >= 2) k *= 0.8;
    if (this.state.focus('firearms') === 'quickdraw') k *= 0.8;
    return k;
  }

  private startReload() {
    const w = this.w;
    if (!w || w.kind !== 'gun' || this.reload || this.hands.arms.busy) return;
    if (this.mag(w.id) >= w.mag) return;
    if (this.reserve(w.id) <= 0) {
      this.audio.combat?.foley('empty');
      this.state.events.emit('toast', { text: `No ${w.id === 'shotgun' ? 'shells' : 'rounds'} for the ${w.name}.`, kind: 'bad' });
      return;
    }
    this.autoReloadT = -1;
    const k = this.reloadSpeed();
    if (w.magFed && this.mag(w.id) > 0) this.hands.arms.slideLock(false);
    // the revolver's empties drop out of the open cylinder
    const spent = w.id === 'revolver' ? w.mag - this.mag(w.id) : 0;
    if (spent > 0) setTimeout(() => { for (let i = 0; i < spent; i++) this.eject(0, true); this.audio.combat?.foley('casing', 0.7); }, w.reload.open * k * 700);
    this.reload = { phase: 'open', t: 0, dur: w.reload.open * k, stop: false };
    this.hands.arms.reloadOpen(w.reload.open * k);
    this.audio.combat?.foley(w.magFed ? 'magOut' : w.id === 'revolver' ? 'cylOpen' : w.id === 'rifle' ? 'gate' : 'shell', 0.6);
    this.wasEmpty = this.mag(w.id) === 0;
  }

  private reloadTick(dt: number, paused: boolean) {
    const r = this.reload;
    const w = this.w;
    if (!r || !w) return;
    if (paused) return;
    r.t += dt;
    if (r.t < r.dur) return;
    const k = this.reloadSpeed();
    if (r.phase === 'open' || r.phase === 'load') {
      if (r.phase === 'load' && w.magFed) {
        // a fresh magazine: top it up from the reserve in one go
        const n = Math.min(w.mag - this.mag(w.id), this.reserve(w.id));
        if (n > 0 && this.state.removeItem(w.ammo!, n)) {
          this.setMag(w.id, this.mag(w.id) + n);
          this.audio.combat?.foley('magIn');
        }
        r.stop = true;
      } else if (r.phase === 'load') {
        // the round goes in at the end of the cycle
        if (this.state.removeItem(w.ammo!, 1)) {
          this.setMag(w.id, this.mag(w.id) + 1);
          this.audio.combat?.foley(w.id === 'shotgun' ? 'shell' : 'round');
        }
      }
      const more = this.mag(w.id) < w.mag && this.reserve(w.id) > 0 && !r.stop;
      if (more) {
        this.reload = { phase: 'load', t: 0, dur: w.reload.per * k, stop: false };
        this.hands.arms.reloadLoad(w.reload.per * k);
      } else {
        this.reload = { phase: 'close', t: 0, dur: w.reload.close * k, stop: false };
        this.hands.arms.reloadClose(w.reload.close * k);
        if (w.magFed) { if (this.wasEmpty) this.audio.combat?.foley('slide', 0.8); }
        else this.audio.combat?.foley(w.id === 'revolver' ? 'cylClose' : w.id === 'shotgun' ? 'pumpFwd' : 'leverClose', 0.8);
      }
    } else {
      this.reload = null;
      this.cooldown = Math.max(this.cooldown, 0.08);
    }
  }

  get reloading() {
    return !!this.reload;
  }

  /** Debug / harness: pull the trigger (or swing) as a click would. */
  trigger() {
    const w = this.w;
    if (!w) return;
    if (w.kind === 'melee' || this.takedownTarget) this.melee();
    else if (this.cooldown <= 0 && !this.hands.arms.busy && !this.reload) this.fire();
  }
  /** Debug / harness: start a reload. */
  reloadNow() {
    this.startReload();
  }

  hud(): ArmsHud {
    const w = this.w;
    const ads = this.hands.arms.ads;
    let spread = 0;
    if (w && w.kind === 'gun') {
      const v = this.player.velocity;
      const moving = Math.min(1, Math.hypot(v.x, v.z) / 4);
      spread = THREE.MathUtils.lerp(w.hipSpread, w.adsSpread, ads) * (1 + moving * 0.8 + (this.player.grounded ? 0 : 2) + this.bloom);
    }
    return {
      weapon: this.equipped,
      name: w?.name ?? '',
      mag: w ? this.mag(w.id) : 0,
      cap: w?.mag ?? 0,
      reserve: w ? this.reserve(w.id) : 0,
      reloading: !!this.reload,
      ads,
      spread,
      takedown: !!this.takedownTarget,
      melee: w?.kind === 'melee',
    };
  }
}

const rank = (k: 'hit' | 'head' | 'kill') => (k === 'kill' ? 3 : k === 'head' ? 2 : 1);

/** A direction inside a cone of half-angle `spread` around `fwd` (uniform over the disc). */
export function jitter(fwd: THREE.Vector3, spread: number, out: THREE.Vector3) {
  out.copy(fwd);
  if (spread <= 0) return out;
  const ax = Math.abs(fwd.y) < 0.95 ? _ax.set(0, 1, 0).cross(fwd).normalize() : _ax.set(1, 0, 0);
  const ay = _ay.copy(fwd).cross(ax);
  const u = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  return out.addScaledVector(ax, Math.cos(u) * Math.tan(r)).addScaledVector(ay, Math.sin(u) * Math.tan(r)).normalize();
}
