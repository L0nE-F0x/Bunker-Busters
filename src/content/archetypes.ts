import type { ArchetypeDef } from './types';

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'infiltrator',
    name: 'The Infiltrator',
    tagline: 'Locks are just suggestions.',
    description:
      'Ex-courier for a delivery app that went under the same week the sky turned orange. Moves quiet, picks fast, never signs for anything.',
    accent: '#3ff2e0',
    skills: { lockpicking: 2, electronics: 0 },
    stats: { stealth: 0.85, speed: 1.05, toughness: 0.8 },
    signature: { name: 'Ghost Step', description: 'Drones fill their detection meter 40% slower.' },
    startingItems: [
      { id: 'lockpick', qty: 6 },
      { id: 'emp', qty: 1 },
      { id: 'ration', qty: 2 },
    ],
  },
  {
    id: 'engineer',
    name: 'The Engineer',
    tagline: 'Have you tried turning it off. Permanently?',
    description:
      'Former on-call SRE. Survived three outages, two layoffs and one apocalypse. Talks to machines in their own language: swearing.',
    accent: '#ff9d2e',
    skills: { lockpicking: 0, electronics: 2 },
    stats: { stealth: 1.0, speed: 1.0, toughness: 1.15 },
    signature: { name: 'Jury-Rig', description: 'Can short-circuit keypads, and starts with an extra EMP.' },
    startingItems: [
      { id: 'lockpick', qty: 3 },
      { id: 'emp', qty: 2 },
      { id: 'ration', qty: 2 },
    ],
  },
];
