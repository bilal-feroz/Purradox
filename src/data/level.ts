// Sardine Street — authored layout data (source of truth for code).
// Follows the technical blueprint: 1 Fish Market → 2 Market Exit →
// 3 First Alley (route split) → 4 Fountain + Pigeon Courtyard →
// 5 Second Alley (climb) → 6 Laundry Rooftops → 7 Final Climb → 8 Safe Rooftop.
// Shortcut A (awnings) links 2→4, Shortcut B (low roofs) links 4→6.
// Scale: 1 cat body length = 1 world unit. +X east, -Z north.

import type { CatId } from "./cats";

export type V3 = [number, number, number];

export const H = {
  market: 0,
  exit: 1.0,
  court: 2.2,
  alley2: 3.6,
  roof: 5.0,
  roofWest: 5.0,
  climb: 5.9,
  safe: 6.6,
  sea: -3.2,
} as const;

export interface ZoneDef {
  id: string;
  index: number;
  name: string;
  min: V3;
  max: V3;
  floor: number;
  shortcut?: "A" | "B";
  elevated?: boolean;
}

/** Ordered by priority: first match wins (smaller shortcut boxes first). */
export const ZONES: ZoneDef[] = [
  { id: "safe", index: 8, name: "Safe Rooftop", min: [48, 6.35, -86], max: [66, 20, -70.4], floor: H.safe, elevated: true },
  { id: "climb", index: 7, name: "Final Rooftop Climb", min: [44.5, 4.6, -69], max: [60, 20, -50], floor: H.roof, elevated: true },
  { id: "lowroofs", index: 6, name: "Low Roofs", min: [33.6, 2.9, -47], max: [47.5, 9, -27.5], floor: 3.4, shortcut: "B", elevated: true },
  { id: "laundry", index: 6, name: "Laundry Rooftops", min: [5.5, 4.4, -64], max: [47.5, 20, -35.5], floor: H.roof, elevated: true },
  { id: "alley2", index: 5, name: "Second Alley", min: [-6, 1.6, -64], max: [6, 20, -36], floor: H.court },
  { id: "yard", index: 3, name: "Awning Shortcut", min: [-3, 0.6, -7.5], max: [12, 20, 8], floor: H.exit, shortcut: "A" },
  { id: "court", index: 4, name: "Pigeon Courtyard", min: [-5, 1.6, -36], max: [36, 20, -6], floor: H.court },
  { id: "alley1", index: 3, name: "First Alley", min: [12, 0.5, -6], max: [30, 20, 24], floor: H.exit },
  { id: "exit", index: 2, name: "Market Exit", min: [-4, -1, 8], max: [12, 20, 24], floor: H.exit },
  { id: "market", index: 1, name: "Fish Market", min: [-42, -1, 2], max: [-4, 20, 30], floor: H.market },
];

export const ZONE_NAMES: Record<number, string> = {
  1: "Fish Market",
  2: "Market Exit",
  3: "First Alley",
  4: "Pigeon Courtyard",
  5: "Second Alley",
  6: "Laundry Rooftops",
  7: "Final Rooftop Climb",
  8: "Safe Rooftop",
};

export const SPAWN = {
  /** Round 1 start for whichever cat is the thief. */
  runner: { pos: [-31, 0, 16] as V3, yaw: Math.PI / 2 },
  heroFish: [-21.95, 0.92, 15.6] as V3,
  heroTable: [-21.3, 0, 15.6] as V3,
  goal: [57, H.safe, -76.5] as V3,
  goalRadius: 2.6,
  /** Round 1 posts for AI-controlled cats, flavored by archetype. */
  ai: {
    fishcat: { pos: [15, 2.2, -12.4] as V3, yaw: 0.3 },
    // in front of the corner house, watching the fish stall
    mochi: { pos: [-8.5, 0, 13.4] as V3, yaw: -1.4 },
    soot: { pos: [3, 2.2, -33] as V3, yaw: Math.PI * 0.9 },
    beans: { pos: [27, 5.0, -57] as V3, yaw: Math.PI * 0.6 },
  } as Record<CatId, { pos: V3; yaw: number }>,
  /** Round 2 hunter start regions (blueprint section E). */
  hunters: {
    fishcat: { pos: [15, 2.2, -12.4] as V3, yaw: 0.3 },
    mochi: { pos: [7, 1.0, 13] as V3, yaw: -Math.PI / 2 },
    soot: { pos: [13, 2.2, -31] as V3, yaw: Math.PI },
    beans: { pos: [40, 5.0, -50] as V3, yaw: -Math.PI / 2 },
  } as Record<CatId, { pos: V3; yaw: number }>,
};

/**
 * Mochi, Soot and Beans each own a spot on the street (Fish Cat's rivals in
 * the original run). When one of them is the thief, Fish Cat stands in at
 * the spot it left empty and plays that spot's role (`slot`), so every thief
 * meets the same three threats in Round 1. (Round 2 hunters always start
 * from their own spots, as their cards describe.)
 */
export function rivalPost(id: CatId, thief: CatId): { pos: V3; yaw: number; slot: CatId } {
  const slot = id === "fishcat" && thief !== "fishcat" ? thief : id;
  return { ...SPAWN.ai[slot], slot };
}

export const INTERACTABLES = {
  fishScraps: [-11, 0, 22.3] as V3,
  bottle: [3.2, 1.0, 19.6] as V3,
  trashCan: [27.6, 2.2, -9.2] as V3,
  pigeonFeed: [19.8, 2.2, -15.2] as V3,
  laundry: { a: [22.5, 5.0, -52] as V3, b: [30.5, 5.0, -52] as V3 },
};

export const FOUNTAIN = { center: [15, 2.2, -21] as V3, radius: 3.3 };

/**
 * Round 1: where a rival that steals the fish tries to vanish. Each sits on
 * a nav node at the edge of a zone; the thief must catch it before it gets
 * there or Round 1 is lost.
 */
export const ESCAPE_POINTS: Array<{ id: string; label: string; pos: V3 }> = [
  { id: "market_gate", label: "the market gate", pos: [-24, 0, 20.5] },
  { id: "side_passage", label: "the side passage", pos: [5, 1.0, 9.5] },
  { id: "court_gap", label: "the courtyard gap", pos: [30, 2.2, -15] },
  { id: "alley_end", label: "the alley drainpipe", pos: [-1, 3.6, -60] },
  { id: "roof_hatch", label: "the roof hatch", pos: [26, 5.0, -40] },
  { id: "far_roof", label: "the far roof edge", pos: [41.5, 5.0, -58] },
];

/** Round 1 ambush spots for the ambusher archetype (in route order). */
export const AMBUSH_SPOTS: V3[] = [
  [2.5, 2.2, -33.5],
  [1.5, 3.6, -50],
  [21, 5.0, -47],
];

// ---------------------------------------------------------------------------
// Navigation graph for rival AI. Edges: walk (both ways), jump (both ways,
// scripted arc), drop (one way, scripted arc downward).
// ---------------------------------------------------------------------------

export interface NavNodeDef {
  id: string;
  p: V3;
}

export type NavEdgeKind = "walk" | "jump" | "drop";

export interface NavEdgeDef {
  a: string;
  b: string;
  kind: NavEdgeKind;
}

export const NAV_NODES: NavNodeDef[] = [
  // Fish market
  { id: "m1", p: [-31, 0, 16] },
  { id: "m2", p: [-24, 0, 11] },
  { id: "m3", p: [-24, 0, 20.5] },
  { id: "m4", p: [-15, 0, 11] },
  { id: "m5", p: [-15, 0, 20.5] },
  { id: "m6", p: [-7, 0, 16] },
  // Market exit
  { id: "e1", p: [1.5, 1.0, 16] },
  { id: "e2", p: [7, 1.0, 16] },
  { id: "e3", p: [5, 1.0, 9.5] },
  // First alley (ground route)
  { id: "a1", p: [14, 1.0, 17] },
  { id: "a2", p: [23, 1.0, 17] },
  { id: "a3", p: [23, 1.3, 7] },
  { id: "a4", p: [23, 1.6, 0.5] },
  { id: "a5", p: [23, 2.2, -5] },
  // Awning yard (shortcut A)
  { id: "y1", p: [2.5, 1.0, 6.2] },
  { id: "y2", p: [2.2, 1.8, 3.8] },
  { id: "y3", p: [5.2, 2.36, 2.4] },
  { id: "y4", p: [8.8, 3.02, -0.2] },
  { id: "y5", p: [7.5, 3.4, -5.2] },
  { id: "y6", p: [7.5, 2.2, -9] },
  // Courtyard
  { id: "c1", p: [7, 2.2, -11] },
  { id: "c2", p: [23, 2.2, -11] },
  { id: "c3", p: [8, 2.2, -21] },
  { id: "c4", p: [22.5, 2.2, -21] },
  { id: "c5", p: [15, 2.2, -13.5] },
  { id: "c6", p: [15, 2.2, -29] },
  { id: "c7", p: [2, 2.2, -32] },
  { id: "c8", p: [29.5, 2.2, -31] },
  { id: "c9", p: [30, 2.2, -15] },
  // Second alley
  { id: "s1", p: [0.5, 2.3, -38] },
  { id: "s2", p: [0.5, 3.6, -48] },
  { id: "s3", p: [0.5, 3.6, -55] },
  { id: "s4", p: [1.9, 3.6, -51] },
  { id: "s5", p: [3.3, 4.34, -51] },
  { id: "s6", p: [8, 5.0, -51] },
  { id: "s7", p: [-2.6, 3.6, -62] },
  { id: "s8", p: [7.6, 5.0, -62] },
  // Laundry rooftops
  { id: "r1", p: [12, 5.0, -48] },
  { id: "r2", p: [12, 5.0, -57] },
  { id: "r3", p: [21, 5.0, -47.5] },
  { id: "r4", p: [21, 5.0, -57] },
  { id: "r5", p: [32, 5.0, -48] },
  { id: "r6", p: [32, 5.0, -57] },
  { id: "r7", p: [41.5, 5.0, -49] },
  { id: "r8", p: [41.5, 5.0, -58] },
  { id: "r9", p: [26, 5.0, -40] },
  // Low roofs (shortcut B)
  { id: "b0", p: [31.9, 2.99, -31.2] },
  { id: "b1", p: [36.5, 3.4, -32.5] },
  { id: "b1b", p: [39.2, 3.4, -36.6] },
  { id: "b2", p: [41.8, 4.3, -40] },
  { id: "b2b", p: [43, 4.3, -45.6] },
  // Final climb
  { id: "f1", p: [47.3, 5.79, -58.6] },
  { id: "f2", p: [51, 5.9, -60] },
  { id: "f3", p: [53, 5.9, -63.4] },
  { id: "f3b", p: [53, 6.1, -67.6] },
  { id: "f4", p: [54, 6.6, -72.2] },
  // Safe rooftop
  { id: "g1", p: [57, 6.6, -75.5] },
  { id: "g2", p: [53, 6.6, -76] },
];

export const NAV_EDGES: NavEdgeDef[] = [
  // market
  { a: "m1", b: "m2", kind: "walk" },
  { a: "m1", b: "m3", kind: "walk" },
  { a: "m2", b: "m4", kind: "walk" },
  { a: "m3", b: "m5", kind: "walk" },
  { a: "m4", b: "m6", kind: "walk" },
  { a: "m5", b: "m6", kind: "walk" },
  { a: "m4", b: "m5", kind: "walk" },
  // exit
  { a: "m6", b: "e1", kind: "walk" },
  { a: "e1", b: "e2", kind: "walk" },
  { a: "e1", b: "e3", kind: "walk" },
  { a: "e2", b: "e3", kind: "walk" },
  // ground alley
  { a: "e2", b: "a1", kind: "walk" },
  { a: "a1", b: "a2", kind: "walk" },
  { a: "a2", b: "a3", kind: "walk" },
  { a: "a3", b: "a4", kind: "walk" },
  { a: "a4", b: "a5", kind: "walk" },
  { a: "a5", b: "c2", kind: "walk" },
  // awning shortcut
  { a: "e3", b: "y1", kind: "walk" },
  { a: "y1", b: "y2", kind: "jump" },
  { a: "y2", b: "y3", kind: "jump" },
  { a: "y3", b: "y4", kind: "jump" },
  { a: "y4", b: "y5", kind: "jump" },
  { a: "y5", b: "y6", kind: "drop" },
  { a: "y6", b: "c1", kind: "walk" },
  // courtyard
  { a: "c1", b: "c5", kind: "walk" },
  { a: "c2", b: "c5", kind: "walk" },
  { a: "c1", b: "c3", kind: "walk" },
  { a: "c2", b: "c4", kind: "walk" },
  { a: "c2", b: "c9", kind: "walk" },
  { a: "c9", b: "c4", kind: "walk" },
  { a: "c3", b: "c6", kind: "walk" },
  { a: "c4", b: "c6", kind: "walk" },
  { a: "c3", b: "c7", kind: "walk" },
  { a: "c6", b: "c7", kind: "walk" },
  { a: "c6", b: "c8", kind: "walk" },
  { a: "c4", b: "c8", kind: "walk" },
  { a: "c1", b: "c2", kind: "walk" },
  // second alley
  { a: "c7", b: "s1", kind: "walk" },
  { a: "s1", b: "s2", kind: "walk" },
  { a: "s2", b: "s3", kind: "walk" },
  { a: "s2", b: "s4", kind: "walk" },
  { a: "s4", b: "s5", kind: "jump" },
  { a: "s5", b: "s6", kind: "jump" },
  { a: "s3", b: "s7", kind: "walk" },
  { a: "s7", b: "s8", kind: "walk" },
  // rooftops
  { a: "s6", b: "r1", kind: "walk" },
  { a: "s8", b: "r2", kind: "walk" },
  { a: "r1", b: "r2", kind: "walk" },
  { a: "r1", b: "r3", kind: "walk" },
  { a: "r2", b: "r4", kind: "walk" },
  { a: "r3", b: "r4", kind: "walk" },
  { a: "r3", b: "r9", kind: "walk" },
  { a: "r3", b: "r5", kind: "walk" },
  { a: "r4", b: "r6", kind: "walk" },
  { a: "r5", b: "r6", kind: "walk" },
  { a: "r5", b: "r7", kind: "walk" },
  { a: "r6", b: "r8", kind: "walk" },
  { a: "r7", b: "r8", kind: "walk" },
  { a: "r9", b: "r5", kind: "walk" },
  // shortcut B
  { a: "c8", b: "b0", kind: "jump" },
  { a: "b0", b: "b1", kind: "jump" },
  { a: "b1", b: "b1b", kind: "walk" },
  { a: "b1b", b: "b2", kind: "jump" },
  { a: "b2", b: "b2b", kind: "walk" },
  { a: "b2b", b: "r7", kind: "jump" },
  // final climb
  { a: "r8", b: "f1", kind: "jump" },
  { a: "f1", b: "f2", kind: "jump" },
  { a: "f2", b: "f3", kind: "walk" },
  { a: "f3", b: "f3b", kind: "walk" },
  { a: "f3b", b: "f4", kind: "jump" },
  { a: "f4", b: "g1", kind: "walk" },
  { a: "g1", b: "g2", kind: "walk" },
];

/** Land outline (for the sea's shore shading and cliff placement). */
export const COASTLINE: Array<[number, number]> = [
  [-60, 44],
  [38, 44],
  [38, 26],
  [37.5, 4],
  [37, -24],
  [47.5, -27.5],
  [62, -40],
  [67, -52],
  [67, -86],
  [-60, -86],
];
