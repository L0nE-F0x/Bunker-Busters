import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { ApexBuilder, APEX_GROUNDS } from './ApexBuilder';
import { APEX, APEX_FLAGS as F, VESPER, VESPER_TALK, VESPER_POSTS, type VesperView } from '@/content/bunkers/apex';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { GameContext } from '../../context';

const CH = ApexBuilder.CH;
/** Launch hour (game time): the clock over the airlock counts down to it, and the code is the clock. */
const LAUNCH_HOUR = 5;

/**
 * Tier 2, Apex Vault: Vesper Kade's launch site (Act II). Locks, cameras, lasers and loot are data
 * (content/bunkers/apex.ts) run by the bunker runtime. What's hers is here:
 * - the intercom by the hangar door (a demo for a fan, the ledger, Theo, the code as a feature request);
 * - the launch clock: the airlock's code is the T-minus on it (hours and minutes), so it changes as
 *   you watch. The keypad reads the clock when you start typing;
 * - her feed over the hangar door: a post for every breach (and a toast as she posts it);
 * - her reactions to the lasers and cameras going down, the lights, the alarm.
 * `onAlarm` (set by Game) calls Kade's Apex Gatehouse crew to the apron.
 */
export class Apex extends Bunker<ApexBuilder> {
  private post = -1;
  private clockKey = '';
  private lastLasersOff = false;

  constructor(ctx: GameContext) {
    super(ctx, APEX, (origin) => new ApexBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    this.b.feed.paint = (c, w, h) => this.paintFeed(c, w, h);
    this.b.clock.paint = (c, w, h) => this.paintClock(c, w, h);
    this.b.feed.repaint();
    this.b.clock.repaint();
    this.init();
  }

  get hangarBox() {
    return this.b.hangarBox;
  }

  /** Respawn point just off the apron, on her road. */
  get outsidePoint() {
    return this.b.w(4, 0, APEX_GROUNDS.z1 + 8);
  }

  // ------------------------------------------------------------------ the launch clock
  /** Hours and minutes to launch, as the clock shows them. */
  clockDigits(): string {
    const hour = this.ctx.atmo.hour as number;
    let left = (LAUNCH_HOUR - hour + 24) % 24;
    if (left < 1 / 60) left += 24;
    const hh = Math.floor(left), mm = Math.floor((left - hh) * 60);
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  }

  private paintClock(c: CanvasRenderingContext2D, w: number, h: number) {
    const d = this.state ? this.clockDigits() : '0500';
    c.fillStyle = '#050505';
    c.fillRect(0, 0, w, h);
    c.font = '600 13px "JetBrains Mono", monospace';
    c.fillStyle = '#ff9a3a';
    c.textAlign = 'left';
    c.fillText('LAUNCH', 10, 22);
    c.fillText('T-MINUS', 10, 42);
    c.font = '700 46px "JetBrains Mono", monospace';
    c.fillStyle = '#ff3a1a';
    c.textAlign = 'right';
    c.fillText(`${d.slice(0, 2)}:${d.slice(2)}`, w - 10, 52);
  }

  /** The keypad takes whatever the clock says when you start typing. */
  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    if (e.id === 'airlock' && m.kind === 'keypad') return super.runMethod(e, { ...m, code: this.clockDigits() });
    return super.runMethod(e, m);
  }

  // ------------------------------------------------------------------ her feed
  private currentPost() {
    const st = this.ctx.state as GameContext['state'] | null;
    return VESPER_POSTS.findIndex((p) => !p.when || !!st?.has(p.when));
  }

  private paintFeed(c: CanvasRenderingContext2D, w: number, h: number) {
    const p = VESPER_POSTS[Math.max(0, this.post)];
    c.fillStyle = '#0a0b0e';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16181d';
    c.fillRect(16, 16, w - 32, h - 32);
    // avatar, handle, the live badge
    const g = c.createLinearGradient(40, 40, 120, 120);
    g.addColorStop(0, '#f2f2ff');
    g.addColorStop(1, '#7a86a8');
    c.fillStyle = g;
    c.beginPath(); c.arc(80, 82, 40, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#16181d';
    c.font = '900 44px "Big Shoulders Stencil Display", Impact, sans-serif';
    c.textAlign = 'center';
    c.fillText('V', 80, 98);
    c.textAlign = 'left';
    c.font = '700 34px "Chakra Petch", Arial, sans-serif';
    c.fillStyle = '#f2f2ff';
    c.fillText('Vesper Kade', 140, 70);
    c.font = '500 24px "JetBrains Mono", monospace';
    c.fillStyle = '#8a90a0';
    c.fillText('@vesper · now', 140, 104);
    c.fillStyle = '#e0241a';
    c.fillRect(w - 150, 44, 104, 40);
    c.fillStyle = '#ffffff';
    c.font = '700 26px "Chakra Petch", Arial, sans-serif';
    c.fillText('● LIVE', w - 140, 73);
    // the post, wrapped
    c.font = '600 36px "Chakra Petch", Arial, sans-serif';
    c.fillStyle = '#f2f2ff';
    const words = p.text.split(' ');
    let line = '', y = 170;
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (c.measureText(t).width > w - 100 && line) { c.fillText(line, 44, y); line = word; y += 44; } else line = t;
    }
    c.fillText(line, 44, y);
    c.font = '500 24px "JetBrains Mono", monospace';
    c.fillStyle = '#ff5a7a';
    c.fillText(`♥ ${p.likes}`, 44, h - 36);
    c.fillStyle = '#8a90a0';
    c.fillText('↻ reposted by 41 bots', 260, h - 36);
  }

  // ------------------------------------------------------------------ Vesper on the intercom
  private view(): VesperView {
    return {
      social: this.s.skill('social') + (this.s.archetype.perk === 'insider' ? 1 : 0),
      has: (f) => this.s.has(f),
      theo: this.s.archetype.id === 'defector',
    };
  }

  protected override talk() {
    return this.ctx.ui.converse({
      start: this.complete ? 'after' : 'hello',
      node: (id) => {
        const node = VESPER_TALK[id];
        if (!node) return null;
        const v = this.view();
        return {
          speaker: node.speaker,
          text: node.text,
          choices: node.choices.filter((c) => !c.when || c.when(v)).map((c) => ({ id: c.id, label: c.label, next: c.next ?? '', disabled: c.need?.(v) })),
        };
      },
      onChoice: (nodeId, choiceId) => {
        const choice = VESPER_TALK[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choiceId === 'theo') this.s.set('apex.talk.theo');
        if (choice?.effect === 'code' && this.s.set(F.code)) {
          this.s.addXP(40, 'She told you how the code works');
          this.s.events.emit('toast', { text: 'The airlock code is the launch clock over the door: hours and minutes.', kind: 'good' });
        }
        if (choice?.effect === 'demo' && !this.isOpen('hangar')) {
          this.s.set(F.demo);
          this.s.addXP(50, 'Talked your way into the hangar');
          this.openEntry('hangar', { line: null });
        }
      },
    });
  }

  // ------------------------------------------------------------------ SPLICE
  protected override onDaemon(id: string) {
    super.onDaemon(id);
    if (id === 'cameras') this.taunt(VESPER.cameras.text);
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(_dt: number, p: THREE.Vector3) {
    const near = p.distanceTo(this.b.origin) < 120;
    // an Infiltrator reads a building by its vents: the duct on the hill's east side is on their map
    if (near && this.s.archetype.id === 'infiltrator' && this.s.set(F.vent)) {
      this.s.events.emit('toast', { text: 'You clock a vent on the east side of the hill, under the solar. Ducts like that go somewhere.', kind: 'info' });
    }
    // the feed: a new post for each breach (and she posts it out loud, more or less)
    const post = this.currentPost();
    if (post !== this.post) {
      const first = this.post < 0;
      this.post = post;
      this.b.feed.repaint();
      if (!first && near) this.s.events.emit('toast', { text: `@vesper: "${VESPER_POSTS[post].text}"  ♥ ${VESPER_POSTS[post].likes}`, kind: 'info' });
    }
    // the clock repaints once a game minute, only while you can read it
    if (near) {
      const key = this.clockDigits();
      if (key !== this.clockKey) { this.clockKey = key; this.b.clock.repaint(); }
    }
    // her reactions to the lasers and cameras going down (however it happened)
    const lasersOff = !!this.lasers?.off;
    if (lasersOff && !this.lastLasersOff && this.t > 2) this.taunt(VESPER.lasers.text);
    this.lastLasersOff = lasersOff;
  }

  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    super.triggerAlarm(at, reason);
    this.onAlarm?.(at ?? this.b.points.airlock);
  }

  /** Game hooks the gatehouse crew in here. */
  onAlarm: ((at: THREE.Vector3) => void) | null = null;

  protected override updateLights(dt: number, night: number) {
    const b = this.b, L = b.lights, ch = b.halos.channels, S = b.slots;
    const alarm = this.alarm > 0;
    const pulse = alarm ? Math.max(0, Math.sin(this.t * 10)) : 0;
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const flick = Math.sin(this.t * 29) > 0.985 ? 0.5 : 1;
    // the hangar's high bays are always on (it's dark under the arch); the apron flood and the
    // stand's uplight come on at night. In an alarm everything inside goes red and pulses.
    for (const l of L.hangar) {
      l.intensity = alarm ? 16 + pulse * 28 : 26 * flick;
      l.color.set(alarm ? 0xff3020 : 0xffe8c8);
    }
    L.hall.intensity = alarm ? 9 + pulse * 14 : 12;
    L.hall.color.set(alarm ? 0xff2a18 : 0xd8ecff);
    L.room.intensity = alarm ? 11 + pulse * 16 : 18;
    L.room.color.set(alarm ? 0xff2a18 : 0xbfe8ff);
    L.flood.intensity = nightOn * (alarm ? 40 + pulse * 60 : 70);
    L.flood.color.set(alarm ? 0xff6050 : 0xfff1d0);
    L.rocket.intensity = nightOn * 90;
    S.strip.value = (alarm ? 1.5 : 5) * flick;
    S.hallStrip.value = alarm ? 0.8 + pulse * 3 : 4;
    S.roomStrip.value = alarm ? 0.8 + pulse * 3 : 4.5;
    S.flood.value = 0.3 + nightOn * 9;
    S.beacon.value = alarm ? 6 + pulse * 6 : 0;
    const blink = (this.t % 1.6) < 0.5;
    S.aviation.value = blink ? 6 : 0.3;
    S.screens.value = 1.8 * (Math.sin(this.t * 1.7) > -0.95 ? 1 : 0.6);
    const st = this.ctx.state as GameContext['state'] | null; // null on the title screen
    S.keypad.value = st?.has(F.airlock) ? 0.4 : 2 + (alarm ? pulse * 4 : 0);
    b.feed.glow.value = 1.4 + nightOn * 0.6;
    b.clock.glow.value = 1.6 + nightOn * 0.8;
    for (const bc of b.beacons) {
      bc.visible = alarm;
      if (alarm) bc.rotation.y += dt * 5;
    }
    ch[CH.ON] = 1;
    ch[CH.NIGHT] = 0.05 + nightOn * 0.95;
    ch[CH.BLINK] = blink ? 1 : 0.05;
    ch[CH.ALARM] = alarm ? 0.3 + pulse : 0;
    ch[CH.LASER] = this.lasers && !st?.has(F.lasers) ? 1 : 0;
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    if (this.complete) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 80;
    if (!near) return '';
    const s = this.s;
    if (this.isOpen('vault')) return 'The Cistern Room. Open the tap and the two lockers. The water is the point.';
    if (this.playerInside) {
      if (this.lasers && !this.lasers.off) return 'Three beams in the launch corridor: jump the low ones, crouch the high one, or kill the breaker by the door.';
      return 'The vault door at the end of the corridor. Six pins, or a big charge (Demolition 5).';
    }
    if (this.isOpen('airlock')) return 'The airlock is open. Into the launch corridor.';
    if (this.isOpen('hangar')) {
      if (s.has(F.code)) return 'The airlock code is the launch clock over the door, hours and minutes. Read it, then type.';
      return `The airlock at the back of the hangar: a keypad that "counts down", or SPLICE it (Electronics 3). Her cameras sweep the floor.${s.has(F.vent) ? ' The vent outside skips it.' : ''}`;
    }
    const vent = s.has(F.vent) ? ' Or the vent on the hill\'s east side.' : '';
    return `The hangar door: pick it, short its controller, blow it, or buzz Vesper on the intercom.${vent} The camera over the door sweeps the apron.`;
  }
}
