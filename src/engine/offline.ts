/**
 * Offline play for the browser build: a service worker (scripts/offline/sw.js, built into
 * dist/play/sw.js) saves every file the game uses (~55 MB) once the game has booted, so /play/ and
 * the home-screen app open and play with no connection. Not in dev, not in the desktop app (its files
 * are local already). `?offline=0` removes it (debugging).
 *
 * The title footer shows where it's at (`offlineLabel()`, kept current in any `.offline-status`).
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
  sw.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; done: number; total: number; ready: boolean; failed?: boolean };
    if (d?.type !== 'bb-offline') return;
    show(d.failed ? ' · OFFLINE SAVE PAUSED' : d.ready ? ' · PLAYS OFFLINE' : ` · SAVING FOR OFFLINE ${Math.floor((d.done / d.total) * 100)}%`);
  });
  sw.startMessages();
  // the build stamps an id into the page (vite.config.ts): a page from a newer deploy registers a new
  // script URL, which makes the browser install that deploy's worker now (it fetches only what changed)
  const id = document.querySelector<HTMLMetaElement>('meta[name="bb-offline"]')?.content;
  if (!id) return;
  sw.register(`/play/sw.js?v=${id}`, { scope: '/play/' })
    .then((reg) => {
      // installed home-screen apps get this without asking; it keeps the browser from evicting the files
      void navigator.storage?.persist?.();
      reg.active?.postMessage('status');
    })
    .catch((err) => console.warn('[offline] service worker:', err));
}
