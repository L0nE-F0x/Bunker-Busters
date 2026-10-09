import * as THREE from 'three/webgpu';
import { TOWN_BARKS, type BarkKind, type TownBark } from '@/content/townBarks';
import type { NpcCrowd } from '@/game/world/npc';

/**
 * Townsfolk talk to you in passing: a short voiced line when you walk up to one of them from
 * further off (by day, by night, or with a gun out), a remark when gunfire carries in from the
 * desert, and an earful when you fire near them. Heads snap round to any shot.
 *
 * Lines live in src/content/townBarks.ts. The game supplies the host (Game.ts); without one the
 * town stays quiet.
 */
export interface BarkHost {
  /** A conversation, a minigame or a menu is up: hold your tongue. */
  quiet(): boolean;
  /** Someone else's subtitle is still up: wait for it. */
  talking(): boolean;
  /** The player has a gun out. */
  armed(): boolean;
  night(): boolean;
  /** A story flag (lines that react to what you've done). */
  has?(flag: string): boolean;
  /** Clear line from a head to the player's eye (walls swallow greetings). */
  see(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** Say it: a positional voice and a subtitle. */
  say(speaker: string, text: string, pos: THREE.Vector3): void;
}

interface Person {
  id: string;
  pos: THREE.Vector3;
  lines: TownBark[];
  /** Per kind: how many lines of it have been said (they cycle from a random start). */
  said: Partial<Record<BarkKind, number>>;
  start: number;
  /** No greeting before this (s). */
  hello: number;
  /** No reaction to gunfire before this (s). */
  shots: number;
  /** The player has been well away since the last greeting (greetings fire on approach only). */
  away: boolean;
}

const HELLO_R = 5.6;
const AWAY_R = 9;
/** How far a bark carries to be worth a subtitle. */
const HEAR_R = 22;

export class TownBarks {
  host: BarkHost | null = null;
  private people: Person[] | null = null;
  private t = 0;
  private scan = 0;
  /** No two barks closer than this (s). */
  private gap = 0;
  private pending: { at: number; p: Person; kind: BarkKind } | null = null;
  private eye = new THREE.Vector3();
  /** Every figure's head per crowd (world), for who hears a shot. */
  private heads: THREE.Vector3[][] = [];

  constructor(private crowds: NpcCrowd[]) {}

  private build() {
    const out: Person[] = [];
    for (const c of this.crowds) {
      const hs = c.heads();
      this.heads.push(hs.map((h) => h.pos));
      for (const h of hs) {
        const lines = TOWN_BARKS[h.id];
        if (!lines) continue;
        out.push({ id: h.id, pos: h.pos, lines, said: {}, start: Math.floor(Math.random() * 8), hello: 0, shots: 0, away: true });
      }
    }
    return out;
  }

  private line(p: Person, kind: BarkKind) {
    // lines about what you've done (content/townBarks.ts `when`) take every other turn while they apply
    const has = this.host?.has?.bind(this.host);
    const news = has ? p.lines.filter((l) => l.kind === kind && l.when && l.when(has)) : [];
    const of = p.lines.filter((l) => l.kind === kind && !l.when);
    const n = p.said[kind] ?? 0;
    p.said[kind] = n + 1;
    if (news.length && (n % 2 === 0 || !of.length)) return news[(p.start + (n >> 1)) % news.length];
    if (!of.length) return null;
    return of[(p.start + n) % of.length];
  }

  private speak(p: Person, kind: BarkKind) {
    const l = this.line(p, kind);
    if (!l || !this.host) return;
    this.host.say(l.speaker, l.text, p.pos);
    this.gap = this.t + (kind === 'close' ? 5 : 12);
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const host = this.host;
    if (!host) return;
    this.people ??= this.build();
    this.eye.copy(cam);
    const pend = this.pending;
    if (pend && this.t >= pend.at) {
      this.pending = null;
      // a reaction that comes too late (a card opened meanwhile) is dropped, not queued
      if (!host.quiet() && !host.talking() && this.t - pend.at < 2) this.speak(pend.p, pend.kind);
    }
    if ((this.scan -= dt) > 0) return;
    this.scan = 0.25;
    for (const p of this.people) {
      const d = p.pos.distanceTo(cam);
      if (d > AWAY_R) { p.away = true; continue; }
      if (d > HELLO_R || !p.away) continue;
      // in a conversation with them (or anyone), or greeted lately: this approach doesn't count
      if (host.quiet() || this.t < p.hello) { p.away = false; continue; }
      // someone else is talking, or a wall is in the way: keep trying while you're close
      if (this.t < this.gap || this.pending || host.talking() || !host.see(p.pos, cam)) continue;
      p.away = false;
      p.hello = this.t + 90 + Math.random() * 60;
      // (most people walk round with the revolver out: not every greeting is about it)
      this.speak(p, host.armed() && Math.random() < 0.55 ? 'armed' : host.night() && Math.random() < 0.6 ? 'night' : 'hello');
    }
  }

  /**
   * Something loud at `pos` (Combat's noise). Every crowd within earshot looks; the nearest
   * person the player can hear says something about it a beat later.
   */
  hear(pos: THREE.Vector3, kind: string, player: THREE.Vector3) {
    if (kind !== 'gunshot' && kind !== 'explosion') return;
    this.people ??= this.build();
    const mine = pos.distanceTo(player) < 2.5;
    this.crowds.forEach((c, i) => {
      if (this.heads[i].some((h) => h.distanceTo(pos) < 160)) c.startle(pos, mine ? 4 : 2.5);
    });
    if (!this.host || this.pending || this.t < this.gap) return;
    let best: Person | null = null, bd = HEAR_R;
    for (const p of this.people) {
      const d = p.pos.distanceTo(this.eye);
      if (d < bd && this.t >= p.shots) { best = p; bd = d; }
    }
    if (!best) return;
    const near = mine && best.pos.distanceTo(pos) < 40;
    best.shots = this.t + (near ? 18 : 50);
    this.pending = { at: this.t + 0.6 + Math.random() * 0.6, p: best, kind: near ? 'close' : 'shots' };
  }
}
