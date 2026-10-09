/**
 * What the player can fight with. Ballistics are hitscan with a spread cone; numbers are tuned so a
 * Recovery contractor (100 hp) takes three body shots from the revolver, two to the head, and a wolf
 * (60 hp) two. Every gun is loud: `noise` is how far away the desert hears it.
 */
export type WeaponId = 'crowbar' | 'revolver' | 'shotgun' | 'rifle' | 'pistol22';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Owning this inventory item means you own the weapon. */
  item: string;
  kind: 'melee' | 'gun';
  /** Ammunition item id (guns). */
  ammo?: string;
  /** Rounds the gun holds. */
  mag: number;
  /** Damage per hit (per pellet for the shotgun). */
  damage: number;
  pellets: number;
  /** Half-angle of the spread cone in radians, from the hip / aimed. */
  hipSpread: number;
  adsSpread: number;
  /** Full damage out to `range`, falling to 40% at `maxRange` (and nothing past it). */
  range: number;
  maxRange: number;
  /** Seconds between shots (includes cycling the action). */
  interval: number;
  /** View kick per shot: radians up, radians of random yaw, viewmodel punch 0..1. */
  recoil: { pitch: number; yaw: number; kick: number };
  /** Reload: one round at a time (`per` s each, between `open` and `close`). A `magFed` gun loads the
   *  whole magazine in one `per` cycle (old one out, new one in, slide). */
  reload: { open: number; per: number; close: number };
  magFed?: boolean;
  /** Suppressed: its own quiet report, no muzzle flash worth the name. */
  suppressed?: boolean;
  /** Field of view while aiming down the sights. */
  adsFov: number;
  /** Metres. Anything with ears inside this radius hears the shot. */
  noise: number;
  headMult: number;
  /** Seconds to bring it up / put it away. */
  draw: number;
  /** Hotkey label in the HUD. */
  short: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  crowbar: {
    id: 'crowbar', name: 'Crowbar', item: 'crowbar', kind: 'melee', mag: 0,
    damage: 38, pellets: 1, hipSpread: 0, adsSpread: 0, range: 2.3, maxRange: 2.4, interval: 0.62,
    recoil: { pitch: 0, yaw: 0, kick: 0 }, reload: { open: 0, per: 0, close: 0 }, adsFov: 64,
    noise: 6, headMult: 1.6, draw: 0.35, short: 'BAR',
  },
  revolver: {
    id: 'revolver', name: 'Six-Shooter', item: 'revolver', kind: 'gun', ammo: 'ammo38', mag: 6,
    damage: 36, pellets: 1, hipSpread: 0.022, adsSpread: 0.0035, range: 28, maxRange: 70, interval: 0.34,
    recoil: { pitch: 0.055, yaw: 0.012, kick: 0.55 }, reload: { open: 0.38, per: 0.36, close: 0.3 }, adsFov: 52,
    noise: 140, headMult: 2.2, draw: 0.38, short: '.38',
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Twelve', item: 'shotgun', kind: 'gun', ammo: 'shells', mag: 5,
    damage: 13, pellets: 9, hipSpread: 0.07, adsSpread: 0.048, range: 9, maxRange: 32, interval: 0.92,
    recoil: { pitch: 0.11, yaw: 0.02, kick: 1 }, reload: { open: 0.3, per: 0.5, close: 0.42 }, adsFov: 56,
    noise: 170, headMult: 1.6, draw: 0.5, short: '12G',
  },
  rifle: {
    id: 'rifle', name: 'Lever .30-30', item: 'rifle', kind: 'gun', ammo: 'ammo3030', mag: 7,
    damage: 64, pellets: 1, hipSpread: 0.035, adsSpread: 0.0012, range: 80, maxRange: 220, interval: 0.82,
    recoil: { pitch: 0.075, yaw: 0.014, kick: 0.85 }, reload: { open: 0.3, per: 0.48, close: 0.36 }, adsFov: 34,
    noise: 220, headMult: 2.0, draw: 0.55, short: '30-30',
  },
  // The stealth gun: a heard-at-18-m report instead of 140, a weak round (four to the body, two to the
  // head), quick follow-ups, a ten-round magazine swapped whole.
  pistol22: {
    id: 'pistol22', name: 'Hush .22', item: 'pistol22', kind: 'gun', ammo: 'ammo22', mag: 10,
    damage: 21, pellets: 1, hipSpread: 0.018, adsSpread: 0.003, range: 18, maxRange: 55, interval: 0.2,
    recoil: { pitch: 0.018, yaw: 0.006, kick: 0.2 }, reload: { open: 0.42, per: 0.62, close: 0.34 }, adsFov: 54,
    noise: 18, headMult: 2.6, draw: 0.32, short: '.22', magFed: true, suppressed: true,
  },
};

/** Cycle order for the mouse wheel / Q. */
export const WEAPON_ORDER: WeaponId[] = ['crowbar', 'pistol22', 'revolver', 'shotgun', 'rifle'];

/** Damage at distance `d` for weapon `w` (per hit). */
export function falloff(w: WeaponDef, d: number) {
  if (d <= w.range) return 1;
  if (d >= w.maxRange) return 0;
  return 1 - 0.6 * ((d - w.range) / (w.maxRange - w.range));
}

/** Difficulty: what enemies deal and how sharp they are. */
export type Difficulty = 'story' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { dealt: number; taken: number; aim: number; react: number; label: string; blurb: string }> = {
  story: { dealt: 1.35, taken: 0.55, aim: 0.7, react: 1.4, label: 'Story', blurb: 'For the heists. Hostiles miss more and hit softer.' },
  normal: { dealt: 1, taken: 1, aim: 1, react: 1, label: 'Wasteland', blurb: 'The desert as intended. Pick your fights.' },
  hard: { dealt: 0.85, taken: 1.45, aim: 1.25, react: 0.75, label: 'Hard Water', blurb: 'They see you sooner, shoot straighter, and a pack can end a run.' },
};
