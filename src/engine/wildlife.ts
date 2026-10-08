/**
 * The desert's own voices by hour, all synthesised and all far off (panned, a little reverb):
 *  - dawn and morning: mourning doves cooing, Gambel's quail calling "chi-CA-go", a cactus wren
 *    chattering like a car that won't start
 *  - dusk: a common poorwill repeating its name
 *  - night: a great horned owl's soft hoots, and now and then a coyote family yipping and wailing
 *    together (the lone howl lives in audio.ts)
 * Only outdoors, out of a storm and in play. Each call is a few short-lived nodes; nothing runs
 * between calls.
 */
export interface WildlifeBus {
  ctx: AudioContext;
  /** The ambience bus (muffled indoors). */
  out: AudioNode;
  /** The shared air reverb: distance. */
  reverb: AudioNode;
  noise: AudioBuffer;
}

interface Caller {
  /** Hours it calls in (wrapping past midnight when from > to). */
  from: number;
  to: number;
  /** Seconds between calls (min, max). */
  gap: [number, number];
  t: number;
  call: () => void;
}

const inHours = (h: number, a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Wildlife {
  private callers: Caller[];

  constructor(private b: WildlifeBus) {
    this.callers = [
      { from: 5.2, to: 9.5, gap: [9, 26], t: rand(3, 10), call: () => this.dove() },
      { from: 16.5, to: 19.2, gap: [25, 60], t: rand(10, 30), call: () => this.dove() },
      { from: 5.6, to: 10.5, gap: [14, 40], t: rand(6, 20), call: () => this.quail() },
      { from: 6.5, to: 13, gap: [30, 75], t: rand(15, 40), call: () => this.wren() },
      { from: 19.3, to: 5.4, gap: [22, 55], t: rand(8, 25), call: () => this.poorwill() },
      { from: 20.5, to: 5, gap: [55, 140], t: rand(20, 60), call: () => this.owl() },
      { from: 21, to: 4.5, gap: [170, 360], t: rand(60, 150), call: () => this.yips() },
    ];
  }

  /** Every frame. `live` = in play, outdoors, no storm. */
  update(dt: number, hour: number, live: boolean) {
    for (const c of this.callers) {
      c.t -= dt;
      if (c.t > 0) continue;
      c.t = rand(c.gap[0], c.gap[1]);
      if (live && inHours(hour, c.from, c.to)) c.call();
    }
  }

  /** A place in the stereo field and a distance: dry level, wet level. */
  private place(spread = 0.85, wet = 0.7) {
    const { ctx } = this.b;
    const p = ctx.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * spread;
    const dry = ctx.createGain();
    const far = Math.random();
    dry.gain.value = 1 - far * 0.55;
    const w = ctx.createGain();
    w.gain.value = wet * (0.6 + far * 0.6);
    p.connect(dry).connect(this.b.out);
    p.connect(w).connect(this.b.reverb);
    setTimeout(() => p.disconnect(), 20000);
    return p;
  }

  /** One sung note: an oscillator gliding f0 → f1 (→ f2) under a soft envelope. */
  private note(dest: AudioNode, t: number, type: OscillatorType, dur: number, level: number, f0: number, f1: number, f2?: number, atk = 0.04) {
    const { ctx } = this.b;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f2) {
      o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.4);
      o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    } else o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + atk);
    g.gain.setValueAtTime(level, t + Math.max(atk, dur - atk * 1.5));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A mourning dove: "hoo-OOO-oo ... oo ... oo", low and hollow (a sine with a faint second harmonic). */
  private dove() {
    const { ctx } = this.b;
    const t = ctx.currentTime + 0.1;
    const out = this.place(0.8, 0.8);
    const k = rand(0.92, 1.08);
    const lv = rand(0.01, 0.016);
    const song: [number, number, number, number, number?][] = [
      [0, 0.28, 470, 560],
      [0.3, 0.62, 600, 640, 470],
      [0.95, 0.4, 480, 455],
      [1.75, 0.5, 470, 445],
      [2.45, 0.5, 465, 440],
    ];
    const reps = Math.random() < 0.4 ? 2 : 1;
    for (let r = 0; r < reps; r++) {
      const base = t + r * rand(4.5, 6.5);
      for (const [at, dur, f0, f1, f2] of song) {
        this.note(out, base + at, 'sine', dur, lv, f0 * k, f1 * k, f2 && f2 * k, 0.07);
        this.note(out, base + at, 'sine', dur, lv * 0.18, f0 * k * 2, f1 * k * 2, f2 && f2 * k * 2, 0.07);
      }
    }
  }

  /** Gambel's quail: "chi-CA-go-go", nasal (a square through a narrow band), from the scrub. */
  private quail() {
    const { ctx } = this.b;
    const t = ctx.currentTime + 0.1;
    const out = this.place(0.9, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2000;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = 1;
    bp.connect(g).connect(out);
    const k = rand(0.94, 1.06);
    const lv = rand(0.012, 0.02);
    const calls = 1 + Math.floor(Math.random() * 3);
    for (let c = 0; c < calls; c++) {
      const b = t + c * rand(1.6, 2.4);
      this.note(bp, b, 'square', 0.08, lv * 0.6, 1550 * k, 1750 * k, undefined, 0.01);
      this.note(bp, b + 0.13, 'square', 0.17, lv, 2050 * k, 2350 * k, 2150 * k, 0.015);
      this.note(bp, b + 0.36, 'square', 0.1, lv * 0.7, 1850 * k, 1650 * k, undefined, 0.01);
      if (Math.random() < 0.6) this.note(bp, b + 0.5, 'square', 0.09, lv * 0.55, 1800 * k, 1620 * k, undefined, 0.01);
    }
    setTimeout(() => g.disconnect(), (calls * 2.5 + 1) * 1000);
  }

  /** A cactus wren: a run of harsh, even "chuh" notes, like an engine turning over and not catching. */
  private wren() {
    const { ctx } = this.b;
    const t = ctx.currentTime + 0.1;
    const out = this.place(0.9, 0.45);
    const n = 6 + Math.floor(Math.random() * 6);
    const gap = rand(0.085, 0.11);
    const lv = rand(0.035, 0.05);
    const f = rand(2300, 2900);
    for (let i = 0; i < n; i++) {
      const at = t + i * gap;
      // the rasp: noise in a band, plus a buzzy saw underneath
      const s = ctx.createBufferSource();
      s.buffer = this.b.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (1 - i * 0.008);
      bp.Q.value = 4;
      const g = ctx.createGain();
      const l = lv * (i === 0 ? 0.7 : 1) * (1 - (i / n) * 0.3);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(l, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.06);
      s.connect(bp).connect(g).connect(out);
      s.start(at, Math.random() * 3, 0.07);
      this.note(bp, at, 'sawtooth', 0.05, 0.5, f * 0.42, f * 0.38, undefined, 0.006);
    }
  }

  /** A common poorwill at dusk: "poor-WILL", the second note rising, said four or five times. */
  private poorwill() {
    const t = this.b.ctx.currentTime + 0.1;
    const out = this.place(0.85, 0.75);
    const reps = 3 + Math.floor(Math.random() * 4);
    const k = rand(0.95, 1.05);
    const lv = rand(0.006, 0.01);
    for (let r = 0; r < reps; r++) {
      const b = t + r * rand(1.05, 1.3);
      this.note(out, b, 'sine', 0.14, lv * 0.75, 1250 * k, 1320 * k, undefined, 0.02);
      this.note(out, b + 0.2, 'sine', 0.32, lv, 1450 * k, 1950 * k, 1800 * k, 0.03);
    }
  }

  /** A great horned owl: "hoo, h'hoo — hoo, hoo", deep and soft, more breath than tone. */
  private owl() {
    const { ctx } = this.b;
    const t = ctx.currentTime + 0.1;
    const out = this.place(0.75, 0.9);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(out);
    const f = rand(290, 340);
    const lv = rand(0.017, 0.025);
    const hoots: [number, number, number][] = [[0, 0.32, 1], [0.6, 0.12, 0.7], [0.76, 0.42, 1], [1.5, 0.32, 0.85], [2.05, 0.36, 0.8]];
    const reps = Math.random() < 0.5 ? 2 : 1;
    for (let r = 0; r < reps; r++) {
      const b = t + r * rand(6, 9);
      for (const [at, dur, a] of hoots) {
        this.note(lp, b + at, 'sine', dur, lv * a, f * 1.02, f * 0.96, undefined, 0.05);
        this.note(lp, b + at, 'triangle', dur, lv * a * 0.15, f * 2.04, f * 1.92, undefined, 0.05);
      }
    }
    setTimeout(() => lp.disconnect(), 20000);
  }

  /**
   * A coyote family going off at once: three voices of short falling yips and rising squeals over a
   * couple of wavering howls, for four or five seconds, then nothing.
   */
  private yips() {
    const { ctx } = this.b;
    const t = ctx.currentTime + 0.1;
    const out = this.place(0.6, 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.value = 1;
    lp.connect(g).connect(out);
    const len = rand(3.8, 5.5);
    for (let v = 0; v < 3; v++) {
      const k = rand(0.85, 1.25);
      const lv = rand(0.008, 0.014);
      let at = t + rand(0, 0.8);
      while (at < t + len) {
        const r = Math.random();
        if (r < 0.65) {
          // a yip: short, falling
          const d = rand(0.07, 0.14);
          this.note(lp, at, 'triangle', d, lv, 1250 * k, 820 * k, undefined, 0.01);
          at += d + rand(0.06, 0.25);
        } else if (r < 0.9) {
          // a squeal: up then down, fast
          const d = rand(0.25, 0.45);
          this.note(lp, at, 'triangle', d, lv * 0.9, 900 * k, 1500 * k, 1050 * k, 0.02);
          at += d + rand(0.1, 0.3);
        } else {
          // a wavering howl
          const d = rand(0.9, 1.4);
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.setValueAtTime(620 * k, at);
          o.frequency.exponentialRampToValueAtTime(980 * k, at + 0.25);
          o.frequency.exponentialRampToValueAtTime(700 * k, at + d);
          const vib = ctx.createOscillator();
          vib.frequency.value = rand(6, 8);
          const vg = ctx.createGain();
          vg.gain.value = 25 * k;
          vib.connect(vg).connect(o.frequency);
          const og = ctx.createGain();
          og.gain.setValueAtTime(0, at);
          og.gain.linearRampToValueAtTime(lv * 0.8, at + 0.12);
          og.gain.linearRampToValueAtTime(0, at + d);
          o.connect(og).connect(lp);
          o.start(at);
          vib.start(at);
          o.stop(at + d + 0.05);
          vib.stop(at + d + 0.05);
          at += d + rand(0.1, 0.3);
        }
      }
    }
    setTimeout(() => g.disconnect(), (len + 3) * 1000);
  }

  /** Harness: call one now. */
  test(kind: 'dove' | 'quail' | 'wren' | 'poorwill' | 'owl' | 'yips') {
    this[kind]();
  }
}
