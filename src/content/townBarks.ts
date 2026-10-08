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
}

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
