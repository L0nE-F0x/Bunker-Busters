// Shared content schema. Everything a designer touches lives in /content and conforms to these types.

export type SkillId = 'lockpicking' | 'electronics' | 'stealth' | 'demolition' | 'survival' | 'social' | 'firearms';
export type Vec3 = [number, number, number];

export interface SkillDef {
  id: SkillId;
  name: string;
  max: number;
  blurb: string;
  perLevel: string[]; // description of what each level grants (index = level)
}

export type ItemCategory = 'tool' | 'consumable' | 'loot' | 'intel' | 'weapon' | 'ammo';

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
  | 'ezra'
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
  /** A collectible run it belongs to (content/world.ts LORE_SERIES); the journal shows it in order. */
  series?: string;
  /** The thing lying in the world (world/intelProps.ts). Older entries are keyed by id instead. */
  prop?: string;
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
  /** What the bunker runtime (game/bunker/Bunker.ts) plays. `layers` above is the design summary. */
  security?: BunkerSecurity;
}

// ---------------------------------------------------------------------------------------------
// Bunker runtime data (game/bunker/Bunker.ts). Places (`point`) are keys of the builder's `points`,
// doors are keys of its `doors`. Save flags are derived from ids and never stored here:
//   <bunker>.<entry>.open · <bunker>.<tripwire>.disarmed · <bunker>.lasers.off ·
//   <bunker>.cameras.off · <bunker>.loot.<container> · <bunker>.complete
// Renaming an id renames its flag, which orphans it in existing saves: don't.
// ---------------------------------------------------------------------------------------------

/** A voiced line (a clip is rendered for it when `speaker` has a CAST entry in content/voices.ts). */
export interface SpokenLine { speaker: string; text: string }

/** A way past a lock. `id` is the choice id on a choice card (defaults to `kind`). */
export type LockMethod =
  /** The lockpick minigame (XP: lockPicked + 5 per pin). */
  | { kind: 'lockpick'; pins: number; title: string; id?: string }
  /** The circuit minigame: short the lock's board. */
  | { kind: 'circuit'; id?: string; label: string; title: string; difficulty: number; electronics: number; xp: number; reason: string }
  /** A code. Hints are checked in order: the first whose `when` has any flag set wins. */
  | {
      kind: 'keypad'; id?: string; label: string; title: string; code: string;
      /** Wrong codes before it locks out (and the alarm goes); reset by `applyFlags`. */
      lockout: number; lockedLabel: string; lockoutReason: string;
      hints: { when: string[]; text: string }[]; hint: string;
      xp: number; reason: string;
    }
  /** SPLICE (ui/Hack.ts). Daemons are DAEMONS ids; what each does is the bunker's `onDaemon`. */
  | {
      kind: 'splice'; id?: string; label: string; title: string; host: string; difficulty: number; electronics: number;
      daemons: string[]; xpEach: number; reason: string; traced: string;
    }
  /** A breach charge. `quiet`: a crouched Demolition 4 blast doesn't wake the alarm. */
  | { kind: 'charge'; id?: string; label: string; demolition: number; quiet: boolean; loud: string; line?: string | null }
  /** Nothing in the way once you know it's there (a loose fence panel). */
  | { kind: 'open'; id?: string; label: string; xp: number; reason: string; toast?: string };

/** A choice card: several methods behind one secondary action. */
export interface LockCard {
  label: string;
  speaker: string;
  text: string;
  /** The "never mind" choice (id `no`). */
  leave: string;
  methods: LockMethod[];
}

/** A door, gate or hatch with a lock. Opening it sets `<bunker>.<id>.open`. */
export interface BunkerEntryDef {
  id: string;
  point: string;
  radius: number;
  doors: string[];
  /** Builder `lockMeshes` key: hidden once it's open (the padlock on the gate). */
  lockMesh?: string;
  /** Only there once this flag is set (intel). */
  needs?: string;
  primary: LockMethod;
  secondary?: LockMethod | LockCard;
  /** The owner's line when it opens (null: none). A charge method can override it. */
  line?: string | null;
  trauma?: number;
}

/** The owner's speaker (taunts, alarm barks, reactions). */
export interface BunkerVoice {
  /** Builder point the speaker sits at. */
  point: string;
  greet: string;
  greetRadius: number;
  tauntRadius: number;
  alarm: string[];
}

export interface BunkerSecurity {
  entries: BunkerEntryDef[];
  /**
   * The sealed inside's portals (interior mode): entries whose first door opens it to the world.
   * `pad` grows the door's collider box into the portal box (metres per axis, world-aligned).
   */
  portals: { entry: string; pad: [number, number, number] }[];
  voice: BunkerVoice;
  /** Seconds an alarm rings after the last trigger. */
  alarmTime: number;
  /** Intercoms: talk to the owner (the bunker's `talk()`). Position: a point + (dx, dz), y above the origin. */
  intercoms?: { id: string; point: string; offset: [number, number]; y: number; radius: number; label: string; until?: string }[];
  tripwires?: {
    disarm: { label: string; electronics: number; lacking: string };
    yank: { label: string; demolition: number; lacking: string; quiet: string; quietReason: string; loud: string };
    tripped: string; stepped: string; ahead: string;
  };
  lasers?: {
    /** Alarm reason per laser id (`default` for the rest). */
    tripped: Record<string, string>;
    /** Where SeedBot is sent when a beam trips. */
    alarmPoint: string;
    power: {
      id: string; point: string; radius: number; label: string;
      circuit: { title: string; difficulty: number };
      /** Electronics rank that kills them without the minigame. */
      expert: number; expertToast: string;
      xp: number; reason: string;
      shock: { damage: number; toast: string };
      sparkOffset: [number, number, number];
    };
  };
  cameras?: {
    tripped: string;
    /** Seconds of a clear look before the alarm. */
    detectTime: number;
  };
  /**
   * Patrol drones' lines. Spoken ones are `{ speaker, text }` so the voice extractor
   * (scripts/voice/extract.mjs) finds them; the rest are toasts.
   */
  drones?: {
    spotted: string; zapped: string; empReason: string;
    sputter: SpokenLine; reboot: SpokenLine; emp: SpokenLine;
  };
  loot: {
    /** Entry that has to be open first. */
    behind: string;
    /** `guaranteed` or a slice [from, to) of the roll table. */
    containers: { id: string; label: string; take: 'guaranteed' | [number, number?] }[];
    overburdened: string;
    busted: { reason: string; banner: string; line: string };
  };
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
