import * as THREE from 'three/webgpu';
import {
  Fn, vec2, float, positionWorld, positionLocal, normalWorld, mix, smoothstep, abs, sin, uniform, time, pow, max,
  fract, step, uv, cameraPosition, normalize, dot, attribute, uniformArray, int, vertexStage, varying, texture,
  renderGroup, materialColor,
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

// ------------------------------------------------------------------ batch families
// Many batches use several *variants* of one factory (a dozen rustyMetal paints, a handful of
// plainStandard colours…), and each variant used to cost its own draw call. Memoized materials are
// tagged with their family + parameters; when a MeshBatch holds 2+ variants of a family it merges
// them into ONE mesh whose parameters come from per-vertex attributes (bColor/bParam) instead of
// uniforms. The shader math is the same, so the picture is the same, for a fraction of the draws.

export type Family = 'rust' | 'corr-x' | 'corr-y' | 'corr-z' | 'concrete' | 'plain' | 'fabric' | 'leather' | 'wood' | 'window' | 'glow';
export interface BatchSpec {
  family: Family;
  /** linear rgb + one family-specific extra (rust: rim strength) */
  c: [number, number, number, number];
  /** family-specific scalars */
  p: [number, number, number, number];
  /** glow only: the live intensity uniform the batch follows */
  glow?: { value: number };
}
const _spec = new WeakMap<THREE.Material, BatchSpec>();
export const batchSpec = (m: THREE.Material) => _spec.get(m);
function tag<T extends THREE.Material>(m: T, family: Family, col: THREE.ColorRepresentation, w: number, p: number[], glowU?: { value: number }): T {
  const c = new THREE.Color(col);
  _spec.set(m, { family, c: [c.r, c.g, c.b, w], p: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0], glow: glowU });
  return m;
}
const bC = (): N => attribute('bColor', 'vec4');
const bP = (): N => attribute('bParam', 'vec4');

/** Glow variants one batched glow material can drive (fixed, so every glow batch shares one program). */
export const GLOW_SLOTS = 16;

/**
 * The material that renders a merged family. 'glow' gets a fresh instance per batch (it owns the
 * live intensity array); every other family has one shared instance for the whole game.
 */
export function familyMaterial(f: Family, glowSources: { value: number }[] = []): THREE.Material {
  if (f === 'glow') {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.3 });
    const arr = uniformArray(new Array(GLOW_SLOTS).fill(0), 'float');
    arr.onUpdate(() => {
      const a = arr.array as number[];
      for (let i = 0; i < glowSources.length; i++) a[i] = glowSources[i].value;
    }, 'render');
    m.emissiveNode = bC().xyz.mul(vertexStage(arr.element(int(bP().x))));
    return m;
  }
  return memo('family:' + f, () => {
    switch (f) {
      case 'rust': case 'corr-x': case 'corr-y': case 'corr-z': {
        const m = new THREE.MeshStandardNodeMaterial();
        rustSetup(m, { base: bC().xyz, rimK: bC().w, rustAmt: bP().x, rough: bP().y, metal: bP().z, s: bP().w });
        if (f !== 'rust') corrSetup(m, f.slice(5) as 'x' | 'y' | 'z');
        return m;
      }
      case 'concrete': {
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
        concreteSetup(m, bC().xyz, bP().x, bP().y);
        return m;
      }
      case 'plain': {
        const m = new THREE.MeshStandardNodeMaterial();
        const sd = settle(m, bC().xyz, float(0.8));
        m.colorNode = sd.color;
        m.roughnessNode = mix(bP().x, float(0.95), sd.dust);
        m.emissiveNode = sunRim();
        m.metalnessNode = bP().y;
        return m;
      }
      case 'fabric': {
        const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
        fabricSetup(m, bC().xyz);
        m.roughnessNode = bP().x;
        return m;
      }
      case 'leather': {
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.65, metalness: 0 });
        leatherSetup(m, bC().xyz);
        return m;
      }
      case 'wood': {
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
        woodSetup(m, bC().xyz);
        return m;
      }
      case 'window': {
        const m = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.2 });
        windowSetup(m, bC().xyz, bP().x);
        return m;
      }
    }
  });
}

/** World-space planar coordinate picked by the dominant normal axis (works on arbitrary props). */
const triCoord = (): N => {
  const n = abs(normalWorld);
  const p = positionWorld;
  return mix(mix(p.zy, p.xz, step(n.x, n.y)), p.xy, step(max(n.x, n.y), n.z));
};

const vec3c = (r: number, g: number, b: number): N => uniform(new THREE.Color(r, g, b));

// ------------------------------------------------------------------ world cohesion
// One world, one dust: sand settles on everything that faces up, and everything standing on the
// ground gets a grimy, sand-splashed foot plus contact occlusion (WebGL has no GTAO). All shared
// uniforms; the Atmosphere drives them.

/** Sand albedo the settled dust takes (matches the terrain's sand). */
export const uDustColor = uniform(new THREE.Color(0.6, 0.41, 0.24)).setGroup(renderGroup);
/** How dusty the world is, 0..1 (a calm baseline; rises after a dust storm and slowly settles back). */
export const uDustCover = uniform(0.35).setGroup(renderGroup);
/** 0 at night, 1 by day (fades the fake sun rim light). */
export const uDaylight = uniform(1).setGroup(renderGroup);
/** Direction toward the sun and how strongly a low sun rims backlit silhouettes (set by the Atmosphere). */
export const uRimSunDir = uniform(new THREE.Vector3(0, 1, 0)).setGroup(renderGroup);
export const uBacklight = uniform(0).setGroup(renderGroup);

const _flatGround = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
_flatGround.needsUpdate = true;
const groundTex: N = texture(_flatGround);
const uGroundSize = uniform(840);
/** Terrain height texture (R = height, world square of `size` m) for the contact layer. */
export function setGroundHeight(tex: THREE.Texture, size: number) {
  groundTex.value = tex;
  uGroundSize.value = size;
}

/**
 * Dust on top, grime at the foot, occlusion where it meets the ground. Returns the new albedo and a
 * dust mask (for roughness); writes the material's aoNode. `amount` scales the whole layer.
 */
function settle(m: THREE.MeshStandardNodeMaterial, base: N, amount: N = float(1)): { color: N; dust: N } {
  const wp = positionWorld;
  const ground = groundTex.sample(wp.xz.div(uGroundSize).add(0.5)).r;
  const above = wp.y.sub(ground);
  const pTap = noise(wp.xz.mul(0.43).add(wp.y.mul(0.13)));
  const patch = pTap.r;
  const speck = pTap.a; // the atlas' per-texel grain (~1 cm here), mip-averaged with distance
  const ny = normalWorld.y;
  const up = smoothstep(0.4, 0.95, ny);
  // a fine, even dusting everywhere that faces up, heavier in drifts (and after a storm)
  const drift = smoothstep(0.45, 0.8, patch.add(uDustCover.mul(0.35)));
  const dust = up.mul(speck.mul(0.25).add(0.2).add(drift.mul(0.45))).mul(uDustCover.mul(0.6).add(0.4)).mul(amount);
  const dustCol = uDustColor.mul(speck.mul(0.2).add(0.9));
  let color: N = mix(base, dustCol, dust.mul(0.7));
  // splash zone on the sides of things: a darker, sand-stained bottom ~0.8 m, ragged with the noise.
  // Floors and tops are left alone (they sit at ground level but aren't "the foot" of anything).
  const side = smoothstep(0.75, 0.3, abs(ny));
  const near = smoothstep(0.0, 0.85, above.add(patch.sub(0.5).mul(0.3)));
  const foot = float(1).sub(near).mul(side).mul(amount);
  color = mix(color, mix(color.mul(0.66), uDustColor.mul(0.5), 0.35), foot.mul(0.5));
  // contact occlusion: the ground blocks half the sky at the very foot of a wall
  m.aoNode = float(1).sub(float(1).sub(smoothstep(0.0, 1.0, above)).mul(side).mul(0.5));
  return { color, dust };
}

/** Global rim-light uniform tinted by the atmosphere each frame. */
export const rimColor = uniform(new THREE.Color(1, 0.6, 0.3));
export const rimStrength = uniform(0.6);

const rim = (power = 3): N =>
  Fn(() => {
    const v = normalize(cameraPosition.sub(positionWorld));
    const f = pow(float(1).sub(max(dot(normalWorld, v), 0)), power);
    return rimColor.mul(f).mul(rimStrength).mul(uDaylight);
  })();

/**
 * Golden-hour backlight: when you look toward a low sun, silhouettes pick up a thin warm edge (the
 * Fresnel sheen and translucency a real low sun gives everything). Zero at noon and at night.
 */
const sunRim = (): N =>
  Fn(() => {
    const v = normalize(cameraPosition.sub(positionWorld));
    const f = pow(float(1).sub(max(dot(normalWorld, v), 0)), 4);
    const toward = pow(max(dot(v.negate(), uRimSunDir), 0), 3);
    return rimColor.mul(f.mul(toward).mul(uBacklight));
  })();

export interface RustOpts { base: THREE.ColorRepresentation; rust?: number; roughness?: number; metalness?: number; scale?: number; paintChips?: boolean; rim?: number }

/** Painted / bare metal with rust blooms, vertical streaks and chipped paint. */
export const rustyMetal = (o: RustOpts) => memo(k('rust', o), () =>
  tag(rustyMetalUnique(o), 'rust', o.base, o.rim ?? 0, [o.rust ?? 0.5, o.roughness ?? 0.55, o.metalness ?? 0.6, o.scale ?? 1]));

export function rustyMetalUnique(o: RustOpts) {
  const m = new THREE.MeshStandardNodeMaterial();
  rustSetup(m, {
    base: uniform(new THREE.Color(o.base)),
    rustAmt: uniform(o.rust ?? 0.5),
    rough: uniform(o.roughness ?? 0.55),
    metal: uniform(o.metalness ?? 0.6),
    s: uniform(o.scale ?? 1),
    rimK: uniform(o.rim ?? 0),
  });
  return m;
}

function rustSetup(m: THREE.MeshStandardNodeMaterial, P: { base: N; rustAmt: N; rough: N; metal: N; s: N; rimK: N }) {
  const { base, rustAmt, rough, metal, s, rimK } = P;
  const c = triCoord().mul(s);
  const t1 = noise(c.mul(0.12));
  const t2 = noise(c.mul(0.7));
  const streak = noise(vec2((positionWorld.x.add(positionWorld.z) as N).mul(s).mul(0.45), positionWorld.y.mul(0.04))).r;
  const field = t1.r.add(streak.sub(0.5).mul(0.5)).add(t2.g.sub(0.5).mul(0.3));
  const rustMask = smoothstep(float(0.62).sub(rustAmt.mul(0.4)), float(0.72).sub(rustAmt.mul(0.3)), field);
  const rustCol = mix(vec3c(0.30, 0.11, 0.05), vec3c(0.62, 0.30, 0.12), t2.r);
  const sd = settle(m, mix(base.mul(float(0.85).add(t2.g.mul(0.2))), rustCol, rustMask));
  m.colorNode = sd.color;
  m.roughnessNode = mix(mix(rough, float(0.95), rustMask), float(0.95), sd.dust);
  m.metalnessNode = mix(metal, float(0.1), rustMask);
  m.normalNode = bumpFromHeight(rustMask.mul(0.6).add(t2.r.mul(0.25)), float(0.05));
  m.emissiveNode = rim(3).mul(rimK).add(sunRim());
}

/** Weathered concrete with stains, pitting and water streaks. */
export const concrete = (tint: THREE.ColorRepresentation = '#9a9184', opts: { scale?: number; stains?: number } = {}) =>
  memo(k('concrete', tint, opts), () => tag(concreteUnique(tint, opts), 'concrete', tint, 0, [opts.scale ?? 1, opts.stains ?? 0.6]));

function concreteUnique(tint: THREE.ColorRepresentation, opts: { scale?: number; stains?: number }) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  concreteSetup(m, uniform(new THREE.Color(tint)), uniform(opts.scale ?? 1), uniform(opts.stains ?? 0.6));
  return m;
}

function concreteSetup(m: THREE.MeshStandardNodeMaterial, base: N, s: N, stainAmt: N) {
  const c = triCoord().mul(s);
  const t1 = noise(c.mul(0.1));
  const t2 = noise(c.mul(0.9));
  const streaks = noise(vec2((positionWorld.x.add(positionWorld.z) as N).mul(s).mul(0.6), positionWorld.y.mul(0.05))).r;
  // vertical rain streaks only make sense on walls; floors get blotchy wear instead (otherwise the
  // streak term, constant in y, paints long diagonal stripes across every slab)
  const upness = smoothstep(0.6, 0.9, abs(normalWorld.y));
  const blotch = noise(c.mul(0.23).add(vec2(0.37, 0.11))).g;
  const stainSrc = mix(streaks.add(t1.r.mul(0.4)), blotch.mul(0.9).add(t1.r.mul(0.45)), upness);
  const stain = smoothstep(0.45, 0.8, stainSrc.sub(0.2)).mul(stainAmt);
  // bug holes (small air pockets) and a few hairline cracks; a crack network everywhere read as tiles
  const pits = smoothstep(0.84, 0.95, noise(c.mul(0.37).add(0.19)).a);
  const crackLine = smoothstep(0.045, 0.0, noise(c.mul(0.11).add(0.6)).b).mul(smoothstep(0.6, 0.75, noise(c.mul(0.05).add(0.3)).g));
  const sd = settle(m, base.mul(float(0.8).add(t1.r.mul(0.3))).mul(float(1).sub(stain.mul(0.45)))
    .mul(float(1).sub(pits.mul(0.35))).mul(float(1).sub(crackLine.mul(0.5))));
  m.colorNode = sd.color;
  m.normalNode = bumpFromHeight(t1.r.mul(0.3).add(t2.a.mul(0.1)).sub(pits.mul(0.4)).sub(crackLine.mul(0.3)), float(0.04));
  m.emissiveNode = sunRim().mul(0.6);
}

/** Corrugated sheet metal: ridges via sin along a local axis, with rust. */
export const corrugated = (base: THREE.ColorRepresentation, rust = 0.6, axis: 'x' | 'y' | 'z' = 'x') =>
  memo(k('corr', base, rust, axis), () => tag(corrugatedUnique(base, rust, axis), `corr-${axis}`, base, 0, [rust, 0.5, 0.7, 1]));

function corrugatedUnique(base: THREE.ColorRepresentation, rust: number, axis: 'x' | 'y' | 'z') {
  const m = rustyMetalUnique({ base, rust, roughness: 0.5, metalness: 0.7 });
  corrSetup(m, axis);
  return m;
}

function corrSetup(m: THREE.MeshStandardNodeMaterial, axis: 'x' | 'y' | 'z') {
  const coord = axis === 'x' ? positionLocal.x : axis === 'y' ? positionLocal.y : positionLocal.z;
  const ridge = sin(coord.mul(Math.PI * 2 * 7)).mul(0.5).add(0.5);
  const n = noise(triCoord().mul(0.5)).r;
  m.normalNode = bumpFromHeight(ridge.mul(1.2).add(n.mul(0.2)), float(0.06));
}

export function plainStandard(c: THREE.ColorRepresentation, roughness = 0.8, metalness = 0, extra: Partial<THREE.MeshStandardNodeMaterialParameters> = {}) {
  return memo(k('plain', c, roughness, metalness, extra), () => {
    const m = new THREE.MeshStandardNodeMaterial({ color: c, roughness, metalness, ...extra });
    // only plain opaque variants batch together (extras like side/transparent change the pipeline)
    if (Object.keys(extra).length) return m;
    // same look as the batched 'plain' family (dust + contact layer); the colour stays m.color
    const sd = settle(m, materialColor, float(0.8));
    m.colorNode = sd.color;
    m.roughnessNode = mix(uniform(roughness), float(0.95), sd.dust);
    m.emissiveNode = sunRim();
    return tag(m, 'plain', c, 0, [roughness, metalness]);
  });
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

/**
 * Glowing material whose intensity/colour are exposed as uniforms. In a MeshBatch it may be merged
 * with other glows: the batch follows `intensity` live but bakes the colour, so anything that animates
 * `color` (the drone eye) must stay out of MeshBatches.
 */
export function glow(c: THREE.ColorRepresentation, intensity = 4) {
  const u = uniform(intensity);
  const col = uniform(new THREE.Color(c));
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.3 });
  m.emissiveNode = col.mul(u);
  tag(m, 'glow', c, 0, [0], u as unknown as { value: number });
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
export const fabric = (c: THREE.ColorRepresentation, roughness = 0.95) => memo(k('fabric', c, roughness), () => tag(fabricUnique(c, roughness), 'fabric', c, 0, [roughness]));

export function fabricUnique(c: THREE.ColorRepresentation, roughness = 0.95) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  fabricSetup(m, uniform(new THREE.Color(c)));
  return m;
}

function fabricSetup(m: THREE.MeshStandardNodeMaterial, base: N) {
  const t = noise(positionLocal.xy.add(positionLocal.z).mul(1.5));
  const fine = noise(positionLocal.xy.sub(positionLocal.z).mul(9)).g;
  m.colorNode = settle(m, base.mul(float(0.72).add(t.r.mul(0.4)).add(fine.mul(0.1))), float(0.6)).color;
  m.normalNode = bumpFromHeight(t.r.mul(0.5).add(fine.mul(0.15)), float(0.012));
  m.emissiveNode = rim(2.5).mul(0.35).add(sunRim());
}

/** Leather / skin with fine grain and rim light. */
export const leather = (c: THREE.ColorRepresentation) => memo(k('leather', c), () => tag(leatherUnique(c), 'leather', c, 0, []));

function leatherUnique(c: THREE.ColorRepresentation) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.65, metalness: 0 });
  leatherSetup(m, uniform(new THREE.Color(c)));
  return m;
}

function leatherSetup(m: THREE.MeshStandardNodeMaterial, base: N) {
  const n = noise(positionLocal.xy.add(positionLocal.z).mul(6)).r;
  m.colorNode = settle(m, base.mul(float(0.8).add(n.mul(0.3))), float(0.5)).color;
  m.normalNode = bumpFromHeight(n.mul(0.4), float(0.015));
  m.emissiveNode = rim(2.5).mul(0.35);
}

/** Window glass that glows faintly from inside. */
export const warmWindow = (c: THREE.ColorRepresentation = '#ffb35c', intensity = 2.5) =>
  memo(k('window', c, intensity), () => tag(warmWindowUnique(c, intensity), 'window', c, 0, [intensity]));

function warmWindowUnique(c: THREE.ColorRepresentation, intensity: number) {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.2 });
  windowSetup(m, uniform(new THREE.Color(c)), uniform(intensity));
  return m;
}

function windowSetup(m: THREE.MeshStandardNodeMaterial, col: N, k: N) {
  const n = noise(positionWorld.xz.mul(0.2).add(time.mul(0.02))).r;
  m.emissiveNode = col.mul(n.mul(0.3).add(0.85)).mul(k);
}

/** Wood with stretched grain. */
export const wood = (c: THREE.ColorRepresentation = '#6b4a2e') => memo(k('wood', c), () => tag(woodUnique(c), 'wood', c, 0, []));

function woodUnique(c: THREE.ColorRepresentation) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  woodSetup(m, uniform(new THREE.Color(c)));
  return m;
}

function woodSetup(m: THREE.MeshStandardNodeMaterial, base: N) {
  const grain = noise(vec2(positionLocal.x.add(positionLocal.z).mul(0.15), positionLocal.y.mul(4))).r;
  m.colorNode = settle(m, base.mul(float(0.7).add(grain.mul(0.45)))).color;
  m.normalNode = bumpFromHeight(grain.mul(0.5), float(0.02));
  m.emissiveNode = sunRim();
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
