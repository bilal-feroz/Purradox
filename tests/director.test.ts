import { describe, expect, it } from "vitest";
import { TelemetryTracker, type TelemetrySummary } from "../src/ai/TelemetrySummary";
import { heuristicPlan } from "../src/ai/TacticalFallback";
import { TacticalDirector, compact, parsePlan, type StrategyProvider } from "../src/ai/TacticalDirector";

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

describe("Tactical Director (deterministic heuristic)", () => {
  it("answers a rooftop-heavy run with THE ROOFTOP TRAP", () => {
    const p = heuristicPlan(summary({ elevatedRatio: 0.55 }));
    expect(p.id).toBe("rooftop_trap");
    expect(p.name).toBe("THE ROOFTOP TRAP");
    expect(p.assignments.find((a) => a.cat === "soot")?.zones[0]).toBe("laundry");
  });

  it("answers a fast run with THE RUSH", () => {
    expect(heuristicPlan(summary({ averageSpeed: 7.2, sprintRatio: 0.8 })).id).toBe("the_rush");
  });

  it("answers a distraction-heavy run with THE BAIT", () => {
    const i = { t: 1, x: 0, y: 0, z: 0, zone: "court", target: "pigeonFeed" };
    expect(heuristicPlan(summary({ interactions: [i, { ...i, target: "trashCan" }] })).id).toBe("the_bait");
  });

  it("always assigns all three rivals", () => {
    const p = heuristicPlan(summary({}));
    expect(p.assignments.map((a) => a.cat).sort()).toEqual(["beans", "mochi", "soot"]);
  });
});

describe("Tactical Director (optional provider)", () => {
  it("accepts schema-valid provider output", () => {
    const p = parsePlan({ strategy: "the_choke", line: "Wait at the narrow part.", reasons: ["alleys"] });
    expect(p?.id).toBe("the_choke");
    expect(p?.source).toBe("llm");
    expect(p?.line).toBe("Wait at the narrow part.");
  });

  it("rejects unknown strategies and malformed answers", () => {
    expect(parsePlan({ strategy: "nuke_the_cat" })).toBeNull();
    expect(parsePlan("THE ROOFTOP TRAP")).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });

  it("drops suspicious text lines but keeps the strategy", () => {
    const p = parsePlan({ strategy: "the_rush", line: "<script>alert(1)</script>" });
    expect(p?.id).toBe("the_rush");
    expect(p?.line).not.toContain("<");
  });

  it("falls back to the heuristic when the provider fails", async () => {
    const failing: StrategyProvider = { name: "fail", propose: async () => Promise.reject(new Error("offline")) };
    const d = new TacticalDirector(failing, 200);
    const plan = await d.analyze(summary({ elevatedRatio: 0.6 }));
    expect(plan.source).toBe("heuristic");
    expect(plan.id).toBe("rooftop_trap");
  });

  it("falls back to the heuristic when the provider times out", async () => {
    const slow: StrategyProvider = {
      name: "slow",
      propose: (_s, signal) =>
        new Promise((_res, rej) => {
          signal.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    };
    const d = new TacticalDirector(slow, 50);
    const t0 = Date.now();
    const plan = await d.analyze(summary({}));
    expect(plan.source).toBe("heuristic");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("only sends a compact numeric summary", () => {
    const c = compact(summary({ elevatedRatio: 0.333333 }));
    expect(Object.keys(c).sort()).toEqual(["avgSpeed", "awningShortcut", "elevatedRatio", "fishDrops", "hisses", "interactions", "pounces", "rooftopShortcut", "runSeconds", "sprintRatio", "zoneSeconds"].sort());
    expect(c.elevatedRatio).toBe(0.33);
  });
});
