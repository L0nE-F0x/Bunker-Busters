import * as THREE from 'three/webgpu';

/**
 * Every ladder you can climb. The builder that draws a ladder registers it here (world space), and
 * the player's Traversal (player/Traversal.ts) does the rest: walk into one facing it (or press Use)
 * to grab on, forward/back climbs, jump lets go, the top steps you off onto `exit`.
 *
 * A ladder is the line its rungs run along: `base` is the middle of the rungs at the foot (y = the
 * ground there) and `top` the middle of the rungs where the landing is (y = the landing's floor).
 * The two can differ in x/z: a leaning ladder. `out` points from the rungs toward the climber.
 */
export interface Ladder {
  id: string;
  base: THREE.Vector3;
  top: THREE.Vector3;
  /** Horizontal unit normal from the rungs toward where you stand to climb. */
  out: THREE.Vector3;
  /** Half the rungs' width (m). */
  half: number;
  /** Height of the first rung above `base.y`, and the rung spacing (m). */
  first: number;
  pitch: number;
  /** How many rungs (the last is the highest below the landing). */
  count: number;
  /** Height of the rails' top above `base.y` (the hand holds above the last rung). */
  rail: number;
  /** Where your feet go when you step off at the top. Null: nowhere to go, you climb back down. */
  exit: THREE.Vector3 | null;
  /** The ladder can't be used right now (a quest, a fence). */
  usable?: () => boolean;
}

export interface LadderDef {
  id: string;
  base: THREE.Vector3;
  top: THREE.Vector3;
  out: THREE.Vector3;
  half?: number;
  first?: number;
  pitch?: number;
  count?: number;
  rail?: number;
  exit?: THREE.Vector3 | null;
  usable?: () => boolean;
}

class LadderRegistry {
  readonly list: Ladder[] = [];

  add(d: LadderDef): Ladder {
    const out = d.out.clone().setY(0).normalize();
    const span = d.top.y - d.base.y;
    const first = d.first ?? 0.35, pitch = d.pitch ?? 0.32;
    const l: Ladder = {
      id: d.id, base: d.base.clone(), top: d.top.clone(), out,
      half: d.half ?? 0.25, first, pitch,
      count: d.count ?? Math.max(1, Math.floor((span - first) / pitch) + 1),
      rail: d.rail ?? span + 0.9,
      exit: d.exit ? d.exit.clone() : null, usable: d.usable,
    };
    this.list.push(l);
    return l;
  }

  clear() {
    this.list.length = 0;
  }
}

export const ladders = new LadderRegistry();

/** The rung line's point at `h` metres above the base (leaning ladders slide along x/z). */
export function ladderAt(l: Ladder, h: number, out: THREE.Vector3) {
  const span = Math.max(0.01, l.top.y - l.base.y);
  const t = h / span;
  return out.set(l.base.x + (l.top.x - l.base.x) * t, l.base.y + h, l.base.z + (l.top.z - l.base.z) * t);
}

/** The yaw that faces the ladder (forward = −out: (−sin yaw, 0, −cos yaw) = −out). */
export const ladderYaw = (l: Ladder) => Math.atan2(l.out.x, l.out.z);

/**
 * A ladder built in a site's local frame `m` (a Frame's matrix, or any placement): `base`/`top`/`exit`
 * in local metres, `out` a local direction. Returns the world-space def for `ladders.add`.
 */
export function localLadder(m: THREE.Matrix4, id: string, base: [number, number, number], top: [number, number, number], out: [number, number], exit: [number, number, number] | null, o: Partial<LadderDef> = {}): LadderDef {
  const p = (v: [number, number, number]) => new THREE.Vector3(...v).applyMatrix4(m);
  const n = new THREE.Vector3(out[0], 0, out[1]).transformDirection(m).setY(0).normalize();
  return { id, base: p(base), top: p(top), out: n, exit: exit ? p(exit) : null, ...o };
}

/**
 * Places a mantle may never start or end (a bunker's laser stairwell, a road watched by IR beams):
 * oriented boxes, world space. Bunker builders add theirs; Traversal checks both ends of a mantle.
 */
class NoMantle {
  private zones: { x: number; y: number; z: number; hx: number; hy: number; hz: number; c: number; s: number }[] = [];
  add(center: THREE.Vector3, half: { x: number; y: number; z: number }, yaw = 0) {
    this.zones.push({ x: center.x, y: center.y, z: center.z, hx: half.x, hy: half.y, hz: half.z, c: Math.cos(yaw), s: Math.sin(yaw) });
  }
  has(p: { x: number; y: number; z: number }) {
    for (const zn of this.zones) {
      const dx = p.x - zn.x, dz = p.z - zn.z;
      // into the box's frame (a yaw turns local x toward (cos, 0, -sin))
      const lx = dx * zn.c - dz * zn.s, lz = dx * zn.s + dz * zn.c;
      if (Math.abs(lx) <= zn.hx && Math.abs(lz) <= zn.hz && Math.abs(p.y - zn.y) <= zn.hy) return true;
    }
    return false;
  }
}
export const noMantle = new NoMantle();
