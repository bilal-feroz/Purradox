import { describe, expect, it } from "vitest";
import { deriveTags, fingerprint } from "../src/ai/BehaviorProfiler";
import { TelemetryTracker, type TelemetrySummary } from "../src/ai/TelemetrySummary";

function summary(over: Partial<TelemetrySummary>): TelemetrySummary {
  return { ...TelemetryTracker.empty(), runDuration: 40, averageSpeed: 5.5, ...over };
}
const pt = { t: 1, x: 0, y: 0, z: 0, zone: "court" };

describe("Behavior Profiler", () => {
  it("turns telemetry into per-minute rates and ratios", () => {
    const fp = fingerprint(summary({ runDuration: 30, pounces: [pt, pt], hisses: [pt, pt, pt], perfectHisses: 2, interactions: [{ ...pt, target: "bottle" }], routeChoice: { awningShortcut: true, rooftopShortcut: false } }));
    expect(fp.pounceRate).toBeCloseTo(4);
    expect(fp.hissRate).toBeCloseTo(6);
    expect(fp.perfectHissRate).toBeCloseTo(2 / 3);
    expect(fp.interactionRate).toBeCloseTo(2);
    expect(fp.shortcutUsage).toBe(0.5);
    expect(fp.awningRouteBias).toBe(1);
  });

  it("measures route entropy between 0 and 1", () => {
    const even = fingerprint(summary({ zoneTime: { market: 5, exit: 5, alley1: 5, court: 5 } }));
    const lopsided = fingerprint(summary({ zoneTime: { market: 30, exit: 1, alley1: 1, court: 1 } }));
    expect(even.routeEntropy).toBeCloseTo(1, 5);
    expect(lopsided.routeEntropy).toBeLessThan(0.6);
    expect(lopsided.routeEntropy).toBeGreaterThan(0);
  });

  it("calls a fast, high run a FAST ROOFTOP RUNNER with the real percentage", () => {
    const tags = deriveTags(fingerprint(summary({ elevatedRatio: 0.63, averageSpeed: 7.2 })));
    expect(tags[0].title).toBe("FAST ROOFTOP RUNNER");
    expect(tags[0].detail).toContain("63%");
  });

  it("counts shortcuts honestly", () => {
    const both = deriveTags(fingerprint(summary({ routeChoice: { awningShortcut: true, rooftopShortcut: true } })));
    expect(both.find((t) => t.id === "shortcut_habit")?.detail).toBe("YOU USED 2 OF 2 AVAILABLE CUTS.");
    const one = deriveTags(fingerprint(summary({ routeChoice: { awningShortcut: false, rooftopShortcut: true } })));
    expect(one.find((t) => t.id === "shortcut_habit")?.title).toBe("SHORTCUT HABIT");
  });

  it("spots a street loyalist only when both splits went the ground way", () => {
    const loyal = deriveTags(fingerprint(summary({ zoneTime: { alley1: 6, alley2: 8 }, elevatedRatio: 0.2 })));
    expect(loyal.some((t) => t.id === "ground_loyalist")).toBe(true);
    const mixed = deriveTags(fingerprint(summary({ zoneTime: { alley1: 6, lowroofs: 5 }, routeChoice: { awningShortcut: false, rooftopShortcut: true }, elevatedRatio: 0.2 })));
    expect(mixed.some((t) => t.id === "ground_loyalist")).toBe(false);
  });

  it("only calls a route chaotic when the thief actually doubled back", () => {
    const steady = deriveTags(fingerprint(summary({ zoneTime: { market: 4, exit: 4, alley1: 4, court: 4, alley2: 4, laundry: 4, climb: 4 }, zoneEntryTimes: { market: 0, exit: 4, alley1: 8, court: 12, alley2: 16, laundry: 20, climb: 24 }, zoneChanges: 6 })));
    expect(steady.some((t) => t.id === "chaotic_router")).toBe(false);
    const zigzag = deriveTags(fingerprint(summary({ zoneEntryTimes: { market: 0, exit: 4, court: 8 }, zoneChanges: 7 })));
    expect(zigzag.find((t) => t.id === "chaotic_router")?.detail).toBe("YOU DOUBLED BACK 5 TIMES.");
  });

  it("describes hissers with their perfect count, and falls back gracefully", () => {
    const hissy = deriveTags(fingerprint(summary({ hisses: [pt, pt, pt, pt], perfectHisses: 2 })));
    expect(hissy[0].detail).toBe("YOU HISSED 4 TIMES. 2 WERE PERFECT.");
    const plain = deriveTags(fingerprint(summary({})));
    expect(plain).toHaveLength(1);
    expect(plain[0].id).toBe("steady_runner");
  });
});
