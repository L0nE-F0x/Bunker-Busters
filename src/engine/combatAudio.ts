import * as THREE from 'three/webgpu';

/**
 * Combat sound, all synthesised: gunshots (a crack, a body thump, a bark and a long desert tail with
 * slapback off the far ridges), the speed of sound (a shot 300 m away is heard about a second after
 * its flash), bullets cracking past you, impacts by surface, reload foley, melee, wolves, people,
 * snakes, explosions, and the low-health heartbeat.
 *
 * Built by AudioEngine.start() with its buses. Positional one-shots go through an HRTF panner into the
 * sfx bus (and the room bus, so a shot in a cave rings).
 */
export interface CombatBus {
  ctx: AudioContext;
  noise: AudioBuffer;
  sfx: AudioNode;
  reverb: AudioNode;
  room: AudioNode;
  listener: () => THREE.Vector3;
}

export type GunKind = 'revolver' | 'shotgun' | 'rifle' | 'carbine' | 'turret';
export type ImpactKind = 'dirt' | 'rock' | 'metal' | 'flesh' | 'wood' | 'glass';
export type Foley =
  | 'dry' | 'cylOpen' | 'cylClose' | 'cylSpin' | 'round' | 'shell' | 'pumpBack' | 'pumpFwd' | 'leverOpen' | 'leverClose'
  | 'gate' | 'swing' | 'swingHeavy' | 'draw' | 'holster' | 'empty' | 'casing';
export type Creature = 'growl' | 'snarl' | 'bite' | 'yelp' | 'whimper' | 'rattle' | 'hiss' | 'click' | 'squelch' | 'bodyfall';

const SPEED_OF_SOUND = 343;

export class CombatAudio {
  private echo: { in: GainNode } | null = null;
  private hbT = 0;

  constructor(private b: CombatBus) {
    this.buildEcho();
  }

  /**
   * The desert answers a gunshot: a few lowpassed slapbacks off distant ridges (0.3–1.4 s) that
   * thin out, plus the hall reverb. One shared network; shots feed it at their own level.
   */
  private buildEcho() {
    const { ctx } = this.b;
    const input = ctx.createGain();
    input.gain.value = 1;
    const taps: [number, number, number][] = [[0.34, 0.32, -0.6], [0.61, 0.22, 0.55], [0.93, 0.15, -0.2], [1.37, 0.09, 0.7]];
    for (const [t, g, pan] of taps) {
      const d = ctx.createDelay(2);
      d.delayTime.value = t;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400 - t * 600;
      const gg = ctx.createGain();
      gg.gain.value = g;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      input.connect(d).connect(lp).connect(gg).connect(p).connect(this.b.sfx);
      gg.connect(this.b.reverb);
    }
    this.echo = { in: input };
  }

  private noiseSrc() {
    const s = this.b.ctx.createBufferSource();
    s.buffer = this.b.noise;
    s.loop = true;
    return s;
  }

  private panner(pos: THREE.Vector3, ref = 3, rolloff = 1.1) {
    const p = this.b.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 2000;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.b.sfx);
    p.connect(this.b.room);
    return p;
  }

  /** Enveloped noise through a filter. */
  private burst(dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, peak: number, attack: number, decay: number, fEnd?: number) {
    const ctx = this.b.ctx;
    const s = this.noiseSrc();
    const bf = ctx.createBiquadFilter();
    bf.type = type;
    bf.frequency.setValueAtTime(f, t);
    if (fEnd) bf.frequency.exponentialRampToValueAtTime(fEnd, t + attack + decay);
    bf.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(bf).connect(g).connect(dest);
    s.start(t, Math.random() * 3, attack + decay + 0.05);
    return g;
  }

  /** Enveloped oscillator with an optional pitch glide. */
  private tone(dest: AudioNode, t: number, type: OscillatorType, f: number, peak: number, attack: number, decay: number, fEnd?: number) {
    const ctx = this.b.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  /** A metallic ping: a few inharmonic partials, as off a steel plate or a gun's action. */
  private ping(dest: AudioNode, t: number, f: number, peak: number, decay: number) {
    for (const [m, k] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]]) this.tone(dest, t, 'sine', f * m, peak * k, 0.002, decay / Math.sqrt(m));
  }

  // ------------------------------------------------------------------ guns

  /**
   * A gunshot. `pos` absent = the player's own (dry, close, in the head). With `pos`, the sound
   * arrives after its travel time and loses its top end with distance.
   */
  gunshot(kind: GunKind, pos?: THREE.Vector3, opts: { suppressed?: boolean } = {}) {
    const ctx = this.b.ctx;
    const dist = pos ? pos.distanceTo(this.b.listener()) : 0;
    const t = ctx.currentTime + 0.005 + dist / SPEED_OF_SOUND;
    const far = Math.min(1, dist / 260);
    // close: a stereo-wide dry hit straight to the bus; far: positional, darker, quieter
    const out = pos ? this.panner(pos, 6, 0.9) : this.b.sfx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 16000 * Math.pow(1 - far * 0.92, 2) + 500;
    lp.connect(out);
    const k = { revolver: 1, shotgun: 1.25, rifle: 1.15, carbine: 0.85, turret: 0.6 }[kind];
    const low = { revolver: 140, shotgun: 105, rifle: 125, carbine: 150, turret: 190 }[kind];
    const lvl = (pos ? 1.0 : 0.6) * (opts.suppressed ? 0.4 : 1);
    // 1) the crack: a very short, bright noise spike
    this.burst(lp, t, 'highpass', 2600, 0.7, 1.6 * k * lvl * (1 - far * 0.6), 0.0015, 0.045 + (kind === 'rifle' ? 0.02 : 0));
    // 2) the body: a thump that drops in pitch (the chest-punch)
    this.tone(lp, t, 'sine', low * 1.6, 1.1 * k * lvl, 0.002, kind === 'shotgun' ? 0.24 : 0.16, low * 0.38);
    this.tone(lp, t, 'triangle', low * 3, 0.35 * k * lvl, 0.002, 0.07, low);
    // 3) the bark: midrange blast of expanding gas
    this.burst(lp, t, 'bandpass', kind === 'shotgun' ? 700 : 1000, 0.8, 1.1 * k * lvl, 0.003, kind === 'shotgun' ? 0.2 : 0.13, 380);
    this.burst(lp, t + 0.004, 'lowpass', 600, 0.6, 0.9 * k * lvl, 0.004, kind === 'shotgun' ? 0.38 : 0.26, 160);
    // 4) the action (close only): hammer fall / bolt
    if (!pos) {
      if (kind === 'revolver') this.ping(this.b.sfx, t - 0.004, 2400, 0.03, 0.06);
    }
    // 5) the tail: desert slapback + reverb, longer and louder in proportion far away
    const send = ctx.createGain();
    send.gain.value = (0.55 + far * 0.6) * k * lvl;
    lp.connect(send);
    if (this.echo) send.connect(this.echo.in);
    send.connect(this.b.reverb);
    // a far shot rolls: a low rumble after the report
    if (dist > 60) this.burst(out, t + 0.03, 'lowpass', 220, 0.5, 0.5 * k * lvl, 0.05, 0.9 + far, 90);
  }

  /** A bullet passing close by (`miss` = how close in metres): a snap and a tearing hiss. */
  whizz(pos: THREE.Vector3, miss: number) {
    const ctx = this.b.ctx;
    const t = ctx.currentTime + 0.01;
    const out = this.panner(pos, 1.2, 1.2);
    const k = Math.max(0.2, 1 - miss / 4);
    this.burst(out, t, 'highpass', 3500, 1, 0.9 * k, 0.001, 0.03);
    this.burst(out, t + 0.004, 'bandpass', 4200, 2, 0.5 * k, 0.03, 0.12, 1300);
  }

  /** A bullet striking something. */
  impact(kind: ImpactKind, pos: THREE.Vector3, k = 1) {
    const ctx = this.b.ctx;
    const dist = pos.distanceTo(this.b.listener());
    const t = ctx.currentTime + 0.003 + dist / SPEED_OF_SOUND;
    const out = this.panner(pos, 2.5, 1.2);
    switch (kind) {
      case 'dirt':
        this.burst(out, t, 'lowpass', 500, 0.7, 0.55 * k, 0.002, 0.09);
        this.burst(out, t + 0.01, 'bandpass', 2400, 1.2, 0.12 * k, 0.005, 0.22);
        break;
      case 'rock':
        this.burst(out, t, 'bandpass', 1800, 1.5, 0.6 * k, 0.001, 0.05);
        this.burst(out, t + 0.008, 'highpass', 3000, 1, 0.15 * k, 0.003, 0.18);
        if (Math.random() < 0.35) this.ricochet(out, t + 0.02, k);
        break;
      case 'metal':
        this.burst(out, t, 'bandpass', 2600, 2, 0.4 * k, 0.001, 0.03);
        this.ping(out, t, 900 + Math.random() * 1400, 0.2 * k, 0.5);
        if (Math.random() < 0.5) this.ricochet(out, t + 0.015, k);
        break;
      case 'wood':
        this.burst(out, t, 'bandpass', 700, 2.5, 0.6 * k, 0.001, 0.08);
        this.tone(out, t, 'triangle', 380, 0.12 * k, 0.001, 0.06, 300);
        break;
      case 'glass':
        this.burst(out, t, 'highpass', 4000, 1, 0.5 * k, 0.001, 0.25);
        for (let i = 0; i < 5; i++) this.ping(out, t + 0.02 + Math.random() * 0.15, 3000 + Math.random() * 3000, 0.04 * k, 0.15);
        break;
      case 'flesh':
        this.burst(out, t, 'lowpass', 380, 0.9, 0.85 * k, 0.002, 0.11);
        this.burst(out, t + 0.004, 'bandpass', 900, 1.4, 0.25 * k, 0.004, 0.08);
        break;
    }
  }

  private ricochet(out: AudioNode, t: number, k: number) {
    const ctx = this.b.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 2800 + Math.random() * 1600;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.42);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vg = ctx.createGain();
    vg.gain.value = 70;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * k, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.5);
    vib.stop(t + 0.5);
  }

  /** Mechanical handling sounds of the player's weapons (close, unpanned). */
  foley(kind: Foley, k = 1) {
    const ctx = this.b.ctx;
    const t = ctx.currentTime + 0.002;
    const o = this.b.sfx;
    switch (kind) {
      case 'dry':
        this.burst(o, t, 'highpass', 3200, 1, 0.3 * k, 0.001, 0.025);
        this.ping(o, t, 2100, 0.03 * k, 0.05);
        break;
      case 'cylOpen':
        this.burst(o, t, 'bandpass', 2600, 3, 0.25 * k, 0.001, 0.03);
        this.ping(o, t + 0.05, 1500, 0.04 * k, 0.1);
        break;
      case 'cylClose':
        this.burst(o, t, 'bandpass', 1900, 2, 0.35 * k, 0.001, 0.04);
        this.ping(o, t, 1100, 0.05 * k, 0.12);
        this.cylSpin(t + 0.06, k * 0.6);
        break;
      case 'cylSpin':
        this.cylSpin(t, k);
        break;
      case 'round':
        this.ping(o, t, 3200 + Math.random() * 400, 0.04 * k, 0.07);
        this.burst(o, t + 0.03, 'bandpass', 2200, 3, 0.12 * k, 0.001, 0.03);
        break;
      case 'shell':
        this.burst(o, t, 'bandpass', 1300, 2, 0.25 * k, 0.002, 0.05);
        this.burst(o, t + 0.07, 'bandpass', 2600, 3, 0.2 * k, 0.001, 0.03);
        break;
      case 'pumpBack':
        this.burst(o, t, 'bandpass', 1400, 1.5, 0.45 * k, 0.004, 0.07, 900);
        this.ping(o, t + 0.05, 1300, 0.05 * k, 0.08);
        break;
      case 'pumpFwd':
        this.burst(o, t, 'bandpass', 1700, 1.5, 0.5 * k, 0.003, 0.06, 2400);
        this.ping(o, t + 0.04, 1700, 0.06 * k, 0.1);
        break;
      case 'leverOpen':
        this.burst(o, t, 'bandpass', 1500, 2, 0.4 * k, 0.003, 0.05);
        this.ping(o, t + 0.02, 1250, 0.05 * k, 0.07);
        break;
      case 'leverClose':
        this.burst(o, t, 'bandpass', 2100, 2, 0.45 * k, 0.002, 0.05);
        this.ping(o, t + 0.01, 1800, 0.06 * k, 0.09);
        break;
      case 'gate':
        this.burst(o, t, 'bandpass', 2800, 3, 0.18 * k, 0.001, 0.03);
        this.ping(o, t + 0.015, 2600, 0.03 * k, 0.05);
        break;
      case 'swing':
        this.burst(o, t, 'bandpass', 600, 1.2, 0.35 * k, 0.07, 0.12, 2200);
        break;
      case 'swingHeavy':
        this.burst(o, t, 'bandpass', 420, 1, 0.5 * k, 0.09, 0.18, 1600);
        break;
      case 'draw':
        this.burst(o, t, 'bandpass', 1800, 1, 0.12 * k, 0.03, 0.08, 3000);
        this.ping(o, t + 0.08, 1900, 0.025 * k, 0.06);
        break;
      case 'holster':
        this.burst(o, t, 'bandpass', 900, 1, 0.12 * k, 0.03, 0.1, 500);
        break;
      case 'empty':
        this.tone(o, t, 'square', 210, 0.04 * k, 0.003, 0.08);
        break;
      case 'casing':
        for (let i = 0; i < 3; i++) this.ping(o, t + 0.35 + i * 0.09 + Math.random() * 0.03, 3600 + Math.random() * 900, 0.018 * k / (i + 1), 0.06);
        break;
    }
  }

  private cylSpin(t: number, k: number) {
    for (let i = 0; i < 9; i++) this.burst(this.b.sfx, t + i * 0.022 * (1 + i * 0.12), 'highpass', 4200, 1, 0.08 * k * (1 - i / 10), 0.001, 0.012);
  }

  /** Melee contact: `flesh`, `metal` (a prop, a drone), `hard` (rock, wall). Close, unpanned. */
  melee(kind: 'flesh' | 'metal' | 'hard', k = 1) {
    const t = this.b.ctx.currentTime + 0.002;
    const o = this.b.sfx;
    if (kind === 'flesh') {
      this.burst(o, t, 'lowpass', 260, 0.8, 1.0 * k, 0.003, 0.14);
      this.burst(o, t, 'bandpass', 1100, 1.4, 0.35 * k, 0.002, 0.06);
      this.tone(o, t, 'sine', 120, 0.5 * k, 0.002, 0.12, 60);
    } else if (kind === 'metal') {
      this.burst(o, t, 'bandpass', 2400, 1.5, 0.5 * k, 0.001, 0.05);
      this.ping(o, t, 620 + Math.random() * 200, 0.35 * k, 0.9);
    } else {
      this.burst(o, t, 'bandpass', 1500, 1.2, 0.6 * k, 0.001, 0.07);
      this.ping(o, t, 1300, 0.12 * k, 0.25);
    }
  }

  // ------------------------------------------------------------------ creatures & people

  /** Animal and human vocalisations at `pos`. `pitch` scales the voice (1 = default). */
  voice(kind: Creature, pos: THREE.Vector3, pitch = 1, k = 1) {
    const ctx = this.b.ctx;
    const dist = pos.distanceTo(this.b.listener());
    const t = ctx.currentTime + 0.01 + dist / SPEED_OF_SOUND;
    const out = this.panner(pos, 2.5, 1.1);
    switch (kind) {
      case 'growl': {
        // a low saw roughened by a fast tremolo, through the throat's formants
        this.formant(out, t, 'sawtooth', 92 * pitch, [[420, 6, 1], [900, 8, 0.5]], 0.22 * k, 0.2, 1.1, 28, 82 * pitch);
        break;
      }
      case 'snarl': {
        this.formant(out, t, 'sawtooth', 150 * pitch, [[700, 5, 1], [1600, 7, 0.6]], 0.3 * k, 0.04, 0.5, 45, 120 * pitch);
        this.burst(out, t, 'bandpass', 2500, 1.5, 0.12 * k, 0.03, 0.4);
        break;
      }
      case 'bite':
        this.burst(out, t, 'bandpass', 1800, 2, 0.6 * k, 0.001, 0.05);
        this.burst(out, t + 0.012, 'lowpass', 500, 1, 0.5 * k, 0.002, 0.08);
        break;
      case 'yelp': {
        const o = this.tone(out, t, 'triangle', 700 * pitch, 0.18 * k, 0.01, 0.32, 520 * pitch);
        o.frequency.setValueAtTime(700 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(1450 * pitch, t + 0.07);
        o.frequency.exponentialRampToValueAtTime(600 * pitch, t + 0.32);
        break;
      }
      case 'whimper':
        for (let i = 0; i < 2; i++) this.tone(out, t + i * 0.45, 'triangle', 900 * pitch, 0.07 * k, 0.05, 0.35, 620 * pitch);
        break;
      case 'rattle': {
        // the buzz: high noise chopped ~55 times a second
        const s = this.noiseSrc();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 7000;
        bp.Q.value = 1.2;
        const am = ctx.createGain();
        am.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 52 + Math.random() * 8;
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(am.gain);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16 * k, t + 0.05);
        g.gain.setValueAtTime(0.16 * k, t + 1.0);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        s.connect(bp).connect(am).connect(g).connect(out);
        s.start(t, Math.random() * 3, 1.35);
        lfo.start(t);
        lfo.stop(t + 1.35);
        break;
      }
      case 'hiss':
        this.burst(out, t, 'highpass', 3500, 0.8, 0.2 * k, 0.04, 0.5);
        break;
      case 'click':
        for (let i = 0; i < 4; i++) this.burst(out, t + i * 0.06 + Math.random() * 0.03, 'highpass', 5000, 2, 0.06 * k, 0.001, 0.01);
        break;
      case 'squelch': {
        // a radio keyed up across the flats: a click, a breath of static, a chirp on release. The
        // line itself is the subtitle; no synthesised voice (it never sounded like a person).
        this.burst(out, t, 'highpass', 3000, 1, 0.18 * k, 0.001, 0.012);
        this.burst(out, t + 0.01, 'bandpass', 2200, 0.9, 0.07 * k, 0.02, 0.22 + Math.random() * 0.2);
        this.tone(out, t + 0.32, 'square', 1450 * pitch, 0.025 * k, 0.003, 0.06, 1250 * pitch);
        break;
      }
      case 'bodyfall':
        this.burst(out, t, 'lowpass', 240, 0.8, 0.7 * k, 0.004, 0.22);
        this.burst(out, t + 0.12, 'lowpass', 320, 0.8, 0.35 * k, 0.003, 0.15);
        this.burst(out, t + 0.02, 'bandpass', 1400, 1.2, 0.12 * k, 0.003, 0.18);
        break;
    }
  }

  /** A voiced sound: an oscillator through parallel formant bandpasses, with optional tremolo. */
  private formant(out: AudioNode, t: number, type: OscillatorType, f0: number, formants: [number, number, number][], peak: number, attack: number, decay: number, trem: number, f1: number) {
    const ctx = this.b.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + decay * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    const sum = ctx.createGain();
    for (const [f, q, k] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = k * 3;
      o.connect(bp).connect(fg).connect(sum);
    }
    let src: AudioNode = sum;
    if (trem > 0) {
      const am = ctx.createGain();
      am.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = trem;
      const lg = ctx.createGain();
      lg.gain.value = 0.4;
      lfo.connect(lg).connect(am.gain);
      lfo.start(t);
      lfo.stop(t + attack + decay + 0.05);
      sum.connect(am);
      src = am;
    }
    src.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // ------------------------------------------------------------------ machines & blasts

  /** An explosion at `pos` (`k` 0..1 size). */
  explosion(pos: THREE.Vector3, k = 1) {
    const ctx = this.b.ctx;
    const dist = pos.distanceTo(this.b.listener());
    const t = ctx.currentTime + 0.01 + dist / SPEED_OF_SOUND;
    const out = this.panner(pos, 10, 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 * Math.pow(1 - Math.min(1, dist / 400) * 0.9, 2) + 300;
    lp.connect(out);
    this.burst(lp, t, 'highpass', 1800, 0.6, 1.4 * k, 0.002, 0.08);
    this.tone(lp, t, 'sine', 70, 1.6 * k, 0.004, 0.9, 28);
    this.burst(lp, t, 'lowpass', 900, 0.6, 1.4 * k, 0.006, 1.4, 120);
    this.burst(lp, t + 0.05, 'lowpass', 180, 0.5, 1.1 * k, 0.05, 2.6, 60);
    // debris pattering down
    for (let i = 0; i < 8; i++) this.burst(lp, t + 0.5 + Math.random() * 1.2, 'bandpass', 1200 + Math.random() * 2400, 2, 0.06 * k, 0.001, 0.04);
    const send = ctx.createGain();
    send.gain.value = 0.9 * k;
    lp.connect(send);
    if (this.echo) send.connect(this.echo.in);
    send.connect(this.b.reverb);
  }

  /** Small machine sounds at `pos`: a mine's arming beep, a turret's chime and servo, a drone's warble. */
  machine(kind: 'beep' | 'armed' | 'chime' | 'servo' | 'warble' | 'spinup' | 'down', pos: THREE.Vector3, k = 1) {
    const t = this.b.ctx.currentTime + 0.005;
    const out = this.panner(pos, 2, 1.1);
    switch (kind) {
      case 'beep':
        this.tone(out, t, 'square', 2600, 0.05 * k, 0.002, 0.07);
        break;
      case 'armed':
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.08, 'square', 3200, 0.06 * k, 0.002, 0.05);
        break;
      case 'chime':
        this.tone(out, t, 'sine', 880, 0.12 * k, 0.005, 0.5);
        this.tone(out, t + 0.16, 'sine', 1318.5, 0.12 * k, 0.005, 0.7);
        break;
      case 'servo':
        this.tone(out, t, 'sawtooth', 340, 0.025 * k, 0.04, 0.3, 520);
        this.burst(out, t, 'bandpass', 2400, 4, 0.03 * k, 0.04, 0.3);
        break;
      case 'warble':
        for (let i = 0; i < 4; i++) this.tone(out, t + i * 0.1, 'square', i % 2 ? 1500 : 1100, 0.05 * k, 0.003, 0.08);
        break;
      case 'spinup':
        this.tone(out, t, 'sawtooth', 120, 0.05 * k, 0.4, 0.2, 900);
        break;
      case 'down':
        this.tone(out, t, 'sawtooth', 700, 0.06 * k, 0.01, 0.9, 50);
        this.burst(out, t, 'bandpass', 3000, 1, 0.2 * k, 0.002, 0.4);
        break;
    }
  }

  // ------------------------------------------------------------------ player feedback

  /** Your own hit landing: a tick for a hit, a deeper double tick for a kill, a ping for a headshot. */
  hitmark(kind: 'hit' | 'head' | 'kill') {
    const t = this.b.ctx.currentTime + 0.01;
    const o = this.b.sfx;
    if (kind === 'kill') {
      this.tone(o, t, 'triangle', 520, 0.08, 0.002, 0.08);
      this.tone(o, t + 0.07, 'triangle', 390, 0.08, 0.002, 0.14);
    } else if (kind === 'head') {
      this.ping(o, t, 1900, 0.06, 0.18);
    } else {
      this.tone(o, t, 'triangle', 1400, 0.05, 0.001, 0.04);
    }
  }

  /** You got hit: an impact in your own body plus a breath knocked out of you. */
  hurt(kind: 'bullet' | 'bite' | 'blast' | 'melee' | 'poison', k = 1) {
    const t = this.b.ctx.currentTime + 0.003;
    const o = this.b.sfx;
    if (kind !== 'poison') {
      this.burst(o, t, 'lowpass', 220, 0.8, 0.9 * k, 0.002, 0.18);
      this.tone(o, t, 'sine', 90, 0.55 * k, 0.002, 0.2, 45);
    }
    if (kind === 'bullet') this.burst(o, t, 'bandpass', 2400, 1.2, 0.25 * k, 0.001, 0.05);
    // the wind knocked out of you: a sharp, breathy exhale (noise, not a synthesised voice)
    this.burst(o, t + 0.03, 'bandpass', 900 + Math.random() * 200, 0.9, 0.16 * k, 0.012, 0.24, 520);
  }

  /** Low-health heartbeat: call every frame with 0..1 how close to death. */
  heartbeat(dt: number, k: number) {
    this.hbT -= dt;
    if (k < 0.05 || this.hbT > 0) return;
    const period = 1.05 - k * 0.45;
    this.hbT = period;
    const t = this.b.ctx.currentTime + 0.01;
    const o = this.b.sfx;
    this.tone(o, t, 'sine', 62, 0.42 * k, 0.012, 0.13, 40);
    this.tone(o, t + 0.2, 'sine', 55, 0.3 * k, 0.012, 0.16, 38);
  }
}
