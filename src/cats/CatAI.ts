import * as THREE from "three";
import { CATS, type Archetype, type CatId } from "../data/cats";
import { AMBUSH_SPOTS, ESCAPE_POINTS, SPAWN, type V3 } from "../data/level";
import { Random } from "../core/Random";
import type { GameEvents } from "../core/EventBus";
import type { FishSystem } from "../fish/Fish";
import type { NavNode, WaypointGraph } from "../level/WaypointGraph";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { AI_POUNCE_WINDUP } from "../player/CatAbilities";
import type { CatActor } from "./CatActor";
import type { RoleId } from "../ai/CounterfactualSimulator";

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
  | "SEARCH"
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
  role: RoleId;
  /** Environment trap: the prop to spring as Past You comes by. */
  prop?: string | null;
}

interface Personality {
  archetype: Archetype;
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
  /** How far away a loose fish pulls this cat off its plan (m). */
  fishSense: number;
  /** Vision range (m); the field of view is the same for every cat. */
  viewRange: number;
}

/** AI personalities by archetype (any cat that is not the thief uses its own). */
const PERSONALITY: Record<Archetype, Personality> = {
  // Mochi: fast direct pursuit, early pressure, frequent predictable pounces.
  sprinter: { archetype: "sprinter", chaseSprint: true, pounceRange: 3.3, pounceChance: 0.9, pounceCooldown: 2.4, leash: 34, maxZone: 4, hissBackChance: 0.12, notice: 0.45, speedR1: 0.9, aimError: 0.16, fishSense: 16, viewRange: 22 },
  // Soot: holds chokepoints and landing zones ahead of the thief.
  ambusher: { archetype: "ambusher", chaseSprint: true, pounceRange: 4.4, pounceChance: 0.85, pounceCooldown: 3.0, leash: 18, maxZone: 6, hissBackChance: 0.4, notice: 0.25, speedR1: 0.9, aimError: 0.12, fishSense: 16, viewRange: 24 },
  // Beans: props, distractions, odd routes, less direct pressure.
  chaos: { archetype: "chaos", chaseSprint: true, pounceRange: 2.9, pounceChance: 0.55, pounceCooldown: 2.6, leash: 22, maxZone: 8, hissBackChance: 0.22, notice: 0.3, speedR1: 0.92, aimError: 0.34, fishSense: 16, viewRange: 20 },
  // Fish Cat: balanced, shortcut-aware route cutter, first to any dropped fish.
  opportunist: { archetype: "opportunist", chaseSprint: true, pounceRange: 3.4, pounceChance: 0.72, pounceCooldown: 2.6, leash: 26, maxZone: 7, hissBackChance: 0.25, notice: 0.35, speedR1: 0.9, aimError: 0.2, fishSense: 26, viewRange: 22 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _knee = new THREE.Vector3();
/** Half field of view (radians): cats see ~130 degrees ahead. */
const HALF_FOV = (65 * Math.PI) / 180;
/** Within this range a cat senses the quarry in any direction. */
const AWARE_RADIUS = 3.5;
/** Seconds a cat keeps chasing a quarry it can no longer see or hear. */
const MEMORY = 2.5;
/** How loud (0..1) a sound must be before each archetype goes to investigate. */
const CURIOSITY: Record<Archetype, number> = { chaos: 0.15, opportunist: 0.3, sprinter: 0.45, ambusher: 0.65 };
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
  /** Where the current path leads (repath only when this moves). */
  private readonly pathTarget = new THREE.Vector3(1e9, 0, 0);
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
  /** Round 1: the escape point this cat is running for with the fish. */
  escapePoint: (typeof ESCAPE_POINTS)[number] | null = null;
  /** Set when this cat reached its escape point while holding the fish. */
  escaped = false;
  private readonly escapePos = new THREE.Vector3();
  readonly p: Personality;
  /** Debug: current navigation target. */
  readonly goal = new THREE.Vector3();
  enabled = true;
  /** In Round 2 helpers may not drop grip below this. */
  helper = false;
  private sawPickup = false;
  private interactCooldown = 0;
  // ---- perception: vision + short memory (never omniscient)
  /** Seconds since the quarry was last seen or heard. */
  seenT = 99;
  /** Where the quarry was when last perceived, and how it was moving. */
  readonly lastSeen = new THREE.Vector3();
  private readonly lastSeenVel = new THREE.Vector3();
  private visionT = 0;
  private visible = false;
  private searchLook = 0;
  /** Hearing: a brief look toward a sound. */
  private glanceT = 0;
  private readonly glancePoint = new THREE.Vector3();
  private lastDistQ = 99;
  onWantInteract: ((cat: CatActor) => void) | null = null;
  /** Round 2: this ally finished its intercept; the coordinator re-plans. */
  onMissionEnded: ((brain: RivalBrain) => void) | null = null;
  private time = 0;
  private lastYowl = -Infinity;
  /** Round 2: spring an environment trap on Past You. */
  onTrap: ((cat: CatActor, prop: string) => void) | null = null;

  constructor(
    readonly id: CatId,
    readonly actor: CatActor,
    seed: number,
  ) {
    this.p = PERSONALITY[CATS[id].archetype];
    const s = SPAWN.ai[id];
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
    this.escapePoint = null;
    this.escaped = false;
    this.glanceT = 0;
    this.lastDistQ = 99;
    this.seenT = 99;
    this.visionT = 0;
    this.visible = false;
    this.sawPickup = false;
    this.helper = false;
    this.enabled = true;
    this.echoTime = null;
    this.onMissionEnded = null;
    this.onTrap = null;
    this.interactCooldown = 0;
    this.lastProgress.copy(this.home);
    this.actor.teleport(this.home, this.homeYaw);
    this.actor.setForcedAction(this.p.archetype === "ambusher" ? "crouch" : "sit");
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
    // spotting the thief: a yowl (rate limited, purely cosmetic)
    if (s === "NOTICE" && this.time - this.lastYowl > 9) {
      this.lastYowl = this.time;
      this.actor.meow(true);
    }
    this.state = s;
    this.stateT = 0;
    this.path = [];
    this.repathT = 0;
    if (s !== "AMBUSH" && s !== "IDLE" && this.actor.forcedAction !== null && this.actor.forcedAction !== "eat") this.actor.setForcedAction(null);
  }

  // ------------------------------------------------------------------ update
  update(dt: number, w: AIWorld): void {
    this.time += dt;
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
    this.lastDistQ = distQ;
    this.perceive(dt, w, distQ);
    if (this.glanceT > 0) this.glanceT -= dt;
    a.lookTarget = this.glanceT > 0 ? this.glancePoint : distQ < 12 && this.seenT < 0.5 ? q.center(_knee2) : null;

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
      if (df < this.p.fishSense && this.state !== "FISH_CHASE") this.go("FISH_CHASE");
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
        if (this.stateT > this.p.notice) this.go(this.p.archetype === "ambusher" ? "AMBUSH" : this.p.archetype === "opportunist" ? "INTERCEPT" : "CHASE");
        break;
      case "CHASE":
      case "INTERCEPT":
        this.updateChase(dt, w, distQ);
        break;
      case "RECOVER":
        // helpers go back to their mission (which then asks for a re-plan)
        if (this.stateT > 0.45) this.go(this.helper ? "MISSION" : "CHASE");
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
          a.setForcedAction(this.p.archetype === "ambusher" ? "crouch" : "sit");
        }
        if (distQ < 7 && this.seenT < 0.3 && w.quarryZone <= this.p.maxZone) this.go("CHASE");
        break;
      case "MISSION":
        this.updateMission(dt, w, distQ);
        break;
      case "SEARCH":
        this.updateSearch(dt, w);
        break;
      case "POUNCE":
        if (a.abilities.pounceState === "idle") this.go("RECOVER");
        break;
    }
  }

  private updateIdle(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    if (w.round === 2) return;
    if (this.glanceT > 0) this.faceToward(this.glancePoint);
    // (sawPickup is set by hearing the fishmonger's bell, not by magic)
    const sees = this.seenT < 0.3;
    switch (this.p.archetype) {
      case "sprinter":
        if (sees && ((this.sawPickup && distQ < 26) || distQ < 7)) this.go("NOTICE");
        break;
      case "ambusher":
        if (this.sawPickup && w.quarryZone >= 3) this.go("AMBUSH");
        break;
      case "opportunist":
        // waits between both routes; moves once the thief is within reach
        if (sees && ((this.sawPickup && distQ < this.p.leash - 2) || distQ < 8)) this.go("NOTICE");
        break;
      default:
        // chaos: wanders the rooftops looking for trouble
        if (this.sawPickup && (w.quarryZone >= 5 || (sees && distQ < 14))) this.go("CHASE");
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
      if (this.p.archetype === "ambusher") this.go("AMBUSH");
      else if (this.p.archetype === "chaos") {
        if (distQ > this.p.leash * 1.6) this.go("RETURN");
      } else this.go("RETURN");
      return;
    }
    // Lost sight (and sound) of the thief for too long: go and look.
    if (w.round === 1 && this.seenT > MEMORY) {
      this.go("SEARCH");
      return;
    }
    // Opportunists cut the route: aim far ahead of the thief and let the
    // waypoint graph find the shortcut; close in normally once near.
    const cutting = this.p.archetype === "opportunist" && distQ > 7;
    const lead = cutting ? Math.min(2.4, distQ / 5) : Math.min(0.6, distQ / 9);
    if (this.seenT < 0.2) w.predict(lead, _p);
    else this.believed(_p);
    // Chaos cats orbit instead of charging straight in.
    if (this.p.archetype === "chaos" && distQ < 6 && distQ > 2.4) {
      const ang = Math.atan2(a.position.x - q.position.x, a.position.z - q.position.z) + dt * 2.2;
      _p.set(q.position.x + Math.sin(ang) * 3.2, q.position.y, q.position.z + Math.cos(ang) * 3.2);
    }
    this.moveTo(_p, dt, w, this.p.chaseSprint || distQ > 6);
    this.tryPounce(w, distQ);
    // chaos cats play with props near the action
    if (this.p.archetype === "chaos" && this.interactCooldown <= 0 && this.rng.chance(dt * 0.4)) {
      this.interactCooldown = 4;
      this.onWantInteract?.(a);
    }
  }

  private tryPounce(w: AIWorld, distQ: number): boolean {
    const a = this.actor;
    const q = w.quarry;
    if (this.pounceTimer > 0 || !a.abilities.pounceReady || !a.canAct || !a.grounded) return false;
    if (distQ > this.p.pounceRange + 2.5 || Math.abs(q.position.y - a.position.y) > 0.7) return false;
    if (q.staggerT > 0.1) return false;
    // Judge range by where the quarry will be when the windup ends: ambushers
    // lunge early at an approaching cat, chasers don't whiff at a fleeing one.
    const windup = AI_POUNCE_WINDUP + a.windupBonus;
    w.predict(windup, _p);
    const reach = Math.hypot(_p.x - a.position.x, _p.z - a.position.z);
    if (reach > this.p.pounceRange) return false;
    _knee.copy(a.position).setY(a.position.y + 0.45);
    _w.copy(q.position).setY(q.position.y + 0.45);
    if (!w.physics.lineOfSight(_knee, _w)) return false;
    this.pounceTimer = this.p.pounceCooldown * (w.round === 2 ? 0.8 : 1) + this.rng.range(-0.3, 0.4);
    if (!this.rng.chance(this.p.pounceChance)) return false;
    const travel = reach / Math.max(1, a.stats.pounceSpeed);
    w.predict(travel + windup, _p);
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
    while (this.ambushIndex < AMBUSH_SPOTS.length - 1 && this.spotPassed(AMBUSH_SPOTS[this.ambushIndex], w)) this.ambushIndex++;
    const spot = AMBUSH_SPOTS[this.ambushIndex];
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
    if (this.spotPassed(spot, w) && this.ambushIndex >= AMBUSH_SPOTS.length - 1 && distQ > 10) {
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
      this.go(this.helper ? "MISSION" : this.p.archetype === "ambusher" ? "AMBUSH" : "CHASE");
    }
  }

  private updateEscape(dt: number, w: AIWorld): void {
    const a = this.actor;
    const q = w.quarry;
    if (w.fish.owner !== a) {
      this.escapePoint = null;
      this.go("CHASE");
      return;
    }
    a.lookTarget = null;
    // Pick an authored escape point away from the thief; switch only if the
    // thief cuts the current one off (gets clearly closer to it than us).
    const cutOff =
      this.escapePoint &&
      Math.hypot(this.escapePos.x - q.position.x, this.escapePos.z - q.position.z) < Math.hypot(this.escapePos.x - a.position.x, this.escapePos.z - a.position.z) - 3;
    if (!this.escapePoint || (cutOff && this.stateT > 1.5)) {
      this.stateT = 0;
      this.escapePoint = this.pickEscape(w);
      this.escapePos.set(...this.escapePoint.pos);
    }
    const d = this.moveTo(this.escapePos, dt, w, true);
    // a cat with a mouthful of fish is clearly slower than the thief, so a
    // quick chase (and one pounce) always gets it back
    a.speedScale *= 0.82;
    if (d < 1.1 && Math.abs(this.escapePos.y - a.position.y) < 1) this.escaped = true;
  }

  private pickEscape(w: AIWorld): (typeof ESCAPE_POINTS)[number] {
    const a = this.actor;
    const q = w.quarry;
    let best = ESCAPE_POINTS[0];
    let bestScore = -Infinity;
    for (const e of ESCAPE_POINTS) {
      const [x, y, z] = e.pos;
      const dSelf = Math.hypot(x - a.position.x, z - a.position.z) + Math.abs(y - a.position.y) * 3;
      const dQuarry = Math.hypot(x - q.position.x, z - q.position.z);
      // far enough that the chase is fair, close enough to be a real threat
      let score = dQuarry - dSelf * 0.6;
      if (dSelf < 18) score -= 40;
      if (dSelf > 45) score -= 25;
      // don't run straight past the thief
      _v.set(x - a.position.x, 0, z - a.position.z).normalize();
      _w.set(q.position.x - a.position.x, 0, q.position.z - a.position.z);
      const dq = _w.length();
      if (dq > 0.01 && _v.dot(_w.divideScalar(dq)) > 0.6 && dq < dSelf) score -= 30;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
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
      // discrete re-plan: ask the coordinator for the next intercept
      if (this.missionIdx >= this.missions.length) this.onMissionEnded?.(this);
      return;
    }
    const d = this.moveTo(m.point, dt, w, true, 0.6);
    const waits = m.role === "cut_off" || m.role === "hold_landing" || m.role === "late_collapse";
    if (d < 1.0) {
      a.intent.moveX = 0;
      a.intent.moveZ = 0;
      if (waits && a.forcedAction !== "crouch") a.setForcedAction("crouch");
      this.faceToward(q.position);
    }
    if (m.role === "environment_trap") {
      // spring the prop as Past You comes by; trappers don't pounce
      // spring it as Past You reaches its recorded closest approach, not before
      const pastNear = Math.hypot(q.position.x - m.point.x, q.position.z - m.point.z) < 4.6;
      if (m.prop && d < 2.6 && pastNear && echoT >= m.arriveAt - 0.35 && echoT - m.arriveAt < 2.0) {
        this.onTrap?.(a, m.prop);
        this.missionDone = true;
      }
      return;
    }
    // normal perception: only pounce on a Past You this cat can actually see
    if (distQ < 5.5 && Math.abs(q.position.y - a.position.y) < 0.8 && this.seenT < 0.3) {
      a.setForcedAction(null);
      if (this.tryPounce(w, distQ)) this.missionDone = true;
      else if (distQ < 3) this.moveTo(q.position, dt, w, true);
    }
  }

  /**
   * Hearing. Loudness falls off with distance; what a cat does about it
   * depends on the sound, on what it is busy with, and on its archetype
   * (chaos cats investigate everything, ambushers mostly just look).
   */
  hear(e: GameEvents["sound"]): void {
    const a = this.actor;
    if (!this.enabled || !a.active || e.source === this.id) return;
    const d = Math.hypot(e.x - a.position.x, e.z - a.position.z) + Math.abs(e.y - a.position.y) * 1.5;
    if (d > e.radius) return;
    const loud = e.intensity * (1 - d / e.radius);
    const p = _w.set(e.x, e.y, e.z);
    // the fish always comes first
    if (this.state === "ESCAPE_WITH_FISH" || this.state === "FISH_CHASE") return;
    switch (e.type) {
      case "pigeonBurst":
        // the flock explodes around them: everyone flinches and hesitates
        if (loud > 0.12 && this.state !== "POUNCE") this.distract(1.4 + loud * 1.4, p, "pigeons");
        return;
      case "bell":
        // the fishmonger's bell: the whole alley now knows the fish is gone,
        // and every idle cat turns to look at the market
        this.sawPickup = true;
        this.glance(p, 2.5);
        return;
      case "fishDrop":
      case "catHiss":
        this.glance(p, 0.8);
        return;
      default: {
        const busy = (this.state === "CHASE" || this.state === "INTERCEPT" || this.state === "POUNCE") && this.lastDistQ < 9;
        if (busy || loud < CURIOSITY[this.p.archetype]) {
          this.glance(p, 1.1);
          return;
        }
        if (this.state === "DISTRACTED") {
          // a rolling bottle keeps pulling the investigation along with it
          if (this.distractKind === "noise") {
            this.distractPoint.copy(p);
            this.distractT = Math.max(this.distractT, 1.0);
          }
          return;
        }
        this.distract(1.2 + loud * 2.2, p, "noise");
      }
    }
  }

  /** Vision (range, field of view, line of sight) feeding a short memory. */
  private perceive(dt: number, w: AIWorld, distQ: number): void {
    const a = this.actor;
    const q = w.quarry;
    this.seenT += dt;
    this.visionT -= dt;
    if (this.visionT <= 0) {
      // eyes are cheap but not free: re-check a few times a second
      this.visionT = 0.12;
      this.visible = false;
      if (q.active && distQ <= this.p.viewRange && Math.abs(q.position.y - a.position.y) < 6) {
        let inView = distQ < AWARE_RADIUS;
        if (!inView) {
          // eyes follow the head: a glance or a tracked target sets the view
          let fx = Math.sin(a.yaw);
          let fz = Math.cos(a.yaw);
          const look = a.lookTarget;
          if (look) {
            const lx = look.x - a.position.x;
            const lz = look.z - a.position.z;
            const ll = Math.hypot(lx, lz);
            if (ll > 0.3) {
              fx = lx / ll;
              fz = lz / ll;
            }
          }
          inView = ((q.position.x - a.position.x) * fx + (q.position.z - a.position.z) * fz) / Math.max(distQ, 1e-3) >= Math.cos(HALF_FOV);
        }
        if (inView) {
          _knee.copy(a.position).setY(a.position.y + 0.5);
          _knee2.copy(q.position).setY(q.position.y + 0.45);
          this.visible = w.physics.lineOfSight(_knee, _knee2);
        }
      }
    }
    if (this.visible) this.remember(q.position, q.velocity);
  }

  private remember(p: THREE.Vector3, v: THREE.Vector3): void {
    this.seenT = 0;
    this.lastSeen.copy(p);
    this.lastSeenVel.copy(v).setY(0);
  }

  /** Heard the quarry's paws nearby (sprinting cats aren't subtle). */
  hearQuarry(p: THREE.Vector3, v: THREE.Vector3): void {
    if (!this.enabled || this.actor.mode !== "ai") return;
    if (this.seenT > 0.1) this.remember(p, v);
  }

  /** Where this cat believes the quarry is: last sighting, extrapolated briefly. */
  private believed(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.lastSeen).addScaledVector(this.lastSeenVel, Math.min(this.seenT, 1));
  }

  /** Go to the last known position, look around, then give up. */
  private updateSearch(dt: number, w: AIWorld): void {
    const a = this.actor;
    if (this.seenT < 0.2) {
      this.go(this.p.archetype === "opportunist" ? "INTERCEPT" : "CHASE");
      return;
    }
    const d = this.moveTo(this.lastSeen, dt, w, this.stateT < 2, 0.8);
    if (d < 1.2 || this.stateT > 3.5) {
      a.intent.moveX = 0;
      a.intent.moveZ = 0;
      // look left, look right...
      this.searchLook += dt;
      a.movement.yaw += Math.sin(this.searchLook * 2.4) * dt * 2.2;
    }
    if (this.stateT > 5.5) {
      this.searchLook = 0;
      this.go(this.p.archetype === "ambusher" ? "AMBUSH" : "RETURN");
    }
  }

  private glance(p: THREE.Vector3, seconds: number): void {
    this.glancePoint.copy(p);
    this.glanceT = Math.max(this.glanceT, seconds);
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
    const targetMoved = this.pathTarget.distanceToSquared(target) > 2.25;
    if (this.path.length === 0 || (this.repathT <= 0 && targetMoved)) {
      this.repathT = 0.7;
      this.pathTarget.copy(target);
      const to = w.graph.nearest(target.x, target.y, target.z);
      const from = this.bestStart(w, to);
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

  /**
   * Start node for a new path: of the reachable nodes nearby, the one with
   * the shortest total route (not merely the nearest, which can sit behind
   * the cat and make it double back and forth between two nodes).
   */
  private bestStart(w: AIWorld, to: NavNode): NavNode {
    const a = this.actor;
    const nearest = w.graph.nearest(a.position.x, a.position.y, a.position.z);
    let best = nearest;
    let bestCost = Infinity;
    _knee.copy(a.position).setY(a.position.y + 0.4);
    for (const n of w.graph.nodes.values()) {
      const d = Math.hypot(n.x - a.position.x, n.z - a.position.z);
      if (d > 9 || Math.abs(n.y - a.position.y) > 1.0) continue;
      if (n !== nearest && !w.physics.lineOfSight(_knee, _w.set(n.x, n.y + 0.4, n.z))) continue;
      const cost = d + w.graph.pathLength(w.graph.path(n, to));
      if (cost < bestCost) {
        bestCost = cost;
        best = n;
      }
    }
    return best;
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
        this.pathTarget.set(1e9, 0, 0);
      }
    }
  }
}
