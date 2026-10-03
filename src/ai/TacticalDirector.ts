import { STRATEGY_IDS, heuristicPlan, planFor, type StrategyId, type TacticalPlan } from "./TacticalFallback";
import type { TelemetrySummary } from "./TelemetrySummary";

/**
 * Pluggable strategy provider. The game never depends on it: any timeout,
 * network error or malformed answer falls back to the heuristic director.
 */
export interface StrategyProvider {
  readonly name: string;
  propose(summary: CompactTelemetry, signal: AbortSignal): Promise<unknown>;
}

/** The only data that ever leaves the browser: a small numeric summary. */
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

/** Validate untrusted provider output against the strategy schema. */
export function parsePlan(raw: unknown): TacticalPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = o.strategy;
  if (typeof id !== "string" || !STRATEGY_IDS.includes(id as StrategyId)) return null;
  let line = typeof o.line === "string" ? o.line.trim() : undefined;
  if (line && (line.length > 120 || /[<>{}]/.test(line))) line = undefined;
  const reasons = Array.isArray(o.reasons) ? o.reasons.filter((r): r is string => typeof r === "string" && r.length < 100).slice(0, 3) : [];
  return planFor(id as StrategyId, reasons, "llm", line);
}

/** HTTP provider: POSTs the compact summary to a same-origin server route. */
export class HttpStrategyProvider implements StrategyProvider {
  readonly name = "http";
  constructor(private readonly url: string) {}
  async propose(summary: CompactTelemetry, signal: AbortSignal): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ telemetry: summary }),
      signal,
    });
    if (!res.ok) throw new Error(`director http ${res.status}`);
    return res.json();
  }
}

export class TacticalDirector {
  lastPlan: TacticalPlan | null = null;

  constructor(
    private readonly provider: StrategyProvider | null,
    private readonly timeoutMs = 1400,
  ) {}

  /** Always resolves (never rejects) within ~timeoutMs. */
  async analyze(summary: TelemetrySummary): Promise<TacticalPlan> {
    const fallback = heuristicPlan(summary);
    if (!this.provider) {
      this.lastPlan = fallback;
      return fallback;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const raw = await this.provider.propose(compact(summary), ctrl.signal);
      const plan = parsePlan(raw);
      this.lastPlan = plan ?? fallback;
    } catch {
      this.lastPlan = fallback;
    } finally {
      clearTimeout(timer);
    }
    return this.lastPlan;
  }
}
