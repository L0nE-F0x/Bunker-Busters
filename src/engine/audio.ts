import * as THREE from 'three/webgpu';
import { Music, type MusicMood } from './music';
import { SpotManager, VOICES, crackleBuffer, type AmbientKind, type SpotHandle, type VoiceEnv } from './ambient';
import { footstep, landing, type StepOpts } from './foley';
import { HARDNESS, type Room, type Surface } from './surface';
import { CombatAudio } from './combatAudio';
import { VoicePlayer } from './voice';
import { Wildlife } from './wildlife';

/**
 * Positional ambience loops (Landmarks/sites push `{ kind, pos }` into `landmarks.audioSpots`).
 * Every kind has a voice in ./ambient.ts:
 *   drone: SeedBot's rotors · fire: camp fire · neon: tube buzz · generator: small diesel
 *   drip: water in a cave · hum: server/transformer hum · wind-hollow: wind through a hull or pipe
 *   radio: a radio murmuring to itself · projector: film projector clatter · crowd: low voices round a fire
 *   sparks: a shorting cable
 * Spots are distance-gated: beyond a kind's range they have no nodes at all.
 */
export type { AmbientKind } from './ambient';
export type { Surface } from './surface';

/** What the world sounds like right now (fed by the game every frame). */
export interface SoundScene {
  mood: MusicMood;
  night: boolean;
  hour: number;
  /** The game knows the player is indoors (the Garage house). */
  inside: boolean;
  alarm: boolean;
  /** From `Acoustics`: how enclosed the listener is (walls all round = a room) and its size. */
  room?: Room;
  /** The floor underfoot (hard floors reflect more). */
  floor?: Surface;
  /** An approaching dust storm's wall on the horizon 0..1 (Weather.front). */
  front?: number;
  /** Wind heading on the ground plane (x, z as Atmosphere.windDir's x, y). The storm comes from −windDir. */
  windDir?: { x: number; y: number };
  /** 0..1 how much of a fight you're in: hunted ≈ 0.6, rounds flying → 1 (drives the music's fight stem). */
  combat?: number;
}

/** A convolution reverb that's only connected (and so only costs anything) while it's being fed. */
class Verb {
  readonly input: GainNode;
  private on = false;
  private level = 0;
  private idleSince = 0;

  constructor(ctx: AudioContext, private conv: ConvolverNode, out: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 0;
    conv.connect(out);
  }

  set(v: number, t: number) {
    if (v > 0.01) {
      this.idleSince = 0;
      if (!this.on) { this.input.connect(this.conv); this.on = true; }
    } else if (this.on) {
      // keep it connected long enough for the tail to ring out, then let it go silent for free
      v = 0;
      if (!this.idleSince) this.idleSince = t;
      else if (t - this.idleSince > 3) { this.input.disconnect(this.conv); this.on = false; }
    }
    if (Math.abs(v - this.level) > 0.003) {
      this.input.gain.setTargetAtTime(v, t, 0.35);
      this.level = v;
    }
  }

  get active() {
    return this.on;
  }
}

/**
 * Fully procedural audio: an ambience that breathes (a soft breeze, gusts that follow the
 * weather's, insects by day, crickets and coyotes at night, dust storms), a generative score
 * (./music.ts), distance-gated positional loops (./ambient.ts), footsteps by surface (./foley.ts),
 * a room reverb that fades in indoors, and synthesised one-shots. No audio files.
 */
export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  /** A lowpass over the whole mix that closes when you're deafened (blasts, shotguns indoors). */
  private dull!: BiquadFilterNode;
  /** Where the tinnitus goes in (after the dulling, so it rings clear). */
  private ears!: AudioNode;
  private ring: { o: OscillatorNode[]; g: GainNode; until: number } | null = null;
  private deafUntil = 0;
  /** The very end of the chain (after the limiter): what reaches the speakers (harness tap). */
  out!: AudioNode;
  private sfx!: GainNode;
  /** Diegetic world sound (footsteps, positional loops): dry-ish outdoors, into the room reverb indoors. */
  private foley!: GainNode;
  private foleyHall!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  /** Everything that should ring in a room goes through here into the two room reverbs. */
  private roomBus!: GainNode;
  private roomSmall!: Verb;
  private roomLarge!: Verb;
  private noiseBuf!: AudioBuffer;
  private crackleBuf!: AudioBuffer;
  private buffers = new Map<string, AudioBuffer>();
  private spots!: SpotManager;
  private ambLP!: BiquadFilterNode;
  private ambOut!: GainNode;
  private breeze!: { gain: GainNode; f: BiquadFilterNode };
  private breezeLvl = 0.4;
  private breezeTarget = 0.4;
  private breezeT = 0;
  private gustT = 5;
  /** The last gust's envelope (audio-clock times) and the weather's own surge above its mean. */
  private gustEv = { t0: -99, atk: 1, hold: 1, rel: 1, k: 0 };
  private windAvg = 0.6;
  private surge = 0;
  private gustNow = 0;
  private cicadaT = 12;
  private coyoteT = 80;
  private hawkT = 60;
  /** Doves, quail and wrens by morning; poorwills, owls and coyote yips by night. */
  wildlife: Wildlife | null = null;
  private crickets = [
    { f: 4450, period: 0.82, pan: -0.55, on: false, t: 2, next: 0 },
    { f: 4980, period: 1.07, pan: 0.6, on: false, t: 6, next: 0 },
    { f: 4120, period: 0.64, pan: 0.15, on: false, t: 11, next: 0 },
  ];
  /** Night insect chorus (built at dusk, torn down at dawn). */
  private chorus: { level: GainNode; stop: (t: number) => void; walk: number; walkT: number } | null = null;
  private chorusIdle = 0;
  /** Dust-storm layers: built when a storm starts, torn down a while after it ends. */
  private storm: { hiss: GainNode; howl: GainNode; howlF: BiquadFilterNode[]; rumble: GainNode; sand: GainNode; stop: (t: number) => void } | null = null;
  private stormIdle = 0;
  /** The storm wall's distant roar while it's still on the horizon. */
  private frontRoar: { g: GainNode; pan: StereoPannerNode; stop: (t: number) => void } | null = null;
  /** Smoothed enclosure 0..1 (rays + the game's own `inside`). */
  private enclosed = 0;
  private sceneT = 0;
  private score: Music | null = null;
  private alarm: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private started = false;
  private stepFoot = 0;
  private stepPan: StereoPannerNode[] = [];
  volume = { master: 0.8, music: 0.5, sfx: 0.9 };
  /** Gunfire, impacts, creatures, explosions (null until start()). */
  combat: CombatAudio | null = null;
  private listenerPos = new THREE.Vector3();
  private voiceBus!: GainNode;
  private voice!: VoicePlayer;
  private voicesOn = true;

  get ready() {
    return this.started;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.started = true;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    // makeup gain: the mix is mostly quiet ambience now, so lift it back to a normal listening level
    const makeup = ctx.createGain();
    makeup.gain.value = 1.5;
    // a brick wall after the makeup: gunshots and blasts are far louder than anything else in the
    // mix, and without it their transients clip at the output
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    // the ears: wide open, until something goes off too close (see deafen)
    this.dull = ctx.createBiquadFilter();
    this.dull.type = 'lowpass';
    this.dull.frequency.value = 20000;
    this.dull.Q.value = 0.5;
    this.master.connect(this.dull).connect(comp).connect(makeup).connect(limiter).connect(ctx.destination);
    this.out = limiter;
    this.ears = comp;
    this.master.gain.value = this.volume.master;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // rooms: a tight, bright one for huts and cabins and a long, dark one for halls and caves
    const small = ctx.createConvolver();
    small.buffer = this.makeRoomImpulse(0.8, 0.5, 0.03, 0.004, 0.62, 0.25);
    const large = ctx.createConvolver();
    large.buffer = this.makeRoomImpulse(2.6, 1.9, 0.075, 0.014, 0.45, 0.1);
    this.roomSmall = new Verb(ctx, small, this.master);
    this.roomLarge = new Verb(ctx, large, this.master);
    this.roomBus = ctx.createGain();
    // keep the boom out of the rooms: heel thumps through a long tail turn to mud
    const roomHP = ctx.createBiquadFilter();
    roomHP.type = 'highpass';
    roomHP.frequency.value = 150;
    this.roomBus.connect(roomHP);
    roomHP.connect(this.roomSmall.input);
    roomHP.connect(this.roomLarge.input);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volume.sfx;
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverbSend);
    this.foley = ctx.createGain();
    this.foley.gain.value = this.volume.sfx;
    this.foley.connect(this.master);
    this.foley.connect(this.roomBus);
    this.foleyHall = ctx.createGain();
    this.foleyHall.gain.value = 0.3;
    this.foley.connect(this.foleyHall).connect(this.reverbSend);
    // alternate feet sit a hair either side of centre
    for (const p of [-0.06, 0.06]) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = p;
      sp.connect(this.foley);
      this.stepPan.push(sp);
    }
    // ambience bus → a lowpass that closes when you're indoors (walls muffle the desert)
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.ambLP = ctx.createBiquadFilter();
    this.ambLP.type = 'lowpass';
    this.ambLP.frequency.value = 18000;
    this.ambOut = ctx.createGain();
    this.amb.connect(this.ambLP).connect(this.ambOut).connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.volume.music;
    this.music.connect(this.master);

    this.noiseBuf = this.makeNoise(4);
    this.crackleBuf = crackleBuffer(ctx);
    this.spots = new SpotManager(this.voiceEnv(ctx), this.foley, this.roomBus);
    this.startWind();
    this.wildlife = new Wildlife({ ctx, out: this.amb, reverb: this.reverbSend, noise: this.noiseBuf });
    this.score = new Music(ctx, this.music, this.reverbSend, this.noiseBuf);
    this.combat = new CombatAudio({
      ctx, noise: this.noiseBuf, sfx: this.sfx, reverb: this.reverbSend, room: this.roomBus, listener: () => this.listenerPos,
      enclosed: () => this.enclosed,
      deafen: (k) => this.deafen(k),
    });
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = this.volume.sfx;
    this.voiceBus.connect(this.master);
    this.voice = new VoicePlayer(ctx, this.voiceBus, (pos) => this.panner(pos, 6, 1.1), (on) => {
      // talk sits on top of the score: duck it while someone speaks
      this.music.gain.setTargetAtTime(this.volume.music * (on ? 0.45 : 1), ctx.currentTime, on ? 0.15 : 0.6);
    });
    this.voice.enabled = this.voicesOn;
  }

  /** Speak a line (see ./voice.ts). Resolves to its spoken length in seconds, 0 if nothing was voiced. */
  speak(speaker: string, text: string, opts?: { pos?: THREE.Vector3; variant?: number }): Promise<number> {
    return this.started ? this.voice.say(speaker, text, opts) : Promise.resolve(0);
  }

  /** Whether `speak` would voice this line (Recovery skips its own squelch: the clip has one). */
  speaks(speaker: string, text: string, variant = 0) {
    return this.started && this.voice.covers(speaker, text, variant);
  }

  /** Cut the conversation voice off (a card closed). */
  hush() {
    if (this.started) this.voice.hush();
  }

  /** Voices on or off (Settings); off leaves subtitles only. */
  setVoices(on: boolean) {
    this.voicesOn = on;
    if (this.started) { this.voice.enabled = on; if (!on) this.voice.hush(); }
  }

  private voiceEnv(ctx: BaseAudioContext, cache = this.buffers): VoiceEnv {
    return {
      ctx,
      noise: this.noiseBuf,
      crackle: this.crackleBuf,
      cached: (key, make) => {
        let b = cache.get(key);
        if (!b) { b = make(ctx); cache.set(key, b); }
        return b;
      },
      wind: () => this.windAvg + this.surge,
      gust: () => this.gustNow,
    };
  }

  /**
   * Too loud, too close (`k` 0..1): the world goes dull and far away for a moment and a high whine
   * rings over it, then the hearing comes back. A blast at your feet is k≈1; a shotgun in a small
   * room is a little of it.
   */
  deafen(k: number) {
    if (!this.started || k < 0.05) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.1; // let the bang itself land first
    const hold = 0.25 + 0.6 * k, back = 1.2 + 3.2 * k;
    const f = this.dull.frequency;
    // only ever make it worse: a small one during a big one's recovery doesn't reopen the ears
    const floor = 20000 * Math.pow(520 / 20000, Math.min(1, k));
    if (t + hold + back > this.deafUntil || f.value > floor) {
      f.cancelScheduledValues(t);
      f.setValueAtTime(Math.max(floor, Math.min(f.value, 20000)), t);
      f.exponentialRampToValueAtTime(floor, t + 0.05);
      f.setValueAtTime(floor, t + hold);
      f.exponentialRampToValueAtTime(20000, t + hold + back);
      this.deafUntil = Math.max(this.deafUntil, t + hold + back);
    }
    // the ring: two close sines (a beating, not a test tone), fading slower than the dulling
    const peak = 0.022 * Math.min(1, k);
    const end = t + hold + back * 1.3;
    if (!this.ring || this.ring.until < ctx.currentTime + 0.2) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.ears);
      const fr = 3700 + Math.random() * 700;
      const o = [fr, fr * 1.004].map((hz, i) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = hz;
        const og = ctx.createGain();
        og.gain.value = i ? 0.6 : 1;
        osc.connect(og).connect(g);
        osc.start(t);
        return osc;
      });
      this.ring = { o, g, until: 0 };
    }
    const r = this.ring;
    const g = r.g.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(Math.max(peak, g.value), t, 0.06);
    g.setTargetAtTime(0, t + hold, back * 0.45);
    r.until = Math.max(r.until, end);
    for (const o of r.o) { try { o.stop(r.until + 0.5); } catch { /* fine */ } }
    const done = r;
    setTimeout(() => { if (this.ring === done && done.until < this.ctx.currentTime) { done.g.disconnect(); this.ring = null; } }, (r.until - ctx.currentTime + 0.8) * 1000);
  }

  /** Musical stingers (bunker busted, caught). */
  sting(kind: 'busted' | 'caught') {
    this.score?.sting(kind);
  }

  setVolumes(v: Partial<typeof this.volume>) {
    Object.assign(this.volume, v);
    if (!this.started) return;
    this.master.gain.value = this.volume.master;
    this.music.gain.value = this.volume.music;
    this.sfx.gain.value = this.volume.sfx;
    this.foley.gain.value = this.volume.sfx;
    this.voiceBus.gain.value = this.volume.sfx;
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      // pinkish noise (Paul Kellet's economy filter)
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /**
   * A room: sparse early reflections inside `early` s after a `pre` s gap, then a diffuse tail
   * decaying by 60 dB over `rt60` s that darkens as it dies (one-pole lowpass `damp0` → `damp1`).
   */
  private makeRoomImpulse(seconds: number, rt60: number, early: number, pre: number, damp0: number, damp1: number) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < 12; k++) {
        const ti = pre + Math.random() * early;
        d[Math.floor(ti * sr)] += (Math.random() < 0.5 ? -1 : 1) * (1 - 0.6 * ((ti - pre) / early)) * 0.7;
      }
      let y = 0;
      const i0 = Math.floor(pre * sr);
      for (let i = i0; i < len; i++) {
        const t = i / sr;
        const a = damp0 + (damp1 - damp0) * Math.min(1, t / rt60);
        y += a * (Math.random() * 2 - 1 - y);
        d[i] += y * Math.exp((-6.9 * t) / rt60) * Math.min(1, (i - i0) / (0.012 * sr)) * 0.6;
      }
    }
    return buf;
  }

  private noiseSource(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    src.loopStart = Math.random() * 2;
    return src;
  }

  /** A soft, always-there breeze. Most of the wind's character comes from gusts (see `gust`). */
  private startWind() {
    const ctx = this.ctx;
    const src = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    f.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(f).connect(gain).connect(this.amb);
    src.start(0, Math.random() * 3);
    this.breeze = { gain, f };
  }

  /**
   * One gust: a band of noise that swells over a couple of seconds, peaks, and dies away while it
   * drifts across the stereo field. `k` 0..1 is how strong.
   */
  private gust(k: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const atk = 1.1 + Math.random() * 2.2, hold = 0.2 + Math.random() * 1.2, rel = 1.8 + Math.random() * 2.8;
    const end = t + atk + hold + rel;
    this.gustEv = { t0: t, atk, hold, rel, k };
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    const f0 = 170 + Math.random() * 120, f1 = 420 + Math.random() * 520 + k * 300;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + atk);
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.2, end);
    // a faint whistle riding on top (wind through wire and wrecks), only in the stronger gusts
    const wh = ctx.createBiquadFilter();
    wh.type = 'bandpass';
    wh.Q.value = 7;
    wh.frequency.setValueAtTime(f1 * 2.1, t);
    wh.frequency.linearRampToValueAtTime(f1 * (2.3 + Math.random() * 0.4), t + atk + hold);
    wh.frequency.linearRampToValueAtTime(f1 * 1.8, end);
    const whG = ctx.createGain();
    whG.gain.value = k > 0.6 ? 0.35 : 0.12;
    const g = ctx.createGain();
    const peak = 0.035 + 0.11 * k;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + atk + hold);
    g.gain.linearRampToValueAtTime(0, end);
    const pan = ctx.createStereoPanner();
    const p0 = (Math.random() * 2 - 1) * 0.8;
    pan.pan.setValueAtTime(p0, t);
    pan.pan.linearRampToValueAtTime(-p0 * 0.6, end);
    src.connect(bp).connect(g);
    src.connect(wh).connect(whG).connect(g);
    g.connect(pan).connect(this.amb);
    src.start(t, Math.random() * 3);
    src.stop(end + 0.1);
  }

  /** 0..1 how far into the last gust we are (for voices that ride the wind, e.g. wind-hollow). */
  private gustEnvelope(t: number) {
    const g = this.gustEv;
    const x = t - g.t0;
    if (x < 0 || x > g.atk + g.hold + g.rel) return 0;
    const e = x < g.atk ? x / g.atk : x < g.atk + g.hold ? 1 : 1 - (x - g.atk - g.hold) / g.rel;
    return e * g.k;
  }

  /** A cricket's chirp: three quick sine pulses. */
  private chirp(t: number, f: number, pan: number, level: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = f * (0.99 + Math.random() * 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const a = t + k * 0.045;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(level, a + 0.006);
      g.gain.linearRampToValueAtTime(0, a + 0.026);
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.amb);
    o.start(t);
    o.stop(t + 0.16);
  }

  /**
   * The night's far-off insect chorus: two narrow bands of noise trilled at different rates, very
   * quiet, swelling and thinning on a slow random walk so it never sits still.
   */
  private startChorus() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const level = ctx.createGain();
    level.gain.value = 0;
    level.connect(this.amb);
    const srcs: AudioScheduledSourceNode[] = [];
    for (const [f, q, rate, g] of [[4300, 9, 27, 1], [2950, 7, 38, 0.55]] as const) {
      const n = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const am = ctx.createGain();
      am.gain.value = 0.5 * g;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5 * g;
      lfo.connect(lfoG).connect(am.gain);
      n.connect(bp).connect(am).connect(level);
      n.start(t, Math.random() * 3);
      lfo.start(t);
      srcs.push(n, lfo);
    }
    this.chorus = {
      level, walk: 0.6, walkT: 0,
      stop: (w) => {
        for (const s of srcs) { try { s.stop(w); } catch { /* stopped */ } }
        setTimeout(() => level.disconnect(), (w - ctx.currentTime) * 1000 + 200);
      },
    };
  }

  /** Cicadas swelling somewhere off in the scrub on a hot afternoon. */
  private cicada() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const rise = 2 + Math.random() * 2, hold = 2 + Math.random() * 4, fall = 2.5 + Math.random() * 2;
    const end = t + rise + hold + fall;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4300 + Math.random() * 1200;
    bp.Q.value = 5;
    // the buzz: noise amplitude-modulated by a fast square wave
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 48 + Math.random() * 30;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const g = ctx.createGain();
    const peak = 0.018 + Math.random() * 0.014;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rise);
    g.gain.setValueAtTime(peak, t + rise + hold);
    g.gain.linearRampToValueAtTime(0, end);
    const p = ctx.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * 0.8;
    src.connect(bp).connect(am).connect(g).connect(p).connect(this.amb);
    src.start(t, Math.random() * 3);
    lfo.start(t);
    src.stop(end + 0.1);
    lfo.stop(end + 0.1);
  }

  /** A hawk circling far off on a hot day: one hoarse, falling "kee-eeer", mostly reverb. */
  private hawk() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.1;
    const dur = 1.3 + Math.random() * 0.5;
    const f0 = 2700 + Math.random() * 400;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.82, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.68, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    // the rasp
    const n = this.noiseSource(false);
    const nG = ctx.createGain();
    nG.gain.value = 1.4;
    const g = ctx.createGain();
    const peak = 0.0065 + Math.random() * 0.004;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.1);
    g.gain.setValueAtTime(peak, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * 0.8;
    const dry = ctx.createGain();
    dry.gain.value = 0.4;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    o.connect(bp);
    n.connect(nG).connect(bp);
    bp.connect(g).connect(p);
    p.connect(dry).connect(this.amb);
    p.connect(wet).connect(this.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
    n.start(t, Math.random() * 3, dur + 0.05);
  }

  /** A wolf of the pack you can see howls from `pos` (a second one often answers). */
  howl(pos: THREE.Vector3) {
    if (!this.started) return;
    this.coyote(pos);
  }

  /** A coyote howling far off (sometimes answered), soaked in the night air's reverb. From `pos` when given. */
  private coyote(pos?: THREE.Vector3) {
    const ctx = this.ctx;
    const pan = (Math.random() * 2 - 1) * 0.85;
    const out: AudioNode = pos ? this.panner(pos, 25, 0.8) : this.amb;
    if (pos) out.connect(this.amb);
    const voice = (t: number, k: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const f = (v: number) => v * k;
      o.frequency.setValueAtTime(f(330), t);
      o.frequency.exponentialRampToValueAtTime(f(690), t + 0.55);
      o.frequency.linearRampToValueAtTime(f(760), t + 1.6);
      o.frequency.exponentialRampToValueAtTime(f(500), t + 2.7);
      o.frequency.exponentialRampToValueAtTime(f(290), t + 3.0);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5 + Math.random();
      const vibG = ctx.createGain();
      vibG.gain.setValueAtTime(0, t);
      vibG.gain.linearRampToValueAtTime(f(10), t + 1.2);
      vib.connect(vibG).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.35);
      g.gain.setValueAtTime(level, t + 2.4);
      g.gain.linearRampToValueAtTime(0, t + 3.0);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = pos ? 2600 : 1500; // distance
      const p = ctx.createStereoPanner();
      p.pan.value = pos ? 0 : pan;
      const dry = ctx.createGain();
      dry.gain.value = pos ? 0.6 : 0.35;
      const wet = ctx.createGain();
      wet.gain.value = 0.9;
      o.connect(lp).connect(g).connect(p);
      p.connect(dry).connect(out);
      p.connect(wet).connect(this.reverbSend);
      o.start(t);
      vib.start(t);
      o.stop(t + 3.1);
      vib.stop(t + 3.1);
    };
    const t = ctx.currentTime + 0.1;
    const lv = pos ? 0.05 : 0.022;
    voice(t, pos ? 0.85 : 1, lv);
    if (Math.random() < 0.55) voice(t + 1.4 + Math.random(), (pos ? 0.95 : 1.12) + Math.random() * 0.1, lv * 0.7);
  }

  /** Thunder for dry lightning: `k` 0..1 closeness. Far = late, soft, low rumble; near = crack + boom. */
  thunder(k: number) {
    if (!this.started) return;
    const delay = 0.3 + (1 - k) * 2.8;
    const dur = 2.2 + (1 - k) * 2.5;
    if (k > 0.7) this.burst('bandpass', 900, 0.8, 0.35 * k, 0.25, delay - 0.15, this.amb);
    this.burst('lowpass', 140 + k * 120, 0.9, 0.9 * (0.4 + k * 0.6), dur, delay, this.amb);
    this.burst('lowpass', 70, 1.2, 0.7 * (0.5 + k * 0.5), dur * 1.3, delay + 0.25, this.amb);
  }

  /**
   * Dust-storm layers: sand hiss, a whistling howl, a deep buffeting rumble and grains ticking off
   * everything. Built when a storm begins and torn down a while after it clears (they used to run,
   * silent, all session).
   */
  private startStorm() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const srcs: AudioScheduledSourceNode[] = [];
    const outs: AudioNode[] = [];
    const layer = (gainOut: GainNode, ...chain: AudioNode[]) => {
      const src = this.noiseSource();
      let n: AudioNode = src;
      for (const c of chain) n = n.connect(c);
      n.connect(gainOut).connect(this.amb);
      src.start(t, Math.random() * 3);
      srcs.push(src);
      outs.push(gainOut);
    };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const hiss = ctx.createGain(), howl = ctx.createGain(), rumble = ctx.createGain(), sand = ctx.createGain();
    hiss.gain.value = howl.gain.value = rumble.gain.value = sand.gain.value = 0;
    layer(hiss, filt('highpass', 1800), filt('peaking', 4200, 0.6));
    const howlF = [filt('bandpass', 520, 7), filt('bandpass', 840, 9)];
    const pan = [ctx.createStereoPanner(), ctx.createStereoPanner()];
    pan[0].pan.value = -0.5;
    pan[1].pan.value = 0.5;
    layer(howl, howlF[0], pan[0]);
    layer(howl, howlF[1], pan[1]);
    layer(rumble, filt('lowpass', 140));
    // grains: the crackle buffer, fast and high, like sand rattling off metal and glass
    const grains = ctx.createBufferSource();
    grains.buffer = this.crackleBuf;
    grains.loop = true;
    grains.playbackRate.value = 1.7;
    grains.connect(filt('highpass', 4500)).connect(sand).connect(this.amb);
    grains.start(t, Math.random() * 2);
    srcs.push(grains);
    outs.push(sand);
    this.storm = {
      hiss, howl, howlF, rumble, sand,
      stop: (w) => {
        for (const s of srcs) { try { s.stop(w); } catch { /* stopped */ } }
        setTimeout(() => { for (const o of outs) o.disconnect(); }, (w - ctx.currentTime) * 1000 + 200);
      },
    };
  }

  /** The storm wall on the horizon: a low, distant roar from upwind that grows as it comes. */
  private startFront() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 230;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    n.connect(lp).connect(g).connect(pan).connect(this.amb);
    n.start(t, Math.random() * 3);
    this.frontRoar = {
      g, pan,
      stop: (w) => {
        try { n.stop(w); } catch { /* stopped */ }
        setTimeout(() => pan.disconnect(), (w - ctx.currentTime) * 1000 + 200);
      },
    };
  }

  /** Called every frame. */
  update(dt: number, camera: THREE.Camera, windStrength: number, tension: number, storm: number, scene: SoundScene) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const wind = Math.min(windStrength, 1.6);

    // the weather's own gusts: how far the wind is above its running mean right now
    this.windAvg += (windStrength - this.windAvg) * Math.min(1, dt / 6);
    const surgePrev = this.surge;
    this.surge = Math.max(0, windStrength - this.windAvg);
    this.gustNow = Math.min(1, Math.max(this.gustEnvelope(t), this.surge * 1.6));

    // indoors: the rays say how closed-in we are; the game can insist (the Garage house)
    const encTarget = Math.max(scene.inside ? 0.85 : 0, scene.room?.enclosure ?? 0);
    this.enclosed += (encTarget - this.enclosed) * Math.min(1, dt * 3);
    const inside = this.enclosed > 0.6;
    const outdoorsLife = !inside && storm < 0.2;

    // breeze: a slow random walk, from near-silent lulls to a steady blow, lifted by the weather's gusts
    this.breezeT -= dt;
    if (this.breezeT <= 0) {
      this.breezeT = 4 + Math.random() * 8;
      this.breezeTarget = Math.random() < 0.3 ? 0.05 : 0.2 + Math.random() * 0.8;
    }
    this.breezeLvl += (this.breezeTarget - this.breezeLvl) * Math.min(1, dt / 3);
    this.sceneT -= dt;
    const slow = this.sceneT <= 0; // the slow parameters only need updating ~10× a second
    if (slow) this.sceneT = 0.1;
    if (slow) {
      this.breeze.gain.gain.setTargetAtTime(0.012 + 0.04 * this.breezeLvl * wind + Math.min(0.04, this.surge * 0.05) + storm * 0.22, t, 0.4);
      this.breeze.f.frequency.setTargetAtTime(320 + this.breezeLvl * 300 + this.surge * 200 + storm * 500, t, 0.8);
    }

    // gusts come and go; more of them (and stronger) as the wind picks up, and one rides each of the
    // weather's surges (what makes the grass and dust lean is what you hear)
    this.gustT -= dt;
    const surgeRise = this.surge > 0.18 && surgePrev <= 0.18;
    if (this.gustT <= 0 || (surgeRise && t - this.gustEv.t0 > 4)) {
      const k = Math.min(1, (0.25 + Math.random() * 0.6) * (0.5 + wind * 0.6) + storm * 0.5 + this.surge * 0.6);
      this.gust(k);
      this.gustT = storm > 0.3 ? 1.5 + Math.random() * 3 : (8 + Math.random() * 16) / (0.5 + wind * 0.6);
    }

    // dust-storm layers: built when one starts, gone a while after it clears
    if (storm > 0.01 && !this.storm) this.startStorm();
    if (this.storm) {
      if (storm < 0.005) {
        this.stormIdle += dt;
        if (this.stormIdle > 6) { this.storm.stop(t + 0.5); this.storm = null; }
      } else this.stormIdle = 0;
    }
    if (this.storm && slow) {
      // the howl follows the weather's gusts; the buffet is the fast flutter on top
      const gust = Math.min(1, 0.35 + this.surge * 1.3 + 0.25 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.3));
      const buffet = 0.55 + 0.45 * Math.sin(t * 1.9) * Math.sin(t * 0.71 + 2.1);
      const s = this.storm;
      s.hiss.gain.setTargetAtTime(storm * 0.2 * (0.5 + buffet * 0.7), t, 0.25);
      s.howl.gain.setTargetAtTime(storm * storm * 0.32 * (0.3 + gust * 0.9), t, 0.6);
      s.howlF[0].frequency.setTargetAtTime(430 + gust * 260 + buffet * 60, t, 0.8);
      s.howlF[1].frequency.setTargetAtTime(760 + gust * 380, t, 0.9);
      s.rumble.gain.setTargetAtTime(storm * 0.7 * (0.4 + buffet * 0.6), t, 0.3);
      s.sand.gain.setTargetAtTime(storm * storm * 0.05 * (0.5 + gust * 0.6), t, 0.3);
    }

    // a storm on the horizon: its roar arrives before it does, from upwind
    const front = storm < 0.3 ? scene.front ?? 0 : 0;
    if (front > 0.02 && !this.frontRoar) this.startFront();
    if (this.frontRoar && slow) {
      const fr = this.frontRoar;
      if (front < 0.01 && storm < 0.01) { fr.g.gain.setTargetAtTime(0, t, 1); fr.stop(t + 4); this.frontRoar = null; }
      else {
        fr.g.gain.setTargetAtTime(front * front * 0.05 + storm * 0.03, t, 1.5);
        const wd = scene.windDir;
        if (wd) {
          // upwind is −windDir; pan by how far it sits to the listener's right
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          const l = Math.hypot(right.x, right.z) || 1;
          fr.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, (-wd.x * right.x - wd.y * right.z) / l)), t, 0.3);
        }
      }
    }

    // wildlife: crickets after dark (and by the campfire), cicadas on hot afternoons, a hawk by day,
    // coyotes far off at night (rarely)
    const h = scene.hour;
    const cricketTime = scene.mood === 'camp' || (scene.mood === 'play' && (h > 19.4 || h < 5.3));
    for (const c of this.crickets) {
      c.t -= dt;
      if (c.t <= 0) {
        c.on = !c.on && cricketTime && outdoorsLife;
        c.t = c.on ? 8 + Math.random() * 20 : 3 + Math.random() * 12;
        c.next = t + Math.random() * c.period;
      }
      if (c.on && !(cricketTime && outdoorsLife)) c.on = false;
      while (c.on && c.next < t + 0.2) {
        if (c.next > t - 0.05) this.chirp(c.next, c.f, c.pan, 0.012);
        c.next += c.period * (0.94 + Math.random() * 0.12);
      }
    }
    // the chorus behind them: only on a night outdoors in play (the camp has its own crickets)
    const chorusTime = scene.mood === 'play' && (h > 20 || h < 4.8) && outdoorsLife;
    if (chorusTime && !this.chorus) this.startChorus();
    if (this.chorus) {
      const c = this.chorus;
      c.walkT -= dt;
      if (c.walkT <= 0) { c.walkT = 5 + Math.random() * 9; c.walk = Math.random() < 0.2 ? 0.15 : 0.4 + Math.random() * 0.6; }
      if (slow) c.level.gain.setTargetAtTime(chorusTime ? 0.009 * c.walk : 0, t, 2.5);
      this.chorusIdle = chorusTime ? 0 : this.chorusIdle + dt;
      if (this.chorusIdle > 12) { c.stop(t + 0.1); this.chorus = null; this.chorusIdle = 0; }
    }
    this.wildlife?.update(dt, h, scene.mood === 'play' && outdoorsLife);
    if (scene.mood === 'play' && outdoorsLife) {
      this.cicadaT -= dt;
      if (this.cicadaT <= 0) {
        this.cicadaT = 18 + Math.random() * 35;
        if (h > 9.5 && h < 17.5) this.cicada();
      }
      this.hawkT -= dt;
      if (this.hawkT <= 0) {
        this.hawkT = 110 + Math.random() * 200;
        if (h > 7.5 && h < 18 && storm < 0.05) this.hawk();
      }
      this.coyoteT -= dt;
      if (this.coyoteT <= 0) {
        this.coyoteT = 100 + Math.random() * 160;
        if (scene.night) this.coyote();
      }
    }

    if (slow) {
      // indoors: the desert goes muffled and distant (gradually, with how closed-in it is)
      const e = Math.min(1, Math.max(0, (this.enclosed - 0.25) / 0.6));
      this.ambLP.frequency.setTargetAtTime(18000 * Math.pow(650 / 18000, e), t, 0.25);
      this.ambOut.gain.setTargetAtTime(1 - 0.55 * e, t, 0.25);
      // and the room answers: small rooms ring short and bright, halls and caves long and dark
      // (the mean wall distance; a rock floor means a cave, which rings long whatever its size)
      const size = scene.room?.size ?? 24;
      const large = Math.min(1, Math.max(0, (size - 4.5) / 4) + (scene.floor === 'rock' ? 0.5 : 0));
      const hard = HARDNESS[scene.floor ?? 'sand'];
      const wet = this.enclosed * (0.55 + 0.45 * hard);
      this.roomSmall.set(wet * (1 - large) * 0.3, t);
      this.roomLarge.set(wet * large * 0.4, t);
      this.foleyHall.gain.setTargetAtTime(0.3 * (1 - this.enclosed), t, 0.3);
    }

    this.score?.update({ mood: scene.mood, night: scene.night, tension, alarm: scene.alarm, combat: scene.combat });

    const l = this.ctx.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    }
    this.spots.update(p.x, p.y, p.z);
  }

  private panner(pos: THREE.Vector3, refDistance = 4, rolloff = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 200;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  /**
   * A positional loop of `kind` at `pos` (see ./ambient.ts for the voices). Returns a handle to move,
   * modulate or stop it. It only has nodes while the listener is within the kind's range.
   */
  loop(kind: AmbientKind, pos: THREE.Vector3): SpotHandle | null {
    if (!this.started) return null;
    if (!VOICES[kind]) return null;
    return this.spots.add(kind, pos);
  }

  /** Harness: what the score is doing about a fight. */
  get musicState() {
    return this.score?.fightState ?? null;
  }

  /** Positional loops: total and currently built (harness/bench). */
  get spotStats() {
    return this.started ? { count: this.spots.count, active: this.spots.active, roomSmall: this.roomSmall.active, roomLarge: this.roomLarge.active, enclosed: +this.enclosed.toFixed(2) } : null;
  }

  /**
   * Dev: render `seconds` of the given voices in an OfflineAudioContext and time it, so a voice's DSP
   * cost can be measured without the game. Returns milliseconds of CPU per second of audio.
   */
  async benchVoices(kinds: AmbientKind[], seconds = 10) {
    if (!this.started) return null;
    const sr = this.ctx.sampleRate;
    const off = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
    const env = this.voiceEnv(off, new Map());
    const voices = kinds.map((k, i) => {
      const spec = VOICES[k];
      const out = off.createGain();
      out.gain.value = spec.gain;
      const pan = off.createPanner();
      pan.panningModel = spec.hrtf ? 'HRTF' : 'equalpower';
      pan.positionX.value = i * 2 - kinds.length;
      pan.positionZ.value = -4;
      out.connect(pan).connect(off.destination);
      return spec.build(env, out);
    });
    // schedule as the game does (a short lookahead, every 0.1 s) by pausing the render
    for (const v of voices) v.tick?.(0, 0.15);
    for (let k = 1; k * 0.1 < seconds - 0.05; k++) {
      const t = k * 0.1;
      void off.suspend(t).then(() => {
        for (const v of voices) v.tick?.(t, t + 0.15);
        void off.resume();
      });
    }
    const t0 = performance.now();
    await off.startRendering();
    return +((performance.now() - t0) / seconds).toFixed(2);
  }

  // ---------- footsteps ----------

  /** One footstep on `surface` (`k` = stride intensity from the camera). */
  footstep(surface: Surface, k: number, opts: StepOpts = {}) {
    if (!this.started) return;
    this.stepFoot ^= 1;
    // ×1.3: level-matched to the old single 'step' sfx (offline renders, mean RMS)
    footstep({ ctx: this.ctx, noise: this.noiseBuf, dest: this.stepPan[this.stepFoot] }, surface, k * 1.3, opts);
  }

  /** Touchdown after a jump or fall on `surface`: `k` 0..1 how hard. */
  land(surface: Surface, k: number) {
    if (!this.started) return;
    landing({ ctx: this.ctx, noise: this.noiseBuf, dest: this.foley }, surface, k);
  }

  // ---------- one-shots ----------

  private breathT = 0;
  private breathIn = true;

  /**
   * Exertion breathing (call every frame). 0 = silent, 1 = gasping after a long sprint: breaths
   * get faster, louder and rougher. Inhale is higher and airier, exhale lower and longer.
   */
  breathe(dt: number, exertion: number) {
    if (!this.started) return;
    this.breathT -= dt;
    if (this.breathT > 0) return;
    if (exertion < 0.12) { this.breathT = 0.25; this.breathIn = true; return; }
    const period = 2.2 - exertion * 1.3; // seconds per breath cycle
    const inhale = this.breathIn;
    const dur = period * (inhale ? 0.42 : 0.52);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (inhale ? 1400 : 700) + Math.random() * 250 + exertion * 300;
    f.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    const peak = (inhale ? 0.05 : 0.075) * Math.min(1, exertion * 1.2);
    // soft swell, not a click: breath ramps in and out
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * (inhale ? 0.55 : 0.3));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(lp).connect(g).connect(this.sfx);
    n.start(t, Math.random() * 3, dur + 0.05);
    this.breathIn = !inhale;
    this.breathT = dur + (inhale ? 0.02 : period * 0.06);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, type: OscillatorType, peak: number, dur: number, when = 0, dest?: AudioNode, slideTo?: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(filterType: BiquadFilterType, freq: number, q: number, peak: number, dur: number, when = 0, dest?: AudioNode) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, dur);
    s.connect(f).connect(g).connect(dest ?? this.sfx);
    s.start(t, Math.random() * 3, dur + 0.1);
  }

  play(name: SfxName, opts: { pos?: THREE.Vector3; intensity?: number } = {}) {
    if (!this.started) return;
    const k = opts.intensity ?? 1;
    let dest: AudioNode | undefined;
    if (opts.pos) {
      const p = this.panner(opts.pos, 3);
      p.connect(this.sfx);
      p.connect(this.roomBus); // doors and impacts ring in the room you're in
      dest = p;
    }
    switch (name) {
      case 'step':
        this.burst('bandpass', 900 + Math.random() * 700, 1.2, 0.22 * k, 0.09, 0, dest);
        this.burst('lowpass', 180, 1, 0.3 * k, 0.07, 0, dest);
        break;
      case 'stepMetal':
        this.burst('bandpass', 2400, 4, 0.12 * k, 0.12, 0, dest);
        this.tone(320 + Math.random() * 40, 'triangle', 0.05 * k, 0.15, 0, dest);
        break;
      case 'land':
        // body weight onto the ground: low thump plus a scuff of grit
        this.burst('lowpass', 220, 1, 0.65 * k, 0.2, 0, dest);
        this.burst('bandpass', 1100 + Math.random() * 500, 1.4, 0.18 * k, 0.12, 0.012, dest);
        break;
      case 'thud':
        // a painful landing: heavy body impact and a grunt-like low tone
        this.burst('lowpass', 120, 1.2, 0.9 * k, 0.35, 0, dest);
        this.tone(95, 'triangle', 0.25 * k, 0.25, 0.02, dest, 60);
        this.burst('bandpass', 700, 2, 0.2 * k, 0.15, 0.03, dest);
        break;
      case 'bounce': {
        // small steel can hitting the ground: a dull knock plus a short metallic ring
        const f0 = 1900 + Math.random() * 500;
        this.burst('bandpass', 600 + Math.random() * 300, 2, 0.35 * k, 0.05, 0, dest);
        this.tone(f0, 'sine', 0.06 * k, 0.12, 0, dest);
        this.tone(f0 * 2.76, 'sine', 0.025 * k, 0.08, 0, dest);
        break;
      }
      case 'click':
        this.burst('highpass', 3500, 1, 0.25, 0.025, 0, dest);
        break;
      case 'pinSet':
        this.burst('highpass', 4000, 1, 0.35, 0.03, 0, dest);
        this.tone(1760, 'sine', 0.12, 0.25, 0.01, dest);
        this.tone(2637, 'sine', 0.06, 0.2, 0.01, dest);
        break;
      case 'pickStrain':
        this.tone(220 + Math.random() * 60, 'sawtooth', 0.03, 0.12, 0, dest);
        break;
      case 'pickBreak':
        this.burst('highpass', 2500, 2, 0.6, 0.08, 0, dest);
        this.tone(900, 'square', 0.1, 0.18, 0, dest, 120);
        break;
      case 'unlock':
        this.burst('bandpass', 1200, 3, 0.5, 0.06, 0, dest);
        this.burst('lowpass', 300, 1, 0.6, 0.15, 0.08, dest);
        this.tone(523.25, 'triangle', 0.12, 0.4, 0.12);
        this.tone(783.99, 'triangle', 0.12, 0.6, 0.22);
        break;
      case 'door':
        this.burst('lowpass', 140, 2, 0.8, 0.9, 0, dest);
        this.tone(60, 'sawtooth', 0.08, 1.0, 0, dest, 45);
        break;
      case 'pickup':
        this.tone(660, 'triangle', 0.12, 0.12);
        this.tone(990, 'triangle', 0.12, 0.2, 0.07);
        break;
      case 'intel':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 'sine', 0.1, 0.5, i * 0.08));
        this.burst('bandpass', 3000, 6, 0.08, 0.6);
        break;
      case 'levelUp':
        [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
          this.tone(f, 'sawtooth', 0.05, 0.8, i * 0.09);
          this.tone(f * 2, 'sine', 0.05, 0.6, i * 0.09);
        });
        break;
      case 'loot':
        [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, 'triangle', 0.1, 1.2, i * 0.12));
        this.tone(130.81, 'sawtooth', 0.06, 2.0);
        break;
      case 'ui':
        this.tone(1200, 'sine', 0.05, 0.05);
        break;
      case 'uiHover':
        this.tone(2200, 'sine', 0.02, 0.03);
        break;
      case 'uiConfirm':
        this.tone(880, 'triangle', 0.08, 0.08);
        this.tone(1320, 'triangle', 0.08, 0.12, 0.06);
        break;
      case 'deny':
        this.tone(180, 'square', 0.08, 0.15);
        this.tone(140, 'square', 0.08, 0.2, 0.12);
        break;
      case 'cans':
        for (let i = 0; i < 7; i++) {
          this.tone(1800 + Math.random() * 1600, 'triangle', 0.08, 0.15, i * 0.05 + Math.random() * 0.03, dest);
          this.burst('highpass', 5000, 2, 0.2, 0.04, i * 0.05, dest);
        }
        break;
      case 'zap':
        this.burst('bandpass', 3000, 0.5, 0.9, 0.5);
        this.tone(80, 'sawtooth', 0.4, 0.6, 0, undefined, 30);
        this.tone(1600, 'square', 0.1, 0.4, 0, undefined, 200);
        break;
      case 'emp':
        this.tone(1200, 'sine', 0.3, 1.2, 0, dest, 40);
        this.burst('lowpass', 400, 1, 0.9, 0.8, 0, dest);
        this.burst('bandpass', 6000, 1, 0.3, 1.0, 0.05, dest);
        break;
      case 'throw':
        this.burst('bandpass', 700, 0.7, 0.2, 0.18);
        break;
      case 'droneAlert':
        this.tone(880, 'square', 0.08, 0.1, 0, dest);
        this.tone(1320, 'square', 0.08, 0.1, 0.12, dest);
        break;
      case 'droneSputter':
        for (let i = 0; i < 5; i++) this.tone(140 - i * 18, 'sawtooth', 0.08, 0.12, i * 0.1, dest);
        break;
      case 'detectTick':
        this.tone(440 + k * 600, 'sine', 0.04, 0.05);
        break;
      case 'megaphone':
        this.burst('bandpass', 1800, 2, 0.25, 0.25, 0, dest);
        this.tone(1000, 'square', 0.04, 0.15, 0.02, dest);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.burst('bandpass', 600, 2, 0.25, 0.08, i * 0.16);
        break;
      case 'caw': {
        // a raven: two or three hoarse, falling croaks (a sawtooth through a nasal band, roughened)
        const n = 2 + Math.floor(Math.random() * 2), f0 = 520 + Math.random() * 120;
        for (let i = 0; i < n; i++) {
          const w = i * (0.28 + Math.random() * 0.08);
          this.tone(f0, 'sawtooth', 0.05 * k, 0.17, w, dest, f0 * 0.72);
          this.burst('bandpass', 1300, 3, 0.07 * k, 0.16, w, dest);
        }
        break;
      }
      case 'flap':
        // wings beating up off a perch: a few soft whumps of air
        for (let i = 0; i < 4; i++) this.burst('lowpass', 500 + Math.random() * 300, 0.8, (0.22 - i * 0.04) * k, 0.07, i * 0.11, dest);
        break;
      case 'scurry':
        // something small dashing through dry brush
        for (let i = 0; i < 5; i++) this.burst('bandpass', 2500 + Math.random() * 2500, 1.5, 0.05 * k, 0.03, i * 0.05 + Math.random() * 0.02, dest);
        break;
      case 'disarm':
        this.burst('highpass', 3000, 3, 0.3, 0.04);
        this.tone(600, 'triangle', 0.06, 0.15, 0.05);
        break;
    }
  }

  setAlarm(on: boolean, pos?: THREE.Vector3) {
    if (!this.started) return;
    if (on && !this.alarm) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 700;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1.6;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 260;
      lfo.connect(lfoG).connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const dest = pos ? this.panner(pos, 12, 0.6) : this.sfx;
      if (pos) dest.connect(this.sfx);
      osc.connect(lp).connect(gain).connect(dest);
      osc.start();
      lfo.start();
      this.alarm = { osc, gain, lfo };
    } else if (!on && this.alarm) {
      const { osc, gain, lfo } = this.alarm;
      const t = this.ctx.currentTime;
      gain.gain.setTargetAtTime(0.0001, t, 0.15);
      osc.stop(t + 0.8);
      lfo.stop(t + 0.8);
      this.alarm = null;
    }
  }
}

export type SfxName =
  | 'step' | 'stepMetal' | 'land' | 'click' | 'pinSet' | 'pickStrain' | 'pickBreak' | 'unlock' | 'door' | 'pickup'
  | 'intel' | 'levelUp' | 'loot' | 'ui' | 'uiHover' | 'uiConfirm' | 'deny' | 'cans' | 'zap' | 'emp' | 'throw'
  | 'droneAlert' | 'droneSputter' | 'detectTick' | 'megaphone' | 'eat' | 'disarm' | 'thud' | 'bounce' | 'caw' | 'flap' | 'scurry';


export type LoopHandle = SpotHandle;
