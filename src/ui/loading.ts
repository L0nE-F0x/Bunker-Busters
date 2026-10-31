import { actionWord, type Action } from '@/engine/bindings';

/**
 * The loading screen. Its markup is already in play/index.html, so something is on screen while the
 * game's script downloads; this takes it over once the script runs. Shows the boot's step, the bytes
 * as models arrive, a rough time left (from the download rate, or from how long the last boot took on
 * this device), and a tip that changes every few seconds. Cheap on purpose: it shares the page with
 * the shader compile (no filters, no blurred shadows under lowfx, a handful of text writes a second).
 */

/** The boot's steps, in order (Game.build's messages): the step counter matches against these. */
const STEPS = [
  'warming up the apocalypse', 'initialising physics', 'eroding terrain', 'scattering debris', 'kicking up dust',
  'charting the wasteland', 'building a doomsday bunker', 'compiling shaders', 'polishing neon',
];

/**
 * Tips: controls and how things work, checked against the game. `{x}` is the control for action x
 * on the device in use (a key, a pad button), dropped on touch screens; `kbm: true` tips only make
 * sense with keys.
 */
const TIPS: { t: string; kbm?: boolean }[] = [
  { t: 'Crouch{crouch} and you step over a tripwire. Walk into one standing and the cans go off.' },
  { t: 'At night your flashlight{torch} lights you up for anything watching. The HUD says when you\'re lit.' },
  { t: 'Binoculars{binoculars}: keep a camera, a guard or a wire in the middle to tag it. Tags show through walls for 90 seconds.' },
  { t: 'Get behind someone who hasn\'t seen you and melee{melee}. That\'s a takedown.' },
  { t: 'Wolves won\'t follow you into a town or up to the camp fire.' },
  { t: 'A dust storm cuts SeedBot\'s sight to less than half. Yours too.' },
  { t: 'A full waterskin lasts about a quarter of an hour. Food lasts longer. Water is on the hotbar{hotbar3}.' },
  { t: 'Kade\'s crews won\'t walk through a burning molotov{throw}.' },
  { t: 'A contractor who loses their nerve drops the gun and puts their hands up. Take the lanyard or walk away.' },
  { t: 'The game saves once a minute and when you leave, but not while an alarm is ringing.' },
  { t: 'The map{map} fills in as you explore. Fast travel works between the safe places you\'ve found, unless something is hunting you.' },
  { t: 'At a locked door, read both prompts: {interact} and {alt} are two different ways in.', kbm: true },
  { t: 'SeedBot is running on 12% battery, so it powers down more often than you\'d think.' },
];

const touch = () => document.documentElement.classList.contains('touch');

function tipText(t: string) {
  return t.replace(/(\s?)\{(\w+)\}/g, (_, sp: string, a: string) => {
    const w = touch() ? '' : actionWord(a as Action);
    if (!w) return '';
    // "Crouch{crouch}" → "Crouch (C)"; "read both prompts: {interact}" → "…: E"
    return sp ? `${sp}${w}` : ` (${w})`;
  });
}

const TIMELINE_KEY = 'bunker-busters.boot-timeline.v1';

export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private msg: HTMLElement;
  private detail: HTMLElement;
  private tip: HTMLElement;
  private t0 = performance.now();
  private p = 0;
  private stepText = '';
  private bytes: { loaded: number; total: number } | null = null;
  private rate: { t: number; b: number }[] = [];
  private shaders = '';
  private timeline: [number, number][] = [];
  private prev: [number, number][] | null = null;
  private tipI: number;
  private tipTimer = 0;
  private lastDetail = '';

  constructor() {
    let el = document.getElementById('loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading';
      el.innerHTML = '<div class="logo-sm">BUNKER BUSTERS</div><div class="bar"><i></i></div><div class="msg">LOADING</div><div class="detail"></div><div class="tip"></div>';
      document.body.appendChild(el);
    }
    this.el = el;
    const q = <T extends HTMLElement>(s: string, make: () => T) => (el!.querySelector<T>(s) ?? el!.appendChild(make()));
    this.bar = q('.bar i', () => document.createElement('i'));
    this.msg = q('.msg', () => Object.assign(document.createElement('div'), { className: 'msg' }));
    this.detail = q('.detail', () => Object.assign(document.createElement('div'), { className: 'detail' }));
    this.tip = q('.tip', () => Object.assign(document.createElement('div'), { className: 'tip' }));
    try {
      const raw = JSON.parse(localStorage.getItem(TIMELINE_KEY) ?? 'null');
      if (Array.isArray(raw) && raw.length > 3 && raw.every((x) => Array.isArray(x) && x.length === 2 && x.every(Number.isFinite))) this.prev = raw;
    } catch { /* private mode, blocked storage: no estimate */ }
    // the page's own tip stays up first; then a random one, every few seconds
    this.tipI = Math.floor(Math.random() * TIPS.length);
    this.tipTimer = window.setInterval(() => this.nextTip(), 7000);
  }

  private nextTip() {
    if (!this.el.isConnected) { clearInterval(this.tipTimer); return; }
    const list = TIPS.filter((x) => !(x.kbm && touch()));
    this.tipI = (this.tipI + 1) % list.length;
    // the new text and its fade-in go together: the compile can hold the page for seconds, and a fade
    // out waiting on a timer would leave no tip at all for that long
    this.tip.textContent = `Tip: ${tipText(list[this.tipI].t)}`;
    this.tip.classList.remove('in');
    void this.tip.offsetWidth;
    this.tip.classList.add('in');
  }

  /** The boot moved on: `p` 0..1 and the step's message. */
  progress(p: number, msg: string) {
    this.p = Math.max(this.p, p);
    // the shader compile (the boot's 0.8–0.95) is most of the wait once the files are in: give it half the bar
    const shown = this.p <= 0.8 ? this.p * (0.5 / 0.8) : 0.5 + (Math.min(1, this.p) - 0.8) * (0.5 / 0.2);
    this.bar.style.width = `${(shown * 100).toFixed(1)}%`;
    const up = msg.toUpperCase();
    if (this.msg.textContent !== up) this.msg.textContent = up;
    const lower = msg.toLowerCase();
    const i = STEPS.findIndex((s) => lower.startsWith(s));
    if (i >= 0) this.stepText = `STEP ${i + 1} OF ${STEPS.length}`;
    if (!/compiling/.test(lower)) this.shaders = '';
    const t = performance.now() - this.t0;
    const last = this.timeline[this.timeline.length - 1];
    if (!last || this.p - last[0] >= 0.01) this.timeline.push([+this.p.toFixed(3), Math.round(t)]);
    this.render();
  }

  /** Model bytes so far, while the boot waits on them (null: not waiting on downloads now). */
  setBytes(loaded: number, total: number) {
    const now = performance.now();
    this.bytes = total > 0 && loaded < total ? { loaded, total } : null;
    if (this.bytes) {
      this.rate.push({ t: now, b: loaded });
      while (this.rate.length > 2 && now - this.rate[0].t > 3000) this.rate.shift();
    } else this.rate.length = 0;
    this.render();
  }

  /** Shader batches done / all, during "compiling shaders". */
  setShaders(done: number, all: number) {
    this.shaders = `SHADERS ${done} / ${all}`;
    this.render();
  }

  private render() {
    const parts: string[] = [];
    if (this.bytes) {
      parts.push(`${(this.bytes.loaded / 1e6).toFixed(1)} / ${(this.bytes.total / 1e6).toFixed(1)} MB`);
      const a = this.rate[0], z = this.rate[this.rate.length - 1];
      const bps = a && z && z.t - a.t > 1200 ? (z.b - a.b) / ((z.t - a.t) / 1000) : 0;
      if (bps > 0) {
        const s = (this.bytes.total - this.bytes.loaded) / bps;
        if (s >= 2) parts.push(`ABOUT ${s < 60 ? `${Math.round(s)} S` : `${Math.round(s / 60)} MIN`} LEFT TO DOWNLOAD`);
      } else if (z && z.b === 0 && performance.now() - this.t0 > 15000) parts.push('WAITING FOR THE NETWORK');
    } else {
      if (this.stepText) parts.push(this.stepText);
      if (this.shaders) parts.push(this.shaders);
      const left = this.timeLeft();
      if (left !== null) parts.push(`ABOUT ${left < 60 ? `${left} S` : `${Math.round(left / 60)} MIN`} LEFT`);
    }
    const d = parts.join(' · ');
    if (d !== this.lastDetail) { this.lastDetail = d; this.detail.textContent = d; }
  }

  /** Seconds left, from the last boot on this device scaled by how this one is going (null: no idea). */
  private timeLeft(): number | null {
    const prev = this.prev;
    if (!prev || this.p <= 0.06) return null;
    const total = prev[prev.length - 1][1];
    // the last boot's time at this progress (linear between its marks)
    let at = total;
    for (let i = 1; i < prev.length; i++) {
      if (prev[i][0] >= this.p) {
        const [p0, t0] = prev[i - 1], [p1, t1] = prev[i];
        at = t0 + (t1 - t0) * (p1 > p0 ? (this.p - p0) / (p1 - p0) : 1);
        break;
      }
    }
    if (at <= 0) return null;
    const pace = Math.min(3, Math.max(0.33, (performance.now() - this.t0) / at));
    const s = Math.round(((total - at) * pace) / 1000);
    return s >= 3 ? s : null;
  }

  /** The boot is done: remember how long it took (for next time) and fade out. */
  hide() {
    clearInterval(this.tipTimer);
    this.timeline.push([1, Math.round(performance.now() - this.t0)]);
    try { localStorage.setItem(TIMELINE_KEY, JSON.stringify(this.timeline)); } catch { /* ignore */ }
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    setTimeout(() => this.el.remove(), 1300);
  }
}

/**
 * A run waiting on the late cast (game/lateCast.ts): a short readout over the picture, in the
 * loading screen's look, until the rest of the valley's people are in.
 */
export class WorldWait {
  private el = document.createElement('div');
  private bar: HTMLElement;
  private msg: HTMLElement;
  private detail: HTMLElement;
  private rate: { t: number; b: number }[] = [];

  constructor() {
    this.el.id = 'worldwait';
    this.el.innerHTML = '<div class="msg"></div><div class="bar"><i></i></div><div class="detail"></div>';
    this.bar = this.el.querySelector('.bar i')!;
    this.msg = this.el.querySelector('.msg')!;
    this.detail = this.el.querySelector('.detail')!;
    document.body.appendChild(this.el);
  }

  set(stage: string, loaded: number, total: number) {
    const now = performance.now();
    this.rate.push({ t: now, b: loaded });
    while (this.rate.length > 2 && now - this.rate[0].t > 3000) this.rate.shift();
    const msg = stage === 'downloading' ? 'DOWNLOADING THE REST OF THE VALLEY' : stage === 'failed' ? 'WAITING ON A DOWNLOAD' : 'PUTTING EVERYONE IN PLACE';
    if (this.msg.textContent !== msg) this.msg.textContent = msg;
    const f = stage === 'downloading' ? (total ? loaded / total : 0) * 0.85 : stage === 'unpacking' ? 0.9 : stage === 'placing' ? 0.97 : 0.85;
    this.bar.style.width = `${Math.round(f * 100)}%`;
    let d = stage === 'downloading' && total ? `${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB` : '';
    const a = this.rate[0], z = this.rate[this.rate.length - 1];
    const bps = a && z && z.t - a.t > 1200 ? (z.b - a.b) / ((z.t - a.t) / 1000) : 0;
    if (d && bps > 0) { const s = (total - loaded) / bps; if (s >= 2) d += ` · ABOUT ${Math.round(s)} S LEFT`; }
    if (this.detail.textContent !== d) this.detail.textContent = d;
  }

  close() {
    this.el.remove();
  }
}
