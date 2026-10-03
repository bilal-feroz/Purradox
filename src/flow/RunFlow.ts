import * as THREE from "three";
import { CAT_IDS, CATS } from "../data/cats";
import { SPAWN } from "../data/level";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { zoneAt } from "../level/Zones";
import { recordEscape } from "../ui/records";
import { ReplayRecorder } from "../replay/ReplayRecorder";
import { deriveTags, fingerprint } from "../ai/BehaviorProfiler";
import { analyzeTrace, simulateCounterfactuals } from "../ai/CounterfactualSimulator";
import { buildRequest } from "../ai/TacticalDirector";
import { agentFor, planCouncil } from "../ai/TacticalPlanner";

const MENU_CAT = new THREE.Vector3(-18.6, 0, 13.4);
/** Menu camera relative to the hero cat (cat sits right of frame). */
const MENU_CAM = new THREE.Vector3(-1.0, 1.02, 3.3);
const MENU_LOOK = new THREE.Vector3(-1.75, 0.6, 0);
/** Where the foreground pigeon stands on screen (NDC). */
const MENU_PIGEON_NDC = new THREE.Vector2(0.71, -0.8);
/** Extra windup (s) on each rival's first pounce of Round 1. */
const FIRST_POUNCE_BONUS = 0.3;
/** Choose Your Thief line-up in the market, and its camera. */
const THIEF_SPOTS: Array<[number, number, number]> = [
  [-17.85, 0, 11.2],
  [-16.35, 0, 11.0],
  [-14.85, 0, 11.0],
  [-13.35, 0, 11.2],
];
const THIEF_CAM = new THREE.Vector3(-15.6, 1.0, 15.3);
const THIEF_LOOK = new THREE.Vector3(-15.6, 0.62, 11.0);
const WATCH_SPOTS: Array<[number, number, number]> = [
  [50.6, 5.9, -61.2],
  [52.6, 5.9, -62.2],
  [54.6, 5.9, -61.4],
];

/** MENU → INTRO → FISH_RUN → FISH_RUN_COMPLETE */
export function registerRunFlow(g: Game): void {
  let t = 0;
  let sway = 0;
  let stampStage = 0;
  /** Seconds since a rival escaped with the fish (-1 = run still on). */
  let lostT = -1;

  // ---------------------------------------------------------------- MENU
  g.fsm.register(GameState.MENU, {
    enter: () => {
      // The home screen always stars Fish Cat; the thief is chosen later.
      g.runnerId = "fishcat";
      g.resetWorld();
      g.round = 1;
      g.controlled = null;
      g.hud.show(false);
      g.results.show(null);
      g.select.show(false);
      g.stamps.clear(false);
      g.start.show(true);
      g.input.exitPointerLock();
      g.renderer.temporalUniforms.uAmount.value = 0;
      g.renderer.temporalUniforms.uEdge.value = 0;
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.temporalVignette.classList.remove("show");
      g.lighting.temporalBlend = 0;
      g.audio.setMusic("menu");
      g.audio.setTemporalHum(false);
      g.audio.setMuffle(1);
      // Hero shot: Fish Cat proudly holding the fish
      g.fishCat.mode = "scripted";
      g.fishCat.teleport(MENU_CAT, -0.35);
      g.fish.forceCarry(g.fishCat, 3);
      const camPos = MENU_CAT.clone().add(MENU_CAM);
      const camLook = MENU_CAT.clone().add(MENU_LOOK);
      g.camera.setCinematic(camPos, camLook, 3, true);
      stageMenuPigeon(g, camPos, camLook);
      sway = 0;
    },
    update: (dt) => {
      sway += dt;
      const c = MENU_CAT;
      // Portrait screens: centre the cat below the menu instead of right of it.
      const portrait = g.camera.camera.aspect < 1;
      g.camera.setCinematic(
        new THREE.Vector3(c.x + MENU_CAM.x + Math.sin(sway * 0.25) * 0.16, MENU_CAM.y + Math.sin(sway * 0.4) * 0.05, c.z + MENU_CAM.z),
        portrait ? new THREE.Vector3(c.x, c.y + 1.2, c.z) : c.clone().add(MENU_LOOK),
        2,
      );
      if (!g.photoCamera) g.fishCat.lookTarget = g.camera.camera.position;
      for (const c of g.cats) c.updateScripted(dt);
      g.fish.update(dt, [], g.time.realTime);
      g.pigeons.update(dt, []);
      g.camera.update(dt, null, null);
    },
    exit: () => {
      g.start.show(false);
      g.pigeons.unstage();
      g.fishCat.lookTarget = null;
    },
  });

  // ---------------------------------------------------------------- THIEF_SELECTION
  // Unlocked after the first full cycle: any of the four cats may run
  // Round 1. Rules are identical; what changes is who is chasing you.
  g.fsm.register(GameState.THIEF_SELECTION, {
    enter: () => {
      t = 0;
      g.setPaused(false);
      g.results.show(null);
      g.start.show(false);
      g.hud.show(false);
      g.input.exitPointerLock();
      g.time.baseScale = 1;
      g.controlled = null;
      g.audio.setMusic("menu");
      g.temporalVignette.classList.remove("show");
      g.renderer.temporalUniforms.uEdge.value = 0;
      g.renderer.temporalUniforms.uAmount.value = 0;
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.lighting.temporalBlend = 0;
      g.resetWorld();
      CAT_IDS.forEach((id, i) => {
        const c = g.actors[id];
        const s = THIEF_SPOTS[i];
        c.mode = "scripted";
        c.teleport(new THREE.Vector3(s[0], s[1], s[2]), 0);
        c.setForcedAction("sit");
        c.lookTarget = THIEF_CAM;
      });
      g.camera.setCinematic(THIEF_CAM, THIEF_LOOK, 3, true);
      const focus = Math.max(0, CAT_IDS.indexOf(g.runnerId));
      g.select.show(true, {
        ids: [...CAT_IDS],
        title: "CHOOSE YOUR THIEF",
        sub: "ROUND 1 — YOUR THIEF BECOMES PAST YOU",
        recap: "Every thief plays by the same rules. What changes is which three cats chase you.",
        focus,
        back: true,
        card: (id) => ({
          name: CATS[id].title,
          role: `CHASED BY ${CAT_IDS.filter((o) => o !== id)
            .map((o) => CATS[o].name.toUpperCase())
            .join(" · ")}`,
          blurb: CATS[id].thiefLine,
        }),
      });
    },
    update: (dt) => {
      t += dt;
      for (const c of g.cats) c.updateScripted(dt);
      g.pigeons.update(dt, []);
      g.fish.update(dt, [], g.time.realTime);
      g.camera.setCinematic(new THREE.Vector3(THIEF_CAM.x + Math.sin(t * 0.3) * 0.25, THIEF_CAM.y, THIEF_CAM.z), THIEF_LOOK, 2);
      g.camera.update(dt, null, null);
    },
    exit: () => {
      g.select.show(false);
      for (const c of g.cats) {
        c.setForcedAction(null);
        c.lookTarget = null;
      }
    },
  });

  // ---------------------------------------------------------------- INTRO
  g.fsm.register(GameState.INTRO, {
    enter: () => {
      g.setPaused(false);
      g.results.show(null);
      g.resetWorld();
      g.round = 1;
      // Each rival's first lunge is slower: an easy first "!" to hiss at.
      for (const c of g.others()) c.windupBonus = FIRST_POUNCE_BONUS;
      // Whoever runs Round 1 is the cat that will play Past You.
      g.echo.bind(g.runner);
      g.controlled = g.runner;
      g.runner.mode = "player";
      g.hud.setRound(1);
      g.hud.clearAlerts();
      g.hud.show(true);
      g.hud.pingObjective(g.time.realTime, 5);
      g.stamps.clear(false);
      g.stamps.show("STEAL THE FISH", "hunt", true, "…then carry it to the Safe Rooftop. Every move you make is being recorded.");
      g.audio.play("stamp", { volume: 0.4 });
      g.audio.setMusic("round1");
      g.audio.setTemporalHum(false);
      g.renderer.temporalUniforms.uEdge.value = 0;
      g.renderer.temporalUniforms.uAmount.value = 0;
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.lighting.temporalBlend = 0;
      g.temporalVignette.classList.remove("show");
      const p = g.runner.position;
      g.camera.setCinematic(new THREE.Vector3(p.x - 6, p.y + 6, p.z + 7), new THREE.Vector3(p.x + 4, p.y, p.z), 2, true);
      g.huntStats = { perfectHisses: 0, interceptAttempts: 0, stolenAt: null, echoPerfectHisses: 0 };
      t = 0;
    },
    update: (dt) => {
      t += dt;
      const p = g.runner.position;
      const yaw = g.runner.yaw;
      const behind = new THREE.Vector3(p.x - Math.sin(yaw) * 4.4, p.y + 1.7, p.z - Math.cos(yaw) * 4.4);
      g.camera.setCinematic(behind, new THREE.Vector3(p.x + Math.sin(yaw) * 2, p.y + 0.8, p.z + Math.cos(yaw) * 2), 3.2);
      g.camera.update(dt, null, null);
      for (const c of g.cats) c.updateScripted(dt);
      g.fish.update(dt, [], g.time.simTime);
      g.pigeons.update(dt, []);
      g.updateHUD();
      const moved = g.input.isHeld("forward") || g.input.isHeld("back") || g.input.isHeld("left") || g.input.isHeld("right");
      if (t > 1.5 || (t > 0.45 && moved)) g.fsm.transition(GameState.FISH_RUN);
    },
    exit: () => {
      g.stamps.clear();
    },
  });

  // ---------------------------------------------------------------- FISH_RUN
  g.fsm.register(GameState.FISH_RUN, {
    enter: () => {
      // Record whichever cat is the thief this run.
      g.recorder = new ReplayRecorder(g.runnerId, 20);
      g.recorder.start();
      g.history.clear();
      g.telemetry.reset();
      g.runTime = 0;
      g.time.baseScale = 1;
      g.camera.snapBehind(g.runner.yaw, g.runner.position.clone().setY(g.runner.position.y + 0.78));
      g.camera.pitch = 0.12;
      g.camera.distance = 3.7;
      g.input.requestPointerLock();
      g.recorder.tick(0, () => g.snapshotRunner(), true);
      g.history.tick(0, true);
      lostT = -1;
    },
    update: (realDt) => {
      if (lostT >= 0) {
        // FISH LOST: short beat, then straight back into a fresh Round 1.
        lostT += realDt;
        const thief = g.fish.owner;
        if (thief && lostT > 0.35) thief.rig.root.visible = false;
        g.updateFollowCamera(realDt);
        const skip = lostT > 0.7 && (g.input.consume("jump", 0.2) || g.input.consume("pounce", 0.2) || g.input.consume("interact", 0.2));
        if (lostT > 2.2 || skip) g.fsm.transition(GameState.INTRO);
        return;
      }
      const dt = g.time.simDt;
      if (dt > 0) {
        g.runTime += dt;
        g.simulate(dt, 1);
        const thief = g.fish.owner;
        if (thief && thief !== g.runner && g.brains[thief.id].escaped) {
          lostT = 0;
          const where = g.brains[thief.id].escapePoint?.label ?? "the rooftops";
          g.hud.setPrompt(null);
          g.stamps.clear(false);
          g.stamps.show("FISH LOST!", "watching", false, `${thief.def.name} slipped away through ${where}. Again!`);
          g.audio.play("fail", { volume: 0.5 });
          g.effects.sparkle(thief.center(), 18, 0xfff3b0, 2.2, 0.8);
          g.effects.dust(thief.position, 10, 0.9, 0.8, 0.16);
          g.time.slowMo(0.5, 0.35);
          return;
        }
        g.recorder.tick(g.runTime, () => g.snapshotRunner());
        g.history.tick(g.runTime);
        const a = g.runner;
        const z = zoneAt(a.position.x, a.position.y, a.position.z);
        let threat = 99;
        for (const c of g.others()) threat = Math.min(threat, c.position.distanceTo(a.position));
        g.telemetry.sample(g.runTime, dt, a.position.x, a.position.y, a.position.z, z?.id ?? "", g.elevated(a), a.movement.sprinting, threat);
        if (z?.id === "safe" && g.fish.owner === a && a.grounded) g.fsm.transition(GameState.FISH_RUN_COMPLETE);
      }
      g.updateHUD();
      g.updateFollowCamera(realDt);
    },
  });

  // ---------------------------------------------------------------- FISH_RUN_COMPLETE
  g.fsm.register(GameState.FISH_RUN_COMPLETE, {
    enter: () => {
      g.replay = g.recorder.finish(g.runTime, () => g.snapshotRunner(), true);
      g.history.tick(g.runTime, true);
      recordEscape(g.runTime);
      // Profile the run and ask the Tactical Director now, while the
      // end-of-run beats play.
      const summary = g.telemetry.summary();
      g.runSummary = summary;
      g.fingerprint = fingerprint(summary);
      g.profileTags = deriveTags(g.fingerprint);
      g.debug?.log(`profile: ${g.profileTags.map((tg) => tg.title).join(", ")}`);
      // Counterfactual simulation: fast-forward many council plans against
      // the recorded run, then let the planner pick and explain one.
      g.trace = analyzeTrace(g.replay, g.graph);
      g.sim = simulateCounterfactuals(g.trace, g.graph, g.otherIds().map(agentFor), g.fingerprint);
      g.plan = planCouncil(g.sim, g.fingerprint, g.profileTags);
      g.debug?.log(`council: ${g.plan.strategyName} — ${g.sim.evaluated} plans simulated in ${g.sim.ms.toFixed(0)} ms`);
      // Optional LLM explanation layer (renames/explains only; may time out).
      g.planRequest = g.director.explain(g.plan, buildRequest(g.plan, g.fingerprint, g.profileTags, summary));
      g.runner.setForcedAction("victory");
      g.runner.meow();
      g.audio.play("victory", { volume: 0.55 });
      g.audio.duckMusic(6);
      g.time.slowMo(0.9, 0.5);
      g.input.exitPointerLock();
      g.hud.setPrompt(null);
      t = 0;
      stampStage = 0;
    },
    update: (realDt) => {
      t += realDt;
      const dt = g.time.simDt;
      if (t < 0.9) {
        // the victory sit plays out while time slows
        g.runner.updateScripted(dt);
        for (const c of g.others()) c.update(dt);
        g.fish.update(dt, [], g.time.simTime);
        g.pigeons.update(dt, []);
        g.updateFollowCamera(realDt);
      } else if (stampStage === 0) {
        stampStage = 1;
        g.time.baseScale = 0;
        g.renderer.temporalUniforms.uFreeze.value = 1;
        g.audio.setMuffle(0.15, 0.25);
        g.hud.show(false);
        g.stamps.show("RUN COMPLETE", "complete");
        g.audio.play("stamp", { volume: 0.6 });
      }
      if (stampStage === 1 && t > 2.0) {
        stampStage = 2;
        g.stamps.show("RUN RECORDED", "recorded");
        g.audio.play("stamp", { volume: 0.6 });
      }
      if (stampStage === 2 && t > 3.2) {
        stampStage = 3;
        g.stamps.clear(false);
        // Cut to the watchers on the final-climb roof.
        g.others().forEach((r, i) => {
          const s = WATCH_SPOTS[i];
          r.teleport(new THREE.Vector3(s[0], s[1], s[2]), Math.PI);
          r.setForcedAction("sit");
          r.lookTarget = g.runner.center();
        });
        const fc = g.runner.position;
        g.camera.setCinematic(new THREE.Vector3(52.6, 7.25, -57.2), new THREE.Vector3(fc.x, fc.y + 0.6, fc.z), 3, true);
        g.stamps.place("low");
        g.stamps.show("BUT SOMEONE ELSE", "watching", true);
        g.stamps.show("WAS WATCHING.", "watching", true);
        g.audio.play("stamp", { volume: 0.5 });
        g.others()[1]?.meow();
      }
      if (stampStage >= 3) {
        for (const c of g.others()) c.updateScripted(realDt);
        g.camera.update(realDt, null, null);
      } else if (t >= 0.9) {
        g.camera.update(realDt, null, null);
      }
      if (stampStage === 3 && t > 5.0) g.fsm.transition(GameState.ANALYZE_RUN);
    },
    exit: () => {
      g.stamps.clear();
    },
  });

  // stamps default to center placement whenever a new flow phase begins
  g.fsm.onChange((to) => {
    if (to !== GameState.FISH_RUN_COMPLETE && to !== GameState.ANALYZE_RUN) g.stamps.place("center");
    if (to !== GameState.ANALYZE_RUN) g.councilMap.hide();
  });

  void SPAWN;
}

/** Put the market pigeon nearest the hero cat in the menu's foreground. */
function stageMenuPigeon(g: Game, camPos: THREE.Vector3, camLook: THREE.Vector3): void {
  // Nominal 16:9 camera: placement must not depend on the window size at boot.
  const cam = new THREE.PerspectiveCamera(g.camera.camera.fov, 16 / 9, 0.1, 100);
  cam.position.copy(camPos);
  cam.lookAt(camLook);
  cam.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(MENU_PIGEON_NDC, cam);
  const spot = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -MENU_CAT.y), new THREE.Vector3());
  if (!spot) return;
  let best = 0;
  let bestD = Infinity;
  g.pigeons.pigeons.forEach((p, i) => {
    const d = p.home.distanceTo(MENU_CAT);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  // face screen-left, slightly toward the camera
  const toCam = camPos.clone().sub(spot).setY(0).normalize();
  const left = new THREE.Vector3(-toCam.z, 0, toCam.x);
  const face = left.multiplyScalar(0.8).add(toCam.multiplyScalar(0.45));
  g.pigeons.stage(best, spot, Math.atan2(face.x, face.z), 0.82);
}
