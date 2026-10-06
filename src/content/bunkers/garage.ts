import type { Bunker } from '../types';

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
};
