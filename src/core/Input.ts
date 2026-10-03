// Keyboard + mouse input with pointer lock and buffered presses.
// Presses are timestamped so movement code can apply jump buffering and
// ability input buffering without missing a tap between frames.

export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "jump"
  | "pounce"
  | "hiss"
  | "interact"
  | "scent"
  | "pause";

const KEY_MAP: Record<string, Action> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  Space: "jump",
  KeyQ: "hiss",
  KeyE: "interact",
  KeyR: "scent",
  Escape: "pause",
};

const MOUSE_MAP: Record<number, Action> = {
  0: "pounce",
  2: "hiss",
};

export class Input {
  mouseDX = 0;
  mouseDY = 0;
  pointerLocked = false;
  /** Seconds since the mouse last moved the camera (for auto-follow fallback). */
  idleLook = 99;
  sensitivity = 1;
  invertY = false;
  enabled = true;

  private held = new Set<Action>();
  private pressTime = new Map<Action, number>();
  private consumed = new Set<Action>();
  private now = 0;
  /** Virtual (scripted/debug) held actions, OR'ed with real input. */
  private virtualHeld = new Set<Action>();
  private virtualMove = { x: 0, y: 0 };
  private lockListeners: Array<(locked: boolean) => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  onPointerLockChange(fn: (locked: boolean) => void): void {
    this.lockListeners.push(fn);
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      // Pointer lock may be unavailable (iframes, automation). Camera falls back to auto-follow.
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Advance the input clock; call once per frame before gameplay reads input. */
  beginFrame(realTime: number): void {
    this.now = realTime;
  }

  /** Clear per-frame accumulators; call at the end of each frame. */
  endFrame(dt: number): void {
    if (Math.abs(this.mouseDX) + Math.abs(this.mouseDY) > 0.5) this.idleLook = 0;
    else this.idleLook += dt;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  isHeld(a: Action): boolean {
    if (!this.enabled) return false;
    return this.held.has(a) || this.virtualHeld.has(a);
  }

  /** True if `a` was pressed within the last `window` seconds and not yet consumed. */
  consume(a: Action, window = 0.12): boolean {
    if (!this.enabled) return false;
    const t = this.pressTime.get(a);
    if (t === undefined || this.consumed.has(a)) return false;
    if (this.now - t > window) return false;
    this.consumed.add(a);
    return true;
  }

  /** Peek a buffered press without consuming it. */
  peek(a: Action, window = 0.12): boolean {
    const t = this.pressTime.get(a);
    if (t === undefined || this.consumed.has(a)) return false;
    return this.now - t <= window;
  }

  clearBuffers(): void {
    this.pressTime.clear();
    this.consumed.clear();
  }

  /** Movement axes: x = right, y = forward. */
  moveAxes(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.isHeld("forward")) y += 1;
    if (this.isHeld("back")) y -= 1;
    if (this.isHeld("right")) x += 1;
    if (this.isHeld("left")) x -= 1;
    x += this.virtualMove.x;
    y += this.virtualMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Scripted input for automated tests and the debug harness. */
  setVirtual(move: { x: number; y: number } | null, held: Action[] = []): void {
    this.virtualMove = move ?? { x: 0, y: 0 };
    this.virtualHeld = new Set(held);
  }

  press(a: Action): void {
    this.pressTime.set(a, this.now);
    this.consumed.delete(a);
  }

  resetAll(): void {
    this.held.clear();
    this.virtualHeld.clear();
    this.virtualMove = { x: 0, y: 0 };
    this.clearBuffers();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const a = KEY_MAP[e.code];
    if (!a) return;
    if (a === "jump" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    this.held.add(a);
    this.press(a);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const a = KEY_MAP[e.code];
    if (!a) return;
    this.held.delete(a);
  };

  private onMouseDown = (e: MouseEvent): void => {
    const a = MOUSE_MAP[e.button];
    if (!a) return;
    this.held.add(a);
    this.press(a);
  };

  private onMouseUp = (e: MouseEvent): void => {
    const a = MOUSE_MAP[e.button];
    if (a) this.held.delete(a);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    // Ignore the occasional huge spike some browsers emit when locking.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX * this.sensitivity;
    this.mouseDY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  private onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    for (const fn of this.lockListeners) fn(this.pointerLocked);
  };
}
