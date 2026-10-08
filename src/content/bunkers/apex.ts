import type { Bunker } from '../types';

/**
 * Tier 2 — "Apex Vault" (Vesper Kade). A SKELETON: it proves the bunker runtime takes a second bunker
 * (game/bunker/apex/Apex.ts + a greybox builder) and is NOT placed in the world. Nothing imports it
 * from Game; the headless harness builds it to exercise the runtime. Before players see it:
 * - a real builder (layout, art, far LOD, shadow proxy, VirtualLights) and a place west of the salt
 *   (LANDMARKS + Heightfield flattening + `Game.exteriorRoots`/interiors + map marker);
 * - Vesper's lines written properly and voiced (content/voices.ts CAST + re-voice);
 * - Kade contractors / Hornets as the patrol layer (combat/Recovery), the story hook (Act II);
 * - tuning: everything below is a first guess.
 *
 * Spec: "Chaotic, overbuilt, half-broken automation, memes on the walls". Her doors listen; her
 * cameras watch the airlock; the SPLICE box is the way in for an Electronics build.
 */
export const APEX: Bunker = {
  id: 'apex',
  name: 'Apex Vault',
  tier: 2,
  owner: {
    name: 'Vesper Kade',
    archetype: 'Rocket-and-EV mogul who posts constantly',
    bio: 'Rocket money, a megaphone made of satellites, and a vault west of the salt. Thinks the camps are the free tier.',
    // TODO(apex): her stock taunts. Left empty on purpose: any `{ name, taunts }` here gets picked up
    // by scripts/voice/extract.mjs and voiced on the next re-voice, and placeholders shouldn't be.
    taunts: [],
  },
  // TODO(apex): a placeholder spot west of the salt; not in LANDMARKS, not flattened, never built by Game.
  location: { biome: 'salt-flats', position: [-460, 0, -80] },
  requirements: { skills: { electronics: 2 }, items: ['lockpick'] },
  layers: [
    {
      type: 'perimeter', title: 'Hangar apron',
      obstacles: [{ id: 'hangar_lock', kind: 'padlock', label: 'Hangar door', difficulty: 5 }],
      solutions: [
        { kind: 'lockpick', label: 'Pick the hangar door (5 pins)', requires: { items: ['lockpick'] } },
        { kind: 'hack', label: 'Short the door controller', requires: { skills: { electronics: 2 } } },
        { kind: 'force', label: 'Breach charge', requires: { skills: { demolition: 3 }, items: ['charge'] } },
      ],
    },
    {
      type: 'entry', title: 'The airlock',
      obstacles: [
        { id: 'airlock', kind: 'keypad', label: 'Airlock keypad' },
        { id: 'cameras', kind: 'camera', label: 'Airlock cameras' },
      ],
      solutions: [
        { kind: 'hack', label: 'SPLICE the airlock (cameras, lasers, door)', requires: { skills: { electronics: 3 } } },
        { kind: 'social', label: 'Find the code (it counts down)', requires: { intel: 'apex.code' } },
      ],
    },
    {
      type: 'interior', title: 'Launch corridor',
      obstacles: [{ id: 'lasers', kind: 'puzzle', label: 'Laser grid' }],
      solutions: [{ kind: 'stealth', label: 'Jump low beams, crouch high ones, or kill the breaker' }],
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
    guaranteed: [{ item: 'water', qty: 8 }, { item: 'battery', qty: 2 }],
    rolls: [
      { item: 'charge', qty: [1, 2], chance: 0.6 },
      { item: 'emp', qty: [1, 2], chance: 0.6 },
      { item: 'spike', qty: [1, 2], chance: 0.5 },
      { item: 'medkit', qty: [1, 1], chance: 0.7 },
      { item: 'kade_badge', qty: [1, 2], chance: 0.5 },
      { item: 'scrap', qty: [4, 9], chance: 1 },
    ],
    xp: 500,
  },
  intel: [],
  security: {
    entries: [
      {
        id: 'hangar', point: 'hangar', radius: 2.4, doors: ['hangar'],
        primary: { kind: 'lockpick', pins: 5, title: 'HANGAR DOOR' },
        secondary: {
          label: 'Another way through the hangar door', speaker: 'Hangar door', text: 'A padlock on a door that costs more than the camp. Or its controller. Or a noise.', leave: 'Leave it',
          methods: [
            { kind: 'circuit', id: 'short', label: 'Short the door controller', title: 'HANGAR CONTROLLER', difficulty: 2, electronics: 2, xp: 40, reason: 'Controller shorted' },
            { kind: 'charge', label: 'Place a breach charge', demolition: 3, quiet: true, loud: 'Breach charge. The whole apron heard it.' },
          ],
        },
        line: 'That door had a waitlist. You skipped it. Bold.',
      },
      {
        id: 'airlock', point: 'airlock', radius: 2.0, doors: ['airlock'],
        primary: {
          kind: 'keypad', id: 'pad', label: 'Use the airlock keypad', title: 'AIRLOCK', code: '3210',
          lockout: 2, lockedLabel: 'Keypad locked out', lockoutReason: 'Airlock lockout. The cameras turn to look.',
          hints: [{ when: ['apex.code'], text: 'Somebody wrote it on the wall: a countdown, under a rocket. 3, 2, 1, 0.' }],
          hint: 'Four digits. Everything here counts down to something. Two wrong codes and it locks you out.',
          xp: 50, reason: 'Airlock code',
        },
        secondary: {
          kind: 'splice', label: 'Splice the airlock controller', title: 'AIRLOCK', host: 'APEX VAULT · DOORS', difficulty: 3, electronics: 3,
          daemons: ['airlock', 'cameras', 'lasers'], xpEach: 20, reason: 'Spliced the airlock',
          traced: 'Trace complete. Your face is trending.',
        },
        line: 'You are in the airlock. I can see you. Everyone can see you. Smile.',
      },
      {
        id: 'vault', point: 'vaultDoor', radius: 2.0, doors: ['vault'],
        primary: { kind: 'lockpick', pins: 6, title: 'CISTERN ROOM' },
        secondary: { kind: 'charge', label: 'Place a breach charge', demolition: 5, quiet: false, loud: 'The vault door comes off its hinges.' },
        line: 'Not the cistern. That water is load-bearing for my valuation.',
        trauma: 0.25,
      },
    ],
    portals: [{ entry: 'airlock', pad: [0.2, 0.15, 0.6] }],
    voice: {
      point: 'speaker',
      greet: 'Welcome to Apex. You are not on the list. I can tell by the dust.',
      greetRadius: 60,
      tauntRadius: 50,
      alarm: ['Security! Somebody is in my house!', 'Intruder. Posting it.', 'Kade Recovery, cleanup on the apron.'],
    },
    alarmTime: 9,
    lasers: {
      tripped: { laser_low: 'Laser tripped! (Jump the low beam.)', default: 'Laser tripped! (Crouch under the high beam.)' },
      alarmPoint: 'airlock',
      power: {
        id: 'breaker', point: 'breaker', radius: 1.8, label: 'Kill the laser breaker',
        circuit: { title: 'BREAKER', difficulty: 1 },
        expert: 5, expertToast: 'Overbuilt and under-labelled. You find the right breaker anyway.',
        xp: 25, reason: 'Lasers disabled',
        shock: { damage: 20, toast: 'Three-phase. Your teeth hum. The lasers are off.' },
        sparkOffset: [0, 0.3, 0.3],
      },
    },
    cameras: { tripped: 'A camera saw you. Somewhere, a post goes up.', detectTime: 1.5 },
    loot: {
      behind: 'vault',
      containers: [
        { id: 'tank_a', label: 'Open the supply locker', take: [0, 3] },
        { id: 'tank_b', label: 'Open the supply locker', take: [3] },
        { id: 'cistern', label: 'Open the cistern tap', take: 'guaranteed' },
      ],
      overburdened: 'Overburdened. The water is the point.',
      busted: {
        reason: 'BUNKER BUSTED: Apex Vault',
        banner: 'The cistern runs east tonight.',
        line: 'Fine. This is fine. I am launching something. Into the sun.',
      },
    },
  },
};
