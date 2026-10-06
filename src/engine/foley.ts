import type { Surface } from './surface';

/**
 * Footsteps by surface. Each step is two or three short layers from the shared noise buffer: a
 * heel knock (the body's weight), the surface's own voice (sand's soft hiss, gravel's crunch,
 * wood's hollow boom, metal's ring) and a toe scuff. Everything is randomised a little so no two
 * steps match. Crouched steps roll the foot: slower attack, darker, no scuff. Landings put both
 * feet down hard, a beat apart.
 */
export type StepKind = 'step' | 'jump' | 'land';
export interface StepOpts { kind?: StepKind; crouch?: boolean; sprint?: boolean }

interface Env { ctx: AudioContext; noise: AudioBuffer; dest: AudioNode }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const vary = (v: number, k = 0.12) => v * (1 + (Math.random() * 2 - 1) * k);

function noise(e: Env, t: number, type: BiquadFilterType, f: number, q: number, peak: number, atk: number, dec: number) {
  const ctx = e.ctx;
  const s = ctx.createBufferSource();
  s.buffer = e.noise;
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = vary(f);
  b.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vary(peak, 0.15)), t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  s.connect(b).connect(g).connect(e.dest);
  s.start(t, Math.random() * 3.5, atk + dec + 0.04);
}

function ring(e: Env, t: number, f: number, peak: number, dec: number, type: OscillatorType = 'sine') {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  o.connect(g).connect(e.dest);
  o.start(t);
  o.stop(t + dec + 0.02);
}

/** A loose board complaining: a slow wobbling squeak, rare. */
function creak(e: Env, t: number, peak: number) {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = rand(420, 640);
  const d = rand(0.18, 0.34);
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * rand(1.15, 1.35), t + d * 0.6);
  o.frequency.linearRampToValueAtTime(f * rand(0.95, 1.1), t + d);
  const b = ctx.createBiquadFilter();
  b.type = 'bandpass';
  b.frequency.value = f * 2;
  b.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + d * 0.3);
  g.gain.linearRampToValueAtTime(0, t + d);
  o.connect(b).connect(g).connect(e.dest);
  o.start(t);
  o.stop(t + d + 0.02);
}

/**
 * One foot on `surface`. `k` is the stride intensity from the camera (0.15 crouched … 1.2 sprint).
 */
export function footstep(e: Env, surface: Surface, k: number, o: StepOpts = {}) {
  const t = e.ctx.currentTime + 0.003;
  const crouch = !!o.crouch;
  const jump = o.kind === 'jump';
  // crouched: the foot rolls down instead of landing; softer, slower, darker
  const atk = crouch ? 2.2 : 1;
  const bright = crouch ? 0.6 : 1;
  const scuff = jump ? 1.8 : crouch ? 0 : o.sprint ? 1.3 : 1;
  const heel = jump ? 0.5 : 1;
  switch (surface) {
    case 'sand':
      noise(e, t, 'lowpass', 160, 1, 0.2 * k * heel, 0.006 * atk, 0.07);
      noise(e, t, 'bandpass', 1300 * bright, 0.7, 0.2 * k, 0.012 * atk, 0.08);
      if (scuff) noise(e, t + 0.018, 'highpass', 3600, 0.5, 0.085 * k * scuff, 0.016, 0.09);
      break;
    case 'gravel': {
      noise(e, t, 'lowpass', 190, 1, 0.22 * k * heel, 0.005 * atk, 0.06);
      // a crunch is a handful of stones shifting: tiny bursts a few ms apart
      const n = crouch ? 2 : 3 + Math.floor(Math.random() * 3);
      let tt = t;
      for (let i = 0; i < n; i++) {
        noise(e, tt, 'bandpass', rand(1700, 3800) * bright, 1.6, rand(0.14, 0.24) * k, 0.002 * atk, rand(0.012, 0.024));
        tt += rand(0.011, 0.03) * atk;
      }
      if (scuff) noise(e, tt, 'highpass', 4000, 0.6, 0.04 * k * scuff, 0.01, 0.05);
      break;
    }
    case 'rock':
      noise(e, t, 'lowpass', 230, 1, 0.24 * k * heel, 0.003 * atk, 0.05);
      noise(e, t, 'bandpass', 2300 * bright, 1.5, 0.18 * k, 0.0015 * atk, 0.025);
      if (scuff) noise(e, t + 0.012, 'highpass', 4200, 0.6, 0.05 * k * scuff, 0.008, 0.06);
      break;
    case 'asphalt':
      noise(e, t, 'lowpass', 300, 1, 0.28 * k * heel, 0.003 * atk, 0.045);
      noise(e, t, 'bandpass', 1400 * bright, 1.1, 0.08 * k, 0.002 * atk, 0.03);
      if (scuff) noise(e, t + 0.026, 'bandpass', 2800, 0.8, 0.08 * k * scuff, 0.008, 0.055);
      break;
    case 'concrete':
      noise(e, t, 'lowpass', 300, 1.2, 0.27 * k * heel, 0.0025 * atk, 0.04);
      noise(e, t, 'bandpass', 1750 * bright, 2, 0.2 * k, 0.0015 * atk, 0.022);
      if (scuff) noise(e, t + 0.03, 'highpass', 3000, 0.6, 0.05 * k * scuff, 0.006, 0.04);
      break;
    case 'wood':
      // a board over a void: two hollow resonances under a dull knock
      noise(e, t, 'bandpass', 210, 5, 0.5 * k * heel, 0.003 * atk, 0.11);
      noise(e, t, 'bandpass', 470, 6, 0.24 * k, 0.003 * atk, 0.08);
      noise(e, t, 'lowpass', 650 * bright, 1, 0.14 * k, 0.002 * atk, 0.03);
      if (scuff) noise(e, t + 0.024, 'bandpass', 2400, 0.9, 0.035 * k * scuff, 0.008, 0.04);
      if (!crouch && Math.random() < 0.07) creak(e, t + 0.04, 0.02 * k);
      break;
    case 'metal': {
      // sheet or plate: a thump plus a short inharmonic ring
      noise(e, t, 'lowpass', 220, 1, 0.24 * k * heel, 0.003 * atk, 0.06);
      const f0 = rand(360, 470);
      const r = crouch ? 0.5 : 1;
      ring(e, t, f0, 0.025 * k * r, 0.22 * r);
      ring(e, t, f0 * rand(2.35, 2.5), 0.015 * k * r, 0.16 * r);
      ring(e, t, f0 * rand(3.8, 4.05), 0.009 * k * r, 0.1 * r);
      noise(e, t, 'bandpass', 2600 * bright, 3, 0.06 * k, 0.0015 * atk, 0.05);
      if (scuff) noise(e, t + 0.02, 'highpass', 3400, 0.6, 0.04 * k * scuff, 0.006, 0.05);
      break;
    }
  }
}

/** Both feet down after a fall or a jump. `k` 0..1 = how hard. */
export function landing(e: Env, surface: Surface, k: number) {
  const t = e.ctx.currentTime + 0.003;
  // the body's weight, felt more than heard
  noise(e, t, 'lowpass', 140, 1, 0.55 * k + 0.12, 0.004, 0.16 + k * 0.08);
  // the surface takes both feet, a beat apart
  footstep(e, surface, 0.7 + k * 0.7, { kind: 'step' });
  const t2 = t + rand(0.02, 0.04);
  switch (surface) {
    case 'sand':
    case 'gravel':
      // a spray of grit settling
      noise(e, t2, 'highpass', 2600, 0.5, 0.05 + 0.1 * k, 0.03, 0.22 + k * 0.1);
      break;
    case 'wood':
      noise(e, t2, 'bandpass', 160, 4, 0.3 + 0.4 * k, 0.004, 0.18);
      break;
    case 'metal':
      ring(e, t2, rand(250, 320), 0.05 + 0.05 * k, 0.4);
      ring(e, t2, rand(640, 760), 0.025 + 0.03 * k, 0.28);
      break;
    default:
      noise(e, t2, 'bandpass', 1200, 1.2, 0.12 + 0.16 * k, 0.003, 0.05);
  }
}
