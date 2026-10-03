import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/ai/BehaviorProfiler";
import { analyzeTrace, COUNTER_IDS, simulateCounterfactuals } from "../src/ai/CounterfactualSimulator";
import { TelemetryTracker } from "../src/ai/TelemetrySummary";
import { agents, graph, syntheticRun } from "./helpers";

describe("Counterfactual Simulator", () => {
  const replay = syntheticRun();
  const trace = analyzeTrace(replay, graph);

  it("maps where and when the recorded run passes the waypoints", () => {
    expect(trace.passes.length).toBeGreaterThan(15);
    for (let i = 1; i < trace.passes.length; i++) expect(trace.passes[i].t).toBeGreaterThanOrEqual(trace.passes[i - 1].t);
    expect(trace.passes.every((p) => p.progress >= 0 && p.progress <= 1)).toBe(true);
    expect(trace.passes.some((p) => p.landing)).toBe(true);
  });

  it("evaluates hundreds of candidate plans and ranks every strategy", () => {
    const r = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), null);
    expect(r.evaluated).toBeGreaterThan(200);
    expect(r.top.length).toBe(COUNTER_IDS.length);
    for (let i = 1; i < r.top.length; i++) expect(r.top[i].score).toBeLessThanOrEqual(r.top[i - 1].score);
    expect(r.ms).toBeLessThan(1000);
  });

  it("produces a feasible, non-overlapping best plan", () => {
    const { best } = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), null);
    expect(best.assignments).toHaveLength(3);
    expect(new Set(best.assignments.map((a) => a.nodeId)).size).toBe(3);
    expect(new Set(best.assignments.map((a) => a.cat)).size).toBe(3);
    expect(best.windows).toBeGreaterThanOrEqual(2);
    for (const a of best.assignments.filter((x) => x.slack >= 0.6)) expect(a.tPass).toBeGreaterThan(a.travel);
    expect(best.coverage).toBeGreaterThan(0);
    expect(best.coverage).toBeLessThanOrEqual(1);
  });

  it("plans for whichever two cats are actually free (any thief, any hunter)", () => {
    const r = simulateCounterfactuals(trace, graph, agents(["fishcat", "mochi"]), null, "the_choke");
    expect(r.top).toHaveLength(1);
    expect(r.best.id).toBe("the_choke");
    expect(r.best.assignments.map((a) => a.cat).sort()).toEqual(["fishcat", "mochi"]);
  });

  it("lets the human's fingerprint steer which strategy wins", () => {
    const roofy = fingerprint({ ...TelemetryTracker.empty(), runDuration: 30, elevatedRatio: 0.7, averageSpeed: 7 });
    const ground = fingerprint({ ...TelemetryTracker.empty(), runDuration: 30, elevatedRatio: 0.05, averageSpeed: 5, zoneTime: { alley1: 5, alley2: 5 } });
    const posOf = (fp: ReturnType<typeof fingerprint>) => simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), fp).top.findIndex((c) => c.id === "rooftop_trap");
    expect(posOf(roofy)).toBeLessThanOrEqual(posOf(ground));
  });
});
