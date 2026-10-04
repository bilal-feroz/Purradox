// Fish Grip: grip strength on ONE fish (3 → 0). No health bars.
// Pure logic so the rules are unit tested independently of rendering.

export const MAX_GRIP = 3;

export interface GripResult {
  before: number;
  after: number;
  dropped: boolean;
}

export class FishGrip {
  value = MAX_GRIP;

  reset(v = MAX_GRIP): void {
    this.value = Math.max(0, Math.min(MAX_GRIP, v));
  }

  /**
   * Remove one grip point. `floor` lets helper cats (and traps) wear Past
   * You down without knocking the fish loose while the hunter is far away.
   */
  damage(floor = 0): GripResult {
    const before = this.value;
    const after = Math.max(floor, before - 1);
    this.value = after;
    return { before, after, dropped: after <= 0 && before > 0 };
  }
}
