/** Keyboard + mouse state with pointer lock and edge-triggered "pressed" queries. */
export class Input {
  private down = new Set<string>();
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
      if (!this.locked) return;
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
    });
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
