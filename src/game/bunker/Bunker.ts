import * as THREE from 'three/webgpu';
import { Interior } from '../world/interiors';
import { Sparks } from '../world/effects';
import type { Drone, DroneState } from './Drone';
import type { BunkerShell, Door } from './shell';
import { Tripwires, LaserGrid, CameraGrid } from './hazards';
import { ITEMS } from '@/content/items';
import { DAEMONS } from '@/content/hacks';
import { XP_REWARDS, empRadius, stealthMeter } from '@/content/progression';
import type { Bunker as BunkerDef, BunkerEntryDef, BunkerSecurity, LockCard, LockMethod } from '@/content/types';
import type { Action, GameContext, Interactable } from '../context';
import type { LoopHandle } from '@/engine/audio';

/**
 * The bunker runtime: one heist site described by data (`content/bunkers/<id>.ts`, its `security`)
 * plus a builder (geometry → `BunkerShell` handles). A bunker class extends this, builds its shell in
 * the constructor, registers its drones with `guard()`, then calls `init()`. What it runs:
 *
 * - **Entries** (gate, doors, vault): a lock with a primary method and an optional secondary (one
 *   method, or a choice card). Methods: lockpick, circuit, keypad (hints, lockout), SPLICE (daemons
 *   go to `onDaemon`), breach charge (quiet at Demolition 4 crouched), open (a known gap).
 * - **Hazards** (`hazards.ts`): tripwires, a laser grid with its power box, security cameras; drones
 *   (`Drone`) with their events, EMP and the zap.
 * - **Alarm**: `triggerAlarm(at, reason)` rings for `alarmTime`, sends drones to `at`, the owner barks.
 * - **Owner voice**: greeting, periodic taunts near the fence, reaction lines.
 * - **Loot**: containers behind an entry, filled from `def.loot`; all looted = busted (+XP, banner).
 * - **Interior mode**: the inside box + portal entries become an `Interior` (world/interiors.ts).
 * - **Save flags**, derived from ids (see content/types.ts): `<id>.<entry>.open`,
 *   `<id>.<wire>.disarmed`, `<id>.lasers.off`, `<id>.cameras.off`, `<id>.loot.<spot>`, `<id>.complete`.
 *   `applyFlags(instant)` makes the world match them (boot, load, every change).
 *
 * Hooks for the bunker class: `talk()` (intercoms), `onDaemon()`, `daemonPending()`, `frame()`,
 * `updateLights()`, `objective()`, `startAudio()`.
 */
export abstract class Bunker<S extends BunkerShell = BunkerShell> {
  readonly id: string;
  readonly sec: BunkerSecurity;
  readonly b: S;
  readonly drones: Drone[] = [];
  /** hot sparks (drone brown-outs and crashes, shorted boxes, EMP bursts) */
  readonly sparks = new Sparks();
  readonly interactables: Interactable[] = [];
  playerInside = false;
  /** In the compound (the builder's `groundsBox`). */
  playerOnGrounds = false;
  /** Seconds of alarm left (> 0 = ringing). */
  alarm = 0;
  tripwires: Tripwires | null = null;
  lasers: LaserGrid | null = null;
  cameras: CameraGrid | null = null;
  /** Seconds since the bunker was built (drives pulses and flicker). */
  protected t = 0;
  private wrongCodes: Record<string, number> = {};
  private tauntTimer = 6;
  private tauntIdx = 0;
  private greeted = false;
  private droneLoops: (LoopHandle | null)[] = [];
  private _interior: Interior | null = null;
  // per-frame scratch (update() runs every frame; no garbage in the hot path)
  private readonly prevFeet = new THREE.Vector2();
  private readonly feet2 = new THREE.Vector2();
  private readonly probe = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();

  constructor(readonly ctx: GameContext, readonly def: BunkerDef, shell: (origin: THREE.Vector3) => S) {
    if (!def.security) throw new Error(`bunker ${def.id} has no security data`);
    this.id = def.id;
    this.sec = def.security;
    const [x, , z] = def.location.position;
    this.b = shell(new THREE.Vector3(x, ctx.hf.heightAt(x, z), z));
    ctx.scene.add(this.b.group);
  }

  /** Register a patrol drone: its events become the bunker's (alarm, zap, lines). Before `init()`. */
  protected guard(drone: Drone) {
    const { ctx } = this, lines = this.sec.drones;
    drone.events = {
      onStateChange: (s, prev) => this.onDroneState(drone, s, prev),
      onZap: () => this.zap(drone),
      onSputter: () => {
        ctx.audio.play('droneSputter', { pos: drone.position });
        if (lines && this.distToPlayer() < 30) ctx.ui.subtitle(lines.sputter.speaker, lines.sputter.text);
      },
      onCrash: (k) => {
        ctx.audio.play('thud', { pos: drone.position, intensity: 0.4 + k * 0.5 });
        ctx.audio.play('bounce', { pos: drone.position, intensity: 0.6 + k * 0.4 });
        ctx.puffs?.emit(drone.position.clone().setY(drone.position.y - 0.3), 10, 1 + k * 1.5, 0.4, 0.45);
      },
    };
    ctx.scene.add(drone.group);
    this.drones.push(drone);
    return drone;
  }

  /** Finish construction: hazards from data, the world from saved flags, the interactables. */
  protected init() {
    const { ctx, sec, b } = this;
    ctx.scene.add(this.sparks.sprite);
    for (const d of this.drones) d.fx = { sparks: this.sparks, get puffs() { return ctx.puffs; } };
    if (sec.tripwires && b.tripwires.length) this.tripwires = new Tripwires(this, b.tripwires, sec.tripwires);
    if (sec.lasers && b.lasers.length) this.lasers = new LaserGrid(this, b.lasers, sec.lasers);
    if (sec.cameras && b.cameras?.length) this.cameras = new CameraGrid(this, b.cameras, sec.cameras);
    this.applyFlags(true);
    this.buildInteractables();
  }

  /** The run's state. Null on the title screen: only touch it from interactions and update(). */
  get state() {
    return this.ctx.state;
  }

  protected get s() {
    return this.ctx.state;
  }

  // ------------------------------------------------------------------ flags
  /** `<bunker id>.<name>`: every save flag the runtime writes. */
  flag(name: string) {
    return `${this.id}.${name}`;
  }

  entryFlag(entry: string) {
    return this.flag(`${entry}.open`);
  }

  isOpen(entry: string) {
    return this.s.has(this.entryFlag(entry));
  }

  get complete() {
    return this.s.has(this.flag('complete'));
  }

  protected entry(id: string) {
    const e = this.sec.entries.find((x) => x.id === id);
    if (!e) throw new Error(`${this.id}: no entry ${id}`);
    return e;
  }

  protected distToPlayer() {
    const pl = this.ctx.player as GameContext['player'] | null;
    return pl ? pl.position.distanceTo(this.b.origin) : Infinity;
  }

  /** Make the world match saved progress. */
  applyFlags(instant = false) {
    const st = this.ctx.state as GameContext['state'] | null;
    const has = (f: string) => st?.has(f) ?? false;
    for (const e of this.sec.entries) {
      const on = has(this.entryFlag(e.id));
      for (const d of e.doors) this.setDoor(this.b.doors[d], on, instant);
      if (e.lockMesh) this.b.lockMeshes![e.lockMesh].visible = !on;
    }
    this.lasers?.applyFlags(has);
    this.tripwires?.applyFlags(has);
    this.cameras?.applyFlags(has);
    for (const spot of this.b.lootSpots) {
      if (!spot.lid) continue;
      spot.lid.userData.opening = false;
      spot.lid.rotation.x = has(this.flag(`loot.${spot.id}`)) ? -1.9 : 0;
    }
    // a fresh run or a loaded save: the owner greets you again and the keypads forget your guesses.
    // Not on every door opening (that replayed the greeting over his own "My gate!" line, and
    // wiped a keypad's wrong-code count)
    if (instant) {
      this.wrongCodes = {};
      this.greeted = false;
    }
  }

  private setDoor(d: Door, on: boolean, instant: boolean) {
    d.target = on ? 1 : 0;
    if (instant) d.open = d.target;
    if (on && d.collider) {
      this.ctx.physics.world.removeCollider(d.collider, false);
      d.collider = null;
    } else if (!on && !d.collider) {
      d.collider = this.ctx.physics.addBox(d.colliderSpec.pos, d.colliderSpec.half);
    }
  }

  // ------------------------------------------------------------------ interactables
  private buildInteractables() {
    const { sec, b } = this;
    for (const e of sec.entries) {
      const sec2 = e.secondary;
      this.interactables.push({
        id: e.id,
        pos: b.points[e.point],
        radius: e.radius,
        visible: () => !this.isOpen(e.id) && (!e.needs || this.s.has(e.needs)),
        primary: this.methodAction(e, e.primary),
        secondary: !sec2 ? undefined : 'methods' in sec2
          ? { label: sec2.label, available: () => true, run: () => this.card(e, sec2) }
          : this.methodAction(e, sec2),
      });
    }
    for (const ic of sec.intercoms ?? []) {
      const at = b.points[ic.point];
      this.interactables.push({
        id: ic.id,
        pos: new THREE.Vector3(at.x + ic.offset[0], b.origin.y + ic.y, at.z + ic.offset[1]),
        radius: ic.radius,
        visible: () => !ic.until || !this.s.has(ic.until),
        primary: { label: ic.label, available: () => true, run: () => this.talk() },
      });
    }
    if (this.tripwires) this.interactables.push(...this.tripwires.interactables());
    if (this.lasers) this.interactables.push(...this.lasers.interactables());
    for (const c of sec.loot.containers) {
      const spot = b.lootSpots.find((l) => l.id === c.id);
      if (!spot) throw new Error(`${this.id}: no loot spot ${c.id}`);
      this.interactables.push({
        id: c.id,
        pos: spot.pos,
        radius: 1.9,
        visible: () => this.isOpen(sec.loot.behind) && !this.s.has(this.flag(`loot.${c.id}`)),
        primary: { label: c.label, available: () => true, run: () => this.loot(c.id) },
      });
    }
  }

  /** Can this method be used right now? true, or the reason it can't. */
  protected methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    switch (m.kind) {
      case 'lockpick': return this.s.count('lockpick') > 0 ? true : 'Need a lockpick';
      case 'charge': return this.chargeReason(m.demolition);
      case 'circuit':
      case 'splice': return this.s.skill('electronics') >= m.electronics ? true : `Requires Electronics ${m.electronics}`;
      case 'keypad': return (this.wrongCodes[e.id] ?? 0) >= m.lockout ? m.lockedLabel : true;
      case 'open': return true;
    }
  }

  private methodAction(e: BunkerEntryDef, m: LockMethod): Action {
    return {
      label: m.kind === 'lockpick' ? `Pick lock · ${m.pins} pins` : m.label,
      available: () => this.methodReason(e, m),
      run: () => this.runMethod(e, m),
    };
  }

  private async card(e: BunkerEntryDef, card: LockCard) {
    const pick = await this.ctx.ui.choose({
      speaker: card.speaker,
      text: card.text,
      choices: [
        ...card.methods.map((m) => {
          const why = this.methodReason(e, m);
          return { id: m.id ?? m.kind, label: m.kind === 'lockpick' ? `Pick lock · ${m.pins} pins` : m.label, disabled: why === true ? undefined : why };
        }),
        { id: 'no', label: card.leave },
      ],
    });
    const m = card.methods.find((x) => (x.id ?? x.kind) === pick);
    if (m) await this.runMethod(e, m);
  }

  protected async runMethod(e: BunkerEntryDef, m: LockMethod) {
    const { ctx } = this;
    const at = this.b.points[e.point];
    switch (m.kind) {
      case 'lockpick': {
        const picks = () => this.s.count('lockpick');
        const res = await ctx.ui.lockpick({
          pins: m.pins,
          title: m.title,
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.s.events.emit('toast', { text: `Lockpick snapped (${picks()} left)`, kind: 'bad' });
            return picks() > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          ctx.audio.play('unlock', { pos: ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + m.pins * 5, 'Lock picked');
          this.openEntry(e.id);
        }
        return;
      }
      case 'charge': return this.breach(e, m);
      case 'open':
        this.openEntry(e.id);
        this.s.addXP(m.xp, m.reason);
        if (m.toast) this.s.events.emit('toast', { text: m.toast, kind: 'good' });
        return;
      case 'circuit': {
        const ok = await ctx.ui.circuit({ title: m.title, difficulty: m.difficulty });
        if (ok) {
          this.s.addXP(m.xp, m.reason);
          this.openEntry(e.id);
        }
        return;
      }
      case 'keypad': {
        const hint = m.hints.find((h) => h.when.some((f) => this.s.has(f)))?.text ?? m.hint;
        const res = await ctx.ui.keypad({ title: m.title, code: m.code, hint });
        if (res === 'ok') {
          this.s.addXP(m.xp, m.reason);
          this.openEntry(e.id);
        } else if (res === 'wrong') {
          this.wrongCodes[e.id] = (this.wrongCodes[e.id] ?? 0) + 1;
          if (this.wrongCodes[e.id] >= m.lockout) this.triggerAlarm(at, m.lockoutReason);
        }
        return;
      }
      case 'splice': {
        const daemons = m.daemons.filter((id) => this.daemonPending(id)).map((id) => DAEMONS[id]);
        const res = await ctx.ui.hack({ title: m.title, host: m.host, difficulty: m.difficulty, daemons: daemons.map(({ id, name, blurb }) => ({ id, name, blurb })) });
        if (res.aborted) return;
        if (res.done.length) this.s.addXP(m.xpEach * res.done.length, m.reason);
        for (const id of res.done) this.onDaemon(id);
        if (res.traced) this.triggerAlarm(at, m.traced);
        return;
      }
    }
  }

  /**
   * Open an entry: flag, doors, the door sound, then the owner's line. `line`/`trauma` override the
   * entry's own (null line: say nothing).
   */
  openEntry(id: string, opts: { line?: string | null; trauma?: number } = {}) {
    const e = this.entry(id);
    this.s.set(this.entryFlag(id));
    this.applyFlags();
    this.ctx.audio.play('door', { pos: this.b.points[e.point] });
    const trauma = opts.trauma ?? e.trauma;
    if (trauma) this.ctx.cam.addTrauma(trauma);
    const line = opts.line !== undefined ? opts.line : e.line;
    if (line) this.taunt(line);
  }

  protected chargeReason(demolition: number): true | string {
    if (this.s.skill('demolition') < demolition) return `Requires Demolition ${demolition}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private breach(e: BunkerEntryDef, m: Extract<LockMethod, { kind: 'charge' }>) {
    if (this.chargeReason(m.demolition) !== true) { this.ctx.audio.play('deny'); return; }
    if (!this.s.removeItem('charge', 1)) return;
    const quiet = m.quiet && this.s.skill('demolition') >= 4 && this.ctx.player.crouching;
    this.openEntry(e.id, m.line !== undefined ? { line: m.line } : {});
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.85 });
    this.ctx.cam.addTrauma(quiet ? 0.15 : 0.45);
    if (quiet) this.s.events.emit('toast', { text: 'Shaped charge. The alarm stayed asleep.', kind: 'good' });
    else this.triggerAlarm(this.b.points[e.point], m.loud);
    this.s.addXP(XP_REWARDS.breach, 'Lock breached');
  }

  /** Is a SPLICE daemon still worth offering? (Entries: still shut; lasers/cameras: still on.) */
  protected daemonPending(id: string): boolean {
    if (this.sec.entries.some((e) => e.id === id)) return !this.isOpen(id);
    if (id === 'lasers') return !!this.lasers && !this.lasers.off;
    if (id === 'cameras') return !!this.cameras && !this.cameras.off;
    return true;
  }

  /** A SPLICE daemon got through. Default: entries open, lasers and cameras die. */
  protected onDaemon(id: string) {
    if (this.sec.entries.some((e) => e.id === id)) this.openEntry(id);
    else if (id === 'lasers') this.lasers?.kill();
    else if (id === 'cameras') this.cameras?.kill();
  }

  /** The intercoms. */
  protected talk(): void | Promise<void> {}

  // ------------------------------------------------------------------ loot
  private loot(id: string) {
    const { ctx } = this;
    this.s.set(this.flag(`loot.${id}`));
    const spot = this.b.lootSpots.find((l) => l.id === id)!;
    if (spot.lid) spot.lid.userData.opening = true;
    ctx.audio.play('loot');
    const table = this.def.loot, sec = this.sec.loot;
    const take = sec.containers.find((c) => c.id === id)!.take;
    const got: string[] = [];
    if (take === 'guaranteed') {
      // the point of the place comes with you even if the pack is already rude about it
      for (const g of table.guaranteed) {
        const n = this.s.addItem(g.item, g.qty, false, true);
        if (n) got.push(`${n}× ${ITEMS[g.item].name}`);
      }
      if (this.s.weight > this.s.carryLimit + 0.05) this.s.events.emit('toast', { text: sec.overburdened, kind: 'info' });
    } else {
      for (const r of table.rolls.slice(take[0], take[1])) {
        if (Math.random() > r.chance) continue;
        const qty = r.qty[0] + Math.floor(Math.random() * (r.qty[1] - r.qty[0] + 1));
        const n = this.s.addItem(r.item, qty);
        if (n) got.push(`${n}× ${ITEMS[r.item].name}`);
      }
    }
    ctx.ui.banner('LOOTED', got.join('  ·  '), 'good');
    const all = sec.containers.every((c) => this.s.has(this.flag(`loot.${c.id}`)));
    if (all && this.s.set(this.flag('complete'))) {
      this.s.data.stats.busted++;
      setTimeout(() => {
        this.s.addXP(table.xp, sec.busted.reason);
        ctx.audio.sting('busted');
        ctx.ui.banner('BUNKER BUSTED', sec.busted.banner, 'good');
        this.s.events.emit('bunkerComplete', { id: this.id });
        this.taunt(sec.busted.line);
      }, 1800);
    }
  }

  // ------------------------------------------------------------------ voice + alarm
  /** The owner over the speaker: a given line, or the next stock taunt. */
  taunt(text?: string) {
    const taunts = this.def.owner.taunts;
    const line = text ?? taunts[this.tauntIdx++ % taunts.length];
    if (!line) return;
    const at = this.b.points[this.sec.voice.point];
    this.ctx.audio.play('megaphone', { pos: at });
    this.ctx.ui.subtitle(this.def.owner.name, line, { pos: at });
  }

  triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    const barks = this.sec.voice.alarm;
    this.alarm = this.sec.alarmTime;
    this.ctx.audio.setAlarm(true, this.b.points[this.sec.voice.point]);
    this.s.events.emit('toast', { text: reason, kind: 'bad' });
    if (at) for (const d of this.drones) d.investigate(at);
    if (Math.random() < 0.7) this.taunt(barks[Math.floor(Math.random() * barks.length)]);
  }

  // ------------------------------------------------------------------ drones
  private onDroneState(drone: Drone, s: DroneState, prev: DroneState) {
    const a = this.ctx.audio, lines = this.sec.drones;
    if (s === 'suspicious') a.play('droneAlert', { pos: drone.position });
    if (s === 'alert') this.triggerAlarm(null, lines?.spotted ?? 'Spotted!');
    if (s === 'disabled') a.play('emp', { pos: drone.position });
    if (prev === 'disabled' && s === 'patrol') {
      a.play('droneAlert', { pos: drone.position });
      if (lines && this.distToPlayer() < 35) this.ctx.ui.subtitle(lines.reboot.speaker, lines.reboot.text);
    }
  }

  private zap(drone: Drone) {
    const { ctx } = this;
    ctx.audio.play('zap');
    ctx.post.damage.value = 1;
    ctx.cam.addTrauma(0.9);
    ctx.caught(this.sec.drones?.zapped ?? 'Caught.');
    drone.detection = 0;
  }

  /** EMP blast from the player's grenade. True if it fried anything here. */
  emp(pos: THREE.Vector3, _radius?: number) {
    let reach = empRadius(this.s.skill('demolition'));
    if (this.s.focus('demolition') === 'wide') reach *= 1.18;
    let hit = false;
    for (const drone of this.drones) {
      if (drone.position.distanceTo(pos) > reach || drone.state === 'disabled') continue;
      let dur = 12 * (this.s.skill('electronics') >= 2 ? 1.5 : 1);
      if (this.s.focus('electronics') === 'deepcell') dur *= 1.3;
      drone.emp(dur);
      const lines = this.sec.drones;
      this.s.addXP(XP_REWARDS.droneEmp, lines?.empReason ?? 'Drone fried');
      if (lines) this.ctx.ui.subtitle(lines.emp.speaker, lines.emp.text);
      hit = true;
    }
    return hit;
  }

  /** Any drone hunting you right now. */
  get droneAlert() {
    return this.drones.some((d) => d.state === 'alert');
  }

  startAudio() {
    this.drones.forEach((d, i) => { this.droneLoops[i] ??= this.ctx.audio.loop('drone', d.position); });
  }

  // ------------------------------------------------------------------ interior mode + culling
  /**
   * The inside as a sealed interior (see world/interiors.ts): the builder's `innerBox`; the portals
   * are the `portals` entries' first doors, while they're open.
   */
  get interior() {
    if (this._interior) return this._interior;
    const hb = this.b.innerBox;
    const portals = this.sec.portals.map(({ entry, pad }) => {
      const door = this.b.doors[this.entry(entry).doors[0]];
      const { pos, half } = door.colliderSpec;
      const box = new THREE.Box3(pos.clone().sub(half), pos.clone().add(half)).expandByVector(new THREE.Vector3(...pad));
      return { box, open: () => door.open > 0.005 || door.target > 0 };
    });
    return (this._interior = new Interior(this.id, new THREE.Matrix4(),
      (p) => p.x > hb.min.x + 0.05 && p.x < hb.max.x - 0.05 && p.z > hb.min.z + 0.05 && p.z < hb.max.z - 0.05 && p.y < hb.max.y,
      portals,
      [this.b.group, ...this.drones.map((d) => d.group)]));
  }

  /**
   * Draw culling only (no gameplay): the builder's LOD, and the inside-only draws whenever nobody can
   * see in (from inside, or near an open portal).
   */
  cull(cam: THREE.Vector3) {
    this.b.lod?.update(cam);
    if (!this.b.interior) return;
    const hb = this.b.innerBox;
    const inside = cam.x > hb.min.x - 0.5 && cam.x < hb.max.x + 0.5 && cam.z > hb.min.z - 0.5 && cam.z < hb.max.z + 0.5 && cam.y < hb.max.y + 1;
    const throughDoor = this.sec.portals.some(({ entry }) => {
      const e = this.entry(entry), d = this.b.doors[e.doors[0]];
      return (d.open > 0.01 || d.target > 0) && cam.distanceToSquared(this.b.points[e.point]) < 32 * 32;
    });
    this.b.interior.visible = inside || throughDoor;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    const { ctx } = this;
    this.t += dt;
    this.sparks.update(dt);
    const player = ctx.player as GameContext['player'] | null;
    if (!player) { this.updateAmbient(dt); return; }
    const p = player.position;
    const feet2 = this.feet2.set(p.x, p.z);
    const ib = this.b.innerBox, gb = this.b.groundsBox;
    this.playerInside = ib.containsPoint(this.probe.copy(p).setY(ib.min.y + 1));
    this.playerOnGrounds = gb.containsPoint(this.probe.copy(p).setY(gb.min.y + 1));
    this.frame(dt, p);

    this.animateDoors(dt);
    for (const spot of this.b.lootSpots) {
      if (spot.lid?.userData.opening) spot.lid.rotation.x += (-1.9 - spot.lid.rotation.x) * (1 - Math.exp(-5 * dt));
    }

    this.tripwires?.update(dt, player, this.prevFeet, feet2);
    this.lasers?.update(dt, this.t, this.alarm > 0, player, this.playerInside);

    const night = ctx.atmo.uNight.value as number;
    const stealthMult = ctx.state.archetype.stats.stealth * stealthMeter(this.s.skill('stealth')) * (this.s.skill('electronics') >= 3 ? 0.85 : 1);
    this.chest.copy(p).setY(p.y + (player.crouching ? 0.7 : 1.2));
    this.cameras?.update(dt, this.t, this.chest, stealthMult * (player.crouching ? 0.6 : 1), player.collider);
    this.drones.forEach((drone, i) => {
      drone.update(dt, {
        playerChest: this.chest,
        playerFeet: this.feet.copy(p),
        noise: player.noise,
        stealthMult,
        playerCollider: player.collider,
        night,
        insideHouse: this.playerInside,
        visibility: ctx.atmo.visibility,
      });
      const loop = this.droneLoops[i];
      loop?.setPosition(drone.position);
      loop?.setGain(drone.state === 'disabled' ? 0 : drone.state === 'sputter' ? 0.35 : 0.9);
      loop?.setPitch(drone.state === 'alert' ? 1.25 : drone.state === 'sputter' ? 0.7 : 1);
    });

    // alarm decay (a drone on your tail keeps it ringing)
    if (this.alarm > 0) {
      this.alarm -= dt;
      if (this.alarm <= 0 && !this.droneAlert) ctx.audio.setAlarm(false);
      else if (this.droneAlert) this.alarm = Math.max(this.alarm, 1);
    }

    this.updateLights(dt, night);

    // the owner: a greeting, then taunts while you hang around outside
    const v = this.sec.voice;
    const d = this.distToPlayer();
    if (!this.greeted && d < v.greetRadius) {
      this.greeted = true;
      this.taunt(v.greet);
      this.tauntTimer = 30;
    }
    if (d < v.tauntRadius && !this.complete && !this.playerInside) {
      this.tauntTimer -= dt;
      if (this.tauntTimer <= 0) {
        this.tauntTimer = 28 + Math.random() * 20;
        this.taunt();
      }
    }

    this.prevFeet.copy(feet2);
  }

  private animateDoors(dt: number) {
    for (const d of Object.values(this.b.doors)) {
      d.open += (d.target - d.open) * (1 - Math.exp(-3 * dt));
      // sliding doors move along x from where the builder put them (userData.x0); the rest swing
      if (d.axis === 'slide') d.pivot.position.x = (d.pivot.userData.x0 ?? 0) + d.open * d.amount;
      else d.pivot.rotation.y = d.open * d.amount;
    }
  }

  /** Title-screen mode: no player, just make the place feel alive. */
  private updateAmbient(dt: number) {
    this.sparks.update(dt);
    this.animateDoors(dt);
    const night = this.ctx.atmo.uNight.value as number;
    const far = new THREE.Vector3(0, -1000, 0);
    this.drones.forEach((drone, i) => {
      drone.update(dt, { playerChest: far, playerFeet: far, noise: 0, stealthMult: 0, playerCollider: undefined, night, insideHouse: false });
      this.droneLoops[i]?.setPosition(drone.position);
    });
    this.updateLights(dt, night);
  }

  /** Per-frame visual upkeep with a player (before doors and hazards). */
  protected frame(_dt: number, _player: THREE.Vector3) {}

  /** The bunker's lights (alarm colours, flicker, night). Runs every frame, with or without a player. */
  protected updateLights(_dt: number, _night: number) {}

  /** Context-sensitive advice while you're here ('' elsewhere). */
  objective(): string {
    return '';
  }
}
