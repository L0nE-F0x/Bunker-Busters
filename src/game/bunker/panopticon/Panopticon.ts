import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { PanopticonBuilder, PAN } from './PanopticonBuilder';
import { paintFeeds } from './panopticonAtlas';
import {
  PANOPTICON, PAN_FLAGS as F, PAN_CAMERAS, PAN_LAMP, EZRA, EZRA_GATE, EZRA_TOWER, ADA_TALK, ARCHIVE, REVIEWERS,
  type PanTalk, type PanView, type PanChoice,
} from '@/content/bunkers/panopticon';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import type { GameContext } from '../../context';

const CH = PanopticonBuilder.CH;
/** A/B: ?nolamp hides the beam (it's the building's most expensive draw from the valley). */
const NOLAMP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nolamp');
const TOWER_CAMS = ['cam1', 'cam2', 'cam3', 'cam4'];
const POLES = ['pole1', 'pole2', 'pole3'];

interface Person {
  id: 'ezra' | 'ada' | 'kofi' | 'jun';
  actor: NpcActor;
  /** Head turn toward you (smoothed) and the target. */
  look: number;
  /** A reviewer glancing back over their shoulder: seconds left, and seconds to the next glance. */
  glance: number;
  nextGlance: number;
  /** How sure they are they've seen you (0..1). */
  seen: number;
  /** Where to stand to be in their line of sight (their glass, from the yard). */
  at: THREE.Vector3 | null;
}

/**
 * Tier 3, the Panopticon (Act III): Ezra Seymour's building north of the salt. Gate, tower door,
 * cameras and loot are data (content/bunkers/panopticon.ts) run by the bunker runtime. What's his:
 * - the lamp: it turns once every 40 s and sees a long thin wedge of the valley. Caught in it, Ezra
 *   sends Kade up the valley (once). The camp's camera loop files you as nobody, and it passes over.
 * - the face gate: it opens for staff faces. SPLICE yourself onto the list, short it, blow it, or
 *   talk him into opening it (the intercom).
 * - the chain: four cameras on the tower, each watching another one's junction box. Cutting a box
 *   while the camera that watches it is live rings the alarm. Poles have boxes too (nobody watches them).
 * - the people: Ada at desk 7 (talk through her glass; she knows the order and the code, and walks
 *   out once you're in the tower), Kofi (glances back now and then, and reports you), Jun (glances
 *   back, says nothing), Ezra at his monitor wall in the tower.
 * - the archive: take it to Mara, wipe it, or broadcast it.
 * `onAlarm` (set by Game) sends a Kade squad up the valley.
 */
export class Panopticon extends Bunker<PanopticonBuilder> {
  private people: Person[] = [];
  private feedT = 0;
  private lampSeen = 0;
  private lampYaw = 0;
  private alarmCall = 0;
  private adaLeaving = -1;
  private lastAllDark = false;

  constructor(ctx: GameContext) {
    super(ctx, PANOPTICON, (origin) => new PanopticonBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    this.b.group.add(this.b.lampPivot);
    this.init();
    this.extraInteractables();
  }

  /** Game hooks Kade's response in here (a squad up the valley to `at`). */
  onAlarm: ((at: THREE.Vector3, from: THREE.Vector3) => void) | null = null;

  // ------------------------------------------------------------------ the people (Meshy models, from Game.build)
  addPeople(models: NpcModels | null) {
    if (!models) return;
    const b = this.b;
    const add = (id: Person['id'], model: string, seated: boolean, spot: { pos: THREE.Vector3; yaw: number }, at: THREE.Vector3 | null) => {
      // (seated: the actor sets its own root height so its hips sit on the chair, 0.46 m)
      const actor = models.make(model, seated, 0.56);
      if (!actor) return;
      actor.root.position.x = spot.pos.x - b.origin.x;
      actor.root.position.z = spot.pos.z - b.origin.z;
      if (!seated) actor.root.position.y = 0;
      actor.root.rotation.y = spot.yaw;
      b.interior.add(actor.root);
      this.people.push({ id, actor, look: 0, glance: 0, nextGlance: 6 + Math.random() * 8, seen: 0, at });
    };
    add('ada', 'ada', true, b.seats.ada, b.points.adaGlass);
    add('kofi', 'rev1', true, b.seats.kofi, b.points.kofiGlass);
    add('jun', 'rev2', true, b.seats.jun, b.points.junGlass);
    add('ezra', 'ezra', false, b.ezraSpot, null);
    this.applyFlags(true);
  }

  private person(id: Person['id']) {
    return this.people.find((p) => p.id === id);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    const st = this.ctx.state as GameContext['state'] | null;
    // Ada's desk is empty once she's walked out
    const ada = this.person('ada');
    if (ada) ada.actor.root.visible = !st?.has(F.adaFree);
    for (const id of [...TOWER_CAMS, ...POLES]) {
      const off = this.camOff(id, st);
      if (this.b.boxLeds[id]) this.b.boxLeds[id].value = off ? 0 : 3;
      if (this.b.boxLedsCut[id]) this.b.boxLedsCut[id].value = off ? 3 : 0;
    }
  }

  private camOff(id: string, st = this.ctx.state as GameContext['state'] | null) {
    const i = this.cameras?.cams.findIndex((c) => c.id === id) ?? -1;
    return !!st && !!this.cameras && i >= 0 && this.cameras.isOff(i, (f) => st.has(f));
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // a junction box under every camera
    for (const def of PAN_CAMERAS) {
      const tower = TOWER_CAMS.includes(def.id);
      this.interactables.push({
        id: `pan-box-${def.id}`,
        pos: b.points[`box_${def.id}`],
        radius: 1.5,
        visible: () => !this.camOff(def.id),
        primary: { label: tower ? `Cut ${def.label}'s cable` : `Cut the cable on ${def.label}`, available: () => true, run: () => this.cut(def.id) },
      });
    }
    // Ada, Kofi and Jun through their glass
    this.interactables.push({
      id: 'pan-ada', pos: b.points.adaGlass, radius: 1.8,
      visible: () => !this.s.has(F.adaFree) && !!this.person('ada'),
      primary: { label: 'Talk to the woman at desk 7', available: () => true, run: () => this.talkTo(ADA_TALK, this.complete ? 'after' : 'hello', 'ada') },
    });
    for (const id of ['kofi', 'jun'] as const) {
      this.interactables.push({
        id: `pan-${id}`, pos: b.points[`${id}Glass`], radius: 1.6,
        visible: () => !!this.person(id),
        primary: { label: `Knock on desk ${REVIEWERS[id].desk}'s glass`, available: () => true, run: () => this.ctx.ui.subtitle(REVIEWERS[id].talk.speaker, REVIEWERS[id].talk.text, { pos: b.points[`${id}Glass`] }) },
      });
    }
    // Ezra at his wall, and the archive in the rack behind him
    this.interactables.push({
      id: 'pan-ezra', pos: b.points.ezra, radius: 2.2,
      visible: () => this.isOpen('tower') && !!this.person('ezra'),
      primary: { label: 'Talk to Ezra', available: () => true, run: () => this.talkTo(EZRA_TOWER, this.s.has(F.archive) && this.complete ? 'after' : 'hello', 'ezra') },
    });
    this.interactables.push({
      id: 'pan-archive', pos: b.points.archive, radius: 1.6,
      visible: () => this.isOpen('tower') && !this.s.has(F.archive),
      primary: { label: 'Look at the archive drive', available: () => true, run: () => this.archive() },
    });
  }

  /** Cut a camera at its box. If the camera watching that box is live, it sees you do it. */
  private cut(id: string) {
    const def = PAN_CAMERAS.find((c) => c.id === id)!;
    const at = this.b.points[`box_${id}`];
    this.ctx.audio.play('zap', { pos: at });
    this.sparks.emit(at.clone().setY(at.y + 0.2), 14, 1.8, { up: 0.6, floorY: this.b.origin.y + 0.1, size: 0.02, life: 0.6, electric: true });
    this.cameras?.killOne(id);
    this.s.addXP(15, `${def.label} cut`);
    if (def.watcher && !this.camOff(def.watcher)) {
      const w = PAN_CAMERAS.find((c) => c.id === def.watcher)!;
      this.taunt(EZRA.chain.text);
      this.triggerAlarm(at.clone(), `${w.label} watched you cut ${def.label}.`);
      return;
    }
    if (POLES.includes(id)) {
      if (this.s.set('panopticon.poleline')) this.taunt(EZRA.pole.text);
      else this.s.events.emit('toast', { text: `${def.label} stops recording.`, kind: 'good' });
    } else this.s.events.emit('toast', { text: `${def.label} goes dark.`, kind: 'good' });
  }

  // ------------------------------------------------------------------ conversations
  private view(): PanView {
    return { social: this.s.skill('social') + (this.s.archetype.perk === 'insider' ? 1 : 0), has: (f) => this.s.has(f) };
  }

  private talkTo(tree: PanTalk, start: string, who: 'ada' | 'ezra' | 'gate') {
    if (who === 'ada') this.s.set(F.adaMet);
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
        const choice: PanChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (!choice?.effect) return;
        this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<PanChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'invite':
        if (!this.isOpen('gate')) {
          s.set(F.invited);
          s.addXP(60, 'Talked your way through the face gate');
          this.openEntry('gate', { line: null });
        }
        return;
      case 'chain':
        if (s.set(F.chain)) {
          s.addXP(30, 'Ada told you the camera order');
          s.events.emit('toast', { text: 'Cut camera 1 first (its box is on the tower), then 2, 3 and 4.', kind: 'good' });
        }
        return;
      case 'code':
        if (s.set(F.code)) {
          s.addXP(30, 'Ada told you the tower code');
          s.events.emit('toast', { text: 'The tower code is 2212: Ada\'s place in the Everafter line.', kind: 'good' });
        }
        return;
      case 'ready':
        if (s.set(F.adaReady)) s.events.emit('toast', { text: 'Ada will walk out while Ezra is busy with you in the tower.', kind: 'info' });
        return;
      case 'archive':
        void this.archive();
        return;
    }
  }

  protected override talk() {
    return this.talkTo(EZRA_GATE, this.complete ? 'after' : 'hello', 'gate');
  }

  /** The archive: take it, wipe it, broadcast it, or leave it for now. */
  private async archive() {
    if (this.s.has(F.archive)) return;
    const pick = await this.ctx.ui.choose({
      speaker: ARCHIVE.card.speaker,
      text: ARCHIVE.card.text,
      choices: [
        { id: 'take', label: 'Take the drive to Mara' },
        { id: 'wipe', label: 'Hold the wipe switch down' },
        { id: 'broadcast', label: 'Patch it into the transmitter and send it to every camp' },
        { id: 'no', label: 'Not yet' },
      ],
    });
    if (pick !== 'take' && pick !== 'wipe' && pick !== 'broadcast') return;
    const s = this.s;
    s.set(F.archive);
    s.set(`${F.archive}.${pick}`);
    s.addXP(80, 'The archive');
    const at = this.b.points.ezra;
    if (pick === 'take') {
      s.addItem('archive_drive', 1, false, true);
      s.events.emit('toast', { text: 'You pull the drive from its caddy and put it in your pack.', kind: 'good' });
    } else if (pick === 'wipe') {
      s.events.emit('toast', { text: 'You lift the flap and hold the switch down. The rack\'s lights go out one row at a time.', kind: 'info' });
    } else {
      s.events.emit('toast', { text: 'You key the transmitter. Every camp radio in the valley starts reading out names.', kind: 'info' });
    }
    this.ctx.ui.subtitle(ARCHIVE[pick].speaker, ARCHIVE[pick].text, { pos: at });
    this.applyFlags();
  }

  // ------------------------------------------------------------------ the gate and the tower door
  /** The face gate opens for staff. Yours isn't a staff face until you make it one. */
  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    if (e.id === 'gate' && m.kind === 'open' && !this.s.has(F.enrolled) && !this.s.has(F.invited)) {
      this.ctx.audio.play('deny', { pos: this.b.points.gate });
      this.s.events.emit('toast', { text: 'The gate camera looks at you for a second, and the gate stays shut. Staff faces only.', kind: 'bad' });
      if (this.s.set('panopticon.denied')) this.taunt(EZRA.denied.text);
      return;
    }
    return super.runMethod(e, m);
  }

  protected override methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    // the tower stays shut while the alarm rings
    if (e.id === 'tower' && this.alarm > 0) return 'Lockdown: wait for the alarm to stop';
    return super.methodReason(e, m);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'enrol') return !this.s.has(F.enrolled) && !this.isOpen('gate');
    if (id === 'poles') return POLES.some((p) => !this.camOff(p));
    if (id === 'towercams') return TOWER_CAMS.some((c) => !this.camOff(c));
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (id === 'enrol') {
      this.s.set(F.enrolled);
      this.openEntry('gate');
      return;
    }
    if (id === 'poles') { for (const p of POLES) this.cameras?.killOne(p); return; }
    if (id === 'towercams') { for (const c of TOWER_CAMS) this.cameras?.killOne(c); return; }
    super.onDaemon(id);
  }

  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    super.triggerAlarm(at, reason);
    if (!this.complete) this.s.set(F.loud);
    const pad = this.entry('tower').primary;
    if (pad.kind === 'keypad' && reason === pad.lockoutReason) this.taunt(EZRA.lockout.text);
    // Kade up the valley, once a minute at most
    if (this.alarmCall <= 0) {
      this.alarmCall = 60;
      this.onAlarm?.(at ?? this.b.points.gate, this.b.points.valley);
    }
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    this.alarmCall = Math.max(0, this.alarmCall - dt);
    const d = Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z);
    this.updateLamp(dt, p, d);
    // the feeds repaint every couple of seconds while anyone can see a screen
    if (d < 40 && (this.feedT -= dt) <= 0) {
      this.feedT = 2.2;
      const hour = this.ctx.atmo.hour as number;
      this.b.feeds.paint = (c, w, h) => paintFeeds(c, w, h, this.t, hour);
      this.b.feeds.repaint();
    }
    // the yard going dark
    const allDark = TOWER_CAMS.every((c) => this.camOff(c));
    if (allDark && !this.lastAllDark && this.t > 2 && this.s.set('panopticon.darkline')) this.taunt(EZRA.cams.text);
    this.lastAllDark = allDark;
    this.updatePeople(dt, p, d);
  }

  /** The lamp turns; a wedge of the valley in its beam, with a clear line to the lantern, is seen. */
  private updateLamp(dt: number, p: THREE.Vector3, d: number) {
    const b = this.b;
    this.lampYaw = ((this.t / PAN_LAMP.period) * Math.PI * 2) % (Math.PI * 2);
    b.lampPivot.rotation.y = this.lampYaw;
    if (this.complete || this.playerInside || d > PAN_LAMP.range || d < PAN.RO + 2) { this.lampSeen = Math.max(0, this.lampSeen - dt); return; }
    const dx = p.x - b.origin.x, dz = p.z - b.origin.z;
    const across = Math.abs(Math.atan2(dx * Math.cos(this.lampYaw) - dz * Math.sin(this.lampYaw), dx * Math.sin(this.lampYaw) + dz * Math.cos(this.lampYaw)));
    let lit = across < THREE.MathUtils.degToRad(PAN_LAMP.halfDeg);
    if (lit) {
      // a rock, the drum or a rise in the valley floor between you and the lantern hides you
      const from = b.points.lamp, to = p.clone().setY(p.y + 1.2), dir = to.clone().sub(from);
      const len = dir.length();
      const hit = this.ctx.physics.raycast(from, dir.normalize(), len, this.ctx.player.collider as never);
      lit = hit === null || hit > len - 0.6;
    }
    this.lampSeen = lit ? this.lampSeen + dt / PAN_LAMP.seenTime : Math.max(0, this.lampSeen - dt * 0.5);
    if (this.lampSeen < 1) return;
    this.lampSeen = 0;
    if (this.s.has(F.loop)) {
      if (this.s.set('panopticon.loopline')) this.taunt(EZRA.sweptLoop.text);
      return;
    }
    if (!this.s.set(F.swept)) return;
    this.taunt(EZRA.swept.text);
    this.ctx.audio.play('droneAlert', { pos: p });
    this.s.events.emit('toast', { text: 'The lamp found you. Ezra has called Kade up the valley.', kind: 'bad' });
    this.onAlarm?.(p.clone(), b.points.valley);
  }

  /** The people at their desks and Ezra at his wall: who turns to look, who sees you, Ada leaving. */
  private updatePeople(dt: number, p: THREE.Vector3, d: number) {
    if (!this.people.length || d > 45) return;
    const crouched = this.ctx.player.crouching;
    for (const pr of this.people) {
      const root = pr.actor.root;
      if (!root.visible) continue;
      const wp = root.getWorldPosition(_v);
      const toX = p.x - wp.x, toZ = p.z - wp.z, dist = Math.hypot(toX, toZ);
      // the angle to you from where they face (+ = their left)
      const yaw = root.rotation.y;
      let rel = Math.atan2(toX, toZ) - yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      let target = 0;
      let near = false;
      if (pr.id === 'ezra') {
        near = this.playerInside && dist < 5;
        if (near) target = THREE.MathUtils.clamp(rel, -1.3, 1.3);
      } else {
        // the reviewers face their screens, backs to the yard; now and then one glances back
        const atGlass = !!pr.at && this.playerInside && p.distanceTo(pr.at) < 4.2;
        if (pr.id === 'ada') {
          near = atGlass && p.distanceTo(pr.at!) < 2.6;
          if (atGlass) target = THREE.MathUtils.clamp(rel, -1.4, 1.4);
        } else {
          pr.nextGlance -= dt;
          if (pr.nextGlance <= 0 && pr.glance <= 0) { pr.glance = 2.2; pr.nextGlance = 7 + Math.random() * 9; }
          if (pr.glance > 0) {
            pr.glance -= dt;
            target = Math.sign(rel || 1) * 1.35;
            if (atGlass) {
              pr.seen += dt * (crouched ? 0.6 : 1.4);
              if (pr.seen >= 1) this.reviewerSaw(pr);
            }
          } else pr.seen = Math.max(0, pr.seen - dt * 0.3);
        }
      }
      pr.look += (target - pr.look) * (1 - Math.exp(-4 * dt));
      pr.actor.update(dt, near, pr.look, 0);
    }
    // Ada walks out once you're in the tower and she knows you came (her cell is empty after)
    const ada = this.person('ada');
    if (ada && ada.actor.root.visible && this.isOpen('tower') && this.s.has(F.adaMet) && this.adaLeaving < 0 && !this.s.has(F.adaFree)) {
      this.adaLeaving = 0;
      ada.actor.play('stand', true);
    }
    if (this.adaLeaving >= 0 && ada) {
      this.adaLeaving += dt;
      // (she's gone round the ring toward the passage by the time you look)
      if (this.adaLeaving > 6 && !this.canSee(ada.actor.root)) {
        this.s.set(F.adaFree);
        ada.actor.root.visible = false;
        this.adaLeaving = -1;
        this.s.events.emit('toast', { text: 'Desk 7 is empty. Ada\'s folded camp chair has gone with her.', kind: 'info' });
      }
    }
  }

  private canSee(o: THREE.Object3D) {
    const cam = this.ctx.player.position;
    return o.getWorldPosition(_v).distanceTo(cam) < 6;
  }

  private reviewerSaw(pr: Person) {
    pr.seen = 0;
    pr.glance = 0;
    const r = REVIEWERS[pr.id as 'kofi' | 'jun'];
    if (pr.id === 'jun') {
      if (this.s.set('panopticon.jun')) this.ctx.ui.subtitle(r.seen.speaker, r.seen.text, { pos: pr.at! });
      return;
    }
    if (!this.s.set(F.kofi)) return;
    this.ctx.ui.subtitle(r.seen.speaker, r.seen.text, { pos: pr.at! });
    setTimeout(() => {
      this.taunt(EZRA.kofi.text);
      this.triggerAlarm(pr.at!.clone(), 'Kofi at desk 4 told Ezra you were in the yard.');
    }, 2600);
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots, ch = b.halos.channels;
    const alarm = this.alarm > 0;
    const pulse = alarm ? Math.max(0, Math.sin(this.t * 10)) : 0;
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const st = this.ctx.state as GameContext['state'] | null;
    const done = !!st?.has(F.complete);
    for (const l of L.yard) {
      l.intensity = alarm ? 8 + pulse * 18 : 16;
      l.color.set(alarm ? 0xff3020 : 0xe6eeff);
    }
    for (const l of L.cells) l.intensity = alarm ? 2 + pulse * 3 : 5.5;
    L.room.intensity = alarm ? 5 + pulse * 8 : 6.5;
    L.room.color.set(alarm ? 0xff2a18 : 0xcfdcff);
    L.gate.intensity = this.playerInside ? 0 : nightOn * (alarm ? 6 + pulse * 10 : 7);
    S.strip.value = alarm ? 1 + pulse * 3 : 4;
    S.screens.value = 1.6 * (Math.sin(this.t * 1.3) > -0.96 ? 1 : 0.7);
    S.desk.value = 1 + nightOn * 2.5;
    S.gate.value = st?.has(F.gate) ? 0.6 : 2.5 + (Math.sin(this.t * 2) > 0.6 ? 1.5 : 0);
    S.keypad.value = st?.has(F.tower) ? 0.4 : 2 + (alarm ? pulse * 4 : 0);
    S.lampCore.value = done ? 1.5 : 7 + Math.sin(this.t * 3) * 0.6;
    S.beacon.value = alarm ? 6 + pulse * 6 : 0;
    const blink = (this.t % 1.6) < 0.5;
    S.aviation.value = blink ? 6 : 0.3;
    for (const bc of b.beacons) {
      bc.visible = alarm;
      if (alarm) bc.rotation.y += dt * 5;
    }
    // the beam: faint by day, a real blade at night; it stops once the tower is busted
    b.lampBeam.mesh.visible = !done && !NOLAMP;
    b.lampBeam.intensity.value = (0.18 + nightOn * 0.55) * (alarm ? 1.3 : 1);
    ch[CH.ON] = 1;
    ch[CH.NIGHT] = 0.05 + nightOn * 0.95;
    ch[CH.BLINK] = blink ? 1 : 0.05;
    ch[CH.ALARM] = alarm ? 0.3 + pulse : 0;
    ch[CH.LAMP] = done ? 0.15 : 0.5 + nightOn * 0.5;
  }

  /** Respawn point just down the valley from the apron. */
  get outsidePoint() {
    return this.b.points.outside.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    if (this.complete) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 110;
    if (!near) return '';
    const s = this.s;
    if (this.isOpen('tower')) {
      if (!s.has(F.archive)) return 'Ezra is at his monitor wall. The archive is in the rack behind him; the cistern is under the hatch.';
      return 'Open the cistern hatch, the locker and the archive shelf. The water matters most.';
    }
    if (this.playerInside) {
      const dark = TOWER_CAMS.filter((c) => this.camOff(c)).length;
      if (dark < 4 && s.has(F.chain)) return `Cut the tower cameras in order: 1 (its box is on the tower), then 2, 3, 4. ${dark} of 4 dark.`;
      if (dark < 4) return 'Four cameras on the tower, each watching another one\'s junction box. Ada, at desk 7, knows the order.';
      return s.has(F.code) ? 'The tower door, on its west side. The code is 2212.' : 'The tower door, on its west side: a keypad (Ada knows the code), SPLICE (Electronics 4), or a big charge.';
    }
    if (this.isOpen('gate')) return 'The gate is open. Through the passage into the yard. Mind the camera on the tower facing you.';
    const loop = s.has(F.loop) ? ' The lamp still files you as nobody.' : ' Keep out of the lamp\'s beam.';
    return `The face gate only opens for staff: SPLICE yourself onto the list, short the motor, blow the rails, or talk to Ezra at the gate.${loop}`;
  }
}

const _v = new THREE.Vector3();
