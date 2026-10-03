// Low-rate history of every moving thing in the world, captured during
// Round 1 so the rewind can visibly run the whole street backwards
// (rivals, pigeons, fish, knocked-over props) before the exact reset.

export interface Rewindable {
  readonly rewindId: string;
  /** Indices in the state array that are angles (wrap-aware lerp). */
  readonly angleIndices?: readonly number[];
  captureRewind(): number[];
  applyRewind(state: number[]): void;
}

interface Frame {
  t: number;
  states: number[][];
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class WorldHistory {
  private frames: Frame[] = [];
  private entities: Rewindable[] = [];
  private next = 0;
  readonly interval: number;
  private scratch: number[][] = [];

  constructor(hz = 12) {
    this.interval = 1 / hz;
  }

  register(e: Rewindable): void {
    this.entities.push(e);
  }

  clear(): void {
    this.frames = [];
    this.next = 0;
  }

  get duration(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  tick(t: number, force = false): void {
    if (t < this.next && !force) return;
    this.next = t + this.interval;
    this.frames.push({ t, states: this.entities.map((e) => e.captureRewind()) });
  }

  /** Apply the interpolated world state at time t. */
  apply(t: number): void {
    const f = this.frames;
    if (f.length === 0) return;
    let i = 0;
    if (t <= f[0].t) i = 0;
    else if (t >= f[f.length - 1].t) i = f.length - 1;
    else {
      let lo = 0;
      let hi = f.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (f[mid].t <= t) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const span = b.t - a.t;
    const u = span > 1e-6 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    this.entities.forEach((e, k) => {
      const sa = a.states[k];
      const sb = b.states[k];
      if (!sa || !sb) return;
      let out = this.scratch[k];
      if (!out || out.length !== sa.length) {
        out = new Array(sa.length).fill(0);
        this.scratch[k] = out;
      }
      for (let j = 0; j < sa.length; j++) {
        out[j] = e.angleIndices?.includes(j) ? lerpAngle(sa[j], sb[j], u) : sa[j] + (sb[j] - sa[j]) * u;
      }
      e.applyRewind(out);
    });
  }
}
