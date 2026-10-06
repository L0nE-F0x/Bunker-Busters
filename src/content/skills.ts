import type { SkillDef, SkillId } from './types';

/**
 * Six ways through a door. The Garage is one door. Dry Creek and the ridge are the others.
 * A careful pass still will not max this sheet. That is the point of a build.
 * Index 0 of `perLevel` is the untrained line. Index n is what rank n actually does.
 * At rank 2 a skill offers one focus. The focus spends a point and does not raise the rank.
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  lockpicking: {
    id: 'lockpicking',
    name: 'Lockpicking',
    max: 5,
    blurb: 'Tension, patience, and a mild disregard for property law.',
    perLevel: [
      'Untrained. Every pin is a personal insult.',
      'Wider sweet spots. Dry Creek\'s motel is this rank.',
      'Picks bend before they snap. A focus opens: one shape for the skill.',
      'You can feel the binding pin. Inez\'s closet is this rank.',
      'Steel nerves. The sweet spots are huge.',
      'The first pin sets itself.',
    ],
  },
  electronics: {
    id: 'electronics',
    name: 'Electronics',
    max: 5,
    blurb: 'Convince a machine that you are, in fact, the admin.',
    perLevel: [
      'Untrained. You know where the power button is. Usually.',
      'Short a keypad. Dry Creek\'s generator is this rank, and it does not bite.',
      'EMP charges you pack stay down 50% longer. A focus opens.',
      'Drones hesitate. The diner freezer is this rank.',
      'Bypasses give you more time and a wider lock.',
      'A fuse box, a generator, a freezer: just a switch. No minigame.',
    ],
  },
  stealth: {
    id: 'stealth',
    name: 'Stealth',
    max: 5,
    blurb: 'Be a gap in someone else\'s attention.',
    perLevel: [
      'Untrained. You sound like a person with feet.',
      'Crouching actually quiets the feet.',
      'SeedBot fills slower. Crouched, you can palm the Till. A focus opens.',
      'A flashlight gives you away less.',
      'Sprint is no longer a confession. The tower cache is this rank, if you crouch.',
      'You are a suggestion. The meter has to work.',
    ],
  },
  demolition: {
    id: 'demolition',
    name: 'Demolition',
    max: 5,
    blurb: 'When the conversation and the pick both fail, bring a noise.',
    perLevel: [
      'Untrained. You can throw a rock. Please don\'t.',
      'A charge takes the Garage gate, or Dry Creek\'s boards. Both are loud.',
      'EMP reaches further. A charge will move the rockfall on the ridge. A focus opens.',
      'Charges take the side door. You can rip a tripwire out. Inez\'s closet, if you insist.',
      'Crouch, and a gate or side-door charge doesn\'t wake the alarm.',
      'A charge will take the vault door. The alarm will still complain.',
    ],
  },
  survival: {
    id: 'survival',
    name: 'Survival',
    max: 5,
    blurb: 'Hunger, thirst, gravity, and the weight of other people\'s junk.',
    perLevel: [
      'Untrained. You get hungry, thirsty, and tired like anyone else.',
      'Hunger and thirst arrive slower. You can pick a dry wash for scrap.',
      'Food and water do more. Camp can make a medkit. A focus opens. Wick shares, if you ask.',
      'The pack holds 4 kg more. The wash gives up a ration.',
      'Falls hurt less. You read the scrape by the water tower without crouching for it.',
      'A rest at the fire puts you all the way back together, and the pack holds 8 kg more.',
    ],
  },
  social: {
    id: 'social',
    name: 'Social Engineering',
    max: 5,
    blurb: 'Tanner funds whatever he says out loud. Get him talking.',
    perLevel: [
      'Strangers get the door. Tanner hangs up. Dry Creek sells you one bottle and nothing else.',
      'He hears the camp. Nia will tell you about the ridge.',
      'You can send SeedBot home. Inez will trade. A focus opens.',
      'He slips two vault digits. Doc will show you the patient list. Sol names the closet.',
      'You can talk the gate open. Inez opens the closet and calls it a favour.',
      'The side door, and the rest of the code, if you lean on him.',
    ],
  },
};

export const SKILL_ORDER: SkillId[] = ['lockpicking', 'electronics', 'stealth', 'demolition', 'survival', 'social'];

export function emptySkills(): Record<SkillId, number> {
  return { lockpicking: 0, electronics: 0, stealth: 0, demolition: 0, survival: 0, social: 0 };
}

/** One branch per skill, bought at rank 2 or later. The other branch for that skill closes. */
export interface FocusDef {
  id: string;
  skill: SkillId;
  name: string;
  blurb: string;
}

export const FOCUSES: FocusDef[] = [
  { id: 'feeler', skill: 'lockpicking', name: 'Feeler', blurb: 'Every lock you sit down at is one pin shorter.' },
  { id: 'saver', skill: 'lockpicking', name: 'Spare Tension', blurb: 'Half the time a snapped pick is still a pick.' },
  { id: 'hotline', skill: 'electronics', name: 'Hot Line', blurb: 'Bypass boards show up one step simpler.' },
  { id: 'deepcell', skill: 'electronics', name: 'Deep Cell', blurb: 'An EMP you pack keeps a drone down longer still.' },
  { id: 'still', skill: 'stealth', name: 'Still Air', blurb: 'Footsteps, sprint, and the crouch all come out quieter.' },
  { id: 'lowlight', skill: 'stealth', name: 'Low Light', blurb: 'The flashlight stops being a confession.' },
  { id: 'shaped', skill: 'demolition', name: 'Shaped', blurb: 'A charge in Dry Creek or on the ridge does not wake the street.' },
  { id: 'wide', skill: 'demolition', name: 'Wide Burst', blurb: 'EMP reaches further than the rank alone.' },
  { id: 'kitchen', skill: 'survival', name: 'Field Kitchen', blurb: 'Food and water do a little more, on top of the rank.' },
  { id: 'hardrest', skill: 'survival', name: 'Hard Rest', blurb: 'The fire puts more of you back, even before rank 5.' },
  { id: 'known', skill: 'social', name: 'Known Face', blurb: 'Dry Creek hears you as one rank kinder than the sheet says.' },
  { id: 'longcon', skill: 'social', name: 'Long Con', blurb: 'When Tanner sends the drone home, it stays gone longer.' },
];

export function focusesFor(skill: SkillId) {
  return FOCUSES.filter((f) => f.skill === skill);
}
