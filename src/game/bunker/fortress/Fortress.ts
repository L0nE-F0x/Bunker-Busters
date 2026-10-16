import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { FortressBuilder, FT } from './FortressBuilder';
import { paintBoard, type BoardView } from './fortressAtlas';
import { uCoolGlow, uCoolCold } from './fortressFx';
import { Helpers, Helper, type HelperHost } from '../dome/helpers';
import {
  FORTRESS, FORTRESS_FLAGS as F, FORTRESS_MOAT, POWER, KIT_LINES, TECH_LINES, MAREK, MAREK_TALK, KIT_TALK, ALLOCATION, KIT_AFTER,
  QUEUE_NOTE, PUMP_CARD, boardText,
  type FortressTalk, type FortressView, type FortressChoice,
} from '@/content/bunkers/fortress';
import { START_DAY } from '../../State';
import { stealthMeter } from '@/content/progression';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import type { GameContext } from '../../context';
import type { Combat } from '../../combat/Combat';

/** Seconds you stay as cold as the walls after a swim (the thermal cameras can't pick you out). */
const COLD = 25;
/** Health a second the coolant takes while you're in it. */
const FREEZE = 6;

/**
 * Tier 7, the Chip Fortress (Act VII): Kit Szabo's star fort in the basin under the southern range.
 * Entries, the laser grid, the cameras and the loot are data (content/bunkers/fortress.ts) run by the
 * bunker runtime. What's the Fortress's own:
 * - the moat: in the coolant you freeze (health drains); out of it you're cold for a while and the
 *   thermal cameras can't see you. The pump house drains it (the surface sinks to a film), and the
 *   hall's chillers starve: the thermal cameras white out.
 * - the drawbridge: it turns on its hinge as the bridge entry opens; its deck gets a collider when down.
 * - the power board: three units; the chillers, the hall grid and the lights take one each, the vault
 *   door two. The vault door only opens with its two units.
 * - the technicians (the Dome's Helper patrols with a cooling tech's body): they walk you out over
 *   the bridge if they catch you; shot, they go down and get up later; an EMP does nothing to them.
 * - the people: Kit at her desk in the vault, Marek in the locker room.
 * - the ending at the allocation console: shut the chillers down for good, or rewrite the table.
 */
export class Fortress extends Bunker<FortressBuilder> {
  readonly techs = new Helpers();
  readonly techGroup = new THREE.Group();
  private combat: Combat | null = null;
  private kit: { actor: NpcActor; look: number } | null = null;
  private marek: { actor: NpcActor; look: number } | null = null;
  private deck: ReturnType<GameContext['physics']['addBox']> | null = null;
  private coldT = 0;
  private inMoat = false;
  private drainK = 0;
  /** The cold's damage, banked until it's a whole point (State.damage rounds). */
  private freezeAcc = 0;
  private boardKey = '';
  private asking = false;
  private kitIdx = 0;
  private swimSaid = false;
  private readonly eye = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(ctx: GameContext) {
    super(ctx, FORTRESS, (origin) => new FortressBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    this.techGroup.name = 'fortTechs';
    // (world-space, parented under the bunker so interior mode keeps the one in the keep with the hall)
    this.techGroup.position.copy(this.b.origin).negate();
    this.b.group.add(this.techGroup);
    this.init();
    this.extraInteractables();
  }

  /** Game: the technicians are hostiles (shootable) and need Combat's line of sight. */
  attach(combat: Combat) {
    this.combat = combat;
    combat.register(this.techs);
  }

  // ------------------------------------------------------------------ flags and power
  private has(f: string) {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(f);
  }

  private get ended() {
    return this.has('fortress.end.shut') || this.has('fortress.end.realloc');
  }

  /** What the board has on. */
  power() {
    return {
      chillers: !this.has(F.chillersOff) && !this.has('fortress.end.shut'),
      grid: !this.has(this.flag('lasers.off')),
      lights: !this.has(F.lightsOff),
      vault: this.has(F.vaultOn),
    };
  }

  private used(p = this.power()) {
    return (p.chillers ? POWER.chillers : 0) + (p.grid ? POWER.grid : 0) + (p.lights ? POWER.lights : 0) + (p.vault ? POWER.vault : 0);
  }

  /** The thermal cameras see nothing: the chillers are off or the moat is gone (the hall's all heat). */
  private get whiteout() {
    return this.has(F.chillersOff) || this.has(F.drained) || this.has('fortress.end.shut');
  }

  protected override cameraSight() {
    if (this.whiteout) return 0;
    return this.coldT > 0 ? 0.08 : 1;
  }

  // ------------------------------------------------------------------ people and technicians (Meshy models, from Game.build)
  addPeople(models: NpcModels | null) {
    const b = this.b;
    const put = (actor: NpcActor, spot: { pos: THREE.Vector3; yaw: number }, seated: boolean) => {
      actor.root.position.set(spot.pos.x - b.origin.x, (seated ? actor.root.position.y : 0) + spot.pos.y - b.origin.y, spot.pos.z - b.origin.z);
      actor.root.rotation.y = spot.yaw;
      b.group.add(actor.root);
    };
    const kit = models?.make('kit', true, 0.5) ?? null;
    if (kit) {
      put(kit, b.kitSeat, true);
      this.kit = { actor: kit, look: 0 };
    }
    const marek = models?.make('tech', false, 0) ?? null;
    if (marek) {
      put(marek, b.marekSpot, false);
      this.marek = { actor: marek, look: 0 };
    }
    const host = this.techHost();
    for (const [id, inside] of [['t1', false], ['t2', false], ['t3', true]] as [string, boolean][]) {
      const actor = models?.make('tech', false, 0) ?? null;
      const root = actor?.root ?? stub();
      this.techGroup.add(root);
      this.techs.list.push(new Helper(id, inside, b.routes[id], actor, root, host));
    }
    this.applyFlags(true);
  }

  private techHost(): HelperHost {
    const ctx = this.ctx;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get combat() { return self.combat!; },
      audio: ctx.audio,
      say: (line, pos) => { if (pos.distanceTo(ctx.player.position) < 30) ctx.ui.subtitle(line.speaker, line.text, { pos }); },
      floor: (x, z) => (this.b.contains(this.tmp.set(x, this.b.origin.y + 1, z)) ? this.b.origin.y + 0.02 : Math.max(ctx.hf.heightAt(x, z), this.b.origin.y)),
      thermal: () => false,
      shielded: () => true,
      armoured: () => false,
      standDown: () => (this.ended ? 'friendly' : 'no'),
      sight: (inside) => {
        const st = this.s;
        const k = st.archetype.stats.stealth * stealthMeter(st.skill('stealth'));
        const night = ctx.atmo.uNight.value as number;
        return k * (inside ? (this.has(F.lightsOff) ? 0.55 : 1) : 1 - night * 0.35) * (this.coldT > 0 ? 0.8 : 1);
      },
      insideDome: (p) => this.b.contains(p),
      onNotice: () => {},
      onCatch: () => this.caught(),
      onShot: () => { this.s.set(F.loud); },
      onDown: () => {},
      onSlip: () => {},
      lines: TECH_LINES,
    };
  }

  /** A technician reached you: walked out over the bridge to the queue. */
  private caught() {
    const ctx = this.ctx, s = this.s;
    s.set(F.caught);
    const line = TECH_LINES.catch[Math.floor(Math.random() * TECH_LINES.catch.length)];
    ctx.ui.subtitle(line.speaker, line.text);
    const to = this.b.points.outside.clone();
    to.y = ctx.hf.heightAt(to.x, to.z);
    ctx.caught('A technician takes your arm, walks you out over the bridge in silence, and leaves you at the back of the queue.', { to, yaw: Math.PI, gentle: true });
    setTimeout(() => {
      this.techs.resetAll();
      this.alarm = 0;
      this.taunt(KIT_LINES.caught.text);
    }, 1600);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    // the bridge's deck: walkable once it's down (the runtime opened its door; we add the deck)
    const open = this.has(this.entryFlag('bridge'));
    if (open && !this.deck) {
      const c = this.b.points.bridgeCentre, span = FORTRESS_MOAT.r1 - FORTRESS_MOAT.r0 + 0.6;
      this.deck = this.ctx.physics.addBox(c, { x: 2.1, y: 0.12, z: span / 2 + 0.2 });
    } else if (!open && this.deck) {
      this.ctx.physics.world.removeCollider(this.deck, false);
      this.deck = null;
    }
    if (instant) this.drainK = this.has(F.drained) ? 1 : 0;
    if (this.marek) this.marek.actor.root.visible = true;
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.interactables.push({
      id: 'fort-queue', pos: b.points.queue, radius: 1.8,
      visible: () => true,
      primary: { label: 'Read the note on the chair', available: () => true, run: () => this.readQueue() },
    });
    this.interactables.push({
      id: 'fort-drain', pos: b.points.drain, radius: 1.8,
      visible: () => this.isOpen('pump') && !this.has(F.drained) && !this.ended,
      primary: { label: 'Turn the drain wheel', available: () => true, run: () => this.drain() },
    });
    this.interactables.push({
      id: 'fort-board', pos: b.points.board, radius: 2.0,
      visible: () => !this.ended,
      primary: { label: 'Look at the power board', available: () => true, run: () => this.boardCard() },
    });
    this.interactables.push({
      id: 'fort-marek', pos: b.points.marek, radius: 2.4,
      visible: () => !!this.marek,
      primary: {
        get label() { return self.s.has(F.marekMet) ? 'Talk to Marek' : 'Talk to the technician on the bench'; },
        available: () => true,
        run: () => {
          if (this.s.set(F.marekMet)) this.s.addXP(30, 'The lead technician');
          return this.talkTo(MAREK_TALK, this.ended ? 'after' : 'hello');
        },
      },
    });
    this.interactables.push({
      id: 'fort-kit', pos: b.points.kit, radius: 2.4,
      visible: () => !!this.kit && this.isOpen('vault'),
      primary: {
        label: 'Talk to Kit',
        available: () => true,
        run: () => {
          if (this.s.set(F.kit)) this.s.addXP(30, 'The allocation');
          if (this.ended) return this.kitAfter();
          return this.talkTo(KIT_TALK, 'hello');
        },
      },
    });
    this.interactables.push({
      id: 'fort-console', pos: b.points.console, radius: 1.6,
      visible: () => this.isOpen('vault') && !this.ended,
      primary: { label: 'Look at the allocation console', available: () => true, run: () => this.allocationCard() },
    });
  }

  private async readQueue() {
    this.s.set(F.queue);
    await this.ctx.ui.choose({ speaker: QUEUE_NOTE.speaker, text: QUEUE_NOTE.text, choices: [{ id: 'ok', label: 'Put it back' }] });
  }

  private async drain() {
    if (this.asking) return;
    this.asking = true;
    let pick: string | null;
    try {
      pick = await this.ctx.ui.choose({ speaker: PUMP_CARD.speaker, text: PUMP_CARD.text, choices: [{ id: 'drain', label: 'Turn the red wheel all the way' }, { id: 'no', label: 'Leave it' }] });
    } finally {
      this.asking = false;
    }
    if (pick !== 'drain' || !this.s.set(F.drained)) return;
    this.s.addXP(60, 'Moat drained');
    this.s.set(F.loud);
    this.ctx.audio.play('thud', { pos: this.b.points.drain, intensity: 0.4 });
    this.s.events.emit('toast', { text: 'The pumps change note. Out in the moat the coolant starts to sink, and the vapour thins. In the keep, the chillers start to run dry.', kind: 'good' });
    setTimeout(() => this.taunt(KIT_LINES.drained.text), 2500);
    // the technicians come to see what happened to the pumps
    for (const t of this.techs.list) if (!t.inside) t.investigate(this.b.points.drain);
  }

  private async boardCard() {
    if (this.asking) return;
    this.asking = true;
    try {
      for (let i = 0; i < 8; i++) {
        const p = this.power(), free = POWER.units - this.used(p);
        const need = (n: number) => (free >= n ? undefined : 'Not enough power: switch something off first');
        const pick = await this.ctx.ui.choose({
          speaker: 'The power board',
          text: boardText(p),
          choices: [
            { id: 'chillers', label: p.chillers ? 'Switch the chillers off' : 'Switch the chillers on', disabled: p.chillers ? undefined : need(POWER.chillers) },
            { id: 'grid', label: p.grid ? 'Switch the hall grid off' : 'Switch the hall grid on', disabled: p.grid ? undefined : need(POWER.grid) },
            { id: 'lights', label: p.lights ? 'Switch the lights off' : 'Switch the lights on', disabled: p.lights ? undefined : need(POWER.lights) },
            { id: 'vault', label: p.vault ? 'Take the power off the vault door' : 'Give the vault door its two units', disabled: p.vault ? undefined : need(POWER.vault) },
            { id: 'no', label: 'Step back' },
          ],
        });
        if (!pick || pick === 'no') return;
        this.toggle(pick as 'chillers' | 'grid' | 'lights' | 'vault');
      }
    } finally {
      this.asking = false;
    }
  }

  private toggle(what: 'chillers' | 'grid' | 'lights' | 'vault') {
    const s = this.s, p = this.power();
    this.ctx.audio.play('disarm', { pos: this.b.points.board });
    if (what === 'chillers') {
      if (p.chillers) {
        s.set(F.chillersOff);
        s.events.emit('toast', { text: 'The chillers wind down. Within a minute the hall is warm, and the thermal cameras are looking at nothing but heat.', kind: 'good' });
        if (s.set('fortress.chillers.said')) setTimeout(() => this.taunt(KIT_LINES.chillers.text), 1500);
      } else s.unset(F.chillersOff);
    } else if (what === 'grid') {
      if (p.grid) this.lasers?.kill();
      else { s.unset(this.flag('lasers.off')); this.applyFlags(); }
    } else if (what === 'lights') {
      if (p.lights) { s.set(F.lightsOff); s.events.emit('toast', { text: 'The keep goes dark except for the racks and the exit signs.', kind: 'info' }); } else s.unset(F.lightsOff);
    } else if (what === 'vault') {
      if (p.vault) s.unset(F.vaultOn);
      else {
        s.set(F.vaultOn);
        if (s.set('fortress.vault.powered')) s.addXP(40, 'Power to the vault');
        s.events.emit('toast', { text: 'The vault door\'s lamp goes amber, then green. It has power.', kind: 'good' });
      }
    }
  }

  private kitAfter() {
    const lines = this.has('fortress.end.realloc') ? KIT_AFTER.realloc : KIT_AFTER.shut;
    const l = lines[this.kitIdx++ % lines.length];
    this.ctx.ui.subtitle(l.speaker, l.text, { pos: this.b.points.kit });
  }

  // ------------------------------------------------------------------ conversations
  private view(): FortressView {
    const s = this.s;
    return {
      social: s.skill('social') + (s.archetype.perk === 'insider' ? 1 : 0),
      electronics: s.skill('electronics'),
      has: (f) => s.has(f),
      count: (id) => s.count(id),
    };
  }

  private talkTo(tree: FortressTalk, start: string) {
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
        const choice: FortressChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<FortressChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'badge':
        if (s.count('marek_badge') < 1) {
          s.addItem('marek_badge', 1, false, true);
          s.events.emit('toast', { text: 'Marek\'s badge opens the keep door.', kind: 'good' });
        }
        return;
      case 'board':
        if (s.set(F.marekBoard)) s.events.emit('toast', { text: 'The power board is in the west room. Three units; the vault door wants two.', kind: 'info' });
        return;
      case 'ready':
        if (s.set(F.marekReady)) s.events.emit('toast', { text: 'Marek\'s crew will keep the turbine running if you give its power to the camps.', kind: 'info' });
        return;
      case 'end':
        setTimeout(() => void this.allocationCard(), 300);
        return;
    }
  }

  // ------------------------------------------------------------------ the ending
  private async allocationCard() {
    if (this.ended || this.asking) return;
    const v = this.view();
    const canRealloc = this.has(F.marekReady) || v.social >= 4 || v.electronics >= 5;
    this.asking = true;
    let pick: string | null;
    try {
      pick = await this.ctx.ui.choose({
        speaker: ALLOCATION.card.speaker,
        text: ALLOCATION.card.text,
        choices: [
          { id: 'shut', label: 'Turn the master key: the chillers off for good' },
          { id: 'realloc', label: 'Rewrite the table: the turbine\'s power to the camps', disabled: canRealloc ? undefined : ALLOCATION.reallocNeeds },
          { id: 'no', label: 'Not yet' },
        ],
      });
    } finally {
      this.asking = false;
    }
    if (pick !== 'shut' && pick !== 'realloc') return;
    const s = this.s, ui = this.ctx.ui;
    s.set(F.end);
    s.set(`${F.end}.${pick}`);
    s.data.marks['fortress.endDay'] = s.data.days ?? 0;
    s.addXP(120, pick === 'shut' ? 'The chillers, off' : 'A new allocation');
    if (pick === 'shut') { s.addRep('compact', 1); s.addRep('kit', -2); } else { s.addRep('compact', 2); s.addRep('kit', -1); }
    this.alarm = 0;
    this.ctx.audio.setAlarm(false);
    this.cameras?.kill();
    this.techs.resetAll();
    if (pick === 'shut') {
      this.ctx.audio.play('thud', { pos: this.b.points.console, intensity: 0.5 });
      this.ctx.cam.addTrauma(0.15);
      s.events.emit('toast', { text: 'The master key turns. The racks\' fans spin down, one after another, and the vault starts to get warm.', kind: 'good' });
    } else {
      this.ctx.audio.play('disarm', { pos: this.b.points.console });
      s.events.emit('toast', { text: 'You type LAST CHANCE into the empty row, then every camp you know. The units fill in. Under the floor, the turbine changes note.', kind: 'good' });
    }
    this.applyFlags();
    ALLOCATION[pick].forEach((l, i) => setTimeout(() => ui.subtitle(l.speaker, l.text, { pos: l.speaker === MAREK ? this.b.points.marek : this.b.points.kit }), 600 + i * 4800));
  }

  // ------------------------------------------------------------------ the runtime's hooks
  protected override methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    if (e.id === 'keep' && m.kind === 'open' && m.id === 'badge') return this.s.count('marek_badge') > 0 ? true : 'Needs a technician\'s badge';
    if (e.id === 'vault' && m.kind === 'open' && m.id === 'power') return this.power().vault ? true : 'The vault door has no power (the board, in the west room)';
    return super.methodReason(e, m);
  }

  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    if (m.kind === 'charge') this.s.set(F.loud);
    if (e.id === 'keep' && m.kind === 'open' && m.id === 'badge') {
      this.ctx.audio.play('unlock', { pos: this.b.points.keepDoor });
      this.s.addXP(m.xp, m.reason);
      this.openEntry('keep');
      return;
    }
    await super.runMethod(e, m);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'bridge') return !this.isOpen('bridge');
    if (id === 'thermcams') return !!this.cameras && !this.cameras.off;
    if (id === 'keepdoor') return !this.isOpen('keep');
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (id === 'bridge') { this.openEntry('bridge'); return; }
    if (id === 'thermcams') { this.cameras?.kill(); return; }
    if (id === 'keepdoor') { this.openEntry('keep'); return; }
    super.onDaemon(id);
  }

  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    if (this.ended) return;
    super.triggerAlarm(at, reason);
    this.s.set(F.loud);
    if (at) for (const t of this.techs.list) if (t.center.distanceTo(at) < 35) t.investigate(at);
  }

  override emp(pos: THREE.Vector3, radius?: number) {
    const hit = super.emp(pos, radius);
    this.techs.emp(pos, radius ?? 6, 10, true, (t) => this.ctx.ui.subtitle(TECH_LINES.shielded.speaker, TECH_LINES.shielded.text, { pos: t.center }));
    return hit;
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    const o = this.b.origin;
    const d = Math.hypot(p.x - o.x, p.z - o.z);
    const player = this.ctx.player;
    // the moat: in the coolant you freeze; out of it you stay cold a while
    const { r0, r1 } = FORTRESS_MOAT;
    const surf = o.y + FT.SURF - (FT.SURF + FORTRESS_MOAT.depth - 0.25) * this.drainK;
    const inRing = d > r0 && d < r1;
    const wet = inRing && p.y < surf - 0.05 && this.drainK < 0.9;
    if (wet) {
      this.freezeAcc += FREEZE * dt;
      if (this.freezeAcc >= 1) { const n = Math.floor(this.freezeAcc); this.freezeAcc -= n; this.s.damage(n); }
      this.ctx.post.damage.value = Math.max(this.ctx.post.damage.value, 0.25);
      this.coldT = COLD;
      if (!this.inMoat) {
        this.inMoat = true;
        this.ctx.audio.play('thud', { pos: p, intensity: 0.3 });
        if (this.s.set(F.swam)) this.s.events.emit('toast', { text: 'The coolant is so cold it burns. Get out: the steps are cut into the walls, east and west.', kind: 'bad' });
        if (!this.swimSaid) { this.swimSaid = true; setTimeout(() => this.taunt(KIT_LINES.swim.text), 1200); }
      }
    } else {
      if (this.inMoat && this.coldT > 0) this.s.events.emit('toast', { text: 'You\'re out, and as cold as the walls. For a little while the thermal cameras can\'t pick you out.', kind: 'good' });
      this.inMoat = false;
      this.coldT = Math.max(0, this.coldT - dt);
    }
    // the drain: the surface sinks over twenty seconds
    const drainTo = this.has(F.drained) ? 1 : 0;
    this.drainK += Math.sign(drainTo - this.drainK) * Math.min(Math.abs(drainTo - this.drainK), dt / 20);
    this.b.coolant.position.y = FT.SURF - (FT.SURF + FORTRESS_MOAT.depth - 0.25) * this.drainK;
    // the drawbridge turns on its hinge with its door's `open`; the chains follow
    const br = this.b.doors.bridge;
    this.b.bridge.rotation.x = (1 - br.open) * Math.PI / 2;
    if (Math.abs(br.open - br.target) > 0.001 || this.t < 0.5) this.aimChains(br.open);
    // the technicians and the people
    const chest = this.eye.set(p.x, p.y + (player.crouching ? 0.7 : 1.3), p.z);
    this.techs.update(dt, p, chest, player.crouching, false, d < 70);
    this.updatePeople(dt, p, d);
    // the board in the vault: repaint when anything on it changes
    if (d < 40) {
      const pw = this.power();
      const status: BoardView['status'] = this.has('fortress.end.shut') ? 'shut' : this.has('fortress.end.realloc') ? 'realloc' : this.whiteout ? 'thermal' : 'live';
      const day = START_DAY + (this.s.data.days ?? 0);
      const rows = this.has('fortress.end.realloc')
        ? [{ name: 'LAST CHANCE', units: 2 }, { name: 'DRY CREEK', units: 2 }, { name: 'WAITLIST CITY', units: 4 }, { name: 'TECHNICIANS', units: 5 }, { name: 'K. SZABO', units: 1 }]
        : [{ name: 'K. SZABO', units: 9 }, { name: 'TECHNICIANS', units: 5 }, { name: 'LAST CHANCE', units: 0 }, { name: 'DRY CREEK', units: 0 }];
      const v: BoardView = { window: 1, rows, power: pw, status, price: '— (no feed since day 31)' };
      const key = JSON.stringify(v) + day;
      if (key !== this.boardKey) {
        this.boardKey = key;
        this.b.board.paint = (c, w, h) => paintBoard(c, w, h, v);
        this.b.board.repaint();
      }
    }
  }

  private aimChains(open: number) {
    const b = this.b;
    b.chains.forEach((c, i) => {
      const end = b.deckEnd(open, i === 0 ? -1 : 1, this.tmp);
      const top = b.chainTop[i];
      c.position.copy(end).add(top).multiplyScalar(0.5);
      c.scale.set(1, 1, end.distanceTo(top));
      c.lookAt(top.clone().add(b.group.position));
    });
  }

  private updatePeople(dt: number, p: THREE.Vector3, d: number) {
    if (d > 60) return;
    const inside = this.playerInside;
    const turn = (at: THREE.Vector3, yaw: number, cur: number, reach: number) => {
      const dist = Math.hypot(p.x - at.x, p.z - at.z);
      const isNear = inside && dist < reach && Math.abs(p.y - at.y) < 2.2;
      let rel = Math.atan2(p.x - at.x, p.z - at.z) - yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      return { near: isNear, look: cur + ((isNear ? THREE.MathUtils.clamp(rel, -1.2, 1.2) : 0) - cur) * (1 - Math.exp(-4 * dt)) };
    };
    if (this.kit) {
      const r = turn(this.b.kitSeat.pos, this.b.kitSeat.yaw, this.kit.look, 4.5);
      this.kit.look = r.look;
      this.kit.actor.update(dt, r.near, r.look, 0);
    }
    if (this.marek) {
      const r = turn(this.b.marekSpot.pos, this.b.marekSpot.yaw, this.marek.look, 4);
      this.marek.look = r.look;
      this.marek.actor.update(dt, r.near, r.look, 0);
    }
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots, ch = b.halos.channels, C = FortressBuilder.CH;
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const shut = this.has('fortress.end.shut');
    const lightsOff = this.has(F.lightsOff);
    const cold = !this.has(F.chillersOff) && !shut;
    const blink = (this.t % 1.6) < 0.5;
    const alarm = this.alarm > 0 ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * 5)) : 1;
    const vaultOn = this.has(F.vaultOn);
    S.wall.value = (0.6 + nightOn * 1.4) * alarm;
    S.keep.value = lightsOff ? 0.15 : 1.0 + nightOn * 1.2;
    S.vault.value = lightsOff ? 0.3 : 1.2;
    S.racks.value = shut ? 0.3 : 1.4;
    S.boardOn.value = 1.6;
    S.boardWarn.value = cold ? 0 : (this.t % 1 < 0.5 ? 2 : 0.3);
    S.cool.value = cold ? 0.8 : 0.1;
    S.aviation.value = blink ? 4 : 0.2;
    S.gatehouse.value = this.has(this.entryFlag('bridge')) ? 0.4 : 1.4;
    S.padRed.value = this.has(this.entryFlag('vault')) || vaultOn ? 0 : 2;
    S.padOk.value = vaultOn || this.has(this.entryFlag('vault')) ? 2 : 0;
    S.heater.value = this.has('fortress.end.realloc') ? 3 : 1.6;
    S.yard.value = nightOn * 2.4;
    ch[C.ON] = 1;
    ch[C.NIGHT] = 0.05 + nightOn * 0.95;
    ch[C.BLINK] = blink ? 1 : 0.05;
    ch[C.VAULT] = shut ? 0.3 : 1;
    // the coolant: its glow and its cold go as the chillers and the drain do
    uCoolCold.value += ((cold && !this.has(F.drained) ? 1 : 0.15) - uCoolCold.value) * Math.min(1, dt * 0.2);
    uCoolGlow.value = 0.25 + nightOn * 0.75;
    b.steam.strength.value += ((cold ? 1 - this.drainK : 0) - b.steam.strength.value) * Math.min(1, dt * 0.3);
    b.steam.tint.value.setRGB(0.9 - nightOn * 0.55, 0.95 - nightOn * 0.45, 0.98 - nightOn * 0.3);
    const p = this.ctx.player as GameContext['player'] | null;
    const near = !!p && p.position.distanceTo(b.origin) < 50;
    for (const l of L.yard) l.intensity = nightOn * 7;
    L.hall.intensity = near ? (lightsOff ? 0.3 : 6) * alarm : 0;
    L.board.intensity = near ? (lightsOff ? 0.4 : 3) : 0;
    L.lockers.intensity = near ? 2.6 : 0;
    L.vault.intensity = near ? (shut ? 3 : 8) : 0;
    L.gate.intensity = nightOn * 9;
    L.pump.intensity = nightOn * 4;
  }

  /** Respawn point at the back of the queue. */
  get outsidePoint() {
    return this.b.points.outside.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    if (this.complete && this.ended) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 110;
    if (!near) return '';
    if (this.ended) return 'The drinking tank, the dispenser and Kit\'s desk are in the vault.';
    if (this.isOpen('vault')) return 'Kit\'s allocation console is on her desk. Decide what happens to the Fortress\'s power.';
    if (this.playerInside) {
      const pw = this.power();
      if (!pw.vault) return `The vault door needs two units. The power board is in the west room (${this.used(pw)} of ${POWER.units} in use).`;
      return 'The vault door has power. It\'s at the end of the hall.';
    }
    if (this.b.inWalls(p)) return 'The keep door is on its north face: a lock, a badge reader, or SPLICE (Electronics 4).';
    if (this.isOpen('bridge') || this.isOpen('postern')) return 'Into the yard and across to the keep. Thermal cameras on the bastions and the keep.';
    const cold = this.coldT > 0 ? ' You\'re cold: the cameras can\'t see you yet.' : '';
    return `The gatehouse wants a code, or drain the moat at the pump house on the west bank. The frost door is in the west wall.${cold}`;
  }
}

/** A technician's stand-in when the models didn't load (?procnpc): a pale capsule. */
function stub() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 10), new THREE.MeshStandardNodeMaterial({ color: '#c9dbe4', roughness: 0.7 }));
  body.position.y = 0.95;
  g.add(body);
  return g;
}
