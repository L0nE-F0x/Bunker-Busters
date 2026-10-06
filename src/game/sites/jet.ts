import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';

/** The Exit Strategy, a crashed founder's private jet. Placeholder until its build pass lands. */
export class JetSite extends Site {
  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('jet', ctx, landmarks);
  }
}
