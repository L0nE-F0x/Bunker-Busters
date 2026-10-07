import { Simplex2, smoothstep, lerp, clamp } from '@/engine/noise';
import { WORLD_SIZE, WORLD_SEED, HIGHWAY, SIDE_ROADS, LANDMARKS, CAVE_TRAIL } from '@/content/world';
import { GARAGE } from '@/content/bunkers/garage';
import { OUTPOSTS } from '@/content/recovery';

export interface FlattenZone { x: number; z: number; r: number; falloff: number; target?: number }

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

export function distToPolyline(px: number, pz: number, pts: [number, number][]) {
  let best = Infinity, arc = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, bz - az);
    const { d, t } = distToSegment(px, pz, ax, az, bx, bz);
    if (d < best) { best = d; arc = acc + t * segLen; }
    acc += segLen;
  }
  return { d: best, arc };
}

/**
 * The single source of truth for terrain height. Generated once into a grid that the render mesh,
 * the Rapier heightfield, prop scattering and the minimap all sample.
 */
export class Heightfield {
  readonly size = WORLD_SIZE;
  readonly res: number; // vertices per side
  readonly step: number;
  readonly heights: Float32Array;
  readonly roadDist: Float32Array;
  readonly trackDist: Float32Array;
  readonly roadArc: Float32Array;
  private noise = new Simplex2(WORLD_SEED);
  private noise2 = new Simplex2(WORLD_SEED + 7);
  zones: FlattenZone[] = [];
  /** Walkable corridor carved after the flatten zones. Empty until generate(). */
  trail: [number, number][] = [];

  constructor(segments = 420) {
    this.res = segments + 1;
    this.step = this.size / segments;
    const n = this.res * this.res;
    this.heights = new Float32Array(n);
    this.roadDist = new Float32Array(n);
    this.trackDist = new Float32Array(n);
    this.roadArc = new Float32Array(n);

    const g = GARAGE.location.position;
    this.zones.push({ x: g[0], z: g[2], r: 34, falloff: 26 });
    for (const lm of LANDMARKS) {
      const spec = lm.flatten ?? (lm.kind === 'gas-station' ? { r: 30, falloff: 22 }
        : lm.kind === 'town' ? { r: 44, falloff: 28 }
        : lm.kind === 'cave' ? { r: 14, falloff: 18 }
        : { r: 16, falloff: 22 });
      const zn: FlattenZone = { x: lm.position[0], z: lm.position[2], ...spec };
      // Sit the cave on the ridge, then blend a walkable ramp down toward the flats.
      if (lm.kind === 'cave') zn.target = this.rawHeight(lm.position[0], lm.position[2]);
      this.zones.push(zn);
    }
    // Kade outposts sit on pads of their own
    for (const op of OUTPOSTS) this.zones.push({ x: op.x, z: op.z, r: op.r, falloff: 16 });
    for (const zn of this.zones) if (zn.target == null) zn.target = this.baseHeight(zn.x, zn.z) + (zn === this.zones[0] ? 0.5 : 0);
    const spireLm = LANDMARKS.find((l) => l.kind === 'radio-tower');
    const spire = spireLm && this.zones.find((z) => Math.abs(z.x - spireLm.position[0]) < 1);
    if (spire) spire.target = (spire.target ?? 0) + 7;

    this.generate();
  }

  /** Low-frequency rolling ground used for roads and flatten targets. */
  baseHeight(x: number, z: number) {
    const n = this.noise;
    return n.fbm(x * 0.0022, z * 0.0022, 4) * 14 + n.fbm(x * 0.006 + 40, z * 0.006, 3) * 3.5;
  }

  private rawHeight(x: number, z: number) {
    const n = this.noise, n2 = this.noise2;
    let h = this.baseHeight(x, z);
    // wind-aligned dunes with warped crests
    const warp = n2.fbm(x * 0.01, z * 0.01, 2) * 18;
    const dunePhase = (x * 0.8 + z * 0.35 + warp) * 0.07;
    const duneMask = smoothstep(-0.1, 0.5, n2.fbm(x * 0.003 + 9, z * 0.003 - 3, 3));
    h += (Math.pow(Math.abs(Math.sin(dunePhase)), 1.6) * 3.4 - 1.2) * duneMask;
    // mesas: terraced plateaus with steep sides
    const m = n.ridged(x * 0.0042 + 11, z * 0.0042 - 7, 4);
    const plateau = smoothstep(0.5, 0.58, m);
    const terrace = Math.floor(plateau * 3) / 3 * 0.25 + plateau * 0.75;
    h += terrace * 26 * smoothstep(0.1, 0.5, n2.fbm(x * 0.002 - 5, z * 0.002 + 5, 2) + 0.35);
    // rocky detail
    h += n2.fbm(x * 0.03, z * 0.03, 3) * 0.9;
    // dry wash: a meandering riverbed
    const wx = x + n.fbm(z * 0.004, 3.3, 3) * 90;
    const wash = Math.abs(wx * 0.18 - z * 0.06 - 25) / Math.hypot(0.18, 0.06);
    h -= smoothstep(26, 4, wash) * 5.5;
    // bounding mountains
    const r = Math.max(Math.abs(x), Math.abs(z));
    const edge = smoothstep(this.size * 0.39, this.size * 0.5, r);
    h += edge * (45 + n.ridged(x * 0.005, z * 0.005, 4) * 55 + n.fbm(x * 0.01, z * 0.01, 3) * 12);
    return h;
  }

  private generate() {
    const { res, step, size } = this;
    const half = size / 2;
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = -half + ix * step;
        const z = -half + iz * step;
        const i = iz * res + ix;
        let h = this.rawHeight(x, z);

        const hw = distToPolyline(x, z, HIGHWAY);
        let track = Infinity;
        for (const tr of SIDE_ROADS) track = Math.min(track, distToPolyline(x, z, tr).d);
        this.roadDist[i] = hw.d;
        this.roadArc[i] = hw.arc;
        this.trackDist[i] = track;

        const roadMask = Math.max(smoothstep(16, 5, hw.d), smoothstep(9, 3, track) * 0.9);
        if (roadMask > 0) h = lerp(h, this.baseHeight(x, z) + 0.15, roadMask);

        for (const zn of this.zones) {
          const d = Math.hypot(x - zn.x, z - zn.z);
          const k = smoothstep(zn.r + zn.falloff, zn.r, d);
          if (k > 0) h = lerp(h, zn.target!, k);
        }
        this.heights[i] = h;
      }
    }
    this.carveTrail();
  }

  /**
   * The ridge's own slope is a cliff. Replace it along CAVE_TRAIL with a grade the
   * controller can walk (smoothstep peaks near 1.5× the average rise/run) and a
   * flat walking surface about 18 m across. The banks blend back into the mountain.
   */
  private carveTrail() {
    const cave = LANDMARKS.find((l) => l.kind === 'cave');
    if (!cave || CAVE_TRAIL.length < 2) return;
    this.trail = CAVE_TRAIL;
    const [cx, , cz] = cave.position;
    const shelf = this.heightAt(cx, cz);
    const [sx, sz] = CAVE_TRAIL[0];
    const base = this.heightAt(sx, sz);
    let total = 0;
    for (let i = 0; i < CAVE_TRAIL.length - 1; i++) {
      const a = CAVE_TRAIL[i], b = CAVE_TRAIL[i + 1];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (total < 1) return;
    const { res, step, size } = this;
    const half = size / 2;
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = -half + ix * step;
        const z = -half + iz * step;
        const { d, arc } = distToPolyline(x, z, CAVE_TRAIL);
        if (d > 20) continue;
        const t = clamp(arc / total, 0, 1);
        const u = t * t * (3 - 2 * t);
        const trailH = lerp(base, shelf, u);
        const k = smoothstep(20, 9, d);
        const i = iz * res + ix;
        this.heights[i] = lerp(this.heights[i], trailH, k);
      }
    }
  }

  /** Bilinear height at world XZ. */
  heightAt(x: number, z: number) {
    const { res, step, size, heights } = this;
    const fx = clamp((x + size / 2) / step, 0, res - 1.001);
    const fz = clamp((z + size / 2) / step, 0, res - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i = iz * res + ix;
    const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + res], h11 = heights[i + res + 1];
    // match the triangle split used by PlaneGeometry (diagonal from (0,1) to (1,0))
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  normalAt(x: number, z: number, out = { x: 0, y: 1, z: 0 }) {
    const e = this.step;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    const nx = hl - hr, nz = hd - hu, ny = 2 * e;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  sampleGrid(arr: Float32Array, x: number, z: number) {
    const { res, step, size } = this;
    const ix = Math.round(clamp((x + size / 2) / step, 0, res - 1));
    const iz = Math.round(clamp((z + size / 2) / step, 0, res - 1));
    return arr[iz * res + ix];
  }

  roadDistanceAt(x: number, z: number) {
    return Math.min(this.sampleGrid(this.roadDist, x, z), this.sampleGrid(this.trackDist, x, z));
  }

  /** Distance to nearest flatten zone edge (negative inside). */
  zoneDistance(x: number, z: number) {
    let best = Infinity;
    for (const zn of this.zones) best = Math.min(best, Math.hypot(x - zn.x, z - zn.z) - zn.r);
    // Keep rocks and scrub off the wash. 14 m reads as "inside the corridor" to scatter.
    if (this.trail.length) best = Math.min(best, distToPolyline(x, z, this.trail).d - 14);
    return best;
  }

  /** Height function extended beyond the playable square (for the far-terrain ring). */
  farHeight(x: number, z: number) {
    return this.rawHeight(x, z);
  }
}
