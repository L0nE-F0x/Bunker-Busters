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

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
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
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) this.rawFlush = true; // drop motion gathered while the cursor was free
    });
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
    ipc!.invoke('raw_mouse_delta').then((d: [number, number] | null) => {
      this.rawPending = false;
      if (!d) { this.rawUnavailable = true; return; }
      if (this.rawFlush) { this.rawFlush = false; return; }
      const [dx, dy] = d;
      if (dx || dy) this.rawLive = true;
      if (this.locked && this.rawLive) { this.mouseDX += dx; this.mouseDY += dy; }
    }, () => { this.rawPending = false; this.rawUnavailable = true; });
  }

  requestLock() {
    if (!this.locked) this.el.requestPointerLock?.()?.catch?.(() => {});
  }
  exitLock() {
    if (this.locked) document.exitPointerLock();
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
