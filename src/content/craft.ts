import type { SkillId } from './types';
import type { ModId } from './weapons';

export interface Recipe {
  id: string;
  name: string;
  /** Shown under the name, e.g. "3 scrap → 2 lockpicks". */
  detail: string;
  out: { id: string; qty: number };
  need: { id: string; qty: number }[];
  skill?: { id: SkillId; level: number };
  /** Heading in the camp panel. */
  group?: 'Tools' | 'Ammunition' | 'Medicine' | 'Salvage' | 'Gear' | 'Weapon mods';
  /** Not an item: fits a mod to a weapon you carry (its `out.qty` is 0). See weapons.ts MODS. */
  mod?: ModId;
  /** Not a new item: tops a piece of gear back up (its `out.qty` is 0). See Gear.ts. */
  restore?: 'vest' | 'canteen';
}

/** Campfire work. No bench, no minigame: scrap, a battery, and a skill you already bought. */
export const RECIPES: Recipe[] = [
  {
    id: 'picks',
    group: 'Tools',
    name: 'Bend some picks',
    detail: '3 scrap → 2 lockpicks',
    out: { id: 'lockpick', qty: 2 },
    need: [{ id: 'scrap', qty: 3 }],
  },
  {
    id: 'noise',
    group: 'Tools',
    name: 'Can and a bolt',
    detail: '2 scrap → 1 noisemaker',
    out: { id: 'noisemaker', qty: 1 },
    need: [{ id: 'scrap', qty: 2 }],
  },
  {
    id: 'emp',
    group: 'Tools',
    name: 'Pack an EMP',
    detail: '2 cells + 3 scrap → 1 EMP · Electronics 1',
    out: { id: 'emp', qty: 1 },
    need: [{ id: 'battery', qty: 2 }, { id: 'scrap', qty: 3 }],
    skill: { id: 'electronics', level: 1 },
  },
  {
    id: 'spike',
    group: 'Tools',
    name: 'Wind trace spikes',
    detail: '1 cell + 2 scrap → 2 trace spikes · Electronics 1',
    out: { id: 'spike', qty: 2 },
    need: [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }],
    skill: { id: 'electronics', level: 1 },
  },
  {
    id: 'charge',
    group: 'Tools',
    name: 'Pack a charge',
    detail: '1 cell + 3 scrap → 1 breach charge · Demolition 1',
    out: { id: 'charge', qty: 1 },
    need: [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 3 }],
    skill: { id: 'demolition', level: 1 },
  },
  {
    id: 'medkit',
    group: 'Medicine',
    name: 'Strip a medkit',
    detail: '1 ration + 4 scrap → 1 medkit · Survival 2',
    out: { id: 'medkit', qty: 1 },
    need: [{ id: 'ration', qty: 1 }, { id: 'scrap', qty: 4 }],
    skill: { id: 'survival', level: 2 },
  },
  {
    id: 'rounds38',
    group: 'Ammunition',
    name: 'Reload brass (.38)',
    detail: '2 scrap → 6 .38 rounds',
    out: { id: 'ammo38', qty: 6 },
    need: [{ id: 'scrap', qty: 2 }],
  },
  {
    id: 'shells',
    group: 'Ammunition',
    name: 'Rewind shells',
    detail: '3 scrap → 4 shells · Demolition 1',
    out: { id: 'shells', qty: 4 },
    need: [{ id: 'scrap', qty: 3 }],
    skill: { id: 'demolition', level: 1 },
  },
  {
    id: 'rounds3030',
    group: 'Ammunition',
    name: 'Load rifle rounds',
    detail: '3 scrap + 1 cell → 6 .30-30 · Firearms 2',
    out: { id: 'ammo3030', qty: 6 },
    need: [{ id: 'scrap', qty: 3 }, { id: 'battery', qty: 1 }],
    skill: { id: 'firearms', level: 2 },
  },
  {
    id: 'antivenom',
    group: 'Medicine',
    name: 'Snakebite kit',
    detail: '1 water + 2 scrap → 1 kit · Survival 1',
    out: { id: 'antivenom', qty: 1 },
    need: [{ id: 'water', qty: 1 }, { id: 'scrap', qty: 2 }],
    skill: { id: 'survival', level: 1 },
  },
  // --- overnight swarm 2: the new salvage has uses ---
  {
    id: 'rounds22',
    group: 'Ammunition',
    name: 'Load .22 by the dozen',
    detail: '2 scrap → 15 .22 LR',
    out: { id: 'ammo22', qty: 15 },
    need: [{ id: 'scrap', qty: 2 }],
  },
  {
    id: 'bandages',
    group: 'Medicine',
    name: 'Tear up a fleece vest',
    detail: '1 VC fleece → 3 bandages',
    out: { id: 'bandage', qty: 3 },
    need: [{ id: 'fleece', qty: 1 }],
  },
  {
    id: 'molotov',
    group: 'Tools',
    name: 'Bottle a molotov',
    detail: '1 mezcal + 1 bandage → 1 molotov',
    out: { id: 'molotov', qty: 1 },
    need: [{ id: 'mezcal', qty: 1 }, { id: 'bandage', qty: 1 }],
  },
  {
    id: 'spike_lock',
    group: 'Tools',
    name: 'Wind a spike from a smart lock',
    detail: '1 smart padlock + 1 scrap → 1 trace spike · Electronics 1',
    out: { id: 'spike', qty: 1 },
    need: [{ id: 'smart_lock', qty: 1 }, { id: 'scrap', qty: 1 }],
    skill: { id: 'electronics', level: 1 },
  },
  {
    id: 'binoculars',
    group: 'Gear',
    name: 'Binoculars from two visors',
    detail: '2 metaverse visors + 2 scrap → 1 binoculars',
    out: { id: 'binoculars', qty: 1 },
    need: [{ id: 'visor', qty: 2 }, { id: 'scrap', qty: 2 }],
  },
  {
    id: 'canteen',
    group: 'Gear',
    name: 'Gut a smart bottle',
    detail: '1 hydration-aware bottle + 1 scrap → 1 canteen',
    out: { id: 'canteen', qty: 1 },
    need: [{ id: 'smart_bottle', qty: 1 }, { id: 'scrap', qty: 1 }],
  },
  {
    id: 'replate',
    group: 'Gear',
    name: 'Re-plate the vest',
    detail: '2 seed phrase plates → plates back to 100',
    out: { id: 'vest', qty: 0 },
    need: [{ id: 'seed_plate', qty: 2 }],
    restore: 'vest',
  },
  {
    id: 'replate_scrap',
    group: 'Gear',
    name: 'Patch the vest with scrap',
    detail: '5 scrap → plates back to 100 · Survival 1',
    out: { id: 'vest', qty: 0 },
    need: [{ id: 'scrap', qty: 5 }],
    skill: { id: 'survival', level: 1 },
    restore: 'vest',
  },
  {
    id: 'cells_scooter',
    group: 'Salvage',
    name: 'Split a scooter battery',
    detail: '1 scooter battery → 2 lithium cells',
    out: { id: 'battery', qty: 2 },
    need: [{ id: 'scooter_cell', qty: 1 }],
  },
  {
    id: 'cells_asic',
    group: 'Salvage',
    name: 'Gut a mining rig',
    detail: '1 mining rig → 2 lithium cells · Electronics 1',
    out: { id: 'battery', qty: 2 },
    need: [{ id: 'asic', qty: 1 }],
    skill: { id: 'electronics', level: 1 },
  },
  {
    id: 'cells_ring',
    group: 'Salvage',
    name: 'Rob three sleep rings',
    detail: '3 sleep rings → 1 lithium cell · Electronics 2',
    out: { id: 'battery', qty: 1 },
    need: [{ id: 'smart_ring', qty: 3 }],
    skill: { id: 'electronics', level: 2 },
  },
  {
    id: 'scrap_mug',
    group: 'Salvage',
    name: 'Break the mugs',
    detail: '3 "Move Fast" mugs → 2 scrap',
    out: { id: 'scrap', qty: 2 },
    need: [{ id: 'mug', qty: 3 }],
  },
];

RECIPES.push(
  {
    id: 'mod_scope',
    group: 'Weapon mods',
    name: 'Scope the .30-30',
    detail: '1 binoculars + 3 scrap → a 4× scope on the rifle · Firearms 2',
    out: { id: 'rifle', qty: 0 },
    need: [{ id: 'binoculars', qty: 1 }, { id: 'scrap', qty: 3 }],
    skill: { id: 'firearms', level: 2 },
    mod: 'scope',
  },
  {
    id: 'mod_choke',
    group: 'Weapon mods',
    name: 'Choke the Pump Twelve',
    detail: '1 smart padlock + 4 scrap → a full choke on the shotgun · Firearms 1',
    out: { id: 'shotgun', qty: 0 },
    need: [{ id: 'smart_lock', qty: 1 }, { id: 'scrap', qty: 4 }],
    skill: { id: 'firearms', level: 1 },
    mod: 'choke',
  },
);

/** Camp panel order: headings in this order, recipes in file order under each. */
export const RECIPE_GROUPS = ['Tools', 'Ammunition', 'Medicine', 'Gear', 'Weapon mods', 'Salvage'] as const;
