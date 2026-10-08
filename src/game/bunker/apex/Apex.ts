import { Bunker } from '../Bunker';
import { ApexBuilder } from './ApexBuilder';
import { APEX } from '@/content/bunkers/apex';
import type { GameContext } from '../../context';

/**
 * Tier 2, Apex Vault: SKELETON, not in the game. Everything it does comes from the bunker runtime
 * and content/bunkers/apex.ts; the shell is a greybox (ApexBuilder). Nothing constructs it but the
 * dev harness (`await import('/src/game/bunker/apex/Apex.ts')` then `new Apex(game.ctx)`).
 *
 * TODO(apex), before it goes in front of players:
 * - the real builder and a place west of the salt (see the list in content/bunkers/apex.ts);
 * - Vesper on an intercom: a `talk()` with her own dialogue tree (content/dialogue.ts pattern);
 * - a patrol layer: Kade contractors or Hornets around the apron (combat/Recovery), registered as
 *   hostiles, and `guard()` for any drone;
 * - SPLICE daemons beyond the defaults (`onDaemon`): e.g. a door that posts your face;
 * - lights in `updateLights` (alarm colours) and an `objective()` worth reading;
 * - Game wiring: construct before the shader warm-up, `interactables`, `update`/`cull`, interiors,
 *   `exteriorRoots`, the map marker, `emp`, Story's `bunkerComplete` handling.
 */
export class Apex extends Bunker<ApexBuilder> {
  constructor(ctx: GameContext) {
    super(ctx, APEX, (origin) => new ApexBuilder(ctx.physics, origin));
    this.init();
  }

  override objective(): string {
    if (this.complete) return '';
    if (this.isOpen('vault')) return 'The cistern room. Take the water.';
    if (this.playerInside) return this.lasers?.off ? 'The vault door. Six pins, or a charge.' : 'Beams in the corridor. Jump the low one, crouch the high one, or find the breaker.';
    if (this.isOpen('hangar')) return 'The airlock. Her cameras watch the apron.';
    return '';
  }
}
