import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl, beam, place, norm, MeshBatch, DistanceLod, shadowProxy } from '../../world/kit';
import { surfaces } from '@/engine/surface';
import { concrete, plainStandard, rustyMetal, GlowPalette, carGlass, fabric, wood, desertRock } from '../../world/materials';
import { GlowSprites } from '../../world/effects';
import { VirtualLight } from '../../world/lights';
import { rockGeometry } from '../../world/Props';
import { LiveScreen } from '../apex/apexAtlas';
import { spirePrint, spirePrintMaterial, paintBoard, CSL_COLORS, TERRA } from './spireAtlas';
import { SPIRE_RAMP } from '@/content/bunkers/spire';
import type { BunkerShell, Door, Laser, LootSpot, Tripwire } from '../shell';

/**
 * The Alignment Spire, on a pad cut into the first bench of the eastern tablelands. Local metres,
 * origin at the pad's centre, axes as the world's (north is -z). Angles θ from +z toward +x, so a
 * point at radius r is (r sin θ, r cos θ): θ = 180° is north (the front), 270° is west (the valley).
 *
 * - The drum (r 6.4, 14 m): three floors. A white portico on its north face holds the ethics door,
 *   under a cantilevered canopy with Careful's wordmark.
 *   F0 (y 0) the lobby: reception, the safety-level board, the cupboard with the stair beams' power
 *   box, and flight 1 up the east side (lasers across it).
 *   F1 (y 4.6) the eval floor: Eval 3 (glass, Noor asleep at her desk), the red team's wall, flight 2
 *   beside flight 1's well, Sentinel 3 on the ceiling.
 *   F2 (y 9.2) the top floor: flight 2 arrives inside a glass box whose south side is Prudence's
 *   card door; her office and desk at the windows (the only ones, facing the valley); Benny's plant
 *   along the north wall (the tank, the core housing, the red valve).
 * - The spire: a white taper from the drum's crown to 58 m, twelve condenser fins up its sides, the
 *   safety-level ring at the crown and a beacon at the tip in the level's colour.
 * - The access road: a ramp from the highway with guardrails both sides, four infrared beams across
 *   it, Sentinel 1 halfway up, Sentinel 2 on the forecourt; Isaac Fenn under a foil blanket; a dry
 *   standpipe at the foot; Benny's pipe running off west down the hill.
 */
export const SP = {
  R: 6.4, RI: 6.0,
  /** Floor tops and slab thickness; the top floor's ceiling; the drum's height. */
  F: [0, 4.6, 9.2] as const, SLAB: 0.25, CEIL: 13.6, DRUM: 14.2,
  TIP: 58,
  /** The front passage's half-width and height, the portico's face (z) and half-width. */
  GATE: 1.1, GATE_H: 3.2, PORT_Z: -8.4, PORT_W: 3.3,
  /** Stair flights: x span, z span (flight 1 rises north on the east side, flight 2 rises south beside it). */
  F1X: [3.4, 4.8] as const, F2X: [1.8, 3.2] as const, FZ: 3.25,
  /** The top floor's window arc (θ, radians) and band (y above the floor). */
  WIN: [THREE.MathUtils.degToRad(215), THREE.MathUtils.degToRad(325)] as const, WIN_Y: [0.8, 3.4] as const,
  /** The glass box round flight 2's top, and its door (z). */
  BOX_X: [1.7, 3.3] as const, BOX_Z0: -3.35, DOOR_Z: 3.7,
  GROUNDS: 22,
};
const N_STEPS = 18;

/* eslint-disable @typescript-eslint/no-explicit-any */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const M = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
/** A point at radius r, angle θ, height y. */
const P = (r: number, t: number, y = 0) => V(r * Math.sin(t), y, r * Math.cos(t));
/** The spire's radius at height y (a slow concave taper from the crown to the tip). */
const PROFILE: [number, number][] = [[6.4, SP.DRUM], [5.7, 18], [4.2, 27], [2.7, 37], [1.5, 46], [0.75, 53], [0.32, SP.TIP]];
function taper(y: number) {
  if (y <= PROFILE[0][1]) return PROFILE[0][0];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [r0, y0] = PROFILE[i], [r1, y1] = PROFILE[i + 1];
    if (y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return PROFILE[PROFILE.length - 1][0];
}

/** A box from a to b (its length along a→b), w wide (horizontal, across) and h tall. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(b, a, V(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return norm(g.applyMatrix4(m));
}

export interface SentinelSpot { id: string; pos: THREE.Vector3; yaw: number; ceiling: boolean }

export class SpireBuilder implements BunkerShell {
  readonly group = new THREE.Group();
  readonly origin: THREE.Vector3;
  readonly points: Record<string, THREE.Vector3> = {};
  readonly doors: Record<string, Door> = {};
  readonly innerBox: THREE.Box3;
  readonly groundsBox: THREE.Box3;
  readonly tripwires: Tripwire[] = [];
  readonly lasers: Laser[] = [];
  readonly lootSpots: LootSpot[] = [];
  readonly portals: { box: THREE.Box3 }[] = [];
  readonly interior = new THREE.Group();
  lod!: DistanceLod;
  readonly pal = new GlowPalette(48);
  readonly halos = new GlowSprites(10);
  static readonly CH = { ON: 0, NIGHT: 1, BLINK: 2, L1: 3, L2: 4, L3: 5, L4: 6, CANOPY: 7, PLANT: 8 };
  /** The safety-level boards (lobby and door) share one canvas. */
  board!: LiveScreen;
  lights!: { lobby: VirtualLight[]; evals: VirtualLight; top: VirtualLight; plant: VirtualLight; canopy: VirtualLight; pad: VirtualLight };
  readonly slots: Record<'level1' | 'level2' | 'level3' | 'level4' | 'aviation' | 'canopy' | 'cove' | 'fins' | 'core' | 'reader' | 'readerOk' | 'doorScreen' | 'ir' | 'screens' | 'gauges' | 'windows' | 'slits', { value: number }> = {} as never;
  /** Where the sentinels stand (Spire builds them: they move). */
  readonly sentinelSpots: SentinelSpot[] = [];
  /** Seats and spots for the people: Noor's chair (hips), Prudence at the window, Benny at his gauges. */
  noorSeat!: { pos: THREE.Vector3; yaw: number };
  prudenceSpot!: { pos: THREE.Vector3; yaw: number };
  bennySpot!: { pos: THREE.Vector3; yaw: number };
  /** The core cartridge in its housing (hidden once pulled) and the valve wheel (turns when opened). */
  readonly core = new THREE.Group();
  readonly valve = new THREE.Group();
  private far!: THREE.Object3D;

  constructor(private physics: Physics, origin: THREE.Vector3, private ground: (x: number, z: number) => number = () => origin.y) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'spire';
    this.innerBox = new THREE.Box3(this.w(-SP.R, -0.5, -SP.R), this.w(SP.R, SP.DRUM, SP.R));
    this.groundsBox = new THREE.Box3(this.w(-SP.GROUNDS, -4, -SP.GROUNDS), this.w(SP.GROUNDS, 20, SP.GROUNDS));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** World XZ → local, with the ground's local height. */
  private local(x: number, z: number) {
    return V(x - this.origin.x, this.ground(x, z) - this.origin.y, z - this.origin.z);
  }

  /** Inside the drum (its inner wall, plus `margin`), below the top floor's ceiling. */
  contains(p: THREE.Vector3, margin = 0) {
    const x = p.x - this.origin.x, z = p.z - this.origin.z, y = p.y - this.origin.y;
    return x * x + z * z < (SP.RI - 0.1 + margin) ** 2 && y < SP.CEIL + margin && y > -2;
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

  /** A curved skin at radius r from y0 to y1, angles a0…a1; `out` faces outward (else inward). */
  private skin(b: MeshBatch, mat: THREE.Material, r: number, y0: number, y1: number, a0: number, a1: number, out: boolean, seg = 64) {
    const pts = out ? [new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)] : [new THREE.Vector2(r, y1), new THREE.Vector2(r, y0)];
    const n = Math.max(2, Math.round(seg * (a1 - a0) / (Math.PI * 2)));
    b.add(mat, place(new THREE.LatheGeometry(pts, n, a0, a1 - a0)));
  }

  /** A floor slab (top at y) with a rectangular hole, its top in `floor`, edges and underside in `under`. */
  private slab(b: MeshBatch, floor: THREE.Material, under: THREE.Material, y: number, hole: [number, number, number, number] | null) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, SP.RI + 0.02, 0, Math.PI * 2, false);
    if (hole) {
      const [x0, x1, z0, z1] = hole;
      const h = new THREE.Path();
      // shape y = -z (the slab is laid flat with rotateX(-90°))
      h.moveTo(x0, -z0); h.lineTo(x0, -z1); h.lineTo(x1, -z1); h.lineTo(x1, -z0); h.lineTo(x0, -z0);
      shape.holes.push(h);
    }
    const ext = new THREE.ExtrudeGeometry(shape, { depth: SP.SLAB - 0.01, bevelEnabled: false, curveSegments: 40 });
    ext.rotateX(-Math.PI / 2);
    ext.translate(0, y - SP.SLAB, 0);
    b.add(under, norm(ext));
    const top = new THREE.ShapeGeometry(shape, 40);
    top.rotateX(-Math.PI / 2);
    top.translate(0, y + 0.002, 0);
    b.add(floor, norm(top));
    // colliders: strips along x, split round the hole
    const R = SP.RI;
    for (let x = -R; x < R; x += 1) {
      // (each strip reaches the wall at its inner edge: the overshoot is buried in the wall)
      const xm = x + 0.5, zc = Math.sqrt(Math.max(0, R * R - Math.min(x * x, (x + 1) ** 2)));
      if (zc <= 0.05) continue;
      const spans: [number, number][] = [];
      if (hole && xm > hole[0] - 0.5 && xm < hole[1] + 0.5 && x + 1 > hole[0] && x < hole[1]) {
        // the strip overlaps the hole: split at the hole's z, and fill the part beside it in x
        spans.push([-zc, hole[2]], [hole[3], zc]);
        const lx0 = Math.max(x, -R), lx1 = hole[0];
        if (lx1 - lx0 > 0.05) this.col((lx0 + lx1) / 2, y - SP.SLAB / 2, (hole[2] + hole[3]) / 2, (lx1 - lx0) / 2, SP.SLAB / 2, (hole[3] - hole[2]) / 2);
        const rx0 = hole[1], rx1 = x + 1;
        if (rx1 - rx0 > 0.05) this.col((rx0 + rx1) / 2, y - SP.SLAB / 2, (hole[2] + hole[3]) / 2, (rx1 - rx0) / 2, SP.SLAB / 2, (hole[3] - hole[2]) / 2);
      } else spans.push([-zc, zc]);
      for (const [z0, z1] of spans) if (z1 - z0 > 0.05) this.col(xm, y - SP.SLAB / 2, (z0 + z1) / 2, 0.5, SP.SLAB / 2, (z1 - z0) / 2);
    }
  }

  /**
   * A straight flight from (zBot, yBot) to yTop, rising toward `dir` (-1 north, +1 south), x0…x1:
   * box treads, a stringer under them, and one sloped collider through the nosings.
   */
  private flight(b: MeshBatch, tread: THREE.Material, side: THREE.Material, x0: number, x1: number, zBot: number, yBot: number, yTop: number, dir: number) {
    const h = (yTop - yBot) / N_STEPS, d = (SP.FZ * 2) / N_STEPS, wdt = x1 - x0, xc = (x0 + x1) / 2;
    for (let i = 0; i < N_STEPS; i++) {
      const z = zBot + dir * (i + 0.5) * d;
      b.add(tread, box(wdt, 0.06, d + 0.02, xc, yBot + (i + 1) * h - 0.03, z));
      b.add(side, box(wdt, h - 0.06, 0.04, xc, yBot + i * h + (h - 0.06) / 2, zBot + dir * i * d + dir * 0.02));
    }
    // the stringer: a sloped slab under the treads, and a solid wall on the outer side
    const a = V(xc, yBot - 0.15, zBot), c = V(xc, yTop - 0.15, zBot + dir * SP.FZ * 2);
    b.add(side, bar(a, c, wdt, 0.25));
    // the collider: the nosing line, from a tread before the first riser to the top
    const p0 = V(xc, yBot, zBot - dir * d), p1 = V(xc, yTop, zBot + dir * (N_STEPS - 1) * d);
    const len = p0.distanceTo(p1), mid = p0.clone().add(p1).multiplyScalar(0.5);
    const dirv = p1.clone().sub(p0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dirv);
    const nrm = V(0, 1, 0).applyQuaternion(q);
    mid.addScaledVector(nrm, -0.15);
    this.physics.addBoxRot(this.w(mid.x, mid.y, mid.z), { x: wdt / 2, y: 0.15, z: len / 2 }, q);
    // and the last tread to the slab's edge, flat
    const zEnd = zBot + dir * (N_STEPS * d + 0.15);
    this.col(xc, yTop - 0.125, (p1.z + zEnd) / 2, wdt / 2, 0.125, Math.abs(zEnd - p1.z) / 2);
  }

  /** A sliding door leaf along x at z (the front door, the top door). */
  private slideDoor(id: string, x0: number, x1: number, y0: number, z: number, h: number, amount: number, leaf: (b: MeshBatch, w: number) => void, parent: THREE.Object3D) {
    const pivot = new THREE.Group();
    pivot.position.set(x0, y0, z);
    pivot.userData.x0 = x0;
    const lb = new MeshBatch();
    leaf(lb, x1 - x0);
    pivot.add(lb.build(`spireDoor:${id}`));
    parent.add(pivot);
    const pos = this.w((x0 + x1) / 2, y0 + h / 2, z), half = V(Math.abs(x1 - x0) / 2, h / 2, 0.12);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'slide', amount, colliderSpec: { pos, half } };
  }

  /** A glowing quad/box in a palette slot, as its own mesh (it toggles: tripwires, beams). */
  private palMesh(slot: { index: number }, g: THREE.BufferGeometry) {
    const uvA = g.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < uvA.count; j++) uvA.setXY(j, (slot.index + 0.5) / 48, 0.5);
    const mesh = new THREE.Mesh(g, this.pal.material);
    mesh.castShadow = false;
    return mesh;
  }

  private build() {
    const b = new MeshBatch(), inner = new MeshBatch();
    const m = this.mats();
    this.board = new LiveScreen(512, 256, () => {});
    this.board.paint = (c, w, h) => paintBoard(c, w, h, 1, false, 1284);
    this.board.repaint();
    this.buildDrum(b, inner, m);
    this.buildSpire(b, m);
    this.buildFront(b, m);
    this.buildLobby(inner, m);
    this.buildEvals(inner, m);
    this.buildTop(b, inner, m);
    this.buildForecourt(b, m);
    this.buildRoad(b, m);
    this.buildLights();
    // footsteps: stone on the pad and inside (the top floor is wood)
    surfaces.zone(this.w(-SP.GROUNDS, -2, -SP.GROUNDS), this.w(SP.GROUNDS, 8.9, SP.GROUNDS), 'concrete');
    surfaces.zone(this.w(-SP.RI, 8.9, -SP.RI), this.w(SP.RI, 14, SP.RI), 'wood');

    this.far = b.buildFar('spire-far', { minSize: 0.9 });
    const statics = b.build('spireStatic');
    this.group.add(statics);
    this.interior.add(inner.build('spireInner'));
    this.interior.name = 'spire-interior';
    this.interior.add(this.core, this.valve);
    this.group.add(this.interior);
    this.group.add(this.halos.build());
    shadowProxy(statics);
    for (const d of Object.values(this.doors)) shadowProxy(d.pivot);

    const near = new THREE.Group();
    near.name = 'spire-near';
    const keep = new Set<THREE.Object3D>([this.halos.sprite]);
    for (const c of [...this.group.children]) if (!keep.has(c)) near.add(c);
    this.group.add(near, this.far);
    // 58 m tall at the top of a slope: the stand-in carries it to well past a kilometre
    this.lod = new DistanceLod(this.origin.clone(), 14, near, this.far, 170, 1400);
    // the window band is an opening: interior mode draws the outside whenever it's in view
    this.portals.push({ box: new THREE.Box3(this.w(-SP.R - 0.4, SP.F[2] + 0.6, -5.4), this.w(-1.5, SP.F[2] + 3.6, 5.6)) });
  }

  private mats() {
    return {
      white: concrete('#ece8e0', { scale: 0.5, stains: 0.35 }),
      cream: plainStandard('#efe7da', 0.85, 0),
      terra: plainStandard('#b9583a', 0.7, 0.02),
      fin: plainStandard('#dfe2e1', 0.32, 0.65),
      stone: plainStandard('#d3cbbd', 0.45, 0.02),
      vinyl: plainStandard('#cfcbc2', 0.6, 0.02),
      oak: wood('#b48a5c'),
      pad: concrete('#a39a8b', { scale: 0.8, stains: 0.5 }),
      joint: plainStandard('#5e584f', 0.9, 0),
      dark: plainStandard('#2b2826', 0.55, 0.2),
      black: plainStandard('#151515', 0.5, 0.3),
      steel: plainStandard('#bfc4c8', 0.28, 0.9),
      brushed: plainStandard('#9ca3a8', 0.4, 0.85),
      rail: rustyMetal({ base: '#c4c8c6', rust: 0.18, metalness: 0.75 }),
      post: rustyMetal({ base: '#8f918c', rust: 0.35, metalness: 0.6 }),
      glass: carGlass(),
      clear: plainStandard('#cfe0dc', 0.06, 0.2, { transparent: true, opacity: 0.16, depthWrite: false }),
      frost: plainStandard('#e6eeee', 0.25, 0.1, { transparent: true, opacity: 0.55, depthWrite: false }),
      sofa: fabric('#c7b393'),
      chair: fabric('#3e3a37'),
      green: plainStandard('#5a7a3c', 0.9, 0),
      soil: plainStandard('#3a2e22', 0.95, 0),
      foil: plainStandard('#d8c27a', 0.22, 0.9),
      boot: plainStandard('#4a3626', 0.8, 0.05),
      paper: plainStandard('#f1ede4', 0.9, 0),
      redValve: plainStandard('#b8261c', 0.45, 0.4),
      rock: desertRock(),
      print: spirePrintMaterial(),
    };
  }

  // ------------------------------------------------------------------ the drum: walls, floors, stairs
  private buildDrum(b: MeshBatch, d: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const { R, RI, GATE, GATE_H, DRUM, CEIL, F } = SP;
    const gap = Math.asin(GATE / R) + 0.004, gapIn = Math.asin(GATE / RI) + 0.004;
    const N = Math.PI, TAU = Math.PI * 2;
    const [w0, w1] = SP.WIN, wy0 = F[2] + SP.WIN_Y[0], wy1 = F[2] + SP.WIN_Y[1];
    // outer skin: round the front passage below its head, whole above it, open over the window band
    this.skin(b, m.white, R, 0, GATE_H, N + gap, N - gap + TAU, true);
    this.skin(b, m.white, R, GATE_H, wy0, 0, TAU, true);
    this.skin(b, m.white, R, wy0, wy1, w1, w0 + TAU, true);
    this.skin(b, m.white, R, wy1, DRUM, 0, TAU, true);
    // inner skin (cream): the same openings. The top floor's shell is in the static batch so the
    // windows show a room from outside; the lower floors' are inside-only
    this.skin(d, m.cream, RI, 0, GATE_H, N + gapIn, N - gapIn + TAU, false);
    this.skin(d, m.cream, RI, GATE_H, F[2], 0, TAU, false);
    this.skin(b, m.cream, RI, F[2], wy0, 0, TAU, false);
    this.skin(b, m.cream, RI, wy0, wy1, w1, w0 + TAU, false);
    this.skin(b, m.cream, RI, wy1, CEIL, 0, TAU, false);
    // the passage's reveals through the wall
    for (const s of [-1, 1]) d.add(m.cream, box(0.04, GATE_H, R - RI + 0.1, s * GATE, GATE_H / 2, -(RI + R) / 2));
    // a plinth course and the crown's cornice
    this.skin(b, m.dark, R + 0.12, 0, 0.45, N + gap + 0.02, N - gap - 0.02 + TAU, true);
    b.add(m.dark, place(new THREE.RingGeometry(R, R + 0.12, 64), 0, 0.45, 0, -Math.PI / 2));
    // walls (colliders): all round, the front passage open
    this.ringCol(R - 0.2, 0.45, 0, DRUM, N + gap, N - gap + TAU, 40);
    this.col(0, GATE_H + (DRUM - GATE_H) / 2, -(R - 0.2), GATE + 0.2, (DRUM - GATE_H) / 2, 0.22);
    // the window band: glass between steel mullions, a sill and a head
    this.skin(b, m.glass, R - 0.18, wy0, wy1, w0, w1, true, 96);
    for (let t = w0; t <= w1 + 1e-3; t += (w1 - w0) / 11) {
      const p = P(R - 0.14, t);
      b.add(m.brushed, box(0.08, wy1 - wy0, 0.3, p.x, (wy0 + wy1) / 2, p.z, t));
    }
    for (const y of [wy0, wy1]) this.skin(b, m.brushed, R - 0.02, y - 0.06, y + 0.06, w0 - 0.02, w1 + 0.02, true, 96);
    // (a ring's angle φ lies flat at θ = φ + 90°)
    // behind the glass, facing out only: a warm panel that reads as the lit room at night (from
    // inside it's a back face, culled, so it never blocks the view)
    const win = this.pal.slot('#ffcf94', 0);
    this.slots.windows = win.intensity;
    const wg = new THREE.LatheGeometry([new THREE.Vector2(R - 0.3, wy0 + 0.05), new THREE.Vector2(R - 0.3, wy1 - 0.05)], 48, w0, w1 - w0);
    win.add(b, place(wg));
    // floor reveals (dark grooves where each floor meets the wall) and tall lit slits on the east and south
    for (const y of [F[1] - 0.1, F[2] - 0.1]) this.skin(b, m.dark, R + 0.015, y - 0.05, y + 0.05, 0, Math.PI * 2, true);
    const slit = this.pal.slot('#ffd9a8', 0);
    this.slots.slits = slit.intensity;
    for (const t of [20, 45, 70, 95, 120, 145].map((a) => THREE.MathUtils.degToRad(a))) {
      for (const [y0, y1] of [[0.9, 3.5], [F[1] + 0.6, F[1] + 3.6]]) {
        const p = P(R + 0.005, t);
        b.add(m.glass, box(0.22, y1 - y0, 0.02, p.x, (y0 + y1) / 2, p.z, t));
        slit.add(b, box(0.16, y1 - y0 - 0.1, 0.01, P(R - 0.005, t).x, (y0 + y1) / 2, P(R - 0.005, t).z, t));
        b.add(m.brushed, box(0.3, 0.05, 0.08, p.x, y1 + 0.03, p.z, t), box(0.3, 0.05, 0.08, p.x, y0 - 0.03, p.z, t));
      }
    }
    const sill = new THREE.RingGeometry(RI - 0.02, R, 48, 1, w0 - Math.PI / 2, w1 - w0);
    b.add(m.oak, place(sill, 0, wy0, 0, -Math.PI / 2));
    // floors: the lobby on the ground (stone), the eval floor (vinyl), the top floor (oak)
    d.add(m.stone, place(new THREE.CircleGeometry(RI + 0.02, 64), 0, 0.02, 0, -Math.PI / 2));
    const [fx0, fx1] = SP.F1X, [gx0, gx1] = SP.F2X;
    this.slab(d, m.vinyl, m.cream, F[1], [fx0 - 0.1, fx1 + 0.1, -SP.FZ - 0.1, SP.FZ + 0.1]);
    this.slab(b, m.oak, m.cream, F[2], [gx0 - 0.1, gx1 + 0.1, -SP.FZ - 0.1, SP.FZ + 0.1]);
    b.add(m.cream, place(new THREE.CircleGeometry(RI + 0.02, 64), 0, CEIL, 0, Math.PI / 2));
    // the flights: 1 up the east side (lobby → evals, rising north), 2 beside its well (evals → top, rising south)
    this.flight(d, m.oak, m.cream, fx0, fx1, SP.FZ, F[0], F[1], -1);
    this.flight(d, m.oak, m.cream, gx0, gx1, -SP.FZ, F[1], F[2], 1);
    // flight 1's outer wall (it hugs a chord, not the drum) and its glass balustrade
    d.add(m.cream, box(0.12, F[1], SP.FZ * 2 + 0.4, fx1 + 0.08, F[1] / 2, 0));
    this.col(fx1 + 0.08, F[1] / 2, 0, 0.06, F[1] / 2, SP.FZ + 0.2);
    for (let i = 0; i <= 3; i++) {
      const z = SP.FZ - i * (SP.FZ * 2) / 3, y = ((SP.FZ - z) / (SP.FZ * 2)) * F[1];
      d.add(m.brushed, box(0.05, 1.0, 0.05, fx0 - 0.04, y + 0.5, z));
    }
    d.add(m.brushed, bar(V(fx0 - 0.04, 1.0, SP.FZ), V(fx0 - 0.04, F[1] + 1.0, -SP.FZ), 0.06, 0.05));
    d.add(m.clear, bar(V(fx0 - 0.04, 0.55, SP.FZ), V(fx0 - 0.04, F[1] + 0.55, -SP.FZ), 0.02, 0.85));
    // the well's guard on the eval floor (glass on two sides; you top out at its north end)
    d.add(m.clear, box(0.03, 1.05, SP.FZ * 2 + 0.2, fx0 - 0.12, F[1] + 0.53, 0), box(fx1 - fx0 + 0.25, 1.05, 0.03, (fx0 + fx1) / 2, F[1] + 0.53, SP.FZ + 0.12));
    d.add(m.brushed, box(0.05, 0.05, SP.FZ * 2 + 0.2, fx0 - 0.12, F[1] + 1.06, 0), box(fx1 - fx0 + 0.25, 0.05, 0.05, (fx0 + fx1) / 2, F[1] + 1.06, SP.FZ + 0.12));
    this.col(fx0 - 0.12, F[1] + 0.55, 0, 0.04, 0.55, SP.FZ + 0.1);
    this.col((fx0 + fx1) / 2, F[1] + 0.55, SP.FZ + 0.12, (fx1 - fx0) / 2 + 0.12, 0.55, 0.04);
    // flight 2: a handrail on its open (west) side, and a wall under it so nobody walks underneath
    d.add(m.brushed, bar(V(gx0 - 0.03, F[1] + 1.0, -SP.FZ), V(gx0 - 0.03, F[2] + 1.0, SP.FZ), 0.05, 0.05));
    d.add(m.clear, bar(V(gx0 - 0.03, F[1] + 0.55, -SP.FZ), V(gx0 - 0.03, F[2] + 0.55, SP.FZ), 0.02, 0.85));
    d.add(m.cream, box(0.1, (F[2] - F[1]) / 2, SP.FZ, gx0 + 0.05, F[1] + (F[2] - F[1]) / 4, SP.FZ / 2));
    this.col(gx0 - 0.02, F[1] + 0.9, 0, 0.04, 0.9, SP.FZ);
    // the lasers across flight 1: emitters on its wall, beams to the balustrade
    const beamSlots = ['l1', 'l2', 'l3'].map(() => this.pal.slot('#ff2a22', 7));
    [2.0, 0.2, -1.6].forEach((z, i) => {
      const y = ((SP.FZ - z) / (SP.FZ * 2)) * F[1] + 0.62;
      const a = this.w(fx0, y, z), c = this.w(fx1, y, z);
      const g = box(fx1 - fx0, 0.012, 0.012, (fx0 + fx1) / 2, y, z);
      const mesh = this.palMesh(beamSlots[i], g);
      d.add(m.black, box(0.08, 0.12, 0.08, fx1 + 0.02, y, z), box(0.06, 0.1, 0.06, fx0 - 0.04, y, z));
      this.group.add(mesh);
      this.lasers.push({ id: `stair${i + 1}`, a, b: c, mesh, intensity: beamSlots[i].intensity });
    });
    this.points.stairFoot = this.w((fx0 + fx1) / 2, 0.2, SP.FZ + 0.9);
    this.points.interior = this.w(0, 1.0, -3.4);
    // the top floor's glass box round flight 2's head, and Prudence's card door at its south end
    const [bx0, bx1] = SP.BOX_X, bz0 = SP.BOX_Z0, dz = SP.DOOR_Z, top = F[2], hh = CEIL - top;
    b.add(m.clear, box(0.03, hh, dz - bz0, bx0, top + hh / 2, (bz0 + dz) / 2), box(0.03, hh, dz - bz0, bx1, top + hh / 2, (bz0 + dz) / 2), box(bx1 - bx0, hh, 0.03, (bx0 + bx1) / 2, top + hh / 2, bz0));
    for (const x of [bx0, bx1]) for (const z of [bz0, dz]) b.add(m.brushed, box(0.06, hh, 0.06, x, top + hh / 2, z));
    b.add(m.brushed, box(bx1 - bx0 + 0.06, 0.08, 0.08, (bx0 + bx1) / 2, top + 2.45, dz));
    for (const x of [bx0, bx1]) this.col(x, top + 1.2, (bz0 + dz) / 2, 0.04, 1.2, (dz - bz0) / 2);
    this.col((bx0 + bx1) / 2, top + 1.2, bz0, (bx1 - bx0) / 2, 1.2, 0.04);
    b.add(m.clear, box(bx1 - bx0, hh - 2.45, 0.03, (bx0 + bx1) / 2, top + 2.45 + (hh - 2.45) / 2, dz));
    this.slideDoor('officeDoor', bx0, bx1, top, dz, 2.4, bx1 - bx0 + 0.05, (lb, wd) => {
      lb.add(m.frost, box(wd, 2.36, 0.04, wd / 2, 1.2, 0));
      lb.add(m.brushed, box(wd, 0.06, 0.06, wd / 2, 2.38, 0), box(0.06, 2.4, 0.06, 0.03, 1.2, 0), box(0.06, 2.4, 0.06, wd - 0.03, 1.2, 0));
      lb.add(m.print, spirePrint('ashbyPlate', 0.55, 0.16, M(wd / 2, 1.55, -0.03, Math.PI)));
    }, this.group);
    const reader = this.pal.slot(TERRA, 2.5), ok = this.pal.slot('#5fe08a', 0);
    this.slots.reader = reader.intensity;
    this.slots.readerOk = ok.intensity;
    b.add(m.black, box(0.1, 0.16, 0.03, bx1 - 0.12, top + 1.25, dz - 0.05));
    reader.add(b, box(0.06, 0.02, 0.01, bx1 - 0.12, top + 1.3, dz - 0.068));
    ok.add(b, box(0.06, 0.02, 0.01, bx1 - 0.12, top + 1.26, dz - 0.068));
    this.points.officeDoor = this.w((bx0 + bx1) / 2, top + 1.2, dz - 0.7);
    // ceiling coves round each floor (one warm palette slot)
    const cove = this.pal.slot('#ffe2b8', 2.2);
    this.slots.cove = cove.intensity;
    for (const y of [F[1] - SP.SLAB - 0.05, F[2] - SP.SLAB - 0.05]) cove.add(d, place(new THREE.TorusGeometry(RI - 0.15, 0.025, 4, 64), 0, y, 0, Math.PI / 2));
    cove.add(b, place(new THREE.TorusGeometry(RI - 0.15, 0.025, 4, 64), 0, CEIL - 0.06, 0, Math.PI / 2));
  }

  // ------------------------------------------------------------------ the spire: taper, fins, crown, tip
  private buildSpire(b: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const C = SpireBuilder.CH;
    b.add(m.white, place(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 64)));
    // the cornice and the terracotta crown band
    this.skin(b, m.white, SP.R + 0.18, SP.DRUM - 0.5, SP.DRUM, 0, Math.PI * 2, true);
    b.add(m.white, place(new THREE.RingGeometry(SP.R, SP.R + 0.18, 64), 0, SP.DRUM, 0, -Math.PI / 2), place(new THREE.RingGeometry(SP.R, SP.R + 0.18, 64), 0, SP.DRUM - 0.5, 0, Math.PI / 2));
    this.skin(b, m.terra, taper(SP.DRUM + 0.6) + 0.02, SP.DRUM + 0.3, SP.DRUM + 1.3, 0, Math.PI * 2, true);
    // the safety-level ring: four colours, one lit (the runtime picks); halos so it reads from the valley
    const lv = CSL_COLORS.map((c, i) => this.pal.slot(c, i === 0 ? 5 : 0));
    lv.forEach((s, i) => { this.slots[`level${i + 1}` as 'level1'] = s.intensity; });
    const ringY = SP.DRUM + 1.6, ringR = taper(ringY) + 0.08;
    for (const s of lv) s.add(b, place(new THREE.TorusGeometry(ringR, 0.07, 6, 72), 0, ringY, 0, Math.PI / 2));
    for (let i = 0; i < 10; i++) {
      const p = P(ringR + 0.1, (i / 10) * Math.PI * 2, ringY);
      lv.forEach((_, k) => this.halos.add(this.w(p.x, p.y, p.z), CSL_COLORS[k], 3.2, C.L1 + k, 1.4));
    }
    // twelve condenser fins up the taper (the plant's cold surfaces), a faint line of water light at
    // their edges at night
    const fins = this.pal.slot('#7fe2ff', 0.2);
    this.slots.fins = fins.intensity;
    const y0 = SP.DRUM + 2.2, y1 = 50;
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2 + Math.PI / 12;
      const shape = new THREE.Shape(), edge = new THREE.Shape();
      const steps = 18, depth = (y: number) => 1.55 - ((y - y0) / (y1 - y0)) * 1.2;
      for (let i = 0; i <= steps; i++) { const y = y0 + ((y1 - y0) * i) / steps; i ? shape.lineTo(taper(y) - 0.05, y) : shape.moveTo(taper(y) - 0.05, y); }
      for (let i = steps; i >= 0; i--) { const y = y0 + ((y1 - y0) * i) / steps; shape.lineTo(taper(y) + depth(y), y); }
      for (let i = 0; i <= steps; i++) { const y = y0 + ((y1 - y0) * i) / steps; i ? edge.lineTo(taper(y) + depth(y) - 0.03, y) : edge.moveTo(taper(y) + depth(y) - 0.03, y); }
      for (let i = steps; i >= 0; i--) { const y = y0 + ((y1 - y0) * i) / steps; edge.lineTo(taper(y) + depth(y) + 0.015, y); }
      const orient = (g: THREE.BufferGeometry, th: number) => { g.translate(0, 0, -th / 2); g.rotateY(-Math.PI / 2); g.rotateY(t); return norm(g); };
      b.add(m.fin, orient(new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false }), 0.07));
      fins.add(b, orient(new THREE.ExtrudeGeometry(edge, { depth: 0.09, bevelEnabled: false }), 0.09));
    }
    // two collars round the taper where the fins are braced, a terracotta line on each
    for (const cy of [24, 38]) {
      const r = taper(cy);
      b.add(m.brushed, place(new THREE.TorusGeometry(r + 0.12, 0.16, 8, 64), 0, cy, 0, Math.PI / 2));
      this.skin(b, m.terra, r + 0.02, cy - 0.5, cy - 0.3, 0, Math.PI * 2, true);
    }
    // the tip: a slim mast, the beacon in the level's colour, and a red aviation light
    b.add(m.brushed, cyl(0.06, 0.12, 4, 0, SP.TIP + 2, 0, 8));
    for (const s of lv) s.add(b, place(new THREE.SphereGeometry(0.28, 12, 8), 0, SP.TIP + 0.4, 0));
    lv.forEach((_, k) => this.halos.add(this.w(0, SP.TIP + 0.4, 0), CSL_COLORS[k], 7, C.L1 + k, 1.8));
    const avi = this.pal.slot('#ff2a14', 4);
    this.slots.aviation = avi.intensity;
    avi.add(b, place(new THREE.SphereGeometry(0.12, 8, 6), 0, SP.TIP + 4.1, 0));
    this.halos.add(this.w(0, SP.TIP + 4.1, 0), '#ff3020', 2.4, C.BLINK, 2);
    this.points.tip = this.w(0, SP.TIP, 0);
  }

  // ------------------------------------------------------------------ the front: portico, door, canopy
  private buildFront(b: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const { GATE, GATE_H, PORT_Z, PORT_W } = SP;
    const z0 = -(SP.R - 0.6), depth = z0 - PORT_Z, zc = (z0 + PORT_Z) / 2, H = 4.0;
    // two masses either side of the passage and a lintel over it
    for (const s of [-1, 1]) {
      const xc = s * (GATE + (PORT_W - GATE) / 2), wd = PORT_W - GATE;
      b.add(m.white, box(wd, H, depth, xc, H / 2, zc));
      this.col(xc, H / 2, zc, wd / 2, H / 2, depth / 2);
    }
    b.add(m.white, box(GATE * 2, H - GATE_H, depth, 0, GATE_H + (H - GATE_H) / 2, zc));
    b.add(m.cream, box(GATE * 2, 0.02, depth, 0, GATE_H - 0.01, zc));
    b.add(m.stone, box(GATE * 2, 0.04, depth, 0, 0.02, zc));
    for (const s of [-1, 1]) b.add(m.cream, box(0.02, GATE_H, depth, s * GATE, GATE_H / 2, zc));
    // the ethics door: white, set back a little in its frame, sliding west into the mass
    this.slideDoor('frontDoor', -GATE, GATE, 0, PORT_Z + 0.3, GATE_H, -(GATE * 2), (lb, wd) => {
      lb.add(m.cream, box(wd, GATE_H, 0.1, wd / 2, GATE_H / 2, 0));
      lb.add(m.brushed, box(0.04, 1.2, 0.05, wd - 0.18, 1.1, -0.07));
      lb.add(m.terra, box(wd, 0.08, 0.11, wd / 2, 0.04, 0));
    }, this.group);
    // the screen, the plate and the speaker grille on the east mass's face; the service panel below
    const face = PORT_Z - 0.01, sx = GATE + 1.1;
    const screen = this.pal.slot('#9ff2cf', 1.6);
    this.slots.doorScreen = screen.intensity;
    b.add(m.black, box(0.62, 0.42, 0.04, sx, 1.75, face));
    b.add(m.print, spirePrint('doorScreen', 0.54, 0.34, M(sx, 1.75, face - 0.025, Math.PI)));
    screen.add(b, box(0.58, 0.02, 0.01, sx, 1.53, face - 0.03));
    b.add(m.print, spirePrint('doorPlate', 0.9, 0.45, M(sx, 1.12, face - 0.02, Math.PI)));
    b.add(m.dark, box(0.5, 0.36, 0.06, sx, 0.5, face));
    b.add(m.brushed, box(0.44, 0.04, 0.02, sx, 0.6, face - 0.035), box(0.44, 0.04, 0.02, sx, 0.4, face - 0.035));
    for (let i = 0; i < 6; i++) b.add(m.black, box(0.5, 0.02, 0.02, 0, 3.45 + i * 0.07, PORT_Z - 0.01));
    this.points.speaker = this.w(0, 3.6, PORT_Z - 0.2);
    this.points.door = this.w(0, 1.2, PORT_Z - 1.0);
    // the board by the door (the level and the days without an incident)
    b.add(m.black, box(1.5, 0.8, 0.06, -(GATE + 1.1), 1.85, face));
    b.add(this.board.material, place(new THREE.PlaneGeometry(1.4, 0.7), -(GATE + 1.1), 1.85, face - 0.035, 0, Math.PI, 0));
    // the canopy: a cantilevered slab, the wordmark on its fascia, a lit soffit
    const cz = PORT_Z - 1.6, cw = 8.6, cd = 3.6;
    b.add(m.white, box(cw, 0.32, cd, 0, H + 0.16, cz));
    b.add(m.terra, box(cw + 0.02, 0.06, cd + 0.02, 0, H + 0.35, cz));
    // (letters standing on the canopy's front edge, against the sky)
    b.add(m.print, spirePrint('wordmark', 3.6, 0.9, M(0, H + 0.83, cz - cd / 2 + 0.1, Math.PI)));
    const soffit = this.pal.slot('#ffd9a8', 3);
    this.slots.canopy = soffit.intensity;
    soffit.add(b, box(cw - 1.2, 0.02, 0.12, 0, H - 0.01, cz - 0.6), box(cw - 1.2, 0.02, 0.12, 0, H - 0.01, cz + 0.6));
    this.halos.add(this.w(0, H - 0.2, cz - 0.6), '#ffcf98', 2.4, SpireBuilder.CH.CANOPY, 1.2);
    // the door's mat and the floor stencil
    b.add(m.dark, box(GATE * 2 + 0.6, 0.02, 1.6, 0, 0.01, PORT_Z - 0.9));
    b.add(m.print, spirePrint('floorRail', 3.0, 0.75, M(0, 0.03, PORT_Z - 2.6, 0, -Math.PI / 2)));
  }

  // ------------------------------------------------------------------ F0: the lobby
  private buildLobby(d: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const RI = SP.RI;
    // reception: a long desk facing the door, terracotta front with the mark
    d.add(m.cream, box(3.2, 1.05, 0.7, -0.4, 0.525, -1.6));
    d.add(m.terra, box(3.22, 0.9, 0.04, -0.4, 0.48, -1.97));
    d.add(m.print, spirePrint('wordmark', 1.7, 0.42, M(-0.4, 0.62, -2.0, Math.PI)));
    d.add(m.oak, box(3.3, 0.05, 0.85, -0.4, 1.07, -1.6));
    d.add(m.black, box(0.5, 0.32, 0.03, -0.9, 1.3, -1.35, 0.2), box(0.06, 0.15, 0.06, -0.9, 1.12, -1.32));
    d.add(m.chair, box(0.5, 0.08, 0.5, -0.6, 0.48, -0.95), box(0.5, 0.5, 0.06, -0.6, 0.75, -0.7), cyl(0.03, 0.03, 0.44, -0.6, 0.24, -0.95, 6));
    this.col(-0.4, 0.55, -1.6, 1.65, 0.55, 0.4);
    d.add(m.print, spirePrint('floorWait', 2.6, 0.65, M(-0.4, 0.03, -3.0, 0, -Math.PI / 2)));
    // the board on the south wall, facing the door
    d.add(m.black, box(1.96, 1.04, 0.06, 0, 2.5, RI - 0.05));
    d.add(this.board.material, place(new THREE.PlaneGeometry(1.86, 0.93), 0, 2.5, RI - 0.085, 0, Math.PI, 0));
    // posters and the levels explained, round the west wall
    const onWall = (name: string, wd: number, ht: number, t: number, y: number) => {
      const p = P(RI - 0.02, t);
      d.add(m.print, spirePrint(name, wd, ht, M(p.x, y, p.z, t + Math.PI)));
    };
    onWall('cslLegend', 1.1, 1.38, THREE.MathUtils.degToRad(270), 1.7);
    onWall('posterRev', 0.8, 1.12, THREE.MathUtils.degToRad(238), 1.65);
    onWall('posterPause', 0.8, 1.12, THREE.MathUtils.degToRad(302), 1.65);
    // benches along the west wall, plants between them
    for (const t of [THREE.MathUtils.degToRad(252), THREE.MathUtils.degToRad(288)]) {
      const p = P(RI - 0.55, t);
      d.add(m.sofa, box(1.5, 0.42, 0.55, p.x, 0.21, p.z, t), box(1.5, 0.45, 0.14, P(RI - 0.25, t).x, 0.62, P(RI - 0.25, t).z, t));
      this.col(p.x, 0.3, p.z, 0.75, 0.3, 0.35, t);
    }
    this.plant(d, m, P(RI - 0.5, Math.PI * 1.5), 0.9);
    this.plant(d, m, P(RI - 0.6, THREE.MathUtils.degToRad(215)), 1.2);
    this.plant(d, m, V(1.8, 0, -4.6), 1.0);
    // the cupboard behind reception: doors open, shelves, a first-aid kit, and the power box
    const cx = -2.3, cz = 5.0;
    d.add(m.cream, box(1.2, 2.1, 0.05, cx, 1.05, cz + 0.42), box(0.05, 2.1, 0.85, cx - 0.6, 1.05, cz), box(0.05, 2.1, 0.85, cx + 0.6, 1.05, cz), box(1.2, 0.05, 0.85, cx, 2.1, cz));
    for (const y of [0.35, 1.0, 1.6]) d.add(m.oak, box(1.15, 0.03, 0.8, cx, y, cz));
    d.add(m.cream, box(0.05, 2.0, 0.58, cx - 0.88, 1.02, cz - 0.62, 0.9), box(0.05, 2.0, 0.58, cx + 0.88, 1.02, cz - 0.62, -0.9));
    d.add(m.paper, box(0.4, 0.26, 0.2, cx - 0.15, 1.15, cz + 0.1));
    d.add(m.redValve, box(0.12, 0.04, 0.01, cx - 0.15, 1.15, cz - 0.0), box(0.04, 0.12, 0.01, cx - 0.15, 1.15, cz - 0.0));
    d.add(m.dark, box(0.42, 0.3, 0.18, cx + 0.1, 0.52, cz + 0.12));
    d.add(m.terra, box(0.2, 0.06, 0.01, cx + 0.1, 0.62, cz + 0.02));
    this.col(cx, 1.05, cz + 0.05, 0.62, 1.05, 0.45);
    this.points.powerBox = this.w(cx + 0.1, 0.6, cz - 0.4);
  }

  /** A potted plant (they have water up here). */
  private plant(d: MeshBatch, m: ReturnType<SpireBuilder['mats']>, p: THREE.Vector3, s: number) {
    d.add(m.terra, cyl(0.24 * s, 0.18 * s, 0.42 * s, p.x, p.y + 0.21 * s, p.z, 12));
    d.add(m.soil, cyl(0.22 * s, 0.22 * s, 0.02, p.x, p.y + 0.4 * s, p.z, 12));
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + p.x, r = 0.12 * s;
      d.add(m.green, place(new THREE.IcosahedronGeometry(0.22 * s, 0), p.x + Math.cos(a) * r, p.y + (0.62 + (i % 3) * 0.16) * s, p.z + Math.sin(a) * r, a, a * 0.7, 0, 1, 1.3, 1));
    }
  }

  // ------------------------------------------------------------------ F1: the eval floor
  private buildEvals(d: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const y = SP.F[1], RI = SP.RI;
    // Eval 3: a glass room in the south-west, door gap in its north wall
    const x0 = -3.4, x1 = 0.8, z0 = 1.0, zw = (x: number) => Math.sqrt(RI * RI - x * x) - 0.05;
    const H = SP.F[2] - SP.SLAB - y;
    d.add(m.clear, box(-1.0 - x0, H, 0.03, (x0 - 1.0) / 2, y + H / 2, z0), box(x1 - -0.1, H, 0.03, (x1 - 0.1) / 2, y + H / 2, z0));
    d.add(m.clear, box(0.03, H, zw(x1) - z0, x1, y + H / 2, (z0 + zw(x1)) / 2), box(0.03, H, zw(x0) - z0, x0, y + H / 2, (z0 + zw(x0)) / 2));
    for (const x of [x0, -1.0, -0.1, x1]) d.add(m.brushed, box(0.05, H, 0.05, x, y + H / 2, z0));
    d.add(m.brushed, box(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, y + 2.3, z0));
    d.add(m.clear, box(0.9, H - 2.3, 0.03, -0.55, y + 2.3 + (H - 2.3) / 2, z0));
    this.col((x0 - 1.0) / 2, y + 1.2, z0, (-1.0 - x0) / 2, 1.2, 0.04);
    this.col((x1 - 0.1) / 2, y + 1.2, z0, (x1 + 0.1) / 2, 1.2, 0.04);
    this.col(x1, y + 1.2, (z0 + zw(x1)) / 2, 0.04, 1.2, (zw(x1) - z0) / 2);
    this.col(x0, y + 1.2, (z0 + zw(x0)) / 2, 0.04, 1.2, (zw(x0) - z0) / 2);
    d.add(m.print, spirePrint('eval3', 0.9, 0.3, M(-2.2, y + 1.6, z0 - 0.02, Math.PI)));
    // Noor's desk against the south wall, two monitors, a laptop, a cold mug, a hoodie on the floor
    const dz = 4.75;
    d.add(m.cream, box(1.7, 0.05, 0.75, -1.2, y + 0.74, dz), box(0.05, 0.72, 0.7, -2.0, y + 0.36, dz), box(0.05, 0.72, 0.7, -0.4, y + 0.36, dz));
    this.col(-1.2, y + 0.4, dz, 0.85, 0.4, 0.38);
    const scr = this.pal.slot('#cfe4ff', 1.4);
    this.slots.screens = scr.intensity;
    for (const [sx, ry] of [[-1.55, 0.18], [-0.85, -0.18]] as [number, number][]) {
      d.add(m.black, box(0.56, 0.36, 0.03, sx, y + 1.08, dz + 0.22, ry + Math.PI), box(0.05, 0.2, 0.05, sx, y + 0.86, dz + 0.24));
      scr.add(d, box(0.52, 0.32, 0.005, sx, y + 1.08, dz + 0.2, ry + Math.PI));
    }
    d.add(m.dark, box(0.34, 0.02, 0.24, -1.2, y + 0.775, dz - 0.12));
    d.add(m.paper, cyl(0.04, 0.035, 0.09, -0.6, y + 0.81, dz - 0.15, 8));
    d.add(m.sofa, box(0.5, 0.06, 0.4, -2.6, y + 0.03, 3.4, 0.6));
    // her chair (she sits on it with her head on the desk)
    this.noorSeat = { pos: this.w(-1.2, y, dz - 0.62), yaw: 0 };
    d.add(m.chair, box(0.5, 0.08, 0.48, -1.2, y + 0.48, dz - 0.66), box(0.48, 0.55, 0.06, -1.2, y + 0.8, dz - 0.92), cyl(0.03, 0.03, 0.44, -1.2, y + 0.24, dz - 0.66, 6));
    this.points.noor = this.w(-0.55, y + 1.2, z0 - 0.6);
    this.points.noorDesk = this.w(-1.2, y + 1.2, dz - 1.4);
    // the red team's wall of notes, north-west, and two empty desks under it
    const t = THREE.MathUtils.degToRad(240), wp = P(RI - 0.03, t);
    d.add(m.oak, box(2.2, 1.2, 0.04, P(RI - 0.06, t).x, y + 1.6, P(RI - 0.06, t).z, t));
    d.add(m.print, spirePrint('notes', 2.0, 1.0, M(wp.x - Math.sin(t) * 0.06, y + 1.6, wp.z - Math.cos(t) * 0.06, t + Math.PI)));
    for (const dt of [-0.35, 0.35]) {
      const p = P(RI - 1.0, t + dt);
      d.add(m.cream, box(1.3, 0.05, 0.65, p.x, y + 0.74, p.z, t + dt), box(1.2, 0.7, 0.04, P(RI - 0.72, t + dt).x, y + 0.36, P(RI - 0.72, t + dt).z, t + dt));
      d.add(m.black, box(0.5, 0.32, 0.03, P(RI - 0.82, t + dt).x, y + 1.0, P(RI - 0.82, t + dt).z, t + dt));
      this.col(p.x, y + 0.4, p.z, 0.65, 0.4, 0.33, t + dt);
    }
    this.plant(d, m, P(RI - 0.5, THREE.MathUtils.degToRad(195), y), 1.1);
    // Sentinel 3 hangs from the ceiling over the floor's north half, watching both stair heads
    this.sentinelSpots.push({ id: 's3', pos: this.w(0.4, SP.F[2] - SP.SLAB - 0.02, -1.4), yaw: Math.atan2(1.9, -1.8), ceiling: true });
  }

  // ------------------------------------------------------------------ F2: the office and the plant
  private buildTop(b: MeshBatch, d: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const y = SP.F[2], RI = SP.RI;
    // Prudence's desk, square to the windows, everything on it in order
    const dx = -2.6, dz = 1.6;
    d.add(m.oak, box(1.8, 0.05, 0.85, dx, y + 0.75, dz, Math.PI / 2));
    d.add(m.brushed, box(0.04, 0.73, 0.04, dx - 0.38, y + 0.37, dz - 0.85), box(0.04, 0.73, 0.04, dx + 0.38, y + 0.37, dz - 0.85), box(0.04, 0.73, 0.04, dx - 0.38, y + 0.37, dz + 0.85), box(0.04, 0.73, 0.04, dx + 0.38, y + 0.37, dz + 0.85));
    this.col(dx, y + 0.4, dz, 0.45, 0.4, 0.92);
    d.add(m.print, spirePrint('forecast', 0.42, 0.32, M(dx, y + 0.78, dz - 0.3, Math.PI / 2, -Math.PI / 2)));
    for (let i = 0; i < 3; i++) d.add(m.paper, box(0.22, 0.012, 0.3, dx + 0.1, y + 0.785 + i * 0.012, dz + 0.4));
    d.add(m.paper, cyl(0.04, 0.035, 0.09, dx - 0.2, y + 0.82, dz + 0.65, 8));
    // the pause button: red, under a hinged clear cover
    d.add(m.dark, box(0.18, 0.04, 0.18, dx + 0.15, y + 0.79, dz - 0.6));
    d.add(m.redValve, cyl(0.05, 0.05, 0.04, dx + 0.15, y + 0.82, dz - 0.6, 12));
    d.add(m.clear, box(0.16, 0.06, 0.16, dx + 0.15, y + 0.85, dz - 0.6));
    d.add(m.chair, box(0.5, 0.08, 0.48, dx + 0.7, y + 0.48, dz), box(0.06, 0.55, 0.48, dx + 0.96, y + 0.8, dz), cyl(0.03, 0.03, 0.44, dx + 0.7, y + 0.24, dz, 6));
    this.prudenceSpot = { pos: this.w(-4.3, y, -0.9), yaw: -Math.PI / 2 - 0.35 };
    this.points.prudence = this.w(-3.6, y + 1.2, -0.7);
    this.col(-4.3, y + 0.9, -0.9, 0.28, 0.9, 0.28);
    // bookshelves on the south wall
    for (const t of [THREE.MathUtils.degToRad(10), THREE.MathUtils.degToRad(-10)]) {
      const p = P(RI - 0.25, t);
      d.add(m.oak, box(1.6, 2.2, 0.4, p.x, y + 1.1, p.z, t));
      for (let i = 0; i < 4; i++) d.add(m.paper, box(1.4, 0.3, 0.3, P(RI - 0.32, t).x, y + 0.35 + i * 0.52, P(RI - 0.32, t).z, t));
      this.col(p.x, y + 1.1, p.z, 0.8, 1.1, 0.22, t);
    }
    this.plant(d, m, P(RI - 0.6, THREE.MathUtils.degToRad(330), y), 1.3);
    this.plant(d, m, P(RI - 0.6, THREE.MathUtils.degToRad(212), y), 1.0);
    // the plant along the north wall: the tank, pipes up to the fins, the core's housing, the valve
    const tx = -0.6, tz = -4.3;
    d.add(m.steel, cyl(1.1, 1.1, 2.7, tx, y + 1.35, tz, 28), cyl(1.12, 1.12, 0.06, tx, y + 2.72, tz, 28));
    d.add(m.brushed, beam(V(tx - 0.5, y + 2.7, tz), V(tx - 0.5, SP.CEIL, tz), 0.07, 8), beam(V(tx + 0.5, y + 2.7, tz - 0.2), V(tx + 0.5, SP.CEIL, tz - 0.2), 0.07, 8));
    d.add(m.brushed, beam(V(tx, y + 0.3, tz + 0.95), V(tx, y + 0.3, tz + 1.3), 0.05, 8), beam(V(tx, y + 0.3, tz + 1.3), V(tx, y, tz + 1.3), 0.05, 8));
    this.col(tx, y + 1.35, tz, 1.1, 1.35, 1.1);
    const gauges = this.pal.slot('#9ff2ff', 0.5);
    this.slots.gauges = gauges.intensity;
    for (const gy of [1.3, 1.7]) {
      d.add(m.black, cyl(0.1, 0.1, 0.03, tx + 0.35, y + gy, tz + 1.08, 12, Math.PI / 2));
      gauges.add(d, cyl(0.08, 0.08, 0.005, tx + 0.35, y + gy, tz + 1.1, 12, Math.PI / 2));
    }
    d.add(m.print, spirePrint('plantSign', 1.1, 0.34, M(tx, y + 2.2, tz + 1.13)));
    d.add(m.brushed, cyl(0.04, 0.04, 0.12, tx - 0.3, y + 0.95, tz + 1.12, 8, Math.PI / 2));
    this.lootSpots.push({ id: 'tank', pos: this.w(tx - 0.3, y + 0.9, tz + 1.6), mesh: new THREE.Group() });
    // the core housing (west of the tank): a steel cabinet with a frosted window and the cartridge
    // glowing cyan inside (the runtime hides it once pulled)
    const hx = -2.55, hz = -4.1, ht = Math.atan2(-hx, -hz);
    d.add(m.brushed, box(0.95, 1.5, 0.8, hx, y + 0.75, hz, ht));
    d.add(m.print, spirePrint('coreLabel', 0.5, 0.17, M(hx + Math.sin(ht) * 0.41, y + 1.38, hz + Math.cos(ht) * 0.41, ht)));
    this.col(hx, y + 0.75, hz, 0.5, 0.75, 0.42, ht);
    const core = this.pal.slot('#39d8f0', 1.3);
    this.slots.core = core.intensity;
    const cb = new MeshBatch();
    cb.add(m.frost, box(0.62, 0.92, 0.38, 0, 0, 0));
    core.add(cb, box(0.5, 0.82, 0.3, 0, 0, 0));
    cb.add(m.steel, box(0.66, 0.06, 0.42, 0, 0.47, 0), box(0.66, 0.06, 0.42, 0, -0.47, 0));
    const coreMesh = cb.build('spireCore');
    coreMesh.position.set(hx + Math.sin(ht) * 0.25, y + 0.8, hz + Math.cos(ht) * 0.25);
    coreMesh.rotation.y = ht;
    this.core.add(coreMesh);
    this.points.core = this.w(hx + Math.sin(ht) * 1.0, y + 1.1, hz + Math.cos(ht) * 1.0);
    this.halos.add(this.w(hx + Math.sin(ht) * 0.5, y + 0.8, hz + Math.cos(ht) * 0.5), '#7ff0ff', 1.6, SpireBuilder.CH.PLANT, 0.8);
    // the distribution valve east of the tank: a red wheel on a riser that goes down through the floor
    const vx = 0.95, vz = -4.4;
    d.add(m.brushed, beam(V(tx + 1.0, y + 1.0, tz), V(vx, y + 1.0, vz), 0.06, 8), beam(V(vx, y + 1.0, vz), V(vx, y - 0.2, vz), 0.06, 8));
    this.valve.position.copy(V(vx, y + 1.05, vz + 0.12));
    const vb = new MeshBatch();
    vb.add(m.redValve, place(new THREE.TorusGeometry(0.2, 0.025, 6, 20)));
    for (let i = 0; i < 3; i++) vb.add(m.redValve, box(0.38, 0.025, 0.025, 0, 0, 0, 0, 0, (i * Math.PI) / 3));
    this.valve.add(vb.build('spireValve'));
    d.add(m.print, spirePrint('valveTag', 0.14, 0.19, M(vx + 0.24, y + 0.88, vz + 0.14, 0, 0, 0.12)));
    this.points.valve = this.w(vx, y + 1.1, vz + 0.8);
    // Benny stands between the tank and the valve, at his gauges
    this.bennySpot = { pos: this.w(0.45, y, -2.75), yaw: Math.PI - 0.25 };
    this.points.benny = this.w(0.45, y + 1.2, -2.2);
    this.col(0.45, y + 0.9, -2.75, 0.26, 0.9, 0.26);
    // the supply cabinet (south-west) and Benny's bench (east)
    const cp = P(RI - 0.4, THREE.MathUtils.degToRad(25)), ct = THREE.MathUtils.degToRad(25) + Math.PI;
    d.add(m.steel, box(1.0, 1.9, 0.5, cp.x, y + 0.95, cp.z, ct));
    d.add(m.terra, box(0.9, 0.05, 0.01, cp.x + Math.sin(ct) * 0.26, y + 1.7, cp.z + Math.cos(ct) * 0.26, ct));
    this.col(cp.x, y + 0.95, cp.z, 0.5, 0.95, 0.26, ct);
    this.lootSpots.push({ id: 'cabinet', pos: this.w(cp.x + Math.sin(ct) * 0.8, y + 1.0, cp.z + Math.cos(ct) * 0.8), mesh: new THREE.Group() });
    const bp = P(RI - 0.45, THREE.MathUtils.degToRad(100)), bt = THREE.MathUtils.degToRad(100) + Math.PI;
    d.add(m.oak, box(1.5, 0.06, 0.7, bp.x, y + 0.9, bp.z, bt));
    d.add(m.dark, box(1.4, 0.85, 0.05, P(RI - 0.12, THREE.MathUtils.degToRad(100)).x, y + 0.45, P(RI - 0.12, THREE.MathUtils.degToRad(100)).z, bt));
    d.add(m.steel, box(0.3, 0.12, 0.2, bp.x, y + 0.99, bp.z + 0.3, bt), cyl(0.05, 0.05, 0.25, bp.x - 0.2, y + 1.05, bp.z - 0.3, 8));
    this.col(bp.x, y + 0.45, bp.z, 0.75, 0.45, 0.36, bt);
    this.lootSpots.push({ id: 'bench', pos: this.w(bp.x + Math.sin(bt) * 0.8, y + 1.0, bp.z + Math.cos(bt) * 0.8), mesh: new THREE.Group() });
  }

  // ------------------------------------------------------------------ the forecourt
  private buildForecourt(b: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    // paving round the drum and out to the road's head
    b.add(m.pad, place(new THREE.RingGeometry(SP.R, 15, 64, 1), 0, 0.03, 0, -Math.PI / 2));
    b.add(m.pad, place(new THREE.PlaneGeometry(7, 8), -7.5, 0.035, -15.5, -Math.PI / 2, 0, -0.5));
    for (let r = SP.R + 2.2; r < 15; r += 2.2) b.add(m.joint, place(new THREE.RingGeometry(r - 0.03, r + 0.03, 72, 1), 0, 0.036, 0, -Math.PI / 2));
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2, a = P(SP.R + 0.1, t, 0.037), c = P(15, t, 0.037);
      b.add(m.joint, place(new THREE.PlaneGeometry(0.06, a.distanceTo(c)), (a.x + c.x) / 2, 0.037, (a.z + c.z) / 2, -Math.PI / 2, 0, t));
    }
    // planters either side of the canopy, with living green in them
    for (const s of [-1, 1]) {
      const x = s * 5.6, z = SP.PORT_Z - 1.4;
      b.add(m.white, box(1.6, 0.7, 1.6, x, 0.35, z));
      b.add(m.soil, box(1.4, 0.02, 1.4, x, 0.7, z));
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + s;
        b.add(m.green, place(new THREE.IcosahedronGeometry(0.32, 0), x + Math.cos(a) * 0.4, 0.95 + (i % 3) * 0.12, z + Math.sin(a) * 0.4, a, a, 0, 1, 1.2, 1));
      }
      this.col(x, 0.35, z, 0.8, 0.35, 0.8);
    }
    // a bench facing the valley, bollards at the road's head
    b.add(m.oak, box(2.0, 0.08, 0.5, -10.5, 0.45, 3.5, Math.PI / 2 + 0.3), box(0.4, 0.42, 0.4, -10.45, 0.21, 2.6), box(0.4, 0.42, 0.4, -10.75, 0.21, 4.4));
    this.col(-10.6, 0.3, 3.5, 0.3, 0.3, 1.0, 0.3);
    for (let i = 0; i < 5; i++) {
      const x = -11 + i * 1.6, z = -14.5 - i * 0.4;
      b.add(m.white, cyl(0.14, 0.16, 0.9, x, 0.45, z, 10));
      b.add(m.terra, cyl(0.15, 0.15, 0.08, x, 0.75, z, 10));
    }
    // Sentinel 2 on its plinth at the forecourt's north-west corner, looking down the road's head and at the door
    b.add(m.white, cyl(0.55, 0.65, 1.0, -8.2, 0.5, -10.2, 16));
    b.add(m.terra, cyl(0.57, 0.57, 0.08, -8.2, 0.95, -10.2, 16));
    this.physics.addCylinder(this.w(-8.2, 0.5, -10.2), 0.5, 0.6);
    this.sentinelSpots.push({ id: 's2', pos: this.w(-8.2, 1.0, -10.2), yaw: Math.atan2(-2.5, -6.5), ceiling: false });
    // the pipe Benny laid: out of the plinth on the west side and off down the hill toward the creek
    const pts: THREE.Vector3[] = [V(-SP.R - 0.1, 0.25, 1.2)];
    for (const [x, z] of [[-14, 3], [-24, 6], [-36, 9], [-50, 13], [-66, 17]] as [number, number][]) {
      const g = this.local(this.origin.x + x, this.origin.z + z);
      pts.push(V(x, g.y + 0.22, z));
    }
    for (let i = 0; i < pts.length - 1; i++) {
      b.add(m.brushed, beam(pts[i], pts[i + 1], 0.09, 10));
      for (let k = 1; k <= 3; k++) {
        const p = pts[i].clone().lerp(pts[i + 1], k / 4);
        b.add(m.post, box(0.08, 0.3, 0.3, p.x, p.y - 0.12, p.z));
      }
    }
    this.points.outside = this.w(-6, 0, -17);
  }

  // ------------------------------------------------------------------ the access road
  private buildRoad(b: MeshBatch, m: ReturnType<SpireBuilder['mats']>) {
    const ramp = SPIRE_RAMP;
    // arc-length sampling of the ramp's centreline (world XZ)
    const lens: number[] = [0];
    for (let i = 1; i < ramp.length; i++) lens.push(lens[i - 1] + Math.hypot(ramp[i][0] - ramp[i - 1][0], ramp[i][1] - ramp[i - 1][1]));
    const total = lens[lens.length - 1];
    const at = (u: number) => {
      const s = u * total;
      let i = 1;
      while (i < lens.length - 1 && lens[i] < s) i++;
      const k = (s - lens[i - 1]) / (lens[i] - lens[i - 1]);
      const x = ramp[i - 1][0] + (ramp[i][0] - ramp[i - 1][0]) * k, z = ramp[i - 1][1] + (ramp[i][1] - ramp[i - 1][1]) * k;
      const dx = ramp[i][0] - ramp[i - 1][0], dz = ramp[i][1] - ramp[i - 1][1], l = Math.hypot(dx, dz);
      return { x, z, tx: dx / l, tz: dz / l, nx: dz / l, nz: -dx / l };
    };
    const side = (u: number, off: number, lift = 0) => {
      const c = at(u);
      const p = this.local(c.x + c.nx * off, c.z + c.nz * off);
      p.y += lift;
      return p;
    };
    // guardrails both sides: posts every ~2.6 m and a W-beam rail between their tops (the west side
    // is the drop; the east side runs along the cut)
    const n = Math.round(total / 2.6);
    for (const off of [-4.2, 4.2]) {
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= n; i++) {
        const u = i / n, p = side(u, off);
        b.add(m.post, box(0.12, 0.85, 0.12, p.x, p.y + 0.4, p.z));
        const top = p.clone().setY(p.y + 0.68);
        if (prev && !(off > 0 && Math.abs((i - 0.5) / n - 0.5) < 0.06)) b.add(m.rail, bar(prev, top, 0.05, 0.3));
        prev = top;
        if (i % 6 === 3) {
          const c = at(u), yaw = Math.atan2(c.tx, c.tz) + (off < 0 ? -Math.PI / 2 : Math.PI / 2);
          b.add(m.print, spirePrint('monitored', 0.5, 0.19, M(p.x - Math.sign(off) * c.nx * 0.08, p.y + 0.68, p.z - Math.sign(off) * c.nz * 0.08, yaw + Math.PI)));
        }
      }
      // (the rails stop you dropping off the west side; the east side is the cut bank anyway)
      for (let i = 0; i < n; i++) {
        // (a gap in the east rail beside Sentinel 1, so you can get round behind it)
        if (off > 0 && Math.abs((i + 0.5) / n - 0.5) < 0.06) continue;
        const a = side(i / n, off), c = side((i + 1) / n, off), mid = a.clone().add(c).multiplyScalar(0.5);
        const len = a.distanceTo(c);
        this.col(mid.x, mid.y + 0.5, mid.z, 0.06, 0.5, len / 2, Math.atan2(c.x - a.x, c.z - a.z));
      }
    }
    // four infrared beams across the road at ankle height, from emitters on the guardrail posts
    const ir = this.pal.slot('#ff3020', 2.6);
    this.slots.ir = ir.intensity;
    [0.17, 0.41, 0.64, 0.86].forEach((u, i) => {
      const a = side(u, -4.05, 0.13), c = side(u, 4.05, 0.13);
      b.add(m.black, box(0.1, 0.14, 0.1, a.x, a.y, a.z), box(0.1, 0.14, 0.1, c.x, c.y, c.z));
      ir.add(b, box(0.03, 0.03, 0.02, a.x, a.y + 0.05, a.z), box(0.03, 0.03, 0.02, c.x, c.y + 0.05, c.z));
      const beamSlot = this.pal.slot('#ff2a22', 3.5);
      const mesh = this.palMesh(beamSlot, bar(a, c, 0.008, 0.008));
      this.group.add(mesh);
      this.tripwires.push({ id: `beam${i + 1}`, a: a.clone().add(this.origin), b: c.clone().add(this.origin), mesh, armed: true });
    });
    // Sentinel 1 halfway up, on a plinth in the cut on the east side, looking down the road
    const s1 = side(0.5, 6.0);
    const c1 = at(0.5);
    b.add(m.white, cyl(0.55, 0.65, 1.0, s1.x, s1.y + 0.5, s1.z, 16));
    b.add(m.terra, cyl(0.57, 0.57, 0.08, s1.x, s1.y + 0.95, s1.z, 16));
    this.physics.addCylinder(this.w(s1.x, s1.y + 0.5, s1.z), 0.5, 0.6);
    this.sentinelSpots.push({ id: 's1', pos: this.w(s1.x, s1.y + 1.0, s1.z), yaw: Math.atan2(-c1.tx, -c1.tz) - 0.35, ceiling: false });
    // Isaac Fenn: under a foil blanket against the west guardrail, a third of the way up
    const f = side(0.3, -3.3), fc = at(0.3), fy = Math.atan2(fc.tx, fc.tz);
    b.add(m.foil, place(new THREE.SphereGeometry(0.6, 10, 6), f.x, f.y + 0.12, f.z, 0, fy, 0, 1.6, 0.32, 0.75));
    for (const s of [-1, 1]) b.add(m.boot, box(0.12, 0.14, 0.3, f.x + fc.tx * 1.0 + fc.nx * s * 0.14, f.y + 0.07, f.z + fc.tz * 1.0 + fc.nz * s * 0.14, fy));
    for (let i = 0; i < 4; i++) b.add(m.rock, place(rockGeometry(i * 7 + 3, 0), f.x + fc.tx * (i - 1.5) * 0.6 + fc.nx * 0.55, f.y + 0.08, f.z + fc.tz * (i - 1.5) * 0.6 + fc.nz * 0.55, 0, i, 0, 0.18));
    b.add(m.paper, box(0.24, 0.02, 0.32, f.x - fc.tx * 0.4, f.y + 0.32, f.z - fc.tz * 0.4, fy));
    b.add(m.print, spirePrint('fennLog', 0.2, 0.25, M(f.x - fc.tx * 0.4, f.y + 0.335, f.z - fc.tz * 0.4, fy, -Math.PI / 2)));
    this.points.fenn = this.w(f.x + fc.nx * 0.8, f.y + 0.6, f.z + fc.nz * 0.8);
    // the foot of the road: Careful's sign, the gradient plate, and a standpipe that was never connected
    const foot = side(0, 6.4), c0 = at(0), yaw0 = Math.atan2(-c0.tx, -c0.tz);
    b.add(m.post, box(0.1, 2.4, 0.1, foot.x - c0.nx * 0.9, foot.y + 1.2, foot.z - c0.nz * 0.9), box(0.1, 2.4, 0.1, foot.x + c0.nx * 0.9, foot.y + 1.2, foot.z + c0.nz * 0.9));
    b.add(m.print, spirePrint('roadSign', 2.2, 1.375, M(foot.x - c0.tx * 0.07, foot.y + 1.75, foot.z - c0.tz * 0.07, yaw0)));
    const gp = side(0.06, -5.2);
    b.add(m.post, box(0.08, 1.8, 0.08, gp.x, gp.y + 0.9, gp.z));
    b.add(m.print, spirePrint('grade', 0.55, 0.55, M(gp.x, gp.y + 1.6, gp.z - 0.05, yaw0)));
    const sp = side(-0.02, -7.5);
    b.add(m.brushed, cyl(0.07, 0.07, 1.1, sp.x, sp.y + 0.55, sp.z, 10), beam(V(sp.x, sp.y + 1.0, sp.z), V(sp.x + 0.25, sp.y + 1.0, sp.z), 0.035, 8));
    b.add(m.brushed, cyl(0.035, 0.035, 0.12, sp.x + 0.27, sp.y + 0.94, sp.z, 8));
    b.add(m.post, box(0.06, 1.2, 0.06, sp.x - 0.3, sp.y + 0.6, sp.z));
    b.add(m.print, spirePrint('standpipe', 0.42, 0.32, M(sp.x - 0.3, sp.y + 1.25, sp.z - 0.04, yaw0)));
    this.points.road = this.w(...(side(-0.15, 0).toArray() as [number, number, number]));
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
      lobby: [L('#ffe7c4', 9, -0.6, 3.5, -0.5, 2.4), L('#ffe7c4', 7, 3.2, 3.6, 2.5, 2)],
      evals: L('#f2efe8', 9, -0.6, SP.F[1] + 3.5, 0.6, 2.4),
      top: L('#ffe0b4', 9, -1.8, SP.CEIL - 0.6, 0.4, 2.6),
      plant: L('#a8ecff', 4.5, -1.2, SP.F[2] + 1.6, -3.4, 1.6),
      canopy: L('#ffd9a8', 9, 0, 3.6, SP.PORT_Z - 1.4, 1.4),
      pad: L('#eaf0ff', 16, -7, 7, -14, 1),
    };
  }
}
