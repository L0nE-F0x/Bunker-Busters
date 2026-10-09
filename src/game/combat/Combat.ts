import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { AudioEngine } from '@/engine/audio';
import type { GunKind, ImpactKind } from '@/engine/combatAudio';
import type { Acoustics, Surface } from '@/engine/surface';
import type { Heightfield } from '../world/Heightfield';
import type { Atmosphere } from '../world/Atmosphere';
import type { DustPuffs, Sparks } from '../world/effects';
import { VirtualLight } from '../world/lights';
import { Tracers, Debris, Flames } from './fx';
import { Marks, Brass } from './marks';
import type { WeaponId } from '@/content/weapons';
import { DIFFICULTY, type Difficulty } from '@/content/weapons';
import { WEAPONS } from '@/content/weapons';

/**
 * The fight layer. Everything that can be shot, bitten or blown up registers here through a
 * `HostileProvider`; everything that shoots asks here whether it hit. One place resolves bullets
 * (hitscan against hostiles and the Rapier world), explosions, damage to the player (with the
 * difficulty's scaling and a direction for the HUD), noise (gunshots carry; enemies listen), and the
 * effects that sell all of it: tracers, muzzle light, blood, dirt, sparks, smoke and fire.
 */

export type Zone = 'head' | 'body' | 'limb';
export type HostileKind = 'wolf' | 'human' | 'drone' | 'turret' | 'mine' | 'snake' | 'scorpion';
export type NoiseKind = 'gunshot' | 'explosion' | 'step' | 'melee' | 'can' | 'voice';
export type HurtKind = 'bullet' | 'bite' | 'blast' | 'melee' | 'poison' | 'zap';

export interface RayHit { t: number; zone: Zone }

export interface Damage {
  amount: number;
  dir: THREE.Vector3;
  point: THREE.Vector3;
  zone: Zone;
  source: 'player' | 'blast' | 'enemy';
  melee?: boolean;
  takedown?: boolean;
  weapon?: WeaponId;
}

export interface Hostile {
  readonly kind: HostileKind;
  alive: boolean;
  /** Bounding sphere for a quick reject (world). */
  readonly center: THREE.Vector3;
  radius: number;
  readonly surface: 'flesh' | 'metal';
  /** Exact-ish ray test against the body (world space, unit `dir`). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number): RayHit | null;
  /** Returns whether it died from this. */
  damage(d: Damage): boolean;
  /** Hasn't noticed the player (takedowns land silently). */
  unaware?(): boolean;
  /** Facing (unit, horizontal), for "from behind". */
  facing?(): THREE.Vector3;
  /** 0..1 how aware of the player (HUD chevrons), and whether it's actively hostile right now. */
  awareness?(): number;
  /** Dead but still on its feet (falling): rounds can still hit it. */
  shootable?(): boolean;
}

export interface HostileProvider {
  hostiles(): Iterable<Hostile>;
  hear?(pos: THREE.Vector3, radius: number, kind: NoiseKind): void;
  /** One of the player's rounds flew from `origin` along `dir` for `len` m (it hit `hit`, if anything): near misses suppress. */
  whizz?(origin: THREE.Vector3, dir: THREE.Vector3, len: number, hit: Hostile | null): void;
}

/** What enemies perceive of the player each frame (filled by Game). */
export interface PlayerTarget {
  feet: THREE.Vector3;
  chest: THREE.Vector3;
  eye: THREE.Vector3;
  velocity: THREE.Vector3;
  crouch: boolean;
  /** 0.4 crouched … 1.6 sprinting with a torch (Player.noise × archetype stealth). */
  noise: number;
  torch: boolean;
  /** Inside a sealed interior (enemies outside lose track). */
  hidden: boolean;
  /** 0..1 night darkness, 0..1 air clarity (storms). */
  night: number;
  visibility: number;
  /** 0..1 how lit you are to a watcher (stealth model): 1 by day, firelight/floodlights/torch at night. */
  light: number;
  alive: boolean;
  collider: unknown;
  /** Height of the capsule (crouch shrinks it). */
  height: number;
}

export interface CombatHooks {
  /** Damage reached the player (after difficulty). `from` is the source position. */
  onHurt(amount: number, from: THREE.Vector3 | null, kind: HurtKind): void;
  /** One of your shots landed. */
  onHit(kind: 'hit' | 'head' | 'kill', target: Hostile): void;
  /** Camera shake etc. */
  trauma(k: number): void;
  /** Envenomed (seconds of poison added). */
  onVenom?(seconds: number): void;
}

type Collider = ReturnType<Physics['world']['createCollider']>;

const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export const SURFACE_IMPACT: Record<Surface, ImpactKind> = {
  sand: 'dirt', gravel: 'dirt', asphalt: 'rock', rock: 'rock', concrete: 'rock', wood: 'wood', metal: 'metal',
};

export class Combat {
  readonly tracers = new Tracers();
  readonly debris: Debris;
  readonly flames = new Flames();
  /** Bullet holes and chips on fixed world geometry. */
  readonly marks = new Marks();
  /** Spent brass and hulls. */
  readonly brass: Brass;
  readonly group = new THREE.Group();
  readonly providers: HostileProvider[] = [];
  readonly target: PlayerTarget = {
    feet: new THREE.Vector3(), chest: new THREE.Vector3(), eye: new THREE.Vector3(), velocity: new THREE.Vector3(),
    crouch: false, noise: 1, torch: false, hidden: false, night: 0, visibility: 1, light: 1, alive: true, collider: null, height: 1.66,
  };
  difficulty: Difficulty = 'normal';
  /** 0..1 how hot the fight is right now (music, banter). Decays when nobody is shooting. */
  heat = 0;
  /** Last time (s) the player was shot at or bitten. */
  lastThreat = -99;
  hooks: CombatHooks | null = null;
  /** Shared effects from the world (set by Game). */
  sparks: Sparks | null = null;
  puffs: DustPuffs | null = null;
  acoustics: Acoustics | null = null;
  private muzzle = new VirtualLight(0xffb060, 0, 9, 2);
  private enemyMuzzle = [new VirtualLight(0xffa850, 0, 8, 2), new VirtualLight(0xffa850, 0, 8, 2)];
  private enemyMuzzleI = 0;
  private blast = new VirtualLight(0xff8a3a, 0, 30, 2);
  private ray: InstanceType<Physics['R']['Ray']>;
  t = 0;

  constructor(private physics: Physics, private hf: Heightfield, readonly atmo: Atmosphere, private audio: AudioEngine) {
    this.debris = new Debris(atmo);
    this.group.name = 'combat';
    this.brass = new Brass((p) => {
      const h = this.worldRay(p, _down, 4, this.target.collider);
      return h ? p.y - h.t : this.hf.heightAt(p.x, p.z);
    });
    this.group.add(this.tracers.mesh, this.debris.sprite, this.flames.sprite, this.marks.mesh, this.brass.mesh);
    this.muzzle.priority = 6;
    for (const l of this.enemyMuzzle) l.priority = 5;
    this.blast.priority = 12;
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  get diff() {
    return DIFFICULTY[this.difficulty];
  }

  register(p: HostileProvider) {
    this.providers.push(p);
  }

  /** Something made a noise: every provider in earshot gets told. */
  noise(pos: THREE.Vector3, radius: number, kind: NoiseKind) {
    for (const p of this.providers) p.hear?.(pos, radius, kind);
  }

  // ------------------------------------------------------------------ world rays

  /** First solid thing along the ray (terrain, props, buildings), excluding `skip`. */
  worldRay(origin: THREE.Vector3, dir: THREE.Vector3, max: number, skip?: unknown) {
    const r = this.ray;
    r.origin.x = origin.x; r.origin.y = origin.y; r.origin.z = origin.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    const R = this.physics.R;
    const hit = this.physics.world.castRayAndGetNormal(r, max, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, skip as Collider | undefined);
    if (!hit) return null;
    return { t: hit.timeOfImpact, normal: _n.set(hit.normal.x, hit.normal.y, hit.normal.z).clone(), collider: hit.collider as Collider };
  }

  /**
   * Walk a ground creature from `from` toward `to` (feet positions; `to` is rewritten) without
   * passing through buildings, walls or rocks: a knee-high ray along the step against fixed
   * colliders (terrain excluded, it's handled by the heightfield). On a hit it stops `r` short and
   * slides along the wall. Returns the slide direction's yaw when it touched a wall, else null.
   */
  slide(from: THREE.Vector3, to: THREE.Vector3, r = 0.4, knee = 0.5): number | null {
    let dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return null;
    dx /= len; dz /= len;
    const y = from.y + knee;
    const h = this.solidRay(from.x, y, from.z, dx, dz, len + r);
    if (!h || h.toi < 0.04) return null; // clear, or already inside something: let it walk out
    const nl = Math.hypot(h.nx, h.nz);
    if (nl < 0.3) return null; // a floor or a ramp, not a wall
    const nx = h.nx / nl, nz = h.nz / nl;
    const go = Math.max(0, h.toi - r);
    let ex = from.x + dx * go, ez = from.z + dz * go;
    // the rest of the step, minus the part into the wall
    let tx = dx * (len - go), tz = dz * (len - go);
    const into = tx * nx + tz * nz;
    if (into < 0) { tx -= nx * into; tz -= nz * into; }
    const tl = Math.hypot(tx, tz);
    let yaw = Math.atan2(-nz, nx); // head-on: along the wall
    if (tl > 1e-4) {
      yaw = Math.atan2(tx, tz);
      const h2 = this.solidRay(ex, y, ez, tx / tl, tz / tl, tl + r);
      const ok = !h2 ? tl : h2.toi < 0.04 ? 0 : Math.max(0, Math.min(tl, h2.toi - r));
      ex += (tx / tl) * ok;
      ez += (tz / tl) * ok;
    }
    to.x = ex;
    to.z = ez;
    return yaw;
  }

  /**
   * The way out for something pinned at `from`: of 16 headings, the one with the most room
   * (capped at `reach`), favouring those near `want` (yaw). For walkers boxed in by clutter.
   */
  openWay(from: THREE.Vector3, want: number, knee = 0.5, reach = 4): number {
    let best = want, score = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = want + (k / 16) * Math.PI * 2;
      const h = this.solidRay(from.x, from.y + knee, from.z, Math.sin(a), Math.cos(a), reach);
      const room = h ? h.toi : reach;
      const off = Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
      const sc = room - off * 0.6;
      if (sc > score) { score = sc; best = a; }
    }
    return best;
  }

  private solidRay(x: number, y: number, z: number, dx: number, dz: number, max: number) {
    const r = this.ray;
    r.origin.x = x; r.origin.y = y; r.origin.z = z;
    r.dir.x = dx; r.dir.y = 0; r.dir.z = dz;
    const R = this.physics.R;
    const hit = this.physics.world.castRayAndGetNormal(r, max, true, R.QueryFilterFlags.ONLY_FIXED | R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined,
      (c: Collider) => c.shapeType() !== R.ShapeType.HeightField);
    return hit ? { toi: hit.timeOfImpact, nx: hit.normal.x, nz: hit.normal.z } : null;
  }

  /** Clear line between two points (no world geometry in between). */
  clearLine(a: THREE.Vector3, b: THREE.Vector3, skip?: unknown) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 0.01) return true;
    _d.divideScalar(len);
    const h = this.worldRay(a, _d, len - 0.05, skip);
    return !h;
  }

  /** Nearest hostile along the ray, within `max`. */
  hostileRay(origin: THREE.Vector3, dir: THREE.Vector3, max: number, ignore?: Hostile) {
    let best: { h: Hostile; t: number; zone: Zone } | null = null;
    let bestT = max;
    for (const pr of this.providers) {
      for (const h of pr.hostiles()) {
        if ((!h.alive && !h.shootable?.()) || h === ignore) continue;
        // sphere reject
        _o.subVectors(h.center, origin);
        const along = _o.dot(dir);
        if (along < -h.radius || along > bestT + h.radius) continue;
        const d2 = _o.lengthSq() - along * along;
        if (d2 > h.radius * h.radius) continue;
        const hit = h.raycast(origin, dir, bestT);
        if (hit && hit.t < bestT) { bestT = hit.t; best = { h, t: hit.t, zone: hit.zone }; }
      }
    }
    return best;
  }

  surfaceAt(collider: Collider | null, p: THREE.Vector3): ImpactKind {
    const s = this.acoustics ? this.acoustics.surfaceOfHit(collider, p) : 'sand';
    return SURFACE_IMPACT[s];
  }

  // ------------------------------------------------------------------ effects

  /** A round landing on `kind` at `p` with surface normal `n`, travelling along `dir`. */
  impactFx(kind: ImpactKind | 'flesh' | 'metal', p: THREE.Vector3, n: THREE.Vector3, dir: THREE.Vector3, k = 1) {
    const out = _q.copy(n).multiplyScalar(2.2).addScaledVector(dir, -0.6);
    const near = p.distanceTo(this.target.eye);
    if (kind === 'flesh') {
      this.debris.emit('blood', p, Math.round(5 * k), _a.copy(dir).multiplyScalar(2.2).add(out.multiplyScalar(0.3)), 1.4, 0.035);
      this.debris.emit('mist', p, 2, _a.copy(dir).multiplyScalar(0.8), 0.4, 0.22 * k);
    } else if (kind === 'metal') {
      this.sparks?.emit(p, Math.round(10 * k), 3.5, { dir: out, up: 0.6, size: 0.022, life: 0.4, floorY: p.y - 2 });
      this.debris.emit('dust', p, 1, out.multiplyScalar(0.3), 0.3, 0.12);
    } else if (kind === 'dirt') {
      const col = this.groundTint(p);
      this.debris.emit('dirt', p, Math.round(7 * k), out, 1.6, 0.04, col);
      this.debris.emit('dust', p, 3, _a.copy(n).multiplyScalar(1.1), 0.6, 0.28 * k, col);
    } else {
      this.debris.emit('chunk', p, Math.round(5 * k), out, 2.4, 0.025);
      this.debris.emit('dust', p, 2, _a.copy(n).multiplyScalar(0.9), 0.5, 0.2 * k);
      if (kind === 'rock' && Math.random() < 0.4) this.sparks?.emit(p, 4, 3, { dir: out, size: 0.016, life: 0.25, floorY: p.y - 2 });
    }
    if (near < 160) this.audio.combat?.impact(kind as ImpactKind, p, Math.max(0.3, Math.min(1.2, 1.3 - near / 120)));
  }

  /** A lasting mark where a round hit fixed geometry (nothing that moves or gets removed). */
  private mark(kind: ImpactKind, p: THREE.Vector3, n: THREE.Vector3, c: Collider, dir: THREE.Vector3) {
    const body = c.parent();
    if (body && !body.isFixed()) return;
    this.marks.add(kind, p, n, dir);
  }

  private _tint = new THREE.Color();
  private groundTint(p: THREE.Vector3) {
    // the desert's own dust, darker in the wash
    const low = THREE.MathUtils.clamp((-p.y - 1) / 6, 0, 1);
    return this._tint.setRGB(0.55 - low * 0.12, 0.42 - low * 0.08, 0.28 - low * 0.05);
  }

  /** The player's muzzle: a flash of real light at `p` (it lights the dust and the hands). */
  playerFlash(p: THREE.Vector3, k = 1) {
    this.muzzle.position.copy(p);
    this.muzzle.intensity = 40 * k;
  }

  /** An enemy's muzzle flash at `p` pointing along `dir`. */
  enemyFlash(p: THREE.Vector3, dir: THREE.Vector3, k = 1) {
    this.flames.emit(1, _a.copy(p).addScaledVector(dir, 0.08), 1, _b.copy(dir).multiplyScalar(0.6), 0, 0.35 * k, 0.06, 0.4, 6);
    this.flames.emit(2, p, 1, null, 0, 0.5 * k, 0.05, 0.5, 2);
    const l = this.enemyMuzzle[this.enemyMuzzleI++ % this.enemyMuzzle.length];
    l.position.copy(p);
    l.intensity = 30 * k;
    this.debris.emit('smoke', p, 2, _a.copy(dir).multiplyScalar(1.2), 0.2, 0.12, undefined, 0.35);
  }

  // ------------------------------------------------------------------ the player's shots

  /**
   * One round (or pellet) from the player's eye along `dir`. Returns what it hit (the caller sums
   * pellet damage into hit markers). The tracer starts at the visible muzzle.
   */
  playerRound(eye: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, weapon: WeaponId, damage: (dist: number, zone: Zone) => number, maxRange: number, tracer: boolean) {
    const world = this.worldRay(eye, dir, maxRange, this.target.collider);
    const wT = world ? world.t : maxRange;
    const host = this.hostileRay(eye, dir, wT);
    const end = _p.copy(eye).addScaledVector(dir, host ? host.t : wT);
    if (tracer) this.tracers.emit(muzzle, end, 420, 9, 0.016);
    // a subsonic round through a can doesn't crack past anyone's ear (the Hush .22): no suppression
    if (!WEAPONS[weapon]?.suppressed) for (const pr of this.providers) pr.whizz?.(eye, dir, host ? host.t : wT, host ? host.h : null);
    if (host) {
      const point = end.clone();
      const amt = damage(host.t, host.zone);
      const killed = host.h.damage({ amount: amt, dir: dir.clone(), point, zone: host.zone, source: 'player', weapon });
      this.impactFx(host.h.surface, point, _n.copy(dir).negate(), dir, host.zone === 'head' ? 1.5 : 1);
      return { h: host.h, zone: host.zone, killed, point };
    }
    if (world) {
      const kind = this.surfaceAt(world.collider, end);
      this.impactFx(kind, end.clone(), world.normal, dir);
      this.mark(kind, end, world.normal, world.collider, dir);
    }
    return null;
  }

  // ------------------------------------------------------------------ enemy fire

  /**
   * An enemy shot from `muzzle` toward `aim` with error cone `spread` (radians). Resolves against
   * the player's capsule and the world (cover works). Near misses crack past. Returns hit or not.
   */
  enemyRound(muzzle: THREE.Vector3, aim: THREE.Vector3, spread: number, damage: number, gun: GunKind, opts: { tracer?: boolean; pellets?: number } = {}) {
    const pellets = opts.pellets ?? 1;
    let hitAny = false;
    let total = 0;
    const t = this.target;
    for (let i = 0; i < pellets; i++) {
      const dir = _d.subVectors(aim, muzzle).normalize();
      // a random direction inside the cone
      const u = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * spread;
      const ax = Math.abs(dir.y) < 0.95 ? _a.set(0, 1, 0).cross(dir).normalize() : _a.set(1, 0, 0);
      const ay = _b.copy(dir).cross(ax);
      dir.addScaledVector(ax, Math.cos(u) * r).addScaledVector(ay, Math.sin(u) * r).normalize();
      const world = this.worldRay(muzzle, dir, 400, t.collider);
      const wT = world ? world.t : 400;
      // the player as a capsule from the feet to the head
      const hitT = t.alive ? capsuleRay(muzzle, dir, _o.copy(t.feet).setY(t.feet.y + 0.35), _q.copy(t.feet).setY(t.feet.y + t.height - 0.3), 0.36) : null;
      const end = muzzle.clone().addScaledVector(dir, hitT !== null && hitT < wT ? hitT : wT);
      if (opts.tracer !== false && (pellets === 1 || i === 0) && Math.random() < 0.7) this.tracers.emit(muzzle, end, 300, 6, 0.012);
      if (hitT !== null && hitT < wT) {
        hitAny = true;
        total += damage;
        continue;
      }
      // near miss: closest approach to the eye
      _o.subVectors(t.eye, muzzle);
      const along = THREE.MathUtils.clamp(_o.dot(dir), 0, wT);
      const close = _p.copy(muzzle).addScaledVector(dir, along);
      const miss = close.distanceTo(t.eye);
      if (miss < 3.2 && i === 0) this.audio.combat?.whizz(close, miss);
      if (world) {
        const kind = this.surfaceAt(world.collider, end);
        this.impactFx(kind, end, world.normal, dir, 0.8);
        this.mark(kind, end, world.normal, world.collider, dir);
      }
    }
    this.lastThreat = this.t;
    this.heat = Math.min(1, this.heat + 0.25);
    if (hitAny) this.hurtPlayer(total, muzzle, 'bullet');
    void gun;
    return hitAny;
  }

  /** Venom in the blood: `seconds` more of slow damage (the hook decides how it shows). */
  venom(seconds: number) {
    this.hooks?.onVenom?.(seconds);
  }

  /** Damage to the player, scaled by difficulty. `from` points the HUD indicator. */
  hurtPlayer(amount: number, from: THREE.Vector3 | null, kind: HurtKind) {
    const amt = amount * this.diff.taken;
    this.lastThreat = this.t;
    this.heat = Math.min(1, this.heat + 0.3);
    this.hooks?.onHurt(amt, from, kind);
  }

  // ------------------------------------------------------------------ explosions

  /**
   * A blast at `p`: radius `r` metres, `dmg` at the centre (falls off with distance; cover blocks it).
   * Hurts the player and every hostile in range, throws dirt and fire, rings the desert.
   */
  explode(p: THREE.Vector3, r: number, dmg: number, opts: { source?: 'player' | 'enemy'; ignore?: Hostile } = {}) {
    const k = Math.min(1.6, r / 5);
    this.flames.emit(0, p, 14, _a.set(0, 2.2, 0), 4.5 * k, 0.9 * k, 0.9, 2.2, 5);
    this.flames.emit(2, _a.copy(p).setY(p.y + 0.4), 3, null, 0.5, 2.6 * k, 0.18, 0.6, 7);
    this.debris.emit('smoke', _a.copy(p).setY(p.y + 0.5), 12, _b.set(0, 2.4, 0), 2.2 * k, 0.8 * k, undefined, 1.2);
    this.debris.emit('dirt', p, 26, _b.set(0, 7, 0), 6 * k, 0.07, this.groundTint(p));
    this.debris.emit('chunk', p, 12, _b.set(0, 8, 0), 7 * k, 0.04);
    this.debris.emit('dust', p, 10, _b.set(0, 1, 0), 5 * k, 1.1 * k, this.groundTint(p), 1.5);
    this.sparks?.emit(p, 40, 9 * k, { up: 4, size: 0.035, life: 1.1, floorY: this.hf.heightAt(p.x, p.z) + 0.02 });
    this.puffs?.emit(p, 16, 4 * k, 0.8, 1.4 * k);
    this.blast.position.copy(p).setY(p.y + 1);
    this.blast.intensity = 220 * k;
    this.audio.combat?.explosion(p, Math.min(1.2, 0.6 + k * 0.4));
    this.noise(p, 260, 'explosion');
    // the player
    const t = this.target;
    const dist = t.chest.distanceTo(p);
    if (dist < r * 1.6) {
      const fall = Math.max(0, 1 - dist / (r * 1.6));
      if (this.clearLine(_a.copy(p).setY(p.y + 0.4), t.chest, t.collider)) this.hurtPlayer(dmg * fall * fall * (opts.source === 'player' ? 0.6 : 1), p, 'blast');
    }
    this.hooks?.trauma(Math.max(0, 1 - dist / (r * 6)) * 0.9);
    // hostiles
    for (const pr of this.providers) {
      for (const h of pr.hostiles()) {
        if (!h.alive || h === opts.ignore) continue;
        const d = h.center.distanceTo(p);
        if (d > r * 1.4 + h.radius) continue;
        const fall = Math.max(0, 1 - Math.max(0, d - h.radius) / (r * 1.4));
        if (!this.clearLine(_a.copy(p).setY(p.y + 0.4), h.center)) continue;
        const dir = _b.subVectors(h.center, p).setY(0.6).normalize().clone();
        const killed = h.damage({ amount: dmg * fall * fall, dir, point: h.center.clone(), zone: 'body', source: 'blast' });
        if (opts.source === 'player') this.hooks?.onHit(killed ? 'kill' : 'hit', h);
      }
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number) {
    this.t += dt;
    this.tracers.update(dt);
    this.debris.update(dt);
    this.flames.update(dt);
    this.brass.update(dt);
    this.muzzle.intensity *= Math.exp(-dt * 38);
    for (const l of this.enemyMuzzle) l.intensity *= Math.exp(-dt * 34);
    this.blast.intensity *= Math.exp(-dt * 5.5);
    if (this.muzzle.intensity < 0.05) this.muzzle.intensity = 0;
    for (const l of this.enemyMuzzle) if (l.intensity < 0.05) l.intensity = 0;
    if (this.blast.intensity < 0.05) this.blast.intensity = 0;
    this.heat = Math.max(0, this.heat - dt * (this.t - this.lastThreat > 6 ? 0.12 : 0.02));
  }

  /** The most aware hostile and how aware (HUD), plus whether anything is hunting the player. */
  awareness() {
    let best = 0, hunting = 0;
    for (const pr of this.providers) for (const h of pr.hostiles()) {
      if (!h.alive || !h.awareness) continue;
      const a = h.awareness();
      if (a > best) best = a;
      if (a >= 1) hunting++;
    }
    return { best, hunting };
  }
}

/** Ray vs capsule (segment a–b, radius r): distance along the ray or null. */
export function capsuleRay(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): number | null {
  // the segment point closest to the ray's line, then a sphere test there (good enough for bodies)
  const ab = _cr1.subVectors(b, a);
  const w = _cr2.subVectors(o, a);
  const bb = d.dot(ab), cc = ab.dot(ab), dd = d.dot(w), ee = ab.dot(w);
  const denom = cc - bb * bb;
  const s = THREE.MathUtils.clamp(denom > 1e-8 ? (ee - bb * dd) / denom : 0, 0, 1);
  const c = _cr3.copy(a).addScaledVector(ab, s);
  return sphereRay(o, d, c, r);
}

export function sphereRay(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const oc = _cr4.subVectors(o, c);
  const b = oc.dot(d);
  const cc = oc.dot(oc) - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(h);
  return t2 >= 0 ? 0 : null;
}

const _cr1 = new THREE.Vector3(), _cr2 = new THREE.Vector3(), _cr3 = new THREE.Vector3(), _cr4 = new THREE.Vector3();
