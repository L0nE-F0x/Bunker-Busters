import type { Bunker } from '../types';

/**
 * Tier 3, the Panopticon (Act III): Ezra Seymour's building at the head of the valley north of the
 * salt. A ring of reviewers' desks round an old lighthouse he turned into his watch tower, with a
 * blue lamp that sweeps the valley. The runtime is game/bunker/panopticon/Panopticon.ts.
 *
 * - The valley: the lamp's beam (it turns once every forty seconds; caught in it, Ezra calls Kade)
 *   and three Glimpse pole cameras. If you looped the camp's Glimpse camera, the beam passes over you.
 * - The face gate: it opens for staff. SPLICE your face onto the staff list, short the motor, blow
 *   the rails, or talk Ezra into opening it.
 * - The yard round the tower: four cameras on the tower, each watching another one's junction box.
 *   Cut the one nobody watches first (Ada knows the order). Three people at desks in the ring: Ada,
 *   who'll help; Kofi, who reports you; Jun, who looks away.
 * - The tower: a keypad (Ada's number in the Everafter line), SPLICE at Electronics 4, or a big
 *   charge. Ezra's inside, at his monitor wall, with the keeper's cistern and the archive.
 */

const EZ = 'Ezra Seymour';
/** In the tower he's in the room with you, not on the PA (voices.ts casts both). */
export const EZ_ROOM = 'Ezra';
export const ADA = 'Ada Ivers';
export const KOFI = 'Kofi Boateng';
export const JUN = 'Jun Ishida';

/** His lines over the building's PA (voiced: the extractor finds `{ speaker, text }`). */
export const EZRA = {
  greet: { speaker: EZ, text: 'Hello again. You came up the valley at a walk. Most people run the last part. Come in out of the sun.' },
  gate: { speaker: EZ, text: 'There. Mind the threshold, it sticks.' },
  gateLoud: { speaker: EZ, text: 'That gate was the only thing in here that wasn\'t watching anyone.' },
  denied: { speaker: EZ, text: 'I know that face. The gate only opens for staff, and you aren\'t staff.' },
  swept: { speaker: EZ, text: 'There you are. I\'ve let Kade know. They\'ll be gentle if you are.' },
  sweptLoop: { speaker: EZ, text: 'The lamp went straight over you. You\'re still filed as an empty forecourt. I never corrected it.' },
  pole: { speaker: EZ, text: 'That pole camera had been up for nine hundred days without a fault.' },
  chain: { speaker: EZ, text: 'The camera beside it saw you do that. They watch each other. I thought you\'d noticed.' },
  cams: { speaker: EZ, text: 'The yard\'s dark. I can still hear you. The floor is very old.' },
  tower: { speaker: EZ, text: 'You\'re in the tower. Nobody has come up these steps since the keeper.' },
  towerLoud: { speaker: EZ, text: 'You could have knocked.' },
  lockout: { speaker: EZ, text: 'Two wrong numbers. Everyone in the ring heard the buzzer. They\'re pretending not to look.' },
  kofi: { speaker: EZ, text: 'Thank you, Kofi. Go back to your desk.' },
  busted: { speaker: EZ, text: 'Take it. It was always going to leave with somebody.' },
};

/** The PA, while you hang about outside (every 30-50 s). Things he's seen, mostly. */
const TAUNTS = [
  'Your left boot is wearing faster than the right. You favour it on slopes. I noticed in the spring.',
  'Hollis fixed the sign again on Tuesday. Third time this month. I\'ve started to look forward to it.',
  'Pip counted forty-one jugs this morning. She counts them twice, like I do.',
  'The pole on your right is unit 1290. It hasn\'t missed a day in two years.',
  'Mara says I\'m either the worst man in the valley or the only witness. I think about that a lot.',
  'The lamp turns once every forty seconds. I\'ve never hidden that.',
  'Sol\'s wife played a song on the last day. I have it. I\'ve never told him.',
  'There are eleven hundred cameras on this coast. Two of them are pointed at you now.',
];

export const PANOPTICON: Bunker = {
  id: 'panopticon',
  name: 'The Panopticon',
  tier: 3,
  owner: {
    name: EZ,
    archetype: 'Social-network founder, surveillance-obsessed',
    bio: 'Built Glimpse, the neighbourhood app that never forgot a face. Kept every camera running after the neighbourhoods went, and writes down what they see.',
    taunts: TAUNTS,
  },
  location: { biome: 'old-coast', position: [-296, 0, -350] },
  requirements: { skills: { stealth: 2, electronics: 3 } },
  layers: [
    {
      type: 'perimeter', title: 'The valley',
      obstacles: [
        { id: 'lamp', kind: 'camera', label: 'The lighthouse lamp (a camera on a 40 s turn)' },
        { id: 'poles', kind: 'camera', label: 'Glimpse pole cameras' },
      ],
      solutions: [
        { kind: 'stealth', label: 'Move between the beam\'s passes, keep to the rocks' },
        { kind: 'hack', label: 'Cut each pole\'s cable, or SPLICE them all from the gate', requires: { skills: { electronics: 3 } } },
        { kind: 'social', label: 'The camp\'s camera loop still files you as nobody', requires: { intel: 'q.cam.loop' } },
      ],
    },
    {
      type: 'entry', title: 'The face gate',
      obstacles: [{ id: 'gate', kind: 'door', label: 'Face gate (staff only)' }],
      solutions: [
        { kind: 'hack', label: 'SPLICE your face onto the staff list', requires: { skills: { electronics: 3 } } },
        { kind: 'hack', label: 'Short the gate motor', requires: { skills: { electronics: 3 } } },
        { kind: 'force', label: 'Blow the rails', requires: { skills: { demolition: 4 }, items: ['charge'] } },
        { kind: 'social', label: 'Tell Ezra what he wants to hear', requires: { skills: { social: 4 } } },
      ],
    },
    {
      type: 'interior', title: 'The yard',
      obstacles: [{ id: 'chain', kind: 'puzzle', label: 'Four tower cameras watching each other\'s boxes' }],
      solutions: [{ kind: 'stealth', label: 'Cut them in order (Ada knows it), or time the sweeps' }],
    },
    {
      type: 'vault', title: 'The tower',
      obstacles: [{ id: 'tower', kind: 'keypad', label: 'Tower door' }],
      solutions: [
        { kind: 'social', label: 'The code is Ada\'s number in the Everafter line', requires: { intel: 'panopticon.code' } },
        { kind: 'hack', label: 'SPLICE the archive controller', requires: { skills: { electronics: 4 } } },
        { kind: 'force', label: 'A big charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 12 }, { item: 'battery', qty: 2 }],
    rolls: [
      // Ezra's supply locker: he works out what he needs to the litre, and buys spares of everything else
      { item: 'medkit', qty: [1, 2], chance: 0.9 },
      { item: 'ration', qty: [2, 4], chance: 0.9 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'spike', qty: [1, 2], chance: 0.6 },
      // the archive shelf: spare drives, lenses, cable
      { item: 'battery', qty: [1, 3], chance: 0.8 },
      { item: 'scrap', qty: [4, 8], chance: 1 },
      { item: 'gpu', qty: [1, 2], chance: 0.6 },
      { item: 'charge', qty: [1, 1], chance: 0.4 },
    ],
    xp: 750,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'gate', point: 'gate', radius: 2.4, doors: ['gateL', 'gateR'],
        // (Panopticon.runMethod: it opens for staff faces, and yours isn't one until you make it one)
        primary: { kind: 'open', id: 'face', label: 'Look into the gate camera', xp: 40, reason: 'The gate knew your face' },
        secondary: {
          label: 'Another way through the gate', speaker: 'Face gate',
          text: 'A glass gate on rails with a camera at eye height. The motor housing has a service hatch, and the rails would take a charge.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the gate controller', title: 'FACE GATE', host: 'GLIMPSE · STAFF ACCESS', difficulty: 3, electronics: 3,
              daemons: ['enrol', 'poles'], xpEach: 30, reason: 'Spliced the face gate',
              traced: 'Trace complete. Your face is on every screen in the ring.',
            },
            { kind: 'circuit', id: 'short', label: 'Short the gate motor', title: 'GATE MOTOR', difficulty: 3, electronics: 3, xp: 45, reason: 'Gate motor shorted' },
            { kind: 'charge', label: 'Blow the rails', demolition: 4, quiet: false, loud: 'The gate jumps its rails. Every screen inside turns toward the noise.', line: EZRA.gateLoud.text },
          ],
        },
        line: EZRA.gate.text,
      },
      {
        id: 'tower', point: 'towerDoor', radius: 2.2, doors: ['towerDoor'],
        primary: {
          kind: 'keypad', id: 'pad', label: 'Use the tower keypad', title: 'TOWER', code: '2212',
          lockout: 2, lockedLabel: 'Keypad locked out', lockoutReason: 'Tower lockout. A buzzer goes off in the ring, and every chair turns.',
          hints: [{ when: ['panopticon.code'], text: 'Ada said it: her place in the Everafter line. Two, two, one, two.' }],
          hint: 'Four digits. Ezra picks numbers that mean something. Two wrong codes and it buzzes the whole ring.',
          xp: 60, reason: 'Tower code',
        },
        secondary: {
          label: 'Another way into the tower', speaker: 'Tower door',
          text: 'Steel, painted the white of the old lighthouse. The archive\'s controller hums in a cabinet beside it.',
          leave: 'Leave it',
          methods: [
            {
              kind: 'splice', id: 'splice', label: 'Splice the archive controller', title: 'TOWER', host: 'GLIMPSE · ARCHIVE', difficulty: 4, electronics: 4,
              daemons: ['tower', 'towercams'], xpEach: 30, reason: 'Spliced the tower',
              traced: 'Trace complete. The ring\'s buzzer goes off.',
            },
            { kind: 'charge', label: 'Place a breach charge', demolition: 5, quiet: false, loud: 'The tower door folds in on itself. The whole ring heard it.', line: EZRA.towerLoud.text },
          ],
        },
        line: EZRA.tower.text,
        trauma: 0.2,
      },
    ],
    portals: [{ entry: 'gate', pad: [0.6, 0.3, 1.6] }],
    voice: {
      point: 'speaker',
      greet: EZRA.greet.text,
      greetRadius: 125,
      tauntRadius: 75,
      alarm: [
        'Everyone stay at your desks, please. It\'s only a precaution.',
        'Kade, I have someone in the yard. Gently.',
        'Lockdown. The tower stays shut until this is over.',
      ],
    },
    alarmTime: 12,
    intercoms: [
      { id: 'pan-intercom', point: 'gate', offset: [2.8, 0.5], y: 1.35, radius: 2.0, label: 'Talk to Ezra at the gate', until: 'panopticon.gate.open' },
    ],
    cameras: { tripped: 'A camera has you. So does every screen in the ring.', detectTime: 1.8 },
    loot: {
      behind: 'tower',
      containers: [
        { id: 'cistern', label: 'Open the keeper\'s cistern', take: 'guaranteed' },
        { id: 'locker', label: 'Open Ezra\'s supply locker', take: [0, 4] },
        { id: 'shelf', label: 'Search the archive shelf', take: [4] },
      ],
      overburdened: 'You\'re overloaded. Drop something; the water matters more.',
      busted: {
        reason: 'BUNKER BUSTED: The Panopticon',
        banner: 'The keeper\'s cistern goes south tonight.',
        line: EZRA.busted.text,
      },
    },
  },
};

/** The pad Heightfield flattens round the building, cut into the head of the valley. */
export const PANOPTICON_PAD = { r: 27, falloff: 15, target: 7 };

/** Flags the Panopticon's own code reads (the runtime derives the rest from the ids above). */
export const PAN_FLAGS = {
  marker: 'panopticon.marker',
  seen: 'seen:panopticon',
  gate: 'panopticon.gate.open',
  tower: 'panopticon.tower.open',
  complete: 'panopticon.complete',
  /** Your face is on the staff list (SPLICE). */
  enrolled: 'panopticon.enrolled',
  /** He opened the gate for you (the intercom). */
  invited: 'panopticon.invited',
  /** The lamp caught you (Kade came, once). */
  swept: 'panopticon.swept',
  /** Ada told you the camera order / the tower code. */
  chain: 'panopticon.chain',
  code: 'panopticon.code',
  /** You spoke to Ada, and she'll walk out once the tower is open. */
  adaMet: 'panopticon.ada.met',
  adaReady: 'panopticon.ada.ready',
  /** She left (set when the tower is busted and she was ready). Dry Creek has her after this. */
  adaFree: 'panopticon.ada.free',
  /** Kofi reported you (once). */
  kofi: 'panopticon.kofi',
  /** The archive: what you did with it (one of take / wipe / broadcast). */
  archive: 'panopticon.archive',
  /** The camp's camera loop (Unit 0414 quest): the lamp files you as nobody. */
  loop: 'q.cam.loop',
  /** You were loud somewhere (the debrief says so). */
  loud: 'panopticon.loud',
};

/** A tower camera or a pole: per-camera flags `panopticon.cam.<id>.off`. `watcher`: the tower camera whose view covers this one's junction box. */
export const PAN_CAMERAS: { id: string; label: string; watcher?: string }[] = [
  { id: 'cam1', label: 'Camera 1' },
  { id: 'cam2', label: 'Camera 2', watcher: 'cam1' },
  { id: 'cam3', label: 'Camera 3', watcher: 'cam2' },
  { id: 'cam4', label: 'Camera 4', watcher: 'cam3' },
  { id: 'pole1', label: 'Pole camera 1290' },
  { id: 'pole2', label: 'Pole camera 1291' },
  { id: 'pole3', label: 'Pole camera 1293' },
];

/** The lamp: a camera on a slow turn. Range (m), half-width of the beam (°), seconds per turn. */
export const PAN_LAMP = { range: 175, halfDeg: 5.5, period: 40, seenTime: 0.6 };

// ------------------------------------------------------------------ Ezra at the gate (the intercom)
export interface PanView {
  social: number;
  has: (f: string) => boolean;
}
export interface PanChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: PanView) => boolean;
  need?: (v: PanView) => string | undefined;
  /** invite: the gate opens · chain/code: Ada tells you · ready: Ada will leave · archive: the decision card */
  effect?: 'invite' | 'chain' | 'code' | 'ready' | 'archive';
}
export type PanTalk = Record<string, { speaker: string; text: string; choices: PanChoice[] }>;

const knowsAda = (v: PanView) => v.has('doc.ada') || v.has('q.ada.found') || v.has('q.ada.told') || v.has('q.ada.kind');

export const EZRA_GATE: PanTalk = {
  hello: {
    speaker: EZ,
    text: 'You can talk normally. The gate hears everything.',
    choices: [
      { id: 'why', label: '"Why do you watch the camps?"', next: 'why' },
      { id: 'water', label: '"The camps need water."', next: 'water' },
      { id: 'ada', label: '"Is Ada Ivers in there?"', next: 'ada', when: knowsAda },
      { id: 'close', label: '"You said you\'d know when I was close."', next: 'close', when: (v) => v.has('q.cam.hello') },
      {
        id: 'witness', label: '[Social 4] "You want somebody to see what you\'ve seen. Let me in."', next: 'witness',
        need: (v) => (v.social >= 4 ? undefined : 'Requires Social 4'),
      },
      { id: 'bye', label: 'Step back from the gate', next: null },
    ],
  },
  why: {
    speaker: EZ,
    text: 'Somebody should. When the towns went, the cameras didn\'t, and I was the only one still looking. I wrote it all down. Who shared and who didn\'t.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: EZ,
    text: 'They do. I know how much, to the litre, camp by camp. It\'s in the record.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  ada: {
    speaker: EZ,
    text: 'Desk seven. She\'s the best reviewer I have. She never misses anything, and she\'s never written down a thing that wasn\'t true.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  close: {
    speaker: EZ,
    text: 'I did. You stopped at the third pole and looked straight up at it. Nobody looks up.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  witness: {
    speaker: EZ,
    text: 'Yes. That\'s it exactly. The gate\'s open. Come and look.',
    choices: [{ id: 'ok', label: 'Go in', next: null, effect: 'invite' }],
  },
  after: {
    speaker: EZ,
    text: 'You came back. People always come back to look.',
    choices: [{ id: 'bye', label: 'Step back', next: null }],
  },
};

// ------------------------------------------------------------------ Ada at desk seven (through her cell's intercom)
export const ADA_TALK: PanTalk = {
  hello: {
    speaker: ADA,
    text: 'You\'re not staff. Staff knock. Stand by the pillar, the tower camera swings back this way every few seconds.',
    choices: [
      { id: 'letter', label: '"Doc read you a letter on the radio."', next: 'letter', when: (v) => v.has('q.ada.told') },
      { id: 'brother', label: '"Your brother runs the clinic in Dry Creek."', next: 'brother', when: (v) => knowsAda(v) && !v.has('q.ada.told') },
      { id: 'place', label: '"What do you do in here?"', next: 'place' },
      { id: 'cams', label: '"How do I get past the tower cameras?"', next: 'cams' },
      { id: 'door', label: '"What\'s the code for the tower?"', next: 'door' },
      { id: 'come', label: '"Come with me."', next: 'come' },
      { id: 'bye', label: 'Leave her to it', next: null },
    ],
  },
  letter: {
    speaker: ADA,
    text: 'Dez read it on the band. I listened at this desk with the volume right down so nobody would see my face. He still signs off "your annoying brother". I wasn\'t allowed to answer.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  brother: {
    speaker: ADA,
    text: 'He\'s alive? Of course he is. He\'d say he was too busy. Tell him I\'m eating. He\'ll ask.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  place: {
    speaker: ADA,
    text: 'We watch the camps and write down what we see. Who drinks, who shares, who goes missing. Ezra reads all of it every night. He calls it a record. Most of it is people sitting round fires.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  cams: {
    speaker: ADA,
    text: 'The four on the tower each watch another one\'s box. One watches two\'s box, two watches three\'s, three watches four\'s. Nothing watches one. Cut them in that order.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'chain' }],
  },
  door: {
    speaker: ADA,
    text: 'It\'s my number. My place in the Everafter line. Two, two, one, two. He thinks that\'s a kindness.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'code' }],
  },
  come: {
    speaker: ADA,
    text: 'Not while he\'s at the wall. When someone\'s up in the tower talking to him, he stops watching for a while. He always does. I\'ll walk out then.',
    choices: [{ id: 'ok', label: '"I\'ll keep him talking."', next: null, effect: 'ready' }],
  },
  after: {
    speaker: ADA,
    text: 'I\'m going. Tell Doc I\'m walking, not running. He\'ll want to know I\'m not running.',
    choices: [{ id: 'bye', label: 'Let her go', next: null }],
  },
};

// ------------------------------------------------------------------ Ezra in person, at his monitor wall
export const EZRA_TOWER: PanTalk = {
  hello: {
    speaker: EZ_ROOM,
    text: 'You\'re taller than on camera. Everyone is. There\'s a chair. Nobody\'s sat in it.',
    choices: [
      { id: 'why', label: '"Why all this?"', next: 'why' },
      { id: 'water', label: '"Where\'s the water?"', next: 'water' },
      { id: 'names', label: '"You read our names on the radio."', next: 'names' },
      { id: 'ada', label: '"Ada\'s leaving."', next: 'ada', when: (v) => v.has('panopticon.ada.ready') },
      { id: 'archive', label: '"The archive."', next: 'archive', when: (v) => !v.has('panopticon.archive') },
      { id: 'bye', label: 'Leave him at his wall', next: null },
    ],
  },
  why: {
    speaker: EZ_ROOM,
    text: 'Glimpse was for lost dogs and car alarms and men trying door handles. Then the neighbourhoods went and the cameras kept running. Somebody had to keep looking. I\'m the one who didn\'t stop.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: EZ_ROOM,
    text: 'The keeper\'s cistern, under the hatch, and what Vesper paid me for faces. Take it. I\'ve worked out what I need to the litre. It isn\'t much.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  names: {
    speaker: EZ_ROOM,
    text: 'After Apex I wanted the camp to know that somebody had noticed. It came out as a list. Most things I say come out as a list.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  ada: {
    speaker: EZ_ROOM,
    text: 'I know. I watched her pack. She folded the chair. Nobody else ever folded the chair.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  archive: {
    speaker: EZ_ROOM,
    text: 'Three years of every camp. Who gave and who took. Who ran the Everafter line and who sold places in it. Vesper\'s in there, and Tanner, and you. It\'s on the drive in the rack behind me. What happens to it now is up to you.',
    choices: [{ id: 'decide', label: 'Decide what happens to it', next: null, effect: 'archive' }],
  },
  after: {
    speaker: EZ_ROOM,
    text: 'You\'re back. I kept your chair.',
    choices: [{ id: 'bye', label: 'Leave him at his wall', next: null }],
  },
};

/** The archive decision (a choice card), and what Ezra says to each. Voiced. */
export const ARCHIVE = {
  card: {
    speaker: 'The archive',
    text: 'A grey drive in a caddy, labelled in Ezra\'s handwriting: VALLEY · 3 YRS · MASTER. The rack has a transmitter patched into it, and a wipe switch under a plastic flap.',
  },
  take: { speaker: EZ_ROOM, text: 'Take it to Mara, then. She wants a court. I\'d like to see one.' },
  wipe: { speaker: EZ_ROOM, text: 'You\'d rather nobody saw it. I understand. It\'s the one thing I could never do.' },
  broadcast: { speaker: EZ_ROOM, text: 'Every camp at once. That isn\'t a court, that\'s weather. Go on, then.' },
};

/** Ada at Doc's desk in Dry Creek, afterwards (one a visit, in turn). Voiced. */
export const ADA_CREEK = [
  { speaker: ADA, text: 'He has me doing his books. I\'ve kept better books for worse men.' },
  { speaker: ADA, text: 'Nobody here has asked me what I wrote down at that desk. I keep waiting for someone to.' },
  { speaker: ADA, text: 'I sleep with the light on. Not because of the dark. Because nobody\'s watching it.' },
  { speaker: ADA, text: 'If you go back up the valley, look at the lamp for me. I want to know if he still turns it.' },
  { speaker: ADA, text: 'My brother says I look thin. He has said that since I was nine.' },
];

/** The reviewers. `reports`: when they see you, they tell Ezra (the alarm). Voiced. */
export const REVIEWERS = {
  kofi: {
    desk: 4,
    seen: { speaker: KOFI, text: 'Ezra? There\'s someone in the yard. No, I\'m sure.' },
    talk: { speaker: KOFI, text: 'Don\'t stand there. He watches me watching you.' },
  },
  jun: {
    desk: 10,
    seen: { speaker: JUN, text: 'I didn\'t see you. I\'m very busy.' },
    talk: { speaker: JUN, text: 'Desk seven is Ada. If you\'re here for anyone, it\'s her.' },
  },
};
