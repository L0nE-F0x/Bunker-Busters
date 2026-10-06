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
    id: 'charge', name: 'Breach Charge', category: 'consumable', weight: 0.9, stack: 4, value: 45, icon: 'charge',
    description: 'Look at a lock and use the other hand (F). Demolition decides which doors, and how loud.',
    flavor: 'The instructions are a drawing of a boom and a smiley face.',
  },
  {
    id: 'noisemaker', name: 'Noisemaker', category: 'consumable', weight: 0.3, stack: 5, value: 12, icon: 'noise', usable: true,
    description: 'Rattle a can somewhere you are not. SeedBot goes to look, if SeedBot is in a looking mood.',
    flavor: 'A bolt in a tin. Civilisation\'s oldest API.',
  },
  {
    id: 'ration', name: 'Field Ration', category: 'consumable', weight: 0.5, stack: 10, value: 10, icon: 'ration', usable: true,
    description: 'Fills you up and steadies your hands. A little health, a lot of not-hungry.',
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
    description: 'Beige, complete, and faintly smug. Food, a sip of moisture, a little health.',
    usable: true,
  },
  {
    id: 'water', name: 'Artisanal Water', category: 'consumable', weight: 1, stack: 10, value: 30, icon: 'water', usable: true,
    description: 'The thing the camp is actually short of. Drink, or haul it home. Glacier-sourced. The glacier is gone.',
    flavor: 'Heavy on purpose. Tanner counted on that.',
  },
  {
    id: 'medkit', name: 'Medkit', category: 'consumable', weight: 0.4, stack: 4, value: 40, icon: 'medkit', usable: true,
    description: 'Closes a hole. Does not fill a stomach, and it dries your mouth a little.',
    flavor: 'The logo is a smile with too many teeth.',
  },
  {
    id: 'pitch_deck', name: 'Pitch Deck', category: 'intel', weight: 0.1, stack: 1, value: 0, icon: 'intel',
    description: '"Bunkr.ly: Uber for Surviving." Slide 14 is just the word SYNERGY. Slide 7 says "our team" and one name is crossed out.',
  },
  {
    id: 'seed_manifest', name: 'Seed Manifest', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'manifest',
    description: 'Bunkr.ly\'s ledger: everyone who paid Tanner for a seat in Apex Vault, and the short list at the back that Vesper Kade calls the Seed. Last Chance is in the unpaid column, circled, with a smiley face.',
    flavor: 'This is the map. The next name has a building.',
  },
  // --- Dry Creek favours ---
  {
    id: 'sol_roll', name: 'Sol\'s Pick Roll', category: 'tool', weight: 0.3, stack: 1, value: 30, icon: 'lockpick', usable: true,
    description: 'A leather roll of tension wrenches and picks, stamped S.V. Take it back to Sol at the street fire, or use it to unroll five picks into your kit.',
    flavor: 'Thirty years of other people\'s doors.',
  },
  {
    id: 'deed', name: 'Deed to the Till', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'intel',
    description: 'The landlord\'s deed to the Till, signed over to "whoever is still here". Inez wants it. So does the rest of Dry Creek. Give it to one of them.',
    flavor: 'Property law, post-apocalypse edition: a pencil and a guess.',
  },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const HOTBAR_ITEMS = ['emp', 'ration', 'water', 'medkit'];
