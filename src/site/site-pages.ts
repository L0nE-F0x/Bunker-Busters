// The site's text pages: the press kit (press/index.html) and the privacy page (privacy/index.html).
// The owner's settings (developer, press email, trailer) live in .env.
import '../fonts';
import './site.css';
import './site-pages.css';
import { solidNav } from './site-common';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

solidNav();
for (const el of document.querySelectorAll<HTMLElement>('[data-version]')) el.textContent = `v${__APP_VERSION__}`;

// ------------------------------------------------------------------ press email, once the owner sets one
{
  const email = String(import.meta.env.VITE_PRESS_EMAIL ?? '').trim();
  const line = $('#press-email');
  if (line && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) {
    const a = line.querySelector('a')!;
    a.href = `mailto:${email}`;
    a.textContent = email;
    line.hidden = false;
  }
}

// ------------------------------------------------------------------ the trailer, once the owner sets one
// A still with a play button: nothing loads from YouTube until someone presses it.
function youtubeId(link: string) {
  const s = link.trim();
  let id = '';
  if (/^[\w-]{11}$/.test(s)) id = s;
  else {
    try {
      const u = new URL(s);
      if (u.hostname.endsWith('youtu.be')) id = u.pathname.slice(1, 12);
      else id = u.searchParams.get('v') ?? /\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? '';
    } catch { /* not a link */ }
  }
  return /^[\w-]{11}$/.test(id) ? id : '';
}
{
  const id = youtubeId(String(import.meta.env.VITE_TRAILER_YOUTUBE ?? ''));
  const slot = $('#trailer');
  if (slot && id) {
    slot.hidden = false;
    const watch = $<HTMLAnchorElement>('#trailer-link');
    if (watch) { watch.href = `https://www.youtube.com/watch?v=${id}`; watch.hidden = false; }
    const play = slot.querySelector<HTMLButtonElement>('.trailer-play')!;
    play.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = 'Bunker Busters trailer';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      play.replaceWith(f);
    }, { once: true });
  }
}

// ------------------------------------------------------------------ copy buttons (press kit descriptions)
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  b.hidden = false;
  b.addEventListener('click', async () => {
    const text = document.getElementById(b.dataset.copy!)?.innerText.trim() ?? '';
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* no clipboard access: select it instead */ }
    if (!ok) {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById(b.dataset.copy!)!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    }
    b.textContent = ok ? 'Copied' : 'Selected';
    setTimeout(() => { b.textContent = 'Copy text'; }, 2000);
  });
}
