// Counterfactual Simulator.
//
// Round 1 is a deterministic recording, so before Round 2 starts the
// human's run is a KNOWN future. This module uses that trace to try many
// ways the council could stop it: it generates candidate strategies
// (strategy template x which cat takes which role x where each cat
// waits), fast-forwards each one as lightweight agent travel through the
// waypoint graph against the recorded run (no rendering, no physics), and
// scores what would happen. The best candidate becomes the Alley Council
// plan; the agents that execute it still move, perceive and pounce like
// any other cat (they never snap onto Past You's future position).

import type { Archetype, CatId } from "../data/cats";
import { INTERACTABLES, type V3 } from "../data/level";
import type { NavNode, WaypointGraph } from "../level/WaypointGraph";
import { zoneAt } from "../level/Zones";
import type { ReplayData } from "../replay/ReplayTypes";
import type { BehaviorFingerprint } from "./BehaviorProfiler";

export type RoleId = "early_pressure" | "cut_off" | "hold_landing" | "environment_trap" | "late_collapse";

export const ROLE_NAMES: Record<RoleId, string> = {
  early_pressure: "EARLY PRESSURE",
  cut_off: "CUT OFF",
  hold_landing: "HOLD LANDING",
  environment_trap: "ENVIRONMENT TRAP",
  late_collapse: "LATE COLLAPSE",
};

export type CounterId = "rooftop_trap" | "the_choke" | "the_rush" | "the_bait" | "late_collapse" | "double_cut";

export const COUNTER_NAMES: Record<CounterId, string> = {
  rooftop_trap: "THE ROOFTOP TRAP",
  the_choke: "THE CHOKE",
  the_rush: "THE RUSH",
  the_bait: "THE BAIT",
  late_collapse: "THE LATE COLLAPSE",
  double_cut: "THE DOUBLE CUT",
};

/** Where and when the recorded run passes a waypoint. */
export interface NodePass {
  node: NavNode;
  /** Recording time of closest approach (s). */
  t: number;
  /** Closest approach distance (m). */
  dist: number;
  grounded: boolean;
  zone: string;
  /** Past You lands from a jump right here. */
  landing: boolean;
  /** Interactable prop within reach of this waypoint. */
  prop: string | null;
  /** t / duration. */
  progress: number;
  /** Graph degree (junctions make good cut-off points). */
  degree: number;
  /** Trap spot next to a prop (environment traps stand here, not on the node). */
  spot?: V3;
}

export interface TraceInfo {
  duration: number;
  passes: NodePass[];
  /** Props Past You runs past (and hasn't used yet at that moment). */
  propPasses: NodePass[];
  /** Distance Past You has travelled at each snapshot (for route advantage). */
  cumulative: Array<{ t: number; d: number }>;
}

export interface AgentSpec {
  cat: CatId;
  archetype: Archetype;
  /** Where the cat starts Round 2. */
  start: V3;
  /** Planning speed (m/s). */
  speed: number;
}

export interface PlannedAssignment {
  cat: CatId;
  role: RoleId;
  nodeId: string;
  point: V3;
  /** When Past You passes the point. */
  tPass: number;
  /** Fast-forwarded travel time for the cat (incl. reaction delay). */
  travel: number;
  /** Seconds early (negative = too late). */
  slack: number;
  quality: number;
  zone: string;
  prop: string | null;
}

export interface CandidateBreakdown {
  interceptQuality: number;
  coverage: number;
  routeAdvantage: number;
  roleSynergy: number;
  fishDrop: number;
  diversity: number;
  prior: number;
  unfairnessPenalty: number;
  travelImpossibility: number;
  duplicateRolePenalty: number;
}

export interface Candidate {
  id: CounterId;
  name: string;
  assignments: PlannedAssignment[];
  score: number;
  breakdown: CandidateBreakdown;
  /** Viable intercept windows. */
  windows: number;
  /** Earliest viable intercept time (s), Infinity if none. */
  earliest: number;
  coverage: number;
}

export interface SimResult {
  evaluated: number;
  ms: number;
  /** Best candidate per strategy, best first. */
  top: Candidate[];
  best: Candidate;
  trace: TraceInfo;
}

/** Reaction delay folded into every planned arrival (s). */
const REACTION = 0.8;
/** A cat must be in place this many seconds before Past You passes. */
const MIN_SLACK = 0.6;
/** The hunter needs a moment first: intercepts before this are unfair. */
const FAIR_START = 4;
/** Candidate waypoints considered per role slot. */
const PER_SLOT = 4;

const AFFINITY: Record<Archetype, Record<RoleId, number>> = {
  sprinter: { early_pressure: 1, late_collapse: 0.6, cut_off: 0.45, hold_landing: 0.35, environment_trap: 0.25 },
  ambusher: { hold_landing: 1, cut_off: 0.9, late_collapse: 0.6, environment_trap: 0.35, early_pressure: 0.3 },
  chaos: { environment_trap: 1, late_collapse: 0.55, early_pressure: 0.5, hold_landing: 0.45, cut_off: 0.4 },
  opportunist: { cut_off: 1, late_collapse: 0.75, hold_landing: 0.65, early_pressure: 0.6, environment_trap: 0.5 },
};

interface Slot {
  role: RoleId;
  /** Progress window (fraction of the run) this slot targets. */
  win: [number, number];
  zones?: string[];
}

interface Template {
  id: CounterId;
  slots: Slot[];
  /** How well the human's fingerprint invites this strategy (0..~0.5). */
  prior: (fp: BehaviorFingerprint | null) => number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const TEMPLATES: Template[] = [
  {
    id: "rooftop_trap",
    slots: [
      { role: "hold_landing", win: [0.4, 0.95], zones: ["laundry", "lowroofs", "climb"] },
      { role: "environment_trap", win: [0.3, 0.95] },
      { role: "early_pressure", win: [0.1, 0.4] },
    ],
    prior: (fp) => (fp ? fp.rooftopRatio * 0.55 : 0),
  },
  {
    id: "the_choke",
    slots: [
      { role: "cut_off", win: [0.2, 0.7], zones: ["alley1", "alley2", "court"] },
      { role: "cut_off", win: [0.45, 0.85], zones: ["alley2", "laundry", "lowroofs"] },
      { role: "early_pressure", win: [0.1, 0.4] },
    ],
    prior: (fp) => (fp ? fp.groundRouteBias * 0.4 : 0),
  },
  {
    id: "the_rush",
    slots: [
      { role: "early_pressure", win: [0.08, 0.3] },
      { role: "early_pressure", win: [0.15, 0.45] },
      { role: "late_collapse", win: [0.75, 1] },
    ],
    prior: (fp) => (fp ? clamp01((fp.avgSpeed - 5) / 3) * 0.4 : 0),
  },
  {
    id: "the_bait",
    slots: [
      { role: "environment_trap", win: [0.2, 0.9] },
      { role: "cut_off", win: [0.3, 0.75] },
      { role: "early_pressure", win: [0.1, 0.4] },
    ],
    prior: (fp) => (fp ? clamp01(fp.interactionRate / 3) * 0.45 : 0),
  },
  {
    id: "late_collapse",
    slots: [
      { role: "late_collapse", win: [0.75, 1] },
      { role: "hold_landing", win: [0.5, 0.95] },
      { role: "cut_off", win: [0.45, 0.85] },
    ],
    prior: (fp) => (fp ? clamp01(fp.hesitationTime / 6) * 0.3 + fp.riskScore * 0.15 : 0),
  },
  {
    id: "double_cut",
    slots: [
      { role: "cut_off", win: [0.2, 0.5], zones: ["court", "yard", "alley1"] },
      { role: "cut_off", win: [0.45, 0.8], zones: ["lowroofs", "alley2", "laundry"] },
      { role: "late_collapse", win: [0.75, 1] },
    ],
    prior: (fp) => (fp ? fp.shortcutUsage * 0.45 : 0),
  },
];

export const COUNTER_IDS = TEMPLATES.map((t) => t.id);

/** Where (and when) the recorded run passes each waypoint, plus distance travelled. */
export function analyzeTrace(replay: ReplayData, graph: WaypointGraph): TraceInfo {
  const snaps = replay.snapshots;
  const duration = Math.max(0.001, replay.duration);
  const landings: V3[] = [];
  for (const ev of replay.events) {
    if (ev.type !== "land") continue;
    const s = snaps.find((x) => Math.abs(x.t - ev.t) < 1e-6) ?? snaps.reduce((a, b) => (Math.abs(b.t - ev.t) < Math.abs(a.t - ev.t) ? b : a), snaps[0]);
    if (s) landings.push(s.position);
  }
  const props: Array<[string, V3]> = [
    ["fishScraps", INTERACTABLES.fishScraps],
    ["bottle", INTERACTABLES.bottle],
    ["trashCan", INTERACTABLES.trashCan],
    ["pigeonFeed", INTERACTABLES.pigeonFeed],
    ["laundry", [(INTERACTABLES.laundry.a[0] + INTERACTABLES.laundry.b[0]) / 2, INTERACTABLES.laundry.a[1], (INTERACTABLES.laundry.a[2] + INTERACTABLES.laundry.b[2]) / 2]],
  ];
  const passes: NodePass[] = [];
  for (const node of graph.nodes.values()) {
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < snaps.length; i++) {
      const p = snaps[i].position;
      const d = Math.hypot(p[0] - node.x, (p[1] - node.y) * 1.5, p[2] - node.z);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi < 0 || best > 3.5) continue;
    const s = snaps[bi];
    const landing = landings.some((l) => Math.hypot(l[0] - node.x, l[2] - node.z) < 3 && Math.abs(l[1] - node.y) < 1);
    let prop: string | null = null;
    let pd = 3.5;
    for (const [id, pp] of props) {
      const d = Math.hypot(pp[0] - node.x, pp[2] - node.z) + Math.abs(pp[1] - node.y);
      if (d < pd) {
        pd = d;
        prop = id;
      }
    }
    passes.push({ node, t: s.t, dist: best, grounded: s.grounded, zone: zoneAt(node.x, node.y, node.z)?.id ?? "", landing, prop, progress: s.t / duration, degree: node.edges.length });
  }
  passes.sort((a, b) => a.t - b.t);
  // Props along the run: where a trapper could stand and when Past You comes by.
  const usedAt = new Map<string, number>();
  for (const ev of replay.events) if (ev.type === "interact" && ev.payload?.target && !usedAt.has(ev.payload.target)) usedAt.set(ev.payload.target, ev.t);
  const propPasses: NodePass[] = [];
  for (const [id, pp] of props) {
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < snaps.length; i++) {
      const p = snaps[i].position;
      const d = Math.hypot(p[0] - pp[0], (p[1] - pp[1]) * 1.5, p[2] - pp[2]);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi < 0 || best > 5) continue;
    const s = snaps[bi];
    if ((usedAt.get(id) ?? Infinity) <= s.t) continue; // Past You already sprang it
    // stand beside the prop, a little toward the line Past You takes
    const dx = s.position[0] - pp[0];
    const dz = s.position[2] - pp[2];
    const dl = Math.hypot(dx, dz) || 1;
    const spot: V3 = [pp[0] + (dx / dl) * 0.9, pp[1], pp[2] + (dz / dl) * 0.9];
    const node = graph.nearest(spot[0], spot[1], spot[2]);
    propPasses.push({ node, t: s.t, dist: best, grounded: s.grounded, zone: zoneAt(spot[0], spot[1], spot[2])?.id ?? "", landing: false, prop: id, progress: s.t / duration, degree: node.edges.length, spot });
  }
  const cumulative: Array<{ t: number; d: number }> = [];
  let d = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (i > 0 && !snaps[i].cut) {
      const a = snaps[i - 1].position;
      const b = snaps[i].position;
      d += Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    cumulative.push({ t: snaps[i].t, d });
  }
  return { duration, passes, propPasses, cumulative };
}

function slotNodes(trace: TraceInfo, slot: Slot): NodePass[] {
  if (slot.role === "environment_trap") {
    // traps are planned around the props themselves
    const props = trace.propPasses.filter((p) => p.t >= FAIR_START && p.progress >= slot.win[0] - 0.1 && p.progress <= slot.win[1] + 0.05);
    const pool = props.length > 0 ? props : trace.propPasses.filter((p) => p.t >= FAIR_START);
    return [...pool].sort((a, b) => a.dist - b.dist).slice(0, PER_SLOT);
  }
  const inWin = trace.passes.filter((p) => p.progress >= slot.win[0] && p.progress <= slot.win[1] && (!slot.zones || slot.zones.includes(p.zone)));
  const pool = inWin.length > 0 ? inWin : trace.passes.filter((p) => p.progress >= slot.win[0] && p.progress <= slot.win[1]);
  const rate = (p: NodePass): number => {
    let r = 1 - Math.min(1, p.dist / 3.5);
    if (p.grounded) r += 0.3;
    if (slot.role === "hold_landing" && p.landing) r += 0.8;
    if (slot.role === "cut_off" && p.degree >= 3) r += 0.35;
    if (slot.role === "environment_trap") r += p.prop ? 0.9 : -1;
    if (p.t < FAIR_START) r -= 1;
    return r;
  };
  return [...pool].sort((a, b) => rate(b) - rate(a)).slice(0, PER_SLOT);
}

function distanceAt(trace: TraceInfo, t: number): number {
  const c = trace.cumulative;
  if (c.length === 0) return 0;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return c[lo].d;
}

function permutations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((it, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const p of permutations(rest, k - 1)) out.push([it, ...p]);
  });
  return out;
}

/** Fast-forward every candidate plan against the recorded run and rank them. */
export function simulateCounterfactuals(
  trace: TraceInfo,
  graph: WaypointGraph,
  agents: AgentSpec[],
  fp: BehaviorFingerprint | null,
  only?: CounterId,
): SimResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  // travel-time cache: (cat, node) -> { time, length }
  const travelCache = new Map<string, { time: number; len: number }>();
  const travel = (a: AgentSpec, node: NavNode, spot?: V3) => {
    const key = `${a.cat}:${node.id}:${spot ? spot.join(",") : ""}`;
    let v = travelCache.get(key);
    if (!v) {
      const from = graph.nearest(a.start[0], a.start[1], a.start[2]);
      const lead = Math.hypot(from.x - a.start[0], from.z - a.start[2]);
      const tail = spot ? Math.hypot(spot[0] - node.x, spot[2] - node.z) : 0;
      const len = lead + graph.pathLength(graph.path(from, node)) + tail;
      v = { time: len / Math.max(1, a.speed) + REACTION, len };
      travelCache.set(key, v);
    }
    return v;
  };

  let evaluated = 0;
  const bestPer = new Map<CounterId, Candidate>();
  for (const tpl of TEMPLATES) {
    if (only && tpl.id !== only) continue;
    const slots = tpl.slots.slice(0, Math.min(tpl.slots.length, agents.length));
    const choices = slots.map((s) => slotNodes(trace, s));
    const prior = tpl.prior(fp);
    for (const perm of permutations(agents, slots.length)) {
      // every combination of one candidate waypoint per slot
      const idx = new Array<number>(slots.length).fill(0);
      for (;;) {
        const picks = slots.map((_, i) => choices[i][idx[i]]).filter((p): p is NodePass => p !== undefined);
        if (picks.length === slots.length) {
          const cand = evaluate(tpl, slots, perm, picks, trace, travel, prior);
          evaluated++;
          const cur = bestPer.get(tpl.id);
          if (!cur || cand.score > cur.score) bestPer.set(tpl.id, cand);
        }
        // advance the odometer
        let k = 0;
        while (k < idx.length) {
          idx[k]++;
          if (idx[k] < Math.max(1, choices[k].length)) break;
          idx[k] = 0;
          k++;
        }
        if (k === idx.length) break;
      }
    }
  }
  const top = [...bestPer.values()].sort((a, b) => b.score - a.score);
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  const best = top[0] ?? emptyCandidate();
  return { evaluated, ms, top, best, trace };
}

function evaluate(
  tpl: Template,
  slots: Slot[],
  agents: AgentSpec[],
  picks: NodePass[],
  trace: TraceInfo,
  travel: (a: AgentSpec, n: NavNode, spot?: V3) => { time: number; len: number },
  prior: number,
): Candidate {
  const assignments: PlannedAssignment[] = [];
  let iq = 0;
  let synergy = 0;
  let adv = 0;
  let impossible = 0;
  let unfair = 0;
  let duplicate = 0;
  const windows: Array<[number, number]> = [];
  slots.forEach((slot, i) => {
    const a = agents[i];
    const p = picks[i];
    const tr = travel(a, p.node, p.spot);
    const slack = p.t - tr.time;
    const viable = slack >= MIN_SLACK;
    let q = 0;
    if (viable) {
      q = (1 - Math.min(1, p.dist / (p.spot ? 5 : 3.5))) * 0.55 + (p.grounded ? 0.25 : 0.1);
      if (slot.role === "hold_landing" && p.landing) q += 0.2;
      if (slot.role === "cut_off" && p.degree >= 3) q += 0.1;
      if (slot.role === "environment_trap" && p.prop) q += 0.15;
      q = Math.min(1, q);
      windows.push([Math.max(FAIR_START, p.t - 2.5), p.t + 2.5]);
      // route advantage: the cat gets there along a shorter line than Past You
      const pyLen = distanceAt(trace, p.t);
      adv += clamp01(((pyLen - tr.len) / Math.max(pyLen, 1) + 1) / 2);
      if (p.t < FAIR_START) unfair += 0.5;
    } else {
      impossible += 0.7;
    }
    iq += q;
    synergy += AFFINITY[a.archetype][slot.role];
    assignments.push({
      cat: a.cat,
      role: slot.role,
      nodeId: p.spot ? `${p.prop}` : p.node.id,
      point: p.spot ?? [p.node.x, p.node.y, p.node.z],
      tPass: p.t,
      travel: tr.time,
      slack,
      quality: q,
      zone: p.zone,
      prop: slot.role === "environment_trap" ? p.prop : null,
    });
  });
  // stacking: two cats waiting on top of each other
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i];
      const b = assignments[j];
      if (a.nodeId === b.nodeId) duplicate += 2;
      else if (Math.hypot(a.point[0] - b.point[0], a.point[2] - b.point[2]) < 6 && Math.abs(a.tPass - b.tPass) < 3) unfair += 0.6;
    }
  }
  const n = Math.max(1, slots.length);
  const viableCount = windows.length;
  const coverage = unionLength(windows) / Math.max(1, trace.duration - FAIR_START);
  const zones = new Set(assignments.map((a) => a.zone)).size;
  const breakdown: CandidateBreakdown = {
    interceptQuality: iq / n,
    coverage: clamp01(coverage),
    routeAdvantage: viableCount > 0 ? adv / viableCount : 0,
    roleSynergy: synergy / n,
    fishDrop: (Math.min(viableCount, 2) / 2) * 0.3,
    diversity: (zones / n) * 0.2,
    prior,
    unfairnessPenalty: unfair,
    travelImpossibility: impossible,
    duplicateRolePenalty: duplicate,
  };
  const score =
    1.3 * breakdown.interceptQuality +
    0.9 * breakdown.coverage +
    0.35 * breakdown.routeAdvantage +
    0.5 * breakdown.roleSynergy +
    breakdown.fishDrop +
    breakdown.diversity +
    breakdown.prior -
    breakdown.unfairnessPenalty -
    breakdown.travelImpossibility -
    breakdown.duplicateRolePenalty;
  const viableTimes = assignments.filter((a) => a.slack >= MIN_SLACK).map((a) => a.tPass);
  return {
    id: tpl.id,
    name: COUNTER_NAMES[tpl.id],
    assignments,
    score,
    breakdown,
    windows: viableCount,
    earliest: viableTimes.length ? Math.min(...viableTimes) : Infinity,
    coverage: breakdown.coverage,
  };
}

function unionLength(spans: Array<[number, number]>): number {
  if (spans.length === 0) return 0;
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i][0] <= ce) ce = Math.max(ce, s[i][1]);
    else {
      total += ce - cs;
      [cs, ce] = s[i];
    }
  }
  return total + (ce - cs);
}

function emptyCandidate(): Candidate {
  return {
    id: "the_choke",
    name: COUNTER_NAMES.the_choke,
    assignments: [],
    score: -Infinity,
    breakdown: { interceptQuality: 0, coverage: 0, routeAdvantage: 0, roleSynergy: 0, fishDrop: 0, diversity: 0, prior: 0, unfairnessPenalty: 0, travelImpossibility: 0, duplicateRolePenalty: 0 },
    windows: 0,
    earliest: Infinity,
    coverage: 0,
  };
}
