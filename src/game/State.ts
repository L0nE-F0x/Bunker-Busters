import { isMobile } from '@/engine/device';
import { ITEMS } from '@/content/items';
import { ARCHETYPES } from '@/content/archetypes';
import { SKILLS, emptySkills, FOCUSES, SKILL_ORDER } from '@/content/skills';
import { RECIPES } from '@/content/craft';
import type { SkillId, Vec3, ArchetypeDef } from '@/content/types';
import {
  xpForLevel, SKILL_POINTS_PER_LEVEL, MAX_HEALTH, NEED_MAX, BASE_CARRY,
  THIRST_PER_SEC, HUNGER_PER_SEC, needDrain, foodBonus, survivalCarry,
} from '@/content/progression';
import { EventBus } from '@/engine/events';

export interface SaveData {
  version: 2;
  archetype: string;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  /** One focus id per skill. Absent means the branch is still open. */
  focuses: Partial<Record<SkillId, string>>;
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
  stats: { picks: number; caught: number; playTime: number; busted: number };
  savedAt: number;
}

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
      version: 2,
      archetype: a.id,
      level: 1,
      xp: 0,
      skillPoints: 1,
      skills: { ...emptySkills(), ...a.skills },
      focuses: {},
      health: MAX_HEALTH,
      hunger: 82,
      thirst: 76,
      inventory: a.startingItems.map((s) => ({ ...s })),
      position: spawn,
      yaw: 0,
      hour: 17.1,
      flags: [],
      discovered: '',
      stats: { picks: 0, caught: 0, playTime: 0, busted: 0 },
      savedAt: Date.now(),
    });
  }

  get archetype(): ArchetypeDef {
    return ARCHETYPES.find((x) => x.id === this.data.archetype) ?? ARCHETYPES[0];
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
    if (this.skill(def.skill) < 2 || this.focus(def.skill)) return false;
    this.data.focuses[def.skill] = def.id;
    this.data.skillPoints--;
    this.events.emit('toast', { text: `${def.name}. ${SKILLS[def.skill].name} takes a shape.`, kind: 'good' });
    return true;
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
    const m = needDrain(this.skill('survival'));
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
    const mult = 1 / this.archetype.stats.toughness;
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
    return BASE_CARRY + survivalCarry(this.skill('survival')) + this.archetype.carry;
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
    const got = this.addItem(recipe.out.id, recipe.out.qty);
    if (got < recipe.out.qty) {
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

/** v1 saves predate hunger, thirst, and four of the six skills. Keep the run. */
function migrateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SaveData> & { skills?: Partial<Record<SkillId, number>> };
  const version = (raw as { version?: number }).version;
  if (version !== 1 && version !== 2) return null;
  if (!d.archetype || !d.inventory || !d.position) return null;
  const flags = [...(d.flags ?? [])];
  if (flags.includes('intro') && !flags.includes('briefed')) flags.push('briefed');
  return {
    version: 2,
    archetype: d.archetype,
    level: d.level ?? 1,
    xp: d.xp ?? 0,
    skillPoints: d.skillPoints ?? 0,
    skills: { ...emptySkills(), ...(d.skills ?? {}) },
    focuses: readFocuses(raw),
    health: d.health ?? MAX_HEALTH,
    hunger: d.hunger ?? 78,
    thirst: d.thirst ?? 72,
    inventory: d.inventory,
    position: d.position,
    yaw: d.yaw ?? 0,
    hour: d.hour ?? 17.1,
    flags,
    discovered: d.discovered ?? '',
    stats: d.stats ?? { picks: 0, caught: 0, playTime: 0, busted: 0 },
    savedAt: d.savedAt ?? Date.now(),
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
  master: number;
  music: number;
  sfx: number;
  sensitivity: number;
  voice: boolean;
}

// phones start on Low: a phone GPU at native resolution under the full post stack crawls
export const DEFAULT_SETTINGS: Settings = { quality: isMobile ? 'low' : 'high', master: 0.8, music: 0.5, sfx: 0.9, sensitivity: 1, voice: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
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
