/**
 * Generative score. No audio files: instruments are synthesised (Karplus-Strong plucked guitar and
 * bass rendered into buffers, oscillator pads and whistle, synth drums), notes come from a small
 * composition engine in D minor with a spaghetti-western flavour.
 *
 * Moods:
 *  - title: the main theme (a written whistle melody over guitar), looping
 *  - camp:  character select by the fire: sparse night guitar
 *  - play:  "cues" of a minute or two (pad → guitar → bass → melody), then a stretch of silence
 *           so the world gets to breathe. Independent stems on the same clock: a palm-muted pulse
 *           that rises with drone suspicion, and drums when the alarm goes off.
 */

export type MusicMood = 'off' | 'title' | 'camp' | 'play';
export interface MusicFrame { mood: MusicMood; night: boolean; tension: number; alarm: boolean }

const BPM = 72;
const BEAT = 60 / BPM;
const LOOKAHEAD = 0.35;
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ harmony
interface Chord { root: number; pcs: number[] } // root pitch class, chord pitch classes (root first)
const CH: Record<string, Chord> = {
  Dm: { root: 2, pcs: [2, 5, 9] },
  Dm9: { root: 2, pcs: [2, 5, 9, 4] },
  Gm: { root: 7, pcs: [7, 10, 2] },
  Gm7: { root: 7, pcs: [7, 10, 2, 5] },
  Bb: { root: 10, pcs: [10, 2, 5] },
  Bbmaj7: { root: 10, pcs: [10, 2, 5, 9] },
  F: { root: 5, pcs: [5, 9, 0] },
  Fmaj7: { root: 5, pcs: [5, 9, 0, 4] },
  C: { root: 0, pcs: [0, 4, 7] },
  A: { root: 9, pcs: [9, 1, 4] },
  Asus: { root: 9, pcs: [9, 2, 4] },
  Am: { root: 9, pcs: [9, 0, 4] },
  D: { root: 2, pcs: [2, 6, 9] },
};
const SCALE = [2, 4, 5, 7, 9, 10, 0]; // D natural minor
const DAY_PROGS = [['Dm', 'Bb', 'F', 'C'], ['Dm', 'C', 'Bb', 'A'], ['Dm', 'Gm', 'Bb', 'A'], ['F', 'C', 'Dm', 'Bb'], ['Dm', 'Bb', 'Gm', 'A']];
const NIGHT_PROGS = [['Dm9', 'Bbmaj7', 'Gm7', 'Asus'], ['Dm9', 'Fmaj7', 'Gm7', 'Dm9'], ['Bbmaj7', 'Fmaj7', 'Gm7', 'Asus'], ['Dm9', 'Gm7', 'Bbmaj7', 'Am']];

/** All midi notes of the chord between lo and hi, ascending. */
function voicing(c: Chord, lo: number, hi: number) {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (c.pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}
const rootIn = (c: Chord, lo: number) => { let m = lo; while (((m % 12) + 12) % 12 !== c.root) m++; return m; };
const scaleIn = (lo: number, hi: number) => { const o: number[] = []; for (let m = lo; m <= hi; m++) if (SCALE.includes(m % 12)) o.push(m); return o; };

// ------------------------------------------------------------------ the main theme (title screen)
// 8 bars, one chord per bar. Whistle melody as [midi | 0 (rest), beats].
const THEME_CHORDS = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Gm', 'A', 'A'];
const THEME_MELODY: [number, number][] = [
  [69, 1], [74, 1], [77, 1.5], [76, 0.5], //  Dm   A  D  F . E
  [74, 2.5], [0, 1.5], //                     Dm   D ...
  [74, 1], [77, 1], [79, 1.5], [77, 0.5], //  Bb   D  F  G . F
  [76, 2], [72, 1], [76, 1], //               C    E    C  E
  [81, 1.5], [79, 0.5], [77, 1], [76, 1], //  Dm   A . G  F  E
  [74, 1], [79, 2], [77, 1], //               Gm   D  G    F
  [76, 1.5], [73, 0.5], [76, 1], [81, 1], //  A    E . C# E  A
  [81, 3], [0, 1], //                         A    A ......
];

// ------------------------------------------------------------------ arpeggio patterns (8 eighths per bar)
const ARPS: number[][] = [
  [0, 2, 1, 3, 0, 2, 1, 3], // travis-ish
  [0, 1, 2, 3, 4, 3, 2, 1], // rise and fall
  [0, -1, 2, -1, 1, -1, 3, -1], // sparse
  [0, -1, -1, 2, -1, 3, -1, -1], // open
  [0, 3, 2, 3, 1, 3, 2, 3], // pedal on top
];

interface Section {
  kind: 'theme' | 'cue' | 'rest';
  chords: string[]; // one per bar
  bars: number;
  bar: number;
  pad: boolean[]; arp: number[]; bass: boolean[]; melody: ('whistle' | 'guitar' | null)[]; // per bar
  arpPattern: number[];
  density: number;
}

// small deterministic RNG so a cue's motif can repeat (that's what makes it sound composed)
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export class Music {
  private bus: GainNode;
  private guitarBus: GainNode;
  private padBus: GainNode;
  private padFilter: BiquadFilterNode;
  private whistleBus: GainNode;
  private pulseBus: GainNode;
  private drumBus: GainNode;
  private stingBus: GainNode;
  private plucks = new Map<string, AudioBuffer>();
  private mood: MusicMood = 'off';
  private pendingMood: MusicMood = 'off';
  private night = false;
  private tension = 0;
  private alarm = false;
  private nextBeat = 0;
  private beat = 0; // global beat counter (4 per bar)
  private section: Section | null = null;
  private restUntilBar = 0;
  private timer: number;
  /** When a mood change may take over (after the old music has faded). */
  private switchAt = 0;
  /** Long-held voices (pads, whistle) so a mood change can fade them instead of letting them ring on. */
  private live = new Set<{ g: GainNode; srcs: AudioScheduledSourceNode[] }>();

  constructor(private ctx: AudioContext, out: AudioNode, reverb: AudioNode, private noise: AudioBuffer) {
    const g = (v: number, dest: AudioNode) => { const n = ctx.createGain(); n.gain.value = v; n.connect(dest); return n; };
    this.bus = g(0, out);
    // a dotted-eighth echo with a darkening feedback loop: the desert-western slapback
    const echo = ctx.createDelay(2);
    echo.delayTime.value = BEAT * 0.75;
    const fb = g(0.3, echo);
    const fbLp = ctx.createBiquadFilter();
    fbLp.type = 'lowpass';
    fbLp.frequency.value = 2400;
    echo.connect(fbLp).connect(fb);
    const echoOut = g(0.35, this.bus);
    fbLp.connect(echoOut);
    const rev = (v: number) => g(v, reverb);

    // guitar body: a little low-mid warmth, rolled-off top
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.gain.value = 3;
    const top = ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 5200;
    body.connect(top);
    top.connect(this.bus);
    top.connect(echo);
    top.connect(rev(0.35));
    this.guitarBus = g(1, body);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.7;
    this.padBus = g(1, this.padFilter);
    this.padFilter.connect(this.bus);
    this.padFilter.connect(rev(0.6));

    this.whistleBus = g(1, this.bus);
    this.whistleBus.connect(echo);
    this.whistleBus.connect(rev(0.9));

    this.pulseBus = g(0, this.bus);
    this.drumBus = g(0, this.bus);
    this.drumBus.connect(rev(0.15));
    this.stingBus = g(1, this.bus);
    this.stingBus.connect(rev(0.8));
    this.stingBus.connect(echo);

    this.nextBeat = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  /** Every frame. */
  update(f: MusicFrame) {
    const t = this.ctx.currentTime;
    this.night = f.night;
    this.tension = f.tension;
    this.alarm = f.alarm;
    if (f.mood !== this.pendingMood) {
      this.pendingMood = f.mood;
      // fade out what's playing; the new mood starts on the first bar after the fade
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setTargetAtTime(0, t, 0.3);
      this.switchAt = t + 1.2;
    }
    const pulse = f.mood === 'play' ? Math.min(1, Math.max(0, (f.tension - 0.12) / 0.5)) : 0;
    this.pulseBus.gain.setTargetAtTime(pulse * 0.9, t, pulse > 0 ? 0.6 : 1.5);
    this.drumBus.gain.setTargetAtTime(f.mood === 'play' && f.alarm ? 0.6 : 0, t, f.alarm ? 0.3 : 2);
    // suspicion brightens and thickens the pad; night keeps it dark
    this.padFilter.frequency.setTargetAtTime((this.night ? 650 : 950) + f.tension * 1600, t, 0.8);
  }

  /** One-off cues, not quantised to the bar. */
  sting(kind: 'busted' | 'caught') {
    const t = this.ctx.currentTime + 0.05;
    if (kind === 'busted') {
      // D major: a strummed chord, a swell, and the whistle climbing out
      const strum = [50, 57, 62, 66, 69, 74];
      strum.forEach((m, i) => this.pluck(m, t + i * 0.035, 0.32, this.stingBus));
      [62, 66, 69, 74].forEach((m) => this.padVoice(m, t, 6, 0.05, this.stingBus));
      this.whistle([[74, 0.5], [78, 0.5], [81, 1], [86, 3]], t + BEAT * 1, this.stingBus, 0.07);
      this.restUntilBar = this.barNow() + 6; // let it ring before the next cue
      this.section = null;
    } else {
      // a low, sour hit
      [38, 39, 45].forEach((m) => this.pluck(m, t, 0.5, this.stingBus, 'mute'));
      [50, 51].forEach((m) => this.padVoice(m, t, 3, 0.05, this.stingBus));
      this.kick(t, 1.2, this.stingBus);
    }
  }

  dispose() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ scheduler
  private barNow() { return Math.floor(this.beat / 4); }

  private schedule() {
    const now = this.ctx.currentTime;
    if (this.nextBeat < now - 0.5) this.nextBeat = now + 0.05; // tab was asleep: don't machine-gun the backlog
    while (this.nextBeat < now + LOOKAHEAD) {
      if (this.beat % 4 === 0) this.onBar(this.nextBeat);
      for (let e = 0; e < 2; e++) this.onEighth((this.beat % 4) * 2 + e, this.nextBeat + e * BEAT * 0.5);
      this.beat++;
      this.nextBeat += BEAT;
    }
  }

  private onBar(t: number) {
    if (this.pendingMood !== this.mood) {
      if (t < this.switchAt) return;
      this.mood = this.pendingMood;
      this.section = null;
      this.lastWasCue = false;
      for (const v of this.live) {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(0, t);
        for (const n of v.srcs) n.stop(t + 0.05);
      }
      this.live.clear();
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(this.mood === 'off' ? 0 : 1, t);
      // title starts right away; in the world, let the ambience have the first stretch
      this.restUntilBar = this.mood === 'play' ? this.barNow() + 3 + Math.floor(Math.random() * 3) : 0;
    }
    if (this.mood === 'off') return;
    const bar = this.barNow();
    if (!this.section || this.section.bar >= this.section.bars) {
      if (bar < this.restUntilBar) { this.section = null; return; }
      this.section = this.plan();
      if (this.section.kind === 'rest') {
        this.restUntilBar = bar + this.section.bars;
        this.section = null;
        return;
      }
    }
    const s = this.section;
    const ci = s.bar;
    const chord = CH[s.chords[ci]];
    const prev = ci > 0 ? s.chords[ci - 1] : null;
    if (s.pad[ci] && s.chords[ci] !== prev) {
      // hold the pad until the chord changes
      let len = 1;
      while (ci + len < s.bars && s.chords[ci + len] === s.chords[ci]) len++;
      const notes = voicing(chord, 52, 67).slice(0, 4);
      for (const m of notes) this.padVoice(m, t, len * 4 * BEAT + 0.4, this.mood === 'camp' ? 0.018 : 0.026, this.padBus);
      this.padVoice(rootIn(chord, 38), t, len * 4 * BEAT + 0.4, 0.016, this.padBus, 'sine');
    }
    if (s.bass[ci]) {
      const r = rootIn(chord, 33);
      this.pluck(r, t + 0.01, 0.42, this.guitarBus, 'bass');
      if (Math.random() < 0.6) this.pluck(r + 7 > 47 ? r - 5 : r + 7, t + BEAT * 2 + 0.01, 0.3, this.guitarBus, 'bass');
    }
    const mel = s.melody[ci];
    if (mel === 'whistle' && s.kind === 'theme') {
      if (ci === 0) this.whistle(THEME_MELODY, t, this.whistleBus, 0.05);
    } else if (mel && ci % 2 === 0) {
      const notes = this.motif(s, ci);
      if (mel === 'whistle') this.whistle(notes, t, this.whistleBus, this.night ? 0.035 : 0.045);
      else this.guitarLine(notes, t);
    }
    s.bar++;
  }

  private onEighth(i: number, t: number) {
    const s = this.section;
    const bar = s ? s.bar - 1 : -1; // onBar already advanced
    const chordName = s && bar >= 0 ? s.chords[bar] : 'Dm';
    const chord = CH[chordName];
    // arpeggio
    if (s && bar >= 0 && s.arp[bar] > 0) {
      const idx = s.arpPattern[i];
      const v = voicing(chord, 55, 76);
      if (idx >= 0 && Math.random() < s.arp[bar] * s.density) {
        const m = v[Math.min(idx, v.length - 1)];
        const swing = i % 2 ? 0.035 : 0;
        this.pluck(m, t + swing + (Math.random() - 0.5) * 0.012, (i === 0 ? 0.2 : 0.13) * (0.8 + Math.random() * 0.4), this.guitarBus);
      }
    }
    // tension pulse: palm-muted low string on every eighth, accents on the beat
    if (this.mood === 'play' && this.tension > 0.12) {
      const r = rootIn(chord, 38);
      const acc = i % 2 === 0;
      this.pluck(i === 6 && this.tension > 0.6 ? r + 1 : r, t, acc ? 0.34 : 0.22, this.pulseBus, 'mute');
      // heartbeat: lub-dub once a bar, twice when it's close
      if (this.tension > 0.45 && (i === 0 || (this.tension > 0.75 && i === 4))) this.kick(t, 0.5, this.pulseBus);
      if (this.tension > 0.45 && (i === 1 || (this.tension > 0.75 && i === 5))) this.kick(t - 0.1, 0.3, this.pulseBus);
    }
    // alarm drums
    if (this.mood === 'play' && this.alarm) {
      if (i === 0 || i === 4 || i === 5) this.kick(t, 0.9, this.drumBus);
      if (i === 2 || i === 6) this.snare(t);
      this.hat(t, i % 2 ? 0.05 : 0.09);
      if (this.barNow() % 4 === 3 && i >= 6) this.tom(t, i === 6 ? 140 : 110);
    }
  }

  /** What plays next. */
  private plan(): Section {
    const night = this.night;
    const fill = (n: number, v: boolean) => Array<boolean>(n).fill(v);
    if (this.mood === 'title') {
      // theme, then a variation with the melody on guitar; loops forever
      const bars = 16;
      this.motifSeed = 1284;
      const chords = [...THEME_CHORDS, ...THEME_CHORDS];
      return {
        kind: 'theme', chords, bars, bar: 0,
        pad: fill(bars, true), arp: [...Array(8).fill(0.75), ...Array(8).fill(1)], bass: [...fill(4, false), ...fill(12, true)],
        melody: [...Array(8).fill('whistle'), ...Array(8).fill('guitar')], arpPattern: ARPS[0], density: 1,
      };
    }
    if (this.mood === 'camp') {
      const prog = NIGHT_PROGS[Math.floor(Math.random() * NIGHT_PROGS.length)];
      const chords = prog.flatMap((c) => [c, c]);
      return { kind: 'cue', chords, bars: 8, bar: 0, pad: fill(8, true), arp: fill(8, true).map(() => 0.8), bass: fill(8, false), melody: Array(8).fill(null), arpPattern: ARPS[3], density: 0.9 };
    }
    // play: a cue (pad → guitar → bass → melody → thin out), then rest
    if (this.lastWasCue) {
      this.lastWasCue = false;
      return { kind: 'rest', chords: [], bars: 10 + Math.floor(Math.random() * 12), bar: 0, pad: [], arp: [], bass: [], melody: [], arpPattern: [], density: 0 };
    }
    this.lastWasCue = true;
    const pool = night ? NIGHT_PROGS : DAY_PROGS;
    const prog = pool[Math.floor(Math.random() * pool.length)];
    const cycles = 3 + (Math.random() < 0.5 ? 1 : 0);
    const chords: string[] = [];
    for (let c = 0; c < cycles; c++) for (const ch of prog) chords.push(ch, ch);
    chords.push('Dm', 'Dm'); // outro
    const bars = chords.length;
    const pad: boolean[] = [], arp: number[] = [], bass: boolean[] = [], melody: ('whistle' | 'guitar' | null)[] = [];
    const lead = night || Math.random() < 0.4 ? 'guitar' : 'whistle';
    for (let b = 0; b < bars; b++) {
      const c = Math.floor(b / 8);
      const outro = b >= bars - 2;
      pad.push(true);
      arp.push(outro ? (b === bars - 2 ? 0.5 : 0) : c === 0 ? 0.5 : c === cycles - 1 ? 0.7 : 1);
      bass.push(!outro && c >= 1 && !(night && c === 1));
      melody.push(!outro && c >= 2 ? lead : null);
    }
    this.motifSeed = Math.floor(Math.random() * 1e9);
    return { kind: 'cue', chords, bars, bar: 0, pad, arp, bass, melody, arpPattern: ARPS[Math.floor(Math.random() * ARPS.length)], density: night ? 0.75 : 0.9 };
  }
  private lastWasCue = false;
  private motifSeed = 1;

  /**
   * A two-bar phrase over the current chord. The rhythm and contour come from the cue's seed (so
   * phrases rhyme with each other); pitches are fitted to whatever chord is underneath.
   */
  private motif(s: Section, bar: number): [number, number][] {
    const r = rng(this.motifSeed + (bar % 8 >= 4 ? 7 : 0)); // call (bars 0–3) and answer (4–7)
    const RHYTHMS = [[1.5, 0.5, 1, 1, 2, 2], [1, 1, 1, 1, 3, 1], [0.5, 0.5, 1, 2, 1.5, 0.5, 2], [2, 1, 1, 1.5, 0.5, 2], [1, 0.5, 0.5, 2, 4]];
    const rhythm = RHYTHMS[Math.floor(r() * RHYTHMS.length)];
    const chord = CH[s.chords[bar]];
    const next = CH[s.chords[Math.min(bar + 1, s.bars - 1)]];
    const scale = scaleIn(69, 86);
    const tones = voicing(chord, 69, 86);
    let m = tones[Math.floor(r() * tones.length)];
    const out: [number, number][] = [];
    let beat = 0;
    rhythm.forEach((d, k) => {
      const last = k === rhythm.length - 1;
      const strong = beat % 2 === 0;
      if (k > 0) {
        const i = scale.indexOf(m);
        const step = r() < 0.7 ? (r() < 0.5 ? 1 : -1) : (r() < 0.5 ? 2 : -2);
        m = scale[Math.max(0, Math.min(scale.length - 1, (i < 0 ? 4 : i) + step))];
      }
      const c = beat >= 4 ? next : chord;
      if (strong || last) {
        const ct = voicing(c, 69, 86);
        m = ct.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), ct[0]);
      }
      if (!last && r() < 0.12) out.push([0, d]); else out.push([m, d]);
      beat += d;
    });
    return out;
  }

  // ------------------------------------------------------------------ instruments
  /** Karplus-Strong plucked string, rendered once per pitch/variant and cached. */
  private pluckBuffer(m: number, variant: 'guitar' | 'bass' | 'mute') {
    const key = `${m}:${variant}`;
    let buf = this.plucks.get(key);
    if (buf) return buf;
    const sr = this.ctx.sampleRate;
    const f = hz(m);
    const dur = variant === 'mute' ? 0.7 : variant === 'bass' ? 2.6 : 3.4;
    const n = Math.floor(sr * dur);
    buf = this.ctx.createBuffer(1, n, sr);
    const y = buf.getChannelData(0);
    const P = sr / f;
    const L = Math.max(2, Math.floor(P - 0.5 - 0.1));
    const frac = P - 0.5 - L; // remainder for a first-order allpass tuner
    const C = (1 - frac) / (1 + frac);
    const t60 = variant === 'mute' ? 0.4 : variant === 'bass' ? 2.2 : 3.4 - Math.min(1.8, (m - 50) * 0.05);
    const rho = Math.pow(0.001, 1 / (t60 * f));
    // excitation: a pick stroke (filtered noise) with a pick-position comb
    const bright = variant === 'guitar' ? 0.55 : 0.25;
    const ex = new Float32Array(L);
    let lp = 0;
    for (let i = 0; i < L; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); ex[i] = lp; }
    const pp = Math.max(1, Math.round(L * 0.13));
    for (let i = L - 1; i >= pp; i--) ex[i] -= ex[i - pp];
    let apPrev = 0, inPrev = 0, prevS = 0;
    for (let i = 0; i < n; i++) {
      let v = i < L ? ex[i] : 0;
      if (i >= L) {
        const s0 = y[i - L];
        const avg = 0.5 * (s0 + prevS) * rho;
        prevS = s0;
        const ap = C * avg + inPrev - C * apPrev;
        inPrev = avg;
        apPrev = ap;
        v += ap;
      }
      y[i] = v;
    }
    // normalise and fade the tail
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(y[i]));
    const k = peak > 0 ? 0.9 / peak : 1;
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) y[i] *= k * (i > n - fade ? (n - i) / fade : 1);
    this.plucks.set(key, buf);
    return buf;
  }

  private pluck(m: number, t: number, gain: number, dest: AudioNode, variant: 'guitar' | 'bass' | 'mute' = 'guitar') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.pluckBuffer(m, variant);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = variant === 'bass' ? 0 : Math.max(-0.6, Math.min(0.6, (m - 64) / 22));
    src.connect(g).connect(p).connect(dest);
    src.start(Math.max(t, this.ctx.currentTime));
  }

  private guitarLine(notes: [number, number][], t: number) {
    let at = t;
    for (const [m, d] of notes) {
      if (m) this.pluck(m - 12, at, 0.26, this.guitarBus);
      at += d * BEAT;
    }
  }

  /** Two detuned saws (or a sine) with a slow swell. */
  private padVoice(m: number, t: number, dur: number, gain: number, dest: AudioNode, type: OscillatorType = 'sawtooth') {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const atk = Math.min(1.8, dur * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.setValueAtTime(gain, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.9);
    g.connect(dest);
    const voices = type === 'sine' ? [0] : [-7, 6];
    const srcs: OscillatorNode[] = [];
    for (const d of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = d;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 5);
      srcs.push(o);
    }
    this.track(g, srcs, dest);
  }

  /** A whistled line: one sine voice gliding between notes, with delayed vibrato and a little breath. */
  private whistle(notes: [number, number][], t: number, dest: AudioNode, level: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vibG = ctx.createGain();
    vibG.gain.value = 0;
    vib.connect(vibG).connect(o.detune);
    const g = ctx.createGain();
    g.gain.value = 0;
    // breath: noise through a resonant band that follows the pitch
    const br = ctx.createBufferSource();
    br.buffer = this.noise;
    br.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 14;
    const brG = ctx.createGain();
    brG.gain.value = 0.25;
    br.connect(bp).connect(brG).connect(g);
    o.connect(g).connect(dest);
    let at = t;
    let first = true;
    for (const [m, d] of notes) {
      const dur = d * BEAT;
      if (!m) { g.gain.setTargetAtTime(0, at, 0.05); at += dur; first = true; continue; }
      const f = hz(m);
      if (first) { o.frequency.setValueAtTime(f * 0.97, at); bp.frequency.setValueAtTime(f, at); }
      o.frequency.setTargetAtTime(f, at, first ? 0.03 : 0.045); // a whistler slides into each note
      bp.frequency.setTargetAtTime(f, at, 0.04);
      g.gain.setTargetAtTime(level, at, first ? 0.04 : 0.02);
      vibG.gain.setValueAtTime(0, at);
      if (dur > 0.5) vibG.gain.linearRampToValueAtTime(14, at + Math.min(dur, 0.6));
      // a small dip between notes so they articulate
      g.gain.setTargetAtTime(level * 0.55, at + dur - 0.07, 0.02);
      at += dur;
      first = false;
    }
    g.gain.setTargetAtTime(0, at, 0.12);
    o.start(t);
    vib.start(t);
    br.start(t, Math.random() * 2);
    for (const n of [o, vib, br]) n.stop(at + 1);
    this.track(g, [o, vib, br], dest);
  }

  private track(g: GainNode, srcs: AudioScheduledSourceNode[], dest: AudioNode) {
    if (dest === this.stingBus) return; // stingers ride over mood changes
    const v = { g, srcs };
    this.live.add(v);
    srcs[0].onended = () => this.live.delete(v);
  }

  private kick(t: number, k: number, dest: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * k, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.45);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, q: number, peak: number, dur: number, dest: AudioNode) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(b).connect(g).connect(dest);
    s.start(t, Math.random() * 3, dur + 0.05);
  }

  private snare(t: number) {
    this.noiseHit(t, 'bandpass', 2200, 0.8, 0.32, 0.18, this.drumBus);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, peak: number) {
    this.noiseHit(t, 'highpass', 7500, 0.7, peak, 0.05, this.drumBus);
  }

  private tom(t: number, f: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.4);
  }
}
