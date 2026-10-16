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
  // --- Apex Vault (content/bunkers/apex.ts)
  airlock: { id: 'airlock', name: 'AIRLOCK · CYCLE', blurb: 'The airlock cycles open. It thinks you are a delivery.' },
  // --- the Panopticon: Glimpse's staff list at the face gate, the archive controller by the tower
  enrol: { id: 'enrol', name: 'STAFF LIST · ADD FACE', blurb: 'Your face goes on the staff list. The gate opens for staff.' },
  poles: { id: 'poles', name: 'POLE CAMERAS · SLEEP', blurb: 'The three Glimpse poles in the valley stop recording.' },
  tower: { id: 'tower', name: 'TOWER DOOR · RELEASE', blurb: 'The tower door unlatches. Ezra will know.' },
  towercams: { id: 'towercams', name: 'YARD CAMERAS · OFF', blurb: 'The four cameras on the tower power down together.' },
  // --- the Alignment Spire: the ethics door's policy, the sentinels, Prudence's card reader
  jailbreak: { id: 'jailbreak', name: 'DOOR POLICY · ROLEPLAY', blurb: 'The door agrees to pretend it is a door with no policy. It opens.' },
  sentinels: { id: 'sentinels', name: 'SENTINELS · TEST MODE', blurb: 'Every sentinel on the network goes into test mode and stops watching.' },
  office: { id: 'office', name: 'TOP FLOOR · ACCESS', blurb: 'The card reader on Prudence\'s door accepts a card you don\'t have.' },
  cameras: { id: 'cameras', name: 'CAMERAS · LOOP', blurb: 'The cameras loop yesterday\'s footage. Nobody was here yesterday.' },
  // --- the Chip Fortress: the gatehouse, the thermal cameras, the keep door
  bridge: { id: 'bridge', name: 'GATE · LOWER BRIDGE', blurb: 'The winch pays out and the drawbridge comes down across the moat.' },
  thermcams: { id: 'thermcams', name: 'THERMAL · RECALIBRATE', blurb: 'Every thermal camera re-zeros on the coolant and sees nothing warmer than minus forty.' },
  keepdoor: { id: 'keepdoor', name: 'KEEP · OPEN', blurb: 'The keep door unlocks. The log says Marek did it.' },
  // --- the Cloud Cathedral: the returns kiosk, the swarm, the floor, the office
  returnslabel: { id: 'returnslabel', name: 'RETURNS · PRINT LABEL', blurb: 'The kiosk prints a return label for a tote with nothing in it yet.' },
  swarm: { id: 'swarm', name: 'SWARM · RETURN TO BASE', blurb: 'Every drone over the lot flies home to the bell tower and lands for maintenance.' },
  pods: { id: 'pods', name: 'FLOOR · E-STOP', blurb: 'Every drive on the floor stops dead for ninety seconds.' },
  cathoffice: { id: 'cathoffice', name: 'DAY 1 OFFICE · UNLOCK', blurb: 'The office door\'s strike lets go. The log says Orrin opened it.' },
  // --- the Singularity Dome: the gate's voiceprint, the airlock, the build farm, the pod, the Helpers
  voiceprint: { id: 'voiceprint', name: 'VOICEPRINT · ENROL', blurb: 'Your voice goes on the gate\'s list as Hunter\'s. Match: 100%.' },
  domecams: { id: 'domecams', name: 'DOME CAMERAS · LOOP', blurb: 'The cameras on the rack ends loop an empty aisle.' },
  domedoor: { id: 'domedoor', name: 'AIRLOCK · OPEN', blurb: 'Both airlock leaves slide back. Facilities logs a dust warning.' },
  pipeline: { id: 'pipeline', name: 'PIPELINE · HALT', blurb: 'Every build in the farm fails. Nothing new ships until someone fixes it.' },
  pod: { id: 'pod', name: 'POD · FOUNDER ACCESS', blurb: 'The pod door opens for a founder. You are now a founder.' },
  helpers: { id: 'helpers', name: 'HELPERS · STANDBY', blurb: 'Every Ascend Helper sits down for a one-minute firmware check.' },
};

/** Kade terminal difficulty by outpost tier. */
export const TERMINAL_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 0, 2: 1, 3: 2 };

/** What a requisition order pays out (plus a handful of ammunition for each gun you carry). */
export const REQUISITION: { id: string; qty: number }[] = [{ id: 'battery', qty: 1 }, { id: 'water', qty: 1 }];
