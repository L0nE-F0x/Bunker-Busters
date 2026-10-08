import type { AudioEngine } from '@/engine/audio';
import { isTouch } from '@/engine/device';
import './hack.css';

/** One payload the player can splice into the box. Ids are the caller's; the UI only shows them. */
export interface HackDaemonView {
  id: string;
  name: string;
  blurb: string;
}

export interface HackOpts {
  title: string;
  /** The box you're in, under the title ("KADE FIELD UNIT · RP7"). */
  host: string;
  /** 0 (a fuse-box brain) … 3 (a data centre). */
  difficulty: number;
  /** Electronics rank as the board sees it (0–5). */
  skill: number;
  daemons: HackDaemonView[];
  /** Extra buffer slots (a swiped lanyard). */
  bonusBuffer?: number;
  /** Trace time multiplier (a swiped lanyard). */
  traceMult?: number;
  /** Trace spikes in the pack, and spending one. */
  spikes?: () => number;
  useSpike?: () => boolean;
  /** Hook for the world to cut you off (you got shot): call `bail` with a reason. Returns an unsubscribe. */
  interrupt?: (bail: (why: string) => void) => () => void;
}

export interface HackResult {
  /** Daemons that uploaded, in the order they did. */
  done: string[];
  /** The trace finished before you jacked out. */
  traced: boolean;
  /** Left before splicing anything. */
  aborted: boolean;
}

/** Kade OS opcodes. Two glyphs each, picked to read apart at a glance on a small screen. */
const CODES = ['A3', '0F', '5C', '8E', 'D7', '2B'];
/** Seconds of reading before the carrier is detected anyway. */
const GRACE = 10;
/** A trace spike buys this many seconds. */
const SPIKE_S = 6;
/** Picking an ICE cell costs this much trace. */
const ICE_S = 4;

interface Cell { r: number; c: number; code: string; used: boolean; ice: boolean; el: HTMLButtonElement }
interface Daemon { view: HackDaemonView; seq: string[]; state: 'live' | 'done' | 'lost'; progress: number; el: HTMLElement; chips: HTMLElement[] }

const rnd = (n: number) => Math.floor(Math.random() * n);

/**
 * SPLICE: the Kade OS memory splice. A matrix of opcodes; you take one from the top row, then one
 * from that column, then one from that row, and so on, each pick going into a short buffer. A daemon
 * uploads when its sequence appears in the buffer, in order. The trace starts with your first pick
 * (or after a few seconds of reading) and when it lands, the box knows who you are.
 *
 * Every daemon list is solvable: the grid is laid first, then a hidden path through it, and each
 * daemon is a window onto that path. Electronics buys buffer, time, and at rank 3 a sniffer that marks
 * the cells on your line that would advance a daemon.
 */
export class HackGame {
  private root: HTMLDivElement;
  private n: number;
  private cells: Cell[] = [];
  private daemons: Daemon[] = [];
  private buffer: string[] = [];
  private bufCap: number;
  private bufEls: HTMLElement[] = [];
  /** The line you must pick from: a row or a column, by index. */
  private axis: 'row' | 'col' = 'row';
  private line = 0;
  /** Cursor along the line (the other coordinate). */
  private cur = 0;
  private traceMax: number;
  private trace: number;
  private traceOn = false;
  private idle = 0;
  private spikeT = 0;
  private done = false;
  private raf = 0;
  private last = performance.now();
  private lastPaint = 0;
  private lastTick = 0;
  private resolve!: (r: HackResult) => void;
  private sniff: boolean;
  private band: HTMLElement;
  private traceBar: HTMLElement;
  private traceTxt: HTMLElement;
  private stamp: HTMLElement;
  private msg: HTMLElement;
  private spikeBtn: HTMLButtonElement | null;
  private order: string[] = [];
  private unsub: (() => void) | null = null;

  constructor(private host: HTMLElement, private audio: AudioEngine, private opts: HackOpts) {
    const d = Math.max(0, Math.min(3, opts.difficulty));
    const skill = Math.max(0, Math.min(5, opts.skill));
    this.n = d <= 1 ? 5 : 6;
    const pathLen = Math.min(6, 4 + d);
    this.bufCap = Math.min(9, pathLen + 1 + Math.floor(skill / 2) + (opts.bonusBuffer ?? 0));
    this.traceMax = this.trace = Math.max(8, 12 + skill * 2.2 - d * 1.2) * (opts.traceMult ?? 1);
    this.sniff = skill >= 3;

    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="panel mg hack interactive">
        <div class="scan"></div>
        <header><h3>${opts.title}</h3><span class="sub">SPLICE · ${opts.host} · ELECTRONICS ${skill}</span><span class="hk-msg"></span></header>
        <div class="hk-body">
          <div class="hk-grid-wrap">
            <div class="hk-grid" style="--n:${this.n}"><div class="hk-band"></div></div>
            <div class="hk-stamp"></div>
          </div>
          <div class="hk-side">
            <div class="hk-label">BUFFER <span>${this.bufCap} SLOTS</span></div>
            <div class="hk-buffer"></div>
            <div class="hk-label">DAEMONS <span>SPLICE ANY</span></div>
            <div class="hk-daemons"></div>
            <div class="hk-label">TRACE <span class="hk-tt"></span></div>
            <div class="hk-trace"><i></i></div>
          </div>
        </div>
        <footer>${isTouch ? `
          <span>Tap a code on the lit line. Top row first, then its column, then its row.</span>` : `
          <span><span class="kbd">WASD</span> / mouse — move on the lit line</span>
          <span><span class="kbd">Space</span> / click — splice</span>
          <span><span class="kbd">Esc</span> — jack out</span>`}
          <span class="right">${opts.spikes ? '<button class="btn hk-spike"></button>' : ''}<button class="btn hk-out">Jack out</button></span>
        </footer>
      </div>`;
    const grid = this.root.querySelector('.hk-grid') as HTMLElement;
    this.band = this.root.querySelector('.hk-band')!;
    this.traceBar = this.root.querySelector('.hk-trace i')!;
    this.traceTxt = this.root.querySelector('.hk-tt')!;
    this.stamp = this.root.querySelector('.hk-stamp')!;
    this.msg = this.root.querySelector('.hk-msg')!;
    this.spikeBtn = this.root.querySelector('.hk-spike');

    // the matrix
    for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) {
      const el = document.createElement('button');
      el.className = 'hk-cell';
      el.style.gridRow = String(r + 1);
      el.style.gridColumn = String(c + 1);
      const cell: Cell = { r, c, code: CODES[rnd(CODES.length)], used: false, ice: false, el };
      el.textContent = cell.code;
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.hover(cell); });
      el.addEventListener('click', () => this.pick(cell));
      grid.appendChild(el);
      this.cells.push(cell);
    }

    // a hidden path from the top row, alternating column and row: every daemon is a window onto it
    const path: Cell[] = [];
    let r = 0, c = rnd(this.n);
    path.push(this.at(r, c));
    for (let i = 1; i < pathLen; i++) {
      const vertical = i % 2 === 1;
      const opts2 = this.cells.filter((x) => !path.includes(x) && (vertical ? x.c === c && x.r !== r : x.r === r && x.c !== c));
      const next = opts2[rnd(opts2.length)];
      path.push(next);
      r = next.r; c = next.c;
    }
    // re-cut the path's codes so a run never repeats itself (repeats make windows collapse into each other)
    path.forEach((x, i) => {
      const avoid = new Set([path[i - 1]?.code, path[i - 2]?.code]);
      if (avoid.has(x.code)) { const pool = CODES.filter((k) => !avoid.has(k)); x.code = pool[rnd(pool.length)]; x.el.textContent = x.code; }
    });
    const lens = opts.daemons.map((_, i) => Math.min(pathLen, 2 + (i === 0 ? 0 : 1) + (d >= 2 ? 1 : 0)));
    // spread the windows along the path, and keep one daemon from hiding inside another
    const seqs: string[][] = [];
    const offs: number[] = [];
    const inside = (a: string[], b: string[]) => (' ' + b.join(' ') + ' ').includes(' ' + a.join(' ') + ' ');
    opts.daemons.forEach((_, i) => {
      let best: string[] = [], bestOff = 0, bestK = -Infinity;
      for (let off = 0; off <= pathLen - lens[i]; off++) {
        const seq = path.slice(off, off + lens[i]).map((x) => x.code);
        let k = Math.random() * 0.8 + (offs.length ? Math.min(...offs.map((o) => Math.abs(o - off))) : 0);
        if (seqs.some((q) => inside(q, seq) || inside(seq, q))) k -= 10;
        if (k > bestK) { bestK = k; best = seq; bestOff = off; }
      }
      seqs.push(best);
      offs.push(bestOff);
    });
    // ICE: guarded cells off the path; picking one bites the trace
    const iceN = d >= 2 ? (d - 1) * 2 : 0;
    const free = this.cells.filter((x) => !path.includes(x)).sort(() => Math.random() - 0.5);
    for (const x of free.slice(0, iceN)) { x.ice = true; x.el.classList.add('ice'); }

    // buffer + daemon rows
    const buf = this.root.querySelector('.hk-buffer')!;
    for (let i = 0; i < this.bufCap; i++) {
      const s = document.createElement('div');
      s.className = 'hk-slot';
      buf.appendChild(s);
      this.bufEls.push(s);
    }
    const list = this.root.querySelector('.hk-daemons')!;
    opts.daemons.forEach((view, i) => {
      const el = document.createElement('div');
      el.className = 'hk-daemon';
      el.innerHTML = `<div class="hk-dn"><b>${view.name}</b><em></em></div><div class="hk-seq">${seqs[i].map((s) => `<span>${s}</span>`).join('')}</div><div class="hk-db">${view.blurb}</div>`;
      list.appendChild(el);
      this.daemons.push({ view, seq: seqs[i], state: 'live', progress: 0, el, chips: [...el.querySelectorAll('.hk-seq span')] as HTMLElement[] });
    });

    (this.root.querySelector('.hk-out') as HTMLButtonElement).onclick = () => this.jackOut();
    if (this.spikeBtn) this.spikeBtn.onclick = () => this.spike();
    // don't start the cursor on the answer, or on ICE
    this.cur = this.lineCells().findIndex((x) => x !== path[0] && !x.ice);
    this.say(`Carrier detect in ${GRACE} s. Read first, then splice.`);
    this.paint();
  }

  run(): Promise<HackResult> {
    this.host.appendChild(this.root);
    return new Promise((res) => {
      this.resolve = res;
      window.addEventListener('keydown', this.onKey);
      this.unsub = this.opts.interrupt?.((why) => this.bail(why)) ?? null;
      this.loop();
    });
  }

  private at(r: number, c: number) {
    return this.cells[r * this.n + c];
  }

  /** The cells on the line you must pick from. */
  private lineCells() {
    return this.cells.filter((x) => (this.axis === 'row' ? x.r === this.line : x.c === this.line));
  }

  private say(t: string) {
    this.msg.textContent = t;
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.done) return;
    if (e.code === 'Escape') { e.preventDefault(); this.jackOut(); return; }
    const along = this.axis === 'row' ? ['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'] : ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'];
    const i = along.indexOf(e.code);
    if (i >= 0) { e.preventDefault(); this.step(i < 2 ? -1 : 1); return; }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      const cell = this.axis === 'row' ? this.at(this.line, this.cur) : this.at(this.cur, this.line);
      this.pick(cell);
      return;
    }
    if (e.code === 'KeyF' || e.code === 'KeyQ') { e.preventDefault(); this.spike(); }
  };

  /** Move the cursor along the line, skipping spent cells. */
  private step(dir: number, quiet = false) {
    for (let k = 1; k <= this.n; k++) {
      const j = (this.cur + dir * k + this.n * 4) % this.n;
      const cell = this.axis === 'row' ? this.at(this.line, j) : this.at(j, this.line);
      if (!cell.used) { this.cur = j; break; }
    }
    if (!quiet) { this.audio.play('uiHover'); this.paint(); }
  }

  private hover(cell: Cell) {
    if (this.done || !this.onLine(cell)) return;
    const j = this.axis === 'row' ? cell.c : cell.r;
    if (j !== this.cur) { this.cur = j; this.paint(); }
  }

  private onLine(cell: Cell) {
    return this.axis === 'row' ? cell.r === this.line : cell.c === this.line;
  }

  private pick(cell: Cell) {
    if (this.done) return;
    if (!this.onLine(cell) || cell.used) { this.audio.play('deny'); return; }
    if (!this.traceOn) { this.traceOn = true; this.say('Carrier detected. The trace is running.'); }
    cell.used = true;
    this.buffer.push(cell.code);
    cell.el.classList.add('used', 'flash');
    setTimeout(() => cell.el.classList.remove('flash'), 220);
    if (cell.ice) {
      this.trace = Math.max(0, this.trace - ICE_S);
      this.audio.play('zap', { intensity: 0.4 });
      this.say(`ICE. The box bit back: −${ICE_S} s of trace.`);
      this.root.querySelector('.hack')!.classList.add('bit');
      setTimeout(() => this.root.querySelector('.hack')?.classList.remove('bit'), 300);
    } else this.audio.play('pinSet');
    // the next line runs through the cell you took
    if (this.axis === 'row') { this.axis = 'col'; this.line = cell.c; this.cur = cell.r; }
    else { this.axis = 'row'; this.line = cell.r; this.cur = cell.c; }
    this.score();
    this.nudgeCursor();
    this.paint();
    this.checkEnd();
  }

  /** If the cursor sits on a spent cell, slide it to a live one. */
  private nudgeCursor() {
    const cell = this.axis === 'row' ? this.at(this.line, this.cur) : this.at(this.cur, this.line);
    if (cell.used) this.step(1, true);
  }

  private score() {
    const room = this.bufCap - this.buffer.length;
    const b = this.buffer.join(' ');
    for (const dm of this.daemons) {
      if (dm.state !== 'live') continue;
      if ((' ' + b + ' ').includes(' ' + dm.seq.join(' ') + ' ')) {
        dm.state = 'done';
        dm.progress = dm.seq.length;
        this.order.push(dm.view.id);
        this.audio.play('uiConfirm');
        this.say(`${dm.view.name}: uploaded.`);
        continue;
      }
      // the longest start of the sequence the buffer currently ends with
      let k = Math.min(dm.seq.length - 1, this.buffer.length);
      for (; k > 0; k--) {
        let ok = true;
        for (let i = 0; i < k; i++) if (this.buffer[this.buffer.length - k + i] !== dm.seq[i]) { ok = false; break; }
        if (ok) break;
      }
      dm.progress = k;
      if (room < dm.seq.length - k) {
        dm.state = 'lost';
        this.audio.play('deny');
      }
    }
  }

  private checkEnd() {
    if (this.done) return;
    const live = this.daemons.some((d) => d.state === 'live');
    const moves = this.lineCells().some((x) => !x.used);
    if (!live || this.buffer.length >= this.bufCap || !moves) this.end(false);
  }

  private spike() {
    if (this.done || !this.opts.spikes || !this.opts.useSpike) return;
    if (this.opts.spikes() <= 0) { this.audio.play('deny'); this.say('No trace spikes. The camp can make them from a cell and scrap.'); return; }
    if (!this.opts.useSpike()) return;
    this.spikeT += SPIKE_S;
    this.audio.play('emp', { intensity: 0.4 });
    this.say(`Trace spike: the trace stalls for ${SPIKE_S} s.`);
    this.paint();
  }

  /** Torn out by the world: whatever already uploaded stays uploaded. */
  private bail(why: string) {
    if (this.done) return;
    if (!this.buffer.length) { this.finish({ done: [], traced: false, aborted: true }); return; }
    this.end(false);
    this.say(why);
  }

  private jackOut() {
    if (this.done) return;
    if (!this.buffer.length) { this.finish({ done: [], traced: false, aborted: true }); return; }
    this.end(false);
  }

  private end(traced: boolean) {
    if (this.done) return;
    this.done = true;
    const got = this.order.length;
    this.stamp.className = `hk-stamp on ${traced ? 'bad' : got ? 'good' : 'meh'}`;
    this.stamp.innerHTML = traced
      ? `<b>TRACE COMPLETE</b><span>${got ? `${got} daemon${got > 1 ? 's' : ''} made it out` : 'they know your face now'}</span>`
      : got ? `<b>ACCESS GRANTED</b><span>${got} of ${this.daemons.length} daemon${this.daemons.length > 1 ? 's' : ''} uploaded</span>`
        : '<b>NO UPLOAD</b><span>the buffer filled with nothing useful</span>';
    this.audio.play(traced ? 'zap' : got ? 'unlock' : 'deny');
    this.paint();
    setTimeout(() => this.finish({ done: [...this.order], traced, aborted: false }), traced ? 1300 : 1100);
  }

  private finish(r: HackResult) {
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.unsub?.();
    this.unsub = null;
    this.root.remove();
    this.resolve(r);
  }

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.done) {
      if (!this.traceOn) {
        this.idle += dt;
        if (this.idle >= GRACE) { this.traceOn = true; this.say('Carrier detected. The trace is running.'); this.audio.play('detectTick', { intensity: 0.5 }); }
      } else if (this.spikeT > 0) this.spikeT = Math.max(0, this.spikeT - dt);
      else {
        this.trace -= dt;
        if (this.trace < 5 && now / 1000 - this.lastTick > 0.5) { this.lastTick = now / 1000; this.audio.play('detectTick', { intensity: 1 - this.trace / 5 }); }
        if (this.trace <= 0) { this.trace = 0; this.end(true); }
      }
      // the bar and the clock at ~12 Hz (the world is still drawing underneath)
      if (now - this.lastPaint > 80) { this.lastPaint = now; this.paintTrace(); }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private paintTrace() {
    const k = this.trace / this.traceMax;
    this.traceBar.style.transform = `scaleX(${k.toFixed(3)})`;
    this.traceBar.parentElement!.classList.toggle('hot', this.traceOn && this.trace < 5);
    this.traceBar.parentElement!.classList.toggle('stalled', this.spikeT > 0);
    this.traceTxt.textContent = !this.traceOn ? `IDLE · ${Math.max(0, GRACE - this.idle).toFixed(0)} s` : this.spikeT > 0 ? `STALLED · ${this.spikeT.toFixed(1)} s` : `${this.trace.toFixed(1)} s`;
  }

  private paint() {
    const n = this.n;
    // the lit line: one band behind the row or column
    this.band.style.cssText = this.axis === 'row'
      ? `grid-row:${this.line + 1};grid-column:1 / span ${n};`
      : `grid-column:${this.line + 1};grid-row:1 / span ${n};`;
    this.band.classList.toggle('col', this.axis === 'col');
    this.band.style.visibility = this.done ? 'hidden' : '';
    // what would advance a daemon (rank 3 sniffer)
    const wanted = new Set<string>();
    if (this.sniff) for (const dm of this.daemons) if (dm.state === 'live') wanted.add(dm.seq[dm.progress]);
    for (const cell of this.cells) {
      const on = this.onLine(cell) && !this.done;
      const cur = on && (this.axis === 'row' ? cell.c : cell.r) === this.cur;
      cell.el.classList.toggle('on', on && !cell.used);
      cell.el.classList.toggle('cur', cur && !cell.used);
      cell.el.classList.toggle('want', on && !cell.used && wanted.has(cell.code));
      if (cell.used) cell.el.textContent = '··';
      cell.el.disabled = !on || cell.used;
    }
    this.bufEls.forEach((el, i) => {
      el.textContent = this.buffer[i] ?? '';
      el.classList.toggle('full', i < this.buffer.length);
      el.classList.toggle('next', i === this.buffer.length && !this.done);
    });
    for (const dm of this.daemons) {
      dm.el.classList.toggle('done', dm.state === 'done');
      dm.el.classList.toggle('lost', dm.state === 'lost');
      (dm.el.querySelector('em') as HTMLElement).textContent = dm.state === 'done' ? 'UPLOADED' : dm.state === 'lost' ? 'LOST' : dm.progress ? `${dm.progress}/${dm.seq.length}` : '';
      dm.chips.forEach((ch, i) => ch.classList.toggle('lit', dm.state === 'done' || i < dm.progress));
    }
    if (this.spikeBtn && this.opts.spikes) {
      const k = this.opts.spikes();
      this.spikeBtn.innerHTML = `${isTouch ? '' : '<span class="kbd">F</span> '}Spike · ${k}`;
      this.spikeBtn.disabled = k <= 0 || this.done;
    }
    this.paintTrace();
  }
}
