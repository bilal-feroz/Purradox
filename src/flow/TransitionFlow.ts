import * as THREE from "three";
import { CATS } from "../data/cats";
import { PALETTE } from "../data/palette";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { easeInOutCubic, formatClock } from "../core/math";
import type { CouncilPlan } from "../ai/TacticalPlanner";

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
  let knownShown = false;
  let resolved: CouncilPlan | null = null;
  let streak: THREE.Mesh | null = null;
  let streakCount = 0;
  let head: THREE.Mesh | null = null;
  let historyEnd = 0;
  let moteTimer = 0;
  let done = false;

  // ---------------------------------------------------------------- ANALYZE_RUN
  // THE ALLEY COUNCIL IS PLOTTING… → council map (your route, cats racing to
  // their simulated intercepts, your profile) → COUNTER-PLAN → THEY KNOW YOUR
  // ROUTE. About 4.7 s, then the rewind.
  g.fsm.register(GameState.ANALYZE_RUN, {
    enter: () => {
      t = 0;
      planShown = false;
      knownShown = false;
      resolved = null;
      // the plan was simulated when the run ended; an optional explanation
      // layer may still be rewording it
      g.planRequest?.then((p) => {
        resolved = p;
        if (p !== g.plan) g.councilMap.setPlanName(p.strategyName);
      });
      g.stamps.place("left");
      g.stamps.show("THE ALLEY COUNCIL", "council", true);
      g.stamps.show("IS PLOTTING…", "council", true);
      g.audio.play("stamp", { volume: 0.45 });
      if (g.plan) g.councilMap.show(g.plan, g.replay);
      // huddle: the three other cats gather in a little circle and plot
      const council = g.others();
      const center = new THREE.Vector3();
      for (const c of council) center.add(c.position);
      center.divideScalar(council.length);
      council.forEach((r, i) => {
        const a = (i / council.length) * Math.PI * 2 + Math.PI / 2;
        const p = new THREE.Vector3(center.x + Math.cos(a) * 0.8, center.y, center.z + Math.sin(a) * 0.8);
        r.teleport(p, Math.atan2(center.x - p.x, center.z - p.z));
        r.setForcedAction("sit");
        r.lookTarget = center.clone().setY(center.y + 0.45);
      });
      // frame the huddle left of centre; the council map owns the right
      g.camera.setCinematic(new THREE.Vector3(center.x + 1.6, center.y + 2.3, center.z + 3.6), new THREE.Vector3(center.x + 1.35, center.y + 0.95, center.z - 0.2), 1.6);
    },
    update: (dt) => {
      t += dt;
      for (const r of g.others()) {
        if (t > 0.5 && Math.random() < dt * 0.8) r.meow();
        r.updateScripted(dt);
      }
      g.camera.update(dt, null, null);
      if (!planShown && t > 2.5) {
        planShown = true;
        const plan = resolved ?? g.plan;
        if (plan) {
          g.plan = plan;
          g.stamps.clear(false);
          g.stamps.show("COUNTER-PLAN", "council", true);
          g.stamps.show(plan.strategyName, "strategy", false, plan.callout);
          g.audio.play("stamp", { volume: 0.6 });
          g.debug?.log(`plan (${plan.source}): ${plan.strategyName} — ${plan.reason}`);
        }
      }
      if (planShown && !knownShown && t > 3.6) {
        knownShown = true;
        g.stamps.clear(false);
        g.stamps.show("THEY KNOW", "watching", true);
        g.stamps.show("YOUR ROUTE.", "watching", true);
        g.councilMap.markKnown();
        g.audio.play("tell", { volume: 0.45 });
        g.audio.play("stamp", { volume: 0.55 });
      }
      if (knownShown && t > 4.7) g.fsm.transition(GameState.REWIND);
    },
    exit: () => {
      g.stamps.clear();
      g.councilMap.hide();
      for (const c of g.others()) c.lookTarget = null;
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
      g.stamps.place("high");
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
      // The thief's recorded trajectory as a glowing sea-glass streak
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
          const geo = new THREE.TubeGeometry(curve, segs, 0.2, 5, false);
          const mat = new THREE.MeshBasicMaterial({ color: PALETTE.seaGlass, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
          streak = new THREE.Mesh(geo, mat);
          streak.frustumCulled = false;
          g.scene.add(streak);
          streakCount = geo.index ? geo.index.count : 0;
        }
      }
      if (!head) {
        head = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42, 1),
          new THREE.MeshBasicMaterial({ color: PALETTE.seaGlass, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        );
        head.frustumCulled = false;
      }
      g.scene.add(head);
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
      const fc = g.runner.position;
      moteTimer -= dt;
      if (moteTimer <= 0) {
        moteTimer = 0.03;
        g.effects.reverseMotes(fc, 3, 2.4);
        for (const c of g.others()) g.effects.reverseMotes(c.position, 1, 1.4);
      }
      g.effects.sparkle(fc.clone().setY(fc.y + 0.4), 2, 0x7ff3dc, 1.6, 0.6);
      if (head) {
        head.position.set(fc.x, fc.y + 0.55, fc.z);
        head.scale.setScalar(0.9 + Math.sin(t * 30) * 0.15);
      }
      // High diorama view: the whole street runs backwards at once.
      const k = Math.min(1, u * 1.6);
      g.camera.setCinematic(
        new THREE.Vector3(14 + 18 * k, 26 + 22 * k, 6 + 22 * k),
        new THREE.Vector3(fc.x * (1 - k) + 8 * k, fc.y * (1 - k), fc.z * (1 - k) - 24 * k),
        2.4,
      );
      g.camera.update(dt, null, null);
      if (u >= 1) {
        done = true;
        streak?.removeFromParent();
        streak = null;
        head?.removeFromParent();
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
      const hunters = g.others();
      hunters.forEach((r, i) => {
        const s = SELECT_SPOTS[i];
        r.mode = "scripted";
        r.teleport(new THREE.Vector3(s[0], s[1], s[2]), 0);
        r.setForcedAction("sit");
        r.lookTarget = SELECT_CAM;
      });
      // Past You waits at the start, already sea-glass tinted
      g.runner.mode = "scripted";
      g.echo.bind(g.runner);
      g.echo.setEchoLook(true);
      g.camera.setCinematic(SELECT_CAM, SELECT_LOOK, 3, true);
      const runT = g.replay?.duration ?? 0;
      g.select.show(true, {
        ids: hunters.map((c) => c.id),
        title: "WHO WANTS THE FISH?",
        sub: "ROUND 2 — CHOOSE WHO HUNTS PAST YOU",
        recap: `Past You (${CATS[g.runnerId].name}) will replay your exact ${formatClock(runT)} run — every jump, pounce and hiss.`,
        focus: 1,
        card: (id) => ({ name: CATS[id].title, role: CATS[id].role.toUpperCase(), blurb: CATS[id].blurb }),
      });
      g.debug?.log(`replay: ${g.replay?.snapshots.length} snapshots, ${g.replay?.events.length} events, ${formatClock(g.replay?.duration ?? 0)}`);
    },
    update: (dt) => {
      t += dt;
      for (const c of g.cats) c.updateScripted(dt);
      g.pigeons.update(dt, []);
      g.fish.update(dt, [], g.time.realTime);
      g.camera.setCinematic(new THREE.Vector3(SELECT_CAM.x + Math.sin(t * 0.3) * 0.25, SELECT_CAM.y, SELECT_CAM.z), SELECT_LOOK, 2);
      g.camera.update(dt, null, null);
    },
    exit: () => {
      g.select.show(false);
      for (const c of g.others()) {
        c.setForcedAction(null);
        c.lookTarget = null;
      }
    },
  });
}
