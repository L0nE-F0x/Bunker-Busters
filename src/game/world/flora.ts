import * as THREE from 'three/webgpu';
import { mulberry32 } from '@/engine/noise';

/**
 * Desert plants, procedurally: dead cottonwoods, Joshua trees, and the shrubs between them (creosote,
 * sagebrush, dead brush, prickly pear, barrel cactus, yucca, ocotillo, mesquite). Every generator
 * writes into a `Plant` builder: indexed triangles with a position, a normal and an `fColor` (rgb +
 * the material kind floraMaterial() shades by). Two levels of detail per plant: 'hi' close up,
 * 'lo' for distance and for shadows.
 */

export type Lod = 'hi' | 'lo';
type RGB = [number, number, number];

/** material kinds (fColor.a) */
export const DEAD = 0, FUR = 0.2, BARK = 0.33, LEAF = 0.66, CACTUS = 1;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const jit = (c: RGB, r: () => number, k = 0.1): RGB => {
  const f = 1 + (r() - 0.5) * 2 * k;
  return [c[0] * f, c[1] * f, c[2] * f];
};

/** Indexed triangle soup with per-vertex colour + kind. */
export class Plant {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count() { return this.pos.length / 3; }
  /** `c` is authored in sRGB (like a colour picker); the attribute holds linear values. */
  vert(p: THREE.Vector3, c: RGB, kind: number) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2), kind);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }

  /**
   * A generalised cylinder along `pts` with radius r[i] (parallel-transport frames, so bends don't
   * twist). Ends in a point when the last radius is 0. `col(t)` colours by position along it.
   */
  tube(pts: THREE.Vector3[], r: number[], radial: number, col: (t: number) => RGB, kind: number) {
    const n = pts.length;
    const tan = (i: number) => pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    let t0 = tan(0);
    let nrm = Math.abs(t0.y) < 0.9 ? V(0, 1, 0).cross(t0).normalize() : V(1, 0, 0).cross(t0).normalize();
    const rings: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = tan(i);
      // parallel transport: rotate the normal by the change in tangent
      const ax = t0.clone().cross(t);
      const s = ax.length();
      if (s > 1e-5) nrm.applyAxisAngle(ax.normalize(), Math.asin(Math.min(1, s)));
      t0 = t;
      const bin = t.clone().cross(nrm).normalize();
      nrm = bin.clone().cross(t).normalize();
      const c = col(i / (n - 1));
      rings.push(this.count);
      if (r[i] <= 1e-4) { this.vert(pts[i], c, kind); continue; }
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        this.vert(pts[i].clone().addScaledVector(nrm, Math.cos(a) * r[i]).addScaledVector(bin, Math.sin(a) * r[i]), c, kind);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a0 = rings[i], b0 = rings[i + 1];
      const tip = r[i + 1] <= 1e-4;
      for (let j = 0; j < radial; j++) {
        const j1 = (j + 1) % radial;
        if (tip) this.tri(a0 + j, a0 + j1, b0);
        else { this.tri(a0 + j, a0 + j1, b0 + j); this.tri(a0 + j1, b0 + j1, b0 + j); }
      }
    }
  }

  /** A narrow three-sided spike (a leaf blade that reads from every side). */
  spike(base: THREE.Vector3, dir: THREE.Vector3, len: number, w: number, c: RGB, tipC: RGB, kind: number) {
    const d = dir.clone().normalize();
    const u = Math.abs(d.y) < 0.9 ? V(0, 1, 0).cross(d).normalize() : V(1, 0, 0).cross(d).normalize();
    const v = d.clone().cross(u);
    const i0 = this.count;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      this.vert(base.clone().addScaledVector(u, Math.cos(a) * w).addScaledVector(v, Math.sin(a) * w * 0.45), c, kind);
    }
    const tip = this.vert(base.clone().addScaledVector(d, len), tipC, kind);
    this.tri(i0, i0 + 1, tip); this.tri(i0 + 1, i0 + 2, tip); this.tri(i0 + 2, i0, tip);
  }

  /** A lumpy blob (leaf clump, fruit, pad): an icosphere scaled by `s`, nudged by `bump`. */
  blob(c0: THREE.Vector3, s: THREE.Vector3, detail: number, c: RGB, kind: number, r: () => number, bump = 0.2, rot?: THREE.Quaternion) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const src = g.attributes.position as THREE.BufferAttribute;
    // PolyhedronGeometry is unindexed: weld by rounding so the blob shades smooth
    const map = new Map<string, number>();
    const ids: number[] = [];
    for (let i = 0; i < src.count; i++) {
      const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let id = map.get(key);
      if (id === undefined) {
        const p = V(x, y, z).multiplyScalar(1 + (r() - 0.5) * bump).multiply(s);
        if (rot) p.applyQuaternion(rot);
        id = this.vert(p.add(c0), c, kind);
        map.set(key, id);
      }
      ids.push(id);
    }
    for (let i = 0; i < ids.length; i += 3) this.tri(ids[i], ids[i + 1], ids[i + 2]);
    g.dispose();
  }

  /** A tiny leaf cluster: a flattened octahedron (8 triangles), randomly turned. */
  leaf(at: THREE.Vector3, size: number, c: RGB, r: () => number, flat = 0.35) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.3, r() * 6.3, r() * 6.3));
    const ax = [V(size, 0, 0), V(0, size * flat, 0), V(0, 0, size * 0.7)].map((v) => v.applyQuaternion(q));
    const i0 = this.count;
    for (const a of ax) { this.vert(at.clone().add(a), c, LEAF); this.vert(at.clone().sub(a), c, LEAF); }
    // +x 0, −x 1, +y 2, −y 3, +z 4, −z 5
    const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    for (const [a, b, c2] of f) this.tri(i0 + a, i0 + b, i0 + c2);
  }

  /** Copy another plant in, transformed. */
  add(o: Plant, m: THREE.Matrix4) {
    const base = this.count, v = new THREE.Vector3();
    for (let i = 0; i < o.pos.length; i += 3) {
      v.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
    }
    this.col.push(...o.col);
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** Packed arrays with smooth normals. */
  pack() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const col = new Uint8Array(this.col.length);
    for (let i = 0; i < col.length; i++) col[i] = Math.max(0, Math.min(255, Math.round(this.col[i] * 255)));
    return {
      pos: new Float32Array(this.pos),
      nrm: g.attributes.normal.array as Float32Array,
      col,
      idx: new Uint32Array(this.idx),
    };
  }

  geometry() {
    const p = this.pack();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
    g.setAttribute('fColor', new THREE.BufferAttribute(p.col, 4, true));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ helpers

/** A wandering polyline from `start` along `dir`: `segs` steps, each nudged by `wobble`, pulled by `pull`. */
function wander(r: () => number, start: THREE.Vector3, dir: THREE.Vector3, len: number, segs: number, wobble: number, pull = V(0, 0, 0)) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 0; i < segs; i++) {
    d.add(V((r() - 0.5) * wobble, (r() - 0.5) * wobble, (r() - 0.5) * wobble)).add(pull).normalize();
    p.addScaledVector(d, len / segs);
    pts.push(p.clone());
  }
  return { pts, end: d };
}

const taper = (n: number, r0: number, r1: number) => Array.from({ length: n }, (_, i) => lerp(r0, r1, i / (n - 1)));

/** A random direction tilted `tilt` rad from `axis`. */
function cone(r: () => number, axis: THREE.Vector3, tilt: number) {
  const a = axis.clone().normalize();
  const u = Math.abs(a.y) < 0.9 ? V(0, 1, 0).cross(a).normalize() : V(1, 0, 0).cross(a).normalize();
  const v = a.clone().cross(u);
  const phi = r() * Math.PI * 2;
  return a.multiplyScalar(Math.cos(tilt)).addScaledVector(u, Math.sin(tilt) * Math.cos(phi)).addScaledVector(v, Math.sin(tilt) * Math.sin(phi)).normalize();
}

// ------------------------------------------------------------------ trees

const BARK_DEAD: RGB = [0.42, 0.37, 0.32];
const WOOD_BLEACH: RGB = [0.7, 0.67, 0.62];

/**
 * A dead cottonwood: a gnarled trunk on a flared root plate, limbs that leave along its length (not
 * all at the top), branches thinning to twigs that bleached silver long ago.
 */
export function deadTree(seed: number, lod: Lod) {
  const r = mulberry32(seed);
  const P = new Plant();
  const hi = lod === 'hi';
  const bark = jit(BARK_DEAD, r, 0.12);
  const colAt = (rad: number) => (t: number) => mixC(bark, WOOD_BLEACH, Math.min(1, Math.max(0, 1 - rad / 0.12)) * 0.8 + t * 0.1);
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, depth: number) => {
    if (!hi && r0 < 0.035) return;
    const segs = Math.max(2, Math.round(len / (hi ? 0.3 : 0.6)));
    const { pts, end } = wander(r, start, dir, len, segs, depth > 2 ? 0.35 : 0.55, V(0, depth > 1 ? 0.04 : -0.02, 0));
    const r1 = r0 * (depth > 0 ? 0.55 : 0.2);
    const radial = hi ? (r0 > 0.12 ? 9 : r0 > 0.05 ? 6 : r0 > 0.02 ? 4 : 3) : r0 > 0.1 ? 5 : 3;
    P.tube(pts, taper(pts.length, r0, depth > 0 ? r1 : 0), radial, colAt(r0), DEAD);
    if (depth <= 0) return;
    const kids = depth >= 3 ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2.6);
    for (let k = 0; k < kids; k++) {
      const last = k === kids - 1;
      const t = last ? 1 : 0.35 + r() * 0.55;
      const i = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
      const rr = lerp(r0, r1, i / (pts.length - 1));
      const out = V(r() - 0.5, 0, r() - 0.5).normalize();
      const nd = (last ? end.clone() : end.clone().multiplyScalar(0.5).addScaledVector(out, 0.9).add(V(0, 0.35, 0))).normalize();
      grow(pts[i], cone(r, nd, last ? 0.35 : 0.25), len * (0.55 + r() * 0.25), rr * (last ? 0.9 : 0.72), depth - 1);
    }
    // a few bare twigs off the thin limbs
    if (hi && depth === 1) {
      for (let k = 0; k < 3; k++) {
        const i = 1 + Math.floor(r() * (pts.length - 1));
        const tw = wander(r, pts[Math.min(i, pts.length - 1)], cone(r, end, 0.8), 0.25 + r() * 0.35, 2, 0.6);
        P.tube(tw.pts, taper(tw.pts.length, 0.009, 0), 3, () => WOOD_BLEACH, DEAD);
      }
    }
  };
  const tr = 0.17 + r() * 0.14;
  grow(V(0, -0.3, 0), V((r() - 0.5) * 0.35, 1, (r() - 0.5) * 0.35), 2.0 + r() * 1.6, tr, 4);
  // root flare: thick roots running out and into the sand
  const roots = hi ? 5 : 3;
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * Math.PI * 2 + r() * 0.8;
    const d = V(Math.cos(a), -0.35 - r() * 0.3, Math.sin(a));
    const { pts } = wander(r, V(0, 0.32, 0), d, 0.9 + r() * 0.6, hi ? 4 : 2, 0.3, V(0, -0.06, 0));
    P.tube(pts, taper(pts.length, tr * 0.75, tr * 0.2), hi ? 6 : 4, colAt(tr), DEAD);
  }
  return P;
}

/**
 * A Joshua tree: a shaggy trunk in a skirt of dead leaves, arms that fork and curve up, each ending
 * in a spiky rosette of live leaves with a beard of dead ones hanging under it.
 */
export function joshuaTree(seed: number, lod: Lod) {
  const r = mulberry32(seed);
  const P = new Plant();
  const hi = lod === 'hi';
  const bark: RGB = jit([0.44, 0.37, 0.3], r, 0.1);
  const dead: RGB = [0.5, 0.43, 0.33], deadTip: RGB = [0.6, 0.53, 0.42];
  const live: RGB = jit([0.4, 0.48, 0.24], r, 0.1), liveTip: RGB = [0.62, 0.63, 0.36];
  const shag = (pts: THREE.Vector3[], rad: number) => {
    if (!hi) return;
    for (let i = 1; i < pts.length; i++) {
      const per = Math.ceil(pts[i].distanceTo(pts[i - 1]) * 30);
      for (let k = 0; k < per; k++) {
        const p = pts[i - 1].clone().lerp(pts[i], r());
        const out = V(r() - 0.5, 0, r() - 0.5).normalize();
        P.spike(p.addScaledVector(out, rad * 0.85), out.multiplyScalar(0.45 + r() * 0.4).add(V(0, -1, 0)), 0.16 + r() * 0.14, 0.03, dead, deadTip, BARK);
      }
    }
  };
  const rosette = (at: THREE.Vector3, up: THREE.Vector3) => {
    const n = hi ? 90 : 16;
    for (let k = 0; k < n; k++) {
      const d = cone(r, up, Math.acos(1 - r() * 1.7));
      P.spike(at.clone().addScaledVector(d, 0.04), d, (hi ? 0.26 : 0.34) + r() * 0.12, hi ? 0.022 : 0.05, live, liveTip, LEAF);
    }
    if (hi) for (let k = 0; k < 24; k++) {
      const out = V(r() - 0.5, 0, r() - 0.5).normalize();
      P.spike(at.clone().addScaledVector(out, 0.07).add(V(0, -0.06, 0)), out.multiplyScalar(0.5).add(V(0, -1, 0)), 0.24 + r() * 0.12, 0.025, dead, deadTip, BARK);
    }
    if (!hi) P.blob(at, V(0.26, 0.24, 0.26), 0, live, LEAF, r);
  };
  const arm = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const { pts, end } = wander(r, start, dir, len, hi ? 4 : 2, 0.25, V(0, 0.18, 0));
    P.tube(pts, taper(pts.length, rad, rad * 0.8), hi ? 7 : 4, () => bark, BARK);
    shag(pts, rad);
    const tip = pts[pts.length - 1];
    if (depth > 0 && r() < 0.8) {
      const kids = 2;
      for (let k = 0; k < kids; k++) {
        const out = V(r() - 0.5, 0, r() - 0.5).normalize();
        arm(tip, end.clone().multiplyScalar(0.4).addScaledVector(out, 0.8).add(V(0, 0.3, 0)), len * (0.6 + r() * 0.3), rad * 0.82, depth - 1);
      }
    } else rosette(tip, end);
  };
  const H = 1.3 + r() * 1.4, tr = 0.15 + r() * 0.08;
  const { pts, end } = wander(r, V(0, -0.2, 0), V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), H, hi ? 5 : 2, 0.12);
  P.tube(pts, taper(pts.length, tr * 1.25, tr), hi ? 8 : 5, () => bark, BARK);
  shag(pts, tr);
  const top = pts[pts.length - 1];
  const arms = 2 + Math.floor(r() * 2);
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2 + r();
    arm(top, V(Math.cos(a), 0.6 + r() * 0.6, Math.sin(a)).add(end.clone().multiplyScalar(0.3)), 0.7 + r() * 0.8, tr * 0.8, r() < 0.6 ? 1 : 0);
  }
  return P;
}

// ------------------------------------------------------------------ shrubs

export type Shrub = 'creosote' | 'sage' | 'deadbrush' | 'pear' | 'barrel' | 'yucca' | 'ocotillo' | 'mesquite';
export const SHRUBS: Shrub[] = ['creosote', 'sage', 'deadbrush', 'pear', 'barrel', 'yucca', 'ocotillo', 'mesquite'];

const STEM: RGB = [0.33, 0.27, 0.22];

export function shrub(kind: Shrub, seed: number, lod: Lod): Plant {
  const r = mulberry32(seed);
  const P = new Plant();
  const hi = lod === 'hi';
  switch (kind) {
    case 'creosote': {
      // a fountain of thin dark stems with small olive leaf clumps toward their tips
      const leaf = jit([0.36, 0.42, 0.2], r, 0.12), leaf2: RGB = [0.48, 0.5, 0.26];
      const stems = hi ? 12 + Math.floor(r() * 6) : 0;
      for (let k = 0; k < stems; k++) {
        const base = V((r() - 0.5) * 0.25, -0.05, (r() - 0.5) * 0.25);
        const { pts } = wander(r, base, cone(r, V(0, 1, 0), 0.25 + r() * 0.45), 0.7 + r() * 0.7, 3, 0.25);
        P.tube(pts, taper(pts.length, 0.014, 0.004), 3, () => STEM, DEAD);
        for (let i = 1; i < pts.length; i++) for (let j = 0; j < 6; j++) {
          const at = pts[i - 1].clone().lerp(pts[i], r()).add(V((r() - 0.5) * 0.09, 0, (r() - 0.5) * 0.09));
          P.leaf(at, 0.028 + r() * 0.02, mixC(leaf, leaf2, r()), r, 0.25);
        }
      }
      if (!hi) for (let k = 0; k < 4; k++) P.blob(V((r() - 0.5) * 0.4, 0.45 + r() * 0.35, (r() - 0.5) * 0.4), V(0.3, 0.26, 0.3), 0, mixC(leaf, leaf2, r()), LEAF, r, 0.35);
      break;
    }
    case 'sage': {
      // a dense grey-green dome
      const c0 = jit([0.46, 0.5, 0.4], r, 0.08), c1: RGB = [0.58, 0.6, 0.5];
      const n = hi ? 34 : 4;
      if (hi) for (let k = 0; k < 6; k++) {
        const { pts } = wander(r, V((r() - 0.5) * 0.15, -0.05, (r() - 0.5) * 0.15), cone(r, V(0, 1, 0), 0.6), 0.4, 2, 0.4);
        P.tube(pts, taper(pts.length, 0.02, 0.008), 3, () => STEM, DEAD);
      }
      // a dome of fine leaves (hi) or a few soft lumps (lo)
      for (let k = 0; k < (hi ? 110 : n); k++) {
        const a = r() * Math.PI * 2, u = Math.sqrt(r()), rad = u * 0.46;
        const h = 0.06 + Math.sqrt(Math.max(0, 1 - u * u)) * 0.42 * (0.75 + r() * 0.35);
        const at = V(Math.cos(a) * rad, h, Math.sin(a) * rad);
        if (hi) {
          // silvery needle tufts
          const up = at.clone().setY(at.y + 0.25).normalize();
          const c = mixC(c0, c1, r());
          for (let j = 0; j < 3; j++) P.spike(at, cone(r, up, 0.9), 0.07 + r() * 0.05, 0.012, c, mixC(c, [0.7, 0.72, 0.62], 0.5), LEAF);
        }
        else P.blob(at, V(0.28, 0.22, 0.28), 1, mixC(c0, c1, r()), LEAF, r, 0.45);
      }
      break;
    }
    case 'deadbrush': {
      const grey: RGB = jit([0.5, 0.45, 0.39], r, 0.12);
      const twig = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
        const { pts, end } = wander(r, start, dir, len, hi ? 3 : 2, 0.6);
        P.tube(pts, taper(pts.length, rad, depth ? rad * 0.6 : 0), 3, () => grey, DEAD);
        if (depth <= 0 || (!hi && depth < 2)) return;
        for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
          const i = 1 + Math.floor(r() * (pts.length - 1));
          twig(pts[i], cone(r, end, 0.7), len * 0.6, rad * 0.65, depth - 1);
        }
      };
      for (let k = 0; k < (hi ? 6 : 3); k++) twig(V((r() - 0.5) * 0.2, -0.05, (r() - 0.5) * 0.2), cone(r, V(0, 1, 0), 0.3 + r() * 0.6), 0.5 + r() * 0.4, 0.018, 2);
      break;
    }
    case 'pear': {
      // prickly pear: flat pads on pads, a few magenta fruit on the rims
      const g: RGB = jit([0.38, 0.5, 0.26], r, 0.1), stress: RGB = [0.5, 0.4, 0.42];
      const pad = (at: THREE.Vector3, up: THREE.Vector3, size: number, depth: number) => {
        const face = V(r() - 0.5, 0, r() - 0.5).normalize();
        const u = up.clone().normalize();
        // orient: pad's long axis (y) along `up`, its flat side facing `face`
        const z = face.clone().sub(u.clone().multiplyScalar(face.dot(u))).normalize();
        const x = u.clone().cross(z);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, u, z));
        const c = at.clone().addScaledVector(u, size * 0.9);
        P.blob(c, V(size * 0.78, size, size * 0.17), hi ? 1 : 0, mixC(g, stress, r() * r() * 0.7), CACTUS, r, 0.06, q);
        if (depth <= 0) {
          if (hi && r() < 0.5) for (let k = 0; k < 3; k++) P.blob(c.clone().addScaledVector(u, size * 0.95).addScaledVector(x, (k - 1) * size * 0.4), V(0.035, 0.05, 0.035), 0, [0.66, 0.16, 0.34], CACTUS, r, 0.1);
          return;
        }
        const kids = 1 + Math.floor(r() * 2);
        for (let k = 0; k < kids; k++) {
          const tip = c.clone().addScaledVector(u, size * 0.85).addScaledVector(x, (r() - 0.5) * size);
          pad(tip, cone(r, u.clone().add(V(0, 0.6, 0)), 0.5), size * (0.8 + r() * 0.2), depth - 1);
        }
      };
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) pad(V((r() - 0.5) * 0.3, -0.04, (r() - 0.5) * 0.3), cone(r, V(0, 1, 0), 0.4), 0.17 + r() * 0.05, 2);
      break;
    }
    case 'barrel': {
      // a ribbed barrel, domed, with a crown of yellow flowers or fruit
      const H = 0.35 + r() * 0.45, R = 0.2 + r() * 0.1, ribs = 18 + 2 * Math.floor(r() * 3);
      const radial = hi ? ribs * 2 : 12, rows = hi ? 8 : 4;
      const g: RGB = jit([0.4, 0.5, 0.28], r, 0.08), rib: RGB = [0.66, 0.58, 0.4];
      const start = P.count;
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const prof = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 2))) * (0.85 + 0.15 * Math.sin(t * Math.PI));
        for (let j = 0; j < radial; j++) {
          const a = (j / radial) * Math.PI * 2;
          const rr = R * prof * (1 + (hi ? 0.07 * Math.cos(a * ribs) : 0));
          const c = hi && Math.cos(a * ribs) > 0.7 ? mixC(g, rib, 0.5) : g;
          P.vert(V(Math.cos(a) * rr, t * H - 0.05, Math.sin(a) * rr), c, CACTUS);
        }
      }
      for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
        const a = start + i * radial + j, b = start + i * radial + ((j + 1) % radial);
        P.tri(a, b + radial, b); P.tri(a, a + radial, b + radial);
      }
      const top = P.vert(V(0, H - 0.04, 0), g, CACTUS);
      for (let j = 0; j < radial; j++) P.tri(start + rows * radial + j, top, start + rows * radial + ((j + 1) % radial));
      if (hi) {
        const fl: RGB = r() < 0.5 ? [0.93, 0.78, 0.3] : [0.85, 0.42, 0.25];
        for (let k = 0; k < 7; k++) {
          const a = r() * Math.PI * 2;
          P.blob(V(Math.cos(a) * R * 0.35, H - 0.02, Math.sin(a) * R * 0.35), V(0.035, 0.03, 0.035), 0, fl, LEAF, r, 0.3);
        }
      }
      break;
    }
    case 'yucca': {
      // a rosette of stiff blue-green blades on a short stem, a skirt of dead ones, maybe a seed stalk
      const g: RGB = jit([0.42, 0.5, 0.38], r, 0.08), tipC: RGB = [0.62, 0.6, 0.42];
      const dead: RGB = [0.5, 0.43, 0.33];
      const at = V(0, 0.12 + r() * 0.2, 0);
      const n = hi ? 52 : 14;
      for (let k = 0; k < n; k++) {
        const d = cone(r, V(0, 1, 0), Math.acos(1 - r() * 1.4));
        P.spike(at.clone(), d, (hi ? 0.45 : 0.5) + r() * 0.25, hi ? 0.035 : 0.06, g, tipC, LEAF);
      }
      if (hi) for (let k = 0; k < 16; k++) {
        const out = V(r() - 0.5, 0, r() - 0.5).normalize();
        P.spike(at.clone().addScaledVector(out, 0.04), out.multiplyScalar(0.9).add(V(0, -0.5, 0)), 0.35 + r() * 0.15, 0.02, dead, dead, BARK);
      }
      P.tube([V(0, -0.1, 0), at], [0.07, 0.06], hi ? 6 : 4, () => dead, BARK);
      if (r() < 0.4) {
        const { pts } = wander(r, at, V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), 1.1 + r() * 0.6, 4, 0.08);
        P.tube(pts, taper(pts.length, 0.018, 0.008), hi ? 4 : 3, () => [0.55, 0.47, 0.35], DEAD);
        if (hi) for (let i = 2; i < pts.length; i++) for (let k = 0; k < 3; k++) {
          const out = V(r() - 0.5, -0.3, r() - 0.5).normalize();
          P.blob(pts[i].clone().addScaledVector(out, 0.06), V(0.03, 0.045, 0.03), 0, [0.52, 0.42, 0.3], DEAD, r, 0.2);
        }
      }
      break;
    }
    case 'ocotillo': {
      // whips: long thin canes fanning out from one crown, red flower tips on some
      const cane: RGB = jit([0.42, 0.38, 0.3], r, 0.1);
      const n = hi ? 11 + Math.floor(r() * 7) : 7;
      for (let k = 0; k < n; k++) {
        const { pts } = wander(r, V((r() - 0.5) * 0.15, -0.05, (r() - 0.5) * 0.15), cone(r, V(0, 1, 0), 0.12 + r() * 0.35), 2 + r() * 1.6, hi ? 6 : 3, 0.1, V(0, 0.01, 0));
        P.tube(pts, taper(pts.length, 0.03, 0.01), hi ? 4 : 3, (t) => mixC(cane, [0.48, 0.5, 0.3], t * 0.4), BARK);
        if (hi && r() < 0.4) P.blob(pts[pts.length - 1], V(0.03, 0.12, 0.03), 0, [0.9, 0.36, 0.2], LEAF, r, 0.2);
      }
      break;
    }
    case 'mesquite': {
      // a low, spreading shrub-tree with feathery green clumps: what grows where water once ran
      const bark: RGB = [0.32, 0.26, 0.21];
      const leaf = jit([0.36, 0.45, 0.2], r, 0.1), leaf2: RGB = [0.46, 0.52, 0.24];
      const limb = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
        const { pts, end } = wander(r, start, dir, len, hi ? 3 : 2, 0.45, V(0, -0.02, 0));
        P.tube(pts, taper(pts.length, rad, rad * 0.6), hi ? 5 : 3, () => bark, BARK);
        if (depth > 0) {
          for (let k = 0; k < 2; k++) limb(pts[pts.length - 1], cone(r, end.clone().add(V(0, 0.2, 0)), 0.6), len * 0.7, rad * 0.65, depth - 1);
        } else {
          const tip = pts[pts.length - 1];
          if (!hi) P.blob(tip, V(0.42, 0.24, 0.42), 0, mixC(leaf, leaf2, r()), LEAF, r, 0.4);
          else for (let k = 0; k < 24; k++) P.leaf(tip.clone().add(V((r() - 0.5) * 0.6, (r() - 0.3) * 0.25, (r() - 0.5) * 0.6)), 0.05 + r() * 0.035, mixC(leaf, leaf2, r()), r, 0.3);
        }
      };
      for (let k = 0; k < 3 + Math.floor(r() * 2); k++) limb(V((r() - 0.5) * 0.2, -0.1, (r() - 0.5) * 0.2), cone(r, V(0, 1, 0), 0.5 + r() * 0.35), 0.8 + r() * 0.5, 0.05, 2);
      break;
    }
  }
  return P;
}
