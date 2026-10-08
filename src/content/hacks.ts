/**
 * SPLICE daemons: the payloads you can push into a box with the hacking minigame (`ui/Hack.ts`).
 * Each hack offers up to three; the first listed gets the shortest sequence. What a daemon does is
 * up to the place that offers it (`combat/terminals.ts`, the Garage, the data centre).
 */

export interface DaemonDef {
  id: string;
  name: string;
  blurb: string;
}

export const DAEMONS: Record<string, DaemonDef> = {
  // --- Kade field terminals (every outpost has one, cabled to the generator)
  sentries: { id: 'sentries', name: 'SENTRY · STAND DOWN', blurb: 'This camp\'s compliance sentries power down for "scheduled maintenance".' },
  perimeter: { id: 'perimeter', name: 'PERIMETER · SAFE', blurb: 'The property-line mines go dark and the Hornet sets down on its pad.' },
  requisition: { id: 'requisition', name: 'REQUISITION · APPROVE', blurb: 'Approve a resupply order. The footlocker\'s second tray pops: rounds, a cell, water.' },
  roster: { id: 'roster', name: 'ROSTER · DUMP', blurb: 'Every Kade outpost goes on your map, with what it\'s guarding.' },
  ids: { id: 'ids', name: 'ID PRINTER · RUN', blurb: 'Two blank Recovery Lanyards. Swipe one on the next Kade box.' },
  // --- the Garage: Tanner bought the keypad and the lasers from the same vendor
  vault: { id: 'vault', name: 'RUNWAY ROOM · RELEASE', blurb: 'The vault door unlatches. Tanner gets a push notification.' },
  seedbot: { id: 'seedbot', name: 'SEEDBOT · DOCK', blurb: 'SeedBot docks for a 40-second "firmware review".' },
  lasers: { id: 'lasers', name: 'LASER GRID · OFF', blurb: 'The tripwire lasers in the hall drop out.' },
  // --- ColdStorage: the core room's access controller
  core: { id: 'core', name: 'CORE · RELEASE', blurb: 'The core room door slides open.' },
  solar: { id: 'solar', name: 'SOLAR · REROUTE', blurb: 'Bring the hall lights up from the solar island without walking out to the switchgear.' },
  ups: { id: 'ups', name: 'UPS · EJECT', blurb: 'The UPS cabinet ejects two charged lithium cells.' },
};

/** Kade terminal difficulty by outpost tier. */
export const TERMINAL_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 0, 2: 1, 3: 2 };

/** What a requisition order pays out (plus a handful of ammunition for each gun you carry). */
export const REQUISITION: { id: string; qty: number }[] = [{ id: 'battery', qty: 1 }, { id: 'water', qty: 1 }];
