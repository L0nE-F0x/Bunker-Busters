// Shared content schema. Everything a designer touches lives in /content and conforms to these types.

export type SkillId = 'lockpicking' | 'electronics' | 'stealth' | 'demolition' | 'survival' | 'social';
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
  /** Person's name. Mara uses this. */
  name: string;
  /** Short role shown on the HUD, e.g. "Infiltrator". */
  role: string;
  tagline: string;
  description: string;
  /** One sentence: why the Compact handed you the radio. */
  motive: string;
  /** Page of the camp briefing, second person. */
  briefing: string;
  /** Journal entry unlocked at the start. */
  journal: string;
  /** Mara's last line after the Garage. */
  coda: string;
  accent: string; // CSS colour, also used for goggles/LEDs on the model
  /** Ranks this person already has. Missing skills start at 0. */
  skills: Partial<Record<SkillId, number>>;
  /** Extra kilograms before the pack complains. */
  carry: number;
  /** `stealth` below 1 is quieter. It multiplies how fast SeedBot's meter fills. */
  stats: { stealth: number; speed: number; toughness: number };
  /** The passive, as the card shows it. Stats-based passives are wired through `stats`/`carry`. */
  signature: { name: string; description: string };
  /** A passive that needs its own code path (see GameState and Game). */
  perk?: ArchetypePerk;
  startingItems: { id: string; qty: number }[];
  /** One line each: the word on the street, for the character card. */
  playstyle: string;
}

/**
 * - `trail`: hunger and thirst drain 25% slower, falls hurt 25% less.
 * - `insider`: Tanner hears one Social rank more. Dry Creek hears one less.
 */
export type ArchetypePerk = 'trail' | 'insider';

/** Everyone whose opinion of you is tracked. */
export type PersonId =
  | 'mara' | 'hollis' | 'pip' | 'dez'
  | 'nia' | 'doc' | 'inez' | 'sol' | 'ren' | 'wick'
  | 'tanner' | 'vesper'
  | 'creek' | 'compact';

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
  /** Lines shown under the document when it's read. */
  revealLines?: string[];
  /** Stuff in the same pile as the paper. */
  loot?: { id: string; qty: number }[];
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
  kind: 'gas-station' | 'radio-tower' | 'town' | 'cave' | 'site';
  position: Vec3;
  rotation: number;
  camp?: boolean;
  blurb: string;
  /** Terrain flattened around the landmark (Heightfield). Defaults depend on `kind`. */
  flatten?: { r: number; falloff: number };
}
