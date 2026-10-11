import * as THREE from 'three/webgpu';
import { box, beam, place, merge } from './kit';

/**
 * A two-pole ridge tent at (tx, tz) turned `ry`, as merged geometry: `canvas` (two sloped sides that
 * sag between the poles and flare at the hem, closed ends, the door's seam), `ropes` (guy lines to
 * the stakes) and `wood` (pole tips, stakes). Ground at y 0. W is the half-width at the hem.
 * `stripe` [v0, v1] (0 ridge … 1 hem) adds a band down both sides that follows the sag (`band`).
 */
export function ridgeTent(tx: number, tz: number, ry: number, L = 2.7, W = 1.15, H = 1.35, stripe?: [number, number]) {
  const NU = 12, NV = 7;
  const pos: number[] = [], idx: number[] = [];
  const at = (x: number, y: number, z: number) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  // the sides: ridge (v 0) to hem (v 1), sagging inward most between the poles and mid-slope
  const side = (s: number, u: number, v: number, lift: number, P: number[]) => {
    const nx = s * H, ny = W, nl = Math.hypot(nx, ny);
    const sag = -0.075 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15)) + 0.006 * Math.sin(u * 23 + v * 7 + s) * v + lift;
    P.push(s * (W * v + 0.07 * v ** 4) + (nx / nl) * sag, H * (1 - v) + 0.03 + (ny / nl) * sag, -L / 2 + L * u);
  };
  for (const s of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) side(s, i / NU, j / NV, 0, pos);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b2 = a + 1, c = a + NU + 1, d = c + 1;
      if (s > 0) idx.push(a, b2, c, b2, d, c); else idx.push(a, c, b2, b2, c, d);
    }
  }
  // the ends: closed triangles of canvas, drawn in a little between the poles' guy lines
  for (const e of [-1, 1]) {
    const base = pos.length / 3, NH = 6;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NH; i++) {
      const v = j / NV, h = i / NH - 0.5;
      const half = W * v + 0.07 * v ** 4;
      const pull = 0.05 * Math.sin(Math.PI * v) * Math.cos(Math.PI * h);
      at(2 * h * half, H * (1 - v) + 0.03, e * (L / 2 - pull));
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NH; i++) {
      const a = base + j * (NH + 1) + i, b2 = a + 1, c = a + NH + 1, d = c + 1;
      if (e > 0) idx.push(a, c, b2, b2, c, d); else idx.push(a, b2, c, b2, d, c);
    }
  }
  const canvas = new THREE.BufferGeometry();
  canvas.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  canvas.setIndex(idx);
  canvas.computeVertexNormals();
  // the door: a seam down the front, and its flap's edge
  const parts: THREE.BufferGeometry[] = [canvas, box(0.025, H * 0.86, 0.025, 0.02, H * 0.45, L / 2 + 0.005, 0, 0, 0.03)];
  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // guy lines: off each pole tip along the ridge, and from mid-slope out the sides
  const ropes: THREE.BufferGeometry[] = [], woodParts: THREE.BufferGeometry[] = [];
  const stake = (p: THREE.Vector3) => woodParts.push(place(new THREE.BoxGeometry(0.03, 0.18, 0.03), p.x, 0.05, p.z, 0, 0, 0.2));
  for (const e of [-1, 1]) {
    const tip = V3(0, H + 0.04, e * L / 2), out = V3(0, 0.03, e * (L / 2 + 1.0));
    ropes.push(beam(tip, out, 0.006, 4));
    stake(out);
    woodParts.push(place(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), 0, H + 0.06, e * L / 2));
    for (const s of [-1, 1]) {
      const from = V3(s * W * 0.5, H * 0.5 + 0.03, e * L * 0.3), to = V3(s * (W + 0.75), 0.03, e * L * 0.42);
      ropes.push(beam(from, to, 0.005, 4));
      stake(to);
    }
  }
  const move = (g: THREE.BufferGeometry) => { g.rotateY(ry); g.translate(tx, 0, tz); return g; };
  let band: THREE.BufferGeometry | null = null;
  if (stripe) {
    // a painted band, a few mm proud of the canvas, along the whole side (the ends stay plain)
    const bp: number[] = [], bi: number[] = [];
    for (const s of [-1, 1]) {
      const base = bp.length / 3;
      for (let j = 0; j <= 1; j++) for (let i = 0; i <= NU; i++) side(s, i / NU, stripe[j], 0.006, bp);
      for (let i = 0; i < NU; i++) {
        const a = base + i, b2 = a + 1, c = a + NU + 1, d = c + 1;
        if (s > 0) bi.push(a, b2, c, b2, d, c); else bi.push(a, c, b2, b2, c, d);
      }
    }
    band = new THREE.BufferGeometry();
    band.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    band.setIndex(bi);
    band.computeVertexNormals();
    band = move(band);
  }
  return { canvas: move(merge(parts)), ropes: ropes.map(move), wood: woodParts.map(move), band };
}
