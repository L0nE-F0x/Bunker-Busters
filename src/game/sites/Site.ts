import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { DistanceLod, Frame } from '../world/kit';
import { LANDMARKS } from '@/content/world';

/**
 * A point of interest on the map (one class per site, registered in ./index.ts).
 *
 * Conventions every site follows, so story/quest code can hang off them without importing sites:
 * - Game sets `seen:<id>` when the player first walks within ~40 m (banner + XP).
 * - The site sets `site.<id>.found` when the player reaches its heart (inside the jet, the server hall…).
 * - The site sets `site.<id>.done` when its main secret is out (the thing worth the walk).
 * - Anything else is `site.<id>.<what>`.
 *
 * Performance rules (WebKitGTK is draw-call bound; see CLAUDE.md):
 * - Build static geometry through MeshBatch with factory materials (one draw per material family).
 * - Put the detailed set under a DistanceLod with `MeshBatch.buildFar()` as the stand-in (`lod()` below).
 * - Point lights are `VirtualLight`s (world/lights.ts), never `new THREE.PointLight`.
 */
export abstract class Site {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Feet positions the dev harness can teleport to (`game.sites.find(s => s.id === 'jet').spots`). */
  readonly spots: Record<string, THREE.Vector3> = {};
  readonly frame: Frame;
  protected readonly lods: DistanceLod[] = [];

  constructor(readonly id: string, protected ctx: GameContext, protected landmarks: Landmarks) {
    const lm = LANDMARKS.find((l) => l.id === id);
    if (!lm) throw new Error(`site ${id} has no LANDMARKS entry`);
    const [x, , z] = lm.position;
    this.frame = new Frame(x, ctx.hf.heightAt(x, z), z, lm.rotation);
    this.group.name = `site-${id}`;
    landmarks.group.add(this.group);
  }

  /** The run's state. Null on the title screen: only touch it from interactions and update(). */
  protected get s() {
    return this.ctx.state;
  }

  /** A world-space spot from site-local coordinates, remembered for the harness. */
  protected spot(name: string, lx: number, ly: number, lz: number) {
    const p = this.frame.p(lx, ly, lz);
    this.spots[name] = p;
    return p;
  }

  /** Register a near/far pair for this site (centre = site origin). */
  protected lod(near: THREE.Object3D, far: THREE.Object3D | null, radius: number, swap = 140) {
    this.lods.push(new DistanceLod(new THREE.Vector3(this.frame.x, this.frame.y, this.frame.z), radius, near, far, swap));
  }

  update(_dt: number, cam: THREE.Vector3) {
    for (const l of this.lods) l.update(cam);
  }
}
