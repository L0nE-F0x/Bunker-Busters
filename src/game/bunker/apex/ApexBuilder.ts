import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, MeshBatch, DistanceLod, shadowProxy, wire, grime } from '../../world/kit';
import { printPaint } from '../../world/printAtlas';
import { surfaces, type Surface } from '@/engine/surface';
import { SALT_FLAT } from '@/content/world';
import { concrete, plainStandard, rustyMetal, desertRock, GlowPalette, fabric, wood, carGlass } from '../../world/materials';
import { GlowSprites, lightCone } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { buildCar } from '../../world/vehicles';
import { apexPrint, apexPrintMaterial, LiveScreen } from './apexAtlas';
import type { BunkerShell, Door, Laser, LootSpot, SecurityCamera, Tripwire } from '../shell';

/**
 * Apex Vault, Vesper Kade's launch site at the foot of the range on the salt's west shore. Local
 * metres, +z = the front, toward her road; the pad is flattened by Heightfield (APEX_PAD).
 *
 * - The apron: a slab with a landing ring, her stainless pickup, a battery bank, a solar field, the
 *   camera mast with the PA, and a sign for the road.
 * - The launch stand (east): a pedestal, a hold-down ring, a 43 m booster held by a lattice tower's
 *   catch arms, leaning a little. It's the skyline from the salt.
 * - The hangar (x −22…2, z −6…14): a barrel roof, her feed screen and the launch clock over the
 *   sliding door, posters, a battery wall, a demo habitat, and the airlock in its back wall.
 * - The vault block in the hill behind it (x −18…−2, z −36…−6, the sealed inside): the airlock, the
 *   launch corridor (three beams, the breaker), the vault door, and the Cistern Room with the tank.
 */
export const APEX_GROUNDS = { x0: -28, x1: 26, z0: -38, z1: 30 };
export const APEX_HANGAR = { x0: -22, x1: 2, z0: -6, z1: 14, h: 7, rise: 5.5, doorX0: -14, doorX1: -6, doorH: 6 };
export const APEX_BLOCK = { x0: -18, x1: -2, z0: -36, z1: -6, cx0: -12.5, cx1: -7.5, vaultZ: -23, innerZ: -9.5, hall: 4.2, room: 6 };

// The Apex Gatehouse on her road is a Kade outpost (content/recovery.ts): its gate sign lives in the
// shared print atlas like every outpost's, painted here so the outposts' file doesn't need to know.
printPaint('kGate:apexgate', 616, 80, (c, w, h) => {
  c.fillStyle = '#f2f2f4'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#101114'; c.fillRect(0, 0, 150, h);
  c.fillStyle = '#f2f2f4'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '900 50px "Big Shoulders Stencil Display", Impact, sans-serif'; c.fillText('APEX', 75, h / 2 + 2);
  c.fillStyle = '#1a1a1a'; c.textAlign = 'left';
  c.font = '900 34px "Big Shoulders Stencil Display", Impact, sans-serif'; c.fillText('APEX GATEHOUSE', 166, 28, w - 180);
  c.font = '600 19px "Chakra Petch", Arial, sans-serif'; c.fillStyle = '#5a1712'; c.fillText('WELCOME, SEED MEMBERS. EVERYONE ELSE: HYDRATE ELSEWHERE', 166, 60, w - 180);
  grime(c, w, h, 1.2, 77);
});

type V3 = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(s, s, s));

export class ApexBuilder implements BunkerShell {
  readonly group = new THREE.Group();
  readonly origin: THREE.Vector3;
  readonly points: Record<string, THREE.Vector3> = {};
  readonly doors: Record<string, Door> = {};
  readonly innerBox: THREE.Box3;
  readonly groundsBox: THREE.Box3;
  /** The hangar (not sealed: its door is a big hole), for objectives and the cameras' story. */
  readonly hangarBox: THREE.Box3;
  readonly tripwires: Tripwire[] = [];
  readonly lasers: Laser[] = [];
  readonly cameras: SecurityCamera[] = [];
  readonly lootSpots: LootSpot[] = [];
  readonly lockMeshes: Record<string, THREE.Object3D> = {};
  /** Inside-only draws (corridor, Cistern Room). */
  readonly interior = new THREE.Group();
  lod!: DistanceLod;
  /** Small glows (LEDs, strips, screens' bezels) in one material; slots driven by Apex. */
  readonly pal = new GlowPalette(28);
  readonly halos = new GlowSprites(8);
  /** Halo channels. */
  static readonly CH = { ON: 0, NIGHT: 1, BLINK: 2, ALARM: 3, LASER: 4, HALL: 5 };
  /** Her feed, over the hangar door. */
  feed!: LiveScreen;
  /** The launch clock (outside over the door and inside over the airlock: one canvas). */
  clock!: LiveScreen;
  /** The meme of the day: a digital poster frame by the airlock that changes with every breach. */
  meme!: LiveScreen;
  lights!: { hangar: VirtualLight[]; hall: VirtualLight; room: VirtualLight; flood: VirtualLight; rocket: VirtualLight };
  /** Glow slots Apex animates (intensity handles). */
  readonly slots: Record<'strip' | 'hallStrip' | 'roomStrip' | 'flood' | 'beacon' | 'aviation' | 'screens' | 'leds' | 'keypad', { value: number }> = {} as never;
  /** Night beams: the mast's flood onto the apron, two uplights on the booster. */
  readonly cones: ReturnType<typeof lightCone>[] = [];
  /** Her delivery drone (hidden until the exit ambush) and the merch crate it drops. */
  readonly drone = new THREE.Group();
  readonly rotors: THREE.Object3D[] = [];
  readonly crate = new THREE.Group();
  /** Alarm beacons (shown while it rings). */
  readonly beacons: THREE.Object3D[] = [];
  private far!: THREE.Object3D;

  /** `ground(x, z)`: the terrain height at a world point (things stranded on the salt sit on it). */
  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'apex';
    const B = APEX_BLOCK, Hg = APEX_HANGAR, G = APEX_GROUNDS;
    this.innerBox = new THREE.Box3(this.w(B.x0, 0, B.z0), this.w(B.x1, B.room + 0.4, B.z1));
    this.groundsBox = new THREE.Box3(this.w(G.x0, -2, G.z0), this.w(G.x1, 12, G.z1));
    this.hangarBox = new THREE.Box3(this.w(Hg.x0, 0, Hg.z0), this.w(Hg.x1, Hg.h + Hg.rise, Hg.z1));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  private col(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0) {
    return this.physics.addBox(this.w(x, y, z), { x: hx, y: hy, z: hz }, rotY);
  }

  /** A static wall box (geometry + collider), x0..x1 × z0..z1, from y0 to y0+h. */
  private wall(b: MeshBatch, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, h: number, y0 = 0) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
    b.add(mat, box(sx, h, sz, cx, y0 + h / 2, cz));
    this.col(cx, y0 + h / 2, cz, sx / 2, h / 2, sz / 2);
  }

  /**
   * A door leaf from x0 to x1 in a wall at z, `h` tall. Hinged (`amount` radians about its x0 edge) or
   * sliding (`amount` metres along x). `leaf` builds the leaf's look into a batch around the pivot.
   */
  private door(id: string, x0: number, x1: number, z: number, h: number, axis: 'y' | 'slide', amount: number, leaf: (b: MeshBatch, w: number) => void, parent: THREE.Object3D = this.group) {
    const pivot = new THREE.Group();
    pivot.position.set(axis === 'y' ? x0 : x0, 0, z);
    pivot.userData.x0 = pivot.position.x;
    const lb = new MeshBatch();
    leaf(lb, x1 - x0);
    const built = lb.build(`apexDoor:${id}`);
    pivot.add(built);
    parent.add(pivot);
    const pos = this.w((x0 + x1) / 2, h / 2, z), half = V((x1 - x0) / 2, h / 2, 0.12);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis, amount, colliderSpec: { pos, half } };
    return pivot;
  }

  /** Uplight lenses (night only). */
  readonly uplights: { value: number }[] = [];
  private flatB: MeshBatch | null = null;

  private build() {
    const b = new MeshBatch();
    this.flatB = b;
    const inner = new MeshBatch();
    const M_ = this.mats();
    this.buildApron(b, M_);
    this.buildRocket(b, M_);
    this.buildHangar(b, M_);
    this.buildBlock(b, inner, M_);
    this.buildSalt(b, M_);
    this.buildLights();
    this.buildDrone();
    // volumetric beams for the night (one shared program with every other cone)
    const beamTo = (from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string) => {
      const len = from.distanceTo(to);
      const c = lightCone(len, radius, color, 0);
      c.mesh.position.copy(from);
      c.mesh.quaternion.setFromUnitVectors(V(0, -1, 0), to.clone().sub(from).normalize());
      c.mesh.visible = false;
      this.group.add(c.mesh);
      this.cones.push(c);
    };
    beamTo(V(-25, 10.3, 18.7), V(-12, 0, 21), 6.5, '#fff1d0');
    beamTo(V(10.6, 2.6, 1.2), V(13.4, 30, -2.6), 3.2, '#ffe2bc');
    beamTo(V(17.6, 2.6, 1.2), V(14.6, 30, -2.6), 3.2, '#ffe2bc');
    for (const x of [10.6, 17.6]) {
      const lamp = this.pal.slot('#ffe2bc', 0);
      lamp.add(this.flatB!, box(0.5, 0.3, 0.5, x, 2.55, 1.2));
      this.uplights.push(lamp.intensity);
    }
    // footsteps: concrete on the apron, in the hangar and the vault; steel in the duct; the salt crunches
    const z = (x0: number, z0: number, x1: number, z1: number, kind: Surface) => surfaces.zone(this.w(x0, -2, z0), this.w(x1, 8, z1), kind);
    z(APEX_GROUNDS.x0 + 2, -6, APEX_GROUNDS.x1 - 2, 29, 'concrete');
    z(APEX_BLOCK.x0, APEX_BLOCK.z0, APEX_BLOCK.x1, APEX_BLOCK.z1, 'concrete');
    z(APEX_BLOCK.cx1 + 0.2, -18.1, APEX_BLOCK.x1 + 0.4, -16.9, 'metal');
    surfaces.zone({ x: SALT_FLAT.x - SALT_FLAT.r * 0.7, y: -1e3, z: SALT_FLAT.z - SALT_FLAT.r * 0.7 }, { x: SALT_FLAT.x + SALT_FLAT.r * 0.7, y: 1e3, z: SALT_FLAT.z + SALT_FLAT.r * 0.7 }, 'gravel');

    // far: the whole site flattened to one draw (the booster and the tower read from the salt)
    this.far = b.buildFar('apex-far', { minSize: 0.8 });
    const statics = b.build('apexStatic');
    this.group.add(statics);
    const ins = inner.build('apexInner');
    this.interior.add(ins);
    this.interior.name = 'apex-interior';
    this.group.add(this.interior);
    this.group.add(this.halos.build());

    shadowProxy(statics);
    for (const d of Object.values(this.doors)) shadowProxy(d.pivot);

    const near = new THREE.Group();
    near.name = 'apex-near';
    const keep = new Set<THREE.Object3D>([this.halos.sprite]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far);
    // the far stand-in shows from 150 m past the fence; the booster is 43 m tall, so keep it to 900 m
    this.lod = new DistanceLod(this.origin.clone(), 40, near, this.far, 150, 900);
  }

  private mats() {
    return {
      slab: concrete('#a7a39b', { scale: 0.6, stains: 0.5 }),
      wallC: concrete('#8f8a82', { scale: 1, stains: 0.7 }),
      darkC: concrete('#5d5a55', { scale: 1.2, stains: 0.8 }),
      steel: plainStandard('#c4c8cc', 0.28, 0.92),
      brushed: plainStandard('#9ea3a8', 0.42, 0.85),
      white: plainStandard('#e6e6e2', 0.55, 0.1),
      black: plainStandard('#16171a', 0.5, 0.3),
      soot: plainStandard('#2b2622', 0.95, 0),
      yellow: plainStandard('#e2b21c', 0.7, 0.1),
      red: plainStandard('#b8281c', 0.6, 0.1),
      rubber: plainStandard('#151515', 0.9, 0),
      panel: plainStandard('#1b2a44', 0.22, 0.6),
      frame: plainStandard('#b0b4b8', 0.4, 0.8),
      roof: plainStandard('#c4c8cc', 0.34, 0.85),
      // the arch seen from under it (the roof shell is one-sided)
      liner: plainStandard('#7d8287', 0.7, 0.4, { side: THREE.BackSide }),
      side: plainStandard('#cfd2d5', 0.36, 0.78),
      batten: plainStandard('#9fa4a9', 0.4, 0.85),
      lattice: rustyMetal({ base: '#55585c', rust: 0.35, metalness: 0.7 }),
      orange: rustyMetal({ base: '#d8661e', rust: 0.25, metalness: 0.5 }),
      rock: desertRock(),
      tarp: fabric('#2c3a4a'),
      crate: wood('#8a6a44'),
      glass: carGlass(),
      print: apexPrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ apron
  private buildApron(b: MeshBatch, m: ReturnType<ApexBuilder['mats']>) {
    const G = APEX_GROUNDS;
    // the slab: thin (the pad is flat) with expansion joints and a scorched patch round the stand
    b.add(m.slab, box(G.x1 - G.x0 - 4, 0.12, 36, (G.x0 + G.x1) / 2, 0.05, 11));
    for (let x = G.x0 + 4; x < G.x1 - 2; x += 6) b.add(m.black, box(0.06, 0.01, 36, x, 0.115, 11));
    for (let z = -6; z < 29; z += 6) b.add(m.black, box(G.x1 - G.x0 - 4, 0.01, 0.06, (G.x0 + G.x1) / 2, 0.115, z));
    b.add(m.soot, place(new THREE.CircleGeometry(9, 28), 14, 0.118, 1, -Math.PI / 2));
    // the landing ring in front of the hangar, and stripes at the threshold
    b.add(m.yellow, place(new THREE.RingGeometry(5.2, 5.6, 48), -10, 0.12, 22, -Math.PI / 2));
    b.add(m.yellow, place(new THREE.RingGeometry(3.0, 3.2, 40), -10, 0.12, 22, -Math.PI / 2));
    b.add(m.print, apexPrint('stripes', 8, 0.7, M(-10, 0.125, 14.9, 0, -Math.PI / 2)));
    b.add(m.print, apexPrint('stripes', 8.6, 0.6, M(14, 2.42, 1.7, 0, -Math.PI / 2)));

    // the camera mast with her PA horns (the speaker), a floodlight and a red beacon
    const mx = -25, mz = 18;
    b.add(m.lattice, cyl(0.16, 0.22, 11, mx, 5.5, mz, 10));
    b.add(m.darkC, box(1.2, 0.5, 1.2, mx, 0.25, mz));
    this.col(mx, 5.5, mz, 0.25, 5.5, 0.25);
    for (const [a, y] of [[0.4, 9.6], [1.9, 9.6], [-1.2, 9.2], [2.8, 9.2]] as [number, number][]) {
      b.add(m.white, place(new THREE.CylinderGeometry(0.42, 0.12, 0.9, 12, 1, true), mx + Math.sin(a) * 0.5, y, mz + Math.cos(a) * 0.5, Math.PI / 2 - 0.15, a, 0));
    }
    b.add(m.black, box(1.6, 0.9, 0.3, mx, 10.4, mz + 0.4));
    const flood = this.pal.slot('#fff1d0', 0.3);
    flood.add(b, box(1.4, 0.7, 0.04, mx, 10.4, mz + 0.57));
    this.slots.flood = flood.intensity;
    b.add(m.black, box(0.7, 0.4, 0.7, mx, 11.2, mz));
    this.halos.add(this.w(mx, 11.5, mz), '#ff3020', 1.2, ApexBuilder.CH.BLINK, 2);
    const avi = this.pal.slot('#ff2a14', 4);
    this.slots.aviation = avi.intensity;
    avi.add(b, cyl(0.12, 0.12, 0.2, mx, 11.5, mz, 8));
    this.points.speaker = this.w(mx + 0.4, 9.6, mz + 0.6);
    this.points.mast = this.w(mx, 10.4, mz + 0.8);
    // decorative camera cluster on the mast
    for (const a of [0.6, -0.9, 2.4]) {
      b.add(m.white, box(0.22, 0.2, 0.45, mx + Math.sin(a) * 0.45, 8.4, mz + Math.cos(a) * 0.45, a));
      b.add(m.black, box(0.12, 0.12, 0.04, mx + Math.sin(a) * 0.68, 8.4, mz + Math.cos(a) * 0.68, a));
    }

    // the battery bank: three white cabinets with vents and status LEDs, cabled to the hangar
    const leds = this.pal.slot('#3cff7a', 3);
    this.slots.leds = leds.intensity;
    for (let i = 0; i < 3; i++) {
      const z = 1.6 + i * 3.8, x = 5.9;
      b.add(m.white, box(2.6, 2.7, 3.4, x, 1.45, z));
      b.add(m.darkC, box(2.9, 0.12, 3.7, x, 0.06, z));
      for (let k = 0; k < 5; k++) b.add(m.black, box(0.02, 0.08, 2.8, x + 1.31, 0.6 + k * 0.38, z));
      b.add(m.brushed, box(2.62, 0.08, 3.42, x, 2.84, z));
      leds.add(b, box(0.03, 0.06, 0.5, x + 1.32, 2.4, z - 1.2));
      this.col(x, 1.45, z, 1.3, 1.4, 1.7);
    }
    b.add(m.rubber, beam(V(4.6, 0.15, 12.4), V(2.2, 0.15, 12.8), 0.08, 6));
    b.add(m.rubber, beam(V(4.6, 0.25, 1.0), V(2.2, 0.25, 0.4), 0.08, 6));

    // the solar field: three racks of six panels, tilted toward the road (one panel blew off its rack
    // and lies face down at the end of the field)
    const tilt = 0.45, ct = Math.cos(tilt), st = Math.sin(tilt), PY = 1.15, HALF = 0.8;
    for (const rz of [13.5, 18.5, 23.5]) {
      for (let i = 0; i < 6; i++) {
        if (rz === 18.5 && i === 4) continue;
        const x = 10.2 + i * 2.2;
        b.add(m.panel, place(new THREE.BoxGeometry(2.12, 0.05, 2 * HALF), x, PY, rz, tilt));
        // cell grid lines on the face (thin, a hair above it)
        for (const k of [-0.5, 0, 0.5]) b.add(m.frame, place(new THREE.BoxGeometry(0.02, 0.01, 2 * HALF), x + k * 1.06, PY + 0.03 * ct, rz + 0.03 * st, tilt));
      }
      const L = 6 * 2.2;
      // rails along the high and low edges, posts under each end and the middle
      const hi = { y: PY + HALF * st, z: rz - HALF * ct }, lo = { y: PY - HALF * st, z: rz + HALF * ct };
      b.add(m.frame, box(L, 0.07, 0.07, 10.2 + 2.5 * 2.2, hi.y - 0.05, hi.z), box(L, 0.07, 0.07, 10.2 + 2.5 * 2.2, lo.y - 0.05, lo.z));
      for (const px of [9.2, 15.7, 22.2]) {
        b.add(m.lattice, box(0.08, hi.y - 0.05, 0.08, px, (hi.y - 0.05) / 2, hi.z), box(0.08, lo.y - 0.05, 0.08, px, (lo.y - 0.05) / 2, lo.z));
        b.add(m.lattice, beam(V(px, 0.05, lo.z), V(px, hi.y - 0.1, hi.z), 0.03, 4));
      }
      this.col(15.7, 0.8, rz, 6.7, 0.8, 0.85);
    }
    b.add(m.panel, place(new THREE.BoxGeometry(2.1, 0.05, 1.6), 21.5, 0.08, 26.6, 0.03, 0.4, 0.02));

    // the road sign: APEX, private launch site, trespassers will be posted
    for (const sx of [6.2, 11.8]) {
      b.add(m.lattice, box(0.18, 4.2, 0.18, sx, 2.1, 32.4));
      this.col(sx, 2.1, 32.4, 0.12, 2.1, 0.12);
    }
    b.add(m.white, box(6.4, 1.5, 0.1, 9, 3.4, 32.4));
    b.add(m.print, apexPrint('gate', 6.2, 1.3, M(9, 3.4, 32.47)));
    b.add(m.print, apexPrint('gate', 6.2, 1.3, M(9, 3.4, 32.33, Math.PI)));

    // jersey barriers along the front edge, with a gap for her truck
    for (const [x, z, r] of [[-26, 27, 0.1], [-22.4, 27.6, 0.05], [-18.8, 28, 0], [16, 28, 0], [19.6, 27.7, -0.08], [23.1, 27, -0.2]] as V3[]) {
      b.add(m.wallC, place(new THREE.CylinderGeometry(0.22, 0.4, 0.82, 4, 1), x, 0.41, z, 0, Math.PI / 4 + r, 0, 3.4 / 0.57, 1, 1));
      this.col(x, 0.41, z, 1.7, 0.41, 0.3, r);
    }

    // her truck: a stainless wedge with a smashed "unbreakable" window
    this.buildTruck(b, m, -0.5, 21, 0.4);
    // a merch table that nobody staffed
    b.add(m.white, box(2.2, 0.06, 0.9, -25.2, 0.92, 7.5));
    for (const [x, z] of [[-26.2, 7.1], [-24.2, 7.1], [-26.2, 7.9], [-24.2, 7.9]]) b.add(m.black, box(0.05, 0.9, 0.05, x, 0.45, z));
    b.add(m.black, box(0.4, 0.3, 0.3, -25.6, 1.1, 7.5), box(0.4, 0.3, 0.3, -24.9, 1.1, 7.4));
    this.col(-25.2, 0.5, 7.5, 1.1, 0.5, 0.45);
  }

  /** The stainless pickup: flat panels, one crease, too heavy to be a truck. */
  private buildTruck(b: MeshBatch, m: ReturnType<ApexBuilder['mats']>, x: number, z: number, yaw: number) {
    const s = new THREE.Shape();
    // side profile (u along the length, v up), front at u = +2.9
    s.moveTo(-2.9, 0.45);
    s.lineTo(2.9, 0.45);
    s.lineTo(2.95, 0.98);
    s.lineTo(0.35, 1.92);
    s.lineTo(-2.9, 1.3);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: false });
    g.translate(0, 0, -1.0);
    g.rotateY(-Math.PI / 2);
    const T = M(x, 0, z, yaw);
    b.add(m.steel, g.toNonIndexed().applyMatrix4(T));
    // glass band (a slimmer wedge inset at the roofline)
    const gs = new THREE.Shape();
    gs.moveTo(2.0, 1.29); gs.lineTo(0.38, 1.88); gs.lineTo(-1.6, 1.52); gs.lineTo(-1.6, 1.28); gs.closePath();
    const gg = new THREE.ExtrudeGeometry(gs, { depth: 2.04, bevelEnabled: false });
    gg.translate(0, 0, -1.02);
    gg.rotateY(-Math.PI / 2);
    b.add(m.glass, gg.toNonIndexed().applyMatrix4(T));
    // wheels, the light bar, the plate
    for (const [wx, wz] of [[-0.95, 1.9], [0.95, 1.9], [-0.95, -1.75], [0.95, -1.75]]) {
      b.add(m.rubber, cyl(0.47, 0.47, 0.34, wx, 0.47, wz, 16, 0, 0, Math.PI / 2).applyMatrix4(T));
      b.add(m.brushed, cyl(0.3, 0.3, 0.36, wx, 0.47, wz, 10, 0, 0, Math.PI / 2).applyMatrix4(T));
    }
    this.pal.slot('#e8f4ff', 2.2).add(b, box(1.9, 0.04, 0.04, 0, 1.0, 2.94).applyMatrix4(T));
    this.pal.slot('#ff2a1a', 2).add(b, box(1.9, 0.05, 0.04, 0, 1.28, -2.92).applyMatrix4(T));
    b.add(m.print, apexPrint('plate', 0.5, 0.25, M(0, 0.7, -2.93, Math.PI)).applyMatrix4(T));
    this.physics.addBox(this.w(x, 0.95, z), { x: 1.05, y: 0.95, z: 2.9 }, yaw);
  }

  // ------------------------------------------------------------------ the launch stand
  private buildRocket(b: MeshBatch, m: ReturnType<ApexBuilder['mats']>) {
    const cx = 14, cz = -3;
    // pedestal with a slot for the flame trench, and six legs up to the hold-down ring
    b.add(m.wallC, box(9, 2.4, 9, cx, 1.2, cz));
    b.add(m.soot, box(3.6, 0.02, 9.02, cx, 2.41, cz));
    this.col(cx, 1.2, cz, 4.5, 1.2, 4.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(m.lattice, beam(V(cx + Math.cos(a) * 3.6, 2.4, cz + Math.sin(a) * 3.6), V(cx + Math.cos(a) * 2.6, 6.1, cz + Math.sin(a) * 2.6), 0.32, 6));
    }
    b.add(m.lattice, place(new THREE.TorusGeometry(2.7, 0.28, 8, 32), cx, 6.1, cz, Math.PI / 2));
    // the booster: leaning 2.2° toward the tower, held by the arms
    const lean = new THREE.Matrix4().compose(V(cx, 6.4, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.038)), V(1, 1, 1));
    const R = 2.25, L = 30;
    const add = (mat: THREE.Material, g: THREE.BufferGeometry) => b.add(mat, g.applyMatrix4(lean));
    add(m.steel, cyl(R, R, L, 0, L / 2, 0, 40));
    add(m.steel, place(new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 0, L, 0, 0, 0, 0, 1, 3.2, 1));
    // weld rings, soot creeping up from the engines, the wordmark down its side
    for (let y = 2.5; y < L; y += 2.6) add(m.brushed, cyl(R + 0.025, R + 0.025, 0.06, 0, y, 0, 40));
    add(m.soot, cyl(R + 0.02, R + 0.02, 3.6, 0, 1.8, 0, 40));
    add(m.print, apexPrint('logo', 12, 2.6, M(0, 16, R + 0.04, 0, 0, Math.PI / 2)));
    add(m.print, apexPrint('logo', 12, 2.6, M(R + 0.04, 16, 0, Math.PI / 2, 0, Math.PI / 2)));
    // engines under the skirt
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2, rr = i === 6 ? 0 : 1.3;
      add(m.black, place(new THREE.CylinderGeometry(0.22, 0.55, 1.1, 14, 1, true), Math.cos(a) * rr, -0.4, Math.sin(a) * rr));
    }
    // grid fins and the chines
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const fx = Math.cos(a) * (R + 0.7), fz = Math.sin(a) * (R + 0.7);
      add(m.lattice, place(new THREE.BoxGeometry(1.4, 1.2, 0.12), fx, L - 3.2, fz, 0, -a + Math.PI / 2, 0));
      for (let k = -2; k <= 2; k++) add(m.lattice, place(new THREE.BoxGeometry(0.04, 1.2, 0.3), fx + Math.cos(a + Math.PI / 2) * k * 0.28, L - 3.2, fz + Math.sin(a + Math.PI / 2) * k * 0.28, 0, -a, 0));
    }
    for (const a of [0.3, Math.PI + 0.3]) add(m.steel, place(new THREE.BoxGeometry(0.25, 8, 0.6), Math.cos(a) * (R + 0.2), L + 3, Math.sin(a) * (R + 0.2), 0, -a, 0));

    // the lattice tower and its catch arms (one arm drooping)
    const tx = 21.8, tz = -3, TH = 46, S = 1.6;
    const avi2 = (bb: MeshBatch, g: THREE.BufferGeometry) => {
      // same colour and blink as the mast's beacon: a second slot driven alongside it
      const sl = this.pal.slot('#ff2a14', 4);
      const prev = this.slots.aviation;
      this.slots.aviation = { get value() { return sl.intensity.value; }, set value(v: number) { sl.intensity.value = v; if (prev) prev.value = v; } };
      sl.add(bb, g);
    };
    for (const [dx, dz] of [[-S, -S], [S, -S], [S, S], [-S, S]]) b.add(m.lattice, box(0.34, TH, 0.34, tx + dx, TH / 2, tz + dz));
    this.col(tx, TH / 2, tz, S + 0.2, TH / 2, S + 0.2);
    for (let y = 0; y < TH - 2; y += 3.2) {
      for (const [a, c] of [[[-S, -S], [S, -S]], [[S, -S], [S, S]], [[S, S], [-S, S]], [[-S, S], [-S, -S]]] as [number[], number[]][]) {
        b.add(m.lattice, beam(V(tx + a[0], y, tz + a[1]), V(tx + c[0], y + 3.2, tz + c[1]), 0.07, 4));
        b.add(m.lattice, beam(V(tx + a[0], y + 3.2, tz + a[1]), V(tx + c[0], y + 3.2, tz + c[1]), 0.08, 4));
      }
    }
    b.add(m.darkC, box(5, 1.2, 5, tx, 0.6, tz));
    for (const [dz, droop] of [[-2.2, 0], [2.2, 0.16]] as [number, number][]) {
      const a0 = V(tx - S, 31, tz + dz * 0.4), a1 = V(cx + R + 0.6, 31 - droop * 6, cz + dz);
      b.add(m.orange, beam(a0, a1, 0.4, 6));
      b.add(m.orange, beam(a0.clone().setY(a0.y + 1.1), a1.clone().setY(a1.y + 0.9), 0.18, 6));
      for (let t = 0.15; t < 1; t += 0.2) {
        const p = a0.clone().lerp(a1, t);
        b.add(m.orange, beam(p, p.clone().setY(p.y + 1 - t * 0.2), 0.08, 4));
      }
    }
    b.add(m.black, box(2.2, 2.4, 2.2, tx, TH + 1.2, tz));
    // aviation lights up the tower and on the nose; they blink
    avi2(b, cyl(0.16, 0.16, 0.25, tx, TH + 2.5, tz, 8));
    for (const y of [16, 31]) this.halos.add(this.w(tx + S + 0.2, y, tz), '#ff2a14', 2.4, ApexBuilder.CH.BLINK, 2.5);
    // the top light is the one you see from Dry Creek at night
    this.halos.add(this.w(tx, TH + 2.6, tz), '#ff2a14', 6, ApexBuilder.CH.BLINK, 3);
    this.points.rocket = this.w(cx, 3, cz + 5);

    // a portable stair and fuel lines to the pedestal
    b.add(m.yellow, place(new THREE.BoxGeometry(1.2, 0.12, 4.6), cx - 6.2, 1.2, cz + 3, -0.5));
    for (const sx of [-0.6, 0.6]) b.add(m.yellow, box(0.08, 2.4, 0.08, cx - 6.2 + sx, 1.2, cz + 4.9));
    b.add(m.rubber, wire(V(cx + 4.5, 0.2, cz + 4.6), V(tx - 1.2, 0.4, tz + 2), 0.1, 0.12, 12));
    b.add(m.rubber, wire(V(tx - S, 8, tz + 0.6), V(cx + 2.2, 7.4, cz + 0.6), 0.5, 0.09, 12));
  }

  // ------------------------------------------------------------------ the hangar
  private buildHangar(b: MeshBatch, m: ReturnType<ApexBuilder['mats']>) {
    const Hg = APEX_HANGAR, { x0, x1, z0, z1, h, rise } = Hg;
    const cx = (x0 + x1) / 2, span = x1 - x0;
    // floor (polished, darker than the apron) and walls
    b.add(m.darkC, box(span, 0.14, z1 - z0, cx, 0.07, (z0 + z1) / 2));
    this.wall(b, m.side, x0 - 0.2, x0, z0, z1, h);
    this.wall(b, m.side, x1, x1 + 0.2, z0, z1, h);
    // standing-seam battens outside, a plinth, so the stainless reads as panels and not as a sheet
    for (let z = z0 + 1; z < z1; z += 2) b.add(m.batten, box(0.06, h, 0.08, x0 - 0.23, h / 2, z), box(0.06, h, 0.08, x1 + 0.23, h / 2, z));
    for (const x of [x0 + 1, x0 + 3, x0 + 5, x0 + 7, x1 - 1, x1 - 3, x1 - 5, x1 - 7]) b.add(m.batten, box(0.08, h, 0.06, x, h / 2, z1 + 0.03));
    b.add(m.darkC, box(Hg.doorX0 - x0 + 0.3, 0.5, 0.3, (x0 + Hg.doorX0) / 2 - 0.15, 0.25, z1 + 0.05), box(x1 - Hg.doorX1 + 0.3, 0.5, 0.3, (x1 + Hg.doorX1) / 2 + 0.15, 0.25, z1 + 0.05), box(0.3, 0.5, z1 - z0, x0 - 0.25, 0.25, (z0 + z1) / 2), box(0.3, 0.5, z1 - z0, x1 + 0.25, 0.25, (z0 + z1) / 2));
    // front: two walls beside the door, a lintel over it
    this.wall(b, m.side, x0, Hg.doorX0, z1 - 0.2, z1, h);
    this.wall(b, m.side, Hg.doorX1, x1, z1 - 0.2, z1, h);
    b.add(m.side, box(Hg.doorX1 - Hg.doorX0, h - Hg.doorH, 0.2, (Hg.doorX0 + Hg.doorX1) / 2, Hg.doorH + (h - Hg.doorH) / 2, z1 - 0.1));
    // back: the shared wall with the vault block (airlock opening x −11…−9, 2.6 m)
    this.wall(b, m.wallC, x0, -11, z0 - 0.2, z0, h);
    this.wall(b, m.wallC, -9, x1, z0 - 0.2, z0, h);
    b.add(m.wallC, box(2, h - 2.6, 0.2, -10, 2.6 + (h - 2.6) / 2, z0 - 0.1));
    // the barrel roof, its gable ends, ribs and a skylight strip
    const arch = (y0: number) => {
      const s = new THREE.Shape();
      s.moveTo(-span / 2, 0);
      for (let i = 0; i <= 24; i++) { const a = Math.PI - (i / 24) * Math.PI; s.lineTo(Math.cos(a) * span / 2, Math.sin(a) * rise); }
      s.lineTo(span / 2, 0);
      return new THREE.ShapeGeometry(s, 1).translate(cx, y0, 0);
    };
    // the back gable is the vault block's concrete carried up under the arch; the front is cladding
    for (const [z, mat] of [[z0 - 0.1, m.wallC], [z1 - 0.1, m.side]] as [number, THREE.Material][]) b.add(mat, arch(h).translate(0, 0, z), arch(h).rotateY(Math.PI).translate(2 * cx, 0, z));
    const roofG = new THREE.CylinderGeometry(1, 1, z1 - z0 + 0.6, 40, 1, true, -Math.PI / 2, Math.PI);
    roofG.rotateX(-Math.PI / 2);
    roofG.scale(span / 2 + 0.15, rise + 0.1, 1);
    const linerG = roofG.clone();
    b.add(m.roof, place(roofG, cx, h, (z0 + z1) / 2));
    b.add(m.liner, place(linerG, cx, h, (z0 + z1) / 2, 0, 0, 0, 0.985, 0.97, 1));
    for (let z = z0 + 2; z < z1; z += 4) {
      const rib = new THREE.TorusGeometry(1, 0.012, 4, 40, Math.PI);
      rib.scale(span / 2 - 0.1, rise - 0.1, 1);
      b.add(m.lattice, place(rib, cx, h, z));
    }
    // a gutter, the wordmark on the arch over the door, and the scoreboard beside it
    b.add(m.brushed, box(span + 0.6, 0.18, 0.3, cx, h, z1 + 0.05));
    b.add(m.print, apexPrint('logo', 8, 1.75, M(cx, h + 4.15, z1 + 0.02)));
    b.add(m.print, apexPrint('board', 5.4, 0.9, M(-17.6, 5.2, z1 + 0.02)));

    // the sliding door: two leaves outside the front wall, on a track
    const leaf = (bb: MeshBatch, w: number) => {
      bb.add(m.side, box(w, Hg.doorH, 0.14, w / 2, Hg.doorH / 2, 0));
      for (let y = 1; y < Hg.doorH; y += 1.25) bb.add(m.brushed, box(w, 0.08, 0.04, w / 2, y, 0.09));
      bb.add(m.yellow, box(w, 0.25, 0.04, w / 2, 0.15, 0.09));
    };
    const zf = z1 + 0.22;
    const L = this.door('hangarL', Hg.doorX0, -10, zf, Hg.doorH, 'slide', -4.1, leaf);
    this.door('hangarR', -10, Hg.doorX1, zf + 0.2, Hg.doorH, 'slide', 4.1, leaf);
    b.add(m.lattice, box(17, 0.22, 0.4, -10, Hg.doorH + 0.1, z1 + 0.32));
    // the padlock on the hasp between the leaves (gone once the door's open)
    const lock = new THREE.Group();
    const lb = new MeshBatch();
    lb.add(m.brushed, box(0.14, 0.18, 0.06, 0, 0, 0), place(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), 0, 0.09, 0));
    lb.add(m.black, box(0.36, 0.08, 0.05, 0, 0.18, -0.03));
    lock.add(lb.build('apexLock'));
    lock.position.set(-10, 1.2, zf + 0.34);
    this.group.add(lock);
    this.lockMeshes.hangar = lock;
    void L;
    this.points.hangar = this.w(-10, 1.2, z1 + 1.1);
    // the intercom post beside the door
    b.add(m.black, box(0.12, 1.3, 0.12, -4.4, 0.65, 15.4));
    b.add(m.white, box(0.34, 0.5, 0.16, -4.4, 1.35, 15.48));
    this.pal.slot('#58b8ff', 2.5).add(b, box(0.08, 0.08, 0.02, -4.4, 1.5, 15.57));
    b.add(m.black, place(new THREE.CircleGeometry(0.09, 12), -4.4, 1.28, 15.57));

    // her feed, over the door, and the launch clock above the lintel
    this.feed = new LiveScreen(1024, 320, () => {});
    const feedMesh = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.6), this.feed.material);
    feedMesh.position.set(-10, 8.25, z1 + 0.13);
    b.add(m.black, box(8.8, 3.0, 0.2, -10, 8.25, z1 - 0.02));
    this.group.add(feedMesh);
    this.clock = new LiveScreen(256, 64, () => {});
    const clockOut = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), this.clock.material);
    clockOut.position.set(-10, 6.5, z1 + 0.1);
    b.add(m.black, box(2.6, 0.74, 0.12, -10, 6.5, z1 + 0.0));
    this.group.add(clockOut);
    const clockIn = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), this.clock.material);
    clockIn.position.set(-10, 3.05, z0 + 0.1);
    b.add(m.black, box(1.76, 0.52, 0.1, -10, 3.05, z0 + 0.02));
    this.group.add(clockIn);
    // the apron camera over the door (the cameras' first eye)
    this.camera('cam_apron', b, m, -3.2, 7.6, z1 + 0.35, 0, 0.75, 9, 20, 28);
    this.camera('cam_hangar', b, m, 1.2, 6.0, -4.6, -1.64, 0.42, 7, 18, 26);
    this.points.camHangar = this.w(1.2, 6.0, -4.6);

    // --- inside: insulated liner panels (the cladding is a mirror; inside it would glare)
    const lin = plainStandard('#8b9095', 0.78, 0.15);
    b.add(lin, box(0.06, h - 0.6, z1 - z0 - 0.4, x0 + 0.05, (h - 0.6) / 2 + 0.3, (z0 + z1) / 2), box(0.06, h - 0.6, z1 - z0 - 0.4, x1 - 0.05, (h - 0.6) / 2 + 0.3, (z0 + z1) / 2));
    b.add(lin, box(Hg.doorX0 - x0 - 0.2, h - 0.6, 0.06, (x0 + Hg.doorX0) / 2, (h - 0.6) / 2 + 0.3, z1 - 0.25), box(x1 - Hg.doorX1 - 0.2, h - 0.6, 0.06, (x1 + Hg.doorX1) / 2, (h - 0.6) / 2 + 0.3, z1 - 0.25));
    for (let z = z0 + 2; z < z1; z += 4) b.add(m.black, box(0.08, h - 0.6, 0.06, x0 + 0.09, (h - 0.6) / 2 + 0.3, z), box(0.08, h - 0.6, 0.06, x1 - 0.09, (h - 0.6) / 2 + 0.3, z));
    // --- inside: the battery wall along the west side
    const leds = this.pal.slot('#3cff7a', 2.4);
    for (let i = 0; i < 7; i++) {
      const z = z0 + 2.5 + i * 1.6;
      b.add(m.white, box(0.9, 2.3, 1.45, x0 + 0.6, 1.15, z));
      b.add(m.black, box(0.02, 1.6, 1.0, x0 + 1.06, 1.3, z));
      leds.add(b, box(0.02, 0.05, 0.6, x0 + 1.07, 2.05, z));
    }
    this.col(x0 + 0.6, 1.15, z0 + 7.3, 0.45, 1.15, 5.7);
    // the demo habitat: a white pod on legs with a porthole, MARS HAB 1 (a tent inside)
    const hx = -17, hz = 9.2;
    b.add(m.white, place(new THREE.SphereGeometry(2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hx, 0.6, hz, 0, 0, 0, 1, 0.85, 1));
    b.add(m.white, cyl(2.1, 2.1, 0.6, hx, 0.3, hz, 24));
    b.add(m.glass, place(new THREE.CircleGeometry(0.45, 16), hx + 1.2, 1.4, hz + 1.55, 0, 0.66, 0));
    b.add(m.print, apexPrint('pMars', 0.8, 1.2, M(hx - 1.2, 1.3, hz + 1.66, -0.62)));
    this.col(hx, 1, hz, 2.1, 1, 2.1);
    // launch-control desk facing the airlock, with three monitors (her mission control is a desk)
    const scr = this.pal.slot('#9fd4ff', 1.8);
    this.slots.screens = scr.intensity;
    b.add(m.white, box(4.2, 0.08, 1.1, -3.5, 0.95, 2));
    b.add(m.black, box(0.08, 0.95, 1.0, -5.5, 0.47, 2), box(0.08, 0.95, 1.0, -1.5, 0.47, 2));
    for (const [x, r] of [[-4.8, 0.25], [-3.5, 0], [-2.2, -0.25]] as [number, number][]) {
      b.add(m.black, box(1.1, 0.7, 0.06, x, 1.45, 1.7, r));
      scr.add(b, box(1.0, 0.6, 0.01, x - Math.sin(r) * 0.04, 1.45, 1.66, r));
    }
    this.col(-3.5, 0.5, 2, 2.1, 0.5, 0.55);
    b.add(m.black, cyl(0.25, 0.3, 0.5, -3.5, 0.25, 3.1, 10), box(0.6, 0.08, 0.6, -3.5, 0.55, 3.1), box(0.6, 0.7, 0.08, -3.5, 0.95, 3.4));
    // an engine on a transport stand, crates, the posters, a tag the camps left
    b.add(m.yellow, box(2.2, 0.5, 3.2, -1.8, 0.4, 9.5));
    b.add(m.black, place(new THREE.CylinderGeometry(0.45, 1.05, 2.4, 20, 1, true), -1.8, 1.9, 9.5, Math.PI / 2));
    b.add(m.brushed, cyl(0.55, 0.45, 1.1, -1.8, 1.9, 7.8, 16, Math.PI / 2), place(new THREE.TorusGeometry(0.62, 0.08, 8, 20), -1.8, 1.9, 8.4));
    this.col(-1.8, 1, 9.5, 1.1, 1, 1.6);
    for (const [x, z, s] of [[-20.6, 0.5, 1.1], [-19.4, 0.4, 0.8], [-20.4, 1.7, 0.7], [-6.5, -4.8, 1], [-5.3, -4.9, 0.9]] as V3[]) {
      b.add(m.crate, box(s, s * 0.8, s, x, s * 0.4, z));
    }
    this.col(-20.2, 0.5, 0.9, 1, 0.5, 1);
    this.col(-5.9, 0.45, -4.85, 1.1, 0.45, 0.55);
    const posters: [string, number, number][] = [['pFree', -19, 0], ['pPart', -16.2, 0], ['pHard', -6.4, 0], ['pPoll', -3, 0], ['pStonks', 0.4, 0]];
    this.meme = new LiveScreen(256, 384, () => {});
    this.meme.glow.value = 1.1;
    const memeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.95), this.meme.material);
    memeMesh.position.set(-13.3, 2.3, z0 + 0.1);
    b.add(m.black, box(1.46, 2.12, 0.08, -13.3, 2.3, z0 + 0.04));
    this.group.add(memeMesh);
    for (const [n, x] of posters) b.add(m.print, apexPrint(n, 1.4, 2.1, M(x, 2.2, z0 + 0.02)));
    b.add(m.print, apexPrint('pLaunch', 1.4, 2.1, M(x1 - 0.02, 2.2, 7.5, -Math.PI / 2)));
    b.add(m.print, apexPrint('pHR', 1.4, 2.1, M(x1 - 0.02, 2.2, 4.5, -Math.PI / 2)));
    b.add(m.print, apexPrint('tag', 4.2, 1.3, M(x1 + 0.22, 2.0, 6, Math.PI / 2)));
    b.add(m.print, apexPrint('chevron', 2, 1, M(-10, 0.15, -3.5, Math.PI / 2, -Math.PI / 2)));
    b.add(m.print, apexPrint('stripes', 2.4, 0.35, M(-10, 2.78, z0 + 0.03)));
    // the camps' water, stacked like inventory: pallets of blue jugs with the camps' names stencilled
    // on the wrap ("community contribution"), and a spare nose cone on a cradle she calls the backup
    const jug = plainStandard('#4f9ccf', 0.3, 0);
    for (const [px, pz] of [[-19.6, 4.2], [-19.6, 6.4], [-17.4, 4.2]] as [number, number][]) {
      b.add(m.crate, box(1.2, 0.14, 1.0, px, 0.21, pz));
      const layers = px === -17.4 ? 2 : 3;
      for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) b.add(jug, cyl(0.17, 0.17, 0.46, px - 0.38 + i * 0.38, 0.52 + l * 0.48, pz - 0.22 + k * 0.44, 10));
      b.add(m.tarp, box(1.24, 0.04, 1.04, px, 0.28 + layers * 0.48, pz));
      this.col(px, 0.75, pz, 0.6, 0.75, 0.5);
    }
    b.add(m.print, apexPrint('pFree', 0.7, 1.05, M(-18.5, 1.5, 7.05)));
    const nx = -13.5, nz = 2.6;
    b.add(m.yellow, box(0.3, 0.9, 3.6, nx - 1.2, 0.45, nz), box(0.3, 0.9, 3.6, nx + 1.2, 0.45, nz));
    // lying on its side, tip to the door, the open base capped with a soot-black bulkhead
    b.add(m.brushed, place(new THREE.SphereGeometry(1.4, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), nx, 1.45, nz - 1.2, Math.PI / 2, 0, 0, 1, 2.8, 1));
    b.add(m.soot, place(new THREE.CircleGeometry(1.4, 28), nx, 1.45, nz - 1.21, 0, Math.PI, 0));
    b.add(m.brushed, place(new THREE.TorusGeometry(1.4, 0.05, 6, 28), nx, 1.45, nz - 1.2));
    this.col(nx, 1.2, nz + 1.6, 1.6, 1.2, 1.9);
    // a scissor lift parked under the arch, raised, nobody on it
    const lx = -6.2, lz = 5.4;
    b.add(m.orange, box(1.2, 0.35, 2.4, lx, 0.35, lz), box(1.3, 0.12, 2.6, lx, 3.2, lz));
    for (const sx of [-0.55, 0.55]) for (let k = 0; k < 4; k++) {
      const y0 = 0.5 + k * 0.68, y1 = y0 + 0.68;
      b.add(m.black, beam(V(lx + sx, y0, lz - 0.9), V(lx + sx, y1, lz + 0.9), 0.04, 4), beam(V(lx + sx, y0, lz + 0.9), V(lx + sx, y1, lz - 0.9), 0.04, 4));
    }
    for (const [ax, az] of [[-0.6, -1.25], [0.6, -1.25], [-0.6, 1.25], [0.6, 1.25]]) b.add(m.yellow, box(0.04, 1, 0.04, lx + ax, 3.7, lz + az));
    this.col(lx, 0.6, lz, 0.6, 0.6, 1.2);
    // high-bay lamps and strip lights under the arch
    const strip = this.pal.slot('#fff2dc', 5);
    this.slots.strip = strip.intensity;
    for (const lx of [-16, -10, -4]) {
      for (const lz of [-1, 5, 11]) {
        b.add(m.black, box(0.3, 0.12, 2.2, lx, h + 2.6, lz));
        strip.add(b, box(0.22, 0.02, 2.0, lx, h + 2.53, lz));
      }
      b.add(m.lattice, box(0.04, 2.6, 0.04, lx, h + 3.9, -1), box(0.04, 2.6, 0.04, lx, h + 3.9, 11));
    }
    this.halos.add(this.w(-10, 2.9, z0 + 0.3), '#ff3020', 0.9, ApexBuilder.CH.ALARM, 2);
    // alarm beacons over the airlock and on the mast
    const beaconSlot = this.pal.slot('#ff2a14', 6);
    this.slots.beacon = beaconSlot.intensity;
    for (const [x, y, z] of [[-11.6, 3.3, z0 + 0.3], [-25, 11.9, 18]] as V3[]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const bb = new MeshBatch();
      beaconSlot.add(bb, cyl(0.12, 0.12, 0.22, 0, 0, 0, 10), box(0.05, 0.16, 0.5, 0, 0, 0.18));
      pivot.add(bb.build('apexBeacon'));
      pivot.visible = false;
      this.group.add(pivot);
      this.beacons.push(pivot);
    }
  }

  /** A sweeping security camera (the runtime yaws `pivot`; its body looks down +z). */
  private camera(id: string, b: MeshBatch, m: ReturnType<ApexBuilder['mats']>, x: number, y: number, z: number, yaw0: number, sweep: number, period: number, range: number, halfDeg: number, parent: THREE.Object3D = this.group) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const lens = this.pal.slot('#ff3020', 1);
    const cb = new MeshBatch();
    cb.add(m.white, box(0.24, 0.22, 0.5, 0, 0, 0.12));
    cb.add(m.black, box(0.14, 0.14, 0.04, 0, 0, 0.38));
    lens.add(cb, box(0.05, 0.05, 0.02, 0.06, 0.06, 0.4));
    pivot.add(cb.build(`apexCam:${id}`));
    parent.add(pivot);
    b.add(m.black, cyl(0.04, 0.04, 0.3, x, y + 0.2, z, 6));
    this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3), yaw0, sweep, period, range, halfAngle: THREE.MathUtils.degToRad(halfDeg), lens: lens.intensity });
  }

  // ------------------------------------------------------------------ the vault block (sealed inside)
  private buildBlock(b: MeshBatch, d: MeshBatch, m: ReturnType<ApexBuilder['mats']>) {
    const B = APEX_BLOCK;
    const { x0, x1, z0, z1, cx0, cx1, vaultZ, innerZ, hall, room } = B;
    // outer retaining walls (the front one is the hangar's back wall)
    this.wall(b, m.wallC, x0 - 0.3, x0, z0, z1, room + 0.6);
    // (the east wall has the vent duct's mouth in it, at z −18.1…−16.9, 1.2 m high)
    const V0 = -18.1, V1 = -16.9, VH = 1.2;
    this.wall(b, m.wallC, x1, x1 + 0.3, z0, V0, room + 0.6);
    this.wall(b, m.wallC, x1, x1 + 0.3, V1, z1, room + 0.6);
    this.wall(b, m.wallC, x1, x1 + 0.3, V0, V1, room + 0.6 - VH, VH);
    this.wall(b, m.wallC, x0 - 0.3, x1 + 0.3, z0 - 0.3, z0, room + 0.6);
    // the corridor's walls (the plant rooms either side are solid), its roof, the room's roof
    this.wall(b, m.wallC, x0, cx0, vaultZ, z1 - 0.2, room + 0.6);
    this.wall(b, m.wallC, cx1, x1, vaultZ, V0, room + 0.6);
    this.wall(b, m.wallC, cx1, x1, V1, z1 - 0.2, room + 0.6);
    this.wall(b, m.wallC, cx1, x1, V0, V1, room + 0.6 - VH, VH);
    this.buildVent(b, d, m, V0, V1, VH);
    b.add(m.wallC, box(cx1 - cx0, room + 0.6 - hall, z1 - vaultZ, (cx0 + cx1) / 2, hall + (room + 0.6 - hall) / 2, (vaultZ + z1) / 2 - 0.1));
    b.add(m.wallC, box(x1 - x0 + 0.6, 0.6, vaultZ - z0 + 0.3, (x0 + x1) / 2, room + 0.3, (z0 + vaultZ) / 2 - 0.15));
    d.add(m.darkC, box(cx1 - cx0, 0.1, z1 - vaultZ, (cx0 + cx1) / 2, 0.05, (vaultZ + z1) / 2));
    d.add(m.darkC, box(x1 - x0, 0.1, vaultZ - z0, (x0 + x1) / 2, 0.05, (z0 + vaultZ) / 2));
    // the block's outside: pilasters, her wordmark, a pipe run, an HVAC unit by the vent, a lamp over it
    for (let z = z0 + 2; z < z1 - 1; z += 4) {
      // (gaps for the vent and for the two wordmarks)
      if (Math.abs(z + 17.5) > 1.2 && Math.abs(z + 27.5) > 4) b.add(m.wallC, box(0.4, room + 0.6, 0.7, x1 + 0.5, (room + 0.6) / 2, z));
      if (Math.abs(z + 21) > 4) b.add(m.wallC, box(0.4, room + 0.6, 0.7, x0 - 0.5, (room + 0.6) / 2, z));
    }
    b.add(m.print, apexPrint('logo', 7, 1.55, M(x1 + 0.32, 4.6, -27.5, Math.PI / 2)));
    b.add(m.print, apexPrint('logo', 7, 1.55, M(x0 - 0.32, 4.6, -21, -Math.PI / 2)));
    b.add(m.brushed, beam(V(x1 + 0.45, 5.7, z0 + 1), V(x1 + 0.45, 5.7, z1 - 0.5), 0.14, 8), beam(V(x1 + 0.45, 5.3, z0 + 1), V(x1 + 0.45, 5.3, z1 - 0.5), 0.09, 8));
    b.add(m.white, box(1.3, 1.6, 2.2, x1 + 1.0, 0.8, -22.5));
    b.add(m.black, place(new THREE.CircleGeometry(0.5, 20), x1 + 1.66, 1.0, -22.5, 0, Math.PI / 2, 0));
    b.add(m.brushed, place(new THREE.TorusGeometry(0.5, 0.04, 6, 20), x1 + 1.67, 1.0, -22.5, 0, Math.PI / 2, 0));
    for (let k = 0; k < 4; k++) b.add(m.brushed, place(new THREE.BoxGeometry(0.02, 0.9, 0.06), x1 + 1.68, 1.0, -22.5, (k * Math.PI) / 4, Math.PI / 2, 0));
    this.col(x1 + 1.0, 0.8, -22.5, 0.65, 0.8, 1.1);
    b.add(m.black, box(0.3, 0.2, 0.5, x1 + 0.45, 2.3, -17.5));
    this.pal.slot('#fff1d0', 3).add(b, box(0.02, 0.12, 0.4, x1 + 0.61, 2.24, -17.5));
    // the earth cap over the whole block, rocks bedded in it, solar on its back, a dish on top
    const cap = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add(m.rock, place(cap, (x0 + x1) / 2, room + 0.5, (z0 + z1) / 2 - 1.5, 0, 0, 0, 9.6, 4.6, 15.4));
    for (const [x, z, s, y] of [[-17, -10, 1.6, 6.4], [-3, -14, 1.9, 6.6], [-15, -30, 2.2, 7], [-6, -33, 1.5, 6.6], [-19, -22, 1.3, 6]] as [number, number, number, number][]) {
      b.add(m.rock, place(rockGeometry(x * 7 + z, 1), x, y, z, 0, x, 0, s));
    }
    for (let i = 0; i < 5; i++) {
      const z = -18 - i * 3;
      b.add(m.panel, place(new THREE.BoxGeometry(5.5, 0.05, 1.8), -10, 10.2 - i * 0.55, z, 0.3));
    }
    b.add(m.lattice, cyl(0.1, 0.1, 4, -6, 12, -12, 6));
    b.add(m.white, place(new THREE.SphereGeometry(1.4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), -6, 14, -12, -1.1, 0.4, 0));

    // the airlock: outer door in the hangar wall, inner door at innerZ; the chamber between
    const slider = (bb: MeshBatch, w: number) => {
      bb.add(m.steel, box(w, 2.6, 0.12, w / 2, 1.3, 0));
      bb.add(m.yellow, box(w, 0.12, 0.14, w / 2, 2.0, 0));
      bb.add(m.black, box(0.4, 0.4, 0.14, w / 2, 1.5, 0.01));
    };
    this.door('airlockOut', -11, -9, z1 - 0.05, 2.6, 'slide', -2.05, slider);
    this.wall(b, m.wallC, cx0, -11, innerZ - 0.15, innerZ + 0.15, hall);
    this.wall(b, m.wallC, -9, cx1, innerZ - 0.15, innerZ + 0.15, hall);
    b.add(m.wallC, box(2, hall - 2.6, 0.3, -10, 2.6 + (hall - 2.6) / 2, innerZ));
    this.door('airlockIn', -11, -9, innerZ + 0.2, 2.6, 'slide', 2.05, slider, this.interior);
    // the keypad beside the outer door (hangar side)
    b.add(m.black, box(0.3, 0.42, 0.08, -8.3, 1.35, z1 + 0.06));
    const pad = this.pal.slot('#58ff9a', 2);
    this.slots.keypad = pad.intensity;
    pad.add(b, box(0.2, 0.08, 0.02, -8.3, 1.48, z1 + 0.11));
    this.points.airlock = this.w(-10, 1.2, z1 + 0.9);
    this.points.interior = this.w(-10, 1, -15);
    // airlock chamber: vents, a decon shower head, the countdown stencil
    d.add(m.brushed, box(0.6, 0.06, 0.6, -10, hall - 0.05, -7.8));
    d.add(m.print, apexPrint('corridor', 3.6, 0.45, M(-10, 3.4, innerZ - 0.17, Math.PI)));
    d.add(m.print, apexPrint('corridor', 3.6, 0.45, M(-10, 3.1, innerZ + 0.17)));

    // the corridor: chevrons, T-minus stencils, pipe runs, cable trays, strip lights
    const hallStrip = this.pal.slot('#d8ecff', 4);
    this.slots.hallStrip = hallStrip.intensity;
    for (let z = innerZ - 1.5; z > vaultZ + 0.5; z -= 3.4) d.add(m.print, apexPrint('chevron', 2.2, 1.1, M(-10, 0.11, z, -Math.PI / 2, -Math.PI / 2)));
    d.add(m.print, apexPrint('tminus', 3.6, 1.2, M(-10, 0.115, -21.6, Math.PI, -Math.PI / 2)));
    for (const x of [cx0 + 0.18, cx1 - 0.18]) {
      d.add(m.brushed, beam(V(x, 3.4, innerZ - 0.2), V(x, 3.4, vaultZ + 0.2), 0.09, 8));
      d.add(m.red, beam(V(x, 3.1, innerZ - 0.2), V(x, 3.1, vaultZ + 0.2), 0.06, 8));
      d.add(m.black, box(0.3, 0.06, -vaultZ + innerZ - 0.4, x + (x < -10 ? 0.12 : -0.12), 3.75, (innerZ + vaultZ) / 2));
    }
    for (let z = innerZ - 1; z > vaultZ; z -= 2.5) {
      d.add(m.black, box(0.25, 0.08, 1.4, -10, hall - 0.06, z));
      hallStrip.add(d, box(0.18, 0.02, 1.3, -10, hall - 0.11, z));
    }
    d.add(m.print, apexPrint('pPart', 1, 1.5, M(cx1 - 0.02, 1.8, -14.6, -Math.PI / 2)));
    d.add(m.print, apexPrint('pHard', 1, 1.5, M(cx0 + 0.02, 1.8, -18.2, Math.PI / 2)));
    // lasers: two low beams (jump) and a high one (crouch) across the corridor
    const beamAt = (id: string, y: number, z: number) => {
      const u = uniform(7);
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      mat.colorNode = vec3(1, 0.06, 0.03).mul(u).mul(0.16);
      const g = new THREE.CylinderGeometry(0.018, 0.018, cx1 - cx0 - 0.3, 6, 1, true).rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(-10, y, z);
      this.interior.add(mesh);
      for (const x of [cx0 + 0.08, cx1 - 0.08]) d.add(m.black, box(0.14, 0.2, 0.14, x, y, z));
      this.lasers.push({ id, a: this.w(cx0 + 0.15, y, z), b: this.w(cx1 - 0.15, y, z), mesh, intensity: u as unknown as { value: number } });
    };
    beamAt('laser_low', 0.35, -13);
    beamAt('laser_high', 1.45, -16.5);
    beamAt('laser_low2', 0.35, -20);
    // the breaker on the west wall, before the first beam
    d.add(m.white, box(0.18, 1.1, 0.8, cx0 + 0.1, 1.45, -11.2));
    d.add(m.black, box(0.04, 0.5, 0.12, cx0 + 0.21, 1.45, -11.0));
    d.add(m.print, apexPrint('stripes', 0.8, 0.18, M(cx0 + 0.2, 2.06, -11.2, Math.PI / 2)));
    this.points.breaker = this.w(cx0 + 0.7, 1.4, -11.2);
    // down the corridor, sweeping across it: hug the far wall while it looks the other way
    this.camera('cam_hall', d, m, cx1 - 0.35, 3.3, innerZ - 0.6, Math.PI, 0.45, 8, 14, 12, this.interior);

    // the vault wall and its door (a slab with a wheel), hinged on the west side
    this.wall(b, m.wallC, cx0, -11.2, vaultZ - 0.3, vaultZ, hall);
    this.wall(b, m.wallC, -8.8, cx1, vaultZ - 0.3, vaultZ, hall);
    b.add(m.wallC, box(2.4, hall - 2.6, 0.3, -10, 2.6 + (hall - 2.6) / 2, vaultZ - 0.15));
    d.add(m.steel, place(new THREE.TorusGeometry(1.45, 0.16, 8, 32), -10, 1.3, vaultZ + 0.05, 0, 0, 0, 1, 1.05, 1));
    this.door('vault', -11.2, -8.8, vaultZ - 0.15, 2.6, 'y', 1.75, (bb, w) => {
      bb.add(m.steel, box(w, 2.6, 0.32, w / 2, 1.3, 0));
      bb.add(m.brushed, place(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 28), w / 2, 1.3, 0.2, Math.PI / 2));
      bb.add(m.black, place(new THREE.TorusGeometry(0.42, 0.045, 8, 20), w / 2, 1.3, 0.3));
      for (let i = 0; i < 4; i++) bb.add(m.black, place(new THREE.BoxGeometry(0.9, 0.06, 0.06), w / 2, 1.3, 0.3, 0, 0, (i * Math.PI) / 4));
      for (const y of [0.4, 2.2]) bb.add(m.lattice, box(0.3, 0.3, 0.4, 0.1, y, 0));
    }, this.interior);
    this.points.vaultDoor = this.w(-10, 1.2, vaultZ + 0.8);

    // --- the Cistern Room
    const tx = -10, tz = -30.5, TR = 3.3, TH = 4.8;
    d.add(m.steel, cyl(TR, TR, TH, tx, TH / 2 + 0.1, tz, 36));
    d.add(m.steel, place(new THREE.SphereGeometry(TR, 36, 8, 0, Math.PI * 2, 0, Math.PI / 2), tx, TH + 0.1, tz, 0, 0, 0, 1, 0.18, 1));
    for (const y of [0.6, 1.8, 3.0, 4.2]) d.add(m.brushed, cyl(TR + 0.04, TR + 0.04, 0.1, tx, y, tz, 36));
    this.physics.addBox(this.w(tx, TH / 2, tz), { x: TR * 0.92, y: TH / 2, z: TR * 0.92 });
    d.add(m.print, apexPrint('cistern', 4.6, 0.58, M(tx, 3.6, tz + TR + 0.06)));
    d.add(m.print, apexPrint('logo', 3, 0.66, M(tx, 2.7, tz + TR + 0.06)));
    // the tap, a level gauge, pipes into the walls, a ladder
    d.add(m.brushed, cyl(0.12, 0.12, 0.6, tx + 1.2, 0.9, tz + TR + 0.2, 10, Math.PI / 2));
    d.add(m.red, place(new THREE.TorusGeometry(0.18, 0.03, 6, 14), tx + 1.2, 1.15, tz + TR + 0.45, Math.PI / 2));
    d.add(m.glass, box(0.14, 3.6, 0.06, tx - 1.6, 2.2, tz + TR - 0.1));
    const level = this.pal.slot('#3ab8ff', 2.2);
    level.add(d, box(0.1, 2.3, 0.02, tx - 1.6, 1.55, tz + TR - 0.06));
    for (const [a, b2] of [[V(tx + TR, 4.3, tz), V(-2.1, 4.3, tz)], [V(tx - TR, 0.6, tz), V(-17.9, 0.6, tz)], [V(tx, TH + 0.6, tz), V(tx, 5.95, tz)]] as [THREE.Vector3, THREE.Vector3][]) d.add(m.brushed, beam(a, b2, 0.22, 10));
    for (let y = 0.3; y < TH; y += 0.35) d.add(m.lattice, box(0.5, 0.04, 0.04, tx + 2.3, y, tz + 2.3, -Math.PI / 4));
    for (const sx of [-0.25, 0.25]) d.add(m.lattice, box(0.04, TH, 0.04, tx + 2.3 + sx * 0.7, TH / 2, tz + 2.3 - sx * 0.7));
    // lockers either side, with lids that swing up (loot)
    const locker = (id: string, x: number, z: number, ry: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      const lb = new MeshBatch();
      lb.add(m.white, box(1.6, 0.9, 0.9, 0, 0.45, 0));
      lb.add(m.black, box(1.62, 0.06, 0.92, 0, 0.12, 0));
      g.add(lb.build(`apexLocker:${id}`));
      const lid = new THREE.Group();
      lid.position.set(0, 0.9, -0.45);
      const lidB = new MeshBatch();
      lidB.add(m.white, box(1.62, 0.08, 0.92, 0, 0.04, 0.45));
      lidB.add(m.yellow, box(1.62, 0.02, 0.1, 0, 0.09, 0.85));
      lid.add(lidB.build(`apexLid:${id}`));
      g.add(lid);
      this.interior.add(g);
      this.physics.addBox(this.w(x, 0.45, z), { x: Math.abs(Math.cos(ry)) * 0.8 + Math.abs(Math.sin(ry)) * 0.45, y: 0.45, z: Math.abs(Math.sin(ry)) * 0.8 + Math.abs(Math.cos(ry)) * 0.45 }, 0);
      const front = V(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(1);
      this.lootSpots.push({ id, pos: this.w(x + front.x, 0.8, z + front.z), mesh: g, lid });
    };
    locker('tank_a', -16.6, -26.5, Math.PI / 2);
    locker('tank_b', -3.4, -26.5, -Math.PI / 2);
    // the tap is the cistern "container"
    const tap = new THREE.Group();
    tap.position.set(tx + 1.2, 0, tz + TR + 0.4);
    this.interior.add(tap);
    this.lootSpots.push({ id: 'cistern', pos: this.w(tx + 1.2, 1, tz + TR + 1.1), mesh: tap });
    // her shrine: a framed print of her own first post, a cot, water jugs she's "testing"
    d.add(m.print, apexPrint('pPoll', 1.2, 1.8, M(x1 - 0.32, 2.4, -32.5, -Math.PI / 2)));
    d.add(m.print, apexPrint('pLaunch', 1.2, 1.8, M(x0 + 0.02, 2.4, -32.5, Math.PI / 2)));
    d.add(m.tarp, box(0.9, 0.3, 2.0, -16.8, 0.45, -33.6));
    d.add(m.lattice, box(0.95, 0.06, 2.05, -16.8, 0.28, -33.6));
    for (let i = 0; i < 6; i++) d.add(plainStandard('#5aa6d8', 0.35), cyl(0.16, 0.16, 0.45, -4.2 + (i % 3) * 0.36, 0.23 + Math.floor(i / 3) * 0.46, -34.6, 10));
    d.add(m.print, apexPrint('tag', 3, 0.95, M(-6, 4.4, z0 + 0.02)));
    const roomStrip = this.pal.slot('#bfe8ff', 4.5);
    this.slots.roomStrip = roomStrip.intensity;
    for (const x of [-15, -5]) {
      d.add(m.black, box(0.3, 0.1, 9, x, room - 0.06, -29.5));
      roomStrip.add(d, box(0.22, 0.02, 8.8, x, room - 0.11, -29.5));
    }
    this.halos.add(this.w(-10, room - 0.3, -24.5), '#ff3020', 1, ApexBuilder.CH.ALARM, 2);
  }

  /**
   * The vent: a crawl duct from the hill's east face into the launch corridor, past the first two
   * beams. A padlocked grate outside (the `vent` entry, hinged on its north edge, swinging out).
   */
  private buildVent(b: MeshBatch, d: MeshBatch, m: ReturnType<ApexBuilder['mats']>, z0: number, z1: number, h: number) {
    const x = APEX_BLOCK.x1 + 0.3, zc = (z0 + z1) / 2;
    d.add(m.darkC, box(APEX_BLOCK.x1 - APEX_BLOCK.cx1 + 0.3, 0.06, z1 - z0, (APEX_BLOCK.cx1 + x) / 2, 0.03, zc));
    // the hood round the mouth, a warning stencil, cigarette ends (someone smokes in here)
    b.add(m.brushed, box(0.14, 0.14, z1 - z0 + 0.4, x + 0.07, h + 0.07, zc), box(0.14, h, 0.14, x + 0.07, h / 2, z0 - 0.13), box(0.14, h, 0.14, x + 0.07, h / 2, z1 + 0.13));
    b.add(m.print, apexPrint('stripes', 1.4, 0.22, M(x + 0.15, h + 0.3, zc, Math.PI / 2)));
    for (let i = 0; i < 5; i++) b.add(m.white, cyl(0.012, 0.012, 0.06, x + 0.4 + i * 0.13, 0.03, zc - 0.3 + (i % 3) * 0.22, 5, 0, 0, Math.PI / 2));
    // the grate leaf: bars in a frame, a padlock on the free edge
    const pivot = new THREE.Group();
    pivot.position.set(x + 0.2, 0, z0);
    pivot.userData.x0 = pivot.position.x;
    const lb = new MeshBatch();
    lb.add(m.lattice, box(0.06, 0.06, z1 - z0, 0, 0.05, (z1 - z0) / 2), box(0.06, 0.06, z1 - z0, 0, h - 0.05, (z1 - z0) / 2));
    for (let k = 0; k <= 6; k++) lb.add(m.lattice, box(0.04, h, 0.04, 0, h / 2, 0.02 + k * ((z1 - z0 - 0.04) / 6)));
    lb.add(m.brushed, box(0.08, 0.12, 0.06, 0.06, 0.6, z1 - z0 - 0.08));
    pivot.add(lb.build('apexVentGrate'));
    this.group.add(pivot);
    const pos = this.w(x + 0.2, h / 2, zc), half = V(0.1, h / 2, (z1 - z0) / 2);
    this.doors.vent = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'y', amount: 1.7, colliderSpec: { pos, half } };
    this.points.vent = this.w(x + 0.9, 0.7, zc);
    // the corridor end: the inner grille, kicked out and leaning on the wall
    d.add(m.lattice, place(new THREE.BoxGeometry(0.05, h, z1 - z0), APEX_BLOCK.cx1 + 0.35, h / 2 - 0.05, zc - 1.2, 0, 0.3, 0.25));
  }

  /**
   * The merch drone: a white hexacopter-ish delivery rig (her "free trial" drops came on these) with a
   * crate in a sling. Built at boot and hidden (shaders compile with the scene); Apex flies it.
   */
  private buildDrone() {
    const m = this.mats(), db = new MeshBatch();
    db.add(m.white, place(new THREE.SphereGeometry(0.55, 18, 10), 0, 0, 0, 0, 0, 0, 1, 0.45, 1.3));
    db.add(m.black, box(0.9, 0.08, 0.5, 0, -0.3, 0));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, ax = Math.cos(a) * 1.1, az = Math.sin(a) * 1.1;
      db.add(m.white, beam(V(0, 0, 0), V(ax, 0.05, az), 0.06, 6));
      db.add(m.black, cyl(0.12, 0.12, 0.18, ax, 0.12, az, 10));
      const rotor = new THREE.Group();
      rotor.position.set(ax, 0.24, az);
      const rb = new MeshBatch();
      rb.add(m.black, box(1.0, 0.02, 0.08, 0, 0, 0), box(0.08, 0.02, 1.0, 0, 0, 0));
      rotor.add(rb.build('apexRotor'));
      this.drone.add(rotor);
      this.rotors.push(rotor);
    }
    const blink = this.pal.slot('#58b8ff', 5);
    blink.add(db, box(0.1, 0.06, 0.1, 0, -0.32, 0.5));
    // the sling lines
    for (const [x, z] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) db.add(m.black, beam(V(0, -0.3, 0), V(x, -1.25, z), 0.012, 3));
    this.drone.add(db.build('apexDrone'));
    this.drone.visible = false;
    this.drone.name = 'apex-drone';
    this.group.add(this.drone);
    const cb = new MeshBatch();
    cb.add(m.white, box(0.9, 0.6, 0.7, 0, 0.3, 0));
    cb.add(m.black, box(0.92, 0.06, 0.72, 0, 0.58, 0));
    cb.add(m.print, apexPrint('merch', 0.8, 0.4, M(0, 0.3, 0.36)), apexPrint('merch', 0.8, 0.4, M(0, 0.3, -0.36, Math.PI)));
    this.crate.add(cb.build('apexMerch'));
    this.crate.visible = false;
    this.crate.name = 'apex-merch';
    this.group.add(this.crate);
    this.points.merch = this.w(-3, 0, 21);
  }

  // ------------------------------------------------------------------ the salt: what's stranded on it
  private buildSalt(b: MeshBatch, m: ReturnType<ApexBuilder['mats']>) {
    // relative to Apex's origin: the salt's centre is ~(+40, −46). A Kade water tanker that didn't
    // make the last mile, a stainless pickup's spare (on blocks), a dropped hard hat, bollards.
    const r = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const gy = (x: number, z: number) => this.ground(this.origin.x + x, this.origin.z + z) - this.origin.y;
    const at = (x: number, z: number, yaw: number) => new THREE.Matrix4().compose(V(x, gy(x, z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
    const car = buildCar(b, at(48, -38, 1.1), { kind: 'pickup', paint: '#e6e2d8', rand: r, rust: 0.3, fade: 0.6, broken: 0.6, hood: 'open', wheels: ['flat', 'ok', 'gone', 'flat'] });
    this.physics.addBox(this.w(48, gy(48, -38) + car.center.y, -38), car.half, 1.1);
    const van = buildCar(b, at(28, -62, -0.5), { kind: 'van', paint: '#f2f2f0', rand: r, rust: 0.2, fade: 0.4, broken: 0.9, blocks: true });
    this.physics.addBox(this.w(28, gy(28, -62) + van.center.y, -62), van.half, -0.5);
    // a line of survey bollards walking off into the glare, and a pallet of empty jugs
    for (let i = 0; i < 9; i++) {
      const x = 30 + i * 5.5, z = -20 - i * 4.1;
      const y = gy(x, z);
      b.add(m.orange, cyl(0.06, 0.08, 1.1, x, y + 0.55, z, 6));
      b.add(m.white, cyl(0.065, 0.065, 0.12, x, y + 0.9, z, 6));
    }
    const py = gy(40, -55);
    b.add(m.crate, box(1.2, 0.14, 1.0, 40, py + 0.07, -55));
    for (let i = 0; i < 4; i++) b.add(plainStandard('#5aa6d8', 0.35), cyl(0.16, 0.16, 0.45, 39.7 + (i % 2) * 0.4, py + 0.37, -55.2 + Math.floor(i / 2) * 0.4, 10));
  }

  // ------------------------------------------------------------------ lights (virtual: the pool lends them)
  private buildLights() {
    const L = (c: string, k: number, dist: number, x: number, y: number, z: number) => {
      const v = new VirtualLight(c, k, dist, 1.6);
      v.position.copy(this.w(x, y, z));
      return v;
    };
    this.lights = {
      hangar: [L('#ffe8c8', 0, 20, -15, 9.4, 4), L('#ffe8c8', 0, 20, -5, 9.4, 4)],
      hall: L('#d8ecff', 0, 12, -10, 3.6, -16),
      room: L('#bfe8ff', 0, 16, -10, 4.6, -24.8),
      flood: L('#fff1d0', 0, 34, -24.6, 10, 19),
      // floods the booster from the front at night: it's the monument, she lights it like one
      rocket: L('#ffe2bc', 0, 20, 14, 13, 3.2),
    };
    // the vault's own lights win the pool's slots when you're near them (at night the apron flood and
    // the booster's light outrank a 12-unit corridor lamp, and the corridor went black)
    this.lights.hall.priority = 3;
    this.lights.room.priority = 2;
  }
}
