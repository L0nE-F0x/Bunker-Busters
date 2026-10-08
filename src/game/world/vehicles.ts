import * as THREE from 'three/webgpu';
import { norm, merge } from './kit';
import { carPaint, carGlass, rustyMetal, plainStandard, fabric } from './materials';

/**
 * Wrecked 60s/70s American cars, built procedurally at close-up quality. One builder serves every
 * place a car stands (the highway, Dry Creek, the data centre, the drive-in), so they all share the
 * same few materials and merge into each caller's batch.
 *
 * The body is a loft: a rounded-box cross-section (superellipse with tumblehome, a crease and a tucked
 * rocker) swept along the car, with the wheel arches pushed into its lower edge. The greenhouse is a
 * set of patches (windshield, sides, rear glass, roof) whose cells are glass or paint, so the pillars
 * and window frames fall out of the same surface. Detail on top: bumpers, grille, lights, trim, door
 * seams, handles, mirror, plates, real tyres and steel wheels, an interior, an engine bay under an
 * open hood, and a chassis that only shows when the car is on its roof.
 *
 * Authored with the nose toward +x, ground at y = 0, driver on −z.
 */

export type CarKind = 'sedan' | 'coupe' | 'wagon' | 'pickup' | 'van' | 'convertible';
export type WheelState = 'ok' | 'flat' | 'gone';

export interface CarSink { add(mat: THREE.Material, ...g: THREE.BufferGeometry[]): unknown }

export interface CarOpts {
  kind: CarKind;
  paint: THREE.ColorRepresentation;
  rand: () => number;
  rust?: number;
  fade?: number;
  burnt?: boolean;
  /** chance each pane is gone (default 0.35) */
  broken?: number;
  hood?: 'shut' | 'open' | 'gone';
  /** FL FR RL RR (default: random, mostly ok) */
  wheels?: WheelState[];
  /** resting on blocks instead of wheels */
  blocks?: boolean;
  /** small parts that shouldn't cast shadows (trim, seams, nuts); defaults to the main sink */
  thin?: CarSink;
}

export interface CarResult {
  /** collider half extents and centre in the car's frame (before `m`) */
  half: THREE.Vector3;
  center: THREE.Vector3;
  /** a coarse hull for the shadow pass (already transformed by `m`) */
  shadow: THREE.BufferGeometry;
}

interface Spec {
  L: number; W: number; wf: number; wr: number; R: number; sill: number;
  nose: number; cowl: number; belt: number; deck: number; tail: number;
  /** windshield base, roof front, roof back, rear glass base (x) */
  xa: number; xr0: number; xr1: number; xc: number; roof: number;
  /** side window layout along the greenhouse: [s0, s1, kind] with 'g' glass and 'p' paint */
  side: [number, number, 'g' | 'p'][];
  /** door seams (x) */
  doors: number[];
  bedX?: number;
}

const SPECS: Record<CarKind, Spec> = {
  sedan: {
    L: 5.25, W: 1.98, wf: 1.52, wr: -1.48, R: 0.34, sill: 0.3, nose: 0.86, cowl: 0.97, belt: 1.0, deck: 1.0, tail: 0.94,
    xa: 0.82, xr0: 0.12, xr1: -0.92, xc: -1.38, roof: 1.42,
    side: [[0, 0.035, 'p'], [0.035, 0.46, 'g'], [0.46, 0.52, 'p'], [0.52, 0.8, 'g'], [0.8, 1, 'p']],
    doors: [0.78, -0.3, -1.33],
  },
  coupe: {
    L: 5.1, W: 1.95, wf: 1.58, wr: -1.38, R: 0.34, sill: 0.3, nose: 0.84, cowl: 0.95, belt: 0.98, deck: 0.97, tail: 0.93,
    xa: 0.66, xr0: -0.08, xr1: -0.88, xc: -1.7,
    roof: 1.34,
    side: [[0, 0.035, 'p'], [0.035, 0.56, 'g'], [0.56, 0.6, 'p'], [0.6, 0.78, 'g'], [0.78, 1, 'p']],
    doors: [0.62, -0.62],
  },
  wagon: {
    L: 5.45, W: 2.0, wf: 1.6, wr: -1.52, R: 0.35, sill: 0.31, nose: 0.88, cowl: 0.99, belt: 1.02, deck: 1.02, tail: 1.0,
    xa: 0.95, xr0: 0.22, xr1: -2.5, xc: -2.62, roof: 1.46,
    side: [[0, 0.025, 'p'], [0.025, 0.3, 'g'], [0.3, 0.34, 'p'], [0.34, 0.6, 'g'], [0.6, 0.635, 'p'], [0.635, 0.97, 'g'], [0.97, 1, 'p']],
    doors: [0.9, -0.18, -1.15],
  },
  pickup: {
    L: 5.3, W: 1.98, wf: 1.68, wr: -1.6, R: 0.37, sill: 0.38, nose: 1.0, cowl: 1.06, belt: 1.08, deck: 1.08, tail: 1.08,
    xa: 0.98, xr0: 0.55, xr1: -0.34, xc: -0.4, roof: 1.72,
    side: [[0, 0.05, 'p'], [0.05, 0.86, 'g'], [0.86, 1, 'p']],
    doors: [0.94, -0.36],
    bedX: -0.5,
  },
  van: {
    L: 4.8, W: 2.0, wf: 1.62, wr: -1.36, R: 0.36, sill: 0.36, nose: 0.98, cowl: 1.08, belt: 1.12, deck: 1.12, tail: 1.1,
    xa: 1.42, xr0: 1.02, xr1: -2.32, xc: -2.36, roof: 2.0,
    side: [[0, 0.03, 'p'], [0.03, 0.2, 'g'], [0.2, 0.23, 'p'], [0.23, 0.42, 'p'], [0.42, 0.62, 'g'], [0.62, 1, 'p']],
    doors: [1.36, 0.42, -0.86],
  },
  convertible: {
    L: 5.3, W: 1.98, wf: 1.55, wr: -1.48, R: 0.34, sill: 0.3, nose: 0.85, cowl: 0.96, belt: 0.98, deck: 0.98, tail: 0.94,
    xa: 0.72, xr0: 0.45, xr1: 0.45, xc: -1.25, roof: 1.25,
    side: [[0, 1, 'p']],
    doors: [0.68, -0.9],
  },
};

const ss = (a: number, b: number, x: number) => {
  if (a === b) return x >= a ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The car's body section as functions of x: bottom, top, half width, superellipse exponent. */
class Body {
  readonly n = 6;
  constructor(readonly s: Spec) {}
  top(x: number) {
    const { L, xa, xc, nose, cowl, belt, deck, tail, bedX } = this.s;
    if (bedX !== undefined && x < bedX) return belt;
    // the hood falls from the belt at the windshield to the nose, a little faster near the front
    if (x >= xa) return lerp(belt, nose, Math.pow((x - xa) / (L / 2 - xa), 1.5)) + (cowl - belt) * 0;
    if (x >= xc) return belt;
    return lerp(deck, tail, ss(xc, -L / 2, x));
  }
  bottom(x: number) {
    const { wf, wr, R, sill } = this.s;
    return sill + Math.max(0, x - (wf + R + 0.2)) * 0.2 + Math.max(0, (wr - R - 0.2) - x) * 0.16;
  }
  hw(x: number) {
    const { L, W } = this.s;
    return (W / 2) * (1 - 0.05 * ss(0.8, 1, Math.abs(x) / (L / 2)));
  }
  /** end rounding: the last few cm of each end shrink toward the section's centre */
  endScale(x: number) {
    const e = 0.11, d = this.s.L / 2 - Math.abs(x);
    if (d >= e) return 1;
    const u = 1 - d / e;
    return 0.86 + 0.14 * Math.sqrt(Math.max(0, 1 - u * u));
  }
  /** side shaping by height fraction: tumblehome above, a crease, a tucked rocker below */
  shape(t: number) {
    return 1 - 0.075 * Math.pow(ss(0.5, 1, t), 1.5) - 0.06 * (1 - ss(0, 0.32, t)) + 0.012 * Math.exp(-(((t - 0.66) / 0.05) ** 2));
  }
  /** arch: lifts points of the outer 0.5 m out of each wheel's circle */
  arch(x: number, y: number, z: number, hw: number) {
    if (Math.abs(z) < hw - 0.5) return y;
    const { wf, wr, R } = this.s;
    for (const wx of [wf, wr]) {
      const ar = R + 0.075, dx = x - wx;
      if (Math.abs(dx) >= ar) continue;
      const top = R + Math.sqrt(ar * ar - dx * dx);
      if (y < top) y = top;
    }
    return y;
  }
  point(x: number, theta: number) {
    const b = this.bottom(x), t = this.top(x), hw = this.hw(x), es = this.endScale(x);
    const yc = (b + t) / 2, hh = (t - b) / 2;
    const c = Math.cos(theta), s = Math.sin(theta), e = 2 / this.n;
    let z = hw * Math.sign(c) * Math.pow(Math.abs(c), e);
    let y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), e);
    z *= this.shape((y - b) / (t - b));
    z *= es;
    y = yc + (y - yc) * es;
    y = this.arch(x, y, z, hw);
    return V(x, y, z);
  }
  /** outer z of the side at height y (no arch), for trim that follows the body */
  sideZ(x: number, y: number) {
    const b = this.bottom(x), t = this.top(x), hw = this.hw(x);
    const yc = (b + t) / 2, hh = (t - b) / 2;
    const u = Math.min(0.999, Math.abs((y - yc) / hh));
    return hw * Math.pow(1 - Math.pow(u, this.n), 1 / this.n) * this.shape((y - b) / (t - b)) * this.endScale(x);
  }
  /** y of the top surface at (x, z) */
  topY(x: number, z: number) {
    const b = this.bottom(x), t = this.top(x), hw = this.hw(x) * this.endScale(x);
    const yc = (b + t) / 2, hh = (t - b) / 2;
    const u = Math.min(0.999, Math.abs(z / hw));
    return yc + hh * Math.pow(1 - Math.pow(u, this.n), 1 / this.n);
  }
  archTop(x: number) {
    let top = 0;
    const { wf, wr, R } = this.s;
    for (const wx of [wf, wr]) {
      const ar = R + 0.075, dx = x - wx;
      if (Math.abs(dx) < ar) top = Math.max(top, R + Math.sqrt(ar * ar - dx * dx));
    }
    return top;
  }
}

/** Grid surface → one geometry per material key (null cells are skipped). Normals are smooth across keys. */
function gridSurface(
  rows: THREE.Vector3[][], closed: boolean,
  key: (i: number, j: number) => string | null,
  uvOf?: (i: number, j: number) => [number, number],
  flip = false,
) {
  const nu = rows.length, nv = rows[0].length;
  const pos = new Float32Array(nu * nv * 3), uvs = new Float32Array(nu * nv * 2);
  rows.forEach((r, i) => r.forEach((p, j) => {
    pos.set([p.x, p.y, p.z], (i * nv + j) * 3);
    if (uvOf) uvs.set(uvOf(i, j), (i * nv + j) * 2);
  }));
  const all: number[] = [];
  const by = new Map<string, number[]>();
  const jm = closed ? nv : nv - 1;
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < jm; j++) {
      const a = i * nv + j, b = (i + 1) * nv + j, c = (i + 1) * nv + ((j + 1) % nv), d = i * nv + ((j + 1) % nv);
      const tri = flip ? [a, d, b, b, d, c] : [a, b, d, b, c, d];
      all.push(...tri);
      const k = key(i, j);
      if (k === null) continue;
      let arr = by.get(k);
      if (!arr) by.set(k, (arr = []));
      arr.push(...tri);
    }
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  base.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  base.setIndex(all);
  base.computeVertexNormals();
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [k, idx] of by) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('uv', base.attributes.uv);
    g.setIndex(idx);
    out.set(k, g.toNonIndexed());
  }
  return out;
}

/** Bilinear patch p00→p10 (s) by p00→p01 (t), split at sBreaks × tBreaks; `cell` names each cell's key. */
function patch(
  c: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  sb: number[], tb: number[],
  cell: (si: number, ti: number) => string | null,
  deform?: (p: THREE.Vector3) => void,
  sub = 1,
) {
  const [p00, p10, p01, p11] = c;
  const at = (s: number, t: number) => {
    const p = p00.clone().lerp(p10, s).lerp(p01.clone().lerp(p11, s), t);
    deform?.(p);
    return p;
  };
  const out = new Map<string, THREE.BufferGeometry[]>();
  for (let si = 0; si < sb.length - 1; si++) {
    for (let ti = 0; ti < tb.length - 1; ti++) {
      const k = cell(si, ti);
      if (k === null) continue;
      const rows: THREE.Vector3[][] = [];
      for (let a = 0; a <= sub; a++) {
        const s = lerp(sb[si], sb[si + 1], a / sub);
        const r: THREE.Vector3[] = [];
        for (let b = 0; b <= sub; b++) r.push(at(s, lerp(tb[ti], tb[ti + 1], b / sub)));
        rows.push(r);
      }
      // s × t points into the car for every patch as authored, so the winding is flipped
      const g = gridSurface(rows, false, () => 'x', (i, j) => [i / sub, j / sub], true).get('x')!;
      let arr = out.get(k);
      if (!arr) out.set(k, (arr = []));
      arr.push(g);
    }
  }
  return out;
}

/** A thin strip through points (offset along their outward normals) of width w, perpendicular to `across`. */
function ribbon(pts: THREE.Vector3[], across: THREE.Vector3, w: number) {
  const rows = pts.map((p) => [p.clone().addScaledVector(across, -w / 2), p.clone().addScaledVector(across, w / 2)]);
  return gridSurface(rows, false, () => 'x').get('x')!;
}

/** Turn a surface inside out (reverse winding and normals). */
function inward(g: THREE.BufferGeometry) {
  const f = norm(g);
  const p = f.attributes.position as THREE.BufferAttribute, n = f.attributes.normal as THREE.BufferAttribute, u = f.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n, u]) {
      const sz = a.itemSize;
      for (let c = 0; c < sz; c++) {
        const t = a.array[(i + 1) * sz + c];
        (a.array as Float32Array)[(i + 1) * sz + c] = a.array[(i + 2) * sz + c];
        (a.array as Float32Array)[(i + 2) * sz + c] = t;
      }
    }
  }
  for (let i = 0; i < n.array.length; i++) (n.array as Float32Array)[i] *= -1;
  return f;
}

function lathe(profile: [number, number][], seg: number) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return norm(g);
}

let _wheelCache: Map<string, { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; cap: THREE.BufferGeometry; white: THREE.BufferGeometry; nuts: THREE.BufferGeometry; drum: THREE.BufferGeometry }> | null = null;
/** Wheel parts at the origin, axle along +z (outer face toward +z). */
function wheelParts(R: number) {
  _wheelCache ??= new Map();
  const key = R.toFixed(3);
  const hit = _wheelCache.get(key);
  if (hit) return hit;
  const w = 0.2, rr = R * 0.58, h = w / 2;
  // tyre: bead → sidewall bulge → shoulder → tread with two grooves → back
  const prof: [number, number][] = [
    [rr - 0.005, -h * 0.82], [rr + 0.02, -h * 0.98], [lerp(rr, R, 0.55), -h * 1.08], [R - 0.03, -h * 1.0], [R - 0.008, -h * 0.82],
    [R, -h * 0.62], [R, -h * 0.22], [R - 0.012, -h * 0.16], [R - 0.012, h * 0.16], [R, h * 0.22], [R, h * 0.62],
    [R - 0.008, h * 0.82], [R - 0.03, h * 1.0], [lerp(rr, R, 0.55), h * 1.08], [rr + 0.02, h * 0.98], [rr - 0.005, h * 0.82],
  ];
  const tyre = lathe(prof.reverse(), 18).rotateX(Math.PI / 2);
  // whitewall band on the outer sidewall
  const white = lathe([[lerp(rr, R, 0.25), h * 1.04 + 0.002], [lerp(rr, R, 0.62), h * 1.1 + 0.002]], 18).rotateX(Math.PI / 2);
  // steel wheel: a dished disc with a flange, seen from outside
  const rim = lathe([
    [0.045, h * 0.55], [0.07, h * 0.6], [rr * 0.55, h * 0.45], [rr * 0.82, h * 0.22], [rr - 0.01, h * 0.55], [rr + 0.012, h * 0.82], [rr + 0.012, h * 0.7], [rr - 0.005, -h * 0.7],
  ].reverse() as [number, number][], 14).rotateX(Math.PI / 2);
  const cap = lathe([[0.001, h * 0.95], [rr * 0.5, h * 0.88], [rr * 0.78, h * 0.72], [rr * 0.84, h * 0.6]].reverse() as [number, number][], 14).rotateX(Math.PI / 2);
  const nutParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    nutParts.push(norm(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.075, Math.sin(a) * 0.075, h * 0.62)));
  }
  nutParts.push(norm(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0, h * 0.6)));
  const drum = merge([
    norm(new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.12, 14).rotateX(Math.PI / 2)),
    norm(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8).rotateX(Math.PI / 2).translate(0, 0, 0.08)),
  ]);
  const out = { tyre, rim, cap, white, nuts: merge(nutParts), drum };
  _wheelCache.set(key, out);
  return out;
}

/** Shared car palette (memoized factories: every car in a batch shares these). */
const MATS = () => ({
  chrome: rustyMetal({ base: '#b9b7b0', rust: 0.22, metalness: 0.92, roughness: 0.26 }),
  steel: rustyMetal({ base: '#2f2e2c', rust: 0.6, metalness: 0.55, roughness: 0.55 }),
  under: rustyMetal({ base: '#3a2b22', rust: 0.9, metalness: 0.35, roughness: 0.85 }),
  bay: rustyMetal({ base: '#2b2723', rust: 0.65, metalness: 0.45, roughness: 0.75 }),
  block: rustyMetal({ base: '#5a5d5c', rust: 0.55, metalness: 0.5, roughness: 0.6 }),
  valve: rustyMetal({ base: '#b04a1c', rust: 0.45, metalness: 0.4, roughness: 0.55 }),
  rubber: plainStandard('#1b1918', 0.93),
  white: plainStandard('#c9c2b2', 0.85),
  dark: plainStandard('#141210', 0.55, 0.3),
  red: plainStandard('#7a120d', 0.22, 0.1),
  amber: plainStandard('#b26a12', 0.25, 0.1),
  lens: plainStandard('#aab4b4', 0.1, 0.5),
  plate: plainStandard('#d5c27e', 0.55, 0.2),
  carpet: fabric('#2f2721'),
  head: fabric('#8a7d68'),
  dash: plainStandard('#2a2522', 0.6),
  glass: carGlass(),
});
const SEATS = ['#6a4a32', '#7a2a22', '#3c4a52', '#a08a62', '#2a2a2a'];

/**
 * Build a car into `sink` (geometry transformed by `m`, which places the car's ground origin).
 * Returns the collider box and a shadow hull.
 */
export function buildCar(sink: CarSink, m: THREE.Matrix4, o: CarOpts): CarResult {
  const r = o.rand;
  const s = SPECS[o.kind];
  const B = new Body(s);
  const K = MATS();
  const burnt = !!o.burnt;
  const paint = burnt ? carPaint('#2a2522', 1, 1) : carPaint(o.paint, o.rust ?? 0.5, o.fade ?? 0.6);
  // (vinyl or cloth, all one fabric family: one draw for every seat in a batch)
  const seat = burnt ? K.steel : fabric(SEATS[Math.floor(r() * SEATS.length)], r() < 0.5 ? 0.55 : 0.95);
  const hood = o.hood ?? (burnt ? (r() < 0.5 ? 'gone' : 'open') : r() < 0.14 ? 'open' : r() < 0.08 ? 'gone' : 'shut');
  const brokenP = burnt ? 1 : o.broken ?? 0.35;
  const whitewall = !burnt && r() < 0.35;
  const hubcaps = !burnt && r() < 0.6;
  const wheels: WheelState[] = o.wheels ?? [0, 1, 2, 3].map(() => (burnt ? 'flat' : r() < 0.12 ? 'gone' : r() < 0.25 ? 'flat' : 'ok'));
  const { L, W, wf, wr, R, xa, xc, roof } = s;
  const cabX0 = xc + 0.04, cabX1 = xa - 0.02;

  // settle: corners sink by their state, the body pitches and rolls to match
  const drop = (st: WheelState) => (o.blocks ? -0.02 : st === 'ok' ? -0.01 - r() * 0.04 : st === 'flat' ? -0.11 : -(R - 0.13));
  const d = wheels.map(drop);
  const track = W - 0.36;
  const pitch = Math.atan2((d[0] + d[1]) / 2 - (d[2] + d[3]) / 2, wf - wr);
  const roll = -Math.atan2((d[1] + d[3]) / 2 - (d[0] + d[2]) / 2, track);
  const settle = new THREE.Matrix4().compose(V(0, (d[0] + d[1] + d[2] + d[3]) / 4 + (o.blocks ? 0.12 : 0), 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, 0, pitch)), V(1, 1, 1));
  const M = m.clone().multiply(settle);
  const thin = o.thin ?? sink;
  const put = (mat: THREE.Material, ...g: THREE.BufferGeometry[]) => sink.add(mat, ...g.map((x) => norm(x).applyMatrix4(M)));
  const putThin = (mat: THREE.Material, ...g: THREE.BufferGeometry[]) => thin.add(mat, ...g.map((x) => norm(x).applyMatrix4(M)));
  const bx = (w: number, h: number, dd: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, dd);
    g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
    return g;
  };
  const cy = (rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
    return g;
  };

  // ---------------------------------------------------------------- body loft
  const x0 = s.bedX ?? -L / 2, x1 = L / 2;
  const xsSet = new Set<number>();
  const step = 0.1;
  for (let x = x0; x < x1; x += step) xsSet.add(+x.toFixed(4));
  xsSet.add(x1);
  for (const wx of [wf, wr]) for (const k of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) {
    const x = wx + k * (R + 0.075) * (Math.abs(k) === 1 ? 1.001 : 1);
    if (x > x0 && x < x1) xsSet.add(+x.toFixed(4));
  }
  for (let k = 1; k <= 4; k++) { xsSet.add(+(x1 - (0.11 * k) / 4).toFixed(4)); if (s.bedX === undefined) xsSet.add(+(x0 + (0.11 * k) / 4).toFixed(4)); }
  for (const x of [cabX0, cabX1, xa + 0.04, x1 - 0.14]) if (x > x0 && x < x1) xsSet.add(+x.toFixed(4));
  const xs = [...xsSet].sort((a, b) => a - b);
  const NR = 28;
  const rows = xs.map((x) => Array.from({ length: NR }, (_, j) => B.point(x, (j / NR) * Math.PI * 2)));
  const hoodOpen = hood !== 'shut';
  const onTop = (i: number, j: number) => {
    const p = rows[i][j], q = rows[i][(j + 1) % NR];
    const yc = (B.bottom(p.x) + B.top(p.x)) / 2;
    return p.y > yc + 0.05 && q.y > yc + 0.05;
  };
  const inHood = (i: number, j: number) => {
    const xm = (xs[i] + xs[i + 1]) / 2;
    const zm = (rows[i][j].z + rows[i][(j + 1) % NR].z) / 2;
    return xm > xa + 0.04 && xm < x1 - 0.14 && Math.abs(zm) < B.hw(xm) - 0.14 && onTop(i, j);
  };
  const inCab = (i: number, j: number) => {
    const xm = (xs[i] + xs[i + 1]) / 2;
    const zm = (rows[i][j].z + rows[i][(j + 1) % NR].z) / 2;
    return xm > cabX0 && xm < cabX1 && Math.abs(zm) < B.hw(xm) * 0.93 - 0.02 && onTop(i, j);
  };
  const loft = gridSurface(rows, true, (i, j) => (inCab(i, j) || (hoodOpen && inHood(i, j)) ? null : 'paint'));
  put(paint, loft.get('paint')!);
  if (hoodOpen) {
    // the engine bay: an inside-out box under the opening (its walls face in, its top is open)
    const bx0 = xa + 0.03, bx1 = x1 - 0.13, bz = B.hw((bx0 + bx1) / 2) - 0.13, by1 = B.top(bx0) + 0.02, by0 = by1 - 0.62;
    const g = new THREE.BoxGeometry(bx1 - bx0, by1 - by0, bz * 2).translate((bx0 + bx1) / 2, (by0 + by1) / 2, 0);
    put(K.bay, inward(g));
  }
  // end caps (rear cap only when the loft runs to the tail)
  const cap = (x: number, flip: boolean) => {
    const ring = rows[xs.indexOf(x)];
    const c = ring.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / ring.length);
    const pos: number[] = [];
    for (let j = 0; j < NR; j++) {
      const a = ring[j], b = ring[(j + 1) % NR];
      if (flip) pos.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
      else pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  put(paint, cap(x1, true));
  put(s.bedX !== undefined ? K.under : paint, cap(x0, false));

  // wheel-well liners: a dark half-drum inside each arch
  for (const wx of [wf, wr]) for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(R + 0.07, R + 0.07, 0.42, 14, 1, true, Math.PI - 1.45, 2.9);
    g.rotateX(Math.PI / 2);
    g.translate(wx, R, side * (B.hw(wx) - 0.26));
    put(K.under, inward(g));
  }

  // ---------------------------------------------------------------- greenhouse
  const wb = (x: number) => B.hw(x) * 0.93;
  // the greenhouse stands where the body's shoulder is at its edge (lower than the crown)
  const yb = (x: number) => B.topY(x, wb(x)) - 0.006;
  const wtop = (x: number) => wb(x) * (o.kind === 'van' ? 0.97 : 0.83);
  const bowF = o.kind === 'van' ? 0.03 : 0.07, bowR = o.kind === 'van' || o.kind === 'wagon' ? 0.02 : 0.045;
  const deform = (p: THREE.Vector3) => {
    const zz = Math.min(1, Math.abs(p.z) / wb(xa));
    const f = ss(s.xr1, s.xr0, p.x);
    p.x += (bowF * f - bowR * (1 - f)) * (1 - zz * zz);
    const hy = Math.max(0, (p.y - yb(xa)) / (roof - yb(xa)));
    p.y += 0.04 * (1 - zz * zz) * Math.pow(hy, 6);
  };
  const glassAt = new Map<string, THREE.BufferGeometry[]>();
  const pane = (g: THREE.BufferGeometry, kind: number) => {
    const uvA = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) + kind * 2);
    return g;
  };
  const addGlass = (k: string, g: THREE.BufferGeometry) => {
    let a = glassAt.get(k);
    if (!a) glassAt.set(k, (a = []));
    a.push(g);
  };
  const headliner: THREE.BufferGeometry[] = [];
  const paintCells: THREE.BufferGeometry[] = [];
  const takePatch = (out: Map<string, THREE.BufferGeometry[]>, glassKind: number, paneId: string) => {
    for (const [k, gs] of out) {
      if (k === 'p') paintCells.push(...gs);
      else if (k === 'g') for (const g of gs) addGlass(paneId, pane(g, glassKind));
    }
  };
  const convertible = o.kind === 'convertible';
  const fr = 0.035; // frame border
  // windshield (s across the car −z → +z, t up)
  const wsTop = convertible ? lerp(yb(xa), roof, 1) : roof;
  const ws = patch([V(xa, yb(xa), -wb(xa)), V(xa, yb(xa), wb(xa)), V(s.xr0, wsTop, -wtop(s.xr0)), V(s.xr0, wsTop, wtop(s.xr0))],
    [0, fr, 1 - fr, 1], [0, 0.06, 1 - fr, 1], (si, ti) => (si === 1 && ti === 1 ? 'g' : 'p'), deform, 4);
  const cracked = !burnt && r() < 0.3;
  takePatch(ws, cracked ? 2 : 0, 'ws');
  if (!convertible) {
    // rear glass (s from +z → −z so it faces back)
    const rg = patch([V(xc, yb(xc), wb(xc)), V(xc, yb(xc), -wb(xc)), V(s.xr1, roof, wtop(s.xr1)), V(s.xr1, roof, -wtop(s.xr1))],
      [0, fr * 1.5, 1 - fr * 1.5, 1], [0, 0.07, 1 - fr * 1.2, 1], (si, ti) => (si === 1 && ti === 1 ? 'g' : 'p'), deform, 3);
    takePatch(rg, 1, 'rear');
    // roof
    const rf = patch([V(s.xr0, roof, -wtop(s.xr0)), V(s.xr0, roof, wtop(s.xr0)), V(s.xr1, roof, -wtop(s.xr1)), V(s.xr1, roof, wtop(s.xr1))],
      [0, 1], [0, 1], () => 'p', deform, 6);
    takePatch(rf, 1, 'roof');
    // sides: s along the car (front → back), t up
    for (const side of [-1, 1]) {
      const c: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = side > 0
        ? [V(xa, yb(xa), wb(xa)), V(xc, yb(xc), wb(xc)), V(s.xr0, roof, wtop(s.xr0)), V(s.xr1, roof, wtop(s.xr1))]
        : [V(xc, yb(xc), -wb(xc)), V(xa, yb(xa), -wb(xa)), V(s.xr1, roof, -wtop(s.xr1)), V(s.xr0, roof, -wtop(s.xr0))];
      // the −z side runs back → front, so its layout is mirrored
      const segs = side > 0 ? s.side : [...s.side].reverse().map(([a, b, kk]) => [1 - b, 1 - a, kk] as const);
      const sb = [0, ...segs.map((g) => g[1])], kinds = segs.map((g) => g[2]);
      const out = patch(c, sb, [0, 0.07, 1 - fr, 1], (si, ti) => (ti === 1 && kinds[si] === 'g' ? 'g' : 'p'), deform, 2);
      for (const [k, gs] of out) {
        if (k === 'p') paintCells.push(...gs);
        else for (const g of gs) addGlass(`side${side}:${gs.indexOf(g)}`, pane(g, 1));
      }
    }
  } else {
    // a folded top behind the seats
    const top = cy(0.16, 0.16, W - 0.35, 10, xc + 0.25, B.top(xc) + 0.08, 0, Math.PI / 2, 0, 0);
    top.scale(1.4, 0.6, 1);
    put(fabric('#2a2622'), top);
  }
  // inner shell of the painted cells (pillars and roof seen from inside). Built before the cells are
  // placed: put() transforms its geometry in place, and a shell cloned afterwards was placed twice
  // (headliners floating tens of metres over the wrecks).
  for (const g of paintCells) {
    const h = g.clone();
    const p = h.attributes.position as THREE.BufferAttribute;
    const nA = h.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - nA.getX(i) * 0.03, p.getY(i) - nA.getY(i) * 0.03, p.getZ(i) - nA.getZ(i) * 0.03);
    const idx = Array.from({ length: p.count }, (_, i) => i);
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    h.setIndex(idx);
    const f = h.toNonIndexed();
    f.deleteAttribute('normal');
    f.computeVertexNormals();
    headliner.push(f);
  }
  put(paint, ...paintCells);
  put(K.head, ...headliner);
  // glass: each pane survives or not; the side glass may be wound down a bit
  if (!burnt) {
    for (const [id, gs] of glassAt) {
      if (r() < brokenP * (id === 'ws' ? 0.6 : 1)) {
        // a jagged remnant along the bottom edge of some broken panes
        continue;
      }
      put(K.glass, ...gs);
    }
  }
  // chrome window surrounds (ribbons along the greenhouse's base line and drip rail)
  if (!burnt && !convertible) {
    for (const side of [-1, 1]) {
      const n = 14;
      const base: THREE.Vector3[] = [], drip: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const xb = lerp(xa, xc, t), xr = lerp(s.xr0, s.xr1, t);
        const pb = V(xb, yb(xb) + 0.012, side * (wb(xb) + 0.006));
        deform(pb);
        base.push(pb);
        const pd = V(xr, roof - 0.006, side * (wtop(xr) + 0.008));
        deform(pd);
        drip.push(pd);
      }
      putThin(K.chrome, ribbon(base, V(0, 1, 0), 0.022), ribbon(drip, V(0, 1, 0), 0.016));
    }
  }

  // ---------------------------------------------------------------- hood
  if (hood !== 'gone') {
    const hx0 = xa + 0.045, hx1 = x1 - 0.15;
    const n = 12, mz = 10;
    const top: THREE.Vector3[][] = [];
    for (let i = 0; i <= n; i++) {
      const x = lerp(hx0, hx1, i / n), hz = B.hw(x) - 0.15;
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= mz; j++) { const z = lerp(-hz, hz, j / mz); row.push(V(x, B.topY(x, z) + (hoodOpen ? 0.012 : 0.003), z)); }
      top.push(row);
    }
    const lid = gridSurface(top, false, () => 'x').get('x')!;
    const under = gridSurface(top.map((row) => row.map((p) => p.clone().add(V(0, -0.01, 0))).reverse()), false, () => 'x').get('x')!;
    if (hoodOpen) {
      const hinge = new THREE.Matrix4().makeTranslation(hx0, B.top(hx0), 0)
        .multiply(new THREE.Matrix4().makeRotationZ(1.05 + r() * 0.2))
        .multiply(new THREE.Matrix4().makeTranslation(-hx0, -B.top(hx0), 0));
      lid.applyMatrix4(hinge);
      under.applyMatrix4(hinge);
      // a prop rod
      putThin(K.steel, cy(0.008, 0.008, 0.85, 4, x1 - 0.5, B.top(x1) + 0.3, -0.5, 0, 0, 0.35));
      put(K.bay, under);
    } else {
      // the seams around a shut hood
      const seam = (pts: THREE.Vector3[], across: THREE.Vector3) => putThin(K.dark, ribbon(pts, across, 0.012));
      const cross = Array.from({ length: 11 }, (_, j) => { const z = lerp(-B.hw(hx0) + 0.15, B.hw(hx0) - 0.15, j / 10); return V(hx0, B.topY(hx0, z) + 0.004, z); });
      seam(cross, V(1, 0, 0));
      for (const sd of [-1, 1]) seam(Array.from({ length: 9 }, (_, i) => { const x = lerp(hx0, hx1, i / 8), z = sd * (B.hw(x) - 0.15); return V(x, B.topY(x, z) + 0.004, z); }), V(0, 0, 1));
    }
    put(paint, lid);
  }
  if (hoodOpen) {
    // engine bay: block, valve covers, air cleaner, radiator, battery
    const ex = (xa + x1) / 2 + 0.05, ey = B.top(ex) - 0.36;
    put(K.block, bx(0.75, 0.42, 0.55, ex, ey, 0));
    for (const sd of [-1, 1]) put(K.valve, bx(0.7, 0.09, 0.16, ex, ey + 0.25, sd * 0.24, sd * 0.5));
    put(hoodOpen && r() < 0.5 ? K.chrome : K.dark, cy(0.2, 0.2, 0.07, 16, ex - 0.05, ey + 0.33, 0));
    put(K.dark, bx(0.08, 0.5, B.hw(x1 - 0.3) * 1.6, x1 - 0.3, B.top(x1) - 0.3, 0));
    put(K.dark, bx(0.25, 0.2, 0.18, ex + 0.2, ey + 0.1, B.hw(ex) - 0.35));
    putThin(K.rubber, cy(0.02, 0.02, 0.7, 5, ex + 0.3, ey + 0.28, -0.3, Math.PI / 2, 0, 0.3));
  }
  // trunk seam
  if (s.bedX === undefined && o.kind !== 'wagon' && o.kind !== 'van') {
    const tx0 = xc - 0.06, tx1 = -L / 2 + 0.14;
    const cross = Array.from({ length: 11 }, (_, j) => { const z = lerp(-B.hw(tx0) + 0.15, B.hw(tx0) - 0.15, j / 10); return V(tx0, B.topY(tx0, z) + 0.004, z); });
    putThin(K.dark, ribbon(cross, V(1, 0, 0), 0.012));
    for (const sd of [-1, 1]) putThin(K.dark, ribbon(Array.from({ length: 9 }, (_, i) => { const x = lerp(tx0, tx1, i / 8), z = sd * (B.hw(x) - 0.15); return V(x, B.topY(x, z) + 0.004, z); }), V(0, 0, 1), 0.012));
  }

  // ---------------------------------------------------------------- sides: doors, trim, handles, mirror
  for (const side of [-1, 1]) {
    for (const dx of s.doors) {
      const ylo = Math.max(B.bottom(dx) + 0.08, B.archTop(dx) + 0.02), yhi = B.top(dx) - 0.03;
      const pts = Array.from({ length: 7 }, (_, i) => { const y = lerp(ylo, yhi, i / 6); return V(dx, y, side * (B.sideZ(dx, y) + 0.003)); });
      putThin(K.dark, ribbon(pts, V(1, 0, 0), 0.01));
    }
    // handles just ahead of each door's rear seam
    for (let k = 1; k < s.doors.length; k++) {
      const hx = s.doors[k] + 0.12, hy = B.top(hx) - 0.13;
      putThin(K.chrome, bx(0.16, 0.025, 0.03, hx, hy, side * (B.sideZ(hx, hy) + 0.012)));
    }
    // a chrome body-side moulding, broken by the arches
    if (!burnt) {
      const my = lerp(B.s.sill, B.s.belt, 0.55);
      let run: THREE.Vector3[] = [];
      const flush = () => { if (run.length > 1) putThin(K.chrome, ribbon(run, V(0, 1, 0), 0.028)); run = []; };
      for (let x = x0 + 0.12; x <= x1 - 0.1; x += 0.1) {
        if (B.archTop(x) > my - 0.02) { flush(); continue; }
        run.push(V(x, my, side * (B.sideZ(x, my) + 0.006)));
      }
      flush();
    }
  }
  if (!burnt && r() < 0.85) {
    const mx = xa - 0.12, my = B.top(mx) + 0.1, mz = -(B.hw(mx) + 0.06);
    put(K.chrome, cy(0.01, 0.012, 0.12, 5, mx, my - 0.06, mz + 0.04, 0.6), bx(0.05, 0.08, 0.15, mx, my, mz));
  }
  if (!burnt && r() < 0.5) putThin(K.chrome, cy(0.003, 0.004, 0.9, 4, x1 - 0.7, B.top(x1 - 0.7) + 0.42, B.hw(x1 - 0.7) - 0.1, 0, 0, -0.2));

  // ---------------------------------------------------------------- front and rear
  const fy = (B.bottom(x1) + B.top(x1)) / 2, fhw = B.hw(x1) * 0.86;
  const fx = x1 - 0.004;
  // grille with chrome surround and bars
  put(K.dark, bx(0.05, 0.26, fhw * 1.15, fx - 0.02, fy + 0.02, 0));
  if (!burnt) {
    put(K.chrome, bx(0.04, 0.03, fhw * 1.2, fx, fy + 0.165, 0), bx(0.04, 0.03, fhw * 1.2, fx, fy - 0.125, 0));
    for (let k = 0; k < 5; k++) putThin(K.chrome, bx(0.02, 0.012, fhw * 1.12, fx, fy - 0.08 + k * 0.05, 0));
  }
  // quad headlights: chrome bezels, glass lenses (some smashed)
  for (const sd of [-1, 1]) for (const k of [0, 1]) {
    const hz = sd * (fhw * 0.62 + k * 0.2), hy = fy + 0.03;
    const bez = new THREE.TorusGeometry(0.085, 0.016, 6, 16).rotateY(Math.PI / 2).translate(fx + 0.01, hy, hz);
    if (!burnt) put(K.chrome, bez);
    put(r() < 0.25 || burnt ? K.dark : K.lens, cy(0.075, 0.075, 0.03, 14, fx - 0.005, hy, hz, 0, 0, Math.PI / 2));
    if (!burnt && k === 0) putThin(K.amber, bx(0.02, 0.05, 0.12, fx + 0.005, fy - 0.17, sd * fhw * 0.7));
  }
  const ry0 = (B.bottom(x0) + B.top(x0)) / 2, rx = x0 + 0.004;
  if (s.bedX === undefined) {
    // taillights, back-up lights, a plate
    for (const sd of [-1, 1]) {
      put(burnt ? K.dark : K.red, bx(0.04, 0.12, 0.42, rx - 0.01, ry0 + 0.06, sd * (B.hw(x0) * 0.86 - 0.25)));
      if (!burnt) putThin(K.lens, bx(0.03, 0.06, 0.1, rx - 0.012, ry0 - 0.05, sd * (B.hw(x0) * 0.86 - 0.25)));
    }
    if (!burnt) putThin(K.plate, bx(0.015, 0.15, 0.3, rx - 0.01, ry0 - 0.06, 0));
  }
  // bumpers: a bar with wrap-around ends, front and back
  const bumper = (x: number, dir: number) => {
    if (burnt && r() < 0.5) return;
    const by = B.bottom(x) + 0.07, hw = B.hw(x) * 0.98;
    put(burnt ? K.steel : K.chrome, bx(0.13, 0.15, hw * 2 - 0.3, x + dir * 0.05, by, 0));
    for (const sd of [-1, 1]) put(burnt ? K.steel : K.chrome, bx(0.13, 0.15, 0.34, x - dir * 0.04, by, sd * (hw - 0.12), 0, sd * dir * 0.55, 0));
  };
  bumper(x1, 1);
  if (s.bedX === undefined) bumper(x0, -1);
  if (!burnt) putThin(K.plate, bx(0.015, 0.15, 0.3, x1 + 0.12, B.bottom(x1) + 0.07, 0));

  // ---------------------------------------------------------------- pickup bed
  if (s.bedX !== undefined) {
    const bx0 = -L / 2, bx1 = s.bedX - 0.04, floorY = 0.66, railY = s.belt;
    put(K.under, bx(bx1 - bx0, 0.05, W - 0.12, (bx0 + bx1) / 2, floorY, 0));
    for (let k = 0; k < 6; k++) putThin(K.steel, bx(bx1 - bx0 - 0.05, 0.02, 0.04, (bx0 + bx1) / 2, floorY + 0.03, -0.7 + k * 0.28));
    for (const sd of [-1, 1]) {
      // bed side with the rear arch cut out
      const sh = new THREE.Shape();
      sh.moveTo(bx0, 0.42); sh.lineTo(wr - R - 0.08, 0.42);
      sh.absarc(wr, R, R + 0.08, Math.PI - Math.asin((0.42 - R) / (R + 0.08)), Math.asin((0.42 - R) / (R + 0.08)), true);
      sh.lineTo(bx1, 0.42); sh.lineTo(bx1, railY); sh.lineTo(bx0, railY); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, sd > 0 ? W / 2 - 0.07 : -W / 2 + 0.02);
      put(paint, g);
      put(paint, bx(bx1 - bx0, 0.04, 0.12, (bx0 + bx1) / 2, railY + 0.02, sd * (W / 2 - 0.06)));
      put(burnt ? K.dark : K.red, bx(0.04, 0.22, 0.12, bx0 - 0.005, railY - 0.2, sd * (W / 2 - 0.06)));
    }
    put(paint, bx(0.05, railY - floorY, W - 0.1, bx1, (railY + floorY) / 2, 0));
    // tailgate: shut or dropped
    const drop = r() < 0.35;
    const tg = bx(0.05, railY - 0.42, W - 0.14, 0, (railY - 0.42) / 2, 0);
    tg.applyMatrix4(new THREE.Matrix4().makeTranslation(bx0 + 0.02, 0.42, 0).multiply(new THREE.Matrix4().makeRotationZ(drop ? Math.PI / 2 - 0.05 : 0)));
    put(paint, tg);
    put(burnt ? K.steel : K.chrome, bx(0.13, 0.15, W - 0.2, bx0 - 0.06, 0.4, 0));
    put(K.under, bx(bx1 - bx0, 0.3, 0.12, (bx0 + bx1) / 2, 0.5, 0));
  }

  // ---------------------------------------------------------------- interior
  const ix = (t: number) => lerp(cabX1, cabX0, t);
  const floorY = B.s.sill + 0.08, cabW = wb(ix(0.5)) * 2 - 0.1;
  put(K.carpet, bx(cabX1 - cabX0, 0.03, cabW, (cabX0 + cabX1) / 2, floorY, 0));
  for (const sd of [-1, 1]) put(K.carpet, bx(cabX1 - cabX0, B.s.belt - floorY - 0.02, 0.04, (cabX0 + cabX1) / 2, (B.s.belt + floorY) / 2, sd * (cabW / 2 + 0.02)));
  put(K.carpet, bx(0.04, B.s.belt - floorY, cabW, cabX0, (B.s.belt + floorY) / 2, 0));
  // dash, column, wheel, mirror
  put(K.dash, bx(0.42, 0.24, cabW, cabX1 - 0.2, B.s.belt - 0.06, 0), bx(0.2, 0.06, 0.6, cabX1 - 0.32, B.s.belt + 0.04, -0.38));
  put(K.dark, cy(0.025, 0.03, 0.45, 6, cabX1 - 0.45, B.s.belt - 0.1, -0.38, 0, 0, 1.1));
  put(K.dark, new THREE.TorusGeometry(0.19, 0.016, 6, 20).rotateY(Math.PI / 2).rotateZ(0.45).translate(cabX1 - 0.6, B.s.belt - 0.02, -0.38));
  if (!convertible) putThin(K.dark, bx(0.03, 0.06, 0.2, s.xr0 - 0.04, roof - 0.08, 0));
  // benches (front always; rear when the cabin is long enough)
  const bench = (t: number) => {
    const sx = ix(t), sw = cabW - 0.04;
    const tilt = burnt ? 0 : 0.18;
    // the backrest leans back, but never through the rear glass (which slopes in over the rear bench)
    const glassAt = (y: number) => lerp(xc, s.xr1, Math.min(1, Math.max(0, (y - yb(xc)) / (roof - yb(xc)))));
    const top = floorY + 0.8;
    const bxr = convertible || o.kind === 'wagon' || o.kind === 'van' ? sx - 0.28 : Math.max(sx - 0.28, glassAt(top) + 0.14);
    put(seat, bx(0.5, 0.16, sw, sx, floorY + 0.3, 0), bx(0.12, 0.5, sw, Math.max(bxr, cabX0 + 0.1), floorY + 0.58, 0, 0, 0, tilt));
    put(K.dark, bx(0.42, 0.24, sw - 0.1, sx, floorY + 0.12, 0));
  };
  const cabLen = cabX1 - cabX0;
  bench(cabLen > 1.6 ? 0.42 : 0.62);
  if (cabLen > 1.6) bench(o.kind === 'wagon' ? 0.6 : 0.8);

  // ---------------------------------------------------------------- wheels
  const wp = wheelParts(R);
  const axles: [number, number][] = [[wf, -1], [wf, 1], [wr, -1], [wr, 1]];
  axles.forEach(([wx, sd], i) => {
    const wz = sd * (B.hw(wx) - 0.2);
    const st = wheels[i];
    const at = new THREE.Matrix4().makeTranslation(wx, R, wz).multiply(new THREE.Matrix4().makeRotationY(sd > 0 ? 0 : Math.PI));
    const xf = (g: THREE.BufferGeometry) => g.clone().applyMatrix4(at);
    if (o.blocks) {
      put(K.dash, bx(0.3, 0.3, 0.3, wx, 0.08, wz * 0.85));
      put(K.steel, xf(wp.drum));
      return;
    }
    if (st === 'gone') { put(K.steel, xf(wp.drum)); return; }
    const flat = (g: THREE.BufferGeometry) => {
      if (st !== 'flat') return g;
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) - R;
        if (y < -R * 0.62) { p.setY(k, R - R * 0.62 + (y + R * 0.62) * 0.15); p.setZ(k, wz + (p.getZ(k) - wz) * 1.12); }
      }
      g.computeVertexNormals();
      return g;
    };
    if (!burnt) put(K.rubber, flat(xf(wp.tyre)));
    put(K.steel, xf(wp.rim));
    if (whitewall) putThin(K.white, flat(xf(wp.white)));
    if (hubcaps && r() < 0.8) put(K.chrome, xf(wp.cap)); else putThin(K.steel, xf(wp.nuts));
  });

  // ---------------------------------------------------------------- chassis (seen when it's on its roof)
  const uy = B.s.sill - 0.02;
  for (const sd of [-1, 1]) put(K.under, bx(L * 0.82, 0.1, 0.08, -0.05, uy, sd * 0.55));
  put(K.under, cy(0.045, 0.045, W - 0.5, 8, wr, R, 0, Math.PI / 2), cy(0.11, 0.11, 0.2, 10, wr, R, 0, Math.PI / 2));
  put(K.under, cy(0.035, 0.035, wf - wr - 0.4, 6, (wf + wr) / 2, uy - 0.02, 0, 0, 0, Math.PI / 2));
  put(K.under, cy(0.03, 0.03, L * 0.75, 6, -0.2, uy - 0.03, 0.42, 0, 0, Math.PI / 2), cy(0.09, 0.09, 0.6, 10, -0.6, uy - 0.05, 0.42, 0, 0, Math.PI / 2));
  put(K.under, bx(0.5, 0.18, 0.9, wr - 0.6, uy + 0.02, 0));

  // ---------------------------------------------------------------- collider + shadow hull
  const top = convertible ? B.s.belt : roof;
  const half = V(L / 2 + 0.06, top / 2, W / 2 + 0.02);
  const center = V(0, top / 2 + d.reduce((a, b) => a + b, 0) / 4, 0);
  const hullRows: THREE.Vector3[][] = [];
  for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 8) hullRows.push(Array.from({ length: 10 }, (_, j) => B.point(Math.min(x, x1), (j / 10) * Math.PI * 2)));
  const hull: THREE.BufferGeometry[] = [gridSurface(hullRows, true, () => 'x').get('x')!];
  if (!convertible) {
    const gh = new THREE.BufferGeometry();
    const P = [V(xa, yb(xa), -wb(xa)), V(xa, yb(xa), wb(xa)), V(xc, yb(xc), wb(xc)), V(xc, yb(xc), -wb(xc)),
      V(s.xr0, roof, -wtop(s.xr0)), V(s.xr0, roof, wtop(s.xr0)), V(s.xr1, roof, wtop(s.xr1)), V(s.xr1, roof, -wtop(s.xr1))];
    const f = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4, 4, 7, 5, 5, 7, 6];
    gh.setAttribute('position', new THREE.Float32BufferAttribute(f.flatMap((k) => [P[k].x, P[k].y, P[k].z]), 3));
    hull.push(norm(gh));
  }
  if (s.bedX !== undefined) hull.push(norm(bx(-L / 2 - s.bedX, s.belt - 0.42, W, (s.bedX - L / 2) / 2, (s.belt + 0.42) / 2, 0)));
  for (const [wx, sd] of axles) hull.push(norm(cy(R, R, 0.2, 8, wx, R, sd * (B.hw(wx) - 0.2), Math.PI / 2)));
  const shadow = merge(hull).applyMatrix4(M);
  return { half, center, shadow };
}
