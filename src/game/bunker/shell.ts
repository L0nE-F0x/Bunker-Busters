import type * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';

/**
 * What a bunker builder hands the runtime (`Bunker.ts`): the handles to every gameplay piece.
 * Builders own geometry, colliders, lights and their LOD; the runtime owns the rules. Every
 * position is in world space; `origin` is the builder's local (0,0,0).
 */

type Collider = ReturnType<Physics['addBox']>;

/** A hinged (or sliding) door. The runtime eases `open` toward `target` and owns the collider. */
export interface Door {
  pivot: THREE.Object3D;
  open: number;
  target: number;
  collider: Collider | null;
  axis: 'y' | 'slide';
  /** Rotation (radians) at fully open. */
  amount: number;
  colliderSpec: { pos: THREE.Vector3; half: THREE.Vector3 };
}

/** A tin-can tripwire from `a` to `b` (feet height). `mesh.visible` is the builder's to honour. */
export interface Tripwire { id: string; a: THREE.Vector3; b: THREE.Vector3; mesh: THREE.Object3D; armed: boolean }

/** A horizontal laser beam across a hall at constant z, from `a.x` to `b.x`, height `a.y`. */
export interface Laser { id: string; a: THREE.Vector3; b: THREE.Vector3; mesh: THREE.Mesh; intensity: { value: number } }

/** A container the runtime fills from the loot table. `lid` (optional) swings open by -1.9 rad about x. */
export interface LootSpot { id: string; pos: THREE.Vector3; mesh: THREE.Object3D; lid?: THREE.Object3D }

/**
 * A security camera: `pivot` yaws to sweep (its rotation.y is the runtime's), `eye` is the lens in
 * world space. It looks along `yaw0` ± `sweep`, sees `range` metres in a ±`halfAngle` cone, and
 * `lens.value` is its LED (0 off, 1 idle, 2 tracking).
 */
export interface SecurityCamera {
  id: string;
  pivot: THREE.Object3D;
  eye: THREE.Vector3;
  yaw0: number;
  sweep: number;
  /** Seconds per full sweep. */
  period: number;
  range: number;
  halfAngle: number;
  lens: { value: number };
}

export interface BunkerShell {
  group: THREE.Group;
  origin: THREE.Vector3;
  /** Named places (interactables, sounds, where alarms send drones). */
  points: Record<string, THREE.Vector3>;
  doors: Record<string, Door>;
  /** The sealed inside: lasers, "inside" for drones and the objective, interior mode. */
  innerBox: THREE.Box3;
  /**
   * A tighter "inside" than `innerBox` for buildings that aren't boxes (the Panopticon's drum: its
   * box's corners are outdoors). `margin` grows it (metres). Used for `playerInside`, interior
   * mode and the inside-only draws when present.
   */
  contains?(p: THREE.Vector3, margin?: number): boolean;
  /** The compound around it (yard). */
  groundsBox: THREE.Box3;
  tripwires: Tripwire[];
  lasers: Laser[];
  cameras?: SecurityCamera[];
  lootSpots: LootSpot[];
  /** Meshes hidden once their entry is open (a padlock), by `BunkerEntryDef.lockMesh`. */
  lockMeshes?: Record<string, THREE.Object3D>;
  /** Draws only visible from inside or through an open portal (`Bunker.cull` hides the group). */
  interior?: THREE.Object3D;
  /** Near/far swap, driven from `Bunker.cull`. */
  lod?: { update(cam: THREE.Vector3): void };
  /** local → world */
  w(x: number, y: number, z: number): THREE.Vector3;
}
