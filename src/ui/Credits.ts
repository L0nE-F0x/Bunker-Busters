import './settings.css';
import type { AudioEngine } from '@/engine/audio';
import { openExternal, licensesUrl, isDesktopApp, SITE_URL, BUILT_BY, BUILT_BY_URL } from './links';

/**
 * Who made the game, and the open-source work it stands on. Opened from the title and pause menus.
 *
 * The name the game is credited to (the owner's GitHub name; the website's comes from .env).
 */
export const DEVELOPER = 'L0nE-F0x';

interface Credit { name: string; what: string; licence: string; by?: string }

/** What ships in the game (or made what ships), with each licence as its own files state it. */
const BUILT_WITH: Credit[] = [
  { name: 'three.js', what: '3D rendering and the shader language', licence: 'MIT', by: 'the three.js authors' },
  { name: 'Rapier', what: 'physics', licence: 'Apache-2.0', by: 'Dimforge' },
  { name: 'Tauri', what: 'the desktop app', licence: 'MIT or Apache-2.0', by: 'Tauri Apps contributors' },
  { name: 'Kokoro-82M', what: 'the voices: AI text-to-speech, rendered ahead of time', licence: 'Apache-2.0', by: 'hexgrad; run with kokoro-onnx (MIT)' },
  { name: 'Meshy', what: 'the people and large animals: 3D models generated with AI', licence: 'Pro plan, commercial use', by: 'Meshy' },
];

const TYPE: Credit[] = [
  { name: 'Chakra Petch', what: 'text', licence: 'OFL-1.1', by: 'the Chakra Petch Project Authors' },
  { name: 'JetBrains Mono', what: 'numbers and labels', licence: 'OFL-1.1', by: 'the JetBrains Mono Project Authors' },
  { name: 'Big Shoulders Stencil Display', what: 'titles', licence: 'OFL-1.1', by: 'Google Fonts' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const item = (c: Credit) => `<li><span><b>${esc(c.name)}</b> · ${esc(c.what)}</span><small>${esc(c.licence)}</small>${c.by ? `<em>${esc(c.by)}</em>` : ''}</li>`;

export function openCredits(root: HTMLElement, audio: AudioEngine, opts: { onBug: () => void }) {
  const ov = document.createElement('div');
  ov.className = 'overlay credits';
  ov.style.zIndex = '35';
  ov.innerHTML = `
    <div class="panel cr interactive"><div class="scan"></div>
      <div class="kicker">Credits</div>
      <div class="big">Bunker Busters</div>
      <div class="by">A game by ${esc(DEVELOPER)} · <a class="cr-built" href="${esc(BUILT_BY_URL)}" target="_blank" rel="noopener" data-go="builtby" data-pad>Built by ${esc(BUILT_BY)}</a></div>
      <div class="rule"></div>
      <div class="cr-cols">
        <div><h4>Built with</h4><ul>${BUILT_WITH.map(item).join('')}</ul></div>
        <div><h4>Type</h4><ul>${TYPE.map(item).join('')}</ul>
          <p class="fine">All three are under the SIL Open Font License 1.1 and ship with the game, through Fontsource.</p></div>
      </div>
      <h4>Everything else</h4>
      <p>The desert, the sky and the weather are made by code as you play, and so are the sound effects and the score.</p>
      <div class="cr-foot">
        <span class="ver">v${__APP_VERSION__}${isDesktopApp() ? ' · desktop' : ''}</span>
        <button class="btn" data-go="licences">Licences</button>
        <button class="btn" data-go="bug">Report a bug</button>
        <button class="btn" data-go="site">Website</button>
        <button class="btn primary back">Back</button>
      </div>
    </div>`;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    const overlays = root.querySelectorAll(':scope > .overlay');
    if (overlays[overlays.length - 1] !== ov) return; // a link box over it handles its own Escape
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const close = () => { window.removeEventListener('keydown', onKey, true); ov.remove(); };
  ov.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.onmouseenter = () => audio.play('uiHover'); });
  (ov.querySelector('.back') as HTMLElement).onclick = () => { audio.play('ui'); close(); };
  ov.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      audio.play('ui');
      const go = b.dataset.go;
      if (go === 'licences') void openExternal(licensesUrl());
      else if (go === 'site') void openExternal(SITE_URL);
      else if (go === 'builtby') void openExternal(BUILT_BY_URL);
      else opts.onBug();
    };
  });
  window.addEventListener('keydown', onKey, true);
  root.appendChild(ov);
  return close;
}
