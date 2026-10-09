import type { Bunker } from '../types';

/**
 * Tier 2, Apex Vault: Vesper Kade's launch site on the west shore of the salt (Act II). The rules
 * (locks, cameras, lasers, loot) are data for the bunker runtime (game/bunker/Bunker.ts); the place
 * is game/bunker/apex/ApexBuilder.ts, and Vesper herself (the intercom, her feed, the launch clock)
 * is game/bunker/apex/Apex.ts.
 *
 * Routes: the hangar door (pick 5 pins, short its controller, a charge, or talk her into a "demo");
 * the airlock (the launch-clock code, or SPLICE: airlock, cameras, lasers); the launch corridor (jump,
 * crouch, or the breaker); the Cistern Room (6 pins or a big charge). Kade's Apex Gatehouse on the
 * road (content/recovery.ts) is the patrol layer, and her alarm calls it.
 */

const VK = 'Vesper Kade';

/** Her speaker lines (spoken through the apron PA). Objects so the voice extractor finds them. */
export const VESPER = {
  greet: { speaker: VK, text: 'Oh! A visitor. Hold on, I\'m going live. Chat, look, a real one. Dehydrated. Welcome to Apex. You are not on the list.' },
  hangar: { speaker: VK, text: 'That door had a waitlist. You skipped it. Bold. Unfollowing.' },
  hangarLoud: { speaker: VK, text: 'You blew up my hangar door. That door was in a keynote.' },
  airlock: { speaker: VK, text: 'You\'re in the airlock. I can see you. Everyone can see you. Smile, you\'re content now.' },
  lasers: { speaker: VK, text: 'Those lasers were a feature. You turned off a feature. I\'m filing a bug against you, personally.' },
  cameras: { speaker: VK, text: 'My cameras just went dark. Do you know what that does to my engagement?' },
  vault: { speaker: VK, text: 'Not the cistern. That water is load-bearing for my valuation.' },
  vaultLoud: { speaker: VK, text: 'You breached the Cistern Room. With a bomb. Next to the water. Very sustainable.' },
  vent: { speaker: VK, text: 'The vent? Really? That vent has a podcast now. You\'re a guest on it.' },
  lockout: { speaker: VK, text: 'Wrong code, twice. The clock was right there. It was literally counting for you.' },
  busted: { speaker: VK, text: 'Fine. This is fine. I\'m launching something anyway. Into the sun, probably.' },
  ambush: { speaker: VK, text: 'You know what? Content. I\'m sending a delivery. Limited edition. Limited to you.' },
  after: { speaker: VK, text: 'You again. There\'s nothing left in there but a tank shaped like my feelings.' },
};

export const APEX: Bunker = {
  id: 'apex',
  name: 'Apex Vault',
  tier: 2,
  owner: {
    name: VK,
    archetype: 'Rocket-and-EV mogul who posts constantly',
    bio: 'Rocket money, a megaphone made of satellites, and a vault west of the salt. Thinks the camps are the free tier.',
    // her stock taunts, while you hang around the apron (every 30-50 s)
    taunts: [
      'Posting this. "Local man discovers door." Engagement is through the roof.',
      'Every camera here streams to eleven million followers. Wave. No, the other hand.',
      'I ran a poll. Should the camps get water. Eighty-eight percent said "lol". Democracy has spoken.',
      'Fun fact: this concrete cost more than your camp. Less fun fact: so did your water.',
      'My lawyers say I can\'t legally call you a parasite. My lawyers have been deprecated.',
      'You\'re standing on a launch apron. Statistically, that\'s the least safe place on Earth. I own the statistics.',
      'I\'m launching on Thursday. Which Thursday is a forward-looking statement.',
      'The best part is no part. The best camp is no camp. Write that down. Actually, I\'ll post it.',
    ],
  },
  location: { biome: 'salt-flats', position: [-366, 0, -126] },
  requirements: { skills: { electronics: 2 }, items: ['lockpick'] },
  layers: [
    {
      type: 'perimeter', title: 'Hangar apron',
      obstacles: [{ id: 'hangar_lock', kind: 'padlock', label: 'Hangar door', difficulty: 5 }],
      solutions: [
        { kind: 'lockpick', label: 'Pick the hangar door (5 pins)', requires: { items: ['lockpick'] } },
        { kind: 'hack', label: 'Short the door controller', requires: { skills: { electronics: 2 } } },
        { kind: 'force', label: 'Breach charge', requires: { skills: { demolition: 3 }, items: ['charge'] } },
        { kind: 'social', label: 'Pitch Vesper a demo on the intercom', requires: { skills: { social: 3 } } },
      ],
    },
    {
      type: 'entry', title: 'The airlock',
      obstacles: [
        { id: 'airlock', kind: 'keypad', label: 'Airlock keypad' },
        { id: 'cameras', kind: 'camera', label: 'Hangar cameras' },
      ],
      solutions: [
        { kind: 'hack', label: 'SPLICE the airlock (door, cameras, lasers)', requires: { skills: { electronics: 3 } } },
        { kind: 'social', label: 'The code is the launch clock (it counts down)', requires: { intel: 'apex.code' } },
      ],
    },
    {
      type: 'interior', title: 'Launch corridor',
      obstacles: [{ id: 'lasers', kind: 'puzzle', label: 'Laser grid' }],
      solutions: [{ kind: 'stealth', label: 'Jump the low beams, crouch the high one, or kill the breaker' }],
    },
    {
      type: 'vault', title: 'The Cistern Room',
      obstacles: [{ id: 'vault_lock', kind: 'padlock', label: 'Vault door', difficulty: 6 }],
      solutions: [
        { kind: 'lockpick', label: 'Pick the vault (6 pins)', requires: { items: ['lockpick'] } },
        { kind: 'force', label: 'Breach charge', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [{ item: 'water', qty: 10 }, { item: 'battery', qty: 2 }],
    rolls: [
      { item: 'charge', qty: [1, 2], chance: 0.6 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'medkit', qty: [1, 2], chance: 0.8 },
      { item: 'spike', qty: [1, 2], chance: 0.5 },
      { item: 'kade_badge', qty: [1, 2], chance: 0.6 },
      { item: 'ration', qty: [2, 3], chance: 0.8 },
      { item: 'scrap', qty: [4, 9], chance: 1 },
    ],
    xp: 600,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'hangar', point: 'hangar', radius: 2.6, doors: ['hangarL', 'hangarR'], lockMesh: 'hangar',
        primary: { kind: 'lockpick', pins: 5, title: 'HANGAR DOOR' },
        secondary: {
          label: 'Another way through the hangar door', speaker: 'Hangar door', text: 'A padlock on a door that costs more than the camp. Or its controller, behind a panel that says DO NOT. Or a noise.', leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'short', label: 'Short the door controller', title: 'HANGAR CONTROLLER', difficulty: 2, electronics: 2, xp: 45, reason: 'Controller shorted' },
            { kind: 'charge', label: 'Place a breach charge', demolition: 3, quiet: true, loud: 'Breach charge. The whole apron heard it.', line: VESPER.hangarLoud.text },
          ],
        },
        line: VESPER.hangar.text,
      },
      {
        id: 'airlock', point: 'airlock', radius: 2.2, doors: ['airlockOut', 'airlockIn'],
        primary: {
          kind: 'keypad', id: 'pad', label: 'Use the airlock keypad', title: 'AIRLOCK', code: '0000',
          lockout: 2, lockedLabel: 'Keypad locked out', lockoutReason: 'Airlock lockout. Every camera in the hangar turns to look.',
          hints: [{ when: ['apex.code'], text: 'The code is the launch clock over the door: hours and minutes, T-minus. It counts down, so read it, then type.' }],
          hint: 'Four digits. Everything here counts down to something. Two wrong codes and it locks you out.',
          xp: 60, reason: 'Airlock code',
        },
        secondary: {
          kind: 'splice', label: 'Splice the airlock controller', title: 'AIRLOCK', host: 'APEX VAULT · LAUNCH SYSTEMS', difficulty: 3, electronics: 3,
          daemons: ['airlock', 'cameras', 'lasers'], xpEach: 25, reason: 'Spliced the airlock',
          traced: 'Trace complete. Your face is trending.',
        },
        line: VESPER.airlock.text,
      },
      {
        // the crawl duct on the hill's east side: past the airlock and the first two beams (Infiltrators
        // know it's there; everyone else reads the shift note)
        id: 'vent', point: 'vent', radius: 1.9, doors: ['vent'], needs: 'apex.vent',
        primary: { kind: 'lockpick', pins: 3, title: 'VENT GRATE' },
        secondary: { kind: 'charge', label: 'Blow the grate', demolition: 2, quiet: true, loud: 'The grate goes into the duct with a bang. The hill hums with it.' },
        line: VESPER.vent.text,
      },
      {
        id: 'vault', point: 'vaultDoor', radius: 2.3, doors: ['vault'],
        primary: { kind: 'lockpick', pins: 6, title: 'CISTERN ROOM' },
        secondary: { kind: 'charge', label: 'Place a breach charge', demolition: 5, quiet: false, loud: 'The vault door comes off its hinges. Somewhere, a post goes up.', line: VESPER.vaultLoud.text },
        line: VESPER.vault.text,
        trauma: 0.25,
      },
    ],
    portals: [{ entry: 'airlock', pad: [0.4, 0.2, 1.4] }, { entry: 'vent', pad: [1.2, 0.2, 0.3] }],
    voice: {
      point: 'speaker',
      greet: VESPER.greet.text,
      greetRadius: 70,
      tauntRadius: 55,
      alarm: ['Security! Somebody is touching my things!', 'Intruder on the apron. Posting it. Pinning it.', 'Kade Recovery, cleanup on the apron. Bill the camps.'],
    },
    alarmTime: 10,
    intercoms: [
      { id: 'apex-intercom', point: 'hangar', offset: [5.6, 0.7], y: 1.25, radius: 2.0, label: 'Buzz Vesper on the intercom' },
    ],
    lasers: {
      tripped: { laser_low: 'Laser tripped! (Jump the low beams.)', laser_low2: 'Laser tripped! (Jump the low beams.)', default: 'Laser tripped! (Crouch under the high beam.)' },
      alarmPoint: 'airlock',
      power: {
        id: 'breaker', point: 'breaker', radius: 1.8, label: 'Kill the laser breaker',
        circuit: { title: 'BREAKER', difficulty: 2 },
        expert: 5, expertToast: 'Overbuilt and under-labelled. You find the right breaker anyway.',
        xp: 30, reason: 'Lasers disabled',
        shock: { damage: 20, toast: 'Three-phase. Your teeth hum. The lasers are off.' },
        sparkOffset: [0.3, 0.3, 0],
      },
    },
    cameras: { tripped: 'A camera saw you. Somewhere, a post goes up.', detectTime: 1.6 },
    loot: {
      behind: 'vault',
      containers: [
        { id: 'tank_a', label: 'Open the launch locker', take: [0, 3] },
        { id: 'tank_b', label: 'Open the crew locker', take: [3] },
        { id: 'cistern', label: 'Open the cistern tap', take: 'guaranteed' },
      ],
      overburdened: 'Overburdened. The water is the point.',
      busted: {
        reason: 'BUNKER BUSTED: Apex Vault',
        banner: 'The cistern runs east tonight.',
        line: VESPER.busted.text,
      },
    },
  },
};

/** The pad Heightfield flattens under Apex (around `location`): the apron, the hangar, the berm. */
export const APEX_PAD = { r: 37, falloff: 14, target: -5 };
/** A second pad under the vault block in the hill (offset from `location`): its back corners are past
 *  APEX_PAD's flat circle, and the range's slope came up through the Cistern Room's floor. */
export const APEX_BLOCK_PAD = { dx: -10, dz: -24, r: 16, falloff: 10, target: -5 };

/** Flags Apex's own code reads (the runtime derives the rest from the ids above). */
export const APEX_FLAGS = {
  marker: 'apex.marker',
  code: 'apex.code',
  seen: 'seen:apex',
  hangar: 'apex.hangar.open',
  airlock: 'apex.airlock.open',
  vault: 'apex.vault.open',
  lasers: 'apex.lasers.off',
  cameras: 'apex.cameras.off',
  complete: 'apex.complete',
  /** She let you in on the intercom. */
  demo: 'apex.demo',
  /** You know about the vent on the hill's east side. */
  vent: 'apex.vent',
  /** Her "delivery" on your way out with the water (once). */
  ambush: 'apex.ambush',
  /** You opened the merch crate her drone dropped with it. */
  merch: 'apex.merch',
};

/**
 * Vesper on the intercom by the hangar door. `when` hides a choice; `need` greys it out with a reason.
 * Effects: `demo` (the hangar opens for "content"), `code` (you learn how the airlock code works).
 */
export interface VesperView {
  social: number;
  has: (f: string) => boolean;
  theo: boolean;
}

export interface VesperChoice {
  id: string;
  label: string;
  next: string | null;
  when?: (v: VesperView) => boolean;
  need?: (v: VesperView) => string | undefined;
  effect?: 'demo' | 'code';
}

export const VESPER_TALK: Record<string, { speaker: string; text: string; choices: VesperChoice[] }> = {
  hello: {
    speaker: VK,
    text: 'You\'re on my intercom. That\'s a premium feature. Talk fast, I\'m live.',
    choices: [
      { id: 'live', label: '"Live to who?"', next: 'live' },
      { id: 'water', label: '"The camps need that water back."', next: 'water' },
      { id: 'theo', label: '"It\'s Theo. I walked out of here once."', next: 'theo', when: (v) => v.theo && !v.has('apex.talk.theo') },
      { id: 'ledger', label: '"The ledger\'s still in our ammo tin. Open the hangar."', next: 'ledger', when: (v) => v.has('act1.leverage') && !v.has(APEX_FLAGS.hangar) },
      { id: 'spent', label: '"Every camp heard your Seed list read out."', next: 'spent', when: (v) => v.has('act1.broadcast') },
      { id: 'fan', label: '[Social 3] "I\'m a fan. Fans make content. Let me in."', next: 'fan', when: (v) => !v.has(APEX_FLAGS.hangar), need: (v) => (v.social >= 3 ? undefined : 'Requires Social 3') },
      { id: 'code', label: '[Social 5] Ask for the airlock code like it\'s a feature request', next: 'code', when: (v) => !v.has(APEX_FLAGS.code) && !v.has(APEX_FLAGS.airlock), need: (v) => (v.social >= 5 ? undefined : 'Requires Social 5') },
      { id: 'bye', label: 'Let go of the button', next: null },
    ],
  },
  live: {
    speaker: VK,
    text: 'Eleven million followers and one guy in Ohio who comments "first" on everything. You\'re content now. Congratulations. Don\'t look at the camera, it\'s cringe.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  water: {
    speaker: VK,
    text: 'Need is a strong word. The water\'s safer here. With me. In a tank with my name on it, at a temperature I chose. Next question.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  theo: {
    speaker: VK,
    text: 'Theo Vance. You walked. Nobody walks. I kept your seat, out of spite. The airlock code is the launch clock over the door, by the way. You always hated reading the clock.',
    choices: [{ id: 'back', label: 'Back', next: 'hello', effect: 'code' }],
  },
  ledger: {
    speaker: VK,
    text: 'That\'s extortion. I respect it. I\'ll be suing you from orbit. The hangar\'s open. Wipe your feet, that floor has a following.',
    choices: [{ id: 'ok', label: 'Leave', next: null, effect: 'demo' }],
  },
  spent: {
    speaker: VK,
    text: 'You read my Seed list on the open net. Leverage you\'ve spent is just a story you tell at parties. I closed the valve. You know the rest.',
    choices: [{ id: 'back', label: 'Back', next: 'hello' }],
  },
  fan: {
    speaker: VK,
    text: '...Okay, that\'s actually a good hook. Fine. Ten minutes in the hangar. Don\'t touch the truck. Smile at the cameras. The airlock is not part of the tour.',
    choices: [{ id: 'ok', label: 'Leave', next: null, effect: 'demo' }],
  },
  code: {
    speaker: VK,
    text: 'A feature request! Finally, someone who speaks my language. It\'s the launch clock over the airlock. Hours and minutes. It counts down, so type fast. Shipping it.',
    choices: [{ id: 'ok', label: 'Leave', next: null, effect: 'code' }],
  },
  after: {
    speaker: VK,
    text: VESPER.after.text,
    choices: [{ id: 'bye', label: 'Let go of the button', next: null }],
  },
};

/** What her feed shows (the billboard over the hangar), newest state first. Silent: they're posts. */
export const VESPER_POSTS: { when: string; text: string; likes: string }[] = [
  { when: APEX_FLAGS.complete, text: 'this is fine. launching anyway. thoughts and rockets', likes: '9.1M' },
  { when: APEX_FLAGS.vault, text: 'the cistern was a metaphor. please stop drinking the metaphor', likes: '6.0M' },
  { when: APEX_FLAGS.lasers, text: 'turning off lasers is literally violence', likes: '3.3M' },
  { when: APEX_FLAGS.cameras, text: 'cameras down. if u see someone in my vault no u didnt', likes: '1.9M' },
  { when: APEX_FLAGS.airlock, text: 'live from my airlock: this is what poverty looks like up close. so brave', likes: '2.7M' },
  { when: APEX_FLAGS.demo, text: 'giving a fan a tour. humanizing. very relatable of me', likes: '4.4M' },
  { when: APEX_FLAGS.hangar, text: 'breaking: man discovers doors have hinges. more at 11', likes: '4.1M' },
  { when: '', text: 'the camps are the free tier. upgrade or hydrate elsewhere', likes: '12.8M' },
];
