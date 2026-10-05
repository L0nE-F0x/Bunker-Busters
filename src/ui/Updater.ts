// In-app updates for the desktop build (Tauri). The browser build has no updater: the page itself is
// always the latest. Rust side: src-tauri/src/update.rs.

/* eslint-disable @typescript-eslint/no-explicit-any */
const ipc = (window as any).__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined;

export const isDesktopApp = !!ipc;

export interface UpdateInfo {
  version: string;
  current: string;
  notes?: string | null;
  date?: string | null;
  installer: string; // binary | appimage | deb | nsis …
}

interface Progress { phase: string; downloaded: number; total?: number | null; error?: string | null }

let checked: Promise<UpdateInfo | null> | null = null;

/** One network check per session; failures (offline, rate-limited) just mean "no update". */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!ipc) return Promise.resolve(null);
  checked ??= ipc.invoke('update_check').catch((e) => {
    console.warn('[update] check failed:', e);
    checked = null; // allow a retry next time the title screen opens
    return null;
  });
  return checked;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Notes are a short markdown list from CHANGELOG.md: keep bullets and bold, drop the rest. */
function notesHtml(md: string) {
  const items = md.split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).slice(0, 5);
  const fmt = (l: string) => esc(l.replace(/^[-*] /, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return items.length ? `<ul>${items.map((l) => `<li>${fmt(l)}</li>`).join('')}</ul>` : '';
}

/** Shows an "update available" card inside `host` (the title screen) if there's a newer release. */
export async function mountUpdateNotice(host: HTMLElement, onClick: () => void) {
  const info = await checkForUpdate();
  if (!info || !host.isConnected) return;
  const card = document.createElement('div');
  card.className = 'update-card interactive';
  const pw = info.installer === 'deb' ? '<div class="u-hint">You\'ll be asked for your password to install the package.</div>'
    : info.installer === 'nsis' ? '<div class="u-hint">The installer will run, then the game reopens.</div>' : '';
  card.innerHTML = `
    <div class="u-tag">UPDATE AVAILABLE</div>
    <div class="u-ver">v${esc(info.version)} <span>· you have v${esc(info.current)}</span></div>
    ${info.notes ? notesHtml(info.notes) : ''}
    ${pw}
    <div class="u-bar"><i></i></div>
    <div class="u-status"></div>
    <div class="u-actions"><button class="btn primary u-go">Update &amp; restart</button><button class="btn u-later">Later</button></div>`;
  host.appendChild(card);
  const status = card.querySelector('.u-status') as HTMLElement;
  const bar = card.querySelector('.u-bar') as HTMLElement;
  const fill = bar.querySelector('i') as HTMLElement;
  const go = card.querySelector('.u-go') as HTMLButtonElement;
  const later = card.querySelector('.u-later') as HTMLButtonElement;
  later.onclick = () => { onClick(); card.remove(); };
  go.onclick = async () => {
    onClick();
    go.disabled = later.disabled = true;
    bar.style.display = 'block';
    status.textContent = 'Downloading…';
    const poll = setInterval(async () => {
      const p: Progress = await ipc!.invoke('update_progress');
      if (p.total) fill.style.width = `${Math.min(100, (p.downloaded / p.total) * 100).toFixed(1)}%`;
      const mb = (n: number) => (n / 1048576).toFixed(1);
      if (p.phase === 'downloading') status.textContent = `Downloading… ${mb(p.downloaded)}${p.total ? ` / ${mb(p.total)}` : ''} MB`;
      else if (p.phase === 'installing') status.textContent = 'Verifying signature and installing…';
      else if (p.phase === 'restarting') status.textContent = 'Done. Restarting…';
    }, 150);
    try {
      await ipc!.invoke('update_install');
      fill.style.width = '100%';
      status.textContent = 'Done. Restarting…';
    } catch (e) {
      status.innerHTML = `Update failed: ${esc(String(e))}<br>You can download it from <b>bunker-busters.netlify.app</b>.`;
      card.classList.add('failed');
      go.disabled = later.disabled = false;
      go.textContent = 'Try again';
    } finally {
      clearInterval(poll);
    }
  };
}
