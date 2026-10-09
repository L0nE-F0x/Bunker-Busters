/**
 * Who is where, by the hour and by what you've done. Each routine slot is a seat or a spot a
 * person's model can be in (world/npc.ts `station`); a person with two slots is in one of them, or
 * neither (asleep, on a call). Game hands `routineOpen` to `NpcCrowd.schedule`; Settlement moves the
 * talk prompt to wherever the person is, and leaves a note where they aren't.
 *
 * Out of play (title, character select) everyone is in their first slot, so the menus never change.
 */
export interface RoutineCtx {
  playing: boolean;
  hour: number;
  has: (flag: string) => boolean;
}

/** `from`–`to` on the clock, wrapping past midnight. */
const between = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);
const pool = (has: RoutineCtx['has']) => has('q.capsule.sealed') || has('q.capsule.peeked') || has('q.capsule.mara');

interface Station {
  /** Where they are when nothing is scheduled (menus, the procedural fallback). */
  primary?: boolean;
  open: (c: RoutineCtx) => boolean;
}

export const STATIONS: Record<string, Station> = {
  // Dry Creek: the diner stays lit late; the doctor works days, warms up at the street fire, and
  // takes the night calls; the Till keeps shop hours; Ren counts the road until Last Chance needs a lookout
  'nia.diner': { primary: true, open: (c) => between(c.hour, 5, 24) },
  'doc.clinic': { primary: true, open: (c) => between(c.hour, 6, 19) && !(c.has('q.nia.peace') && between(c.hour, 6, 8)) },
  // made peace: breakfast at Nia's counter, before the clinic opens
  'doc.diner': { open: (c) => c.has('q.nia.peace') && between(c.hour, 6, 8) },
  // Wick took the medkit: the night call is up the wash, at Wick's fire
  'doc.cut': { open: (c) => c.has('q.doc.delivered') && between(c.hour, 0, 5) },
  'doc.fire': { open: (c) => between(c.hour, 19, 24) },
  'inez.till': { primary: true, open: (c) => between(c.hour, 7, 21) },
  'ren.road': { primary: true, open: (c) => !c.has('q.ren.truth') },
  // Last Chance: Hollis keeps the night watch by the road; Pip sleeps (and, once she has it, spends
  // the middle of the day by her pool); Ren keeps the lookout crate after the drive-in
  'hollis.log': { primary: true, open: (c) => between(c.hour, 5.5, 21) },
  'hollis.watch': { open: (c) => !between(c.hour, 5.5, 21) },
  'pip.log': { primary: true, open: (c) => between(c.hour, 6, 23) && !(pool(c.has) && between(c.hour, 10, 16)) },
  'pip.pool': { open: (c) => pool(c.has) && between(c.hour, 10, 16) },
  'ren.camp': { open: (c) => c.has('q.ren.truth') },
};

export function routineOpen(station: string, c: RoutineCtx): boolean {
  const s = STATIONS[station];
  if (!s) return true;
  if (!c.playing) return !!s.primary;
  return s.open(c);
}

/** What you find where someone usually is, when they aren't (Settlement swaps the talk prompt for it). */
export const AWAY: Record<string, { label: string; speaker: string; text: string; knock?: { label: string; speaker: string; text: string } }> = {
  nia: {
    label: 'Read the note on the counter',
    speaker: 'Note on the counter',
    text: 'Gone to bed. Coffee is in the pot, the pot is on the stove, the stove remembers you. Pay the jar. Back at five. N.',
  },
  doc: {
    label: 'Read the note on the desk',
    speaker: 'Note on the desk',
    text: 'ON A CALL. If you are bleeding, bleed toward the diner. If you are dying, do it slowly and I will be back at first light. Do not touch the generator. It knows what you did. Dr. I.',
  },
  inez: {
    label: 'Read the sign on the Till',
    speaker: 'Sign on the Till',
    text: 'CLOSED. THE TILL REMEMBERS. BACK AT SEVEN. KNOCK IF ON FIRE.',
    knock: { label: 'Knock anyway.', speaker: 'Inez Quill', text: 'We\'re closed. ...You\'re not on fire. Fine. Fine! I\'m coming down. Don\'t touch anything I can hear.' },
  },
};
