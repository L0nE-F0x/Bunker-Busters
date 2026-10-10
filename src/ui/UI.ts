import './styles.css';
import { ICONS, EYE_ICON } from './icons';
import type { Vector3 } from 'three/webgpu';
import { ITEMS, HOTBAR_ITEMS } from '@/content/items';
import { itemStatus, USE_LABEL, hotbarItem } from '@/content/items';
import { openTill, type TillOpts } from './Trader';
import { offlineLabel } from '@/engine/offline';
import { openInstallSheet, isPhone, isInstalledApp } from './install';
import { SKILLS, SKILL_ORDER, focusesFor, capstonesFor } from '@/content/skills';
import { ARCHETYPES } from '@/content/archetypes';
import { PEOPLE, standingTier, STANDING_WORD } from '@/content/people';
import { MAX_HEALTH, BASE_CARRY } from '@/content/progression';
import type { ArchetypeDef, SkillId } from '@/content/types';
import { skillsHTML, bindSkills, defaultSkill } from './SkillsView';
import { journalHTML, bindJournal, monogram, standingPips, type JournalSource, type JournalSel } from './JournalView';
import type { GameState, Settings } from '@/game/State';
import type { AudioEngine } from '@/engine/audio';
import type { LockResult, TalkChoiceView, UIBridge } from '@/game/context';
import { LockpickGame } from './Lockpick';
import { CircuitGame, KeypadGame } from './Circuit';
import { HackGame, type HackOpts, type HackResult } from './Hack';
import { Minimap, MapData, type MapMarker } from './Minimap';
import { buildWorldMap, type WorldMapOpts, type MapViewState } from './WorldMap';
import { mountUpdateNotice } from './Updater';
import { isTouch, isStandalone, canFullscreen, isFullscreen, enterFullscreen } from '@/engine/device';
import type { ArmsHud } from '@/game/combat/PlayerArms';
import { DIFFICULTY } from '@/content/weapons';
import { binds, actionGlyph, actionKey, actionWord, kbdGlyph, keyLabel, padName, type Action } from '@/engine/bindings';
import { openControls } from './ControlsView';

/** Which device's glyphs to show (html.pad is set by Input when a controller was used last). */
const device = () => (isTouch ? 'touch' : document.documentElement.classList.contains('pad') ? 'pad' : 'kbm');
/** An action's first key as a keycap, for the static help lines in footers. */
const kk = (a: Action) => kbdGlyph(binds.keys(a)[0] ?? '');
/** HUD prompt keys (Game sends 'E', 'F', 'LMB') → the action they stand for. */
const PROMPT_ACT: Record<string, Action> = { E: 'interact', F: 'alt', LMB: 'fire' };
/** "(F)" / "(E)" written into content → the control bound on the device in use (touch: its USE / ALT buttons). */
const proseKeys = (s: string) => (s.indexOf('(') < 0 ? s : s.replace(/\((E|F)\)/g, (_, k: string) => `(${isTouch ? (k === 'E' ? 'USE' : 'ALT') : actionWord(PROMPT_ACT[k])})`));

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
  /** The weapon in hand (null: none / no arms yet). */
  arms?: ArmsHud | null;
  health?: number;
  /** Hostiles out in the world: something is hunting you, or getting curious. */
  threat?: 'hunted' | 'watched' | null;
  venom?: boolean;
  /** Night stealth: in shadow, lit (firelight, floodlight, torch), or nothing to say (day, twilight). */
  light?: 'shadow' | 'lit' | null;
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
  private subtitleId = 0;
  private lastClock = '';
  private lastNeed = '';
  private detCache: { show: boolean | null; color: string; width: string; text: string } = { show: null, color: '', width: '', text: '' };
  private minimapT = 0;
  private lastObjective = '';
  private objectiveTimer = 0;
  private loadingEl: HTMLElement;
  private armsKey = '';
  private xhairKey = '';
  private hitT = 0;
  private hitKind = '';

  constructor(private audio: AudioEngine) {
    this.root = document.getElementById('ui')!;
    this.loadingEl = h('div', '', `
      <div class="logo-sm">BUNKER BUSTERS</div>
      <div class="bar"><i></i></div>
      <div class="msg">BOOTING</div>
      <div class="tip">Tip: crouch to step over tripwires. SeedBot is running on 12% battery, so it powers down more often than you'd think.</div>`);
    this.loadingEl.id = 'loading';
    document.body.appendChild(this.loadingEl);
    // a controller picked up (or put down): the hotbar and badges change their glyphs
    document.addEventListener('bb-device', () => { this.refreshHotbar(); this.refreshVitals(); });
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
      <div class="title-foot"><span>v${__APP_VERSION__} · DAY 1,284 · ${opts.backend.toUpperCase()}<span class="offline-status">${offlineLabel()}</span></span><span class="press">STAY OUTSIDE</span></div>`);
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
    // phones in the browser: put the game on the home screen (full screen, plays offline)
    if (isTouch && isPhone && !isInstalledApp()) add('Install app', () => openInstallSheet({ onGamePage: true }));
    this.root.appendChild(el);
    void mountUpdateNotice(el, () => { this.audio.start(); this.audio.play('uiConfirm'); });
    // first interaction starts audio
    const kick = () => { this.audio.start(); window.removeEventListener('pointerdown', kick); };
    window.addEventListener('pointerdown', kick);
  }

  showControls() {
    if (!isTouch) { openControls(this.root, this.audio); return; }
    const ov = h('div', 'overlay');
    {
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
      this.mountBackPanel(ov);
    }
  }

  /** The Kit / Skills / Journal footer: how to switch tabs and close, in the device's own glyphs. */
  private tabHelp(tab: 'kit' | 'skills' | 'journal') {
    if (device() === 'pad') return `<span class="pg pill">${padName('P4')}</span> <span class="pg pill">${padName('P5')}</span> tabs · <span class="pg face f1">${padName('P1')}</span> close`;
    const others = (['kit', 'skills', 'journal'] as const).filter((t) => t !== tab).map((t) => `${kk(t)} ${t}`).join(' · ');
    return `${kk(tab)} close · ${others}`;
  }

  /** A panel over another menu: its button or Escape closes just this one. */
  private mountBackPanel(ov: HTMLElement) {
    const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const close = () => { ov.remove(); window.removeEventListener('keydown', esc, true); };
    window.addEventListener('keydown', esc, true);
    ov.querySelector('button')!.onclick = close;
    this.root.appendChild(ov);
  }

  // ------------------------------------------------------------------ char select
  /**
   * Six people, one radio. A 3×2 roster of compact cards over a detail sheet, all on one column
   * that fits a 720p screen without scrolling the roster (the sheet scrolls on tiny screens).
   */
  showCharSelect(onPick: (id: string) => void, onPreview: (id: string) => void, onBack: () => void) {
    const el = h('div', '');
    el.id = 'charselect';
    let sel = ARCHETYPES[0].id;
    el.innerHTML = `
      <div class="cs-side interactive">
        <div class="cs-top">
          <div class="label">Day 1,284 · The Compact has one radio</div>
          <h2>Who gets it?</h2>
        </div>
        <div class="cs-cards" role="listbox"></div>
        <div class="panel cs-detail"></div>
        <div class="cs-actions">
          <button class="btn back">Back</button>
          <button class="btn primary go">Take the radio</button>
        </div>
      </div>`;
    const cards = el.querySelector('.cs-cards')!;
    const detail = el.querySelector('.cs-detail') as HTMLElement;
    const render = () => {
      const a = ARCHETYPES.find((x) => x.id === sel)!;
      el.style.setProperty('--accent', a.accent);
      cards.querySelectorAll('.cs-card').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === sel));
      detail.innerHTML = this.archetypeSheet(a);
      detail.scrollTop = 0;
      onPreview(sel);
    };
    for (const a of ARCHETYPES) {
      const c = h('button', 'cs-card', `<span class="mono" style="--pc:${a.accent}">${a.name.split(' ').map((w) => w[0]).join('')}</span><span class="nm">${esc(a.name)}<small>${esc(a.role)}</small></span>`);
      c.dataset.id = a.id;
      c.setAttribute('role', 'option');
      c.style.setProperty('--accent', a.accent);
      c.onmouseenter = () => this.audio.play('uiHover');
      c.onclick = () => { if (sel === a.id) return; sel = a.id; this.audio.play('ui'); render(); };
      cards.appendChild(c);
    }
    // arrows walk the roster; Enter takes the radio
    const onKey = (e: KeyboardEvent) => {
      const i = ARCHETYPES.findIndex((a) => a.id === sel);
      const step = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowDown' ? 3 : e.code === 'ArrowUp' ? -3 : 0;
      if (step) {
        e.preventDefault();
        sel = ARCHETYPES[(i + step + ARCHETYPES.length) % ARCHETYPES.length].id;
        this.audio.play('ui');
        render();
      } else if (e.code === 'Enter') { e.preventDefault(); go(); }
    };
    const leave = () => { window.removeEventListener('keydown', onKey); el.remove(); };
    const go = () => { this.audio.play('uiConfirm'); leave(); onPick(sel); };
    window.addEventListener('keydown', onKey);
    (el.querySelector('.go') as HTMLButtonElement).onclick = go;
    (el.querySelector('.back') as HTMLButtonElement).onclick = () => { leave(); onBack(); };
    this.root.appendChild(el);
    render();
  }

  /** The detail sheet for one archetype: who, why, the skill line, the build, the passive, the pocket. */
  private archetypeSheet(a: ArchetypeDef) {
    const bar = (label: string, v: number, txt: string) =>
      `<div class="cs-bar"><span>${label}</span><span class="track"><i style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></i></span><b>${txt}</b></div>`;
    const quiet = (1.3 - a.stats.stealth) / 0.8;
    const tough = (a.stats.toughness - 0.7) / 0.7;
    const pace = (a.stats.speed - 0.9) / 0.2;
    const pack = BASE_CARRY + a.carry;
    const skills = SKILL_ORDER.map((id) => {
      const lv = a.skills[id] ?? 0;
      return `<div class="cs-skill ${lv ? 'has' : ''}"><span>${SKILLS[id].name.replace(' Engineering', '')}</span><span class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span></div>`;
    }).join('');
    const SHORT: Record<string, string> = { lockpick: 'Picks', emp: 'EMP', battery: 'Cells', water: 'Water', ration: 'Rations', scrap: 'Scrap', nft_drive: 'Wallet', charge: 'Charges', noisemaker: 'Noise', medkit: 'Medkit' };
    const pocket = a.startingItems.map((s) => {
      const name = ITEMS[s.id]?.name ?? s.id;
      return `<span class="it" title="${esc(name)}">${ICONS[ITEMS[s.id]?.icon ?? ''] ?? ''}<b>${s.qty}</b><small>${esc(SHORT[s.id] ?? name)}</small></span>`;
    }).join('');
    return `<div class="scan"></div>
      <div class="cs-name"><h3>${esc(a.name)}</h3><span class="role">${esc(a.role)}<i>·</i>“${esc(a.tagline)}”</span></div>
      <p class="cs-motive">${esc(a.motive)}</p>
      <p class="cs-desc"><b>${esc(a.playstyle)}</b> ${esc(a.description)}</p>
      <div class="cs-grid">
        <div><div class="label">Skill line</div>${skills}</div>
        <div><div class="label">Build</div>
          ${bar('Quiet', quiet, quiet > 0.7 ? 'HIGH' : quiet < 0.25 ? 'LOW' : 'MID')}
          ${bar('Toughness', tough, tough > 0.7 ? 'HIGH' : tough < 0.35 ? 'LOW' : 'MID')}
          ${bar('Pace', pace, pace > 0.65 ? 'QUICK' : pace < 0.4 ? 'SLOW' : 'EVEN')}
          ${bar('Pack', pack / 26, `${pack} KG`)}
        </div>
      </div>
      <div class="cs-pocket"><span class="label">Pocket · and one skill point to spend</span><div>${pocket}</div></div>
      <div class="cs-passive"><span class="label">Passive · ${esc(a.signature.name)}</span><p>${esc(a.signature.description)}</p></div>`;
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
      <div class="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
      <div class="hitmark"><i></i><i></i><i></i><i></i></div>
      <div class="dmgarcs"></div>
      <div class="weapon" style="opacity:0"><div class="wname"></div><div class="ammo"><b class="mag"></b><span class="cap"></span><span class="res"></span></div><div class="rounds"></div></div>
      <div class="subtitle" style="opacity:0"><span class="who"></span><span class="line"></span></div>
      <div class="prompt"></div>
      <div class="hotbar"></div>
      <div class="vitals">
        <div class="row"><div class="lvl">1</div><div class="bars"><div class="hp"></div><div class="xpbar"><i></i></div></div></div>
        <div class="needs"><div class="nrow hunger"><span>FOOD</span><div class="track"><i></i></div></div><div class="nrow thirst"><span>WATER</span><div class="track"><i></i></div></div></div>
        <div class="meta"><span class="arch"></span><span class="xptext"></span></div>
        <div class="spwrap"></div>
      </div>
      <div class="stance"><span class="pill venom">Venom</span><span class="pill lightp"></span><span class="pill crouch">Crouch</span><span class="pill sprint">Sprint</span></div>`;
    for (const k of ['objective', 'toasts', 'minimap', 'clock', 'detect', 'subtitle', 'prompt', 'hotbar', 'vitals', 'stance', 'crosshair', 'xhair', 'hitmark', 'dmgarcs', 'weapon']) {
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
    state.events.on('item', ({ id, qty }) => this.itemGot(id, qty));
    state.events.on('inventoryChanged', () => this.refreshHotbar());
    this.refreshVitals();
    this.refreshHotbar();
  }

  private pendingItems: { id: string; qty: number; name: string }[] = [];

  /**
   * "+2 Water" per pickup, held until the end of the task: a loot summary toast, banner or intel card
   * shown in the same breath ("2× Water, 6× .38") already says it, so those items aren't toasted twice.
   */
  private itemGot(id: string, qty: number) {
    if (!this.pendingItems.length) {
      setTimeout(() => {
        const left = this.pendingItems.splice(0);
        if (!left.length) return;
        this.audio.play('pickup');
        for (const it of left) if (it.qty > 0) this.toast(`+${it.qty} ${it.name}`, 'good');
      }, 0);
    }
    this.pendingItems.push({ id, qty, name: ITEMS[id]?.name ?? id });
  }

  /** Items a summary line already names are dropped from the pending per-item toasts. */
  private claimItems(text: string) {
    for (const it of this.pendingItems) if (it.qty > 0 && text.includes(`${it.qty}× ${it.name}`)) it.qty = 0;
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'xp' = 'info') {
    this.claimItems(text);
    const t = h('div', `toast ${kind}`, proseKeys(text));
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
    this.hud.querySelector('.spwrap')!.innerHTML = d.skillPoints > 0 ? `<span class="sp-badge"${isTouch ? ' data-key="act:kit"' : ''}>${d.skillPoints} SKILL POINT${d.skillPoints > 1 ? 'S' : ''} · ${isTouch ? 'KIT' : device() === 'pad' ? `${padName(binds.pad('kit'))} → SKILLS` : actionKey('skills')}</span>` : '';
  }

  refreshHotbar() {
    if (!this.state) return;
    this.els.hotbar.innerHTML = HOTBAR_ITEMS.map((_, i) => {
      const { id, q } = hotbarItem(i, this.state!);
      const a = `hotbar${i + 1}` as Action;
      const k = device() === 'pad' && binds.pad(a) ? padName(binds.pad(a)) : keyLabel(binds.keys(a)[0] ?? '');
      return `<div class="slot ${q ? '' : 'empty'}" data-key="act:${a}"><span class="k">${k}</span>${ICONS[ITEMS[id].icon]}<span class="q">${q}</span></div>`;
    }).join('');
  }

  /** A level-up waits for any banner on screen (a quest finishing usually brings both at once). */
  private pendingLevel = 0;
  levelUp(level: number) {
    this.refreshVitals();
    if (this.bannerBusy) { this.pendingLevel = level; return; }
    this.audio.play('levelUp');
    const el = h('div', 'levelup', `<div class="ring">${level}</div><div class="t">LEVEL UP</div><div class="s">+1 skill point — ${isTouch ? 'open your kit' : device() === 'pad' ? `open your kit (${actionGlyph('kit', 'pad')})` : `press ${kk('skills')}`} to spend</div>`);
    this.hud.appendChild(el);
    setTimeout(() => el.remove(), 4300);
  }

  private bannerQueue: [string, string, 'good' | 'bad' | 'info'][] = [];
  private bannerBusy = false;

  /** Big centred banner. Queued so simultaneous events never overlap. */
  banner(title: string, sub: string, kind: 'good' | 'bad' | 'info' = 'good') {
    this.claimItems(sub);
    this.bannerQueue.push([title, sub, kind]);
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner() {
    const next = this.bannerQueue.shift();
    if (!next) {
      this.bannerBusy = false;
      if (this.pendingLevel && this.hud) { const l = this.pendingLevel; this.pendingLevel = 0; this.levelUp(l); }
      return;
    }
    this.bannerBusy = true;
    const [title, sub, kind] = next;
    const el = h('div', `banner ${kind}`, `<div class="big">${title}</div><div class="rule"></div><div class="sub">${sub}</div>`);
    (this.hud ?? this.root).appendChild(el);
    setTimeout(() => { el.remove(); this.nextBanner(); }, 5100);
  }

  subtitle(speaker: string, text: string, voice?: { pos?: Vector3; variant?: number }) {
    const el = this.els.subtitle;
    if (!el) return;
    const who = el.querySelector('.who')!;
    who.textContent = speaker;
    who.classList.toggle('bot', speaker === 'SeedBot');
    el.querySelector('.line')!.textContent = `“${text}”`;
    el.style.opacity = '1';
    this.subtitleTimer = 3 + text.length * 0.05;
    const id = ++this.subtitleId;
    // keep the line up for as long as it's being said
    void this.audio.speak(speaker, text, voice).then((secs) => {
      if (secs && id === this.subtitleId) this.subtitleTimer = Math.max(this.subtitleTimer, secs + 0.8);
    });
  }

  /** True while a subtitle is on screen. Banter waits for it. */
  get subtitleBusy() {
    return this.subtitleTimer > 0;
  }

  /** The small caps line over the objective: the quest the corner is following. Called on change only. */
  setObjectiveLabel(label: string) {
    const el = this.els.objective?.querySelector('.label');
    if (el) el.textContent = label;
  }

  private lastLight = '';
  updateHUD(dt: number, f: HudFrame) {
    if (!this.hud || !this.state) return;
    if (f.objective !== this.lastObjective) {
      this.lastObjective = f.objective;
      this.els.objective.querySelector('.text')!.textContent = f.objective;
      this.els.objective.classList.remove('flash');
      void this.els.objective.offsetWidth;
      this.els.objective.classList.add('flash', 'fresh');
      // touch clamps the objective to two lines once it has been read (styles.css)
      clearTimeout(this.objectiveTimer);
      this.objectiveTimer = window.setTimeout(() => this.els.objective?.classList.remove('fresh'), 9000);
    }
    // detection (only touch the DOM when something visible changed: every write costs a style pass
    // and a recomposite of the overlay, which is what hurts in WebKitGTK)
    const det = this.els.detect;
    const show = f.detection > 0.02 || f.droneState === 'alert' || !!f.threat;
    const dc = this.detCache;
    if (show !== dc.show) { dc.show = show; det.style.opacity = show ? '1' : '0'; }
    if (show) {
      const col = f.droneState === 'alert' || f.threat === 'hunted' ? '#ff3b3b' : f.detection > 0.3 || f.threat === 'watched' ? '#ffb347' : '#f3e9d8';
      if (col !== dc.color) { dc.color = col; det.style.color = col; }
      const w = `${Math.round(f.detection * 400) / 4}%`; // quarter-percent steps: sub-pixel on any meter
      if (w !== dc.width) { dc.width = w; (det.querySelector('.m i') as HTMLElement).style.width = w; }
      const text = f.droneState === 'alert' ? 'DETECTED' : f.threat === 'hunted' ? 'HOSTILES' : f.canSee || f.threat === 'watched' ? 'BEING WATCHED' : f.droneState === 'search' ? 'SEARCHING' : 'SUSPICIOUS';
      if (text !== dc.text) { dc.text = text; det.querySelector('.t')!.textContent = text; }
    }
    // prompts
    const pr = this.els.prompt;
    // on touch the prompts are buttons themselves (data-key → TouchControls)
    const dev = device();
    const html = f.prompt.map((p) => isTouch
      ? `<div class="p ${p.na ? 'na' : ''}" data-key="act:${PROMPT_ACT[p.key] ?? p.key}"><span class="kbd">${p.key === 'E' ? 'USE' : 'ALT'}</span>${p.label}${p.na ? `<small>${proseKeys(p.na)}</small>` : ''}</div>`
      : `<div class="p ${p.na ? 'na' : ''}">${PROMPT_ACT[p.key] ? actionGlyph(PROMPT_ACT[p.key], dev) : `<span class="kbd">${p.key}</span>`}${p.label}${p.na ? `<small>${proseKeys(p.na)}</small>` : ''}</div>`).join('');
    if (pr.dataset.html !== html) { pr.innerHTML = html; pr.dataset.html = html; }
    // stance
    this.els.stance.querySelector('.crouch')!.classList.toggle('on', f.crouch);
    this.els.stance.querySelector('.sprint')!.classList.toggle('on', f.sprint);
    this.els.stance.querySelector('.venom')!.classList.toggle('on', !!f.venom);
    // the stealth model, at night: are you a shadow or a target?
    const lt = f.light === 'shadow' ? 'In shadow' : f.light === 'lit' ? 'Lit' : '';
    if (lt !== this.lastLight) {
      this.lastLight = lt;
      const el = this.els.stance.querySelector('.lightp') as HTMLElement;
      el.textContent = lt;
      el.className = `pill lightp ${f.light ?? ''}`;
    }
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
    this.updateArms(dt, f.arms);
    // subtitle fade
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.els.subtitle.style.opacity = '0';
    }
  }

  /** One of your shots landed: the cross flashes (red for a kill, bigger for a headshot). */
  hitmark(kind: 'hit' | 'head' | 'kill') {
    const el = this.els.hitmark;
    if (!el) return;
    this.hitT = kind === 'kill' ? 0.45 : 0.25;
    if (kind !== this.hitKind || true) {
      this.hitKind = kind;
      el.className = `hitmark on ${kind}`;
      // restart the pop
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  /** Damage came from `bearing` (radians, 0 = straight ahead, positive = to the left). */
  damageFrom(bearing: number, k: number) {
    const host = this.els.dmgarcs;
    if (!host) return;
    const arc = h('div', 'arc');
    arc.style.transform = `rotate(${(-bearing * 180) / Math.PI}deg)`;
    arc.style.setProperty('--k', String(0.45 + k * 0.55));
    host.appendChild(arc);
    setTimeout(() => arc.remove(), 1300);
    while (host.children.length > 5) host.firstChild?.remove();
  }

  /** Weapon panel, crosshair spread and hit-marker decay (only writes the DOM on change). */
  private updateArms(dt: number, a: ArmsHud | null | undefined) {
    const wp = this.els.weapon, xh = this.els.xhair, dot = this.els.crosshair;
    if (!wp || !xh) return;
    const key = a && a.weapon ? `${a.weapon}|${a.mag}|${a.reserve}|${a.reloading}` : '';
    if (key !== this.armsKey) {
      this.armsKey = key;
      if (!a || !a.weapon) wp.style.opacity = '0';
      else {
        wp.style.opacity = '1';
        wp.querySelector('.wname')!.textContent = a.name.toUpperCase();
        const gun = !a.melee;
        (wp.querySelector('.mag') as HTMLElement).textContent = gun ? String(a.mag) : '';
        (wp.querySelector('.cap') as HTMLElement).textContent = gun ? `/ ${a.cap}` : '';
        (wp.querySelector('.res') as HTMLElement).textContent = gun ? `${a.reserve}` : '';
        wp.classList.toggle('low', gun && a.mag <= Math.max(1, Math.floor(a.cap / 3)));
        wp.classList.toggle('empty', gun && a.mag === 0);
        wp.classList.toggle('reloading', a.reloading);
        wp.querySelector('.rounds')!.innerHTML = gun ? Array.from({ length: a.cap }, (_, i) => `<i class="${i < a.mag ? 'on' : ''}"></i>`).join('') : '';
      }
    }
    // crosshair: four ticks that open with the spread; gone once you're on the sights
    let xk = 'none';
    if (a && a.weapon && !a.melee) {
      const fovPx = innerHeight / (2 * Math.tan((32 * Math.PI) / 180));
      const gap = Math.round(Math.max(4, Math.tan(a.spread) * fovPx));
      const hide = a.ads > 0.6;
      xk = hide ? 'ads' : `g${gap}`;
    } else if (a && a.weapon) xk = 'melee';
    if (a?.takedown) xk += '|td';
    if (xk !== this.xhairKey) {
      this.xhairKey = xk;
      const gun = xk.startsWith('g');
      xh.style.opacity = gun ? '1' : '0';
      if (gun) xh.style.setProperty('--gap', `${xk.slice(1).split('|')[0]}px`);
      dot.style.opacity = xk.startsWith('ads') ? '0' : '1';
      dot.classList.toggle('td', !!a?.takedown);
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.els.hitmark.className = 'hitmark';
    }
  }

  setHudVisible(v: boolean) {
    this.hud?.classList.toggle('dim', !v);
  }

  // ------------------------------------------------------------------ modals
  /** `keys` sees a key first; return true to keep the modal open (e.g. switching tabs). */
  private openModal(build: (close: () => void) => HTMLElement, onClose?: () => void, keys?: (code: string) => boolean) {
    this.modalOpen = true;
    const ov = h('div', 'overlay');
    const close = () => {
      ov.remove();
      this.modalOpen = false;
      window.removeEventListener('keydown', keyClose, true);
      onClose?.();
    };
    const keyClose = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' && !binds.actionsOf(e.code).some((a) => a === 'kit' || a === 'skills' || a === 'journal' || a === 'map')) return;
      // a panel opened on top (Settings or Controls over the pause menu) handles its own keys
      const overlays = this.root.querySelectorAll(':scope > .overlay');
      if (overlays[overlays.length - 1] !== ov) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape' && keys?.(e.code)) return;
      close();
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

  /**
   * Kit, Skills and Journal: one modal, three tabs. Tab/I, K and J switch to their tab, or close
   * the modal if you're already on it. Escape always closes.
   */
  openInventory(onUse: (id: string) => void, onClose: () => void, initial: 'kit' | 'skills' | 'journal' = 'kit', story: JournalSource | null = null) {
    const s = this.state!;
    this.audio.play('ui');
    let tab = initial;
    let render = () => {};
    const want = (code: string): 'kit' | 'skills' | 'journal' | null => {
      const acts = binds.actionsOf(code);
      return acts.includes('kit') ? 'kit' : acts.includes('skills') ? 'skills' : acts.includes('journal') ? 'journal' : null;
    };
    this.openModal(() => {
      const m = h('div', 'panel modal interactive');
      let selected: string | null = s.data.inventory[0]?.id ?? null;
      let skill: SkillId = defaultSkill(s);
      const jsel: JournalSel = { sub: 'quests', quest: '', person: '' };
      const header = (title: string, label: string) => {
        const pts = s.data.skillPoints;
        return `<div class="scan"></div>
          <header><h3>${title}</h3><div class="label">${label}</div>
            <div class="tabs">
              <button class="tab ${tab === 'kit' ? 'on' : ''}" data-tab="kit">Kit</button>
              <button class="tab ${tab === 'skills' ? 'on' : ''}" data-tab="skills">Skills${pts ? `<i class="tab-dot">${pts}</i>` : ''}</button>
              <button class="tab ${tab === 'journal' ? 'on' : ''}" data-tab="journal">Journal</button>
            </div>
          </header>`;
      };
      render = () => {
        const d = s.data;
        if (tab === 'skills') {
          m.innerHTML = `${header('SKILLS', `${esc(s.archetype.name)} · LEVEL ${d.level}`)}
            ${skillsHTML(s, skill)}
            <footer><span class="kb">${this.tabHelp('skills')}</span><span>A focus or capstone costs a point and doesn't raise the rank.</span></footer>`;
          bindSkills(m, s, {
            select: (id) => { skill = id; this.audio.play('ui'); render(); },
            spent: () => { this.audio.play('uiConfirm'); this.refreshVitals(); render(); },
            deny: () => this.audio.play('deny'),
          });
        } else if (tab === 'journal') {
          if (story) {
            m.innerHTML = `${header('JOURNAL', esc(s.archetype.name))}
              ${journalHTML(s, story, jsel)}
              <footer><span class="kb">${this.tabHelp('journal')}</span><span>The corner of the screen follows the tracked quest, or the story.</span></footer>`;
            bindJournal(m, story, jsel, () => { this.audio.play('ui'); render(); });
          } else {
            m.innerHTML = `${header('JOURNAL', esc(s.archetype.name))}<div class="body"><p class="empty">Nothing written yet.</p></div>`;
          }
        } else {
          const cells = Array.from({ length: 24 }, (_, i) => d.inventory[i]);
          const sel = selected ? ITEMS[selected] : null;
          const over = s.weight > s.carryLimit + 0.05;
          const build = SKILL_ORDER.map((id) => {
            const lv = s.skill(id);
            const f = focusesFor(id).find((x) => x.id === s.focus(id));
            const c = capstonesFor(id).find((x) => x.id === s.capstone(id));
            const tags = [f?.name, c?.name].filter(Boolean).join(' · ');
            return `<div class="kb-skill ${lv ? '' : 'zero'}"><span>${SKILLS[id].name}</span><span class="pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><small>${esc(tags)}</small></div>`;
          }).join('');
          m.innerHTML = `${header('KIT', `${esc(s.archetype.name)} · LEVEL ${d.level}`)}
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
                  <p>${esc(proseKeys(sel.description))}</p>${itemStatus(sel.id, s) ? `<p class="gear-status">${esc(itemStatus(sel.id, s))}</p>` : ''}${sel.flavor ? `<p class="flavor">${esc(sel.flavor)}</p>` : ''}
                  <div class="stats"><span>WT ${sel.weight}kg</span><span>VALUE ${sel.value}</span><span>×${s.count(sel.id)}</span></div>
                  <div class="rowbtns">${sel.usable ? `<button class="btn use">${USE_LABEL[sel.id] ?? 'Use'}</button>` : sel.category === 'weapon' ? '<button class="btn use">Equip</button>' : ''}<button class="btn drop">Drop 1</button><button class="btn drop-all">Drop stack</button></div>` : '<p>Nothing in your pockets yet.</p>'}
                </div>
                <div class="kit-build">
                  <div class="label">Build · ${d.skillPoints} point${d.skillPoints === 1 ? '' : 's'} to spend</div>
                  ${build}
                  <button class="btn to-skills" data-tab="skills">Open skills · K</button>
                </div>
              </div>
            </div>
            <footer><span class="kb">${this.tabHelp('kit')}</span><span>${d.stats.picks} locks · caught ${d.stats.caught}× · ${d.stats.busted} bunkers · food ${Math.round(d.hunger)} · water ${Math.round(d.thirst)}</span></footer>`;
          m.querySelectorAll('.cell[data-id]').forEach((c) => (c as HTMLElement).onclick = () => { selected = (c as HTMLElement).dataset.id!; this.audio.play('ui'); render(); });
          const use = m.querySelector('.use') as HTMLElement | null;
          if (use && selected) use.onclick = () => { onUse(selected!); if (!s.count(selected!)) selected = null; this.refreshHotbar(); render(); };
          const drop = m.querySelector('.drop') as HTMLElement | null;
          const dropAll = m.querySelector('.drop-all') as HTMLElement | null;
          if (drop && selected) drop.onclick = () => { s.removeItem(selected!, 1); if (!s.count(selected!)) selected = null; this.audio.play('ui'); this.refreshHotbar(); render(); };
          if (dropAll && selected) dropAll.onclick = () => { s.removeItem(selected!, s.count(selected!)); selected = null; this.audio.play('ui'); this.refreshHotbar(); render(); };
        }
        m.querySelectorAll('[data-tab]').forEach((b) => (b as HTMLElement).onclick = () => { tab = (b as HTMLElement).dataset.tab as typeof tab; this.audio.play('ui'); render(); });
      };
      render();
      return m;
    }, onClose, (code) => {
      const next = want(code);
      if (!next || next === tab) return false;
      tab = next;
      this.audio.play('ui');
      render();
      return true;
    });
  }

  /** The world map (WorldMap.ts): survey sheet, fog, markers, fast travel. */
  /** Where the world map was looking when it last closed. */
  lastMapView: MapViewState | null = null;
  openMap(o: Omit<WorldMapOpts, 'device' | 'hint' | 'sound'>, onClose: () => void) {
    this.audio.play('ui');
    const dev = device();
    const pill = (c: string) => `<span class="pg pill">${padName(c)}</span>`;
    const face = (c: string, i: number) => `<span class="pg face f${i}">${padName(c)}</span>`;
    const hint = dev === 'pad'
      ? `Left stick pan · right stick zoom · ${pill('P4')} ${pill('P5')} places · ${face('P3', 3)} you · ${face('P2', 2)} travel · ${actionGlyph('map', 'pad')} / ${face('P1', 1)} close`
      : `${kk('forward')}${kk('left')}${kk('back')}${kk('right')} or drag: pan · wheel or <span class="kbd">Q</span><span class="kbd">E</span>: zoom · <span class="kbd">C</span> you · <span class="kbd">[</span><span class="kbd">]</span> places · ${kk('map')} close`;
    let stop = () => {};
    this.openModal((close) => {
      const r = buildWorldMap(this.map!, { ...o, device: dev, hint, sound: (n) => this.audio.play(n), keepView: (v) => (this.lastMapView = v) }, close);
      stop = r.stop;
      return r.el;
    }, () => { stop(); onClose(); });
  }

  showIntel(title: string, body: string, reveal: string, onClose: () => void) {
    this.claimItems(reveal);
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
          <span>Difficulty</span><select data-k="difficulty">${(['story', 'normal', 'hard'] as const).map((d) => `<option value="${d}" ${(settings.difficulty ?? 'normal') === d ? 'selected' : ''}>${DIFFICULTY[d].label.toUpperCase()} · ${({ story: 'forgiving', normal: 'as intended', hard: 'brutal' })[d]}</option>`).join('')}</select>
          <span>Graphics</span><select data-k="quality">${['low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}" ${settings.quality === q ? 'selected' : ''}>${q.toUpperCase()}</option>`).join('')}</select>
          <span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-k="master" value="${settings.master}">
          <span>Music</span><input type="range" min="0" max="1" step="0.05" data-k="music" value="${settings.music}">
          <span>Effects</span><input type="range" min="0" max="1" step="0.05" data-k="sfx" value="${settings.sfx}">
          <span>${isTouch ? 'Look sensitivity' : 'Mouse sensitivity'}</span><input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity" value="${settings.sensitivity}">
          <span>Voices</span><select data-k="voice"><option value="1" ${settings.voice ? 'selected' : ''}>ON</option><option value="0" ${settings.voice ? '' : 'selected'}>OFF (subtitles only)</option></select>
          <span>Field of view <b class="val" data-v="fov"></b></span><input type="range" min="50" max="90" step="1" data-k="fov" value="${settings.fov}">
          <span>Head bob</span><input type="range" min="0" max="1" step="0.1" data-k="bob" value="${settings.bob}">
          ${isTouch ? '' : `<span>Invert look</span><select data-k="invertY"><option value="0" ${settings.invertY ? '' : 'selected'}>OFF</option><option value="1" ${settings.invertY ? 'selected' : ''}>ON (pull back to look up)</option></select>`}
          <span>FPS counter</span><select data-k="showFps"><option value="0" ${settings.showFps ? '' : 'selected'}>OFF</option><option value="1" ${settings.showFps ? 'selected' : ''}>ON</option></select>
          ${isTouch ? '' : '<span>Keys & controller</span><button class="btn to-controls">Controls…</button>'}
        </div>
        <button class="btn primary done">Done</button>
      </div>`;
    ov.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = (inp as HTMLElement).dataset.k as keyof Settings;
        const v = (inp as HTMLInputElement).value;
        const next = { ...settings } as Record<string, unknown>;
        next[k] = k === 'quality' || k === 'difficulty' ? v : k === 'voice' || k === 'invertY' || k === 'showFps' ? v === '1' : Number(v);
        Object.assign(settings, next);
        onChange(settings);
        fovLabel();
      });
    });
    // three.js counts the vertical angle; players know the horizontal one, so show that (at this window's shape)
    const fovLabel = () => {
      const el = ov.querySelector('[data-v="fov"]');
      const hor = 2 * Math.atan(Math.tan((settings.fov * Math.PI) / 360) * (innerWidth / Math.max(1, innerHeight)));
      if (el) el.textContent = `${Math.round((hor * 180) / Math.PI)}°`;
    };
    fovLabel();
    const esc = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      // the Controls screen over this one handles its own Escape
      const overlays = this.root.querySelectorAll(':scope > .overlay');
      if (overlays[overlays.length - 1] !== ov) return;
      e.stopPropagation();
      done();
    };
    const done = () => { ov.remove(); window.removeEventListener('keydown', esc, true); };
    window.addEventListener('keydown', esc, true);
    (ov.querySelector('.done') as HTMLElement).onclick = done;
    const toControls = ov.querySelector('.to-controls') as HTMLElement | null;
    if (toControls) toControls.onclick = () => { this.audio.play('ui'); this.showControls(); };
    this.root.appendChild(ov);
  }

  private fpsEl: HTMLElement | null = null;
  private fpsN = 0;
  private fpsT = 0;

  /** Settings → FPS counter. */
  showFps(on: boolean) {
    if (on && !this.fpsEl) {
      this.fpsEl = h('div', 'fps-counter', '');
      this.root.appendChild(this.fpsEl);
      this.fpsN = 0;
      this.fpsT = 0;
    } else if (!on && this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
    }
  }

  /** Called once per rendered frame; touches the DOM twice a second at most. */
  tickFps(now: number) {
    if (!this.fpsEl) return;
    this.fpsN++;
    if (!this.fpsT) this.fpsT = now;
    if (now - this.fpsT < 500) return;
    this.fpsEl.textContent = `${Math.round((this.fpsN * 1000) / (now - this.fpsT))} FPS`;
    this.fpsN = 0;
    this.fpsT = now;
  }

  resumeHint(show: boolean) {
    let el = document.querySelector('.resume-hint') as HTMLElement | null;
    if (show && !el) {
      el = h('div', 'resume-hint', isTouch ? 'Tap to resume' : 'Click to resume');
      this.root.appendChild(el);
    } else if (!show && el) el.remove();
  }

  // ------------------------------------------------------------------ story panels
  /**
   * The card header: monogram, name, and what they are to you. People come from content/people;
   * anything else (a note, a door, paint on a rock) gets a plain tag.
   */
  private speakerHead(speaker: string) {
    const [name, channel] = speaker.split(' · ');
    const p = PEOPLE.find((x) => x.name === name || (name === 'Wick' && x.id === 'wick'));
    if (!p) return `<div class="spk thing"><span class="mono" style="--pc:#c896ff">${esc(name.slice(0, 1))}</span><div><b>${esc(name)}</b><small>${esc(channel ?? 'Up close')}</small></div></div>`;
    const rep = this.state?.rep(p.id) ?? 0;
    const onAir = p.id === 'mara' || p.id === 'vesper' || p.id === 'hollis' || p.id === 'pip' || p.id === 'dez';
    const radio = channel && channel !== p.role ? channel : p.id === 'mara' || p.id === 'vesper' ? 'On the air' : onAir ? 'At the fire' : p.place;
    const intrude = p.id === 'vesper' ? '<i class="carrier">Unknown carrier</i>' : '';
    const standing = p.faction || p.id === 'vesper' || p.id === 'tanner' ? '' : `<span class="st">${STANDING_WORD[standingTier(rep)]}${standingPips(rep)}</span>`;
    return `<div class="spk ${p.id === 'vesper' ? 'intrude' : ''}">${monogram(p.id, p.name)}<div><b>${esc(p.name)}${intrude}</b><small>${esc(p.role)} · ${esc(radio)}</small></div>${standing}</div>`;
  }

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
        this.audio.hush();
        resolve();
      };
      const paint = () => {
        const page = pages[i];
        void this.audio.speak(page.speaker, page.text);
        const last = i >= pages.length - 1;
        panel.classList.toggle('intrude', page.speaker.startsWith('Vesper'));
        panel.innerHTML = `<div class="scan"></div>
          ${this.speakerHead(page.speaker)}
          <p>${esc(page.text)}</p>
          <div class="brief-foot">
            <span class="dots">${pages.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'past' : ''}"></i>`).join('')}</span>
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
        if (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'Escape' && !binds.is(e.code, 'interact')) return;
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
      void this.audio.speak(speaker, text);
      panel.classList.toggle('intrude', speaker.startsWith('Vesper'));
      panel.innerHTML = `<div class="scan"></div>
        ${this.speakerHead(speaker)}
        <p>${esc(text).replace(/\n/g, '<br>')}</p>
        <div class="choices">${(() => { let n = 0; return choices.map((c) => `<button class="btn choice" data-id="${esc(c.id)}" ${c.disabled ? 'disabled' : ''}><span class="n">${c.disabled ? '·' : ++n}</span><span><b>${esc(c.label)}</b>${c.disabled ? `<small>${esc(c.disabled)}</small>` : ''}</span></button>`).join(''); })()}</div>
        <div class="brief-foot"><span>Esc ${speaker.includes('Tanner') ? 'hangs up' : 'leaves'}</span><span>${enabled.length ? 'Number keys work' : ''}</span></div>`;
      panel.querySelectorAll('.choice').forEach((b) => {
        const btn = b as HTMLButtonElement;
        if (btn.disabled) return;
        btn.onclick = () => { this.audio.play('uiConfirm'); finish(btn.dataset.id ?? null); };
      });
    };
    const finish = (id: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      ov.remove();
      this.audio.hush();
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

  /**
   * The camp: rest, craft, the people at the fire, and the radio. Resolves 'radio', 'closed',
   * or the id of the person you walked over to (Game runs the talk and reopens the panel).
   */
  camp(opts: {
    radioLabel: string;
    radioDisabled?: string;
    people: { id: string; name: string; role: string }[];
    onRest: () => void;
    onCraft: (id: string) => string | null;
    recipes: { id: string; name: string; detail: string; disabled?: string; group?: string }[];
  }): Promise<string> {
    this.modalOpen = true;
    this.audio.play('ui');
    const ov = h('div', 'overlay');
    const panel = h('div', 'panel camp-panel modal interactive');
    ov.appendChild(panel);
    this.root.appendChild(ov);
    let note = 'Resting saves your game and patches you up a little. A full heal from one rest takes Survival 5.';
    let rgroup = '';
    return new Promise((resolve) => {
      const finish = (why: string) => {
        window.removeEventListener('keydown', onKey, true);
        ov.remove();
        this.modalOpen = false;
        resolve(why);
      };
      // recipes in tabs by group (Tools, Ammunition, …), each tab counting what you can make right now
      const recipeTabs = () => {
        const groups = [...new Set(opts.recipes.map((r) => r.group ?? ''))];
        if (!groups.includes(rgroup)) rgroup = groups.find((g) => opts.recipes.some((r) => (r.group ?? '') === g && !r.disabled)) ?? groups[0] ?? '';
        if (groups.length < 2) return '';
        return `<div class="recipe-tabs">${groups.map((g) => {
          const n = opts.recipes.filter((r) => (r.group ?? '') === g && !r.disabled).length;
          return `<button class="tab rtab ${g === rgroup ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}${n ? `<i class="tab-dot">${n}</i>` : ''}</button>`;
        }).join('')}</div>`;
      };
      const paint = () => {
        const people = opts.people.map((p) => {
          const rep = this.state?.rep(p.id as never) ?? 0;
          return `<button class="camp-person" data-person="${esc(p.id)}">${monogram(p.id as never, p.name)}<span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span>${standingPips(rep)}</button>`;
        }).join('');
        panel.innerHTML = `<div class="scan"></div>
          <header><h3>LAST CHANCE</h3><div class="label">Camp · ${esc(this.state?.dayLabel ?? 'Day 1,284')}</div></header>
          <div class="body camp-body">
            <div class="camp-col">
              <p class="camp-note">${esc(note)}</p>
              <div class="camp-actions">
                <button class="btn primary rest">Rest and save</button>
                <button class="btn radio" ${opts.radioDisabled ? 'disabled' : ''}>${esc(opts.radioLabel)}</button>
                <button class="btn travel">Map · travel</button>
              </div>
              ${opts.radioDisabled ? `<p class="hint">${esc(opts.radioDisabled)}</p>` : ''}
              <div class="label" style="margin-top:18px">Around the fire</div>
              <div class="camp-people">${people}</div>
            </div>
            <div class="camp-col">
              <div class="label">Work the scrap</div>
              ${recipeTabs()}
              <div class="recipes">${opts.recipes.filter((r) => (r.group ?? '') === rgroup).map((r) => `<div class="recipe"><div><b>${esc(r.name)}</b><span>${esc(r.detail)}</span>${r.disabled ? `<small>${esc(r.disabled)}</small>` : ''}</div><button class="btn craft" data-id="${esc(r.id)}" ${r.disabled ? 'disabled' : ''}>Make</button></div>`).join('')}</div>
            </div>
          </div>
          <footer><span class="kb"><span class="kbd">Esc</span> back to the fire</span></footer>`;
        (panel.querySelector('.rest') as HTMLButtonElement).onclick = () => { this.audio.play('uiConfirm'); opts.onRest(); note = 'You rest for a while by the fire. Saved.'; paint(); };
        const radio = panel.querySelector('.radio') as HTMLButtonElement;
        radio.onclick = () => { if (radio.disabled) return; this.audio.play('uiConfirm'); finish('radio'); };
        (panel.querySelector('.travel') as HTMLButtonElement).onclick = () => { this.audio.play('ui'); finish('travel'); };
        panel.querySelectorAll('.camp-person').forEach((b) => (b as HTMLButtonElement).onclick = () => { this.audio.play('ui'); finish((b as HTMLElement).dataset.person ?? 'closed'); });
        panel.querySelectorAll('.rtab').forEach((b) => (b as HTMLButtonElement).onclick = () => { rgroup = (b as HTMLElement).dataset.g ?? ''; this.audio.play('ui'); paint(); });
        panel.querySelectorAll('.craft').forEach((b) => (b as HTMLButtonElement).onclick = () => {
          const err = opts.onCraft((b as HTMLElement).dataset.id ?? '');
          this.audio.play(err ? 'deny' : 'uiConfirm');
          note = err ?? 'Done. It should work.';
          paint();
        });
        const x = h('button', 'btn close-x', '✕');
        x.setAttribute('aria-label', 'Close');
        x.onclick = () => { this.audio.play('ui'); finish('closed'); };
        panel.querySelector('header')!.appendChild(x);
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

  /** Inez's Till (Dry Creek): buy, sell, barter on her slate. */
  till(opts: TillOpts) {
    const ui = this;
    return openTill({ root: this.root, audio: this.audio, get modalOpen() { return ui.modalOpen; }, set modalOpen(v) { ui.modalOpen = v; }, refreshHotbar: () => this.refreshHotbar() }, this.state!, opts);
  }

  // ------------------------------------------------------------------ UIBridge minigames
  async lockpick(opts: { pins: number; title: string; onBreak: () => boolean }): Promise<LockResult> {
    this.minigameOpen = true;
    const g = new LockpickGame(this.root, this.audio, {
      ...opts,
      skill: this.state?.lockSkill() ?? 0,
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
    const r = await new CircuitGame(this.root, this.audio, { ...opts, skill: this.state?.boardSkill() ?? 0 }).run();
    this.minigameOpen = false;
    return r;
  }

  async hack(opts: Omit<HackOpts, 'skill'> & { skill?: number }): Promise<HackResult> {
    this.minigameOpen = true;
    try {
      return await new HackGame(this.root, this.audio, { ...opts, skill: opts.skill ?? this.state?.boardSkill() ?? 0 }).run();
    } finally {
      this.minigameOpen = false;
    }
  }
}
