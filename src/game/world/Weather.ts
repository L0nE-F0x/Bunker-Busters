import type { Atmosphere } from './Atmosphere';
import { clamp, damp } from '@/engine/noise';

export type WeatherPhase = 'calm' | 'front' | 'storm' | 'clearing';

/**
 * Dust storms. Calm for a few minutes, then a brown wall rises on the upwind horizon (`front`), rolls
 * over the player (`storm` → visibility ~60 m, howling wind, streaming sand), holds a while and clears.
 * Everything visual reads two numbers off the Atmosphere (`storm`, `front`), so the effect costs
 * uniforms, not meshes.
 *
 * Debug: `game.weather.storm(1)` (hold at full strength, `storm(0.5, true)` = jump there instantly),
 * `game.weather.rollIn()` (play a natural storm now), `game.weather.auto()`. URL: `?storm` / `?storm=0.6`.
 */
export class Weather {
  /** Storm strength 0..1 (smoothed). */
  intensity = 0;
  /** How visible the approaching dust wall on the horizon is, 0..1. */
  front = 0;
  phase: WeatherPhase = 'calm';
  /** Called when a phase starts (for toasts / audio cues). */
  onPhase?: (p: WeatherPhase) => void;
  /** Dry lightning inside a thick storm: `k` 0..1 = how close (bright flash, loud and soon thunder). */
  onLightning?: (k: number) => void;
  /** Current lightning flash brightness (0 most of the time). */
  flash = 0;
  private strikeIn = 12;
  private flicker: number[] = []; // remaining flash pulses: [delay, strength, ...]

  private timer: number;
  private phaseLen = 1;
  private peak = 1;
  private manual: number | null = null;

  constructor(private atmo: Atmosphere) {
    this.timer = 200 + Math.random() * 160; // first storm 3.5–6 min into a session
    const q = new URLSearchParams(location.search).get('storm');
    if (q !== null) this.storm(q === '' ? 1 : clamp(parseFloat(q) || 0, 0, 1), true);
  }

  /** Debug/scripted: hold the storm at `v` (0..1). `instant` skips the build-up. */
  storm(v = 1, instant = false) {
    this.manual = clamp(v, 0, 1);
    if (instant) { this.intensity = this.manual; this.front = 0; }
    this.phase = this.manual > 0.05 ? 'storm' : 'calm';
  }

  /** Back to the automatic schedule. */
  auto() {
    this.manual = null;
    if (this.phase === 'storm') this.setPhase('clearing', 40);
  }

  /** Start a natural storm cycle right now (front on the horizon first). */
  rollIn() {
    this.manual = null;
    this.setPhase('front', 50);
  }

  /** 0..1 how far the air lets you (and the drone) see; 1 = clear. */
  get visibility() {
    return this.atmo.visibility;
  }

  private setPhase(p: WeatherPhase, len: number) {
    this.phase = p;
    this.timer = len;
    this.phaseLen = len;
    if (p === 'storm') this.peak = 0.75 + Math.random() * 0.25;
    this.onPhase?.(p);
  }

  /** Debug: strike now. */
  strike(k = 0.5 + Math.random() * 0.5) {
    // a stroke is a few rapid pulses, the first the brightest
    this.flicker = [0, k, 0.07 + Math.random() * 0.05, k * 0.55, 0.09 + Math.random() * 0.12, k * 0.8];
    if (Math.random() < 0.5) this.flicker.push(0.2 + Math.random() * 0.2, k * 0.35);
    this.onLightning?.(k);
  }

  private updateLightning(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 9);
    if (this.flicker.length) {
      this.flicker[0] -= dt;
      if (this.flicker[0] <= 0) {
        this.flash = Math.max(this.flash, this.flicker[1]);
        this.flicker.splice(0, 2);
      }
    }
    if (this.intensity < 0.55) { this.strikeIn = Math.max(this.strikeIn, 6); return; }
    this.strikeIn -= dt;
    if (this.strikeIn <= 0) {
      this.strikeIn = 9 + Math.random() * 22;
      this.strike(0.25 + Math.random() * 0.75);
    }
  }

  /** `scheduled` = false keeps the automatic cycle paused (title screen, menus). */
  update(dt: number, scheduled: boolean) {
    let target = 0, frontTarget = 0;
    if (this.manual !== null) {
      target = this.manual;
    } else {
      if (scheduled || this.phase !== 'calm') this.timer -= dt;
      const k = 1 - this.timer / this.phaseLen; // phase progress 0..1
      switch (this.phase) {
        case 'calm':
          if (this.timer <= 0) this.setPhase('front', 45 + Math.random() * 20);
          break;
        case 'front':
          frontTarget = clamp(k * 2.2, 0, 1);
          target = k > 0.7 ? 0.35 : 0.06;
          if (this.timer <= 0) this.setPhase('storm', 90 + Math.random() * 90);
          break;
        case 'storm':
          target = this.peak * (0.85 + 0.15 * Math.sin(this.timer * 0.21));
          frontTarget = clamp(1 - k * 6, 0, 1);
          if (this.timer <= 0) this.setPhase('clearing', 35);
          break;
        case 'clearing':
          target = 0;
          if (this.timer <= 0) this.setPhase('calm', 420 + Math.random() * 300);
          break;
      }
    }
    // storms build faster than they clear
    const rate = target > this.intensity ? 0.09 : 0.05;
    this.intensity = clamp(this.intensity + clamp(target - this.intensity, -rate * dt, rate * dt), 0, 1);
    this.front = damp(this.front, frontTarget, 0.6, dt);
    this.updateLightning(dt);
    this.atmo.storm = this.intensity;
    this.atmo.flash = this.flash;
    this.atmo.stormFront = this.front;
  }
}
