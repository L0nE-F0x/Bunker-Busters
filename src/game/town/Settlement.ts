import * as THREE from 'three/webgpu';
import type { Heightfield } from '@/game/world/Heightfield';
import type { Physics } from '@/engine/physics';
import type { Landmarks } from '@/game/world/Landmarks';
import type { GameContext, Interactable, Action } from '@/game/context';
import { LANDMARKS, CAVE_TRAIL } from '@/content/world';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { box, cyl, MeshBatch, DistanceLod, canvasTexture, grime, wire, norm } from '@/game/world/kit';
import { rustyMetal, concrete, corrugated, neon, plainStandard, fabric, wood, glow, warmWindow, leather } from '@/game/world/materials';
import { Fire } from '@/game/world/effects';
import { VirtualLight } from '@/game/world/lights';
import { rockMaterial } from '@/game/world/Props';

type Col = ReturnType<Physics['addBox']>;

interface Swing {
  id: string;
  pivot: THREE.Group;
  collider: Col;
  /** Signed radians, inward. */
  sign: number;
  open: number;
  target: number;
  /** Collider state last sent to Rapier (toggling it every frame dirties the broadphase). */
  solid: boolean;
}

/** Local→world. Same composition Landmarks uses, so mesh and collider share one frame. */
class Frame {
  readonly m: THREE.Matrix4;
  constructor(public x: number, public y: number, public z: number, public yaw: number) {
    this.m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(1, 1, 1),
    );
  }
  p(lx: number, ly: number, lz: number) {
    return new THREE.Vector3(lx, ly, lz).applyMatrix4(this.m);
  }
}

/**
 * Dry Creek and the ridge cave.
 *
 * Built with the gas-station kit (memoized materials, MeshBatch, canvas signs, neon).
 * Rooms are wall slabs, not solid boxes, so you can stand inside them.
 * Door gaps are 1.5–1.6 m. The player capsule is 0.66 m wide and 1.66 m tall;
 * openings are 2.15 m high. Stair risers are 0.26 m, under the 0.45 m autostep.
 * The loft cache sits high enough that the ground floor cannot reach the prompt.
 */
export class Settlement {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Feet positions a harness can teleport to. */
  readonly spots: Record<string, THREE.Vector3> = {};
  /** Landmark yaw. Camera yaw `-look.creek` faces local −Z. */
  readonly look: Record<string, number> = {};

  private doors: Swing[] = [];
  private blockers: { id: string; obj: THREE.Object3D; collider: Col }[] = [];
  private clinicGlow: { value: number } | null = null;
  private synced = false;
  /** Detail up close, a one-draw silhouette from the highway. */
  private lods: DistanceLod[] = [];
  private readonly world = new Map<string, THREE.Vector3>();

  constructor(private ctx: GameContext, private landmarks: Landmarks) {
    this.group.name = 'settlement';
    this.buildCreek();
    this.buildCave();
    this.buildTrail();
    this.buildInteractables();
    this.landmarks.group.add(this.group);
  }

  private get hf(): Heightfield { return this.ctx.hf; }
  private get physics(): Physics { return this.ctx.physics; }
  private get s() { return this.ctx.state; }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  private social() {
    const s = this.s;
    return s.skill('social') + (s.focus('social') === 'known' ? 1 : 0);
  }

  private frameFor(id: string) {
    const lm = LANDMARKS.find((l) => l.id === id);
    if (!lm) throw new Error(`missing landmark ${id}`);
    const [x, , z] = lm.position;
    this.look[id === 'creek' ? 'creek' : 'cave'] = lm.rotation;
    return new Frame(x, this.hf.heightAt(x, z), z, lm.rotation);
  }

  private boxCol(f: Frame, x: number, y: number, z: number, hx: number, hy: number, hz: number) {
    const p = f.p(x, y, z);
    return this.physics.addBox(p, { x: hx, y: hy, z: hz }, f.yaw);
  }

  private spot(id: string, f: Frame, x: number, y: number, z: number) {
    const p = f.p(x, y, z);
    this.world.set(id, p);
    this.spots[id] = p;
    return p;
  }

  private pos(id: string) {
    const p = this.world.get(id);
    if (!p) throw new Error(`missing spot ${id}`);
    return p;
  }

  private wallX(b: MeshBatch, mat: THREE.Material, f: Frame, x0: number, x1: number, z: number, y0: number, y1: number, thick: number) {
    if (x1 - x0 < 0.04 || y1 - y0 < 0.04) return;
    const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
    b.add(mat, box(x1 - x0, y1 - y0, thick, xc, yc, z));
    this.boxCol(f, xc, yc, z, (x1 - x0) / 2, (y1 - y0) / 2, thick / 2);
  }

  private wallZ(b: MeshBatch, mat: THREE.Material, f: Frame, x: number, z0: number, z1: number, y0: number, y1: number, thick: number) {
    if (z1 - z0 < 0.04 || y1 - y0 < 0.04) return;
    const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
    b.add(mat, box(thick, y1 - y0, z1 - z0, x, yc, zc));
    this.boxCol(f, x, yc, zc, thick / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  }

  /** Wall along X with a door gap. Side piers are full height. The lintel starts at doorH. */
  private gapX(b: MeshBatch, mat: THREE.Material, f: Frame, x0: number, x1: number, z: number, thick: number, g0: number, g1: number, doorH: number, wallH: number) {
    this.wallX(b, mat, f, x0, g0, z, 0, wallH, thick);
    this.wallX(b, mat, f, g1, x1, z, 0, wallH, thick);
    this.wallX(b, mat, f, g0, g1, z, doorH, wallH, thick);
  }

  private gapZ(b: MeshBatch, mat: THREE.Material, f: Frame, x: number, z0: number, z1: number, thick: number, g0: number, g1: number, doorH: number, wallH: number) {
    this.wallZ(b, mat, f, x, z0, g0, 0, wallH, thick);
    this.wallZ(b, mat, f, x, g1, z1, 0, wallH, thick);
    this.wallZ(b, mat, f, x, g0, g1, doorH, wallH, thick);
  }

  private slab(b: MeshBatch, mat: THREE.Material, f: Frame, x0: number, x1: number, z0: number, z1: number, top: number, thick = 0.16) {
    const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, yc = top - thick / 2;
    b.add(mat, box(x1 - x0, thick, z1 - z0, xc, yc, zc));
    this.boxCol(f, xc, yc, zc, (x1 - x0) / 2, thick / 2, (z1 - z0) / 2);
  }

  /** Hinge at the west edge of the gap. `sign` < 0 swings the slab toward −Z. */
  private swing(root: THREE.Group, f: Frame, id: string, g0: number, g1: number, z: number, doorH: number, sign: number, mat: THREE.Material) {
    const width = g1 - g0;
    const pivot = new THREE.Group();
    pivot.position.set(g0, 0, z);
    const door = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, doorH - 0.06, 0.07), mat);
    door.position.set(width / 2, doorH / 2, 0);
    door.castShadow = true;
    door.receiveShadow = true;
    pivot.add(door);
    root.add(pivot);
    const collider = this.boxCol(f, (g0 + g1) / 2, doorH / 2, z, width / 2, doorH / 2, 0.06);
    this.doors.push({ id, pivot, collider, sign, open: 0, target: 0, solid: true });
  }

  private person(b: MeshBatch, f: Frame, x: number, z: number, yaw: number, coat: string, scarf: string) {
    const c = fabric(coat);
    const pants = fabric('#3a342c');
    const skin = leather('#8a6450');
    const boot = leather('#2a1f18');
    const sc = fabric(scarf);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // Pieces overlap. A gap between the legs and the coat reads as a floating torso.
    b.add(boot, box(0.16, 0.14, 0.28, x - 0.1, 0.07, z, yaw), box(0.16, 0.14, 0.28, x + 0.1, 0.07, z, yaw));
    b.add(pants, box(0.17, 0.78, 0.18, x - 0.1, 0.46, z, yaw), box(0.17, 0.78, 0.18, x + 0.1, 0.46, z, yaw));
    b.add(c, box(0.48, 0.66, 0.26, x, 1.12, z, yaw));
    b.add(c, box(0.13, 0.52, 0.14, x - 0.3, 0.98, z, yaw), box(0.13, 0.52, 0.14, x + 0.3, 0.98, z, yaw));
    b.add(skin, box(0.1, 0.42, 0.1, x - 0.3, 0.62, z, yaw), box(0.1, 0.42, 0.1, x + 0.3, 0.62, z, yaw));
    b.add(sc, box(0.24, 0.1, 0.22, x, 1.42, z, yaw));
    b.add(skin, box(0.2, 0.24, 0.2, x, 1.58, z, yaw));
    b.add(c, box(0.3, 0.07, 0.3, x + fx * 0.02, 1.72, z + fz * 0.02, yaw));
    b.add(c, box(0.16, 0.1, 0.16, x + fx * 0.02, 1.78, z + fz * 0.02, yaw));
    this.boxCol(f, x, 0.9, z, 0.32, 0.9, 0.26);
  }

  /**
   * Everything under `root` except `keep` becomes the near set; `far` is the batch's stand-in.
   * Fires stay out of it (they thin themselves by distance) so the glow still reads from the road.
   */
  private split(root: THREE.Group, f: Frame, radius: number, far: THREE.Group, keep: THREE.Object3D[]) {
    const near = new THREE.Group();
    near.name = root.name + '-near';
    for (const c of [...root.children]) if (!keep.includes(c)) near.add(c);
    root.add(near, far);
    this.lods.push(new DistanceLod(new THREE.Vector3(f.x, f.y, f.z), radius, near, far));
  }

  // ------------------------------------------------------------------ Dry Creek
  private buildCreek() {
    const f = this.frameFor('creek');
    const root = new THREE.Group();
    root.name = 'dry-creek';
    root.applyMatrix4(f.m);
    const b = new MeshBatch();
    const stucco = concrete('#c4b8a4');
    const stuccoDark = concrete('#8d8376');
    const red = rustyMetal({ base: '#b8452c', rust: 0.5, metalness: 0.28, roughness: 0.58 });
    const cream = rustyMetal({ base: '#d8d2c4', rust: 0.4, metalness: 0.25, roughness: 0.62 });
    const metal = rustyMetal({ base: '#6d6a66', rust: 0.55 });
    const roofDiner = corrugated('#8d4a3a', 0.62);
    const roofClinic = corrugated('#6e7a6e', 0.75);
    const roofStore = corrugated('#8b8a84', 0.7);
    const roofMotel = corrugated('#5c6e72', 0.8);
    const glass = warmWindow('#ffae5a', 2.1);
    const clinicWin = glow('#d7fff2', 0.35);
    this.clinicGlow = clinicWin.intensity as unknown as { value: number };
    const dark = plainStandard('#121416', 0.15, 0.45);
    const plank = wood('#6b4a2e');
    const plankDark = wood('#3d2a1c');
    const T = 0.28;
    const DOOR = 2.15;

    // street
    b.add(stuccoDark, box(52, 0.1, 11, -2, 0.04, 3.2));
    this.spot('street', f, -2, 0.25, 4.6);
    this.spot('fire', f, -0.4, 0.3, 2.3);

    // ---------- diner (west). Interior is −Z of the south wall.
    {
      const x0 = -23.6, x1 = -12.2, zS = -4.5, zN = -11.6, H = 3.7;
      const g0 = -19.3, g1 = -17.7; // 1.6 m door
      this.gapX(b, stucco, f, x0, x1, zS, T, g0, g1, DOOR, H);
      this.wallX(b, stucco, f, x0, x1, zN, 0, H, T);
      this.wallZ(b, stucco, f, x0, zN, zS, 0, H, T);
      this.wallZ(b, stucco, f, x1, zN, zS, 0, H, T);
      b.add(roofDiner, box(12, 0.18, 7.8, -17.9, H + 0.08, -8.05));
      b.add(red, box(12.2, 0.55, 0.12, -17.9, H - 0.15, zS + 0.2));
      b.add(glass, box(2.2, 1.15, 0.06, -21.4, 1.7, zS + 0.16), box(2.2, 1.15, 0.06, -14.6, 1.7, zS + 0.16));
      b.add(red, box(3.4, 0.08, 1.3, -18.5, 2.45, zS + 0.7)); // awning, above eye line
      // counter, with a west aisle so nobody is walled in
      b.add(cream, box(5.2, 1.05, 0.55, -16.2, 0.55, -8.15));
      this.boxCol(f, -16.2, 0.55, -8.15, 2.6, 0.52, 0.28);
      b.add(plank, box(1.4, 0.75, 0.7, -21.6, 0.4, -6.2), box(0.9, 0.9, 0.9, -14.2, 0.5, -10.2));
      this.boxCol(f, -21.6, 0.4, -6.2, 0.7, 0.38, 0.35);
      b.add(dark, box(1.3, 1.5, 0.7, -20.4, 0.8, -9.7)); // freezer
      this.boxCol(f, -20.4, 0.8, -9.7, 0.65, 0.75, 0.35);
      this.spot('dinerIn', f, -18.2, 0.25, -6.2);
      this.spot('nia', f, -16.4, 1.05, -6.55);
      this.spot('freezer', f, -20.4, 1.05, -8.7);
      this.person(b, f, -16.6, -9.55, 0, '#6b3a34', '#e6d2a2');
    }

    // ---------- clinic
    {
      const x0 = -4.3, x1 = 4.3, zS = -5.3, zN = -11.4, H = 3.35;
      const g0 = -0.8, g1 = 0.8;
      this.gapX(b, concrete('#d5d0c6'), f, x0, x1, zS, T, g0, g1, DOOR, H);
      this.wallX(b, concrete('#d5d0c6'), f, x0, x1, zN, 0, H, T);
      this.wallZ(b, concrete('#d5d0c6'), f, x0, zN, zS, 0, H, T);
      this.wallZ(b, concrete('#d5d0c6'), f, x1, zN, zS, 0, H, T);
      b.add(roofClinic, box(9.2, 0.16, 6.8, 0, H + 0.06, -8.35, 0, 0, 0.04));
      b.add(clinicWin.material, box(1.8, 1.0, 0.06, -2.4, 1.75, zS + 0.16));
      b.add(red, box(0.55, 0.16, 0.08, 2.5, 2.5, zS + 0.18), box(0.16, 0.55, 0.08, 2.5, 2.5, zS + 0.18));
      b.add(plankDark, box(2.0, 0.45, 0.9, -2.2, 0.45, -9.8)); // cot
      b.add(metal, box(1.3, 0.85, 0.75, 5.5, 0.5, -7.4)); // generator, outside
      this.boxCol(f, 5.5, 0.5, -7.4, 0.65, 0.42, 0.38);
      this.spot('clinicIn', f, 0, 0.25, -7.2);
      this.spot('doc', f, -1.5, 1.05, -7.0);
      this.spot('generator', f, 5.5, 1.05, -6.2);
      this.person(b, f, -1.6, -9.2, 0, '#2c4a5c', '#c4552a');
    }

    // ---------- the Till (two storeys, stair in the back room)
    {
      const x0 = 10.6, x1 = 21.2, zS = -4.3, zN = -15.8, H = 6.25;
      const g0 = 15.3, g1 = 16.9; // front door, 1.6 m
      this.gapX(b, stucco, f, x0, x1, zS, T, g0, g1, DOOR, H);
      this.wallX(b, stucco, f, x0, x1, zN, 0, H, T);
      this.wallZ(b, stucco, f, x0, zN, zS, 0, H, T);
      this.wallZ(b, stucco, f, x1, zN, zS, 0, H, T);
      b.add(roofStore, box(11.2, 0.2, 12.1, 15.9, H + 0.08, -10.05));
      b.add(glass, box(2.4, 1.3, 0.06, 13.0, 1.7, zS + 0.16), box(1.6, 1.05, 0.06, 18.8, 4.55, zS + 0.16));
      b.add(glass, box(1.2, 0.8, 0.06, 12.4, 4.5, -10.2));
      // partition under the loft, closet door west of centre. Gap 1.6 m, clear of the stair.
      const pZ = -10.3, cg0 = 13.15, cg1 = 14.75;
      this.gapX(b, stuccoDark, f, x0 + 0.2, x1 - 0.2, pZ, 0.16, cg0, cg1, DOOR, 3.05);
      this.swing(root, f, 'closet', cg0, cg1, pZ, DOOR, -1.25, plank);
      // counter, west aisle leads to the closet
      b.add(cream, box(4.6, 1.05, 0.5, 17.4, 0.55, -7.15));
      this.boxCol(f, 17.4, 0.55, -7.15, 2.3, 0.52, 0.25);
      b.add(plank, box(0.9, 0.7, 0.7, 19.6, 0.4, -8.7));
      // stair: 12 rises of 0.26 (top 3.12), tread 0.34, run 4.08. West of the closet door.
      const sx0 = 11.2, sx1 = 12.65, sz = -15.5, tread = 0.34, riser = 0.26;
      const stepMat = concrete('#9a9186');
      for (let i = 0; i < 12; i++) {
        const top = (i + 1) * riser;
        const zA = sz + i * tread;
        const xc = (sx0 + sx1) / 2, zc = zA + tread / 2;
        b.add(stepMat, box(sx1 - sx0, riser, tread, xc, top - riser / 2, zc));
        this.boxCol(f, xc, top - riser / 2, zc, (sx1 - sx0) / 2, riser / 2, tread / 2);
      }
      // loft. The hole over the stair is the absence of this slab. Tops match the last tread.
      const loft = wood('#7a5a36');
      this.slab(b, loft, f, 10.9, 21.0, -10.05, -4.6, 3.12);
      this.slab(b, loft, f, 12.65, 21.0, -15.6, -10.05, 3.12);
      // rail along the hole, open at the top step so you can step across
      b.add(plankDark, box(0.08, 0.85, 3.2, 12.62, 3.54, -13.9));
      this.boxCol(f, 12.62, 3.54, -13.9, 0.05, 0.42, 1.6);
      b.add(plank, box(0.7, 0.35, 0.5, 18.6, 3.45, -6.4)); // high shelf
      this.spot('storeIn', f, 16.2, 0.25, -6.0);
      this.spot('inez', f, 17.6, 1.05, -6.4);
      this.spot('closet', f, 13.95, 1.05, -9.5);
      this.spot('backroom', f, 14.6, 0.25, -12.6);
      this.spot('loft', f, 17.4, 3.28, -7.4);
      this.spot('loftShelf', f, 18.6, 4.05, -6.4);
      this.person(b, f, 18.2, -8.7, 0, '#3f4a3a', '#7a2f2a');
    }

    // ---------- motel row, doors face the street (−Z side of each room)
    const rooms: { x0: number; x1: number; id: 'a' | 'b' | 'c' }[] = [
      { x0: -10.6, x1: -6.0, id: 'a' },
      { x0: -5.4, x1: -0.8, id: 'b' },
      { x0: -0.2, x1: 4.4, id: 'c' },
    ];
    for (const room of rooms) {
      const zN = 7.15, zS = 12.35, H = 3.15;
      const mid = (room.x0 + room.x1) / 2;
      const g0 = mid - 0.78, g1 = mid + 0.78; // 1.56 m
      this.gapX(b, concrete('#b7c0c2'), f, room.x0, room.x1, zN, T, g0, g1, DOOR, H);
      this.wallX(b, concrete('#b7c0c2'), f, room.x0, room.x1, zS, 0, H, T);
      this.wallZ(b, concrete('#b7c0c2'), f, room.x0, zN, zS, 0, H, T);
      this.wallZ(b, concrete('#b7c0c2'), f, room.x1, zN, zS, 0, H, T);
      b.add(roofMotel, box(room.x1 - room.x0 + 0.5, 0.14, 5.7, mid, H + 0.05, 9.75));
      b.add(dark, box(0.7, 0.9, 0.06, mid + 1.3, 1.6, zN + 0.16));
      b.add(plank, box(1.8, 0.4, 0.85, mid, 0.35, 11.3));
      if (room.id === 'b') this.swing(root, f, 'motelB', g0, g1, zN, DOOR, 1.2, plankDark);
      if (room.id === 'c') {
        const boards = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const plankMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.06), plankDark);
          plankMesh.position.set(mid, 0.45 + i * 0.4, zN);
          plankMesh.rotation.z = (i - 1.5) * 0.05;
          plankMesh.castShadow = true;
          boards.add(plankMesh);
        }
        root.add(boards);
        const collider = this.boxCol(f, mid, DOOR / 2, zN, 0.78, DOOR / 2, 0.08);
        this.blockers.push({ id: 'boards', obj: boards, collider });
      }
    }
    this.spot('motelA', f, -8.3, 0.25, 8.6);
    this.spot('guest', f, -9.4, 1.0, 8.3);
    this.spot('motelB', f, -3.1, 1.05, 6.5);
    this.spot('motelBloot', f, -3.1, 1.0, 11.0);
    this.spot('motelC', f, 2.1, 1.05, 6.5);
    this.spot('motelCloot', f, 2.1, 1.0, 11.0);

    // water tower. Legs are thin; the gap between them is wider than the player.
    {
      const tx = -31, tz = 1.2;
      for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) {
        b.add(metal, box(0.16, 6.4, 0.16, tx + dx, 3.2, tz + dz));
        this.boxCol(f, tx + dx, 3.2, tz + dz, 0.1, 3.2, 0.1);
      }
      b.add(metal, cyl(1.55, 1.55, 2.1, tx, 7.2, tz, 16));
      this.boxCol(f, tx, 7.2, tz, 1.5, 1.05, 1.5);
      b.add(red, box(0.9, 0.7, 0.7, tx, 0.4, tz + 2.15));
      this.spot('tower', f, tx, 1.0, tz + 2.15);
    }

    // a car that stays where it died, off the walking line between diner and motel
    b.add(rustyMetal({ base: '#3d4a55', rust: 0.7, metalness: 0.4 }), box(1.7, 0.7, 4.1, -26.5, 0.55, 5.4), box(1.5, 0.55, 1.8, -26.5, 1.15, 5.0));
    this.boxCol(f, -26.5, 0.7, 5.4, 0.9, 0.7, 2.05);
    b.add(plainStandard('#1a120c', 0.3, 0.6), box(0.55, 0.55, 0.12, -26.5, 0.32, 7.5), box(0.55, 0.55, 0.12, -26.5, 0.32, 3.3));

    // fire, two people, barrels
    const barrel = rustyMetal({ base: '#2f4a5c', rust: 0.6, metalness: 0.45 });
    b.add(barrel, cyl(0.4, 0.4, 1.05, 2.4, 0.6, 1.4, 12), cyl(0.4, 0.4, 1.05, 3.1, 0.6, 1.9, 12));
    this.boxCol(f, 2.4, 0.6, 1.4, 0.4, 0.52, 0.4);
    this.boxCol(f, 3.1, 0.6, 1.9, 0.4, 0.52, 0.4);
    b.add(wood('#4a3424'), cyl(0.16, 0.16, 1.8, -2.3, 0.28, 3.5, 8, 0, 0, Math.PI / 2));
    this.person(b, f, -2.15, 2.55, 0.4, '#4a3b2a', '#c4552a');
    this.person(b, f, 1.55, 3.15, Math.PI, '#2c3338', '#d8d2c4');
    this.spot('sol', f, -2.15, 1.05, 2.55);
    this.spot('ren', f, 1.55, 1.05, 3.15);
    this.spot('forage', f, 8.5, 0.8, 16.2);

    // posts along the back, gaps you can walk
    for (let i = 0; i < 8; i++) {
      const px = -22 + i * 5.2;
      b.add(wood('#3a2a1c'), box(0.14, 1.5, 0.14, px, 0.75, -17.4));
      this.boxCol(f, px, 0.75, -17.4, 0.1, 0.75, 0.1);
    }
    b.add(wood('#3a2a1c'), box(36, 0.08, 0.08, -4, 1.35, -17.4));

    // string lights, diner roof to the Till
    const bulbs = glow('#ffcc88', 4.5);
    const a = new THREE.Vector3(-14, 3.9, -4.2);
    const c = new THREE.Vector3(12, 5.4, -4.2);
    b.add(plainStandard('#15120f', 0.6), wire(a, c, 0.8, 0.012, 24));
    for (let i = 1; i < 14; i++) {
      const t = i / 14;
      const p = a.clone().lerp(c, t);
      p.y -= 0.8 * 4 * t * (1 - t);
      const g = new THREE.SphereGeometry(0.055, 6, 4);
      g.translate(p.x, p.y, p.z);
      b.add(bulbs.material, g);
    }
    this.landmarks.flickers.push({ set: (v) => (bulbs.intensity.value = 4.5 * (0.8 + 0.2 * v)), phase: 1.2, speed: 0.4, broken: 0.08 });

    // diner sign — same canvas language as Last Chance
    const signTex = canvasTexture(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#1a100c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e8d6b0';
      ctx.lineWidth = 14;
      ctx.strokeRect(18, 18, w - 36, h - 36);
      ctx.fillStyle = '#e8d6b0';
      ctx.textAlign = 'center';
      ctx.font = '900 150px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillText('DRY CREEK', w / 2, 200);
      ctx.fillStyle = '#ff9a2e';
      ctx.font = '700 92px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('EATS  ·  OPEN', w / 2, 330);
      ctx.fillStyle = '#c9b48a';
      ctx.font = '500 36px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('THE CREEK IS DRY. THE COFFEE IS NOT.', w / 2, 430);
      grime(ctx, w, h, 1.1, 7);
    });
    const signMat = new THREE.MeshStandardNodeMaterial({ map: signTex, roughness: 0.65, emissiveMap: signTex, emissive: new THREE.Color(0.32, 0.22, 0.14) });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.3, 0.18), signMat);
    sign.position.set(-17.9, 5.15, -4.15);
    sign.castShadow = true;
    root.add(sign);
    const neonFlicker = { value: 1 };
    const neonMat = neon('#ff3a6e', 6, neonFlicker);
    b.add(neonMat,
      cyl(0.035, 0.035, 4.8, -17.9, 6.4, -4.0, 6, 0, 0, Math.PI / 2),
      cyl(0.035, 0.035, 4.8, -17.9, 3.95, -4.0, 6, 0, 0, Math.PI / 2),
    );
    this.landmarks.flickers.push({ set: (v) => (neonFlicker.value = v), phase: 2.2, speed: 1.1, broken: 0.35 });
    this.landmarks.audioSpots.push({ kind: 'neon', pos: f.p(-17.9, 5.2, -4.0) });

    const tillTex = canvasTexture(768, 384, (ctx, w, h) => {
      ctx.fillStyle = '#24180f';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f0e2c4';
      ctx.textAlign = 'center';
      ctx.font = '900 120px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillText('THE TILL', w / 2, 160);
      ctx.fillStyle = '#ffb347';
      ctx.font = '600 48px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('IF IT HAS A PRICE, ASK INEZ', w / 2, 250);
      ctx.font = '500 32px "Chakra Petch", Arial, sans-serif';
      ctx.fillStyle = '#c9b48a';
      ctx.fillText('THE CLOSET IS A CLOSET', w / 2, 320);
      grime(ctx, w, h, 0.8, 5);
    });
    const tillMat = new THREE.MeshStandardNodeMaterial({ map: tillTex, roughness: 0.7, emissiveMap: tillTex, emissive: new THREE.Color(0.2, 0.16, 0.1) });
    const till = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.12), tillMat);
    till.position.set(18.4, 5.15, -4.05);
    till.castShadow = true;
    root.add(till);

    const vacTex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#101614';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#9ad7c8';
      ctx.textAlign = 'center';
      ctx.font = '700 72px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('VACANCY', w / 2, 110);
      ctx.font = '500 36px "Chakra Petch", Arial, sans-serif';
      ctx.fillStyle = '#e8d6b0';
      ctx.fillText('TWO OF THREE. BRING A PICK.', w / 2, 185);
      grime(ctx, w, h, 1.3, 6);
    });
    const vac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.15, 0.1), new THREE.MeshStandardNodeMaterial({ map: vacTex, roughness: 0.75, emissiveMap: vacTex, emissive: new THREE.Color(0.05, 0.12, 0.1) }));
    vac.position.set(-3.2, 3.55, 7.0);
    root.add(vac);

    // Porches, a west-aisle diner, a loft that looks slept in, and a shed that points at the wash.
    b.add(roofDiner, box(13.4, 0.1, 1.15, -17.9, 3.52, -3.65));
    for (const px of [-20.8, -15.0]) {
      b.add(wood('#3a2a1c'), box(0.14, 2.55, 0.14, px, 1.28, -3.5));
      this.boxCol(f, px, 1.28, -3.5, 0.09, 1.28, 0.09);
    }
    b.add(glass, box(0.06, 0.95, 1.5, -23.48, 1.75, -7.0), box(0.06, 0.95, 1.5, -23.48, 1.75, -9.8));
    b.add(plank, box(0.95, 0.08, 0.9, -21.5, 0.76, -6.7), box(0.95, 0.08, 0.9, -21.5, 0.76, -9.3));
    b.add(metal, cyl(0.045, 0.045, 0.72, -21.5, 0.36, -6.7, 6), cyl(0.045, 0.045, 0.72, -21.5, 0.36, -9.3, 6));
    this.boxCol(f, -21.5, 0.4, -6.7, 0.48, 0.4, 0.46);
    this.boxCol(f, -21.5, 0.4, -9.3, 0.48, 0.4, 0.46);
    for (const sz of [-6.05, -7.35, -8.65, -9.95]) {
      b.add(cream, cyl(0.16, 0.16, 0.08, -21.5, 0.5, sz, 8), cyl(0.04, 0.04, 0.46, -21.5, 0.24, sz, 5));
    }
    b.add(roofClinic, box(4.4, 0.1, 1.35, 0, 3.12, -4.35));
    for (const px of [-1.55, 1.55]) {
      b.add(wood('#3a2a1c'), box(0.12, 2.35, 0.12, px, 1.18, -4.45));
      this.boxCol(f, px, 1.18, -4.45, 0.08, 1.18, 0.08);
    }
    b.add(fabric('#6b3a34'), box(1.15, 0.1, 2.05, 19.1, 3.18, -6.3));
    b.add(plankDark, box(0.55, 0.38, 0.45, 15.4, 3.32, -5.5));
    {
      const x0 = 24.2, x1 = 29.6, z0 = 8.15, z1 = 12.7, Hs = 2.65;
      this.wallX(b, stuccoDark, f, x0, x1, z1, 0, Hs, 0.22);
      this.wallZ(b, stuccoDark, f, x0, z0, z1, 0, Hs, 0.22);
      this.wallZ(b, stuccoDark, f, x1, z0, z1, 0, Hs, 0.22);
      b.add(roofStore, box(6.0, 0.12, 5.1, 26.9, Hs + 0.04, 10.4));
      b.add(plank, box(0.85, 0.55, 0.6, 27.8, 0.32, 10.5));
      this.boxCol(f, 27.8, 0.32, 10.5, 0.42, 0.28, 0.3);
      this.spot('shed', f, 26.9, 1.05, 7.35);
    }
    const bulb = glow('#ffb060', 2.8);
    b.add(bulb.material,
      new THREE.SphereGeometry(0.07, 8, 6).translate(-17.9, 3.15, -8.0),
      new THREE.SphereGeometry(0.06, 8, 6).translate(0.15, 2.8, -8.2),
      new THREE.SphereGeometry(0.06, 8, 6).translate(16.3, 2.65, -7.1),
      new THREE.SphereGeometry(0.045, 8, 6).translate(14.6, 5.15, -12.2),
    );
    // virtual: the light pool lends these a real light only when you are near enough to see it
    const hang = (x: number, y: number, z: number, intensity: number, dist: number) => {
      const L = new VirtualLight(0xffb060, intensity, dist, 1.7);
      L.parent = root;
      L.position.set(x, y, z);
    };
    hang(-17.9, 2.9, -8.0, 7, 10);
    hang(0.15, 2.6, -8.2, 5, 8);
    hang(16.3, 2.45, -7.1, 6, 9);
    hang(14.6, 4.9, -12.2, 3.5, 6);

    const washTex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1c140e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8d6b0';
      ctx.textAlign = 'center';
      ctx.font = '700 72px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('THE WASH', w / 2, 95);
      ctx.font = '500 30px "Chakra Petch", Arial, sans-serif';
      ctx.fillStyle = '#ffb347';
      ctx.fillText('POSTS. NORTH OF THE SPIRE.', w / 2, 155);
      ctx.fillStyle = '#c9b48a';
      ctx.fillText('THE RIDGE DOES NOT HAVE A ROAD.', w / 2, 205);
      grime(ctx, w, h, 1.2, 4);
    });
    const washBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.78, 0.06),
      new THREE.MeshStandardNodeMaterial({ map: washTex, roughness: 0.8, emissiveMap: washTex, emissive: new THREE.Color(0.12, 0.08, 0.05) }),
    );
    washBoard.position.set(25.0, 1.7, 8.02);
    root.add(washBoard);

    const far = b.buildFar('creek-far');
    root.add(b.build('creek'));
    const fire = new Fire(0.85, 28);
    fire.group.position.set(-0.4, 0.12, 2.3);
    root.add(fire.group);
    this.split(root, f, 34, far, [fire.group, sign]);
    this.landmarks.fires.push(fire);
    this.landmarks.audioSpots.push({ kind: 'fire', pos: f.p(-0.4, 0.3, 2.3) });
    this.landmarks.audioSpots.push({ kind: 'generator', pos: f.p(5.5, 0.6, -7.4) });
    this.group.add(root);
  }

  // ------------------------------------------------------------------ the ridge
  private buildCave() {
    const f = this.frameFor('cave');
    const root = new THREE.Group();
    root.name = 'the-cut';
    root.applyMatrix4(f.m);
    const b = new MeshBatch();
    const rock = rockMaterial();
    const H = 4.3;
    const MOUTH = 2.55;
    // south wall is the mouth. Interior runs toward +Z, into the ridge.
    this.gapX(b, rock, f, -5.4, 5.4, -1, 0.7, -1.45, 1.45, MOUTH, H);
    this.wallX(b, rock, f, -5.4, 5.4, 9.6, 0, H, 0.7);
    this.wallZ(b, rock, f, -5.4, -1, 9.6, 0, H, 0.7);
    this.gapZ(b, rock, f, 5.4, -1, 9.6, 0.7, 2.0, 4.7, 2.4, H);
    // side pocket
    this.wallX(b, rock, f, 5.4, 9.4, 1.15, 0, 3.6, 0.55);
    this.wallX(b, rock, f, 5.4, 9.4, 5.55, 0, 3.6, 0.55);
    this.wallZ(b, rock, f, 9.4, 1.15, 5.55, 0, 3.6, 0.55);
    b.add(rock, box(11.6, 0.45, 11.4, 0.2, 4.15, 4.2)); // ceiling
    b.add(rock, box(4.6, 0.4, 4.8, 7.4, 3.55, 3.3));
    // brow over the mouth, visual, above head height
    b.add(rock, box(6.2, 1.1, 2.4, 0, 3.7, -2.3));
    const flank = (x: number, z: number, s: number) => {
      const g = new THREE.IcosahedronGeometry(s, 1);
      g.scale(1.1, 0.72, 1);
      g.translate(x, s * 0.45, z);
      b.add(rock, norm(g));
      this.boxCol(f, x, s * 0.4, z, s * 0.7, s * 0.45, s * 0.7);
    };
    flank(-3.5, -2.5, 1.35);
    flank(3.6, -2.6, 1.45);
    flank(-4.6, 2.2, 1.1);
    flank(0.4, 8.2, 0.9);

    const fall = new THREE.Group();
    const rk = concrete('#5c534c');
    for (const [x, y, z, sx, sy, sz] of [[5.3, 0.55, 2.7, 1.1, 1.0, 0.9], [5.5, 0.7, 3.7, 1.2, 1.3, 1.0], [5.2, 1.35, 3.2, 0.8, 0.7, 0.75]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), rk);
      m.position.set(x, y, z);
      m.rotation.y = x;
      m.castShadow = true;
      fall.add(m);
    }
    root.add(fall);
    const fallCol = this.boxCol(f, 5.35, 1.1, 3.35, 0.75, 1.15, 1.25);
    this.blockers.push({ id: 'rockfall', obj: fall, collider: fallCol });

    const ember = glow('#ff9a4a', 2.2);
    b.add(ember.material, new THREE.SphereGeometry(0.12, 8, 6).translate(-3.1, 0.35, 5.4));
    this.landmarks.flickers.push({ set: (v) => (ember.intensity.value = 2.2 * (0.7 + 0.3 * v)), phase: 0.4, speed: 0.8, broken: 0.1 });
    b.add(wood('#3d2a1c'), box(0.7, 0.35, 0.45, 7.5, 0.25, 3.5));
    this.person(b, f, -2.3, 6.4, Math.PI, '#3a332c', '#6b5a40');

    // a flat that only shows once the fall is gone: painted, not beamed
    const note = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2a241c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e6d7b8';
      ctx.textAlign = 'center';
      ctx.font = '600 42px "Chakra Petch", Arial, sans-serif';
      ctx.fillText('V. K. LOOKED.', w / 2, 100);
      ctx.fillText("DIDN'T BUY.", w / 2, 160);
      grime(ctx, w, h, 1.6, 8);
    });
    const noteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), new THREE.MeshStandardNodeMaterial({ map: note, roughness: 0.85 }));
    noteMesh.position.set(8.3, 1.5, 3.4);
    noteMesh.rotation.y = -Math.PI / 2;
    root.add(noteMesh);

    this.spot('mouth', f, 0, 0.25, -4.2);
    this.spot('caveIn', f, 0, 0.25, 4.2);
    this.spot('wick', f, -2.3, 1.05, 6.4);
    this.spot('rock', f, 3.5, 1.15, 3.35);
    this.spot('pocket', f, 7.4, 1.0, 3.4);

    const far = b.buildFar('cave-far', { colors: new Map([[rock as THREE.Material, '#8a6a52']]) });
    root.add(b.build('cave'));
    const fire = new Fire(0.55, 18);
    fire.group.position.set(-3.1, 0.05, 5.4);
    root.add(fire.group);
    this.split(root, f, 12, far, [fire.group]);
    this.landmarks.fires.push(fire);
    this.landmarks.audioSpots.push({ kind: 'fire', pos: f.p(-3.1, 0.3, 5.4) });
    this.group.add(root);
  }

  /** Posts along the carved wash, in world space. The group itself is unrotated. */
  private buildTrail() {
    const posts = new MeshBatch();
    const timber = wood('#3a2a1c');
    const cap = rustyMetal({ base: '#8a4030', rust: 0.5, metalness: 0.35 });
    const lamp = glow('#ffcc88', 2.2);
    CAVE_TRAIL.forEach(([x, z], i) => {
      if (i === CAVE_TRAIL.length - 1) return;
      const y = this.hf.heightAt(x, z);
      posts.add(timber, box(0.16, 1.7, 0.16, x, y + 0.85, z));
      posts.add(cap, box(0.34, 0.22, 0.06, x, y + 1.55, z));
      const g = new THREE.SphereGeometry(0.05, 6, 4);
      g.translate(x, y + 1.72, z);
      posts.add(lamp.material, g);
      this.physics.addBox({ x, y: y + 0.85, z }, { x: 0.1, y: 0.85, z: 0.1 }, 0);
    });
    this.landmarks.flickers.push({ set: (v) => (lamp.intensity.value = 2.2 * (0.75 + 0.25 * v)), phase: 0.6, speed: 0.5, broken: 0.12 });
    this.group.add(posts.build('trail'));
  }

  // ------------------------------------------------------------------ interactions
  private buildInteractables() {
    const talk = (id: string, label: string, run: () => void | Promise<void>): Interactable => ({
      id, pos: this.pos(id), radius: 2.05,
      primary: { label, available: () => true, run },
    });

    this.interactables.push(talk('nia', 'Talk to Nia', () => this.talkNia()));
    this.interactables.push({
      id: 'freezer', pos: this.pos('freezer'), radius: 1.8,
      primary: this.circuitAction('freezer', 'Diner freezer', 3, 'creek.freezer', () => {
        this.s.set('creek.freezer');
        const got = this.loot([{ id: 'ration', qty: 2 }, { id: 'water', qty: 1 }]);
        this.ctx.ui.banner('THE FREEZER', `The seal sighs. ${got}`, 'good');
        this.s.addXP(XP_REWARDS.cache, 'Freezer');
      }),
    });
    this.interactables.push(talk('doc', 'Talk to Doc Ivers', () => this.talkDoc()));
    this.interactables.push({
      id: 'generator', pos: this.pos('generator'), radius: 1.9,
      visible: () => !this.s?.has('creek.power'),
      primary: this.circuitAction('generator', 'Clinic generator', 2, 'creek.power', () => this.powerClinic('The clinic window wakes up. Doc can work.')),
    });
    this.interactables.push({
      id: 'inez', pos: this.pos('inez'), radius: 2.1,
      primary: { label: 'Talk to Inez', available: () => true, run: () => this.talkInez() },
      secondary: {
        label: 'Palm the till',
        available: () => {
          if (this.s.has('creek.till')) return 'Already light.';
          if (this.s.skill('stealth') < 2) return 'Requires Stealth 2';
          if (!this.ctx.player.crouching) return 'Crouch. She is right there.';
          return true;
        },
        run: () => {
          if (!this.s.set('creek.till')) return;
          const got = this.loot([{ id: 'scrap', qty: 4 }, { id: 'water', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`The till was light. Inez is still talking to a shelf. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'The till');
        },
      },
    });
    this.interactables.push({
      id: 'closet', pos: this.pos('closet'), radius: 1.85,
      visible: () => !this.s?.has('creek.stair'),
      primary: this.pickAction(4, 3, 'CLOSET', () => this.opened('creek.stair', 'closet', 'The closet was a stair all along. Up you go.')),
      secondary: {
        label: 'Charge the closet door',
        available: () => this.chargeReason(2),
        run: () => this.blow('creek.stair', 'closet', null, 'The closet door comes off. Everyone in the Till heard it.', 2),
      },
    });
    this.interactables.push({
      id: 'loft', pos: this.pos('loftShelf'), radius: 1.5,
      visible: () => !!this.s?.has('creek.stair') && !this.s.has('creek.loft'),
      primary: {
        label: 'Read the page on the shelf',
        available: () => true,
        run: () => this.readLoft(),
      },
    });
    this.interactables.push({
      id: 'guest', pos: this.pos('guest'), radius: 1.6,
      visible: () => !this.s?.has('creek.guest'),
      primary: { label: 'Read the guest book', available: () => true, run: () => this.readGuest() },
    });
    this.interactables.push({
      id: 'motelB', pos: this.pos('motelB'), radius: 1.85,
      visible: () => !this.s?.has('creek.motel.b'),
      primary: this.pickAction(3, 1, 'MOTEL', () => this.opened('creek.motel.b', 'motelB', 'Three pins. The room smells like a closed window.')),
    });
    this.interactables.push({
      id: 'motelBloot', pos: this.pos('motelBloot'), radius: 1.6,
      visible: () => !!this.s?.has('creek.motel.b') && !this.s.has('creek.motel.b.loot'),
      primary: {
        label: 'Search the room', available: () => true,
        run: () => {
          // Sol's roll is the room's real find. It comes with you even if the pack complains.
          if (!this.s.has('creek.motel.b.loot')) this.s.addItem('sol_roll', 1, false, true);
          this.take('creek.motel.b.loot', [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }, { id: 'medkit', qty: 1 }]);
        },
      },
    });
    this.interactables.push({
      id: 'motelC', pos: this.pos('motelC'), radius: 1.85,
      visible: () => !this.s?.has('creek.motel.c'),
      primary: {
        label: 'Charge the boards',
        available: () => this.chargeReason(1),
        run: () => this.blow('creek.motel.c', null, 'boards', 'Boards. The street looks over.', 1),
      },
    });
    this.interactables.push({
      id: 'motelCloot', pos: this.pos('motelCloot'), radius: 1.6,
      visible: () => !!this.s?.has('creek.motel.c') && !this.s.has('creek.motel.c.loot'),
      primary: { label: 'Search the boarded room', available: () => true, run: () => this.take('creek.motel.c.loot', [{ id: 'charge', qty: 1 }, { id: 'scrap', qty: 3 }]) },
    });
    this.interactables.push(talk('sol', 'Talk to Sol', () => this.talkSol()));
    this.interactables.push(talk('ren', 'Talk to Ren', () => this.talkRen()));
    this.interactables.push({
      id: 'shed', pos: this.pos('shed'), radius: 1.8,
      visible: () => !this.s?.has('creek.wash'),
      primary: { label: 'Read the board', available: () => true, run: () => this.readWash() },
    });
    this.interactables.push({
      id: 'forage', pos: this.pos('forage'), radius: 2.1,
      visible: () => !this.s?.has('creek.forage'),
      primary: {
        label: 'Pick through the wash',
        available: () => (this.s.skill('survival') >= 1 ? true : 'Requires Survival 1'),
        run: () => {
          if (!this.s.set('creek.forage')) return;
          const sv = this.s.skill('survival');
          const items = [{ id: 'scrap', qty: sv >= 3 ? 4 : 2 }];
          if (sv >= 3) items.push({ id: 'ration', qty: 1 }, { id: 'water', qty: 1 });
          if (sv >= 5) items.push({ id: 'medkit', qty: 1 });
          const got = this.loot(items);
          this.toast(`The wash gives up what the rain left. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'The wash');
        },
      },
    });
    this.interactables.push({
      id: 'tower', pos: this.pos('tower'), radius: 1.7,
      visible: () => !this.s?.has('creek.tower'),
      primary: {
        label: 'The crate under the tower',
        available: () => {
          const stealth = this.s.skill('stealth') >= 3 && this.ctx.player.crouching;
          const eye = this.s.skill('survival') >= 4;
          if (stealth || eye) return true;
          return 'Requires Stealth 3, crouched — or Survival 4';
        },
        run: () => this.take('creek.tower', [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }, { id: 'lockpick', qty: 2 }]),
      },
    });

    this.interactables.push(talk('wick', 'Talk to Wick', () => this.talkWick()));
    this.interactables.push({
      id: 'rock', pos: this.pos('rock'), radius: 2.0,
      visible: () => !this.s?.has('cave.pocket'),
      primary: {
        label: 'Charge the rockfall',
        available: () => this.chargeReason(2),
        run: () => this.blow('cave.pocket', null, 'rockfall', 'The fall slumps. The pocket behind it was always there.', 2),
      },
    });
    this.interactables.push({
      id: 'pocket', pos: this.pos('pocket'), radius: 1.6,
      visible: () => !!this.s?.has('cave.pocket') && !this.s.has('cave.pocket.loot'),
      primary: {
        label: 'The crate she didn\'t buy',
        available: () => true,
        run: () => this.vesperCrate(),
      },
    });
  }

  // ------------------------------------------------------------------ rules of the street
  /** The Social rank Dry Creek hears: Known Face adds one, the Defector's founder accent costs one. */
  private townSocial() {
    return Math.max(0, this.social() - (this.s.archetype.perk === 'insider' ? 1 : 0));
  }

  private needSocial(n: number, who: string) {
    if (this.townSocial() >= n) return undefined;
    const accent = this.s.archetype.perk === 'insider' ? ' Dry Creek hears your founder accent: one rank less.' : '';
    return `Requires Social Engineering ${n}. ${who}${accent}`;
  }

  /** "Walk west with me" after Act I. Anyone at standing 2 says yes. */
  private crewChoice(id: 'nia' | 'doc' | 'inez' | 'sol' | 'ren' | 'wick', label = 'Would you walk west with me, to Apex?') {
    if (!this.s.has('debriefed')) return [];
    if (this.s.has(`crew.${id}`)) return [{ id: 'crewed', label: 'About Apex.', disabled: 'Already said yes. Already packing.' }];
    const rep = this.s.rep(id);
    return [{ id: 'crew', label, disabled: rep >= 2 ? undefined : 'Not yet. Finish a favour for them first (standing 2).', next: 'crew' }];
  }

  private joinCrew(id: string) {
    if (!this.s.set(`crew.${id}`)) return;
    this.s.addXP(25, 'Crew for Apex');
    this.ctx.audio.play('uiConfirm');
  }

  private powerClinic(line: string) {
    if (!this.s.set('creek.power')) return;
    this.ctx.audio.play('unlock');
    this.ctx.ui.banner('GENERATOR', line, 'good');
    this.s.addXP(XP_REWARDS.keypadShorted, 'Generator');
  }

  private circuitAction(id: string, title: string, difficulty: number, flag: string, onOk: () => void): Action {
    const need = id === 'freezer' ? 3 : 1;
    return {
      label: id === 'freezer' ? 'Open the freezer' : 'Convince the generator',
      available: () => {
        if (this.s.has(flag)) return 'Already done.';
        if (this.s.skill('electronics') < need) return `Requires Electronics ${need}`;
        return true;
      },
      run: async () => {
        if (this.s.has(flag)) return;
        if (this.s.skill('electronics') >= 5) {
          this.toast('You flip it like a switch.', 'good');
          // Salvage pays for a switch too (boards pay through Game's circuit wrapper)
          if (this.s.capstone('electronics') === 'salvage') this.loot([{ id: 'battery', qty: 1 }]);
          onOk();
          return;
        }
        const ok = await this.ctx.ui.circuit({ title, difficulty });
        if (ok) onOk();
        else this.ctx.audio.play('deny');
      },
    };
  }

  private pickAction(pins: number, need: number, title: string, onOk: () => void): Action {
    return {
      label: `Pick lock · ${pins} pins`,
      available: () => {
        if (this.s.skill('lockpicking') < need) return `Requires Lockpicking ${need}`;
        if (this.s.count('lockpick') < 1) return 'Need a lockpick';
        return true;
      },
      run: async () => {
        const res = await this.ctx.ui.lockpick({
          pins, title,
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.s.events.emit('toast', { text: `Lockpick snapped (${this.s.count('lockpick')} left)`, kind: 'bad' });
            return this.s.count('lockpick') > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + pins * 5, 'Lock picked');
          onOk();
        }
      },
    };
  }

  private chargeReason(need: number): true | string {
    if (this.s.skill('demolition') < need) return `Requires Demolition ${need}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private opened(flag: string, door: string | null, line: string) {
    if (!this.s.set(flag)) return;
    if (door) this.openDoor(door, false);
    this.toast(line, 'good');
  }

  private blow(flag: string, door: string | null, blocker: string | null, loud: string, need: number) {
    if (this.chargeReason(need) !== true) { this.ctx.audio.play('deny'); return; }
    if (this.s.has(flag)) return;
    if (!this.s.removeItem('charge', 1)) return;
    this.s.set(flag);
    const quiet = this.s.focus('demolition') === 'shaped' || (this.s.skill('demolition') >= 4 && this.ctx.player.crouching);
    if (door) this.openDoor(door, false);
    if (blocker) this.clearBlocker(blocker);
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.8 });
    this.ctx.cam.addTrauma(quiet ? 0.12 : 0.4);
    this.toast(quiet ? 'Shaped. The street stays at dinner.' : loud, quiet ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.breach, 'Breached');
  }

  private loot(items: { id: string; qty: number }[]) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private take(flag: string, items: { id: string; qty: number }[]) {
    if (!this.s.set(flag)) return;
    const got = this.loot(items);
    this.ctx.audio.play('pickup');
    this.toast(got || 'Nothing you can carry.', got ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.cache, 'Cache');
  }

  private async vesperCrate() {
    const pick = await this.ctx.ui.choose({
      speaker: 'Paint on the rock',
      text: '"V. K. looked. Didn\'t buy." Under the paint, a crate taped shut in her handwriting: PROTOTYPE ADJACENT. Water, cells, scrap. Wick is watching you from the fire.',
      choices: [
        { id: 'take', label: 'Take the crate.' },
        { id: 'leave', label: 'Leave it for Wick.' },
        { id: 'later', label: 'Not yet.' },
      ],
    });
    if (pick === 'take' && this.s.set('q.wick.took')) {
      this.s.set('cave.pocket.loot');
      const got = this.loot([{ id: 'water', qty: 1 }, { id: 'battery', qty: 2 }, { id: 'scrap', qty: 2 }]);
      this.s.addXP(40, 'Vesper\'s leftovers');
      this.toast(`${got}. Wick says nothing, which from Wick is a paragraph.`, 'good');
    } else if (pick === 'leave' && this.s.set('q.wick.left')) {
      this.s.set('cave.pocket.loot');
      this.toast('You leave it. Wick paints over her initials with his own, and points at the seep at the back of the cave.', 'good');
    }
  }

  private async readWash() {
    if (!this.s.set('creek.wash')) return;
    this.s.set('cave.known');
    this.s.addXP(15, 'The wash');
    await this.ctx.ui.choose({
      speaker: 'Board on the shed',
      text: 'South of the Spire there\'s a wash with posts in it, the only ground up that ridge that still agrees to be walked. Wick lives at the top. He does not come down for coffee.',
      choices: [{ id: 'ok', label: 'Follow the posts.' }],
    });
  }

  private async readGuest() {
    if (!this.s.set('creek.guest')) return;
    this.s.addXP(15, 'Guest book');
    await this.ctx.ui.choose({
      speaker: 'Guest book',
      text: 'Last page, in pencil: "Room 2 is three pins, if your hands are worth a rank. Room 3 is nailed shut. The ice machine left with the owner. And the Till has a stair that the sign calls a closet."',
      choices: [{ id: 'ok', label: 'Tear the page out' }],
    });
  }

  private async readLoft() {
    if (!this.s.set('creek.loft')) return;
    this.s.set('cave.known');
    const got = this.loot([{ id: 'battery', qty: 1 }, { id: 'water', qty: 1 }]);
    this.s.addItem('deed', 1, true, true);
    this.s.addXP(35, 'The stair');
    await this.ctx.ui.choose({
      speaker: 'The landlord\'s shelf',
      text: `A map of the ridge south of the Spire, with a cut drawn in it: "Wick answers the radio with silence. A woman with rocket money looked at the pocket and didn't buy." Under it, the deed to the Till, signed over to "whoever is still here". ${got}`,
      choices: [{ id: 'ok', label: 'Take the deed. Decide later.' }],
    });
  }

  // ------------------------------------------------------------------ Nia
  private async talkNia() {
    if (this.s.set('creek.talk.nia')) this.s.addXP(XP_REWARDS.talk, 'Heard Nia');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.niaNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'water' && s.set('creek.nia.water')) {
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast('Nia slides one bottle across. She writes it down.', 'good');
        }
        if (choice === 'ridge' && s.set('creek.nia.ridge')) {
          s.set('cave.known');
          s.addXP(XP_REWARDS.talk, 'The ridge');
        }
        if (choice === 'stair') s.set('creek.hint.stair');
        if (choice === 'tell') s.set('q.nia.told');
        if (choice === 'cover' && s.count('water') >= 2 && !s.has('q.nia.covered')) {
          s.removeItem('water', 2);
          s.set('q.nia.covered');
        }
        if (choice === 'peace' && this.townSocial() >= 3) s.set('q.nia.peace');
        if (choice === 'plate' && s.favours().niaPlate && s.favourReady('nia.plate')) {
          s.useFavour('nia.plate');
          s.satisfy(45, 12, 8);
          this.ctx.audio.play('eat');
          this.toast('Nia\'s plate. Beans, something green, and opinions. Less hungry, less thirsty.', 'good');
        }
        if (choice === 'deed' && s.removeItem('deed', 1)) s.set('q.inez.town');
        if (choice === 'crew') this.joinCrew('nia');
      },
    });
  }

  private niaNode(id: string) {
    const s = this.s;
    const soc = this.townSocial();
    const q = s.has('q:nia.short') && !s.has('q:nia.short:done');
    if (id === 'hello') {
      const short = s.has('q.nia.told') || s.has('q.nia.peace') || s.has('q.nia.covered')
        ? ''
        : ' Also, somebody keeps drinking my ledger. Two bottles a week, from under this counter.';
      const plate = s.favours().niaPlate;
      return {
        speaker: 'Nia Pell',
        text: `${s.rep('nia') >= 2 ? 'There you are. Sit.' : 'You have the radio look. Mara\'s, or just thirsty.'} I cook what shows up. Today that isn't much.${short}`,
        choices: [
          { id: 'water', label: 'One bottle, for the camp.', disabled: s.has('creek.nia.water') ? 'She already wrote you down.' : undefined, next: 'hello' },
          ...(q ? [{ id: 'short', label: s.has('q.nia.who') ? 'I know who\'s taking your water.' : 'About your missing water...', next: 'short' }] : []),
          ...(plate ? [{ id: 'plate', label: 'Eat at the counter.', disabled: s.favourReady('nia.plate') ? undefined : 'Rest first. The plate is for people who sleep.', next: 'hello' }] : []),
          ...(s.count('deed') && !s.has('q.inez.inez') && !s.has('q.inez.town') ? [{ id: 'deed', label: 'Pin the Till\'s deed on your wall. It\'s the town\'s.', next: 'deed' }] : []),
          { id: 'who', label: 'Who else is still here?', next: 'who' },
          { id: 'ridge', label: 'Anything up on the ridge?', disabled: this.needSocial(1, 'She doesn\'t give directions to strangers.'), next: 'ridge' },
          ...this.crewChoice('nia'),
          { id: 'bye', label: 'Keep the light on.' },
        ],
      };
    }
    if (id === 'short') {
      if (!s.has('q.nia.who')) {
        return {
          speaker: 'Nia Pell',
          text: 'Two bottles a week. Always at night. Always the good ones. Find out who before I suspect everyone. I already suspect everyone.',
          choices: [{ id: 'back', label: 'I\'ll ask around.', next: 'hello' }],
        };
      }
      return {
        speaker: 'Nia Pell',
        text: 'Well? Who is it? Don\'t soften it. I\'ve been softened enough for one apocalypse.',
        choices: [
          { id: 'tell', label: 'It\'s Doc.', next: 'told' },
          { id: 'cover', label: 'The jugs leak. Here, two of mine. (2 water)', disabled: s.count('water') >= 2 ? undefined : 'You need 2 water to cover it.', next: 'covered' },
          { id: 'peace', label: 'It\'s Doc, and he needs it for the clinic. Talk to him.', disabled: soc >= 3 ? undefined : this.needSocial(3, 'Making peace takes a gentle tongue.'), next: 'peace' },
          { id: 'back', label: 'Not yet.', next: 'hello' },
        ],
      };
    }
    if (id === 'told') {
      return {
        speaker: 'Nia Pell',
        text: 'Doc? DOC. I fed that man through two winters. ...Thank you. There\'s a plate at the counter for you whenever you\'ve slept. I\'m going to go yell now.',
        choices: [{ id: 'ok', label: 'Go easy on him. Or don\'t.' }],
      };
    }
    if (id === 'covered') {
      return {
        speaker: 'Nia Pell',
        text: 'Leaky jugs. Of course it\'s leaky jugs. Thank you. I\'ll stop glaring at the clinic. Mostly.',
        choices: [{ id: 'ok', label: 'Glare a little. For balance.' }],
      };
    }
    if (id === 'peace') {
      return {
        speaker: 'Nia Pell',
        text: 'For the sterilizer? He could have ASKED. Fine. Fine! He stores it here, in writing, and he buys the next ledger. Tell him I said that. Tell him I said it nicely.',
        choices: [{ id: 'ok', label: 'I\'ll tell him you said it nicely.' }],
      };
    }
    if (id === 'deed') {
      return {
        speaker: 'Nia Pell',
        text: 'The Till belongs to Dry Creek? Inez is going to set something on fire. Probably this. I\'m going to laminate it.',
        choices: [{ id: 'ok', label: 'Laminate it twice.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Nia Pell',
        text: 'Somebody has to feed you on the way. Yes. I\'m bringing the stove. The stove is coming whether it likes it or not.',
        choices: [{ id: 'ok', label: 'Bring the stove.' }],
      };
    }
    if (id === 'who') {
      return {
        speaker: 'Nia Pell',
        text: 'Doc Ivers runs the clinic, when the generator agrees with him. Inez runs the Till and locks rooms she says are empty. Sol keeps the street fire and knows every tired lock. Ren just sits and counts the road. We\'re not a town. We\'re a pause between thirsts.',
        choices: [{ id: 'back', label: 'Sounds like a town to me.', next: 'hello' }],
      };
    }
    if (id === 'ridge') {
      const stair = soc >= 3 ? ' And Inez\'s back room has a stair. She calls it a closet. Closets don\'t have that many steps.' : '';
      return {
        speaker: 'Nia Pell',
        text: `South of the Spire, somebody cut a wash into the ridge and put posts in it. It\'s the only ground up there that still agrees to be walked. A man called Wick lives at the top and answers the radio with silence.${stair}`,
        choices: [
          ...(soc >= 3 ? [{ id: 'stair', label: 'Tell me about the stair.', next: 'hello' }] : []),
          { id: 'ok', label: 'I\'ll know it when I see it.', next: 'hello' },
        ],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Doc
  private async talkDoc() {
    if (this.s.set('creek.talk.doc')) this.s.addXP(XP_REWARDS.talk, 'Heard Doc');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.docNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'heal' && s.has('creek.power')) {
          const calls = s.favours().docCalls;
          const ok = calls ? s.favourReady('doc.heal') : !s.has('creek.doc.heal');
          if (!ok) return;
          if (calls) s.useFavour('doc.heal');
          s.set('creek.doc.heal');
          const sv = s.skill('survival');
          s.heal(30 + sv * 6);
          if (sv >= 2 && !s.has('creek.doc.kit')) { s.set('creek.doc.kit'); this.loot([{ id: 'medkit', qty: 1 }]); }
          this.toast(calls ? 'House call. Doc stitches you and complains about your posture.' : sv >= 2 ? 'Doc stitches, then makes you take a kit so you stop visiting.' : 'Doc stitches what he can see.', 'good');
        }
        if (choice === 'cell' && !s.has('creek.power') && s.removeItem('battery', 1)) {
          this.powerClinic('Doc swears at the generator until it agrees with him. The window wakes up.');
        }
        if (choice === 'list' && this.townSocial() >= 2 && s.set('creek.doc.list')) {
          s.addXP(25, 'Patient list');
        }
        if (choice === 'admit' && this.townSocial() >= 2) s.set('q.nia.who');
        if (choice === 'kit' && s.has('creek.power') && s.set('q.doc.kit')) {
          s.addItem('medkit', 1, false, true);
        }
        if (choice === 'creek' && s.set('creek.doc.permit')) s.addXP(XP_REWARDS.talk, 'Why the creek is dry');
        if (choice === 'crew') this.joinCrew('doc');
      },
    });
  }

  private docNode(id: string) {
    const s = this.s;
    const powered = s.has('creek.power');
    const soc = this.townSocial();
    if (id === 'hello') {
      const calls = s.favours().docCalls;
      const healBlock = !powered ? 'The generator is out.' : calls ? (s.favourReady('doc.heal') ? undefined : 'House calls are once per rest.') : s.has('creek.doc.heal') ? 'He already spent the gauze on you.' : undefined;
      const coughQuest = s.has('q:doc.cough') && !s.has('q.doc.kit');
      return {
        speaker: 'Doc Ivers',
        text: powered
          ? (s.rep('doc') >= 2 ? 'My favourite patient. Don\'t let it go to your head, there are only nine of you.' : 'Window\'s on. That means I can see what I\'m doing. Don\'t make me grateful out loud.')
          : 'If you\'re bleeding, the generator has to agree first. It\'s out the east side. I don\'t speak to it. Also, Wick has a cough I can hear from here, and I can\'t do a thing about it in the dark.',
        choices: [
          { id: 'heal', label: calls ? 'House call, Doc.' : 'Patch me up.', disabled: healBlock, next: 'hello' },
          ...(!powered ? [{ id: 'cell', label: 'Here, a lithium cell. Rig it yourself.', disabled: s.count('battery') ? undefined : 'You don\'t have a lithium cell.', next: 'hello' }] : []),
          ...(coughQuest && powered ? [{ id: 'kit', label: 'You mentioned Wick\'s cough.', next: 'kit' }] : []),
          ...(s.has('q:nia.short') && !s.has('q.nia.who') ? [{ id: 'admit', label: 'Nia\'s missing water, Doc.', disabled: soc >= 2 ? undefined : this.needSocial(2, 'He won\'t confess to a stranger.'), next: 'admit' }] : []),
          { id: 'list', label: 'You knew Tanner\'s customers.', disabled: soc >= 2 ? (s.has('creek.doc.list') ? 'You have the list.' : undefined) : this.needSocial(2, 'He doesn\'t share patients with strangers.'), next: 'list' },
          { id: 'creek', label: 'What happened to the creek?', next: 'creek' },
          ...this.crewChoice('doc'),
          { id: 'bye', label: 'Take care, Doc.' },
        ],
      };
    }
    if (id === 'kit') {
      return {
        speaker: 'Doc Ivers',
        text: 'Wick. Up in the Cut, south of the Spire. Coughs like a cement mixer, won\'t come down. Take him this. Tell him it\'s from the town, not from me. He\'ll use it if it\'s from the town.',
        choices: [{ id: 'ok', label: 'From the town. Got it.' }],
      };
    }
    if (id === 'admit') {
      return {
        speaker: 'Doc Ivers',
        text: '...The sterilizer needs water. I was going to ask her. I\'ve been going to ask her for two years. Tell her, or don\'t. I\'m a doctor, not a diplomat.',
        choices: [{ id: 'ok', label: 'I\'ll think about what she hears.', next: 'hello' }],
      };
    }
    if (id === 'list') {
      return {
        speaker: 'Doc Ivers',
        text: 'Bunker health plans. Tanner sold them to half the camps: "priority medical in your private shelter". I treated the people who bought them. They got a tote bag and a laminated card. I kept the list because somebody should.',
        choices: [{ id: 'ok', label: 'Somebody should.', next: 'hello' }],
      };
    }
    if (id === 'creek') {
      return {
        speaker: 'Doc Ivers',
        text: 'The summer before the Pivot, the county let Kade Holdings run a "pilot" on our aquifer. We got a school with a rocket on the sign. Eight months later the creek stopped. They called it a drought. Droughts don\'t come with a pump station.',
        choices: [{ id: 'ok', label: 'Kade Holdings.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Doc Ivers',
        text: 'Somebody has to stitch you up on the salt. Fine. I\'m bringing the good gauze, and I\'m complaining the whole way.',
        choices: [{ id: 'ok', label: 'Complain all you like.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Inez
  private async talkInez() {
    if (this.s.set('creek.talk.inez')) this.s.addXP(XP_REWARDS.talk, 'Heard Inez');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.inezNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'trade') {
          const rate = s.favours().inezRate;
          if (s.count('scrap') < rate) return;
          s.removeItem('scrap', rate);
          this.loot([{ id: 'water', qty: 1 }]);
          this.toast(`${rate} scrap, one bottle. She doesn't haggle. Haggling is a second conversation.`, 'good');
        }
        if (choice === 'open' && s.set('creek.stair')) {
          this.openDoor('closet', false);
          this.ctx.audio.play('door');
          s.addXP(20, 'Inez opened the closet');
        }
        if (choice === 'stair') s.set('creek.hint.stair');
        if (choice === 'tickets') s.set('inez.tube');
        if (choice === 'deed' && s.removeItem('deed', 1)) s.set('q.inez.inez');
        if (choice === 'crew') this.joinCrew('inez');
      },
    });
  }

  private inezNode(id: string) {
    const s = this.s;
    const soc = this.townSocial();
    if (id === 'hello') {
      const rate = s.favours().inezRate;
      const owner = s.has('q.inez.inez');
      return {
        speaker: 'Inez Quill',
        text: owner
          ? 'Welcome to the Till. My Till. Legally, in pencil. Browse. Don\'t palm. I can hear a hand.'
          : s.has('q.inez.town')
            ? 'The town\'s Till is open. The town\'s prices went up. Funny how that works.'
            : 'The Till is open. The sign about the closet is also open, which is a kind of honesty. Don\'t palm the drawer. I can hear a hand.',
        choices: [
          { id: 'trade', label: `${rate} scrap for a bottle.`, disabled: soc >= 2 ? (s.count('scrap') >= rate ? undefined : `Need ${rate} scrap.`) : this.needSocial(2, 'She doesn\'t trade with strangers.'), next: 'hello' },
          ...(s.count('deed') && !owner && !s.has('q.inez.town') ? [{ id: 'deed', label: 'I found the deed to the Till. It\'s yours.', next: 'deeded' }] : []),
          { id: 'closet', label: 'The closet.', disabled: s.has('creek.stair') ? 'You\'ve been up there.' : this.needSocial(3, 'She won\'t discuss the closet with a stranger.'), next: 'closet' },
          { id: 'tickets', label: 'Ever sell anything that actually worked?', next: 'tickets' },
          ...this.crewChoice('inez'),
          { id: 'bye', label: 'I\'ll look, not touch.' },
        ],
      };
    }
    if (id === 'closet') {
      return {
        speaker: 'Inez Quill',
        text: 'The landlord\'s stair. I don\'t have a key that I will admit to. A picker at rank 3 gets bored and opens it. Or you can keep talking.',
        choices: [
          { id: 'open', label: 'Admit to the key.', disabled: soc >= 4 ? undefined : this.needSocial(4, 'She\'s not admitting anything yet.'), next: 'hello' },
          { id: 'stair', label: 'I\'ll come back with a pick.', next: 'hello' },
        ],
      };
    }
    if (id === 'tickets') {
      return {
        speaker: 'Inez Quill',
        text: 'Before the Pivot I sold forty tickets for the hyperloop out east. The Tube. Nobody\'s asked for a refund, because nobody ever arrived. If you\'re walking that way, find out whether I owe anybody.',
        choices: [{ id: 'ok', label: 'I\'ll look into your refund policy.', next: 'hello' }],
      };
    }
    if (id === 'deeded') {
      return {
        speaker: 'Inez Quill',
        text: '"Whoever is still here." I\'m still here. ...Thank you. Bottles are two scrap for you from now on. Don\'t tell Sol. Sol thinks I have a heart and I like him confused.',
        choices: [{ id: 'ok', label: 'Your secret\'s safe.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Inez Quill',
        text: 'West? To a vault full of rich people\'s things? I\'ll bring the scale. Somebody has to price it all.',
        choices: [{ id: 'ok', label: 'Bring the scale.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Sol
  private async talkSol() {
    if (this.s.set('creek.talk.sol')) this.s.addXP(XP_REWARDS.talk, 'Heard Sol');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.solNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'locks') s.set('creek.sol.locks');
        if (choice === 'night') s.set('q.nia.who');
        if (choice === 'give' && s.removeItem('sol_roll', 1)) s.set('q.sol.returned');
        if (choice === 'lie' && s.count('sol_roll')) s.set('q.sol.kept');
        if (choice === 'crew') this.joinCrew('sol');
      },
    });
  }

  private solNode(id: string) {
    const s = this.s;
    if (id === 'hello') {
      const rollOpen = !s.has('q.sol.returned') && !s.has('q.sol.kept');
      return {
        speaker: 'Sol Varga',
        text: s.has('q.sol.kept')
          ? 'Fire\'s communal. My roll isn\'t, but here we are.'
          : 'Fire\'s communal. The news isn\'t. You want locks, or the version where we\'re all fine?',
        choices: [
          { id: 'locks', label: 'Locks.', disabled: this.needSocial(1, 'He doesn\'t talk shop with strangers.'), next: 'locks' },
          ...(rollOpen && !s.count('sol_roll') ? [{ id: 'lost', label: 'You look like you lost something.', next: 'lost' }] : []),
          ...(rollOpen && s.count('sol_roll') ? [
            { id: 'give', label: 'Here. Your roll, from room 2.', next: 'given' },
            { id: 'lie', label: 'Room 2 was empty. Sorry.', next: 'lied' },
          ] : []),
          ...(s.has('q:nia.short') && !s.has('q.nia.who') ? [{ id: 'night', label: 'Who walks past your fire at night?', next: 'night' }] : []),
          ...this.crewChoice('sol'),
          { id: 'fine', label: 'The fine version.' },
        ],
      };
    }
    if (id === 'locks') {
      return {
        speaker: 'Sol Varga',
        text: 'Left motel room is open, and the guest book in it is worth a read. Middle door is three pins: Lockpicking 1. Right door is nailed: a charge, not a conversation. The Till\'s closet is the real lock. Rank 3, or talk Inez into admitting she has the key.',
        choices: [{ id: 'ok', label: 'I\'ll spend the point on the door I mean.', next: 'hello' }],
      };
    }
    if (id === 'lost') {
      return {
        speaker: 'Sol Varga',
        text: 'My pick roll. It\'s in motel room 2. I locked it in, then I locked myself out. Thirty years a locksmith. If you get in there, bring it back. Quietly. Nobody needs to hear about this.',
        choices: [{ id: 'ok', label: 'Nobody will hear it from me.', next: 'hello' }],
      };
    }
    if (id === 'given') {
      return {
        speaker: 'Sol Varga',
        text: 'You brought it back. People don\'t bring things back anymore. Here, sit. Bend the pick like this, not like that. Your picks will last longer, and you\'ll get three out of the scrap that used to make two.',
        choices: [{ id: 'ok', label: 'Like this, not like that.' }],
      };
    }
    if (id === 'lied') {
      return {
        speaker: 'Sol Varga',
        text: 'Mm. That\'s my roll on your belt. Keep it, then. My hands will remember whose hands it went to.',
        choices: [{ id: 'ok', label: 'Leave the fire.' }],
      };
    }
    if (id === 'night') {
      return {
        speaker: 'Sol Varga',
        text: 'Doc. Every other night, with a jug and a face like a confession. I don\'t ask. I notice. Now you\'ve noticed too. Congratulations, it\'s heavier than it looks.',
        choices: [{ id: 'ok', label: 'It is.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Sol Varga',
        text: 'Thirty years of other people\'s doors. One more won\'t kill me. It might. Yes.',
        choices: [{ id: 'ok', label: 'Bring the roll.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Ren
  private async talkRen() {
    if (this.s.set('creek.talk.ren')) this.s.addXP(10, 'Heard Ren');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.renNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'pantry' && s.skill('survival') >= 2 && s.set('creek.ren.ration')) {
          this.loot([{ id: 'ration', qty: 1 }]);
          this.toast('Ren hands you the ration they were saving for somebody who could name the wash.', 'good');
        }
        if (choice === 'truth') s.set('q.ren.truth');
        if (choice === 'spare') s.set('q.ren.spare');
        if (choice === 'crew') this.joinCrew('ren');
      },
    });
  }

  private renNode(id: string) {
    const s = this.s;
    const sv = s.skill('survival');
    const told = s.has('q.ren.truth') || s.has('q.ren.spare');
    if (id === 'hello') {
      return {
        speaker: 'Ren Oka',
        text: s.has('q.ren.truth')
          ? 'I\'m leaving for Last Chance in the morning. Mara says they need somebody who can count a road. I can count a road.'
          : 'We\'re a pause. The highway thinks it\'s a place. It isn\'t. Sit long enough and the wash starts to look like a pantry.',
        choices: [
          ...(s.has('site.drivein.done') && !told ? [{ id: 'ending', label: 'I found out how the keynote ended.', next: 'ending' }] : []),
          { id: 'drive', label: 'What did you do before the pause?', next: 'drive' },
          { id: 'pantry', label: 'Show me the pantry.', disabled: sv >= 2 ? (s.has('creek.ren.ration') ? 'You already ate their spare.' : undefined) : 'Requires Survival 2. You don\'t look like you know a pantry from a ditch.', next: 'hello' },
          ...this.crewChoice('ren'),
          { id: 'sit', label: 'I\'ll sit.' },
        ],
      };
    }
    if (id === 'drive') {
      return {
        speaker: 'Ren Oka',
        text: 'I ran the projector at the Starlite Drive-In, north of the highway. The last screening was a keynote. I walked out at "one more thing". Nobody else came out. I\'d like to know what the thing was. I wouldn\'t like to go and look.',
        choices: [{ id: 'ok', label: 'I could look.', next: 'hello' }],
      };
    }
    if (id === 'ending') {
      return {
        speaker: 'Ren Oka',
        text: 'Tell me. Or don\'t. I\'ve been fine not knowing for two years. Mostly fine.',
        choices: [
          { id: 'truth', label: 'Tell Ren everything you saw.', next: 'truthful' },
          { id: 'spare', label: 'It was static, Ren. Just static.', next: 'spared' },
        ],
      };
    }
    if (id === 'truthful') {
      return {
        speaker: 'Ren Oka',
        text: '...All that. And nobody left. Huh. (Ren laughs, once, like a door that hasn\'t opened in years.) I think I\'m done sitting. Tell Mara there\'s a lookout coming.',
        choices: [{ id: 'ok', label: 'I\'ll tell her.' }],
      };
    }
    if (id === 'spared') {
      return {
        speaker: 'Ren Oka',
        text: 'Static. Okay. That\'s... okay. Here, take the projector\'s last cells. I won\'t be needing them.',
        choices: [{ id: 'ok', label: 'Thanks, Ren.' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Ren Oka',
        text: 'I\'ll walk wherever you\'re walking. That\'s new for me. I\'ll count the steps.',
        choices: [{ id: 'ok', label: 'Count them out loud.' }],
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ Wick
  private async talkWick() {
    if (this.s.set('creek.talk.wick')) this.s.addXP(XP_REWARDS.talk, 'Heard Wick');
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.wickNode(id),
      onChoice: (_n, choice) => {
        const s = this.s;
        if (choice === 'share' && s.skill('survival') >= 2 && s.set('cave.share')) {
          this.loot([{ id: 'ration', qty: 1 }, { id: 'water', qty: 1 }]);
          this.toast('Wick splits what the ridge allows. It isn\'t a feast. It\'s a count.', 'good');
        }
        if (choice === 'vesper') s.set('cave.wick.vesper');
        if (choice === 'view') s.set('wick.jet');
        if (choice === 'help' && !s.has('cave.pocket') && (s.skill('survival') >= 3 || this.townSocial() >= 3)) {
          s.set('cave.pocket');
          this.clearBlocker('rockfall');
          this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.4 });
          s.addXP(XP_REWARDS.breach, 'Shifted the rockfall');
        }
        if (choice === 'kit' && s.count('medkit') && !s.has('q.doc.kept') && s.removeItem('medkit', 1)) {
          s.set('q.doc.delivered');
          s.set('wick.jet');
        }
        if (choice === 'greet') s.set('q.doc.kept');
        if (choice === 'seep' && s.favours().wickSeep && s.favourReady('wick.seep')) {
          s.useFavour('wick.seep');
          this.loot([{ id: 'water', qty: 1 }]);
        }
        if (choice === 'crew') this.joinCrew('wick');
      },
    });
  }

  private wickNode(id: string) {
    const s = this.s;
    const sv = s.skill('survival');
    const soc = this.townSocial();
    if (id === 'hello') {
      const docErrand = s.has('q.doc.kit') && !s.has('q.doc.delivered') && !s.has('q.doc.kept');
      return {
        speaker: 'Wick',
        text: s.has('q.wick.left')
          ? 'You again. The seep\'s yours too. Don\'t tell anybody, they\'ll want a view.'
          : 'You found the cut. Most people find the highway and call that a life. The fire is mine. The view is nobody\'s, which is why it\'s still here.',
        choices: [
          ...(docErrand ? [
            { id: 'kit', label: 'Doc sent this. From the town. (give a medkit)', disabled: s.count('medkit') ? undefined : 'You don\'t have a medkit any more.', next: 'kitted' },
            { id: 'greet', label: 'Doc says hello. (keep the medkit)', next: 'helloed' },
          ] : []),
          ...(s.favours().wickSeep ? [{ id: 'seep', label: 'Fill a bottle at the seep.', disabled: s.favourReady('wick.seep') ? undefined : 'It\'s still filling. Rest first.', next: 'hello' }] : []),
          { id: 'view', label: 'What can you see from up here?', next: 'view' },
          { id: 'share', label: 'I sleep outside too.', disabled: sv >= 2 ? (s.has('cave.share') ? 'He already split it.' : undefined) : 'Requires Survival 2. He can tell you don\'t live on what you carry.', next: 'hello' },
          ...(!s.has('cave.pocket') ? [{ id: 'fall', label: 'The rocks in the side passage.', next: 'fall' }] : []),
          { id: 'vesper', label: 'A woman with rocket money.', disabled: this.needSocial(1, 'He doesn\'t gossip with strangers.'), next: 'vesper' },
          ...this.crewChoice('wick'),
          { id: 'bye', label: 'I\'ll leave the fire.' },
        ],
      };
    }
    if (id === 'view') {
      return {
        speaker: 'Wick',
        text: 'The highway. The Garage\'s neon, when he remembers to pay for it. And southwest, out in the dunes, a tail fin. A private jet tried to leave the week of the Pivot. The desert said no.',
        choices: [{ id: 'ok', label: 'A jet in the dunes.', next: 'hello' }],
      };
    }
    if (id === 'fall') {
      const can = sv >= 3 || soc >= 3;
      return {
        speaker: 'Wick',
        text: 'Not mine. A charge moves it, if you\'re that kind of person: Demolition 2. Or we shift it by hand, if you\'ve got the back or the patter for it. Some doors are just rocks.',
        choices: [
          { id: 'help', label: 'Help me shift it by hand.', disabled: can ? undefined : 'Requires Survival 3 or Social Engineering 3. He won\'t lift for just anybody.', next: 'shifted' },
          { id: 'ok', label: 'Some doors are just doors.', next: 'hello' },
        ],
      };
    }
    if (id === 'shifted') {
      return {
        speaker: 'Wick',
        text: 'Lift with your legs. Your legs. Not your opinions. ...There. Behind it is her crate. Go see what she thinks she left.',
        choices: [{ id: 'ok', label: 'Dust off.' }],
      };
    }
    if (id === 'kitted') {
      return {
        speaker: 'Wick',
        text: 'From the town. Sure. (He coughs, and uses it.) ...Tell Doc thank you. Don\'t tell him I said it. Here, water from the seep. And look southwest off the edge sometime. There\'s a jet out there.',
        choices: [{ id: 'ok', label: 'I won\'t tell him.' }],
      };
    }
    if (id === 'helloed') {
      return {
        speaker: 'Wick',
        text: 'Hello back. (He coughs for a long time.) Tell him I\'m fine. I\'m always fine.',
        choices: [{ id: 'ok', label: 'Leave him with the cough.' }],
      };
    }
    if (id === 'vesper') {
      return {
        speaker: 'Wick',
        text: 'She stood where you\'re standing. Said the Garage was a prototype with bad unit economics. I said the prototype has my cousin\'s water. She looked at the pocket in the rock, didn\'t buy, and left her initials in paint, like paint is a deed.',
        choices: [{ id: 'ok', label: 'The camp has her name too.', next: 'hello' }],
      };
    }
    if (id === 'crew') {
      return {
        speaker: 'Wick',
        text: 'I\'ve been looking at the salt from up here for two years. Might as well walk on it. Yes.',
        choices: [{ id: 'ok', label: 'Bring the view.' }],
      };
    }
    return null;
  }

  openDoor(id: string, snap: boolean) {
    const d = this.doors.find((x) => x.id === id);
    if (!d) return;
    d.target = d.sign;
    if (snap) {
      d.open = d.sign;
      d.pivot.rotation.y = d.sign;
      d.solid = false;
      d.collider.setEnabled(false);
    }
  }

  private clearBlocker(id: string) {
    const b = this.blockers.find((x) => x.id === id);
    if (!b) return;
    b.obj.visible = false;
    b.collider.setEnabled(false);
  }

  update(dt: number, cam?: THREE.Vector3) {
    if (cam) for (const l of this.lods) l.update(cam);
    const s = this.ctx.state;
    if (s && !this.synced) {
      this.synced = true;
      if (s.has('creek.stair')) this.openDoor('closet', true);
      if (s.has('creek.motel.b')) this.openDoor('motelB', true);
      if (s.has('creek.motel.c')) this.clearBlocker('boards');
      if (s.has('cave.pocket')) this.clearBlocker('rockfall');
    }
    for (const d of this.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 7);
      d.pivot.rotation.y = d.open;
      const solid = Math.abs(d.target) < 0.2 && Math.abs(d.open) < 0.35;
      if (solid !== d.solid) { d.solid = solid; d.collider.setEnabled(solid); }
    }
    if (this.clinicGlow) {
      const on = !!s?.has('creek.power');
      const flicker = 0.85 + 0.15 * Math.sin(performance.now() / 180);
      this.clinicGlow.value = (on ? 3.4 : 0.25) * flicker;
    }
  }
}
