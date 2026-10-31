import { padName } from '@/engine/bindings';
import { isTouch } from '@/engine/device';
import { keyed, keyWord } from '@/ui/keyWords';

/**
 * The first hour's nudges (toasts, unvoiced), in the controls actually bound: keys, the pad's buttons
 * when one was used last, or the on-screen buttons on touch. Built when shown, so a rebind or a pad
 * picked up mid-run is what they name.
 */

const up = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const pad = () => document.documentElement.classList.contains('pad');
const list = (pairs: [string, string][]) => pairs.filter(([k]) => k).map(([k, what]) => `${k} ${what}`).join(' · ');

export const TUT = {
  /** Straight after the briefing: where the menus are (Mara used to read the keys out on the radio). */
  menus(): string {
    if (isTouch) return 'Top right: the torch, pause, your kit (skills and the journal are in it) and the map.';
    if (pad()) return `${list([[keyWord('kit'), 'kit, skills and journal'], [keyWord('map'), 'map'], [padName('P9'), 'pause']])}.`;
    return `${list([[keyWord('kit'), 'kit'], [keyWord('skills'), 'skills'], [keyWord('journal'), 'journal'], [keyWord('map'), 'map'], ['Esc', 'pause']])}.`;
  },
  thirst: () => `Your WATER bar is going down, and food won't fill it. ${up(keyed('drink from the hotbar', 'hotbar3'))}.`,
  dry: () => `You're dehydrated and losing health. ${up(keyed('drink something', 'hotbar3'))}.`,
  hungry: () => `You're getting hungry. ${up(keyed('eat a ration', 'hotbar2'))}.`,
  heavy: () => `You're overloaded and down to seventy percent speed. Drop something from your ${keyed('kit', 'kit')}.`,
  /** The run starts at dusk: the first dark says where the light is. */
  torch: () => (isTouch
    ? 'It\'s dark. The torch button (top right) is your light, and anything watching sees it too.'
    : `It's dark. Your ${keyed('torch', 'torch')} lights the way, and anything watching sees it too.`),
};
