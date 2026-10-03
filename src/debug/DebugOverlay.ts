import * as THREE from "three";
import { RIVAL_IDS } from "../data/cats";
import { ZONES } from "../data/level";
import type { Game } from "../core/Game";
import { zoneAt } from "../level/Zones";

/**
 * ?debug=1 — FPS, game state, zones, nav graph, replay path, recorded
 * events, Past You's authoritative position and physics colliders.
 */
export class DebugOverlay {
  private readonly panel: HTMLDivElement;
  private readonly group = new THREE.Group();
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private readonly logs: string[] = [];
  private navBuilt = false;
  private replayLine: THREE.Line | null = null;
  private replayFor: unknown = null;
  private readonly echoMarker: THREE.Mesh;
  private colliderLines: THREE.LineSegments | null = null;
  showColliders = false;

  constructor(
    private readonly g: Game,
    parent: HTMLElement,
  ) {
    this.panel = document.createElement("div");
    this.panel.id = "debug-panel";
    parent.appendChild(this.panel);
    this.echoMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xff2bd6, wireframe: true, depthTest: false }));
    this.echoMarker.renderOrder = 99;
    this.group.add(this.echoMarker);
    window.addEventListener("keydown", (e) => {
      if (e.code === "F2") {
        this.showColliders = !this.showColliders;
        if (this.colliderLines) this.colliderLines.visible = this.showColliders;
      }
    });
  }

  log(s: string): void {
    this.logs.push(s);
    if (this.logs.length > 8) this.logs.shift();
    console.info(`[purradox] ${s}`);
  }

  private buildStatic(): void {
    const g = this.g;
    g.scene.add(this.group);
    // nav graph
    const pts: number[] = [];
    const cols: number[] = [];
    for (const n of g.graph.nodes.values()) {
      for (const e of n.edges) {
        pts.push(n.x, n.y + 0.2, n.z, e.to.x, e.to.y + 0.2, e.to.z);
        const c = e.kind === "walk" ? [0.2, 1, 0.4] : e.kind === "jump" ? [1, 0.8, 0.1] : [1, 0.3, 0.2];
        cols.push(...c, ...c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    this.group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 })));
    // zones
    for (const z of ZONES) {
      const size = new THREE.Vector3(z.max[0] - z.min[0], Math.min(z.max[1], z.min[1] + 6) - z.min[1], z.max[2] - z.min[2]);
      const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...z.min), new THREE.Vector3(z.min[0] + size.x, z.min[1] + size.y, z.min[2] + size.z)), new THREE.Color(z.shortcut ? 0xff8800 : 0x33ccff));
      this.group.add(box);
    }
    // colliders
    const buffers = g.physics.world.debugRender();
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
    cg.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
    this.colliderLines = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }));
    this.colliderLines.visible = this.showColliders;
    this.group.add(this.colliderLines);
    this.navBuilt = true;
  }

  update(): void {
    const g = this.g;
    if (!g.physics) return;
    if (!this.navBuilt) this.buildStatic();
    this.frames++;
    this.acc += g.time.realDt;
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc);
      this.frames = 0;
      this.acc = 0;
    }
    if (g.replay && this.replayFor !== g.replay) {
      this.replayFor = g.replay;
      this.replayLine?.removeFromParent();
      const pts = g.replay.snapshots.map((s) => new THREE.Vector3(s.position[0], s.position[1] + 0.1, s.position[2]));
      this.replayLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff2bd6, depthTest: false }));
      this.group.add(this.replayLine);
      for (const e of g.replay.events) {
        if (e.type !== "hiss" && e.type !== "pounce") continue;
        const s = g.replay.snapshots.find((x) => x.t >= e.t) ?? g.replay.snapshots[g.replay.snapshots.length - 1];
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color: e.type === "hiss" ? 0xff4040 : 0xffd040, depthTest: false }));
        m.position.set(s.position[0], s.position[1] + 0.6, s.position[2]);
        this.group.add(m);
      }
    }
    this.echoMarker.visible = g.round === 2;
    this.echoMarker.position.copy(g.echo.authoritative).setY(g.echo.authoritative.y + 1.1);
    const c = g.controlled ?? g.fishCat;
    const z = zoneAt(c.position.x, c.position.y, c.position.z);
    const info = g.renderer.info();
    const lines = [
      `FPS ${this.fps}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  colliders ${g.physics.staticColliderCount}`,
      `state ${g.fsm.state}${g.paused ? " (paused)" : ""}  round ${g.round}  timeScale ${g.time.scale.toFixed(2)}`,
      `cat ${c.id} pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(1)}  grounded ${c.grounded}  zone ${z?.id ?? "-"}`,
      `vel ${Math.hypot(c.velocity.x, c.velocity.z).toFixed(2)}  action ${c.action}  fish ${g.fish.state}${g.fish.owner ? ":" + g.fish.owner.id : ""} grip ${g.fish.grip.value}`,
      `run ${g.runTime.toFixed(2)}s  rec ${g.recorder.snapshotCount} snaps / ${g.recorder.eventCount} events  history ${g.history.frameCount}`,
      g.round === 2 ? `echo t ${g.echo.time.toFixed(2)} / ${g.echo.duration.toFixed(2)}  finished ${g.echo.finished}` : "",
      RIVAL_IDS.map((id) => `${id}:${g.brains[id].state}`).join("  "),
      `listeners ${g.bus.listenerCount()}  resets ${g.resets.resetCount}`,
      ...this.logs,
    ];
    this.panel.textContent = lines.filter(Boolean).join("\n");
  }
}
