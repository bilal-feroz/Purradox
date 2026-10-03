// Optional LLM Explanation Layer.
//
// The Counterfactual Simulator + Tactical Planner always produce a complete
// Alley Council plan on their own, deterministically and offline. When a
// server is configured, it may ONLY rename the strategy, write the one-line
// explanation, word the roles and add council flavor. It never moves cats,
// never decides frame-level actions and never picks the plan. Every field is
// schema-validated here, and any timeout, error or odd answer keeps the
// deterministic plan. API keys live on the server, never in this bundle.

import type { CatId } from "../data/cats";
import type { BehaviorFingerprint, BehaviorTag } from "./BehaviorProfiler";
import type { CouncilPlan } from "./TacticalPlanner";
import type { TelemetrySummary } from "./TelemetrySummary";

/** The only telemetry that ever leaves the browser: a small numeric summary. */
export interface CompactTelemetry {
  runSeconds: number;
  avgSpeed: number;
  sprintRatio: number;
  elevatedRatio: number;
  awningShortcut: boolean;
  rooftopShortcut: boolean;
  pounces: number;
  hisses: number;
  interactions: string[];
  fishDrops: number;
  zoneSeconds: Record<string, number>;
}

export function compact(s: TelemetrySummary): CompactTelemetry {
  const zs: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.zoneTime)) zs[k] = Math.round(v * 10) / 10;
  return {
    runSeconds: Math.round(s.runDuration * 10) / 10,
    avgSpeed: Math.round(s.averageSpeed * 100) / 100,
    sprintRatio: Math.round(s.sprintRatio * 100) / 100,
    elevatedRatio: Math.round(s.elevatedRatio * 100) / 100,
    awningShortcut: s.routeChoice.awningShortcut,
    rooftopShortcut: s.routeChoice.rooftopShortcut,
    pounces: s.pounces.length,
    hisses: s.hisses.length,
    interactions: s.interactions.map((i) => i.target),
    fishDrops: s.fishDrops,
    zoneSeconds: zs,
  };
}

/** What the explanation layer receives: numbers and the already-chosen plan. */
export interface ExplainRequest {
  fingerprint: Record<string, number>;
  tags: string[];
  candidates: Array<{ id: string; name: string; score: number; windows: number; earliest: number; coverage: number }>;
  chosen: { id: string; name: string; reason: string; roles: Array<{ cat: string; role: string; zone: string }> };
  telemetry: CompactTelemetry;
}

export function buildRequest(plan: CouncilPlan, fp: BehaviorFingerprint | null, tags: BehaviorTag[], summary: TelemetrySummary): ExplainRequest {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const f: Record<string, number> = {};
  if (fp) {
    for (const [k, v] of Object.entries(fp)) if (typeof v === "number" && Number.isFinite(v)) f[k] = r2(v);
  }
  return {
    fingerprint: f,
    tags: tags.slice(0, 3).map((t) => t.title),
    candidates: plan.candidates.map((c) => ({ ...c, score: r2(c.score), earliest: Number.isFinite(c.earliest) ? r2(c.earliest) : -1 })),
    chosen: {
      id: plan.strategyId,
      name: plan.strategyName,
      reason: plan.reason,
      roles: plan.allyAssignments.map((a) => ({ cat: a.cat, role: a.roleName, zone: a.zoneName })),
    },
    telemetry: compact(summary),
  };
}

export interface Explanation {
  name?: string;
  line?: string;
  roles?: Partial<Record<CatId, string>>;
  taunt?: string;
}

const CAT_IDS: readonly CatId[] = ["fishcat", "mochi", "soot", "beans"];
const SAFE_LINE = /^[^<>{}]*$/;

/** Validate untrusted explanation output; null if nothing usable. */
export function parseExplanation(raw: unknown): Explanation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Explanation = {};
  if (typeof o.name === "string") {
    const n = o.name.trim().toUpperCase();
    if (n.length >= 3 && n.length <= 32 && /^[A-Z0-9 '!.-]+$/.test(n)) out.name = n;
  }
  if (typeof o.line === "string") {
    const l = o.line.trim();
    if (l.length > 0 && l.length <= 120 && SAFE_LINE.test(l)) out.line = l;
  }
  if (typeof o.taunt === "string") {
    const tt = o.taunt.trim();
    if (tt.length > 0 && tt.length <= 90 && SAFE_LINE.test(tt)) out.taunt = tt;
  }
  if (o.roles && typeof o.roles === "object") {
    const roles: Partial<Record<CatId, string>> = {};
    for (const [k, v] of Object.entries(o.roles as Record<string, unknown>)) {
      if (!(CAT_IDS as readonly string[]).includes(k) || typeof v !== "string") continue;
      const w = v.trim().toUpperCase();
      if (w.length >= 3 && w.length <= 24 && /^[A-Z ' -]+$/.test(w)) roles[k as CatId] = w;
    }
    if (Object.keys(roles).length > 0) out.roles = roles;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function applyExplanation(plan: CouncilPlan, ex: Explanation): CouncilPlan {
  return {
    ...plan,
    strategyName: ex.name ?? plan.strategyName,
    reason: ex.line ?? plan.reason,
    allyAssignments: plan.allyAssignments.map((a) => ({ ...a, roleName: ex.roles?.[a.cat] ?? a.roleName })),
    taunt: ex.taunt,
    source: "llm",
  };
}

/** Pluggable provider. The game never depends on it. */
export interface StrategyProvider {
  readonly name: string;
  explain(req: ExplainRequest, signal: AbortSignal): Promise<unknown>;
}

/** HTTP provider: POSTs the explain request to the optional council server. */
export class HttpStrategyProvider implements StrategyProvider {
  readonly name = "http";
  constructor(private readonly url: string) {}
  async explain(req: ExplainRequest, signal: AbortSignal): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: req }),
      signal,
    });
    if (!res.ok) throw new Error(`director http ${res.status}`);
    return res.json();
  }
}

export class TacticalDirector {
  constructor(
    private readonly provider: StrategyProvider | null,
    private readonly timeoutMs = 1400,
  ) {}

  get enabled(): boolean {
    return this.provider !== null;
  }

  /** Always resolves (never rejects) within ~timeoutMs with a complete plan. */
  async explain(plan: CouncilPlan, req: ExplainRequest): Promise<CouncilPlan> {
    if (!this.provider) return plan;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const ex = parseExplanation(await this.provider.explain(req, ctrl.signal));
      return ex ? applyExplanation(plan, ex) : plan;
    } catch {
      return plan;
    } finally {
      clearTimeout(timer);
    }
  }
}
