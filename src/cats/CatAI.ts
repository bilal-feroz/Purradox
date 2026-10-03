import * as THREE from "three";
import type { RivalId } from "../data/cats";
import { SOOT_AMBUSH, SPAWN, type V3 } from "../data/level";
import { Random } from "../core/Random";
import type { FishSystem } from "../fish/Fish";
import type { NavNode, WaypointGraph } from "../level/WaypointGraph";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { CatActor } from "./CatActor";

export type AIState =
  | "IDLE"
  | "NOTICE"
  | "CHASE"
  | "INTERCEPT"
  | "POUNCE"
  | "RECOVER"
  | "DISTRACTED"
  | "FISH_CHASE"
  | "ESCAPE_WITH_FISH"
  | "AMBUSH"
  | "RETURN"
  | "MISSION";

export interface AIWorld {
  round: 1 | 2;
  graph: WaypointGraph;
  physics: PhysicsWorld;
  fish: FishSystem;
  /** The cat this brain hunts: Fish Cat (R1) or Past You (R2). */
  quarry: CatActor;
  /** Index (1..8) of the zone the quarry is in. */
  quarryZone: number;
  /** Whether rivals may pick up the fish this round. */
  rivalsMayCarry: boolean;
  /** Predict the quarry's position `ahead` seconds into the future. */
  predict: (ahead: number, out: THREE.Vector3) => THREE.Vector3;
}

export interface Mission {
  point: THREE.Vector3;
  /** Replay time Past You passes the point (R2). */
  arriveAt: number;
  zone: string;
  role: "pressure" | "ambush" | "chaos";
}

interface Personality {
  chaseSprint: boolean;
  pounceRange: number;
  pounceChance: number;
  pounceCooldown: number;
  leash: number;
  maxZone: number;
  hissBackChance: number;
  notice: number;
  speedR1: number;
  aimError: number;
}

const PERSONALITY: Record<RivalId, Personality> = {
  mochi: { chaseSprint: true, pounceRange: 3.3, pounceChance: 0.9, pounceCooldown: 2.4, leash: 34, maxZone: 4, hissBackChance: 0.12, notice: 0.45, speedR1: 0.9, aimError: 0.16 },
  soot: { chaseSprint: true, pounceRange: 4.4, pounceChance: 0.85, pounceCooldown: 3.0, leash: 18, maxZone: 6, hissBackChance: 0.4, notice: 0.25, speedR1: 0.9, aimError: 0.12 },
  beans: { chaseSprint: true, pounceRange: 2.9, pounceChance: 0.55, pounceCooldown: 2.6, leash: 22, maxZone: 8, hissBackChance: 0.22, notice: 0.3, speedR1: 0.92, aimError: 0.34 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _knee2 = new THREE.Vector3();

/**
 * Deterministic real-time rival brain. Movement uses the character
 * controller on walk edges and scripted arcs on jump/drop links of the
 * authored waypoint graph; behavior is an explicit state machine.
 */
export class RivalBrain {
  state: AIState = "IDLE";
  stateT = 0;
  private path: NavNode[] = [];
  private pathIdx = 0;
  private repathT = 0;
  private stuckT = 0;
  private readonly lastProgress = new THREE.Vector3();
  private readonly home: THREE.Vector3;
  private readonly homeYaw: number;
  private readonly rng: Random;
  private ambushIndex = 0;
  private pounceTimer = 0;
  private distractPoint = new THREE.Vector3();
  private distractKind: "scraps" | "pigeons" | "noise" | "laundry" = "noise";
  private distractT = 0;
  private wanderTarget: THREE.Vector3 | null = null;
  private wanderT = 0;
  readonly missions: Mission[] = [];
  private missionIdx = 0;
  private missionDone = false;
  private escapeGoal: NavNode | null = null;
  readonly p: Personality;
  /** Debug: current navigation target. */
  readonly goal = new THREE.Vector3();
  enabled = true;
  /** In Round 2 helpers may not drop grip below this. */
  helper = false;
  private sawPickup = false;
  private interactCooldown = 0;
  onWantInteract: ((cat: CatActor) => void) | null = null;

  constructor(
    readonly id: RivalId,
    readonly actor: CatActor,
    seed: number,
  ) {
    this.p = PERSONALITY[id];
    const s = SPAWN.rivals[id];
    this.home = new THREE.Vector3(...s.pos);
    this.homeYaw = s.yaw;
    this.rng = new Random(seed);
  }

  reset(): void {
    this.state = "IDLE";
    this.stateT = 0;
    this.path = [];
    this.pathIdx = 0;
    this.repathT = 0;
    this.stuckT = 0;
    this.ambushIndex = 0;
    this.pounceTimer = 1.5;
    this.distractT = 0;
    this.wanderTarget = null;
    this.missions.length = 0;
    this.missionIdx = 0;
    this.missionDone = false;
    this.escapeGoal = null;
    this.sawPickup = false;
    this.helper = false;
    this.enabled = true;
    this.echoTime = null;
    this.interactCooldown = 0;
    this.lastProgress.copy(this.home);
    this.actor.teleport(this.home, this.homeYaw);
    this.actor.setForcedAction(this.id === "soot" ? "crouch" : "sit");
  }

  setMissions(ms: Mission[]): void {
    this.missions.length = 0;
    this.missions.push(...ms);
    this.missionIdx = 0;
    this.missionDone = false;
    this.helper = true;
    this.go("MISSION");
  }

  distract(seconds: number, point: THREE.Vector3, kind: "scraps" | "pigeons" | "noise" | "laundry"): void {
    if (this.state === "ESCAPE_WITH_FISH") return;
    this.distractT = seconds;
    this.distractPoint.copy(point);
    this.distractKind = kind;
    this.actor.setForcedAction(null);
    this.go("DISTRACTED");
  }

  private go(s: AIState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = [];
    this.repathT = 0;
    if (s !== "AMBUSH" && s !== "IDLE" && this.actor.forcedAction !== null && this.actor.forcedAction !== "eat") this.actor.setForcedAction(null);
  }

  // ------------------------------------------------------------------ update
  update(dt: number, w: AIWorld): void {
    const a = this.actor;
    a.intent.moveX = 0;
    a.intent.moveZ = 0;
    a.intent.sprint = false;
    a.intent.jump = false;
    a.wantPounce = false;
    a.wantHiss = false;
    if (!this.enabled || !a.active) return;
    this.stateT += dt;
    this.pounceTimer -= dt;
    this.interactCooldown -= dt;
    a.speedScale = w.round === 1 ? this.p.speedR1 : 1;
    if (a.movement.inArc) return;
    if (a.staggerT > 0 || a.tangledT > 0) return;

    const q = w.quarry;
    const fish = w.fish;
    const distQ = Math.hypot(q.position.x - a.position.x, q.position.z - a.position.z);
    a.lookTarget = distQ < 12 ? q.center(_knee2) : null;

    // Hissed at: back away for the hesitation window.
    if (a.hesitateT > 0) {
      _v.subVectors(a.position, q.position).setY(0).normalize();
      a.intent.moveX = _v.x * 0.6;
      a.intent.moveZ = _v.z * 0.6;
      return;
    }

    // React to a pounce aimed at us with a hiss (personality-based).
    if (q.abilities.pounceState === "windup" || (q.abilities.pounceState === "active" && q.abilities.pounceT < 0.08)) {
      const d = distQ;
      if (d < 3.6 && a.abilities.hissReady && a.canAct && this.rng.chance(this.p.hissBackChance * dt * 60 * 0.08)) {
        a.hissAim.subVectors(q.position, a.position).setY(0).normalize();
        a.wantHiss = true;
      }
    }

    // Fish priorities (Round 1 rivals may carry the fish)
    if (w.rivalsMayCarry && fish.owner === a && this.state !== "ESCAPE_WITH_FISH") this.go("ESCAPE_WITH_FISH");
    if (w.rivalsMayCarry && (fish.state === "loose" || fish.state === "flying") && this.state !== "DISTRACTED") {
      const df = a.position.distanceTo(fish.position);
      if (df < 16 && this.state !== "FISH_CHASE") this.go("FISH_CHASE");
    }
    if (this.state === "FISH_CHASE" && fish.state !== "loose" && fish.state !== "flying") this.go("CHASE");

    switch (this.state) {
      case "IDLE":
        this.updateIdle(dt, w, distQ);
        break;
      case "NOTICE":
        a.setForcedAction(null);
        a.lookTarget = q.center(_knee2);
        this.faceToward(q.position);
        if (this.stateT > this.p.notice) this.go(this.id === "soot" ? "AMBUSH" : "CHASE");
        break;
      case "CHASE":
      case "INTERCEPT":
        this.updateChase(dt, w, distQ);
        break;
      case "RECOVER":
        if (this.stateT > 0.45) this.go("CHASE");
        break;
      case "AMBUSH":
        this.updateAmbush(dt, w, distQ);
        break;
      case "DISTRACTED":
        this.updateDistracted(dt, w);
        break;
      case "FISH_CHASE":
        this.moveTo(fish.position, dt, w, true);
        break;
      case "ESCAPE_WITH_FISH":
        this.updateEscape(dt, w);
        break;
      case "RETURN":
        if (this.moveTo(this.home, dt, w, false) < 1.0) {
          this.go("IDLE");
          a.setForcedAction(this.id === "soot" ? "crouch" : "sit");
        }
        if (distQ < 7 && w.quarryZone <= this.p.maxZone) this.go("CHASE");
        break;
      case "MISSION":
        this.updateMission(dt, w, distQ);
        break;
      case "POUNCE":
        if (a.abilities.pounceState === "idle") this.go("RECOVER");
        break;
    }
  }

  private updateIdle(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    const fish = w.fish;
    if (w.round === 2) return;
    const qCarrying = fish.owner === w.quarry;
    if (qCarrying && !this.sawPickup) this.sawPickup = true;
    if (this.id === "mochi") {
      if ((this.sawPickup && distQ < 26) || distQ < 7) this.go("NOTICE");
    } else if (this.id === "soot") {
      if (this.sawPickup && w.quarryZone >= 3) this.go("AMBUSH");
    } else {
      // Beans: wanders the rooftops looking for trouble
      if (this.sawPickup && (w.quarryZone >= 5 || distQ < 14)) this.go("CHASE");
      else this.wander(dt, w, 6);
    }
    void a;
  }

  private wander(dt: number, w: AIWorld, radius: number): void {
    const a = this.actor;
    this.wanderT -= dt;
    if (!this.wanderTarget || this.wanderT <= 0) {
      this.wanderT = this.rng.range(2.5, 5);
      const n = w.graph.nearest(this.home.x + this.rng.range(-radius, radius), this.home.y, this.home.z + this.rng.range(-radius, radius), 1.0);
      this.wanderTarget = new THREE.Vector3(n.x, n.y, n.z);
      if (a.forcedAction) a.setForcedAction(null);
    }
    const d = this.moveTo(this.wanderTarget, dt, w, false, 0.45);
    if (d < 0.8) {
      a.intent.moveX = 0;
      a.intent.moveZ = 0;
      if (this.rng.chance(dt * 0.6)) a.intent.jump = true;
    }
  }

  private updateChase(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    const q = w.quarry;
    // leash
    if (w.round === 1 && (distQ > this.p.leash || w.quarryZone > this.p.maxZone)) {
      if (this.id === "soot") this.go("AMBUSH");
      else if (this.id === "beans") {
        if (distQ > this.p.leash * 1.6) this.go("RETURN");
      } else this.go("RETURN");
      return;
    }
    const lead = Math.min(0.6, distQ / 9);
    w.predict(lead, _p);
    // Beans orbits instead of charging straight in.
    if (this.id === "beans" && distQ < 6 && distQ > 2.4) {
      const ang = Math.atan2(a.position.x - q.position.x, a.position.z - q.position.z) + dt * 2.2;
      _p.set(q.position.x + Math.sin(ang) * 3.2, q.position.y, q.position.z + Math.cos(ang) * 3.2);
    }
    this.moveTo(_p, dt, w, this.p.chaseSprint || distQ > 6);
    this.tryPounce(w, distQ);
    // Beans plays with props near the action
    if (this.id === "beans" && this.interactCooldown <= 0 && this.rng.chance(dt * 0.4)) {
      this.interactCooldown = 4;
      this.onWantInteract?.(a);
    }
  }

  private tryPounce(w: AIWorld, distQ: number): boolean {
    const a = this.actor;
    const q = w.quarry;
    if (this.pounceTimer > 0 || !a.abilities.pounceReady || !a.canAct || !a.grounded) return false;
    if (distQ > this.p.pounceRange || Math.abs(q.position.y - a.position.y) > 0.7) return false;
    if (q.staggerT > 0.1) return false;
    _knee.copy(a.position).setY(a.position.y + 0.45);
    _w.copy(q.position).setY(q.position.y + 0.45);
    if (!w.physics.lineOfSight(_knee, _w)) return false;
    this.pounceTimer = this.p.pounceCooldown * (w.round === 2 ? 0.8 : 1) + this.rng.range(-0.3, 0.4);
    if (!this.rng.chance(this.p.pounceChance)) return false;
    const travel = distQ / Math.max(1, a.stats.pounceSpeed);
    w.predict(travel + 0.08, _p);
    a.pounceAim.subVectors(_p, a.position).setY(0);
    if (a.pounceAim.lengthSq() < 1e-4) a.pounceAim.copy(a.forward());
    a.pounceAim.normalize();
    const err = (this.rng.next() - 0.5) * 2 * this.p.aimError * (w.round === 1 ? 1 : 0.6);
    a.pounceAim.applyAxisAngle(new THREE.Vector3(0, 1, 0), err);
    a.wantPounce = true;
    this.go("POUNCE");
    return true;
  }

  private updateAmbush(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    // pick the next ambush spot ahead of the quarry
    while (this.ambushIndex < SOOT_AMBUSH.length - 1 && this.spotPassed(SOOT_AMBUSH[this.ambushIndex], w)) this.ambushIndex++;
    const spot = SOOT_AMBUSH[this.ambushIndex];
    _v.set(spot[0], spot[1], spot[2]);
    const d = this.moveTo(_v, dt, w, distQ > 10, 0.6);
    if (d < 0.9) {
      a.intent.moveX = 0;
      a.intent.moveZ = 0;
      if (a.forcedAction !== "crouch") a.setForcedAction("crouch");
      this.faceToward(w.quarry.position);
    }
    if (distQ < 6.5 && Math.abs(w.quarry.position.y - a.position.y) < 0.8) {
      a.setForcedAction(null);
      if (!this.tryPounce(w, distQ) && distQ < 4.2) this.go("CHASE");
    }
    if (this.spotPassed(spot, w) && this.ambushIndex >= SOOT_AMBUSH.length - 1 && distQ > 10) {
      a.setForcedAction(null);
      this.go("RETURN");
    }
  }

  private spotPassed(spot: V3, w: AIWorld): boolean {
    // A spot counts as passed when the quarry is further along the route.
    const zoneOf = (s: V3): number => (s[1] >= 4.9 ? 6 : s[1] >= 3.4 ? 5 : 4);
    return w.quarryZone > zoneOf(spot);
  }

  private updateDistracted(dt: number, w: AIWorld): void {
    const a = this.actor;
    this.distractT -= dt;
    a.lookTarget = this.distractPoint;
    if (this.distractKind === "scraps") {
      const d = this.moveTo(this.distractPoint, dt, w, true, 0.5);
      if (d < 0.9) {
        a.intent.moveX = 0;
        a.intent.moveZ = 0;
        this.faceToward(this.distractPoint);
        if (a.forcedAction !== "eat") a.setForcedAction("eat");
      }
    } else if (this.distractKind === "pigeons") {
      if (this.stateT < 0.6) this.faceToward(this.distractPoint);
      else if (this.rng.chance(dt * 1.5)) a.intent.jump = true;
      const d = Math.hypot(this.distractPoint.x - a.position.x, this.distractPoint.z - a.position.z);
      if (d > 2.5 && this.stateT > 0.5) this.moveTo(this.distractPoint, dt, w, false, 0.55);
    } else {
      this.faceToward(this.distractPoint);
      if (this.stateT > 0.4) this.moveTo(this.distractPoint, dt, w, false, 0.4);
    }
    if (this.distractT <= 0) {
      if (a.forcedAction === "eat") a.setForcedAction(null);
      this.go(this.helper ? "MISSION" : this.id === "soot" ? "AMBUSH" : "CHASE");
    }
  }

  private updateEscape(dt: number, w: AIWorld): void {
    const a = this.actor;
    const q = w.quarry;
    if (w.fish.owner !== a) {
      this.go("CHASE");
      return;
    }
    a.lookTarget = null;
    if (!this.escapeGoal || this.stateT > 3 || Math.hypot(this.escapeGoal.x - a.position.x, this.escapeGoal.z - a.position.z) < 1.2) {
      this.stateT = 0;
      // farthest node from the player within reach
      let best: NavNode | null = null;
      let bestScore = -Infinity;
      for (const n of w.graph.nodes.values()) {
        const dSelf = Math.hypot(n.x - a.position.x, n.z - a.position.z);
        if (dSelf > 16 || Math.abs(n.y - a.position.y) > 2) continue;
        const score = Math.hypot(n.x - q.position.x, n.z - q.position.z) - dSelf * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      this.escapeGoal = best;
    }
    if (this.escapeGoal) {
      _v.set(this.escapeGoal.x, this.escapeGoal.y, this.escapeGoal.z);
      this.moveTo(_v, dt, w, false);
      a.speedScale *= 0.94;
    }
  }

  private updateMission(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    const q = w.quarry;
    if (this.missionIdx >= this.missions.length) {
      // out of missions: shadow Past You at a distance
      if (distQ < 9) this.updateChase(dt, w, distQ);
      else this.moveTo(q.position, dt, w, true);
      return;
    }
    const m = this.missions[this.missionIdx];
    const echoT = this.echoTime?.() ?? 0;
    const passed = echoT > m.arriveAt + 2.2;
    if (passed || this.missionDone) {
      this.missionIdx++;
      this.missionDone = false;
      a.setForcedAction(null);
      return;
    }
    const d = this.moveTo(m.point, dt, w, true, 0.6);
    if (d < 1.0) {
      a.intent.moveX = 0;
      a.intent.moveZ = 0;
      if (m.role === "ambush" && a.forcedAction !== "crouch") a.setForcedAction("crouch");
      this.faceToward(q.position);
    }
    if (distQ < 5.5 && Math.abs(q.position.y - a.position.y) < 0.8) {
      a.setForcedAction(null);
      if (this.tryPounce(w, distQ)) this.missionDone = true;
      else if (distQ < 3) this.moveTo(q.position, dt, w, true);
    }
  }

  /** Supplied by the game in Round 2 (current Past You replay time). */
  echoTime: (() => number) | null = null;

  private faceToward(p: THREE.Vector3): void {
    const a = this.actor;
    const want = Math.atan2(p.x - a.position.x, p.z - a.position.z);
    let d = want - a.movement.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.movement.yaw += d * 0.15;
  }

  /**
   * Steer toward a world point. Direct steering when on the same level with
   * line of sight, otherwise follow the waypoint graph (with scripted arcs on
   * jump/drop links). Returns the remaining horizontal distance.
   */
  private moveTo(target: THREE.Vector3, dt: number, w: AIWorld, sprint: boolean, speed = 1): number {
    const a = this.actor;
    this.goal.copy(target);
    const dx = target.x - a.position.x;
    const dz = target.z - a.position.z;
    const dist = Math.hypot(dx, dz);
    const dy = target.y - a.position.y;
    _knee.copy(a.position).setY(a.position.y + 0.4);
    _w.copy(target).setY(target.y + 0.4);
    const direct = Math.abs(dy) < 0.55 && dist < 14 && w.physics.lineOfSight(_knee, _w);
    if (direct) {
      this.path = [];
      if (dist > 0.05) {
        a.intent.moveX = (dx / dist) * speed;
        a.intent.moveZ = (dz / dist) * speed;
      }
      a.intent.sprint = sprint && dist > 2;
      this.checkStuck(dt, null);
      return dist;
    }
    this.repathT -= dt;
    if (this.path.length === 0 || this.repathT <= 0) {
      this.repathT = 0.7;
      const from = w.graph.nearest(a.position.x, a.position.y, a.position.z);
      const to = w.graph.nearest(target.x, target.y, target.z);
      this.path = w.graph.path(from, to);
      this.pathIdx = 0;
      // skip the first node if we're already past it toward the second
      if (this.path.length > 1) {
        const n0 = this.path[0];
        const n1 = this.path[1];
        const e = w.graph.edgeBetween(n0, n1);
        const d0 = Math.hypot(n0.x - a.position.x, n0.z - a.position.z);
        if (e && e.kind === "walk" && d0 < 2.5 && Math.abs(n0.y - a.position.y) < 0.6) this.pathIdx = 1;
      }
    }
    if (this.path.length === 0) {
      if (dist > 0.05) {
        a.intent.moveX = dx / dist;
        a.intent.moveZ = dz / dist;
      }
      return dist;
    }
    const node = this.path[Math.min(this.pathIdx, this.path.length - 1)];
    const ndx = node.x - a.position.x;
    const ndz = node.z - a.position.z;
    const nd = Math.hypot(ndx, ndz);
    const ndy = node.y - a.position.y;
    if (nd < 0.75 && Math.abs(ndy) < 0.9) {
      // arrived at node: next edge
      const next = this.path[this.pathIdx + 1];
      if (next) {
        const e = w.graph.edgeBetween(node, next);
        if (e && (e.kind === "jump" || e.kind === "drop")) {
          const up = next.y - node.y;
          const hd = Math.hypot(next.x - node.x, next.z - node.z);
          a.movement.launchArc(new THREE.Vector3(next.x, next.y, next.z), Math.max(0.45, up + 0.75), 0.32 + hd * 0.055 + Math.max(0, up) * 0.05);
        }
        this.pathIdx++;
      } else {
        this.path = [];
      }
      return dist;
    }
    a.intent.moveX = (ndx / Math.max(nd, 1e-3)) * speed;
    a.intent.moveZ = (ndz / Math.max(nd, 1e-3)) * speed;
    a.intent.sprint = sprint;
    this.checkStuck(dt, node);
    return dist;
  }

  private checkStuck(dt: number, node: NavNode | null): void {
    const a = this.actor;
    if (Math.hypot(a.intent.moveX, a.intent.moveZ) < 0.1) {
      this.stuckT = 0;
      this.lastProgress.copy(a.position);
      return;
    }
    if (a.position.distanceTo(this.lastProgress) > 0.45) {
      this.stuckT = 0;
      this.lastProgress.copy(a.position);
      return;
    }
    this.stuckT += dt;
    if (this.stuckT > 1.0) {
      this.stuckT = 0;
      this.lastProgress.copy(a.position);
      if (node && Math.hypot(node.x - a.position.x, node.z - a.position.z) < 5) {
        a.movement.launchArc(new THREE.Vector3(node.x, node.y, node.z), Math.max(0.6, node.y - a.position.y + 0.8), 0.45);
      } else {
        a.intent.jump = true;
        this.path = [];
      }
    }
  }
}
