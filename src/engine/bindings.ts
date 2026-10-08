/**
 * Rebindable controls: every game action, its default keys (two slots) and its controller button.
 *
 * Keyboard codes are `KeyboardEvent.code` values, plus `Mouse0`..`Mouse4` for mouse buttons.
 * Controller codes are standard-mapping button indices: `P0` (A / Cross) .. `P15` (d-pad right);
 * a trailing `h` (`P2h`) means "hold the button": the plain press of that button then fires on
 * release instead, so one button can carry a tap action and a hold action (X: use, hold X: alt).
 * On-screen touch buttons press `act:<action>` directly, so they never depend on the bindings.
 *
 * `binds` is the live map (a module singleton: Input, the HUD and the menus all read it). Settings
 * persist it (`Settings.binds`, sanitised in `loadSettings` by `sanitizeBinds`).
 */

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'crouch' | 'jump'
  | 'interact' | 'alt' | 'torch'
  | 'fire' | 'aim' | 'reload' | 'melee' | 'nextWeapon' | 'prevWeapon' | 'lastWeapon' | 'holster'
  | 'hotbar1' | 'hotbar2' | 'hotbar3' | 'hotbar4'
  | 'kit' | 'skills' | 'journal' | 'map';

export interface ActionDef {
  id: Action;
  label: string;
  group: 'Move' | 'Interact' | 'Fight' | 'Items & menus';
  kb: [string, string?];
  /** Controller default ('' = none). Movement is on the left stick and has no button. */
  pad: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'forward', label: 'Forward', group: 'Move', kb: ['KeyW', 'ArrowUp'], pad: '' },
  { id: 'back', label: 'Back', group: 'Move', kb: ['KeyS', 'ArrowDown'], pad: '' },
  { id: 'left', label: 'Left', group: 'Move', kb: ['KeyA', 'ArrowLeft'], pad: '' },
  { id: 'right', label: 'Right', group: 'Move', kb: ['KeyD', 'ArrowRight'], pad: '' },
  { id: 'sprint', label: 'Sprint', group: 'Move', kb: ['ShiftLeft'], pad: 'P10' },
  { id: 'crouch', label: 'Crouch', group: 'Move', kb: ['KeyC', 'ControlLeft'], pad: 'P1' },
  { id: 'jump', label: 'Jump', group: 'Move', kb: ['Space'], pad: 'P0' },
  { id: 'interact', label: 'Use', group: 'Interact', kb: ['KeyE'], pad: 'P2' },
  { id: 'alt', label: 'Other way in', group: 'Interact', kb: ['KeyF'], pad: 'P2h' },
  { id: 'torch', label: 'Flashlight', group: 'Interact', kb: ['KeyL'], pad: 'P4h' },
  { id: 'fire', label: 'Fire / swing', group: 'Fight', kb: ['Mouse0'], pad: 'P7' },
  { id: 'aim', label: 'Aim down sights', group: 'Fight', kb: ['Mouse2'], pad: 'P6' },
  { id: 'reload', label: 'Reload', group: 'Fight', kb: ['KeyR'], pad: 'P3' },
  { id: 'melee', label: 'Melee · takedown', group: 'Fight', kb: ['KeyV'], pad: 'P11' },
  { id: 'nextWeapon', label: 'Next weapon', group: 'Fight', kb: [''], pad: 'P5' },
  { id: 'prevWeapon', label: 'Previous weapon', group: 'Fight', kb: [''], pad: 'P4' },
  { id: 'lastWeapon', label: 'Last weapon', group: 'Fight', kb: ['KeyQ'], pad: '' },
  { id: 'holster', label: 'Holster', group: 'Fight', kb: ['KeyX'], pad: 'P3h' },
  { id: 'hotbar1', label: 'EMP', group: 'Items & menus', kb: ['Digit1'], pad: 'P12' },
  { id: 'hotbar2', label: 'Ration', group: 'Items & menus', kb: ['Digit2'], pad: 'P15' },
  { id: 'hotbar3', label: 'Water', group: 'Items & menus', kb: ['Digit3'], pad: 'P13' },
  { id: 'hotbar4', label: 'Medkit', group: 'Items & menus', kb: ['Digit4'], pad: 'P14' },
  { id: 'kit', label: 'Kit', group: 'Items & menus', kb: ['Tab', 'KeyI'], pad: 'P8' },
  { id: 'skills', label: 'Skills', group: 'Items & menus', kb: ['KeyK'], pad: '' },
  { id: 'journal', label: 'Journal', group: 'Items & menus', kb: ['KeyJ'], pad: '' },
  { id: 'map', label: 'Map & intel', group: 'Items & menus', kb: ['KeyM'], pad: 'P8h' },
];

const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));
/** Movement lives on the left stick; these have no controller binding. */
export const STICK_ACTIONS = new Set<Action>(['forward', 'back', 'left', 'right']);
/** Keys the player can't take: Escape is pause / back everywhere. */
export const RESERVED_KEYS = new Set(['Escape']);
/** Controller buttons the player can't take: Start is pause, Home belongs to the system. */
export const RESERVED_PAD = new Set(['P9', 'P16']);

export interface BindMap {
  v: 1;
  kb: Record<Action, string[]>;
  pad: Record<Action, string>;
  /** Controller vibration (fire, hits, explosions). */
  rumble: boolean;
}

export function defaultBinds(): BindMap {
  const kb = {} as Record<Action, string[]>;
  const pad = {} as Record<Action, string>;
  for (const a of ACTIONS) { kb[a.id] = a.kb.filter((c): c is string => !!c); pad[a.id] = a.pad; }
  return { v: 1, kb, pad, rumble: true };
}

const KB_CODE = /^(Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Arrow(Up|Down|Left|Right)|Mouse[0-4]|[A-Z][A-Za-z]+(Left|Right)?)$/;
const PAD_CODE = /^P(\d|1[0-5])h?$/;

/**
 * Settings → binds: anything missing gets its default, anything unknown or malformed is dropped,
 * and a key claimed by two actions keeps only its first owner (a hand-edited or old file never
 * leaves a key doing two things).
 */
export function sanitizeBinds(raw: unknown): BindMap {
  const out = defaultBinds();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as { kb?: unknown; pad?: unknown; rumble?: unknown };
  const usedKb = new Set<string>();
  const usedPad = new Set<string>();
  if (r.kb && typeof r.kb === 'object') {
    for (const [id, codes] of Object.entries(r.kb as Record<string, unknown>)) {
      if (!ACTION_IDS.has(id) || !Array.isArray(codes)) continue;
      out.kb[id as Action] = codes.filter((c): c is string => typeof c === 'string' && KB_CODE.test(c) && !RESERVED_KEYS.has(c)).slice(0, 2);
    }
  }
  if (r.pad && typeof r.pad === 'object') {
    for (const [id, code] of Object.entries(r.pad as Record<string, unknown>)) {
      if (!ACTION_IDS.has(id) || STICK_ACTIONS.has(id as Action) || typeof code !== 'string') continue;
      out.pad[id as Action] = code === '' || (PAD_CODE.test(code) && !RESERVED_PAD.has(code.replace('h', ''))) ? code : out.pad[id as Action];
    }
  }
  for (const a of ACTIONS) {
    out.kb[a.id] = out.kb[a.id].filter((c) => (usedKb.has(c) ? false : (usedKb.add(c), true)));
    const p = out.pad[a.id];
    if (p) { if (usedPad.has(p)) out.pad[a.id] = ''; else usedPad.add(p); }
  }
  out.rumble = r.rumble !== false;
  return out;
}

/** The live bindings. */
class Binds {
  map: BindMap = defaultBinds();
  /** Called after any change, with the new map (Game persists it to Settings). */
  onChange: ((m: BindMap) => void) | null = null;
  private byKey = new Map<string, Action[]>();
  private byPad = new Map<string, Action[]>();

  constructor() { this.index(); }

  set(m: BindMap) {
    this.map = m;
    this.index();
  }

  private index() {
    this.byKey.clear();
    this.byPad.clear();
    for (const a of ACTIONS) {
      for (const c of this.map.kb[a.id] ?? []) (this.byKey.get(c) ?? this.byKey.set(c, []).get(c)!).push(a.id);
      const p = this.map.pad[a.id];
      if (p) (this.byPad.get(p) ?? this.byPad.set(p, []).get(p)!).push(a.id);
    }
  }

  private changed() {
    this.index();
    this.onChange?.(this.map);
  }

  keys(a: Action): string[] { return this.map.kb[a] ?? []; }
  pad(a: Action): string { return this.map.pad[a] ?? ''; }
  /** Actions bound to this key / mouse code. */
  actionsOf(code: string): Action[] { return this.byKey.get(code) ?? []; }
  /** Actions bound to this controller code (`P2` or `P2h`). */
  padActions(code: string): Action[] { return this.byPad.get(code) ?? []; }
  /** Is `code` one of `a`'s keys? */
  is(code: string, a: Action) { return this.keys(a).includes(code); }

  /**
   * Put `code` on action `a` (keyboard slot 0/1). If another action had it, the two trade: that action
   * gets the key `a` is giving up, so nothing is ever left unbound by accident. Returns a note to show.
   */
  bindKey(a: Action, slot: 0 | 1, code: string): string {
    if (RESERVED_KEYS.has(code)) return `${keyLabel(code)} is reserved (pause / back).`;
    const mine = [...this.keys(a)];
    const old = mine[slot] ?? '';
    if (old === code) return '';
    let note = '';
    const other = mine.indexOf(code);
    if (other >= 0) {
      // already on this action's other slot: swap the slots
      mine[other] = old;
    } else {
      for (const def of ACTIONS) {
        if (def.id === a) continue;
        const theirs = this.map.kb[def.id];
        const j = theirs.indexOf(code);
        if (j < 0) continue;
        if (old) { theirs[j] = old; note = `${def.label} moved to ${keyLabel(old)}.`; }
        else { theirs.splice(j, 1); note = `${def.label} lost ${keyLabel(code)}${theirs.length ? '' : ' and is now unbound'}.`; }
      }
    }
    mine[slot] = code;
    this.map.kb[a] = mine.filter((c) => !!c);
    this.changed();
    return note;
  }

  clearKey(a: Action, slot: 0 | 1) {
    const mine = [...this.keys(a)];
    if (slot >= mine.length) return;
    mine.splice(slot, 1);
    this.map.kb[a] = mine;
    this.changed();
  }

  /** Put controller `code` on `a`; a previous owner trades for `a`'s old button. */
  bindPad(a: Action, code: string): string {
    if (STICK_ACTIONS.has(a)) return '';
    if (RESERVED_PAD.has(code.replace('h', ''))) return `${padName(code)} is reserved (pause).`;
    const old = this.pad(a);
    if (old === code) return '';
    let note = '';
    for (const def of ACTIONS) {
      if (def.id === a || this.map.pad[def.id] !== code) continue;
      this.map.pad[def.id] = old;
      note = old ? `${def.label} moved to ${padName(old)}.` : `${def.label} is now unbound.`;
    }
    this.map.pad[a] = code;
    this.changed();
    return note;
  }

  clearPad(a: Action) {
    this.map.pad[a] = '';
    this.changed();
  }

  setRumble(on: boolean) {
    this.map.rumble = on;
    this.changed();
  }

  reset() {
    const r = this.map.rumble;
    this.map = defaultBinds();
    this.map.rumble = r;
    this.changed();
  }
}

export const binds = new Binds();

// ---------------------------------------------------------------- labels and glyphs

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'Alt', AltRight: 'Alt Gr', MetaLeft: 'Super', MetaRight: 'Super', Tab: 'Tab', CapsLock: 'Caps',
  Enter: 'Enter', Backspace: 'Bksp', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Ins', Delete: 'Del', Home: 'Home',
  End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', NumpadEnter: 'Num ⏎',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

/** "KeyW" → "W", "Digit1" → "1", "Mouse2" → "RMB". */
export function keyLabel(code: string): string {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Controller family for the glyphs: Xbox letters by default, PlayStation shapes for Sony pads. */
let padStyle: 'xbox' | 'ps' = 'xbox';
export function setPadStyle(id: string) {
  padStyle = /054c|playstation|dualshock|dualsense|wireless controller/i.test(id) ? 'ps' : 'xbox';
}

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'];
const PS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'];

/** Plain-text button name ("Hold X", "RB"). */
export function padName(code: string): string {
  if (!code) return '';
  const hold = code.endsWith('h');
  const i = parseInt(code.slice(1), 10);
  const n = (padStyle === 'ps' ? PS : XBOX)[i] ?? `B${i}`;
  return hold ? `Hold ${n}` : n;
}

/** A controller glyph: a round face button, a bumper/trigger pill, or a d-pad arrow. */
export function padGlyph(code: string): string {
  if (!code) return '';
  const hold = code.endsWith('h');
  const i = parseInt(code.slice(1), 10);
  const n = (padStyle === 'ps' ? PS : XBOX)[i] ?? `B${i}`;
  const cls = i <= 3 ? `pg face f${i}${padStyle === 'ps' ? ' ps' : ''}` : i >= 12 && i <= 15 ? 'pg dpad' : 'pg pill';
  const g = `<span class="${cls}">${n}</span>`;
  return hold ? `<span class="pgw"><span class="pg-hold">Hold</span>${g}</span>` : g;
}

export function kbdGlyph(code: string): string {
  return code ? `<span class="kbd">${keyLabel(code)}</span>` : '';
}

/**
 * The prompt glyph for an action on the device in use: its first key, or its controller button.
 * Falls back to the other device if the action has nothing bound on this one.
 */
export function actionGlyph(a: Action, device: 'kbm' | 'pad' | 'touch'): string {
  if (device === 'pad') {
    const p = binds.pad(a);
    if (p) return padGlyph(p);
  }
  const k = binds.keys(a)[0];
  return k ? kbdGlyph(k) : '<span class="kbd">—</span>';
}

/** The text label of an action's first key ("K"), for prose like "press K to spend". */
export function actionKey(a: Action): string {
  return keyLabel(binds.keys(a)[0] ?? '') || '—';
}

/** Minigame steering: arrows always, plus whatever movement keys are bound. */
export function dirOf(code: string): 'up' | 'down' | 'left' | 'right' | null {
  if (code === 'ArrowUp' || binds.is(code, 'forward')) return 'up';
  if (code === 'ArrowDown' || binds.is(code, 'back')) return 'down';
  if (code === 'ArrowLeft' || binds.is(code, 'left')) return 'left';
  if (code === 'ArrowRight' || binds.is(code, 'right')) return 'right';
  return null;
}
