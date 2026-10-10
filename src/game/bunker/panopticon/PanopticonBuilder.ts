import * as THREE from 'three/webgpu';
import { Fn, uniform, positionLocal, positionWorld, normalWorld, cameraPosition, abs, dot, pow, float, smoothstep, fract, time, vec4 } from 'three/tsl';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, MeshBatch, DistanceLod, shadowProxy, wire } from '../../world/kit';
import { surfaces, type Surface } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, carGlass, fabric, wood, desertRock } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { LiveScreen } from '../apex/apexAtlas';
import { panPrint, panPrintMaterial, paintFeeds, feedQuad, feedTiles, GLIMPSE_BLUE } from './panopticonAtlas';
import type { BunkerShell, Door, Laser, LootSpot, SecurityCamera, Tripwire } from '../shell';

/**
 * The Panopticon, at the head of the valley north of the salt. Local metres, +z = the front (south,
 * down the valley toward the salt); angles θ from +z toward +x, so a point at radius r is
 * (r sin θ, r cos θ) and θ = 90° is east. The pad is flattened by Heightfield (PANOPTICON_PAD).
 *
 * - The drum (r 18, 7 m): windowless, the Glimpse wordmark over a glass face gate in the front.
 * - The ring: twelve 30° bays. Bay 0 is the passage in from the gate; the other eleven are reviewers'
 *   cells behind glass at r 10.5, each with a desk against the outer wall (people sit with their backs
 *   to the yard). Desk 4 is Kofi's, 7 is Ada's, 10 is Jun's.
 * - The yard round the tower (r 5.2…10.5): four dead planters, the cameras' junction boxes on the
 *   cell pillars.
 * - The tower: the old Point Argus light (r 5.2 at the foot, tapering to a gallery at 34 m and the
 *   lantern with the blue lamp). Four cameras on it at 4.8 m (S, E, N, W). Ezra's room is in its foot,
 *   the door on the west side: his monitor wall, the rack with the archive, a locker, the cistern hatch.
 * - The valley: three Glimpse pole cameras on the approach.
 */
export const PAN = {
  RO: 18, RI: 10.5, RT: 5.2, H: 7, CEIL: 6.6,
  /** The tower: radius at the gallery, gallery height, lantern. */
  RTOP: 3.7, GALLERY: 34,
  /** The tower room (inside the foot). */
  ROOM_R: 4.5, ROOM_H: 3.6,
  /** Half-width of the gate and passage. */
  GATE: 1.6,
  /** The tower door's angle (west) and half-width. */
  DOOR_T: (3 * Math.PI) / 2, DOOR_W: 0.75,
  GROUNDS: 30,
};
const SECTOR = Math.PI / 6;
/** Bays with someone at the desk (θ = bay × 30°). */
export const PAN_DESKS = { kofi: 4, ada: 7, jun: 10 } as const;
/** The tower cameras' facing (θ) and their junction boxes: box1 on the tower, the rest on the pillars. */
const CAM_T = { cam1: 0, cam2: Math.PI / 2, cam3: Math.PI, cam4: (3 * Math.PI) / 2 };
const BOX_T = { cam1: (3 * Math.PI) / 4, cam2: SECTOR / 2, cam3: Math.PI / 2 + SECTOR / 2, cam4: Math.PI + SECTOR / 2 };
/** Pole cameras on the approach (local x, z). */
const POLES: [string, number, number][] = [['pole1', -9, 36], ['pole2', 12, 55], ['pole3', -6, 78]];

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * The lamp's beam: a long additive cone, cheaper than `lightCone` (no dust noise, no depth reads):
 * bright at the lamp, thinning along its length, soft at its edges by facing, and scan rings running
 * out from the lantern. It can fill half the screen from the valley, so every term here counts
 * (lightCone's version cost ~3 ms in the desktop app). Built pointing down -y from its tip.
 */
function lampCone(length: number, radius: number, c: THREE.ColorRepresentation) {
  const geo = new THREE.ConeGeometry(radius, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  const uIntensity = uniform(0.4), uColor = uniform(new THREE.Color(c)), uLen = uniform(length);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  mat.colorNode = Fn(() => {
    const along = (positionLocal.y as N).negate().div(uLen);
    const toCam = (cameraPosition as N).sub(positionWorld);
    const facing = abs(dot(normalWorld, toCam.normalize()));
    const fall = pow(float(1).sub(along), 1.6).mul(smoothstep(0.0, 0.04, along));
    const ringD = float(0.5).sub(abs(fract(along.mul(3).sub((time as N).mul(0.5))).sub(0.5)));
    const ring = smoothstep(0.05, 0.0, ringD).mul(float(1).sub(along)).mul(0.5);
    const a = pow(facing, 1.8).mul(fall.add(ring)).mul(0.55);
    return vec4((uColor as N).mul(a).mul(uIntensity), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return { mesh, intensity: uIntensity, color: uColor };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
/** A point at radius r, angle θ, height y. */
const P = (r: number, t: number, y = 0) => V(r * Math.sin(t), y, r * Math.cos(t));
/** Bay space → local: +zs outward along θ, +xs across. */
const bay = (t: number) => new THREE.Matrix4().makeRotationY(t);

export class PanopticonBuilder implements BunkerShell {
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
  readonly interior = new THREE.Group();
  lod!: DistanceLod;
  readonly pal = new GlowPalette(48);
  readonly halos = new GlowSprites(8);
  static readonly CH = { ON: 0, NIGHT: 1, BLINK: 2, ALARM: 3, LAMP: 4 };
  /** Every monitor in the building samples this one canvas (Panopticon repaints it). */
  feeds!: LiveScreen;
  lights!: { yard: VirtualLight[]; cells: VirtualLight[]; room: VirtualLight; gate: VirtualLight };
  readonly slots: Record<'strip' | 'screens' | 'gate' | 'keypad' | 'lamp' | 'lampCore' | 'aviation' | 'beacon' | 'desk', { value: number }> = {} as never;
  /** Junction-box LEDs per camera (green live, red cut). */
  readonly boxLeds: Record<string, { value: number }> = {};
  readonly boxLedsCut: Record<string, { value: number }> = {};
  /** The lamp: a pivot at the lantern (the runtime yaws it) with the beam along its +z. */
  readonly lampPivot = new THREE.Group();
  lampBeam!: ReturnType<typeof lampCone>;
  /** Seats (hips spot on the chair) and yaws for the people; Ezra's spot at his wall. */
  readonly seats: Record<'ada' | 'kofi' | 'jun', { pos: THREE.Vector3; yaw: number }> = {} as never;
  ezraSpot!: { pos: THREE.Vector3; yaw: number };
  /** Alarm beacons. */
  readonly beacons: THREE.Object3D[] = [];
  private far!: THREE.Object3D;

  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'panopticon';
    const R = PAN.RO + 0.6;
    this.innerBox = new THREE.Box3(this.w(-R, -0.5, -R), this.w(R, PAN.H, R));
    this.groundsBox = new THREE.Box3(this.w(-PAN.GROUNDS, -2, -PAN.GROUNDS), this.w(PAN.GROUNDS, 14, PAN.GROUNDS));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** Inside the drum (its wall's inner face, plus `margin`), below the roof. */
  contains(p: THREE.Vector3, margin = 0) {
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    return x * x + z * z < (PAN.RO - 0.3 + margin) ** 2 && y < PAN.H + margin && y > -2;
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** Colliders round an arc: radius r, thickness t, from angle a0 to a1 in n boxes. */
  private ringCol(r: number, t: number, y0: number, h: number, a0: number, a1: number, n: number) {
    const da = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const a = a0 + da * (i + 0.5), half = r * Math.tan(da / 2) + 0.04;
      const p = P(r, a);
      this.col(p.x, y0 + h / 2, p.z, half, h / 2, t / 2, a);
    }
  }

  /**
   * A thick curved wall (r0…r1, y0…y0+h) from angle a0 to a1, with flat end caps. Built as a lathe of
   * its cross-section, so the outer, top and inner faces each keep their own normals.
   */
  private arcWall(b: MeshBatch, mat: THREE.Material, r0: number, r1: number, y0: number, h: number, a0: number, a1: number, seg = 48, caps = true) {
    const y1 = y0 + h;
    const pts = [V(r1, y0, 0), V(r1, y1, 0), V(r1, y1, 0), V(r0, y1, 0), V(r0, y1, 0), V(r0, y0, 0)].map((v) => new THREE.Vector2(v.x, v.y));
    const g = new THREE.LatheGeometry(pts, Math.max(3, Math.round(seg * (a1 - a0) / (Math.PI * 2))), a0, a1 - a0);
    g.translate(0, 0, 0);
    b.add(mat, place(g));
    if (caps && a1 - a0 < Math.PI * 2 - 1e-3) {
      for (const a of [a0, a1]) {
        const m = (r0 + r1) / 2, p = P(m, a);
        b.add(mat, box(0.02, h, r1 - r0, p.x, y0 + h / 2, p.z, a));
      }
    }
  }

  /** A sliding door leaf along x at z (the gate). */
  private slideDoor(id: string, x0: number, x1: number, z: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void) {
    const pivot = new THREE.Group();
    pivot.position.set(x0, 0, z);
    pivot.userData.x0 = x0;
    const lb = new MeshBatch();
    leaf(lb, x1 - x0);
    pivot.add(lb.build(`panDoor:${id}`));
    this.group.add(pivot);
    const pos = this.w((x0 + x1) / 2, h / 2, z), half = V(Math.abs(x1 - x0) / 2, h / 2, 0.14);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount, colliderSpec: { pos, half } };
  }


  private build() {
    const b = new MeshBatch(), inner = new MeshBatch();
    const m = this.mats();
    this.feeds = new LiveScreen(1024, 576, () => {});
    this.feeds.paint = (c, w, h) => paintFeeds(c, w, h, 0, 20);
    this.feeds.repaint();
    this.buildDrum(b, inner, m);
    this.buildRing(inner, m);
    this.buildYard(inner, m);
    this.buildTower(b, inner, m);
    this.buildRoom(inner, m);
    this.buildRoof(b, m);
    this.buildFront(b, m);
    this.buildPoles(b, m);
    this.buildApproach(b, m);
    this.buildLights();
    // the lamp's beam: a long scanning cone from the lantern, yawed by the runtime
    this.lampPivot.position.set(0, PAN.GALLERY + 1.7, 0);
    this.lampBeam = lampCone(140, 11, '#9fc0ff');
    const pitch = -0.055;
    this.lampBeam.mesh.quaternion.setFromUnitVectors(V(0, -1, 0), V(0, Math.sin(pitch), Math.cos(pitch)));
    this.lampPivot.add(this.lampBeam.mesh);
    this.points.lamp = this.w(0, PAN.GALLERY + 1.7, 0);
    // footsteps: polished concrete inside and on the apron, gravel on the valley floor
    const z = (x0: number, z0: number, x1: number, z1: number, kind: Surface) => surfaces.zone(this.w(x0, -2, z0), this.w(x1, 9, z1), kind);
    z(-PAN.RO - 6, -PAN.RO - 6, PAN.RO + 6, PAN.RO + 7, 'concrete');

    this.far = b.buildFar('panopticon-far', { minSize: 0.8 });
    const statics = b.build('panStatic');
    this.group.add(statics);
    this.interior.add(inner.build('panInner'));
    this.interior.name = 'panopticon-interior';
    this.group.add(this.interior);
    this.group.add(this.halos.build());
    shadowProxy(statics);
    for (const d of Object.values(this.doors)) shadowProxy(d.pivot);

    const near = new THREE.Group();
    near.name = 'panopticon-near';
    // (the lamp and its halos stay in both: the beam is the thing you see from the salt)
    const keep = new Set<THREE.Object3D>([this.halos.sprite, this.lampPivot]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far, this.lampPivot);
    // the tower is 38 m tall against the cliff: keep the stand-in to 1 km
    this.lod = new DistanceLod(this.origin.clone(), 40, near, this.far, 150, 1000);
  }

  private mats() {
    return {
      drum: concrete('#d9d6cf', { scale: 0.7, stains: 0.45 }),
      drumIn: concrete('#bfc3c6', { scale: 0.9, stains: 0.3 }),
      floor: plainStandard('#8f9499', 0.45, 0.05),
      darkFloor: plainStandard('#3d4247', 0.6, 0.05),
      white: plainStandard('#eef0ee', 0.6, 0.02),
      tower: concrete('#efece4', { scale: 0.5, stains: 0.6 }),
      band: plainStandard('#a6382c', 0.7, 0.02),
      copper: plainStandard('#5f8a78', 0.55, 0.35),
      steel: plainStandard('#b9bec4', 0.32, 0.9),
      black: plainStandard('#16181c', 0.5, 0.3),
      dark: plainStandard('#2a2e35', 0.55, 0.2),
      blue: plainStandard('#3a5ca8', 0.5, 0.1),
      yellow: plainStandard('#e2b21c', 0.7, 0.1),
      lattice: rustyMetal({ base: '#7d8288', rust: 0.25, metalness: 0.7 }),
      glass: carGlass(),
      // the cell fronts: clear, so the yard sees every desk (and every desk is seen)
      clear: plainStandard('#9fb8c8', 0.06, 0.2, { transparent: true, opacity: 0.14, depthWrite: false }),
      // the cells' walls catch their own monitors' light (there are only so many real lights)
      cellWall: plainStandard('#8e97a3', 0.85, 0, { emissive: '#203048', emissiveIntensity: 0.55 }),
      cellDesk: plainStandard('#c9c4ba', 0.6, 0.02, { emissive: '#1c2a40', emissiveIntensity: 0.5 }),
      desk: plainStandard('#c9c4ba', 0.6, 0.02),
      chair: fabric('#2c3848'),
      cot: fabric('#6c7480'),
      crate: wood('#8a6a44'),
      plant: plainStandard('#6b5a3c', 0.95, 0),
      soil: plainStandard('#3a2e22', 0.95, 0),
      rock: desertRock(),
      print: panPrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the drum: walls, floor, ceiling
  private buildDrum(b: MeshBatch, d: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { RO, H, CEIL, RT, GATE } = PAN;
    const gap = Math.asin(GATE / RO) + 0.004;
    // the outer wall (outside face concrete, inside face the drum's paler render), the gate gap at θ 0
    this.arcWall(b, m.drum, RO - 0.3, RO + 0.3, 0, H, gap, Math.PI * 2 - gap, 72);
    this.ringCol(RO, 0.6, 0, H, gap, Math.PI * 2 - gap, 46);
    // a plinth course round the foot, and the parapet's coping
    this.arcWall(b, m.darkFloor, RO + 0.3, RO + 0.42, 0, 0.5, gap, Math.PI * 2 - gap, 72, false);
    this.arcWall(b, m.white, RO - 0.35, RO + 0.4, H, 0.18, 0, Math.PI * 2, 72, false);
    // the gate's surround: a lintel and two thick jambs
    b.add(m.drum, box(GATE * 2 + 1.0, H - 3.2, 0.7, 0, 3.2 + (H - 3.2) / 2, RO - 0.05));
    b.add(m.dark, box(GATE * 2 + 1.0, 0.35, 0.75, 0, 3.37, RO));
    this.col(0, 3.2 + (H - 3.2) / 2, RO, GATE + 0.5, (H - 3.2) / 2, 0.4);
    for (const s of [-1, 1]) b.add(m.dark, box(0.5, 3.2, 0.8, s * (GATE + 0.25), 1.6, RO));
    // floor (the ring and the passage), ceiling (inside only)
    d.add(m.floor, place(new THREE.RingGeometry(RT, RO - 0.25, 72, 1), 0, 0.02, 0, -Math.PI / 2));
    d.add(m.drumIn, place(new THREE.RingGeometry(RT, RO - 0.25, 72, 1), 0, CEIL, 0, Math.PI / 2));
    // the passage from the gate to the yard: two walls, a lower soffit, the staff notice
    const zIn = Math.sqrt(PAN.RI ** 2 - GATE ** 2), zOut = Math.sqrt(RO ** 2 - GATE ** 2) - 0.3;
    for (const s of [-1, 1]) {
      d.add(m.drumIn, box(0.25, CEIL, zOut - zIn, s * (GATE + 0.12), CEIL / 2, (zIn + zOut) / 2));
      this.col(s * (GATE + 0.12), CEIL / 2, (zIn + zOut) / 2, 0.13, CEIL / 2, (zOut - zIn) / 2);
    }
    d.add(m.drumIn, box(GATE * 2, CEIL - 3.2, zOut - zIn, 0, 3.2 + (CEIL - 3.2) / 2, (zIn + zOut) / 2));
    d.add(m.print, panPrint('notice', 0.8, 1.05, M(-GATE + 0.01, 1.6, zIn + 3.2, Math.PI / 2)));
    d.add(m.print, panPrint('stripes', 3.0, 0.15, M(0, 0.03, zIn + 0.2, 0, -Math.PI / 2)));
    // strip lights along the passage soffit
    const strip = this.pal.slot('#e6f0ff', 4);
    this.slots.strip = strip.intensity;
    for (const s of [-1, 1]) strip.add(d, box(0.08, 0.04, zOut - zIn - 0.6, s * (GATE - 0.25), 3.18, (zIn + zOut) / 2));
    this.points.interior = this.w(0, 1, 8);
    this.points.passage = this.w(0, 1, zIn + 2);
  }

  // ------------------------------------------------------------------ the ring of cells
  private buildRing(d: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { RI, RO, CEIL, GATE } = PAN;
    const scr = this.pal.slot('#bcd2ff', 1.6);
    this.slots.screens = scr.intensity;
    const lamp = this.pal.slot('#ffe2b0', 3);
    this.slots.desk = lamp.intensity;
    const nFeeds = feedTiles();
    // dividers between bays (radial walls) and the pillars at their inner ends
    for (let k = 0; k < 12; k++) {
      const t = SECTOR / 2 + k * SECTOR;
      const mid = P((RI + RO - 0.3) / 2, t);
      d.add(m.cellWall, box(0.24, CEIL, RO - 0.3 - RI, mid.x, CEIL / 2, mid.z, t));
      this.col(mid.x, CEIL / 2, mid.z, 0.12, CEIL / 2, (RO - 0.3 - RI) / 2, t);
      const p = P(RI - 0.05, t);
      d.add(m.white, box(0.5, CEIL, 0.5, p.x, CEIL / 2, p.z, t));
      this.col(p.x, CEIL / 2, p.z, 0.25, CEIL / 2, 0.25, t);
    }
    // the fronts: a knee wall, glass, a header, each bay's chord; bay 0 is the passage
    const half = SECTOR / 2, chord = 2 * RI * Math.sin(half) - 0.5, cz = RI * Math.cos(half);
    for (let k = 1; k < 12; k++) {
      const t = k * SECTOR, B = bay(t);
      const at = (g: THREE.BufferGeometry) => g.applyMatrix4(B);
      d.add(m.white, at(box(chord, 0.9, 0.2, 0, 0.45, cz)));
      d.add(m.drumIn, at(box(chord, CEIL - 2.9, 0.2, 0, 2.9 + (CEIL - 2.9) / 2, cz)));
      d.add(m.clear, at(box(chord, 2.0, 0.04, 0, 1.9, cz)));
      d.add(m.steel, at(box(chord, 0.05, 0.08, 0, 2.9, cz)), at(box(chord, 0.05, 0.08, 0, 0.9, cz)));
      const c = P(cz, t);
      this.col(c.x, CEIL / 2, c.z, chord / 2 + 0.05, CEIL / 2, 0.12, t);
      // the desk plate on the pillar to the left of the glass (seen from the yard)
      const n = String(k).padStart(2, '0');
      const pl = P(RI - 0.32, t - half + 0.05);
      d.add(m.print, panPrint(`desk${n}`, 0.52, 0.2, M(pl.x, 1.55, pl.z, t + Math.PI)));
      // inside the bay: desk against the outer wall, three monitors, a chair, a lamp, a cot
      const zD = RO - 1.1;
      d.add(m.cellDesk, at(box(2.6, 0.06, 0.85, 0, 0.75, zD)), at(box(0.06, 0.75, 0.8, -1.25, 0.375, zD)), at(box(0.06, 0.75, 0.8, 1.25, 0.375, zD)));
      for (let j = -1; j <= 1; j++) {
        const sx = j * 0.72, rot = -j * 0.25;
        d.add(m.black, at(place(new THREE.BoxGeometry(0.66, 0.42, 0.04), sx, 1.12, zD + 0.18 - Math.abs(j) * 0.08, 0, rot + Math.PI, 0)));
        d.add(this.feeds.material, at(feedQuad((k * 3 + j + 1) % nFeeds, 0.6, 0.36, M(sx, 1.12, zD + 0.155 - Math.abs(j) * 0.08, rot + Math.PI))));
        d.add(m.black, at(box(0.05, 0.3, 0.05, sx, 0.9, zD + 0.22 - Math.abs(j) * 0.08)));
      }
      lamp.add(d, at(cyl(0.08, 0.12, 0.08, 1.05, 1.12, zD - 0.1, 10)));
      d.add(m.black, at(beam(V(1.05, 0.78, zD + 0.1), V(1.05, 1.1, zD - 0.1), 0.012, 4)));
      const occupied = k === PAN_DESKS.ada || k === PAN_DESKS.kofi || k === PAN_DESKS.jun;
      const seatZ = zD - 0.95;
      // the chair: occupied ones pulled up to the desk; vacant ones pushed in and turned
      const chair = (z: number, yaw: number) => {
        d.add(m.chair, at(place(new THREE.BoxGeometry(0.5, 0.08, 0.48), 0, 0.46, z, 0, yaw, 0)));
        d.add(m.chair, at(place(new THREE.BoxGeometry(0.48, 0.55, 0.06), Math.sin(yaw) * -0.24, 0.78, z - Math.cos(yaw) * 0.24, 0, yaw, 0)));
        d.add(m.black, at(cyl(0.03, 0.03, 0.4, 0, 0.24, z, 6)), at(place(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 10), 0, 0.03, z)));
      };
      chair(occupied ? seatZ : seatZ + 0.45, occupied ? 0 : 0.6 * (k % 2 ? 1 : -1));
      // a cot along the right-hand divider, a footlocker, someone's mug
      d.add(m.cot, at(box(0.8, 0.12, 1.9, 2.15, 0.42, zD - 2.6)));
      d.add(m.steel, at(box(0.8, 0.04, 1.9, 2.15, 0.34, zD - 2.6)));
      for (const zz of [-0.85, 0.85]) d.add(m.steel, at(box(0.04, 0.34, 0.04, 2.15 - 0.36, 0.17, zD - 2.6 + zz)), at(box(0.04, 0.34, 0.04, 2.15 + 0.36, 0.17, zD - 2.6 + zz)));
      d.add(m.crate, at(box(0.7, 0.4, 0.45, 2.1, 0.2, zD - 4.0)));
      d.add(m.white, at(cyl(0.045, 0.04, 0.1, -0.8, 0.83, zD - 0.15, 8)));
      if (occupied) {
        const key = k === PAN_DESKS.ada ? 'ada' : k === PAN_DESKS.kofi ? 'kofi' : 'jun';
        this.seats[key] = { pos: this.w(0, 0, 0).add(P(seatZ, t)).setY(this.origin.y + 0.46), yaw: t };
        this.points[`${key}Glass`] = this.w(0, 0, 0).add(P(RI - 0.9, t)).setY(this.origin.y + 1.2);
        this.points[`${key}Lamp`] = this.w(0, 0, 0).add(P(zD - 0.6, t)).setY(this.origin.y + 1.9);
      }
      if (k === PAN_DESKS.ada) {
        // her camp chair from the Everafter line, folded against the wall, and a photo taped up
        d.add(m.blue, at(place(new THREE.BoxGeometry(0.5, 0.9, 0.08), -2.2, 0.48, zD - 2.0, 0.1, 0, 0)));
        d.add(m.steel, at(beam(V(-2.4, 0.04, zD - 2.0), V(-2.0, 0.95, zD - 2.05), 0.015, 4)), at(beam(V(-2.0, 0.04, zD - 2.0), V(-2.4, 0.95, zD - 2.05), 0.015, 4)));
        d.add(m.white, at(place(new THREE.BoxGeometry(0.15, 0.1, 0.005), -0.9, 1.45, zD + 0.34, 0, Math.PI, 0.1)));
      }
    }
    // bay 0's inner front either side of the passage: plain wall
    const t0 = SECTOR / 2;
    const a = P(RI, t0), bb = V(GATE + 0.25, 0, Math.sqrt(RI * RI - (GATE + 0.25) ** 2));
    for (const s of [-1, 1]) {
      const p0 = V(a.x * s, 0, a.z), p1 = V(bb.x * s, 0, bb.z);
      const mid = p0.clone().add(p1).multiplyScalar(0.5), len = p0.distanceTo(p1), yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z) + Math.PI / 2;
      d.add(m.drumIn, box(len + 0.1, CEIL, 0.2, mid.x, CEIL / 2, mid.z, yaw));
      this.col(mid.x, CEIL / 2, mid.z, len / 2 + 0.05, CEIL / 2, 0.12, yaw);
    }
    // the yard's ceiling ring of light (a continuous cove), and the ring's floor line
    const cove = this.pal.slot('#dfe9ff', 3);
    cove.add(d, place(new THREE.TorusGeometry(RI - 0.6, 0.05, 6, 72), 0, CEIL - 0.08, 0, Math.PI / 2));
    d.add(m.darkFloor, place(new THREE.RingGeometry(RI - 0.35, RI - 0.15, 72, 1), 0, 0.025, 0, -Math.PI / 2));
  }

  // ------------------------------------------------------------------ the yard round the tower
  private buildYard(d: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { RT, RI } = PAN;
    // a ring of floor tiles in a darker grey round the tower, and the stencil at its door
    d.add(m.darkFloor, place(new THREE.RingGeometry(RT, RT + 1.1, 64, 1), 0, 0.03, 0, -Math.PI / 2));
    d.add(m.print, panPrint('floorWord', 2.6, 0.65, M(-(RT + 1.9), 0.035, 0, -Math.PI / 2, -Math.PI / 2)));
    // four dead planters between the cameras' axes: the only cover in the yard
    for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const p = P(7.9, t);
      d.add(m.white, box(1.3, 0.85, 1.3, p.x, 0.425, p.z, t));
      d.add(m.soil, box(1.14, 0.04, 1.14, p.x, 0.83, p.z, t));
      this.col(p.x, 0.43, p.z, 0.66, 0.43, 0.66, t);
      d.add(m.plant, beam(V(p.x, 0.84, p.z), V(p.x + 0.1, 2.4, p.z - 0.05), 0.04, 5));
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1 + t, h = 1.6 + (i % 3) * 0.35;
        d.add(m.plant, beam(V(p.x + 0.05, h, p.z), V(p.x + Math.sin(a) * 0.55, h - 0.35, p.z + Math.cos(a) * 0.55), 0.015, 4));
      }
    }
    // the junction boxes for the tower cameras: box1 on the tower's foot, the rest on yard pillars
    for (const [id, t] of Object.entries(BOX_T) as [keyof typeof BOX_T, number][]) {
      const onTower = id === 'cam1';
      const r = onTower ? RT + 0.12 : RI - 0.38;
      const face = onTower ? t : t + Math.PI;
      const p = P(r, t);
      d.add(m.dark, box(0.36, 0.52, 0.14, p.x, 1.3, p.z, face));
      d.add(m.print, panPrint(id, 0.2, 0.1, M(p.x + Math.sin(face) * 0.075, 1.48, p.z + Math.cos(face) * 0.075, face)));
      const live = this.pal.slot('#4dff8a', 3), cut = this.pal.slot('#ff3a2a', 0);
      const lp = V(p.x + Math.sin(face) * 0.075, 1.2, p.z + Math.cos(face) * 0.075);
      live.add(d, box(0.05, 0.05, 0.02, lp.x - 0.05 * Math.cos(face), lp.y, lp.z + 0.05 * Math.sin(face), face));
      cut.add(d, box(0.05, 0.05, 0.02, lp.x + 0.05 * Math.cos(face), lp.y, lp.z - 0.05 * Math.sin(face), face));
      this.boxLeds[id] = live.intensity;
      this.boxLedsCut[id] = cut.intensity;
      // conduit up to the ceiling (or up the tower to its camera)
      d.add(m.steel, beam(V(p.x, 1.56, p.z), V(p.x, onTower ? 4.6 : PAN.CEIL, p.z), 0.025, 5));
      this.points[`box_${id}`] = this.w(p.x + Math.sin(face) * 0.6, 1.2, p.z + Math.cos(face) * 0.6);
    }
  }

  // ------------------------------------------------------------------ the tower (Point Argus light)
  private buildTower(b: MeshBatch, d: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { RT, RTOP, GALLERY, DOOR_T, DOOR_W, ROOM_H, CEIL } = PAN;
    const rAt = (y: number) => RT + (RTOP - RT) * (y / GALLERY);
    const dg = Math.asin(DOOR_W / RT) + 0.01;
    // the foot, with the door opening on the west side (two lathes round it), then the shaft
    const shaft = (y0: number, y1: number, mat: THREE.Material, a0 = 0, a1 = Math.PI * 2, batch = b) => {
      const g = new THREE.LatheGeometry([new THREE.Vector2(rAt(y0), y0), new THREE.Vector2(rAt(y1), y1)], 48, a0, a1 - a0);
      batch.add(mat, place(g));
    };
    shaft(0, 2.5, m.tower, DOOR_T + dg, DOOR_T - dg + Math.PI * 2);
    shaft(2.5, 18, m.tower);
    shaft(18, 21.5, m.band);
    shaft(21.5, GALLERY, m.tower);
    // the door's reveals and lintel (the opening goes through 0.7 m of old masonry)
    const dp = P(RT - 0.3, DOOR_T);
    for (const s of [-1, 1]) {
      const p = P(RT - 0.3, DOOR_T + s * dg);
      b.add(m.tower, box(0.04, 2.5, 0.7, p.x, 1.25, p.z, DOOR_T));
    }
    b.add(m.tower, box(0.7, 0.3, DOOR_W * 2 + 0.2, dp.x, 2.45, dp.z));
    this.ringCol(RT - 0.35, 0.7, 0, CEIL, DOOR_T + dg, DOOR_T - dg + Math.PI * 2, 24);
    // the door: steel painted lighthouse white, hinged at its north jamb, swinging in
    const pivot = new THREE.Group();
    pivot.position.set(-RT + 0.05, 0, -DOOR_W);
    const lb = new MeshBatch();
    lb.add(m.white, box(0.08, 2.4, DOOR_W * 2, 0, 1.2, DOOR_W));
    lb.add(m.steel, box(0.1, 0.06, DOOR_W * 1.6, 0, 1.0, DOOR_W), box(0.12, 0.04, 0.16, -0.06, 1.05, DOOR_W * 1.75));
    pivot.add(lb.build('panDoor:tower'));
    this.group.add(pivot);
    const pos = this.w(-RT + 0.05, 1.2, 0), half = V(0.12, 1.2, DOOR_W);
    this.doors.towerDoor = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'y', amount: 1.75, colliderSpec: { pos, half } };
    // the keypad and the keeper's plaque beside the door
    const kp = P(RT + 0.06, DOOR_T + dg + 0.14);
    b.add(m.black, box(0.26, 0.36, 0.08, kp.x, 1.35, kp.z, DOOR_T));
    const pad = this.pal.slot('#58ff9a', 2);
    this.slots.keypad = pad.intensity;
    pad.add(b, box(0.18, 0.07, 0.02, kp.x - 0.05, 1.47, kp.z, DOOR_T));
    const pl = P(RT + 0.04, DOOR_T - dg - 0.25);
    b.add(m.print, panPrint('keeper', 0.72, 0.45, M(pl.x, 1.6, pl.z, DOOR_T)));
    this.points.towerDoor = this.w(-(RT + 0.9), 1.2, 0);
    // the big eye on the shaft, facing down the valley, and Glimpse blue paint round the gallery
    b.add(m.print, panPrint('bigEye', 4.2, 2.6, M(0, 12, rAt(12) + 0.05)));
    b.add(m.print, panPrint('bigEye', 4.2, 2.6, M(0, 12, -(rAt(12) + 0.05), Math.PI)));
    // the gallery: a ring deck, brackets, a railing
    b.add(m.lattice, place(new THREE.CylinderGeometry(RTOP + 1.0, RTOP + 1.0, 0.3, 40), 0, GALLERY + 0.15, 0));
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      b.add(m.lattice, beam(P(RTOP, t, GALLERY - 1.4), P(RTOP + 0.9, t, GALLERY), 0.05, 4));
      b.add(m.lattice, beam(P(RTOP + 0.95, t, GALLERY + 0.3), P(RTOP + 0.95, t, GALLERY + 1.35), 0.025, 4));
    }
    b.add(m.lattice, place(new THREE.TorusGeometry(RTOP + 0.95, 0.03, 4, 48), 0, GALLERY + 1.35, 0, Math.PI / 2));
    b.add(m.lattice, place(new THREE.TorusGeometry(RTOP + 0.95, 0.02, 4, 48), 0, GALLERY + 0.85, 0, Math.PI / 2));
    // the lantern: a glazed drum on a plinth, mullions, a copper cap, a vent ball and a rod
    const LY = GALLERY + 0.3;
    b.add(m.tower, place(new THREE.CylinderGeometry(2.5, 2.6, 0.9, 32), 0, LY + 0.45, 0));
    b.add(m.glass, place(new THREE.CylinderGeometry(2.3, 2.3, 2.8, 24, 1, true), 0, LY + 0.9 + 1.4, 0));
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      b.add(m.copper, beam(P(2.32, t, LY + 0.9), P(2.32, t, LY + 3.7), 0.035, 4));
    }
    b.add(m.copper, place(new THREE.SphereGeometry(2.45, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, LY + 3.7, 0, 0, 0, 0, 1, 0.55, 1));
    b.add(m.copper, place(new THREE.SphereGeometry(0.28, 12, 8), 0, LY + 5.2, 0), cyl(0.03, 0.03, 1.6, 0, LY + 6.0, 0, 5));
    // the lamp inside: a blue core and its halo (the beam is the runtime's)
    const core = this.pal.slot(GLIMPSE_BLUE, 8);
    this.slots.lampCore = core.intensity;
    core.add(b, place(new THREE.SphereGeometry(0.55, 16, 10), 0, LY + 2.1, 0), cyl(0.2, 0.3, 0.9, 0, LY + 1.3, 0, 10));
    this.halos.add(this.w(0, LY + 2.1, 0), '#7fa8ff', 5.5, PanopticonBuilder.CH.LAMP, 2.2);
    this.halos.add(this.w(0, LY + 2.1, 0), '#bcd2ff', 2.0, PanopticonBuilder.CH.LAMP, 3);
    // aerials clamped to the shaft, a dish facing the valley, red aviation lights
    for (const [t, y0, h] of [[0.6, 22, 9], [2.4, 24, 7], [4.1, 20, 11]] as [number, number, number][]) {
      const p = P(rAt(y0) + 0.25, t);
      b.add(m.lattice, cyl(0.05, 0.05, h, p.x, y0 + h / 2, p.z, 5));
      b.add(m.black, box(0.2, 0.3, 0.2, p.x, y0 + 0.4, p.z));
    }
    const dish = P(rAt(26) + 0.6, 0.25, 26);
    b.add(m.white, place(new THREE.SphereGeometry(1.1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3), dish.x, dish.y, dish.z, -Math.PI / 2 + 0.1, 0.25, 0));
    b.add(m.lattice, beam(dish.clone(), P(rAt(26), 0.25, 26), 0.06, 5));
    const avi = this.pal.slot('#ff2a14', 4);
    this.slots.aviation = avi.intensity;
    for (const t of [0, Math.PI]) {
      const p = P(RTOP + 1.0, t, GALLERY + 1.5);
      avi.add(b, cyl(0.1, 0.1, 0.18, p.x, p.y, p.z, 8));
      this.halos.add(this.w(p.x, p.y, p.z), '#ff3020', 1.0, PanopticonBuilder.CH.BLINK, 2);
    }
    // the four tower cameras (4.8 m), looking out over the yard
    for (const [id, t] of Object.entries(CAM_T)) {
      const p = P(rAt(4.8) + 0.35, t, 4.8);
      this.camera(id, b, m, p.x, p.y, p.z, t, 0.6, id === 'cam1' ? 11 : id === 'cam2' ? 9.5 : id === 'cam3' ? 12.5 : 10.5, 9.5, 27);
    }
    // the tower room's inside (inside-only): its wall, floor and ceiling
    const inWall = new THREE.LatheGeometry([new THREE.Vector2(PAN.ROOM_R, ROOM_H), new THREE.Vector2(PAN.ROOM_R, 0)], 40, DOOR_T + dg, Math.PI * 2 - 2 * dg);
    d.add(m.drumIn, place(inWall));
    d.add(m.darkFloor, place(new THREE.CircleGeometry(PAN.ROOM_R, 40), 0, 0.03, 0, -Math.PI / 2));
    d.add(m.drumIn, place(new THREE.CircleGeometry(PAN.ROOM_R, 40), 0, ROOM_H, 0, Math.PI / 2));
    // (the drum's ceiling over the yard meets the shaft; the ring of light round its foot)
    const ring = this.pal.slot('#dfe9ff', 2.5);
    ring.add(d, place(new THREE.TorusGeometry(RT + 0.25, 0.04, 6, 48), 0, CEIL - 0.06, 0, Math.PI / 2));
  }

  /** A sweeping security camera (the runtime yaws `pivot`; its body looks down +z). */
  private camera(id: string, b: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>, x: number, y: number, z: number, yaw0: number, sweep: number, period: number, range: number, halfDeg: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const lens = this.pal.slot('#6f9cff', 1);
    const cb = new MeshBatch();
    cb.add(m.white, box(0.26, 0.24, 0.52, 0, 0, 0.12));
    cb.add(m.black, box(0.16, 0.16, 0.04, 0, 0, 0.4));
    cb.add(m.white, box(0.34, 0.03, 0.6, 0, 0.14, 0.14));
    lens.add(cb, box(0.06, 0.06, 0.02, 0, 0, 0.42));
    pivot.add(cb.build(`panCam:${id}`));
    this.group.add(pivot);
    b.add(m.black, cyl(0.04, 0.04, 0.3, x, y + 0.2, z, 6));
    this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3).sub(V(0, 0, 0.3)).add(V(Math.sin(yaw0) * 0.3, 0, Math.cos(yaw0) * 0.3)), yaw0, sweep, period, range, halfAngle: THREE.MathUtils.degToRad(halfDeg), lens: lens.intensity });
  }

  // ------------------------------------------------------------------ Ezra's room
  private buildRoom(d: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const R = PAN.ROOM_R, nFeeds = feedTiles();
    // the monitor wall on the east half: two rows of seven, on a curved console
    let tile = 0;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 7; i++) {
        const t = THREE.MathUtils.degToRad(42 + i * 16);
        const p = P(R - 0.12, t), y = 1.35 + row * 0.62;
        const face = t + Math.PI;
        d.add(m.black, place(new THREE.BoxGeometry(0.88, 0.56, 0.05), p.x, y, p.z, 0, face, 0));
        const s = P(R - 0.155, t);
        d.add(this.feeds.material, feedQuad(tile++ % nFeeds, 0.82, 0.5, M(s.x, y, s.z, face)));
      }
    }
    for (let i = 0; i < 6; i++) {
      const t = THREE.MathUtils.degToRad(46 + i * 18), p = P(R - 0.55, t);
      d.add(m.desk, box(1.05, 0.06, 0.7, p.x, 0.78, p.z, t), box(1.0, 0.75, 0.05, P(R - 0.25, t).x, 0.38, P(R - 0.25, t).z, t));
    }
    this.col(...P(R - 0.55, Math.PI / 2).toArray() as [number, number, number], 0.35, 0.4, 2.2);
    const kb = P(R - 0.7, Math.PI / 2);
    d.add(m.black, box(0.16, 0.02, 0.48, kb.x, 0.82, kb.z));
    // Ezra stands at the wall, facing it (east); the chair nobody sits in
    this.ezraSpot = { pos: this.w(R - 1.6, 0, 0.2), yaw: Math.PI / 2 };
    this.points.ezra = this.w(R - 1.9, 1.2, 0.2);
    this.col(R - 1.6, 0.9, 0.2, 0.28, 0.9, 0.28);
    const ch = P(2.1, THREE.MathUtils.degToRad(50));
    d.add(m.chair, box(0.52, 0.08, 0.5, ch.x, 0.47, ch.z, 0.4), box(0.5, 0.58, 0.07, ch.x - 0.22, 0.8, ch.z - 0.1, 0.4 + Math.PI / 2));
    d.add(m.black, cyl(0.03, 0.03, 0.42, ch.x, 0.24, ch.z, 6), place(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 10), ch.x, 0.03, ch.z));
    // the rack (NW): the archive drive in its caddy, a transmitter on top, LEDs
    const rk = P(R - 0.55, THREE.MathUtils.degToRad(210));
    const rt = THREE.MathUtils.degToRad(210) + Math.PI;
    d.add(m.black, box(0.62, 2.0, 0.8, rk.x, 1.0, rk.z, rt));
    this.col(rk.x, 1.0, rk.z, 0.35, 1.0, 0.42, rt);
    const leds = this.pal.slot('#4dff8a', 2.5);
    for (let i = 0; i < 6; i++) leds.add(d, box(0.4, 0.015, 0.02, rk.x + Math.sin(rt) * 0.41, 0.4 + i * 0.26, rk.z + Math.cos(rt) * 0.41, rt));
    d.add(m.steel, box(0.5, 0.18, 0.6, rk.x, 2.1, rk.z, rt), cyl(0.012, 0.012, 0.8, rk.x, 2.6, rk.z, 4));
    const caddy = this.pal.slot(GLIMPSE_BLUE, 2.5);
    caddy.add(d, box(0.2, 0.06, 0.03, rk.x + Math.sin(rt) * 0.42, 1.25, rk.z + Math.cos(rt) * 0.42, rt));
    this.points.archive = this.w(rk.x + Math.sin(rt) * 0.9, 1.2, rk.z + Math.cos(rt) * 0.9);
    const shelf = new THREE.Group();
    this.lootSpots.push({ id: 'shelf', pos: this.w(rk.x + Math.sin(rt) * 0.9, 1.0, rk.z + Math.cos(rt) * 0.9), mesh: shelf });
    // the supply locker (SW of the door)
    const lk = P(R - 0.4, THREE.MathUtils.degToRad(318)), lt = THREE.MathUtils.degToRad(318) + Math.PI;
    d.add(m.steel, box(0.9, 1.9, 0.5, lk.x, 0.95, lk.z, lt));
    this.col(lk.x, 0.95, lk.z, 0.45, 0.95, 0.26, lt);
    const lid = new THREE.Group();
    lid.position.set(lk.x + Math.sin(lt) * 0.26, 1.85, lk.z + Math.cos(lt) * 0.26);
    lid.rotation.order = 'YXZ';
    lid.rotation.y = lt;
    const lidB = new MeshBatch();
    lidB.add(m.steel, box(0.86, 0.05, 0.02, 0, 0, 0.01));
    lid.add(lidB.build('panLockerLid'));
    this.interior.add(lid);
    this.lootSpots.push({ id: 'locker', pos: this.w(lk.x + Math.sin(lt) * 0.8, 1.0, lk.z + Math.cos(lt) * 0.8), mesh: lid });
    // the keeper's cistern under a hatch north of the centre: the hatch open, a pipe and a tap
    d.add(m.black, box(1.0, 0.02, 1.0, 0, 0.035, -1.9));
    d.add(m.steel, box(1.1, 0.06, 0.08, 0, 0.05, -1.37), box(1.1, 0.06, 0.08, 0, 0.05, -2.43));
    d.add(m.steel, place(new THREE.BoxGeometry(1.0, 0.04, 1.0), 0, 0.55, -1.38, -1.25, 0, 0));
    d.add(m.steel, beam(V(0.35, 0, -1.9), V(0.35, 0.95, -1.9), 0.05, 8), beam(V(0.35, 0.95, -1.9), V(0.6, 0.95, -1.9), 0.04, 8));
    d.add(m.blue, place(new THREE.TorusGeometry(0.08, 0.02, 6, 12), 0.35, 1.0, -1.9, Math.PI / 2));
    this.lootSpots.push({ id: 'cistern', pos: this.w(0.2, 0.8, -1.5), mesh: new THREE.Group() });
    this.points.cistern = this.w(0, 0.6, -1.9);
    // how he lives: a cot against the south wall, a kettle on a crate, one mug, a stack of
    // printouts in his handwriting, a cardigan over the chair nobody sits in
    const cot = P(R - 0.6, THREE.MathUtils.degToRad(355)), ct = THREE.MathUtils.degToRad(355);
    d.add(m.cot, box(1.9, 0.12, 0.75, cot.x, 0.42, cot.z, ct + Math.PI / 2));
    d.add(m.steel, box(1.9, 0.04, 0.75, cot.x, 0.35, cot.z, ct + Math.PI / 2));
    d.add(m.white, box(0.5, 0.1, 0.32, cot.x + Math.sin(ct) * 0.05 + Math.cos(ct) * 0.7, 0.53, cot.z + Math.cos(ct) * 0.05 - Math.sin(ct) * 0.7, ct + Math.PI / 2));
    const kt = P(R - 0.7, THREE.MathUtils.degToRad(165));
    d.add(m.crate, box(0.5, 0.5, 0.4, kt.x, 0.25, kt.z, 0.3));
    d.add(m.steel, cyl(0.1, 0.12, 0.2, kt.x - 0.08, 0.6, kt.z, 12), cyl(0.012, 0.012, 0.08, kt.x - 0.08, 0.74, kt.z, 5));
    d.add(m.white, cyl(0.045, 0.04, 0.1, kt.x + 0.13, 0.55, kt.z + 0.05, 8));
    for (let i = 0; i < 4; i++) d.add(m.white, box(0.3, 0.012, 0.22, kb.x - 0.1 - i * 0.004, 0.83 + i * 0.012, kb.z + 0.62 + i * 0.01, 0.1 * i));
    d.add(m.chair, box(0.46, 0.05, 0.4, ch.x - 0.18, 1.05, ch.z - 0.08, 0.4 + Math.PI / 2, 0.3));
  }

  // ------------------------------------------------------------------ the roof: masts and dishes
  private buildRoof(b: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { H, RO, RT } = PAN;
    b.add(m.drum, place(new THREE.RingGeometry(RT - 0.1, RO + 0.3, 72, 1), 0, H, 0, -Math.PI / 2));
    for (let i = 0; i < 6; i++) {
      const t = Math.PI / 6 + (i * Math.PI) / 3, p = P(13.5, t), h = 7 + (i % 3) * 2.5;
      // a tapering lattice mast: four legs and braces
      for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]) {
        b.add(m.lattice, beam(V(p.x + dx, H, p.z + dz), V(p.x + dx * 0.25, H + h, p.z + dz * 0.25), 0.04, 4));
      }
      for (let k = 1; k < 5; k++) {
        const y = H + (k / 5) * h, s = 0.4 - 0.3 * (k / 5);
        b.add(m.lattice, beam(V(p.x - s, y, p.z - s), V(p.x + s, y, p.z + s), 0.02, 3), beam(V(p.x + s, y, p.z - s), V(p.x - s, y, p.z + s), 0.02, 3));
      }
      b.add(m.lattice, cyl(0.03, 0.03, 3, p.x, H + h + 1.5, p.z, 4));
      if (i % 2 === 0) b.add(m.white, place(new THREE.SphereGeometry(0.9, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3), p.x + 0.3, H + h * 0.7, p.z, -Math.PI / 2, t, 0));
      else b.add(m.white, box(0.25, 1.4, 0.12, p.x + 0.35, H + h * 0.8, p.z, t));
    }
    // rooftop plant: two HVAC boxes and a cable tray to the tower
    for (const t of [2.2, 4.2]) {
      const p = P(15.3, t);
      b.add(m.steel, box(2.2, 1.2, 1.4, p.x, H + 0.6, p.z, t));
      b.add(m.black, place(new THREE.CircleGeometry(0.45, 16), p.x, H + 1.21, p.z, -Math.PI / 2));
    }
    b.add(m.steel, box(0.4, 0.12, RO - RT - 0.5, 0, H + 0.1, -(RT + RO) / 2 + 0.2));
  }

  // ------------------------------------------------------------------ the front: gate, wordmark, PA, apron
  private buildFront(b: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    const { RO, GATE } = PAN;
    const zg = Math.sqrt(RO * RO - GATE * GATE) + 0.05;
    // the gate: two glass leaves on a track, a camera at eye height in the right jamb
    const leaf = (bb: MeshBatch, w: number) => {
      const s = Math.sign(w), aw = Math.abs(w);
      bb.add(m.glass, box(aw, 2.9, 0.05, (s * aw) / 2, 1.5, 0));
      bb.add(m.steel, box(aw, 0.08, 0.08, (s * aw) / 2, 0.04, 0), box(aw, 0.08, 0.08, (s * aw) / 2, 2.96, 0), box(0.06, 3.0, 0.08, s * aw - s * 0.03, 1.5, 0));
      bb.add(m.blue, box(aw * 0.8, 0.12, 0.06, (s * aw) / 2, 1.4, 0.02));
    };
    this.slideDoor('gateL', 0, -GATE, zg, 3.0, -GATE + 0.05, leaf);
    this.slideDoor('gateR', 0, GATE, zg, 3.0, GATE - 0.05, leaf);
    b.add(m.steel, box(GATE * 2 + 1.6, 0.1, 0.25, 0, 3.1, zg), box(GATE * 2 + 1.6, 0.04, 0.2, 0, 0.02, zg));
    // the gate's face camera, the intercom (right of the gate) and its light
    b.add(m.black, box(0.22, 0.3, 0.12, GATE + 0.55, 1.75, RO + 0.42));
    const eyeLed = this.pal.slot(GLIMPSE_BLUE, 3);
    this.slots.gate = eyeLed.intensity;
    eyeLed.add(b, cyl(0.035, 0.035, 0.02, GATE + 0.55, 1.78, RO + 0.49, 10, Math.PI / 2));
    b.add(m.steel, box(0.32, 0.42, 0.1, 2.8, 1.35, RO + 0.42));
    b.add(m.black, box(0.2, 0.12, 0.02, 2.8, 1.45, RO + 0.48));
    this.points.gate = this.w(0, 1.2, RO + 1.2);
    // the canopy, the wordmark over it, the PA horns either side
    b.add(m.dark, box(GATE * 2 + 2.4, 0.18, 2.2, 0, 3.55, RO + 1.0));
    b.add(m.steel, box(0.08, 0.08, 2.2, -GATE - 1.1, 3.4, RO + 1.0), box(0.08, 0.08, 2.2, GATE + 1.1, 3.4, RO + 1.0));
    b.add(m.print, panPrint('wordmark', 7.4, 1.85, M(0, 5.25, RO + 0.36)));
    for (const s of [-1, 1]) {
      const x = s * 5.2;
      b.add(m.white, place(new THREE.CylinderGeometry(0.34, 0.1, 0.7, 12, 1, true), x, 6.0, RO + 0.6, Math.PI / 2 - 0.25, 0, 0));
      b.add(m.black, box(0.3, 0.3, 0.3, x, 6.0, RO + 0.3));
    }
    this.points.speaker = this.w(0, 6.0, RO + 0.8);
    // spray paint on the drum, left of the gate
    const tg = P(RO + 0.33, -0.55);
    b.add(m.print, panPrint('tag', 4.2, 1.3, M(tg.x, 1.5, tg.z, -0.55)));
    // the apron: a ring slab, a kerb, stones bedded at its edge
    b.add(m.drum, place(new THREE.RingGeometry(RO + 0.4, RO + 7, 72, 1), 0, 0.03, 0, -Math.PI / 2));
    b.add(m.darkFloor, place(new THREE.RingGeometry(RO + 6.8, RO + 7.1, 72, 1), 0, 0.045, 0, -Math.PI / 2));
    b.add(m.yellow, place(new THREE.RingGeometry(RO + 2.6, RO + 2.75, 72, 1, -Math.PI / 2 - 0.45, 0.9), 0, 0.04, 0, -Math.PI / 2));
    // alarm beacons by the gate
    const beacon = this.pal.slot('#ff2a14', 0);
    this.slots.beacon = beacon.intensity;
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (GATE + 1.0), 3.8, RO + 0.5);
      const bb = new MeshBatch();
      beacon.add(bb, cyl(0.12, 0.12, 0.22, 0, 0, 0, 10), box(0.05, 0.16, 0.5, 0, 0, 0.18));
      pivot.add(bb.build('panBeacon'));
      pivot.visible = false;
      this.group.add(pivot);
      this.beacons.push(pivot);
    }
    // where Kade comes up the valley from, and a safe spot to wake up after a beating
    this.points.valley = this.w(4, 0, 96);
    this.points.outside = this.w(3, 0, RO + 12);
  }

  // ------------------------------------------------------------------ the valley's pole cameras
  private buildPoles(b: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    for (const [id, x, z] of POLES) {
      const gy = this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
      b.add(m.steel, cyl(0.09, 0.13, 5.4, x, gy + 2.7, z, 8));
      b.add(m.dark, box(0.4, 0.3, 0.3, x, gy + 0.15, z));
      this.col(x, gy + 2.7, z, 0.15, 2.7, 0.15);
      b.add(m.steel, box(0.9, 0.08, 0.08, x, gy + 5.2, z));
      b.add(m.print, panPrint('pole', 0.62, 0.39, M(x, gy + 2.2, z + 0.14)));
      // its junction box at hip height, with its LEDs
      b.add(m.dark, box(0.3, 0.42, 0.14, x, gy + 1.15, z + 0.2));
      const live = this.pal.slot('#4dff8a', 3), cut = this.pal.slot('#ff3a2a', 0);
      live.add(b, box(0.04, 0.04, 0.02, x - 0.05, gy + 1.05, z + 0.28));
      cut.add(b, box(0.04, 0.04, 0.02, x + 0.05, gy + 1.05, z + 0.28));
      this.boxLeds[id] = live.intensity;
      this.boxLedsCut[id] = cut.intensity;
      this.points[`box_${id}`] = this.w(x, gy + 1.1, z + 0.8);
      this.camera(id, b, m, x + 0.4, gy + 5.1, z, 0.15, 0.85, 14 + id.length, 24, 30);
    }
  }

  // ------------------------------------------------------------------ the valley head: rocks, a track
  private buildApproach(b: MeshBatch, m: ReturnType<PanopticonBuilder['mats']>) {
    // boulders on the approach (cover from the poles and the lamp) and a worn track up to the apron
    const rocks: [number, number, number][] = [[-14, 30, 1.6], [6, 40, 1.9], [-3, 48, 1.3], [17, 66, 2.2], [-15, 62, 1.7], [4, 70, 1.4], [-10, 88, 2.4], [14, 92, 1.5], [24, 38, 2.6], [-24, 44, 2.1]];
    for (const [x, z, s] of rocks) {
      const gy = this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
      b.add(m.rock, place(rockGeometry(x * 13 + z, 1), x, gy + s * 0.35, z, 0, x + z, 0, s, s * 0.8, s));
      this.col(x, gy + s * 0.4, z, s * 0.8, s * 0.55, s * 0.8);
    }
    // the old keeper's path: fist-sized stones either side of a track, half sunk in the dust
    for (let z = 28; z < 100; z += 3.2) {
      for (const sx of [-2.6, 2.6]) {
        const x = sx + Math.sin(z * 0.08) * 1.4, gy = this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
        const sc = 0.22 + ((z * 7 + sx * 3) % 5) * 0.03;
        b.add(m.rock, place(rockGeometry(Math.round(z * 11 + sx * 5), 0), x, gy + 0.02, z, 0, z, 0, sc, sc * 0.6, sc));
      }
    }
    // the power line in from the valley: three poles and a sagging wire to the drum
    let prev: THREE.Vector3 | null = null;
    for (const [x, z] of [[20, 110], [22, 70], [21, 34]] as [number, number][]) {
      const gy = this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
      b.add(m.crate, cyl(0.14, 0.18, 8, x, gy + 4, z, 7));
      b.add(m.crate, box(1.6, 0.12, 0.12, x, gy + 7.6, z));
      const top = V(x, gy + 7.7, z);
      if (prev) b.add(m.black, wire(prev, top, 0.9, 0.015, 14));
      prev = top;
    }
    if (prev) b.add(m.black, wire(prev, V(16.2, 5.6, 7.2), 0.6, 0.015, 12));
  }

  // ------------------------------------------------------------------ lights (virtual: the pool lends them)
  private buildLights() {
    const L = (c: string, dist: number, x: number, y: number, z: number) => {
      const v = new VirtualLight(c, 0, dist, 1.6);
      v.position.copy(this.w(x, y, z));
      return v;
    };
    const a = P(8, Math.PI / 4, 6.0), b2 = P(8, (5 * Math.PI) / 4, 6.0);
    const cell = (k: 'ada' | 'kofi' | 'jun') => {
      const v = new VirtualLight('#b8cdf5', 0, 6.5, 1.6);
      v.position.copy(this.points[`${k}Lamp`]);
      v.priority = 2.6;
      return v;
    };
    this.lights = {
      yard: [L('#e6eeff', 14, a.x, a.y, a.z), L('#e6eeff', 14, b2.x, b2.y, b2.z)],
      cells: [cell('ada'), cell('kofi'), cell('jun')],
      room: L('#cfdcff', 7.5, 0.4, 2.1, -0.4),
      gate: L('#e6eeff', 14, 0, 3.4, PAN.RO + 2.6),
    };
    this.lights.room.priority = 3;
    this.lights.yard[0].priority = 2;
    this.lights.yard[1].priority = 2;
  }
}
