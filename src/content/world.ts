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
  // Kade's private road: off the highway's west end, down past Dry Creek and across the salt to Apex Vault
  [[-326, 63], [-338, 10], [-344, -40], [-352, -80], [-361, -96], [-366, -103]],
];

/**
 * The salt: a dry lake bed west of Dry Creek (Heightfield flattens it to `y`, Terrain paints the
 * crust inside `r`). Apex Vault sits at its west shore, against the range.
 */
export const SALT_FLAT = { x: -326, z: -172, r: 36, falloff: 24, y: -7.2 };

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
  // Sites: one class each in src/game/sites/. Keep ids stable; story flags hang off them.
  {
    id: 'jet', name: 'The Exit Strategy', kind: 'site', position: [-300, 0, 255], rotation: 0.6,
    blurb: 'A founder\'s jet that tried to leave early. The desert disagreed.',
    flatten: { r: 30, falloff: 26 },
  },
  {
    id: 'drivein', name: 'Starlite Drive-In', kind: 'site', position: [-20, 0, -132], rotation: -0.45,
    blurb: 'The last screening was a keynote. Nobody left before the end.',
    flatten: { r: 46, falloff: 24 },
  },
  {
    id: 'datacenter', name: 'ColdStorage', kind: 'site', position: [290, 0, -262], rotation: -0.3,
    blurb: 'Where the cloud came down to earth. It is still warm inside.',
    flatten: { r: 47, falloff: 24 },
  },
  {
    id: 'tube', name: 'The Tube', kind: 'site', position: [318, 0, 118], rotation: 1.1,
    blurb: 'A hyperloop test track. Top speed achieved: one press release.',
    flatten: { r: 22, falloff: 20 },
  },
  {
    id: 'courier', name: 'The Last Mile', kind: 'site', position: [-158, 0, -296], rotation: 2.4,
    blurb: 'A delivery 1,281 days late and still, technically, in progress.',
    flatten: { r: 9, falloff: 16 },
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
  // Act I: why the creek is dry, and where Tanner's water goes.
  {
    id: 'intel.highway.permit',
    title: 'County Clipboard — Permit 7-K',
    body:
      'COUNTY WATER DIVISION. Permit 7-K: Kade Holdings may draw from the Dry Creek aquifer for a "pilot program". ' +
      'Term: perpetual. Consideration: one (1) elementary school, rocket-themed. ' +
      'Approved: M. Voss, County Water Engineer. ' +
      'Margin, different pen: "Creek down 40% in two months. Pilot is not a pilot. Call M."',
    position: [-236, 0, 96],
    reveals: ['lore.permit'],
    revealLines: ['Mara\'s name is on it. Dry Creek didn\'t dry up. It was signed away.'],
    xp: 40,
  },
  {
    id: 'intel.spur.valve',
    title: 'Valve Tag — Kade Line, Spur 3',
    body:
      'KADE HOLDINGS · WELLSPRING LINE · SPUR VALVE 3. Reseller access: BUNKR.LY (T. Pivotson). ' +
      'Settlement: water only. Quota: 40 jugs/week. Late payment forfeits waitlist position. ' +
      'Current position: 4,012. Thank you for building the future with us!',
    position: [119, 0, -12],
    reveals: ['lore.valve'],
    revealLines: ['Tanner isn\'t hoarding the water. He\'s paying rent with it, to Kade Holdings.'],
    xp: 40,
  },
  // Act II: the way to Apex Vault, and the way into it.
  {
    id: 'intel.salt.waybill',
    title: 'Waybill — Kade Line, West',
    body:
      'KADE HOLDINGS · PRIVATE ROAD WEST. Consignee: APEX VAULT (V. Kade). Cargo: 40 jugs, "community contribution". ' +
      'Route: off the highway at the west end, south past Dry Creek, along the salt. Do not cross the salt in daylight, the glare eats drivers. ' +
      'Margin: "Driver walked. Truck stayed. Jugs stayed. Vesper posted about it."',
    position: [-318, 0, -150],
    reveals: ['apex.marker'],
    revealLines: ['Apex Vault is marked: at the foot of the range, on the salt\'s west shore. Her road leaves the highway at its west end.'],
    xp: 45,
  },
  {
    id: 'intel.apex.shift',
    title: 'Shift Note — Apex Gatehouse',
    body:
      'R. — She changed the airlock code AGAIN. New system: the code is the launch clock over the door. Hours and minutes, T-minus. ' +
      'It counts down, so it\'s never the same twice, which she calls "zero trust" and I call "my knees". Read the clock, type it, go in. ' +
      'Don\'t tell the camps. Don\'t tell Tanner. Don\'t look at the camera over the hangar, it posts you. ' +
      'P.S. Whoever keeps smoking in the vent on the east side of the hill: it goes straight into the launch corridor, past the lasers. Stop it. — D.',
    position: [-352, 0, -100],
    reveals: ['apex.code', 'apex.marker', 'apex.vent'],
    revealLines: ['The airlock code is the launch clock over the door: hours and minutes, counting down.', 'A vent on the hill\'s east side runs into the launch corridor, past two of the beams.'],
    xp: 50,
  },
];
