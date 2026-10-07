import * as THREE from 'three/webgpu';
import { Simplex2, mulberry32 } from '@/engine/noise';
import type { Heightfield } from './Heightfield';
import { shrub, SHRUBS, type Shrub, type Lod } from './flora';
import { floraMaterial } from './materials';

/** Scatter grid (m): every cell's plants are a pure function of the cell. */
const CELL = 16;
/** Plants nearer than this are drawn at full detail (and cast shadows); the rest at low detail. */
const NEAR = 38;
const FAR = 135;
/** Re-gather after this much travel (m). */
const STEP = 8;
const VARIANTS = 3;

interface Packed { pos: Float32Array; nrm: Float32Array; col: Uint8Array; idx: Uint32Array }
interface Inst { kind: Shrub; v: number; x: number; y: number; z: number; yaw: number; s: number }

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One growing buffer set drawn as a single mesh. */
class Stream {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private nrm: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private idx: THREE.BufferAttribute;
  constructor(name: string, verts: number, tris: number, shadow: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.nrm = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.col = new THREE.BufferAttribute(new Uint8Array(verts * 4), 4, true);
    this.idx = new THREE.BufferAttribute(new Uint32Array(tris * 3), 1);
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', this.nrm);
    g.setAttribute('fColor', this.col);
    g.setIndex(this.idx);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), FAR + CELL * 2);
    this.mesh = new THREE.Mesh(g, floraMaterial());
    this.mesh.name = name;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
  }
  get vCap() { return this.pos.count; }
  get iCap() { return this.idx.count; }
  fill(cells: Packed[], center: THREE.Vector3) {
    let v = 0, i = 0;
    const P = this.pos.array as Float32Array, N = this.nrm.array as Float32Array, C = this.col.array as Uint8Array, I = this.idx.array as Uint32Array;
    for (const c of cells) {
      const nv = c.pos.length / 3;
      if (v + nv > this.vCap || i + c.idx.length > this.iCap) break;
      P.set(c.pos, v * 3);
      N.set(c.nrm, v * 3);
      C.set(c.col, v * 4);
      for (let k = 0; k < c.idx.length; k++) I[i + k] = c.idx[k] + v;
      v += nv;
      i += c.idx.length;
    }
    for (const [a, n] of [[this.pos, 3], [this.nrm, 3], [this.col, 4]] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, v * n);
      a.needsUpdate = true;
    }
    this.idx.clearUpdateRanges();
    this.idx.addUpdateRange(0, i);
    this.idx.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, i);
    this.mesh.geometry.boundingSphere!.center.copy(center);
    this.mesh.visible = i > 0;
    return { v, i };
  }
}

/**
 * Desert shrubs and cacti streamed around the player: creosote and sage on the flats, cacti, yucca
 * and ocotillo on the stony slopes, dead brush everywhere, mesquite down in the wash. Two draws in
 * all: full detail within NEAR (it casts the shadows), low detail out to FAR.
 */
export class Shrubs {
  readonly group = new THREE.Group();
  private near: Stream;
  private far: Stream;
  private parts = new Map<Shrub, Record<Lod, Packed[]>>();
  private cells = new Map<number, Inst[]>();
  private baked = new Map<string, Packed>();
  private at = new THREE.Vector2(1e9, 1e9);
  private noise = new Simplex2(9191);

  constructor(private hf: Heightfield, private density = 1) {
    for (const k of SHRUBS) {
      const rec: Record<Lod, Packed[]> = { hi: [], lo: [] };
      for (let v = 0; v < VARIANTS; v++) for (const lod of ['hi', 'lo'] as const) rec[lod].push(shrub(k, 1000 + SHRUBS.indexOf(k) * 31 + v * 7, lod).pack());
      this.parts.set(k, rec);
    }
    this.near = new Stream('shrubsNear', 260_000, 300_000, true);
    this.far = new Stream('shrubsFar', 160_000, 220_000, false);
    this.group.name = 'shrubs';
    this.group.add(this.near.mesh, this.far.mesh);
  }

  private key(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }

  /** The plants of grid cell (ix, iz). Deterministic. */
  private cell(ix: number, iz: number) {
    const key = this.key(ix, iz);
    const hit = this.cells.get(key);
    if (hit) return hit;
    const r = mulberry32((ix * 73856093) ^ (iz * 19349663) ^ 0x5eed);
    const out: Inst[] = [];
    const lim = this.hf.size * 0.47;
    for (let k = 0; k < 7; k++) {
      const x = (ix + r()) * CELL, z = (iz + r()) * CELL;
      const pick = r(), sz = r(), yaw = r() * Math.PI * 2, keep = r(), vv = r();
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      const cluster = this.noise.fbm(x * 0.012, z * 0.012, 2) * 0.5 + 0.5;
      if (keep > (0.12 + cluster * 0.55) * this.density) continue;
      if (this.hf.roadDistanceAt(x, z) < 6.5 || this.hf.zoneDistance(x, z) < 2) continue;
      const ny = this.hf.normalAt(x, z).y;
      if (ny < 0.72) continue;
      const y = this.hf.heightAt(x, z);
      const moist = smooth(-1.5, -5.5, y);
      const stony = smooth(0.97, 0.85, ny);
      const w: [Shrub, number][] = [
        ['creosote', 3 * (1 - moist) * (1 - stony * 0.5)],
        ['sage', 2 * (1 - moist) * (1 - stony)],
        ['deadbrush', 1.4],
        ['pear', 0.35 + stony * 1.2],
        ['barrel', 0.15 + stony * 0.9],
        ['yucca', 0.6 + stony * 0.4],
        ['ocotillo', 0.15 + stony * 0.9],
        ['mesquite', moist * 4.5],
      ];
      let sum = 0;
      for (const [, v] of w) sum += v;
      let t = pick * sum, kind: Shrub = 'deadbrush';
      for (const [kk, v] of w) { if ((t -= v) <= 0) { kind = kk; break; } }
      out.push({ kind, v: Math.floor(vv * VARIANTS), x, y: y - 0.03, z, yaw, s: 0.75 + sz * 0.6 });
    }
    this.cells.set(key, out);
    return out;
  }

  /** A cell's plants merged into one packed set at `lod`. Cached. */
  private bake(ix: number, iz: number, lod: Lod) {
    const k = `${this.key(ix, iz)}:${lod}`;
    const hit = this.baked.get(k);
    if (hit) { this.baked.delete(k); this.baked.set(k, hit); return hit; } // LRU touch
    const insts = this.cell(ix, iz);
    let nv = 0, ni = 0;
    const src = insts.map((s) => this.parts.get(s.kind)![lod][s.v]);
    for (const p of src) { nv += p.pos.length / 3; ni += p.idx.length; }
    const out: Packed = { pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), col: new Uint8Array(nv * 4), idx: new Uint32Array(ni) };
    let v = 0, i = 0;
    insts.forEach((s, n) => {
      const p = src[n];
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      for (let a = 0; a < p.pos.length; a += 3) {
        const x = p.pos[a], y = p.pos[a + 1], z = p.pos[a + 2];
        out.pos[v * 3 + a] = s.x + (x * c + z * sn) * s.s;
        out.pos[v * 3 + a + 1] = s.y + y * s.s;
        out.pos[v * 3 + a + 2] = s.z + (-x * sn + z * c) * s.s;
        const nx = p.nrm[a], nz = p.nrm[a + 2];
        out.nrm[v * 3 + a] = nx * c + nz * sn;
        out.nrm[v * 3 + a + 1] = p.nrm[a + 1];
        out.nrm[v * 3 + a + 2] = -nx * sn + nz * c;
      }
      out.col.set(p.col, v * 4);
      for (let a = 0; a < p.idx.length; a++) out.idx[i + a] = p.idx[a] + v;
      v += p.pos.length / 3;
      i += p.idx.length;
    });
    this.baked.set(k, out);
    if (this.baked.size > 900) this.baked.delete(this.baked.keys().next().value!);
    return out;
  }

  update(focus: THREE.Vector3) {
    if (Math.hypot(focus.x - this.at.x, focus.z - this.at.y) < STEP) return;
    this.at.set(focus.x, focus.z);
    if (this.cells.size > 20000) this.cells.clear();
    const near: Packed[] = [], far: [number, Packed][] = [];
    const r = Math.ceil(FAR / CELL) + 1;
    const cx = Math.floor(focus.x / CELL), cz = Math.floor(focus.z / CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const ix = cx + i, iz = cz + j;
      // the cell's centre decides its detail, so near and far never overlap or leave a gap
      const d = Math.hypot((ix + 0.5) * CELL - focus.x, (iz + 0.5) * CELL - focus.z);
      if (d > FAR) continue;
      if (d < NEAR) near.push(this.bake(ix, iz, 'hi'));
      else far.push([d, this.bake(ix, iz, 'lo')]);
    }
    far.sort((a, b) => a[0] - b[0]);
    this.near.fill(near, focus);
    this.far.fill(far.map((f) => f[1]), focus);
  }
}
