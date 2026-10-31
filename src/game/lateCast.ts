import * as THREE from 'three/webgpu';
import { modelBytes, modelProgress, modelFailures, retryModels, type ModelError } from '@/engine/models';
import { NPC_PROPS, type NpcModels } from './world/npcSkin';
import { LATE_NPCS } from './bootModels';

/**
 * The late cast: the owners and staff of Tiers 2–8 (Ezra and the reviewers, Prudence and Benny,
 * Hunter, Gil and the Helpers, Orrin and the associates, Kit and the technicians, Agnes), who live
 * hundreds of metres from the camp. In the browser they download behind the boot's models (during
 * the shader compile) and are unpacked one a frame while the title is up, then placed (the bunkers'
 * `addPeople`, the Dome's and Cathedral's afterwards) in a dip to black, and their shaders warmed in
 * one frame. A run doesn't start until they're in (Continue can land anywhere): `ready()` with a short
 * readout if it's still going. The desktop app's files are local, so there it all happens at boot,
 * before the boot's warm-up, as it always did (`now()`).
 */
export type LateStage = 'downloading' | 'unpacking' | 'placing' | 'ready' | 'failed';

export interface LateHooks {
  /** The boot's NpcModels (the late ones join it); null: no models at all (?procnpc, or none loaded). */
  models: NpcModels | null;
  /** The bunkers' people and the afterwards' (Game.placeLateCast). */
  place(models: NpcModels | null): void;
  /** Warm these on one frame's render; resolves after it. */
  warm(roots: THREE.Object3D[]): Promise<void>;
  /** A good moment for a hitch: the title's dip to black, or not on the title at all. */
  quiet(): boolean;
  scene: THREE.Scene;
}

const files = () => LATE_NPCS.flatMap((id) => [id, ...(NPC_PROPS[id] ? [NPC_PROPS[id].file] : [])]);
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class LateCast {
  stage: LateStage = 'downloading';
  failures: ModelError[] = [];
  private hurried = false;
  private done: Promise<void> | null = null;
  private settle: { resolve: () => void } | null = null;
  private failWait: ((go: 'retry' | 'skip') => void) | null = null;

  constructor(private h: LateHooks) {}

  /** Bytes still to come for the late cast (the readout). */
  progress() {
    return modelProgress(files());
  }

  /** At boot, before the warm-up (the desktop app, ?latecast=boot): load and place everything now. */
  async now() {
    if (this.h.models) {
      this.stage = 'unpacking';
      await this.h.models.add(LATE_NPCS);
    }
    this.h.place(this.h.models);
    this.stage = 'ready';
    this.done = Promise.resolve();
  }

  /** In the background, from the title on (the browser). */
  start() {
    if (!this.h.models) return this.now();
    this.done = new Promise<void>((resolve) => { this.settle = { resolve }; });
    void this.run();
    return this.done;
  }

  /** The run wants to start: stop waiting for a quiet moment. */
  hurry() {
    this.hurried = true;
  }

  /** Placed and warmed. */
  get isReady() {
    return this.stage === 'ready';
  }

  /** Resolves once placed and warmed (after a failure, once the player has chosen what to do). */
  ready() {
    this.hurry();
    return this.done ?? Promise.resolve();
  }

  /** After a failure: download the missing files again, or carry on without them. */
  resolveFailure(go: 'retry' | 'skip') {
    const f = this.failWait;
    this.failWait = null;
    f?.(go);
  }

  private async run() {
    const models = this.h.models!;
    // every file in (or given up on) before anything is placed: placing happens once
    for (;;) {
      this.stage = 'downloading';
      await Promise.allSettled(files().map((n) => modelBytes(n)));
      this.failures = modelFailures(files());
      if (!this.failures.length) break;
      this.stage = 'failed';
      const go = await new Promise<'retry' | 'skip'>((r) => { this.failWait = r; });
      if (go === 'skip') break;
      retryModels(this.failures.map((f) => f.model));
      this.failures = [];
    }
    // unpack one person a frame (a model parse plus the clips' bookkeeping: ~20-60 ms each)
    this.stage = 'unpacking';
    await models.add(LATE_NPCS, frame);
    // place them in a dip to black (or now, if a run is waiting)
    this.stage = 'placing';
    while (!this.hurried && !this.h.quiet()) await frame();
    const before = new Set<THREE.Object3D>();
    this.h.scene.traverse((o) => { before.add(o); });
    this.h.place(models);
    const roots: THREE.Object3D[] = [];
    this.h.scene.traverse((o) => { if (!before.has(o) && (!o.parent || before.has(o.parent))) roots.push(o); });
    if (roots.length) await this.h.warm(roots);
    this.stage = 'ready';
    this.settle?.resolve();
  }
}
