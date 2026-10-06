import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, norm, wire, MeshBatch, type Frame } from '@/game/world/kit';
import { glow, plainStandard, rustyMetal } from '@/game/world/materials';
import { GlowSprites } from '@/game/world/effects';
import { VirtualLight } from '@/game/world/lights';
import { townQuad, townFloor, townBoard, townSignMaterial, townDecalMaterial, townPoolMaterial, type TownDecal } from './townAtlas';

type Mat = THREE.Material;
type Col = ReturnType<Physics['addBox']>;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Halo channels for a site's GlowSprites. */
export const HALO = { ON: 0, NIGHT: 1, POWER: 2, NEON: 3, FIRE: 4 } as const;

/**
 * One site under construction: the merged batches (lit geometry, signs, decals, light pools), the
 * halo sprites, colliders and lights, all in the site's local frame. Everything static ends up in
 * a handful of meshes; see `finish()`.
 */
export class Site {
  /** lit, shadow-casting geometry (factory materials, family-merged) */
  readonly b = new MeshBatch();
  /** painted boards on the town atlas */
  readonly s = new MeshBatch();
  /** alpha decals: grime, posters, floors */
  readonly d = new MeshBatch();
  /** additive light pools */
  readonly p = new MeshBatch();
  readonly halos = new GlowSprites(6);
  readonly lights: VirtualLight[] = [];
  /** glows that follow the night (windows, bulbs): uniform + day/night levels */
  readonly nightGlows: { u: { value: number }; day: number; night: number }[] = [];

  constructor(readonly f: Frame, readonly physics: Physics, readonly root: THREE.Object3D) {}

  col(x: number, y: number, z: number, hx: number, hy: number, hz: number, ry = 0): Col {
    return this.physics.addBox(this.f.p(x, y, z), { x: hx, y: hy, z: hz }, this.f.yaw + ry);
  }

  /** A box tilted by `pitch` about its local X axis (ramps under stairs), turned by `ry`. */
  colPitched(x: number, y: number, z: number, hx: number, hy: number, hz: number, pitch: number, ry = 0) {
    const R = this.physics.R;
    const p = this.f.p(x, y, z);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.f.yaw + ry)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    return this.physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  pen(x = 0, y = 0, z = 0, ry = 0) {
    return new Pen(this, x, y, z, ry);
  }

  /** A warm glow that is dim by day and bright at night. Returns the batched material. */
  nightGlow(c: THREE.ColorRepresentation, day: number, night: number) {
    const g = glow(c, day);
    this.nightGlows.push({ u: g.intensity as unknown as { value: number }, day, night });
    return g.material;
  }

  light(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, dist: number, decay = 1.7) {
    const L = new VirtualLight(color, intensity, dist, decay);
    L.parent = this.root;
    L.position.set(x, y, z);
    this.lights.push(L);
    return L;
  }

  halo(x: number, y: number, z: number, color: THREE.ColorRepresentation, size: number, ch: number = HALO.NIGHT, k = 1) {
    this.halos.add(new THREE.Vector3(x, y, z), color, size, ch, k);
  }

  pool(name: TownDecal, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    this.p.add(townPoolMaterial(), townFloor(name, w, h, x, y, z, rot));
  }

  /** wall wash: a vertical pool hanging from (x, top, z) on a wall facing `ry` */
  wash(w: number, h: number, x: number, top: number, z: number, ry: number) {
    this.p.add(townPoolMaterial(), townQuad('washWarm', w, h, x, top - h / 2, z, 0, ry, 0));
  }

  decal(name: TownDecal, w: number, h: number, x: number, y: number, z: number, ry = 0, rz = 0) {
    this.d.add(townDecalMaterial(), townQuad(name, w, h, x, y, z, 0, ry, rz));
  }

  floorDecal(name: TownDecal, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    this.d.add(townDecalMaterial(), townFloor(name, w, h, x, y, z, rot));
  }

  sign(name: TownDecal, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    this.s.add(townSignMaterial(), townBoard(name, w, h, d, x, y, z, ry, rx, rz));
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Draws into a site in a local frame (offset + yaw), so props can be authored once and placed anywhere. */
export class Pen {
  readonly m: THREE.Matrix4;
  constructor(readonly site: Site, readonly x: number, readonly y: number, readonly z: number, readonly ry: number) {
    this.m = new THREE.Matrix4().compose(V(x, y, z), _q.setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1));
  }
  /** local → site */
  p(x: number, y: number, z: number) {
    return V(x, y, z).applyMatrix4(this.m);
  }
  sub(x: number, y: number, z: number, ry = 0) {
    const o = this.p(x, y, z);
    return new Pen(this.site, o.x, o.y, o.z, this.ry + ry);
  }
  geo(mat: Mat, ...g: THREE.BufferGeometry[]) {
    for (const x of g) this.site.b.add(mat, x.applyMatrix4(this.m));
    return this;
  }
  box(mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    return this.geo(mat, box(w, h, d, x, y, z, ry, rx, rz));
  }
  cyl(mat: Mat, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 10, rx = 0, ry = 0, rz = 0) {
    return this.geo(mat, cyl(rt, rb, h, x, y, z, seg, rx, ry, rz));
  }
  beam(mat: Mat, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
    return this.geo(mat, beam(a, b, r, seg));
  }
  wire(mat: Mat, a: THREE.Vector3, b: THREE.Vector3, sag: number, r = 0.012, segs = 14) {
    return this.geo(mat, wire(a, b, sag, r, segs));
  }
  /** Any geometry at a local placement. */
  put(mat: Mat, g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    g.applyMatrix4(_m.compose(V(x, y, z), _q.setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz)));
    return this.geo(mat, norm(g));
  }
  col(x: number, y: number, z: number, hx: number, hy: number, hz: number, ry = 0) {
    const c = this.p(x, y, z);
    return this.site.col(c.x, c.y, c.z, hx, hy, hz, this.ry + ry);
  }
  sign(name: TownDecal, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const c = this.p(x, y, z);
    this.site.sign(name, w, h, d, c.x, c.y, c.z, this.ry + ry, rx, rz);
  }
  decal(name: TownDecal, w: number, h: number, x: number, y: number, z: number, ry = 0, rz = 0) {
    const c = this.p(x, y, z);
    this.site.decal(name, w, h, c.x, c.y, c.z, this.ry + ry, rz);
  }
  floorDecal(name: TownDecal, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    const c = this.p(x, y, z);
    this.site.floorDecal(name, w, h, c.x, c.y, c.z, this.ry + rot);
  }
  pool(name: TownDecal, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    const c = this.p(x, y, z);
    this.site.pool(name, w, h, c.x, c.y, c.z, this.ry + rot);
  }
}

// ------------------------------------------------------------------ walls with openings

export interface Hole {
  /** span along the wall, metres from its start */
  a: number; b: number;
  y0: number; y1: number;
  kind?: 'door' | 'window' | 'open';
  /** window glass (omit for an empty hole) */
  glass?: Mat;
  /** mullions: vertical count, horizontal count */
  grid?: [number, number];
  /** boards nailed over it (outside) */
  boards?: Mat;
  bars?: Mat;
  /** curtains (inside) */
  curtain?: Mat;
  shutters?: Mat;
  /** a slab under a window outside (default true for windows) */
  sill?: boolean;
}

export interface WallSpec {
  /** centreline from a to b */
  a: [number, number]; b: [number, number];
  y0: number; y1: number; t: number;
  /** exterior normal (unit, perpendicular to a→b) */
  n: [number, number];
  out: Mat;
  inn?: Mat;
  /** interior wainscot below this height */
  dado?: { y: number; mat: Mat; rail?: Mat };
  holes?: Hole[];
  trim?: Mat;
  collide?: boolean;
  /** extra interior baseboard */
  skirting?: Mat;
}

/**
 * A wall with door and window holes: an exterior skin and an interior skin (so a room can be dark
 * plaster while the street side is sun-bleached stucco), trims, sills, glass and colliders.
 */
export function wall(site: Site, w: WallSpec) {
  const [ax, az] = w.a, [bx, bz] = w.b;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  const [nx, nz] = w.n;
  const ry = Math.atan2(-uz, ux);
  const at = (s: number, off: number, y: number) => V(ax + ux * s + nx * off, y, az + uz * s + nz * off);
  const t = w.t;
  const inn = w.inn ?? w.out;
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.02 || y1 - y0 < 0.02) return;
    const sc = (s0 + s1) / 2, yc = (y0 + y1) / 2;
    const o = at(sc, t / 4, yc);
    site.b.add(w.out, box(s1 - s0, y1 - y0, t / 2, o.x, o.y, o.z, ry));
    // interior: dado below, plaster above
    const i = at(sc, -t / 4, 0);
    if (w.dado && y0 < w.dado.y) {
      const dy = Math.min(y1, w.dado.y);
      site.b.add(w.dado.mat, box(s1 - s0, dy - y0, t / 2, i.x, (y0 + dy) / 2, i.z, ry));
      if (y1 > dy) site.b.add(inn, box(s1 - s0, y1 - dy, t / 2, i.x, (dy + y1) / 2, i.z, ry));
      if (w.dado.rail && y1 > w.dado.y) {
        const r = at(sc, -t / 2 - 0.015, w.dado.y);
        site.b.add(w.dado.rail, box(s1 - s0, 0.05, 0.03, r.x, r.y, r.z, ry));
      }
    } else site.b.add(inn, box(s1 - s0, y1 - y0, t / 2, i.x, i.y + yc, i.z, ry));
    if (w.skirting && y0 <= w.y0 + 0.01) {
      const k = at(sc, -t / 2 - 0.012, y0 + 0.06);
      site.b.add(w.skirting, box(s1 - s0, 0.12, 0.025, k.x, k.y, k.z, ry));
    }
    if (w.collide !== false) {
      const c = at(sc, 0, yc);
      site.col(c.x, c.y, c.z, (s1 - s0) / 2, (y1 - y0) / 2, t / 2, ry);
    }
  };
  const holes = [...(w.holes ?? [])].sort((p, q) => p.a - q.a);
  let s = 0;
  for (const h of holes) {
    piece(s, h.a, w.y0, w.y1);
    piece(h.a, h.b, w.y0, h.y0);
    piece(h.a, h.b, h.y1, w.y1);
    s = h.b;
    openingTrim(site, w, h, at, ry);
  }
  piece(s, len, w.y0, w.y1);
}

function openingTrim(site: Site, w: WallSpec, h: Hole, at: (s: number, off: number, y: number) => THREE.Vector3, ry: number) {
  const t = w.t;
  const trim = w.trim;
  const hw = h.b - h.a, sc = (h.a + h.b) / 2;
  const hh = h.y1 - h.y0, yc = (h.y0 + h.y1) / 2;
  const door = h.kind === 'door';
  if (trim && h.kind !== 'open') {
    for (const side of [1, -1]) {
      const off = side * (t / 2 + 0.018);
      // casing: jambs and head (doors run to the floor, windows sit on a sill)
      for (const e of [h.a - 0.05, h.b + 0.05]) {
        const p = at(e, off, yc + (door ? 0.04 : 0));
        site.b.add(trim, box(0.1, hh + (door ? 0.08 : 0.1), 0.036, p.x, p.y, p.z, ry));
      }
      const top = at(sc, off, h.y1 + 0.06);
      site.b.add(trim, box(hw + 0.26, 0.12, 0.04, top.x, top.y, top.z, ry));
      if (!door) {
        const bot = at(sc, off, h.y0 - 0.04);
        site.b.add(trim, box(hw + 0.2, 0.08, 0.036, bot.x, bot.y, bot.z, ry));
      }
    }
    // reveal liners: the frame through the wall thickness
    for (const e of [h.a + 0.02, h.b - 0.02]) {
      const p = at(e, 0, yc);
      site.b.add(trim, box(0.04, hh, t + 0.01, p.x, p.y, p.z, ry));
    }
    const head = at(sc, 0, h.y1 - 0.02);
    site.b.add(trim, box(hw, 0.04, t + 0.01, head.x, head.y, head.z, ry));
    if (door) {
      const th = at(sc, 0, h.y0 + 0.012);
      site.b.add(trim, box(hw, 0.025, t + 0.04, th.x, th.y, th.z, ry));
    }
  }
  if (h.kind === 'window' || (!door && h.kind !== 'open')) {
    if (h.sill !== false) {
      const p = at(sc, t / 2 + 0.05, h.y0 - 0.03);
      site.b.add(w.trim ?? w.out, box(hw + 0.22, 0.06, 0.16, p.x, p.y, p.z, ry, 0.08));
      const q = at(sc, -t / 2 - 0.04, h.y0 - 0.02);
      site.b.add(w.trim ?? w.inn ?? w.out, box(hw + 0.12, 0.04, 0.1, q.x, q.y, q.z, ry));
    }
    if (h.glass) {
      // lit pane on the street side, a dark pane just behind it: rooms don't see their own glow
      const g = at(sc, 0.03, yc);
      site.b.add(h.glass, box(hw - 0.02, hh - 0.02, 0.02, g.x, g.y, g.z, ry));
      const d = at(sc, 0.005, yc);
      site.b.add(plainStandard('#1a2226', 0.08, 0.5), box(hw - 0.03, hh - 0.03, 0.012, d.x, d.y, d.z, ry));
    }
    if (h.grid && trim) {
      const [nv, nh] = h.grid;
      for (let i = 1; i < nv; i++) {
        const p = at(h.a + (hw * i) / nv, 0.04, yc);
        site.b.add(trim, box(0.045, hh, 0.05, p.x, p.y, p.z, ry));
      }
      for (let i = 1; i < nh; i++) {
        const p = at(sc, 0.04, h.y0 + (hh * i) / nh);
        site.b.add(trim, box(hw, 0.045, 0.05, p.x, p.y, p.z, ry));
      }
    }
    if (h.bars) {
      const n = Math.max(3, Math.round(hw / 0.14));
      for (let i = 1; i < n; i++) {
        const p = at(h.a + (hw * i) / n, t / 2 + 0.06, yc);
        site.b.add(h.bars, cyl(0.011, 0.011, hh + 0.06, p.x, p.y, p.z, 5));
      }
      for (const y of [h.y0 + 0.06, h.y1 - 0.06]) {
        const p = at(sc, t / 2 + 0.06, y);
        site.b.add(h.bars, box(hw + 0.06, 0.03, 0.02, p.x, p.y, p.z, ry));
      }
    }
    if (h.curtain) {
      // gathered to each side with a little sag in the middle
      for (const side of [0, 1]) {
        const cw = hw * 0.32;
        const s0 = side ? h.b - cw / 2 + 0.06 : h.a + cw / 2 - 0.06;
        for (let k = 0; k < 4; k++) {
          const p = at(s0 + (k - 1.5) * (cw / 4), -t / 2 - 0.07 - (k % 2) * 0.03, yc + 0.08);
          site.b.add(h.curtain, box(cw / 3.6, hh + 0.24, 0.035, p.x, p.y, p.z, ry));
        }
      }
      const rod = at(sc, -t / 2 - 0.08, h.y1 + 0.16);
      site.b.add(plainStandard('#2a2420', 0.5, 0.6), cyl(0.012, 0.012, hw + 0.5, rod.x, rod.y, rod.z, 5, 0, ry, Math.PI / 2));
    }
    if (h.shutters) {
      for (const [e, dir, open] of [[h.a, -1, 1.2], [h.b, 1, 0.25]] as const) {
        const sw = hw / 2;
        // hinged at the jamb, swung out against (or away from) the wall
        const hinge = at(e + dir * 0.06, t / 2 + 0.04, yc);
        const a2 = ry + dir * open;
        const cx = hinge.x + Math.cos(a2) * dir * sw / 2, cz = hinge.z - Math.sin(a2) * dir * sw / 2;
        site.b.add(h.shutters, box(sw, hh + 0.06, 0.04, cx, hinge.y, cz, a2));
        for (let k = 0; k < 5; k++) site.b.add(h.shutters, box(sw * 0.9, 0.03, 0.03, cx, h.y0 + 0.15 + k * (hh / 5), cz, a2, 0.4));
      }
    }
  }
  if (h.boards) {
    const n = Math.max(2, Math.round(hh / 0.32));
    for (let i = 0; i < n; i++) {
      const p = at(sc, t / 2 + 0.03 + (i % 2) * 0.012, h.y0 + 0.18 + i * ((hh - 0.3) / Math.max(1, n - 1)));
      site.b.add(h.boards, box(hw + 0.36, 0.17, 0.035, p.x, p.y, p.z, ry, 0, (i % 3 - 1) * 0.06));
    }
  }
}

// ------------------------------------------------------------------ slabs, roofs, porches

/** A walkable slab whose top is at `top`, with a collider. */
export function floor(site: Site, mat: Mat, x0: number, x1: number, z0: number, z1: number, top: number, thick = 0.2, collide = true) {
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
  site.b.add(mat, box(x1 - x0, thick, z1 - z0, xc, top - thick / 2, zc));
  if (collide) site.col(xc, top - thick / 2, zc, (x1 - x0) / 2, thick / 2, (z1 - z0) / 2);
}

/** Plank deck (boards along X with gaps), joists hidden underneath, collider at the deck top. */
export function deck(site: Site, mat: Mat, x0: number, x1: number, z0: number, z1: number, top: number, alt?: Mat) {
  const n = Math.max(2, Math.round((z1 - z0) / 0.16));
  const bw = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * bw;
    const m = alt && i % 5 === 2 ? alt : mat;
    site.b.add(m, box(x1 - x0 + (i % 3) * 0.02, 0.05, bw - 0.014, (x0 + x1) / 2 + (i % 2) * 0.01, top - 0.025 - (i % 4 === 1 ? 0.006 : 0), z));
  }
  site.b.add(mat, box(x1 - x0, top - 0.06, 0.08, (x0 + x1) / 2, (top - 0.06) / 2, z1 - 0.04));
  site.b.add(mat, box(0.08, top - 0.06, z1 - z0, x0 + 0.04, (top - 0.06) / 2, (z0 + z1) / 2));
  site.b.add(mat, box(0.08, top - 0.06, z1 - z0, x1 - 0.04, (top - 0.06) / 2, (z0 + z1) / 2));
  site.col((x0 + x1) / 2, top / 2, (z0 + z1) / 2, (x1 - x0) / 2, top / 2, (z1 - z0) / 2);
}

/**
 * Corrugated sheet roof sloping along Z (ridges run down the slope, so every roof shares one
 * family). `yz0` is the height at z0, `yz1` at z1. Patches and a fascia board come along.
 */
export function sheetRoof(site: Site, mat: Mat, x0: number, x1: number, z0: number, z1: number, yz0: number, yz1: number, o: { fascia?: Mat; patch?: Mat; patches?: number; thick?: number; seed?: number } = {}) {
  const run = z1 - z0, rise = yz1 - yz0;
  const L = Math.hypot(run, rise);
  const ang = Math.atan2(rise, run);
  const th = o.thick ?? 0.06;
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, yc = (yz0 + yz1) / 2;
  // sheets of ~1 m with tiny height offsets so the laps read
  const n = Math.max(1, Math.round((x1 - x0) / 0.95));
  const sw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    site.b.add(mat, box(sw + 0.04, th, L, x0 + (i + 0.5) * sw, yc + (i % 2) * 0.012, zc, 0, -ang));
  }
  let r = (o.seed ?? 7) * 9301;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  if (o.patch) for (let i = 0; i < (o.patches ?? 2); i++) {
    const pw = 0.7 + rnd() * 0.6, pl = 0.8 + rnd() * 1.2;
    const px = x0 + pw / 2 + rnd() * (x1 - x0 - pw), t = 0.15 + rnd() * 0.7;
    const pz = z0 + run * t, py = yz0 + rise * t + th / 2 + 0.02;
    site.b.add(o.patch, box(pw, 0.02, pl, px, py, pz, (rnd() - 0.5) * 0.1, -ang));
  }
  if (o.fascia) {
    for (const [z, y] of [[z0, yz0], [z1, yz1]] as const) site.b.add(o.fascia, box(x1 - x0 + 0.06, 0.2, 0.04, xc, y - 0.06, z + (z === z0 ? -0.02 : 0.02)));
    site.b.add(o.fascia, box(0.04, 0.2, L, x0 - 0.02, yc - 0.06, zc, 0, -ang), box(0.04, 0.2, L, x1 + 0.02, yc - 0.06, zc, 0, -ang));
  }
}

/** Gutter along X at height y with downspouts at the ends. */
export function gutter(site: Site, mat: Mat, x0: number, x1: number, z: number, y: number, spouts: number[] = []) {
  site.b.add(mat, box(x1 - x0, 0.09, 0.12, (x0 + x1) / 2, y, z), box(x1 - x0, 0.03, 0.02, (x0 + x1) / 2, y + 0.05, z + 0.06));
  for (const sx of spouts) {
    site.b.add(mat, cyl(0.045, 0.045, y - 0.25, sx, (y - 0.25) / 2 + 0.2, z, 8));
    site.b.add(mat, beam(V(sx, 0.25, z), V(sx, 0.08, z + 0.22), 0.045, 8));
    for (const by of [1.0, y - 0.6]) site.b.add(mat, box(0.11, 0.025, 0.11, sx, by, z - 0.02));
  }
}

/** A post with a base plate and a top cap (wood or steel). */
export function post(site: Site, mat: Mat, x: number, z: number, y0: number, y1: number, r = 0.07, square = true, collide = true) {
  if (square) site.b.add(mat, box(r * 2, y1 - y0, r * 2, x, (y0 + y1) / 2, z));
  else site.b.add(mat, cyl(r, r, y1 - y0, x, (y0 + y1) / 2, z, 8));
  site.b.add(mat, box(r * 2.6, 0.04, r * 2.6, x, y0 + 0.02, z), box(r * 2.4, 0.05, r * 2.4, x, y1 - 0.025, z));
  if (collide) site.col(x, (y0 + y1) / 2, z, r + 0.02, (y1 - y0) / 2, r + 0.02);
}

/** Railing along X or Z: top rail, mid rail and balusters. */
export function railing(site: Site, mat: Mat, ax: number, az: number, bx: number, bz: number, y0: number, h = 0.95, spacing = 0.14, collide = true) {
  const len = Math.hypot(bx - ax, bz - az);
  const ry = Math.atan2(-(bz - az), bx - ax);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  site.b.add(mat, box(len, 0.06, 0.08, cx, y0 + h, cz, ry), box(len, 0.05, 0.05, cx, y0 + 0.18, cz, ry));
  const n = Math.max(1, Math.floor(len / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    site.b.add(mat, box(0.035, h - 0.2, 0.035, ax + (bx - ax) * t, y0 + 0.1 + (h - 0.2) / 2, az + (bz - az) * t));
  }
  if (collide) site.col(cx, y0 + h / 2 + 0.05, cz, len / 2, h / 2 + 0.05, 0.06, ry);
}

/** Bulb on a wire: glass + cap; adds a halo. */
export function bulb(site: Site, mat: Mat, x: number, y: number, z: number, r = 0.05, halo = 0.5, color: THREE.ColorRepresentation = '#ffc890') {
  const g = new THREE.SphereGeometry(r, 7, 5);
  g.translate(x, y, z);
  site.b.add(mat, norm(g));
  site.b.add(plainStandard('#1a1612', 0.5, 0.5), cyl(r * 0.5, r * 0.5, r * 0.8, x, y + r * 1.1, z, 5));
  if (halo > 0) site.halo(x, y, z, color, halo, HALO.NIGHT, 1.4);
}

/** A gooseneck barn lamp on a wall facing `ry`, with halo, ground pool and (optionally) a light. */
export function barnLamp(site: Site, x: number, y: number, z: number, ry: number, opts: { light?: number; pool?: number; poolY?: number } = {}) {
  const P = site.pen(x, y, z, ry);
  const steel = rustyMetal({ base: '#2f3a36', rust: 0.45, metalness: 0.6, roughness: 0.5 });
  P.box(steel, 0.12, 0.16, 0.03, 0, 0, 0.015);
  P.beam(steel, V(0, 0, 0.03), V(0, 0.18, 0.2), 0.016, 5);
  P.beam(steel, V(0, 0.18, 0.2), V(0, 0.12, 0.34), 0.016, 5);
  P.put(steel, new THREE.ConeGeometry(0.15, 0.12, 12, 1, true), 0, 0.07, 0.36);
  P.put(steel, new THREE.CircleGeometry(0.15, 12), 0, 0.012, 0.36, Math.PI / 2);
  const g = site.nightGlow('#ffd29a', 0.4, 5);
  P.put(g, new THREE.SphereGeometry(0.045, 8, 6), 0, 0.03, 0.36);
  const c = P.p(0, 0.02, 0.36);
  site.halo(c.x, c.y, c.z, '#ffc890', 0.7, HALO.NIGHT, 1.5);
  if (opts.pool) {
    const q = P.p(0, 0, 0.36 + opts.pool * 0.15);
    site.pool('poolWarm', opts.pool, opts.pool, q.x, opts.poolY ?? 0.04, q.z);
  }
  if (opts.light) site.light(c.x, c.y - 0.15, c.z, 0xffb070, opts.light, 9);
}

export { V };
