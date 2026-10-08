import type { AudioEngine } from '@/engine/audio';
import type { LockResult } from '@/game/context';
import { isTouch } from '@/engine/device';
import { dirOf } from '@/engine/bindings';

interface Pin { target: number; lift: number; vel: number; set: boolean; jitter: number; flash: number }

/**
 * Pin-tumbler lockpicking. Find the binding pin by feel (it resists), lift it to the shear line and
 * release inside the sweet spot. Overshooting strains the pick; too much strain snaps it.
 */
export class LockpickGame {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pins: Pin[] = [];
  private order: number[] = [];
  private sel = 0;
  private lifting = false;
  private strain = 0;
  private window: number;
  private done = false;
  private openAnim = 0;
  private shake = 0;
  private raf = 0;
  private last = performance.now();
  private resolve!: (r: LockResult) => void;
  private picksEl: HTMLSpanElement;
  private strainEl: HTMLElement;
  private msgEl: HTMLElement;
  private t = 0;
  private lastStrainSfx = 0;

  constructor(
    private host: HTMLElement,
    private audio: AudioEngine,
    private opts: { pins: number; title: string; skill: number; picks: () => number; onBreak: () => boolean },
  ) {
    const n = opts.pins;
    this.window = (0.085 + opts.skill * 0.03) * (n >= 5 ? 0.92 : 1);
    for (let i = 0; i < n; i++) this.pins.push({ target: 0.42 + Math.random() * 0.36, lift: 0, vel: 0, set: false, jitter: 0, flash: 0 });
    this.order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    if (opts.skill >= 5) this.pins[this.order[0]].set = true;

    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="panel mg interactive">
        <div class="scan"></div>
        <header><h3>${opts.title}</h3><span class="sub">${n}-PIN TUMBLER · LOCKPICKING ${opts.skill}</span><span class="msg" style="margin-left:auto;color:var(--amber);font-size:14px;letter-spacing:.06em;text-align:right"></span></header>
        <canvas width="1720" height="760"></canvas>
        <footer>${isTouch ? `
          <span>Press and hold a pin to lift it · let go to set</span>
          <button class="btn back">Back off</button>` : `
          <span><span class="kbd">A</span> <span class="kbd">D</span> / mouse — choose pin</span>
          <span><span class="kbd">W</span> / hold <span class="kbd">LMB</span> — lift · release to set</span>
          <span><span class="kbd">Esc</span> — back off</span>`}
          <span class="right">PICKS <b class="picks"></b> · STRAIN <b class="strain"></b></span>
        </footer>
      </div>`;
    this.canvas = this.root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.picksEl = this.root.querySelector('.picks')!;
    this.strainEl = this.root.querySelector('.strain')!;
    this.msgEl = this.root.querySelector('.msg')!;
    this.msgEl.textContent = 'One pin binds first. It will feel stiff.';
    const back = this.root.querySelector('.back') as HTMLElement | null;
    if (back) back.onclick = () => { if (!this.done) this.finish('abort'); };
  }

  run(): Promise<LockResult> {
    this.host.appendChild(this.root);
    return new Promise((res) => {
      this.resolve = res;
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
      this.canvas.addEventListener('pointermove', this.onMouse);
      this.canvas.addEventListener('pointerdown', this.onDown);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
      this.loop();
    });
  }

  private finish(r: LockResult) {
    if (this.done && r !== 'success') return;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.root.remove();
    this.resolve(r);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.done) return;
    if (e.code === 'Escape' || e.code === 'KeyQ') { e.preventDefault(); this.finish('abort'); return; }
    if (e.repeat) return;
    const d = dirOf(e.code);
    if (d === 'left') this.select(this.sel - 1);
    if (d === 'right') this.select(this.sel + 1);
    if (d === 'up' || e.code === 'Space') { e.preventDefault(); this.lifting = true; }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (dirOf(e.code) === 'up' || e.code === 'Space') this.release();
  };
  private onMouse = (e: PointerEvent) => {
    if (this.lifting || this.done) return;
    this.pickAt(e);
  };
  private pickAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.canvas.width;
    let best = 0, bd = Infinity;
    this.pins.forEach((_, i) => { const d = Math.abs(this.pinX(i) - x); if (d < bd) { bd = d; best = i; } });
    if (best !== this.sel) this.select(best);
  }
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.done) return;
    e.preventDefault();
    if (e.pointerType !== 'mouse') this.pickAt(e); // no hover on touch: the press chooses the pin
    this.lifting = true;
  };
  private onUp = () => this.release();

  private select(i: number) {
    const n = this.pins.length;
    const ni = Math.max(0, Math.min(n - 1, i));
    if (ni !== this.sel) {
      this.sel = ni;
      this.audio.play('click');
    }
  }

  private get bindingIndex() {
    return this.order.find((i) => !this.pins[i].set) ?? -1;
  }

  private release() {
    if (!this.lifting) return;
    this.lifting = false;
    const p = this.pins[this.sel];
    if (p.set || this.done) return;
    const binding = this.sel === this.bindingIndex;
    if (binding && Math.abs(p.lift - p.target) <= this.window / 2) {
      p.set = true;
      p.flash = 1;
      this.audio.play('pinSet');
      this.msgEl.textContent = this.pins.every((q) => q.set) ? '' : 'Click. Next pin is binding now.';
      if (this.pins.every((q) => q.set)) {
        this.done = true;
        this.audio.play('unlock');
        this.msgEl.textContent = 'OPEN';
        setTimeout(() => this.finish('success'), 900);
      }
    } else {
      if (binding && p.lift > 0.15) this.msgEl.textContent = p.lift < p.target ? 'Not high enough…' : 'Too high — it dropped.';
      else if (!binding && p.lift > 0.3) this.msgEl.textContent = 'That one springs freely. Not binding.';
      this.audio.play('click');
    }
  }

  private pinX(i: number) {
    const n = this.pins.length;
    const W = this.canvas.width;
    const span = Math.min(1000, 210 * n);
    return W / 2 - span / 2 + (span / (n - 1 || 1)) * i + (n === 1 ? span / 2 : 0) + 60;
  }

  private loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.strain = Math.max(0, this.strain - dt * 0.04);
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.done) { this.openAnim = Math.min(1, this.openAnim + dt * 1.6); }
    const bi = this.bindingIndex;
    this.pins.forEach((p, i) => {
      p.flash = Math.max(0, p.flash - dt * 2);
      if (p.set) { p.lift += (p.target - p.lift) * Math.min(1, dt * 12); return; }
      const active = i === this.sel && this.lifting && !this.done;
      if (active) {
        const binding = i === bi;
        const rate = binding ? 0.42 : 1.1;
        p.lift = Math.min(1, p.lift + rate * dt);
        p.jitter = binding ? 1 : 0.2;
        if (binding && now() - this.lastStrainSfx > 0.16) { this.lastStrainSfx = now(); this.audio.play('pickStrain'); }
        if (binding && p.lift > p.target + this.window / 2 + 0.07) {
          // overset: strain the pick, the pin drops
          this.strain += this.opts.skill >= 2 ? 0.26 : 0.36;
          this.shake = 1;
          p.lift = 0;
          p.vel = 0;
          this.lifting = false;
          this.audio.play('pickBreak', { intensity: 0.4 });
          this.msgEl.textContent = 'Overset! The pick bends…';
          if (this.strain >= 1) this.snap();
        }
      } else {
        p.jitter = 0;
        // springs push the stack back down
        p.vel -= 18 * dt;
        p.lift += p.vel * dt;
        if (p.lift <= 0) { p.lift = 0; p.vel = Math.abs(p.vel) > 1.5 ? -p.vel * 0.25 : 0; }
      }
    });
    this.picksEl.textContent = String(this.opts.picks());
    this.strainEl.textContent = `${Math.round(this.strain * 100)}%`;
    this.strainEl.style.color = this.strain > 0.6 ? 'var(--red)' : '';
  }

  private snap() {
    this.audio.play('pickBreak');
    this.shake = 1.5;
    this.strain = 0;
    const more = this.opts.onBreak();
    this.pins.forEach((p) => { if (!(this.opts.skill >= 5 && p === this.pins[this.order[0]])) p.set = false; p.lift = 0; });
    this.msgEl.textContent = more ? 'SNAP. New pick. Pins reset.' : 'Out of lockpicks.';
    if (!more) setTimeout(() => this.finish('out-of-picks'), 900);
  }

  // ------------------------------------------------------------------ rendering
  private draw() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    const sx = (Math.random() - 0.5) * this.shake * 10, sy = (Math.random() - 0.5) * this.shake * 6;
    ctx.translate(sx, sy);

    // backdrop
    const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    bg.addColorStop(0, '#2a1d13');
    bg.addColorStop(1, '#0c0806');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const plugY = 470; // shear line
    const plugH = 150;
    const bodyTop = 70;
    const left = this.pinX(0) - 170, right = this.pinX(this.pins.length - 1) + 150;
    const rot = this.openAnim;

    // housing (brass, brushed)
    const housing = ctx.createLinearGradient(0, bodyTop, 0, plugY + plugH + 60);
    housing.addColorStop(0, '#8a6a2c');
    housing.addColorStop(0.5, '#c79d4a');
    housing.addColorStop(1, '#6e5222');
    ctx.fillStyle = housing;
    roundRect(ctx, left - 40, bodyTop, right - left + 80, plugY + plugH + 60 - bodyTop, 26);
    ctx.fill();
    ctx.globalAlpha = 0.12;
    for (let y = bodyTop; y < plugY + plugH + 60; y += 3) {
      ctx.fillStyle = y % 6 ? '#000' : '#fff';
      ctx.fillRect(left - 40, y, right - left + 80, 1);
    }
    ctx.globalAlpha = 1;

    // plug (rotates slightly when open → drawn shifted)
    ctx.save();
    ctx.translate(0, rot * 18);
    const plug = ctx.createLinearGradient(0, plugY, 0, plugY + plugH);
    plug.addColorStop(0, '#e0b85e');
    plug.addColorStop(0.5, '#b48a3c');
    plug.addColorStop(1, '#7a5a24');
    ctx.fillStyle = plug;
    roundRect(ctx, left, plugY + 2, right - left, plugH - 4, 10);
    ctx.fill();
    // keyway slot
    ctx.fillStyle = '#120c08';
    roundRect(ctx, left - 40, plugY + 122, right - left + 30, 24, 8);
    ctx.fill();
    ctx.restore();

    // shear line glow
    ctx.strokeStyle = 'rgba(63,242,224,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(left - 30, plugY);
    ctx.lineTo(right + 30, plugY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(63,242,224,0.7)';
    ctx.font = '600 20px "JetBrains Mono", monospace';
    ctx.fillText('SHEAR LINE', right - 120, plugY - 12);

    const travel = 110;
    const keywayTop = plugY + 122;
    const bi = this.bindingIndex;
    this.pins.forEach((p, i) => {
      const x = this.pinX(i);
      const chamberW = 64;
      // chamber
      ctx.fillStyle = '#1a120b';
      roundRect(ctx, x - chamberW / 2, bodyTop + 30, chamberW, keywayTop - bodyTop - 30, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();

      const jit = p.jitter ? Math.sin(this.t * 60 + i) * p.jitter * 1.4 : 0;
      const lift = p.lift * travel;
      const targetLift = p.target * travel;
      // key pin top reaches the shear line exactly when lift == targetLift
      const keyLen = keywayTop - plugY - targetLift;
      const kTop = plugY + targetLift - lift + jit;
      const kBottom = kTop + keyLen;
      // driver pin sits on top of key pin
      const dLen = 120;
      const dBottom = kTop;
      const dTop = dBottom - dLen;
      // spring from chamber top to driver top
      const springTop = bodyTop + 36;
      ctx.strokeStyle = '#9aa0a6';
      ctx.lineWidth = 4;
      ctx.beginPath();
      const coils = 9;
      for (let c = 0; c <= coils * 2; c++) {
        const yy = springTop + ((dTop - springTop) * c) / (coils * 2);
        const xx = x + (c % 2 ? 20 : -20);
        if (c === 0) ctx.moveTo(x, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      // driver pin (steel)
      const steel = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
      steel.addColorStop(0, '#5e646b');
      steel.addColorStop(0.45, '#d8dde2');
      steel.addColorStop(1, '#4a4f55');
      ctx.fillStyle = steel;
      roundRect(ctx, x - 24, dTop, 48, dLen, 8);
      ctx.fill();
      // key pin (brass, pointed bottom)
      const brass = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
      brass.addColorStop(0, '#8a6424');
      brass.addColorStop(0.45, '#ffd98a');
      brass.addColorStop(1, '#7a5420');
      ctx.fillStyle = p.set ? brassSet(ctx, x) : brass;
      ctx.beginPath();
      ctx.moveTo(x - 24, kTop + 6);
      ctx.quadraticCurveTo(x - 24, kTop, x - 18, kTop);
      ctx.lineTo(x + 18, kTop);
      ctx.quadraticCurveTo(x + 24, kTop, x + 24, kTop + 6);
      ctx.lineTo(x + 24, kBottom - 18);
      ctx.lineTo(x, kBottom);
      ctx.lineTo(x - 24, kBottom - 18);
      ctx.closePath();
      ctx.fill();

      // sweet spot hint (skill 3+ highlights the binding pin)
      if (this.opts.skill >= 3 && i === bi && !this.done) {
        ctx.strokeStyle = `rgba(255,179,71,${0.35 + Math.sin(this.t * 5) * 0.2})`;
        ctx.lineWidth = 3;
        roundRect(ctx, x - chamberW / 2 - 6, bodyTop + 24, chamberW + 12, keywayTop + 6 - bodyTop - 24, 10);
        ctx.stroke();
      }
      // set indicator
      const ledY = bodyTop - 26;
      ctx.beginPath();
      ctx.arc(x, ledY, 10, 0, Math.PI * 2);
      ctx.fillStyle = p.set ? '#5dff9a' : i === this.sel ? '#ffb347' : '#3a2c20';
      ctx.shadowColor = p.set ? '#5dff9a' : '#ffb347';
      ctx.shadowBlur = p.set || i === this.sel ? 18 + p.flash * 30 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (p.flash > 0) {
        ctx.strokeStyle = `rgba(93,255,154,${p.flash})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, plugY, 40 + (1 - p.flash) * 60, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // pick: enters from the left through the keyway, hook under the selected pin
    const sel = this.pins[this.sel];
    const px = this.pinX(this.sel);
    const tipY = plugY + 122 - (sel.set ? 0 : sel.lift * travel) + 2;
    ctx.save();
    ctx.translate(0, rot * 18);
    const pickGrad = ctx.createLinearGradient(0, tipY - 10, 0, tipY + 30);
    pickGrad.addColorStop(0, '#e8ecef');
    pickGrad.addColorStop(1, '#6a7076');
    ctx.strokeStyle = pickGrad;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-20, plugY + 140);
    ctx.lineTo(px - 50, plugY + 138);
    ctx.quadraticCurveTo(px - 10, plugY + 138, px - 4, tipY + 10);
    ctx.lineTo(px + 2, tipY);
    ctx.stroke();
    // handle
    ctx.fillStyle = '#3a2618';
    roundRect(ctx, -60, plugY + 128, 200, 30, 10);
    ctx.fill();
    ctx.fillStyle = '#ff8a2a';
    ctx.fillRect(40, plugY + 141, 70, 4);
    // tension wrench
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(left - 10, plugY + 128);
    ctx.lineTo(left - 70, plugY + 128);
    ctx.lineTo(left - 70 - rot * 40, plugY + 260 + rot * 20);
    ctx.stroke();
    ctx.restore();

    // strain bar
    const sw = 360;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(W / 2 - sw / 2, H - 46, sw, 10);
    const sg = ctx.createLinearGradient(W / 2 - sw / 2, 0, W / 2 + sw / 2, 0);
    sg.addColorStop(0, '#ffb347');
    sg.addColorStop(1, '#ff3b3b');
    ctx.fillStyle = sg;
    ctx.fillRect(W / 2 - sw / 2, H - 46, sw * Math.min(1, this.strain), 10);
    ctx.fillStyle = '#b9ab95';
    ctx.font = '600 20px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PICK STRAIN', W / 2, H - 58);
    ctx.textAlign = 'left';

    // success shimmer
    if (this.done) {
      ctx.fillStyle = `rgba(93,255,154,${0.25 * (1 - this.openAnim)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}

const now = () => performance.now() / 1000;

function brassSet(ctx: CanvasRenderingContext2D, x: number) {
  const g = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
  g.addColorStop(0, '#3a7a4a');
  g.addColorStop(0.45, '#b8ffcf');
  g.addColorStop(1, '#2a6a3a');
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
