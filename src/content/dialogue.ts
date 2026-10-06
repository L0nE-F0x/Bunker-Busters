import type { SkillId } from './types';

export interface TalkCtx {
  skill: (id: SkillId) => number;
  has: (flag: string) => boolean;
  /** Lower means the gate or the side door is already open. */
  gateOpen: boolean;
  sideOpen: boolean;
  recallReady: boolean;
  archetype: string;
}

export interface TalkChoice {
  id: string;
  label: string;
  /** Empty string ends the call. */
  next: string;
  effect?: 'recall' | 'openGate' | 'openSide' | 'digit' | 'code' | 'past' | 'told';
  /** Return a reason to grey the line out, or null if it can be said. */
  disabled?: (c: TalkCtx) => string | null;
}

export interface TalkNode {
  speaker: string;
  text: (c: TalkCtx) => string;
  choices: TalkChoice[];
}

const PAST: Record<string, string> = {
  infiltrator:
    'Rue! You never filed the delivery exception. That pallet was a marketing sample. The camp can have the tote bag. The tote bag is emotionally available.',
  engineer:
    'Nash. Buddy. The brown-out is our greenest feature. Twelve percent battery is a lifestyle. I will add you back to the repo. The repo is in my head now.',
  brute:
    'Paz, logistics is a feeling. SeedBot felt those shakes belonged near a ring light. I hear you. I am not unscannning anything. Unscanning is not a verb I funded.',
  fixer:
    'Len. Don\'t use the voice. I invented the voice. If you say the terms out loud I will agree with them, and I am trying to grow as a person who does not do that.',
};

/**
 * Tanner on the intercom. Ranks don't unlock a cutscene. They unlock a sentence he can't walk back.
 * Each rank reveals the next ask, so a stranger sees a wall and a Fixer sees a door.
 */
export const TANNER: Record<string, TalkNode> = {
  hello: {
    speaker: 'Tanner Pivotson',
    text: () =>
      'This property is pre-revenue but post-apocalypse. State your business, or I will have SeedBot read you the terms of service. He is very slow.',
    choices: [
      {
        id: 'pitch',
        label: 'The camp wants its water back.',
        next: 'water',
        effect: 'told',
        disabled: (c) => (c.skill('social') >= 1 ? null : 'Requires Social Engineering 1. He won\'t hear a pitch from a stranger.'),
      },
      {
        id: 'past',
        label: 'You know me. Open the door like you mean it.',
        next: 'past',
        effect: 'past',
      },
      {
        id: 'recall',
        label: 'Send SeedBot home. Tell it to check the battery.',
        next: 'recalled',
        effect: 'recall',
        disabled: (c) => {
          if (c.skill('social') < 1) return null; // hidden by the filter below when social is 0; kept for type completeness
          if (c.skill('social') < 2) return 'Requires Social Engineering 2.';
          if (!c.recallReady) return 'SeedBot is still running the last diagnostic.';
          return null;
        },
      },
      {
        id: 'gate',
        label: 'Open the gate. I\'m doing diligence.',
        next: 'opened',
        effect: 'openGate',
        disabled: (c) => {
          if (c.skill('social') < 4) return 'Requires Social Engineering 4.';
          if (c.gateOpen || c.has('social.gate')) return 'The gate is already your fault.';
          return null;
        },
      },
      {
        id: 'side',
        label: 'Unlatch the side door. I\'m on the schedule.',
        next: 'sided',
        effect: 'openSide',
        disabled: (c) => {
          if (c.skill('social') < 5) return 'Requires Social Engineering 5.';
          if (c.sideOpen || c.has('social.side')) return 'He already let you in.';
          return null;
        },
      },
      {
        id: 'code',
        label: 'Say the vault code. You told everyone it was obvious.',
        next: 'coded',
        effect: 'code',
        disabled: (c) => {
          if (c.skill('social') < 5) return 'Requires Social Engineering 5.';
          if (c.has('social.code')) return 'He already said it. Try not to make him say it twice.';
          return null;
        },
      },
      { id: 'bye', label: 'Hang up.', next: '' },
    ],
  },
  water: {
    speaker: 'Tanner Pivotson',
    text: () =>
      'The water is a premium tier. You are on the free tier, which is dust. The Seed Manifest is confidential. It is a list of who paid. It is mostly a list of who paid. The vault code is obvious. Obvious is a feature. Users hate passwords.',
    choices: [
      {
        id: 'digits',
        label: 'Then say the obvious part.',
        next: 'digits',
        effect: 'digit',
        disabled: (c) => {
          if (c.has('social.digit') || c.has('social.code')) return 'He already slipped.';
          if (c.skill('social') < 3) return 'Requires Social Engineering 3.';
          return null;
        },
      },
      { id: 'myself', label: 'I\'ll take the cistern myself.', next: '' },
    ],
  },
  digits: {
    speaker: 'Tanner Pivotson',
    text: () => 'It starts with one. Then two. I am hanging up. This is a very bad podcast, and I am the host.',
    choices: [{ id: 'bye', label: 'Let him go.', next: '' }],
  },
  past: {
    speaker: 'Tanner Pivotson',
    text: (c) => PAST[c.archetype] ?? 'Have we met? I meet a lot of people. Most of them are markets.',
    choices: [
      { id: 'back', label: 'That\'s not a no.', next: 'hello' },
      { id: 'bye', label: 'Hang up.', next: '' },
    ],
  },
  recalled: {
    speaker: 'Tanner Pivotson',
    text: () => 'SeedBot! Dock! Run a battery diagnostic and do NOT apprehend the guest until I finish my thought. SeedBot? He is docking. He loves diagnostics. Diagnostics are the only performance review he has.',
    choices: [{ id: 'bye', label: 'Use the quiet.', next: '' }],
  },
  opened: {
    speaker: 'Tanner Pivotson',
    text: () => 'Fine. The gate is open. This is a collaborative process. Do not touch the runway. The runway is a metaphor I am very literal about. Write down that I chose this.',
    choices: [{ id: 'bye', label: 'Walk in.', next: '' }],
  },
  sided: {
    speaker: 'Tanner Pivotson',
    text: () => 'The side door is unlatched. You are on the schedule between "forgive the raccoons" and "invent a new kind of moat." I am choosing to be easy to work with.',
    choices: [{ id: 'bye', label: 'Take the door.', next: '' }],
  },
  coded: {
    speaker: 'Tanner Pivotson',
    text: () => 'One. Two. Three. Four. It tested well with users. The user was me. If you tell the raccoons I will deny this call happened. This call is happening.',
    choices: [{ id: 'bye', label: 'Remember it.', next: '' }],
  },
  after: {
    speaker: 'Tanner Pivotson',
    text: () => 'You have the runway. I hope it makes you as unhappy as it made me. I am pivoting to forgiveness. Forgiveness is pre-revenue, but the logo is ready.',
    choices: [{ id: 'bye', label: 'Leave him to it.', next: '' }],
  },
};

/** Hide asks the player has no reason to see yet. A greyed line means the next rank, not a locked tree. */
export function visibleChoices(nodeId: string, ctx: TalkCtx): TalkChoice[] {
  const node = TANNER[nodeId];
  if (!node) return [];
  return node.choices.filter((choice) => {
    if (nodeId !== 'hello') return true;
    const social = ctx.skill('social');
    if (choice.id === 'recall' && social < 1) return false;
    if (choice.id === 'gate' && social < 2) return false;
    if ((choice.id === 'side' || choice.id === 'code') && social < 4) return false;
    return true;
  });
}
