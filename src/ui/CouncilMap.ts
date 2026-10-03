import { CATS } from "../data/cats";
import { SPAWN, ZONES, type V3 } from "../data/level";
import type { CouncilPlan } from "../ai/TacticalPlanner";
import type { ReplayData } from "../replay/ReplayTypes";
import { el } from "./dom";
import { ICONS } from "./icons";

// World bounds of Sardine Street on the x/z plane (+x east, +z south).
const MIN_X = -44;
const MAX_X = 68;
const MIN_Z = -88;
const MAX_Z = 32;
const W = 360;
const H = 386;

const ZONE_FILL: Record<string, string> = {
  market: "#f2c79a",
  exit: "#f0d6a8",
  alley1: "#e8c7a0",
  yard: "#f4dfb5",
  court: "#a9d8cf",
  alley2: "#d9c0a2",
  laundry: "#f2b8c3",
  lowroofs: "#efc8b0",
  climb: "#e9b9a4",
  safe: "#f5d98a",
};

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const mx = (x: number) => ((x - MIN_X) / (MAX_X - MIN_X)) * W;
const my = (z: number) => ((z - MIN_Z) / (MAX_Z - MIN_Z)) * H;

/**
 * THE ALLEY COUNCIL IS PLOTTING… — a little hand-drawn map of Sardine
 * Street: your recorded route draws itself in sea-glass, then each council
 * cat dashes to the intercept the Counterfactual Simulator picked for it.
 */
export class CouncilMap {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el("div", "council-map");
    parent.appendChild(this.root);
  }

  show(plan: CouncilPlan, replay: ReplayData | null): void {
    const zones = ZONES.map((z) => {
      const x = mx(z.min[0]);
      const y = my(z.min[2]);
      const w = mx(z.max[0]) - x;
      const h = my(z.max[2]) - y;
      return `<rect class="cm-zone" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${ZONE_FILL[z.id] ?? "#eee"}"/>`;
    }).join("");
    // Past You's recorded route (down-sampled)
    let route = "";
    let routeLen = 0;
    if (replay && replay.snapshots.length > 1) {
      const step = Math.max(1, Math.floor(replay.snapshots.length / 140));
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < replay.snapshots.length; i += step) {
        const p = replay.snapshots[i].position;
        pts.push([mx(p[0]), my(p[2])]);
      }
      const last = replay.snapshots[replay.snapshots.length - 1].position;
      pts.push([mx(last[0]), my(last[2])]);
      for (let i = 1; i < pts.length; i++) routeLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      route = `<polyline class="cm-route" points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" style="stroke-dasharray:${routeLen.toFixed(0)};stroke-dashoffset:${routeLen.toFixed(0)}"/>`;
    }
    const start = SPAWN.runner.pos;
    const goal = SPAWN.goal;
    const cats = plan.allyAssignments
      .map((a, i) => {
        const s: V3 = SPAWN.hunters[a.cat].pos;
        const sx = mx(s[0]);
        const sy = my(s[2]);
        const ex = mx(a.point[0]);
        const ey = my(a.point[2]);
        const len = Math.hypot(ex - sx, ey - sy);
        const delay = 0.55 + i * 0.28;
        const color = hex(CATS[a.cat].colors.main);
        return `
          <line class="cm-dash" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" style="stroke-dasharray:${len.toFixed(0)};stroke-dashoffset:${len.toFixed(0)};animation-delay:${delay}s"/>
          <circle class="cm-target" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="9" style="animation-delay:${delay + 0.75}s"/>
          <g class="cm-cat" style="--sx:${sx.toFixed(1)}px;--sy:${sy.toFixed(1)}px;--ex:${ex.toFixed(1)}px;--ey:${ey.toFixed(1)}px;animation-delay:${delay}s">
            <g transform="translate(-13 -12) scale(0.66)">${ICONS.catHead(color).replace("<svg", '<svg width="40" height="34"')}</g>
          </g>
          <text class="cm-role" x="${ex.toFixed(1)}" y="${(ey + 22).toFixed(1)}" style="animation-delay:${delay + 0.8}s">${a.roleName}</text>`;
      })
      .join("");
    const profile = plan.profile;
    this.root.innerHTML = `
      <div class="cm-card">
        <div class="cm-head">THE ALLEY COUNCIL</div>
        <svg class="cm-svg" viewBox="-12 -12 ${W + 24} ${H + 24}" aria-hidden="true">
          ${zones}
          ${route}
          <g class="cm-pin" transform="translate(${mx(start[0]).toFixed(1)} ${my(start[2]).toFixed(1)})"><circle r="10"/><g transform="translate(-9 -5)">${ICONS.fish().replace("<svg", '<svg width="18" height="10"')}</g></g>
          <g class="cm-goal" transform="translate(${mx(goal[0]).toFixed(1)} ${my(goal[2]).toFixed(1)})"><circle r="8"/></g>
          ${cats}
        </svg>
        <div class="cm-rows">
          ${profile ? `<div class="cm-row"><span>YOU</span><b>${profile.title}</b></div>` : ""}
          <div class="cm-row plan"><span>THE PLAN</span><b>${plan.strategyName}${plan.memory && plan.memory.counter === plan.strategyId ? `<i class="cm-tag" title="${plan.memory.line}">${plan.memory.streak} RUNS IN A ROW</i>` : ""}</b></div>
        </div>
      </div>`;
    this.root.classList.remove("show", "known");
    void this.root.offsetWidth;
    this.root.classList.add("show");
  }

  /** The explanation layer may rename the plan after the map is drawn. */
  setPlanName(name: string): void {
    const b = this.root.querySelector(".cm-row.plan b");
    if (b) b.textContent = name;
  }

  /** "THEY KNOW YOUR ROUTE." — the route flashes as the council commits. */
  markKnown(): void {
    this.root.classList.add("known");
  }

  hide(): void {
    this.root.classList.remove("show", "known");
  }
}
