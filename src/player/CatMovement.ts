import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { CatStats } from "../data/cats";
import { clamp } from "../core/math";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { GROUP_CAT, GROUP_ECHO } from "../physics/CollisionLayers";

export const CAPSULE_RADIUS = 0.3;
export const CAPSULE_HALF = 0.12;
export const CAPSULE_CENTER = CAPSULE_RADIUS + CAPSULE_HALF;

export const GRAVITY = 30;
const COYOTE_TIME = 0.13;
const JUMP_BUFFER = 0.16;
const TERMINAL = -26;
const KILL_Y = -7;

export interface MoveIntent {
  /** World-space desired direction on XZ (length 0..1). */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jump: boolean;
  jumpHeld: boolean;
}

export interface MoveModifiers {
  /** 0 = ignore steering input, 1 = full control. */
  control: number;
  speedScale: number;
  allowJump: boolean;
  /** Forced horizontal velocity (pounce, knockback). */
  forced: THREE.Vector3 | null;
  /** Steering authority while forced (pounce air steer). */
  forcedSteer: number;
}

interface Arc {
  from: THREE.Vector3;
  to: THREE.Vector3;
  height: number;
  dur: number;
  t: number;
}

/**
 * Kinematic cat movement on top of Rapier's character controller.
 * Tuned for feel over realism: snappy acceleration, strong braking, high
 * air control, coyote time, jump buffering, variable jump height, ground
 * snapping and a ledge-mantle assist so near-miss jumps still land.
 */
export class CatMovement {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  grounded = true;
  airTime = 0;
  yaw = 0;
  turnRate = 0;
  sprinting = false;
  /** Set true on the frame the cat left the ground via jump. */
  jumped = false;
  /** Set true on the frame the cat landed; impact in 0..1. */
  landed = false;
  landImpact = 0;
  /** Distance walked on ground (footstep cadence). */
  distance = 0;
  readonly lastSafe = new THREE.Vector3();
  fellOut = false;

  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpHeldSinceTakeoff = false;
  private safeTimer = 0;
  private arc: Arc | null = null;
  private readonly tmpDesired = { x: 0, y: 0, z: 0 };
  private readonly collision: RAPIER.CharacterCollision;
  private readonly horiz = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly probeOrigin = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);
  enabled = true;
  /** When false the cat is moved externally (replay, cinematic). */
  simulate = true;

  constructor(
    private readonly physics: PhysicsWorld,
    public stats: CatStats,
    spawn: THREE.Vector3,
    isEcho = false,
  ) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CAPSULE_CENTER, spawn.z),
    );
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS)
        .setCollisionGroups(isEcho ? GROUP_ECHO : GROUP_CAT)
        .setFriction(0),
      this.body,
    );
    this.controller = physics.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(0.32, 0.12, false);
    this.controller.enableSnapToGround(0.32);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((62 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setNormalNudgeFactor(0.0005);
    this.collision = new R.CharacterCollision();
    this.position.copy(spawn);
    this.lastSafe.copy(spawn);
  }

  /** Instantly place the cat (reset, respawn, replay). */
  teleport(p: THREE.Vector3, yaw?: number): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.arc = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.grounded = true;
    const c = { x: p.x, y: p.y + CAPSULE_CENTER, z: p.z };
    this.body.setTranslation(c, true);
    this.body.setNextKinematicTranslation(c);
  }

  /** Move the kinematic body to an externally driven position. */
  placeExternal(p: THREE.Vector3): void {
    this.position.copy(p);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CAPSULE_CENTER, z: p.z });
  }

  setCollisionEnabled(on: boolean): void {
    this.collider.setEnabled(on);
  }

  /** Scripted ballistic hop between two points (AI traversal links). */
  launchArc(to: THREE.Vector3, height: number, dur: number): void {
    this.arc = { from: this.position.clone(), to: to.clone(), height, dur: Math.max(0.2, dur), t: 0 };
    this.grounded = false;
  }

  get inArc(): boolean {
    return this.arc !== null;
  }

  jumpVelocity(): number {
    return Math.sqrt(2 * GRAVITY * this.stats.jumpHeight);
  }

  update(dt: number, intent: MoveIntent, mods: MoveModifiers): void {
    this.jumped = false;
    this.landed = false;
    this.fellOut = false;
    if (!this.enabled || dt <= 0) return;

    if (this.arc) {
      if (this.arc.t === 0) this.jumped = true;
      this.updateArc(dt);
      return;
    }

    const st = this.stats;
    // -------------------------------------------------- horizontal
    this.sprinting = intent.sprint && mods.control > 0.5;
    const maxSpeed = (this.sprinting ? st.sprintSpeed : st.runSpeed) * mods.speedScale;
    this.target.set(intent.moveX, 0, intent.moveZ).multiplyScalar(maxSpeed * mods.control);
    this.horiz.set(this.velocity.x, 0, this.velocity.z);

    if (mods.forced) {
      // Forced motion (pounce lunge / knockback) with a little steering.
      this.horiz.copy(mods.forced);
      if (mods.forcedSteer > 0 && this.target.lengthSq() > 0.01) {
        const sp = this.horiz.length();
        this.horiz.lerp(this.target.clone().setLength(sp), mods.forcedSteer * dt * 6);
      }
    } else {
      const accel = this.grounded ? st.groundAccel : st.airAccel;
      const tLen = this.target.length();
      const hLen = this.horiz.length();
      let a = accel;
      if (tLen < 0.01) {
        a = this.grounded ? st.groundAccel * 1.25 : st.airAccel * 0.5;
      } else if (hLen > 0.5) {
        const dot = this.horiz.dot(this.target) / (hLen * tLen);
        if (dot < 0.2) a *= this.grounded ? 1.7 : 1.3; // snappy reversals
      }
      const diff = this.target.clone().sub(this.horiz);
      const dl = diff.length();
      const step = a * dt;
      if (dl <= step) this.horiz.copy(this.target);
      else this.horiz.addScaledVector(diff, step / dl);
    }

    // -------------------------------------------------- vertical
    if (this.grounded) this.coyote = COYOTE_TIME;
    else this.coyote -= dt;
    if (intent.jump) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer -= dt;

    let vy = this.velocity.y;
    if (this.jumpBuffer > 0 && this.coyote > 0 && mods.allowJump) {
      vy = this.jumpVelocity();
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.grounded = false;
      this.jumped = true;
      this.jumpHeldSinceTakeoff = true;
      // Small horizontal boost so running jumps feel springy.
      const hs = this.horiz.length();
      if (hs > 0.5) this.horiz.multiplyScalar(Math.min(1.08, (hs + 0.4) / hs));
    }
    if (!intent.jumpHeld) this.jumpHeldSinceTakeoff = false;

    let groundedPush = false;
    if (!this.grounded || this.jumped) {
      let g = GRAVITY;
      if (vy > 0 && !this.jumpHeldSinceTakeoff && !mods.forced) g *= 2.3; // short hop on release
      else if (vy < 0) g *= 1.4; // snappy fall
      vy = Math.max(TERMINAL, vy - g * dt);
    } else {
      // Grounded: no downward push (avoids zero-movement contact hiccups);
      // snap-to-ground keeps us glued on slopes and step-downs.
      vy = 0;
      groundedPush = true;
    }

    // -------------------------------------------------- ledge mantle assist
    if (!this.grounded && vy < 5 && this.target.lengthSq() > 0.5) {
      const dir = this.target.clone().normalize();
      this.probeOrigin.set(this.position.x + dir.x * 0.48, this.position.y + 0.95, this.position.z + dir.z * 0.48);
      const hit = this.physics.raycast(this.probeOrigin, this.down, 1.0);
      if (hit && hit.normal.y > 0.75) {
        const rise = hit.point.y - this.position.y;
        if (rise > 0.04 && rise < 0.62) {
          // Is something solid in front at foot level? (i.e. a ledge, not open air)
          const needed = Math.sqrt(2 * GRAVITY * (rise + 0.14));
          if (vy < needed) vy = needed;
        }
      }
    }

    // -------------------------------------------------- collide & slide
    const desired = this.tmpDesired;
    desired.x = this.horiz.x * dt;
    desired.y = groundedPush ? -0.004 : vy * dt;
    desired.z = this.horiz.z * dt;
    this.controller.computeColliderMovement(this.collider, desired, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, GROUP_CAT);
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded() && vy <= 0.5;

    // Ceiling bump
    if (vy > 0 && moved.y < desired.y * 0.5) vy = 0;
    // Walls: remove only the velocity component pointing into the wall,
    // so we slide along it without bleeding speed on ground contacts.
    const nCol = this.controller.numComputedCollisions();
    for (let i = 0; i < nCol; i++) {
      const c = this.controller.computedCollision(i, this.collision);
      if (!c) continue;
      const n = c.normal1;
      if (Math.abs(n.y) > 0.65) continue; // floor / ceiling
      const hl = Math.hypot(n.x, n.z);
      if (hl < 1e-4) continue;
      const nx = n.x / hl;
      const nz = n.z / hl;
      const into = this.horiz.x * nx + this.horiz.z * nz;
      if (into < 0 && !mods.forced) {
        this.horiz.x -= nx * into;
        this.horiz.z -= nz * into;
      }
    }
    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;

    if (this.grounded) {
      if (!wasGrounded) {
        this.landed = true;
        this.landImpact = clamp(-this.velocity.y / 16, 0, 1);
      }
      vy = 0;
      this.airTime = 0;
      this.distance += Math.hypot(moved.x, moved.z);
    } else {
      this.airTime += dt;
    }
    this.velocity.set(this.horiz.x, vy, this.horiz.z);

    // -------------------------------------------------- facing
    const hs = Math.hypot(this.horiz.x, this.horiz.z);
    const prevYaw = this.yaw;
    if (mods.forced && hs > 0.5) {
      this.yaw = Math.atan2(this.horiz.x, this.horiz.z);
    } else if (this.target.lengthSq() > 0.04 && hs > 0.3) {
      const want = Math.atan2(this.horiz.x, this.horiz.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = (this.grounded ? 16 : 9) * dt;
      this.yaw += clamp(d, -maxTurn, maxTurn);
    }
    let dy = this.yaw - prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.turnRate = dt > 0 ? dy / dt : 0;

    // -------------------------------------------------- safety net
    if (this.grounded) {
      this.safeTimer += dt;
      if (this.safeTimer > 0.4) {
        this.safeTimer = 0;
        this.lastSafe.copy(this.position);
      }
    }
    if (this.position.y < KILL_Y) {
      this.teleport(this.lastSafe);
      this.fellOut = true;
    }

    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CAPSULE_CENTER,
      z: this.position.z,
    });
  }

  private updateArc(dt: number): void {
    const a = this.arc!;
    a.t += dt;
    const u = Math.min(1, a.t / a.dur);
    const prev = this.position.clone();
    this.position.lerpVectors(a.from, a.to, u);
    this.position.y += Math.sin(u * Math.PI) * a.height;
    this.velocity.subVectors(this.position, prev).divideScalar(Math.max(dt, 1e-4));
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.5) this.yaw = Math.atan2(this.velocity.x, this.velocity.z);
    this.grounded = false;
    this.airTime += dt;
    if (u >= 1) {
      this.arc = null;
      this.grounded = true;
      this.landed = true;
      this.landImpact = 0.5;
      this.velocity.y = 0;
      this.airTime = 0;
    }
    this.body.setNextKinematicTranslation({
      x: this.position.x,
      y: this.position.y + CAPSULE_CENTER,
      z: this.position.z,
    });
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
