import * as THREE from "three";
import { CATS, type CatId } from "../data/cats";
import type { EventBus } from "../core/EventBus";
import { CatAnimator, type CatAction } from "../player/CatAnimator";
import { CatAbilities } from "../player/CatAbilities";
import { CatMovement, type MoveIntent, type MoveModifiers } from "../player/CatMovement";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { buildCat, type CatMaterials, type CatRig } from "./CatModel";

export type DriveMode = "player" | "ai" | "replay" | "scripted";

const _tmp = new THREE.Vector3();

/** Externally supplied state while the actor is replay-driven (Past You). */
export interface ReplayDrive {
  position: THREE.Vector3;
  yaw: number;
  velocity: THREE.Vector3;
  grounded: boolean;
  action: CatAction;
  actionTime: number;
}

/**
 * A cat in the world. Owns its model, animator, movement and abilities.
 * Brains (player input, rival AI, replay) only write `intent`/requests.
 */
export class CatActor {
  readonly id: CatId;
  readonly rig: CatRig;
  readonly animator: CatAnimator;
  readonly movement: CatMovement;
  readonly abilities: CatAbilities;
  mode: DriveMode = "ai";
  team = 1;
  active = true;

  readonly intent: MoveIntent = { moveX: 0, moveZ: 0, sprint: false, jump: false, jumpHeld: false };
  wantPounce = false;
  wantHiss = false;
  readonly pounceAim = new THREE.Vector3(0, 0, 1);
  readonly hissAim = new THREE.Vector3(0, 0, 1);

  staggerT = 0;
  hesitateT = 0;
  invulnT = 0;
  tangledT = 0;
  forcedAction: CatAction | null = null;
  forcedActionT = 0;
  carrying = false;
  lookTarget: THREE.Vector3 | null = null;
  meowT = 0;
  /** Speed multiplier from game rules (AI tuning, hunter boosts). */
  speedScale = 1;
  private readonly knock = new THREE.Vector3();
  private readonly forced = new THREE.Vector3();
  /** Visual-only offset (Past You flinch) that springs back to zero. */
  readonly visualOffset = new THREE.Vector3();
  private readonly visualOffsetVel = new THREE.Vector3();
  replay: ReplayDrive | null = null;
  /** Animation label for replay snapshots. */
  animLabel = "idle";

  constructor(
    id: CatId,
    physics: PhysicsWorld,
    mats: CatMaterials,
    private readonly bus: EventBus,
    spawn: THREE.Vector3,
    isEcho = false,
  ) {
    this.id = id;
    const def = CATS[id];
    this.rig = buildCat(def, mats);
    this.animator = new CatAnimator(this.rig);
    this.movement = new CatMovement(physics, { ...def.stats }, spawn, isEcho);
    this.abilities = new CatAbilities(def.stats);
    this.rig.root.position.copy(spawn);
  }

  get position(): THREE.Vector3 {
    return this.movement.position;
  }

  get yaw(): number {
    return this.movement.yaw;
  }

  get velocity(): THREE.Vector3 {
    return this.movement.velocity;
  }

  get grounded(): boolean {
    return this.movement.grounded;
  }

  get stats() {
    return this.movement.stats;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Center of mass used for hit tests. */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 0.42);
  }

  get canAct(): boolean {
    return this.active && this.staggerT <= 0 && this.tangledT <= 0 && this.forcedAction === null;
  }

  get action(): CatAction {
    if (this.forcedAction) return this.forcedAction;
    if (this.staggerT > 0) return "stagger";
    if (this.tangledT > 0) return "tangled";
    const ps = this.abilities.pounceState;
    if (ps === "windup") return "pounceWindup";
    if (ps === "active") return "pounce";
    if (ps === "recover") return "pounceRecover";
    if (this.abilities.hissActive) return "hiss";
    if (this.hesitateT > 0) return "hesitate";
    return "none";
  }

  stagger(duration: number, dir: THREE.Vector3 | null, strength: number): void {
    if (this.mode === "replay") {
      this.flinch(dir, strength * 0.05);
      return;
    }
    this.staggerT = Math.max(this.staggerT, duration);
    this.abilities.cancelAll();
    if (dir) this.knock.copy(dir).setY(0).normalize().multiplyScalar(strength);
    if (this.movement.grounded && strength > 0) this.movement.velocity.y = 3.2;
  }

  hesitate(duration: number): void {
    if (this.mode === "replay") return;
    this.hesitateT = Math.max(this.hesitateT, duration);
  }

  /** Visual-only knock for replay-driven cats (never moves the timeline). */
  flinch(dir: THREE.Vector3 | null, amount: number): void {
    if (dir) this.visualOffsetVel.addScaledVector(_tmp.copy(dir).setY(0).normalize(), amount * 40);
    this.visualOffsetVel.y += amount * 12;
  }

  setForcedAction(a: CatAction | null): void {
    this.forcedAction = a;
    this.forcedActionT = 0;
  }

  meow(): void {
    this.meowT = 0.45;
    this.bus.emit("meow", { cat: this.id });
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.movement.teleport(p, yaw);
    this.rig.root.position.copy(p);
    this.rig.root.rotation.y = yaw;
  }

  resetStatus(): void {
    this.staggerT = 0;
    this.hesitateT = 0;
    this.invulnT = 0;
    this.tangledT = 0;
    this.forcedAction = null;
    this.forcedActionT = 0;
    this.carrying = false;
    this.meowT = 0;
    this.knock.set(0, 0, 0);
    this.wantPounce = false;
    this.wantHiss = false;
    this.intent.moveX = 0;
    this.intent.moveZ = 0;
    this.intent.jump = false;
    this.intent.jumpHeld = false;
    this.intent.sprint = false;
    this.abilities.resetCooldowns();
    this.visualOffset.set(0, 0, 0);
    this.visualOffsetVel.set(0, 0, 0);
    this.speedScale = 1;
    this.lookTarget = null;
  }

  /** Simulated update (player and AI modes). */
  update(dt: number): void {
    if (this.mode === "replay") {
      this.updateReplay(dt);
      return;
    }
    if (!this.active) return;
    this.tickStatus(dt);
    const ab = this.abilities;

    // Requests → abilities
    if (this.wantPounce && this.canAct && !ab.busy) {
      ab.tryPounce(this.pounceAim);
    }
    if (this.wantHiss && this.canAct && ab.pounceState === "idle") {
      if (ab.tryHiss(this.hissAim)) {
        this.bus.emit("hissStart", {
          cat: this.id,
          dirX: ab.hissDir.x,
          dirZ: ab.hissDir.z,
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
        });
      }
    }
    this.wantPounce = false;
    this.wantHiss = false;

    const launched = ab.update(dt);
    if (launched) {
      this.movement.velocity.y = Math.max(this.movement.velocity.y, this.stats.pounceLift);
      this.movement.grounded = false;
      this.bus.emit("pounceStart", {
        cat: this.id,
        dirX: ab.pounceDir.x,
        dirZ: ab.pounceDir.z,
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      });
    }

    // Movement modifiers by state
    const mods: MoveModifiers = { control: 1, speedScale: this.speedScale, allowJump: true, forced: null, forcedSteer: 0 };
    if (this.forcedAction) {
      mods.control = 0;
      mods.allowJump = false;
    }
    if (this.staggerT > 0 || this.tangledT > 0) {
      mods.control = 0;
      mods.allowJump = false;
      this.forced.copy(this.knock);
      mods.forced = this.forced;
      this.knock.multiplyScalar(Math.exp(-7 * dt));
    } else if (ab.pounceState === "windup") {
      mods.control = 0.3;
      mods.speedScale *= 0.35;
      mods.allowJump = false;
    } else if (ab.pounceState === "active") {
      const t = ab.pounceT / this.stats.pounceDuration;
      this.forced.copy(ab.pounceDir).multiplyScalar(this.stats.pounceSpeed * (1 - 0.3 * t));
      mods.forced = this.forced;
      mods.forcedSteer = 0.3;
      mods.allowJump = false;
    } else if (ab.pounceState === "recover") {
      mods.control = 0.45;
      mods.allowJump = false;
    } else if (ab.hissActive) {
      mods.speedScale *= 0.3;
    } else if (this.hesitateT > 0) {
      mods.speedScale *= 0.45;
      mods.control = 0.6;
    }

    this.movement.update(dt, this.intent, mods);
    this.intent.jump = false;

    if (this.movement.jumped) {
      this.animator.takeoff();
      this.bus.emit("jump", { cat: this.id, x: this.position.x, y: this.position.y, z: this.position.z });
    }
    if (this.movement.landed) {
      this.animator.land(this.movement.landImpact);
      this.bus.emit("land", { cat: this.id, x: this.position.x, y: this.position.y, z: this.position.z, impact: this.movement.landImpact });
      if (ab.pounceState === "active") ab.endPounce();
    }
    if (this.movement.fellOut) this.bus.emit("respawn", { cat: this.id });

    this.animate(dt, this.movement.turnRate);
  }

  private tickStatus(dt: number): void {
    if (this.staggerT > 0) this.staggerT -= dt;
    if (this.hesitateT > 0) this.hesitateT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.tangledT > 0) this.tangledT -= dt;
    if (this.meowT > 0) this.meowT -= dt;
    if (this.forcedAction) this.forcedActionT += dt;
  }

  private actionTime(): number {
    if (this.forcedAction) return this.forcedActionT;
    if (this.staggerT > 0) return Math.max(0, 0.7 - this.staggerT);
    if (this.tangledT > 0) return 2 - this.tangledT;
    return this.abilities.pounceState !== "idle" ? this.abilities.pounceT : this.abilities.hissT;
  }

  private animate(dt: number, turnRate: number): void {
    const v = this.movement.velocity;
    const speed = Math.hypot(v.x, v.z);
    const action = this.replay ? this.replay.action : this.action;
    this.animator.update(dt, {
      speed,
      velY: v.y,
      grounded: this.movement.grounded,
      sprinting: this.movement.sprinting,
      turnRate,
      action,
      actionTime: this.replay ? this.replay.actionTime : this.actionTime(),
      carrying: this.carrying,
      lookTarget: this.lookTarget,
      airTime: this.movement.airTime,
      meow: this.meowT,
      rootYaw: this.movement.yaw,
      rootPos: this.movement.position,
    });
    // Visual flinch spring (replay cats)
    this.visualOffsetVel.addScaledVector(this.visualOffset, -160 * dt);
    this.visualOffsetVel.multiplyScalar(Math.exp(-12 * dt));
    this.visualOffset.addScaledVector(this.visualOffsetVel, dt);
    this.rig.root.position.copy(this.movement.position).add(this.visualOffset);
    this.rig.root.rotation.y = this.movement.yaw;

    // footsteps from planted feet
    if (this.movement.grounded && speed > 0.6) {
      for (let i = 0; i < this.animator.footDown.length; i++) {
        this.bus.emit("footstep", {
          cat: this.id,
          sprint: this.movement.sprinting,
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
          volume: Math.min(1, speed / 8),
        });
      }
    }
    if (!this.movement.grounded) this.animLabel = "air";
    else if (speed > 6.6) this.animLabel = "sprint";
    else if (speed > 2.2) this.animLabel = "run";
    else if (speed > 0.3) this.animLabel = "walk";
    else this.animLabel = "idle";
  }

  /** Replay-driven update: transform comes from the recording. */
  private updateReplay(dt: number): void {
    const r = this.replay;
    if (!r) return;
    this.tickStatus(dt);
    this.abilities.update(dt);
    const prevYaw = this.movement.yaw;
    const wasGrounded = this.movement.grounded;
    this.movement.placeExternal(r.position);
    this.movement.yaw = r.yaw;
    this.movement.velocity.copy(r.velocity);
    this.movement.grounded = r.grounded;
    if (r.grounded && !wasGrounded) this.animator.land(Math.min(1, Math.max(0, -r.velocity.y / 16)));
    let dy = r.yaw - prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.animate(dt, dt > 0 ? dy / dt : 0);
  }

  /** Run only the animator (scripted poses, menus, cutscenes). */
  updateScripted(dt: number): void {
    this.tickStatus(dt);
    this.animate(dt, 0);
  }
}
