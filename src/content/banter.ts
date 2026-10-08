import type { ArchetypeDef } from './types';

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
}

export interface Banter {
  id: string;
  /** 'Mara' is the radio. 'self' is the player's own first name. */
  speaker: 'Mara' | 'self';
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
];
