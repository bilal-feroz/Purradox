import { describe, expect, it } from "vitest";
import { loadMemory, MEMORY_KEEP, recallHabit, remember, routeKind, saveMemory, type MemoryEntry } from "../src/ai/AlleyMemory";
import { analyzeTrace, simulateCounterfactuals } from "../src/ai/CounterfactualSimulator";
import { agents, graph, syntheticRun } from "./helpers";

const run = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  thief: "fishcat",
  route: "street",
  interactions: 0,
  hisses: 1,
  avgSpeed: 5.5,
  sprintRatio: 0.6,
  lead: null,
  strategy: null,
  ...over,
});

describe("Alley Memory", () => {
  it("keeps only the most recent runs, oldest first", () => {
    let h: MemoryEntry[] = [];
    for (let i = 0; i < 8; i++) h = remember(h, run({ hisses: i }));
    expect(h).toHaveLength(MEMORY_KEEP);
    expect(h[0].hisses).toBe(8 - MEMORY_KEEP);
    expect(h[h.length - 1].hisses).toBe(7);
  });

  it("stays quiet until a habit repeats three runs in a row", () => {
    expect(recallHabit([], run())).toBeNull();
    expect(recallHabit([run()], run())).toBeNull();
    const h = recallHabit([run(), run()], run());
    expect(h?.id).toBe("route");
    expect(h?.streak).toBe(3);
    expect(h?.line).toBe("3 RUNS IN A ROW YOU TOOK THE STREET AT BOTH SPLITS.");
    expect(h?.counter).toBe("the_choke");
  });

  it("only counts an unbroken streak", () => {
    const low = run({ route: "lowroofs" });
    // a street run two runs ago breaks the streak at 2
    expect(recallHabit([low, low, run(), low], low)).toBeNull();
    const h = recallHabit([run(), low, low], low);
    expect(h?.streak).toBe(3);
    expect(h?.line).toBe("3 RUNS IN A ROW YOU CUT ACROSS THE LOW ROOFS.");
  });

  it("prefers the more distinctive habit when streaks tie", () => {
    const tricky = run({ interactions: 3 });
    const h = recallHabit([tricky, tricky], tricky);
    expect(h?.id).toBe("props");
    expect(h?.counter).toBe("the_bait");
  });

  it("maps routes to their counters", () => {
    expect(routeKind(true, true)).toBe("both");
    expect(recallHabit([run({ route: "lowroofs" }), run({ route: "lowroofs" })], run({ route: "lowroofs" }))?.counter).toBe("rooftop_trap");
    expect(recallHabit([run({ route: "both" }), run({ route: "both" })], run({ route: "both" }))?.counter).toBe("double_cut");
  });

  it("survives missing browser storage", () => {
    expect(loadMemory()).toEqual([]);
    expect(() => saveMemory([run()])).not.toThrow();
  });

  it("gives only the remembered counter a small bonus", () => {
    const trace = analyzeTrace(syntheticRun(), graph);
    const plain = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), null);
    const remembered = simulateCounterfactuals(trace, graph, agents(["mochi", "soot", "beans"]), null, undefined, "the_bait");
    for (const c of remembered.top) {
      const before = plain.top.find((x) => x.id === c.id)!;
      expect(c.breakdown.memoryBonus).toBe(c.id === "the_bait" ? 0.12 : 0);
      expect(c.score - before.score).toBeCloseTo(c.breakdown.memoryBonus, 6);
    }
  });
});
