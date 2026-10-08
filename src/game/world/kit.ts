import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchSpec, familyMaterial, plainStandard, GLOW_SLOTS, type BatchSpec, type Family } from './materials';

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

/** Debug: ?nofam disables family merging (A/B the draw-call savings against identical visuals). */
const NOFAM = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nofam');

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
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    };
    // variants of one material family (see materials.ts) collapse into a single mesh
    const families = new Map<Family, [THREE.Material, THREE.BufferGeometry[]][]>();
    for (const [mat, list] of this.parts) {
      if (!list.length) continue;
      const spec = NOFAM ? undefined : batchSpec(mat);
      if (!spec) { add(merge(list), mat); continue; }
      let f = families.get(spec.family);
      if (!f) families.set(spec.family, (f = []));
      f.push([mat, list]);
    }
    for (const [family, entries] of families) {
      if (entries.length === 1) { add(merge(entries[0][1]), entries[0][0]); continue; }
      for (let i = 0; i < entries.length; i += family === 'glow' ? GLOW_SLOTS : entries.length) {
        const chunk = entries.slice(i, i + (family === 'glow' ? GLOW_SLOTS : entries.length));
        const geos: THREE.BufferGeometry[] = [];
        const ranges: [BatchSpec, number][] = [];
        for (const [mat, list] of chunk) {
          const g = merge(list);
          geos.push(g);
          ranges.push([batchSpec(mat)!, g.attributes.position.count]);
        }
        const geo = mergeGeometries(geos, false);
        if (!geo) throw new Error('family merge failed');
        const n = geo.attributes.position.count;
        const col = new Float32Array(n * 4), par = new Float32Array(n * 4);
        let o = 0;
        ranges.forEach(([s, count], slot) => {
          const p = family === 'glow' ? [slot, 0, 0, 0] : s.p;
          for (let v = 0; v < count; v++, o++) { col.set(s.c, o * 4); par.set(p, o * 4); }
        });
        geo.setAttribute('bColor', new THREE.BufferAttribute(col, 4));
        geo.setAttribute('bParam', new THREE.BufferAttribute(par, 4));
        geo.computeBoundingSphere();
        add(geo, familyMaterial(family, ranges.map(([s]) => s.glow!)));
      }
    }
    return group;
  }

  /**
   * A stand-in for viewing from far away, for DistanceLod. Every piece at least `minSize` across is
   * flattened into the shared 'plain' family in its base colour, so the whole set is ONE draw on a
   * program that already exists. Lit windows and glow keep their own merged meshes so a town still
   * reads at night. Untagged materials (neon, one-off shaders) need a colour in `colors` or are left
   * out. Call before build(): it reads the same parts.
   */
  buildFar(name = 'far', opts: { minSize?: number; colors?: Map<THREE.Material, THREE.ColorRepresentation>; keep?: THREE.Material[] } = {}) {
    const minSize = opts.minSize ?? 0.35;
    const far = new MeshBatch();
    const bb = new THREE.Vector3();
    for (const [mat, list] of this.parts) {
      const spec = batchSpec(mat);
      // `keep`: materials whose look can't be flattened (alpha-tested lattices) stay as they are
      const keep = (spec && (spec.family === 'window' || spec.family === 'glow')) || opts.keep?.includes(mat);
      let flat: THREE.Material | null = null;
      if (!keep) {
        const c = spec ? new THREE.Color(spec.c[0], spec.c[1], spec.c[2]) : opts.colors?.has(mat) ? new THREE.Color(opts.colors.get(mat)!) : null;
        if (!c) continue;
        // the families shade their base down a little (grain, stains, pits); match the average
        flat = plainStandard(c.multiplyScalar(0.85), 0.9);
      }
      for (const g of list) {
        if (!g.boundingBox) g.computeBoundingBox();
        g.boundingBox!.getSize(bb);
        if (Math.max(bb.x, bb.y, bb.z) < minSize) continue;
        far.add(flat ?? mat, g.clone());
      }
    }
    return far.build(name, false, false);
  }
}

/**
 * Layer for meshes only the sun's shadow camera renders (Game enables it on the shadow camera; the
 * main camera never sees it). The third-person body and the shadow proxies below live here.
 */
export const SHADOW_LAYER = 1;

const _proxyMats = new Map<THREE.Side, THREE.Material>();
/** The material a proxy carries. Never drawn in a colour pass; in the depth pass only `side` counts. */
export function proxyMaterial(side: THREE.Side = THREE.FrontSide) {
  let m = _proxyMats.get(side);
  if (!m) _proxyMats.set(side, (m = new THREE.MeshBasicNodeMaterial({ side })));
  return m;
}

/**
 * True when a material's shadow is nothing but its geometry: opaque, no alpha test, no vertex or
 * mask nodes. Three's shadow pass draws every caster with one depth-only override material, so such
 * meshes can share a single draw there whatever their colour shaders are.
 */
export function plainCaster(mat: THREE.Material | THREE.Material[]) {
  if (Array.isArray(mat)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mat as any;
  if (m.transparent || m.alphaTest > 0 || m.alphaHash || m.side === THREE.BackSide || m.shadowSide != null) return false;
  // anything that shapes alpha (the chain-link lattice: opacityNode + alphaTestNode) keeps its own
  // shadow draw, whatever three makes of it there
  if (m.alphaTestNode || m.opacityNode || m.alphaMap) return false;
  return !(m.positionNode || m.castShadowPositionNode || m.castShadowNode || m.maskNode || m.maskShadowNode || m.depthNode || m.displacementMap);
}

/**
 * Shadow-pass batching. Every static caster under `root` with a plainCaster material is merged into
 * one position-only mesh that only the shadow camera sees (SHADOW_LAYER), and the originals stop
 * casting. The shadow map is identical (same triangles, same cull side); the depth pass pays one
 * draw instead of one per material. Hidden objects and the `skip` subtrees (moving parts, anything
 * whose visibility is toggled on its own) are left alone. The proxy is added to `root`, so it follows
 * root's own visibility (LOD swaps). Returns it, or null when nothing qualified.
 */
export function shadowProxy(root: THREE.Object3D, skip: THREE.Object3D[] = [], name = 'shadowProxy') {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const bySide = new Map<THREE.Side, { meshes: THREE.Mesh[]; parts: THREE.BufferGeometry[] }>();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || skip.includes(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.castShadow && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh
      && o.layers.isEnabled(0) && plainCaster(mesh.material) && !Object.keys(mesh.geometry.morphAttributes).length) {
      const src = mesh.geometry;
      const pos = src.attributes.position as THREE.BufferAttribute;
      const start = src.drawRange.start, idx = src.index;
      const count = Math.min(src.drawRange.count, idx ? idx.count : pos.count) - start;
      if (pos && count > 0) {
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const v = idx ? idx.getX(start + i) : start + i;
          arr[i * 3] = pos.getX(v); arr[i * 3 + 1] = pos.getY(v); arr[i * 3 + 2] = pos.getZ(v);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.applyMatrix4(rel.multiplyMatrices(inv, mesh.matrixWorld));
        const side = (mesh.material as THREE.Material).side;
        let e = bySide.get(side);
        if (!e) bySide.set(side, (e = { meshes: [], parts: [] }));
        e.meshes.push(mesh);
        e.parts.push(g);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  let out: THREE.Mesh | null = null;
  for (const [side, { meshes, parts }] of bySide) {
    const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const proxy = new THREE.Mesh(geo, proxyMaterial(side));
    proxy.name = name;
    proxy.layers.set(SHADOW_LAYER);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    root.add(proxy);
    for (const m of meshes) m.castShadow = false;
    out ??= proxy;
  }
  return out;
}

const _bInv = new THREE.Matrix4();
/**
 * Cull a skinned model like any other mesh. Three's own bounds for a SkinnedMesh are a CPU-skinned
 * pass over every vertex, so the Meshy clones used to set `frustumCulled = false` and were drawn
 * (and cast into the sun's shadow map) wherever they stood, even far behind the camera or 140 m out
 * past the shadow box. Instead the caller gives a world sphere that holds the pose (centre + radius,
 * from its own skeleton) each time it poses the model; it's stored in the mesh's frame, so both
 * the camera pass and the shadow pass cull it. Call after the model's matrixWorld is up to date.
 */
export function boundSkinned(mesh: THREE.SkinnedMesh, centre: THREE.Vector3, radius: number) {
  const s = (mesh.boundingSphere ??= new THREE.Sphere());
  _bInv.copy(mesh.matrixWorld).invert();
  s.center.copy(centre).applyMatrix4(_bInv);
  s.radius = radius / mesh.matrixWorld.getMaxScaleOnAxis();
  mesh.frustumCulled = true;
}

const baseUpdateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
/**
 * Three's `updateMatrixWorld` for a whole scene, minus hidden subtrees. Three walks every object on
 * every render of the scene (twice a frame here: the sun's shadow map and the scene pass), hidden or
 * not, and more than half the graph is hidden at any moment: idle skin slots and their bones, far
 * sites' near sets, the other towns. Game turns the scene's auto-update off and calls this once a
 * frame before rendering. A hidden object's matrixWorld is refreshed the frame it's shown again
 * (before it's drawn); code that needs one while hidden uses getWorldPosition / updateWorldMatrix,
 * which walk the parents themselves. Objects with their own override (cameras, skinned meshes)
 * run it, so their extras (view inverse, bind inverse) stay right.
 */
export function updateShownMatrices(o: THREE.Object3D, force = false) {
  if (o.updateMatrixWorld !== baseUpdateMatrixWorld) { o.updateMatrixWorld(force); return; }
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const ch = o.children;
  for (let i = 0, n = ch.length; i < n; i++) if (ch[i].visible) updateShownMatrices(ch[i], force);
}

/** A site's local frame (position on the terrain + yaw). `p()` maps local → world, `m` is the matrix. */
export class Frame {
  readonly m: THREE.Matrix4;
  constructor(public x: number, public y: number, public z: number, public yaw: number) {
    this.m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(1, 1, 1),
    );
  }
  p(lx: number, ly: number, lz: number) {
    return new THREE.Vector3(lx, ly, lz).applyMatrix4(this.m);
  }
}

/**
 * Swaps a detailed group for a cheap stand-in by camera distance (measured from the edge of a site
 * of `radius` around `center`), and hides the stand-in too past `hide`. Hysteresis stops flicker.
 */
export class DistanceLod {
  private farOn = false;
  constructor(
    readonly center: THREE.Vector3,
    readonly radius: number,
    readonly near: THREE.Object3D,
    readonly far: THREE.Object3D | null,
    readonly swap = 140,
    readonly hide = 650,
  ) {
    if (far) far.visible = false;
  }

  update(cam: THREE.Vector3) {
    const d = Math.max(0, Math.hypot(cam.x - this.center.x, cam.z - this.center.z) - this.radius);
    const band = this.swap * 0.08;
    if (this.farOn ? d < this.swap - band : d > this.swap + band) this.farOn = !this.farOn;
    this.near.visible = !this.farOn;
    if (this.far) this.far.visible = this.farOn && d < this.hide;
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
