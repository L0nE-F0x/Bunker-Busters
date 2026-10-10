import './install.css';

/**
 * "Install the app" for phones, on the site and on the game page. The app is the /play/ page
 * (play.webmanifest + the offline service worker, src/engine/offline.ts).
 *
 * - Android (Chrome, Edge, Samsung): the browser's own install dialog when it offers one
 *   (`beforeinstallprompt`; Chrome holds it back until someone has spent ~30 s on the site), else
 *   the steps for the browser menu. The button turns into the one-tap install if the offer arrives
 *   while the sheet is open.
 * - iPhone / iPad: there is no install API, so the steps (Share → Add to Home Screen). They have
 *   to be followed on the game page, or the icon would open the site: from the site, Install goes to
 *   /play/?install, which opens this sheet over the loading screen.
 * - In-app browsers (Instagram, Facebook, X…) can't install anything: open the page in the browser.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = navigator.userAgent;
export const isIOSDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
/** A phone or tablet: the only devices the sheet is for. */
export const isPhone = isIOSDevice || isAndroid || /Mobile|Silk|Kindle/.test(ua);
const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Twitter|TwitterAndroid|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Pinterest/i.test(ua);
const iosSafari = isIOSDevice && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);

/** Already running as the installed app. */
export const isInstalledApp = () =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

let deferred: InstallPromptEvent | null = null;
const offerListeners = new Set<() => void>();
const KEY = 'bb.installed';

/** Start listening for the browser's install offer. Call early (the event fires once, at load). */
export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    offerListeners.forEach((f) => f());
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  });
}

/** Installed from this browser before (Android tells us; iOS never does). */
export const wasInstalled = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

// stroke icons in the game's hand-drawn style
const I = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  share: I('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>'),
  add: I('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  dots: I('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  more: I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  home: I('<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>'),
};

const step = (n: number, html: string) => `<li><span class="n">${n}</span><span>${html}</span></li>`;

export interface SheetOpts {
  /** On the game page itself. From the site, iOS and menu installs go to the game page first. */
  onGamePage: boolean;
  /** "Play in the browser": closes the sheet (game page) or goes to /play/ (site). */
  onPlay?: () => void;
}

/** The install sheet. Returns a function that closes it. */
export function openInstallSheet(opts: SheetOpts): () => void {
  document.querySelector('.bb-install')?.remove();
  const root = document.createElement('div');
  root.className = 'bb-install';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'bb-install-title');
  root.innerHTML = `
    <div class="bb-install-shade"></div>
    <div class="bb-install-card">
      <button class="bb-install-x" aria-label="Close">×</button>
      <div class="bb-install-head">
        <img src="/icon-192.png" alt="" width="64" height="64" />
        <div><h3 id="bb-install-title">Install Bunker Busters</h3><p>Free · about 55 MB</p></div>
      </div>
      <p class="bb-install-why">It goes on your home screen like any other app. It opens full screen in landscape, and after the first launch it plays with no connection.</p>
      <div class="bb-install-body"></div>
      <button class="bb-install-play">Play in the browser instead</button>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.bb-install-body') as HTMLElement;

  const close = () => {
    offerListeners.delete(render);
    root.classList.remove('open');
    setTimeout(() => root.remove(), 250);
  };
  root.querySelector('.bb-install-x')!.addEventListener('click', close);
  root.querySelector('.bb-install-shade')!.addEventListener('click', close);
  root.querySelector('.bb-install-play')!.addEventListener('click', () => {
    close();
    if (opts.onPlay) opts.onPlay();
    else if (!opts.onGamePage) location.href = '/play/';
  });

  const goToGame = () => { location.href = '/play/?install'; };

  function render() {
    if (inAppBrowser) {
      body.innerHTML = `<ol class="bb-install-steps">
        ${step(1, `This app's built-in browser can't install anything. Tap ${ICON.more} or ${ICON.dots} in its corner.`)}
        ${step(2, `Choose <b>Open in browser</b> (or <b>Open in Safari</b> / <b>Chrome</b>).`)}
        ${step(3, 'Tap <b>Play</b> there again and install.')}
      </ol>`;
      return;
    }
    if (deferred) {
      body.innerHTML = `<button class="bb-install-go">${ICON.add}<span>Install</span></button>`;
      body.querySelector('.bb-install-go')!.addEventListener('click', async () => {
        const ev = deferred;
        if (!ev) return;
        deferred = null;
        await ev.prompt();
        const { outcome } = await ev.userChoice;
        body.innerHTML = outcome === 'accepted'
          ? `<div class="bb-install-done">${ICON.home}<span><b>Installed.</b> Open Bunker Busters from your home screen or app drawer.</span></div>`
          : `<p class="bb-install-note">No problem. You can install it later from the browser menu.</p>`;
      });
      return;
    }
    if (isIOSDevice) {
      if (!opts.onGamePage) {
        // the icon must point at the game, so the steps happen there
        body.innerHTML = `<button class="bb-install-go">${ICON.share}<span>Show me how</span></button><p class="bb-install-note">Opens the game page, then three taps in ${iosSafari ? 'Safari' : 'your browser'}.</p>`;
        body.querySelector('.bb-install-go')!.addEventListener('click', goToGame);
        return;
      }
      body.innerHTML = `<ol class="bb-install-steps">
        ${step(1, `Tap <b>Share</b> ${ICON.share}${iosSafari ? ` in Safari's bar. If you can't see it, tap ${ICON.more} first.` : ' in the address bar.'}`)}
        ${step(2, `Scroll down and tap <b>Add to Home Screen</b> ${ICON.add}`)}
        ${step(3, 'Tap <b>Add</b>, then open Bunker Busters from your home screen.')}
      </ol>`;
      return;
    }
    // Android (or another phone) and no offer yet: the browser menu does the same thing
    if (!opts.onGamePage) {
      body.innerHTML = `<button class="bb-install-go">${ICON.add}<span>Install</span></button><p class="bb-install-note">Opens the game page to install from there.</p>`;
      body.querySelector('.bb-install-go')!.addEventListener('click', goToGame);
      return;
    }
    body.innerHTML = `<ol class="bb-install-steps">
      ${step(1, `Tap ${ICON.dots} at the top right of the browser.`)}
      ${step(2, `Tap <b>Install app</b> or <b>Add to Home screen</b> ${ICON.add}`)}
      ${step(3, 'Open Bunker Busters from your home screen or app drawer.')}
    </ol>`;
  }

  render();
  offerListeners.add(render);
  requestAnimationFrame(() => root.classList.add('open'));
  return close;
}
