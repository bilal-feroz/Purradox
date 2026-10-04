// Multi-Agent Coordinator (Round 2).
//
// The Tactical Planner says WHAT should happen; this turns it into one
// mission per AI ally and re-plans only at discrete moments (an ally's
// intercept passed or landed, the fish dropped, Past You entered a new
// zone). The cats' own state machines decide HOW: they walk the waypoint
// graph, perceive Past You with normal vision, wind up their pounces and
// respect cooldowns. Nothing here runs per frame.

import type { CatId } from "../data/cats";
import type { V3 } from "../data/level";
import type { WaypointGraph } from "../level/WaypointGraph";
import type { AgentSpec, NodePass, PlannedAssignment, RoleId, TraceInfo } from "./CounterfactualSimulator";

export interface CoordMission {
  cat: CatId;
  role: RoleId;
  point: V3;
  /** Recording time Past You passes the point. */
  arriveAt: number;
  zone: string;
  prop: string | null;
  nodeId: string;
  /** "plan" for the council's original intercept, "replan" for follow-ups. */
  source: "plan" | "replan";
}

export interface CoordinatorEvent {
  t: number;
  kind: "start" | "missionEnded" | "fishDropped" | "zoneEntered" | "replan" | "noIntercept";
  cat?: CatId;
  detail: string;
}

const REACTION = 0.8;
const MIN_SLACK = 0.6;

export class Coordinator {
  readonly missions = new Map<CatId, CoordMission>();
  readonly log: CoordinatorEvent[] = [];
  replans = 0;
  private readonly agents = new Map<CatId, AgentSpec>();

  constructor(
    private readonly trace: TraceInfo,
    private readonly graph: WaypointGraph,
  ) {}

  /** Hand each ally its planned intercept. */
  start(plan: PlannedAssignment[], agents: AgentSpec[]): CoordMission[] {
    this.missions.clear();
    this.agents.clear();
    for (const a of agents) this.agents.set(a.cat, a);
    for (const a of plan) {
      const m: CoordMission = { cat: a.cat, role: a.role, point: a.point, arriveAt: a.tPass, zone: a.zone, prop: a.prop, nodeId: a.nodeId, source: "plan" };
      this.missions.set(a.cat, m);
    }
    this.note(0, "start", undefined, plan.map((a) => `${a.cat}:${a.role}@${a.zone}`).join(", "));
    return [...this.missions.values()];
  }

  /**
   * An ally's intercept passed (or it landed its pounce): find the best
   * intercept still reachable ahead of Past You from where the cat stands.
   */
  missionEnded(cat: CatId, from: { x: number; y: number; z: number }, now: number): CoordMission | null {
    this.note(now, "missionEnded", cat, this.missions.get(cat)?.zone ?? "");
    const agent = this.agents.get(cat);
    const prev = this.missions.get(cat);
    if (!agent) return null;
    const start = this.graph.nearest(from.x, from.y, from.z);
    let best: NodePass | null = null;
    let bestScore = -Infinity;
    for (const p of this.trace.passes) {
      if (p.t < now + 1.5) continue;
      const len = Math.hypot(start.x - from.x, start.z - from.z) + this.graph.pathLength(this.graph.path(start, p.node));
      const slack = p.t - now - (len / Math.max(1, agent.speed) + REACTION);
      if (slack < MIN_SLACK) continue;
      // prefer near-future, close-to-the-line, grounded points that suit the role
      let score = 1 - Math.min(1, p.dist / 3.5) + (p.grounded ? 0.3 : 0) - (p.t - now) * 0.04;
      if (prev?.role === "hold_landing" && p.landing) score += 0.4;
      if (prev?.role === "cut_off" && p.degree >= 3) score += 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) {
      this.missions.delete(cat);
      this.note(now, "noIntercept", cat, "shadowing Past You");
      return null;
    }
    const role: RoleId = prev?.role === "environment_trap" ? "cut_off" : prev?.role ?? "cut_off";
    const m: CoordMission = { cat, role, point: [best.node.x, best.node.y, best.node.z], arriveAt: best.t, zone: best.zone, prop: null, nodeId: best.node.id, source: "replan" };
    this.missions.set(cat, m);
    this.replans++;
    this.note(now, "replan", cat, `${role} at ${best.zone} (${best.t.toFixed(1)}s)`);
    return m;
  }

  /**
   * Opening move: the earliest point on Past You's route this ally can reach
   * in time. Taken only when it comes well before the planned intercept, so
   * a cat that starts near the market harasses Past You on the way there
   * instead of walking off to wait.
   */
  firstStrike(cat: CatId, from: { x: number; y: number; z: number }, before: number): CoordMission | null {
    const agent = this.agents.get(cat);
    if (!agent) return null;
    const start = this.graph.nearest(from.x, from.y, from.z);
    let best: NodePass | null = null;
    for (const p of this.trace.passes) {
      if (p.t > before - 5 || p.progress > 0.5 || p.dist > 2.5) continue;
      if (best && p.t >= best.t) continue;
      const len = Math.hypot(start.x - from.x, start.z - from.z) + this.graph.pathLength(this.graph.path(start, p.node));
      if (p.t - (len / Math.max(1, agent.speed) + REACTION) < MIN_SLACK) continue;
      best = p;
    }
    if (!best) return null;
    this.note(0, "replan", cat, `first strike at ${best.zone} (${best.t.toFixed(1)}s)`);
    return { cat, role: "early_pressure", point: [best.node.x, best.node.y, best.node.z], arriveAt: best.t, zone: best.zone, prop: null, nodeId: best.node.id, source: "plan" };
  }

  /** Discrete world events worth recording (and re-checking) for the plan. */
  event(kind: "fishDropped" | "zoneEntered", now: number, detail: string): void {
    this.note(now, kind, undefined, detail);
  }

  private note(t: number, kind: CoordinatorEvent["kind"], cat: CatId | undefined, detail: string): void {
    this.log.push({ t: Math.round(t * 10) / 10, kind, cat, detail });
    if (this.log.length > 40) this.log.shift();
  }
}
