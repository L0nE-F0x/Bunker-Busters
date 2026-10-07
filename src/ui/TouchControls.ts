import type { Input } from '@/engine/input';
import { enterFullscreen } from '@/engine/device';

// Stroke glyphs in the same hand-drawn style as the item icons.
const G = (body: string) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const GLYPH = {
  jump: G('<path d="M12 28 L24 16 L36 28"/><path d="M12 38 L24 26 L36 38" opacity=".45"/>'),
  crouch: G('<path d="M12 12 L24 24 L36 12" opacity=".45"/><path d="M12 22 L24 34 L36 22"/><path d="M10 40 h28"/>'),
  use: G('<path d="M18 26 V12 a3 3 0 0 1 6 0 v12"/><path d="M24 22 v-3 a3 3 0 0 1 6 0 v5"/><path d="M30 23 a3 3 0 0 1 6 0 v7 c0 7 -4 11 -10 11 h-2 c-5 0 -8 -3 -10 -7 l-4 -8 a3 3 0 0 1 5 -3 l3 4"/>'),
  torch: G('<path d="M14 20 h12 l8 -6 v20 l-8 -6 h-12 z"/><path d="M38 18 l4 -2 M39 24 h4 M38 30 l4 2"/>'),
  pause: G('<path d="M18 13 v22 M30 13 v22"/>'),
  kit: G('<rect x="11" y="16" width="26" height="22" rx="3"/><path d="M18 16 v-4 h12 v4 M11 25 h26 M22 25 v4 h4 v-4"/>'),
  map: G('<path d="M8 14 l10 -4 l12 4 l10 -4 v24 l-10 4 l-12 -4 l-10 4 z"/><path d="M18 10 v24 M30 14 v24"/>'),
  fire: G('<circle cx="24" cy="24" r="12"/><path d="M24 6 v8 M24 34 v8 M6 24 h8 M34 24 h8"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/>'),
  aim: G('<path d="M10 24 c6 -10 22 -10 28 0 c-6 10 -22 10 -28 0 z"/><circle cx="24" cy="24" r="5"/>'),
  reload: G('<path d="M36 18 a13 13 0 1 0 2 10"/><path d="M38 10 v9 h-9"/>'),
  swap: G('<path d="M12 18 h22 l-6 -6 M36 30 h-22 l6 6"/>'),
};

type Role = { kind: 'stick' } | { kind: 'look'; x: number; y: number } | { kind: 'key'; code: string; el: HTMLElement };

/** Pixel radius of the move stick. Dragging past ~1.4 radii upward breaks into a sprint. */
const STICK_R = 54;
const DEAD = 0.14;
/** Touch look speed: screen px → mouse-equivalent px (the camera scales by its own sensitivity). */
const LOOK_GAIN = 2.3;

/**
 * On-screen controls for phones and tablets. Left half: a floating move stick (it appears where the
 * thumb lands). Right half: drag to look. Buttons feed the same key codes the keyboard does, so the
 * game loop doesn't know the difference. Any element anywhere with `data-key` (HUD prompts, hotbar
 * slots) acts as a button too.
 */
export class TouchControls {
  root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private useBtn: HTMLElement;
  private altBtn: HTMLElement;
  private crouchBtn: HTMLElement;
  private torchBtn: HTMLElement;
  private armsEl: HTMLElement;
  private roles = new Map<number, Role>();
  private origin = { x: 0, y: 0 };
  private active = false;
  private sprintKey = false;

  constructor(private input: Input) {
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    const btn = (cls: string, key: string, glyph: string, label = '') =>
      `<div class="tb ${cls}" data-key="${key}">${glyph}${label ? `<span>${label}</span>` : ''}</div>`;
    root.innerHTML = `
      <div class="stick"><div class="ring"></div><div class="knob"></div><div class="run">SPRINT</div></div>
      <div class="tbar">${btn('t-pause', 'Escape', GLYPH.pause)}${btn('t-kit', 'Tab', GLYPH.kit)}${btn('t-map', 'KeyM', GLYPH.map)}</div>
      <div class="cluster">
        ${btn('t-jump', 'Space', GLYPH.jump)}
        ${btn('t-crouch', 'KeyC', GLYPH.crouch)}
        ${btn('t-use', 'KeyE', GLYPH.use)}
        ${btn('t-alt', 'KeyF', '', 'ALT')}
        ${btn('t-torch', 'KeyL', GLYPH.torch)}
      </div>
      <div class="arms">
        ${btn('t-fire', 'TouchFire', GLYPH.fire)}
        ${btn('t-aim', 'TouchAim', GLYPH.aim)}
        ${btn('t-reload', 'KeyR', GLYPH.reload)}
        ${btn('t-swap', 'KeyQ', GLYPH.swap)}
      </div>`;
    this.stick = root.querySelector('.stick')!;
    this.knob = root.querySelector('.knob')!;
    this.useBtn = root.querySelector('.t-use')!;
    this.altBtn = root.querySelector('.t-alt')!;
    this.crouchBtn = root.querySelector('.t-crouch')!;
    this.torchBtn = root.querySelector('.t-torch')!;
    this.armsEl = root.querySelector('.arms')!;
    document.body.appendChild(root);

    const rotate = document.createElement('div');
    rotate.id = 'rotate';
    rotate.innerHTML = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><rect x="20" y="8" width="24" height="44" rx="4"/><path d="M29 46 h6"/><path d="M8 40 a24 24 0 0 0 20 18" stroke="#ffb347"/><path d="M22 56 l6 2 l-2 -6" stroke="#ffb347"/></svg>
      <b>Turn your phone sideways</b><span>Bunker Busters plays in landscape.</span>`;
    document.body.appendChild(rotate);

    // passive: false so preventDefault stops the page from scrolling, zooming or long-press selecting
    const opts = { passive: false } as const;
    document.addEventListener('pointerdown', this.onDown, opts);
    document.addEventListener('pointermove', this.onMove, opts);
    document.addEventListener('pointerup', this.onUp, opts);
    document.addEventListener('pointercancel', this.onUp, opts);
    // fullscreen needs a real gesture, and pointerup is one for touch (pointerdown isn't)
    document.addEventListener('pointerup', () => enterFullscreen());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Controls are live only while playing with nothing on top. */
  setActive(v: boolean) {
    if (v === this.active) return;
    this.active = v;
    this.root.classList.toggle('on', v);
    if (!v) this.releaseAll();
  }

  /** Once per frame: what the buttons should show. */
  private ammoText = '';
  update(f: { use: boolean; useNA: boolean; alt: string | null; crouch: boolean; torch: boolean; armed?: boolean; gun?: boolean; ammo?: string }) {
    const ammo = f.ammo ?? '';
    if (ammo !== this.ammoText) {
      this.ammoText = ammo;
      let el = this.armsEl.querySelector('.t-fire span') as HTMLElement | null;
      if (!el) { el = document.createElement('span'); this.armsEl.querySelector('.t-fire')!.appendChild(el); }
      el.textContent = ammo;
    }
    const cl = (el: HTMLElement, c: string, on: boolean) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
    cl(this.armsEl, 'hide', !f.armed);
    cl(this.armsEl, 'melee', !f.gun);
    cl(this.useBtn, 'lit', f.use && !f.useNA);
    cl(this.useBtn, 'dim', !f.use || f.useNA);
    cl(this.altBtn, 'hide', !f.alt);
    cl(this.crouchBtn, 'lit', f.crouch);
    cl(this.torchBtn, 'lit', f.torch);
  }

  private releaseAll() {
    for (const [, r] of this.roles) if (r.kind === 'key' && r.code !== 'KeyC') this.input.release(r.code);
    this.roles.clear();
    this.input.moveX = this.input.moveZ = 0;
    this.setSprint(false);
    this.stick.classList.remove('held', 'sprint');
  }

  private setSprint(on: boolean) {
    if (on === this.sprintKey) return;
    this.sprintKey = on;
    if (on) this.input.press('ShiftLeft'); else this.input.release('ShiftLeft');
    this.stick.classList.toggle('sprint', on);
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const t = e.target as HTMLElement;
    const keyEl = t.closest?.('[data-key]') as HTMLElement | null;
    if (!this.active) return;
    // on-screen buttons, plus HUD elements that double as buttons (prompts, hotbar slots)
    if (keyEl) {
      e.preventDefault();
      const code = keyEl.dataset.key!;
      if (code === 'KeyC') {
        // crouch toggles: a thumb can't hold it while also steering and looking
        if (this.input.isDownRaw('KeyC')) this.input.release('KeyC'); else this.input.press('KeyC');
      } else this.input.press(code);
      keyEl.classList.add('down');
      this.roles.set(e.pointerId, { kind: 'key', code, el: keyEl });
      return;
    }
    if (t.closest?.('.interactive, button, .overlay')) return;
    e.preventDefault();
    if (e.clientX < innerWidth * 0.42 && ![...this.roles.values()].some((r) => r.kind === 'stick')) {
      this.origin = { x: e.clientX, y: e.clientY };
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = '';
      this.stick.classList.add('held');
      this.roles.set(e.pointerId, { kind: 'stick' });
    } else {
      this.roles.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    }
  };

  private onMove = (e: PointerEvent) => {
    const r = this.roles.get(e.pointerId);
    if (!r) return;
    e.preventDefault();
    if (r.kind === 'look') {
      const k = LOOK_GAIN;
      this.input.mouseDX += (e.clientX - r.x) * k;
      this.input.mouseDY += (e.clientY - r.y) * k;
      r.x = e.clientX;
      r.y = e.clientY;
    } else if (r.kind === 'stick') {
      const dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      const d = Math.hypot(dx, dy);
      const n = Math.min(1, d / STICK_R);
      const s = d > 0 ? n / d : 0;
      let x = dx * s, z = -dy * s;
      if (n < DEAD) x = z = 0;
      this.input.moveX = x;
      this.input.moveZ = z;
      // past the ring, mostly forward: sprint
      this.setSprint(-dy > STICK_R * 1.4 && Math.abs(dx) < -dy * 0.7);
      const kd = Math.min(d, STICK_R);
      this.knob.style.transform = d > 0 ? `translate(${(dx / d) * kd}px, ${(dy / d) * kd}px)` : '';
    }
  };

  private onUp = (e: PointerEvent) => {
    const r = this.roles.get(e.pointerId);
    if (!r) return;
    this.roles.delete(e.pointerId);
    if (r.kind === 'key') {
      r.el.classList.remove('down');
      if (r.code !== 'KeyC') this.input.release(r.code);
    } else if (r.kind === 'stick') {
      this.input.moveX = this.input.moveZ = 0;
      this.setSprint(false);
      this.stick.classList.remove('held');
      this.knob.style.transform = '';
    }
  };
}
