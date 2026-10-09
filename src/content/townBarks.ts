/**
 * What the people of Dry Creek and the Cut say when you walk past, or when something goes bang.
 * One short line, positional, voiced (scripts/voice/ finds every `{ speaker, text }` here; re-voice
 * after editing), subtitled like any bark. The runner is src/game/town/barks.ts.
 *
 *  - hello: you came within a few steps of them, from further off
 *  - night: the same, after dark
 *  - armed: the same, with a gun out
 *  - shots: gunfire somewhere off in the desert
 *  - close: you fired near them
 */
export type BarkKind = 'hello' | 'night' | 'armed' | 'shots' | 'close';

export interface TownBark {
  speaker: string;
  kind: BarkKind;
  text: string;
  /** Only once this is true (story flags): news, said every other time while it applies. */
  when?: (has: (flag: string) => boolean) => boolean;
}

/** The street's reactions to what you've done. Merged into TOWN_BARKS below. */
const NEWS: Record<string, TownBark[]> = {
  nia: [
    { speaker: 'Nia Pell', kind: 'hello', when: (h) => h('apex.complete'), text: 'Water in the pipes. Real water. Sit down, I\'m making soup with it out of spite.' },
    { speaker: 'Nia Pell', kind: 'hello', when: (h) => h('act1.broadcast'), text: 'You\'re the voice off the radio. Sit. The soup heard you too.' },
    { speaker: 'Nia Pell', kind: 'hello', when: (h) => h('q.rider.delivered'), text: 'Stove lights first time now. Every time. I think of that boy every time.' },
    { speaker: 'Nia Pell', kind: 'night', when: (h) => h('q.chat.air'), text: 'Did you hear Dez do Vesper\'s voice? I laughed so hard I burnt the beans.' },
    { speaker: 'Nia Pell', kind: 'hello', when: (h) => h('q.song.band'), text: 'I\'ve had that song in my head for a week. I\'m not complaining. I\'m reporting.' },
  ],
  doc: [
    { speaker: 'Doc Ivers', kind: 'hello', when: (h) => h('q.doc.delivered'), text: 'Wick\'s cough is down to a rumble. Don\'t tell him I asked.' },
    { speaker: 'Doc Ivers', kind: 'hello', when: (h) => h('act1.deal'), text: 'Boil the Kade jugs. I don\'t care what the label says. Especially what the label says.' },
    { speaker: 'Doc Ivers', kind: 'night', when: (h) => h('q.nia.peace'), text: 'Nia sent over soup. For the sterilizer, she says. Sterilizers don\'t eat soup.' },
    { speaker: 'Doc Ivers', kind: 'hello', when: (h) => h('apex.complete'), text: 'Drink the water. It\'s clean. I checked. Twice. Three times.' },
    { speaker: 'Doc Ivers', kind: 'night', when: (h) => h('q.ada.told'), text: 'Dez read my letter on the band tonight. If she hears it, she hears it.' },
  ],
  inez: [
    { speaker: 'Inez Quill', kind: 'hello', when: (h) => h('q.inez.inez'), text: 'Welcome to my Till. Mine. Say it with me.' },
    { speaker: 'Inez Quill', kind: 'hello', when: (h) => h('q.inez.town'), text: 'The town\'s Till. Browse the town\'s shelves. Pay the town\'s prices. Weep the town\'s tears.' },
    { speaker: 'Inez Quill', kind: 'hello', when: (h) => h('lore.lifeboat'), text: 'Founder phones are going for six scrap on the east band. Bring me one. I won\'t ask where.' },
    { speaker: 'Inez Quill', kind: 'hello', when: (h) => h('apex.complete'), text: 'Water\'s free now. I\'ve had to diversify. Into what, I don\'t know yet. Gloating, possibly.' },
  ],
  sol: [
    { speaker: 'Sol Varga', kind: 'hello', when: (h) => h('q.sol.returned'), text: 'Roll\'s back where it belongs. So are my hands.' },
    { speaker: 'Sol Varga', kind: 'hello', when: (h) => h('q.song.quiet'), text: 'Mm. (He\'s humming. He doesn\'t stop this time.)' },
    { speaker: 'Sol Varga', kind: 'night', when: (h) => h('q.song.band'), text: 'Sunset, on the band. She\'d have liked the reach. Night\'s for listening.' },
    { speaker: 'Sol Varga', kind: 'hello', when: (h) => h('apex.complete'), text: 'Mm. Every tap in town is open. Nobody\'s locking anything tonight. Bad for business. Good for sleep.' },
  ],
  ren: [
    { speaker: 'Ren Oka', kind: 'hello', when: (h) => h('act1.deal'), text: 'Kade drone count this week: one. Jug count: nineteen. It\'s always nineteen.' },
    { speaker: 'Ren Oka', kind: 'hello', when: (h) => h('act1.broadcast'), text: 'Four hundred and six names. I counted. I lost count at the senators.' },
    { speaker: 'Ren Oka', kind: 'night', when: (h) => h('lore.walkwest'), text: 'Forty walked west, one week. I stopped counting the ones coming back.' },
    { speaker: 'Ren Oka', kind: 'hello', when: (h) => h('apex.complete'), text: 'Cistern trucks heading east. I lost count. I\'ve never been so happy to lose count.' },
  ],
  wick: [
    { speaker: 'Wick', kind: 'hello', when: (h) => h('q.wick.left'), text: 'Seep\'s running. Your share\'s in the jar. Don\'t make it weird.' },
    { speaker: 'Wick', kind: 'hello', when: (h) => h('q.wick.burned'), text: 'Still warm, that fire. I fed it a whole survey. Best meal it\'s had.' },
    { speaker: 'Wick', kind: 'night', when: (h) => h('lore.panopticon'), text: 'Blue light over the ridge again. Slow. Like it\'s reading.' },
    { speaker: 'Wick', kind: 'hello', when: (h) => h('apex.complete'), text: 'Heard the pipe sing last night, all the way up here. First song it\'s sung in years.' },
  ],
};

/** Keyed by the townsperson's npc id (world/npc.ts NpcDef.id). */
export const TOWN_BARKS: Record<string, TownBark[]> = {
  nia: [
    { speaker: 'Nia Pell', kind: 'hello', text: 'Counter\'s open. The menu is whatever survived.' },
    { speaker: 'Nia Pell', kind: 'hello', text: 'If you\'re hungry, sit. If you\'re thirsty, sit closer.' },
    { speaker: 'Nia Pell', kind: 'hello', text: 'Wipe your boots. The floor is the last clean thing in town.' },
    { speaker: 'Nia Pell', kind: 'hello', text: 'You again. The soup remembers you.' },
    { speaker: 'Nia Pell', kind: 'night', text: 'Kitchen\'s closed. The coffee isn\'t. Same thing, really.' },
    { speaker: 'Nia Pell', kind: 'night', text: 'Late for walking. The wolves keep longer hours than I do.' },
    { speaker: 'Nia Pell', kind: 'armed', text: 'Holster that. Nobody gets shot over soup.' },
    { speaker: 'Nia Pell', kind: 'armed', text: 'Point that somewhere I\'m not cooking.' },
    { speaker: 'Nia Pell', kind: 'shots', text: 'Gunfire. Somebody out there is having a bad quarter.' },
    { speaker: 'Nia Pell', kind: 'shots', text: 'That\'s close enough to burn the beans.' },
    { speaker: 'Nia Pell', kind: 'close', text: 'Not in my diner! Not near my diner! Not in view of my diner!' },
    { speaker: 'Nia Pell', kind: 'close', text: 'Every shot is a bottle I\'m not getting back.' },
  ],
  doc: [
    { speaker: 'Doc Ivers', kind: 'hello', text: 'Still in one piece? Good. Stay that way, I\'m low on thread.' },
    { speaker: 'Doc Ivers', kind: 'hello', text: 'If it\'s bleeding, come in. If it\'s feelings, see Nia.' },
    { speaker: 'Doc Ivers', kind: 'hello', text: 'Drink water. That\'s the whole prescription. It\'s always the whole prescription.' },
    { speaker: 'Doc Ivers', kind: 'hello', text: 'You look dehydrated. Everybody looks dehydrated. I say it anyway.' },
    { speaker: 'Doc Ivers', kind: 'night', text: 'Clinic\'s closed unless you\'re dying. Are you dying? Then tomorrow.' },
    { speaker: 'Doc Ivers', kind: 'night', text: 'Wash your hands. I can\'t stop saying it. It\'s a condition.' },
    { speaker: 'Doc Ivers', kind: 'armed', text: 'Put that away. I\'ve stitched enough people who were only holding one.' },
    { speaker: 'Doc Ivers', kind: 'armed', text: 'That is not a medical device. Holster it.' },
    { speaker: 'Doc Ivers', kind: 'shots', text: 'Gunshots. I\'ll boil the instruments.' },
    { speaker: 'Doc Ivers', kind: 'shots', text: 'Somebody out there is making work for me.' },
    { speaker: 'Doc Ivers', kind: 'close', text: 'I took an oath! You did not! Stop that!' },
    { speaker: 'Doc Ivers', kind: 'close', text: 'Every bullet you fire, I end up digging out of somebody.' },
  ],
  inez: [
    { speaker: 'Inez Quill', kind: 'hello', text: 'Browsing is free. Breathing on the shelves is not.' },
    { speaker: 'Inez Quill', kind: 'hello', text: 'Scrap talks. Everything else just stands there.' },
    { speaker: 'Inez Quill', kind: 'hello', text: 'If you\'re buying, smile. If you\'re selling, smile less.' },
    { speaker: 'Inez Quill', kind: 'hello', text: 'Welcome to the Till. All sales final. All refunds imaginary.' },
    { speaker: 'Inez Quill', kind: 'night', text: 'Closed means closed. Unless you have scrap. Then closed means open.' },
    { speaker: 'Inez Quill', kind: 'night', text: 'The Till never sleeps. I do. Lightly.' },
    { speaker: 'Inez Quill', kind: 'armed', text: 'Guns go on your hip. Not in my direction.' },
    { speaker: 'Inez Quill', kind: 'armed', text: 'Point that at the merchandise and you\'ve bought it. Full price.' },
    { speaker: 'Inez Quill', kind: 'shots', text: 'Gunfire. Ammo just went up two scrap. That\'s not greed. That\'s market discovery.' },
    { speaker: 'Inez Quill', kind: 'shots', text: 'Hear that? That\'s demand.' },
    { speaker: 'Inez Quill', kind: 'close', text: 'Every shot near my store goes on your tab!' },
    { speaker: 'Inez Quill', kind: 'close', text: 'Do you know what windows cost now? Neither does anyone!' },
  ],
  sol: [
    { speaker: 'Sol Varga', kind: 'hello', text: 'Mm. Fire\'s warm. Sit if you like.' },
    { speaker: 'Sol Varga', kind: 'hello', text: 'Every lock out there is tired. Be gentle with them.' },
    { speaker: 'Sol Varga', kind: 'hello', text: 'Thirty years of doors, and I still knock first.' },
    { speaker: 'Sol Varga', kind: 'hello', text: 'You walk like someone who\'s been told no by a padlock.' },
    { speaker: 'Sol Varga', kind: 'night', text: 'Night\'s for listening. The desert talks more after dark.' },
    { speaker: 'Sol Varga', kind: 'night', text: 'Stay by the light. The dark has opinions.' },
    { speaker: 'Sol Varga', kind: 'armed', text: 'Easy. Steel in the hand makes the hand stupid.' },
    { speaker: 'Sol Varga', kind: 'armed', text: 'A good pick opens more doors than that ever will.' },
    { speaker: 'Sol Varga', kind: 'shots', text: 'Mm. Somebody\'s arguing the hard way.' },
    { speaker: 'Sol Varga', kind: 'shots', text: 'Way off. Not ours to worry about. Yet.' },
    { speaker: 'Sol Varga', kind: 'close', text: 'Easy! You\'ll wake the whole street. What\'s left of it.' },
    { speaker: 'Sol Varga', kind: 'close', text: 'Put it away, friend. The fire\'s jumpy enough.' },
  ],
  ren: [
    { speaker: 'Ren Oka', kind: 'hello', text: 'Car count today: zero. Walker count: you.' },
    { speaker: 'Ren Oka', kind: 'hello', text: 'Hey. I\'m counting the road. You\'re the highlight.' },
    { speaker: 'Ren Oka', kind: 'hello', text: 'Don\'t mind me. I\'m watching nothing happen. It\'s going well.' },
    { speaker: 'Ren Oka', kind: 'hello', text: 'Quiet out there. Quiet is my favourite number.' },
    { speaker: 'Ren Oka', kind: 'night', text: 'Night shift. The road\'s even emptier in the dark.' },
    { speaker: 'Ren Oka', kind: 'night', text: 'I counted the stars once. Lost track at the good ones.' },
    { speaker: 'Ren Oka', kind: 'armed', text: 'Whoa. Okay. I\'ll count that as a no.' },
    { speaker: 'Ren Oka', kind: 'armed', text: 'Could you not? My mug and I are trying to relax.' },
    { speaker: 'Ren Oka', kind: 'shots', text: 'Shots. I\'m writing that down. I don\'t know why.' },
    { speaker: 'Ren Oka', kind: 'shots', text: 'That\'s three this week. Or one, three times.' },
    { speaker: 'Ren Oka', kind: 'close', text: 'Hey! Some of us are sitting here!' },
    { speaker: 'Ren Oka', kind: 'close', text: 'I spilled my mug. I want that on the record.' },
  ],
  wick: [
    { speaker: 'Wick', kind: 'hello', text: 'You climbed all this way. The view is free. The silence costs extra.' },
    { speaker: 'Wick', kind: 'hello', text: 'Visitor. That\'s two this year. Getting crowded.' },
    { speaker: 'Wick', kind: 'hello', text: 'Mind the edge. The edge doesn\'t mind you.' },
    { speaker: 'Wick', kind: 'hello', text: 'Don\'t touch the walls. They\'re load-bearing.' },
    { speaker: 'Wick', kind: 'night', text: 'Fire\'s small on purpose. Big fires get guests.' },
    { speaker: 'Wick', kind: 'night', text: 'The salt glows at night if you stare long enough. Don\'t.' },
    { speaker: 'Wick', kind: 'armed', text: 'Put that down. Caves are loud. Very loud. Forever loud.' },
    { speaker: 'Wick', kind: 'armed', text: 'You shoot in here, the mountain answers.' },
    { speaker: 'Wick', kind: 'shots', text: 'Gunfire down on the flats. Somebody\'s negotiating.' },
    { speaker: 'Wick', kind: 'shots', text: 'Hear that echo? That\'s the ridge laughing at somebody.' },
    { speaker: 'Wick', kind: 'close', text: 'Not in the cave! The cave remembers!' },
    { speaker: 'Wick', kind: 'close', text: 'My ears! I only have the two!' },
  ],
};
for (const [id, lines] of Object.entries(NEWS)) (TOWN_BARKS[id] ??= []).push(...lines);
