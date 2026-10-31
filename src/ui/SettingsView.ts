import './settings.css';
import type { AudioEngine } from '@/engine/audio';
import { DEFAULT_SETTINGS, type Settings } from '@/game/State';
import { DIFFICULTY } from '@/content/weapons';
import { isTouch } from '@/engine/device';
import { isDesktopApp } from '@/engine/autoQuality';

/**
 * Settings: five pages (Gameplay, Video, Audio, Controls, Accessibility) on tabs, so each fits a 720p
 * screen and a phone in landscape without scrolling. Every change applies and saves at once
 * (`onChange` → Game.applySettings). Reset puts the page on screen back to its defaults (key
 * bindings have their own reset on the Controls screen).
 *
 * Controller: LB/RB flip the tabs (PadNav looks for `.tabs .tab`), the d-pad walks the rows and
 * left/right change a value. Keyboard: the arrows and Enter do the same (PadNav's key navigation).
 */

type Page = 'game' | 'video' | 'audio' | 'controls' | 'access';
const PAGES: [Page, string][] = [['game', 'Gameplay'], ['video', 'Video'], ['audio', 'Audio'], ['controls', 'Controls'], ['access', 'Accessibility']];

type Key = Exclude<keyof Settings, 'binds' | 'voiceOff051' | 'voiceOn052' | 'flashNotice'>;
type Row =
  | { kind: 'select'; k: Key; label: string; options: [string, string][]; hint?: string }
  | { kind: 'range'; k: Key; label: string; min: number; max: number; step: number; fmt: (v: number) => string; hint?: string }
  | { kind: 'button'; label: string; text: string; act: 'controls' }
  | { kind: 'head'; text: string }
  | { kind: 'sample' };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const onOff: [string, string][] = [['0', 'OFF'], ['1', 'ON']];
const holdToggle: [string, string][] = [['0', 'HOLD'], ['1', 'TOGGLE']];
/** Keys shown as ON/OFF or HOLD/TOGGLE selects, stored as booleans. */
const BOOL = new Set<Key>(['voice', 'invertY', 'showFps', 'reduceFlash', 'toggleCrouch', 'toggleSprint', 'toggleAim']);

/** three.js counts the vertical angle; players know the horizontal one, so show that (at this window's shape). */
const fovLabel = (v: number) => `${Math.round((2 * Math.atan(Math.tan((v * Math.PI) / 360) * (innerWidth / Math.max(1, innerHeight))) * 180) / Math.PI)}°`;

function rows(page: Page): Row[] {
  switch (page) {
    case 'game':
      return [
        { kind: 'select', k: 'difficulty', label: 'Difficulty', options: (['story', 'normal', 'hard'] as const).map((d) => [d, `${DIFFICULTY[d].label.toUpperCase()} · ${({ story: 'forgiving', normal: 'as intended', hard: 'brutal' })[d]}`]) },
        { kind: 'range', k: 'fov', label: 'Field of view', min: 50, max: 90, step: 1, fmt: fovLabel },
      ];
    case 'video':
      return [
        // AUTO (engine/autoQuality.ts: browser only) picks the preset from the GPU and holds the frame rate
        { kind: 'select', k: 'quality', label: 'Graphics', options: [...(isDesktopApp ? [] : [['auto', 'AUTO'] as [string, string]]), ...['low', 'medium', 'high', 'ultra'].map((q): [string, string] => [q, q.toUpperCase()])] },
        { kind: 'range', k: 'brightness', label: 'Brightness', min: 0.7, max: 1.4, step: 0.05, fmt: pct, hint: 'Raise it until you can make out the ground on a moonless night.' },
        { kind: 'select', k: 'showFps', label: 'FPS counter', options: onOff },
      ];
    case 'audio':
      return [
        { kind: 'range', k: 'master', label: 'Master volume', min: 0, max: 1, step: 0.05, fmt: pct },
        { kind: 'range', k: 'music', label: 'Music', min: 0, max: 1, step: 0.05, fmt: pct },
        { kind: 'range', k: 'sfx', label: 'Effects', min: 0, max: 1, step: 0.05, fmt: pct },
        { kind: 'select', k: 'voice', label: 'Voices', options: [['1', 'ON'], ['0', 'OFF (subtitles only)']] },
        { kind: 'range', k: 'voiceVol', label: 'Voice volume', min: 0, max: 1, step: 0.05, fmt: pct },
      ];
    case 'controls':
      return isTouch
        ? [{ kind: 'range', k: 'sensitivity', label: 'Look sensitivity', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) }]
        : [
          { kind: 'range', k: 'sensitivity', label: 'Mouse sensitivity', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2), hint: 'The controller\'s look speed follows it too.' },
          { kind: 'select', k: 'invertY', label: 'Invert look', options: [['0', 'OFF'], ['1', 'ON (pull back to look up)']] },
          { kind: 'head', text: 'Keyboard and mouse' },
          { kind: 'select', k: 'toggleCrouch', label: 'Crouch', options: holdToggle },
          { kind: 'select', k: 'toggleSprint', label: 'Sprint', options: holdToggle, hint: 'Toggle: a sprint ends when you stop moving forward.' },
          { kind: 'select', k: 'toggleAim', label: 'Aim down sights', options: holdToggle },
          { kind: 'button', label: 'Keys & controller', text: 'Controls…', act: 'controls' },
        ];
    case 'access':
      return [
        { kind: 'select', k: 'subSize', label: 'Subtitle size', options: [['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'], ['xl', 'EXTRA LARGE']] },
        { kind: 'select', k: 'subBg', label: 'Subtitle background', options: [['none', 'NONE'], ['light', 'LIGHT'], ['dark', 'DARK'], ['solid', 'SOLID']] },
        { kind: 'sample' },
        { kind: 'select', k: 'reduceFlash', label: 'Reduce flashing', options: onOff, hint: 'Flickering lights hold steady. Lightning, muzzle flashes, blasts, EMP static and the red damage edge are dimmed.' },
        { kind: 'range', k: 'shake', label: 'Camera shake', min: 0, max: 1, step: 0.1, fmt: pct },
        { kind: 'range', k: 'bob', label: 'Head bob', min: 0, max: 1, step: 0.1, fmt: pct },
      ];
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** A select's value: booleans as 1/0, Graphics as 'auto' while AUTO runs it. */
const selValue = (k: Key, s: Settings) => (BOOL.has(k) ? (s[k] ? '1' : '0') : k === 'quality' && s.autoQuality ? 'auto' : String(s[k]));

function rowHTML(r: Row, s: Settings): string {
  if (r.kind === 'head') return `<div class="st-head">${esc(r.text)}</div>`;
  if (r.kind === 'sample') return `<div class="st-sample" aria-hidden="true"><div class="subtitle"><span class="who">Mara Voss</span><span class="line">“Crouch, or don't let it look at you.”</span></div></div>`;
  if (r.kind === 'button') return `<span>${esc(r.label)}</span><button class="btn st-act" data-act="${r.act}">${esc(r.text)}</button>`;
  const hint = r.hint ? `<div class="st-hint">${esc(r.hint)}</div>` : '';
  if (r.kind === 'range') {
    const v = s[r.k] as number;
    return `<span>${esc(r.label)} <b class="val" data-v="${r.k}">${esc(r.fmt(v))}</b></span><input type="range" min="${r.min}" max="${r.max}" step="${r.step}" data-k="${r.k}" value="${v}" aria-label="${esc(r.label)}">${hint}`;
  }
  const cur = selValue(r.k, s);
  return `<span>${esc(r.label)}</span><select data-k="${r.k}" aria-label="${esc(r.label)}">${r.options.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${hint}`;
}

export interface SettingsViewOpts {
  /** Settings → Controls… (the key and controller screen; the touch help on phones). */
  showControls: () => void;
}

/** The last page the panel was on (it opens there next time, like the Kit's tabs). */
let lastPage: Page = 'game';

export function openSettingsPanel(root: HTMLElement, audio: AudioEngine, settings: Settings, onChange: (s: Settings) => void, opts: SettingsViewOpts) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.zIndex = '35';
  let page: Page = lastPage;
  const pages = PAGES.map(([id]) => `<div class="settings" data-page="${id}"${id === page ? '' : ' hidden'}>${rows(id).map((r) => rowHTML(r, settings)).join('')}</div>`).join('');
  ov.innerHTML = `
    <div class="panel pause st-panel interactive"><div class="scan"></div>
      <h3>SETTINGS</h3>
      <div class="tabs st-tabs" role="tablist">${PAGES.map(([id, label]) => `<button class="tab${id === page ? ' on' : ''}" role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
      ${pages}
      <div class="st-foot"><button class="btn st-reset">Reset to defaults</button><button class="btn primary done">Done</button></div>
    </div>`;
  /** Value labels, and Voice volume greys out while voices are off. */
  const refresh = () => {
    for (const p of PAGES) for (const r of rows(p[0])) {
      if (r.kind !== 'range') continue;
      const el = ov.querySelector(`[data-v="${r.k}"]`);
      if (el) el.textContent = r.fmt(settings[r.k] as number);
    }
    const vv = ov.querySelector('[data-k="voiceVol"]') as HTMLInputElement | null;
    if (vv) { vv.disabled = !settings.voice; vv.closest('.settings')?.classList.toggle('vv-off', !settings.voice); }
  };
  /** The first control of the page on screen is where the controller's focus starts. */
  const showPage = (p: Page) => {
    page = lastPage = p;
    ov.querySelectorAll<HTMLElement>('.st-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === p));
    ov.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => { el.hidden = el.dataset.page !== p; });
    ov.querySelectorAll('.pad-default').forEach((el) => el.classList.remove('pad-default'));
    ov.querySelector(`[data-page="${p}"]`)?.querySelector('select, input, button')?.classList.add('pad-default');
  };
  let prevQuality = settings.quality;
  const write = (k: Key, raw: string) => {
    const next = settings as unknown as Record<string, unknown>;
    next[k] = BOOL.has(k) ? raw === '1' : k === 'quality' || k === 'difficulty' || k === 'subSize' || k === 'subBg' ? raw : Number(raw);
    // AUTO keeps the preset it runs on; picking a preset turns it off
    if (k === 'quality') { settings.autoQuality = raw === 'auto'; if (raw === 'auto') next.quality = prevQuality; else prevQuality = raw as Settings['quality']; }
    onChange(settings);
    refresh();
  };
  ov.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    inp.addEventListener('input', () => write(inp.dataset.k as Key, inp.value));
  });
  ov.querySelectorAll<HTMLElement>('.st-tabs .tab').forEach((t) => {
    t.onmouseenter = () => audio.play('uiHover');
    t.onclick = () => { if (t.dataset.tab !== page) { audio.play('ui'); showPage(t.dataset.tab as Page); } };
  });
  (ov.querySelector('.st-reset') as HTMLElement).onclick = () => {
    audio.play('uiConfirm');
    const next = settings as unknown as Record<string, unknown>;
    const dflt = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const r of rows(page)) if ((r.kind === 'select' || r.kind === 'range') && !(r.k === 'quality' && DEFAULT_SETTINGS.autoQuality)) next[r.k] = dflt[r.k];
    if (page === 'video') settings.autoQuality = DEFAULT_SETTINGS.autoQuality;
    onChange(settings);
    for (const r of rows(page)) {
      if (r.kind !== 'select' && r.kind !== 'range') continue;
      const el = ov.querySelector(`[data-k="${r.k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = selValue(r.k, settings);
    }
    refresh();
  };
  ov.querySelectorAll<HTMLElement>('.st-act').forEach((b) => {
    b.onclick = () => { audio.play('ui'); if (b.dataset.act === 'controls') opts.showControls(); };
  });
  const esc = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    // a screen over this one (Controls, a link box) handles its own Escape
    const overlays = root.querySelectorAll(':scope > .overlay');
    if (overlays[overlays.length - 1] !== ov) return;
    e.stopPropagation();
    done();
  };
  const done = () => { ov.remove(); window.removeEventListener('keydown', esc, true); };
  window.addEventListener('keydown', esc, true);
  (ov.querySelector('.done') as HTMLElement).onclick = () => { audio.play('ui'); done(); };
  showPage(page);
  refresh();
  root.appendChild(ov);
  return done;
}

/**
 * The photosensitivity notice: once, over the first title screen, with Reduce flashing right there.
 * Skipped under automation (navigator.webdriver: the test and marketing harnesses start from a fresh
 * profile every run) unless the page asks for it with ?notice.
 */
export function needsFlashNotice(s: Settings) {
  if (s.flashNotice) return false;
  return new URLSearchParams(location.search).has('notice') || !navigator.webdriver;
}

export function openFlashNotice(root: HTMLElement, audio: AudioEngine, settings: Settings, onChange: (s: Settings) => void) {
  const ov = document.createElement('div');
  ov.className = 'overlay notice';
  const row = rows('access').find((r) => r.kind === 'select' && r.k === 'reduceFlash')!;
  ov.innerHTML = `
    <div class="panel notice-card interactive" role="alertdialog" aria-labelledby="notice-h"><div class="scan"></div>
      <span class="label">Before you play</span>
      <h3 id="notice-h">Photosensitivity warning</h3>
      <p>This game has flashing lights: lightning in dust storms, muzzle flashes, explosions, EMP static and some flickering lamps.</p>
      <p>A small number of people can have a seizure when they see flashing lights or patterns, including people with no history of epilepsy. If you feel dizzy, your sight changes, or your eyes or face twitch, stop playing and see a doctor.</p>
      <div class="settings">${rowHTML(row, settings)}</div>
      <p class="st-later">You can change this later in Settings → Accessibility.</p>
      <div class="st-foot"><button class="btn primary go pad-default">Continue</button></div>
    </div>`;
  const sel = ov.querySelector('[data-k="reduceFlash"]') as HTMLSelectElement;
  sel.addEventListener('input', () => { settings.reduceFlash = sel.value === '1'; onChange(settings); });
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    const overlays = root.querySelectorAll(':scope > .overlay');
    if (overlays[overlays.length - 1] !== ov) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
    settings.flashNotice = true;
    onChange(settings);
  };
  (ov.querySelector('.go') as HTMLElement).onclick = () => { audio.start(); audio.play('uiConfirm'); close(); };
  window.addEventListener('keydown', onKey, true);
  root.appendChild(ov);
  return close;
}
