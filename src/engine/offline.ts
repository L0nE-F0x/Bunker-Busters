/**
 * Offline play for the browser build: a service worker (scripts/offline/sw.js, built into
 * dist/play/sw.js) saves every file the game uses (~75 MB) once the game has booted, so /play/ and
 * the home-screen app open and play with no connection. Not in dev, not in the desktop app (its files
 * are local already). `?offline=0` removes it (debugging).
 *
 * The title footer shows where it's at (`offlineLabel()`, kept current in any `.offline-status`).
 *
 * Moving to a new deploy: the page registers `sw.js?v=<deploy id>`, so a page from a new deploy
 * installs that deploy's worker right away. A page served from the old worker's cache (offline, or a
 * network slower than its 4 s wait) registers the old id, so it also asks the browser to look for a
 * newer worker (`update()`); when one takes over mid-session the footer says a reload gets the new
 * version, and the next launch opens it (the new worker serves its own saved page).
 */
let label = '';

export const offlineLabel = () => label;

function show(text: string) {
  label = text;
  for (const el of document.querySelectorAll<HTMLElement>('.offline-status')) el.textContent = text;
}

export function startOffline() {
  const sw = navigator.serviceWorker;
  if (import.meta.env.DEV || !sw || (window as any).__TAURI_INTERNALS__ || !location.pathname.startsWith('/play/')) return;
  if (new URLSearchParams(location.search).get('offline') === '0') {
    void sw.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    void caches.delete('bb-offline');
    return;
  }
  let updated = false;
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; done: number; total: number; ready: boolean; failed?: boolean };
    if (d?.type !== 'bb-offline' || updated) return;
    show(d.failed ? ' · OFFLINE SAVE PAUSED' : d.ready ? ' · PLAYS OFFLINE' : ` · SAVING FOR OFFLINE ${Math.floor((d.done / d.total) * 100)}%`);
  });
  // the build stamps an id into the page (vite.config.ts): a page from a newer deploy registers a new
  // script URL, which makes the browser install that deploy's worker now (it fetches only what changed)
  const id = document.querySelector<HTMLMetaElement>('meta[name="bb-offline"]')?.content;
  if (!id) return;
  // another deploy's worker took over this page: it keeps running as it is, and a reload gets the
  // worker's version (this page's own deploy taking over from an older worker is just the update landing)
  sw.addEventListener('controllerchange', () => {
    const v = sw.controller?.scriptURL.split('?v=')[1];
    if (v && v !== id) {
      updated = true;
      show(' · NEW VERSION READY: RELOAD');
    } else sw.controller?.postMessage('status');
  });
  sw.startMessages();
  sw.register(`/play/sw.js?v=${id}`, { scope: '/play/' })
    .then((reg) => {
      // installed home-screen apps get this without asking; it keeps the browser from evicting the files
      void navigator.storage?.persist?.();
      reg.active?.postMessage('status');
      // this page may be an old deploy's saved copy (slow or no network at launch): look for a newer
      // worker now rather than whenever the browser gets round to it (an offline check just fails)
      if (navigator.onLine !== false) reg.update().catch(() => { /* offline, or the network blinked */ });
    })
    .catch((err) => console.warn('[offline] service worker:', err));
}
