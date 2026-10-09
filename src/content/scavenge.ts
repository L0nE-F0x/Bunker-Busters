/**
 * Loot out in the open, not tied to any quest. Survivors mark a stash with a red rag tied to a stick
 * over a little cairn; learn the sign and the desert gets generous. Wrecks on the highway can be
 * searched once each. Stashes get topped up again after a while (somebody is still using them).
 */

export type CacheKind = 'can' | 'locker' | 'pack' | 'crate' | 'cooler';

export interface CacheDef {
  id: string;
  kind: CacheKind;
  /** Rough spot; nudged to flat, clear ground at build. */
  at: [number, number];
  /** What the prompt calls it. */
  label: string;
}

export const CACHES: CacheDef[] = [
  { id: 'c.drivein-n', kind: 'pack', at: [-60, 20], label: 'Search the traveller\'s pack' },
  { id: 'c.spur', kind: 'can', at: [60, 200], label: 'Open the ammo can' },
  { id: 'c.creek-s', kind: 'locker', at: [-200, 30], label: 'Open the footlocker' },
  { id: 'c.west-road', kind: 'can', at: [-380, 120], label: 'Open the ammo can' },
  { id: 'c.gas-n', kind: 'crate', at: [-120, 260], label: 'Pry open the Kade crate' },
  { id: 'c.cut-e', kind: 'pack', at: [100, 300], label: 'Search the traveller\'s pack' },
  { id: 'c.spire-ne', kind: 'can', at: [230, 262], label: 'Open the ammo can' },
  { id: 'c.tube-w', kind: 'locker', at: [380, 20], label: 'Open the footlocker' },
  { id: 'c.garage-se', kind: 'crate', at: [170, -228], label: 'Pry open the Kade crate' },
  { id: 'c.drivein-s', kind: 'pack', at: [20, -250], label: 'Search the traveller\'s pack' },
  { id: 'c.wash', kind: 'can', at: [-120, -230], label: 'Open the ammo can' },
  { id: 'c.creek-w', kind: 'locker', at: [-345, -118], label: 'Open the footlocker' },
  { id: 'c.hwy-e', kind: 'cooler', at: [250, 62], label: 'Open the cooler' },
  { id: 'c.junction', kind: 'cooler', at: [-30, 140], label: 'Open the cooler' },
  { id: 'c.salt-se', kind: 'can', at: [332, -330], label: 'Open the ammo can' },
  { id: 'c.jet-nw', kind: 'crate', at: [-362, 330], label: 'Pry open the Kade crate' },
  { id: 'c.mesa', kind: 'locker', at: [140, 110], label: 'Open the footlocker' },
  { id: 'c.flats', kind: 'pack', at: [-150, -60], label: 'Search the traveller\'s pack' },
];

/** One line of a loot table: `p` chance, `qty` range. `ammo` picks a calibre (owned guns favoured). */
export type LootRoll = { id: string | 'ammo'; qty: [number, number]; p: number };

export const CACHE_LOOT: Record<CacheKind, LootRoll[]> = {
  can: [{ id: 'ammo', qty: [1, 1], p: 1 }, { id: 'ammo', qty: [1, 1], p: 0.7 }, { id: 'scrap', qty: [1, 2], p: 0.3 }, { id: 'seed_plate', qty: [1, 1], p: 0.12 }],
  locker: [
    { id: 'ammo', qty: [1, 1], p: 1 }, { id: 'water', qty: [1, 2], p: 0.8 }, { id: 'medkit', qty: [1, 1], p: 0.35 }, { id: 'lockpick', qty: [1, 2], p: 0.35 }, { id: 'battery', qty: [1, 1], p: 0.2 },
    { id: 'bandage', qty: [1, 2], p: 0.3 }, { id: 'smart_lock', qty: [1, 1], p: 0.2 }, { id: 'mezcal', qty: [1, 1], p: 0.15 }, { id: 'asic', qty: [1, 1], p: 0.08 },
  ],
  pack: [
    { id: 'water', qty: [1, 2], p: 0.9 }, { id: 'ration', qty: [1, 1], p: 0.7 }, { id: 'ammo', qty: [1, 1], p: 0.75 }, { id: 'lockpick', qty: [1, 1], p: 0.3 }, { id: 'antivenom', qty: [1, 1], p: 0.15 },
    { id: 'fleece', qty: [1, 1], p: 0.25 }, { id: 'smart_ring', qty: [1, 1], p: 0.2 }, { id: 'smart_bottle', qty: [1, 1], p: 0.15 }, { id: 'nootropics', qty: [1, 2], p: 0.15 }, { id: 'speaker_badge', qty: [1, 1], p: 0.15 },
  ],
  crate: [
    { id: 'ammo', qty: [1, 1], p: 1 }, { id: 'ammo', qty: [1, 1], p: 0.8 }, { id: 'battery', qty: [1, 1], p: 0.5 }, { id: 'medkit', qty: [1, 1], p: 0.3 }, { id: 'kade_badge', qty: [1, 1], p: 0.6 }, { id: 'charge', qty: [1, 1], p: 0.12 },
    { id: 'gpu', qty: [1, 1], p: 0.15 }, { id: 'visor', qty: [1, 1], p: 0.15 }, { id: 'molotov', qty: [1, 1], p: 0.1 },
  ],
  cooler: [{ id: 'water', qty: [2, 3], p: 1 }, { id: 'ration', qty: [1, 1], p: 0.6 }, { id: 'ammo', qty: [1, 1], p: 0.3 }, { id: 'kombucha', qty: [1, 2], p: 0.4 }, { id: 'mezcal', qty: [1, 1], p: 0.12 }],
};

/** Highway wrecks: glovebox, footwell, trunk. Searched once. */
export const WRECK_LOOT: LootRoll[] = [
  { id: 'ammo', qty: [1, 1], p: 0.55 }, { id: 'water', qty: [1, 1], p: 0.3 }, { id: 'scrap', qty: [1, 3], p: 0.55 },
  { id: 'lockpick', qty: [1, 1], p: 0.15 }, { id: 'ration', qty: [1, 1], p: 0.15 },
  { id: 'mug', qty: [1, 1], p: 0.15 }, { id: 'scooter_cell', qty: [1, 1], p: 0.08 }, { id: 'smart_ring', qty: [1, 1], p: 0.08 }, { id: 'kombucha', qty: [1, 1], p: 0.1 },
];

/** A handful of each calibre (one `ammo` roll). */
export const AMMO_HANDFUL: Record<'ammo38' | 'shells' | 'ammo3030' | 'ammo22', [number, number]> = {
  ammo38: [6, 12],
  shells: [3, 6],
  ammo3030: [4, 8],
  ammo22: [10, 20],
};

/** Which gun eats which calibre (found ammo favours guns you carry). */
export const AMMO_FOR: Record<'ammo38' | 'shells' | 'ammo3030' | 'ammo22', string> = { ammo38: 'revolver', shells: 'shotgun', ammo3030: 'rifle', ammo22: 'pistol22' };

/** Play-time seconds before a looted stash has something in it again. */
export const RESTOCK_S = 35 * 60;
