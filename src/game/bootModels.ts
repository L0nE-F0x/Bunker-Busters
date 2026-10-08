import { prefetchModels } from '@/engine/models';
import { NPC_MODELS, NPC_PROPS } from './world/npcSkin';

/**
 * Start downloading every model the boot will load, in the order it loads them: the wolf, snake and
 * scorpion (Fauna, at "scattering debris"), then the townsfolk with their head props, then Kade's
 * contractor kit. Called first thing at boot, so the network runs while the renderer starts and the
 * world is built. The A/B flags that keep the procedural versions skip their downloads.
 */
export function prefetchBootModels() {
  const q = new URLSearchParams(location.search);
  const skip = new Set((q.get('skip') ?? '').split(','));
  const names: string[] = [];
  if (!skip.has('fauna') && !q.has('procwolf')) {
    names.push('wolf');
    if (!q.has('procfauna')) names.push('rattlesnake', 'scorpion');
  }
  if (!q.has('procnpc')) for (const id of NPC_MODELS) names.push(id, ...(NPC_PROPS[id] ? [NPC_PROPS[id].file] : []));
  if (!q.has('prochuman')) names.push('contractor', 'hardhat', 'respirator');
  prefetchModels(names);
}
