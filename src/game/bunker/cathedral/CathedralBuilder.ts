import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, norm, MeshBatch, DistanceLod, shadowProxy } from '../../world/kit';
import { surfaces } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, fabric, wood, corrugated, desertRock } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { buildCar } from '../../world/vehicles';
import { LiveScreen } from '../apex/apexAtlas';
import { cathPrint, cathPrintMaterial, paintBoard } from './cathedralAtlas';
import { roseMaterial, paneMaterial } from './cathedralFx';
import type { BunkerShell, Door, LootSpot, SecurityCamera, Tripwire, Laser } from '../shell';

/**
 * The Cloud Cathedral, on a pad in the north basin. Local metres, origin at the pad's centre, axes as
 * the world's (north is −z). The front faces south, toward the lot and the basin; the apse backs onto
 * the range.
 *
 * - The hall: a nave (x ±12, z −24…24, walls 15 m, a steep roof to 23 m) between two aisles (out to
 *   x ±19, 8 m, lean-to roofs), an arcade of pointed arches between them, flying buttresses outside
 *   with conveyors on their backs, and a half-round apse on the north. Clerestory panes and the rose
 *   window are opaque glass lit from inside: the hall is a sealed interior.
 * - The front (z 24): the Customer Entrance (shut until shift end), the rose window (a clock), and
 *   two towers: the bell tower on the west is the drone port; the east one carries the sign.
 * - The floor: a 10 × 12 grid of 2.4 m cells across the nave (z −16.8…12) where drive units move the
 *   shelf pods (floor.ts builds and moves those); the narthex south of it, with the floor kiosk; the
 *   crossing north of it: the altar (the pack line), the board over it, Lo's desk on the west, the
 *   returns table on the east; and in the apse, a stair up the east side to the mezzanine and the
 *   Day 1 office.
 * - The aisles are cut by rack walls at z 0 and z −12, so the floor is the way north. The west aisle
 *   has the two pick stations at the arcade; the east aisle the dock (outer wall, z 14) and the
 *   returns line, which runs in from the kiosk outside, climbs over the aisle and drops into the
 *   crossing (`ride`: the path the player is carried along).
 * - Outside: the lot to the south (rows of dead Dropt vans, rider bays, lamp posts, the pickup
 *   lockers under an awning), the kiosk on the east wall, the swarm panel at the bell tower's foot.
 */
export const CT = {
  NW: 12, AW: 19, Z0: -24, Z1: 24,
  NAVE_H: 15, RIDGE: 23, AISLE_H: 8, AISLE_TOP: 10.5, ARCH_H: 9,
  APSE_R: 12,
  /** The drive grid: cell size, columns × rows, the first cell's centre. */
  CELL: 2.4, COLS: 10, ROWS: 12, GX0: -10.8, GZ0: -15.6,
  /** The mezzanine (y) and the office box (x0, x1, z0, z1). */
  MEZZ: 5.5, OFFICE: [-5.6, 5.6, -32.6, -27.5] as const,
  /** The stair up the apse's east side: x0, x1, foot z, head z. */
  STAIR: [8.6, 10.6, -17.2, -25.6] as const,
  /** Rack walls across the aisles (z). */
  CUTS: [0, -12] as const,
  /** Pier spacing along the arcade (z of each pier). */
  PIERS: [-24, -18, -12, -6, 0, 6, 12, 18, 24] as const,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/**
 * A pointed (gothic) arch: width w, springing at y0, apex at y1. The left half, from the springing
 * up to the apex (x negative); mirror x for the right.
 */
function archPoints(w: number, y0: number, y1: number, n = 10) {
  const half = w / 2, h = y1 - y0;
  // the left arc's centre sits on the springing line at x = R − half; it passes through the apex
  const R = (half * half + h * h) / (2 * half), cx = -half + R;
  const end = Math.atan2(h, -cx);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (end - Math.PI) * (i / n);
    pts.push(new THREE.Vector2(cx + R * Math.cos(a), y0 + R * Math.sin(a)));
  }
  pts[n].x = 0;
  return pts;
}

/** Walk an arch's outline into a shape: up the left side from (x − w/2, y0) and down the right. */
function traceArch(s: THREE.Shape | THREE.Path, x: number, w: number, y0: number, y1: number, n = 8) {
  const pts = archPoints(w, y0, y1, n);
  for (const q of pts) s.lineTo(x + q.x, q.y);
  for (let i = pts.length - 2; i >= 0; i--) s.lineTo(x - pts[i].x, pts[i].y);
}

/** A wall (x-y plane, extruded `depth` about z = 0) with pointed arches cut up from the floor. */
function archWall(w: number, h: number, depth: number, openings: { x: number; w: number; y0: number; y1: number }[]) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  for (const o of [...openings].sort((a, b) => a.x - b.x)) {
    s.lineTo(o.x - o.w / 2, 0);
    if (o.y0 > 0) s.lineTo(o.x - o.w / 2, o.y0);
    traceArch(s, o.x, o.w, o.y0, o.y1);
    s.lineTo(o.x + o.w / 2, 0);
  }
  s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A lancet pane (x-y plane, facing +z): straight sides from yb to the springing, a pointed head. */
function lancet(w: number, yb: number, y0: number, y1: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, yb);
  s.lineTo(-w / 2, y0);
  traceArch(s, 0, w, y0, y1, 6);
  s.lineTo(w / 2, yb);
  s.lineTo(-w / 2, yb);
  return new THREE.ShapeGeometry(s, 2);
}

/** A box from a to b (its length along a→b), w wide and h tall. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(b, a, V(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return norm(g.applyMatrix4(m));
}

export class CathedralBuilder implements BunkerShell {
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
  readonly portals: { box: THREE.Box3; open?: () => boolean }[] = [];
  lod!: DistanceLod;
  readonly pal = new GlowPalette(40);
  readonly halos = new GlowSprites(12);
  static readonly CH = { ON: 0, NIGHT: 1, HALL: 2, BLINK: 3, ALTAR: 4, OFFICE: 5, STROBE: 6 };
  /** The board over the altar. */
  board!: LiveScreen;
  /** The rose window's hand (the runtime turns it). */
  hand!: THREE.Object3D;
  lights!: { hall: VirtualLight[]; altar: VirtualLight; office: VirtualLight; dock: VirtualLight; lot: VirtualLight[]; tower: VirtualLight };
  readonly slots: Record<'hall' | 'altar' | 'office' | 'kiosk' | 'kioskOk' | 'officePad' | 'officeOk' | 'tower' | 'lot' | 'dock' | 'panel' | 'stations' | 'aviation' | 'floor' | 'floorStop', { value: number }> = {} as never;
  /** Where people stand (the runtime puts the models there). */
  orrinSpot!: { pos: THREE.Vector3; yaw: number };
  loSpot!: { pos: THREE.Vector3; yaw: number };
  stations!: { pos: THREE.Vector3; yaw: number }[];
  /** The carrier walks this, there and back. */
  carrierRoute!: THREE.Vector3[];
  /** The returns line the player rides (world points, in order), and where it lets you off. */
  ride!: THREE.Vector3[];
  /** Swarm routes outside (world), floor drone routes inside (world), the tower's launch point. */
  readonly swarmRoutes: THREE.Vector3[][] = [];
  readonly floorRoutes: THREE.Vector3[][] = [];
  launch!: THREE.Vector3;
  /** Cover from the swarm (world boxes): under the awning, the vans, the dock canopy. */
  readonly cover: THREE.Box3[] = [];
  /** The front doors (opened by the ending). */
  frontOpen = () => false;
  private far!: THREE.Object3D;

  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'cathedral';
    this.innerBox = new THREE.Box3(this.w(-CT.AW, -0.5, CT.Z0 - CT.APSE_R), this.w(CT.AW, CT.RIDGE, CT.Z1));
    this.groundsBox = new THREE.Box3(this.w(-44, -4, -40), this.w(44, 40, 62));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** Ground height (local) under local (x, z). */
  private gy(x: number, z: number) {
    return this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
  }

  /** In the hall (nave, aisles, apse). */
  contains(p: THREE.Vector3, margin = 0) {
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    if (y < -2 || y > CT.RIDGE) return false;
    if (Math.abs(x) < CT.AW - 0.3 + margin && z > CT.Z0 - margin && z < CT.Z1 - 0.3 + margin) return true;
    return z <= CT.Z0 && x * x + (z - CT.Z0) ** 2 < (CT.APSE_R - 0.3 + margin) ** 2;
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** A sliding door leaf along x at z (or along z at x when `alongZ`). */
  private slideDoor(id: string, a0: number, a1: number, y0: number, at: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void, alongZ = false) {
    const pivot = new THREE.Group();
    if (alongZ) { pivot.position.set(at, y0, a0); pivot.rotation.y = -Math.PI / 2; } else pivot.position.set(a0, y0, at);
    pivot.userData.x0 = alongZ ? at : a0;
    const lb = new MeshBatch();
    leaf(lb, a1 - a0);
    pivot.add(lb.build(`cathDoor:${id}`));
    this.group.add(pivot);
    const mid = (a0 + a1) / 2;
    const pos = alongZ ? this.w(at, y0 + h / 2, mid) : this.w(mid, y0 + h / 2, at);
    const half = alongZ ? V(0.12, h / 2, Math.abs(a1 - a0) / 2) : V(Math.abs(a1 - a0) / 2, h / 2, 0.12);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount, colliderSpec: { pos, half } };
    return pivot;
  }

  private build() {
    const b = new MeshBatch();
    const m = this.mats();
    this.board = new LiveScreen(1024, 512, () => {});
    this.board.paint = (c, w, h) => paintBoard(c, w, h, { orders: 312, customers: 1, shift: 1407, floor: 'moving', owner: 'O. SAYLE', status: 'live' });
    this.board.repaint();
    this.buildHall(b, m);
    this.buildFront(b, m);
    this.buildTowers(b, m);
    this.buildButtresses(b, m);
    this.buildInside(b, m);
    this.buildAltar(b, m);
    this.buildApse(b, m);
    this.buildDock(b, m);
    this.buildReturns(b, m);
    this.buildLot(b, m);
    this.buildRoutes();
    this.buildLights();
    surfaces.zone(this.w(-44, -2, -40), this.w(44, 6, 62), 'concrete');
    surfaces.zone(this.w(CT.OFFICE[0] - 3, CT.MEZZ - 0.4, CT.OFFICE[2]), this.w(CT.OFFICE[1] + 5, CT.MEZZ + 3, -24), 'metal');

    this.far = b.buildFar('cathedral-far', { minSize: 1.4, keep: [m.rose, m.panes] });
    const statics = b.build('cathStatic');
    this.group.add(statics);
    this.group.add(this.halos.build());
    statics.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mesh.isMesh && mat && (mat.transparent || mat === m.print)) mesh.castShadow = false;
    });
    shadowProxy(statics);
    for (const d of Object.values(this.doors)) d.pivot.traverse((o) => { o.castShadow = false; });

    const near = new THREE.Group();
    near.name = 'cathedral-near';
    const keep = new Set<THREE.Object3D>([this.halos.sprite]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far);
    // a 36 m tower and a roof the height of a church: the stand-in carries it across the basin
    this.lod = new DistanceLod(this.origin.clone(), 22, near, this.far, 200, 1400);
  }

  private mats() {
    return {
      stone: concrete('#a89884', { scale: 0.45, stains: 0.7 }),
      dark: concrete('#6f655a', { scale: 0.5, stains: 0.75 }),
      pad: concrete('#8f887d', { scale: 0.9, stains: 0.55 }),
      floor: plainStandard('#7a7570', 0.55, 0.05),
      roof: plainStandard('#3b3f44', 0.6, 0.55),
      lead: plainStandard('#3e4246', 0.55, 0.6),
      steel: plainStandard('#9aa0a6', 0.35, 0.85),
      black: plainStandard('#141518', 0.5, 0.3),
      grey: plainStandard('#5c6066', 0.6, 0.4),
      white: plainStandard('#e6e2da', 0.6, 0.05),
      orange: plainStandard('#e8661e', 0.55, 0.1),
      yellow: plainStandard('#e2b42a', 0.6, 0.15),
      belt: plainStandard('#1e1f22', 0.85, 0.05),
      roller: plainStandard('#a8adb2', 0.3, 0.9),
      rack: plainStandard('#2f5d8a', 0.5, 0.5),
      rackBeam: plainStandard('#e8661e', 0.5, 0.4),
      tote: plainStandard('#2b6fb0', 0.55, 0.05),
      toteGrey: plainStandard('#7d8287', 0.6, 0.05),
      card: plainStandard('#b08a5a', 0.9, 0),
      pallet: wood('#9a7a52'),
      oak: wood('#7a5a3a'),
      door: plainStandard('#b9541c', 0.5, 0.1),
      glass: plainStandard('#9fb6bb', 0.08, 0.2, { transparent: true, opacity: 0.22, depthWrite: false }),
      water: plainStandard('#7fc4e0', 0.15, 0.05, { transparent: true, opacity: 0.6, depthWrite: false }),
      roll: corrugated('#cfcac0', 0.25, 'y'),
      pipe: rustyMetal({ base: '#a7aaa8', rust: 0.25, metalness: 0.7 }),
      post: rustyMetal({ base: '#8f918c', rust: 0.35, metalness: 0.6 }),
      rug: fabric('#3d3a36'),
      seat: fabric('#26282c'),
      rock: desertRock(),
      rose: roseMaterial(),
      panes: paneMaterial(),
      print: cathPrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the hall: nave, aisles, arcade, roofs
  private buildHall(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { NW, AW, Z0, Z1, NAVE_H, RIDGE, AISLE_H, AISLE_TOP, ARCH_H } = CT;
    const L = Z1 - Z0, zc = (Z0 + Z1) / 2;
    // the floor: polished concrete, the grid's yellow lines, a walkway down each aisle
    b.add(m.floor, place(new THREE.PlaneGeometry(AW * 2, L), 0, 0.02, zc, -Math.PI / 2));
    const gz0 = CT.GZ0 - CT.CELL / 2, gz1 = CT.GZ0 + (CT.ROWS - 0.5) * CT.CELL;
    for (let i = 0; i <= CT.COLS; i++) {
      const x = CT.GX0 - CT.CELL / 2 + i * CT.CELL;
      b.add(m.yellow, place(new THREE.PlaneGeometry(0.06, gz1 - gz0), x, 0.03, (gz0 + gz1) / 2, -Math.PI / 2));
    }
    for (let j = 0; j <= CT.ROWS; j++) {
      const z = gz0 + j * CT.CELL;
      b.add(m.yellow, place(new THREE.PlaneGeometry(CT.COLS * CT.CELL, 0.06), 0, 0.03, z, -Math.PI / 2));
    }
    // a fiducial sticker in every cell (the drives read them)
    for (let i = 0; i < CT.COLS; i++) for (let j = 0; j < CT.ROWS; j++) b.add(m.black, place(new THREE.PlaneGeometry(0.14, 0.14), CT.GX0 + i * CT.CELL, 0.031, CT.GZ0 + j * CT.CELL, -Math.PI / 2));
    // aisle outer walls (x ±19), with tall lancet panes (opaque, lit)
    for (const s of [-1, 1]) {
      const segs: { z0: number; z1: number }[] = [];
      // the dock opening in the east wall (z 11.5…16.5); the returns flap is small and cut separately
      if (s > 0) segs.push({ z0: Z0, z1: -5 }, { z0: -3, z1: 11.5 }, { z0: 16.5, z1: Z1 });
      else segs.push({ z0: Z0, z1: Z1 });
      for (const sg of segs) {
        b.add(m.stone, box(0.8, AISLE_H, sg.z1 - sg.z0, s * (AW + 0.4), AISLE_H / 2, (sg.z0 + sg.z1) / 2));
        this.col(s * (AW + 0.4), AISLE_H / 2, (sg.z0 + sg.z1) / 2, 0.4, AISLE_H / 2, (sg.z1 - sg.z0) / 2);
      }
      if (s > 0) {
        // over the dock: the wall above the door; round the flap: a sill and a lintel
        b.add(m.stone, box(0.8, AISLE_H - 5.2, 5, s * (AW + 0.4), 5.2 + (AISLE_H - 5.2) / 2, 14));
        b.add(m.stone, box(0.8, 0.45, 2, s * (AW + 0.4), 0.225, -4), box(0.8, AISLE_H - 1.6, 2, s * (AW + 0.4), 1.6 + (AISLE_H - 1.6) / 2, -4));
        this.col(s * (AW + 0.4), 0.225, -4, 0.4, 0.225, 1);
        this.col(s * (AW + 0.4), 1.6 + (AISLE_H - 1.6) / 2, -4, 0.4, (AISLE_H - 1.6) / 2, 1);
      }
      for (let z = Z0 + 3; z < Z1; z += 6) {
        if (s > 0 && (Math.abs(z - 14) < 4 || Math.abs(z + 4) < 2)) continue;
        const g = lancet(1.6, 1.6, 4.6, 6.6);
        b.add(m.panes, place(g.clone(), s * (AW + 0.82), 0, z, 0, s * Math.PI / 2));
        b.add(m.panes, place(g, s * (AW - 0.02), 0, z, 0, -s * Math.PI / 2));
        b.add(m.dark, box(0.9, 0.18, 1.9, s * (AW + 0.4), 1.5, z));
      }
      // the aisle roof: a lean-to of lead from the outer wall up to the nave wall
      const r0 = V(s * (AW + 0.9), AISLE_H + 0.1, 0), r1 = V(s * NW, AISLE_TOP, 0);
      const len = r0.distanceTo(r1), ang = Math.atan2(r1.y - r0.y, Math.abs(r1.x - r0.x));
      b.add(m.lead, box(len, 0.25, L + 1.2, (r0.x + r1.x) / 2, (r0.y + r1.y) / 2, zc, 0, 0, -s * ang));
      b.add(m.dark, box(len, 0.06, L + 1.0, (r0.x + r1.x) / 2, (r0.y + r1.y) / 2 - 0.16, zc, 0, 0, -s * ang));
      this.col((r0.x + r1.x) / 2, (r0.y + r1.y) / 2, zc, len / 2, 0.15, L / 2, 0);
    }
    // the arcade (x ±12): piers, pointed arches, the clerestory wall above, panes in it
    for (const s of [-1, 1]) {
      const openings = [];
      for (let k = 0; k < CT.PIERS.length - 1; k++) {
        const z0 = CT.PIERS[k], z1 = CT.PIERS[k + 1];
        openings.push({ x: -((z0 + z1) / 2 - zc), w: (z1 - z0) - 1.3, y0: 0, y1: ARCH_H });
      }
      const g = archWall(L, NAVE_H, 1.0, openings);
      g.rotateY(Math.PI / 2);
      g.translate(s * NW, 0, zc);
      b.add(m.stone, norm(g));
      for (const z of CT.PIERS) {
        this.col(s * NW, ARCH_H / 2, z, 0.5, ARCH_H / 2, 0.65);
        // a shaft up the pier to the vault springing
        b.add(m.dark, cyl(0.22, 0.22, NAVE_H - 0.2, s * (NW - 0.62), (NAVE_H - 0.2) / 2, z, 8));
      }
      this.col(s * NW, ARCH_H + (NAVE_H - ARCH_H) / 2, zc, 0.5, (NAVE_H - ARCH_H) / 2, L / 2);
      // clerestory: two lancets per bay over the aisle roof
      for (let k = 0; k < CT.PIERS.length - 1; k++) {
        const zm = (CT.PIERS[k] + CT.PIERS[k + 1]) / 2;
        for (const dz of [-1.3, 1.3]) {
          const pg = lancet(1.3, AISLE_TOP + 0.8, NAVE_H - 2.2, NAVE_H - 0.8);
          b.add(m.panes, place(pg.clone(), s * (NW + 0.52), 0, zm + dz, 0, s * Math.PI / 2));
          b.add(m.panes, place(pg, s * (NW - 0.52), 0, zm + dz, 0, -s * Math.PI / 2));
        }
      }
    }
    // string courses: a dark moulding at the aisle eaves and under the nave's eaves, both sides
    for (const s of [-1, 1]) {
      b.add(m.dark, box(0.35, 0.3, L + 1.2, s * (AW + 0.85), AISLE_H - 0.15, zc), box(0.3, 0.25, L + 1.2, s * (AW + 0.85), 3.0, zc));
      b.add(m.dark, box(0.3, 0.35, L + 1.0, s * (NW + 0.55), NAVE_H - 0.15, zc));
      // a parapet of little pinnacles along the nave's eaves
      for (let z = CT.Z0 + 1.5; z < CT.Z1; z += 3) b.add(m.stone, place(new THREE.ConeGeometry(0.22, 1.1, 4), s * (NW + 0.55), NAVE_H + 0.5, z, 0, Math.PI / 4));
    }
    // the nave roof: two steep slopes of lead to the ridge, ribs underneath, a ridge crest
    const half = NW + 0.6, rise = RIDGE - NAVE_H;
    const slope = Math.hypot(half, rise), a = Math.atan2(rise, half);
    for (const s of [-1, 1]) {
      b.add(m.lead, box(slope, 0.3, L + 1.0, s * half / 2, NAVE_H + rise / 2, zc, 0, 0, -s * a));
      b.add(m.dark, box(slope, 0.05, L + 0.8, s * half / 2, NAVE_H + rise / 2 - 0.2, zc, 0, 0, -s * a));
    }
    b.add(m.lead, box(0.5, 0.5, L + 1.2, 0, RIDGE + 0.1, zc));
    for (let z = Z0 + 1; z < Z1; z += 3) b.add(m.lead, place(new THREE.ConeGeometry(0.18, 0.7, 4), 0, RIDGE + 0.6, z));
    // the vault ribs: pointed arches across the nave at each pier
    // (each rib is a pointed arch kept 0.6 m under the roof's slope)
    const under = (x: number) => NAVE_H + rise * (1 - Math.abs(x) / half) - 0.6;
    for (const z of CT.PIERS) {
      const pts = archPoints(NW * 2 - 1.2, NAVE_H - 3, RIDGE - 1.5, 12);
      const full = [...pts, ...pts.slice(0, -1).reverse().map((q) => new THREE.Vector2(-q.x, q.y))].map((q) => new THREE.Vector2(q.x, Math.min(q.y, under(q.x))));
      for (let i = 0; i < full.length - 1; i++) b.add(m.dark, beam(V(full[i].x, full[i].y, z), V(full[i + 1].x, full[i + 1].y, z), 0.16, 4));
    }
    // the gable over the apse end: a wall up to the roof line at z −24 above the apse's own roof
    const gs = new THREE.Shape();
    gs.moveTo(-NW - 0.6, NAVE_H); gs.lineTo(NW + 0.6, NAVE_H); gs.lineTo(0, RIDGE + 0.3); gs.lineTo(-NW - 0.6, NAVE_H);
    const gg = new THREE.ExtrudeGeometry(gs, { depth: 0.8, bevelEnabled: false });
    gg.translate(0, 0, Z0 - 0.4);
    b.add(m.stone, norm(gg));
    // hanging lamps down the nave (pendant cages), and the hall's halos
    const hall = this.pal.slot('#ffc98a', 1.4);
    this.slots.hall = hall.intensity;
    for (let z = Z0 + 6; z < Z1 - 2; z += 8) for (const x of [-5, 5]) {
      b.add(m.black, beam(V(x, 13.2, z), V(x, 10.2, z), 0.015, 3), cyl(0.5, 0.2, 0.35, x, 10.0, z, 10));
      hall.add(b, cyl(0.42, 0.42, 0.04, x, 9.82, z, 10));
      this.halos.add(V(x, 9.7, z), '#ffc98a', 2.4, CathedralBuilder.CH.HALL, 0.6);
    }
    // the rack walls across the aisles (back-to-back shelving to 6 m: totes and cartons)
    const r = rng(41);
    for (const s of [-1, 1]) for (const z of CT.CUTS) {
      const x0 = s * (NW + 0.6), x1 = s * (AW - 0.05), xm = (x0 + x1) / 2, wd = Math.abs(x1 - x0);
      b.add(m.rack, box(0.1, 6, 0.1, x0, 3, z - 0.5), box(0.1, 6, 0.1, x0, 3, z + 0.5), box(0.1, 6, 0.1, x1, 3, z - 0.5), box(0.1, 6, 0.1, x1, 3, z + 0.5));
      for (let y = 0.15; y < 6; y += 1.45) {
        b.add(m.rackBeam, box(wd, 0.12, 0.08, xm, y, z - 0.5), box(wd, 0.12, 0.08, xm, y, z + 0.5));
        b.add(m.grey, box(wd, 0.03, 1.0, xm, y + 0.07, z));
        for (let x = Math.min(x0, x1) + 0.4; x < Math.max(x0, x1) - 0.3; x += 0.62) {
          const h = 0.3 + r() * 0.7;
          b.add(r() < 0.5 ? m.card : m.tote, box(0.56, h, 0.9, x, y + 0.09 + h / 2, z));
        }
      }
      this.col(xm, 3, z, wd / 2, 3, 0.55);
    }
  }

  // ------------------------------------------------------------------ the front: wall, doors, rose window
  private buildFront(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { NW, AW, Z1, NAVE_H, RIDGE, AISLE_H } = CT;
    const D = 1.2, z = Z1 + D / 2;
    // the nave front: a gabled wall with the door arch and the rose's round hole
    const s = new THREE.Shape();
    s.moveTo(-NW - 0.6, 0); s.lineTo(-2.2, 0); s.lineTo(-2.2, 4.6);
    traceArch(s, 0, 4.4, 4.6, 7.4);
    s.lineTo(2.2, 0); s.lineTo(NW + 0.6, 0); s.lineTo(NW + 0.6, NAVE_H); s.lineTo(0, RIDGE + 1.2); s.lineTo(-NW - 0.6, NAVE_H); s.lineTo(-NW - 0.6, 0);
    const rose = new THREE.Path();
    rose.absarc(0, 14.2, 4.6, 0, Math.PI * 2, true);
    s.holes.push(rose);
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 40 });
    g.translate(0, 0, Z1);
    b.add(m.stone, norm(g));
    this.col(-NW / 2 - 1.4, NAVE_H / 2, z, NW / 2 - 0.85, NAVE_H / 2, D / 2);
    this.col(NW / 2 + 1.4, NAVE_H / 2, z, NW / 2 - 0.85, NAVE_H / 2, D / 2);
    this.col(0, 7.4 + (NAVE_H - 7.4) / 2, z, 2.4, (NAVE_H - 7.4) / 2, D / 2);
    // buttresses up the front where nave meets aisle, each ending in a pinnacle
    for (const sx of [-1, 1]) {
      const bx = sx * (NW + 0.7);
      b.add(m.stone, box(1.4, NAVE_H + 1.5, 1.6, bx, (NAVE_H + 1.5) / 2, Z1 + D + 0.2), box(1.8, 4, 2.0, bx, 2, Z1 + D + 0.3));
      b.add(m.dark, box(1.5, 0.3, 1.7, bx, 8, Z1 + D + 0.22), box(1.5, 0.3, 1.7, bx, NAVE_H + 1.5, Z1 + D + 0.22));
      b.add(m.stone, place(new THREE.ConeGeometry(0.75, 4.5, 4), bx, NAVE_H + 3.8, Z1 + D + 0.2, 0, Math.PI / 4));
      this.col(bx, 2, Z1 + D + 0.3, 0.9, 2, 1.0);
    }
    // the gable's coping, a finial (Dropt's arrow, in iron), a band of blind arcading over the door
    {
      const gL = Math.hypot(NW + 0.6, RIDGE + 1.2 - NAVE_H), ga = Math.atan2(RIDGE + 1.2 - NAVE_H, NW + 0.6);
      for (const sx of [-1, 1]) b.add(m.dark, box(gL, 0.45, D + 0.3, sx * (NW + 0.6) / 2, NAVE_H + (RIDGE + 1.2 - NAVE_H) / 2 + 0.15, Z1 + D / 2, 0, 0, -sx * ga));
      // (no cross: a delivery beacon on a mast, Dropt's box on a plate under it)
      b.add(m.black, cyl(0.07, 0.1, 2.6, 0, RIDGE + 2.4, Z1 + D / 2, 6), box(0.9, 0.9, 0.12, 0, RIDGE + 1.7, Z1 + D / 2 + 0.1));
      b.add(m.orange, box(0.8, 0.8, 0.02, 0, RIDGE + 1.7, Z1 + D / 2 + 0.17));
      this.pal.slot('#ff2a14', 3).add(b, place(new THREE.SphereGeometry(0.16, 8, 6), 0, RIDGE + 3.8, Z1 + D / 2));
      this.halos.add(V(0, RIDGE + 3.8, Z1 + D / 2), '#ff2a14', 1.8, CathedralBuilder.CH.BLINK, 1.2);
      for (let i = -4; i <= 4; i++) {
        const x = i * 1.15;
        if (Math.abs(x) < 2.6) continue;
        const lg = lancet(0.7, 4.6, 6.0, 7.2);
        b.add(m.dark, place(lg, x, 0, Z1 + D + 0.01));
      }
      b.add(m.dark, box(NW * 2 + 1.2, 0.35, 0.25, 0, 7.9, Z1 + D + 0.1), box(NW * 2 + 1.2, 0.3, 0.25, 0, 4.4, Z1 + D + 0.1));
    }
    // the aisles' fronts
    for (const sx of [-1, 1]) {
      const lx = sx * (NW + 3.8);
      const lg = lancet(1.4, 2.0, 4.6, 6.6);
      b.add(m.panes, place(lg, lx, 0, Z1 + D + 0.01));
      b.add(m.stone, box(AW - NW - 0.6, AISLE_H, D, sx * (NW + 0.6 + (AW - NW - 0.6) / 2), AISLE_H / 2, z));
      this.col(sx * (NW + 0.6 + (AW - NW - 0.6) / 2), AISLE_H / 2, z, (AW - NW - 0.6) / 2, AISLE_H / 2, D / 2);
    }
    // the rose window: glass (the clock), a stone ring, the hand (the runtime turns it), a hood moulding
    const roseG = new THREE.CircleGeometry(4.62, 64);
    b.add(m.rose, place(roseG.clone(), 0, 14.2, Z1 + D - 0.35));
    b.add(m.rose, place(roseG, 0, 14.2, Z1 + 0.3, 0, Math.PI));
    b.add(m.dark, place(new THREE.TorusGeometry(4.75, 0.28, 6, 64), 0, 14.2, Z1 + D - 0.15));
    const hand = new THREE.Group();
    hand.position.set(0, 14.2, Z1 + D - 0.2);
    const hb = new MeshBatch();
    hb.add(m.black, box(0.22, 3.6, 0.08, 0, 1.6, 0), place(new THREE.ConeGeometry(0.32, 0.6, 3), 0, 3.6, 0));
    hb.add(m.black, cyl(0.3, 0.3, 0.12, 0, 0, 0, 12, Math.PI / 2));
    hand.add(hb.build('cathHand'));
    this.group.add(hand);
    this.hand = hand;
    // the door: two orange leaves in the arch (they slide apart at the ending), the sign over them
    const dz = Z1 + D / 2;
    b.add(m.print, cathPrint('facade', 6.4, 1.6, M(0, 8.6, Z1 + D + 0.02, 0)));
    for (const sx of [-1, 1]) {
      this.slideDoor(sx < 0 ? 'frontW' : 'frontE', sx < 0 ? -2.15 : 0, sx < 0 ? 0 : 2.15, 0, dz, 4.6, sx * 2.1, (lb, wd) => {
        lb.add(m.door, box(wd, 4.58, 0.12, wd / 2, 2.29, 0));
        for (let k = 0; k < 4; k++) lb.add(m.black, box(wd - 0.2, 0.04, 0.14, wd / 2, 0.6 + k * 1.15, 0));
        lb.add(m.print, cathPrint('frontDoor', 1.6, 1.6, M(wd / 2, 2.4, 0.07, 0)));
      });
    }
    b.add(m.door, box(4.4, 2.9, 0.12, 0, 4.6 + 1.3, dz));
    this.portals.push({ box: new THREE.Box3(this.w(-2.6, 0, Z1 - 1.5), this.w(2.6, 4.8, Z1 + D + 1.5)), open: () => this.frontOpen() });
    // steps down to the lot, a canopy of stone over the door
    for (let i = 0; i < 3; i++) b.add(m.stone, box(7 - i * 0.6, 0.16, 1.2 - i * 0.35, 0, 0.08 + i * 0.16 - 0.32, Z1 + D + 0.6 - i * 0.2));
    this.points.front = this.w(0, 1.2, Z1 + D + 2);
    this.points.frontIn = this.w(0, 1.0, Z1 - 3);
    // a row of statues' niches across the front, empty except for one parcel left in the middle one
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const x = i * 1.6;
      if (Math.abs(x) < 2.6) continue;
      b.add(m.dark, box(0.9, 1.9, 0.3, x, 10.1, Z1 + D + 0.05));
    }
    b.add(m.card, box(0.5, 0.35, 0.4, 0, 9.55, Z1 + D + 0.1));
  }

  // ------------------------------------------------------------------ the two towers
  private buildTowers(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { AW, Z1 } = CT;
    const T = 6.4, zc = Z1 - 2.4;
    const avi = this.pal.slot('#ff2a14', 3);
    this.slots.aviation = avi.intensity;
    const tower = this.pal.slot('#ffd29a', 1.6);
    this.slots.tower = tower.intensity;
    for (const sx of [-1, 1]) {
      const xc = sx * (AW + T / 2 - 0.4);
      const H = sx < 0 ? 30 : 26;
      // the shaft in three stages, set back at each, with corner buttresses
      const stages: [number, number, number][] = [[0, 12, T], [12, 22, T - 0.8], [22, H, T - 1.6]];
      for (const [y0, y1, wd] of stages) {
        b.add(m.stone, box(wd, y1 - y0, wd, xc, (y0 + y1) / 2, zc));
        b.add(m.dark, box(wd + 0.2, 0.35, wd + 0.2, xc, y1, zc));
      }
      this.col(xc, 15, zc, T / 2, 15, T / 2);
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.add(m.stone, box(0.9, 18, 0.9, xc + cx * (T / 2 + 0.2), 9, zc + cz * (T / 2 + 0.2)));
      // lancets up the shaft, front and back, and on the outer face
      for (const y of [6, 16]) {
        const half = (y < 12 ? T : T - 0.8) / 2 + 0.03;
        for (const face of [-1, 1]) b.add(m.panes, place(lancet(1.0, y - 1.8, y + 0.6, y + 1.8), xc, 0, zc + face * half, 0, face < 0 ? Math.PI : 0));
        b.add(m.panes, place(lancet(1.0, y - 1.8, y + 0.6, y + 1.8), xc + sx * half, 0, zc, 0, sx * Math.PI / 2));
      }
      if (sx < 0) {
        // the bell tower is the drone port: an open belfry of bays (no bells), a pyramid spire over it
        const bw = T - 1.6, by0 = 22, by1 = H;
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.add(m.stone, box(0.7, by1 - by0, 0.7, xc + cx * (bw / 2 - 0.35), (by0 + by1) / 2, zc + cz * (bw / 2 - 0.35)));
        b.add(m.dark, box(bw, 0.3, bw, xc, by0 + 0.15, zc));
        // landing pads with orange rings on two levels, a charging rail
        for (const y of [by0 + 0.4, by0 + 4]) {
          b.add(m.grey, box(bw - 1.2, 0.08, bw - 1.2, xc, y, zc));
          b.add(m.orange, place(new THREE.TorusGeometry(1.1, 0.05, 4, 24), xc, y + 0.05, zc, Math.PI / 2));
          tower.add(b, place(new THREE.TorusGeometry(1.4, 0.03, 4, 24), xc, y + 0.06, zc, Math.PI / 2));
        }
        const sp = new THREE.ConeGeometry(bw * 0.72, 10, 4);
        sp.rotateY(Math.PI / 4);
        b.add(m.lead, place(sp, xc, by1 + 5, zc));
        b.add(m.steel, beam(V(xc, by1 + 10, zc), V(xc, by1 + 13, zc), 0.06, 6));
        avi.add(b, place(new THREE.SphereGeometry(0.2, 8, 6), xc, by1 + 13.1, zc));
        this.halos.add(V(xc, by1 + 13.1, zc), '#ff2a14', 2.2, CathedralBuilder.CH.BLINK, 1.5);
        this.halos.add(V(xc, by0 + 2.5, zc), '#ffd29a', 5, CathedralBuilder.CH.NIGHT, 0.5);
        this.launch = this.w(xc, by0 + 2.5, zc);
        b.add(m.print, cathPrint('dronePort', 3.2, 1.0, M(xc, 13, zc + T / 2 - 0.35, 0)));
        // the swarm's control panel at the tower's foot (outside, on the south face)
        const px = xc + 1.6, pz = zc + T / 2 + 0.25;
        b.add(m.grey, box(0.9, 1.4, 0.35, px, 0.9, pz));
        b.add(m.print, cathPrint('swarmPanel', 0.7, 0.7, M(px, 1.15, pz + 0.18, 0)));
        const panel = this.pal.slot('#5fe08a', 1.5);
        this.slots.panel = panel.intensity;
        panel.add(b, box(0.1, 0.04, 0.02, px + 0.3, 1.66, pz + 0.18));
        this.col(px, 0.9, pz, 0.45, 0.9, 0.18);
        this.points.panel = this.w(px, 1.2, pz + 1.1);
      } else {
        // the east tower: a lead cap and the big Dropt sign on its face
        const cap = new THREE.ConeGeometry((T - 1.6) * 0.72, 6, 4);
        cap.rotateY(Math.PI / 4);
        b.add(m.lead, place(cap, xc, H + 3, zc));
        b.add(m.print, cathPrint('facade', 4.4, 1.1, M(xc, H - 2.5, zc + (T - 1.6) / 2 + 0.03, 0)));
        avi.add(b, place(new THREE.SphereGeometry(0.16, 8, 6), xc, H + 6.1, zc));
      }
    }
  }

  // ------------------------------------------------------------------ flying buttresses (with conveyors on their backs)
  private buildButtresses(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { NW, AW, NAVE_H } = CT;
    for (const sx of [-1, 1]) for (const z of [-18, -6, 6]) {
      const px = sx * (AW + 3.2);
      // the pier: stepped, with a pinnacle
      b.add(m.stone, box(1.4, 11.5, 1.6, px, 5.75, z), box(1.8, 3, 2.0, px, 1.5, z));
      b.add(m.lead, place(new THREE.ConeGeometry(0.75, 2.6, 4), px, 12.8, z, 0, Math.PI / 4));
      this.col(px, 5.75, z, 0.9, 5.75, 1.0);
      // the flyer: a sloping arm from the pier to the clerestory wall, a conveyor on top
      const a = V(px - sx * 0.7, 11.2, z), c = V(sx * (NW + 0.5), NAVE_H - 1.6, z);
      const len = a.distanceTo(c), ang = Math.atan2(c.y - a.y, Math.abs(c.x - a.x));
      const mid = a.clone().add(c).multiplyScalar(0.5);
      const rz = -sx * ang;
      b.add(m.stone, box(len, 0.7, 1.0, mid.x, mid.y - 0.35, z, 0, 0, rz));
      b.add(m.belt, box(len, 0.1, 0.7, mid.x, mid.y + 0.1, z, 0, 0, rz));
      b.add(m.yellow, box(len, 0.16, 0.06, mid.x, mid.y + 0.12, z - 0.38, 0, 0, rz), box(len, 0.16, 0.06, mid.x, mid.y + 0.12, z + 0.38, 0, 0, rz));
      // a few cartons stranded on the belt
      for (let k = 1; k < 3; k++) {
        const p = a.clone().lerp(c, k / 3);
        b.add(m.card, box(0.45, 0.3, 0.4, p.x, p.y + 0.3, z, 0, 0, rz));
      }
      void AW;
    }
  }

  // ------------------------------------------------------------------ inside: narthex, stations, kiosk, overhead conveyors
  private buildInside(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { NW, AW, Z1 } = CT;
    // the floor kiosk in the narthex (E-stop: SPLICE), and a row of empty roll cages
    const kx = -7.5, kz = 15.2;
    b.add(m.grey, box(0.7, 1.5, 0.5, kx, 0.75, kz));
    b.add(m.print, cathPrint('floorKiosk', 0.6, 0.6, M(kx, 1.15, kz + 0.26, 0)));
    const fl = this.pal.slot('#5fe08a', 1.4), fs = this.pal.slot('#ffb347', 0);
    this.slots.floor = fl.intensity;
    this.slots.floorStop = fs.intensity;
    fl.add(b, box(0.5, 0.05, 0.02, kx, 1.55, kz + 0.26));
    fs.add(b, box(0.5, 0.05, 0.02, kx, 1.62, kz + 0.26));
    this.col(kx, 0.75, kz, 0.35, 0.75, 0.25);
    this.points.kioskFloor = this.w(kx, 1.2, kz + 1.1);
    for (let i = 0; i < 6; i++) {
      const x = 3 + i * 1.0, z = 18.5;
      b.add(m.steel, box(0.8, 1.6, 0.04, x, 0.95, z - 0.45), box(0.8, 1.6, 0.04, x, 0.95, z + 0.45), box(0.04, 1.6, 0.9, x - 0.4, 0.95, z), box(0.8, 0.04, 0.9, x, 0.2, z));
    }
    this.col(5.5, 0.95, 18.5, 3.0, 0.95, 0.5);
    b.add(m.print, cathPrint('bannerObsess', 1.4, 4.2, M(-8, 9, CT.Z1 - 1.5, 0)));
    // culture banners on the arcade piers facing the nave
    const bn = ['bannerDay', 'bannerRate', 'bannerMile', 'bannerObsess'];
    [-12, 0, 12, -6].forEach((z, i) => {
      const s = i % 2 === 0 ? -1 : 1;
      b.add(m.print, cathPrint(bn[i], 1.2, 3.6, M(s * (NW - 0.75), 7.2, z + 1.2, -s * Math.PI / 2)));
    });
    // aisle numbers hung over the floor
    b.add(m.print, cathPrint('aisle9', 1.2, 1.2, M(0, 7.5, 12.6, 0)), cathPrint('aisle4', 1.2, 1.2, M(0, 7.5, -17.2, Math.PI)));
    b.add(m.black, beam(V(0, 8.1, 12.6), V(0, 13, 12.6), 0.01, 3), beam(V(0, 8.1, -17.2), V(0, 13, -17.2), 0.01, 3));
    // the pick stations in the west arcade: a frame, a light curtain, a screen, a tote shelf
    const st = this.pal.slot('#9fe0ff', 1.2);
    this.slots.stations = st.intensity;
    this.stations = [];
    for (const z of [-3, 9]) {
      const x = -NW - 1.6;
      b.add(m.steel, box(0.08, 2.2, 0.08, x + 1.0, 1.1, z - 1.0), box(0.08, 2.2, 0.08, x + 1.0, 1.1, z + 1.0), box(0.08, 0.08, 2.0, x + 1.0, 2.2, z));
      b.add(m.grey, box(1.4, 0.9, 0.6, x - 0.4, 0.45, z + 1.3), box(0.9, 0.05, 2.0, x - 0.6, 0.95, z));
      for (let k = 0; k < 3; k++) b.add(m.tote, box(0.55, 0.3, 0.4, x - 0.6, 1.13, z - 0.65 + k * 0.62));
      b.add(m.black, box(0.04, 0.4, 0.6, x - 1.0, 1.6, z + 1.3));
      st.add(b, box(0.01, 0.34, 0.54, x - 0.97, 1.6, z + 1.3));
      b.add(m.print, cathPrint('station', 1.3, 0.4, M(x - 0.4, 2.45, z, Math.PI / 2)));
      this.col(x - 0.5, 0.5, z, 0.5, 0.5, 1.1);
      this.stations.push({ pos: this.w(x - 0.1, 0, z), yaw: Math.PI / 2 });
    }
    // the overhead conveyor down each side of the nave (the outbound line), on hangers
    for (const s of [-1, 1]) {
      const x = s * (NW - 1.6), y = 7.0;
      b.add(m.belt, box(0.7, 0.1, 38, x, y, 2));
      b.add(m.yellow, box(0.06, 0.2, 38, x - 0.38, y + 0.05, 2), box(0.06, 0.2, 38, x + 0.38, y + 0.05, 2));
      for (let z = -16; z < CT.Z1 - 3; z += 3) b.add(m.steel, beam(V(x - 0.4, y, z), V(x - 0.4, 12.5, z), 0.015, 3), beam(V(x + 0.4, y, z), V(x + 0.4, 12.5, z), 0.015, 3));
      const r = rng(s > 0 ? 3 : 7);
      for (let z = -16; z < CT.Z1 - 4; z += 1.7 + r() * 2.5) b.add(r() < 0.5 ? m.card : m.tote, box(0.5, 0.3 + r() * 0.15, 0.4, x, y + 0.25, z));
    }
    void AW; void Z1;
  }

  // ------------------------------------------------------------------ the crossing: altar, board, Lo's desk, the returns table
  private buildAltar(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    // the pack line: a long steel table, tape guns, a chute rising out of it toward the office
    const az = -20.5;
    b.add(m.steel, box(7.5, 0.06, 1.3, 0, 0.92, az));
    for (const x of [-3.5, -1.2, 1.2, 3.5]) b.add(m.grey, box(0.08, 0.9, 1.1, x, 0.45, az));
    b.add(m.grey, box(7.3, 0.04, 1.1, 0, 0.3, az));
    const r = rng(19);
    for (let i = 0; i < 9; i++) b.add(m.card, box(0.3 + r() * 0.3, 0.2 + r() * 0.2, 0.3 + r() * 0.2, -3.2 + i * 0.8, 1.05 + r() * 0.05, az + (r() - 0.5) * 0.6));
    this.col(0, 0.5, az, 3.75, 0.5, 0.65);
    // the outbound chute: a spiral of rollers up to the office (decorative)
    for (let i = 0; i < 40; i++) {
      const t = i / 40, a = t * Math.PI * 3, y = 1.1 + t * (CT.MEZZ + 1.0);
      const p = V(3.8 + Math.cos(a) * 1.0, y, az - 2.2 + Math.sin(a) * 1.0);
      b.add(m.roller, box(0.7, 0.05, 0.12, p.x, p.y, p.z, -a));
    }
    b.add(m.steel, cyl(0.12, 0.12, CT.MEZZ + 1.5, 3.8, (CT.MEZZ + 1.5) / 2, az - 2.2, 8));
    this.col(3.8, 3.5, az - 2.2, 1.1, 3.5, 1.1);
    // the board, hung from the vault over the altar facing down the nave
    const by = 9.2, bz = az - 1.0;
    b.add(m.black, box(6.6, 3.4, 0.16, 0, by, bz));
    const face = new THREE.PlaneGeometry(6.3, 3.1);
    face.applyMatrix4(M(0, by, bz + 0.085, 0));
    const mesh = new THREE.Mesh(norm(face), this.board.material);
    mesh.castShadow = false;
    this.group.add(mesh);
    b.add(m.steel, beam(V(-2.8, by + 1.7, bz), V(-2.8, 15.5, bz), 0.025, 4), beam(V(2.8, by + 1.7, bz), V(2.8, 15.5, bz), 0.025, 4));
    const altar = this.pal.slot('#ffe6c0', 1.0);
    this.slots.altar = altar.intensity;
    // a light bar over the pack line: a dark housing, the tube on its underside
    b.add(m.black, box(7.3, 0.12, 0.34, 0, 2.68, az + 0.5));
    altar.add(b, box(7.1, 0.02, 0.2, 0, 2.61, az + 0.5));
    b.add(m.black, beam(V(-3.6, 2.6, az + 0.5), V(-3.6, 9, az + 0.5), 0.012, 3), beam(V(3.6, 2.6, az + 0.5), V(3.6, 9, az + 0.5), 0.012, 3));
    this.halos.add(V(0, 2.5, az + 0.5), '#ffe6c0', 3, CathedralBuilder.CH.ALTAR, 0.5);
    this.points.altar = this.w(0, 1.2, az + 1.6);
    this.carrierRoute = [this.w(5.0, 0, -18.4), this.w(-1, 0, -18.3), this.w(-7.2, 0, -18.4)];
    this.points.speaker = this.w(0, 8, -10);
    // Lo's desk on the west side of the crossing: a stand-up desk, the whiteboard, a radio, her mug
    const lx = -9.0, lz = -20.5;
    b.add(m.oak, box(1.6, 0.06, 0.7, lx, 1.05, lz));
    b.add(m.grey, box(0.06, 1.0, 0.6, lx - 0.75, 0.5, lz), box(0.06, 1.0, 0.6, lx + 0.75, 0.5, lz));
    b.add(m.white, box(2.2, 1.6, 0.05, lx - 0.2, 1.9, lz - 1.4));
    b.add(m.print, cathPrint('loBoard', 2.0, 1.5, M(lx - 0.2, 1.9, lz - 1.37, 0)));
    b.add(m.black, box(0.12, 0.22, 0.08, lx + 0.5, 1.19, lz - 0.1), cyl(0.045, 0.04, 0.1, lx - 0.4, 1.13, lz + 0.1, 8));
    this.col(lx, 0.55, lz, 0.85, 0.55, 0.4);
    this.loSpot = { pos: this.w(lx, 0, lz - 0.75), yaw: 0 };
    this.points.lo = this.w(lx, 1.2, lz + 1.4);
    // the returns table (where the line drops you), on the east of the crossing
    const rx = 6.4, rz = -21.0;
    b.add(m.steel, box(2.2, 0.06, 1.2, rx, 0.85, rz));
    for (const dx of [-1, 1]) b.add(m.grey, box(0.06, 0.85, 1.0, rx + dx * 1.0, 0.42, rz));
    b.add(m.toteGrey, box(0.6, 0.35, 0.45, rx - 0.5, 1.05, rz), box(0.6, 0.35, 0.45, rx + 0.4, 1.05, rz + 0.1));
    this.col(rx, 0.45, rz, 1.1, 0.45, 0.6);
    // the plaque on the stair's newel post
    const [sx0, , sz0] = CT.STAIR;
    b.add(m.oak, box(0.24, 1.25, 0.24, sx0 - 0.15, 0.62, sz0 + 0.3));
    b.add(m.print, cathPrint('plaque', 0.22, 0.11, M(sx0 - 0.15, 0.95, sz0 + 0.43, 0)));
    this.points.plaque = this.w(sx0 - 0.4, 1.1, sz0 + 1.2);
  }

  // ------------------------------------------------------------------ the apse: its wall and roof, the stair, the mezzanine, the office
  private buildApse(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const { APSE_R: R, Z0, NAVE_H, MEZZ } = CT;
    // the half-round wall (lathe), with lancets, and a half-cone roof
    const lath = (r: number, out: boolean) => b.add(m.stone, place(new THREE.LatheGeometry(out ? [new THREE.Vector2(r, 0), new THREE.Vector2(r, NAVE_H)] : [new THREE.Vector2(r, NAVE_H), new THREE.Vector2(r, 0)], 32, Math.PI / 2, Math.PI), 0, 0, Z0));
    lath(R + 0.8, true);
    lath(R, false);
    b.add(m.stone, place(new THREE.RingGeometry(R, R + 0.8, 32, 1, 0, Math.PI), 0, NAVE_H, Z0, -Math.PI / 2));
    const cone = new THREE.ConeGeometry(R + 1.0, CT.RIDGE - NAVE_H, 32, 1, true, Math.PI / 2, Math.PI);
    b.add(m.lead, place(cone, 0, NAVE_H + (CT.RIDGE - NAVE_H) / 2, Z0));
    b.add(m.dark, place(new THREE.CircleGeometry(R, 32, Math.PI, Math.PI), 0, NAVE_H - 0.05, Z0, Math.PI / 2));
    for (let i = 0; i < 12; i++) {
      const a = Math.PI + (i + 0.5) / 12 * Math.PI, half = (R + 0.4) * Math.tan(Math.PI / 24) + 0.05;
      const x = Math.cos(a) * (R + 0.4), z = Z0 + Math.sin(a) * (R + 0.4);
      this.col(x, NAVE_H / 2, z, half, NAVE_H / 2, 0.4, -a + Math.PI / 2);
      if (i % 2 === 0 && i > 1 && i < 11) {
        b.add(m.panes, place(new THREE.PlaneGeometry(1.1, 3.6), Math.cos(a) * (R - 0.02), 10.5, Z0 + Math.sin(a) * (R - 0.02), 0, -a - Math.PI / 2));
        b.add(m.panes, place(new THREE.PlaneGeometry(1.1, 3.6), Math.cos(a) * (R + 0.82), 10.5, Z0 + Math.sin(a) * (R + 0.82), 0, -a + Math.PI / 2));
      }
    }
    b.add(m.floor, place(new THREE.CircleGeometry(R, 32, 0, Math.PI), 0, 0.021, Z0, -Math.PI / 2));
    // the stair up the east side (north), treads, a stringer, a rail; sloped collider
    const [x0, x1, za, zb] = CT.STAIR;
    const n = 30, run = za - zb;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, y = MEZZ * (i + 1) / n, z = za - run * (i + 0.5) / n;
      b.add(m.steel, box(x1 - x0, 0.05, run / n + 0.02, (x0 + x1) / 2, y, z));
      void t0;
    }
    const sl = Math.hypot(run, MEZZ), sa = Math.atan2(MEZZ, run);
    b.add(m.grey, box(0.08, 0.35, sl, x0, MEZZ / 2 - 0.1, (za + zb) / 2, 0, sa), box(0.08, 0.35, sl, x1, MEZZ / 2 - 0.1, (za + zb) / 2, 0, sa));
    b.add(m.steel, box(0.05, 0.05, sl, x0 - 0.02, MEZZ / 2 + 1.0, (za + zb) / 2, 0, sa));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(sa, 0, 0));
    this.physics.addBoxRot(this.w((x0 + x1) / 2, MEZZ / 2 - 0.12, (za + zb) / 2), { x: (x1 - x0) / 2, y: 0.12, z: sl / 2 }, q);
    this.physics.addBoxRot(this.w(x0 - 0.04, MEZZ / 2 + 0.55, (za + zb) / 2), { x: 0.04, y: 0.5, z: sl / 2 }, q);
    this.points.stairFoot = this.w((x0 + x1) / 2, 1.0, za + 1.0);
    // the mezzanine: a slab across the apse, its front rail over the crossing
    const [ox0, ox1, oz0, oz1] = CT.OFFICE;
    const mz1 = -25.4;
    const outline: [number, number][] = [[-8.6, -25.4], [10.7, -25.4], [10.7, -27.6], [8.6, -30.6], [6.2, -32.8], [-6.2, -32.8], [-8.6, -30.6]];
    const shape = new THREE.Shape();
    outline.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    shape.lineTo(outline[0][0], -outline[0][1]);
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
    slab.rotateX(-Math.PI / 2);
    slab.translate(0, MEZZ - 0.3, 0);
    b.add(m.grey, norm(slab));
    const top = new THREE.ShapeGeometry(shape);
    top.rotateX(-Math.PI / 2);
    top.translate(0, MEZZ + 0.005, 0);
    b.add(m.floor, norm(top));
    this.col(1.05, MEZZ - 0.15, -26.5, 9.65, 0.15, 1.1);
    this.col(0, MEZZ - 0.15, -29.1, 8.6, 0.15, 1.5);
    this.col(0, MEZZ - 0.15, -31.7, 6.2, 0.15, 1.1);
    for (const x of [-8, -3, 3, 8]) b.add(m.steel, cyl(0.12, 0.12, MEZZ - 0.3, x, (MEZZ - 0.3) / 2, mz1 + 0.3, 8));
    // rail along the front (west of the stair head)
    b.add(m.steel, box(x0 + 8.6, 0.05, 0.05, (x0 - 8.6) / 2, MEZZ + 1.05, mz1 + 0.05));
    for (let x = -8.4; x < x0; x += 0.9) b.add(m.steel, box(0.04, 1.05, 0.04, x, MEZZ + 0.52, mz1 + 0.05));
    this.col((x0 - 8.6) / 2, MEZZ + 0.55, mz1 + 0.05, (x0 + 8.6) / 2, 0.55, 0.06);
    this.col(-8.6, MEZZ + 0.55, -28, 0.06, 0.55, 2.6);
    // the office: plasterboard walls, a glass front with the orange door, the plate
    const oh = 3.0, oxc = (ox0 + ox1) / 2, ozc = (oz0 + oz1) / 2, dx0 = 2.6, dx1 = 3.8;
    b.add(m.white, box(ox1 - ox0, oh, 0.12, oxc, MEZZ + oh / 2, oz0), box(0.12, oh, oz1 - oz0, ox0, MEZZ + oh / 2, ozc), box(0.12, oh, oz1 - oz0, ox1, MEZZ + oh / 2, ozc));
    this.col(oxc, MEZZ + oh / 2, oz0, (ox1 - ox0) / 2, oh / 2, 0.06);
    this.col(ox0, MEZZ + oh / 2, ozc, 0.06, oh / 2, (oz1 - oz0) / 2);
    this.col(ox1, MEZZ + oh / 2, ozc, 0.06, oh / 2, (oz1 - oz0) / 2);
    b.add(m.glass, box(dx0 - ox0, oh - 0.2, 0.04, (ox0 + dx0) / 2, MEZZ + (oh - 0.2) / 2, oz1), box(ox1 - dx1, oh - 0.2, 0.04, (dx1 + ox1) / 2, MEZZ + (oh - 0.2) / 2, oz1));
    b.add(m.white, box(ox1 - ox0, 0.2, 0.12, oxc, MEZZ + oh - 0.1, oz1), box(dx1 - dx0, oh - 2.3, 0.12, (dx0 + dx1) / 2, MEZZ + 2.3 + (oh - 2.3) / 2, oz1));
    for (const x of [ox0, dx0, dx1, ox1]) b.add(m.grey, box(0.08, oh, 0.1, x, MEZZ + oh / 2, oz1));
    this.col((ox0 + dx0) / 2, MEZZ + oh / 2, oz1, (dx0 - ox0) / 2, oh / 2, 0.06);
    this.col((dx1 + ox1) / 2, MEZZ + oh / 2, oz1, (ox1 - dx1) / 2, oh / 2, 0.06);
    b.add(m.white, box(ox1 - ox0 + 0.2, 0.1, oz1 - oz0 + 0.2, oxc, MEZZ + oh + 0.05, ozc));
    this.slideDoor('officeDoor', dx0, dx1, MEZZ, oz1, 2.3, dx1 - dx0 - 0.05, (lb, wd) => {
      lb.add(m.door, box(wd, 2.28, 0.05, wd / 2, 1.14, 0));
      lb.add(m.steel, box(0.04, 0.3, 0.06, 0.12, 1.1, 0.04));
    });
    b.add(m.print, cathPrint('office', 0.5, 0.19, M(dx0 - 0.4, MEZZ + 1.7, oz1 + 0.035, 0)));
    const pad = this.pal.slot('#ff3a2a', 2), ok = this.pal.slot('#5fe08a', 0);
    this.slots.officePad = pad.intensity;
    this.slots.officeOk = ok.intensity;
    b.add(m.black, box(0.14, 0.2, 0.03, dx0 - 0.3, MEZZ + 1.3, oz1 + 0.05));
    pad.add(b, box(0.08, 0.02, 0.01, dx0 - 0.3, MEZZ + 1.37, oz1 + 0.068));
    ok.add(b, box(0.08, 0.02, 0.01, dx0 - 0.3, MEZZ + 1.33, oz1 + 0.068));
    this.points.officeDoor = this.w((dx0 + dx1) / 2, MEZZ + 1.2, oz1 + 0.9);
    this.points.officeIn = this.w((dx0 + dx1) / 2, MEZZ + 1.0, oz1 - 1.2);
    // inside: the door desk on sawhorses, the laptop, a standing mat, the pallet, the returns shelf
    const office = this.pal.slot('#cfe6ff', 1.4);
    this.slots.office = office.intensity;
    const ddx = -1.0, ddz = -31.4;
    b.add(m.oak, box(2.1, 0.05, 0.85, ddx, MEZZ + 1.0, ddz));
    for (const s of [-1, 1]) b.add(m.oak, box(0.08, 0.98, 0.7, ddx + s * 0.85, MEZZ + 0.49, ddz, 0, 0, s * 0.12));
    b.add(m.black, box(0.4, 0.02, 0.3, ddx - 0.2, MEZZ + 1.04, ddz + 0.05), box(0.4, 0.28, 0.02, ddx - 0.2, MEZZ + 1.18, ddz - 0.12, 0, -0.25));
    office.add(b, box(0.36, 0.24, 0.01, ddx - 0.2, MEZZ + 1.18, ddz - 0.108, 0, -0.25));
    b.add(m.black, box(0.7, 0.42, 0.03, ddx + 0.5, MEZZ + 1.32, ddz - 0.3), box(0.05, 0.3, 0.05, ddx + 0.5, MEZZ + 1.12, ddz - 0.3));
    office.add(b, box(0.64, 0.36, 0.01, ddx + 0.5, MEZZ + 1.32, ddz - 0.28));
    b.add(m.yellow, box(0.07, 0.07, 0.03, ddx + 0.6, MEZZ + 0.6, ddz + 0.43));
    this.col(ddx, MEZZ + 0.5, ddz, 1.05, 0.5, 0.42);
    b.add(m.rug, place(new THREE.PlaneGeometry(1.2, 0.8), ddx, MEZZ + 0.012, ddz + 1.0, -Math.PI / 2));
    this.orrinSpot = { pos: this.w(ddx + 1.8, MEZZ, ddz + 0.6), yaw: 0.25 };
    this.points.orrin = this.w(ddx + 1.8, MEZZ + 1.2, ddz + 1.8);
    this.points.console = this.w(ddx - 0.6, MEZZ + 1.2, ddz + 1.0);
    this.halos.add(V(ddx + 0.3, MEZZ + 1.3, ddz - 0.1), '#cfe6ff', 1.4, CathedralBuilder.CH.OFFICE, 0.4);
    // the Reserve: a pallet of shrink-wrapped Dropt Spring
    const px = -4.4, pz = -31.6;
    b.add(m.pallet, box(1.2, 0.14, 1.0, px, MEZZ + 0.07, pz));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) b.add(m.water, cyl(0.12, 0.12, 0.32, px - 0.42 + i * 0.28, MEZZ + 0.32 + k * 0.34, pz - 0.3 + j * 0.3, 8));
    b.add(m.glass, box(1.22, 1.15, 1.02, px, MEZZ + 0.72, pz));
    this.col(px, MEZZ + 0.65, pz, 0.6, 0.65, 0.5);
    this.lootSpots.push({ id: 'pallet', pos: this.w(px + 0.2, MEZZ + 1.0, pz + 1.2), mesh: new THREE.Group() });
    this.lootSpots.push({ id: 'desk', pos: this.w(ddx + 0.7, MEZZ + 1.0, ddz + 0.9), mesh: new THREE.Group() });
    // the returns shelf along the east wall: three years of things he sent back
    const sx = 5.4, szc = -30.2;
    b.add(m.rack, box(0.08, 2.2, 0.08, sx - 0.25, MEZZ + 1.1, szc - 1.5), box(0.08, 2.2, 0.08, sx - 0.25, MEZZ + 1.1, szc + 1.5));
    const r = rng(23);
    for (let y = 0.3; y < 2.2; y += 0.6) {
      b.add(m.rackBeam, box(0.5, 0.05, 3.0, sx - 0.25, MEZZ + y, szc));
      for (let z = szc - 1.3; z < szc + 1.3; z += 0.4 + r() * 0.25) {
        const h = 0.15 + r() * 0.3;
        b.add(r() < 0.6 ? m.card : m.white, box(0.3 + r() * 0.15, h, 0.3, sx - 0.25, MEZZ + y + 0.03 + h / 2, z));
      }
    }
    this.col(sx - 0.25, MEZZ + 1.1, szc, 0.26, 1.1, 1.5);
    this.lootSpots.push({ id: 'shelf', pos: this.w(sx - 1.2, MEZZ + 1.0, szc), mesh: new THREE.Group() });
    void ox0; void ox1;
  }

  // ------------------------------------------------------------------ the dock (east aisle wall, z 14)
  private buildDock(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const x = CT.AW + 0.4, zc = 14;
    // a raised apron outside, a canopy, the roll-up door and its wicket (the door that opens)
    const gx = x + 4;
    b.add(m.pad, box(8, 0.3, 8, gx, 0.15 - 0.3, zc));
    b.add(m.yellow, box(0.12, 0.31, 7.6, x + 1.2, 0.0, zc));
    b.add(m.lead, box(6, 0.2, 7.5, x + 3, 6.2, zc));
    for (const dz of [-3.5, 3.5]) b.add(m.post, cyl(0.1, 0.1, 6.1, x + 5.8, 3.05, zc + dz, 8));
    this.cover.push(new THREE.Box3(this.w(x, -1, zc - 3.75), this.w(x + 6, 6, zc + 3.75)));
    b.add(m.print, cathPrint('dock', 2.4, 1.2, M(x + 0.42, 6.0, zc, Math.PI / 2)));
    b.add(m.roll, box(0.1, 5.0, 5.0, x + 0.35, 2.6, zc));
    // the wicket door: a 1 m leaf in the roll-up door, sliding (as the runtime wants) along z
    this.slideDoor('dockDoor', zc - 0.55, zc + 0.55, 0, x + 0.45, 2.2, 1.1, (lb, wd) => {
      lb.add(m.door, box(wd, 2.18, 0.08, wd / 2, 1.09, 0));
      lb.add(m.black, box(0.08, 0.12, 0.12, wd - 0.15, 1.1, 0.06));
    }, true);
    // (the roll-up door's collider, except the wicket's gap)
    this.col(x + 0.35, 2.6, zc - 1.6, 0.08, 2.6, 1.05);
    this.col(x + 0.35, 2.6, zc + 1.6, 0.08, 2.6, 1.05);
    this.col(x + 0.35, 3.8, zc, 0.08, 1.4, 0.6);
    const dock = this.pal.slot('#ffe2b8', 0);
    this.slots.dock = dock.intensity;
    dock.add(b, box(0.6, 0.06, 0.2, x + 1.0, 6.05, zc));
    this.points.dock = this.w(x + 1.4, 1.2, zc + 0.9);
    this.points.dockIn = this.w(x - 2.5, 1.0, zc);
    // inside: an UP button by the door (it opens from inside)
    b.add(m.yellow, box(0.12, 0.3, 0.2, x - 0.5, 1.3, zc + 1.4));
    this.points.dockButton = this.w(x - 1.2, 1.2, zc + 1.4);
  }

  // ------------------------------------------------------------------ the returns line: kiosk, flap, the ride
  private buildReturns(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const x = CT.AW + 0.4, zk = -4;
    // outside: the kiosk, the sign over the flap, the line running in through rubber strips
    const kx = x + 2.6, kz = zk + 1.6;
    b.add(m.orange, box(0.7, 1.7, 0.55, kx, 0.85, kz));
    b.add(m.print, cathPrint('kiosk', 0.48, 0.72, M(kx - 0.36, 1.25, kz, -Math.PI / 2)));
    b.add(m.print, cathPrint('returns', 2.4, 0.8, M(x + 0.42, 2.6, zk, Math.PI / 2)));
    const ks = this.pal.slot('#9fe0ff', 1.4), ko = this.pal.slot('#5fe08a', 0);
    this.slots.kiosk = ks.intensity;
    this.slots.kioskOk = ko.intensity;
    ks.add(b, box(0.02, 0.05, 0.4, kx - 0.36, 1.66, kz));
    ko.add(b, box(0.02, 0.05, 0.4, kx - 0.36, 1.72, kz));
    this.col(kx, 0.85, kz, 0.35, 0.85, 0.28);
    this.points.kiosk = this.w(kx - 1.2, 1.2, kz);
    // the flap (a door the runtime opens: rubber strips that swing up)
    const pivot = new THREE.Group();
    pivot.position.set(x + 0.42, 1.55, zk - 0.95);
    const fb = new MeshBatch();
    for (let i = 0; i < 8; i++) fb.add(m.black, box(0.02, 1.0, 0.23, 0, -0.5, 0.12 + i * 0.237));
    pivot.add(fb.build('cathFlap'));
    this.group.add(pivot);
    const fpos = this.w(x + 0.42, 1.05, zk), fhalf = V(0.1, 0.5, 0.95);
    this.doors.flap = { pivot, open: 0, target: 0, collider: this.physics.addBox(fpos, fhalf), axis: 'y', amount: 0.0001, colliderSpec: { pos: fpos, half: fhalf } };
    // the line: from outside the wall, up over the east aisle, west through the arcade into the crossing
    const P = [V(x + 5, 0.75, zk), V(x - 1.4, 0.75, zk), V(15.6, 0.75, zk - 0.8), V(15.6, 6.4, -11.6), V(15.6, 6.4, -18.6), V(13.4, 6.4, -21), V(9.8, 6.4, -21), V(7.6, 1.0, -21)];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], c = P[i + 1], len = a.distanceTo(c);
      const dir = c.clone().sub(a).normalize();
      const side = dir.clone().cross(V(0, 1, 0)).normalize().multiplyScalar(0.5);
      b.add(m.belt, bar(a, c, 0.9, 0.08));
      b.add(m.yellow, bar(a.clone().add(side).setY(a.y + 0.12), c.clone().add(side).setY(c.y + 0.12), 0.06, 0.25), bar(a.clone().sub(side).setY(a.y + 0.12), c.clone().sub(side).setY(c.y + 0.12), 0.06, 0.25));
      // legs every couple of metres down to the floor
      for (let t = 0.2; t < 1; t += 2 / Math.max(2, len)) {
        const p = a.clone().lerp(c, t);
        if (p.y > 1.2 && !(p.x > CT.AW)) b.add(m.steel, beam(V(p.x, 0, p.z), V(p.x, p.y - 0.06, p.z), 0.04, 4));
      }
    }
    // a few empty totes waiting on the outside run
    b.add(m.toteGrey, box(0.6, 0.35, 0.45, x + 3.6, 0.97, zk), box(0.6, 0.35, 0.45, x + 2.4, 0.97, zk));
    b.add(m.print, cathPrint('totes', 0.4, 0.2, M(x + 3.6, 1.0, zk + 0.23, 0)));
    this.col(x + 2.5, 0.4, zk, 2.5, 0.4, 0.5);
    // what the player rides: over the outside run (feet on the belt, in a tote), through the flap, up and over
    const off = 0.1;
    this.ride = P.slice(1).map((p) => this.w(p.x, p.y + off, p.z));
    this.ride.unshift(this.w(x + 2.4, 0.75 + off, zk));
    this.ride.push(this.w(6.2, 0.02, -19.3));
    this.points.rideEnd = this.ride[this.ride.length - 1].clone();
  }

  // ------------------------------------------------------------------ the lot, south of the front
  private buildLot(b: MeshBatch, m: ReturnType<CathedralBuilder['mats']>) {
    const r = rng(53);
    // asphalt with bays, the walkway to the doors, a gate arm at the road's end
    b.add(m.pad, place(new THREE.PlaneGeometry(72, 26), 0, 0.03, CT.Z1 + 15, -Math.PI / 2));
    b.add(m.yellow, place(new THREE.PlaneGeometry(1.2, 24), 0, 0.04, CT.Z1 + 14, -Math.PI / 2));
    for (let i = -12; i <= 12; i++) {
      if (Math.abs(i) < 2) continue;
      for (const z of [CT.Z1 + 10, CT.Z1 + 21]) b.add(m.yellow, place(new THREE.PlaneGeometry(0.1, 5.2), i * 2.8, 0.04, z, -Math.PI / 2));
    }
    for (const z of [CT.Z1 + 10, CT.Z1 + 21]) for (let i = -10; i <= 10; i += 5) if (i) b.add(m.print, cathPrint('bay', 1.6, 0.8, M(i * 2.8 + 1.4, 0.05, z + 1.6, 0, -Math.PI / 2)));
    // dead vans in two rows, a few out of line, one on its side
    const vanAt = (x: number, z: number, yaw: number, opts: Partial<Parameters<typeof buildCar>[2]> = {}) => {
      const g = this.gy(x, z);
      const mtx = new THREE.Matrix4().compose(V(x, g, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
      const res = buildCar(b, mtx, { kind: 'van', paint: '#ece8e0', rand: r, rust: 0.25, fade: 0.5, broken: 0.6, ...opts });
      const c = res.center.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
      this.physics.addBox(this.w(x + c.x, g + res.center.y, z + c.z), res.half, yaw);
      // the livery down both sides
      for (const s of [-1, 1]) b.add(m.print, cathPrint('van', 3.6, 0.9, new THREE.Matrix4().compose(V(x, g + 1.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1)).multiply(M(0.1, 0, s * (res.half.z + 0.02), s < 0 ? Math.PI : 0))));
      // under a van is cover from the swarm (crouched)
      this.cover.push(new THREE.Box3(this.w(x + c.x - 2.6, -1, z + c.z - 2.6), this.w(x + c.x + 2.6, 1.4, z + c.z + 2.6)));
    };
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      if (r() < 0.25) continue;
      vanAt(i * 5.6 + (r() - 0.5) * 0.6, CT.Z1 + 10 + (r() - 0.5) * 0.8, Math.PI / 2 + (r() - 0.5) * 0.12);
      if (r() < 0.7) vanAt(i * 5.6 + (r() - 0.5) * 0.6, CT.Z1 + 21 + (r() - 0.5) * 0.8, -Math.PI / 2 + (r() - 0.5) * 0.12, { hood: r() < 0.3 ? 'open' : 'shut' });
    }
    vanAt(26, CT.Z1 + 4, 0.4, { broken: 0.9, wheels: ['flat', 'flat', 'gone', 'flat'] });
    vanAt(-28, CT.Z1 + 26, 2.4, { blocks: true });
    // the pickup lockers under an awning on the west of the lot (cover, and a place to wait)
    const lx = -24, lz = CT.Z1 + 8;
    b.add(m.orange, box(6, 2.4, 0.8, lx, 1.2, lz - 0.4));
    b.add(m.print, cathPrint('lockers', 2.2, 2.2, M(lx - 1.5, 1.25, lz + 0.02, 0)), cathPrint('lockers', 2.2, 2.2, M(lx + 1.5, 1.25, lz + 0.02, 0)));
    b.add(m.lead, box(7.5, 0.15, 5, lx, 3.2, lz + 1.6));
    for (const dx of [-3.5, 3.5]) b.add(m.post, cyl(0.08, 0.08, 3.2, lx + dx, 1.6, lz + 3.9, 6));
    this.col(lx, 1.2, lz - 0.4, 3, 1.2, 0.4);
    this.cover.push(new THREE.Box3(this.w(lx - 3.75, -1, lz - 0.9), this.w(lx + 3.75, 3.1, lz + 4.1)));
    b.add(m.print, cathPrint('lotSign', 2.4, 1.2, M(-7, 3.0, CT.Z1 + 27.5, 0)));
    b.add(m.post, box(0.1, 3.6, 0.1, -8.1, 1.8, CT.Z1 + 27.5), box(0.1, 3.6, 0.1, -5.9, 1.8, CT.Z1 + 27.5));
    // lamp posts (lit at night), a sign at the road's end
    const lot = this.pal.slot('#ffe2b8', 0);
    this.slots.lot = lot.intensity;
    for (const [x, z] of [[-14, CT.Z1 + 5], [14, CT.Z1 + 5], [-14, CT.Z1 + 16], [14, CT.Z1 + 16], [0, CT.Z1 + 26]]) {
      b.add(m.post, cyl(0.07, 0.1, 7, x, 3.5, z, 6));
      b.add(m.black, box(0.6, 0.18, 0.3, x, 7, z));
      lot.add(b, box(0.5, 0.04, 0.22, x, 6.9, z));
      this.halos.add(V(x, 6.85, z), '#ffe2b8', 2.2, CathedralBuilder.CH.NIGHT, 0.8);
    }
    const sx = 8, sz = CT.Z1 + 32, sg = this.gy(sx, sz);
    b.add(m.post, box(0.1, 2.4, 0.1, sx - 0.9, sg + 1.2, sz), box(0.1, 2.4, 0.1, sx + 0.9, sg + 1.2, sz));
    b.add(m.print, cathPrint('roadSign', 2.2, 1.375, M(sx, sg + 1.75, sz + 0.07, 0)));
    this.points.road = this.w(4, 0, CT.Z1 + 42);
    this.points.outside = this.w(-2, 0, CT.Z1 + 30);
    // rocks scattered round the pad's edge
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, rad = 40 + r() * 8, x = Math.sin(a) * rad, z = Math.cos(a) * rad + 4;
      if (z > CT.Z1 + 30 && Math.abs(x) < 10) continue;
      b.add(m.rock, place(rockGeometry(i * 7 + 3, 0), x, this.gy(x, z) + 0.1, z, 0, a, 0, 0.5 + r() * 0.6));
    }
  }

  // ------------------------------------------------------------------ the drones' routes
  private buildRoutes() {
    const at = (x: number, z: number, y: number) => this.w(x, y, z);
    const Z = CT.Z1;
    // over the lot (two loops), down the east side past the kiosk and the dock, round the west
    this.swarmRoutes.push(
      [at(-26, Z + 6, 7), at(-12, Z + 18, 7.5), at(0, Z + 30, 8), at(14, Z + 18, 7.5), at(26, Z + 6, 7), at(12, Z + 10, 7.5), at(-12, Z + 10, 7.5)],
      [at(-30, Z + 30, 8), at(-10, Z + 26, 7), at(10, Z + 34, 8), at(30, Z + 26, 7), at(18, Z + 14, 8), at(-18, Z + 14, 8)],
      [at(28, Z + 2, 7), at(28, 12, 7.5), at(27, -4, 7), at(29, -18, 8), at(30, 6, 7.5), at(26, 20, 7)],
      [at(-28, Z + 2, 7.5), at(-29, 8, 7), at(-28, -14, 7.5), at(-30, 0, 8), at(-27, 18, 7)],
    );
    // inside, over the floor: up and down the nave
    this.floorRoutes.push(
      [at(-6, 10, 5.2), at(-6, -14, 5.2), at(4, -14, 5.4), at(4, 10, 5.4)],
      [at(8, -12, 5.0), at(8, 8, 5.0), at(-2, 8, 5.2), at(-2, -12, 5.2)],
    );
  }

  // ------------------------------------------------------------------ lights (virtual: the pool lends them)
  private buildLights() {
    const L = (c: string, dist: number, x: number, y: number, z: number, pr = 1) => {
      const v = new VirtualLight(c, 0, dist, 1.6);
      v.position.copy(this.w(x, y, z));
      v.priority = pr;
      return v;
    };
    this.lights = {
      hall: [L('#ffc98a', 18, 0, 9.5, 2, 1.8), L('#ffc98a', 18, 0, 9.5, -12, 1.8)],
      altar: L('#ffe6c0', 10, 0, 4, -19, 2.2),
      office: L('#e0ecff', 7, 0, CT.MEZZ + 2.4, -30, 2.4),
      dock: L('#ffe2b8', 10, CT.AW + 2.5, 5.6, 14, 1.2),
      lot: [L('#ffe2b8', 16, -14, 6.6, CT.Z1 + 10, 1), L('#ffe2b8', 16, 14, 6.6, CT.Z1 + 10, 1)],
      tower: L('#ffd29a', 12, -(CT.AW + 2.8), 24.5, CT.Z1 - 2.4, 1),
    };
  }
}
