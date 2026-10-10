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
  // Act II's debrief: the water came east, and the band is talking about how you got in
  if (v.has('apex.complete') && !v.has('act2.debriefed')) return { pages: apexDebrief(v), flags: ['act2.debriefed'] };
  if (v.has('act2.debriefed')) {
    return {
      pages: [
        { speaker: 'Mara Voss', text: 'The cistern\'s holding. Vesper posts about it every hour. Ezra hasn\'t said a word since he read our names, and that\'s worse.' },
        { speaker: 'Mara Voss', text: 'North of the salt. Eleven hundred cameras. When you go, you go knowing he watched you leave. Mara, out.' },
      ],
      flags: [],
    };
  }
  // the founders' favours, when there's news Mara would have heard: one call each
  if (v.has('q.chat.mara') && !v.has('mara.chat')) {
    return {
      pages: [
        { speaker: 'Mara Voss', text: 'I read the chat. Twice. "The county signed it in an afternoon." It was an afternoon. It was a Tuesday. I had a sandwich.' },
        { speaker: 'Mara Voss', text: 'It\'s in the ammo tin with the ledger. If there\'s ever a court again, it goes in first. And Ezra. Eleven hundred cameras. He watched all of it. A man who sees everything is either the worst person in the valley, or the only witness. Possibly both.' },
      ],
      flags: ['mara.chat'],
    };
  }
  if (v.has('q.capsule.mara') && !v.has('mara.capsule')) {
    return {
      pages: [
        { speaker: 'Mara Voss', text: 'She hoped she\'d have a pool. That\'s what was in it. I signed away a creek and an eleven-year-old hoped for a pool.' },
        { speaker: 'Mara Voss', text: 'I held the chalk. That\'s all I\'m going to say about it on an open channel. Thank you for letting me be the one. Mara, out.' },
      ],
      flags: ['mara.capsule'],
    };
  }
  if (v.has('q.cam.hello') && !v.has('mara.ezra')) {
    return {
      pages: [
        { speaker: 'Mara Voss', text: 'Hollis says you talked to the camera. To a man called Ezra. Who knows how much we drink.' },
        { speaker: 'Mara Voss', text: 'Fine. Then he knows how little. Write his name down next to Vesper\'s. North of the salt. One door at a time.' },
      ],
      flags: ['mara.ezra'],
    };
  }
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
          text: 'Apex Vault is on the far shore of the salt. Her road leaves the highway at the west end, south past Dry Creek, and Kade sits on it. Ask Dry Creek first: anyone there who trusts you will walk with you.',
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
  add('briefed', 'The rule on the receipt', 'Take what the living need. Leave him alive if you can. Don\'t become the person on the other side of the lock. The Compact is a radio net between the camps that still answer. It isn\'t an army. Day 1,284, and Last Chance is running out of water.');
  add('briefed', a.name, a.journal);
  add('intel:intel.gas.note', 'The note on the pumps', 'The drone took the camp\'s water and the meal shakes northeast, to a fenced lot up the dirt spur. Neon, solar panels, a man on a megaphone. His cistern is on that lot, and the ledger of everyone who paid him is in his safe.');
  add('cache.cooler', 'The cooler', 'Two bottles and a ration in the cooler behind the pumps. That\'s all that was left.');
  add('intel:intel.spire.blueprint', 'The fence he didn\'t buy', 'The contractor\'s drawing at the Spire. Tanner had the north-east fence cut from the job ("raccoons are not a threat vector"), so the corner panel is only tied on with wire. The vault has a 5-pin lock and a keypad. The code is blacked out. His note in the margin says to make it obvious.');
  add('intel:intel.highway.greg', 'Greg, from the seed round', 'A voicemail on the highway call box. Greg paid Tanner two hundred thousand for a bunker seat and got a tote bag and a calendar invite with a broken link. He\'d settle for the wifi password.');
  add('lore.valve', 'Spur valve 3', 'A Kade Holdings tag on a valve on the dirt spur below the Garage. Reseller: Bunkr.ly. Quota: forty jugs a week. Late payment forfeits waitlist position. Tanner isn\'t keeping the camp\'s water. He\'s paying Kade with it.');
  add('tanner.kade', 'Who Tanner pays', 'Tanner admitted it on the intercom. Bunkr.ly resold seats in Vesper Kade\'s Apex Vault, and Vesper only takes water now. Tanner is on her waitlist himself, at number 4,012.');
  add('lore.permit', 'Permit 7-K', 'A county clipboard on the highway. Kade Holdings got a perpetual "pilot program" on the Dry Creek aquifer in exchange for a school with a rocket on the sign. Approved by M. Voss, County Water Engineer.');
  add('mara.permit', 'Mara\'s signature', 'Mara admitted it on the radio. She signed for the school, and eight months later the creek stopped. She\'s been paying it back in jugs ever since.');
  add('social.past', 'He remembers you', 'Tanner knew who you were on the intercom. He didn\'t apologise for anything. He has his own version of how it went, and in his version it was fine.');
  add('social.digit', 'One, then two', 'Tanner let the first two digits of the vault code slip on the intercom: one, then two. He says the rest is obvious.');
  add('social.code', 'He said it out loud', 'Tanner said the vault code out loud: 1 2 3 4. "It tested well with users." The user was him.');
  add('garage.complete', 'The Runway Room', 'The safe had the water, the Seed Manifest and a hoodie from a company that only ever built one bunker. Most of the valley is in the manifest\'s unpaid column. The paid-and-housed column is short.');
  add('debriefed', 'The Seed', 'The last page of the manifest is headed THE SEED: the few people Vesper Kade is keeping. Mara is on it, "seat held for services rendered". Vesper broke into the camp\'s band during the debrief and offered twenty jugs a week for the ledger.');
  add('act1.broadcast', 'Every name, on air', 'The whole ledger went out to every camp on the band. Vesper shut the spur valve. The cistern has about two weeks in it. Apex Vault is west of the salt.');
  add('act1.leverage', 'The ammo tin', 'The ledger stays in Mara\'s ammo tin, and Vesper pays for the silence with a drone drop she calls a free trial. Trials end. Apex Vault is west of the salt.');
  add('act1.deal', 'Twenty jugs a week', 'The ledger went back to Vesper. The camp drinks on her schedule now, twenty jugs a week. Nobody believes "forever". Apex Vault is west of the salt.');
  add('seen:creek', 'Dry Creek', 'A diner, a clinic with an unreliable generator, a store called the Till and a motel with two locked doors. It used to sit on a creek. People still live here, and they\'ve been out here longer than the camp.');
  add('creek.guest', 'Guest book', 'From the motel guest book: room 2 is three pins, room 3 is nailed shut, and the Till has a stair that the sign calls a closet.');
  add('creek.loft', 'The page on the shelf', 'The Till\'s landlord left a map of the ridge south of the Spire with a cut drawn in it, and the deed to the Till signed over to "whoever is still here". A note on the map says a woman with rocket money looked at a pocket in that ridge and didn\'t buy it.');
  add('creek.doc.list', 'Doc\'s page', 'Half the names on Doc\'s list are from the camps. Tanner sold them a bunker health plan and sent them tote bags. Doc kept the list because nobody else was going to.');
  add('cave.known', 'The cut in the ridge', 'South of the Spire, up the wash with the posts in it. A man called Wick lives at the top.');
  add('arms.v5', 'Hollis\'s revolver', 'Hollis gave you the camp\'s old six-shooter and a crowbar with the paint worn off. "The road has teeth now." Kade\'s Recovery crews walk the highway, and the wolves have stopped keeping their distance. The camp can load rounds from scrap.');
  add('seen:survey', 'Survey stakes', 'Kade surveyors are working the slope below the Cut. White hard hats, respirators, lanyards with smiling photos. They log everything, including who they shoot.');
  add('seen:rp7', 'Recovery Point 7', 'Where Kade stacks whatever it repossesses: water jugs, a vending machine, somebody\'s piano. The sentry by the wall says please before it fires.');
  add('seen:pipeline', 'The line west', 'A pipe on stands runs west out of Pipeline Camp 3, past a pumping skid that hums. WATER IS A SERVICE is painted on the casing. A Hornet drone circles the pad at night, and the ground around it is mined.');
  add('seen:wellhead', 'Where the creek went', 'South-west of Dry Creek, the aquifer comes up through a Kade wellhead into a tank with her name on it, then goes west down the pipe. The creek didn\'t dry up. Someone moved it. Five rifles, two sentries and a minefield guard the tank.');
  add('outpost.wellhead.cleared', 'Opened the tap', 'You took the wellhead. The tank is still Kade\'s, and they\'ll send more people. For a while, though, the water under Dry Creek belongs to nobody.');
  add('intel:intel.salt.waybill', 'Her road', 'A Kade waybill out on the salt: forty jugs a week down a private road to Apex Vault, off the west end of the highway and along the shore. The last driver walked off and left the truck.');
  add('seen:apex', 'Apex Vault', 'A launch site at the foot of the range on the salt\'s west shore. A steel booster in a tower, a hangar with her feed playing over the door, and a vault dug into the hill. Every camera there is live, and she\'s usually watching.');
  add('apex.code', 'The launch clock', 'The airlock code is the countdown over the door, hours and minutes to her launch, so it\'s never the same twice. She calls it zero trust.');
  add('apex.demo', 'A fan, on tour', 'You told Vesper you were a fan, and she let you into the hangar so she could film it. There\'s a clip of you somewhere, looking unimpressed by her truck.');
  add('apex.complete', 'The Cistern Room', 'A tank with her name on it and the valley\'s water inside, and a framed poll on the wall: should the camps get water? 88% said "lol". The tap still works. The water is going east.');
  add('intel:intel.apex.memo', 'Your guests', 'A memo on Vesper\'s cot from somewhere called the Panopticon. Every face that crossed her apron, matched and ranked, in exchange for her water. At the bottom: "We can see whoever is reading this. Hi."');
  add('q:act2:done', 'The Panopticon', 'After Apex, Dez picked it up on the band: a building on the old coast north of the salt, with no windows and a lot of antennas. Whoever is in there read the camp\'s names back before anyone had said them.');
  add('cave.wick.vesper', 'Vesper in the Cut', 'Wick says Vesper Kade once called the Garage a prototype with bad unit economics. He told her the prototype had his cousin\'s water in it. She painted her initials in a pocket of the rock and left.');
  // the founders, from the outside (WORLD_INTEL's lore pickups and the four favours that hang off them)
  add('lore.lifeboat', '#LIFEBOAT', 'A group chat the founders kept before the Pivot: Vesper Kade, Hunter Vale, Ezra Seymour, Prudence Ashby, Orrin, Kit, and Tanner, who kept getting removed and coming back. Every device that died out here kept its last page. Dez hears them trying to sync at three in the morning.');
  add('lore.pivotname', 'Everybody forgives a pivot', '"Collapse" was bad for the brand. "Transition" and "sunset" didn\'t stick. Ezra said "pivot" and Vesper made it official. They had a name for it before it happened.');
  add('lore.panopticon', 'Eleven hundred cameras', 'Ezra Seymour built Glimpse, the neighbourhood app that never forgot a face, and then a bunker north of the salt that he calls the Panopticon: eleven hundred cameras, every one pointed at someone. Prudence Ashby built the Alignment Spire, and Kit built a Fortress with a moat of coolant. Apex is only the next one.');
  add('lore.spire', 'The wrong spire', 'Careful Labs left a notice at the 5G tower for anyone looking for the Alignment Spire: wrong spire, and please don\'t look for the right one. Its doors ask ethics questions. Its turrets apologise first.');
  add('lore.walkwest', 'The walk west', 'People walked west toward Apex on Bunkr.ly receipts, because someone told them the line moves faster if you\'re already in it. Marcus Bell, waitlist 88,301, didn\'t get past the west road. He carried his water in a tote bag.');
  add('lore.kdry', 'KDRY 1340 AM', 'Dry Creek\'s radio station stayed on the air the afternoon of the Pivot: reading the market numbers, warning about the sky, talking to whoever was left. Kade cancelled its 2:30 ad. The log is signed R. Varga.');
  add('lore.kadekids', 'Kade Kids Academy', 'The school Mara traded the creek for. Rocket backpacks, lifetime refillable bottles, and a brochure that promised "100% managed water" by 2046. It\'s a crater now.');
  add('q.capsule.dug', 'Class of Tomorrow', 'The time capsule was barely buried: twenty-two envelopes, a lanyard, and a letter to the children of 2046 congratulating them on their Kade citizenship. One envelope says TO PIP OKAFOR, AGE 23.');
  add('q.cam.seen', 'Unit 0414', 'A Glimpse camera on a pole by the camp road, blinking blue, uploading the forecourt to a relay on the rise. Three years of footage of Hollis fixing the sign and Pip counting jugs.');
  add('q.cam.hello', 'Ezra Seymour', 'He answered the relay on the first press. He knew your water ration and which foot you favour. He lives north of the salt in the Panopticon, and says he\'ll know when you\'re close.');
  add('q.song.asked', 'Rosa Varga', 'Sol\'s wife ran KDRY out of the back of the feed store and stayed on the air until the generator quit. She played one last song, "for whoever is still here". Sol was out opening someone\'s car and never heard which one.');
  if (v.has('q.chat.air') || v.has('q.chat.mara') || v.has('q.chat.pip')) {
    out.push({
      title: '#LIFEBOAT, reassembled',
      body: v.has('q.chat.air')
        ? 'All eight pages, read out on the open band by Dez, voices and all. Every camp heard the founders name the end of the world like a product. Vesper\'s carrier went silent for a day.'
        : v.has('q.chat.mara')
          ? 'All eight pages, in Mara\'s ammo tin with the ledger. She calls it evidence. Ezra has watched every camp for three years, and Mara thinks that could matter one day.'
          : 'All eight pages, copied into the back of Pip\'s ledger under THE OTHER COLUMN. Pip plans to read it out at the trial.',
    });
  }
  // the 2026-10-10 sites (src/game/sites/booster.ts, waitlist.ts, solar.ts)
  add('seen:booster', 'The Longshot', 'A Kade booster on its side in the north basin, KADE three metres tall down the tank. Kade taped it off and never came back for it.');
  add('site.booster.done', 'Pad B', 'The flight recorder kept her voice: "Land it at the pad." It didn\'t. The pod was Vesper\'s own resupply, glacier water flown in from Iceland. Her note on the manifest: "No Kade water on board. I know where it\'s been." Pad B is west of the salt.');
  add('seen:waitlist', 'Waitlist City', 'A bunker called Everafter, set into the mountain at the head of the south-east basin, and the four thousand people who queued for it. The board says NOW SERVING 0001. Somebody still keeps a fire going.');
  add('site.waitlist.done', 'Twelve residents', 'The service door opened on the grand-opening date. Behind it: Kade jugs, forty a week by drone, for the twelve people inside. The line outside was never going to move.');
  add('seen:solar', 'Photon Park', 'A solar farm in the basin south of camp that still powers Everafter. The cleaning robots never stopped. Nobody has paid the bill since the Pivot.');
  add('site.solar.done', 'Pulled the plug', 'You threw Photon Park\'s main breaker. Everafter is running on its backup cell, and its locks fail open. The robots are still cleaning.');
  return out.reverse();
}

/** Corner text when no quest is giving orders (the quest runtime normally answers first). */
/**
 * Act II's debrief at the fire, after Apex: Mara and Dez on how you got in (talked, the vent, the
 * splice, the clock; loud or quiet, from the flags Apex keeps), then Ezra, who was listening.
 */
export function apexDebrief(v: StoryView): StoryPage[] {
  const first = v.archetype.name.split(' ')[0];
  const pages: StoryPage[] = [
    { speaker: 'Mara Voss', text: `${first}. The water came in at dawn. Pip counted the jugs twice and cried once, which she says was dust. The cistern runs east. Dez has been on the band all night. Dez, tell it.` },
  ];
  const how = v.has('apex.demo')
    ? 'You talked your way in. She gave you a tour. A tour! She posted a clip of you looking unimpressed by her truck, and it\'s the most-liked thing she\'s ever posted. You\'re a meme now. I\'m so proud I could be sick.'
    : v.has('apex.vent.open')
      ? 'You went in through a vent. Her vent. She said on air there\'s a podcast about it now. There is. I\'ve listened to both episodes. You\'re described as "a draught".'
      : v.has('apex.spliced')
        ? 'You spliced her airlock. Her own door thought you were a delivery. She\'s posted about zero trust eleven times since, and none of them make sense, which is how you know they\'re hers.'
        : v.has('apex.code')
          ? 'You read her launch clock and typed it into her own door. She built a lock that counts down, and you waited for it. Somewhere an engineer is laughing into a pillow.'
          : 'You went through her front door like it owed you water. Which, legally, it did.';
  pages.push({ speaker: 'Dez Marlow', text: how });
  pages.push(v.has('apex.loud')
    ? { speaker: 'Dez Marlow', text: 'And the alarm. Her feed had you live for forty minutes. Kade\'s been on the band since, asking who you are. I told them you\'re a rumour. They wrote it down.' }
    : { speaker: 'Mara Voss', text: 'And no alarm. She didn\'t know you were in until the tank went quiet. That\'s the kind of story that gets told at fires long after the people in it have stopped.' });
  pages.push({ speaker: 'Dez Marlow', text: 'One more thing. When her feed went down, something else came up on our channel. Not a voice at first. A list. Every name at this fire, and how much each of us drinks. Then a man said thank you for the water. He said it would make the next part easier.' });
  pages.push(v.has('q.cam.hello') || v.has('lore.panopticon') || v.has('intel:intel.apex.memo')
    ? { speaker: 'Mara Voss', text: 'Ezra Seymour. The man in the camera. Vesper sold him faces, and he sold her quiet. North of the salt, eleven hundred cameras, and he calls it the Panopticon. I don\'t know what the next part is. I don\'t like that he does. That\'s Act II. Sleep.' }
    : { speaker: 'Mara Voss', text: 'He signed off as Ezra. Ezra Seymour, the neighbourhood app, Glimpse. North of the salt, in a place he calls the Panopticon. I don\'t know what the next part is. I don\'t like that he does. That\'s Act II. Sleep.' });
  return pages;
}

export function storyObjective(v: StoryView): string {
  if (v.has('act2.debriefed')) return 'Act II is done. Ezra Seymour is north of the salt, in the Panopticon, and he knows your name.';
  if (v.has('apex.complete')) return 'Apex is done and the water is heading east. Radio Mara from the campfire.';
  if (v.has('debriefed')) return 'Act I is done. Apex Vault is west of the salt. Ask in Dry Creek who would come with you.';
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
    approach: 'There are still battery cells on the fallen mast. They\'ll bite if you don\'t know electronics.',
    xp: 20,
    items: [
      { id: 'battery', qty: 2 },
      { id: 'scrap', qty: 2 },
    ],
    shockWithoutElectronics: true,
  },
];
