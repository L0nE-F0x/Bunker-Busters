import type { SkillDef, SkillId } from './types';

export const SKILLS: Record<SkillId, SkillDef> = {
  lockpicking: {
    id: 'lockpicking',
    name: 'Lockpicking',
    max: 5,
    blurb: 'Tension, patience and a mild disregard for property law.',
    perLevel: [
      'Untrained. Every pin is a personal insult.',
      'Wider sweet spots on pins.',
      'Picks bend before they snap (+1 grace).',
      'Feel the binding pin (pin highlight).',
      'Steel nerves: sweet spots are huge.',
      'Locksmith of the apocalypse: auto-set the first pin.',
    ],
  },
  electronics: {
    id: 'electronics',
    name: 'Electronics',
    max: 5,
    blurb: 'Convince machines that you are, in fact, the admin.',
    perLevel: [
      'Untrained. You know where the power button is. Usually.',
      'Short keypads, disarm tripwires, cut fuse boxes safely.',
      'EMP charges last 50% longer.',
      'Drones take longer to notice you.',
      'Signal sync is more forgiving; more time on bypasses.',
      'Root access to anything with a blinking LED.',
    ],
  },
};

export const SKILL_ORDER: SkillId[] = ['lockpicking', 'electronics'];
