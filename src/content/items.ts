import type { ItemDef } from './types';

const defs: ItemDef[] = [
  // --- MVP core items ---
  {
    id: 'lockpick', name: 'Lockpick', category: 'tool', weight: 0.1, stack: 20, value: 5, icon: 'lockpick',
    description: 'Bent hairpin of destiny. Breaks if you force it.',
    flavor: 'Formerly a spork.',
  },
  {
    id: 'emp', name: 'EMP Charge', category: 'consumable', weight: 0.8, stack: 5, value: 40, icon: 'emp', usable: true,
    description: 'Throw to fry nearby electronics. Disables drones for ~12s.',
    flavor: 'Smells like ozone and venture capital.',
  },
  {
    id: 'ration', name: 'Field Ration', category: 'consumable', weight: 0.5, stack: 10, value: 10, icon: 'ration', usable: true,
    description: 'Restores 35 health. Tastes like cardboard that gave up.',
    flavor: '"Best before: civilisation."',
  },
  // --- Loot ---
  {
    id: 'scrap', name: 'Scrap Metal', category: 'loot', weight: 1, stack: 50, value: 2, icon: 'scrap',
    description: 'Universal currency of the wasteland. Also tetanus.',
  },
  {
    id: 'battery', name: 'Lithium Cell', category: 'loot', weight: 0.4, stack: 10, value: 25, icon: 'battery',
    description: 'Fully charged. Unlike the drone that guarded it.',
  },
  {
    id: 'hoodie', name: "Founder's Hoodie", category: 'loot', weight: 0.6, stack: 1, value: 60, icon: 'hoodie',
    description: 'Embroidered: "BUNKR.LY — SEED STAGE". Surprisingly warm.',
  },
  {
    id: 'nft_drive', name: 'Cold Wallet', category: 'loot', weight: 0.2, stack: 3, value: 1, icon: 'drive',
    description: 'Contains 40,000 monkey JPEGs. Worth exactly one (1) bean.',
  },
  {
    id: 'soylent', name: 'Meal Shake Crate', category: 'loot', weight: 2, stack: 5, value: 35, icon: 'crate',
    description: 'A year of nutritionally complete beige. Restores 20 health per use.',
    usable: true,
  },
  {
    id: 'water', name: 'Artisanal Water', category: 'loot', weight: 1, stack: 10, value: 30, icon: 'water',
    description: 'Glacier-sourced. The glacier is gone. This is the last of it.',
  },
  {
    id: 'pitch_deck', name: 'Pitch Deck', category: 'intel', weight: 0.1, stack: 1, value: 0, icon: 'intel',
    description: '"Bunkr.ly: Uber for Surviving." Slide 14 is just the word SYNERGY.',
  },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const HOTBAR_ITEMS = ['emp', 'ration', 'soylent'];
