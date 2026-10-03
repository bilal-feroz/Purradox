import * as THREE from "three";
import { CATS } from "../data/cats";
import { SPAWN } from "../data/level";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { formatClock } from "../core/math";
import type { Mission } from "../cats/CatAI";
import { zoneAt } from "../level/Zones";
import type { ReplayData } from "../replay/ReplayTypes";
import { castAssignments, heuristicPlan, type Assignment } from "../ai/TacticalFallback";
import { recordSteal } from "../ui/records";

const HUNT_INTRO = 1.2;
/** Past You flashes its "!" this long before replaying a hiss or pounce. */
const ECHO_TELL_LEAD = 0.3;

/**
 * Turn the Alley Council's high-level plan into concrete ambush missions on
 * Past You's ACTUAL recorded route: find when the recording enters each
 * preferred zone and send the helper there early enough to be waiting.
 */
export function planMissions(g: Game, a: Assignment, replay: ReplayData): Mission[] {
  const cat = a.cat;
  const snaps = replay.snapshots;
  const missions: Mission[] = [];
  const helper = g.actors[cat];
  const start = new THREE.Vector3(...SPAWN.hunters[cat].pos);
  const speed = helper.stats.sprintSpeed * 0.85;
  const used = new Set<string>();
  const tryZone = (zoneId: string | null, progress: number): void => {
    let idx = -1;
    if (zoneId) {
      idx = snaps.findIndex((s) => s.grounded && zoneAt(s.position[0], s.position[1], s.position[2])?.id === zoneId);
    }
    if (idx < 0) idx = Math.min(snaps.length - 1, Math.floor(progress * snaps.length));
    // walk forward until the helper can plausibly arrive first
    for (let k = idx; k < snaps.length; k += 3) {
      const s = snaps[k];
      if (!s.grounded) continue;
      const p = new THREE.Vector3(s.position[0], s.position[1], s.position[2]);
      const from = g.graph.nearest(start.x, start.y, start.z);
      const to = g.graph.nearest(p.x, p.y, p.z);
      const travel = g.graph.pathLength(g.graph.path(from, to)) / speed + 1.2;
      if (travel < s.t - 0.5 || k > idx + 120) {
        const z = zoneAt(p.x, p.y, p.z);
        const key = `${Math.round(p.x)}:${Math.round(p.z)}`;
        if (used.has(key)) return;
        used.add(key);
        missions.push({ point: p, arriveAt: s.t, zone: z?.id ?? "", role: a.role });
        start.copy(p);
        return;
      }
    }
  };
  tryZone(a.zones[0] ?? null, a.fallbackProgress);
  if (a.zones[1]) tryZone(a.zones[1], Math.min(0.95, a.fallbackProgress + 0.25));
  missions.sort((m1, m2) => m1.arriveAt - m2.arriveAt);
  return missions;
}

/** HUNT → HUNT_COMPLETE → RESULTS */
export function registerHuntFlow(g: Game): void {
  let t = 0;
  let started = false;
  let outcomeT = 0;
  // Recorded hisses/pounces Past You is about to replay (for its tells).
  let tells: Array<{ t: number; kind: "hiss" | "pounce" }> = [];
  let tellIdx = 0;

  g.fsm.register(GameState.HUNT, {
    enter: () => {
      const replay = g.replay;
      if (!replay) throw new Error("HUNT without a recording");
      // The hunter is never the thief (that cat is Past You).
      const hunterId = g.hunterId && g.hunterId !== g.runnerId ? g.hunterId : g.otherIds()[0];
      g.hunterId = hunterId;
      g.setPaused(false);
      g.resetWorld();
      g.round = 2;
      g.huntSuccess = false;
      g.huntStats = { perfectHisses: 0, interceptAttempts: 0, stolenAt: null, echoPerfectHisses: 0 };
      g.history.clear();
      const hunter = g.actors[hunterId];
      const pastYou = g.runner;
      // Past You
      pastYou.mode = "replay";
      pastYou.team = 0;
      g.echo.bind(pastYou);
      g.echo.load(replay);
      g.echo.prime();
      tells = replay.events
        .filter((e) => e.type === "hiss" || e.type === "pounce")
        .map((e) => ({ t: e.t, kind: e.type as "hiss" | "pounce" }))
        .sort((x, y) => x.t - y.t);
      tellIdx = 0;
      g.echo.setEchoLook(true);
      // Hunter
      for (const c of g.others()) c.team = 1;
      hunter.mode = "player";
      g.brains[hunterId].enabled = false;
      hunter.setForcedAction(null);
      const hs = SPAWN.hunters[hunterId];
      hunter.teleport(new THREE.Vector3(...hs.pos), hs.yaw);
      g.controlled = hunter;
      // Allies (the two cats that are neither thief nor hunter) take the
      // Alley Council's roles.
      const plan = g.plan ?? heuristicPlan(g.telemetry.summary());
      g.plan = plan;
      const allies = g.others().filter((c) => c !== hunter);
      for (const a of castAssignments(plan, allies.map((c) => c.id))) {
        const brain = g.brains[a.cat];
        brain.enabled = true;
        const ally = g.actors[a.cat];
        const s = SPAWN.hunters[a.cat];
        ally.teleport(new THREE.Vector3(...s.pos), s.yaw);
        ally.setForcedAction(null);
        brain.echoTime = () => g.echo.time;
        brain.setMissions(planMissions(g, a, replay));
        g.debug?.log(`${a.cat} (${a.role}) missions: ${brain.missions.map((m) => `${m.zone}@${m.arriveAt.toFixed(1)}s`).join(", ")}`);
      }
      // Rules
      g.fish.reservedFor = pastYou;
      g.fish.canPickup = (c) => c === pastYou || c === hunter;
      g.fish.pickupGrip = (c, fromTable) => (c === pastYou ? (fromTable ? 3 : 1) : 3);
      g.combat.rules = {
        gripFloor: (attacker) => (attacker === hunter ? 0 : 1),
        isLocal: (c) => c === hunter,
      };
      g.echo.onEvent = (ev) => {
        const a = pastYou;
        const id = pastYou.id;
        const p = a.position;
        switch (ev.type) {
          case "jump":
            a.animator.takeoff();
            g.bus.emit("jump", { cat: id, x: p.x, y: p.y, z: p.z });
            break;
          case "pounce": {
            const dir = new THREE.Vector3(ev.payload?.dirX ?? Math.sin(a.yaw), 0, ev.payload?.dirZ ?? Math.cos(a.yaw));
            a.abilities.forcePounce(dir);
            g.bus.emit("pounceStart", { cat: id, dirX: dir.x, dirZ: dir.z, x: p.x, y: p.y, z: p.z });
            break;
          }
          case "hiss": {
            const dir = new THREE.Vector3(ev.payload?.dirX ?? Math.sin(a.yaw), 0, ev.payload?.dirZ ?? Math.cos(a.yaw));
            a.abilities.forceHiss(dir);
            g.bus.emit("hissStart", { cat: id, dirX: dir.x, dirZ: dir.z, x: p.x, y: p.y, z: p.z });
            break;
          }
          case "interact":
            if (ev.payload?.target) g.interactables.trigger(ev.payload.target, a, g.interactHooks(a), g.effects, g.bus);
            break;
          case "fishPickup":
            if (g.fish.state === "table") {
              g.fish.reservedFor = null;
              g.fish.pickup(a);
            }
            break;
          default:
            break;
        }
      };
      // Presentation
      g.hud.setRound(2);
      g.hud.setEchoColor(CATS[g.runnerId].colors.main);
      g.hud.clearAlerts();
      g.hud.show(true);
      const dur = Math.max(0.001, replay.duration);
      g.hud.setTimelineEvents([
        ...replay.events.filter((e) => e.type === "hiss").map((e) => ({ at: e.t / dur, kind: "hiss" as const })),
        ...replay.events.filter((e) => e.type === "pounce").map((e) => ({ at: e.t / dur, kind: "pounce" as const })),
      ]);
      g.stamps.clear(false);
      g.stamps.show(`HUNT PAST YOU`, "hunt", true, "Past You replays your exact run. Press R to sniff out where it goes next.");
      g.audio.play("stamp", { volume: 0.5 });
      g.audio.setMusic("round2");
      g.audio.setTemporalHum(true);
      g.lighting.temporalBlend = 1;
      g.renderer.temporalUniforms.uEdge.value = 0.35;
      g.renderer.temporalUniforms.uFreeze.value = 0;
      g.temporalVignette.classList.add("show");
      g.camera.snapBehind(hunter.yaw, hunter.position.clone().setY(hunter.position.y + 0.78));
      g.camera.pitch = 0.14;
      g.camera.distance = 3.9;
      g.input.requestPointerLock();
      hunter.meow();
      t = 0;
      started = false;
      g.huntTime = 0;
    },
    update: (realDt) => {
      t += realDt;
      const hunter = g.controlled;
      if (!hunter) return;
      if (!started) {
        // brief beat: Past You is lined up at the market, then GO
        hunter.updateScripted(realDt);
        g.echo.update(0, g.time.realTime);
        g.updateHUD();
        g.updateFollowCamera(realDt);
        if (t > HUNT_INTRO) {
          started = true;
          g.stamps.clear();
          g.echo.start();
          g.history.tick(0, true);
        }
        return;
      }
      const dt = g.time.simDt;
      if (dt > 0) {
        g.huntTime += dt;
        // Telegraph recorded actions just before Past You replays them, the
        // same "!" language the rivals use in Round 1.
        while (tellIdx < tells.length && tells[tellIdx].t - g.echo.time <= ECHO_TELL_LEAD) {
          const tell = tells[tellIdx++];
          const p = g.runner.position;
          if (tell.t < g.echo.time || p.distanceTo(hunter.position) > 9) continue;
          if (tell.kind === "pounce") {
            g.bus.emit("pounceTell", { cat: g.runnerId, x: p.x, y: p.y, z: p.z });
          } else {
            g.effects.exclaim(p);
            g.audio.play("tell", { at: p, volume: 0.35 });
          }
        }
        g.simulate(dt, 2);
        g.history.tick(g.huntTime);
        if (g.fish.owner === hunter) {
          g.huntSuccess = true;
          g.huntStats.stolenAt = g.echo.time;
          g.fsm.transition(GameState.HUNT_COMPLETE);
          return;
        }
        if (g.echo.finished && g.fish.owner === g.runner) {
          g.huntSuccess = false;
          g.fsm.transition(GameState.HUNT_COMPLETE);
          return;
        }
      }
      g.updateHUD();
      g.updateFollowCamera(realDt);
    },
    exit: () => {
      g.stamps.clear();
    },
  });

  g.fsm.register(GameState.HUNT_COMPLETE, {
    enter: () => {
      outcomeT = 0;
      g.input.exitPointerLock();
      g.hud.setPrompt(null);
      g.history.tick(g.huntTime, true);
      const hunter = g.controlled!;
      if (g.huntSuccess) {
        if (g.huntStats.stolenAt !== null) recordSteal(g.huntStats.stolenAt);
        g.echo.stop();
        g.time.slowMo(1.2, 0.35);
        hunter.setForcedAction("victory");
        hunter.meow();
        g.audio.play("victory", { volume: 0.6 });
        g.audio.setTemporalHum(false);
        // Past You's timeline shatters into sea-glass motes
        g.effects.motes(g.runner.position, 60, 1.2);
        g.effects.sparkle(g.runner.center(), 30, 0x7ff3dc, 4, 1);
        g.alert("TIMELINE BROKEN!", "perfect");
      } else {
        g.runner.meow();
        g.audio.play("fail", { volume: 0.5 });
        g.time.slowMo(0.8, 0.5);
      }
      g.audio.duckMusic(3);
    },
    update: (realDt) => {
      outcomeT += realDt;
      const dt = g.time.simDt;
      const hunter = g.controlled!;
      if (g.huntSuccess) {
        hunter.updateScripted(dt);
        const past = g.runner.rig.root;
        if (outcomeT > 0.35) past.visible = outcomeT < 0.4 ? true : Math.sin(outcomeT * 40) > 0 && outcomeT < 1.0;
        if (outcomeT > 1.0) past.visible = false;
        g.updateFollowCamera(realDt);
      } else {
        g.runner.setForcedAction("victory");
        g.runner.updateScripted(dt);
        const p = g.runner.position;
        g.camera.setCinematic(new THREE.Vector3(p.x - 2.4, p.y + 1.6, p.z + 3.4), new THREE.Vector3(p.x, p.y + 0.5, p.z), 2.2);
        g.camera.update(realDt, null, null);
      }
      g.fish.update(dt, [], g.time.simTime);
      if (outcomeT > 2.3) g.fsm.transition(GameState.RESULTS);
    },
  });

  g.fsm.register(GameState.RESULTS, {
    enter: () => {
      // One full Round 1 + Round 2 cycle: Choose Your Thief unlocks.
      g.completeCycle();
      g.hud.show(false);
      g.audio.setMusic("menu");
      g.audio.setTemporalHum(false);
      const runT = g.replay?.duration ?? 0;
      const rows: Array<[string, string]> = g.huntSuccess
        ? [
            ["FISH RUN", formatClock(runT)],
            ["FISH STOLEN AT", formatClock(g.huntStats.stolenAt ?? 0)],
            ["PERFECT HISSES", String(g.huntStats.perfectHisses)],
            ["HUNTER", g.hunterId ? CATS[g.hunterId].title : "—"],
          ]
        : [
            ["FISH RUN", formatClock(runT)],
            ["HUNT ENDED", formatClock(g.echo.time)],
            ["INTERCEPT ATTEMPTS", String(g.huntStats.interceptAttempts)],
            ["PAST YOU'S PERFECT HISSES", String(g.huntStats.echoPerfectHisses)],
          ];
      g.results.show({ success: g.huntSuccess, rows });
    },
    update: (dt) => {
      g.camera.update(dt, null, null);
      if (g.controlled) g.controlled.updateScripted(dt);
      g.runner.updateScripted(dt);
    },
    exit: () => {
      g.results.show(null);
      g.runner.rig.root.visible = true;
      g.renderer.temporalUniforms.uEdge.value = 0;
      g.lighting.temporalBlend = 0;
    },
  });
}
