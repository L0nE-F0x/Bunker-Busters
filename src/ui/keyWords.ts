import { actionWord, binds, kbdGlyph, type Action } from '@/engine/bindings';
import { isTouch } from '@/engine/device';

/**
 * Controls named in prose (tutorial toasts, hints, the Garage's advice): the key actually bound, the
 * controller button when a pad was used last, or the on-screen button on touch, so nothing tells a
 * pad or phone player to press Tab, or a player who moved crouch off C to press C.
 *
 * Content strings can carry a control as a bracketed token, `(E)`, `(F)`, `(C)` …: `proseKeys` swaps
 * each for the control in use (`UI` runs toasts, prompts' reasons and item descriptions through it).
 */

/** The on-screen buttons (TouchControls draws icons, so they're named by what they are). */
const TOUCH: Partial<Record<Action, string>> = {
  interact: 'USE', alt: 'ALT', fire: 'FIRE', aim: 'AIM', reload: 'RELOAD', lastWeapon: 'SWAP',
  jump: 'the jump button', crouch: 'the crouch button', torch: 'the torch button',
  kit: 'the kit button', skills: 'the kit button', journal: 'the kit button', map: 'the map button',
  hotbar1: 'the EMP slot', hotbar2: 'the ration slot', hotbar3: 'the water slot', hotbar4: 'the medkit slot',
};

/** How to do `a` on the device in use, for a sentence: "C", "B", "Hold LB", "the crouch button". '' if nothing is bound. */
export function keyWord(a: Action): string {
  if (isTouch) return TOUCH[a] ?? '';
  const w = actionWord(a);
  return w === '—' ? '' : w;
}

/** "crouch (C)": a word with its control in brackets; just the word when there's no control to name. */
export function keyed(word: string, a: Action): string {
  const k = keyWord(a);
  return k ? `${word} (${k})` : word;
}

const ARROW = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

/** A minigame footer's keycap for a direction: the key moving that way is bound to (the arrows always work as well). */
export function moveCap(a: keyof typeof ARROW): string {
  return kbdGlyph(binds.keys(a).find((c) => !c.startsWith('Arrow')) ?? ARROW[a]);
}

/** Bracketed default keys in content → the action they stand for. */
const TOKENS: Record<string, Action> = { E: 'interact', F: 'alt', C: 'crouch', RMB: 'aim', LMB: 'fire', Space: 'jump', L: 'torch', Tab: 'kit', J: 'journal', M: 'map', K: 'skills' };
const TOKEN_RE = new RegExp(`\\((${Object.keys(TOKENS).join('|')})\\)`, 'g');

/** "(E)", "(C)", "(RMB)" … written into content → the control bound on the device in use. */
export function proseKeys(s: string): string {
  if (s.indexOf('(') < 0) return s;
  return s.replace(TOKEN_RE, (m, k: string) => {
    const w = keyWord(TOKENS[k]);
    return w ? `(${w})` : '';
  }).replace(/ {2,}/g, ' ').replace(/ ([.,;:])/g, '$1');
}
