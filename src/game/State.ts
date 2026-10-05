import { ITEMS } from '@/content/items';
import { ARCHETYPES } from '@/content/archetypes';
import { SKILLS } from '@/content/skills';
import type { SkillId, Vec3, ArchetypeDef } from '@/content/types';
import { xpForLevel, SKILL_POINTS_PER_LEVEL, MAX_HEALTH, CARRY_LIMIT } from '@/content/progression';
import { EventBus } from '@/engine/events';

export interface SaveData {
  version: 1;
  archetype: string;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  health: number;
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
      version: 1,
      archetype: a.id,
      level: 1,
      xp: 0,
      skillPoints: 0,
      skills: { ...a.skills },
      health: MAX_HEALTH,
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
    return CARRY_LIMIT;
  }
  addItem(id: string, qty = 1, silent = false) {
    const def = ITEMS[id];
    if (!def) return 0;
    let slot = this.data.inventory.find((s) => s.id === id);
    if (!slot) {
      slot = { id, qty: 0 };
      this.data.inventory.push(slot);
    }
    slot.qty = Math.min(def.stack * 4, slot.qty + qty);
    if (!silent) this.events.emit('item', { id, qty });
    this.events.emit('inventoryChanged', {});
    return qty;
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
    const d = JSON.parse(raw) as SaveData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
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

export const DEFAULT_SETTINGS: Settings = { quality: 'high', master: 0.8, music: 0.5, sfx: 0.9, sensitivity: 1, voice: true };

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
