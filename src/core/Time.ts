// Game clock: separates wall-clock frame time from simulation time so hit-stop,
// slow motion and pausing never leak into the replay timeline.

export class GameTime {
  /** Unscaled seconds since last frame (clamped). */
  realDt = 0;
  /** Scaled simulation seconds this frame. */
  simDt = 0;
  /** Total simulation seconds since boot. */
  simTime = 0;
  /** Total unscaled seconds since boot. */
  realTime = 0;
  /** Manual base scale (1 = normal, 0 = frozen). */
  baseScale = 1;
  paused = false;

  private hitStopRemaining = 0;
  private slowMoRemaining = 0;
  private slowMoFactor = 1;
  private last = -1;

  /** Freeze simulation briefly for impact feel (seconds of real time). */
  hitStop(seconds: number): void {
    this.hitStopRemaining = Math.max(this.hitStopRemaining, seconds);
  }

  slowMo(seconds: number, factor: number): void {
    this.slowMoRemaining = Math.max(this.slowMoRemaining, seconds);
    this.slowMoFactor = factor;
  }

  clearEffects(): void {
    this.hitStopRemaining = 0;
    this.slowMoRemaining = 0;
    this.slowMoFactor = 1;
  }

  get scale(): number {
    if (this.paused) return 0;
    if (this.hitStopRemaining > 0) return 0.02 * this.baseScale;
    if (this.slowMoRemaining > 0) return this.slowMoFactor * this.baseScale;
    return this.baseScale;
  }

  tick(nowMs: number): void {
    if (this.last < 0) this.last = nowMs;
    const raw = (nowMs - this.last) / 1000;
    this.last = nowMs;
    // Clamp long frames (tab switches, GC) so physics never tunnels.
    this.realDt = Math.min(Math.max(raw, 0), 1 / 20);
    this.realTime += this.realDt;
    if (!this.paused) {
      if (this.hitStopRemaining > 0) this.hitStopRemaining -= this.realDt;
      else if (this.slowMoRemaining > 0) this.slowMoRemaining -= this.realDt;
    }
    this.simDt = this.realDt * this.scale;
    this.simTime += this.simDt;
  }

  /** Re-anchor after a long pause so the next frame does not see a huge dt. */
  resync(nowMs: number): void {
    this.last = nowMs;
  }

  /** Timestamp (ms) of the last tick — used by the debug frame stepper. */
  get lastStamp(): number {
    return this.last;
  }
}
