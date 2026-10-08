import * as THREE from 'three/webgpu';
import { canvasTexture, norm } from './kit';

/**
 * The world's second printed-art atlas: Kade's outpost banners and signs, the Spire's placards. The
 * sites' atlas (jetKit) is full, so everything painted outside a site goes here: one canvas, one
 * lit double-sided material, so every outpost's print is a single draw and every place that uses
 * it shares one shader program. Register art with `printPaint` at module load (before the first
 * `print`); entries are shelf-packed by height.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 1024, PAD = 4;
const DRAW: Record<string, [number, number, Draw]> = {};

export function printPaint(name: string, w: number, h: number, draw: Draw) {
  DRAW[name] = [w, h, draw];
}

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(DRAW).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]);
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    let x = 0, y = 0, rowH = 0, seed = 5;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > W) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > H) throw new Error('print atlas full at ' + name);
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(ctx, w, h, rng(seed++));
      ctx.restore();
      regions[name] = { u0: (x + 1) / W, u1: (x + w - 1) / W, v0: 1 - (y + h - 1) / H, v1: 1 - (y + 1) / H };
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _atlas = { tex, regions };
  return _atlas;
}

/** Map a geometry's 0..1 uvs (every face) onto region `name`. */
export function printMap(name: string, g: THREE.BufferGeometry) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no print entry ' + name);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return g;
}

/** A w×h quad showing `name`, built facing +z, then placed by `m`. */
export function print(name: string, w: number, h: number, m: THREE.Matrix4, segX = 1, segY = 1) {
  return norm(printMap(name, new THREE.PlaneGeometry(w, h, segX, segY)).applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, double-sided (banners and sheets show through from behind). */
export function printMaterial() {
  return (_mat ??= new THREE.MeshStandardNodeMaterial({ map: atlas().tex, roughness: 0.88, side: THREE.DoubleSide }));
}
