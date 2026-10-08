import { isMobile } from '@/engine/device';
import { ITEMS } from '@/content/items';
import { ARCHETYPES } from '@/content/archetypes';
import { SKILLS, emptySkills, FOCUSES, CAPSTONES, SKILL_ORDER, FOCUS_RANK, CAPSTONE_RANK } from '@/content/skills';
import { RECIPES, type Recipe } from '@/content/craft';
import { favours } from '@/content/quests';
import type { SkillId, Vec3, ArchetypeDef, PersonId } from '@/content/types';
import {
  xpForLevel, SKILL_POINTS_PER_LEVEL, MAX_HEALTH, NEED_MAX, BASE_CARRY,
  THIRST_PER_SEC, HUNGER_PER_SEC, needDrain, foodBonus, survivalCarry,
} from '@/content/progression';
import { EventBus } from '@/engine/events';
import type { WeaponId, Difficulty } from '@/content/weapons';

/** What you dropped where you fell: walk back for it. A second death loses it. */
export interface DroppedPack {
  position: Vec3;
  items: { id: string; qty: number }[];
  /** Game day it was dropped (for the journal line). */
  day: number;
}

export interface SaveData {
  version: 3;
  archetype: string;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  /** One focus id per skill (rank 2). Absent means the branch is still open. */
  focuses: Partial<Record<SkillId, string>>;
  /** One capstone id per skill (rank 4). v3. */
  capstones: Partial<Record<SkillId, string>>;
  /** Standing with people and places, roughly -3..+4. v3. */
  rep: Partial<Record<PersonId, number>>;
  /** Quest id pinned to the corner of the screen, or '' for the main story. v3. */
  tracked: string;
  /** Rests at the fire so far. Once-per-rest favours remember the count they were last used at. v3. */
  rests: number;
  marks: Record<string, number>;
  health: number;
  /** 0 empty, 100 fine. */
  hunger: number;
  thirst: number;
  inventory: { id: string; qty: number }[];
  position: Vec3;
  yaw: number;
  hour: number;
  flags: string[];
  discovered: string;
  stats: { picks: number; caught: number; playTime: number; busted: number; kills?: number; deaths?: number };
  savedAt: number;
  /** v0.5: the weapon in hand and the rounds loaded in each gun. */
  arms?: { equipped: WeaponId | null; mags: Partial<Record<WeaponId, number>> };
  /** v0.5: the pack you dropped when you went down. */
  pack?: DroppedPack | null;
  /** v0.5: venom in the blood (seconds of poison left). */
  poison?: number;
  /** v0.5.6: midnights passed since the run began (the calendar starts at Day 1,284). */
  days?: number;
}

/** The day Mara hands over the radio. */
export const START_DAY = 1284;

export type GameEvents = {
  toast: { text: string; kind?: 'info' | 'good' | 'bad' | 'xp' };
  xp: { amount: number; reason: string };
  levelup: { level: number };
  item: { id: string; qty: number };
  intel: { title: string; body: string };
  objective: { text: string };
  health: { value: number; delta: number };
  taunt: { speaker: string; text: string };
  caught: { reason: string };
  flag: { flag: string };
  rep: { id: PersonId; delta: number; value: number };
  inventoryChanged: Record<string, never>;
  bunkerComplete: { id: string };
};

/** All mutable progression. Systems talk to it, UI listens to its events. */
export class GameState {
  readonly events = new EventBus<GameEvents>();
  data: SaveData;

  constructor(data: SaveData) {
    this.data = data;
  }

  static fresh(archetypeId: string, spawn: Vec3): GameState {
    const a = ARCHETYPES.find((x) => x.id === archetypeId) ?? ARCHETYPES[0];
    return new GameState({
      version: 3,
      archetype: a.id,
      level: 1,
      xp: 0,
      skillPoints: 1,
      skills: { ...emptySkills(), ...a.skills },
      focuses: {},
      capstones: {},
      rep: {},
      tracked: '',
      rests: 0,
      marks: {},
      health: MAX_HEALTH,
      hunger: 82,
      thirst: 76,
      inventory: a.startingItems.map((s) => ({ ...s })),
      position: spawn,
      yaw: 0,
      hour: 17.1,
      flags: [],
      discovered: '',
      stats: { picks: 0, caught: 0, playTime: 0, busted: 0, kills: 0, deaths: 0 },
      savedAt: Date.now(),
      arms: { equipped: null, mags: {} },
      pack: null,
      poison: 0,
      days: 0,
    });
  }

  private archCache: { key: string; def: ArchetypeDef } | null = null;

  /**
   * The person you picked, with stats as they stand now. Shadow (Stealth capstone) makes you
   * quieter to SeedBot, which reads `archetype.stats.stealth`. Cached: the drone asks every frame.
   */
  get archetype(): ArchetypeDef {
    const base = ARCHETYPES.find((x) => x.id === this.data.archetype) ?? ARCHETYPES[0];
    const shadow = this.capstone('stealth') === 'shadow';
    const key = `${base.id}|${shadow}`;
    if (this.archCache?.key !== key) {
      const def = shadow ? { ...base, stats: { ...base.stats, stealth: base.stats.stealth * 0.75 } } : base;
      this.archCache = { key, def };
    }
    return this.archCache.def;
  }

  /** "Day 1,285": the calendar, from the morning of the briefing. */
  get dayLabel() {
    return `Day ${(START_DAY + (this.data.days ?? 0)).toLocaleString('en-US')}`;
  }

  // ---------- flags ----------
  has(flag: string) {
    return this.data.flags.includes(flag);
  }
  set(flag: string) {
    if (this.has(flag)) return false;
    this.data.flags.push(flag);
    this.events.emit('flag', { flag });
    return true;
  }

  // ---------- skills ----------
  skill(id: SkillId) {
    return this.data.skills[id] ?? 0;
  }
  spendPoint(id: SkillId) {
    if (this.data.skillPoints <= 0 || this.skill(id) >= SKILLS[id].max) return false;
    this.data.skills[id] = this.skill(id) + 1;
    this.data.skillPoints--;
    this.events.emit('toast', { text: `${SKILLS[id].name} → ${this.data.skills[id]}`, kind: 'good' });
    return true;
  }
  /** The branch bought for this skill, or ''. */
  focus(id: SkillId) {
    return this.data.focuses[id] ?? '';
  }
  /** Spend a point on one focus. Rank stays put. The other focus for that skill closes. */
  spendFocus(focusId: string) {
    const def = FOCUSES.find((f) => f.id === focusId);
    if (!def || this.data.skillPoints <= 0) return false;
    if (this.skill(def.skill) < FOCUS_RANK || this.focus(def.skill)) return false;
    this.data.focuses[def.skill] = def.id;
    this.data.skillPoints--;
    this.events.emit('toast', { text: `${def.name}. ${SKILLS[def.skill].name} takes a shape.`, kind: 'good' });
    return true;
  }
  /** The capstone bought for this skill, or ''. */
  capstone(id: SkillId) {
    return this.data.capstones[id] ?? '';
  }
  /** Rank 4's branch. Same rules as a focus: a point, no rank, the twin closes. */
  spendCapstone(capId: string) {
    const def = CAPSTONES.find((f) => f.id === capId);
    if (!def || this.data.skillPoints <= 0) return false;
    if (this.skill(def.skill) < CAPSTONE_RANK || this.capstone(def.skill)) return false;
    this.data.capstones[def.skill] = def.id;
    this.data.skillPoints--;
    this.archCache = null;
    this.events.emit('toast', { text: `${def.name}. ${SKILLS[def.skill].name} is finished.`, kind: 'good' });
    return true;
  }
  /** What a lockpick minigame plays at. Master's Hands plays every lock at rank 5. */
  lockSkill() {
    return this.capstone('lockpicking') === 'master' ? 5 : this.skill('lockpicking');
  }
  /** What a bypass board plays at. Overclock plays every board at rank 5. */
  boardSkill() {
    return this.capstone('electronics') === 'overclock' ? 5 : this.skill('electronics');
  }

  // ---------- standing ----------
  rep(id: PersonId) {
    return this.data.rep[id] ?? 0;
  }
  addRep(id: PersonId, delta: number) {
    if (!delta) return;
    const value = Math.max(-3, Math.min(4, this.rep(id) + delta));
    this.data.rep[id] = value;
    this.events.emit('rep', { id, delta, value });
  }
  /** Standing favours from finished quests (content/quests.ts `favours`). */
  favours() {
    return favours(this);
  }
  /** Once-per-rest favours (Nia's plate, Doc's house calls, Wick's seep). */
  favourReady(key: string) {
    return this.data.marks[key] !== this.data.rests;
  }
  useFavour(key: string) {
    this.data.marks[key] = this.data.rests;
  }

  // ---------- xp ----------
  get xpToNext() {
    return xpForLevel(this.data.level);
  }
  addXP(amount: number, reason: string) {
    this.data.xp += amount;
    this.events.emit('xp', { amount, reason });
    while (this.data.xp >= this.xpToNext) {
      this.data.xp -= this.xpToNext;
      this.data.level++;
      this.data.skillPoints += SKILL_POINTS_PER_LEVEL;
      this.events.emit('levelup', { level: this.data.level });
    }
  }

  // ---------- body ----------
  /** Accumulates fractional starvation damage so a slow drain still lands. Not saved. */
  private needHurt = 0;

  /** Hunger and thirst. Menus should not call this — reading isn't metabolizing. */
  tickNeeds(dt: number) {
    let m = needDrain(this.skill('survival'));
    if (this.capstone('survival') === 'camel') m *= 0.65;
    if (this.archetype.perk === 'trail') m *= 0.75;
    this.data.thirst = Math.max(0, this.data.thirst - THIRST_PER_SEC * m * dt);
    this.data.hunger = Math.max(0, this.data.hunger - HUNGER_PER_SEC * m * dt);
    const worst = Math.min(this.data.hunger, this.data.thirst);
    if (worst < 25) {
      this.needHurt += (worst < 10 ? 1.15 : 0.4) * dt;
      if (this.needHurt >= 1) {
        const n = Math.floor(this.needHurt);
        this.needHurt -= n;
        this.damage(n);
      }
    } else this.needHurt = 0;
  }

  /** Eat or drink. Survival 2 makes both do more. Returns the health actually gained. */
  satisfy(hunger: number, thirst: number, heal = 0) {
    let b = foodBonus(this.skill('survival'));
    if (this.focus('survival') === 'kitchen') b *= 1.15;
    this.data.hunger = Math.min(NEED_MAX, this.data.hunger + hunger * b);
    this.data.thirst = Math.min(NEED_MAX, this.data.thirst + thirst * b);
    const hp = Math.round(heal * b);
    if (hp) this.heal(hp);
    return hp;
  }

  /** A real rest. Survival 5 is the only rank that puts you all the way back. */
  restAtFire() {
    this.data.rests++;
    const sv = this.skill('survival');
    if (sv >= 5) {
      this.data.health = MAX_HEALTH;
      this.data.hunger = NEED_MAX;
      this.data.thirst = NEED_MAX;
      this.events.emit('health', { value: this.data.health, delta: 0 });
      return;
    }
    this.heal(30 + sv * 4);
    this.data.hunger = Math.min(NEED_MAX, this.data.hunger + 22);
    this.data.thirst = Math.min(NEED_MAX, this.data.thirst + 22);
    if (this.focus('survival') === 'hardrest') {
      this.heal(18);
      this.data.hunger = Math.min(NEED_MAX, this.data.hunger + 12);
      this.data.thirst = Math.min(NEED_MAX, this.data.thirst + 12);
    }
  }

  // ---------- health ----------
  damage(amount: number) {
    let mult = 1 / this.archetype.stats.toughness;
    if (this.capstone('demolition') === 'blastproof') mult *= 0.75;
    const d = Math.round(amount * mult);
    this.data.health = Math.max(0, this.data.health - d);
    this.events.emit('health', { value: this.data.health, delta: -d });
  }
  heal(amount: number) {
    const before = this.data.health;
    this.data.health = Math.min(MAX_HEALTH, this.data.health + amount);
    this.events.emit('health', { value: this.data.health, delta: this.data.health - before });
  }

  // ---------- inventory ----------
  count(id: string) {
    return this.data.inventory.find((s) => s.id === id)?.qty ?? 0;
  }
  get weight() {
    return this.data.inventory.reduce((w, s) => w + (ITEMS[s.id]?.weight ?? 0) * s.qty, 0);
  }
  get carryLimit() {
    return BASE_CARRY + survivalCarry(this.skill('survival')) + this.archetype.carry + (this.capstone('survival') === 'packrat' ? 6 : 0);
  }

  /**
   * Returns how many were actually added.
   * `force` is for story loot (the water, the manifest): it comes with you even if the pack complains.
   */
  addItem(id: string, qty = 1, silent = false, force = false) {
    const def = ITEMS[id];
    if (!def) return 0;
    let slot = this.data.inventory.find((s) => s.id === id);
    const cap = def.stack * 4;
    let added = 0;
    for (let i = 0; i < qty; i++) {
      const have = slot?.qty ?? 0;
      if (have >= cap) break;
      if (!force && def.weight > 0 && this.weight + def.weight > this.carryLimit + 0.05) break;
      if (!slot) {
        slot = { id, qty: 0 };
        this.data.inventory.push(slot);
      }
      slot.qty++;
      added++;
    }
    if (added > 0 && !silent) this.events.emit('item', { id, qty: added });
    if (!silent && added < qty) {
      this.events.emit('toast', { text: `${def.name}: the pack won't take the rest. Drop something.`, kind: 'bad' });
    }
    if (added > 0 || added < qty) this.events.emit('inventoryChanged', {});
    return added;
  }

  /** How many a recipe makes for you: Sol's lesson bends a third pick, Bench Chemist packs a second charge. */
  craftYield(r: Recipe) {
    let n = r.out.qty;
    if (r.id === 'picks' && favours(this).solLesson) n += 1;
    if (r.id === 'charge' && this.capstone('demolition') === 'chemist') n *= 2;
    return n;
  }

  /** Campfire recipes. Null means it worked. A string is the reason it didn't. */
  craft(id: string): string | null {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) return 'No such recipe.';
    if (recipe.skill && this.skill(recipe.skill.id) < recipe.skill.level) {
      return `Requires ${SKILLS[recipe.skill.id].name} ${recipe.skill.level}.`;
    }
    for (const n of recipe.need) {
      if (this.count(n.id) < n.qty) return `Need ${n.qty}× ${ITEMS[n.id]?.name ?? n.id}.`;
    }
    for (const n of recipe.need) this.removeItem(n.id, n.qty);
    const want = this.craftYield(recipe);
    const got = this.addItem(recipe.out.id, want);
    if (got < want) {
      this.removeItem(recipe.out.id, got);
      for (const n of recipe.need) this.addItem(n.id, n.qty, true, true);
      return 'Too heavy, even after spending the parts.';
    }
    return null;
  }
  removeItem(id: string, qty = 1) {
    const slot = this.data.inventory.find((s) => s.id === id);
    if (!slot || slot.qty < qty) return false;
    slot.qty -= qty;
    if (slot.qty <= 0) this.data.inventory = this.data.inventory.filter((s) => s !== slot);
    this.events.emit('inventoryChanged', {});
    return true;
  }
}

// ---------- persistence ----------
const SAVE_KEY = 'bunker-busters.save.v1';
const SETTINGS_KEY = 'bunker-busters.settings.v1';

export function saveGame(state: GameState) {
  state.data.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state.data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readFocuses(raw: unknown): Partial<Record<SkillId, string>> {
  const src = (raw as { focuses?: unknown }).focuses;
  const out: Partial<Record<SkillId, string>> = {};
  if (!src || typeof src !== 'object') return out;
  for (const id of SKILL_ORDER) {
    const v = (src as Record<string, unknown>)[id];
    if (typeof v === 'string' && FOCUSES.some((f) => f.id === v && f.skill === id)) out[id] = v;
  }
  return out;
}

function readCapstones(raw: unknown): Partial<Record<SkillId, string>> {
  const src = (raw as { capstones?: unknown }).capstones;
  const out: Partial<Record<SkillId, string>> = {};
  if (!src || typeof src !== 'object') return out;
  for (const id of SKILL_ORDER) {
    const v = (src as Record<string, unknown>)[id];
    if (typeof v === 'string' && CAPSTONES.some((f) => f.id === v && f.skill === id)) out[id] = v;
  }
  return out;
}

function readNumbers(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

const ACT1_ENDINGS = ['act1.broadcast', 'act1.leverage', 'act1.deal'];

/**
 * v1 predates hunger, thirst and four of the six skills. v2 predates capstones, standing and quests.
 * Keep the run: every missing field gets a default. Quest progress is rebuilt from flags on load
 * (Story.sync), so an old save picks up the quests it already finished without replaying them.
 */
function migrateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SaveData> & { skills?: Partial<Record<SkillId, number>> };
  const version = (raw as { version?: number }).version;
  if (version !== 1 && version !== 2 && version !== 3) return null;
  if (!d.archetype || !d.inventory || !d.position) return null;
  const flags = [...(d.flags ?? [])];
  if (flags.includes('intro') && !flags.includes('briefed')) flags.push('briefed');
  // a v2 run that already heard the debrief ended Act I before the choice existed: Mara read the names
  if (flags.includes('debriefed') && !ACT1_ENDINGS.some((f) => flags.includes(f))) flags.push('act1.broadcast');
  const inventory = [...d.inventory];
  if (version !== 3) {
    // Things v2 looted before they carried a story: hand over the quest item, or count the choice as made.
    const give = (id: string) => { if (!inventory.some((s) => s.id === id)) inventory.push({ id, qty: 1 }); };
    if (flags.includes('creek.motel.b.loot')) give('sol_roll');
    if (flags.includes('creek.loft')) give('deed');
    if (flags.includes('cave.pocket.loot')) flags.push('q.wick.took');
    if (!flags.includes('migrated.v3')) flags.push('migrated.v3');
  }
  return {
    version: 3,
    archetype: ARCHETYPES.some((a) => a.id === d.archetype) ? d.archetype : ARCHETYPES[0].id,
    level: d.level ?? 1,
    xp: d.xp ?? 0,
    skillPoints: d.skillPoints ?? 0,
    skills: { ...emptySkills(), ...(d.skills ?? {}) },
    focuses: readFocuses(raw),
    capstones: readCapstones(raw),
    rep: readNumbers((raw as { rep?: unknown }).rep) as Partial<Record<PersonId, number>>,
    tracked: typeof d.tracked === 'string' ? d.tracked : '',
    rests: typeof d.rests === 'number' ? d.rests : 0,
    marks: readNumbers((raw as { marks?: unknown }).marks),
    health: d.health ?? MAX_HEALTH,
    hunger: d.hunger ?? 78,
    thirst: d.thirst ?? 72,
    inventory,
    position: d.position,
    yaw: d.yaw ?? 0,
    hour: d.hour ?? 17.1,
    flags,
    discovered: d.discovered ?? '',
    stats: d.stats ?? { picks: 0, caught: 0, playTime: 0, busted: 0 },
    savedAt: d.savedAt ?? Date.now(),
    arms: d.arms ?? { equipped: null, mags: {} },
    pack: d.pack ?? null,
    poison: d.poison ?? 0,
    days: typeof d.days === 'number' && d.days >= 0 ? Math.floor(d.days) : 0,
  };
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export interface Settings {
  quality: 'low' | 'medium' | 'high' | 'ultra';
  difficulty: Difficulty;
  master: number;
  music: number;
  sfx: number;
  sensitivity: number;
  /** Spoken lines (pre-rendered voices, src/engine/voice.ts). Off = subtitles only. */
  voice: boolean;
  /** v0.5.1: the old speech-synthesis taunts went off by default. */
  voiceOff051?: boolean;
  /** v0.5.2: `voice` now means real recorded-style voices, on for everyone once. */
  voiceOn052?: boolean;
  /** v0.5.6: vertical field of view in degrees, as three.js counts it (the menu shows the horizontal). */
  fov: number;
  /** v0.5.6: pull the mouse back to look up. */
  invertY: boolean;
  /** v0.5.6: walking head bob and strafe roll, 0..1 (motion comfort). */
  bob: number;
  /** v0.5.6: a small frames-per-second readout in the corner. */
  showFps: boolean;
}

// phones start on Low: a phone GPU at native resolution under the full post stack crawls
export const DEFAULT_SETTINGS: Settings = { quality: isMobile ? 'low' : 'high', difficulty: 'normal', master: 0.8, music: 0.5, sfx: 0.9, sensitivity: 1, voice: true, voiceOff051: true, voiceOn052: true, fov: 64, invertY: false, bob: 1, showFps: false };

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const s: Settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...DEFAULT_SETTINGS, ...parsed } : { ...DEFAULT_SETTINGS };
    // once: the setting used to switch robot speech; now it switches the new voices, which start on
    if (!s.voiceOn052) { s.voice = true; s.voiceOff051 = true; s.voiceOn052 = true; }
    // older saves lack the v0.5.6 fields (the defaults fill them); a hand-edited or corrupt value is clamped
    // an unknown quality or difficulty would stop the game from booting at all (makeQuality, DIFFICULTY)
    if (!['low', 'medium', 'high', 'ultra'].includes(s.quality)) s.quality = DEFAULT_SETTINGS.quality;
    if (!['story', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = DEFAULT_SETTINGS.difficulty;
    s.master = num(s.master, 0, 1, DEFAULT_SETTINGS.master);
    s.music = num(s.music, 0, 1, DEFAULT_SETTINGS.music);
    s.sfx = num(s.sfx, 0, 1, DEFAULT_SETTINGS.sfx);
    s.voice = s.voice !== false;
    s.fov = num(s.fov, 50, 90, DEFAULT_SETTINGS.fov);
    s.bob = num(s.bob, 0, 1, DEFAULT_SETTINGS.bob);
    s.sensitivity = num(s.sensitivity, 0.1, 5, DEFAULT_SETTINGS.sensitivity);
    s.invertY = s.invertY === true;
    s.showFps = s.showFps === true;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
