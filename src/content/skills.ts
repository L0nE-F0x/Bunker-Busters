import type { SkillDef, SkillId } from './types';

/**
 * Six ways through a door. Each skill is a short tree:
 *
 *   rank 1 ─ rank 2 ─┬─ focus (pick one of two) ─ rank 3 ─ rank 4 ─┬─ capstone (pick one of two) ─ rank 5
 *
 * A focus or a capstone costs a point and does not raise the rank. Picking one closes its twin.
 * A careful Act I still will not fill the sheet. That is the point of a build.
 *
 * Every line below is wired: ranks in the systems that read `skill()`, focuses and capstones
 * through `focus()` / `capstone()` (State, Game's minigame wrappers, Garage talk, Settlement).
 * Index 0 of `perLevel` is the untrained line. Index n is what rank n adds.
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  lockpicking: {
    id: 'lockpicking',
    name: 'Lockpicking',
    max: 5,
    blurb: 'Padlocks, doors, cabinets and safes. Mostly it\'s patience.',
    perLevel: [
      'Untrained. The sweet spot is narrow and picks snap easily.',
      'Wider sweet spots. Opens room 2 at the Dry Creek motel.',
      'Picks bend before they snap.',
      'The binding pin glows. Opens the closet in the Till.',
      'Huge sweet spots.',
      'The first pin sets itself.',
    ],
  },
  electronics: {
    id: 'electronics',
    name: 'Electronics',
    max: 5,
    blurb: 'Keypads, fuse boxes, terminals, and anything else with a wire in it.',
    perLevel: [
      'Untrained. You can\'t short or splice anything yet.',
      'Short a keypad or a fuse box, or splice a Kade terminal. Starts the clinic generator in Dry Creek.',
      'Your EMPs keep SeedBot down 50% longer. Splices get a bigger buffer, and Tanner\'s vault keypad takes one.',
      'SeedBot hesitates: its meter fills 15% slower. Opens the diner freezer. Splices mark the codes you need.',
      'Bypass boards give you more time and a wider window. Splices get one more slot.',
      'Generators, freezers and fuse boxes just flip on. No circuit board.',
    ],
  },
  stealth: {
    id: 'stealth',
    name: 'Stealth',
    max: 5,
    blurb: 'Moving quietly and staying out of sight.',
    perLevel: [
      'Untrained. You make as much noise as anyone else.',
      'Crouching really is quieter.',
      'SeedBot\'s meter fills slower. Crouched, you can palm the Till.',
      'Your flashlight gives you away less. Crouched, you can reach the crate under the water tower.',
      'Sprinting is a lot quieter.',
      'Every step is quieter, and SeedBot\'s meter fills very slowly.',
    ],
  },
  demolition: {
    id: 'demolition',
    name: 'Demolition',
    max: 5,
    blurb: 'Breach charges and EMPs. Fast, and rarely quiet.',
    perLevel: [
      'Untrained. You can throw an EMP, but you can\'t set a charge.',
      'A charge can take the Garage gate or the motel\'s boards, loudly.',
      'Your EMPs reach further. A charge moves the rockfall in the Cut, or the Till\'s closet door.',
      'A charge takes the Garage side door. You can rip out a tripwire.',
      'Crouch, and a gate or side-door charge won\'t wake the alarm.',
      'A charge can take the vault door, though it still sets off the alarm.',
    ],
  },
  survival: {
    id: 'survival',
    name: 'Survival',
    max: 5,
    blurb: 'Food, water, how much you can carry, and how badly you land.',
    perLevel: [
      'Untrained. Hunger, thirst and falls hit you like anyone else.',
      'Hunger and thirst come slower. You can pick through the wash behind the motel.',
      'Food and water do more. The camp can make a medkit. Wick will share.',
      'The pack holds 4 kg more. The wash gives up a meal, and Wick will shift rocks with you.',
      'Falls hurt less. You spot the crate under the water tower without crouching.',
      'A rest at the fire heals you fully. The pack holds 8 kg more.',
    ],
  },
  social: {
    id: 'social',
    name: 'Social Engineering',
    max: 5,
    blurb: 'Talking people into things. Tanner, especially.',
    perLevel: [
      'Untrained. Tanner hangs up on you, and Dry Creek keeps things to itself.',
      'Tanner hears you out. Nia gives directions. Sol talks locks.',
      'Tanner will send SeedBot home, and admits who he pays. Inez trades. Doc shows you his list.',
      'Tanner slips two vault digits. Nia mentions the stair. You can make peace in Dry Creek.',
      'Talk the Garage gate open. Inez admits to the key.',
      'Tanner unlatches the side door and says the whole code.',
    ],
  },
  firearms: {
    id: 'firearms',
    name: 'Firearms',
    max: 5,
    blurb: 'Aim, recoil and reloading. There are more guns out here than water.',
    perLevel: [
      'Untrained. Wide spread and heavy recoil.',
      'Steadier hands: tighter spread from the hip, less kick.',
      'Reloads go 20% faster. The camp can load rifle rounds.',
      'Headshots hit harder. Aiming down the sights settles quicker.',
      'Half the recoil. Wounded wolves hesitate before they come at you.',
      'Every shot lands where you meant it, and contractors flinch when you aim at them.',
    ],
  },
};

export const SKILL_ORDER: SkillId[] = ['lockpicking', 'electronics', 'stealth', 'demolition', 'survival', 'social', 'firearms'];

/** Short glyph for the tree header. */
export const SKILL_GLYPH: Record<SkillId, string> = {
  lockpicking: 'LP', electronics: 'EL', stealth: 'ST', demolition: 'DM', survival: 'SV', social: 'SO', firearms: 'FA',
};

export function emptySkills(): Record<SkillId, number> {
  return { lockpicking: 0, electronics: 0, stealth: 0, demolition: 0, survival: 0, social: 0, firearms: 0 };
}

/** A branch node: two per skill at rank 2 (focus) and two at rank 4 (capstone). */
export interface FocusDef {
  id: string;
  skill: SkillId;
  name: string;
  blurb: string;
}

/** Rank 2. The point shapes the skill instead of raising it. */
export const FOCUSES: FocusDef[] = [
  { id: 'feeler', skill: 'lockpicking', name: 'Feeler', blurb: 'Every lock you sit down at has one pin fewer.' },
  { id: 'saver', skill: 'lockpicking', name: 'Spare Tension', blurb: 'Half the time, a pick that snaps is still a pick.' },
  { id: 'hotline', skill: 'electronics', name: 'Hot Line', blurb: 'Bypass boards and splices come up one step simpler.' },
  { id: 'deepcell', skill: 'electronics', name: 'Deep Cell', blurb: 'Your EMPs keep SeedBot down 30% longer again.' },
  { id: 'still', skill: 'stealth', name: 'Still Air', blurb: 'Steps, sprints and crouches all come out quieter.' },
  { id: 'lowlight', skill: 'stealth', name: 'Low Light', blurb: 'Your flashlight barely gives you away.' },
  { id: 'shaped', skill: 'demolition', name: 'Shaped Charge', blurb: 'Charges in Dry Creek and the Cut don\'t wake the street.' },
  { id: 'wide', skill: 'demolition', name: 'Wide Burst', blurb: 'Your EMPs reach about a fifth further.' },
  { id: 'kitchen', skill: 'survival', name: 'Field Kitchen', blurb: 'Food and water do 15% more, on top of the rank.' },
  { id: 'hardrest', skill: 'survival', name: 'Hard Rest', blurb: 'A rest at the fire puts back more health, food and water.' },
  { id: 'known', skill: 'social', name: 'Known Face', blurb: 'Dry Creek hears you as one Social rank higher.' },
  { id: 'longcon', skill: 'social', name: 'Long Con', blurb: 'When Tanner sends SeedBot home, it stays docked 5 s longer.' },
  { id: 'quickdraw', skill: 'firearms', name: 'Quickdraw', blurb: 'Swap and draw twice as fast, and reload a further 20% quicker.' },
  { id: 'marksman', skill: 'firearms', name: 'Marksman', blurb: 'Aiming down the sights zooms further and holds your breath: no sway.' },
];

/** Rank 4. The last shape a skill takes. */
export const CAPSTONES: FocusDef[] = [
  { id: 'bump', skill: 'lockpicking', name: 'Bump Key', blurb: 'Locks of three pins or fewer just open. No minigame.' },
  { id: 'master', skill: 'lockpicking', name: 'Master\'s Hands', blurb: 'Every lock plays at rank 5, and each lock you open hands back a pick.' },
  { id: 'salvage', skill: 'electronics', name: 'Salvage', blurb: 'Every board you beat, box you splice or switch you flip pays out a lithium cell.' },
  { id: 'overclock', skill: 'electronics', name: 'Overclock', blurb: 'Bypass boards and splices come up one step simpler and play at rank 5.' },
  { id: 'shadow', skill: 'stealth', name: 'Shadow', blurb: 'SeedBot\'s meter fills another 25% slower.' },
  { id: 'exit', skill: 'stealth', name: 'Exit Plan', blurb: 'Getting tased costs you nothing: no pick, no bruise, no thirst.' },
  { id: 'chemist', skill: 'demolition', name: 'Bench Chemist', blurb: 'The camp packs two charges from the parts for one.' },
  { id: 'blastproof', skill: 'demolition', name: 'Blast Proof', blurb: 'You take 25% less damage from everything: tasers, wires, falls.' },
  { id: 'camel', skill: 'survival', name: 'Camel', blurb: 'Hunger and thirst drain 35% slower, on top of the rank.' },
  { id: 'packrat', skill: 'survival', name: 'Pack Rat', blurb: 'The pack holds 6 kg more.' },
  { id: 'handler', skill: 'social', name: 'Handler', blurb: 'SeedBot stays docked twice as long, and Tanner takes the ask twice as often.' },
  { id: 'wordofmouth', skill: 'social', name: 'Word of Mouth', blurb: 'Quests pay 30% more XP, and every finished favour earns extra goodwill.' },
  { id: 'deadeye', skill: 'firearms', name: 'Deadeye', blurb: 'Headshots deal half again as much, and a kill refunds a round to the gun.' },
  { id: 'brawler', skill: 'firearms', name: 'Brawler', blurb: 'The crowbar and gun-butt hit twice as hard, and takedowns work on anyone who isn\'t facing you.' },
];

/** Rank that opens each branch. */
export const FOCUS_RANK = 2;
export const CAPSTONE_RANK = 4;

export function focusesFor(skill: SkillId) {
  return FOCUSES.filter((f) => f.skill === skill);
}

export function capstonesFor(skill: SkillId) {
  return CAPSTONES.filter((f) => f.skill === skill);
}
