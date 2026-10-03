import * as THREE from "three";
import { clamp, damp, dampAngle, dampFactor, lerp } from "../core/math";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { GROUP_QUERY_CAMERA } from "../physics/CollisionLayers";

export type CameraMode = "follow" | "orbit" | "cinematic";

/**
 * Third-person orbit camera. Mouse drives yaw/pitch, the pivot trails the
 * cat with separate horizontal/vertical smoothing (jumps don't jolt the
 * view), occlusion pulls the camera in quickly and eases it back out.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "orbit";
  yaw = Math.PI * 0.75;
  pitch = 0.22;
  distance = 4.6;
  baseFov = 62;
  sprintFov = 71;
  sensitivity = 0.0022;
  /** 0..1 sprint factor driven by gameplay. */
  sprintBlend = 0;

  readonly pivot = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private currentDistance = 4.6;
  private trauma = 0;
  private readonly punch = new THREE.Vector3();
  private readonly punchVel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private time = 0;

  // cinematic
  private readonly cinePos = new THREE.Vector3();
  private readonly cineLook = new THREE.Vector3();
  private cineLambda = 3;
  // orbit
  private orbitCenter = new THREE.Vector3();
  private orbitRadius = 14;
  private orbitHeight = 6;
  private orbitSpeed = 0.06;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.08, 600);
    this.camera.position.set(0, 8, 14);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Horizontal forward (unit) of the camera view. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Point the follow camera behind a facing direction (yaw of the cat). */
  snapBehind(catYaw: number, pivot: THREE.Vector3): void {
    // Cat faces (sin y, cos y); camera forward should match.
    this.yaw = catYaw + Math.PI;
    this.pivot.copy(pivot);
    this.currentDistance = this.distance;
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Quick directional kick (pounce impact). */
  kick(dir: THREE.Vector3, strength: number): void {
    this.punchVel.addScaledVector(dir, strength);
  }

  setOrbit(center: THREE.Vector3, radius: number, height: number, speed = 0.06): void {
    this.mode = "orbit";
    this.orbitCenter.copy(center);
    this.orbitRadius = radius;
    this.orbitHeight = height;
    this.orbitSpeed = speed;
  }

  setCinematic(pos: THREE.Vector3, look: THREE.Vector3, lambda = 3, snap = false): void {
    this.mode = "cinematic";
    this.cinePos.copy(pos);
    this.cineLook.copy(look);
    this.cineLambda = lambda;
    if (snap) {
      this.camera.position.copy(pos);
      this.lookTarget.copy(look);
      this.camera.lookAt(look);
    }
  }

  applyMouse(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch + dy * this.sensitivity, -0.35, 1.15);
  }

  /** Gentle auto-follow when the mouse isn't steering (no pointer lock). */
  autoFollow(catYaw: number, speed: number, dt: number): void {
    if (speed < 1) return;
    this.yaw = dampAngle(this.yaw, catYaw + Math.PI, 1.6, dt);
  }

  update(dt: number, target: THREE.Vector3 | null, physics: PhysicsWorld | null, followLambda = 14): void {
    this.time += dt;
    // Spring the punch offset back to rest.
    this.punchVel.addScaledVector(this.punch, -220 * dt);
    this.punchVel.multiplyScalar(Math.exp(-18 * dt));
    this.punch.addScaledVector(this.punchVel, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    const fov = lerp(this.baseFov, this.sprintFov, this.sprintBlend);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    if (this.mode === "follow" && target) {
      const k = dampFactor(followLambda, dt);
      const ky = dampFactor(7, dt);
      this.pivot.x += (target.x - this.pivot.x) * k;
      this.pivot.z += (target.z - this.pivot.z) * k;
      this.pivot.y += (target.y - this.pivot.y) * ky;
      const cp = Math.cos(this.pitch);
      const dir = this.tmp.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
      let want = this.distance;
      if (physics) {
        const hit = physics.raycast(this.pivot, dir, this.distance + 0.3, GROUP_QUERY_CAMERA);
        if (hit) want = clamp(hit.distance - 0.3, 0.7, this.distance);
      }
      const lambda = want < this.currentDistance ? 30 : 3.5;
      this.currentDistance = damp(this.currentDistance, want, lambda, dt);
      this.camera.position.copy(this.pivot).addScaledVector(dir, this.currentDistance);
      // Keep the camera above the ground it is looking past.
      this.lookTarget.copy(this.pivot);
    } else if (this.mode === "orbit") {
      const a = this.time * this.orbitSpeed + 0.6;
      const desired = this.tmp.set(
        this.orbitCenter.x + Math.cos(a) * this.orbitRadius,
        this.orbitCenter.y + this.orbitHeight,
        this.orbitCenter.z + Math.sin(a) * this.orbitRadius,
      );
      this.camera.position.lerp(desired, dampFactor(2, dt));
      this.lookTarget.lerp(this.orbitCenter, dampFactor(3, dt));
    } else if (this.mode === "cinematic") {
      this.camera.position.lerp(this.cinePos, dampFactor(this.cineLambda, dt));
      this.lookTarget.lerp(this.cineLook, dampFactor(this.cineLambda * 1.2, dt));
    }

    // Shake + punch
    const shake = this.trauma * this.trauma;
    const t = this.time * 40;
    this.tmp2.set(
      Math.sin(t * 1.3) * 0.11 * shake + this.punch.x,
      Math.sin(t * 1.7 + 1.2) * 0.08 * shake + this.punch.y,
      Math.sin(t * 1.1 + 2.4) * 0.11 * shake + this.punch.z,
    );
    this.camera.position.add(this.tmp2);
    this.camera.lookAt(this.lookTarget.x + this.tmp2.x * 0.5, this.lookTarget.y + this.tmp2.y * 0.5, this.lookTarget.z + this.tmp2.z * 0.5);
  }
}
