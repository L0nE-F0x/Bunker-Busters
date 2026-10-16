import type { Bunker } from '../types';

/**
 * Tier 6, the Cloud Cathedral (Act VI): Orrin Sayle's fulfilment centre in the north basin, between
 * the Longshot and ColdStorage. Dropt (anything, anywhere, ten minutes or it's free) was his, and so
 * was the cloud under it (Nimbus at ColdStorage was one of his regional nodes). He built the
 * Cathedral as the last warehouse: a nave of racks under a gothic roof, a rose window that is a
 * delivery clock, a bell tower that launches drones. The runtime is game/bunker/cathedral/.
 *
 * - On Pivot Day the doors locked at shift start and never unlocked: shift end is a blank field in
 *   his system. Thirty associates were on the floor. Four are left, led by Lo Ibarra, picking orders
 *   for the only customer the network still has: Orrin, upstairs, who orders every morning, unboxes
 *   everything, rates it, and sends it back down the returns chute. Free returns.
 * - The lot: the delivery swarm. A drone that sees you tags you as an address, the whole swarm comes,
 *   and enough of them together carry you to the lot's edge (returned to sender). Riders on an active
 *   order (Rider 9's, from the Last Mile) aren't tagged.
 * - In: the returns chute (Rider 9's order number on the kiosk, then you ride the returns line in a
 *   tote over the floor), or the dock door.
 * - The floor: drive units shuffle shelf pods across a grid. Stand where one is going and it stops:
 *   OBSTRUCTION, and a floor drone comes to look. Lo's spare badge makes the drives route round you.
 * - The Day 1 office in the apse: Orrin, the Reserve (his own water), and the key: shut it down (the
 *   associates walk out), or transfer it to the associates (they run it, Orrin works a shift, and a
 *   drone delivers to the camp every morning).
 */

/** Orrin over the PA (owner taunts, reactions), and in the room with you. */
export const ORRIN = 'Orrin Sayle';
export const ORRIN_ROOM = 'Orrin';
export const LO = 'Lo Ibarra';
export const DROPT = 'Dropt drone';
/** The other three associates (one voice line each as you pass). */
export const ASSOC = 'Associate';

/** Orrin's lines over the PA and at his desk (voiced). */
export const ORRIN_LINES = {
  greet: { speaker: ORRIN, text: 'Hello! Welcome to the Cathedral. You\'re a customer now. Everybody who comes this far is a customer.' },
  lot: { speaker: ORRIN, text: 'Please stay on the marked walkway. The drones can\'t tell a person from an address. Honestly, neither can I.' },
  returns: { speaker: ORRIN, text: 'A return! Wonderful. No questions asked. That\'s the policy.' },
  dock: { speaker: ORRIN, text: 'That\'s the dock. Nothing has come in through the dock in three years. Please don\'t be the first.' },
  dockLoud: { speaker: ORRIN, text: 'You blew up the dock door. I\'ve logged it as damaged in transit.' },
  floor: { speaker: ORRIN, text: 'You\'re on the floor. Mind the drives. They have right of way, and they know it.' },
  obstruction: { speaker: ORRIN, text: 'Obstruction on the floor. That goes on somebody\'s rate. Probably Lo\'s.' },
  office: { speaker: ORRIN, text: 'You\'re coming up. Good. I always come down to meet a customer, but my knees don\'t.' },
  officeLoud: { speaker: ORRIN, text: 'That was my door. It was a regular door. I don\'t know why you\'d do that to a regular door.' },
  caught: { speaker: ORRIN, text: 'Returned to sender. That\'s fine. Most people come back.' },
  busted: { speaker: ORRIN, text: 'You took the Reserve. I\'ll mark the order as fulfilled.' },
};

/** The PA while you hang about the lot (every 30-50 s). Voiced. */
const TAUNTS = [
  'Today we have shipped three hundred and twelve orders, and every one of them was on time.',
  'If you\'re lost, stand still. Something will find you. That\'s the whole idea of the company.',
  'The rose window is a clock. When the hand reaches the top, a delivery goes out. It\'s always reaching the top.',
  'We used to be able to get anything to any bunker in two days. Then we couldn\'t. We still apologise for the inconvenience.',
  'Lo, if you can hear this, the rate on aisle nine is down. I believe in aisle nine.',
  'Every customer matters. There\'s only one now, so he matters a great deal.',
  'The drones aren\'t armed. They\'re just very good at their jobs.',
];

/** The swarm (one voice for all of them). */
export const DRONE_LINES = {
  tag: [
    { speaker: DROPT, text: 'Address confirmed. Please hold still for delivery.' },
    { speaker: DROPT, text: 'New drop-off point logged. Converging.' },
    { speaker: DROPT, text: 'Recipient located. Thank you for choosing Dropt.' },
  ],
  lost: { speaker: DROPT, text: 'Address not found. Returning to base.' },
  catch: { speaker: DROPT, text: 'Returned to sender. Thank you for choosing Dropt.' },
  rider: { speaker: DROPT, text: 'Rider nine. Order eighty-eight, ten forty-seven is running late.' },
  floor: { speaker: DROPT, text: 'Obstruction reported. Inspecting.' },
  grounded: { speaker: DROPT, text: 'Returning to base for maintenance.' },
};

/** The three associates on the floor, as you pass (voiced, one each, in turn). */
export const ASSOC_LINES = [
  { speaker: ASSOC, text: 'You\'re not on the schedule. That means you\'re not here. I didn\'t see you.' },
  { speaker: ASSOC, text: 'Don\'t stand in my lane. I\'m at a hundred and four percent and I\'d like to stay there.' },
  { speaker: ASSOC, text: 'If you\'re going up to him, the stairs are behind the altar. We don\'t go up.' },
  { speaker: ASSOC, text: 'Same tote again. Same toaster. I\'ve picked this toaster six hundred times.' },
];

export const CATHEDRAL: Bunker = {
  id: 'cathedral',
  name: 'The Cloud Cathedral',
  tier: 6,
  owner: {
    name: ORRIN,
    archetype: 'Retail and cloud-infrastructure emperor',
    bio: 'Orrin Sayle founded Dropt, then bought the cloud it ran on. He built the Cathedral as the last warehouse, sealed it with the night shift inside, and kept ordering.',
    taunts: TAUNTS,
  },
  location: { biome: 'basin', position: [198, 0, -252] },
  requirements: { skills: { stealth: 3, electronics: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The lot',
      obstacles: [{ id: 'swarm', kind: 'camera', label: 'The delivery swarm over the lot' }],
      solutions: [
        { kind: 'stealth', label: 'Keep under cover: vans, awnings, the dark' },
        { kind: 'social', label: 'Carry Rider 9\'s open order: riders aren\'t tagged' },
        { kind: 'hack', label: 'SPLICE the swarm controller at the foot of the bell tower', requires: { skills: { electronics: 4 } } },
        { kind: 'force', label: 'Shoot them down, or EMP them' },
      ],
    },
    {
      type: 'entry', title: 'The returns chute or the dock',
      obstacles: [{ id: 'returns', kind: 'door', label: 'The returns kiosk wants an order number' }, { id: 'dock', kind: 'door', label: 'The dock door' }],
      solutions: [
        { kind: 'social', label: 'Return Rider 9\'s order (#88-1047) and ride the returns line in' },
        { kind: 'hack', label: 'Short or SPLICE the kiosk', requires: { skills: { electronics: 2 } } },
        { kind: 'stealth', label: 'Pick the dock\'s wicket door' },
        { kind: 'force', label: 'A charge on the dock door', requires: { skills: { demolition: 3 }, items: ['charge'] } },
      ],
    },
    {
      type: 'interior', title: 'The floor',
      obstacles: [{ id: 'drives', kind: 'puzzle', label: 'Drive units moving shelf pods; floor drones' }],
      solutions: [
        { kind: 'social', label: 'Lo\'s spare badge: the drives route round you' },
        { kind: 'hack', label: 'E-stop the floor from the control kiosk', requires: { skills: { electronics: 3 } } },
        { kind: 'stealth', label: 'Read the drives and time it' },
      ],
    },
    {
      type: 'vault', title: 'The Day 1 office',
      obstacles: [{ id: 'office', kind: 'door', label: 'The office door at the top of the apse stair' }],
      solutions: [
        { kind: 'social', label: 'The code: it\'s always Day 1 (or Lo tells you)' },
        { kind: 'hack', label: 'SPLICE the office', requires: { skills: { electronics: 4 } } },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 4 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 18 }],
    rolls: [
      // Orrin's desk: a founder's drawers
      { item: 'medkit', qty: [1, 2], chance: 1 },
      { item: 'ration', qty: [3, 5], chance: 1 },
      { item: 'nootropics', qty: [1, 2], chance: 0.6 },
      { item: 'battery', qty: [1, 2], chance: 0.8 },
      // the returns shelf: three years of things he sent back
      { item: 'smart_bottle', qty: [1, 2], chance: 0.8 },
      { item: 'binoculars', qty: [1, 1], chance: 0.5 },
      { item: 'emp', qty: [1, 2], chance: 0.7 },
      { item: 'charge', qty: [1, 1], chance: 0.5 },
      { item: 'lockpick', qty: [3, 5], chance: 0.9 },
      { item: 'scrap', qty: [4, 8], chance: 1 },
    ],
    xp: 1200,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'returns', point: 'kiosk', radius: 2.2, doors: ['flap'],
        primary: {
          kind: 'keypad', id: 'code', label: 'Start a return at the kiosk', title: 'DROPT RETURNS', code: '1047', lockout: 3,
          lockedLabel: 'Locked out: the kiosk wants a supervisor', lockoutReason: 'Three bad order numbers. The kiosk calls a supervisor, and the swarm turns.',
          hints: [{ when: ['q.rider.log'], text: 'Rider 9\'s order: #88-1047. The kiosk wants the last four digits.' }],
          hint: 'Last four digits of a Dropt order number.',
          xp: 60, reason: 'Return started',
        },
        secondary: {
          label: 'Another way into the returns chute', speaker: 'The returns kiosk',
          text: 'A kiosk with a cracked touchscreen beside a rubber-flapped hole in the wall, and a roller line running in through it. RETURNS · NO QUESTIONS ASKED. A label printer under the screen, and a service panel held on with four screws.',
          leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'circuit', label: 'Short the chute\'s interlock', title: 'RETURNS INTERLOCK', difficulty: 2, electronics: 2, xp: 45, reason: 'Interlock shorted' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the kiosk', title: 'RETURNS KIOSK', host: 'DROPT · REVERSE LOGISTICS', difficulty: 3, electronics: 3,
              daemons: ['returnslabel', 'swarm'], xpEach: 35, reason: 'Spliced the kiosk',
              traced: 'Trace complete. Dropt flagged the kiosk, and the swarm turns toward it.',
            },
          ],
        },
        line: ORRIN_LINES.returns.text,
      },
      {
        id: 'dock', point: 'dock', radius: 2.2, doors: ['dockDoor'],
        primary: { kind: 'lockpick', pins: 5, title: 'DOCK WICKET' },
        secondary: {
          label: 'Another way through the dock', speaker: 'The dock',
          text: 'Three roll-up doors behind a row of dead vans, all down. A wicket door in the middle one with a padlock and a control box: UP / DOWN / STOP, and a keyhole for the supervisor.',
          leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'circuit', label: 'Short the door controller', title: 'DOCK CONTROLLER', difficulty: 3, electronics: 3, xp: 50, reason: 'Dock controller shorted' },
            { kind: 'charge', label: 'Blow the wicket', demolition: 3, quiet: true, loud: 'The wicket door folds in. Every drone over the lot turns at once.', line: ORRIN_LINES.dockLoud.text },
          ],
        },
        line: ORRIN_LINES.dock.text,
        trauma: 0.05,
      },
      {
        id: 'office', point: 'officeDoor', radius: 2.0, doors: ['officeDoor'],
        primary: {
          kind: 'keypad', id: 'code', label: 'Use the keypad', title: 'DAY 1 OFFICE', code: '0001', lockout: 3,
          lockedLabel: 'Locked out: wait for the floor to forget you', lockoutReason: 'Three wrong codes. The office calls the floor drones.',
          hints: [
            { when: ['cathedral.lo.code'], text: 'Lo said it: zero, zero, zero, one. Day one.' },
            { when: ['cathedral.plaque'], text: 'The plaque at the foot of the stair: IT IS ALWAYS DAY 1. Four digits.' },
          ],
          hint: 'Four digits. The plaque at the foot of the stair says something about it.',
          xp: 60, reason: 'Office code',
        },
        secondary: {
          label: 'Another way into the office', speaker: 'The office door',
          text: 'A plain hollow-core door at the top of the stair, painted orange, with a keypad screwed on beside it. A brass plate: O. SAYLE · DAY 1.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the office', title: 'DAY 1 OFFICE', host: 'DROPT · ADMIN', difficulty: 4, electronics: 4,
              daemons: ['cathoffice', 'pods'], xpEach: 40, reason: 'Spliced the office',
              traced: 'Trace complete. The floor drones come to look.',
            },
            { kind: 'charge', label: 'Blow the door', demolition: 4, quiet: true, loud: 'The door goes into the office in pieces. Down on the floor, every drive stops.', line: ORRIN_LINES.officeLoud.text },
          ],
        },
        line: ORRIN_LINES.office.text,
      },
    ],
    // the nave is sealed: the inside hides the world (interior mode) while the doors are out of view
    portals: [
      { entry: 'dock', pad: [1.2, 1.5, 2.5] },
    ],
    voice: {
      point: 'speaker',
      greet: ORRIN_LINES.greet.text,
      greetRadius: 140,
      tauntRadius: 95,
      alarm: [
        'We have an exception on the floor. Drones, please resolve it.',
        'Something is where it shouldn\'t be. That\'s a logistics problem, and logistics is what we do.',
        'Lo, there\'s a person in the system. Please find out whose they are.',
      ],
    },
    alarmTime: 30,
    loot: {
      behind: 'office',
      containers: [
        { id: 'pallet', label: 'Take the Reserve: Orrin\'s pallet of water', take: 'guaranteed' },
        { id: 'desk', label: 'Go through Orrin\'s desk', take: [0, 4] },
        { id: 'shelf', label: 'Search the returns shelf', take: [4] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: The Cloud Cathedral',
        banner: 'The Reserve is empty. The order is marked fulfilled.',
        line: ORRIN_LINES.busted.text,
      },
    },
  },
};

/** The pad Heightfield flattens in the basin, and Dropt's service road up from the highway. */
export const CATHEDRAL_PAD = { r: 54, falloff: 16, target: -5 };
export const CATHEDRAL_ROAD: [number, number][] = [[250, -72], [240, -118], [226, -150], [212, -176], [204, -188]];

/** Flags the Cathedral's own code reads (the runtime derives the rest from the ids above). */
export const CATHEDRAL_FLAGS = {
  marker: 'cathedral.marker',
  seen: 'seen:cathedral',
  returns: 'cathedral.returns.open',
  dock: 'cathedral.dock.open',
  office: 'cathedral.office.open',
  complete: 'cathedral.complete',
  /** Rode the returns line in at least once. */
  rode: 'cathedral.rode',
  /** Read the plaque at the foot of the apse stair. */
  plaque: 'cathedral.plaque',
  /** Lo: met, gave you Mateo's badge, told you the code, will run it. */
  loMet: 'cathedral.lo.met',
  loCode: 'cathedral.lo.code',
  loReady: 'cathedral.lo.ready',
  /** Spliced the swarm down (grounded for good). */
  grounded: 'cathedral.swarm.grounded',
  /** Returned to sender at least once; loud somewhere. */
  caught: 'cathedral.caught',
  loud: 'cathedral.loud',
  /** Met Orrin at his desk. */
  orrin: 'cathedral.orrin',
  /** The ending: cathedral.end.close / cathedral.end.hand. */
  end: 'cathedral.end',
};

// ------------------------------------------------------------------ the plaque and the board
export const PLAQUE = {
  speaker: 'A brass plaque',
  text: 'Screwed to the newel post at the foot of the apse stair, polished where hands have rubbed it:\nIT IS ALWAYS DAY 1.\nO.S.',
};

export const KIOSK_DONE = {
  speaker: 'Dropt · Returns',
  text: 'RETURN AUTHORISED\nOrder #88-1047 · 1× stove igniter (universal)\nReason: running late\nPlace the item in a tote. The tote will be collected.\n\nThe printer pushes out a label. There\'s one empty tote on the line, and it is big enough.',
};

// ------------------------------------------------------------------ conversations
export interface CathedralView {
  social: number;
  electronics: number;
  has: (f: string) => boolean;
  count: (id: string) => number;
}
export interface CathedralChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: CathedralView) => boolean;
  need?: (v: CathedralView) => string | undefined;
  /** badge: Lo's spare badge · code: Lo tells you the code · ready: Lo will run it · end: the key */
  effect?: 'badge' | 'code' | 'ready' | 'end';
}
export type CathedralTalk = Record<string, { speaker: string; text: string; choices: CathedralChoice[] }>;

/** Lo at the shift lead's desk by the crossing. */
export const LO_TALK: CathedralTalk = {
  hello: {
    speaker: LO,
    text: 'You\'re not on the schedule. Don\'t stand there, the drives will stop and it goes on my rate. Over here. What do you want?',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'stay', label: '"Why are you still in here?"', next: 'stay' },
      { id: 'drives', label: '"How do I get across the floor?"', next: 'drives', when: (v) => v.count('mateo_badge') < 1 },
      { id: 'office', label: '"How do I get into his office?"', next: 'office', when: (v) => !v.has('cathedral.office.open') && !v.has('cathedral.lo.code') },
      { id: 'after', label: '"If I get up there, what do you want me to do?"', next: 'want', when: (v) => !v.has('cathedral.lo.ready') },
      { id: 'bye', label: 'Let her work', next: null },
    ],
  },
  who: {
    speaker: LO,
    text: 'Lo Ibarra. Shift lead. Fourteen hundred and seven shifts. There were thirty of us on the floor the morning it happened. There are four now.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  stay: {
    speaker: LO,
    text: 'The doors open at shift end. Shift end is a field in his system, and it\'s blank. People went out through the dock in the first year. The drones brought them back. We get water when we make rate. We make rate.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  drives: {
    speaker: LO,
    text: 'The drives stop for anything without a badge, and then a floor drone comes to see what stopped them. Here. Mateo\'s badge. He doesn\'t need it any more. Keep it on the outside of your coat.',
    choices: [{ id: 'ok', label: 'Take the badge', next: 'hello', effect: 'badge' }],
  },
  office: {
    speaker: LO,
    text: 'Up the stair behind the altar. Zero, zero, zero, one. Day one. He thinks it\'s inspiring. I\'ve never been up. None of us have.',
    choices: [{ id: 'ok', label: '"Thanks."', next: 'hello', effect: 'code' }],
  },
  want: {
    speaker: LO,
    text: 'If there\'s a choice up there, give it to us. We know where everything is. We\'ve known where everything is for four years. He only knows where it\'s going.',
    choices: [
      { id: 'yes', label: '"If I can, it\'s yours."', next: 'promised', effect: 'ready' },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  promised: {
    speaker: LO,
    text: 'Okay. Okay. Go on, then. And don\'t stand in aisle nine. Bea\'s at a hundred and four.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
  after: {
    speaker: LO,
    text: 'I\'m still on shift. Somebody has to be.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
};

/** Orrin at his desk in the Day 1 office. */
export const ORRIN_TALK: CathedralTalk = {
  hello: {
    speaker: ORRIN_ROOM,
    text: 'Come in, come in. You must be the customer. Can I get you anything? I can get you anything. That used to be a figure of speech.',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'floor', label: '"There are four people down there."', next: 'floor' },
      { id: 'orders', label: '"Who are you shipping to?"', next: 'orders' },
      { id: 'water', label: '"The water."', next: 'water' },
      { id: 'decide', label: 'Go to his console', next: null, effect: 'end' },
      { id: 'bye', label: 'Step back', next: null },
    ],
  },
  who: {
    speaker: ORRIN_ROOM,
    text: 'Orrin Sayle. I started Dropt in a garage with a van and a scanner. Ten minutes or it\'s free. Then two days to any bunker in the country. Then week nine.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  floor: {
    speaker: ORRIN_ROOM,
    text: 'The best team I\'ve ever had. Fourteen hundred shifts without a missed pick. I would never let them go. That\'s the culture here. We don\'t let people go.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  orders: {
    speaker: ORRIN_ROOM,
    text: 'Me. I place the orders every morning. If nobody orders, the network forgets how to deliver, and then it\'s gone. So I order. I open everything. I rate it. Then I send it back down. Returns are part of the experience.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: ORRIN_ROOM,
    text: 'That\'s the Reserve. Dropt Spring, twelve hundred bottles. It\'s for the customer.',
    choices: [
      { id: 'who2', label: '"Who\'s the customer?"', next: 'customer' },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  customer: {
    speaker: ORRIN_ROOM,
    text: 'Whoever is standing in this office. Today, that\'s you. Congratulations.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  after: {
    speaker: ORRIN_ROOM,
    text: 'Is there anything else I can help you with today?',
    choices: [{ id: 'bye', label: 'Step back', next: null }],
  },
};

/** The console in the office, and what each choice gets said about it. */
export const NETWORK = {
  card: {
    speaker: 'The console',
    text: 'A door laid across two sawhorses, a laptop and one screen: FULFILMENT NETWORK · CUSTOMERS: 1 · ORDERS TODAY: 312 · ON TIME: 100%. Under the desk, a red key switch: SITE SHUTDOWN. On the screen, a form nobody has opened: TRANSFER OF OWNERSHIP.',
  },
  /** Why the transfer is greyed out. */
  handNeeds: 'Someone has to agree to run it (Lo, on the floor), or Social 4',
  close: [
    { speaker: ORRIN_ROOM, text: 'What are you doing? That\'s the site key. That\'s not a customer feature.' },
    { speaker: ORRIN_ROOM, text: 'Lo? Lo, the doors are open. Lo, it isn\'t shift end. Lo.' },
  ],
  hand: [
    { speaker: ORRIN_ROOM, text: 'Transfer of ownership. I wrote that form. I never thought anyone would fill it in.' },
    { speaker: LO, text: 'This is Lo. Effective now, the doors are open, and the drones deliver to people. Orrin, you\'re on aisle nine at six.' },
  ],
};

/** Orrin afterwards (one a visit, in turn). Voiced. */
export const ORRIN_AFTER = {
  close: [
    { speaker: ORRIN_ROOM, text: 'I placed an order this morning. Nobody picked it. I\'ve never had to wait before.' },
    { speaker: ORRIN_ROOM, text: 'It\'s very quiet without the drives. I didn\'t know the building made a sound on its own.' },
  ],
  hand: [
    { speaker: ORRIN_ROOM, text: 'My rate is thirty-one percent. Lo says that\'s a learning curve. Lo is being kind.' },
    { speaker: ORRIN_ROOM, text: 'Did you know the toaster is in four different bins? I didn\'t know that. I ordered it six hundred times.' },
  ],
};

/** Lo at the camp afterwards (she walked out), one a visit, in turn. Voiced. */
export const LO_CAMP = [
  { speaker: LO, text: 'I keep waking up at five fifteen. Pip says I\'ll stop. Pip is twelve.' },
  { speaker: LO, text: 'Mara asked me what I want to do now. I said I don\'t know. It was the first time in four years anyone asked.' },
  { speaker: LO, text: 'Bea and the twins went on to Waitlist City. I\'m staying here for a while. Nobody here has a rate.' },
  { speaker: LO, text: 'Tell Hollis his jugs are stacked wrong. Heavy at the bottom. It\'s not hard.' },
];

/** The daily drop at the camp (the transfer). Voiced. */
export const DROP = {
  hello: { speaker: DROPT, text: 'Delivery for Last Chance. Two waters, one ration. Ordered by the associates. Have a good day.' },
};
