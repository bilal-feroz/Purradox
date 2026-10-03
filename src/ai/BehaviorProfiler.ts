// Behavior Profiler: Round 1 telemetry → a compact, explainable fingerprint
// of how this human played, plus human-readable tags derived from real
// thresholds (never invented). Pure functions, unit tested.

import type { TelemetrySummary } from "./TelemetrySummary";

export interface BehaviorFingerprint {
  /** Distance covered per second (m/s). */
  avgSpeed: number;
  /** Fraction of the run spent sprinting. */
  sprintRatio: number;
  /** Fraction of the run spent above street level. */
  rooftopRatio: number;
  /** Shortcuts taken / shortcuts available (awnings A, low roofs B). */
  shortcutUsage: number;
  /** Prop interactions per minute. */
  interactionRate: number;
  pounceRate: number;
  hissRate: number;
  /** Perfect Hisses / hisses. */
  perfectHissRate: number;
  fishGripLosses: number;
  /** Share of the two route splits taken on the street route. */
  groundRouteBias: number;
  /** 1 if the awning shortcut was taken at the first split. */
  awningRouteBias: number;
  /** 0..1: how close to danger the run lived (close calls, hits, drops). */
  riskScore: number;
  /** 0..1: how evenly time was spread across the zones visited. */
  routeEntropy: number;
  /** Seconds spent standing still. */
  hesitationTime: number;
  /** Raw counts kept for explanations. */
  counts: { hisses: number; perfectHisses: number; pounces: number; interactions: number; shortcuts: number; zones: number; dangers: number; durationS: number; backtracks: number };
}

export interface BehaviorTag {
  id: "fast_rooftop_runner" | "rooftop_runner" | "ground_loyalist" | "shortcut_habit" | "defensive_hisser" | "environment_trickster" | "chaotic_router" | "cautious_carrier" | "full_throttle" | "risk_taker" | "pounce_happy" | "steady_runner";
  /** Big stamp line, e.g. "ROOFTOP RUNNER". */
  title: string;
  /** The evidence, e.g. "63% OF YOUR RUN WAS ABOVE STREET LEVEL." */
  detail: string;
  /** How strongly the data supports the tag (higher = more distinctive). */
  score: number;
}

export const SHORTCUTS_AVAILABLE = 2;

export function fingerprint(s: TelemetrySummary): BehaviorFingerprint {
  const dur = Math.max(1, s.runDuration);
  const minutes = dur / 60;
  const shortcuts = (s.routeChoice.awningShortcut ? 1 : 0) + (s.routeChoice.rooftopShortcut ? 1 : 0);
  const zoneVisited = (z: string) => (s.zoneTime[z] ?? 0) > 0.4;
  const splitA = zoneVisited("alley1") && !s.routeChoice.awningShortcut ? 1 : 0;
  const splitB = zoneVisited("alley2") && !s.routeChoice.rooftopShortcut ? 1 : 0;
  // Shannon entropy of time across visited zones, normalized to 0..1
  const times = Object.values(s.zoneTime).filter((v) => v > 0.2);
  const total = times.reduce((a, b) => a + b, 0) || 1;
  const h = times.reduce((acc, v) => acc - (v / total) * Math.log(v / total), 0);
  const routeEntropy = times.length > 1 ? h / Math.log(times.length) : 0;
  const danger = s.dangerEncounters + s.gripLosses.length * 2 + s.fishDrops * 3;
  return {
    avgSpeed: s.averageSpeed,
    sprintRatio: s.sprintRatio,
    rooftopRatio: s.elevatedRatio,
    shortcutUsage: shortcuts / SHORTCUTS_AVAILABLE,
    interactionRate: s.interactions.length / minutes,
    pounceRate: s.pounces.length / minutes,
    hissRate: s.hisses.length / minutes,
    perfectHissRate: s.hisses.length > 0 ? Math.min(1, s.perfectHisses / s.hisses.length) : 0,
    fishGripLosses: s.gripLosses.length,
    groundRouteBias: (splitA + splitB) / 2,
    awningRouteBias: s.routeChoice.awningShortcut ? 1 : 0,
    riskScore: Math.min(1, danger / Math.max(1, minutes * 8)),
    routeEntropy,
    hesitationTime: s.stillTime,
    counts: {
      hisses: s.hisses.length,
      perfectHisses: s.perfectHisses,
      pounces: s.pounces.length,
      interactions: s.interactions.length,
      shortcuts,
      zones: times.length,
      dangers: s.dangerEncounters,
      durationS: dur,
      // zone changes beyond the ones needed to visit each zone once
      backtracks: Math.max(0, s.zoneChanges - Math.max(0, Object.keys(s.zoneEntryTimes).length - 1)),
    },
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Every tag the data supports, most distinctive first. */
export function deriveTags(fp: BehaviorFingerprint): BehaviorTag[] {
  const tags: BehaviorTag[] = [];
  const c = fp.counts;
  if (fp.rooftopRatio >= 0.45 && fp.avgSpeed >= 6) {
    tags.push({ id: "fast_rooftop_runner", title: "FAST ROOFTOP RUNNER", detail: `${pct(fp.rooftopRatio)} OF YOUR RUN WAS ABOVE STREET LEVEL — AT FULL TILT.`, score: 0.9 + fp.rooftopRatio });
  } else if (fp.rooftopRatio >= 0.4) {
    tags.push({ id: "rooftop_runner", title: "ROOFTOP RUNNER", detail: `${pct(fp.rooftopRatio)} OF YOUR RUN WAS ABOVE STREET LEVEL.`, score: 0.6 + fp.rooftopRatio });
  }
  if (c.shortcuts >= 1) {
    tags.push({
      id: "shortcut_habit",
      title: c.shortcuts >= SHORTCUTS_AVAILABLE ? "SHORTCUT ADDICT" : "SHORTCUT HABIT",
      detail: `YOU USED ${c.shortcuts} OF ${SHORTCUTS_AVAILABLE} AVAILABLE CUTS.`,
      score: 0.55 + fp.shortcutUsage * 0.6,
    });
  }
  // the splits are the real choices (every route ends on the roofs)
  if (fp.groundRouteBias >= 1) {
    tags.push({ id: "ground_loyalist", title: "GROUND ROUTE LOYALIST", detail: "YOU TOOK THE STREET AT EVERY SPLIT.", score: 0.85 });
  }
  if (c.hisses >= 3 || (c.hisses >= 2 && fp.hissRate >= 4)) {
    const perfect = c.perfectHisses > 0 ? ` ${c.perfectHisses} WERE PERFECT.` : "";
    tags.push({ id: "defensive_hisser", title: "DEFENSIVE HISSER", detail: `YOU HISSED ${c.hisses} TIMES.${perfect}`, score: 0.5 + Math.min(0.6, c.hisses * 0.12) + fp.perfectHissRate * 0.3 });
  }
  if (c.interactions >= 2) {
    tags.push({ id: "environment_trickster", title: "ENVIRONMENT TRICKSTER", detail: `YOU USED ${c.interactions} DISTRACTIONS.`, score: 0.6 + c.interactions * 0.15 });
  }
  if (c.backtracks >= 3) {
    tags.push({ id: "chaotic_router", title: "CHAOTIC ROUTER", detail: `YOU DOUBLED BACK ${c.backtracks} TIMES.`, score: 0.5 + Math.min(0.5, c.backtracks * 0.08) });
  }
  if (fp.hesitationTime >= 3 || fp.avgSpeed < 4.4) {
    tags.push({ id: "cautious_carrier", title: "CAUTIOUS CARRIER", detail: `YOU STOOD STILL FOR ${fp.hesitationTime.toFixed(1)} SECONDS.`, score: 0.5 + Math.min(0.5, fp.hesitationTime / 10) });
  }
  // stamina caps sprinting near 60% of a run, so half the way is flat out
  if (fp.sprintRatio >= 0.5) {
    tags.push({ id: "full_throttle", title: "FULL THROTTLE", detail: `YOU SPRINTED ${pct(fp.sprintRatio)} OF THE WAY.`, score: 0.45 + (fp.sprintRatio - 0.5) * 2 });
  }
  if (fp.riskScore >= 0.6) {
    tags.push({ id: "risk_taker", title: "RISK TAKER", detail: `YOU BRUSHED PAST ${c.dangers} RIVALS AND LOST ${fp.fishGripLosses} GRIP.`, score: 0.5 + fp.riskScore * 0.4 });
  }
  if (c.pounces >= 3) {
    tags.push({ id: "pounce_happy", title: "POUNCE HAPPY", detail: `YOU POUNCED ${c.pounces} TIMES.`, score: 0.45 + Math.min(0.4, c.pounces * 0.08) });
  }
  if (tags.length === 0) {
    tags.push({ id: "steady_runner", title: "STEADY RUNNER", detail: `${c.durationS.toFixed(1)} SECONDS, NO WASTED MOVES.`, score: 0.3 });
  }
  return tags.sort((a, b) => b.score - a.score);
}
