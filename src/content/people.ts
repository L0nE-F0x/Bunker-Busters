import type { PersonId } from './types';

/**
 * Everyone whose opinion of you is tracked, plus the two places that keep a collective grudge.
 * Standing runs from about -3 to +4. The Journal shows it as a word and pips; quests and talk change it.
 *
 * What standing actually does (wired in Settlement, Game and State):
 * - favours finished with someone unlock a service from them (a plate, house calls, a trade rate, water)
 * - anyone at 2 or more will say yes when you ask for a crew for Apex Vault, after Act I
 * - the Compact's standing changes what the camp gives you at the debrief
 */
export interface PersonView {
  has: (flag: string) => boolean;
  rep: (id: PersonId) => number;
}

export interface PersonDef {
  id: PersonId;
  /** Monogram colour on dialogue cards and in the journal. */
  accent: string;
  name: string;
  role: string;
  place: string;
  bio: string;
  /** When they show up in the Journal. */
  known: (v: PersonView) => boolean;
  /** What they say about the others. The first line whose `when` passes (or has none) is used per person. */
  about: { who: PersonId; line: string; when?: (v: PersonView) => boolean }[];
  /** Their view of you: cold (≤ -1), neutral (0), warm (1), trusts you (≥ 2). */
  ofYou: [string, string, string, string];
  faction?: boolean;
}

export const PEOPLE: PersonDef[] = [
  {
    id: 'mara', accent: '#ffb347', name: 'Mara Voss', role: 'Last Chance radio', place: 'Last Chance Gas',
    bio: 'Ran the county\'s water before the Pivot. Now she runs Last Chance\'s radio and its rations. Dry sense of humour, very tired, and the one everyone at the fire listens to.',
    known: (v) => v.has('briefed'),
    about: [
      { who: 'ezra', line: 'A man who watches everything is either the worst person in the valley or the only witness.', when: (v) => v.has('q.cam.hello') || v.has('q.chat.mara') },
      { who: 'pip', line: 'She hoped she\'d have a pool. I held the chalk.', when: (v) => v.has('q.capsule.mara') },
      { who: 'tanner', line: 'He\'s a middleman. I want whoever he\'s paying.' },
      { who: 'vesper', line: 'Don\'t listen to how she talks. Watch where the water goes.', when: (v) => v.has('debriefed') || v.has('tanner.kade') },
      { who: 'pip', line: 'Pip counts the jugs so I don\'t have to look.' },
    ],
    ofYou: [
      'You\'re still outside. That\'s the job. I\'ll keep reminding you.',
      'You\'re doing the job. Keep doing it.',
      'You come back with more than you left with. People notice.',
      'If I\'m ever not on this radio, you are.',
    ],
  },
  {
    id: 'hollis', accent: '#ff8a2a', name: 'Hollis Grange', role: 'Keeps the sign lit', place: 'Last Chance Gas',
    bio: 'Drove long-haul for thirty years. Keeps the neon sign running off a solar panel Tanner\'s contractor left behind, and won\'t hear of switching it off.',
    known: (v) => v.has('briefed'),
    about: [
      { who: 'ezra', line: 'Three years that camera watched me fix a sign. Hope he learned something.', when: (v) => v.has('q.cam.told') },
      { who: 'sol', line: 'Never met him. Heard his wife on the radio once, the afternoon it all went. I pulled over for her song.', when: (v) => v.has('q.song.hollis') },
      { who: 'mara', line: 'She signed something once. She\'s been paying for it in jugs ever since.', when: (v) => v.has('lore.permit') || v.has('debriefed') },
      { who: 'mara', line: 'Best dispatcher I ever had, and she never once lied about the weather.' },
      { who: 'pip', line: 'Kid\'s sharper than the knife I gave her.' },
    ],
    ofYou: [
      'The sign stays on for everybody. Even you.',
      'Road\'s long. Drink when you can.',
      'You\'ve got a trucker\'s sense of distance now. That\'s a compliment.',
      'I\'d let you drive the rig. If we still had a rig.',
    ],
  },
  {
    id: 'pip', accent: '#7ec8d4', name: 'Pip Okafor', role: 'Keeps the jug ledger · age 12', place: 'Last Chance Gas',
    bio: 'Twelve years old. Keeps the camp\'s water ledger in a notebook with a unicorn on the cover, and counts everything twice. Asks the questions the adults are too tired to.',
    known: (v) => v.has('briefed'),
    about: [
      { who: 'mara', line: 'Mara held the chalk. She\'s bad at ladders.', when: (v) => v.has('q.capsule.mara') },
      { who: 'vesper', line: 'She\'s in THE OTHER COLUMN. Page one.', when: (v) => v.has('q.chat.pip') },
      { who: 'mara', line: 'Mara says "later" when she means "no water".' },
      { who: 'dez', line: 'Dez says he can fix anything. He can\'t fix the tap.' },
      { who: 'tanner', line: 'If I met Tanner I\'d just ask him why. Just why.' },
    ],
    ofYou: [
      'You took the radio and didn\'t bring anything back. I wrote that down.',
      'Did you bring water? I\'m writing it down either way.',
      'You\'re in the ledger. The good column.',
      'I gave you a whole page. Nobody gets a whole page.',
    ],
  },
  {
    id: 'dez', accent: '#3ff2e0', name: 'Dez Marlow', role: 'Radio and wires', place: 'Last Chance Gas',
    bio: 'Built the camp radio out of a karaoke machine. Doesn\'t trust founders, satellites, or anyone who says "ecosystem". Swears Vesper Kade listens in on the band, and he\'s right.',
    known: (v) => v.has('briefed'),
    about: [
      { who: 'vesper', line: 'Since I read the chat on air she doesn\'t breathe between songs anymore. She holds it.', when: (v) => v.has('q.chat.air') },
      { who: 'ezra', line: 'Ezra named the Pivot. Ezra. Named. The Pivot. I need to go and sit in the car.', when: (v) => v.has('lore.pivotname') },
      { who: 'vesper', line: 'She\'s on our band. I can hear her breathing between songs.' },
      { who: 'tanner', line: 'His drone\'s firmware reads like a cry for help.' },
      { who: 'mara', line: 'Only boss I ever had who said sorry and meant it.' },
    ],
    ofYou: [
      'I\'ve checked your boots for trackers. Twice. Don\'t take it personally.',
      'You\'re fine. Don\'t touch the karaoke machine.',
      'You can touch the karaoke machine.',
      'If they ever cut our band, you\'re the first call I make on the backup.',
    ],
  },
  {
    id: 'nia', accent: '#e8a65a', name: 'Nia Pell', role: 'Cook, the diner', place: 'Dry Creek',
    bio: 'Runs the diner and feeds Dry Creek on credit, off a stove that only lights if you talk to it nicely. Writes everything down. Once a thing is written down, she can usually forgive it.',
    known: (v) => v.has('creek.talk.nia'),
    about: [
      { who: 'doc', line: 'Doc\'s family now. The irritating kind.', when: (v) => v.has('q.nia.peace') },
      { who: 'doc', line: 'He took my water and thought I couldn\'t count. I can count.', when: (v) => v.has('q.nia.told') },
      { who: 'doc', line: 'Somebody\'s drinking my ledger. I\'m not saying who. I\'m looking at the clinic.' },
      { who: 'inez', line: 'Inez would sell you the air if she could find a jar for it.' },
      { who: 'ren', line: 'Ren hasn\'t eaten a hot meal since the drive-in. I keep a plate warm anyway.' },
    ],
    ofYou: [
      'You eat, you pay, you go. That\'s the menu for you.',
      'You have the radio look. Sit down before you fall down.',
      'There\'s a plate with your name on it. I wrote it on in marker.',
      'You\'re in the ledger in ink. Nobody\'s in it in ink.',
    ],
  },
  {
    id: 'doc', accent: '#7fe0a0', name: 'Doc Ivers', role: 'The clinic', place: 'Dry Creek',
    bio: 'The only doctor within a day\'s walk. Proud, short-tempered and quietly generous. He patched up half of Tanner\'s customers when their bunker health plan turned out to be a tote bag.',
    known: (v) => v.has('creek.talk.doc'),
    about: [
      { who: 'nia', line: 'She feeds this town on credit. I patch it on credit. We are the economy.' },
      { who: 'wick', line: 'Wick has a cough I can hear from down here. He won\'t come in for it.' },
      { who: 'tanner', line: 'Sold a health plan with a bunker attached. Neither one existed.' },
    ],
    ofYou: [
      'I\'ll stitch you. I don\'t have to chat.',
      'Bleeding? Generator first. Then we talk.',
      'You do favours without being asked. Medically, that\'s rare.',
      'If you go down out there, I\'m walking out to get you. Don\'t make me.',
    ],
  },
  {
    id: 'inez', accent: '#c896ff', name: 'Inez Quill', role: 'The Till', place: 'Dry Creek',
    bio: 'Runs the Till, which is part store and part pawn shop. Keeps rooms locked that she says are empty. Sold forty hyperloop tickets before the Pivot and has never given a refund.',
    known: (v) => v.has('creek.talk.inez'),
    about: [
      { who: 'sol', line: 'Sol picked locks for money. Now he does it for gossip. Same hands.' },
      { who: 'nia', line: 'Nia\'s a saint with a ledger. I\'m just the ledger.' },
      { who: 'creek', line: 'This town would share its last bottle and then hold a meeting about it.' },
    ],
    ofYou: [
      'Cash, scrap, or the door. Your choice. It\'s the door.',
      'Browse. Don\'t palm. I can hear a hand.',
      'For you, the good prices. Don\'t tell Sol.',
      'You\'re the only customer I\'d let behind the counter. Don\'t make it weird.',
    ],
  },
  {
    id: 'sol', accent: '#ff6a3c', name: 'Sol Varga', role: 'Keeps the street fire', place: 'Dry Creek',
    bio: 'A locksmith for thirty years. Keeps the street fire going now and knows every lock in town. Recently locked himself out of his own motel room, and would rather you didn\'t mention it.',
    known: (v) => v.has('creek.talk.sol'),
    about: [
      { who: 'hollis', line: 'The trucker heard her. On the road, that afternoon. Somebody heard her. Mm.', when: (v) => v.has('q.song.hollis') },
      { who: 'inez', line: 'Inez locks rooms she says are empty. I could open them. I respect her too much.' },
      { who: 'doc', line: 'Doc walks past my fire at night with a jug. I don\'t ask. I notice.', when: (v) => !v.has('q.nia.told') && !v.has('q.nia.peace') },
      { who: 'doc', line: 'Doc and Nia are talking again. The street\'s quieter. I miss the drama.' },
      { who: 'ren', line: 'Ren counts trucks that stopped coming. Somebody has to.' },
    ],
    ofYou: [
      'You took my roll. My hands remember who.',
      'Fire\'s communal. Pull up a crate.',
      'You\'ve got good hands. Don\'t waste them on doors that open.',
      'Thirty years, and I\'d show you the trick I never showed anyone.',
    ],
  },
  {
    id: 'ren', accent: '#b9ab95', name: 'Ren Oka', role: 'Sits by the road', place: 'Dry Creek',
    bio: 'Ran the projector at the Starlite Drive-In. Walked out of the last show before it ended, and nobody else came out after. Has sat by the road ever since, counting things.',
    known: (v) => v.has('creek.talk.ren'),
    about: [
      { who: 'creek', line: 'We\'re not a town. We\'re a pause between thirsts.' },
      { who: 'nia', line: 'Nia keeps a plate warm for me. I keep not eating it. It\'s a whole thing.' },
      { who: 'sol', line: 'Sol thinks I don\'t see him watch the road too. I see him.' },
    ],
    ofYou: [
      'You\'re one more thing going past.',
      'Sit if you want. The road\'s not going anywhere.',
      'You came back. Most things on this road don\'t.',
      'I\'ll walk wherever you\'re walking. That\'s new for me.',
    ],
  },
  {
    id: 'wick', accent: '#a8b878', name: 'Wick', role: 'Lives in the Cut', place: 'The Cut, south ridge',
    bio: 'Lives in a cave on the south ridge, because the view was free. Answers the radio by not answering. Once watched Vesper Kade stand in his cave and decide not to buy it.',
    known: (v) => v.has('creek.talk.wick'),
    about: [
      { who: 'vesper', line: 'She looked at my view like she was pricing it. Then she didn\'t buy. I\'m still insulted.' },
      { who: 'doc', line: 'Doc thinks I\'m dying. I\'m just loud about breathing.' },
    ],
    ofYou: [
      'The fire\'s mine. The view\'s nobody\'s. You\'re neither.',
      'You found the cut. Most people find the highway and call it a life.',
      'You can sit. Don\'t talk. Okay, talk a little.',
      'Anybody comes up this wash for you, they come through me.',
    ],
  },
  {
    id: 'tanner', accent: '#ff3a6e', name: 'Tanner Pivotson', role: 'Founder, Bunkr.ly', place: 'The Garage',
    bio: 'Sold seats in other people\'s bunkers, then built his own out of the demo unit. Pays rent to Vesper Kade in other people\'s water. Still sends an investor update every Monday.',
    known: (v) => v.has('seen:garage'),
    about: [
      { who: 'vesper', line: 'She\'s my partner. I\'m her vendor. Those are different words for a reason.', when: (v) => v.has('tanner.kade') },
      { who: 'mara', line: 'Mara Voss? Brilliant woman. Terrible at upselling.' },
    ],
    ofYou: [
      'You are a security incident with a face.',
      'You are a lead. A warm lead. Please stop warming.',
      'Honestly? You\'d be great in sales.',
      'If you get to Apex, tell her Bunkr.ly delivered. Even if it didn\'t.',
    ],
  },
  {
    id: 'vesper', accent: '#f2f2ff', name: 'Vesper Kade', role: 'Apex Vault', place: 'West of the salt',
    bio: 'Rocket money, satellites, eleven million followers and a vault west of the salt. Thinks the camps are the free tier, and that she\'s saving the species. Listens in on the Compact\'s band.',
    known: (v) => v.has('debriefed') || v.has('tanner.kade') || v.has('cave.wick.vesper'),
    about: [
      { who: 'tanner', line: 'A reseller with a megaphone.' },
      { who: 'mara', line: 'Mara signed me a creek. I keep my promises. I kept her a seat.', when: (v) => v.has('debriefed') },
    ],
    ofYou: [
      'You\'re a churn risk with a lockpick.',
      'You\'re a user. Users are fine. Users are the point.',
      'You\'re interesting. I hate that. It\'s a compliment.',
      'You\'d make a great partner. That\'s the scariest thing I\'ve said this year.',
    ],
  },
  {
    id: 'ada', accent: '#9fc0dc', name: 'Ada Ivers', role: 'Doc\'s sister', place: 'Desk 7, then Dry Creek',
    bio: 'Number 2,212 in the Everafter line. She wrote to her brother at the clinic every month from her camp chair. When the line broke up, Ezra gave her a desk in the ring, and she watched the camps for him for two years.',
    known: (v) => v.has('panopticon.ada.met') || v.has('panopticon.ada.free'),
    about: [
      { who: 'doc', line: 'He still signs off "your annoying brother". Out loud, now.', when: (v) => v.has('panopticon.ada.free') },
      { who: 'doc', line: 'Tell him I\'m eating. He\'ll ask.' },
      { who: 'ezra', line: 'He read everything we wrote, every night. Nobody else ever has.' },
      { who: 'mara', line: 'If Mara gets her court, I\'ll stand up in it. I know what I saw.', when: (v) => v.has('panopticon.archive.take') },
    ],
    ofYou: [
      'You came for the water.',
      'You came for the water and stopped to talk. Most people don\'t.',
      'You told my brother where I was. Thank you.',
      'I watched people for two years. I know which ones keep their word.',
    ],
  },
  {
    id: 'ezra', accent: '#6f9cff', name: 'Ezra Seymour', role: 'Founder, Glimpse', place: 'The Panopticon, north of the salt',
    bio: 'Built Glimpse, the neighbourhood app that never forgot a face, and then a bunker with eleven hundred cameras in it. Came up with the name "the Pivot". Watches every camp he can reach, and honestly believes it\'s because he cares.',
    known: (v) => v.has('q.cam.hello') || v.has('lore.panopticon'),
    about: [
      { who: 'vesper', line: 'Vesper thinks she owns the water. I own the footage of her owning the water. Guess which one lasts.' },
      { who: 'tanner', line: 'Tanner\'s doorbell camera is a Glimpse. He talks to it. Every night. I don\'t reply. I want to.' },
      { who: 'hollis', line: 'He waves at the camera every morning. I wave back. He can\'t see it. That\'s the relationship.', when: (v) => v.has('q.cam.hello') },
    ],
    ofYou: [
      'You cut my feed. I still have the backups. I always have the backups.',
      'You\'re a face in the crowd. The crowd is very small now. I see you.',
      'You\'re trending. In a demographic of one. Me.',
      'If you ever want to see everything, you know where the door is. I\'ll know when you knock.',
    ],
  },
  {
    id: 'creek', accent: '#e0a050', name: 'Dry Creek', role: 'The town', place: 'West of the highway', faction: true,
    bio: 'A diner, a clinic, a store and a motel that used to sit on a creek. The creek stopped the summer before the Pivot. The people stayed.',
    known: (v) => v.has('seen:creek'),
    about: [],
    ofYou: [
      'The street goes quiet when you walk in.',
      'Another stranger with a radio.',
      'People wave. Some of them mean it.',
      'You\'re one of us, as far as anyone out here is one of anything.',
    ],
  },
  {
    id: 'compact', accent: '#ffb347', name: 'The Surface Compact', role: 'The camps that still answer', place: 'On the radio', faction: true,
    bio: 'Not an army. A radio net between the camps that still answer, held together by Mara, a karaoke machine and the rule on the receipt.',
    known: (v) => v.has('briefed'),
    about: [],
    ofYou: [
      'The camps hear your name and change the channel.',
      'The camps know there\'s a new voice on the radio.',
      'The camps say your name the way they say "rain".',
      'Other camps ask Mara if you\'re available. She says no. She means "maybe".',
    ],
  },
];

export const PERSON = Object.fromEntries(PEOPLE.map((p) => [p.id, p])) as Record<PersonId, PersonDef>;

/** -1 cold, 0 neutral, 1 warm, 2 trusts you. */
export function standingTier(rep: number): 0 | 1 | 2 | 3 {
  return rep <= -1 ? 0 : rep === 0 ? 1 : rep === 1 ? 2 : 3;
}

export const STANDING_WORD = ['Cold', 'Neutral', 'Warm', 'Trusts you'] as const;

/** "Nia", "Doc", "Dry Creek", "Compact": short enough for a toast or a reward line. */
export function shortName(id: PersonId) {
  if (id === 'creek') return 'Dry Creek';
  if (id === 'compact') return 'Compact';
  if (id === 'doc') return 'Doc';
  return PERSON[id]?.name.split(' ')[0] ?? id;
}
