import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import type { Physics } from '@/engine/physics';
import { box, MeshBatch } from '../../world/kit';
import { plainStandard, glow } from '../../world/materials';
import type { BunkerShell, Door, Laser, LootSpot, SecurityCamera, Tripwire } from '../shell';

/**
 * Apex Vault, GREYBOX. TODO(apex): this is the runtime's second shell, not the bunker. It has the
 * layout the data in content/bunkers/apex.ts expects (every point, door, laser, camera and loot
 * spot) as plain boxes in one batch. The real builder replaces it wholesale: art, dressing, a far
 * stand-in under a DistanceLod, a shadow proxy, VirtualLights for the inside, and the boot warm-up.
 *
 * Layout (local metres, +z = the front, toward the road):
 *   apron (grounds) x −20…20, z −16…18, a wall along z = 14 with the hangar door at x −2…2;
 *   the vault building x −6…6, z −14…0, 4 m high: the airlock in its front wall (x −1…1), a
 *   corridor with a low beam at z −3 and a high one at z −5, the breaker on the west wall, the vault
 *   door in a wall at z −9, and the cistern room behind it.
 */
export const APEX_GROUNDS = { x0: -20, x1: 20, z0: -16, z1: 18 };
export const APEX_HALL = { x0: -6, x1: 6, z0: -14, z1: 0, h: 4 };

export class ApexBuilder implements BunkerShell {
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
  readonly interior = new THREE.Group();

  constructor(private physics: Physics, origin: THREE.Vector3) {
    this.origin = origin.clone();
    this.group.position.copy(origin);
    this.group.name = 'apex';
    this.innerBox = new THREE.Box3(this.w(APEX_HALL.x0, 0, APEX_HALL.z0), this.w(APEX_HALL.x1, APEX_HALL.h, APEX_HALL.z1));
    this.groundsBox = new THREE.Box3(this.w(APEX_GROUNDS.x0, -2, APEX_GROUNDS.z0), this.w(APEX_GROUNDS.x1, 8, APEX_GROUNDS.z1));
    this.build();
  }

  w(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).add(this.origin);
  }

  /** A static wall: geometry in the batch and its collider. */
  private wall(b: MeshBatch, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, h: number) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
    b.add(mat, box(sx, h, sz, cx, h / 2, cz));
    this.physics.addBox(this.w(cx, h / 2, cz), { x: sx / 2, y: h / 2, z: sz / 2 });
  }

  /** A hinged door between x0 and x1 in a wall at z; hinge on x0. */
  private door(id: string, x0: number, x1: number, z: number, h: number, amount: number, mat: THREE.Material) {
    const pivot = new THREE.Group();
    pivot.position.set(x0, 0, z);
    const leaf = new THREE.Mesh(box(x1 - x0, h, 0.12, (x1 - x0) / 2, h / 2, 0), mat);
    leaf.castShadow = true;
    pivot.add(leaf);
    this.group.add(pivot);
    const pos = this.w((x0 + x1) / 2, h / 2, z), half = new THREE.Vector3((x1 - x0) / 2, h / 2, 0.1);
    this.doors[id] = { pivot, open: 0, target: 0, collider: this.physics.addBox(pos, half), axis: 'y', amount, colliderSpec: { pos, half } };
  }

  private build() {
    const b = new MeshBatch();
    const concrete = plainStandard('#8d8a84', 0.9);
    const steel = plainStandard('#6e747a', 0.45, 0.7);
    const H = APEX_HALL;

    // apron wall with the hangar door gap (x −2…2)
    this.wall(b, concrete, APEX_GROUNDS.x0, -2, 13.8, 14.2, 4);
    this.wall(b, concrete, 2, APEX_GROUNDS.x1, 13.8, 14.2, 4);
    this.door('hangar', -2, 2, 14, 3.6, 1.6, steel);
    this.points.hangar = this.w(0, 1.2, 14.6);

    // the vault building: front wall with the airlock (x −1…1), sides, back, roof slab
    this.wall(b, concrete, H.x0, -1, -0.2, 0.2, H.h);
    this.wall(b, concrete, 1, H.x1, -0.2, 0.2, H.h);
    b.add(concrete, box(2, H.h - 2.4, 0.4, 0, 2.4 + (H.h - 2.4) / 2, 0));
    this.wall(b, concrete, H.x0 - 0.2, H.x0, H.z0, H.z1, H.h);
    this.wall(b, concrete, H.x1, H.x1 + 0.2, H.z0, H.z1, H.h);
    this.wall(b, concrete, H.x0, H.x1, H.z0 - 0.2, H.z0, H.h);
    b.add(concrete, box(H.x1 - H.x0 + 0.4, 0.2, H.z1 - H.z0 + 0.4, 0, H.h + 0.1, (H.z0 + H.z1) / 2));
    this.door('airlock', -1, 1, 0, 2.4, -1.6, steel);
    this.points.airlock = this.w(0, 1.2, 0.7);
    this.points.speaker = this.w(-3, 4.6, 0.6);

    // vault wall at z −9 with its door (x −1…1)
    this.wall(b, concrete, H.x0, -1, -9.2, -8.8, H.h);
    this.wall(b, concrete, 1, H.x1, -9.2, -8.8, H.h);
    this.door('vault', -1, 1, -9, 2.4, -1.6, steel);
    this.points.vaultDoor = this.w(0, 1.2, -8.4);
    this.points.interior = this.w(0, 1, -4);

    // laser beams across the corridor (constant z), and the breaker that kills them
    const beam = (id: string, y: number, z: number) => {
      const u = uniform(7);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.colorNode = vec3(1, 0.08, 0.04).mul(u).mul(0.15);
      const g = new THREE.CylinderGeometry(0.02, 0.02, H.x1 - H.x0 - 0.6, 6, 1, true).rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, y, z);
      this.interior.add(mesh);
      this.lasers.push({ id, a: this.w(H.x0 + 0.3, y, z), b: this.w(H.x1 - 0.3, y, z), mesh, intensity: u as unknown as { value: number } });
    };
    beam('laser_low', 0.35, -3);
    beam('laser_high', 1.45, -5);
    b.add(steel, box(0.2, 0.7, 0.5, H.x0 + 0.1, 1.4, -1.5));
    this.points.breaker = this.w(H.x0 + 0.8, 1.4, -1.5);

    // cameras: one over the airlock watching the apron, one in the corridor watching the beams
    const cam = (id: string, x: number, y: number, z: number, yaw0: number, sweep: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(new THREE.Mesh(box(0.18, 0.16, 0.36, 0, 0, 0.1), steel));
      const lens = glow('#ff3020', 1);
      const l = new THREE.Mesh(box(0.06, 0.06, 0.02, 0, 0, 0.29), lens.material);
      pivot.add(l);
      (z < 0 ? this.interior : this.group).add(pivot);
      this.cameras.push({ id, pivot, eye: this.w(x, y, z + 0.3), yaw0, sweep, period: 7, range: 16, halfAngle: THREE.MathUtils.degToRad(28), lens: lens.intensity as unknown as { value: number } });
    };
    cam('cam_apron', 2.2, 3.4, 0.5, 0, 0.7);
    cam('cam_hall', H.x1 - 0.4, 3.2, -1, -Math.PI / 2 - 0.5, 0.35);

    // loot behind the vault door
    const crate = plainStandard('#3d5a40', 0.7, 0.3);
    for (const [id, x, z] of [['tank_a', -4, -12], ['tank_b', -2, -12.5], ['cistern', 4, -12]] as const) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.add(new THREE.Mesh(box(1.2, 1.2, 0.9, 0, 0.6, 0), id === 'cistern' ? steel : crate));
      let lid: THREE.Object3D | undefined;
      if (id !== 'cistern') {
        lid = new THREE.Group();
        lid.position.set(0, 1.2, -0.45);
        lid.add(new THREE.Mesh(box(1.22, 0.1, 0.92, 0, 0.05, 0.45), crate));
        g.add(lid);
      }
      this.interior.add(g);
      this.physics.addBox(this.w(x, 0.6, z), { x: 0.6, y: 0.6, z: 0.45 });
      this.lootSpots.push({ id, pos: this.w(x, 0.8, z + 0.9), mesh: g, lid });
    }

    this.group.add(b.build('apexGreybox'));
    this.interior.name = 'apex-interior';
    this.group.add(this.interior);
  }
}
