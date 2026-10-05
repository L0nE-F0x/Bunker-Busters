import './fonts';
import { createRenderer } from '@/engine/renderer';
import { Game } from '@/game/Game';

// Uncaught errors → console, so the desktop app (whose console goes to stdout) shows them in a terminal.
const describe = (e: unknown) => (e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
window.addEventListener('error', (e) => console.error('[BunkerBusters] uncaught:', describe(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => console.error('[BunkerBusters] unhandled rejection:', describe(e.reason)));
// ?trace: log input reaching the page (debugging clicks/keys that seem to go nowhere)
const TRACE = new URLSearchParams(location.search).get('trace');
if (TRACE !== null) {
  if (TRACE) {
    // visible label so several test windows can be told apart
    const tag = document.createElement('div');
    tag.textContent = `TEST ${TRACE}`;
    tag.style.cssText = 'position:fixed;top:12px;right:16px;z-index:99;font:700 28px monospace;color:#3ff2e0;background:#000a;padding:4px 12px;pointer-events:none';
    document.body.appendChild(tag);
  }
  let moved = 0;
  window.addEventListener('mousemove', () => { if (moved++ % 60 === 0) console.log(`[trace] mousemove x${moved}`); }, true);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'keydown'] as const) {
    window.addEventListener(t, (e) => {
      const el = e.target as HTMLElement;
      console.log(`[trace] ${t} ${(e as KeyboardEvent).code ?? ''} → <${el.tagName?.toLowerCase()} class="${el.className}">${(el.textContent ?? '').trim().slice(0, 24)}`);
    }, true);
  }
}

// Linux desktop app (WebKitGTK): blur/backdrop filters and blend modes over the live WebGL canvas are
// re-rasterised every frame on the CPU, which took menus down to a few fps. Cheap look there.
// Override with ?lowfx=0|1.
{
  const q = new URLSearchParams(location.search).get('lowfx');
  const ua = navigator.userAgent;
  const webkitGtk = /Linux/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  if (q === '1' || (q === null && webkitGtk)) document.documentElement.classList.add('lowfx');
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { renderer, isWebGPU, backendLabel } = await createRenderer(canvas);
  console.info(`[BunkerBusters] renderer backend: ${backendLabel}`);
  const game = new Game(renderer, isWebGPU, canvas);
  game.backendLabel = backendLabel;
  (window as unknown as { game: Game }).game = game;
  await game.build();
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ffb347;font:14px monospace;white-space:pre-wrap;z-index:99';
  el.textContent = `Bunker Busters failed to start:\n\n${err?.stack ?? err}`;
  document.body.appendChild(el);
});
