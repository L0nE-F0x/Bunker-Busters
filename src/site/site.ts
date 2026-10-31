import '../fonts';
import './site.css';
import changelog from '../../CHANGELOG.md?raw';
import { initInstall, openInstallSheet, isPhone, isInstalledApp } from '@/ui/install';
import { revealOnScroll, solidNav } from './site-common';

const REPO = 'L0nE-F0x/Bunker-Busters';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const dl = (asset: string) => `https://github.com/${REPO}/releases/latest/download/${asset}`;

// first, so nothing below can leave the page's sections invisible (index.html's failsafe waits for this)
revealOnScroll();
solidNav();

initInstall();
$('#site-version')!.textContent = `v${__APP_VERSION__}`;
$('#chip-version')!.textContent = `v${__APP_VERSION__} out now`;

// the search engines' description of the game (index.html) gets the version that's live
{
  const ld = $('script[type="application/ld+json"]');
  try {
    const data = JSON.parse(ld!.textContent!) as { '@graph': Record<string, unknown>[] };
    const game = data['@graph'].find((n) => n['@type'] === 'VideoGame');
    if (game) { game.softwareVersion = __APP_VERSION__; ld!.textContent = JSON.stringify(data); }
  } catch { /* leave it as written */ }
}

// ------------------------------------------------------------------ which device is this?
type OS = 'linux' | 'windows' | 'mac' | 'mobile' | 'other';
function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  // phones first: Android says "Linux", iPhone says "Mac OS X", and neither can run a desktop build
  if (isPhone) return 'mobile';
  const plat = ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
  // a Chromebook says "X11" too, but plays in the browser
  if (plat.includes('chrome os') || ua.includes('cros')) return 'other';
  if (plat.includes('win') || ua.includes('windows')) return 'windows';
  if (plat.includes('mac') || ua.includes('mac os')) return 'mac';
  if (plat.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'other';
}
const os = detectOS();
document.documentElement.classList.add(`os-${os}`);

const primary = $<HTMLAnchorElement>('#dl-primary')!;
const label = $('#dl-primary-label')!;
const sub = $('#dl-primary-sub')!;
const icon = $('#dl-primary-icon')!;
const second = $<HTMLAnchorElement>('#cta-second')!;

const PRIMARY: Record<OS, { asset?: string; label: string; sub: string; icon: string }> = {
  linux: { asset: 'BunkerBusters-linux-x86_64.tar.gz', label: 'Download for Linux', sub: 'Free · Omarchy / Arch, AppImage, .deb', icon: 'linux' },
  windows: { asset: 'BunkerBusters-windows-x64-setup.exe', label: 'Download for Windows', sub: 'Free · Windows 10 / 11', icon: 'windows' },
  // no macOS build: a Mac plays in the browser, which needs nothing installed
  mac: { label: 'Play in your browser', sub: 'Free · no Mac download needed', icon: 'web' },
  mobile: { label: 'Play free', sub: 'Install the app, or play in the browser', icon: 'phone' },
  other: { label: 'Play in your browser', sub: 'Free · desktop builds for Linux & Windows', icon: 'web' },
};
const p = PRIMARY[os];
label.textContent = p.label;
sub.textContent = p.sub;
icon.className = `os-icon ${p.icon}`;
if (!p.asset) primary.href = '/play/';
if (os === 'mobile' || os === 'mac' || os === 'other') {
  // the main button already plays: the second one points at the other platforms
  second.textContent = 'All platforms';
  second.href = '#get';
}
const navCta = $<HTMLAnchorElement>('#nav-cta')!;
if (os === 'mobile') { navCta.textContent = 'Play'; navCta.href = '/play/'; }
// the visitor's own card goes first; Macs, phones and anything else get the browser one
const card = os === 'linux' || os === 'windows' ? os : 'browser';
$$(`.dl-card[data-os="${card}"]`).forEach((c) => c.classList.add('yours'));

// ------------------------------------------------------------------ phones: offer the app first
// Every link to the game opens the install sheet; "Play in the browser instead" goes on to /play/.
const offerApp = isPhone && !isInstalledApp();
if (offerApp) {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a[href="/play/"], .install-open, #install-btn');
    if (!a) return;
    e.preventDefault();
    openInstallSheet({ onGamePage: false });
  });
} else {
  // desktop: the phone buttons become directions
  $$('#install-btn, .install-open').forEach((b) => b.remove());
  $('#install-note')?.classList.add('show');
}

// ------------------------------------------------------------------ what's new, from CHANGELOG.md
{
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  // (only released versions: a section for the next release waits for the version bump)
  const ver = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const released = (v: string) => { const a = ver(v), b = ver(__APP_VERSION__); for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0); return true; };
  const sections = changelog.split(/^## /m).slice(1).filter((s) => /^v\d/.test(s) && released(s.split('\n')[0].trim())).slice(0, 2);
  const list = $('#news-list')!;
  list.innerHTML = sections.map((s, i) => {
    const [head, ...lines] = s.split('\n');
    const v = head.trim();
    const items = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
    const shown = i === 0 ? items : items.slice(0, 6);
    const more = items.length - shown.length;
    return `<article class="news-item reveal${i === 0 ? ' latest' : ''}" data-v="${esc(v)}">
      <header><b>${esc(v)}</b>${i === 0 ? '<span class="news-tag">Latest</span>' : ''}<span class="news-date"></span></header>
      <ul>${shown.map((t) => `<li>${md(t)}</li>`).join('')}</ul>
      ${more > 0 ? `<p class="news-tail">and ${more} more in the release notes</p>` : ''}
    </article>`;
  }).join('');
  revealOnScroll(list);
}

// ------------------------------------------------------------------ downloads: what's in the latest release?
// The buttons' hrefs in index.html already point at releases/latest/download/<fixed name>, so they work
// when GitHub's API is down, rate-limited (60 calls an hour per address) or blocked. The API only adds
// the version, the date and the sizes, and greys out a file the latest release doesn't have.
interface Release { tag_name: string; published_at: string; assets: { name: string; size: number }[] }
const assetButtons = $$<HTMLAnchorElement>('[data-asset]');
const relInfo = $('#release-info')!;

function setAvailable(available: Set<string> | null) {
  for (const a of assetButtons) {
    const name = a.dataset.asset!;
    const ok = available === null || available.has(name);
    a.href = ok ? dl(name) : '#get';
    a.classList.toggle('disabled', !ok);
    if (ok) a.removeAttribute('aria-disabled'); else a.setAttribute('aria-disabled', 'true');
    if (!ok) a.title = 'Not in the latest release yet';
  }
  if (p.asset) primary.href = available === null || available.has(p.asset) ? dl(p.asset) : '#get';
}

function showRelease(rel: Release) {
  setAvailable(new Set(rel.assets.map((a) => a.name)));
  const date = new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  relInfo.innerHTML = `Latest: <b>${rel.tag_name.replace(/[^\w.-]/g, '')}</b> · released ${date}`;
  const dateEl = $(`.news-item[data-v="${CSS.escape(rel.tag_name)}"] .news-date`);
  if (dateEl) dateEl.textContent = date;
  for (const a of assetButtons) {
    const asset = rel.assets.find((x) => x.name === a.dataset.asset);
    const small = a.querySelector('small');
    if (asset && small) small.textContent += ` · ${(asset.size / 1048576).toFixed(0)} MB`;
  }
}

setAvailable(null);
{
  // one call an hour per visitor at most
  const KEY = 'bb.site.release';
  let cached: { at: number; rel: Release } | null = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* storage off */ }
  if (cached && Date.now() - cached.at < 3600e3 && cached.rel?.assets) showRelease(cached.rel);
  else {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const rel = (await r.json()) as Release;
        if (!rel?.tag_name || !Array.isArray(rel.assets)) throw new Error('shape');
        showRelease(rel);
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rel: { tag_name: rel.tag_name, published_at: rel.published_at, assets: rel.assets.map(({ name, size }) => ({ name, size })) } })); } catch { /* storage off */ }
      })
      .catch(() => { /* the links in the page still work; the line under the heading says where they go */ });
  }
}

// ------------------------------------------------------------------ hero video
{
  const video = $<HTMLVideoElement>('.hero-video')!;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  // reduced motion or data saver: the poster frame only. Otherwise the loop starts once the page has
  // loaded, so its 2 MB never queue in front of the page itself.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !conn?.saveData) {
    let onScreen = true;
    const start = () => {
      video.preload = 'auto';
      video.addEventListener('playing', () => video.classList.add('live'), { once: true });
      if (onScreen) void video.play().catch(() => { /* autoplay refused (iOS Low Power Mode…): the poster stays */ });
    };
    // no decoding off screen
    new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (video.preload !== 'auto') return;
      if (onScreen) void video.play().catch(() => {}); else video.pause();
    }).observe(video);
    if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
  }
}

// ------------------------------------------------------------------ places rail
{
  const rail = $('.rail')!;
  const by = (dir: number) => {
    const place = rail.querySelector<HTMLElement>('.place');
    rail.scrollBy({ left: dir * ((place?.offsetWidth ?? 400) + 20), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  $('.rail-prev')!.addEventListener('click', () => by(-1));
  $('.rail-next')!.addEventListener('click', () => by(1));
  const ends = () => {
    $('.rail-prev')!.toggleAttribute('disabled', rail.scrollLeft < 8);
    $('.rail-next')!.toggleAttribute('disabled', rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8);
  };
  rail.addEventListener('scroll', ends, { passive: true });
  addEventListener('resize', ends, { passive: true });
  ends();
}
