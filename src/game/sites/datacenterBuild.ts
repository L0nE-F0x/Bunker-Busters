import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import type { Heightfield } from '../world/Heightfield';
import { box, cyl, beam, wire, place, norm, merge, MeshBatch, shadowProxy, type Frame } from '../world/kit';
import { rustyMetal, concrete, corrugated, plainStandard, chainLink, fabric, glow, GlowPalette, type GlowSlot } from '../world/materials';
import { GlowSprites, lightCone } from '../world/effects';
import { VirtualLight } from '../world/lights';
import { buildCar } from '../world/vehicles';
import { surfaces } from '@/engine/surface';
import { dcAtlas } from './datacenterArt';
import { pvMaterial, glassMaterial, flipInside, rng, SplitBatch } from './datacenterAtlas';

/** Site-local layout of ColdStorage (metres; +z faces the access road and the highway beyond). */
export const HALL = { x0: -26, x1: 26, z0: -14, z1: 4, h: 7.3, t: 0.4 };
/** Raised-floor height inside the hall. */
export const FY = 0.45;
/** Server hall interior (the site's heart). */
export const INSIDE = { x0: -25.6, x1: 25.6, z0: -13.6, z1: 3.6 };
export const LOBBY = { x0: -7, x1: 1, z0: 4, z1: 10, h: 4.2, door0: -4, door1: -2 };
export const CORE = { x: 16, x1: 25.6, z0: -13.6, z1: -3.2, d0: -6.2, d1: -4.6, h: 3.4 };
export const CAGE = { x: 16, x1: 25.6, z0: -3.0, z1: 3.6, g0: 0.3, g1: 1.9 };

/** Halo channels (GlowSprites). */
export const CH = { ON: 0, NIGHT: 1, POWER: 2, EMERG: 3, COLD: 4, CORE: 5, MAST: 6, SPARK: 7, READER: 8, BLINK: 9, NBLINK: 6 } as const;

type Col = ReturnType<Physics['addBox']>;

const M = {
  panel: () => concrete('#a9adad', { stains: 0.7 }),
  liner: () => concrete('#3f4346', { scale: 1.3, stains: 0.35 }),
  panelDark: () => concrete('#8e8a82', { stains: 0.9 }),
  slab: () => concrete('#a19b90', { stains: 0.55 }),
  asphalt: () => concrete('#47443f', { scale: 1.6, stains: 0.35 }),
  gravel: () => concrete('#7a7262', { scale: 2.4, stains: 0.25 }),
  ceiling: () => concrete('#34373a', { stains: 0.25 }),
  block: () => concrete('#8f9294', { scale: 1.2, stains: 0.4 }),
  frostC: () => concrete('#c3d1d8', { scale: 2.6, stains: 0.12 }),
  fascia: () => rustyMetal({ base: '#24282b', rust: -0.3, metalness: 0.6, roughness: 0.5 }),
  rack: () => rustyMetal({ base: '#1c1f22', rust: -0.7, metalness: 0.55, roughness: 0.42 }),
  steel: () => rustyMetal({ base: '#5c6266', rust: 0.05 }),
  galv: () => rustyMetal({ base: '#a9aca9', rust: -0.15, metalness: 0.7, roughness: 0.4 }),
  white: () => rustyMetal({ base: '#dad8d0', rust: -0.2, metalness: 0.3, roughness: 0.55 }),
  tank: () => rustyMetal({ base: '#d6d3cb', rust: 0.05, metalness: 0.35, roughness: 0.6, scale: 1.4 }),
  xfmr: () => rustyMetal({ base: '#5d6a55', rust: 0.3, metalness: 0.5 }),
  yellow: () => rustyMetal({ base: '#e2b523', rust: 0.0, metalness: 0.3, roughness: 0.55 }),
  red: () => rustyMetal({ base: '#ad2b1f', rust: 0.05, metalness: 0.4 }),
  blue: () => rustyMetal({ base: '#2c6db0', rust: -0.1, metalness: 0.4 }),
  carSteel: () => rustyMetal({ base: '#9ea3a6', rust: -0.3, metalness: 0.85, roughness: 0.3 }),
  louvre: () => corrugated('#5a615f', 0.35, 'y'),
  roller: () => corrugated('#8f9497', 0.5, 'y'),
  dark: () => plainStandard('#1b1e21', 0.5, 0.4),
  black: () => plainStandard('#0d0e0f', 0.55, 0.3),
  rubber: () => plainStandard('#151413', 0.95),
  ceramic: () => plainStandard('#6e3b25', 0.22, 0.1),
  cyan: () => plainStandard('#1aa3a6', 0.45, 0.2),
  fiber: () => plainStandard('#e6b31a', 0.5, 0.05),
  cable: () => plainStandard('#15171a', 0.6, 0.2),
  desk: () => plainStandard('#cfcabd', 0.6),
  contain: () => plainStandard('#c7d0d3', 0.35, 0.1),
  ice: () => plainStandard('#dcf1fa', 0.1, 0.0),
  carGlass: () => plainStandard('#0b1014', 0.08, 0.6),
  tail: () => plainStandard('#5a0e0c', 0.3),
  orange: () => plainStandard('#d9661f', 0.6),
  couch: () => fabric('#3b5864'),
  cot: () => fabric('#4e5a3c'),
};

export interface DCSlots {
  led: GlowSlot[];
  blue: GlowSlot[];
  amber: GlowSlot;
  red: GlowSlot;
  strip: GlowSlot;
  emerg: GlowSlot;
  cold: GlowSlot;
  coreRack: GlowSlot;
  coreBlue: GlowSlot;
  eye: GlowSlot;
  exit: GlowSlot;
  mast: GlowSlot;
  night: GlowSlot;
  reader: GlowSlot;
  readerOk: GlowSlot;
  spark: GlowSlot;
  ups: GlowSlot;
}

interface Door {
  obj: THREE.Object3D;
  col: Col;
  open: number;
  target: number;
  solid: boolean;
}

/**
 * Builds ColdStorage: the hall (outside and in), the yard, the car park, the fence and the far
 * stand-in. Everything static is one MeshBatch (one draw per material family); painted detail is
 * one atlas; every small light is one GlowPalette; every halo one GlowSprites.
 */
export class ColdStorageBuild {
  readonly root = new THREE.Group();
  readonly near = new THREE.Group();
  readonly far = new THREE.Group();
  readonly halos = new GlowSprites(24);
  readonly pal = new GlowPalette(32);
  readonly slots: DCSlots;
  readonly A = dcAtlas();
  readonly screenOn = this.A.screen('on', 1.1);
  readonly screenPower = this.A.screen('power', 0.05);
  readonly screenAI = this.A.screen('ai', 1.0);
  readonly poolCold = this.A.pool('cold', 0.45);
  readonly poolNight = this.A.pool('night', 0);
  readonly poolPower = this.A.pool('power', 0);
  /** Rotor tops of the dry coolers (spin by day on solar, all the time once the hall has power). */
  fans!: THREE.InstancedMesh;
  readonly fanBase: THREE.Matrix4[] = [];
  readonly lights: Record<'cold' | 'core' | 'lobby' | 'hall' | 'spark' | 'gate' | 'ups', VirtualLight>;
  readonly coreDoor: Door;
  readonly cageGate: Door;
  gateCone!: ReturnType<typeof lightCone>;
  /** Local points used by interactions and effects. */
  readonly pts: Record<string, THREE.Vector3> = {};
  private readonly b = new SplitBatch();
  private readonly d = new MeshBatch();
  private readonly farGlow = new MeshBatch();
  /** Halos for the far stand-in: channel 0 follows the night, channel 1 the mast blinker. */
  readonly farHalos = new GlowSprites(4);
  private readonly r = rng(4242);

  constructor(private physics: Physics, private hf: Heightfield, readonly frame: Frame) {
    this.root.applyMatrix4(frame.m);
    this.root.name = 'coldstorage';
    const P = this.pal;
    this.slots = {
      led: Array.from({ length: 7 }, () => P.slot('#46ff7a', 3)),
      blue: Array.from({ length: 4 }, () => P.slot('#3aa8ff', 3)),
      amber: P.slot('#ffb02e', 2.6),
      red: P.slot('#ff3324', 3),
      strip: P.slot('#e6f0ff', 0.12),
      emerg: P.slot('#ffe1b0', 2.2),
      cold: P.slot('#bff2ff', 5),
      coreRack: P.slot('#5ff4ec', 4),
      coreBlue: P.slot('#7fb8ff', 2.5),
      eye: P.slot('#7ff8f0', 6),
      exit: P.slot('#46ff7a', 2.5),
      mast: P.slot('#ff2a1a', 0),
      night: P.slot('#ffe8c8', 0),
      reader: P.slot('#ff3a2a', 2.5),
      readerOk: P.slot('#46ff7a', 0),
      spark: P.slot('#bfe6ff', 0),
      ups: P.slot('#46ff7a', 2.2),
    };
    this.lights = {
      cold: this.light('#a8e8ff', 5, 14, -11, FY + 2.0, -9),
      core: this.light('#62f2ea', 6, 11, 22.5, FY + 2.4, -8),
      lobby: this.light('#ffdcb0', 3.2, 9, -3, 3.4, 7),
      hall: this.light('#dfe9ff', 0, 34, -3, 5.5, -5.5),
      spark: this.light('#bfe6ff', 0, 16, -40, 3.6, -10),
      gate: this.light('#ffe2bc', 0, 22, -5.6, 5.6, 26.6),
      ups: this.light('#7dffa0', 1.6, 6, 21, FY + 2.2, 0.5),
    };

    this.buildGround();
    this.buildHallShell();
    this.buildLobby();
    this.buildHallInterior();
    this.buildCore();
    this.coreDoor = this.buildCoreDoor();
    this.buildCage();
    this.cageGate = this.buildCageGate();
    this.buildRoof();
    this.buildDock();
    this.buildTanks();
    this.buildYard();
    this.buildMast();
    this.buildCarPark();
    this.buildFence();
    this.buildPowerLine();

    // far stand-in first (it reads the same parts), then the near set
    const far = this.b.ext.buildFar('dc-far', { minSize: 0.5, colors: new Map<THREE.Material, THREE.ColorRepresentation>([[pvMaterial(), '#1b2533']]) });
    this.far.add(far);
    this.far.add(this.farGlow.build('dc-far-glow', false, false));
    this.far.add(this.farHalos.build());
    const statics = this.b.near.build('dc-static');
    shadowProxy(statics); // one depth-pass draw; the doors and gate keep their own
    this.near.add(statics);
    const decals = this.d.build('dc-decals', false, false);
    decals.traverse((o) => { o.renderOrder = 2; });
    this.near.add(decals);
    this.near.add(this.halos.build());
    this.root.add(this.near, this.far);
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

  /** Ground height in site-local y at local (x, z). */
  ground(x: number, z: number) {
    const w = this.frame.p(x, 0, z);
    return this.hf.heightAt(w.x, w.z) - this.frame.y;
  }

  /** Solid box with a matching collider. */
  private solid(mat: THREE.Material, w: number, h: number, dd: number, x: number, y: number, z: number, ry = 0) {
    this.b.add(mat, box(w, h, dd, x, y, z, ry));
    this.col(x, y, z, w / 2, h / 2, dd / 2, ry);
  }

  private halo(x: number, y: number, z: number, c: string, size: number, ch: number, k = 1) {
    this.halos.add(new THREE.Vector3(x, y, z), c, size, ch, k);
  }

  /** Chain-link panel quad between two posts (local), uvs in metres. */
  private linkPanel(ax: number, ay: number, az: number, bx: number, by: number, bz: number, h: number) {
    const len = Math.hypot(bx - ax, bz - az);
    const g = new THREE.BufferGeometry();
    const p = [ax, ay, az, bx, by, bz, bx, by + h, bz, ax, ay, az, bx, by + h, bz, ax, ay + h, az];
    const uv = [0, 0, len, 0, len, h, 0, 0, len, h, 0, h];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return norm(g);
  }

  // ------------------------------------------------------------------ ground
  private buildGround() {
    const { b, d, A } = this;
    // apron around the hall and the drive in from the gate
    b.add(M.slab(), box(62, 0.3, 32, 0, -0.1, -4));
    b.add(M.asphalt(), box(36, 0.3, 24, 9, -0.09, 16.5));
    // access road out through the gate, following the ground toward the highway
    const roadPts: THREE.Vector3[] = [];
    for (let z = 28; z <= 70; z += 3) roadPts.push(new THREE.Vector3(0, this.ground(0, z), z));
    for (let i = 0; i < roadPts.length - 1; i++) {
      const a = roadPts[i], c = roadPts[i + 1];
      const len = a.distanceTo(c);
      const g = new THREE.BoxGeometry(7, 0.3, len + 0.05);
      g.rotateX(-Math.atan2(c.y - a.y, c.z - a.z));
      g.translate(0, (a.y + c.y) / 2 - 0.1, (a.z + c.z) / 2);
      b.add(M.asphalt(), norm(g));
      if (i % 2 === 0) d.add(A.decal(), A.quad('stripe', 0.18, 1.6, 0, (a.y + c.y) / 2 + 0.065, (a.z + c.z) / 2, -Math.PI / 2 + Math.atan2(c.y - a.y, c.z - a.z) * 0, 0, 0));
    }
    // grime: oil under the dock, tyre dirt at the gate, cracks
    d.add(A.decal(),
      A.floor('oil', 3.2, 3.2, 20.2, 0.07, 9.5), A.floor('oil', 2.4, 2.4, 14.3, 0.07, 8.6, 1),
      A.floor('dirt', 6, 5, 0, 0.07, 26), A.floor('dirt', 5, 4, -4, 0.07, 19, 2),
      A.floor('cracks', 4, 4, 6, 0.07, 14, 0.5), A.floor('cracks', 5, 5, -18, 0.07, 8, 2.1),
      A.floor('dirt', 7, 6, 27, 0.07, -6, 0.3), A.floor('oil', 2, 2, -28, 0.07, -9.5, 0.7),
    );
  }

  // ------------------------------------------------------------------ hall shell
  private buildHallShell() {
    const { b, d, A } = this;
    const { x0, x1, z0, z1, h, t } = HALL;
    const W = x1 - x0, D = z1 - z0;
    const panel = M.panel();
    // walls (colliders match): back, west, east, front with the lobby opening
    this.solid(panel, W, h, t, 0, h / 2, z0 + t / 2);
    this.solid(panel, t, h, D, x0 + t / 2, h / 2, (z0 + z1) / 2);
    this.solid(panel, t, h, D, x1 - t / 2, h / 2, (z0 + z1) / 2);
    const { door0, door1 } = LOBBY;
    this.solid(panel, door0 - x0, h, t, (x0 + door0) / 2, h / 2, z1 - t / 2);
    this.solid(panel, x1 - door1, h, t, (door1 + x1) / 2, h / 2, z1 - t / 2);
    this.solid(panel, door1 - door0, h - 2.6, t, (door0 + door1) / 2, 2.6 + (h - 2.6) / 2, z1 - t / 2);
    // dark liner on the inside faces, so the hall reads as a cave of racks, not a warehouse
    const lin = M.liner(), ih = h - 0.02, it = t + 0.015;
    b.add(lin, box(W - 0.8, ih, 0.03, 0, ih / 2, z0 + it), box(0.03, ih, D - 0.8, x0 + it, ih / 2, (z0 + z1) / 2), box(0.03, ih, D - 0.8, x1 - it, ih / 2, (z0 + z1) / 2));
    b.add(lin, box(door0 - (x0 + t), ih, 0.03, (x0 + t + door0) / 2, ih / 2, z1 - it), box(x1 - t - door1, ih, 0.03, (door1 + x1 - t) / 2, ih / 2, z1 - it));
    b.add(lin, box(door1 - door0, ih - 2.6, 0.03, (door0 + door1) / 2, 2.6 + (ih - 2.6) / 2, z1 - it));
    // parapet + dark fascia band + the cyan corporate stripe
    const par = 0.9;
    b.add(panel, box(W, par, 0.3, 0, h + 0.3 + par / 2, z0 + 0.15), box(W, par, 0.3, 0, h + 0.3 + par / 2, z1 - 0.15));
    b.add(panel, box(0.3, par, D, x0 + 0.15, h + 0.3 + par / 2, (z0 + z1) / 2), box(0.3, par, D, x1 - 0.15, h + 0.3 + par / 2, (z0 + z1) / 2));
    const fas = M.fascia();
    b.add(fas, box(W + 0.24, 1.25, 0.08, 0, h + 0.75, z1 + 0.04), box(W + 0.24, 1.25, 0.08, 0, h + 0.75, z0 - 0.04));
    b.add(fas, box(0.08, 1.25, D + 0.24, x0 - 0.04, h + 0.75, (z0 + z1) / 2), box(0.08, 1.25, D + 0.24, x1 + 0.04, h + 0.75, (z0 + z1) / 2));
    b.add(M.cyan(), box(W + 0.26, 0.12, 0.1, 0, h + 0.06, z1 + 0.05), box(0.1, 0.12, D + 0.26, x0 - 0.05, h + 0.06, (z0 + z1) / 2), box(0.1, 0.12, D + 0.26, x1 + 0.05, h + 0.06, (z0 + z1) / 2));
    // plinth
    const pl = M.panelDark();
    b.add(pl, box(W + 0.12, 0.6, 0.06, 0, 0.3, z1 + 0.03), box(W + 0.12, 0.6, 0.06, 0, 0.3, z0 - 0.03));
    b.add(pl, box(0.06, 0.6, D + 0.12, x0 - 0.03, 0.3, (z0 + z1) / 2), box(0.06, 0.6, D + 0.12, x1 + 0.03, 0.3, (z0 + z1) / 2));
    // pilasters and louvre bays (intakes up high; alternate bays are blank panels with soot)
    const lou = M.louvre();
    for (let i = 0; i <= 8; i++) {
      const x = x0 + i * (W / 8);
      for (const [z, s] of [[z1, 1], [z0, -1]] as const) {
        b.add(panel, box(0.55, h, 0.22, x, h / 2, z + s * 0.11));
        if (i < 8 && !(z === z1 && x + W / 16 > door0 - 3 && x + W / 16 < door1 + 3)) {
          const cx = x + W / 16;
          if ((i + (s > 0 ? 0 : 1)) % 2 === 0) {
            b.add(lou, box(W / 8 - 0.9, 1.9, 0.12, cx, 5.4, z + s * 0.07));
            b.add(fas, box(W / 8 - 0.7, 0.1, 0.18, cx, 6.4, z + s * 0.09), box(W / 8 - 0.7, 0.1, 0.18, cx, 4.4, z + s * 0.09));
            d.add(A.decal(), A.quad('soot', W / 8 - 1.2, 2.6, cx, 3.0, z + s * 0.012, 0, s > 0 ? 0 : Math.PI, 0));
          }
        }
      }
    }
    for (let i = 0; i <= 3; i++) {
      const z = z0 + i * (D / 3);
      for (const [x, s] of [[x0, -1], [x1, 1]] as const) b.add(panel, box(0.22, h, 0.55, x + s * 0.11, h / 2, z));
    }
    // the logo over the lobby (backlit; two letters dead)
    const logoW = 8, logoH = 2;
    this.d.add(this.screenOn.m, A.quad('logo', logoW, logoH, -3, 5.45, z1 + 0.13));
    b.add(fas, box(logoW + 0.4, logoH + 0.2, 0.08, -3, 5.45, z1 + 0.05));
    this.halo(-3, 5.5, z1 + 0.6, '#5ff4ec', 3.0, CH.NIGHT, 0.45);
    // wall packs (night) washing down the front
    for (const x of [-20, -12, 8, 25]) {
      b.add(M.dark(), box(0.45, 0.3, 0.3, x, 6.1, z1 + 0.15));
      this.slots.night.add(this.d, box(0.38, 0.04, 0.24, x, 5.95, z1 + 0.18));
      this.d.add(this.poolNight.m, A.quad('washWhite', 3.4, 5.2, x, 3.3, z1 + 0.03, 0, 0, 0), A.floor('poolWhite', 5, 4, x, 0.075, z1 + 1.8));
      this.halo(x, 5.9, z1 + 0.35, '#ffe8c8', 1.3, CH.NIGHT, 2);
    }
    // fire door on the west end, with its exit sign
    b.add(M.steel(), box(0.08, 2.3, 1.3, x0 - 0.04, 1.15, -6));
    b.add(M.dark(), box(0.1, 0.08, 1.0, x0 - 0.09, 1.1, -6));
    this.d.add(this.screenOn.m, A.quad('exit', 0.6, 0.3, x0 - 0.06, 2.6, -6, 0, -Math.PI / 2, 0));
    this.halo(x0 - 0.3, 2.6, -6, '#46ff7a', 0.8, CH.ON, 1.2);
    // pipe from the pump skid up the east end, over the parapet
    const blue = M.blue();
    b.add(blue, cyl(0.2, 0.2, 7.6, x1 + 0.45, 4.6, -2.6, 12));
    b.add(blue, beam(new THREE.Vector3(x1 + 0.45, 8.4, -2.6), new THREE.Vector3(x1 - 1.2, 8.4, -2.6), 0.2, 12));
    b.add(blue, cyl(0.2, 0.2, 7.6, x1 + 0.45, 4.6, -4.0, 12));
    b.add(blue, beam(new THREE.Vector3(x1 + 0.45, 8.4, -4.0), new THREE.Vector3(x1 - 1.2, 8.4, -4.0), 0.2, 12));
    for (const y of [1.5, 3.5, 5.5, 7.5]) b.add(M.steel(), box(0.5, 0.12, 2.0, x1 + 0.3, y, -3.3));
    this.b.add(this.A.paint(), A.quad('pipeLabel', 1.2, 0.22, x1 + 0.66, 2.6, -2.6, 0, Math.PI / 2, Math.PI / 2));
  }

  // ------------------------------------------------------------------ lobby
  private buildLobby() {
    const { b, d, A } = this;
    const { x0, x1, z0, z1, h, door0, door1 } = LOBBY;
    const panel = M.panel();
    this.solid(panel, 0.3, h, z1 - z0, x0 + 0.15, h / 2, (z0 + z1) / 2);
    this.solid(panel, 0.3, h, z1 - z0, x1 - 0.15, h / 2, (z0 + z1) / 2);
    b.add(M.slab(), box(x1 - x0, 0.15, z1 - z0, (x0 + x1) / 2, 0.075, (z0 + z1) / 2));
    this.col((x0 + x1) / 2, 0.075, (z0 + z1) / 2, (x1 - x0) / 2, 0.075, (z1 - z0) / 2);
    // threshold step into the raised floor
    this.solid(M.slab(), door1 - door0, 0.3, 0.42, (door0 + door1) / 2, 0.15, HALL.z1 - 0.2);
    // roof and the cantilevered entrance canopy
    b.add(M.fascia(), box(x1 - x0 + 0.6, 0.4, z1 - z0 + 0.4, (x0 + x1) / 2, h + 0.2, (z0 + z1) / 2 + 0.2));
    b.add(M.fascia(), box(5.2, 0.22, 2.4, (door0 + door1) / 2, 3.6, z1 + 1.2));
    b.add(M.cyan(), box(5.24, 0.06, 0.06, (door0 + door1) / 2, 3.5, z1 + 2.4));
    b.add(M.ceiling(), box(x1 - x0 - 0.6, 0.05, z1 - z0, (x0 + x1) / 2, h - 0.02, (z0 + z1) / 2));
    // glass curtain wall with mullions; the door opening has lost its glass
    const glass = glassMaterial();
    const gl = (a: number, c: number) => {
      this.d.add(glass, box(c - a, 3.85, 0.03, (a + c) / 2, 0.15 + 3.85 / 2, z1 - 0.1));
      this.col((a + c) / 2, 2.1, z1 - 0.1, (c - a) / 2, 2.0, 0.06);
    };
    gl(x0 + 0.3, door0);
    gl(door1, x1 - 0.3);
    const mul = M.fascia();
    for (let x = x0 + 0.3; x <= x1 - 0.29; x += 1.2) b.add(mul, box(0.09, 4.0, 0.14, x, 2.1, z1 - 0.1));
    b.add(mul, box(x1 - x0 - 0.6, 0.12, 0.16, (x0 + x1) / 2, 2.75, z1 - 0.1));
    b.add(mul, box(0.12, 2.75, 0.18, door0, 1.37, z1 - 0.1), box(0.12, 2.75, 0.18, door1, 1.37, z1 - 0.1));
    // a door leaf, shoved open and starred, and the other one in pieces on the floor
    b.add(mul, box(0.05, 2.55, 0.06, door1 - 0.1, 1.42, z1 + 0.85));
    this.d.add(glass, box(0.02, 2.4, 0.95, door1 - 0.1, 1.4, z1 + 0.4, -0.15));
    for (let i = 0; i < 14; i++) {
      const g = new THREE.BufferGeometry();
      const sx = (this.r() - 0.5) * 0.4, sz = (this.r() - 0.5) * 0.4;
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, sx + 0.12, 0, sz, sz * 0.5, 0, 0.14 + sx], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      g.computeVertexNormals();
      g.translate(door0 + 0.3 + this.r() * 1.6, 0.17 + i * 0.0005, z1 - 0.9 + this.r() * 1.6);
      b.add(M.ice(), norm(g));
    }
    // reception desk + dead terminal, the turnstiles and their badge reader
    const desk = M.desk();
    this.solid(desk, 1.4, 1.05, 2.4, x0 + 1.2, 0.675, 6.4);
    b.add(M.dark(), box(1.6, 0.05, 2.6, x0 + 1.2, 1.22, 6.4));
    b.add(M.dark(), box(0.05, 0.4, 0.6, x0 + 1.5, 1.45, 6.6, 0.3));
    this.d.add(this.screenPower.m, A.quad('dash', 0.56, 0.3, x0 + 1.53, 1.47, 6.6, 0, Math.PI / 2 + 0.3, 0));
    for (const x of [door0 - 0.25, door1 + 0.25]) {
      this.solid(M.white(), 0.28, 1.0, 1.5, x, 0.65, 5.6);
      b.add(M.dark(), box(0.3, 0.04, 1.52, x, 1.17, 5.6));
      this.d.add(glass, box(0.42, 0.7, 0.02, x + (x < -3 ? 0.35 : -0.35), 0.85, 5.9, 0, 0, 0));
    }
    this.b.add(this.A.paint(), A.quad('reader', 0.13, 0.2, door0 - 0.25, 1.28, 6.36, -0.6, 0, 0));
    this.slots.reader.add(this.d, box(0.05, 0.02, 0.02, door0 - 0.25, 1.33, 6.36));
    this.halo(door0 - 0.25, 1.35, 6.42, '#ff3a2a', 0.25, CH.READER, 1.5);
    // whiteboard (the SLA, and Priya's sticky note), posters, a couch, a dead fern
    this.b.add(this.A.paint(), A.quad('whiteboard', 3.0, 1.5, x1 - 0.32, 1.75, 7.0, 0, -Math.PI / 2, 0));
    b.add(M.galv(), box(0.04, 1.6, 3.1, x1 - 0.31, 1.75, 7.0));
    b.add(M.galv(), box(0.12, 0.05, 1.2, x1 - 0.38, 0.98, 7.0));
    this.b.add(this.A.paint(), A.quad('posterCloud', 0.8, 1.12, x0 + 1.4, 1.9, HALL.z1 + 0.02), A.quad('posterUptime', 0.8, 1.12, x1 - 1.2, 1.9, HALL.z1 + 0.02));
    // reception logo wall: a dark panel on the west wall, the mark backlit
    b.add(M.fascia(), box(0.06, 1.6, 3.6, x0 + 0.33, 2.35, 6.6));
    this.d.add(this.screenOn.m, A.quad('logo', 3.2, 0.8, x0 + 0.37, 2.4, 6.6, 0, Math.PI / 2, 0));
    this.halo(x0 + 0.6, 2.4, 6.6, '#5ff4ec', 2.4, CH.ON, 0.18);
    const couch = M.couch();
    this.solid(couch, 2.0, 0.42, 0.85, -0.6, 0.36, z1 - 0.75);
    b.add(couch, box(2.0, 0.55, 0.2, -0.6, 0.75, z1 - 0.32), box(0.22, 0.6, 0.85, -1.6, 0.5, z1 - 0.75), box(0.22, 0.6, 0.85, 0.4, 0.5, z1 - 0.75));
    b.add(M.orange(), cyl(0.22, 0.17, 0.5, x0 + 0.7, 0.4, z1 - 0.7, 12));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.add(plainStandard('#6a5534', 0.9), beam(new THREE.Vector3(x0 + 0.7, 0.62, z1 - 0.7), new THREE.Vector3(x0 + 0.7 + Math.cos(a) * 0.45, 0.95 + this.r() * 0.3, z1 - 0.7 + Math.sin(a) * 0.45), 0.012, 3));
    }
    // ceiling light (on battery, flickering) + floor grime
    b.add(M.dark(), box(1.3, 0.06, 0.4, -3, h - 0.06, 7));
    this.slots.emerg.add(this.d, box(1.2, 0.02, 0.32, -3, h - 0.1, 7));
    this.halo(-3, h - 0.25, 7, '#ffe1b0', 1.6, CH.EMERG, 0.7);
    d.add(this.poolNight.m, A.floor('poolAmber', 7, 5, -3, 0.16, 8.5));
    d.add(A.decal(), A.floor('dirt', 3, 3, -3, 0.16, 9), A.floor('dirt', 2.5, 2.5, -1.5, 0.16, 6.5, 1.3));
    this.pts.lobby = new THREE.Vector3(-3, 0.15, 7.5);
  }

  // ------------------------------------------------------------------ hall interior
  private buildHallInterior() {
    this.b.indoor = true;
    const { b, d, A } = this;
    const { x0, x1, z0, z1 } = INSIDE;
    const r = this.r;
    // raised floor: one collider; the tiles are atlas quads (perforated in the cold aisles)
    // a raised access floor rings hollow under your boots
    surfaces.tag(this.col(0, FY / 2, (z0 + z1) / 2, (x1 - x0) / 2, FY / 2, (z1 - z0) / 2), 'metal');
    b.add(M.block(), box(x1 - x0, FY - 0.02, z1 - z0, 0, (FY - 0.02) / 2, (z0 + z1) / 2));
    const T = 0.6;
    const tiles = { tile: [] as THREE.BufferGeometry[], perf: [] as THREE.BufferGeometry[], dirty: [] as THREE.BufferGeometry[], frost: [] as THREE.BufferGeometry[] };
    for (let x = x0 + T / 2; x < x1; x += T) {
      for (let z = z0 + T / 2; z < z1; z += T) {
        if (x > CORE.x && z < CORE.z1) continue; // the core has its own floor
        const coldA = z > -10.35 && z < -7.65 && x < 13.6 && x > -18.4;
        const coldB = z > -3.35 && z < -0.65 && x < 13.6 && x > -18.4;
        const kind = coldA ? 'frost' : coldB ? 'perf' : r() < 0.07 ? 'dirty' : 'tile';
        tiles[kind as keyof typeof tiles].push(A.floor(kind === 'tile' ? 'tile' : kind === 'perf' ? 'tilePerf' : kind === 'dirty' ? 'tileDirty' : 'tileFrost', T, T, x, FY + 0.002, z));
      }
    }
    b.add(A.paint(), ...tiles.tile, ...tiles.perf, ...tiles.dirty, ...tiles.frost);
    // ceiling: dark deck, joists, two girders
    b.add(M.ceiling(), box(x1 - x0, 0.06, z1 - z0, 0, HALL.h - 0.03, (z0 + z1) / 2));
    const fas = M.fascia();
    for (let x = x0 + 1.6; x < x1; x += 3.2) b.add(fas, box(0.12, 0.45, z1 - z0, x, HALL.h - 0.3, (z0 + z1) / 2), box(0.28, 0.04, z1 - z0, x, HALL.h - 0.52, (z0 + z1) / 2));
    for (const z of [-9, -2]) b.add(fas, box(x1 - x0, 0.7, 0.3, 0, HALL.h - 0.4, z));

    // ---- racks
    const rowsZ: [number, 1 | -1, boolean][] = [[-10.9, 1, true], [-7.1, -1, true], [-3.9, 1, false], [-0.1, -1, false]];
    const segs: [number, number][] = [[-18.4, -4.6], [-1.4, 13.6]];
    const rackMat = M.rack();
    const leds = this.slots.led, blues = this.slots.blue;
    const doors: THREE.BufferGeometry[] = [], frostDoors: THREE.BufferGeometry[] = [];
    let haloN = 0;
    for (const [zc, f, cold] of rowsZ) {
      for (const [sx0, sx1] of segs) {
        const len = sx1 - sx0, cx = (sx0 + sx1) / 2;
        this.solid(rackMat, len, 2.2, 1.1, cx, FY + 1.1, zc);
        b.add(M.black(), box(len + 0.02, 0.06, 1.12, cx, FY + 2.2, zc));
        const n = Math.round(len / 0.6);
        for (let i = 0; i < n; i++) {
          const x = sx0 + 0.3 + i * 0.6;
          // front doors face the cold aisle, plain backs face the hot aisle
          const zf = zc + f * 0.553;
          const door = A.quad(cold ? 'rackFrost' : 'rackDoor', 0.58, 2.12, x, FY + 1.1, zf, 0, f > 0 ? 0 : Math.PI, 0);
          (cold ? frostDoors : doors).push(door);
          doors.push(A.quad('rackDoor', 0.58, 2.12, x, FY + 1.1, zc - f * 0.553, 0, f > 0 ? Math.PI : 0, 0));
          b.add(M.black(), box(0.025, 2.16, 0.02, x - 0.3, FY + 1.1, zf + f * 0.006));
          // status LEDs: a column of tiny lights in random slots (some dead)
          const k = 2 + Math.floor(r() * 4);
          for (let j = 0; j < k; j++) {
            if (r() < 0.15) continue;
            const y = FY + 0.35 + r() * 1.7;
            const lx = x - 0.2 + r() * 0.08;
            const slot = r() < 0.75 ? leds[Math.floor(r() * leds.length)] : r() < 0.85 ? blues[Math.floor(r() * blues.length)] : r() < 0.5 ? this.slots.amber : this.slots.red;
            slot.add(this.d, box(0.022, 0.012, 0.01, lx, y, zf + f * 0.012));
            if (r() < 0.05 && haloN < 70) {
              haloN++;
              const c = slot === this.slots.red ? '#ff3324' : slot === this.slots.amber ? '#ffb02e' : blues.includes(slot) ? '#3aa8ff' : '#46ff7a';
              this.halo(lx, y, zf + f * 0.05, c, 0.16, CH.BLINK + Math.floor(r() * CH.NBLINK), 1.4);
            }
          }
          // the odd rack shows a tiny status screen
          if (r() < 0.08) this.d.add(this.screenOn.m, A.quad('rackScreen', 0.22, 0.11, x + 0.06, FY + 1.55, zf + f * 0.014, 0, f > 0 ? 0 : Math.PI, 0));
        }
        // fibre tray (yellow) and power ladder (black) above each row, hung from the deck
        const ty = FY + 2.75;
        b.add(M.fiber(), box(len, 0.03, 0.32, cx, ty, zc), box(len, 0.11, 0.025, cx, ty + 0.05, zc - 0.16), box(len, 0.11, 0.025, cx, ty + 0.05, zc + 0.16));
        const py = FY + 3.2;
        b.add(M.cable(), box(len, 0.08, 0.03, cx, py, zc - 0.22), box(len, 0.08, 0.03, cx, py, zc + 0.22));
        for (let x = sx0 + 0.3; x < sx1; x += 0.6) b.add(M.cable(), box(0.04, 0.03, 0.44, x, py, zc));
        b.add(M.cable(), box(len - 0.4, 0.12, 0.36, cx, py + 0.08, zc));
        for (let x = sx0 + 1; x < sx1; x += 3) b.add(M.steel(), cyl(0.012, 0.012, HALL.h - ty - 0.05, x, (HALL.h + ty) / 2, zc - 0.2, 4), cyl(0.012, 0.012, HALL.h - ty - 0.05, x, (HALL.h + ty) / 2, zc + 0.2, 4));
        for (let i = 0; i < 4; i++) {
          const x = sx0 + 1 + r() * (len - 2);
          b.add(M.fiber(), wire(new THREE.Vector3(x, ty, zc + 0.1), new THREE.Vector3(x + 0.1, FY + 2.2, zc + f * 0.2), 0.06, 0.02, 6));
        }
      }
    }
    b.add(A.paint(), ...doors, ...frostDoors);
    // cross-aisle trays
    b.add(M.fiber(), box(0.3, 0.03, 11.0, -3.0, FY + 3.05, -5.5), box(0.025, 0.11, 11.0, -3.15, FY + 3.1, -5.5), box(0.025, 0.11, 11.0, -2.85, FY + 3.1, -5.5));

    // ---- cold aisle A: contained, frosted, still running on the solar
    const az0 = -10.35, az1 = -7.65, acz = -9;
    for (const [sx0, sx1] of segs) {
      const len = sx1 - sx0, cx = (sx0 + sx1) / 2;
      b.add(M.contain(), box(len, 0.04, az1 - az0, cx, FY + 2.32, acz));
      b.add(M.fascia(), box(len, 0.08, 0.06, cx, FY + 2.3, az0), box(len, 0.08, 0.06, cx, FY + 2.3, az1));
      // light strips under the roof, their pools on the frosted floor, mist hanging low
      for (let x = sx0 + 1.2; x < sx1 - 0.6; x += 2.4) {
        b.add(M.dark(), box(1.6, 0.05, 0.16, x, FY + 2.27, acz));
        this.slots.cold.add(this.d, box(1.5, 0.02, 0.1, x, FY + 2.24, acz));
        d.add(this.poolCold.m, A.floor('poolCyan', 3.2, 2.6, x, FY + 0.012, acz));
        if (Math.round(x * 10) % 3 === 0) this.halo(x, FY + 2.15, acz, '#bff2ff', 0.8, CH.COLD, 0.28);
      }
      for (let x = sx0 + 2; x < sx1 - 1; x += 4.5) {
        d.add(this.poolCold.m, A.quad('mist', 4.5, 1.0, x + r() * 0.6, FY + 0.45, acz + (r() - 0.5) * 0.8, 0, 0.12 * (r() - 0.5), 0));
        d.add(this.poolCold.m, A.quad('mist', 3.5, 0.9, x + 2, FY + 0.4, acz + (r() - 0.5) * 0.6, 0, Math.PI / 2 + 0.3 * (r() - 0.5), 0));
      }
      // icicles along both roof edges, frost decals on the floor and the roof
      for (let x = sx0 + 0.2; x < sx1; x += 0.22 + r() * 0.25) {
        for (const z of [az0 + 0.05, az1 - 0.05]) {
          if (r() < 0.35) continue;
          const L = 0.08 + Math.pow(r(), 2) * 0.55;
          b.add(M.ice(), place(new THREE.ConeGeometry(0.018 + r() * 0.02, L, 5), x, FY + 2.28 - L / 2, z, Math.PI));
        }
      }
      d.add(A.decal(), A.floor('frost', len, 3.2, cx, FY + 0.01, acz), A.quad('frost', len * 0.8, 2.6, cx, FY + 2.29, acz, Math.PI / 2, 0, 0));
      b.add(M.frostC(), box(len - 0.4, 0.05, 0.5, cx, FY + 0.03, az0 + 0.3), box(len - 0.4, 0.05, 0.5, cx, FY + 0.03, az1 - 0.3));
    }
    // containment ends: closed doors at the far ends, open sliders on the cross aisle
    const glass = glassMaterial();
    const endWall = (x: number, open: boolean, slideDir: 1 | -1) => {
      b.add(M.fascia(), box(0.08, 2.3, 0.08, x, FY + 1.15, az0 + 0.04), box(0.08, 2.3, 0.08, x, FY + 1.15, az1 - 0.04), box(0.1, 0.1, 2.7, x, FY + 2.25, acz));
      if (!open) {
        this.d.add(glass, box(0.03, 2.2, 2.6, x, FY + 1.1, acz));
        this.col(x, FY + 1.15, acz, 0.05, 1.15, 1.35);
        b.add(M.fascia(), box(0.06, 2.2, 0.05, x, FY + 1.1, acz));
        return;
      }
      // side panels 0.6 m, the 1.5 m opening between, the slider parked over one side panel
      for (const z of [az0 + 0.3, az1 - 0.3]) {
        this.d.add(glass, box(0.03, 2.2, 0.6, x, FY + 1.1, z));
        this.col(x, FY + 1.15, z, 0.05, 1.15, 0.3);
      }
      this.d.add(glass, box(0.03, 2.1, 0.78, x + slideDir * 0.06, FY + 1.06, az1 - 0.4));
      b.add(M.fascia(), box(0.05, 2.12, 0.05, x + slideDir * 0.06, FY + 1.06, az1 - 0.8));
    };
    endWall(-18.4, false, 1);
    endWall(13.6, false, 1);
    endWall(-4.6, true, -1);
    endWall(-1.4, true, 1);
    this.pts.coldAisle = new THREE.Vector3(-10, FY, acz);

    // ---- strip lights (dead until the hall has power; every third runs on the battery)
    let k = 0;
    for (const z of [-12.5, -5.5, -2.0, 2.0]) {
      for (let x = x0 + 2.4; x < x1 - 1.5; x += 4) {
        const y = FY + 3.9;
        b.add(M.dark(), box(2.4, 0.08, 0.22, x, y, z));
        b.add(M.steel(), cyl(0.01, 0.01, HALL.h - y, x - 0.9, (HALL.h + y) / 2, z, 4), cyl(0.01, 0.01, HALL.h - y, x + 0.9, (HALL.h + y) / 2, z, 4));
        const emerg = k++ % 3 === 0;
        (emerg ? this.slots.emerg : this.slots.strip).add(this.d, box(2.3, 0.02, 0.15, x, y - 0.05, z));
        if (emerg) {
          this.halo(x, y - 0.15, z, '#ffe1b0', 1.0, CH.EMERG, 0.45);
          d.add(this.poolCold.m, A.floor('poolAmber', 3.6, 2.8, x, FY + 0.012, z));
        }
        else d.add(this.poolPower.m, A.floor('poolWhite', 4.4, 3.4, x, FY + 0.012, z));
      }
    }

    // ---- exit signs
    for (const [x, y, z, ry] of [[-3, 3.0, z1 - 0.03, Math.PI], [x0 + 0.03, 2.9, -6, Math.PI / 2], [-3, 2.9, z0 + 0.03, 0]] as const) {
      b.add(M.dark(), box(Math.abs(ry) === Math.PI / 2 ? 0.06 : 0.66, 0.34, Math.abs(ry) === Math.PI / 2 ? 0.66 : 0.06, x, y, z));
      this.d.add(this.screenOn.m, A.quad('exit', 0.6, 0.3, x + Math.sin(ry) * 0.04, y, z + Math.cos(ry) * 0.04, 0, ry, 0));
      this.halo(x + Math.sin(ry) * 0.2, y, z + Math.cos(ry) * 0.2, '#46ff7a', 0.9, CH.ON, 1);
    }

    // ---- plant area (west): CRAH units, the chilled-water manifold, Priya's camp
    for (const z of [-12.2, -8.9, -5.6, -2.3]) {
      this.solid(M.white(), 0.95, 2.35, 2.7, x0 + 0.5, FY + 1.18, z);
      this.b.add(this.A.paint(), A.quad('vent', 2.4, 1.1, x0 + 0.985, FY + 1.6, z, 0, Math.PI / 2, 0));
      b.add(M.white(), box(0.8, HALL.h - FY - 2.35 - 0.1, 1.6, x0 + 0.5, (HALL.h + FY + 2.35) / 2, z));
      this.d.add(this.screenOn.m, A.quad('rackScreen', 0.3, 0.15, x0 + 0.99, FY + 0.7, z + 0.9, 0, Math.PI / 2, 0));
      this.slots.ups.add(this.d, box(0.01, 0.03, 0.03, x0 + 0.985, FY + 0.5, z - 1.0));
    }
    const blue = M.blue();
    for (const y of [3.7, 4.2]) b.add(blue, beam(new THREE.Vector3(x0 + 1.4, y, z0 + 0.4), new THREE.Vector3(x0 + 1.4, y, z1 - 0.6), 0.14, 12));
    for (const z of [-12.2, -8.9, -5.6, -2.3]) b.add(blue, beam(new THREE.Vector3(x0 + 1.4, 3.7, z + 0.4), new THREE.Vector3(x0 + 0.6, FY + 2.6, z + 0.4), 0.08, 8));
    this.b.add(this.A.paint(), A.quad('pipeLabel', 1.1, 0.2, x0 + 1.56, 3.7, -7, 0, Math.PI / 2, 0));
    // the last SRE's camp: a cot, a stove, cans, a laptop on a crate
    const cx = -21.5, cz = 1.6;
    b.add(M.cot(), box(1.9, 0.12, 0.75, cx, FY + 0.42, cz));
    b.add(M.steel(), box(0.04, 0.36, 0.04, cx - 0.9, FY + 0.18, cz - 0.33), box(0.04, 0.36, 0.04, cx + 0.9, FY + 0.18, cz - 0.33), box(0.04, 0.36, 0.04, cx - 0.9, FY + 0.18, cz + 0.33), box(0.04, 0.36, 0.04, cx + 0.9, FY + 0.18, cz + 0.33));
    b.add(plainStandard('#7c3a2a', 0.9), box(0.7, 0.14, 0.55, cx - 0.55, FY + 0.55, cz));
    this.col(cx, FY + 0.25, cz, 0.95, 0.25, 0.38);
    b.add(M.white(), box(0.55, 0.45, 0.45, cx + 1.6, FY + 0.225, cz - 0.4));
    b.add(M.dark(), box(0.36, 0.015, 0.25, cx + 1.6, FY + 0.46, cz - 0.4), box(0.36, 0.22, 0.012, cx + 1.6, FY + 0.57, cz - 0.52, 0, -0.25));
    this.d.add(this.screenOn.m, A.quad('rackScreen', 0.32, 0.19, cx + 1.6, FY + 0.57, cz - 0.512, -0.25, 0, 0));
    for (let i = 0; i < 9; i++) b.add(M.galv(), cyl(0.033, 0.033, 0.12, cx - 0.6 + r() * 2.6, FY + 0.06, cz + 0.6 + r() * 0.7, 8));
    b.add(M.dark(), cyl(0.12, 0.12, 0.1, cx + 1.1, FY + 0.05, cz + 0.6, 10));

    // ---- scattered work: lifted tiles, a crash cart, a pulled server
    for (const [x, z, ry] of [[-6.2, -5.2, 0.4], [9.0, -5.8, -0.6], [-13, 2.3, 1.2]] as const) {
      b.add(A.paint(), place(A.map('tile', new THREE.BoxGeometry(0.6, 0.6, 0.03)), x, FY + 0.31, z, -1.2, ry, 0));
    }
    this.solid(M.galv(), 0.6, 0.9, 0.45, 5.6, FY + 0.45, 1.6, 0.2);
    b.add(M.dark(), box(0.44, 0.06, 0.6, 5.6, FY + 0.93, 1.6, 0.2));
    b.add(M.rack(), box(0.48, 0.09, 0.7, 2.2, FY + 0.045, -5.0, 0.7));
    d.add(A.decal(), A.floor('dirt', 2, 2, -3, FY + 0.01, 2.0), A.floor('oil', 1.4, 1.4, 5.5, FY + 0.01, 1.2));

    this.pts.hallCenter = new THREE.Vector3(-3, FY, -5.5);
    this.b.indoor = false;
  }

  // ------------------------------------------------------------------ core room
  private buildCore() {
    this.b.indoor = true;
    const { b, A } = this;
    const { x, x1, z0, z1, d0, d1, h } = CORE;
    const glass = glassMaterial();
    const fas = M.fascia();
    // block wall to the battery room, its own ceiling
    this.solid(M.block(), x1 - x, h, 0.3, (x + x1) / 2, FY + h / 2, z1 + 0.05);
    b.add(M.ceiling(), box(x1 - x, 0.15, z1 - z0, (x + x1) / 2, FY + h + 0.07, (z0 + z1) / 2));
    // west glass wall on a curb, door gap at [d0, d1]
    const run = (a: number, c: number) => {
      b.add(M.block(), box(0.3, 0.25, c - a, x, FY + 0.125, (a + c) / 2));
      this.d.add(glass, box(0.03, 2.65, c - a, x, FY + 0.25 + 1.325, (a + c) / 2));
      this.col(x, FY + h / 2, (a + c) / 2, 0.12, h / 2, (c - a) / 2);
      for (let z = a; z <= c + 0.01; z += (c - a) / Math.max(1, Math.round((c - a) / 1.3))) b.add(fas, box(0.12, 2.65, 0.08, x, FY + 1.575, z));
    };
    run(z0, d0);
    run(d1, z1);
    b.add(M.block(), box(0.3, h - 2.9, z1 - z0, x, FY + 2.9 + (h - 2.9) / 2, (z0 + z1) / 2));
    b.add(fas, box(0.16, 2.9, 0.12, x, FY + 1.45, d0), box(0.16, 2.9, 0.12, x, FY + 1.45, d1));
    this.b.add(this.A.paint(), A.quad('coreSign', 1.6, 0.6, x - 0.16, FY + 3.15, (d0 + d1) / 2, 0, -Math.PI / 2, 0));
    // keypad / badge reader beside the door
    b.add(M.dark(), box(0.06, 0.32, 0.2, x - 0.18, FY + 1.3, d1 + 0.35));
    this.b.add(this.A.paint(), A.quad('reader', 0.17, 0.27, x - 0.215, FY + 1.3, d1 + 0.35, 0, -Math.PI / 2, 0));
    this.slots.reader.add(this.d, box(0.01, 0.03, 0.06, x - 0.22, FY + 1.41, d1 + 0.35));
    this.slots.readerOk.add(this.d, box(0.01, 0.03, 0.06, x - 0.22, FY + 1.41, d1 + 0.42));
    this.halo(x - 0.3, FY + 1.42, d1 + 0.38, '#ff3a2a', 0.22, CH.READER, 1.5);
    this.pts.coreDoor = new THREE.Vector3(x - 0.9, FY, (d0 + d1) / 2);
    // floor
    for (let xx = x + 0.3; xx < x1; xx += 0.6) for (let zz = z0 + 0.3; zz < z1; zz += 0.6) b.add(A.paint(), A.floor(this.r() < 0.5 ? 'tilePerf' : 'tile', 0.6, 0.6, xx, FY + 0.002, zz));
    // the model cluster: tall glossy racks with light bars and liquid cooling
    const cl = rustyMetal({ base: '#0f1113', rust: -0.9, metalness: 0.8, roughness: 0.22 });
    const racks: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) racks.push([x + 1.4 + i * 1.15, z0 + 0.65, 0]);
    for (let i = 0; i < 5; i++) racks.push([x1 - 0.65, z0 + 2.6 + i * 1.3, -Math.PI / 2]);
    for (const [rx, rz, ry] of racks) {
      const across = ry !== 0;
      this.solid(cl, across ? 1.1 : 0.9, 2.6, across ? 1.0 : 1.1, rx, FY + 1.3, rz);
      const fx = across ? rx - 0.56 : rx, fz = across ? rz : rz + 0.56;
      for (const o of [-0.3, 0.3]) this.slots.coreRack.add(this.d, box(across ? 0.02 : 0.04, 2.2, across ? 0.04 : 0.02, fx + (across ? 0 : o), FY + 1.35, fz + (across ? o : 0)));
      for (let j = 0; j < 6; j++) this.slots.coreBlue.add(this.d, box(across ? 0.015 : 0.3, 0.012, across ? 0.3 : 0.015, fx, FY + 0.5 + j * 0.32, fz));
      const top = new THREE.Vector3(rx, FY + 2.6, rz);
      b.add(M.blue(), wire(top.clone().add(new THREE.Vector3(0.15, 0, 0)), new THREE.Vector3(rx + 0.2, FY + h - 0.1, (z0 + z1) / 2 - 1), -0.4, 0.035, 10));
      b.add(M.red(), wire(top.clone().add(new THREE.Vector3(-0.15, 0, 0)), new THREE.Vector3(rx - 0.1, FY + h - 0.1, (z0 + z1) / 2 - 1.2), -0.35, 0.035, 10));
    }
    b.add(M.galv(), box(x1 - x - 1, 0.25, 0.3, (x + x1) / 2, FY + h - 0.15, (z0 + z1) / 2 - 1.1));
    // the eye on the big rack facing the door
    const ey = FY + 1.75, ez = (z0 + z1) / 2;
    b.add(cl, box(0.25, 1.4, 1.4, x1 - 1.3, ey, ez));
    this.slots.eye.add(this.d, place(new THREE.TorusGeometry(0.42, 0.035, 8, 40), x1 - 1.44, ey, ez, 0, Math.PI / 2, 0));
    this.slots.eye.add(this.d, place(new THREE.SphereGeometry(0.1, 16, 10), x1 - 1.45, ey, ez));
    this.slots.coreRack.add(this.d, place(new THREE.TorusGeometry(0.58, 0.012, 6, 48), x1 - 1.44, ey, ez, 0, Math.PI / 2, 0));
    this.halo(x1 - 1.6, ey, ez, '#7ff8f0', 1.8, CH.CORE, 1.2);
    this.halo(x1 - 1.6, ey, ez, '#7ff8f0', 0.5, CH.CORE, 3);
    // terminal: desk, the face on the screen, a gooseneck mic, a mug, a chair
    const tx = x1 - 4.2;
    this.solid(M.desk(), 0.9, 0.05, 2.0, tx, FY + 0.76, ez);
    for (const [ox, oz] of [[-0.4, -0.9], [0.4, -0.9], [-0.4, 0.9], [0.4, 0.9]]) b.add(M.steel(), box(0.04, 0.74, 0.04, tx + ox, FY + 0.37, ez + oz));
    b.add(M.dark(), box(0.08, 0.66, 0.96, tx + 0.25, FY + 1.18, ez), box(0.06, 0.32, 0.06, tx + 0.28, FY + 0.92, ez));
    this.d.add(this.screenAI.m, A.quad('aiFace', 0.88, 0.62, tx + 0.205, FY + 1.18, ez, 0, -Math.PI / 2, 0));
    b.add(M.dark(), box(0.22, 0.02, 0.5, tx - 0.15, FY + 0.795, ez));
    b.add(M.steel(), cyl(0.012, 0.012, 0.4, tx - 0.05, FY + 0.98, ez + 0.6, 5, 0, 0, 0.35));
    b.add(M.black(), place(new THREE.SphereGeometry(0.035, 8, 6), tx - 0.12, FY + 1.17, ez + 0.6));
    b.add(M.white(), cyl(0.045, 0.04, 0.1, tx - 0.2, FY + 0.84, ez - 0.7, 10));
    b.add(M.dark(), box(0.5, 0.08, 0.5, tx - 0.8, FY + 0.5, ez + 0.1), box(0.5, 0.55, 0.08, tx - 1.05, FY + 0.8, ez + 0.1, 0, 0, 0.1));
    b.add(M.steel(), cyl(0.03, 0.03, 0.45, tx - 0.8, FY + 0.25, ez + 0.1, 6));
    this.pts.terminal = new THREE.Vector3(tx - 0.9, FY, ez);
    this.pts.eye = new THREE.Vector3(x1 - 1.45, ey, ez);
    this.d.add(this.poolCold.m, this.A.floor('poolCyan', 4.5, 4.5, x1 - 2.6, FY + 0.012, ez));
    this.b.indoor = false;
  }

  private buildCoreDoor(): Door {
    const { x, d0, d1 } = CORE;
    const db = new MeshBatch();
    const w = d1 - d0;
    db.add(M.steel(), box(0.08, 2.3, w, 0, 1.15, 0));
    db.add(M.fascia(), box(0.1, 0.1, w, 0, 2.25, 0), box(0.1, 2.3, 0.08, 0, 1.15, -w / 2 + 0.04), box(0.1, 2.3, 0.08, 0, 1.15, w / 2 - 0.04));
    db.add(this.A.paint(), this.A.quad('hazard', w - 0.2, 0.18, -0.045, 0.5, 0, 0, -Math.PI / 2, 0));
    db.add(M.dark(), box(0.04, 0.5, 0.06, -0.06, 1.1, w / 2 - 0.25));
    const obj = db.build('dc-coreDoor', false, true);
    obj.position.set(x, FY, (d0 + d1) / 2);
    this.near.add(obj);
    return { obj, col: this.col(x, FY + 1.15, (d0 + d1) / 2, 0.08, 1.15, w / 2), open: 0, target: 0, solid: true };
  }

  // ------------------------------------------------------------------ battery cage
  private buildCage() {
    this.b.indoor = true;
    const { b, A } = this;
    const { x, x1, z0, z1, g0, g1 } = CAGE;
    const H = 2.6;
    const link = chainLink();
    const post = M.galv();
    const panels: THREE.BufferGeometry[] = [];
    for (const [a, c] of [[z0, g0], [g1, z1]] as const) {
      panels.push(this.linkPanel(x, FY, a, x, FY, c, H));
      this.col(x, FY + H / 2, (a + c) / 2, 0.05, H / 2, (c - a) / 2);
    }
    panels.push(this.linkPanel(x, FY + 2.3, g0, x, FY + 2.3, g1, H - 2.3));
    this.d.add(link, ...panels);
    for (const z of [z0, g0, g1, z1]) b.add(post, cyl(0.04, 0.04, H, x, FY + H / 2, z, 6));
    b.add(post, beam(new THREE.Vector3(x, FY + H, z0), new THREE.Vector3(x, FY + H, z1), 0.03, 5), beam(new THREE.Vector3(x, FY + 2.3, g0), new THREE.Vector3(x, FY + 2.3, g1), 0.03, 5));
    this.b.add(this.A.paint(), A.quad('cageSign', 0.8, 0.4, x - 0.06, FY + 1.6, (z0 + g0) / 2, 0, -Math.PI / 2, 0));
    // UPS cabinets, battery strings, a shelf of loose cells
    for (let i = 0; i < 3; i++) {
      const z = z0 + 1.0 + i * 1.3;
      this.solid(M.white(), 0.8, 2.0, 1.2, x1 - 0.45, FY + 1.0, z);
      this.d.add(this.screenOn.m, A.quad('rackScreen', 0.28, 0.14, x1 - 0.86, FY + 1.5, z, 0, -Math.PI / 2, 0));
      this.slots.ups.add(this.d, box(0.01, 0.03, 0.03, x1 - 0.86, FY + 1.3, z - 0.3));
      this.halo(x1 - 0.9, FY + 1.3, z - 0.3, '#46ff7a', 0.18, CH.ON, 1.2);
    }
    for (const xx of [x + 2.0, x + 4.6]) {
      this.solid(M.steel(), 2.2, 1.9, 0.6, xx, FY + 0.95, z1 - 0.4);
      for (let s = 0; s < 4; s++) for (let k = 0; k < 6; k++) b.add(M.black(), box(0.32, 0.3, 0.45, xx - 0.9 + k * 0.36, FY + 0.2 + s * 0.46, z1 - 0.42));
    }
    this.solid(M.galv(), 1.6, 1.2, 0.5, x + 3.5, FY + 0.6, z0 + 0.4);
    for (let k = 0; k < 7; k++) b.add(M.orange(), box(0.16, 0.12, 0.22, x + 2.9 + k * 0.2 + this.r() * 0.03, FY + 1.26, z0 + 0.4 + (this.r() - 0.5) * 0.15));
    this.pts.cageGate = new THREE.Vector3(x - 0.9, FY, (g0 + g1) / 2);
    this.pts.cageShelf = new THREE.Vector3(x + 3.5, FY, z0 + 1.2);
    this.b.indoor = false;
  }

  private buildCageGate(): Door {
    const { x, g0, g1 } = CAGE;
    const w = g1 - g0;
    const gb = new MeshBatch();
    gb.add(chainLink(), this.linkPanel(0, 0, 0, 0, 0, w, 2.25));
    gb.add(M.galv(), cyl(0.03, 0.03, 2.25, 0, 1.12, 0, 6), cyl(0.03, 0.03, 2.25, 0, 1.12, w, 6), beam(new THREE.Vector3(0, 2.22, 0), new THREE.Vector3(0, 2.22, w), 0.025, 5), beam(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.05, w), 0.025, 5));
    gb.add(rustyMetal({ base: '#d4b04a', rust: 0.1, metalness: 1, roughness: 0.25 }), box(0.06, 0.14, 0.1, -0.06, 1.05, w - 0.08));
    const obj = gb.build('dc-cageGate', false, true);
    const pivot = new THREE.Group();
    pivot.position.set(x, FY, g0);
    pivot.add(obj);
    this.near.add(pivot);
    return { obj: pivot, col: this.col(x, FY + 1.15, (g0 + g1) / 2, 0.06, 1.15, w / 2), open: 0, target: 0, solid: true };
  }

  // ------------------------------------------------------------------ roof
  private buildRoof() {
    const { b } = this;
    const top = HALL.h + 0.3;
    b.add(M.slab(), box(HALL.x1 - HALL.x0, 0.3, HALL.z1 - HALL.z0, 0, HALL.h + 0.15, (HALL.z0 + HALL.z1) / 2));
    const galv = M.galv(), lou = M.louvre(), dark = M.dark();
    const parts: THREE.BufferGeometry[] = [norm(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10))];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(0.86, 0.02, 0.22);
      g.rotateX(0.35);
      g.translate(0.5, 0, 0);
      g.rotateY((i / 6) * Math.PI * 2);
      parts.push(norm(g));
    }
    const rotor = merge(parts);
    const fanPos: THREE.Vector3[] = [];
    for (const z of [-9.6, -2.0]) {
      for (const x of [-21, -14, -7, 7, 14, 21]) {
        // dry cooler: legs, coil housing with louvred sides, fan deck with two shrouds
        for (const [ox, oz] of [[-2.6, -1.0], [2.6, -1.0], [-2.6, 1.0], [2.6, 1.0]]) b.add(galv, box(0.12, 0.6, 0.12, x + ox, top + 0.3, z + oz));
        b.add(galv, box(5.8, 0.12, 2.4, x, top + 0.62, z));
        b.add(lou, box(5.6, 1.3, 2.3, x, top + 1.33, z));
        b.add(galv, box(5.8, 0.1, 2.4, x, top + 2.03, z));
        for (const ox of [-1.4, 1.4]) {
          b.add(dark, place(new THREE.CylinderGeometry(1.02, 1.02, 0.45, 24, 1, true), x + ox, top + 2.3, z));
          b.add(dark, flipInside(place(new THREE.CylinderGeometry(1.0, 1.0, 0.45, 24, 1, true), x + ox, top + 2.3, z)));
          b.add(galv, place(new THREE.TorusGeometry(1.02, 0.03, 4, 24), x + ox, top + 2.52, z, Math.PI / 2));
          for (let k = 1; k <= 3; k++) b.add(galv, place(new THREE.TorusGeometry(k * 0.3, 0.008, 3, 20), x + ox, top + 2.55, z, Math.PI / 2));
          b.add(galv, box(2.0, 0.02, 0.03, x + ox, top + 2.55, z), box(0.03, 0.02, 2.0, x + ox, top + 2.55, z));
          fanPos.push(new THREE.Vector3(x + ox, top + 2.38, z));
        }
        this.col(x, top + 1.1, z, 2.9, 1.1, 1.2);
      }
    }
    this.fans = new THREE.InstancedMesh(rotor, M.black(), fanPos.length);
    const m = new THREE.Matrix4();
    fanPos.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      this.fanBase.push(m.clone());
      this.fans.setMatrixAt(i, m);
    });
    this.fans.castShadow = false;
    this.fans.name = 'dc-fans';
    this.near.add(this.fans);
    // the rooftop sign: a steel frame and a backlit panel facing the road, the site's beacon
    {
      const sx = -3, sz = 1.4, sy = top + 3.2, sw = 16, sh = 4;
      b.add(M.fascia(), box(sw + 0.5, sh + 0.5, 0.3, sx, sy + sh / 2, sz));
      this.d.add(this.screenOn.m, this.A.quad('logo', sw, sh, sx, sy + sh / 2, sz + 0.16));
      for (let x = sx - sw / 2 + 1; x <= sx + sw / 2 - 0.9; x += 3.5) {
        b.add(galv, box(0.16, sy - top + 0.4, 0.16, x, (top + sy) / 2 + 0.2, sz - 0.25));
        b.add(galv, beam(new THREE.Vector3(x, top, sz - 1.7), new THREE.Vector3(x, sy + sh * 0.7, sz - 0.25), 0.05, 5));
        b.add(galv, box(0.5, 0.2, 0.5, x, top + 0.1, sz - 0.25));
      }
      b.add(galv, box(sw, 0.12, 0.12, sx, sy - 0.1, sz - 0.25), box(sw, 0.1, 0.5, sx, sy - 0.2, sz + 0.1));
      for (const x of [sx - sw / 2 + 2, sx, sx + sw / 2 - 2]) {
        b.add(M.dark(), box(0.3, 0.2, 0.5, x, sy - 0.3, sz + 0.5));
        this.halo(x, sy + sh / 2, sz + 1.0, '#5ff4ec', 5.5, CH.NIGHT, 0.32);
      }
      this.farGlow.add(glow('#5ff4ec', 2.4).material, box(sw * 0.92, sh * 0.42, 0.1, sx, sy + sh / 2, sz + 0.2));
      this.farHalos.add(new THREE.Vector3(sx, sy + sh / 2, sz + 1.5), '#5ff4ec', 14, 0, 0.35);
    }
    // stair penthouse, roof hatch, vent stacks, a cable ladder across the roof
    b.add(M.panel(), box(3.2, 2.6, 3.0, 0, top + 1.3, -12.0));
    b.add(M.fascia(), box(3.4, 0.2, 3.2, 0, top + 2.7, -12.0));
    b.add(M.steel(), box(1.0, 2.1, 0.06, 0.3, top + 1.05, -10.48));
    for (const [x, z] of [[-24, -12.5], [-24, 2.5], [24, -12.5], [24, 2.5], [-3, -6], [3, -6]]) {
      b.add(galv, cyl(0.25, 0.25, 1.8, x, top + 0.9, z, 12));
      b.add(galv, place(new THREE.ConeGeometry(0.42, 0.35, 12), x, top + 1.95, z));
    }
    b.add(M.cable(), box(40, 0.08, 0.5, 0, top + 0.2, -5.8));
    // a few antennas and a dish to break the roofline from the road
    b.add(galv, cyl(0.04, 0.04, 4, -10, top + 2, 2.5, 6), cyl(0.03, 0.03, 3, 10, top + 1.5, 2.6, 6));
    const dg = new THREE.SphereGeometry(1.1, 16, 6, 0, Math.PI * 2, 0, 0.6);
    dg.rotateX(-1.1);
    dg.rotateY(0.4);
    dg.translate(18, top + 1.6, -12.6);
    b.add(M.white(), norm(dg), cyl(0.06, 0.06, 1.4, 18, top + 0.7, -12.6, 6));
  }

  // ------------------------------------------------------------------ loading dock + trailer
  private buildDock() {
    const { b, d, A } = this;
    const z = HALL.z1;
    this.solid(M.panelDark(), 13, 1.2, 3.5, 17.5, 0.6, z + 1.75);
    d.add(A.decal(), A.quad('hazard', 12.8, 0.12, 17.5, 1.12, z + 3.515));
    for (const x of [12.3, 15.7, 18.8, 22.2]) b.add(M.rubber(), box(0.3, 0.5, 0.18, x, 0.85, z + 3.6));
    for (const [x, open] of [[14, 0], [20.5, 0.35]] as const) {
      const h = 4.2;
      b.add(M.fascia(), box(4.4, 0.2, 0.25, x, 1.2 + h + 0.1, z + 0.12), box(0.2, h, 0.25, x - 2.1, 1.2 + h / 2, z + 0.12), box(0.2, h, 0.25, x + 2.1, 1.2 + h / 2, z + 0.12));
      b.add(M.roller(), box(4.0, h - open * h, 0.1, x, 1.2 + open * h + (h - open * h) / 2, z + 0.06));
      b.add(M.dark(), box(4.0, open * h + 0.02, 0.04, x, 1.2 + (open * h) / 2, z + 0.01));
      b.add(M.white(), box(4.3, 0.6, 0.5, x, 1.2 + h + 0.5, z + 0.25));
      b.add(M.dark(), box(0.45, 0.3, 0.32, x, 1.2 + h + 1.1, z + 0.17));
      this.slots.night.add(this.d, box(0.38, 0.04, 0.26, x, 1.2 + h + 0.94, z + 0.2));
      this.halo(x, 1.2 + h + 0.85, z + 0.4, '#ffe8c8', 1.2, CH.NIGHT, 2);
      d.add(this.poolNight.m, A.floor('poolWhite', 4.5, 4.5, x, 1.215, z + 2));
    }
    // bollards
    for (const x of [10.6, 24.4]) for (const zz of [z + 3.9, z + 5.0]) this.solid(M.yellow(), 0.24, 1.1, 0.24, x, 0.55, zz);
    // the trailer backed onto door 2: box, chassis, bogie, landing legs, its side art
    const tx = 20.5, t0 = z + 3.6, L = 12, tz = t0 + L / 2, fl = 1.25, th = 2.8;
    b.add(M.white(), box(2.6, th, L, tx, fl + th / 2, tz));
    b.add(M.fascia(), box(2.64, 0.1, L + 0.04, tx, fl + th, tz), box(2.64, 0.12, L + 0.04, tx, fl, tz));
    for (const s of [-1, 1]) {
      this.b.add(A.paint(), A.quad('trailer', L - 0.4, th - 0.25, tx + s * 1.305, fl + th / 2, tz, 0, s * Math.PI / 2, 0));
      b.add(M.dark(), box(0.12, 0.3, L - 1, tx + s * 0.55, fl - 0.2, tz));
    }
    for (const zz of [t0 + 1.4, t0 + 2.6]) for (const s of [-1, 1]) {
      b.add(M.rubber(), place(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 18), tx + s * 0.95, 0.5, zz, 0, 0, Math.PI / 2));
      b.add(M.galv(), place(new THREE.CylinderGeometry(0.28, 0.28, 0.52, 12), tx + s * 0.95, 0.5, zz, 0, 0, Math.PI / 2));
    }
    for (const s of [-1, 1]) b.add(M.steel(), box(0.12, 1.1, 0.12, tx + s * 0.8, 0.55, t0 + L - 3), box(0.3, 0.06, 0.3, tx + s * 0.8, 0.03, t0 + L - 3));
    this.col(tx, fl + th / 2, tz, 1.3, th / 2, L / 2);
    this.col(tx, 0.5, t0 + 2, 1.25, 0.5, 1.1);
    this.col(tx, 0.55, t0 + L - 3, 0.95, 0.55, 0.1);
  }

  // ------------------------------------------------------------------ water tanks + pump skid
  private buildTanks() {
    const { b, d, A } = this;
    const tank = M.tank(), galv = M.galv(), blue = M.blue();
    const tanks: [number, number, number, number][] = [[32.5, -9.5, 3.0, 14], [38.6, -8.6, 2.2, 10]];
    for (const [x, z, r, h] of tanks) {
      b.add(M.slab(), cyl(r + 0.4, r + 0.5, 0.3, x, 0.1, z, 24));
      b.add(tank, cyl(r, r, h, x, 0.25 + h / 2, z, 32));
      b.add(tank, place(new THREE.ConeGeometry(r + 0.08, 0.9, 32), x, 0.25 + h + 0.45, z));
      for (let k = 1; k < 4; k++) b.add(galv, place(new THREE.TorusGeometry(r + 0.02, 0.05, 4, 32), x, 0.25 + (k * h) / 4, z, Math.PI / 2));
      // caged ladder up the side facing the hall
      for (const o of [-0.25, 0.25]) b.add(galv, box(0.05, h + 0.6, 0.05, x - r - 0.15, (h + 0.6) / 2 + 0.25, z + o));
      for (let y = 0.6; y < h; y += 0.35) b.add(galv, box(0.04, 0.03, 0.5, x - r - 0.15, y, z));
      for (let y = 2.4; y < h; y += 1.2) b.add(galv, place(new THREE.TorusGeometry(0.42, 0.02, 3, 12, Math.PI), x - r - 0.4, y, z, Math.PI / 2, 0, Math.PI / 2));
      this.physics.addCylinder(this.frame.p(x, 0.25 + h / 2, z), h / 2, r);
      d.add(A.decal(), A.floor('dirt', r * 3, r * 3, x, 0.07, z));
    }
    // pump skid: header, two pumps, the tap with its red wheel (the cooling-loop interaction)
    const sx = 33, sz = -2.6;
    this.solid(M.slab(), 6, 0.25, 2.6, sx, 0.125, sz);
    b.add(blue, beam(new THREE.Vector3(sx - 3, 1.2, sz - 0.6), new THREE.Vector3(HALL.x1 + 0.45, 1.2, sz - 0.6), 0.2, 12));
    b.add(blue, beam(new THREE.Vector3(32.5, 1.2, -6.4), new THREE.Vector3(32.5, 1.2, sz - 0.6), 0.2, 12));
    b.add(blue, beam(new THREE.Vector3(HALL.x1 + 0.45, 1.2, sz - 0.6), new THREE.Vector3(HALL.x1 + 0.45, 1.2, -2.6), 0.2, 12));
    for (const px of [sx - 1.4, sx + 1.2]) {
      b.add(blue, place(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 16), px, 0.65, sz + 0.2, 0, 0, Math.PI / 2));
      b.add(M.steel(), place(new THREE.CylinderGeometry(0.24, 0.24, 0.7, 14), px + 0.75, 0.6, sz + 0.2, 0, 0, Math.PI / 2));
      b.add(blue, beam(new THREE.Vector3(px, 0.9, sz + 0.2), new THREE.Vector3(px, 1.2, sz - 0.6), 0.1, 8));
      for (let k = 0; k < 6; k++) b.add(M.steel(), box(0.02, 0.5, 0.4, px + 0.5 + k * 0.08, 0.6, sz + 0.2));
    }
    this.col(sx, 0.7, sz + 0.1, 2.6, 0.5, 0.6);
    const tapX = sx + 2.6, tapZ = sz + 0.9;
    b.add(blue, cyl(0.07, 0.07, 1.0, tapX, 0.75, tapZ - 0.6, 8));
    b.add(blue, beam(new THREE.Vector3(tapX, 1.2, tapZ - 0.6), new THREE.Vector3(tapX, 1.2, sz - 0.6), 0.07, 8));
    b.add(M.red(), place(new THREE.TorusGeometry(0.16, 0.025, 6, 18), tapX, 1.0, tapZ - 0.45), cyl(0.012, 0.012, 0.3, tapX, 1.0, tapZ - 0.45, 4, 0, 0, Math.PI / 2), cyl(0.012, 0.012, 0.3, tapX, 1.0, tapZ - 0.45, 4));
    b.add(M.galv(), cyl(0.06, 0.05, 0.15, tapX, 0.3, tapZ - 0.55, 8));
    b.add(M.galv(), cyl(0.17, 0.14, 0.32, tapX + 0.3, 0.16, tapZ - 0.2, 14));
    b.add(M.rubber(), place(new THREE.TorusGeometry(0.3, 0.035, 6, 20), tapX - 0.6, 0.04, tapZ, Math.PI / 2), place(new THREE.TorusGeometry(0.26, 0.035, 6, 20), tapX - 0.6, 0.1, tapZ, Math.PI / 2));
    d.add(A.decal(), A.floor('oil', 1.6, 1.6, tapX, 0.075, tapZ - 0.3));
    this.pts.tap = new THREE.Vector3(tapX, 0, tapZ + 0.5);
  }

  // ------------------------------------------------------------------ transformer yard + switchgear
  private buildYard() {
    const { b, d, A } = this;
    const x0 = -45, x1 = -30, z0 = -15.5, z1 = 2;
    b.add(M.gravel(), box(x1 - x0, 0.14, z1 - z0, (x0 + x1) / 2, 0.02, (z0 + z1) / 2));
    const xf = M.xfmr(), cer = M.ceramic();
    const bushing = (x: number, y: number, z: number, n: number, rr = 0.15) => {
      for (let k = 0; k < n; k++) {
        b.add(cer, cyl(rr, rr, 0.06, x, y + k * 0.12, z, 10));
        b.add(cer, cyl(rr * 0.6, rr * 0.6, 0.07, x, y + k * 0.12 + 0.06, z, 8));
      }
      b.add(M.galv(), cyl(0.03, 0.03, 0.2, x, y + n * 0.12 + 0.05, z, 6));
      return new THREE.Vector3(x, y + n * 0.12 + 0.15, z);
    };
    const tops: THREE.Vector3[] = [];
    for (const [tz, i] of [[-10, 0], [-3, 1]] as const) {
      const tx = -40.5;
      b.add(M.panelDark(), box(3.0, 0.3, 2.4, tx, 0.15, tz));
      b.add(xf, box(2.6, 2.3, 1.7, tx, 1.45, tz));
      for (let k = 0; k < 8; k++) for (const s of [-1, 1]) b.add(xf, box(0.05, 1.8, 0.55, tx - 1.05 + k * 0.3, 1.35, tz + s * 1.12));
      b.add(xf, place(new THREE.CylinderGeometry(0.36, 0.36, 1.6, 14), tx + 0.9, 3.1, tz, Math.PI / 2));
      b.add(M.galv(), box(0.06, 0.5, 0.06, tx + 0.9, 2.75, tz - 0.6), box(0.06, 0.5, 0.06, tx + 0.9, 2.75, tz + 0.6));
      for (const oz of [-0.55, 0, 0.55]) tops.push(bushing(tx - 0.5, 2.6, tz + oz, 7));
      for (const oz of [-0.4, 0, 0.4]) bushing(tx + 0.35, 2.6, tz + oz, 3, 0.1);
      this.col(tx, 1.4, tz, 1.4, 1.4, 1.2);
      if (i === 0) {
        d.add(A.decal(), A.quad('soot', 1.4, 1.2, tx - 0.5, 2.62, tz + 0.55, -Math.PI / 2, 0, 0), A.quad('soot', 1.2, 1.4, tx - 0.5, 2.0, tz + 0.86, 0, 0, Math.PI));
        this.pts.spark = tops[2].clone();
        this.slots.spark.add(this.d, place(new THREE.SphereGeometry(0.06, 8, 6), tops[2].x, tops[2].y - 0.05, tops[2].z));
        this.halo(tops[2].x, tops[2].y, tops[2].z, '#bfe6ff', 2.2, CH.SPARK, 2.5);
      }
    }
    // gantry: two H-frames, insulator strings, conductors to the bushings and on to the hall
    const st = M.galv();
    const gx = -34;
    for (const gz of [-12, -1]) {
      for (const o of [-0.6, 0.6]) b.add(st, box(0.22, 7.2, 0.22, gx + o, 3.6, gz));
      b.add(st, box(1.6, 0.25, 0.25, gx, 7.0, gz));
      for (let y = 1; y < 7; y += 1.2) b.add(st, beam(new THREE.Vector3(gx - 0.6, y, gz), new THREE.Vector3(gx + 0.6, y + 1.2, gz), 0.035, 4));
      this.col(gx, 3.6, gz, 0.75, 3.6, 0.14);
    }
    b.add(st, box(0.25, 0.3, 11.25, gx, 7.0, -6.5));
    const cond = M.cable();
    for (let k = 0; k < 3; k++) {
      const z = -9.6 + k * 3.2;
      for (let n = 0; n < 5; n++) b.add(cer, cyl(0.1, 0.1, 0.05, gx, 6.75 - n * 0.09, z, 8));
      const hang = new THREE.Vector3(gx, 6.3, z);
      b.add(cond, wire(hang, tops[k], 0.4, 0.018, 12));
      b.add(cond, wire(hang, tops[3 + k], 0.45, 0.018, 12));
      b.add(cond, wire(hang, new THREE.Vector3(HALL.x0 - 0.3, 6.3, -6.5 + (k - 1) * 1.2), 0.9, 0.02, 16));
      b.add(cer, cyl(0.08, 0.08, 0.35, HALL.x0 - 0.2, 6.3, -6.5 + (k - 1) * 1.2, 8, 0, 0, Math.PI / 2));
    }
    // fence around the yard (gate pushed open on its east side)
    const link = chainLink();
    const H = 2.6;
    const sides: [number, number, number, number][] = [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, -7.4], [x1, -4.6, x1, z1]];
    const panels: THREE.BufferGeometry[] = [];
    for (const [ax, az, bx, bz] of sides) {
      panels.push(this.linkPanel(ax, 0, az, bx, 0, bz, H));
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 3));
      for (let i = 0; i <= n; i++) b.add(st, cyl(0.04, 0.04, H + 0.3, ax + ((bx - ax) * i) / n, (H + 0.3) / 2, az + ((bz - az) * i) / n, 6));
      b.add(st, beam(new THREE.Vector3(ax, H, az), new THREE.Vector3(bx, H, bz), 0.025, 5));
      b.add(M.cable(), wire(new THREE.Vector3(ax, H + 0.25, az), new THREE.Vector3(bx, H + 0.25, bz), 0.05, 0.008, 16));
      this.col((ax + bx) / 2, H / 2, (az + bz) / 2, Math.abs(bx - ax) / 2 + 0.05, H / 2 + 0.3, Math.abs(bz - az) / 2 + 0.05);
    }
    // the gate leaf swung back into the yard
    panels.push(this.linkPanel(x1, 0, -7.4, x1 - 2.0, 0, -6.5, H - 0.2));
    this.d.add(link, ...panels);
    this.col(x1 - 1.0, H / 2, -6.95, 1.05, H / 2, 0.08, -Math.atan2(0.9, -2.0));
    this.b.add(this.A.paint(), A.quad('hvSign', 0.9, 0.68, x1 + 0.05, 1.5, -9.4, 0, Math.PI / 2, 0), A.quad('hvSign', 0.9, 0.68, -37.5, 1.5, z1 + 0.05));
    // switchgear in the gap between the yard and the hall (the electronics interaction)
    const sw = new THREE.Vector3(-27.2, 0, -10.5);
    this.solid(M.white(), 0.9, 2.2, 2.6, sw.x, 1.1, sw.z);
    b.add(M.white(), box(1.0, 0.1, 2.7, sw.x, 2.25, sw.z));
    for (const oz of [-0.65, 0.65]) {
      this.b.add(this.A.paint(), A.quad('vent', 1.1, 0.5, sw.x - 0.455, 1.75, sw.z + oz, 0, -Math.PI / 2, 0));
      b.add(M.dark(), box(0.04, 0.2, 0.05, sw.x - 0.47, 1.1, sw.z + oz + 0.45));
    }
    this.d.add(this.screenPower.m, A.quad('dash', 0.6, 0.3, sw.x - 0.458, 1.25, sw.z - 0.62, 0, -Math.PI / 2, 0));
    this.slots.red.add(this.d, box(0.01, 0.05, 0.05, sw.x - 0.46, 1.25, sw.z + 0.3));
    this.slots.amber.add(this.d, box(0.01, 0.05, 0.05, sw.x - 0.46, 1.25, sw.z + 0.4));
    this.halo(sw.x - 0.5, 1.25, sw.z + 0.35, '#ff3324', 0.3, CH.BLINK, 1.5);
    for (const oz of [-0.9, 0, 0.9]) b.add(M.cable(), cyl(0.05, 0.05, 4.5, sw.x + 0.3, 4.5, sw.z + oz, 6));
    this.pts.switchgear = new THREE.Vector3(sw.x - 1.2, 0, sw.z);
    d.add(A.decal(), A.floor('dirt', 3, 3, sw.x - 1.2, 0.08, sw.z));
  }

  // ------------------------------------------------------------------ comms mast
  private buildMast() {
    const { b } = this;
    const bx = -20, bz = -22, H = 28;
    b.add(M.slab(), box(4, 0.3, 4, bx, 0.1, bz));
    const red = M.red(), white = M.white();
    const corner = (i: number, t: number) => {
      const w = 1.0 + (0.35 - 1.0) * t;
      const a = (i / 3) * Math.PI * 2;
      return new THREE.Vector3(bx + Math.cos(a) * w, 0.3 + H * t, bz + Math.sin(a) * w);
    };
    const segs = 9;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const mat = s % 2 ? red : white;
      for (let i = 0; i < 3; i++) {
        const a0 = corner(i, t0), a1 = corner(i, t1), b0 = corner((i + 1) % 3, t0), b1 = corner((i + 1) % 3, t1);
        b.add(mat, beam(a0, a1, 0.06, 5), beam(a0, b1, 0.025, 4), beam(b0, a1, 0.025, 4), beam(a1, b1, 0.03, 4));
      }
    }
    this.col(bx, H / 2, bz, 0.8, H / 2, 0.8);
    for (const [y, ry, s] of [[20, 0.8, 0.9], [15, 2.6, 0.7]] as const) {
      const g = new THREE.SphereGeometry(s, 14, 6, 0, Math.PI * 2, 0, 0.6);
      g.rotateX(-Math.PI / 2);
      g.rotateY(ry);
      g.translate(bx + Math.sin(ry) * 0.6, y, bz + Math.cos(ry) * 0.6);
      b.add(white, norm(g));
    }
    b.add(M.galv(), cyl(0.03, 0.03, 4, bx, H + 2.3, bz, 5));
    const top = new THREE.Vector3(bx, H + 4.4, bz);
    this.slots.mast.add(this.d, place(new THREE.SphereGeometry(0.2, 10, 8), top.x, top.y, top.z));
    this.halo(top.x, top.y, top.z, '#ff2a1a', 2.6, CH.MAST, 3);
    const mastFar = glow('#ff2a1a', 0);
    this.farGlow.add(mastFar.material, place(new THREE.SphereGeometry(0.35, 8, 6), top.x, top.y, top.z));
    this.farHalos.add(top.clone(), '#ff2a1a', 6, 1, 3);
    this.mastFar = mastFar.intensity as unknown as { value: number };
    // equipment shelter
    this.solid(white, 2.4, 2.6, 2.4, bx + 3.4, 1.3, bz + 0.5);
    b.add(M.fascia(), box(2.6, 0.12, 2.6, bx + 3.4, 2.66, bz + 0.5));
    b.add(M.cable(), box(0.3, 0.1, 2.2, bx + 1.6, 2.3, bz + 0.3));
  }
  mastFar: { value: number } = { value: 0 };

  // ------------------------------------------------------------------ car park under the solar canopy
  private buildCarPark() {
    const { b, d, A } = this;
    const pv = pvMaterial();
    const galv = M.galv();
    const x0 = -41, x1 = -12;
    for (const cz of [14.5, 22.5]) {
      const top = 3.4;
      for (let x = x0 + 1.5; x <= x1 - 1; x += 6.75) {
        this.solid(galv, 0.28, top, 0.28, x, top / 2, cz);
        b.add(galv, box(0.18, 0.3, 5.4, x, top + 0.1, cz, 0, 0.14));
        b.add(M.dark(), box(0.5, 0.35, 0.5, x, 0.18, cz));
      }
      b.add(galv, box(x1 - x0, 0.14, 0.14, (x0 + x1) / 2, top + 0.42, cz - 1.6), box(x1 - x0, 0.14, 0.14, (x0 + x1) / 2, top - 0.02, cz + 1.6));
      for (let x = x0 + 0.5; x < x1; x += 1.04) {
        for (let k = 0; k < 3; k++) {
          if (this.r() < 0.06) continue;
          const zz = cz - 1.75 + k * 1.75;
          const y = top + 0.32 - (zz - cz) * 0.14;
          const g = new THREE.BoxGeometry(1.0, 0.04, 1.7);
          g.rotateX(0.14);
          g.translate(x, y, zz);
          b.add(pv, norm(g));
        }
      }
      // stalls and wheel stops, a couple of chargers
      for (let x = x0 + 1.3; x < x1 - 1; x += 2.7) {
        d.add(A.decal(), A.floor('parking', 2.7, 0.7, x + 1.35, 0.075, cz - 1.0));
        b.add(M.panelDark(), box(1.6, 0.14, 0.22, x + 1.35, 0.11, cz + 2.0));
      }
      for (const x of [x0 + 8.25, x0 + 21.75]) {
        this.solid(M.white(), 0.38, 1.5, 0.28, x, 0.75, cz + 2.3);
        b.add(M.dark(), box(0.3, 0.4, 0.02, x, 1.15, cz + 2.15));
        b.add(M.cable(), wire(new THREE.Vector3(x, 1.0, cz + 2.15), new THREE.Vector3(x + 1.2, 0.7, cz + 0.8), 0.6, 0.025, 10));
      }
      // night lamps under the canopy
      for (const x of [x0 + 7, x0 + 21]) {
        b.add(M.dark(), box(0.6, 0.08, 0.25, x, top - 0.06, cz));
        this.slots.night.add(this.d, box(0.55, 0.02, 0.2, x, top - 0.11, cz));
        this.halo(x, top - 0.2, cz, '#ffe8c8', 1.1, CH.NIGHT, 1.5);
        d.add(this.poolNight.m, A.floor('poolWhite', 6, 6, x, 0.08, cz));
      }
    }
    // modules that came down in a storm
    for (const [x, z, ry] of [[-30, 18.6, 0.4], [-18.5, 26.6, -0.7]] as const) {
      const g = new THREE.BoxGeometry(1.0, 0.04, 1.7);
      g.rotateZ(0.25);
      g.rotateY(ry);
      g.translate(x, 0.22, z);
      b.add(pv, norm(g));
    }
    // cars: two sedans, a wedge truck with a tent on it
    this.sedan(-36.5, 13.6, 0.05, '#e4e2dc', 31);
    this.sedan(-25.4, 21.8, -0.08, '#8c1d1a', 32);
    this.wedge(-19.5, 13.3, 0.12);
  }

  private sedan(x: number, z: number, ry: number, paint: string, seed: number) {
    const rand = rng(seed);
    const m = new THREE.Matrix4().makeRotationY(ry + Math.PI / 2).setPosition(x, 0, z);
    const res = buildCar(this.b, m, { kind: 'coupe', paint, rand, rust: 0.2, fade: 0.35, broken: 0.15, hood: 'shut', wheels: ['ok', 'ok', 'flat', 'ok'] });
    this.col(x, res.center.y, z, res.half.z, res.half.y, res.half.x, ry);
  }

  private wedge(x: number, z: number, ry: number) {
    const { b } = this;
    const g = new THREE.BoxGeometry(2.0, 1.3, 5.6, 1, 2, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i), zz = p.getZ(i);
      if (yy > 0.6) p.setY(i, zz > 0.5 ? 0.25 : zz < -0.5 ? 0.35 : 0.95);
      if (yy > 0 && yy < 0.6 && zz > 0.5) p.setY(i, 0.1);
    }
    g.computeVertexNormals();
    g.translate(0, 0.95, 0);
    g.rotateY(ry);
    g.translate(x, 0, z);
    b.add(M.carSteel(), norm(g));
    const glassG = new THREE.BoxGeometry(1.7, 0.02, 1.3);
    glassG.rotateX(0.62);
    glassG.translate(0, 1.66, 0.95);
    glassG.rotateY(ry);
    glassG.translate(x, 0, z);
    b.add(M.carGlass(), norm(glassG));
    for (const [wx, wz] of [[-0.95, 1.75], [0.95, 1.75], [-0.95, -1.75], [0.95, -1.75]]) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16).rotateZ(Math.PI / 2).translate(wx, 0.42, wz);
      w.rotateY(ry);
      w.translate(x, 0, z);
      b.add(M.rubber(), norm(w));
    }
    // a rooftop tent: someone camped here waiting for the doors to open
    const tent = new THREE.ConeGeometry(1.0, 0.9, 4, 1, true);
    tent.rotateY(Math.PI / 4);
    tent.scale(1, 1, 1.5);
    tent.translate(0, 2.4, -0.6);
    tent.rotateY(ry);
    tent.translate(x, 0, z);
    b.add(fabric('#a8642c'), norm(tent));
    this.col(x, 0.95, z, 1.0, 0.95, 2.8, ry);
  }

  // ------------------------------------------------------------------ transmission line into the yard
  private buildPowerLine() {
    const { b } = this;
    const st = rustyMetal({ base: '#8d918f', rust: 0.25, metalness: 0.7, roughness: 0.45 });
    const cer = M.ceramic(), cond = M.cable();
    const arms: THREE.Vector3[][] = [];
    const towers: [number, number][] = [[-72, -9], [-114, -15], [-156, -22]];
    for (const [tx, tz] of towers) {
      const H = 24, base = 2.6, waist = 0.9;
      const legs: THREE.Vector3[] = [];
      const gy = this.ground(tx, tz);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) legs.push(new THREE.Vector3(tx + sx * base, this.ground(tx + sx * base, tz + sz * base) - 0.3, tz + sz * base));
      const at = (i: number, t: number) => {
        const [sx, sz] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][i];
        const w = base + (waist - base) * Math.min(1, t * 1.25);
        const y = THREE.MathUtils.lerp(legs[i].y, gy + H, t);
        return new THREE.Vector3(tx + sx * w, y, tz + sz * w);
      };
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs;
        for (let i = 0; i < 4; i++) {
          const a0 = at(i, t0), a1 = at(i, t1), b0 = at((i + 1) % 4, t0), b1 = at((i + 1) % 4, t1);
          b.add(st, beam(a0, a1, 0.09, 5), beam(a0, b1, 0.04, 4), beam(b0, a1, 0.04, 4), beam(a1, b1, 0.05, 4));
        }
      }
      for (const l of legs) b.add(M.panelDark(), box(0.8, 0.5, 0.8, l.x, l.y + 0.25, l.z));
      for (const l of legs) this.col(l.x, l.y + 2, l.z, 0.3, 2, 0.3);
      // cross arms (along z, across the line) with insulator strings
      const level: THREE.Vector3[] = [];
      for (const [ay, span] of [[gy + H * 0.78, 6.5], [gy + H * 0.93, 4.5]] as const) {
        b.add(st, box(0.3, 0.4, span * 2, tx, ay, tz));
        b.add(st, beam(new THREE.Vector3(tx, ay - 1.4, tz - waist), new THREE.Vector3(tx, ay, tz - span), 0.05, 4), beam(new THREE.Vector3(tx, ay - 1.4, tz + waist), new THREE.Vector3(tx, ay, tz + span), 0.05, 4));
        for (const oz of ay > gy + H * 0.9 ? [0] : [-span + 0.4, span - 0.4]) {
          for (let n = 0; n < 7; n++) b.add(cer, cyl(0.13, 0.13, 0.05, tx, ay - 0.35 - n * 0.14, tz + oz, 8));
          level.push(new THREE.Vector3(tx, ay - 1.4, tz + oz));
        }
      }
      b.add(st, beam(new THREE.Vector3(tx, gy + H, tz), new THREE.Vector3(tx, gy + H + 2.5, tz), 0.06, 4));
      arms.push(level);
    }
    // conductors: gantry → towers, sagging; the last span is down, its ends lying in the sand
    const gantry = [new THREE.Vector3(-34, 6.3, -9.6), new THREE.Vector3(-34, 6.3, -3.2), new THREE.Vector3(-34, 6.3, -6.4)];
    for (let k = 0; k < 3; k++) b.add(cond, wire(gantry[k], arms[0][k], 2.2, 0.02, 18));
    for (let i = 0; i < arms.length - 1; i++) for (let k = 0; k < 3; k++) b.add(cond, wire(arms[i][k], arms[i + 1][k], 3.2, 0.02, 20));
    const last = arms[arms.length - 1];
    for (let k = 0; k < 3; k++) {
      const end = last[k].clone().add(new THREE.Vector3(-14 - k * 3, 0, -4 + k * 2));
      end.y = this.ground(end.x, end.z) + 0.05;
      b.add(cond, wire(last[k], end, 1.5, 0.02, 14));
    }
  }

  // ------------------------------------------------------------------ fence, gate, gatehouse, monument
  private buildFence() {
    const { b, A } = this;
    const H = 2.8, st = M.galv();
    const link = chainLink();
    const panels: THREE.BufferGeometry[] = [];
    const run = (pts: [number, number][], broken = false) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 3));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const px = ax + (bx - ax) * t0, pz = az + (bz - az) * t0;
          const qx = ax + (bx - ax) * t1, qz = az + (bz - az) * t1;
          const gy0 = this.ground(px, pz), gy1 = this.ground(qx, qz);
          const last = broken && i === pts.length - 2 && k >= n - 2;
          if (last) {
            // fallen panels: flat on the sand beside the line, no collider
            const dx = (qx - px) / (len / n), dz = (qz - pz) / (len / n);
            const ox = -dz * (k % 2 ? -1 : 1) * (H - 0.3), oz = dx * (k % 2 ? -1 : 1) * (H - 0.3);
            const g = new THREE.BufferGeometry();
            const a = [px, gy0 + 0.06, pz], c = [qx, gy1 + 0.06, qz], e = [qx + ox, gy1 + 0.1, qz + oz], f = [px + ox, gy0 + 0.1, pz + oz];
            const l = len / n, hh = H - 0.3;
            g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, ...e, ...a, ...e, ...f], 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, l, 0, l, hh, 0, 0, l, hh, 0, hh], 2));
            g.computeVertexNormals();
            panels.push(norm(g));
            b.add(st, beam(new THREE.Vector3(px, gy0 + 0.08, pz), new THREE.Vector3(px + ox * 1.1, gy0 + 0.12, pz + oz * 1.1), 0.05, 6));
            continue;
          }
          panels.push(this.linkPanel(px, gy0, pz, qx, gy1, qz, H - 0.1));
          b.add(st, cyl(0.05, 0.05, H + 0.5, px, gy0 + (H + 0.5) / 2 - 0.1, pz, 6));
          b.add(st, beam(new THREE.Vector3(px, gy0 + H, pz), new THREE.Vector3(qx, gy1 + H, qz), 0.03, 5));
          for (const o of [0.2, 0.42]) b.add(M.cable(), wire(new THREE.Vector3(px, gy0 + H + o, pz), new THREE.Vector3(qx, gy1 + H + o, qz), 0.04, 0.007, 8));
          const cy = (gy0 + gy1) / 2 + H / 2;
          this.col((px + qx) / 2, cy, (pz + qz) / 2, len / n / 2 + 0.04, H / 2 + Math.abs(gy1 - gy0) / 2 + 0.3, 0.06, -Math.atan2(qz - pz, qx - px));
        }
      }
    };
    run([[-46, -4], [-46, 28], [-6, 28]], false);
    run([[6, 28], [43, 28], [43, -2]], true);
    run([[-46, -4], [-46, -12]], true);
    this.d.add(link, ...panels);
    // the gate: a sliding leaf shoved open, a barrier arm snapped and pointing at the sky
    const gy = this.ground(0, 28);
    const leaf = [this.linkPanel(6.2, gy + 0.1, 28.4, 13.2, gy + 0.1, 28.4, H - 0.4)];
    this.d.add(link, ...leaf);
    b.add(st, beam(new THREE.Vector3(6.2, gy + 0.15, 28.4), new THREE.Vector3(13.2, gy + 0.15, 28.4), 0.05, 6), beam(new THREE.Vector3(6.2, gy + H - 0.3, 28.4), new THREE.Vector3(13.2, gy + H - 0.3, 28.4), 0.05, 6));
    b.add(st, beam(new THREE.Vector3(6.2, gy + 0.15, 28.4), new THREE.Vector3(13.2, gy + H - 0.3, 28.4), 0.04, 5));
    this.col(9.7, gy + H / 2, 28.4, 3.55, H / 2, 0.08);
    this.solid(M.yellow(), 0.45, 1.1, 0.45, -5.6, gy + 0.55, 28.6);
    for (let k = 0; k < 6; k++) {
      const a = new THREE.Vector3(-5.6, gy + 1.0, 28.6).add(new THREE.Vector3(0.45, 0.82, 0).multiplyScalar(k * 0.75));
      const c = a.clone().add(new THREE.Vector3(0.45, 0.82, 0).multiplyScalar(0.75));
      b.add(k % 2 ? M.white() : M.red(), beam(a, c, 0.06, 6));
    }
    // gatehouse: a booth with windows on three sides, the visitor log on the sill
    const gx = 8.3, gz = 25.2, w = 3.4, dd = 3.4, h = 2.9;
    const g0 = this.ground(gx, gz);
    const wall = M.white();
    b.add(M.slab(), box(w + 0.6, 0.25, dd + 0.6, gx, g0 + 0.05, gz));
    this.col(gx, g0 + 0.05, gz, w / 2 + 0.3, 0.125, dd / 2 + 0.3);
    const fy = g0 + 0.18;
    // road side (+z): sill wall and an open service window; west side glazed; east side solid;
    // the door is on the hall side (-z)
    this.solid(wall, w, 1.0, 0.15, gx, fy + 0.5, gz + dd / 2);
    b.add(wall, box(w, h - 2.4, 0.15, gx, fy + 2.4 + (h - 2.4) / 2, gz + dd / 2));
    this.solid(wall, 0.15, 1.0, dd, gx - w / 2, fy + 0.5, gz);
    b.add(wall, box(0.15, h - 2.4, dd, gx - w / 2, fy + 2.4 + (h - 2.4) / 2, gz));
    this.solid(wall, 0.15, h, dd, gx + w / 2, fy + h / 2, gz);
    this.solid(wall, w - 1.7, h, 0.15, gx + 0.85, fy + h / 2, gz - dd / 2);
    b.add(wall, box(1.7, h - 2.25, 0.15, gx - w / 2 + 0.85, fy + 2.25 + (h - 2.25) / 2, gz - dd / 2));
    const glass = glassMaterial();
    this.d.add(glass, box(0.03, 1.4, dd - 0.2, gx - w / 2, fy + 1.7, gz));
    this.col(gx - w / 2, fy + 1.7, gz, 0.06, 0.7, dd / 2);
    for (const o of [-1.1, 0, 1.1]) b.add(M.fascia(), box(0.06, 1.4, 0.06, gx + o, fy + 1.7, gz + dd / 2), box(0.06, 1.4, 0.06, gx - w / 2, fy + 1.7, gz + o));
    b.add(M.fascia(), box(w + 0.5, 0.25, dd + 0.5, gx, fy + h + 0.12, gz));
    b.add(M.fascia(), box(w + 0.02, 0.1, 0.3, gx, fy + 1.02, gz + dd / 2 - 0.05), box(0.18, 0.1, dd + 0.02, gx - w / 2, fy + 1.02, gz));
    // desk, monitor, chair, the log book
    b.add(M.desk(), box(w - 0.4, 0.05, 0.6, gx, fy + 0.95, gz + dd / 2 - 0.4));
    b.add(M.dark(), box(0.5, 0.36, 0.05, gx + 0.6, fy + 1.2, gz + dd / 2 - 0.5));
    b.add(plainStandard('#3c2a1a', 0.8), box(0.42, 0.04, 0.3, gx - 0.5, fy + 0.995, gz + dd / 2 - 0.3, 0.2));
    b.add(plainStandard('#e8e2d0', 0.9), box(0.4, 0.012, 0.28, gx - 0.5, fy + 1.02, gz + dd / 2 - 0.3, 0.2));
    b.add(M.dark(), box(0.45, 0.06, 0.45, gx, fy + 0.5, gz + 0.4), box(0.45, 0.5, 0.06, gx, fy + 0.8, gz + 0.15));
    this.b.add(this.A.paint(), A.quad('gateSign', 2.2, 1.1, -12, this.ground(-12, 28.2) + 1.6, 28.12));
    this.pts.gatehouse = new THREE.Vector3(gx - 0.5, fy, gz + dd / 2 - 0.3);
    // gate floodlight (night) on a pole by the barrier
    const lx = -5.6, lz = 26.6;
    const ly = this.ground(lx, lz);
    b.add(st, cyl(0.1, 0.13, 6, lx, ly + 3, lz, 8));
    b.add(M.dark(), box(0.6, 0.35, 0.4, lx, ly + 6, lz - 0.2, 0, -0.5));
    this.slots.night.add(this.d, box(0.5, 0.25, 0.04, lx, ly + 5.92, lz - 0.42, 0, -0.5));
    this.halo(lx, ly + 5.9, lz - 0.5, '#fff0d0', 2.4, CH.NIGHT, 3);
    this.farHalos.add(new THREE.Vector3(lx, ly + 5.9, lz - 0.5), '#fff0d0', 5, 0, 1.5);
    this.col(lx, ly + 3, lz, 0.15, 3, 0.15);
    this.gateCone = lightCone(9, 5, '#ffe6c0', 0);
    this.gateCone.mesh.position.set(lx, ly + 5.9, lz - 0.3);
    this.gateCone.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(3, -5.9, -5).normalize());
    this.near.add(this.gateCone.mesh);
    this.d.add(this.poolNight.m, A.floor('poolWhite', 10, 10, lx + 3, ly + 0.09, lz - 5));
    // monument sign by the road
    const mx = -9, mz = 33, my = this.ground(mx, mz);
    this.solid(M.panelDark(), 4.6, 1.8, 0.7, mx, my + 0.9, mz);
    b.add(M.fascia(), box(4.7, 0.12, 0.8, mx, my + 1.85, mz));
    this.d.add(this.screenOn.m, A.quad('monument', 4.2, 2.1, mx, my + 0.95, mz + 0.36));
    this.halo(mx, my + 1.0, mz + 1.0, '#5ff4ec', 3.5, CH.NIGHT, 0.4);
  }
}

