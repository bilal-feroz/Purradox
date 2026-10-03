import type { AgentSpec } from "../src/ai/CounterfactualSimulator";
import { CATS, type CatId } from "../src/data/cats";
import { SPAWN } from "../src/data/level";
import { WaypointGraph } from "../src/level/WaypointGraph";
import type { ReplayData, ReplaySnapshot } from "../src/replay/ReplayTypes";

export const graph = new WaypointGraph();

/** A Past You that runs the waypoint route from the market to the Safe Rooftop. */
export function syntheticRun(speed = 7.5): ReplayData {
  const route = graph.path(graph.get("m1"), graph.get("g1"));
  const snapshots: ReplaySnapshot[] = [];
  const events: ReplayData["events"] = [];
  let t = 0;
  const push = (x: number, y: number, z: number, grounded: boolean) =>
    snapshots.push({ t, position: [x, y, z], rotationY: 0, velocity: [0, 0, 0], grounded, carryingFish: true, fishGrip: 3, animationState: "run", action: "none", actionTime: 0 });
  push(route[0].x, route[0].y, route[0].z, true);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const jump = Math.abs(b.y - a.y) > 0.5;
    const len = Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y);
    const steps = Math.max(1, Math.round((len / speed) * 20));
    for (let s = 1; s <= steps; s++) {
      t += len / speed / steps;
      const u = s / steps;
      push(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, !jump || s === steps);
    }
    if (jump) events.push({ t, type: "land" });
  }
  return { version: 1, catId: "fishcat", hz: 20, duration: t, snapshots, events, finished: true };
}

export const agents = (ids: CatId[]): AgentSpec[] =>
  ids.map((id) => ({ cat: id, archetype: CATS[id].archetype, start: SPAWN.hunters[id].pos, speed: CATS[id].stats.sprintSpeed * 0.85 }));
