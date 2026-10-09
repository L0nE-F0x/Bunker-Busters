import * as THREE from 'three/webgpu';
import { attribute, positionWorld, normalWorld, vec2, vec3, float, mix, smoothstep, abs } from 'three/tsl';
import type { Physics } from '@/engine/physics';
import { noise } from '@/engine/noiseTex';
import type { Frame } from '@/game/world/kit';
import { bumpFromHeight } from '@/game/world/Terrain';
import { glow, wood, plainStandard, fabric } from '@/game/world/materials';
import type { Hooks } from './creek';
import { Site, V, HALO } from './townKit';
import { M, rnd, reseed, crate, drum, lantern, sack, log } from './townProps';
import { LOOKS } from './people';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
type Col = ReturnType<Physics['addBox']>;

/**
 * The Cut: a rock outcrop on the ridge with a chamber in it, sculpted as a signed distance field
 * (a smooth union of noisy ellipsoids for the mass, minus a smooth union for the chamber, the mouth
 * tunnel and the side pocket) and meshed with surface nets. Every vertex gets an occlusion term by
 * marching rays through the same field, so the inside is dark where the sky cannot see it and the
 * fire and the mouth do the lighting. The collider is the same triangle mesh: what you see is what
 * you walk on, with no invisible walls.
 *
 * Local frame: the mouth faces −Z (down the wash), the chamber runs toward +Z into the ridge.
 */

// ---------------------------------------------------------------- noise
function h3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vn(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  ) * 2 - 1;
}
function fbm(x: number, y: number, z: number, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vn(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 4.7) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) =>
  (Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Chamber floor height (gentle: the controller walks it). */
const floorY = (x: number, z: number) => 0.05 + 0.07 * (vn(x * 0.45, 3.1, z * 0.45) * 0.5 + 0.5) + Math.max(0, z - 7.5) * 0.04;

/** Negative inside rock. */
export function caveField(x: number, y: number, z: number) {
  // the mass: a craggy outcrop with ledges
  let m = ell(x, y, z, 0.5, 2.6, 8.0, 11.0, 9.0, 10.5);
  m = smin(m, ell(x, y, z, 0, 3.4, 0.2, 6.6, 3.8, 4.4), 2.2);
  m = smin(m, ell(x, y, z, -7.6, 1.0, 3.5, 4.6, 4.2, 7.2), 2.4);
  m = smin(m, ell(x, y, z, 8.2, 1.4, 4.6, 5.0, 4.6, 6.2), 2.4);
  m = smin(m, ell(x, y, z, -3.5, 3.8, 16.5, 9.5, 8.0, 7.0), 2.8);
  m = smin(m, ell(x, y, z, 4.5, 2.0, 17.0, 6.0, 5.0, 5.5), 2.4);
  const n1 = fbm(x * 0.16, y * 0.16, z * 0.16, 3);
  const n2 = fbm(x * 0.55, y * 0.55, z * 0.55, 2);
  const band = y * 0.85 + n1 * 1.6;
  const st = band - Math.floor(band);
  const strata = st * st * (3 - 2 * st) * 0.3;
  m += n1 * 1.8 + n2 * 0.5 - strata;
  // the hollow: chamber, mouth, the pocket and the neck to it
  let v = ell(x, y, z, 0, 1.7, 5.0, 5.4, 3.9, 5.2);
  v = smin(v, ell(x, y, z, 0, 1.2, -1.2, 2.35, 2.5, 3.8), 1.3);
  v = smin(v, ell(x, y, z, 7.6, 1.3, 3.4, 2.3, 2.4, 2.4), 1.0);
  v = smin(v, ell(x, y, z, 5.6, 1.15, 3.35, 1.7, 1.95, 1.5), 0.9);
  v += fbm(x * 0.6 + 3, y * 0.6, z * 0.6, 2) * 0.32;
  v = Math.max(v, floorY(x, z) - y);
  return Math.max(m, -v);
}

// ---------------------------------------------------------------- surface nets
interface Grid { nx: number; ny: number; nz: number; x0: number; y0: number; z0: number; s: number; f: Float32Array }

function sampleGrid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, s: number): Grid {
  const nx = Math.ceil((x1 - x0) / s) + 1, ny = Math.ceil((y1 - y0) / s) + 1, nz = Math.ceil((z1 - z0) / s) + 1;
  const f = new Float32Array(nx * ny * nz);
  let i = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let ii = 0; ii < nx; ii++) f[i++] = caveField(x0 + ii * s, y0 + j * s, z0 + k * s);
  return { nx, ny, nz, x0, y0, z0, s, f };
}

/** Trilinear lookup (outside the grid counts as open air). */
function at(g: Grid, x: number, y: number, z: number) {
  const fx = (x - g.x0) / g.s, fy = (y - g.y0) / g.s, fz = (z - g.z0) / g.s;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= g.nx - 1 || fy >= g.ny - 1 || fz >= g.nz - 1) return 1;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const u = fx - i, v = fy - j, w = fz - k;
  const id = (a: number, b: number, c: number) => g.f[(c * g.ny + b) * g.nx + a];
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(id(i, j, k), id(i + 1, j, k), u), l(id(i, j + 1, k), id(i + 1, j + 1, k), u), v),
    l(l(id(i, j, k + 1), id(i + 1, j, k + 1), u), l(id(i, j + 1, k + 1), id(i + 1, j + 1, k + 1), u), v),
    w,
  );
}

function surfaceNets(g: Grid) {
  const { nx, ny, nz, f } = g;
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corners[c]; val[c] = f[idx(i + a, j + b, k + d)]; if (val[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const v0 = val[e0], v1 = val[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      const c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t;
      n++;
    }
    cellVert[cid(i, j, k)] = pos.length / 3;
    pos.push(g.x0 + (i + sx / n) * g.s, g.y0 + (j + sy / n) * g.s, g.z0 + (k + sz / n) * g.s);
  }
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = f[idx(i, j, k)], b = f[idx(i + 1, j, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], a >= 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = f[idx(i, j, k)], b = f[idx(i, j + 1, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], a >= 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = f[idx(i, j, k)], b = f[idx(i, j, k + 1)];
    if ((a < 0) === (b < 0)) continue;
    quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], a >= 0);
  }
  return { pos, tris };
}

/** Laplacian smoothing over the mesh graph: keeps the facets, loses the voxel stair-steps. */
function smooth(pos: number[], tris: number[], iters: number, k: number) {
  const n = pos.length / 3;
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const next = new Float32Array(pos.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0;
      const set = nb[i];
      if (!set.size) { next[i * 3] = pos[i * 3]; next[i * 3 + 1] = pos[i * 3 + 1]; next[i * 3 + 2] = pos[i * 3 + 2]; continue; }
      for (const j of set) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; }
      const m = 1 / set.size;
      next[i * 3] = pos[i * 3] + (sx * m - pos[i * 3]) * k;
      next[i * 3 + 1] = pos[i * 3 + 1] + (sy * m - pos[i * 3 + 1]) * k;
      next[i * 3 + 2] = pos[i * 3 + 2] + (sz * m - pos[i * 3 + 2]) * k;
    }
    for (let i = 0; i < pos.length; i++) pos[i] = next[i];
  }
}

const grad = (g: Grid, x: number, y: number, z: number, out: THREE.Vector3) => {
  const e = g.s * 0.5;
  return out.set(at(g, x + e, y, z) - at(g, x - e, y, z), at(g, x, y + e, z) - at(g, x, y - e, z), at(g, x, y, z + e) - at(g, x, y, z - e)).normalize();
};

/** Fixed cosine-ish hemisphere directions around +Y. */
const DIRS = (() => {
  const out: THREE.Vector3[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const r = Math.sqrt(t), a = i * 2.39996;
    out.push(new THREE.Vector3(Math.cos(a) * r, Math.sqrt(1 - t), Math.sin(a) * r));
  }
  return out;
})();

/** Sky visibility in 0..1 by marching the grid. */
function occlusion(g: Grid, p: THREE.Vector3, n: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const d = new THREE.Vector3();
  let open = 0;
  for (const dir of DIRS) {
    d.copy(dir).applyQuaternion(q);
    let hit = false;
    for (let t = 0.35; t < 14; t *= 1.18) {
      const x = p.x + d.x * t, y = p.y + d.y * t, z = p.z + d.z * t;
      if (y < -0.25 || at(g, x, y, z) < 0) { hit = true; break; }
    }
    if (!hit) open += Math.max(0.2, d.y + 0.3);
  }
  let total = 0;
  for (const dir of DIRS) total += Math.max(0.2, dir.y + 0.3);
  return open / total;
}

let _caveMat: THREE.MeshStandardNodeMaterial | null = null;
/** Shared rock for the shell and the rubble: strata like the world's rocks, tint + AO per vertex. */
export function caveMaterial() {
  if (_caveMat) return _caveMat;
  // smooth-shaded: the surface-nets facets read as low-poly; the strata and bump carry the detail
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
  const c: N = attribute('cCol', 'vec4');
  const p: N = positionWorld;
  const n: N = noise(vec2(p.x.add(p.z).mul(0.12), p.y.mul(0.12).add(p.z.mul(0.05)))).r.sub(0.5).mul(2);
  const fine: N = noise(vec2(p.x.sub(p.z).mul(0.9), p.y.mul(0.9))).g;
  // the ridge's own sediment stack (Terrain's rock bands, same world-height layers), so the outcrop
  // reads as a piece of the cliff it sits on: rust and umber layers, pale bands, varnish streaks
  const along: N = p.x.add(p.z);
  const strataN: N = noise(p.xz.div(90)).r.sub(0.5).mul(5);
  const layer: N = noise(vec2(p.y.div(11).add(strataN.mul(0.12)), along.div(520))).r;
  const layerFine: N = noise(vec2(p.y.div(2.6).add(strataN.mul(0.3)), along.div(240)).add(0.37)).g;
  const bands: N = smoothstep(0.3, 0.7, layer);
  const pale: N = smoothstep(0.6, 0.78, layerFine);
  const varnish: N = smoothstep(0.5, 0.78, noise(vec2(along.mul(0.22), p.y.mul(0.018)).add(0.53)).r).mul(smoothstep(0.6, 0.2, abs(normalWorld.y)));
  const strata: N = layerFine;
  const top: N = smoothstep(0.55, 0.9, normalWorld.y);
  const base: N = mix(mix(vec3(0.3, 0.15, 0.09), vec3(0.58, 0.33, 0.18), bands), vec3(0.72, 0.54, 0.38), pale.mul(0.55))
    .mul(float(0.8).add(n.mul(0.2)).add(fine.mul(0.14)))
    .mul(float(1).sub(varnish.mul(0.45)));
  const dusty: N = mix(base, vec3(0.74, 0.56, 0.4), top.mul(0.55));
  m.colorNode = dusty.mul(c.xyz);
  m.aoNode = c.w;
  m.normalNode = bumpFromHeight(n.add(strata.mul(0.45)).add(fine.mul(0.25)), float(0.06));
  _caveMat = m;
  return m;
}

interface ShellOut { geo: THREE.BufferGeometry; collider: Col }

/** Builds the shell (rendered + collided) and returns the grid so props can be placed against it. */
function shell(physics: Physics, f: Frame, extra: (g: Grid) => THREE.BufferGeometry[]): ShellOut & { grid: Grid } {
  const g = sampleGrid(-13.5, 15, -2.5, 13.5, -7.5, 25.5, 0.5);
  const { pos, tris } = surfaceNets(g);
  smooth(pos, tris, 2, 0.5);
  // drop faces fully underground (outside the chamber the terrain covers them)
  const keep: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const y0 = pos[tris[i] * 3 + 1], y1 = pos[tris[i + 1] * 3 + 1], y2 = pos[tris[i + 2] * 3 + 1];
    if (Math.max(y0, y1, y2) < -0.6) continue;
    keep.push(tris[i], tris[i + 1], tris[i + 2]);
  }
  // per-vertex tint + occlusion
  const nV = pos.length / 3;
  const col = new Float32Array(nV * 4);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const soot = new THREE.Vector3(-1.6, 3.4, 4.6);
  for (let i = 0; i < nV; i++) {
    p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    grad(g, p.x, p.y, p.z, n);
    const vis = occlusion(g, p, n);
    const ao = 0.16 + 0.84 * Math.pow(vis, 0.8);
    // inside surfaces are cooler and darker; soot blooms over the cookfire
    const inside = 1 - Math.min(1, vis * 2.2);
    const s = Math.max(0, 1 - p.distanceTo(soot) / 2.6);
    const k = (1 - 0.25 * inside) * (1 - 0.75 * s * s);
    const warm = 0.94 + 0.06 * vn(p.x * 0.3, p.y * 0.3, p.z * 0.3);
    col.set([k * warm, k * (0.97 + 0.03 * inside), k * (0.95 + 0.07 * inside), ao], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('cCol', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(keep);
  geo.computeVertexNormals();
  // collider: the same triangles, in world space
  const R = physics.R;
  const verts = new Float32Array(pos.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < nV; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(f.m); verts.set([v.x, v.y, v.z], i * 3); }
  const desc = R.ColliderDesc.trimesh(verts, new Uint32Array(keep), R.TriMeshFlags.FIX_INTERNAL_EDGES);
  const collider = physics.world.createCollider(desc!);
  // stalactites and rubble share the shell's material and attributes
  const parts = extra(g);
  const merged = mergeWithCol(geo, parts);
  return { geo: merged, collider, grid: g };
}

/** Appends extra geometries (each with a cCol attribute) to the shell as one non-indexed geometry. */
function mergeWithCol(base: THREE.BufferGeometry, parts: THREE.BufferGeometry[]) {
  const all = [base.toNonIndexed(), ...parts.map((p) => (p.index ? p.toNonIndexed() : p))];
  let n = 0;
  for (const g of all) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), C = new Float32Array(n * 4), Nn = new Float32Array(n * 3);
  let o = 0;
  for (const g of all) {
    if (!g.attributes.normal) g.computeVertexNormals();
    P.set(g.attributes.position.array as Float32Array, o * 3);
    Nn.set(g.attributes.normal.array as Float32Array, o * 3);
    C.set(g.attributes.cCol.array as Float32Array, o * 4);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  out.setAttribute('cCol', new THREE.BufferAttribute(C, 4));
  out.computeBoundingSphere();
  return out;
}

/** A rock piece with uniform tint/AO baked into cCol. */
function rockPiece(g: THREE.BufferGeometry, tint: number, ao: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) c.set([tint, tint * 0.98, tint * 0.96, ao], i * 4);
  geo.setAttribute('cCol', new THREE.BufferAttribute(c, 4));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'cCol'].includes(k)) geo.deleteAttribute(k);
  geo.computeVertexNormals();
  return geo;
}

function boulder(r: number, x: number, y: number, z: number, sy = 0.7, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + vn(vx * 2.1 + seed, vy * 2.1, vz * 2.1 - seed) * 0.28;
    p.setXYZ(i, vx * k, vy * k * sy, vz * k);
  }
  g.rotateY(seed * 1.7);
  g.translate(x, y, z);
  return g;
}

/** March straight up from (x, y, z) to the first rock; returns the hit height or null. */
function ceilingAt(g: Grid, x: number, y: number, z: number) {
  for (let t = y; t < y + 7; t += 0.05) if (at(g, x, t, z) < 0) return t;
  return null;
}

/** March from p along d to the first rock; returns the hit point. */
function hitAlong(g: Grid, p: THREE.Vector3, d: THREE.Vector3) {
  for (let t = 0; t < 8; t += 0.04) {
    const q = p.clone().addScaledVector(d, t);
    if (at(g, q.x, q.y, q.z) < 0) return q;
  }
  return null;
}

export interface CaveOut { shell: THREE.Mesh; far: THREE.Mesh; rockfall: THREE.Object3D; fire: [number, number, number] }

/**
 * Builds The Cut into `S` (Wick's camp, lights, decals) and returns the shell meshes. The rockfall
 * blocker is registered through `H.blocker('rockfall', …)`.
 */
export function buildCut(S: Site, H: Hooks, physics: Physics, f: Frame): CaveOut {
  reseed(31337);
  const out = shell(physics, f, (g) => {
    const parts: THREE.BufferGeometry[] = [];
    // stalactites: clusters hanging from the chamber ceiling
    for (let i = 0; i < 34; i++) {
      const x = -4.2 + rnd() * 8.4, z = 1.2 + rnd() * 8.4;
      if (Math.hypot(x / 5, (z - 5) / 5) > 0.9) continue;
      const top = ceilingAt(g, x, 2.0, z);
      if (top == null || top < 2.6) continue;
      const len = 0.25 + rnd() * rnd() * 1.1;
      const r = 0.05 + len * 0.12;
      const c = new THREE.ConeGeometry(r, len, 5, 1);
      c.rotateX(Math.PI);
      c.translate(x, top - len / 2 + 0.05, z);
      parts.push(rockPiece(c, 0.85, 0.16));
    }
    // a few stalagmites and rubble along the walls (kept off the walking line)
    for (const [x, z, r] of [[-4.6, 2.2, 0.4], [-4.3, 8.4, 0.5], [3.9, 8.6, 0.45], [4.4, 1.0, 0.3], [-1.0, 9.4, 0.5], [2.4, 9.3, 0.35]] as const) {
      parts.push(rockPiece(boulder(r, x, r * 0.35, z, 0.65, x + z), 0.9, 0.3));
    }
    for (const [x, z, h] of [[-3.9, 9.0, 0.7], [3.5, 9.4, 0.5]] as const) {
      const c = new THREE.ConeGeometry(0.16, h, 5, 1);
      c.translate(x, h / 2, z);
      parts.push(rockPiece(c, 0.85, 0.25));
    }
    // a sitting stone by the mouth (the view), fallen slabs outside it
    parts.push(rockPiece(boulder(0.45, -1.6, 0.18, -1.4, 0.55, 9.1), 1.0, 0.6));
    for (const [x, z, r] of [[-3.8, -4.6, 0.8], [3.6, -4.9, 0.9], [-5.2, -2.6, 0.6], [5.5, -3.0, 0.55], [2.0, -7.0, 0.4]] as const) {
      parts.push(rockPiece(boulder(r, x, r * 0.3, z, 0.6, x * 3 + z), 1.0, 0.75));
    }
    return parts;
  });
  for (const [x, z, r] of [[-3.8, -4.6, 0.8], [3.6, -4.9, 0.9], [-5.2, -2.6, 0.6], [5.5, -3.0, 0.55]] as const) S.col(x, r * 0.3, z, r * 0.75, r * 0.45, r * 0.75);
  for (const [x, z, r] of [[-4.6, 2.2, 0.4], [-4.3, 8.4, 0.5], [3.9, 8.6, 0.45], [-1.0, 9.4, 0.5], [2.4, 9.3, 0.35]] as const) S.col(x, r * 0.3, z, r * 0.7, r * 0.4, r * 0.7);
  const mat = caveMaterial();
  const mesh = new THREE.Mesh(out.geo, mat);
  mesh.name = 'cave-shell';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  S.root.add(mesh);
  const far = new THREE.Mesh(out.geo, plainStandard('#8a6a52', 0.95, 0, { flatShading: true }));
  far.name = 'cave-far';
  const g = out.grid;

  // ---- the rockfall that seals the side pocket (a blocker: one mesh, one collider)
  const fall = new THREE.Group();
  {
    const pieces: THREE.BufferGeometry[] = [];
    for (const [x, y, z, r] of [[5.3, 0.55, 2.4, 0.75], [5.5, 0.6, 3.5, 0.85], [5.2, 0.55, 4.5, 0.7], [5.4, 1.45, 3.0, 0.62], [5.3, 1.5, 4.0, 0.6], [5.5, 2.25, 3.5, 0.55], [4.6, 0.3, 3.1, 0.4], [4.7, 0.25, 4.3, 0.35], [5.6, 2.7, 2.8, 0.4]] as const) {
      pieces.push(rockPiece(boulder(r, x, y, z, 0.8, x * 7 + z * 3 + y), 0.92, 0.35));
    }
    const geo = mergeWithCol(pieces[0], pieces.slice(1));
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    fall.add(m);
  }
  S.root.add(fall);
  const fallCol = S.col(5.35, 1.6, 3.35, 0.85, 1.6, 1.7);
  H.blocker('rockfall', fall, fallCol);

  // ---- Wick's camp: bedroll, cookfire, pots on a line, a radio, water jugs, a lantern
  const P = S.pen();
  const fire: [number, number, number] = [-1.6, floorY(-1.6, 4.6), 4.6];
  const wick = { x: -2.65, z: 6.0 };
  const wy = Math.atan2(fire[0] - wick.x, fire[2] - wick.z);
  const fy = (x: number, z: number) => floorY(x, z);
  P.box(M.canvas(), 0.85, 0.06, 2.0, -4.15, fy(-4.15, 7.2) + 0.03, 7.2, 0.15).box(M.blanketOlive(), 0.8, 0.07, 1.3, -4.1, fy(-4.1, 7.0) + 0.09, 6.9, 0.18, 0.04);
  P.put(M.sheet(), new THREE.SphereGeometry(0.24, 10, 6), -4.35, fy(-4.35, 8.1) + 0.12, 8.1, 0, 0.2, 0, 1, 0.36, 0.62);
  P.put(M.blanketRed(), new THREE.CylinderGeometry(0.16, 0.16, 0.8, 10), -3.6, fy(-3.6, 8.6) + 0.16, 8.6, 0, 0.2, Math.PI / 2);
  // log seat for Wick, facing the fire and the mouth beyond it
  log(P, wick.x - Math.sin(wy) * 0.05, wick.z - Math.cos(wy) * 0.05, 1.4, wy, 0.2);
  H.npc({ id: 'wick', look: LOOKS.wick, pose: 'warm', x: wick.x, y: fy(wick.x, wick.z), z: wick.z, yaw: wy, seat: 0.4, notice: 6 });
  H.spot('wick', wick.x, fy(wick.x, wick.z) + 1.0, wick.z);
  // night calls: once Wick has Doc's medkit, Doc walks up the wash to check on him after midnight (content/routines.ts)
  const doc = { x: -0.45, z: 5.35 };
  H.npc({ id: 'doc', look: LOOKS.doc, pose: 'clipboard', x: doc.x, y: fy(doc.x, doc.z), z: doc.z, yaw: Math.atan2(wick.x - doc.x, wick.z - doc.z), notice: 5, station: 'doc.cut', alt: true });
  S.col(wick.x + Math.sin(wy) * 0.25, 0.6, wick.z + Math.cos(wy) * 0.25, 0.3, 0.6, 0.3, wy);
  // a rope strung wall to wall with pots and a ladle
  {
    const a = hitAlong(g, V(-1.6, 2.6, 4.6), V(-1, 0.15, 0.1).normalize()) ?? V(-4.5, 2.8, 4.9);
    const b = hitAlong(g, V(-1.6, 2.6, 4.6), V(1, 0.15, -0.1).normalize()) ?? V(2.5, 2.8, 4.3);
    P.wire(M.burlap(), a, b, 0.35, 0.012, 16);
    const len = a.distanceTo(b);
    for (const [t, kind] of [[0.36, 0], [0.47, 1], [0.6, 0], [0.7, 2]] as const) {
      const q = a.clone().lerp(b, t);
      q.y -= 0.35 * 4 * t * (1 - t);
      const iron = M.black();
      P.beam(M.steelDark(), q, q.clone().add(V(0, -0.2, 0)), 0.005, 3);
      if (kind === 0) P.cyl(iron, 0.13, 0.11, 0.16, q.x, q.y - 0.3, q.z, 10).put(M.steelDark(), new THREE.TorusGeometry(0.13, 0.006, 4, 10, Math.PI), q.x, q.y - 0.2, q.z);
      if (kind === 1) P.cyl(M.drumBlue(), 0.08, 0.1, 0.18, q.x, q.y - 0.31, q.z, 10).put(M.drumBlue(), new THREE.ConeGeometry(0.03, 0.09, 6), q.x + 0.09, q.y - 0.27, q.z, 0, 0, -1.1);
      if (kind === 2) P.beam(M.galv(), q.clone().add(V(0, -0.2, 0)), q.clone().add(V(0, -0.55, 0)), 0.008, 4).cyl(M.galv(), 0.04, 0.03, 0.03, q.x, q.y - 0.57, q.z, 8);
      void len;
    }
  }
  // spit over the fire
  for (const s of [-1, 1]) P.beam(M.woodDark(), V(fire[0] + s * 0.55, fire[1], fire[2] - 0.05), V(fire[0] + s * 0.5, fire[1] + 0.7, fire[2]), 0.02, 4);
  P.beam(M.steelDark(), V(fire[0] - 0.6, fire[1] + 0.66, fire[2]), V(fire[0] + 0.6, fire[1] + 0.66, fire[2]), 0.01, 4);
  P.cyl(M.black(), 0.12, 0.1, 0.14, fire[0], fire[1] + 0.48, fire[2], 10);
  // crate table: radio, a lantern, tins; water jugs stacked by the wall; firewood; sacks
  crate(P, -4.0, fy(-4.0, 5.2), 5.2, 0.6, 0.48, 0.5, 0.3, M.woodPale(), true);
  {
    const R = S.pen(-4.0, fy(-4.0, 5.2) + 0.48, 5.2, 0.3);
    R.box(M.steelDark(), 0.34, 0.2, 0.15, 0.05, 0.1, 0).box(M.galv(), 0.26, 0.1, 0.01, 0.05, 0.12, 0.08).cyl(M.chrome(), 0.004, 0.004, 0.5, 0.18, 0.45, -0.03, 4, 0.2);
    const led = glow('#7aff9a', 2.2);
    R.box(led.material, 0.02, 0.02, 0.01, -0.07, 0.15, 0.08);
    const c = R.p(-0.07, 0.15, 0.09);
    S.halo(c.x, c.y, c.z, '#7aff9a', 0.16, HALO.ON, 1.6);
    const lg = S.nightGlow('#ffc070', 1.4, 3.5);
    lantern(R, -0.18, 0.24, 0.0, lg);
    const lc = R.p(-0.18, 0.14, 0);
    S.halo(lc.x, lc.y, lc.z, '#ffc070', 0.55, HALO.ON, 1.4);
    S.light(lc.x, lc.y + 0.3, lc.z, 0xffb060, 3.5, 7, 1.6);
    H.audio('radio', -4.0, 1.0, 5.2);
  }
  for (let i = 0; i < 7; i++) {
    const x = -4.25 + (i % 3) * 0.33 + (Math.floor(i / 3) % 2) * 0.16, y = fy(-4.0, 2.9) + Math.floor(i / 3) * 0.37, z = 2.9 + (i % 2) * 0.05;
    P.box(plainStandard('#2a5d8f', 0.45, 0), 0.3, 0.36, 0.26, x, y + 0.18, z, 0.1 * (i % 3)).cyl(plainStandard('#d8d0b8', 0.5), 0.035, 0.035, 0.05, x + 0.06, y + 0.38, z, 6);
  }
  P.col(-3.95, 0.55, 2.9, 0.55, 0.55, 0.2);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) P.cyl(wood('#5a3e28'), 0.07, 0.07, 0.65, -0.6 + i * 0.15 + r * 0.075, fy(0, 8.9) + 0.07 + r * 0.13, 8.9, 6, 0, 0.1, Math.PI / 2);
  P.col(-0.2, 0.25, 8.9, 0.5, 0.25, 0.35);
  sack(P, 1.6, fy(1.6, 8.6), 8.6, 0.4);
  sack(P, 2.1, fy(2.1, 8.4), 8.4, 1.4);
  drum(P, 3.4, 7.4, M.drumBlue(), 0.5, false, fy(3.4, 7.4), true);
  // light pools, soot on the floor, a worn path in from the mouth
  S.pool('poolFire', 4.5, 4.5, fire[0], fire[1] + 0.03, fire[2]);
  S.floorDecal('soot', 2.2, 2.2, fire[0], fire[1] + 0.025, fire[2], 0.4);
  for (const [z, w] of [[-3.5, 2.2], [-1.0, 2.0], [1.6, 1.9]] as const) S.floorDecal('path', w, 2.8, 0.1 * z, fy(0, z) + 0.03, z, 0);
  // the paint on the pocket wall, revealed when the fall goes
  {
    const o = V(7.4, 1.5, 3.4);
    const hit = hitAlong(g, o, V(1, 0, 0));
    if (hit) S.decal('note', 1.2, 0.6, hit.x - 0.04, hit.y, hit.z, -Math.PI / 2);
    crate(P, 7.6, fy(7.6, 3.9), 3.9, 0.7, 0.5, 0.55, 0.4, M.woodDark(), true);
    P.box(M.canvas(), 0.6, 0.02, 0.5, 7.6, fy(7.6, 3.9) + 0.51, 3.9, 0.4);
  }
  H.spot('mouth', 0, 0.25, -6.0);
  H.spot('caveIn', 0, floorY(0, 3.5) + 0.2, 3.5);
  H.spot('rock', 3.6, 1.15, 3.35);
  H.spot('pocket', 7.4, 1.0, 3.4);
  H.audio('drip', 7.6, 2.0, 3.4);
  H.audio('drip', 2.0, 3.0, 8.5);
  H.audio('wind-hollow', 0, 1.6, -1.0);
  void fabric;
  return { shell: mesh, far, rockfall: fall, fire };
}
