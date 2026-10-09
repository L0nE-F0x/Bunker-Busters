import type { PersonId } from './types';
import { lifeboatCount } from './quests';

/**
 * The people around Last Chance's fire. They live in the camp panel (no 3D figures): you talk to
 * them between rests. Lines move with the story. A few choices do something (Game applies them):
 *   `gift`    Hollis hands over a noisemaker, once
 *   `donate`  two bottles into Pip's ledger (the Fill the Ledger quest)
 *   `emp`     Dez packs an EMP from a cell and scrap, no Electronics needed
 * The founders' favours (Read Receipts, Class of Tomorrow, Seen) are applied by sites/stories.ts.
 */
export interface CampView {
  has: (flag: string) => boolean;
  count: (item: string) => number;
  rep: (id: PersonId) => number;
  name: string;
  /** After dark (the talk changes), and how many nights you've slept here (the band's rumour). */
  night?: boolean;
  rests?: number;
}

/**
 * What the band says tonight: Dez's pick of the night's chatter, one per rest, each pointing at a
 * real place. Hearing one sets `rumour.<intel>` (the map shows that pickup) or names a site.
 */
export interface Rumour { id: string; text: string; intel?: string; when?: (v: CampView) => boolean }
export const RUMOURS: Rumour[] = [
  {
    id: 'drone', intel: 'intel.chat.8',
    text: 'Camp up on the ridge road says a white drone came down under the Spire, way back, and its little blue light still blinks at night. Glimpse drones carry memory cards. Memory cards carry memories. That\'s the whole business model.',
  },
  {
    id: 'walker', intel: 'intel.west.letter',
    text: 'People used to walk west on Bunkr.ly receipts. Ren counted forty in one week, back when Ren counted things for fun. Somebody sat down on the shoulder of the west road and never got up. Check his pack. He\'d want it used.',
  },
  {
    id: 'briefcase', intel: 'intel.chat.4',
    text: 'Trucker on 19 swears there\'s a briefcase on the east highway shoulder, by a wreck past Recovery Point 7, and it glows at night. He won\'t touch it. He calls it "founder luggage" and crosses himself.',
  },
  {
    id: 'watch', intel: 'intel.chat.7',
    text: 'Somebody\'s watch buzzes out on the west highway at three every morning. You can hear it if the wind\'s right. The wind is never right. The watch doesn\'t care.',
  },
  {
    id: 'poster', intel: 'intel.kade.poster',
    text: 'Kade\'s break room at Pipeline Camp 3 has a motivational poster. I would like a photo of it. For morale. Theirs, not ours. Ours is fine.',
  },
  {
    id: 'pod', intel: 'intel.chat.6',
    text: 'Inez sold forty tickets for the Tube. One of the pods out there still has a lit screen, if the kids on the east band are telling the truth, and they never are, except about this.',
  },
  {
    id: 'kdry', intel: 'intel.kdry.log',
    text: 'Dry Creek had a radio station, before. KDRY, 1340 on the dial. The log is still sitting on a crate by the road out of town, they say. Ask Sol about it. Actually, don\'t ask Sol about it.',
  },
  {
    id: 'tablet', intel: 'intel.chat.3',
    text: 'The Wellhead crew lost a site manager\'s tablet the week they moved in. Kade billed him for it. He\'s still paying it off in shifts. It\'s under a tree by the tank, if you\'re feeling brave and armed.',
  },
  {
    id: 'flyer', intel: 'intel.glimpse.flyer',
    text: 'Somebody\'s zip-tied a Glimpse flyer to a pole on the highway, past Greg\'s call box. Neighbourhood watch. There\'s no neighbourhood. There\'s still watch.',
  },
];

/** Tonight's rumour: one per rest, skipping the ones whose pickup you've already read. */
export function rumourTonight(v: CampView): Rumour | null {
  const open = RUMOURS.filter((r) => (!r.intel || !v.has(`intel:${r.intel}`)) && (!r.when || r.when(v)));
  if (!open.length) return null;
  return open[(v.rests ?? 0) % open.length];
}

export interface CampLine {
  speaker: string;
  text: string;
  choices: { id: string; label: string; disabled?: string; next?: string }[];
}

export interface CampMember {
  id: PersonId;
  name: string;
  role: string;
  present: (v: CampView) => boolean;
  node: (id: string, v: CampView) => CampLine | null;
}

const stage = (v: CampView) =>
  v.has('debriefed') ? 'after' : v.has('garage.complete') ? 'back' : v.has('intel:intel.gas.note') ? 'job' : 'start';

export const CAMP: CampMember[] = [
  {
    id: 'hollis',
    name: 'Hollis Grange',
    role: 'Keeps the sign lit',
    present: () => true,
    node: (id, v) => {
      if (id === 'road') {
        return {
          speaker: 'Hollis Grange',
          text: 'Drink before you\'re thirsty. Crouch before you\'re seen. Never trust a man with a banner. And if you\'re lost, find the highway. It doesn\'t go anywhere good, but it goes.',
          choices: [{ id: 'back', label: 'Thanks, Hollis.', next: 'hello' }],
        };
      }
      if (id === 'rider') {
        return {
          speaker: 'Hollis Grange',
          text: 'Channel 19\'s been quiet. There\'s a kid calls himself Rider 9. Rides a delivery e-bike for an app called Dropt: anything, anywhere, ten minutes or it\'s free. The app never told him to stop, so he never did. He checks in every week. He\'s missed four. Last I heard him, he was cutting across the north flats past the Kade Wellhead.',
          choices: [{ id: 'back', label: 'I\'ll look for him.', next: 'hello' }],
        };
      }
      if (id === 'ridertell') {
        return {
          speaker: 'Hollis Grange',
          text: 'You found him. I can see it. Say it straight, or say it kind. I\'ve had both on this radio.',
          choices: [
            { id: 'rider.truth', label: 'He didn\'t make it. He finished the route anyway.', next: 'ridertruth' },
            { id: 'rider.west', label: 'He rode west. Said to keep 19 open.', next: 'riderwest' },
            { id: 'back', label: 'Not yet.', next: 'hello' },
          ],
        };
      }
      if (id === 'ridertruth') {
        return {
          speaker: 'Hollis Grange',
          text: 'Course he did. Kid never dropped an order in his life. Here. My last box of rounds for that old .38. I won\'t be needing them to wait up for anybody.',
          choices: [{ id: 'bye', label: 'I\'m sorry, Hollis.' }],
        };
      }
      if (id === 'riderwest') {
        return {
          speaker: 'Hollis Grange',
          text: 'West. Huh. Good for him. Somebody ought to get out ahead of the rest of us. I\'ll keep 19 open, then. In case he rings the bell.',
          choices: [{ id: 'bye', label: 'Keep it open.' }],
        };
      }
      if (id === 'blink') {
        return {
          speaker: 'Hollis Grange',
          text: 'That? Little camera on the pole by the road, east of the pumps. Blue light. It\'s been blinking at me for three years. I don\'t like things that blink at me unless they\'re signs. Somebody is watching us eat beans. Find out who. Then make them stop, or make them sorry.',
          choices: [{ id: 'back', label: 'I\'ll take a look.', next: 'hello' }],
        };
      }
      if (id === 'camtold') {
        const text = v.has('q.cam.cut')
          ? 'Pulled it, did you. (He looks at the pole a long time.) Light\'s out. Huh. The forecourt sounds different. Quieter, like a truck stop at four in the morning. Here. Rounds, and scrap for the next thing that blinks.'
          : v.has('q.cam.loop')
            ? 'A loop. So whoever it is watches an empty forecourt at dusk, forever, and thinks we\'re gone. (He laughs, once.) Best lie anybody ever told on my behalf. Leave Dez\'s lunchbox on the pole. It suits it.'
            : 'You talked to him. A man in a hole north of the salt, who knows how I take my coffee. (He waves at the camera. Slowly. Not friendly.) Fine. Let him watch. He can watch me keep a sign lit for people who aren\'t him.';
        return { speaker: 'Hollis Grange', text, choices: [{ id: 'bye', label: 'Keep the sign on.' }] };
      }
      if (id === 'songhollis') {
        return {
          speaker: 'Hollis Grange',
          text: 'I did. Pulled over for it. A woman\'s voice first, tired and kind: "This one\'s for whoever is still here." Then a slow one. Piano. A key change near the end that went right through the windscreen. I could hum you the chorus. I won\'t. Ask Dez. Dez has every song.',
          choices: [{ id: 'back', label: 'Whoever is still here.', next: 'hello' }],
        };
      }
      if (id === 'pivot') {
        return {
          speaker: 'Hollis Grange',
          text: 'The afternoon of the Pivot? Eastbound, a load of patio furniture, two hundred miles out. The radio said markets halted. Then the radio said the sky was an unusual colour. Then the radio played one song and stopped. I pulled over and listened to the whole song. Never found out who sang it.',
          choices: [{ id: 'back', label: 'Patio furniture.', next: 'hello' }],
        };
      }
      if (id !== 'hello') return null;
      const lines = {
        start: 'Name\'s Hollis. I keep the sign lit. Thirty years of driving, and the only thing I ever owned outright is that neon. Off you go. The road doesn\'t get shorter by looking at it.',
        job: 'The Garage is up the spur. I drove past it once, before. He had a banner out front: DISRUPTING DOOMSDAY. He spelled "doomsday" wrong.',
        back: 'You\'ve got the walk of somebody carrying water. Best walk there is. Go tell Mara before Pip counts it twice.',
        after: v.has('act1.broadcast')
          ? 'Two weeks of water and every camp on the band angry at the same woman. I\'ve driven on worse fuel. The sign stays on.'
          : v.has('act1.leverage')
            ? 'Mara checks the ammo tin every morning like it\'s an engine. The sign stays on. Free trial or not.'
            : 'Twenty jugs a week, on her schedule. I drink them. I don\'t thank her. The sign stays on for everybody, even the drone that brings them.',
      };
      let text = lines[stage(v)];
      if (v.night && stage(v) !== 'start') text = 'Late. The neon hums louder at night, or I listen harder. ' + text;
      if (v.has('lore.permit') && !v.has('debriefed')) {
        text += ' And you found Mara\'s paper. She told me years ago. Don\'t hold it against her longer than she does. Nobody could.';
      }
      if (v.has('q.cam.cut')) text += ' Sleeping better since that light went out.';
      else if (v.has('q.cam.hello')) text += ' (He glances at the pole by the road, and doesn\'t wave.)';
      const camOpen = v.has('q.cam.cut') || v.has('q.cam.loop') || v.has('q.cam.hello');
      return {
        speaker: 'Hollis Grange',
        text,
        choices: [
          { id: 'road', label: 'Any road advice?', next: 'road' },
          ...(!v.has('hollis.rider') ? [{ id: 'rider', label: 'Heard anything on the CB?', next: 'rider' }] : []),
          ...(v.has('q.rider.log') && !v.has('q.rider.truth') && !v.has('q.rider.west') ? [{ id: 'ridertell', label: 'About Rider 9...', next: 'ridertell' }] : []),
          ...(!v.has('hollis.camera') && !v.has('q.cam.seen') ? [{ id: 'blink', label: 'What\'s that blinking by the road?', next: 'blink' }] : []),
          ...(camOpen && !v.has('q.cam.told') ? [{ id: 'cam.told', label: 'About that camera...', next: 'camtold' }] : []),
          ...(v.has('q.song.asked') && !v.has('q.song.hollis') ? [{ id: 'song.hollis', label: 'You heard one song on the radio, that afternoon. Which one?', next: 'songhollis' }] : []),
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          { id: 'gift', label: 'What\'s in the can?', disabled: v.has('camp.hollis.gift') ? 'He already gave you the can.' : undefined, next: 'hello' },
          { id: 'bye', label: 'See you, Hollis.' },
        ],
      };
    },
  },
  {
    id: 'pip',
    name: 'Pip Okafor',
    role: 'Keeps the jug ledger',
    present: () => true,
    node: (id, v) => {
      if (id === 'school') {
        return {
          speaker: 'Pip Okafor',
          text: 'Kade Kids Academy. The one Mara traded the creek for. I went for eleven days. It had a rocket on the sign and a water fountain you weren\'t allowed to drink from. The first week we buried a time capsule, for 2046. Kade paid for it. I want my letter back. I wrote something stupid in it and I want to know how stupid. It\'s west of Dry Creek. What\'s left of it.',
          choices: [{ id: 'back', label: 'I\'ll dig it up.', next: 'hello' }],
        };
      }
      if (id === 'letter') {
        return {
          speaker: 'Pip Okafor',
          text: v.has('q.capsule.read')
            ? 'That\'s my handwriting. (She looks at the flap. Then at you.) The fold is wrong.'
            : 'That\'s my handwriting. That\'s the sticker. They gave everyone the same sticker. Give it here. Or. Don\'t. I don\'t know. Give it here.',
          choices: [
            { id: 'letter.sealed', label: 'Here. Sealed, like you left it.', disabled: v.has('q.capsule.read') ? 'You read it. She\'d know. She already knows.' : undefined, next: 'sealed' },
            ...(v.has('q.capsule.read') ? [{ id: 'letter.peeked', label: 'I read it. I\'m sorry. Here.', next: 'peeked' }] : []),
            { id: 'letter.mara', label: 'Mara should be the one to give you this.', next: 'maraletter' },
            { id: 'back', label: 'Not yet.', next: 'hello' },
          ],
        };
      }
      if (id === 'sealed') {
        return {
          speaker: 'Pip Okafor',
          text: 'Thank you. I\'m going to read it behind the pumps. Don\'t follow me. (Later, there\'s a pool on the forecourt, in chalk, with a ladder.) "I hope you have a pool." I have a pool. Don\'t walk on it.',
          choices: [{ id: 'bye', label: 'I won\'t walk on it.' }],
        };
      }
      if (id === 'peeked') {
        return {
          speaker: 'Pip Okafor',
          text: 'At least you said. Most grown-ups don\'t say. (She reads it anyway, right there.) "I hope you have a pool." That\'s so stupid. (She draws one, in chalk, on the forecourt. It takes her an hour.) You\'re in a column now. I\'m not telling you which.',
          choices: [{ id: 'bye', label: 'Fair.' }],
        };
      }
      if (id === 'maraletter') {
        return {
          speaker: 'Pip Okafor',
          text: 'Mara? Why Mara. (She looks at the radio for a long time.) ...Because she signed for the school. Okay. Okay. Tell her to come out from behind the radio, then. She can hold the chalk.',
          choices: [{ id: 'bye', label: 'I\'ll tell her.' }],
        };
      }
      if (id === 'pivot') {
        return {
          speaker: 'Pip Okafor',
          text: 'I was in the car with my mom. We were going to get my teeth looked at. Everything stopped, the lights and the phones and the road, all at once, like someone pulled a plug. Mom said "huh". That\'s the last normal thing anyone said. I wrote it down. "Huh."',
          choices: [{ id: 'back', label: 'Huh.', next: 'hello' }],
        };
      }
      if (id !== 'hello') return null;
      const given = v.has('q.pip.2') ? 2 : v.has('q.pip.1') ? 1 : 0;
      const lines = {
        start: 'I\'m Pip. I do the ledger. Three days of water, two if Hollis keeps washing his face. Bring some back and I\'ll write you in the good column.',
        job: 'Did you find his water yet? I left a line in the ledger for it. It\'s empty. It looks at me.',
        back: 'Is that the cistern water? Is it clean? How many? Don\'t answer, I\'m counting.',
        after: v.has('act1.deal')
          ? 'Her jugs came on time. I wrote them in pencil. Mara says pencil is for things you don\'t trust.'
          : v.has('act1.leverage')
            ? 'The ledger\'s in the ammo tin now, under the radio. I made a copy. Mara doesn\'t know. Now you know. Don\'t tell her.'
            : 'The ledger goes further now. Not far enough. Mara says that\'s what "west" is for.',
      };
      let extra = given === 2 ? ' You have a whole page now. Nobody gets a whole page.' : given === 1 ? ' You\'re in the good column. Two more and you get a page.' : '';
      if (v.has('q.capsule.sealed') || v.has('q.capsule.mara')) extra += ' Don\'t walk on my pool.';
      else if (v.has('q.capsule.peeked')) extra += ' You\'re still in the column. Don\'t walk on the pool.';
      if (v.has('q.chat.pip')) extra += ' THE OTHER COLUMN is four pages now. I\'m practising the voices for the trial.';
      if (v.has('q.rider.west') && !v.has('q.capsule.peeked')) extra += ' And I heard what you told Hollis about Rider 9. I wrote it down. I wrote down why, too.';
      if (v.night && stage(v) !== 'start') extra += ' I\'m not tired. I\'m counting stars. It\'s the same as counting jugs but they don\'t run out.';
      const water = v.count('water');
      const letter = v.has('q.capsule.dug') && !v.has('q.capsule.sealed') && !v.has('q.capsule.peeked') && !v.has('q.capsule.mara');
      return {
        speaker: 'Pip Okafor',
        text: lines[stage(v)] + extra,
        choices: [
          ...(!v.has('pip.capsule') && stage(v) !== 'start' ? [{ id: 'school', label: 'Did you go to school out here?', next: 'school' }] : []),
          ...(letter ? [{ id: 'letter', label: 'I found the time capsule.', next: 'letter' }] : []),
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          {
            id: 'donate',
            label: 'Put two bottles in the ledger.',
            disabled: given >= 2 ? 'The page is full. Pip says thank you in capital letters.' : water < 2 ? `You have ${water} bottle${water === 1 ? '' : 's'}. Two, or Pip won\'t write it down.` : undefined,
            next: 'hello',
          },
          { id: 'bye', label: 'Keep counting, Pip.' },
        ],
      };
    },
  },
  {
    id: 'dez',
    name: 'Dez Marlow',
    role: 'Radio and wires',
    present: () => true,
    node: (id, v) => {
      if (id === 'listen') {
        return {
          speaker: 'Dez Marlow',
          text: 'There\'s a carrier on our band that doesn\'t belong to any camp. It breathes between songs. Mara thinks I\'m paranoid. Mara is wrong. I know exactly how that sounds.',
          choices: [{ id: 'back', label: 'I believe you.', next: 'hello' }],
        };
      }
      if (id === 'badges') {
        const n = v.count('kade_badge');
        return {
          speaker: 'Dez Marlow',
          text: 'Kade lanyards. Every crew reads its badge numbers onto the air at shift change, because policy. Those badges have chips in them, and chips talk. Bring me three and I\'ll find the channel they talk on.',
          choices: [
            { id: 'badges.give', label: 'Here. Three smiling faces. (3 lanyards)', disabled: n >= 3 ? undefined : `You have ${n}. Kade contractors wear them. So do some Kade crates.`, next: 'relay' },
            { id: 'back', label: 'I\'ll find some.', next: 'hello' },
          ],
        };
      }
      if (id === 'relay') {
        return {
          speaker: 'Dez Marlow',
          text: 'They smile because the policy says so. Okay. The chips ping on a crew channel, but the karaoke machine can\'t hear it from down here. Take this relay up to the Spire and patch it into the generator by the shack. Red to red. Don\'t lick anything.',
          choices: [{ id: 'back', label: 'Red to red.', next: 'hello' }],
        };
      }
      // the crew channel, once the relay is up: three overheard lines, then Dez
      if (id === 'kade1') {
        return {
          speaker: 'Kade Recovery',
          text: 'Road pair two, clocking in. Mood: aligned. Hydration: compliant. Reminder from People Ops: repossessed pianos are not break-room furniture.',
          choices: [{ id: 'more', label: '(Keep listening.)', next: 'kade2' }],
        };
      }
      if (id === 'kade2') {
        return {
          speaker: 'Kade Recovery',
          text: 'Survey Camp to Wellhead. The ridge seep is a data asset now. We stake it Friday. Somebody tell the guy in the cave he\'s been rebranded.',
          choices: [{ id: 'more', label: '(Keep listening.)', next: 'kade3' }],
        };
      }
      if (id === 'kade3') {
        return {
          speaker: 'Kade Recovery',
          text: 'Apex wants the pipeline numbers by the end of the quarter. Does anyone know which quarter it is? Asking for the whole team.',
          choices: [{ id: 'more', label: '(Take the headphones off.)', next: 'listened' }],
        };
      }
      if (id === 'listened') {
        return {
          speaker: 'Dez Marlow',
          text: 'You hear that? They\'re scheduled. They\'re scheduled like a dentist. I could sit on this channel and call you every time a road pair clocks in near you. Or. Hear me out. The karaoke machine has a power ballad in it that has never been played at full volume.',
          choices: [
            { id: 'dez.ears', label: 'Keep listening. Warn me when they\'re close.', next: 'ears' },
            { id: 'dez.karaoke', label: 'Play them the ballad.', next: 'karaoke' },
          ],
        };
      }
      if (id === 'ears') {
        return {
          speaker: 'Dez Marlow',
          text: 'Quiet it is. Keep your radio on. When a pair clocks in near you, you\'ll hear me before you see them.',
          choices: [{ id: 'bye', label: 'I\'ll keep it on.' }],
        };
      }
      if (id === 'karaoke') {
        return {
          speaker: 'Dez Marlow',
          text: 'Four minutes. Key change at three. Every Kade radio in the valley. They\'ll change channels by morning and I don\'t care. This was always the plan. This was always the plan.',
          choices: [{ id: 'bye', label: 'Don\'t touch the key change.' }],
        };
      }
      if (id === 'lifeboat') {
        return {
          speaker: 'Dez Marlow',
          text: 'Something syncs on our band at three every morning. A group chat, called LIFEBOAT. Founders. Seven of them, and Tanner, who keeps rejoining. It comes in pieces: every phone and watch and tablet that died out here still holds its last page, and they all try to sync at once. Find me the pieces. I\'ll ping you where the next one is. I have never wanted anything more. Including the karaoke machine.',
          choices: [{ id: 'back', label: 'I\'ll find the pieces.', next: 'hello' }],
        };
      }
      if (id === 'pages') {
        const n = lifeboatCount(v);
        const said = n >= 6
          ? 'They planned the seating chart. They planned who was thirsty first. And Ezra, Ezra watched it all from somewhere with eleven hundred cameras. Two more pages. Two.'
          : n >= 4
            ? 'They named it. "Pivot. Everybody forgives a pivot." Like a product. Like a launch. I had to go and sit in the car for a while.'
            : n >= 2
              ? 'They saw it coming. Eleven weeks of warning, and they spent it buying water. Keep going.'
              : n === 1
                ? 'One page. It\'s them. It\'s really them. Keep going. The map has the next one.'
                : 'Nothing yet. The map has the next one. I triangulated it at three this morning in my socks.';
        return { speaker: 'Dez Marlow', text: `${n} of 8. ${said}`, choices: [{ id: 'back', label: 'Keep listening, Dez.', next: 'hello' }] };
      }
      if (id === 'chat8') {
        return {
          speaker: 'Dez Marlow',
          text: 'All eight. LIFEBOAT, every page. They named the end of the world like a product, then they sold the seats, then they watched. And not one of them ever typed "us". So. What\'s it for?',
          choices: [
            { id: 'chat.air', label: 'Read it on the open net. Do the voices.', next: 'aired' },
            { id: 'chat.mara', label: 'Mara keeps the evidence. Give it to her.', next: 'mara' },
            { id: 'chat.pip', label: 'Pip\'s ledger. She\'ll want the other column.', next: 'pip' },
            { id: 'back', label: 'Let me think.', next: 'hello' },
          ],
        };
      }
      if (id === 'aired') {
        return {
          speaker: 'Dez Marlow',
          text: 'Clearing my throat. Clearing it again. (He reads all eight pages on the open band, and does the voices. Vesper\'s is unkind. Tanner\'s is very kind.) ...That\'s the most listeners this band has ever had. And one of them has stopped breathing between songs.',
          choices: [{ id: 'bye', label: 'Good show, Dez.' }],
        };
      }
      if (id === 'mara') {
        return {
          speaker: 'Dez Marlow',
          text: 'Evidence. Yeah. Fine. She\'ll laminate it. Mara laminates things when she\'s angry. I\'m keeping a copy in my head and I\'m doing the voices in there.',
          choices: [{ id: 'bye', label: 'Do the voices quietly.' }],
        };
      }
      if (id === 'pip') {
        return {
          speaker: 'Dez Marlow',
          text: 'Pip\'s ledger. Yeah. That\'s where it goes. (He hands it over like it\'s hot.) Pip, there\'s a new column for you. Don\'t do the voices. Okay, do the voices.',
          choices: [{ id: 'bye', label: 'She\'ll do the voices.' }],
        };
      }
      if (id === 'songdez') {
        return {
          speaker: 'Dez Marlow',
          text: v.has('q.dez.karaoke')
            ? 'Piano, slow, key change near the end, "whoever is still here"... that\'s the ballad. THE ballad. The one I played into Kade\'s channel. "Still Here", June Hollow, 1994. Of course it is. The karaoke machine has always had it. I can put it on the open band at sunset, the way she did. Or I write the words down and you take them to him.'
            : 'Piano, slow, key change near the end, "whoever is still here"... (He scrolls for a long time.) "Still Here". June Hollow, 1994. Track forty-one. Never been played at full volume. I can put it on the open band at sunset, the way she did. Or I write the words down and you take them to him.',
          choices: [{ id: 'back', label: 'Let me ask Sol which.', next: 'hello' }],
        };
      }
      if (id === 'rumour') {
        const r = rumourTonight(v);
        return {
          speaker: 'Dez Marlow',
          text: r
            ? `${v.night ? 'Tonight' : 'Last night'} on the band: ${r.text}`
            : 'Quiet on the band. Everybody\'s rumours have come true or gone to sleep. I\'m playing the karaoke machine to nobody. It\'s nice.',
          choices: [{ id: 'back', label: r ? 'I\'ll look into it.' : 'Play it to me.', next: 'hello' }],
        };
      }
      if (id === 'pivot') {
        return {
          speaker: 'Dez Marlow',
          text: 'Fixing a karaoke machine in a bar called the Low Note. The power went, and the bar cheered, because it meant no more karaoke. Then it didn\'t come back. I took the machine home. I\'ve been fixing it for three years. It\'s the radio now. It still has every song.',
          choices: [{ id: 'back', label: 'Every song.', next: 'hello' }],
        };
      }
      if (id !== 'hello') return null;
      const lines = {
        start: 'Dez. Radio. Don\'t touch the karaoke machine, it\'s load-bearing. And don\'t say anything on the band you wouldn\'t say to Vesper Kade\'s face.',
        job: 'SeedBot\'s firmware pings every ninety seconds like it\'s asking to be loved. Bring me its battery and I\'ll make you something mean.',
        back: 'Somebody is going to hear about this on the band. I\'d bet a cell it\'s someone we didn\'t invite.',
        after: v.has('q.chat.air')
          ? 'Vesper hasn\'t said a word on the band since I read the chat. I can hear her not saying it. It\'s my favourite song.'
          : 'Told you she listens. Nobody ever believes the radio guy until the radio guy is right.',
      };
      let text = lines[stage(v)];
      if (v.has('q.cam.loop')) text += ' My loop is still running on Glimpse. Twelve hundred hours of an empty forecourt. Critics are calling it restful.';
      if (v.night && stage(v) !== 'start') text += ' Night\'s the good band. Everybody out there gets honest after dark.';
      const cells = v.count('battery');
      const scrap = v.count('scrap');
      const pages = lifeboatCount(v);
      const chatDone = v.has('q.chat.air') || v.has('q.chat.mara') || v.has('q.chat.pip');
      return {
        speaker: 'Dez Marlow',
        text,
        choices: [
          { id: 'listen', label: 'Who listens on our band?', next: 'listen' },
          ...(stage(v) !== 'start' ? [{ id: 'rumour', label: 'What\'s on the band tonight?', next: 'rumour' }] : []),
          ...(!v.has('dez.lifeboat') && !pages ? [{ id: 'lifeboat.ask', label: 'Anything strange on the band?', next: 'lifeboat' }] : []),
          ...(!chatDone && (v.has('dez.lifeboat') || pages) ? [pages >= 8
            ? { id: 'chat8', label: 'I have all eight pages of LIFEBOAT.', next: 'chat8' }
            : { id: 'pages', label: 'About LIFEBOAT...', next: 'pages' }] : []),
          ...(v.has('q.song.hollis') && !v.has('q.song.dez') ? [{ id: 'song.dez', label: 'Find me a song: slow, piano, a key change near the end.', next: 'songdez' }] : []),
          { id: 'pivot', label: 'Where were you, the afternoon of the Pivot?', next: 'pivot' },
          ...(!v.has('q.dez.badges') ? [{ id: 'dez.ask', label: v.has('dez.badges') ? 'About those lanyards.' : 'Anything you need?', next: 'badges' }] : []),
          ...(v.has('q.dez.relay') && !v.has('q.dez.ears') && !v.has('q.dez.karaoke') ? [{ id: 'kade', label: 'Let\'s hear Kade.', next: 'kade1' }] : []),
          ...(v.has('q.dez.badges') && v.count('kade_badge') > 0 ? [{
            id: 'trade', label: 'Three lanyards for a ration?',
            disabled: v.count('kade_badge') >= 3 ? undefined : 'Dez pays a ration for every three.',
            next: 'hello',
          }] : []),
          {
            id: 'emp',
            label: 'Pack me an EMP. (1 cell, 2 scrap)',
            disabled: cells < 1 ? 'Dez needs a lithium cell.' : scrap < 2 ? 'Dez needs 2 scrap.' : undefined,
            next: 'hello',
          },
          { id: 'bye', label: 'I won\'t touch the karaoke machine.' },
        ],
      };
    },
  },
  {
    id: 'ren',
    name: 'Ren Oka',
    role: 'Lookout',
    present: (v) => v.has('q.ren.truth'),
    node: (id, v) => {
      if (id !== 'hello') return null;
      return {
        speaker: 'Ren Oka',
        text: v.has('debriefed')
          ? 'I count the road from here now. Nothing on it heading west yet. When there is, it\'ll be us.'
          : 'Lookout duty. I count the road from here now. Nothing on it yet, which out here is good news.',
        choices: [{ id: 'bye', label: 'Keep counting, Ren.' }],
      };
    },
  },
];
