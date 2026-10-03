import * as THREE from "three";
import { RIVAL_IDS } from "../data/cats";
import { PALETTE } from "../data/palette";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { easeInOutCubic, formatClock } from "../core/math";
import { heuristicPlan, type TacticalPlan } from "../ai/TacticalFallback";

const SELECT_SPOTS: Array<[number, number, number]> = [
  [-18.0, 0, 11.3],
  [-15.6, 0, 10.9],
  [-13.2, 0, 11.3],
];
const SELECT_CAM = new THREE.Vector3(-15.6, 0.92, 14.4);
const SELECT_LOOK = new THREE.Vector3(-15.6, 0.66, 10.9);
const REWIND_SECONDS = 3.2;

/** ANALYZE_RUN → REWIND → CAT_SELECTION */
export function registerTransitionFlow(g: Game): void {
  let t = 0;
  let planShown = false;
  let pending: Promise<TacticalPlan> | null = null;
  let resolved: TacticalPlan | null = null;
  let streak: THREE.Mesh | null = null;
  let streakCount = 0;
  let historyEnd = 0;
  let moteTimer = 0;
  let done = false;

  // ---------------------------------------------------------------- ANALYZE_RUN
  g.fsm.register(GameState.ANALYZE_RUN, {
    enter: () => {
      t = 0;
      planShown = false;
      resolved = null;
      const summary = g.telemetry.summary();
      pending = g.director.analyze(summary);
      pending.then((p) => {
        resolved = p;
      });
      g.stamps.show("THE ALLEY COUNCIL", "council", true);
      g.stamps.show("IS PLOTTING…", "council", true);
      g.audio.play("stamp", { volume: 0.45 });
      // huddle: the three rivals turn to each other
      const center = new THREE.Vector3();
      for (const id of RIVAL_IDS) center.add(g.rivals[id].position);
      center.divideScalar(3);
      for (const id of RIVAL_IDS) g.rivals[id].lookTarget = center.clone().setY(center.y + 0.5);
      g.camera.setCinematic(new THREE.Vector3(center.x, center.y + 2.4, center.z + 4.4), center.clone().setY(center.y + 0.5), 1.4);
    },
    update: (dt) => {
      t += dt;
      for (const id of RIVAL_IDS) {
        const r = g.rivals[id];
        if (t > 0.5 && Math.random() < dt * 0.8) r.meow();
        r.updateScripted(dt);
      }
      g.camera.update(dt, null, null);
      if (!resolved && t > 2.4) resolved = heuristicPlan(g.telemetry.summary());
      if (resolved && !planShown && t > 1.3) {
        planShown = true;
        g.plan = resolved;
        g.stamps.clear(false);
        g.stamps.show(resolved.name, "strategy", false, resolved.line);
        g.audio.play("stamp", { volume: 0.6 });
        g.debug?.log(`director (${resolved.source}): ${resolved.name} — ${resolved.reasons.join("; ")}`);
        t = 1.3;
      }
      if (planShown && t > 3.2) g.fsm.transition(GameState.REWIND);
    },
    exit: () => {
      g.stamps.clear();
      for (const id of RIVAL_IDS) g.rivals[id].lookTarget = null;
    },
  });

  // ---------------------------------------------------------------- REWIND
  g.fsm.register(GameState.REWIND, {
    enter: () => {
      t = 0;
      done = false;
      moteTimer = 0;
      g.time.baseScale = 0;
      g.time.clearEffects();
      g.hud.show(false);
      g.results.show(null);
      g.input.exitPointerLock();
      g.echo.stop();
      g.stamps.clear(false);
      g.stamps.show("REWINDING…", "rewinding");
      g.audio.play("rewind", { volume: 0.7, duration: REWIND_SECONDS });
      g.audio.setMusic("off");
      g.audio.setMuffle(0.55, 0.3);
      g.effects.reverseAll();
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.temporalVignette.classList.add("show");
      historyEnd = g.history.duration;
      for (const c of g.cats) {
        c.setForcedAction(null);
        c.abilities.cancelAll();
      }
      // Fish Cat's recorded trajectory as a glowing sea-glass streak
      streak?.removeFromParent();
      streak = null;
      if (g.replay && g.replay.snapshots.length > 4) {
        const pts: THREE.Vector3[] = [];
        let last: THREE.Vector3 | null = null;
        for (const s of g.replay.snapshots) {
          const p = new THREE.Vector3(s.position[0], s.position[1] + 0.35, s.position[2]);
          if (!last || last.distanceTo(p) > 0.35) {
            pts.push(p);
            last = p;
          }
        }
        if (pts.length > 3) {
          const curve = new THREE.CatmullRomCurve3(pts);
          const segs = Math.min(1600, pts.length * 3);
          const geo = new THREE.TubeGeometry(curve, segs, 0.06, 5, false);
          const mat = new THREE.MeshBasicMaterial({ color: PALETTE.seaGlass, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
          streak = new THREE.Mesh(geo, mat);
          streak.frustumCulled = false;
          g.scene.add(streak);
          streakCount = geo.index ? geo.index.count : 0;
        }
      }
    },
    update: (dt) => {
      if (done) return;
      t += dt;
      const u = Math.min(1, t / REWIND_SECONDS);
      const e = easeInOutCubic(u);
      const rt = historyEnd * (1 - e);
      g.history.apply(rt);
      const amt = Math.sin(Math.min(1, u * 1.15) * Math.PI);
      g.renderer.temporalUniforms.uAmount.value = Math.max(0.25, amt) * (u < 0.98 ? 1 : (1 - u) * 50);
      if (streak && streakCount > 0) {
        const frac = historyEnd > 0 ? rt / historyEnd : 0;
        const n = Math.floor((streakCount / 3) * frac) * 3;
        streak.geometry.setDrawRange(0, n);
        (streak.material as THREE.MeshBasicMaterial).opacity = 0.85 * Math.min(1, (1 - u) * 4);
      }
      const fc = g.fishCat.position;
      moteTimer -= dt;
      if (moteTimer <= 0) {
        moteTimer = 0.03;
        g.effects.reverseMotes(fc, 3, 2.4);
        for (const id of RIVAL_IDS) g.effects.reverseMotes(g.rivals[id].position, 1, 1.4);
      }
      g.camera.setCinematic(new THREE.Vector3(fc.x + 7, fc.y + 9.5, fc.z + 9), new THREE.Vector3(fc.x, fc.y + 0.5, fc.z), 2.6);
      g.camera.update(dt, null, null);
      if (u >= 1) {
        done = true;
        streak?.removeFromParent();
        streak = null;
        g.resetWorld();
        g.renderer.temporalUniforms.uAmount.value = 0;
        g.fsm.transition(GameState.CAT_SELECTION);
      }
    },
    exit: () => {
      g.stamps.clear();
      g.audio.setMuffle(1, 0.5);
    },
  });

  // ---------------------------------------------------------------- CAT_SELECTION
  g.fsm.register(GameState.CAT_SELECTION, {
    enter: () => {
      t = 0;
      g.time.baseScale = 1;
      g.controlled = null;
      g.hud.show(false);
      g.audio.setMusic("menu");
      g.temporalVignette.classList.add("show");
      g.renderer.temporalUniforms.uEdge.value = 0.25;
      RIVAL_IDS.forEach((id, i) => {
        const r = g.rivals[id];
        const s = SELECT_SPOTS[i];
        r.mode = "scripted";
        r.teleport(new THREE.Vector3(s[0], s[1], s[2]), 0);
        r.setForcedAction("sit");
      });
      // Past You waits at the start, already sea-glass tinted
      g.fishCat.mode = "scripted";
      g.echo.setEchoLook(true);
      g.camera.setCinematic(SELECT_CAM, SELECT_LOOK, 3, true);
      for (const id of RIVAL_IDS) g.rivals[id].lookTarget = SELECT_CAM;
      g.select.show(true, g.replay?.duration ?? 0);
      g.debug?.log(`replay: ${g.replay?.snapshots.length} snapshots, ${g.replay?.events.length} events, ${formatClock(g.replay?.duration ?? 0)}`);
    },
    update: (dt) => {
      t += dt;
      for (const id of RIVAL_IDS) g.rivals[id].updateScripted(dt);
      g.fishCat.updateScripted(dt);
      g.pigeons.update(dt, []);
      g.fish.update(dt, [], g.time.realTime);
      g.camera.setCinematic(new THREE.Vector3(SELECT_CAM.x + Math.sin(t * 0.3) * 0.25, SELECT_CAM.y, SELECT_CAM.z), SELECT_LOOK, 2);
      g.camera.update(dt, null, null);
    },
    exit: () => {
      g.select.show(false);
      for (const id of RIVAL_IDS) {
        g.rivals[id].setForcedAction(null);
        g.rivals[id].lookTarget = null;
      }
    },
  });
}
