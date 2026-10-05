// Shared content schema. Everything a designer touches lives in /content and conforms to these types.

export type SkillId = 'lockpicking' | 'electronics';
export type Vec3 = [number, number, number];

export interface SkillDef {
  id: SkillId;
  name: string;
  max: number;
  blurb: string;
  perLevel: string[]; // description of what each level grants (index = level)
}

export type ItemCategory = 'tool' | 'consumable' | 'loot' | 'intel';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  weight: number;
  stack: number;
  value: number;
  icon: string; // key into ui/icons
  description: string;
  flavor?: string;
  usable?: boolean;
}

export interface ArchetypeDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string; // CSS colour, also used for goggles/LEDs on the model
  skills: Record<SkillId, number>;
  stats: { stealth: number; speed: number; toughness: number };
  signature: { name: string; description: string };
  startingItems: { id: string; qty: number }[];
}

export type SolutionKind = 'stealth' | 'hack' | 'force' | 'social' | 'lockpick';

export interface Solution {
  kind: SolutionKind;
  label: string;
  requires?: { skills?: Partial<Record<SkillId, number>>; items?: string[]; intel?: string };
}

export interface Obstacle {
  id: string;
  kind: 'fence' | 'tripwire' | 'drone' | 'padlock' | 'keypad' | 'door' | 'camera' | 'puzzle';
  label: string;
  difficulty?: number; // pins for locks, etc.
}

export interface SecurityLayer {
  type: 'perimeter' | 'entry' | 'interior' | 'vault';
  title: string;
  obstacles: Obstacle[];
  solutions: Solution[];
}

export interface LootEntry { item: string; qty: [number, number]; chance: number }
export interface LootTable { guaranteed: { item: string; qty: number }[]; rolls: LootEntry[]; xp: number }

export interface IntelItem {
  id: string;
  title: string;
  body: string;
  position: Vec3; // world position (y resolved against terrain if 0)
  reveals?: string[]; // flags this intel unlocks, e.g. 'garage.marker'
  xp: number;
}

export interface Bunker {
  id: string;
  name: string;
  owner: { name: string; archetype: string; bio: string; taunts: string[] };
  tier: number;
  location: { biome: string; position: Vec3 };
  requirements: { skills?: Partial<Record<SkillId, number>>; items?: string[] };
  layers: SecurityLayer[];
  loot: LootTable;
  intel: IntelItem[];
}

export interface LandmarkDef {
  id: string;
  name: string;
  kind: 'gas-station' | 'radio-tower';
  position: Vec3;
  rotation: number;
  camp?: boolean;
  blurb: string;
}
