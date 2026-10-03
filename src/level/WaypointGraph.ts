import { NAV_EDGES, NAV_NODES, type NavEdgeDef, type NavEdgeKind, type NavNodeDef } from "../data/level";

export interface NavNode {
  id: string;
  x: number;
  y: number;
  z: number;
  edges: NavEdge[];
}

export interface NavEdge {
  to: NavNode;
  kind: NavEdgeKind;
  cost: number;
}

/**
 * Authored navigation graph for rival cats. Walk edges are traversed with
 * the character controller; jump/drop edges are scripted ballistic arcs,
 * which makes AI traversal of awnings and rooftops completely reliable.
 */
export class WaypointGraph {
  readonly nodes = new Map<string, NavNode>();

  constructor(nodes: readonly NavNodeDef[] = NAV_NODES, edges: readonly NavEdgeDef[] = NAV_EDGES) {
    for (const n of nodes) this.nodes.set(n.id, { id: n.id, x: n.p[0], y: n.p[1], z: n.p[2], edges: [] });
    for (const e of edges) {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b) throw new Error(`WaypointGraph: bad edge ${e.a}-${e.b}`);
      const d = Math.hypot(a.x - b.x, (a.y - b.y) * 1.5, a.z - b.z);
      const penalty = e.kind === "walk" ? 1 : 1.35;
      a.edges.push({ to: b, kind: e.kind, cost: d * penalty + (e.kind === "walk" ? 0 : 0.6) });
      if (e.kind !== "drop") {
        // reverse of a jump is a jump (downward arcs are fine as jumps too)
        b.edges.push({ to: a, kind: e.kind === "walk" ? "walk" : "jump", cost: d * penalty + (e.kind === "walk" ? 0 : 0.6) });
      }
    }
  }

  get(id: string): NavNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`WaypointGraph: unknown node ${id}`);
    return n;
  }

  /** Nearest node, preferring nodes on a similar height level. */
  nearest(x: number, y: number, z: number, maxDy = 1.4, filter?: (n: NavNode) => boolean): NavNode {
    let best: NavNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (filter && !filter(n)) continue;
      const dy = Math.abs(n.y - y);
      const d = Math.hypot(n.x - x, n.z - z) + (dy > maxDy ? 100 + dy * 10 : dy * 2);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) throw new Error("WaypointGraph: empty");
    return best;
  }

  /** A* shortest path from node to node (inclusive). */
  path(from: NavNode, to: NavNode): NavNode[] {
    if (from === to) return [from];
    const open = new Set<NavNode>([from]);
    const came = new Map<NavNode, NavNode>();
    const g = new Map<NavNode, number>([[from, 0]]);
    const f = new Map<NavNode, number>([[from, this.h(from, to)]]);
    while (open.size > 0) {
      let cur: NavNode | null = null;
      let curF = Infinity;
      for (const n of open) {
        const fv = f.get(n) ?? Infinity;
        if (fv < curF) {
          curF = fv;
          cur = n;
        }
      }
      if (!cur) break;
      if (cur === to) {
        const out: NavNode[] = [cur];
        while (came.has(out[0])) out.unshift(came.get(out[0])!);
        return out;
      }
      open.delete(cur);
      const gc = g.get(cur) ?? Infinity;
      for (const e of cur.edges) {
        const ng = gc + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          came.set(e.to, cur);
          g.set(e.to, ng);
          f.set(e.to, ng + this.h(e.to, to));
          open.add(e.to);
        }
      }
    }
    return [];
  }

  edgeBetween(a: NavNode, b: NavNode): NavEdge | null {
    return a.edges.find((e) => e.to === b) ?? null;
  }

  private h(a: NavNode, b: NavNode): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /** Path length (for travel-time estimates). */
  pathLength(p: NavNode[]): number {
    let d = 0;
    for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
    return d;
  }
}
