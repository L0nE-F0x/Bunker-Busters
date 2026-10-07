import { isTouch, enterFullscreen } from './device';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ipc = (window as any).__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined;

/** Keyboard + mouse state with pointer lock and edge-triggered "pressed" queries. */
export class Input {
  down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseDown = [false, false, false];
  mousePressed = [false, false, false];
  locked = false;
  enabled = true;
  sensitivity = 1;
  /** Analog movement from the touch stick, -1..1 (x right, z forward). Keys still work alongside. */
  moveX = 0;
  moveZ = 0;
  /** Touch device: there is no pointer to capture; "locked" just means the touch controls are live. */
  readonly touch = isTouch;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // native capture has no browser-provided Escape-to-release, so do it here
      if (e.code === 'Escape' && this.native && this.locked) this.exitLock();
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      if (this.native && this.locked) this.exitLock(); // switched window/workspace: give the mouse back
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || this.rawLive) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => (this.mouseDown[e.button] = false));
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    // right mouse is aim-down-sights: never a context menu over the game
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.setLocked(document.pointerLockElement === this.el));
    document.addEventListener('pointerlockerror', () => document.dispatchEvent(new Event('bb-lockerror')));
    // Linux desktop app (X11/XWayland): capture the mouse natively instead of with pointer lock
    ipc?.invoke('raw_mouse_delta').then((d) => { if (d) this.native = true; }, () => {});
  }

  /**
   * Native capture (Linux desktop app): WebKitGTK's own pointer lock freezes the window's
   * presentation under XWayland, so the shell grabs the pointer from a separate X connection
   * (src-tauri/src/rawmouse.rs) and mouse-look comes from raw motion. Game code listens for
   * 'bb-lockchange' / 'bb-lockerror' on document, which fire for either kind of capture.
   */
  private native = false;
  private capturing = false;

  private setLocked(v: boolean) {
    if (v === this.locked) return;
    this.locked = v;
    if (v) this.rawFlush = true; // drop motion gathered while the cursor was free
    if (!v) { this.moveX = this.moveZ = 0; }
    // deferred: callers that release the mouse to open a panel (exitLock(); openInventory()) must get
    // the panel up before listeners decide whether to show the pause menu
    queueMicrotask(() => document.dispatchEvent(new Event('bb-lockchange')));
  }

  // Linux desktop app (X11/XWayland): WebKitGTK's pointer lock barely reports motion there, so
  // mouse-look reads XInput2 raw motion from the shell instead (src-tauri/src/rawmouse.rs).
  private rawPending = false;
  private rawUnavailable = !ipc;
  private rawFlush = false;
  /** Raw motion is flowing: browser movementX is ignored while locked. */
  rawLive = false;

  /** Call once per frame. Async: the delta lands in mouseDX/DY for the next frame. */
  pollRaw() {
    if (this.rawUnavailable || this.rawPending || !this.locked) return;
    this.rawPending = true;
    ipc!.invoke('raw_mouse_delta').then((d: [number, number, number?, number?, number?] | null) => {
      this.rawPending = false;
      if (!d) { this.rawUnavailable = true; return; }
      if (this.rawFlush) { this.rawFlush = false; return; }
      // a frame's worth of real mouse motion is never thousands of px; drop garbage instead of spinning
      const [dx, dy] = Math.abs(d[0]) > 1500 || Math.abs(d[1]) > 1500 ? [0, 0] : d;
      if (dx || dy) this.rawLive = true;
      if (this.locked && this.rawLive) { this.mouseDX += dx; this.mouseDY += dy; }
      // buttons and wheel (v0.5 shell): the native grab keeps clicks from the page, so they come from here
      if (this.native && this.locked && d.length >= 5) {
        const held = d[2] ?? 0, pressed = d[3] ?? 0;
        for (const [bit, b] of [[1, 0], [2, 1], [4, 2]] as const) {
          this.mouseDown[b] = (held & bit) !== 0;
          if (pressed & bit) this.mousePressed[b] = true;
        }
        this.wheel += d[4] ?? 0;
      }
    }, () => { this.rawPending = false; this.rawUnavailable = true; });
  }

  requestLock() {
    if (this.touch) {
      enterFullscreen(); // only succeeds inside a tap; harmless otherwise
      this.setLocked(true);
      return;
    }
    if (this.locked) return;
    if (this.native) {
      if (this.capturing) return;
      this.capturing = true;
      ipc!.invoke('mouse_capture', { on: true }).then((ok: boolean) => {
        this.capturing = false;
        if (ok) { this.rawLive = true; this.setLocked(true); } else document.dispatchEvent(new Event('bb-lockerror'));
      }, () => { this.capturing = false; document.dispatchEvent(new Event('bb-lockerror')); });
      return;
    }
    this.el.requestPointerLock?.()?.catch?.(() => {});
  }
  exitLock() {
    if (!this.locked) return;
    if (this.touch) { this.setLocked(false); return; }
    if (this.native) {
      ipc!.invoke('mouse_capture', { on: false }).catch(() => {});
      this.setLocked(false);
      return;
    }
    document.exitPointerLock();
  }

  /** On-screen button pressed (touch): a key press for this frame, held until `release`. */
  press(code: string) {
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
  }
  release(code: string) {
    if (this.down.delete(code)) this.releasedThisFrame.add(code);
  }

  isDown(code: string) {
    return this.enabled && this.down.has(code);
  }
  pressed(code: string) {
    return this.enabled && this.pressedThisFrame.has(code);
  }
  /** Raw pressed query that ignores `enabled` (for menus). */
  pressedRaw(code: string) {
    return this.pressedThisFrame.has(code);
  }
  released(code: string) {
    return this.releasedThisFrame.has(code);
  }
  isDownRaw(code: string) {
    return this.down.has(code);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mousePressed = [false, false, false];
  }
}
