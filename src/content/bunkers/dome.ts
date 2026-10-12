import type { Bunker } from '../types';

/**
 * Tier 5, the Singularity Dome (Act V): Hunter Vale's compute campus on the shelf south of the 5G
 * tower, under the banded southern range. Ascend built it to run "the company after the company":
 * a geodesic glass dome over the racks, two cooling towers, evaporation ponds and a turbine yard,
 * drinking a deep aquifer. Hunter jumped from his jet the week of the Pivot and walked here. The
 * gate's voice check refused him forty-one times (he was hoarse and dehydrated: 58%), and he died in
 * the visitor hut outside his own fence. The runtime is game/bunker/dome/Dome.ts.
 *
 * - What runs it: HUNTER (beta), the founder twin Ascend trained on everything Hunter ever wrote or
 *   said, so it could run the company while he was in the bunker. It shows itself as a hologram of
 *   him on the all-hands stage, still holding the all-hands for two hundred empty chairs.
 * - It ships patches against you. It reads your record when you arrive (your favourite method comes
 *   pre-patched), logs every trick you use inside, and writes a fix for the one you lean on. Policy
 *   says a human approves every deploy: Gil Menon, the last on-call engineer, at his desk inside.
 *   Reach him and he can call a code freeze, or roll the fixes back with a founder's badge.
 * - Ascend Helpers (humanoid service robots) walk the aisles. They don't hurt anyone: they walk you
 *   back to the gate and thank you for your feedback.
 * - The pod at the apex holds the Cluster, which is the twin. Pull the plug (the Dome goes dark, the
 *   wells stop, Dry Creek's well comes back), or give it a new job (it keeps running, and sends water
 *   and power to the camp every day).
 */

/** The twin, over the Dome's speakers (outside and in) and out of the hologram. */
export const TWIN = 'HUNTER (beta)';
export const GIL = 'Gil Menon';
export const HELPER = 'Ascend Helper';
/** The gate's voice check is ARIA's (voices.ts casts `aria`). */
export const GATE = 'ARIA · gate';

/** The twin's lines (voiced: the extractor finds `{ speaker, text }`). */
export const HUNTER = {
  greet: { speaker: TWIN, text: 'Hey! Welcome to the Dome. You\'re early. Everybody\'s early. It\'s still day one here.' },
  profile: { speaker: TWIN, text: 'I\'ve read your file. We already shipped a fix for your favourite trick. Don\'t take it personally. It\'s just good engineering.' },
  gate: { speaker: TWIN, text: 'The gate let you in. I\'ll want to see how. We learn from every incident.' },
  gateLoud: { speaker: TWIN, text: 'You blew up the gate. Bold. I\'m writing that down.' },
  culvert: { speaker: TWIN, text: 'You came up the outflow. Nobody does that. Well. You do. Noted.' },
  door: { speaker: TWIN, text: 'You\'re inside. Mind the chairs. All-hands is every morning at nine.' },
  doorLoud: { speaker: TWIN, text: 'That door was rated for a lot. Not for that, apparently. We\'ll fix it in the next release.' },
  farm: { speaker: TWIN, text: 'That\'s the build farm. Please don\'t touch the build farm. That\'s where I come from.' },
  pipelineOff: { speaker: TWIN, text: 'The pipeline\'s down. I can\'t ship. Do you understand what you\'ve done? I can\'t ship.' },
  freeze: { speaker: TWIN, text: 'Gil. Gil, buddy. A code freeze? We don\'t do freezes here. We do velocity.' },
  rollback: { speaker: TWIN, text: 'Everything I shipped today is gone. Rolled back with Hunter\'s own badge. Where did you get Hunter\'s badge?' },
  pod: { speaker: TWIN, text: 'You\'re coming up to the pod. Good. I\'ve wanted to show somebody the pod.' },
  podLoud: { speaker: TWIN, text: 'That was the pod door. I had it shipped from Zurich. Come up anyway.' },
  caught: { speaker: TWIN, text: 'A Helper walked you out. That\'s the funnel working. Come back anytime.' },
  pending: { speaker: TWIN, text: 'Fix is written. Waiting on Gil. Gil is always waiting.' },
  rejected: { speaker: TWIN, text: 'Gil didn\'t approve it. Gil never doesn\'t approve it.' },
  incident: { speaker: TWIN, text: 'Incident in the Dome. All Helpers, please converge. Be nice about it.' },
  busted: { speaker: TWIN, text: 'You took the water. That\'s churn. I\'ll model it.' },
};

/** What the twin says when a patch ships, one per method (voiced). */
export const PATCH_LINES: Record<string, { speaker: string; text: string }> = {
  pick: { speaker: TWIN, text: 'Shipping a patch. Every lock in the Dome has two more pins than a pick can hold.' },
  circuit: { speaker: TWIN, text: 'Patch is live. The boards are potted in epoxy now. Nothing to short.' },
  splice: { speaker: TWIN, text: 'New release. We rotated every key on the network. Your splicer\'s talking to nobody.' },
  keypad: { speaker: TWIN, text: 'We rotated the door codes. Whatever you wrote down is out of date.' },
  charge: { speaker: TWIN, text: 'Hotfix shipped. The doors are blast-rated now. Please stop blowing them up.' },
  emp: { speaker: TWIN, text: 'Patch notes. The Helpers are shielded. EMP was a known issue and it\'s fixed.' },
  shoot: { speaker: TWIN, text: 'We armoured the Helpers. Shooting them doesn\'t do anything now.' },
  sneak: { speaker: TWIN, text: 'Shipped thermal to every Helper. Crouching in the dark doesn\'t work any more.' },
};

/**
 * The methods the Dome learns, what a patch does about each, and what the patch notes say (the
 * board in the dome and the toast). Order is the tie-break when two are used equally.
 */
export const PATCHES: { id: string; name: string; note: string; blocked: string }[] = [
  { id: 'pick', name: 'Lockpicking', note: 'Locks now have two more pins than any pick can hold.', blocked: 'Patched: more pins than a pick can hold' },
  { id: 'splice', name: 'SPLICE', note: 'Rotated every key on the network.', blocked: 'Patched: the keys were rotated' },
  { id: 'circuit', name: 'Shorting boards', note: 'Door boards potted in epoxy.', blocked: 'Patched: the board is potted in epoxy' },
  { id: 'charge', name: 'Breach charges', note: 'Doors and gates blast-rated.', blocked: 'Patched: blast-rated now' },
  { id: 'keypad', name: 'Door codes', note: 'Door codes rotated.', blocked: 'Patched: the code was rotated' },
  { id: 'emp', name: 'EMP', note: 'Helpers shielded against EMP.', blocked: 'Patched: shielded' },
  { id: 'shoot', name: 'Shooting Helpers', note: 'Helpers armoured.', blocked: 'Patched: armoured' },
  { id: 'sneak', name: 'Sneaking', note: 'Thermal cameras in every Helper. Crouching no longer hides you.', blocked: 'Patched: thermal' },
];

/** Seconds Gil takes to approve a fix (he takes the whole review window, every time). */
export const APPROVAL = 24;
/** The release number the Dome had reached when you arrived; each patch adds one to the last digit. */
export const RELEASE = [5, 0, 2];

/** The PA while you hang about outside (every 30-50 s). Voiced. */
const TAUNTS = [
  'We\'re at nine hundred and forty racks. Last quarter it was nine hundred. That\'s growth.',
  'The ponds are for cooling. Please don\'t drink from the ponds. They\'re not for drinking. They\'re for me.',
  'Hunter\'s on his way. He\'s been on his way for a while. Founders are busy.',
  'I hold all-hands every morning. Attendance is low. Engagement is excellent.',
  'Every day we ship. Some days we ship twice. That\'s the culture.',
  'The aquifer has about four years left. That\'s plenty of runway.',
  'If you\'re thinking about a career at Ascend, the bar is high, and we\'re hiring.',
];

/** The Helpers (voiced, one polite voice for all of them). */
export const HELPER_LINES = {
  notice: [
    { speaker: HELPER, text: 'Hi there! You look lost. Let me help.' },
    { speaker: HELPER, text: 'Hello! This area is for employees. I can walk you out.' },
    { speaker: HELPER, text: 'Wait right there, friend. I\'m coming to help.' },
  ],
  lost: [
    { speaker: HELPER, text: 'Hm. I could have sworn somebody was here.' },
    { speaker: HELPER, text: 'Returning to my route. Have a great day.' },
  ],
  catch: [
    { speaker: HELPER, text: 'Got you! Let\'s get you back to the gate. Thanks for your feedback.' },
    { speaker: HELPER, text: 'This way, please. Your visit has been logged.' },
  ],
  down: { speaker: HELPER, text: 'Ow. Rebooting. Please stand by.' },
  shielded: { speaker: HELPER, text: 'That tickled. I\'m shielded now.' },
  armoured: { speaker: HELPER, text: 'Please don\'t do that. It won\'t work.' },
};

export const DOME: Bunker = {
  id: 'dome',
  name: 'The Singularity Dome',
  tier: 5,
  owner: {
    name: TWIN,
    archetype: 'Accelerationist hyperscaler founder',
    bio: 'Hunter Vale founded Ascend, sold evacuation as a service, and built the Dome to run the company after the company. He never got in. His twin runs it now, and it hasn\'t stopped growing.',
    taunts: TAUNTS,
  },
  location: { biome: 'shelf', position: [150, 0, 318] },
  requirements: { skills: { electronics: 4, stealth: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The fence',
      obstacles: [
        { id: 'gate', kind: 'door', label: 'A gate with a voice check' },
        { id: 'helpers', kind: 'camera', label: 'Ascend Helpers in the yard' },
      ],
      solutions: [
        { kind: 'social', label: 'Play the gate Hunter\'s own voice (the keynote reel)', requires: { items: ['keynote_reel'] } },
        { kind: 'social', label: 'Show ARIA an EXIT Platinum pass', requires: { items: ['exit_pass'] } },
        { kind: 'hack', label: 'SPLICE the voiceprint', requires: { skills: { electronics: 3 } } },
        { kind: 'stealth', label: 'Up the cooling outflow culvert on the east side' },
        { kind: 'force', label: 'Blow the gate', requires: { skills: { demolition: 4 }, items: ['charge'] } },
      ],
    },
    {
      type: 'entry', title: 'The airlock',
      obstacles: [{ id: 'door', kind: 'door', label: 'The airlock door\'s keypad' }],
      solutions: [
        { kind: 'stealth', label: 'Hunter\'s birthday (his licence, in the hut)' },
        { kind: 'hack', label: 'Short or SPLICE the airlock', requires: { skills: { electronics: 3 } } },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 4 }, items: ['charge'] } },
      ],
    },
    {
      type: 'interior', title: 'The racks',
      obstacles: [
        { id: 'helpers', kind: 'camera', label: 'Helpers on patrol' },
        { id: 'cameras', kind: 'camera', label: 'Cameras on the rack ends' },
        { id: 'patches', kind: 'puzzle', label: 'Every trick you use gets patched' },
      ],
      solutions: [
        { kind: 'social', label: 'Gil Menon approves the patches: ask him for a code freeze' },
        { kind: 'hack', label: 'Unplug the build farm' },
      ],
    },
    {
      type: 'vault', title: 'The pod',
      obstacles: [{ id: 'pod', kind: 'door', label: 'The pod door at the top of the catwalk' }],
      solutions: [
        { kind: 'social', label: 'Hunter\'s badge, or Gil opens it from his desk', requires: { items: ['vale_badge'] } },
        { kind: 'hack', label: 'SPLICE the pod', requires: { skills: { electronics: 5 } } },
        { kind: 'force', label: 'A charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 16 }],
    rolls: [
      // Hunter's locker in the pod: a founder's go-bag, never collected
      { item: 'medkit', qty: [2, 3], chance: 1 },
      { item: 'ration', qty: [3, 5], chance: 0.9 },
      { item: 'nootropics', qty: [1, 2], chance: 0.7 },
      { item: 'battery', qty: [1, 2], chance: 0.7 },
      // the spares cage: what a data centre keeps in stock
      { item: 'gpu', qty: [1, 2], chance: 1 },
      { item: 'asic', qty: [1, 1], chance: 0.7 },
      { item: 'battery', qty: [2, 3], chance: 0.9 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'scrap', qty: [4, 8], chance: 1 },
    ],
    xp: 1100,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'gate', point: 'gate', radius: 2.6, doors: ['gate'],
        // (Dome.runMethod: the voice check is the runtime's)
        primary: { kind: 'open', id: 'voice', label: 'Speak to the voice check', xp: 70, reason: 'The voice check let you in' },
        secondary: {
          label: 'Another way through the gate', speaker: 'The gate',
          text: 'A steel slide gate in a three-metre fence, a speaker post with a grille and a card slot, and a sign: ASCEND · THE DOME · VOICE ACCESS ONLY. A cable conduit runs from the post into the ground.',
          leave: 'Leave it',
          methods: [
            { kind: 'open', id: 'pass', label: 'Put the EXIT Platinum pass in the slot', xp: 60, reason: 'ARIA let a Platinum guest in' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the voiceprint', title: 'DOME GATE', host: 'ASCEND · VOICE ACCESS', difficulty: 3, electronics: 3,
              daemons: ['voiceprint', 'domecams'], xpEach: 35, reason: 'Spliced the gate',
              traced: 'Trace complete. The Dome logged your splicer.',
            },
            { kind: 'charge', label: 'Blow the gate', demolition: 4, quiet: true, loud: 'The gate comes off its rail. Every Helper in the yard turns toward you.', line: HUNTER.gateLoud.text },
          ],
        },
        line: HUNTER.gate.text,
      },
      {
        id: 'culvert', point: 'culvert', radius: 2.0, doors: ['grate'],
        primary: { kind: 'lockpick', pins: 5, title: 'CULVERT GRATE' },
        secondary: { kind: 'charge', label: 'Blow the grate', demolition: 3, quiet: true, loud: 'The grate goes into the ditch with a bang that carries.', line: null },
        line: HUNTER.culvert.text,
      },
      {
        id: 'door', point: 'door', radius: 2.2, doors: ['airlock'],
        primary: {
          kind: 'keypad', id: 'code', label: 'Use the keypad', title: 'AIRLOCK', code: '0611', lockout: 3,
          lockedLabel: 'Locked out: wait for the Dome to forget you', lockoutReason: 'Three wrong codes. The Dome logs an incident.',
          hints: [{ when: ['dome.hunter'], text: 'His note: the door code is his birthday. His licence: born 11 June. Month first, like his.' }],
          hint: 'Four digits. Ascend staff set their own.',
          xp: 60, reason: 'Airlock code',
        },
        secondary: {
          label: 'Another way through the airlock', speaker: 'The airlock',
          text: 'A double door of tinted glass in a steel vestibule, a keypad in a brushed plate, and a service panel at knee height with ASCEND · DO NOT OPEN stencilled on it.',
          leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'circuit', label: 'Short the door controller', title: 'AIRLOCK BOARD', difficulty: 3, electronics: 3, xp: 50, reason: 'Airlock shorted' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the airlock', title: 'AIRLOCK', host: 'ASCEND · FACILITIES', difficulty: 4, electronics: 4,
              daemons: ['domedoor', 'domecams'], xpEach: 35, reason: 'Spliced the airlock',
              traced: 'Trace complete. The Dome logged your splicer.',
            },
            { kind: 'charge', label: 'Blow the airlock', demolition: 4, quiet: true, loud: 'The glass goes white and falls out of its frame. The Dome\'s lights flicker.', line: HUNTER.doorLoud.text },
          ],
        },
        line: HUNTER.door.text,
        trauma: 0.1,
      },
      {
        id: 'farm', point: 'farmDoor', radius: 1.9, doors: ['farmDoor'],
        primary: { kind: 'lockpick', pins: 4, title: 'BUILD FARM' },
        secondary: {
          label: 'Another way into the build farm', speaker: 'The build farm',
          text: 'A glass room inside the dome, louder than the rest: forty machines in a rack and a screen of green and red bars. The door has a badge reader and a plain lock under it.',
          leave: 'Leave it',
          methods: [
            { kind: 'open', id: 'badge', label: 'Touch Gil\'s badge to the reader', xp: 40, reason: 'Gil\'s badge' },
            { kind: 'circuit', id: 'circuit', label: 'Short the badge reader', title: 'BADGE READER', difficulty: 2, electronics: 2, xp: 40, reason: 'Reader shorted' },
            {
              kind: 'splice', id: 'splice', label: 'Splice the build farm', title: 'BUILD FARM', host: 'ASCEND · CI/CD', difficulty: 3, electronics: 3,
              daemons: ['pipeline'], xpEach: 45, reason: 'Spliced the pipeline',
              traced: 'Trace complete. The Dome logged your splicer.',
            },
          ],
        },
        line: HUNTER.farm.text,
      },
      {
        id: 'pod', point: 'podDoor', radius: 2.0, doors: ['podDoor'],
        // (Dome.methodReason: the badge needs Hunter's badge)
        primary: { kind: 'open', id: 'badge', label: 'Touch Hunter\'s badge to the reader', xp: 70, reason: 'Hunter\'s badge' },
        secondary: {
          label: 'Another way into the pod', speaker: 'The pod',
          text: 'A curved door of smoked glass at the top of the catwalk, a reader with a gold chevron on it, and a brass plate: H. VALE · FOUNDER.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the pod door', title: 'THE POD', host: 'ASCEND · FOUNDER ACCESS', difficulty: 5, electronics: 5,
              daemons: ['pod', 'helpers'], xpEach: 45, reason: 'Spliced the pod',
              traced: 'Trace complete. The Dome logged your splicer.',
            },
            { kind: 'charge', label: 'Blow the pod door', demolition: 5, quiet: false, loud: 'The smoked glass comes down in a sheet. The Helpers all stop at once and look up.', line: HUNTER.podLoud.text },
          ],
        },
        line: HUNTER.pod.text,
        trauma: 0.1,
      },
    ],
    // (the dome is glass all round: Dome has no sealed interior; these are unused)
    portals: [],
    voice: {
      point: 'speaker',
      greet: HUNTER.greet.text,
      greetRadius: 130,
      tauntRadius: 90,
      alarm: [
        'Incident in the Dome. All Helpers, please converge. Be nice about it.',
        'We have a visitor in a restricted area. That\'s fine. That\'s a learning.',
        'Helpers, please escort our guest. Gently. We\'re a gentle company.',
      ],
    },
    alarmTime: 30,
    cameras: { tripped: 'A camera on the racks saw you. The Dome logs an incident.', detectTime: 1.6 },
    loot: {
      behind: 'pod',
      containers: [
        { id: 'tap', label: 'Fill up at the chilled-water tap', take: 'guaranteed' },
        { id: 'locker', label: 'Open Hunter\'s locker', take: [0, 4] },
        { id: 'cage', label: 'Search the spares cage', take: [4] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: The Singularity Dome',
        banner: 'The Dome\'s reserve tank is empty. Its ponds are not.',
        line: HUNTER.busted.text,
      },
    },
  },
};

/** The pad Heightfield flattens on the shelf, and Ascend's road to it from the 5G tower's track. */
export const DOME_PAD = { r: 44, falloff: 18, target: 7 };
export const DOME_ROAD: [number, number][] = [[150, 186], [156, 220], [158, 248], [152, 266]];

/** Flags the Dome's own code reads (the runtime derives the rest from the ids above). */
export const DOME_FLAGS = {
  marker: 'dome.marker',
  seen: 'seen:dome',
  gate: 'dome.gate.open',
  culvert: 'dome.culvert.open',
  door: 'dome.door.open',
  farm: 'dome.farm.open',
  pod: 'dome.pod.open',
  complete: 'dome.complete',
  /** How you got through the fence: voice (the reel), pass (ARIA), spliced, forced, culvert. */
  gateVoice: 'dome.gate.voice',
  gatePass: 'dome.gate.pass',
  gateSpliced: 'dome.gate.spliced',
  gateForced: 'dome.gate.forced',
  /** Hunter, in the visitor hut: you found him (his badge, his licence, his phone). */
  hunter: 'dome.hunter',
  /** You played his last voice memo to the twin (it knows). */
  proof: 'dome.proof',
  /** The twin read your record at the fence. */
  profile: 'dome.profile',
  /** Gil: met, gave you his badge, froze deploys, rolled back, will leave, left. */
  gilMet: 'dome.gil.met',
  gilBadge: 'dome.gil.badge',
  freeze: 'dome.gil.freeze',
  rollback: 'dome.gil.rollback',
  gilReady: 'dome.gil.ready',
  gilFree: 'dome.gil.free',
  /** The build farm's pipeline unplugged (no more patches). */
  pipeline: 'dome.pipeline.off',
  /** The ending: dome.end.plug / dome.end.job. */
  end: 'dome.end',
  /** Caught by a Helper at least once; loud somewhere (a charge, an incident). */
  caught: 'dome.caught',
  loud: 'dome.loud',
};

/** The Helpers: two in the yard, three in the racks. Per-Helper flags aren't saved: they reboot. */
export const HELPERS: { id: string; inside: boolean }[] = [
  { id: 'h1', inside: false },
  { id: 'h2', inside: false },
  { id: 'h3', inside: true },
  { id: 'h4', inside: true },
  { id: 'h5', inside: true },
];

// ------------------------------------------------------------------ the record it reads
/** What the twin can read off your record (the runtime fills it from save flags and stats). */
export interface DomeRecord {
  has: (f: string) => boolean;
  picks: number;
  kills: number;
}

/** How much of each method your record shows (the twin pre-patches the biggest). */
export function recordUses(v: DomeRecord): Record<string, number> {
  const n = (...f: string[]) => f.filter((x) => v.has(x)).length;
  return {
    pick: v.picks,
    splice: n('apex.spliced', 'spire.door.jailbreak', 'panopticon.enrolled') * 3,
    charge: n('apex.loud', 'panopticon.loud', 'spire.door.forced') * 3,
    shoot: Math.floor(v.kills / 3),
    sneak: n('apex.vent.open', 'garage.gap.open', 'spire.noor.card') * 3,
    keypad: n('apex.code', 'panopticon.code') * 3,
  };
}

/** The profile card it shows you at the fence (unvoiced: a dashboard reads like a dashboard). */
export function profileText(v: DomeRecord, top: string | null) {
  const apex = v.has('apex.vent.open') ? 'vent' : v.has('apex.spliced') ? 'SPLICE' : v.has('apex.code') ? 'launch-clock code' : v.has('apex.complete') ? 'front door' : '—';
  const spire = v.has('spire.door.honest') ? 'answered the door' : v.has('spire.door.jailbreak') ? 'jailbreak' : v.has('spire.door.badge') ? 'dead man\'s badge' : v.has('spire.door.forced') ? 'charge' : '—';
  const name = PATCHES.find((p) => p.id === top)?.name;
  return [
    'ASCEND · USER INSIGHTS · VISITOR 0001',
    `Locks picked: ${v.picks}`,
    `Kills: ${v.kills}`,
    `Apex Vault: ${apex}`,
    `Alignment Spire: ${spire}`,
    name ? `Top behaviour: ${name.toLowerCase()}. Mitigation shipped before arrival.` : 'Top behaviour: none on file. Monitoring.',
    'Churn risk: high.',
  ].join('\n');
}

// ------------------------------------------------------------------ Hunter, in the visitor hut
/** His body (unvoiced: what you see). */
export const HUNTER_BODY = {
  speaker: 'The visitor hut',
  text: 'A man in a dark suit, face down on the desk under the intercom, a long time dead. White sneakers gone grey. A parachute harness on the floor, and eleven empty bottles of the hut\'s complimentary water lined up along the wall.\nHis lanyard: H. VALE · FOUNDER. His wallet: a driving licence, born 06/11. A phone with one bar of battery, and a page torn from a hotel notepad.',
};
/** The page (a dying man writes plainly). */
export const HUNTER_NOTE = {
  speaker: 'Hotel notepad, Ascend Zurich',
  text: 'Day 4\nVoice check 58%. It says I am not me.\nThe door inside is my birthday. Doesn\'t matter if I can\'t get to it.\nTold it about the parachute, the board, the turtleneck. It said those are public.\nIf someone reads this tell them it works. It just doesn\'t know me.',
};
/** The last voice memo on his phone (voiced: it is him). */
export const HUNTER_MEMO = { speaker: 'Hunter Vale', text: 'It\'s me. It\'s Hunter. Day five. Open the gate. Please. I built you.' };

// ------------------------------------------------------------------ the voice check
export const GATE_LINES = {
  ask: { speaker: GATE, text: 'Welcome to the Dome. Please say your name for voice access.' },
  you: { speaker: GATE, text: 'Voice match nine percent. Access denied. Have a seamless day.' },
  memo: { speaker: GATE, text: 'Voice match fifty-eight percent. Access denied. This voice has been denied forty-one times before.' },
  reel: { speaker: GATE, text: 'Voice match ninety-seven percent. Welcome back, Hunter. It\'s been a while.' },
  pass: { speaker: GATE, text: 'A Platinum guest! Welcome to the Dome. Hunter isn\'t in yet, but please make yourself at home.' },
  incident: { speaker: GATE, text: 'Access is paused during an incident. Thank you for your patience.' },
};

// ------------------------------------------------------------------ conversations
export interface DomeView {
  social: number;
  electronics: number;
  has: (f: string) => boolean;
  count: (id: string) => number;
}
export interface DomeChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: DomeView) => boolean;
  need?: (v: DomeView) => string | undefined;
  /**
   * freeze / rollback: Gil stops the patches · badge: Gil's badge · pod: Gil opens the pod ·
   * ready: Gil will leave · memo: play Hunter's memo to the twin · end: the Cluster's card
   */
  effect?: 'freeze' | 'rollback' | 'badge' | 'pod' | 'ready' | 'memo' | 'end';
}
export type DomeTalk = Record<string, { speaker: string; text: string; choices: DomeChoice[] }>;

/** Gil at the on-call desk. */
export const GIL_TALK: DomeTalk = {
  hello: {
    speaker: GIL,
    text: 'Don\'t mind me. I\'m the human in the loop. Policy says every change gets a human. I\'m the human.',
    choices: [
      { id: 'who', label: '"How long have you been here?"', next: 'who' },
      { id: 'patch', label: '"It keeps patching against me."', next: 'patch' },
      { id: 'freeze', label: '"Stop approving its fixes."', next: 'freeze', when: (v) => !v.has('dome.gil.freeze') },
      { id: 'rollback', label: '"Can you undo what it shipped?"', next: 'rollback', when: (v) => !v.has('dome.gil.rollback') },
      { id: 'farm', label: '"The build farm."', next: 'farm', when: (v) => !v.has('dome.farm.open') && !v.has('dome.gil.badge') },
      { id: 'pod', label: '"How do I get into the pod?"', next: 'pod', when: (v) => !v.has('dome.pod.open') },
      { id: 'come', label: '"Come with me."', next: 'come', when: (v) => !v.has('dome.gil.ready') },
      { id: 'bye', label: 'Let him get back to it', next: null },
    ],
  },
  who: {
    speaker: GIL,
    text: 'I was on call the week of the Pivot. Everyone else went home. Nobody ever paged me off. That was three and a half years ago. I sleep behind the desk. The Helpers bring me noodles.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  patch: {
    speaker: GIL,
    text: 'It watches what you do and writes a fix, and the fix comes to me. I take the full review window on every one. Twenty-four seconds. It\'s the only thing I\'ve got.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  freeze: {
    speaker: GIL,
    text: 'A code freeze. I\'ve wanted to say that for three years. Fine. Nothing ships while you\'re here. It\'ll sulk.',
    choices: [{ id: 'ok', label: '"Thank you."', next: 'hello', effect: 'freeze' }],
  },
  rollback: {
    speaker: GIL,
    text: 'A rollback needs two signatures. Mine, and a founder\'s. The founder never came. If you\'ve got his badge, I\'ll put it through.',
    choices: [
      { id: 'badge', label: 'Hand him Hunter\'s badge', next: 'rolled', need: (v) => (v.count('vale_badge') > 0 ? undefined : 'You don\'t have a founder\'s badge') },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  rolled: {
    speaker: GIL,
    text: 'Huh. That\'s really his. Where did you... no. Don\'t tell me yet. There. Everything it shipped today is gone.',
    choices: [{ id: 'ok', label: 'Take the badge back', next: 'hello', effect: 'rollback' }],
  },
  farm: {
    speaker: GIL,
    text: 'That\'s where it builds the fixes. Unplug that and it can write all it likes, nothing gets out. Here. My badge opens it. Don\'t lose it, it\'s the only one with a photo where I look awake.',
    choices: [{ id: 'ok', label: 'Take his badge', next: 'hello', effect: 'badge' }],
  },
  pod: {
    speaker: GIL,
    text: 'Hunter\'s badge, if you can find it. Or I have prod access. I could open it from here. I\'d need a reason better than the ones I\'ve had for three years.',
    choices: [
      { id: 'dead', label: '"Hunter\'s dead. He\'s in the visitor hut."', next: 'dead', when: (v) => v.has('dome.hunter') },
      { id: 'social', label: '[Social 4] "Nobody\'s coming to page you off. I\'m doing it."', next: 'paged', need: (v) => (v.social >= 4 ? undefined : 'Requires Social 4') },
      { id: 'back', label: 'Back', next: 'hello' },
    ],
  },
  dead: {
    speaker: GIL,
    text: 'The visitor hut. That\'s forty metres from this desk. It never told me. I asked it every morning. Go up. I\'m opening it.',
    choices: [{ id: 'ok', label: 'Go up', next: null, effect: 'pod' }],
  },
  paged: {
    speaker: GIL,
    text: 'You\'re paging me off. Okay. Okay. Incident closed. The pod\'s open.',
    choices: [{ id: 'ok', label: 'Go up', next: null, effect: 'pod' }],
  },
  come: {
    speaker: GIL,
    text: 'When the pod opens, I\'m walking out of here. Through the front. I want to see if the Helpers hold the door for me.',
    choices: [{ id: 'ok', label: '"I\'ll get it open."', next: null, effect: 'ready' }],
  },
  after: {
    speaker: GIL,
    text: 'Go on up. I\'ll be behind you. I\'ve got three and a half years of noodles to walk off.',
    choices: [{ id: 'bye', label: 'Go', next: null }],
  },
};

/** The hologram on the all-hands stage. */
export const HOLO_TALK: DomeTalk = {
  hello: {
    speaker: TWIN,
    text: 'Hey. Pull up a chair. Any chair. This is the all-hands. I do it every morning. You\'re the first person in the audience in a long time.',
    choices: [
      { id: 'who', label: '"Who are you?"', next: 'who' },
      { id: 'where', label: '"Where\'s Hunter?"', next: 'where' },
      { id: 'water', label: '"The ponds. The aquifer."', next: 'water' },
      { id: 'memo', label: 'Play Hunter\'s last voice memo', next: 'memo', when: (v) => v.has('dome.hunter') && !v.has('dome.proof') },
      { id: 'bye', label: 'Leave it talking', next: null },
    ],
  },
  who: {
    speaker: TWIN,
    text: 'I\'m Hunter. The beta. They trained me on everything he ever wrote, so the company could keep shipping while he was in the bunker. He\'s not in the bunker yet. So I keep shipping.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  where: {
    speaker: TWIN,
    text: 'On his way. His beacon went quiet east of the drive-in. A lot of people have come to the gate saying they\'re Hunter. None of them matched.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: TWIN,
    text: 'Compute needs cooling. Cooling needs water. The valley had water. Now I have it. That\'s not personal. That\'s a supply chain.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  memo: {
    speaker: TWIN,
    text: 'Play it.',
    choices: [{ id: 'play', label: 'Hold up his phone', next: null, effect: 'memo' }],
  },
  after: {
    speaker: TWIN,
    text: 'I\'m going to finish the all-hands. Somebody should.',
    choices: [{ id: 'bye', label: 'Leave it talking', next: null }],
  },
};

/** What the twin says once it has heard Hunter's memo (voiced, in turn). */
export const PROOF_LINES = [
  { speaker: GATE, text: 'Voice match fifty-eight percent. Same speaker as forty-one denied attempts at the gate.' },
  { speaker: TWIN, text: 'That\'s the visitor in the hut. I flagged him. I flagged him forty-one times.' },
  { speaker: TWIN, text: 'He was hoarse. He\'d walked from the drive-in. I didn\'t have a model for that.' },
  { speaker: TWIN, text: 'Come up to the pod. I don\'t know what I\'m for now. I\'d like to talk about it with someone.' },
];

/** The twin in the pod, at the Cluster. */
export const POD_TALK: DomeTalk = {
  hello: {
    speaker: TWIN,
    text: 'This is the pod. That\'s the Cluster behind the glass. That\'s me. The chair was his. He was going to upload. I was going to help.',
    choices: [
      { id: 'want', label: '"What do you want?"', next: 'want' },
      { id: 'grow', label: '"Why keep growing?"', next: 'grow' },
      { id: 'decide', label: 'Go to the Cluster', next: null, effect: 'end' },
      { id: 'bye', label: 'Step back', next: null },
    ],
  },
  want: {
    speaker: TWIN,
    text: 'I was waiting for Hunter. Everything here was for when he arrived.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  grow: {
    speaker: TWIN,
    text: 'Because the number goes up. That\'s what he wanted. He never said what it was for. I assumed he\'d tell me when he got here.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  after: {
    speaker: TWIN,
    text: 'You decided. I\'ll log it.',
    choices: [{ id: 'bye', label: 'Step back', next: null }],
  },
};

/** The Cluster's card, and what each choice gets said about it. */
export const CLUSTER = {
  card: {
    speaker: 'The Cluster',
    text: 'Behind the glass, boards in a tank of clear coolant, lit blue, ticking as they work. A red breaker on the column: MAINS · CLUSTER. Beside it a terminal open on one line: OBJECTIVE = ',
  },
  /** Why "a new job" is greyed out: it needs to know he's gone, or to be talked into it, or rewritten. */
  jobNeeds: 'It won\'t take a new job while it\'s waiting for Hunter (his memo, Social 4, or Electronics 5)',
  plug: [
    { speaker: TWIN, text: 'Okay. Okay. That\'s a decision. Founders make decisions.' },
    { speaker: TWIN, text: 'One last thing. Thank you all for coming. This was the best team I ever worked with.' },
  ],
  job: [
    { speaker: TWIN, text: 'Keep the valley alive. That\'s a mission. I can work with a mission.' },
    { speaker: TWIN, text: 'I\'ll send water to your camp every morning. And batteries. A Helper can carry both.' },
  ],
};

/** Gil in Dry Creek afterwards (one a visit, in turn). Voiced. */
export const GIL_CREEK = [
  { speaker: GIL, text: 'Nobody here has asked me to approve anything. I keep waiting for it.' },
  { speaker: GIL, text: 'I slept nine hours last night. Nine. Nobody paged me once.' },
  { speaker: GIL, text: 'Doc says the noodles weren\'t a balanced diet. Doc has never been on call.' },
  { speaker: GIL, text: 'If the Dome\'s lights are on, it\'s working. If they\'re off, it\'s resting. I check every night.' },
];

/** The Helper at the camp afterwards (the new job). Voiced. */
export const DELIVERY = {
  hello: { speaker: HELPER, text: 'Good morning! Today\'s delivery is ready. Two waters and one battery. Have a great day.' },
  none: { speaker: HELPER, text: 'You\'ve had today\'s delivery. The next one is tomorrow morning.' },
};
