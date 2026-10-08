import type { NavFrame } from '@/engine/gamepad';

/**
 * Controller navigation for the DOM menus. Finds the menu on top (an overlay, character select or
 * the title), keeps a focus ring on one of its controls, moves it spatially with the d-pad / left
 * stick, and A clicks it. B is Escape (every panel already closes on it). LB/RB flip a panel's tabs;
 * the right stick scrolls. Sliders and selects take left/right.
 *
 * The minigames are steered by their own keys: the navigator types them (synthetic key events on
 * window, the same ones the keyboard sends), so lockpick, the scope, SPLICE and the keypad need no
 * controller code of their own.
 */

const FOCUSABLE = 'button, select, input[type=range], .cell[data-id], [data-pad]';
type MgKind = 'hack' | 'lockpick' | 'circuit';

const visible = (el: HTMLElement) => {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight;
};

const key = (type: 'keydown' | 'keyup', code: string) => {
  const k = code.startsWith('Arrow') ? code : code === 'Space' ? ' ' : code === 'Enter' ? 'Enter' : code === 'Escape' ? 'Escape' : code.replace(/^Key/, '').toLowerCase();
  // from the body, like a real key: window capture listeners (the panels) see it first and can stop it
  // before it reaches the game's own listener on window
  document.body.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true }));
};
const tap = (code: string) => { key('keydown', code); key('keyup', code); };

export class PadNav {
  private focus: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  /** Synthetic keys held down for a minigame (released when it lets go or the minigame closes). */
  private held = new Set<string>();
  /** Not playing and nothing on screen to navigate (the "click to resume" moment): A / Start resumes. */
  onIdle: ((f: NavFrame) => void) | null = null;
  private scrollAcc = 0;

  constructor(private root: HTMLElement) {}

  /** The menu on top, or null. */
  private top(): HTMLElement | null {
    const overlays = this.root.querySelectorAll<HTMLElement>(':scope > .overlay');
    for (let i = overlays.length - 1; i >= 0; i--) if (overlays[i].getClientRects().length) return overlays[i];
    return this.root.querySelector<HTMLElement>(':scope > #charselect') ?? this.root.querySelector<HTMLElement>(':scope > #title');
  }

  private kind(c: HTMLElement): MgKind | null {
    const mg = c.querySelector<HTMLElement>('.mg');
    if (!mg) return null;
    if (mg.classList.contains('hack')) return 'hack';
    return mg.querySelector('.picks') ? 'lockpick' : 'circuit';
  }

  handle(f: NavFrame) {
    const c = this.top();
    if (c !== this.container) {
      this.releaseHeld();
      this.container = c;
      this.setFocus(null);
    }
    if (!c) { this.onIdle?.(f); return; }
    const mg = this.kind(c);
    if (mg) { this.minigame(mg, f); return; }
    this.menu(c, f);
  }

  // ---------------------------------------------------------------- menus
  private list(c: HTMLElement) {
    return [...c.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  }

  private setFocus(el: HTMLElement | null, scroll = true) {
    if (this.focus === el) return;
    this.focus?.classList.remove('pad-focus');
    this.focus = el;
    if (!el) return;
    el.classList.add('pad-focus');
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // the menus' own hover sound
    el.dispatchEvent(new MouseEvent('mouseenter'));
  }

  /** Where focus starts: the selected card, the primary button, else the first control. */
  private initial(c: HTMLElement, items: HTMLElement[]) {
    const pick = (sel: string) => items.find((e) => e.matches(sel));
    // a form (Settings) starts at its first field; a menu at its main button
    const form = c.querySelector('.settings') ? items[0] : null;
    return pick('.pad-default') ?? pick('.cs-card.sel') ?? form ?? pick('.btn.primary') ?? pick('.choice') ?? pick('.next') ?? items[0] ?? null;
  }

  private menu(c: HTMLElement, f: NavFrame) {
    const items = this.list(c);
    // focus lost (the panel re-rendered): find the same control again by its data, or start over
    if (this.focus && !this.focus.isConnected) {
      const sig = this.focus.dataset;
      const again = items.find((e) => Object.keys(sig).length && Object.keys(sig).every((k) => k === 'pad' || e.dataset[k] === sig[k]));
      this.focus = null;
      if (again) this.setFocus(again, false);
    }
    const any = f.up || f.down || f.left || f.right || f.a;
    if (!this.focus && any) {
      this.setFocus(this.initial(c, items));
      if (!f.a) return; // the first press only shows where you are
    }
    const el = this.focus;

    if (f.b) {
      // character select has no Escape; Back is its way out
      const back = c.id === 'charselect' ? c.querySelector<HTMLElement>('.back') : null;
      if (back) back.click(); else tap('Escape');
      return;
    }
    if (f.start) {
      // Start toggles the pause menu shut; on the title it's "go"
      if (c.querySelector('.pause h3')?.textContent === 'PAUSED') tap('Escape');
      else if (el) el.click();
      return;
    }
    if (f.lb || f.rb) this.tabs(c, f.rb ? 1 : -1);
    if (Math.abs(f.ry) > 0.1) this.scroll(el ?? c, f.ry * f.dt * 900);
    if (!el) return;

    const range = el.matches('input[type=range]') ? (el as HTMLInputElement) : null;
    const select = el.matches('select') ? (el as HTMLSelectElement) : null;
    if ((range || select) && (f.left || f.right)) {
      const d = f.right ? 1 : -1;
      if (range) {
        const step = Number(range.step) || 0.05;
        const v = Math.min(Number(range.max), Math.max(Number(range.min), Number(range.value) + d * step * (step < 0.06 ? 2 : 1)));
        range.value = String(Math.round(v / step) * step);
      } else if (select) {
        select.selectedIndex = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + d));
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const dir = f.up ? 'up' : f.down ? 'down' : f.left ? 'left' : f.right ? 'right' : null;
    if (dir) {
      const next = this.spatial(el, items, dir);
      if (next) {
        this.setFocus(next);
        // a roster card (character select) picks on focus, like the arrow keys do
        if (next.getAttribute('role') === 'option') next.click();
      }
      return;
    }
    if (f.a) {
      if (select) {
        select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else el.click();
    }
  }

  /** The nearest control in a direction: along the axis, with sideways distance weighted heavier. */
  private spatial(from: HTMLElement, items: HTMLElement[], dir: 'up' | 'down' | 'left' | 'right') {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of items) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      // gap between the boxes along the axis (edges, so a wide button next to a narrow one still lines up)
      let along: number, side: number;
      if (dir === 'down') { along = b.top - a.bottom; side = Math.max(0, Math.max(b.left - a.right, a.left - b.right)); if (by <= ay + 1) continue; }
      else if (dir === 'up') { along = a.top - b.bottom; side = Math.max(0, Math.max(b.left - a.right, a.left - b.right)); if (by >= ay - 1) continue; }
      else if (dir === 'right') { along = b.left - a.right; side = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom)); if (bx <= ax + 1) continue; }
      else { along = a.left - b.right; side = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom)); if (bx >= ax - 1) continue; }
      const centre = dir === 'up' || dir === 'down' ? Math.abs(bx - ax) : Math.abs(by - ay);
      const score = Math.max(0, along) + side * 3 + centre * 0.15;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  private tabs(c: HTMLElement, d: number) {
    const tabs = [...c.querySelectorAll<HTMLElement>('.tabs .tab')];
    if (!tabs.length) return;
    const i = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
    tabs[(i + d + tabs.length) % tabs.length].click();
    this.setFocus(null);
  }

  private scroll(from: HTMLElement, dy: number) {
    let el: HTMLElement | null = from;
    while (el && el !== this.root) {
      if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) break;
      el = el.parentElement;
    }
    if (!el || el === this.root) return;
    this.scrollAcc += dy;
    const n = Math.trunc(this.scrollAcc);
    if (n) { el.scrollTop += n; this.scrollAcc -= n; }
  }

  // ---------------------------------------------------------------- minigames
  private hold(code: string, on: boolean) {
    if (on === this.held.has(code)) return;
    if (on) { this.held.add(code); key('keydown', code); } else { this.held.delete(code); key('keyup', code); }
  }
  private releaseHeld() {
    for (const c of [...this.held]) this.hold(c, false);
  }

  private minigame(kind: MgKind, f: NavFrame) {
    this.setFocus(null);
    if (f.b) { this.releaseHeld(); tap('Escape'); return; }
    if (kind === 'lockpick') {
      // choose the pin with left/right, lift with A or RT (release to set)
      if (f.left) tap('ArrowLeft');
      if (f.right) tap('ArrowRight');
      this.hold('Space', f.aHeld || f.ly < -0.6);
    } else if (kind === 'circuit') {
      // the scope: stick up/down is amplitude, left/right is frequency (held, like the keys)
      this.hold('ArrowUp', f.ly < -0.35);
      this.hold('ArrowDown', f.ly > 0.35);
      this.hold('ArrowLeft', f.lx < -0.35);
      this.hold('ArrowRight', f.lx > 0.35);
    } else {
      // SPLICE: step along the lit line, A splices, X or Y fires a spike
      if (f.up) tap('ArrowUp');
      if (f.down) tap('ArrowDown');
      if (f.left) tap('ArrowLeft');
      if (f.right) tap('ArrowRight');
      if (f.a) tap('Enter');
      if (f.x || f.y) tap('KeyF');
    }
  }
}
