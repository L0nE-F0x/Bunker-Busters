import type { SkillId } from './types';

export interface Recipe {
  id: string;
  name: string;
  /** Shown under the name, e.g. "3 scrap → 2 lockpicks". */
  detail: string;
  out: { id: string; qty: number };
  need: { id: string; qty: number }[];
  skill?: { id: SkillId; level: number };
}

/** Campfire work. No bench, no minigame: scrap, a battery, and a skill you already bought. */
export const RECIPES: Recipe[] = [
  {
    id: 'picks',
    name: 'Bend some picks',
    detail: '3 scrap → 2 lockpicks',
    out: { id: 'lockpick', qty: 2 },
    need: [{ id: 'scrap', qty: 3 }],
  },
  {
    id: 'noise',
    name: 'Can and a bolt',
    detail: '2 scrap → 1 noisemaker',
    out: { id: 'noisemaker', qty: 1 },
    need: [{ id: 'scrap', qty: 2 }],
  },
  {
    id: 'emp',
    name: 'Pack an EMP',
    detail: '2 cells + 3 scrap → 1 EMP · Electronics 1',
    out: { id: 'emp', qty: 1 },
    need: [{ id: 'battery', qty: 2 }, { id: 'scrap', qty: 3 }],
    skill: { id: 'electronics', level: 1 },
  },
  {
    id: 'charge',
    name: 'Pack a charge',
    detail: '1 cell + 3 scrap → 1 breach charge · Demolition 1',
    out: { id: 'charge', qty: 1 },
    need: [{ id: 'battery', qty: 1 }, { id: 'scrap', qty: 3 }],
    skill: { id: 'demolition', level: 1 },
  },
  {
    id: 'medkit',
    name: 'Strip a medkit',
    detail: '1 ration + 4 scrap → 1 medkit · Survival 2',
    out: { id: 'medkit', qty: 1 },
    need: [{ id: 'ration', qty: 1 }, { id: 'scrap', qty: 4 }],
    skill: { id: 'survival', level: 2 },
  },
];
