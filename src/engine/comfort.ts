/**
 * Comfort and accessibility levels that effect code reads where it writes a light, a flash or a
 * shake (Settings → Accessibility; written by src/game/access.ts). Plain values, no imports, so
 * anything can read them in its own update without a new dependency.
 */
export const comfort = {
  /**
   * Reduce flashing is on: lights that flicker or strobe faster than ~3 Hz hold steady (a failing
   * tube, broken neon, a projector, SeedBot's taser), and the bright flashes below are dimmed.
   */
  calm: false,
  /** Scale on bright flashes (lightning, muzzle flashes, blasts, EMP static, the red damage edge). */
  flash: 1,
  /** Scale on camera shake: blasts, hits taken, recoil kick, hard landings. */
  shake: 1,
};

/** Reduce flashing's level for bright flashes. */
export const CALM_FLASH = 0.3;
