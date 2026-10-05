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

/** What gameplay code is allowed to ask of the UI layer. */
export interface UIBridge {
  lockpick(opts: { pins: number; title: string; onBreak: () => boolean }): Promise<LockResult>;
  keypad(opts: { title: string; code: string; hint: string }): Promise<'ok' | 'wrong' | 'abort'>;
  circuit(opts: { title: string; difficulty: number }): Promise<boolean>;
  banner(title: string, sub: string, kind?: 'good' | 'bad' | 'info'): void;
  subtitle(speaker: string, text: string): void;
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
