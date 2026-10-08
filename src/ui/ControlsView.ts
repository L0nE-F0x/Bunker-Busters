import './controls.css';
import type { AudioEngine } from '@/engine/audio';
import { ACTIONS, STICK_ACTIONS, binds, keyLabel, padGlyph, padName, type Action } from '@/engine/bindings';
import { pad } from '@/engine/gamepad';

/**
 * Settings → Controls: every action with two keyboard slots and a controller button. Click a slot
 * (or press A on it) and press the new key / button. A key another action was using trades places
 * with the one you gave up; Backspace clears a slot; holding a controller button binds a "hold".
 */
export function openControls(root: HTMLElement, audio: AudioEngine) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.zIndex = '36'; // over Settings (35)
  const panel = document.createElement('div');
  panel.className = 'panel pause cx interactive';
  ov.appendChild(panel);

  const HELP = 'Pick a binding, then press the new key. Backspace clears it. On a controller, hold the button to bind a hold.';
  let note = HELP;
  let flash: Action | null = null;
  let waiting: { a: Action; slot: 0 | 1 | 'pad' } | null = null;
  let stop: (() => void) | null = null;

  const cell = (a: Action, slot: 0 | 1 | 'pad') => {
    const wait = waiting && waiting.a === a && waiting.slot === slot;
    if (slot === 'pad') {
      if (STICK_ACTIONS.has(a)) return `<span class="cx-fixed">Left stick</span>`;
      const p = binds.pad(a);
      return `<button class="cx-b pad ${wait ? 'wait' : ''} ${p ? '' : 'none'}" data-a="${a}" data-slot="pad">${wait ? 'Press a button…' : p ? padGlyph(p) : '—'}</button>`;
    }
    const k = binds.keys(a)[slot] ?? '';
    return `<button class="cx-b ${wait ? 'wait' : ''} ${k ? '' : 'none'}" data-a="${a}" data-slot="${slot}">${wait ? 'Press a key…' : k ? keyLabel(k) : '—'}</button>`;
  };

  const paint = () => {
    const list = panel.querySelector('.cx-list');
    const scroll = list ? list.scrollTop : 0;
    let group = '';
    const rows = ACTIONS.map((def) => {
      const head = def.group !== group ? `<div class="cx-group">${(group = def.group)}</div>` : '';
      return `${head}<div class="cx-row ${flash === def.id ? 'flash' : ''}"><span class="cx-name">${def.label}</span>${cell(def.id, 0)}${cell(def.id, 1)}${cell(def.id, 'pad')}</div>`;
    }).join('');
    const fixed = (name: string, k: string, p: string) => `<div class="cx-row fixed"><span class="cx-name">${name}</span><span class="cx-fixed">${k}</span><span class="cx-fixed"></span><span class="cx-fixed">${p}</span></div>`;
    panel.innerHTML = `<div class="scan"></div>
      <div class="cx-head"><h3>CONTROLS</h3><span class="cx-pad ${pad.connected ? 'on' : ''}">${pad.connected ? 'Controller connected' : 'No controller'}</span></div>
      <div class="cx-cols"><span></span><span>Key</span><span>Alt key</span><span>Controller</span></div>
      <div class="cx-list">${rows}
        <div class="cx-group">Fixed</div>
        ${fixed('Look', 'Mouse', 'Right stick')}
        ${fixed('Cycle weapons', 'Wheel', `${padName('P4')} / ${padName('P5')}`)}
        ${fixed('Pause · back', 'Esc', `${padName('P9')} · ${padName('P1')}`)}
      </div>
      <p class="cx-msg">${note}</p>
      <div class="cx-foot">
        <label class="cx-rumble"><span>Controller vibration</span><select data-pad data-k="rumble"><option value="1" ${binds.map.rumble ? 'selected' : ''}>ON</option><option value="0" ${binds.map.rumble ? '' : 'selected'}>OFF</option></select></label>
        <button class="btn reset">Reset to defaults</button>
        <button class="btn primary done">Done</button>
      </div>`;
    const nl = panel.querySelector('.cx-list');
    if (nl) nl.scrollTop = scroll;
    panel.querySelectorAll<HTMLButtonElement>('.cx-b').forEach((b) => {
      b.onmouseenter = () => audio.play('uiHover');
      b.onclick = () => begin(b.dataset.a as Action, b.dataset.slot === 'pad' ? 'pad' : (Number(b.dataset.slot) as 0 | 1));
    });
    (panel.querySelector('.reset') as HTMLButtonElement).onclick = () => {
      cancel();
      binds.reset();
      audio.play('uiConfirm');
      note = 'Back to the defaults.';
      flash = null;
      paint();
    };
    (panel.querySelector('.done') as HTMLButtonElement).onclick = () => { audio.play('ui'); close(); };
    const rumble = panel.querySelector<HTMLSelectElement>('[data-k="rumble"]')!;
    rumble.addEventListener('input', () => {
      binds.setRumble(rumble.value === '1');
      if (binds.map.rumble) pad.rumble(0.5, 0.5, 180);
    });
  };

  const done = (msg: string, a: Action | null) => {
    stop?.();
    stop = null;
    waiting = null;
    note = msg || HELP;
    flash = a;
    paint();
    if (a) setTimeout(() => { if (flash === a) { flash = null; panel.querySelector('.cx-row.flash')?.classList.remove('flash'); } }, 1400);
  };
  const cancel = () => {
    if (!waiting) return;
    stop?.();
    stop = null;
    waiting = null;
  };

  const begin = (a: Action, slot: 0 | 1 | 'pad') => {
    cancel();
    audio.play('ui');
    waiting = { a, slot };
    const name = ACTIONS.find((d) => d.id === a)!.label;
    if (slot === 'pad') {
      if (!pad.connected) { waiting = null; note = 'No controller found. Press any button on it, then try again.'; paint(); return; }
      note = `${name}: press a controller button (hold it for a hold). Start cancels.`;
      paint();
      pad.startCapture((code) => {
        if (!code) { done('Cancelled.', null); return; }
        const msg = binds.bindPad(a, code);
        audio.play('uiConfirm');
        done(msg ? `${name} → ${padName(code)}. ${msg}` : `${name} → ${padName(code)}.`, a);
      });
      stop = () => pad.cancelCapture();
      return;
    }
    note = `${name}: press a key or mouse button. Esc cancels, Backspace clears.`;
    paint();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { done('Cancelled.', null); return; }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        binds.clearKey(a, slot);
        audio.play('ui');
        done(`${name}: cleared.`, a);
        return;
      }
      const msg = binds.bindKey(a, slot, e.code);
      audio.play('uiConfirm');
      done(`${name} → ${keyLabel(e.code)}.${msg ? ` ${msg}` : ''}`, a);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button > 4) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // the click that follows this press must not also press whatever is under the cursor
      window.addEventListener('click', swallow, { capture: true, once: true });
      const code = `Mouse${e.button}`;
      const msg = binds.bindKey(a, slot, code);
      audio.play('uiConfirm');
      done(`${name} → ${keyLabel(code)}.${msg ? ` ${msg}` : ''}`, a);
    };
    const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const noMenu = (e: Event) => e.preventDefault();
    // armed after this click has finished, so the click that chose the slot isn't the binding
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', noMenu, true);
    }, 0);
    window.addEventListener('keydown', onKey, true);
    stop = () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      setTimeout(() => window.removeEventListener('contextmenu', noMenu, true), 0);
    };
  };

  const onEsc = (e: KeyboardEvent) => {
    if (waiting || e.code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const close = () => {
    cancel();
    window.removeEventListener('keydown', onEsc, true);
    ov.remove();
  };
  window.addEventListener('keydown', onEsc, true);
  paint();
  root.appendChild(ov);
}
