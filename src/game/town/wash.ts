import * as THREE from 'three/webgpu';
import type { Heightfield } from '@/game/world/Heightfield';
import { CAVE_TRAIL } from '@/content/world';
import { norm } from '@/game/world/kit';
import { plainStandard, rustyMetal, wood } from '@/game/world/materials';
import { townDecalMaterial, townRegion } from './townAtlas';
import { Site, V, HALO } from './townKit';
import { M, rnd, reseed, cairn } from './townProps';

/**
 * The wash up to The Cut, in world space: the posted trail (lamps at night), cairns that keep the
 * line between posts, a rope rail along the steepest stretch, and a worn footpath ribbon that hugs
 * the heightfield. Everything batches into the Site; the path is one decal mesh.
 */
export function buildWash(S: Site, hf: Heightfield) {
  reseed(808);
  const P = S.pen();
  const h = (x: number, z: number) => hf.heightAt(x, z);
  const timber = wood('#3a2a1c');
  const cap = rustyMetal({ base: '#8a4030', rust: 0.5, metalness: 0.35 });
  const lamp = S.nightGlow('#ffcc88', 0.25, 2.6);
  const stone = plainStandard('#9a8a72', 0.95);
  const pts = CAVE_TRAIL.map(([x, z]) => new THREE.Vector3(x, h(x, z), z));
  // distance along the polyline
  const segs: { a: THREE.Vector3; b: THREE.Vector3; len: number; s0: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    segs.push({ a: pts[i], b: pts[i + 1], len, s0: total });
    total += len;
  }
  const along = (s: number) => {
    const seg = segs.find((q) => s <= q.s0 + q.len) ?? segs[segs.length - 1];
    const t = Math.min(1, Math.max(0, (s - seg.s0) / seg.len));
    const x = seg.a.x + (seg.b.x - seg.a.x) * t, z = seg.a.z + (seg.b.z - seg.a.z) * t;
    const dx = (seg.b.x - seg.a.x) / seg.len, dz = (seg.b.z - seg.a.z) / seg.len;
    return { x, z, dx, dz };
  };

  // ---- posts with reflector caps and a lamp, every original waypoint but the last
  pts.forEach((p, i) => {
    if (i === pts.length - 1) return;
    const y = p.y;
    P.cyl(timber, 0.08, 0.09, 1.75, p.x, y + 0.85, p.z, 7);
    P.box(cap, 0.34, 0.22, 0.06, p.x, y + 1.5, p.z);
    P.box(M.steelDark(), 0.06, 0.3, 0.06, p.x, y + 1.78, p.z);
    P.put(lamp, new THREE.SphereGeometry(0.055, 8, 6), p.x, y + 1.95, p.z);
    P.cyl(M.steelDark(), 0.07, 0.07, 0.03, p.x, y + 2.01, p.z, 8);
    S.halo(p.x, y + 1.95, p.z, '#ffcc88', 0.55, HALO.NIGHT, 1.5);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.256 + rnd();
      P.put(stone, new THREE.DodecahedronGeometry(0.16 + rnd() * 0.08, 0), p.x + Math.cos(a) * 0.24, y + 0.06, p.z + Math.sin(a) * 0.24, rnd(), rnd() * 6, rnd(), 1, 0.6, 1);
    }
    S.physics.addBox({ x: p.x, y: y + 0.85, z: p.z }, { x: 0.1, y: 0.85, z: 0.1 }, 0);
  });

  // ---- cairns between posts, alternating sides
  let side = 1;
  for (let s = 9; s < total - 6; s += 11 + rnd() * 4) {
    const q = along(s);
    const ox = -q.dz * 2.9 * side, oz = q.dx * 2.9 * side;
    const x = q.x + ox, z = q.z + oz;
    cairn(P, x, h(x, z) - 0.05, z, 0.45 + rnd() * 0.35, stone);
    side = -side;
  }

  // ---- rope rail on the steepest stretch: posts every ~3 m, rope between their tops
  let steep = segs[0];
  for (const q of segs) if (Math.abs(q.b.y - q.a.y) / q.len > Math.abs(steep.b.y - steep.a.y) / steep.len) steep = q;
  {
    const n = Math.floor(steep.len / 3);
    const dx = (steep.b.x - steep.a.x) / steep.len, dz = (steep.b.z - steep.a.z) / steep.len;
    const rope = M.burlap();
    let prev: THREE.Vector3 | null = null;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = steep.a.x + (steep.b.x - steep.a.x) * t - dz * 2.4, z = steep.a.z + (steep.b.z - steep.a.z) * t + dx * 2.4;
      const y = h(x, z);
      P.cyl(timber, 0.05, 0.06, 1.2, x, y + 0.55, z, 6, (rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08);
      P.put(rope, new THREE.TorusGeometry(0.06, 0.018, 4, 8), x, y + 1.05, z, Math.PI / 2, 0, 0);
      S.physics.addBox({ x, y: y + 0.55, z }, { x: 0.06, y: 0.6, z: 0.06 }, 0);
      const top = V(x, y + 1.05, z);
      if (prev) P.wire(rope, prev, top, 0.22, 0.016, 10);
      prev = top;
    }
  }

  // ---- the worn path: a ribbon on the heightfield, in pieces that each show the whole decal
  const r = townRegion('path');
  const pos: number[] = [], uv: number[] = [];
  const W = 2.3, piece = 3.2, step = 2.8;
  for (let s = 0; s < total - 1; s += step) {
    const rows = 5;
    const ring: [number, number, number, number, number][] = [];
    for (let k = 0; k <= rows; k++) {
      const ss = s + (piece * k) / rows;
      const q = along(Math.min(ss, total));
      for (const side2 of [-1, 1]) {
        const x = q.x - q.dz * side2 * W / 2, z = q.z + q.dx * side2 * W / 2;
        ring.push([x, h(x, z) + 0.045, z, side2 < 0 ? 0 : 1, k / rows]);
      }
    }
    for (let k = 0; k < rows; k++) {
      const a = ring[k * 2], b = ring[k * 2 + 1], c = ring[k * 2 + 2], d = ring[k * 2 + 3];
      for (const v of [a, c, b, b, c, d]) {
        pos.push(v[0], v[1], v[2]);
        uv.push(r.u0 + v[3] * (r.u1 - r.u0), r.v0 + v[4] * (r.v1 - r.v0));
      }
    }
  }
  // keep the ribbon facing up whichever way the polyline turns
  const e1 = V(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2]), e2 = V(pos[6] - pos[0], pos[7] - pos[1], pos[8] - pos[2]);
  if (e1.cross(e2).y < 0) for (let i = 0; i < pos.length; i += 9) {
    for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    const j = (i / 3) * 2;
    for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  S.d.add(townDecalMaterial(), norm(g));
  return { center: along(total / 2), length: total };
}
