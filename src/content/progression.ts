/** XP required to go from `level` to `level + 1`. */
export const xpForLevel = (level: number) => Math.round(80 * Math.pow(level, 1.45));
export const SKILL_POINTS_PER_LEVEL = 1;

export const XP_REWARDS = {
  lockPicked: 35,
  keypadShorted: 30,
  tripwireDisarmed: 15,
  droneEmp: 20,
  landmarkDiscovered: 25,
  breach: 25,
  talk: 30,
  cache: 20,
  debrief: 100,
};

export const MAX_HEALTH = 100;
export const NEED_MAX = 100;
/** A full waterskin lasts about a quarter of an hour of walking. The heist is where it matters. */
export const THIRST_PER_SEC = 100 / (15 * 60);
/** Hunger is the slower clock. */
export const HUNGER_PER_SEC = 100 / (26 * 60);
/** Empty pack, before Survival and the archetype's own shoulders. */
export const BASE_CARRY = 18;

/** Rank 1 is the step that matters. Later ranks do other things. */
export const needDrain = (survival: number) => (survival >= 1 ? 0.72 : 1);
export const foodBonus = (survival: number) => (survival >= 2 ? 1.25 : 1);
export const survivalCarry = (survival: number) => (survival >= 5 ? 8 : survival >= 3 ? 4 : 0);
export const fallFactor = (survival: number) => (survival >= 4 ? 0.62 : 1);

/** EMP blast radius in metres. Demolition 2 is the first reach upgrade. */
export const empRadius = (demolition: number) => (demolition >= 2 ? 8.5 * (1.2 + 0.08 * (demolition - 2)) : 8.5);

/**
 * How fast SeedBot's meter fills, from the Stealth skill alone (1 = no help).
 * Stacks with the archetype's stealth stat and with Electronics 3.
 */
export const stealthMeter = (stealth: number) => {
  let m = 1;
  if (stealth >= 2) m *= 0.82;
  if (stealth >= 4) m *= 0.85;
  if (stealth >= 5) m *= 0.85;
  return m;
};
