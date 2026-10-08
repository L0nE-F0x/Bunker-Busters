import type { AudioEngine } from '@/engine/audio';
import { isTouch } from '@/engine/device';
import { dirOf, padGlyph } from '@/engine/bindings';

/** Oscilloscope "signal match": tune amplitude + frequency to the target trace and hold it. */
export class CircuitGame {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private amp = 0.3;
  private freq = 1.2;
  private tAmp: number;
  private tFreq: number;
  private hold = 0;
  private timeLeft: number;
  private t = 0;
  private raf = 0;
  private last = performance.now();
  private keys = new Set<string>();
  private resolve!: (ok: boolean) => void;
  private done = false;
  private tol: number;
  private lastTick = 0;

  constructor(private host: HTMLElement, private audio: AudioEngine, opts: { title: string; difficulty: number; skill: number }) {
    this.tAmp = 0.35 + Math.random() * 0.5;
    this.tFreq = 1.6 + Math.random() * 3.2;
    this.tol = 0.13 + opts.skill * 0.025 - opts.difficulty * 0.02;
    this.timeLeft = 22 + opts.skill * 3;
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="panel mg interactive">
        <div class="scan"></div>
        <header><h3>${opts.title}</h3><span class="sub">SIGNAL INJECTION · ELECTRONICS ${opts.skill}</span></header>
        <canvas width="1720" height="700"></canvas>
        <footer>${isTouch ? `
          <span>Drag on the scope: up/down is amplitude, left/right is frequency. Match the green trace and hold it.</span>
          <button class="btn back">Abort</button>` : `
          <span class="kbh">Move the mouse (or <span class="kbd">W</span><span class="kbd">S</span> amplitude, <span class="kbd">A</span><span class="kbd">D</span> frequency) to match the green trace</span>
          <span class="kbh"><span class="kbd">Esc</span> — abort</span>
          <span class="padh">Left stick: up/down amplitude, left/right frequency · ${padGlyph('P1')} abort</span>`}
        </footer>
      </div>`;
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    const back = this.root.querySelector('.back') as HTMLElement | null;
    if (back) back.onclick = () => { if (!this.done) this.finish(false); };
  }

  run(): Promise<boolean> {
    this.host.appendChild(this.root);
    return new Promise((res) => {
      this.resolve = res;
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
      this.canvas.addEventListener('pointermove', this.onMouse);
      this.canvas.addEventListener('pointerdown', this.onMouse);
      this.loop();
    });
  }

  private finish(ok: boolean) {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.root.remove();
    this.resolve(ok);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); this.finish(false); return; }
    const d = dirOf(e.code);
    if (d) { e.preventDefault(); this.keys.add(d); }
  };
  private onKeyUp = (e: KeyboardEvent) => { const d = dirOf(e.code); if (d) this.keys.delete(d); };
  private onMouse = (e: PointerEvent) => {
    if (this.done) return;
    if (e.pointerType !== 'mouse') e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    this.freq = 0.8 + x * 5.6;
    this.amp = Math.max(0.05, Math.min(1, 1 - y));
  };

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (!this.done) {
      if (this.keys.has('up')) this.amp = Math.min(1, this.amp + dt * 0.6);
      if (this.keys.has('down')) this.amp = Math.max(0.05, this.amp - dt * 0.6);
      if (this.keys.has('right')) this.freq = Math.min(6.4, this.freq + dt * 2.4);
      if (this.keys.has('left')) this.freq = Math.max(0.8, this.freq - dt * 2.4);
      const err = Math.abs(this.amp - this.tAmp) / 1 + Math.abs(this.freq - this.tFreq) / 5.6;
      const match = Math.max(0, 1 - err / (this.tol * 2));
      if (err < this.tol) {
        this.hold += dt;
        if (now / 1000 - this.lastTick > 0.12) { this.lastTick = now / 1000; this.audio.play('detectTick', { intensity: this.hold }); }
      } else this.hold = Math.max(0, this.hold - dt * 1.5);
      this.timeLeft -= dt;
      if (this.hold >= 1.4) {
        this.done = true;
        this.audio.play('uiConfirm');
        setTimeout(() => this.finish(true), 700);
      } else if (this.timeLeft <= 0) {
        this.done = true;
        this.audio.play('zap');
        setTimeout(() => this.finish(false), 600);
      }
      this.draw(match);
    } else this.draw(1);
    this.raf = requestAnimationFrame(this.loop);
  }

  private draw(match: number) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#020a07';
    ctx.fillRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = 'rgba(61,255,154,0.08)';
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 86) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(61,255,154,0.25)';
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const trace = (amp: number, freq: number, color: string, width: number, noise: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.beginPath();
      for (let i = 0; i <= 400; i++) {
        const u = i / 400;
        const x = u * W;
        const y = H / 2 - Math.sin(u * Math.PI * 2 * freq + this.t * 3) * amp * H * 0.38 + (Math.random() - 0.5) * noise;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    trace(this.tAmp, this.tFreq, 'rgba(61,255,154,0.9)', 6, 0);
    trace(this.amp, this.freq, this.done && this.hold >= 1.4 ? '#5dff9a' : '#ffb347', 4, (1 - match) * 10);

    // HUD
    ctx.font = '600 26px "JetBrains Mono", monospace';
    ctx.fillStyle = '#3dff9a';
    ctx.fillText(`SYNC ${Math.round(match * 100).toString().padStart(3, ' ')}%`, 40, 54);
    ctx.fillStyle = this.timeLeft < 6 ? '#ff4a3a' : '#b9ab95';
    ctx.fillText(`T-${Math.max(0, this.timeLeft).toFixed(1)}s`, W - 190, 54);
    // lock progress
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(40, H - 50, W - 80, 12);
    ctx.fillStyle = '#3dff9a';
    ctx.shadowColor = '#3dff9a';
    ctx.shadowBlur = 16;
    ctx.fillRect(40, H - 50, (W - 80) * Math.min(1, this.hold / 1.4), 12);
    ctx.shadowBlur = 0;
    if (this.done) {
      ctx.font = '900 110px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.hold >= 1.4 ? '#5dff9a' : '#ff4a3a';
      ctx.fillText(this.hold >= 1.4 ? 'ACCESS GRANTED' : 'OVERLOAD', W / 2, H / 2 + 36);
      ctx.textAlign = 'left';
    }
  }
}

/** Numeric keypad (keyboard digits or clicks). */
export class KeypadGame {
  private root: HTMLDivElement;
  private entry = '';
  private resolve!: (r: 'ok' | 'wrong' | 'abort') => void;
  private screen: HTMLDivElement;
  private locked = false;

  constructor(private host: HTMLElement, private audio: AudioEngine, private opts: { title: string; code: string; hint: string }) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⏎'];
    this.root.innerHTML = `
      <div class="panel keypad interactive">
        <div class="label">${opts.title}</div>
        <div class="screen">····</div>
        <div class="keys">${keys.map((k) => `<button class="btn" data-k="${k}">${k}</button>`).join('')}</div>
        <div class="hint">${opts.hint}</div>
        ${isTouch ? '<button class="btn leave">Leave</button>' : '<div class="hint">Type digits · <span class="kbd">Enter</span> submit · <span class="kbd">Esc</span> leave</div>'}
      </div>`;
    this.screen = this.root.querySelector('.screen')!;
    this.root.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => this.press((b as HTMLButtonElement).dataset.k!)));
    const leave = this.root.querySelector('.leave') as HTMLElement | null;
    if (leave) leave.onclick = () => { if (!this.locked) this.finish('abort'); };
  }

  run(): Promise<'ok' | 'wrong' | 'abort'> {
    this.host.appendChild(this.root);
    window.addEventListener('keydown', this.onKey);
    return new Promise((res) => (this.resolve = res));
  }

  private finish(r: 'ok' | 'wrong' | 'abort') {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.resolve(r);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); this.finish('abort'); return; }
    if (/^Digit\d$/.test(e.code)) this.press(e.code.slice(5));
    else if (/^Numpad\d$/.test(e.code)) this.press(e.code.slice(6));
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.press('⏎');
    else if (e.code === 'Backspace') this.press('C');
  };

  private press(k: string) {
    if (this.locked) return;
    if (k === 'C') { this.entry = ''; this.audio.play('ui'); }
    else if (k === '⏎') { this.submit(); return; }
    else if (this.entry.length < 4) { this.entry += k; this.audio.play('ui'); }
    this.screen.textContent = this.entry.padEnd(4, '·');
    if (this.entry.length === 4) setTimeout(() => this.submit(), 220);
  }

  private submit() {
    if (this.locked) return;
    this.locked = true;
    if (this.entry === this.opts.code) {
      this.screen.textContent = 'OPEN';
      this.audio.play('uiConfirm');
      setTimeout(() => this.finish('ok'), 700);
    } else {
      this.screen.textContent = 'DENIED';
      this.screen.classList.add('err');
      this.audio.play('deny');
      setTimeout(() => this.finish('wrong'), 900);
    }
  }
}
