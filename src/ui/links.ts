/**
 * Links out of the game: the bug tracker, the licence notices, the website.
 *
 * Dependency-free on purpose: the boot error screens use it before the game's UI (or its stylesheet)
 * exists, so there are no imports, and the fallback box carries its own inline styles.
 */

export const REPO_URL = 'https://github.com/L0nE-F0x/Bunker-Busters';
export const SITE_URL = 'https://bunker-busters.netlify.app';
/** The owner's studio page: "Built by ApexForge" under the title menu and in the credits (and every site footer, from .env). */
export const BUILT_BY = 'ApexForge';
export const BUILT_BY_URL = 'https://ame-apexforge.org/';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ipc = { invoke: (cmd: string, args?: object) => Promise<unknown> };
const ipc = (): Ipc | undefined => (typeof window !== 'undefined' ? (window as any).__TAURI_INTERNALS__ : undefined);

/** Running in the desktop app (Tauri) rather than a browser tab. */
export const isDesktopApp = () => !!ipc();

/**
 * The full third-party notices (generated into public/licenses.txt). The desktop app has no web
 * server of its own to serve it from, so it opens the website's copy.
 */
export const licensesUrl = () => (isDesktopApp() || typeof location === 'undefined' || !/^https?:$/.test(location.protocol) ? `${SITE_URL}/licenses.txt` : `${location.origin}/licenses.txt`);

/**
 * Open `url` outside the game: the system browser in the desktop app (the shell's `open_external`,
 * which only accepts this game's GitHub and website links), a new tab in a browser. When that can't
 * happen (an older desktop build without the command, a blocked pop-up: a controller press isn't a
 * user gesture), the link is shown with a Copy button. Resolves true if something opened.
 *
 * The browser path opens first and then cuts `opener`, rather than passing 'noopener': with that
 * feature `window.open` always returns null, and a blocked pop-up would look like a success.
 */
export async function openExternal(url: string): Promise<boolean> {
  const app = ipc();
  if (app) {
    try {
      await app.invoke('open_external', { url });
      return true;
    } catch (e) {
      console.warn('[links] open_external failed', e);
      showLink(url);
      return false;
    }
  }
  let w: Window | null = null;
  try { w = window.open(url, '_blank'); } catch { /* blocked */ }
  if (w) {
    try { w.opener = null; } catch { /* already cross-origin */ }
    return true;
  }
  showLink(url);
  return false;
}

export interface BugInfo {
  /** The renderer in use ("WebGL2", "WebGPU (Intel)"). */
  backend?: string;
  /** The graphics preset. */
  quality?: string;
  /** What failed, for the boot error screens (kept short: it rides in the URL). */
  error?: string;
}

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const standalone = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

/**
 * The bug form's "Where do you play?" option, exactly as .github/ISSUE_TEMPLATE/bug_report.yml spells
 * it. The Linux app can't tell from here whether it is the tarball, the AppImage or the .deb, so it
 * leaves the field for the player.
 */
function platformOption(): string {
  if (isDesktopApp()) return /Windows/.test(UA) ? 'Windows app' : '';
  const phone = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  if (!phone) return 'Browser on a computer';
  return standalone() ? 'Phone app (installed from the browser)' : 'Browser on a phone or tablet';
}

/** "Windows 10/11, Chrome 141, 1280×720 at 1x": the OS, the browser or app shell, the window. */
function systemLine(): string {
  const m = (re: RegExp) => re.exec(UA);
  let r: RegExpExecArray | null;
  let os = 'unknown OS';
  if ((r = m(/Android ([\d.]+)/))) os = `Android ${r[1]}`;
  else if ((r = m(/(?:iPhone|CPU) OS ([\d_]+)/))) os = `iOS ${r[1].replace(/_/g, '.')}`;
  else if (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1) os = 'iPadOS';
  else if (/Windows NT 10/.test(UA)) os = 'Windows 10/11';
  else if (/Windows/.test(UA)) os = 'Windows';
  else if (/Mac OS X/.test(UA)) os = 'macOS';
  else if (/CrOS/.test(UA)) os = 'ChromeOS';
  else if (/Linux/.test(UA)) os = 'Linux';
  let br = '';
  if ((r = m(/Edg\/(\d+)/))) br = `Edge ${r[1]}`;
  else if ((r = m(/Firefox\/(\d+)/))) br = `Firefox ${r[1]}`;
  else if ((r = m(/(?:Chrome|CriOS)\/(\d+)/))) br = `Chrome ${r[1]}`;
  else if ((r = m(/Version\/([\d.]+).*Safari/))) br = `Safari ${r[1]}`;
  else if ((r = m(/AppleWebKit\/([\d.]+)/))) br = `WebKit ${r[1]}`;
  const shell = isDesktopApp() ? `desktop app (${/Windows/.test(UA) ? 'WebView2' : 'WebKitGTK'}${br ? `, ${br}` : ''})` : br;
  return [os, shell, `${innerWidth}×${innerHeight} at ${Math.round(devicePixelRatio * 100) / 100}x`].filter(Boolean).join(', ');
}

/**
 * The bug form (.github/ISSUE_TEMPLATE/bug_report.yml: its field ids are URL parameters) with the
 * version, where you play, the system and the renderer filled in. Short: well under 1,000 characters
 * even with an error in the log field.
 */
export function bugReportUrl(info: BugInfo = {}): string {
  const fields: [string, string][] = [
    ['template', 'bug_report.yml'],
    ['version', __APP_VERSION__],
    ['platform', platformOption()],
    ['system', systemLine()],
    ['gpu', [info.backend, info.quality ? `${info.quality} preset` : ''].filter(Boolean).join(', ')],
    ['log', info.error ? info.error.slice(0, 500) : ''],
  ];
  return `${REPO_URL}/issues/new?${fields.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * The link in a box with a Copy button, for when it can't be opened from here. Goes into the game's
 * menu layer (#ui, where the controller navigator looks) when there is one, else onto the page.
 */
export function showLink(url: string, heading = 'Open this link in your browser') {
  const host = document.getElementById('ui') ?? document.body;
  host.querySelector(':scope > .linkbox')?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay linkbox';
  ov.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,5,3,0.82);pointer-events:auto;';
  const box = document.createElement('div');
  box.className = 'panel interactive';
  box.style.cssText = 'width:min(560px,100%);box-sizing:border-box;padding:20px 22px;background:#120d0a;border:1px solid rgba(255,179,71,0.4);color:#f3e9d8;font:14px/1.45 "Chakra Petch",system-ui,sans-serif;';
  const h = document.createElement('div');
  h.textContent = heading;
  h.style.cssText = 'font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#ffb347;font-weight:600;margin-bottom:10px;';
  const field = document.createElement('textarea');
  field.readOnly = true;
  field.value = url;
  field.rows = url.length > 120 ? 4 : 2;
  field.spellcheck = false;
  field.style.cssText = 'display:block;width:100%;box-sizing:border-box;resize:none;padding:8px;background:#0a0705;color:#f3e9d8;border:1px solid rgba(255,179,71,0.28);font:12px/1.4 "JetBrains Mono",ui-monospace,monospace;word-break:break-all;';
  field.onfocus = () => field.select();
  const note = document.createElement('div');
  note.style.cssText = 'min-height:1.4em;margin:8px 0 4px;font-size:12px;color:#b9ab95;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px;';
  const btn = (label: string) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.style.cssText = 'cursor:pointer;padding:9px 16px;font:600 13px "Chakra Petch",system-ui,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#f3e9d8;background:rgba(255,179,71,0.08);border:1px solid rgba(255,179,71,0.4);';
    row.appendChild(b);
    return b;
  };
  const copy = btn('Copy link');
  const close = btn('Close');
  copy.classList.add('primary', 'pad-default');
  copy.onclick = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* no clipboard API here */ }
    if (!ok) {
      field.focus();
      field.select();
      try { ok = document.execCommand('copy'); } catch { /* old engine */ }
    }
    note.textContent = ok ? 'Copied. Paste it into your browser.' : 'Select the link above and copy it.';
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    done();
  };
  const done = () => { window.removeEventListener('keydown', onKey, true); ov.remove(); };
  close.onclick = done;
  window.addEventListener('keydown', onKey, true);
  box.append(h, field, note, row);
  ov.appendChild(box);
  host.appendChild(ov);
  return done;
}
