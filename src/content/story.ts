import type { ArchetypeDef } from './types';

export interface StoryPage {
  speaker: string;
  text: string;
}

export interface StoryView {
  has: (flag: string) => boolean;
  archetype: ArchetypeDef;
}

/**
 * Act I — why anyone is outside The Garage.
 *
 * The Great Pivot was the afternoon the markets, the grid, and the sky failed together.
 * The people who had been selling the future were already inside it. Day 1,284, the camps
 * that still answer a radio call themselves the Surface Compact. They are not an army.
 * They are thirsty.
 *
 * Tanner Pivotson sold bunkers and built one. His drone has been lifting water off the
 * highway. His vault holds the Seed Manifest: who paid, and the short list who got a door.
 * The water keeps Last Chance alive tonight. The names are the map. Without them the next
 * bunker is only a rumour.
 *
 * The rule, written on the back of a receipt: take what the living need. Leave him alive
 * if you can. Do not become the person on the other side of the lock.
 */

export function briefingFor(a: ArchetypeDef): StoryPage[] {
  return [
    {
      speaker: 'Mara Voss · Last Chance radio',
      text:
        'If you\'re hearing this, you\'re still outside. Good. That\'s the job. Day 1,284 after the Pivot. The jugs are light. Tanner Pivotson\'s drone has been lifting water off the spur all week. His cistern is the last clean tank within a day\'s walk of this fire.',
    },
    {
      speaker: 'Mara Voss',
      text:
        'Inside the vault he keeps a thing he calls the Seed Manifest. Everyone who paid him for a bunker, and the short list who actually got one. We need the water tonight. We need the names, because the next door is a rumour until it\'s a name. Rule of the Compact: take what the living need. Leave him alive if you can. We are not building a new him.',
    },
    { speaker: 'Mara Voss', text: a.briefing },
    {
      speaker: 'Mara Voss',
      text:
        'The note is on the pump island, just north of this fire. Read it. Search the cooler. West of the highway, Dry Creek still has a diner light on. People, not the job. They have other doors, and a rank spends differently in each of them. At rank 2 the kit offers a focus: one shape for a skill, and the point does not raise the rank. Tab is your kit. J is this story. Crouch steps over tin-can wire. Bring the water back, and bring the names. Mara, out.',
    },
  ];
}

export function reminderFor(a: ArchetypeDef): StoryPage[] {
  return [
    {
      speaker: 'Mara Voss',
      text: `${a.name}. The job has not changed. Tanner\'s cistern, then the Seed Manifest in the vault. The note is on the pumps if you walked past it. Spend the skill point on the way you actually get in: a pick, a circuit, a charge, or his mouth. Don\'t die on a door this small.`,
    },
  ];
}

export function debriefFor(a: ArchetypeDef): StoryPage[] {
  return [
    {
      speaker: 'Mara Voss',
      text: `${a.name}. You sound like someone who met him. The jugs are on the log. I\'m not going to applaud. I\'m going to read.`,
    },
    {
      speaker: 'Mara Voss',
      text:
        'Half this list paid in full and got a tote bag. One name is us. Last Chance. "Delivery exception, unresolved." He sold the camp a bunker and shipped shakes. There\'s a smiley face. I\'m choosing to believe the smiley face was fear.',
    },
    {
      speaker: 'Mara Voss',
      text:
        'And one name that already has a door. Vesper Kade. Apex Vault. Rocket money, a mouth, and a building west of the salt that actually exists. She is on this frequency. I didn\'t invite her.',
    },
    {
      speaker: 'Vesper Kade',
      text:
        'Hi, thieves. Love the initiative. The Garage was a prototype with bad unit economics. Cute drone. I bought the real door. If you\'re collecting names, come say mine to it. It listens. Most doors don\'t. Tell Mara the water was a down payment, not a victory. — V. Kade',
    },
    {
      speaker: 'Mara Voss',
      text: `${a.coda} The road to Apex is not open tonight. The camp drinks. You sleep. We plan the next door like people who intend to stay outside. They locked the future. We keep the key in a jug.`,
    },
  ];
}

export interface JournalEntry {
  title: string;
  body: string;
}

/** Unlocked entries, oldest last so the new one sits on top. */
export function journalEntries(v: StoryView): JournalEntry[] {
  const a = v.archetype;
  const out: JournalEntry[] = [];
  const add = (flag: string, title: string, body: string) => {
    if (v.has(flag)) out.push({ title, body });
  };
  add('briefed', 'The rule on the receipt', 'Take what the living need. Leave him alive if you can. The Compact is a radio net between camps that still answer, not an army and not a brand. Last Chance is a node because a neon sign still draws power from a panel Tanner\'s contractor abandoned. Day 1,284. The jugs are the point. Glory is how people end up on the other side of a lock.');
  add('briefed', a.name, a.journal);
  add('intel:intel.gas.note', 'Note on the pump island', 'A drone, a pallet, a neon garage, a man yelling about runway. The cistern is the last clean water in a day\'s walk. The names are in his safe. If you found the note, you are the one holding the radio.');
  add('cache.cooler', 'The cooler', 'Two bottles and a ration behind the pumps. Not enough. Proof the camp was telling the truth about being thirsty, which you already knew, and which hits different when the plastic is in your hand.');
  add('intel:intel.spire.blueprint', 'The fence he didn\'t buy', 'Change order on the Spire. Tanner refused the north fence because raccoons were "not a threat vector." The vault keypad is wired beside a 5-pin lock. He thinks the code is obvious. He did not write the obvious part down.');
  add('intel:intel.highway.greg', 'Greg, from the seed round', 'A customer. Paid two hundred thousand. Received a tote bag and a calendar invite that 404s. The manifest will have his name in the same column as the camp. The column is very long.');
  add('social.past', 'He remembers you', 'Tanner does not apologise. He rebrands. Whatever you were to him — courier, author, warehouse, the person on mute — he has a version where it was a feature. The version is not your job to fix. The door is.');
  add('social.told', 'Premium tier', 'He said the water is a product and you are on the free plan. He also said the Seed Manifest is a list of who paid, and that the vault code is "obvious" because users hate passwords. He was proud of both sentences.');
  add('social.digit', 'One, then two', 'He slipped the first half and called the call a bad podcast. Two digits left. He thinks the rest is obvious. He is the kind of man who is right about that and wrong about everything under it.');
  add('social.code', 'He said it out loud', '1 2 3 4. Tested well with users. The user was him. He will deny the call. The call happened. The keypad does not care about his denial.');
  add('garage.complete', 'The Runway Room', 'The safe had the manifesto, the water, and a hoodie with a company that built one building. The manifest\'s unpaid column is most of the world. The paid-and-housed column is short, and one of those names already knows you opened this door.');
  add('debriefed', 'Apex, west of the salt', 'Mara read the list into the radio. Vesper Kade answered without being asked. Apex Vault is real, it is west, and it is not on this map tonight. Act I ends with the camp drinking and you still outside. That is not a tease. That is the work.');
  add('seen:creek', 'Dry Creek', 'Not a town. A diner, a clinic with a sulking generator, a store that calls itself the Till, and a motel with two locked doors. Nia counts bottles. The job is still Tanner. These people are the part of the map that is not a bunker.');
  add('creek.guest', 'Guest book', 'Room 2 is three pins if your hands are worth a rank. Room 3 is nails. The Till has a stair that the sign says is a closet.');
  add('creek.hint.stair', 'Inez\'s closet', 'She says the back room is a closet. People who have been inside say it has steps. Lockpicking 3, a charge, or enough conversation that she admits to the key.');
  add('creek.loft', 'The page on the shelf', 'The landlord drew a ridge north of here and a cut in it. Wick answers the radio with silence. A woman with rocket money looked at a pocket in the rock and did not buy.');
  add('creek.doc.list', 'Doc\'s page', 'Half the names are the camp. Tanner sold them a bunker and shipped shakes. Doc kept the page because nobody else would file it.');
  add('creek.sol.locks', 'Sol, by the fire', 'Left motel room is open. Middle is a tired three-pin. Right is boards. The Till\'s closet is the lock you actually have to be good for.');
  add('creek.wash', 'The wash', 'North of the spire. Posts in a cut the ridge would rather not have. Wick is at the top. He does not come down for coffee.');
  add('cave.known', 'The cut in the ridge', 'North of the spire, up the posted wash. Not marked until someone tells you, or until you are standing in it. Wick lives with the view because nobody bought it.');
  add('cave.wick.vesper', 'She stood where you stood', 'Wick says Vesper called the Garage a prototype with bad numbers. He told her the prototype had his cousin\'s water. She painted her name in a pocket of the rock and left.');
  add('cave.pocket.loot', 'Didn\'t buy', 'The paint says V. K. looked and didn\'t buy. The crate under it was labelled like a person who thinks a label is a deed.');
  return out.reverse();
}

/** What the corner of the screen should be saying when the Garage itself isn't giving orders. */
export function storyObjective(v: StoryView): string {
  if (v.has('debriefed')) {
    return 'Act I closed. The manifest names Vesper Kade, Apex Vault, west of the salt. That door is not on this map yet. Dry Creek still answers if you knock. Rest. Stay outside.';
  }
  if (v.has('garage.complete')) {
    return 'Radio Mara at the campfire. She wants the Seed Manifest read out loud.';
  }
  if (!v.has('intel:intel.gas.note')) {
    return 'Read the note on the pump island, north of the fire. Search the cooler. The camp is thirsty for a reason.';
  }
  if (!v.has('seen:garage') && !v.has('garage.marker')) {
    return 'The Garage is northeast, off the highway spur. The Spire blueprint is optional, and it is the easy fence.';
  }
  if (!v.has('intel:intel.spire.blueprint')) {
    return 'The Garage is marked. Pick, talk, or blow the lock. Optional: the Spire has the fence Tanner never paid for.';
  }
  return 'Get into the Garage. The water and the Seed Manifest are in the vault. Bring both back to the fire.';
}

export interface WorldCache {
  id: string;
  /** World XZ. Y is dropped onto the ground. */
  x: number;
  z: number;
  label: string;
  /** Toast the first time you walk into earshot, so a cache without a beacon is still findable. */
  approach: string;
  xp: number;
  items: { id: string; qty: number }[];
  /** Zap the untrained. Teaches the Electronics rank without a new prop. */
  shockWithoutElectronics?: boolean;
}

export const WORLD_CACHES: WorldCache[] = [
  {
    id: 'cache.cooler',
    x: -142,
    z: 122,
    label: 'Search the cooler',
    approach: 'A cooler by the pumps. Mara said it still had water.',
    xp: 20,
    items: [
      { id: 'water', qty: 2 },
      { id: 'ration', qty: 1 },
      { id: 'scrap', qty: 3 },
    ],
  },
  {
    id: 'cache.mast',
    x: 176,
    z: 194,
    label: 'Salvage the mast battery',
    approach: 'The fallen mast still has cells on it. Careful if you don\'t speak electronics.',
    xp: 20,
    items: [
      { id: 'battery', qty: 2 },
      { id: 'scrap', qty: 2 },
    ],
    shockWithoutElectronics: true,
  },
];
