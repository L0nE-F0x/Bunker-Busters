import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry kit: helpers that produce transformed, attribute-normalised (position/normal/uv, non-indexed)
 * BufferGeometries so arbitrary pieces can be merged into one draw call per material.
 */

export function norm(g: THREE.BufferGeometry) {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.uv) {
    const n = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const key of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv'].includes(key)) geo.deleteAttribute(key);
  }
  geo.morphAttributes = {};
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function place(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return norm(g);
}

export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) =>
  place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);

export const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 10, rx = 0, ry = 0, rz = 0) =>
  place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);

/** Cylinder spanning two points. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  return norm(g);
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map(norm), false);
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
}

/** Builds a group from {material → geometry parts} with one mesh per material. */
export class MeshBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, ...g: THREE.BufferGeometry[]) {
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push(...g);
    return this;
  }
  build(name = 'batch', castShadow = true, receiveShadow = true) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.parts) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(merge(list), mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
}

/** Catenary-ish sagging wire between two points as a thin tube. */
export function wire(a: THREE.Vector3, b: THREE.Vector3, sag: number, r = 0.02, segs = 16) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return norm(new THREE.TubeGeometry(curve, segs, r, 4, false));
}

/** Text/graphics on a canvas → texture. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Grime pass for canvas art: noise speckle, scratches and fading. */
export function grime(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 1, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(120,90,60,0.0)');
  grad.addColorStop(1, `rgba(90,60,30,${0.45 * amount})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400 * amount; i++) {
    ctx.fillStyle = `rgba(60,40,25,${rnd() * 0.25})`;
    const r = rnd() * 3;
    ctx.fillRect(rnd() * w, rnd() * h, r, r);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(230,220,200,0.18)';
  for (let i = 0; i < 40 * amount; i++) {
    ctx.lineWidth = rnd() * 2;
    ctx.beginPath();
    const x = rnd() * w, y = rnd() * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 40);
    ctx.stroke();
  }
  // torn / peeled patches
  for (let i = 0; i < 6 * amount; i++) {
    ctx.fillStyle = `rgba(${150 + rnd() * 40},${120 + rnd() * 30},${90 + rnd() * 20},${0.5 + rnd() * 0.4})`;
    ctx.beginPath();
    const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 50;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = r * (0.5 + rnd() * 0.6);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6);
    }
    ctx.fill();
  }
  ctx.restore();
}
