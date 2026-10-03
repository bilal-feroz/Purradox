import type { Game } from "../core/Game";

export type RoutePoint = [number, number, number] | { pounce: true } | { hiss: true } | { interact: true } | { wait: number };

/**
 * Test autopilot (debug only): drives the controlled cat through a route of
 * waypoints using the real input path (virtual keys), so automated runs
 * exercise exactly the same movement code a human uses.
 */
export class Autopilot {
  route: RoutePoint[] = [];
  idx = 0;
  frames = 0;
  stuck = 0;
  lastD = 1e9;
  waitLeft = 0;
  readonly log: string[] = [];
  sprint = true;
  done = false;

  constructor(private readonly g: Game) {}

  start(route: RoutePoint[], sprint = true): void {
    this.route = route;
    this.idx = 0;
    this.frames = 0;
    this.stuck = 0;
    this.lastD = 1e9;
    this.waitLeft = 0;
    this.log.length = 0;
    this.sprint = sprint;
    this.done = false;
  }

  /** Advance up to `maxFrames` simulation frames (no rendering). */
  run(maxFrames: number, dt = 1 / 60, render = false): { idx: number; frames: number; done: boolean; state: string; pos: number[]; log: string[] } {
    const g = this.g;
    const prevRender = g.renderEnabled;
    g.renderEnabled = render;
    for (let f = 0; f < maxFrames && !this.done; f++) {
      this.tick();
      g.frame(g.time.lastStamp + dt * 1000);
      this.frames++;
    }
    g.renderEnabled = prevRender;
    g.input.setVirtual(null, []);
    const a = g.controlled;
    return {
      idx: this.idx,
      frames: this.frames,
      done: this.done,
      state: g.fsm.state,
      pos: a ? [+a.position.x.toFixed(2), +a.position.y.toFixed(2), +a.position.z.toFixed(2)] : [],
      log: this.log.slice(-12),
    };
  }

  private tick(): void {
    const g = this.g;
    const a = g.controlled;
    if (!a || this.idx >= this.route.length) {
      this.done = true;
      g.input.setVirtual(null, []);
      return;
    }
    if (!g.isGameplay()) {
      this.log.push(`state ${g.fsm.state} @${this.frames}`);
      this.done = true;
      return;
    }
    const step = this.route[this.idx];
    const held: Array<"sprint" | "jump"> = this.sprint ? ["sprint"] : [];
    if (!Array.isArray(step)) {
      if ("wait" in step) {
        if (this.waitLeft <= 0) this.waitLeft = step.wait;
        this.waitLeft -= 1 / 60;
        g.input.setVirtual({ x: 0, y: 0 }, []);
        if (this.waitLeft <= 0) this.idx++;
        return;
      }
      if ("pounce" in step) g.input.press("pounce");
      if ("hiss" in step) g.input.press("hiss");
      if ("interact" in step) g.input.press("interact");
      this.idx++;
      return;
    }
    const [tx, ty, tz] = step;
    const dx = tx - a.position.x;
    const dz = tz - a.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.55 && Math.abs(ty - a.position.y) < 0.65) {
      this.log.push(`ok ${this.idx} @${this.frames}`);
      this.idx++;
      this.stuck = 0;
      this.lastD = 1e9;
      return;
    }
    const cy = g.camera.yaw;
    const fx = -Math.sin(cy);
    const fz = -Math.cos(cy);
    const rx = Math.cos(cy);
    const rz = -Math.sin(cy);
    const nx = dx / Math.max(d, 1e-4);
    const nz = dz / Math.max(d, 1e-4);
    if (ty > a.position.y + 0.28 && d < 2.9 && a.grounded) {
      g.input.press("jump");
      held.push("jump");
    } else if (!a.grounded && a.velocity.y > 0) held.push("jump");
    g.input.setVirtual({ x: nx * rx + nz * rz, y: nx * fx + nz * fz }, held);
    if (d > this.lastD - 0.003) this.stuck++;
    else this.stuck = 0;
    this.lastD = Math.min(this.lastD, d);
    if (this.stuck > 150) {
      this.log.push(`STUCK ${this.idx} at ${a.position.x.toFixed(2)},${a.position.y.toFixed(2)},${a.position.z.toFixed(2)} → ${tx},${ty},${tz}`);
      this.done = true;
    }
  }
}
