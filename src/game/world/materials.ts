import * as THREE from 'three/webgpu';
import {
  Fn, vec2, float, positionWorld, positionLocal, normalWorld, mix, smoothstep, abs, sin, uniform, time, pow, max,
  fract, step, uv, cameraPosition, normalize, dot,
} from 'three/tsl';
import { bumpFromHeight } from './Terrain';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

// NOTE: every tweakable parameter is a uniform, so all instances of a factory share one shader program.

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
export function rustyMetal(o: RustOpts) {
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
export function concrete(tint: THREE.ColorRepresentation = '#9a9184', opts: { scale?: number; stains?: number } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const s = uniform(opts.scale ?? 1);
  const stainAmt = uniform(opts.stains ?? 0.6);
  const base = uniform(new THREE.Color(tint));
  const c = triCoord().mul(s);
  const t1 = noise(c.mul(0.1));
  const t2 = noise(c.mul(0.9));
  const streaks = noise(vec2(positionWorld.x.add(positionWorld.z).mul(s).mul(0.6), positionWorld.y.mul(0.05))).r;
  const stain = smoothstep(0.45, 0.8, streaks.add(t1.r.mul(0.4)).sub(0.2)).mul(stainAmt);
  const pits = smoothstep(0.1, 0.0, t2.b);
  m.colorNode = base.mul(float(0.8).add(t1.r.mul(0.3))).mul(float(1).sub(stain.mul(0.45))).mul(float(1).sub(pits.mul(0.3)));
  m.normalNode = bumpFromHeight(t1.r.mul(0.3).add(t2.a.mul(0.1)).sub(pits.mul(0.5)), float(0.04));
  return m;
}

/** Corrugated sheet metal: ridges via sin along a local axis, with rust. */
export function corrugated(base: THREE.ColorRepresentation, rust = 0.6, axis: 'x' | 'y' | 'z' = 'x') {
  const m = rustyMetal({ base, rust, roughness: 0.5, metalness: 0.7 });
  const coord = axis === 'x' ? positionLocal.x : axis === 'y' ? positionLocal.y : positionLocal.z;
  const ridge = sin(coord.mul(Math.PI * 2 * 7)).mul(0.5).add(0.5);
  const n = noise(triCoord().mul(0.5)).r;
  m.normalNode = bumpFromHeight(ridge.mul(1.2).add(n.mul(0.2)), float(0.06));
  return m;
}

export function plainStandard(c: THREE.ColorRepresentation, roughness = 0.8, metalness = 0, extra: Partial<THREE.MeshStandardNodeMaterialParameters> = {}) {
  return new THREE.MeshStandardNodeMaterial({ color: c, roughness, metalness, ...extra });
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
export function chainLink() {
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
export function fabric(c: THREE.ColorRepresentation, roughness = 0.95) {
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
export function leather(c: THREE.ColorRepresentation) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.65, metalness: 0 });
  const base = uniform(new THREE.Color(c));
  const n = noise(positionLocal.xy.add(positionLocal.z).mul(6)).r;
  m.colorNode = base.mul(float(0.8).add(n.mul(0.3)));
  m.normalNode = bumpFromHeight(n.mul(0.4), float(0.015));
  m.emissiveNode = rim(2.5).mul(0.6);
  return m;
}

/** Window glass that glows faintly from inside. */
export function warmWindow(c: THREE.ColorRepresentation = '#ffb35c', intensity = 2.5) {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.2 });
  const col = uniform(new THREE.Color(c));
  const k = uniform(intensity);
  const n = noise(positionWorld.xz.mul(0.2).add(time.mul(0.02))).r;
  m.emissiveNode = (col as N).mul(n.mul(0.3).add(0.85)).mul(k);
  return m;
}

/** Wood with stretched grain. */
export function wood(c: THREE.ColorRepresentation = '#6b4a2e') {
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
