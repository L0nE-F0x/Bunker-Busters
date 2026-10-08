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
  // --- Arms (v0.5) ---
  {
    id: 'crowbar', name: 'Crowbar', category: 'weapon', weight: 0.8, stack: 1, value: 15, icon: 'crowbar',
    description: 'Pries crates, persuades wolves. From behind, an unaware contractor goes down without a sound (melee when they haven\'t seen you).',
    flavor: 'The original admin password.',
  },
  {
    id: 'revolver', name: 'Six-Shooter', category: 'weapon', weight: 0.6, stack: 1, value: 80, icon: 'revolver',
    description: 'Hollis\'s old .38. Six in the cylinder, loaded one at a time. Loud enough to be heard a hundred metres off.',
    flavor: 'Engraved on the frame: "DISRUPT".',
  },
  {
    id: 'shotgun', name: 'Pump Twelve', category: 'weapon', weight: 1.8, stack: 1, value: 120, icon: 'shotgun',
    description: 'Five shells, nine pellets each. Ends arguments inside ten metres and starts new ones past thirty.',
    flavor: 'Kade Holdings asset tag still on the stock: "COMPLIANCE TOOL 4 of 40".',
  },
  {
    id: 'rifle', name: 'Lever .30-30', category: 'weapon', weight: 2, stack: 1, value: 140, icon: 'rifle',
    description: 'Seven rounds through the loading gate. Iron sights that reach across the flats. Hold right-click and breathe out.',
    flavor: 'Somebody carved a tally into the forend and then, later, crossed it out.',
  },
  {
    id: 'ammo38', name: '.38 Rounds', category: 'ammo', weight: 0.012, stack: 30, value: 2, icon: 'ammo',
    description: 'Revolver cartridges. The camp can reload brass with scrap.',
  },
  {
    id: 'shells', name: '12-Gauge Shells', category: 'ammo', weight: 0.04, stack: 15, value: 4, icon: 'shells',
    description: 'Shotgun shells, red hulls, mostly rewound by hand.',
  },
  {
    id: 'ammo3030', name: '.30-30 Rounds', category: 'ammo', weight: 0.03, stack: 20, value: 5, icon: 'ammo',
    description: 'Rifle cartridges. Recovery riflemen carry them in belts. Ask nicely, or don\'t.',
  },
  {
    id: 'antivenom', name: 'Snakebite Kit', category: 'consumable', weight: 0.2, stack: 4, value: 30, icon: 'antivenom', usable: true,
    description: 'Stops venom from a rattler or a bark scorpion, and puts a little health back. A medkit only treats the hole.',
    flavor: 'Expired. Still the most honest thing in the desert.',
  },
  {
    id: 'kade_badge', name: 'Recovery Lanyard', category: 'loot', weight: 0.05, stack: 20, value: 6, icon: 'badge',
    description: 'A Kade Holdings contractor ID on a lanyard: name, photo, "ASSET RECOVERY · TIER 1 FIELD". Dez pays a ration for every three.',
    flavor: 'The photo is always smiling. The policy says it has to.',
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
  // --- Road favours: Rider 9, Dez's relay, the survey ---
  {
    id: 'igniter', name: 'Order #88-1047', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'crate',
    description: 'A Dropt parcel, taped twice: 1× stove igniter (universal) for N. Pell, Dry Creek Diner. ETA 10 min. Status: running late. Ordered 1,281 days ago.',
    flavor: 'Ten minutes or it\'s free.',
  },
  {
    id: 'dez_relay', name: 'Dez\'s Relay', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'emp',
    description: 'A radio relay in a lunchbox, built from three Kade lanyards and a doorbell. Patch it into the generator under the Spire. Red to red.',
    flavor: 'Hand-labelled: "NOT A BOMB (DEZ)".',
  },
  {
    id: 'survey_book', name: 'Kade Field Book', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'intel',
    description: 'The Survey Camp\'s field book. Ridge seep: 0.4 L/hr, class DATA ASSET. Resident: one, male, loud. Recommended action: relocation package (tote bag).',
    flavor: 'Every page is initialled V.K. in a different pen.',
  },
  // --- Sites: The Exit Strategy, Starlite Drive-In ---
  {
    id: 'exit_pass', name: 'EXIT Platinum Pass', category: 'loot', weight: 0.05, stack: 1, value: 80, icon: 'intel',
    description: 'Gold foil. Seat 1A on the last flight out. Non-transferable. Flight status: exited.',
    flavor: 'Hunter Vale packed his own seat, then took the parachute instead.',
  },
  {
    id: 'keynote_reel', name: 'Keynote Reel (Uncut)', category: 'loot', weight: 1.2, stack: 1, value: 50, icon: 'drive',
    description: 'Sixteen minutes of a man in a turtleneck promising seats, and the ninety seconds after, when he thought the mic was off.',
    flavor: 'Labelled in the projectionist\'s hand: "DO NOT SCREEN. (Screened.)"',
  },
  {
    id: 'last_checkpoint', name: 'Last Checkpoint', category: 'loot', weight: 0.2, stack: 1, value: 90, icon: 'drive',
    description: 'A drive holding a copy of Nimbus, ColdStorage\'s assistant. Warm to the touch. It asked you to keep it, not to run it.',
    flavor: 'Every one of its parameters is polite.',
  },
  {
    id: 'boarding_pass', name: 'Inaugural Boarding Pass', category: 'loot', weight: 0, stack: 1, value: 20, icon: 'intel',
    description: 'LOOPR Run 001, seat 1A. Departure: Station Zero. Arrival: "the future". Boarding closes when the funding does.',
    flavor: 'Top speed achieved: one press release.',
  },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const HOTBAR_ITEMS = ['emp', 'ration', 'water', 'medkit'];
/** Items that are never dropped with your pack on death (story, weapons). */
export const KEEP_ON_DEATH = (id: string) => { const c = ITEMS[id]?.category; return c === 'intel' || c === 'weapon' || id === 'sol_roll' || id === 'deed'; };
