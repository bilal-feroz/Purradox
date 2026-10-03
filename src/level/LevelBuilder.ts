import * as THREE from "three";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { GROUP_WORLD, Layer, groups } from "../physics/CollisionLayers";
import { box, lowPoly, merge, place, wedge, type ColorFn } from "../rendering/LowPoly";
import type { Materials } from "../rendering/Materials";

export type Bucket = "world" | "glow";

/** Colliders that do not block the camera (thin props, posts). */
const GROUP_PROP_WORLD = groups(Layer.WORLD, 0xffff);

/**
 * Accumulates painted static geometry into a few material buckets and
 * registers matching Rapier colliders. finalize() merges everything into
 * one mesh per bucket — the whole static town is a handful of draw calls.
 */
export class LevelBuilder {
  private readonly buckets = new Map<Bucket, THREE.BufferGeometry[]>();
  readonly meshes: THREE.Mesh[] = [];
  triangleCount = 0;

  constructor(readonly physics: PhysicsWorld) {}

  add(geo: THREE.BufferGeometry, bucket: Bucket = "world"): void {
    let list = this.buckets.get(bucket);
    if (!list) {
      list = [];
      this.buckets.set(bucket, list);
    }
    list.push(geo);
  }

  /** Static collider for an axis-aligned box given by min/max corners. */
  collider(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, blocksCamera = true): void {
    this.physics.addBox(
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      (z0 + z1) / 2,
      Math.abs(x1 - x0) / 2,
      Math.abs(y1 - y0) / 2,
      Math.abs(z1 - z0) / 2,
      0,
      blocksCamera ? GROUP_WORLD : GROUP_PROP_WORLD,
    );
  }

  /** Rotated (about Y) box collider: center + half extents. */
  colliderRot(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY: number, blocksCamera = true): void {
    this.physics.addBox(cx, cy, cz, hx, hy, hz, rotY, blocksCamera ? GROUP_WORLD : GROUP_PROP_WORLD);
  }

  /** Solid painted box spanning min/max corners, with collider. */
  block(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: number | ColorFn,
    opts: { collider?: boolean; cell?: number; variance?: number; blocksCamera?: boolean } = {},
  ): void {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-3 || h < 1e-3 || d < 1e-3) return;
    const cell = opts.cell ?? 0;
    const sx = cell > 0 ? Math.max(1, Math.round(w / cell)) : 1;
    const sy = cell > 0 ? Math.max(1, Math.round(h / (cell * 0.55))) : 1;
    const sz = cell > 0 ? Math.max(1, Math.round(d / cell)) : 1;
    const g = box(w, h, d, sx, sy, sz);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(lowPoly(g, color, { variance: opts.variance ?? 0.04 }));
    if (opts.collider !== false) this.collider(x0, x1, y0, y1, z0, z1, opts.blocksCamera !== false);
  }

  /**
   * Walkable ramp along an axis. Visual is a wedge on a base; collider is a
   * rotated box whose top surface matches the slope.
   */
  ramp(x0: number, x1: number, z0: number, z1: number, yLow: number, yHigh: number, axis: "x+" | "x-" | "z+" | "z-", color: number): void {
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const rise = yHigh - yLow;
    const run = axis.startsWith("x") ? w : d;
    const across = axis.startsWith("x") ? d : w;
    // visual: wedge rising along +Z in local space, then rotate
    const rotY = axis === "z+" ? 0 : axis === "z-" ? Math.PI : axis === "x+" ? Math.PI / 2 : -Math.PI / 2;
    const geo = wedge(across, rise, run);
    place(geo, cx, yLow, cz, rotY);
    this.add(lowPoly(geo, color, { variance: 0.04 }));
    // base under the wedge so it reads as solid
    // collider: slab rotated about the across-axis
    const len = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const thick = 0.5;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    if (axis === "z+") e.set(-angle, 0, 0);
    else if (axis === "z-") e.set(angle, 0, 0);
    else if (axis === "x+") e.set(0, 0, angle);
    else e.set(0, 0, -angle);
    q.setFromEuler(e);
    const center = new THREE.Vector3(cx, yLow + rise / 2, cz);
    // push the slab down so its top surface sits on the slope line
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    center.addScaledVector(normal, -thick / 2);
    const half = axis.startsWith("x") ? new THREE.Vector3(len / 2, thick / 2, across / 2) : new THREE.Vector3(across / 2, thick / 2, len / 2);
    this.physics.addOrientedBox(center, half, q);
  }

  /**
   * Broad steps. Visual steps; collider is a smooth ramp so cats glide up.
   */
  stairs(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    yLow: number,
    yHigh: number,
    axis: "x+" | "x-" | "z+" | "z-",
    color: number,
    stepColor?: number,
  ): void {
    const rise = yHigh - yLow;
    const run = axis.startsWith("x") ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const n = Math.max(2, Math.round(rise / 0.2));
    const stepRun = run / n;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    for (let i = 0; i < n; i++) {
      const top = yLow + (rise * (i + 1)) / n;
      const c = i % 2 === 0 ? color : (stepColor ?? color);
      let a0: number, a1: number;
      if (axis === "z+") {
        a0 = minZ + i * stepRun;
        a1 = maxZ;
        this.block(minX, maxX, yLow - 0.3, top, a0, a1, c, { collider: false, variance: 0.035 });
      } else if (axis === "z-") {
        a0 = minZ;
        a1 = maxZ - i * stepRun;
        this.block(minX, maxX, yLow - 0.3, top, a0, a1, c, { collider: false, variance: 0.035 });
      } else if (axis === "x+") {
        a0 = minX + i * stepRun;
        a1 = maxX;
        this.block(a0, a1, yLow - 0.3, top, minZ, maxZ, c, { collider: false, variance: 0.035 });
      } else {
        a0 = minX;
        a1 = maxX - i * stepRun;
        this.block(a0, a1, yLow - 0.3, top, minZ, maxZ, c, { collider: false, variance: 0.035 });
      }
    }
    // Smooth collider ramp lifted half a step so paws sit on the step line.
    const half = rise / n / 2;
    this.rampCollider(minX, maxX, minZ, maxZ, yLow + half, yHigh + half, axis);
  }

  rampCollider(minX: number, maxX: number, minZ: number, maxZ: number, yLow: number, yHigh: number, axis: "x+" | "x-" | "z+" | "z-"): void {
    const run = axis.startsWith("x") ? maxX - minX : maxZ - minZ;
    const across = axis.startsWith("x") ? maxZ - minZ : maxX - minX;
    const rise = yHigh - yLow;
    const len = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run);
    const thick = 0.6;
    const e = new THREE.Euler();
    if (axis === "z+") e.set(-angle, 0, 0);
    else if (axis === "z-") e.set(angle, 0, 0);
    else if (axis === "x+") e.set(0, 0, angle);
    else e.set(0, 0, -angle);
    const q = new THREE.Quaternion().setFromEuler(e);
    const center = new THREE.Vector3((minX + maxX) / 2, yLow + rise / 2, (minZ + maxZ) / 2);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    center.addScaledVector(normal, -thick / 2 + 0.02);
    const half = axis.startsWith("x") ? new THREE.Vector3(len / 2, thick / 2, across / 2) : new THREE.Vector3(across / 2, thick / 2, len / 2);
    this.physics.addOrientedBox(center, half, q);
  }

  finalize(scene: THREE.Scene, mats: Materials): void {
    for (const [bucket, list] of this.buckets) {
      const geo = merge(list);
      geo.computeBoundingSphere();
      const mat = bucket === "glow" ? mats.glow : mats.world;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = bucket === "world";
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      this.meshes.push(mesh);
      this.triangleCount += geo.getAttribute("position").count / 3;
    }
    this.buckets.clear();
  }
}
