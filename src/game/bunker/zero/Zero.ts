import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { ZeroBuilder, ZB, CYLINDERS } from './ZeroBuilder';
import { paintClock } from './zeroAtlas';
import { Helpers, Helper, type HelperHost } from '../dome/helpers';
import {
  ZERO, ZERO_FLAGS as F, POWER, AGNES_LINES, DOORMAN_LINES, AGNES_TALK, ENDING, AGNES_AFTER, BAYS, TAP, SHARE, boardText,
  type ZeroTalk, type ZeroView, type ZeroChoice,
} from '@/content/bunkers/zero';
import { LANDMARKS } from '@/content/world';
import { stealthMeter } from '@/content/progression';
import { ITEMS } from '@/content/items';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels } from '../../world/npcSkin';
import { NpcCrowd, type NpcLook } from '../../world/npc';
import type { GameContext } from '../../context';
import type { Combat } from '../../combat/Combat';

/** Agnes's procedural figure: the fallback if her model fails to load (and under `?procnpc`). */
const AGNES_LOOK: NpcLook = { skin: '#c9a48a', hair: '#8c8984', hairStyle: 'crop', fem: true, build: 0.92, height: 0.93, shirt: '#a07e56', pants: '#4a3a2c', boots: '#4a3020' };

/**
 * The final bunker, Bunker Zero (Act VIII), under the forecourt of Last Chance Gas. The entries, the
 * tripwires, the grid, the cameras and the loot are data (content/bunkers/zero.ts) run by the bunker
 * runtime. What's Zero's own:
 * - the ladder: no hole in the ground, so going down (and up) is a climb in the dark (`ctx.climb`).
 *   Agnes greets you at the bottom, and only talks down there (the manway is in the middle of the camp).
 * - the clock gate: its keypad takes whatever the flip clock over it says when you start typing.
 * - the Doormen (the Dome's Helper patrols): they walk you back to the ladder's foot if they catch you.
 * - the board: four units; the cameras, the grid, the Doormen and the lights take one each, Model Zero
 *   two. Cut the Doormen's power and they sit down where they are.
 * - Model Zero: a cylinder lit for each founder's bunker you opened, and the eighth for the power.
 * - Agnes at her drafting table, and the master board: keep the key, or break it off and open the well.
 */
export class Zero extends Bunker<ZeroBuilder> {
  readonly doormen = new Helpers();
  readonly doormenGroup = new THREE.Group();
  private combat: Combat | null = null;
  private agnes: NpcCrowd | null = null;
  private asking = false;
  private climbing = false;
  private afterIdx = 0;
  private clockKey = '';
  private lastTaunt = 0;
  private underT = 0;
  /** The handle's throw (0 → 1) after the open ending. */
  private handleK = 0;
  private readonly eye = new THREE.Vector3();

  constructor(ctx: GameContext) {
    // the origin sits on the forecourt slab (Last Chance's frame height, plus the slab)
    const gas = LANDMARKS.find((l) => l.id === 'gas')!;
    super(ctx, ZERO, (origin) => new ZeroBuilder(ctx.physics, origin.setY(ctx.hf.heightAt(gas.position[0], gas.position[2]) + 0.2)));
    this.doormenGroup.name = 'zeroDoormen';
    // world-space, parented under the dig so they're only drawn down there
    this.doormenGroup.position.copy(this.b.origin).negate();
    this.b.interior.add(this.doormenGroup);
    this.init();
    this.extraInteractables();
  }

  /** Game: the Doormen are hostiles (shootable; they never hurt you) and need Combat's line of sight. */
  attach(combat: Combat) {
    this.combat = combat;
    combat.register(this.doormen);
  }

  // ------------------------------------------------------------------ flags and power
  private has(f: string) {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(f);
  }

  get ended() {
    return this.has('zero.end.keep') || this.has('zero.end.open');
  }

  /** The camera (or the player) is down the ladder: Game dims the sky's light while it is. */
  get underground() {
    return this.playerInside;
  }

  power() {
    return {
      cameras: !this.has(F.camsOff),
      grid: !this.has(this.flag('lasers.off')),
      doormen: !this.has(F.doormenOff) && !this.ended,
      lights: !this.has(F.lightsOff),
      vault: this.has(F.vaultOn),
    };
  }

  private used(p = this.power()) {
    return (p.cameras ? POWER.cameras : 0) + (p.grid ? POWER.grid : 0) + (p.doormen ? POWER.doormen : 0) + (p.lights ? POWER.lights : 0) + (p.vault ? POWER.vault : 0);
  }

  // ------------------------------------------------------------------ people (from Game.build)
  addPeople(models: NpcModels | null) {
    const host = this.doormanHost();
    for (const id of ['d1', 'd2']) {
      const actor = models?.make('helper', false, 0) ?? null;
      const root = actor?.root ?? stub();
      this.doormenGroup.add(root);
      this.doormen.list.push(new Helper(id, true, this.b.routes[id], actor, root, host));
    }
    const a = this.b.agnesSpot;
    this.agnes = new NpcCrowd([{ id: 'agnes', look: AGNES_LOOK, pose: 'counter', x: a.x, y: a.y, z: a.z, yaw: a.yaw, surface: 1.0, notice: 4 }], 'agnes');
    this.b.interior.add(this.agnes.mesh);
    this.applyFlags(true);
  }

  private doormanHost(): HelperHost {
    const ctx = this.ctx;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get combat() { return self.combat!; },
      audio: ctx.audio,
      say: (line, pos) => { if (pos.distanceTo(ctx.player.position) < 25) ctx.ui.subtitle(line.speaker, line.text, { pos }); },
      floor: () => this.b.origin.y + ZB.FY,
      thermal: () => false,
      shielded: () => false,
      armoured: () => false,
      // switched off at the board they stay sat down, ending or not (friendly first stood them back up)
      standDown: () => (this.has(F.doormenOff) ? 'off' : this.ended ? 'friendly' : 'no'),
      sight: () => {
        const st = this.s;
        const k = st.archetype.stats.stealth * stealthMeter(st.skill('stealth'));
        return k * (this.has(F.lightsOff) ? 0.5 : 1);
      },
      insideDome: () => true,
      onNotice: () => {},
      onCatch: () => this.caught(),
      onShot: () => { this.s.set(F.loud); },
      onDown: () => {},
      onSlip: () => {},
      lines: DOORMAN_LINES,
    };
  }

  /** A Doorman reached you: walked back to the ladder's foot. */
  private caught() {
    const ctx = this.ctx, s = this.s;
    s.set(F.caught);
    const line = DOORMAN_LINES.catch[Math.floor(Math.random() * DOORMAN_LINES.catch.length)];
    ctx.ui.subtitle(line.speaker, line.text);
    ctx.caught('A Doorman takes your elbow, very politely, and walks you all the way back to the ladder.', { to: this.b.points.foot.clone(), yaw: 0, gentle: true, keepY: true });
    setTimeout(() => {
      this.doormen.resetAll();
      this.alarm = 0;
      this.taunt(AGNES_LINES.caught.text);
    }, 1600);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    const b = this.b;
    b.standpipe.visible = this.has('zero.end.open');
    b.campLock.visible = this.has('zero.end.keep');
    if (instant) this.handleK = this.has('zero.end.open') ? 1 : 0;
    // a fresh run (or a save with the power on): any Doorman sat down by the last run gets up
    if (instant && !this.has(F.doormenOff)) for (const d of this.doormen?.list ?? []) d.wake();
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.interactables.push({
      id: 'zero-down', pos: b.points.hatch, radius: 1.8,
      visible: () => this.isOpen('hatch') && !this.has('zero.end.keep'),
      primary: { label: 'Climb down the ladder', available: () => true, run: () => this.climb(true) },
    });
    this.interactables.push({
      id: 'zero-keep-down', pos: b.points.hatch, radius: 1.8,
      visible: () => this.has('zero.end.keep'),
      primary: { label: 'Unlock Mara\'s padlock and climb down', available: () => true, run: () => this.climb(true) },
    });
    this.interactables.push({
      id: 'zero-up', pos: b.points.up, radius: 1.6,
      visible: () => true,
      primary: { label: 'Climb the ladder', available: () => true, run: () => this.climb(false) },
    });
    for (const bay of BAYS) {
      this.interactables.push({
        id: `zero-bay-${bay.id}`, pos: b.bayPoints[bay.id], radius: 1.6,
        visible: () => true,
        primary: { label: 'Read the placard', available: () => true, run: () => this.readBay(bay) },
      });
    }
    this.interactables.push({
      id: 'zero-clockcard', pos: b.points.clockPlacard, radius: 1.6,
      visible: () => !this.isOpen('clock'),
      primary: { label: 'Read the placard', available: () => true, run: () => this.readClock() },
    });
    this.interactables.push({
      id: 'zero-board', pos: b.points.board, radius: 2.0,
      visible: () => !this.ended,
      primary: { label: 'Look at the power board', available: () => true, run: () => this.boardCard() },
    });
    this.interactables.push({
      id: 'zero-agnes', pos: b.points.agnes, radius: 2.2,
      visible: () => this.isOpen('zero'),
      primary: {
        get label() { return self.s.has(F.agnes) ? 'Talk to Agnes' : 'Talk to the woman at the drafting table'; },
        available: () => true,
        run: () => {
          if (this.s.set(F.agnes)) this.s.addXP(40, 'The builder');
          if (this.ended) return this.agnesAfter();
          return this.talkTo(AGNES_TALK, 'hello');
        },
      },
    });
    // afterwards, at the camp: the standpipe on the forecourt (open), or the camp's share by the manway (keep)
    this.interactables.push(this.daily('zero-tap', b.points.standpipe, 'Fill up at the standpipe', 'tap.zero', () => this.has('zero.end.open') && this.has('act8.debriefed'),
      [{ id: 'water', qty: 2 }], 'Water out of the forecourt, cold from two thousand feet down.', TAP.hello));
    this.interactables.push(this.daily('zero-share', b.points.share, 'Take today\'s share from the crate', 'share.zero', () => this.has('zero.end.keep') && this.has('act8.debriefed'),
      [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }], 'Mara brings it up from the stores every morning and padlocks the crate.', SHARE.hello));
    this.interactables.push({
      id: 'zero-master', pos: b.points.master, radius: 1.5,
      visible: () => this.isOpen('zero') && !this.ended,
      primary: { label: 'Look at the master board', available: () => true, run: () => this.masterCard() },
    });
  }

  /** Something you can take once a day while `on()` says so (the first time, somebody says something). */
  private daily(id: string, pos: THREE.Vector3, label: string, mark: string, on: () => boolean, items: { id: string; qty: number }[], first: string, hello: { speaker: string; text: string }) {
    return {
      id, pos, radius: 1.9,
      visible: on,
      primary: {
        label,
        available: () => ((this.s.data.marks[mark] ?? -1) === (this.s.data.days ?? 0) ? 'Already taken today' : true),
        run: () => {
          const s = this.s;
          s.data.marks[mark] = s.data.days ?? 0;
          const got = items.map((it) => `+${s.addItem(it.id, it.qty, false, true)} ${ITEMS[it.id].name.toLowerCase()}`);
          this.ctx.audio.play('pickup');
          const firstTime = s.set(`${mark}.first`);
          if (firstTime) this.ctx.ui.subtitle(hello.speaker, hello.text);
          s.events.emit('toast', { text: firstTime ? `${first} ${got.join(', ')}.` : `${got.join(', ')}. More tomorrow.`, kind: 'good' });
        },
      },
    };
  }

  /** Down (or up) sixty rungs: a fade, and you're at the other end. */
  private climb(down: boolean) {
    if (this.climbing) return;
    this.climbing = true;
    const to = down ? this.b.points.foot.clone() : this.b.points.surfaceOut.clone();
    this.ctx.audio.play('door', { pos: this.b.points.hatch });
    const text = down ? (this.has(F.down) ? 'Sixty rungs down.' : 'Sixty rungs, hand under hand, into air that smells of wet concrete and diesel.') : 'Sixty rungs up, into the noise of the camp.';
    // (yaw 0 looks north: down there, at the door; up top, at the manway and the store)
    this.ctx.climb(to, down ? 0 : Math.PI, text, () => {
      this.climbing = false;
      if (!down) return;
      if (this.s.set(F.down)) {
        this.s.set(F.seen);
        this.s.addXP(40, 'Under the forecourt');
        this.ctx.ui.banner('BUNKER ZERO', 'A fallout shelter from 1961, and past it, every bunker in the valley as it was first drawn. Agnes Price built them all. This one is hers. Tier 8.', 'info');
        setTimeout(() => this.taunt(AGNES_LINES.greet.text), 2400);
      }
    });
  }

  private async readBay(bay: (typeof BAYS)[number]) {
    if (this.asking) return;
    this.asking = true;
    try {
      if (this.s.set(`zero.bay.${bay.id}`)) this.s.addXP(15, 'A change order');
      if (bay.id === 'apex') this.s.set(F.clockRead);
      await this.ctx.ui.choose({ speaker: bay.title, text: bay.text, choices: [{ id: 'ok', label: 'Step back' }] });
    } finally {
      this.asking = false;
    }
  }

  private async readClock() {
    if (this.asking) return;
    this.asking = true;
    try {
      this.s.set(F.clockRead);
      const sec = this.entry('clock').secondary;
      const text = sec && 'methods' in sec ? sec.text : '';
      await this.ctx.ui.choose({ speaker: 'The clock gate', text: `${text}\nThe clock reads ${this.clockShown()}.`, choices: [{ id: 'ok', label: 'Step back' }] });
    } finally {
      this.asking = false;
    }
  }

  private async boardCard() {
    if (this.asking) return;
    this.asking = true;
    if (this.s.set('zero.board.seen')) setTimeout(() => this.taunt(AGNES_LINES.board.text), 400);
    try {
      for (let i = 0; i < 10; i++) {
        const p = this.power(), free = POWER.units - this.used(p);
        const need = (n: number) => (free >= n ? undefined : 'Not enough power: switch something off first');
        const pick = await this.ctx.ui.choose({
          speaker: 'The power board',
          text: boardText(p),
          choices: [
            { id: 'cameras', label: p.cameras ? 'Switch the cameras off' : 'Switch the cameras on', disabled: p.cameras ? undefined : need(POWER.cameras) },
            { id: 'grid', label: p.grid ? 'Switch the grid off' : 'Switch the grid on', disabled: p.grid ? undefined : need(POWER.grid) },
            { id: 'doormen', label: p.doormen ? 'Switch the Doormen off' : 'Switch the Doormen on', disabled: p.doormen ? undefined : need(POWER.doormen) },
            { id: 'lights', label: p.lights ? 'Switch the lights off' : 'Switch the lights on', disabled: p.lights ? undefined : need(POWER.lights) },
            { id: 'vault', label: p.vault ? 'Take the power off Model Zero' : 'Give Model Zero its two units', disabled: p.vault ? undefined : need(POWER.vault) },
            { id: 'no', label: 'Step back' },
          ],
        });
        if (!pick || pick === 'no') return;
        this.toggle(pick as 'cameras' | 'grid' | 'doormen' | 'lights' | 'vault');
      }
    } finally {
      this.asking = false;
    }
  }

  private toggle(what: 'cameras' | 'grid' | 'doormen' | 'lights' | 'vault') {
    const s = this.s, p = this.power();
    this.ctx.audio.play('disarm', { pos: this.b.points.board });
    if (what === 'cameras') {
      if (p.cameras) this.cameras?.kill();
      else { s.unset(F.camsOff); this.applyFlags(); }
    } else if (what === 'grid') {
      if (p.grid) this.lasers?.kill();
      else { s.unset(this.flag('lasers.off')); this.applyFlags(); }
    } else if (what === 'doormen') {
      if (p.doormen) {
        s.set(F.doormenOff);
        const l = DOORMAN_LINES.off;
        for (const d of this.doormen.list) if (d.center.distanceTo(this.ctx.player.position) < 25) { this.ctx.ui.subtitle(l.speaker, l.text, { pos: d.center }); break; }
        s.events.emit('toast', { text: 'Somewhere in the showroom, two machines sit down where they are.', kind: 'good' });
      } else {
        s.unset(F.doormenOff);
        for (const d of this.doormen.list) d.wake();
      }
    } else if (what === 'lights') {
      if (p.lights) { s.set(F.lightsOff); s.events.emit('toast', { text: 'The showroom goes dark except for the exit signs and the bays.', kind: 'info' }); } else s.unset(F.lightsOff);
    } else if (what === 'vault') {
      if (p.vault) s.unset(F.vaultOn);
      else {
        s.set(F.vaultOn);
        if (s.set('zero.vault.powered')) s.addXP(40, 'Power to Model Zero');
        s.events.emit('toast', { text: 'Out in the showroom, the lamp in the middle of Model Zero goes green.', kind: 'good' });
      }
    }
  }

  private agnesAfter() {
    const lines = this.has('zero.end.open') ? AGNES_AFTER.open : AGNES_AFTER.keep;
    const l = lines[this.afterIdx++ % lines.length];
    this.ctx.ui.subtitle(l.speaker, l.text, { pos: this.b.points.agnes });
  }

  // ------------------------------------------------------------------ conversations
  private view(): ZeroView {
    const s = this.s;
    return {
      social: s.skill('social') + (s.archetype.perk === 'insider' ? 1 : 0),
      electronics: s.skill('electronics'),
      has: (f) => s.has(f),
    };
  }

  private talkTo(tree: ZeroTalk, start: string) {
    return this.ctx.ui.converse({
      start,
      node: (id) => {
        const node = tree[id];
        if (!node) return null;
        const v = this.view();
        return {
          speaker: node.speaker,
          text: node.text,
          choices: node.choices.filter((c) => !c.when || c.when(v)).map((c) => ({ id: c.id, label: c.label, next: c.next ?? '' })),
        };
      },
      onChoice: (nodeId, choiceId) => {
        const choice: ZeroChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<ZeroChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'why':
        if (s.set(F.why)) { s.addXP(30, 'Why it stayed shut'); s.addRep('agnes', 1); }
        return;
      case 'well':
        if (s.set(F.well)) s.events.emit('toast', { text: 'The red handle is on the pump at the wellhead. Down sends the water up the surface line to the forecourt.', kind: 'info' });
        return;
      case 'end':
        setTimeout(() => void this.masterCard(), 300);
        return;
    }
  }

  // ------------------------------------------------------------------ the ending
  private async masterCard() {
    if (this.ended || this.asking) return;
    const v = this.view();
    const canOpen = this.has(F.well) || v.electronics >= 5;
    this.asking = true;
    let pick: string | null;
    try {
      pick = await this.ctx.ui.choose({
        speaker: ENDING.card.speaker,
        text: ENDING.card.text,
        choices: [
          { id: 'keep', label: 'Take the key home: Zero belongs to Last Chance' },
          { id: 'open', label: 'Break the key, and send the well up to the forecourt', disabled: canOpen ? undefined : ENDING.openNeeds },
          { id: 'no', label: 'Not yet' },
        ],
      });
    } finally {
      this.asking = false;
    }
    if (pick !== 'keep' && pick !== 'open') return;
    const s = this.s, ui = this.ctx.ui;
    s.set(F.end);
    s.set(`${F.end}.${pick}`);
    s.data.marks['zero.endDay'] = s.data.days ?? 0;
    s.addXP(150, pick === 'keep' ? 'The master key' : 'Anyone\'s');
    if (pick === 'keep') { s.addRep('mara', 1); s.addRep('compact', -1); s.addRep('agnes', -1); } else { s.addRep('compact', 3); s.addRep('mara', 1); s.addRep('agnes', 2); }
    this.alarm = 0;
    this.ctx.audio.setAlarm(false);
    this.cameras?.kill();
    this.doormen.resetAll();
    if (pick === 'keep') {
      this.ctx.audio.play('unlock', { pos: this.b.points.master });
      s.events.emit('toast', { text: 'The key comes out of the ZERO switch with a click. It\'s heavier than it looks, and warm from the lamp.', kind: 'good' });
    } else {
      this.ctx.audio.play('thud', { pos: this.b.points.wellhead, intensity: 0.4 });
      this.ctx.cam.addTrauma(0.12);
      s.events.emit('toast', { text: 'You snap the key off in the ZERO switch and throw the red handle on the wellhead. The pump changes note, and the surface line starts to knock.', kind: 'good' });
    }
    this.applyFlags();
    ENDING[pick].forEach((l, i) => setTimeout(() => ui.subtitle(l.speaker, l.text, l.speaker === 'Mara Voss' ? {} : { pos: this.b.points.agnes }), 600 + i * 5200));
  }

  // ------------------------------------------------------------------ the runtime's hooks
  /** The flip clock's four digits: the game's hour and minute, 24-hour. */
  private clockDigits() {
    const st = this.ctx.state as GameContext['state'] | null;
    const hour = st ? (this.ctx.atmo.hour as number) : 21.75;
    const hh = Math.floor(hour) % 24, mm = Math.floor((hour - Math.floor(hour)) * 60);
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  }

  private clockShown() {
    const d = this.clockDigits();
    return `${d.slice(0, 2)}:${d.slice(2)}`;
  }

  protected override methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    if (e.id === 'zero' && m.kind === 'open' && m.id === 'power') return this.power().vault ? true : 'Model Zero has no power (the board, in the room off the east wall)';
    return super.methodReason(e, m);
  }

  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    if (m.kind === 'charge') this.s.set(F.loud);
    if (e.id === 'hatch' && m.kind === 'charge') {
      await super.runMethod(e, m);
      // a bang in the middle of the camp: Mara, not Agnes
      if (this.isOpen('hatch')) setTimeout(() => this.ctx.ui.subtitle(AGNES_LINES.hatchLoud.speaker, AGNES_LINES.hatchLoud.text), 900);
      return;
    }
    if (e.id === 'clock' && m.kind === 'keypad') {
      // the gate takes whatever the clock says when you start typing (it's right there over the gate)
      const d = this.clockDigits();
      const known = { when: [F.clockRead, 'apex.code'], text: `The flip clock over the gate reads ${d.slice(0, 2)}:${d.slice(2)}. Type it before it turns over.` };
      return super.runMethod(e, { ...m, code: d, hints: [known] });
    }
    await super.runMethod(e, m);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'clockgate') return !this.isOpen('clock');
    if (id === 'zerodoor') return !this.isOpen('zero');
    if (id === 'doormen') return !this.has(F.doormenOff);
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (id === 'clockgate') { this.openEntry('clock'); return; }
    if (id === 'zerodoor') { this.openEntry('zero'); return; }
    if (id === 'doormen') { this.s.set(F.doormenOff); return; }
    super.onDaemon(id);
  }

  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    if (this.ended) return;
    // up on the forecourt (the dials jammed) there's no siren: just the camp looking over
    if (!this.playerInside) { this.s.events.emit('toast', { text: reason, kind: 'bad' }); return; }
    super.triggerAlarm(at, reason);
    this.s.set(F.loud);
    if (at) for (const d of this.doormen.list) if (d.center.distanceTo(at) < 30) d.investigate(at);
  }

  override emp(pos: THREE.Vector3, radius?: number) {
    const hit = super.emp(pos, radius);
    return this.doormen.emp(pos, radius ?? 6, 14, false, () => {}) || hit;
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    const b = this.b;
    const under = this.playerInside;
    // the manway's lid lifts on its hinge with its door's `open`; the hole shows once it's up
    const hatch = b.doors.hatch;
    b.lid.rotation.x = -hatch.open * 1.95;
    b.hole.visible = hatch.open > 0.3 && !this.has('zero.end.keep');
    // Agnes's PA: wherever you are down there, it comes from the nearest speaker; she taunts in the showroom
    if (under) {
      this.underT += dt;
      let best = b.speakers[0], bd = Infinity;
      for (const sp of b.speakers) { const d = sp.distanceToSquared(p); if (d < bd) { bd = d; best = sp; } }
      b.points.speaker.copy(best);
      const z = p.z - b.origin.z;
      const inShowroom = z < ZB.SHOW_Z0 && z > ZB.SHOW_Z1 - 1;
      if (inShowroom && this.s.set('zero.showroom.said')) this.taunt(AGNES_LINES.gallery.text);
      else if (inShowroom && !this.isOpen('zero') && this.underT - this.lastTaunt > 38 + (this.t % 17)) {
        this.lastTaunt = this.underT;
        this.taunt();
      }
    }
    // the Doormen and Agnes
    const player = this.ctx.player;
    const chest = this.eye.set(p.x, p.y + (player.crouching ? 0.7 : 1.3), p.z);
    this.doormen.update(dt, p, chest, player.crouching, false, under);
    if (under && this.agnes) this.agnes.update(dt, this.ctx.player.position.clone().setY(p.y + 1.6));
    // the clock over the gate: repaint when the minute turns
    if (under) {
      const d = this.clockDigits();
      if (d !== this.clockKey) {
        this.clockKey = d;
        b.clock.paint = (c, w, h) => paintClock(c, w, h, d);
        b.clock.repaint();
      }
    }
    // the red handle drops in the open ending
    this.handleK += ((this.has('zero.end.open') ? 1 : 0) - this.handleK) * Math.min(1, dt * 3);
    b.handle.rotation.z = -this.handleK * 1.4;
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(_dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots;
    const st = this.ctx.state as GameContext['state'] | null;
    const has = (f: string) => !!st?.has(f);
    const under = this.playerInside;
    const lightsOff = has(F.lightsOff);
    const alarm = this.alarm > 0 ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * 5)) : 1;
    const vaultOn = has(F.vaultOn) || has(this.entryFlag('zero'));
    S.trough.value = (lightsOff ? 0.1 : 2.4) * alarm;
    S.bays.value = lightsOff ? 0.9 : 2.0;
    S.exit.value = 2.2;
    S.boardWarn.value = this.alarm > 0 ? (this.t % 0.8 < 0.4 ? 2 : 0.2) : 0;
    S.clockLamp.value = this.isOpenSafe('clock') ? 0.2 : 1.5;
    S.well.value = 2.0;
    S.office.value = 3.0;
    S.dorm.value = 1.2;
    S.lamp.value = 3.0;
    S.surface.value = has('zero.end.open') ? 2.4 * Math.max(0.3, night) + 0.6 : 0;
    // Model Zero's lamps: green for each founder's bunker you opened, and for the power
    CYLINDERS.forEach((c, i) => {
      const ok = has(`${c.id}.complete`);
      b.cylOk[i].value = ok ? 3.2 : 0;
      b.cylNo[i].value = ok ? 0 : 2.2;
    });
    b.cylOk[7].value = vaultOn ? 3.6 : 0;
    b.cylNo[7].value = vaultOn ? 0 : 2.6 * (this.t % 1.2 < 0.6 ? 1 : 0.3);
    // the board's lamps, top to bottom: cameras, grid, doormen, lights, Model Zero
    const pw = st ? this.power() : { cameras: true, grid: true, doormen: true, lights: true, vault: false };
    [pw.cameras, pw.grid, pw.doormen, pw.lights, pw.vault].forEach((on, i) => { b.boardLamps[i].value = on ? 1.8 : 0.05; });
    const ch = b.halos.channels, C = ZeroBuilder.CH;
    ch[C.ON] = 1;
    ch[C.SHOW] = lightsOff ? 0.2 : 1;
    ch[C.ZERO] = 1;
    ch[C.WELL] = 1;
    // the real lights only while you're down there (from the forecourt they'd steal the camp's)
    const k = under ? 1 : 0;
    L.foot.intensity = k * 3.2;
    for (const l of L.show) l.intensity = k * (lightsOff ? 0.25 : 5.5) * alarm;
    L.board.intensity = k * 4.5;
    L.zero.intensity = k * 3.5;
    L.hall.intensity = k * 7;
    L.office.intensity = k * 3;
    L.dorm[0].intensity = k * 2.2;
    L.dorm[1].intensity = k * 1.2;
    b.hatchLamp.intensity = has('zero.end.open') && !under ? 2.5 * Math.max(0.15, night) : 0;
  }

  private isOpenSafe(entry: string) {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(this.entryFlag(entry));
  }

  /** Where the Doormen leave you (and the respawn point down there). */
  get outsidePoint() {
    return this.b.points.foot.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    if (!this.has(F.known)) return '';
    if (this.complete && this.ended) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 12;
    if (!near) return '';
    if (!this.playerInside) {
      if (!this.isOpen('hatch')) return this.has(F.permit) ? 'The manway on the forecourt: a dial padlock. The combination is the bore\'s depth on Mara\'s permit.' : 'The manway on the forecourt, east of the store: a dial padlock, a pick, or a charge.';
      return 'Climb down the ladder.';
    }
    if (this.ended) return 'The cistern, the stores and Agnes\'s plan chest are in the well hall.';
    if (this.isOpen('zero')) return 'Agnes is at her drafting table in the glass booth by the well. The master board is behind her.';
    if (!this.isOpen('door61')) return 'The door at the bottom of the ladder.';
    const z = p.z - this.b.origin.z;
    if (!this.isOpen('clock') && z > ZB.GATE_Z) return 'Through the showroom to the clock gate: tin cans on wires, a camera, a Doorman. Keep behind the displays.';
    const pw = this.power();
    if (!pw.vault) return `Model Zero needs two units. The power board is in the room off the east wall, at the far end (${this.used(pw)} of ${POWER.units} in use).`;
    return 'Model Zero has power. It\'s in the north wall at the end of the showroom.';
  }
}

/** A Doorman's stand-in when the models didn't load (?procnpc): a pale capsule. */
function stub() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 10), new THREE.MeshStandardNodeMaterial({ color: '#d8dde0', roughness: 0.5 }));
  body.position.y = 0.95;
  g.add(body);
  return g;
}
