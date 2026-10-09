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
  {
    id: 'booster', name: 'The Longshot', kind: 'site', position: [130, 0, -300], rotation: 0.3,
    blurb: 'Kade\'s reusable rocket, reused once. It landed, in the sense that it is on the land.',
    flatten: { r: 34, falloff: 18 },
  },
  {
    id: 'waitlist', name: 'Waitlist City', kind: 'site', position: [312, 0, 300], rotation: -1.5708,
    blurb: 'Four thousand people queued for a bunker that seats by appointment. The appointments never opened.',
    flatten: { r: 42, falloff: 14 }, trampled: true,
  },
  {
    id: 'solar', name: 'Photon Park', kind: 'site', position: [-205, 0, 310], rotation: 0,
    blurb: 'Seven rows of glass, four robots wiping them, and a customer who stopped paying when the world ended.',
    flatten: { r: 40, falloff: 14 },
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

  // ---------------------------------------------------------------- #LIFEBOAT: the founders' group chat
  // Eight pages, one per device that died out here with its last sync. Read Receipts (quests.ts) runs
  // on them; the journal's Intel tab puts them back in order. Handles: vesper (Kade Holdings, Apex
  // Vault), hunter (Ascend, the jet), ezra (Glimpse, the Panopticon), prudence (Careful, the Alignment
  // Spire), orrin (cloud, the Cathedral), kit (chips, the Fortress), and tanner, who keeps rejoining.
  {
    id: 'intel.chat.1', series: 'lifeboat', prop: 'phone',
    title: 'Cracked Phone — #LIFEBOAT, page 1 of 8',
    body: chat(
      '~vesper created the group LIFEBOAT.',
      '~vesper added hunter, ezra, prudence, orrin and kit.',
      '~tanner joined using an invite link.',
      '~vesper removed tanner.',
      '~tanner joined using an invite link.',
      'vesper: Rules. No plus-ones. No screenshots. No lawyers.',
      'ezra: I screenshot everything. It\'s the whole company.',
      'vesper: Then no lawyers.',
    ),
    position: [-268, 0, 232],
    reveals: ['lore.lifeboat'],
    revealLines: ['A founders\' group chat, in pieces. Whoever owned this phone flew out of here in a hurry. Dez would want to hear about this.'],
    xp: 30,
  },
  {
    id: 'intel.chat.2', series: 'lifeboat', prop: 'tablet',
    title: 'Rugged Tablet — #LIFEBOAT, page 2 of 8',
    body: chat(
      'prudence: Our model gives the grid eleven weeks. We published a paper about it.',
      'hunter: Can we sell the paper?',
      'prudence: Nobody read the paper. Nobody reads the papers.',
      'orrin: I can deliver anything to any bunker in two days. Not after week nine.',
      'kit: Chips are the new water.',
      'vesper: Water is the new water. Buy water.',
    ),
    position: [-64, 0, -108],
    reveals: ['lore.lifeboat'],
    xp: 30,
  },
  {
    id: 'intel.chat.3', series: 'lifeboat', prop: 'tablet',
    title: 'Site Manager\'s Tablet — #LIFEBOAT, page 3 of 8',
    body: chat(
      'vesper: Closed on four aquifers today. The Dry Creek one came with a school attached.',
      'hunter: You bought a school?',
      'vesper: I gave them a school. Rocket on the sign. They gave me a creek. The county signed it in an afternoon.',
      'ezra: Want a heat map of who gets thirsty first? I have everyone\'s location. Always.',
      'vesper: I already have it, Ezra. It\'s called a map.',
    ),
    position: [-212, 0, -138],
    reveals: ['lore.lifeboat'],
    revealLines: ['"The county signed it in an afternoon." The county was Mara.'],
    xp: 30,
  },
  {
    id: 'intel.chat.4', series: 'lifeboat', prop: 'case',
    title: 'Briefcase Laptop — #LIFEBOAT, page 4 of 8',
    body: chat(
      'hunter: We can\'t call it a collapse. Collapse is bad for the brand.',
      'prudence: "Transition"?',
      'orrin: "Sunset."',
      'ezra: "Pivot." Everybody forgives a pivot.',
      'vesper: The Pivot. Done. Tanner, stop reacting with the rocket.',
      '~tanner reacted with a rocket.',
    ),
    position: [252, 0, -64],
    reveals: ['lore.lifeboat', 'lore.pivotname'],
    revealLines: ['They named it before it happened. Like a product.'],
    xp: 30,
  },
  {
    id: 'intel.chat.5', series: 'lifeboat', prop: 'printout',
    title: 'Server Printout — #LIFEBOAT, page 5 of 8',
    body: chat(
      'hunter: EXIT is live. Platinum gets an actual seat on an actual plane.',
      'vesper: Apex has 212 seats. Forty are ours. The rest are a waitlist.',
      'tanner: can I resell the waitlist',
      'vesper: ...',
      'vesper: Yes, actually. Pay me in water.',
      'tanner: BUNKR.LY IS BACK',
    ),
    position: [262, 0, -228],
    reveals: ['lore.lifeboat'],
    revealLines: ['So that\'s where Bunkr.ly came from. Vesper sold Tanner the waitlist, and Tanner sold it to everyone else.'],
    xp: 30,
  },
  {
    id: 'intel.chat.6', series: 'lifeboat', prop: 'pod',
    title: 'Seat-Back Screen — #LIFEBOAT, page 6 of 8',
    body: chat(
      'prudence: The Spire is finished. Every door asks an ethics question before it opens. The turrets apologise first.',
      'kit: The Fortress has nine months of chips and a moat full of coolant.',
      'ezra: The Panopticon has eleven hundred cameras. Every one of them is pointed at one of you.',
      'ezra: Relax. It\'s a feature.',
      'hunter: Mine has wings.',
      'vesper: Yours has a pilot who\'s software, Hunter.',
    ),
    position: [296, 0, 142],
    reveals: ['lore.lifeboat', 'lore.panopticon'],
    revealLines: ['The Panopticon. The Alignment Spire. The Fortress. Every founder built a door. Apex is only the next one.'],
    xp: 30,
  },
  {
    id: 'intel.chat.7', series: 'lifeboat', prop: 'watch',
    title: 'Smartwatch — #LIFEBOAT, page 7 of 8',
    body: chat(
      'prudence: Grid at four percent. It\'s today.',
      'ezra: I can see the whole highway from here. Everyone is in the same traffic jam. It\'s beautiful. It\'s one big group chat.',
      'hunter: wheels up. don\'t wait for me',
      'vesper: Nobody was waiting, Hunter.',
      'orrin: Deliveries paused. Indefinitely. Leave a review.',
      'tanner: guys the door won\'t open. is there a code',
    ),
    position: [-352, 0, 40],
    reveals: ['lore.lifeboat'],
    xp: 30,
  },
  {
    id: 'intel.chat.8', series: 'lifeboat', prop: 'drone',
    title: 'Drone Memory Card — #LIFEBOAT, page 8 of 8',
    body: chat(
      '~Day 31.',
      'prudence: Please stop forwarding your camera feeds to the Spire. Our doors have started asking us questions.',
      'ezra: You\'re all on my cameras. I\'m on mine too. I watch myself sleep. It\'s very calming.',
      'vesper: Hunter?',
      'vesper: Hunter.',
      '~hunter is unavailable.',
      'tanner: is anyone still taking resellers',
      '~vesper removed tanner.',
      'ezra: I saw that.',
    ),
    position: [138, 0, 160],
    reveals: ['lore.lifeboat', 'lore.panopticon'],
    revealLines: ['A Glimpse drone. It flew a beat over the valley until the battery quit. Somebody north of the salt was watching through it.'],
    xp: 30,
  },

  // ---------------------------------------------------------------- the valley's other paperwork
  {
    id: 'intel.kade.poster', prop: 'poster',
    title: 'Break-Room Poster — Kade Recovery',
    body:
      'WELCOME, RECOVERY ASSOCIATE! You recover what was always ours. ' +
      'OUR VALUES: Ownership. Hydration. Ownership. ' +
      'REMEMBER: Your smile is part of the uniform (see lanyard). Water you find is Kade water you haven\'t logged yet. ' +
      'Repossessed pianos are not break-room furniture. Grief is a benefit, available after twelve months. ' +
      '<i>People Ops, Kade Holdings. Water is a service.</i>',
    position: [240, 0, -130],
    revealLines: ['Somebody has drawn a moustache on the smiling associate. The moustache is the most human thing at Pipeline Camp 3.'],
    xp: 30,
  },
  {
    id: 'intel.glimpse.flyer', prop: 'flyer',
    title: 'Laminated Flyer — Glimpse Neighbourhood Watch',
    body:
      'GLIMPSE NEIGHBOURHOOD WATCH. This stretch of road is protected by four friendly cameras. ' +
      'Smile! You\'re already tagged. Not you? Glimpse is never wrong. ' +
      'Glimpse remembers, so you don\'t have to. ' +
      '<i>Ezra Seymour, founder: "Privacy was a phase. Safety is forever."</i> ' +
      'In pencil, along the bottom: <i>the one by the gas station still blinks.</i>',
    position: [66, 0, 74],
    reveals: ['lore.glimpse'],
    revealLines: ['A camera by the gas station. That\'s the camp.'],
    xp: 30,
  },
  {
    id: 'intel.careful.notice', prop: 'notice',
    title: 'Notice in a Sleeve — Careful Labs Field Team',
    body:
      'CAREFUL LABS · FIELD TEAM. If you are reading this at the 5G tower, you are at the wrong spire. ' +
      'Please do not look for the Alignment Spire. It is safe, helpful and very sorry, and it would prefer not to meet you. ' +
      'Each of its doors asks one question about ethics. Its turrets apologise first. ' +
      'We thought about this for a long time, so you don\'t have to. <i>Dr. P. Ashby.</i> ' +
      'Underneath, in marker: <i>who put "turret" and "apologise" in the same sentence</i>',
    position: [186, 0, 212],
    reveals: ['lore.spire'],
    revealLines: ['The Alignment Spire. Another door, somewhere past this one.'],
    xp: 30,
  },
  {
    id: 'intel.west.letter', prop: 'remains',
    title: 'Letter in a Zip Bag — The Walk West',
    body:
      'To whoever finds me. I had a seat. Bunkr.ly confirmation 4471-B, Apex Vault, Economy Plus. ' +
      'They said the line moves faster if you\'re already standing in it. I have been standing in it for nine days. ' +
      'The salt is very white. Tell my sister I went early to get us good spots. ' +
      'If you see a man called Tanner, tell him the tote bag was nice. It really was. I carried my water in it. <i>Marcus, waitlist 88,301.</i>',
    position: [-366, 0, 26],
    reveals: ['lore.walkwest'],
    revealLines: ['People walked west on Bunkr.ly receipts. Some of them sat down on the way.'],
    loot: [{ id: 'water', qty: 1 }, { id: 'scrap', qty: 2 }],
    xp: 40,
  },
  {
    id: 'intel.tanner.update', prop: 'update',
    title: 'Investor Update #161 — Bunkr.ly',
    body:
      'Hi friends! HIGHLIGHTS: SeedBot reached 12% battery (up from 11%!). We are post-apocalypse and pre-revenue, which is a great place to be. ' +
      'LOWLIGHTS: a camp. ' +
      'WAITLIST: position 4,012 (up from 4,009, a sign of a healthy, liquid line). ' +
      'ASKS: water; a warm intro to Vesper; a lawyer who accepts jugs. ' +
      'As always: build the future, then sit in it. <i>Tanner</i>',
    position: [110, 0, -38],
    revealLines: ['He still sends these. Every Monday. Nobody has opened one in three years.'],
    xp: 30,
  },
  {
    id: 'intel.kdry.log', prop: 'radio',
    title: 'Station Log — KDRY 1340 AM, the afternoon of',
    body:
      '14:02 Markets halted. Read the numbers anyway. ' +
      '14:09 Grid frequency dropping. Lights doing a thing. ' +
      '14:20 Sky an unusual colour. Advised listeners to stay indoors. ' +
      '14:31 Advertiser (Kade Holdings) cancelled the 2:30 spot. ' +
      '14:32 Played the song anyway. ' +
      '14:40 Phones down. Talking to whoever is left. ' +
      '15:15 A man came in asking what a "pivot" is. Said I\'d heard the word on a call. ' +
      '17:50 Generator still on. Nobody listening, probably. I\'m a professional. Signing off after the song. <i>R. Varga</i>',
    position: [-224, 0, -14],
    reveals: ['lore.kdry'],
    revealLines: ['R. Varga. Sol\'s name is Varga.'],
    xp: 35,
  },
  {
    id: 'intel.kade.kids', prop: 'brochure',
    title: 'Brochure — Kade Kids Academy',
    body:
      'KADE KIDS ACADEMY, Dry Creek. A school built on the future! Every student receives a rocket backpack and a lifetime refillable bottle ' +
      '(refill at any Kade Spring™, terms apply). This year\'s time capsule opens in 2046, when Dry Creek will be a thriving Kade community with 100% managed water. ' +
      'Ask about our Parent Ambassador program! <i>A gift from Kade Holdings, in partnership with the County Water Division.</i>',
    position: [-300, 0, 14],
    reveals: ['lore.kadekids'],
    revealLines: ['"100% managed water." They printed it on the brochure.'],
    xp: 30,
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
  // Act II → Tier 3: on Vesper's cot in the Cistern Room
  {
    id: 'intel.apex.memo',
    title: 'Memo — Re: Your Guests',
    body:
      'FROM: The Panopticon, office of the founder. TO: V. Kade. RE: your guests. ' +
      'Every face that has crossed your apron since Pivot Day: matched, timestamped, ranked by likelihood to become content. The camps are attached. ' +
      'Your water for our data, as discussed. P.S. We noticed the person reading this. Hello. We are always listening, and we call that a feature.',
    position: [-380.5, 0, -159.5],
    reveals: ['lore.panopticon'],
    revealLines: ['Somebody on the old coast, north of the salt, has been trading Vesper faces for water. They know you read this.'],
    xp: 60,
  },
];

/** The collectible run: the founders' group chat, page by page. */
export const LORE_SERIES: Record<string, { title: string; ids: string[] }> = {
  lifeboat: { title: '#LIFEBOAT', ids: ['intel.chat.1', 'intel.chat.2', 'intel.chat.3', 'intel.chat.4', 'intel.chat.5', 'intel.chat.6', 'intel.chat.7', 'intel.chat.8'] },
};

/** A chat transcript as the reader shows it: `handle: text`, or `~` for a system line. */
function chat(...lines: string[]) {
  return lines.map((l) => {
    if (l.startsWith('~')) return `<i>${l.slice(1)}</i>`;
    const i = l.indexOf(': ');
    return `<b>${l.slice(0, i)}</b> ${l.slice(i + 2)}`;
  }).join('<br>');
}
