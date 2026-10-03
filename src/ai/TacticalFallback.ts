import type { RivalId } from "../data/cats";
import type { TelemetrySummary } from "./TelemetrySummary";

export type StrategyId = "rooftop_trap" | "the_choke" | "the_rush" | "the_bait" | "shortcut_snare" | "the_patient_wall";

/** Where a helper cat should lie in wait along Past You's recorded path. */
export interface Assignment {
  cat: RivalId;
  role: "pressure" | "ambush" | "chaos";
  /** Zone ids to prefer for the ambush (in order). */
  zones: string[];
  /** Fraction of the run (0..1) to target if the zones are not visited. */
  fallbackProgress: number;
}

export interface TacticalPlan {
  id: StrategyId;
  name: string;
  line: string;
  assignments: Assignment[];
  source: "heuristic" | "llm";
  reasons: string[];
}

const NAMES: Record<StrategyId, string> = {
  rooftop_trap: "THE ROOFTOP TRAP",
  the_choke: "THE CHOKE",
  the_rush: "THE RUSH",
  the_bait: "THE BAIT",
  shortcut_snare: "THE SHORTCUT SNARE",
  the_patient_wall: "THE PATIENT WALL",
};

/**
 * Deterministic Tactical Director. Reads the Round 1 telemetry summary and
 * picks a high-level counter-strategy. Always available, never networked.
 */
export function heuristicPlan(s: TelemetrySummary): TacticalPlan {
  const reasons: string[] = [];
  const elevated = s.elevatedRatio;
  const fast = s.averageSpeed > 5.6 || s.sprintRatio > 0.55;
  const baity = s.interactions.length >= 2;
  const hissy = s.hisses.length >= 3;
  const shortcut = s.routeChoice.awningShortcut || s.routeChoice.rooftopShortcut;
  const alleyTime = (s.zoneTime["alley1"] ?? 0) + (s.zoneTime["alley2"] ?? 0);

  let id: StrategyId;
  if (elevated > 0.42 || s.routeChoice.rooftopShortcut) {
    id = "rooftop_trap";
    reasons.push(`spent ${Math.round(elevated * 100)}% of the run off the ground`);
  } else if (shortcut) {
    id = "shortcut_snare";
    reasons.push("took a shortcut the council now knows about");
  } else if (baity) {
    id = "the_bait";
    reasons.push(`used ${s.interactions.length} distractions`);
  } else if (fast) {
    id = "the_rush";
    reasons.push(`averaged ${s.averageSpeed.toFixed(1)} cat-lengths per second`);
  } else if (alleyTime > s.runDuration * 0.3) {
    id = "the_choke";
    reasons.push("funneled through the narrow alleys");
  } else if (hissy) {
    id = "the_patient_wall";
    reasons.push(`hissed ${s.hisses.length} times — so the council will wait`);
  } else {
    id = "the_choke";
    reasons.push("took the obvious route");
  }
  return planFor(id, reasons, "heuristic");
}

export function planFor(id: StrategyId, reasons: string[], source: "heuristic" | "llm", line?: string): TacticalPlan {
  const A = (cat: RivalId, role: Assignment["role"], zones: string[], fallbackProgress: number): Assignment => ({ cat, role, zones, fallbackProgress });
  let assignments: Assignment[];
  let defaultLine: string;
  switch (id) {
    case "rooftop_trap":
      defaultLine = "Soot holds the rooftop landing. Beans runs the chaos route. Mochi presses early.";
      assignments = [A("soot", "ambush", ["laundry", "lowroofs"], 0.62), A("beans", "chaos", ["climb", "laundry"], 0.82), A("mochi", "pressure", ["exit", "yard", "alley1"], 0.18)];
      break;
    case "shortcut_snare":
      defaultLine = "Your shortcut is known. The council waits where it comes out.";
      assignments = [A("mochi", "pressure", ["yard", "alley1"], 0.2), A("soot", "ambush", ["court", "lowroofs"], 0.45), A("beans", "chaos", ["laundry", "climb"], 0.75)];
      break;
    case "the_bait":
      defaultLine = "You love a distraction. Beans owns every prop on the street.";
      assignments = [A("beans", "chaos", ["court", "laundry"], 0.45), A("mochi", "pressure", ["exit", "alley1"], 0.2), A("soot", "ambush", ["alley2", "laundry"], 0.6)];
      break;
    case "the_rush":
      defaultLine = "Fast cat. Mochi meets speed with speed — early and often.";
      assignments = [A("mochi", "pressure", ["market", "exit"], 0.1), A("soot", "ambush", ["court"], 0.4), A("beans", "chaos", ["climb"], 0.85)];
      break;
    case "the_patient_wall":
      defaultLine = "Hiss all you like. The council will simply wait it out.";
      assignments = [A("soot", "ambush", ["alley2", "court"], 0.5), A("mochi", "pressure", ["alley1", "exit"], 0.25), A("beans", "chaos", ["laundry"], 0.7)];
      break;
    case "the_choke":
    default:
      defaultLine = "Every alley has a narrow part. The council will be standing in it.";
      assignments = [A("soot", "ambush", ["alley2", "alley1"], 0.5), A("mochi", "pressure", ["exit"], 0.2), A("beans", "chaos", ["laundry", "climb"], 0.75)];
      break;
  }
  return { id, name: NAMES[id], line: line ?? defaultLine, assignments, source, reasons };
}

export const STRATEGY_IDS = Object.keys(NAMES) as StrategyId[];
