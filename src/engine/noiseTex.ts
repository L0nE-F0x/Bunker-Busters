import * as THREE from 'three/webgpu';
import { texture, vec2, float, nodeObject } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Tileable 256² RGBA noise atlas baked once on the CPU. Sampling a texture is far cheaper than
 * evaluating 3D Perlin/Worley per pixel, and it keeps every material on a handful of shaders.
 *   R: fBm (5 octaves)        G: fBm (offset seed, 4 octaves)
 *   B: cell edges (F2 - F1)   A: high-frequency grain
 */
const S = 256;

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, oct: number, base: number, seed: number) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += valueNoise(x * base * f, y * base * f, base * f, seed + o * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function cellEdges(x: number, y: number, cells: number, seed: number) {
  const px = x * cells, py = y * cells;
  const xi = Math.floor(px), yi = Math.floor(py);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      const fx = cx + hash(wx, wy, seed), fy = cy + hash(wx, wy, seed + 1);
      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  return Math.min(1, (f2 - f1) * 1.6);
}

let _tex: THREE.DataTexture | null = null;

export function noiseTexture() {
  if (_tex) return _tex;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const i = (y * S + x) * 4;
      data[i] = Math.round(fbm(u, v, 5, 4, 11) * 255);
      data[i + 1] = Math.round(fbm(u + 0.37, v + 0.71, 4, 6, 97) * 255);
      data[i + 2] = Math.round(cellEdges(u, v, 12, 5) * 255);
      data[i + 3] = Math.round(hash(x, y, 3) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  _tex = tex;
  return tex;
}

/**
 * The atlas never needs a Y flip (a DataTexture: flipY resolves to false on every backend), but
 * on WebGL every texture node carries a flipY uniform that three refreshes per object per frame.
 * With dozens of noise taps per material that was ~0.2 ms of JS per frame; this node skips it.
 */
class AtlasNode extends THREE.TextureNode {
  setupUV(_builder: unknown, uvNode: N) {
    return uvNode;
  }
}

/** Sample the atlas (returns vec4 in 0..1). `uvNode` in "tiles" (1 = one atlas repeat). */
export const noise = (uvNode: N): N => (NOISE_PLAIN ? texture(noiseTexture(), uvNode) : nodeObject(new AtlasNode(noiseTexture(), uvNode)));
/** Debug: ?nofam also restores plain texture nodes for the atlas (A/B). */
const NOISE_PLAIN = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nofam');

/** Signed fBm-ish value in roughly [-0.5, 0.5]. */
export const fbm2 = (uvNode: N): N => noise(uvNode).r.sub(0.5);

/** Two decorrelated taps blended → richer, less obviously tiled noise. */
export const fbmRich = (uvNode: N): N => noise(uvNode).r.add(noise(uvNode.mul(2.37).add(vec2(0.31, 0.77))).g.mul(0.5)).div(1.5).sub(0.5);

export const cracks = (uvNode: N, width = 0.08): N => float(1).sub(noise(uvNode).b.div(width).clamp(0, 1));
