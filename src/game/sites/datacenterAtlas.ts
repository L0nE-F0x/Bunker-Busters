import * as THREE from 'three/webgpu';
import { texture, uniform, float, vec3, vec4, sin, uv, mix, smoothstep, abs, positionWorld, time, max, Fn } from 'three/tsl';
import { canvasTexture, norm, MeshBatch } from '../world/kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * One canvas atlas per site for every painted detail (signs, screens, posters, rack doors, stains,
 * frost, light pools). Every quad or box that samples it merges into a handful of meshes: an opaque
 * painted one, an alpha-blended decal one, an unlit screen one per "channel" (so a site can switch
 * its dead screens on with the power) and additive light pools. ColdStorage and The Tube both use it.
 */

export type AtlasDraw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; v0: number; u1: number; v1: number }

export const FONT_DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
export const FONT_UI = '"Chakra Petch", Arial, sans-serif';
export const FONT_MONO = '"JetBrains Mono", monospace';

export function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Text squeezed horizontally to fit `maxW`. */
export function fitText(c: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string, maxW: number, align: CanvasTextAlign = 'center') {
  c.font = font;
  c.fillStyle = fill;
  c.textAlign = align;
  const m = c.measureText(text).width;
  if (m > maxW) {
    c.save();
    c.translate(x, y);
    c.scale(maxW / m, 1);
    c.fillText(text, 0, 0);
    c.restore();
  } else c.fillText(text, x, y);
}

/** Irregular soft blob (oil / soot / water / frost) built from translucent ellipses. */
export function blob(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, rgb: string, n: number, alpha: number, spread = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 1.6) * spread;
    const x = w / 2 + Math.cos(a) * d * w, y = h / 2 + Math.sin(a) * d * h;
    const rad = (0.05 + r() * 0.16) * w * (1 - d);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** Worn painted sign plate: background, border, bolt holes bleeding rust. */
export function signPlate(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, bg: string, border: string) {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = border;
  c.lineWidth = Math.max(5, w * 0.02);
  c.strokeRect(c.lineWidth, c.lineWidth, w - c.lineWidth * 2, h - c.lineWidth * 2);
  for (const [bx, by] of [[0.05, 0.1], [0.95, 0.1], [0.05, 0.9], [0.95, 0.9]]) {
    const x = bx * w, y = by * h;
    const g = c.createLinearGradient(x, y, x, y + h * 0.3);
    g.addColorStop(0, 'rgba(110,50,20,0.6)');
    g.addColorStop(1, 'rgba(110,50,20,0)');
    c.fillStyle = g;
    c.fillRect(x - 3, y, 5 + r() * 4, h * 0.3);
    c.fillStyle = '#3a3430';
    c.beginPath();
    c.arc(x, y, Math.max(3, w * 0.012), 0, Math.PI * 2);
    c.fill();
  }
}

/** Fine speckle + fade, so canvas art never looks print-fresh. */
export function weather(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount = 1) {
  c.save();
  c.globalCompositeOperation = 'multiply';
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(140,110,80,0)');
  g.addColorStop(1, `rgba(110,80,50,${0.35 * amount})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 300 * amount; i++) {
    c.fillStyle = `rgba(70,50,30,${r() * 0.22})`;
    const s = r() * 2.5;
    c.fillRect(r() * w, r() * h, s, s);
  }
  c.restore();
}

/** Radial pool (for additive light on floors). */
export function poolGrad(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.3, `rgba(${rgb},0.55)`);
  g.addColorStop(0.7, `rgba(${rgb},0.12)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** Half-ellipse of light hanging from the top edge (a lamp washing down a wall). */
export function washGrad(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  c.save();
  c.scale(1, h / w);
  const g = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.25, `rgba(${rgb},0.6)`);
  g.addColorStop(0.6, `rgba(${rgb},0.18)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, w);
  c.restore();
}

export class SiteAtlas<K extends string> {
  readonly tex: THREE.CanvasTexture;
  private regions = {} as Record<K, Region>;
  private _paint: THREE.Material | null = null;
  private _decal: THREE.Material | null = null;
  private screens = new Map<string, { m: THREE.Material; k: { value: number } }>();
  private pools = new Map<string, { m: THREE.Material; k: { value: number } }>();

  constructor(name: string, entries: Record<K, [number, number, AtlasDraw]>, size = 2048) {
    const list = (Object.entries(entries) as [K, [number, number, AtlasDraw]][]).sort((a, b) => b[1][1] - a[1][1]);
    const pad = 4;
    this.tex = canvasTexture(size, size, (ctx) => {
      ctx.clearRect(0, 0, size, size);
      let x = 0, y = 0, rowH = 0, seed = 1;
      for (const [key, [w, h, draw]] of list) {
        if (x + w + pad > size) { x = 0; y += rowH + pad; rowH = 0; }
        if (y + h > size) throw new Error(`${name} atlas full at ${key}`);
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        draw(ctx, w, h, rng(seed++ * 7 + 3));
        ctx.restore();
        // half-texel inset so mip filtering does not bleed neighbours in
        this.regions[key] = { u0: (x + 1) / size, u1: (x + w - 1) / size, v0: 1 - (y + h - 1) / size, v1: 1 - (y + 1) / size };
        x += w + pad;
        rowH = Math.max(rowH, h);
      }
    });
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
  }

  /** Map the geometry's 0..1 uvs (every face) onto region `name`. `sub` picks a sub-rectangle of it. */
  map(name: K, g: THREE.BufferGeometry, sub?: [number, number, number, number]) {
    const r = this.regions[name];
    const [su0, sv0, su1, sv1] = sub ?? [0, 0, 1, 1];
    const u0 = r.u0 + (r.u1 - r.u0) * su0, u1 = r.u0 + (r.u1 - r.u0) * su1;
    const v0 = r.v0 + (r.v1 - r.v0) * sv0, v1 = r.v0 + (r.v1 - r.v0) * sv1;
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, u0 + a.getX(i) * (u1 - u0), v0 + a.getY(i) * (v1 - v0));
    return g;
  }

  /** A `w`×`h` quad facing +z built in XY, rotated (rx, ry, rz) then moved to (x, y, z). */
  quad(name: K, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sub?: [number, number, number, number]) {
    const g = this.map(name, new THREE.PlaneGeometry(w, h), sub);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    return norm(g);
  }

  /** Floor decal (lies flat, `rot` about the vertical). */
  floor(name: K, w: number, h: number, x: number, y: number, z: number, rot = 0) {
    return this.quad(name, w, h, x, y, z, -Math.PI / 2, 0, rot);
  }

  /** Opaque lit material for painted things (signs, posters, rack doors). Alpha-tested. */
  paint() {
    if (!this._paint) this._paint = new THREE.MeshStandardNodeMaterial({ map: this.tex, roughness: 0.72, metalness: 0.08, alphaTest: 0.5 });
    return this._paint;
  }

  /** Alpha-blended lit decals (stains, frost, markings), pulled toward the camera. No depth write. */
  decal() {
    if (!this._decal) {
      this._decal = new THREE.MeshStandardNodeMaterial({
        map: this.tex, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      });
    }
    return this._decal;
  }

  /**
   * Unlit glowing screens / backlit signs. Each `channel` is one material with its own level, so a
   * site can keep the always-on art in one and the power-dependent screens in another.
   */
  screen(channel = 'on', level = 1) {
    let s = this.screens.get(channel);
    if (!s) {
      const k = uniform(level);
      const m = new THREE.MeshBasicNodeMaterial({ map: this.tex, alphaTest: 0.5 });
      const t: N = texture(this.tex);
      // faint scanlines and a slow roll, in world space so every screen shares the program
      const scan = sin(positionWorld.y.mul(260).add(time.mul(3))).mul(0.06).add(0.94);
      const roll = smoothstep(0.0, 0.02, abs(sin(positionWorld.y.mul(1.3).sub(time.mul(0.7))))).mul(0.12).add(0.88);
      m.colorNode = vec4(t.rgb.mul(k).mul(scan).mul(roll).add(t.rgb.mul(0.04)), t.a);
      s = { m, k: k as unknown as { value: number } };
      this.screens.set(channel, s);
    }
    return s;
  }

  /** Additive light pools / washes. `level` is driven by the site (night, power). */
  pool(channel = 'night', level = 1) {
    let p = this.pools.get(channel);
    if (!p) {
      const k = uniform(level);
      const m = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
      });
      const t: N = texture(this.tex);
      m.colorNode = t.rgb.mul(t.a).mul(k);
      m.opacityNode = float(1);
      p = { m, k: k as unknown as { value: number } };
      this.pools.set(channel, p);
    }
    return p;
  }
}

let _pv: THREE.MeshStandardNodeMaterial | null = null;
/** Photovoltaic panel: deep blue cells with a silver grid (uv 0..1 per panel), glossy. */
export function pvMaterial() {
  if (_pv) return _pv;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.55 });
  m.colorNode = Fn(() => {
    const u: N = uv();
    const gx = smoothstep(0.9, 0.96, abs(sin(u.x.mul(Math.PI * 6))));
    const gy = smoothstep(0.9, 0.96, abs(sin(u.y.mul(Math.PI * 10))));
    const bus = smoothstep(0.985, 0.995, abs(sin(u.x.mul(Math.PI * 36))));
    const grid = max(max(gx, gy), bus.mul(0.4));
    const cell = mix(vec3(0.02, 0.045, 0.11), vec3(0.04, 0.07, 0.15), sin(u.y.mul(97.0)).mul(0.5).add(0.5));
    return mix(cell, vec3(0.62, 0.64, 0.66), grid);
  })();
  _pv = m;
  return m;
}

let _glass: THREE.MeshStandardNodeMaterial | null = null;
/** See-through glazing for interiors you look into (lobby, core room, control room). */
export function glassMaterial() {
  if (_glass) return _glass;
  _glass = new THREE.MeshStandardNodeMaterial({ color: '#a9c4cf', roughness: 0.06, metalness: 0.4, transparent: true, opacity: 0.22, depthWrite: false });
  return _glass;
}

/** Reverse a non-indexed geometry's winding and normals (for walls you see from the inside). */
export function flipInside(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const u = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n, u]) {
      const sz = a.itemSize;
      for (let k = 0; k < sz; k++) {
        const t = a.array[(i + 1) * sz + k];
        (a.array as Float32Array)[(i + 1) * sz + k] = a.array[(i + 2) * sz + k];
        (a.array as Float32Array)[(i + 2) * sz + k] = t;
      }
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  p.needsUpdate = n.needsUpdate = u.needsUpdate = true;
  return g;
}

/** A MeshBatch pair: everything goes to `near`; only what can be seen from outside goes to `ext`,
 *  the source of the far stand-in (so interiors don't ride along in the silhouette). */
export class SplitBatch {
  readonly near = new MeshBatch();
  readonly ext = new MeshBatch();
  indoor = false;
  add(m: THREE.Material, ...g: THREE.BufferGeometry[]) {
    this.near.add(m, ...g);
    if (!this.indoor) this.ext.add(m, ...g);
    return this;
  }
}
