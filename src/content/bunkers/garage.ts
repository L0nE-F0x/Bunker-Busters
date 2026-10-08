import type { Bunker } from '../types';
import { XP_REWARDS } from '../progression';

/**
 * Tier 1 — "The Garage". Local layout coordinates (metres, +z = south/front) are interpreted by
 * game/bunker/GarageBuilder.ts; everything gameplay-relevant is declared here.
 */
export const GARAGE: Bunker = {
  id: 'garage',
  name: 'The Garage',
  tier: 1,
  owner: {
    name: 'Tanner Pivotson',
    archetype: 'Failed-startup prepper',
    bio:
      'Founder & Chief Visionary of Bunkr.ly ("Uber for Bunkers"). Raised $40M on a napkin. Built exactly one bunker: his own. ' +
      'Still sends investor updates to an empty inbox every Monday.',
    taunts: [
      'This property is pre-revenue but POST-apocalypse. Leave.',
      'Trespassing is a violation of my terms of service.',
      'SeedBot, deploy! ...SeedBot? Somebody plug in SeedBot.',
      'I have eleven months of runway and a very large padlock.',
      'Every great bunker started in a garage. This one stayed there.',
      'We are not hiring. We are also not looting. Goodbye.',
      'Please hold. Your break-in is important to us.',
      'If my partner is listening: this is fine! This is a growth moment!',
      'My waitlist position is confidential and also improving!',
      'That water is spoken for. By a vault. With a much nicer door.',
    ],
  },
  location: { biome: 'dust-flats', position: [96, 0, -150] },
  requirements: { items: ['lockpick'] },
  layers: [
    {
      type: 'perimeter',
      title: 'Chain-link perimeter',
      obstacles: [
        { id: 'fence', kind: 'fence', label: 'Razor-wire fence' },
        { id: 'tripwires', kind: 'tripwire', label: 'Tin-can tripwires' },
        { id: 'gate_lock', kind: 'padlock', label: 'Gate padlock', difficulty: 3 },
      ],
      solutions: [
        { kind: 'lockpick', label: 'Pick the gate padlock (3 pins)', requires: { items: ['lockpick'] } },
        { kind: 'stealth', label: 'Slip through the NE fence gap', requires: { intel: 'garage.gap' } },
        { kind: 'force', label: 'Breach charge on the gate', requires: { skills: { demolition: 1 }, items: ['charge'] } },
        { kind: 'social', label: 'Talk Tanner into opening it', requires: { skills: { social: 4 } } },
      ],
    },
    {
      type: 'entry',
      title: 'Side door',
      obstacles: [{ id: 'door_lock', kind: 'padlock', label: 'Side-door padlock', difficulty: 4 }],
      solutions: [
        { kind: 'lockpick', label: 'Pick the padlock (4 pins)', requires: { items: ['lockpick'] } },
        { kind: 'hack', label: 'Short the door keypad', requires: { skills: { electronics: 1 } } },
        { kind: 'force', label: 'Breach charge on the side door', requires: { skills: { demolition: 3 }, items: ['charge'] } },
        { kind: 'social', label: 'Talk him into unlatching it', requires: { skills: { social: 5 } } },
      ],
    },
    {
      type: 'interior',
      title: 'Workshop',
      obstacles: [{ id: 'seedbot', kind: 'drone', label: 'SeedBot (12% battery)' }],
      solutions: [
        { kind: 'stealth', label: 'Wait for a battery brown-out and slip past' },
        { kind: 'hack', label: 'Throw an EMP charge', requires: { items: ['emp'] } },
      ],
    },
    {
      type: 'vault',
      title: 'The Runway Room',
      obstacles: [{ id: 'vault_lock', kind: 'padlock', label: 'Vault padlock', difficulty: 5 }],
      solutions: [
        { kind: 'lockpick', label: 'Pick the vault lock (5 pins)', requires: { items: ['lockpick'] } },
        { kind: 'hack', label: 'Enter the keypad code', requires: { skills: { social: 3 } } },
        { kind: 'force', label: 'Breach charge on the vault', requires: { skills: { demolition: 5 }, items: ['charge'] } },
      ],
    },
  ],
  loot: {
    guaranteed: [
      { item: 'seed_manifest', qty: 1 },
      { item: 'water', qty: 4 },
      { item: 'hoodie', qty: 1 },
      { item: 'pitch_deck', qty: 1 },
      { item: 'medkit', qty: 1 },
    ],
    rolls: [
      { item: 'soylent', qty: [1, 2], chance: 1 },
      { item: 'battery', qty: [1, 2], chance: 0.85 },
      { item: 'emp', qty: [1, 1], chance: 0.4 },
      { item: 'charge', qty: [1, 1], chance: 0.55 },
      { item: 'noisemaker', qty: [1, 2], chance: 0.7 },
      { item: 'nft_drive', qty: [1, 3], chance: 0.8 },
      { item: 'lockpick', qty: [1, 3], chance: 0.9 },
      { item: 'scrap', qty: [3, 7], chance: 1 },
    ],
    xp: 250,
  },
  intel: [],
  // What game/bunker/Garage.ts actually plays (the runtime in game/bunker/Bunker.ts). The ids are
  // save flags (garage.gate.open, garage.tw_gap.disarmed, garage.loot.safe…): never rename them.
  security: {
    entries: [
      {
        id: 'gate', point: 'gate', radius: 2.2, doors: ['gateL', 'gateR'], lockMesh: 'gate',
        primary: { kind: 'lockpick', pins: 3, title: 'GATE PADLOCK' },
        secondary: { kind: 'charge', label: 'Place a breach charge', demolition: 1, quiet: true, loud: 'Breach charge. Everyone heard that.', line: 'MY GATE. That was not in the terms of service!' },
        line: 'My gate! That padlock had a five-star rating!',
      },
      {
        id: 'gap', point: 'gap', radius: 2.6, doors: ['gap'], needs: 'garage.gap',
        primary: { kind: 'open', label: 'Peel back the loose fence', xp: 20, reason: 'Found another way in', toast: 'The raccoons were right.' },
        line: null,
      },
      {
        id: 'side', point: 'sideDoor', radius: 2.0, doors: ['side'],
        primary: { kind: 'lockpick', pins: 4, title: 'SIDE DOOR PADLOCK' },
        secondary: {
          label: 'Another way through the door', speaker: 'Side door', text: 'The padlock is the patient way. These are the other two.', leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'short', label: 'Short the keypad', title: 'KEYPAD BYPASS', difficulty: 1, electronics: 1, xp: XP_REWARDS.keypadShorted, reason: 'Keypad shorted' },
            { kind: 'charge', label: 'Place a breach charge', demolition: 3, quiet: true, loud: 'Breach charge. Everyone heard that.' },
          ],
        },
        line: 'That door was load-bearing! Emotionally!',
      },
      {
        id: 'vault', point: 'vaultDoor', radius: 2.0, doors: ['vault'],
        primary: { kind: 'lockpick', pins: 5, title: 'VAULT LOCK' },
        secondary: {
          label: 'Keypad, or something louder', speaker: 'Runway Room', text: 'Five pins, or a keypad Tanner is very proud of, or a noise.', leave: 'Step back',
          methods: [
            {
              kind: 'keypad', id: 'pad', label: 'Use the keypad', title: 'RUNWAY ROOM', code: '1234',
              lockout: 3, lockedLabel: 'Keypad locked out', lockoutReason: 'Keypad lockout!',
              hints: [
                { when: ['social.code'], text: 'He said it out loud. 1 2 3 4.' },
                { when: ['social.digit'], text: 'Tanner slipped. It starts with 1, then 2. He said the rest was obvious.' },
                { when: ['social.told', 'garage.drone'], text: 'Everyone who knows him says the code is obvious. Nobody wrote the digits down.' },
              ],
              hint: 'No hint on the housing. Three wrong codes and it locks you out.',
              xp: 40, reason: 'Vault code cracked',
            },
            {
              kind: 'splice', label: 'Splice the keypad controller', title: 'RUNWAY ROOM', host: 'PIVOTSON HOME SECURITY', difficulty: 2, electronics: 2,
              daemons: ['vault', 'seedbot', 'lasers'], xpEach: 15, reason: 'Spliced Tanner\'s keypad',
              traced: 'Trace complete. The keypad screams your IP address.',
            },
            { kind: 'charge', label: 'Place a breach charge', demolition: 5, quiet: false, loud: 'The vault door leaves in pieces.' },
          ],
        },
        line: 'NO. Not the Runway Room. That is where I keep my runway!',
        trauma: 0.25,
      },
    ],
    portals: [{ entry: 'side', pad: [0.6, 0.15, 0.2] }],
    voice: {
      point: 'megaphone',
      greet: 'Hey! You! This is a PRIVATE apocalypse. Members only.',
      greetRadius: 55,
      tauntRadius: 45,
      alarm: ['INTRUDER! SeedBot, disrupt them!', 'Security breach! This is going in the investor update!', 'Alarm! Somebody tell my lawyer! ...Oh right.'],
    },
    alarmTime: 7,
    intercoms: [
      { id: 'intercom-out', point: 'gate', offset: [0, 4.2], y: 1.1, radius: 2.1, label: 'Hail Tanner on the intercom', until: 'debriefed' },
      { id: 'intercom-in', point: 'gate', offset: [2.4, -3.2], y: 1.1, radius: 2.1, label: 'Hail Tanner on the intercom', until: 'debriefed' },
    ],
    tripwires: {
      disarm: { label: 'Disarm tripwire', electronics: 1, lacking: 'Requires Electronics 1 — or {crouch} to step over' },
      yank: {
        label: 'Yank the wire', demolition: 3, lacking: 'Requires Demolition 3 — or crouch over it',
        quiet: 'You eased the cans down. The alarm stayed asleep.', quietReason: 'Tripwire eased out',
        loud: 'You ripped a tripwire out. The cans noticed.',
      },
      tripped: 'You tripped a wire! Tin cans everywhere.',
      stepped: 'Carefully stepped over a tripwire.',
      ahead: 'Tripwire ahead — {crouch} to step over it.',
    },
    lasers: {
      tripped: { laser_low: 'Laser tripped! (Jump over low beams.)', default: 'Laser tripped! (Crouch under high beams.)' },
      alarmPoint: 'sideDoor',
      power: {
        id: 'fuse', point: 'fuseBox', radius: 1.8, label: 'Cut power to the lasers',
        circuit: { title: 'FUSE BOX', difficulty: 0 },
        expert: 5, expertToast: 'You know this box. The lasers die quietly.',
        xp: 20, reason: 'Lasers disabled',
        shock: { damage: 15, toast: 'You yanked every wire. Lasers off. So is your hair.' },
        sparkOffset: [-0.45, 0.3, 0],
      },
    },
    drones: {
      name: 'SeedBot',
      spotted: 'SeedBot spotted you!',
      zapped: 'SeedBot tased you. You wake up outside the fence, lighter by one lockpick.',
      sputter: '*bzzt* LOW BATTERY. ENTERING POWER-SAVE. *whirr*',
      reboot: 'REBOOT COMPLETE. HAVE I MISSED ANY INVESTOR CALLS?',
      emp: 'ERR_VIBES_NOT_FOUND. SHUTTING DOWN.',
      empReason: 'SeedBot fried',
    },
    loot: {
      behind: 'vault',
      containers: [
        { id: 'crate_a', label: 'Open supply crate', take: [0, 4] },
        { id: 'crate_b', label: 'Open supply crate', take: [4] },
        { id: 'safe', label: 'Crack Tanner\'s safe', take: 'guaranteed' },
      ],
      overburdened: 'Overburdened. The water is the point. Drop the junk.',
      busted: {
        reason: 'BUNKER BUSTED: The Garage',
        banner: 'The cistern is open. Radio Mara at the campfire. She wants the names read out loud.',
        line: 'Fine. FINE. I am pivoting. To grief.',
      },
    },
  },
};
