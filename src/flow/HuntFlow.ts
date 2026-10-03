import * as THREE from "three";
import { CATS } from "../data/cats";
import { SPAWN } from "../data/level";
import { PALETTE } from "../data/palette";
import type { Game } from "../core/Game";
import { GameState } from "../core/GameState";
import { formatClock } from "../core/math";
import type { Mission } from "../cats/CatAI";
import { Coordinator, type CoordMission } from "../ai/Coordinator";
import { agentFor, planForAllies } from "../ai/TacticalPlanner";
import { recordSteal } from "../ui/records";
import { MAX_GRIP } from "../fish/FishGrip";

const HUNT_INTRO = 1.2;
/** What Past You is doing again when it replays a recorded interaction. */
const ECHO_DEEDS: Record<string, string> = {
  trashCan: "KNOCKED OVER THE TRASH CAN",
  pigeonFeed: "SPILLED THE PIGEON FEED",
  bottle: "KICKED THE BOTTLE",
  laundry: "DROPPED THE LAUNDRY",
  fishScraps: "SPILLED THE FISH SCRAPS",
};
/** Past You flashes its "!" this long before replaying a hiss or pounce. */
const ECHO_TELL_LEAD = 0.3;

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
      // Allies (the two cats that are neither thief nor hunter) execute the
      // council's strategy: re-planned for exactly these two cats, then run
      // by the Multi-Agent Coordinator with discrete re-planning.
      const allies = g.others().filter((c) => c !== hunter);
      const allyAgents = allies.map((c) => agentFor(c.id));
      const coord = g.trace ? new Coordinator(g.trace, g.graph) : null;
      g.coordinator = coord;
      const missions: CoordMission[] =
        coord && g.trace && g.plan ? coord.start(planForAllies(g.trace, g.graph, allyAgents, g.fingerprint, g.plan.strategyId), allyAgents) : [];
      const toMission = (m: CoordMission): Mission => ({ point: new THREE.Vector3(...m.point), arriveAt: m.arriveAt, zone: m.zone, role: m.role, prop: m.prop });
      for (const ally of allies) {
        const brain = g.brains[ally.id];
        brain.enabled = true;
        const s = SPAWN.hunters[ally.id];
        ally.teleport(new THREE.Vector3(...s.pos), s.yaw);
        ally.setForcedAction(null);
        brain.echoTime = () => g.echo.time;
        const m = missions.find((x) => x.cat === ally.id);
        brain.setMissions(m ? [toMission(m)] : []);
        brain.onMissionEnded = (b) => {
          const next = coord?.missionEnded(b.id, b.actor.position, g.echo.time);
          if (next) b.setMissions([toMission(next)]);
        };
        brain.onTrap = (cat, prop) => g.trapPastYou(cat, prop);
        g.debug?.log(`${ally.id}: ${m ? `${m.role} at ${m.zone} (${m.arriveAt.toFixed(1)}s)` : "shadow"}`);
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
          case "interact": {
            const target = ev.payload?.target;
            if (target && g.interactables.trigger(target, a, g.interactHooks(a), g.effects, g.bus)) {
              // "...wait, I did that."
              g.alert(`PAST YOU ${ECHO_DEEDS[target] ?? "STRUCK AGAIN"}`, "info");
              const it = g.interactables.get(target as Parameters<typeof g.interactables.get>[0]);
              if (it) g.effects.ring(it.position.clone().setY(it.position.y + 0.05), 1.8, PALETTE.seaGlass, 0.6);
            }
            break;
          }
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
      // a handful of real numbers from both rounds (no analytics clutter)
      const runT = g.replay?.duration ?? 0;
      const s = g.runSummary;
      const route = !s
        ? "—"
        : s.routeChoice.awningShortcut && s.routeChoice.rooftopShortcut
          ? "BOTH SHORTCUTS"
          : s.routeChoice.awningShortcut
            ? "AWNING SHORTCUT"
            : s.routeChoice.rooftopShortcut
              ? "LOW-ROOF SHORTCUT"
              : "STREET ROUTE";
      const plan = g.plan?.strategyName ?? "—";
      const thief = CATS[g.runnerId].name.toUpperCase();
      const hunter = g.hunterId ? CATS[g.hunterId].name.toUpperCase() : "—";
      const stolenAt = g.huntStats.stolenAt ?? 0;
      const rows: Array<[string, string]> = g.huntSuccess
        ? [
            ["FISH RUN", formatClock(runT)],
            ["ROUTE", route],
            ["COUNCIL PLAN", plan],
            ["FISH STOLEN AT", formatClock(stolenAt)],
            ["PERFECT HISSES", String((s?.perfectHisses ?? 0) + g.huntStats.perfectHisses)],
            ["PROPS USED", String(s?.interactions.length ?? 0)],
          ]
        : [
            ["FISH RUN", formatClock(runT)],
            ["ROUTE", route],
            ["COUNCIL PLAN", plan],
            ["PAST YOU'S GRIP LEFT", `${g.fish.grip.value} / ${MAX_GRIP}`],
            ["INTERCEPT ATTEMPTS", String(g.huntStats.interceptAttempts)],
            ["PAST YOU'S PERFECT HISSES", String(g.huntStats.echoPerfectHisses)],
          ];
      g.results.show({
        success: g.huntSuccess,
        rows,
        subtitle: `AS ${hunter} · VS PAST ${thief}`,
        share: {
          success: g.huntSuccess,
          headline: g.huntSuccess ? `I STOLE A FISH FROM MYSELF IN ${stolenAt.toFixed(1)} SECONDS.` : `PAST ME OUTRAN ME IN ${runT.toFixed(1)} SECONDS.`,
          facts: [`FISH RUN ${formatClock(runT)} · ${route}`, `THE ALLEY COUNCIL PLAYED ${plan}`, `HUNTED AS ${hunter} · PAST ${thief} RAN`],
          cat: g.hunterId,
        },
      });
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
