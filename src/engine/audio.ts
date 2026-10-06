import * as THREE from 'three/webgpu';
import { Music, type MusicMood } from './music';

/** What the world sounds like right now (fed by the game every frame). */
export interface SoundScene { mood: MusicMood; night: boolean; hour: number; inside: boolean; alarm: boolean }

/**
 * Fully procedural audio: an ambience that breathes (a soft breeze, passing gusts, insects by day,
 * crickets and coyotes at night, dust storms), a generative score (./music.ts), spatialised loops
 * (drone hum, fire, neon buzz) and synthesised one-shots. No audio files.
 */
export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambLP!: BiquadFilterNode;
  private ambOut!: GainNode;
  private breeze!: { gain: GainNode; f: BiquadFilterNode };
  private breezeLvl = 0.4;
  private breezeTarget = 0.4;
  private breezeT = 0;
  private gustT = 5;
  private cicadaT = 12;
  private coyoteT = 35;
  private crickets = [
    { f: 4450, period: 0.82, pan: -0.55, on: false, t: 2, next: 0 },
    { f: 4980, period: 1.07, pan: 0.6, on: false, t: 6, next: 0 },
    { f: 4120, period: 0.64, pan: 0.15, on: false, t: 11, next: 0 },
  ];
  private storm: { hiss: GainNode; howl: GainNode; howlF: BiquadFilterNode[]; rumble: GainNode } | null = null;
  private score: Music | null = null;
  private alarm: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private started = false;
  volume = { master: 0.8, music: 0.5, sfx: 0.9 };

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
    this.master.connect(comp).connect(makeup).connect(ctx.destination);
    this.master.gain.value = this.volume.master;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volume.sfx;
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverbSend);
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
    this.startWind();
    this.score = new Music(ctx, this.music, this.reverbSend, this.noiseBuf);
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
    this.startStorm();
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

  /** A coyote howling far off (sometimes answered), soaked in the night air's reverb. */
  private coyote() {
    const ctx = this.ctx;
    const pan = (Math.random() * 2 - 1) * 0.85;
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
      lp.frequency.value = 1500; // distance
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const dry = ctx.createGain();
      dry.gain.value = 0.35;
      const wet = ctx.createGain();
      wet.gain.value = 0.9;
      o.connect(lp).connect(g).connect(p);
      p.connect(dry).connect(this.amb);
      p.connect(wet).connect(this.reverbSend);
      o.start(t);
      vib.start(t);
      o.stop(t + 3.1);
      vib.stop(t + 3.1);
    };
    const t = ctx.currentTime + 0.1;
    voice(t, 1, 0.022);
    if (Math.random() < 0.55) voice(t + 1.4 + Math.random(), 1.12 + Math.random() * 0.1, 0.015);
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

  /** Dust-storm layers, silent until a storm: sand hiss, a whistling howl, and a deep buffeting rumble. */
  private startStorm() {
    const ctx = this.ctx;
    const layer = (gainOut: GainNode, ...chain: AudioNode[]) => {
      const src = this.noiseSource();
      let n: AudioNode = src;
      for (const c of chain) n = n.connect(c);
      n.connect(gainOut).connect(this.amb);
      src.start(0, Math.random() * 3);
    };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const hiss = ctx.createGain(), howl = ctx.createGain(), rumble = ctx.createGain();
    hiss.gain.value = howl.gain.value = rumble.gain.value = 0;
    layer(hiss, filt('highpass', 1800), filt('peaking', 4200, 0.6));
    const howlF = [filt('bandpass', 520, 7), filt('bandpass', 840, 9)];
    const pan = [ctx.createStereoPanner(), ctx.createStereoPanner()];
    pan[0].pan.value = -0.5;
    pan[1].pan.value = 0.5;
    layer(howl, howlF[0], pan[0]);
    layer(howl, howlF[1], pan[1]);
    layer(rumble, filt('lowpass', 140));
    this.storm = { hiss, howl, howlF, rumble };
  }

  /** Called every frame. */
  update(dt: number, camera: THREE.Camera, windStrength: number, tension: number, storm: number, scene: SoundScene) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const wind = Math.min(windStrength, 1.6);
    const outdoorsLife = !scene.inside && storm < 0.2;

    // breeze: a slow random walk, from near-silent lulls to a steady blow
    this.breezeT -= dt;
    if (this.breezeT <= 0) {
      this.breezeT = 4 + Math.random() * 8;
      this.breezeTarget = Math.random() < 0.3 ? 0.05 : 0.2 + Math.random() * 0.8;
    }
    this.breezeLvl += (this.breezeTarget - this.breezeLvl) * Math.min(1, dt / 3);
    this.breeze.gain.gain.setTargetAtTime(0.012 + 0.04 * this.breezeLvl * wind + storm * 0.22, t, 0.4);
    this.breeze.f.frequency.setTargetAtTime(320 + this.breezeLvl * 300 + storm * 500, t, 0.8);

    // gusts come and go; more of them (and stronger) as the wind picks up
    this.gustT -= dt;
    if (this.gustT <= 0) {
      const k = Math.min(1, (0.25 + Math.random() * 0.6) * (0.5 + wind * 0.6) + storm * 0.5);
      this.gust(k);
      this.gustT = storm > 0.3 ? 1.5 + Math.random() * 3 : (8 + Math.random() * 16) / (0.5 + wind * 0.6);
    }

    // dust-storm layers (silent otherwise)
    if (this.storm) {
      const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.3);
      const buffet = 0.55 + 0.45 * Math.sin(t * 1.9) * Math.sin(t * 0.71 + 2.1);
      const s = this.storm;
      s.hiss.gain.setTargetAtTime(storm * 0.2 * (0.5 + buffet * 0.7), t, 0.25);
      s.howl.gain.setTargetAtTime(storm * storm * 0.32 * (0.3 + gust * 0.9), t, 0.6);
      s.howlF[0].frequency.setTargetAtTime(430 + gust * 260 + buffet * 60, t, 0.8);
      s.howlF[1].frequency.setTargetAtTime(760 + gust * 380, t, 0.9);
      s.rumble.gain.setTargetAtTime(storm * 0.7 * (0.4 + buffet * 0.6), t, 0.3);
    }

    // wildlife: crickets after dark (and by the campfire), cicadas on hot afternoons, coyotes far off
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
    if (scene.mood === 'play' && outdoorsLife) {
      this.cicadaT -= dt;
      if (this.cicadaT <= 0) {
        this.cicadaT = 18 + Math.random() * 35;
        if (h > 9.5 && h < 17.5) this.cicada();
      }
      this.coyoteT -= dt;
      if (this.coyoteT <= 0) {
        this.coyoteT = 55 + Math.random() * 100;
        if (scene.night) this.coyote();
      }
    }

    // indoors: the desert goes muffled and distant
    this.ambLP.frequency.setTargetAtTime(scene.inside ? 650 : 18000, t, 0.25);
    this.ambOut.gain.setTargetAtTime(scene.inside ? 0.55 : 1, t, 0.25);

    this.score?.update({ mood: scene.mood, night: scene.night, tension, alarm: scene.alarm });

    const l = this.ctx.listener;
    const p = camera.position;
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
    void dt;
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

  /** Spatial looping sources. Returns a handle to move / modulate / stop it. */
  loop(kind: 'drone' | 'fire' | 'neon' | 'generator', pos: THREE.Vector3) {
    if (!this.started) return null;
    const ctx = this.ctx;
    const pan = this.panner(pos, kind === 'neon' ? 2 : 5);
    const out = ctx.createGain();
    out.connect(pan).connect(this.sfx);
    const nodes: AudioScheduledSourceNode[] = [];
    let timer: number | undefined;
    if (kind === 'drone') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.connect(out);
      for (const [f, type] of [[118, 'sawtooth'], [121.5, 'sawtooth'], [236, 'square']] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = type === 'square' ? 0.02 : 0.05;
        o.connect(g).connect(lp);
        o.start();
        nodes.push(o);
      }
      const n = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      const ng = ctx.createGain();
      ng.gain.value = 0.08;
      n.connect(bp).connect(ng).connect(out);
      n.start();
      nodes.push(n);
      out.gain.value = 0.9;
    } else if (kind === 'neon') {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 120;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 240;
      bp.Q.value = 3;
      o.connect(bp).connect(out);
      o.start();
      nodes.push(o);
      out.gain.value = 0.05;
    } else if (kind === 'generator') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 42;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const am = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      o.connect(lp).connect(am).connect(out);
      o.start();
      lfo.start();
      nodes.push(o, lfo);
      out.gain.value = 0.35;
    } else if (kind === 'fire') {
      // a soft, flickering bed (not a roar: that just reads as more wind) under crackles and pops
      const n = this.noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.value = 0.07;
      const flick = ctx.createOscillator();
      flick.frequency.value = 0.7;
      const flickG = ctx.createGain();
      flickG.gain.value = 0.03;
      flick.connect(flickG).connect(g.gain);
      n.connect(lp).connect(g).connect(out);
      n.start();
      flick.start();
      nodes.push(n, flick);
      const crackle = () => {
        const t = ctx.currentTime;
        const s = this.noiseSource(false);
        const f = ctx.createBiquadFilter();
        const pop = Math.random() < 0.08; // a knot in the wood: lower, louder, longer
        f.type = pop ? 'bandpass' : 'highpass';
        f.frequency.value = pop ? 500 + Math.random() * 400 : 1800 + Math.random() * 3000;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(pop ? 0.7 : 0.12 + Math.random() * 0.3, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + (pop ? 0.09 : 0.02 + Math.random() * 0.04));
        s.connect(f).connect(cg).connect(out);
        s.start(t, Math.random() * 3, 0.12);
        // crackles come in little clusters
        timer = window.setTimeout(crackle, Math.random() < 0.3 ? 15 + Math.random() * 40 : 80 + Math.random() * 380);
      };
      crackle();
      out.gain.value = 0.8;
    }
    return {
      setPosition(v: THREE.Vector3) {
        const t = ctx.currentTime;
        pan.positionX.setTargetAtTime(v.x, t, 0.05);
        pan.positionY.setTargetAtTime(v.y, t, 0.05);
        pan.positionZ.setTargetAtTime(v.z, t, 0.05);
      },
      setGain(g: number) {
        out.gain.setTargetAtTime(g, ctx.currentTime, 0.1);
      },
      setPitch(mult: number) {
        nodes.forEach((n) => {
          if (n instanceof OscillatorNode) n.detune.setTargetAtTime(1200 * Math.log2(mult), ctx.currentTime, 0.1);
        });
      },
      stop() {
        if (timer) clearTimeout(timer);
        nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
        out.disconnect();
      },
    };
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

  /** Megaphone taunt via speech synthesis when available (fails silently otherwise). */
  say(text: string) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.08;
      u.pitch = 0.7;
      u.volume = 0.55 * this.volume.master;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* no voices */
    }
  }
}

export type SfxName =
  | 'step' | 'stepMetal' | 'land' | 'click' | 'pinSet' | 'pickStrain' | 'pickBreak' | 'unlock' | 'door' | 'pickup'
  | 'intel' | 'levelUp' | 'loot' | 'ui' | 'uiHover' | 'uiConfirm' | 'deny' | 'cans' | 'zap' | 'emp' | 'throw'
  | 'droneAlert' | 'droneSputter' | 'detectTick' | 'megaphone' | 'eat' | 'disarm' | 'thud' | 'bounce';

export type LoopHandle = NonNullable<ReturnType<AudioEngine['loop']>>;
