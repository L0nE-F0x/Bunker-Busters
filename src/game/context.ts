import type * as THREE from 'three/webgpu';
import type { GameState } from './State';
import type { AudioEngine } from '@/engine/audio';
import type { Physics } from '@/engine/physics';
import type { Player } from './player/Player';
import type { PostFX } from '@/engine/postfx';
import type { Atmosphere } from './world/Atmosphere';
import type { Heightfield } from './world/Heightfield';
import type { DustPuffs } from './world/effects';

export type LockResult = 'success' | 'abort' | 'out-of-picks';

/** A hack: the box, its daemons (payloads), and what got through. See `ui/Hack.ts`. */
export interface HackRequest {
  title: string;
  host: string;
  difficulty: number;
  daemons: { id: string; name: string; blurb: string }[];
  /** Offer to swipe a Recovery Lanyard first (a Kade box): +1 buffer, a slower trace. */
  kade?: boolean;
}
export interface HackOutcome {
  done: string[];
  traced: boolean;
  aborted: boolean;
}

/** What gameplay code is allowed to ask of the UI layer. */
export interface TalkChoiceView {
  id: string;
  label: string;
  /** Greyed out, with this reason. */
  disabled?: string;
  /** Where the conversation goes next. Empty ends it. Only used by converse(). */
  next?: string;
}

export interface UIBridge {
  lockpick(opts: { pins: number; title: string; onBreak: () => boolean }): Promise<LockResult>;
  keypad(opts: { title: string; code: string; hint: string }): Promise<'ok' | 'wrong' | 'abort'>;
  circuit(opts: { title: string; difficulty: number }): Promise<boolean>;
  /** SPLICE: pick daemons out of a code matrix before the trace lands. */
  hack(opts: HackRequest): Promise<HackOutcome>;
  /** One question, then back to the world. */
  choose(opts: { speaker: string; text: string; choices: TalkChoiceView[] }): Promise<string | null>;
  /** A whole conversation. `onChoice` runs before the next line, so flags land in time. */
  converse(opts: {
    start: string;
    node: (id: string) => { speaker: string; text: string; choices: TalkChoiceView[] } | null;
    onChoice: (nodeId: string, choiceId: string) => void;
  }): Promise<void>;
  banner(title: string, sub: string, kind?: 'good' | 'bad' | 'info'): void;
  subtitle(speaker: string, text: string, voice?: { pos?: THREE.Vector3; variant?: number }): void;
  /** A shop: Inez's Till (ui/Trader.ts). */
  till?(opts: { line: string; markup: number; offer: number }): Promise<void>;
}

export interface Action {
  label: string;
  /** true = available; string = shown greyed out with this reason */
  available: () => true | string;
  run: () => void | Promise<void>;
}

export interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  primary: Action;
  secondary?: Action;
  visible?: () => boolean;
}

export interface GameContext {
  state: GameState;
  audio: AudioEngine;
  physics: Physics;
  ui: UIBridge;
  player: Player;
  cam: { addTrauma(v: number): void };
  post: PostFX;
  atmo: Atmosphere;
  hf: Heightfield;
  scene: THREE.Scene;
  /** Kicked-up dust (landings, impacts). */
  puffs?: DustPuffs;
  /** Knock the player out and respawn them outside (used by drone zaps). */
  caught: (reason: string) => void;
}
