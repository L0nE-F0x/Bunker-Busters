/** XP required to go from `level` to `level + 1`. */
export const xpForLevel = (level: number) => Math.round(80 * Math.pow(level, 1.45));
export const SKILL_POINTS_PER_LEVEL = 1;

export const XP_REWARDS = {
  lockPicked: 35,
  keypadShorted: 30,
  tripwireDisarmed: 15,
  droneEmp: 20,
  landmarkDiscovered: 25,
};

export const MAX_HEALTH = 100;
export const CARRY_LIMIT = 30;
