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
  {
    id: 'spike', name: 'Trace Spike', category: 'tool', weight: 0.15, stack: 6, value: 15, icon: 'spike',
    description: 'A cell, a coil and a lot of tape. Jam it in the port mid-splice (F) and the trace stalls for six seconds. The camp can wind them.',
    flavor: 'Kade\'s incident reports call this "unscheduled latency".',
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
    id: 'pistol22', name: 'Hush .22', category: 'weapon', weight: 0.9, stack: 1, value: 110, icon: 'pistol22',
    description: 'A target pistol wearing a suppressor the size of a soda can. Ten in the magazine, and a shot a contractor twenty metres off mistakes for somebody else\'s problem. Soft past twenty metres. Aim for heads.',
    flavor: 'Kade\'s internal memo calls it a "discreet offboarding tool".',
  },
  {
    id: 'ammo22', name: '.22 Long Rifle', category: 'ammo', weight: 0.004, stack: 50, value: 1, icon: 'ammo22',
    description: 'Little rimfire rounds for the Hush. The camp can load them by the dozen from scrap.',
  },
  {
    id: 'molotov', name: 'Reserve Molotov', category: 'consumable', weight: 0.7, stack: 4, value: 32, icon: 'molotov', usable: true,
    description: 'Four-hundred-dollar mezcal and a strip of founder fleece. Throw it (use) and the ground burns for eight seconds: wolves, contractors and you, if you stand in it. Loud enough to turn heads.',
    flavor: 'Tasting notes: smoke.',
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
  // --- Gear (overnight swarm 2): tools that change how you play ---
  {
    id: 'binoculars', name: 'Survey Binoculars', category: 'tool', weight: 0.7, stack: 1, value: 70, icon: 'binoculars', usable: true,
    description: 'Use to raise them (again, or Esc, to lower). Anything hostile you hold in the middle for a moment gets tagged: contractors, wolves, turrets, drones. Tagged things show through walls and on the minimap for ninety seconds.',
    flavor: 'Stencilled: KADE SURVEY · ASSET 0091 · "SEE THE OPPORTUNITY".',
  },
  {
    id: 'vest', name: 'Recovery Plate Carrier', category: 'tool', weight: 3.2, stack: 1, value: 95, icon: 'vest',
    description: 'Worn while it\'s in your pack. Takes 40% of bullets, blasts, bites and blows until the plates are spent; the plates are 100 points of somebody else\'s problem. Re-plate it at the camp fire.',
    flavor: 'The inside label says "ONE SIZE FITS MOST STAKEHOLDERS".',
  },
  {
    id: 'bandage', name: 'Fleece Bandage', category: 'consumable', weight: 0.08, stack: 8, value: 8, icon: 'bandage', usable: true,
    description: 'Quick to wrap, even on the move: 12 health now and 20 more over ten seconds. Not a medkit. A medkit closes a hole. This holds one shut.',
    flavor: 'Cut from a VC fleece vest. The fund logo is still on the wound side.',
  },
  {
    id: 'canteen', name: 'Canteen', category: 'tool', weight: 0.5, stack: 1, value: 40, icon: 'canteen', usable: true,
    description: 'Three long drinks. Fills itself up when you rest at the camp fire, so you can stop hauling bottles. Inez will top it up for a scrap.',
    flavor: 'Rebuilt from a bottle that used to glow when you were dehydrated. Now it just works.',
  },
  // --- Satirical salvage (overnight swarm 2): sell it at the Till, or strip it at the fire ---
  {
    id: 'smart_ring', name: 'Sleep Ring (Gen 3)', category: 'loot', weight: 0.02, stack: 10, value: 14, icon: 'ring',
    description: 'Titanium, tracks your sleep. Last sync 1,281 days ago. Sleep score: 0. A tiny cell inside, if you have small screwdrivers and no dignity.',
    flavor: 'It vibrates once a day to tell you to stand up. Nobody has sat down since the Pivot.',
  },
  {
    id: 'visor', name: 'Metaverse Visor', category: 'loot', weight: 0.6, stack: 3, value: 22, icon: 'visor',
    description: 'A headset. Inside it is a virtual land parcel that sold for two point three million. The parcel is also nowhere now. Good lenses, though.',
    flavor: 'The strap still smells like a keynote.',
  },
  {
    id: 'mug', name: '"Move Fast" Mug', category: 'loot', weight: 0.35, stack: 5, value: 4, icon: 'mug',
    description: 'A matte black mug that says MOVE FAST on one side and, faintly, BREAK THINGS on the other, where somebody tried to scrub it off.',
    flavor: 'Broke. Moved.',
  },
  {
    id: 'seed_plate', name: 'Seed Phrase Plate', category: 'loot', weight: 0.4, stack: 6, value: 12, icon: 'plate',
    description: 'Twenty-four words stamped into a steel plate: fireproof, floodproof, meaning-proof. The coins live on a server that is now a crater. The steel is real. It stops a bullet.',
    flavor: 'Word nineteen is "bunker". Word twenty is "regret".',
  },
  {
    id: 'kombucha', name: 'Raw Kombucha', category: 'consumable', weight: 0.6, stack: 6, value: 9, icon: 'kombucha', usable: true,
    description: 'Unpasteurised, still alive, getting ideas. A good drink and a little food, and your stomach files a complaint.',
    flavor: 'The SCOBY has been the CEO since the founder left.',
  },
  {
    id: 'mezcal', name: 'Founder\'s Reserve Mezcal', category: 'loot', weight: 0.8, stack: 4, value: 28, icon: 'bottle',
    description: 'Small batch, single estate, numbered, four hundred dollars. High proof. The camp has a better use for it than drinking.',
    flavor: 'Bottle 31 of 500. Tasting notes: exit liquidity.',
  },
  {
    id: 'smart_lock', name: 'Smart Padlock', category: 'loot', weight: 0.5, stack: 4, value: 6, icon: 'padlock',
    description: 'Opens from an app. The app\'s servers are gone, which makes this the most secure object left on Earth. Strip it for the cell and the steel.',
    flavor: '"Your door, reimagined." Reimagined as a wall.',
  },
  {
    id: 'asic', name: 'Mining Rig', category: 'loot', weight: 3, stack: 2, value: 30, icon: 'asic',
    description: 'A box that turned the grid into 0.0004 of a coin. Heavy, hot even now, and full of copper, fans and two good cells.',
    flavor: 'It paid for itself, according to a chart.',
  },
  {
    id: 'speaker_badge', name: 'Summit Speaker Lanyard', category: 'loot', weight: 0.05, stack: 10, value: 8, icon: 'badge',
    description: 'SPEAKER · RESILIENCE SUMMIT · "Disrupting the Apocalypse". The talk was at 2 pm. The apocalypse was at 1.',
    flavor: 'Green room access. The green room is a crater.',
  },
  {
    id: 'nootropics', name: 'Founder Focus™', category: 'consumable', weight: 0.05, stack: 6, value: 18, icon: 'pills', usable: true,
    description: 'Forty percent caffeine, sixty percent confidence. For two minutes your aim doesn\'t sway and your reloads don\'t shake. Then you\'re thirsty.',
    flavor: '"Unlock your 10x self." Side effects include certainty.',
  },
  {
    id: 'smart_bottle', name: 'Hydration-Aware Bottle', category: 'loot', weight: 0.3, stack: 3, value: 10, icon: 'smartbottle',
    description: 'Glows to remind you to drink. Has been glowing since the end of the world. Gut the electronics and it\'s a perfectly good canteen.',
    flavor: 'Hydration streak: 0 days. Glow streak: 1,281.',
  },
  {
    id: 'scooter_cell', name: 'Scooter Battery', category: 'loot', weight: 1.8, stack: 3, value: 34, icon: 'scootercell',
    description: 'From a fleet of forty thousand rental scooters that all went into the same river on the same night. Two good lithium cells inside.',
    flavor: 'Ride ended. Please park responsibly.',
  },
  {
    id: 'fleece', name: 'VC Fleece Vest', category: 'loot', weight: 0.4, stack: 4, value: 12, icon: 'fleece',
    description: 'The uniform. A fund\'s logo over the heart. Warm, sleeveless, pointless, and it tears into very good bandages.',
    flavor: 'The fund is gone. The vest abides.',
  },
  {
    id: 'gpu', name: 'Graphics Card', category: 'loot', weight: 1.1, stack: 3, value: 45, icon: 'gpu',
    description: 'Pulled from a rack that ran a chatbot which told one CEO he was right, every time, for six years. Inez pays well for these. She won\'t say why.',
    flavor: 'Still warm. Still agreeing.',
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
  // --- Number 2,212 ---
  {
    id: 'ada_letter', name: 'Letter from Chair 2,212', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'intel',
    description: 'Folded under a stone on a camp chair at the edge of the Everafter line. TO HAL IVERS, DRY CREEK CLINIC. HAND DELIVERY. YOU KNOW WHY.',
    flavor: 'The handwriting leans forward, like someone in a hurry to be somewhere.',
  },
  // --- The founders' favours: Class of Tomorrow ---
  {
    id: 'pip_letter', name: 'Pip\'s Envelope', category: 'intel', weight: 0, stack: 1, value: 0, icon: 'intel',
    description: 'From the Kade Kids time capsule: TO PIP OKAFOR, AGE 23. DO NOT OPEN UNTIL 2046. The flap is only tucked in.',
    flavor: 'Eleven-year-olds don\'t lick envelopes.',
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
/** The Kit's button for items whose "Use" is really something else. */
export const USE_LABEL: Record<string, string> = {
  sol_roll: 'Unroll (5 picks)', binoculars: 'Raise', molotov: 'Throw', emp: 'Throw', noisemaker: 'Throw',
  canteen: 'Drink', water: 'Drink', kombucha: 'Drink', ration: 'Eat', soylent: 'Drink', bandage: 'Wrap', nootropics: 'Take', medkit: 'Patch up', antivenom: 'Treat',
};
/** Items that are never dropped with your pack on death (story, weapons, worn gear). */
export const KEEP_ON_DEATH = (id: string) => { const c = ITEMS[id]?.category; return c === 'intel' || c === 'weapon' || id === 'sol_roll' || id === 'deed' || id === 'binoculars' || id === 'vest' || id === 'canteen'; };

// --- Gear state (overnight swarm 2). Lives in `data.marks` (absent = fresh), so saves need no migration.
export const VEST_PLATES = 100;
export const CANTEEN_SIPS = 3;
type GearView = { count(id: string): number; has?(flag: string): boolean; data: { marks: Record<string, number> } };
/** Plate points left on the vest you wear. */
export const vestPlates = (s: GearView) => Math.max(0, Math.min(VEST_PLATES, s.data.marks['gear.vest'] ?? VEST_PLATES));
/** Drinks left in the canteen. */
export const canteenSips = (s: GearView) => Math.max(0, Math.min(CANTEEN_SIPS, s.data.marks['gear.canteen'] ?? CANTEEN_SIPS));
/** Why a gear-restoring recipe can't run right now (or undefined). */
export function restoreBlock(s: GearView, id: 'vest' | 'canteen'): string | undefined {
  if (!s.count(id)) return id === 'vest' ? 'No vest to re-plate' : 'No canteen';
  if (id === 'vest' && vestPlates(s) >= VEST_PLATES) return 'The plates are fine';
  if (id === 'canteen' && canteenSips(s) >= CANTEEN_SIPS) return 'It\'s full';
  return undefined;
}
/** Hotbar slot `i`: its item, or the gear that does the same job when you're out (water → canteen, medkit → bandage). */
export function hotbarItem(i: number, s: GearView): { id: string; q: number } {
  const id = HOTBAR_ITEMS[i];
  if (id === 'water' && !s.count('water') && s.count('canteen')) return { id: 'canteen', q: canteenSips(s) };
  if (id === 'medkit' && !s.count('medkit') && s.count('bandage')) return { id: 'bandage', q: s.count('bandage') };
  return { id, q: s.count(id) };
}
/** A live line for the kit panel (plates, sips), or ''. */
export function itemStatus(id: string, s: GearView): string {
  if (id === 'vest') { const p = Math.round(vestPlates(s)); return p > 0 ? `Plates ${p} / ${VEST_PLATES}` : 'Plates spent: re-plate it at the fire'; }
  if (id === 'canteen') { const n = canteenSips(s); return n > 0 ? `${n} of ${CANTEEN_SIPS} drinks left` : 'Empty: rest at the fire, or ask Inez'; }
  if (id === 'rifle' && s.has?.('mod.rifle.scope')) return 'Fitted: survey scope (4×)';
  if (id === 'shotgun' && s.has?.('mod.shotgun.choke')) return 'Fitted: full choke';
  if (id === 'revolver' && s.has?.('mod.revolver.speed')) return 'Fitted: speedloader';
  return '';
}
