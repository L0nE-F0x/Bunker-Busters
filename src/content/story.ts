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
 * Act I: The Cistern.
 *
 * The Great Pivot was the afternoon the markets, the grid and the sky failed together. The people
 * who had been selling the future were already inside it. Day 1,284: the camps that still answer a
 * radio call themselves the Surface Compact. They are not an army. They are thirsty.
 *
 * Beginning. Last Chance has three days of water. Tanner Pivotson's drone has been lifting the
 *   camp's jugs off the highway. Mara Voss sends you for his cistern and the Seed Manifest.
 * Middle. Dry Creek used to sit on a creek. The county sold the aquifer to Kade Holdings the summer
 *   before the Pivot (the permit is signed M. Voss). Bunkr.ly never sold bunkers: it resold seats in
 *   Vesper Kade's Apex Vault, and Vesper only takes water now. Every jug SeedBot lifted went west to
 *   keep Tanner on her waitlist (#4,012).
 * Turn. The manifest's last page is the Seed: the few Vesper is keeping. Mara is on it, "for services
 *   rendered". Vesper cuts into the debrief and offers a deal for the ledger.
 * End. You decide: read the names on the open net, keep the ledger as leverage, or trade it for water.
 * Hook. Whatever you chose, the water is on a clock, and the rest of it is in Apex Vault, west of the salt.
 *
 * The rule, written on the back of a receipt: take what the living need. Leave him alive if you
 * can. Don't become the person on the other side of the lock.
 */

export function briefingFor(a: ArchetypeDef): StoryPage[] {
  return [
    {
      speaker: 'Mara Voss · Last Chance radio',
      text:
        'If you can hear this, you\'re still outside. Good. That\'s the job. Day 1,284 after the Pivot. Last Chance has three days of water, if Pip counts generously. Tanner Pivotson\'s drone has been lifting our jugs off the highway all week.',
    },
    {
      speaker: 'Mara Voss',
      text:
        'Before the Pivot, Tanner ran Bunkr.ly. "Uber for bunkers." Somehow he still has a cistern and we don\'t. In his vault he keeps a ledger he calls the Seed Manifest: everyone who paid him, and who actually got a door. We need the water tonight. We need the names because names are how you find the next door.',
    },
    { speaker: 'Mara Voss', text: a.briefing },
    {
      speaker: 'Mara Voss',
      text:
        'The rule of the Compact, on the back of a receipt: take what the living need. Leave him alive if you can. Don\'t become the person on the other side of the lock. Somebody pinned a note on the pumps by this fire. Read it. Dry Creek is west of the highway, diner light still on. Tab is your kit, K your skills, J your journal. Mara, out.',
    },
  ];
}

/**
 * Raising Mara from the camp before the debrief. Progress-aware, and some calls teach her a flag
 * (the ColdStorage errand, the permit conversation). The caller sets `flags` after the call.
 */
export function campRadio(v: StoryView): { pages: StoryPage[]; flags: string[] } {
  const a = v.archetype;
  if (v.has('debriefed')) {
    const how = v.has('act1.broadcast')
      ? 'Every camp on the band is angry at the same person. That has never happened before. I\'m trying to enjoy it.'
      : v.has('act1.leverage')
        ? 'The ledger is in the ammo tin under the radio. Vesper\'s free trial is still arriving. I check the date every morning.'
        : 'Her jugs came on time this week. I hate how relieved I am.';
    return {
      pages: [
        { speaker: 'Mara Voss', text: `${a.name}. ${how}` },
        {
          speaker: 'Mara Voss',
          text: 'Apex Vault is west of the salt, and the road isn\'t open yet. Until it is: Dry Creek. Anyone there who trusts you will walk with you. Ask them. Then come back and sleep.',
        },
      ],
      flags: [],
    };
  }
  if (v.has('lore.permit') && !v.has('mara.permit')) {
    return {
      pages: [
        { speaker: 'Mara Voss', text: 'You found the clipboard. Go on. Say it.' },
        {
          speaker: 'Mara Voss',
          text: 'Yes, that\'s my name. I was the county water engineer. Kade Holdings wanted a "pilot" on the Dry Creek aquifer, and they offered the town a new school. It had a rocket on the sign. I signed.',
        },
        {
          speaker: 'Mara Voss',
          text: 'Eight months later the creek stopped. The school is a crater now. I\'ve been paying it back in jugs ever since. Don\'t tell Pip. Pip already knows. Pip knows everything.',
        },
      ],
      flags: ['mara.permit'],
    };
  }
  if (!v.has('intel:intel.gas.note')) {
    return {
      pages: [
        {
          speaker: 'Mara Voss',
          text: `${a.name}. Still here? The note is on the pumps, a few steps from this fire. Read it. Check the cooler behind them, too. Then go spend that skill point on how you actually get in: a pick, a circuit, a charge, or his mouth.`,
        },
      ],
      flags: [],
    };
  }
  const pages: StoryPage[] = [];
  if (!v.has('garage.complete')) {
    if (v.has('tanner.kade') || v.has('lore.valve')) {
      pages.push({
        speaker: 'Mara Voss',
        text: 'So he pays Kade Holdings. In our water. He\'s not hoarding it, he\'s paying rent with it. That\'s almost worse. Get the ledger anyway. If he\'s a middleman, the ledger is the map to the top.',
      });
    } else if (v.has('seen:garage')) {
      pages.push({
        speaker: 'Mara Voss',
        text: 'You\'ve seen the place. Fence, drone, megaphone. SeedBot\'s battery is a joke and he knows it. If a door won\'t open, there\'s always a second way: the intercom, the fence, the fuse box. Don\'t die on a door this small.',
      });
    } else if (v.has('intel:intel.spire.blueprint')) {
      pages.push({
        speaker: 'Mara Voss',
        text: 'The Garage is northeast, up the dirt spur off the highway. The Spire blueprint says he never paid for the north-east fence. Raccoons were "not a threat vector". Be a raccoon.',
      });
    } else {
      // before you've found the blueprint: point at it, don't quote it
      pages.push({
        speaker: 'Mara Voss',
        text: 'The Garage is northeast, up the dirt spur off the highway. Whoever built it for him drew it up at the Spire. If there\'s a weak spot in that fence, it\'s on their paper. Read it before you climb anything.',
      });
    }
  }
  if (!v.has('mara.coldstorage')) {
    pages.push({
      speaker: 'Mara Voss',
      text: 'One more thing, when you have legs for it. ColdStorage, the data centre far northeast. It\'s still warm. Warm means power, and power out here means somebody is still paying. I\'d like to know who.',
    });
  }
  if (!pages.length) {
    pages.push({ speaker: 'Mara Voss', text: `${a.name}. Water, then names. The rest can wait. Mara, out.` });
  }
  return { pages, flags: ['mara.coldstorage'] };
}

/** The debrief, up to the choice. */
export function debriefFor(a: ArchetypeDef, v: StoryView): StoryPage[] {
  const pages: StoryPage[] = [
    {
      speaker: 'Mara Voss',
      text: `${a.name}. You sound like someone who met him. The jugs are on Pip's ledger. I'm not going to applaud. I'm going to read.`,
    },
    {
      speaker: 'Mara Voss',
      text:
        'Bunkr.ly never sold bunkers. It resold seats in Apex Vault, and Vesper Kade only takes payment in water. Every jug SeedBot lifted off our road went west, to keep Tanner on her waitlist. He\'s number four thousand and twelve. He was never getting in.',
    },
    {
      speaker: 'Mara Voss',
      text:
        'Half this list paid in full and got a tote bag. Greg is here. Last Chance is here: "delivery exception, unresolved", with a smiley face. And at the back there\'s a short list headed THE SEED. The people Vesper is keeping. Rocket money, two senators, a man who invented a font.',
    },
    {
      speaker: 'Mara Voss',
      text: v.has('mara.permit')
        ? 'And me. "M. Voss, County Water. Seat held for services rendered." You already know which services. I signed her a creek. Apparently that\'s a reservation.'
        : 'And me. "M. Voss, County Water. Seat held for services rendered." I signed Kade Holdings the Dry Creek aquifer, before the Pivot, for a school. Apparently that\'s a reservation.',
    },
  ];
  if (a.id === 'defector') {
    pages.push({
      speaker: 'Mara Voss',
      text: 'Theo, you\'re on here too. Crossed out, in red, with "WALKED" next to it. Somebody at Apex has a sense of humour, or a grudge.',
    });
  }
  pages.push(
    {
      speaker: 'Vesper Kade',
      text:
        'Hi, thieves! Love the initiative. That ledger is my customer list, and you\'re reading it on an open channel, which is rude. Here\'s my offer. Send it back, and Last Chance gets a community allocation. Twenty jugs a week, forever-ish. Or keep it, and stay thirsty on principle.',
    },
    {
      speaker: 'Mara Voss',
      text: `She's on our band. Dez said she would be. I didn't invite her. ${a.name.split(' ')[0]}, you carried it home. You decide what we do with it.`,
    },
  );
  return pages;
}

export const DEBRIEF_CHOICE = {
  speaker: 'Mara Voss',
  text: 'The ledger is on the table. Vesper is listening. What do we do with it?',
  choices: [
    { id: 'broadcast', label: 'Read every name on the open net.' },
    { id: 'leverage', label: 'Keep it quiet. Make her pay for our silence.' },
    { id: 'deal', label: 'Take her deal. Twenty jugs is twenty jugs.' },
  ],
};

export type DebriefChoice = 'broadcast' | 'leverage' | 'deal';

/** After the choice. Ends Act I and opens the road to Apex. */
export function epilogueFor(a: ArchetypeDef, choice: DebriefChoice): StoryPage[] {
  const first = a.name.split(' ')[0];
  const close: StoryPage = {
    speaker: 'Mara Voss',
    text: `${a.coda} Apex Vault is west of the salt, and that road isn't open tonight. The camp drinks. You sleep. Act I ends here.`,
  };
  if (choice === 'broadcast') {
    return [
      {
        speaker: 'Mara Voss',
        text: 'Then we read. All of it. Every camp on the band, every name, every tote bag. Somewhere out there, Greg is crying into his wifi router.',
      },
      {
        speaker: 'Vesper Kade',
        text: 'Bold. Okay. Free tier it is. The spur valve is closed as of now. Your cistern has maybe two weeks in it. If you want to complain, Apex Vault is west of the salt. Bring the ledger. My doors listen. Most doors don\'t.',
      },
      {
        speaker: 'Mara Voss',
        text: `Two weeks of water, and every camp on the net angry at the same person, for once. That's not a plan, ${first}. It's a start. When we go west, we go together.`,
      },
      close,
    ];
  }
  if (choice === 'leverage') {
    return [
      {
        speaker: 'Mara Voss',
        text: 'Fine. The ledger goes in the ammo tin under the radio. Vesper, you heard: we have it, we\'re keeping it, and we\'re thirsty.',
      },
      {
        speaker: 'Vesper Kade',
        text: 'Smart! Silence is a subscription. There\'s a drone drop on its way. Think of it as a free trial. When the trial ends, come see me at Apex, west of the salt. Bring the ledger. Bring nobody else\'s name.',
      },
      {
        speaker: 'Mara Voss',
        text: `She thinks she bought us. She rented us. Rentals end, ${first}. When this one does, we go west with the list in our pocket.`,
      },
      close,
    ];
  }
  return [
    {
      speaker: 'Mara Voss',
      text: 'Okay. Pip, stop looking at me like that. We\'re drinking. Vesper, the ledger goes back on your drone. All of it.',
    },
    {
      speaker: 'Vesper Kade',
      text: 'Pleasure doing business! Twenty jugs a week. "Forever" is a figure of speech, legally. Welcome to the community.',
    },
    {
      speaker: 'Mara Voss',
      text: `We drink. I'll hate it every single time. When the jugs stop, and they will, Apex is west of the salt, and I'm going to knock, ${first}. Loudly.`,
    },
    close,
  ];
}

export interface JournalEntry {
  title: string;
  body: string;
}

/** The story so far. Unlocked entries, newest first. */
export function journalEntries(v: StoryView): JournalEntry[] {
  const a = v.archetype;
  const out: JournalEntry[] = [];
  const add = (flag: string, title: string, body: string) => {
    if (v.has(flag)) out.push({ title, body });
  };
  add('briefed', 'The rule on the receipt', 'Take what the living need. Leave him alive if you can. Don\'t become the person on the other side of the lock. The Compact is a radio net between camps that still answer: not an army, not a brand. Day 1,284. The jugs are the point.');
  add('briefed', a.name, a.journal);
  add('intel:intel.gas.note', 'The note on the pumps', 'SeedBot flew northeast with the camp\'s water and the meal shakes. A fenced garage off the dirt spur, neon, and a man yelling about runway. The cistern is on his lot. The names are in his safe.');
  add('cache.cooler', 'The cooler', 'Two bottles and a ration behind the pumps. Not enough. Proof the camp wasn\'t exaggerating, which you knew, and which feels different with the plastic in your hand.');
  add('intel:intel.spire.blueprint', 'The fence he didn\'t buy', 'Change order on the Spire: Tanner refused the north-east fence because raccoons were "not a threat vector". The vault has a 5-pin lock and a keypad. He thinks the code is obvious. He never wrote the obvious part down.');
  add('intel:intel.highway.greg', 'Greg, from the seed round', 'A customer. Paid two hundred thousand for a bunker and got a tote bag and a calendar invite that 404s. Greg would settle for the wifi password.');
  add('lore.valve', 'Spur valve 3', 'A Kade Holdings valve tag on the dirt spur below the Garage. "Reseller access: BUNKR.LY. Quota: forty jugs a week. Late payment forfeits waitlist position." Tanner isn\'t hoarding water. He\'s paying rent with it.');
  add('tanner.kade', 'Who Tanner pays', 'Tanner admitted it on the intercom: Bunkr.ly resold seats in Apex Vault, and Vesper Kade only takes water now. He\'s on her waitlist. Number four thousand and twelve.');
  add('lore.permit', 'Permit 7-K', 'A county clipboard on the highway. Kade Holdings got a perpetual "pilot" on the Dry Creek aquifer, in exchange for a rocket-themed school. Approved: M. Voss, County Water Engineer.');
  add('mara.permit', 'Mara\'s signature', 'Mara owned it on the radio. She signed for the school. Eight months later the creek stopped. She\'s been paying it back in jugs ever since.');
  add('social.past', 'He remembers you', 'Tanner doesn\'t apologise. He rebrands. Whatever you were to him, he has a version where it was a feature. Fixing his version isn\'t your job. The door is.');
  add('social.digit', 'One, then two', 'He slipped the first half of the vault code and called the call a bad podcast. Two digits left. He thinks the rest is obvious. He\'s right about that, and wrong about everything under it.');
  add('social.code', 'He said it out loud', '1 2 3 4. It tested well with users. The user was him.');
  add('garage.complete', 'The Runway Room', 'The safe had the water, the manifest and a hoodie from a company that built one building. The manifest\'s unpaid column is most of the valley. The paid-and-housed column is short.');
  add('debriefed', 'The Seed', 'The last page of the manifest is the Seed: the few Vesper Kade is keeping. Mara is on it, "for services rendered". Vesper cut into the debrief and offered twenty jugs a week for the ledger.');
  add('act1.broadcast', 'Every name, on air', 'You read the whole ledger to every camp on the band. Vesper closed the spur valve. The cistern has about two weeks in it. Apex Vault is west of the salt.');
  add('act1.leverage', 'The ammo tin', 'You kept the ledger quiet and let Vesper pay for the silence. Her drone drop is a free trial. Trials end. Apex Vault is west of the salt.');
  add('act1.deal', 'Twenty jugs a week', 'You sent the ledger back. The camp drinks on Vesper\'s schedule. Nobody believes "forever". Apex Vault is west of the salt.');
  add('seen:creek', 'Dry Creek', 'A diner, a clinic with a sulking generator, a store called the Till, and a motel with two locked doors. It used to sit on a creek. These people are the part of the map that isn\'t a bunker.');
  add('creek.guest', 'Guest book', 'Room 2 is three pins, if your hands are worth a rank. Room 3 is nailed shut. The Till has a stair that the sign calls a closet.');
  add('creek.loft', 'The page on the shelf', 'The landlord drew a ridge south of the Spire with a cut in it, and left the Till\'s deed signed over to "whoever is still here". Somebody with rocket money looked at a pocket in that ridge and didn\'t buy.');
  add('creek.doc.list', 'Doc\'s page', 'Half the names on it are from the camps. Tanner sold them a bunker health plan and shipped them tote bags. Doc kept the page because nobody else would.');
  add('cave.known', 'The cut in the ridge', 'South of the Spire, up the posted wash. Wick lives up there with the view, because nobody bought it.');
  add('arms.v5', 'Hollis\'s revolver', 'Hollis handed over the camp\'s old six-shooter and a crowbar with the paint worn to steel. "The road has teeth now," he said. Kade\'s Recovery crews walk the highway, and the wolves stopped keeping their distance. Rounds are scrap and patience at the fire.');
  add('seen:survey', 'Survey stakes', 'Kade\'s surveyors are pricing the ridge north of the camp. White hard hats, respirators, lanyards with smiling photos. They log everything, including the people they shoot.');
  add('seen:rp7', 'Recovery Point 7', 'Where Kade stacks what it repossesses: water jugs, a vending machine, somebody\'s piano. A sentry by the wall says please before it fires.');
  add('seen:pipeline', 'The line west', 'A pipe on stands runs west out of Pipeline Camp 3, and the skid beside it hums. Painted on the casing: WATER IS A SERVICE. A Hornet drone circles the pad at night. The ground round it is mined.');
  add('seen:wellhead', 'Where the creek went', 'South-west of Dry Creek, the aquifer comes up through a Kade wellhead into a tank with her name on it, then west down the pipe. The creek didn\'t dry up. It was moved. Juno was right, and the proof is guarded by five rifles, two sentries and a minefield.');
  add('outpost.wellhead.cleared', 'Opened the tap', 'You took the wellhead. The tank is still Kade\'s, and Kade will send more people; Kade always sends more people. But for a while the water under Dry Creek was nobody\'s, which is the closest thing to everybody\'s it has been in years.');
  add('intel:intel.salt.waybill', 'Her road', 'A Kade waybill on the salt: forty jugs a week down a private road to Apex Vault, off the highway\'s west end and along the shore. The driver walked. The truck stayed. Vesper posted about it.');
  add('seen:apex', 'Apex Vault', 'A launch site at the foot of the range on the salt\'s west shore: a stainless booster held up by a tower, a hangar with her feed over the door, and a vault dug into the hill. Every camera there is live. She is always watching, and always posting.');
  add('apex.code', 'The launch clock', 'The airlock code is the countdown over the door, hours and minutes to her launch. It is never the same twice. She calls that zero trust. Her guards call it their knees.');
  add('apex.demo', 'A fan, on tour', 'You told Vesper you were a fan and she let you into the hangar for content. Somewhere there is a clip of you looking unimpressed by a truck.');
  add('apex.complete', 'The Cistern Room', 'A tank with her name on it, the valley\'s water inside, and a framed poll on the wall: should the camps get water? 88% said lol. The tap still works. The cistern runs east.');
  add('q:act2:done', 'The Panopticon', 'Dez caught it on the band after Apex: a building on the old coast with no windows and a lot of antennas. Somebody who sold the world a feed kept a copy of it. It read our names back before we said them.');
  add('cave.wick.vesper', 'She stood where you stood', 'Wick says Vesper Kade called the Garage a prototype with bad unit economics. He told her the prototype had his cousin\'s water. She painted her initials in a pocket of the rock and left.');
  return out.reverse();
}

/** Corner text when no quest is giving orders (the quest runtime normally answers first). */
export function storyObjective(v: StoryView): string {
  if (v.has('apex.complete')) return 'Apex is busted and the water runs east. Something on the band is calling itself the Panopticon.';
  if (v.has('debriefed')) return 'Act I is done. Apex Vault is west of the salt. Ask Dry Creek who would come.';
  if (v.has('garage.complete')) return 'Radio Mara from the campfire. She wants the Seed Manifest read out loud.';
  if (!v.has('intel:intel.gas.note')) return 'Read the note on the pumps by the fire. Search the cooler behind them.';
  if (!v.has('seen:garage')) return 'Find the Garage: northeast, up the dirt spur off the highway.';
  return 'Get into the Garage. The water and the Seed Manifest are in the vault.';
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
