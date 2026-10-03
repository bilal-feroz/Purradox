import * as THREE from "three";
import { CATS, type CatId } from "../data/cats";
import type { V3 } from "../data/level";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { ROLE_NAMES, type RoleId } from "../ai/CounterfactualSimulator";
import { zoneName } from "../ai/TacticalPlanner";
import type { TelemetrySummary } from "../ai/TelemetrySummary";

interface Marker {
  cat: CatId;
  role: RoleId;
  point: V3;
  /** When Past You passes the point (s into the recording). */
  t: number;
}

/** Bright, distinct debug colors (Soot's real fur is nearly black). */
const DEBUG_COLORS: Record<CatId, number> = {
  fishcat: 0xff9f43,
  mochi: 0xff7eb6,
  soot: 0xa99bff,
  beans: 0x6fd08c,
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/**
 * ?aiDebug=1 — judge mode. Shows the data the AI actually used: the
 * Behavior Fingerprint, recorded zone timings, every strategy the
 * Counterfactual Simulator scored, the selected plan, each cat's
 * assignment and, in the world, the predicted intercept points.
 * F4 hides it. Normal players never see any of this.
 */
export class AiDebugPanel {
  private readonly panel: HTMLDivElement;
  private readonly staticEl: HTMLDivElement;
  private readonly liveEl: HTMLDivElement;
  private readonly group = new THREE.Group();
  private readonly markers = new THREE.Group();
  private readonly links = new Map<CatId, THREE.Line>();
  private route: THREE.Line | null = null;
  private routeFor: unknown = null;
  private staticFor: unknown = null;
  private markerKey = "";
  private acc = 1;
  private shown = true;
  private added = false;

  constructor(
    private readonly g: Game,
    parent: HTMLElement,
  ) {
    this.panel = document.createElement("div");
    this.panel.id = "ai-debug";
    this.panel.innerHTML = `<div class="ad-head">AI DEBUG <span>· judge mode · F4 hides</span></div>`;
    this.liveEl = document.createElement("div");
    this.staticEl = document.createElement("div");
    this.panel.append(this.liveEl, this.staticEl);
    parent.appendChild(this.panel);
    this.group.add(this.markers);
    this.group.renderOrder = 97;
    window.addEventListener("keydown", (e) => {
      if (e.code !== "F4") return;
      e.preventDefault();
      this.shown = !this.shown;
    });
  }

  update(dt: number): void {
    const g = this.g;
    if (!this.added) {
      g.scene.add(this.group);
      this.added = true;
    }
    const state = g.fsm.state;
    // the council map already shows the plan during the cinematic beat
    const panelOn = this.shown && state !== GameState.ANALYZE_RUN;
    this.panel.style.display = panelOn ? "" : "none";
    // while a round is being played only the live section shows (pause for the rest)
    const compact = (state === GameState.FISH_RUN || state === GameState.HUNT) && !g.paused;
    this.panel.classList.toggle("compact", compact);
    this.staticEl.style.display = compact ? "none" : "";
    this.syncWorld();
    if (!panelOn) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    if (this.staticFor !== g.plan || (g.plan && this.staticEl.childElementCount === 0)) {
      this.staticFor = g.plan;
      this.staticEl.innerHTML = this.renderAnalysis();
    }
    this.liveEl.innerHTML = this.renderLive();
  }

  // ------------------------------------------------------------------ panel

  private renderLive(): string {
    const g = this.g;
    const state = g.fsm.state;
    if (state === GameState.FISH_RUN) {
      const s = g.telemetry.summary();
      return `
        <h4>RECORDING ROUND 1 <span>${f(s.runDuration, 1)} s</span></h4>
        <div class="ad-kv">
          <span>avg speed</span><b>${f(s.averageSpeed)} m/s</b>
          <span>sprint</span><b>${pct(s.sprintRatio)}</b>
          <span>rooftop</span><b>${pct(s.elevatedRatio)}</b>
          <span>hisses</span><b>${s.hisses.length}</b>
          <span>pounces</span><b>${s.pounces.length}</b>
          <span>props used</span><b>${s.interactions.length}</b>
        </div>
        ${zoneTable(s)}`;
    }
    if (g.round === 2 && g.coordinator) {
      const coord = g.coordinator;
      const now = g.echo.time;
      const rows = g
        .others()
        .filter((c) => c.id !== g.hunterId)
        .map((c) => {
          const m = coord.missions.get(c.id);
          const brain = g.brains[c.id];
          const target = m ? `${ROLE_NAMES[m.role]} · ${esc(zoneName(m.zone))}` : "no intercept — shadowing";
          const when = m ? (m.arriveAt >= now ? `in ${f(m.arriveAt - now, 1)}s` : `${f(now - m.arriveAt, 1)}s ago`) : "";
          const dist = m ? `${f(Math.hypot(c.position.x - m.point[0], c.position.z - m.point[2]), 1)}m` : "";
          return `<tr><td style="color:${hex(DEBUG_COLORS[c.id])}">${CATS[c.id].name}</td><td>${brain.state}</td><td>${target}${m?.source === "replan" ? " <i>replan</i>" : ""}</td><td>${when}</td><td>${dist}</td></tr>`;
        })
        .join("");
      const log = coord.log
        .slice(-6)
        .map((e) => `<div>${f(e.t, 1).padStart(5)}s  ${e.kind}${e.cat ? " " + e.cat : ""}  ${esc(e.detail)}</div>`)
        .join("");
      const plan = g.plan;
      const sel = plan ? `<div class="ad-sel"><b>${esc(plan.strategyName)}</b> · chosen from ${g.sim?.evaluated ?? 0} simulated plans · Esc shows the full analysis</div>` : "";
      return `
        ${sel}
        <h4>ROUND 2 · MULTI-AGENT COORDINATOR <span>echo ${f(now, 1)} / ${f(g.echo.duration, 1)} s · ${coord.replans} replans</span></h4>
        <table class="ad-t"><tr><th>ally</th><th>state</th><th>mission</th><th>Past You</th><th>dist</th></tr>${rows}</table>
        <div class="ad-log">${log}</div>`;
    }
    return "";
  }

  private renderAnalysis(): string {
    const g = this.g;
    const fp = g.fingerprint;
    const sim = g.sim;
    const plan = g.plan;
    if (!fp || !sim || !plan) return `<div class="ad-wait">Play Round 1. When the fish escapes, the council profiles the run and simulates its counter-plans here.</div>`;
    const tags = g.profileTags.map((t) => `<b>${t.title}</b> ${f(t.score)}`).join(" · ");
    const fingerprint = `
      <h4>1 · BEHAVIOR FINGERPRINT</h4>
      <div class="ad-kv">
        <span>avgSpeed</span><b>${f(fp.avgSpeed)} m/s</b>
        <span>sprintRatio</span><b>${f(fp.sprintRatio)}</b>
        <span>rooftopRatio</span><b>${f(fp.rooftopRatio)}</b>
        <span>shortcutUsage</span><b>${f(fp.shortcutUsage)}</b>
        <span>interactionRate</span><b>${f(fp.interactionRate, 1)}/min</b>
        <span>pounceRate</span><b>${f(fp.pounceRate, 1)}/min</b>
        <span>hissRate</span><b>${f(fp.hissRate, 1)}/min</b>
        <span>perfectHissRate</span><b>${f(fp.perfectHissRate)}</b>
        <span>fishGripLosses</span><b>${fp.fishGripLosses}</b>
        <span>groundRouteBias</span><b>${f(fp.groundRouteBias)}</b>
        <span>awningRouteBias</span><b>${f(fp.awningRouteBias)}</b>
        <span>riskScore</span><b>${f(fp.riskScore)}</b>
        <span>routeEntropy</span><b>${f(fp.routeEntropy)}</b>
        <span>hesitation</span><b>${f(fp.hesitationTime, 1)} s</b>
        <span>backtracks</span><b>${fp.counts.backtracks}</b>
      </div>
      <div class="ad-tags">${tags || "no strong tags"}</div>`;
    const zones = g.runSummary ? `<h4>2 · RECORDED ZONE TIMINGS</h4>${zoneTable(g.runSummary)}` : "";
    const cands = sim.top
      .map((c, i) => {
        const b = c.breakdown;
        const pen = b.unfairnessPenalty + b.travelImpossibility + b.duplicateRolePenalty;
        return `<tr class="${c.id === plan.strategyId ? "sel" : ""}"><td>${i + 1}</td><td>${c.name}</td><td>${f(c.score, 3)}</td><td>${f(b.interceptQuality)}</td><td>${f(b.coverage)}</td><td>${f(b.routeAdvantage)}</td><td>${f(b.roleSynergy)}</td><td>${f(b.prior)}</td><td>${pen > 0 ? "−" + f(pen) : "0"}</td><td>${c.windows}</td><td>${Number.isFinite(c.earliest) ? f(c.earliest, 1) + "s" : "—"}</td></tr>`;
      })
      .join("");
    const candidates = `
      <h4>3 · COUNTERFACTUAL SIMULATION <span>${sim.evaluated} plans · ${f(sim.ms, 0)} ms · best of each strategy</span></h4>
      <table class="ad-t"><tr><th>#</th><th>strategy</th><th>score</th><th>IQ</th><th>cov</th><th>adv</th><th>syn</th><th>prior</th><th>pen</th><th>win</th><th>first</th></tr>${cands}</table>`;
    const llm = g.director.enabled ? (plan.source === "llm" ? "LLM explanation applied" : "LLM explanation pending / unused") : "LLM layer off";
    const selected = `
      <h4>4 · SELECTED STRATEGY</h4>
      <div class="ad-sel"><b>${esc(plan.strategyName)}</b> · ${plan.strategyId} · ${plan.pressureStyle} pressure · ${llm}</div>
      <div class="ad-why">${esc(plan.reason)}</div>`;
    const chosen = sim.top.find((c) => c.id === plan.strategyId) ?? sim.best;
    const rows = chosen.assignments
      .map(
        (a) =>
          `<div class="ad-as"><b style="color:${hex(DEBUG_COLORS[a.cat])}">${CATS[a.cat].name}</b> ${ROLE_NAMES[a.role]} · ${esc(zoneName(a.zone))}${a.prop ? ` · prop ${a.prop}` : ""}
          <div>intercept (${f(a.point[0], 1)}, ${f(a.point[1], 1)}, ${f(a.point[2], 1)}) · Past You passes ${f(a.tPass, 1)}s · travel ${f(a.travel, 1)}s · slack ${a.slack >= 0 ? "+" : ""}${f(a.slack, 1)}s · q ${f(a.quality)}</div></div>`,
      )
      .join("");
    const assignments = `
      <h4>5 · AGENT ASSIGNMENTS · PREDICTED INTERCEPTS</h4>
      ${rows}
      <div class="ad-note">Rings in the world mark each intercept. In Round 2 the two free cats are re-planned for this strategy and the coordinator re-plans when a mission ends.</div>`;
    return fingerprint + zones + candidates + selected + assignments;
  }

  // ------------------------------------------------------------------ world

  private syncWorld(): void {
    const g = this.g;
    const state = g.fsm.state;
    const analysis = state === GameState.FISH_RUN_COMPLETE || state === GameState.ANALYZE_RUN || state === GameState.REWIND || state === GameState.CAT_SELECTION;
    const hunt = g.round === 2 && g.coordinator !== null && (state === GameState.HUNT || state === GameState.HUNT_COMPLETE);
    this.group.visible = this.shown && (analysis || hunt);
    if (!this.group.visible) return;
    // Past You's recorded route (the debug overlay draws its own)
    if (!g.debug && g.replay && this.routeFor !== g.replay) {
      this.routeFor = g.replay;
      if (this.route) {
        this.route.removeFromParent();
        this.route.geometry.dispose();
        (this.route.material as THREE.Material).dispose();
      }
      const pts = g.replay.snapshots.map((s) => new THREE.Vector3(s.position[0], s.position[1] + 0.12, s.position[2]));
      this.route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7fe0c8, depthTest: false, transparent: true, opacity: 0.85 }));
      this.route.renderOrder = 97;
      this.group.add(this.route);
    }
    const list: Marker[] = hunt
      ? [...g.coordinator!.missions.values()].map((m) => ({ cat: m.cat, role: m.role, point: m.point, t: m.arriveAt }))
      : (g.plan?.allyAssignments ?? []).map((a) => ({ cat: a.cat, role: a.role, point: a.point, t: a.tPass }));
    const key = list.map((m) => `${m.cat}:${m.role}:${m.point.join(",")}:${m.t.toFixed(2)}`).join("|");
    if (key !== this.markerKey) {
      this.markerKey = key;
      this.buildMarkers(list);
    }
    // live links: each ally to its intercept
    for (const [cat, line] of this.links) {
      const actor = g.actors[cat];
      const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, actor.position.x, actor.position.y + 0.5, actor.position.z);
      pos.needsUpdate = true;
      line.visible = hunt;
    }
  }

  private buildMarkers(list: Marker[]): void {
    for (const child of [...this.markers.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
    }
    this.links.clear();
    for (const m of list) {
      const color = DEBUG_COLORS[m.cat];
      const [x, y, z] = m.point;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.06, z);
      ring.renderOrder = 98;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false }));
      beam.position.set(x, y + 1.5, z);
      beam.renderOrder = 98;
      const label = makeLabel(`${CATS[m.cat].name.toUpperCase()} · ${ROLE_NAMES[m.role]} · ${m.t.toFixed(1)}s`, color);
      label.position.set(x, y + 3.35, z);
      const link = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y + 0.5, z), new THREE.Vector3(x, y + 0.5, z)]),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }),
      );
      link.renderOrder = 98;
      link.frustumCulled = false;
      this.links.set(m.cat, link);
      this.markers.add(ring, beam, label, link);
    }
  }
}

function zoneTable(s: TelemetrySummary): string {
  const rows = Object.entries(s.zoneEntryTimes)
    .sort((a, b) => a[1] - b[1])
    .map(([id, t]) => `<tr><td>${esc(zoneName(id))}</td><td>${f(t, 1)}s</td><td>${f(s.zoneTime[id] ?? 0, 1)}s</td></tr>`)
    .join("");
  return `<table class="ad-t"><tr><th>zone</th><th>entered</th><th>time in zone</th></tr>${rows}</table>`;
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 72;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 30px ui-monospace, Consolas, monospace";
  const w = Math.min(canvas.width - 8, ctx.measureText(text).width + 28);
  const x0 = (canvas.width - w) / 2;
  ctx.fillStyle = "rgba(10, 20, 26, 0.86)";
  ctx.beginPath();
  ctx.roundRect(x0, 8, w, 56, 14);
  ctx.fill();
  ctx.strokeStyle = hex(color);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#e9fff9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, 37);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(4.2, 0.6, 1);
  sprite.renderOrder = 99;
  return sprite;
}
