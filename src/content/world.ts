import type { IntelItem, LandmarkDef } from './types';

/** Size of the playable square in metres (centred on the origin). */
export const WORLD_SIZE = 840;
export const WORLD_SEED = 20261005;

/** Cracked old highway that crosses the map, as XZ points. */
export const HIGHWAY: [number, number][] = [
  [-520, -40], [-330, 60], [-190, 112], [-90, 120], [20, 92], [130, 30], [230, -60], [330, -110], [520, -150],
];

/** Dirt track from the highway up to The Garage. */
export const SIDE_ROADS: [number, number][][] = [
  [[110, 42], [112, -10], [98, -60], [92, -108]],
  [[-40, 112], [10, 150], [80, 172], [148, 176]],
];

export const LANDMARKS: LandmarkDef[] = [
  {
    id: 'gas', name: 'Last Chance Gas', kind: 'gas-station', position: [-150, 0, 134], rotation: 0.35, camp: true,
    blurb: 'A gas station with no gas, no station, and one very determined neon sign.',
  },
  {
    id: 'spire', name: 'The Spire', kind: 'radio-tower', position: [168, 0, 196], rotation: -0.4,
    blurb: 'A collapsed 5G tower. The conspiracy theorists were wrong, but the tower still fell on them.',
  },
];

export const SPAWN: [number, number, number] = [-138, 0, 118];

export const WORLD_INTEL: IntelItem[] = [
  {
    id: 'intel.gas.note',
    title: 'Scrawled Note — Last Chance Gas',
    body:
      'Saw a drone headed NE with a pallet of meal shakes and a ring light. Followed it to a fenced garage off the old highway spur. ' +
      'Neon sign, solar panels, a guy yelling about "runway" through a megaphone. Place is LOADED.',
    position: [-146, 0, 128],
    reveals: ['garage.marker'],
    xp: 40,
  },
  {
    id: 'intel.spire.blueprint',
    title: 'Contractor Blueprint — "Project Garage"',
    body:
      'Change order #44: client refused to pay for the NE fence section ("raccoons are not a threat vector"). ' +
      'Guard drone spec downgraded to refurbished unit, battery health 12%. Expect intermittent shutdowns. ' +
      'Side door: 4-pin padlock. Vault: 5-pin, also wired to a keypad, default code never changed.',
    position: [172, 0, 189],
    reveals: ['garage.gap', 'garage.drone'],
    xp: 60,
  },
];
