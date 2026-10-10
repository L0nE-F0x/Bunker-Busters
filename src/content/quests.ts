import type { PersonId, SkillId } from './types';
import { LORE_SERIES } from './world';

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
      'Last Chance is down to about three days of water. Tanner Pivotson\'s drone keeps taking the camp\'s jugs off the highway. Mara wants the water in his cistern, and the ledger in his vault that he calls the Seed Manifest.',
    start: (v) => v.has('briefed'),
    steps: [
      {
        id: 'note', text: 'Read the note on the pump island', at: 'gas',
        hint: 'It\'s pinned to the dead pumps at Last Chance, a few steps from the fire. There\'s still water in the cooler behind them.',
        done: (v) => v.has('intel:intel.gas.note') || v.has('seen:garage') || v.has('garage.complete'),
      },
      {
        id: 'garage', text: 'Find the Garage', at: 'garage',
        hint: 'Northeast of camp, up the dirt spur off the highway. Look for the neon and the razor wire.',
        done: (v) => any(v, 'seen:garage', 'garage.gate.open', 'garage.gap.open', 'garage.complete'),
      },
      {
        id: 'fence', text: 'Get past the fence', at: 'garage',
        hint: 'Pick the padlock on the gate, blow it, or talk Tanner into opening it on the intercom. The blueprint at the Spire mentions a loose panel, too.',
        done: (v) => any(v, 'garage.gate.open', 'garage.gap.open', 'garage.side.open', 'garage.vault.open', 'garage.complete'),
      },
      {
        id: 'vault', text: 'Open the Runway Room', at: 'garage',
        hint: 'It\'s inside, past the laser hall. Five pins, a keypad with an "obvious" code, or a charge at Demolition 5.',
        done: (v) => any(v, 'garage.vault.open', 'garage.complete'),
      },
      {
        id: 'loot', text: 'Take the water and the Seed Manifest', at: 'garage',
        hint: 'The safe and both crates in the vault. The water comes with you even if your pack is full.',
        done: (v) => v.has('garage.complete'),
      },
      {
        id: 'who', text: 'Find out who Tanner pays', optional: true, at: 'garage',
        hint: 'Ask him on the intercom (Social 2), or read the valve tag on the dirt spur below the Garage.',
        done: (v) => any(v, 'tanner.kade', 'lore.valve'),
      },
      {
        id: 'permit', text: 'Find out why Dry Creek is dry', optional: true,
        hint: 'There\'s a county clipboard on the highway, west of camp. Doc Ivers in Dry Creek remembers that summer, too.',
        done: (v) => any(v, 'lore.permit', 'creek.doc.permit'),
      },
      {
        id: 'debrief', text: 'Radio Mara from the campfire', at: 'gas',
        hint: 'Back at Last Chance, open the camp and call Mara. She wants the names read out.',
        done: (v) => any(v, 'act1.broadcast', 'act1.leverage', 'act1.deal'),
      },
    ],
    outcomes: [
      {
        flag: 'act1.broadcast',
        label: 'You read every name on the open net.',
        text: 'Every camp on the band heard who sold them out. Vesper shut the spur valve that night. The cistern has about two weeks left in it, and right now every camp is angry at the same person.',
        reward: { xp: 150, items: [{ id: 'charge', qty: 1 }, { id: 'emp', qty: 1 }], rep: { compact: 3, creek: 1, mara: 1, vesper: -2 } },
      },
      {
        flag: 'act1.leverage',
        label: 'You kept the ledger quiet and let Vesper pay for it.',
        text: 'Vesper sent a drone drop and called it a free trial. Mara keeps the ledger in the ammo tin under the radio. When the trial runs out, the camp goes west.',
        reward: { xp: 150, items: [{ id: 'water', qty: 6 }, { id: 'medkit', qty: 2 }], rep: { compact: 1, vesper: 1 } },
      },
      {
        flag: 'act1.deal',
        label: 'You sent the ledger back for her water.',
        text: 'Twenty jugs a week, "forever-ish". The camp drinks. Mara hates every jug, and nobody thinks they\'ll keep coming.',
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
      'Apex Vault sits on the far shore of the salt, at the foot of the range, and it holds most of what\'s left of the valley\'s water. Vesper Kade watches every camera there herself. Find out who in Dry Creek would walk west with you, then find her road.',
    start: (v) => v.has('debriefed'),
    steps: [
      {
        id: 'crew', text: 'Ask Dry Creek who would come west', at: 'creek',
        hint: 'Anyone at standing 2 or better will say yes. Doing their favours is the quickest way there.',
        done: (v) => CREW.some((f) => v.has(f)) || v.has('apex.complete'),
      },
      {
        id: 'crew2', text: 'Find a second pair of hands', optional: true, at: 'creek',
        hint: 'Two people who trust you are better than one.',
        done: (v) => CREW.filter((f) => v.has(f)).length >= 2,
      },
      {
        id: 'road', text: 'Reach Apex Vault, west of the salt', at: 'apex',
        hint: 'Her road leaves the highway at its west end and runs south past Dry Creek, along the salt. Kade has a gatehouse on it. Look for the rocket.',
        done: (v) => any(v, 'seen:apex', 'apex.hangar.open', 'apex.airlock.open', 'apex.complete'),
      },
      {
        id: 'code', text: 'Learn how the airlock code works', optional: true, at: 'apex',
        hint: 'There\'s a shift note near the end of her road. Or ask Vesper on the intercom like it\'s a feature request (Social 5), or skip the code and SPLICE the airlock at Electronics 3.',
        done: (v) => any(v, 'apex.code', 'apex.airlock.open', 'apex.complete'),
      },
      {
        id: 'hangar', text: 'Get into the hangar', at: 'apex',
        hint: 'Pick the five pins, short the door controller (Electronics 2), blow it (Demolition 3), or buzz Vesper on the intercom and give her a reason. The camera over the door sweeps the apron.',
        done: (v) => any(v, 'apex.hangar.open', 'apex.airlock.open', 'apex.vent.open', 'apex.vault.open', 'apex.complete'),
      },
      {
        id: 'airlock', text: 'Get through the airlock', at: 'apex',
        hint: 'The code is the launch clock over the door, hours and minutes, and it counts down. Splicing the controller gets you the door, the cameras and the lasers at once. There\'s also a vent on the hill\'s east side, if you know about it.',
        done: (v) => any(v, 'apex.airlock.open', 'apex.vent.open', 'apex.vault.open', 'apex.complete'),
      },
      {
        id: 'vault', text: 'Open the Cistern Room', at: 'apex',
        hint: 'Down the launch corridor. Jump the low beams and crouch under the high one, or kill the breaker by the inner door. Then six pins, or a big charge (Demolition 5).',
        done: (v) => any(v, 'apex.vault.open', 'apex.complete'),
      },
      {
        id: 'loot', text: 'Take the water', at: 'apex',
        hint: 'The cistern tap and both lockers. The water comes with you even if your pack is full.',
        done: (v) => v.has('apex.complete'),
      },
    ],
    reward: { xp: 400, items: [{ id: 'water', qty: 4 }, { id: 'charge', qty: 1 }, { id: 'medkit', qty: 1 }], rep: { compact: 2, creek: 2, mara: 1, vesper: -3 } },
    wrap: {
      speaker: 'Mara Voss',
      text: 'The cistern runs east tonight. Vesper\'s feed says she\'s "pivoting". One more thing. Dez caught a signal on the band: a building on the old coast north of the salt, with no windows and a lot of antennas. They call it the Panopticon. It read our names back to us before we said them.',
    },
  },

  {
    id: 'act3',
    kind: 'main',
    title: 'Act III · The Panopticon',
    giver: 'mara',
    where: 'North of the salt',
    blurb:
      'Ezra Seymour has watched every camp in the valley for three years from an old lighthouse at the head of the valley north of the salt. He read the camp\'s names on the band the night the water came east. Mara wants to know what he wrote down, and where his water comes from.',
    start: (v) => v.has('act2.debriefed'),
    steps: [
      {
        id: 'north', text: 'Reach the Panopticon, north of the salt', at: 'panopticon',
        hint: 'Cross the salt to its north shore and follow the valley up to its head. The tower is white with a red band, and the lamp on it is blue.',
        done: (v) => any(v, 'seen:panopticon', 'panopticon.gate.open', 'panopticon.complete'),
      },
      {
        id: 'ada', text: 'Find Ada Ivers', optional: true, at: 'panopticon',
        hint: 'Doc\'s sister may be at one of the desks in the ring. Look for desk 7.',
        done: (v) => any(v, 'panopticon.ada.met', 'panopticon.ada.free'),
      },
      {
        id: 'gate', text: 'Get through the face gate', at: 'panopticon',
        hint: 'It opens for staff faces only. SPLICE yourself onto the staff list or short the motor (Electronics 3), blow the rails (Demolition 4), or talk to Ezra on the gate intercom. The lamp sweeps the valley every forty seconds; keep to the rocks.',
        done: (v) => any(v, 'panopticon.gate.open', 'panopticon.tower.open', 'panopticon.complete'),
      },
      {
        id: 'cams', text: 'Blind the cameras on the tower', optional: true, at: 'panopticon',
        hint: 'In the yard round the tower. Each camera watches another one\'s junction box. Cut the one nobody watches first. Ada knows the order.',
        done: (v) => any(v, 'panopticon.cameras.off', 'panopticon.tower.open', 'panopticon.complete') || ['cam1', 'cam2', 'cam3', 'cam4'].every((c) => v.has(`panopticon.cam.${c}.off`)),
      },
      {
        id: 'tower', text: 'Get into the tower', at: 'panopticon',
        hint: 'The door is on the tower\'s west side. The keypad code means something to Ezra (Ada knows it), or SPLICE the archive controller (Electronics 4), or a big charge (Demolition 5).',
        done: (v) => any(v, 'panopticon.tower.open', 'panopticon.complete'),
      },
      {
        id: 'archive', text: 'Decide what happens to the archive', at: 'panopticon',
        hint: 'In the tower room. Ezra is at his monitor wall; the drive is in the rack behind him.',
        done: (v) => v.has('panopticon.archive'),
      },
      {
        id: 'loot', text: 'Take the water', at: 'panopticon',
        hint: 'In the tower room: the cistern under the hatch, the locker and the archive shelf. The water comes with you even if your pack is full.',
        done: (v) => v.has('panopticon.complete'),
      },
    ],
    reward: { xp: 500, items: [{ id: 'water', qty: 4 }, { id: 'emp', qty: 2 }, { id: 'medkit', qty: 1 }], rep: { compact: 2, creek: 2, mara: 1, doc: 1, ezra: -2 } },
    wrap: {
      speaker: 'Mara Voss',
      text: 'Dez heard the lamp go out on the band. Come back to the fire and raise me on the radio. I want all of it, from the gate on.',
    },
  },

  // ------------------------------------------------------------------ Dry Creek
  {
    id: 'nia.short',
    kind: 'side',
    title: 'Two Bottles Short',
    giver: 'nia',
    where: 'Dry Creek · the diner',
    blurb: 'Someone has been taking water from under Nia\'s counter, two bottles at a time. She writes every bottle down, so she knows exactly how much is gone.',
    start: (v) => v.has('creek.talk.nia'),
    steps: [
      {
        id: 'who', text: 'Find out who is taking Nia\'s water', at: 'creek',
        hint: 'Sol sits up with the street fire at night and sees who goes past. Or ask Doc straight out (Social 2).',
        done: (v) => v.has('q.nia.who'),
      },
      {
        id: 'tell', text: 'Decide what Nia hears', at: 'creek',
        hint: 'Talk to Nia. Tell her the truth, cover for him with two bottles of your own, or get the two of them in one room (Social 3).',
        done: (v) => any(v, 'q.nia.told', 'q.nia.covered', 'q.nia.peace'),
      },
    ],
    outcomes: [
      {
        flag: 'q.nia.told',
        label: 'You told Nia it was Doc.',
        text: 'Nia had it out with Doc, loudly, in the street. The ledger balances again, and there\'s a free plate for you at the counter after every rest.',
        reward: { xp: 60, items: [{ id: 'ration', qty: 2 }], rep: { nia: 2, doc: -1 } },
      },
      {
        flag: 'q.nia.covered',
        label: 'You covered for Doc with two of your own bottles.',
        text: 'Nia\'s ledger balanced and she never found out. Doc knows what you did. He patches you up after every rest now, not just the once.',
        reward: { xp: 60, items: [{ id: 'medkit', qty: 1 }], rep: { doc: 2 } },
      },
      {
        flag: 'q.nia.peace',
        label: 'You sat them both down.',
        text: 'Doc needed the water for the clinic\'s sterilizer and was too proud to ask. Now Nia puts some aside for him and writes it down. You get the plate and the house calls.',
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
    blurb: 'Wick has a cough Doc can hear from the clinic, and Wick won\'t come down off the ridge. Doc has a medkit for him, but his knees won\'t take that wash.',
    start: (v) => v.has('creek.talk.doc'),
    steps: [
      {
        id: 'power', text: 'Get the clinic\'s power back', at: 'creek',
        hint: 'The generator is on the clinic\'s east side and needs Electronics 1. Or give Doc a lithium cell and he\'ll fix it himself.',
        done: (v) => v.has('creek.power'),
      },
      {
        id: 'kit', text: 'Pick up Doc\'s medkit', at: 'creek',
        hint: 'Talk to Doc once his window is lit.',
        done: (v) => v.has('q.doc.kit'),
      },
      {
        id: 'wick', text: 'Get the medkit to Wick, or don\'t', at: 'cave',
        hint: 'The Cut is south of the Spire, up the wash with the posts in it. Wick sits by his fire.',
        done: (v) => any(v, 'q.doc.delivered', 'q.doc.kept'),
      },
    ],
    outcomes: [
      {
        flag: 'q.doc.delivered',
        label: 'You gave Wick the medkit.',
        text: 'Wick coughed, complained and used it. Afterwards he told you what he can see from up on the ridge.',
        reward: { xp: 70, items: [{ id: 'water', qty: 2 }], rep: { wick: 2, doc: 1 } },
      },
      {
        flag: 'q.doc.kept',
        label: 'You kept the medkit.',
        text: 'You told Wick that Doc says hello, and kept the kit. Doc heard about it.',
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
    blurb: 'The Till\'s landlord left before the Pivot and never came back. Inez has run the place as if it were hers ever since. Somewhere upstairs there\'s a deed that says whose it really is.',
    start: (v) => any(v, 'creek.talk.inez', 'creek.loft'),
    steps: [
      {
        id: 'stair', text: 'Get up the Till\'s stair', at: 'creek',
        hint: 'The "closet" behind the counter is really a stair. Lockpicking 3, a charge at Demolition 2, or get Inez to admit she has the key (Social 4).',
        done: (v) => v.has('creek.stair'),
      },
      {
        id: 'loft', text: 'Find what the landlord left', at: 'creek',
        hint: 'The shelf in the loft, at the top of the stair.',
        done: (v) => v.has('creek.loft'),
      },
      {
        id: 'give', text: 'Give the deed to Inez, or to the town', at: 'creek',
        hint: 'Inez is at the Till. Nia keeps the town\'s papers at the diner.',
        done: (v) => any(v, 'q.inez.inez', 'q.inez.town'),
      },
    ],
    outcomes: [
      {
        flag: 'q.inez.inez',
        label: 'You gave Inez the deed.',
        text: 'The Till is legally Inez\'s now, in pencil. You get her best price, a bottle for 2 scrap, and a look that might be gratitude.',
        reward: { xp: 70, items: [{ id: 'battery', qty: 1 }, { id: 'lockpick', qty: 2 }], rep: { inez: 2, creek: -1 } },
      },
      {
        flag: 'q.inez.town',
        label: 'You gave the deed to the town.',
        text: 'Nia pinned it to the diner wall, so the Till belongs to Dry Creek now. Inez opened the back room to everyone and put your price up to 4 scrap a bottle.',
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
    blurb: 'Sol left his pick roll in motel room 2 and then locked himself out. He was a locksmith for thirty years. He\'d like this to stay between the two of you.',
    start: (v) => v.has('creek.talk.sol'),
    steps: [
      {
        id: 'room', text: 'Open motel room 2', at: 'creek',
        hint: 'It\'s the middle door at the motel. Three pins, Lockpicking 1.',
        done: (v) => v.has('creek.motel.b'),
      },
      {
        id: 'roll', text: 'Find Sol\'s roll', at: 'creek',
        hint: 'Search the room once you\'re in.',
        done: (v) => v.has('creek.motel.b.loot'),
      },
      {
        id: 'give', text: 'Give it back, or keep it', at: 'creek',
        hint: 'Sol is at the street fire. Or unroll it from your kit for five picks.',
        done: (v) => any(v, 'q.sol.returned', 'q.sol.kept'),
      },
    ],
    outcomes: [
      {
        flag: 'q.sol.returned',
        label: 'You gave Sol his roll.',
        text: 'Sol checked every pick twice. Then he showed you a better way to bend them: the camp\'s pick recipe makes 3 now.',
        reward: { xp: 60, items: [{ id: 'lockpick', qty: 2 }], rep: { sol: 2 } },
      },
      {
        flag: 'q.sol.kept',
        label: 'You kept the roll.',
        text: 'Five good picks. Sol knows who has them.',
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
    blurb: 'Ren ran the projector at the Starlite Drive-In. The last show was a keynote. Ren walked out before the end, and nobody else ever came out. Ren wants to know how it ended.',
    start: (v) => any(v, 'creek.talk.ren', 'seen:drivein'),
    steps: [
      {
        id: 'find', text: 'Find the Starlite Drive-In', at: 'drivein',
        hint: 'North of the highway, between Dry Creek and the Garage. You can see the screen from a long way off.',
        done: (v) => v.has('seen:drivein'),
      },
      {
        id: 'inside', text: 'Look around the drive-in', at: 'drivein',
        hint: 'Walk in among the parked cars and see what\'s left of the screening.',
        done: (v) => v.has('site.drivein.found'),
      },
      {
        id: 'end', text: 'Find out how the keynote ended', at: 'drivein',
        hint: 'The projector in the booth still has a reel in it. The generator behind the snack bar is dead.',
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
        text: 'Ren listened to all of it without looking away, then laughed for the first time in two years. In the morning Ren walked to Last Chance and took over as the camp\'s lookout.',
        reward: { xp: 90, items: [{ id: 'ration', qty: 1 }, { id: 'water', qty: 2 }], rep: { ren: 2, compact: 1 } },
      },
      {
        flag: 'q.ren.spare',
        label: 'You told Ren it was just static.',
        text: 'Ren nodded as if they believed you. Maybe they did. They gave you the projector\'s last cells and went back to counting the road.',
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
    blurb: 'Vesper Kade came up to Wick\'s cave once, looked it over like she was pricing it, and left a crate behind the rockfall with her initials on it. Wick wants to know what she left.',
    start: (v) => v.has('creek.talk.wick'),
    steps: [
      {
        id: 'rocks', text: 'Get past the rockfall in the side passage', at: 'cave',
        hint: 'A charge at Demolition 2, or ask Wick to help you move it by hand (Survival 3 or Social 3).',
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
        text: 'Water, cells, scrap. Wick watched you carry it out and didn\'t say a word.',
        reward: { xp: 40, rep: { wick: -1 } },
      },
      {
        flag: 'q.wick.left',
        label: 'You left the crate for Wick.',
        text: 'Wick painted over her initials with his own, and showed you the seep at the back of the cave. There\'s a bottle for you there after every rest.',
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
    blurb: 'Pip keeps the camp\'s water ledger. Bottles you bring home go in the good column. Bottles you drink on the road go in another column, and Pip won\'t tell you what it\'s called.',
    start: (v) => v.has('briefed'),
    steps: [
      {
        id: 'first', text: 'Give Pip two bottles for the camp', at: 'gas',
        hint: 'Open the camp at the fire and talk to Pip.',
        done: (v) => v.has('q.pip.1'),
      },
      {
        id: 'second', text: 'Give Pip two more', at: 'gas',
        hint: 'Try garages, freezers and coolers. Some people will give you a bottle if you ask.',
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
    blurb: 'The week of the Pivot, Wick watched a private jet take off and come down again in the dunes to the southwest. Whoever was on it had paid to get out early.',
    start: (v) => any(v, 'wick.jet', 'seen:jet'),
    steps: [
      {
        id: 'find', text: 'Find the jet in the dunes', at: 'jet',
        hint: 'Southwest of Last Chance, out in the dunes. Look for a tail fin sticking out of the sand.',
        done: (v) => v.has('seen:jet'),
      },
      {
        id: 'inside', text: 'Get aboard', at: 'jet',
        hint: 'Walk round the wreck and find a way into the cabin.',
        done: (v) => v.has('site.jet.found'),
      },
      {
        id: 'secret', text: 'Find out what happened to the founder', at: 'jet',
        hint: 'Whatever he packed for the end of the world is still in the baggage hold.',
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
    blurb: 'ColdStorage is still warm. A warm data centre is drawing power, which means somebody is paying for it, and Mara wants to know who.',
    start: (v) => any(v, 'mara.coldstorage', 'seen:datacenter'),
    steps: [
      {
        id: 'find', text: 'Find ColdStorage', at: 'datacenter',
        hint: 'Far northeast, past the Garage. A long white building. You can hear it humming from outside.',
        done: (v) => v.has('seen:datacenter'),
      },
      {
        id: 'inside', text: 'Get inside', at: 'datacenter',
        hint: 'Find a way into the server halls.',
        done: (v) => v.has('site.datacenter.found'),
      },
      {
        id: 'secret', text: 'Find out what is still running', at: 'datacenter',
        hint: 'There\'s a terminal in the hall that still answers. Get the lights on first.',
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
    blurb: 'Before the Pivot, Inez sold forty tickets for the hyperloop out east. Nobody has asked for a refund, because nobody ever rode it. She wants to know if she owes anyone.',
    start: (v) => any(v, 'inez.tube', 'seen:tube'),
    steps: [
      {
        id: 'find', text: 'Find the Tube', at: 'tube',
        hint: 'East of the Spire. A long silver pipe up on legs.',
        done: (v) => v.has('seen:tube'),
      },
      {
        id: 'inside', text: 'Get into the test track', at: 'tube',
        hint: 'Station Zero is at the near end of the track.',
        done: (v) => v.has('site.tube.found'),
      },
      {
        id: 'secret', text: 'Find out how fast it ever went', at: 'tube',
        hint: 'The pod has a flight recorder under the front seat.',
        done: (v) => v.has('site.tube.done'),
      },
    ],
    reward: { xp: 90, items: [{ id: 'scrap', qty: 4 }], rep: { inez: 1 } },
    wrap: { speaker: 'You', text: 'Forty-one kilometres an hour, and only the founder ever rode it. Inez doesn\'t owe anyone a refund.' },
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
    blurb: 'Rider 9 delivered for Dropt ("anything, anywhere, ten minutes or it\'s free") and kept going after the Pivot, because the app never told him to stop. He checked in on Hollis\'s CB every week for two years. He\'s missed the last four.',
    start: (v) => any(v, 'hollis.rider', 'seen:courier'),
    steps: [
      {
        id: 'find', text: 'Find Rider 9\'s last stop', at: 'courier',
        hint: 'His last call came from the north flats, past the Kade Wellhead. Look for an orange flag on a whip.',
        done: (v) => any(v, 'seen:courier', 'q.rider.log'),
      },
      {
        id: 'log', text: 'Read his delivery log', at: 'courier',
        hint: 'His phone is still on, on the handlebars.',
        done: (v) => v.has('q.rider.log'),
      },
      {
        id: 'deliver', text: 'Deliver his last order', at: 'creek',
        hint: 'A stove igniter for Nia Pell at the Dry Creek diner. She\'s behind the counter.',
        done: (v) => v.has('q.rider.delivered'),
      },
      {
        id: 'tell', text: 'Tell Hollis', at: 'gas',
        hint: 'He\'s at the camp fire.',
        done: (v) => any(v, 'q.rider.truth', 'q.rider.west'),
      },
    ],
    outcomes: [
      {
        flag: 'q.rider.truth',
        label: 'You told Hollis what happened to Rider 9.',
        text: 'Hollis stood out by the sign for an hour. In the morning he gave you his last box of .38s and said the kid never dropped an order in his life. Channel 19 has been quiet since. He still leaves it on.',
        reward: { xp: 90, items: [{ id: 'ammo38', qty: 12 }, { id: 'ration', qty: 1 }], rep: { hollis: 2, compact: 1 } },
      },
      {
        flag: 'q.rider.west',
        label: 'You told Hollis that Rider 9 rode west.',
        text: 'Hollis smiled like he believed it, and he keeps channel 19 open in case the kid ever calls in. Pip watched your face the whole time and wrote something down.',
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
    blurb: 'Kade crews read their badge numbers out over the radio at every shift change, because it\'s policy. Dez thinks the lanyards talk on a channel of their own. He needs three of them to find it, and somewhere high to listen from.',
    start: (v) => v.has('briefed') && (v.has('dez.badges') || v.count('kade_badge') > 0),
    steps: [
      {
        id: 'badges', text: 'Bring Dez three Recovery Lanyards', at: 'gas',
        hint: 'Kade contractors wear them, and Kade crates sometimes have a spare. Dez is at the camp fire.',
        done: (v) => v.has('q.dez.badges'),
      },
      {
        id: 'relay', text: 'Patch Dez\'s relay into the Spire', at: 'spire',
        hint: 'The fallen 5G tower, northeast of camp. The generator by the shack still runs. Red to red.',
        done: (v) => v.has('q.dez.relay'),
      },
      {
        id: 'listen', text: 'Listen in with Dez', at: 'gas',
        hint: 'Back at the fire.',
        done: (v) => any(v, 'q.dez.ears', 'q.dez.karaoke'),
      },
    ],
    outcomes: [
      {
        flag: 'q.dez.ears',
        label: 'You kept quiet and listened.',
        text: 'Dez listens to Kade\'s crew channel now. When a road pair clocks in near you, he calls it on the radio before they see you.',
        reward: { xp: 90, items: [{ id: 'emp', qty: 1 }], rep: { dez: 2, compact: 1 } },
      },
      {
        flag: 'q.dez.karaoke',
        label: 'You played the karaoke machine into their channel.',
        text: 'Four minutes of power ballad on every Kade radio in the valley. Somebody in HR opened a ticket. Kade changed channels by morning, and Dez hasn\'t stopped grinning since.',
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
    blurb: 'Men in white hard hats came up the wash with a tripod and tied orange tape along Wick\'s ridge. Wick wants the tape gone, and he wants to know what they were measuring.',
    start: (v) => v.has('wick.survey'),
    steps: [
      {
        id: 'stakes', text: 'Pull Kade\'s three survey stakes', at: 'survey',
        hint: 'Pale stakes with orange tape, running up the slope from the Kade Survey Camp toward the Cut. Watch out for the camp.',
        done: (v) => STAKES.every((f) => v.has(f)),
      },
      {
        id: 'book', text: 'Take the field book from the Kade Survey Camp', at: 'survey',
        hint: 'Three tents and a theodolite, west of the wash. The book is on the folding table by the tripod.',
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
        text: 'Wick read every page, then fed them to his fire one at a time. The seep is still his. Kade will have to survey it again, and he\'ll be sitting on it when they come.',
        reward: { xp: 80, items: [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }], rep: { wick: 2 } },
      },
      {
        flag: 'q.wick.kept',
        label: 'You kept the field book for Mara.',
        text: 'Wick let you take it, in the end. Mara read the numbers over the radio twice and went quiet. Kade isn\'t surveying the ridge. They\'re surveying the water underneath it.',
        reward: { xp: 90, items: [{ id: 'battery', qty: 1 }, { id: 'ammo3030', qty: 6 }], rep: { mara: 1, compact: 1, wick: 1 } },
      },
    ],
    wrap: { speaker: 'Wick', text: 'Orange tape. On my ridge. Like it was a present.' },
  },

  // ------------------------------------------------------------------ the founders, from the outside
  // Props and interactions: sites/stories.ts (the capsule, the camera, the relay, Pip's pool).
  // Talk: content/camp.ts (Dez, Pip, Hollis). The chat pages are WORLD_INTEL (series 'lifeboat').
  {
    id: 'dez.lifeboat',
    kind: 'side',
    title: 'Read Receipts',
    giver: 'dez',
    where: 'The whole valley → Last Chance',
    blurb:
      'A founders\' group chat called LIFEBOAT still tries to sync on the Compact\'s band at three every morning, in pieces. Every phone, watch and tablet that died out here kept its last page. Dez wants all eight.',
    start: (v) => v.has('briefed') && (v.has('dez.lifeboat') || LIFEBOAT_PAGES.some((id) => v.has(`intel:${id}`))),
    steps: [
      {
        id: 'one', text: 'Find a page of the LIFEBOAT chat', at: 'lifeboat',
        hint: 'Dez listens for the next one at three in the morning and marks it on your map. Founders dropped their devices wherever they ran.',
        done: (v) => lifeboatCount(v) >= 1,
      },
      {
        id: 'half', text: 'Find four pages', at: 'lifeboat',
        hint: 'Try the jet, the drive-in, Kade\'s sites and the Tube. The map marks the nearest one Dez can hear.',
        done: (v) => lifeboatCount(v) >= 4,
      },
      {
        id: 'all', text: 'Find all eight pages', at: 'lifeboat',
        hint: 'The last ones are further out: the west road, the far side of the highway, under the Spire.',
        done: (v) => lifeboatCount(v) >= 8,
      },
      {
        id: 'dez', text: 'Decide with Dez what the chat is for', at: 'gas',
        hint: 'At the camp fire.',
        done: (v) => any(v, 'q.chat.air', 'q.chat.mara', 'q.chat.pip'),
      },
    ],
    outcomes: [
      {
        flag: 'q.chat.air',
        label: 'You let Dez read it on the open net.',
        text: 'Dez read all eight pages on the open band and did all the voices. Every camp heard the founders name the Pivot like a product launch. Vesper\'s carrier went silent for a whole day.',
        reward: { xp: 150, items: [{ id: 'emp', qty: 1 }, { id: 'battery', qty: 2 }], rep: { compact: 2, dez: 2, vesper: -1 } },
      },
      {
        flag: 'q.chat.mara',
        label: 'You gave the chat to Mara.',
        text: 'Mara read it twice and put it in the ammo tin with the ledger. If there\'s ever a court again, she says, it goes in first. She keeps coming back to Ezra\'s eleven hundred cameras. Somebody up north has watched every camp for three years.',
        reward: { xp: 140, items: [{ id: 'medkit', qty: 1 }, { id: 'water', qty: 2 }], rep: { mara: 2, compact: 1 } },
      },
      {
        flag: 'q.chat.pip',
        label: 'You gave the chat to Pip, for the ledger.',
        text: 'Pip copied every line into the back of the ledger under a heading in capitals, THE OTHER COLUMN. She says that when there\'s a trial, she\'s going to read it out.',
        reward: { xp: 140, items: [{ id: 'ration', qty: 2 }, { id: 'noisemaker', qty: 1 }], rep: { pip: 2, compact: 1 } },
      },
    ],
    wrap: { speaker: 'Dez Marlow', text: 'Eight pages. Seven founders. One group chat. And not one of them ever said "us".' },
  },
  {
    id: 'pip.capsule',
    kind: 'side',
    title: 'Class of Tomorrow',
    giver: 'pip',
    where: 'Last Chance → the old school, west of Dry Creek',
    blurb:
      'Mara traded Dry Creek\'s aquifer for a school with a rocket on the sign. Pip went there for eleven days. In the first week the class buried a time capsule, paid for by Kade Holdings, to be opened in 2046. Pip wants her letter back now. She wrote something stupid in it and she wants to know how stupid.',
    start: (v) => v.has('pip.capsule'),
    steps: [
      {
        id: 'site', text: 'Find what\'s left of Kade Kids Academy', at: 'capsule',
        hint: 'West of Dry Creek, short of the highway. The rocket sign is bent over. The school itself is a crater.',
        done: (v) => any(v, 'seen:capsule', 'q.capsule.dug'),
      },
      {
        id: 'dig', text: 'Dig up the time capsule', at: 'capsule',
        hint: 'Under the plaque. It isn\'t buried deep.',
        done: (v) => v.has('q.capsule.dug'),
      },
      {
        id: 'give', text: 'Get Pip her letter', at: 'gas',
        hint: 'She\'s at the camp fire. Sealed or not. Or let Mara be the one to give it to her.',
        done: (v) => any(v, 'q.capsule.sealed', 'q.capsule.peeked', 'q.capsule.mara'),
      },
    ],
    outcomes: [
      {
        flag: 'q.capsule.sealed',
        label: 'You gave Pip her letter, sealed.',
        text: 'Pip read it behind the pumps, on her own. "Dear future me, I hope you have a pool." Afterwards she drew one in chalk on the forecourt, two metres long, with a ladder. Nobody walks on it.',
        reward: { xp: 90, items: [{ id: 'ration', qty: 1 }, { id: 'lockpick', qty: 2 }], rep: { pip: 2, compact: 1 } },
      },
      {
        flag: 'q.capsule.peeked',
        label: 'You read Pip\'s letter first, and told her.',
        text: 'Pip looked at you for a long time. "At least you said." She drew the pool anyway, and put you in a column of the ledger she won\'t name.',
        reward: { xp: 60, items: [{ id: 'ration', qty: 1 }], rep: { pip: 1 } },
      },
      {
        flag: 'q.capsule.mara',
        label: 'You let Mara give Pip the letter.',
        text: 'Mara walked it over to Pip herself, and they sat behind the pumps for an hour. Afterwards Pip drew a pool on the forecourt while Mara held the chalk. Mara doesn\'t say "later" any more when she means "no water".',
        reward: { xp: 100, items: [{ id: 'water', qty: 2 }], rep: { mara: 2, pip: 1, compact: 1 } },
      },
    ],
    wrap: { speaker: 'Pip Okafor', text: 'I put "pool" in the good column. It doesn\'t hold water. That\'s fine. Nothing does.' },
  },
  {
    id: 'hollis.camera',
    kind: 'side',
    title: 'Seen',
    giver: 'hollis',
    where: 'Last Chance → the relay on the rise',
    blurb:
      'There\'s a little camera on a pole by the road, past the pumps, with a blue light. It\'s been blinking at Hollis for three years and he\'s had enough. Somebody is watching the camp. He wants to know who, and he wants it to stop.',
    start: (v) => v.has('briefed') && any(v, 'hollis.camera', 'lore.glimpse', 'q.cam.seen'),
    steps: [
      {
        id: 'cam', text: 'Take a look at the camera by the road', at: 'glimpsecam',
        hint: 'On a pole on the camp side of the highway, east of the pumps. It blinks blue.',
        done: (v) => any(v, 'q.cam.seen', 'q.cam.cut', 'q.cam.loop', 'q.cam.hello'),
      },
      {
        id: 'relay', text: 'Find where it uploads to', at: 'glimpserelay',
        hint: 'Its antenna points south-east, at a solar mast on the rise toward the Survey Camp. Decide there what whoever is watching gets to see.',
        done: (v) => any(v, 'q.cam.cut', 'q.cam.loop', 'q.cam.hello'),
      },
      {
        id: 'tell', text: 'Tell Hollis', at: 'gas',
        hint: 'At the camp fire.',
        done: (v) => v.has('q.cam.told'),
      },
    ],
    outcomes: [
      {
        flag: 'q.cam.cut',
        label: 'You cut the uplink.',
        text: 'The blue light went out at three in the morning. Hollis noticed first. He says the forecourt sounds different now, and he\'s been sleeping through the night.',
        reward: { xp: 90, items: [{ id: 'ammo38', qty: 8 }, { id: 'scrap', qty: 3 }], rep: { hollis: 2 } },
      },
      {
        flag: 'q.cam.loop',
        label: 'You looped the feed.',
        text: 'Somewhere north of the salt, a screen shows an empty forecourt at dusk, over and over. The blue light still blinks, and Dez has hung his lunchbox on the pole under it.',
        reward: { xp: 110, items: [{ id: 'emp', qty: 1 }, { id: 'battery', qty: 1 }], rep: { hollis: 1, dez: 1, compact: 1 } },
      },
      {
        flag: 'q.cam.hello',
        label: 'You said hello to whoever was watching.',
        text: 'Ezra Seymour answered. He knew your water ration and which foot you favour. He lives north of the salt in a place he calls the Panopticon, and he says he\'ll know when you\'re close. The light still blinks. Now you know whose it is.',
        reward: { xp: 120, items: [{ id: 'battery', qty: 2 }], rep: { ezra: 2 } },
      },
    ],
    wrap: { speaker: 'Hollis Grange', text: 'Three years that thing watched me fix a sign. Hope it learned something.' },
  },
  {
    id: 'sol.song',
    kind: 'side',
    title: 'Still Here',
    giver: 'sol',
    where: 'Dry Creek → Last Chance → Dry Creek',
    blurb:
      'KDRY\'s station log was signed R. Varga: Rosa Varga, Sol\'s wife. She ran the station out of the back of the feed store, and on the afternoon of the Pivot she stayed on the air until the generator quit. She played one last song. Sol was out on a call, opening somebody\'s car, and he never heard which one.',
    start: (v) => v.has('q.song.asked'),
    steps: [
      {
        id: 'hollis', text: 'Ask Hollis what he heard on the radio that afternoon', at: 'gas',
        hint: 'Hollis was driving that afternoon with the radio on. He\'s at the camp fire.',
        done: (v) => any(v, 'q.song.hollis', 'q.song.band', 'q.song.quiet'),
      },
      {
        id: 'dez', text: 'Ask Dez to find the song', at: 'gas',
        hint: 'Dez\'s karaoke machine has every song. Tell him what Hollis heard.',
        done: (v) => any(v, 'q.song.dez', 'q.song.band', 'q.song.quiet'),
      },
      {
        id: 'sol', text: 'Tell Sol', at: 'creek',
        hint: 'Sol keeps the street fire in Dry Creek. Give him the name, or have Dez play it for the whole valley the way Rosa did.',
        done: (v) => any(v, 'q.song.band', 'q.song.quiet'),
      },
    ],
    outcomes: [
      {
        flag: 'q.song.band',
        label: 'Dez played it on the open band at sunset.',
        text: 'Dez put "Still Here" out on every frequency the karaoke machine could reach, at sunset, the way Rosa had. In Dry Creek the whole street stopped to listen. Sol stood by his fire and didn\'t sing along. Everyone else did.',
        reward: { xp: 90, items: [{ id: 'lockpick', qty: 3 }], rep: { sol: 2, creek: 1, compact: 1 } },
      },
      {
        flag: 'q.song.quiet',
        label: 'You told Sol the song, just him.',
        text: 'You gave him the name, and the words Dez wrote out on the back of a Kade lanyard. Sol keeps them in his pick roll. He hums it at the fire when he thinks nobody can hear.',
        reward: { xp: 80, items: [{ id: 'lockpick', qty: 2 }, { id: 'ration', qty: 1 }], rep: { sol: 3 } },
      },
    ],
    wrap: { speaker: 'Sol Varga', text: 'Rosa always said the last song is for whoever is still here. Mm. That\'s us, then.' },
  },
];

/** Number 2,212 (Doc): his sister's place in the Everafter line. Props: sites/stories.ts; talk: Settlement (Doc). */
QUESTS.push({
  id: 'doc.ada',
  kind: 'side',
  title: 'Number 2,212',
  giver: 'doc',
  where: 'Dry Creek → Waitlist City',
  blurb:
    'Doc\'s sister Ada joined the queue for Everafter, the bunker at the head of Waitlist City. She was number 2,212. For a year she wrote to the clinic every month from her camp chair, about the weather and the people either side of her. Then the letters stopped.',
  start: (v) => v.has('doc.ada') || v.has('q.ada.found'),
  steps: [
    {
      id: 'find', text: 'Find number 2,212 in the Everafter line', at: 'adachair',
      hint: 'Waitlist City is in the basin south-east, past the Tube. Her chair may not be in the line any more. Check along the edges.',
      done: (v) => v.has('q.ada.found'),
    },
    {
      id: 'tell', text: 'Tell Doc what you found', at: 'creek',
      hint: 'He\'s at the clinic by day, and at Sol\'s fire in the evening.',
      done: (v) => v.has('q.ada.told') || v.has('q.ada.kind'),
    },
  ],
  outcomes: [
    {
      flag: 'q.ada.told',
      label: 'You gave Doc his sister\'s letter.',
      text: 'Doc read it twice, folded it into his coat and went back to work. That night he wrote a letter of his own, addressed to "Ada Ivers, the Panopticon, the old coast", and asked Dez to read it on the band. He doesn\'t expect an answer. He just wants her to hear it.',
      reward: { xp: 90, items: [{ id: 'medkit', qty: 1 }], rep: { doc: 2, creek: 1 } },
    },
    {
      flag: 'q.ada.kind',
      label: 'You told Doc she got a seat inside.',
      text: 'Doc said "good", twice. Her number is up on the clinic wall now: 2,212, SEATED. You still have the letter.',
      reward: { xp: 60, items: [{ id: 'medkit', qty: 1 }], rep: { doc: 1 } },
    },
  ],
  wrap: { speaker: 'Doc Ivers', text: 'Two thousand two hundred and twelve. She always did hate a queue.' },
});

/** The founders' chat, in reading order (content/world.ts WORLD_INTEL, series 'lifeboat'). */
export const LIFEBOAT_PAGES = LORE_SERIES.lifeboat.ids;
export const lifeboatCount = (v: { has: (f: string) => boolean }) => LIFEBOAT_PAGES.filter((id) => v.has(`intel:${id}`)).length;

/**
 * Map targets for steps that aren't landmarks or outposts: [x, z]. `lifeboat` is resolved by the
 * runtime to the first chat page you haven't read.
 */
export const STORY_SPOTS: Record<string, [number, number]> = {
  /** Ada's chair, dragged out of the Everafter line (Waitlist City, site-local (-31, 18)). */
  adachair: [294, 269],
  capsule: [-306, 4],
  glimpsecam: [-121, 126],
  glimpserelay: [-74, 178],
};

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
    /** Pip's chalk pool is on the forecourt. */
    pipPool: v.has('q.capsule.sealed') || v.has('q.capsule.peeked') || v.has('q.capsule.mara'),
    /** Ezra Seymour knows your voice, and says so now and then. */
    ezraWatching: v.has('q.cam.hello'),
  };
}
