import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, float, uniform, uv, texture, smoothstep, mix, color, positionWorld, cameraPosition, exp } from 'three/tsl';
import type { GameContext, Action } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';
import { box, cyl, beam, wire, norm, MeshBatch } from '../world/kit';
import { rustyMetal, concrete, corrugated, plainStandard, fabric, wood, type GlowSlot } from '../world/materials';
import { VirtualLight } from '../world/lights';
import { buildCar, type CarKind } from '../world/vehicles';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import {
  SiteKit, mat4, xf, v3, rng, decal, floorDecal, decalMat, glowDecalMat, atlasSolid, atlasMap, beamMaterial, beamTube,
  uSiteNight, uSiteFlicker, glassMat, type Col,
} from './jetKit';
import { screenTexture, marqueeTexture, neonTexture, drawKeynote, keynoteTint, CUES, KEYNOTE_LEN, REVEAL_AT } from './driveinArt';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Starlite Drive-In. The last screening was Hunter Vale's EXIT keynote, and the reel is still
 * threaded. Restart the generator, get into the booth, start the projector: at night a flickering
 * beam throws the keynote 50 m onto a torn screen you can see from the highway, the speaker posts
 * play the applause, and the end of the reel is the part he forgot to cut.
 *
 * Local frame: the screen is at z ≈ −32 facing +z; four arcs of car ramps; the snack bar and the
 * projection booth at z 20–29; the entrance, ticket booth and marquee at z ≈ 40–47.
 */

const SCREEN = { x0: -15, x1: 15, y0: 5.5, y1: 19.5, z: -32 };
const COLS = 8, ROWS = 4;
const BLD = { x0: -8, x1: 8, z0: 20, z1: 29, h: 3.6, t: 0.25 };
const PORT = v3(0, 1.62, 20);

const M = () => ({
  block: concrete('#cbbfa6', { stains: 0.9, scale: 2.4 }),
  slab: concrete('#8e877c', { stains: 0.6 }),
  red: rustyMetal({ base: '#a8321f', rust: 0.45, metalness: 0.35, roughness: 0.6 }),
  cream: rustyMetal({ base: '#e2d6b8', rust: 0.35, metalness: 0.3, roughness: 0.6 }),
  teal: rustyMetal({ base: '#3f6e6a', rust: 0.55, metalness: 0.4, roughness: 0.55 }),
  steel: rustyMetal({ base: '#7b7a74', rust: 0.6, metalness: 0.7, roughness: 0.5 }),
  girder: rustyMetal({ base: '#5b4c44', rust: 0.75, metalness: 0.6, roughness: 0.6 }),
  yellow: rustyMetal({ base: '#d6a62a', rust: 0.45, metalness: 0.35, roughness: 0.5 }),
  stainless: rustyMetal({ base: '#c4c8cc', rust: 0.08, metalness: 1, roughness: 0.3 }),
  chrome: rustyMetal({ base: '#c4c8cc', rust: 0.25, metalness: 1, roughness: 0.25 }),
  projector: rustyMetal({ base: '#3e4a48', rust: 0.25, metalness: 0.6, roughness: 0.45 }),
  baseWall: corrugated('#456c66', 0.65, 'y'),
  fence: corrugated('#8b8478', 0.75, 'y'),
  roof: corrugated('#7d776c', 0.7, 'x'),
  dark: plainStandard('#1c1f22', 0.5, 0.4),
  rubber: plainStandard('#151311', 0.95),
  cable: plainStandard('#161616', 0.6, 0.4),
  taillight: plainStandard('#5a1410', 0.4, 0.1),
  white: plainStandard('#e8e2d2', 0.5, 0.05),
  black: plainStandard('#0e0e0e', 0.6, 0.1),
  counterWood: wood('#6a4a2c'),
  plank: wood('#8a6a44'),
  seatFab: fabric('#3a3028', 0.95),
  redVinyl: fabric('#8e2a22', 0.6),
  awningR: fabric('#a8321f', 0.85),
  awningW: fabric('#e8dcc0', 0.85),
  tarp: fabric('#4a5a6a', 0.9),
});
type Mats = ReturnType<typeof M>;

const CAR_COLORS = ['#4e8a86', '#d8cfb8', '#9a3a2c', '#c49a3a', '#7f9fb6', '#2a2a2a', '#6b7f4a', '#b86a3a'];

export class DriveInSite extends Site {
  private kit: SiteKit;
  private mats!: Mats;
  // the spectacle
  private keyCanvas = document.createElement('canvas');
  private keyCtx!: CanvasRenderingContext2D;
  private keyTex!: THREE.CanvasTexture;
  private screenMesh!: THREE.Mesh;
  private uProj = uniform(0);
  private beam = beamMaterial('#e8f0ff', 0);
  private beamMesh!: THREE.Mesh;
  private screenLight!: VirtualLight;
  private boothLight!: VirtualLight;
  private hallLight!: VirtualLight;
  private tint = new THREE.Color();
  private kt = 0;
  private frameAcc = 0;
  private frameNo = 0;
  private cue = 0;
  private reels: THREE.Object3D[] = [];
  // neon, marquee, lights
  private uNeon = uniform(0);
  private uNeonAll = uniform(0);
  private uBoard = uniform(0);
  private tubes!: GlowSlot;
  private bulbs: GlowSlot[] = [];
  private portGlow!: GlowSlot;
  private genLed!: GlowSlot;
  // doors and things that leave
  private door!: { pivot: THREE.Object3D; collider: Col; open: number; target: number };
  private ticketDoor!: { pivot: THREE.Object3D; open: number; target: number };
  private reelCan!: THREE.Object3D;
  // audio loops started by the site itself (state-dependent)
  private loops: Record<string, ReturnType<GameContext['audio']['loop']>> = {};
  private lastState: unknown = null;
  private t = 0;
  private readonly heart = v3(0, 0, -2);

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('drivein', ctx, landmarks);
    this.kit = new SiteKit(this.frame, ctx.physics, ctx.hf);
    this.mats = M();
    const root = new THREE.Group();
    root.name = 'drivein-root';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);

    const pal = this.kit.pal;
    this.tubes = pal.slot('#e8f4ff', 0);
    this.portGlow = pal.slot('#ffe6b8', 0);
    this.genLed = pal.slot('#ff3a2a', 2);
    for (let i = 0; i < 3; i++) this.bulbs.push(pal.slot('#ffd38a', 0));

    this.buildScreenStructure();
    this.buildLot();
    this.buildBuilding();
    this.buildEntrance();
    this.buildFence();
    this.buildPlayground();

    const { near, far } = this.kit.build(root, ctx.scene, 'drivein');
    this.buildMoving(near);
    this.buildSpectacle(root);
    this.buildMarqueeFaces(root);
    this.lod(near, far, 50);

    this.screenLight = new VirtualLight(0xffffff, 0, 90, 1.25);
    this.screenLight.position.copy(this.frame.p(0, 10, -22));
    this.boothLight = new VirtualLight(0xffd8a0, 0, 7, 1.6);
    this.boothLight.position.copy(this.frame.p(0, 2.6, 22.2));
    this.hallLight = new VirtualLight(0xe8f0ff, 0, 11, 1.5);
    this.hallLight.position.copy(this.frame.p(0, 3.2, 26.8));

    this.buildInteractables();
    this.landmarks.audioSpots.push({ kind: 'wind-hollow', pos: this.frame.p(4, 14, -32) });
    this.landmarks.audioSpots.push({ kind: 'neon', pos: this.frame.p(-22, 8, 45.5) });
  }

  // ================================================================ helpers
  private wallX(mat: THREE.Material, x0: number, x1: number, z: number, y0: number, y1: number, t = BLD.t) {
    if (x1 - x0 < 0.04 || y1 - y0 < 0.04) return;
    this.kit.b.add(mat, box(x1 - x0, y1 - y0, t, (x0 + x1) / 2, (y0 + y1) / 2, z));
    this.kit.col((x0 + x1) / 2, (y0 + y1) / 2, z, (x1 - x0) / 2, (y1 - y0) / 2, t / 2);
  }
  private wallZ(mat: THREE.Material, x: number, z0: number, z1: number, y0: number, y1: number, t = BLD.t) {
    if (z1 - z0 < 0.04 || y1 - y0 < 0.04) return;
    this.kit.b.add(mat, box(t, y1 - y0, z1 - z0, x, (y0 + y1) / 2, (z0 + z1) / 2));
    this.kit.col(x, (y0 + y1) / 2, (z0 + z1) / 2, t / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  }
  private dec(name: string, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    this.kit.d.add(decalMat(), decal(name, w, h, mat4(x, y, z, rx, ry, rz)));
  }
  private g(x: number, z: number) { return this.kit.ground(x, z); }

  // ================================================================ the screen
  private buildScreenStructure() {
    const k = this.mats, b = this.kit.b;
    const { x0, x1, y0, y1, z } = SCREEN;
    // tower base under the screen: corrugated wall with a faded starburst mural
    b.add(k.baseWall, box(x1 - x0 + 2, y0, 0.3, 0, y0 / 2, z - 0.7));
    this.kit.col(0, y0 / 2, z - 0.7, (x1 - x0 + 2) / 2, y0 / 2, 0.2);
    b.add(k.red, box(x1 - x0 + 2.2, 0.25, 0.4, 0, y0 - 0.05, z - 0.65));
    this.dec('starburst', 5.2, 5.2, 0, 2.7, z - 0.53);
    this.dec('streaks', 6, 3, -8, 3.6, z - 0.53);
    this.dec('streaks', 6, 3, 9, 3.6, z - 0.53);
    // columns, girts, back struts, catwalk
    const colXs = [-15, -10, -5, 0, 5, 10, 15];
    for (const x of colXs) {
      b.add(k.girder, box(0.36, y1 + 1.2, 0.36, x, (y1 + 1.2) / 2, z - 1.0));
      b.add(k.girder, box(0.12, y1 + 1.2, 0.5, x, (y1 + 1.2) / 2, z - 1.0));
      this.kit.col(x, (y1 + 1.2) / 2, z - 1.0, 0.2, (y1 + 1.2) / 2, 0.2);
      // A-frame strut down to a footing behind
      const top = v3(x, 15.5, z - 1.1), foot = v3(x, 0, z - 7.5);
      b.add(k.girder, beam(top, foot, 0.14, 6));
      b.add(k.slab, box(0.9, 0.5, 0.9, x, 0.2, z - 7.5));
      const mid = top.clone().lerp(foot, 0.5);
      this.kit.ocol(new THREE.Matrix4().lookAt(top, foot, v3(0, 1, 0)).setPosition(mid), 0.16, 0.16, top.distanceTo(foot) / 2);
      b.add(k.girder, beam(v3(x, 7, z - 1.1), top.clone().lerp(foot, 0.62), 0.06, 4));
    }
    for (const y of [y0, 9, 12.5, 16, y1]) b.add(k.girder, box(x1 - x0 + 0.6, 0.25, 0.2, 0, y, z - 0.75));
    for (let i = 0; i < colXs.length - 1; i++) {
      for (const [ya, yb] of [[y0, 12.5], [12.5, y1]]) {
        const xa = colXs[i], xb = colXs[i + 1];
        b.add(k.steel, beam(v3(xa, ya, z - 0.85), v3(xb, yb, z - 0.85), 0.05, 4));
      }
    }
    // catwalk with railing along the bottom edge, ladder at the right column
    b.add(k.steel, box(x1 - x0 + 1, 0.06, 0.9, 0, y0 - 0.15, z - 1.75));
    for (let x = x0 - 0.4; x <= x1 + 0.4; x += 2.5) b.add(k.steel, box(0.05, 1.0, 0.05, x, y0 + 0.35, z - 2.15));
    b.add(k.steel, box(x1 - x0 + 1, 0.05, 0.05, 0, y0 + 0.85, z - 2.15));
    for (const s of [-0.25, 0.25]) b.add(k.steel, box(0.05, y0, 0.05, 16.4 + s, y0 / 2, z - 1.8));
    for (let y = 0.4; y < y0; y += 0.35) b.add(k.steel, box(0.55, 0.035, 0.035, 16.4, y, z - 1.8));
    // the dead lamp on top of the screen
    b.add(k.dark, box(0.5, 0.35, 0.5, -15, y1 + 1.4, z - 1.0), box(0.5, 0.35, 0.5, 15, y1 + 1.4, z - 1.0));
    // panels that came down, at the foot of the screen
    const r = rng(19);
    for (const [px, rot] of [[-6.5, 0.4], [9.5, -0.8], [3.0, 2.2]] as const) {
      const pg = new THREE.PlaneGeometry(3.75, 3.5, 3, 3);
      const pa = pg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 1.3 + r()) * 0.15);
      pg.computeVertexNormals();
      const geo = xf(pg, mat4(px, this.g(px, z + 3) + 0.25, z + 3 + r() * 2, -Math.PI / 2 + 0.12, rot, 0.05));
      b.add(k.white, geo);
    }
  }

  // ================================================================ the lot
  private rowR = [24, 31, 38, 45];

  private buildLot() {
    const k = this.mats;
    const kit = this.kit;
    const sc = v3(0, 0, SCREEN.z);
    // ramps: one terrain-material drift covering all four arcs
    kit.drift(0, 0, 72, 46, 0, (u, v) => {
      const lx = (u - 0.5) * 72, lz = (v - 0.5) * 46;
      const r = Math.hypot(lx, lz - sc.z);
      const ang = Math.atan2(lx, lz - sc.z);
      let h = 0;
      for (const R of this.rowR) h = Math.max(h, 0.36 * bump(r - (R - 0.8), 1.8));
      const span = 0.72 + 0.05 * Math.sin(r);
      return h * clamp01((span - Math.abs(ang)) / 0.06);
    }, 0.6);
    // cars on the crests, speaker posts between them
    const r = rng(7);
    let colorI = 0;
    const slots = [-0.52, -0.31, -0.105, 0.105, 0.31, 0.52];
    const filled = new Set(['0:1', '0:4', '1:0', '1:2', '1:5', '2:1', '2:3', '2:4', '3:0', '3:2', '3:5']);
    this.rowR.forEach((R, ri) => {
      for (let si = 0; si < slots.length; si++) {
        const a = slots[si];
        const cx = Math.sin(a) * (R - 0.6), cz = sc.z + Math.cos(a) * (R - 0.6);
        // speaker post at the ramp's foot, toward the screen, between slots
        if (si < slots.length - 1) {
          const pa = (a + slots[si + 1]) / 2;
          this.speakerPost(Math.sin(pa) * (R - 2.3), sc.z + Math.cos(pa) * (R - 2.3), pa, r);
        }
        if (!filled.has(`${ri}:${si}`)) continue;
        const kind = ri === 2 && si === 3 ? 'burnt' : ri === 1 && si === 2 ? 'convertible' : r() < 0.25 ? 'wagon' : 'sedan';
        this.car(cx, cz, Math.PI + a + (r() - 0.5) * 0.12, 0.07, CAR_COLORS[colorI++ % CAR_COLORS.length], kind, r);
      }
    });
    // two light poles (dead floods), oil stains and old tracks
    for (const x of [-31, 31]) {
      kit.b.add(k.steel, cyl(0.12, 0.16, 9, x, 4.5, 6, 8));
      kit.b.add(k.dark, box(1.4, 0.4, 0.5, x, 9.0, 6, 0, 0.3), box(0.08, 0.6, 0.08, x - 0.5, 8.6, 6), box(0.08, 0.6, 0.08, x + 0.5, 8.6, 6));
      kit.col(x, 4.5, 6, 0.16, 4.5, 0.16);
    }
    for (let i = 0; i < 16; i++) {
      const a = (r() - 0.5) * 1.2, R = this.rowR[Math.floor(r() * 4)] - 0.6;
      kit.d.add(decalMat(), floorDecal('oil', 1.2 + r(), 1.0 + r(), Math.sin(a) * R, 0.38, sc.z + Math.cos(a) * R, r() * 3));
    }
    for (let i = 0; i < 6; i++) kit.d.add(decalMat(), floorDecal('dirt', 8, 6, (r() - 0.5) * 50, 0.02, -20 + r() * 40, r() * 3));
    this.spot('heart', 0, 0.05, -2);
    this.spot('rows', 0, 0.05, 10);
  }

  private speakerPost(x: number, z: number, a: number, r: () => number) {
    const k = this.mats, b = this.kit.b;
    const y = this.g(x, z);
    b.add(k.steel, cyl(0.04, 0.05, 1.3, x, y + 0.65, z, 6));
    b.add(k.dark, box(0.22, 0.16, 0.14, x, y + 1.34, z, a));
    const c = Math.cos(a), s = Math.sin(a);
    for (const side of [-1, 1]) {
      if (r() < 0.15) continue; // gone with someone
      const hx = x + c * side * 0.2, hz = z - s * side * 0.2;
      const hanging = r() < 0.75;
      const sy = hanging ? y + 1.08 : y + 0.1;
      b.add(k.chrome, box(0.24, 0.17, 0.1, hx, sy, hz, a, hanging ? 0 : -1.4));
      b.add(k.black, box(0.18, 0.12, 0.012, hx + s * 0.05, sy, hz + c * 0.05, a));
      this.kit.nb.add(k.cable, wire(v3(x, y + 1.3, z), v3(hx, sy + 0.05, hz), 0.25, 0.008, 8));
    }
    this.kit.col(x, y + 0.65, z, 0.08, 0.65, 0.08);
  }

  /** A rusted 60s car (world/vehicles.ts). `ry` faces the nose; `pitch` lifts it on the ramp. */
  private car(x: number, z: number, ry: number, pitch: number, paint: string, kind: string, r: () => number) {
    const y = this.g(x, z);
    const m = mat4(x, y, z, pitch, ry, (r() - 0.5) * 0.03);
    // the builder authors the nose toward +x; turn it to face local −z
    const turn = mat4(0, 0, 0, 0, Math.PI / 2, 0);
    const burnt = kind === 'burnt';
    const res = buildCar(this.kit.b, m.clone().multiply(turn), {
      kind: burnt ? 'sedan' : (kind as CarKind), paint, rand: r, burnt, rust: 0.55, fade: 0.6, broken: 0.4,
      blocks: r() < 0.12, thin: this.kit.nb,
    });
    // sand on the roof
    if (kind !== 'convertible') this.kit.d.add(decalMat(), decal('sandpile', 1.6, 1.2, m.clone().multiply(turn).multiply(mat4(kind === 'wagon' ? -0.9 : -0.4, res.half.y * 2 + 0.01, 0, -Math.PI / 2, 0, 0))));
    this.kit.ocol(m.clone().multiply(turn).multiply(mat4(res.center.x, res.center.y, res.center.z)), res.half.x, res.half.y, res.half.z);
  }

  // ================================================================ snack bar + projection booth
  private buildBuilding() {
    const k = this.mats, b = this.kit.b;
    const { x0, x1, z0, z1, h } = BLD;
    // floor slab and roof
    b.add(k.slab, box(x1 - x0 + 0.6, 0.16, z1 - z0 + 0.6, 0, 0.02, (z0 + z1) / 2));
    this.kit.col(0, -0.02, (z0 + z1) / 2, (x1 - x0) / 2 + 0.3, 0.08, (z1 - z0) / 2 + 0.3);
    b.add(k.slab, box(x1 - x0 + 0.6, 0.22, z1 - z0 + 0.6, 0, h + 0.11, (z0 + z1) / 2));
    this.kit.col(0, h + 0.11, (z0 + z1) / 2, (x1 - x0) / 2 + 0.3, 0.11, (z1 - z0) / 2 + 0.3);
    b.add(k.red, box(x1 - x0 + 0.7, 0.5, 0.08, 0, h - 0.05, z0 - 0.32), box(x1 - x0 + 0.7, 0.5, 0.08, 0, h - 0.05, z1 + 0.32));
    b.add(k.red, box(0.08, 0.5, z1 - z0 + 0.7, x0 - 0.32, h - 0.05, (z0 + z1) / 2), box(0.08, 0.5, z1 - z0 + 0.7, x1 + 0.32, h - 0.05, (z0 + z1) / 2));
    // front wall (toward the screen) with the two ports
    const py0 = PORT.y - 0.28, py1 = PORT.y + 0.3;
    this.wallX(k.block, x0, -0.45, z0, 0, h);
    this.wallX(k.block, 0.45, 1.0, z0, 0, h);
    this.wallX(k.block, 1.4, x1, z0, 0, h);
    this.wallX(k.block, -0.45, 0.45, z0, 0, py0);
    this.wallX(k.block, -0.45, 0.45, z0, py1, h);
    this.wallX(k.block, 1.0, 1.4, z0, 0, PORT.y - 0.15);
    this.wallX(k.block, 1.0, 1.4, z0, PORT.y + 0.15, h);
    b.add(k.dark, box(1.0, 0.06, 0.32, 0, py0 - 0.03, z0), box(0.5, 0.05, 0.32, 1.2, PORT.y - 0.17, z0));
    // back wall, side walls with doors
    this.wallX(k.block, x0, x1, z1, 0, h);
    for (const sx of [x0, x1]) {
      this.wallZ(k.block, sx, z0, 25.6, 0, h);
      this.wallZ(k.block, sx, 27.4, z1, 0, h);
      this.wallZ(k.block, sx, 25.6, 27.4, 2.3, h);
      b.add(k.red, box(0.32, 0.08, 1.9, sx, 2.32, 26.5));
    }
    // projection room walls and the restroom voids
    this.wallZ(k.block, -3, z0, 24.5, 0, h, 0.2);
    this.wallZ(k.block, 3, z0, 24.5, 0, h, 0.2);
    this.wallX(k.block, x0, -0.8, 24.5, 0, h, 0.2);
    this.wallX(k.block, 0.8, x1, 24.5, 0, h, 0.2);
    this.wallX(k.block, -0.8, 0.8, 24.5, 2.25, h, 0.2);
    this.dec('founders', 0.6, 0.24, -5.5, 1.9, 24.62);
    this.dec('everyone', 0.72, 0.24, 5.5, 1.9, 24.62);
    for (const x of [-5.5, 5.5]) b.add(k.teal, box(0.9, 2.05, 0.05, x, 1.03, 24.63));
    this.dec('staffOnly', 0.6, 0.22, 0, 2.45, 24.62);
    // exterior: striped awnings over the side doors, a blade sign, a speaker horn, grime at the base
    for (const sx of [x0, x1]) {
      const out = Math.sign(sx);
      for (let i = 0; i < 6; i++) {
        b.add(i % 2 ? k.awningW : k.awningR, xf(box(1.1, 0.03, 0.4, 0, 0, 0), mat4(sx + out * 0.55, 2.62, 25.4 + i * 0.4, 0, 0, -out * 0.35)));
      }
      b.add(k.steel, beam(v3(sx + out * 1.05, 2.45, 25.4), v3(sx + out * 0.12, 2.15, 25.4), 0.02, 4), beam(v3(sx + out * 1.05, 2.45, 27.6), v3(sx + out * 0.12, 2.15, 27.6), 0.02, 4));
      this.dec('dirt', 6, 1.2, sx + out * 0.14, 0.45, 24.5, out * Math.PI / 2);
    }
    b.add(k.red, box(0.35, 3.0, 1.3, x1 - 0.6, h + 1.6, z1 - 0.8));
    this.dec('popcornSign', 2.6, 0.62, x1 - 0.42, h + 1.7, z1 - 0.8, Math.PI / 2, 0, Math.PI / 2);
    this.dec('popcornSign', 2.6, 0.62, x1 - 0.78, h + 1.7, z1 - 0.8, -Math.PI / 2, 0, -Math.PI / 2);
    b.add(k.steel, cyl(0.05, 0.05, 1.4, -5, h + 0.8, 21, 6));
    const hornG = new THREE.CylinderGeometry(0.42, 0.1, 0.7, 12, 1, true);
    hornG.rotateX(-Math.PI / 2);
    b.add(k.cream, xf(hornG, mat4(-5, h + 1.5, 20.7, -0.15, 0, 0)));
    for (const z of [z0, z1]) this.dec('dirt', 16, 1.0, 0, 0.4, z + (z === z0 ? -0.14 : 0.14), z === z0 ? Math.PI : 0);
    b.add(k.counterWood, box(1.8, 0.06, 0.8, 10.5, 0.75, 22.5), box(1.8, 0.05, 0.3, 10.5, 0.45, 21.9), box(1.8, 0.05, 0.3, 10.5, 0.45, 23.1));
    for (const x of [9.8, 11.2]) b.add(k.steel, box(0.05, 0.75, 0.9, x, 0.38, 22.5));
    this.kit.col(10.5, 0.4, 22.5, 0.9, 0.4, 0.75);
    b.add(k.teal, cyl(0.3, 0.28, 0.9, 9.0, 0.45, 28.2, 12));
    this.kit.col(9.0, 0.45, 28.2, 0.3, 0.45, 0.3);
    // exterior signage
    this.dec('snackSign', 6.2, 1.3, 0, 2.75, z1 + 0.14);
    this.dec('posterKeynote', 0.9, 1.26, -5.5, 1.5, z1 + 0.14);
    this.dec('posterSeats', 0.9, 1.26, 5.5, 1.5, z1 + 0.14);
    this.dec('streaks', 4, 2, -3, 2.3, z0 - 0.14, Math.PI);
    this.dec('streaks', 4, 2, 4.5, 2.3, z0 - 0.14, Math.PI);

    // ---- projection room
    const pj = this.kit.b;
    pj.add(k.projector, box(0.62, 0.95, 1.0, 0, 0.55, 21.3));
    pj.add(k.projector, box(0.42, 0.5, 0.62, 0, 1.3, 21.0));
    pj.add(k.projector, box(0.55, 0.75, 0.8, 0, 1.45, 21.75));
    pj.add(k.dark, cyl(0.1, 0.1, 1.6, 0, 2.55, 21.85, 10), box(0.3, 0.12, 0.3, 0, 1.88, 21.75));
    pj.add(k.chrome, cyl(0.08, 0.09, 0.42, PORT.x, PORT.y, 20.55, 14, Math.PI / 2));
    this.portGlow.add(pj, cyl(0.065, 0.065, 0.01, PORT.x, PORT.y, 20.33, 14, Math.PI / 2));
    pj.add(k.dark, box(0.04, 0.9, 0.04, 0, 1.9, 21.05), box(0.04, 0.04, 0.9, 0, 0.95, 21.95));
    this.kit.col(0, 0.9, 21.4, 0.32, 0.9, 0.55);
    // rewind bench, film cans, the projectionist's note
    pj.add(k.counterWood, box(0.6, 0.06, 1.8, -2.55, 0.9, 22.4), box(0.05, 0.9, 0.05, -2.3, 0.45, 21.6), box(0.05, 0.9, 0.05, -2.3, 0.45, 23.2));
    this.kit.col(-2.55, 0.47, 22.4, 0.32, 0.47, 0.92);
    for (let i = 0; i < 5; i++) pj.add(k.stainless, cyl(0.19, 0.19, 0.04, -2.6, 0.95 + i * 0.045, 22.9 + (i % 2) * 0.03, 16));
    pj.add(k.chrome, cyl(0.16, 0.16, 0.03, -2.55, 1.25, 21.9, 14, Math.PI / 2), box(0.04, 0.3, 0.04, -2.55, 1.07, 21.9));
    this.dec('projNote', 0.3, 0.35, -2.89, 1.6, 22.2, Math.PI / 2);
    pj.add(k.dark, box(0.08, 0.6, 0.45, 2.88, 1.6, 21.2));
    pj.add(k.counterWood, box(0.3, 0.05, 0.3, 1.8, 0.6, 22.8), box(0.04, 0.6, 0.04, 1.8, 0.3, 22.8));
    for (let i = 0; i < 3; i++) pj.add(k.counterWood, box(0.32, 0.03, 1.4, 2.7, 0.6 + i * 0.5, 23.4));
    for (let i = 0; i < 6; i++) pj.add(k.stainless, cyl(0.17, 0.17, 0.035, 2.72, 0.64 + Math.floor(i / 2) * 0.5, 23.0 + (i % 2) * 0.5, 14, Math.PI / 2, 0, 0));
    this.kit.col(2.7, 0.8, 23.4, 0.18, 0.8, 0.72);

    // ---- snack bar: counter, back shelf, equipment, stools, menu, tubes
    pj.add(k.counterWood, box(12, 0.95, 0.6, 0, 0.48, 27.55));
    pj.add(k.red, box(12.05, 0.12, 0.62, 0, 0.12, 27.55));
    pj.add(k.stainless, box(12.2, 0.05, 0.7, 0, 0.98, 27.55));
    this.kit.col(0, 0.5, 27.55, 6.1, 0.5, 0.33);
    pj.add(k.cream, box(12, 0.9, 0.4, 0, 0.45, 28.55));
    this.kit.col(0, 0.45, 28.55, 6, 0.45, 0.2);
    // popcorn machine
    pj.add(k.red, box(0.62, 0.1, 0.46, -4, 0.95, 28.55), box(0.62, 0.15, 0.46, -4, 1.62, 28.55));
    this.kit.nb.add(glassMat(), box(0.6, 0.6, 0.44, -4, 1.28, 28.55));
    pj.add(k.yellow, xf(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat4(-4, 1.0, 28.55, 0, 0, 0)));
    this.dec('popcornSign', 0.6, 0.15, -4, 1.62, 28.31, Math.PI);
    // soda fountain, hot dog roller, register
    pj.add(k.stainless, box(0.9, 0.55, 0.4, -1.2, 1.18, 28.55));
    for (let i = 0; i < 4; i++) pj.add(k.chrome, box(0.04, 0.12, 0.06, -1.5 + i * 0.2, 1.0, 28.33));
    pj.add(k.stainless, box(0.7, 0.18, 0.4, 1.8, 1.0, 28.55));
    for (let i = 0; i < 6; i++) pj.add(k.taillight, cyl(0.025, 0.025, 0.6, 1.8, 1.12, 28.4 + i * 0.05, 8, 0, 0, Math.PI / 2));
    pj.add(k.dark, box(0.4, 0.25, 0.35, 4.5, 1.12, 27.55), box(0.3, 0.12, 0.05, 4.5, 1.32, 27.45, 0, -0.5));
    for (const x of [-3.5, -1.5, 0.5, 2.5]) {
      pj.add(k.chrome, cyl(0.04, 0.05, 0.7, x, 0.35, 26.6, 8));
      pj.add(k.redVinyl, cyl(0.2, 0.2, 0.08, x, 0.72, 26.6, 14));
    }
    this.dec('menu', 3.2, 2.0, 0, 2.3, 28.85, Math.PI);
    this.dec('posterKeynote', 0.8, 1.12, -7.82, 1.6, 26.5, Math.PI / 2);
    this.dec('posterSeats', 0.8, 1.12, 7.82, 1.6, 26.5, -Math.PI / 2);
    for (const x of [-4, 0, 4]) {
      pj.add(k.white, box(1.3, 0.06, 0.2, x, h - 0.06, 26.6));
      this.tubes.add(pj, box(1.2, 0.03, 0.1, x, h - 0.1, 26.6));
    }
    this.tubes.add(pj, box(0.8, 0.03, 0.08, 0, h - 0.1, 22.3));
    this.kit.d.add(decalMat(), floorDecal('sandpile', 3.2, 2.2, 7.0, 0.11, 26.4, 0.4));
    this.kit.d.add(decalMat(), floorDecal('sandpile', 3.0, 2.0, -7.0, 0.11, 26.6, 2.0));
    this.kit.gd.add(glowDecalMat(), floorDecal('poolCool', 6, 4, 0, 0.12, 26.3, 0));

    // ---- generator behind the snack bar, conduit up the wall
    const gx = 5, gz = 31.2;
    b.add(k.slab, box(2.4, 0.15, 1.8, gx, 0.05, gz));
    b.add(k.yellow, box(1.6, 1.0, 0.9, gx, 0.62, gz));
    b.add(k.dark, box(1.62, 0.06, 0.92, gx, 1.14, gz), box(0.45, 0.3, 0.02, gx - 0.4, 0.75, gz - 0.46));
    for (let i = 0; i < 6; i++) b.add(k.dark, box(0.55, 0.02, 0.02, gx + 0.4, 0.4 + i * 0.09, gz - 0.455));
    b.add(k.dark, cyl(0.06, 0.06, 0.7, gx + 0.6, 1.45, gz + 0.2, 6));
    this.genLed.add(b, box(0.05, 0.05, 0.02, gx - 0.55, 0.85, gz - 0.465));
    this.kit.halos.add(v3(gx - 0.55, 0.85, gz - 0.5), '#ff3a2a', 0.22, 1, 1.5);
    b.add(k.dark, box(0.08, 0.08, 1.3, gx - 0.6, 0.9, gz - 1.1), box(0.08, 2.4, 0.08, gx - 0.6, 2.1, z1 + 0.06));
    b.add(k.red, box(0.25, 0.35, 0.18, gx - 1.4, 0.2, gz + 0.3, 0.5));
    this.kit.col(gx, 0.6, gz, 0.82, 0.6, 0.47);
    this.kit.d.add(decalMat(), floorDecal('oil', 2, 1.6, gx + 0.3, 0.14, gz + 0.1, 0.3));
    // the manager's wagon, behind the building
    const r = rng(311);
    this.car(-4.2, 34.0, Math.PI / 2 + 0.25, 0, '#7f6a4a', 'wagon', r);
    this.dec('staffOnly', 0.6, 0.22, -4.2 + 0.98 * Math.sin(0.25 + Math.PI), 0.9, 34.0, Math.PI / 2 + 0.25 - Math.PI / 2);
  }

  // ================================================================ entrance
  private buildEntrance() {
    const k = this.mats, b = this.kit.b;
    // ticket booth beside the lane
    const tx = -9.4, tz = 40;
    const gy = this.g(tx, tz);
    b.add(k.slab, box(3.0, 0.2, 3.0, tx, gy + 0.05, tz));
    b.add(k.cream, box(2.2, 1.0, 2.2, tx, gy + 0.6, tz));
    for (const [cx, cz] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]) b.add(k.red, box(0.12, 1.4, 0.12, tx + cx, gy + 1.8, tz + cz));
    b.add(k.red, box(2.8, 0.18, 2.8, tx, gy + 2.6, tz), box(2.4, 0.3, 2.4, tx, gy + 2.82, tz));
    this.kit.nb.add(glassMat(), box(1.98, 1.25, 0.02, tx, gy + 1.75, tz - 1.04), box(0.02, 1.25, 1.98, tx - 1.04, gy + 1.75, tz), box(1.98, 1.25, 0.02, tx, gy + 1.75, tz + 1.04));
    b.add(k.counterWood, box(1.2, 0.05, 0.4, tx - 0.6, gy + 1.1, tz));
    b.add(k.dark, box(0.4, 0.2, 0.35, tx - 0.7, gy + 1.22, tz));
    this.dec('tickets', 1.6, 0.47, tx, gy + 2.6, tz - 1.42, Math.PI);
    this.dec('tickets', 1.6, 0.47, tx - 1.42, gy + 2.6, tz, -Math.PI / 2);
    this.kit.col(tx, gy + 1.4, tz, 1.15, 1.4, 1.15);
    this.spot('tickets', tx - 1.7, gy + 0.05, tz);
    // barrier arm across the lane, half raised
    const bx = tx - 1.5, bz = tz - 1.8;
    b.add(k.red, box(0.3, 1.0, 0.3, bx, gy + 0.5, bz));
    for (let i = 0; i < 6; i++) b.add(i % 2 ? k.white : k.red, xf(box(0.6, 0.08, 0.08, -0.3 - i * 0.6, 0, 0), mat4(bx, gy + 0.95, bz, 0, 0, -1.15)));
    // marquee: two posts, letter board (both faces, see buildMarqueeFaces), header box, the star
    const mx = -22, mz = 45.5, my = this.g(mx, mz);
    for (const s of [-1, 1]) {
      b.add(k.steel, box(0.35, 9.5, 0.35, mx + s * 3.6, my + 4.75, mz));
      this.kit.col(mx + s * 3.6, my + 4.75, mz, 0.2, 4.75, 0.2);
    }
    b.add(k.red, box(8.6, 2.9, 0.5, mx, my + 5.45, mz));
    b.add(k.teal, box(8.4, 1.9, 0.6, mx, my + 8.0, mz));
    b.add(k.yellow, box(8.6, 0.12, 0.62, mx, my + 7.0, mz), box(8.6, 0.12, 0.62, mx, my + 9.0, mz));
    // the star, with chaser bulbs
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.75 : 1.8;
      if (i === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    star.closePath();
    const sg = new THREE.ExtrudeGeometry(star, { depth: 0.25, bevelEnabled: false });
    sg.translate(0, 0, -0.125);
    b.add(k.yellow, xf(sg, mat4(mx + 2.4, my + 10.6, mz, 0, 0, 0.15)));
    b.add(k.steel, box(0.18, 1.2, 0.18, mx + 2.4, my + 9.3, mz));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + Math.PI / 2;
      const kk = Math.floor(i / 2) % 2 ? 0.75 : 1.8;
      const t2 = (i % 2) / 2;
      const a0 = a, rr = kk * (1 - t2) + (kk === 0.75 ? 1.8 : 0.75) * t2;
      const p = v3(mx + 2.4 + Math.cos(a0 + 0.15) * rr * 0.92, my + 10.6 + Math.sin(a0 + 0.15) * rr * 0.92, mz);
      for (const zz of [0.14, -0.14]) this.bulbs[i % 3].add(b, cyl(0.06, 0.06, 0.04, p.x, p.y, p.z + zz, 8, Math.PI / 2));
      if (i % 3 === 0) this.kit.halos.add(v3(p.x, p.y, p.z + 0.2), '#ffd38a', 0.5, 2 + (i % 3), 1.5);
    }
    // letters that fell off, at the foot of the posts
    for (let i = 0; i < 3; i++) this.kit.d.add(decalMat(), floorDecal('letters', 1.2, 0.3, mx - 1 + i * 1.3, my + 0.03, mz + 1.3 + i * 0.4, 0.3 * i));
    this.spot('marquee', mx, my + 0.05, mz + 8);
    // entrance drive: tracks into the lot
    for (let z = 30; z < 52; z += 7) this.kit.d.add(decalMat(), floorDecal('dirt', 5, 8, -12.5, this.g(-12.5, z) + 0.03, z, 0));
  }

  private buildMarqueeFaces(root: THREE.Object3D) {
    const mx = -22, mz = 45.5, my = this.g(mx, mz);
    const tex = marqueeTexture();
    const board = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    const t = texture(tex);
    board.colorNode = t.rgb;
    board.emissiveNode = t.rgb.mul(this.uBoard);
    const geo = new THREE.BufferGeometry();
    const front = new THREE.PlaneGeometry(8.2, 2.6);
    const back = new THREE.PlaneGeometry(8.2, 2.6);
    const fu = front.attributes.uv as THREE.BufferAttribute, bu = back.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < fu.count; i++) { fu.setY(i, 0.5 + fu.getY(i) * 0.5); bu.setY(i, bu.getY(i) * 0.5); }
    front.translate(0, 0, 0.26);
    back.rotateY(Math.PI);
    back.translate(0, 0, -0.26);
    geo.copy(mergeGeo([norm(front), norm(back)]));
    const m = new THREE.Mesh(geo, board);
    m.position.set(mx, my + 5.45, mz);
    m.castShadow = false;
    // neon header: STARLITE, the L and I dead until the generator runs
    const nt = texture(neonTexture());
    const neon = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const u = uv();
    const dead = smoothstep(0.515, 0.525, u.x).mul(smoothstep(0.655, 0.645, u.x)).mul(smoothstep(0.35, 0.36, u.y));
    const lit = float(1).sub(dead.mul(float(1).sub(this.uNeonAll)));
    neon.colorNode = Fn(() => {
      const c = mix(color('#ff3a9e'), color('#3ff2e0'), smoothstep(0.45, 0.55, u.y.oneMinus().add(u.x.mul(0.2))));
      return (c as N).mul(nt.a).mul(this.uNeon).mul(lit).mul(3.2);
    })();
    neon.opacityNode = nt.a.mul(0.9);
    const ng = new THREE.BufferGeometry();
    const nf = new THREE.PlaneGeometry(8.0, 2.0); nf.translate(0, 0, 0.32);
    const nb = new THREE.PlaneGeometry(8.0, 2.0); nb.rotateY(Math.PI); nb.translate(0, 0, -0.32);
    ng.copy(mergeGeo([norm(nf), norm(nb)]));
    const nm = new THREE.Mesh(ng, neon);
    nm.position.set(mx, my + 8.0, mz);
    nm.renderOrder = 4;
    // both stay up as the far silhouette's lights (2 draws), hidden past the cull distance
    root.add(m, nm);
    this.marquee = m;
    this.neonMesh = nm;
  }

  private marquee!: THREE.Object3D;
  private neonMesh!: THREE.Object3D;

  // ================================================================ fence, playground
  private buildFence() {
    const k = this.mats, b = this.kit.b;
    const r = rng(53);
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 3);
      const ry = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.5) / n;
        const x = ax + (bx - ax) * t0, z = az + (bz - az) * t0;
        const y = this.g(x, z);
        b.add(k.steel, cyl(0.06, 0.06, 2.6, ax + (bx - ax) * (i / n), y + 1.3, az + (bz - az) * (i / n), 6));
        const roll = r();
        if (roll < 0.14) continue; // gap
        if (roll < 0.24) { // fallen flat
          b.add(k.fence, xf(box(3.0, 2.3, 0.04, 0, 0, 0), mat4(x + (r() - 0.5), y + 0.1, z + (r() - 0.5), -Math.PI / 2 + 0.05, ry + (r() - 0.5) * 0.4, 0)));
          continue;
        }
        const lean = roll < 0.34 ? (r() - 0.5) * 0.5 : 0;
        b.add(k.fence, xf(box(3.0, 2.3, 0.04, 0, 1.25, 0), mat4(x, y, z, lean, ry, 0)));
        this.kit.col(x, y + 1.2, z, 1.5, 1.2, 0.08, ry);
      }
    };
    run(-44, -36, -44, 46);
    run(44, -36, 44, 46);
    run(-44, 46, -16, 46);
    run(-8, 46, 44, 46);
    run(-44, -36, -17, -36);
    run(17, -36, 44, -36);
  }

  private buildPlayground() {
    const k = this.mats, b = this.kit.b;
    const sx = -8, sz = -25;
    for (const s of [-1, 1]) {
      b.add(k.red, beam(v3(sx + s * 2.2, 2.8, sz), v3(sx + s * 2.6, 0, sz - 1.1), 0.06, 6), beam(v3(sx + s * 2.2, 2.8, sz), v3(sx + s * 2.6, 0, sz + 1.1), 0.06, 6));
      this.kit.col(sx + s * 2.4, 1.4, sz, 0.12, 1.4, 1.0);
    }
    b.add(k.red, cyl(0.06, 0.06, 4.6, sx, 2.8, sz, 8, 0, 0, Math.PI / 2));
    for (const [x, broken] of [[sx - 0.9, false], [sx + 0.9, true]] as const) {
      b.add(k.chrome, box(0.015, 2.2, 0.015, x - 0.22, 1.7, sz), box(0.015, broken ? 1.0 : 2.2, 0.015, x + 0.22, broken ? 2.3 : 1.7, sz));
      b.add(k.dark, box(0.5, 0.04, 0.2, x, broken ? 0.4 : 0.6, sz, 0, 0, broken ? 0.7 : 0));
    }
    // merry-go-round, tipped
    const mx = 7, mz = -25.5;
    b.add(k.teal, cyl(1.5, 1.5, 0.08, mx, 0.35, mz, 24, 0.06, 0, 0.04));
    b.add(k.steel, cyl(0.08, 0.1, 0.3, mx, 0.15, mz, 8));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.add(k.steel, beam(v3(mx, 1.0, mz), v3(mx + Math.cos(a) * 1.3, 0.45, mz + Math.sin(a) * 1.3), 0.03, 4));
    }
    this.kit.col(mx, 0.3, mz, 1.1, 0.3, 1.1);
  }

  // ================================================================ moving bits
  private buildMoving(near: THREE.Object3D) {
    const k = this.mats;
    // projection room door, hinged at x = −0.8, swings out into the hall
    const pivot = new THREE.Group();
    pivot.position.set(-0.8, 0, 24.5);
    const db = new MeshBatch();
    db.add(k.teal, box(1.6, 2.2, 0.06, 0.8, 1.1, 0));
    db.add(k.chrome, box(0.06, 0.2, 0.08, 1.45, 1.05, 0.05));
    pivot.add(db.build('drivein-boothDoor'));
    near.add(pivot);
    const col = this.kit.col(0, 1.1, 24.5, 0.8, 1.1, 0.05);
    this.door = { pivot, collider: col, open: 0, target: 0 };
    // ticket booth door (opens on the cash drawer)
    const tp = new THREE.Group();
    tp.position.set(-9.4 + 1.1, this.g(-9.4, 40) + 0.1, 40 + 0.6);
    const tb = new MeshBatch();
    tb.add(k.cream, box(0.04, 2.0, 1.0, 0, 1.0, -0.5));
    tp.add(tb.build('drivein-ticketDoor'));
    near.add(tp);
    this.ticketDoor = { pivot: tp, open: 0, target: 0 };
    // the uncut reel can (leaves with you)
    const can = new MeshBatch();
    can.add(k.stainless, cyl(0.2, 0.2, 0.05, 0, 0.025, 0, 18));
    can.add(atlasSolid(), xf(atlasMap('canLabel', new THREE.BoxGeometry(0.2, 0.004, 0.1)), mat4(0, 0.052, 0)));
    const cg = can.build('drivein-reel');
    cg.position.set(-2.5, 0.93, 22.0);
    near.add(cg);
    this.reelCan = cg;
    // reels on the projector (spin while it runs)
    const reelMat = rustyMetal({ base: '#c4c8cc', rust: 0.2, metalness: 1, roughness: 0.3 });
    for (const [y, z, r] of [[2.15, 21.05, 0.42], [0.95, 21.95, 0.36]] as const) {
      const rb = new MeshBatch();
      rb.add(reelMat, cyl(r, r, 0.02, 0, 0, -0.04, 24, 0, 0, Math.PI / 2), cyl(r, r, 0.02, 0, 0, 0.04, 24, 0, 0, Math.PI / 2));
      rb.add(k.black, cyl(r * 0.75, r * 0.75, 0.07, 0, 0, 0, 20, 0, 0, Math.PI / 2));
      for (let i = 0; i < 3; i++) rb.add(reelMat, box(0.03, r * 1.9, 0.11, 0, 0, 0, 0, 0, (i / 3) * Math.PI));
      const g = rb.build('drivein-reelSpin', false, false);
      const holder = new THREE.Group();
      holder.position.set(0.0, y, z);
      holder.rotation.y = Math.PI / 2;
      holder.add(g);
      near.add(holder);
      this.reels.push(g);
    }
  }

  // ================================================================ the spectacle
  private buildSpectacle(root: THREE.Object3D) {
    // keynote canvas: 512×240, redrawn ~10 fps while the projector runs
    this.keyCanvas.width = 512;
    this.keyCanvas.height = 240;
    this.keyCtx = this.keyCanvas.getContext('2d')!;
    drawKeynote(this.keyCtx, 512, 240, 0, 0);
    this.keyTex = new THREE.CanvasTexture(this.keyCanvas);
    this.keyTex.colorSpace = THREE.SRGBColorSpace;
    this.keyTex.generateMipmaps = false;
    this.keyTex.minFilter = THREE.LinearFilter;
    // screen face: the weathered print, lit by the scene, plus the projection as emission
    const face = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    const st = texture(screenTexture());
    const kt = texture(this.keyTex);
    face.colorNode = st.rgb;
    const dist = positionWorld.sub(cameraPosition).length();
    face.emissiveNode = kt.rgb.mul(this.uProj).mul(st.rgb.mul(0.5).add(0.6)).mul(exp(dist.mul(-0.0016)));
    const { x0, x1, y0, y1, z } = SCREEN;
    const pw = (x1 - x0) / COLS, ph = (y1 - y0) / ROWS;
    const missing = new Set(['1:3', '5:2', '6:3', '7:3', '2:0']);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        if (missing.has(`${i}:${j}`)) continue;
        const g = new THREE.PlaneGeometry(pw - 0.04, ph - 0.04);
        const uvA = g.attributes.uv as THREE.BufferAttribute;
        for (let q = 0; q < uvA.count; q++) uvA.setXY(q, (i + uvA.getX(q)) / COLS, (j + uvA.getY(q)) / ROWS);
        let m = mat4(x0 + (i + 0.5) * pw, y0 + (j + 0.5) * ph, z);
        // a couple hang by a corner, one sags
        if (i === 6 && j === 2) m = mat4(x0 + 6 * pw + 0.2, y0 + 3 * ph - 0.1, z + 0.25).multiply(mat4(0, 0, 0, 0.15, 0, 0.55)).multiply(mat4(pw / 2, -ph / 2, 0));
        if (i === 0 && j === 3) m = mat4(x0 + 0.5 * pw, y0 + 3.5 * ph - 0.4, z + 0.3, 0.3, 0, 0);
        parts.push(xf(g, m));
        // back face (seen from behind the screen)
        const back = new THREE.PlaneGeometry(pw - 0.04, ph - 0.04);
        back.rotateY(Math.PI);
        back.translate(0, 0, -0.03);
        const bu = back.attributes.uv as THREE.BufferAttribute;
        for (let q = 0; q < bu.count; q++) bu.setXY(q, 0.02, 0.02);
        parts.push(xf(back, m));
      }
    }
    const screen = new THREE.Mesh(mergeGeo(parts), face);
    screen.castShadow = true;
    screen.receiveShadow = true;
    screen.name = 'drivein-screen';
    root.add(screen);
    this.screenMesh = screen;
    // collider for the screen face (you can't walk through it from the catwalk)
    this.kit.col(0, (y0 + y1) / 2, z - 0.1, (x1 - x0) / 2, (y1 - y0) / 2, 0.12);
    // the beam: an open frustum from the lens to the screen's corners
    const lens = v3(PORT.x, PORT.y, PORT.z + 0.32), mid = v3((x0 + x1) / 2, (y0 + y1) / 2, z + 0.05);
    this.beam.fade.value = 0.7;
    this.beam.soft.value = 0;
    const bm = new THREE.Mesh(beamTube(lens, [0.07, 0.05], mid, [(x1 - x0) / 2 + 0.6, (y1 - y0) / 2 + 0.5], v3(1, 0, 0), v3(0, 1, 0)), this.beam.material);
    bm.renderOrder = 20;
    bm.frustumCulled = false;
    bm.visible = false;
    bm.name = 'drivein-beam';
    root.add(bm);
    this.beamMesh = bm;
  }

  // ================================================================ interactions
  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') { this.s.events.emit('toast', { text, kind }); }

  private loot(items: { id: string; qty: number }[], force = false) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty, false, force);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private buildInteractables() {
    const P = (name: string, x: number, y: number, z: number) => { this.spot(name, x, y, z); return this.frame.p(x, y, z); };
    P('booth', 0, 0.12, 22.6);
    P('hall', 0, 0.12, 25.8);
    P('generatorSpot', 5, 0.1, 33.0);
    P('screen', 0, 0.05, -24);

    const powered = () => !!this.s?.has('site.drivein.power');
    this.interactables.push({
      id: 'drivein.generator', pos: this.frame.p(5, 0.9, 31.75), radius: 1.9,
      visible: () => !powered(),
      primary: this.generatorAction(),
      secondary: {
        label: 'Swap in a Lithium Cell',
        available: () => (this.s.count('battery') > 0 ? true : 'Need a Lithium Cell'),
        run: () => {
          if (powered() || !this.s.removeItem('battery', 1)) return;
          this.powerOn('The cell takes. The generator coughs, then commits. Somewhere a popcorn machine remembers what it is for.');
        },
      },
    });
    this.interactables.push({
      id: 'drivein.booth', pos: this.frame.p(0, 1.1, 24.9), radius: 1.7,
      visible: () => !this.s?.has('site.drivein.booth'),
      primary: this.boothAction(),
      secondary: {
        label: 'Charge the booth door',
        available: () => this.chargeReason(1),
        run: () => this.blowBooth(),
      },
    });
    this.interactables.push({
      id: 'drivein.car', pos: this.frame.p(-4.2, 1.0, 33.0), radius: 2.0,
      visible: () => !this.s?.has('site.drivein.key'),
      primary: {
        label: 'Search the manager\'s wagon',
        available: () => (this.s.skill('survival') >= 1 ? true : 'Requires Survival 1. You don\'t know where people hide things in cars.'),
        run: () => {
          if (!this.s.set('site.drivein.key')) return;
          const got = this.loot([{ id: 'scrap', qty: 2 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Under the sun visor: a lanyard, STARLITE STAFF, and a key with PROJ on masking tape. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Staff key');
        },
      },
    });
    this.interactables.push({
      id: 'drivein.projector', pos: this.frame.p(0.75, 1.25, 21.7), radius: 1.6,
      primary: {
        get label() { return 'Start the projector'; },
        available: () => {
          if (!powered()) return 'No power. The generator behind the snack bar is dead.';
          return true;
        },
        run: () => this.toggleProjector(),
      },
    });
    this.interactables.push({
      id: 'drivein.reel', pos: this.frame.p(-2.5, 1.0, 22.0), radius: 1.5,
      visible: () => !this.s?.has('site.drivein.reel'),
      primary: {
        label: 'Take the uncut reel',
        available: () => true,
        run: () => {
          if (!this.s.set('site.drivein.reel')) return;
          this.reelCan.visible = false;
          const got = this.loot([{ id: 'keynote_reel', qty: 1 }], true);
          this.ctx.audio.play('loot');
          this.s.addXP(40, 'The uncut reel');
          this.toast(`R2/2, UNCUT. The theatrical cut is still threaded. This one is the part he wanted gone. ${got}`, 'good');
        },
      },
    });
    this.interactables.push({
      id: 'drivein.note', pos: this.frame.p(-2.75, 1.6, 22.2), radius: 1.4,
      primary: { label: 'Read the note on the wall', available: () => true, run: () => this.readNote() },
    });
    this.interactables.push({
      id: 'drivein.tickets', pos: this.frame.p(-10.6, 1.3, 40), radius: 1.8,
      visible: () => !this.s?.has('site.drivein.tickets'),
      primary: this.ticketAction(),
    });
    this.interactables.push({
      id: 'drivein.snacks', pos: this.frame.p(0, 1.1, 27.1), radius: 1.9,
      visible: () => !this.s?.has('site.drivein.snacks'),
      primary: {
        label: 'Raid the snack bar',
        available: () => true,
        run: () => {
          if (!this.s.set('site.drivein.snacks')) return;
          const got = this.loot([{ id: 'ration', qty: 2 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Popcorn, technically. Two sealed tins under the register, labelled INTERMISSION. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Snack bar');
        },
      },
    });
    this.interactables.push({
      id: 'drivein.speaker', pos: this.frame.p(Math.sin(-0.0) * 21.7, 1.3, SCREEN.z + 21.7), radius: 1.6,
      primary: { label: 'Lift the speaker to your ear', available: () => true, run: () => this.listen() },
    });
  }

  private generatorAction(): Action {
    return {
      label: 'Restart the generator',
      available: () => (this.s.skill('electronics') >= 1 ? true : 'Requires Electronics 1, or a Lithium Cell for the starter (F)'),
      run: async () => {
        if (this.s.has('site.drivein.power')) return;
        if (this.s.skill('electronics') < 4) {
          const ok = await this.ctx.ui.circuit({ title: 'STARLITE · GENERATOR', difficulty: this.s.focus('electronics') === 'hotline' ? 1 : 2 });
          if (!ok) { this.ctx.audio.play('deny'); return; }
        }
        this.s.addXP(XP_REWARDS.keypadShorted, 'Generator');
        this.powerOn('Bypassed the dead relay. The generator coughs, then commits. Behind the wall, fluorescent tubes argue about it.');
      },
    };
  }

  private powerOn(line: string) {
    if (!this.s.set('site.drivein.power')) return;
    this.ctx.audio.play('unlock', { pos: this.frame.p(5, 1, 31.2) });
    this.ctx.cam.addTrauma(0.08);
    this.toast(line, 'good');
  }

  private boothAction(): Action {
    const self = this;
    return {
      get label() { return self.s?.has('site.drivein.key') ? 'Unlock with the staff key' : 'Pick the booth lock · 4 pins'; },
      available: () => {
        if (this.s.has('site.drivein.key')) return true;
        if (this.s.skill('lockpicking') < 2) return 'Requires Lockpicking 2, the staff key, or a charge (F)';
        if (this.s.count('lockpick') < 1) return 'Need a lockpick';
        return true;
      },
      run: async () => {
        if (this.s.has('site.drivein.key')) { this.openBooth('The key turns like it has been waiting. PROJECTION · STAFF ONLY.'); return; }
        const pins = 4 - (this.s.focus('lockpicking') === 'feeler' ? 1 : 0);
        const res = await this.ctx.ui.lockpick({
          pins, title: 'PROJECTION · STAFF ONLY',
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
            return this.s.count('lockpick') > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + pins * 5, 'Lock picked');
          this.openBooth('Four pins and a door that smells of acetate.');
        }
      },
    };
  }

  private chargeReason(need: number): true | string {
    if (this.s.skill('demolition') < need) return `Requires Demolition ${need}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private blowBooth() {
    if (this.chargeReason(1) !== true || this.s.has('site.drivein.booth')) { this.ctx.audio.play('deny'); return; }
    if (!this.s.removeItem('charge', 1)) return;
    const quiet = this.s.focus('demolition') === 'shaped';
    const p = this.frame.p(0, 1.1, 24.6);
    this.ctx.audio.play('thud', { pos: p, intensity: quiet ? 0.5 : 0.9 });
    this.ctx.cam.addTrauma(quiet ? 0.12 : 0.4);
    this.ctx.puffs?.emit(p, 14, 0.9, 0.6, 0.5);
    this.s.addXP(XP_REWARDS.breach, 'Breached');
    this.openBooth(quiet ? 'Shaped. The door steps aside.' : 'The booth door goes through the snack bar. The popcorn machine takes it personally.');
  }

  private openBooth(line: string) {
    if (!this.s.set('site.drivein.booth')) return;
    this.door.target = -1.5;
    this.ctx.audio.play('door', { pos: this.frame.p(0, 1.1, 24.5) });
    this.toast(line, 'good');
  }

  private ticketAction(): Action {
    return {
      label: 'Pick the cash drawer · 3 pins',
      available: () => {
        if (this.s.skill('lockpicking') < 1) return 'Requires Lockpicking 1';
        if (this.s.count('lockpick') < 1) return 'Need a lockpick';
        return true;
      },
      run: async () => {
        const pins = 3 - (this.s.focus('lockpicking') === 'feeler' ? 1 : 0);
        const res = await this.ctx.ui.lockpick({
          pins, title: 'TICKETS · CASH DRAWER',
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
            return this.s.count('lockpick') > 0;
          },
        });
        if (res !== 'success') return;
        if (!this.s.set('site.drivein.tickets')) return;
        this.ticketDoor.target = 1.4;
        this.s.data.stats.picks++;
        this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
        this.s.addXP(XP_REWARDS.lockPicked + pins * 5, 'Cash drawer');
        const got = this.loot([{ id: 'scrap', qty: 3 }, { id: 'battery', qty: 1 }, { id: 'lockpick', qty: 1 }]);
        this.toast(`The night's take: IOUs, a card reader with a good cell in it, and a hairpin. ${got}`, 'good');
      },
    };
  }

  private toggleProjector() {
    if (!this.s.has('site.drivein.power')) return;
    if (!this.s.has('site.drivein.booth')) return;
    const on = !this.s.has('site.drivein.screening');
    if (on) {
      this.s.set('site.drivein.screening');
      this.kt = 0;
      this.cue = 0;
      this.ctx.audio.play('click');
      const night = (this.ctx.atmo.uNight.value as number) > 0.5;
      this.toast(night ? 'The lamp strikes. Fifty metres away, a man in a turtleneck appears on a torn screen.' : 'The lamp strikes. In daylight the screen barely notices. It will be something else after dark.', 'good');
      if (this.s.set('site.drivein.started')) this.s.addXP(XP_REWARDS.talk, 'Projector');
    } else {
      this.s.data.flags = this.s.data.flags.filter((f) => f !== 'site.drivein.screening');
      this.ctx.audio.play('click');
      this.toast('The lamp dies down. The screen goes back to being a ruin.', 'info');
    }
  }

  private async readNote() {
    if (this.s.set('site.drivein.note')) this.s.addXP(15, 'Projectionist\'s note');
    await this.ctx.ui.choose({
      speaker: 'Note on the booth wall',
      text: '"DO NOT SCREEN the uncut reel. The theatrical cut is threaded, the uncut is in the can on the bench. The mic was hot after he walked off and the camera kept rolling. He knows. His people came for the reel the next morning and took the wrong can. Wheels up was eleven. I heard it from the speaker posts like everybody else. — D."',
      choices: [{ id: 'ok', label: 'Leave it pinned' }],
    });
  }

  private listen() {
    if (this.s.has('site.drivein.screening')) {
      const c = [...CUES].reverse().find((q) => q.at <= this.kt) ?? CUES[CUES.length - 1];
      this.ctx.ui.subtitle(c.speaker, c.text);
    } else {
      this.ctx.ui.subtitle('SPEAKER POST', this.s.has('site.drivein.power') ? 'Hiss. A hum, very far away, waiting for a picture.' : 'Nothing. Then, faintly, the wind through the screen.');
    }
  }

  // ================================================================ per frame
  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const s = this.ctx.state;
    if (s !== this.lastState) {
      this.lastState = s;
      const open = !!s?.has('site.drivein.booth');
      this.door.target = this.door.open = open ? -1.5 : 0;
      this.door.collider.setEnabled(!open);
      this.ticketDoor.target = this.ticketDoor.open = s?.has('site.drivein.tickets') ? 1.4 : 0;
      this.reelCan.visible = !s?.has('site.drivein.reel');
      for (const key of Object.keys(this.loops)) { this.loops[key]?.stop(); delete this.loops[key]; }
    }
    // doors
    if (Math.abs(this.door.target - this.door.open) > 1e-3) {
      this.door.open += (this.door.target - this.door.open) * Math.min(1, dt * 4);
      this.door.collider.setEnabled(Math.abs(this.door.open) < 0.3);
    }
    this.door.pivot.rotation.y = this.door.open;
    this.ticketDoor.open += (this.ticketDoor.target - this.ticketDoor.open) * Math.min(1, dt * 4);
    this.ticketDoor.pivot.rotation.y = this.ticketDoor.open;

    const night = this.ctx.atmo.uNight.value as number;
    const powered = !!s?.has('site.drivein.power');
    const running = powered && !!s?.has('site.drivein.screening');
    const d = Math.hypot(cam.x - this.frame.x, cam.z - this.frame.z);
    const inRange = d < 650;
    // up close the whole sign; from the road only the neon, and only after dark
    this.marquee.visible = d < 230;
    this.neonMesh.visible = d < 230 || (inRange && night > 0.2);
    this.screenMesh.castShadow = d < 260;
    // marquee: solar keeps STAR_ _TE glowing at night; the generator lights the rest and the board
    const buzz = Math.sin(this.t * 37) * Math.sin(this.t * 5.3) > 0.9 ? 0.25 : 1;
    this.uNeon.value = night * buzz * (powered ? 1 : 0.65);
    this.uNeonAll.value = powered ? 1 : 0;
    this.uBoard.value = powered ? 0.15 + night * 1.1 : night * 0.08;
    const chase = Math.floor(this.t * 4) % 3;
    this.bulbs.forEach((bl, i) => { bl.intensity.value = powered ? (i === chase ? 7 : 1.2) * (0.3 + night) : 0; });
    for (let i = 0; i < 3; i++) this.kit.halos.channels[2 + i] = powered ? (i === chase ? 1 : 0.2) * night : 0;
    this.kit.halos.channels[1] = powered ? 0 : (Math.floor(this.t * 1.5) % 2) * 0.8;
    this.genLed.intensity.value = powered ? 0 : (Math.floor(this.t * 1.5) % 2) * 3;
    // inside: tubes flicker on with the generator
    const tubeFl = Math.sin(this.t * 23) * Math.sin(this.t * 3.7) > 0.93 ? 0.3 : 1;
    this.tubes.intensity.value = powered ? 3.2 * tubeFl : 0;
    this.hallLight.intensity = powered ? 5 * tubeFl : 0;
    if (this.lods[0]?.near.visible) {
      uSiteNight.value = night;
      uSiteFlicker.value = powered ? 0.9 + 0.1 * tubeFl : 0.35;
    }

    // ---- the projector
    const flick = 0.86 + 0.08 * Math.sin(this.t * 151) + 0.06 * Math.sin(this.t * 37.3) - (Math.random() < 0.015 ? 0.35 : 0);
    if (running) {
      const prev = this.kt;
      this.kt = (this.kt + dt) % KEYNOTE_LEN;
      if (this.kt < prev) this.cue = 0;
      keynoteTint(this.kt, this.tint);
      // redraw at ~10 fps, only while anyone could see it
      this.frameAcc += dt;
      if (this.frameAcc > 0.1 && d < 450) {
        this.frameAcc = 0;
        drawKeynote(this.keyCtx, 512, 240, this.kt, this.frameNo++);
        this.keyTex.needsUpdate = true;
      }
      for (const r of this.reels) r.rotation.x += dt * 2.4;
      // subtitles for anyone in the lot or the booth
      const pl = this.ctx.player?.position;
      const near = pl && this.frame && Math.hypot(pl.x - this.frame.x, pl.z - this.frame.z) < 75;
      while (this.cue < CUES.length && CUES[this.cue].at <= this.kt) {
        if (near) this.ctx.ui.subtitle(CUES[this.cue].speaker, CUES[this.cue].text);
        this.cue++;
      }
      if (s && near && this.kt >= REVEAL_AT && !s.has('site.drivein.done')) {
        s.set('site.drivein.done');
        s.addXP(60, 'The hot mic');
        this.toast('The keynote ends on a hot mic: a jet, wheels up at eleven, north-west. One passenger.', 'good');
      }
    }
    const k = running ? 1 : 0;
    this.uProj.value = k * (0.35 + 1.9 * night) * flick;
    // side-on you look through the whole 50 m of it, so keep it a haze, not a wall
    this.beam.intensity.value = k * (0.02 + 0.22 * night) * flick;
    (this.beam.color.value as THREE.Color).copy(this.tint).lerp(new THREE.Color(1, 1, 1), 0.45);
    this.beamMesh.visible = running && inRange;
    this.screenMesh.visible = inRange;
    this.screenLight.intensity = k * night * 55 * flick;
    this.screenLight.color.copy(this.tint);
    this.boothLight.intensity = running ? 3 * flick : powered ? 0.8 : 0;
    this.portGlow.intensity.value = running ? 12 * flick : 0;

    // ---- audio loops that depend on state
    this.loopIf('generator', powered, this.frame.p(5, 1, 31.2));
    this.loopIf('projector', running, this.frame.p(0, 1.5, 21.5));
    this.loopIf('crowd', running, this.frame.p(0, 1.2, 0));

    // ---- found: standing in the rows
    const pl = this.ctx.player?.position;
    if (s && pl && !s.has('site.drivein.found')) {
      const hp = this.frame.p(this.heart.x, 0, this.heart.z);
      if (Math.hypot(pl.x - hp.x, pl.z - hp.z) < 22) {
        s.set('site.drivein.found');
        this.toast(powered ? 'Rows of rust facing a torn screen. The speakers are humming.' : 'Rows of rust, all facing a torn screen. Every speaker is still on its post.', 'info');
      }
    }
  }

  private loopIf(kind: 'generator' | 'projector' | 'crowd', on: boolean, pos: THREE.Vector3) {
    const h = this.loops[kind];
    if (on && !h) {
      const l = this.ctx.audio.loop(kind, pos);
      if (l) this.loops[kind] = l;
    } else if (!on && h) {
      h.stop();
      delete this.loops[kind];
    }
  }
}

// ------------------------------------------------------------------ helpers
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const bump = (d: number, w: number) => { const t = clamp01(1 - Math.abs(d) / w); return t * t * (3 - 2 * t); };


function mergeGeo(list: THREE.BufferGeometry[]) {
  const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uvs.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}
void vec3; void vec4;
