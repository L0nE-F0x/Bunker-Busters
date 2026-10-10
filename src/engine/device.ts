// What kind of device is this? Phones and tablets get touch controls, a compact layout, fullscreen
// landscape and lighter rendering defaults. Override with ?touch=1 | ?touch=0.

const q = new URLSearchParams(location.search).get('touch');
const ua = navigator.userAgent;
// iPadOS reports itself as a Mac; touch points give it away
const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Touch-first device: on-screen controls instead of mouse look + keyboard. */
export const isTouch = q === '1' || (q !== '0' && navigator.maxTouchPoints > 0 && (mobileUA || coarse));
/** A phone or tablet (weaker GPU, small screen), as opposed to a touchscreen laptop. */
export const isMobile = q === '1' || (q !== '0' && mobileUA);
/** iPhone Safari has no element fullscreen; there it takes "Add to Home Screen". */
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

/** A WebKit engine (the Linux desktop app's WebKitGTK, Safari), not Chromium wearing its UA. */
export const isWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android|Edg\//.test(ua);

if (isTouch) document.documentElement.classList.add('touch');

/* eslint-disable @typescript-eslint/no-explicit-any */
const doc = document as any;
export const isFullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
/** Running as an installed home-screen app (already fullscreen, nothing to request). */
export const isStandalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as any).standalone === true;
/** The installed app, at launch (no tap yet): landscape if the browser allows it without fullscreen. */
export function lockLandscape() {
  if (!isTouch || !isStandalone()) return;
  Promise.resolve((screen.orientation as any)?.lock?.('landscape')).catch(() => {});
}
export const canFullscreen = () => !!(document.documentElement.requestFullscreen || (document.documentElement as any).webkitRequestFullscreen);

/**
 * Fullscreen + landscape lock. Must run inside a user gesture (a tap); otherwise the browser
 * refuses, which is harmless: the next tap tries again. The installed app asks too: its manifest
 * is `display: standalone` with no orientation (play.webmanifest), because Xiaomi's HyperOS/MIUI
 * install a WebAPK that asks for fullscreen or a fixed orientation and then never launch it.
 * iOS has no element fullscreen; its home-screen app is already chromeless.
 */
export function enterFullscreen() {
  if (!isTouch || isFullscreen()) return;
  const el = document.documentElement as any;
  const req: Promise<void> | undefined = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
  Promise.resolve(req)
    .then(() => (screen.orientation as any)?.lock?.('landscape'))
    .catch(() => {});
}
