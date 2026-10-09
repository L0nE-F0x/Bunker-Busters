import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec4, float, uniform, uv, time, smoothstep, abs, pow, dot, normalize, cameraPosition, positionWorld,
  normalWorld, texture,
} from 'three/tsl';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '@/game/world/Heightfield';
import { noise } from '@/engine/noiseTex';
import { MeshBatch, Frame, canvasTexture, grime, norm, shadowProxy } from '@/game/world/kit';
import { GlowPalette, plainStandard } from '@/game/world/materials';
import { GlowSprites } from '@/game/world/effects';
import { surfaces } from '@/engine/surface';

/**
 * Shared building kit for the two sites by the same hand: The Exit Strategy (jet.ts) and the Starlite
 * Drive-In (drivein.ts). Site-local geometry helpers, colliders that match what you see (yaw boxes,
 * fully oriented boxes and trimeshes straight into Rapier), one painted-detail atlas for both sites,
 * an additive beam material (sun shafts, the projector), and sand drifts that reuse the terrain's own
 * material so they melt into the ground.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
export type Col = ReturnType<Physics['addBox']>;

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Matrix from position + euler (XYZ) + optional scale. */
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    v3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    v3(sx, sy, sz),
  );
}

/** Apply a matrix to geometry and normalise its attributes for merging. */
export function xf(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  return norm(g.applyMatrix4(m));
}

/** Everything a site builds with: batches, glow, halos and colliders in site-local coordinates. */
export class SiteKit {
  /** static, casts and receives shadows */
  readonly b = new MeshBatch();
  /** static, no shadow casting (glass, thin wires, flat litter) */
  readonly nb = new MeshBatch();
  /** decals: lit atlas quads (no shadows, drawn after the walls) */
  readonly d = new MeshBatch();
  /** additive atlas quads: light pools, glowing screens and signs (brighter at night) */
  readonly gd = new MeshBatch();
  readonly pal = new GlowPalette(32);
  readonly halos = new GlowSprites(16);
  /** sand drifts (terrain material), built as one mesh */
  readonly sand: THREE.BufferGeometry[] = [];
  private readonly colliders: Col[] = [];
  private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();

  constructor(readonly frame: Frame, readonly physics: Physics, readonly hf: Heightfield) {}

  /** Yaw-only box collider, site-local centre and half extents. */
  col(x: number, y: number, z: number, hx: number, hy: number, hz: number, ry = 0) {
    const p = this.frame.p(x, y, z);
    const c = this.physics.addBox(p, { x: hx, y: hy, z: hz }, this.frame.yaw + ry);
    this.colliders.push(c);
    return c;
  }

  /** Fully oriented box: `m` places a box of half extents (hx,hy,hz) centred at its origin (site-local). */
  ocol(m: THREE.Matrix4, hx: number, hy: number, hz: number) {
    const w = new THREE.Matrix4().multiplyMatrices(this.frame.m, m);
    w.decompose(this._p, this._q, this._s);
    const R = this.physics.R;
    const desc = R.ColliderDesc.cuboid(hx * this._s.x, hy * this._s.y, hz * this._s.z)
      .setTranslation(this._p.x, this._p.y, this._p.z)
      .setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w });
    const c = this.physics.world.createCollider(desc);
    this.colliders.push(c);
    return c;
  }

  /** Triangle-mesh collider from site-local geometry (exact match for drifts and ramps). */
  tri(g: THREE.BufferGeometry) {
    const geo = g.index ? g.toNonIndexed() : g;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new Float32Array(pos.count * 3);
    const t = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      t.fromBufferAttribute(pos, i).applyMatrix4(this.frame.m);
      v[i * 3] = t.x; v[i * 3 + 1] = t.y; v[i * 3 + 2] = t.z;
    }
    const idx = new Uint32Array(pos.count);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    const c = this.physics.world.createCollider(this.physics.R.ColliderDesc.trimesh(v, idx));
    this.colliders.push(c);
    return c;
  }

  /** Terrain height under a site-local point, relative to the site origin. */
  ground(lx: number, lz: number) {
    const p = this.frame.p(lx, 0, lz);
    return this.hf.heightAt(p.x, p.z) - this.frame.y;
  }

  /**
   * A sand drift: a grid mesh over the terrain from (x0,z0) to (x1,z1) (site-local, rotated by `ry`
   * around its centre), lifted by `h(u,v)` metres (u,v ∈ 0..1 across the patch). Cells whose corners
   * are all flat are skipped; edges sink a little so there is never a seam. Adds a matching trimesh
   * collider unless `collide` is false.
   */
  drift(cx: number, cz: number, w: number, d: number, ry: number, h: (u: number, v: number) => number, res = 0.6, collide = true) {
    const nx = Math.max(2, Math.ceil(w / res)), nz = Math.max(2, Math.ceil(d / res));
    const c = Math.cos(ry), s = Math.sin(ry);
    const P: THREE.Vector3[] = [];
    const H: number[] = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx, v = j / nz;
        const lx0 = (u - 0.5) * w, lz0 = (v - 0.5) * d;
        const lx = cx + lx0 * c + lz0 * s, lz = cz - lx0 * s + lz0 * c;
        const hh = h(u, v);
        H.push(hh);
        P.push(v3(lx, this.ground(lx, lz) + (hh > 0.004 ? hh : -0.06), lz));
      }
    }
    const pos: number[] = [];
    const at = (i: number, j: number) => P[j * (nx + 1) + i];
    const hv = (i: number, j: number) => H[j * (nx + 1) + i];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (Math.max(hv(i, j), hv(i + 1, j), hv(i, j + 1), hv(i + 1, j + 1)) <= 0.004) continue;
        const a = at(i, j), b = at(i + 1, j), cc = at(i + 1, j + 1), dd = at(i, j + 1);
        pos.push(a.x, a.y, a.z, dd.x, dd.y, dd.z, b.x, b.y, b.z, b.x, b.y, b.z, dd.x, dd.y, dd.z, cc.x, cc.y, cc.z);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // smooth normals across the grid (non-indexed → average by position)
    smoothNormals(g);
    this.sand.push(norm(g));
    // drifts are sand underfoot, whatever the landmark's floor table says
    if (collide) surfaces.tag(this.tri(g), 'sand');
  }

  /** Build the static set under `root` and return [near group, far stand-in]. */
  build(root: THREE.Object3D, scene: THREE.Scene, name: string, farColors?: Map<THREE.Material, THREE.ColorRepresentation>) {
    const near = new THREE.Group();
    near.name = name + '-near';
    const far = this.b.buildFar(name + '-far', { minSize: 0.6, colors: farColors });
    // the static batch casts through one depth-pass draw (doors, the go bag, reels keep their own)
    const statics = this.b.build(name + '-static');
    shadowProxy(statics);
    near.add(statics);
    near.add(this.nb.build(name + '-thin', false, true));
    const dec = this.d.build(name + '-decals', false, false);
    dec.traverse((o) => { o.renderOrder = 2; });
    near.add(dec);
    const gd = this.gd.build(name + '-glowdecals', false, false);
    gd.traverse((o) => { o.renderOrder = 3; });
    near.add(gd);
    if (this.sand.length) {
      const g = mergeAll(this.sand);
      const m = new THREE.Mesh(g, sandMaterial(scene));
      m.receiveShadow = true;
      m.castShadow = true;
      m.name = name + '-sand';
      near.add(m);
    }
    near.add(this.halos.build());
    root.add(near, far);
    return { near, far };
  }
}

function mergeAll(list: THREE.BufferGeometry[]) {
  const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uvs.set(g.attributes.uv.array as Float32Array, o * 2);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

/** Average normals of coincident vertices (non-indexed geometry). */
export function smoothNormals(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const acc = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = new THREE.Vector3()));
    a.x += nor.getX(i); a.y += nor.getY(i); a.z += nor.getZ(i);
  }
  for (const a of acc.values()) a.normalize();
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i))!;
    nor.setXYZ(i, a.x, a.y, a.z);
  }
  nor.needsUpdate = true;
}

/** The terrain's own material (so drifts take its exact sand, ripples and storm streaks). */
let _sand: THREE.Material | null = null;
export function sandMaterial(scene: THREE.Scene) {
  if (_sand) return _sand;
  const t = scene.getObjectByName('terrain') as THREE.Mesh | undefined;
  _sand = (t?.material as THREE.Material) ?? plainStandard('#a8784a', 0.95);
  return _sand;
}

let _glass: THREE.Material | null = null;
/** Thin tinted glass (cabin windows, windscreens, car glass). Transparent, so it draws apart. */
export function glassMat() {
  if (_glass) return _glass;
  _glass = new THREE.MeshStandardNodeMaterial({ color: '#8fa6ae', roughness: 0.04, metalness: 0.4, transparent: true, opacity: 0.32, depthWrite: false });
  return _glass;
}

// ------------------------------------------------------------------ hull
export interface HullOpts {
  r: number;
  z0: number;
  z1: number;
  /** segments around (default 28) */
  segA?: number;
  /** quad length along z (default 0.55) */
  dz?: number;
  /** radius scale along z (tapers) */
  taper?: (z: number) => number;
  /** vertical offset of the axis along z (nose droop, tail upsweep) */
  droop?: (z: number) => number;
  /** which bucket (0..3) a quad goes to; -1 = skip (hole). a: 0 top, +π/2 = +x */
  cell?: (a: number, z: number, i: number, j: number) => number;
  /** jagged break amplitude at each end (0 = clean) */
  jag0?: number;
  jag1?: number;
  /** normals inward (lining) */
  inward?: boolean;
  /** restrict the angle range (a in [aMin, aMax]) */
  aMin?: number;
  aMax?: number;
  seed?: number;
}

/**
 * A tube along z with a circular cross-section: fuselage skin or cabin lining. `cell` routes quads to
 * the main geometry, the alt geometry (e.g. the windscreen) or nowhere (holes). Ends can be torn: the
 * end rings wobble along z and in radius (same seed → skin and lining tear alike, so `ringStrip`
 * can close the gap between them). Returns the end rings too.
 */
export function hull(o: HullOpts) {
  const segA = o.segA ?? 28;
  const aMin = o.aMin ?? -Math.PI, aMax = o.aMax ?? Math.PI;
  const L = o.z1 - o.z0;
  const segZ = Math.max(1, Math.round(L / (o.dz ?? 0.55)));
  const r = rng(o.seed ?? 7);
  const jitA: number[] = [], jitB: number[] = [], jitR0: number[] = [], jitR1: number[] = [];
  for (let i = 0; i <= segA; i++) { jitA.push(r()); jitB.push(r()); jitR0.push(r()); jitR1.push(r()); }
  // close the seam on a full circle
  if (aMax - aMin > 6.28) { jitA[segA] = jitA[0]; jitB[segA] = jitB[0]; jitR0[segA] = jitR0[0]; jitR1[segA] = jitR1[0]; }
  const vert = (i: number, j: number): [number, number, number, number] => {
    const a = aMin + ((aMax - aMin) * i) / segA;
    let z = o.z0 + (L * j) / segZ;
    let rr = o.r * (o.taper ? o.taper(z) : 1);
    if (j === 0 && o.jag0) { z += (jitA[i] - 0.3) * o.jag0; rr *= 1 + (jitR0[i] - 0.5) * 0.1 * o.jag0; }
    if (j === segZ && o.jag1) { z -= (jitB[i] - 0.3) * o.jag1; rr *= 1 + (jitR1[i] - 0.5) * 0.1 * o.jag1; }
    if (j === 1 && o.jag0) rr *= 1 + (jitR0[i] - 0.5) * 0.04 * o.jag0;
    if (j === segZ - 1 && o.jag1) rr *= 1 + (jitR1[i] - 0.5) * 0.04 * o.jag1;
    const y = Math.cos(a) * rr + (o.droop ? o.droop(z) : 0);
    return [Math.sin(a) * rr, y, z, a];
  };
  const buckets: number[][][] = [];
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segA; i++) {
      const aMid = aMin + ((aMax - aMin) * (i + 0.5)) / segA;
      const zMid = o.z0 + (L * (j + 0.5)) / segZ;
      const bucket = o.cell ? o.cell(aMid, zMid, i, j) : 0;
      if (bucket < 0) continue;
      while (buckets.length <= bucket) buckets.push([[], [], []]);
      const [P, Nn, U] = buckets[bucket];
      const q = [vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)];
      const tris = o.inward ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      const s = o.inward ? -1 : 1;
      for (const k of tris) {
        const [x, y, z, a] = q[k];
        P.push(x, y, z);
        Nn.push(Math.sin(a) * s, Math.cos(a) * s, 0);
        U.push((a / (Math.PI * 2)) * o.r * 6.28, z);
      }
    }
  }
  const mk = (b: number[][] | undefined) => {
    if (!b || !b[0].length) return null;
    const [p, n, u] = b;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    if (o.taper || o.droop) { g.computeVertexNormals(); smoothNormals(g); }
    return g;
  };
  const ring = (j: number) => Array.from({ length: segA + 1 }, (_, i) => { const [x, y, z] = vert(i, j); return v3(x, y, z); });
  const geos = [0, 1, 2, 3].map((k) => mk(buckets[k]));
  return { geos, ring0: ring(0), ring1: ring(segZ), segZ };
}

/** Closes the torn edge between two matching rings (skin outside, lining inside). */
export function ringStrip(outer: THREE.Vector3[], inner: THREE.Vector3[], flip = false) {
  const pos: number[] = [];
  for (let i = 0; i < outer.length - 1; i++) {
    const a = outer[i], b = outer[i + 1], c = inner[i + 1], d = inner[i];
    const t = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of t) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

// ------------------------------------------------------------------ beams
/** Additive light volume. `uv.y` runs 0 at the source → 1 at the far end, `uv.x` across. */
export function beamMaterial(c: THREE.ColorRepresentation, intensity: number) {
  const uI = uniform(intensity);
  const uC = uniform(new THREE.Color(c));
  const uFade = uniform(0.35); // how much the far end fades
  const uSoft = uniform(1); // 1 = feather the side edges (shafts), 0 = crisp (projector frustum)
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true,
  });
  mat.colorNode = Fn(() => {
    const along = uv().y;
    const across = uv().x;
    const vdir = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalWorld, vdir));
    const dust = noise(positionWorld.xz.add(positionWorld.y).mul(0.11).add(time.mul(0.015))).r.sub(0.5).mul(2);
    const motes = smoothstep(0.72, 0.9, noise(positionWorld.xy.add(positionWorld.zx).mul(1.7).add(vec2(time.mul(0.03), time.mul(-0.05)))).g);
    const rays = noise(vec2(across.mul(5.0), time.mul(0.25))).r.mul(0.6).add(0.55);
    const dist = positionWorld.sub(cameraPosition).length();
    const near = smoothstep(0.4, 3.5, dist);
    const ends = smoothstep(0.0, 0.04, along).mul(float(1).sub(along.mul(uFade)));
    // soft sides: no hard pane edges where two faces of the volume meet
    const sides = smoothstep(0.0, 0.3, across).mul(smoothstep(1.0, 0.7, across));
    const a = pow(facing, 1.6).mul(ends).mul(dust.mul(0.3).add(0.8)).mul(rays).mul(near).mul(sides.mul(uSoft).add(float(1).sub(uSoft)))
      .add(motes.mul(0.35).mul(near).mul(ends).mul(sides));
    return vec4((uC as N).mul(a).mul(uI), 1);
  })();
  return { material: mat, intensity: uI, color: uC, fade: uFade, soft: uSoft };
}

/** Open four-sided frustum from a source rectangle to an end rectangle (corners in order around). */
export function frustum(src: THREE.Vector3[], dst: THREE.Vector3[]) {
  const pos: number[] = [], uvs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = src[k], b = src[(k + 1) % 4], c = dst[(k + 1) % 4], d = dst[k];
    const quad = [[a, 0, 0], [b, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [d, 0, 1]] as const;
    for (const [p, u, w] of quad) { pos.push(p.x, p.y, p.z); uvs.push(u, w); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A rounded frustum between two superellipse sections (rounder than a box, so the facing term in
 * beamMaterial shades it like a volume). `a`/`b` = section centres, (ra, rb) = their half extents,
 * axes `ux`/`uy` span both sections. uv.x runs around, uv.y 0 at `a` → 1 at `b`.
 */
export function beamTube(a: THREE.Vector3, ra: [number, number], b: THREE.Vector3, rb: [number, number], ux: THREE.Vector3, uy: THREE.Vector3, segs = 28, n = 4) {
  const ring = (c: THREE.Vector3, r: [number, number]) => Array.from({ length: segs + 1 }, (_, i) => {
    const t = (i / segs) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n) * r[0];
    const y = Math.sign(st) * Math.pow(Math.abs(st), 2 / n) * r[1];
    return c.clone().addScaledVector(ux, x).addScaledVector(uy, y);
  });
  const A = ring(a, ra), B = ring(b, rb);
  const pos: number[] = [], uvs: number[] = [];
  for (let i = 0; i < segs; i++) {
    const q: [THREE.Vector3, number, number][] = [[A[i], i / segs, 0], [A[i + 1], (i + 1) / segs, 0], [B[i + 1], (i + 1) / segs, 1], [A[i], i / segs, 0], [B[i + 1], (i + 1) / segs, 1], [B[i], i / segs, 1]];
    for (const [p, u, w] of q) { pos.push(p.x, p.y, p.z); uvs.push(u, w); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  smoothNormals(g);
  return g;
}

// ------------------------------------------------------------------ atlas
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; v0: number; u1: number; v1: number }

export const F_DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
export const F_UI = '"Chakra Petch", Arial, sans-serif';
export const F_MONO = '"JetBrains Mono", monospace';

const ATLAS_SIZE = 2048;
const DRAW: Record<string, [number, number, Draw]> = {};

/** Register an atlas entry (call at module load, before the first decal()). */
export function paint(name: string, w: number, h: number, draw: Draw) {
  DRAW[name] = [w, h, draw];
}

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(DRAW).sort((a, b) => b[1][1] - a[1][1]);
  const PAD = 4;
  const tex = canvasTexture(ATLAS_SIZE, ATLAS_SIZE, (ctx) => {
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    let x = 0, y = 0, rowH = 0, seed = 3;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > ATLAS_SIZE) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > ATLAS_SIZE) throw new Error('site atlas full at ' + name);
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(ctx, w, h, rng(seed++));
      ctx.restore();
      regions[name] = { u0: (x + 1) / ATLAS_SIZE, u1: (x + w - 1) / ATLAS_SIZE, v0: 1 - (y + h - 1) / ATLAS_SIZE, v1: 1 - (y + 1) / ATLAS_SIZE };
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _atlas = { tex, regions };
  return _atlas;
}

/** A w×h quad showing atlas region `name`, built facing +z then placed by matrix `m`. */
export function decal(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no atlas entry ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, r.u0 + uvA.getX(i) * (r.u1 - r.u0), r.v0 + uvA.getY(i) * (r.v1 - r.v0));
  return xf(g, m);
}

/** Flat on the ground (local y), rotated `rot` about the vertical. */
export const floorDecal = (name: string, w: number, h: number, x: number, y: number, z: number, rot = 0) =>
  decal(name, w, h, new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));

/** Map every face of a geometry onto an atlas region (boxes with a printed face). */
export function atlasMap(name: string, g: THREE.BufferGeometry) {
  const r = atlas().regions[name];
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, r.u0 + uvA.getX(i) * (r.u1 - r.u0), r.v0 + uvA.getY(i) * (r.v1 - r.v0));
  return g;
}

let _lit: THREE.MeshStandardNodeMaterial | null = null;
export function decalMat() {
  if (_lit) return _lit;
  _lit = new THREE.MeshStandardNodeMaterial({
    map: atlas().tex, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  return _lit;
}

let _solid: THREE.MeshStandardNodeMaterial | null = null;
/** Opaque atlas material for printed solids (crate stencils, sign plates, the brochure). */
export function atlasSolid() {
  if (_solid) return _solid;
  _solid = new THREE.MeshStandardNodeMaterial({ map: atlas().tex, roughness: 0.6, metalness: 0.05, alphaTest: 0.5 });
  return _solid;
}

/** 0 by day … 1 at night, and a flicker multiplier: set by the sites each frame. */
export const uSiteNight = uniform(0);
export const uSiteFlicker = uniform(1);
let _add: THREE.MeshBasicNodeMaterial | null = null;
/** Additive atlas material: light pools, glowing screens and signs. Brighter at night. */
export function glowDecalMat() {
  if (_add) return _add;
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  const t: N = texture(atlas().tex);
  // (levels as uniforms: placesArt's glow has this graph too, so the two share one program)
  const k: N = uniform(0.18).add(uSiteNight.mul(uniform(0.82))).mul(uSiteFlicker);
  m.colorNode = t.rgb.mul(t.a).mul(k);
  m.opacityNode = float(1);
  _add = m;
  return m;
}

// ---------------------------------------------------------------- shared painted bits
function blob(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, rgb: string, n: number, alpha: number, spread = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 1.6) * spread;
    const x = w / 2 + Math.cos(a) * d * w, y = h / 2 + Math.sin(a) * d * h;
    const rad = (0.05 + r() * 0.16) * w * (1 - d);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function pool(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.3, `rgba(${rgb},0.55)`);
  g.addColorStop(0.7, `rgba(${rgb},0.12)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

paint('oil', 256, 256, (c, w, h, r) => blob(c, w, h, r, '22,16,12', 26, 0.22));
paint('scorch', 256, 256, (c, w, h, r) => { blob(c, w, h, r, '18,14,12', 34, 0.3, 0.36); blob(c, w, h, r, '60,40,25', 10, 0.15, 0.2); });
paint('sandpile', 256, 256, (c, w, h, r) => { blob(c, w, h, r, '196,150,100', 30, 0.3, 0.3); blob(c, w, h, r, '170,120,78', 12, 0.25, 0.2); });
paint('dirt', 256, 256, (c, w, h, r) => blob(c, w, h, r, '70,50,32', 22, 0.2));
paint('streaks', 256, 256, (c, w, h, r) => {
  for (let i = 0; i < 26; i++) {
    const x = r() * w, len = h * (0.3 + r() * 0.7), wd = 2 + r() * 9;
    const g = c.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(110,50,20,${0.35 + r() * 0.3})`);
    g.addColorStop(1, 'rgba(110,50,20,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, wd, len);
  }
});
paint('gouge', 512, 128, (c, w, h, r) => {
  // churned sand and plough lines along the trench (u runs along the trench)
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(60,40,24,0)');
  g.addColorStop(0.25, 'rgba(70,46,26,0.5)');
  g.addColorStop(0.5, 'rgba(50,34,20,0.65)');
  g.addColorStop(0.75, 'rgba(70,46,26,0.5)');
  g.addColorStop(1, 'rgba(60,40,24,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const y = h * (0.2 + r() * 0.6);
    c.strokeStyle = `rgba(${r() < 0.5 ? '30,20,12' : '170,130,90'},${0.15 + r() * 0.3})`;
    c.lineWidth = 1 + r() * 3;
    c.beginPath();
    c.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) c.lineTo(x, y + (r() - 0.5) * 4);
    c.stroke();
  }
  blob(c, w, h, r, '20,14,10', 12, 0.12, 0.45);
});
paint('poolWarm', 128, 128, (c, w, h) => pool(c, w, h, '255,190,120'));
paint('poolGreen', 128, 128, (c, w, h) => pool(c, w, h, '80,255,150'));
paint('poolCool', 128, 128, (c, w, h) => pool(c, w, h, '170,210,255'));
paint('poolRed', 128, 128, (c, w, h) => pool(c, w, h, '255,50,40'));
paint('exitSign', 192, 72, (c, w, h) => {
  c.fillStyle = '#060a06';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#4dff8a';
  c.font = `900 56px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('EXIT', w / 2, 56);
});

/** Weathered print helper for signs: paper grain and fading. */
export function weather(c: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  grime(c, w, h, amount, seed);
}
