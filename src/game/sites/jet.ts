import * as THREE from 'three/webgpu';
import type { GameContext, Action } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';
import { box, cyl, beam, wire, norm, MeshBatch } from '../world/kit';
import { rustyMetal, plainStandard, fabric, leather, wood, corrugated, type GlowSlot } from '../world/materials';
import { VirtualLight } from '../world/lights';
import { Sparks } from '../world/effects';
import { surfaces } from '@/engine/surface';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import {
  SiteKit, hull, ringStrip, mat4, xf, v3, rng, decal, floorDecal, decalMat, glowDecalMat, atlasSolid, atlasMap,
  beamMaterial, uSiteNight, uSiteFlicker, glassMat, type Col,
} from './jetKit';
import './jetArt';

/**
 * The Exit Strategy: Hunter Vale's jet (Ascend, "evacuation as a service"). He left early, by
 * parachute, and let the autopilot fly on. It came down in the dunes north-west of everything and
 * broke in three: the nose dug into a sand berm, the cabin, and the tail with the baggage hold.
 * The right wing stands tip-down in the sand like a monument. Nobody was aboard.
 *
 * Local frame: the jet travelled toward local −z; the gouge runs from z ≈ +62 to the nose at −22.
 * Each fuselage section is authored in its own frame (axis along z, floor at FY) and placed by a
 * matrix, so its colliders (oriented Rapier boxes) match the tilt you see.
 */

const R = 1.8; // skin radius
const RI = 1.68; // lining radius
const FY = -0.7; // cabin floor, relative to the section axis
const CEIL = 1.45; // headliner

/** Geometry/collider helper for one fuselage section (section-local → site-local). */
class Sec {
  constructor(readonly kit: SiteKit, readonly m: THREE.Matrix4) {}
  add(mat: THREE.Material, ...g: THREE.BufferGeometry[]) { for (const x of g) this.kit.b.add(mat, xf(x, this.m)); }
  thin(mat: THREE.Material, ...g: THREE.BufferGeometry[]) { for (const x of g) this.kit.nb.add(mat, xf(x, this.m)); }
  glow(slot: GlowSlot, ...g: THREE.BufferGeometry[]) { slot.add(this.kit.b, ...g.map((x) => xf(x, this.m))); }
  local(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { return this.m.clone().multiply(mat4(x, y, z, rx, ry, rz)); }
  dec(name: string, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.kit.d.add(decalMat(), decal(name, w, h, this.local(x, y, z, rx, ry, rz)));
  }
  gdec(name: string, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.kit.gd.add(glowDecalMat(), decal(name, w, h, this.local(x, y, z, rx, ry, rz)));
  }
  col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rx = 0, ry = 0, rz = 0) {
    return this.kit.ocol(this.local(x, y, z, rx, ry, rz), hx, hy, hz);
  }
  /** section-local point → site-local */
  p(x: number, y: number, z: number) { return v3(x, y, z).applyMatrix4(this.m); }
  /** section-local direction → site-local */
  dir(x: number, y: number, z: number) { return v3(x, y, z).transformDirection(this.m); }
}

const M = () => ({
  paint: rustyMetal({ base: '#dcd7cb', rust: -0.25, metalness: 0.18, roughness: 0.56, rim: 0.12 }),
  belly: rustyMetal({ base: '#9a9286', rust: 0.05, metalness: 0.4, roughness: 0.55 }),
  gold: rustyMetal({ base: '#c9a24a', rust: 0.06, metalness: 0.95, roughness: 0.25 }),
  chrome: rustyMetal({ base: '#c4c8cc', rust: 0.05, metalness: 1, roughness: 0.18 }),
  frame: rustyMetal({ base: '#8f9496', rust: 0.25, metalness: 0.8, roughness: 0.4 }),
  burnt: rustyMetal({ base: '#3a3430', rust: 0.45, metalness: 0.6, roughness: 0.6 }),
  orange: rustyMetal({ base: '#e0661c', rust: 0.12, metalness: 0.3, roughness: 0.5 }),
  dark: plainStandard('#1c1f22', 0.45, 0.4),
  panel: plainStandard('#2b2f33', 0.6, 0.25),
  grey: plainStandard('#6a6c6a', 0.6, 0.15),
  screen: plainStandard('#06080a', 0.1, 0.2),
  rubber: plainStandard('#151311', 0.95),
  cable: plainStandard('#161616', 0.6, 0.4),
  wireR: plainStandard('#9a2a22', 0.5),
  wireB: plainStandard('#2a4c8a', 0.5),
  wireY: plainStandard('#c8a028', 0.5),
  bottle: plainStandard('#0f2a18', 0.12, 0.1),
  stone: plainStandard('#d8d2c6', 0.3, 0.05),
  white: plainStandard('#ece8e0', 0.35, 0.05),
  mirror: plainStandard('#c8d0d4', 0.05, 1),
  lining: leather('#cdbf9f'),
  seat: leather('#dccaa4'),
  seatDark: leather('#7a5a3c'),
  duffel: leather('#5e3a22'),
  headliner: fabric('#f0e9da', 0.9),
  carpet: fabric('#3b4048', 0.98),
  insul: fabric('#c4a35a', 0.95),
  yellow: fabric('#e8b41a', 0.7),
  shirt: fabric('#e6e2da', 0.95),
  black: fabric('#1d2024', 0.95),
  red: fabric('#8a2a24', 0.9),
  fleece: fabric('#efe8da', 1),
  walnut: wood('#4a2a18'),
  crate: wood('#9a7448'),
  silverCase: corrugated('#b8bcc0', 0.08, 'x'),
});
type Mats = ReturnType<typeof M>;

type HoldState = { pivot: THREE.Object3D; collider: Col; open: number; target: number };

export class JetSite extends Site {
  private kit: SiteKit;
  private mats!: Mats;
  private near!: THREE.Object3D;
  private nose!: Sec;
  private cabin!: Sec;
  private tail!: Sec;
  private hold!: HoldState;
  private goBag!: THREE.Object3D;
  private strobe!: GlowSlot;
  private strobeCh = 1;
  private screenFlicker!: GlowSlot;
  private aisle!: GlowSlot;
  private cove!: GlowSlot;
  private phoneLed!: GlowSlot;
  private cabinLight!: VirtualLight;
  private cockpitLight!: VirtualLight;
  private holdLight!: VirtualLight;
  private holdLamp!: GlowSlot;
  private sparks = new Sparks();
  private sparkAt: THREE.Vector3[] = [];
  private sparkT = 2;
  private shafts!: THREE.InstancedMesh;
  private shaftDefs: { c: THREE.Vector3; n: THREE.Vector3; w: number; h: number; along: THREE.Vector3; floorY: number }[] = [];
  private shaftMat = beamMaterial('#ffd9a0', 0.4);
  private lastState: unknown = null;
  private t = 0;
  private readonly _m = new THREE.Matrix4();
  private readonly _v = new THREE.Vector3();

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('jet', ctx, landmarks);
    this.kit = new SiteKit(this.frame, ctx.physics, ctx.hf);
    this.mats = M();
    const root = new THREE.Group();
    root.name = 'jet-root';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);

    this.buildLights();
    this.buildSections();
    this.buildWings();
    this.buildEngines();
    this.buildTrench();
    this.buildDebris();
    this.buildCanopy();

    const far = new Map<THREE.Material, THREE.ColorRepresentation>();
    const { near, far: farGroup } = this.kit.build(root, ctx.scene, 'jet', far);
    this.near = near;
    this.buildMoving(near);
    this.buildShafts(near);
    // the strobe still reads from the highway at night
    const farHalo = new (this.kit.halos.constructor as typeof import('../world/effects').GlowSprites)(4);
    farHalo.add(this.tail.p(0.0, 6.3, 9.6), '#ff2a1a', 2.2, 1, 3);
    farGroup.add(farHalo.build());
    this.farHalo = farHalo;
    this.lod(near, farGroup, 34);

    ctx.scene.add(this.sparks.sprite);
    this.buildInteractables();

    // ambience: wind moaning through the tube, the ELT's radio hiss, wires that still spark
    this.landmarks.audioSpots.push({ kind: 'wind-hollow', pos: this.frame.p(...this.cabin.p(0, 0.3, 0).toArray() as [number, number, number]) });
    this.landmarks.audioSpots.push({ kind: 'radio', pos: this.world(this.nose.p(0.4, 0.2, -3.0)) });
    this.landmarks.audioSpots.push({ kind: 'sparks', pos: this.world(this.cabin.p(0, 1.2, -4.9)) });
  }

  private farHalo!: import('../world/effects').GlowSprites;

  /** site-local → world */
  private world(p: THREE.Vector3) { return this.frame.p(p.x, p.y, p.z); }

  // ================================================================ fuselage
  private buildSections() {
    this.nose = new Sec(this.kit, mat4(-2.2, 1.12, -14.6, -0.08, -0.32, 0.1));
    this.cabin = new Sec(this.kit, mat4(0.4, 1.2, -3.6, 0.0, 0.08, -0.06));
    this.tail = new Sec(this.kit, mat4(-3.2, 1.16, 9.8, 0.03, 0.55, -0.24));
    this.buildNose(this.nose);
    this.buildCabin(this.cabin);
    this.buildTail(this.tail);
  }

  /**
   * Skin + lining + torn-edge strips + floor + headliner for one section. `cell(a, z)` decides holes
   * (-1), glass (1) per quad; windows are holes with a glass oval and a reveal.
   */
  private shell(sec: Sec, o: {
    z0: number; z1: number; jag0: number; jag1: number; seed: number;
    taper?: (z: number) => number; droop?: (z: number) => number;
    hole: (a: number, z: number) => boolean;
    glass?: (a: number, z: number) => boolean;
    windows: (z: number, j: number) => boolean;
    liningFrom?: number; liningTo?: number;
    floor: [number, number];
  }) {
    const k = this.mats;
    const segA = 28;
    const da = (Math.PI * 2) / segA;
    const aMin = -Math.PI + da / 2, aMax = Math.PI + da / 2;
    const winA = (a: number) => Math.abs(Math.abs(a) - Math.PI / 2) < da * 0.6;
    const wins: [number, number][] = [];
    const seen = new Set<string>();
    const skinCell = (a: number, z: number, _i: number, j: number) => {
      if (o.hole(a, z)) return -1;
      if (winA(a) && o.windows(z, j)) {
        const key = `${a.toFixed(2)}:${z.toFixed(2)}`;
        if (!seen.has(key)) { seen.add(key); wins.push([a, z]); }
        return -1;
      }
      if (o.glass?.(a, z)) return 1;
      return Math.abs(a) > 2.3 ? 2 : 0;
    };
    const base = { r: R, z0: o.z0, z1: o.z1, segA, aMin, aMax, dz: 0.55, taper: o.taper, droop: o.droop, jag0: o.jag0, jag1: o.jag1, seed: o.seed };
    const skin = hull({ ...base, cell: skinCell });
    if (skin.geos[0]) sec.add(k.paint, skin.geos[0]);
    if (skin.geos[2]) sec.add(k.belly, skin.geos[2]);
    if (skin.geos[1]) sec.thin(glassMat(), skin.geos[1]);
    const lf = o.liningFrom ?? -Infinity, lt = o.liningTo ?? Infinity;
    const lining = hull({
      ...base, r: RI, inward: true,
      cell: (a, z, _i, j) => (z < lf || z > lt || o.hole(a, z) || (winA(a) && o.windows(z, j)) || o.glass?.(a, z) ? -1 : 0),
    });
    if (lining.geos[0]) sec.add(k.lining, lining.geos[0]);
    // torn edges: close the gap between skin and lining at a jagged end
    if (o.jag0) sec.add(k.frame, ringStrip(skin.ring0, lining.ring0, true));
    if (o.jag1) sec.add(k.frame, ringStrip(skin.ring1, lining.ring1));
    // windows: oval glass, bright frame outside, cream bezel inside, reveal between
    for (const [a, z] of wins) {
      const s = Math.sign(Math.sin(a));
      const rr = R * (o.taper ? o.taper(z) : 1), ri = RI * (o.taper ? o.taper(z) : 1);
      const yc = Math.cos(a) * rr + (o.droop ? o.droop(z) : 0);
      const ry = s * Math.PI / 2;
      const oval = (r: number, sx: number, sy: number) => { const g = new THREE.CircleGeometry(r, 18); g.scale(sx, sy, 1); return g; };
      sec.thin(glassMat(), xf(oval(0.25, 1.15, 0.9), mat4(s * (rr - 0.01), yc, z, 0, ry, 0)));
      sec.add(k.dark, xf(new THREE.RingGeometry(0.235, 0.262, 18).scale(1.15, 0.9, 1), mat4(s * (rr + 0.004), yc, z, 0, ry, 0)));
      sec.add(k.lining, xf(new THREE.RingGeometry(0.235, 0.26, 18).scale(1.15, 0.9, 1), mat4(s * (ri - 0.004), yc, z, 0, -ry, 0)));
      // reveal: short tube from lining to skin
      const tube = new THREE.CylinderGeometry(0.24, 0.24, rr - ri + 0.02, 14, 1, true);
      tube.rotateZ(Math.PI / 2);
      tube.scale(1, 0.9, 1.15);
      sec.add(k.lining, xf(tube, mat4(s * (rr + ri) / 2, yc, z)));
    }
    // floor: carpet over a structural slab, beams poking out at torn ends
    const [f0, f1] = o.floor;
    const fw = 2 * Math.sqrt(RI * RI - FY * FY);
    sec.add(k.carpet, box(fw - 0.04, 0.05, f1 - f0, 0, FY - 0.025, (f0 + f1) / 2));
    sec.add(k.frame, box(fw - 0.1, 0.12, f1 - f0 + 0.1, 0, FY - 0.11, (f0 + f1) / 2));
    // carpet over the deck: a softer step than the bare metal outside
    surfaces.tag(sec.col(0, FY - 0.15, (f0 + f1) / 2, fw / 2, 0.15, (f1 - f0) / 2), 'wood');
    for (const [zEnd, jag] of [[f0, o.jag0], [f1, o.jag1]] as const) {
      if (!jag) continue;
      const dir = zEnd === f0 ? -1 : 1;
      for (const x of [-0.9, -0.3, 0.35, 0.95]) sec.add(k.frame, box(0.07, 0.14, 0.5, x, FY - 0.16, zEnd + dir * 0.18, 0, 0.1 * dir));
    }
    return { wins, skin, lining };
  }

  /** Side walls and ceiling colliders for a section (skipping the given z gaps on each side). */
  private walls(sec: Sec, z0: number, z1: number, gapL: [number, number][] = [], gapR: [number, number][] = []) {
    const segs = (gaps: [number, number][]) => {
      const out: [number, number][] = [];
      let a = z0;
      for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > a) out.push([a, g0]); a = Math.max(a, g1); }
      if (z1 > a) out.push([a, z1]);
      return out;
    };
    for (const [side, gaps] of [[-1, gapL], [1, gapR]] as const) {
      for (const [a, b] of segs(gaps)) sec.col(side * 1.62, FY + 1.1, (a + b) / 2, 0.17, 1.1, (b - a) / 2);
    }
    sec.col(0, CEIL + 0.17, (z0 + z1) / 2, 1.3, 0.12, (z1 - z0) / 2);
  }

  /** Headliner with indirect-light coves and a few dangling oxygen masks. */
  private ceiling(sec: Sec, z0: number, z1: number, masks: number[]) {
    const k = this.mats;
    sec.add(k.headliner, box(1.7, 0.05, z1 - z0, 0, CEIL, (z0 + z1) / 2));
    for (const s of [-1, 1]) {
      sec.add(k.headliner, box(0.06, 0.18, z1 - z0, s * 0.86, CEIL - 0.07, (z0 + z1) / 2));
      sec.glow(this.cove, box(0.02, 0.02, z1 - z0 - 0.2, s * 0.9, CEIL + 0.02, (z0 + z1) / 2));
      // passenger service unit strip over the seats
      sec.add(k.white, box(0.2, 0.03, z1 - z0, s * 1.0, CEIL - 0.04, (z0 + z1) / 2, 0, 0, -s * 0.3));
    }
    for (let z = z0 + 0.6; z < z1 - 0.3; z += 1.1) {
      for (const x of [-0.45, 0.45]) {
        sec.add(k.chrome, cyl(0.055, 0.055, 0.012, x, CEIL - 0.03, z, 12));
        sec.glow(this.cove, cyl(0.035, 0.035, 0.006, x, CEIL - 0.037, z, 10));
      }
      sec.add(k.white, box(0.5, 0.012, 0.08, 0, CEIL - 0.03, z + 0.55));
    }
    const r = rng(Math.round(z0 * 100) + 77);
    for (const z of masks) {
      for (const s of [-1, 1]) {
        if (r() < 0.35) continue;
        const x = s * (0.95 + r() * 0.15);
        const len = 0.5 + r() * 0.5;
        sec.thin(k.cable, beam(v3(x, CEIL - 0.08, z), v3(x + (r() - 0.5) * 0.08, CEIL - len, z + (r() - 0.5) * 0.08), 0.004, 3));
        sec.add(k.yellow, xf(new THREE.CylinderGeometry(0.06, 0.045, 0.07, 10), mat4(x, CEIL - len - 0.03, z, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4)));
      }
    }
  }

  /** Stringers, insulation and dangling wires at a torn end (dir = +1 for the +z end). */
  private tornEnd(sec: Sec, z: number, dir: number, seed: number) {
    const k = this.mats;
    const r = rng(seed);
    for (let i = 0; i < 9; i++) {
      const a = -2.2 + r() * 4.4;
      const rr = (R + RI) / 2;
      const p = v3(Math.sin(a) * rr, Math.cos(a) * rr, z - dir * 0.05);
      const q = p.clone().add(v3(Math.sin(a) * (r() - 0.3) * 0.3, Math.cos(a) * (r() - 0.3) * 0.3, dir * (0.25 + r() * 0.5)));
      if (q.y < FY + 0.05 && Math.abs(q.x) < 1.4) continue;
      sec.add(k.frame, beam(p, q, 0.025, 4));
    }
    for (let i = 0; i < 6; i++) {
      const a = -2.0 + r() * 4.0;
      const rr = (R + RI) / 2;
      const g = new THREE.IcosahedronGeometry(0.16 + r() * 0.1, 1);
      g.scale(1.2, 0.8 + r() * 0.6, 0.7);
      sec.add(k.insul, xf(g, mat4(Math.sin(a) * rr, Math.cos(a) * rr, z + dir * 0.05, r(), r() * 3, r())));
    }
    const wires = [k.wireR, k.wireB, k.wireY, k.cable];
    for (let i = 0; i < 6; i++) {
      const x = (r() - 0.5) * 1.6;
      const a = v3(x, CEIL + 0.05, z - dir * 0.1);
      const b = v3(x + (r() - 0.5) * 0.4, CEIL - 0.6 - r() * 0.9, z + dir * (0.15 + r() * 0.3));
      sec.thin(wires[i % 4], wire(a, b, -0.15, 0.008, 8));
    }
    // a lip of torn carpet
    const g = new THREE.PlaneGeometry(1.4, 0.4, 4, 2);
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 3) * 0.04 + (pa.getY(i) + 0.2) * 0.25);
    sec.add(k.carpet, xf(g, mat4((r() - 0.5) * 0.6, FY + 0.03, z + dir * 0.1, -Math.PI / 2 + dir * 0.4, 0, 0)));
    // sand blown in through the break
    this.kit.d.add(decalMat(), decal('sandpile', 2.6, 2.2, sec.local(0, FY + 0.012, z - dir * 0.9, -Math.PI / 2, 0, r() * 3)));
  }

  /** Weathering on a section's outside: drips under the windows, soot at the breaks, sand on top. */
  private grime(sec: Sec, z0: number, z1: number, seed: number) {
    const r = rng(seed);
    for (let z = z0 + 1.2; z < z1 - 0.8; z += 1.6 + r() * 1.2) {
      for (const s of [-1, 1]) {
        if (r() < 0.3) continue;
        if (r() < 0.6) this.hullDec(sec, 'dirt', 2.4, 1.1, s * (2.0 + r() * 0.3), z + r());
      }
      if (r() < 0.6) this.hullDec(sec, 'sandpile', 1.6 + r(), 1.2, 0, z);
    }
    for (const s of [-1, 1]) {
      this.hullDec(sec, 'scorch', 1.8, 1.6, s * (0.9 + r() * 0.8), z0 + 0.6);
      this.hullDec(sec, 'scorch', 1.8, 1.6, s * (0.9 + r() * 0.8), z1 - 0.6);
    }
  }

  // ---------------------------------------------------------------- nose
  private buildNose(sec: Sec) {
    const k = this.mats;
    const taper = (z: number) => (z < -2.5 ? Math.sqrt(Math.max(0.0004, 1 - ((-2.5 - z) / 4.1) ** 2)) : 1);
    const droop = (z: number) => (z < -2.5 ? -1.4 * ((-2.5 - z) / 4.1) ** 2 : 0);
    const door = (a: number, z: number) => z > -1.35 && z < 0.3 && a > -2.1 && a < -0.55;
    this.shell(sec, {
      z0: -6.6, z1: 3.6, jag0: 0, jag1: 1, seed: 11, taper, droop,
      hole: (a, z) => door(a, z),
      glass: (a, z) => (z > -5.15 && z < -3.35 && Math.abs(a) < 1.02) || (z > -3.4 && z < -2.75 && Math.abs(a) > 1.0 && Math.abs(a) < 1.45),
      windows: (z, j) => z > 0.6 && z < 3.0 && j % 2 === 0,
      liningFrom: -6.7,
      floor: [-3.95, 3.4],
    });
    // nose bulkhead behind the instrument panel
    this.walls(sec, -3.9, 3.4, [[-1.35, 0.3]], []);
    sec.col(0, 0.3, -3.93, 1.5, 1.2, 0.43); // panel + windscreen
    this.ceiling(sec, -1.55, 3.3, [0.8, 2.2]);
    sec.add(k.headliner, box(1.5, 0.05, 1.7, 0, CEIL - 0.04, -2.45));
    this.tornEnd(sec, 3.6, 1, 21);

    this.grime(sec, -2.4, 3.6, 11);
    // radome seam + pitot tubes + gold cheatline + livery
    sec.add(k.dark, xf(new THREE.TorusGeometry(R * taper(-5.3) + 0.004, 0.012, 4, 30), mat4(0, droop(-5.3), -5.3)));
    for (const s of [-1, 1]) {
      sec.add(k.chrome, xf(new THREE.CylinderGeometry(0.012, 0.02, 0.32, 6), mat4(s * 1.0, -0.35, -4.8, Math.PI / 2 - 0.1, 0, 0)));
      // gold cheatline below the windows
      const stripe = hull({ r: R + 0.006, z0: -5.0, z1: 3.55, segA: 2, aMin: s > 0 ? 1.92 : -2.0, aMax: s > 0 ? 2.0 : -1.92, dz: 0.55, taper, droop, jag1: 1, seed: 11,
        cell: (a, z) => (s < 0 && z > -1.45 && z < 0.4 ? -1 : 0) });
      if (stripe.geos[0]) sec.add(k.gold, stripe.geos[0]);
      sec.dec('livery', 3.0, 0.47, s * Math.sqrt(R * R - 0.62 * 0.62) + s * 0.012, 0.62, s > 0 ? -1.2 : 1.7, -0.36, s * Math.PI / 2, 0);
    }
    sec.dec('rescue', 0.9, 0.22, Math.sqrt(R * R - 0.3 * 0.3) + 0.012, 0.3, 1.9, -0.17, Math.PI / 2, 0);

    // ---- cockpit
    const pz = -3.75;
    sec.add(k.panel, box(2.5, 0.66, 0.5, 0, 0.18, pz));
    sec.add(k.dark, box(2.3, 0.05, 1.25, 0, 0.6, pz - 0.38, 0, 0.06));
    sec.add(k.dark, box(2.5, 0.12, 0.08, 0, 0.56, pz + 0.24));
    // windshield frame: centre post and two pillars over the glass
    for (const a of [-0.52, 0, 0.52]) {
      const pts = [-5.12, -4.6, -4.1, -3.6, -3.36].map((z) => v3(Math.sin(a) * (RI + 0.05) * taper(z), Math.cos(a) * (RI + 0.05) * taper(z) + droop(z), z));
      for (let i = 0; i < pts.length - 1; i++) sec.add(k.dark, beam(pts[i], pts[i + 1], a === 0 ? 0.035 : 0.05, 5));
    }
    for (const z of [-5.12, -3.36]) {
      const arc = Array.from({ length: 9 }, (_, i) => { const a = -1.02 + (i / 8) * 2.04; return v3(Math.sin(a) * (RI + 0.05) * taper(z), Math.cos(a) * (RI + 0.05) * taper(z) + droop(z), z); });
      for (let i = 0; i < arc.length - 1; i++) sec.add(k.dark, beam(arc[i], arc[i + 1], 0.045, 5));
    }
    const screens = [-0.95, -0.36, 0.36, 0.95];
    for (const x of screens) sec.add(k.screen, box(0.44, 0.33, 0.02, x, 0.2, pz + 0.255));
    sec.gdec('pfd', 0.42, 0.31, -0.95, 0.2, pz + 0.268);
    sec.gdec('mfd', 0.42, 0.31, 0.36, 0.2, pz + 0.268);
    sec.glow(this.screenFlicker, box(0.42, 0.31, 0.004, -0.95, 0.2, pz + 0.262));
    // glare-shield knobs + standby gauges
    for (let i = 0; i < 9; i++) sec.add(k.chrome, cyl(0.018, 0.018, 0.03, -0.8 + i * 0.2, 0.47, pz + 0.27, 8, Math.PI / 2));
    // pedestal and thrust levers
    sec.add(k.panel, box(0.42, 0.62, 1.05, 0, FY + 0.31, -2.95));
    for (const x of [-0.06, 0.06]) {
      sec.add(k.chrome, box(0.02, 0.22, 0.02, x, FY + 0.72, -3.15, -0.5, 0, 0));
      sec.add(k.dark, box(0.05, 0.03, 0.05, x, FY + 0.82, -3.2));
    }
    sec.add(k.chrome, xf(new THREE.TorusGeometry(0.07, 0.015, 6, 16), mat4(0.17, FY + 0.6, -2.8, 0, Math.PI / 2, 0)));
    // overhead panel with switches
    sec.add(k.grey, box(0.7, 0.04, 0.6, 0, CEIL - 0.06, -2.35, 0, 0.1));
    for (let i = 0; i < 18; i++) sec.add(k.dark, box(0.015, 0.025, 0.015, -0.27 + (i % 6) * 0.11, CEIL - 0.09, -2.55 + Math.floor(i / 6) * 0.18));
    // seats (sheepskin), yokes
    for (const s of [-1, 1]) {
      const x = s * 0.62, z = -2.5;
      sec.add(k.dark, box(0.3, 0.32, 0.4, x, FY + 0.16, z));
      sec.add(k.fleece, box(0.56, 0.14, 0.56, x, FY + 0.42, z));
      sec.add(k.fleece, box(0.56, 0.85, 0.14, x, FY + 0.92, z + 0.3, 0, -0.14));
      sec.add(k.seatDark, box(0.32, 0.18, 0.1, x, FY + 1.42, z + 0.36, 0, -0.14));
      for (const t of [-1, 1]) sec.add(k.dark, box(0.06, 0.06, 0.4, x + t * 0.3, FY + 0.66, z - 0.02));
      sec.col(x, FY + 0.6, z + 0.05, 0.3, 0.6, 0.34);
      sec.add(k.dark, cyl(0.03, 0.035, 0.75, x, FY + 0.38, -3.32, 8));
      sec.add(k.dark, box(0.34, 0.05, 0.05, x, FY + 0.82, -3.26), box(0.05, 0.14, 0.05, x - 0.15, FY + 0.88, -3.26), box(0.05, 0.14, 0.05, x + 0.15, FY + 0.88, -3.26));
      sec.add(k.panel, box(0.28, 0.5, 1.6, s * 1.25, FY + 0.6, -2.8));
    }
    sec.col(0, FY + 0.31, -2.95, 0.21, 0.31, 0.52);
    // the note on the captain's yoke, the flight recorder on the right seat
    sec.dec('napkin', 0.13, 0.13, -0.62, FY + 0.92, -3.225, 0, 0, 0.1);
    sec.add(k.orange, box(0.34, 0.2, 0.48, 0.6, FY + 0.6, -2.48, 0, 0.3));
    this.kit.d.add(decalMat(), decal('cvr', 0.3, 0.15, sec.local(0.6, FY + 0.71, -2.48, -Math.PI / 2, 0.3, 0)));
    sec.thin(k.wireR, wire(v3(0.55, FY + 0.62, -2.72), v3(0.8, FY + 0.5, pz + 0.25), 0.25, 0.008, 8));
    sec.thin(k.cable, wire(v3(0.65, FY + 0.62, -2.72), v3(0.95, FY + 0.6, pz + 0.25), 0.2, 0.008, 8));

    // cockpit bulkhead: doorway 1.6 m wide, the empty parachute bracket on the cockpit side
    sec.add(k.lining, bulkhead(RI, FY, { x0: -0.8, x1: 0.8, y1: CEIL - 0.05 }, -1.6, 0.06));
    sec.add(k.walnut, box(0.06, CEIL - FY, 0.1, -0.83, (CEIL + FY) / 2, -1.6), box(0.06, CEIL - FY, 0.1, 0.83, (CEIL + FY) / 2, -1.6), box(1.72, 0.06, 0.1, 0, CEIL - 0.03, -1.6));
    for (const s of [-1, 1]) sec.col(s * 1.2, FY + 1.1, -1.6, 0.4, 1.1, 0.04);
    const bx = 1.05, by = 0.45, bz = -1.66;
    sec.add(k.frame, box(0.04, 0.8, 0.03, bx - 0.24, by, bz), box(0.04, 0.8, 0.03, bx + 0.24, by, bz), box(0.52, 0.04, 0.03, bx, by - 0.4, bz), box(0.52, 0.04, 0.03, bx, by + 0.4, bz));
    sec.add(k.black, box(0.05, 0.5, 0.012, bx - 0.1, by - 0.18, bz - 0.02, 0, 0, 0.15), box(0.05, 0.42, 0.012, bx + 0.12, by - 0.22, bz - 0.02, 0, 0, -0.2));
    sec.add(k.gold, box(0.06, 0.04, 0.02, bx + 0.13, by - 0.44, bz - 0.02));
    sec.dec('parachute', 0.36, 0.225, bx, by + 0.62, bz - 0.005, 0, Math.PI, 0);

    // ---- galley (right) and the entry (left)
    const gz0 = -1.45, gz1 = 1.35;
    sec.add(k.walnut, box(0.55, 0.92, gz1 - gz0, 1.22, FY + 0.46, (gz0 + gz1) / 2));
    sec.add(k.stone, box(0.6, 0.04, gz1 - gz0 + 0.04, 1.2, FY + 0.94, (gz0 + gz1) / 2));
    sec.add(k.walnut, box(0.36, 0.5, gz1 - gz0, 1.18, 0.8, (gz0 + gz1) / 2));
    sec.add(k.gold, box(0.02, 0.02, gz1 - gz0, 0.94, 0.56, (gz0 + gz1) / 2), box(0.02, 0.02, gz1 - gz0, 0.94, FY + 0.88, (gz0 + gz1) / 2));
    sec.col(1.25, FY + 0.48, (gz0 + gz1) / 2, 0.3, 0.48, (gz1 - gz0) / 2);
    // espresso machine, microwave, the sink, a champagne bucket
    sec.add(k.chrome, box(0.32, 0.36, 0.3, 1.2, FY + 1.14, -1.0));
    sec.add(k.gold, box(0.1, 0.04, 0.06, 1.05, FY + 1.06, -1.0), cyl(0.05, 0.05, 0.03, 1.2, FY + 1.33, -1.0, 12));
    sec.add(k.dark, box(0.4, 0.26, 0.34, 1.2, 0.76, -0.2));
    sec.thin(glassMat(), box(0.005, 0.18, 0.24, 0.995, 0.76, -0.22));
    sec.add(k.chrome, box(0.34, 0.03, 0.4, 1.2, FY + 0.965, 0.55), cyl(0.012, 0.012, 0.2, 1.25, FY + 1.06, 0.45, 6));
    sec.add(k.chrome, cyl(0.11, 0.09, 0.22, 1.18, FY + 1.07, 1.05, 14));
    sec.add(k.bottle, cyl(0.04, 0.045, 0.3, 1.18, FY + 1.18, 1.05, 10, 0.25, 0, 0.1));
    // raft stowage aft of the door; the pack half out of it
    sec.add(k.walnut, box(0.5, 0.92, 1.1, -1.22, FY + 0.46, 1.15));
    sec.col(-1.25, FY + 0.48, 1.15, 0.28, 0.48, 0.55);
    sec.add(k.yellow, xf(roundish(0.46, 0.22, 0.62), mat4(-1.05, FY + 1.06, 1.1, 0, 0.35, 0.12)));
    sec.add(k.red, box(0.04, 0.12, 0.02, -0.86, FY + 1.02, 1.0, 0, 0.35));
    this.kit.d.add(decalMat(), decal('raft', 0.42, 0.21, sec.local(-1.05, FY + 1.18, 1.1, -Math.PI / 2 + 0.12, 0.35, 0)));
    sec.gdec('exitSign', 0.3, 0.11, -0.5, CEIL - 0.1, -1.56, 0, 0, 0);
    // the airstair: the door is the stair, folded down to the sand
    const dz0 = -1.3, dz1 = 0.25, dw = dz1 - dz0;
    for (let i = 0; i < 3; i++) {
      const x = -1.86 - i * 0.29, y = FY - 0.19 * (i + 1) + 0.0;
      sec.add(k.paint, box(0.3, 0.04, dw - 0.1, x, y, (dz0 + dz1) / 2));
      sec.add(k.carpet, box(0.26, 0.012, dw - 0.2, x, y + 0.025, (dz0 + dz1) / 2));
      surfaces.tag(sec.col(x, y - 0.5, (dz0 + dz1) / 2, 0.15, 0.5, dw / 2 - 0.05), 'metal');
    }
    for (const z of [dz0 + 0.03, dz1 - 0.03]) {
      const g = new THREE.BoxGeometry(1.0, 0.24, 0.04);
      sec.add(k.paint, xf(g, mat4(-2.2, FY - 0.35, z, 0, 0, 0.58)));
      sec.thin(k.chrome, wire(v3(-1.7, FY + 1.3, z), v3(-2.6, FY + 0.2, z), 0.12, 0.01, 10));
      sec.add(k.chrome, cyl(0.016, 0.016, 0.7, -2.6, FY - 0.15, z, 6));
    }
  }

  // ---------------------------------------------------------------- cabin
  private buildCabin(sec: Sec) {
    const k = this.mats;
    const tear = (a: number, z: number) => a > 0.3 && a < 0.95 && z > -2.9 && z < -0.7 && !(a > 0.85 && (z < -2.6 || z > -0.95));
    const puncture = (a: number, z: number) => a < -0.42 && a > -0.75 && z > 1.55 && z < 2.25;
    const exit = (a: number, z: number) => a > 1.62 && a < 2.05 && z > -0.7 && z < 0.05;
    const { wins } = this.shell(sec, {
      z0: -4.8, z1: 4.8, jag0: 1, jag1: 1, seed: 23,
      hole: (a, z) => tear(a, z) || puncture(a, z) || exit(a, z),
      windows: (z, j) => z > -4.0 && z < 4.0 && !(z > -0.8 && z < 0.1) && j % 2 === 1,
      floor: [-4.55, 4.55],
    });
    void wins;
    this.walls(sec, -4.55, 4.55);
    this.ceiling(sec, -4.4, 4.4, [-3.4, -2.2, -1.0, 1.0, 2.4, 3.6]);
    this.tornEnd(sec, -4.8, -1, 31);
    this.tornEnd(sec, 4.8, 1, 37);
    // peeled petals around the tear and the puncture
    const petal = (a: number, z: number, out: number, len: number, w: number, seed: number) => {
      const r = rng(seed);
      const p = v3(Math.sin(a) * R, Math.cos(a) * R, z);
      const n = v3(Math.sin(a), Math.cos(a), 0);
      const g = new THREE.PlaneGeometry(w, len, 2, 3);
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const t = (pa.getY(i) + len / 2) / len;
        pa.setZ(i, t * t * out * 0.6 + Math.sin(pa.getX(i) * 9 + seed) * 0.02);
        pa.setX(i, pa.getX(i) * (1 - t * 0.6));
      }
      g.computeVertexNormals();
      const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), n);
      const m = new THREE.Matrix4().compose(p.addScaledVector(n, 0.02), q, v3(1, 1, 1)).multiply(mat4(0, 0, 0, 0, 0, r() * 6));
      const geo = xf(g, m);
      sec.add(k.paint, geo);
      const back = geo.clone();
      flip(back);
      sec.add(k.frame, back);
    };
    let sd = 100;
    for (const [a, z] of [[0.3, -2.0], [0.62, -2.95], [0.95, -1.6], [0.6, -0.62], [0.42, -1.2], [-0.45, 1.9], [-0.7, 2.25]] as const) petal(a, z, 0.5, 0.55, 0.45, sd++);
    // ---- interior: club seats, tables, divan, credenza, bar
    for (const s of [-1, 1]) {
      const x = s * 0.98;
      this.clubSeat(sec, x, -3.55, -1);
      this.clubSeat(sec, x, -1.75, 1);
      sec.add(k.walnut, box(0.55, 0.04, 0.85, x + s * 0.05, FY + 0.72, -2.65));
      sec.add(k.gold, box(0.56, 0.015, 0.86, x + s * 0.05, FY + 0.7, -2.65));
      sec.add(k.chrome, cyl(0.04, 0.12, 0.7, x + s * 0.05, FY + 0.36, -2.65, 10));
      sec.col(x + s * 0.05, FY + 0.37, -2.65, 0.28, 0.37, 0.43);
    }
    // divan (left)
    const dx = -1.13, dz0 = 0.6, dz1 = 3.2, dzc = (dz0 + dz1) / 2, dl = dz1 - dz0;
    sec.add(k.seatDark, xf(roundish(0.66, 0.3, dl), mat4(dx, FY + 0.16, dzc)));
    for (let i = 0; i < 3; i++) {
      const z = dz0 + 0.15 + (i + 0.5) * ((dl - 0.3) / 3);
      sec.add(k.seat, xf(roundish(0.62, 0.17, (dl - 0.3) / 3 - 0.02), mat4(dx + 0.02, FY + 0.39, z)));
      sec.add(k.seat, xf(roundish(0.2, 0.55, (dl - 0.3) / 3 - 0.02), mat4(dx - 0.26, FY + 0.72, z, 0, 0, -0.12)));
    }
    for (const z of [dz0 + 0.08, dz1 - 0.08]) sec.add(k.seat, xf(roundish(0.68, 0.5, 0.16), mat4(dx, FY + 0.42, z)));
    for (const [z, m] of [[1.2, k.black], [1.65, k.red], [2.6, k.black]] as const) sec.add(m, xf(roundish(0.36, 0.3, 0.12), mat4(dx - 0.1, FY + 0.62, z, 0.2, 0, -0.3)));
    sec.col(dx, FY + 0.4, dzc, 0.34, 0.4, dl / 2);
    // credenza (right): bottles, glasses, the decanter, the sat phone, the photo
    const cx = 1.2, cz0 = 0.7, cz1 = 2.7, czc = (cz0 + cz1) / 2;
    sec.add(k.walnut, box(0.5, 0.78, cz1 - cz0, cx, FY + 0.39, czc));
    sec.add(k.stone, box(0.54, 0.04, cz1 - cz0 + 0.04, cx - 0.02, FY + 0.8, czc));
    sec.add(k.gold, box(0.015, 0.015, cz1 - cz0, cx - 0.255, FY + 0.6, czc));
    sec.col(cx, FY + 0.41, czc, 0.27, 0.41, (cz1 - cz0) / 2);
    for (let i = 0; i < 5; i++) {
      const z = 1.6 + i * 0.12;
      const tip = i === 3;
      sec.add(k.bottle, xf(new THREE.CylinderGeometry(0.038, 0.042, 0.26, 10), mat4(cx + 0.05, FY + 0.95 - (tip ? 0.1 : 0), z, tip ? Math.PI / 2 - 0.1 : 0, 0.4, 0)));
      if (!tip) sec.add(k.gold, cyl(0.016, 0.02, 0.09, cx + 0.05, FY + 1.12, z, 8));
    }
    sec.add(k.chrome, cyl(0.06, 0.08, 0.2, cx - 0.05, FY + 0.92, 2.35, 12), cyl(0.03, 0.06, 0.08, cx - 0.05, FY + 1.06, 2.35, 10));
    for (let i = 0; i < 3; i++) sec.thin(glassMat(), cyl(0.03, 0.025, 0.1, cx - 0.12 + i * 0.07, FY + 0.87, 0.95 + i * 0.04, 10));
    // sat phone in its cradle (Ascend Concierge): the green LED is still on
    sec.add(k.dark, box(0.14, 0.05, 0.26, cx - 0.08, FY + 0.845, 1.1));
    sec.add(k.dark, box(0.07, 0.05, 0.24, cx - 0.08, FY + 0.89, 1.1, 0, 0, 0.1));
    sec.glow(this.phoneLed, box(0.02, 0.012, 0.02, cx - 0.13, FY + 0.88, 1.0));
    this.kit.halos.add(this.world(sec.p(cx - 0.14, FY + 0.89, 1.0)), '#3dff8a', 0.18, 0, 1.4);
    // the TIME mockup, leaning on the wall
    sec.add(k.gold, box(0.04, 0.5, 0.4, cx + 0.12, FY + 1.07, 1.75, 0, 0, -0.18));
    sec.dec('photo', 0.34, 0.43, cx + 0.095, FY + 1.07, 1.75, 0, -Math.PI / 2, -0.18);
    // a TV on the forward bulkhead side panel, its screen cracked dark
    sec.add(k.dark, box(0.05, 0.6, 1.0, 1.2, 0.55, 3.95, 0, 0, -0.32));
    this.ledge(sec, -1, -4.4, 0.55); this.ledge(sec, -1, 3.25, 4.4);
    this.ledge(sec, 1, -4.4, 0.65); this.ledge(sec, 1, 2.75, 4.4);
    this.grime(sec, -4.8, 4.8, 23);
    // floor litter: a tipped flute, sand, a turtleneck
    sec.add(k.black, xf(roundish(0.5, 0.06, 0.4), mat4(0.25, FY + 0.03, 0.4, 0, 0.7, 0)));
    this.kit.d.add(decalMat(), decal('sandpile', 1.8, 1.4, sec.local(0.3, FY + 0.012, -1.4, -Math.PI / 2, 0, 1.0)));
    this.kit.d.add(decalMat(), decal('oil', 0.8, 0.8, sec.local(0.6, FY + 0.013, 2.0, -Math.PI / 2, 0, 0.3)));
    // aisle floor-path strips (the emergency lights still glow green)
    for (const s of [-1, 1]) sec.glow(this.aisle, box(0.025, 0.012, 8.4, s * 0.62, FY + 0.006, 0));
    sec.gdec('exitSign', 0.3, 0.11, 0, CEIL - 0.1, -4.35, 0, Math.PI, 0);
    sec.gdec('exitSign', 0.3, 0.11, 0, CEIL - 0.1, 4.35, 0, 0, 0);
    sec.gdec('seatbelt', 0.24, 0.08, 0.45, CEIL - 0.03, -2.2, Math.PI / 2, 0, 0);
    // over-wing exit: the escape slide, half inflated, sagging into the sand
    const s0 = v3(1.62, -0.75, -0.35);
    const pts = [s0, v3(2.6, -0.95, -0.3), v3(3.5, -1.12, -0.25), v3(4.3, -1.18, -0.28)];
    for (let i = 0; i < pts.length - 1; i++) {
      for (const dzz of [-0.38, 0.38]) sec.add(k.yellow, beam(pts[i].clone().add(v3(0, 0.12, dzz)), pts[i + 1].clone().add(v3(0, 0.12, dzz)), 0.14 - i * 0.02, 10));
      sec.add(k.yellow, xf(slab(pts[i], pts[i + 1], 0.7), new THREE.Matrix4()));
    }
    // wing stub (left), torn short
    const stub = wingGeo({ span: 4.4, root: 3.4, tip: 2.6, sweep: 0.5, tR: 0.36, tT: 0.28, jagTip: 0.5, seed: 5 });
    mirrorX(stub);
    sec.add(k.paint, xf(stub, mat4(-1.45, -1.02, -1.8, 0, 0, -0.04)));
    sec.dec('noStep', 0.6, 0.15, -3.2, -0.83, 0.3, -Math.PI / 2, Math.PI, 0);
    sec.col(-3.6, -1.0, 0.4, 2.2, 0.18, 1.5, 0, 0, -0.04);
  }

  private clubSeat(sec: Sec, x: number, z: number, f: number) {
    const k = this.mats;
    const R2 = (w: number, h: number, d: number, px: number, py: number, pz: number, rx = 0) => xf(roundish(w, h, d), mat4(px, py, pz, rx, 0, 0));
    sec.add(k.chrome, cyl(0.16, 0.2, 0.14, x, FY + 0.07, z, 12));
    sec.add(k.seatDark, R2(0.66, 0.26, 0.66, x, FY + 0.26, z));
    sec.add(k.seat, R2(0.6, 0.17, 0.6, x, FY + 0.44, z + f * 0.02));
    for (const s of [-1, 1]) sec.add(k.seat, R2(0.14, 0.24, 0.62, x + s * 0.34, FY + 0.56, z));
    sec.add(k.seat, R2(0.6, 0.84, 0.2, x, FY + 0.84, z - f * 0.3, -f * 0.12));
    sec.add(k.seat, R2(0.38, 0.17, 0.13, x, FY + 1.2, z - f * 0.25, -f * 0.12));
    sec.col(x, FY + 0.45, z, 0.35, 0.45, 0.36);
  }

  /** Walnut sidewall ledge with a gold pinstripe, skipping furniture. */
  private ledge(sec: Sec, side: number, z0: number, z1: number) {
    const k = this.mats;
    sec.add(k.walnut, box(0.2, 0.05, z1 - z0, side * 1.47, FY + 0.6, (z0 + z1) / 2));
    sec.add(k.walnut, box(0.03, 0.55, z1 - z0, side * 1.38, FY + 0.32, (z0 + z1) / 2));
    sec.add(k.gold, box(0.012, 0.012, z1 - z0, side * 1.365, FY + 0.56, (z0 + z1) / 2));
  }

  /** A decal tangent to the hull at angle `a` (0 top, +π/2 = +x), its width along z. */
  private hullDec(sec: Sec, name: string, w: number, h: number, a: number, z: number, r = R) {
    const n = v3(Math.sin(a), Math.cos(a), 0);
    const sg = a === 0 ? 1 : -Math.sign(a);
    const up = v3(Math.cos(a) * sg, -Math.sin(a) * sg, 0);
    if (a === 0) up.set(-1, 0, 0);
    const x = new THREE.Vector3().crossVectors(up, n);
    const m = new THREE.Matrix4().makeBasis(x, up, n).setPosition(n.clone().multiplyScalar(r + 0.012).setZ(z));
    this.kit.d.add(decalMat(), decal(name, w, h, sec.m.clone().multiply(m)));
  }

  // ---------------------------------------------------------------- tail
  private buildTail(sec: Sec) {
    const k = this.mats;
    const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const taper = (z: number) => 1 - 0.68 * Math.pow(ss(2.6, 9.6, z), 1.15);
    const droop = (z: number) => (z > 2.6 ? 0.55 * ((z - 2.6) / 7) ** 2 : 0);
    this.shell(sec, {
      z0: -3.6, z1: 9.6, jag0: 1, jag1: 0, seed: 41, taper, droop,
      hole: () => false,
      windows: (z, j) => z > -3.0 && z < 0.9 && j % 2 === 0,
      liningTo: 3.15,
      floor: [-3.4, 3.1],
    });
    this.walls(sec, -3.4, 3.1);
    sec.col(0, 0.92 + 0.12, 2.25, 1.2, 0.12, 0.85); // hold ceiling
    this.ceiling(sec, -3.3, 1.35, [-2.4, -1.2]);
    this.tornEnd(sec, -3.6, -1, 43);
    // tail cone cap + APU exhaust
    sec.add(k.burnt, xf(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 14, 1, true), mat4(0, droop(9.6), 9.7, Math.PI / 2, 0, 0)));
    sec.add(k.belly, xf(new THREE.CircleGeometry(R * taper(9.6), 20), mat4(0, droop(9.6), 9.6, 0, 0, 0)));
    // aft pressure bulkhead with the baggage door, hold back wall, hold
    const hx0 = -0.36, hx1 = 0.64, hTop = FY + 1.62;
    sec.add(k.lining, bulkhead(RI, FY, { x0: hx0, x1: hx1, y1: hTop }, 1.4, 0.08));
    sec.add(k.frame, box(0.05, 1.66, 0.1, hx0 - 0.02, FY + 0.83, 1.36), box(0.05, 1.66, 0.1, hx1 + 0.02, FY + 0.83, 1.36), box(hx1 - hx0 + 0.1, 0.05, 0.1, (hx0 + hx1) / 2, hTop + 0.02, 1.36));
    sec.dec('baggage', 0.4, 0.2, hx1 + 0.42, FY + 1.35, 1.355, 0, Math.PI, 0);
    sec.col((hx0 - 1.6) / 2, FY + 1.1, 1.4, (hx0 + 1.6) / 2, 1.1, 0.05);
    sec.col((hx1 + 1.6) / 2, FY + 1.1, 1.4, (1.6 - hx1) / 2, 1.1, 0.05);
    sec.col((hx0 + hx1) / 2, (hTop + CEIL + 0.3) / 2, 1.4, (hx1 - hx0) / 2, (CEIL + 0.3 - hTop) / 2, 0.05);
    sec.add(k.panel, bulkhead(RI * taper(3.1), FY, null, 3.1, 0.06));
    sec.col(0, FY + 0.8, 3.12, 1.4, 0.8, 0.05);
    sec.add(k.lining, box(2.4, 0.04, 1.7, 0, 0.92, 2.25));
    sec.glow(this.holdLamp, box(0.5, 0.015, 0.08, 0.15, 0.9, 2.2));
    sec.col(-1.25, FY + 0.8, 2.25, 0.2, 0.8, 0.85);
    sec.col(1.25, FY + 0.8, 2.25, 0.2, 0.8, 0.85);
    // the rest of the hold: golf bag, a crate, a "doomsday" case
    sec.add(k.black, xf(new THREE.CylinderGeometry(0.14, 0.12, 1.05, 12), mat4(-0.9, FY + 0.5, 2.6, 0.25, 0, 0.35)));
    for (let i = 0; i < 4; i++) sec.add(k.chrome, cyl(0.02, 0.02, 0.25, -0.98 + i * 0.05, FY + 1.05, 2.72, 6, 0.3, 0, 0.35));
    sec.add(atlasSolid(), xf(atlasMap('crate', new THREE.BoxGeometry(0.7, 0.45, 0.45)), mat4(0.95, FY + 0.23, 2.7, 0, 0.1, 0)));
    sec.add(k.silverCase, box(0.5, 0.32, 0.7, -0.05, FY + 0.16, 2.8, 0.2));

    // lav (left): partition, door ajar, gold sink, "OCCUPIED" still lit; wardrobe (right)
    const lz0 = -0.55, lz1 = 1.36;
    sec.add(k.walnut, box(0.05, 2.1, 0.65, -0.42, FY + 1.05, lz0 + 0.33), box(0.05, 2.1, 0.62, -0.42, FY + 1.05, lz1 - 0.31));
    sec.add(k.walnut, box(1.15, 2.1, 0.05, -1.0, FY + 1.05, lz0));
    sec.add(k.walnut, box(0.05, 2.0, 0.66, -0.75, FY + 1.0, 0.6, 0, 1.0));
    sec.add(k.white, cyl(0.2, 0.17, 0.42, -1.2, FY + 0.21, 0.9, 14));
    sec.add(k.stone, box(0.4, 0.05, 0.45, -1.3, FY + 0.82, 0.1));
    sec.add(k.gold, xf(new THREE.SphereGeometry(0.13, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat4(-1.3, FY + 0.83, 0.1)), cyl(0.012, 0.012, 0.18, -1.43, FY + 0.93, 0.1, 6));
    sec.add(k.mirror, box(0.01, 0.6, 0.5, -1.47, FY + 1.3, 0.1));
    sec.gdec('occupied', 0.24, 0.1, -0.395, FY + 2.0, 0.6, 0, Math.PI / 2, 0);
    sec.col(-1.0, FY + 1.05, (lz0 + lz1) / 2, 0.6, 1.05, (lz1 - lz0) / 2);
    sec.add(k.walnut, box(0.7, 1.5, 1.3, 1.15, FY + 0.75, 0.72));
    sec.add(k.gold, box(0.01, 0.3, 0.02, 0.795, FY + 0.9, 0.72));
    sec.col(1.15, FY + 0.75, 0.72, 0.36, 0.75, 0.66);
    // a couple of forward-facing seats, one torn loose
    this.clubSeat(sec, 0.98, -2.3, -1);
    sec.add(k.seat, xf(new THREE.BoxGeometry(0.62, 0.8, 0.17), mat4(-0.9, FY + 0.15, -2.6, -1.35, 0.4, 0)));

    this.ledge(sec, 1, -3.3, 0.0);
    this.grime(sec, -3.6, 5.5, 41);
    // livery on the tail: registration, logo on the fin; gold cheatline
    for (const s of [-1, 1]) {
      sec.dec('reg', 1.6, 0.4, s * (R * taper(1.9) + 0.012), 0.5, 1.9, -0.3, s * Math.PI / 2, 0);
      const stripe = hull({ r: R + 0.006, z0: -3.55, z1: 7.5, segA: 2, aMin: s > 0 ? 1.92 : -2.0, aMax: s > 0 ? 2.0 : -1.92, dz: 0.55, taper, droop, jag0: 1, seed: 41 });
      if (stripe.geos[0]) sec.add(k.gold, stripe.geos[0]);
    }
    // T-tail: fin and stabiliser
    const fin = wingGeo({ span: 4.6, root: 4.2, tip: 2.0, sweep: 0.62, tR: 0.34, tT: 0.2, seed: 9 });
    sec.add(k.paint, xf(fin, mat4(0, 1.15, 4.6, 0, 0, Math.PI / 2)));
    for (const s of [-1, 1]) sec.dec('tailLogo', 1.6, 1.6, s * 0.16, 3.6, 7.1, 0, s * Math.PI / 2, 0);
    for (const s of [-1, 1]) {
      const stab = wingGeo({ span: 3.4, root: 2.0, tip: 1.0, sweep: 0.55, tR: 0.2, tT: 0.12, seed: 13 + s });
      if (s < 0) mirrorX(stab);
      sec.add(k.paint, xf(stab, mat4(0, 5.72, 8.1)));
    }
    sec.add(k.dark, box(0.22, 0.12, 0.4, 0, 5.82, 9.6));
    sec.glow(this.strobe, xf(new THREE.SphereGeometry(0.09, 10, 8), mat4(0, 5.95, 9.65)));
    this.kit.halos.add(this.world(sec.p(0, 5.95, 9.65)), '#ff2a1a', 2.4, this.strobeCh, 3);
    sec.col(0, 3.4, 7.2, 0.18, 2.2, 2.0, 0.55, 0, 0);
    // rear engine (left) on its pylon; the right pylon is a torn stub
    const eng = this.engineGeo();
    sec.add(k.paint, ...eng.paint.map((g) => xf(g, mat4(-2.75, 0.7, 4.8))));
    sec.add(k.chrome, ...eng.chrome.map((g) => xf(g, mat4(-2.75, 0.7, 4.8))));
    sec.add(k.dark, ...eng.dark.map((g) => xf(g, mat4(-2.75, 0.7, 4.8))));
    sec.add(k.burnt, ...eng.burnt.map((g) => xf(g, mat4(-2.75, 0.7, 4.8))));
    sec.dec('danger', 0.5, 0.5, -2.75 - 0.86, 0.7, 3.6, 0, -Math.PI / 2, 0);
    sec.col(-2.75, 0.7, 5.0, 0.86, 0.86, 1.8);
    sec.add(k.paint, box(1.2, 0.3, 1.6, -1.95, 0.65, 4.9, 0, 0, 0.12), box(0.9, 0.3, 1.4, 1.75, 0.65, 4.9, 0, 0, -0.12));
    sec.add(k.frame, beam(v3(2.2, 0.6, 4.4), v3(2.6, 0.5, 4.2), 0.03, 4), beam(v3(2.2, 0.7, 5.3), v3(2.55, 0.9, 5.6), 0.03, 4));
    sec.thin(k.wireR, wire(v3(2.18, 0.66, 4.7), v3(2.5, 0.0, 4.6), -0.2, 0.01, 8));
    sec.thin(k.wireY, wire(v3(2.18, 0.6, 5.0), v3(2.4, -0.3, 5.2), -0.2, 0.01, 8));
    sec.dec('scorch', 1.6, 1.6, R * taper(5) * 0.98, 0.6, 4.9, 0, Math.PI / 2, 0);
  }

  /** A business-jet engine nacelle (local: intake toward −z, centre at origin). */
  private engineGeo() {
    const prof = [[0.62, -1.75], [0.74, -1.7], [0.8, -1.55], [0.82, -1.0], [0.8, 0.4], [0.72, 1.3], [0.6, 1.7]];
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 24);
    lathe.rotateX(Math.PI / 2);
    lathe.rotateX(Math.PI);
    const paint = [norm(lathe)];
    const chrome = [xf(new THREE.TorusGeometry(0.69, 0.06, 8, 28), mat4(0, 0, -1.72))];
    const dark = [xf(new THREE.CylinderGeometry(0.66, 0.66, 0.05, 24), mat4(0, 0, -1.3, Math.PI / 2, 0, 0)), xf(new THREE.ConeGeometry(0.18, 0.32, 14), mat4(0, 0, -1.42, -Math.PI / 2, 0, 0))];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dark.push(xf(new THREE.BoxGeometry(0.06, 0.48, 0.015), mat4(Math.sin(a) * 0.38, Math.cos(a) * 0.38, -1.36, 0, 0.5, -a)));
    }
    const burnt = [xf(new THREE.CylinderGeometry(0.5, 0.58, 0.5, 20, 1, true), mat4(0, 0, 1.85, Math.PI / 2, 0, 0)), xf(new THREE.ConeGeometry(0.3, 0.6, 14), mat4(0, 0, 1.8, Math.PI / 2, 0, 0))];
    return { paint, chrome, dark, burnt };
  }

  // ================================================================ wings & engines
  private buildWings() {
    const k = this.mats;
    // the right wing stands tip-down in the dune: span axis tilted ~55° from the ground
    const wingM = mat4(10.6, 0, 3.6, 0, 0.35, 0).multiply(mat4(0, 0, 0, 0, 0, -0.98)).multiply(mat4(-7.4, 0, -1.2));
    const wing = wingGeo({ span: 8.6, root: 3.4, tip: 1.1, sweep: 0.5, tR: 0.4, tT: 0.14, jagRoot: 0.6, seed: 17, winglet: 1.2 });
    this.kit.b.add(k.paint, xf(wing, wingM.clone()));
    // spars and ribs out of the torn root, cables against the sky
    const rr = rng(71);
    for (let i = 0; i < 7; i++) {
      const zc = 0.3 + i * 0.45;
      const a = v3(0, (rr() - 0.5) * 0.2, zc + (rr() - 0.5) * 0.2).applyMatrix4(wingM);
      const b = v3(-0.35 - rr() * 0.7, (rr() - 0.5) * 0.5, zc + (rr() - 0.5) * 0.5).applyMatrix4(wingM);
      this.kit.b.add(k.frame, beam(a, b, 0.035, 4));
    }
    for (let i = 0; i < 4; i++) {
      const a = v3(0, 0.05, 0.6 + i * 0.6).applyMatrix4(wingM);
      const b = a.clone().add(v3((rr() - 0.5) * 0.6, -1.4 - rr() * 1.2, (rr() - 0.5) * 0.6));
      this.kit.nb.add([k.wireR, k.wireB, k.wireY, k.cable][i], wire(a, b, -0.3, 0.012, 10));
    }
    this.kit.d.add(decalMat(), decal('noStep', 0.6, 0.15, wingM.clone().multiply(mat4(2.4, 0.2, 1.2, -Math.PI / 2, 0, 0))));
    // collider along the planted wing (an oriented slab)
    this.kit.ocol(wingM.clone().multiply(mat4(4.3, 0, 1.9, 0, 0, 0)), 4.3, 0.22, 1.2);
    // nav light on the winglet (green, right wing): a steady dim glow
    const tipPos = v3(8.6, 0.6, 4.6).applyMatrix4(wingM);
    void tipPos;
    // the stub of fuselage the wing tore away from: sand piled where it hit
    this.kit.drift(10.2, 3.2, 7, 6, 0.35, (u, v) => 0.9 * bell(u, 0.5, 0.42) * bell(v, 0.5, 0.42), 0.5);
    this.kit.d.add(decalMat(), floorDecal('oil', 5, 4, 8.5, 0.02, 6.5, 0.4));
  }

  private buildEngines() {
    const k = this.mats;
    // the right engine tore off and ploughed on alone, nose-first into the trench
    const m = mat4(3.4, 0.45, 30.5, -0.28, 0.5, 0.2);
    const eng = this.engineGeo();
    this.kit.b.add(k.paint, ...eng.paint.map((g) => xf(g, m.clone())));
    this.kit.b.add(k.chrome, ...eng.chrome.map((g) => xf(g, m.clone())));
    this.kit.b.add(k.dark, ...eng.dark.map((g) => xf(g, m.clone())));
    this.kit.b.add(k.burnt, ...eng.burnt.map((g) => xf(g, m.clone())));
    this.kit.ocol(m.clone(), 0.8, 0.8, 1.75);
    this.kit.d.add(decalMat(), decal('danger', 0.5, 0.5, m.clone().multiply(mat4(0.84, 0.0, -1.0, 0, Math.PI / 2, 0))));
    this.kit.drift(3.0, 28.4, 4.2, 3.6, 0.5, (u, v) => 0.85 * bell(u, 0.5, 0.45) * bell(v, 0.5, 0.45));
    this.kit.d.add(decalMat(), floorDecal('scorch', 5, 6, 3.6, 0.03, 32.5, 0.5));
    // pylon chunk and fairing bits nearby
    this.kit.b.add(k.paint, box(1.0, 0.25, 1.4, 5.0, 0.12, 33.4, 0.8, 0.1, 0.2));
  }

  // ================================================================ trench, drifts
  private buildTrench() {
    const kit = this.kit;
    const cx = (z: number) => 1.2 * Math.sin(z * 0.05) - 0.4;
    // churned floor of the gouge, in segments
    for (let z = -12; z < 64; z += 9.5) {
      const zc = z + 4.75;
      const w = z > 40 ? 3.4 : 5.5;
      kit.d.add(decalMat(), floorDecal('gouge', 10.5, w, cx(zc), 0.025 + kit.ground(cx(zc), zc), zc, Math.PI / 2 + 0.05 * Math.cos(zc * 0.05)));
    }
    // two berms of ploughed sand, rising toward where the jet stopped; lumpy, broken, sprayed
    for (const side of [-1, 1]) {
      const zs = -16, ze = 62, mid = (zs + ze) / 2;
      const r = rng(side > 0 ? 5 : 9);
      const lumps = Array.from({ length: 9 }, () => [r(), r() * 0.5 + 0.5, r()]);
      kit.drift(cx(mid) + side * 5.0, mid, 5.2, ze - zs, -0.02 * side, (u, v) => {
        const z = zs + v * (ze - zs);
        const t = Math.max(0, 1 - (z + 16) / 78);
        let h = (0.12 + 0.55 * t * t) * Math.pow(bell(u, 0.5 - side * 0.08 + Math.sin(z * 0.21) * 0.06, 0.5), 1.3);
        for (const [lp, lh, lw] of lumps) h += 0.35 * lh * t * bell(v, lp, 0.04 + lw * 0.05) * bell(u, 0.45, 0.35);
        h *= 0.7 + 0.3 * Math.sin(z * 0.37 + side) * Math.sin(z * 0.13);
        return h * edge(v, 0.05);
      }, 0.55);
      for (let i = 0; i < 6; i++) {
        const z = -6 + r() * 50, x = cx(z) + side * (7 + r() * 3);
        kit.drift(x, z, 1.6 + r() * 2, 1.4 + r() * 2, r() * 3, (u, v) => 0.25 * bell(u, 0.5, 0.5) * bell(v, 0.5, 0.5), 0.4, false);
      }
    }
    // the plough mound the nose stopped in
    kit.drift(-2.8, -23.2, 9.5, 6.5, -0.15, (u, v) => 1.75 * bell(u, 0.5, 0.48) * Math.pow(bell(v, 0.42, 0.5), 1.2), 0.45);
    // sand against each section and ramps up into the breaks
    for (const [sec, z0, z1] of [[this.nose, -3.6, 3.6], [this.cabin, -4.8, 4.8], [this.tail, -3.6, 6.0]] as const) {
      this.skirt(sec, z0, z1);
    }
    this.ramp(this.nose, 3.6, 1);
    this.ramp(this.cabin, -4.8, -1);
    this.ramp(this.cabin, 4.8, 1);
    this.ramp(this.tail, -3.6, -1);
  }

  /** Sand piled against both flanks of a section. */
  private skirt(sec: Sec, z0: number, z1: number) {
    const c = sec.p(0, 0, (z0 + z1) / 2);
    const d = sec.dir(0, 0, 1);
    const ry = Math.atan2(d.x, d.z);
    this.kit.drift(c.x, c.z, 6.6, z1 - z0 + 1.2, ry, (u, v) => {
      const x = Math.abs(u - 0.5) * 6.6;
      return x < 1.25 ? 0 : 0.42 * Math.max(0, 1 - (x - 1.25) / 1.9) ** 1.4 * edge(v, 0.08);
    }, 0.45, false);
  }

  /** A sand ramp from the ground up to a section's floor at a torn end. */
  private ramp(sec: Sec, zEnd: number, dir: number) {
    const top = sec.p(0, FY, zEnd);
    const d = sec.dir(0, 0, dir);
    d.y = 0;
    d.normalize();
    const len = 3.6, under = 0.5;
    const c = top.clone().addScaledVector(d, (len - under) / 2 - under / 2 + under / 2);
    const ry = Math.atan2(d.x, d.z);
    const h0 = top.y - this.kit.ground(top.x, top.z) - 0.03;
    this.kit.drift(c.x, c.z, 3.8, len, ry, (u, v) => {
      const t = v * len - under; // metres beyond the floor edge
      const prof = Math.min(1, Math.max(0, Math.min(u, 1 - u) / 0.14));
      const h = t <= 0 ? h0 : h0 * Math.max(0, 1 - t / (len - under)) ** 1.25;
      return h * (0.35 + 0.65 * prof);
    }, 0.35);
  }

  // ================================================================ debris
  private buildDebris() {
    const k = this.mats;
    const kit = this.kit;
    const r = rng(1234);
    const g = (x: number, z: number) => kit.ground(x, z);
    // suitcases: hard shells (some burst), leather duffels
    const cases: [number, number, number, boolean][] = [[5.2, 12, 0.3, false], [-6.2, 18.5, 1.2, true], [2.4, 21, 2.2, false], [-4.0, 26, 0.6, false], [6.0, 24.5, 1.8, true], [-2.0, 38, 0.2, false], [4.5, 44, 2.6, false], [-5.4, 3.5, 0.9, false]];
    for (const [x, z, ry, open] of cases) {
      const y = g(x, z);
      const mat = r() < 0.6 ? k.silverCase : k.duffel;
      if (mat === k.duffel) {
        kit.b.add(k.duffel, xf(roundish(0.75, 0.32, 0.36), mat4(x, y + 0.14, z, 0, ry, 0)));
        kit.b.add(k.gold, xf(new THREE.TorusGeometry(0.12, 0.012, 4, 10, Math.PI), mat4(x, y + 0.3, z, 0, ry, 0)));
        continue;
      }
      if (open) {
        kit.b.add(mat, box(0.72, 0.12, 0.48, x, y + 0.06, z, ry), box(0.72, 0.12, 0.48, x + Math.cos(ry) * 0.05, y + 0.32, z - 0.42, ry, -1.2));
        for (let i = 0; i < 3; i++) kit.b.add([k.shirt, k.black, k.red][i], xf(roundish(0.5, 0.05, 0.4), mat4(x + (r() - 0.5) * 1.6, y + 0.03, z + 0.4 + r() * 1.2, 0, r() * 3, 0)));
      } else {
        kit.b.add(mat, box(0.72, 0.48, 0.28, x, y + 0.2, z, ry, 0, 0.2));
        kit.b.add(k.dark, box(0.2, 0.03, 0.04, x, y + 0.46, z, ry, 0, 0.2));
        kit.col(x, y + 0.22, z, 0.36, 0.22, 0.16, ry);
      }
    }
    // champagne crates (one split), bottles everywhere
    for (const [x, z, ry, broken] of [[-5.6, 9.5, 0.4, false], [-6.3, 10.4, 1.3, true], [6.4, 17.5, -0.3, false], [-3.2, 31, 0.9, false]] as const) {
      const y = g(x, z);
      if (!broken) {
        kit.b.add(atlasSolid(), xf(atlasMap('crate', new THREE.BoxGeometry(0.8, 0.5, 0.5)), mat4(x, y + 0.25, z, 0, ry, 0)));
        kit.col(x, y + 0.25, z, 0.4, 0.25, 0.25, ry);
      } else {
        for (let i = 0; i < 4; i++) kit.b.add(k.crate, box(0.8, 0.02, 0.12, x + (r() - 0.5) * 0.8, y + 0.02, z + (r() - 0.5) * 0.8, r() * 3, 0, (r() - 0.5) * 0.2));
      }
    }
    for (let i = 0; i < 14; i++) {
      const x = (r() - 0.5) * 14, z = -4 + r() * 40;
      kit.b.add(k.bottle, xf(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8), mat4(x, g(x, z) + 0.04, z, Math.PI / 2, r() * 6, 0)));
    }
    // panels of skin along the trench
    for (let i = 0; i < 9; i++) {
      const x = (r() - 0.5) * 10, z = 8 + r() * 50;
      const pg = new THREE.PlaneGeometry(0.8 + r() * 1.2, 0.6 + r() * 0.9, 3, 2);
      const pa = pg.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pa.count; j++) pa.setZ(j, Math.sin(pa.getX(j) * 2 + i) * 0.12);
      pg.computeVertexNormals();
      const geo = xf(pg, mat4(x, g(x, z) + 0.08, z, -Math.PI / 2 + (r() - 0.5) * 0.6, r() * 6, 0));
      kit.b.add(k.paint, geo);
      const back = geo.clone();
      flip(back);
      kit.b.add(k.frame, back);
    }
    // two seats thrown out, a life vest, an exercise bike, a ring light, a golf umbrella
    const seatAt = (x: number, z: number, ry: number, tip: number) => {
      const y = g(x, z);
      const m = mat4(x, y, z, tip, ry, 0);
      kit.b.add(k.seat, xf(box(0.66, 0.4, 0.66, 0, 0.3, 0), m.clone()), xf(box(0.62, 0.8, 0.17, 0, 0.8, -0.3, 0, -0.12), m.clone()));
      kit.b.add(k.chrome, xf(cyl(0.16, 0.2, 0.14, 0, 0.07, 0, 10), m.clone()));
      kit.col(x, y + 0.4, z, 0.36, 0.4, 0.36, ry);
    };
    seatAt(4.6, 6.2, 2.2, 0);
    seatAt(-5.0, 14.5, -0.8, -0.2);
    kit.b.add(k.yellow, xf(roundish(0.45, 0.06, 0.6), mat4(2.8, g(2.8, 15) + 0.03, 15, 0, 0.6, 0)));
    kit.b.add(k.yellow, xf(roundish(0.45, 0.06, 0.6), mat4(-1.4, g(-1.4, 23) + 0.03, 23, 0, 2.0, 0)));
    // the exercise bike (it came with a subscription)
    {
      const x = 6.4, z = 9.6, y = g(x, z);
      const m = mat4(x, y, z, 0, 0.9, -1.35);
      kit.b.add(k.dark, xf(box(1.1, 0.06, 0.12, 0, 0.03, 0), m.clone()), xf(box(0.06, 0.7, 0.1, 0.25, 0.4, 0, 0, 0, 0.3), m.clone()), xf(box(0.06, 0.8, 0.1, -0.3, 0.45, 0, 0, 0, -0.2), m.clone()));
      kit.b.add(k.chrome, xf(cyl(0.22, 0.22, 0.06, -0.3, 0.3, 0, 18, Math.PI / 2), m.clone()));
      kit.b.add(k.screen, xf(box(0.04, 0.26, 0.4, -0.42, 0.88, 0, 0, 0, 0.4), m.clone()));
      kit.col(x, y + 0.2, z, 0.6, 0.2, 0.35, 0.9);
    }
    // ring light
    kit.b.add(k.dark, xf(new THREE.TorusGeometry(0.3, 0.03, 6, 24), mat4(-6.6, g(-6.6, 28) + 0.05, 28, Math.PI / 2 - 0.1, 0, 0)));
    // the golden brochure, face up by the cabin's tail end
    const bp = v3(2.6, g(2.6, 4.0) + 0.012, 4.0);
    kit.b.add(atlasSolid(), xf(atlasMap('brochure', new THREE.BoxGeometry(0.21, 0.29, 0.006)), mat4(bp.x, bp.y, bp.z, -Math.PI / 2, 0.4, 0)));
    this.spot('brochure', bp.x, bp.y, bp.z);
    // fuel and scorch on the sand
    kit.d.add(decalMat(), floorDecal('oil', 6, 4, -3.5, 0.02, 5.0, 0.3));
    kit.d.add(decalMat(), floorDecal('scorch', 4, 4, 0.0, 0.02, -10.0, 1.1));
    kit.d.add(decalMat(), floorDecal('dirt', 7, 7, 4.0, 0.02, 14.0, 0.0));
  }

  /**
   * SafeExit™, the airframe parachute: fired late, it trailed the jet down the trench and now lies
   * half-inflated on its side, gold and cream gores, risers running back to the tail. The thing you
   * see from the road. You can walk under it.
   */
  private buildCanopy() {
    const k = this.mats;
    const gold = fabric('#c9962e', 0.85), cream = fabric('#e8dcc0', 0.85);
    const cx = -6, cz = 41, R0 = 11;
    const gores = 16, rings = 9;
    const r = rng(77);
    const wob = Array.from({ length: gores + 1 }, () => r());
    wob[gores] = wob[0];
    // dome around +y, then laid over: opening toward the jet (−z), crown downwind
    const lay = new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.35);
    const place = mat4(cx, this.kit.ground(cx, cz) - 0.8, cz, 0, -0.75, 0).multiply(lay);
    const vtx = (gi: number, ri: number) => {
      const th = (gi / gores) * Math.PI * 2;
      const ph = (ri / rings) * 1.25;
      const sag = 1 - 0.14 * Math.sin((gi / gores) * Math.PI * gores) ** 2 * (ri / rings); // scalloped gores
      const rad = R0 * sag * (1 + (wob[gi] - 0.5) * 0.08 * (ri / rings));
      const p = v3(Math.sin(ph) * Math.cos(th) * rad, Math.cos(ph) * rad * 0.78, Math.sin(ph) * Math.sin(th) * rad);
      p.applyMatrix4(place);
      // whatever would sink below the sand lies on it instead
      const gy = this.kit.ground(p.x, p.z) + 0.05;
      if (p.y < gy) p.y = gy + (gy - p.y) * 0.04;
      return p;
    };
    const outer: [number[], number[]] = [[], []];
    for (let gi = 0; gi < gores; gi++) {
      for (let ri = 0; ri < rings; ri++) {
        const a = vtx(gi, ri), b = vtx(gi + 1, ri), c = vtx(gi + 1, ri + 1), d = vtx(gi, ri + 1);
        const P = outer[gi % 2];
        for (const q of [a, c, b, a, d, c]) P.push(q.x, q.y, q.z);
        for (const q of [a, b, c, a, c, d]) P.push(q.x, q.y, q.z); // inside face
      }
    }
    for (const [i, mat] of [[0, gold], [1, cream]] as const) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(outer[i], 3));
      g.computeVertexNormals();
      this.kit.b.add(mat, norm(g));
    }
    // risers from the skirt to a confluence, then one strap to the tail cone
    const conf = v3(-4.5, this.kit.ground(-4.5, 24) + 0.4, 24);
    const tailHook = this.tail.p(0, droopTail(9.4) - 0.2, 9.5);
    for (let gi = 0; gi < gores; gi += 2) this.kit.nb.add(k.cable, wire(vtx(gi, rings), conf, 0.4, 0.015, 10));
    this.kit.nb.add(k.yellow, wire(conf, tailHook, 0.25, 0.04, 14));
    this.kit.d.add(decalMat(), floorDecal('dirt', 10, 8, cx + 2, 0.02 + this.kit.ground(cx + 2, cz - 6), cz - 6, 0.3));
    this.spot('canopy', cx + 1, this.kit.ground(cx + 1, cz - 8) + 0.05, cz - 8);
  }

  // ================================================================ light
  private buildLights() {
    const pal = this.kit.pal;
    this.strobe = pal.slot('#ff2a1a', 0);
    this.screenFlicker = pal.slot('#ffb02e', 0.6);
    this.aisle = pal.slot('#46ff8c', 0.8);
    this.cove = pal.slot('#ffd6a0', 0);
    this.phoneLed = pal.slot('#3dff8a', 3);
    this.cabinLight = new VirtualLight(0xffc890, 0, 9, 1.8);
    this.cockpitLight = new VirtualLight(0xffb060, 0, 4.5, 2);
    this.holdLight = new VirtualLight(0xffd8a8, 0, 3.6, 1.6);
    this.holdLamp = pal.slot('#ffe2b8', 0);
  }

  /** The baggage door (a hinge) and the go bag (hidden once taken). */
  private buildMoving(near: THREE.Object3D) {
    const k = this.mats;
    const hinge = new THREE.Group();
    hinge.matrixAutoUpdate = false;
    hinge.matrix.copy(this.tail.local(-0.36, FY, 1.4));
    const pivot = new THREE.Group();
    const db = new MeshBatch();
    db.add(rustyMetal({ base: '#cfc8b8', rust: 0.18, metalness: 0.4, roughness: 0.45 }), box(1.0, 1.62, 0.05, 0.5, 0.81, 0));
    db.add(k.gold, box(0.03, 0.18, 0.05, 0.88, 0.95, -0.04), box(0.1, 0.1, 0.03, 0.88, 1.25, -0.03));
    db.add(k.dark, box(0.12, 0.16, 0.02, 0.88, 1.25, -0.045));
    pivot.add(db.build('jet-holdDoor'));
    hinge.add(pivot);
    near.add(hinge);
    const doorCol = this.kit.ocol(this.tail.local(0.14, FY + 0.81, 1.4), 0.5, 0.81, 0.04);
    this.hold = { pivot, collider: doorCol, open: 0, target: 0 };

    const bag = new THREE.Group();
    bag.matrixAutoUpdate = false;
    bag.matrix.copy(this.tail.local(0.2, FY, 2.15, 0, 0.25, 0));
    const bb = new MeshBatch();
    bb.add(k.duffel, xf(roundish(0.8, 0.36, 0.4), mat4(0, 0.18, 0)));
    bb.add(k.gold, xf(new THREE.TorusGeometry(0.14, 0.014, 4, 12, Math.PI), mat4(0, 0.36, 0)), box(0.7, 0.012, 0.012, 0, 0.36, 0.1));
    bb.add(atlasSolid(), xf(atlasMap('passTag', new THREE.BoxGeometry(0.12, 0.06, 0.004)), mat4(0.3, 0.3, 0.21, 0, 0, 0.3)));
    bag.add(bb.build('jet-goBag'));
    near.add(bag);
    this.goBag = bag;
  }

  /** Sun shafts through the tear, the puncture and the windows (one instanced draw). */
  private buildShafts(near: THREE.Object3D) {
    const sec = this.cabin;
    const add = (a: number, z: number, w: number, h: number, s: Sec, floorZ: [number, number]) => {
      const c = s.p(Math.sin(a) * (R - 0.05), Math.cos(a) * (R - 0.05), z);
      const n = s.dir(Math.sin(a), Math.cos(a), 0);
      this.shaftDefs.push({ c, n, w, h, along: s.dir(0, 0, 1), floorY: s.p(0, FY, (floorZ[0] + floorZ[1]) / 2).y });
    };
    add(0.62, -1.8, 1.0, 1.9, sec, [-4, 4]);
    add(-0.58, 1.9, 0.45, 0.6, sec, [-4, 4]);
    for (const s of [-1, 1]) for (const z of [-3.4, -2.3, 1.3, 2.4]) add(s * Math.PI / 2, z, 0.38, 0.5, sec, [-4, 4]);
    for (const s of [-1, 1]) for (const z of [-2.2, -1.1]) add(s * Math.PI / 2, z, 0.38, 0.5, this.tail, [-3, 1]);
    // unit prism: source face at y=0, far face at y=-1 (uv.y 0 → 1)
    const src = [v3(-0.5, 0, -0.5), v3(0.5, 0, -0.5), v3(0.5, 0, 0.5), v3(-0.5, 0, 0.5)];
    const dst = src.map((p) => p.clone().setY(-1).multiplyScalar(1).setY(-1));
    const geo = framePrism(src, dst);
    this.shaftMat.fade.value = 0.55;
    const mesh = new THREE.InstancedMesh(geo, this.shaftMat.material, this.shaftDefs.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'jet-shafts';
    for (let i = 0; i < this.shaftDefs.length; i++) mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    near.add(mesh);
    this.shafts = mesh;
  }

  // ================================================================ interactions
  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  private loot(items: { id: string; qty: number }[], force = false) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty, false, force);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private buildInteractables() {
    const at = (name: string, s: Sec, x: number, y: number, z: number) => {
      const p = s.p(x, y, z);
      this.spot(name, p.x, p.y, p.z);
      return this.frame.p(p.x, p.y, p.z);
    };
    // harness spots (feet positions)
    at('heart', this.cabin, 0, FY + 0.02, -0.2);
    at('cockpit', this.nose, 0, FY + 0.02, -1.9);
    at('galley', this.nose, 0, FY + 0.02, 0.6);
    at('tailIn', this.tail, 0.15, FY + 0.02, -1.4);
    at('airstair', this.nose, -3.1, -1.2, -0.5);
    this.spot('approach', 9, this.kit.ground(9, -6) + 0.05, -6);

    this.interactables.push({
      id: 'jet.note', pos: at('noteSpot', this.nose, -0.62, FY + 0.95, -3.2), radius: 1.7,
      primary: { label: 'Read the napkin on the yoke', available: () => true, run: () => this.readNote() },
    });
    this.interactables.push({
      id: 'jet.cvr', pos: at('cvrSpot', this.nose, 0.6, FY + 0.65, -2.48), radius: 1.6,
      primary: {
        label: 'Wire the flight recorder to its battery',
        available: () => {
          if (this.s.has('site.jet.cvr')) return true;
          if (this.s.skill('electronics') < 1) return 'Requires Electronics 1';
          return true;
        },
        run: () => this.playCvr(),
      },
    });
    this.interactables.push({
      id: 'jet.phone', pos: at('phoneSpot', this.cabin, 1.1, FY + 0.9, 1.1), radius: 1.5,
      primary: { label: 'Pick up the sat phone', available: () => true, run: () => this.callConcierge() },
    });
    this.interactables.push({
      id: 'jet.raft', pos: at('raftSpot', this.nose, -1.0, FY + 1.05, 1.1), radius: 1.6,
      visible: () => !this.s?.has('site.jet.raft'),
      primary: {
        label: 'Cut open the life-raft pack',
        available: () => (this.s.skill('survival') >= 2 ? true : 'Requires Survival 2. It is a raft. You are in a desert. There is something else in there.'),
        run: () => {
          if (!this.s.set('site.jet.raft')) return;
          const got = this.loot([{ id: 'water', qty: 1 }, { id: 'ration', qty: 1 }, { id: 'medkit', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`The raft is for water. The kit taped inside it is not. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache + 15, 'Survival kit');
        },
      },
    });
    this.interactables.push({
      id: 'jet.galley', pos: at('galleySpot', this.nose, 1.0, FY + 1.05, 0.3), radius: 1.5,
      visible: () => !this.s?.has('site.jet.galley'),
      primary: {
        label: 'Search the galley',
        available: () => true,
        run: () => {
          if (!this.s.set('site.jet.galley')) return;
          const got = this.loot([{ id: 'water', qty: 1 }, { id: 'scrap', qty: 2 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Oat milk, gone. Caviar, gone. One bottle of something glacier-sourced, behind the espresso machine. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Galley');
        },
      },
    });
    this.interactables.push({
      // spots are already world-space (Site.spot applies the frame)
      id: 'jet.brochure', pos: this.spots.brochure.clone().setY(this.spots.brochure.y + 0.3), radius: 1.6,
      primary: { label: 'Read the gold brochure', available: () => true, run: () => this.readBrochure() },
    });
    // the hold: four ways in
    const holdOpen = () => !!this.s?.has('site.jet.hold');
    this.interactables.push({
      id: 'jet.hold', pos: at('holdDoor', this.tail, 0.14, FY + 1.0, 1.25), radius: 1.6,
      visible: () => !holdOpen(),
      primary: this.pickAction(),
      secondary: {
        label: 'Charge the baggage door',
        available: () => this.chargeReason(2),
        run: () => this.blowHold(),
      },
    });
    this.interactables.push({
      id: 'jet.holdpad', pos: at('holdPad', this.tail, 0.95, FY + 1.3, 1.3), radius: 1.5,
      visible: () => !holdOpen(),
      primary: { label: 'Enter the hold code', available: () => true, run: () => this.keypad() },
    });
    this.interactables.push({
      id: 'jet.gobag', pos: at('goBagSpot', this.tail, 0.2, FY + 0.4, 2.0), radius: 1.9,
      visible: () => holdOpen() && !this.s.has('site.jet.done'),
      primary: { label: 'Take the go bag', available: () => true, run: () => this.takeGoBag() },
    });
  }

  private pickAction(): Action {
    const pins = () => 4 - (this.s.focus('lockpicking') === 'feeler' ? 1 : 0);
    return {
      get label() { return 'Pick the manual override · 4 pins'; },
      available: () => {
        if (this.s.skill('lockpicking') < 2) return 'Requires Lockpicking 2';
        if (this.s.count('lockpick') < 1) return 'Need a lockpick';
        return true;
      },
      run: async () => {
        const n = pins();
        const res = await this.ctx.ui.lockpick({
          pins: n, title: 'BAGGAGE · MANUAL OVERRIDE',
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
            return this.s.count('lockpick') > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + n * 5, 'Lock picked');
          this.openHold('The override gives. The hold smells of leather and a plan.');
        }
      },
    };
  }

  private chargeReason(need: number): true | string {
    if (this.s.skill('demolition') < need) return `Requires Demolition ${need}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private blowHold() {
    if (this.chargeReason(2) !== true || this.s.has('site.jet.hold')) { this.ctx.audio.play('deny'); return; }
    if (!this.s.removeItem('charge', 1)) return;
    const quiet = this.s.focus('demolition') === 'shaped';
    const p = this.world(this.tail.p(0.14, FY + 0.9, 1.3));
    this.ctx.audio.play('thud', { pos: p, intensity: quiet ? 0.5 : 0.9 });
    this.ctx.cam.addTrauma(quiet ? 0.15 : 0.45);
    this.ctx.puffs?.emit(p, 14, 0.9, 0.6, 0.5);
    this.sparks.emit(p, 26, 4, { floorY: p.y - 0.9, size: 0.035 });
    this.s.addXP(XP_REWARDS.breach, 'Breached');
    this.openHold(quiet ? 'Shaped. The door folds in like it was asked nicely.' : 'The baggage door leaves the conversation. So does the sand on the roof.');
  }

  private async keypad() {
    const heard = this.s.has('site.jet.code');
    const res = await this.ctx.ui.keypad({
      title: 'BAGGAGE · ASCEND SECURE',
      code: '0000',
      hint: heard ? 'He said it on the tape: four zeros, like the returns.' : 'Four digits. A founder\'s idea of a joke.',
    });
    if (res === 'ok') {
      this.s.addXP(XP_REWARDS.keypadShorted, 'Hold code');
      this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
      this.openHold(heard ? 'Four zeros. The keypad agrees with the returns.' : 'You guessed his joke. That should worry you.');
    } else if (res === 'wrong') {
      this.ctx.audio.play('deny');
      this.toast('ASCEND SECURE: "That is not the vision."', 'bad');
    }
  }

  private openHold(line: string) {
    if (!this.s.set('site.jet.hold')) return;
    this.hold.target = 1.5;
    this.ctx.audio.play('door', { pos: this.world(this.tail.p(0.14, FY + 0.9, 1.4)) });
    this.toast(line, 'good');
  }

  private takeGoBag() {
    if (this.s.has('site.jet.done')) return;
    this.s.set('site.jet.done');
    this.goBag.visible = false;
    const got = this.loot([{ id: 'exit_pass', qty: 1 }, { id: 'battery', qty: 1 }, { id: 'medkit', qty: 1 }, { id: 'nft_drive', qty: 1 }], true);
    this.ctx.audio.play('loot');
    this.s.addXP(80, 'The go bag');
    void this.ctx.ui.choose({
      speaker: 'Hunter Vale\'s go bag',
      text: `Monogrammed. Inside: a cold wallet, a medkit with a gold cross, a spare cell, and a boarding pass in gold foil. EXIT · Platinum · Seat 1A. He packed his own seat on the last flight and then jumped out of this one. ${got}`,
      choices: [{ id: 'ok', label: 'Keep the pass' }],
    });
  }

  private async readNote() {
    if (this.s.set('site.jet.note')) this.s.addXP(15, 'The napkin');
    await this.ctx.ui.choose({
      speaker: 'Napkin on the yoke',
      text: 'Gold pen, cocktail napkin: "Gone ahead to scout. Plane is yours, Pilot. Land it somewhere photogenic. DO NOT open the hold, the go bag is for me. — H." Under it, in a neat printed hand that is somehow also the autopilot: "ExitPilot acknowledges. Landing: somewhere."',
      choices: [{ id: 'ok', label: 'Leave it on the yoke' }],
    });
  }

  private async readBrochure() {
    if (this.s.set('site.jet.brochure')) this.s.addXP(10, 'EXIT brochure');
    await this.ctx.ui.choose({
      speaker: 'EXIT™ · Platinum',
      text: '"Ascend presents EXIT: evacuation as a service. Leave before the planet leaves you. Basic: a place on the waitlist. Plus: a better place on the waitlist. Platinum: an actual seat, on an actual aircraft, flown by ExitPilot, our award-pending autopilot." Someone has circled "actual seat" and written "(1)" next to it.',
      choices: [{ id: 'ok', label: 'Drop it in the sand' }],
    });
  }

  private async playCvr() {
    const first = this.s.set('site.jet.cvr');
    if (first) {
      const hot = this.s.focus('electronics') === 'hotline';
      if (this.s.skill('electronics') < 4) {
        const ok = await this.ctx.ui.circuit({ title: 'FLIGHT RECORDER · 28V', difficulty: hot ? 1 : 2 });
        if (!ok) {
          this.s.data.flags = this.s.data.flags.filter((f) => f !== 'site.jet.cvr');
          this.ctx.audio.play('deny');
          return;
        }
      }
      this.ctx.audio.play('click');
      this.s.addXP(XP_REWARDS.keypadShorted + 10, 'Flight recorder');
    }
    const lines: Record<string, { speaker: string; text: string; next?: string; label: string }> = {
      a: { speaker: 'CVR · final four minutes', text: 'Wind. A seatbelt chime, twice. A synthetic voice, calm as a spa: "Mr. Vale, fuel is at nine percent. I recommend landing." A man\'s voice: "I recommend growth. Climb."', next: 'b', label: 'Keep listening' },
      b: { speaker: 'EXITPILOT', text: '"The parachute bracket reports open." — HUNTER VALE: "It\'s a soft launch. Hold the heading. North-west. The seats are a waitlist anyway, nobody is coming."', next: 'c', label: 'Keep listening' },
      c: { speaker: 'HUNTER VALE', text: '(The wind gets loud. He is shouting from the door.) "Tell the board I exited! And the hold code is four zeros, like the returns. Don\'t let anyone touch my—" (The door. Then just the wind.)', next: 'd', label: 'Keep listening' },
      d: { speaker: 'EXITPILOT', text: '"Understood. Passenger count: zero. Crew count: zero. Exiting." A pause the length of a fuel tank. "Thank you for flying Ascend." Forty-one seconds of sand.', label: 'Unplug it' },
    };
    await this.ctx.ui.converse({
      start: 'a',
      node: (id) => {
        const n = lines[id];
        if (!n) return null;
        return { speaker: n.speaker, text: n.text, choices: [{ id: n.next ?? 'end', label: n.label, next: n.next ?? '' }] };
      },
      onChoice: (nodeId) => {
        if (nodeId === 'c' && this.s.set('site.jet.code')) this.toast('The hold code: 0000.', 'info');
      },
    });
  }

  private callConcierge() {
    const soc = () => this.s.skill('social') + (this.s.focus('social') === 'known' ? 1 : 0);
    if (this.s.set('site.jet.phone')) this.s.addXP(XP_REWARDS.talk, 'Ascend Concierge');
    return this.ctx.ui.converse({
      start: 'hello',
      node: (id) => {
        if (id === 'hello') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: 'A chime, then a voice that has been smiling for a long time. "Thank you for calling Ascend Platinum. Your exit is our entrance. Who am I speaking with today?"',
            choices: [
              { id: 'hunter', label: '"It\'s Hunter. Hunter Vale."', next: 'hunter', disabled: soc() >= 2 ? undefined : 'Requires Social Engineering 2. You don\'t sound like a man with a jet.' },
              { id: 'customer', label: '"A customer."', next: 'customer' },
              { id: 'bye', label: 'Hang up' },
            ],
          };
        }
        if (id === 'customer') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: '"Wonderful! I can see your seat is confirmed: waitlist position four hundred and twelve thousand. Estimated departure: after the heat death of the universe, give or take. Is there anything else I can make seamless?"',
            choices: [
              { id: 'where', label: '"Where is Hunter?"', next: 'where' },
              { id: 'bye', label: 'Hang up' },
            ],
          };
        }
        if (id === 'where') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: '"Hunter is heads-down. His last known location is \'ahead\'. He asked me to tell callers that the Starlite keynote is the best summary of his vision, and that refunds are a mindset."',
            choices: [{ id: 'bye', label: 'Hang up' }],
          };
        }
        if (id === 'hunter') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: '"Welcome back, Hunter! Voice match sixty-one percent, which is within tolerance for founders. I show the aircraft as \'exited\'. How can I make that seamless?"',
            choices: [
              { id: 'unlock', label: '"Open the hold. Remotely."', next: 'unlock', disabled: this.s.has('site.jet.hold') ? 'It is already open.' : undefined },
              { id: 'where', label: '"Remind me where I am."', next: 'where2' },
              { id: 'bye', label: 'Hang up' },
            ],
          };
        }
        if (id === 'unlock') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: '"Remote unlock sent. Please don\'t tell the waitlist. And Hunter? The board would like to know when you\'re coming back. I told them you\'re in stealth mode."',
            choices: [{ id: 'bye', label: '"Perfect. Bye."' }],
          };
        }
        if (id === 'where2') {
          return {
            speaker: 'ARIA · Ascend Concierge',
            text: '"Your parachute beacon pinged once, east of the drive-in, and then you turned it off for focus time. The aircraft continued north-west with ExitPilot. You said that was \'the vibe\'."',
            choices: [{ id: 'back', label: '"Right. The vibe."', next: 'hunter' }],
          };
        }
        return null;
      },
      onChoice: (_n, c) => {
        if (c === 'unlock' && !this.s.has('site.jet.hold')) {
          this.s.addXP(XP_REWARDS.talk, 'Remote unlock');
          this.openHold('Somewhere in the tail, a latch clacks. Seamless.');
        }
      },
    });
  }

  // ================================================================ per frame
  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const s = this.ctx.state;
    const nearOn = this.near.visible;
    // state sync (new run / loaded save)
    if (s !== this.lastState) {
      this.lastState = s;
      const open = !!s?.has('site.jet.hold');
      this.hold.target = open ? 1.5 : 0;
      this.hold.open = this.hold.target;
      this.hold.collider.setEnabled(!open);
      this.goBag.visible = !s?.has('site.jet.done');
    }
    // door swing
    if (Math.abs(this.hold.target - this.hold.open) > 1e-3) {
      this.hold.open += (this.hold.target - this.hold.open) * Math.min(1, dt * 4);
      this.hold.collider.setEnabled(this.hold.open < 0.3);
    }
    this.hold.pivot.rotation.y = this.hold.open;
    const lit = Math.min(1, this.hold.open / 1.2);
    this.holdLamp.intensity.value = lit * 4;
    this.holdLight.intensity = lit * 2.4;
    if (lit > 0 && !this.holdLight.position.lengthSq()) this.holdLight.position.copy(this.world(this.tail.p(0.15, 0.7, 2.2)));

    const night = this.ctx.atmo.uNight.value as number;
    // ELT strobe: red flash on the fin every 1.4 s; brighter at night, visible from far
    const ph = (this.t % 1.4) / 1.4;
    const flash = ph < 0.08 ? 1 : 0;
    this.strobe.intensity.value = flash * (6 + night * 18);
    this.kit.halos.channels[this.strobeCh] = flash * (0.25 + night * 0.9);
    this.farHalo.channels[1] = flash * night;
    this.sparks.update(dt);
    if (!nearOn) return;

    uSiteNight.value = night;
    uSiteFlicker.value = 0.85 + 0.15 * Math.sin(this.t * 31) * Math.sin(this.t * 7.7);
    // the captain's display stutters; the aisle strip and coves breathe on the last of the battery
    const stutter = Math.sin(this.t * 13) * Math.sin(this.t * 3.1) > 0.82 ? 0.1 : 1;
    this.screenFlicker.intensity.value = (0.4 + night * 1.6) * stutter;
    this.aisle.intensity.value = (0.25 + night * 1.4) * (0.85 + 0.15 * Math.sin(this.t * 1.7));
    this.cove.intensity.value = night * 0.6 * (Math.sin(this.t * 0.9) > -0.6 ? 1 : 0.2);
    this.phoneLed.intensity.value = 2 + Math.sin(this.t * 2.5) * 1.5;
    this.cabinLight.intensity = night * 2.6;
    this.cockpitLight.intensity = night * 1.2 * stutter;
    this.cabinLight.position.copy(this.world(this.cabin.p(0, CEIL - 0.2, 0.5)));
    this.cockpitLight.position.copy(this.world(this.nose.p(-0.4, 0.35, -3.0)));

    // wires at the cabin's front break still arc now and then
    const pl = this.ctx.player?.position;
    if (pl) {
      if (!this.sparkAt.length) {
        this.sparkAt = [this.world(this.cabin.p(0.4, CEIL - 0.5, -4.85)), this.world(this.cabin.p(-0.5, CEIL - 0.9, -4.9))];
      }
      const d = pl.distanceTo(this.sparkAt[0]);
      this.sparkT -= dt;
      if (d < 30 && this.sparkT < 0) {
        const p = this.sparkAt[Math.random() < 0.5 ? 0 : 1];
        this.sparks.emit(p, 6 + Math.floor(Math.random() * 10), 2.2, { electric: true, floorY: p.y - 1.4, size: 0.02, life: 0.5 });
        this.sparkT = 2.5 + Math.random() * 5;
      }
    }

    // found: standing inside the cabin section
    if (s && pl && !s.has('site.jet.found')) {
      const h = this.spots.heart;
      if (Math.hypot(pl.x - h.x, pl.z - h.z) < 4.2 && Math.abs(pl.y - h.y) < 1.2) {
        s.set('site.jet.found');
        s.events.emit('toast', { text: 'Leather seats, no passengers. The cockpit door is open.', kind: 'info' });
      }
    }
    this.updateShafts();
  }

  private updateShafts() {
    const atmo = this.ctx.atmo;
    const sunW = atmo.uSunDir.value as THREE.Vector3;
    // world → site-local direction (the frame is a pure yaw)
    const c = Math.cos(-this.frame.yaw), sn = Math.sin(-this.frame.yaw);
    const sun = this._v.set(sunW.x * c + sunW.z * sn, sunW.y, -sunW.x * sn + sunW.z * c).normalize();
    const day = Math.max(0, Math.min(1, sun.y * 6)) * (1 - (atmo.uNight.value as number)) * (1 - atmo.storm * 0.8);
    const d = sun.clone().negate();
    const col = new THREE.Color();
    const up = v3(0, 1, 0);
    for (let i = 0; i < this.shaftDefs.length; i++) {
      const sd = this.shaftDefs[i];
      const facing = sun.dot(sd.n);
      const k = day * Math.max(0, Math.min(1, (facing - 0.06) / 0.3));
      if (k < 0.01) { this._m.makeScale(0, 0, 0); this.shafts.setMatrixAt(i, this._m); continue; }
      const len = Math.min(4.2, Math.max(0.6, (sd.c.y - sd.floorY) / Math.max(0.12, -d.y)));
      // basis: y = -d (prism runs along -y), z = section axis made perpendicular
      const yAx = d.clone().negate();
      const zAx = sd.along.clone().addScaledVector(yAx, -sd.along.dot(yAx));
      if (zAx.lengthSq() < 1e-4) zAx.copy(up);
      zAx.normalize();
      const xAx = new THREE.Vector3().crossVectors(yAx, zAx);
      this._m.makeBasis(xAx.multiplyScalar(sd.w), yAx.multiplyScalar(len), zAx.multiplyScalar(sd.h));
      this._m.setPosition(sd.c);
      this.shafts.setMatrixAt(i, this._m);
      col.copy(atmo.sunColor).multiplyScalar(k * 0.6);
      this.shafts.setColorAt(i, col);
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    if (this.shafts.instanceColor) this.shafts.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ helpers

const droopTail = (z: number) => (z > 2.6 ? 0.55 * ((z - 2.6) / 7) ** 2 : 0);
const bell = (u: number, c: number, w: number) => { const t = Math.max(0, 1 - Math.abs(u - c) / w); return t * t * (3 - 2 * t); };
const edge = (v: number, e: number) => Math.min(1, v / e, (1 - v) / e);

/** A soft rounded block (bags, cushions, the raft pack). */
function roundish(w: number, h: number, d: number) {
  const g = new THREE.SphereGeometry(0.5, 14, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 / Math.max(0.6, Math.pow(Math.abs(x) ** 4 + Math.abs(y) ** 4 + Math.abs(z) ** 4, 0.25) * 2);
    p.setXYZ(i, x * k * w * 1.15, y * k * h * 1.15, z * k * d * 1.15);
  }
  g.computeVertexNormals();
  return norm(g);
}

/** Mirror across x (a left wing from a right one), keeping faces outward. */
function mirrorX(g: THREE.BufferGeometry) {
  g.scale(-1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n]) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
  }
  return g;
}

/** Mirror the winding of a geometry (for the back faces of thin sheets). */
function flip(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n]) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

/** A flat inflatable mat between two points (the escape slide). */
function slab(a: THREE.Vector3, b: THREE.Vector3, w: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(len, 0.08, w);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(v3(1, 0, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, v3(1, 1, 1)));
  return norm(g);
}

/** Bulkhead disc of radius r above the floor, with an optional rectangular doorway. Faces ±z at z. */
function bulkhead(r: number, floorY: number, door: { x0: number; x1: number; y1: number } | null, z: number, depth: number) {
  const s = new THREE.Shape();
  const a0 = Math.acos(Math.max(-1, Math.min(1, floorY / r)));
  // from the floor on the right, around the top, to the floor on the left
  s.moveTo(Math.sin(a0) * r, floorY);
  for (let i = 1; i <= 32; i++) {
    const a = a0 - (i / 32) * (a0 * 2);
    s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  if (door) {
    s.lineTo(door.x0, floorY);
    s.lineTo(door.x0, door.y1);
    s.lineTo(door.x1, door.y1);
    s.lineTo(door.x1, floorY);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z - depth / 2);
  return norm(g);
}

/** Open prism between two rectangles (shaft volumes); uv.y 0 at src → 1 at dst. */
function framePrism(src: THREE.Vector3[], dst: THREE.Vector3[]) {
  const pos: number[] = [], uvs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = src[k], b = src[(k + 1) % 4], c = dst[(k + 1) % 4], d = dst[k];
    for (const [p, u, w] of [[a, 0, 0], [b, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [d, 0, 1]] as const) { pos.push(p.x, p.y, p.z); uvs.push(u, w); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A lofted wing: span along +x from the root (x=0) to the tip, chord along +z (leading edge at z=0,
 * swept back), thickness in y. Optional torn root, winglet.
 */
function wingGeo(o: { span: number; root: number; tip: number; sweep: number; tR: number; tT: number; jagRoot?: number; jagTip?: number; seed: number; winglet?: number }) {
  // airfoil around the chord: (c, t) with c 0..1, t -1..1
  const foil: [number, number][] = [[1, 0], [0.7, 0.45], [0.4, 0.85], [0.18, 1], [0.05, 0.75], [0, 0], [0.05, -0.55], [0.18, -0.7], [0.4, -0.6], [0.7, -0.3]];
  const r = rng(o.seed);
  const sections = 6;
  const ring = (k: number) => {
    const t = k / sections;
    const x = o.span * t;
    const ch = o.root + (o.tip - o.root) * t;
    const th = (o.tR + (o.tT - o.tR) * t) / 2;
    const le = x * Math.tan(o.sweep);
    return foil.map(([c, s]) => {
      let xx = x;
      if (k === 0 && o.jagRoot) xx += (r() - 0.5) * o.jagRoot;
      if (k === sections && o.jagTip) xx -= r() * o.jagTip;
      return v3(xx, s * th, le + c * ch);
    });
  };
  const rings = Array.from({ length: sections + 1 }, (_, k) => ring(k));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < sections; k++) {
    for (let i = 0; i < foil.length; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % foil.length], c = rings[k + 1][(i + 1) % foil.length], d = rings[k + 1][i];
      tri(a, c, b); tri(a, d, c);
    }
  }
  // tip cap (+ winglet), root cap only when not torn
  const capRing = (rg: THREE.Vector3[], flipIt: boolean) => {
    const c = rg.reduce((s, p) => s.add(p), v3(0, 0, 0)).multiplyScalar(1 / rg.length);
    for (let i = 0; i < rg.length; i++) flipIt ? tri(c, rg[(i + 1) % rg.length], rg[i]) : tri(c, rg[i], rg[(i + 1) % rg.length]);
  };
  capRing(rings[sections], false);
  if (!o.jagRoot) capRing(rings[0], true);
  if (o.winglet) {
    const tip = rings[sections];
    const top = tip.map((p) => v3(p.x + o.winglet! * 0.25, p.y + o.winglet!, p.z + o.winglet! * 0.45 + (p.z - tip[5].z) * -0.4));
    for (let i = 0; i < foil.length; i++) {
      const a = tip[i], b = tip[(i + 1) % foil.length], c = top[(i + 1) % foil.length], d = top[i];
      tri(a, b, c); tri(a, c, d);
    }
    capRing(top, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}
