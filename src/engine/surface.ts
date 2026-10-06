import type { Physics } from './physics';
import type { Heightfield } from '@/game/world/Heightfield';
import { distToPolyline } from '@/game/world/Heightfield';
import { LANDMARKS, CAVE_TRAIL } from '@/content/world';
import { GARAGE } from '@/content/bunkers/garage';

/**
 * What the player is standing on, and how enclosed the space around their head is. Both come
 * from a few Rapier rays (read-only queries on the shared world), so they cost next to nothing.
 *
 * Footsteps: one ray down from the feet. The terrain heightfield is sand, except the highway
 * (asphalt), the dirt tracks and the ridge wash (gravel) and steep ground (rock). Any other
 * collider is a hard floor: an explicit tag (`surfaces.tag`), else a box zone (`surfaces.zone`),
 * else the landmark it belongs to (table below), else a guess from its shape (balls are boulders,
 * cylinders dead trees and posts, loose boxes car wrecks).
 *
 * Building floors here are mostly visual slabs on the terrain, so terrain under an enclosed player
 * is the building's floor (the landmark's interior kind), and two known outdoor slabs are zones.
 *
 * Rooms: one ray up, then a fan of 12 rays sideways at 2.6 m above the feet, half of them every
 * 0.15 s. Most roofs in this world are visual only (no collider), so walls do the work: close hits
 * all round = a room. At 2.6 m the fan clears pumps, crates, cars and low fences, and passes over
 * 2.15 m door openings (the lintel closes the room); under a lower real ceiling it drops beneath it.
 */

export type Surface = 'sand' | 'gravel' | 'rock' | 'asphalt' | 'concrete' | 'wood' | 'metal';

type Collider = ReturnType<Physics['world']['createCollider']>;
interface V3 { x: number; y: number; z: number }

interface Zone { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; kind: Surface }

/**
 * Registry for places that know their floors. Sites can call `surfaces.zone(min, max, 'metal')`
 * for a box (world space) or `surfaces.tag(collider, 'wood')` for one collider.
 */
export class SurfaceRegistry {
  private tags = new Map<number, Surface>();
  private zones: Zone[] = [];

  tag(collider: Collider, kind: Surface) {
    this.tags.set(collider.handle, kind);
  }

  zone(min: V3, max: V3, kind: Surface) {
    this.zones.push({
      x0: Math.min(min.x, max.x), y0: Math.min(min.y, max.y), z0: Math.min(min.z, max.z),
      x1: Math.max(min.x, max.x), y1: Math.max(min.y, max.y), z1: Math.max(min.z, max.z), kind,
    });
  }

  /** @internal */
  lookup(collider: Collider | null, p: V3): Surface | null {
    const t = collider && this.tags.get(collider.handle);
    if (t) return t;
    // later zones win (a room inside a yard)
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1 && p.z >= z.z0 && p.z <= z.z1) return z.kind;
    }
    return null;
  }
}

export const surfaces = new SurfaceRegistry();

/**
 * Floors by landmark: radius (m) around its position. `kind` for any non-terrain collider there,
 * `inside` for the terrain under a player who is indoors there. Ids from LANDMARKS.
 */
const LANDMARK_FLOORS: Record<string, { r: number; kind: Surface; inside: Surface }> = {
  gas: { r: 32, kind: 'concrete', inside: 'concrete' },
  spire: { r: 18, kind: 'metal', inside: 'wood' },
  creek: { r: 46, kind: 'wood', inside: 'wood' },
  cave: { r: 18, kind: 'rock', inside: 'rock' },
  jet: { r: 30, kind: 'metal', inside: 'metal' },
  drivein: { r: 40, kind: 'concrete', inside: 'concrete' },
  datacenter: { r: 42, kind: 'concrete', inside: 'concrete' },
  tube: { r: 26, kind: 'metal', inside: 'metal' },
};

const SOFT: ReadonlySet<Surface> = new Set(['sand', 'gravel']);
export const isSoft = (s: Surface) => SOFT.has(s);

/** How much a floor reflects (wood and sand soak a little up). */
export const HARDNESS: Record<Surface, number> = { sand: 0.4, gravel: 0.6, rock: 1, asphalt: 0.9, concrete: 1, wood: 0.7, metal: 1 };

export interface Room {
  /** 0 open air … 1 a closed room. */
  enclosure: number;
  /** Mean distance to the walls (m), for picking a small or a large reverb. */
  size: number;
}

const H_RAYS = 12;
const H_MAX = 24;
const UP_MAX = 25;
const FAN_Y = 2.6; // above the feet: over pumps and door lintels, under most roofs
const ROOM_EVERY = 0.15; // half the fan each time: a full sweep every 0.3 s
const INSIDE = 0.6;

export class Acoustics {
  readonly room: Room = { enclosure: 0, size: H_MAX };
  /** The last floor under the feet. */
  surface: Surface = 'sand';
  private ray: InstanceType<Physics['R']['Ray']>;
  private flags: number;
  private lmFloors: { x: number; z: number; r2: number; kind: Surface; inside: Surface }[] = [];
  private garage: { x: number; z: number };
  private hits = new Float32Array(H_RAYS).fill(H_MAX);
  private hitUp = false;
  private phase = 0;
  private timer = 0;

  constructor(private physics: Physics, private hf: Heightfield) {
    const R = physics.R;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    // fixed geometry only: skips the player's kinematic capsule, the EMP canister and sensors
    this.flags = R.QueryFilterFlags.ONLY_FIXED | R.QueryFilterFlags.EXCLUDE_SENSORS;
    for (const lm of LANDMARKS) {
      const f = LANDMARK_FLOORS[lm.id];
      if (f) this.lmFloors.push({ x: lm.position[0], z: lm.position[2], r2: f.r * f.r, kind: f.kind, inside: f.inside });
      // the gas station's forecourt slab is visual: 30 × 22 m round its centre (the inscribed circle)
      if (lm.id === 'gas') this.slabs.push({ x: lm.position[0], z: lm.position[2], r2: 11 * 11 });
    }
    const g = GARAGE.location.position;
    this.garage = { x: g[0], z: g[2] };
    // the Garage's concrete apron, 18 × 9 m in front of the house (GarageBuilder: box(18, …, 9) at z 4.5)
    surfaces.zone({ x: g[0] - 9, y: -1e3, z: g[2] }, { x: g[0] + 9, y: 1e3, z: g[2] + 9 }, 'concrete');
  }

  private slabs: { x: number; z: number; r2: number }[] = [];

  private cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) {
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    return this.physics.world.castRay(r, max, true, this.flags);
  }

  /** The floor under `feet` (call on each footstep / landing). */
  surfaceAt(feet: V3): Surface {
    const hit = this.cast(feet.x, feet.y + 0.3, feet.z, 0, -1, 0, 1.2);
    let s: Surface;
    if (!hit || hit.collider.shapeType() === this.physics.R.ShapeType.HeightField) s = this.ground(feet);
    else s = this.hard(hit.collider, feet);
    this.surface = s;
    return s;
  }

  /** The terrain, or the visual slab / building floor lying on it. */
  private ground(p: V3): Surface {
    const { x, z } = p;
    if (this.room.enclosure > INSIDE) {
      if ((x - this.garage.x) ** 2 + (z - this.garage.z) ** 2 < 40 * 40) return 'concrete';
      for (const f of this.lmFloors) if ((x - f.x) ** 2 + (z - f.z) ** 2 < f.r2) return f.inside;
    }
    for (const sl of this.slabs) if ((x - sl.x) ** 2 + (z - sl.z) ** 2 < sl.r2) return 'concrete';
    const zoned = surfaces.lookup(null, p);
    if (zoned) return zoned;
    return this.terrain(x, z);
  }

  private terrain(x: number, z: number): Surface {
    const hf = this.hf;
    if (hf.sampleGrid(hf.roadDist, x, z) < 3.9) return 'asphalt';
    if (hf.sampleGrid(hf.trackDist, x, z) < 2.6) return 'gravel';
    if (hf.normalAt(x, z).y < 0.87) return 'rock'; // steeper than ~30°
    if (CAVE_TRAIL.length > 1 && distToPolyline(x, z, CAVE_TRAIL).d < 9) return 'gravel';
    return 'sand';
  }

  private hard(c: Collider, p: V3): Surface {
    const tagged = surfaces.lookup(c, p);
    if (tagged) return tagged;
    const g = this.garage;
    if ((p.x - g.x) ** 2 + (p.z - g.z) ** 2 < 40 * 40) return 'concrete';
    for (const f of this.lmFloors) if ((p.x - f.x) ** 2 + (p.z - f.z) ** 2 < f.r2) return f.kind;
    const R = this.physics.R;
    switch (c.shapeType()) {
      case R.ShapeType.Ball: return 'rock';
      case R.ShapeType.Cylinder: return 'wood';
      case R.ShapeType.Cuboid: return 'metal'; // out in the open, a box is a car wreck
      default: return 'concrete';
    }
  }

  /** Sweep a few rays around the player (call every frame with the feet; it throttles itself). */
  update(dt: number, feet: V3) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = ROOM_EVERY;
    // a real ceiling (tunnels, hulls) close overhead: keep the fan under it
    const up = this.cast(feet.x, feet.y + 1, feet.z, 0, 1, 0, UP_MAX);
    this.hitUp = !!up && up.timeOfImpact < 12;
    const y = feet.y + 1 + (up ? Math.max(0.2, Math.min(FAN_Y - 1, up.timeOfImpact - 0.3)) : FAN_Y - 1);
    // alternate halves of the fan
    for (let i = this.phase; i < H_RAYS; i += 2) {
      const a = (i / H_RAYS) * Math.PI * 2;
      const hit = this.cast(feet.x, y, feet.z, Math.cos(a), 0, Math.sin(a), H_MAX);
      this.hits[i] = hit ? hit.timeOfImpact : H_MAX;
    }
    this.phase ^= 1;

    // walls: a hit within 6 m counts fully, fading out by 14 m; then "most of the way round" = a room
    let wall = 0, mean = 0;
    for (let i = 0; i < H_RAYS; i++) {
      const d = this.hits[i];
      wall += Math.min(1, Math.max(0, (14 - d) / 8));
      mean += d;
    }
    wall /= H_RAYS;
    mean /= H_RAYS;
    const u = Math.min(1, Math.max(0, (wall - 0.5) / 0.35));
    let e = u * u * (3 - 2 * u);
    // a real ceiling (tunnels, hulls); a lone overhead beam or billboard out in the open doesn't count
    if (this.hitUp && wall > 0.25) e = Math.max(e, 0.35 + 0.65 * wall);
    this.room.enclosure = e;
    this.room.size = mean;
  }
}
