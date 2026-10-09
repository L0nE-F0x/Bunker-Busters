import * as THREE from 'three/webgpu';
import { LANDMARKS } from '@/content/world';
import { OUTPOSTS } from '@/content/recovery';
import type { Heightfield } from './world/Heightfield';
import type { Physics } from '@/engine/physics';
import type { GameState } from './State';
import { distText, type TravelOption } from '@/ui/WorldMap';

/**
 * Fast travel between the safe places you've found (spec: "fast-travel to discovered camps").
 * It isn't free: the clock moves on by the time the walk would take, food and water drain the same
 * way they would have, and the world's restock timers tick. Not while something is hunting you,
 * an alarm is going, you're inside a bunker, or venom is in you. The arrival is searched for: open,
 * walkable ground (no roof, no prop, room to stand), clear of Kade's pads and of anything alive and
 * hostile, facing the place.
 */

/** Every camp, plus the towns that'll have you. */
const SAFE = new Set(['gas', 'creek', 'cave']);
export const TRAVEL_PLACES = LANDMARKS.filter((l) => l.camp || SAFE.has(l.id));

/** Hand-placed arrivals where the ring search would land somewhere odd: [x, z, look-at x, look-at z]. */
const ARRIVAL: Record<string, [number, number, number, number]> = {
  // on the trail just below the mouth, looking up at it
  cave: [46, 320, 48, 352],
};

const JOG = 3.4; // m/s: the jog the clock is charged for (Player's base speed)
const WINDING = 1.3; // nobody walks a straight line out here
const CLIMB = 6; // metres of walking per metre climbed

export interface TravelCard { from: string; to: string; walked: string; arrive: string; cost: string; blurb: string }

export interface TravelHost {
  state: GameState;
  hf: Heightfield;
  physics: Physics;
  /** The player's feet. */
  pos(): THREE.Vector3;
  /** The player's current speed multiplier (hunger, thirst, a heavy pack). */
  speedMult(): number;
  /** Real minutes per in-game day. */
  dayMinutes(): number;
  hour(): number;
  /** Why travel is off right now, or null. */
  why(): string | null;
  hostileNear(x: number, z: number, r: number): boolean;
  /** Freeze the player and fade to black. */
  begin(): void;
  /** Under the black: put the player down, move the clock on. */
  place(p: THREE.Vector3, yaw: number, hours: number): void;
  card(c: TravelCard): () => void;
  /** Fade back in, unfreeze, save. */
  end(): void;
  toast(text: string): void;
}

export function hoursText(h: number) {
  const m = Math.max(1, Math.round(h * 60));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
export function clockText(h: number) {
  const m = Math.floor((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FastTravel {
  busy = false;

  constructor(private h: TravelHost) {}

  private found(id: string) {
    return id === 'gas' || this.h.state.has(`seen:${id}`);
  }

  /** Walking cost from where you stand: metres on the ground, real seconds, in-game hours. */
  cost(x: number, z: number) {
    const p = this.h.pos(), hf = this.h.hf;
    const flat = Math.hypot(x - p.x, z - p.z);
    const climb = Math.max(0, hf.heightAt(x, z) - hf.heightAt(p.x, p.z));
    const seconds = (flat * WINDING + climb * CLIMB) / (JOG * Math.max(0.4, this.h.speedMult()));
    return { flat, seconds, hours: (seconds * 24) / (this.h.dayMinutes() * 60) };
  }

  options(): TravelOption[] {
    return TRAVEL_PLACES.map((l) => {
      const [x, , z] = l.position;
      const c = this.cost(x, z);
      const here = c.flat < 50;
      const found = this.found(l.id);
      return {
        id: l.id, name: l.name, x, z, here,
        detail: `${distText(c.flat)} · ${hoursText(c.hours)}`,
        blocked: !found ? 'Not found yet. Walk there once.' : here ? 'You are here.' : null,
      };
    });
  }

  /** Open, walkable ground near the place, on the side you're coming from, facing it. */
  arrival(id: string): { p: THREE.Vector3; yaw: number } | null {
    const l = LANDMARKS.find((x) => x.id === id);
    if (!l) return null;
    const [lx, , lz] = l.position;
    const from = this.h.pos();
    const fixed = ARRIVAL[id];
    const cands: [number, number, number, number][] = [];
    if (fixed) cands.push(fixed);
    const a0 = Math.atan2(from.z - lz, from.x - lx);
    for (const r of [30, 22, 38, 16, 46, 56]) {
      for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
        cands.push([lx + Math.cos(a0 + da) * r, lz + Math.sin(a0 + da) * r, lx, lz]);
      }
    }
    for (const [x, z, tx, tz] of cands) {
      if (!this.clear(x, z) || this.h.hostileNear(x, z, 45)) continue;
      // the camera's forward is (-sin yaw, -cos yaw)
      const yaw = Math.atan2(-(tx - x), -(tz - z));
      return { p: new THREE.Vector3(x, this.h.hf.heightAt(x, z) + 0.2, z), yaw };
    }
    return null;
  }

  /** Room to stand: inside the playable square, gentle slope, nothing but terrain under the sky, no collider in a body-sized capsule. */
  clear(x: number, z: number) {
    const hf = this.h.hf;
    const lim = hf.size * 0.39;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (hf.normalAt(x, z).y < 0.94) return false;
    for (const op of OUTPOSTS) if (Math.hypot(op.x - x, op.z - z) < op.r + 40) return false;
    const g = hf.heightAt(x, z);
    const { R, world } = this.h.physics;
    const flags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    // straight down from 30 m up: the first thing hit must be the ground (not a roof, a wreck, a rock)
    for (const [ox, oz] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
      const hit = world.castRay(new R.Ray({ x: x + ox, y: g + 30, z: z + oz }, { x: 0, y: -1, z: 0 }), 45, true, flags);
      if (!hit) return false;
      if (Math.abs(g + 30 - hit.timeOfImpact - hf.heightAt(x + ox, z + oz)) > 0.4) return false;
    }
    // a standing body's worth of capsule, a hand off the ground, touches nothing
    const hit = world.intersectionWithShape({ x, y: g + 0.3 + 0.45 + 0.6, z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Capsule(0.6, 0.5), flags);
    return !hit;
  }

  async go(id: string) {
    if (this.busy) return;
    const why = this.h.why();
    if (why) { this.h.toast(why); return; }
    const opt = this.options().find((o) => o.id === id);
    const l = LANDMARKS.find((x) => x.id === id);
    if (!opt || !l || opt.blocked) return;
    const arr = this.arrival(id);
    if (!arr) { this.h.toast(`No safe way into ${l.name} right now. Something is in the way.`); return; }
    const from = this.h.pos();
    const near = LANDMARKS.map((m) => ({ m, d: Math.hypot(m.position[0] - from.x, m.position[2] - from.z) })).sort((a, b) => a.d - b.d)[0];
    const fromName = near && near.d < 90 ? near.m.name : 'Open desert';
    const c = this.cost(arr.p.x, arr.p.z);
    const s = this.h.state;
    this.busy = true;
    this.h.begin();
    await wait(650);
    // the walk, all at once: water and food go the way they would have; it can hurt, it won't kill
    const t0 = s.data.thirst, f0 = s.data.hunger, hp0 = s.data.health;
    s.tickNeeds(c.seconds);
    if (s.data.health < Math.min(hp0, 5)) s.data.health = Math.min(hp0, 5);
    s.data.stats.playTime += c.seconds;
    const arrive = this.h.hour() + c.hours;
    this.h.place(arr.p, arr.yaw, c.hours);
    const dw = Math.round(t0 - s.data.thirst), df = Math.round(f0 - s.data.hunger), dh = Math.round(hp0 - s.data.health);
    const hide = this.h.card({
      from: fromName, to: l.name, walked: hoursText(c.hours), arrive: clockText(arrive),
      cost: [`Water −${dw}`, `Food −${df}`, dh > 0 ? `${dh} hp` : ''].filter(Boolean).join(' · '),
      blurb: l.blurb,
    });
    await wait(2700);
    hide();
    await wait(450);
    this.h.end();
    this.busy = false;
  }
}
