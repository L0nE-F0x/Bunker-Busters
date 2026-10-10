import './fonts';
import { createRenderer } from '@/engine/renderer';
import { isMobile } from '@/engine/device';
import { Game } from '@/game/Game';
import { prefetchBootModels } from '@/game/bootModels';
import { startOffline } from '@/engine/offline';
import { initInstall, openInstallSheet, isPhone, isInstalledApp } from '@/ui/install';

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
  // mouse stats per second: event count and summed movementX/Y (0 while locked = mouse look is dead)
  let mm = 0, mdx = 0, mdy = 0;
  window.addEventListener('mousemove', (e) => { mm++; mdx += Math.abs(e.movementX); mdy += Math.abs(e.movementY); }, true);
  // frame pacing and key auto-repeat per second (repeats aren't logged one by one)
  let frames = 0, gap = 0, lastF = 0, reps = 0;
  const tick = (t: number) => { frames++; if (lastF) gap = Math.max(gap, t - lastF); lastF = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.addEventListener('keyup', (e) => console.log(`[trace] keyup ${e.code}`), true);
  document.addEventListener('pointerlockchange', () => console.log(`[trace] pointerlockchange locked=${!!document.pointerLockElement}`));
  document.addEventListener('bb-lockchange', () => console.log(`[trace] bb-lockchange locked=${(window as any).game?.input.locked}`));
  document.addEventListener('bb-lockerror', () => console.log('[trace] bb-lockerror'));
  document.addEventListener('pointerlockerror', () => console.log('[trace] pointerlockerror'));
  // once a second: what the game thinks is going on
  setInterval(() => {
    const g = (window as any).game;
    if (!g) return;
    const p = g.player, b = document.querySelector('#title .menu .btn') as HTMLElement | null;
    const r = b?.getBoundingClientRect();
    console.log(`[trace] mode=${g.mode} locked=${g.input.locked} enabled=${g.input.enabled} modal=${g.ui.modalOpen} mg=${g.ui.minigameOpen}` +
      (p ? ` pos=${p.position.x.toFixed(2)},${p.position.z.toFixed(2)} yaw=${g.cam.yaw.toFixed(2)} frozen=${p.frozen} down=[${[...g.input.down].join(',')}]` +
        ` hs=${Math.hypot(p.velocity.x, p.velocity.z).toFixed(2)} sm=${p.speedMult.toFixed(2)} crouch=${p.crouching} sprint=${p.sprinting} winded=${p.winded} stam=${p.stamina.toFixed(2)} grounded=${p.grounded} busy=${g.busy}` : '') +
      ` mouse=${mm}ev dx=${mdx.toFixed(0)} dy=${mdy.toFixed(0)} raw=${g.input.rawLive} fps=${frames} maxgap=${gap.toFixed(0)}ms reps=${reps}` +
      (r ? ` btn0=${(r.x + r.width / 2).toFixed(0)},${(r.y + r.height / 2).toFixed(0)} inner=${innerWidth}x${innerHeight} dpr=${devicePixelRatio}` : ''));
    mm = mdx = mdy = frames = gap = reps = 0;
  }, 1000);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'keydown'] as const) {
    window.addEventListener(t, (e) => {
      if (t === 'keydown' && (e as KeyboardEvent).repeat) { reps++; return; }
      const el = e.target as HTMLElement;
      console.log(`[trace] ${t} ${(e as KeyboardEvent).code ?? ''} → <${el.tagName?.toLowerCase()} class="${el.className}">${(el.textContent ?? '').trim().slice(0, 24)}`);
    }, true);
  }
}

// Linux desktop app (WebKitGTK): blur/backdrop filters and blend modes over the live WebGL canvas are
// re-rasterised every frame on the CPU, which took menus down to a few fps. Cheap look there.
// Phones get the same. Override with ?lowfx=0|1.
{
  const q = new URLSearchParams(location.search).get('lowfx');
  const ua = navigator.userAgent;
  const webkitGtk = /Linux/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  // phones too: blur over a canvas that redraws every frame is a big fill-rate cost on a mobile GPU
  if (q === '1' || (q === null && (webkitGtk || isMobile))) document.documentElement.classList.add('lowfx');
}

// "Install the app" from the site lands here (/play/?install): show the steps over the loading screen.
// Drop the flag from the address first: iOS saves the URL on screen as the home-screen icon's.
initInstall();
{
  if (new URLSearchParams(location.search).has('install')) {
    // (by hand, so the other flags keep their exact spelling: `?webgl`, not `?webgl=`)
    const rest = location.search.slice(1).split('&').filter((kv) => kv && kv.split('=')[0] !== 'install').join('&');
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (isPhone && !isInstalledApp()) openInstallSheet({ onGamePage: true });
  }
}

async function boot() {
  // the models download while the renderer starts and the world is built (Game.build parses them)
  prefetchBootModels();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { renderer, isWebGPU, backendLabel } = await createRenderer(canvas);
  console.info(`[BunkerBusters] renderer backend: ${backendLabel}`);
  const game = new Game(renderer, isWebGPU, canvas);
  game.backendLabel = backendLabel;
  (window as unknown as { game: Game }).game = game;
  await game.build();
  // after the boot, so saving the game for offline play doesn't compete with loading it
  startOffline();
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ffb347;font:14px monospace;white-space:pre-wrap;z-index:99';
  el.textContent = `Bunker Busters failed to start:\n\n${err?.stack ?? err}`;
  document.body.appendChild(el);
});
