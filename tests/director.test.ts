import { describe, expect, it } from "vitest";
import { TelemetryTracker, type TelemetrySummary } from "../src/ai/TelemetrySummary";
import { deriveTags, fingerprint } from "../src/ai/BehaviorProfiler";
import { analyzeTrace, simulateCounterfactuals } from "../src/ai/CounterfactualSimulator";
import { applyExplanation, buildRequest, compact, parseExplanation, TacticalDirector, type StrategyProvider } from "../src/ai/TacticalDirector";
import { planCouncil, planForAllies } from "../src/ai/TacticalPlanner";
import { agents, graph, syntheticRun } from "./helpers";

function summary(over: Partial<TelemetrySummary>): TelemetrySummary {
  return { ...TelemetryTracker.empty(), runDuration: 50, ...over };
}

describe("Telemetry", () => {
  it("tracks zone entries, route choice, elevation and speed", () => {
    const t = new TelemetryTracker();
    let time = 0;
    const dt = 0.1;
    const path: Array<[number, number, number, string, boolean]> = [
      [0, 0, 0, "market", false],
      [6, 0, 0, "exit", false],
      [8, 1, 0, "yard", true],
      [10, 3.4, 0, "yard", true],
      [12, 2.2, 0, "court", false],
    ];
    for (const [x, y, z, zone, elev] of path) {
      for (let i = 0; i < 10; i++) {
        time += dt;
        t.sample(time, dt, x + i * 0.2, y, z, zone, elev, true, 99);
      }
    }
    const s = t.summary();
    expect(s.zoneEntryTimes.market).toBeCloseTo(0.1, 5);
    expect(s.zoneEntryTimes.court).toBeGreaterThan(s.zoneEntryTimes.yard);
    expect(s.routeChoice.awningShortcut).toBe(true);
    expect(s.routeChoice.rooftopShortcut).toBe(false);
    expect(s.elevatedRatio).toBeCloseTo(0.4, 1);
    expect(s.sprintRatio).toBeCloseTo(1, 5);
  });

  it("counts danger encounters with a cooldown", () => {
    const t = new TelemetryTracker();
    for (let i = 0; i < 50; i++) t.sample(i * 0.1, 0.1, i * 0.1, 0, 0, "court", false, false, 1.5);
    expect(t.summary().dangerEncounters).toBe(2);
  });
});

describe("Tactical Planner", () => {
  const trace = analyzeTrace(syntheticRun(), graph);
  const roofy = fingerprint(summary({ runDuration: 30, elevatedRatio: 0.63, averageSpeed: 7 }));
  const sim = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), roofy);
  const plan = planCouncil(sim, roofy, deriveTags(roofy));

  it("picks the simulator's best plan and explains it with evidence", () => {
    expect(plan.strategyId).toBe(sim.best.id);
    expect(plan.strategyName.length).toBeGreaterThan(3);
    expect(plan.reason.length).toBeGreaterThan(10);
    expect(plan.callout).toMatch(/^[A-Z' .!]+$/);
    expect(plan.allyAssignments).toHaveLength(3);
    expect(plan.candidates.length).toBe(3);
    expect(plan.profile?.title).toBe("FAST ROOFTOP RUNNER");
    expect(["early", "mid", "late"]).toContain(plan.pressureStyle);
  });

  it("can be forced to explain any simulated strategy", () => {
    const forced = planCouncil(sim, roofy, [], "the_rush");
    expect(forced.strategyId).toBe("the_rush");
    expect(forced.callout).toBe("WE'LL MEET YOU EARLY.");
  });

  it("re-plans the same strategy for whichever two allies are free", () => {
    const a = planForAllies(trace, graph, agents(["fishcat", "beans"]), roofy, plan.strategyId);
    expect(a.map((x) => x.cat).sort()).toEqual(["beans", "fishcat"]);
  });
});

describe("LLM explanation layer (optional)", () => {
  const trace = analyzeTrace(syntheticRun(), graph);
  const sim = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), null);
  const plan = planCouncil(sim, null, []);

  it("accepts a valid explanation and only renames / rewords", () => {
    const ex = parseExplanation({ name: "the roof is lava", line: "We know every roof you love.", roles: { soot: "Landing Guard" }, taunt: "Mrrp." });
    expect(ex).not.toBeNull();
    const out = applyExplanation(plan, ex!);
    expect(out.strategyName).toBe("THE ROOF IS LAVA");
    expect(out.strategyId).toBe(plan.strategyId);
    expect(out.allyAssignments.map((a) => a.point)).toEqual(plan.allyAssignments.map((a) => a.point));
    expect(out.source).toBe("llm");
  });

  it("rejects markup, oversized or unknown fields", () => {
    expect(parseExplanation({ line: "<script>alert(1)</script>" })).toBeNull();
    expect(parseExplanation({ name: "x".repeat(60) })).toBeNull();
    expect(parseExplanation({ roles: { hacker: "ROOT" } })).toBeNull();
    expect(parseExplanation("nope")).toBeNull();
  });

  it("keeps the deterministic plan when the provider fails", async () => {
    const failing: StrategyProvider = { name: "x", explain: async () => Promise.reject(new Error("down")) };
    const out = await new TacticalDirector(failing, 200).explain(plan, buildRequest(plan, null, [], summary({})));
    expect(out).toBe(plan);
  });

  it("keeps the deterministic plan when the provider times out", async () => {
    const slow: StrategyProvider = {
      name: "slow",
      explain: (_r, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const t0 = Date.now();
    const out = await new TacticalDirector(slow, 150).explain(plan, buildRequest(plan, null, [], summary({})));
    expect(out.source).toBe("counterfactual");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("only sends compact numbers and the already-chosen plan", () => {
    const fp = fingerprint(summary({ elevatedRatio: 0.333333 }));
    const req = buildRequest(plan, fp, deriveTags(fp), summary({ elevatedRatio: 0.333333 }));
    expect(Object.values(req.fingerprint).every((v) => typeof v === "number")).toBe(true);
    expect(req.telemetry.elevatedRatio).toBe(0.33);
    expect(req.candidates.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(req).length).toBeLessThan(4000);
    expect(Object.keys(compact(summary({}))).sort()).toEqual(["avgSpeed", "awningShortcut", "elevatedRatio", "fishDrops", "hisses", "interactions", "pounces", "rooftopShortcut", "runSeconds", "sprintRatio", "zoneSeconds"].sort());
  });
});
