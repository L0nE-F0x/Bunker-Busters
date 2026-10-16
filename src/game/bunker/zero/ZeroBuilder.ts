import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, norm, MeshBatch, DistanceLod, shadowProxy } from '../../world/kit';
import { surfaces } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, fabric, wood, desertRock } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { LiveScreen } from '../apex/apexAtlas';
import { zeroPrint, zeroPrintMaterial, paintClock } from './zeroAtlas';
import { ZERO_DEPTH } from '@/content/bunkers/zero';
import type { BunkerShell, Door, LootSpot, SecurityCamera, Tripwire, Laser } from '../shell';

/**
 * Bunker Zero, under the forecourt of Last Chance Gas. Local metres, origin on the manway's collar
 * (the forecourt slab's top), axes as the world's (north is −z). Everything below is FY under it.
 *
 * - The manway on the forecourt: a concrete collar, a hinged steel lid painted DIESEL, a dial padlock,
 *   three fill caps and a vent pipe. Nothing goes through the ground: the ladder is a climb (the
 *   runtime fades and moves you), so the terrain needs no hole.
 * - The ladder's foot (x ±2.5, z −2…3): the shaft over the ladder, and the 1961 door in the north wall.
 * - A short passage north into the showroom (x ±6, z −5…−45, 5.2 m): displays down both walls, one per
 *   founder, each a full-size door on a plinth under its bay board, with a placard. The clock gate
 *   across it at z −25. Tin-can tripwires and a camera in the first half; the laser grid and two cameras
 *   in the second. The board room (Kit's bay) off the east wall at the end.
 * - Model Zero in the north wall: a round door three metres across, seven cylinders round its rim
 *   and one in the middle, a lamp by each.
 * - The well hall (r 10 round (0, −57), 7 m): the wellhead in the middle, the cistern on the west, the
 *   stores on the east, Agnes's office in a glass booth to the north-east. The dormitory runs north
 *   from it (x ±3, to z −92): triple bunks down both walls into the dark.
 */
export const ZB = {
  FY: -ZERO_DEPTH,
  FOOT: [-2.5, 2.5, -2, 3] as const, FOOT_H: 3.2,
  PASS: 1.2, PASS_H: 2.7,
  SHOW_X: 6, SHOW_Z0: -5, SHOW_Z1: -45, SHOW_H: 5.2,
  GATE_Z: -25, GATE: 1.3, GATE_H: 3.0,
  BOARD: [6, 11.5, -44.4, -38.6] as const, BOARD_H: 3.2, BOARD_DOOR: [-42.6, -40.2] as const,
  ZERO_R: 1.6, ZERO_CY: 1.75, TUN_Z: -47.6,
  WELL_Z: -57, WELL_R: 10, WELL_H: 7,
  DORM: [-3, 3, -92, -66.6] as const, DORM_H: 3.0,
  OFFICE: [2.5, 7, -63.5, -59.5] as const, OFFICE_H: 2.7,
  /** The whole dig (local x0, x1, z0, z1). */
  DIG: [-7.5, 12, -93, 3.6] as const,
};

/** The founders in Model Zero's order, round the rim from the top (their bunkers' ids, and plates). */
export const CYLINDERS: { id: string; plate: string }[] = [
  { id: 'garage', plate: 'pPIVOTSON' }, { id: 'apex', plate: 'pKADE' }, { id: 'panopticon', plate: 'pSEYMOUR' },
  { id: 'spire', plate: 'pASHBY' }, { id: 'dome', plate: 'pVALE' }, { id: 'cathedral', plate: 'pSAYLE' }, { id: 'fortress', plate: 'pSZABO' },
];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
const deg = THREE.MathUtils.degToRad;

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

type Mats = ReturnType<ZeroBuilder['mats']>;

export class ZeroBuilder implements BunkerShell {
  readonly group = new THREE.Group();
  readonly origin: THREE.Vector3;
  readonly points: Record<string, THREE.Vector3> = {};
  readonly doors: Record<string, Door> = {};
  readonly innerBox: THREE.Box3;
  readonly groundsBox: THREE.Box3;
  readonly tripwires: Tripwire[] = [];
  readonly lasers: Laser[] = [];
  readonly cameras: SecurityCamera[] = [];
  readonly lootSpots: LootSpot[] = [];
  readonly lockMeshes: Record<string, THREE.Object3D> = {};
  /** Everything under the ground: drawn only while the camera is down there (`Bunker.cull`). */
  readonly interior = new THREE.Group();
  lod!: DistanceLod;
  readonly pal = new GlowPalette(48);
  readonly halos = new GlowSprites(12);
  static readonly CH = { ON: 0, SHOW: 1, ZERO: 2, WELL: 3 };
  /** The flip clock over the gate. */
  clock!: LiveScreen;
  /** The manway's lid (the runtime turns it with its door's `open`) and what shows once it's up. */
  lid!: THREE.Object3D;
  hole!: THREE.Object3D;
  /** The standpipe on the forecourt (shown after the open ending) and the camp's padlock (keep). */
  standpipe!: THREE.Object3D;
  campLock!: THREE.Object3D;
  /** The work lamp over the manway once it's open for good. */
  hatchLamp!: VirtualLight;
  /** The red handle on the wellhead (thrown in the open ending). */
  handle!: THREE.Object3D;
  lights!: { foot: VirtualLight; show: VirtualLight[]; board: VirtualLight; zero: VirtualLight; hall: VirtualLight; office: VirtualLight; dorm: VirtualLight[] };
  readonly slots: Record<'trough' | 'bays' | 'exit' | 'boardWarn' | 'clockLamp' | 'well' | 'office' | 'dorm' | 'lamp' | 'surface', { value: number }> = {} as never;
  /** Model Zero's lamps by cylinder (7 founders, then ZERO): green and red. */
  readonly cylOk: { value: number }[] = [];
  readonly cylNo: { value: number }[] = [];
  /** The board's five lamps (cameras, grid, doormen, lights, Model Zero). */
  readonly boardLamps: { value: number }[] = [];
  /** Agnes at her drafting table (local to `interior`). */
  agnesSpot!: { x: number; y: number; z: number; yaw: number };
  /** The Doormen's routes (world), by id. */
  readonly routes: Record<string, THREE.Vector3[]> = {};
  /** The bays' placards (world): where you read them. */
  readonly bayPoints: Record<string, THREE.Vector3> = {};
  /** Where Agnes's PA can be heard from, down there (the runtime moves `points.speaker` to the nearest). */
  readonly speakers: THREE.Vector3[] = [];

  constructor(private physics: Physics, origin: THREE.Vector3) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'zero';
    this.interior.name = 'zero-under';
    const [x0, x1, z0, z1] = ZB.DIG;
    this.innerBox = new THREE.Box3(this.w(x0, ZB.FY - 1, z0), this.w(x1, ZB.FY + ZB.WELL_H + 1, z1));
    this.groundsBox = new THREE.Box3(this.w(-6, -2, -6), this.w(6, 6, 6));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** Down there (anywhere in the dig, well under the forecourt). */
  contains(p: THREE.Vector3, margin = 0) {
    const [x0, x1, z0, z1] = ZB.DIG;
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    return y < ZB.FY + ZB.WELL_H + 2 && y > ZB.FY - 3 && x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin;
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** A wall along z at x (its inner face at x, thickness going `out` (±1)), with a collider. */
  private wallX(b: MeshBatch, mat: THREE.Material, x: number, out: number, za: number, zb: number, y0: number, y1: number, t = 0.4) {
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    if (z1 - z0 < 0.01) return;
    const cx = x + out * t / 2;
    b.add(mat, box(t, y1 - y0, z1 - z0, cx, (y0 + y1) / 2, (z0 + z1) / 2));
    this.col(cx, (y0 + y1) / 2, (z0 + z1) / 2, t / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  }

  /** A wall along x at z (inner face at z, thickness going `out`). */
  private wallZ(b: MeshBatch, mat: THREE.Material, z: number, out: number, xa: number, xb: number, y0: number, y1: number, t = 0.4) {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    if (x1 - x0 < 0.01) return;
    const cz = z + out * t / 2;
    b.add(mat, box(x1 - x0, y1 - y0, t, (x0 + x1) / 2, (y0 + y1) / 2, cz));
    this.col((x0 + x1) / 2, (y0 + y1) / 2, cz, (x1 - x0) / 2, (y1 - y0) / 2, t / 2);
  }

  /** A sliding leaf along x at z (the runtime moves `pivot.position.x` from `userData.x0`). */
  private slideDoor(id: string, a0: number, a1: number, y0: number, at: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void, parent: THREE.Object3D) {
    const pivot = new THREE.Group();
    pivot.position.set(a0, y0, at);
    pivot.userData.x0 = a0;
    const lb = new MeshBatch();
    leaf(lb, a1 - a0);
    pivot.add(lb.build(`zeroDoor:${id}`));
    parent.add(pivot);
    const pos = this.w((a0 + a1) / 2, y0 + h / 2, at), half = V(Math.abs(a1 - a0) / 2, h / 2, 0.2);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount, colliderSpec: { pos, half } };
    return pivot;
  }

  private build() {
    const m = this.mats();
    this.clock = new LiveScreen(512, 192, (c, w, h) => paintClock(c, w, h, '0000'));
    this.clock.repaint();
    const sb = new MeshBatch();
    this.buildSurface(sb, m);
    const b = new MeshBatch();
    const FY = ZB.FY;
    this.buildFoot(b, m);
    this.buildShowroom(b, m);
    this.buildBays(b, m);
    this.buildGate(b, m);
    this.buildBoardRoom(b, m);
    this.buildZeroDoor(b, m);
    this.buildWellHall(b, m);
    this.buildOffice(b, m);
    this.buildDorm(b, m);
    this.buildRoutes();
    this.buildLights();
    // one floor under the whole dig
    const [x0, x1, z0, z1] = ZB.DIG;
    this.col((x0 + x1) / 2, FY - 0.25, (z0 + z1) / 2, (x1 - x0) / 2, 0.25, (z1 - z0) / 2);
    surfaces.zone(this.w(x0, FY - 1, z0), this.w(x1, FY + ZB.WELL_H, z1), 'concrete');
    surfaces.zone(this.w(-1, -0.5, -1), this.w(1, 1, 1), 'metal');

    const under = b.build('zeroUnder');
    under.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mesh.isMesh && mat && (mat.transparent || mat === m.print)) mesh.castShadow = false;
    });
    shadowProxy(under);
    this.interior.add(under, this.halos.build());
    for (const d of Object.values(this.doors)) d.pivot.traverse((o) => { o.castShadow = false; });
    for (const c of this.cameras) c.pivot.traverse((o) => { o.castShadow = false; });
    this.group.add(this.interior);

    const surface = sb.build('zeroSurface');
    shadowProxy(surface);
    const near = new THREE.Group();
    near.name = 'zero-surface';
    near.add(surface, this.lid, this.hole, this.standpipe, this.campLock);
    this.group.add(near);
    this.lod = new DistanceLod(this.origin.clone(), 4, near, null, 140, 150);
  }

  private mats() {
    return {
      wall: concrete('#a39c8e', { scale: 0.7, stains: 0.35 }),
      rock: desertRock(),
      ceil: concrete('#6e6a62', { scale: 0.6, stains: 0.6 }),
      floor: concrete('#8b857a', { scale: 1.3, stains: 0.3 }),
      collar: concrete('#a39a8c', { stains: 0.8 }),
      enamel: plainStandard('#2e4a3c', 0.45, 0.1),
      cream: plainStandard('#d8cfb6', 0.75, 0),
      brass: plainStandard('#c9a24a', 0.32, 0.85),
      steel: plainStandard('#a9b1b7', 0.35, 0.85),
      gunmetal: plainStandard('#4b5157', 0.4, 0.7),
      dark: plainStandard('#141413', 0.6, 0.2),
      black: new THREE.MeshBasicNodeMaterial({ color: '#000000' }),
      white: plainStandard('#e2ddd2', 0.6, 0.05),
      red: plainStandard('#b8321e', 0.55, 0.2),
      orange: plainStandard('#d8681e', 0.6, 0.2),
      yellow: plainStandard('#e0b020', 0.6, 0.1),
      olive: plainStandard('#5c6146', 0.7, 0.2),
      lid: rustyMetal({ base: '#6b6a64', rust: 0.55, metalness: 0.6 }),
      old: rustyMetal({ base: '#5f6b62', rust: 0.45, metalness: 0.5 }),
      pipe: rustyMetal({ base: '#9a9c96', rust: 0.3, metalness: 0.7 }),
      glass: plainStandard('#a8c6d0', 0.06, 0.2, { transparent: true, opacity: 0.16, depthWrite: false }),
      mattress: fabric('#8d8a78'),
      blanket: fabric('#56624c'),
      grey: fabric('#6d6c66'),
      wood: wood('#7a5a3a'),
      table: wood('#a07e56'),
      print: zeroPrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the forecourt: manway, caps, vent
  private buildSurface(b: MeshBatch, m: Mats) {
    // the collar: a low concrete box round the manway, the lid on a hinge at its north edge
    b.add(m.collar, box(1.6, 0.3, 1.6, 0, 0.15, 0));
    // a band of yellow round the rim (the hole shows through the middle when the lid's up)
    b.add(m.yellow, box(1.62, 0.04, 0.26, 0, 0.29, -0.68), box(1.62, 0.04, 0.26, 0, 0.29, 0.68), box(0.26, 0.04, 1.1, -0.68, 0.29, 0), box(0.26, 0.04, 1.1, 0.68, 0.29, 0));
    this.col(0, 0.15, 0, 0.8, 0.15, 0.8);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.31, -0.56);
    const lb = new MeshBatch();
    lb.add(m.lid, box(1.14, 0.06, 1.14, 0, 0.03, 0.57));
    for (let k = 0; k < 5; k++) lb.add(m.lid, box(1.0, 0.012, 0.04, 0, 0.066, 0.17 + k * 0.2));
    lb.add(m.print, zeroPrint('manway', 0.82, 0.82, M(0, 0.07, 0.57, 0, -Math.PI / 2)));
    lb.add(m.steel, box(0.12, 0.08, 0.06, 0, 0.04, 1.13));
    pivot.add(lb.build('zeroLid'));
    this.lid = pivot;
    const cpos = this.w(0, 0.35, 0), chalf = V(0.55, 0.05, 0.55);
    this.doors.hatch = { pivot, open: 0, target: 0, collider: this.physics.addBox(cpos, chalf), axis: 'slide', amount: 0, colliderSpec: { pos: cpos, half: chalf } };
    // the hasp and the dial padlock (gone once it's open)
    b.add(m.steel, box(0.14, 0.12, 0.05, 0, 0.3, 0.82));
    const lock = new MeshBatch();
    lock.add(m.brass, box(0.12, 0.13, 0.05, 0, 0.18, 0.86), place(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), 0, 0.25, 0.86));
    lock.add(m.dark, box(0.1, 0.03, 0.052, 0, 0.17, 0.865));
    const padlock = lock.build('zeroPadlock');
    this.lockMeshes.padlock = padlock;
    this.group.add(padlock);
    // what you see down the hole when the lid's up: dark, and the ladder's top
    const hb = new MeshBatch();
    hb.add(m.black, box(1.08, 0.012, 1.08, 0, 0.306, 0));
    for (const s of [-1, 1]) hb.add(m.steel, box(0.05, 0.9, 0.05, s * 0.24, 0.55, 0.42));
    hb.add(m.steel, box(0.5, 0.04, 0.04, 0, 0.75, 0.42), box(0.5, 0.04, 0.04, 0, 0.45, 0.42));
    this.hole = hb.build('zeroHole');
    this.hole.visible = false;
    // three fill caps and the vent pipe (Zero's air has been coming out of it for three years)
    for (const [x, z] of [[-1.5, -0.4], [-1.5, 0.4], [-2.2, 0]]) b.add(m.yellow, cyl(0.14, 0.14, 0.08, x, 0.04, z, 12)), b.add(m.dark, cyl(0.06, 0.06, 0.09, x, 0.05, z, 8));
    b.add(m.pipe, cyl(0.06, 0.06, 2.0, 1.5, 1.0, 0.6, 8), cyl(0.16, 0.06, 0.18, 1.5, 2.08, 0.6, 10));
    this.col(1.5, 1.0, 0.6, 0.08, 1.0, 0.08);
    this.points.hatch = this.w(0, 0.9, 1.1);
    this.points.surfaceOut = this.w(0.6, 0, 2.0);
    this.points.vent = this.w(1.5, 2.0, 0.6);
    // the standpipe (the open ending): a riser off the vent line with a tap and a trough
    const st = new MeshBatch();
    st.add(m.red, cyl(0.07, 0.07, 1.1, 2.6, 0.55, 1.6, 8), box(0.3, 0.05, 0.05, 2.6, 1.05, 1.75));
    st.add(m.steel, box(0.9, 0.3, 0.45, 2.6, 0.15, 2.05));
    st.add(plainStandard('#3d6a72', 0.05, 0.3), box(0.8, 0.02, 0.36, 2.6, 0.29, 2.05));
    st.add(m.pipe, beam(V(1.55, 0.05, 0.75), V(2.55, 0.05, 1.55), 0.05, 6));
    this.points.standpipe = this.w(2.6, 0.9, 2.5);
    // Mara's padlock (the keep ending): a new chain through the hasp
    const cl = new MeshBatch();
    cl.add(m.steel, box(0.1, 0.12, 0.05, 0.1, 0.18, 0.86), place(new THREE.TorusGeometry(0.05, 0.014, 6, 12), 0.1, 0.26, 0.86));
    for (let k = 0; k < 4; k++) cl.add(m.gunmetal, place(new THREE.TorusGeometry(0.04, 0.01, 4, 8), -0.05 - k * 0.06, 0.28 - k * 0.02, 0.86, 0, k % 2 ? Math.PI / 2 : 0));
    // ...and a padlocked crate on the slab beside it: the camp's daily share from the stores
    cl.add(m.wood, box(0.7, 0.5, 0.5, -1.5, 0.25, 1.4, 0.2));
    cl.add(m.steel, box(0.08, 0.1, 0.03, -1.47, 0.42, 1.66, 0.2));
    this.points.share = this.w(-1.5, 0.9, 1.9);
    this.campLock = cl.build('zeroCampLock');
    this.campLock.visible = false;
    // a work lamp on a pole over the manway goes up with the standpipe (the open ending)
    st.add(m.steel, box(0.04, 1.6, 0.04, 0.9, 0.8, 1.2));
    const lamp = this.pal.slot('#ffd9a0', 0);
    this.slots.surface = lamp.intensity;
    lamp.add(st, box(0.16, 0.08, 0.1, 0.9, 1.62, 1.12));
    this.standpipe = st.build('zeroStandpipe');
    this.standpipe.visible = false;
    this.hatchLamp = new VirtualLight('#ffd9a0', 0, 7, 1.6);
    this.hatchLamp.position.copy(this.w(0.6, 1.8, 1.0));
    this.hatchLamp.priority = 1;
  }

  // ------------------------------------------------------------------ the ladder's foot and the 1961 door
  private buildFoot(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, [x0, x1, z0, z1] = ZB.FOOT, H = ZB.FOOT_H;
    this.wallX(b, m.wall, x0, -1, z0, z1, FY, FY + H);
    this.wallX(b, m.wall, x1, 1, z0, z1, FY, FY + H);
    this.wallZ(b, m.wall, z1, 1, x0 - 0.4, x1 + 0.4, FY, FY + H);
    // the north wall, with the door in it (1.6 × 2.0)
    this.wallZ(b, m.wall, z0, -1, x0 - 0.4, -0.8, FY, FY + H);
    this.wallZ(b, m.wall, z0, -1, 0.8, x1 + 0.4, FY, FY + H);
    this.wallZ(b, m.wall, z0, -1, -0.8, 0.8, FY + 2.0, FY + H);
    b.add(m.floor, place(new THREE.PlaneGeometry(x1 - x0, z1 - z0), 0, FY + 0.01, (z0 + z1) / 2, -Math.PI / 2));
    // the ceiling, with the shaft's square in it over the ladder
    b.add(m.ceil, box(x1 - x0 + 0.8, 0.3, 1.4 - (z0 - 0.4), 0, FY + H + 0.15, (z0 - 0.4 + 1.4) / 2), box(x1 - x0 + 0.8, 0.3, 0.6, 0, FY + H + 0.15, 3.1));
    b.add(m.ceil, box(2.15, 0.3, 1.4, -1.825, FY + H + 0.15, 2.1), box(2.15, 0.3, 1.4, 1.825, FY + H + 0.15, 2.1));
    // the shaft: four walls up into the dark, then a black cap
    const sz0 = 1.4, sz1 = 2.8;
    for (const s of [-1, 1]) b.add(m.rock, box(0.3, 6, sz1 - sz0 + 0.6, s * 0.9, FY + H + 3, (sz0 + sz1) / 2));
    b.add(m.rock, box(2.1, 6, 0.3, 0, FY + H + 3, sz0 - 0.15), box(2.1, 6, 0.3, 0, FY + H + 3, sz1 + 0.15));
    b.add(m.black, box(1.6, 0.1, 1.6, 0, FY + H + 5.8, (sz0 + sz1) / 2));
    // the ladder: rails and sixty rungs' worth of the bottom of them
    for (const s of [-1, 1]) b.add(m.steel, box(0.05, H + 5.6, 0.06, s * 0.24, FY + (H + 5.6) / 2, 2.62));
    for (let y = 0.3; y < H + 5.4; y += 0.3) b.add(m.steel, cyl(0.016, 0.016, 0.48, 0, FY + y, 2.6, 5, 0, 0, Math.PI / 2));
    b.add(m.print, zeroPrint('ladder', 0.6, 0.3, M(-1.0, FY + 1.7, z1 - 0.02, Math.PI)));
    this.points.foot = this.w(0, FY + 0.05, 1.2);
    this.points.up = this.w(0, FY + 1.2, 1.9);
    // the room: a bulb in a cage, a fallout sign, a bench, water drums from 1961
    b.add(m.print, zeroPrint('fallout', 0.7, 0.7, M(x1 - 0.02, FY + 1.7, 0.6, -Math.PI / 2)));
    b.add(m.old, cyl(0.3, 0.3, 0.9, -1.9, FY + 0.45, -1.3, 12), cyl(0.3, 0.3, 0.9, -1.9, FY + 0.45, -0.6, 12));
    this.col(-1.9, FY + 0.45, -0.95, 0.3, 0.45, 0.65);
    b.add(m.wood, box(0.4, 0.06, 1.6, 2.1, FY + 0.45, 1.0), box(0.06, 0.45, 0.4, 2.1, FY + 0.22, 0.4), box(0.06, 0.45, 0.4, 2.1, FY + 0.22, 1.6));
    const lamp = this.pal.slot('#ffcf8a', 3);
    this.slots.lamp = lamp.intensity;
    lamp.add(b, place(new THREE.SphereGeometry(0.07, 8, 6), 0, FY + H - 0.25, 0.4));
    b.add(m.dark, cyl(0.1, 0.1, 0.18, 0, FY + H - 0.2, 0.4, 6));
    // the 1961 door: steel, rivets, a wheel; it swings north into the passage
    const pivot = new THREE.Group();
    pivot.position.set(-0.8, FY, z0);
    const lb = new MeshBatch();
    lb.add(m.old, box(1.6, 2.0, 0.16, 0.8, 1.0, 0));
    for (let k = 0; k < 5; k++) for (const y of [0.15, 1.85]) lb.add(m.steel, cyl(0.025, 0.025, 0.04, 0.2 + k * 0.3, y, 0.09, 6, Math.PI / 2));
    lb.add(m.steel, place(new THREE.TorusGeometry(0.24, 0.03, 6, 18), 0.8, 1.1, 0.13), cyl(0.04, 0.04, 0.12, 0.8, 1.1, 0.1, 6, Math.PI / 2));
    for (let k = 0; k < 3; k++) lb.add(m.steel, box(0.46, 0.025, 0.025, 0.8, 1.1, 0.13, 0, 0, (k * Math.PI) / 3));
    lb.add(m.print, zeroPrint('door61', 0.6, 0.22, M(0.8, 0.45, 0.09)));
    pivot.add(lb.build('zeroDoor61'));
    this.interior.add(pivot);
    const dpos = this.w(0, FY + 1.0, z0 - 0.05), dhalf = V(0.8, 1.0, 0.12);
    this.doors.door61 = { pivot, open: 0, target: 0, collider: this.physics.addBox(dpos, dhalf), axis: 'y', amount: 1.6, colliderSpec: { pos: dpos, half: dhalf } };
    b.add(m.steel, box(1.8, 0.12, 0.3, 0, FY + 2.06, z0 - 0.05), box(0.1, 2.0, 0.3, -0.85, FY + 1.0, z0 - 0.05), box(0.1, 2.0, 0.3, 0.85, FY + 1.0, z0 - 0.05));
    this.points.door61 = this.w(0, FY + 1.2, z0 + 1.0);
    this.speakers.push(this.w(0, FY + 2.8, 0));
    // the passage north to the showroom
    const P = ZB.PASS, PH = ZB.PASS_H;
    this.wallX(b, m.wall, -P, -1, z0 - 0.4, ZB.SHOW_Z0, FY, FY + PH);
    this.wallX(b, m.wall, P, 1, z0 - 0.4, ZB.SHOW_Z0, FY, FY + PH);
    b.add(m.floor, place(new THREE.PlaneGeometry(P * 2, -ZB.SHOW_Z0 + z0), 0, FY + 0.01, (z0 + ZB.SHOW_Z0) / 2, -Math.PI / 2));
    b.add(m.ceil, box(P * 2 + 0.8, 0.3, z0 - 0.4 - ZB.SHOW_Z0, 0, FY + PH + 0.15, (z0 - 0.4 + ZB.SHOW_Z0) / 2));
  }

  // ------------------------------------------------------------------ the showroom's shell
  private buildShowroom(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, X = ZB.SHOW_X, Z0 = ZB.SHOW_Z0, Z1 = ZB.SHOW_Z1, H = ZB.SHOW_H;
    const [bd0, bd1] = ZB.BOARD_DOOR;
    // the walls (cream), with the board room's doorway in the east wall and Model Zero's in the north
    this.wallX(b, m.cream, -X, -1, Z0 + 0.4, Z1 - 0.4, FY, FY + H);
    this.wallX(b, m.cream, X, 1, Z0 + 0.4, bd1, FY, FY + H);
    this.wallX(b, m.cream, X, 1, bd0, Z1 - 0.4, FY, FY + H);
    this.wallX(b, m.cream, X, 1, bd1, bd0, FY + 2.5, FY + H);
    this.wallZ(b, m.cream, Z0, 1, -X - 0.4, -ZB.PASS, FY, FY + H);
    this.wallZ(b, m.cream, Z0, 1, ZB.PASS, X + 0.4, FY, FY + H);
    this.wallZ(b, m.cream, Z0, 1, -ZB.PASS, ZB.PASS, FY + ZB.PASS_H, FY + H);
    const R = ZB.ZERO_R + 0.1;
    this.wallZ(b, m.cream, Z1, -1, -X - 0.4, -R, FY, FY + H);
    this.wallZ(b, m.cream, Z1, -1, R, X + 0.4, FY, FY + H);
    this.wallZ(b, m.cream, Z1, -1, -R, R, FY + ZB.ZERO_CY + R, FY + H);
    // an enamel wainscot and a brass rail all round; the floor; the ceiling and its light troughs
    const wain = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      b.add(m.enamel, box(len, 1.2, 0.03, (x0 + x1) / 2, FY + 0.6, (z0 + z1) / 2, yaw));
      b.add(m.brass, box(len, 0.05, 0.05, (x0 + x1) / 2, FY + 1.22, (z0 + z1) / 2, yaw));
    };
    wain(-X + 0.02, Z0, -X + 0.02, Z1);
    wain(X - 0.02, Z0, X - 0.02, bd1);
    wain(X - 0.02, bd0, X - 0.02, Z1);
    wain(-X, Z0 - 0.02, -ZB.PASS, Z0 - 0.02);
    wain(ZB.PASS, Z0 - 0.02, X, Z0 - 0.02);
    wain(-X, Z1 + 0.02, -R, Z1 + 0.02);
    wain(R, Z1 + 0.02, X, Z1 + 0.02);
    b.add(m.floor, place(new THREE.PlaneGeometry(X * 2, Z0 - Z1), 0, FY + 0.01, (Z0 + Z1) / 2, -Math.PI / 2));
    b.add(m.ceil, box(X * 2 + 0.8, 0.3, Z0 - Z1 + 0.8, 0, FY + H + 0.15, (Z0 + Z1) / 2));
    const trough = this.pal.slot('#fff0d0', 2.4);
    this.slots.trough = trough.intensity;
    for (const x of [-2.6, 2.6]) {
      b.add(m.dark, box(0.5, 0.12, Z0 - Z1 - 1, x, FY + H - 0.06, (Z0 + Z1) / 2));
      for (let z = Z0 - 1.5; z > Z1 + 1; z -= 3.2) trough.add(b, box(0.3, 0.02, 2.4, x, FY + H - 0.13, z));
    }
    // a rubber runner down the middle, and the showroom's board over the passage
    b.add(m.dark, box(2.2, 0.012, Z0 - Z1 - 1.2, 0, FY + 0.02, (Z0 + Z1) / 2));
    b.add(m.print, zeroPrint('showroom', 4.0, 1.0, M(0, FY + 3.6, Z0 - 0.02)));
    // exit signs (green) over the passage and by Model Zero
    const exit = this.pal.slot('#4fe08a', 2.2);
    this.slots.exit = exit.intensity;
    exit.add(b, box(0.5, 0.18, 0.04, 0, FY + 2.95, Z0 - 0.04), box(0.04, 0.18, 0.5, -X + 0.04, FY + 2.6, Z1 + 3));
    this.speakers.push(this.w(0, FY + 4.5, -12), this.w(0, FY + 4.5, -33));
    // the first half's tin-can tripwires (Tanner's), each its own little set
    const r = rng(5);
    const stake = wood('#3a2a1c'), can = plainStandard('#9a9790', 0.45, 0.7);
    const wireMat = plainStandard('#d8d2c4', 0.4, 0.6);
    for (const [id, z] of [['w1', -6.6], ['w2', -11.5], ['w3', -16.8]] as [string, number][]) {
      const a = V(-X + 0.15, FY + 0.22, z), c = V(X - 0.15, FY + 0.22, z);
      const tb = new MeshBatch();
      tb.add(stake, cyl(0.025, 0.03, 0.5, a.x, FY + 0.2, z, 5), cyl(0.025, 0.03, 0.5, c.x, FY + 0.2, z, 5));
      tb.add(wireMat, beam(a, c, 0.006, 3));
      for (let i = 0; i < 4; i++) {
        const p = a.clone().lerp(c, 0.15 + i * 0.23 + r() * 0.05);
        tb.add(can, cyl(0.035, 0.035, 0.12, p.x, FY + 0.12 + (i % 2) * 0.03, p.z, 8));
      }
      const mesh = tb.build(`zeroWire:${id}`);
      mesh.traverse((o) => { o.castShadow = false; });
      this.interior.add(mesh);
      this.tripwires.push({ id, a: this.w(a.x, a.y, a.z), b: this.w(c.x, c.y, c.z), mesh, armed: true });
    }
    // the second half's laser grid (Prudence's), past the clock gate; its junction box on the west wall
    const lm = new THREE.MeshBasicNodeMaterial({ color: '#ff3030', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    ([[-28, 0.45], [-28, 1.25], [-30.2, 0.45], [-30.2, 1.6]] as [number, number][]).forEach(([z, y], i) => {
      const g = new THREE.CylinderGeometry(0.008, 0.008, X * 2 - 0.3, 4);
      g.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(g, lm);
      mesh.position.set(0, FY + y, z);
      mesh.castShadow = false;
      mesh.renderOrder = 21;
      this.interior.add(mesh);
      this.lasers.push({ id: `l${i}`, a: this.w(-X + 0.15, FY + y, z), b: this.w(X - 0.15, FY + y, z), mesh, intensity: { value: 1 } });
      for (const s of [-1, 1]) b.add(m.dark, box(0.08, 0.12, 0.08, s * (X - 0.05), FY + y, z));
    });
    b.add(m.gunmetal, box(0.12, 0.55, 0.4, -X + 0.08, FY + 1.3, -26.5));
    b.add(m.print, zeroPrint('stripes', 0.4, 0.05, M(-X + 0.15, FY + 1.62, -26.5, Math.PI / 2)));
    this.points.gridBox = this.w(-X + 0.9, FY + 1.2, -26.5);
    this.points.grid = this.w(0, FY + 1.0, -29);
    // the cameras (Ezra's): one over the first half, two over the second
    this.camera('c0', b, m, -X + 0.4, FY + 4.6, Z0 - 0.5, Math.PI - 0.32, deg(20), 11, 21, 24);
    this.camera('c1', b, m, X - 0.4, FY + 4.6, ZB.GATE_Z - 0.6, Math.PI + 0.3, deg(22), 12, 20, 24);
    this.camera('c2', b, m, -X + 0.4, FY + 4.6, Z1 + 0.5, 0.32, deg(22), 13, 20, 24);
  }

  /** A showroom camera (the runtime yaws `pivot`; its body looks down +z). */
  private camera(id: string, b: MeshBatch, m: Mats, x: number, y: number, z: number, yaw0: number, sweep: number, period: number, range: number, halfDeg: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const lens = this.pal.slot('#ff3a2a', 1);
    const cb = new MeshBatch();
    cb.add(m.white, box(0.22, 0.2, 0.42, 0, 0, 0.1));
    cb.add(m.dark, cyl(0.08, 0.08, 0.06, 0, 0, 0.33, 12, Math.PI / 2));
    lens.add(cb, box(0.04, 0.04, 0.02, 0.06, 0.06, 0.33));
    pivot.add(cb.build(`zeroCam:${id}`));
    this.interior.add(pivot);
    b.add(m.dark, cyl(0.03, 0.03, 0.25, x, y + 0.17, z, 6), box(0.2, 0.04, 0.2, x, y + 0.3, z));
    this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3 * Math.cos(yaw0)), yaw0, sweep, period, range, halfAngle: deg(halfDeg), lens: lens.intensity });
  }

  // ------------------------------------------------------------------ the displays
  private buildBays(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, X = ZB.SHOW_X;
    const bays = this.pal.slot('#fff3d6', 2.0);
    this.slots.bays = bays.intensity;
    /** One display: plinth, header board, a door in its founder's style, a placard on a lectern. */
    const display = (id: string, n: number, side: -1 | 1, zc: number, leaf: (lb: MeshBatch, x: number) => void) => {
      const wx = side * X, px = wx - side * 0.9;
      // the plinth (1.8 deep, 3.4 long) and its brass edge
      b.add(m.enamel, box(1.8, 0.3, 3.4, px, FY + 0.15, zc));
      b.add(m.brass, box(0.04, 0.04, 3.4, px - side * 0.9, FY + 0.3, zc));
      this.col(px, FY + 0.15, zc, 0.9, 0.15, 1.7);
      // the header board over it, and a glow strip under the board
      b.add(m.print, zeroPrint(`bay${n}`, 3.2, 0.8, M(wx - side * 0.03, FY + 3.7, zc, -side * Math.PI / 2)));
      bays.add(b, box(0.05, 0.04, 3.0, wx - side * 0.08, FY + 3.2, zc));
      // the door: a frame standing on the plinth, parallel to the wall, the leaf in its style
      const dx = wx - side * 0.75;
      b.add(m.gunmetal, box(0.2, 2.7, 0.15, dx, FY + 0.3 + 1.35, zc - 1.3), box(0.2, 2.7, 0.15, dx, FY + 0.3 + 1.35, zc + 1.3), box(0.2, 0.18, 2.75, dx, FY + 0.3 + 2.7, zc));
      leaf(b, dx);
      this.col(dx, FY + 1.6, zc, 0.12, 1.4, 1.35);
      // the maker's plate by the bottom hinge
      b.add(m.print, zeroPrint(CYLINDERS[n - 1].plate, 0.3, 0.11, M(dx - side * 0.11, FY + 0.5, zc - 1.0, -side * Math.PI / 2)));
      // the placard on a lectern at the plinth's front corner, turned to the walkway
      const lx = wx - side * 2.1, lz = zc + 1.3;
      b.add(m.brass, cyl(0.03, 0.04, 1.0, lx, FY + 0.5, lz, 6));
      b.add(m.print, zeroPrint('placard', 0.42, 0.56, M(lx, FY + 1.12, lz, -side * Math.PI / 2 + side * 0.4, -0.5)));
      this.col(lx, FY + 0.5, lz, 0.06, 0.5, 0.06);
      this.bayPoints[id] = this.w(lx - side * 0.7, FY + 1.2, lz);
    };
    const r = rng(11);
    // 1 · Pivotson: a white roll-up garage door with a dent, a doorbell, a sticker
    display('garage', 1, -1, -9, (lb, x) => {
      for (let k = 0; k < 9; k++) lb.add(m.white, box(0.06, 0.27, 2.45, x + (k % 2) * 0.01, FY + 0.45 + k * 0.28, -9));
      lb.add(m.dark, box(0.08, 0.06, 0.4, x + 0.03, FY + 1.1, -9.6));
      lb.add(m.red, box(0.07, 0.08, 0.08, x + 0.04, FY + 1.5, -10.45));
    });
    // 2 · Kade: brushed steel, a red stripe, an airlock wheel
    display('apex', 2, 1, -14, (lb, x) => {
      lb.add(m.steel, box(0.12, 2.5, 2.45, x, FY + 1.55, -14));
      lb.add(m.red, box(0.13, 0.25, 2.45, x, FY + 2.2, -14));
      lb.add(m.dark, place(new THREE.TorusGeometry(0.3, 0.035, 6, 18), x - 0.08, FY + 1.4, -14, 0, Math.PI / 2));
    });
    // 3 · Seymour: black, a camera dome over it, an eye painted on
    display('panopticon', 3, -1, -19.5, (lb, x) => {
      lb.add(m.dark, box(0.12, 2.5, 2.45, x, FY + 1.55, -19.5));
      lb.add(m.white, place(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x + 0.15, FY + 2.75, -19.5, Math.PI));
      lb.add(m.white, place(new THREE.TorusGeometry(0.25, 0.03, 6, 16), x + 0.07, FY + 1.7, -19.5, 0, Math.PI / 2));
    });
    // 4 · Ashby: white, a green status light, a question mark on the panel
    display('spire', 4, 1, -33, (lb, x) => {
      lb.add(m.white, box(0.12, 2.5, 2.45, x, FY + 1.55, -33));
      lb.add(plainStandard('#4fe08a', 0.4, 0.1, { emissive: '#4fe08a', emissiveIntensity: 2 }), box(0.13, 0.06, 0.5, x - 0.01, FY + 2.6, -33));
      lb.add(m.dark, box(0.13, 0.4, 0.3, x - 0.01, FY + 1.5, -32.2));
    });
    // 5 · Vale: a glass leaf in a steel frame, a speaker grille for the voice lock
    display('dome', 5, -1, -35, (lb, x) => {
      lb.add(m.glass, box(0.05, 2.4, 2.3, x, FY + 1.55, -35));
      lb.add(m.steel, box(0.1, 2.5, 0.08, x, FY + 1.55, -36.18), box(0.1, 2.5, 0.08, x, FY + 1.55, -33.82));
      lb.add(m.dark, cyl(0.1, 0.1, 0.05, x + 0.1, FY + 1.5, -36.6, 12, 0, 0, Math.PI / 2));
    });
    // 6 · Sayle: an orange dock door with a returns slot
    display('cathedral', 6, 1, -37, (lb, x) => {
      for (let k = 0; k < 8; k++) lb.add(m.orange, box(0.06, 0.3, 2.45, x + (k % 2) * 0.01, FY + 0.48 + k * 0.31, -37));
      lb.add(m.dark, box(0.08, 0.2, 0.7, x - 0.03, FY + 1.2, -37));
    });
    void r;
  }

  // ------------------------------------------------------------------ the clock gate (Vesper's)
  private buildGate(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, X = ZB.SHOW_X, Z = ZB.GATE_Z, G = ZB.GATE, GH = ZB.GATE_H, H = ZB.SHOW_H;
    this.wallZ(b, m.gunmetal, Z, 0, -X, -G, FY, FY + H, 0.5);
    this.wallZ(b, m.gunmetal, Z, 0, G, X, FY, FY + H, 0.5);
    this.wallZ(b, m.gunmetal, Z, 0, -G, G, FY + GH, FY + H, 0.5);
    b.add(m.print, zeroPrint('stripes', G * 2, 0.12, M(0, FY + GH + 0.08, Z + 0.26)));
    // the gate: a steel leaf sliding west into the wall
    this.slideDoor('clockGate', -G, G, FY, Z, GH, -(G * 2 + 0.1), (lb, wd) => {
      lb.add(m.steel, box(wd, GH - 0.02, 0.16, wd / 2, GH / 2, 0));
      for (let k = 0; k < 5; k++) lb.add(m.gunmetal, box(wd - 0.1, 0.06, 0.18, wd / 2, 0.4 + k * 0.55, 0));
      lb.add(m.red, box(wd, 0.2, 0.17, wd / 2, GH - 0.3, 0));
    }, this.interior);
    // the flip clock over it, facing the way you come
    const face = new THREE.PlaneGeometry(1.6, 0.6);
    face.applyMatrix4(M(0, FY + GH + 0.8, Z + 0.31));
    const screen = new THREE.Mesh(norm(face), this.clock.material);
    screen.castShadow = false;
    this.interior.add(screen);
    b.add(m.dark, box(1.75, 0.72, 0.1, 0, FY + GH + 0.8, Z + 0.24));
    const lamp = this.pal.slot('#ff3a2a', 1.5);
    this.slots.clockLamp = lamp.intensity;
    // the keypad on the right, the placard on the left
    b.add(m.dark, box(0.22, 0.3, 0.06, 1.85, FY + 1.3, Z + 0.28));
    lamp.add(b, box(0.12, 0.03, 0.01, 1.85, FY + 1.42, Z + 0.32));
    b.add(m.print, zeroPrint('clockPlacard', 1.0, 0.375, M(-2.1, FY + 1.5, Z + 0.27)));
    this.points.clockPad = this.w(1.85, FY + 1.2, Z + 1.1);
    this.points.clockPlacard = this.w(-2.1, FY + 1.2, Z + 1.1);
  }

  // ------------------------------------------------------------------ the board room (Kit's bay)
  private buildBoardRoom(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, [x0, x1, z0, z1] = ZB.BOARD, H = ZB.BOARD_H;
    this.wallX(b, m.wall, x1, 1, z0 - 0.4, z1 + 0.4, FY, FY + H);
    this.wallZ(b, m.wall, z0, -1, x0, x1 + 0.4, FY, FY + H);
    this.wallZ(b, m.wall, z1, 1, x0, x1 + 0.4, FY, FY + H);
    b.add(m.floor, place(new THREE.PlaneGeometry(x1 - x0, z1 - z0), (x0 + x1) / 2, FY + 0.01, (z0 + z1) / 2, -Math.PI / 2));
    b.add(m.ceil, box(x1 - x0 + 0.4, 0.3, z1 - z0 + 0.8, (x0 + x1) / 2 + 0.2, FY + H + 0.15, (z0 + z1) / 2));
    const [bd0, bd1] = ZB.BOARD_DOOR;
    b.add(m.print, zeroPrint('bay7', 3.2, 0.8, M(x0 - 0.03, FY + 3.7, (bd0 + bd1) / 2, -Math.PI / 2)));
    // Kit's placard stands in the showroom by the doorway, like the others
    const lx = x0 - 1.7, lz = bd1 + 0.8;
    b.add(m.brass, cyl(0.03, 0.04, 1.0, lx, FY + 0.5, lz, 6));
    b.add(m.print, zeroPrint('placard', 0.42, 0.56, M(lx, FY + 1.12, lz, -Math.PI / 2 + 0.4, -0.5)));
    this.col(lx, FY + 0.5, lz, 0.06, 0.5, 0.06);
    this.bayPoints.fortress = this.w(lx - 0.7, FY + 1.2, lz);
    // the board on the east wall: labels, five lamps, the knife switches
    const bx = x1 - 0.15, bz = (z0 + z1) / 2;
    b.add(m.olive, box(0.25, 2.2, 2.4, bx, FY + 1.5, bz));
    b.add(m.print, zeroPrint('boardLabels', 1.7, 1.7, M(bx - 0.14, FY + 1.6, bz, -Math.PI / 2)));
    for (let k = 0; k < 5; k++) {
      const on = this.pal.slot('#5fe08a', 1.6);
      this.boardLamps.push(on.intensity);
      on.add(b, box(0.03, 0.06, 0.06, bx - 0.15, FY + 2.05 - k * 0.3, bz + 1.0));
      b.add(m.dark, box(0.1, 0.18, 0.06, bx - 0.15, FY + 2.05 - k * 0.3, bz + 0.8));
    }
    const warn = this.pal.slot('#ff5a3a', 0);
    this.slots.boardWarn = warn.intensity;
    warn.add(b, box(0.03, 0.08, 1.4, bx - 0.15, FY + 2.75, bz));
    this.col(bx, FY + 1.5, bz, 0.15, 1.5, 1.2);
    this.points.board = this.w(bx - 1.3, FY + 1.2, bz);
    // generator 2: a green block with a flywheel guard and an exhaust into the rock
    const gx = x0 + 1.8, gz = z1 - 1.2;
    b.add(m.enamel, box(2.2, 1.3, 1.1, gx, FY + 0.65, gz));
    b.add(m.steel, place(new THREE.TorusGeometry(0.42, 0.06, 6, 16), gx - 1.15, FY + 0.7, gz, 0, Math.PI / 2));
    b.add(m.pipe, cyl(0.08, 0.08, H - 1.3, gx + 0.7, FY + 1.3 + (H - 1.3) / 2, gz - 0.3, 8));
    this.col(gx, FY + 0.65, gz, 1.1, 0.65, 0.55);
    this.points.generator = this.w(gx, FY + 0.8, gz);
    this.speakers.push(this.w(9, FY + 2.8, -41.5));
  }

  // ------------------------------------------------------------------ Model Zero, and the tunnel behind it
  private buildZeroDoor(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, Z = ZB.SHOW_Z1, R = ZB.ZERO_R, CY = ZB.ZERO_CY;
    // the frame: a steel plate with a round hole, proud of the wall
    const sh = new THREE.Shape();
    sh.moveTo(-R - 0.5, -CY); sh.lineTo(R + 0.5, -CY); sh.lineTo(R + 0.5, R + 0.5); sh.lineTo(-R - 0.5, R + 0.5); sh.lineTo(-R - 0.5, -CY);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R + 0.02, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const frame = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 32 });
    frame.translate(0, FY + CY, Z - 0.05);
    b.add(m.gunmetal, frame);
    b.add(m.brass, place(new THREE.TorusGeometry(R + 0.06, 0.05, 6, 40), 0, FY + CY, Z + 0.27));
    // the door: a disc on a hinge at its west edge, swinging out into the showroom like a vault's;
    // its cylinders, plates and lamps ride with it
    const pivot = new THREE.Group();
    pivot.position.set(-R, FY, Z + 0.05);
    const zb = new MeshBatch();
    ((lb: MeshBatch) => {
      lb.add(m.steel, cyl(R, R, 0.45, R, CY, 0.0, 40, Math.PI / 2));
      lb.add(m.gunmetal, cyl(R - 0.25, R - 0.25, 0.47, R, CY, 0.0, 40, Math.PI / 2));
      lb.add(m.steel, place(new THREE.TorusGeometry(0.42, 0.05, 6, 24), R, CY, 0.26), cyl(0.07, 0.07, 0.2, R, CY, 0.3, 8, Math.PI / 2));
      for (let k = 0; k < 4; k++) lb.add(m.steel, box(0.84, 0.05, 0.05, R, CY, 0.27, 0, 0, (k * Math.PI) / 4));
      const at = (i: number): [number, number] => {
        if (i === 7) return [0, -0.85];
        const a = (i / 7) * Math.PI * 2;
        return [Math.sin(a) * (R - 0.35), Math.cos(a) * (R - 0.35)];
      };
      for (let i = 0; i < 8; i++) {
        const [cx, cy] = at(i);
        lb.add(m.brass, cyl(0.09, 0.09, 0.12, R + cx, CY + cy, 0.27, 12, Math.PI / 2));
        lb.add(m.dark, box(0.02, 0.08, 0.01, R + cx, CY + cy, 0.335));
        lb.add(m.print, zeroPrint(i === 7 ? 'pZERO' : CYLINDERS[i].plate, 0.28, 0.105, M(R + cx, CY + cy - 0.17, 0.24)));
        const ok = this.pal.slot('#5fe08a', 0), no = this.pal.slot('#ff3a2a', 1.6);
        ok.add(lb, place(new THREE.SphereGeometry(0.045, 8, 6), R + cx + 0.17, CY + cy - 0.03, 0.26));
        no.add(lb, place(new THREE.SphereGeometry(0.045, 8, 6), R + cx + 0.17, CY + cy + 0.08, 0.26));
        this.cylOk.push(ok.intensity);
        this.cylNo.push(no.intensity);
      }
      // the hinge's knuckles
      for (const y of [0.6, CY, CY + 1.1]) lb.add(m.gunmetal, cyl(0.1, 0.1, 0.4, 0, y, 0.0, 10));
    })(zb);
    pivot.add(zb.build('zeroDoor:zero'));
    this.interior.add(pivot);
    const zpos = this.w(0, FY + (CY + R) / 2, Z + 0.05), zhalf = V(R, (CY + R) / 2, 0.25);
    this.doors.zeroDoor = { pivot, open: 0, target: 0, collider: this.physics.addBox(zpos, zhalf), axis: 'y', amount: -1.85, colliderSpec: { pos: zpos, half: zhalf } };
    this.halos.add(V(0, FY + CY + R + 0.3, Z + 0.4), '#ffd9a0', 1.4, ZeroBuilder.CH.ZERO, 0.4);
    this.points.zeroDoor = this.w(0, FY + 1.2, Z + 1.4);
    // the tunnel behind it, cut in rock, into the well hall
    const T = ZB.TUN_Z, tw = R + 0.1;
    this.wallX(b, m.rock, -tw, -1, Z, T - 0.2, FY, FY + CY + R + 0.2);
    this.wallX(b, m.rock, tw, 1, Z, T - 0.2, FY, FY + CY + R + 0.2);
    b.add(m.rock, box(tw * 2 + 0.8, 0.4, Z - T + 0.4, 0, FY + CY + R + 0.4, (Z + T) / 2));
    b.add(m.floor, place(new THREE.PlaneGeometry(tw * 2, Z - T), 0, FY + 0.01, (Z + T) / 2, -Math.PI / 2));
    this.points.zeroIn = this.w(0, FY + 1.0, T - 0.5);
  }

  // ------------------------------------------------------------------ the well hall
  private buildWellHall(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, CZ = ZB.WELL_Z, R = ZB.WELL_R, H = ZB.WELL_H;
    // the round wall: 28 panels, a gap south (the tunnel) and north (the dormitory)
    const N = 28;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
      // angle 0 = +z (south, toward the tunnel), π = north
      const south = Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < 0.12;
      const north = Math.abs(Math.atan2(Math.sin(am - Math.PI), Math.cos(am - Math.PI))) < 0.2;
      const len = 2 * R * Math.sin(Math.PI / N) + 0.05;
      const cx = Math.sin(am) * (R + 0.2), cz = CZ + Math.cos(am) * (R + 0.2);
      // (a box turned by θ runs along (cos θ, −sin θ): the tangent at angle `am`)
      const yaw = am;
      const y0 = south ? ZB.ZERO_CY + ZB.ZERO_R + 0.2 : north ? ZB.DORM_H : 0;
      b.add(m.wall, box(len, H - y0, 0.4, cx, FY + y0 + (H - y0) / 2, cz, yaw));
      this.col(cx, FY + y0 + (H - y0) / 2, cz, len / 2, (H - y0) / 2, 0.2, yaw);
      if (!south && !north) {
        b.add(m.enamel, box(len, 1.2, 0.03, Math.sin(am) * (R - 0.01), FY + 0.6, CZ + Math.cos(am) * (R - 0.01), yaw));
        b.add(m.brass, box(len, 0.05, 0.05, Math.sin(am) * (R - 0.02), FY + 1.22, CZ + Math.cos(am) * (R - 0.02), yaw));
      }
    }
    b.add(m.floor, place(new THREE.CircleGeometry(R + 0.1, 40), 0, FY + 0.01, CZ, -Math.PI / 2));
    b.add(m.ceil, place(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 0.3, 40), 0, FY + H + 0.15, CZ));
    // ribs across the ceiling, and a ring of light under it
    for (let k = 0; k < 4; k++) b.add(m.gunmetal, box(R * 2, 0.3, 0.25, 0, FY + H - 0.15, CZ, (k * Math.PI) / 4));
    const well = this.pal.slot('#fff0d0', 2.0);
    this.slots.well = well.intensity;
    well.add(b, place(new THREE.TorusGeometry(R - 1.2, 0.05, 4, 48), 0, FY + H - 0.35, CZ, Math.PI / 2));
    this.halos.add(V(0, FY + H - 0.5, CZ), '#fff0d0', 3, ZeroBuilder.CH.WELL, 0.25);
    // the wellhead: a collar, the casing, the pump, the line to the cistern and the surface line (red)
    b.add(m.wall, cyl(1.1, 1.2, 0.5, 0, FY + 0.25, CZ, 20));
    b.add(m.steel, cyl(0.24, 0.24, 1.1, 0, FY + 0.5 + 0.55, CZ, 14));
    b.add(m.enamel, box(0.9, 0.6, 0.7, 0, FY + 1.9, CZ));
    b.add(m.steel, cyl(0.28, 0.28, 0.5, 0.6, FY + 1.9, CZ, 12, 0, 0, Math.PI / 2));
    b.add(m.print, zeroPrint('wellPlate', 1.0, 0.5, M(0, FY + 0.32, CZ + 1.16, 0, -0.2)));
    b.add(m.pipe, beam(V(-0.45, FY + 1.9, CZ), V(-4.0, FY + 2.6, CZ), 0.1, 8));
    b.add(m.red, beam(V(0, FY + 2.2, CZ), V(0, FY + H, CZ), 0.1, 8));
    b.add(m.print, zeroPrint('surfaceLine', 0.6, 0.2, M(0, FY + 3.2, CZ + 0.12)));
    this.col(0, FY + 1.1, CZ, 1.1, 1.1, 1.1);
    // the red handle on the pump (it drops in the open ending)
    const hp = new THREE.Group();
    hp.position.set(0.48, FY + 2.05, CZ + 0.2);
    const hb = new MeshBatch();
    hb.add(m.red, box(0.05, 0.5, 0.05, 0, 0.25, 0), box(0.12, 0.1, 0.1, 0, 0.5, 0));
    hp.add(hb.build('zeroHandle'));
    this.interior.add(hp);
    this.handle = hp;
    this.points.wellhead = this.w(0, FY + 1.2, CZ + 2.2);
    // the cistern on the west side: a riveted tank, a ladder, its plate, the tap
    const tx = -6.6;
    b.add(m.old, cyl(2.2, 2.2, 5.4, tx, FY + 2.7, CZ, 28));
    for (const y of [0.6, 2.2, 3.8, 5.3]) b.add(m.steel, place(new THREE.TorusGeometry(2.22, 0.04, 4, 32), tx, FY + y, CZ, Math.PI / 2));
    b.add(m.print, zeroPrint('cistern', 1.5, 0.5, M(tx + 2.22, FY + 2.0, CZ, Math.PI / 2)));
    b.add(m.steel, cyl(0.06, 0.06, 0.4, tx + 2.3, FY + 0.6, CZ + 0.6, 6, 0, 0, Math.PI / 2), box(0.1, 0.1, 0.1, tx + 2.5, FY + 0.6, CZ + 0.6));
    for (const s of [-0.25, 0.25]) b.add(m.steel, box(0.04, 5.2, 0.04, tx + 2.24, FY + 2.6, CZ - 0.9 + s));
    for (let y = 0.4; y < 5.2; y += 0.35) b.add(m.steel, box(0.03, 0.03, 0.5, tx + 2.25, FY + y, CZ - 0.9));
    this.col(tx, FY + 2.7, CZ, 1.6, 2.7, 1.6);
    this.col(tx, FY + 2.7, CZ, 2.2, 2.7, 0.9);
    this.col(tx, FY + 2.7, CZ, 0.9, 2.7, 2.2);
    this.lootSpots.push({ id: 'cistern', pos: this.w(tx + 3.2, FY + 1.0, CZ + 0.6), mesh: new THREE.Group() });
    // the stores on the east side: two racks of crates, cans and drums
    const r = rng(29);
    // (tangent to the wall at 8.8 m: a box's x runs along (cos θ, −sin θ) when it's turned by θ)
    for (const th of [1.0, 1.5]) {
      const sx = Math.sin(th) * 8.8, sz = CZ + Math.cos(th) * 8.8, yaw = th;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const at = (dx: number, dy: number, dz: number, w: number, h: number, d: number, mm: THREE.Material) => b.add(mm, box(w, h, d, sx + dx * cs + dz * sn, FY + dy, sz - dx * sn + dz * cs, yaw));
      for (const y of [0.05, 0.85, 1.65, 2.45]) at(0, y, 0, 3.6, 0.05, 0.8, m.steel);
      for (const dx of [-1.75, 1.75]) at(dx, 1.3, 0, 0.06, 2.6, 0.8, m.steel);
      for (const y of [0.1, 0.9, 1.7]) for (let k = 0; k < 6; k++) {
        if (r() < 0.15) continue;
        const ww = 0.45 + r() * 0.1;
        at(-1.45 + k * 0.58, y + 0.22, 0, ww, 0.4, 0.55, r() < 0.5 ? m.olive : m.wood);
      }
      this.col(sx, FY + 1.3, sz, 1.8, 1.3, 0.45, yaw);
    }
    b.add(m.print, zeroPrint('stores', 2.0, 0.5, M(Math.sin(1.25) * 9.85, FY + 3.4, CZ + Math.cos(1.25) * 9.85, 1.25 + Math.PI)));
    this.lootSpots.push({ id: 'stores', pos: this.w(Math.sin(1.25) * 7.2, FY + 1.0, CZ + Math.cos(1.25) * 7.2), mesh: new THREE.Group() });
    this.points.speaker = this.w(0, FY + 5, CZ);
    this.speakers.push(this.w(0, FY + 5, CZ), this.w(0, FY + 2.5, -78));
  }

  // ------------------------------------------------------------------ Agnes's office: a glass booth by the well
  private buildOffice(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, [x0, x1, z0, z1] = ZB.OFFICE, H = ZB.OFFICE_H;
    const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    // low walls of enamel with glass above; the door gap in the west wall (z −61.7 … −60.3)
    const low = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      b.add(m.enamel, box(len, 1.0, 0.12, mx, FY + 0.5, mz, yaw));
      b.add(m.glass, box(len, H - 1.0, 0.04, mx, FY + 1.0 + (H - 1.0) / 2, mz, yaw));
      b.add(m.brass, box(len, 0.05, 0.14, mx, FY + 1.02, mz, yaw), box(len, 0.06, 0.1, mx, FY + H, mz, yaw));
      this.col(mx, FY + H / 2, mz, len / 2, H / 2, 0.08, yaw);
    };
    low(x0, z1, x1, z1);
    low(x0, z1, x0, -60.3);
    low(x0, -61.7, x0, z0);
    // the back wall (north) is solid: the board and the drawings hang on it; the east wall too
    this.wallZ(b, m.cream, z0, -1, x0 - 0.1, x1 + 0.1, FY, FY + H, 0.2);
    this.wallX(b, m.cream, x1, 1, z0, z1, FY, FY + H, 0.2);
    b.add(m.ceil, box(x1 - x0 + 0.3, 0.12, z1 - z0 + 0.3, xc, FY + H + 0.06, zc));
    b.add(m.print, zeroPrint('office', 0.8, 0.2, M(x0 - 0.07, FY + 2.3, -61.0, -Math.PI / 2)));
    b.add(m.wood, place(new THREE.PlaneGeometry(x1 - x0, z1 - z0), xc, FY + 0.02, zc, -Math.PI / 2));
    // the drafting table along the east wall, its top tilted toward her; a lamp on an arm
    const tx = x1 - 0.65, tz = -61.5;
    b.add(m.table, box(0.9, 0.04, 1.6, tx, FY + 1.0, tz, 0, 0, 0.25));
    b.add(m.steel, box(0.05, 0.95, 0.05, tx - 0.3, FY + 0.48, tz - 0.7), box(0.05, 0.95, 0.05, tx - 0.3, FY + 0.48, tz + 0.7), box(0.05, 1.1, 0.05, tx + 0.3, FY + 0.55, tz - 0.7), box(0.05, 1.1, 0.05, tx + 0.3, FY + 0.55, tz + 0.7));
    // a drawing on it, lying on the slope (face up, then tilted with the top)
    const onTop = new THREE.Matrix4().makeTranslation(tx, FY + 1.025, tz + 0.15).multiply(new THREE.Matrix4().makeRotationZ(0.25)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    b.add(m.print, zeroPrint('blueprintA', 0.75, 0.56, onTop));
    b.add(m.steel, beam(V(x1 - 0.1, FY + 1.9, tz + 0.7), V(tx - 0.1, FY + 1.6, tz + 0.4), 0.015, 5));
    const lampK = this.pal.slot('#ffd9a0', 3);
    this.slots.office = lampK.intensity;
    lampK.add(b, place(new THREE.ConeGeometry(0.1, 0.12, 10, 1, true), tx - 0.1, FY + 1.56, tz + 0.4, Math.PI));
    this.col(tx, FY + 0.55, tz, 0.45, 0.55, 0.8);
    this.agnesSpot = { x: x1 - 1.45, y: ZB.FY, z: tz, yaw: Math.PI / 2 };
    this.points.agnes = this.w(x1 - 2.3, FY + 1.2, tz - 0.2);
    // the master board on the back wall: eight brass keyswitches under their plates
    const mx = x0 + 1.2, mz = z0 + 0.12;
    b.add(m.gunmetal, box(1.3, 0.8, 0.06, mx, FY + 1.6, mz));
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const kx = mx - 0.45 + col * 0.3, ky = FY + 1.82 - row * 0.4;
      b.add(m.brass, cyl(0.05, 0.05, 0.05, kx, ky, mz + 0.05, 10, Math.PI / 2));
      b.add(m.print, zeroPrint(i === 7 ? 'pZERO' : CYLINDERS[i].plate, 0.26, 0.1, M(kx, ky - 0.13, mz + 0.035)));
    }
    b.add(m.steel, box(0.03, 0.09, 0.06, mx + 0.45, FY + 1.42, mz + 0.1));
    this.points.master = this.w(mx, FY + 1.2, mz + 1.0);
    // the drawings on the back wall, the plan chest (loot)
    b.add(m.print, zeroPrint('blueprintB', 0.9, 0.675, M(x1 - 1.4, FY + 1.75, z0 + 0.12)));
    b.add(m.print, zeroPrint('blueprintA', 0.6, 0.45, M(x1 - 0.55, FY + 2.0, z0 + 0.12, 0, 0, 0.05)));
    b.add(m.wood, box(1.2, 0.8, 0.6, x0 + 1.4, FY + 0.4, z1 - 0.4));
    for (let k = 0; k < 4; k++) b.add(m.dark, box(1.0, 0.02, 0.01, x0 + 1.4, FY + 0.15 + k * 0.18, z1 - 0.7));
    this.col(x0 + 1.4, FY + 0.4, z1 - 0.4, 0.6, 0.4, 0.3);
    this.lootSpots.push({ id: 'plans', pos: this.w(x0 + 1.4, FY + 1.0, z1 - 1.2), mesh: new THREE.Group() });
    // the radio on the chest (she listens to the band), a stool by the table
    b.add(m.dark, box(0.4, 0.22, 0.2, x0 + 1.1, FY + 0.91, z1 - 0.4));
    b.add(m.steel, cyl(0.02, 0.02, 0.35, x0 + 1.25, FY + 1.18, z1 - 0.45, 4));
    b.add(m.wood, cyl(0.18, 0.18, 0.05, x1 - 1.6, FY + 0.65, tz + 0.95, 10), cyl(0.03, 0.03, 0.62, x1 - 1.6, FY + 0.31, tz + 0.95, 6));
  }

  // ------------------------------------------------------------------ the dormitory
  private buildDorm(b: MeshBatch, m: Mats) {
    const FY = ZB.FY, [x0, x1, z0, z1] = ZB.DORM, H = ZB.DORM_H;
    this.wallX(b, m.wall, x0, -1, z0 - 0.4, z1, FY, FY + H);
    this.wallX(b, m.wall, x1, 1, z0 - 0.4, z1, FY, FY + H);
    this.wallZ(b, m.wall, z0, -1, x0, x1, FY, FY + H);
    b.add(m.floor, place(new THREE.PlaneGeometry(x1 - x0, z1 - z0), 0, FY + 0.01, (z0 + z1) / 2, -Math.PI / 2));
    b.add(m.ceil, box(x1 - x0 + 0.8, 0.3, z1 - z0 + 0.4, 0, FY + H + 0.15, (z0 + z1) / 2));
    b.add(m.print, zeroPrint('dorm', 2.4, 0.6, M(0, FY + H + 0.6, z1 + 0.25, Math.PI)));
    // triple bunks down both walls, one a metre, made up the same, into the dark
    const r = rng(77);
    for (const s of [-1, 1]) {
      for (let z = z1 - 1.0; z > z0 + 0.6; z -= 1.0) {
        const xi = s * 1.05, xo = s * (x1 - 0.05), xm = (xi + xo) / 2, len = Math.abs(xo - xi);
        for (const x of [xi, xo]) for (const dz of [-0.4, 0.4]) b.add(m.gunmetal, box(0.05, 2.5, 0.05, x, FY + 1.25, z + dz));
        for (const y of [0.35, 1.15, 1.95]) {
          b.add(m.gunmetal, box(len, 0.05, 0.85, xm, FY + y, z));
          b.add(m.mattress, box(len - 0.1, 0.12, 0.78, xm, FY + y + 0.09, z));
          if (r() < 0.8) b.add(m.blanket, box(len * 0.55, 0.03, 0.8, xm + s * len * 0.2, FY + y + 0.16, z));
        }
        if (Math.round(z) % 4 === 0) b.add(m.print, zeroPrint('bunk', 0.14, 0.07, M(xi, FY + 1.6, z + 0.43)));
      }
      this.col(s * (x1 + 1.05) / 2, FY + 1.3, (z0 + z1) / 2 - 0.3, (x1 - 1.05) / 2, 1.3, (z1 - z0) / 2 - 0.4);
    }
    const night = this.pal.slot('#ffb070', 1.2);
    this.slots.dorm = night.intensity;
    for (let z = z1 - 3; z > z0 + 2; z -= 6) night.add(b, box(0.25, 0.06, 0.12, 0, FY + H - 0.05, z));
  }

  // ------------------------------------------------------------------ the Doormen's routes
  private buildRoutes() {
    const FY = ZB.FY;
    const at = (x: number, z: number) => this.w(x, FY, z);
    this.routes.d1 = [at(2.6, -6.0), at(2.4, -14), at(-1.6, -18.5), at(-2.4, -23.4)];
    this.routes.d2 = [at(-2.6, -32), at(-2.8, -42.8), at(2.8, -43.0), at(3.0, -38.5)];
  }

  // ------------------------------------------------------------------ lights (virtual: the pool lends them)
  private buildLights() {
    const FY = ZB.FY;
    const L = (c: string, dist: number, x: number, y: number, z: number, pr = 2) => {
      const v = new VirtualLight(c, 0, dist, 1.6);
      v.position.copy(this.w(x, y, z));
      v.priority = pr;
      return v;
    };
    this.lights = {
      foot: L('#ffcf8a', 7, 0, FY + 2.6, 0.4),
      show: [L('#fff0d0', 13, 0, FY + 4.7, -10), L('#fff0d0', 13, 0, FY + 4.7, -20), L('#fff0d0', 13, 0, FY + 4.7, -31), L('#fff0d0', 13, 0, FY + 4.7, -40)],
      board: L('#ffe0b0', 7, 8.8, FY + 2.8, -41.5, 3.2),
      zero: L('#ffd9a0', 6, 0, FY + 4.0, -43.8, 2.4),
      hall: L('#fff0d0', 16, 0, FY + 6.2, ZB.WELL_Z, 2.4),
      office: L('#ffd9a0', 6, 5.3, FY + 1.9, -61.3, 2.6),
      dorm: [L('#ffb070', 8, 0, FY + 2.6, -70), L('#ffb070', 8, 0, FY + 2.6, -82, 1.5)],
    };
  }
}
