import type { PersonId, SkillId } from './types';

/**
 * Quests are data. Every step completes from game flags (and, rarely, items), so the same
 * function answers "is this done" for a fresh run, a loaded save and a migrated v2 save.
 *
 * Runtime (src/game/Story.ts) stores progress as flags too:
 *   `q:<quest>` started · `q:<quest>:<step>` step seen done · `q:<quest>:done` rewarded.
 *
 * Map sites (jet, drivein, datacenter, tube) are built elsewhere. Their quests only read the three
 * flags every site promises: `seen:<id>` (within ~40 m), `site.<id>.found` (reached its heart),
 * `site.<id>.done` (its main secret is out).
 */
export interface QuestView {
  has: (flag: string) => boolean;
  rep: (id: PersonId) => number;
  count: (item: string) => number;
  skill: (id: SkillId) => number;
}

export interface QuestReward {
  xp: number;
  items?: { id: string; qty: number }[];
  rep?: Partial<Record<PersonId, number>>;
}

export interface QuestStep {
  id: string;
  text: string;
  hint?: string;
  done: (v: QuestView) => boolean;
  /** Shown, never blocks completion. */
  optional?: boolean;
  /** Not reachable in this build (the Act II road). Shown as a teaser, never "current". */
  locked?: boolean;
  /** Landmark id (or 'garage', or a Kade outpost id) the tracked quest marks on the map. */
  at?: string;
}

export interface QuestOutcome {
  flag: string;
  /** Past tense, one line: what you chose. */
  label: string;
  /** What it led to. Shown in the journal once the quest is done. */
  text: string;
  reward: QuestReward;
}

export interface QuestDef {
  id: string;
  kind: 'main' | 'side';
  title: string;
  giver: PersonId;
  where: string;
  blurb: string;
  start: (v: QuestView) => boolean;
  steps: QuestStep[];
  /** If present, the quest ends on whichever outcome flag is set (the last step checks for them). */
  outcomes?: QuestOutcome[];
  reward?: QuestReward;
  /** Said over the radio (or by you) when it completes. */
  wrap?: { speaker: string; text: string };
}

/** True if any flag is set. Main-story steps also count as done once a later one is, so a skipped note never blocks Act I. */
const any = (v: QuestView, ...flags: string[]) => flags.some((f) => v.has(f));
const CREW = ['crew.nia', 'crew.doc', 'crew.inez', 'crew.sol', 'crew.ren', 'crew.wick'];

export const QUESTS: QuestDef[] = [
  // ------------------------------------------------------------------ main
  {
    id: 'act1',
    kind: 'main',
    title: 'Act I · The Cistern',
    giver: 'mara',
    where: 'Last Chance → The Garage',
    blurb:
      'Last Chance has about three days of water. Tanner Pivotson\'s drone has been lifting the camp\'s jugs off the highway. Mara wants his cistern, and the ledger in his vault he calls the Seed Manifest.',
    start: (v) => v.has('briefed'),
    steps: [
      {
        id: 'note', text: 'Read the note on the pump island', at: 'gas',
        hint: 'By the dead pumps at Last Chance, a few steps from the fire. The cooler behind them still has water in it.',
        done: (v) => v.has('intel:intel.gas.note') || v.has('seen:garage') || v.has('garage.complete'),
      },
      {
        id: 'garage', text: 'Find the Garage', at: 'garage',
        hint: 'Northeast of camp, up the dirt spur off the highway. Neon, razor wire, and a man with a megaphone.',
        done: (v) => any(v, 'seen:garage', 'garage.gate.open', 'garage.gap.open', 'garage.complete'),
      },
      {
        id: 'fence', text: 'Get past the fence', at: 'garage',
        hint: 'Pick the gate padlock, blow it, talk Tanner into opening it on the intercom, or find the loose panel the Spire blueprint mentions.',
        done: (v) => any(v, 'garage.gate.open', 'garage.gap.open', 'garage.side.open', 'garage.vault.open', 'garage.complete'),
      },
      {
        id: 'vault', text: 'Open the Runway Room', at: 'garage',
        hint: 'Inside, past the laser hall. Five pins, a keypad with an "obvious" code, or a charge at Demolition 5.',
        done: (v) => any(v, 'garage.vault.open', 'garage.complete'),
      },
      {
        id: 'loot', text: 'Take the water and the Seed Manifest', at: 'garage',
        hint: 'The safe and both crates in the vault. The water comes with you even if the pack complains.',
        done: (v) => v.has('garage.complete'),
      },
      {
        id: 'who', text: 'Find out who Tanner pays', optional: true, at: 'garage',
        hint: 'Ask him on the intercom (Social 2), or read the valve tag on the dirt spur below the Garage.',
        done: (v) => any(v, 'tanner.kade', 'lore.valve'),
      },
      {
        id: 'permit', text: 'Find out why Dry Creek is dry', optional: true,
        hint: 'A county clipboard on the highway, west of camp. Doc Ivers remembers that summer too, if you ask him.',
        done: (v) => any(v, 'lore.permit', 'creek.doc.permit'),
      },
      {
        id: 'debrief', text: 'Radio Mara from the campfire', at: 'gas',
        hint: 'Back at Last Chance, open the camp and raise Mara. She wants the names read out loud.',
        done: (v) => any(v, 'act1.broadcast', 'act1.leverage', 'act1.deal'),
      },
    ],
    outcomes: [
      {
        flag: 'act1.broadcast',
        label: 'You read every name on the open net.',
        text: 'Every camp on the band heard who sold them. Vesper closed the spur valve in reply. The cistern has about two weeks in it, and for once every camp is angry at the same person.',
        reward: { xp: 150, items: [{ id: 'charge', qty: 1 }, { id: 'emp', qty: 1 }], rep: { compact: 3, creek: 1, mara: 1, vesper: -2 } },
      },
      {
        flag: 'act1.leverage',
        label: 'You kept the ledger quiet, and let Vesper pay for the silence.',
        text: 'Vesper sent a drone drop and called it a free trial. Mara keeps the ledger in the ammo tin under the radio. When the trial runs out, the camp goes west.',
        reward: { xp: 150, items: [{ id: 'water', qty: 6 }, { id: 'medkit', qty: 2 }], rep: { compact: 1, vesper: 1 } },
      },
      {
        flag: 'act1.deal',
        label: 'You sent the ledger back for her water.',
        text: 'Twenty jugs a week, "forever-ish". The camp drinks, and Mara hates it every time. Nobody believes the jugs will keep coming.',
        reward: { xp: 120, items: [{ id: 'water', qty: 10 }, { id: 'ration', qty: 3 }], rep: { vesper: 2, compact: -1, mara: -2 } },
      },
    ],
    wrap: { speaker: 'Mara Voss', text: 'That\'s Act I. The camp drinks tonight. Tomorrow we start walking west.' },
  },
  {
    id: 'act2',
    kind: 'main',
    title: 'Act II · Apex Vault',
    giver: 'mara',
    where: 'West of the salt',
    blurb:
      'Apex Vault is west of the salt flats, and it holds what is left of the valley\'s water. The road isn\'t open yet. Until it is, find out who would walk it with you.',
    start: (v) => v.has('debriefed'),
    steps: [
      {
        id: 'crew', text: 'Ask Dry Creek who would come west', at: 'creek',
        hint: 'Anyone who trusts you (standing 2 or more) will say yes. Finish their favours first.',
        done: (v) => CREW.some((f) => v.has(f)),
      },
      {
        id: 'crew2', text: 'Find a second pair of hands', optional: true, at: 'creek',
        hint: 'Two people who trust you beat one who trusts you a lot.',
        done: (v) => CREW.filter((f) => v.has(f)).length >= 2,
      },
      {
        id: 'road', text: 'Reach Apex Vault, west of the salt', locked: true,
        hint: 'Not on this map yet. Act II is coming.',
        done: () => false,
      },
    ],
  },

  // ------------------------------------------------------------------ Dry Creek
  {
    id: 'nia.short',
    kind: 'side',
    title: 'Two Bottles Short',
    giver: 'nia',
    where: 'Dry Creek · the diner',
    blurb: 'Somebody is taking water from under Nia\'s counter, two bottles at a time. She keeps a ledger, and the ledger is upset.',
    start: (v) => v.has('creek.talk.nia'),
    steps: [
      {
        id: 'who', text: 'Find out who is taking Nia\'s water', at: 'creek',
        hint: 'Sol keeps the street fire at night and sees who walks past. Or ask Doc straight out (Social 2).',
        done: (v) => v.has('q.nia.who'),
      },
      {
        id: 'tell', text: 'Decide what Nia hears', at: 'creek',
        hint: 'Talk to Nia. Tell her the truth, cover for him with two bottles of your own, or sit them both down (Social 3).',
        done: (v) => any(v, 'q.nia.told', 'q.nia.covered', 'q.nia.peace'),
      },
    ],
    outcomes: [
      {
        flag: 'q.nia.told',
        label: 'You told Nia it was Doc.',
        text: 'Nia had words with Doc. Loud ones. Her ledger balances again, and there\'s a plate at the counter with your name on it: a free meal every time you\'ve rested.',
        reward: { xp: 60, items: [{ id: 'ration', qty: 2 }], rep: { nia: 2, doc: -1 } },
      },
      {
        flag: 'q.nia.covered',
        label: 'You covered for Doc with two bottles of your own.',
        text: 'Nia\'s ledger balances and she never found out. Doc did. He makes house calls for you now: patched up every time you\'ve rested, not just once.',
        reward: { xp: 60, items: [{ id: 'medkit', qty: 1 }], rep: { doc: 2 } },
      },
      {
        flag: 'q.nia.peace',
        label: 'You sat them both down.',
        text: 'Doc needed the water for the clinic\'s sterilizer and was too proud to ask. Now Nia stores it for him, in writing. You get the plate and the house calls. They both owe you, and they both hate that.',
        reward: { xp: 90, items: [{ id: 'ration', qty: 1 }, { id: 'medkit', qty: 1 }], rep: { nia: 1, doc: 1, creek: 1 } },
      },
    ],
  },
  {
    id: 'doc.cough',
    kind: 'side',
    title: 'The Cough on the Ridge',
    giver: 'doc',
    where: 'Dry Creek · the clinic → the Cut',
    blurb: 'Wick has a cough Doc can hear from the clinic. Wick won\'t come down. Doc has a medkit, and no knees left for that wash.',
    start: (v) => v.has('creek.talk.doc'),
    steps: [
      {
        id: 'power', text: 'Get the clinic\'s power back', at: 'creek',
        hint: 'The generator on the clinic\'s east side wants Electronics 1. Or hand Doc a lithium cell and let him swear at it himself.',
        done: (v) => v.has('creek.power'),
      },
      {
        id: 'kit', text: 'Pick up Doc\'s medkit', at: 'creek',
        hint: 'Talk to Doc once his window is lit.',
        done: (v) => v.has('q.doc.kit'),
      },
      {
        id: 'wick', text: 'Get the medkit to Wick, or don\'t', at: 'cave',
        hint: 'The Cut is south of the Spire, up the posted wash. Wick sits by his fire.',
        done: (v) => any(v, 'q.doc.delivered', 'q.doc.kept'),
      },
    ],
    outcomes: [
      {
        flag: 'q.doc.delivered',
        label: 'You gave Wick the medkit.',
        text: 'Wick coughed, complained, and used it. Then he told you what he can see from the ridge. Doc has stopped glaring at the hills.',
        reward: { xp: 70, items: [{ id: 'water', qty: 2 }], rep: { wick: 2, doc: 1 } },
      },
      {
        flag: 'q.doc.kept',
        label: 'You kept the medkit.',
        text: 'You told Wick that Doc says hello, and kept the kit. Wick said hello back. Doc found out. Doctors always find out.',
        reward: { xp: 20, rep: { doc: -1, wick: -1 } },
      },
    ],
  },
  {
    id: 'inez.deed',
    kind: 'side',
    title: 'Whose Till Is It?',
    giver: 'inez',
    where: 'Dry Creek · the Till',
    blurb: 'The Till\'s landlord left before the Pivot and never came back. Inez runs the place like she owns it. Somewhere up the stair, a deed says who actually does.',
    start: (v) => any(v, 'creek.talk.inez', 'creek.loft'),
    steps: [
      {
        id: 'stair', text: 'Get up the Till\'s stair', at: 'creek',
        hint: 'The "closet" behind the counter is a stair. Lockpicking 3, a charge at Demolition 2, or talk Inez into admitting she has the key (Social 4).',
        done: (v) => v.has('creek.stair'),
      },
      {
        id: 'loft', text: 'Find what the landlord left', at: 'creek',
        hint: 'The shelf in the loft, at the top of the stair.',
        done: (v) => v.has('creek.loft'),
      },
      {
        id: 'give', text: 'Give the deed to Inez, or to the town', at: 'creek',
        hint: 'Inez at the Till, or Nia at the diner, who keeps the town\'s papers.',
        done: (v) => any(v, 'q.inez.inez', 'q.inez.town'),
      },
    ],
    outcomes: [
      {
        flag: 'q.inez.inez',
        label: 'You gave Inez the deed.',
        text: 'Inez owns the Till now, legally, in pencil. She gave you the good prices (a bottle for 2 scrap) and a look you\'d call grateful if it were anyone else.',
        reward: { xp: 70, items: [{ id: 'battery', qty: 1 }, { id: 'lockpick', qty: 2 }], rep: { inez: 2, creek: -1 } },
      },
      {
        flag: 'q.inez.town',
        label: 'You gave the deed to the town.',
        text: 'Nia pinned it to the diner wall. The Till belongs to Dry Creek now. Inez opened the back room to everyone, then raised your price to 4 scrap a bottle, out of spite.',
        reward: { xp: 70, items: [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }, { id: 'medkit', qty: 1 }], rep: { creek: 2, nia: 1, inez: -1 } },
      },
    ],
  },
  {
    id: 'sol.roll',
    kind: 'side',
    title: 'Sol\'s Roll',
    giver: 'sol',
    where: 'Dry Creek · the motel',
    blurb: 'Sol left his pick roll in motel room 2, then locked himself out. Thirty years a locksmith. He would like this kept between the two of you.',
    start: (v) => v.has('creek.talk.sol'),
    steps: [
      {
        id: 'room', text: 'Open motel room 2', at: 'creek',
        hint: 'The middle door at the motel. Three pins, Lockpicking 1.',
        done: (v) => v.has('creek.motel.b'),
      },
      {
        id: 'roll', text: 'Find Sol\'s roll', at: 'creek',
        hint: 'Search the room once the door is open.',
        done: (v) => v.has('creek.motel.b.loot'),
      },
      {
        id: 'give', text: 'Give it back, or keep it', at: 'creek',
        hint: 'Sol is at the street fire. Or use the roll from your kit for five picks.',
        done: (v) => any(v, 'q.sol.returned', 'q.sol.kept'),
      },
    ],
    outcomes: [
      {
        flag: 'q.sol.returned',
        label: 'You gave Sol his roll.',
        text: 'Sol checked every pick twice and did not cry. Then he showed you how to bend a better one: the camp\'s pick recipe makes 3 now.',
        reward: { xp: 60, items: [{ id: 'lockpick', qty: 2 }], rep: { sol: 2 } },
      },
      {
        flag: 'q.sol.kept',
        label: 'You kept the roll.',
        text: 'Five good picks, and a locksmith at the street fire who knows exactly whose hands they\'re in.',
        reward: { xp: 30, rep: { sol: -1 } },
      },
    ],
  },
  {
    id: 'ren.screening',
    kind: 'side',
    title: 'The Last Screening',
    giver: 'ren',
    where: 'Dry Creek → Starlite Drive-In',
    blurb: 'Ren ran the projector at the Starlite Drive-In. The last screening was a keynote. Ren walked out before the end, and nobody else ever came out. Ren would like to know how it ended.',
    start: (v) => any(v, 'creek.talk.ren', 'seen:drivein'),
    steps: [
      {
        id: 'find', text: 'Find the Starlite Drive-In', at: 'drivein',
        hint: 'North of the highway, between Dry Creek and the Garage. Look for a screen the size of a building.',
        done: (v) => v.has('seen:drivein'),
      },
      {
        id: 'inside', text: 'Get to the heart of the drive-in', at: 'drivein',
        hint: 'Whatever is left of the screening. Walk in and look around.',
        done: (v) => v.has('site.drivein.found'),
      },
      {
        id: 'end', text: 'Find out how the keynote ended', at: 'drivein',
        hint: 'Something there still has the last word.',
        done: (v) => v.has('site.drivein.done'),
      },
      {
        id: 'tell', text: 'Tell Ren, or spare them', at: 'creek',
        hint: 'Ren sits by the road in Dry Creek.',
        done: (v) => any(v, 'q.ren.truth', 'q.ren.spare'),
      },
    ],
    outcomes: [
      {
        flag: 'q.ren.truth',
        label: 'You told Ren how it ended.',
        text: 'Ren listened to all of it without blinking, then laughed for the first time in two years. In the morning Ren started walking to Last Chance. The camp has a lookout now.',
        reward: { xp: 90, items: [{ id: 'ration', qty: 1 }, { id: 'water', qty: 2 }], rep: { ren: 2, compact: 1 } },
      },
      {
        flag: 'q.ren.spare',
        label: 'You told Ren it was static.',
        text: 'Ren nodded like they believed you. Maybe they did. They gave you the projector\'s last cells and went back to counting the road.',
        reward: { xp: 60, items: [{ id: 'battery', qty: 2 }], rep: { ren: 1 } },
      },
    ],
  },
  {
    id: 'wick.pocket',
    kind: 'side',
    title: 'Prototype Adjacent',
    giver: 'wick',
    where: 'The Cut',
    blurb: 'Vesper Kade stood in Wick\'s cave once, priced it, and left a crate behind the rockfall with her initials on it. Wick would like to know what she thinks she left.',
    start: (v) => v.has('creek.talk.wick'),
    steps: [
      {
        id: 'rocks', text: 'Get past the rockfall in the side passage', at: 'cave',
        hint: 'A charge at Demolition 2. Or ask Wick to help you shift it by hand (Survival 3 or Social 3).',
        done: (v) => v.has('cave.pocket'),
      },
      {
        id: 'crate', text: 'Decide what happens to Vesper\'s crate', at: 'cave',
        hint: 'Take it, or leave it for Wick.',
        done: (v) => any(v, 'q.wick.took', 'q.wick.left'),
      },
    ],
    outcomes: [
      {
        flag: 'q.wick.took',
        label: 'You took Vesper\'s crate.',
        text: 'Water, cells, scrap. Wick watched you carry it out and said nothing, which from Wick is a paragraph.',
        reward: { xp: 40, rep: { wick: -1 } },
      },
      {
        flag: 'q.wick.left',
        label: 'You left the crate for Wick.',
        text: 'Wick painted over her initials with his own. The seep at the back of the cave is yours too now: a bottle every time you\'ve rested.',
        reward: { xp: 70, rep: { wick: 2 } },
      },
    ],
  },

  // ------------------------------------------------------------------ the camp
  {
    id: 'pip.ledger',
    kind: 'side',
    title: 'Fill the Ledger',
    giver: 'pip',
    where: 'Last Chance',
    blurb: 'Pip keeps the camp\'s water ledger. Every bottle you bring home goes in the good column. Every bottle you drink on the road goes in a column Pip refuses to name.',
    start: (v) => v.has('briefed'),
    steps: [
      {
        id: 'first', text: 'Give Pip two bottles for the camp', at: 'gas',
        hint: 'At the campfire, open the camp and talk to Pip.',
        done: (v) => v.has('q.pip.1'),
      },
      {
        id: 'second', text: 'Give Pip two more', at: 'gas',
        hint: 'Garages, freezers and generous people all have bottles.',
        done: (v) => v.has('q.pip.2'),
      },
    ],
    reward: { xp: 60, items: [{ id: 'noisemaker', qty: 2 }, { id: 'charge', qty: 1 }], rep: { pip: 2, compact: 2 } },
    wrap: { speaker: 'Hollis Grange', text: 'Kid gave you a whole page. Here, take my road kit. Don\'t tell her I cried.' },
  },

  // ------------------------------------------------------------------ the map's other doors
  {
    id: 'site.jet',
    kind: 'side',
    title: 'The Exit Strategy',
    giver: 'wick',
    where: 'The dunes, southwest',
    blurb: 'The week of the Pivot, Wick watched a private jet try to leave. It came down in the dunes to the southwest. Somebody bought an exit strategy, and the desert sent it back.',
    start: (v) => any(v, 'wick.jet', 'seen:jet'),
    steps: [
      {
        id: 'find', text: 'Find the jet in the dunes', at: 'jet',
        hint: 'Southwest of Last Chance, out in the dunes. Look for a tail fin in the sand.',
        done: (v) => v.has('seen:jet'),
      },
      {
        id: 'inside', text: 'Get aboard', at: 'jet',
        hint: 'Find the way into the wreck.',
        done: (v) => v.has('site.jet.found'),
      },
      {
        id: 'secret', text: 'Find out what the founder was running from', at: 'jet',
        hint: 'Whatever they packed for the end of the world is still aboard.',
        done: (v) => v.has('site.jet.done'),
      },
    ],
    reward: { xp: 100, items: [{ id: 'scrap', qty: 3 }], rep: { wick: 1 } },
    wrap: { speaker: 'Mara Voss', text: 'A founder tried to leave early and the desert said no. Write it down. Leaving early was always the whole plan.' },
  },
  {
    id: 'site.datacenter',
    kind: 'side',
    title: 'Still Warm',
    giver: 'mara',
    where: 'ColdStorage, far northeast',
    blurb: 'Mara wants to know why ColdStorage is still warm. A data centre that\'s warm is drawing power, and out here, power means somebody is still paying for it.',
    start: (v) => any(v, 'mara.coldstorage', 'seen:datacenter'),
    steps: [
      {
        id: 'find', text: 'Find ColdStorage', at: 'datacenter',
        hint: 'Far northeast, past the Garage. A long white building that hums.',
        done: (v) => v.has('seen:datacenter'),
      },
      {
        id: 'inside', text: 'Get inside', at: 'datacenter',
        hint: 'Find a way into the server halls.',
        done: (v) => v.has('site.datacenter.found'),
      },
      {
        id: 'secret', text: 'Find out what is still running', at: 'datacenter',
        hint: 'Follow the warmth.',
        done: (v) => v.has('site.datacenter.done'),
      },
    ],
    reward: { xp: 110, items: [{ id: 'battery', qty: 2 }], rep: { mara: 1, compact: 1 } },
    wrap: { speaker: 'Mara Voss', text: 'So something in there still runs. Running means paying. I want to know who signs those bills.' },
  },
  {
    id: 'site.tube',
    kind: 'side',
    title: 'Refund Policy',
    giver: 'inez',
    where: 'The Tube, east of the Spire',
    blurb: 'Before the Pivot, Inez sold forty tickets for the hyperloop out east. Nobody asked for a refund, because nobody ever arrived. She\'d like to know whether she owes anybody.',
    start: (v) => any(v, 'inez.tube', 'seen:tube'),
    steps: [
      {
        id: 'find', text: 'Find the Tube', at: 'tube',
        hint: 'East of the Spire. A long silver pipe on legs, going nowhere fast.',
        done: (v) => v.has('seen:tube'),
      },
      {
        id: 'inside', text: 'Get into the test track', at: 'tube',
        hint: 'Find the way in.',
        done: (v) => v.has('site.tube.found'),
      },
      {
        id: 'secret', text: 'Find out how fast it ever went', at: 'tube',
        hint: 'Somebody kept the records.',
        done: (v) => v.has('site.tube.done'),
      },
    ],
    reward: { xp: 90, items: [{ id: 'scrap', qty: 4 }], rep: { inez: 1 } },
    wrap: { speaker: 'You', text: 'Forty tickets to nowhere. I\'ll tell Inez she can stop worrying about refunds.' },
  },

  // ------------------------------------------------------------------ the road's other favours
  // Props and interactions: sites/courier.ts (the Last Mile), sites/errands.ts (relay, stakes, field
  // book). Talk: content/camp.ts (Hollis, Dez), town/Settlement.ts (Nia, Wick).
  {
    id: 'hollis.rider',
    kind: 'side',
    title: 'Ten Minutes or Free',
    giver: 'hollis',
    where: 'Last Chance → the north flats → Dry Creek',
    blurb: 'Rider 9 delivered for Dropt ("anything, anywhere, ten minutes or it\'s free") and never stopped, because the app never told him to. He checked in on Hollis\'s CB every week for two years. He has missed four.',
    start: (v) => any(v, 'hollis.rider', 'seen:courier'),
    steps: [
      {
        id: 'find', text: 'Find Rider 9\'s last stop', at: 'courier',
        hint: 'His last call came from the north flats, past the Kade Wellhead. Look for an orange flag on a whip.',
        done: (v) => any(v, 'seen:courier', 'q.rider.log'),
      },
      {
        id: 'log', text: 'Read his delivery log', at: 'courier',
        hint: 'His phone is still on. Of course it is.',
        done: (v) => v.has('q.rider.log'),
      },
      {
        id: 'deliver', text: 'Deliver his last order', at: 'creek',
        hint: 'A stove igniter for Nia Pell at the Dry Creek diner. She is behind the counter.',
        done: (v) => v.has('q.rider.delivered'),
      },
      {
        id: 'tell', text: 'Tell Hollis', at: 'gas',
        hint: 'At the camp fire. Say it straight, or say it kind.',
        done: (v) => any(v, 'q.rider.truth', 'q.rider.west'),
      },
    ],
    outcomes: [
      {
        flag: 'q.rider.truth',
        label: 'You told Hollis how Rider 9 ended.',
        text: 'Hollis stood by the sign for an hour. In the morning he handed you his last box of .38s and said the kid never dropped an order in his life. Channel 19 is quiet now. He leaves it on anyway.',
        reward: { xp: 90, items: [{ id: 'ammo38', qty: 12 }, { id: 'ration', qty: 1 }], rep: { hollis: 2, compact: 1 } },
      },
      {
        flag: 'q.rider.west',
        label: 'You told Hollis that Rider 9 rode west.',
        text: 'Hollis smiled like he believed it, and keeps channel 19 open for the day a bell rings on it. Pip watched your face the whole time and wrote something down.',
        reward: { xp: 70, items: [{ id: 'ammo38', qty: 8 }], rep: { hollis: 1 } },
      },
    ],
    wrap: { speaker: 'Hollis Grange', text: 'Ten minutes or free. Kid made it free every time.' },
  },
  {
    id: 'dez.badges',
    kind: 'side',
    title: 'Badge Access',
    giver: 'dez',
    where: 'Last Chance → the Spire',
    blurb: 'Kade crews read their badge numbers onto the air at every shift change, because the policy says so. Dez thinks the lanyards talk on a channel of their own. He needs three to find it, and somewhere high to listen from.',
    start: (v) => v.has('briefed') && (v.has('dez.badges') || v.count('kade_badge') > 0),
    steps: [
      {
        id: 'badges', text: 'Bring Dez three Recovery Lanyards', at: 'gas',
        hint: 'Kade contractors wear them, and Kade crates sometimes hold a spare. Dez is at the camp fire.',
        done: (v) => v.has('q.dez.badges'),
      },
      {
        id: 'relay', text: 'Patch Dez\'s relay into the Spire', at: 'spire',
        hint: 'The fallen 5G tower, northeast of camp. Its generator by the shack still runs. Red to red.',
        done: (v) => v.has('q.dez.relay'),
      },
      {
        id: 'listen', text: 'Listen in with Dez', at: 'gas',
        hint: 'Back at the fire. Dez has the headphones warm.',
        done: (v) => any(v, 'q.dez.ears', 'q.dez.karaoke'),
      },
    ],
    outcomes: [
      {
        flag: 'q.dez.ears',
        label: 'You kept quiet and listened.',
        text: 'Dez sits on Kade\'s crew channel now. When a road pair clocks in near you, he calls it on the radio before they ever see you.',
        reward: { xp: 90, items: [{ id: 'emp', qty: 1 }], rep: { dez: 2, compact: 1 } },
      },
      {
        flag: 'q.dez.karaoke',
        label: 'You played the karaoke machine into their channel.',
        text: 'Four minutes of a power ballad on every Kade radio in the valley. HR opened a ticket. Kade changed channels by morning, and Dez has never been happier.',
        reward: { xp: 80, items: [{ id: 'emp', qty: 2 }, { id: 'battery', qty: 1 }], rep: { dez: 2, pip: 1 } },
      },
    ],
    wrap: { speaker: 'Dez Marlow', text: 'Badge access granted. To us. Nobody tell HR.' },
  },
  {
    id: 'wick.survey',
    kind: 'side',
    title: 'Survey Says',
    giver: 'wick',
    where: 'The Cut → Kade Survey Camp',
    blurb: 'Men in white hard hats came up the wash with a tripod and tied orange tape to Wick\'s ridge. Wick would like the tape gone, and he would like to know what they think they measured.',
    start: (v) => v.has('wick.survey'),
    steps: [
      {
        id: 'stakes', text: 'Pull Kade\'s three survey stakes', at: 'survey',
        hint: 'Orange tape on pale stakes, strung up the slope from the Kade Survey Camp toward the Cut. Mind the camp.',
        done: (v) => STAKES.every((f) => v.has(f)),
      },
      {
        id: 'book', text: 'Take the field book from the Kade Survey Camp', at: 'survey',
        hint: 'Three tents and a theodolite, west of the wash. The book is on the folding table by the tripod. Quietly, or not.',
        done: (v) => v.has('q.wick.book'),
      },
      {
        id: 'back', text: 'Show Wick what they measured', at: 'cave',
        hint: 'Wick sits by his fire in the Cut.',
        done: (v) => any(v, 'q.wick.burned', 'q.wick.kept'),
      },
    ],
    outcomes: [
      {
        flag: 'q.wick.burned',
        label: 'You let Wick burn the field book.',
        text: 'Wick read every page, then fed them to his fire one at a time, slowly, like a man eating something good. The seep is still his. Kade will have to measure it again, and he\'ll be waiting.',
        reward: { xp: 80, items: [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }], rep: { wick: 2 } },
      },
      {
        flag: 'q.wick.kept',
        label: 'You kept the field book for Mara.',
        text: 'Wick let you take it, eventually. Mara read the numbers on the radio twice and went quiet. Kade isn\'t surveying the ridge. They\'re surveying what\'s under it.',
        reward: { xp: 90, items: [{ id: 'battery', qty: 1 }, { id: 'ammo3030', qty: 6 }], rep: { mara: 1, compact: 1, wick: 1 } },
      },
    ],
    wrap: { speaker: 'Wick', text: 'Orange tape. On my ridge. Like it was a present.' },
  },
];

/** The Survey Says stakes (sites/errands.ts places them). */
export const STAKES = ['q.wick.stake.a', 'q.wick.stake.b', 'q.wick.stake.c'];

export const QUEST = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<string, QuestDef>;

/** Flags that mean the quest's ending has been chosen (or, with no outcomes, every step is done). */
export function questComplete(q: QuestDef, v: QuestView): boolean {
  if (q.steps.some((s) => s.locked)) return false;
  const required = q.steps.filter((s) => !s.optional);
  if (!required.every((s) => s.done(v))) return false;
  return !q.outcomes || q.outcomes.some((o) => v.has(o.flag));
}

export function questOutcome(q: QuestDef, v: QuestView): QuestOutcome | null {
  return q.outcomes?.find((o) => v.has(o.flag)) ?? null;
}

/** The first required step that isn't done (and isn't a locked teaser). Null when nothing is left to do. */
export function currentStep(q: QuestDef, v: QuestView): QuestStep | null {
  return q.steps.find((s) => !s.optional && !s.done(v)) ?? null;
}

/**
 * Standing favours: permanent effects of finished quests. Read by Settlement (talk options),
 * State (recipes) and the camp.
 */
export function favours(v: { has: (f: string) => boolean }) {
  return {
    /** Free meal at the diner, once per rest. */
    niaPlate: v.has('q.nia.told') || v.has('q.nia.peace'),
    /** Doc heals you every rest, not once. */
    docCalls: v.has('q.nia.covered') || v.has('q.nia.peace'),
    /** Scrap per bottle at the Till. */
    inezRate: v.has('q.inez.inez') ? 2 : v.has('q.inez.town') ? 4 : 3,
    /** The camp's pick recipe makes one more. */
    solLesson: v.has('q.sol.returned'),
    /** A bottle from the seep in the Cut, once per rest. */
    wickSeep: v.has('q.wick.left'),
    /** Ren keeps watch at Last Chance. */
    renAtCamp: v.has('q.ren.truth'),
    /** Dez calls Kade road patrols on the radio when they clock in near you. */
    dezEars: v.has('q.dez.ears'),
  };
}
