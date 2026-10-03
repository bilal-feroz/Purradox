import type { CatId } from "../data/cats";
import type { ReplayData, ReplayEvent, ReplayEventType, ReplaySnapshot } from "./ReplayTypes";

export type SnapshotSource = () => Omit<ReplaySnapshot, "t">;

/**
 * Records a player's run as authoritative snapshots at a fixed rate
 * (default 20 Hz) plus discrete events. Every event also forces an extra
 * snapshot at its exact timestamp so sharp transitions (takeoff, landing,
 * pounce launch) are preserved for interpolation.
 */
export class ReplayRecorder {
  private snapshots: ReplaySnapshot[] = [];
  private events: ReplayEvent[] = [];
  private nextSample = 0;
  private lastT = -1;
  recording = false;

  constructor(
    readonly catId: CatId,
    readonly hz = 20,
  ) {}

  get interval(): number {
    return 1 / this.hz;
  }

  get snapshotCount(): number {
    return this.snapshots.length;
  }

  get eventCount(): number {
    return this.events.length;
  }

  start(): void {
    this.snapshots = [];
    this.events = [];
    this.nextSample = 0;
    this.lastT = -1;
    this.recording = true;
  }

  /** Call once per simulation frame with the run clock. */
  tick(t: number, source: SnapshotSource, force = false): void {
    if (!this.recording) return;
    if (t + 1e-9 < this.nextSample && !force) return;
    this.push(t, source());
    // Never schedule into the past after a long frame.
    this.nextSample = Math.max(this.nextSample + this.interval, t + this.interval * 0.5);
  }

  /** Record a discrete event (and an exact-time snapshot). */
  event(t: number, type: ReplayEventType, payload: ReplayEvent["payload"] | undefined, source: SnapshotSource | null): void {
    if (!this.recording) return;
    this.events.push(payload ? { t, type, payload } : { t, type });
    if (source) this.push(t, source());
  }

  /** Mark a discontinuity (respawn teleport). */
  cut(t: number, source: SnapshotSource): void {
    if (!this.recording) return;
    const tt = Math.max(t, this.lastT + 1e-4);
    this.insert({ ...source(), t: tt, cut: true });
    this.events.push({ t: tt, type: "respawn" });
  }

  private push(t: number, s: Omit<ReplaySnapshot, "t">): void {
    if (t <= this.lastT + 1e-6) {
      // Same timestamp: overwrite with the newest state (keeps monotonic times).
      const last = this.snapshots[this.snapshots.length - 1];
      if (last && Math.abs(last.t - t) < 1e-6) {
        this.snapshots[this.snapshots.length - 1] = { ...s, t, cut: last.cut };
        return;
      }
      return;
    }
    this.insert({ ...s, t });
  }

  private insert(s: ReplaySnapshot): void {
    this.snapshots.push(s);
    this.lastT = s.t;
  }

  finish(t: number, source: SnapshotSource, finished: boolean): ReplayData {
    if (this.recording) this.push(t, source());
    this.recording = false;
    const events = [...this.events].sort((a, b) => a.t - b.t);
    return {
      version: 1,
      catId: this.catId,
      hz: this.hz,
      duration: t,
      snapshots: this.snapshots.slice(),
      events,
      finished,
    };
  }
}
