import type { Settings, SubSize, SubBg } from './State';
import type { Input } from '@/engine/input';
import type { AudioEngine } from '@/engine/audio';
import type { Action } from '@/engine/bindings';
import { comfort, CALM_FLASH } from '@/engine/comfort';
import { displayGamma } from '@/engine/postfx';

/** Subtitle and dialogue text scale per size (styles.css reads `--sub-k`). */
export const SUB_SCALE: Record<SubSize, number> = { small: 0.85, medium: 1, large: 1.25, xl: 1.55 };
/** The box behind subtitles (styles.css reads `--sub-bg`). */
export const SUB_ALPHA: Record<SubBg, number> = { none: 0, light: 0.55, dark: 0.8, solid: 0.94 };

/**
 * Settings → the comfort and accessibility options, applied live: the voice level, brightness,
 * subtitle look, camera shake, Reduce flashing and the hold/toggle keys. Cheap and idempotent:
 * Game calls it at boot and on every settings change.
 */
export function applyAccess(s: Settings, input: Input, audio: AudioEngine) {
  audio.setVolumes({ voice: s.voiceVol });
  displayGamma.value = 1 / s.brightness;
  comfort.shake = s.shake;
  comfort.calm = s.reduceFlash;
  comfort.flash = s.reduceFlash ? CALM_FLASH : 1;
  const t: Action[] = [];
  if (s.toggleCrouch) t.push('crouch');
  if (s.toggleSprint) t.push('sprint');
  if (s.toggleAim) t.push('aim');
  input.setToggles(t);
  const root = document.documentElement;
  root.style.setProperty('--sub-k', String(SUB_SCALE[s.subSize] ?? 1));
  root.style.setProperty('--sub-bg', String(SUB_ALPHA[s.subBg] ?? 0.55));
}
