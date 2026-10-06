import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '../world/Heightfield';
import { box, cyl, beam, wire, place, norm, MeshBatch, type Frame } from '../world/kit';
import { rustyMetal, concrete, corrugated, plainStandard, glow, GlowPalette, type GlowSlot } from '../world/materials';
import { GlowSprites } from '../world/effects';
import { VirtualLight } from '../world/lights';
import { surfaces } from '@/engine/surface';
import { pvMaterial, glassMaterial, flipInside, rng, SplitBatch } from './datacenterAtlas';
import { tubeAtlas, ChaseLights } from './tubeArt';

/**
 * The Tube's layout, site-local (metres). +x runs along the track toward the east portal in the
 * hills; -x runs 230 m west to where the money stopped. The track centreline sits at z = TZ.
 */
export const DECK = 5.0;
export const TZ = 3;
export const R = 1.65;
/** Tube centre height at the station. */
export const PY = 6.85;
export const STATION = { x0: -15, x1: 15, z0: -7, z1: 7 };
/** The open pod bay (lower half of the tube only). */
export const BAY = { x0: -8, x1: 8 };
/** Side airlock into the sealed west tube, on the platform side. */
export const AIRLOCK = { x0: -12.3, x1: -10.7, floor: 5.7 };
/** Walkable inside of the west tube: from the bulkhead to the joint above the break. */
export const INNER = { x0: -48, x1: -8.2 };
export const BREAK = { a: -48, mid: -60, b: -72 };
export const EAST_END = 63;
export const WEST_END = -228;
/** Pod centre at rest, and its floor. */
export const POD = { x: 0, y: PY, floor: 5.9, half: 2.6 };

const PROFILE: [number, number][] = [[-228, 12.0], [-175, 10.6], [-125, 10.6], [-48, PY], [15, PY], [63, 7.4]];
/** Tube centre height along the track. */
export function trackY(x: number) {
  if (x <= PROFILE[0][0]) return PROFILE[0][1];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [x0, y0] = PROFILE[i], [x1, y1] = PROFILE[i + 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return PROFILE[PROFILE.length - 1][1];
}

export const CH = { ON: 0, NIGHT: 1, POWER: 2, EMERG: 3, RED: 4, CONSOLE: 5, COVE: 6 } as const;

type Col = ReturnType<Physics['addBox']>;

const M = {
  conc: () => concrete('#a39d92', { stains: 0.65 }),
  concDark: () => concrete('#7f7a72', { stains: 0.8 }),
  deck: () => concrete('#8e8b85', { scale: 1.3, stains: 0.5 }),
  apron: () => concrete('#9e978b', { stains: 0.5 }),
  tube: () => rustyMetal({ base: '#cfd2cf', rust: -0.32, metalness: 0.55, roughness: 0.36, scale: 0.8 }),
  tubeIn: () => rustyMetal({ base: '#8a8f91', rust: -0.45, metalness: 0.5, roughness: 0.5 }),
  flange: () => rustyMetal({ base: '#4f5558', rust: -0.05, metalness: 0.7, roughness: 0.4 }),
  steel: () => rustyMetal({ base: '#5c6266', rust: -0.1 }),
  galv: () => rustyMetal({ base: '#a9aca9', rust: -0.45, metalness: 0.7, roughness: 0.4 }),
  white: () => rustyMetal({ base: '#e0dfd9', rust: -0.7, metalness: 0.3, roughness: 0.5 }),
  pod: () => rustyMetal({ base: '#f1f0eb', rust: -0.9, metalness: 0.45, roughness: 0.26 }),
  orangeM: () => rustyMetal({ base: '#ff6a1f', rust: -0.6, metalness: 0.3, roughness: 0.45 }),
  yellow: () => rustyMetal({ base: '#e2b523', rust: -0.3, metalness: 0.3, roughness: 0.55 }),
  clad: () => corrugated('#d3d6d6', -0.3, 'y'),
  roof: () => corrugated('#c6cacb', -0.2, 'x'),
  dark: () => plainStandard('#1b1e21', 0.5, 0.4),
  black: () => plainStandard('#0d0e0f', 0.55, 0.3),
  rubber: () => plainStandard('#151413', 0.95),
  orange: () => plainStandard('#ff6a1f', 0.5, 0.1),
  podIn: () => plainStandard('#e8e4da', 0.55, 0.05),
  glassDark: () => plainStandard('#0b1014', 0.08, 0.6),
  ceiling: () => plainStandard('#b9bcbc', 0.7, 0.1),
  seat: () => plainStandard('#e2ddd1', 0.85),
  seatOrange: () => plainStandard('#e5631f', 0.8),
};

export interface TubeSlots {
  strip: GlowSlot;
  emerg: GlowSlot;
  cove: GlowSlot;
  console: GlowSlot;
  night: GlowSlot;
  red: GlowSlot;
  green: GlowSlot;
  amber: GlowSlot;
  locker: GlowSlot;
  loop: GlowSlot;
}

interface Swing {
  obj: THREE.Object3D;
  col: Col;
  open: number;
  target: number;
  solid: boolean;
}

/** Colliders that ride with the pod. */
interface PodCol { col: Col; local: THREE.Vector3 }

export class TubeBuild {
  readonly root = new THREE.Group();
  /** Station + track detail. */
  readonly near = new THREE.Group();
  /** One-draw silhouette of the whole line. */
  readonly far = new THREE.Group();
  /** Track lights: visible near and far (they are the night silhouette). */
  readonly lights = new THREE.Group();
  readonly halos = new GlowSprites(12);
  readonly pal = new GlowPalette(16);
  readonly chase = new ChaseLights();
  readonly A = tubeAtlas();
  readonly screenOn = this.A.screen('on', 1.0);
  readonly screenPower = this.A.screen('power', 0.04);
  readonly poolNight = this.A.pool('night', 0);
  readonly poolPower = this.A.pool('power', 0);
  readonly slots: TubeSlots;
  readonly vl: Record<'platform' | 'control' | 'pod' | 'inner' | 'billboard' | 'portal', VirtualLight>;
  readonly pod = new THREE.Group();
  readonly podCols: PodCol[] = [];
  airlock!: Swing;
  locker!: Swing;
  lockerLoot!: THREE.Object3D;
  lockerHome = new THREE.Vector3();
  /** Where the blown locker door lands (local). */
  lockerFall = new THREE.Vector3();
  /** Local points for interactions. */
  readonly pts: Record<string, THREE.Vector3> = {};
  private readonly b = new SplitBatch();
  private readonly d = new MeshBatch();
  private readonly lens = new MeshBatch();
  private readonly farGlow = new MeshBatch();
  private readonly r = rng(777);

  constructor(private physics: Physics, private hf: Heightfield, readonly frame: Frame) {
    this.root.applyMatrix4(frame.m);
    this.root.name = 'tube';
    const P = this.pal;
    this.slots = {
      strip: P.slot('#fff1dc', 0.1),
      emerg: P.slot('#ffd9a8', 2.0),
      cove: P.slot('#ffc58a', 0.1),
      console: P.slot('#5fdcff', 0.4),
      night: P.slot('#ffe2bc', 0),
      red: P.slot('#ff2a1a', 0),
      green: P.slot('#46ff7a', 2.4),
      amber: P.slot('#ffb02e', 2.4),
      locker: P.slot('#ff3a2a', 2.4),
      loop: P.slot('#ff8a3a', 0),
    };
    this.vl = {
      platform: this.light('#ffe2c0', 1.5, 20, 0, DECK + 3.6, -2.5),
      control: this.light('#7fd8ff', 1.2, 8, 12, DECK + 2.2, -4.4),
      pod: this.light('#ffc890', 0, 6, 0, POD.floor + 1.5, TZ),
      inner: this.light('#7fd8ff', 0, 12, -26, PY + 0.8, TZ),
      billboard: this.light('#ffd8a8', 0, 16, -4, 8, -24),
      portal: this.light('#ffb070', 0, 10, EAST_END - 3, 5, TZ - 4),
    };

    this.buildGround();
    this.buildStation();
    this.buildBay();
    this.buildControl();
    this.buildWestTube();
    this.buildTrack();
    this.buildPortal();
    this.buildWestEnd();
    this.buildPod();
    this.buildBillboard();
    this.buildTower();

    const far = this.b.ext.buildFar('tube-far', { minSize: 0.6, colors: new Map<THREE.Material, THREE.ColorRepresentation>([[pvMaterial(), '#1b2533']]) });
    this.far.add(far, this.farGlow.build('tube-far-glow', false, false));
    this.near.add(this.b.near.build('tube-static'));
    const decals = this.d.build('tube-decals', false, false);
    decals.traverse((o) => { o.renderOrder = 2; });
    this.near.add(decals, this.halos.build(), this.pod);
    this.lights.add(this.lens.build('tube-chase', false, false), this.chase.buildHalos());
    this.root.add(this.near, this.far, this.lights);
  }

  // ------------------------------------------------------------------ helpers
  private light(c: string, k: number, dist: number, x: number, y: number, z: number) {
    const L = new VirtualLight(c, k, dist, 1.7);
    L.parent = this.root;
    L.position.set(x, y, z);
    return L;
  }

  col(x: number, y: number, z: number, hx: number, hy: number, hz: number, ry = 0) {
    return this.physics.addBox(this.frame.p(x, y, z), { x: hx, y: hy, z: hz }, this.frame.yaw + ry);
  }

  /** Box collider pitched by `phi` about the local z axis (sloped tube floors, fallen segments). */
  colPitch(x: number, y: number, z: number, hx: number, hy: number, hz: number, phi: number) {
    const R2 = this.physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.frame.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi));
    const p = this.frame.p(x, y, z);
    const desc = R2.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.physics.world.createCollider(desc);
  }

  ground(x: number, z: number) {
    const w = this.frame.p(x, 0, z);
    return this.hf.heightAt(w.x, w.z) - this.frame.y;
  }

  private solid(mat: THREE.Material, w: number, h: number, dd: number, x: number, y: number, z: number, ry = 0) {
    this.b.add(mat, box(w, h, dd, x, y, z, ry));
    this.col(x, y, z, w / 2, h / 2, dd / 2, ry);
  }

  private halo(x: number, y: number, z: number, c: string, size: number, ch: number, k = 1) {
    this.halos.add(new THREE.Vector3(x, y, z), c, size, ch, k);
  }

  /**
   * Cylinder of radius r along the track from (x0, y0) to (x1, y1) at z = TZ. Angles: θ measured so
   * that y' = -r·sinθ, z' = r·cosθ (θ = π/2 is the bottom, 3π/2 the top, π the platform side).
   */
  private cylX(x0: number, y0: number, x1: number, y1: number, r: number, seg = 28, t0 = 0, tl = Math.PI * 2, open = true) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open, t0, tl);
    g.rotateZ(-Math.PI / 2 + Math.atan2(y1 - y0, x1 - x0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, TZ);
    return norm(g);
  }

  /** Ring around the track at x (a flange, a stiffener). */
  private ringX(x: number, y: number, r: number, tube: number, phi = 0, seg = 32) {
    const g = new THREE.TorusGeometry(r, tube, 5, seg);
    g.rotateY(Math.PI / 2);
    g.rotateZ(phi);
    g.translate(x, y, TZ);
    return norm(g);
  }

  // ------------------------------------------------------------------ ground level
  private buildGround() {
    const { b, d, A } = this;
    b.add(M.apron(), box(40, 0.3, 26, 0, -0.1, -4));
    surfaces.tag(this.col(0, -0.1, -4, 20, 0.15, 13), 'concrete');
    // the walk in from the approach, and a turning circle for shuttles that never came
    b.add(M.apron(), box(5, 0.3, 18, 6, -0.12, -25));
    d.add(A.decal(), A.floor('oil', 3, 3, 4, 0.07, -5), A.floor('dirt', 6, 5, 8, 0.07, -14), A.floor('cracks', 5, 5, -6, 0.07, -10, 1), A.floor('dirt', 5, 5, -10, 0.07, 2));
    // columns and beams under the deck
    const conc = M.conc();
    for (const x of [-14, -7, 0, 7, 14]) {
      for (const z of [-6.3, 0.3, 6.3]) this.solid(conc, 0.8, DECK - 0.4, 0.8, x, (DECK - 0.4) / 2, z);
      this.b.add(conc, box(0.7, 0.6, 14, x, DECK - 0.7, 0));
    }
    this.b.add(conc, box(30, 0.6, 0.6, 0, DECK - 0.7, -6.6), box(30, 0.6, 0.6, 0, DECK - 0.7, 6.6));
    // plant under the deck: a substation box, a generator, cable risers
    this.solid(M.white(), 2.6, 2.0, 1.6, -9, 1.0, -3);
    this.solid(M.yellow(), 2.2, 1.3, 1.1, -3.5, 0.65, 3.5);
    this.b.add(M.dark(), cyl(0.09, 0.09, 1.0, -2.8, 1.8, 3.5, 6), box(0.5, 0.3, 0.02, -4.2, 0.9, 2.94));
    this.slots.green.add(this.d, box(0.05, 0.05, 0.02, -8.2, 1.4, -3.81));
    this.slots.amber.add(this.d, box(0.05, 0.05, 0.02, -8.0, 1.4, -3.81));
    for (const z of [-2.6, -2.2, -1.8]) this.b.add(M.dark(), cyl(0.06, 0.06, DECK - 1.6, -8.6, 2.0 + (DECK - 1.6) / 2 - 0.4, z, 6));
  }

  // ------------------------------------------------------------------ station shell
  private buildStation() {
    const { b, A } = this;
    const { x0, x1, z0, z1 } = STATION;
    const L = x1 - x0;
    // deck slab: top at DECK
    b.add(M.deck(), box(L, 0.4, z1 - z0, 0, DECK - 0.2, 0));
    surfaces.tag(this.col(0, DECK - 0.2, 0, L / 2, 0.2, (z1 - z0) / 2), 'concrete');
    const wallH = 4.2, top = DECK + wallH;
    const clad = M.clad();
    // south wall: door at x∈[1.2, 2.8], ribbon window between DECK+1.2 and DECK+2.8
    const dx0 = 1.2, dx1 = 2.8;
    const south = (a: number, c: number) => {
      b.add(clad, box(c - a, 1.2, 0.2, (a + c) / 2, DECK + 0.6, z0 + 0.1), box(c - a, wallH - 2.8, 0.2, (a + c) / 2, DECK + 2.8 + (wallH - 2.8) / 2, z0 + 0.1));
      this.d.add(glassMaterial(), box(c - a, 1.6, 0.03, (a + c) / 2, DECK + 2.0, z0 + 0.1));
      for (let x = a; x <= c + 0.01; x += (c - a) / Math.max(1, Math.round((c - a) / 1.6))) b.add(M.dark(), box(0.08, 1.6, 0.14, x, DECK + 2.0, z0 + 0.1));
      this.col((a + c) / 2, DECK + wallH / 2, z0 + 0.1, (c - a) / 2, wallH / 2, 0.12);
    };
    south(x0, dx0);
    south(dx1, x1);
    b.add(clad, box(dx1 - dx0, wallH - 2.3, 0.2, (dx0 + dx1) / 2, DECK + 2.3 + (wallH - 2.3) / 2, z0 + 0.1));
    b.add(M.dark(), box(0.12, 2.3, 0.26, dx0, DECK + 1.15, z0 + 0.1), box(0.12, 2.3, 0.26, dx1, DECK + 1.15, z0 + 0.1), box(dx1 - dx0 + 0.12, 0.12, 0.26, (dx0 + dx1) / 2, DECK + 2.3, z0 + 0.1));
    // north wall, solid with a louvre band
    this.solid(clad, L, wallH, 0.2, 0, DECK + wallH / 2, z1 - 0.1);
    // end walls: solid up to the wall top, a hole for the tube, a glazed arch above
    for (const x of [x0, x1]) {
      const s = x < 0 ? -1 : 1;
      const wx = x - s * 0.1;
      const piece = (za: number, zb: number, ya: number, yb: number) => {
        b.add(clad, box(0.2, yb - ya, zb - za, wx, (ya + yb) / 2, (za + zb) / 2));
        this.col(wx, (ya + yb) / 2, (za + zb) / 2, 0.12, (yb - ya) / 2, (zb - za) / 2);
      };
      piece(z0, TZ - R - 0.05, DECK, top);
      piece(TZ + R + 0.05, z1, DECK, top);
      piece(TZ - R - 0.05, TZ + R + 0.05, PY + R + 0.05, top);
      b.add(M.flange(), this.ringX(wx, PY, R + 0.1, 0.12));
    }
    // vault roof: a segmental arch of corrugated sheet, ribs inside, a light liner underneath
    const rise = 3.5, half = 7.3;
    const rad = (half * half + rise * rise) / (2 * rise);
    const cy = top + rise - rad;
    const ha = Math.asin(half / rad);
    const vault = new THREE.CylinderGeometry(rad, rad, L + 0.8, 36, 1, true, Math.PI * 1.5 - ha, ha * 2);
    vault.rotateZ(-Math.PI / 2);
    vault.translate(0, cy, 0);
    b.add(M.roof(), norm(vault));
    const liner = new THREE.CylinderGeometry(rad - 0.15, rad - 0.15, L - 0.2, 36, 1, true, Math.PI * 1.5 - ha, ha * 2);
    liner.rotateZ(-Math.PI / 2);
    liner.translate(0, cy, 0);
    b.add(M.ceiling(), flipInside(norm(liner)));
    // arch ribs + glazed arch tympanum on each end
    const arcPt = (a: number, r: number) => new THREE.Vector3(0, cy + Math.cos(a) * r, Math.sin(a) * r);
    for (let x = x0 + 0.5; x <= x1 - 0.4; x += 5) {
      for (let k = 0; k < 10; k++) {
        const a0 = -ha + (k / 10) * ha * 2, a1 = -ha + ((k + 1) / 10) * ha * 2;
        const p0 = arcPt(a0, rad - 0.35), p1 = arcPt(a1, rad - 0.35);
        p0.x = p1.x = x;
        b.add(M.steel(), beam(p0, p1, 0.1, 5));
      }
    }
    for (const x of [x0, x1]) {
      const s = x < 0 ? -1 : 1;
      const pts: number[] = [];
      for (let k = 0; k < 16; k++) {
        const a0 = -ha + (k / 16) * ha * 2, a1 = -ha + ((k + 1) / 16) * ha * 2;
        const p0 = arcPt(a0, rad - 0.05), p1 = arcPt(a1, rad - 0.05);
        pts.push(x - s * 0.1, top, p0.z, x - s * 0.1, p0.y, p0.z, x - s * 0.1, p1.y, p1.z);
        pts.push(x - s * 0.1, top, p0.z, x - s * 0.1, p1.y, p1.z, x - s * 0.1, top, p1.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pts.length / 3) * 2), 2));
      g.computeVertexNormals();
      this.d.add(glassMaterial(), norm(g));
      for (let z = -half + 1.2; z < half; z += 1.8) {
        const yy = cy + Math.sqrt(Math.max(0, rad * rad - z * z));
        b.add(M.dark(), box(0.1, yy - top, 0.1, x - s * 0.1, (yy + top) / 2, z));
      }
      b.add(M.dark(), box(0.16, 0.16, half * 2, x - s * 0.1, top + 0.08, 0));
    }
    // eaves, a cornice band, the banner on the south face
    b.add(M.flange(), box(L + 0.8, 0.3, 0.5, 0, top + 0.1, z0 - 0.05), box(L + 0.8, 0.3, 0.5, 0, top + 0.1, z1 + 0.05));
    b.add(M.orangeM(), box(L + 0.6, 0.14, 0.06, 0, DECK + 0.08, z0 - 0.02));
    b.add(A.paint(), A.quad('banner', 10.5, 1.95, -7.4, DECK + 3.45, z0 - 0.02, 0, Math.PI, 0));
    b.add(A.paint(), A.quad('logo', 4.2, 1.3, 9.2, DECK + 3.4, z0 - 0.02, 0, Math.PI, 0));
    // red aviation lights on the vault crown
    for (const x of [x0 + 1, x1 - 1]) {
      this.slots.red.add(this.d, place(new THREE.SphereGeometry(0.14, 8, 6), x, top + rise + 0.25, 0));
      this.halo(x, top + rise + 0.3, 0, '#ff2a1a', 1.6, CH.RED, 2.5);
    }
    this.farGlow.add(glow('#ff2a1a', 6).material, place(new THREE.SphereGeometry(0.3, 6, 4), x0 + 1, top + rise + 0.25, 0), place(new THREE.SphereGeometry(0.3, 6, 4), x1 - 1, top + rise + 0.25, 0));

    // the stair: open steel treads from the approach up to a landing at the south door
    const steps = 22, rise1 = DECK / steps, run = 0.3;
    const sx0 = 3.4, sz0 = -9.3, sz1 = -7.9;
    for (let k = 1; k <= steps; k++) {
      const y = k * rise1;
      const x = sx0 + (steps - k) * run + run / 2;
      this.solid(M.galv(), run + 0.02, 0.06, sz1 - sz0, x, y - 0.03, (sz0 + sz1) / 2);
      this.b.add(M.galv(), box(run, 0.14, sz1 - sz0, x, y - 0.13, (sz0 + sz1) / 2));
      this.col(x, y - 0.2, (sz0 + sz1) / 2, run / 2, 0.2, (sz1 - sz0) / 2);
    }
    const sxTop = sx0, sxBot = sx0 + steps * run;
    for (const z of [sz0, sz1]) {
      b.add(M.steel(), beam(new THREE.Vector3(sxBot, 0, z), new THREE.Vector3(sxTop, DECK, z), 0.12, 6));
      b.add(M.galv(), beam(new THREE.Vector3(sxBot, 1.0, z + (z < -8.5 ? -0.05 : 0.05)), new THREE.Vector3(sxTop, DECK + 1.0, z + (z < -8.5 ? -0.05 : 0.05)), 0.03, 5));
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const px = THREE.MathUtils.lerp(sxBot, sxTop, t);
        b.add(M.galv(), cyl(0.02, 0.02, 1.0, px, t * DECK + 0.5, z, 4));
      }
    }
    // landing: deck level, from the stair top to the door
    this.solid(M.deck(), sx0 - 0.6, 0.3, 2.6, (0.6 + sx0) / 2, DECK - 0.15, (z0 - 2.6 + z0) / 2 - 0.0);
    b.add(M.steel(), cyl(0.12, 0.12, DECK - 0.3, 0.9, (DECK - 0.3) / 2, z0 - 2.3, 8), cyl(0.12, 0.12, DECK - 0.3, sx0 - 0.3, (DECK - 0.3) / 2, z0 - 2.3, 8));
    b.add(M.galv(), beam(new THREE.Vector3(0.6, DECK + 1.0, z0 - 2.55), new THREE.Vector3(sx0, DECK + 1.0, z0 - 2.55), 0.03, 5), beam(new THREE.Vector3(0.6, DECK + 1.0, z0 - 2.55), new THREE.Vector3(0.6, DECK + 1.0, z0 - 0.1), 0.03, 5));
    this.col(0.6, DECK + 0.5, z0 - 1.3, 0.04, 0.5, 1.3);
    this.col((0.6 + sx0) / 2, DECK + 0.5, z0 - 2.58, (sx0 - 0.6) / 2, 0.5, 0.04);
    // lamp over the door + its pool on the landing
    b.add(M.dark(), box(0.5, 0.18, 0.3, 2.0, DECK + 2.7, z0 - 0.2));
    this.slots.night.add(this.d, box(0.44, 0.03, 0.24, 2.0, DECK + 2.6, z0 - 0.22));
    this.halo(2.0, DECK + 2.55, z0 - 0.35, '#ffe2bc', 1.3, CH.NIGHT, 2);
    this.d.add(this.poolNight.m, A.floor('poolWarm', 4, 3.4, 2.0, DECK + 0.02, z0 - 1.3), A.quad('washWarm', 3, 3.5, 2.0, DECK + 1.0, z0 - 0.01, 0, Math.PI, 0));
    this.pts.stairBase = new THREE.Vector3(sxBot + 1.2, 0, (sz0 + sz1) / 2);
    this.pts.landing = new THREE.Vector3(2.0, DECK, z0 - 1.3);

    // platform dressing: tactile edge, benches, departures board, posters, a kiosk at the stair foot
    const plat = TZ - R - 0.2;
    this.b.add(A.paint(), A.floor('tactile', 22, 0.4, -1, DECK + 0.01, plat - 0.25));
    for (const x of [-5.5, -2.5, 4.5]) {
      this.b.add(M.white(), box(1.8, 0.08, 0.5, x, DECK + 0.45, -4.6), box(1.8, 0.5, 0.08, x, DECK + 0.72, -4.86));
      this.b.add(M.steel(), box(0.06, 0.45, 0.45, x - 0.8, DECK + 0.22, -4.6), box(0.06, 0.45, 0.45, x + 0.8, DECK + 0.22, -4.6));
      this.col(x, DECK + 0.4, -4.65, 0.9, 0.4, 0.3);
    }
    this.b.add(M.dark(), box(2.2, 1.15, 0.16, -4.5, DECK + 3.75, -0.4), cyl(0.03, 0.03, 0.8, -5.3, DECK + 4.7, -0.4, 4), cyl(0.03, 0.03, 0.8, -3.7, DECK + 4.7, -0.4, 4));
    this.d.add(this.screenPower.m, A.quad('departures', 2.04, 1.02, -4.5, DECK + 3.75, -0.49, 0, Math.PI, 0));
    this.b.add(A.paint(), A.quad('poster', 0.9, 1.26, -9.0, DECK + 1.8, z0 + 0.22), A.quad('poster', 0.9, 1.26, 7.5, DECK + 1.8, z0 + 0.22));
    this.b.add(A.paint(), A.quad('future', 2.4, 0.6, BAY.x1 + 0.02, PY + 1.25, TZ, 0, Math.PI / 2, 0));
    this.solid(M.white(), 0.7, 1.6, 0.5, 9.6, 0.8, -10.6);
    this.d.add(this.screenPower.m, A.quad('kiosk', 0.5, 0.5, 9.6, 1.3, -10.86, 0, Math.PI, 0));
    // platform lights: strip fixtures under the vault, every third on the battery
    let k = 0;
    for (let x = x0 + 2.5; x < x1 - 1; x += 3.5) {
      const y = top + 1.2;
      this.b.add(M.dark(), box(2.2, 0.08, 0.24, x, y, -3.4));
      this.b.add(M.steel(), cyl(0.01, 0.01, 1.6, x, y + 0.8, -3.4, 4));
      const emerg = k++ % 3 === 0;
      (emerg ? this.slots.emerg : this.slots.strip).add(this.d, box(2.1, 0.02, 0.16, x, y - 0.05, -3.4));
      if (emerg) this.halo(x, y - 0.12, -3.4, '#ffd9a8', 1.0, CH.EMERG, 0.5);
      else this.d.add(this.poolPower.m, A.floor('poolWarm', 4.4, 4.0, x, DECK + 0.015, -3.4));
    }
  }

  // ------------------------------------------------------------------ pod bay (the open trough)
  private buildBay() {
    const { b, A } = this;
    const tube = M.tube();
    // the lower part of the tube through the bay; at the boarding gap the platform side is cut low
    const lipN = 0.372, lipS = 2.77, lowS = 2.49;
    const gap0 = -1.1, gap1 = 1.1;
    for (const [a, c, tl] of [[BAY.x0, gap0, lipS], [gap0, gap1, lowS], [gap1, BAY.x1, lipS]] as const) {
      b.add(tube, this.cylX(a, PY, c, PY, R, 32, lipN, tl - lipN));
      b.add(M.tubeIn(), flipInside(this.cylX(a, PY, c, PY, R - 0.06, 32, lipN, tl - lipN)));
    }
    // lip rails
    b.add(M.flange(), box(BAY.x1 - BAY.x0, 0.08, 0.12, 0, PY - 0.6, TZ + R * Math.cos(lipN)));
    b.add(M.flange(), box(gap0 - BAY.x0, 0.08, 0.12, (BAY.x0 + gap0) / 2, PY - 0.6, TZ - 1.53), box(BAY.x1 - gap1, 0.08, 0.12, (BAY.x1 + gap1) / 2, PY - 0.6, TZ - 1.53));
    // the trough is solid to the player except at the boarding gap
    this.col((BAY.x0 + gap0) / 2, (DECK + PY - 0.6) / 2, TZ, (gap0 - BAY.x0) / 2, (PY - 0.6 - DECK) / 2, R);
    this.col((BAY.x1 + gap1) / 2, (DECK + PY - 0.6) / 2, TZ, (BAY.x1 - gap1) / 2, (PY - 0.6 - DECK) / 2, R);
    this.col(0, (DECK + POD.floor - 0.12) / 2, TZ + 0.4, (gap1 - gap0) / 2, (POD.floor - 0.12 - DECK) / 2, R - 0.4);
    // cradles under the trough, the levitation rails the pod rides on
    for (let x = BAY.x0 + 1; x < BAY.x1; x += 2.5) {
      const g = new THREE.TorusGeometry(R + 0.05, 0.07, 5, 24, Math.PI - 0.74);
      g.rotateZ(Math.PI + 0.37);
      g.rotateY(Math.PI / 2);
      g.translate(x, PY, TZ);
      b.add(M.flange(), norm(g));
      b.add(M.steel(), box(0.4, 0.3, 2.4, x, DECK + 0.15, TZ));
    }
    for (const oz of [-0.7, 0.7]) b.add(M.flange(), box(BAY.x1 - BAY.x0, 0.12, 0.18, 0, PY - 1.25, TZ + oz));
    // boarding steps from the platform to the pod door, and a bridge plate across the lip
    const n = 4, rr = (POD.floor - DECK) / n;
    for (let i = 1; i <= n; i++) {
      const z = TZ - R - 0.3 - (n - i) * 0.3;
      this.solid(M.galv(), 1.8, rr * i, 0.3, 0, (rr * i) / 2 + DECK, z);
    }
    this.solid(M.galv(), 1.8, 0.1, 0.9, 0, POD.floor - 0.05, TZ - R + 0.25);
    b.add(M.yellow(), box(1.8, 0.02, 0.06, 0, POD.floor + 0.005, TZ - R - 0.1));
    for (const x of [-0.95, 0.95]) b.add(M.galv(), cyl(0.025, 0.025, 1.0, x, POD.floor + 0.5, TZ - R - 0.5, 5), beam(new THREE.Vector3(x, POD.floor + 1.0, TZ - R - 0.5), new THREE.Vector3(x, DECK + 1.0, TZ - R - 1.6), 0.025, 5));
    // bulkheads at both ends of the bay
    for (const x of [BAY.x0, BAY.x1]) {
      const g = new THREE.CircleGeometry(R - 0.02, 32);
      g.rotateY(x < 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(x, PY, TZ);
      b.add(M.flange(), norm(g));
      b.add(M.flange(), this.ringX(x, PY, R, 0.16));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.add(M.steel(), cyl(0.04, 0.04, 0.1, x + (x < 0 ? 0.06 : -0.06), PY + Math.sin(a) * (R - 0.25), TZ + Math.cos(a) * (R - 0.25), 6, 0, 0, Math.PI / 2));
      }
    }
    this.b.add(A.paint(), A.quad('vacuum', 1.1, 0.55, BAY.x0 + 0.03, PY + 0.4, TZ, 0, Math.PI / 2, 0));
    this.pts.boarding = new THREE.Vector3(0, DECK, TZ - R - 1.8);
  }

  // ------------------------------------------------------------------ control room (east end of the platform)
  private buildControl() {
    const { b, A } = this;
    const x0 = 9.4, x1 = 14.7, z0 = -6.8, z1 = -2.2, h = 2.8;
    const glass = glassMaterial();
    // glass walls on a low base; door on the west side
    const dz0 = -5.4, dz1 = -3.8;
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, ry = -Math.atan2(bz - az, bx - ax);
      b.add(M.white(), box(len, 0.9, 0.12, cx, DECK + 0.45, cz, ry));
      this.d.add(glass, box(len, h - 0.9, 0.03, cx, DECK + 0.9 + (h - 0.9) / 2, cz, ry));
      b.add(M.dark(), box(len, 0.1, 0.14, cx, DECK + h, cz, ry), box(len, 0.06, 0.14, cx, DECK + 0.92, cz, ry));
      this.col(cx, DECK + h / 2, cz, len / 2, h / 2, 0.08, ry);
    };
    wall(x0, z1, x1, z1);
    wall(x0, z0 + 0.0, x0, dz0);
    wall(x0, dz1, x0, z1);
    b.add(M.dark(), box(0.12, h, 0.12, x0, DECK + h / 2, dz0), box(0.12, h, 0.12, x0, DECK + h / 2, dz1), box(0.12, 0.3, dz1 - dz0, x0, DECK + h - 0.15, (dz0 + dz1) / 2));
    for (let x = x0; x <= x1; x += 1.3) b.add(M.dark(), box(0.08, h, 0.1, x, DECK + h / 2, z1));
    b.add(M.white(), box(x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, DECK + h + 0.06, (z0 + z1) / 2));
    // console desk along the south wall with screens; the power panel with its big red button
    const cz = z0 + 0.55;
    this.solid(M.white(), 4.4, 0.9, 0.8, 12.1, DECK + 0.45, cz);
    b.add(M.dark(), box(4.5, 0.05, 0.9, 12.1, DECK + 0.92, cz));
    for (const [x, art] of [[10.8, 'trackmap'], [12.3, 'departures'], [13.6, 'trackmap']] as const) {
      b.add(M.dark(), box(1.2, 0.7, 0.06, x, DECK + 1.45, cz - 0.25, 0, -0.15));
      this.d.add(this.screenPower.m, A.quad(art, 1.1, 0.6, x, DECK + 1.45, cz - 0.215, -0.15, 0, 0));
    }
    this.b.add(A.paint(), A.quad('panel', 0.7, 0.7, 12.3, DECK + 0.96, cz + 0.05, -Math.PI / 2 + 0.25, 0, 0));
    this.slots.console.add(this.d, box(4.2, 0.02, 0.04, 12.1, DECK + 0.95, cz + 0.42));
    this.slots.red.add(this.d, place(new THREE.SphereGeometry(0.06, 10, 6), 12.3, DECK + 0.99, cz - 0.1));
    this.halo(12.3, DECK + 1.1, cz, '#5fdcff', 2.4, CH.CONSOLE, 0.5);
    b.add(M.dark(), box(0.5, 0.08, 0.5, 12.2, DECK + 0.5, cz + 1.0), box(0.5, 0.6, 0.08, 12.2, DECK + 0.85, cz + 1.25));
    b.add(M.steel(), cyl(0.03, 0.03, 0.45, 12.2, DECK + 0.25, cz + 1.0, 6));
    // a coffee cup and the founder's name plate
    b.add(M.white(), cyl(0.045, 0.04, 0.1, 13.9, DECK + 0.99, cz + 0.2, 10));
    this.pts.console = new THREE.Vector3(12.3, DECK, cz + 1.1);
  }

  // ------------------------------------------------------------------ sealed west tube: airlock, walkway, the break
  private buildWestTube() {
    const { b, d, A } = this;
    const tube = M.tube();
    // station section [-15, -8]: three pieces, the middle one leaves the airlock gap on the platform side
    const g0 = 2.371, g1 = 3.83;
    for (const [a, c, gap] of [[STATION.x0 - 0.1, AIRLOCK.x0, false], [AIRLOCK.x0, AIRLOCK.x1, true], [AIRLOCK.x1, BAY.x0, false]] as const) {
      const t0 = gap ? g1 : 0, tl = gap ? Math.PI * 2 - (g1 - g0) : Math.PI * 2;
      b.add(tube, this.cylX(a, PY, c, PY, R, 32, t0, tl));
      this.b.indoor = true;
      b.add(M.tubeIn(), flipInside(this.cylX(a, PY, c, PY, R - 0.06, 32, t0, tl)));
      this.b.indoor = false;
    }
    b.add(M.flange(), box(AIRLOCK.x1 - AIRLOCK.x0 + 0.3, 0.16, 0.2, (AIRLOCK.x0 + AIRLOCK.x1) / 2, AIRLOCK.floor + 2.25, TZ - 1.25));
    for (const x of [AIRLOCK.x0, AIRLOCK.x1]) b.add(M.flange(), box(0.16, 2.3, 0.22, x, AIRLOCK.floor + 1.1, TZ - 1.3));
    this.b.add(A.paint(), A.quad('vacuum', 0.9, 0.45, AIRLOCK.x1 + 0.7, PY + 0.8, TZ - R + 0.02, 0.0, Math.PI, 0));
    // steps up to the airlock sill
    for (let i = 1; i <= 3; i++) this.solid(M.galv(), 1.8, ((AIRLOCK.floor - DECK) / 3) * i, 0.32, (AIRLOCK.x0 + AIRLOCK.x1) / 2, DECK + (((AIRLOCK.floor - DECK) / 3) * i) / 2, TZ - R - 0.1 - (3 - i) * 0.32);
    // the door: a heavy curved plate on a vertical hinge at its east edge
    const door = new MeshBatch();
    const dw = AIRLOCK.x1 - AIRLOCK.x0;
    door.add(M.flange(), box(dw, 2.2, 0.12, -dw / 2, 1.1, 0));
    door.add(M.steel(), box(dw - 0.3, 1.9, 0.04, -dw / 2, 1.1, -0.08));
    door.add(M.yellow(), place(new THREE.TorusGeometry(0.22, 0.03, 6, 20), -dw / 2, 1.15, -0.16));
    for (let i = 0; i < 4; i++) door.add(M.yellow(), box(0.03, 0.42, 0.03, -dw / 2, 1.15, -0.16, 0, 0, (i / 4) * Math.PI));
    for (const y of [0.4, 1.8]) door.add(M.flange(), cyl(0.06, 0.06, 0.3, -0.02, y, 0.0, 8));
    for (let i = 0; i < 6; i++) door.add(M.yellow(), box(0.12, 0.12, 0.02, -0.25 - i * 0.22, 0.2, -0.07, 0, 0, 0.6));
    const pivot = new THREE.Group();
    pivot.position.set(AIRLOCK.x1, AIRLOCK.floor, TZ - 1.38);
    pivot.add(door.build('tube-airlock', false, true));
    this.near.add(pivot);
    this.airlock = { obj: pivot, col: this.col((AIRLOCK.x0 + AIRLOCK.x1) / 2, AIRLOCK.floor + 1.1, TZ - 1.38, dw / 2, 1.1, 0.1), open: 0, target: 0, solid: true };
    this.pts.airlock = new THREE.Vector3((AIRLOCK.x0 + AIRLOCK.x1) / 2, DECK, TZ - R - 1.3);

    // the walkable inside: a grated floor, walls, a ceiling; lights on the crown; cables; a cart
    this.b.indoor = true;
    const fl = AIRLOCK.floor;
    const ix0 = INNER.x0, ix1 = INNER.x1;
    const fw = 2 * Math.sqrt(R * R - (PY - fl) ** 2) - 0.1;
    this.col((ix0 + ix1) / 2, fl - 0.1, TZ, (ix1 - ix0) / 2, 0.1, fw / 2);
    this.col((ix0 + ix1) / 2, fl + 1.3, TZ + 1.32, (ix1 - ix0) / 2, 1.3, 0.1);
    this.col((ix0 + AIRLOCK.x0) / 2, fl + 1.3, TZ - 1.32, (AIRLOCK.x0 - ix0) / 2, 1.3, 0.1);
    this.col((AIRLOCK.x1 + ix1) / 2, fl + 1.3, TZ - 1.32, (ix1 - AIRLOCK.x1) / 2, 1.3, 0.1);
    this.col((AIRLOCK.x0 + AIRLOCK.x1) / 2, fl - 0.1, TZ - 1.2, (AIRLOCK.x1 - AIRLOCK.x0) / 2, 0.1, 0.4);
    this.col((ix0 + ix1) / 2, PY + R - 0.1, TZ, (ix1 - ix0) / 2, 0.1, 1.0);
    this.col(ix1 + 0.05, PY, TZ, 0.1, R, R);
    for (let x = ix0 + 0.6; x < ix1; x += 1.2) b.add(A.paint(), A.floor('grate', 1.2, fw, x, fl + 0.005, TZ));
    b.add(M.flange(), box(ix1 - ix0, 0.1, 0.08, (ix0 + ix1) / 2, fl - 0.04, TZ - fw / 2), box(ix1 - ix0, 0.1, 0.08, (ix0 + ix1) / 2, fl - 0.04, TZ + fw / 2));
    for (let i = 0; i < 3; i++) b.add(M.dark(), cyl(0.04, 0.04, ix1 - ix0, (ix0 + ix1) / 2, PY + 0.2 + i * 0.12, TZ + 1.45, 6, 0, 0, Math.PI / 2));
    this.lens.add(this.chase.material, this.chase.strip(box(ix1 - ix0 - 0.4, 0.03, 0.1, (ix0 + ix1) / 2, PY + R - 0.16, TZ)));
    for (let x = ix0 + 6; x < ix1; x += 12) this.chase.halo(new THREE.Vector3(x, PY + R - 0.3, TZ), Math.abs(x) / 240, 0.45);
    b.add(M.yellow(), box(1.2, 0.5, 0.6, -30, fl + 0.45, TZ - 0.78));
    b.add(M.rubber(), cyl(0.12, 0.12, 0.08, -30.5, fl + 0.12, TZ - 1.05, 10, Math.PI / 2), cyl(0.12, 0.12, 0.08, -29.5, fl + 0.12, TZ - 1.05, 10, Math.PI / 2));
    this.col(-30, fl + 0.45, TZ - 0.78, 0.6, 0.45, 0.3);
    d.add(A.decal(), A.floor('oil', 1.4, 1.2, -22, fl + 0.02, TZ), A.floor('dirt', 1.8, 1.4, -40, fl + 0.02, TZ));
    this.b.indoor = false;
    this.pts.inner = new THREE.Vector3(-20, fl, TZ);

    // the break: the pylon at -60 gave out; both spans sag into a V and tore at the bottom
    const gA = Math.max(this.ground(BREAK.mid, TZ - 1.2), this.ground(BREAK.mid, TZ + 1.2), this.ground(BREAK.mid, TZ));
    const yA = PY, yLow = gA + 1.18, yB = trackY(BREAK.b);
    const tA = BREAK.mid + 1.2;
    b.add(tube, this.cylX(tA, yLow + 0.12, BREAK.a, yA, R, 32));
    this.b.indoor = true;
    b.add(M.tubeIn(), flipInside(this.cylX(tA, yLow + 0.12, BREAK.a, yA, R - 0.06, 32)));
    this.b.indoor = false;
    const phiA = Math.atan2(yA - (yLow + 0.12), BREAK.a - tA);
    const lenA = Math.hypot(BREAK.a - tA, yA - yLow - 0.12);
    const cxA = (tA + BREAK.a) / 2, cyA = (yLow + 0.12 + yA) / 2 - 1.25;
    this.colPitch(cxA, cyA, TZ, lenA / 2, 0.1, fw / 2, phiA);
    for (const s of [-1, 1]) this.colPitch(cxA, cyA + 1.35, TZ + s * 1.32, lenA / 2, 1.3, 0.1, phiA);
    this.colPitch(cxA, cyA + 2.75, TZ, lenA / 2, 0.1, 1.0, phiA);
    // a lip of sand and debris at the torn mouth so you can step up into it
    const lipX = tA - 0.6, lipTop = yLow + 0.12 - 1.15;
    const gl = this.ground(lipX - 0.6, TZ);
    this.colPitch(lipX, (gl + lipTop) / 2 - 0.1, TZ, 0.75, 0.12, fw / 2, Math.atan2(lipTop - gl, 1.5));
    b.add(M.concDark(), place(new THREE.BoxGeometry(1.5, 0.24, fw), lipX, (gl + lipTop) / 2 - 0.1, TZ, 0, 0, Math.atan2(lipTop - gl, 1.5)));
    // grated ramp inside the fallen span
    for (let t = 0.04; t < 0.98; t += 0.09) {
      const x = THREE.MathUtils.lerp(tA, BREAK.a, t), y = THREE.MathUtils.lerp(yLow + 0.12, yA, t) - 1.15;
      const g = this.A.map('grate', new THREE.PlaneGeometry(lenA * 0.09, fw));
      g.rotateX(-Math.PI / 2);
      g.rotateZ(phiA);
      g.translate(x, y + 0.01, TZ);
      b.add(A.paint(), norm(g));
    }
    // the far span, crushed shut at the bottom; torn petals of skin at the open end
    const bEnd = BREAK.mid - 1.2;
    b.add(tube, this.cylX(BREAK.b, yB, bEnd, yLow + 0.3, R, 32));
    const phiB = Math.atan2(yLow + 0.3 - yB, bEnd - BREAK.b);
    const lenB = Math.hypot(bEnd - BREAK.b, yB - yLow - 0.3);
    // collider stops short of the crushed end so the gap at the bottom of the V stays open
    const cB = new THREE.Vector3(BREAK.b, yB, 0).lerp(new THREE.Vector3(bEnd, yLow + 0.3, 0), 0.45);
    this.colPitch(cB.x, cB.y, TZ, lenB * 0.45, R * 0.9, R * 0.9, phiB);
    this.col(bEnd - 0.5, yLow + 0.3, TZ, 0.45, R * 0.75, R * 0.85);
    const cap = new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.45, 1);
    cap.rotateZ(-Math.PI / 2);
    cap.rotateZ(phiB);
    cap.translate(bEnd, yLow + 0.3, TZ);
    b.add(M.flange(), norm(cap));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const base = new THREE.Vector3(tA, yLow + 0.12 + Math.sin(a) * R, TZ + Math.cos(a) * R);
      const tip = base.clone().add(new THREE.Vector3(-0.5 - this.r() * 0.6, Math.sin(a) * 0.5, Math.cos(a) * 0.5));
      const g = new THREE.BufferGeometry();
      const side = new THREE.Vector3(0, Math.cos(a), -Math.sin(a)).multiplyScalar(0.35);
      const p = [base.clone().add(side), base.clone().sub(side), tip];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.computeVertexNormals();
      b.add(tube, norm(g), flipInside(norm(g.clone())));
    }
    b.add(M.flange(), this.ringX(BREAK.a, PY, R + 0.07, 0.08));
    // the pylon that failed: a stub with rebar, its column lying in the sand
    const pg = this.ground(BREAK.mid + 3, TZ + 4);
    b.add(M.conc(), box(1.2, 1.3, 1.0, BREAK.mid, this.ground(BREAK.mid, TZ) + 0.4, TZ + 2.6));
    for (let i = 0; i < 6; i++) b.add(M.steel(), beam(new THREE.Vector3(BREAK.mid - 0.4 + (i % 3) * 0.4, this.ground(BREAK.mid, TZ) + 1.0, TZ + 2.3 + Math.floor(i / 3) * 0.5), new THREE.Vector3(BREAK.mid - 0.6 + (i % 3) * 0.5 + this.r() * 0.3, this.ground(BREAK.mid, TZ) + 1.5 + this.r() * 0.5, TZ + 2.1 + Math.floor(i / 3) * 0.9), 0.025, 4));
    const col = new THREE.BoxGeometry(1.0, 6.0, 0.8);
    col.rotateZ(Math.PI / 2 - 0.12);
    col.rotateY(0.5);
    col.translate(BREAK.mid + 2.5, pg + 0.5, TZ + 5.5);
    b.add(M.conc(), norm(col));
    this.col(BREAK.mid + 2.5, pg + 0.5, TZ + 5.5, 2.9, 0.5, 0.6, 0.5);
    this.col(BREAK.mid, this.ground(BREAK.mid, TZ) + 0.4, TZ + 2.6, 0.6, 0.65, 0.5);
    d.add(A.decal(), A.floor('dirt', 8, 7, BREAK.mid, gA + 0.05, TZ), A.floor('soot', 3, 3, BREAK.mid + 1, gA + 0.05, TZ - 2));
    this.pts.breakIn = new THREE.Vector3(BREAK.mid, gA, TZ - 3.2);
  }

  // ------------------------------------------------------------------ the track: segments, joints, pylons, PV, lights
  private buildTrack() {
    const { b } = this;
    const tube = M.tube(), flange = M.flange();
    const joints: number[] = [];
    for (let x = EAST_END; x >= STATION.x1; x -= 12) joints.push(x);
    joints.push(STATION.x1);
    const west: number[] = [STATION.x0, -24];
    for (let x = -36; x >= WEST_END; x -= 12) west.push(x);
    const pv = pvMaterial();
    const segs: [number, number][] = [];
    for (let i = 0; i < joints.length - 1; i++) if (joints[i] !== joints[i + 1]) segs.push([joints[i + 1], joints[i]]);
    for (let i = 0; i < west.length - 1; i++) segs.push([west[i + 1], west[i]]);
    // the sealed east section inside the station (solid to the player on the platform)
    segs.push([BAY.x1, STATION.x1]);
    this.col((BAY.x1 + STATION.x1) / 2, (DECK + PY + R) / 2, TZ, (STATION.x1 - BAY.x1) / 2, (PY + R - DECK) / 2, R);
    this.col((STATION.x0 + AIRLOCK.x0) / 2, (DECK + 5.5) / 2, TZ, (AIRLOCK.x0 - STATION.x0) / 2, (5.5 - DECK) / 2, R);
    this.col((AIRLOCK.x1 + BAY.x0) / 2, (DECK + 5.5) / 2, TZ, (BAY.x0 - AIRLOCK.x1) / 2, (5.5 - DECK) / 2, R);
    for (const [xa, xb] of segs) {
      if ((xa === BREAK.mid && xb === BREAK.a) || (xa === BREAK.b && xb === BREAK.mid)) continue;
      const ya = trackY(xa), yb = trackY(xb);
      const inside = xb <= STATION.x1 && xa >= STATION.x0;
      b.add(tube, this.cylX(xa, ya, xb, yb, R, 28));
      if (xa >= INNER.x0 && xb <= STATION.x0) {
        this.b.indoor = true;
        b.add(M.tubeIn(), flipInside(this.cylX(xa, ya, xb, yb, R - 0.06, 28)));
        for (let x = xa + 1.5; x < xb; x += 3) b.add(M.flange(), this.ringX(x, ya, R - 0.09, 0.04, 0, 24));
        this.b.indoor = false;
      }
      const phi = Math.atan2(yb - ya, xb - xa);
      const len = Math.hypot(xb - xa, yb - ya);
      // stiffener rings, a stripe, the PV roof
      for (let t = 3; t < len - 1; t += 3) b.add(flange, this.ringX(xa + Math.cos(phi) * t, ya + Math.sin(phi) * t, R + 0.025, 0.035, phi, 28));
      b.add(M.orange(), place(new THREE.BoxGeometry(len, 0.14, 0.03), (xa + xb) / 2, (ya + yb) / 2 - 0.25, TZ - Math.sqrt(R * R - 0.0625) - 0.012, 0, 0, phi));
      if (!inside) {
        for (const s of [-1, 1]) {
          const g = new THREE.BoxGeometry(len - 0.8, 0.04, 0.95);
          g.rotateX(s * 0.45);
          g.translate(0, R + 0.22, s * 0.48);
          g.rotateZ(phi);
          g.translate((xa + xb) / 2, (ya + yb) / 2, TZ);
          b.add(pv, norm(g));
        }
        for (let t = 1.5; t < len - 1; t += 3) b.add(M.galv(), place(new THREE.BoxGeometry(0.08, 0.3, 1.6), xa + Math.cos(phi) * t, ya + Math.sin(phi) * t + R + 0.05, TZ, 0, 0, phi));
        // a collider so nobody walks through a tube that dips near the ground
        const lowGround = Math.max(this.ground(xa, TZ), this.ground(xb, TZ), this.ground((xa + xb) / 2, TZ));
        if (Math.min(ya, yb) - R - lowGround < 3) this.colPitch((xa + xb) / 2, (ya + yb) / 2, TZ, len / 2, R * 0.92, R * 0.92, phi);
        // running lights: a continuous strip down both flanks (the pulses race along it), and a lamp
        // with a halo at every joint
        const zo = Math.sqrt(R * R - 0.35 * 0.35) + 0.03;
        for (const side of [-1, 1]) {
          const g = place(new THREE.BoxGeometry(len - 0.3, 0.1, 0.04), (xa + xb) / 2, (ya + yb) / 2 + 0.35, TZ + side * zo, 0, 0, phi);
          this.lens.add(this.chase.material, this.chase.strip(g));
          b.add(M.dark(), place(new THREE.BoxGeometry(len - 0.3, 0.14, 0.03), (xa + xb) / 2, (ya + yb) / 2 + 0.35, TZ + side * (zo - 0.025), 0, 0, phi));
        }
        const s = Math.abs(xb) / 240;
        b.add(M.dark(), box(0.4, 0.24, 0.14, xb - 0.6, yb + 0.35, TZ - zo - 0.05));
        this.lens.add(this.chase.material, this.chase.tag(box(0.3, 0.14, 0.04, xb - 0.6, yb + 0.35, TZ - zo - 0.12), s));
        this.chase.halo(new THREE.Vector3(xb - 0.6, yb + 0.35, TZ - zo - 0.4), s, 2.8);
      }
    }
    // joints: flanges + bellows; pylons where the tube is above ground
    const all = [...new Set([...joints, ...west])];
    for (const x of all) {
      const y = trackY(x);
      if (x === BREAK.mid) continue;
      b.add(flange, this.ringX(x, y, R + 0.08, 0.1));
      for (const o of [-0.25, 0.25]) b.add(flange, this.ringX(x + o, y, R + 0.04, 0.05));
      if (x >= STATION.x0 && x <= STATION.x1) continue;
      this.pylon(x, y);
    }
    // stencils near the station where the tube is level
    for (const x of [-20, 21]) this.d.add(this.A.decal(), this.A.quad('stencil', 4.5, 0.85, x, PY + 0.35, TZ - R - 0.02, 0, Math.PI, 0));
  }

  private pylon(x: number, y: number) {
    const { b } = this;
    const g = Math.min(this.ground(x - 0.6, TZ - 0.6), this.ground(x + 0.6, TZ + 0.6), this.ground(x, TZ));
    const capY = y - R - 0.5;
    if (capY - g < 0.6) return; // buried: the tube is in the hill here
    const h = capY - g + 0.3;
    const conc = M.conc();
    b.add(conc, box(1.0, h, 0.85, x, g - 0.3 + h / 2, TZ));
    b.add(conc, place(new THREE.BoxGeometry(1.0, 0.6, 0.85).translate(0, 0, 0), x, capY - 0.3, TZ, 0, 0, 0, 1, 1, 2.8));
    b.add(M.concDark(), box(2.2, 0.35, 1.4, x, g + 0.1, TZ));
    // saddle and dampers
    b.add(M.flange(), this.cylX(x - 0.35, y, x + 0.35, y, R + 0.1, 24, 0.55, 2.04, true));
    b.add(M.flange(), box(0.7, 0.12, 2.6, x, capY + 0.06, TZ));
    for (const oz of [-0.9, 0.9]) b.add(M.steel(), cyl(0.09, 0.09, 0.45, x, capY + 0.3, TZ + oz, 8));
    // a ladder on the platform side
    for (const o of [-0.2, 0.2]) b.add(M.galv(), box(0.04, h - 0.4, 0.04, x + o, g + (h - 0.4) / 2, TZ - 0.5));
    for (let yy = g + 0.4; yy < capY - 0.2; yy += 0.35) b.add(M.galv(), box(0.4, 0.03, 0.03, x, yy, TZ - 0.5));
    this.col(x, g + h / 2, TZ, 0.5, h / 2, 0.45);
  }

  // ------------------------------------------------------------------ east portal: headwall into the hill, the founders' locker
  private buildPortal() {
    const { b, A } = this;
    const x = EAST_END, y = trackY(x);
    const gl = this.ground(x - 1, TZ - 4.2);
    const top = y + R + 2.6;
    const conc = M.conc();
    // headwall: piers either side of the tube, a beam over it, a plinth under it; wing walls into the slope
    const base = Math.min(gl, this.ground(x, TZ + 6), this.ground(x, TZ - 7)) - 1.5;
    const piece = (za: number, zb: number, ya: number, yb: number) => {
      b.add(conc, box(1.4, yb - ya, zb - za, x + 0.7, (ya + yb) / 2, (za + zb) / 2));
      this.col(x + 0.7, (ya + yb) / 2, (za + zb) / 2, 0.7, (yb - ya) / 2, (zb - za) / 2);
    };
    piece(TZ - 7, TZ - R - 0.2, base, top);
    piece(TZ + R + 0.2, TZ + 7, base, top);
    piece(TZ - R - 0.2, TZ + R + 0.2, y + R + 0.2, top);
    piece(TZ - R - 0.2, TZ + R + 0.2, base, y - R - 0.2);
    // coping, pilasters, a recessed collar around the tube, the line's name in stencil
    b.add(M.concDark(), box(1.9, 0.45, 14.6, x + 0.6, top + 0.22, TZ), box(1.7, 0.2, 14.4, x + 0.55, top - 0.15, TZ));
    for (const oz of [-6.7, -3.6, 3.6, 6.7]) b.add(M.conc(), box(0.35, top - base, 0.7, x - 0.15, (top + base) / 2, TZ + oz));
    const collar = new THREE.RingGeometry(R + 0.12, R + 0.75, 40);
    collar.rotateY(-Math.PI / 2);
    collar.translate(x - 0.02, y, TZ);
    b.add(M.concDark(), norm(collar));
    b.add(M.flange(), this.ringX(x - 0.04, y, R + 0.12, 0.12), this.ringX(x - 0.04, y, R + 0.78, 0.06));
    b.add(A.paint(), A.quad('stencil', 5.5, 1.0, x - 0.02, top - 0.9, TZ, 0, -Math.PI / 2, 0));
    // cut-and-cover box running into the hill
    b.add(conc, box(16, y + R + 0.8 - base, 4.8, x + 9.4, (y + R + 0.8 + base) / 2, TZ));
    this.col(x + 9.4, (y + R + 0.8 + base) / 2, TZ, 8, (y + R + 0.8 - base) / 2, 2.4);
    b.add(A.decal(), A.quad('soot', 4, 5, x - 0.01, y + 1.5, TZ, 0, -Math.PI / 2, 0));
    // the locker bolted to the headwall: steel cabinet, sign, padlock LED
    const lz = TZ - 4.2, ly = gl;
    const ly0 = Math.max(ly, this.ground(x - 0.3, lz)) + 0.12;
    this.b.add(M.concDark(), box(0.9, 0.5, 1.8, x - 0.3, ly0 - 0.25, lz));
    b.add(M.steel(), box(0.6, 2.1, 1.5, x - 0.3, ly0 + 1.05, lz));
    this.col(x - 0.3, ly0 + 1.05, lz, 0.3, 1.05, 0.75);
    b.add(A.paint(), A.quad('portalSign', 1.3, 0.65, x - 0.015, ly0 + 2.65, lz, 0, -Math.PI / 2, 0));
    this.slots.locker.add(this.d, box(0.02, 0.05, 0.05, x - 0.62, ly0 + 1.3, lz + 0.55));
    this.halo(x - 0.66, ly0 + 1.3, lz + 0.55, '#ff3a2a', 0.25, CH.ON, 1.2);
    // its door: blown off by the demolition answer
    const door = new MeshBatch();
    door.add(M.flange(), box(0.06, 2.0, 1.44, 0, 1.0, 0));
    door.add(rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 }), box(0.08, 0.16, 0.12, -0.05, 1.05, 0.55));
    for (let i = 0; i < 5; i++) door.add(M.yellow(), box(0.02, 0.12, 0.12, -0.035, 0.3, -0.5 + i * 0.25, 0.6));
    const dObj = door.build('tube-locker', false, true);
    const pivot = new THREE.Group();
    pivot.position.set(x - 0.62, ly0, lz);
    pivot.add(dObj);
    this.near.add(pivot);
    this.locker = { obj: pivot, col: this.col(x - 0.62, ly0 + 1.0, lz, 0.05, 1.0, 0.72), open: 0, target: 0, solid: true };
    this.lockerHome = pivot.position.clone();
    // what's inside, revealed when the door goes
    const loot = new MeshBatch();
    loot.add(rustyMetal({ base: '#4a5a3a', rust: 0.3 }), box(0.45, 0.35, 0.6, 0, 0.2, -0.25), box(0.4, 0.3, 0.5, 0, 0.55, -0.2));
    loot.add(M.orange(), box(0.4, 0.25, 0.3, 0, 0.15, 0.35));
    loot.add(plainStandard('#d8d2c4', 0.9), box(0.42, 0.02, 0.3, 0, 1.4, 0));
    loot.add(A.paint(), A.quad('terminus', 0.55, 0.2, -0.02, 1.75, 0, 0, -Math.PI / 2, 0));
    this.lockerLoot = loot.build('tube-locker-loot', false, true);
    this.lockerLoot.position.set(x - 0.3, ly0, lz);
    this.lockerLoot.visible = false;
    this.near.add(this.lockerLoot);
    this.pts.locker = new THREE.Vector3(x - 1.7, this.ground(x - 1.7, lz), lz);
    this.lockerFall.set(x - 2.5, this.ground(x - 2.5, lz + 0.8) + 0.07, lz + 0.8);
    // a work lamp on the headwall
    b.add(M.dark(), box(0.35, 0.25, 0.3, x - 0.15, ly0 + 3.2, lz + 1.4));
    this.slots.night.add(this.d, box(0.3, 0.03, 0.22, x - 0.15, ly0 + 3.06, lz + 1.4));
    this.halo(x - 0.35, ly0 + 3.0, lz + 1.4, '#ffe2bc', 1.0, CH.NIGHT, 1.6);
    this.d.add(this.poolNight.m, A.floor('poolWarm', 5, 5, x - 2, ly + 0.32, lz + 0.5));
    // maintenance cabinet at the foot of the pylon east of the station (the lockpicking answer)
    const cx = 27, cg = this.ground(cx, TZ - 1.9);
    this.solid(M.white(), 0.9, 1.4, 0.5, cx, cg + 0.7, TZ - 1.6);
    b.add(M.dark(), box(0.92, 0.06, 0.52, cx, cg + 1.42, TZ - 1.6), box(0.06, 0.18, 0.05, cx + 0.3, cg + 0.8, TZ - 1.87));
    this.slots.amber.add(this.d, box(0.04, 0.04, 0.02, cx - 0.3, cg + 1.2, TZ - 1.86));
    this.b.add(A.paint(), A.quad('stencil', 0.85, 0.16, cx, cg + 1.05, TZ - 1.86, 0, Math.PI, 0));
    this.pts.cabinet = new THREE.Vector3(cx, cg, TZ - 2.6);
  }

  // ------------------------------------------------------------------ the far west end: where the money stopped
  private buildWestEnd() {
    const { b, A } = this;
    const x = WEST_END, y = trackY(x);
    // a torn-open end ring and cables hanging out of it
    b.add(M.flange(), this.ringX(x, y, R + 0.08, 0.12));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.2;
      b.add(M.dark(), wire(new THREE.Vector3(x - 0.1, y + Math.sin(a) * (R - 0.3), TZ + Math.cos(a) * (R - 0.3)), new THREE.Vector3(x - 1.5 - this.r() * 2, this.ground(x - 2, TZ) + 0.1, TZ + Math.cos(a) * 1.2), -0.5, 0.03, 10));
    }
    // two bare pylons beyond it, built for a tube that never came, rebar sprouting from the caps
    for (const px of [x - 12, x - 24]) {
      const g = Math.min(this.ground(px - 0.6, TZ), this.ground(px + 0.6, TZ));
      const capY = trackY(px) - R - 0.5;
      const h = Math.max(1.5, capY - g + 0.3);
      b.add(M.conc(), box(1.0, h, 0.85, px, g - 0.3 + h / 2, TZ));
      b.add(M.concDark(), box(2.2, 0.35, 1.4, px, g + 0.1, TZ));
      for (let i = 0; i < 6; i++) b.add(M.steel(), beam(new THREE.Vector3(px - 0.3 + (i % 3) * 0.3, g - 0.3 + h, TZ - 0.2 + Math.floor(i / 3) * 0.4), new THREE.Vector3(px - 0.35 + (i % 3) * 0.35 + this.r() * 0.2, g + h + 0.6 + this.r() * 0.6, TZ - 0.3 + Math.floor(i / 3) * 0.6), 0.025, 4));
      this.col(px, g - 0.3 + h / 2, TZ, 0.5, h / 2, 0.45);
    }
    // spare tube sections stacked on cribbing, and a sign
    const sx = x - 4, sz = TZ - 9;
    const sg = this.ground(sx, sz);
    for (const [ox, oy, oz] of [[0, 0, 0], [0, 0, 3.6], [0, 3.1, 1.8]] as const) {
      const g = new THREE.CylinderGeometry(R, R, 11, 24, 1, true);
      g.rotateZ(Math.PI / 2);
      g.translate(sx + ox, sg + R + 0.3 + oy, sz + oz);
      b.add(M.tube(), norm(g));
      b.add(M.tubeIn(), flipInside(norm(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 11, 24, 1, true).rotateZ(Math.PI / 2).translate(sx + ox, sg + R + 0.3 + oy, sz + oz))));
    }
    for (const ox of [-4, 0, 4]) b.add(M.concDark(), box(0.4, 0.3, 6.0, sx + ox, sg + 0.15, sz + 1.8));
    this.col(sx, sg + 2.2, sz + 1.8, 5.5, 2.2, 3.5);
    b.add(M.steel(), cyl(0.06, 0.06, 2.2, sx + 7, sg + 1.1, sz - 2, 6), cyl(0.06, 0.06, 2.2, sx + 8.6, sg + 1.1, sz - 2, 6));
    b.add(A.paint(), A.quad('future', 1.8, 0.5, sx + 7.8, sg + 2.0, sz - 1.96));
    this.pts.westEnd = new THREE.Vector3(x + 6, this.ground(x + 6, TZ - 5), TZ - 5);
  }

  // ------------------------------------------------------------------ the pod
  private buildPod() {
    const pb = new MeshBatch();
    const { half } = POD;
    const r = 1.3, cy = POD.y;
    const body = M.pod();
    // door gap on the platform side over the middle section
    const g0 = 2.32, g1 = 4.31;
    const sect = (a: number, c: number, gap: boolean, rad: number) => this.cylX(a, cy, c, cy, rad, 32, gap ? g1 : 0, gap ? Math.PI * 2 - (g1 - g0) : Math.PI * 2);
    for (const [a, c, gap] of [[-half, -0.85, false], [-0.85, 0.85, true], [0.85, half, false]] as const) {
      pb.add(body, sect(a, c, gap, r));
      pb.add(M.podIn(), flipInside(sect(a, c, gap, r - 0.04)));
    }
    for (const s of [-1, 1]) {
      const nose = new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      nose.scale(1, 1.35, 1);
      nose.rotateZ(-s * Math.PI / 2);
      nose.translate(s * half, cy, TZ);
      pb.add(body, norm(nose));
      const ring = this.ringX(s * half, cy, r + 0.01, 0.04);
      pb.add(M.flange(), ring);
      // the bulkhead you see from inside, carrying the brochure screen on the front one
      const bh = new THREE.CircleGeometry(r - 0.04, 28);
      bh.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
      bh.translate(s * (half - 0.02), cy, TZ);
      pb.add(M.podIn(), norm(bh));
    }
    // windows down the north side, the orange stripe, the gull-wing door standing open
    const win = this.cylX(-half + 0.3, cy, half - 0.3, cy, r + 0.005, 32, Math.PI * 2 - 0.47, 0.38);
    pb.add(M.glassDark(), win);
    pb.add(M.orange(), this.cylX(-half, cy, half, cy, r + 0.008, 40, 0.17, 0.07));
    pb.add(M.orange(), this.cylX(-half, cy, -0.9, cy, r + 0.008, 40, 2.9, 0.07), this.cylX(0.9, cy, half, cy, r + 0.008, 40, 2.9, 0.07));
    const door = new THREE.CylinderGeometry(r + 0.02, r + 0.02, 1.7, 16, 1, true, g0, g1 - g0);
    door.rotateZ(-Math.PI / 2);
    door.translate(0, 0, 0);
    // hinge along the crown: lift it up and over
    door.translate(0, -r, 0);
    door.rotateX(1.25);
    door.translate(0, cy + r, TZ);
    pb.add(body, norm(door), flipInside(norm(door.clone())));
    // sled and skis
    for (const oz of [-0.62, 0.62]) pb.add(M.dark(), box(half * 2 - 0.4, 0.14, 0.22, 0, cy - r - 0.02, TZ + oz));
    for (const ox of [-1.6, 1.6]) pb.add(M.flange(), box(0.5, 0.16, 1.5, ox, cy - r + 0.08, TZ));
    // inside: floor, two benches facing each other, the screen, an overhead bin and a gift bag
    const fl = POD.floor;
    const fw = 2 * Math.sqrt(r * r - (cy - fl) ** 2);
    pb.add(M.podIn(), box(half * 2 - 0.2, 0.06, fw, 0, fl - 0.03, TZ));
    pb.add(M.orange(), box(1.6, 0.012, fw - 0.4, 0, fl + 0.005, TZ));
    for (const s of [-1, 1]) {
      const sx = s * 1.75;
      // a two-seat bench: plinth, split cushions, a raked back, headrests, armrests
      pb.add(M.dark(), box(0.5, 0.28, fw - 0.35, sx, fl + 0.14, TZ));
      for (const oz of [-0.42, 0.42]) {
        pb.add(M.seat(), box(0.56, 0.13, 0.74, sx, fl + 0.34, TZ + oz));
        pb.add(M.seat(), box(0.14, 0.62, 0.72, sx + s * 0.3, fl + 0.72, TZ + oz, 0, 0, -s * 0.14));
        pb.add(M.seatOrange(), box(0.12, 0.2, 0.5, sx + s * 0.36, fl + 1.12, TZ + oz, 0, 0, -s * 0.14));
      }
      for (const oz of [-0.85, 0, 0.85]) pb.add(M.dark(), box(0.5, 0.05, 0.07, sx - s * 0.02, fl + 0.55, TZ + oz));
      // virtual windows: screens where windows would be, showing a beach that is being rendered
      for (const side of [-1, 1]) {
        if (side < 0 && Math.abs(sx) < 0.9) continue;
        pb.add(this.screenPower.m, this.A.quad('vwindow', 1.1, 0.42, sx, cy + 0.38, TZ + side * (r - 0.12), 0, side < 0 ? 0 : Math.PI, 0));
      }
    }
    pb.add(M.flange(), cyl(0.025, 0.025, 2.1, 0.0, fl + 1.05, TZ + 0.55, 6));
    pb.add(this.screenPower.m, this.A.quad('vwindow', 1.4, 0.42, 0, cy + 0.38, TZ + (r - 0.12), 0, Math.PI, 0));
    pb.add(M.dark(), box(0.05, 0.62, 1.0, half - 0.08, cy + 0.15, TZ));
    pb.add(this.screenPower.m, this.A.quad('brochure', 0.92, 0.52, half - 0.11, cy + 0.15, TZ, 0, -Math.PI / 2, 0));
    pb.add(M.white(), box(1.4, 0.24, 0.5, -1.5, cy + 0.85, TZ + 0.55));
    pb.add(M.seatOrange(), box(0.4, 0.3, 0.25, -1.75, fl + 0.57, TZ - 0.3));
    pb.add(M.orangeM(), box(0.3, 0.22, 0.38, half - 0.4, fl + 0.11, TZ + 0.4));
    // cove lights along the ceiling
    for (const s of [-1, 1]) this.slots.cove.add(pb, box(half * 2 - 0.6, 0.03, 0.04, 0, cy + 0.95, TZ + s * 0.7));
    const obj = pb.build('tube-pod', false, true);
    this.pod.add(obj);
    this.pod.name = 'tube-pod';
    // colliders that travel with it
    const add = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      this.podCols.push({ col: this.col(x, y, z, hx, hy, hz), local: new THREE.Vector3(x, y, z) });
    };
    add(0, fl - 0.1, TZ, half, 0.1, fw / 2);
    add(0, cy + 0.2, TZ + r - 0.1, half, 1.0, 0.12);
    add(-(half + 0.85) / 2, cy + 0.2, TZ - r + 0.1, (half - 0.85) / 2, 1.0, 0.12);
    add((half + 0.85) / 2, cy + 0.2, TZ - r + 0.1, (half - 0.85) / 2, 1.0, 0.12);
    add(-half - 0.1, cy, TZ, 0.15, r, r);
    add(half + 0.1, cy, TZ, 0.15, r, r);
    add(0, cy + r + 0.05, TZ, half, 0.1, r);
    add(-1.75, fl + 0.21, TZ, 0.28, 0.21, fw / 2 - 0.15);
    add(1.75, fl + 0.21, TZ, 0.28, 0.21, fw / 2 - 0.15);
    this.pts.podScreen = new THREE.Vector3(half - 1.0, fl, TZ);
    this.pts.podBin = new THREE.Vector3(-1.0, fl, TZ);
    this.pts.podIn = new THREE.Vector3(0, fl, TZ);
  }

  /** Move the pod (and its colliders) along the track by `dx` from its rest position. */
  setPod(dx: number) {
    this.pod.position.x = dx;
    for (const c of this.podCols) {
      const w = this.frame.p(c.local.x + dx, c.local.y, c.local.z);
      c.col.setTranslation({ x: w.x, y: w.y, z: w.z });
    }
  }

  // ------------------------------------------------------------------ the loop tower: LOOPR's two rings on a mast
  private buildTower() {
    const { b } = this;
    const tx = -19.5, tz = -11.5, g = this.ground(tx, tz), H = 22;
    b.add(M.concDark(), box(2.4, 0.5, 2.4, tx, g + 0.15, tz));
    const st = M.white();
    for (const [ox, oz] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]) {
      b.add(st, beam(new THREE.Vector3(tx + ox * 2, g + 0.3, tz + oz * 2), new THREE.Vector3(tx + ox * 0.6, g + H, tz + oz * 0.6), 0.09, 6));
    }
    for (let k = 1; k < 8; k++) {
      const t = k / 8, w = THREE.MathUtils.lerp(0.9, 0.27, t), y = g + 0.3 + t * (H - 0.3);
      b.add(M.steel(), box(w * 2, 0.08, 0.08, tx, y, tz - w), box(w * 2, 0.08, 0.08, tx, y, tz + w), box(0.08, 0.08, w * 2, tx - w, y, tz), box(0.08, 0.08, w * 2, tx + w, y, tz));
    }
    this.col(tx, g + 3, tz, 0.9, 3, 0.9);
    // the two loops, painted orange, each lined with a light ring that comes on at night
    const cy = g + H + 1.9;
    for (const ox of [-1.25, 1.25]) {
      const ring = place(new THREE.TorusGeometry(1.5, 0.22, 10, 40), tx + ox, cy, tz, 0, 0, 0);
      b.add(M.orangeM(), ring);
      this.slots.loop.add(this.d, place(new THREE.TorusGeometry(1.5, 0.06, 6, 40), tx + ox, cy, tz - 0.2), place(new THREE.TorusGeometry(1.5, 0.06, 6, 40), tx + ox, cy, tz + 0.2));
      this.farGlow.add(glow('#ff7a2a', 3).material, place(new THREE.TorusGeometry(1.5, 0.22, 6, 24), tx + ox, cy, tz));
      for (const s of [-1, 1]) this.halo(tx + ox, cy, tz + s * 0.5, '#ff8a3a', 4.6, CH.NIGHT, 0.35);
    }
    b.add(M.white(), box(0.6, 1.2, 0.6, tx, g + H + 0.3, tz));
    this.slots.red.add(this.d, place(new THREE.SphereGeometry(0.16, 8, 6), tx, cy + 1.85, tz));
    b.add(M.steel(), cyl(0.04, 0.04, 1.6, tx, cy + 1.0, tz, 5));
    this.halo(tx, cy + 1.9, tz, '#ff2a1a', 2.0, CH.RED, 2.5);
  }

  // ------------------------------------------------------------------ billboard on the approach
  private buildBillboard() {
    const { b, A } = this;
    const bx = -6, bz = -26;
    const g = this.ground(bx, bz);
    const w = 12, h = 6, y0 = g + 5.5;
    for (const ox of [-3.5, 3.5]) {
      b.add(M.steel(), box(0.35, y0 + 0.2 - g, 0.35, bx + ox, (y0 + g) / 2, bz + 0.4));
      this.col(bx + ox, (y0 + g) / 2, bz + 0.4, 0.2, (y0 - g) / 2, 0.2);
      b.add(M.concDark(), box(1.0, 0.4, 1.0, bx + ox, g + 0.1, bz + 0.4));
    }
    b.add(M.steel(), box(w + 0.4, h + 0.4, 0.25, bx, y0 + h / 2, bz + 0.2));
    b.add(A.paint(), A.quad('billboard', w, h, bx, y0 + h / 2, bz + 0.06, 0, Math.PI, 0));
    b.add(M.galv(), box(w, 0.06, 0.8, bx, y0 - 0.1, bz - 0.2));
    for (const ox of [-4, 0, 4]) {
      b.add(M.dark(), box(0.3, 0.2, 0.4, bx + ox, y0 - 0.05, bz - 0.9), beam(new THREE.Vector3(bx + ox, y0 - 0.1, bz - 0.2), new THREE.Vector3(bx + ox, y0 - 0.05, bz - 0.9), 0.03, 4));
      this.slots.night.add(this.d, box(0.26, 0.03, 0.3, bx + ox, y0 + 0.05, bz - 0.9));
      this.halo(bx + ox, y0 + 0.1, bz - 0.95, '#ffe2bc', 0.9, CH.NIGHT, 1.5);
    }
    this.d.add(this.poolNight.m, A.quad('washWarm', w * 1.05, h * 1.0, bx, y0 + h / 2 + 0.2, bz + 0.04, Math.PI, 0, 0));
  }
}
