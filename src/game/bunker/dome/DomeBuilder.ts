import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, norm, MeshBatch, DistanceLod, shadowProxy } from '../../world/kit';
import { surfaces } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, chainLink, fabric, wood, desertRock, corrugated } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { LiveScreen } from '../apex/apexAtlas';
import { domePrint, domePrintMaterial, paintBoard, GOLD } from './domeAtlas';
import { Steam, domePaneMaterial, uDomeFloor } from './domeFx';
import type { BunkerShell, Door, LootSpot, SecurityCamera, Tripwire, Laser } from '../shell';

/**
 * The Singularity Dome, on a pad on the shelf under the southern range. Local metres, origin at the
 * pad's centre, axes as the world's (north is -z, where Ascend's road comes in). Angles θ from +z
 * toward +x, so a point at radius r is (r sin θ, r cos θ): θ = 180° is north.
 *
 * - The fence: chain-link on a 40 m ring, the slide gate on the north side with the voice post, the
 *   visitor hut outside it (Hunter at the desk), and Outfall 3 on the east side, a grated gap at the
 *   foot of the fence where the cooling water used to run out.
 * - The yard: two cooling towers (south-east, steaming), two evaporation ponds (west), the turbine
 *   yard (south-west), pipe racks into the dome.
 * - The dome: a geodesic glass hemisphere (r 22) on a 1.2 m stem wall, with an airlock vestibule on
 *   the north. Inside: the all-hands (rows of empty chairs facing a round stage at the centre, the
 *   release board hung over it, the hologram's projector ring), the racks in the south half, Gil's
 *   on-call desk in the west wing, the build farm's glass room in the east wing, and a spiral stair
 *   round the central mast up to the pod.
 * - The pod (y 12): a glass drum (r 5.6) hung round the mast. The stair arrives in a glass box round
 *   the mast; its door opens north into the ring: the Cluster's tank (south), Hunter's desk and his
 *   chair (east), the tap, his locker and the spares cage (west).
 */
export const DM = {
  R: 22, WALL: 1.2,
  FENCE: 40, GATE_W: 3.2,
  /** The vestibule: half-width, its outer face (z), height. */
  VW: 2.4, VZ: -27.5, VH: 3.6,
  /** The stage round the mast, and the mast. */
  STAGE: 5, STAGE_H: 0.6, MAST: 0.9,
  /** The spiral: inner/outer radius, its top (the pod floor), turns. */
  SP_IN: 1.0, SP_OUT: 2.6, POD_Y: 12, TURNS: 2,
  /** The pod: outer radius, height; the glass box round the stair's head (half-size). */
  POD_R: 5.6, POD_H: 3.6, WELL: 2.8,
  /** Rack rows (z) in the south half. */
  ROWS: [6, 9.5, 13, 16.5] as const,
  /** The build farm's glass room (x0, x1, z0, z1), its door on the south face. */
  FARM: [11, 17.5, -11, -4] as const,
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
/** A point at radius r, angle θ, height y. */
const P = (r: number, t: number, y = 0) => V(r * Math.sin(t), y, r * Math.cos(t));
const deg = THREE.MathUtils.degToRad;

/** A box from a to b (its length along a→b), w wide and h tall. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(b, a, V(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return norm(g.applyMatrix4(m));
}

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class DomeBuilder implements BunkerShell {
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
  readonly pal = new GlowPalette(48);
  readonly halos = new GlowSprites(12);
  static readonly CH = { ON: 0, NIGHT: 1, RACK: 2, STAGE: 3, POD: 4, CLUSTER: 5, BLINK: 6, TOWER: 7 };
  /** The release board over the stage (both faces share the canvas). */
  board!: LiveScreen;
  steam!: Steam;
  lights!: { racks: VirtualLight[]; stage: VirtualLight; gil: VirtualLight; farm: VirtualLight; pod: VirtualLight; gate: VirtualLight; hut: VirtualLight };
  readonly slots: Record<'racks' | 'amber' | 'stage' | 'holo' | 'cluster' | 'pod' | 'monitors' | 'farm' | 'farmRed' | 'aviation' | 'gatePost' | 'podReader' | 'podReaderOk' | 'farmReader' | 'hutLamp' | 'yard', { value: number }> = {} as never;
  /** Where people stand and sit (Dome places them: they're models). */
  holoSpot!: { pos: THREE.Vector3; yaw: number };
  gilSeat!: { pos: THREE.Vector3; yaw: number };
  bodySeat!: { pos: THREE.Vector3; yaw: number };
  /** Patrol routes (world points, walked there and back), by Helper id. */
  readonly routes: Record<string, THREE.Vector3[]> = {};
  /** Every collider the Helpers mustn't walk through is static; their routes keep to open floor. */
  private far!: THREE.Object3D;

  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'dome';
    this.innerBox = new THREE.Box3(this.w(-DM.R, -0.5, -DM.R), this.w(DM.R, DM.WALL + DM.R, DM.R));
    this.groundsBox = new THREE.Box3(this.w(-DM.FENCE, -4, -DM.FENCE), this.w(DM.FENCE, 30, DM.FENCE));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** World XZ → local, with the ground's local height. */
  private local(x: number, z: number) {
    return V(x - this.origin.x, this.ground(x, z) - this.origin.y, z - this.origin.z);
  }

  /** Under the glass (inside the stem wall), or in the vestibule. */
  contains(p: THREE.Vector3, margin = 0) {
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    if (y < -2 || y > DM.WALL + DM.R) return false;
    if (x * x + z * z < (DM.R - 0.3 + margin) ** 2) return true;
    return Math.abs(x) < DM.VW + margin && z > DM.VZ - margin && z < -DM.R + 1;
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** A sliding door leaf along x at z. */
  private slideDoor(id: string, x0: number, x1: number, y0: number, z: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void) {
    const pivot = new THREE.Group();
    pivot.position.set(x0, y0, z);
    pivot.userData.x0 = x0;
    const lb = new MeshBatch();
    leaf(lb, x1 - x0);
    pivot.add(lb.build(`domeDoor:${id}`));
    this.group.add(pivot);
    const pos = this.w((x0 + x1) / 2, y0 + h / 2, z), half = V(Math.abs(x1 - x0) / 2, h / 2, 0.12);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount, colliderSpec: { pos, half } };
  }

  private build() {
    const b = new MeshBatch();
    const m = this.mats();
    this.board = new LiveScreen(1024, 512, () => {});
    this.board.paint = (c, w, h) => paintBoard(c, w, h, { version: '5.0.2', shipped: [], pending: null, status: 'live', day: 1284 });
    this.board.repaint();
    this.buildShell(b, m);
    this.buildVestibule(b, m);
    this.buildStage(b, m);
    this.buildChairs(b, m);
    this.buildRacks(b, m);
    this.buildGil(b, m);
    this.buildFarm(b, m);
    this.buildSpiral(b, m);
    this.buildPod(b, m);
    this.buildFence(b, m);
    this.buildHut(b, m);
    this.buildYard(b, m);
    this.buildRoutes();
    this.buildLights();
    surfaces.zone(this.w(-DM.FENCE - 10, -2, -DM.FENCE - 10), this.w(DM.FENCE, 4, DM.FENCE), 'concrete');
    surfaces.zone(this.w(-DM.WELL, DM.POD_Y - 0.5, -DM.POD_R), this.w(DM.POD_R, DM.POD_Y + 3, DM.POD_R), 'metal');

    // (the glass stays glass at range: flattened it would read as a white bowl)
    this.far = b.buildFar('dome-far', { minSize: 1.2, keep: [m.glass, m.panes] });
    const statics = b.build('domeStatic');
    this.group.add(statics);
    this.group.add(this.halos.build());
    // glass casts nothing (the dome would shade its own floor), nor do the printed signs; the rest
    // goes through one shadow proxy. The doors are glass or lattice and the cameras tiny: no shadows
    statics.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mesh.isMesh && mat && (mat.transparent || mat === m.print)) mesh.castShadow = false;
    });
    shadowProxy(statics);
    for (const d of Object.values(this.doors)) d.pivot.traverse((o) => { o.castShadow = false; });
    for (const c of this.cameras) c.pivot.traverse((o) => { o.castShadow = false; });

    const near = new THREE.Group();
    near.name = 'dome-near';
    const keep = new Set<THREE.Object3D>([this.halos.sprite, this.steam.mesh]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far);
    // a glass hemisphere 23 m tall on an open shelf: the stand-in carries it a long way
    this.lod = new DistanceLod(this.origin.clone(), 16, near, this.far, 190, 1400);
  }

  private mats() {
    return {
      wall: concrete('#b9b2a5', { scale: 0.6, stains: 0.45 }),
      pad: concrete('#9d968a', { scale: 0.9, stains: 0.55 }),
      floor: plainStandard('#3a3d42', 0.55, 0.1),
      epoxy: plainStandard('#5b6168', 0.35, 0.05),
      white: plainStandard('#e7e4dc', 0.55, 0.05),
      frame: plainStandard('#d9dcdf', 0.35, 0.8),
      dark: plainStandard('#202226', 0.5, 0.4),
      black: plainStandard('#101113', 0.45, 0.3),
      rack: plainStandard('#1b1d22', 0.45, 0.65),
      mesh: plainStandard('#3a3e45', 0.55, 0.6),
      cable: plainStandard('#2a3a52', 0.7, 0.05),
      steel: plainStandard('#b8bec4', 0.3, 0.9),
      brushed: plainStandard('#8e959b', 0.4, 0.85),
      gold: plainStandard('#c9a24a', 0.3, 0.9),
      yellow: plainStandard('#d9a82a', 0.6, 0.2),
      pipe: rustyMetal({ base: '#a7aaa8', rust: 0.25, metalness: 0.7 }),
      post: rustyMetal({ base: '#8f918c', rust: 0.35, metalness: 0.6 }),
      tank: rustyMetal({ base: '#c9c6bd', rust: 0.3, metalness: 0.55 }),
      hutWall: corrugated('#d8d3c6', 0.35),
      glass: domePaneMaterial(false),
      panes: domePaneMaterial(true),
      clear: plainStandard('#cfe0dc', 0.06, 0.2, { transparent: true, opacity: 0.14, depthWrite: false }),
      smoke: plainStandard('#2a2f33', 0.05, 0.3, { transparent: true, opacity: 0.55, depthWrite: false }),
      coolant: plainStandard('#4fb7d8', 0.05, 0.1, { transparent: true, opacity: 0.35, depthWrite: false }),
      dusty: plainStandard('#d8d1c1', 0.85, 0),
      water: plainStandard('#1d3d3f', 0.04, 0.5, { envMapIntensity: 1.2 }),
      liner: plainStandard('#1b1c1e', 0.7, 0.05),
      seat: fabric('#3d4148'),
      cot: fabric('#5a6b4a'),
      oak: wood('#8a6a46'),
      rug: fabric('#4a3a22'),
      amber: plainStandard('#8a4a14', 0.15, 0.1),
      deadLeaf: plainStandard('#6b5434', 0.9, 0),
      link: chainLink(),
      rock: desertRock(),
      print: domePrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the dome: stem wall, frame, glass, floor
  private buildShell(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { R, WALL } = DM;
    const gap = Math.asin((DM.VW + 0.1) / R);
    // the stem wall round the ring, open where the vestibule joins
    const stem = (r: number, out: boolean) => {
      const pts = out ? [new THREE.Vector2(r, 0), new THREE.Vector2(r, WALL)] : [new THREE.Vector2(r, WALL), new THREE.Vector2(r, 0)];
      b.add(m.wall, place(new THREE.LatheGeometry(pts, 72, Math.PI + gap, Math.PI * 2 - gap * 2)));
    };
    stem(R + 0.25, true);
    stem(R - 0.05, false);
    b.add(m.wall, place(new THREE.RingGeometry(R - 0.05, R + 0.25, 72, 1, Math.PI / 2 + gap, Math.PI * 2 - gap * 2), 0, WALL, 0, -Math.PI / 2));
    for (let i = 0; i < 48; i++) {
      const a = Math.PI + gap + (i + 0.5) * ((Math.PI * 2 - gap * 2) / 48), half = (R + 0.1) * Math.tan((Math.PI * 2 - gap * 2) / 96) + 0.05;
      const p = P(R + 0.1, a);
      this.col(p.x, WALL / 2, p.z, half, WALL / 2, 0.2, a);
    }
    // the floor: dark epoxy, a lighter walkway ring, and painted aisle lines
    b.add(m.floor, place(new THREE.CircleGeometry(R - 0.05, 72), 0, 0.02, 0, -Math.PI / 2));
    b.add(m.epoxy, place(new THREE.RingGeometry(R - 2.2, R - 1.4, 72), 0, 0.025, 0, -Math.PI / 2));
    for (const x of [-9.25, 9.25]) b.add(m.yellow, place(new THREE.PlaneGeometry(0.08, 18), x, 0.03, 10, -Math.PI / 2));
    // the geodesic frame and its panes: an icosphere, upper half, its lowest ring pulled onto the wall
    const ico = new THREE.IcosahedronGeometry(R, 5);
    ico.rotateX(Math.atan2(1, (1 + Math.sqrt(5)) / 2)); // a vertex at the top (the hub over the mast)
    const pos = ico.attributes.position as THREE.BufferAttribute;
    const key = (v: THREE.Vector3) => `${Math.round(v.x * 50)},${Math.round(v.y * 50)},${Math.round(v.z * 50)}`;
    const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    const hubs = new Map<string, THREE.Vector3>();
    const panes = { glass: [] as THREE.BufferGeometry[], dusty: [] as THREE.BufferGeometry[] };
    const r = rng(7);
    const lift = (v: THREE.Vector3) => V(v.x, Math.max(v.y, 0) + WALL, v.z);
    for (let i = 0; i < pos.count; i += 3) {
      const a = V(pos.getX(i), pos.getY(i), pos.getZ(i)), c = V(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)), d = V(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      const cy = (a.y + c.y + d.y) / 3;
      if (cy < -0.6) continue;
      const A = lift(a), C = lift(c), D = lift(d);
      const cen = A.clone().add(C).add(D).divideScalar(3);
      // the vestibule's mouth: no panes or struts across it
      const mouth = cen.z < -R + 6 && Math.abs(cen.x) < DM.VW + 1.4 && cen.y < DM.VH + 2.2;
      if (!mouth) {
        for (const [p, q] of [[A, C], [C, D], [D, A]] as [THREE.Vector3, THREE.Vector3][]) {
          if (p.y <= WALL + 0.01 && q.y <= WALL + 0.01) continue;
          const k = [key(p), key(q)].sort().join('|');
          if (!edges.has(k)) edges.set(k, [p, q]);
        }
        for (const p of [A, C, D]) hubs.set(key(p), p);
        // a pane slightly inside the frame; one in eight dusted over solid, one in forty gone
        const roll = r();
        if (roll > 0.975) continue;
        const inset = (p: THREE.Vector3) => p.clone().lerp(cen, 0.035).multiplyScalar(0.997);
        // wound to face out (the icosphere's winding doesn't survive the flattened bottom row)
        const nrm = C.clone().sub(A).cross(D.clone().sub(A));
        const tri = nrm.dot(cen) >= 0 ? [inset(A), inset(C), inset(D)] : [inset(A), inset(D), inset(C)];
        const g = new THREE.BufferGeometry().setFromPoints(tri);
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
        (roll < 0.12 || cen.y < WALL + 1.0 ? panes.dusty : panes.glass).push(norm(g));
      }
    }
    for (const [p, q] of edges.values()) b.add(m.frame, beam(p, q, 0.065, 5));
    for (const p of hubs.values()) if (p.y > WALL + 0.05) b.add(m.frame, place(new THREE.IcosahedronGeometry(0.13, 0), p.x, p.y, p.z));
    b.add(m.glass, ...panes.glass);
    b.add(m.panes, ...panes.dusty);
    uDomeFloor.value = this.origin.y;
    // the mouth's frame: an arch of steel round the vestibule's end
    b.add(m.frame, box(0.25, DM.VH + 1.6, 0.4, -DM.VW - 0.6, (DM.VH + 1.6) / 2, -R + 0.9), box(0.25, DM.VH + 1.6, 0.4, DM.VW + 0.6, (DM.VH + 1.6) / 2, -R + 0.9));
    b.add(m.frame, box(DM.VW * 2 + 1.45, 0.3, 0.4, 0, DM.VH + 1.6, -R + 0.9));
    // the hub at the apex and the mast under it (the pod hangs on both)
    b.add(m.frame, cyl(0.6, 0.6, 0.5, 0, WALL + R - 0.2, 0, 16));
    b.add(m.white, cyl(DM.MAST, DM.MAST, WALL + R - 0.4, 0, (WALL + R - 0.4) / 2, 0, 24));
    b.add(m.gold, cyl(DM.MAST + 0.02, DM.MAST + 0.02, 0.12, 0, DM.STAGE_H + 2.6, 0, 24));
    this.physics.addCylinder(this.w(0, (WALL + R) / 2, 0), (WALL + R) / 2, DM.MAST);
    // culture banners hung from the frame over the chairs, and the all-hands sign over the entrance
    const banners = ['bannerShip', 'bannerGrowth', 'bannerDay', 'bannerHuman'];
    [-11, -4, 4, 11].forEach((x, i) => {
      const z = -10 - Math.abs(x) * 0.15, top = WALL + Math.sqrt(R * R - x * x - z * z) - 1.2;
      b.add(m.print, domePrint(banners[i], 1.6, 4.8, M(x, top - 2.6, z, 0)));
      b.add(m.black, box(1.7, 0.06, 0.06, x, top - 0.18, z), beam(V(x, top - 0.18, z), V(x, top + 1.1, z), 0.01, 3));
    });
    b.add(m.print, domePrint('allHands', 4.2, 1.05, M(0, DM.VH + 2.3, -R + 0.7, 0)));
    // cable trays on posts over the rack rows (yellow, the colour of every data hall)
    for (const z of DM.ROWS) {
      const hw = Math.sqrt((R - 2.5) ** 2 - z * z);
      b.add(m.yellow, box(hw * 2, 0.05, 0.3, 0, 3.0, z), box(hw * 2, 0.1, 0.02, 0, 3.05, z - 0.15), box(hw * 2, 0.1, 0.02, 0, 3.05, z + 0.15));
      b.add(m.cable, box(hw * 2 - 0.4, 0.06, 0.2, 0, 3.06, z));
      for (let x = -hw + 1; x < hw; x += 4) b.add(m.brushed, box(0.04, 0.8, 0.04, x, 2.6, z));
    }
  }

  // ------------------------------------------------------------------ the airlock vestibule on the north
  private buildVestibule(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { VW, VZ, VH, R } = DM;
    const z1 = -R + 1.0, zc = (VZ + z1) / 2, len = z1 - VZ;
    // walls, roof, a canopy over the door
    for (const s of [-1, 1]) {
      b.add(m.white, box(0.3, VH, len, s * (VW + 0.15), VH / 2, zc));
      this.col(s * (VW + 0.15), VH / 2, zc, 0.15, VH / 2, len / 2);
    }
    b.add(m.white, box(VW * 2 + 0.6, 0.3, len + 0.6, 0, VH + 0.15, zc - 0.3));
    b.add(m.black, box(VW * 2 + 0.7, 0.08, 0.1, 0, VH - 0.05, VZ - 0.55));
    b.add(m.epoxy, box(VW * 2, 0.04, len, 0, 0.04, zc));
    // the airlock door: two tinted glass leaves sliding apart (one door, the leaves move together)
    b.add(m.frame, box(VW * 2 + 0.3, 0.25, 0.25, 0, VH - 0.6, VZ));
    b.add(m.frame, box(0.2, VH - 0.6, 0.25, -VW + 0.05, (VH - 0.6) / 2, VZ), box(0.2, VH - 0.6, 0.25, VW - 0.05, (VH - 0.6) / 2, VZ));
    b.add(m.smoke, box(VW * 2 - 0.3, 0.6, 0.04, 0, VH - 0.3, VZ));
    this.slideDoor('airlock', -VW + 0.15, VW - 0.15, 0, VZ, VH - 0.6, -(VW * 2 - 0.4), (lb, wd) => {
      lb.add(m.smoke, box(wd, VH - 0.62, 0.05, wd / 2, (VH - 0.6) / 2, 0));
      lb.add(m.brushed, box(wd, 0.08, 0.08, wd / 2, 0.04, 0), box(0.06, VH - 0.6, 0.07, 0.03, (VH - 0.6) / 2, 0), box(0.06, VH - 0.6, 0.07, wd - 0.03, (VH - 0.6) / 2, 0));
      lb.add(m.print, domePrint('airlock', 2.4, 0.6, M(wd / 2, 1.3, -0.035, Math.PI)));
    });
    // the keypad on the east jamb, a service panel below it
    const kx = VW + 0.32, kz = VZ - 0.3;
    b.add(m.brushed, box(0.04, 0.3, 0.22, kx, 1.4, kz));
    b.add(m.dark, box(0.03, 0.22, 0.16, kx + 0.025, 1.42, kz));
    b.add(m.dark, box(0.05, 0.4, 0.5, kx, 0.45, kz - 0.4));
    this.points.door = this.w(VW - 0.6, 1.2, VZ - 1.4);
    // pavers out to the yard path
    b.add(m.pad, place(new THREE.PlaneGeometry(VW * 2 + 2, 12), 0, 0.03, VZ - 6, -Math.PI / 2));
    this.points.interior = this.w(0, 1.0, -R + 3);
  }

  // ------------------------------------------------------------------ the all-hands: stage, projector, board
  private buildStage(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { STAGE, STAGE_H } = DM;
    b.add(m.black, cyl(STAGE, STAGE, STAGE_H, 0, STAGE_H / 2, 0, 48));
    b.add(m.epoxy, place(new THREE.CircleGeometry(STAGE - 0.05, 48), 0, STAGE_H + 0.005, 0, -Math.PI / 2));
    // three steps up at the front (north), and a collider for the stage
    for (let i = 0; i < 3; i++) b.add(m.black, box(2.4, STAGE_H * (i + 1) / 3, 0.35, 0, (STAGE_H * (i + 1) / 3) / 2, -STAGE - 0.95 + i * 0.35));
    this.physics.addCylinder(this.w(0, STAGE_H / 2, 0), STAGE_H / 2, STAGE);
    for (let i = 0; i < 3; i++) this.col(0, (STAGE_H * (i + 1) / 3) / 2, -STAGE - 0.95 + i * 0.35, 1.2, (STAGE_H * (i + 1) / 3) / 2, 0.175);
    // the projector ring where the hologram stands, and a lip of light round the stage
    const stage = this.pal.slot('#ffd9a0', 1.2), holo = this.pal.slot('#5fd8ff', 2.5);
    this.slots.stage = stage.intensity;
    this.slots.holo = holo.intensity;
    stage.add(b, place(new THREE.TorusGeometry(STAGE + 0.02, 0.025, 4, 96), 0, STAGE_H - 0.03, 0, Math.PI / 2));
    const hz = -3.4;
    b.add(m.dark, cyl(0.75, 0.8, 0.06, 0, STAGE_H + 0.03, hz, 24));
    holo.add(b, place(new THREE.TorusGeometry(0.68, 0.03, 4, 48), 0, STAGE_H + 0.07, hz, Math.PI / 2));
    for (let i = 0; i < 6; i++) holo.add(b, box(0.08, 0.02, 0.08, Math.sin(i) * 0.5, STAGE_H + 0.065, hz + Math.cos(i) * 0.5));
    this.halos.add(new THREE.Vector3(0, STAGE_H + 0.12, hz), '#5fd8ff', 2.2, DomeBuilder.CH.STAGE, 1.2);
    this.holoSpot = { pos: this.w(0, STAGE_H + 0.06, hz), yaw: Math.PI };
    this.points.stage = this.w(0, STAGE_H + 1.1, hz - 1.4);
    // the release board, hung from the mast over the stage on two faces (north and south)
    // (outside the spiral's reach, r 2.6: it hangs from the pod's underside on rods)
    const by = 8.4;
    for (const s of [-1, 1]) {
      const z = s * 3.4;
      b.add(m.black, box(4.4, 2.3, 0.12, 0, by, z));
      const face = new THREE.PlaneGeometry(4.2, 2.1);
      face.applyMatrix4(M(0, by, z + s * 0.065, s < 0 ? Math.PI : 0));
      const mesh = new THREE.Mesh(norm(face), this.board.material);
      mesh.castShadow = false;
      this.group.add(mesh);
      b.add(m.brushed, beam(V(-1.8, by + 1.15, z), V(-1.8, DM.POD_Y - 0.5, z), 0.02, 4), beam(V(1.8, by + 1.15, z), V(1.8, DM.POD_Y - 0.5, z), 0.02, 4));
    }
    // two speaker stacks either side of the stage
    for (const s of [-1, 1]) {
      b.add(m.black, box(0.7, 1.6, 0.6, s * 3.6, STAGE_H + 0.8, -2.8, s * 0.3));
      b.add(m.dark, cyl(0.2, 0.2, 0.02, s * 3.6 - s * 0.1, STAGE_H + 1.1, -3.1, 16, Math.PI / 2, s * 0.3));
    }
    this.points.speaker = this.w(0, 6, 0);
  }

  // ------------------------------------------------------------------ the chairs (rows in arcs, facing the stage)
  private buildChairs(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const r = rng(13);
    for (let row = 0; row < 6; row++) {
      const rad = 7.6 + row * 1.35;
      const span = deg(64) - row * deg(3);
      const n = Math.round((span * 2 * rad) / 0.62);
      for (let i = 0; i <= n; i++) {
        const t = Math.PI - span + (i / n) * span * 2;
        // the entrance aisle up the middle
        if (Math.abs(t - Math.PI) * rad < 0.9) continue;
        const p = P(rad, t), yaw = t + Math.PI;
        // a few chairs pushed back or turned, the way people leave them
        const jitter = r() < 0.1 ? (r() - 0.5) * 0.8 : 0, push = r() < 0.08 ? 0.3 : 0;
        const c = P(rad + push, t + jitter * 0.02);
        const ry = yaw + jitter;
        const f = (dx: number, dy: number, dz: number, w: number, h: number, d: number, mat: THREE.Material) => {
          const cs = Math.cos(ry), sn = Math.sin(ry);
          b.add(mat, box(w, h, d, c.x + dx * cs + dz * sn, dy, c.z - dx * sn + dz * cs, ry));
        };
        f(0, 0.45, 0, 0.46, 0.05, 0.44, m.seat);
        f(0, 0.72, -0.2, 0.46, 0.5, 0.04, m.seat);
        for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) f(lx, 0.22, lz, 0.03, 0.44, 0.03, m.brushed);
        void p;
      }
      // (a low collider per row, so you walk round the rows not through them)
      for (let k = 0; k < 8; k++) {
        const t0 = Math.PI - span + (k / 8) * span * 2, t1 = Math.PI - span + ((k + 1) / 8) * span * 2;
        const tm = (t0 + t1) / 2;
        if (Math.abs(tm - Math.PI) * rad < 1.1) continue;
        const pm = P(rad, tm), half = rad * Math.sin((t1 - t0) / 2);
        this.col(pm.x, 0.45, pm.z, half, 0.45, 0.25, tm);
      }
    }
  }

  // ------------------------------------------------------------------ the racks (south half)
  private buildRacks(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const blue = this.pal.slot('#3aa8ff', 1.6), amber = this.pal.slot('#ffb02a', 1.2);
    this.slots.racks = blue.intensity;
    this.slots.amber = amber.intensity;
    const r = rng(29);
    const R = DM.R;
    DM.ROWS.forEach((z, ri) => {
      const hw = Math.sqrt((R - 2.6) ** 2 - z * z);
      // runs of racks, broken at the central aisle and the two cross aisles
      const runs: [number, number][] = [];
      for (const [a, c] of [[-hw, -10], [-8.5, -1.2], [1.2, 8.5], [10, hw]] as [number, number][]) if (c - a > 0.8) runs.push([a, c]);
      const face = ri % 2 === 0 ? 1 : -1; // fronts face each other across the patrol aisles (7.75, 14.75)
      for (const [a, c] of runs) {
        const n = Math.floor((c - a) / 0.62);
        const x0 = (a + c) / 2 - (n * 0.62) / 2;
        for (let i = 0; i < n; i++) {
          const x = x0 + (i + 0.5) * 0.62;
          b.add(m.rack, box(0.6, 2.2, 1.05, x, 1.1, z));
          // the door: a perforated panel in a frame, server lights behind it, now and then an amber fault
          const fz = z + face * 0.53;
          b.add(m.mesh, box(0.5, 1.9, 0.01, x, 1.08, fz + face * 0.002));
          blue.add(b, box(0.015, 1.6 + r() * 0.3, 0.01, x - 0.2, 1.1, fz + face * 0.004), box(0.015, 1.2 + r() * 0.5, 0.01, x + 0.18, 1.0, fz + face * 0.004));
          for (let k = 0; k < 4; k++) blue.add(b, box(0.06, 0.012, 0.01, x - 0.05 + (r() - 0.5) * 0.2, 0.35 + k * 0.45 + r() * 0.2, fz + face * 0.004));
          if (r() < 0.22) amber.add(b, box(0.04, 0.04, 0.01, x + (r() - 0.5) * 0.3, 0.5 + r() * 1.4, fz + face * 0.004));
          // the back: cable bundles and a few status lights
          const bz = z - face * 0.53;
          b.add(m.cable, box(0.08, 1.8, 0.04, x - 0.12, 1.1, bz - face * 0.02), box(0.08, 1.6, 0.04, x + 0.14, 1.0, bz - face * 0.02));
          if (r() < 0.5) amber.add(b, box(0.025, 0.025, 0.01, x + (r() - 0.5) * 0.3, 0.6 + r(), bz - face * 0.004));
          if (i % 5 === 2) b.add(m.print, domePrint('rackLabel', 0.36, 0.09, M(x, 2.08, fz + face * 0.004, face < 0 ? Math.PI : 0)));
        }
        this.col((a + c) / 2, 1.1, z, (n * 0.62) / 2, 1.1, 0.53);
        for (let k = 0; k < n; k += 7) this.halos.add(new THREE.Vector3(x0 + (k + 0.5) * 0.62, 1.2, z + face * 0.62), '#3aa8ff', 1.4, DomeBuilder.CH.RACK, 0.35);
      }
    });
    // floor grilles and the chilled-water pipes down the cross aisles
    for (const x of [-9.25, 9.25]) {
      b.add(m.pipe, beam(V(x - 0.3, 3.4, 4), V(x - 0.3, 3.4, 19), 0.12, 8), beam(V(x + 0.3, 3.4, 4), V(x + 0.3, 3.4, 19), 0.12, 8));
    }
    // three cameras on the rack ends, looking down the aisles
    this.camera('c1', b, m, -11.2, 2.8, 7.75, deg(90), deg(50), 9, 13, 30);
    this.camera('c2', b, m, 11.2, 2.8, 14.75, deg(-90), deg(50), 11, 13, 30);
    this.camera('c3', b, m, 0.6, 2.8, 4.6, 0, deg(55), 10, 15, 32);
    // (hung from a strut between the cable trays either side of their aisle)
    b.add(m.yellow, bar(V(-11.2, 3.0, 6), V(-11.2, 3.0, 9.5), 0.08, 0.08), bar(V(11.2, 3.0, 13), V(11.2, 3.0, 16.5), 0.08, 0.08), bar(V(0.6, 3.0, 6), V(0.6, 3.0, 4.2), 0.08, 0.08));
  }

  /** A sweeping camera (the runtime yaws `pivot`; its body looks down +z). */
  private camera(id: string, b: MeshBatch, m: ReturnType<DomeBuilder['mats']>, x: number, y: number, z: number, yaw0: number, sweep: number, period: number, range: number, halfDeg: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const lens = this.pal.slot('#ff3020', 1);
    const cb = new MeshBatch();
    cb.add(m.white, box(0.2, 0.18, 0.42, 0, 0, 0.1));
    cb.add(m.black, box(0.12, 0.12, 0.04, 0, 0, 0.32));
    lens.add(cb, box(0.04, 0.04, 0.02, 0.05, 0.05, 0.34));
    pivot.add(cb.build(`domeCam:${id}`));
    this.group.add(pivot);
    b.add(m.black, cyl(0.03, 0.03, 0.2, x, y + 0.15, z, 6));
    this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3), yaw0, sweep, period, range, halfAngle: deg(halfDeg), lens: lens.intensity });
  }

  // ------------------------------------------------------------------ Gil's on-call desk (west wing)
  private buildGil(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const x = -15.2, z = -5.5;
    // an L of desks against two low partitions, three monitors, a cot behind
    b.add(m.oak, box(2.4, 0.05, 0.8, x - 0.6, 0.74, z), box(0.8, 0.05, 1.6, x - 1.4, 0.74, z + 1.2));
    for (const [lx, lz] of [[x + 0.5, z - 0.3], [x - 1.7, z - 0.3], [x - 1.7, z + 1.8], [x + 0.5, z + 0.3]]) b.add(m.brushed, box(0.05, 0.72, 0.05, lx, 0.36, lz));
    b.add(m.dark, box(0.06, 1.3, 3.2, x - 2.0, 0.65, z + 0.6), box(3.0, 1.3, 0.06, x - 0.5, 0.65, z - 0.5));
    this.col(x - 0.9, 0.5, z + 0.4, 1.3, 0.5, 1.0);
    const mon = this.pal.slot('#9fd8ff', 1.4);
    this.slots.monitors = mon.intensity;
    [[-1.5, 0.15, 0.25], [-0.75, 0, 0], [0.0, 0.15, -0.25]].forEach(([dx, dz, ry]) => {
      b.add(m.black, box(0.62, 0.38, 0.04, x + dx, 1.12, z - 0.32 + dz, ry), box(0.06, 0.25, 0.06, x + dx, 0.88, z - 0.28 + dz));
      mon.add(b, box(0.56, 0.32, 0.01, x + dx + Math.sin(ry) * 0.025, 1.12, z - 0.295 + dz + Math.cos(ry) * 0.025, ry));
    });
    this.halos.add(new THREE.Vector3(x - 0.75, 1.1, z - 0.2), '#9fd8ff', 1.6, DomeBuilder.CH.ON, 0.5);
    // his whiteboard, the pager, noodle cups, the cot and sleeping bag, a mini-fridge
    b.add(m.print, domePrint('gilBoard', 1.2, 0.9, M(x - 1.968, 1.55, z + 0.6, Math.PI / 2)));
    b.add(m.black, box(0.08, 0.03, 0.05, x + 0.3, 0.78, z + 0.1));
    const rr = rng(5);
    for (let i = 0; i < 14; i++) b.add(m.white, cyl(0.045, 0.035, 0.1, x - 1.4 + rr() * 0.5, 0.82 + Math.floor(i / 7) * 0.1, z + 1.0 + rr() * 0.9, 8));
    b.add(m.post, box(0.8, 0.35, 1.9, x - 3.0, 0.2, z + 3.0), box(0.75, 0.04, 1.85, x - 3.0, 0.4, z + 3.0));
    b.add(m.cot, box(0.72, 0.12, 1.4, x - 3.0, 0.48, z + 3.2), box(0.5, 0.12, 0.35, x - 3.0, 0.5, z + 2.3));
    b.add(m.white, box(0.5, 0.85, 0.5, x + 0.9, 0.43, z + 1.2));
    this.col(x - 3.0, 0.25, z + 3.0, 0.4, 0.25, 0.95);
    // his chair (he sits in it: the model's hips go on the seat)
    b.add(m.seat, box(0.5, 0.08, 0.5, x - 0.75, 0.5, z + 0.35), box(0.5, 0.6, 0.06, x - 0.75, 0.85, z + 0.62));
    b.add(m.black, cyl(0.04, 0.04, 0.45, x - 0.75, 0.25, z + 0.35, 6), cyl(0.3, 0.3, 0.04, x - 0.75, 0.04, z + 0.35, 5));
    this.gilSeat = { pos: this.w(x - 0.75, 0, z + 0.4), yaw: Math.PI };
    this.points.gil = this.w(x - 0.4, 1.2, z + 1.6);
  }

  // ------------------------------------------------------------------ the build farm (east wing, glass room)
  private buildFarm(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const [x0, x1, z0, z1] = DM.FARM, h = 3.0;
    const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    // glass walls on steel posts, a solid roof (the noise has to go somewhere)
    b.add(m.clear, box(0.04, h, z1 - z0, x0, h / 2, zc), box(0.04, h, z1 - z0, x1, h / 2, zc), box(x1 - x0, h, 0.04, xc, h / 2, z0));
    const dx0 = xc - 0.8, dx1 = xc + 0.8;
    b.add(m.clear, box(dx0 - x0, h, 0.04, (x0 + dx0) / 2, h / 2, z1), box(x1 - dx1, h, 0.04, (dx1 + x1) / 2, h / 2, z1), box(1.6, h - 2.3, 0.04, xc, 2.3 + (h - 2.3) / 2, z1));
    for (const x of [x0, x1, dx0, dx1]) for (const z of [z0, z1]) b.add(m.frame, box(0.08, h, 0.08, x, h / 2, z));
    b.add(m.white, box(x1 - x0 + 0.2, 0.15, z1 - z0 + 0.2, xc, h + 0.07, zc));
    this.col(x0, h / 2, zc, 0.06, h / 2, (z1 - z0) / 2);
    this.col(x1, h / 2, zc, 0.06, h / 2, (z1 - z0) / 2);
    this.col(xc, h / 2, z0, (x1 - x0) / 2, h / 2, 0.06);
    this.col((x0 + dx0) / 2, h / 2, z1, (dx0 - x0) / 2, h / 2, 0.06);
    this.col((dx1 + x1) / 2, h / 2, z1, (x1 - dx1) / 2, h / 2, 0.06);
    b.add(m.print, domePrint('farmSign', 1.4, 0.35, M(xc, 2.6, z1 + 0.03, 0)));
    // the door (south face), its badge reader
    this.slideDoor('farmDoor', dx0, dx1, 0, z1, 2.3, 1.62, (lb, wd) => {
      lb.add(m.clear, box(wd, 2.28, 0.04, wd / 2, 1.15, 0));
      lb.add(m.frame, box(wd, 0.06, 0.06, wd / 2, 2.27, 0), box(0.05, 2.3, 0.06, 0.025, 1.15, 0), box(0.05, 2.3, 0.06, wd - 0.025, 1.15, 0), box(0.04, 0.5, 0.05, wd - 0.15, 1.1, 0.04));
    });
    const rd = this.pal.slot('#ff3a2a', 2), ok = this.pal.slot('#5fe08a', 0);
    this.slots.farmReader = rd.intensity;
    b.add(m.black, box(0.1, 0.16, 0.03, dx0 - 0.2, 1.25, z1 + 0.05));
    rd.add(b, box(0.06, 0.02, 0.01, dx0 - 0.2, 1.3, z1 + 0.068));
    ok.add(b, box(0.06, 0.02, 0.01, dx0 - 0.2, 1.26, z1 + 0.068));
    this.points.farmDoor = this.w(xc, 1.2, z1 + 0.9);
    // inside: two racks of build machines, the pipeline board, the plug
    const farm = this.pal.slot('#5fe08a', 1.4), red = this.pal.slot('#ff4a3a', 1.4);
    this.slots.farm = farm.intensity;
    this.slots.farmRed = red.intensity;
    const rr = rng(17);
    for (const z of [z0 + 1.0, z0 + 3.0]) {
      b.add(m.rack, box(4.6, 2.1, 0.9, xc, 1.05, z));
      for (let i = 0; i < 40; i++) (rr() < 0.8 ? farm : red).add(b, box(0.03, 0.03, 0.01, xc - 2.2 + (i % 20) * 0.22, 0.6 + Math.floor(i / 20) * 0.9 + rr() * 0.2, z + 0.455));
      this.col(xc, 1.05, z, 2.3, 1.05, 0.45);
    }
    const pz = z1 - 1.4;
    b.add(m.dark, box(1.0, 1.1, 0.6, x1 - 0.8, 0.55, pz));
    b.add(m.yellow, box(0.25, 0.25, 0.06, x1 - 0.8, 0.9, pz - 0.33));
    b.add(m.black, beam(V(x1 - 0.8, 0.2, pz - 0.3), V(x1 - 0.2, 0.05, pz - 1.0), 0.04, 6));
    this.col(x1 - 0.8, 0.55, pz, 0.5, 0.55, 0.3);
    this.points.plug = this.w(x1 - 0.9, 1.0, pz - 0.9);
    this.halos.add(new THREE.Vector3(xc, 1.4, z0 + 1.6), '#5fe08a', 2.2, DomeBuilder.CH.ON, 0.35);
  }

  // ------------------------------------------------------------------ the spiral stair round the mast
  private buildSpiral(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { SP_IN, SP_OUT, POD_Y, STAGE_H, TURNS } = DM;
    const y0 = STAGE_H, rise = POD_Y - y0, total = TURNS * Math.PI * 2, tEnd = Math.PI;
    const STEPS = 64;
    const at = (t: number) => ({ th: tEnd - total * (1 - t), y: y0 + rise * t });
    for (let i = 0; i < STEPS; i++) {
      const a = at(i / STEPS), c = at((i + 1) / STEPS);
      const th = (a.th + c.th) / 2, y = c.y;
      // a wedge tread (an annular sector), its nosing and the stringer under it
      // (laid flat face-up, a ring's angle φ sits at θ = φ + 90°; face-down, at θ = 90° − φ)
      const g = new THREE.RingGeometry(SP_IN, SP_OUT, 3, 1, a.th - Math.PI / 2, c.th - a.th + 0.01);
      b.add(m.steel, place(g, 0, y, 0, -Math.PI / 2));
      b.add(m.dark, place(new THREE.RingGeometry(SP_IN, SP_OUT, 3, 1, Math.PI / 2 - c.th, c.th - a.th + 0.01), 0, y - 0.05, 0, Math.PI / 2));
      const pn = P((SP_IN + SP_OUT) / 2, a.th, y - 0.02);
      b.add(m.gold, box(SP_OUT - SP_IN, 0.03, 0.03, pn.x, y + 0.005, pn.z, a.th + Math.PI / 2));
      // balusters every other step, a rail on top
      if (i % 2 === 0) { const q = P(SP_OUT - 0.05, th, y); b.add(m.brushed, box(0.03, 1.0, 0.03, q.x, y + 0.5, q.z)); }
      void th;
    }
    // the handrail (a polyline over the balusters), the outer stringer
    const rail: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) { const s = at(i / 96); rail.push(P(SP_OUT - 0.05, s.th, s.y + 1.0)); }
    for (let i = 0; i < rail.length - 1; i++) b.add(m.brushed, beam(rail[i], rail[i + 1], 0.025, 5));
    for (let i = 0; i < 48; i++) {
      const a = at(i / 48), c = at((i + 1) / 48);
      b.add(m.dark, bar(P(SP_OUT, a.th, a.y - 0.15), P(SP_OUT, c.th, c.y - 0.15), 0.06, 0.25));
    }
    // colliders: a sloped slab per 15° through the treads (the helicoid is flat across), and the rail
    const SEG = Math.round(total / deg(15)), rm = (SP_IN + SP_OUT) / 2;
    for (let k = 0; k < SEG; k++) {
      const a = at(k / SEG), c = at((k + 1) / SEG);
      const th = (a.th + c.th) / 2, ym = (a.y + c.y) / 2;
      const tan = V(Math.cos(th) * rm * (c.th - a.th), c.y - a.y, -Math.sin(th) * rm * (c.th - a.th));
      const len = tan.length();
      const Z = tan.clone().normalize(), X = V(Math.sin(th), 0, Math.cos(th));
      let Y = Z.clone().cross(X);
      let Xb = X;
      if (Y.y < 0) { Y = Y.negate(); Xb = X.clone().negate(); }
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xb, Y, Z));
      const centre = P(rm, th, ym).addScaledVector(Y, -0.14);
      this.physics.addBoxRot(this.w(centre.x, centre.y, centre.z), { x: (SP_OUT - SP_IN) / 2 + 0.05, y: 0.14, z: len / 2 + 0.06 }, q);
      const rp = P(SP_OUT + 0.02, th, ym + 0.6);
      this.col(rp.x, rp.y, rp.z, 0.04, 0.6, (len / 2) * (SP_OUT / rm) + 0.05, th + Math.PI / 2);
    }
    this.points.stairFoot = this.w(-1.6, DM.STAGE_H + 0.9, -2.0);
  }

  // ------------------------------------------------------------------ the pod: the box at the stair's head, the drum, the Cluster
  private buildPod(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { POD_Y: y, POD_R, POD_H, WELL, R, WALL } = DM;
    const top = y + POD_H;
    // the floor: a disc with a square hole for the stair, a landing in the well's north-west corner
    const shape = new THREE.Shape();
    shape.absarc(0, 0, POD_R + 0.05, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.moveTo(-WELL, -WELL); hole.lineTo(WELL, -WELL); hole.lineTo(WELL, WELL); hole.lineTo(-WELL, WELL); hole.lineTo(-WELL, -WELL);
    shape.holes.push(hole);
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 48 });
    slab.rotateX(-Math.PI / 2);
    slab.translate(0, y - 0.3, 0);
    b.add(m.dark, norm(slab));
    const topG = new THREE.ShapeGeometry(shape, 48);
    topG.rotateX(-Math.PI / 2);
    topG.translate(0, y + 0.004, 0);
    b.add(m.steel, norm(topG));
    // floor colliders round the hole (four boxes) and the landing
    const ring = (POD_R + WELL) / 2;
    this.col(0, y - 0.15, -ring, POD_R, 0.15, (POD_R - WELL) / 2);
    this.col(0, y - 0.15, ring, POD_R, 0.15, (POD_R - WELL) / 2);
    this.col(-ring, y - 0.15, 0, (POD_R - WELL) / 2, 0.15, WELL);
    this.col(ring, y - 0.15, 0, (POD_R - WELL) / 2, 0.15, WELL);
    b.add(m.steel, box(WELL - 0.3, 0.08, WELL - 0.9, -WELL / 2 - 0.15 + 0.3, y - 0.04, -WELL + (WELL - 0.9) / 2));
    this.col(-WELL / 2 + 0.15, y - 0.06, -WELL + (WELL - 0.9) / 2, (WELL - 0.3) / 2, 0.06, (WELL - 0.9) / 2);
    // the glass box round the stair's head; its door on the north face, west of centre
    const hh = POD_H;
    const dx0 = -1.7, dx1 = -0.5;
    b.add(m.clear, box(0.04, hh, WELL * 2, -WELL, y + hh / 2, 0), box(0.04, hh, WELL * 2, WELL, y + hh / 2, 0), box(WELL * 2, hh, 0.04, 0, y + hh / 2, WELL));
    b.add(m.clear, box(dx0 + WELL, hh, 0.04, (-WELL + dx0) / 2, y + hh / 2, -WELL), box(WELL - dx1, hh, 0.04, (dx1 + WELL) / 2, y + hh / 2, -WELL), box(dx1 - dx0, hh - 2.3, 0.04, (dx0 + dx1) / 2, y + 2.3 + (hh - 2.3) / 2, -WELL));
    for (const x of [-WELL, WELL, dx0, dx1]) b.add(m.frame, box(0.07, hh, 0.07, x, y + hh / 2, -WELL));
    for (const x of [-WELL, WELL]) b.add(m.frame, box(0.07, hh, 0.07, x, y + hh / 2, WELL));
    this.col(-WELL, y + hh / 2, 0, 0.05, hh / 2, WELL);
    this.col(WELL, y + hh / 2, 0, 0.05, hh / 2, WELL);
    this.col(0, y + hh / 2, WELL, WELL, hh / 2, 0.05);
    this.col((-WELL + dx0) / 2, y + hh / 2, -WELL, (dx0 + WELL) / 2, hh / 2, 0.05);
    this.col((dx1 + WELL) / 2, y + hh / 2, -WELL, (WELL - dx1) / 2, hh / 2, 0.05);
    this.slideDoor('podDoor', dx0, dx1, y, -WELL, 2.3, -(dx1 - dx0 + 0.05), (lb, wd) => {
      lb.add(m.smoke, box(wd, 2.28, 0.04, wd / 2, 1.15, 0));
      lb.add(m.gold, box(wd, 0.05, 0.06, wd / 2, 2.28, 0), box(0.04, 2.3, 0.06, 0.02, 1.15, 0), box(0.04, 2.3, 0.06, wd - 0.02, 1.15, 0));
    });
    b.add(m.print, domePrint('podPlate', 0.5, 0.16, M(dx1 + 0.45, y + 1.6, -WELL + 0.03, 0)));
    const rd = this.pal.slot(GOLD, 2.2), ok = this.pal.slot('#5fe08a', 0);
    this.slots.podReader = rd.intensity;
    this.slots.podReaderOk = ok.intensity;
    b.add(m.black, box(0.1, 0.16, 0.03, dx1 + 0.2, y + 1.25, -WELL + 0.05));
    rd.add(b, box(0.06, 0.02, 0.01, dx1 + 0.2, y + 1.3, -WELL + 0.068));
    ok.add(b, box(0.06, 0.02, 0.01, dx1 + 0.2, y + 1.26, -WELL + 0.068));
    this.points.podDoor = this.w((dx0 + dx1) / 2, y + 1.2, -WELL + 0.8);
    // the drum: glass all round, a rim above and below, a dark ceiling with a ring of light
    const lath = (r: number, y0: number, y1: number, mat: THREE.Material, out = true, seg = 64) => b.add(mat, place(new THREE.LatheGeometry(out ? [new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)] : [new THREE.Vector2(r, y1), new THREE.Vector2(r, y0)], seg)));
    lath(POD_R, y, top, m.clear, true, 64);
    lath(POD_R + 0.12, y - 0.5, y + 0.05, m.frame);
    lath(POD_R + 0.12, top - 0.05, top + 0.35, m.frame);
    b.add(m.frame, place(new THREE.RingGeometry(DM.MAST, POD_R + 0.12, 64), 0, top + 0.35, 0, -Math.PI / 2), place(new THREE.RingGeometry(DM.MAST, POD_R + 0.12, 64), 0, y - 0.5, 0, Math.PI / 2));
    b.add(m.black, place(new THREE.RingGeometry(DM.MAST, POD_R, 64), 0, top - 0.01, 0, Math.PI / 2));
    for (let i = 0; i < 16; i++) { const p = P(POD_R + 0.04, (i / 16) * Math.PI * 2); b.add(m.frame, box(0.07, POD_H, 0.07, p.x, y + POD_H / 2, p.z)); }
    for (let i = 0; i < 24; i++) {
      const a = (i + 0.5) / 24 * Math.PI * 2, half = POD_R * Math.tan(Math.PI / 24) + 0.04, p = P(POD_R, a);
      this.col(p.x, y + POD_H / 2, p.z, half, POD_H / 2, 0.06, a);
    }
    const pod = this.pal.slot('#ffd9a0', 2.0);
    this.slots.pod = pod.intensity;
    pod.add(b, place(new THREE.TorusGeometry(POD_R - 0.4, 0.03, 4, 64), 0, top - 0.06, 0, Math.PI / 2));
    // cables from the pod's rim up to the frame
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2, p = P(POD_R + 0.1, a, top + 0.35), q = P(9, a);
      q.y = WALL + Math.sqrt(R * R - 81);
      b.add(m.brushed, beam(p, q, 0.02, 4));
    }
    // the Cluster: a tank of clear coolant on the south side, boards in it, lit blue
    const cz = POD_R - 1.0, cl = this.pal.slot('#58d6ff', 2.2);
    this.slots.cluster = cl.intensity;
    b.add(m.black, box(2.2, 0.3, 1.1, 0, y + 0.15, cz), box(2.2, 0.2, 1.1, 0, y + 2.75, cz));
    b.add(m.coolant, box(2.1, 2.3, 1.0, 0, y + 1.45, cz));
    for (let i = 0; i < 9; i++) {
      b.add(m.rack, box(0.03, 1.9, 0.7, -0.9 + i * 0.225, y + 1.4, cz));
      cl.add(b, box(0.035, 0.03, 0.6, -0.9 + i * 0.225, y + 2.2 - (i % 3) * 0.5, cz));
    }
    for (const s of [-1, 1]) b.add(m.frame, box(0.06, 2.9, 0.06, s * 1.08, y + 1.45, cz - 0.53), box(0.06, 2.9, 0.06, s * 1.08, y + 1.45, cz + 0.53));
    this.col(0, y + 1.4, cz, 1.1, 1.4, 0.55);
    this.halos.add(new THREE.Vector3(0, y + 1.5, cz - 0.6), '#58d6ff', 2.6, DomeBuilder.CH.CLUSTER, 0.8);
    // the breaker and the terminal on a post beside it
    b.add(m.dark, box(0.5, 1.2, 0.3, 1.6, y + 0.6, cz - 0.3, 0.3));
    b.add(m.print, domePrint('clusterTag', 0.3, 0.22, M(1.6 - 0.05, y + 1.0, cz - 0.46, Math.PI + 0.3)));
    b.add(m.yellow, box(0.08, 0.2, 0.06, 1.55, y + 0.75, cz - 0.47, 0.3));
    this.col(1.6, y + 0.6, cz - 0.3, 0.25, 0.6, 0.15, 0.3);
    this.points.cluster = this.w(0.6, y + 1.2, cz - 1.4);
    // Hunter's desk at the east glass, and his chair: a reclining throne with a headrest of electrodes
    const dp = P(POD_R - 1.2, deg(95)), dy = deg(95) + Math.PI;
    b.add(m.black, box(1.8, 0.06, 0.8, dp.x, y + 0.75, dp.z, dy), box(0.1, 0.72, 0.7, dp.x + Math.cos(dy) * 0.8, y + 0.36, dp.z - Math.sin(dy) * 0.8, dy), box(0.1, 0.72, 0.7, dp.x - Math.cos(dy) * 0.8, y + 0.36, dp.z + Math.sin(dy) * 0.8, dy));
    b.add(m.gold, box(0.4, 0.02, 0.28, dp.x, y + 0.79, dp.z, dy + 0.2));
    this.col(dp.x, y + 0.4, dp.z, 0.9, 0.4, 0.4, dy);
    const cp = P(POD_R - 2.6, deg(60)), cy = deg(60) + Math.PI;
    b.add(m.seat, box(0.7, 0.18, 1.2, cp.x, y + 0.5, cp.z, cy, -0.25), box(0.7, 0.8, 0.15, cp.x - Math.sin(cy) * 0.6, y + 1.0, cp.z - Math.cos(cy) * 0.6, cy, 0.35));
    b.add(m.steel, cyl(0.28, 0.32, 0.4, cp.x, y + 0.2, cp.z, 12));
    for (let i = 0; i < 9; i++) b.add(m.gold, cyl(0.015, 0.015, 0.12, cp.x - Math.sin(cy) * 0.66 + Math.cos(i) * 0.18, y + 1.45 + Math.sin(i * 1.3) * 0.08, cp.z - Math.cos(cy) * 0.66 + Math.sin(i) * 0.18, 4));
    this.col(cp.x, y + 0.4, cp.z, 0.4, 0.4, 0.6, cy);
    // his office: a rug under the desk and the chair, two monitors, the keynote poster on the well's
    // glass, a drinks trolley with two glasses poured, and a fig that died in its gold pot
    b.add(m.rug, place(new THREE.CircleGeometry(1.9, 32), P(POD_R - 2.0, deg(78)).x, y + 0.012, P(POD_R - 2.0, deg(78)).z, -Math.PI / 2));
    const mon = this.pal.slot('#cfe6ff', 1.2);
    for (const s of [-1, 1]) {
      const mp = dp.clone().add(V(Math.cos(dy) * s * 0.42 - Math.sin(dy) * 0.22, 0, -Math.sin(dy) * s * 0.42 - Math.cos(dy) * 0.22));
      b.add(m.black, box(0.7, 0.42, 0.03, mp.x, y + 1.08, mp.z, dy + s * 0.2), box(0.05, 0.28, 0.05, mp.x, y + 0.92, mp.z));
      mon.add(b, box(0.64, 0.36, 0.01, mp.x + Math.sin(dy) * 0.02, y + 1.08, mp.z + Math.cos(dy) * 0.02, dy + s * 0.2));
    }
    b.add(m.print, domePrint('keynote', 0.75, 1.0, M(WELL + 0.035, y + 1.55, 1.2, Math.PI / 2)));
    b.add(m.black, box(0.012, 1.06, 0.82, WELL + 0.022, y + 1.55, 1.2));
    b.add(m.gold, box(0.8, 0.03, 1.04, WELL + 0.02, y + 1.03, 1.2), box(0.8, 0.03, 1.04, WELL + 0.02, y + 2.07, 1.2));
    const tr = P(POD_R - 0.7, deg(130));
    b.add(m.gold, box(0.6, 0.03, 0.4, tr.x, y + 0.75, tr.z, deg(130)), box(0.6, 0.03, 0.4, tr.x, y + 0.3, tr.z, deg(130)));
    for (const [dx, dz] of [[-0.27, -0.17], [0.27, -0.17], [-0.27, 0.17], [0.27, 0.17]]) b.add(m.gold, cyl(0.012, 0.012, 0.75, tr.x + dx * Math.cos(deg(130)) + dz * Math.sin(deg(130)), y + 0.375, tr.z - dx * Math.sin(deg(130)) + dz * Math.cos(deg(130)), 5));
    b.add(m.clear, cyl(0.06, 0.08, 0.24, tr.x, y + 0.89, tr.z, 10), cyl(0.035, 0.03, 0.09, tr.x + 0.15, y + 0.81, tr.z + 0.05, 8), cyl(0.035, 0.03, 0.09, tr.x - 0.12, y + 0.81, tr.z - 0.06, 8));
    b.add(m.amber, cyl(0.055, 0.075, 0.12, tr.x, y + 0.83, tr.z, 10));
    this.col(tr.x, y + 0.4, tr.z, 0.3, 0.4, 0.2, deg(130));
    const fp = P(POD_R - 0.6, deg(160));
    b.add(m.gold, cyl(0.28, 0.22, 0.5, fp.x, y + 0.25, fp.z, 14));
    b.add(m.post, cyl(0.03, 0.04, 1.3, fp.x, y + 1.1, fp.z, 6));
    const fr = rng(43);
    for (let i = 0; i < 9; i++) b.add(m.deadLeaf, place(new THREE.IcosahedronGeometry(0.2, 0), fp.x + (fr() - 0.5) * 0.6, y + 1.3 + fr() * 0.6, fp.z + (fr() - 0.5) * 0.6, fr() * 3, fr() * 3, 0, 1, 0.35, 1));
    for (let i = 0; i < 6; i++) b.add(m.deadLeaf, place(new THREE.IcosahedronGeometry(0.12, 0), fp.x + (fr() - 0.5) * 0.9, y + 0.03, fp.z + (fr() - 0.5) * 0.9, 0, fr() * 3, 0, 1, 0.15, 1));
    this.col(fp.x, y + 0.25, fp.z, 0.28, 0.25, 0.28);
    // loot: the chilled-water tap, his locker, the spares cage (the west half of the ring)
    const tp = P(POD_R - 0.5, deg(250)), tt = deg(250) + Math.PI;
    b.add(m.white, box(0.45, 1.3, 0.4, tp.x, y + 0.65, tp.z, tt));
    b.add(m.steel, box(0.08, 0.06, 0.12, tp.x + Math.sin(tt) * 0.24, y + 1.0, tp.z + Math.cos(tt) * 0.24, tt));
    this.col(tp.x, y + 0.65, tp.z, 0.24, 0.65, 0.22, tt);
    this.lootSpots.push({ id: 'tap', pos: this.w(tp.x + Math.sin(tt) * 0.9, y + 1.0, tp.z + Math.cos(tt) * 0.9), mesh: new THREE.Group() });
    const lp = P(POD_R - 0.45, deg(295)), lt = deg(295) + Math.PI;
    b.add(m.black, box(0.6, 1.9, 0.5, lp.x, y + 0.95, lp.z, lt));
    b.add(m.gold, box(0.03, 0.3, 0.03, lp.x + Math.sin(lt) * 0.26 + Math.cos(lt) * 0.2, y + 1.1, lp.z + Math.cos(lt) * 0.26 - Math.sin(lt) * 0.2, lt));
    this.col(lp.x, y + 0.95, lp.z, 0.3, 0.95, 0.26, lt);
    this.lootSpots.push({ id: 'locker', pos: this.w(lp.x + Math.sin(lt) * 0.9, y + 1.0, lp.z + Math.cos(lt) * 0.9), mesh: new THREE.Group() });
    const gp = P(POD_R - 0.7, deg(215)), gt = deg(215) + Math.PI;
    b.add(m.post, box(1.2, 1.4, 0.7, gp.x, y + 0.7, gp.z, gt));
    for (let i = 0; i < 5; i++) b.add(m.black, box(0.25, 0.06, 0.35, gp.x + Math.cos(gt) * (i - 2) * 0.22, y + 0.5 + (i % 2) * 0.4, gp.z - Math.sin(gt) * (i - 2) * 0.22, gt));
    this.col(gp.x, y + 0.7, gp.z, 0.6, 0.7, 0.36, gt);
    this.lootSpots.push({ id: 'cage', pos: this.w(gp.x + Math.sin(gt) * 1.0, y + 1.0, gp.z + Math.cos(gt) * 1.0), mesh: new THREE.Group() });
    this.points.pod = this.w(0, y + 1.2, -4.2);
  }

  // ------------------------------------------------------------------ the fence, the gate, Outfall 3
  private buildFence(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const { FENCE: F, GATE_W } = DM;
    const H = 3.0;
    const gateA = Math.asin(GATE_W / F);
    // the culvert at θ = 90° (east): a 1.6 m gap whose fence starts 1.45 m up, closed by a grate
    const culA = 1.0 / F;
    const panels: THREE.BufferGeometry[] = [];
    const N = 84;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      // gate opening (north)
      if (Math.abs(am - Math.PI) < gateA) continue;
      const p0 = P(F, a0), p1 = P(F, a1);
      const g0 = this.local(this.origin.x + p0.x, this.origin.z + p0.z).y, g1 = this.local(this.origin.x + p1.x, this.origin.z + p1.z).y;
      const culvert = Math.abs(am - Math.PI / 2) < culA * 1.2;
      const lo = culvert ? 1.45 : 0.05;
      const len = p0.distanceTo(p1);
      const g = new THREE.PlaneGeometry(len, H - lo);
      const uvs = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * len, uvs.getY(k) * (H - lo));
      g.rotateY(-Math.atan2(p1.z - p0.z, p1.x - p0.x));
      g.translate((p0.x + p1.x) / 2, (g0 + g1) / 2 + lo + (H - lo) / 2, (p0.z + p1.z) / 2);
      panels.push(norm(g));
      b.add(m.post, cyl(0.05, 0.05, H + 0.35, p0.x, g0 + (H + 0.35) / 2, p0.z, 6));
      b.add(m.post, beam(V(p0.x, g0 + H, p0.z), V(p1.x, g1 + H, p1.z), 0.03, 4));
      // (one collider per panel, from the panel's foot; the culvert's starts above the gap)
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const gy = (g0 + g1) / 2;
      this.col(mid.x, gy + lo + (H + 0.6 - lo) / 2, mid.z, len / 2 + 0.03, (H + 0.6 - lo) / 2, 0.08, am + Math.PI / 2);
      // barbed wire on outward arms
      const out0 = P(F + 0.35, a0), out1 = P(F + 0.35, a1);
      b.add(m.post, beam(V(p0.x, g0 + H, p0.z), V(out0.x, g0 + H + 0.4, out0.z), 0.02, 3));
      b.add(m.dark, beam(V(out0.x, g0 + H + 0.38, out0.z), V(out1.x, g1 + H + 0.38, out1.z), 0.01, 3));
    }
    b.add(m.link, ...panels);
    // the gate: a slide leaf of chain-link on a frame, rolling west behind the fence
    const gz = -F, gx0 = -GATE_W, gx1 = GATE_W;
    for (const s of [-1, 1]) b.add(m.post, cyl(0.1, 0.1, H + 0.6, s * GATE_W, (H + 0.6) / 2, gz, 8));
    this.slideDoor('gate', gx0, gx1, 0, gz + 0.12, H, -(GATE_W * 2 + 0.2), (lb, wd) => {
      lb.add(m.post, box(wd, 0.08, 0.08, wd / 2, 0.15, 0), box(wd, 0.08, 0.08, wd / 2, H - 0.1, 0), box(0.08, H, 0.08, 0.04, H / 2, 0), box(0.08, H, 0.08, wd - 0.04, H / 2, 0), bar(V(0.1, 0.2, 0), V(wd - 0.1, H - 0.15, 0), 0.05, 0.05));
      const g = new THREE.PlaneGeometry(wd, H - 0.2);
      const uvs = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * wd, uvs.getY(k) * (H - 0.2));
      g.translate(wd / 2, H / 2, 0);
      lb.add(m.link, norm(g));
      lb.add(m.print, domePrint('gateSign', 2.0, 1.0, M(wd / 2, 1.8, -0.06, Math.PI)));
    });
    // the voice post on the west side of the gate, outside: grille, card slot, a lamp
    const vx = -GATE_W - 1.0, vz = gz - 1.6;
    b.add(m.dark, box(0.3, 1.4, 0.25, vx, 0.7, vz));
    b.add(m.black, box(0.22, 0.3, 0.02, vx, 1.15, vz - 0.13));
    b.add(m.gold, box(0.12, 0.015, 0.02, vx, 0.9, vz - 0.13));
    const post = this.pal.slot('#7fd6ff', 1.6);
    this.slots.gatePost = post.intensity;
    post.add(b, box(0.18, 0.025, 0.01, vx, 1.36, vz - 0.13));
    this.col(vx, 0.7, vz, 0.15, 0.7, 0.13);
    this.points.gate = this.w(vx + 0.4, 1.2, vz - 0.9);
    this.points.gateIn = this.w(0, 1.0, gz + 3);
    // a floodlight mast by the gate
    b.add(m.post, cyl(0.08, 0.1, 6.5, GATE_W + 1.5, 3.25, gz - 0.6, 8));
    b.add(m.dark, box(0.6, 0.35, 0.3, GATE_W + 1.2, 6.4, gz - 0.4, 0.4, 0.5));
    // Outfall 3 (east): a concrete headwall, the dry channel, and its grate (hinged)
    const cx = F, ch = 1.4;
    b.add(m.wall, box(0.6, 0.3, 2.6, cx, ch + 0.15, 0), box(0.6, ch, 0.35, cx, ch / 2, -1.12), box(0.6, ch, 0.35, cx, ch / 2, 1.12));
    this.col(cx, ch / 2, -1.12, 0.3, ch / 2, 0.18);
    this.col(cx, ch / 2, 1.12, 0.3, ch / 2, 0.18);
    b.add(m.wall, place(new THREE.PlaneGeometry(1.8, 14), cx - 6.5, 0.03, 0, -Math.PI / 2, 0, Math.PI / 2));
    b.add(m.pipe, beam(V(cx - 2, 0.4, 0), V(cx - 18, 0.4, 0), 0.35, 12));
    b.add(m.print, domePrint('culvertSign', 0.8, 0.4, M(cx + 0.31, 1.75, 0, Math.PI / 2)));
    const pivot = new THREE.Group();
    pivot.position.set(cx + 0.32, 0, -0.95);
    const gb = new MeshBatch();
    for (let i = 0; i <= 8; i++) gb.add(m.post, box(0.04, ch - 0.05, 0.04, 0, (ch - 0.05) / 2, i * 0.2375));
    for (const yy of [0.15, 0.7, ch - 0.15]) gb.add(m.post, box(0.05, 0.05, 1.9, 0, yy, 0.95));
    gb.add(m.black, box(0.08, 0.16, 0.1, 0.05, 0.75, 1.8));
    pivot.add(gb.build('domeGrate'));
    this.group.add(pivot);
    const cpos = this.w(cx + 0.32, ch / 2, 0), chalf = V(0.06, ch / 2, 0.95);
    this.doors.grate = { pivot, open: 0, target: 0, collider: this.physics.addBox(cpos, chalf), axis: 'y', amount: -1.7, colliderSpec: { pos: cpos, half: chalf } };
    this.points.culvert = this.w(cx + 1.3, 0.9, 0.3);
    this.points.culvertIn = this.w(cx - 3, 0.9, 0);
  }

  // ------------------------------------------------------------------ the visitor hut outside the gate (Hunter)
  private buildHut(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    const hx = -9.5, hz = -45.5, W = 3.2, D = 2.8, H = 2.6;
    const g = this.local(this.origin.x + hx, this.origin.z + hz).y;
    // corrugated walls with a door opening on the east (facing the gate), a window on the north
    b.add(m.hutWall, box(0.08, H, D, hx - W / 2, g + H / 2, hz), box(W, H, 0.08, hx, g + H / 2, hz + D / 2));
    b.add(m.hutWall, box(W, 0.8, 0.08, hx, g + 0.4, hz - D / 2), box(W, 0.5, 0.08, hx, g + H - 0.25, hz - D / 2));
    b.add(m.hutWall, box(0.08, H, 0.7, hx + W / 2, g + H / 2, hz - D / 2 + 0.35), box(0.08, H, 0.95, hx + W / 2, g + H / 2, hz + D / 2 - 0.475), box(0.08, 0.45, 1.2, hx + W / 2, g + H - 0.22, hz - 0.15));
    b.add(m.dusty, box(W + 0.3, 0.1, D + 0.3, hx, g + H + 0.05, hz));
    b.add(m.clear, box(W - 0.2, 1.3, 0.03, hx, g + 1.45, hz - D / 2));
    this.col(hx - W / 2, g + H / 2, hz, 0.06, H / 2, D / 2);
    this.col(hx, g + H / 2, hz + D / 2, W / 2, H / 2, 0.06);
    this.col(hx, g + H / 2, hz - D / 2, W / 2, H / 2, 0.06);
    this.col(hx + W / 2, g + H / 2, hz - D / 2 + 0.35, 0.06, H / 2, 0.35);
    this.col(hx + W / 2, g + H / 2, hz + D / 2 - 0.475, 0.06, H / 2, 0.475);
    b.add(m.epoxy, box(W - 0.1, 0.04, D - 0.1, hx, g + 0.03, hz));
    b.add(m.print, domePrint('hutSign', 1.5, 0.47, M(hx + W / 2 + 0.05, g + H - 0.55, hz - 0.15, Math.PI / 2)));
    // the desk along the north window, the intercom over it, a chair
    b.add(m.white, box(2.2, 0.05, 0.6, hx - 0.2, g + 0.74, hz - D / 2 + 0.38), box(0.05, 0.72, 0.55, hx - 1.25, g + 0.36, hz - D / 2 + 0.38), box(0.05, 0.72, 0.55, hx + 0.85, g + 0.36, hz - D / 2 + 0.38));
    this.col(hx - 0.2, g + 0.4, hz - D / 2 + 0.38, 1.1, 0.4, 0.3);
    b.add(m.dark, box(0.3, 0.2, 0.06, hx - 0.2, g + 1.0, hz - D / 2 + 0.1));
    b.add(m.print, domePrint('intercom', 0.28, 0.14, M(hx - 0.2, g + 0.82, hz - D / 2 + 0.135, 0)));
    b.add(m.print, domePrint('tally', 0.7, 0.7, M(hx - W / 2 + 0.05, g + 1.4, hz - 0.2, Math.PI / 2)));
    b.add(m.seat, box(0.45, 0.06, 0.45, hx - 0.2, g + 0.47, hz - D / 2 + 0.95), box(0.45, 0.5, 0.05, hx - 0.2, g + 0.75, hz - D / 2 + 1.18));
    b.add(m.black, cyl(0.03, 0.03, 0.45, hx - 0.2, g + 0.23, hz - D / 2 + 0.95, 6));
    // the bottles along the wall, the harness on the floor
    for (let i = 0; i < 11; i++) b.add(m.clear, cyl(0.035, 0.035, 0.24, hx - W / 2 + 0.2, g + 0.12, hz + D / 2 - 0.25 - i * 0.12, 6));
    b.add(m.black, box(0.5, 0.04, 0.35, hx + 0.6, g + 0.06, hz + 0.6, 0.6), box(0.06, 0.03, 0.7, hx + 0.8, g + 0.05, hz + 0.3, 0.2));
    const lamp = this.pal.slot('#ffd9a0', 0);
    this.slots.hutLamp = lamp.intensity;
    lamp.add(b, box(0.4, 0.04, 0.12, hx, g + H - 0.08, hz));
    this.bodySeat = { pos: this.w(hx - 0.2, g, hz - D / 2 + 0.95), yaw: Math.PI };
    this.points.hut = this.w(hx + 0.4, g + 1.2, hz - 0.1);
    this.points.outside = this.w(-1.5, 0, -DM.FENCE - 6);
    this.points.road = this.w(2, 0, -DM.FENCE - 18);
    // the road sign at the end of the drive
    const sx = 7.5, sz = -DM.FENCE - 12, sg = this.local(this.origin.x + sx, this.origin.z + sz).y;
    b.add(m.post, box(0.1, 2.4, 0.1, sx - 0.9, sg + 1.2, sz), box(0.1, 2.4, 0.1, sx + 0.9, sg + 1.2, sz));
    b.add(m.print, domePrint('roadSign', 2.2, 1.375, M(sx, sg + 1.75, sz - 0.07, Math.PI)));
  }

  // ------------------------------------------------------------------ the yard: towers, ponds, turbines, pipes
  private buildYard(b: MeshBatch, m: ReturnType<DomeBuilder['mats']>) {
    // the pad's paving round the dome and out to the gate
    b.add(m.pad, place(new THREE.RingGeometry(DM.R + 0.25, DM.R + 4, 72, 1), 0, 0.03, 0, -Math.PI / 2));
    b.add(m.pad, place(new THREE.PlaneGeometry(7, DM.FENCE - DM.R - 4), 0, 0.03, -(DM.R + 4 + DM.FENCE) / 2, -Math.PI / 2));
    // two hyperboloid cooling towers (south-east), open at the top, on legs, steaming
    const towers: [number, number, number, string][] = [[27, 18, 5.0, 'towerA'], [12, 32.5, 4.4, 'towerB']];
    const mouths: { pos: THREE.Vector3; r: number }[] = [];
    for (const [x, z, r0, label] of towers) {
      const hgt = 16, prof: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, y = 1.6 + t * (hgt - 1.6);
        const k = (t - 0.68) / 0.68;
        prof.push(new THREE.Vector2(r0 * (0.68 + 0.32 * k * k), y));
      }
      b.add(m.wall, place(new THREE.LatheGeometry(prof, 40), x, 0, z));
      b.add(m.wall, place(new THREE.LatheGeometry([...prof].reverse().map((p) => new THREE.Vector2(p.x - 0.25, p.y)), 40), x, 0, z));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const p = P(r0 - 0.15, a), q = P(r0 - 0.15, a + Math.PI / 8);
        b.add(m.wall, bar(V(x + p.x, 0, z + p.z), V(x + q.x, 1.7, z + q.z), 0.25, 0.25));
      }
      b.add(m.liner, place(new THREE.CircleGeometry(r0 - 0.3, 32), x, 0.15, z, -Math.PI / 2));
      this.physics.addCylinder(this.w(x, 8, z), 8, r0 - 0.2);
      const lp = P(r0 * 0.73 + 0.05, -0.6, 8.5);
      b.add(m.print, domePrint(label, 2.4, 1.2, M(x + lp.x, lp.y, z + lp.z, -0.6)));
      mouths.push({ pos: V(x, hgt, z), r: r0 * 0.78 });
      this.halos.add(new THREE.Vector3(x, hgt + 0.3, z), '#ff2a14', 1.6, DomeBuilder.CH.BLINK, 1.5);
    }
    this.steam = new Steam(mouths);
    this.group.add(this.steam.mesh);
    const avi = this.pal.slot('#ff2a14', 3);
    this.slots.aviation = avi.intensity;
    for (const [x, z, r0] of towers) avi.add(b, place(new THREE.SphereGeometry(0.14, 8, 6), x + r0 * 0.78, 16.2, z));
    // pipe racks from the towers to the dome's east side
    for (const [x, z] of towers) {
      const a = V(x - 3.5, 2.4, z - 2.5), c = P(DM.R + 0.6, Math.atan2(x, z), 2.4);
      b.add(m.pipe, beam(a, c, 0.3, 10), beam(a.clone().setY(1.6), c.clone().setY(1.6), 0.3, 10));
      for (let t = 0.15; t < 1; t += 0.25) {
        const p = a.clone().lerp(c, t);
        b.add(m.post, box(0.15, 2.6, 0.15, p.x, 1.3, p.z), box(0.9, 0.12, 0.15, p.x, 2.1, p.z, Math.atan2(c.x - a.x, c.z - a.z) + Math.PI / 2));
      }
    }
    // two evaporation ponds on the west side: a berm, a black liner, still water
    for (const [z0, z1] of [[-13, -2], [1, 12]] as [number, number][]) {
      const x0 = -35, x1 = -25.5, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, wd = x1 - x0, dp = z1 - z0;
      b.add(m.wall, box(wd + 1, 0.55, 0.5, xc, 0.27, z0 - 0.25), box(wd + 1, 0.55, 0.5, xc, 0.27, z1 + 0.25), box(0.5, 0.55, dp, x0 - 0.25, 0.27, zc), box(0.5, 0.55, dp, x1 + 0.25, 0.27, zc));
      b.add(m.liner, box(wd, 0.05, dp, xc, 0.05, zc));
      b.add(m.water, place(new THREE.PlaneGeometry(wd, dp), xc, 0.42, zc, -Math.PI / 2));
      this.col(xc, 0.27, z0 - 0.25, wd / 2 + 0.5, 0.27, 0.25);
      this.col(xc, 0.27, z1 + 0.25, wd / 2 + 0.5, 0.27, 0.25);
      this.col(x0 - 0.25, 0.27, zc, 0.25, 0.27, dp / 2);
      this.col(x1 + 0.25, 0.27, zc, 0.25, 0.27, dp / 2);
    }
    b.add(m.post, box(0.08, 1.6, 0.08, -24.6, 0.8, -1.0));
    b.add(m.print, domePrint('pondSign', 0.8, 0.5, M(-24.6, 1.45, -0.95, Math.PI / 2)));
    // the turbine yard (south-west): two enclosures, their stacks, a transformer behind a low wall
    for (const [x, z, ry] of [[-21, 26, 0.6], [-27, 18, 0.6]] as [number, number, number][]) {
      b.add(m.tank, box(6.5, 3.2, 3.0, x, 1.6, z, ry));
      b.add(m.dark, box(1.0, 1.2, 0.05, x + Math.sin(ry + Math.PI / 2) * 1.52, 1.2, z + Math.cos(ry + Math.PI / 2) * 1.52, ry));
      const sx = x - Math.sin(ry) * 2.2, sz = z - Math.cos(ry) * 2.2;
      b.add(m.pipe, cyl(0.7, 0.8, 12, sx, 6, sz, 14));
      b.add(m.black, cyl(0.72, 0.72, 0.5, sx, 11.9, sz, 14));
      this.physics.addBox(this.w(x, 1.6, z), { x: 3.25, y: 1.6, z: 1.5 }, ry);
      this.physics.addCylinder(this.w(sx, 6, sz), 6, 0.8);
    }
    b.add(m.dark, box(3.2, 2.4, 2.2, -14.5, 1.2, 32), box(4.4, 1.0, 0.3, -14.5, 0.5, 30.4));
    this.col(-14.5, 1.2, 32, 1.6, 1.2, 1.1);
    // scattered rocks and a dune drifted against the fence's south side
    const rr = rng(31);
    for (let i = 0; i < 14; i++) {
      const a = rr() * Math.PI * 2, rad = 31 + rr() * 7, p = P(rad, a);
      if (Math.abs(a - Math.PI) < 0.35 || Math.abs(a - Math.PI / 2) < 0.12) continue;
      b.add(m.rock, place(rockGeometry(i * 5 + 2, 0), p.x, 0.1, p.z, 0, a, 0, 0.4 + rr() * 0.5));
    }
    const yard = this.pal.slot('#ffe2b8', 0);
    this.slots.yard = yard.intensity;
    for (const a of [deg(140), deg(220), deg(60), deg(300)]) {
      const p = P(DM.R + 3.2, a);
      b.add(m.post, cyl(0.06, 0.08, 4.5, p.x, 2.25, p.z, 6));
      yard.add(b, box(0.3, 0.06, 0.15, p.x, 4.45, p.z, a));
    }
  }

  // ------------------------------------------------------------------ the Helpers' routes
  private buildRoutes() {
    const at = (x: number, z: number) => this.w(x, 0, z);
    this.routes.h1 = [at(-25, -17), at(-14, -30), at(0, -32), at(14, -30), at(25, -17)];
    this.routes.h2 = [at(26, -12), at(34, -3), at(35, 7), at(33, 10)];
    this.routes.h3 = [at(-15, 7.75), at(-1.6, 7.75), at(1.6, 7.75), at(15, 7.75)];
    this.routes.h4 = [at(15, 14.75), at(0, 14.75), at(-15, 14.75)];
    this.routes.h5 = [at(-9.25, 19), at(-9.25, 4.5), at(-11, -1.5), at(-11, -12)];
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
      racks: [L('#6fb8ff', 14, -7, 3.6, 11.5, 1.8), L('#6fb8ff', 14, 7, 3.6, 11.5, 1.8)],
      stage: L('#ffd9a8', 12, 0, 5.5, -6.5, 2.2),
      gil: L('#bfe2ff', 6, -15.8, 1.6, -5.8, 2),
      farm: L('#b8ffd0', 7, 14.2, 2.6, -7.5, 1.8),
      pod: L('#ffe0b4', 8, 0, DM.POD_Y + 3, -2, 2.4),
      gate: L('#eaf0ff', 18, DM.GATE_W + 1.2, 6, -DM.FENCE - 0.4, 1),
      hut: L('#ffd9a0', 4.5, -9.5, 2.3, -45.5, 1.5),
    };
  }
}
