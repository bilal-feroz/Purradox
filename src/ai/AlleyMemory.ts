// Alley Memory: the last few runs, remembered in this browser only (no
// backend, no account). When the same habit shows up three runs in a row,
// the Counterfactual Simulator gives the strategy that answers it a small,
// visible bonus. It never changes the rules, the cats or the difficulty
// curve; it only tips which simulated plan the council prefers.

import type { CatId } from "../data/cats";
import type { BehaviorFingerprint, BehaviorTag } from "./BehaviorProfiler";
import type { CounterId } from "./CounterfactualSimulator";
import type { TelemetrySummary } from "./TelemetrySummary";

const KEY = "purradox.alleyMemory.v1";
/** Runs kept. */
export const MEMORY_KEEP = 5;
/** A habit counts once it shows up this many runs in a row (this run included). */
export const MEMORY_STREAK = 3;
/** Score bonus for the strategy that answers a remembered habit. */
export const MEMORY_BONUS = 0.12;

export type RouteKind = "street" | "awning" | "lowroofs" | "both";

export interface MemoryEntry {
  thief: CatId;
  route: RouteKind;
  interactions: number;
  hisses: number;
  avgSpeed: number;
  sprintRatio: number;
  lead: BehaviorTag["id"] | null;
  strategy: CounterId | null;
}

export interface AlleyHabit {
  id: "props" | "hisses" | "route" | "speed";
  /** Consecutive runs, this one included. */
  streak: number;
  /** "3 RUNS IN A ROW YOU TOOK THE STREET AT BOTH SPLITS." */
  line: string;
  /** The strategy that answers it. */
  counter: CounterId;
}

const ROUTE_LINES: Record<RouteKind, string> = {
  street: "YOU TOOK THE STREET AT BOTH SPLITS",
  awning: "YOU TOOK THE AWNING SHORTCUT",
  lowroofs: "YOU CUT ACROSS THE LOW ROOFS",
  both: "YOU TOOK BOTH SHORTCUTS",
};

const ROUTE_COUNTERS: Record<RouteKind, CounterId> = {
  street: "the_choke",
  awning: "double_cut",
  lowroofs: "rooftop_trap",
  both: "double_cut",
};

export function routeKind(awning: boolean, lowroofs: boolean): RouteKind {
  return awning && lowroofs ? "both" : awning ? "awning" : lowroofs ? "lowroofs" : "street";
}

/** This run, as the memory will keep it. */
export function memoryEntry(thief: CatId, s: TelemetrySummary, fp: BehaviorFingerprint, tags: BehaviorTag[]): MemoryEntry {
  return {
    thief,
    route: routeKind(s.routeChoice.awningShortcut, s.routeChoice.rooftopShortcut),
    interactions: s.interactions.length,
    hisses: s.hisses.length,
    avgSpeed: Math.round(fp.avgSpeed * 100) / 100,
    sprintRatio: Math.round(fp.sprintRatio * 100) / 100,
    lead: tags[0]?.id ?? null,
    strategy: null,
  };
}

/** Keep the newest `MEMORY_KEEP` runs (oldest first). */
export function remember(history: MemoryEntry[], entry: MemoryEntry): MemoryEntry[] {
  return [...history, entry].slice(-MEMORY_KEEP);
}

/** The strongest habit repeated across the latest runs, this one included. */
export function recallHabit(history: MemoryEntry[], current: MemoryEntry): AlleyHabit | null {
  const runs = [...history, current];
  const streak = (pred: (e: MemoryEntry) => boolean) => {
    let n = 0;
    for (let i = runs.length - 1; i >= 0 && pred(runs[i]); i--) n++;
    return n;
  };
  // most distinctive first: on a tie the earlier entry wins
  const found: AlleyHabit[] = [
    { id: "props", streak: streak((e) => e.interactions >= 2), line: "", counter: "the_bait" },
    { id: "hisses", streak: streak((e) => e.hisses >= 3), line: "", counter: "the_bait" },
    { id: "route", streak: streak((e) => e.route === current.route), line: "", counter: ROUTE_COUNTERS[current.route] },
    { id: "speed", streak: streak((e) => e.avgSpeed >= 6.5 && e.sprintRatio >= 0.85), line: "", counter: "the_rush" },
  ];
  let best: AlleyHabit | null = null;
  for (const h of found) if (h.streak >= MEMORY_STREAK && (!best || h.streak > best.streak)) best = h;
  if (!best) return null;
  const n = best.streak;
  best.line =
    best.id === "props"
      ? `YOU'VE USED PROPS IN EACH OF YOUR LAST ${n} RUNS.`
      : best.id === "hisses"
        ? `YOU'VE HISSED YOUR WAY THROUGH ${n} RUNS.`
        : best.id === "route"
          ? `${n} RUNS IN A ROW ${ROUTE_LINES[current.route]}.`
          : `${n} RUNS IN A ROW AT FULL THROTTLE.`;
  return best;
}

const CATS_OK = new Set(["fishcat", "mochi", "soot", "beans"]);
const ROUTES_OK = new Set(["street", "awning", "lowroofs", "both"]);

function valid(e: unknown): e is MemoryEntry {
  if (!e || typeof e !== "object") return false;
  const m = e as Record<string, unknown>;
  return (
    CATS_OK.has(m.thief as string) &&
    ROUTES_OK.has(m.route as string) &&
    [m.interactions, m.hisses, m.avgSpeed, m.sprintRatio].every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** Remembered runs (empty when storage is unavailable or the data looks wrong). */
export function loadMemory(): MemoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(valid).slice(-MEMORY_KEEP) : [];
  } catch {
    return [];
  }
}

export function saveMemory(entries: MemoryEntry[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries.slice(-MEMORY_KEEP)));
  } catch {
    // storage unavailable: the alley simply forgets
  }
}

export function forgetMemory(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // nothing to forget
  }
}
