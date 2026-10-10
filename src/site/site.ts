import '../fonts';
import './site.css';
import changelog from '../../CHANGELOG.md?raw';
import { initInstall, openInstallSheet, isPhone, isInstalledApp } from '@/ui/install';

const REPO = 'L0nE-F0x/Bunker-Busters';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const dl = (asset: string) => `https://github.com/${REPO}/releases/latest/download/${asset}`;

initInstall();
$('#site-version')!.textContent = `v${__APP_VERSION__}`;
$('#chip-version')!.textContent = `v${__APP_VERSION__} out now`;

// ------------------------------------------------------------------ which device is this?
type OS = 'linux' | 'windows' | 'mac' | 'mobile' | 'other';
function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  // phones first: Android says "Linux", iPhone says "Mac OS X", and neither can run a desktop build
  if (isPhone) return 'mobile';
  const plat = ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
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
  mac: { label: 'Play in your browser', sub: 'Free · no macOS build yet', icon: 'web' },
  mobile: { label: 'Play free', sub: 'Install the app, or play in the browser', icon: 'phone' },
  other: { label: 'Play in your browser', sub: 'Free · desktop builds for Linux & Windows', icon: 'web' },
};
const p = PRIMARY[os];
label.textContent = p.label;
sub.textContent = p.sub;
icon.classList.add(p.icon);
if (!p.asset) primary.href = '/play/';
if (os === 'mobile' || os === 'mac' || os === 'other') {
  // the main button already plays: the second one points at the other platforms
  second.textContent = 'All platforms';
  second.href = '#get';
}
const navCta = $<HTMLAnchorElement>('#nav-cta')!;
if (os === 'mobile') { navCta.textContent = 'Play'; navCta.href = '/play/'; }
$$(`.dl-card[data-os="${os}"]`).forEach((c) => c.classList.add('yours'));

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

// ------------------------------------------------------------------ downloads: what's in the latest release?
const assetButtons = $$<HTMLAnchorElement>('[data-asset]');
const relInfo = $('#release-info')!;
let releaseDate = '';

function setAvailable(available: Set<string> | null) {
  for (const a of assetButtons) {
    const name = a.dataset.asset!;
    const ok = available === null || available.has(name);
    a.href = ok ? dl(name) : '#get';
    a.classList.toggle('disabled', !ok);
    if (!ok) a.title = 'Not in the latest release yet';
  }
  if (p.asset) primary.href = available === null || available.has(p.asset) ? dl(p.asset) : '#get';
}

setAvailable(null);
fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  .then(async (r) => {
    if (r.status === 404) throw new Error('none');
    if (!r.ok) throw new Error('api');
    const rel = (await r.json()) as { tag_name: string; published_at: string; assets: { name: string; size: number }[] };
    setAvailable(new Set(rel.assets.map((a) => a.name)));
    releaseDate = new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    relInfo.innerHTML = `Latest: <b>${rel.tag_name}</b> · released ${releaseDate}`;
    const dateEl = $(`.news-item[data-v="${rel.tag_name}"] .news-date`);
    if (dateEl) dateEl.textContent = releaseDate;
    for (const a of assetButtons) {
      const asset = rel.assets.find((x) => x.name === a.dataset.asset);
      const small = a.querySelector('small');
      if (asset && small) small.textContent += ` · ${(asset.size / 1048576).toFixed(0)} MB`;
    }
  })
  .catch((e: Error) => {
    if (e.message !== 'none') { relInfo.textContent = 'Downloads come from GitHub Releases.'; return; }
    relInfo.textContent = 'The first desktop release is being built. In the meantime, play in your browser.';
    setAvailable(new Set());
    if (p.asset) {
      primary.href = '/play/';
      label.textContent = 'Play in your browser';
      sub.textContent = 'Desktop builds coming soon';
      icon.className = 'os-icon web';
    }
  });

// ------------------------------------------------------------------ what's new, from CHANGELOG.md
{
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  const sections = changelog.split(/^## /m).slice(1).filter((s) => /^v\d/.test(s)).slice(0, 2);
  $('#news-list')!.innerHTML = sections.map((s, i) => {
    const [head, ...lines] = s.split('\n');
    const v = head.trim();
    const items = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
    const shown = i === 0 ? items : items.slice(0, 6);
    const more = items.length - shown.length;
    return `<article class="news-item reveal${i === 0 ? ' latest' : ''}" data-v="${v}">
      <header><b>${v}</b>${i === 0 ? '<span class="news-tag">Latest</span>' : ''}<span class="news-date"></span></header>
      <ul>${shown.map((t) => `<li>${md(t)}</li>`).join('')}</ul>
      ${more > 0 ? `<p class="news-tail">and ${more} more in the release notes</p>` : ''}
    </article>`;
  }).join('');
}

// ------------------------------------------------------------------ hero video
{
  const video = $<HTMLVideoElement>('.hero-video')!;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  // reduced motion or data saver: the poster frame only
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || conn?.saveData) {
    video.removeAttribute('autoplay');
    video.preload = 'none';
    video.pause();
  } else {
    video.addEventListener('playing', () => video.classList.add('live'), { once: true });
    void video.play().catch(() => { /* autoplay refused: the poster stays */ });
    // no decoding off screen
    new IntersectionObserver(([e]) => { if (e.isIntersecting) void video.play().catch(() => {}); else video.pause(); }).observe(video);
  }
}

// ------------------------------------------------------------------ places rail
{
  const rail = $('.rail')!;
  const by = (dir: number) => {
    const card = rail.querySelector<HTMLElement>('.place');
    rail.scrollBy({ left: dir * ((card?.offsetWidth ?? 400) + 20), behavior: 'smooth' });
  };
  $('.rail-prev')!.addEventListener('click', () => by(-1));
  $('.rail-next')!.addEventListener('click', () => by(1));
  const ends = () => {
    $('.rail-prev')!.toggleAttribute('disabled', rail.scrollLeft < 8);
    $('.rail-next')!.toggleAttribute('disabled', rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8);
  };
  rail.addEventListener('scroll', ends, { passive: true });
  ends();
}

// ------------------------------------------------------------------ reveal on scroll, nav background
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
$$('.reveal').forEach((el) => io.observe(el));

const nav = $('.nav')!;
const onScroll = () => nav.classList.toggle('solid', scrollY > 40);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
