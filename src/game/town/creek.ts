import * as THREE from 'three/webgpu';
import type { AmbientKind } from '@/engine/audio';
import type { Physics } from '@/engine/physics';
import type { Flicker } from '@/game/world/Landmarks';
import type { NpcDef } from '@/game/world/npc';
import { box, merge, wire } from '@/game/world/kit';
import { glow, wood, plainStandard } from '@/game/world/materials';
import type { VirtualLight } from '@/game/world/lights';
import { Site, Pen, V, HALO, wall, floor, deck, sheetRoof, gutter, post, railing, bulb, type Hole } from './townKit';
import {
  M, rnd, reseed, crate, drum, tire, jerrycan, sack, sandbags, bucket, chair, lawnChair, table, bed, nightstand, crt, dresser,
  shelves, stock, stove, lantern, acUnit, swampCooler, dish, solarPanel, vent, utilityPole, sedan, pickup, drift, log, guitar,
  sconce, laundry, payphone, cairn,
} from './townProps';
import { LOOKS } from './people';

type Mat = THREE.Material;
type Col = ReturnType<Physics['addBox']>;

/** What the town needs from Settlement (spots, doors and blockers keep their gameplay ids). */
export interface Hooks {
  spot(id: string, x: number, y: number, z: number): void;
  door(id: string, pivot: THREE.Object3D, collider: Col, sign: number): void;
  blocker(id: string, obj: THREE.Object3D, collider: Col): void;
  npc(def: NpcDef): void;
  audio(kind: AmbientKind, x: number, y: number, z: number): void;
  flicker(f: Flicker): void;
}

/** Live handles Settlement.update drives. */
export interface CreekLive {
  /** clinic glass + tubes: 0.15 when dark, ~3 with the generator on */
  power: { value: number };
  clinicLight: VirtualLight;
  generatorLed: { value: number };
}

const DOOR_H = 2.2;
/** ground-floor height of the north row and the Till */
const FY = 0.3;
/** motel floor */
const MY = 0.18;

/** A dynamic door leaf: one merged mesh hinged at its west edge. Geometry is local to the hinge. */
function swingDoor(S: Site, H: Hooks, id: string, g0: number, g1: number, z: number, y0: number, sign: number, mat: Mat, style: 'plank' | 'panel') {
  const w = g1 - g0 - 0.04, h = DOOR_H - 0.04;
  const parts: THREE.BufferGeometry[] = [box(w, h, 0.06, w / 2 + 0.02, h / 2, 0)];
  if (style === 'plank') {
    for (let i = 1; i < 6; i++) parts.push(box(0.012, h - 0.02, 0.07, 0.02 + (i * w) / 6, h / 2, 0));
    for (const y of [0.25, h - 0.25]) parts.push(box(w - 0.1, 0.12, 0.04, w / 2 + 0.02, y, 0.05), box(w - 0.1, 0.12, 0.04, w / 2 + 0.02, y, -0.05));
    const brace = box(0.1, Math.hypot(w - 0.2, h - 0.62) , 0.035, w / 2 + 0.02, h / 2, 0.05, 0, 0, Math.atan2(w - 0.2, h - 0.62));
    parts.push(brace);
  } else {
    for (const [px, py, pw, ph] of [[0.25, 0.55, 0.5, 0.75], [0.25, 1.55, 0.5, 0.75], [0.75, 0.55, 0.5, 0.75], [0.75, 1.55, 0.5, 0.75]]) {
      for (const s of [1, -1]) parts.push(box(pw * w * 0.85, ph, 0.025, px * w + 0.02, py, s * 0.035));
    }
  }
  // knob / latch on the free edge
  parts.push(box(0.05, 0.05, 0.16, w - 0.08, 1.0, 0));
  const pivot = new THREE.Group();
  pivot.position.set(g0, y0, z);
  const mesh = new THREE.Mesh(merge(parts), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  S.root.add(pivot);
  const collider = S.col((g0 + g1) / 2, y0 + DOOR_H / 2, z, (g1 - g0) / 2, DOOR_H / 2, 0.06);
  H.door(id, pivot, collider, sign);
}

/** Exterior skin + base plinth along a rectangle (outer faces). */
function plinth(S: Site, x0: number, x1: number, z0: number, z1: number, h: number, mat: Mat, skip: [number, number][] = []) {
  const o = 0.05;
  const run = (a: number, b: number, z: number) => {
    let s = a;
    for (const [k0, k1] of skip.filter(([k0]) => k0 >= a && k0 < b).sort((p, q) => p[0] - q[0])) {
      if (k0 > s) S.b.add(mat, box(k0 - s, h, o * 2, (s + k0) / 2, h / 2, z));
      s = k1;
    }
    if (b > s) S.b.add(mat, box(b - s, h, o * 2, (s + b) / 2, h / 2, z));
  };
  run(x0 - o, x1 + o, z1);
  run(x0 - o, x1 + o, z0);
  S.b.add(mat, box(o * 2, h, z1 - z0, x0, h / 2, (z0 + z1) / 2), box(o * 2, h, z1 - z0, x1, h / 2, (z0 + z1) / 2));
}

/** Grime along a wall base: decal bands, laid end to end. `ry` faces the wall's outward normal. */
function grimeRun(S: Site, ax: number, az: number, bx: number, bz: number, ry: number, y = 0.5, hgt = 1.0) {
  const len = Math.hypot(bx - ax, bz - az);
  for (let s = 0; s < len - 0.1; s += 2.6) {
    const w = Math.min(2.9, len - s + 0.3);
    const t = (s + w / 2) / len;
    S.decal('grimeBand', w, hgt * (0.85 + rnd() * 0.3), ax + (bx - ax) * t, y, az + (bz - az) * t, ry);
  }
}

function sandRun(S: Site, ax: number, az: number, bx: number, bz: number, ry: number) {
  const len = Math.hypot(bx - ax, bz - az);
  for (let s = 0; s < len - 0.1; s += 2.4) {
    const w = Math.min(2.6, len - s + 0.3);
    const t = (s + w / 2) / len;
    S.decal('sand', w, 0.42 + rnd() * 0.2, ax + (bx - ax) * t, 0.18, az + (bz - az) * t, ry);
  }
}

// ======================================================================= the diner
function diner(S: Site, H: Hooks) {
  const x0 = -23.6, x1 = -12.2, zF = -4.5, zB = -11.6, t = 0.26, top = 3.55;
  const stucco = M.stucco(), red = M.red(), chrome = M.chrome();
  const warm = S.nightGlow('#ffb066', 0.35, 2.0);
  const inner = M.plaster();
  const dado = { y: FY + 1.0, mat: M.woodRed(), rail: chrome };
  const win = (a: number, b: number, y0 = FY + 0.75, y1 = FY + 2.15): Hole => ({ a, b, y0, y1, kind: 'window', glass: warm, grid: [Math.max(2, Math.round((b - a) / 1.0)), 1] });
  wall(S, { a: [x0, zF - t / 2], b: [x1, zF - t / 2], n: [0, 1], y0: 0, y1: top, t, out: stucco, inn: inner, dado, trim: chrome, skirting: M.woodDark(),
    holes: [win(0.6, 3.5), { a: 4.3, b: 5.9, y0: FY, y1: FY + DOOR_H, kind: 'door' }, win(6.6, 8.8), win(9.2, 10.8)] });
  wall(S, { a: [x0, zB + t / 2], b: [x1, zB + t / 2], n: [0, -1], y0: 0, y1: top, t, out: stucco, inn: inner, dado, trim: M.red() });
  wall(S, { a: [x0 + t / 2, zF - t], b: [x0 + t / 2, zB + t], n: [-1, 0], y0: 0, y1: top, t, out: stucco, inn: inner, dado, trim: chrome,
    holes: [{ a: 1.4, b: 2.9, y0: FY + 0.85, y1: FY + 2.05, kind: 'window', glass: warm, grid: [2, 1] }] });
  wall(S, { a: [x1 - t / 2, zF - t], b: [x1 - t / 2, zB + t], n: [1, 0], y0: 0, y1: top, t, out: stucco, inn: inner, dado, trim: chrome,
    holes: [{ a: 1.2, b: 2.7, y0: FY + 0.85, y1: FY + 2.05, kind: 'window', glass: warm, grid: [2, 1] }] });
  plinth(S, x0, x1, zB, zF, FY + 0.02, M.found(), [[-19.3, -17.7]]);
  // red kick band and chrome strip under the front windows, the diner's signature
  S.b.add(red, box(x1 - x0 + 0.04, 0.5, 0.03, (x0 + x1) / 2, FY + 0.3, zF + 0.015));
  S.b.add(chrome, box(x1 - x0 + 0.04, 0.05, 0.04, (x0 + x1) / 2, FY + 0.57, zF + 0.02));
  // roof: tar slab, parapets with coping, the tall front fascia
  floor(S, M.tar(), x0, x1, zB, zF, top + 0.18, 0.2, false);
  S.b.add(stucco, box(x1 - x0, 0.85, 0.22, (x0 + x1) / 2, top + 0.42, zF - 0.11));
  S.b.add(red, box(x1 - x0 + 0.06, 0.42, 0.04, (x0 + x1) / 2, top + 0.42, zF + 0.02));
  S.b.add(M.cream(), box(x1 - x0 + 0.06, 0.08, 0.05, (x0 + x1) / 2, top + 0.15, zF + 0.03), box(x1 - x0 + 0.06, 0.08, 0.05, (x0 + x1) / 2, top + 0.69, zF + 0.03));
  for (const [a, b, z] of [[x0, x1, zB + 0.1]] as const) S.b.add(stucco, box(b - a, 0.45, 0.2, (a + b) / 2, top + 0.22, z));
  S.b.add(stucco, box(0.2, 0.45, zF - zB, x0 + 0.1, top + 0.22, (zF + zB) / 2), box(0.2, 0.45, zF - zB, x1 - 0.1, top + 0.22, (zF + zB) / 2));
  S.b.add(M.found(), box(x1 - x0 + 0.1, 0.06, 0.3, (x0 + x1) / 2, top + 0.88, zF - 0.11), box(x1 - x0 + 0.1, 0.06, 0.26, (x0 + x1) / 2, top + 0.47, zB + 0.1));
  const R = S.pen();
  swampCooler(R, -14.4, top + 0.2, -9.6, 0.3);
  vent(R, -21.0, top + 0.2, -10.4, 0.1, 0.7);
  vent(R, -19.6, top + 0.2, -9.0, 0.07, 0.5);
  // kitchen exhaust: a hooded stack with soot
  R.cyl(M.steelDark(), 0.2, 0.2, 1.6, -15.3, top + 1.0, -10.6, 10).put(M.steelDark(), new THREE.ConeGeometry(0.34, 0.28, 10), -15.3, top + 1.95, -10.6);
  R.cyl(M.steelDark(), 0.012, 0.012, 0.25, -15.15, top + 1.75, -10.6, 4);
  S.decal('soot', 0.8, 0.9, -15.3, top + 0.95, -10.39, 0);

  // ---- roof sign: on legs, bulb-chased, neon-edged, lit from above
  const sx = -17.9, sy = top + 2.05, sz = -5.6;
  S.sign('eats', 4.8, 2.4, 0.16, sx, sy, sz);
  S.b.add(M.steelDark(), box(4.96, 2.56, 0.1, sx, sy, sz - 0.12));
  for (const lx of [-1.6, 1.6]) {
    S.b.add(M.steelDark(), box(0.12, sy - 1.1 - top, 0.12, sx + lx, top + (sy - 1.1 - top) / 2, sz - 0.2));
    S.b.add(M.steelDark(), box(0.1, 0.1, 1.3, sx + lx, top + 0.3, sz - 0.65), box(0.08, 1.4, 0.08, sx + lx, top + 0.8, sz - 0.9, 0, -0.75));
  }
  S.b.add(M.steelDark(), box(3.6, 0.08, 0.08, sx, top + 0.6, sz - 0.2));
  const neonFlicker = glow('#ff3a6e', 5);
  const tube = (a: THREE.Vector3, b: THREE.Vector3) => S.b.add(neonFlicker.material, box(0.05, 0.05, a.distanceTo(b), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z)));
  const nz = sz + 0.12;
  tube(V(sx - 2.5, sy + 1.3, nz), V(sx + 2.5, sy + 1.3, nz));
  tube(V(sx - 2.5, sy - 1.3, nz), V(sx + 2.5, sy - 1.3, nz));
  S.b.add(neonFlicker.material, box(0.05, 2.6, 0.05, sx - 2.5, sy, nz), box(0.05, 2.6, 0.05, sx + 2.5, sy, nz));
  H.flicker({ set: (v) => (neonFlicker.intensity.value = 5 * v), phase: 2.2, speed: 1.1, broken: 0.35 });
  S.halo(sx - 2.5, sy, nz + 0.05, '#ff3a6e', 0.8, HALO.NEON, 1.2);
  S.halo(sx + 2.5, sy, nz + 0.05, '#ff3a6e', 0.8, HALO.NEON, 1.2);
  for (const lx of [-1.7, 0, 1.7]) {
    const P = S.pen(sx + lx, sy + 1.25, sz - 0.05);
    P.beam(M.steelDark(), V(0, 0, 0), V(0, 0.35, 0.35), 0.015, 4);
    P.put(M.steelDark(), new THREE.ConeGeometry(0.12, 0.12, 10, 1, true), 0, 0.33, 0.45, Math.PI * 0.75, 0, 0);
    S.halo(sx + lx, sy + 1.55, sz + 0.45, '#ffd29a', 0.55, HALO.NIGHT, 1.3);
  }
  S.wash(4.6, 2.2, sx, sy + 1.25, sz + 0.1, 0);
  H.audio('neon', sx, sy, sz);

  // ---- canopy and stoop
  floor(S, M.slab(), x0 - 0.3, x1 + 0.3, zF, zF + 1.9, FY, 0.2, true, 'concrete');
  floor(S, M.slab(), x0 - 0.3, x1 + 0.3, zF + 1.9, zF + 2.25, FY / 2, 0.2, true, 'concrete');
  const cz = zF + 1.75;
  for (const px of [-23.4, -20.5, -16.6, -12.4]) post(S, M.chrome(), px, cz, FY, 3.0, 0.05, false);
  S.b.add(red, box(x1 - x0 + 0.6, 0.12, 2.1, (x0 + x1) / 2, 3.04, zF + 0.95, 0, -0.04));
  S.b.add(M.cream(), box(x1 - x0 + 0.64, 0.24, 0.05, (x0 + x1) / 2, 2.98, zF + 2.0), box(x1 - x0 + 0.64, 0.05, 0.06, (x0 + x1) / 2, 2.82, zF + 2.02));
  for (const lx of [-21.8, -18.5, -14.6]) {
    const g = S.nightGlow('#ffd8a8', 0.3, 4.5);
    S.b.add(g, box(0.5, 0.03, 0.18, lx, 2.95, zF + 1.0));
    S.halo(lx, 2.9, zF + 1.0, '#ffd2a0', 0.7, HALO.NIGHT, 1.2);
    S.pool('poolWarm', 3.2, 3.2, lx, FY + 0.02, zF + 1.1);
  }
  S.light(-18.5, 2.6, zF + 1.2, 0xffc080, 5, 9);
  // porch life: a bench, a newspaper box, a trash can, a coat of dust
  const P = S.pen();
  table(P, -22.0, zF + 0.5, 1.6, 0.42, 0.45, 0, FY, M.woodGrey(), M.steelDark(), true);
  P.box(M.woodGrey(), 1.6, 0.35, 0.04, -22.0, FY + 0.7, zF + 0.3, 0, -0.15);
  P.box(M.drumBlue(), 0.45, 1.0, 0.4, -13.2, FY + 0.5, zF + 0.4).box(M.dark(), 0.36, 0.3, 0.02, -13.2, FY + 0.75, zF + 0.61);
  P.col(-13.2, FY + 0.5, zF + 0.4, 0.23, 0.5, 0.2);
  drum(P, -24.2, zF + 1.4, M.drumRed(), 0.3, false, 0, true);
  S.sign('open', 0.7, 0.3, 0.03, -15.9, FY + 1.75, zF - 0.2);
  S.halo(-15.9, FY + 1.75, zF - 0.1, '#ff5a86', 0.9, HALO.NIGHT, 0.8);
  S.sign('missing', 0.42, 0.58, 0.01, -17.35, FY + 1.45, zF + 0.006);
  S.sign('cola', 0.9, 1.35, 0.03, -12.2 + 0.03, FY + 1.7, -9.6, Math.PI / 2);

  // ---- inside: floor, ceiling, light
  floor(S, M.black(), x0 + t, x1 - t, zB + t, zF, FY + 0.01, 0.31, true, 'concrete');
  for (let x = x0 + t; x < x1 - t - 0.05; x += 2) for (let z = zF - t; z > zB + t + 0.05; z -= 2) {
    const w = Math.min(2, x1 - t - x), d = Math.min(2, z - zB - t);
    S.floorDecal('checker', w, d, x + w / 2, FY + 0.013, z - d / 2);
  }
  S.floorDecal('dirt', 2.4, 2.4, -18.4, FY + 0.016, -5.6, 0.6);
  S.floorDecal('stain', 1.6, 1.6, -16.4, FY + 0.016, -7.0, 1.2);
  floor(S, M.ceiling(), x0 + t, x1 - t, zB + t, zF - t, 3.36, 0.06, false);
  // ceiling fan over the booths
  {
    const F = S.pen(-21.4, 3.3, -7.4, 0.4);
    F.cyl(M.chrome(), 0.012, 0.012, 0.35, 0, -0.17, 0, 5).cyl(M.chrome(), 0.11, 0.09, 0.12, 0, -0.38, 0, 10);
    for (let i = 0; i < 4; i++) F.box(M.woodDark(), 0.62, 0.012, 0.14, Math.cos(i * 1.57) * 0.4, -0.4, Math.sin(i * 1.57) * 0.4, -i * 1.57, 0.08);
  }
  // pendants over the counter
  for (const lx of [-17.8, -15.8, -13.8]) {
    const g = S.nightGlow('#ffcf8a', 1.2, 5);
    S.pen(lx, 3.3, -8.2).cyl(M.cable(), 0.006, 0.006, 0.7, 0, -0.35, 0, 4).put(red, new THREE.ConeGeometry(0.2, 0.2, 14, 1, true), 0, -0.78, 0).put(g, new THREE.SphereGeometry(0.06, 8, 6), 0, -0.84, 0);
    S.halo(lx, 2.44, -8.2, '#ffcf8a', 0.7, HALO.ON, 1.3);
    S.pool('poolWarm', 1.6, 1.6, lx, FY + 1.06, -8.2);
  }
  S.pool('poolWarm', 5, 4, -15.8, FY + 0.02, -7.6);
  S.light(-15.8, 2.4, -8.0, 0xffb874, 9, 10);
  S.light(-21.6, 2.6, -6.4, 0xffb874, 4, 8);

  // ---- booths along the front windows
  const booth = (cx: number) => {
    const z0 = zF - t, z1 = z0 - 1.3;
    const zc = (z0 + z1) / 2;
    for (const s of [-1, 1]) {
      const bx = cx + s * 0.8;
      P.box(M.woodDark(), 0.5, 0.42, 1.24, bx, FY + 0.21, zc);
      P.box(M.vinylRed(), 0.48, 0.1, 1.22, bx, FY + 0.47, zc, 0, 0, 0);
      P.box(M.vinylRed(), 0.16, 0.66, 1.22, bx + s * 0.2, FY + 0.82, zc, 0, 0, s * -0.08);
      P.box(chrome, 0.05, 0.04, 1.24, bx + s * 0.25, FY + 1.16, zc);
    }
    P.box(M.enamel(), 0.82, 0.04, 1.16, cx, FY + 0.76, zc - 0.02).box(chrome, 0.84, 0.03, 1.18, cx, FY + 0.73, zc - 0.02);
    P.cyl(chrome, 0.04, 0.04, 0.72, cx, FY + 0.37, zc - 0.1, 8).cyl(chrome, 0.2, 0.22, 0.03, cx, FY + 0.02, zc - 0.1, 12);
    // condiments, a mug, a plate
    P.box(chrome, 0.1, 0.12, 0.06, cx - 0.2, FY + 0.84, z0 - 0.12).cyl(M.drumRed(), 0.025, 0.028, 0.16, cx - 0.04, FY + 0.86, z0 - 0.1, 7).cyl(M.yellow(), 0.025, 0.028, 0.15, cx + 0.03, FY + 0.855, z0 - 0.1, 7);
    P.cyl(M.enamel(), 0.04, 0.035, 0.09, cx + 0.2, FY + 0.83, zc - 0.25, 9).cyl(M.enamel(), 0.12, 0.1, 0.015, cx - 0.15, FY + 0.79, zc - 0.3, 14);
    P.col(cx, FY + 0.6, zc, 1.08, 0.6, 0.66);
  };
  booth(-22.25);
  booth(-16.35);
  booth(-13.95);

  // ---- counter, stools, Nia
  const cx0 = -18.6, cx1 = -13.0, cz0 = -7.9, cz1 = -8.5;
  const ccx = (cx0 + cx1) / 2, ccz = (cz0 + cz1) / 2;
  P.box(M.woodDark(), cx1 - cx0, 0.95, 0.52, ccx, FY + 0.48, ccz - 0.03);
  for (let x = cx0 + 0.35; x < cx1 - 0.2; x += 0.7) P.box(M.woodRed(), 0.56, 0.62, 0.02, x, FY + 0.55, cz0 + 0.0);
  P.box(chrome, cx1 - cx0, 0.1, 0.03, ccx, FY + 0.06, cz0 + 0.01);
  P.box(M.enamel(), cx1 - cx0 + 0.08, 0.05, 0.66, ccx, FY + 1.03, ccz).box(chrome, cx1 - cx0 + 0.1, 0.04, 0.04, ccx, FY + 1.0, cz0 + 0.04);
  P.cyl(chrome, 0.022, 0.022, cx1 - cx0, ccx, FY + 0.22, cz0 + 0.16, 6, 0, 0, Math.PI / 2);
  P.col(ccx, FY + 0.53, ccz, (cx1 - cx0) / 2, 0.53, 0.33);
  for (const x of [-18.1, -17.0, -15.9, -14.8, -13.7]) {
    P.cyl(chrome, 0.035, 0.035, 0.64, x, FY + 0.32, -7.45, 6).cyl(chrome, 0.19, 0.21, 0.03, x, FY + 0.015, -7.45, 12);
    P.cyl(M.vinylRed(), 0.19, 0.18, 0.1, x, FY + 0.69, -7.45, 14).cyl(chrome, 0.195, 0.195, 0.02, x, FY + 0.635, -7.45, 14);
    P.put(chrome, new THREE.TorusGeometry(0.15, 0.01, 4, 12), x, FY + 0.28, -7.45, Math.PI / 2, 0, 0);
  }
  // on the counter: register, pie dome, napkins, mugs, a coffee pot
  P.box(M.steelDark(), 0.4, 0.22, 0.36, -13.5, FY + 1.17, ccz, 0, 0.1).box(M.cream(), 0.36, 0.06, 0.2, -13.5, FY + 1.31, ccz - 0.06, 0, -0.5);
  P.cyl(chrome, 0.16, 0.18, 0.04, -14.6, FY + 1.07, ccz, 14).cyl(M.woodPale(), 0.14, 0.14, 0.05, -14.6, FY + 1.12, ccz, 14);
  P.put(M.glassDark(), new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), -14.6, FY + 1.1, ccz);
  for (const x of [-17.6, -16.2]) P.box(chrome, 0.1, 0.13, 0.07, x, FY + 1.12, ccz);
  for (const x of [-18.2, -17.2, -15.4]) P.cyl(M.enamel(), 0.045, 0.04, 0.09, x + rnd() * 0.2, FY + 1.1, ccz - 0.12 + rnd() * 0.1, 9);
  P.cyl(M.glassDark(), 0.08, 0.09, 0.16, -16.9, FY + 1.13, ccz - 0.1, 10).cyl(M.black(), 0.06, 0.08, 0.05, -16.9, FY + 1.23, ccz - 0.1, 10);
  H.npc({ id: 'nia', look: LOOKS.nia, pose: 'counter', x: -16.2, y: FY, z: -9.05, yaw: 0, surface: 1.05, notice: 6 });
  H.spot('nia', -16.2, FY + 1.05, -9.05);
  S.col(-16.2, FY + 0.85, -9.05, 0.3, 0.85, 0.22);

  // ---- back bar: cabinets, griddle, coffee urn, shelf of cups, the menu board
  const bx0 = -19.6, bx1 = -12.5, bz = zB + t + 0.3;
  P.box(M.woodDark(), bx1 - bx0, 0.9, 0.58, (bx0 + bx1) / 2, FY + 0.45, bz);
  for (let x = bx0 + 0.35; x < bx1 - 0.2; x += 0.7) P.box(M.wood(), 0.6, 0.7, 0.02, x, FY + 0.45, bz + 0.3).box(chrome, 0.12, 0.02, 0.02, x, FY + 0.72, bz + 0.31);
  P.box(M.steel(), bx1 - bx0 + 0.04, 0.04, 0.62, (bx0 + bx1) / 2, FY + 0.92, bz);
  P.box(M.steelDark(), 1.2, 0.08, 0.5, -15.0, FY + 0.98, bz).box(M.steelDark(), 1.2, 0.3, 0.04, -15.0, FY + 1.1, bz - 0.25);
  P.box(M.steelDark(), 1.3, 0.5, 0.7, -15.0, FY + 2.55, bz - 0.05, 0, 0.25);
  P.cyl(M.steelDark(), 0.15, 0.15, 0.9, -15.0, FY + 3.05, bz - 0.15, 8);
  P.box(M.steelDark(), 0.45, 0.4, 0.45, -13.2, FY + 1.13, bz).box(M.black(), 0.36, 0.06, 0.36, -13.2, FY + 1.34, bz);
  P.cyl(chrome, 0.17, 0.17, 0.52, -17.6, FY + 1.2, bz, 14).put(chrome, new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), -17.6, FY + 1.46, bz);
  P.box(M.black(), 0.06, 0.08, 0.1, -17.6, FY + 1.06, bz + 0.2).cyl(chrome, 0.02, 0.02, 0.4, -17.6, FY + 0.73, bz + 0.25, 5);
  P.box(M.cream(), 0.3, 0.2, 0.2, -18.8, FY + 1.04, bz);
  P.box(M.wood(), bx1 - bx0, 0.04, 0.26, (bx0 + bx1) / 2, FY + 1.75, zB + t + 0.13);
  for (let x = bx0 + 0.2; x < bx1 - 0.1; x += 0.16) {
    if (x > -15.8 && x < -14.2) continue;
    if (rnd() < 0.55) P.cyl(M.enamel(), 0.045, 0.04, 0.09, x, FY + 1.82, zB + t + 0.12, 8);
    else P.box(M.enamel(), 0.02, 0.2, 0.2, x, FY + 1.87, zB + t + 0.14, 0, 0.1);
  }
  S.sign('menu', 1.3, 0.8, 0.05, -17.6, FY + 2.55, zB + t + 0.04);
  S.sign('calendar', 0.34, 0.44, 0.01, -19.2, FY + 2.25, zB + t + 0.012);
  P.col((bx0 + bx1) / 2, FY + 0.5, bz, (bx1 - bx0) / 2, 0.5, 0.3);
  // the freezer (electronics) and the dead jukebox
  const fx = -22.0, fz = zB + t + 0.38;
  P.box(M.enamel(), 1.4, 2.0, 0.74, fx, FY + 1.0, fz).box(M.steelDark(), 1.44, 0.1, 0.78, fx, FY + 0.05, fz);
  P.box(M.black(), 0.012, 1.85, 0.01, fx, FY + 1.02, fz + 0.375);
  for (const s of [-1, 1]) P.box(chrome, 0.04, 0.5, 0.05, fx + s * 0.1, FY + 1.2, fz + 0.4);
  P.box(M.steelDark(), 0.16, 0.22, 0.05, fx + 0.5, FY + 1.35, fz + 0.39);
  const led = S.nightGlow('#ff3020', 3, 3);
  P.box(led, 0.025, 0.025, 0.02, fx + 0.5, FY + 1.42, fz + 0.42);
  S.halo(fx + 0.5, FY + 1.42, fz + 0.43, '#ff3020', 0.18, HALO.ON, 2);
  P.col(fx, FY + 1.0, fz, 0.7, 1.0, 0.37);
  H.spot('freezer', fx, FY + 1.05, fz + 1.15);
  H.audio('hum', fx, FY + 1.0, fz);
  const jx = x0 + t + 0.34, jz = -9.2;
  P.box(M.woodRed(), 0.6, 1.15, 0.9, jx, FY + 0.58, jz).put(M.woodRed(), new THREE.CylinderGeometry(0.45, 0.45, 0.6, 14, 1, false, 0, Math.PI), jx, FY + 1.15, jz, 0, 0, Math.PI / 2, 1, 1, 1);
  P.box(M.glassDark(), 0.02, 0.4, 0.6, jx + 0.31, FY + 1.05, jz).box(chrome, 0.02, 0.5, 0.06, jx + 0.31, FY + 0.5, jz - 0.3).box(chrome, 0.02, 0.5, 0.06, jx + 0.31, FY + 0.5, jz + 0.3);
  P.col(jx, FY + 0.75, jz, 0.3, 0.75, 0.45);
  // inside walls: posters and a coat rack by the door
  S.sign('wanted', 0.42, 0.58, 0.01, -19.9, FY + 1.6, zF - t - 0.006, Math.PI);
  P.cyl(M.woodDark(), 0.025, 0.025, 1.7, -19.7, FY + 0.85, -5.3, 6).cyl(M.woodDark(), 0.18, 0.2, 0.03, -19.7, FY + 0.015, -5.3, 8);
  P.put(M.canvas(), new THREE.CylinderGeometry(0.08, 0.17, 0.85, 8, 1, false), -19.62, FY + 1.2, -5.3, 0.1, 0, 0.12);

  // ---- outside: grime, streaks, sand, a propane tank, the back stoop
  grimeRun(S, x0 - 0.01, zB - 0.006, x1 + 0.01, zB - 0.006, Math.PI);
  grimeRun(S, x0 - 0.006, zB, x0 - 0.006, zF, -Math.PI / 2);
  grimeRun(S, x1 + 0.006, zB, x1 + 0.006, zF, Math.PI / 2);
  sandRun(S, x0 - 0.02, zB - 0.012, x1, zB - 0.012, Math.PI);
  for (const [x, z, ry] of [[-21, zB - 0.008, Math.PI], [-14.5, zB - 0.008, Math.PI], [x0 - 0.008, -7, -Math.PI / 2], [x1 + 0.008, -9, Math.PI / 2]] as const) S.decal('streaks', 2.4, 1.8, x, top - 0.8, z, ry);
  drift(P, -18, zB - 0.5, 9, 0, 0.32, 0.9);
  drift(P, x0 - 0.45, -8.5, 6, Math.PI / 2, 0.26, 0.7);
  P.cyl(M.cream(), 0.42, 0.42, 1.6, x0 - 0.9, 0.62, -9.8, 12, 0, 0, Math.PI / 2);
  P.put(M.cream(), new THREE.SphereGeometry(0.42, 12, 8), x0 - 0.9 - 0.8, 0.62, -9.8, 0, 0, 0, 0.35, 1, 1).put(M.cream(), new THREE.SphereGeometry(0.42, 12, 8), x0 - 0.9 + 0.8, 0.62, -9.8, 0, 0, 0, 0.35, 1, 1);
  P.box(M.steelDark(), 0.12, 0.25, 0.7, x0 - 0.9 - 0.5, 0.12, -9.8).box(M.steelDark(), 0.12, 0.25, 0.7, x0 - 0.9 + 0.5, 0.12, -9.8);
  P.cyl(M.brass(), 0.03, 0.03, 0.18, x0 - 0.9, 1.1, -9.8, 6).beam(M.galv(), V(x0 - 0.9, 1.15, -9.8), V(x0 - 0.02, 1.4, -9.8), 0.012, 4);
  P.col(x0 - 0.9, 0.62, -9.8, 1.0, 0.62, 0.45);
  drum(P, -13.0, zB - 0.6, M.drumBlue(), 0.2, false, 0, true);
  drum(P, -13.65, zB - 0.5, M.drumRed(), 1.2, false, 0, true);
  crate(P, -20.5, 0, zB - 0.6, 0.8, 0.6, 0.6, 0.15, M.woodPale(), true);
  crate(P, -20.4, 0.6, zB - 0.6, 0.6, 0.45, 0.5, -0.2);
  P.box(M.woodGrey(), 1.1, 2.1, 0.06, -17.0, 1.05, zB - 0.03).box(M.brass(), 0.05, 0.05, 0.08, -16.6, 1.05, zB - 0.06);
  P.box(M.found(), 1.4, 0.15, 0.8, -17.0, 0.075, zB - 0.4);
}


// ======================================================================= the clinic
function clinic(S: Site, H: Hooks): CreekLive {
  const x0 = -4.3, x1 = 4.3, zF = -5.3, zB = -11.4, t = 0.3, top = 3.3;
  const wallM = M.stuccoWhite(), teal = M.teal();
  const power = glow('#d7fff2', 0.25);
  const pv = power.intensity as unknown as { value: number };
  const dado = { y: FY + 1.15, mat: M.plasterGreen(), rail: teal };
  const inn = M.plasterWhite();
  const bars = M.steelDark();
  const win = (a: number, b: number, y0 = FY + 0.8, y1 = FY + 1.9): Hole => ({ a, b, y0, y1, kind: 'window', glass: power.material, bars, grid: [2, 2] });
  wall(S, { a: [x0, zF - t / 2], b: [x1, zF - t / 2], n: [0, 1], y0: 0, y1: top, t, out: wallM, inn, dado, trim: teal, skirting: teal,
    holes: [win(0.9, 2.7), { a: 3.5, b: 5.1, y0: FY, y1: FY + DOOR_H, kind: 'door' }, win(5.9, 7.7)] });
  wall(S, { a: [x0, zB + t / 2], b: [x1, zB + t / 2], n: [0, -1], y0: 0, y1: top, t, out: wallM, inn, dado, skirting: teal });
  wall(S, { a: [x0 + t / 2, zF - t], b: [x0 + t / 2, zB + t], n: [-1, 0], y0: 0, y1: top, t, out: wallM, inn, dado, trim: teal, skirting: teal, holes: [win(2.0, 3.2, FY + 1.0, FY + 1.9)] });
  wall(S, { a: [x1 - t / 2, zF - t], b: [x1 - t / 2, zB + t], n: [1, 0], y0: 0, y1: top, t, out: wallM, inn, dado, trim: teal, skirting: teal, holes: [win(2.6, 3.8, FY + 1.0, FY + 1.9)] });
  plinth(S, x0, x1, zB, zF, FY + 0.02, M.found(), [[-0.8, 0.8]]);
  S.b.add(teal, box(x1 - x0 + 0.06, 0.55, 0.025, 0, FY + 0.3, zF + 0.012));
  floor(S, M.tar(), x0, x1, zB, zF, top + 0.16, 0.18, false);
  for (const [w, d, x, z] of [[x1 - x0, 0.2, 0, zF - 0.1], [x1 - x0, 0.2, 0, zB + 0.1], [0.2, zF - zB, x0 + 0.1, (zF + zB) / 2], [0.2, zF - zB, x1 - 0.1, (zF + zB) / 2]] as const) {
    S.b.add(wallM, box(w, 0.42, d, x, top + 0.2, z));
    S.b.add(teal, box(w + 0.04, 0.05, d + 0.06, x, top + 0.43, z));
  }
  // red cross on the east wall, painted; the sign over the door
  S.b.add(M.red(), box(0.02, 1.3, 0.38, x1 + 0.01, 2.0, -7.6), box(0.02, 0.38, 1.3, x1 + 0.01, 2.0, -7.6));
  S.sign('clinicLit', 1.7, 0.53, 0.06, 0, FY + 2.55, zF + 0.04);
  S.halo(0, FY + 2.95, zF + 0.4, '#d7fff2', 0.45, HALO.POWER, 1.2);
  // stoop, steps, handrails, porch roof
  floor(S, M.slab(), -1.7, 1.7, zF, zF + 1.3, FY, 0.2, true, 'concrete');
  floor(S, M.slab(), -1.7, 1.7, zF + 1.3, zF + 1.62, FY / 2, 0.2, true, 'concrete');
  for (const sx of [-1.62, 1.62]) {
    const P = S.pen();
    P.beam(M.galv(), V(sx, FY + 0.9, zF + 0.1), V(sx, FY + 0.9, zF + 1.3), 0.022, 6).beam(M.galv(), V(sx, FY + 0.9, zF + 1.3), V(sx, FY / 2 + 0.9, zF + 1.62), 0.022, 6);
    for (const z of [zF + 0.15, zF + 1.25]) P.cyl(M.galv(), 0.02, 0.02, 0.9, sx, FY + 0.45, z, 6);
    post(S, M.steelDark(), sx, zF + 1.42, FY / 2, 2.85, 0.04, false, false);
  }
  S.b.add(M.steelDark(), box(3.6, 0.07, 1.55, 0, 2.88, zF + 0.75, 0, -0.03));
  S.b.add(teal, box(3.64, 0.14, 0.04, 0, 2.86, zF + 1.53));
  const porchGlow = S.nightGlow('#e8fff6', 0.25, 3.5);
  S.b.add(porchGlow, box(0.4, 0.03, 0.12, 0, 2.83, zF + 0.7));
  S.halo(0, 2.8, zF + 0.7, '#e8fff6', 0.55, HALO.NIGHT, 1.1);
  S.pool('poolTeal', 3.2, 3.2, 0, FY + 0.02, zF + 0.9);

  // ---- roof: solar, a water tank, a dish
  const R = S.pen();
  solarPanel(R, -2.2, top + 0.2, -8.0, 0, 1.0, 1.7, 0.42);
  solarPanel(R, -1.0, top + 0.2, -8.0, 0, 1.0, 1.7, 0.42);
  R.cyl(M.black(), 0.62, 0.62, 1.1, 2.6, top + 0.85, -10.2, 14).cyl(M.black(), 0.2, 0.2, 0.1, 2.6, top + 1.45, -10.2, 10);
  R.box(M.steelDark(), 1.4, 0.2, 1.4, 2.6, top + 0.25, -10.2);
  R.beam(M.black(), V(2.6, top + 0.4, -10.8), V(2.6, top + 0.2, -11.45), 0.04, 6).cyl(M.black(), 0.04, 0.04, top, 2.6, top / 2, zB - 0.06, 6);
  dish(R, 3.4, top + 0.18, -6.2, 2.4, 0.4);
  vent(R, 0.6, top + 0.2, -10.0, 0.08, 0.6);

  // ---- generator: skid, engine, tank, exhaust, cable to the wall, sandbags
  const G = S.pen(5.6, 0, -7.6);
  G.box(M.steelDark(), 1.5, 0.12, 0.9, 0, 0.06, 0);
  G.box(M.yellow(), 1.1, 0.55, 0.62, -0.1, 0.42, 0).box(M.yellow(), 1.15, 0.06, 0.66, -0.1, 0.72, 0);
  G.cyl(M.drumRed(), 0.22, 0.22, 0.55, 0.15, 0.97, 0, 12, 0, 0, Math.PI / 2).cyl(M.steelDark(), 0.05, 0.05, 0.06, 0.15, 1.2, 0, 6);
  G.box(M.steelDark(), 0.28, 0.4, 0.06, -0.55, 0.45, 0.33).box(M.dark(), 0.18, 0.12, 0.02, -0.55, 0.55, 0.365);
  const genLed = glow('#ff3a2a', 3);
  G.box(genLed.material, 0.03, 0.03, 0.02, -0.5, 0.36, 0.37);
  G.cyl(M.steelDark(), 0.06, 0.06, 0.5, 0.55, 0.65, -0.2, 8, 0, 0, 0).beam(M.steelDark(), V(0.55, 0.9, -0.2), V(0.55, 1.55, -0.2), 0.045, 8);
  G.put(M.steelDark(), new THREE.ConeGeometry(0.1, 0.08, 8), 0.55, 1.6, -0.2, Math.PI, 0, 0);
  for (const [x, y, z] of [[-0.6, 0.15, -0.46], [0.6, 0.15, -0.46]] as const) G.box(M.black(), 0.08, 0.1, 0.06, x, y, z);
  G.wire(M.cable(), V(-0.7, 0.5, 0.0), V(4.3 - 5.6 + 0.04 + 0.0 - 0.0, 1.8, 0.4), 0.3, 0.018, 12);
  S.b.add(M.galv(), box(0.12, 0.3, 0.22, x1 + 0.06, 1.8, -7.2));
  sandbags(G, 0.95, 0, 1.2, Math.PI / 2, 2);
  sandbags(G, 0.1, -0.85, 1.6, 0, 2);
  jerrycan(G, -0.9, 0, -0.6, 0.3);
  jerrycan(G, -1.1, 0, -0.3, -0.2);
  S.floorDecal('oil', 2.2, 2.2, 5.5, 0.03, -7.3, 0.5);
  S.col(5.6, 0.5, -7.6, 0.75, 0.5, 0.48);
  H.spot('generator', 5.4, 1.05, -6.4);
  H.audio('generator', 5.6, 0.6, -7.6);

  // ---- inside
  floor(S, M.slab(), x0 + t, x1 - t, zB + t, zF, FY + 0.01, 0.31, true, 'concrete');
  for (let x = x0 + t; x < x1 - t - 0.05; x += 2) for (let z = zF - t; z > zB + t + 0.05; z -= 2) {
    const w = Math.min(2, x1 - t - x), d = Math.min(2, z - zB - t);
    S.floorDecal('lino', w, d, x + w / 2, FY + 0.013, z - d / 2);
  }
  S.floorDecal('dirt', 2, 2, 0, FY + 0.016, -6.0, 0.4);
  floor(S, M.plasterWhite(), x0 + t, x1 - t, zB + t, zF - t, 3.12, 0.05, false);
  const P = S.pen();
  // fluorescent fixtures on the power circuit
  for (const [fx, fz] of [[-2.0, -8.3], [1.6, -8.3]] as const) {
    P.box(M.galv(), 1.3, 0.07, 0.26, fx, 3.04, fz);
    P.box(power.material, 1.2, 0.035, 0.06, fx, 2.99, fz - 0.06).box(power.material, 1.2, 0.035, 0.06, fx, 2.99, fz + 0.06);
    S.halo(fx - 0.35, 2.96, fz, '#e8fff6', 0.6, HALO.POWER, 1);
    S.halo(fx + 0.35, 2.96, fz, '#e8fff6', 0.6, HALO.POWER, 1);
  }
  const clinicLight = S.light(0, 2.7, -8.3, 0xd8fff2, 0.5, 10, 1.6);
  // cots with blankets, the curtain between them, the drip stand
  for (const cz of [-6.65, -9.95]) {
    const C = S.pen(-3.05, FY, cz);
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.35, 0.35]) C.cyl(M.galv(), 0.02, 0.02, 0.5, sx, 0.25, sz, 6);
    C.box(M.galv(), 1.86, 0.04, 0.04, 0, 0.48, 0.35).box(M.galv(), 1.86, 0.04, 0.04, 0, 0.48, -0.35);
    C.box(M.mattress(), 1.82, 0.14, 0.7, 0, 0.56, 0);
    C.put(M.sheet(), new THREE.SphereGeometry(0.28, 10, 6), -0.7, 0.67, 0, 0, 0, 0, 0.5, 0.25, 0.9);
    C.box(M.blanketOlive(), 1.2, 0.05, 0.74, 0.3, 0.65, 0, 0, 0, 0.02).box(M.blanketOlive(), 1.2, 0.3, 0.03, 0.3, 0.52, 0.37, 0.1);
    C.col(0, 0.35, 0, 0.95, 0.35, 0.38);
  }
  P.cyl(M.galv(), 0.012, 0.012, 2.3, -2.95, 2.84, -8.3, 4, 0, 0, Math.PI / 2);
  P.box(M.galv(), 2.3, 0.03, 0.03, -2.95, 2.82, -8.3);
  for (let i = 0; i < 9; i++) P.box(M.curtainGreen(), 0.17, 2.2, 0.03, -4.0 + i * 0.16, FY + 1.42, -8.3 + (i % 2) * 0.06, 0.4 * (i % 2 ? 1 : -1));
  {
    const D = S.pen(-1.85, FY, -6.0);
    for (let i = 0; i < 5; i++) D.box(M.galv(), 0.3, 0.02, 0.025, Math.cos(i * 1.256) * 0.13, 0.02, Math.sin(i * 1.256) * 0.13, -i * 1.256);
    D.cyl(M.galv(), 0.012, 0.012, 1.85, 0, 0.94, 0, 5).box(M.galv(), 0.3, 0.012, 0.012, 0, 1.86, 0);
    D.box(plainStandard('#d8e8e0', 0.2), 0.14, 0.22, 0.05, 0.12, 1.7, 0).cyl(M.white(), 0.01, 0.01, 0.06, 0.12, 1.56, 0, 4);
    D.wire(plainStandard('#c8d8d0', 0.3), V(0.12, 1.53, 0), V(-0.5, 0.75, -0.55), 0.35, 0.005, 10);
  }
  // Doc, with his clipboard
  H.npc({ id: 'doc', look: LOOKS.doc, pose: 'clipboard', x: -0.9, y: FY, z: -8.5, yaw: 0.35, notice: 6 });
  H.spot('doc', -0.9, FY + 1.05, -8.5);
  S.col(-0.9, FY + 0.9, -8.5, 0.28, 0.9, 0.25);
  // exam table, cabinet, sink and mirror, desk, scale, eye chart
  {
    const E = S.pen(1.9, FY, -9.2, Math.PI / 2);
    E.box(M.steelDark(), 1.6, 0.6, 0.5, 0, 0.3, 0).box(M.leatherBrown(), 1.8, 0.12, 0.66, 0, 0.66, 0).box(M.leatherBrown(), 0.5, 0.12, 0.66, -0.75, 0.78, 0, 0, 0, 0.35);
    E.box(M.paper(), 1.7, 0.01, 0.5, 0.05, 0.725, 0).cyl(M.paper(), 0.08, 0.08, 0.56, 0.95, 0.68, 0, 10, Math.PI / 2, 0, 0);
    E.box(M.galv(), 0.36, 0.2, 0.3, 0, 0.1, 0.55);
    E.col(0, 0.4, 0, 0.92, 0.4, 0.36);
  }
  {
    const C = S.pen(3.1, FY, zB + t + 0.2);
    C.box(M.enamel(), 1.3, 2.0, 0.4, 0, 1.0, 0);
    for (let i = 0; i < 4; i++) C.box(M.enamel(), 1.22, 0.02, 0.36, 0, 0.35 + i * 0.45, 0.01);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 7; k++) {
      const m = [M.bottleA(), M.white(), M.bottleG(), M.drumBlue()][(i + k) % 4];
      C.cyl(m, 0.03, 0.03, 0.1 + (k % 3) * 0.03, -0.5 + k * 0.16 + (k > 3 ? 0.04 : 0), 0.42 + i * 0.45, 0.02, 7);
    }
    C.box(M.glassDark(), 0.6, 1.8, 0.02, -0.31, 1.0, 0.21).box(M.glassDark(), 0.6, 1.8, 0.02, 0.62, 1.0, 0.55, 0.9);
    C.col(0, 1.0, 0, 0.65, 1.0, 0.22);
  }
  P.box(M.enamel(), 0.6, 0.2, 0.45, 0.4, FY + 0.85, zB + t + 0.23).box(M.galv(), 0.05, 0.75, 0.05, 0.4, FY + 0.38, zB + t + 0.3);
  P.cyl(M.chrome(), 0.012, 0.012, 0.2, 0.4, FY + 1.02, zB + t + 0.1, 5, 0.8);
  P.box(M.mirror(), 0.55, 0.7, 0.02, 0.4, FY + 1.6, zB + t + 0.012).box(M.teal(), 0.62, 0.77, 0.015, 0.4, FY + 1.6, zB + t + 0.006);
  table(P, 3.65, -6.75, 1.4, 0.7, 0.76, Math.PI / 2, FY, M.wood(), M.woodDark(), true);
  P.box(M.paper(), 0.3, 0.012, 0.22, 3.6, FY + 0.77, -6.4, 0.2).box(M.paper(), 0.3, 0.012, 0.22, 3.55, FY + 0.782, -6.5, -0.1).box(M.cardboard(), 0.25, 0.05, 0.32, 3.75, FY + 0.785, -7.2);
  {
    const lampGlow = S.nightGlow('#ffd8a0', 0.5, 4);
    const L = S.pen(3.8, FY + 0.76, -7.25);
    L.cyl(M.steelDark(), 0.07, 0.08, 0.02, 0, 0.01, 0, 8).beam(M.steelDark(), V(0, 0.02, 0), V(-0.05, 0.35, 0.05), 0.01, 4).beam(M.steelDark(), V(-0.05, 0.35, 0.05), V(-0.2, 0.38, 0.15), 0.01, 4);
    L.put(M.teal(), new THREE.ConeGeometry(0.09, 0.12, 10, 1, true), -0.22, 0.33, 0.17, -0.3, 0, 0.6).put(lampGlow, new THREE.SphereGeometry(0.03, 6, 5), -0.22, 0.31, 0.17);
    const c = L.p(-0.22, 0.3, 0.17);
    S.halo(c.x, c.y, c.z, '#ffd8a0', 0.4, HALO.NIGHT, 1.2);
    S.pool('poolWarm', 1.0, 1.0, 3.55, FY + 0.775, -7.0);
  }
  chair(P, 3.0, -6.6, -Math.PI / 2, FY, M.woodDark());
  P.cyl(M.galv(), 0.03, 0.03, 1.4, -1.4, FY + 0.7, zB + t + 0.25, 6).box(M.galv(), 0.4, 0.06, 0.45, -1.4, FY + 0.04, zB + t + 0.42).box(M.galv(), 0.3, 0.05, 0.05, -1.4, FY + 1.35, zB + t + 0.3);
  S.decal('eyechart', 0.5, 0.67, x1 - t - 0.01, FY + 1.55, -10.2, -Math.PI / 2);
  crate(P, 3.4, FY, -8.7, 0.6, 0.45, 0.45, 0.1, M.enamel());
  crate(P, 3.45, FY + 0.45, -8.75, 0.45, 0.35, 0.4, -0.15, M.enamel());
  P.box(M.red(), 0.1, 0.1, 0.01, 3.4, FY + 0.25, -8.47).box(M.red(), 0.03, 0.1, 0.012, 3.4, FY + 0.25, -8.465);
  P.col(3.4, FY + 0.4, -8.7, 0.32, 0.4, 0.25);
  P.cyl(M.drumRed(), 0.16, 0.14, 0.45, -3.6, FY + 0.225, -5.95, 10);
  H.spot('clinicIn', 0, FY + 0.25, -7.0);
  // outside grime
  grimeRun(S, x0, zB - 0.006, x1, zB - 0.006, Math.PI);
  grimeRun(S, x0 - 0.006, zB, x0 - 0.006, zF, -Math.PI / 2);
  grimeRun(S, x1 + 0.006, zB, x1 + 0.006, zF, Math.PI / 2);
  grimeRun(S, x0, zF + 0.006, -1.7, zF + 0.006, 0, 0.75, 1.0);
  grimeRun(S, 1.7, zF + 0.006, x1, zF + 0.006, 0, 0.75, 1.0);
  sandRun(S, x0, zB - 0.012, x1, zB - 0.012, Math.PI);
  drift(P, 0, zB - 0.5, 8.4, 0, 0.3, 0.8);
  for (const [x, z, ry] of [[-2.5, zB - 0.008, Math.PI], [2.5, zB - 0.008, Math.PI], [x0 - 0.008, -8, -Math.PI / 2]] as const) S.decal('streaks', 2.2, 1.6, x, top - 0.6, z, ry);
  return { power: pv, clinicLight, generatorLed: genLed.intensity as unknown as { value: number } };
}

// ======================================================================= the Till
function till(S: Site, H: Hooks) {
  const x0 = 10.6, x1 = 21.2, zF = -4.3, zB = -15.8, t = 0.22;
  const LOFT = 3.3, TOP = 7.4;
  const siding = M.woodGrey(), inner = M.woodPale(), trim = M.woodDark();
  const warm = S.nightGlow('#ffb066', 0.3, 1.7);
  const shop = (a: number, b: number): Hole => ({ a, b, y0: FY + 0.65, y1: FY + 2.25, kind: 'window', glass: warm, grid: [4, 2] });
  const loftWin = (a: number, b: number, shutters = false): Hole => ({ a, b, y0: 3.95, y1: 5.15, kind: 'window', glass: warm, grid: [2, 2], shutters: shutters ? M.woodRed() : undefined });
  const zf = zF - t / 2, zb = zB + t / 2, xw = x0 + t / 2, xe = x1 - t / 2;
  wall(S, { a: [x0, zf], b: [x1, zf], n: [0, 1], y0: 0, y1: 3.4, t, out: siding, inn: inner, trim, skirting: trim,
    holes: [shop(0.7, 3.9), { a: 4.7, b: 6.3, y0: FY, y1: FY + DOOR_H + 0.05, kind: 'door' }, shop(7.0, 10.0)] });
  wall(S, { a: [x0, zf], b: [x1, zf], n: [0, 1], y0: 3.4, y1: TOP, t, out: siding, inn: inner, trim, holes: [loftWin(1.3, 2.7, true), loftWin(7.9, 9.3)] });
  wall(S, { a: [x0, zb], b: [x1, zb], n: [0, -1], y0: 0, y1: 3.4, t, out: siding, inn: inner, trim, holes: [{ a: 7.2, b: 8.3, y0: FY, y1: FY + 2.0, kind: 'window', boards: M.woodDark() }] });
  wall(S, { a: [x0, zb], b: [x1, zb], n: [0, -1], y0: 3.4, y1: 5.75, t, out: siding, inn: inner, trim, holes: [{ a: 4.5, b: 5.3, y0: 4.1, y1: 4.9, kind: 'window', glass: warm }] });
  wall(S, { a: [xw, zF - t], b: [xw, zB + t], n: [-1, 0], y0: 0, y1: 3.4, t, out: siding, inn: inner, trim, holes: [{ a: 7.6, b: 8.6, y0: FY + 1.0, y1: FY + 1.8, kind: 'window', glass: M.glassDark(), boards: M.woodDark() }] });
  wall(S, { a: [xw, zF - t], b: [xw, zB + t], n: [-1, 0], y0: 3.4, y1: 5.75, t, out: siding, inn: inner, trim, holes: [loftWin(3.0, 4.0)] });
  wall(S, { a: [xe, zF - t], b: [xe, zB + t], n: [1, 0], y0: 0, y1: 3.4, t, out: siding, inn: inner, trim, holes: [{ a: 1.6, b: 2.8, y0: FY + 0.7, y1: FY + 1.9, kind: 'window', glass: warm, grid: [2, 2] }] });
  wall(S, { a: [xe, zF - t], b: [xe, zB + t], n: [1, 0], y0: 3.4, y1: 5.75, t, out: siding, inn: inner, trim, holes: [loftWin(7.0, 8.0)] });
  // clapboard: horizontal boards proud of the siding on every exterior face (gaps where the holes are)
  clapboard(S, siding, x0, x1, zF + 0.012, 0, TOP, 0, [[0.7, 3.9, FY + 0.55, FY + 2.4], [4.6, 6.4, 0, FY + 2.6], [7.0, 10.0, FY + 0.55, FY + 2.4], [1.2, 2.8, 3.85, 5.3], [7.8, 9.4, 3.85, 5.3]]);
  clapboard(S, siding, x0, x1, zB - 0.012, 0, 5.75, Math.PI, [[7.1, 8.4, FY, FY + 2.1], [4.4, 5.4, 4.0, 5.0]]);
  // side gables follow the roof slope
  for (const [x, sgn] of [[xw, -1], [xe, 1]] as const) {
    const sh = new THREE.Shape();
    sh.moveTo(zB, 5.75); sh.lineTo(zF, 5.75); sh.lineTo(zF, 6.38); sh.lineTo(zB, 5.75);
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(x + t / 2, 0, 0);
    S.pen().put(siding, g, 0, 0, 0);
    void sgn;
  }
  plinth(S, x0, x1, zB, zF, FY + 0.05, M.found());
  // false front: a raised centre, a cornice on brackets, the painted sign
  S.b.add(siding, box(4.6, 0.5, t, 15.9, TOP + 0.25, zf));
  S.b.add(trim, box(4.8, 0.12, 0.34, 15.9, TOP + 0.52, zf + 0.05), box(x1 - x0 + 0.2, 0.14, 0.36, (x0 + x1) / 2, TOP + 0.05, zf + 0.06));
  for (let x = x0 + 0.3; x < x1; x += 0.95) S.b.add(trim, box(0.08, 0.26, 0.2, x, TOP - 0.12, zf + 0.15));
  for (const x of [x0 + 0.05, x1 - 0.05]) S.b.add(trim, box(0.16, TOP, 0.16, x, TOP / 2, zf + 0.06));
  S.sign('till', 6.4, 1.8, 0.08, 15.9, 6.35, zf + t / 2 + 0.05);
  S.wash(6.0, 2.2, 15.9, 7.3, zf + t / 2 + 0.11, 0);
  // the roof behind it, a stovepipe through it
  sheetRoof(S, M.roofGrey(), x0 - 0.15, x1 + 0.15, zB - 0.35, zF - 0.1, 5.72, 6.36, { fascia: trim, patch: M.roofRust(), patches: 4, seed: 3 });
  gutter(S, M.galv(), x0 - 0.15, x1 + 0.15, zB - 0.42, 5.62, [x0 + 0.2, x1 - 0.2]);
  const P = S.pen();
  P.cyl(M.steelDark(), 0.08, 0.08, 1.4, 20.3, 6.7, -5.3, 10).put(M.steelDark(), new THREE.ConeGeometry(0.18, 0.14, 10), 20.3, 7.5, -5.3);
  P.wire(M.cable(), V(20.3, 7.2, -5.3), V(19.0, 6.3, -6.5), 0.05, 0.006, 4);
  // ---- porch: deck, posts, roof, rails, the lantern by the door
  deck(S, M.wood(), x0 - 0.2, x1 + 0.2, zF, zF + 2.0, FY, M.woodDark());
  deck(S, M.wood(), x0 - 0.2, x1 + 0.2, zF + 2.0, zF + 2.35, FY / 2);
  const pz = zF + 1.86;
  for (const px of [10.55, 12.9, 14.9, 17.3, 19.3, 21.25]) post(S, M.woodGrey(), px, pz, FY, 3.0, 0.07);
  S.b.add(M.woodGrey(), box(x1 - x0 + 0.5, 0.18, 0.14, (x0 + x1) / 2, 3.02, pz));
  sheetRoof(S, M.roofRust(), x0 - 0.25, x1 + 0.25, zF - 0.05, zF + 2.25, 3.42, 3.05, { fascia: trim, patch: M.roofGrey(), patches: 2, seed: 9 });
  for (let x = x0; x <= x1 + 0.01; x += 1.06) S.b.add(trim, box(0.06, 0.12, 2.1, x, 3.12, zF + 1.05, 0, 0.17));
  railing(S, M.woodGrey(), 10.55, pz, 12.9, pz, FY);
  railing(S, M.woodGrey(), 19.3, pz, 21.25, pz, FY);
  railing(S, M.woodGrey(), x1 + 0.2, zF + 0.05, x1 + 0.2, pz, FY);
  railing(S, M.woodGrey(), x0 - 0.2, zF + 0.05, x0 - 0.2, pz, FY);
  {
    const lg = S.nightGlow('#ffc070', 0.6, 5);
    P.beam(M.steelDark(), V(17.2, 2.92, pz), V(17.2, 2.7, pz), 0.008, 4);
    lantern(P, 17.2, 2.68, pz, lg);
    S.halo(17.2, 2.55, pz, '#ffc070', 0.75, HALO.NIGHT, 1.4);
    S.pool('poolWarm', 3.4, 3.4, 16.6, FY + 0.02, zF + 1.2);
    S.light(17.2, 2.45, pz, 0xffb060, 5, 9);
  }
  // scrap-pipe wind chimes under the porch roof, and the loft's loose shutter (both heard in the wind)
  {
    const cx = 12.0, cz = pz - 0.4, top = 2.92;
    P.beam(M.steelDark(), V(cx, 3.12, cz), V(cx, top, cz), 0.004, 3);
    P.cyl(M.woodDark(), 0.09, 0.09, 0.025, cx, top, cz, 10);
    [0.42, 0.36, 0.31, 0.27, 0.23].forEach((len, i) => {
      const a = (i / 5) * Math.PI * 2;
      const x = cx + Math.cos(a) * 0.065, z = cz + Math.sin(a) * 0.065;
      P.beam(M.steelDark(), V(x, top, z), V(x, top - 0.06, z), 0.002, 3);
      P.cyl(M.galv(), 0.009, 0.009, len, x, top - 0.06 - len / 2, z, 6);
    });
    H.audio('chimes', cx, top - 0.25, cz);
    H.audio('shutter', x0 + 2.0, 4.55, zf + 0.15);
  }
  // porch life: a bench, a rocking chair, barrels, a broom, crates, the rain barrel
  table(P, 12.0, zF + 0.4, 1.5, 0.4, 0.45, 0, FY, M.woodGrey(), M.woodDark(), true);
  P.box(M.woodGrey(), 1.5, 0.4, 0.04, 12.0, FY + 0.72, zF + 0.2, 0, -0.1);
  chair(P, 18.4, zF + 0.9, 2.6, FY, M.wood());
  drum(P, 14.3, zF + 0.5, M.woodPale(), 0.4, false, FY, true);
  drum(P, 20.4, zF + 0.6, M.woodPale(), 1.0, false, FY, true);
  P.put(M.woodPale(), new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14), 14.3, FY + 0.9, zF + 0.5);
  for (let i = 0; i < 6; i++) P.cyl(M.bottleA(), 0.06, 0.06, 0.1, 14.3 + Math.cos(i) * 0.15, FY + 0.97, zF + 0.5 + Math.sin(i) * 0.15, 6);
  crate(P, 19.6, FY, zF + 0.45, 0.6, 0.5, 0.5, 0.2, M.woodPale(), true);
  crate(P, 19.6, FY + 0.5, zF + 0.45, 0.5, 0.4, 0.45, -0.25);
  P.cyl(M.woodPale(), 0.015, 0.015, 1.3, 15.0, FY + 0.7, zF + 0.12, 5, 0.12, 0, 0.1).put(M.burlap(), new THREE.ConeGeometry(0.12, 0.3, 8), 15.07, FY + 0.12, zF + 0.04, 0.12, 0, Math.PI + 0.1);
  drum(P, x1 + 0.55, zF - 0.6, M.drumBlue(), 0.3, false, 0, true);
  P.beam(M.galv(), V(x1 + 0.2, 5.6, zB - 0.42), V(x1 + 0.55, 1.2, zF - 0.6), 0.03, 6);
  // ---- floors, loft, stair
  deck(S, M.woodFloor(), x0 + t, x1 - t, zB + t, zF, FY, M.woodDark());
  const lofts: [number, number, number, number][] = [[x0 + t, x1 - t, -10.05, zF - t], [12.65, x1 - t, zB + t, -10.05], [x0 + t, 12.65, -10.67, -10.05]];
  for (const [a, b, c, d] of lofts) {
    floor(S, M.woodFloor(), a, b, c, d, LOFT, 0.2);
    for (let z = c + 0.3; z < d - 0.1; z += 0.6) S.b.add(trim, box(b - a, 0.18, 0.08, (a + b) / 2, LOFT - 0.29, z));
  }
  S.b.add(trim, box(0.3, 0.3, zF - zB - 0.5, 15.9, LOFT - 0.35, (zF + zB) / 2));
  post(S, trim, 15.1, -10.0, FY, LOFT - 0.2, 0.09);
  post(S, trim, 15.9, -15.3, FY, LOFT - 0.2, 0.09);
  // the foot stands 0.8 m off the back wall so you can walk onto the first tread
  const sx0 = 11.0, sx1 = 12.6, sz = -14.75, tread = 0.34, riser = 0.25;
  for (let i = 0; i < 12; i++) {
    const tp = FY + (i + 1) * riser;
    const za = sz + i * tread;
    S.b.add(M.woodPale(), box(sx1 - sx0, 0.05, tread + 0.02, (sx0 + sx1) / 2, tp - 0.025, za + tread / 2));
    S.b.add(M.woodDark(), box(sx1 - sx0 - 0.04, riser - 0.05, 0.03, (sx0 + sx1) / 2, tp - riser / 2 - 0.025, za + 0.015));
  }
  // one smooth ramp under the treads (half a riser above their backs): the controller's autostep
  // misses 0.25 m risers at high frame rates, a 36° slope it always climbs
  {
    const zA = sz - tread / 2, zB = sz + 12 * tread;
    const ang = Math.atan2(LOFT - FY, zB - zA);
    const yA = FY, yB = LOFT;
    const len = Math.hypot(zB - zA, yB - yA), th = 0.2;
    const cy = (yA + yB) / 2 - Math.cos(ang) * th / 2, cz = (zA + zB) / 2 + Math.sin(ang) * th / 2;
    S.colPitched((sx0 + sx1) / 2, cy, cz, (sx1 - sx0) / 2, th / 2, len / 2, -ang);
  }
  // stringer and a handrail up the open side
  {
    const len = Math.hypot(12 * tread, 12 * riser), ang = Math.atan2(12 * riser, 12 * tread);
    S.b.add(trim, box(0.06, 0.3, len, sx1 + 0.03, FY + 6 * riser - 0.05, sz + 6 * tread, 0, -ang));
    P.beam(M.woodPale(), V(sx1 + 0.04, FY + 0.95, sz + 0.2), V(sx1 + 0.04, LOFT + 0.9, sz + 12 * tread - 0.1), 0.025, 6);
    for (let i = 1; i < 12; i += 2) P.box(M.woodPale(), 0.04, 0.9, 0.04, sx1 + 0.04, FY + (i + 1) * riser + 0.45, sz + i * tread + tread / 2);
  }
  railing(S, M.woodPale(), 12.68, zB + t + 0.05, 12.68, -10.9, LOFT, 0.95, 0.4);
  railing(S, M.woodPale(), x0 + t + 0.05, zB + t + 0.05, 12.62, zB + t + 0.05, LOFT, 0.95, 0.4, false);
  // ---- partition with the closet door
  const pZ = -10.3;
  wall(S, { a: [x0 + t, pZ], b: [x1 - t, pZ], n: [0, 1], y0: FY, y1: LOFT - 0.2, t: 0.16, out: inner, inn: M.woodGrey(), trim,
    holes: [{ a: 13.15 - (x0 + t), b: 14.75 - (x0 + t), y0: FY, y1: FY + DOOR_H, kind: 'door' }] });
  swingDoor(S, H, 'closet', 13.15, 14.75, pZ, FY, -1.25, M.woodDark(), 'plank');

  // ---- the shop: counter and the till, shelves, Inez
  const cz = -7.6;
  P.box(M.wood(), 4.0, 0.95, 0.56, 18.4, FY + 0.48, cz);
  for (let x = 16.7; x < 20.3; x += 0.66) P.box(M.woodDark(), 0.52, 0.6, 0.02, x, FY + 0.5, cz + 0.285);
  P.box(M.woodPale(), 4.1, 0.05, 0.66, 18.4, FY + 1.0, cz);
  P.col(18.4, FY + 0.5, cz, 2.0, 0.5, 0.3);
  {
    const T = S.pen(17.4, FY + 1.025, cz - 0.05);
    const brass = M.bronze();
    T.box(brass, 0.42, 0.24, 0.36, 0, 0.12, 0).box(M.woodDark(), 0.44, 0.04, 0.38, 0, 0.02, 0);
    T.box(brass, 0.38, 0.14, 0.2, 0, 0.27, 0.08, 0, -0.6);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) T.cyl(M.enamel(), 0.013, 0.013, 0.02, -0.15 + k * 0.06, 0.29 + r * 0.03, 0.03 + r * 0.05, 6, -0.6);
    T.box(brass, 0.3, 0.16, 0.05, 0, 0.42, -0.1).box(M.black(), 0.24, 0.07, 0.01, 0, 0.44, -0.07);
    T.cyl(brass, 0.02, 0.02, 0.1, 0.24, 0.18, 0.1, 6, 0, 0, Math.PI / 2).put(M.black(), new THREE.SphereGeometry(0.025, 6, 5), 0.3, 0.18, 0.1);
  }
  P.cyl(M.chrome(), 0.12, 0.14, 0.05, 19.3, FY + 1.05, cz).cyl(M.brass(), 0.015, 0.015, 0.25, 19.3, FY + 1.2, cz, 5).box(M.brass(), 0.4, 0.015, 0.015, 19.3, FY + 1.33, cz);
  for (const s of [-1, 1]) P.cyl(M.brass(), 0.08, 0.06, 0.03, 19.3 + s * 0.18, FY + 1.22, cz, 8);
  P.box(M.leatherBrown(), 0.32, 0.05, 0.24, 18.5, FY + 1.05, cz + 0.05, 0.15).box(M.paper(), 0.3, 0.03, 0.22, 18.5, FY + 1.08, cz + 0.05, 0.15);
  P.put(M.glassDark(), new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12), 20.0, FY + 1.18, cz);
  H.npc({ id: 'inez', look: LOOKS.inez, pose: 'tend', x: 18.6, y: FY, z: -8.3, yaw: 0, surface: 1.0, notice: 6 });
  H.spot('inez', 18.6, FY + 1.05, -8.3);
  S.col(18.6, FY + 0.85, -8.3, 0.28, 0.85, 0.22);
  // shelving: behind the counter on the partition, and the west wall
  reseed(4242);
  for (const x of [16.55, 19.6]) stock(shelves(P, x, pZ + 0.31, 2.55, 0.42, 2.55, 0, FY, 5), 0.95);
  for (const z of [-6.2, -8.6]) stock(shelves(P, x0 + t + 0.24, z, 2.25, 0.42, 2.3, Math.PI / 2, FY, 4), 0.9);
  // display table, barrels, sacks, a hanging scale, tools on the wall
  table(P, 13.0, -6.6, 1.3, 0.8, 0.8, 0.1, FY, M.woodPale(), M.woodDark(), true);
  for (let i = 0; i < 4; i++) P.box([M.blanketRed(), M.blanketBlue(), M.canvas(), M.blanketOlive()][i], 0.5, 0.08, 0.36, 12.75 + (i % 2) * 0.55, FY + 0.84 + Math.floor(i / 2) * 0.08, -6.6 + (i % 2) * 0.05, 0.1);
  P.box(M.leatherBrown(), 0.14, 0.26, 0.3, 13.4, FY + 0.93, -6.45).box(M.leatherBrown(), 0.14, 0.26, 0.3, 13.55, FY + 0.93, -6.45);
  drum(P, 14.9, -5.1, M.woodPale(), 0, false, FY, true);
  for (let i = 0; i < 5; i++) sack(P, 11.6 + (i % 3) * 0.45, FY + Math.floor(i / 3) * 0.3, -9.7 + (i % 2) * 0.1, i * 0.7);
  P.col(12.0, FY + 0.3, -9.7, 0.7, 0.3, 0.3);
  P.cyl(M.chrome(), 0.008, 0.008, 0.6, 16.4, FY + 2.3, cz - 0.1, 4).cyl(M.chrome(), 0.12, 0.1, 0.04, 16.4, FY + 1.98, cz - 0.1, 10);
  for (let i = 0; i < 5; i++) {
    const x = x1 - t - 0.04, z = -5.2 - i * 0.45;
    P.cyl(M.woodPale(), 0.015, 0.015, 0.8, x - 0.05, FY + 1.9, z, 5, 0, 0, 0.05).box(M.steelDark(), 0.04, 0.12, 0.22, x - 0.05, FY + 2.28, z);
  }
  // stove (warm at night), a lantern from the joists
  const ember = S.nightGlow('#ff7a2a', 1.2, 4);
  const fb = stove(P, 20.3, -5.3, FY, 6.0, ember);
  S.halo(fb.x, fb.y, fb.z + 0.05, '#ff8a3a', 0.5, HALO.ON, 1.4);
  S.pool('poolFire', 2.2, 2.2, 20.1, FY + 0.02, -4.9);
  {
    const lg = S.nightGlow('#ffc070', 1.0, 5);
    lantern(P, 14.2, LOFT - 0.24, -6.6, lg);
    lantern(P, 18.4, LOFT - 0.24, -6.9, lg);
    S.halo(14.2, LOFT - 0.6, -6.6, '#ffc070', 0.7, HALO.ON, 1.3);
    S.halo(18.4, LOFT - 0.6, -6.9, '#ffc070', 0.7, HALO.ON, 1.3);
    S.pool('poolWarm', 4.2, 4.2, 14.2, FY + 0.02, -6.6);
    S.pool('poolWarm', 3.6, 3.6, 18.4, FY + 1.03, -7.4);
    S.light(16.3, LOFT - 0.7, -6.8, 0xffb468, 11, 12, 1.4);
  }
  S.floorDecal('dirt', 2.4, 2.4, 16.0, FY + 0.012, -5.2, 1.1);
  H.spot('storeIn', 16.2, FY + 0.25, -5.8);
  H.spot('closet', 13.95, FY + 1.05, -9.6);

  // ---- back room: crates, sacks, a workbench, one bare bulb
  for (const [x, z, w, h, r] of [[19.8, -14.9, 0.9, 0.7, 0.1], [19.9, -14.0, 0.7, 0.6, -0.2], [17.6, -15.0, 0.8, 0.6, 0.3], [19.8, -12.0, 0.8, 0.7, 0]] as const) crate(P, x, FY, z, w, h, w * 0.85, r, M.woodPale(), true);
  crate(P, 19.85, FY + 0.7, -14.9, 0.6, 0.45, 0.5, 0.4);
  for (let i = 0; i < 4; i++) sack(P, 16.2 + (i % 2) * 0.5, FY, -15.2 + Math.floor(i / 2) * 0.45, i);
  P.col(16.45, FY + 0.25, -15.0, 0.55, 0.25, 0.45);
  table(P, 15.4, -11.0, 1.6, 0.6, 0.85, 0, FY, M.wood(), M.woodDark(), true);
  bucket(P, 14.9, FY + 0.85, -11.0);
  jerrycan(P, 15.9, FY + 0.85, -11.05, 0.3);
  {
    const bg = S.nightGlow('#ffd8a0', 0.8, 4);
    bulb(S, bg, 15.6, LOFT - 0.5, -12.8, 0.05, 0.5);
    S.b.add(M.cable(), box(0.008, 0.36, 0.008, 15.6, LOFT - 0.3, -12.8));
    S.pool('poolWarm', 3.0, 3.0, 15.6, FY + 0.02, -12.8);
    S.light(15.6, LOFT - 0.7, -12.8, 0xffc890, 2.5, 6);
  }
  H.spot('backroom', 14.6, FY + 0.25, -12.6);

  // ---- the loft: bedroll, maps, a radio, the shelf with the page
  {
    const L = S.pen(0, LOFT, 0);
    L.box(M.canvas(), 0.9, 0.08, 2.0, 20.0, 0.04, -8.0).box(M.blanketRed(), 0.85, 0.06, 1.3, 20.0, 0.1, -7.6, 0, 0.05).put(M.sheet(), new THREE.SphereGeometry(0.25, 10, 6), 20.0, 0.14, -8.75, 0, 0, 0, 1, 0.35, 0.6);
    crate(L, 18.7, 0, -8.6, 0.7, 0.55, 0.6, 0.15, M.woodPale(), true);
    const lg = S.nightGlow('#ffc070', 1.0, 4.5);
    lantern(L, 18.55, 0.78, -8.55, lg);
    L.box(M.steelDark(), 0.3, 0.18, 0.14, 18.85, 0.64, -8.65, 0.3).cyl(M.chrome(), 0.004, 0.004, 0.35, 18.95, 0.88, -8.65, 4);
    chair(L, 17.9, -8.4, 1.3, 0, M.wood());
    S.halo(18.55, LOFT + 0.68, -8.55, '#ffc070', 0.6, HALO.ON, 1.3);
    S.pool('poolWarm', 3.0, 3.0, 18.6, LOFT + 0.02, -8.3);
    S.light(18.6, LOFT + 1.1, -8.4, 0xffb468, 7, 10, 1.4);
    // maps pinned on the east wall with string between the pins
    S.decal('map1', 1.0, 0.75, x1 - t - 0.01, LOFT + 1.4, -11.0, -Math.PI / 2);
    S.decal('map2', 1.0, 0.75, x1 - t - 0.01, LOFT + 1.35, -12.25, -Math.PI / 2);
    S.decal('wanted', 0.42, 0.58, x1 - t - 0.01, LOFT + 1.5, -13.3, -Math.PI / 2, 0.05);
    L.box(M.drumRed(), 0.006, 0.006, 1.3, x1 - t - 0.015, 1.5, -11.6, 0.15);
    // the shelf by the front wall (the page lives on its middle board)
    const B = shelves(L, 16.6, zF - t - 0.2, 1.2, 0.36, 1.8, Math.PI, 0, 4, M.woodDark());
    reseed(77);
    stock(B, 0.7, true);
    L.box(M.paper(), 0.24, 0.015, 0.18, 16.6, B.ys[2] + 0.02, zF - t - 0.15, 0.25);
    L.box(M.paper(), 0.2, 0.012, 0.16, 16.62, B.ys[2] + 0.035, zF - t - 0.17, -0.1);
    trunk(L, 14.4, -13.6, 0.4);
    crate(L, 19.9, 0, -14.6, 0.8, 0.6, 0.7, 0.2, M.woodPale(), true);
    crate(L, 19.9, 0.6, -14.6, 0.6, 0.45, 0.5, -0.1);
    for (let i = 0; i < 7; i++) L.box(trim, 0.08, 0.14, zF - zB, x0 + 0.6 + i * 1.6, 2.62, (zF + zB) / 2, 0, -0.055);
  }
  H.spot('loft', 17.4, LOFT + 0.18, -7.4);
  H.spot('loftShelf', 16.6, LOFT + 0.9, -5.0);
  // outside: grime, sand, a rain chain, the lean-to woodpile
  grimeRun(S, x0, zB - 0.02, x1, zB - 0.02, Math.PI);
  grimeRun(S, x0 - 0.02, zB, x0 - 0.02, zF, -Math.PI / 2);
  grimeRun(S, x1 + 0.02, zB, x1 + 0.02, zF, Math.PI / 2);
  sandRun(S, x0 - 0.04, zB, x0 - 0.04, zF, -Math.PI / 2);
  drift(P, x0 - 0.45, -10.5, 9, Math.PI / 2, 0.36, 0.9);
  drift(P, 16.0, zB - 0.45, 9, 0, 0.3, 0.8);
  {
    const lx0 = x1, lx1 = x1 + 1.9, lz0 = -15.4, lz1 = -10.6;
    for (const z of [lz0, lz1]) post(S, M.woodGrey(), lx1, z, 0, 2.2, 0.06);
    sheetRoof(S, M.roofRust(), lx0, lx1 + 0.2, lz0 - 0.2, lz1 + 0.2, 2.3, 2.25, { fascia: trim });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) P.cyl(wood('#6a4a30'), 0.08, 0.08, 0.55, x1 + 0.45 + Math.floor(r / 2) * 0.58, 0.09 + (r % 2) * 0.16, lz0 + 0.4 + i * 0.5 + (r % 2) * 0.08, 7, 0, 0, Math.PI / 2);
    P.col(x1 + 0.75, 0.3, (lz0 + lz1) / 2, 0.55, 0.3, 2.2);
  }
}

function clapboard(S: Site, mat: Mat, x0: number, x1: number, z: number, y0: number, y1: number, ry: number, gaps: [number, number, number, number][]) {
  const dir = Math.cos(ry) > 0 ? 1 : -1;
  for (let y = y0 + 0.4; y < y1 - 0.08; y += 0.24) {
    let s = 0;
    const len = x1 - x0;
    const cuts = gaps.filter(([, , g0, g1]) => y > g0 - 0.12 && y < g1 + 0.12).sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    for (const [a, b] of cuts) { if (a > s) runs.push([s, a]); s = Math.max(s, b); }
    if (len > s) runs.push([s, len]);
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue;
      S.b.add(mat, box(b - a, 0.25, 0.022, x0 + (a + b) / 2, y, z, 0, -0.07 * dir));
    }
  }
}

function trunk(P: Pen, x: number, z: number, ry: number) {
  const Q = P.sub(x, 0, z, ry);
  Q.box(M.woodRed(), 0.9, 0.42, 0.5, 0, 0.21, 0).put(M.woodRed(), new THREE.CylinderGeometry(0.25, 0.25, 0.9, 10, 1, false, 0, Math.PI), 0, 0.42, 0, 0, 0, Math.PI / 2);
  for (const sx of [-0.3, 0.3]) Q.box(M.brass(), 0.05, 0.5, 0.52, sx, 0.3, 0);
  Q.box(M.brass(), 0.08, 0.1, 0.03, 0, 0.42, 0.26);
  Q.col(0, 0.3, 0, 0.45, 0.3, 0.26);
}

// ======================================================================= the motel
function motel(S: Site, H: Hooks) {
  const x0 = -11.0, x1 = 4.8, zF = 7.15, zB = 12.6, t = 0.25, top = 3.0;
  const wallM = M.motel(), coral = M.coral(), teal = M.teal();
  const inner = M.wallpaper();
  const dado = { y: MY + 0.95, mat: M.woodDark(), rail: M.wood() };
  const rooms = [{ id: 'a', mid: -8.3, x0: -10.75, x1: -5.81 }, { id: 'b', mid: -3.1, x0: -5.59, x1: -0.61 }, { id: 'c', mid: 2.1, x0: -0.39, x1: 4.55 }] as const;
  const glassA = S.nightGlow('#ffb066', 0.25, 2.2);
  const glassB = S.nightGlow('#c8a070', 0.06, 0.25);
  const holes: Hole[] = [];
  for (const r of rooms) {
    const s = (x: number) => x - x0;
    holes.push({ a: s(r.mid - 0.78), b: s(r.mid + 0.78), y0: MY, y1: MY + DOOR_H, kind: 'door' });
    const wa = r.mid + 1.1, wb = r.mid + 2.05;
    holes.push({ a: s(wa), b: s(wb), y0: MY + 0.85, y1: MY + 2.0, kind: 'window', glass: r.id === 'a' ? glassA : r.id === 'b' ? glassB : M.glassDark(), grid: [2, 1], curtain: r.id === 'c' ? undefined : r.id === 'a' ? M.curtain() : M.curtainGreen(), boards: r.id === 'c' ? M.woodDark() : undefined });
  }
  wall(S, { a: [x0, zF + t / 2], b: [x1, zF + t / 2], n: [0, -1], y0: 0, y1: top, t, out: wallM, inn: inner, dado, trim: M.cream(), holes });
  wall(S, { a: [x0, zB - t / 2], b: [x1, zB - t / 2], n: [0, 1], y0: 0, y1: top, t, out: wallM, inn: inner, dado });
  wall(S, { a: [x0 + t / 2, zF + t], b: [x0 + t / 2, zB - t], n: [-1, 0], y0: 0, y1: top, t, out: wallM, inn: inner, dado });
  wall(S, { a: [x1 - t / 2, zF + t], b: [x1 - t / 2, zB - t], n: [1, 0], y0: 0, y1: top, t, out: wallM, inn: inner, dado });
  for (const px of [-5.7, -0.5]) wall(S, { a: [px, zF + t], b: [px, zB - t], n: [1, 0], y0: 0, y1: top, t: 0.22, out: inner, inn: inner, dado });
  plinth(S, x0, x1, zF, zB, MY + 0.02, M.found(), rooms.map((r) => [r.mid - 0.78, r.mid + 0.78] as [number, number]));
  // roof, parapet, canopy over the walkway on steel posts
  floor(S, M.tar(), x0, x1, zF, zB, top + 0.18, 0.2, false);
  S.b.add(wallM, box(x1 - x0, 0.36, 0.2, (x0 + x1) / 2, top + 0.18, zB - 0.1), box(0.2, 0.36, zB - zF, x0 + 0.1, top + 0.18, (zF + zB) / 2), box(0.2, 0.36, zB - zF, x1 - 0.1, top + 0.18, (zF + zB) / 2));
  floor(S, M.slab(), x0 - 0.2, x1 + 0.2, 5.0, zF, MY, 0.2, true, 'concrete');
  S.b.add(M.found(), box(x1 - x0 + 0.4, 0.06, 0.12, (x0 + x1) / 2, MY + 0.005, 5.06));
  S.b.add(M.cream(), box(x1 - x0 + 0.5, 0.1, 2.35, (x0 + x1) / 2, 2.9, 6.0, 0, 0.03));
  S.b.add(coral, box(x1 - x0 + 0.54, 0.34, 0.06, (x0 + x1) / 2, 2.82, 4.82), box(0.06, 0.34, 2.35, x0 - 0.27, 2.82, 6.0), box(0.06, 0.34, 2.35, x1 + 0.27, 2.82, 6.0));
  S.b.add(M.cream(), box(x1 - x0 + 0.56, 0.05, 0.08, (x0 + x1) / 2, 2.62, 4.81));
  for (const px of [-10.8, -5.7, -0.5, 4.6]) post(S, M.steelDark(), px, 5.15, MY, 2.82, 0.05, false);
  const P = S.pen();
  // per room: a door state, a number, a sconce, an AC unit; inside: bed, lamp, TV, chair
  for (const r of rooms) {
    S.sign(r.id === 'a' ? 'room1' : r.id === 'b' ? 'room2' : 'room3', 0.2, 0.2, 0.02, r.mid - 1.05, MY + 1.7, zF - 0.01, Math.PI);
    const sg = S.nightGlow('#ffd2a0', 0.3, r.id === 'c' ? 0.0 : 4.0);
    sconce(S, S.pen(0, 0, 0, Math.PI), -(r.mid + 0.95), MY + 2.15, -(zF - 0.0), sg, r.id === 'c' ? 0 : 2.4, MY + 0.02);
    acUnit(P, r.mid + 1.58, MY + 2.42, zF - 0.02, Math.PI);
    const F = r.x1 - r.x0;
    // floors: carpet, a rug; ceiling
    floor(S, r.id === 'c' ? M.cardboard() : r.id === 'a' ? M.blanketRed() : M.blanketBlue(), r.x0, r.x1, zF, zB - t, MY + 0.005, 0.2);
    S.floorDecal('rug', 1.6, 1.2, r.mid - 0.4, MY + 0.012, 9.4, 0.1);
    floor(S, M.ceiling(), r.x0, r.x1, zF + t, zB - t, 2.86, 0.05, false);
    void F;
    // bed against the back wall, head at +z
    const messy = r.id === 'c';
    bed(P, r.mid - 0.55, zB - t - 1.06, Math.PI, MY, r.id === 'a' ? M.blanketRed() : r.id === 'b' ? M.blanketBlue() : M.blanketOlive(), { messy });
    const shade = S.nightGlow('#ffd8a0', r.id === 'a' ? 0.35 : 0.08, r.id === 'a' ? 3.2 : 0.25);
    const lc = nightstand(P, r.mid - 1.65, zB - t - 0.3, Math.PI, MY, shade);
    if (r.id === 'a') {
      S.halo(lc.x, lc.y, lc.z, '#ffd8a0', 0.55, HALO.ON, 1.2);
      S.pool('poolWarm', 2.6, 2.6, lc.x + 0.3, MY + 0.02, lc.z - 0.6);
      S.light(lc.x, lc.y + 0.1, lc.z - 0.2, 0xffbf80, 4, 7);
    }
    // dresser and TV on the right wall, facing the bed
    dresser(P, r.x1 - 0.3, 10.1, -Math.PI / 2, MY);
    const scr = r.id === 'a' ? S.nightGlow('#9ab8c8', 0.25, 1.2) : M.glassDark();
    crt(P, r.x1 - 0.32, MY + 0.8, 10.1, -Math.PI / 2, scr);
    if (r.id === 'a') S.halo(r.x1 - 0.55, MY + 1.05, 10.1, '#9ab8c8', 0.5, HALO.ON, 0.6);
    // bathroom door (closed), a picture over the bed
    P.box(M.woodPale(), 0.8, 2.0, 0.04, r.mid + 1.55, MY + 1.0, zB - t - 0.02).box(M.woodDark(), 0.9, 2.08, 0.03, r.mid + 1.55, MY + 1.04, zB - t - 0.01).cyl(M.brass(), 0.03, 0.03, 0.06, r.mid + 1.82, MY + 1.0, zB - t - 0.06, 8, Math.PI / 2);
    P.box(M.woodDark(), 0.7, 0.5, 0.03, r.mid - 0.55, MY + 1.75, zB - t - 0.015);
    S.decal(r.id === 'b' ? 'cola' : 'map2', 0.6, 0.42, r.mid - 0.55, MY + 1.75, zB - t - 0.035, Math.PI);
    if (r.id !== 'c') chair(P, r.mid + 1.55, zF + t + 0.6, Math.PI - 0.4, MY);
    S.floorDecal('dirt', 1.6, 1.6, r.mid, MY + 0.014, zF + t + 0.6, 0.3);
  }
  // room A: open door, the guest book on a little desk, a suitcase
  {
    const hinge = -9.08;
    P.box(teal, 1.5, 2.15, 0.05, hinge + Math.cos(-1.7) * 0.76, MY + 1.08, zF + t / 2 + Math.sin(1.7) * 0.76, -1.7 + Math.PI);
    table(P, -10.35, 8.3, 0.7, 0.5, 0.75, Math.PI / 2, MY, M.wood(), M.woodDark(), true);
    P.box(M.leatherBrown(), 0.26, 0.03, 0.34, -10.35, MY + 0.77, 8.3, 0.2).box(M.paper(), 0.24, 0.02, 0.32, -10.33, MY + 0.79, 8.3, 0.2);
    P.box(M.leatherBrown(), 0.7, 0.45, 0.25, -6.5, MY + 0.23, 11.6, 0.4);
    H.spot('guest', -10.3, MY + 0.85, 8.3);
    H.spot('motelA', -8.3, MY + 0.25, 8.6);
  }
  // room B: the locked door, tidy inside; the loot by the bed
  swingDoor(S, H, 'motelB', -3.88, -2.32, zF + t / 2, MY, 1.2, teal, 'panel');
  P.box(M.canvas(), 0.6, 0.35, 0.3, -2.4, MY + 0.18, 10.7, 0.5).box(M.leatherBrown(), 0.65, 0.04, 0.05, -2.4, MY + 0.37, 10.7, 0.5);
  H.spot('motelB', -3.1, MY + 0.87, 6.5);
  H.spot('motelBloot', -2.9, MY + 0.8, 10.6);
  // room C: boarded; inside is a mess
  {
    const boards = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) parts.push(box(1.9, 0.18, 0.05, 0, MY + 0.3 + i * 0.36, (i % 2) * 0.02, 0, 0, (i % 3 - 1) * 0.07 + (i === 2 ? 0.18 : 0)));
    parts.push(box(0.1, 2.0, 0.04, -0.7, MY + 1.1, 0.05, 0, 0, 0.05), box(0.1, 2.0, 0.04, 0.72, MY + 1.1, 0.05, 0, 0, -0.04));
    const mesh = new THREE.Mesh(merge(parts), M.woodDark());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    boards.add(mesh);
    boards.position.set(2.1, 0, zF - 0.05);
    S.root.add(boards);
    S.decal('keepout', 1.0, 0.62, 3.67, MY + 1.45, zF - 0.08, Math.PI);
    const collider = S.col(2.1, MY + DOOR_H / 2, zF + t / 2, 0.8, DOOR_H / 2, 0.12);
    H.blocker('boards', boards, collider);
    chair(P, 3.3, 8.6, 1.2, MY, M.wood(), 1.4);
    P.box(M.cardboard(), 0.5, 0.35, 0.45, 0.6, MY + 0.18, 8.5, 0.6).box(M.cardboard(), 0.4, 0.3, 0.4, 0.75, MY + 0.5, 8.4, -0.3);
    P.box(M.canvas(), 0.8, 0.35, 0.4, 2.6, MY + 0.18, 10.4, -0.3).box(M.blanketOlive(), 1.4, 0.06, 0.8, 1.1, MY + 0.03, 9.6, 0.4);
    S.floorDecal('stain', 2, 2, 2.0, MY + 0.016, 9.6, 0.7);
    S.decal('stain', 1.6, 1.6, 2.0, 2.84, 10.0, 0, 0);
    H.spot('motelC', 2.1, MY + 0.87, 6.5);
    H.spot('motelCloot', 2.4, MY + 0.8, 10.6);
  }
  // the motel sign: a pylon with MOTEL and VACANCY, double-sided, with a neon arrow
  {
    const mx = -12.7, mz = 5.6;
    for (const dz of [-0.3, 0.3]) S.b.add(M.steelDark(), box(0.16, 6.6, 0.16, mx, 3.3, mz + dz));
    S.col(mx, 3.3, mz, 0.12, 3.3, 0.45);
    S.b.add(teal, box(0.3, 3.3, 1.2, mx, 5.0, mz));
    S.sign('motel', 1.0, 3.0, 0.02, mx + 0.16, 5.0, mz, Math.PI / 2);
    S.sign('motel', 1.0, 3.0, 0.02, mx - 0.16, 5.0, mz, -Math.PI / 2);
    S.b.add(M.steelDark(), box(0.26, 0.9, 1.7, mx, 2.95, mz));
    S.sign('vacancy', 1.6, 0.8, 0.02, mx + 0.14, 2.95, mz, Math.PI / 2);
    S.sign('vacancy', 1.6, 0.8, 0.02, mx - 0.14, 2.95, mz, -Math.PI / 2);
    const arrow = glow('#ff3a6e', 4);
    for (const s of [1, -1]) {
      S.b.add(arrow.material, box(0.04, 0.04, 1.2, mx + s * 0.18, 6.8, mz - 0.1), box(0.04, 0.04, 0.5, mx + s * 0.18, 6.62, mz + 0.62, 0.7), box(0.04, 0.04, 0.5, mx + s * 0.18, 6.98, mz + 0.62, -0.7));
    }
    S.b.add(M.steelDark(), box(0.12, 0.5, 1.5, mx, 6.8, mz + 0.1));
    H.flicker({ set: (v) => (arrow.intensity.value = 4 * v), phase: 0.7, speed: 0.6, broken: 0.2 });
    S.halo(mx + 0.2, 6.8, mz, '#ff3a6e', 1.2, HALO.NEON, 0.7);
    S.halo(mx - 0.2, 6.8, mz, '#ff3a6e', 1.2, HALO.NEON, 0.7);
    S.halo(mx + 0.2, 5.0, mz, '#ffd8b0', 2.2, HALO.NIGHT, 0.5);
    S.halo(mx - 0.2, 5.0, mz, '#ffd8b0', 2.2, HALO.NIGHT, 0.5);
    H.audio('neon', mx, 5.0, mz);
  }
  // walkway life: lawn chairs, an ashtray can, a dead plant, the payphone, an ice-machine ghost
  lawnChair(P, -10.2, 6.1, Math.PI + 0.3, MY);
  lawnChair(P, -9.5, 5.8, Math.PI - 0.2, MY, M.blanketRed());
  P.cyl(M.galv(), 0.12, 0.12, 0.25, -9.85, MY + 0.125, 6.6, 8);
  P.cyl(M.coral(), 0.22, 0.17, 0.4, -6.5, MY + 0.2, 6.75, 10).cyl(M.sand(), 0.2, 0.2, 0.02, -6.5, MY + 0.4, 6.75, 10);
  for (let i = 0; i < 5; i++) P.beam(M.woodDark(), V(-6.5, MY + 0.4, 6.75), V(-6.5 + (rnd() - 0.5) * 0.5, MY + 0.8 + rnd() * 0.3, 6.75 + (rnd() - 0.5) * 0.5), 0.008, 3);
  payphone(P, x0 - 0.02, 0, 9.0, -Math.PI / 2);
  S.floorDecal('stain', 1.0, 0.8, 4.2, MY + 0.012, 6.5, 0);
  // roof: dish, antenna, a swamp cooler, vents
  dish(P, -8.0, top + 0.2, 11.4, Math.PI + 0.5, 0.5);
  P.cyl(M.galv(), 0.02, 0.02, 2.4, 1.0, top + 1.4, 11.6, 5).box(M.galv(), 0.9, 0.02, 0.02, 1.0, top + 2.3, 11.6).box(M.galv(), 0.6, 0.02, 0.02, 1.0, top + 2.0, 11.6, 0.3).box(M.galv(), 0.4, 0.02, 0.02, 1.0, top + 2.5, 11.6, -0.2);
  swampCooler(P, -3.2, top + 0.2, 10.6, 0.1);
  vent(P, 3.4, top + 0.2, 11.8, 0.07, 0.55);
  vent(P, -9.8, top + 0.2, 11.9, 0.07, 0.6);
  // back: water heater, pipes, grime, a drift
  P.cyl(M.galv(), 0.28, 0.28, 1.3, -1.8, 0.65, zB + 0.4, 12).put(M.galv(), new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), -1.8, 1.3, zB + 0.4);
  P.col(-1.8, 0.65, zB + 0.4, 0.3, 0.65, 0.3);
  P.beam(M.galv(), V(-1.8, 1.4, zB + 0.4), V(-1.8, 2.2, zB + 0.03), 0.025, 5);
  grimeRun(S, x0, zB + 0.006, x1, zB + 0.006, 0);
  grimeRun(S, x0 - 0.006, zF, x0 - 0.006, zB, -Math.PI / 2);
  grimeRun(S, x1 + 0.006, zF, x1 + 0.006, zB, Math.PI / 2);
  sandRun(S, x0, zB + 0.012, x1, zB + 0.012, 0);
  drift(P, -3.2, zB + 0.45, 15, 0, 0.34, 0.9);
  S.decal('tag', 3.2, 1.2, -3.5, 1.5, zB + 0.008, 0);
  for (const x of [-8, -1, 3]) S.decal('streaks', 2.0, 1.4, x, top - 0.6, zB + 0.008, 0);
  // a laundry line from the east wall to a T-pole
  {
    const tp = 10.6;
    P.cyl(wood('#4a3626'), 0.06, 0.07, 2.3, tp, 1.15, 9.4, 7).box(wood('#4a3626'), 0.08, 0.08, 1.0, tp, 2.2, 9.4);
    S.col(tp, 1.15, 9.4, 0.08, 1.15, 0.08);
    laundry(S, V(x1 + 0.02, 2.1, 9.0), V(tp, 2.2, 9.0), 0.25);
    laundry(S, V(x1 + 0.02, 2.05, 9.8), V(tp, 2.15, 9.8), 0.3);
    bucket(P, 9.6, 0, 8.6, M.galv());
  }
}

// ======================================================================= water tower, shed, fire, street
function tower(S: Site, H: Hooks) {
  const tx = -31, tz = 1.2, deckY = 6.0;
  const P = S.pen(tx, 0, tz);
  const steel = M.steelDark();
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    P.beam(steel, V(dx * 1.15, 0, dz * 1.15), V(dx * 0.95, deckY, dz * 0.95), 0.08, 6);
    P.box(M.found(), 0.4, 0.3, 0.4, dx * 1.15, 0.12, dz * 1.15);
    P.col(dx * 1.1, deckY / 2, dz * 1.1, 0.1, deckY / 2, 0.1);
  }
  for (const y of [0.4, 2.2, 4.1]) {
    const k = 1.15 - (y / deckY) * 0.2;
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as const) {
      P.beam(steel, V(a[0] * k, y + 1.8, a[1] * k), V(b[0] * k, y + 1.8, b[1] * k), 0.03, 4);
      if (y < 4) {
        P.beam(steel, V(a[0] * k, y, a[1] * k), V(b[0] * (k - 0.06), y + 1.8, b[1] * (k - 0.06)), 0.018, 4);
        P.beam(steel, V(b[0] * k, y, b[1] * k), V(a[0] * (k - 0.06), y + 1.8, a[1] * (k - 0.06)), 0.018, 4);
      }
    }
  }
  // deck, rail, the tank (staves + hoops), the roof
  P.box(M.woodGrey(), 3.4, 0.1, 3.4, 0, deckY + 0.05, 0);
  for (const [a, b] of [[[-1.7, -1.7], [1.7, -1.7]], [[1.7, -1.7], [1.7, 1.7]], [[1.7, 1.7], [-1.7, 1.7]], [[-1.7, 1.7], [-1.7, -1.7]]] as const) {
    P.beam(M.galv(), V(a[0], deckY + 1.0, a[1]), V(b[0], deckY + 1.0, b[1]), 0.02, 4);
    for (let i = 0; i <= 4; i++) { const t = i / 4; P.cyl(M.galv(), 0.015, 0.015, 1.0, a[0] + (b[0] - a[0]) * t, deckY + 0.5, a[1] + (b[1] - a[1]) * t, 4); }
  }
  const tankW = wood('#6e5236');
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    P.box(i % 7 === 3 ? M.woodDark() : tankW, 0.37, 2.5, 0.08, Math.sin(a) * 1.5, deckY + 1.35, Math.cos(a) * 1.5, a);
  }
  for (const y of [0.35, 1.0, 1.65, 2.3]) P.put(M.galv(), new THREE.TorusGeometry(1.56, 0.022, 4, 28), 0, deckY + 0.1 + y, 0, Math.PI / 2, 0, 0);
  P.put(M.roofGrey(), new THREE.ConeGeometry(1.8, 0.95, 20, 1, false), 0, deckY + 3.05, 0);
  P.cyl(M.galv(), 0.04, 0.06, 0.4, 0, deckY + 3.7, 0, 6);
  // ladder up a leg, a downpipe with a valve and spout
  for (const s of [-0.22, 0.22]) P.beam(M.galv(), V(1.25 + s, 0, 1.25 - s), V(1.05 + s, deckY + 1.0, 1.05 - s), 0.018, 4);
  for (let i = 1; i < 22; i++) { const t = i / 22, k = 1.25 - t * 0.2; P.beam(M.galv(), V(k - 0.22, t * (deckY + 1), k + 0.22), V(k + 0.22, t * (deckY + 1), k - 0.22), 0.012, 4); }
  P.cyl(M.galv(), 0.1, 0.1, deckY - 2.2, 0, 2.2 + (deckY - 2.2) / 2, 0, 8).put(M.galv(), new THREE.TorusGeometry(0.16, 0.025, 4, 8), 0, 2.6, 0, Math.PI / 2, 0, 0);
  P.beam(M.galv(), V(0, 2.25, 0), V(0.35, 2.0, 0.6), 0.08, 8).box(M.drumRed(), 0.2, 0.04, 0.04, 0, 2.6, 0.18);
  S.floorDecal('stain', 2.6, 2.6, tx + 0.3, 0.025, tz + 0.7, 0.4);
  S.floorDecal('dirt', 3.2, 3.2, tx, 0.022, tz, 1.3);
  // the crate under the tower
  crate(P, 0, 0, 0.1, 0.9, 0.7, 0.7, 0.2, M.woodDark(), true);
  P.box(M.steelDark(), 0.95, 0.06, 0.74, 0, 0.5, 0.1, 0.2).box(M.steelDark(), 0.95, 0.06, 0.74, 0, 0.2, 0.1, 0.2).box(M.brass(), 0.08, 0.1, 0.05, 0.07, 0.4, 0.47, 0.2);
  H.spot('tower', tx, 1.0, tz + 1.0);
}

function shed(S: Site, H: Hooks) {
  const x0 = 24.2, x1 = 29.6, zF = 8.15, zB = 12.7, h = 2.6, t = 0.12;
  const plank = M.woodGrey();
  wall(S, { a: [x0, zB - t / 2], b: [x1, zB - t / 2], n: [0, 1], y0: 0, y1: h, t, out: plank, inn: plank });
  wall(S, { a: [x0 + t / 2, zF], b: [x0 + t / 2, zB - t], n: [-1, 0], y0: 0, y1: h, t, out: plank, inn: plank });
  wall(S, { a: [x1 - t / 2, zF], b: [x1 - t / 2, zB - t], n: [1, 0], y0: 0, y1: h, t, out: plank, inn: plank });
  const P = S.pen();
  for (let x = x0; x < x1; x += 0.3) { P.box(M.woodDark(), 0.015, h, 0.02, x, h / 2, zB + 0.005); }
  for (let z = zF; z < zB; z += 0.3) { P.box(M.woodDark(), 0.02, h, 0.015, x0 - 0.005, h / 2, z); P.box(M.woodDark(), 0.02, h, 0.015, x1 + 0.005, h / 2, z); }
  post(S, M.woodDark(), x0 + 0.08, zF + 0.08, 0, h, 0.08);
  post(S, M.woodDark(), x1 - 0.08, zF + 0.08, 0, h, 0.08);
  S.b.add(M.woodDark(), box(x1 - x0, 0.2, 0.14, (x0 + x1) / 2, h + 0.05, zF + 0.07));
  sheetRoof(S, M.roofRust(), x0 - 0.3, x1 + 0.3, zF - 0.5, zB + 0.35, 3.0, 2.6, { fascia: M.woodDark(), patch: M.roofGrey(), patches: 2, seed: 5 });
  // workbench with tools; shovels; a wheelbarrow; tires; the crate
  table(P, (x0 + x1) / 2, zB - 0.45, 3.6, 0.6, 0.9, 0, 0, M.wood(), M.woodDark(), true);
  P.box(M.steelDark(), 0.15, 0.12, 0.2, 25.6, 0.96, zB - 0.4).box(M.wood(), 0.3, 0.03, 0.06, 26.4, 0.915, zB - 0.5, 0.5).box(M.steelDark(), 0.06, 0.05, 0.12, 26.55, 0.92, zB - 0.45, 0.5);
  P.box(M.steelDark(), 0.5, 0.01, 0.12, 27.4, 0.91, zB - 0.4, -0.2).box(M.wood(), 0.12, 0.04, 0.04, 27.7, 0.92, zB - 0.45, -0.2);
  P.box(M.woodPale(), 3.4, 0.8, 0.03, (x0 + x1) / 2, 1.75, zB - t - 0.02);
  for (let i = 0; i < 8; i++) P.box(i % 2 ? M.steelDark() : M.wood(), 0.04, 0.3 + (i % 3) * 0.1, 0.03, 25.0 + i * 0.4, 1.75, zB - t - 0.05);
  for (let i = 0; i < 3; i++) { P.cyl(M.wood(), 0.018, 0.018, 1.4, x1 - 0.25, 0.7, 9.0 + i * 0.25, 5, 0.12, 0, 0.1); P.box(M.steelDark(), 0.22, 0.28, 0.03, x1 - 0.3 + 0.07, 0.15, 9.0 + i * 0.25 - 0.07, 0.12, 0, 0.1); }
  {
    const W = S.pen(25.3, 0, 9.6, 0.5);
    W.put(M.drumRed(), new THREE.CylinderGeometry(0.42, 0.28, 0.3, 10, 1, true), 0, 0.55, 0, 0, 0, 0, 1.3, 1, 1);
    W.put(M.drumRed(), new THREE.CircleGeometry(0.28, 10), 0, 0.4, 0, -Math.PI / 2, 0, 0, 1.3, 1, 1);
    W.put(M.rubber(), new THREE.TorusGeometry(0.17, 0.05, 6, 12), 0, 0.2, 0.62, 0, Math.PI / 2, 0);
    for (const s of [-0.22, 0.22]) W.beam(M.wood(), V(s, 0.45, 0.62), V(s * 1.2, 0.6, -0.85), 0.02, 4).beam(M.steelDark(), V(s, 0.42, -0.2), V(s, 0, -0.35), 0.015, 4);
  }
  for (let i = 0; i < 3; i++) tire(P, 28.7, 0.14 + i * 0.27, 9.2);
  P.col(28.7, 0.45, 9.2, 0.45, 0.45, 0.45);
  crate(P, 27.8, 0, 10.6, 0.85, 0.55, 0.6, 0.1, M.woodPale(), true);
  P.put(M.burlap(), new THREE.TorusGeometry(0.18, 0.05, 6, 14), 27.7, 0.6, 10.6, Math.PI / 2, 0, 0);
  // the wash board on posts in front, and a painted arrow
  for (const x of [26.2, 27.6]) post(S, M.woodDark(), x, 7.7, 0, 1.95, 0.05, false);
  S.sign('wash', 1.6, 0.8, 0.05, 26.9, 1.55, 7.68, Math.PI);
  S.sign('arrow', 0.8, 0.4, 0.03, 26.9, 2.15, 7.68, Math.PI, 0, 0.25);
  S.col(26.9, 1.0, 7.7, 0.8, 1.0, 0.08);
  H.spot('shed', 26.9, 1.05, 7.0);
  grimeRun(S, x0 - 0.06, zB + 0.03, x1, zB + 0.03, 0);
  drift(P, (x0 + x1) / 2, zB + 0.4, 6, 0, 0.3, 0.8);
}

function fireCircle(S: Site, H: Hooks) {
  const fx = -0.4, fz = 2.3;
  const P = S.pen();
  const face = (x: number, z: number) => Math.atan2(fx - x, fz - z);
  // Sol on a log, Ren on a crate, an empty lawn chair, a guitar against the log
  const sol = { x: -2.15, z: 2.55 }, ren = { x: 1.55, z: 3.15 };
  const sy = face(sol.x, sol.z), ry2 = face(ren.x, ren.z);
  log(P, sol.x - Math.sin(sy) * 0.05, sol.z - Math.cos(sy) * 0.05, 1.8, sy, 0.22);
  H.npc({ id: 'sol', look: LOOKS.sol, pose: 'warm', x: sol.x, y: 0, z: sol.z, yaw: sy, seat: 0.44, notice: 5 });
  H.spot('sol', sol.x, 1.05, sol.z);
  crate(P, ren.x - Math.sin(ry2) * 0.02, 0, ren.z - Math.cos(ry2) * 0.02, 0.48, 0.4, 0.42, ry2, M.woodPale(), true);
  H.npc({ id: 'ren', look: LOOKS.ren, pose: 'mug', x: ren.x, y: 0, z: ren.z, yaw: ry2, seat: 0.42, notice: 5 });
  H.spot('ren', ren.x, 1.05, ren.z);
  S.col(sol.x + Math.sin(sy) * 0.25, 0.6, sol.z + Math.cos(sy) * 0.25, 0.3, 0.6, 0.3, sy);
  S.col(ren.x + Math.sin(ry2) * 0.25, 0.6, ren.z + Math.cos(ry2) * 0.25, 0.3, 0.6, 0.3, ry2);
  lawnChair(P, -1.0, 4.4, face(-1.0, 4.4), 0, M.blanketOlive());
  log(P, 0.7, 0.35, 1.5, 0.5, 0.2);
  guitar(P, sol.x - 0.7, 0.0, sol.z - 0.55, sy + 0.9, 0.35);
  // tripod and pot over the fire, coffee pot on a stone, firewood
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    P.beam(M.steelDark(), V(fx + Math.cos(a) * 0.75, 0, fz + Math.sin(a) * 0.75), V(fx, 1.45, fz), 0.016, 4);
  }
  P.beam(M.steelDark(), V(fx, 1.45, fz), V(fx, 0.95, fz), 0.006, 3);
  P.cyl(M.black(), 0.2, 0.17, 0.24, fx, 0.82, fz, 12).put(M.steelDark(), new THREE.TorusGeometry(0.2, 0.008, 4, 10, Math.PI), fx, 0.95, fz, 0, 0, 0);
  P.put(M.drumBlue(), new THREE.CylinderGeometry(0.06, 0.09, 0.2, 10), fx + 0.75, 0.2, fz - 0.3).put(M.drumBlue(), new THREE.ConeGeometry(0.03, 0.08, 6), fx + 0.83, 0.25, fz - 0.3, 0, 0, -1.2);
  for (let i = 0; i < 10; i++) P.cyl(wood('#5a3e28'), 0.07, 0.07, 0.6 + (i % 3) * 0.1, 1.9 + (i % 4) * 0.15, 0.08 + Math.floor(i / 4) * 0.13, 0.5 + (i % 2) * 0.05, 6, Math.PI / 2, 0.1 * (i % 3), 0);
  P.col(2.1, 0.2, 0.5, 0.4, 0.2, 0.4);
  S.floorDecal('soot', 3.4, 3.4, fx, 0.025, fz, 0.5);
  S.floorDecal('dirt', 6, 6, fx, 0.02, fz, 1.2);
  S.pool('poolFire', 9, 9, fx, 0.04, fz);
  // barrels (one with a lid and a cup on it)
  drum(P, 2.4, 1.4, M.drumBlue(), 0.3, false, 0, true);
  drum(P, 3.1, 1.9, M.drumBlue(), 1.1, false, 0, true);
  P.cyl(M.woodPale(), 0.3, 0.3, 0.04, 2.4, 0.9, 1.4, 12).cyl(M.enamel(), 0.04, 0.035, 0.09, 2.45, 0.96, 1.35, 8);
  P.cyl(M.enamel(), 0.04, 0.035, 0.09, -1.75, 0.04, 3.2, 8).put(M.paper(), new THREE.BoxGeometry(0.2, 0.01, 0.14), -1.9, 0.01, 3.3, 0, 0.4, 0);
  H.audio('fire', fx, 0.3, fz);
  H.audio('crowd', fx, 1.0, fz);
}

/** The street itself: packed dirt, tracks, poles and wires, string lights, cars, the town sign. */
function street(S: Site, H: Hooks) {
  const P = S.pen();
  reseed(99);
  for (let x = -30; x <= 26; x += 4.6) for (const z of [-1.0, 3.0, 6.6]) {
    if (z === 6.6 && x > -12 && x < 6) continue;
    S.floorDecal('packed', 6 + rnd() * 2, 5 + rnd() * 2, x + rnd() * 1.4, 0.03 + rnd() * 0.004, z + rnd(), rnd() * 6.28);
  }
  for (const [x, z, rot, len] of [[-14, 2.0, 0.02, 11], [-3, 2.4, -0.03, 11], [8, 2.1, 0.0, 11], [19, 2.6, 0.05, 11], [-25, 3.4, 0.4, 7], [22, 5.0, -0.6, 6]] as const) S.floorDecal('tracks', len, 2.0, x, 0.036, z, rot);
  for (const [x, z] of [[-8, 0.5], [6, 4.4], [16, 1.0], [-20, 4.6]] as const) S.floorDecal('cracks', 3, 3, x, 0.037, z, rnd() * 6);
  S.floorDecal('oil', 2.0, 2.0, -26.4, 0.036, 5.6, 0.4);
  S.floorDecal('oil', 1.6, 1.6, 21.2, 0.036, 6.8, 1.4);
  // poles along the north side, wires sagging between, drops to the roofs, two street lamps
  const poles = [-27.5, -11.6, 6.6, 23.0].map((x) => ({ x, a: utilityPole(S, x, -1.0, 8.2) }));
  for (let i = 0; i < poles.length - 1; i++) for (let k = 0; k < 3; k++) P.wire(M.cable(), poles[i].a[k], poles[i + 1].a[k], 0.7 + k * 0.05, 0.012, 18);
  P.wire(M.cable(), poles[0].a[0], V(-27.5, 7.4, -1.0).add(V(-14, 0, 0)), 0.9, 0.012, 14);
  P.wire(M.cable(), poles[3].a[2], V(38, 7.6, -1.0), 0.9, 0.012, 14);
  for (const [i, tx, ty, tz] of [[1, -13.0, 3.9, -4.6], [1, -3.4, 3.6, -5.4], [2, 11.4, 6.4, -4.5]] as const) P.wire(M.cable(), poles[i].a[i === 1 && tx > -5 ? 2 : 1], V(tx, ty, tz), 0.4, 0.01, 10);
  P.cyl(M.galv(), 0.3, 0.3, 0.8, -11.6 + 0.35, 6.6, -1.0, 10).beam(M.cable(), V(-11.25, 7.0, -1.0), V(-11.6, 7.6, -1.0), 0.01, 3);
  for (const pxs of [-11.6, 6.6]) {
    const L = S.pen(pxs, 0, -1.0);
    L.beam(M.steelDark(), V(0, 6.4, 0), V(0, 6.6, 1.6), 0.035, 6);
    L.box(M.steelDark(), 0.28, 0.12, 0.6, 0, 6.55, 1.85, 0, 0.1);
    const g = S.nightGlow('#ffd9a8', 0.2, 6);
    L.box(g, 0.2, 0.03, 0.45, 0, 6.48, 1.85);
    S.halo(pxs, 6.42, 0.85, '#ffd2a0', 1.1, HALO.NIGHT, 1.3);
    S.pool('poolWarm', 8, 8, pxs, 0.045, 1.2);
    S.light(pxs, 6.2, 0.85, 0xffc888, 10, 16, 1.4);
  }
  // string lights zig-zagging across the street
  const bulbs = { material: S.nightGlow('#ffcc88', 0.5, 4.5) };
  const chain = [V(-12.0, 3.0, -2.75), V(-5.7, 2.85, 5.1), V(1.62, 2.95, -3.9), V(4.6, 2.85, 5.1), V(12.9, 3.05, -2.45)];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    S.b.add(M.cable(), wire(a, b, 0.6, 0.008, 18));
    const n = Math.round(a.distanceTo(b) / 0.9);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const p = a.clone().lerp(b, t);
      p.y -= 0.6 * 4 * t * (1 - t) + 0.07;
      bulb(S, bulbs.material, p.x, p.y, p.z, 0.045, (k % 2 ? 0.4 : 0), '#ffcc88');
    }
  }
  // the dead sedan and the pickup by the shed
  sedan(S, -26.5, 5.4, 0.08, '#4a6a7a');
  pickup(S, 20.8, 6.9, Math.PI / 2 + 0.12, '#8a3a2a');
  // town sign at the east end, facing the highway
  for (const z of [-0.9, 0.9]) post(S, M.woodDark(), 31.5, z, 0, 2.4, 0.07, false);
  S.sign('town', 2.2, 0.96, 0.06, 31.55, 1.85, 0, Math.PI / 2);
  S.b.add(M.woodGrey(), box(0.05, 1.0, 2.24, 31.47, 1.85, 0));
  S.col(31.5, 1.2, 0, 0.1, 1.2, 1.0);
  // street junk: a shopping cart, tires, a bench, a cairn of cans
  {
    const C = S.pen(8.6, 0, -1.8, 0.6);
    C.box(M.chrome(), 0.55, 0.02, 0.85, 0, 0.42, 0);
    for (const sx of [-0.27, 0.27]) for (let i = 0; i < 5; i++) C.box(M.chrome(), 0.01, 0.4, 0.01, sx, 0.62, -0.4 + i * 0.2);
    for (let i = 0; i < 4; i++) C.box(M.chrome(), 0.01, 0.4, 0.01, -0.2 + i * 0.13, 0.62, 0.43);
    C.box(M.chrome(), 0.56, 0.02, 0.02, 0, 0.82, 0.43).box(M.chrome(), 0.02, 0.02, 0.86, 0.28, 0.82, 0).box(M.chrome(), 0.02, 0.02, 0.86, -0.28, 0.82, 0).box(M.chrome(), 0.6, 0.03, 0.03, 0, 0.95, -0.52);
    for (const [sx, sz] of [[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35]]) C.cyl(M.rubber(), 0.06, 0.06, 0.03, sx, 0.06, sz, 8, 0, 0, Math.PI / 2);
    C.put(M.rubber(), new THREE.TorusGeometry(0.06, 0.02, 4, 8), 0.3, 0.05, 0.6, 0, 0.3, 0);
  }
  tire(P, -6.8, 0.13, -1.6, Math.PI / 2, 0.4);
  tire(P, 5.0, 0.13, 4.2, Math.PI / 2, 1.2);
  for (const [x, z, r] of [[9.3, -2.8, 0.4], [-11.8, 4.4, 1.1], [-27.0, -2.2, 0.2]] as const) { crate(P, x, 0, z, 0.7, 0.55, 0.55, r, M.woodPale(), true); }
  sandbags(P, -24.6, 8.4, 2.4, 0.3, 2);
  // back fence: posts with two rails and a sagging strand of wire
  for (let i = 0; i < 8; i++) {
    const px = -22 + i * 5.2;
    post(S, wood('#3a2a1c'), px, -17.4, 0, 1.5, 0.06);
    if (i < 7) {
      P.box(wood('#5a4632'), 5.2, 0.1, 0.05, px + 2.6, 1.25, -17.38, 0, 0, (rnd() - 0.5) * 0.03).box(wood('#5a4632'), 5.2, 0.1, 0.05, px + 2.6, 0.7, -17.38, 0, 0, (rnd() - 0.5) * 0.04);
      P.wire(M.cable(), V(px, 1.45, -17.4), V(px + 5.2, 1.45, -17.4), 0.12, 0.005, 10);
    }
  }
  // the dry creek bed behind the motel: stones, a dead branch, an old tyre
  for (let i = 0; i < 14; i++) {
    const x = 2 + i * 1.3 + rnd(), z = 15.2 + Math.sin(i * 0.7) * 1.2 + rnd();
    P.put(plainStandard('#8a7a64', 0.95), new THREE.DodecahedronGeometry(0.18 + rnd() * 0.25, 0), x, 0.06, z, rnd(), rnd() * 6, rnd(), 1, 0.5, 1);
  }
  S.floorDecal('dirt', 10, 4, 9.0, 0.03, 15.8, 0.1);
  S.floorDecal('cracks', 4, 3, 7.5, 0.033, 16.0, 0.2);
  tire(P, 10.4, 0.12, 16.6, Math.PI / 2 + 0.2, 0.9);
  P.beam(wood('#6a5a48'), V(6.2, 0.05, 15.0), V(8.4, 0.25, 16.8), 0.06, 5).beam(wood('#6a5a48'), V(7.6, 0.18, 16.2), V(8.1, 0.6, 15.8), 0.03, 4);
  H.spot('forage', 8.5, 0.8, 16.2);
  // cairns guide the eye toward the shed and the wash beyond it
  const stone = plainStandard('#9a8a72', 0.95);
  cairn(P, 30.5, 0, 6.0, 0.7, stone);
  cairn(P, 33.5, 0, 9.5, 0.55, stone);
  H.spot('street', -2, 0.25, 4.6);
  H.spot('fire', -0.4, 0.3, 2.3);
}

/** Builds Dry Creek into `S`. Returns the live handles for update(). */
export function buildDryCreek(S: Site, H: Hooks): CreekLive {
  reseed(1234567);
  diner(S, H);
  const live = clinic(S, H);
  till(S, H);
  motel(S, H);
  tower(S, H);
  shed(S, H);
  fireCircle(S, H);
  street(S, H);
  void sack; void tire; void Pen;
  return live;
}
