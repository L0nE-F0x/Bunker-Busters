import type { Bunker } from '../types';

/**
 * Tier 7, the Chip Fortress (Act VII): Kit Szabo's keep in the basin under the southern range,
 * between Photon Park and the mesa. Kit ran Lattice, which sold the chips everyone needed, a few at a
 * time, to whoever she liked. Before the Pivot she built a star fort for nine months of supply: a
 * black keep in a ring of walls and bastions, inside a moat of coolant that never stops steaming. The
 * runtime is game/bunker/fortress/.
 *
 * - The price never peaked. Kit is still in the vault at her allocation desk, waiting for it, with the
 *   racks of boxed chips behind glass. Five of her eight technicians are left; each gets one unit of
 *   heat a day. Marek Kowal leads them from the locker room.
 * - The moat: minus forty. Cross by the drawbridge (the gatehouse wants the list price; SPLICE; or blow
 *   the winch). Or drain it at the pump house, or swim it (it hurts, and you come out as cold as the
 *   walls: the thermal cameras can't see you for a while), and pick the frost door in the west curtain.
 * - Thermal cameras on the bastions and in the keep; technicians walk the yard and the hall, and walk
 *   you out over the bridge if they catch you.
 * - The power board: three units. The chillers, the hall's laser grid and the lights each take one; the
 *   vault door takes two. Pick what you can do without. Chillers off (or the moat drained): the hall
 *   heats up and the thermal cameras white out.
 * - The ending at the allocation console: shut the chillers down for good (the stock cooks; the pumps
 *   under the range stop, and the seep in the Cut runs again), or rewrite the allocation table (the
 *   Fortress's power goes to the camps: a battery rack at Last Chance, two a day).
 */

/** Kit over the PA, and in the room with you. */
export const KIT = 'Kit Szabo';
export const KIT_ROOM = 'Kit';
export const MAREK = 'Marek Kowal';
export const TECH = 'Cooling tech';
/** The console's card (unvoiced). */
export const CONSOLE = 'Allocation console';

/** Kit's lines over the PA and at her desk (voiced). */
export const KIT_LINES = {
  greet: { speaker: KIT, text: 'You\'re in the queue. Everyone is in the queue. Please hold your position.' },
  bridge: { speaker: KIT, text: 'Somebody lowered my bridge. That\'s an unauthorised allocation of bridge.' },
  bridgeLoud: { speaker: KIT, text: 'You blew the winch. Do you know the lead time on a winch?' },
  postern: { speaker: KIT, text: 'You came in by the frost door. My own technicians don\'t like using the frost door.' },
  swim: { speaker: KIT, text: 'You swam the moat. It\'s minus forty. You\'re either very cold or very stupid.' },
  keep: { speaker: KIT, text: 'You\'re in the keep. Please don\'t touch anything. Everything in here is spoken for.' },
  keepLoud: { speaker: KIT, text: 'That door was on back order for a year. I\'m adding it to your account.' },
  chillers: { speaker: KIT, text: 'The chillers are off. Marek, the chillers are off. The stock can\'t take heat.' },
  drained: { speaker: KIT, text: 'Who drained my moat? That was nine thousand litres of coolant at list price.' },
  vault: { speaker: KIT, text: 'Fine. Come in. Mind the racks. Every box in here is worth more than you.' },
  vaultLoud: { speaker: KIT, text: 'You blew the vault door. I can\'t even be angry. I\'m impressed by the demand.' },
  caught: { speaker: KIT, text: 'Back of the queue. That\'s where everybody goes.' },
  busted: { speaker: KIT, text: 'You took the water. That was allocated. I\'ll reallocate.' },
};

/** The PA while you wait about outside (every 30-50 s). Voiced. */
const TAUNTS = [
  'Demand is at an all-time high. Supply is exactly where I left it.',
  'The moat is minus forty degrees. Please don\'t test that. People test that.',
  'The next allocation window opens in nine months. It\'s been nine months for three years.',
  'If you\'re here for chips, take a ticket. If you\'re here for water, take a ticket.',
  'Everything in the Fortress is accounted for. Everything. I count it every morning.',
  'The list price is the list price. Nobody has ever paid the list price.',
  'My technicians get one unit of heat a day. Same as me. That\'s fair.',
];

/** The technicians (voiced, through respirators: one voice). */
export const TECH_LINES = {
  notice: [
    { speaker: TECH, text: 'Hey. You\'re not on the allocation. Stay there.' },
    { speaker: TECH, text: 'Somebody\'s here. It\'s too cold to chase you, so don\'t make me.' },
    { speaker: TECH, text: 'Stop right there. Please. My hands don\'t work fast in this.' },
  ],
  lost: [
    { speaker: TECH, text: 'Gone. Good. Back to the coolers.' },
    { speaker: TECH, text: 'I didn\'t see anyone. That\'s what I\'m writing down.' },
  ],
  catch: [
    { speaker: TECH, text: 'Got you. Come on, out over the bridge. Mind the ice.' },
    { speaker: TECH, text: 'Back to the queue. Sorry. It\'s her rule, not mine.' },
  ],
  down: { speaker: TECH, text: 'Ow. Okay. Okay. I\'m staying down.' },
  shielded: { speaker: TECH, text: 'That buzzed. Nothing in this suit is electric.' },
  armoured: { speaker: TECH, text: 'Please stop. The suit\'s thick, but not that thick.' },
};

export const FORTRESS: Bunker = {
  id: 'fortress',
  name: 'The Chip Fortress',
  tier: 7,
  owner: {
    name: KIT,
    archetype: 'GPU baron',
    bio: 'Kit Szabo ran Lattice and sold the chips everyone needed, a few at a time, to whoever she liked. She built a star fort with a moat of coolant for nine months of supply, and she is still waiting for the price to peak.',
    taunts: TAUNTS,
  },
  location: { biome: 'basin', position: [-127, 0, 324] },
  requirements: { skills: { electronics: 4, demolition: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The moat',
      obstacles: [{ id: 'moat', kind: 'puzzle', label: 'A moat of coolant at minus forty' }, { id: 'bridge', kind: 'door', label: 'The drawbridge and the gatehouse keypad' }],
      solutions: [
        { kind: 'social', label: 'The code is the list price (a note in the queue)' },
        { kind: 'hack', label: 'SPLICE the gatehouse', requires: { skills: { electronics: 3 } } },
        { kind: 'stealth', label: 'Drain the moat at the pump house (or swim it) and pick the frost door' },
        { kind: 'force', label: 'Blow the winch, or swim it', requires: { skills: { demolition: 4 }, items: ['charge'] } },
      ],
    },
    {
      type: 'entry', title: 'The yard and the keep door',
      obstacles: [{ id: 'cams', kind: 'camera', label: 'Thermal cameras on the bastions' }, { id: 'keep', kind: 'door', label: 'The keep door' }],
      solutions: [
        { kind: 'stealth', label: 'Come out of the moat cold, or turn the chillers off: the cameras see heat' },
        { kind: 'social', label: 'Marek\'s badge' },
        { kind: 'hack', label: 'Short or SPLICE the keep door', requires: { skills: { electronics: 4 } } },
      ],
    },
    {
      type: 'interior', title: 'The power board',
      obstacles: [{ id: 'power', kind: 'puzzle', label: 'Three units of power; the vault door wants two' }, { id: 'grid', kind: 'tripwire', label: 'A laser grid in the hall' }],
      solutions: [
        { kind: 'hack', label: 'Switch off what you can live without: the chillers, the grid, the lights' },
      ],
    },
    {
      type: 'vault', title: 'The allocation floor',
      obstacles: [{ id: 'vault', kind: 'door', label: 'The vault door (powered)' }],
      solutions: [
        { kind: 'hack', label: 'Give the vault door two units at the board' },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 16 }],
    rolls: [
      // the dispenser: your allocation
      { item: 'gpu', qty: [2, 3], chance: 1 },
      { item: 'asic', qty: [1, 2], chance: 0.9 },
      { item: 'battery', qty: [2, 3], chance: 1 },
      // Kit's desk
      { item: 'medkit', qty: [1, 2], chance: 1 },
      { item: 'ration', qty: [2, 4], chance: 1 },
      { item: 'nootropics', qty: [1, 2], chance: 0.6 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'charge', qty: [1, 1], chance: 0.5 },
    ],
    xp: 1300,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'bridge', point: 'gatehouse', radius: 2.2, doors: ['bridge', 'gate'],
        primary: {
          kind: 'keypad', id: 'code', label: 'Use the gatehouse keypad', title: 'ALLOCATION GATE', code: '1599', lockout: 3,
          lockedLabel: 'Locked out: the gatehouse wants a supervisor', lockoutReason: 'Three wrong codes. The gatehouse calls the yard.',
          hints: [{ when: ['fortress.queue'], text: 'The note in the queue: the code is the list price. One five nine nine.' }],
          hint: 'Four digits. The people in the queue had theories.',
          xp: 60, reason: 'Gate code',
        },
        secondary: {
          label: 'Another way across the moat', speaker: 'The gatehouse',
          text: 'A booth of black panels on the outer bank, a keypad in a frosted plate, and a slot for a ticket. Above it the drawbridge stands upright against the gate, held by a winch in a housing the size of a car engine. ALLOCATION GATE · CUSTOMERS WILL BE NOTIFIED.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the gatehouse', title: 'ALLOCATION GATE', host: 'LATTICE · PERIMETER', difficulty: 3, electronics: 3,
              daemons: ['bridge', 'thermcams'], xpEach: 40, reason: 'Spliced the gatehouse',
              traced: 'Trace complete. The gatehouse logged your splicer, and the yard knows.',
            },
            { kind: 'charge', label: 'Blow the winch', demolition: 4, quiet: false, loud: 'The winch housing splits and the bridge comes down across the moat with a crash that shakes the frost off the walls.', line: KIT_LINES.bridgeLoud.text },
          ],
        },
        line: KIT_LINES.bridge.text,
        trauma: 0.1,
      },
      {
        id: 'pump', point: 'pumpDoor', radius: 2.0, doors: ['pumpDoor'],
        primary: { kind: 'lockpick', pins: 4, title: 'PUMP HOUSE' },
        secondary: { kind: 'charge', label: 'Blow the pump house door', demolition: 3, quiet: true, loud: 'The pump house door comes off. Somebody on the walls shouts.', line: null },
        line: null,
      },
      {
        id: 'postern', point: 'postern', radius: 2.0, doors: ['postern'],
        primary: { kind: 'lockpick', pins: 6, title: 'FROST DOOR' },
        secondary: {
          label: 'Another way through the frost door', speaker: 'The frost door',
          text: 'A low steel door in the west curtain, rimed white, for the technicians who check the moat. A keyhole, and a junction box beside it with a hexagon stencilled on.',
          leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'circuit', label: 'Short the junction box', title: 'FROST DOOR', difficulty: 3, electronics: 3, xp: 50, reason: 'Frost door shorted' },
            { kind: 'charge', label: 'Blow the frost door', demolition: 3, quiet: true, loud: 'The frost door blows in. Ice comes off the whole west wall.', line: null },
          ],
        },
        line: KIT_LINES.postern.text,
      },
      {
        id: 'keep', point: 'keepDoor', radius: 2.0, doors: ['keepDoor'],
        primary: { kind: 'lockpick', pins: 6, title: 'KEEP DOOR' },
        secondary: {
          label: 'Another way into the keep', speaker: 'The keep door',
          text: 'A steel door in the keep\'s north face, frost round its seals, a badge reader with a hexagon on it, and a lock under that. LATTICE · AUTHORISED PERSONNEL · ALLOCATION IN PROGRESS.',
          leave: 'Leave it',
          methods: [
            { kind: 'open', id: 'badge', label: 'Touch Marek\'s badge to the reader', xp: 50, reason: 'Marek\'s badge' },
            { kind: 'circuit', id: 'circuit', label: 'Short the badge reader', title: 'KEEP READER', difficulty: 4, electronics: 4, xp: 60, reason: 'Reader shorted' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the keep door', title: 'KEEP DOOR', host: 'LATTICE · FACILITIES', difficulty: 4, electronics: 4,
              daemons: ['keepdoor', 'lasers'], xpEach: 40, reason: 'Spliced the keep',
              traced: 'Trace complete. The keep logged your splicer.',
            },
            { kind: 'charge', label: 'Blow the door', demolition: 4, quiet: true, loud: 'The keep door folds in. Frost falls off the whole north face.', line: KIT_LINES.keepLoud.text },
          ],
        },
        line: KIT_LINES.keep.text,
        trauma: 0.05,
      },
      {
        id: 'vault', point: 'vaultDoor', radius: 2.0, doors: ['vaultDoor'],
        // (Fortress.methodReason: it needs two units at the board)
        primary: { kind: 'open', id: 'power', label: 'Open the vault door', xp: 60, reason: 'The vault door had power' },
        secondary: { kind: 'charge', label: 'Blow the vault door', demolition: 5, quiet: false, loud: 'The vault door blows off its rails. Every technician in the keep starts running.', line: KIT_LINES.vaultLoud.text },
        line: KIT_LINES.vault.text,
        trauma: 0.1,
      },
    ],
    // the keep is sealed: the inside hides the world while its door is out of view
    portals: [{ entry: 'keep', pad: [1.2, 1.5, 2.5] }],
    voice: {
      point: 'speaker',
      greet: KIT_LINES.greet.text,
      greetRadius: 130,
      tauntRadius: 90,
      alarm: [
        'There is an unallocated person in the Fortress. Technicians, please allocate them out.',
        'Everyone stay where you are. Nothing moves until I say it moves.',
        'That\'s an incident. Incidents come out of the heat budget.',
      ],
    },
    alarmTime: 30,
    lasers: {
      tripped: { default: 'You broke a beam in the hall. The keep logs an incident.' },
      alarmPoint: 'hall',
      power: {
        id: 'gridbox', point: 'gridBox', radius: 1.6, label: 'Short the grid\'s junction box',
        circuit: { title: 'GRID JUNCTION', difficulty: 3 },
        expert: 4, expertToast: 'You pull the grid\'s fuse without even opening the panel. The beams go out.',
        xp: 45, reason: 'Grid down',
        shock: { damage: 12, toast: 'The junction box bites back. Your arm goes numb to the shoulder.' },
        sparkOffset: [0, 0.2, 0.15],
      },
    },
    cameras: { tripped: 'A thermal camera saw you. The Fortress logs an incident.', detectTime: 1.4 },
    loot: {
      behind: 'vault',
      containers: [
        { id: 'tank', label: 'Fill up from the drinking tank', take: 'guaranteed' },
        { id: 'dispenser', label: 'Take your allocation from the dispenser', take: [0, 3] },
        { id: 'kitdesk', label: 'Go through Kit\'s desk', take: [3] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: The Chip Fortress',
        banner: 'The tank is dry. The allocation is yours.',
        line: KIT_LINES.busted.text,
      },
    },
  },
};

/** The moat: a ring trench (radii, depth below the pad); Heightfield carves it, the builder lines it. */
export const FORTRESS_MOAT = { r0: 24, r1: 30.5, depth: 3.4 };

/** The pad Heightfield flattens in the basin, and Lattice's road south from the highway, west of the mesa. */
export const FORTRESS_PAD = { r: 40, falloff: 14, target: 1 };
export const FORTRESS_ROAD: [number, number][] = [[-96, 121], [-118, 170], [-140, 214], [-150, 252], [-142, 278], [-131, 286]];

/** Flags the Fortress's own code reads (the runtime derives the rest from the ids above). */
export const FORTRESS_FLAGS = {
  marker: 'fortress.marker',
  seen: 'seen:fortress',
  bridge: 'fortress.bridge.open',
  keep: 'fortress.keep.open',
  vault: 'fortress.vault.open',
  complete: 'fortress.complete',
  /** Read the note in the allocation queue (the list price). */
  queue: 'fortress.queue',
  pump: 'fortress.pump.open',
  postern: 'fortress.postern.open',
  /** The moat drained at the pump house. */
  drained: 'fortress.drained',
  /** Swam the moat at least once. */
  swam: 'fortress.swam',
  /** The board: what's switched off/on. */
  chillersOff: 'fortress.p.chillers.off',
  lightsOff: 'fortress.p.lights.off',
  vaultOn: 'fortress.p.vault.on',
  /** Marek: met, gave you his badge, told you about the board, will run the turbine. */
  marekMet: 'fortress.marek.met',
  marekBoard: 'fortress.marek.board',
  marekReady: 'fortress.marek.ready',
  /** Met Kit at her desk. */
  kit: 'fortress.kit',
  /** The ending: fortress.end.shut / fortress.end.realloc. */
  end: 'fortress.end',
  caught: 'fortress.caught',
  loud: 'fortress.loud',
};

/** The power board's budget. */
export const POWER = { units: 3, chillers: 1, grid: 1, lights: 1, vault: 2 };

// ------------------------------------------------------------------ the queue, the pump house, the board
export const QUEUE_NOTE = {
  speaker: 'Note in the queue',
  text: 'Taped to the back of a camping chair, under a ticket stub (No. 0418):\nDay 61. They told us the gate code is the list price.\nNobody in this line has ever paid list.\nIf you get in, the list price was 1,599. Tell them Andrea was here first.',
};

export const PUMP_CARD = {
  speaker: 'The pump house',
  text: 'Two pumps the size of cars, frost on every pipe, and a panel of valves. One big red wheel is labelled MOAT · DRAIN TO HOLDING. A gauge beside it reads −41 °C.',
};

/** The board's card (unvoiced: a control panel reads like a control panel). */
export function boardText(on: { chillers: boolean; grid: boolean; lights: boolean; vault: boolean }) {
  const used = (on.chillers ? POWER.chillers : 0) + (on.grid ? POWER.grid : 0) + (on.lights ? POWER.lights : 0) + (on.vault ? POWER.vault : 0);
  const row = (name: string, n: number, v: boolean) => `${v ? '■' : '□'} ${name.padEnd(12, ' ')} ${n} unit${n > 1 ? 's' : ''}`;
  return [
    `LATTICE · FORTRESS POWER · ${used} / ${POWER.units} UNITS`,
    row('CHILLERS', POWER.chillers, on.chillers),
    row('HALL GRID', POWER.grid, on.grid),
    row('LIGHTS', POWER.lights, on.lights),
    row('VAULT DOOR', POWER.vault, on.vault),
    'Do not switch off the chillers. — K.',
  ].join('\n');
}

// ------------------------------------------------------------------ conversations
export interface FortressView {
  social: number;
  electronics: number;
  has: (f: string) => boolean;
  count: (id: string) => number;
}
export interface FortressChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: FortressView) => boolean;
  need?: (v: FortressView) => string | undefined;
  /** badge: Marek's badge · board: Marek explains the board · ready: Marek will run it · end: the console */
  effect?: 'badge' | 'board' | 'ready' | 'end';
}
export type FortressTalk = Record<string, { speaker: string; text: string; choices: FortressChoice[] }>;

/** Marek in the locker room. */
export const MAREK_TALK: FortressTalk = {
  hello: {
    speaker: MAREK,
    text: 'Shut the door behind you. We get one unit of heat a day and that door eats half of it. Who are you?',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'kit', label: '"What does she do in there?"', next: 'kit' },
      { id: 'board', label: '"How do I get the vault open?"', next: 'board', when: (v) => !v.has('fortress.vault.open') },
      { id: 'badge', label: '"I need to get around the keep."', next: 'badge', when: (v) => v.count('marek_badge') < 1 && !v.has('fortress.keep.open') },
      { id: 'run', label: '"If I get to her console, what should I do?"', next: 'run', when: (v) => !v.has('fortress.marek.ready') },
      { id: 'bye', label: 'Leave him to it', next: null },
    ],
  },
  who: {
    speaker: MAREK,
    text: 'Marek. Lead technician. Eight of us came in with her. There are five now. We keep her stock at minus four and ourselves at about plus six.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  kit: {
    speaker: MAREK,
    text: 'She counts. Every morning, every box. Then she checks a price feed that hasn\'t updated in three years. Then she counts again.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  board: {
    speaker: MAREK,
    text: 'The board in the west room runs everything. Three units. The vault door wants two. Switch off what you can live without. Not the chillers, she\'ll say. She always says.',
    choices: [{ id: 'ok', label: '"Thanks."', next: 'hello', effect: 'board' }],
  },
  badge: {
    speaker: MAREK,
    text: 'Take mine. It opens the keep door and the lockers. If she asks, I dropped it in the moat. That\'s happened before.',
    choices: [{ id: 'ok', label: 'Take the badge', next: 'hello', effect: 'badge' }],
  },
  run: {
    speaker: MAREK,
    text: 'There\'s a turbine under the keep that could run every camp in the valley. Give it to them. We\'ll keep it running. We\'d just like to be warm while we do it.',
    choices: [
      { id: 'yes', label: '"If I can, I will."', next: 'promised', effect: 'ready' },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  promised: {
    speaker: MAREK,
    text: 'Then go and do it before the heat runs out.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
  after: {
    speaker: MAREK,
    text: 'Whatever happens to her, the coolers still need someone. That\'s us.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
};

/** Kit at her allocation desk in the vault. */
export const KIT_TALK: FortressTalk = {
  hello: {
    speaker: KIT_ROOM,
    text: 'You\'re not on the allocation list. Nobody is on the allocation list. That\'s what makes it an allocation.',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'chips', label: '"Nine months of chips."', next: 'chips' },
      { id: 'techs', label: '"Your technicians are freezing."', next: 'techs' },
      { id: 'water', label: '"Where does the water come from?"', next: 'water' },
      { id: 'decide', label: 'Go to the allocation console', next: null, effect: 'end' },
      { id: 'bye', label: 'Step back', next: null },
    ],
  },
  who: {
    speaker: KIT_ROOM,
    text: 'Kit Szabo. I ran Lattice. Everybody needed what I made, so I sold it a few at a time, to people I liked. Prices went up. That was the business. It was a very good business.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  chips: {
    speaker: KIT_ROOM,
    text: 'Nine months of supply. The price was still going up when everyone stopped buying. It\'ll come back. Prices always come back.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  techs: {
    speaker: KIT_ROOM,
    text: 'Everyone gets one unit of heat a day. Me too. One unit, every person, every day. That\'s fair. That\'s the definition of fair.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: KIT_ROOM,
    text: 'From under the range. The chillers need it, so I bought the rights before anyone thought to. You can buy the rights to anything if you get in early.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  after: {
    speaker: KIT_ROOM,
    text: 'Supply is constrained. It always will be.',
    choices: [{ id: 'bye', label: 'Step back', next: null }],
  },
};

/** The console, and what each choice gets said about it. */
export const ALLOCATION = {
  card: {
    speaker: CONSOLE,
    text: 'A terminal on Kit\'s desk, one table on the screen: ALLOCATION · WINDOW 0001. Every row is a name and a number of units, and every number is zero except hers. Under the table, a key labelled CHILLERS · MASTER, and a cursor in an empty row.',
  },
  /** Why rewriting the table is greyed out. */
  reallocNeeds: 'Someone has to keep the turbine running (Marek, in the locker room), or Social 4, or Electronics 5',
  shut: [
    { speaker: KIT_ROOM, text: 'No. No, the stock can\'t take heat. That\'s nine months. That\'s nine months of supply.' },
    { speaker: KIT_ROOM, text: 'Do you know what that was worth? Do you know what that would have been worth?' },
  ],
  realloc: [
    { speaker: KIT_ROOM, text: 'You can\'t give it to everyone. If everyone gets an allocation, it isn\'t an allocation.' },
    { speaker: MAREK, text: 'This is Marek. The turbine\'s on the camp line. Kit, you\'re on the list too. One unit. Same as everyone.' },
  ],
};

/** Kit afterwards, one a visit, in turn. Voiced. */
export const KIT_AFTER = {
  shut: [
    { speaker: KIT_ROOM, text: 'I keep checking the price feed. It\'s still not updating.' },
    { speaker: KIT_ROOM, text: 'Marek brought me soup. I didn\'t ask for soup. I ate the soup.' },
  ],
  realloc: [
    { speaker: KIT_ROOM, text: 'Last Chance took two units today. Waitlist City took four. Somebody has to keep the books.' },
    { speaker: KIT_ROOM, text: 'I still count the boxes. I just don\'t know what for.' },
  ],
};

/** The battery rack at the camp (the reallocation), and the seep in the Cut (the shutdown). Voiced. */
export const RACK = {
  hello: { speaker: MAREK, text: 'Two charged for Last Chance. The rack fills up again overnight. Don\'t say thanks, say when you need more.' },
};
