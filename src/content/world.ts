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
    blurb: 'Home, for now. Dead pumps, a fire, the radio, and the sign Hollis keeps lit.',
  },
  {
    id: 'spire', name: 'The Spire', kind: 'radio-tower', position: [168, 0, 196], rotation: -0.4,
    blurb: 'A 5G mast that came down across the ridge road. The contractor\'s shack at the foot of it is still standing.',
  },
  {
    id: 'creek', name: 'Dry Creek', kind: 'town', position: [-262, 0, -48], rotation: 0.15,
    blurb: 'A diner, a clinic, a store called the Till and a motel, along a creek bed that went dry the summer before the Pivot.',
  },
  {
    id: 'cave', name: 'The Cut', kind: 'cave', position: [48, 0, 352], rotation: 0.05,
    blurb: 'A cave high in the south ridge. Most evenings there\'s smoke at the mouth.',
  },
  // Sites: one class each in src/game/sites/. Keep ids stable; story flags hang off them.
  {
    id: 'jet', name: 'The Exit Strategy', kind: 'site', position: [-300, 0, 255], rotation: 0.6,
    blurb: 'A private jet, nose down in the dunes. It took off the week of the Pivot and didn\'t get far.',
    flatten: { r: 30, falloff: 26 },
  },
  {
    id: 'drivein', name: 'Starlite Drive-In', kind: 'site', position: [-20, 0, -132], rotation: -0.45,
    blurb: 'The last thing it showed was a keynote. The cars are still parked facing the screen.',
    flatten: { r: 46, falloff: 24 },
  },
  {
    id: 'datacenter', name: 'ColdStorage', kind: 'site', position: [290, 0, -262], rotation: -0.3,
    blurb: 'A server campus out on its own. Nobody has worked here in years, and it\'s still drawing power.',
    flatten: { r: 47, falloff: 24 },
  },
  {
    id: 'tube', name: 'The Tube', kind: 'site', position: [318, 0, 118], rotation: 1.1,
    blurb: 'A hyperloop test track on stilts. Three hundred metres of it ever got built.',
    flatten: { r: 22, falloff: 20 },
  },
  {
    id: 'courier', name: 'The Last Mile', kind: 'site', position: [-158, 0, -296], rotation: 2.4,
    blurb: 'A delivery bike in the dirt, an orange flag on a whip, and an order still marked "running late".',
    flatten: { r: 9, falloff: 16 },
  },
  {
    id: 'booster', name: 'The Longshot', kind: 'site', position: [130, 0, -300], rotation: 0.3,
    blurb: 'A Kade booster on its side in the north basin. It was supposed to land on a pad west of the salt.',
    flatten: { r: 34, falloff: 18 },
  },
  {
    id: 'waitlist', name: 'Waitlist City', kind: 'site', position: [312, 0, 300], rotation: -1.5708,
    blurb: 'Four thousand people queued here for a bunker called Everafter. The board over the door still says NOW SERVING 0001.',
    flatten: { r: 42, falloff: 14 }, trampled: true,
  },
  {
    id: 'solar', name: 'Photon Park', kind: 'site', position: [-205, 0, 310], rotation: 0,
    blurb: 'Seven rows of panels and four cleaning robots, still working for a customer who hasn\'t paid in three years.',
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
    title: 'Note on the Pump — Last Chance Gas',
    body:
      'Drone got the jugs off the highway again. Took the shakes too. It went NE, Dez followed the ping to a fenced lot up the dirt spur. ' +
      'Neon sign, solar panels, some guy on a megaphone going on about "runway".<br>' +
      'Mara says his cistern is on that lot, and he keeps a ledger in his safe with everybody who paid him.<br>' +
      'Whoever ends up with the radio: water first, then the ledger. There\'s 2 bottles left in the cooler behind the pumps. Take them. <i>H.</i>',
    position: [-146, 0, 128],
    reveals: ['garage.marker'],
    revealLines: ['The Garage is on the map. Water from his cistern first, then the ledger he calls the Seed Manifest.'],
    xp: 40,
  },
  {
    id: 'intel.spire.blueprint',
    title: 'Contractor Blueprint — "Project Garage"',
    body:
      'PIVOTSON RESIDENCE ("PROJECT GARAGE") · SHEET 3 OF 4 · REV F<br>' +
      'C.O. 44: NE fence run deleted at client request (client: "raccoons are not a threat vector"). Corner panel left tied off with wire only.<br>' +
      'C.O. 51: guard drone swapped for refurb unit to hold budget. Battery health 12%, will brown out under load. Client aware. Client "loves that".<br>' +
      'Side door: 4-pin padlock. Vault: 5-pin, keypad wired beside it. Code: <i>(blacked out in marker)</i><br>' +
      'Client\'s note in the margin: <i>users hate passwords. make it obvious</i>',
    position: [172, 0, 189],
    reveals: ['garage.gap', 'garage.drone'],
    revealLines: [
      'There\'s a loose fence panel at the Garage\'s north-east corner.',
      'The drone browns out on its own. The vault code is meant to be "obvious", but it isn\'t on the drawing.',
    ],
    xp: 60,
  },
  {
    id: 'intel.highway.greg',
    title: 'Voicemail — Greg, seed round',
    body:
      '<i>Saved voicemail, call box, eastbound shoulder.</i><br>' +
      '"Hey Tanner, it\'s Greg. Greg Halvorsen? From the seed round, I did the two hundred. Um. So I got the tote bag, thanks, and the calendar invite, ' +
      'but the link just goes to a 404? And I\'m here. I\'m at the coordinates. There\'s nothing here, Tanner, it\'s a road.<br>' +
      'Can you call me back. Or if there\'s a door code just text me the code. Or the wifi. Honestly I\'d take the wifi. Okay. It\'s Greg."',
    position: [22, 0, 96],
    revealLines: ['Paid two hundred thousand for a seat and got a tote bag. If Tanner kept a list of customers, Greg is on it.'],
    loot: [{ id: 'scrap', qty: 3 }, { id: 'battery', qty: 1 }],
    xp: 35,
  },
  // Act I: why the creek is dry, and where Tanner's water goes.
  {
    id: 'intel.highway.permit',
    title: 'County Clipboard — Permit 7-K',
    body:
      'COUNTY WATER DIVISION · GROUNDWATER EXTRACTION PERMIT 7-K<br>' +
      'Applicant: Kade Holdings LLC. Source: Dry Creek aquifer. Purpose: pilot program. Volume: as required. Term: perpetual.<br>' +
      'Consideration: construction of one (1) elementary school, Dry Creek, with signage.<br>' +
      'Approved: M. Voss, County Water Engineer.<br>' +
      'Clipped behind it, a page off a different notepad: <i>Creek down 40% since July. This is not a pilot. Somebody call M.</i>',
    position: [-236, 0, 96],
    reveals: ['lore.permit'],
    revealLines: ['M. Voss. That\'s Mara\'s signature. The creek didn\'t dry up. The county signed it away.'],
    xp: 40,
  },
  {
    id: 'intel.spur.valve',
    title: 'Valve Tag — Kade Line, Spur 3',
    body:
      'KADE HOLDINGS · WELLSPRING LINE · SPUR VALVE 3<br>' +
      'RESELLER ACCESS: BUNKR.LY (T. PIVOTSON)<br>' +
      'SETTLEMENT: WATER ONLY · QUOTA 40 JUGS/WK<br>' +
      'LATE PAYMENT FORFEITS WAITLIST POSITION · CURRENT POSITION 4,012<br>' +
      'Thank you for building the future with us!',
    position: [119, 0, -12],
    reveals: ['lore.valve'],
    revealLines: ['Tanner isn\'t keeping the water. He pays it to Kade Holdings, forty jugs a week, to hold his place in line.'],
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
      '~vesper created the group "LIFEBOAT"',
      '~vesper added hunter, ezra, prudence, orrin, kit',
      '~tanner joined via invite link',
      '~vesper removed tanner',
      '~tanner joined via invite link',
      'vesper: ok rules. no plus ones, no screenshots, no lawyers',
      'ezra: screenshots are kind of my whole company',
      'vesper: then no lawyers',
      'hunter: who keeps sharing the link',
    ),
    position: [-268, 0, 232],
    reveals: ['lore.lifeboat'],
    revealLines: ['A group chat. Founders, by the sound of it. Whoever owned this phone left in a hurry. Dez would want to see this.'],
    xp: 30,
  },
  {
    id: 'intel.chat.2', series: 'lifeboat', prop: 'tablet',
    title: 'Rugged Tablet — #LIFEBOAT, page 2 of 8',
    body: chat(
      'prudence: our model gives the grid 11 weeks. we published it',
      'hunter: can we sell it',
      'prudence: it\'s a paper hunter. nobody read it. nobody reads them',
      'orrin: fwiw I can still get anything to any bunker in 2 days. until about week 9',
      'kit: chips are the new water',
      'vesper: water is the new water. buy water',
    ),
    position: [-64, 0, -108],
    reveals: ['lore.lifeboat'],
    xp: 30,
  },
  {
    id: 'intel.chat.3', series: 'lifeboat', prop: 'tablet',
    title: 'Site Manager\'s Tablet — #LIFEBOAT, page 3 of 8',
    body: chat(
      'vesper: closed on 4 aquifers today. the dry creek one came with a school attached',
      'hunter: you bought a school??',
      'vesper: I gave them a school. rocket on the sign. they gave me a creek. the county signed it in an afternoon',
      'ezra: want a heat map of who gets thirsty first? I have everyone\'s location. always',
      'vesper: I have that ezra. it\'s called a map',
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
      'hunter: we can\'t call it a collapse. collapse is bad for the brand',
      'prudence: transition?',
      'orrin: sunset',
      'ezra: pivot. everybody forgives a pivot',
      'vesper: The Pivot. done. tanner stop reacting with the rocket',
      '~tanner reacted with a rocket',
    ),
    position: [252, 0, -64],
    reveals: ['lore.lifeboat', 'lore.pivotname'],
    revealLines: ['They had a name for it before it happened.'],
    xp: 30,
  },
  {
    id: 'intel.chat.5', series: 'lifeboat', prop: 'printout',
    title: 'Server Printout — #LIFEBOAT, page 5 of 8',
    body: chat(
      'hunter: EXIT is live. platinum gets an actual seat on an actual plane',
      'vesper: apex has 212 seats. 40 are ours. the rest is a waitlist',
      'tanner: can I resell the waitlist',
      'vesper: ...',
      'vesper: actually yes. pay me in water',
      'tanner: BUNKR.LY IS BACK',
    ),
    position: [262, 0, -228],
    reveals: ['lore.lifeboat'],
    revealLines: ['That\'s where Bunkr.ly came from. Vesper sold Tanner her waitlist, and he sold it on to everyone else.'],
    xp: 30,
  },
  {
    id: 'intel.chat.6', series: 'lifeboat', prop: 'pod',
    title: 'Seat-Back Screen — #LIFEBOAT, page 6 of 8',
    body: chat(
      'prudence: the spire is finished. every door asks an ethics question before it opens. the turrets apologise first',
      'kit: fortress has 9 months of chips and a moat full of coolant',
      'ezra: the panopticon has 1,100 cameras and every one of them is pointed at one of you',
      'ezra: relax it\'s a feature',
      'hunter: mine has wings',
      'vesper: yours has a pilot that\'s software, hunter',
    ),
    position: [296, 0, 142],
    reveals: ['lore.lifeboat', 'lore.panopticon'],
    revealLines: ['The Panopticon, the Alignment Spire, the Fortress. Every one of them built a bunker. Apex is just the next one.'],
    xp: 30,
  },
  {
    id: 'intel.chat.7', series: 'lifeboat', prop: 'watch',
    title: 'Smartwatch — #LIFEBOAT, page 7 of 8',
    body: chat(
      'prudence: grid at 4%. it\'s today',
      'ezra: I can see the whole highway from here. everyone\'s in the same jam. honestly it\'s kind of beautiful',
      'hunter: wheels up. don\'t wait for me',
      'vesper: nobody was waiting hunter',
      'orrin: deliveries paused indefinitely. we apologise for the inconvenience',
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
      '~Day 31',
      'prudence: please stop forwarding your camera feeds to the spire. our doors have started asking us questions',
      'ezra: you\'re all on my cameras. I\'m on mine too. I watch myself sleep. it helps',
      'vesper: hunter?',
      'vesper: hunter',
      '~hunter is unavailable',
      'tanner: is anyone still taking resellers',
      '~vesper removed tanner',
      'ezra: saw that',
    ),
    position: [138, 0, 160],
    reveals: ['lore.lifeboat', 'lore.panopticon'],
    revealLines: ['A Glimpse drone. It flew loops over the valley until the battery died, and somebody north of the salt was watching through it.'],
    xp: 30,
  },

  // ---------------------------------------------------------------- the valley's other paperwork
  {
    id: 'intel.kade.poster', prop: 'poster',
    title: 'Break-Room Poster — Kade Recovery',
    body:
      'WELCOME, RECOVERY ASSOCIATE! At Kade, you recover what was always ours.<br>' +
      'OUR VALUES: Ownership · Hydration · Ownership<br>' +
      'REMINDERS: Smile in your badge photo (it\'s policy). Water found in the field is Kade water until logged. ' +
      'Repossessed pianos are not break-room furniture. Bereavement leave is available after 12 months of continuous service.<br>' +
      '<i>People Ops, Kade Holdings · Water Is A Service™</i>',
    position: [240, 0, -130],
    revealLines: ['Somebody has drawn a moustache on the smiling associate.'],
    xp: 30,
  },
  {
    id: 'intel.glimpse.flyer', prop: 'flyer',
    title: 'Laminated Flyer — Glimpse Neighbourhood Watch',
    body:
      'GLIMPSE NEIGHBOURHOOD WATCH<br>This road is protected by four friendly cameras. Smile, you\'re already tagged! ' +
      'Not you? Glimpse is never wrong. Glimpse remembers, so you don\'t have to.<br>' +
      '<i>"Privacy was a phase. Safety is forever." Ezra Seymour, founder</i><br>' +
      'In pencil along the bottom: <i>the one by the gas station still blinks</i>',
    position: [66, 0, 74],
    reveals: ['lore.glimpse'],
    revealLines: ['A camera by the gas station. That\'s the camp.'],
    xp: 30,
  },
  {
    id: 'intel.careful.notice', prop: 'notice',
    title: 'Notice in a Sleeve — Careful Labs Field Team',
    body:
      'CAREFUL LABS · FIELD TEAM<br>If you are reading this at the 5G tower, you have found the wrong spire. ' +
      'Please do not look for the Alignment Spire. It is safe, it is helpful, and it would prefer not to meet you. ' +
      'Each of its doors will ask you one question about ethics. Its turrets are designed to apologise before engaging. ' +
      'We have thought very carefully about this so that you don\'t have to.<br><i>Dr. P. Ashby, Head of Safety</i><br>' +
      'Underneath, in marker: <i>who signed off on "turrets" and "apologise" in the same sentence</i>',
    position: [186, 0, 212],
    reveals: ['lore.spire'],
    revealLines: ['The Alignment Spire. Another bunker, somewhere past this one.'],
    xp: 30,
  },
  {
    id: 'intel.west.letter', prop: 'remains',
    title: 'Letter in a Zip Bag — The Walk West',
    body:
      'To whoever finds this. My name is Marcus Bell. I have a seat, Bunkr.ly confirmation 4471-B, Apex Vault, Economy Plus. ' +
      'They said the line moves faster if you\'re already standing in it so I walked. That was nine days ago. The water ran out on the seventh.<br>' +
      'The salt is very white. It hurts to look at.<br>' +
      'If you see my sister Dana tell her I went ahead to get us good spots. If you see Tanner tell him the tote bag was nice. I carried my water in it.<br>' +
      '<i>Marcus. Waitlist 88,301</i>',
    position: [-366, 0, 26],
    reveals: ['lore.walkwest'],
    revealLines: ['People set out for Apex on foot with Bunkr.ly receipts. Not all of them got there.'],
    loot: [{ id: 'water', qty: 1 }, { id: 'scrap', qty: 2 }],
    xp: 40,
  },
  {
    id: 'intel.tanner.update', prop: 'update',
    title: 'Investor Update #161 — Bunkr.ly',
    body:
      'Subject: Bunkr.ly Investor Update #161<br>Hi friends!<br>' +
      'HIGHLIGHTS: SeedBot battery health is up to 12% (from 11%!). We remain post-apocalypse and pre-revenue, which honestly is a great place to be.<br>' +
      'LOWLIGHTS: A camp.<br>' +
      'WAITLIST: Position 4,012 (from 4,009). The line is healthy and liquid.<br>' +
      'ASKS: Water. A warm intro to Vesper. A lawyer who accepts jugs.<br>' +
      'As always, build the future, then sit in it.<br><i>Tanner</i>',
    position: [110, 0, -38],
    revealLines: ['He still sends one every Monday. Nobody has opened one in three years.'],
    xp: 30,
  },
  {
    id: 'intel.kdry.log', prop: 'radio',
    title: 'Station Log — KDRY 1340 AM, the afternoon of',
    body:
      '14:02 Markets halted. Read the numbers anyway.<br>' +
      '14:09 Grid frequency dropping. Studio lights flickering.<br>' +
      '14:20 Sky a colour I don\'t have a word for. Told listeners to stay in.<br>' +
      '14:31 Kade Holdings cancelled the 2:30 spot.<br>' +
      '14:32 Played a record in the slot.<br>' +
      '14:40 Phone lines down. Talking to whoever\'s still out there.<br>' +
      '15:15 Man came in asking what a "pivot" is. Heard the word on a call. Didn\'t know what to tell him.<br>' +
      '17:50 Genny still running. Probably nobody listening. Doing it anyway. Signing off after the last song. <i>R. Varga</i>',
    position: [-224, 0, -14],
    reveals: ['lore.kdry'],
    revealLines: ['R. Varga. Sol\'s surname is Varga.'],
    xp: 35,
  },
  {
    id: 'intel.kade.kids', prop: 'brochure',
    title: 'Brochure — Kade Kids Academy',
    body:
      'KADE KIDS ACADEMY · DRY CREEK<br>A School Built on the Future!<br>' +
      'Every student receives a rocket backpack and a lifetime refillable bottle (refill at any Kade Spring™ station, terms apply). ' +
      'This year\'s class will bury a time capsule to be opened in 2046, when Dry Creek will be a thriving Kade community with 100% managed water.<br>' +
      'Ask about our Parent Ambassador program!<br><i>A gift from Kade Holdings, in partnership with the County Water Division.</i>',
    position: [-300, 0, 14],
    reveals: ['lore.kadekids'],
    revealLines: ['"100% managed water." They printed that in the brochure.'],
    xp: 30,
  },
  // Act II: the way to Apex Vault, and the way into it.
  {
    id: 'intel.salt.waybill',
    title: 'Waybill — Kade Line, West',
    body:
      'KADE HOLDINGS · PRIVATE ROAD WEST · WAYBILL<br>' +
      'Consignee: APEX VAULT (V. Kade). Cargo: 40 jugs, "community contribution".<br>' +
      'Route: leave the highway at the west end, south past Dry Creek, then along the salt. Do NOT cross the salt in daylight. The glare is bad.<br>' +
      'Dispatch remarks: <i>Driver walked. Truck stayed. Jugs stayed. V. posted about it.</i>',
    position: [-318, 0, -150],
    reveals: ['apex.marker'],
    revealLines: ['Apex Vault is on the map, at the foot of the range on the salt\'s west shore. Her road leaves the highway at its west end.'],
    xp: 45,
  },
  {
    id: 'intel.apex.shift',
    title: 'Shift Note — Apex Gatehouse',
    body:
      'R —<br>she changed the airlock code AGAIN. new system: the code is the launch clock over the door. hours and minutes, T-minus. ' +
      'it counts down so it\'s never the same twice. she calls it "zero trust". I call it my knees. just read the clock and punch it in.<br>' +
      'don\'t tell the camps. don\'t tell Tanner. don\'t look at the camera over the hangar, it posts you.<br>' +
      'also whoever keeps smoking in the vent on the east side of the hill: that duct goes straight into the launch corridor, past the lasers. I can smell it in there. stop.<br><i>D</i>',
    position: [-352, 0, -100],
    reveals: ['apex.code', 'apex.marker', 'apex.vent'],
    revealLines: ['The airlock code is the launch clock over the door: hours and minutes, counting down.', 'A vent on the hill\'s east side drops into the launch corridor, past two of the laser beams.'],
    xp: 50,
  },
  // Act II → Tier 3: on Vesper's cot in the Cistern Room
  {
    id: 'intel.apex.memo',
    title: 'Memo — Re: Your Guests',
    body:
      'FROM: Office of the Founder, The Panopticon<br>TO: V. Kade<br>RE: Your guests<br>' +
      'Attached: every face to cross your apron since Pivot Day, matched, timestamped and ranked by likelihood of becoming content. Camp affiliations included. ' +
      'Your water for our data, as discussed.<br>' +
      'P.S. We can see whoever is reading this. Hi. We\'re always listening. We call that a feature.',
    position: [-380.5, 0, -159.5],
    reveals: ['lore.panopticon'],
    revealLines: ['Somebody on the old coast, north of the salt, sends Vesper a file on every face at her door, and she pays in water. The memo says hi to whoever found it.'],
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
