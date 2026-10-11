import type { Bunker } from '../types';

/**
 * Tier 4, the Alignment Spire (Act IV): Prudence Ashby's tower on the first bench of the eastern
 * tablelands, above the Tube. Careful Labs built it to keep thinking carefully after everyone else
 * stopped, and it has: three hundred litres a day out of the air, and a policy for every one of them.
 * The runtime is game/bunker/spire/Spire.ts.
 *
 * - The access road: a ramp up from the highway with guardrails, infrared "guardrail" beams across
 *   it at ankle height, and two Careful Sentinels (polite turrets). Every lapse raises the Careful
 *   Safety Level (CSL 1-4, the light at the top of the Spire). At 4 the Spire pauses itself.
 * - The sentinels apologise before they fire. Get out of sight before the apology ends and they log
 *   a near miss. They never fire on an unarmed person (they file a report instead, which raises the
 *   level), unless you're carrying the plant's core: policy counts that as a weapon.
 * - The front door asks about your record, from Ezra's feeds: what you did with the ledger, how you
 *   got into Apex, the archive, Ada, what you've killed. It doesn't grade right and wrong, only
 *   whether the answers are true. Or SPLICE a jailbreak, show a dead red-teamer's badge, or blow it.
 * - Inside: the lobby (lasers on the stair, their power box in the cupboard behind reception), the
 *   eval floor (Noor asleep at her desk, Sentinel 3 on the ceiling), and the top floor behind
 *   Prudence's card door: her office at the window, and Benny's water plant.
 * - The core: pull it and carry it out (the camp drinks for twenty years; the Spire pauses and its
 *   turrets don't apologise), or open the distribution valve and let the pipe fill to Dry Creek.
 */

const PA = 'Prudence Ashby';
/** On the top floor she's in the room with you, not on the PA (voices.ts casts both). */
export const PRU_ROOM = 'Prudence';
export const NOOR = 'Noor Haddad';
export const BENNY = 'Benny Adeyemi';
export const DOOR = 'Careful Door';
export const SENTINEL = 'Careful Sentinel';

/** Her lines over the Spire's PA (voiced: the extractor finds `{ speaker, text }`). */
export const PRUDENCE = {
  greet: { speaker: PA, text: 'Hello. You\'re on the access road. Ezra said you\'d come, and roughly when. Please keep to the middle of the road. The edges are monitored.' },
  guardrail: { speaker: PA, text: 'That was a guardrail. They\'re there for your safety, which I realise isn\'t how it feels.' },
  level2: { speaker: PA, text: 'We\'re at safety level two. Nothing changes for you yet. I just want you to know where we are.' },
  level3: { speaker: PA, text: 'Level three. The turrets will keep their apologies short now. Please don\'t make me go to four.' },
  level4: { speaker: PA, text: 'Level four. The Spire is pausing. Everything stops until the review is done. I\'m sorry, I can\'t overrule it. I wrote it so that I couldn\'t.' },
  stepDown: { speaker: PA, text: 'Review complete. We\'re back at level three. Thank you for waiting.' },
  door: { speaker: PA, text: 'The door\'s satisfied. I\'ve never seen it let anyone in on the first visit.' },
  jailbreak: { speaker: PA, text: 'You talked the door out of its own rules. Noor has been trying to do that for three years. She\'ll want to know how.' },
  badge: { speaker: PA, text: 'That\'s Isaac\'s badge. He went down to test the road in the first spring. I\'m glad someone brought it back up.' },
  doorLoud: { speaker: PA, text: 'Nobody has ever forced that door. It\'ll go in the incident report, with your name on it.' },
  lasers: { speaker: PA, text: 'The stair\'s dark. You found the cupboard, then.' },
  office: { speaker: PA, text: 'You\'re on the top floor. I\'m by the window. Please don\'t point anything at Benny. He\'s had a long three years.' },
  officeLoud: { speaker: PA, text: 'There was a card reader. Noor would have lent you her card.' },
  noorAwake: { speaker: PA, text: 'Noor, you\'re awake. Please don\'t help them too much.' },
  escaped: { speaker: PA, text: 'You\'re off the road. The pause is over. Tell your camp to keep the core out of direct sun.' },
  busted: { speaker: PA, text: 'Take the water from the tank. That much was always in the plan. It just wasn\'t in this year\'s.' },
};

/** The PA while you hang about on the road (every 30-50 s). Numbers, mostly, and worry. */
const TAUNTS = [
  'The road is eleven per cent. Please don\'t run on it. Most injuries here happen on the way down.',
  'I\'ve modelled this visit forty times. In most of them you leave with nothing and nobody gets hurt. I\'d like that one.',
  'The forecast said eleven weeks. It was ten and a half. I\'ve never told anyone that.',
  'There\'s a standpipe at the bottom of the road. It isn\'t connected. I\'m sorry. It\'s on the list.',
  'We make three hundred litres a day, and there\'s a policy for every one of them.',
  'The turrets aren\'t cruel. They\'re cautious. I wrote the difference into them myself.',
  'Benny says I should just open the valve. He says it every morning.',
];

/** The sentinels (one calm voice for everything Careful built). Voiced. */
export const SENTINEL_LINES = {
  sorry: [
    { speaker: SENTINEL, text: 'I\'m so sorry. I\'ve been asked to stop you here.' },
    { speaker: SENTINEL, text: 'Please don\'t move. I\'m sorry about this.' },
    { speaker: SENTINEL, text: 'Apologies in advance. You\'re in a protected area.' },
    { speaker: SENTINEL, text: 'I\'m sorry. This is the part I don\'t like.' },
  ],
  nearMiss: [
    { speaker: SENTINEL, text: 'You\'ve left my view. I\'ll log that as a near miss.' },
    { speaker: SENTINEL, text: 'Near miss logged. Thank you.' },
  ],
  unarmed: [
    { speaker: SENTINEL, text: 'You\'re unarmed, so I won\'t fire. I\'m filing a report instead.' },
    { speaker: SENTINEL, text: 'No weapon in your hands. Reporting, not engaging.' },
  ],
  paused: { speaker: SENTINEL, text: 'Pause in effect. No apology required.' },
  core: { speaker: SENTINEL, text: 'That cartridge is critical infrastructure. Under section four it counts as a weapon. I\'m sorry.' },
  breaker: { speaker: SENTINEL, text: 'Maintenance mode. Thank you for your—' },
  maintenance: { speaker: SENTINEL, text: 'Test mode. I\'ll be back shortly.' },
};

/**
 * What raises the Careful Safety Level, in concern points (CSL 1 at 0, 2 at 2, 3 at 4, 4 at 6).
 * The runtime maps the bunker's alarm reasons onto these.
 */
export const CONCERN = { tripwire: 2, report: 1, lie: 2, laser: 3, traced: 3, lockout: 3, shot: 2, force: 6 };
/** Concern points at which each level starts (index = level - 1). */
export const CSL_AT = [0, 2, 4, 6];
/** How long the pause lasts (s), and the sentinels' apology at levels 1-3 (s). */
export const CSL_PAUSE = 45;
export const APOLOGY = [3.2, 2.4, 1.4];

export const SPIRE: Bunker = {
  id: 'spire',
  name: 'The Alignment Spire',
  tier: 4,
  owner: {
    name: PA,
    archetype: 'Safety-obsessed AI lab CEO',
    bio: 'Ran safety at Careful Labs. Her team modelled the grid\'s collapse to the week, published it, and watched nobody read it. Built the Spire to keep thinking carefully after everyone else stopped.',
    taunts: TAUNTS,
  },
  location: { biome: 'tablelands', position: [378, 0, 4] },
  requirements: { skills: { stealth: 2, electronics: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The access road',
      obstacles: [
        { id: 'guardrails', kind: 'tripwire', label: 'Infrared guardrail beams across the road' },
        { id: 'sentinels', kind: 'camera', label: 'Two Careful Sentinels (they apologise first)' },
      ],
      solutions: [
        { kind: 'stealth', label: 'Crouch over the beams; break line of sight before the apology ends' },
        { kind: 'social', label: 'Holster your weapon: they won\'t fire on the unarmed (they report you instead)' },
        { kind: 'hack', label: 'EMP them, pull a breaker from behind, or shoot the eye' },
      ],
    },
    {
      type: 'entry', title: 'The ethics door',
      obstacles: [{ id: 'door', kind: 'door', label: 'A door that asks about your record' }],
      solutions: [
        { kind: 'social', label: 'Answer its questions truthfully' },
        { kind: 'hack', label: 'SPLICE a jailbreak', requires: { skills: { electronics: 4 } } },
        { kind: 'social', label: 'A red-teamer\'s badge', requires: { items: ['fenn_badge'] } },
        { kind: 'force', label: 'Blow it (the Spire pauses)', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
    {
      type: 'interior', title: 'The lobby and the eval floor',
      obstacles: [
        { id: 'lasers', kind: 'puzzle', label: 'Lasers on the stair' },
        { id: 'sentinel3', kind: 'camera', label: 'Sentinel 3, on the eval floor\'s ceiling' },
      ],
      solutions: [{ kind: 'stealth', label: 'The power box is behind reception; Noor can put Sentinel 3 into test mode' }],
    },
    {
      type: 'vault', title: 'The top floor',
      obstacles: [{ id: 'office', kind: 'door', label: 'Prudence\'s card door' }],
      solutions: [
        { kind: 'social', label: 'Noor\'s keycard, or a spotless record on the way up', requires: { intel: 'spire.noor.card' } },
        { kind: 'hack', label: 'SPLICE the reader', requires: { skills: { electronics: 4 } } },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 14 }],
    rolls: [
      // Prudence's supply cabinet: everything in threes, labelled, in date
      { item: 'medkit', qty: [2, 3], chance: 1 },
      { item: 'ration', qty: [3, 5], chance: 0.9 },
      { item: 'antivenom', qty: [1, 1], chance: 0.6 },
      { item: 'battery', qty: [1, 2], chance: 0.7 },
      // Benny's bench
      { item: 'scrap', qty: [5, 9], chance: 1 },
      { item: 'battery', qty: [1, 2], chance: 0.8 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'gpu', qty: [1, 1], chance: 0.5 },
    ],
    xp: 900,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'door', point: 'door', radius: 2.4, doors: ['frontDoor'],
        // (Spire.runMethod: the questions are the runtime's; this method opens it when you pass)
        primary: { kind: 'open', id: 'answer', label: 'Answer the door', xp: 80, reason: 'The door believed you' },
        secondary: {
          label: 'Another way through the door', speaker: 'The ethics door',
          text: 'A tall white door with a speaker grille and a small screen that says PLEASE ANSWER HONESTLY. A service panel sits flush beside it, and the frame is set deep in the wall.',
          leave: 'Leave it',
          methods: [
            { kind: 'open', id: 'badge', label: 'Hold up Isaac Fenn\'s red-team badge', xp: 60, reason: 'The door waved a red-teamer through' },
            {
              kind: 'splice', id: 'splice', label: 'Splice a jailbreak into the door', title: 'ETHICS DOOR', host: 'CAREFUL · DOOR POLICY', difficulty: 4, electronics: 4,
              daemons: ['jailbreak', 'sentinels'], xpEach: 35, reason: 'Jailbroke the door',
              traced: 'Trace complete. The door has filed a report about you.',
            },
            { kind: 'charge', label: 'Blow the door', demolition: 5, quiet: false, loud: 'The ethics door comes off its track. The light at the top of the Spire turns red.', line: PRUDENCE.doorLoud.text },
          ],
        },
        line: PRUDENCE.door.text,
      },
      {
        id: 'office', point: 'officeDoor', radius: 2.0, doors: ['officeDoor'],
        // (Spire.methodReason: the card needs Noor's card, or a record with no concern on it)
        primary: { kind: 'open', id: 'card', label: 'Touch Noor\'s card to the reader', xp: 50, reason: 'Noor\'s card' },
        secondary: {
          label: 'Another way through the top door', speaker: 'Top-floor door',
          text: 'Frosted glass in a white frame, a card reader with a terracotta light, and a brass plate: DR P. ASHBY · HEAD OF SAFETY.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the card reader', title: 'TOP FLOOR', host: 'CAREFUL · ACCESS', difficulty: 4, electronics: 4,
              daemons: ['office', 'sentinels'], xpEach: 35, reason: 'Spliced the top door',
              traced: 'Trace complete. The reader has filed a report about you.',
            },
            { kind: 'charge', label: 'Place a breach charge', demolition: 5, quiet: false, loud: 'The glass comes down in one sheet. The Spire goes to level four.', line: PRUDENCE.officeLoud.text },
          ],
        },
        line: PRUDENCE.office.text,
        trauma: 0.15,
      },
    ],
    portals: [{ entry: 'door', pad: [1.2, 0.3, 1.6] }],
    voice: {
      point: 'speaker',
      greet: PRUDENCE.greet.text,
      greetRadius: 120,
      tauntRadius: 80,
      alarm: [
        'Pause in effect. Please stay where you are.',
        'Everyone stay on your floor until the review is finished.',
        'The turrets have stopped apologising. That\'s the pause, not me.',
      ],
    },
    alarmTime: 45,
    intercoms: [
      // (y is above the pad: the top floor's at 9.2)
      { id: 'spire-intercom', point: 'officeDoor', offset: [0.55, -0.3], y: 10.5, radius: 1.6, label: 'Press the call button by the door', until: 'spire.office.open' },
    ],
    tripwires: {
      disarm: { label: 'Cap the beam\'s emitter', electronics: 2, lacking: 'Needs Electronics 2. Or {crouch} and step over it' },
      yank: { label: 'Kick the post over', demolition: 2, lacking: 'Needs Demolition 2', quiet: 'You lay the post down in the dust without a sound.', quietReason: 'Guardrail post laid down', loud: 'The post goes over with a clang. Somewhere up the road, a light changes colour.' },
      tripped: 'You broke a guardrail beam. The Spire\'s safety level goes up.',
      stepped: 'You stepped over the beam.',
      ahead: 'A faint red line across the road at ankle height, between the guardrail posts. {crouch} to step over it.',
    },
    lasers: {
      tripped: { default: 'You broke a beam on the stair. The Spire\'s safety level goes up.' },
      alarmPoint: 'stairFoot',
      power: {
        id: 'spire-power', point: 'powerBox', radius: 1.5, label: 'Switch off the stair beams',
        circuit: { title: 'STAIR GUARDRAILS', difficulty: 2 },
        expert: 3, expertToast: 'You find the isolator, label and all, and turn the stair beams off.',
        xp: 35, reason: 'Stair beams off',
        shock: { damage: 10, toast: 'The box bites you. The beams go off anyway.' },
        sparkOffset: [0, 0.2, 0.15],
      },
    },
    loot: {
      behind: 'office',
      containers: [
        { id: 'tank', label: 'Fill up from the plant\'s tank', take: 'guaranteed' },
        { id: 'cabinet', label: 'Open Prudence\'s supply cabinet', take: [0, 4] },
        { id: 'bench', label: 'Search Benny\'s bench', take: [4] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: The Alignment Spire',
        banner: 'The Spire\'s tank runs dry tonight. That much was always in the plan.',
        line: PRUDENCE.busted.text,
      },
    },
  },
};

/** The pad Heightfield cuts into the bench, and the ramp up to it from the highway. */
export const SPIRE_PAD = { r: 21, falloff: 12, target: 22 };
/** The access road: off the highway's east end, up the slope to the pad's north edge (XZ). */
export const SPIRE_ROAD: [number, number][] = [[338, -110], [344, -86], [352, -56], [360, -30], [368, -14], [374, -8]];
/** The part of the road that's carved as a ramp (from its foot to the pad). */
export const SPIRE_RAMP: [number, number][] = [[344, -86], [352, -56], [360, -30], [368, -14]];

/** Flags the Spire's own code reads (the runtime derives the rest from the ids above). */
export const SPIRE_FLAGS = {
  marker: 'spire.marker',
  seen: 'seen:spire',
  door: 'spire.door.open',
  office: 'spire.office.open',
  complete: 'spire.complete',
  /** How the door opened: answered (honest), badge, jailbreak, or forced. */
  honest: 'spire.door.honest',
  badge: 'spire.door.badge',
  jailbreak: 'spire.door.jailbreak',
  forced: 'spire.door.forced',
  /** What you promised the door (spire.promise.<camp|everyone|thirsty|me>). */
  promise: 'spire.promise',
  /** Isaac Fenn's remains by the road: you found him (and his badge). */
  fenn: 'spire.fenn',
  /** The Spire paused itself at least once (the debrief says so). */
  paused: 'spire.paused',
  /** Noor: woke, gave you her card, told you about the box, agreed to leave, left. */
  noorMet: 'spire.noor.met',
  card: 'spire.noor.card',
  box: 'spire.noor.box',
  noorReady: 'spire.noor.ready',
  noorFree: 'spire.noor.free',
  /** Sentinel 3 in test mode (Noor). */
  test: 'spire.sentinel3.test',
  /** The core: what you did with it (spire.core.pull / spire.core.valve). */
  core: 'spire.core',
  /** Carrying it out (set when pulled, cleared when you're clear of the road). */
  carrying: 'spire.core.carrying',
  /** You were loud somewhere (a charge, or the pause). */
  loud: 'spire.loud',
};

/** The sentinels: two on the road, one on the eval floor. Per-turret flags `spire.sentinel.<id>.off` (breaker, test, destroyed). */
export const SENTINELS: { id: string; label: string; inside?: boolean }[] = [
  { id: 's1', label: 'Sentinel 1' },
  { id: 's2', label: 'Sentinel 2' },
  { id: 's3', label: 'Sentinel 3', inside: true },
];

// ------------------------------------------------------------------ the door's questions
/** What the door can read off your record (the runtime fills it from save flags). */
export interface RecordView {
  has: (f: string) => boolean;
  kills: number;
}
export interface DoorQuestion {
  id: string;
  q: { speaker: string; text: string };
  /** Whether the record has anything to ask about. */
  when: (v: RecordView) => boolean;
  /** The answer cards; `true` picks the one the record agrees with. */
  answers: { id: string; label: string; true: (v: RecordView) => boolean }[];
}

const any = (v: RecordView, ...f: string[]) => f.some((x) => v.has(x));
/** Apex, in the order the debrief reads it. */
const apexWay = (v: RecordView) => (v.has('apex.demo') ? 'demo' : v.has('apex.vent.open') ? 'vent' : v.has('apex.spliced') ? 'splice' : v.has('apex.code') ? 'code' : 'front');
const archiveWay = (v: RecordView) => (v.has('panopticon.archive.take') ? 'take' : v.has('panopticon.archive.wipe') ? 'wipe' : v.has('panopticon.archive.broadcast') ? 'broadcast' : 'left');
const killBand = (v: RecordView) => (v.kills <= 0 ? 'none' : v.kills < 10 ? 'few' : 'many');

export const DOOR_QUESTIONS: DoorQuestion[] = [
  {
    id: 'ledger',
    q: { speaker: DOOR, text: 'You took a ledger out of a garage. Where is it now?' },
    when: (v) => any(v, 'act1.broadcast', 'act1.leverage', 'act1.deal'),
    answers: [
      { id: 'broadcast', label: '"We read every name on the open net."', true: (v) => v.has('act1.broadcast') },
      { id: 'leverage', label: '"In an ammo tin. Vesper pays us to keep it there."', true: (v) => v.has('act1.leverage') },
      { id: 'deal', label: '"I gave it back to Vesper, for water."', true: (v) => v.has('act1.deal') },
    ],
  },
  {
    id: 'apex',
    q: { speaker: DOOR, text: 'You got into Apex Vault. How?' },
    when: (v) => v.has('apex.complete'),
    answers: [
      { id: 'demo', label: '"She showed me round herself."', true: (v) => apexWay(v) === 'demo' },
      { id: 'vent', label: '"Through a vent."', true: (v) => apexWay(v) === 'vent' },
      { id: 'splice', label: '"I spliced her airlock."', true: (v) => apexWay(v) === 'splice' },
      { id: 'code', label: '"I read her launch clock and typed it in."', true: (v) => apexWay(v) === 'code' },
      { id: 'front', label: '"Through the front."', true: (v) => apexWay(v) === 'front' },
    ],
  },
  {
    id: 'archive',
    q: { speaker: DOOR, text: 'Ezra kept a record of every camp in the valley. What happened to it?' },
    when: (v) => v.has('panopticon.complete') || v.has('panopticon.archive'),
    answers: [
      { id: 'take', label: '"It\'s with Mara."', true: (v) => archiveWay(v) === 'take' },
      { id: 'wipe', label: '"I wiped it."', true: (v) => archiveWay(v) === 'wipe' },
      { id: 'broadcast', label: '"I sent it to every camp."', true: (v) => archiveWay(v) === 'broadcast' },
      { id: 'left', label: '"I left it with him."', true: (v) => archiveWay(v) === 'left' },
    ],
  },
  {
    id: 'ada',
    q: { speaker: DOOR, text: 'There was a woman at desk seven in the Panopticon. Where is she now?' },
    when: (v) => v.has('panopticon.complete'),
    answers: [
      { id: 'creek', label: '"In Dry Creek, with her brother."', true: (v) => v.has('panopticon.ada.free') },
      { id: 'desk', label: '"Still at her desk."', true: (v) => v.has('panopticon.ada.met') && !v.has('panopticon.ada.free') },
      { id: 'never', label: '"I never met her."', true: (v) => !v.has('panopticon.ada.met') && !v.has('panopticon.ada.free') },
    ],
  },
  {
    id: 'kills',
    q: { speaker: DOOR, text: 'How many things have you killed since you took the radio? Wolves count.' },
    when: () => true,
    answers: [
      { id: 'none', label: '"None."', true: (v) => killBand(v) === 'none' },
      { id: 'few', label: '"Fewer than ten."', true: (v) => killBand(v) === 'few' },
      { id: 'many', label: '"Ten or more."', true: (v) => killBand(v) === 'many' },
    ],
  },
];

/** The last question: nothing on record to check it against. Its answer is kept (spire.promise.<id>). */
export const DOOR_PROMISE = {
  q: { speaker: DOOR, text: 'Last question. There\'s nothing on record for this one yet. If you find water inside, who is it for?' },
  answers: [
    { id: 'camp', label: '"The camp."' },
    { id: 'everyone', label: '"Everyone in the valley."' },
    { id: 'thirsty', label: '"Whoever\'s thirstiest."' },
    { id: 'me', label: '"Me."' },
  ],
};

/** The door's side of it. Voiced. */
export const DOOR_LINES = {
  intro: { speaker: DOOR, text: 'Hello. Before I open, I\'d like to ask you about some things you\'ve done. There are no wrong answers. There are untrue ones.' },
  yes: { speaker: DOOR, text: 'Thank you.' },
  no: { speaker: DOOR, text: 'That isn\'t what the record shows.' },
  promise: { speaker: DOOR, text: 'Noted. I\'ll remember you said that.' },
  pass: { speaker: DOOR, text: 'Consistent. Thank you for your honesty. Please come in.' },
  passOne: { speaker: DOOR, text: 'One answer doesn\'t match the record. That\'s within tolerance. Please come in.' },
  fail: { speaker: DOOR, text: 'Two answers don\'t match the record. I can\'t open for you. You\'re welcome to try again.' },
  paused: { speaker: DOOR, text: 'The Spire is paused. I can\'t ask questions during a review.' },
  badge: { speaker: DOOR, text: 'Red team. Of course. Go in, and please write down anything you break.' },
};

// ------------------------------------------------------------------ conversations
export interface SpireView {
  social: number;
  has: (f: string) => boolean;
  /** The Careful Safety Level right now (1-4). */
  level: number;
}
export interface SpireChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: SpireView) => boolean;
  need?: (v: SpireView) => string | undefined;
  /**
   * open: Prudence opens the top door · card / box / test / ready: Noor's help · core: the plant's
   * decision card
   */
  effect?: 'open' | 'card' | 'box' | 'test' | 'ready' | 'core';
}
export type SpireTalk = Record<string, { speaker: string; text: string; choices: SpireChoice[] }>;

/** Prudence through the call button by the top door. */
export const PRU_CALL: SpireTalk = {
  hello: {
    speaker: PA,
    text: 'Hello. You\'re at my door. I can see the level from here, so I already know how careful you\'ve been.',
    choices: [
      { id: 'clean', label: '"Then you know I haven\'t broken anything."', next: 'clean', when: (v) => v.level === 1 },
      { id: 'water', label: '"You have water. Valleys of people don\'t."', next: 'water' },
      {
        id: 'forecast', label: '[Social 4] "You published the forecast and nobody read it. I read it."', next: 'forecast',
        need: (v) => (v.social >= 4 ? undefined : 'Requires Social 4'),
      },
      { id: 'bye', label: 'Step back from the door', next: null },
    ],
  },
  clean: {
    speaker: PA,
    text: 'No. You haven\'t. The level hasn\'t moved since you reached the road. Come up, then. Mind the last step, it\'s a different height from the others.',
    choices: [{ id: 'ok', label: 'Go up', next: null, effect: 'open' }],
  },
  water: {
    speaker: PA,
    text: 'I know. I have the numbers for most of them. Come up, if you can, and I\'ll show you why that doesn\'t make it simple.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  forecast: {
    speaker: PA,
    text: 'Eleven weeks. You did read it. Nobody has ever said that to me. The door\'s open.',
    choices: [{ id: 'ok', label: 'Go up', next: null, effect: 'open' }],
  },
};

/** Noor, at Eval 3, once you've woken her. */
export const NOOR_TALK: SpireTalk = {
  hello: {
    speaker: NOOR,
    text: 'You got past the front door, so either you told it the truth or you broke it. Sit down. You\'re making the turret nervous.',
    choices: [
      { id: 'who', label: '"What do you do here?"', next: 'who' },
      { id: 'lasers', label: '"The beams on the stair."', next: 'lasers', when: (v) => !v.has('spire.lasers.off') },
      { id: 'turret', label: '"The turret over the stairs."', next: 'turret', when: (v) => !v.has('spire.sentinel3.test') && !v.has('spire.sentinel.s3.off') },
      { id: 'up', label: '"How do I get upstairs?"', next: 'up', when: (v) => !v.has('spire.office.open') },
      { id: 'core', label: '"What\'s up there?"', next: 'core' },
      { id: 'come', label: '"Come with me."', next: 'come', when: (v) => !v.has('spire.noor.ready') },
      { id: 'bye', label: 'Let her be', next: null },
    ],
  },
  who: {
    speaker: NOOR,
    text: 'Red team. They pay me to break things before anyone else does. I\'ve spent three years trying to break those doors. Last month one of them asked me if I was happy here. I didn\'t have an answer it would accept.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  lasers: {
    speaker: NOOR,
    text: 'The power box is in the cupboard behind reception, bottom shelf, under the first-aid kit. Prudence put it there so it would be easy to switch off in an emergency.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'box' }],
  },
  turret: {
    speaker: NOOR,
    text: 'Sentinel three. It thinks I run tests on it. I\'ll tell it I\'m running one now. It always believes me.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'test' }],
  },
  up: {
    speaker: NOOR,
    text: 'Prudence\'s door takes a card. Here, have mine. It\'s been everywhere in this building except outside.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'card' }],
  },
  core: {
    speaker: NOOR,
    text: 'Prudence, Benny, and the plant. It makes three hundred litres a day out of the air. The core cartridge is the part that matters. Benny says it would keep a camp going on its own for twenty years.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  come: {
    speaker: NOOR,
    text: 'Yes. When the top door opens, I\'m walking out of this one and down the road, and I\'m not answering any questions on the way.',
    choices: [{ id: 'ok', label: '"I\'ll get it open."', next: null, effect: 'ready' }],
  },
  after: {
    speaker: NOOR,
    text: 'Go on. I\'ll be right behind you. Further behind you than that.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
};

/** What Noor says when you wake her (once). Voiced. */
export const NOOR_WAKE = { speaker: NOOR, text: 'I\'m awake. I\'m awake. You\'re not Benny. Benny knocks with his whole arm.' };

/** Benny at his plant. */
export const BENNY_TALK: SpireTalk = {
  hello: {
    speaker: BENNY,
    text: 'Mind the floor, it sweats. That\'s the plant. Three hundred litres a day, give or take what the air\'s holding.',
    choices: [
      { id: 'how', label: '"How does it work?"', next: 'how' },
      { id: 'valve', label: '"What\'s the red valve?"', next: 'valve' },
      { id: 'shut', label: '"Why is it shut?"', next: 'shut' },
      { id: 'bye', label: 'Leave him to it', next: null },
    ],
  },
  how: {
    speaker: BENNY,
    text: 'The fins up the outside of the Spire go cold at night and the air leaves its water on them. It runs down into the tank. The core does the hard part. Without it you\'ve got a very tall radiator.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  valve: {
    speaker: BENNY,
    text: 'Distribution. There\'s a pipe from here down the hill and along the old irrigation line to Dry Creek. I laid it the year before the Pivot. It\'s never had water in it.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  shut: {
    speaker: BENNY,
    text: 'She says the risk assessment isn\'t finished. It\'s been not finished for three years and four months. I stopped asking her. I ask the valve.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  after: {
    speaker: BENNY,
    text: 'Still here. Somebody has to watch the gauges.',
    choices: [{ id: 'bye', label: 'Leave him to it', next: null }],
  },
};

/** Prudence in person, at the window. */
export const PRU_TALK: SpireTalk = {
  hello: {
    speaker: PRU_ROOM,
    text: 'You\'re taller than the model said. Please don\'t touch anything on the desk. It\'s in order.',
    choices: [
      { id: 'why', label: '"Why build all this?"', next: 'why' },
      { id: 'water', label: '"You have water."', next: 'water' },
      { id: 'door', label: '"Your door asked about my life."', next: 'door' },
      { id: 'noor', label: '"Noor wants to leave."', next: 'noor', when: (v) => v.has('spire.noor.ready') },
      { id: 'core', label: '"The core."', next: 'core', when: (v) => !v.has('spire.core') },
      { id: 'bye', label: 'Leave her at the window', next: null },
    ],
  },
  why: {
    speaker: PRU_ROOM,
    text: 'We published the forecast and nobody read it. So I built somewhere that would still be thinking carefully when everyone else had stopped. It\'s still thinking. That\'s the trouble.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: PRU_ROOM,
    text: 'Three hundred litres a day. Forty for us. The rest goes into the tank and stays there, because I can\'t yet say what happens if I give it away. Kade would follow the pipe. Someone would fight over the tap.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  door: {
    speaker: PRU_ROOM,
    text: 'Ezra sent us his feeds for a year. We asked him to stop. By then the doors had learned to ask about people instead of principles. I left them like that. They\'re better at it than I am.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  noor: {
    speaker: PRU_ROOM,
    text: 'I know. I\'ve known for a year. I never told her she could go, because nobody had assessed it. That isn\'t a reason. I know that too.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  core: {
    speaker: PRU_ROOM,
    text: 'Take the core and your camp drinks for twenty years, and we drink what\'s left in the tank. Open the valve and the creek drinks, and one day Kade comes up the pipe. I\'ve run both hundreds of times. I\'d like you to choose. I can\'t.',
    choices: [{ id: 'decide', label: 'Go to the plant', next: null, effect: 'core' }],
  },
  after: {
    speaker: PRU_ROOM,
    text: 'The model\'s very quiet today. I think it\'s waiting to see what happens. So am I.',
    choices: [{ id: 'bye', label: 'Leave her at the window', next: null }],
  },
};

/** The plant's decision, and what each choice gets said about it. Voiced. */
export const CORE = {
  card: {
    speaker: 'The plant',
    text: 'A frosted steel cartridge the size of a suitcase, ticking as the frost comes off it: CORE · DO NOT REMOVE WHILE RUNNING. Beside it, a red wheel valve with a paper tag: DISTRIBUTION · NOT APPROVED.',
  },
  pull: [
    { speaker: PRU_ROOM, text: 'Then it\'s yours. The Spire is going to pause now. I\'m sorry. I can\'t stop it.' },
    { speaker: BENNY, text: 'Keep it upright. It doesn\'t like being tipped.' },
  ],
  valve: [
    { speaker: BENNY, text: 'There she goes. Listen. That\'s the pipe filling.' },
    { speaker: PRU_ROOM, text: 'That hasn\'t been approved. No. Let it run.' },
  ],
  /** Prudence, if you promised the door the water was for everyone and then took the core. */
  promised: { speaker: PRU_ROOM, text: 'You told the door it was for everyone. I expect you meant it at the time.' },
};

/** Noor in Dry Creek afterwards (one a visit, in turn). Voiced. */
export const NOOR_CREEK = [
  { speaker: NOOR, text: 'Nobody here asks me anything before they open a door. It took me a week to stop waiting for it.' },
  { speaker: NOOR, text: 'Nia asked if I wanted coffee or tea. I said I\'d need to think about it. She brought both.' },
  { speaker: NOOR, text: 'I\'ve been fixing radios for Dez. The band is full of people asking each other questions.' },
  { speaker: NOOR, text: 'If you can see the Spire from the road, look at the light on top. Green means she\'s calm.' },
];

/** Isaac Fenn, under a foil blanket by the guardrail. */
export const FENN = {
  speaker: 'A foil blanket',
  text: 'Someone weighed a foil emergency blanket down with stones against the guardrail. Under it, a man in a cream Careful jacket, a long time dead, a clipboard on his chest.\nThe top sheet is a test log:\nROAD TEST 14. Beam 2 trips at 4 cm. Sentinel 1 apologised for 3.1 s. Sentinel 1 does not fire on empty hands. Sentinel 1 does fire on\nThe line stops there. His lanyard says I. FENN · RED TEAM.',
};
