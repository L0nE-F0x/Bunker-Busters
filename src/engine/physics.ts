import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

/** Thin wrapper around a Rapier world with helpers for static colliders and queries. */
export class Physics {
  world!: InstanceType<Rapier['World']>;
  R!: Rapier;

  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  /** Static oriented box. `pos` is the centre; `half` are half extents; `rotY` radians about Y. */
  addBox(pos: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }, rotY = 0) {
    const R = this.R;
    const desc = R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(pos.x, pos.y, pos.z);
    if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    return this.world.createCollider(desc);
  }

  addCylinder(pos: { x: number; y: number; z: number }, halfHeight: number, radius: number) {
    const desc = this.R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(pos.x, pos.y, pos.z);
    return this.world.createCollider(desc);
  }

  addBall(pos: { x: number; y: number; z: number }, radius: number) {
    return this.world.createCollider(this.R.ColliderDesc.ball(radius).setTranslation(pos.x, pos.y, pos.z));
  }

  /** Returns distance to first hit or null. */
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    exclude?: InstanceType<Rapier['Collider']>,
  ): number | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  step() {
    this.world.step();
  }
}
