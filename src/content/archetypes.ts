import type { ArchetypeDef } from './types';

/**
 * Four people the Compact would actually hand a radio.
 * Everyone starts with one unspent skill point on top of these ranks.
 * You will not fill the sheet on the Garage. Pick a way in.
 */
export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'infiltrator',
    name: 'Rue Calder',
    role: 'Infiltrator',
    tagline: 'Locks are just suggestions.',
    description:
      'Ex-courier. You delivered Tanner\'s last pallet the morning the sky turned, and he shut the door on your fingers. You move quiet and you still know the brand of his padlock.',
    motive: 'The Compact gave you the radio because you watched him install the lock, on camera, for a video he never posted.',
    briefing:
      'You are Rue Calder. You delivered his last pallet of meal shakes. He signed through a gap in the door, then shut the gap. You know the padlock because he narrated the install to a camera. He never posted it. You remember the brand anyway.',
    journal:
      'Rue Calder. Courier, then a person the door closed on. The pallet was supposed to reach the camp. It reached a gap, and then the gap went away. Mara says that makes the lock your problem, which is her way of saying she trusts your hands.',
    coda: 'Rue, you were a delivery exception. Now the exception has the list. Don\'t let it turn you into a door.',
    accent: '#3ff2e0',
    skills: { lockpicking: 2, stealth: 1 },
    carry: 0,
    stats: { stealth: 0.6, speed: 1.05, toughness: 0.85 },
    signature: { name: 'Ghost Step', description: 'SeedBot fills its meter 40% slower around you. Quiet was the job before it was a skill.' },
    startingItems: [
      { id: 'lockpick', qty: 5 },
      { id: 'ration', qty: 1 },
      { id: 'water', qty: 1 },
    ],
  },
  {
    id: 'engineer',
    name: 'Nash Okonkwo',
    role: 'Engineer',
    tagline: 'Have you tried turning it off. Permanently?',
    description:
      'You wrote SeedBot\'s power-save so a dying battery would last a demo. Tanner shipped the brown-out as a feature, then locked the repo and the building.',
    motive: 'The drone falling asleep is your code, still loyal. You want it off, and your name off the slide that says team.',
    briefing:
      'You are Nash Okonkwo. You wrote the brown-out. Twelve percent battery, sold as a green feature. He locked you out of the repo the week he locked the building. SeedBot is still running your routine. It was never supposed to tase anyone. It was supposed to last twelve minutes on a stage.',
    journal:
      'Nash Okonkwo. The brown-outs are yours. Tanner called them a lifestyle and took your name off the repo. Slide 7 of the deck still has a crossed-out line where a person used to be. You are here to pull the plug, and to stop being a footnote in his empathy.',
    coda: 'Nash, the drone is a punchline with your handwriting. The next one will be smarter. Don\'t be its author twice.',
    accent: '#ff9d2e',
    skills: { electronics: 2, survival: 1 },
    carry: 0,
    stats: { stealth: 1, speed: 1, toughness: 1.12 },
    signature: { name: 'Jury-Rig', description: 'You already speak keypad. The EMP in your pack stays down longer than a stranger\'s.' },
    startingItems: [
      { id: 'lockpick', qty: 2 },
      { id: 'emp', qty: 1 },
      { id: 'ration', qty: 1 },
      { id: 'water', qty: 1 },
      { id: 'battery', qty: 1 },
    ],
  },
  {
    id: 'brute',
    name: 'Paz Duarte',
    role: 'Brute',
    tagline: 'Scan it back.',
    description:
      'You ran the warehouse that fed this camp. Laid off by email the week the trucks stopped. Tanner\'s drone scanned the meal shakes out of camp inventory and into his brand.',
    motive: 'You are here to reverse a scan. Quiet is a suggestion. The shakes, and the water under them, are not.',
    briefing:
      'You are Paz Duarte. Warehouse lead, past tense, their tense. The layoff was an email. The shakes were a pallet with the camp\'s name on the wrap. SeedBot lifted the wrap and left the name in the dust. Mara says bring the water. You are also bringing the shakes back, and you are allowed to be loud about the door.',
    journal:
      'Paz Duarte. The camp\'s stomach used to be your clipboard. Tanner\'s robot treated a food pallet like a product shot. You do not have a speech about it. You have a charge, a shoulder, and a list of what left the building that was not his.',
    coda: 'Paz, the shakes can go back in the log. Try not to become the person who scans things off other people.',
    accent: '#ff5a3c',
    skills: { demolition: 2, lockpicking: 1, survival: 1 },
    carry: 6,
    stats: { stealth: 1.22, speed: 0.96, toughness: 1.3 },
    signature: { name: 'Shoulder', description: 'Charges are a first language. You carry more, and a hit has to mean it.' },
    startingItems: [
      { id: 'lockpick', qty: 2 },
      { id: 'charge', qty: 2 },
      { id: 'ration', qty: 2 },
      { id: 'water', qty: 1 },
    ],
  },
  {
    id: 'fixer',
    name: 'Len Cho',
    role: 'Fixer',
    tagline: 'He funds whatever he says out loud.',
    description:
      'You kept Tanner\'s investor calls from dying of honesty. You know the voice he uses when a term sheet is about to fold: too bright, too fast, then a joke.',
    motive: 'The Compact sent you because a lock is a conversation he has already lost once.',
    briefing:
      'You are Len Cho. You used to sit on mute while Tanner promised bunkers to people who would receive tote bags. You know the fold. It starts cheerful. It ends with him agreeing to his own idea. The gate is a term sheet with hinges. Get him talking. Do not enjoy it more than the water.',
    journal:
      'Len Cho. Professional agreement. Tanner thinks charm is a security system. It was, for a while, and you were the one who aimed it. Mara handed you the radio because the camp cannot pick every lock, and because you already know which sentence makes him open a door to feel powerful.',
    coda: 'Len, you talked a man out of his own gate. Useful. Don\'t start liking the sound of it more than the jugs.',
    accent: '#c896ff',
    skills: { social: 2, lockpicking: 1 },
    carry: 0,
    stats: { stealth: 1, speed: 1.02, toughness: 0.9 },
    signature: { name: 'The Ask', description: 'He treats your voice like a term sheet. You can already send the drone home to "check the battery".' },
    startingItems: [
      { id: 'lockpick', qty: 3 },
      { id: 'ration', qty: 1 },
      { id: 'water', qty: 2 },
      { id: 'scrap', qty: 2 },
    ],
  },
];
