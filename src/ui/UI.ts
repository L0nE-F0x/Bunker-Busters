import './styles.css';
import { ICONS, EYE_ICON } from './icons';
import { ITEMS, HOTBAR_ITEMS } from '@/content/items';
import { SKILLS, SKILL_ORDER, focusesFor } from '@/content/skills';
import { ARCHETYPES } from '@/content/archetypes';
import { journalEntries } from '@/content/story';
import { MAX_HEALTH } from '@/content/progression';
import type { GameState, Settings } from '@/game/State';
import type { AudioEngine } from '@/engine/audio';
import type { LockResult, TalkChoiceView, UIBridge } from '@/game/context';
import { LockpickGame } from './Lockpick';
import { CircuitGame, KeypadGame } from './Circuit';
import { Minimap, MapData, drawWorldMap, type MapMarker } from './Minimap';
import { mountUpdateNotice } from './Updater';
import { isTouch, isIOS, isStandalone, canFullscreen, isFullscreen, enterFullscreen } from '@/engine/device';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

export interface HudFrame {
  objective: string;
  detection: number; // 0..1
  droneState: string;
  canSee: boolean;
  crouch: boolean;
  sprint: boolean;
  prompt: { key: string; label: string; na?: string }[];
  hour: number;
  heading: number;
  playerYaw: number;
  px: number;
  pz: number;
  markers: MapMarker[];
  hunger: number;
  thirst: number;
}

/** DOM overlay. Owns HUD widgets, menus, modal panels and minigames. */
export class UI implements UIBridge {
  root: HTMLElement;
  hud!: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private state: GameState | null = null;
  map: MapData | null = null;
  private minimap: Minimap | null = null;
  modalOpen = false;
  minigameOpen = false;
  private subtitleTimer = 0;
  private lastClock = '';
  private lastNeed = '';
  private detCache: { show: boolean | null; color: string; width: string; text: string } = { show: null, color: '', width: '', text: '' };
  private minimapT = 0;
  private lastObjective = '';
  private loadingEl: HTMLElement;

  constructor(private audio: AudioEngine) {
    this.root = document.getElementById('ui')!;
    this.loadingEl = h('div', '', `
      <div class="logo-sm">BUNKER BUSTERS</div>
      <div class="bar"><i></i></div>
      <div class="msg">BOOTING</div>
      <div class="tip">Tip: crouch to step over tripwires. SeedBot's battery is at 12% — it naps more than you'd think.</div>`);
    this.loadingEl.id = 'loading';
    document.body.appendChild(this.loadingEl);
    const fader = h('div', '', '<div class="msg"></div>');
    fader.id = 'fader';
    document.body.appendChild(fader);
  }

  // ------------------------------------------------------------------ loading
  progress(p: number, msg: string) {
    (this.loadingEl.querySelector('.bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    this.loadingEl.querySelector('.msg')!.textContent = msg.toUpperCase();
  }
  hideLoading() {
    this.loadingEl.style.opacity = '0';
    setTimeout(() => this.loadingEl.remove(), 1300);
  }

  fade(on: boolean, msg = '') {
    const f = document.getElementById('fader')!;
    f.querySelector('.msg')!.textContent = msg;
    f.style.opacity = on ? '1' : '0';
  }

  // ------------------------------------------------------------------ title
  showTitle(opts: { canContinue: boolean; backend: string; onContinue: () => void; onNew: () => void; onSettings: () => void }) {
    const el = h('div', '', `
      <div class="logo">
        <span class="l1">BUNKER</span><span class="l2">BUSTERS</span>
        <div class="glitch"><span>BUNKER\n   BUSTERS</span></div>
      </div>
      <div class="tagline">They locked the future. <b>The camps are still thirsty.</b></div>
      <div class="menu interactive"></div>
      ${isTouch && isIOS && !isStandalone() ? '<div class="ios-tip">For full screen: tap <b>Share</b> → <b>Add to Home Screen</b>, then play from the icon.</div>' : ''}
      <div class="title-foot"><span>v${__APP_VERSION__} · DAY 1,284 · ${opts.backend.toUpperCase()}</span><span class="press">STAY OUTSIDE</span></div>`);
    el.id = 'title';
    const menu = el.querySelector('.menu')!;
    const add = (label: string, fn: () => void, primary = false, disabled = false) => {
      const b = h('button', `btn${primary ? ' primary' : ''}`, label) as HTMLButtonElement;
      b.disabled = disabled;
      b.onmouseenter = () => this.audio.play('uiHover');
      b.onclick = () => { this.audio.start(); this.audio.play('uiConfirm'); fn(); };
      menu.appendChild(b);
    };
    if (opts.canContinue) add('Continue', () => { el.remove(); opts.onContinue(); }, true);
    add('New Game', () => { el.remove(); opts.onNew(); }, !opts.canContinue);
    add('Settings', opts.onSettings);
    add('Controls', () => this.showControls());
    this.root.appendChild(el);
    void mountUpdateNotice(el, () => { this.audio.start(); this.audio.play('uiConfirm'); });
    // first interaction starts audio
    const kick = () => { this.audio.start(); window.removeEventListener('pointerdown', kick); };
    window.addEventListener('pointerdown', kick);
  }

  showControls() {
    const ov = h('div', 'overlay');
    if (isTouch) {
      ov.innerHTML = `
      <div class="panel pause interactive">
        <div class="scan"></div>
        <h3>CONTROLS</h3>
        <div class="controls">
          <span><b>Left thumb</b></span><span>Drag anywhere on the left to walk. Push past the ring to sprint.</span>
          <span><b>Right thumb</b></span><span>Drag anywhere on the right to look around</span>
          <span><b>Hand</b></span><span>Use what you're looking at (or tap the prompt). ALT is the other action</span>
          <span><b>Arrows</b></span><span>Jump · crouch (toggle: quiet, steps over tripwires)</span>
          <span><b>Torch</b></span><span>Flashlight (SeedBot spots you more easily)</span>
          <span><b>Hotbar</b></span><span>EMP, ration, water, medkit</span>
          <span><b>Top right</b></span><span>Pause · kit, skills & journal · map & intel</span>
          <span><b>Lockpicking</b></span><span>Press and hold on a pin to lift it, let go to set it</span>
        </div>
        <button class="btn">Back</button>
      </div>`;
      ov.querySelector('button')!.onclick = () => ov.remove();
      this.root.appendChild(ov);
      return;
    }
    ov.innerHTML = `
      <div class="panel pause interactive">
        <div class="scan"></div>
        <h3>CONTROLS</h3>
        <div class="controls">
          <span><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></span><span>Move</span>
          <span><span class="kbd">Mouse</span></span><span>Look</span>
          <span><span class="kbd">Shift</span></span><span>Sprint (noisy)</span>
          <span><span class="kbd">C</span> / <span class="kbd">Ctrl</span></span><span>Crouch (quiet, steps over tripwires)</span>
          <span><span class="kbd">Space</span></span><span>Jump</span>
          <span><span class="kbd">E</span> / <span class="kbd">F</span></span><span>Interact · alternate action</span>
          <span><span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span><span class="kbd">4</span></span><span>EMP · ration · water · medkit</span>
          <span><span class="kbd">F</span></span><span>The other way in: a charge, a keypad, the wire</span>
          <span><span class="kbd">L</span></span><span>Flashlight (SeedBot spots you more easily)</span>
          <span><span class="kbd">Tab</span> / <span class="kbd">I</span></span><span>Kit & skills</span>
          <span><span class="kbd">J</span></span><span>Journal — why you're out here</span>
          <span><span class="kbd">M</span></span><span>Map & intel</span>
          <span><span class="kbd">Esc</span></span><span>Pause</span>
        </div>
        <button class="btn">Back</button>
      </div>`;
    ov.querySelector('button')!.onclick = () => ov.remove();
    this.root.appendChild(ov);
  }

  // ------------------------------------------------------------------ char select
  showCharSelect(onPick: (id: string) => void, onPreview: (id: string) => void, onBack: () => void) {
    const el = h('div', '');
    el.id = 'charselect';
    let sel = ARCHETYPES[0].id;
    el.innerHTML = `
      <div class="side interactive">
        <div class="label">THE COMPACT HAS ONE RADIO</div>
        <h2>WHO GETS IT?</h2>
        <div class="cards"></div>
        <div class="panel detail"><div class="scan"></div></div>
        <div style="display:flex;gap:10px;margin-top:auto">
          <button class="btn back">Back</button>
          <button class="btn primary go" style="flex:1">Enter the wasteland</button>
        </div>
      </div>`;
    const cards = el.querySelector('.cards')!;
    const detail = el.querySelector('.detail')!;
    const render = () => {
      const a = ARCHETYPES.find((x) => x.id === sel)!;
      el.style.setProperty('--accent', a.accent);
      cards.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === sel));
      const bar = (label: string, v: number, max: number, txt: string) =>
        `<div class="stat"><span>${label}</span><span class="track"><i style="width:${(v / max) * 100}%"></i></span><b>${txt}</b></div>`;
      const quiet = a.stats.stealth < 0.85 ? 'QUIET' : a.stats.stealth > 1.05 ? 'LOUD' : 'EVEN';
      const trained = SKILL_ORDER.filter((id) => (a.skills[id] ?? 0) > 0);
      detail.innerHTML = `<div class="scan"></div>
        <p>${a.description}</p>
        <p class="motive">${a.motive}</p>
        ${trained.map((id) => bar(SKILLS[id].name, a.skills[id] ?? 0, 5, String(a.skills[id] ?? 0))).join('')}
        ${bar('Noticeable', a.stats.stealth, 1.4, quiet)}
        ${bar('Toughness', a.stats.toughness, 1.4, a.stats.toughness > 1.15 ? 'HI' : a.stats.toughness < 0.95 ? 'LOW' : 'MID')}
        <div class="sig"><strong>${a.role} · ${a.signature.name}</strong>${a.signature.description}</div>
        <div class="sig" style="border-color:var(--ink-faint)"><strong style="color:var(--ink-dim)">Pockets · 1 skill point unspent</strong>${a.startingItems.map((s) => `${s.qty}× ${ITEMS[s.id]?.name ?? s.id}`).join(' · ')}</div>`;
      onPreview(sel);
    };
    for (const a of ARCHETYPES) {
      const c = h('div', 'card', `<div class="name">${a.name}</div><div class="tag">${a.tagline}</div>`);
      c.dataset.id = a.id;
      c.style.setProperty('--accent', a.accent);
      c.onmouseenter = () => this.audio.play('uiHover');
      c.onclick = () => { sel = a.id; this.audio.play('ui'); render(); };
      cards.appendChild(c);
    }
    (el.querySelector('.go') as HTMLButtonElement).onclick = () => { this.audio.play('uiConfirm'); el.remove(); onPick(sel); };
    (el.querySelector('.back') as HTMLButtonElement).onclick = () => { el.remove(); onBack(); };
    this.root.appendChild(el);
    render();
  }

  // ------------------------------------------------------------------ HUD
  mountHUD(state: GameState, map: MapData) {
    this.state = state;
    this.map = map;
    this.minimap = new Minimap(map);
    this.detCache = { show: null, color: '', width: '', text: '' };
    this.hud?.remove();
    const hud = (this.hud = h('div', ''));
    hud.id = 'hud';
    hud.innerHTML = `
      <div class="objective"><div class="label">Objective</div><div class="text"></div></div>
      <div class="toasts"></div>
      <div class="minimap"><div class="ring"></div></div>
      <div class="clock"></div>
      <div class="detect" style="opacity:0">${EYE_ICON}<div class="m"><i></i></div><div class="t"></div></div>
      <div class="crosshair"></div>
      <div class="subtitle" style="opacity:0"><span class="who"></span><span class="line"></span></div>
      <div class="prompt"></div>
      <div class="hotbar"></div>
      <div class="vitals">
        <div class="row"><div class="lvl">1</div><div class="bars"><div class="hp"></div><div class="xpbar"><i></i></div></div></div>
        <div class="needs"><div class="nrow hunger"><span>FOOD</span><div class="track"><i></i></div></div><div class="nrow thirst"><span>WATER</span><div class="track"><i></i></div></div></div>
        <div class="meta"><span class="arch"></span><span class="xptext"></span></div>
        <div class="spwrap"></div>
      </div>
      <div class="stance"><span class="pill crouch">Crouch</span><span class="pill sprint">Sprint</span></div>`;
    for (const k of ['objective', 'toasts', 'minimap', 'clock', 'detect', 'subtitle', 'prompt', 'hotbar', 'vitals', 'stance']) {
      this.els[k] = hud.querySelector(`.${k}`)!;
    }
    this.els.minimap.prepend(this.minimap.canvas);
    const hp = hud.querySelector('.hp')!;
    for (let i = 0; i < 20; i++) hp.appendChild(h('i'));
    this.root.appendChild(hud);

    state.events.on('toast', ({ text, kind }) => this.toast(text, kind));
    state.events.on('xp', ({ amount, reason }) => { this.toast(`+${amount} XP · ${reason}`, 'xp'); this.refreshVitals(); });
    state.events.on('levelup', ({ level }) => this.levelUp(level));
    state.events.on('health', () => this.refreshVitals());
    state.events.on('item', ({ id, qty }) => { this.toast(`+${qty} ${ITEMS[id]?.name ?? id}`, 'good'); this.audio.play('pickup'); });
    state.events.on('inventoryChanged', () => this.refreshHotbar());
    this.refreshVitals();
    this.refreshHotbar();
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'xp' = 'info') {
    const t = h('div', `toast ${kind}`, text);
    this.els.toasts?.appendChild(t);
    setTimeout(() => t.remove(), 4800);
    while ((this.els.toasts?.children.length ?? 0) > 6) this.els.toasts.firstChild?.remove();
  }

  refreshVitals() {
    if (!this.state || !this.hud) return;
    const d = this.state.data;
    const hpEls = this.hud.querySelectorAll('.hp i');
    const on = Math.ceil((d.health / MAX_HEALTH) * hpEls.length);
    const cls = d.health > 60 ? 'full' : d.health > 30 ? 'mid' : '';
    hpEls.forEach((e, i) => (e.className = i < on ? `on ${cls}` : ''));
    this.hud.querySelector('.lvl')!.textContent = String(d.level);
    (this.hud.querySelector('.xpbar i') as HTMLElement).style.width = `${(d.xp / this.state.xpToNext) * 100}%`;
    this.hud.querySelector('.arch')!.textContent = this.state.archetype.role.toUpperCase();
    this.hud.querySelector('.xptext')!.innerHTML = `<b>${d.xp}</b> / ${this.state.xpToNext} XP`;
    this.hud.querySelector('.spwrap')!.innerHTML = d.skillPoints > 0 ? `<span class="sp-badge">${d.skillPoints} SKILL POINT${d.skillPoints > 1 ? 'S' : ''} · ${isTouch ? 'KIT' : 'TAB'}</span>` : '';
  }

  refreshHotbar() {
    if (!this.state) return;
    this.els.hotbar.innerHTML = HOTBAR_ITEMS.map((id, i) => {
      const q = this.state!.count(id);
      return `<div class="slot ${q ? '' : 'empty'}" data-key="Digit${i + 1}"><span class="k">${i + 1}</span>${ICONS[ITEMS[id].icon]}<span class="q">${q}</span></div>`;
    }).join('');
  }

  levelUp(level: number) {
    this.audio.play('levelUp');
    const el = h('div', 'levelup', `<div class="ring">${level}</div><div class="t">LEVEL UP</div><div class="s">+1 skill point — ${isTouch ? 'open your kit' : 'press <span class="kbd">Tab</span>'} to spend</div>`);
    this.hud.appendChild(el);
    setTimeout(() => el.remove(), 4300);
    this.refreshVitals();
  }

  private bannerQueue: [string, string, 'good' | 'bad' | 'info'][] = [];
  private bannerBusy = false;

  /** Big centred banner. Queued so simultaneous events never overlap. */
  banner(title: string, sub: string, kind: 'good' | 'bad' | 'info' = 'good') {
    this.bannerQueue.push([title, sub, kind]);
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner() {
    const next = this.bannerQueue.shift();
    if (!next) { this.bannerBusy = false; return; }
    this.bannerBusy = true;
    const [title, sub, kind] = next;
    const el = h('div', `banner ${kind}`, `<div class="big">${title}</div><div class="rule"></div><div class="sub">${sub}</div>`);
    (this.hud ?? this.root).appendChild(el);
    setTimeout(() => { el.remove(); this.nextBanner(); }, 5100);
  }

  subtitle(speaker: string, text: string) {
    const el = this.els.subtitle;
    if (!el) return;
    const who = el.querySelector('.who')!;
    who.textContent = speaker;
    who.classList.toggle('bot', speaker === 'SeedBot');
    el.querySelector('.line')!.textContent = `“${text}”`;
    el.style.opacity = '1';
    this.subtitleTimer = 3 + text.length * 0.05;
  }

  updateHUD(dt: number, f: HudFrame) {
    if (!this.hud || !this.state) return;
    if (f.objective !== this.lastObjective) {
      this.lastObjective = f.objective;
      this.els.objective.querySelector('.text')!.textContent = f.objective;
      this.els.objective.classList.remove('flash');
      void this.els.objective.offsetWidth;
      this.els.objective.classList.add('flash');
    }
    // detection (only touch the DOM when something visible changed: every write costs a style pass
    // and a recomposite of the overlay, which is what hurts in WebKitGTK)
    const det = this.els.detect;
    const show = f.detection > 0.02 || f.droneState === 'alert';
    const dc = this.detCache;
    if (show !== dc.show) { dc.show = show; det.style.opacity = show ? '1' : '0'; }
    if (show) {
      const col = f.droneState === 'alert' ? '#ff3b3b' : f.detection > 0.3 ? '#ffb347' : '#f3e9d8';
      if (col !== dc.color) { dc.color = col; det.style.color = col; }
      const w = `${Math.round(f.detection * 400) / 4}%`; // quarter-percent steps: sub-pixel on any meter
      if (w !== dc.width) { dc.width = w; (det.querySelector('.m i') as HTMLElement).style.width = w; }
      const text = f.droneState === 'alert' ? 'DETECTED' : f.canSee ? 'BEING WATCHED' : f.droneState === 'search' ? 'SEARCHING' : 'SUSPICIOUS';
      if (text !== dc.text) { dc.text = text; det.querySelector('.t')!.textContent = text; }
    }
    // prompts
    const pr = this.els.prompt;
    // on touch the prompts are buttons themselves (data-key → TouchControls)
    const html = f.prompt.map((p) => isTouch
      ? `<div class="p ${p.na ? 'na' : ''}" data-key="Key${p.key}"><span class="kbd">${p.key === 'E' ? 'USE' : 'ALT'}</span>${p.label}${p.na ? `<small>${p.na}</small>` : ''}</div>`
      : `<div class="p ${p.na ? 'na' : ''}"><span class="kbd">${p.key}</span>${p.label}${p.na ? `<small>${p.na}</small>` : ''}</div>`).join('');
    if (pr.dataset.html !== html) { pr.innerHTML = html; pr.dataset.html = html; }
    // stance
    this.els.stance.querySelector('.crouch')!.classList.toggle('on', f.crouch);
    this.els.stance.querySelector('.sprint')!.classList.toggle('on', f.sprint);
    // clock
    const hh = Math.floor(f.hour), mm = Math.floor((f.hour - hh) * 60);
    const phase = f.hour < 5 || f.hour > 20.5 ? 'NIGHT' : f.hour < 7.5 ? 'DAWN' : f.hour < 16.5 ? 'DAY' : f.hour < 19 ? 'GOLDEN HOUR' : 'DUSK';
    const clock = `<b>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</b> · ${phase}`;
    if (clock !== this.lastClock) { this.lastClock = clock; this.els.clock.innerHTML = clock; }
    const hk = `${Math.round(f.hunger)}|${Math.round(f.thirst)}`;
    if (hk !== this.lastNeed) {
      this.lastNeed = hk;
      const paint = (sel: string, v: number) => {
        const row = this.hud.querySelector(sel) as HTMLElement | null;
        if (!row) return;
        (row.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, v))}%`;
        row.classList.toggle('low', v < 30);
      };
      paint('.needs .hunger', f.hunger);
      paint('.needs .thirst', f.thirst);
    }
    // minimap + compass
    // ~20 Hz is plenty for the minimap, and every canvas update forces the overlay to recomposite
    this.minimapT -= dt;
    if (this.minimapT <= 0) { this.minimapT = 0.05; this.minimap?.draw(f.px, f.pz, f.heading, f.playerYaw, f.markers); }
    // subtitle fade
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.els.subtitle.style.opacity = '0';
    }
  }

  setHudVisible(v: boolean) {
    this.hud?.classList.toggle('dim', !v);
  }

  // ------------------------------------------------------------------ modals
  private openModal(build: (close: () => void) => HTMLElement, onClose?: () => void) {
    this.modalOpen = true;
    const ov = h('div', 'overlay');
    const close = () => {
      ov.remove();
      this.modalOpen = false;
      window.removeEventListener('keydown', keyClose, true);
      onClose?.();
    };
    const keyClose = (e: KeyboardEvent) => {
      if (['Escape', 'Tab', 'KeyI', 'KeyJ', 'KeyM'].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    setTimeout(() => window.addEventListener('keydown', keyClose, true), 50);
    const panel = build(close);
    const header = panel.querySelector('header');
    if (header) {
      const x = h('button', 'btn close-x', '✕');
      x.setAttribute('aria-label', 'Close');
      x.onclick = () => { this.audio.play('ui'); close(); };
      header.appendChild(x);
    }
    ov.appendChild(panel);
    this.root.appendChild(ov);
    return close;
  }

  openInventory(onUse: (id: string) => void, onClose: () => void, initial: 'kit' | 'journal' = 'kit') {
    const s = this.state!;
    this.audio.play('ui');
    this.openModal((close) => {
      const m = h('div', 'panel modal interactive');
      let tab: 'kit' | 'journal' = initial;
      let selected: string | null = s.data.inventory[0]?.id ?? null;
      const render = () => {
        const d = s.data;
        const over = s.weight > s.carryLimit + 0.05;
        if (tab === 'journal') {
          const entries = journalEntries({ has: (f) => s.has(f), archetype: s.archetype });
          m.innerHTML = `<div class="scan"></div>
            <header><h3>JOURNAL</h3><div class="label">${esc(s.archetype.name)}</div>
              <div class="tabs"><button class="tab" data-tab="kit">Kit</button><button class="tab on" data-tab="journal">Journal</button></div>
            </header>
            <div class="body">
              <div class="intel-list journal">${entries.length ? entries.map((e) => `<div class="intel-item"><b>${esc(e.title)}</b><span>${esc(e.body)}</span></div>`).join('') : '<div class="intel-item"><span>Nothing written yet. Mara talks first.</span></div>'}</div>
            </div>
            <footer><span class="kb"><span class="kbd">J</span> close</span><span>${entries.length} entries</span></footer>`;
        } else {
          const cells = Array.from({ length: 24 }, (_, i) => d.inventory[i]);
          const sel = selected ? ITEMS[selected] : null;
          m.innerHTML = `<div class="scan"></div>
            <header><h3>KIT</h3><div class="label">${esc(s.archetype.name)} · LEVEL ${d.level}</div>
              <div class="tabs"><button class="tab on" data-tab="kit">Kit</button><button class="tab" data-tab="journal">Journal</button></div>
            </header>
            <div class="body inv">
              <div>
                <div class="grid">${cells.map((c) => c && ITEMS[c.id]
                  ? `<div class="cell cat-${ITEMS[c.id].category} ${c.id === selected ? 'sel' : ''}" data-id="${c.id}">${ICONS[ITEMS[c.id].icon] ?? ''}<span class="q">${c.qty}</span></div>`
                  : '<div class="cell empty"></div>').join('')}</div>
                <div class="weight ${over ? 'over' : ''}">CARRY ${s.weight.toFixed(1)} / ${s.carryLimit} KG${over ? ' · OVERBURDENED' : ''}<div class="track"><i style="width:${Math.min(100, (s.weight / s.carryLimit) * 100)}%"></i></div></div>
              </div>
              <div>
                <div class="panel info">${sel ? `
                  <div class="cat">${sel.category}</div><h4>${esc(sel.name)}</h4>
                  <p>${esc(sel.description)}</p>${sel.flavor ? `<p class="flavor">${esc(sel.flavor)}</p>` : ''}
                  <div class="stats"><span>WT ${sel.weight}kg</span><span>VALUE ${sel.value}</span><span>×${s.count(sel.id)}</span></div>
                  <div class="rowbtns">${sel.usable ? '<button class="btn use">Use</button>' : ''}<button class="btn drop">Drop 1</button><button class="btn drop-all">Drop stack</button></div>` : '<p>Empty pockets. The camp can fix that, or the highway can.</p>'}
                </div>
                <div class="skills">
                  <div class="label">SKILLS · ${d.skillPoints} POINT${d.skillPoints === 1 ? '' : 'S'} · RANK 2 OPENS A FOCUS</div>
                  ${SKILL_ORDER.map((id) => {
                    const sk = SKILLS[id];
                    const lv = s.skill(id);
                    const owned = s.focus(id);
                    const pair = focusesFor(id);
                    const focusRow = lv < 2
                      ? '<div class="focuses"><span class="need">A focus opens at rank 2. One per skill. The point does not raise the rank.</span></div>'
                      : `<div class="focuses">${pair.map((f) => {
                          const taken = owned === f.id;
                          const can = d.skillPoints > 0 && !owned;
                          return `<button class="btn focus-btn${taken ? ' on' : ''}" data-focus="${f.id}" ${can ? '' : 'disabled'}>${esc(f.name)}</button>`;
                        }).join('')}</div><div class="d">${esc(owned ? (pair.find((f) => f.id === owned)?.blurb ?? '') : 'Pick one shape. The other one closes.')}</div>`;
                    return `<div class="skill"><div><div class="n">${sk.name}</div><div class="pips">${Array.from({ length: sk.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
                      <button class="btn up" data-skill="${id}" ${d.skillPoints > 0 && lv < sk.max ? '' : 'disabled'}>+</button>
                      <div class="d">${esc(sk.perLevel[Math.min(lv, sk.max)])}${lv < sk.max ? ` <span style="color:var(--amber)">Next: ${esc(sk.perLevel[lv + 1])}</span>` : ''}</div>
                      ${focusRow}</div>`;
                  }).join('')}
                </div>
              </div>
            </div>
            <footer><span class="kb"><span class="kbd">Tab</span> close · <span class="kbd">J</span> journal</span><span>${d.stats.picks} locks · caught ${d.stats.caught}× · ${d.stats.busted} bunkers · food ${Math.round(d.hunger)} · water ${Math.round(d.thirst)}</span></footer>`;
        }
        m.querySelectorAll('[data-tab]').forEach((b) => (b as HTMLElement).onclick = () => { tab = (b as HTMLElement).dataset.tab as 'kit' | 'journal'; this.audio.play('ui'); render(); });
        m.querySelectorAll('.cell[data-id]').forEach((c) => (c as HTMLElement).onclick = () => { selected = (c as HTMLElement).dataset.id!; this.audio.play('ui'); render(); });
        m.querySelectorAll('.up').forEach((b) => (b as HTMLElement).onclick = () => { if (s.spendPoint((b as HTMLElement).dataset.skill as never)) { this.audio.play('uiConfirm'); this.refreshVitals(); render(); } });
        m.querySelectorAll('.focus-btn').forEach((b) => (b as HTMLElement).onclick = () => { if (s.spendFocus((b as HTMLElement).dataset.focus ?? '')) { this.audio.play('uiConfirm'); this.refreshVitals(); render(); } });
        const use = m.querySelector('.use') as HTMLElement | null;
        if (use && selected) use.onclick = () => { onUse(selected!); if (!s.count(selected!)) selected = null; this.refreshHotbar(); render(); };
        const drop = m.querySelector('.drop') as HTMLElement | null;
        const dropAll = m.querySelector('.drop-all') as HTMLElement | null;
        if (drop && selected) drop.onclick = () => { s.removeItem(selected!, 1); if (!s.count(selected!)) selected = null; this.audio.play('ui'); this.refreshHotbar(); render(); };
        if (dropAll && selected) dropAll.onclick = () => { s.removeItem(selected!, s.count(selected!)); selected = null; this.audio.play('ui'); this.refreshHotbar(); render(); };
      };
      render();
      void close;
      return m;
    }, onClose);
  }

  openMap(px: number, pz: number, yaw: number, markers: MapMarker[], intel: { title: string; body: string }[], onClose: () => void) {
    this.audio.play('ui');
    this.openModal(() => {
      const m = h('div', 'panel modal interactive');
      m.innerHTML = `<div class="scan"></div>
        <header><h3>WASTELAND</h3><div class="label">Survey map · fog of war</div></header>
        <div class="body mapwrap">
          <canvas width="1200" height="1200"></canvas>
          <div>
            <div class="legend">
              <div class="it"><span class="dot" style="background:#3ff2e0"></span>You</div>
              <div class="it"><span class="dot" style="background:#ff8a2a"></span>Camp (rest & save)</div>
              <div class="it"><span class="dot" style="background:#f3e9d8"></span>Landmark</div>
              <div class="it"><span class="dot" style="background:#ff3a6e"></span>Bunker</div>
              <div class="it"><span class="dot" style="background:#c896ff"></span>Intel</div>
            </div>
            <div class="label" style="margin-top:20px">INTEL GATHERED</div>
            <div class="intel-list">${intel.length ? intel.map((i) => `<div class="intel-item"><b>${i.title}</b><span>${i.body}</span></div>`).join('') : '<div class="intel-item"><span>Nothing yet. Rumour has it the old gas station has a note pinned up.</span></div>'}</div>
          </div>
        </div>
        <footer><span class="kb"><span class="kbd">M</span> close</span></footer>`;
      drawWorldMap(m.querySelector('canvas')!, this.map!, px, pz, yaw, markers);
      return m;
    }, onClose);
  }

  showIntel(title: string, body: string, reveal: string, onClose: () => void) {
    this.audio.play('intel');
    this.openModal((close) => {
      const m = h('div', 'panel intel-reader interactive', `<div class="scan"></div>
        <span class="stamp">INTEL</span><h3>${title}</h3><p>${body}</p>
        ${reveal ? `<div class="reveal">${reveal}</div>` : ''}
        <div style="margin-top:20px"><button class="btn">Got it</button></div>`);
      (m.querySelector('button') as HTMLElement).onclick = close;
      return m;
    }, onClose);
  }

  openPause(opts: { onResume: () => void; onSave: () => void; onSettings: () => void; onQuit: () => void }) {
    this.audio.play('ui');
    let closeFn = () => {};
    closeFn = this.openModal((close) => {
      const m = h('div', 'panel pause interactive', `<div class="scan"></div><h3>PAUSED</h3>`);
      const add = (label: string, fn: () => void, primary = false) => {
        const b = h('button', `btn${primary ? ' primary' : ''}`, label);
        b.onmouseenter = () => this.audio.play('uiHover');
        b.onclick = () => { this.audio.play('ui'); fn(); };
        m.appendChild(b);
      };
      add('Resume', () => close(), true);
      add('Save game', () => { opts.onSave(); });
      add('Settings', () => { opts.onSettings(); });
      add('Controls', () => this.showControls());
      if (isTouch && canFullscreen() && !isFullscreen() && !isStandalone()) add('Full screen', () => enterFullscreen());
      add('Quit to title', () => { close(); opts.onQuit(); });
      return m;
    }, opts.onResume);
    return closeFn;
  }

  openSettings(settings: Settings, onChange: (s: Settings) => void) {
    const ov = h('div', 'overlay');
    ov.style.zIndex = '35';
    ov.innerHTML = `
      <div class="panel pause interactive"><div class="scan"></div>
        <h3>SETTINGS</h3>
        <div class="settings">
          <span>Graphics</span><select data-k="quality">${['low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}" ${settings.quality === q ? 'selected' : ''}>${q.toUpperCase()}</option>`).join('')}</select>
          <span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-k="master" value="${settings.master}">
          <span>Music</span><input type="range" min="0" max="1" step="0.05" data-k="music" value="${settings.music}">
          <span>Effects</span><input type="range" min="0" max="1" step="0.05" data-k="sfx" value="${settings.sfx}">
          <span>${isTouch ? 'Look sensitivity' : 'Mouse sensitivity'}</span><input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity" value="${settings.sensitivity}">
          <span>Voiced taunts</span><select data-k="voice"><option value="1" ${settings.voice ? 'selected' : ''}>ON (speech synthesis)</option><option value="0" ${settings.voice ? '' : 'selected'}>OFF (subtitles only)</option></select>
        </div>
        <button class="btn primary">Done</button>
      </div>`;
    ov.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = (inp as HTMLElement).dataset.k as keyof Settings;
        const v = (inp as HTMLInputElement).value;
        const next = { ...settings } as Record<string, unknown>;
        next[k] = k === 'quality' ? v : k === 'voice' ? v === '1' : Number(v);
        Object.assign(settings, next);
        onChange(settings);
      });
    });
    const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.stopPropagation(); done(); } };
    const done = () => { ov.remove(); window.removeEventListener('keydown', esc, true); };
    window.addEventListener('keydown', esc, true);
    (ov.querySelector('button') as HTMLElement).onclick = done;
    this.root.appendChild(ov);
  }

  resumeHint(show: boolean) {
    let el = document.querySelector('.resume-hint') as HTMLElement | null;
    if (show && !el) {
      el = h('div', 'resume-hint', isTouch ? 'Tap to resume' : 'Click to resume');
      this.root.appendChild(el);
    } else if (!show && el) el.remove();
  }

  // ------------------------------------------------------------------ story panels
  /** Mara's radio, and the debrief. Skip still finishes. */
  pages(pages: { speaker: string; text: string }[], doneLabel = 'Step outside'): Promise<void> {
    if (!pages.length) return Promise.resolve();
    this.modalOpen = true;
    this.audio.play('ui');
    const ov = h('div', 'overlay');
    const panel = h('div', 'panel brief interactive');
    ov.appendChild(panel);
    this.root.appendChild(ov);
    let i = 0;
    return new Promise((resolve) => {
      const finish = () => {
        window.removeEventListener('keydown', onKey, true);
        ov.remove();
        this.modalOpen = false;
        resolve();
      };
      const paint = () => {
        const page = pages[i];
        const last = i >= pages.length - 1;
        panel.innerHTML = `<div class="scan"></div>
          <div class="who">${esc(page.speaker)}</div>
          <p>${esc(page.text)}</p>
          <div class="brief-foot">
            <span>${i + 1} / ${pages.length}</span>
            <span class="btns"><button class="btn skip">Skip</button><button class="btn primary next">${last ? esc(doneLabel) : 'Next'}</button></span>
          </div>`;
        (panel.querySelector('.skip') as HTMLButtonElement).onclick = () => { this.audio.play('ui'); finish(); };
        (panel.querySelector('.next') as HTMLButtonElement).onclick = () => {
          this.audio.play('uiConfirm');
          if (last) finish();
          else { i++; paint(); }
        };
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'Escape' && e.code !== 'KeyE') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') { finish(); return; }
        if (i >= pages.length - 1) finish();
        else { i++; this.audio.play('ui'); paint(); }
      };
      window.addEventListener('keydown', onKey, true);
      paint();
    });
  }

  private choicePanel(speaker: string, text: string, choices: TalkChoiceView[], resolve: (id: string | null) => void) {
    const ov = h('div', 'overlay');
    const panel = h('div', 'panel talk interactive');
    const enabled = choices.filter((c) => !c.disabled);
    const paint = () => {
      panel.innerHTML = `<div class="scan"></div>
        <div class="who">${esc(speaker)}</div>
        <p>${esc(text)}</p>
        <div class="choices">${(() => { let n = 0; return choices.map((c) => `<button class="btn choice" data-id="${esc(c.id)}" ${c.disabled ? 'disabled' : ''}><span class="n">${c.disabled ? '·' : ++n}</span><span><b>${esc(c.label)}</b>${c.disabled ? `<small>${esc(c.disabled)}</small>` : ''}</span></button>`).join(''); })()}</div>
        <div class="brief-foot"><span>Esc hangs up</span><span>${enabled.length ? 'Number keys work' : ''}</span></div>`;
      panel.querySelectorAll('.choice').forEach((b) => {
        const btn = b as HTMLButtonElement;
        if (btn.disabled) return;
        btn.onclick = () => { this.audio.play('uiConfirm'); finish(btn.dataset.id ?? null); };
      });
    };
    const finish = (id: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      ov.remove();
      resolve(id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.audio.play('ui'); finish(null); return; }
      const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : e.code.startsWith('Numpad') ? Number(e.code.slice(6)) : 0;
      if (n >= 1 && n <= enabled.length) {
        e.preventDefault();
        e.stopPropagation();
        this.audio.play('uiConfirm');
        finish(enabled[n - 1].id);
      }
    };
    paint();
    ov.appendChild(panel);
    this.root.appendChild(ov);
    window.addEventListener('keydown', onKey, true);
    return finish;
  }

  choose(opts: { speaker: string; text: string; choices: TalkChoiceView[] }): Promise<string | null> {
    this.modalOpen = true;
    this.audio.play('ui');
    return new Promise((resolve) => {
      this.choicePanel(opts.speaker, opts.text, opts.choices, (id) => {
        this.modalOpen = false;
        resolve(id);
      });
    });
  }

  converse(opts: {
    start: string;
    node: (id: string) => { speaker: string; text: string; choices: TalkChoiceView[] } | null;
    onChoice: (nodeId: string, choiceId: string) => void;
  }): Promise<void> {
    this.modalOpen = true;
    this.audio.play('ui');
    return new Promise((resolve) => {
      const step = (id: string) => {
        const node = opts.node(id);
        if (!node) { this.modalOpen = false; resolve(); return; }
        this.choicePanel(node.speaker, node.text, node.choices, (pick) => {
          if (!pick) { this.modalOpen = false; resolve(); return; }
          const choice = node.choices.find((c) => c.id === pick);
          if (!choice || choice.disabled) { step(id); return; }
          opts.onChoice(id, pick);
          if (!choice.next) { this.modalOpen = false; resolve(); return; }
          step(choice.next);
        });
      };
      step(opts.start);
    });
  }

  /** Rest, craft, or raise Mara. Resolves 'radio' when they want the next scene. */
  camp(opts: {
    radioLabel: string;
    radioDisabled?: string;
    onRest: () => void;
    onCraft: (id: string) => string | null;
    recipes: { id: string; name: string; detail: string; disabled?: string }[];
  }): Promise<'radio' | 'closed'> {
    this.modalOpen = true;
    this.audio.play('ui');
    const ov = h('div', 'overlay');
    const panel = h('div', 'panel camp-panel interactive');
    ov.appendChild(panel);
    this.root.appendChild(ov);
    let note = 'The fire is real. The full heal is not, unless you\'ve learned how to sleep.';
    return new Promise((resolve) => {
      const finish = (why: 'radio' | 'closed') => {
        window.removeEventListener('keydown', onKey, true);
        ov.remove();
        this.modalOpen = false;
        resolve(why);
      };
      const paint = () => {
        panel.innerHTML = `<div class="scan"></div>
          <header><h3>LAST CHANCE</h3><div class="label">CAMP</div></header>
          <div class="body">
            <p class="camp-note">${esc(note)}</p>
            <div class="camp-actions">
              <button class="btn primary rest">Rest and save</button>
              <button class="btn radio" ${opts.radioDisabled ? 'disabled' : ''}>${esc(opts.radioLabel)}</button>
            </div>
            ${opts.radioDisabled ? `<p class="hint">${esc(opts.radioDisabled)}</p>` : ''}
            <div class="label" style="margin-top:18px">WORK THE SCRAP</div>
            <div class="recipes">${opts.recipes.map((r) => `<div class="recipe"><div><b>${esc(r.name)}</b><span>${esc(r.detail)}</span>${r.disabled ? `<small>${esc(r.disabled)}</small>` : ''}</div><button class="btn craft" data-id="${esc(r.id)}" ${r.disabled ? 'disabled' : ''}>Make</button></div>`).join('')}</div>
          </div>
          <footer><span class="kb"><span class="kbd">Esc</span> back to the fire</span></footer>`;
        (panel.querySelector('.rest') as HTMLButtonElement).onclick = () => { this.audio.play('uiConfirm'); opts.onRest(); note = 'You sit with it. Not new. Better than you were.'; paint(); };
        const radio = panel.querySelector('.radio') as HTMLButtonElement;
        radio.onclick = () => { if (radio.disabled) return; this.audio.play('uiConfirm'); finish('radio'); };
        panel.querySelectorAll('.craft').forEach((b) => (b as HTMLButtonElement).onclick = () => {
          const err = opts.onCraft((b as HTMLElement).dataset.id ?? '');
          this.audio.play(err ? 'deny' : 'uiConfirm');
          note = err ?? 'Made. It looks like it will work, which is the standard out here.';
          paint();
        });
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish('closed');
      };
      window.addEventListener('keydown', onKey, true);
      paint();
    });
  }

  // ------------------------------------------------------------------ UIBridge minigames
  async lockpick(opts: { pins: number; title: string; onBreak: () => boolean }): Promise<LockResult> {
    this.minigameOpen = true;
    const g = new LockpickGame(this.root, this.audio, {
      ...opts,
      skill: this.state?.skill('lockpicking') ?? 0,
      picks: () => this.state?.count('lockpick') ?? 0,
    });
    const r = await g.run();
    this.minigameOpen = false;
    return r;
  }

  async keypad(opts: { title: string; code: string; hint: string }) {
    this.minigameOpen = true;
    const r = await new KeypadGame(this.root, this.audio, opts).run();
    this.minigameOpen = false;
    return r;
  }

  async circuit(opts: { title: string; difficulty: number }) {
    this.minigameOpen = true;
    const r = await new CircuitGame(this.root, this.audio, { ...opts, skill: this.state?.skill('electronics') ?? 0 }).run();
    this.minigameOpen = false;
    return r;
  }
}
