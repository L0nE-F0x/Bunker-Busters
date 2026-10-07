/**
 * Positional ambience: one synthesised voice per `AmbientKind`, played from a spot in the world.
 *
 * Every voice is a handful of native nodes fed from the engine's shared noise buffer (no samples, no
 * worklets). Spots are distance-gated by `SpotManager`: a spot builds its nodes when the listener
 * comes within its `range`, fades in over the last 30% of it, and tears everything down (sources
 * stopped, panner disconnected) once the listener walks out again. Far spots cost a distance check.
 *
 * Intermittent sounds (drips, crackles, babble, arcs) are scheduled from `tick()` with a short
 * lookahead on the audio clock, so they stop by themselves when a spot goes quiet.
 */

export type AmbientKind =
  | 'drone' | 'fire' | 'neon' | 'generator'
  | 'drip' | 'hum' | 'wind-hollow' | 'radio' | 'projector' | 'crowd' | 'sparks' | 'flies';

export interface VoiceEnv {
  ctx: BaseAudioContext;
  /** Shared 4 s stereo pink noise. */
  noise: AudioBuffer;
  /** Shared 2 s of sparse clicks (sparks, sand on metal). */
  crackle: AudioBuffer;
  /** Per-engine cache for buffers a voice renders once (projector clatter). */
  cached(key: string, make: (ctx: BaseAudioContext) => AudioBuffer): AudioBuffer;
  /** Weather wind strength (about 0.5 calm … 3 in a storm). */
  wind(): number;
  /** The current gust swell 0..1 (follows the weather's own gusts). */
  gust(): number;
}

export interface Voice {
  /** Schedule events that start before `until` (audio-clock seconds). Called every frame while near. */
  tick?(now: number, until: number): void;
  setPitch?(mult: number, t: number): void;
  stop(when: number): void;
}

export interface VoiceSpec {
  /** Beyond this (metres) the spot is silent and has no nodes. */
  range: number;
  /** PannerNode refDistance / rolloffFactor (inverse model). */
  ref: number;
  rolloff: number;
  /** HRTF for small point sources; equal-power for broad ones (cheaper). */
  hrtf: boolean;
  /** Default output gain (callers may change it with `setGain`). */
  gain: number;
  build(env: VoiceEnv, out: GainNode): Voice;
}

// ------------------------------------------------------------------ helpers
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

class Sources {
  private list: AudioScheduledSourceNode[] = [];
  add<T extends AudioScheduledSourceNode>(n: T): T {
    this.list.push(n);
    return n;
  }
  stop(when: number) {
    for (const n of this.list) { try { n.stop(when); } catch { /* not started / already stopped */ } }
  }
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function gain(ctx: BaseAudioContext, v: number) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  return o;
}

function noiseSrc(env: VoiceEnv, loop = true) {
  const s = env.ctx.createBufferSource();
  s.buffer = env.noise;
  s.loop = loop;
  return s;
}

/** A one-shot noise burst through one filter: `peak` reached in `atk`, exponential decay over `dec`. */
function burst(env: VoiceEnv, dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, peak: number, atk: number, dec: number) {
  const ctx = env.ctx;
  const s = noiseSrc(env, false);
  const b = filt(ctx, type, f, q);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  s.connect(b).connect(g).connect(dest);
  s.start(t, Math.random() * 3.5, atk + dec + 0.05);
}

/** Next event time after a hitch: never schedule a pile of events in the past. */
const resync = (next: number, now: number, gap: number) => (next < now - 0.25 ? now + gap : next);

// ------------------------------------------------------------------ babble (radio, crowd)
// [F1, F2] for a handful of vowels (adult male); a speaker scales them.
const VOWELS: readonly [number, number][] = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [500, 1500], [660, 1700], [440, 1020]];

/**
 * A sawtooth "glottis" through two formant band-passes and a syllable envelope. Unintelligible by
 * design: random vowels, a falling pitch over each phrase, consonants as short gaps.
 */
class Babbler {
  readonly src: OscillatorNode;
  private f1: BiquadFilterNode;
  private f2: BiquadFilterNode;
  readonly env: GainNode;
  /** Audio time when this voice is free again. */
  free = 0;

  constructor(ctx: BaseAudioContext, dest: AudioNode, S: Sources, breath?: AudioNode) {
    this.src = S.add(osc(ctx, 'sawtooth', 110));
    const tilt = filt(ctx, 'lowpass', 1400, 0.5); // glottal spectral tilt
    this.f1 = filt(ctx, 'bandpass', 600, 5);
    this.f2 = filt(ctx, 'bandpass', 1400, 7);
    const f2g = gain(ctx, 0.55);
    this.env = gain(ctx, 0);
    this.src.connect(tilt);
    tilt.connect(this.f1).connect(this.env);
    tilt.connect(this.f2).connect(f2g).connect(this.env);
    if (breath) { breath.connect(this.f1); breath.connect(this.f2); }
    this.env.connect(dest);
  }

  start(t: number) {
    this.src.start(t);
  }

  /** One phrase of `n` syllables from `t`. Returns when it ends. */
  phrase(t: number, base: number, fs: number, n: number, level: number) {
    const { src, f1, f2, env } = this;
    let tt = t;
    for (let i = 0; i < n; i++) {
      const dur = rand(0.09, 0.24) * (i === n - 1 ? 1.6 : 1); // the last syllable drags
      const [a, b] = pick(VOWELS);
      const p = base * (1.06 - 0.2 * (i / n)) * rand(0.93, 1.07);
      src.frequency.setTargetAtTime(p, tt, 0.03);
      f1.frequency.setTargetAtTime(a * fs, tt, 0.025);
      f2.frequency.setTargetAtTime(b * fs, tt, 0.03);
      env.gain.setTargetAtTime(level * rand(0.5, 1), tt, 0.018);
      env.gain.setTargetAtTime(0, tt + dur * 0.78, 0.022);
      tt += dur + (Math.random() < 0.22 ? rand(0.06, 0.16) : rand(0.015, 0.04));
    }
    this.free = tt + 0.05;
    return tt;
  }

  /** "ha-ha-ha": open vowel, pitch jumps up then falls away. */
  laugh(t: number, base: number, fs: number, n: number, level: number, breath?: GainNode) {
    const { src, f1, f2, env } = this;
    let tt = t;
    f1.frequency.setTargetAtTime(760 * fs, tt, 0.02);
    f2.frequency.setTargetAtTime(1250 * fs, tt, 0.02);
    for (let i = 0; i < n; i++) {
      const dur = rand(0.08, 0.12);
      src.frequency.setTargetAtTime(base * (1.55 - 0.45 * (i / n)) * rand(0.95, 1.05), tt, 0.015);
      env.gain.setTargetAtTime(level * (1 - 0.4 * (i / n)), tt, 0.012);
      env.gain.setTargetAtTime(0, tt + dur * 0.6, 0.02);
      if (breath) {
        breath.gain.setTargetAtTime(0.5, tt, 0.01);
        breath.gain.setTargetAtTime(0.12, tt + dur * 0.5, 0.03);
      }
      tt += dur + rand(0.05, 0.09);
    }
    this.free = tt + 0.1;
    return tt;
  }
}

// ------------------------------------------------------------------ rendered buffers
/** One second of projector mechanism at 24 fps: claw engage + retract, a thump, motor whir. Loops seamlessly. */
function projectorBuffer(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate;
  const len = sr;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // integer cycles per second: the loop point is seamless
    d[i] = 0.025 * Math.sin(2 * Math.PI * 72 * t) + 0.012 * Math.sin(2 * Math.PI * 144 * t + 1) + 0.008 * Math.sin(2 * Math.PI * 216 * t + 2);
  }
  let hp = 0, prev = 0;
  const click = (t0: number, a: number, tau: number) => {
    const i0 = Math.floor(t0 * sr);
    const n = Math.floor(tau * sr * 7);
    for (let j = 0; j < n; j++) {
      const w = Math.random() * 2 - 1;
      hp = 0.6 * (hp + w - prev); // one-pole high-pass: a sharp tick, not a thud
      prev = w;
      d[(i0 + j) % len] += a * hp * Math.exp(-j / (tau * sr));
    }
  };
  const thump = (t0: number, a: number, f: number, tau: number) => {
    const i0 = Math.floor(t0 * sr);
    const n = Math.floor(tau * sr * 6);
    for (let j = 0; j < n; j++) d[(i0 + j) % len] += a * Math.sin(2 * Math.PI * f * (j / sr)) * Math.exp(-j / (tau * sr));
  };
  for (let k = 0; k < 24; k++) {
    const t0 = k / 24 + (Math.random() - 0.5) * 0.0008;
    const a = 0.75 + Math.random() * 0.25;
    click(t0, a, 0.0016);
    click(t0 + 0.43 / 24, a * 0.38, 0.0012);
    thump(t0 + 0.002, 0.08, 150 + Math.random() * 20, 0.005);
  }
  // sprocket rattle: noise riding the frame rate
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    d[i] += (Math.random() * 2 - 1) * 0.018 * (0.4 + 0.6 * Math.max(0, Math.cos(2 * Math.PI * 24 * t)));
  }
  return buf;
}

// ------------------------------------------------------------------ the voices
export const VOICES: Record<AmbientKind, VoiceSpec> = {
  // SeedBot's rotors: two beating saws, a square overtone, and blade hiss
  drone: {
    range: 90, ref: 5, rolloff: 1.3, hrtf: true, gain: 0.9,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const lp = filt(ctx, 'lowpass', 1400);
      lp.connect(out);
      const oscs: OscillatorNode[] = [];
      for (const [f, type] of [[118, 'sawtooth'], [121.5, 'sawtooth'], [236, 'square']] as const) {
        const o = S.add(osc(ctx, type, f));
        o.connect(gain(ctx, type === 'square' ? 0.02 : 0.05)).connect(lp);
        o.start(t0);
        oscs.push(o);
      }
      const n = S.add(noiseSrc(env));
      n.connect(filt(ctx, 'bandpass', 2400)).connect(gain(ctx, 0.08)).connect(out);
      n.start(t0, rand(0, 3));
      return {
        setPitch(m, t) { for (const o of oscs) o.detune.setTargetAtTime(1200 * Math.log2(m), t, 0.1); },
        stop: (w) => S.stop(w),
      };
    },
  },

  // the camp fire: a soft flickering bed (not a roar) under crackle clusters and the odd pop
  fire: {
    range: 45, ref: 5, rolloff: 1.3, hrtf: true, gain: 0.8,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const n = S.add(noiseSrc(env));
      const g = gain(ctx, 0.07);
      const flick = S.add(osc(ctx, 'sine', 0.7));
      flick.connect(gain(ctx, 0.03)).connect(g.gain);
      n.connect(filt(ctx, 'lowpass', 420)).connect(g).connect(out);
      n.start(t0, rand(0, 3));
      flick.start(t0);
      let next = t0 + 0.05;
      return {
        tick(now, until) {
          next = resync(next, now, 0.1);
          while (next < until) {
            const pop = Math.random() < 0.08; // a knot in the wood: lower, louder, longer
            if (pop) burst(env, out, next, 'bandpass', rand(500, 900), 0.7, 0.7, 0.001, 0.09);
            else burst(env, out, next, 'highpass', rand(1800, 4800), 0.7, rand(0.12, 0.42), 0.001, rand(0.02, 0.06));
            next += Math.random() < 0.3 ? rand(0.015, 0.055) : rand(0.08, 0.46); // crackles come in clusters
          }
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // a few flies over a wreck: wing tones that wander in pitch and drop in and out as they circle
  flies: {
    range: 9, ref: 0.8, rolloff: 1.4, hrtf: true, gain: 0.05,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const flies = [0, 1, 2].map(() => {
        const o = S.add(osc(ctx, 'sawtooth', rand(170, 240)));
        const g = gain(ctx, 0);
        o.connect(filt(ctx, 'bandpass', 420, 1.2)).connect(g).connect(out);
        o.start(t0);
        return { o, g, next: t0 };
      });
      return {
        tick(now, until) {
          for (const f of flies) {
            while (f.next < until) {
              const t = Math.max(now, f.next), d = rand(0.15, 0.7);
              f.o.frequency.setTargetAtTime(rand(160, 260), t, 0.08);
              f.g.gain.setTargetAtTime(Math.random() < 0.3 ? 0 : rand(0.3, 1), t, 0.05);
              f.next = t + d;
            }
          }
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // a neon tube's 120 Hz buzz
  neon: {
    range: 14, ref: 2, rolloff: 1.3, hrtf: true, gain: 0.05,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const o = S.add(osc(ctx, 'square', 120));
      o.connect(filt(ctx, 'bandpass', 240, 3)).connect(out);
      o.start(ctx.currentTime);
      return { stop: (w) => S.stop(w) };
    },
  },

  // a small diesel generator: a low saw chugging at 7 Hz. (Was 0.35: −18.6 LUFS at 4 m, 17 LU over the
  // fire, enough to pump the master compressor whenever you stood near one.)
  generator: {
    range: 55, ref: 5, rolloff: 1.3, hrtf: true, gain: 0.12,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const o = S.add(osc(ctx, 'sawtooth', 42));
      const am = gain(ctx, 1);
      const lfo = S.add(osc(ctx, 'sine', 7));
      lfo.connect(gain(ctx, 0.5)).connect(am.gain);
      o.connect(filt(ctx, 'lowpass', 160)).connect(am).connect(out);
      o.start(t0);
      lfo.start(t0);
      return {
        setPitch(m, t) { o.detune.setTargetAtTime(1200 * Math.log2(m), t, 0.1); lfo.detune.setTargetAtTime(1200 * Math.log2(m), t, 0.1); },
        stop: (w) => S.stop(w),
      };
    },
  },

  // cave water: a few drip points on their own irregular clocks, each drop a rising sine "plink"
  // (the bubble's resonance), through a short dark echo
  drip: {
    range: 26, ref: 2.5, rolloff: 1.2, hrtf: true, gain: 0.9,
    build(env, out) {
      const { ctx } = env;
      const echo = ctx.createDelay(0.5);
      echo.delayTime.value = rand(0.11, 0.17);
      const fb = gain(ctx, 0.36);
      const lp = filt(ctx, 'lowpass', 2400);
      echo.connect(lp).connect(fb).connect(echo);
      lp.connect(gain(ctx, 0.55)).connect(out);
      const t0 = ctx.currentTime;
      const points = Array.from({ length: 3 }, (_, i) => ({
        f: rand(750, 1500) * (i === 2 ? 0.6 : 1),
        period: rand(1.3, 4.2),
        level: rand(0.5, 1) * (i === 2 ? 0.7 : 1),
        next: t0 + rand(0.2, 3),
      }));
      const drop = (t: number, f: number, level: number, plop: boolean) => {
        const o = osc(ctx, 'sine', f);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * (plop ? 1.4 : 1.9), t + (plop ? 0.06 : 0.028));
        const g = ctx.createGain();
        const dec = plop ? 0.14 : rand(0.045, 0.08);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(level, t + 0.0015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g);
        g.connect(out);
        g.connect(echo);
        o.start(t);
        o.stop(t + dec + 0.02);
      };
      return {
        tick(now, until) {
          for (const p of points) {
            p.next = resync(p.next, now, rand(0.2, 1));
            while (p.next < until) {
              if (Math.random() > 0.1) drop(p.next, p.f * rand(0.97, 1.03), p.level * rand(0.6, 1) * 0.5, Math.random() < 0.06);
              // sometimes a quick second drop off the same tip
              if (Math.random() < 0.12) drop(p.next + rand(0.12, 0.3), p.f * rand(1.05, 1.2), p.level * 0.25, false);
              p.next += p.period * rand(0.7, 1.35);
            }
          }
        },
        stop() {
          // drops stop themselves; break the echo's feedback cycle so it can be collected
          setTimeout(() => { echo.disconnect(); lp.disconnect(); fb.disconnect(); }, 600);
        },
      };
    },
  },

  // transformer / server-hall hum: 120 Hz magnetostriction with harmonics, two near-unison partials
  // beating slowly against it, fan air, and a faint coil whine that wanders and drops out
  hum: {
    range: 38, ref: 4, rolloff: 1.2, hrtf: false, gain: 0.6,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const a = S.add(osc(ctx, 'sawtooth', 120));
      a.connect(filt(ctx, 'lowpass', 650, 0.6)).connect(gain(ctx, 0.022)).connect(out);
      const b = S.add(osc(ctx, 'sine', 120 + rand(0.3, 0.5)));
      b.connect(gain(ctx, 0.028)).connect(out);
      const c = S.add(osc(ctx, 'sine', 240 + rand(0.7, 1.1)));
      c.connect(gain(ctx, 0.011)).connect(out);
      const fan = S.add(noiseSrc(env));
      const fanG = gain(ctx, 0.05);
      fan.connect(filt(ctx, 'highpass', 500, 0.6)).connect(filt(ctx, 'lowpass', 3200, 0.5)).connect(fanG).connect(out);
      const whine = S.add(osc(ctx, 'sine', rand(2900, 3500)));
      const whineG = gain(ctx, 0);
      whine.connect(whineG).connect(out);
      for (const s of [a, b, c, whine]) s.start(t0);
      fan.start(t0, rand(0, 3));
      let next = t0 + rand(1, 3);
      return {
        tick(now) {
          if (now < next) return;
          next = now + rand(2.5, 7);
          whine.frequency.setTargetAtTime(rand(2700, 3900), now, rand(0.8, 2.5));
          whineG.gain.setTargetAtTime(Math.random() < 0.4 ? 0 : rand(0.0012, 0.0035), now, rand(0.5, 2));
          fanG.gain.setTargetAtTime(rand(0.04, 0.06), now, 1.5);
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // wind moaning through a hull or pipe: noise into narrow resonances (fundamental, octave, a
  // whistle) whose level and pitch ride the weather's wind and gusts, plus a low buffet
  'wind-hollow': {
    range: 40, ref: 5, rolloff: 1.2, hrtf: false, gain: 1,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const f0 = rand(190, 300);
      const n = S.add(noiseSrc(env));
      const level = gain(ctx, 0);
      const b1 = filt(ctx, 'bandpass', f0, 14);
      const b2 = filt(ctx, 'bandpass', f0 * 2.02, 18);
      const b3 = filt(ctx, 'bandpass', f0 * 3.05, 24);
      const g2 = gain(ctx, 0.55);
      const whistle = gain(ctx, 0);
      const rumble = gain(ctx, 0.05);
      n.connect(b1).connect(level);
      n.connect(b2).connect(g2).connect(level);
      n.connect(b3).connect(whistle).connect(level);
      n.connect(filt(ctx, 'lowpass', 110)).connect(rumble).connect(level);
      level.connect(out);
      n.start(t0, rand(0, 3));
      let walk = 0.5, walkT = 0, last = 0;
      return {
        tick(now) {
          if (now - last < 0.12) return;
          const dt = Math.min(0.5, now - last);
          last = now;
          walkT -= dt;
          if (walkT <= 0) { walkT = rand(2, 6); walk = rand(0.15, 1); }
          const w = Math.min(1.6, env.wind());
          const k = Math.min(1.1, 0.25 * w + 0.55 * env.gust() + 0.25 * walk);
          level.gain.setTargetAtTime(1.1 * k * Math.sqrt(k), now, 0.35);
          // the resonance climbs with the flow, like blowing harder across a bottle
          const p = 1 + 0.1 * (k - 0.5);
          b1.frequency.setTargetAtTime(f0 * p, now, 0.5);
          b2.frequency.setTargetAtTime(f0 * 2.02 * p, now, 0.5);
          b3.frequency.setTargetAtTime(f0 * 3.05 * p * p, now, 0.4);
          whistle.gain.setTargetAtTime(k > 0.8 ? 0.6 * (k - 0.8) : 0, now, 0.4);
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // a radio murmuring to itself: AM-band voice babble under static, fading in and out like a
  // distant station, with the odd tuning sweep between stations
  radio: {
    range: 22, ref: 2.5, rolloff: 1.3, hrtf: true, gain: 0.26,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const hp = filt(ctx, 'highpass', 380, 0.7);
      const lpf = filt(ctx, 'lowpass', 2500, 0.9);
      const drive = gain(ctx, 3);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2.2) / Math.tanh(2.2);
      shaper.curve = curve;
      const post = gain(ctx, 0.3);
      // band-limit again after the soft clip: the speaker can't reproduce its products either
      hp.connect(lpf).connect(drive).connect(shaper).connect(filt(ctx, 'highpass', 300, 0.7)).connect(filt(ctx, 'lowpass', 3000, 0.7)).connect(post).connect(out);
      const voiceG = gain(ctx, 1);
      voiceG.connect(hp);
      const bab = new Babbler(ctx, voiceG, S);
      bab.start(t0);
      const st = S.add(noiseSrc(env));
      const stG = gain(ctx, 0.05);
      st.connect(filt(ctx, 'bandpass', 1700, 0.5)).connect(stG).connect(hp);
      st.start(t0, rand(0, 3));
      let station = { base: rand(100, 135), fs: rand(0.95, 1.1) };
      let fadeT = t0, sweepT = t0 + rand(18, 40);
      bab.free = t0 + rand(0.3, 1.5);
      const sweep = (t: number) => {
        const o = osc(ctx, 'sine', 2600);
        o.frequency.setValueAtTime(rand(2200, 3000), t);
        o.frequency.exponentialRampToValueAtTime(rand(350, 600), t + rand(0.5, 0.9));
        o.frequency.exponentialRampToValueAtTime(rand(900, 1600), t + 1.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.15);
        g.gain.setValueAtTime(0.05, t + 1.1);
        g.gain.linearRampToValueAtTime(0, t + 1.45);
        o.connect(g).connect(hp);
        o.start(t);
        o.stop(t + 1.5);
        stG.gain.setTargetAtTime(0.14, t, 0.08);
        stG.gain.setTargetAtTime(0.05, t + 1.3, 0.3);
        voiceG.gain.setTargetAtTime(0, t, 0.05);
        voiceG.gain.setTargetAtTime(1, t + 1.4, 0.2);
        bab.free = t + 1.8;
        station = { base: rand(95, 150), fs: rand(0.92, 1.15) };
      };
      return {
        tick(now, until) {
          if (now > sweepT) { sweep(now + 0.05); sweepT = now + rand(25, 60); }
          // fading (QSB): the station drifts in and out, the static breathes against it
          if (now > fadeT) {
            fadeT = now + rand(1.5, 4);
            const k = rand(0.45, 1);
            voiceG.gain.setTargetAtTime(k, now, 1.2);
            stG.gain.setTargetAtTime(0.03 + (1 - k) * 0.06, now, 1.2);
          }
          if (bab.free < until) {
            const start = Math.max(bab.free, now);
            if (Math.random() < 0.25) bab.free = start + rand(0.8, 3); // a pause
            else bab.phrase(start, station.base, station.fs, Math.floor(rand(4, 13)), 0.9);
          }
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // a film projector: a rendered second of claw-and-sprocket clatter at 24 fps on a loop, the
  // motor's whir, a cooling fan, and a speed that wanders a hair
  projector: {
    range: 34, ref: 3, rolloff: 1.3, hrtf: true, gain: 0.45,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const src = S.add(ctx.createBufferSource());
      src.buffer = env.cached('projector', projectorBuffer);
      src.loop = true;
      src.connect(filt(ctx, 'lowpass', 7000, 0.7)).connect(gain(ctx, 0.9)).connect(out);
      const body = filt(ctx, 'lowpass', 320, 1.2);
      src.connect(body).connect(gain(ctx, 0.15)).connect(out);
      const fan = S.add(noiseSrc(env));
      fan.connect(filt(ctx, 'bandpass', 620, 0.8)).connect(gain(ctx, 0.03)).connect(out);
      src.start(t0, rand(0, 1));
      fan.start(t0, rand(0, 3));
      let next = t0 + rand(2, 5);
      return {
        tick(now) {
          if (now < next) return;
          next = now + rand(3, 8);
          src.playbackRate.setTargetAtTime(rand(0.985, 1.015), now, 0.8);
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // people round a fire: two voice chains taking turns (three speakers between them), sparse,
  // muffled to murmur, and every so often someone laughs and another joins in
  crowd: {
    range: 34, ref: 4, rolloff: 1.2, hrtf: false, gain: 0.5,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const lp = filt(ctx, 'lowpass', 1700, 0.6);
      lp.connect(out);
      const air = S.add(noiseSrc(env));
      const breaths = [gain(ctx, 0.12), gain(ctx, 0.12)];
      for (const b of breaths) air.connect(b);
      air.start(t0, rand(0, 3));
      const chains = breaths.map((b) => new Babbler(ctx, lp, S, b));
      for (const c of chains) { c.start(t0); c.free = t0 + rand(0.5, 3); }
      const people = [
        { base: rand(92, 105), fs: 0.95 },
        { base: rand(112, 128), fs: 1.0 },
        { base: rand(185, 210), fs: 1.17 },
      ];
      const talking: (typeof people[number] | null)[] = [null, null];
      let laughT = t0 + rand(12, 35);
      return {
        tick(now, until) {
          for (let i = 0; i < 2; i++) {
            const c = chains[i];
            if (c.free > until) continue;
            talking[i] = null;
            const start = Math.max(c.free, now);
            if (now > laughT && i === 0) {
              laughT = now + rand(30, 80);
              const who = pick(people);
              talking[0] = who;
              c.laugh(start, who.base, who.fs, Math.floor(rand(4, 8)), 0.55, breaths[0]);
              // someone else catches it
              if (Math.random() < 0.6 && chains[1].free < start + 2) {
                const other = pick(people.filter((p) => p !== who));
                talking[1] = other;
                chains[1].laugh(start + rand(0.15, 0.45), other.base, other.fs, Math.floor(rand(3, 6)), 0.4, breaths[1]);
              }
              continue;
            }
            // sparse: a lot of the time nobody on this chain is talking
            if (Math.random() < 0.6) { c.free = start + rand(1, 5); continue; }
            const other = talking[1 - i];
            const who = pick(people.filter((p) => p !== other));
            talking[i] = who;
            c.phrase(start, who.base, who.fs, Math.floor(rand(3, 11)), 0.45);
          }
        },
        stop: (w) => S.stop(w),
      };
    },
  },

  // a shorting cable: quiet, then a burst of arcing (stuttering 120 Hz buzz, crackle, a pop)
  sparks: {
    range: 24, ref: 2.5, rolloff: 1.3, hrtf: true, gain: 0.8,
    build(env, out) {
      const { ctx } = env;
      const S = new Sources();
      const t0 = ctx.currentTime;
      const saw = S.add(osc(ctx, 'sawtooth', 120));
      const n = S.add(noiseSrc(env));
      const bp = filt(ctx, 'bandpass', 2600, 1.1);
      saw.connect(gain(ctx, 0.35)).connect(bp);
      n.connect(bp);
      const buzz = gain(ctx, 0);
      bp.connect(buzz).connect(out);
      saw.start(t0);
      n.start(t0, rand(0, 3));
      let next = t0 + rand(0.5, 3);
      const arc = (t: number) => {
        const dur = Math.random() < 0.15 ? rand(0.7, 1.4) : rand(0.06, 0.5);
        const c = ctx.createBufferSource();
        c.buffer = env.crackle;
        c.playbackRate.value = rand(0.8, 1.4);
        const g = ctx.createGain();
        const lvl = rand(0.5, 1);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl, t + 0.003);
        g.gain.setValueAtTime(lvl, t + dur);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
        c.connect(filt(ctx, 'highpass', rand(1200, 2600), 0.7)).connect(g).connect(out);
        c.start(t, rand(0, 1.4), dur + 0.06);
        // the arc stutters: hard steps, which is exactly the click of a bad contact
        let tt = t;
        while (tt < t + dur) {
          buzz.gain.setValueAtTime(Math.random() < 0.3 ? 0 : rand(0.03, 0.13), tt);
          tt += rand(0.008, 0.03);
        }
        buzz.gain.setValueAtTime(0, t + dur);
        if (Math.random() < 0.35) burst(env, out, t, 'bandpass', rand(500, 900), 1, 0.5, 0.001, 0.05);
        return dur;
      };
      return {
        tick(now, until) {
          next = resync(next, now, rand(0.5, 2));
          while (next < until) {
            const d = arc(next);
            // arcs come in runs, then the cable rests
            next += d + (Math.random() < 0.4 ? rand(0.05, 0.4) : rand(1.5, 9));
          }
        },
        stop: (w) => S.stop(w),
      };
    },
  },
};

// ------------------------------------------------------------------ distance-gated spots
const LOOKAHEAD = 0.15;

interface Live {
  voice: Voice;
  out: GainNode;
  fade: GainNode;
  pan: PannerNode;
  fadeV: number;
}

export interface SpotHandle {
  setPosition(v: { x: number; y: number; z: number }): void;
  setGain(g: number): void;
  setPitch(mult: number): void;
  stop(): void;
}

class Spot implements SpotHandle {
  x: number;
  y: number;
  z: number;
  gain: number;
  pitch = 1;
  live: Live | null = null;
  dead = false;

  constructor(readonly kind: AmbientKind, readonly spec: VoiceSpec, pos: { x: number; y: number; z: number }, private mgr: SpotManager) {
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    this.gain = spec.gain;
  }

  setPosition(v: { x: number; y: number; z: number }) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    const l = this.live;
    if (!l) return;
    const t = this.mgr.env.ctx.currentTime;
    l.pan.positionX.setTargetAtTime(v.x, t, 0.05);
    l.pan.positionY.setTargetAtTime(v.y, t, 0.05);
    l.pan.positionZ.setTargetAtTime(v.z, t, 0.05);
  }

  setGain(g: number) {
    if (Math.abs(g - this.gain) < 1e-4) return;
    this.gain = g;
    this.live?.out.gain.setTargetAtTime(g, this.mgr.env.ctx.currentTime, 0.1);
  }

  setPitch(m: number) {
    if (Math.abs(m - this.pitch) < 1e-4) return;
    this.pitch = m;
    this.live?.voice.setPitch?.(m, this.mgr.env.ctx.currentTime);
  }

  stop() {
    this.dead = true;
    this.mgr.release(this);
  }
}

/** Owns every positional loop. `update()` once per frame with the listener's position. */
export class SpotManager {
  private spots: Spot[] = [];

  constructor(readonly env: VoiceEnv, private dest: AudioNode, private room: AudioNode) {}

  add(kind: AmbientKind, pos: { x: number; y: number; z: number }): SpotHandle {
    const s = new Spot(kind, VOICES[kind], pos, this);
    this.spots.push(s);
    return s;
  }

  /** How many spots currently have live nodes (for the bench/harness). */
  get active() {
    return this.spots.reduce((n, s) => n + (s.live ? 1 : 0), 0);
  }

  get count() {
    return this.spots.length;
  }

  update(lx: number, ly: number, lz: number) {
    const t = this.env.ctx.currentTime;
    for (const s of this.spots) {
      if (s.dead) continue; // stopped: released already, dropped below
      const dx = s.x - lx, dy = s.y - ly, dz = s.z - lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = s.spec.range;
      if (!s.live) {
        if (d >= r) continue;
        this.activate(s, t);
      } else if (d > r * 1.08) {
        this.release(s);
        continue;
      }
      const l = s.live!;
      // full level inside 70% of the range, fading to nothing at the edge
      const u = Math.min(1, Math.max(0, (r - d) / (r * 0.3)));
      const f = u * u * (3 - 2 * u);
      if (Math.abs(f - l.fadeV) > 0.01 || (f === 0) !== (l.fadeV === 0)) {
        l.fade.gain.setTargetAtTime(f, t, 0.15);
        l.fadeV = f;
      }
      l.voice.tick?.(t, t + LOOKAHEAD);
    }
    if (this.spots.some((s) => s.dead)) this.spots = this.spots.filter((s) => !s.dead);
  }

  private activate(s: Spot, t: number) {
    const ctx = this.env.ctx;
    const spec = s.spec;
    const pan = ctx.createPanner();
    pan.panningModel = spec.hrtf ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = spec.ref;
    pan.rolloffFactor = spec.rolloff;
    pan.maxDistance = 10000;
    pan.positionX.value = s.x;
    pan.positionY.value = s.y;
    pan.positionZ.value = s.z;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    const out = ctx.createGain();
    out.gain.value = s.gain;
    out.connect(fade).connect(pan);
    pan.connect(this.dest);
    pan.connect(this.room);
    const voice = spec.build(this.env, out);
    if (s.pitch !== 1) voice.setPitch?.(s.pitch, t);
    s.live = { voice, out, fade, pan, fadeV: 0 };
  }

  release(s: Spot) {
    const l = s.live;
    if (!l) return;
    s.live = null;
    const t = this.env.ctx.currentTime;
    l.fade.gain.cancelScheduledValues(t);
    l.fade.gain.setTargetAtTime(0, t, 0.05);
    l.voice.stop(t + 0.3);
    setTimeout(() => {
      l.out.disconnect();
      l.fade.disconnect();
      l.pan.disconnect();
    }, 450);
  }
}

/** 2 s of sparse clicks: random-amplitude impulses (mostly faint, a few loud), some in clusters. */
export function crackleBuffer(ctx: BaseAudioContext, seconds = 2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let t = 0;
  while (t < seconds) {
    const cluster = Math.random() < 0.15;
    const n = cluster ? 3 + Math.floor(Math.random() * 6) : 1;
    for (let k = 0; k < n; k++) {
      const i0 = Math.floor((t + k * (0.0015 + Math.random() * 0.004)) * sr);
      const a = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? 1 : -1);
      const tau = (0.08 + Math.random() * 0.5) * 0.001 * sr;
      for (let j = 0; j < tau * 6 && i0 + j < len; j++) d[i0 + j] += a * (Math.random() * 2 - 1) * Math.exp(-j / tau);
    }
    t += -Math.log(1 - Math.random()) / 140; // ~140 events per second
  }
  return buf;
}
