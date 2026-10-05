import '../fonts';
import './site.css';

const REPO = 'L0nE-F0x/Bunker-Busters';
document.getElementById('site-version')!.textContent = `v${__APP_VERSION__} early access`;
const dl = (asset: string) => `https://github.com/${REPO}/releases/latest/download/${asset}`;

type OS = 'linux' | 'windows' | 'mac' | 'other';
function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  const plat = ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
  if (plat.includes('win') || ua.includes('windows')) return 'windows';
  if (plat.includes('mac') || ua.includes('mac os')) return 'mac';
  if (plat.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'other';
}

const os = detectOS();
const primary = document.getElementById('dl-primary') as HTMLAnchorElement;
const label = document.getElementById('dl-primary-label')!;
const sub = document.getElementById('dl-primary-sub')!;
const icon = document.getElementById('dl-primary-icon')!;

const PRIMARY: Record<OS, { asset?: string; label: string; sub: string; icon: string }> = {
  linux: { asset: 'BunkerBusters-linux-x86_64.tar.gz', label: 'Download for Linux', sub: 'Omarchy / Arch · AppImage & .deb below', icon: 'linux' },
  windows: { asset: 'BunkerBusters-windows-x64-setup.exe', label: 'Download for Windows', sub: 'Installer · Windows 10 / 11', icon: 'windows' },
  mac: { label: 'Play in your browser', sub: 'No macOS build yet', icon: 'web' },
  other: { label: 'Play in your browser', sub: 'Desktop builds for Linux & Windows', icon: 'web' },
};

const p = PRIMARY[os];
label.textContent = p.label;
sub.textContent = p.sub;
icon.classList.add(p.icon);
if (!p.asset) primary.href = '/play/';
document.querySelectorAll<HTMLElement>(`.dl-card[data-os="${os}"]`).forEach((c) => c.classList.add('yours'));

// Wire download buttons, then ask GitHub what the latest release actually contains.
const assetButtons = [...document.querySelectorAll<HTMLAnchorElement>('[data-asset]')];
const relInfo = document.getElementById('release-info')!;

function setAvailable(available: Set<string> | null) {
  for (const a of assetButtons) {
    const name = a.dataset.asset!;
    const ok = available === null || available.has(name);
    a.href = ok ? dl(name) : '#download';
    a.classList.toggle('disabled', !ok);
    if (!ok) a.title = 'Not in the latest release yet';
  }
  if (p.asset) {
    const ok = available === null || available.has(p.asset);
    primary.href = ok ? dl(p.asset) : '#download';
  }
}

setAvailable(null);
fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  .then(async (r) => {
    if (r.status === 404) throw new Error('none');
    if (!r.ok) throw new Error('api');
    const rel = (await r.json()) as { tag_name: string; published_at: string; assets: { name: string; size: number }[] };
    const names = new Set(rel.assets.map((a) => a.name));
    setAvailable(names);
    const date = new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    relInfo.innerHTML = `Latest: <b>${rel.tag_name}</b> · released ${date}`;
    for (const a of assetButtons) {
      const asset = rel.assets.find((x) => x.name === a.dataset.asset);
      const small = a.querySelector('small');
      if (asset && small) small.textContent += ` · ${(asset.size / 1048576).toFixed(0)} MB`;
    }
    if (p.asset) sub.textContent = `${p.sub} · ${rel.tag_name}`;
  })
  .catch((e: Error) => {
    if (e.message === 'none') {
      relInfo.textContent = 'The first desktop release is being built. In the meantime, play in your browser.';
      setAvailable(new Set());
      if (p.asset) {
        primary.href = '/play/';
        label.textContent = 'Play in your browser';
        sub.textContent = 'Desktop builds coming very soon';
        icon.className = 'os-icon web';
        document.querySelector<HTMLElement>('.play-link')!.style.display = 'none';
      }
    } else {
      relInfo.textContent = 'Downloads come from GitHub Releases.';
    }
  });

// reveal-on-scroll
const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.15 });
document.querySelectorAll('.feature, .garage-inner, .tiers li, .dl-card').forEach((el) => io.observe(el));

// nav background once scrolled
const nav = document.querySelector('.nav')!;
addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 40), { passive: true });
