import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';

/** Starlite Drive-In. Placeholder until its build pass lands. */
export class DriveInSite extends Site {
  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('drivein', ctx, landmarks);
  }
}
