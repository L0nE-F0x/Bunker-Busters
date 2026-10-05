import * as THREE from 'three/webgpu';
import { box, cyl, beam, wire, norm, type MeshBatch } from '../world/kit';
import { rustyMetal, concrete, plainStandard, wood, fabric, type GlowSlot } from '../world/materials';
import type { GlowSprites } from '../world/effects';
import { decal, floorDecal, decalMaterial, lightPoolMaterial, type DecalName } from './garageAtlas';

/**
 * Set dressing for The Garage: the lived-in clutter, grime and light that make it read as a real
 * prepper's garage. Purely visual, plus a few colliders for the bigger pieces. Everything goes into
 * the builder's merged batches (one mesh per material), decals into a second shadowless batch.
 */

export interface Dress {
  /** static geometry, casts + receives shadows */
  b: MeshBatch;
  /** decals and light pools (no shadows) */
  d: MeshBatch;
  halos: GlowSprites;
  /** a slot in the shared glow palette (one material for every small light) */
  glow: (color: THREE.ColorRepresentation, intensity: number) => GlowSlot;
  col: (x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY?: number) => void;
  /** register a blinking emissive; returns its halo channel */
  blink: (u: { value: number }, period: number, offset: number, on: number) => number;
}

/** Halo channels (see GlowSprites): fixed ones first, blinkers after. */
export const CH = { ON: 0, NIGHT: 1, TUBES: 2, ALARM: 3, NEON: 4, LASER: 5, BLINK0: 6 } as const;

// shared look-up for materials used across several functions (all memoized factories)
const M = {
  steelDark: () => rustyMetal({ base: '#3b4044', rust: 0.35, metalness: 0.75, roughness: 0.45 }),
  steel: () => rustyMetal({ base: '#5c6266', rust: 0.35 }), // = interior "metal"
  galv: () => rustyMetal({ base: '#9a9a96', rust: 0.4 }), // = solar frame
  drumBlue: () => rustyMetal({ base: '#2d5275', rust: 0.5, metalness: 0.55, roughness: 0.5 }),
  drumRed: () => rustyMetal({ base: '#a3301f', rust: 0.45, metalness: 0.5, roughness: 0.5 }),
  brass: () => rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 }),
  block: () => concrete('#a69d8e', { stains: 0.8 }),
  apron: () => concrete('#8e877c', { stains: 0.5 }),
  pallet: () => wood('#8a6a40'),
  stake: () => wood('#5a4028'),
  rubber: () => plainStandard('#161412', 0.95),
  cable: () => plainStandard('#1a1a1a', 0.6, 0.6),
  cardboard: () => fabric('#9c7a52', 0.95),
  plastic: () => plainStandard('#2a5d8f', 0.55, 0),
  dark: () => plainStandard('#202326', 0.4, 0.6),
  water: () => plainStandard('#6f9fc4', 0.25, 0),
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v(1, 1, 1)));
  return norm(g);
}

/** Oil drum with rolled rims; `tip` lays it on its side along `ry`. */
function drum(D: Dress, mat: THREE.Material, x: number, z: number, ry = 0, tip = false, y0 = 0) {
  const r = 0.29, h = 0.88;
  const parts = [
    new THREE.CylinderGeometry(r, r, h, 16),
    new THREE.TorusGeometry(r, 0.018, 4, 16).rotateX(Math.PI / 2).translate(0, h / 2 - 0.01, 0),
    new THREE.TorusGeometry(r, 0.018, 4, 16).rotateX(Math.PI / 2).translate(0, -h / 2 + 0.01, 0),
    new THREE.TorusGeometry(r + 0.005, 0.014, 4, 16).rotateX(Math.PI / 2).translate(0, h * 0.17, 0),
    new THREE.TorusGeometry(r + 0.005, 0.014, 4, 16).rotateX(Math.PI / 2).translate(0, -h * 0.17, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8).translate(r * 0.55, h / 2 + 0.005, 0), // bung
  ];
  for (const g of parts) {
    if (tip) D.b.add(mat, place(g, x, y0 + r, z, 0, ry, Math.PI / 2));
    else D.b.add(mat, place(g, x, y0 + h / 2, z, 0, ry, 0));
  }
}

function tire(D: Dress, x: number, y: number, z: number, rx = Math.PI / 2, ry = 0) {
  D.b.add(M.rubber(), place(new THREE.TorusGeometry(0.36, 0.15, 8, 18), x, y, z, rx, ry));
}

/** Wooden pallet (top boards + stringers) with its base at y. */
function pallet(D: Dress, x: number, y: number, z: number, ry = 0) {
  const m = M.pallet();
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (let i = 0; i < 5; i++) { const [px, pz] = at(-0.5 + i * 0.25, 0); D.b.add(m, box(0.16, 0.025, 1.2, px, y + 0.135, pz, ry)); }
  for (const lz of [-0.5, 0, 0.5]) { const [px, pz] = at(0, lz); D.b.add(m, box(1.15, 0.1, 0.09, px, y + 0.07, pz, ry)); }
  for (let i = 0; i < 3; i++) { const [px, pz] = at(-0.45 + i * 0.45, 0); D.b.add(m, box(0.14, 0.02, 1.2, px, y + 0.01, pz, ry)); }
}

/** Cardboard box with a tape strip. */
function carton(D: Dress, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
  D.b.add(M.cardboard(), box(w, h, d, x, y + h / 2, z, ry));
  D.b.add(M.dark(), box(w + 0.004, 0.004, 0.05, x, y + h + 0.001, z, ry));
}

/** Steel shelving unit: 4 angle uprights + `levels` shelves. Origin at the floor centre. */
function shelving(D: Dress, x: number, z: number, w: number, d: number, hgt: number, ry: number, levels: number) {
  const m = M.steelDark();
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
    const [px, pz] = at(lx * 0.98, lz * 0.9);
    D.b.add(m, box(0.04, hgt, 0.04, px, hgt / 2, pz, ry));
  }
  const ys: number[] = [];
  for (let i = 0; i < levels; i++) {
    const y = 0.12 + (i * (hgt - 0.2)) / (levels - 1);
    ys.push(y);
    D.b.add(m, box(w, 0.025, d, x, y, z, ry));
    // front lip
    const [fx, fz] = at(0, d / 2);
    D.b.add(m, box(w, 0.05, 0.012, fx, y - 0.01, fz, ry));
  }
  // diagonal back brace
  const [b0x, b0z] = at(-w / 2, -d / 2 + 0.02), [b1x, b1z] = at(w / 2, -d / 2 + 0.02);
  D.b.add(m, beam(v(b0x, 0.15, b0z), v(b1x, hgt - 0.1, b1z), 0.008, 4));
  return { ys, at };
}

/** Can of food: small cylinder with a label band. */
function can(D: Dress, x: number, y: number, z: number, r = 0.04, h = 0.11) {
  D.b.add(rustyMetal({ base: '#b9b5a8', rust: 0.4, metalness: 0.8, roughness: 0.4 }), cyl(r, r, h, x, y + h / 2, z, 8));
}

function lightPool(D: Dress, name: DecalName, w: number, h: number, x: number, y: number, z: number, rot = 0) {
  D.d.add(lightPoolMaterial(), floorDecal(name, w, h, x, y, z, rot));
}

function wallDecal(D: Dress, name: DecalName, w: number, h: number, x: number, y: number, z: number, ry: number) {
  D.d.add(decalMaterial(), decal(name, w, h, x, y, z, 0, ry, 0));
}

function ground(D: Dress, name: DecalName, w: number, h: number, x: number, y: number, z: number, rot = 0) {
  D.d.add(decalMaterial(), floorDecal(name, w, h, x, y, z, rot));
}

/** Sign plate: steel backing + atlas face. `ry` = facing direction (0 → +z). */
function sign(D: Dress, name: DecalName, w: number, h: number, x: number, y: number, z: number, ry = 0, tilt = 0) {
  const nx = Math.sin(ry), nz = Math.cos(ry);
  D.b.add(M.galv(), box(w + 0.02, h + 0.02, 0.015, x, y, z, ry, 0, tilt));
  D.d.add(decalMaterial(), decal(name, w, h, x + nx * 0.011, y, z + nz * 0.011, 0, ry, tilt));
}

// ======================================================================= exterior: the building
export function dressHouse(D: Dress, H: { x0: number; x1: number; z0: number; z1: number; h: number }) {
  const { x0, x1, z0, z1, h } = H;

  // ---- foundation plinth (slightly proud, darker) all round, split at the side door
  const pl = M.apron();
  const ph = 0.32, po = 0.07;
  D.b.add(pl,
    box(x1 - x0 + po * 2, ph, po * 2, 0, ph / 2, z0 - 0.0),
    box(po * 2, ph, z1 - z0, x0, ph / 2, (z0 + z1) / 2),
    box(po * 2, ph, -3.8 - z0, x1, ph / 2, (z0 - 3.8) / 2),
    box(po * 2, ph, z1 + 2.2, x1, ph / 2, (-2.2 + z1) / 2),
    box(3 + po, ph, po * 2, -6.5 - po / 2, ph / 2, z1),
    box(3 + po, ph, po * 2, 6.5 + po / 2, ph / 2, z1),
  );
  // concrete step at the side door
  D.b.add(pl, box(0.7, 0.12, 1.9, x1 + 0.35, 0.06, -3.0));

  // ---- roll-up door: 12 ribbed slats, guide rails, bottom bar, weld beads, anchor plates
  const slat = rustyMetal({ base: '#7d8789', rust: 0.08, metalness: 0.65, roughness: 0.5, scale: 2.2 });
  const gx = 5, gh = 3.4, n = 12, sh = gh / n;
  for (let i = 0; i < n; i++) {
    const y = sh * (i + 0.5);
    D.b.add(slat, box(gx * 2 - 0.1, sh - 0.035, 0.05, 0, y, z1 + 0.02));
    // rolled knuckle at each joint catches a highlight
    D.b.add(slat, cyl(0.022, 0.022, gx * 2 - 0.1, 0, sh * i + 0.01, z1 + 0.035, 6, 0, 0, Math.PI / 2));
  }
  D.b.add(M.steelDark(), box(gx * 2 - 0.05, 0.09, 0.1, 0, 0.05, z1 + 0.03)); // bottom bar
  for (const sx of [-1, 1]) {
    D.b.add(M.steelDark(), box(0.12, gh + 0.15, 0.16, sx * (gx + 0.04), (gh + 0.15) / 2, z1 + 0.03)); // guide rail
    D.b.add(M.steelDark(), box(0.3, 0.06, 0.25, sx * 3.2, 0.03, z1 + 0.16)); // welded anchor plate
    D.b.add(M.cable(), box(0.06, 0.25, 0.05, sx * 3.2, 0.14, z1 + 0.07)); // weld bead to slat
  }
  // the barrel housing on the inside, above the opening
  D.b.add(M.steelDark(), box(gx * 2 + 0.5, 0.55, 0.55, 0, gh + 0.32, z1 - 0.62));
  D.b.add(M.steelDark(), cyl(0.09, 0.09, 0.12, gx + 0.32, gh + 0.32, z1 - 0.62, 10, 0, 0, Math.PI / 2));
  // a padlocked hasp at the bottom centre (decor: the door is welded anyway)
  D.b.add(M.brass(), box(0.12, 0.15, 0.05, 0.4, 0.22, z1 + 0.09));

  // ---- roof edge: fascia, gutters and downspouts
  const trim = rustyMetal({ base: '#6f7a7c', rust: 0.6 });
  D.b.add(trim, box(x1 - x0 + 0.8, 0.22, 0.04, 0, h + 0.12, z1 + 0.42), box(x1 - x0 + 0.8, 0.22, 0.04, 0, h + 0.5, z0 - 0.42));
  D.b.add(trim, box(0.04, 0.22, z1 - z0 + 0.8, x0 - 0.42, h + 0.32, (z0 + z1) / 2, 0, 0.03), box(0.04, 0.22, z1 - z0 + 0.8, x1 + 0.42, h + 0.32, (z0 + z1) / 2, 0, 0.03));
  const galv = M.galv();
  D.b.add(galv, box(x1 - x0 + 0.6, 0.1, 0.14, 0, h + 0.02, z1 + 0.5)); // front gutter
  for (const [sx, sz] of [[x1 + 0.25, z1 + 0.5], [x0 - 0.25, z1 + 0.5]]) {
    D.b.add(galv, cyl(0.05, 0.05, h - 0.3, sx, (h - 0.3) / 2 + 0.25, sz, 8));
    D.b.add(galv, beam(v(sx, h, sz), v(sx, h - 0.35, sz), 0.05, 8));
    D.b.add(galv, beam(v(sx, 0.3, sz), v(sx + (sx > 0 ? 0.2 : -0.2), 0.08, sz + 0.25), 0.05, 8)); // kick-out
    for (const by of [1.2, 2.6]) D.b.add(galv, box(0.12, 0.03, 0.12, sx, by, sz - 0.04));
  }
  // splash stains under the downspouts
  ground(D, 'dirt', 1.6, 1.6, x1 + 0.6, 0.035, z1 + 1.0, 0.4);
  ground(D, 'dirt', 1.6, 1.6, x0 - 0.6, 0.035, z1 + 1.0, 1.4);

  // ---- electrics on the east wall: meter, conduit to the roof, warning sticker
  D.b.add(M.galv(), box(0.14, 0.55, 0.38, x1 + 0.07, 1.55, -0.9));
  D.b.add(M.dark(), cyl(0.1, 0.1, 0.05, x1 + 0.15, 1.65, -0.9, 14, 0, 0, Math.PI / 2));
  D.b.add(M.galv(), cyl(0.025, 0.025, h - 1.8, x1 + 0.05, 1.8 + (h - 1.8) / 2, -0.82, 6));
  D.b.add(M.galv(), cyl(0.025, 0.025, 1.3, x1 + 0.05, 0.65, -0.98, 6));
  sign(D, 'signVolt', 0.24, 0.24, x1 + 0.155, 1.2, -0.9, Math.PI / 2);

  // ---- security camera on the front-east corner (fake, but its LED blinks)
  const camX = x1 - 0.15, camY = h - 0.35, camZ = z1 + 0.25;
  D.b.add(M.dark(), box(0.06, 0.06, 0.25, camX, camY + 0.1, camZ - 0.1), box(0.16, 0.14, 0.32, camX, camY, camZ + 0.08, 0.5, -0.25));
  D.b.add(M.steelDark(), cyl(0.05, 0.05, 0.04, camX + 0.08, camY - 0.04, camZ + 0.24, 10, Math.PI / 2 - 0.25, 0.5));
  const camLed = D.glow('#ff2020', 4);
  camLed.add(D.b, box(0.025, 0.025, 0.02, camX - 0.03, camY + 0.04, camZ + 0.24, 0.5));
  const ch = D.blink(camLed.intensity, 1.6, 0.4, 4);
  D.halos.add(v(camX - 0.03, camY + 0.04, camZ + 0.27), '#ff2a2a', 0.22, ch, 3);

  // ---- window slits: steel frames + bars, warm light spilling out at night
  for (const wz of [-4, -9]) {
    D.b.add(M.steelDark(), box(0.1, 0.07, 1.75, x0 - 0.04, 3.08, wz), box(0.1, 0.07, 1.75, x0 - 0.04, 2.52, wz), box(0.1, 0.6, 0.07, x0 - 0.04, 2.8, wz - 0.84), box(0.1, 0.6, 0.07, x0 - 0.04, 2.8, wz + 0.84));
    for (let i = 0; i < 6; i++) D.b.add(M.steelDark(), cyl(0.012, 0.012, 0.56, x0 - 0.08, 2.8, wz - 0.65 + i * 0.26, 5));
    wallDecal(D, 'streaks', 1.7, 1.8, x0 - 0.012, 1.55, wz, -Math.PI / 2);
    lightPool(D, 'poolWarm', 3.2, 2.0, x0 - 1.4, 0.04, wz, Math.PI / 2);
  }

  // ---- grime: dirt splashed up the walls, rain streaks from the roof edge, graffiti tags
  const band = (len: number, x: number, z: number, ry: number) => {
    for (let s = -len / 2; s < len / 2 - 0.1; s += 2.6) {
      const w = Math.min(2.9, len / 2 - s + 0.3);
      const c = s + w / 2;
      wallDecal(D, 'grimeBand', w, 0.9 + rnd() * 0.3, x + Math.cos(ry) * c, 0.5, z - Math.sin(ry) * c, ry);
    }
  };
  band(x1 - x0, 0, z0 - 0.012, Math.PI); // back
  band(z1 - z0, x0 - 0.012, (z0 + z1) / 2, -Math.PI / 2); // west
  band(8.2, x1 + 0.012, -7.9, Math.PI / 2); // east, north of the side door
  band(2.2, x1 + 0.012, -1.1, Math.PI / 2); // east, south of it
  band(3, -6.5, z1 + 0.012, 0);
  band(3, 6.5, z1 + 0.012, 0);
  for (const [sx, sz, ry, w] of [[-6.5, z1 + 0.013, 0, 2.8], [6.5, z1 + 0.013, 0, 2.8], [x1 + 0.013, -7.5, Math.PI / 2, 3.5], [x0 - 0.013, -2.5, -Math.PI / 2, 3.2], [-3, z0 - 0.013, Math.PI, 4], [4, z0 - 0.013, Math.PI, 3]] as const) {
    wallDecal(D, 'streaks', w, 2.0, sx, h - 1.0, sz, ry);
  }
  wallDecal(D, 'tag1', 3.0, 1.12, x1 + 0.014, 1.45, -8.8, Math.PI / 2);
  wallDecal(D, 'tag3', 2.4, 1.0, x0 - 0.014, 1.35, -1.4, -Math.PI / 2);
  wallDecal(D, 'tag2', 2.0, 1.0, 1.5, 1.3, z0 - 0.014, Math.PI);
  // HQ plaque beside the roll-up door
  sign(D, 'plaque', 1.5, 0.375, 6.5, 2.15, z1 + 0.02);
  // soot above the side-door lamp
  wallDecal(D, 'soot', 0.9, 0.9, x1 + 0.013, 3.05, -3, Math.PI / 2);

  // ---- light: lamp over the side door gets a hood, a halo and a pool; neon spills on the door
  D.b.add(M.steelDark(), box(0.36, 0.04, 0.46, x1 + 0.22, 2.79, -3), box(0.06, 0.25, 0.06, x1 + 0.03, 2.85, -3));
  D.halos.add(v(x1 + 0.22, 2.58, -3), '#ffc890', 0.9, CH.NIGHT, 2.2);
  lightPool(D, 'poolWarm', 3.6, 3.0, x1 + 1.3, 0.05, -3.0, Math.PI / 2);
  // neon washing down the roll-up door from the sign above
  D.d.add(lightPoolMaterial(), decal('washCyan', 4.6, 3.0, -2.0, 1.85, z1 + 0.072), decal('washPink', 4.6, 3.0, 2.0, 1.85, z1 + 0.072));
  lightPool(D, 'poolCyan', 7, 5, -2.3, 0.1, z1 + 2.6);
  lightPool(D, 'poolPink', 7, 5, 2.3, 0.1, z1 + 2.6);
}

// ======================================================================= roof clutter (hidden group)
export function dressRoof(rb: MeshBatch, H: { x0: number; x1: number; z0: number; z1: number; h: number }) {
  const { h } = H;
  const steel = rustyMetal({ base: '#9a9a96', rust: 0.4 });
  const dark = plainStandard('#202326', 0.4, 0.6);
  // AC unit with fan grille
  rb.add(steel, box(1.3, 0.8, 0.9, 3.5, h + 0.75, -4.5));
  rb.add(dark, cyl(0.38, 0.38, 0.03, 3.5, h + 1.16, -4.5, 18));
  for (let i = 0; i < 5; i++) rb.add(steel, box(0.78, 0.02, 0.03, 3.5, h + 1.18, -4.8 + i * 0.15));
  rb.add(steel, cyl(0.06, 0.06, 1.2, 3.5, h + 0.55, -3.7, 6, Math.PI / 2));
  // vent stacks + roof hatch
  for (const [x, z, r, l] of [[-2, -3, 0.08, 0.9], [-2.5, -8, 0.12, 1.2], [5.5, -10, 0.07, 0.7]] as const) {
    rb.add(steel, cyl(r, r, l, x, h + 0.25 + l / 2, z, 8), cyl(r * 1.8, r * 1.8, 0.05, x, h + 0.25 + l + 0.1, z, 8), cyl(0.012, 0.012, 0.12, x, h + 0.25 + l + 0.04, z, 4));
  }
  rb.add(steel, box(1.0, 0.25, 1.0, -5.5, h + 0.4, -3.5), box(1.05, 0.06, 1.05, -5.5, h + 0.55, -3.5, 0, 0.08));
  // sandbags holding the roof sheets down (it's windy out here)
  const bag = fabric('#8a7a58');
  for (const [x, z] of [[-7.4, -0.6], [7.4, -0.6], [-7.4, -11.4], [7.4, -11.4], [0, -11.4]] as const) {
    const g = new THREE.CapsuleGeometry(0.15, 0.4, 3, 8);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 0.6, 1);
    g.translate(x, h + 0.42, z);
    rb.add(bag, norm(g));
  }
}

// ======================================================================= yard clutter
export function dressYard(D: Dress) {
  // ---- fuel corner by the generator: drums (one tipped and leaking), jerry cans, cable reel
  drum(D, M.drumBlue(), 14.3, -10.6, 0.3);
  drum(D, M.drumBlue(), 14.95, -10.0, 1.1);
  drum(D, M.drumRed(), 14.85, -11.25, 2.0);
  drum(D, M.drumRed(), 15.7, -9.2, 0.6, true);
  D.col(14.7, 0.45, -10.6, 0.75, 0.45, 0.85);
  ground(D, 'oil1', 2.6, 2.6, 16.6, 0.035, -9.0, 0.6);
  ground(D, 'oil2', 2.2, 2.2, 12.2, 0.035, -7.9, 2.2); // drips below the generator
  for (const [x, z, ry] of [[13.4, -10.1, 0.2], [13.25, -9.75, -0.35]] as const) {
    D.b.add(M.drumRed(), box(0.17, 0.42, 0.32, x, 0.21, z, ry));
    D.b.add(M.drumRed(), box(0.05, 0.05, 0.16, x, 0.45, z, ry));
    D.b.add(M.drumRed(), cyl(0.025, 0.025, 0.06, x, 0.45, z + 0.12, 6));
  }
  // cable reel (wooden spool) as a makeshift table, with a beer can
  const stake = M.stake();
  D.b.add(stake, cyl(0.55, 0.55, 0.06, 10.0, 0.03, -11.6, 16), cyl(0.55, 0.55, 0.06, 10.0, 0.72, -11.6, 16), cyl(0.18, 0.18, 0.66, 10.0, 0.375, -11.6, 10));
  D.b.add(M.cable(), cyl(0.36, 0.36, 0.55, 10.0, 0.375, -11.6, 14));
  can(D, 10.15, 0.75, -11.5);
  D.col(10.0, 0.4, -11.6, 0.55, 0.4, 0.55);
  // generator: exhaust soot + power cable sagging over to the house wall
  D.b.add(M.cable(), wire(v(11.2, 0.9, -9.0), v(8.05, 2.4, -8.0), 0.45, 0.025, 14));
  D.b.add(M.galv(), box(0.16, 0.24, 0.12, 8.08, 2.4, -8.0));

  // ---- pallets + tyre stacks along the east fence
  pallet(D, 18.5, 0, 12.0, 0.1);
  pallet(D, 18.5, 0.15, 12.0, 0.1);
  pallet(D, 18.5, 0.3, 12.0, 0.25);
  pallet(D, 19.6, 0, 9.6, 1.2);
  carton(D, 0.55, 0.4, 0.45, 18.3, 0.45, 11.8, 0.2);
  carton(D, 0.45, 0.35, 0.4, 18.8, 0.45, 12.3, -0.3);
  carton(D, 0.4, 0.3, 0.4, 18.5, 0.85, 12.0, 0.6);
  D.col(18.5, 0.6, 12.0, 0.75, 0.6, 0.75);
  for (let i = 0; i < 4; i++) tire(D, -19.6 + (i % 2) * 0.05, 0.15 + i * 0.3, 13.0);
  tire(D, -18.6, 0.36, 13.4, 0.25, 1.2);
  tire(D, -19.2, 0.15, 14.4, Math.PI / 2 + 0.1, 0.4);
  D.col(-19.4, 0.7, 13.4, 0.8, 0.7, 0.9);

  // ---- "Executive Restroom" porta-john in the NW corner
  const px = -19.8, pz = -1.0;
  const pc = M.plastic();
  D.b.add(pc, box(1.15, 2.2, 1.15, px, 1.1, pz), box(1.25, 0.08, 1.25, px, 2.26, pz));
  D.b.add(pc, box(1.0, 0.05, 1.0, px, 2.33, pz, 0, 0.12));
  D.b.add(M.galv(), cyl(0.05, 0.05, 0.5, px - 0.35, 2.45, pz - 0.35, 6));
  D.b.add(pc, box(0.03, 1.9, 0.75, px + 0.59, 1.0, pz));
  D.b.add(M.dark(), box(0.04, 0.1, 0.04, px + 0.62, 1.05, pz + 0.28));
  sign(D, 'signExec', 0.5, 0.25, px + 0.605, 1.75, pz, Math.PI / 2);
  D.col(px, 1.1, pz, 0.6, 1.15, 0.6);

  // ---- cinder blocks: chocks, steps and a few loose ones
  const bl = M.block();
  for (const [x, z, r, y] of [[10.0, 2.9, 0.1, 0.1], [10.3, 0.2, 0.4, 0.1], [-11.0, -7.5, 0.7, 0.1], [-11.0, -7.5, 0.2, 0.3], [-13.2, 7.9, 1.2, 0.1], [4.6, 13.5, 0.3, 0.1]] as const) {
    D.b.add(bl, box(0.4, 0.2, 0.2, x, y, z, r));
  }

  // ---- sawhorses with a plank, near the crates
  for (const sx of [10.6, 11.9]) {
    D.b.add(stake, beam(v(sx - 0.25, 0, 11.6), v(sx, 0.75, 11.6), 0.03, 4), beam(v(sx + 0.25, 0, 11.6), v(sx, 0.75, 11.6), 0.03, 4), beam(v(sx - 0.25, 0, 12.1), v(sx, 0.75, 12.1), 0.03, 4), beam(v(sx + 0.25, 0, 12.1), v(sx, 0.75, 12.1), 0.03, 4));
    D.b.add(stake, box(0.06, 0.06, 0.6, sx, 0.76, 11.85));
  }
  D.b.add(M.pallet(), box(2.0, 0.04, 0.3, 11.25, 0.81, 11.85, 0.05));
  D.col(11.25, 0.45, 11.85, 1.0, 0.45, 0.35);

  // ---- ground: tyre tracks from the gate to the tarp truck and the door, oil, cracks in the apron
  for (const [x, z, rot, len, y] of [[2.0, 15.5, 1.75, 6, 0.035], [5.5, 11.5, 1.0, 6, 0.035], [9.8, 5.6, 0.85, 5, 0.035], [-1.5, 12.5, 1.57, 6, 0.035], [-1.5, 5.0, 1.57, 7.5, 0.09]] as const) {
    ground(D, 'tracks', len, 1.5, x, y, z, rot);
  }
  ground(D, 'oil1', 2.4, 2.4, -1.8, 0.09, 3.2, 0.3);
  ground(D, 'oil2', 1.6, 1.6, 2.9, 0.09, 5.5, 1.0);
  ground(D, 'oil1', 1.8, 1.8, 12.5, 0.035, 3.6, 2.0); // under the truck's tail
  ground(D, 'cracks', 3.0, 3.0, 5.5, 0.09, 2.0, 0.7);
  ground(D, 'cracks', 2.5, 2.5, -6.0, 0.09, 6.5, 2.5);
  ground(D, 'dirt', 4.0, 4.0, -7.5, 0.09, 8.2, 0.3);
  ground(D, 'stripe', 9.0, 0.22, -4.5, 0.09, 8.7, 0); // faded parking line along the apron edge
  ground(D, 'stripe', 4.0, 0.22, 4.5, 0.09, 4.5, Math.PI / 2);

  // ---- drone dock: charging pylon, chevrons, cable to the house
  const pyX = -13.7, pyZ = 4.0;
  D.b.add(M.steelDark(), box(0.32, 1.3, 0.32, pyX, 0.65, pyZ), box(0.42, 0.06, 0.42, pyX, 1.32, pyZ));
  D.b.add(M.cable(), wire(v(pyX + 0.1, 0.9, pyZ), v(-12.6, 0.22, 4.0), 0.15, 0.025, 8));
  // power cable lying in the sand from the pylon to the house, then up the wall
  const cablePts = [v(pyX, 0.03, pyZ - 0.16), v(-12.6, 0.03, 2.1), v(-11.0, 0.03, 1.2), v(-9.6, 0.03, -0.2), v(-8.45, 0.03, -1.1)];
  for (let i = 0; i < cablePts.length - 1; i++) D.b.add(M.cable(), beam(cablePts[i], cablePts[i + 1], 0.025, 5));
  D.b.add(M.cable(), beam(v(-8.45, 0.03, -1.1), v(-8.12, 0.12, -1.1), 0.025, 5), beam(v(-8.12, 0.12, -1.1), v(-8.12, 1.1, -1.1), 0.025, 5));
  D.b.add(M.galv(), box(0.1, 0.18, 0.14, -8.1, 1.15, -1.1));
  ground(D, 'arrow', 2.0, 1.0, -12.0, 0.04, 6.4, Math.PI / 2);
  ground(D, 'hazard', 2.8, 0.35, -12.0, 0.215, 4.0 + 1.55, 0);
  lightPool(D, 'poolCyan', 4.2, 4.2, -12.0, 0.23, 4.0);
  D.col(pyX, 0.65, pyZ, 0.18, 0.65, 0.18);

  // ---- fence signs (front, west, east)
  sign(D, 'signNoTresp', 1.2, 0.8, 7.5, 1.55, 20.04, 0, 0.03);
  sign(D, 'signDrone', 1.2, 0.8, -22.04, 1.6, 4.0, -Math.PI / 2, -0.02);
  sign(D, 'signDrone', 1.2, 0.8, 13.0, 1.6, 20.04, 0, -0.04);
  sign(D, 'signNoTresp', 1.2, 0.8, 22.04, 1.5, 6.0, Math.PI / 2, 0.05);
}

// ======================================================================= interior: workshop
export function dressWorkshop(D: Dress, H: { x0: number; x1: number; z0: number; z1: number; h: number; vaultZ: number }, tube: GlowSlot) {
  const { x0, x1, z0, z1, h, vaultZ } = H;
  const steel = M.steel();
  const dark = M.steelDark();
  const block = M.block();

  // ---- ceiling slab + steel joists + fluorescent fixtures (seals the roof gap too)
  D.b.add(block, box(x1 - x0 - 0.4, 0.12, z1 - z0 - 0.4, 0, h - 0.06, (z0 + z1) / 2));
  for (let x = x0 + 1.5; x < x1 - 1; x += 2.6) D.b.add(dark, box(0.12, 0.22, z1 - z0 - 0.6, x, h - 0.23, (z0 + z1) / 2));
  for (const [fx, fz] of [[-4, -3.2], [0, -3.2], [4, -3.2], [-3, -9.3], [3, -9.3]] as const) {
    D.b.add(steel, box(1.3, 0.07, 0.24, fx, h - 0.62, fz));
    tube.add(D.b, box(1.2, 0.035, 0.07, fx, h - 0.67, fz - 0.06), box(1.2, 0.035, 0.07, fx, h - 0.67, fz + 0.06));
    for (const s of [-0.5, 0.5]) D.b.add(M.cable(), cyl(0.006, 0.006, 0.36, fx + s, h - 0.42, fz, 3));
    D.halos.add(v(fx - 0.35, h - 0.72, fz), '#ffe2b8', 0.9, CH.TUBES, 0.9);
    D.halos.add(v(fx + 0.35, h - 0.72, fz), '#ffe2b8', 0.9, CH.TUBES, 0.9);
  }
  // conduit runs + drops
  D.b.add(M.galv(), box(0.05, 0.05, z1 - z0 - 0.8, x1 - 0.33, h - 0.5, (z0 + z1) / 2));
  D.b.add(M.galv(), box(x1 - x0 - 0.8, 0.05, 0.05, 0, h - 0.5, z1 - 0.38));
  D.b.add(M.galv(), cyl(0.02, 0.02, h - 0.5 - 1.3, x0 + 0.34, 1.3 + (h - 1.8) / 2, -1.6, 5));
  D.b.add(M.galv(), cyl(0.02, 0.02, h - 0.5 - 0.4, x0 + 0.34, 0.4 + (h - 0.9) / 2, -1.75, 5));
  D.b.add(M.galv(), cyl(0.02, 0.02, h - 0.5 - 1.3, x0 + 0.34, 1.3 + (h - 1.8) / 2, -4.75, 5));
  // extension cord hanging in a loop from a hook
  D.b.add(M.drumRed(), wire(v(x1 - 0.35, 2.6, -5.2), v(x1 - 0.35, 2.6, -5.9), 0.9, 0.012, 12));

  // ---- workbench clutter (bench top at y 0.99, along the west wall z -5..-1)
  const by = 0.99, bx = x0 + 0.8;
  // pegboard face with painted tool outlines + a few real tools on it
  D.d.add(decalMaterial(), decal('pegboard', 3.5, 1.15, x0 + 0.36, 1.9, -3, 0, Math.PI / 2, 0));
  for (const [z, l, kind] of [[-4.4, 0.32, 0], [-4.0, 0.26, 0], [-3.1, 0.3, 1], [-2.2, 0.22, 2], [-1.8, 0.28, 2]] as const) {
    if (kind === 0) D.b.add(steel, box(0.015, l, 0.035, x0 + 0.375, 1.9, z), cyl(0.04, 0.04, 0.015, x0 + 0.375, 1.9 + l / 2, z, 8, 0, 0, Math.PI / 2));
    if (kind === 1) D.b.add(M.stake(), box(0.03, l, 0.035, x0 + 0.38, 1.85, z)), D.b.add(dark, box(0.04, 0.05, 0.16, x0 + 0.385, 1.85 + l / 2, z));
    if (kind === 2) D.b.add(M.drumRed(), cyl(0.018, 0.018, 0.1, x0 + 0.385, 1.95, z, 6)), D.b.add(steel, cyl(0.005, 0.005, l - 0.1, x0 + 0.385, 1.95 - l / 2, z, 4));
  }
  // vise, toolbox, drill, mug, jar shelf, clamp lamp
  D.b.add(M.drumBlue(), box(0.18, 0.12, 0.22, bx + 0.25, by + 0.06, -1.45), box(0.08, 0.1, 0.24, bx + 0.25, by + 0.17, -1.45));
  D.b.add(steel, cyl(0.012, 0.012, 0.3, bx + 0.42, by + 0.12, -1.45, 5, 0, 0, Math.PI / 2));
  D.b.add(M.drumRed(), box(0.55, 0.22, 0.26, bx - 0.05, by + 0.11, -4.35), box(0.5, 0.04, 0.24, bx - 0.05, by + 0.24, -4.35));
  D.b.add(dark, box(0.3, 0.025, 0.025, bx - 0.05, by + 0.29, -4.35));
  D.b.add(M.drumBlue(), box(0.07, 0.16, 0.06, bx + 0.1, by + 0.08, -3.4), box(0.22, 0.08, 0.07, bx + 0.05, by + 0.2, -3.4));
  D.b.add(dark, cyl(0.03, 0.03, 0.08, bx - 0.09, by + 0.2, -3.4, 8, 0, 0, Math.PI / 2));
  D.b.add(M.water(), cyl(0.045, 0.04, 0.1, bx + 0.25, by + 0.05, -2.6, 10));
  D.b.add(M.stake(), box(0.2, 0.025, 2.6, x0 + 0.45, 2.62, -3.0));
  for (let i = 0; i < 8; i++) D.b.add(M.water(), cyl(0.05, 0.05, 0.13, x0 + 0.45, 2.7, -4.1 + i * 0.3, 8));
  D.b.add(dark, beam(v(bx - 0.3, by, -2.0), v(bx - 0.1, by + 0.55, -2.0), 0.012, 4), beam(v(bx - 0.1, by + 0.55, -2.0), v(bx + 0.15, by + 0.4, -2.0), 0.012, 4));
  D.b.add(steel, cyl(0.04, 0.09, 0.12, bx + 0.15, by + 0.36, -2.0, 10, 0, 0, -0.9));
  D.halos.add(v(bx + 0.2, by + 0.3, -2.0), '#ffd6a0', 0.5, CH.NIGHT, 1.0);
  // under-bench: car battery, paint cans, cardboard
  D.b.add(dark, box(0.3, 0.2, 0.18, bx - 0.15, 0.11, -4.4));
  can(D, bx + 0.2, 0.01, -3.7, 0.08, 0.18);
  can(D, bx + 0.05, 0.01, -3.5, 0.08, 0.18);
  carton(D, 0.5, 0.35, 0.6, bx, 0.01, -2.4, 0.1);

  // ---- rolling tool chest by the roll-up door
  const tx = -5.4, tz = -0.75;
  D.b.add(M.drumRed(), box(1.0, 0.95, 0.5, tx, 0.55, tz));
  for (let i = 0; i < 5; i++) {
    D.b.add(dark, box(0.96, 0.01, 0.01, tx, 0.2 + i * 0.17, tz + 0.255));
    D.b.add(steel, box(0.35, 0.02, 0.03, tx, 0.27 + i * 0.17, tz + 0.27));
  }
  for (const [cx, cz] of [[-0.42, -0.18], [0.42, -0.18], [-0.42, 0.18], [0.42, 0.18]]) D.b.add(M.rubber(), cyl(0.05, 0.05, 0.04, tx + cx, 0.05, tz + cz, 8, Math.PI / 2));
  D.col(tx, 0.55, tz, 0.5, 0.55, 0.25);

  // ---- steel shelving with supplies against the vault wall (west) and on the east wall
  const shelfZ = vaultZ + 0.2 + 0.28;
  const s1 = shelving(D, -5.9, shelfZ, 3.0, 0.5, 2.05, 0, 4);
  supplies(D, s1, 3.0, 0.5);
  D.col(-5.9, 1.0, shelfZ, 1.5, 1.05, 0.26);
  const s2 = shelving(D, x1 - 0.45, -5.6, 1.3, 0.5, 2.05, -Math.PI / 2, 4);
  supplies(D, s2, 1.3, 0.5);
  D.col(x1 - 0.45, 1.0, -5.6, 0.26, 1.05, 0.65);

  // ---- standing desk with monitors (the "office"), front-east corner
  const dx = 6.4, dz = -0.72;
  D.b.add(M.stake(), box(1.6, 0.04, 0.65, dx, 1.05, dz));
  D.b.add(dark, box(0.06, 1.03, 0.5, dx - 0.7, 0.52, dz), box(0.06, 1.03, 0.5, dx + 0.7, 0.52, dz));
  const screen = D.glow('#7fd8ff', 1.4);
  for (const [mx, ry] of [[-0.38, 0.25], [0.38, -0.25]] as const) {
    D.b.add(dark, box(0.56, 0.34, 0.03, dx + mx, 1.37, dz + 0.05, ry + Math.PI));
    screen.add(D.b, box(0.52, 0.3, 0.005, dx + mx - Math.sin(ry) * 0.018, 1.37, dz + 0.05 - Math.cos(ry) * 0.018, ry + Math.PI));
    D.b.add(dark, box(0.04, 0.2, 0.04, dx + mx, 1.15, dz + 0.1));
  }
  D.b.add(M.water(), cyl(0.045, 0.04, 0.1, dx + 0.62, 1.12, dz - 0.15, 10));
  D.b.add(dark, box(0.45, 0.02, 0.15, dx, 1.08, dz - 0.15));
  D.halos.add(v(dx, 1.37, dz - 0.15), '#7fd8ff', 1.4, CH.ON, 0.35);
  D.col(dx, 0.55, dz, 0.8, 0.55, 0.33);
  // energy-drink fridge humming under the HUSTLE sign
  D.b.add(M.galv(), box(0.6, 0.85, 0.6, x1 - 0.45, 0.43, -1.0));
  D.b.add(M.dark(), box(0.02, 0.5, 0.03, x1 - 0.76, 0.5, -0.78));
  D.col(x1 - 0.45, 0.43, -1.0, 0.3, 0.43, 0.3);

  // ---- floor: oil, cracks, painted bay lines, hazard stripes at the vault, a drain
  ground(D, 'oil1', 2.4, 2.4, -1.2, 0.105, -2.6, 0.5);
  ground(D, 'oil2', 1.4, 1.4, 1.4, 0.105, -1.2, 1.6);
  ground(D, 'oil2', 1.2, 1.2, x0 + 1.2, 0.105, -3.6, 0.2);
  ground(D, 'cracks', 2.6, 2.6, 4.5, 0.105, -5.2, 0.3);
  ground(D, 'drain', 0.5, 0.5, -0.5, 0.106, -3.4, 0);
  ground(D, 'stripe', 5.6, 0.14, -2.6, 0.105, -0.85, 0);
  ground(D, 'stripe', 5.6, 0.14, -2.6, 0.105, -5.9, 0);
  ground(D, 'hazard', 2.6, 0.32, 0, 0.106, vaultZ + 0.38, 0);
  ground(D, 'dirt', 2.4, 2.4, x1 - 1.2, 0.105, -3.0, 0.2); // tracked in at the side door

  // ---- walls: posters, grime, vault-door framing
  wallDecal(D, 'posterMove', 0.8, 1.12, x1 - 0.155, 1.75, -4.4, -Math.PI / 2);
  wallDecal(D, 'posterSeed', 0.8, 1.12, 3.6, 1.8, z1 - 0.315, Math.PI);
  wallDecal(D, 'posterFail', 0.8, 1.12, -3.3, 1.85, vaultZ + 0.215, 0);
  const iband = (len: number, x: number, z: number, ry: number) => {
    for (let s = -len / 2; s < len / 2 - 0.1; s += 2.6) {
      const w = Math.min(2.9, len / 2 - s + 0.3), c = s + w / 2;
      wallDecal(D, 'grimeBand', w, 0.7, x + Math.cos(ry) * c, 0.42, z - Math.sin(ry) * c, ry);
    }
  };
  iband(x1 - x0 - 0.6, 0, vaultZ + 0.212, 0);
  iband(-vaultZ - 0.6, x0 + 0.312, vaultZ / 2, Math.PI / 2);
  // vault frame: steel jambs, hazard stripes and the stencil above
  D.b.add(dark, box(0.18, 2.6, 0.12, -1.09, 1.3, vaultZ + 0.25), box(0.18, 2.6, 0.12, 1.09, 1.3, vaultZ + 0.25), box(2.36, 0.18, 0.12, 0, 2.5, vaultZ + 0.25));
  for (const sx of [-1, 1]) D.d.add(decalMaterial(), decal('hazard', 2.5, 0.22, sx * 1.3, 1.27, vaultZ + 0.213, 0, 0, Math.PI / 2));
  wallDecal(D, 'runway', 2.6, 0.65, 0, 3.0, vaultZ + 0.212, 0);
  wallDecal(D, 'restricted', 1.7, 0.32, -2.3, 2.55, vaultZ + 0.212, 0);
}

/** Fill a shelving unit with cartons, cans, jugs and buckets. */
function supplies(D: Dress, s: { ys: number[]; at: (lx: number, lz: number) => [number, number] }, w: number, d: number) {
  const water = M.water();
  s.ys.forEach((y, li) => {
    let lx = -w / 2 + 0.08;
    while (lx < w / 2 - 0.2) {
      const kind = Math.floor(rnd() * 4);
      if (li === 0 && kind < 2) { // buckets + jugs on the bottom shelf
        const [px, pz] = s.at(lx + 0.16, 0);
        D.b.add(water, cyl(0.13, 0.13, 0.32, px, y + 0.17, pz, 10), cyl(0.04, 0.04, 0.06, px, y + 0.36, pz, 6));
        lx += 0.32;
      } else if (kind === 0) {
        const cw = 0.25 + rnd() * 0.2;
        const [px, pz] = s.at(lx + cw / 2, (rnd() - 0.5) * 0.05);
        carton(D, cw, 0.22 + rnd() * 0.15, d * 0.8, px, y + 0.013, pz, (rnd() - 0.5) * 0.15);
        lx += cw + 0.03;
      } else if (kind === 1) {
        for (let k = 0; k < 3; k++) { const [px, pz] = s.at(lx + 0.05 + k * 0.09, -0.1 + rnd() * 0.15); can(D, px, y + 0.013, pz); }
        lx += 0.3;
      } else if (kind === 2) {
        const cw = 0.4;
        const [px, pz] = s.at(lx + cw / 2, 0);
        carton(D, cw, 0.3, d * 0.85, px, y + 0.013, pz, 0);
        lx += cw + 0.04;
      } else {
        const [px, pz] = s.at(lx + 0.14, 0);
        D.b.add(M.drumRed(), cyl(0.12, 0.1, 0.24, px, y + 0.135, pz, 10));
        lx += 0.3;
      }
    }
  });
}

// ======================================================================= the vault ("Runway Room")
export function dressVault(D: Dress, H: { x0: number; x1: number; z0: number; z1: number; h: number; vaultZ: number }) {
  const { x0, x1, z0, h, vaultZ } = H;
  const plate = rustyMetal({ base: '#7f8588', rust: -0.35, metalness: 0.85, roughness: 0.38, scale: 2.5 }); // = vault door steel
  const dark = M.steelDark();
  // riveted steel cladding on the vault walls (panels with seams)
  const panelW = 1.18;
  const clad = (len: number, cx: number, cz: number, ry: number, skip?: (c: number) => boolean) => {
    const n = Math.floor(len / (panelW + 0.03));
    const start = -((n * (panelW + 0.03)) - 0.03) / 2;
    for (let i = 0; i < n; i++) {
      const c = start + i * (panelW + 0.03) + panelW / 2;
      if (skip?.(c)) continue;
      const px = cx + Math.cos(ry) * c, pz = cz - Math.sin(ry) * c;
      D.b.add(plate, box(panelW, h - 0.25, 0.03, px, (h - 0.25) / 2 + 0.05, pz, ry));
      for (const ry2 of [0.25, h - 0.45]) for (const off of [-panelW / 2 + 0.07, panelW / 2 - 0.07]) {
        const qx = px + Math.cos(ry) * off + Math.sin(ry) * 0.02, qz = pz - Math.sin(ry) * off + Math.cos(ry) * 0.02;
        D.b.add(dark, cyl(0.018, 0.018, 0.02, qx, ry2, qz, 6, Math.PI / 2, ry));
      }
    }
  };
  clad(x1 - x0 - 0.7, 0, z0 + 0.32, 0); // back wall
  clad(vaultZ - z0 - 0.5, x0 + 0.32, (z0 + vaultZ + 0.1) / 2, Math.PI / 2);
  clad(vaultZ - z0 - 0.5, x1 - 0.32, (z0 + vaultZ + 0.1) / 2, -Math.PI / 2);

  // the runway itself: shelving of cash bricks, gold, soylent cases and glowing "NFT drives"
  const s = shelving(D, x0 + 0.62, -8.6, 1.6, 0.55, 1.9, Math.PI / 2, 4);
  const cash = plainStandard('#7f9a6a', 0.8);
  const gold = M.brass();
  s.ys.forEach((y, i) => {
    for (let k = 0; k < 4; k++) {
      const [px, pz] = s.at(-0.6 + k * 0.4, 0);
      if (i === 3) { D.b.add(gold, box(0.22, 0.06, 0.1, px, y + 0.045, pz - 0.08), box(0.22, 0.06, 0.1, px, y + 0.045, pz + 0.06), box(0.22, 0.06, 0.1, px, y + 0.105, pz - 0.01)); continue; }
      if (i === 0) { carton(D, 0.34, 0.3, 0.45, px, y + 0.013, pz, 0); continue; }
      for (let r = 0; r < 2 + (k % 2); r++) {
        D.b.add(cash, box(0.16, 0.06, 0.08, px - 0.05, y + 0.045 + r * 0.06, pz - 0.06, 0.05 * r), box(0.16, 0.06, 0.08, px + 0.06, y + 0.045 + r * 0.06, pz + 0.05, -0.04 * r));
        D.d.add(decalMaterial(), decal('cash', 0.16, 0.08, px - 0.05, y + 0.077 + r * 0.06, pz - 0.06, -Math.PI / 2, 0, 0.05 * r));
      }
    }
  });
  D.col(x0 + 0.62, 0.95, -8.6, 0.3, 0.95, 0.8);
  // NFT drives: a little rack of glowing USB sticks on top of the server rack
  const nft = D.glow('#3ff2e0', 3);
  for (let i = 0; i < 6; i++) nft.add(D.b, box(0.03, 0.08, 0.015, x1 - 0.85, 2.05, -8.5 + i * 0.1));
  D.b.add(dark, box(0.12, 0.03, 0.7, x1 - 0.85, 2.01, -8.25));
  D.halos.add(v(x1 - 0.85, 2.1, -8.25), '#3ff2e0', 0.7, CH.ON, 1.2);
  // cash spilling off a pallet, gold bars on the floor by the safe
  pallet(D, 3.0, 0, -10.45, 0.1);
  for (let k = 0; k < 9; k++) {
    const px = 2.65 + (k % 3) * 0.3, pz = -10.7 + Math.floor(k / 3) * 0.25;
    D.b.add(cash, box(0.26, 0.12, 0.16, px, 0.2 + (k % 2) * 0.12, pz, (rnd() - 0.5) * 0.4));
  }
  D.b.add(gold, box(0.22, 0.06, 0.1, 4.0, 0.03, -9.8, 0.3), box(0.22, 0.06, 0.1, 4.1, 0.03, -9.65, 0.1));
  D.col(3.0, 0.3, -10.45, 0.6, 0.3, 0.6);
  // floor: diamond-plate-ish strip + hazard border and "the founder's" rug stain
  ground(D, 'hazard', 3.4, 0.3, 0, 0.106, vaultZ - 0.45, 0);
  ground(D, 'oil2', 1.4, 1.4, -2.4, 0.106, -8.8, 0.4);
  ground(D, 'cracks', 2.2, 2.2, 3.5, 0.106, -8.0, 1.2);
  // red alarm beacon on the vault ceiling + its halo
  D.b.add(dark, cyl(0.12, 0.14, 0.08, 0, h - 0.17, -8.2, 12));
  D.halos.add(v(0, h - 0.32, -8.2), '#ff2a1a', 1.6, CH.ALARM, 2.5);
}
