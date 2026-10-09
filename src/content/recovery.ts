import type { HumanWeapon, HumanKit } from '@/game/combat/Humans';

/**
 * Kade Holdings Asset Recovery: the contractors who guard the aquifer "pilot program" and repossess
 * anything the desert left lying around, including the camps' water. Hi-vis vests, white hard hats,
 * respirators, lever rifles, and a rulebook written by HR. They are the road's main threat.
 *
 * Outposts sit in their own flattened pads (Heightfield reads `OUTPOSTS`). Positions are world XZ;
 * crew posts are local to the outpost (yaw 0 faces +Z, rotated by `rot`).
 */

export type CrewRole = 'guard' | 'patrol' | 'sit' | 'leader';

export interface CrewPost {
  weapon: HumanWeapon;
  role: CrewRole;
  at: [number, number];
  yaw: number;
  /**
   * A specialist: `marksman` (scoped rifle; holds the overwatch tower if there is one, and its scope
   * glints before every shot), `heavy` (a breacher in plates with a pump: walks you down, doesn't
   * hide), `grenadier` (smoke to cover the crew's moves, and the compliance charges).
   */
  kit?: HumanKit;
}

export interface OutpostDef {
  id: string;
  name: string;
  blurb: string;
  x: number;
  z: number;
  rot: number;
  /** Flattened pad radius. */
  r: number;
  tier: 1 | 2 | 3;
  crew: CrewPost[];
  /** Compliance sentries (local x, z, yaw). */
  sentries?: [number, number, number][];
  /** Property-line mines around the pad. */
  mines?: number;
  /** A Hornet drone patrols the perimeter. */
  hornet?: boolean;
  /** An overwatch tower for the marksman (local x, z, yaw it faces). */
  perch?: [number, number, number];
  /** What's in the footlocker. */
  loot: { id: string; qty: number }[];
}

export const OUTPOSTS: OutpostDef[] = [
  {
    id: 'survey', name: 'Kade Survey Camp', tier: 1, x: -30, z: 250, rot: 0.6, r: 16,
    blurb: 'Three tents, a theodolite and a sign that says the ridge is now a "data asset".',
    crew: [
      { weapon: 'revolver', role: 'guard', at: [5, 7], yaw: 0.3 },
      { weapon: 'rifle', role: 'patrol', at: [-6, 2], yaw: -1.2 },
      { weapon: 'revolver', role: 'sit', at: [1.6, -1.8], yaw: 2.6 },
    ],
    loot: [{ id: 'water', qty: 2 }, { id: 'ammo38', qty: 10 }, { id: 'ration', qty: 1 }, { id: 'antivenom', qty: 1 }, { id: 'binoculars', qty: 1 }, { id: 'smart_bottle', qty: 1 }],
  },
  {
    id: 'rp7', name: 'Recovery Point 7', tier: 2, x: 215, z: -95, rot: -0.4, r: 20,
    blurb: 'Where Kade stacks what it repossesses. Today: water jugs, a vending machine, somebody\'s piano.',
    crew: [
      { weapon: 'rifle', role: 'leader', at: [0, 4], yaw: 0 },
      { weapon: 'shotgun', role: 'guard', at: [7, 9], yaw: 0.5, kit: 'heavy' },
      { weapon: 'rifle', role: 'patrol', at: [-8, -6], yaw: 3 },
      { weapon: 'revolver', role: 'sit', at: [-2.5, -2], yaw: 1.4 },
    ],
    sentries: [[-7, 12.5, 0.15]],
    loot: [{ id: 'water', qty: 3 }, { id: 'shotgun', qty: 1 }, { id: 'shells', qty: 8 }, { id: 'medkit', qty: 1 }, { id: 'ammo3030', qty: 6 }, { id: 'pistol22', qty: 1 }, { id: 'ammo22', qty: 20 }, { id: 'gpu', qty: 1 }],
  },
  {
    id: 'pipeline', name: 'Pipeline Camp 3', tier: 2, x: 260, z: -150, rot: 1.1, r: 18,
    blurb: 'A pumping skid on the line that carries the creek west. Painted on it: "WATER IS A SERVICE".',
    crew: [
      { weapon: 'rifle', role: 'leader', at: [0, -5], yaw: 3.1 },
      { weapon: 'rifle', role: 'guard', at: [-3, -14.5], yaw: 0.15, kit: 'marksman' },
      { weapon: 'revolver', role: 'sit', at: [3, -2], yaw: 2, kit: 'grenadier' },
      { weapon: 'rifle', role: 'guard', at: [6, 6], yaw: 0.2 },
      { weapon: 'shotgun', role: 'patrol', at: [-7, 3], yaw: -1.5 },
    ],
    perch: [-3, -14.5, 0.15],
    sentries: [[-10, 9, -0.5]],
    mines: 8,
    hornet: true,
    loot: [{ id: 'water', qty: 3 }, { id: 'rifle', qty: 1 }, { id: 'ammo3030', qty: 10 }, { id: 'battery', qty: 2 }, { id: 'emp', qty: 1 }, { id: 'molotov', qty: 2 }, { id: 'asic', qty: 1 }],
  },
  {
    id: 'wellhead', name: 'Kade Wellhead', tier: 3, x: -240, z: -160, rot: 0.25, r: 22,
    blurb: 'The Dry Creek aquifer comes up here, into a Kade tank, under Kade guns. The creek did not dry up. It was moved.',
    crew: [
      { weapon: 'rifle', role: 'leader', at: [0, 8], yaw: 0 },
      { weapon: 'shotgun', role: 'guard', at: [9, 4], yaw: 1.2, kit: 'heavy' },
      { weapon: 'rifle', role: 'guard', at: [7, -14], yaw: -0.35, kit: 'marksman' },
      { weapon: 'revolver', role: 'sit', at: [-3, -3], yaw: 0.8, kit: 'grenadier' },
      { weapon: 'rifle', role: 'guard', at: [-9, 5], yaw: -1.1 },
      { weapon: 'shotgun', role: 'patrol', at: [6, -9], yaw: 2.8 },
    ],
    perch: [7, -14, -0.35],
    sentries: [[12, 14, 0.6], [-13, 13, -0.6]],
    mines: 14,
    hornet: true,
    loot: [{ id: 'water', qty: 6 }, { id: 'medkit', qty: 2 }, { id: 'ammo3030', qty: 12 }, { id: 'shells', qty: 10 }, { id: 'charge', qty: 1 }, { id: 'kade_badge', qty: 3 }, { id: 'vest', qty: 1 }, { id: 'seed_plate', qty: 2 }],
  },
  {
    // Act II: Vesper's road to Apex Vault. Her alarm calls this crew to the apron (Game wires it).
    id: 'apexgate', name: 'Apex Gatehouse', tier: 2, x: -332, z: -70, rot: 0.25, r: 16,
    blurb: 'Kade guards Vesper\'s road. The sign says WELCOME, SEED MEMBERS. The guns say the rest.',
    crew: [
      { weapon: 'rifle', role: 'leader', at: [0, 5], yaw: 0 },
      { weapon: 'shotgun', role: 'guard', at: [6, 6], yaw: 0.6 },
      { weapon: 'rifle', role: 'patrol', at: [-7, -2], yaw: -1.6 },
    ],
    sentries: [[-8, 9, -0.4]],
    hornet: true,
    loot: [{ id: 'water', qty: 3 }, { id: 'ammo3030', qty: 10 }, { id: 'battery', qty: 1 }, { id: 'charge', qty: 1 }, { id: 'kade_badge', qty: 2 }, { id: 'molotov', qty: 1 }, { id: 'nootropics', qty: 1 }, { id: 'speaker_badge', qty: 1 }],
  },
];

/** What each fallen contractor might carry (plus their gun's ammunition). */
export const BODY_LOOT: { id: string; qty: [number, number]; p: number }[] = [
  { id: 'kade_badge', qty: [1, 1], p: 0.9 },
  { id: 'water', qty: [1, 1], p: 0.35 },
  { id: 'ration', qty: [1, 1], p: 0.25 },
  { id: 'scrap', qty: [1, 3], p: 0.5 },
  { id: 'medkit', qty: [1, 1], p: 0.08 },
  { id: 'battery', qty: [1, 1], p: 0.1 },
  { id: 'antivenom', qty: [1, 1], p: 0.06 },
  // the contractor's own pockets: wellness kit, merch, company issue
  { id: 'nootropics', qty: [1, 1], p: 0.12 },
  { id: 'smart_ring', qty: [1, 1], p: 0.1 },
  { id: 'bandage', qty: [1, 2], p: 0.12 },
  { id: 'kombucha', qty: [1, 1], p: 0.08 },
  { id: 'mug', qty: [1, 1], p: 0.05 },
  { id: 'ammo22', qty: [5, 10], p: 0.08 },
  { id: 'vest', qty: [1, 1], p: 0.03 },
];

/** What a specialist carries on top: the breacher's spare shells and plate scrap, the marksman's .30-30 and rangefinder cell, the grenadier's charges. */
export const KIT_LOOT: Record<HumanKit, { id: string; qty: [number, number]; p: number }[]> = {
  marksman: [{ id: 'ammo3030', qty: [4, 8], p: 1 }, { id: 'battery', qty: [1, 1], p: 0.35 }, { id: 'water', qty: [1, 1], p: 0.5 }],
  heavy: [{ id: 'shells', qty: [4, 8], p: 1 }, { id: 'scrap', qty: [2, 4], p: 0.9 }, { id: 'medkit', qty: [1, 1], p: 0.25 }],
  grenadier: [{ id: 'charge', qty: [1, 1], p: 0.6 }, { id: 'noisemaker', qty: [1, 2], p: 0.45 }],
};

/** Bark lines by situation. Corporate to the end. */
export const BARKS: Record<string, string[]> = {
  spot: [
    'Unauthorized personnel on a Kade site!',
    'Contact! Somebody get the waiver!',
    'Asset located. Initiating recovery.',
    'Hey! This is a pilot program!',
    'You are trespassing on a data asset!',
  ],
  suspicious: [
    'Did you hear that?',
    'Something moved. Probably a coyote. Probably.',
    'Checking it out. Logging it either way.',
    'If that\'s Dale again, I\'m filing a report.',
  ],
  search: [
    'Fan out. Per the playbook.',
    'Come out and nobody gets a performance review.',
    'Sweeping the area.',
  ],
  lost: [
    'Lost visual. Writing it up as a coyote.',
    'Nothing. We\'ll call it a training exercise.',
    'Back to posts. Somebody owes me a timesheet.',
  ],
  reload: [
    'Reloading! It\'s in the SLA!',
    'Changing out, cover me!',
    'Need a sec, I\'m reloading!',
  ],
  flank: [
    'Moving around, per the playbook!',
    'Flanking left. Expense it.',
    'Pushing up!',
  ],
  hurt: [
    'Ow! That\'s a workers\' comp claim!',
    'I\'m hit! I\'m hit!',
    'That\'s gonna need a form.',
  ],
  down: [
    'Man down! He was on the waitlist!',
    'We lost one! Who\'s doing his paperwork?',
    'They got Dale! Nobody liked Dale, but still!',
  ],
  flee: [
    'I am not paid enough for this!',
    'Falling back! Falling all the way back!',
    'This isn\'t in my contract!',
  ],
  grenade: [
    'Compliance charge, out!',
    'Fire in the hole! Sign the release!',
  ],
  kill: [
    'Asset recovered.',
    'Target down. Somebody log it.',
  ],
  body: [
    'Man down in the yard! Nobody heard a thing?',
    'That\'s Dale. Dale\'s not on break. Dale\'s dead.',
    'Body! We\'ve got a body! Everyone wake up!',
    'Somebody\'s in the wire. Eyes open. Both of them.',
  ],
  radio: [
    'Recovery, this is Field. We have a trespasser, requesting bodies.',
    'Calling it in! Somebody pick up!',
    'Base, we need backup. Bring the good waivers.',
  ],
  radioAck: [
    'They\'re coming. Hold the line till the cavalry clocks in.',
    'Backup\'s inbound! Look busy!',
  ],
  radioNone: [
    'Base? Base! Nobody\'s on the radio. Typical.',
    'Nobody\'s answering. We\'re on our own.',
  ],
  breach: [
    'Breaching! Stand still, it\'s faster!',
    'Walking in. Don\'t make me run.',
    'Plates on. Coming to you.',
  ],
  plates: [
    'My plates! Those were a loan!',
    'Armor\'s gone! Somebody cover me!',
  ],
  push: [
    'He\'s reloading! Push! Push!',
    'Dry! He\'s dry! Go!',
    'Reloading! Now, while he\'s busy!',
  ],
  surrender: [
    'Okay! Okay! I\'m a contractor! I\'m not even full-time!',
    'Don\'t shoot! My equity hasn\'t vested!',
    'I surrender! Is there a form for this?',
    'I give up! Tell Kade I was very brave!',
  ],
  spared: [
    'Thank you. I\'m logging this as a positive interaction.',
    'You never saw me. I was never on the clock.',
    'Take it. Take the badge. I hated the photo anyway.',
  ],
  smoke: [
    'Smoke out! Visibility is a privilege!',
    'Popping smoke! Move, move!',
    'Smoke! Nobody breathe on the clock!',
  ],
  idle: [
    'Twelve more months and I get a bunker seat. Allegedly.',
    'They said the water was the product. I thought it was a metaphor.',
    'Who brings a piano to a repossession?',
    'My badge says Tier One Field. My mom thinks that\'s a promotion.',
    'HR says the masks are a branding opportunity.',
  ],
};
