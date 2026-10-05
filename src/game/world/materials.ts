import * as THREE from 'three/webgpu';
import {
  Fn, vec2, float, positionWorld, positionLocal, normalWorld, mix, smoothstep, abs, sin, uniform, time, pow, max,
  fract, step, uv, cameraPosition, normalize, dot, uniformArray, varying,
} from 'three/tsl';
import { bumpFromHeight } from './Terrain';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

// NOTE: every tweakable parameter is a uniform, so all instances of a factory share one shader program.
// On top of that, identical calls return the *same* material instance (memo below), so MeshBatch can
// merge geometry that used "different" but equal materials — fewer meshes, far fewer draw calls.
// Callers must not mutate a returned material; use the *Unique variants if you need to.

const _memo = new Map<string, THREE.Material>();
function memo<T extends THREE.Material>(key: string, make: () => T): T {
  let m = _memo.get(key) as T | undefined;
  if (!m) _memo.set(key, (m = make()));
  return m;
}
const k = (name: string, ...args: unknown[]) => name + JSON.stringify(args, (_, v) => (v instanceof THREE.Color ? '#' + v.getHexString() : v));

/** World-space planar coordinate picked by the dominant normal axis (works on arbitrary props). */
const triCoord = (): N => {
  const n = abs(normalWorld);
  const p = positionWorld;
  return mix(mix(p.zy, p.xz, step(n.x, n.y)), p.xy, step(max(n.x, n.y), n.z));
};

const vec3c = (r: number, g: number, b: number): N => uniform(new THREE.Color(r, g, b));

/** Global rim-light uniform tinted by the atmosphere each frame. */
export const rimColor = uniform(new THREE.Color(1, 0.6, 0.3));
export const rimStrength = uniform(0.6);

const rim = (power = 3): N =>
  Fn(() => {
    const v = normalize(cameraPosition.sub(positionWorld));
    const f = pow(float(1).sub(max(dot(normalWorld, v), 0)), power);
    return rimColor.mul(f).mul(rimStrength);
  })();

export interface RustOpts { base: THREE.ColorRepresentation; rust?: number; roughness?: number; metalness?: number; scale?: number; paintChips?: boolean; rim?: number }

/** Painted / bare metal with rust blooms, vertical streaks and chipped paint. */
export const rustyMetal = (o: RustOpts) => memo(k('rust', o), () => rustyMetalUnique(o));

export function rustyMetalUnique(o: RustOpts) {
  const m = new THREE.MeshStandardNodeMaterial();
  const base = uniform(new THREE.Color(o.base));
  const rustAmt = uniform(o.rust ?? 0.5);
  const rough = uniform(o.roughness ?? 0.55);
  const metal = uniform(o.metalness ?? 0.6);
  const s = uniform(o.scale ?? 1);
  const rimK = uniform(o.rim ?? 0);
  const c = triCoord().mul(s);
  const t1 = noise(c.mul(0.12));
  const t2 = noise(c.mul(0.7));
  const streak = noise(vec2(positionWorld.x.add(positionWorld.z).mul(s).mul(0.45), positionWorld.y.mul(0.04))).r;
  const field = t1.r.add(streak.sub(0.5).mul(0.5)).add(t2.g.sub(0.5).mul(0.3));
  const rustMask = smoothstep(float(0.62).sub(rustAmt.mul(0.4)), float(0.72).sub(rustAmt.mul(0.3)), field);
  const rustCol = mix(vec3c(0.30, 0.11, 0.05), vec3c(0.62, 0.30, 0.12), t2.r);
  m.colorNode = mix(base.mul(float(0.85).add(t2.g.mul(0.2))), rustCol, rustMask);
  m.roughnessNode = mix(rough, float(0.95), rustMask);
  m.metalnessNode = mix(metal, float(0.1), rustMask);
  m.normalNode = bumpFromHeight(rustMask.mul(0.6).add(t2.r.mul(0.25)), float(0.05));
  m.emissiveNode = rim(3).mul(rimK);
  return m;
}

/** Weathered concrete with stains, pitting and water streaks. */
export const concrete = (tint: THREE.ColorRepresentation = '#9a9184', opts: { scale?: number; stains?: number } = {}) => memo(k('concrete', tint, opts), () => concreteUnique(tint, opts));

function concreteUnique(tint: THREE.ColorRepresentation, opts: { scale?: number; stains?: number }) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const s = uniform(opts.scale ?? 1);
  const stainAmt = uniform(opts.stains ?? 0.6);
  const base = uniform(new THREE.Color(tint));
  const c = triCoord().mul(s);
  const t1 = noise(c.mul(0.1));
  const t2 = noise(c.mul(0.9));
  const streaks = noise(vec2(positionWorld.x.add(positionWorld.z).mul(s).mul(0.6), positionWorld.y.mul(0.05))).r;
  // vertical rain streaks only make sense on walls; floors get blotchy wear instead (otherwise the
  // streak term, constant in y, paints long diagonal stripes across every slab)
  const upness = smoothstep(0.6, 0.9, abs(normalWorld.y));
  const blotch = noise(c.mul(0.23).add(vec2(0.37, 0.11))).g;
  const stainSrc = mix(streaks.add(t1.r.mul(0.4)), blotch.mul(0.9).add(t1.r.mul(0.45)), upness);
  const stain = smoothstep(0.45, 0.8, stainSrc.sub(0.2)).mul(stainAmt);
  const pits = smoothstep(0.1, 0.0, t2.b);
  m.colorNode = base.mul(float(0.8).add(t1.r.mul(0.3))).mul(float(1).sub(stain.mul(0.45))).mul(float(1).sub(pits.mul(0.3)));
  m.normalNode = bumpFromHeight(t1.r.mul(0.3).add(t2.a.mul(0.1)).sub(pits.mul(0.5)), float(0.04));
  return m;
}

/** Corrugated sheet metal: ridges via sin along a local axis, with rust. */
export const corrugated = (base: THREE.ColorRepresentation, rust = 0.6, axis: 'x' | 'y' | 'z' = 'x') => memo(k('corr', base, rust, axis), () => corrugatedUnique(base, rust, axis));

function corrugatedUnique(base: THREE.ColorRepresentation, rust: number, axis: 'x' | 'y' | 'z') {
  const m = rustyMetalUnique({ base, rust, roughness: 0.5, metalness: 0.7 });
  const coord = axis === 'x' ? positionLocal.x : axis === 'y' ? positionLocal.y : positionLocal.z;
  const ridge = sin(coord.mul(Math.PI * 2 * 7)).mul(0.5).add(0.5);
  const n = noise(triCoord().mul(0.5)).r;
  m.normalNode = bumpFromHeight(ridge.mul(1.2).add(n.mul(0.2)), float(0.06));
  return m;
}

export function plainStandard(c: THREE.ColorRepresentation, roughness = 0.8, metalness = 0, extra: Partial<THREE.MeshStandardNodeMaterialParameters> = {}) {
  return memo(k('plain', c, roughness, metalness, extra), () => new THREE.MeshStandardNodeMaterial({ color: c, roughness, metalness, ...extra }));
}

/** HDR emissive "neon" with optional flicker driven by an external value. */
export function neon(c: THREE.ColorRepresentation, intensity = 6, flicker?: { value: number }) {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.4 });
  const col = uniform(new THREE.Color(c));
  const k = uniform(intensity);
  const f = uniform(1);
  if (flicker) f.onFrameUpdate(() => flicker.value);
  m.emissiveNode = col.mul(k).mul(f);
  m.colorNode = col.mul(0.15);
  return m;
}

/** Glowing material whose intensity/colour are exposed as uniforms. */
export function glow(c: THREE.ColorRepresentation, intensity = 4) {
  const u = uniform(intensity);
  const col = uniform(new THREE.Color(c));
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.3 });
  m.emissiveNode = col.mul(u);
  return { material: m, intensity: u, color: col };
}

/** Chain-link fence: alpha-tested diamond lattice (uv pre-scaled to metres) with rust variation. */
export const chainLink = () => memo('chainlink', chainLinkUnique);

function chainLinkUnique() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.45, metalness: 0.85 });
  const u = uv();
  const q = vec2(u.x.add(u.y), u.x.sub(u.y)).mul(9);
  const g = abs(fract(q).sub(0.5));
  m.opacityNode = smoothstep(0.43, 0.47, max(g.x, g.y));
  m.alphaTestNode = float(0.5);
  const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.15)).r;
  m.colorNode = mix(vec3c(0.55, 0.55, 0.52), vec3c(0.45, 0.22, 0.1), smoothstep(0.4, 0.7, n));
  return m;
}

/** Rough fabric with weave bump and rim light. */
export const fabric = (c: THREE.ColorRepresentation, roughness = 0.95) => memo(k('fabric', c, roughness), () => fabricUnique(c, roughness));

export function fabricUnique(c: THREE.ColorRepresentation, roughness = 0.95) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  const base = uniform(new THREE.Color(c));
  const t = noise(positionLocal.xy.add(positionLocal.z).mul(1.5));
  const fine = noise(positionLocal.xy.sub(positionLocal.z).mul(9)).g;
  m.colorNode = base.mul(float(0.72).add(t.r.mul(0.4)).add(fine.mul(0.1)));
  m.normalNode = bumpFromHeight(t.r.mul(0.5).add(fine.mul(0.15)), float(0.012));
  m.emissiveNode = rim(2.5).mul(0.6);
  return m;
}

/** Leather / skin with fine grain and rim light. */
export const leather = (c: THREE.ColorRepresentation) => memo(k('leather', c), () => leatherUnique(c));

function leatherUnique(c: THREE.ColorRepresentation) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.65, metalness: 0 });
  const base = uniform(new THREE.Color(c));
  const n = noise(positionLocal.xy.add(positionLocal.z).mul(6)).r;
  m.colorNode = base.mul(float(0.8).add(n.mul(0.3)));
  m.normalNode = bumpFromHeight(n.mul(0.4), float(0.015));
  m.emissiveNode = rim(2.5).mul(0.6);
  return m;
}

/** Window glass that glows faintly from inside. */
export const warmWindow = (c: THREE.ColorRepresentation = '#ffb35c', intensity = 2.5) => memo(k('window', c, intensity), () => warmWindowUnique(c, intensity));

function warmWindowUnique(c: THREE.ColorRepresentation, intensity: number) {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.2 });
  const col = uniform(new THREE.Color(c));
  const k = uniform(intensity);
  const n = noise(positionWorld.xz.mul(0.2).add(time.mul(0.02))).r;
  m.emissiveNode = (col as N).mul(n.mul(0.3).add(0.85)).mul(k);
  return m;
}

/** Wood with stretched grain. */
export const wood = (c: THREE.ColorRepresentation = '#6b4a2e') => memo(k('wood', c), () => woodUnique(c));

function woodUnique(c: THREE.ColorRepresentation) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const base = uniform(new THREE.Color(c));
  const grain = noise(vec2(positionLocal.x.add(positionLocal.z).mul(0.15), positionLocal.y.mul(4))).r;
  m.colorNode = base.mul(float(0.7).add(grain.mul(0.45)));
  m.normalNode = bumpFromHeight(grain.mul(0.5), float(0.02));
  return m;
}

export function updateRim(sunColor: THREE.Color, strength: number) {
  (rimColor.value as THREE.Color).copy(sunColor);
  rimStrength.value = strength;
}

export interface GlowSlot {
  index: number;
  intensity: { value: number };
  color: { value: THREE.Color };
  /** add geometry lit by this slot to a MeshBatch-like `{ add(mat, ...geo) }` */
  add: (batch: { add(m: THREE.Material, ...g: THREE.BufferGeometry[]): unknown }, ...g: THREE.BufferGeometry[]) => void;
}

/**
 * Many small glowing bits (LEDs, lamps, lenses, screens) in ONE material: each "slot" has its own
 * colour and intensity in a uniform array, picked per vertex through the uv.x the geometry is
 * tagged with. Merged into a MeshBatch, every glow of a prop set costs a single draw call, and
 * blinking a slot is just writing its intensity.
 */
export class GlowPalette {
  readonly material: THREE.MeshStandardNodeMaterial;
  private colors: THREE.Color[];
  private k: number[];
  private n = 0;

  constructor(private size = 32) {
    this.colors = Array.from({ length: size }, () => new THREE.Color(0, 0, 0));
    this.k = new Array(size).fill(0);
    const uc: N = uniformArray(this.colors, 'color');
    const uk: N = uniformArray(this.k, 'float');
    const idx: N = uv().x.mul(size).floor().toInt();
    const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.3 });
    m.emissiveNode = varying(uc.element(idx).mul(uk.element(idx)));
    this.material = m;
  }

  slot(c: THREE.ColorRepresentation, intensity = 4): GlowSlot {
    if (this.n >= this.size) throw new Error('GlowPalette full');
    const i = this.n++;
    this.colors[i].set(c);
    this.k[i] = intensity;
    const k = this.k, size = this.size, material = this.material;
    return {
      index: i,
      intensity: { get value() { return k[i]; }, set value(v: number) { k[i] = v; } },
      color: { value: this.colors[i] },
      add: (batch, ...g) => {
        for (const geo of g) {
          const uvA = geo.attributes.uv as THREE.BufferAttribute;
          for (let j = 0; j < uvA.count; j++) uvA.setXY(j, (i + 0.5) / size, 0.5);
        }
        batch.add(material, ...g);
      },
    };
  }
}
