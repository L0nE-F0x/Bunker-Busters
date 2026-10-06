import type { SkillId } from './types';

export interface TalkCtx {
  /** Social is the rank Tanner hears (the Defector's Insider passive adds one). */
  skill: (id: SkillId) => number;
  has: (flag: string) => boolean;
  /** Lower means the gate or the side door is already open. */
  gateOpen: boolean;
  sideOpen: boolean;
  recallReady: boolean;
  archetype: string;
}

export type TalkEffect = 'recall' | 'openGate' | 'openSide' | 'digit' | 'code' | 'past' | 'told' | 'kade';

export interface TalkChoice {
  id: string;
  label: string;
  /** Empty string ends the call. */
  next: string;
  effect?: TalkEffect;
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
    'Nash. Buddy. The brown-out is our greenest feature. Twelve percent battery is a lifestyle. I\'ll add you back to the repo. The repo is in my head now.',
  brute:
    'Paz, logistics is a feeling. SeedBot felt those shakes belonged near a ring light. I hear you. I am not un-scanning anything. Un-scanning is not a verb I funded.',
  fixer:
    'Len. Don\'t use the voice. I invented the voice. If you say the terms out loud I\'ll agree to them, and I\'m trying to grow as a person who doesn\'t do that.',
  scout:
    'A park ranger? At my door? Is this about the report? I never read the report. Nobody read the report. That\'s what made it such a good report.',
  defector:
    'Theo Vance! Brother! You walked out of Apex, which, respect, very counter-cultural. Come in! Not literally. The door is a metaphor. The lock is very literal.',
};

/**
 * Tanner on the intercom. Ranks don't unlock a cutscene. They unlock a sentence he can't walk back.
 * Each rank reveals the next ask, so a stranger sees a wall and a Fixer sees a door.
 */
export const TANNER: Record<string, TalkNode> = {
  hello: {
    speaker: 'Tanner Pivotson',
    text: (c) =>
      c.has('tanner.kade')
        ? 'You again. If this is about the waitlist, I am number four thousand and twelve and I am at peace with it. State your business.'
        : 'This property is pre-revenue but post-apocalypse. State your business, or SeedBot will read you the terms of service. He reads very slowly.',
    choices: [
      {
        id: 'pitch',
        label: 'The camp wants its water back.',
        next: 'water',
        effect: 'told',
        disabled: (c) => (c.skill('social') >= 1 ? null : 'Requires Social Engineering 1. He doesn\'t take pitches from strangers.'),
      },
      {
        id: 'past',
        label: 'You know me. Open the door like you mean it.',
        next: 'past',
        effect: 'past',
      },
      {
        id: 'who',
        label: 'Who are you paying with our water, Tanner?',
        next: 'kade',
        effect: 'kade',
        disabled: (c) => (c.skill('social') >= 2 ? null : 'Requires Social Engineering 2.'),
      },
      {
        id: 'recall',
        label: 'Send SeedBot home. Tell it to check the battery.',
        next: 'recalled',
        effect: 'recall',
        disabled: (c) => {
          if (c.skill('social') < 2) return 'Requires Social Engineering 2.';
          if (!c.recallReady) return 'SeedBot is still running the last diagnostic.';
          return null;
        },
      },
      {
        id: 'gate',
        label: 'Open the gate. I\'m doing due diligence.',
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
          if (c.has('social.code')) return 'He already said it. Don\'t make him say it twice.';
          return null;
        },
      },
      { id: 'bye', label: 'Hang up.', next: '' },
    ],
  },
  water: {
    speaker: 'Tanner Pivotson',
    text: () =>
      'The water is a premium tier. You\'re on the free tier, which is dust. The Seed Manifest is confidential. It\'s a list of who paid. It is mostly a list of who paid. The vault code is obvious. Obvious is a feature. Users hate passwords.',
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
      { id: 'back', label: 'Let\'s talk about something else.', next: 'hello' },
      { id: 'myself', label: 'I\'ll take the cistern myself.', next: '' },
    ],
  },
  kade: {
    speaker: 'Tanner Pivotson',
    text: () =>
      'Paying? I\'m not paying. I\'m investing in a relationship. With a partner. Her name isn\'t important. Her name is Vesper Kade. Bunkr.ly resold seats in Apex Vault, okay? Premium seats. She only takes water now. The jugs are my membership dues.',
    choices: [
      {
        id: 'seat',
        label: 'And your own seat?',
        next: 'waitlist',
        disabled: (c) => (c.skill('social') >= 3 ? null : 'Requires Social Engineering 3. He\'ll tell a stranger a lot, but not that.'),
      },
      { id: 'back', label: 'So you\'re the middleman.', next: 'hello' },
      { id: 'bye', label: 'Hang up.', next: '' },
    ],
  },
  waitlist: {
    speaker: 'Tanner Pivotson',
    text: () =>
      'I\'m on the waitlist. It\'s a very exclusive waitlist. Four thousand and twelve. Last month I was four thousand and nine, so some people moved up. I assume. Please don\'t tell SeedBot. He thinks we\'re both going.',
    choices: [
      { id: 'back', label: 'I won\'t tell SeedBot.', next: 'hello' },
      { id: 'bye', label: 'Hang up.', next: '' },
    ],
  },
  digits: {
    speaker: 'Tanner Pivotson',
    text: () => 'It starts with one. Then two. I\'m hanging up now. This is a very bad podcast and I am the host.',
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
    text: () => 'SeedBot! Dock! Run a battery diagnostic and do NOT apprehend the guest until I finish my thought. SeedBot? He\'s docking. He loves diagnostics. It\'s the only performance review he gets.',
    choices: [{ id: 'bye', label: 'Use the quiet.', next: '' }],
  },
  opened: {
    speaker: 'Tanner Pivotson',
    text: () => 'Fine. The gate is open. This is a collaborative process. Don\'t touch the runway. The runway is a metaphor I am very literal about. Write down that I chose this.',
    choices: [{ id: 'bye', label: 'Walk in.', next: '' }],
  },
  sided: {
    speaker: 'Tanner Pivotson',
    text: () => 'The side door is unlatched. You\'re on the schedule between "forgive the raccoons" and "invent a new kind of moat". I am choosing to be easy to work with.',
    choices: [{ id: 'bye', label: 'Take the door.', next: '' }],
  },
  coded: {
    speaker: 'Tanner Pivotson',
    text: () => 'One. Two. Three. Four. It tested well with users. The user was me. If you tell the raccoons, I\'ll deny this call happened. This call is happening.',
    choices: [{ id: 'bye', label: 'Remember it.', next: '' }],
  },
  after: {
    speaker: 'Tanner Pivotson',
    text: (c) =>
      c.has('debriefed')
        ? 'I heard the radio. Everyone heard the radio. Did she... did Vesper say anything about me? Specifically? A word? An adjective?'
        : 'You have the runway. I hope it makes you as unhappy as it made me. I\'m pivoting to forgiveness. Forgiveness is pre-revenue, but the logo is ready.',
    choices: [
      {
        id: 'reseller',
        label: 'She called you a reseller with a megaphone.',
        next: 'hurt',
        disabled: (c) => (c.has('debriefed') ? null : 'Mara hasn\'t read the names yet.'),
      },
      { id: 'bye', label: 'Leave him to it.', next: '' },
    ],
  },
  hurt: {
    speaker: 'Tanner Pivotson',
    text: () => 'A reseller. With a megaphone. ...That\'s two nouns. She thought about me long enough for two nouns. If you get to Apex, tell her Bunkr.ly delivered. Even if it didn\'t.',
    choices: [{ id: 'bye', label: 'Hang up on a man having a moment.', next: '' }],
  },
};

/** Hide asks the player has no reason to see yet. A greyed line means the next rank, not a locked tree. */
export function visibleChoices(nodeId: string, ctx: TalkCtx): TalkChoice[] {
  const node = TANNER[nodeId];
  if (!node) return [];
  return node.choices.filter((choice) => {
    if (nodeId !== 'hello') return true;
    const social = ctx.skill('social');
    if (choice.id === 'who' && social < 1) return false;
    if (choice.id === 'recall' && social < 1) return false;
    if (choice.id === 'gate' && social < 2) return false;
    if ((choice.id === 'side' || choice.id === 'code') && social < 4) return false;
    return true;
  });
}
