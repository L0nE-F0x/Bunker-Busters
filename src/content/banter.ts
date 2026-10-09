import type { ArchetypeDef } from './types';
import { lifeboatCount } from './quests';

/**
 * Short subtitle lines while you explore: Mara on the radio, or you, to yourself.
 * Each fires once (flag `b:<id>`). The runner (src/game/Story.ts) keeps at least 40 s between
 * lines, never talks over another subtitle, and stays quiet in menus, minigames and alarms.
 */
export interface BanterView {
  has: (flag: string) => boolean;
  archetype: ArchetypeDef;
  night: boolean;
  storm: number;
  /** Time of day (routines: who is where). */
  hour?: number;
}

const hr = (v: BanterView) => v.hour ?? 12;

export interface Banter {
  id: string;
  /** 'Mara' is the radio. 'self' is the player's own first name. Anything else is a speaker label as the UI shows it (Ezra, through the camera). */
  speaker: 'Mara' | 'self' | (string & {});
  text: string | ((v: BanterView) => string);
  when?: (v: BanterView) => boolean;
  /** World XZ and radius, or a landmark id resolved by the runner. */
  near?: { x: number; z: number; r: number } | { lm: string; r: number };
  /** Higher wins when two are ready at once. Events beat scenery. */
  priority?: number;
}

const SEEN_GARAGE: Record<string, string> = {
  infiltrator: 'Same padlock. He never changed it. Of course he never changed it.',
  engineer: 'There it is. My code, hovering over a parking lot. Still running the power-save. Hi, buddy.',
  brute: 'The wrap with the camp\'s name on it is in there somewhere. It\'s coming home.',
  fixer: 'Neon and a megaphone. He hasn\'t changed at all. Good. I know this man.',
  scout: 'The ground under that fence is damp. Nothing out here is damp. Of course it\'s his.',
  defector: 'Bunkr.ly. I nearly invested. I\'d like that on the record, and then off it.',
};

export const BANTER: Banter[] = [
  // ------------------------------------------------------------------ events
  {
    id: 'note', speaker: 'Mara', priority: 5,
    when: (v) => v.has('intel:intel.gas.note') && !v.has('seen:garage'),
    text: 'You read it. Good. Northeast, up the spur. Check the cooler behind the pumps first. Walking thirsty is how people stop walking.',
  },
  {
    id: 'rags', speaker: 'Mara', priority: 4,
    when: (v) => v.has('seen:stash'),
    text: 'See that red rag on a stick? Somebody\'s stash. Take what you need. People out here leave them for whoever comes next.',
  },
  {
    id: 'garage.self', speaker: 'self', priority: 6,
    when: (v) => v.has('seen:garage') && !v.has('garage.gate.open') && !v.has('garage.gap.open'),
    text: (v) => SEEN_GARAGE[v.archetype.id] ?? 'So that\'s the Garage. Smaller than the pitch deck.',
  },
  {
    id: 'fence', speaker: 'Mara', priority: 5,
    when: (v) => (v.has('garage.gate.open') || v.has('garage.gap.open')) && !v.has('garage.vault.open'),
    text: 'You\'re through the fence. SeedBot charges by the door, on twelve percent. Be the thing it can\'t afford to chase.',
  },
  {
    id: 'kade', speaker: 'Mara', priority: 7,
    when: (v) => v.has('tanner.kade') && !v.has('garage.complete'),
    text: 'I heard that. Kade Holdings. Of course it\'s Kade. Get the ledger anyway. If he\'s a middleman, it\'s a map to the top.',
  },
  {
    id: 'valve', speaker: 'Mara', priority: 7,
    when: (v) => v.has('lore.valve') && !v.has('tanner.kade') && !v.has('garage.complete'),
    text: 'A Kade valve on our road, with Tanner\'s name on the tag. So the water isn\'t his. It\'s his rent.',
  },
  {
    id: 'vault', speaker: 'Mara', priority: 6,
    when: (v) => v.has('garage.vault.open') && !v.has('garage.complete'),
    text: 'The Runway Room. Take the water first. The names don\'t weigh anything.',
  },
  {
    id: 'complete', speaker: 'Mara', priority: 8,
    when: (v) => v.has('garage.complete') && !v.has('debriefed'),
    text: 'I could hear his megaphone from here. Come home. Bring the names. Pip has a pencil ready.',
  },
  {
    id: 'permit', speaker: 'Mara', priority: 7,
    when: (v) => v.has('lore.permit') && !v.has('mara.permit'),
    text: '...You found the clipboard. Come back to the fire when you can. I owe you a story, and it isn\'t a good one.',
  },
  {
    id: 'dry', speaker: 'Mara', priority: 4,
    when: (v) => v.has('tut.dry'),
    text: 'You sound dry. Drink. The camp would rather have you back than the bottle.',
  },
  {
    id: 'night', speaker: 'self', priority: 2,
    when: (v) => v.night && v.has('seen:garage') && !v.has('garage.complete'),
    text: 'Dark. SeedBot\'s optics hate the dark. So do I, but less.',
  },
  {
    id: 'storm', speaker: 'Mara', priority: 3,
    when: (v) => v.storm > 0.5,
    text: 'Dust storm on our side of the valley. SeedBot is half-blind in this. So are you. Use it anyway.',
  },
  {
    id: 'rider.order', speaker: 'Mara', priority: 5,
    when: (v) => v.has('q.rider.log') && !v.has('q.rider.delivered'),
    text: 'Dropt. I remember Dropt. Ten minutes or free, and they were never once free. Get that box to Nia. Then tell Hollis. In that order.',
  },
  {
    id: 'survey.kept', speaker: 'Mara', priority: 6,
    when: (v) => v.has('q.wick.kept'),
    text: 'I read Wick\'s book. Depth, not flow. She doesn\'t want his seep. She wants the aquifer under the ridge, the one the creek used to come from. I\'ll be up all night with this.',
  },
  {
    id: 'crew', speaker: 'Mara', priority: 5,
    when: (v) => v.has('debriefed'),
    text: 'Get some sleep. Then go see who in Dry Creek would walk west with you. Nobody walks to Apex alone.',
  },

  // ------------------------------------------------------------------ places
  {
    id: 'creek', speaker: 'Mara',
    near: { lm: 'creek', r: 95 },
    when: (v) => !v.has('seen:creek'),
    text: 'That light west of the highway is Dry Creek. Nia\'s diner. They\'re not the job, but they\'ve been out here longer than we have.',
  },
  {
    id: 'garage', speaker: 'Mara',
    near: { x: 96, z: -150, r: 120 },
    when: (v) => !v.has('seen:garage'),
    text: 'Neon to the northeast. That\'s him. Keep low. SeedBot sees bright things first.',
  },
  {
    id: 'spire', speaker: 'Mara',
    near: { lm: 'spire', r: 55 },
    when: (v) => !v.has('intel:intel.spire.blueprint'),
    text: 'That\'s the Spire. Tanner\'s contractor left paperwork up there. Contractors always leave paperwork.',
  },
  {
    id: 'wash', speaker: 'self',
    near: { x: 80, z: 196, r: 26 },
    when: (v) => !v.has('seen:cave'),
    text: 'Posts in the wash, heading up the ridge. Somebody wanted this walked.',
  },
  {
    id: 'cave', speaker: 'self',
    when: (v) => v.has('seen:cave') && !v.has('creek.talk.wick'),
    near: { lm: 'cave', r: 30 },
    text: 'Smoke, a chair, a view. Somebody lives up here on purpose.',
  },
  {
    id: 'valve.near', speaker: 'self',
    near: { x: 119, z: -12, r: 30 },
    when: (v) => !v.has('lore.valve'),
    text: 'A valve on the spur, with a tag wired to it. Somebody wanted that read.',
  },
  {
    id: 'permit.near', speaker: 'self',
    near: { x: -236, z: 96, r: 34 },
    when: (v) => !v.has('lore.permit'),
    text: 'A clipboard in the road. County seal, still legible. Huh.',
  },
  {
    id: 'jet', speaker: 'self',
    near: { lm: 'jet', r: 120 },
    when: (v) => !v.has('seen:jet'),
    text: 'That\'s not a dune. Dunes don\'t have tail fins.',
  },
  {
    id: 'drivein', speaker: 'self',
    near: { lm: 'drivein', r: 130 },
    when: (v) => !v.has('seen:drivein'),
    text: 'A screen the size of a building, still white. Still waiting for the keynote to end.',
  },
  {
    id: 'datacenter', speaker: 'Mara',
    near: { lm: 'datacenter', r: 140 },
    when: (v) => !v.has('seen:datacenter'),
    text: 'You\'re near ColdStorage. Stop and listen. Hear that hum? That building is still breathing.',
  },
  {
    id: 'courier', speaker: 'self',
    near: { lm: 'courier', r: 110 },
    when: (v) => !v.has('seen:courier'),
    text: (v) => (v.night ? 'A red light blinking out on the flats. Two quick flashes, every two seconds. Somebody wanted to be seen.' : 'An orange flag on a whip, out on the flats. Somebody planted that to be found.'),
  },
  {
    id: 'stakes', speaker: 'self',
    near: { x: 18, z: 311, r: 30 },
    when: (v) => !v.has('wick.survey') && !v.has('q.wick.stake.b'),
    text: 'Orange tape on a stake, out here. Somebody is measuring this slope for something.',
  },
  {
    id: 'tube', speaker: 'self',
    near: { lm: 'tube', r: 120 },
    when: (v) => !v.has('seen:tube'),
    text: 'A silver tube on stilts, running east to nowhere. Top speed: one press release.',
  },

  // ------------------------------------------------------------------ the founders, from the outside
  {
    id: 'lifeboat.first', speaker: 'Mara', priority: 5,
    when: (v) => v.has('lore.lifeboat') && !v.has('dez.lifeboat') && lifeboatCount(v) === 1,
    text: 'Dez is shouting in the background. Something about a group chat, and founders, and three in the morning. I\'ll let him tell you. Come back to the fire when you can.',
  },
  {
    id: 'lifeboat.all', speaker: 'Mara', priority: 6,
    when: (v) => lifeboatCount(v) >= 8 && !v.has('q.chat.air') && !v.has('q.chat.mara') && !v.has('q.chat.pip'),
    text: 'Dez says you have every page. He\'s cleared a shelf. He\'s never cleared a shelf. Come home before he explodes.',
  },
  {
    id: 'glimpse', speaker: 'Mara', priority: 5,
    when: (v) => v.has('lore.glimpse') && !v.has('q.cam.seen'),
    text: '"The one by the gas station still blinks." Hollis has been complaining about a blue light on the road for three years. I thought it was his eyes.',
  },
  {
    id: 'capsule.near', speaker: 'self',
    near: { x: -306, z: 4, r: 40 },
    when: (v) => !v.has('q.capsule.dug'),
    text: (v) => (v.has('pip.capsule')
      ? 'A rocket on a sign, bent over like it\'s reading the ground. Kade Kids Academy. Pip went here for eleven days.'
      : 'A school sign with a rocket on it, and no school. The ground round it has been a crater for a while.'),
  },
  {
    id: 'relay.near', speaker: 'self',
    near: { x: -74, z: 178, r: 32 },
    when: (v) => !v.has('q.cam.cut') && !v.has('q.cam.loop') && !v.has('q.cam.hello'),
    text: 'A mast on the rise with two dishes. One looks at the camp. The other looks north, at nothing you can see.',
  },
  {
    id: 'ezra.night', speaker: 'Ezra Seymour · camera', priority: 3,
    near: { lm: 'gas', r: 40 },
    when: (v) => v.night && v.has('q.cam.hello'),
    text: 'Evening! You moved the cooler. Bold choice. I\'m not judging. I\'m archiving.',
  },
  {
    id: 'ezra.wave', speaker: 'Ezra Seymour · camera', priority: 3,
    near: { lm: 'gas', r: 40 },
    when: (v) => !v.night && v.has('q.cam.hello') && v.has('q.cam.told'),
    text: 'Hollis waved at me this morning. With one finger. I\'m counting it.',
  },
  {
    id: 'song.band', speaker: 'Mara', priority: 6,
    when: (v) => v.has('q.song.band'),
    text: 'Rosa\'s song, at sunset, on every channel Dez could reach. The whole net went quiet for four minutes. I\'ve never heard the band that quiet. I\'d like to again.',
  },
  {
    id: 'walkwest', speaker: 'self', priority: 2,
    near: { x: -366, z: 26, r: 60 },
    when: (v) => !v.has('lore.walkwest'),
    text: 'Footprints on the shoulder, all heading west. Old ones. Nobody\'s come back the other way.',
  },
  // ------------------------------------------------------------------ the new road
  {
    id: 'waitlist.chair', speaker: 'self', priority: 3,
    near: { lm: 'waitlist', r: 60 },
    when: (v) => v.has('doc.ada') && !v.has('q.ada.found'),
    text: 'Two thousand two hundred and twelve. If Ada left the line, she\'d have dragged her chair out of it. Check the edges.',
  },
  {
    id: 'apex.done', speaker: 'Mara', priority: 6,
    when: (v) => v.has('apex.complete') && v.has('q.capsule.dug'),
    text: 'Pip ran the tap behind the pumps for ten seconds this morning, just to hear it. Then she wrote it down. Then she ran it again. I didn\'t stop her.',
  },
  {
    id: 'panopticon.far', speaker: 'self', priority: 2,
    when: (v) => (v.has('q:act2:done') || v.has('apex.complete')) && v.has('q.cam.hello'),
    text: 'Somewhere on the old coast, north of the salt, Ezra is watching this exact moment. Fine. Let him write it down.',
  },
  // ------------------------------------------------------------------ routines (content/routines.ts)
  {
    id: 'routine.watch', speaker: 'self', priority: 2,
    near: { lm: 'gas', r: 28 },
    when: (v) => hr(v) >= 21 || hr(v) < 5.5,
    text: 'Hollis is on a crate past the end of the store, watching the highway. He nods without looking round.',
  },
  {
    id: 'routine.lookout', speaker: 'self', priority: 2,
    near: { lm: 'gas', r: 28 },
    when: (v) => v.has('q.ren.truth'),
    text: 'Ren\'s on the lookout crate by the road, counting our highway now. Ren raises the mug without turning round.',
  },
  {
    id: 'routine.pippool', speaker: 'self', priority: 2,
    near: { lm: 'gas', r: 28 },
    when: (v) => hr(v) >= 10 && hr(v) < 16 && (v.has('q.capsule.sealed') || v.has('q.capsule.peeked') || v.has('q.capsule.mara')),
    text: 'Pip is sitting by her pool in the noon sun, feet just off the chalk. Lifeguard duty.',
  },
  {
    id: 'routine.docfire', speaker: 'self', priority: 2,
    near: { lm: 'creek', r: 40 },
    when: (v) => hr(v) >= 19,
    text: 'Doc\'s out at Sol\'s fire with his clipboard, pretending he isn\'t on shift.',
  },
  {
    id: 'routine.doccut', speaker: 'self', priority: 2,
    near: { lm: 'cave', r: 30 },
    when: (v) => hr(v) < 5 && v.has('q.doc.delivered'),
    text: 'Doc is up here at Wick\'s fire, at this hour, with his clipboard. Neither of them is admitting it\'s a visit.',
  },
  {
    id: 'routine.creekdark', speaker: 'self', priority: 2,
    near: { lm: 'creek', r: 45 },
    when: (v) => hr(v) < 5,
    text: 'Dry Creek is dark except for Sol\'s fire. There\'s a note on the diner counter. The town sleeps in shifts.',
  },
  {
    id: 'routine.till', speaker: 'self', priority: 1,
    near: { lm: 'creek', r: 45 },
    when: (v) => hr(v) >= 21 || hr(v) < 7,
    text: 'The Till\'s shut. A light upstairs, and a sign that says knock if you\'re on fire.',
  },
  {
    id: 'pool', speaker: 'self', priority: 2,
    near: { lm: 'gas', r: 30 },
    when: (v) => v.has('q.capsule.sealed') || v.has('q.capsule.peeked') || v.has('q.capsule.mara'),
    text: 'A chalk pool on the forecourt, with a ladder. Everybody walks round it. Even the dust seems to.',
  },
];
