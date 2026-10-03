import { describe, expect, it } from "vitest";
import { ESCAPE_POINTS, NAV_EDGES, NAV_NODES, SPAWN, ZONES } from "../src/data/level";
import { WaypointGraph } from "../src/level/WaypointGraph";
import { isElevated, zoneAt } from "../src/level/Zones";

describe("Sardine Street layout data", () => {
  it("references only existing nav nodes", () => {
    const ids = new Set(NAV_NODES.map((n) => n.id));
    for (const e of NAV_EDGES) {
      expect(ids.has(e.a), e.a).toBe(true);
      expect(ids.has(e.b), e.b).toBe(true);
    }
    expect(ids.size).toBe(NAV_NODES.length);
  });

  it("puts the start in the Fish Market and the goal on the Safe Rooftop", () => {
    expect(zoneAt(...SPAWN.runner.pos)?.id).toBe("market");
    expect(zoneAt(SPAWN.goal[0], SPAWN.goal[1] + 0.1, SPAWN.goal[2])?.index).toBe(8);
  });

  it("puts every escape point and AI post inside a zone", () => {
    for (const e of ESCAPE_POINTS) expect(zoneAt(...e.pos), e.id).toBeTruthy();
    for (const p of Object.values(SPAWN.ai)) expect(zoneAt(...p.pos)).toBeTruthy();
    for (const p of Object.values(SPAWN.hunters)) expect(zoneAt(...p.pos)).toBeTruthy();
  });

  it("orders the eight zones like the blueprint", () => {
    const indices = [...new Set(ZONES.map((z) => z.index))].sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("marks rooftops as elevated and the market floor as ground", () => {
    expect(isElevated(zoneAt(20, 5.05, -50), 5.05)).toBe(true);
    expect(isElevated(zoneAt(-25, 0, 16), 0)).toBe(false);
    expect(isElevated(zoneAt(-25, 0.9, 16), 0.9)).toBe(true); // on a market table
  });
});

describe("WaypointGraph", () => {
  const g = new WaypointGraph();

  it("connects every node into one graph", () => {
    const start = g.get("m1");
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const n = q.shift()!;
      for (const e of n.edges) if (!seen.has(e.to)) {
        seen.add(e.to);
        q.push(e.to);
      }
    }
    expect(seen.size).toBe(g.nodes.size);
  });

  it("finds a route from the fish market to the safe rooftop", () => {
    const p = g.path(g.get("m1"), g.get("g1"));
    expect(p.length).toBeGreaterThan(5);
    expect(p[0].id).toBe("m1");
    expect(p[p.length - 1].id).toBe("g1");
  });

  it("prefers the awning shortcut from the market exit to the courtyard", () => {
    const p = g.path(g.get("e3"), g.get("c1")).map((n) => n.id);
    expect(p).toContain("y4");
  });

  it("uses the rooftop shortcut from the courtyard corner to the far roofs", () => {
    const p = g.path(g.get("c8"), g.get("r7")).map((n) => n.id);
    expect(p).toContain("b2");
  });

  it("never asks a cat to climb a one-way drop", () => {
    const y5 = g.get("y5");
    const y6 = g.get("y6");
    expect(g.edgeBetween(y5, y6)?.kind).toBe("drop");
    expect(g.edgeBetween(y6, y5)).toBeNull();
  });

  it("snaps to nearest nodes on the right height level", () => {
    expect(g.nearest(12, 5.0, -48).id).toBe("r1");
    expect(g.nearest(8, 2.2, -12).y).toBeCloseTo(2.2, 1);
  });
});
