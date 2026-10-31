import { prefetchModels } from '@/engine/models';
import { NPC_MODELS, NPC_PROPS } from './world/npcSkin';

/**
 * Who the boot builds before the title: the camp's four (the title's shots and the first minute),
 * Dry Creek's six, and Noor and Ada, who end up in Dry Creek's crowd (built at boot, so their models
 * have to be in by then). Everyone else, the owners and staff of Tiers 2–8 hundreds of metres away,
 * is the late cast (game/lateCast.ts): fetched behind these and placed while the title is up.
 */
export const BOOT_NPCS: readonly string[] = ['mara', 'hollis', 'pip', 'dez', 'nia', 'doc', 'inez', 'sol', 'ren', 'wick', 'noor', 'ada'];
export const LATE_NPCS: readonly string[] = NPC_MODELS.filter((id) => !BOOT_NPCS.includes(id));

const withProps = (ids: readonly string[]) => ids.flatMap((id) => [id, ...(NPC_PROPS[id] ? [NPC_PROPS[id].file] : [])]);

/** The models the boot itself waits for (before the title), in the order it parses them. */
export function bootModelNames(): string[] {
  const q = new URLSearchParams(location.search);
  const skip = new Set((q.get('skip') ?? '').split(','));
  const names: string[] = [];
  if (!skip.has('fauna') && !q.has('procwolf')) {
    names.push('wolf');
    if (!q.has('procfauna')) names.push('rattlesnake', 'scorpion');
  }
  if (!q.has('procnpc')) names.push(...withProps(BOOT_NPCS));
  if (!q.has('prochuman')) names.push('contractor', 'hardhat', 'respirator');
  return names;
}

/**
 * Start downloading every model, in the order the boot parses them: the wolf, snake and scorpion
 * (Fauna, at "scattering debris"), the boot's townsfolk with their head props, Kade's contractor kit,
 * then the late cast (which downloads while the shaders compile). Called first thing at boot, so the
 * network runs while the renderer starts and the world is built. The A/B flags that keep the
 * procedural versions skip their downloads.
 */
export function prefetchBootModels() {
  const names = bootModelNames();
  if (!new URLSearchParams(location.search).has('procnpc')) names.push(...withProps(LATE_NPCS).filter((n) => !names.includes(n)));
  prefetchModels(names);
}
