import type { Bunker } from '../types';

/**
 * The final bunker, Bunker Zero (Act VIII): under the forecourt of Last Chance Gas. The camp has
 * lived on its roof for three and a half years. The runtime is game/bunker/zero/.
 *
 * - Agnes Price owns Deepwell Shelter Systems. Her father Walt dug wells and sold fallout shelters to
 *   ranchers from 1961; she sold doors to the founders. She built all seven of their bunkers, and her
 *   maker's plate is on every door the player opened. Each client cut something to save money (a
 *   fence, a battery, a camera on the wrong pole), and she wrote every cut down and had them sign it.
 *   Those cuts are the ways in the player found.
 * - Zero is hers. It's a 2,100-foot bore into water the Kade pumps never reached, a cistern, two
 *   hundred bunks and ten years of stores. She paid for it by padding every founder's change orders by
 *   eleven percent. It was meant for whoever was left. The LAST CHANCE sign on the pylon was hers.
 * - On the day of the Pivot she came down to open it and couldn't. There were two hundred bunks and
 *   four thousand people on the band, and she couldn't choose who got them. So she locked it and set
 *   it as an exam: whoever could get through every door she ever built would choose. She has listened
 *   to Pip count the jugs above her head every morning since.
 * - The way down: a diesel manway on the forecourt with a dial padlock. The combination is the bore's
 *   depth from Mara's permit (she signed it as county water engineer and forgot), or pick it, or blow
 *   it. Then sixty rungs, and a 1961 fallout door that was never locked.
 * - The showroom, Agnes's prototypes of every founder's defences. The first half has tin-can tripwires
 *   (Tanner's), a camera (Ezra's) and a Doorman on patrol (two Ascend Helpers she bought from Hunter).
 *   Then the clock gate (Vesper's): its code is the time on the clock above it. The second half has the
 *   laser grid (Prudence's), two cameras and the second Doorman. At the end is the power board
 *   (Kit's): four units for the cameras, the grid, the Doormen and the lights, and Model Zero wants two.
 * - Model Zero has a cylinder for each founder's bunker, lit by the ones you opened, and an eighth
 *   that needs power. Beyond it are the well hall, the cistern, the stores, the dormitory, and Agnes at
 *   her drafting table.
 * - The ending is the master key, which opens every door she ever hung. Hang it on Mara's string, and
 *   Zero belongs to Last Chance: the camp drinks and decides who comes down. Or break it in the ZERO
 *   switch, send the well up the surface line to a standpipe on the forecourt, and Zero is anyone's.
 */

/** Agnes over the PA, and in the room with you. */
export const AGNES = 'Agnes Price';
export const AGNES_ROOM = 'Agnes';
export const DOORMAN = 'Deepwell doorman';
/** The master board's card (unvoiced). */
export const MASTER = 'The master board';

/** Agnes's lines over the PA and in her office (voiced). */
export const AGNES_LINES = {
  greet: { speaker: AGNES, text: 'That\'s sixty rungs. My father put them in by hand. Mind the door at the bottom, it\'s older than both of us.' },
  door61: { speaker: AGNES, text: 'It isn\'t locked. It never was. It\'s just heavy.' },
  gallery: { speaker: AGNES, text: 'This is the showroom. Every door I ever sold, the way I drew it before the client got to it.' },
  clock: { speaker: AGNES, text: 'Vesper wanted a code nobody could remember, so I made the code the time. She thought that was very clever.' },
  clockLoud: { speaker: AGNES, text: 'That gate was a prototype. You could have read the clock.' },
  board: { speaker: AGNES, text: 'That\'s the board I sold Kit, except mine tells the truth about the numbers.' },
  zero: { speaker: AGNES, text: 'Come in. Wipe your feet. I\'m at the back, by the well.' },
  zeroLoud: { speaker: AGNES, text: 'You blew Model Zero. I suppose that\'s a review.' },
  caught: { speaker: AGNES, text: 'Back to the ladder. Most people need two goes at that room.' },
  busted: { speaker: AGNES, text: 'Take what you need. That\'s what it\'s for. It\'s what it was always for.' },
  hatchLoud: { speaker: 'Mara Voss', text: 'What was that? Was that the forecourt? Somebody tell me that wasn\'t the forecourt.' },
};

/** Agnes over the PA while you're in the showroom (every 35-55 s). Voiced. */
const TAUNTS = [
  'Tanner cut the north-east fence to save four hundred dollars. I wrote it on his drawing in red.',
  'Ezra wanted a camera on everything. I asked him who would watch them. He said he would, and he did.',
  'Prudence sent me forty pages of policy for her front door. I built it to page three.',
  'Hunter paid for the glass in advance. He never came for the keys.',
  'Orrin wanted every door to open by itself. A door that opens by itself opens for anybody.',
  'Kit asked for a moat. I asked her, a moat of what? She said, whatever costs the most.',
  'Vesper changed her airlock code eleven times in the first week. Then she let the clock do it.',
  'Every door has a weak point. The job is getting the client to sign for it.',
];

/** The Doormen: two Ascend Helpers Agnes bought from Hunter and taught to walk people back to the ladder. Voiced. */
export const DOORMAN_LINES = {
  notice: [
    { speaker: DOORMAN, text: 'Excuse me. You\'re not on the tour.' },
    { speaker: DOORMAN, text: 'Please wait there. Someone will show you out.' },
    { speaker: DOORMAN, text: 'Visitor in the showroom. Please stand still.' },
  ],
  lost: [
    { speaker: DOORMAN, text: 'No visitors in the showroom. Resuming.' },
    { speaker: DOORMAN, text: 'It was the lights. Resuming.' },
  ],
  catch: [
    { speaker: DOORMAN, text: 'This way, please. The ladder is behind you.' },
    { speaker: DOORMAN, text: 'Thank you for visiting the showroom. Please mind the step.' },
  ],
  down: { speaker: DOORMAN, text: 'Unit down. Please notify Deepwell service.' },
  shielded: { speaker: DOORMAN, text: 'That had no effect. Please don\'t do it again.' },
  armoured: { speaker: DOORMAN, text: 'Please stop. The casing is a prototype.' },
  off: { speaker: DOORMAN, text: 'Power withdrawn. Sitting down.' },
};

export const ZERO: Bunker = {
  id: 'zero',
  name: 'Bunker Zero',
  tier: 8,
  owner: {
    name: AGNES,
    archetype: 'The builder',
    bio: 'Agnes Price owns Deepwell Shelter Systems and built every founder\'s bunker in the valley. Zero is her own: a deep well, a cistern and two hundred bunks under the forecourt of Last Chance Gas, built out of everyone else\'s change orders for whoever was left.',
    taunts: TAUNTS,
  },
  // the forecourt's diesel manway, east of the store: Last Chance's frame (−150, 134, yaw 0.35), local (10, −5.5)
  location: { biome: 'under the camp', position: [-142.49, 0, 125.4] },
  requirements: { skills: { electronics: 4, stealth: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The manway',
      obstacles: [{ id: 'hatch', kind: 'door', label: 'A diesel manway on the forecourt with a dial padlock' }],
      solutions: [
        { kind: 'social', label: 'The combination is the bore\'s depth on Mara\'s permit' },
        { kind: 'stealth', label: 'Pick the padlock' },
        { kind: 'force', label: 'Blow it (in the middle of the camp)', requires: { skills: { demolition: 2 }, items: ['charge'] } },
      ],
    },
    {
      type: 'entry', title: 'The showroom',
      obstacles: [
        { id: 'wires', kind: 'tripwire', label: 'Tin-can tripwires' },
        { id: 'cams', kind: 'camera', label: 'Cameras' },
        { id: 'doormen', kind: 'puzzle', label: 'Two Doormen on patrol' },
        { id: 'clock', kind: 'door', label: 'The clock gate' },
        { id: 'grid', kind: 'tripwire', label: 'A laser grid' },
      ],
      solutions: [
        { kind: 'stealth', label: 'Keep behind the displays; crouch over the wires and under the beams' },
        { kind: 'social', label: 'The gate\'s code is the time on its clock' },
        { kind: 'hack', label: 'Short or SPLICE the clock gate', requires: { skills: { electronics: 3 } } },
      ],
    },
    {
      type: 'interior', title: 'The board',
      obstacles: [{ id: 'power', kind: 'puzzle', label: 'Four units of power; Model Zero wants two' }],
      solutions: [{ kind: 'hack', label: 'Switch off what you can get past without: the cameras, the grid, the Doormen, the lights' }],
    },
    {
      type: 'vault', title: 'Model Zero',
      obstacles: [{ id: 'zero', kind: 'door', label: 'Model Zero: eight cylinders' }],
      solutions: [
        { kind: 'hack', label: 'Two units at the board, or SPLICE its controller', requires: { skills: { electronics: 5 } } },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 20 }],
    rolls: [
      // the stores
      { item: 'ration', qty: [3, 5], chance: 1 },
      { item: 'medkit', qty: [2, 3], chance: 1 },
      { item: 'battery', qty: [2, 3], chance: 1 },
      { item: 'scrap', qty: [4, 6], chance: 1 },
      // Agnes's plan chest
      { item: 'lockpick', qty: [3, 4], chance: 1 },
      { item: 'charge', qty: [1, 2], chance: 1 },
      { item: 'emp', qty: [1, 2], chance: 0.8 },
    ],
    xp: 1500,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'hatch', point: 'hatch', radius: 1.8, doors: ['hatch'], needs: 'zero.known', lockMesh: 'padlock',
        primary: {
          kind: 'keypad', id: 'dials', label: 'Turn the dials on the padlock', title: 'DEEPWELL No. 1', code: '2100', lockout: 4,
          lockedLabel: 'The dials have jammed. Give it a minute', lockoutReason: 'The dials jam. Somebody at the fire looks over.',
          hints: [{ when: ['zero.permit'], text: 'Mara\'s permit: a test bore, two thousand one hundred feet.' }],
          hint: 'Four dials. Mara has the paperwork for whatever this is.',
          xp: 60, reason: 'The manway\'s combination',
        },
        secondary: {
          label: 'Another way into the manway', speaker: 'The manway',
          text: 'A steel lid on a low concrete collar, painted DIESEL · 20,000 L · NO NAKED FLAMES. Hollis has parked on it for three years. A brass dial padlock through the hasp, stamped DEEPWELL No. 1, the dials worn smooth.',
          leave: 'Leave it',
          methods: [
            { kind: 'lockpick', pins: 5, title: 'DEEPWELL No. 1' },
            // (Mara's line, not Agnes's: Zero.runMethod says it)
            { kind: 'charge', label: 'Blow the padlock', demolition: 2, quiet: false, loud: 'The padlock goes off like a gunshot. Everyone at the fire is on their feet.', line: null },
          ],
        },
        line: null,
      },
      {
        id: 'door61', point: 'door61', radius: 2.0, doors: ['door61'],
        primary: { kind: 'open', id: 'wheel', label: 'Turn the wheel', xp: 30, reason: 'The 1961 door' },
        line: AGNES_LINES.door61.text,
        trauma: 0.05,
      },
      {
        id: 'clock', point: 'clockPad', radius: 2.0, doors: ['clockGate'],
        // the code is the time on the clock over the gate (Zero.runMethod passes the hour)
        primary: {
          kind: 'keypad', id: 'code', label: 'Use the gate\'s keypad', title: 'KADE · AIRLOCK PROTOTYPE', code: '0000', lockout: 3,
          lockedLabel: 'Locked out: the gate wants a supervisor', lockoutReason: 'Three wrong codes. The gate calls the Doormen.',
          hints: [{ when: ['zero.clock.read', 'apex.code'], text: 'Vesper\'s airlock took the countdown over the door. This one has a clock over it.' }],
          hint: 'Four digits. There\'s a clock over the gate.',
          xp: 50, reason: 'Read the clock',
        },
        secondary: {
          label: 'Another way through the clock gate', speaker: 'The clock gate',
          text: 'A steel gate across the showroom, and a railway flip clock over it, four digits, twenty-four hour. A keypad on the right, and a placard:KADE HOLDINGS · AIRLOCK, PROTOTYPE 3 · "CODE ROTATES WITH LAUNCH CLOCK" · DEEPWELL ADVISED AGAINST.',
          leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'circuit', label: 'Short the keypad', title: 'CLOCK GATE', difficulty: 3, electronics: 3, xp: 45, reason: 'Gate shorted' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the gate', title: 'CLOCK GATE', host: 'DEEPWELL · SHOWROOM', difficulty: 4, electronics: 4,
              daemons: ['clockgate', 'cameras'], xpEach: 40, reason: 'Spliced the showroom',
              traced: 'Trace complete. The showroom logged your splicer, and the Doormen know.',
            },
            { kind: 'charge', label: 'Blow the gate', demolition: 4, quiet: true, loud: 'The gate comes off its track. The clock over it stops.', line: AGNES_LINES.clockLoud.text },
          ],
        },
        line: AGNES_LINES.clock.text,
      },
      {
        id: 'zero', point: 'zeroDoor', radius: 2.4, doors: ['zeroDoor'],
        // (Zero.methodReason: it needs two units at the board)
        primary: { kind: 'open', id: 'power', label: 'Turn Model Zero\'s wheel', xp: 80, reason: 'Model Zero' },
        secondary: {
          label: 'Another way through Model Zero', speaker: 'Model Zero',
          text: 'A round door three metres across, set in the rock. Eight brass cylinders round its rim, each under a maker\'s plate with a founder\'s name, and an eighth in the middle under a plate that says ZERO. A lamp beside each one. A controller box on the wall, sealed with wire and lead.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the controller', title: 'MODEL ZERO', host: 'DEEPWELL · MODEL ZERO', difficulty: 5, electronics: 5,
              daemons: ['zerodoor', 'doormen'], xpEach: 50, reason: 'Spliced Model Zero',
              traced: 'Trace complete. Model Zero logged your splicer.',
            },
            { kind: 'charge', label: 'Blow Model Zero', demolition: 5, quiet: false, loud: 'Model Zero takes the charge and swings off one hinge. Dust comes down out of the whole showroom.', line: AGNES_LINES.zeroLoud.text },
          ],
        },
        line: AGNES_LINES.zero.text,
        trauma: 0.12,
      },
    ],
    // underground: nothing opens onto the outside, so interior mode always hides the world in here
    portals: [],
    voice: {
      point: 'speaker',
      greet: AGNES_LINES.greet.text,
      // (Zero greets and taunts itself, once you're down the ladder: the hatch is in the middle of the camp)
      greetRadius: -1,
      tauntRadius: -1,
      alarm: [
        'That\'s the alarm. It\'s loud on purpose. I never liked a quiet alarm.',
        'Doormen, the showroom, please. Gently.',
        'You set that off. Stand still and they\'ll walk you back.',
      ],
    },
    alarmTime: 25,
    tripwires: {
      disarm: { label: 'Disarm tripwire', electronics: 1, lacking: 'Requires Electronics 1 — or {crouch} to step over' },
      yank: {
        label: 'Yank the wire', demolition: 3, lacking: 'Requires Demolition 3 — or crouch over it',
        quiet: 'You lower the cans to the floor one at a time.', quietReason: 'Tripwire eased out',
        loud: 'You rip the wire out. The cans go down the showroom like bells.',
      },
      tripped: 'You caught a wire. Tin cans all over the showroom floor.',
      stepped: 'You step over the wire.',
      ahead: 'Tripwire ahead: {crouch} to step over it.',
    },
    lasers: {
      tripped: { default: 'You broke a beam. The showroom logs it.' },
      alarmPoint: 'grid',
      power: {
        id: 'gridbox', point: 'gridBox', radius: 1.6, label: 'Short the grid\'s junction box',
        circuit: { title: 'CAREFUL · GRID JUNCTION', difficulty: 3 },
        expert: 4, expertToast: 'You pull the grid\'s fuse without opening the panel. The beams go out.',
        xp: 45, reason: 'Grid down',
        shock: { damage: 12, toast: 'The junction box bites. Your arm goes numb to the shoulder.' },
        sparkOffset: [-0.15, 0.2, 0],
      },
    },
    cameras: { tripped: 'A showroom camera saw you. Somewhere in the rock, a bell rings.', detectTime: 1.5 },
    loot: {
      behind: 'zero',
      containers: [
        { id: 'cistern', label: 'Fill up at the cistern', take: 'guaranteed' },
        { id: 'stores', label: 'Go through the stores', take: [0, 4] },
        { id: 'plans', label: 'Open Agnes\'s plan chest', take: [4] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: Bunker Zero',
        banner: 'Eight doors. The last one was under the camp.',
        line: AGNES_LINES.busted.text,
      },
    },
  },
};

/**
 * Where it is: the bunker's origin is the manway on the forecourt; the rooms are FLOOR metres under it.
 * Local axes are the world's (north is −z): the showroom runs north from the ladder, under the store
 * and the highway.
 */
export const ZERO_DEPTH = 26;

/** Flags Zero's own code reads (the runtime derives the rest from the ids above). */
export const ZERO_FLAGS = {
  /** Act VIII has started (Dez placed the carrier): the manway can be opened. */
  known: 'zero.known',
  marker: 'zero.marker',
  /** Mara read out the permit: the bore's depth is the combination. */
  permit: 'zero.permit',
  seen: 'seen:zero',
  hatch: 'zero.hatch.open',
  door61: 'zero.door61.open',
  clock: 'zero.clock.open',
  vault: 'zero.zero.open',
  complete: 'zero.complete',
  /** Down the ladder at least once. */
  down: 'zero.down',
  /** Looked at the clock gate's placard (the hint). */
  clockRead: 'zero.clock.read',
  /** The board: what's switched off/on. */
  camsOff: 'zero.cameras.off',
  doormenOff: 'zero.p.doormen.off',
  lightsOff: 'zero.p.lights.off',
  vaultOn: 'zero.p.vault.on',
  /** Met Agnes; she told you why; she showed you the surface line. */
  agnes: 'zero.agnes',
  why: 'zero.agnes.why',
  well: 'zero.agnes.well',
  /** The ending: zero.end.keep / zero.end.open. */
  end: 'zero.end',
  caught: 'zero.caught',
  loud: 'zero.loud',
};

/** The power board's budget. */
export const POWER = { units: 4, cameras: 1, grid: 1, doormen: 1, lights: 1, vault: 2 };

/** The board's card (unvoiced: a control panel reads like a control panel). */
export function boardText(on: { cameras: boolean; grid: boolean; doormen: boolean; lights: boolean; vault: boolean }) {
  const used = (on.cameras ? POWER.cameras : 0) + (on.grid ? POWER.grid : 0) + (on.doormen ? POWER.doormen : 0) + (on.lights ? POWER.lights : 0) + (on.vault ? POWER.vault : 0);
  const row = (name: string, n: number, v: boolean) => `${v ? '■' : '□'} ${name.padEnd(12, ' ')} ${n} unit${n > 1 ? 's' : ''}`;
  return [
    `DEEPWELL · ZERO · GENERATOR 2 · ${used} / ${POWER.units} UNITS`,
    row('CAMERAS', POWER.cameras, on.cameras),
    row('GRID', POWER.grid, on.grid),
    row('DOORMEN', POWER.doormen, on.doormen),
    row('LIGHTS', POWER.lights, on.lights),
    row('MODEL ZERO', POWER.vault, on.vault),
    'Prototype of the Lattice board (S/N 7). This one is wired the way the drawing says. — A.P.',
  ].join('\n');
}

// ------------------------------------------------------------------ the showroom's placards (unvoiced)
/**
 * One display per founder down the showroom, each with Agnes's placard: the product as she drew it,
 * and the change order the client signed. Read one and it goes in the journal.
 */
export const BAYS: { id: string; who: string; title: string; text: string }[] = [
  {
    id: 'garage', who: 'PIVOTSON',
    title: 'Bay 1 · Pivotson residence ("Project Garage")',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0412 · PIVOTSON, T.\nAs drawn: perimeter fence, 4 runs. Guard drone, new unit. Vault: 5-pin lock and keypad, code set by Deepwell.\nC.O. 44: NE fence run deleted. Client: "raccoons are not a threat vector."\nC.O. 51: drone swapped for a refurb unit, battery health 12%. Client "loves that".\nC.O. 58: client sets his own vault code. Client: "users hate passwords."\nSigned T. Pivotson ×3. Countersigned A. Price.',
  },
  {
    id: 'apex', who: 'KADE',
    title: 'Bay 2 · Kade Holdings, Apex Vault',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0430 · KADE HOLDINGS\nAs drawn: hangar door, airlock, 2 independent codes, rotated weekly by a person.\nC.O. 12: one code only, rotating with the launch clock. Deepwell advised against in writing (attached). Client: "zero trust."\nC.O. 19: client to read the clock on her feed daily.\nSigned V. Kade, by her assistant. Countersigned A. Price.',
  },
  {
    id: 'panopticon', who: 'SEYMOUR',
    title: 'Bay 3 · The Panopticon',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0447 · SEYMOUR, E.\nAs drawn: 1,100 cameras on 3 independent loops, 2 operators per shift.\nC.O. 3: operators deleted. Client will watch personally.\nC.O. 8: all cameras on one loop through the lamp room. Client: "I like to know where everything goes."\nSigned E. Seymour. Countersigned A. Price.',
  },
  {
    id: 'spire', who: 'ASHBY',
    title: 'Bay 4 · Careful Labs, the Alignment Spire',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0455 · CAREFUL LABS\nAs drawn: laser grid on its own sealed supply, junction box inside the vault.\nC.O. 27: junction box moved to the hall "for maintainability and transparency". Policy document attached (40 pp).\nC.O. 31: front door to ask entrants about their intentions. Deepwell has no position on this.\nSigned P. Ashby, initialled on every page. Countersigned A. Price.',
  },
  {
    id: 'dome', who: 'VALE',
    title: 'Bay 5 · Ascend, the Singularity Dome',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0461 · ASCEND\nAs drawn: glass dome, steel shutters, a gate keyed to the owner\'s voice and a hand.\nC.O. 2: shutters deleted ("the view is the product").\nC.O. 6: gate keyed to voice only. Deepwell asked what happens if his voice changes. Client: "it won\'t."\nPaid in full in advance. Keys never collected.\nSigned H. Vale. Countersigned A. Price.',
  },
  {
    id: 'cathedral', who: 'SAYLE',
    title: 'Bay 6 · Dropt, the Cloud Cathedral',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0470 · DROPT\nAs drawn: one staffed entrance, the dock on its own key.\nC.O. 15: returns kiosk to open the building to any valid order number. Client: "the customer is the key."\nC.O. 16: dock door opens on any inbound pallet.\nSigned O. Sayle. Countersigned A. Price.',
  },
  {
    id: 'fortress', who: 'SZABO',
    title: 'Bay 7 · Lattice, the Chip Fortress',
    text: 'DEEPWELL SHELTER SYSTEMS · JOB 0478 · LATTICE\nAs drawn: moat of water, 2 bridges, 2 independent power supplies.\nC.O. 4: moat to be coolant ("whatever costs the most").\nC.O. 9: 1 supply. Board limited to 3 units. Deepwell advised this would mean choosing between the door and the cold. Client: "people will have to choose. That\'s the product."\nC.O. 11: gate code set to the list price.\nSigned K. Szabo. Countersigned A. Price.',
  },
];

// ------------------------------------------------------------------ conversations
export interface ZeroView {
  social: number;
  electronics: number;
  has: (f: string) => boolean;
}
export interface ZeroChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: ZeroView) => boolean;
  /** why: she told you why she kept it shut · well: she showed you the surface line · end: the master board */
  effect?: 'why' | 'well' | 'end';
}
export type ZeroTalk = Record<string, { speaker: string; text: string; choices: ZeroChoice[] }>;

/** Agnes at her drafting table, by the well. */
export const AGNES_TALK: ZeroTalk = {
  hello: {
    speaker: AGNES_ROOM,
    text: 'You came down my ladder and through my showroom. Sit down if you like. I\'ve been standing at this table for three years and I\'m not about to stop.',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'built', label: '"You built all of them."', next: 'built' },
      { id: 'zero', label: '"What is this place?"', next: 'zero' },
      { id: 'heard', label: '"You were under us the whole time."', next: 'heard' },
      { id: 'well', label: '"How much can the well give?"', next: 'well', when: (v) => !v.has('zero.end') },
      { id: 'decide', label: 'Go to the master board', next: null, effect: 'end', when: (v) => !v.has('zero.end') },
      { id: 'bye', label: 'Step back', next: null },
    ],
  },
  who: {
    speaker: AGNES_ROOM,
    text: 'Agnes Price. Deepwell Shelter Systems. My father dug wells, and in sixty-one he started selling fallout shelters to ranchers. I sold doors to men who thought the world was ending. They were right, which was bad for everybody except me.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  built: {
    speaker: AGNES_ROOM,
    text: 'Every one. My plate is on every door you opened, down by the bottom hinge. Nobody ever looks at the bottom hinge. And every client cut something to save money. I wrote it down each time and had them sign it. You got in through their signatures.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  zero: {
    speaker: AGNES_ROOM,
    text: 'A bore, two thousand one hundred feet, into water the Kade pumps never got near. A cistern, two hundred bunks, and stores for ten years. I paid for it with eleven percent on every change order those people signed. The sign on the pylon was mine as well. Last Chance. It was supposed to tell people where to stop.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  heard: {
    speaker: AGNES_ROOM,
    text: 'Every morning. Pip counts the jugs out loud on the forecourt, and the manway carries it straight down. I knew how much water you had before Mara did.',
    choices: [
      { id: 'why', label: '"Then why didn\'t you open it?"', next: 'why', effect: 'why' },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  why: {
    speaker: AGNES_ROOM,
    text: 'I came down that ladder on the day of the Pivot to open it. Two hundred bunks, and four thousand people on the band. I couldn\'t pick. So I didn\'t pick anyone. I locked it, and I waited for somebody who could get through every door I ever built. That\'s you, so you choose.',
    choices: [
      { id: 'key', label: '"Choose what?"', next: 'key' },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  key: {
    speaker: AGNES_ROOM,
    text: 'The master key is in the board on the wall. It opens every door I ever hung. If you put it on Mara\'s string, Last Chance never goes thirsty again and decides who comes down the ladder. If you break it, nobody can lock Zero again, and it belongs to whoever walks up the highway. I had three years to decide and I couldn\'t.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  well: {
    speaker: AGNES_ROOM,
    text: 'More than you\'d think. The pump runs on a timer into the cistern. Throw the red handle behind the board and it goes up the surface line instead, to a standpipe on the forecourt, every day for as long as the bore holds. That\'s years.',
    choices: [{ id: 'ok', label: '"Show me the handle."', next: 'hello', effect: 'well' }],
  },
  after: {
    speaker: AGNES_ROOM,
    text: 'It\'s decided now. That\'s all I wanted.',
    choices: [{ id: 'bye', label: 'Step back', next: null }],
  },
};

/** The master board, and what each choice gets said about it. */
export const ENDING = {
  card: {
    speaker: MASTER,
    text: 'A steel panel on the wall behind the drafting table, eight brass keyswitches in two rows, each under a maker\'s plate: PIVOTSON, KADE, SEYMOUR, ASHBY, VALE, SAYLE, SZABO, and ZERO in the middle of the bottom row. One key is in the ZERO switch. It has a long shank and a bow worn smooth by a thumb.',
  },
  /** Why opening it is greyed out. */
  openNeeds: 'The well has to go up the surface line first (ask Agnes about the well), or Electronics 5',
  keep: [
    { speaker: AGNES_ROOM, text: 'That\'s what they all said. Every one of them, at the bottom of the ladder.' },
    { speaker: 'Mara Voss', text: 'This is Mara. Bring it up. I\'ll put it on the string with the permit.' },
  ],
  open: [
    { speaker: AGNES_ROOM, text: 'Then that\'s done. I\'d like to go up and look at the sign.' },
    { speaker: 'Mara Voss', text: 'This is Mara. There\'s water coming out of the forecourt. Hollis is standing in it with his boots on.' },
  ],
};

/** Agnes afterwards, one line a visit, in turn. Voiced. */
export const AGNES_AFTER = {
  keep: [
    { speaker: AGNES_ROOM, text: 'Mara came down this morning. She didn\'t say anything. She counted the bunks.' },
    { speaker: AGNES_ROOM, text: 'I can hear the key on her string when she climbs down. It sounds like my father\'s.' },
  ],
  open: [
    { speaker: AGNES_ROOM, text: 'I went up and looked at the sign. Hollis keeps it very clean.' },
    { speaker: AGNES_ROOM, text: 'A family from Waitlist City came down the ladder this morning and asked where the queue was. I told them there isn\'t one.' },
  ],
};

/** The standpipe on the forecourt (open) and the camp's share by the manway (keep). Voiced. */
export const TAP = {
  hello: { speaker: 'Pip Okafor', text: 'Two for you, and I\'m not writing it down. I\'m not writing any of it down any more.' },
};
export const SHARE = {
  hello: { speaker: 'Pip Okafor', text: 'Two and a tin. Mara counted them and then I counted them. Sign here.' },
};
