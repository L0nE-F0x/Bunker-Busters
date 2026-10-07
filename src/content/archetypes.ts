import type { ArchetypeDef } from './types';

/**
 * Six people the Compact would actually hand a radio.
 * Everyone starts with one unspent skill point on top of these ranks.
 * You will not fill the sheet in Act I. Pick a way in.
 *
 * Each one is tied to the story: somebody the Pivot, Tanner, or the Kade line already happened to.
 */
export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'infiltrator',
    name: 'Rue Calder',
    role: 'Infiltrator',
    tagline: 'Locks are just suggestions.',
    description:
      'Ex-courier. You delivered Tanner\'s last pallet the morning the sky turned, and he shut the door on your fingers. You still know the brand of his padlock.',
    motive: 'That pallet had the camp\'s name on it. You\'d like to finish the delivery.',
    briefing:
      'You\'re Rue Calder. You carried Tanner\'s last pallet to his door: meal shakes, with Last Chance on the label. He signed through a gap, then shut the gap on your fingers. You watched him film himself installing that padlock. Bring the pallet home. Late is still delivered.',
    journal:
      'Rue Calder. Courier. The last thing you ever delivered went to the wrong side of a door. Mara says that makes the lock your problem, which is her way of saying she trusts your hands.',
    coda: 'Rue, you finished the delivery. Two years late, and you still beat the postal service.',
    accent: '#3ff2e0',
    skills: { lockpicking: 2, stealth: 1 },
    carry: 0,
    stats: { stealth: 0.6, speed: 1.05, toughness: 0.85 },
    signature: { name: 'Ghost Step', description: 'SeedBot\'s meter fills 40% slower around you. Quiet was the job before it was a skill.' },
    playstyle: 'Quiet hands. Picks the gate, slips the drone.',
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
    tagline: 'Have you tried turning it off? Permanently?',
    description:
      'You wrote SeedBot\'s power-save so a dying battery would last one demo. Tanner shipped the brown-outs as a feature, then locked you out of the repo and the building.',
    motive: 'That drone still runs your code. You\'d like it to stop stealing in your handwriting.',
    briefing:
      'You\'re Nash Okonkwo. You wrote the brown-out: twelve percent battery, sold as a green feature. Tanner took your name off the repo the same week he took the camp\'s water. SeedBot still runs your routine. It was meant to last twelve minutes on a stage. It was never meant to tase anyone.',
    journal:
      'Nash Okonkwo. The brown-outs are yours. Slide 7 of Tanner\'s deck still has a line through the name where you used to be. You\'re here to pull the plug, and to stop being a footnote in his pitch.',
    coda: 'Nash, you switched off your own code. Next time somebody asks for a demo, ask what it\'s for.',
    accent: '#ff9d2e',
    skills: { electronics: 2, survival: 1 },
    carry: 0,
    stats: { stealth: 1, speed: 1, toughness: 1.12 },
    signature: { name: 'Jury-Rig', description: 'Electronics 2 from day one. You short keypads, and your EMPs keep SeedBot down half again as long.' },
    playstyle: 'Fries the drone, shorts the doors.',
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
      'You ran the warehouse that fed this camp, until the layoff came by email. Then Tanner\'s drone scanned the camp\'s meal shakes into his inventory.',
    motive: 'You\'re here to reverse a scan. Quiet is optional. The shakes and the water are not.',
    briefing:
      'You\'re Paz Duarte. Warehouse lead, past tense. The layoff was an email with a confetti emoji. The shakes were a pallet with the camp\'s name on the wrap, until SeedBot peeled it off. Mara says bring the water. You\'re also bringing the shakes, and you\'re allowed to be loud about the door.',
    journal:
      'Paz Duarte. The camp\'s stomach used to be your clipboard. Tanner\'s robot treated a food pallet like a product shot. You don\'t have a speech about it. You have a charge, a shoulder, and a list.',
    coda: 'Paz, the shakes are back in the log. Try not to enjoy the door part more than the food part.',
    accent: '#ff5a3c',
    skills: { demolition: 2, lockpicking: 1, survival: 1, firearms: 1 },
    carry: 6,
    stats: { stealth: 1.22, speed: 0.96, toughness: 1.3 },
    signature: { name: 'Shoulder', description: 'Charges are your first language. You carry 6 kg more, and a hit has to mean it.' },
    playstyle: 'Loud, heavy, hard to stop.',
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
      'You kept Tanner\'s investor calls from dying of honesty. You know his voice when a deal is about to fold: too bright, too fast, then a joke.',
    motive: 'A lock is just a conversation he already lost once. You were there for the first one.',
    briefing:
      'You\'re Len Cho. You used to sit on mute while Tanner promised bunkers to people who got tote bags. You know the fold: it starts cheerful and ends with him agreeing to your idea. The gate is a term sheet with hinges. Get him talking. Try not to enjoy it more than the water.',
    journal:
      'Len Cho. Professional agreement. Tanner thinks charm is a security system, and for a while it was. You were the one who aimed it. Mara handed you the radio because the camp can\'t pick every lock, and you know which sentence opens his.',
    coda: 'Len, you talked a man out of his own gate. Useful. Don\'t start liking the sound of it more than the jugs.',
    accent: '#c896ff',
    skills: { social: 2, lockpicking: 1 },
    carry: 0,
    stats: { stealth: 1, speed: 1.02, toughness: 0.9 },
    signature: { name: 'The Ask', description: 'Social 2 from day one. Tanner hears your pitch, and he\'ll send SeedBot home to "check the battery".' },
    playstyle: 'Talks the gate open.',
    startingItems: [
      { id: 'lockpick', qty: 3 },
      { id: 'ration', qty: 1 },
      { id: 'water', qty: 2 },
      { id: 'scrap', qty: 2 },
    ],
  },
  {
    id: 'scout',
    name: 'Juno Reyes',
    role: 'Scout',
    tagline: 'Water goes somewhere.',
    description:
      'County ranger, back when there was a county. You walked Dry Creek the summer it stopped running and wrote that the water was moved, not gone. Nobody read it.',
    motive: 'Somebody took a whole creek. You\'d like to know where they put it.',
    briefing:
      'You\'re Juno Reyes. You walked that creek bed the summer it died and wrote: not drought, extraction. The county filed it. The filing cabinet is under a dune now. You can walk farther on less than anyone in camp. Walk to the Garage. Then keep walking until you find where the creek went.',
    journal:
      'Juno Reyes. Ranger. Your report said the creek was taken, not lost. It got a stamp and a drawer. Mara gave you the radio because you read ground like other people read signs, and you never stopped asking where the water went.',
    coda: 'Juno, you were right about the creek. Being right is heavy. Put it down by the fire for one night.',
    accent: '#9ad86a',
    skills: { survival: 2, stealth: 1, firearms: 1 },
    carry: 3,
    stats: { stealth: 0.85, speed: 1.06, toughness: 1 },
    signature: { name: 'Long Walk', description: 'Hunger and thirst drain a quarter slower, and falls hurt a quarter less. You learned to walk on empty.' },
    perk: 'trail',
    playstyle: 'Walks far, lives light, finds the side way in.',
    startingItems: [
      { id: 'water', qty: 2 },
      { id: 'ration', qty: 2 },
      { id: 'noisemaker', qty: 2 },
      { id: 'lockpick', qty: 1 },
    ],
  },
  {
    id: 'defector',
    name: 'Theo Vance',
    role: 'Defector',
    tagline: 'I had a door. I gave it back.',
    description:
      'Founder of a meal-kit app for preppers. You bought a seat in Apex Vault, walked to the door on Pivot Day, saw who was paying for it, and turned around.',
    motive: 'Your name is on the Seed Manifest, in the column that got a door. You\'d like to cross it out yourself.',
    briefing:
      'You\'re Theo Vance. You raised a seed round for the end of the world, and the end of the world came. You had a seat in Apex. You saw the line outside, and what it was made of, and you walked back out. The camp isn\'t sure about you yet. Tanner will treat you like an old friend. Use that. Then stop using it.',
    journal:
      'Theo Vance. Former founder. You had a door and gave it back, which in this economy makes you a saint or an idiot. Mara hasn\'t decided. Dry Creek decided early. Tanner thinks you\'re still one of them, which is useful right up until it isn\'t.',
    coda: 'Theo, your name is still on that list. You can\'t cross it out with a pen. Keep doing it with your feet.',
    accent: '#e8c95a',
    skills: { electronics: 1, social: 1 },
    carry: 0,
    stats: { stealth: 1, speed: 1, toughness: 0.92 },
    signature: { name: 'Insider', description: 'Tanner hears you as one Social rank higher: you speak founder. Dry Creek hears you as one lower. They can tell.' },
    perk: 'insider',
    playstyle: 'Speaks founder. Dry Creek can tell.',
    startingItems: [
      { id: 'lockpick', qty: 2 },
      { id: 'emp', qty: 1 },
      { id: 'battery', qty: 2 },
      { id: 'water', qty: 1 },
      { id: 'nft_drive', qty: 1 },
      { id: 'scrap', qty: 4 },
    ],
  },
];
