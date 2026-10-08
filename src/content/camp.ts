import type { PersonId } from './types';

/**
 * The people around Last Chance's fire. They live in the camp panel (no 3D figures): you talk to
 * them between rests. Lines move with the story. A few choices do something (Game applies them):
 *   `gift`    Hollis hands over a noisemaker, once
 *   `donate`  two bottles into Pip's ledger (the Fill the Ledger quest)
 *   `emp`     Dez packs an EMP from a cell and scrap, no Electronics needed
 */
export interface CampView {
  has: (flag: string) => boolean;
  count: (item: string) => number;
  rep: (id: PersonId) => number;
  name: string;
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
      if (id !== 'hello') return null;
      const lines = {
        start: 'Name\'s Hollis. I keep the sign lit. Thirty years of driving, and the only thing I ever owned outright is that neon. Off you go. The road doesn\'t get shorter by looking at it.',
        job: 'The Garage is up the spur. I drove past it once, before. He had a banner out front: DISRUPTING DOOMSDAY. He spelled "doomsday" wrong.',
        back: 'You\'ve got the walk of somebody carrying water. Best walk there is. Go tell Mara before Pip counts it twice.',
        after: 'Two weeks or forever-ish, it\'s all the same to the sign. It stays on. Somebody out there needs to see a light and know it means people.',
      };
      let text = lines[stage(v)];
      if (v.has('lore.permit') && !v.has('debriefed')) {
        text += ' And you found Mara\'s paper. She told me years ago. Don\'t hold it against her longer than she does. Nobody could.';
      }
      return {
        speaker: 'Hollis Grange',
        text,
        choices: [
          { id: 'road', label: 'Any road advice?', next: 'road' },
          ...(!v.has('hollis.rider') ? [{ id: 'rider', label: 'Heard anything on the CB?', next: 'rider' }] : []),
          ...(v.has('q.rider.log') && !v.has('q.rider.truth') && !v.has('q.rider.west') ? [{ id: 'ridertell', label: 'About Rider 9...', next: 'ridertell' }] : []),
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
      if (id !== 'hello') return null;
      const given = v.has('q.pip.2') ? 2 : v.has('q.pip.1') ? 1 : 0;
      const lines = {
        start: 'I\'m Pip. I do the ledger. Three days of water, two if Hollis keeps washing his face. Bring some back and I\'ll write you in the good column.',
        job: 'Did you find his water yet? I left a line in the ledger for it. It\'s empty. It looks at me.',
        back: 'Is that the cistern water? Is it clean? How many? Don\'t answer, I\'m counting.',
        after: v.has('act1.deal')
          ? 'Her jugs came on time. I wrote them in pencil. Mara says pencil is for things you don\'t trust.'
          : 'The ledger goes further now. Not far enough. Mara says that\'s what "west" is for.',
      };
      const extra = given === 2 ? ' You have a whole page now. Nobody gets a whole page.' : given === 1 ? ' You\'re in the good column. Two more and you get a page.' : '';
      const water = v.count('water');
      return {
        speaker: 'Pip Okafor',
        text: lines[stage(v)] + extra,
        choices: [
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
      if (id !== 'hello') return null;
      const lines = {
        start: 'Dez. Radio. Don\'t touch the karaoke machine, it\'s load-bearing. And don\'t say anything on the band you wouldn\'t say to Vesper Kade\'s face.',
        job: 'SeedBot\'s firmware pings every ninety seconds like it\'s asking to be loved. Bring me its battery and I\'ll make you something mean.',
        back: 'Somebody is going to hear about this on the band. I\'d bet a cell it\'s someone we didn\'t invite.',
        after: 'Told you she listens. Nobody ever believes the radio guy until the radio guy is right.',
      };
      const cells = v.count('battery');
      const scrap = v.count('scrap');
      return {
        speaker: 'Dez Marlow',
        text: lines[stage(v)],
        choices: [
          { id: 'listen', label: 'Who listens on our band?', next: 'listen' },
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
