import type { Input } from './input';
import { binds, setPadStyle, type Action } from './bindings';

/**
 * Controllers, through the standard Gamepad API (no dependencies). Polled once per frame by Game.
 *
 * While playing it writes into Input: the left stick to `padX/padZ`, the right stick to mouse-look
 * deltas (so the look-sensitivity setting, ADS zoom scaling and invert-Y all apply unchanged), and
 * buttons to `padDown/padPressed` through the bindings (src/engine/bindings.ts). Crouch toggles and
 * sprint latches until you stop, as a thumb can't hold a face button while steering.
 *
 * Anywhere else it hands a NavFrame to the menu navigator (src/ui/PadNav.ts). With no Gamepad API
 * (some WebKitGTK builds) or no controller, every call is a cheap no-op.
 */

/** Per-frame menu input: edges (directions auto-repeat), plus the held state a minigame needs. */
export interface NavFrame {
  up: boolean; down: boolean; left: boolean; right: boolean;
  a: boolean; b: boolean; x: boolean; y: boolean; lb: boolean; rb: boolean; start: boolean; back: boolean;
  /** A or RT held (lockpick: lift), and the deadzoned sticks. */
  aHeld: boolean;
  lx: number; ly: number; rx: number; ry: number;
  dt: number;
}

const N = 17;
/** Seconds a button must be held to count as "hold" (a tap fires on release before this). */
export const HOLD = 0.4;
/** Look speed at full deflection, sensitivity 1 (rad/s): ~170°/s, then a turn boost at the rim. */
const LOOK_YAW = 3.0;
const LOOK_PITCH = 1.9;
const BOOST = 1.65;
/** The camera turns mouse px into radians at 0.0021 rad/px × sensitivity (FirstPersonCamera). */
const PX_PER_RAD = 1 / 0.0021;
const REPEAT_DELAY = 0.38, REPEAT_RATE = 0.11;

/** Radial deadzone with the remaining range rescaled to 0..1 (no dead cross on the diagonals). */
export function deadzone(x: number, y: number, inner: number, outer = 0.96): [number, number] {
  const m = Math.hypot(x, y);
  if (m < inner) return [0, 0];
  const k = Math.min(1, (m - inner) / (outer - inner)) / m;
  return [x * k, y * k];
}

export class Pad {
  /** A controller is connected and has been seen this session. */
  connected = false;
  id = '';
  private input: Input | null = null;
  /** Menus, minigames, the resume prompt: anything that isn't play. */
  nav: ((f: NavFrame) => void) | null = null;
  /** Controls screen: the next button press is reported here (`P2`, `P2h` when held, '' = cancelled). */
  private capture: ((code: string) => void) | null = null;
  private capArmed = new Array<boolean>(N).fill(false);
  private capT = new Float32Array(N);
  private capTimer = 0;

  private prev = new Array<boolean>(N).fill(false);
  private cur = new Array<boolean>(N).fill(false);
  private holdT = new Float32Array(N);
  private holdFired = new Array<boolean>(N).fill(false);
  private startedInPlay = new Array<boolean>(N).fill(false);
  private crouchLatch = false;
  private sprintLatch = false;
  private rimT = 0;
  /**
   * Aim assist (combat/aimAssist.ts, set by Game): called once a frame in play while the pad is the
   * device in use; returns the right stick's look-speed scale (it may also nudge the camera itself).
   */
  assist: ((dt: number) => number) | null = null;
  private dirHeld: Record<'up' | 'down' | 'left' | 'right', number> = { up: -1, down: -1, left: -1, right: -1 };
  private gp: Gamepad | null = null;
  private api = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';

  attach(input: Input) {
    this.input = input;
    input.rumbleFn = (s, w, ms) => this.rumble(s, w, ms);
    if (!this.api) return;
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[pad] connected: ${(e as GamepadEvent).gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', () => console.log('[pad] disconnected'));
  }

  /** Report the next controller button (for rebinding). Start cancels. */
  startCapture(cb: (code: string) => void) {
    this.capture = cb;
    this.capArmed.fill(false);
    this.capTimer = 8;
  }
  cancelCapture() {
    this.capture = null;
  }
  get capturing() { return !!this.capture; }

  private poll(): Gamepad | null {
    let list: (Gamepad | null)[];
    try { list = navigator.getGamepads?.() ?? []; } catch { return null; }
    let best: Gamepad | null = null;
    for (const g of list) {
      if (!g || !g.connected) continue;
      if (this.gp && g.index === this.gp.index) return g;
      if (!best || (g.mapping === 'standard' && best.mapping !== 'standard')) best = g;
    }
    return best;
  }

  update(dt: number, gameplay: boolean) {
    if (!this.api || !this.input) return;
    const input = this.input;
    const gp = this.poll();
    if (!gp) {
      if (this.connected) { this.connected = false; this.release(); }
      this.gp = null;
      return;
    }
    if (!this.connected || gp.id !== this.id) { this.connected = true; this.id = gp.id; setPadStyle(gp.id); }
    this.gp = gp;

    // buttons (the triggers are analog: a little hysteresis so a resting finger doesn't chatter)
    let any = false;
    for (let i = 0; i < N; i++) {
      const b = gp.buttons[i];
      this.prev[i] = this.cur[i];
      const v = b ? b.value : 0;
      this.cur[i] = !!b && (i === 6 || i === 7 ? v > (this.prev[i] ? 0.2 : 0.35) : b.pressed || v > 0.5);
      if (this.cur[i] && !this.prev[i]) any = true;
    }
    const ax = (k: number) => (Number.isFinite(gp.axes[k]) ? gp.axes[k] : 0);
    const [lx, ly] = deadzone(ax(0), ax(1), 0.17);
    const [rx, ry] = deadzone(ax(2), ax(3), 0.13);
    if (any || Math.hypot(lx, ly) > 0.4 || Math.hypot(rx, ry) > 0.4) input.setDevice('pad');

    if (this.capture) { this.captureFrame(dt); this.clearPlay(); return; }

    const edge = (i: number) => this.cur[i] && !this.prev[i];
    const up = (i: number) => !this.cur[i] && this.prev[i];
    for (let i = 0; i < N; i++) {
      if (edge(i)) { this.holdT[i] = 0; this.holdFired[i] = false; this.startedInPlay[i] = gameplay; }
      if (this.cur[i]) this.holdT[i] += dt;
    }

    if (!gameplay) {
      this.clearPlay();
      this.navFrame(dt, lx, ly, rx, ry, edge);
      return;
    }

    // ---- play
    input.padDown.clear();
    const down = input.padDown, pressed = input.padPressed;
    const add = (set: Set<Action>, acts: Action[]) => { for (const a of acts) set.add(a); };
    for (let i = 0; i < N; i++) {
      if (i === 9) { if (edge(i)) input.tap('Escape'); continue; } // Start: pause
      const tap = binds.padActions(`P${i}`);
      const hold = binds.padActions(`P${i}h`);
      if (!tap.length && !hold.length) continue;
      if (!hold.length) {
        if (this.cur[i]) add(down, tap);
        if (edge(i)) add(pressed, tap);
        continue;
      }
      // one button, two actions: the hold fires at HOLD seconds, the tap on an early release
      if (this.cur[i] && this.startedInPlay[i] && !this.holdFired[i] && this.holdT[i] >= HOLD) {
        this.holdFired[i] = true;
        add(pressed, hold);
      }
      if (this.cur[i] && this.holdFired[i]) add(down, hold);
      if (up(i) && !this.holdFired[i] && this.startedInPlay[i]) { add(pressed, tap); add(down, tap); }
    }

    // crouch toggles; a keyboard crouch key takes over again
    if (pressed.has('crouch')) { this.crouchLatch = !this.crouchLatch; this.sprintLatch = false; }
    if (binds.keys('crouch').some((c) => input.pressedRaw(c))) this.crouchLatch = false;
    down.delete('crouch');
    if (this.crouchLatch) down.add('crouch');
    // sprint latches until the stick comes back toward the middle
    const mag = Math.hypot(lx, ly);
    if (pressed.has('sprint')) { this.sprintLatch = true; this.crouchLatch = false; down.delete('crouch'); }
    if (mag < 0.3 || ly > 0.2) this.sprintLatch = false;
    if (this.sprintLatch) down.add('sprint');

    input.padX = lx;
    input.padZ = -ly;

    // look: a response curve for fine aim near the centre, full speed at the rim, then a turn boost
    const lm = Math.hypot(rx, ry);
    const slow = input.device === 'pad' && this.assist ? this.assist(dt) : 1;
    if (lm > 0) {
      const k = (Math.pow(lm, 1.9) / lm) * slow;
      this.rimT = lm > 0.95 ? this.rimT + dt : 0;
      const boost = 1 + (BOOST - 1) * Math.min(1, Math.max(0, (this.rimT - 0.22) / 0.3));
      input.mouseDX += rx * k * LOOK_YAW * boost * dt * PX_PER_RAD;
      input.mouseDY += ry * k * LOOK_PITCH * dt * PX_PER_RAD;
    } else this.rimT = 0;
  }

  /** Not playing: drop held actions and motion (the crouch toggle survives a trip to the pause menu). */
  private clearPlay() {
    if (!this.input) return;
    this.input.padDown.clear();
    this.input.padX = this.input.padZ = 0;
    this.sprintLatch = false;
    this.rimT = 0;
  }

  private release() {
    this.clearPlay();
    this.crouchLatch = false;
    this.cur.fill(false);
    this.prev.fill(false);
    if (this.input?.device === 'pad') this.input.setDevice(this.input.touch ? 'touch' : 'kbm');
  }

  private navFrame(dt: number, lx: number, ly: number, rx: number, ry: number, edge: (i: number) => boolean) {
    const want = {
      up: this.cur[12] || ly < -0.55,
      down: this.cur[13] || ly > 0.55,
      left: this.cur[14] || lx < -0.55,
      right: this.cur[15] || lx > 0.55,
    };
    const dir = { up: false, down: false, left: false, right: false };
    for (const k of ['up', 'down', 'left', 'right'] as const) {
      if (!want[k]) { this.dirHeld[k] = -1; continue; }
      if (this.dirHeld[k] < 0) { this.dirHeld[k] = 0; dir[k] = true; continue; }
      const before = this.dirHeld[k];
      this.dirHeld[k] += dt;
      // fire once at the delay, then at the repeat rate
      if (before < REPEAT_DELAY && this.dirHeld[k] >= REPEAT_DELAY) dir[k] = true;
      else if (this.dirHeld[k] > REPEAT_DELAY && Math.floor((this.dirHeld[k] - REPEAT_DELAY) / REPEAT_RATE) !== Math.floor((before - REPEAT_DELAY) / REPEAT_RATE)) dir[k] = true;
    }
    this.nav?.({
      ...dir,
      a: edge(0), b: edge(1), x: edge(2), y: edge(3), lb: edge(4), rb: edge(5), start: edge(9), back: edge(8),
      aHeld: this.cur[0] || this.cur[7],
      lx, ly, rx, ry, dt,
    });
  }

  private captureFrame(dt: number) {
    this.capTimer -= dt;
    const done = (code: string) => { const cb = this.capture; this.capture = null; cb?.(code); };
    if (this.capTimer <= 0) { done(''); return; }
    for (let i = 0; i < N; i++) {
      const isEdge = this.cur[i] && !this.prev[i];
      if (isEdge) {
        if (i === 9 || i === 16) { done(''); return; } // Start (or Home): cancel
        this.capArmed[i] = true;
        this.capT[i] = 0;
      }
      if (!this.capArmed[i]) continue;
      if (this.cur[i]) {
        this.capT[i] += dt;
        if (this.capT[i] >= HOLD) { done(`P${i}h`); return; }
      } else { done(`P${i}`); return; }
    }
  }

  rumble(strong: number, weak: number, ms: number) {
    const act = (this.gp as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
  }
}

/** The one controller reader (Game attaches and drives it; the Controls screen captures through it). */
export const pad = new Pad();
