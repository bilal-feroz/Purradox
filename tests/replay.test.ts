import { describe, expect, it } from "vitest";
import { ReplayRecorder } from "../src/replay/ReplayRecorder";
import { ReplayPlayer } from "../src/replay/ReplayPlayer";
import { emptySample, type ReplayData, type ReplaySnapshot } from "../src/replay/ReplayTypes";

type Snap = Omit<ReplaySnapshot, "t">;

/** A deterministic "player" whose true path is an analytic curve. */
function truePath(t: number): Snap {
  const x = 6 * t;
  const z = Math.sin(t * 1.3) * 4;
  const airborne = t > 2 && t < 2.7;
  const y = airborne ? 4 * (t - 2) * (2.7 - t) * 3 : 0;
  return {
    position: [x, y, z],
    rotationY: Math.atan2(6, Math.cos(t * 1.3) * 5.2),
    velocity: [6, 0, Math.cos(t * 1.3) * 5.2],
    grounded: !airborne,
    carryingFish: t > 0.5,
    fishGrip: 3,
    animationState: airborne ? "air" : "run",
    action: t > 3 && t < 3.3 ? "pounce" : "none",
    actionTime: 0,
  };
}

/** Record a run with an irregular frame-time sequence. */
function record(frameTimes: number[], events: Array<[number, "jump" | "hiss" | "pounce"]> = []): ReplayData {
  const rec = new ReplayRecorder("fishcat", 20);
  rec.start();
  let t = 0;
  let ei = 0;
  rec.tick(0, () => truePath(0), true);
  for (const dt of frameTimes) {
    t += dt;
    while (ei < events.length && events[ei][0] <= t) {
      rec.event(t, events[ei][1], { dirX: 1, dirZ: 0 }, () => truePath(t));
      ei++;
    }
    rec.tick(t, () => truePath(t));
  }
  return rec.finish(t, () => truePath(t), true);
}

function frames(total: number, dt: number | (() => number)): number[] {
  const out: number[] = [];
  let t = 0;
  while (t < total) {
    const d = typeof dt === "number" ? dt : dt();
    out.push(d);
    t += d;
  }
  return out;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("ReplayRecorder", () => {
  it("samples at roughly the configured rate regardless of frame rate", () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const data = record(frames(10, dt));
      const rate = data.snapshots.length / data.duration;
      expect(rate).toBeGreaterThan(17);
      expect(rate).toBeLessThan(24);
    }
  });

  it("keeps snapshot times strictly increasing", () => {
    const rnd = seeded(7);
    const data = record(frames(8, () => 0.005 + rnd() * 0.06), [
      [1.0, "jump"],
      [1.0001, "hiss"],
      [3.0, "pounce"],
    ]);
    for (let i = 1; i < data.snapshots.length; i++) {
      expect(data.snapshots[i].t).toBeGreaterThan(data.snapshots[i - 1].t);
    }
  });

  it("forces an exact-time snapshot for every event", () => {
    const data = record(frames(5, 1 / 60), [[2.0, "jump"]]);
    const ev = data.events.find((e) => e.type === "jump")!;
    expect(data.snapshots.some((s) => Math.abs(s.t - ev.t) < 1e-9)).toBe(true);
  });
});

describe("ReplayPlayer", () => {
  const data = record(frames(6, 1 / 60), [
    [1.27, "hiss"],
    [3.0, "pounce"],
    [4.5, "jump"],
  ]);

  it("returns the exact recorded transform at snapshot timestamps", () => {
    const p = new ReplayPlayer(data);
    const out = emptySample();
    for (const s of data.snapshots) {
      p.sample(s.t, out);
      expect(out.position[0]).toBeCloseTo(s.position[0], 9);
      expect(out.position[1]).toBeCloseTo(s.position[1], 9);
      expect(out.position[2]).toBeCloseTo(s.position[2], 9);
    }
  });

  it("interpolates smoothly between snapshots (no snapping)", () => {
    const p = new ReplayPlayer(data);
    const out = emptySample();
    let prev: number[] | null = null;
    let maxStep = 0;
    for (let t = 0; t <= data.duration; t += 1 / 240) {
      p.sample(t, out);
      if (prev) maxStep = Math.max(maxStep, Math.hypot(out.position[0] - prev[0], out.position[2] - prev[2]));
      prev = [...out.position];
    }
    // ~6.5 u/s at 240 Hz ≈ 0.027 per step; a snap would be ~0.3
    expect(maxStep).toBeLessThan(0.05);
  });

  it("stays close to the true continuous path between samples", () => {
    const p = new ReplayPlayer(data);
    const out = emptySample();
    let maxErr = 0;
    for (let t = 0.2; t < data.duration - 0.2; t += 0.013) {
      p.sample(t, out);
      const truth = truePath(t).position;
      maxErr = Math.max(maxErr, Math.hypot(out.position[0] - truth[0], out.position[2] - truth[2]));
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it("is frame-rate independent: identical samples at identical times", () => {
    const a = new ReplayPlayer(data);
    const b = new ReplayPlayer(data);
    const oa = emptySample();
    const ob = emptySample();
    // a steps at 60 Hz, b at a jittery rate; compare at shared checkpoints
    const checkpoints = [0.5, 1.27, 2.35, 3.0, 4.5, 5.9];
    let ta = 0;
    let tb = 0;
    const rnd = seeded(99);
    for (const c of checkpoints) {
      while (ta + 1 / 60 < c) ta += 1 / 60;
      while (tb + 0.01 < c) tb += 0.005 + rnd() * 0.02;
      a.sample(ta, oa);
      b.sample(tb, ob);
      a.sample(c, oa);
      b.sample(c, ob);
      expect(oa.position).toEqual(ob.position);
      expect(oa.rotationY).toBe(ob.rotationY);
    }
  });

  it("delivers each event exactly once, in order, at its recorded time", () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.37]) {
      const p = new ReplayPlayer(data);
      const fired: Array<{ type: string; t: number; at: number }> = [];
      for (let t = 0; t <= data.duration + dt; t += dt) {
        for (const e of p.poll(t)) fired.push({ type: e.type, t: e.t, at: t });
      }
      expect(fired.map((f) => f.type)).toEqual(data.events.map((e) => e.type));
      for (const f of fired) {
        expect(f.at).toBeGreaterThanOrEqual(f.t);
        expect(f.at - f.t).toBeLessThan(dt + 1e-9);
      }
    }
  });

  it("fires the recorded hiss at the recorded timestamp (the Past You counter)", () => {
    const p = new ReplayPlayer(data);
    const hiss = data.events.find((e) => e.type === "hiss")!;
    expect(hiss.t).toBeCloseTo(1.27, 1);
    expect(p.poll(hiss.t - 0.001).some((e) => e.type === "hiss")).toBe(false);
    expect(p.poll(hiss.t).some((e) => e.type === "hiss")).toBe(true);
    expect(p.poll(hiss.t + 0.5).some((e) => e.type === "hiss")).toBe(false);
  });

  it("does not interpolate across a respawn cut", () => {
    const rec = new ReplayRecorder("fishcat", 20);
    rec.start();
    const snap = (x: number): Snap => ({ ...truePath(0), position: [x, 0, 0] });
    rec.tick(0, () => snap(0), true);
    rec.tick(0.05, () => snap(0.3));
    rec.tick(0.1, () => snap(0.6));
    rec.cut(0.15, () => snap(50));
    rec.tick(0.2, () => snap(50.3));
    const d = rec.finish(0.25, () => snap(50.6), true);
    const p = new ReplayPlayer(d);
    const out = emptySample();
    p.sample(0.13, out);
    expect(out.position[0]).toBeLessThan(1);
    p.sample(0.16, out);
    expect(out.position[0]).toBeGreaterThan(49);
  });

  it("previews the next seconds of the path for Scent Memory", () => {
    const p = new ReplayPlayer(data);
    const path = p.futurePath(1, 2.5, 0.12);
    expect(path.length).toBeGreaterThan(15);
    expect(path[0].t).toBeGreaterThan(1);
    expect(path[path.length - 1].t).toBeLessThanOrEqual(3.5 + 1e-9);
  });

  it("clamps sampling outside the recording", () => {
    const p = new ReplayPlayer(data);
    const out = emptySample();
    p.sample(-5, out);
    expect(out.position).toEqual(data.snapshots[0].position);
    p.sample(999, out);
    expect(out.position).toEqual(data.snapshots[data.snapshots.length - 1].position);
  });
});
