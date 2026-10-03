// Tactical Planner: turns the Counterfactual Simulator's ranked candidates
// plus the human's Behavior Fingerprint into the Alley Council plan: WHAT
// should happen (strategy, ambush zones, roles, prop traps) and WHY. The
// Multi-Agent Coordinator and the cats' own state machines decide HOW.

import { CATS, type CatId } from "../data/cats";
import { SPAWN, ZONES, type V3 } from "../data/level";
import type { WaypointGraph } from "../level/WaypointGraph";
import type { BehaviorFingerprint, BehaviorTag } from "./BehaviorProfiler";
import {
  HABIT_COUNTERS,
  ROLE_NAMES,
  simulateCounterfactuals,
  type AgentSpec,
  type Candidate,
  type CounterId,
  type PlannedAssignment,
  type RoleId,
  type SimResult,
  type TraceInfo,
} from "./CounterfactualSimulator";

export interface AllyAssignment {
  cat: CatId;
  role: RoleId;
  roleName: string;
  zone: string;
  zoneName: string;
  point: V3;
  /** When Past You passes the point (s into the recording). */
  tPass: number;
  /** Planned seconds early. */
  slack: number;
  prop: string | null;
}

export interface CandidateSummary {
  id: CounterId;
  name: string;
  score: number;
  windows: number;
  earliest: number;
  coverage: number;
}

export interface CouncilPlan {
  strategyId: CounterId;
  strategyName: string;
  /** One-sentence explanation grounded in the fingerprint and the plan. */
  reason: string;
  /** Short dramatic stamp line ("YOU ALWAYS LAND HERE."). */
  callout: string;
  primaryAmbushZone: string;
  secondaryAmbushZone: string;
  pressureStyle: "early" | "mid" | "late";
  allyAssignments: AllyAssignment[];
  interactionPlan: Array<{ cat: CatId; prop: string; at: number }>;
  /** The behavior insight the council reacted to. */
  profile: BehaviorTag | null;
  /** Top scored candidates (for the debug view and the explanation layer). */
  candidates: CandidateSummary[];
  evaluated: number;
  ms: number;
  source: "counterfactual" | "llm";
  /** Optional council flavor line (LLM explanation layer only). */
  taunt?: string;
}

const PROP_NAMES: Record<string, string> = {
  laundry: "laundry line",
  pigeonFeed: "pigeon feed",
  trashCan: "trash can",
  bottle: "bottle",
  fishScraps: "fish scraps",
};

export function zoneName(id: string): string {
  return ZONES.find((z) => z.id === id)?.name ?? id;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const catName = (id: CatId) => CATS[id].name;

export function summarize(c: Candidate): CandidateSummary {
  return { id: c.id, name: c.name, score: Math.round(c.score * 1000) / 1000, windows: c.windows, earliest: c.earliest, coverage: Math.round(c.coverage * 100) / 100 };
}

function toAlly(a: PlannedAssignment): AllyAssignment {
  return { cat: a.cat, role: a.role, roleName: ROLE_NAMES[a.role], zone: a.zone, zoneName: zoneName(a.zone), point: a.point, tPass: a.tPass, slack: a.slack, prop: a.prop };
}

/** Explain the chosen candidate with evidence from the run and the plan. */
function explain(c: Candidate, fp: BehaviorFingerprint | null): { reason: string; callout: string } {
  const viable = c.assignments.filter((a) => a.slack >= 0.6).sort((a, b) => b.quality - a.quality);
  const lead = viable[0] ?? c.assignments[0];
  const who = lead ? catName(lead.cat) : "The council";
  const where = lead ? zoneName(lead.zone) : "Sardine Street";
  const early = lead ? `${Math.max(0, lead.slack).toFixed(1)}s` : "";
  switch (c.id) {
    case "rooftop_trap": {
      const landing = c.assignments.find((a) => a.role === "hold_landing");
      return {
        reason: `${fp ? `${pct(fp.rooftopRatio)} of your run was above street level. ` : ""}${landing ? `${catName(landing.cat)} holds the ${zoneName(landing.zone)} landing ${Math.max(0, landing.slack).toFixed(1)}s before you arrive.` : `${who} waits on the roofs.`}`,
        callout: landing ? "YOU ALWAYS LAND HERE." : "THE ROOFS ARE COVERED.",
      };
    }
    case "the_choke": {
      const narrow = c.assignments.find((a) => a.role === "cut_off" && (a.zone === "alley1" || a.zone === "alley2")) ?? c.assignments.find((a) => a.role === "cut_off") ?? lead;
      const place = narrow ? zoneName(narrow.zone) : where;
      return {
        reason: `${fp && fp.groundRouteBias >= 0.5 ? "You took the street at the splits. " : ""}${narrow ? catName(narrow.cat) : who} will be standing in the narrow part of the ${place}.`,
        callout: narrow && (narrow.zone === "alley1" || narrow.zone === "alley2") ? "WE'LL BE IN THE ALLEY." : `WE'LL BE IN THE ${place.toUpperCase()}.`,
      };
    }
    case "the_rush":
      return { reason: `${fp ? `You averaged ${fp.avgSpeed.toFixed(1)} m/s. ` : ""}${who} meets speed with speed in the ${where}, ${early} ahead of you.`, callout: "WE'LL MEET YOU EARLY." };
    case "the_bait": {
      const trap = c.assignments.find((a) => a.role === "environment_trap" && a.prop);
      const prop = trap?.prop ? PROP_NAMES[trap.prop] ?? trap.prop : "street";
      // a hisser gets a trap instead of a pounce: there is nothing to hiss at
      const hisser = fp !== null && fp.counts.interactions < 2 && fp.counts.hisses >= 3;
      const evidence = hisser
        ? `You hissed ${fp.counts.hisses} times, so nobody pounces. `
        : fp && fp.counts.interactions > 0
          ? `You used ${fp.counts.interactions} distraction${fp.counts.interactions > 1 ? "s" : ""}. `
          : "";
      return {
        reason: `${evidence}${trap ? `${catName(trap.cat)} owns the ${prop} on your route.` : `${who} sets the props against you.`}`,
        callout: hisser ? `YOU CAN'T HISS AT A ${prop.toUpperCase()}.` : `THE ${prop.toUpperCase()} IS OURS NOW.`,
      };
    }
    case "late_collapse": {
      const evidence = fp && fp.counts.backtracks >= 3 ? `You doubled back ${fp.counts.backtracks} times, but every route ends on the climb. ` : fp && fp.hesitationTime >= 2 ? `You stood still for ${fp.hesitationTime.toFixed(1)}s. ` : "";
      return { reason: `${evidence}The council lets you run, then closes in at the ${zoneName(c.assignments.find((a) => a.role === "late_collapse")?.zone ?? lead?.zone ?? "climb")}.`, callout: "YOU'LL NEVER REACH THE ROOF." };
    }
    case "double_cut":
    default:
      return {
        reason: `${fp ? `You used ${fp.counts.shortcuts} of 2 shortcuts. ` : ""}Both route splits are covered: ${c.assignments
          .filter((a) => a.role === "cut_off")
          .map((a) => `${catName(a.cat)} at the ${zoneName(a.zone)}`)
          .join(", ")}.`,
        callout: "BOTH EXITS ARE COVERED.",
      };
  }
}

/** Build the council plan from a simulation (optionally forcing a strategy). */
export function planCouncil(sim: SimResult, fp: BehaviorFingerprint | null, tags: BehaviorTag[], forced?: CounterId): CouncilPlan {
  const chosen = (forced && sim.top.find((c) => c.id === forced)) || sim.best;
  const { reason, callout } = explain(chosen, fp);
  const byTime = [...chosen.assignments].filter((a) => a.slack >= 0.6).sort((a, b) => b.quality - a.quality);
  const zonesRanked = [...new Set(byTime.map((a) => a.zone))];
  const earliestProgress = Number.isFinite(chosen.earliest) && sim.trace.duration > 0 ? chosen.earliest / sim.trace.duration : 1;
  return {
    strategyId: chosen.id,
    strategyName: chosen.name,
    reason,
    callout,
    primaryAmbushZone: zonesRanked[0] ?? chosen.assignments[0]?.zone ?? "",
    secondaryAmbushZone: zonesRanked[1] ?? zonesRanked[0] ?? "",
    pressureStyle: earliestProgress < 0.35 ? "early" : earliestProgress < 0.7 ? "mid" : "late",
    allyAssignments: chosen.assignments.map(toAlly),
    interactionPlan: chosen.assignments.filter((a) => a.prop).map((a) => ({ cat: a.cat, prop: a.prop as string, at: a.tPass })),
    // show the habit this plan answers (falls back to the most distinctive one)
    profile: tags.find((t) => HABIT_COUNTERS[t.id] === chosen.id) ?? tags[0] ?? null,
    candidates: sim.top.slice(0, 3).map(summarize),
    evaluated: sim.evaluated,
    ms: sim.ms,
    source: "counterfactual",
  };
}

/** How the planner models a council cat: its Round 2 start and AI speed. */
export function agentFor(id: CatId): AgentSpec {
  return { cat: id, archetype: CATS[id].archetype, start: SPAWN.hunters[id].pos, speed: CATS[id].stats.sprintSpeed * 0.85 };
}

/** Re-plan a chosen strategy for the two cats actually free in Round 2. */
export function planForAllies(trace: TraceInfo, graph: WaypointGraph, allies: AgentSpec[], fp: BehaviorFingerprint | null, strategy: CounterId): PlannedAssignment[] {
  if (allies.length === 0) return [];
  const sim = simulateCounterfactuals(trace, graph, allies, fp, strategy);
  return sim.best.assignments;
}
