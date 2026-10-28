import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, norm, MeshBatch, DistanceLod, shadowProxy } from '../../world/kit';
import { surfaces } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, fabric, wood, desertRock } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { LiveScreen } from '../apex/apexAtlas';
import { fortPrint, fortPrintMaterial, paintBoard } from './fortressAtlas';
import { coolantMaterial, frostMaterial, MoatMist } from './fortressFx';
import { FORTRESS_MOAT, FORTRESS_ROAD } from '@/content/bunkers/fortress';
import type { BunkerShell, Door, LootSpot, SecurityCamera, Tripwire, Laser } from '../shell';

/**
 * The Chip Fortress, on a pad in the basin under the southern range. Local metres, origin at the pad's
 * centre, axes as the world's (north is −z, where Lattice's road comes in).
 *
 * - The moat: a ring of coolant (r 24…30.5) in a trench Heightfield carves, lined with walls that keep
 *   you in; steps cut in both walls on the east and west. Vapour off it all round. The drawbridge
 *   (north) is hinged on the inner lip; the gatehouse and the allocation queue are on the outer bank,
 *   the pump house on the west bank.
 * - The fort: a square of curtain walls (±11) with four arrowhead bastions, black composite on a frosted
 *   foot. The gate (north curtain) under a gate tower with the winch; the frost door in the west curtain.
 *   Dry coolers fill the bastions; thermal cameras on the bastion tips and the keep's north corners.
 * - The keep (x ±6.5, z −4…8, 7 m): the door in the north face; the hall runs south between the board
 *   room (west: the power board) and the locker room (east: Marek), across a laser grid, to the vault's
 *   glass wall. The vault: racks of boxed chips, Kit at her desk, the drinking tank, the dispenser.
 */
export const FT = {
  HALF: 11, FLANK: 6, ORILLON: 13.5, TIP: 15.2,
  WALL_H: 6.5, WALL_T: 1.6,
  SURF: -1.0,
  KEEP: [-6.5, 6.5, -4, 8] as const, KEEP_H: 7,
  HALL: 1.8, ROOMS_Z: 1.5, GLASS_Z: 3.2,
  GATE: 2.2, GATE_H: 4.6,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
const deg = THREE.MathUtils.degToRad;

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}



export class FortressBuilder implements BunkerShell {
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
  lod!: DistanceLod;
  readonly pal = new GlowPalette(40);
  readonly halos = new GlowSprites(12);
  static readonly CH = { ON: 0, NIGHT: 1, WALL: 2, BLINK: 3, KEEP: 4, VAULT: 5, COOL: 6 };
  /** The allocation board in the vault. */
  board!: LiveScreen;
  /** The coolant's surface (the runtime lowers it when the moat is drained). */
  coolant!: THREE.Mesh;
  /** Mist lying on the moat. */
  steam!: MoatMist;
  /** The drawbridge (its pivot; the runtime turns it) and its two chains (re-aimed as it moves). */
  bridge!: THREE.Object3D;
  chains!: THREE.Mesh[];
  readonly chainTop: THREE.Vector3[] = [];
  lights!: { yard: VirtualLight[]; hall: VirtualLight; board: VirtualLight; lockers: VirtualLight; vault: VirtualLight; gate: VirtualLight; pump: VirtualLight };
  readonly slots: Record<'wall' | 'keep' | 'vault' | 'racks' | 'boardOn' | 'boardWarn' | 'cool' | 'aviation' | 'gatehouse' | 'padRed' | 'padOk' | 'heater' | 'yard', { value: number }> = {} as never;
  /** Where people are (the runtime places the models). */
  kitSeat!: { pos: THREE.Vector3; yaw: number };
  marekSpot!: { pos: THREE.Vector3; yaw: number };
  /** Technicians' routes (world), by id. */
  readonly routes: Record<string, THREE.Vector3[]> = {};
  private far!: THREE.Object3D;

  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'fortress';
    const [x0, x1, z0, z1] = FT.KEEP;
    this.innerBox = new THREE.Box3(this.w(x0, -0.5, z0), this.w(x1, FT.KEEP_H, z1));
    this.groundsBox = new THREE.Box3(this.w(-FORTRESS_MOAT.r0, -4, -FORTRESS_MOAT.r0), this.w(FORTRESS_MOAT.r0, 30, FORTRESS_MOAT.r0));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  private gy(x: number, z: number) {
    return this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
  }

  /** In the keep. */
  contains(p: THREE.Vector3, margin = 0) {
    const [x0, x1, z0, z1] = FT.KEEP;
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    return y > -1 && y < FT.KEEP_H && x > x0 + 0.2 - margin && x < x1 - 0.2 + margin && z > z0 + 0.2 - margin && z < z1 - 0.2 + margin;
  }

  /** Inside the walls (the yard, the bastions, the keep). */
  inWalls(p: THREE.Vector3) {
    const x = Math.abs(p.x - this.origin.x), z = Math.abs(p.z - this.origin.z);
    if (x < FT.HALF - 0.8 && z < FT.HALF - 0.8) return true;
    // a bastion: past the corner, inside the arrowhead (|x|+|z| under the tip's)
    return x > FT.FLANK && z > FT.FLANK && x + z < FT.TIP * 2 - 2.4 && x < FT.ORILLON + 1 && z < FT.ORILLON + 1;
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** A sliding door leaf along x at z (or along z at x when `alongZ`). */
  private slideDoor(id: string, a0: number, a1: number, y0: number, at: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void, alongZ = false) {
    const pivot = new THREE.Group();
    if (alongZ) { pivot.position.set(at, y0, a0); pivot.rotation.y = -Math.PI / 2; pivot.userData.z0 = a0; pivot.userData.slideZ = amount; } else pivot.position.set(a0, y0, at);
    pivot.userData.x0 = alongZ ? at : a0;
    const lb = new MeshBatch();
    leaf(lb, a1 - a0);
    pivot.add(lb.build(`fortDoor:${id}`));
    this.group.add(pivot);
    const mid = (a0 + a1) / 2;
    const pos = alongZ ? this.w(at, y0 + h / 2, mid) : this.w(mid, y0 + h / 2, at);
    const half = alongZ ? V(0.15, h / 2, Math.abs(a1 - a0) / 2) : V(Math.abs(a1 - a0) / 2, h / 2, 0.15);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount: alongZ ? 0 : amount, colliderSpec: { pos, half } };
    return pivot;
  }

  private build() {
    const b = new MeshBatch();
    const m = this.mats();
    this.board = new LiveScreen(1024, 512, () => {});
    this.board.paint = (c, w, h) => paintBoard(c, w, h, { window: 1, rows: [{ name: 'K. SZABO', units: 9 }], power: { chillers: true, grid: true, lights: true, vault: false }, status: 'live', price: '— (no feed)' });
    this.board.repaint();
    this.buildMoat(b, m);
    this.buildWalls(b, m);
    this.buildGate(b, m);
    this.buildYard(b, m);
    this.buildKeep(b, m);
    this.buildVault(b, m);
    this.buildOutside(b, m);
    this.buildRoutes();
    this.buildLights();
    surfaces.zone(this.w(-34, -5, -34), this.w(34, 8, 34), 'concrete');
    const [x0, x1, z0, z1] = FT.KEEP;
    surfaces.zone(this.w(x0, -0.5, z0), this.w(x1, FT.KEEP_H, z1), 'metal');

    this.far = b.buildFar('fortress-far', { minSize: 1.2, keep: [m.coolant] });
    const statics = b.build('fortStatic');
    this.group.add(statics);
    this.group.add(this.halos.build());
    statics.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mesh.isMesh && mat && (mat.transparent || mat === m.print)) mesh.castShadow = false;
    });
    shadowProxy(statics);
    for (const d of Object.values(this.doors)) d.pivot.traverse((o) => { o.castShadow = false; });
    for (const c of this.cameras) c.pivot.traverse((o) => { o.castShadow = false; });

    const near = new THREE.Group();
    near.name = 'fortress-near';
    const keep = new Set<THREE.Object3D>([this.halos.sprite, this.steam.mesh, this.coolant]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far);
    this.lod = new DistanceLod(this.origin.clone(), 14, near, this.far, 190, 1400);
  }

  private mats() {
    return {
      black: plainStandard('#1c1f23', 0.55, 0.35),
      panel: plainStandard('#2a2e33', 0.45, 0.5),
      dark: plainStandard('#121417', 0.5, 0.3),
      steel: plainStandard('#a9b1b7', 0.35, 0.85),
      grey: plainStandard('#5c6268', 0.6, 0.45),
      white: plainStandard('#d9dde0', 0.55, 0.1),
      wall: concrete('#8d8c88', { scale: 0.6, stains: 0.5 }),
      pad: concrete('#9a958c', { scale: 0.9, stains: 0.55 }),
      floor: plainStandard('#5a6066', 0.45, 0.15),
      amber: plainStandard('#e0a12a', 0.55, 0.15),
      red: plainStandard('#b8321e', 0.6, 0.1),
      chip: plainStandard('#16191c', 0.4, 0.3),
      glass: plainStandard('#a8c6d0', 0.06, 0.2, { transparent: true, opacity: 0.18, depthWrite: false }),
      chain: rustyMetal({ base: '#6d7070', rust: 0.4, metalness: 0.7 }),
      pipe: rustyMetal({ base: '#a7aaa8', rust: 0.25, metalness: 0.7 }),
      post: rustyMetal({ base: '#8f918c', rust: 0.35, metalness: 0.6 }),
      tent: fabric('#8a6a4a'),
      chair: fabric('#2f5d8a'),
      seat: fabric('#26282c'),
      wood: wood('#7a5a3a'),
      rock: desertRock(),
      frost: frostMaterial(),
      coolant: coolantMaterial(),
      print: fortPrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the moat
  private buildMoat(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const { r0, r1, depth } = FORTRESS_MOAT;
    const bed = -depth, lip = 0.6;
    const lath = (r: number, y0: number, y1: number, mat: THREE.Material, out: boolean, seg = 96) =>
      b.add(mat, place(new THREE.LatheGeometry(out ? [new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)] : [new THREE.Vector2(r, y1), new THREE.Vector2(r, y0)], seg)));
    // the walls: concrete from the bed up to a lip above the banks; frost along the top
    lath(r0, bed, lip, m.wall, true);
    lath(r1, bed, lip, m.wall, false);
    lath(r0 - 0.4, 0, lip, m.wall, false);
    lath(r1 + 0.4, 0, lip, m.wall, true);
    b.add(m.frost, place(new THREE.RingGeometry(r0 - 0.4, r0, 96), 0, lip, 0, -Math.PI / 2), place(new THREE.RingGeometry(r1, r1 + 0.4, 96), 0, lip, 0, -Math.PI / 2));
    b.add(m.dark, place(new THREE.RingGeometry(r0, r1, 96), 0, bed + 0.02, 0, -Math.PI / 2));
    // a skirt of frost on the banks round the outside
    b.add(m.frost, place(new THREE.RingGeometry(r1 + 0.4, r1 + 2.2, 96), 0, 0.03, 0, -Math.PI / 2));
    // colliders: a lip all round both walls, and the walls from the bed (you don't climb out)
    for (const [r, inner] of [[r0, true], [r1, false]] as [number, boolean][]) {
      const N = 48;
      for (let i = 0; i < N; i++) {
        const a = ((i + 0.5) / N) * Math.PI * 2;
        // the drawbridge's span (north) and the steps (east, west) leave gaps in the lip
        const north = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.1;
        const half = r * Math.tan(Math.PI / N) + 0.05;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        if (!north) this.col(x + Math.sin(a) * (inner ? -0.2 : 0.2), (bed + lip) / 2, z + Math.cos(a) * (inner ? -0.2 : 0.2), half, (lip - bed) / 2, 0.2, a);
        else this.col(x + Math.sin(a) * (inner ? -0.2 : 0.2), (bed - 0.2) / 2, z + Math.cos(a) * (inner ? -0.2 : 0.2), half, (-0.2 - bed) / 2, 0.2, a);
      }
    }
    // steps cut into both walls, east and west: a ramp of treads along the wall from the bed to the bank
    for (const sx of [-1, 1]) for (const [r, sideIn] of [[r0 + 0.8, true], [r1 - 0.8, false]] as [number, boolean][]) {
      const a = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      const n = 12, run = 6.4;
      // the ramp runs along the wall (tangent), climbing toward +z at the east and −z at the west
      const tz = sx > 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, y = bed + (depth + 0.65) * (i + 1) / n;
        const zz = (t - 0.5) * run * tz;
        const xx = Math.sin(a) * r;
        b.add(m.wall, box(1.4, 0.15, run / n + 0.02, xx, y - 0.08, zz));
      }
      const rise = depth + 0.65;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tz * Math.atan2(rise, run), 0, 0));
      this.physics.addBoxRot(this.w(Math.sin(a) * r, bed + rise / 2 - 0.12, 0), { x: 0.7, y: 0.12, z: Math.hypot(run, rise) / 2 }, q);
      void sideIn;
    }
    // the coolant itself: a ring surface (its own mesh: drained, the runtime lowers it to a film)
    const surf = new THREE.Mesh(norm(place(new THREE.RingGeometry(r0 + 0.02, r1 - 0.02, 96, 2), 0, 0, 0, -Math.PI / 2)), m.coolant);
    surf.position.y = FT.SURF;
    surf.receiveShadow = true;
    surf.castShadow = false;
    surf.name = 'fortCoolant';
    this.coolant = surf;
    this.group.add(surf);
    // mist lying on it, all round
    this.steam = new MoatMist(r0, r1, FT.SURF);
    this.group.add(this.steam.mesh);
    // warning plates round the outer lip
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const x = Math.sin(a) * (r1 + 1.6), z = Math.cos(a) * (r1 + 1.6);
      b.add(m.post, cyl(0.04, 0.04, 1.3, x, 0.65, z, 6));
      b.add(m.print, fortPrint('moatWarn', 0.8, 0.4, M(x, 1.15, z, a)));
    }
    this.points.moatW = this.w(-(r0 + r1) / 2, FT.SURF, 0);
  }

  // ------------------------------------------------------------------ the curtain walls and bastions
  /** The fort's outline, clockwise from the north curtain's west end (NE, SE, SW, NW bastions). */
  outline() {
    const { HALF: H, FLANK: F, ORILLON: O, TIP: T } = FT;
    const pts: THREE.Vector2[] = [];
    const corner = (sx: number, sz: number, alongX: boolean) => {
      const a = [new THREE.Vector2(sx * F, sz * H), new THREE.Vector2(sx * F, sz * O), new THREE.Vector2(sx * T, sz * T), new THREE.Vector2(sx * O, sz * F), new THREE.Vector2(sx * H, sz * F)];
      pts.push(...(alongX ? a : a.reverse()));
    };
    corner(1, -1, true);
    corner(1, 1, false);
    corner(-1, 1, true);
    corner(-1, -1, false);
    return pts;
  }

  private buildWalls(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const pts = this.outline(), n = pts.length;
    const { WALL_H: Hh, WALL_T: T, GATE: G, GATE_H } = FT;
    const wallTop = this.pal.slot('#7fd6ff', 1.4);
    this.slots.wall = wallTop.intensity;
    const seg = (a: THREE.Vector2, c: THREE.Vector2, y0: number, y1: number) => {
      const d = c.clone().sub(a), len = d.length();
      if (len < 0.05) return;
      const mid = a.clone().add(c).multiplyScalar(0.5);
      // the inward normal (toward the centre)
      let nx = -d.y / len, nz = d.x / len;
      if (nx * -mid.x + nz * -mid.y < 0) { nx = -nx; nz = -nz; }
      const cx = mid.x + nx * T / 2, cz = mid.y + nz * T / 2, yaw = Math.atan2(d.x, d.y) + Math.PI / 2;
      b.add(m.black, box(len + T * 0.5, y1 - y0, T, cx, (y0 + y1) / 2, cz, yaw));
      this.col(cx, (y0 + y1) / 2, cz, (len + T * 0.5) / 2, (y1 - y0) / 2, T / 2, yaw);
      if (y0 < 0.01 && y1 >= Hh - 0.01) {
        // ribs up the outer face every three metres or so (the panels are bolted to a frame)
        const nr = Math.max(1, Math.floor(len / 3));
        for (let k = 1; k < nr; k++) {
          const t = k / nr, px = a.x + d.x * t - nx * 0.12, pz = a.y + d.y * t - nz * 0.12;
          b.add(m.panel, box(0.35, Hh - 0.6, 0.3, px, (Hh - 0.6) / 2 + 0.5, pz, yaw));
        }
      }
      if (y1 >= Hh - 0.01) {
        // coping, a light strip under it (ice blue), and the frosted foot on the outside
        b.add(m.panel, box(len + T * 0.6, 0.25, T + 0.25, cx, Hh + 0.12, cz, yaw));
        wallTop.add(b, box(len, 0.06, 0.04, mid.x - nx * 0.04, Hh - 0.25, mid.y - nz * 0.04, yaw));
      }
      if (y0 < 0.01) {
        b.add(m.frost, box(len + T * 0.5, 1.2, 0.08, mid.x - nx * 0.04, 0.6, mid.y - nz * 0.04, yaw));
        b.add(m.dark, box(len + T * 0.5, 0.5, T + 0.6, cx, 0.25, cz, yaw));
      }
    };
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % n];
      // the north curtain (z = −11, from x −6 to 6): the gate in the middle
      if (Math.abs(a.y + FT.HALF) < 0.01 && Math.abs(c.y + FT.HALF) < 0.01) {
        const [w0, w1] = a.x < c.x ? [a, c] : [c, a];
        seg(w0, new THREE.Vector2(-G, w0.y), 0, Hh);
        seg(new THREE.Vector2(G, w0.y), w1, 0, Hh);
        seg(new THREE.Vector2(-G - 0.4, w0.y), new THREE.Vector2(G + 0.4, w0.y), GATE_H, Hh);
        continue;
      }
      // the west curtain (x = −11, z −6…6): the frost door at z 0
      if (Math.abs(a.x + FT.HALF) < 0.01 && Math.abs(c.x + FT.HALF) < 0.01) {
        const [w0, w1] = a.y < c.y ? [a, c] : [c, a];
        seg(w0, new THREE.Vector2(w0.x, -0.85), 0, Hh);
        seg(new THREE.Vector2(w0.x, 0.85), w1, 0, Hh);
        seg(new THREE.Vector2(w0.x, -1.25), new THREE.Vector2(w0.x, 1.25), 2.3, Hh);
        continue;
      }
      seg(a, c, 0, Hh);
    }
    // the frost door (sliding along z in the west curtain)
    const px = -FT.HALF - 0.02;
    this.slideDoor('postern', -0.85, 0.85, 0, px + 0.1, 2.3, 1.7, (lb, wd) => {
      lb.add(m.panel, box(wd, 2.28, 0.12, wd / 2, 1.14, 0));
      lb.add(m.frost, box(wd, 0.5, 0.13, wd / 2, 0.25, 0));
      lb.add(m.steel, box(0.06, 0.18, 0.1, wd - 0.18, 1.1, -0.08));
    }, true);
    b.add(m.print, fortPrint('frostDoor', 0.7, 0.35, M(px - 0.04, 2.6, 0, -Math.PI / 2)));
    b.add(m.grey, box(0.12, 0.4, 0.3, px - 0.08, 1.3, 1.25));
    this.points.postern = this.w(px - 1.2, 1.2, 0.2);
    this.points.posternIn = this.w(px + 2.2, 1.0, 0);
    // the bastions' tips carry the thermal cameras, looking out along the berm both ways
    const tips = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    tips.forEach(([sx, sz], i) => {
      const t = V(sx * FT.TIP * 0.92, Hh + 0.6, sz * FT.TIP * 0.92);
      b.add(m.panel, cyl(0.12, 0.12, 0.6, t.x, Hh + 0.3, t.z, 6));
      this.camera(`b${i}`, b, m, t.x, t.y, t.z, Math.atan2(sx, sz), deg(75), 13, 22, 26);
    });
    this.points.speaker = this.w(0, 8, 2);
  }

  /** A thermal camera (the runtime yaws `pivot`; its body looks down +z). */
  private camera(id: string, b: MeshBatch, m: ReturnType<FortressBuilder['mats']>, x: number, y: number, z: number, yaw0: number, sweep: number, period: number, range: number, halfDeg: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const lens = this.pal.slot('#ff8a2a', 1);
    const cb = new MeshBatch();
    cb.add(m.panel, box(0.24, 0.22, 0.46, 0, 0, 0.1));
    cb.add(m.dark, cyl(0.09, 0.09, 0.06, 0, 0, 0.35, 12, Math.PI / 2));
    lens.add(cb, box(0.05, 0.05, 0.02, 0.06, 0.07, 0.36));
    pivot.add(cb.build(`fortCam:${id}`));
    this.group.add(pivot);
    b.add(m.dark, cyl(0.03, 0.03, 0.2, x, y + 0.15, z, 6));
    this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3), yaw0, sweep, period, range, halfAngle: deg(halfDeg), lens: lens.intensity });
  }

  // ------------------------------------------------------------------ the gate, its tower, the drawbridge
  private buildGate(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const { GATE: G, GATE_H, HALF: H } = FT;
    const { r0, r1 } = FORTRESS_MOAT;
    // the gate tower over the gate: taller than the walls, the winch housing on its face
    b.add(m.black, box(G * 2 + 3.2, 10, 3.2, 0, 5, -H + 0.4));
    b.add(m.panel, box(G * 2 + 3.4, 0.3, 3.4, 0, 10.1, -H + 0.4));
    this.col(-G - 1.2, 5, -H + 0.4, 1.0, 5, 1.6);
    this.col(G + 1.2, 5, -H + 0.4, 1.0, 5, 1.6);
    this.col(0, GATE_H + (10 - GATE_H) / 2, -H + 0.4, G + 2.2, (10 - GATE_H) / 2, 1.6);
    b.add(m.grey, box(3.4, 1.4, 0.9, 0, GATE_H + 2.2, -H - 1.6));
    b.add(m.dark, cyl(0.45, 0.45, 3.2, 0, GATE_H + 2.2, -H - 2.0, 12, 0, 0, Math.PI / 2));
    b.add(m.print, fortPrint('keepSign', 3.6, 0.9, M(0, GATE_H + 4.0, -H - 1.22, Math.PI)));
    const avi = this.pal.slot('#ff2a14', 3);
    this.slots.aviation = avi.intensity;
    avi.add(b, place(new THREE.SphereGeometry(0.16, 8, 6), 0, 10.6, -H + 0.4));
    this.halos.add(V(0, 10.6, -H + 0.4), '#ff2a14', 1.6, FortressBuilder.CH.BLINK, 1.2);
    // the gate: a steel leaf sliding west into the wall
    this.slideDoor('gate', -G, G, 0, -H - 0.9, GATE_H, -(G * 2 + 0.2), (lb, wd) => {
      lb.add(m.panel, box(wd, GATE_H - 0.02, 0.2, wd / 2, GATE_H / 2, 0));
      for (let k = 0; k < 4; k++) lb.add(m.dark, box(wd - 0.2, 0.08, 0.22, wd / 2, 0.8 + k * 1.1, 0));
      lb.add(m.frost, box(wd, 0.6, 0.21, wd / 2, 0.3, 0));
    });
    this.points.gateIn = this.w(0, 1.0, -H + 3);
    // the drawbridge: hinged on the inner lip, raised it stands against the tower; its deck spans the moat
    const span = r1 - r0 + 0.6;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.35, -r0 + 0.2);
    pivot.userData.x0 = 0;
    const lb = new MeshBatch();
    lb.add(m.wood, box(4.2, 0.22, span, 0, 0, -span / 2));
    lb.add(m.panel, box(0.25, 0.4, span, -2.1, 0.1, -span / 2), box(0.25, 0.4, span, 2.1, 0.1, -span / 2));
    for (let k = 0; k < 7; k++) lb.add(m.dark, box(4.2, 0.05, 0.12, 0, 0.12, -0.5 - k * (span - 1) / 6));
    lb.add(m.frost, box(4.2, 0.03, span * 0.4, 0, 0.12, -span + span * 0.2));
    pivot.add(lb.build('fortBridge'));
    this.group.add(pivot);
    this.bridge = pivot;
    const cpos = this.w(0, 3.4, -r0 + 0.1), chalf = V(2.2, 3.2, 0.15);
    this.doors.bridge = { pivot, open: 0, target: 0, collider: this.physics.addBox(cpos, chalf), axis: 'slide', amount: 0, colliderSpec: { pos: cpos, half: chalf } };
    // its chains, from the deck's far end up to the tower (re-aimed by the runtime each frame it moves)
    this.chains = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(g, m.chain);
      mesh.castShadow = false;
      this.group.add(mesh);
      this.chains.push(mesh);
      this.chainTop.push(V(sx * 2.0, 8.6, -H - 1.3));
    }
    this.points.bridgeDeck = this.w(0, 0.4, -(r0 + r1) / 2);
    // (the deck's collider while it's down: the runtime adds it)
    this.points.bridgeCentre = this.w(0, 0.35, -r0 - span / 2 + 0.2); // the deck collider's middle: its top meets the planks (0.24 sank you 10 cm)
  }

  /** Where the chain hangs from on the deck (local), for the deck turned by `open` (1 down … 0 up). */
  deckEnd(open: number, sx: number, out = new THREE.Vector3()) {
    const span = FORTRESS_MOAT.r1 - FORTRESS_MOAT.r0 + 0.6;
    const a = (1 - open) * Math.PI / 2;
    return out.set(sx * 2.0, 0.35 + Math.sin(a) * (span - 0.3), -FORTRESS_MOAT.r0 + 0.2 - Math.cos(a) * (span - 0.3));
  }

  // ------------------------------------------------------------------ the yard: the coolers, the frost
  private buildYard(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const r = rng(7);
    // the yard's paving, frosted round the coolers
    b.add(m.pad, place(new THREE.PlaneGeometry(FT.HALF * 2, FT.HALF * 2), 0, 0.02, 0, -Math.PI / 2));
    // dry coolers in each bastion: a bank of fan modules on legs, piped to the keep
    const cool = this.pal.slot('#7fd6ff', 0.8);
    this.slots.cool = cool.intensity;
    for (const [sx, sz] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const cx = sx * 10.2, cz = sz * 10.2;
      const yaw = Math.atan2(sx, sz);
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 2.1;
        const x = cx + Math.cos(yaw) * off, z = cz - Math.sin(yaw) * off;
        b.add(m.panel, box(2.0, 1.4, 2.0, x, 1.0, z, yaw));
        b.add(m.dark, cyl(0.8, 0.8, 0.08, x, 1.74, z, 16));
        b.add(m.steel, box(1.6, 0.04, 0.08, x, 1.79, z, yaw + r()), box(1.6, 0.04, 0.08, x, 1.79, z, yaw + r() + 1.5));
        b.add(m.frost, box(2.02, 0.3, 2.02, x, 0.45, z, yaw));
        cool.add(b, box(0.4, 0.05, 0.02, x + Math.sin(yaw) * 1.01, 1.4, z + Math.cos(yaw) * 1.01, yaw));
        this.col(x, 0.9, z, 1.0, 0.9, 1.0, yaw);
      }
      b.add(m.print, fortPrint('coolerPlate', 0.8, 0.2, M(cx + Math.sin(yaw) * 1.02, 1.6, cz + Math.cos(yaw) * 1.02, yaw)));
      // the pipes to the keep, on low stands
      const a = V(cx * 0.8, 0.9, cz * 0.8), c = V(sx * 6.6, 0.9, sz * (sz > 0 ? 7.5 : 3.5));
      b.add(m.pipe, beam(a, c, 0.18, 8), beam(a.clone().setY(1.4), c.clone().setY(1.4), 0.12, 8));
    }
    // floods on the keep's roof corners (lit at night)
    const yard = this.pal.slot('#e0f0ff', 0);
    this.slots.yard = yard.intensity;
    // the keep's north corners carry two more thermal cameras, over the yard and the gate
    const [x0, x1, z0] = FT.KEEP;
    this.camera('k0', b, m, x0 + 0.3, FT.KEEP_H + 0.1, z0 - 0.3, Math.PI - 0.5, deg(55), 11, 16, 30);
    this.camera('k1', b, m, x1 - 0.3, FT.KEEP_H + 0.1, z0 - 0.3, Math.PI + 0.5, deg(55), 11, 16, 30);
    for (const x of [x0 + 0.5, x1 - 0.5]) yard.add(b, box(0.5, 0.15, 0.25, x, FT.KEEP_H + 0.35, z0 - 0.2));
  }

  // ------------------------------------------------------------------ the keep: walls, hall, board room, locker room
  private buildKeep(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const [x0, x1, z0, z1] = FT.KEEP, H = FT.KEEP_H, t = 0.4;
    const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
    // the shell: black panels, a door in the north face, slit windows lit from inside
    b.add(m.black, box(t, H, D, x0, H / 2, zc), box(t, H, D, x1, H / 2, zc), box(W, H, t, xc, H / 2, z1));
    b.add(m.black, box((W - 2.2) / 2, H, t, x0 + (W - 2.2) / 4, H / 2, z0), box((W - 2.2) / 2, H, t, x1 - (W - 2.2) / 4, H / 2, z0), box(2.2, H - 2.5, t, 0, 2.5 + (H - 2.5) / 2, z0));
    this.col(x0, H / 2, zc, t / 2, H / 2, D / 2);
    this.col(x1, H / 2, zc, t / 2, H / 2, D / 2);
    this.col(xc, H / 2, z1, W / 2, H / 2, t / 2);
    this.col(x0 + (W - 2.2) / 4, H / 2, z0, (W - 2.2) / 4, H / 2, t / 2);
    this.col(x1 - (W - 2.2) / 4, H / 2, z0, (W - 2.2) / 4, H / 2, t / 2);
    this.col(0, 2.5 + (H - 2.5) / 2, z0, 1.1, (H - 2.5) / 2, t / 2);
    b.add(m.panel, box(W + 0.4, 0.4, D + 0.4, xc, H + 0.2, zc));
    b.add(m.dark, box(W, 0.1, D, xc, H - 0.05, zc));
    b.add(m.floor, place(new THREE.PlaneGeometry(W - 0.2, D - 0.2), xc, 0.03, zc, -Math.PI / 2));
    b.add(m.frost, box(W + 0.1, 0.9, 0.05, xc, 0.45, z0 - 0.23), box(0.05, 0.9, D, x0 - 0.23, 0.45, zc), box(0.05, 0.9, D, x1 + 0.23, 0.45, zc));
    const keep = this.pal.slot('#bfe6ff', 1.6);
    this.slots.keep = keep.intensity;
    for (const z of [-1, 2.5, 6]) for (const s of [-1, 1]) keep.add(b, box(0.02, 1.6, 0.18, s * (x1 + 0.21), 4.2, z));
    for (const x of [-4.5, 4.5]) keep.add(b, box(0.18, 1.6, 0.02, x, 4.2, z0 - 0.21));
    // ribs on the keep's faces, and a band of louvres under the roof
    for (let x = x0 + 1.5; x < x1 - 0.5; x += 1.6) {
      if (Math.abs(x) < 1.6) continue;
      b.add(m.panel, box(0.22, H - 0.4, 0.18, x, (H - 0.4) / 2, z0 - 0.28));
      b.add(m.panel, box(0.22, H - 0.4, 0.18, x, (H - 0.4) / 2, z1 + 0.28));
    }
    for (let z = z0 + 1.5; z < z1 - 0.5; z += 1.6) for (const s of [-1, 1]) b.add(m.panel, box(0.18, H - 0.4, 0.22, s * (x1 + 0.28), (H - 0.4) / 2, z));
    b.add(m.dark, box(W + 0.5, 0.7, 0.12, xc, H - 0.9, z0 - 0.3), box(W + 0.5, 0.7, 0.12, xc, H - 0.9, z1 + 0.3), box(0.12, 0.7, D + 0.5, x0 - 0.3, H - 0.9, zc), box(0.12, 0.7, D + 0.5, x1 + 0.3, H - 0.9, zc));
    keep.add(b, box(0.5, 0.04, 6.6, 0, H - 0.12, -0.6), box(3.6, 0.04, 0.5, 0, H - 0.12, 5.5));
    // roof: four fan units, ducts
    for (const [fx, fz] of [[-3.5, -1], [3.5, -1], [-3.5, 5], [3.5, 5]]) {
      b.add(m.panel, box(2.6, 1.2, 2.6, fx, H + 1.0, fz));
      b.add(m.dark, cyl(1.05, 1.05, 0.1, fx, H + 1.62, fz, 18));
      b.add(m.steel, box(2.0, 0.04, 0.1, fx, H + 1.68, fz, 0.4), box(2.0, 0.04, 0.1, fx, H + 1.68, fz, 1.97));
    }
    // the door: steel, sliding east
    this.slideDoor('keepDoor', -1.0, 1.0, 0, z0, 2.4, 2.05, (lb, wd) => {
      lb.add(m.panel, box(wd, 2.38, 0.14, wd / 2, 1.19, 0));
      lb.add(m.frost, box(wd, 0.06, 0.15, wd / 2, 2.36, 0), box(0.06, 2.38, 0.15, 0.03, 1.19, 0));
    });
    b.add(m.print, fortPrint('keepSign', 2.4, 0.6, M(0, 2.95, z0 - 0.22, Math.PI)));
    const pad = this.pal.slot('#ff3a2a', 2), ok = this.pal.slot('#5fe08a', 0);
    this.slots.padRed = pad.intensity;
    this.slots.padOk = ok.intensity;
    b.add(m.dark, box(0.16, 0.22, 0.05, 1.45, 1.3, z0 - 0.24));
    pad.add(b, box(0.1, 0.02, 0.01, 1.45, 1.38, z0 - 0.27));
    ok.add(b, box(0.1, 0.02, 0.01, 1.45, 1.34, z0 - 0.27));
    this.points.keepDoor = this.w(0.6, 1.2, z0 - 1.2);
    this.points.keepIn = this.w(0, 1.0, z0 + 1.2);
    // inside: the hall's walls (to the rooms, with doorways), the rooms' south walls
    const { HALL: hx, ROOMS_Z: rz } = FT;
    for (const s of [-1, 1]) {
      // doorway z −3.2…−1.6 into each room
      b.add(m.panel, box(0.15, H, 0.7, s * hx, H / 2, z0 + 0.35), box(0.15, H, rz + 1.6, s * hx, H / 2, (-1.6 + rz) / 2));
      b.add(m.panel, box(0.15, H - 2.3, 1.6, s * hx, 2.3 + (H - 2.3) / 2, -2.4));
      this.col(s * hx, H / 2, z0 + 0.35, 0.08, H / 2, 0.35);
      this.col(s * hx, H / 2, (-1.6 + rz) / 2, 0.08, H / 2, (rz + 1.6) / 2);
      const rw = 6.5 - hx;
      b.add(m.panel, box(rw, H, 0.15, s * (hx + rw / 2), H / 2, rz));
      this.col(s * (hx + rw / 2), H / 2, rz, rw / 2, H / 2, 0.08);
    }
    // the laser grid across the hall (beams the runtime draws and trips), and its junction box
    const lz = [-0.9, 0.7];
    const laserMat = (c: string) => new THREE.MeshBasicNodeMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const lm = laserMat('#ff3030');
    lz.forEach((z, i) => {
      for (const [k, y] of [[0, 0.45], [1, 1.2]] as [number, number][]) {
        if (i === 1 && k === 1) continue;
        const a = this.w(-hx + 0.1, y, z), c = this.w(hx - 0.1, y, z);
        const g = new THREE.CylinderGeometry(0.008, 0.008, hx * 2 - 0.2, 4);
        g.rotateZ(Math.PI / 2);
        const mesh = new THREE.Mesh(g, lm);
        mesh.position.set(0, y, z);
        mesh.castShadow = false;
        mesh.renderOrder = 21;
        this.group.add(mesh);
        const intensity = { value: 1 };
        this.lasers.push({ id: `l${i}${k}`, a, b: c, mesh, intensity });
        for (const s of [-1, 1]) b.add(m.dark, box(0.06, 0.12, 0.08, s * (hx - 0.04), y, z));
      }
    });
    b.add(m.grey, box(0.1, 0.5, 0.36, hx - 0.1, 1.25, z0 + 0.9));
    this.points.gridBox = this.w(hx - 0.8, 1.2, z0 + 0.9);
    this.points.hall = this.w(0, 1.0, 0);
    // the board room (west): the power board on the west wall, a stool, a cable tray overhead
    const bx = x0 + 0.3;
    b.add(m.dark, box(0.25, 2.2, 2.6, bx, 1.5, -1.0));
    b.add(m.print, fortPrint('boardLabels', 1.8, 1.8, M(bx + 0.14, 1.6, -1.0, Math.PI / 2)));
    const on = this.pal.slot('#5fe08a', 1.6), warn = this.pal.slot('#ff5a3a', 0);
    this.slots.boardOn = on.intensity;
    this.slots.boardWarn = warn.intensity;
    for (let k = 0; k < 4; k++) {
      b.add(m.grey, box(0.12, 0.22, 0.12, bx + 0.2, 1.95 - k * 0.42, -0.25));
      on.add(b, box(0.02, 0.05, 0.05, bx + 0.27, 1.95 - k * 0.42, -0.1));
    }
    warn.add(b, box(0.02, 0.08, 1.2, bx + 0.15, 2.7, -1.0));
    this.col(bx, 1.5, -1.0, 0.15, 1.5, 1.3);
    b.add(m.post, cyl(0.2, 0.2, 0.05, x0 + 2.2, 0.62, -0.5, 10), cyl(0.03, 0.03, 0.6, x0 + 2.2, 0.31, -0.5, 6));
    this.points.board = this.w(bx + 1.2, 1.2, -1.0);
    // the locker room (east): lockers, a bench, the heat log, a heater with one bar lit
    const lx = x1 - 0.3;
    b.add(m.grey, box(0.5, 2.0, 2.6, lx - 0.1, 1.0, -1.6));
    b.add(m.print, fortPrint('lockers', 2.5, 1.9, M(lx - 0.36, 1.0, -1.6, -Math.PI / 2)));
    b.add(m.wood, box(0.45, 0.06, 2.0, lx - 1.6, 0.46, -1.4), box(0.06, 0.44, 0.4, lx - 1.6, 0.22, -2.2), box(0.06, 0.44, 0.4, lx - 1.6, 0.22, -0.6));
    b.add(m.print, fortPrint('heatLog', 0.6, 0.8, M(hx + 0.09, 1.55, -0.2, Math.PI / 2)));
    b.add(m.grey, box(0.5, 0.6, 0.2, lx - 0.3, 0.35, 0.9));
    const heat = this.pal.slot('#ff6a2a', 1.6);
    this.slots.heater = heat.intensity;
    heat.add(b, box(0.4, 0.04, 0.02, lx - 0.3, 0.45, 0.79));
    this.col(lx - 0.1, 1.0, -1.6, 0.25, 1.0, 1.3);
    this.col(lx - 1.6, 0.25, -1.4, 0.23, 0.25, 1.0);
    this.marekSpot = { pos: this.w(hx + 2.2, 0, 0.4), yaw: -Math.PI / 2 + 0.6 };
    this.points.marek = this.w(hx + 1.2, 1.2, -0.6);
  }

  // ------------------------------------------------------------------ the vault: glass, racks, Kit's desk
  private buildVault(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const [x0, x1, , z1] = FT.KEEP, gz = FT.GLASS_Z, H = FT.KEEP_H;
    // the glass wall with the vault door in it (powered: it slides east)
    for (const s of [-1, 1]) {
      const w = (x1 - x0) / 2 - 1.1 - 0.2;
      b.add(m.glass, box(w, 3.4, 0.05, s * (1.1 + w / 2), 1.7, gz));
      b.add(m.steel, box(0.08, 3.4, 0.1, s * 1.1, 1.7, gz), box(0.08, 3.4, 0.1, s * (x1 - 0.2), 1.7, gz));
      this.col(s * (1.1 + w / 2), 1.7, gz, w / 2, 1.7, 0.05);
    }
    b.add(m.steel, box(x1 - x0, 0.12, 0.12, 0, 3.4, gz));
    b.add(m.panel, box(x1 - x0, H - 3.4, 0.2, 0, 3.4 + (H - 3.4) / 2, gz));
    b.add(m.print, fortPrint('vaultGlass', 3.2, 0.8, M(-3.6, 2.4, gz - 0.03, Math.PI)));
    this.slideDoor('vaultDoor', -1.05, 1.05, 0, gz, 2.6, 2.2, (lb, wd) => {
      lb.add(m.steel, box(wd, 2.58, 0.18, wd / 2, 1.29, 0));
      lb.add(m.dark, box(wd - 0.3, 2.2, 0.2, wd / 2, 1.29, 0));
      lb.add(m.amber, box(0.08, 0.6, 0.21, wd - 0.25, 1.3, 0));
    });
    this.points.vaultDoor = this.w(0, 1.2, gz - 1.0);
    this.points.vaultIn = this.w(0, 1.0, gz + 1.0);
    // the racks along the back wall: boxed chips under blue light
    const racks = this.pal.slot('#5fd8ff', 1.4), vault = this.pal.slot('#e8f4ff', 1.2);
    this.slots.racks = racks.intensity;
    this.slots.vault = vault.intensity;
    const r = rng(23);
    for (let x = x0 + 0.8; x < x1 - 0.6; x += 1.25) {
      b.add(m.panel, box(1.15, 3.0, 0.7, x, 1.5, z1 - 0.65));
      for (let y = 0.35; y < 2.9; y += 0.42) {
        for (let k = 0; k < 3; k++) {
          const bx = x - 0.36 + k * 0.36;
          b.add(m.chip, box(0.32, 0.3, 0.5, bx, y + 0.15, z1 - 0.62));
          if (r() < 0.35) b.add(m.print, fortPrint('boxLabel', 0.28, 0.14, M(bx, y + 0.16, z1 - 0.89, Math.PI)));
        }
      }
      racks.add(b, box(1.05, 0.02, 0.02, x, 2.95, z1 - 1.0));
      this.col(x, 1.5, z1 - 0.65, 0.58, 1.5, 0.35);
    }
    this.halos.add(V(0, 2.9, z1 - 1.1), '#5fd8ff', 4, FortressBuilder.CH.VAULT, 0.35);
    // the allocation board over the racks, facing the door
    const face = new THREE.PlaneGeometry(3.6, 1.8);
    face.applyMatrix4(M(0, 4.5, z1 - 0.34, Math.PI));
    const screen = new THREE.Mesh(norm(face), this.board.material);
    screen.castShadow = false;
    this.group.add(screen);
    b.add(m.dark, box(3.8, 2.0, 0.1, 0, 4.5, z1 - 0.28));
    // Kit's desk: a slab of black glass on steel, her chair, a heater under it (hers works)
    const dz = gz + 2.0;
    b.add(m.dark, box(2.4, 0.06, 0.9, 0, 0.78, dz));
    b.add(m.steel, box(0.08, 0.76, 0.8, -1.1, 0.38, dz), box(0.08, 0.76, 0.8, 1.1, 0.38, dz));
    b.add(m.black, box(0.55, 0.36, 0.03, -0.5, 1.0, dz + 0.25, Math.PI + 0.1));
    vault.add(b, box(0.5, 0.31, 0.01, -0.5, 1.0, dz + 0.235, Math.PI + 0.1));
    b.add(m.print, fortPrint('deskPlate', 0.4, 0.15, M(0.5, 0.88, dz - 0.46, Math.PI)));
    this.col(0, 0.4, dz, 1.2, 0.4, 0.45);
    b.add(m.seat, box(0.55, 0.1, 0.55, 0, 0.48, dz + 0.95), box(0.55, 0.75, 0.08, 0, 0.9, dz + 1.25));
    b.add(m.steel, cyl(0.04, 0.04, 0.45, 0, 0.23, dz + 0.95, 6));
    this.kitSeat = { pos: this.w(0, 0, dz + 0.95), yaw: Math.PI };
    this.points.kit = this.w(0.2, 1.2, dz - 1.3);
    this.points.console = this.w(-0.7, 1.2, dz - 1.0);
    // the drinking tank (west) and the dispenser (east): the loot
    b.add(m.steel, cyl(0.6, 0.6, 2.0, x0 + 1.0, 1.0, dz, 16));
    b.add(m.amber, box(0.15, 0.12, 0.2, x0 + 1.6, 1.0, dz));
    this.col(x0 + 1.0, 1.0, dz, 0.6, 1.0, 0.6);
    this.lootSpots.push({ id: 'tank', pos: this.w(x0 + 2.2, 1.0, dz), mesh: new THREE.Group() });
    b.add(m.panel, box(1.0, 1.8, 0.6, x1 - 1.0, 0.9, dz));
    b.add(m.amber, box(0.6, 0.2, 0.02, x1 - 1.0, 1.4, dz - 0.31));
    b.add(m.dark, box(0.5, 0.3, 0.05, x1 - 1.0, 0.7, dz - 0.31));
    this.col(x1 - 1.0, 0.9, dz, 0.5, 0.9, 0.3);
    this.lootSpots.push({ id: 'dispenser', pos: this.w(x1 - 1.0, 1.0, dz - 1.1), mesh: new THREE.Group() });
    this.lootSpots.push({ id: 'kitdesk', pos: this.w(1.3, 1.0, dz - 0.9), mesh: new THREE.Group() });
  }

  // ------------------------------------------------------------------ outside: gatehouse, queue, pump house, the road sign
  private buildOutside(b: MeshBatch, m: ReturnType<FortressBuilder['mats']>) {
    const { r1 } = FORTRESS_MOAT;
    // the gatehouse booth on the outer bank, west of the bridge's landing
    const gx = -4.6, gz = -r1 - 3.0;
    b.add(m.black, box(2.6, 2.6, 2.2, gx, 1.3, gz));
    b.add(m.panel, box(2.9, 0.2, 2.5, gx, 2.7, gz));
    b.add(m.glass, box(2.2, 1.0, 0.05, gx, 1.6, gz + 1.11));
    b.add(m.print, fortPrint('gatehouse', 2.4, 0.9, M(gx, 3.3, gz - 1.12, Math.PI)));
    b.add(m.grey, box(0.3, 0.4, 0.12, gx + 1.4, 1.3, gz - 1.2));
    const gh = this.pal.slot('#7fd6ff', 1.4);
    this.slots.gatehouse = gh.intensity;
    gh.add(b, box(0.22, 0.04, 0.01, gx + 1.4, 1.45, gz - 1.27));
    this.col(gx, 1.3, gz, 1.3, 1.3, 1.1);
    this.points.gatehouse = this.w(gx + 1.5, 1.2, gz - 2.0);
    // the ticket post
    b.add(m.post, cyl(0.06, 0.06, 1.3, gx - 2.2, 0.65, gz - 2.2, 6));
    b.add(m.print, fortPrint('ticket', 0.4, 0.6, M(gx - 2.2, 1.45, gz - 2.25, Math.PI)));
    // the allocation queue back up Lattice's road from the banner: camping chairs on the west
    // shoulder facing the gate, tents behind them (a line due north climbed the mesa's riser)
    const road = FORTRESS_ROAD.map(([x, z]) => new THREE.Vector2(x - this.origin.x, z - this.origin.z)).reverse();
    /** `s` metres back up the road from its end: the point, and the way back up (unit). */
    const along = (s: number) => {
      for (let k = 0; ; k++) {
        const a = road[k], c = road[k + 1], len = a.distanceTo(c);
        if (s <= len || k === road.length - 2) {
          const dx = (c.x - a.x) / len, dz = (c.y - a.y) / len;
          return { x: a.x + dx * s, z: a.y + dz * s, dx, dz };
        }
        s -= len;
      }
    };
    const r = rng(41);
    const chairAt = (x: number, z: number, yaw: number, mat: THREE.Material) => {
      const y = this.gy(x, z);
      const f = (dx: number, dy: number, dz: number, w: number, h: number, d: number, mm: THREE.Material) => {
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        b.add(mm, box(w, h, d, x + dx * cs + dz * sn, y + dy, z - dx * sn + dz * cs, yaw));
      };
      f(0, 0.42, 0, 0.5, 0.04, 0.45, mat);
      f(0, 0.72, 0.22, 0.5, 0.5, 0.04, mat);
      for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) f(lx, 0.2, lz, 0.03, 0.42, 0.03, m.post);
      return y;
    };
    const NOTE = 2;
    for (let i = 0; i < 14; i++) {
      const q = along(2 + i * 1.6), side = 1.8 + (r() - 0.5) * 0.3;
      // (the shoulder is to the right of the way back up: west of the road)
      const x = q.x + q.dz * side, z = q.z - q.dx * side;
      if (r() < 0.12 && i !== NOTE) continue;
      const yaw = Math.atan2(q.dx, q.dz) + (r() - 0.5) * 0.5;
      const y = chairAt(x, z, yaw, r() < 0.6 ? m.chair : m.seat);
      if (i === NOTE) {
        // the note, weighed down with a stone on the seat
        b.add(m.white, box(0.2, 0.004, 0.27, x, y + 0.443, z, yaw + 0.3));
        b.add(m.rock, place(rockGeometry(17, 0), x + 0.05, y + 0.47, z - 0.04, 0, 0, 0, 0.05));
        this.points.queue = this.w(x, y + 0.6, z);
      }
      if (i % 4 === 1) {
        // a ridge tent: a triangular prism on its side, the flaps tied back
        const tx = x + q.dz * 2.8, tz = z - q.dx * 2.8, ty = this.gy(tx, tz);
        const sh = new THREE.Shape();
        sh.moveTo(-0.9, 0); sh.lineTo(0.9, 0); sh.lineTo(0, 1.1); sh.lineTo(-0.9, 0);
        const tent = new THREE.ExtrudeGeometry(sh, { depth: 2.0, bevelEnabled: false });
        tent.translate(0, 0, -1.0);
        tent.rotateY(Math.atan2(q.dx, q.dz) + r() * 0.6 - 0.3);
        b.add(m.tent, place(tent, tx, ty, tz));
      }
    }
    b.add(m.print, fortPrint('queueBanner', 3.2, 0.8, M(-1.2, 2.6, gz - 3.4, Math.PI)));
    b.add(m.post, box(0.08, 3.0, 0.08, -2.8, 1.5, gz - 3.4), box(0.08, 3.0, 0.08, 0.4, 1.5, gz - 3.4));
    this.points.outside = this.w(1.5, 0, gz - 6);
    // (?at=fortress starts on the road behind the last chair)
    const st = along(30);
    this.points.road = this.w(st.x, 0, st.z);
    // the road sign at the queue's end, on the east shoulder, facing whoever comes down the road
    const sq = along(25), sx = sq.x - sq.dz * 3.2, sz = sq.z + sq.dx * 3.2, sg = this.gy(sx, sz);
    const syaw = Math.atan2(sq.dx, sq.dz), cs = Math.cos(syaw), sn = Math.sin(syaw);
    b.add(m.post, box(0.1, 2.4, 0.1, sx - cs * 0.9, sg + 1.2, sz + sn * 0.9, syaw), box(0.1, 2.4, 0.1, sx + cs * 0.9, sg + 1.2, sz - sn * 0.9, syaw));
    b.add(m.print, fortPrint('roadSign', 2.2, 1.375, M(sx + sq.dx * 0.07, sg + 1.75, sz + sq.dz * 0.07, syaw)));
    // the pump house on the west bank, pipes over the lip into the moat
    const px = -r1 - 5.5, pz = 3;
    const pg = this.gy(px, pz);
    b.add(m.black, box(4.6, 3.2, 4.0, px, pg + 1.6, pz));
    b.add(m.panel, box(4.9, 0.25, 4.3, px, pg + 3.3, pz));
    b.add(m.print, fortPrint('pumpSign', 1.8, 0.56, M(px + 2.32, pg + 2.7, pz, Math.PI / 2)));
    this.col(px, pg + 1.6, pz - 1.2, 2.3, 1.6, 0.8);
    this.col(px, pg + 1.6, pz + 1.8, 2.3, 1.6, 0.2);
    this.col(px - 2.2, pg + 1.6, pz + 1.0, 0.1, 1.6, 0.8);
    this.col(px + 2.25, pg + 1.6, pz + 1.55, 0.1, 1.6, 0.45);
    // (inside: the pumps, the valve wheel)
    b.add(m.steel, cyl(0.55, 0.55, 1.4, px - 1.0, pg + 0.7, pz - 0.6, 14, 0, 0, Math.PI / 2), cyl(0.55, 0.55, 1.4, px + 0.6, pg + 0.7, pz - 0.6, 14, 0, 0, Math.PI / 2));
    b.add(m.red, place(new THREE.TorusGeometry(0.35, 0.05, 6, 16), px - 0.3, pg + 1.3, pz + 1.0, 0, 0));
    b.add(m.frost, box(4.0, 0.1, 1.2, px, pg + 0.05, pz - 0.6));
    this.points.drain = this.w(px - 0.3, 1.2, pz + 0.2);
    this.slideDoor('pumpDoor', pz + 0.4, pz + 1.5, pg, px + 2.3, 2.2, 1.0, (lb, wd) => {
      lb.add(m.panel, box(wd, 2.18, 0.1, wd / 2, 1.09, 0));
    }, true);
    this.points.pumpDoor = this.w(px + 3.4, 1.2, pz + 0.95);
    for (const y of [0.6, 1.2]) b.add(m.pipe, beam(V(px + 2.3, pg + y, pz - 0.8), V(-r1 + 0.6, y, pz - 0.8), 0.14, 8), beam(V(-r1 + 0.6, y, pz - 0.8), V(-r1 + 1.6, FT.SURF - 0.4 + y * 0.2, pz - 0.8), 0.14, 8));
    // scattered rocks off the pad
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, rad = r1 + 6 + r() * 6, x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (z < -r1 - 2 && Math.abs(x) < 8) continue;
      if (Math.abs(x - px) < 6 && Math.abs(z - pz) < 6) continue;
      b.add(m.rock, place(rockGeometry(i * 9 + 4, 0), x, this.gy(x, z) + 0.1, z, 0, a, 0, 0.5 + r() * 0.5));
    }
  }

  // ------------------------------------------------------------------ the technicians' routes
  private buildRoutes() {
    const at = (x: number, z: number) => this.w(x, 0, z);
    this.routes.t1 = [at(-8.5, -8.2), at(-3, -8.4), at(3, -8.4), at(8.5, -8.2)];
    this.routes.t2 = [at(8.6, -5.4), at(8.8, 2), at(8.6, 9.4), at(0, 9.6), at(-8.6, 9.4), at(-8.8, 2), at(-8.6, -5.4)];
    this.routes.t3 = [at(-4.6, -3.2), at(-4.4, 0.6)];
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
      yard: [L('#dfefff', 16, -6, 7.8, -6, 1.2), L('#dfefff', 16, 6, 7.8, -6, 1.2)],
      hall: L('#d8ecff', 9, 0, 3.2, -1.5, 2),
      board: L('#ffd0a0', 5, -4.4, 2.6, -1.0, 2),
      lockers: L('#ffb07a', 5, 4.2, 2.4, -0.6, 2),
      vault: L('#b8e4ff', 12, 0, 3.6, 5.6, 2.4),
      gate: L('#dfefff', 14, 0, 8.5, -FT.HALF - 2, 1),
      pump: L('#dfefff', 8, -FORTRESS_MOAT.r1 - 5.5, 3.6, 3, 1),
    };
  }
}
