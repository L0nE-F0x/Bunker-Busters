/**
 * What the player sees when the game can't start, or stops: a screen in the game's look that says
 * what happened in plain words and what to try, with the details one click away ("Copy details": the
 * version, the graphics backend and GPU, the browser, the error) and a prefilled bug report.
 *
 * Imported first by main.ts, so an error while the game's modules load still reaches a screen.
 */

import { openExternal, bugReportUrl, isDesktopApp, SITE_URL } from './links';

/** What's known about the machine, for the details (filled in as the boot learns it). */
export const bootInfo: { backend: string; gpu: string; quality: string } = { backend: '', gpu: '', quality: '' };


export type FailKind = 'no-webgl' | 'software' | 'context-lost' | 'download' | 'memory' | 'crash';

export interface FailChoice { label: string; primary?: boolean; run: () => void }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function errorText(e: unknown) {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}`;
  return e === undefined ? '' : String(e);
}

/** The plain-text details block (what "Copy details" copies). */
export function failDetails(kind: FailKind, error?: unknown) {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lines = [
    `Bunker Busters v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?'} (${(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ? 'desktop app' : 'browser'})`,
    `Problem: ${kind}`,
    `Graphics: ${bootInfo.backend || 'not started'}${bootInfo.quality ? `, quality ${bootInfo.quality}` : ''}`,
    `GPU: ${bootInfo.gpu || 'unknown'}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x${nav.deviceMemory ? `, ${nav.deviceMemory} GB memory` : ''}${navigator.hardwareConcurrency ? `, ${navigator.hardwareConcurrency} threads` : ''}`,
    `Page: ${location.pathname}${location.search}`,
    `Time: ${new Date().toISOString()}`,
  ];
  const err = errorText(error);
  if (err) lines.push('', err);
  return lines.join('\n');
}

/** The repo's bug form with the version, platform, system and renderer filled in, and the error (ui/links.ts). */
function reportUrl(kind: FailKind, error?: unknown) {
  const first = errorText(error).split('\n')[0];
  return bugReportUrl({ backend: bootInfo.backend || undefined, quality: bootInfo.quality || undefined, error: `${kind}${first ? `: ${first}` : ''}` });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // (no clipboard API, or not allowed): the old way
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

let current: HTMLElement | null = null;

/**
 * Put up a failure screen (replacing any other). `body` and `steps` are trusted HTML (our own text).
 * Returns the element; choices close it unless they reload.
 */
export function failScreen(o: { kind: FailKind; title: string; body: string; steps?: string[]; choices: FailChoice[]; error?: unknown; download?: boolean }) {
  current?.remove();
  document.getElementById('loading')?.classList.add('behind');
  const el = document.createElement('div');
  el.id = 'bootfail';
  el.dataset.kind = o.kind; // (the desktop install test, src-tauri/src/smoke.rs, looks for 'software')
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'bootfail-title');
  el.innerHTML = `
    <div class="bf-card">
      <div class="bf-logo">BUNKER BUSTERS</div>
      <h2 id="bootfail-title">${esc(o.title)}</h2>
      <p class="bf-body">${o.body}</p>
      ${o.steps?.length ? `<ul class="bf-steps">${o.steps.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}
      <div class="bf-actions"></div>
      <div class="bf-meta">
        <button class="bf-link bf-copy" type="button">Copy details</button>
        <button class="bf-link bf-report" type="button">Report this on GitHub</button>
        ${o.download && !isDesktopApp() ? '<button class="bf-link bf-get" type="button">Get the desktop app</button>' : ''}
        <button class="bf-link bf-show" type="button">Show details</button>
      </div>
      <pre class="bf-details" hidden></pre>
    </div>`;
  const actions = el.querySelector('.bf-actions')!;
  for (const c of o.choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${c.primary ? ' primary' : ''}`;
    b.textContent = c.label;
    b.onclick = () => c.run();
    actions.appendChild(b);
  }
  const details = failDetails(o.kind, o.error);
  const pre = el.querySelector<HTMLPreElement>('.bf-details')!;
  pre.textContent = details;
  const copyBtn = el.querySelector<HTMLButtonElement>('.bf-copy')!;
  copyBtn.onclick = async () => { copyBtn.textContent = (await copy(details)) ? 'Copied' : 'Select the details below and copy them'; if (pre.hidden) { pre.hidden = false; } };
  // (links go through openExternal: the system browser in the desktop app, a new tab here)
  el.querySelector<HTMLButtonElement>('.bf-report')!.onclick = () => void openExternal(reportUrl(o.kind, o.error));
  const get = el.querySelector<HTMLButtonElement>('.bf-get');
  if (get) get.onclick = () => void openExternal(`${SITE_URL}/#get`);
  const showBtn = el.querySelector<HTMLButtonElement>('.bf-show')!;
  showBtn.onclick = () => { pre.hidden = !pre.hidden; showBtn.textContent = pre.hidden ? 'Show details' : 'Hide details'; };
  document.body.appendChild(el);
  current = el;
  (actions.querySelector('.btn.primary') as HTMLButtonElement | null ?? actions.querySelector('.btn') as HTMLButtonElement | null)?.focus();
  console.error(`[BunkerBusters] ${o.kind}: ${o.title}\n${details}`);
  return el;
}

export function closeFailScreen() {
  current?.remove();
  current = null;
  document.getElementById('loading')?.classList.remove('behind');
}

const reload = () => location.reload();

/** The hardware-acceleration switches, browser by browser. */
const ACCEL_STEPS = [
  '<b>Chrome:</b> Settings → System → turn on <i>Use graphics acceleration when available</i>, then relaunch.',
  '<b>Edge:</b> Settings → System and performance → turn on <i>Use graphics acceleration when available</i>, then restart.',
  '<b>Firefox:</b> Settings → General → Performance: untick <i>Use recommended performance settings</i>, tick <i>Use hardware acceleration when available</i>, then restart.',
  '<b>Safari:</b> WebGL 2 is on from Safari 15. Update macOS or iOS if yours is older.',
];

// ------------------------------------------------------------------ the screens

/** No WebGL 2 and no WebGPU: nothing to draw with. */
export function noGraphics(error: unknown) {
  failScreen({
    kind: 'no-webgl', error, download: true,
    title: 'This browser can\'t draw the game',
    body: 'Bunker Busters needs WebGL 2 or WebGPU to draw its world, and this browser gave it neither. Usually that\'s an old browser, or graphics acceleration switched off.',
    steps: [
      'Update the browser. Any Chrome, Edge, Firefox or Safari from the last few years will do.',
      ...ACCEL_STEPS,
      'If the browser said WebGL hit a problem, close it completely and open it again.',
      'Or play the desktop app (Windows and Linux): it doesn\'t depend on the browser.',
    ],
    choices: [{ label: 'Try again', primary: true, run: reload }],
  });
}

/** Drawing in software (SwiftShader, llvmpipe, Basic Render Driver): it'll run, slowly. Resolves with the choice. */
export function softwareWarning(gpu: string): Promise<'low' | 'keep'> {
  return new Promise((resolve) => {
    const done = (c: 'low' | 'keep') => { closeFailScreen(); resolve(c); };
    failScreen({
      kind: 'software', download: true,
      title: 'The game is running without your graphics card',
      body: `This browser is drawing in software (<code>${esc(gpu)}</code>), so the game will be slow: a few frames a second, maybe less. Turning graphics acceleration on, or updating the graphics driver, usually fixes it.`,
      steps: ACCEL_STEPS.slice(0, 3),
      choices: [
        { label: 'Continue on Low', primary: true, run: () => done('low') },
        { label: 'Continue anyway', run: () => done('keep') },
      ],
    });
  });
}

/** The graphics context went away mid-game (a driver reset, the GPU needed elsewhere). */
export function contextLost(saved: 'saved' | 'unsaved' | 'menu', error?: unknown) {
  const note = saved === 'saved' ? 'Your game was saved just now, so you won\'t lose anything.'
    : saved === 'unsaved' ? 'It couldn\'t be saved this time (an alarm was ringing, or you were down). Your last autosave is at most a minute old.'
      : '';
  failScreen({
    kind: 'context-lost', error,
    title: 'The graphics driver reset',
    body: `The browser took the game's graphics away. That happens when the graphics driver crashes or restarts, when the computer wakes from sleep, or when something else needs the graphics memory. ${note}`,
    steps: ['Reload to carry on. If it keeps happening, close other games and 3D tabs, or set Quality to Low in Settings.'],
    choices: [{ label: 'Reload', primary: true, run: reload }],
  });
}

/** Files that never arrived after their retries. `retry` tries again in place; `play` carries on without them. */
export function downloadFailed(o: { files: string[]; why: 'offline' | 'http' | 'network'; status?: number; error?: unknown; retry: () => void; play?: () => void }) {
  const list = o.files.slice(0, 6).join(', ') + (o.files.length > 6 ? ` and ${o.files.length - 6} more` : '');
  const cause = o.why === 'offline' ? 'This device looks offline. Reconnect, then try again.'
    : o.why === 'http' ? `The server answered ${o.status ?? 'with an error'}. If the site was just updated, give it a minute and try again.`
      : 'The connection dropped, or something on the way blocked them: a firewall, a school or work network filter, or an ad blocker.';
  failScreen({
    kind: 'download', error: o.error,
    title: 'Part of the game didn\'t download',
    body: `These files never arrived: ${esc(list)}. ${cause}`,
    choices: [
      { label: 'Try again', primary: true, run: () => { closeFailScreen(); o.retry(); } },
      ...(o.play ? [{ label: 'Play without them', run: () => { closeFailScreen(); o.play!(); } }] : []),
    ],
  });
}

/** The last loads never finished (most likely the tab ran out of memory and was reloaded). Resolves with the choice. */
export function memoryTrouble(error?: unknown): Promise<'low' | 'again'> {
  return new Promise((resolve) => {
    const done = (c: 'low' | 'again') => { closeFailScreen(); resolve(c); };
    failScreen({
      kind: 'memory', error,
      title: 'Your device may be short of memory',
      body: 'The game didn\'t finish loading the last two times. On phones and tablets that usually means the browser ran out of memory and reloaded the page.',
      steps: ['Close other tabs and apps, then try again.', 'Low quality needs less memory and loads faster.'],
      choices: [
        { label: 'Try on Low', primary: true, run: () => done('low') },
        { label: 'Try again', run: () => done('again') },
      ],
    });
  });
}

/** Anything else that stopped the boot. */
export function bootCrashed(error: unknown) {
  if (looksLikeMemory(error)) {
    failScreen({
      kind: 'memory', error,
      title: 'Your device ran out of memory',
      body: 'The browser couldn\'t give the game enough memory to load.',
      steps: ['Close other tabs and apps, then reload.', 'If it happens again, set Quality to Low in Settings (it needs less memory), or play the desktop app.'],
      choices: [{ label: 'Reload', primary: true, run: reload }], download: true,
    });
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  failScreen({
    kind: 'crash', error,
    title: 'Bunker Busters couldn\'t start',
    body: `Something went wrong while it was loading: <code>${esc(msg.slice(0, 200))}</code>`,
    steps: ['Reload the page. If it happens again, update the browser.', 'If it still won\'t start, please report it: the details below tell us what broke.'],
    choices: [{ label: 'Reload', primary: true, run: reload }],
  });
}

export function looksLikeMemory(e: unknown) {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /out of memory|allocation failed|Array buffer allocation|OUT_OF_MEMORY|Cannot allocate/i.test(m);
}

// ------------------------------------------------------------------ the boot's guard

/**
 * An uncaught error from the game's own code before main.ts starts (one of its modules failed to
 * load or run, so nothing else would ever report it) shows the "couldn't start" screen instead of a
 * frozen loading bar. Once main.ts runs, its boot handles its own failures. A counter in
 * sessionStorage notices loads that never finished (a tab that crashed and reloaded):
 * `unfinishedBoots()` says how many in a row.
 */
let started = false;
const LOOP_KEY = 'bunker-busters.boots';
let unfinished = 0;
try {
  unfinished = Number(sessionStorage.getItem(LOOP_KEY)) || 0;
  sessionStorage.setItem(LOOP_KEY, String(unfinished + 1));
} catch { /* storage blocked: no crash-loop check */ }
(window as { __bbBooted?: boolean }).__bbBooted = true;

const ours = (file?: string) => !file || file.startsWith(location.origin) || /^(tauri:|https?:\/\/tauri\.localhost)/.test(file);
window.addEventListener('error', (e) => {
  if (started || !e.error || !ours(e.filename)) return;
  bootCrashed(e.error);
});

/** main.ts is running (from here on, its boot reports its own failures). */
export function bootStarted() {
  started = true;
}

/** Loads in a row before this one that never reached the title. */
export const unfinishedBoots = () => unfinished;

/** The title is up: the crash-loop counter resets. */
export function bootDone() {
  try { sessionStorage.removeItem(LOOP_KEY); } catch { /* ignore */ }
}
