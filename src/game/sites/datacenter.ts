import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';

/** ColdStorage, an abandoned data centre. Placeholder until its build pass lands. */
export class DataCenterSite extends Site {
  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('datacenter', ctx, landmarks);
  }
}
