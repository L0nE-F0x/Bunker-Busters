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
  {
    id: 'creek', name: 'Dry Creek', kind: 'town', position: [-262, 0, -48], rotation: 0.15,
    blurb: 'Not a town. A diner light, a clinic, and people who also did not get a door.',
  },
  {
    id: 'cave', name: 'The Cut', kind: 'cave', position: [48, 0, 352], rotation: 0.05,
    blurb: 'A mouth in the ridge. Someone has been living with the view.',
  },
];

/**
 * The wash up to The Cut. Heightfield carves a walkable grade along this polyline
 * and keeps props off it. The last point sits on the cave pad.
 */
export const CAVE_TRAIL: [number, number][] = [
  [80, 196],
  [62, 236],
  [88, 278],
  [46, 316],
  [48, 344],
];

export const SPAWN: [number, number, number] = [-138, 0, 118];

export const WORLD_INTEL: IntelItem[] = [
  {
    id: 'intel.gas.note',
    title: 'Scrawled Note — Last Chance Gas',
    body:
      'Drone headed NE with OUR water and the meal shakes. Fenced garage off the spur. Neon, solar, a man yelling about runway into a megaphone. ' +
      'Mara says the cistern is on that lot and the names are in his safe. If you are reading this, you have the radio. Bring both back.',
    position: [-146, 0, 128],
    reveals: ['garage.marker'],
    revealLines: ['The Garage is marked. The job is the cistern, then a document he calls the Seed Manifest.'],
    xp: 40,
  },
  {
    id: 'intel.spire.blueprint',
    title: 'Contractor Blueprint — "Project Garage"',
    body:
      'Change order #44: client refused the NE fence ("raccoons are not a threat vector"). ' +
      'Guard drone downgraded to a refurbished unit, battery health 12%. Expect it to fall asleep. ' +
      'Side door: 4-pin. Vault: 5-pin, keypad wired beside it. The code field is blacked out in marker. ' +
      'Margin, his handwriting: "users hate passwords — make it obvious." He did not write the obvious part.',
    position: [172, 0, 189],
    reveals: ['garage.gap', 'garage.drone'],
    revealLines: [
      'New route: a loose fence panel on the Garage\'s north-east side.',
      'SeedBot browns out on its own. The vault code is "obvious". The digits are not on this page.',
    ],
    xp: 60,
  },
  {
    id: 'intel.highway.greg',
    title: 'Voicemail — Greg, seed round',
    body:
      'Hi, this is Greg from the seed round. The human one. I paid two hundred thousand for a bunker and I received a tote bag and a calendar invite. ' +
      'The invite 404s. If anyone finds Tanner, tell him Greg is outside. Greg is very outside. Greg would like the wifi password, at minimum. ' +
      'Also the bunker. But I will start with the wifi.',
    position: [22, 0, 96],
    revealLines: ['Another customer. Paid in full. Got a tote bag. His name will be in the same column as the camp.'],
    loot: [{ id: 'scrap', qty: 3 }, { id: 'battery', qty: 1 }],
    xp: 35,
  },
];
