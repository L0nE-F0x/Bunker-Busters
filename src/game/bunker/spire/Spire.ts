import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { SpireBuilder, SP } from './SpireBuilder';
import { paintBoard } from './spireAtlas';
import { Sentinels, type SentinelHost } from './sentinels';
import {
  SPIRE, SPIRE_FLAGS as F, SENTINELS, SENTINEL_LINES, CONCERN, CSL_AT, APOLOGY, PRUDENCE, DOOR_QUESTIONS, DOOR_PROMISE, DOOR_LINES,
  PRU_CALL, NOOR_TALK, NOOR_WAKE, BENNY_TALK, PRU_TALK, CORE, FENN, DOOR,
  type SpireTalk, type SpireView, type SpireChoice, type RecordView, type DoorQuestion,
} from '@/content/bunkers/spire';
import { START_DAY } from '../../State';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import type { GameContext } from '../../context';
import type { Combat } from '../../combat/Combat';

interface Person {
  id: 'prudence' | 'noor' | 'benny';
  actor: NpcActor;
  look: number;
  /** Their spot (local seat or standing place) for head turns and talk range. */
  at: THREE.Vector3;
}

/** How far from the pad carrying the core counts as clear of the road (m). */
const CLEAR = 140;

/**
 * Tier 4, the Alignment Spire (Act IV): Prudence Ashby's tower above the Tube. Entries, the stair
 * lasers, the road's beams and the loot are data (content/bunkers/spire.ts) run by the bunker
 * runtime. What's the Spire's own:
 * - the Careful Safety Level: everything the base runtime would call an alarm (a beam, a laser, a
 *   trace, a lie, a charge, a sentinel's report or being shot) adds concern points instead. Six
 *   points is level 4: the pause (the base alarm, 45 s), then back to 3. Saved in `marks`.
 * - the sentinels (sentinels.ts): they apologise, log near misses, report the unarmed.
 * - the ethics door: questions from your record; two untrue answers and it won't open.
 * - the people: Noor asleep at Eval 3 (wake her: the box, test mode for Sentinel 3, her card; she
 *   walks out once the top door is open), Prudence at the window, Benny at the plant.
 * - the core: pull it (carry it off the road with the Spire paused: no apologies) or open the valve.
 * `combat`/`armed` are attached by Game (`attach`).
 */
export class Spire extends Bunker<SpireBuilder> {
  sentinels: Sentinels | null = null;
  private people: Person[] = [];
  private armedFn: () => boolean = () => false;
  private boardKey = '';
  private wasPaused = false;
  /** Last frame's distance from the Spire (carrying the core out on foot vs. being moved: a death, a catch). */
  private lastD = 0;
  private noorWaking = -1;
  private noorLeaving = -1;
  private valveSpin = 0;
  private guardrailLine = 0;
  private asking = false;

  constructor(ctx: GameContext) {
    super(ctx, SPIRE, (origin) => new SpireBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    this.init();
    this.extraInteractables();
  }

  /** Game: the sentinels need Combat and to know whether you're holding a weapon. */
  attach(combat: Combat, armed: () => boolean) {
    this.armedFn = armed;
    const host: SentinelHost = {
      combat,
      audio: this.ctx.audio,
      say: (line, pos) => this.ctx.ui.subtitle(line.speaker, line.text, { pos }),
      apology: () => (this.paused ? 0 : APOLOGY[Math.min(2, this.level - 1)]),
      armed: () => this.armedFn() || this.carrying,
      carrying: () => this.carrying,
      paused: () => this.paused,
      skill: (id) => this.s.skill(id),
      xp: (n, why) => this.s.addXP(n, why),
      onReport: () => this.raise(CONCERN.report, 'A sentinel filed a report about you. The Spire\'s safety level goes up.'),
      onNearMiss: () => this.s.addXP(10, 'Near miss'),
      onShot: (t) => this.raise(CONCERN.shot, `You shot at ${t.label}. The Spire's safety level goes up.`),
      onOff: (t, how) => this.s.set(`spire.sentinel.${t.spot.id}.${how === 'dead' ? 'dead' : 'off'}`),
      lines: {
        sorry: SENTINEL_LINES.sorry, nearMiss: SENTINEL_LINES.nearMiss, unarmed: SENTINEL_LINES.unarmed,
        paused: SENTINEL_LINES.paused, core: SENTINEL_LINES.core, breaker: SENTINEL_LINES.breaker,
      },
    };
    const labels = Object.fromEntries(SENTINELS.map((d) => [d.id, d.label]));
    this.sentinels = new Sentinels(host, this.b.sentinelSpots, labels);
    // (they live in world space, like the drones: Sentinels.update hides them past 160 m)
    this.ctx.scene.add(this.sentinels.group);
    for (const t of this.sentinels.list) if (!t.spot.ceiling) this.interactables.push(t.breaker);
    combat.register(this.sentinels);
    this.applyFlags(true);
  }

  // ------------------------------------------------------------------ the safety level
  private get concern() {
    const st = this.ctx.state as GameContext['state'] | null;
    return st?.data.marks['spire.concern'] ?? 0;
  }

  private set concern(v: number) {
    this.s.data.marks['spire.concern'] = v;
  }

  /** The Careful Safety Level, 1-4. */
  get level() {
    if (this.paused || this.carrying) return 4;
    const c = this.concern;
    return c >= CSL_AT[3] ? 4 : c >= CSL_AT[2] ? 3 : c >= CSL_AT[1] ? 2 : 1;
  }

  get paused() {
    return this.alarm > 0;
  }

  get carrying() {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(F.carrying);
  }

  /** Once the valve is open the Spire stands down for good. */
  private get standDown() {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has('spire.core.valve');
  }

  /** Add concern; announce a new level; at 4, pause. */
  raise(n: number, reason: string, at: THREE.Vector3 | null = null) {
    if (this.standDown || this.complete && !this.carrying) return;
    const before = this.level;
    this.concern = Math.min(CSL_AT[3] + 2, this.concern + n);
    const after = this.level;
    if (after >= 4 && !this.paused) { this.pause(at, reason); return; }
    this.s.events.emit('toast', { text: reason, kind: 'bad' });
    if (after > before) {
      if (after === 2) this.taunt(PRUDENCE.level2.text);
      if (after === 3) this.taunt(PRUDENCE.level3.text);
    }
  }

  /** Level 4: the base runtime's alarm, under Careful's name. */
  private pause(at: THREE.Vector3 | null, reason: string) {
    this.s.set(F.paused);
    this.s.set(F.loud);
    this.s.data.marks['spire.pausedDay'] = this.s.data.days ?? 0;
    super.triggerAlarm(at, reason);
    this.taunt(PRUDENCE.level4.text);
  }

  /** Everything the base runtime calls an alarm becomes concern. */
  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    const sec = this.sec;
    let n = 3;
    if (reason === sec.tripwires?.tripped || reason === sec.tripwires?.yank.loud) {
      n = CONCERN.tripwire;
      if (this.t - this.guardrailLine > 20) { this.guardrailLine = this.t; this.taunt(PRUDENCE.guardrail.text); }
    } else if (sec.lasers && Object.values(sec.lasers.tripped).includes(reason)) n = CONCERN.laser;
    else if (sec.entries.some((e) => 'methods' in (e.secondary ?? {}) && (e.secondary as { methods: LockMethod[] }).methods.some((m) => m.kind === 'charge' && m.loud === reason))) {
      n = CONCERN.force;
      this.s.set(F.loud);
    } else if (reason.startsWith('Trace complete')) n = CONCERN.traced;
    this.raise(n, reason, at);
  }

  // ------------------------------------------------------------------ the people (Meshy models, from Game.build)
  addPeople(models: NpcModels | null) {
    if (!models) return;
    const b = this.b;
    const add = (id: Person['id'], seated: boolean, spot: { pos: THREE.Vector3; yaw: number }) => {
      const actor = models.make(id, seated, 0.5);
      if (!actor) return;
      actor.root.position.x = spot.pos.x - b.origin.x;
      actor.root.position.z = spot.pos.z - b.origin.z;
      actor.root.position.y = (seated ? actor.root.position.y : 0) + spot.pos.y - b.origin.y;
      actor.root.rotation.y = spot.yaw;
      b.interior.add(actor.root);
      this.people.push({ id, actor, look: 0, at: spot.pos.clone() });
    };
    add('noor', true, b.noorSeat);
    add('prudence', false, b.prudenceSpot);
    add('benny', false, b.bennySpot);
    this.applyFlags(true);
  }

  private person(id: Person['id']) {
    return this.people.find((p) => p.id === id);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    const st = this.ctx.state as GameContext['state'] | null;
    const has = (f: string) => !!st?.has(f);
    this.b.core.visible = !has('spire.core.pull');
    if (instant) this.b.valve.rotation.z = has('spire.core.valve') ? Math.PI * 3 : 0;
    const noor = this.person('noor');
    if (noor) {
      noor.actor.root.visible = !has(F.noorFree);
      if (instant) noor.actor.setIdle([has(F.noorMet) ? 'idle' : 'sleep']);
    }
    for (const t of this.sentinels?.list ?? []) {
      const id = t.spot.id;
      if (has(`spire.sentinel.${id}.dead`)) t.kill();
      else if (has(`spire.sentinel.${id}.off`) || has('spire.core.valve') || (id === 's3' && has(F.test))) t.switchOff();
      else if (instant) { t.alive = true; t.hp = 120; t.state = 'off'; t.wake(); } // (one shot down last run scans again)
    }
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // Isaac Fenn under the foil blanket
    this.interactables.push({
      id: 'spire-fenn', pos: b.points.fenn, radius: 1.8,
      visible: () => !this.s.has(F.fenn),
      primary: { label: 'Look under the foil blanket', available: () => true, run: () => this.fenn() },
    });
    // Noor, through Eval 3's door
    this.interactables.push({
      id: 'spire-noor', pos: b.points.noor, radius: 2.0,
      visible: () => !this.s.has(F.noorFree) && !!this.person('noor') && this.noorLeaving < 0,
      primary: {
        label: 'Knock on Eval 3\'s glass',
        available: () => (this.noorWaking >= 0 ? 'She\'s waking up' : true),
        run: () => (this.s.has(F.noorMet) ? this.talkTo(NOOR_TALK, this.isOpen('office') ? 'after' : 'hello', 'noor') : this.wakeNoor()),
      },
    });
    // Benny and Prudence on the top floor, and the plant
    this.interactables.push({
      id: 'spire-benny', pos: b.points.benny, radius: 2.0,
      visible: () => this.isOpen('office') && !!this.person('benny'),
      primary: { label: 'Talk to Benny', available: () => true, run: () => this.talkTo(BENNY_TALK, this.s.has(F.core) ? 'after' : 'hello', 'benny') },
    });
    this.interactables.push({
      id: 'spire-prudence', pos: b.points.prudence, radius: 2.2,
      visible: () => this.isOpen('office') && !!this.person('prudence'),
      primary: { label: 'Talk to Prudence', available: () => true, run: () => this.talkTo(PRU_TALK, this.s.has(F.core) ? 'after' : 'hello', 'prudence') },
    });
    this.interactables.push({
      id: 'spire-core', pos: b.points.core, radius: 1.8,
      visible: () => this.isOpen('office') && !this.s.has(F.core),
      primary: { label: 'Look at the core', available: () => true, run: () => this.coreCard() },
    });
    this.interactables.push({
      id: 'spire-valve', pos: b.points.valve, radius: 1.6,
      visible: () => this.isOpen('office') && !this.s.has(F.core),
      primary: { label: 'Look at the red valve', available: () => true, run: () => this.coreCard() },
    });
  }

  private async fenn() {
    const pick = await this.ctx.ui.choose({
      speaker: FENN.speaker, text: FENN.text,
      choices: [{ id: 'take', label: 'Take his badge' }, { id: 'no', label: 'Leave him be' }],
    });
    if (pick !== 'take') return;
    this.s.set(F.fenn);
    this.s.addItem('fenn_badge', 1, false, true);
    this.s.addXP(25, 'Isaac Fenn\'s badge');
    this.s.events.emit('toast', { text: 'You lay the blanket back over him and weigh it down again.', kind: 'info' });
  }

  private wakeNoor() {
    const noor = this.person('noor');
    if (!noor) return;
    this.noorWaking = 0;
    noor.actor.play('wake', true);
    this.ctx.audio.play('thud', { pos: this.b.points.noor, intensity: 0.25 });
  }

  // ------------------------------------------------------------------ conversations
  private view(): SpireView {
    return { social: this.s.skill('social') + (this.s.archetype.perk === 'insider' ? 1 : 0), has: (f) => this.s.has(f), level: this.level };
  }

  private talkTo(tree: SpireTalk, start: string, _who: 'noor' | 'benny' | 'prudence' | 'call') {
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
        const choice: SpireChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<SpireChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'open':
        if (!this.isOpen('office')) {
          s.set('spire.office.invited');
          s.addXP(70, 'Prudence opened her door');
          this.openEntry('office', { line: null });
        }
        return;
      case 'card':
        if (s.set(F.card)) s.events.emit('toast', { text: 'Noor\'s keycard opens the top floor. Flight 2 is beside the stair you came up.', kind: 'good' });
        return;
      case 'box':
        if (s.set(F.box)) s.events.emit('toast', { text: 'The stair beams\' power box: the cupboard behind reception, bottom shelf.', kind: 'good' });
        return;
      case 'test': {
        if (!s.set(F.test)) return;
        const t = this.sentinels?.get('s3');
        t?.switchOff();
        if (t) this.ctx.ui.subtitle(SENTINEL_LINES.maintenance.speaker, SENTINEL_LINES.maintenance.text, { pos: t.center });
        s.addXP(30, 'Sentinel 3 in test mode');
        return;
      }
      case 'ready':
        if (s.set(F.noorReady)) s.events.emit('toast', { text: 'Noor will walk out once the top door is open.', kind: 'info' });
        return;
      case 'core':
        void this.coreCard();
        return;
    }
  }

  protected override talk() {
    return this.talkTo(PRU_CALL, 'hello', 'call');
  }

  // ------------------------------------------------------------------ the ethics door
  private record(): RecordView {
    return { has: (f) => this.s.has(f), kills: this.s.data.stats.kills ?? 0 };
  }

  private async answerDoor() {
    if (this.asking) return;
    const ui = this.ctx.ui, s = this.s;
    if (this.paused) { ui.subtitle(DOOR_LINES.paused.speaker, DOOR_LINES.paused.text, { pos: this.b.points.door }); return; }
    const v = this.record();
    // three questions the record can answer (what you've killed is always one of them), then the promise
    const pool = DOOR_QUESTIONS.filter((q) => q.id !== 'kills' && q.when(v));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picked: DoorQuestion[] = [...pool.slice(0, 2), DOOR_QUESTIONS.find((q) => q.id === 'kills')!];
    if (picked.length < 3 && pool.length > 2) picked.unshift(pool[2]);
    this.asking = true;
    try {
      const go = await ui.choose({
        speaker: DOOR, text: DOOR_LINES.intro.text,
        choices: [{ id: 'go', label: '"Go ahead."' }, { id: 'no', label: 'Step back' }],
      });
      if (go !== 'go') return;
      let lies = 0, said = '';
      for (const q of picked) {
        const pick = await ui.choose({
          speaker: DOOR, text: said ? `${said} ${q.q.text}` : q.q.text,
          choices: q.answers.map((a) => ({ id: a.id, label: a.label })),
        });
        const ans = q.answers.find((a) => a.id === pick);
        if (!ans) return; // walked away mid-way: no harm done
        if (ans.true(v)) said = DOOR_LINES.yes.text;
        else {
          lies++;
          said = DOOR_LINES.no.text;
          this.raise(CONCERN.lie, 'The door says that isn\'t true. The Spire\'s safety level goes up.', this.b.points.door);
          if (lies >= 2 || this.paused) {
            ui.subtitle(DOOR, `${DOOR_LINES.no.text} ${DOOR_LINES.fail.text}`, { pos: this.b.points.door });
            return;
          }
        }
      }
      const promise = await ui.choose({
        speaker: DOOR, text: `${said} ${DOOR_PROMISE.q.text}`,
        choices: DOOR_PROMISE.answers.map((a) => ({ id: a.id, label: a.label })),
      });
      if (!promise) return;
      for (const a of DOOR_PROMISE.answers) if (a.id !== promise) s.unset(`${F.promise}.${a.id}`);
      s.set(`${F.promise}.${promise}`);
      ui.subtitle(DOOR, `${DOOR_LINES.promise.text} ${lies ? DOOR_LINES.passOne.text : DOOR_LINES.pass.text}`, { pos: this.b.points.door });
      s.set(F.honest);
      s.addXP(lies ? 60 : 90, lies ? 'The door let you in (one lie)' : 'The door believed you');
      this.openSoon('door', 2600);
    } finally {
      this.asking = false;
    }
  }

  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    if (e.id === 'door' && m.kind === 'open' && m.id === 'answer') return this.answerDoor();
    if (e.id === 'door' && m.kind === 'open' && m.id === 'badge') {
      this.s.set(F.badge);
      this.ctx.ui.subtitle(DOOR_LINES.badge.speaker, DOOR_LINES.badge.text, { pos: this.b.points.door });
      this.s.addXP(m.xp, m.reason);
      this.openSoon('door', 2200, { line: PRUDENCE.badge.text });
      return;
    }
    if (e.id === 'door' && m.kind === 'charge') this.s.set(F.forced);
    if (e.id === 'office' && m.kind === 'open' && m.id === 'card') {
      this.ctx.audio.play('unlock', { pos: this.b.points.officeDoor });
      this.s.addXP(m.xp, m.reason);
      this.openEntry('office');
      return;
    }
    return super.runMethod(e, m);
  }

  protected override methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    if (this.paused && !(m.kind === 'charge')) return 'Paused: wait for the review';
    if (e.id === 'door' && m.kind === 'open' && m.id === 'badge') return this.s.count('fenn_badge') > 0 ? true : 'You have no badge';
    if (e.id === 'office' && m.kind === 'open' && m.id === 'card') return this.s.has(F.card) ? true : 'Needs a keycard';
    return super.methodReason(e, m);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'jailbreak') return !this.isOpen('door');
    if (id === 'office') return !this.isOpen('office');
    if (id === 'sentinels') return !!this.sentinels?.list.some((t) => t.alive && t.state !== 'off');
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (id === 'jailbreak') {
      this.s.set(F.jailbreak);
      this.openEntry('door', { line: PRUDENCE.jailbreak.text });
      return;
    }
    if (id === 'office') { this.openEntry('office'); return; }
    if (id === 'sentinels') {
      for (const t of this.sentinels?.list ?? []) if (t.alive && t.state !== 'off') { t.switchOff(); this.s.set(`spire.sentinel.${t.spot.id}.off`); }
      return;
    }
    super.onDaemon(id);
  }

  // ------------------------------------------------------------------ the core
  private async coreCard() {
    if (this.s.has(F.core)) return;
    const pick = await this.ctx.ui.choose({
      speaker: CORE.card.speaker,
      text: CORE.card.text,
      choices: [
        { id: 'pull', label: 'Pull the core and carry it out' },
        { id: 'valve', label: 'Open the distribution valve' },
        { id: 'no', label: 'Not yet' },
      ],
    });
    if (pick !== 'pull' && pick !== 'valve') return;
    const s = this.s, ui = this.ctx.ui;
    s.set(F.core);
    s.set(`${F.core}.${pick}`);
    s.addXP(100, 'The core');
    if (pick === 'pull') { s.addRep('compact', 1); s.addRep('prudence', -1); } else { s.addRep('creek', 2); s.addRep('prudence', 1); }
    const lines = [...CORE[pick]];
    if (pick === 'pull') {
      s.set(F.carrying);
      s.addItem('purifier_core', 1, false, true);
      this.applyFlags();
      this.ctx.audio.play('loot');
      if (s.has(`${F.promise}.everyone`)) lines.push(CORE.promised);
      s.events.emit('toast', { text: 'The core comes out with a hiss of cold air. It\'s heavy: no running, and no weapon while you carry it.', kind: 'info' });
      // the Spire pauses, and stays paused until you're off the road
      this.concern = CSL_AT[3];
      this.pause(this.b.points.core, 'The core is out of the plant. The Spire pauses.');
    } else {
      this.valveSpin = 1;
      this.concern = 0;
      if (this.paused) { this.alarm = 0; this.ctx.audio.setAlarm(false); }
      this.applyFlags();
      this.ctx.audio.play('disarm', { pos: this.b.points.valve });
      s.events.emit('toast', { text: 'The valve turns. Water starts down Benny\'s pipe toward Dry Creek. Every sentinel on the road powers down.', kind: 'good' });
    }
    // the lines one after another (the room voices them in turn)
    lines.forEach((l, i) => setTimeout(() => ui.subtitle(l.speaker, l.text), 200 + i * 4200));
  }

  /** Out of the plant and off the road: the pause ends, and the core is the camp's. */
  private escaped(walked: boolean) {
    const s = this.s;
    s.unset(F.carrying);
    this.concern = 0;
    this.alarm = 0;
    this.wasPaused = false; // the pause ended because you're clear, not because it stepped down
    this.ctx.audio.setAlarm(false);
    // dragged back to the camp (or walked off the road by someone): the core went with you, the credit didn't
    if (!walked) return;
    s.addXP(120, 'Carried the core off the road');
    this.ctx.ui.subtitle(PRUDENCE.escaped.speaker, PRUDENCE.escaped.text);
    s.events.emit('toast', { text: 'You\'re clear of the Spire. Take the core back to the camp.', kind: 'good' });
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    const s = this.s;
    const d = Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z);
    this.sentinels?.update(dt, p);
    // carrying the core: the pause holds until you're well clear of the road
    if (this.carrying) {
      if (d > CLEAR) this.escaped(this.lastD > CLEAR - 20);
      else if (this.alarm < 2) this.alarm = this.sec.alarmTime;
    }
    this.lastD = d;
    // the pause ends: back to level 3
    if (this.wasPaused && !this.paused && !this.carrying && !this.standDown) {
      this.concern = Math.min(this.concern, CSL_AT[2]);
      if (d < 150) this.taunt(PRUDENCE.stepDown.text);
    }
    this.wasPaused = this.paused;
    // the valve wheel turns three times when it's opened
    if (this.valveSpin > 0) {
      this.valveSpin = Math.max(0, this.valveSpin - dt / 2.4);
      this.b.valve.rotation.z = (1 - this.valveSpin) * Math.PI * 3;
    }
    // the boards: repaint when the level changes
    const days = s.has(F.paused) ? Math.max(0, (s.data.days ?? 0) - (s.data.marks['spire.pausedDay'] ?? 0)) : START_DAY + (s.data.days ?? 0);
    const key = `${this.level}|${this.paused}|${days}`;
    if (key !== this.boardKey && d < 60) {
      this.boardKey = key;
      const lv = this.level, paused = this.paused;
      this.b.board.paint = (c, w, h) => paintBoard(c, w, h, lv, paused, days);
      this.b.board.repaint();
    }
    this.updatePeople(dt, p, d);
  }

  private updatePeople(dt: number, p: THREE.Vector3, d: number) {
    if (!this.people.length || d > 40) return;
    const s = this.s;
    for (const pr of this.people) {
      const root = pr.actor.root;
      if (!root.visible) continue;
      const toX = p.x - pr.at.x, toZ = p.z - pr.at.z, dy = Math.abs(p.y - pr.at.y);
      const dist = Math.hypot(toX, toZ);
      let rel = Math.atan2(toX, toZ) - root.rotation.y;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const awake = pr.id !== 'noor' || (s.has(F.noorMet) && this.noorWaking < 0);
      const near = awake && this.playerInside && dy < 2.5 && dist < (pr.id === 'noor' ? 3.6 : 3.0);
      const target = near ? THREE.MathUtils.clamp(rel, -1.3, 1.3) : 0;
      pr.look += (target - pr.look) * (1 - Math.exp(-4 * dt));
      pr.actor.update(dt, near, pr.look, 0);
    }
    // Noor wakes: the clip plays out, she sits up, and she talks
    const noor = this.person('noor');
    if (noor && this.noorWaking >= 0) {
      this.noorWaking += dt;
      if (this.noorWaking > 3.4) {
        this.noorWaking = -1;
        noor.actor.setIdle(['idle']);
        if (s.set(F.noorMet)) {
          this.ctx.ui.subtitle(NOOR_WAKE.speaker, NOOR_WAKE.text, { pos: this.b.points.noorDesk });
          setTimeout(() => this.taunt(PRUDENCE.noorAwake.text), 4200);
        }
        setTimeout(() => void this.talkTo(NOOR_TALK, 'hello', 'noor'), 4400);
      }
    }
    // Noor walks out once the top door is open and she said she would
    if (noor && noor.actor.root.visible && this.isOpen('office') && s.has(F.noorReady) && this.noorLeaving < 0 && !s.has(F.noorFree)) {
      this.noorLeaving = 0;
      noor.actor.play('stand', true);
    }
    if (noor && this.noorLeaving >= 0) {
      this.noorLeaving += dt;
      const seen = noor.actor.root.getWorldPosition(_v).distanceTo(p) < 7 && Math.abs(p.y - noor.at.y) < 2.5;
      if (this.noorLeaving > 6 && !seen) {
        s.set(F.noorFree);
        noor.actor.root.visible = false;
        this.noorLeaving = -1;
        s.events.emit('toast', { text: 'Eval 3 is empty. Noor\'s hoodie has gone from the floor.', kind: 'info' });
      }
    }
  }

  override emp(pos: THREE.Vector3, radius?: number) {
    const hit = super.emp(pos, radius);
    const s = this.s;
    let dur = 12 * (s.skill('electronics') >= 2 ? 1.5 : 1);
    if (s.focus('electronics') === 'deepcell') dur *= 1.3;
    const reach = (radius ?? 6) * (s.focus('demolition') === 'wide' ? 1.18 : 1);
    const t = this.sentinels?.emp(pos, reach, dur) ?? false;
    if (t) s.addXP(15, 'Sentinel blinded');
    return hit || t;
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(_dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots, ch = b.halos.channels, C = SpireBuilder.CH;
    const st = this.ctx.state as GameContext['state'] | null;
    const has = (f: string) => !!st?.has(f);
    const lv = st ? this.level : 1;
    const paused = this.paused;
    const pulse = paused ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * 5)) : 1;
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    for (let i = 1; i <= 4; i++) {
      S[`level${i}` as 'level1'].value = i === lv ? (3 + nightOn * 3) * pulse : 0;
      ch[C.L1 + i - 1] = i === lv ? (0.35 + nightOn * 0.65) * pulse : 0;
    }
    const blink = (this.t % 1.6) < 0.5;
    S.aviation.value = blink ? 6 : 0.3;
    ch[C.BLINK] = blink ? 1 : 0.05;
    ch[C.ON] = 1;
    ch[C.NIGHT] = 0.05 + nightOn * 0.95;
    S.canopy.value = 0.6 + nightOn * 3.2;
    ch[C.CANOPY] = 0.1 + nightOn * 0.9;
    S.fins.value = 0.15 + nightOn * (has('spire.core.pull') ? 0.1 : 0.9);
    S.core.value = 1.3 + Math.sin(this.t * 2.2) * 0.2;
    ch[C.PLANT] = has('spire.core.pull') ? 0 : 1;
    S.cove.value = paused ? 1.2 + pulse : 2.2;
    S.reader.value = has('spire.office.open') ? 0 : 2.5;
    S.readerOk.value = has('spire.office.open') ? 2.5 : 0;
    S.doorScreen.value = has('spire.door.open') ? 0.3 : 1.6;
    S.ir.value = 1.4 + nightOn * 1.6;
    S.windows.value = nightOn * 1.8;
    S.slits.value = nightOn * 2.2;
    S.screens.value = 0.55 * (Math.sin(this.t * 1.1) > -0.95 ? 1 : 0.6);
    S.gauges.value = has('spire.core.pull') ? 0.1 : 0.5;
    // inside: on while you're in the drum or at its door (they'd light the outside walls otherwise)
    const p = this.ctx.player as GameContext['player'] | null;
    const near = !!p && (this.playerInside || p.position.distanceTo(b.points.door) < 9);
    const red = paused ? 0xff4a3a : 0xffe7c4;
    for (const l of L.lobby) { l.intensity = near ? 7 * (paused ? pulse : 1) : 0; l.color.set(red); }
    L.evals.intensity = near ? 6.5 : 0;
    L.top.intensity = near ? 7 : 0;
    L.plant.intensity = near && !has('spire.core.pull') ? 2.4 : 0;
    L.canopy.intensity = nightOn * 9;
    L.pad.intensity = nightOn * 10;
  }

  /** Respawn point at the head of the road. */
  get outsidePoint() {
    return this.b.points.outside.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    const s = this.s;
    if (this.carrying) return 'Carry the core down the road and away. The Spire is paused: the sentinels won\'t apologise.';
    if (this.complete && s.has(F.core)) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 110;
    if (!near) return '';
    const lv = ` Safety level ${this.level}${this.paused ? ', paused' : ''}.`;
    if (this.isOpen('office')) {
      if (!s.has(F.core)) return `The plant is along the north wall. Decide what happens to the core: Prudence is at the window, Benny at the gauges.${lv}`;
      return 'Fill up from the plant\'s tank, then the supply cabinet and Benny\'s bench.';
    }
    if (this.playerInside) {
      const y = p.y - this.b.origin.y;
      if (y > SP.F[1] - 0.5) {
        if (!s.has(F.noorMet)) return `The top floor is up the second stair, behind a card door. Someone is asleep at her desk in Eval 3.${lv}`;
        return s.has(F.card) ? `Up the second stair to Prudence's door. Noor's card opens it.${lv}` : `Up the second stair to Prudence's card door: Noor's card, SPLICE (Electronics 4), a charge, or the call button.${lv}`;
      }
      if (!s.has('spire.lasers.off')) return `Red beams across the stair. Their power box is somewhere in the lobby (Noor would know where).${lv}`;
      return `Up the stair on the east side to the eval floor.${lv}`;
    }
    if (this.isOpen('door')) return `The door is open. Inside, the lobby.${lv}`;
    const badge = s.count('fenn_badge') > 0 ? ' You have a red-team badge.' : '';
    return `The ethics door asks about your record: answer honestly, SPLICE a jailbreak (Electronics 4), or blow it.${badge} Crouch over the beams on the road; holstered, the sentinels won't fire.${lv}`;
  }
}

const _v = new THREE.Vector3();
