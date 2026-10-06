import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { Site } from './Site';

/** The Tube, a hyperloop test track. Placeholder until its build pass lands. */
export class TubeSite extends Site {
  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('tube', ctx, landmarks);
  }
}
