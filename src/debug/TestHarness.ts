import * as THREE from "three";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import type { Autopilot, RoutePoint } from "./Autopilot";

/**
 * Debug-only scripted scenarios (enabled with ?debug=1). Used to verify
 * the full loop, replay fidelity and the recorded-hiss counter without a
 * human at the keyboard. Every loop is bounded.
 */
export class TestHarness {
  constructor(
    private readonly g: Game,
    private readonly ap: Autopilot,
  ) {}

  /** Take over (or release) the frame clock for deterministic scripted runs. */
  manual(on = true): void {
    this.g.manualStepping = on;
    this.g.autoPause = !on;
  }

  step(frames: number, render = false): void {
    const g = this.g;
    this.manual(true);
    const prev = g.renderEnabled;
    g.renderEnabled = render;
    for (let i = 0; i < frames; i++) g.frame(g.time.lastStamp + 1000 / 60);
    g.renderEnabled = prev;
  }

  stepUntil(pred: () => boolean, maxFrames = 3000): boolean {
    for (let i = 0; i < maxFrames; i++) {
      if (pred()) return true;
      this.step(1);
    }
    return pred();
  }

  mainRoute(): RoutePoint[] {
    const g = this.g;
    const N = (id: string): [number, number, number] => {
      const n = g.graph.get(id);
      return [n.x, n.y, n.z];
    };
    return [
      [-23.0, 0, 15.6],
      { hiss: true },
      [-23.4, 0, 13.6],
      [-19, 0, 13.6],
      N("m6"),
      N("e1"),
      N("e2"),
      N("a1"),
      N("a2"),
      N("a3"),
      N("a4"),
      N("a5"),
      N("c2"),
      { pounce: true },
      N("c4"),
      N("c6"),
      N("c7"),
      N("s1"),
      N("s2"),
      N("s4"),
      N("s5"),
      N("s6"),
      N("r1"),
      N("r3"),
      N("r5"),
      N("r7"),
      N("r8"),
      N("f1"),
      N("f2"),
      N("f3"),
      N("f3b"),
      N("f4"),
      N("g1"),
    ];
  }

  /** Play Round 1 with the autopilot. */
  runR1(rivals = false, route?: RoutePoint[]): ReturnType<Autopilot["run"]> {
    const g = this.g;
    g.autoPause = false;
    if (g.fsm.state !== GameState.MENU && g.fsm.canTransition(GameState.MENU)) g.fsm.transition(GameState.MENU);
    if (g.fsm.state === GameState.MENU) g.fsm.transition(GameState.INTRO);
    else if (g.fsm.canTransition(GameState.INTRO)) g.fsm.transition(GameState.INTRO);
    this.step(100);
    if (!rivals) for (const id of ["mochi", "soot", "beans"] as const) g.brains[id].enabled = false;
    this.ap.start(route ?? this.mainRoute());
    return this.ap.run(4000);
  }

  /** From the end of Round 1 to the start of the hunt. */
  toHunt(hunter: "mochi" | "soot" | "beans"): string {
    const g = this.g;
    this.stepUntil(() => g.fsm.state === GameState.CAT_SELECTION, 1500);
    if (g.fsm.state !== GameState.CAT_SELECTION) return g.fsm.state;
    g.hunterId = hunter;
    g.fsm.transition(GameState.HUNT);
    this.stepUntil(() => g.echo.running, 200);
    return g.fsm.state;
  }

  /** Render the four cats in a row from a chosen angle (art review). */
  lineup(angle = 0.5, dist = 4.6, height = 0.9, spacing = 1.7): void {
    const g = this.g;
    document.querySelectorAll<HTMLElement>("#ui-root .screen").forEach((s) => (s.style.display = "none"));
    const cats = [g.fishCat, g.rivals.mochi, g.rivals.soot, g.rivals.beans];
    const center = new THREE.Vector3(8, 2.2, -17.5);
    cats.forEach((c, i) => {
      c.mode = "scripted";
      c.setForcedAction(null);
      c.lookTarget = null;
      c.rig.root.visible = true;
      c.teleport(new THREE.Vector3(center.x - spacing * 1.5 + i * spacing, center.y, center.z), angle);
    });
    g.fish.reset();
    for (let i = 0; i < 40; i++) cats.forEach((c) => c.updateScripted(1 / 60));
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 300);
    cam.position.set(center.x, center.y + height, center.z + dist);
    cam.lookAt(center.x, center.y + 0.42, center.z);
    g.photoCamera = cam;
    g.renderEnabled = true;
    this.step(2, true);
  }

  /** Free photo camera for art review (null restores the game camera). */
  photo(pos: [number, number, number] | null, look: [number, number, number] = [0, 0, 0], fov = 55): void {
    const g = this.g;
    if (!pos) {
      g.photoCamera = null;
      return;
    }
    const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 600);
    cam.position.set(...pos);
    cam.lookAt(...look);
    g.photoCamera = cam;
    g.renderEnabled = true;
    this.step(2, true);
  }

  /** Round 2 art check: hunter behind/beside Past You at a replay time. */
  huntShot(echoTime: number, back = 4.2, side = 1.4, scent = true): string {
    const g = this.g;
    this.stepUntil(() => g.echo.time >= echoTime || !g.echo.running, 4000);
    const pc = g.fishCat;
    const h = g.controlled!;
    const fx = Math.sin(pc.yaw);
    const fz = Math.cos(pc.yaw);
    h.teleport(new THREE.Vector3(pc.position.x - fx * back + fz * side, pc.position.y, pc.position.z - fz * back - fx * side), pc.yaw);
    g.camera.snapBehind(h.yaw, h.position.clone().setY(h.position.y + 0.78));
    if (scent) {
      h.abilities.scentCooldown = 0;
      g.input.press("scent");
    }
    this.step(18, true);
    return `${g.echo.time.toFixed(2)}s prints=${g.prints.mesh.count}`;
  }

  /** Put the hunter in front of Past You and pounce at a given echo time. */
  pounceEchoAt(echoTime: number, distance = 2.0): { events: string[]; hunterStaggered: boolean; grip: number; owner: string | null } {
    const g = this.g;
    const events: string[] = [];
    const offs = [
      g.bus.on("perfectHiss", (e) => events.push(`perfectHiss:${e.hisser}>${e.attacker}@${g.echo.time.toFixed(2)}`)),
      g.bus.on("pounceHit", (e) => events.push(`hit:${e.attacker}>${e.target}:${e.gripDamage}@${g.echo.time.toFixed(2)}`)),
      g.bus.on("hissStart", (e) => events.push(`hiss:${e.cat}@${g.echo.time.toFixed(2)}`)),
      g.bus.on("fishDrop", (e) => events.push(`drop:${e.cat}@${g.echo.time.toFixed(2)}`)),
    ];
    this.stepUntil(() => g.echo.time >= echoTime || !g.echo.running, 6000);
    const pc = g.fishCat;
    const h = g.controlled!;
    const fwd = new THREE.Vector3(Math.sin(pc.yaw), 0, Math.cos(pc.yaw));
    const p = pc.position.clone().addScaledVector(fwd, distance);
    h.teleport(p, Math.atan2(-fwd.x, -fwd.z));
    h.abilities.resetCooldowns();
    h.staggerT = 0;
    g.camera.yaw = h.yaw + Math.PI;
    g.input.press("pounce");
    let staggered = false;
    for (let i = 0; i < 45; i++) {
      this.step(1);
      if (h.staggerT > 0) staggered = true;
    }
    for (const off of offs) off();
    return { events, hunterStaggered: staggered, grip: g.fish.grip.value, owner: g.fish.owner ? g.fish.owner.id : null };
  }
}
