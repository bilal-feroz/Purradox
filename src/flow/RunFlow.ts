import * as THREE from "three";
import { RIVAL_IDS } from "../data/cats";
import { SPAWN } from "../data/level";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { zoneAt } from "../level/Zones";

const MENU_CAT = new THREE.Vector3(-18.6, 0, 13.4);
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

  // ---------------------------------------------------------------- MENU
  g.fsm.register(GameState.MENU, {
    enter: () => {
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
      g.camera.setCinematic(new THREE.Vector3(MENU_CAT.x - 1.2, 1.15, MENU_CAT.z + 3.9), new THREE.Vector3(MENU_CAT.x - 2.0, 0.62, MENU_CAT.z), 3, true);
      sway = 0;
    },
    update: (dt) => {
      sway += dt;
      const c = MENU_CAT;
      g.camera.setCinematic(
        new THREE.Vector3(c.x - 1.2 + Math.sin(sway * 0.25) * 0.4, 1.15 + Math.sin(sway * 0.4) * 0.08, c.z + 3.9),
        new THREE.Vector3(c.x - 2.0, 0.62, c.z),
        2,
      );
      if (!g.photoCamera) g.fishCat.lookTarget = g.camera.camera.position;
      g.fishCat.updateScripted(dt);
      for (const id of RIVAL_IDS) g.rivals[id].updateScripted(dt);
      g.fish.update(dt, [], g.time.realTime);
      g.pigeons.update(dt, []);
      g.camera.update(dt, null, null);
    },
    exit: () => {
      g.start.show(false);
      g.fishCat.lookTarget = null;
    },
  });

  // ---------------------------------------------------------------- INTRO
  g.fsm.register(GameState.INTRO, {
    enter: () => {
      g.setPaused(false);
      g.results.show(null);
      g.resetWorld();
      g.round = 1;
      g.controlled = g.fishCat;
      g.fishCat.mode = "player";
      g.hud.setRound(1);
      g.hud.clearAlerts();
      g.hud.show(true);
      g.hud.pingObjective(g.time.realTime, 5);
      g.stamps.clear(false);
      g.stamps.show("STEAL THE FISH", "hunt", true);
      g.audio.play("stamp", { volume: 0.4 });
      g.audio.setMusic("round1");
      g.audio.setTemporalHum(false);
      g.renderer.temporalUniforms.uEdge.value = 0;
      g.renderer.temporalUniforms.uAmount.value = 0;
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.lighting.temporalBlend = 0;
      g.temporalVignette.classList.remove("show");
      const p = g.fishCat.position;
      g.camera.setCinematic(new THREE.Vector3(p.x - 6, p.y + 6, p.z + 7), new THREE.Vector3(p.x + 4, p.y, p.z), 2, true);
      g.huntStats = { perfectHisses: 0, interceptAttempts: 0, stolenAt: null, echoPerfectHisses: 0 };
      t = 0;
    },
    update: (dt) => {
      t += dt;
      const p = g.fishCat.position;
      const yaw = g.fishCat.yaw;
      const behind = new THREE.Vector3(p.x - Math.sin(yaw) * 4.4, p.y + 1.7, p.z - Math.cos(yaw) * 4.4);
      g.camera.setCinematic(behind, new THREE.Vector3(p.x + Math.sin(yaw) * 2, p.y + 0.8, p.z + Math.cos(yaw) * 2), 3.2);
      g.camera.update(dt, null, null);
      g.fishCat.updateScripted(dt);
      for (const id of RIVAL_IDS) g.rivals[id].updateScripted(dt);
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
      g.recorder.start();
      g.history.clear();
      g.telemetry.reset();
      g.runTime = 0;
      g.time.baseScale = 1;
      g.camera.snapBehind(g.fishCat.yaw, g.fishCat.position.clone().setY(g.fishCat.position.y + 0.78));
      g.camera.pitch = 0.12;
      g.camera.distance = 3.7;
      g.input.requestPointerLock();
      g.recorder.tick(0, () => g.snapshotFishCat(), true);
      g.history.tick(0, true);
    },
    update: (realDt) => {
      const dt = g.time.simDt;
      if (dt > 0) {
        g.runTime += dt;
        g.simulate(dt, 1);
        g.recorder.tick(g.runTime, () => g.snapshotFishCat());
        g.history.tick(g.runTime);
        const a = g.fishCat;
        const z = zoneAt(a.position.x, a.position.y, a.position.z);
        let threat = 99;
        for (const id of RIVAL_IDS) threat = Math.min(threat, g.rivals[id].position.distanceTo(a.position));
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
      g.replay = g.recorder.finish(g.runTime, () => g.snapshotFishCat(), true);
      g.history.tick(g.runTime, true);
      // Ask the Tactical Director now, while the end-of-run beats play.
      g.plan = null;
      g.planRequest = g.director.analyze(g.telemetry.summary());
      g.fishCat.setForcedAction("victory");
      g.fishCat.meow();
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
        g.fishCat.updateScripted(dt);
        for (const id of RIVAL_IDS) g.rivals[id].update(dt);
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
        RIVAL_IDS.forEach((id, i) => {
          const r = g.rivals[id];
          const s = WATCH_SPOTS[i];
          r.teleport(new THREE.Vector3(s[0], s[1], s[2]), Math.PI);
          r.setForcedAction("sit");
          r.lookTarget = g.fishCat.center();
        });
        const fc = g.fishCat.position;
        g.camera.setCinematic(new THREE.Vector3(52.6, 7.25, -57.2), new THREE.Vector3(fc.x, fc.y + 0.6, fc.z), 3, true);
        g.stamps.place("low");
        g.stamps.show("BUT SOMEONE ELSE", "watching", true);
        g.stamps.show("WAS WATCHING.", "watching", true);
        g.audio.play("stamp", { volume: 0.5 });
        g.rivals.soot.meow();
      }
      if (stampStage >= 3) {
        for (const id of RIVAL_IDS) g.rivals[id].updateScripted(realDt);
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
  });

  void SPAWN;
}
