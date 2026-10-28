import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { CathedralBuilder, CT } from './CathedralBuilder';
import { paintBoard, type BoardView } from './cathedralAtlas';
import { uCathGlow, uCathAlarm } from './cathedralFx';
import { Swarm, type SwarmHost } from './swarm';
import { Floor, type FloorHost } from './floor';
import {
  CATHEDRAL, CATHEDRAL_FLAGS as F, LO, ORRIN_LINES, DRONE_LINES, ASSOC_LINES, LO_TALK, ORRIN_TALK, NETWORK,
  PLAQUE, KIOSK_DONE, ORRIN_AFTER,
  type CathedralTalk, type CathedralView, type CathedralChoice,
} from '@/content/bunkers/cathedral';
import { DAEMONS } from '@/content/hacks';
import { START_DAY } from '../../State';
import { stealthMeter } from '@/content/progression';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import type { GameContext } from '../../context';
import type { Combat } from '../../combat/Combat';
import { box, MeshBatch } from '../../world/kit';
import { plainStandard } from '../../world/materials';

/** Seconds an E-stop holds the floor. */
const ESTOP = 90;
/** The returns line's speed (m/s). */
const RIDE = 2.6;

/**
 * Tier 6, the Cloud Cathedral (Act VI): Orrin Sayle's fulfilment centre in the north basin. Entries,
 * the alarm and the loot are data (content/bunkers/cathedral.ts) run by the bunker runtime. What's
 * the Cathedral's own:
 * - the swarm (swarm.ts): delivery drones over the lot and two floor drones inside. Seen, you're
 *   tagged as an address and they converge; enough of them on you and you're returned to sender
 *   (outside the lot, or out of the dock). Riders on Rider 9's open order aren't tagged outside.
 * - the floor (floor.ts): shelf pods moving cell to cell; stand in a drive's way and it stops and
 *   reports an obstruction (a floor drone comes to look). Mateo's badge (Lo) makes them route round.
 *   The floor kiosk's SPLICE E-stops it for a minute and a half.
 * - the returns line: the kiosk takes Rider 9's order number and you ride in a tote, over the east
 *   aisle and down into the crossing.
 * - the people: Orrin in the Day 1 office, Lo at the lead's desk, two pickers, one carrier.
 * - the ending at Orrin's console: shut it down (the doors open, the associates walk out) or transfer
 *   it to the associates (they run it, Orrin works returns, a drone delivers to the camp).
 */
export class Cathedral extends Bunker<CathedralBuilder> {
  readonly swarm: Swarm;
  readonly floor: Floor;
  private combat: Combat | null = null;
  private orrin: { actor: NpcActor; look: number; at: { pos: THREE.Vector3; yaw: number } } | null = null;
  private lo: { actor: NpcActor; look: number } | null = null;
  private pickers: NpcActor[] = [];
  private carrier: { actor: NpcActor; root: THREE.Object3D; seg: number; dir: number; pause: number } | null = null;
  private ride: { s: number; len: number[]; total: number } | null = null;
  /** Where the ride last put you. */
  private readonly rideAt = new THREE.Vector3();
  private eStop = 0;
  private obstructions = 0;
  private lastObstructionLine = -99;
  private assocLine = -99;
  private assocIdx = 0;
  private boardKey = '';
  private asking = false;
  private leaveT = -1;
  private orrinIdx = 0;
  private tagSaid = -99;
  private readonly eye = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(ctx: GameContext) {
    super(ctx, CATHEDRAL, (origin) => new CathedralBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    const b = this.b;
    b.frontOpen = () => this.has('cathedral.end.close') || this.has('cathedral.end.hand');
    this.swarm = new Swarm(this.swarmHost(), b.swarmRoutes, b.floorRoutes, b.launch);
    this.floor = new Floor(ctx.physics, b.origin, this.floorHost());
    // (world-space instances, parented under the bunker so interior mode keeps them with the hall)
    for (const g of [this.swarm.group, this.floor.group]) {
      g.position.copy(b.origin).negate();
      b.group.add(g);
    }
    this.init();
    this.extraInteractables();
  }

  /** Game: the drones are hostiles (shootable) and need Combat's line-of-sight test. */
  attach(combat: Combat) {
    this.combat = combat;
    combat.register(this.swarm);
  }

  // ------------------------------------------------------------------ flags
  private has(f: string) {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(f);
  }

  private get ended() {
    return this.has('cathedral.end.close') || this.has('cathedral.end.hand');
  }

  private get badge() {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st && st.count('mateo_badge') > 0;
  }

  // ------------------------------------------------------------------ the swarm and the floor
  private swarmHost(): SwarmHost {
    const ctx = this.ctx;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get combat() { return self.combat!; },
      audio: ctx.audio,
      say: (line, pos) => { if (pos.distanceTo(ctx.player.position) < 40) ctx.ui.subtitle(line.speaker, line.text, { pos }); },
      floor: (x, z, y) => {
        if (this.b.contains(this.tmp.set(x, this.b.origin.y + 1, z))) return this.b.origin.y;
        const hit = ctx.physics.raycast({ x, y: y + 0.5, z }, { x: 0, y: -1, z: 0 }, 30);
        return hit !== null ? y + 0.5 - hit : ctx.hf.heightAt(x, z);
      },
      inside: (p) => this.b.contains(p),
      covered: (p, crouch) => this.b.cover.some((c) => p.x > c.min.x && p.x < c.max.x && p.z > c.min.z && p.z < c.max.z && p.y < c.max.y && (crouch || c.max.y - p.y > 2.5)),
      sight: (inside) => {
        const st = this.s;
        const k = st.archetype.stats.stealth * stealthMeter(st.skill('stealth'));
        return k * (inside ? 1 : 1.05);
      },
      exempt: (inside) => (inside ? this.badge : this.has('q.rider.log')),
      mode: () => (this.has('cathedral.end.close') ? 'off' : this.has('cathedral.end.hand') ? 'friendly' : this.has(F.grounded) ? 'grounded' : 'no'),
      night: () => ctx.atmo.uNight.value as number,
      onTag: (inside) => {
        if (this.t - this.tagSaid > 20) {
          this.tagSaid = this.t;
          this.s.events.emit('toast', { text: inside ? 'A floor drone has you. Get out of its sight, or the floor drones will put you out of the dock.' : 'Tagged as a delivery address. The swarm is coming. Get under something, or out of sight.', kind: 'bad' });
        }
        this.s.set(F.loud);
      },
      onLost: () => {},
      onCatch: (inside) => this.caught(inside),
      onDown: (_d, how) => { if (this.s.set('cathedral.droneDown')) this.s.addXP(20, how === 'emp' ? 'Swarm fried' : 'Drone down'); },
      onRider: () => {
        const d = this.swarm.list.find((x) => !x.inside && x.alive);
        if (d) ctx.ui.subtitle(DRONE_LINES.rider.speaker, DRONE_LINES.rider.text, { pos: d.pos });
        if (this.s.set('cathedral.rider')) this.s.events.emit('toast', { text: 'The drones read you as Rider 9\'s replacement on an open order. They let you be.', kind: 'good' });
      },
      lines: { tag: DRONE_LINES.tag, lost: DRONE_LINES.lost, floor: DRONE_LINES.floor },
    };
  }

  private floorHost(): FloorHost {
    return {
      badge: () => this.badge || this.has('cathedral.end.hand'),
      mode: () => (this.has('cathedral.end.close') ? 'off' : this.eStop > 0 ? 'stop' : 'moving'),
      onObstruction: (p) => {
        this.obstructions++;
        this.swarm.inspect(p);
        this.ctx.audio.combat?.machine('beep', p, 0.7);
        if (this.t - this.lastObstructionLine > 45) {
          this.lastObstructionLine = this.t;
          this.taunt(ORRIN_LINES.obstruction.text);
        }
      },
    };
  }

  /** Returned to sender: out of the lot (outside), or out through the dock (the floor). */
  private caught(inside: boolean) {
    const ctx = this.ctx, s = this.s;
    s.set(F.caught);
    ctx.ui.subtitle(DRONE_LINES.catch.speaker, DRONE_LINES.catch.text);
    const to = inside ? this.b.w(CT.AW + 5, 0, 14) : this.b.points.outside.clone();
    to.y = ctx.hf.heightAt(to.x, to.z);
    ctx.caught(inside
      ? 'Two floor drones hook your collar and steer you down the aisle and out through the dock. RETURNED TO SENDER.'
      : 'Six drones hook onto your pack straps and fly you, a metre off the ground, to the edge of the lot. RETURNED TO SENDER.', { to, yaw: inside ? Math.PI / 2 : 0, gentle: true });
    setTimeout(() => {
      this.swarm.resetAll();
      this.alarm = 0;
      this.taunt(ORRIN_LINES.caught.text);
    }, 1600);
  }

  // ------------------------------------------------------------------ people (Meshy models, from Game.build)
  addPeople(models: NpcModels | null) {
    const b = this.b;
    const put = (actor: NpcActor, spot: { pos: THREE.Vector3; yaw: number }) => {
      actor.root.position.set(spot.pos.x - b.origin.x, spot.pos.y - b.origin.y, spot.pos.z - b.origin.z);
      actor.root.rotation.y = spot.yaw;
      b.group.add(actor.root);
    };
    const orrin = models?.make('orrin', false, 0) ?? null;
    if (orrin) {
      orrin.setIdle(['idle', 'idle2', 'idle_m']);
      put(orrin, b.orrinSpot);
      this.orrin = { actor: orrin, look: 0, at: b.orrinSpot };
    }
    const lo = models?.make('assoc', false, 0) ?? null;
    if (lo) {
      put(lo, b.loSpot);
      this.lo = { actor: lo, look: 0 };
    }
    for (const st of b.stations) {
      const a = models?.make('assoc', false, 0) ?? null;
      if (!a) continue;
      a.setIdle(['pick']);
      put(a, st);
      this.pickers.push(a);
    }
    const c = models?.make('assoc', false, 0) ?? null;
    if (c) {
      c.setIdle(['carry']);
      const r = b.carrierRoute;
      put(c, { pos: r[0], yaw: Math.PI / 2 });
      c.root.add(toteMesh());
      this.carrier = { actor: c, root: c.root, seg: 0, dir: 1, pause: 0 };
    }
    this.applyFlags(true);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    const end = this.ended;
    // the front doors open at the ending (no lock of their own)
    for (const id of ['frontW', 'frontE']) {
      const d = this.b.doors[id];
      if (!d) continue;
      d.target = end ? 1 : 0;
      if (instant) d.open = d.target;
      if (end && d.collider) { this.ctx.physics.world.removeCollider(d.collider, false); d.collider = null; }
    }
    const gone = this.has('cathedral.assoc.gone');
    for (const a of this.pickers) a.root.visible = !gone;
    if (this.carrier) this.carrier.root.visible = !gone;
    if (this.lo) this.lo.actor.root.visible = !gone;
    // the transfer: Orrin works the returns table
    if (this.orrin) {
      const at = this.has('cathedral.end.hand') ? this.returnsSpot() : this.b.orrinSpot;
      this.orrin.at = at;
      const o = this.b.origin;
      this.orrin.actor.root.position.set(at.pos.x - o.x, at.pos.y - o.y, at.pos.z - o.z);
      this.orrin.actor.root.rotation.y = at.yaw;
      this.orrin.actor.setIdle(this.has('cathedral.end.hand') ? ['pick'] : ['idle', 'idle2', 'idle_m']);
    }
  }

  private returnsSpot() {
    return { pos: this.b.w(6.4, 0, -19.9), yaw: Math.PI };
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.interactables.push({
      id: 'cath-ride', pos: b.points.kiosk, radius: 2.2,
      visible: () => this.isOpen('returns') && !this.ride && !this.ended,
      primary: { label: 'Climb into a returns tote', available: () => true, run: () => this.startRide() },
    });
    this.interactables.push({
      id: 'cath-plaque', pos: b.points.plaque, radius: 1.8,
      visible: () => true,
      primary: { label: 'Read the plaque', available: () => true, run: () => this.readPlaque() },
    });
    this.interactables.push({
      id: 'cath-lo', pos: b.points.lo, radius: 2.4,
      visible: () => !!this.lo && this.lo.actor.root.visible,
      primary: {
        get label() { return self.s.has(F.loMet) ? 'Talk to Lo' : 'Talk to the woman at the desk'; },
        available: () => true,
        run: () => {
          if (this.s.set(F.loMet)) this.s.addXP(30, 'The shift lead');
          return this.talkTo(LO_TALK, this.ended ? 'after' : 'hello');
        },
      },
    });
    this.interactables.push({
      id: 'cath-orrin', pos: b.points.orrin, radius: 2.4,
      visible: () => !!this.orrin && this.isOpen('office') && !this.has('cathedral.end.hand'),
      primary: {
        label: 'Talk to Orrin',
        available: () => true,
        run: () => {
          if (this.s.set(F.orrin)) this.s.addXP(30, 'The customer');
          if (this.ended) return this.orrinAfter();
          return this.talkTo(ORRIN_TALK, 'hello');
        },
      },
    });
    this.interactables.push({
      id: 'cath-orrin-returns', pos: this.returnsSpot().pos.clone().setY(b.origin.y + 1.2).add(new THREE.Vector3(0, 0, 1.2)), radius: 2.0,
      visible: () => this.has('cathedral.end.hand'),
      primary: { label: 'Talk to Orrin', available: () => true, run: () => this.orrinAfter() },
    });
    this.interactables.push({
      id: 'cath-console', pos: b.points.console, radius: 1.8,
      visible: () => this.isOpen('office') && !this.ended,
      primary: { label: 'Look at Orrin\'s console', available: () => true, run: () => this.networkCard() },
    });
    this.interactables.push({
      id: 'cath-dockbutton', pos: b.points.dockButton, radius: 1.8,
      visible: () => !this.isOpen('dock'),
      primary: { label: 'Press the dock door\'s UP button', available: () => true, run: () => { this.openEntry('dock', { line: null }); this.s.addXP(10, 'Dock from inside'); } },
    });
    this.interactables.push({
      id: 'cath-floorkiosk', pos: b.points.kioskFloor, radius: 1.9,
      visible: () => !this.ended,
      primary: {
        label: 'Splice the floor kiosk',
        available: () => (this.s.skill('electronics') >= 3 ? true : 'Requires Electronics 3'),
        run: () => this.splice('FLOOR CONTROL', 'DROPT · FLOOR', 3, ['pods']),
      },
    });
    this.interactables.push({
      id: 'cath-swarmpanel', pos: b.points.panel, radius: 1.9,
      visible: () => !this.has(F.grounded) && !this.ended,
      primary: {
        label: 'Splice the swarm controller',
        available: () => (this.s.skill('electronics') >= 4 ? true : 'Requires Electronics 4'),
        run: () => this.splice('SWARM CONTROL', 'DROPT · FLEET', 4, ['swarm']),
      },
    });
  }

  private async splice(title: string, host: string, difficulty: number, daemons: string[]) {
    const pending = daemons.filter((id) => this.daemonPending(id)).map((id) => DAEMONS[id]);
    if (!pending.length) return;
    const res = await this.ctx.ui.hack({ title, host, difficulty, daemons: pending.map(({ id, name, blurb }) => ({ id, name, blurb })) });
    if (res.aborted) return;
    if (res.done.length) this.s.addXP(40 * res.done.length, `Spliced ${title.toLowerCase()}`);
    for (const id of res.done) this.onDaemon(id);
    if (res.traced) this.triggerAlarm(this.ctx.player.position.clone(), 'Trace complete. Dropt flagged the terminal, and the drones turn toward it.');
  }

  private async readPlaque() {
    this.s.set(F.plaque);
    await this.ctx.ui.choose({ speaker: PLAQUE.speaker, text: PLAQUE.text, choices: [{ id: 'ok', label: 'Step back' }] });
  }

  private orrinAfter() {
    const lines = this.has('cathedral.end.hand') ? ORRIN_AFTER.hand : ORRIN_AFTER.close;
    const l = lines[this.orrinIdx++ % lines.length];
    this.ctx.ui.subtitle(l.speaker, l.text, { pos: this.orrin?.at.pos ?? this.b.points.orrin });
  }

  // ------------------------------------------------------------------ the returns line
  private async startRide() {
    if (this.ride || this.asking) return;
    const first = !this.s.has(F.rode);
    if (first) {
      this.asking = true;
      try {
        const pick = await this.ctx.ui.choose({ speaker: KIOSK_DONE.speaker, text: KIOSK_DONE.text, choices: [{ id: 'in', label: 'Climb in and pull the lid over' }, { id: 'no', label: 'Not yet' }] });
        if (pick !== 'in') return;
      } finally {
        this.asking = false;
      }
    }
    const pts = this.b.ride;
    const len: number[] = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); len.push(l); total += l; }
    this.ride = { s: 0, len, total };
    this.b.doors.flap.target = 1;
    const pl = this.ctx.player;
    pl.frozen = true;
    pl.forceCrouch = true;
    pl.teleport(pts[0]);
    this.rideAt.copy(pts[0]);
    this.ctx.audio.play('door', { pos: this.b.points.kiosk });
    this.s.events.emit('toast', { text: 'The tote jerks, and the line takes you in through the flap.', kind: 'info' });
  }

  private tickRide(dt: number) {
    const r = this.ride;
    if (!r) return;
    // something else moved you (down in the dust, walked out): the tote goes on without you.
    // Whoever moved you lets you go again
    if (this.s.data.health <= 0 || this.ctx.player.position.distanceTo(this.rideAt) > 2) {
      this.ride = null;
      this.ctx.player.forceCrouch = false;
      this.b.doors.flap.target = 0;
      return;
    }
    const pts = this.b.ride;
    r.s = Math.min(r.total, r.s + dt * RIDE);
    let s = r.s, i = 0;
    while (i < r.len.length - 1 && s > r.len[i]) { s -= r.len[i]; i++; }
    const p = this.tmp.copy(pts[i]).lerp(pts[i + 1], Math.min(1, s / r.len[i]));
    this.ctx.player.teleport(p);
    this.rideAt.copy(p);
    if (r.s >= r.total - 0.01) {
      this.ride = null;
      const pl = this.ctx.player;
      pl.frozen = false;
      pl.forceCrouch = false;
      this.b.doors.flap.target = 0;
      if (this.s.set(F.rode)) {
        this.s.addXP(50, 'Returned');
        this.taunt(ORRIN_LINES.floor.text);
      }
      this.s.events.emit('toast', { text: 'The tote tips you out by the returns table. You\'re in the crossing, past the floor.', kind: 'good' });
    }
  }

  get riding() {
    return !!this.ride;
  }

  protected override resetRun() {
    this.ride = null;
    this.asking = false;
    // shut down, and the associates hadn't walked out when the game closed: they still go
    this.leaveT = this.has('cathedral.end.close') && !this.has('cathedral.assoc.gone') ? 0 : -1;
  }

  // ------------------------------------------------------------------ conversations
  private view(): CathedralView {
    const s = this.s;
    return {
      social: s.skill('social') + (s.archetype.perk === 'insider' ? 1 : 0),
      electronics: s.skill('electronics'),
      has: (f) => s.has(f),
      count: (id) => s.count(id),
    };
  }

  private talkTo(tree: CathedralTalk, start: string) {
    return this.ctx.ui.converse({
      start,
      node: (id) => {
        const node = tree[id];
        if (!node) return null;
        const v = this.view();
        return {
          speaker: node.speaker,
          text: node.text,
          choices: node.choices.filter((c) => !c.when || c.when(v)).map((c) => ({ id: c.id, label: c.label, next: c.next ?? '', disabled: c.need?.(v) })),
        };
      },
      onChoice: (nodeId, choiceId) => {
        const choice: CathedralChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<CathedralChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'badge':
        if (s.count('mateo_badge') < 1) {
          s.addItem('mateo_badge', 1, false, true);
          s.addRep('lo', 1);
          s.events.emit('toast', { text: 'Mateo\'s badge. The drives route round it, and the floor drones count you as staff.', kind: 'good' });
        }
        return;
      case 'code':
        if (s.set(F.loCode)) s.events.emit('toast', { text: 'The office code is 0001. The stair is behind the altar, on the east side.', kind: 'info' });
        return;
      case 'ready':
        if (s.set(F.loReady)) { s.addRep('lo', 1); s.events.emit('toast', { text: 'Lo will run the place if you can hand it over.', kind: 'info' }); }
        return;
      case 'end':
        setTimeout(() => void this.networkCard(), 300);
        return;
    }
  }

  // ------------------------------------------------------------------ the ending
  private async networkCard() {
    if (this.ended || this.asking) return;
    const v = this.view();
    const canHand = this.has(F.loReady) || v.social >= 4;
    this.asking = true;
    let pick: string | null;
    try {
      pick = await this.ctx.ui.choose({
        speaker: NETWORK.card.speaker,
        text: NETWORK.card.text,
        choices: [
          { id: 'close', label: 'Turn the key: shut the Cathedral down and open the doors' },
          { id: 'hand', label: 'Fill in the transfer: give it to the associates', disabled: canHand ? undefined : NETWORK.handNeeds },
          { id: 'no', label: 'Not yet' },
        ],
      });
    } finally {
      this.asking = false;
    }
    if (pick !== 'close' && pick !== 'hand') return;
    const s = this.s, ui = this.ctx.ui;
    s.set(F.end);
    s.set(`${F.end}.${pick}`);
    s.data.marks['cathedral.endDay'] = s.data.days ?? 0;
    s.addXP(120, pick === 'close' ? 'Site shutdown' : 'Transfer of ownership');
    if (pick === 'close') { s.addRep('compact', 1); s.addRep('lo', 1); s.addRep('orrin', -2); } else { s.addRep('compact', 2); s.addRep('lo', 2); s.addRep('orrin', -1); }
    this.alarm = 0;
    this.ctx.audio.setAlarm(false);
    this.swarm.resetAll();
    if (pick === 'close') {
      this.ctx.audio.play('thud', { pos: this.b.points.console, intensity: 0.5 });
      this.ctx.cam.addTrauma(0.15);
      s.events.emit('toast', { text: 'The key turns. Down on the floor every drive stops where it is. The front doors roll back, and daylight comes in down the nave.', kind: 'good' });
      this.leaveT = 0;
    } else {
      this.ctx.audio.play('disarm', { pos: this.b.points.console });
      s.events.emit('toast', { text: 'You type L. IBARRA into the owner field and press submit. The board over the altar changes. The front doors open.', kind: 'good' });
    }
    this.applyFlags();
    NETWORK[pick].forEach((l, i) => setTimeout(() => ui.subtitle(l.speaker, l.text, { pos: l.speaker === LO ? this.b.points.lo : this.b.points.console }), 600 + i * 4800));
  }

  // ------------------------------------------------------------------ the runtime's hooks
  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    const was = this.isOpen(e.id);
    if (e.id === 'dock' && m.kind === 'charge') this.s.set(F.loud);
    await super.runMethod(e, m);
    if (e.id === 'returns' && !was && this.isOpen('returns')) setTimeout(() => void this.startRide(), 500);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'returnslabel') return !this.isOpen('returns');
    if (id === 'swarm') return !this.has(F.grounded);
    if (id === 'pods') return this.eStop <= 0 && !this.ended;
    if (id === 'cathoffice') return !this.isOpen('office');
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (id === 'returnslabel') { this.openEntry('returns'); setTimeout(() => void this.startRide(), 500); return; }
    if (id === 'swarm') {
      if (this.s.set(F.grounded)) {
        this.swarm.resetAll();
        const d = this.swarm.list.find((x) => !x.inside && x.alive);
        if (d) this.ctx.ui.subtitle(DRONE_LINES.grounded.speaker, DRONE_LINES.grounded.text, { pos: d.pos });
        this.s.events.emit('toast', { text: 'Every drone over the lot turns for the bell tower and lands. The floor drones stay up.', kind: 'good' });
      }
      return;
    }
    if (id === 'cathoffice') { this.openEntry('office'); return; }
    if (id === 'pods') {
      this.eStop = ESTOP;
      this.s.events.emit('toast', { text: 'E-STOP. Every drive on the floor stops dead. Ninety seconds before it resets.', kind: 'good' });
      return;
    }
    super.onDaemon(id);
  }

  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    if (this.ended) return;
    super.triggerAlarm(at, reason);
    this.s.set(F.loud);
    if (at) this.swarm.investigate(at, this.b.contains(at));
  }

  override emp(pos: THREE.Vector3, radius?: number) {
    const hit = super.emp(pos, radius);
    const s = this.s;
    let dur = 40 * (s.skill('electronics') >= 2 ? 1.5 : 1);
    if (s.focus('electronics') === 'deepcell') dur *= 1.3;
    const reach = (radius ?? 6) * (s.focus('demolition') === 'wide' ? 1.18 : 1) + 2;
    return this.swarm.emp(pos, reach, dur) || hit;
  }

  override startAudio() {
    super.startAudio();
    this.swarm.startAudio();
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    const d = Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z);
    const player = this.ctx.player;
    this.tickRide(dt);
    this.eStop = Math.max(0, this.eStop - dt);
    const near = d < 150;
    const chest = this.eye.set(p.x, p.y + (player.crouching ? 0.7 : 1.3), p.z);
    this.swarm.update(dt, p, chest, player.crouching && !this.ride, near && !this.ride);
    this.floor.update(dt, p, d < 110);
    this.updatePeople(dt, p, d);
    // the board: repaint when anything on it changes
    if (d < 90) {
      const status: BoardView['status'] = this.has('cathedral.end.close') ? 'closed' : this.has('cathedral.end.hand') ? 'open' : 'live';
      const floor: BoardView['floor'] = this.ended && status === 'closed' ? 'off' : this.eStop > 0 ? 'stop' : this.obstructions > 0 && this.swarm.list.some((x) => x.inside && x.state === 'inspect') ? 'obstruction' : 'moving';
      const day = START_DAY + (this.s.data.days ?? 0);
      const v: BoardView = { orders: 300 + ((day * 7) % 40), customers: this.has('cathedral.end.hand') ? 4 : 1, shift: 1407 + (this.s.data.days ?? 0), floor, owner: this.has('cathedral.end.hand') ? 'L. IBARRA' : 'O. SAYLE', status };
      const key = JSON.stringify(v);
      if (key !== this.boardKey) {
        this.boardKey = key;
        this.b.board.paint = (c, w, h) => paintBoard(c, w, h, v);
        this.b.board.repaint();
      }
    }
    // the rose window's hand goes round once a minute and a half; the delivery goes out at the top
    this.b.hand.rotation.z = -((this.t / 90) % 1) * Math.PI * 2;
  }

  private updatePeople(dt: number, p: THREE.Vector3, d: number) {
    if (d > 80) return;
    const s = this.s;
    const inside = this.playerInside;
    const turn = (at: THREE.Vector3, yaw: number, cur: number, reach: number) => {
      const dist = Math.hypot(p.x - at.x, p.z - at.z);
      const isNear = inside && dist < reach && Math.abs(p.y - at.y) < 2.2;
      let rel = Math.atan2(p.x - at.x, p.z - at.z) - yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      return { near: isNear, look: cur + ((isNear ? THREE.MathUtils.clamp(rel, -1.3, 1.3) : 0) - cur) * (1 - Math.exp(-4 * dt)) };
    };
    if (this.orrin && this.orrin.actor.root.visible) {
      const r = turn(this.orrin.at.pos, this.orrin.at.yaw, this.orrin.look, 4.5);
      this.orrin.look = r.look;
      this.orrin.actor.update(dt, r.near, r.look, 0);
    }
    if (this.lo && this.lo.actor.root.visible) {
      const r = turn(this.b.loSpot.pos, this.b.loSpot.yaw, this.lo.look, 4);
      this.lo.look = r.look;
      this.lo.actor.update(dt, r.near, r.look, 0);
    }
    for (const a of this.pickers) if (a.root.visible) a.update(dt, false, 0, 0);
    // the carrier: there and back along the crossing with a tote, a pause at each end
    const c = this.carrier;
    if (c && c.root.visible) {
      const route = this.b.carrierRoute, o = this.b.origin;
      if (c.pause > 0) {
        c.pause -= dt;
        if (c.pause <= 0) c.actor.setIdle(['carry']);
      } else {
        const tgt = route[c.seg + c.dir];
        if (!tgt) { c.dir = -c.dir; c.pause = 3; c.actor.setIdle(['idle2']); } else {
          const pos = this.tmp.set(c.root.position.x + o.x, 0, c.root.position.z + o.z);
          const dx = tgt.x - pos.x, dz = tgt.z - pos.z, dd = Math.hypot(dx, dz);
          if (dd < 0.1) c.seg += c.dir;
          else {
            const st = Math.min(dd, 1.15 * dt);
            c.root.position.x += (dx / dd) * st;
            c.root.position.z += (dz / dd) * st;
            const want = Math.atan2(dx, dz);
            let dy = want - c.root.rotation.y;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            c.root.rotation.y += dy * Math.min(1, dt * 5);
          }
        }
      }
      c.actor.update(dt, false, 0, 0);
    }
    // the associates say one thing each as you pass close (in turn)
    if (inside && !this.ended && this.t - this.assocLine > 25) {
      const people = [...this.pickers.map((a) => a.root), ...(c ? [c.root] : [])];
      for (const r of people) {
        if (!r.visible) continue;
        const wx = r.position.x + this.b.origin.x, wz = r.position.z + this.b.origin.z;
        if (Math.hypot(p.x - wx, p.z - wz) < 3.0) {
          this.assocLine = this.t;
          const l = ASSOC_LINES[this.assocIdx++ % ASSOC_LINES.length];
          this.ctx.ui.subtitle(l.speaker, l.text, { pos: this.tmp.set(wx, this.b.origin.y + 1.6, wz) });
          break;
        }
      }
    }
    // the shutdown: the associates walk out once you've looked away for a while
    if (this.leaveT >= 0 && this.has('cathedral.end.close')) {
      this.leaveT += dt;
      if (this.leaveT > 25 && (!inside || this.leaveT > 90) && s.set('cathedral.assoc.gone')) {
        this.leaveT = -1;
        this.applyFlags();
        s.events.emit('toast', { text: 'The floor is empty. Lo\'s whiteboard has one new line on it: GONE HOME.', kind: 'info' });
      }
    }
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots, ch = b.halos.channels, C = CathedralBuilder.CH;
    const closed = this.has('cathedral.end.close');
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const on = 1;
    const blink = (this.t % 1.6) < 0.5;
    const alarm = this.alarm > 0 || this.swarm.tagged;
    uCathGlow.value = (closed ? 0.35 : 0.15) + nightOn * (closed ? 0.4 : 0.85);
    uCathAlarm.value += ((alarm ? 1 : 0) - uCathAlarm.value) * Math.min(1, dt * 3);
    S.hall.value = (0.8 + nightOn * 1.2) * (closed ? 0.4 : 1);
    S.altar.value = closed ? 0.2 : 1.0;
    S.office.value = this.has(this.entryFlag('office')) || !closed ? 1.4 : 0.3;
    S.kiosk.value = this.has(this.entryFlag('returns')) ? 0.3 : 1.4;
    S.kioskOk.value = this.has(this.entryFlag('returns')) ? 1.6 : 0;
    S.officePad.value = this.has(this.entryFlag('office')) ? 0 : 2;
    S.officeOk.value = this.has(this.entryFlag('office')) ? 2 : 0;
    S.tower.value = this.has(F.grounded) || closed ? 0.3 : 1.2 + nightOn * 1.6;
    S.lot.value = nightOn * 2.4 * on;
    S.dock.value = nightOn * 2.0;
    S.panel.value = this.has(F.grounded) ? 0.2 : 1.4;
    S.stations.value = this.has('cathedral.assoc.gone') ? 0.1 : 1.2;
    S.aviation.value = blink ? 4 : 0.2;
    S.floor.value = this.eStop > 0 || closed ? 0 : 1.4;
    S.floorStop.value = this.eStop > 0 ? 2 : 0;
    ch[C.ON] = on;
    ch[C.NIGHT] = 0.05 + nightOn * 0.95;
    ch[C.HALL] = (0.4 + nightOn * 0.6) * (closed ? 0.5 : 1);
    ch[C.BLINK] = blink ? 1 : 0.05;
    ch[C.ALTAR] = closed ? 0.3 : 1;
    ch[C.OFFICE] = 1;
    const p = this.ctx.player as GameContext['player'] | null;
    const near = !!p && p.position.distanceTo(b.origin) < 70;
    for (const l of L.hall) l.intensity = near ? (3 + nightOn * 3) * (closed ? 0.5 : 1) : 0;
    L.altar.intensity = near ? 2.5 : 0;
    L.office.intensity = near ? 2.2 : 0;
    L.dock.intensity = nightOn * 6;
    for (const l of L.lot) l.intensity = nightOn * 8;
    L.tower.intensity = nightOn * 5 * (this.has(F.grounded) || closed ? 0.3 : 1);
  }

  /** Respawn point at the lot's edge. */
  get outsidePoint() {
    return this.b.points.outside.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    const s = this.s;
    if (this.complete && this.ended) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 120;
    if (!near) return '';
    if (this.ride) return 'Riding the returns line. Hold on.';
    if (this.ended) return 'The Reserve is in the office: the pallet of water, Orrin\'s desk and the returns shelf.';
    if (this.isOpen('office')) return 'Orrin\'s console is on the desk in the office. Decide what happens to the Cathedral.';
    if (this.playerInside) {
      const stop = this.eStop > 0 ? ` E-stop: ${Math.ceil(this.eStop)} s.` : '';
      if (!s.has(F.loMet)) return `The office is up the stair behind the altar, past the floor. A woman at a desk on the west of the crossing is running the shift.${stop}`;
      return `Up the stair on the east side of the apse to the office door: four digits, SPLICE (Electronics 4), or a charge.${stop}`;
    }
    if (this.isOpen('dock') || this.isOpen('returns')) return 'In through the dock, or ride the returns line from the kiosk on the east wall.';
    const rider = s.has('q.rider.log') ? '' : ' The kiosk wants a Dropt order number.';
    return `The returns kiosk on the east wall, or the dock door past it. Keep under cover from the drones.${rider}`;
  }
}

// ------------------------------------------------------------------ what the carrier carries
/** The carrier's tote, held at the chest. */
function toteMesh() {
  const mb = new MeshBatch();
  mb.add(plainStandard('#2b6fb0', 0.55, 0.05), box(0.55, 0.3, 0.4, 0, 1.05, 0.38));
  mb.add(plainStandard('#b08a5a', 0.9, 0), box(0.3, 0.14, 0.25, 0.05, 1.24, 0.38));
  return mb.build('cathTote');
}
