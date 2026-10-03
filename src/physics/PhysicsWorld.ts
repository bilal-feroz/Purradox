import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GROUP_QUERY_WORLD, GROUP_WORLD } from "./CollisionLayers";

export type Rapier = typeof RAPIER;

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
}

/**
 * Thin wrapper over Rapier: static level colliders, ray queries and the
 * kinematic character controller factory. Gravity is handled by our own
 * movement code, so the world only needs to keep its query structures fresh.
 */
export class PhysicsWorld {
  /** Rapier (with its inlined WebAssembly) is loaded as a separate chunk. */
  static async create(): Promise<PhysicsWorld> {
    const mod = await import("@dimforge/rapier3d-compat");
    const R = mod.default;
    await R.init();
    return new PhysicsWorld(R);
  }

  readonly world: RAPIER.World;
  private readonly staticBody: RAPIER.RigidBody;
  private readonly tmpRay: RAPIER.Ray;
  staticColliderCount = 0;

  private constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    this.staticBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.tmpRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(dt: number): void {
    this.world.timestep = Math.max(1 / 240, Math.min(dt, 1 / 30));
    this.world.step();
  }

  /** Axis-aligned or Y-rotated static box. center/half extents in world units. */
  addBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    rotY = 0,
    groupsOverride = GROUP_WORLD,
  ): RAPIER.Collider {
    const desc = this.R.ColliderDesc.cuboid(Math.max(hx, 0.01), Math.max(hy, 0.01), Math.max(hz, 0.01))
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groupsOverride)
      .setFriction(0);
    if (rotY !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    this.staticColliderCount++;
    return this.world.createCollider(desc, this.staticBody);
  }

  /** Static box with an arbitrary rotation (used for ramps). */
  addOrientedBox(center: THREE.Vector3, half: THREE.Vector3, rotation: THREE.Quaternion): RAPIER.Collider {
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setCollisionGroups(GROUP_WORLD)
      .setFriction(0);
    this.staticColliderCount++;
    return this.world.createCollider(desc, this.staticBody);
  }

  addCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = this.R.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(GROUP_WORLD)
      .setFriction(0);
    this.staticColliderCount++;
    return this.world.createCollider(desc, this.staticBody);
  }

  createCharacterController(offset = 0.02): RAPIER.KinematicCharacterController {
    return this.world.createCharacterController(offset);
  }

  /**
   * Cast a ray and return the first hit. By default only static world
   * geometry is considered.
   */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filterGroups = GROUP_QUERY_WORLD,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    this.tmpRay.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.tmpRay.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.tmpRay, maxDist, true, undefined, filterGroups, exclude);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Height of the walkable surface below (x, fromY, z), or null. */
  groundHeight(x: number, fromY: number, z: number, maxDrop = 30): number | null {
    const hit = this.raycast(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), maxDrop);
    return hit ? hit.point.y : null;
  }

  /** True if a straight segment between two points is free of static geometry. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    return this.raycast(a, d, len) === null;
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }
}
