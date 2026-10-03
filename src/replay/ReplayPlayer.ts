import type { ReplayData, ReplayEvent, ReplaySnapshot, SampledState } from "./ReplayTypes";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Cubic Hermite between p1 and p2 with tangents scaled for non-uniform time. */
function hermite(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, u: number): number {
  const dt = t2 - t1;
  const m1 = t2 - t0 > 1e-6 ? ((p2 - p0) / (t2 - t0)) * dt : p2 - p1;
  const m2 = t3 - t1 > 1e-6 ? ((p3 - p1) / (t3 - t1)) * dt : p2 - p1;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

/**
 * Deterministic playback of a ReplayData. sample(t) is a pure function of t
 * (frame rate independent); events are delivered exactly once, in order,
 * at their recorded timestamps.
 */
export class ReplayPlayer {
  private cursorIndex = 0;
  private eventCursor = 0;
  private lastEventTime = -Infinity;

  constructor(readonly data: ReplayData) {
    if (data.snapshots.length === 0) throw new Error("ReplayPlayer: empty recording");
  }

  get duration(): number {
    return this.data.duration;
  }

  reset(): void {
    this.cursorIndex = 0;
    this.eventCursor = 0;
    this.lastEventTime = -Infinity;
  }

  /** Index i such that snaps[i].t <= t < snaps[i+1].t (clamped). */
  private findIndex(t: number): number {
    const s = this.data.snapshots;
    const n = s.length;
    if (t <= s[0].t) return 0;
    if (t >= s[n - 1].t) return n - 1;
    let i = Math.min(this.cursorIndex, n - 2);
    // Fast path for sequential playback.
    if (s[i].t <= t && t < s[i + 1].t) return i;
    if (i + 2 < n && s[i + 1].t <= t && t < s[i + 2].t) return i + 1;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  sample(t: number, out: SampledState): SampledState {
    const s = this.data.snapshots;
    const n = s.length;
    const i = this.findIndex(t);
    this.cursorIndex = i;
    const a = s[i];
    out.t = t;
    out.index = i;
    if (i >= n - 1 || t <= a.t) {
      this.copySnap(a, out);
      return out;
    }
    const b = s[i + 1];
    if (b.cut) {
      // Hold the pre-cut state; jump only once we reach the cut.
      this.copySnap(a, out);
      return out;
    }
    const span = b.t - a.t;
    const u = span > 1e-6 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    const p = i > 0 && !a.cut ? s[i - 1] : a;
    const q = i + 2 < n && !s[i + 2].cut ? s[i + 2] : b;
    const t0 = p === a ? a.t - span : p.t;
    const t3 = q === b ? b.t + span : q.t;
    for (let k = 0; k < 3; k++) {
      if (k === 1 && (a.grounded && b.grounded)) {
        out.position[1] = lerp(a.position[1], b.position[1], u);
      } else {
        out.position[k] = hermite(p.position[k], a.position[k], b.position[k], q.position[k], t0, a.t, b.t, t3, u);
      }
      out.velocity[k] = lerp(a.velocity[k], b.velocity[k], u);
    }
    // Never dip below the lower of the two endpoints while landing.
    if (!a.grounded && b.grounded) out.position[1] = Math.max(out.position[1], Math.min(a.position[1], b.position[1]));
    out.rotationY = lerpAngle(a.rotationY, b.rotationY, u);
    const src = u < 0.5 ? a : b;
    out.grounded = src.grounded;
    out.carryingFish = src.carryingFish;
    out.fishGrip = src.fishGrip;
    out.animationState = src.animationState;
    out.action = a.action;
    out.actionTime = a.action === b.action ? lerp(a.actionTime, b.actionTime, u) : a.actionTime + (t - a.t);
    return out;
  }

  private copySnap(a: ReplaySnapshot, out: SampledState): void {
    out.position[0] = a.position[0];
    out.position[1] = a.position[1];
    out.position[2] = a.position[2];
    out.velocity[0] = a.velocity[0];
    out.velocity[1] = a.velocity[1];
    out.velocity[2] = a.velocity[2];
    out.rotationY = a.rotationY;
    out.grounded = a.grounded;
    out.carryingFish = a.carryingFish;
    out.fishGrip = a.fishGrip;
    out.animationState = a.animationState;
    out.action = a.action;
    out.actionTime = a.actionTime;
  }

  /**
   * Events with timestamp in (lastPolled, t]. Each event is returned exactly
   * once; seeking backwards requires reset().
   */
  poll(t: number): ReplayEvent[] {
    const ev = this.data.events;
    const out: ReplayEvent[] = [];
    if (t < this.lastEventTime) return out;
    while (this.eventCursor < ev.length && ev[this.eventCursor].t <= t) {
      out.push(ev[this.eventCursor]);
      this.eventCursor++;
    }
    this.lastEventTime = t;
    return out;
  }

  /** Upcoming grounded positions from t to t+window (Scent Memory). */
  futurePath(t: number, window: number, step: number): Array<{ t: number; x: number; y: number; z: number; yaw: number; grounded: boolean }> {
    const out: Array<{ t: number; x: number; y: number; z: number; yaw: number; grounded: boolean }> = [];
    const tmp: SampledState = {
      t: 0,
      position: [0, 0, 0],
      rotationY: 0,
      velocity: [0, 0, 0],
      grounded: true,
      carryingFish: false,
      fishGrip: 3,
      animationState: "idle",
      action: "none",
      actionTime: 0,
      index: 0,
    };
    const saved = this.cursorIndex;
    for (let tt = t + step; tt <= Math.min(t + window, this.duration); tt += step) {
      this.sample(tt, tmp);
      out.push({ t: tt, x: tmp.position[0], y: tmp.position[1], z: tmp.position[2], yaw: tmp.rotationY, grounded: tmp.grounded });
    }
    this.cursorIndex = saved;
    return out;
  }

  /** Timestamps of all recorded events of a type (timeline markers, tests). */
  eventTimes(type: ReplayEvent["type"]): number[] {
    return this.data.events.filter((e) => e.type === type).map((e) => e.t);
  }
}
