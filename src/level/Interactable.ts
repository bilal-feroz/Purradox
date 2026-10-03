import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { PALETTE } from "../data/palette";
import { INTERACTABLES } from "../data/level";
import { clamp01, easeOutCubic } from "../core/math";
import type { CatActor } from "../cats/CatActor";
import type { EventBus } from "../core/EventBus";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Effects } from "../rendering/Effects";
import { box, cone, cyl, cylUp, ico, lowPoly, merge, place, shade } from "../rendering/LowPoly";
import type { Materials } from "../rendering/Materials";
import type { Rewindable } from "../replay/WorldHistory";
import type { Resettable } from "./ResetManager";

export type InteractableId = "trashCan" | "pigeonFeed" | "fishScraps" | "bottle" | "laundry";

export interface InteractContext {
  /** Who triggered it (for distractions / telemetry). */
  cat: CatActor;
  /** Push direction (from cat toward prop). */
  dir: THREE.Vector3;
}

/** Hooks the interactables need from the rest of the game. */
export interface InteractHooks {
  burstPigeons: (p: THREE.Vector3, radius: number) => void;
  distract: (p: THREE.Vector3, radius: number, kind: "scraps" | "pigeons" | "noise" | "laundry", seconds: number, only?: string) => void;
  tangle: (p: THREE.Vector3, radius: number, seconds: number) => void;
}

abstract class Interactable implements Resettable, Rewindable {
  abstract readonly id: InteractableId;
  abstract readonly label: string;
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  radius = 1.7;
  used = false;
  /** 0 → 1 animation progress of the "interacted" state. */
  progress = 0;
  protected readonly dir = new THREE.Vector3(1, 0, 0);

  constructor(pos: THREE.Vector3) {
    this.position = pos.clone();
    this.group.position.copy(pos);
  }

  get resetId(): string {
    return `interactable:${this.id}`;
  }
  get rewindId(): string {
    return `interactable:${this.id}`;
  }

  inRange(cat: CatActor): boolean {
    const d = Math.hypot(cat.position.x - this.position.x, cat.position.z - this.position.z);
    return !this.used && d < this.radius && Math.abs(cat.position.y - this.position.y) < 1.3;
  }

  trigger(ctx: InteractContext, hooks: InteractHooks, effects: Effects): boolean {
    if (this.used) return false;
    this.used = true;
    this.dir.copy(ctx.dir).setY(0);
    if (this.dir.lengthSq() < 1e-4) this.dir.set(1, 0, 0);
    this.dir.normalize();
    this.onTrigger(ctx, hooks, effects);
    return true;
  }

  protected abstract onTrigger(ctx: InteractContext, hooks: InteractHooks, effects: Effects): void;
  abstract update(dt: number, time: number): void;
  protected abstract pose(): void;

  reset(): void {
    this.used = false;
    this.progress = 0;
    this.dir.set(1, 0, 0);
    this.pose();
  }

  captureRewind(): number[] {
    return [this.progress, this.dir.x, this.dir.z];
  }

  applyRewind(s: number[]): void {
    this.progress = s[0];
    this.dir.set(s[1], 0, s[2]);
    if (this.dir.lengthSq() < 1e-4) this.dir.set(1, 0, 0);
    this.used = this.progress > 0.001;
    this.pose();
  }
}

// ---------------------------------------------------------------- trash can
class TrashCan extends Interactable {
  readonly id = "trashCan" as const;
  readonly label = "KNOCK OVER";
  private readonly can = new THREE.Group();
  private readonly lid: THREE.Mesh;
  private readonly collider: RAPIER.Collider;

  constructor(pos: THREE.Vector3, mats: Materials, physics: PhysicsWorld) {
    super(pos);
    const metal = PALETTE.metalBlueGray;
    const body = merge([
      lowPoly(cylUp(0.42, 0.36, 1.0, 9, 3), (c) => (Math.abs(c.y - 0.33) < 0.04 || Math.abs(c.y - 0.66) < 0.04 ? shade(metal, 0.86) : c.y < 0.15 && c.x > 0.1 ? PALETTE.rust : metal), { variance: 0.06 }),
      place(lowPoly(box(0.08, 0.14, 0.2), PALETTE.metalDark), 0.43, 0.75, 0),
      place(lowPoly(box(0.08, 0.14, 0.2), PALETTE.metalDark), -0.43, 0.75, 0),
    ]);
    const bodyMesh = new THREE.Mesh(body, mats.world);
    bodyMesh.castShadow = true;
    this.can.add(bodyMesh);
    this.lid = new THREE.Mesh(
      merge([lowPoly(cyl(0.45, 0.45, 0.07, 9), shade(metal, 1.06), { variance: 0.05 }), place(lowPoly(box(0.3, 0.08, 0.08), PALETTE.metalDark), 0, 0.07, 0)]),
      mats.world,
    );
    this.lid.castShadow = true;
    this.group.add(this.can, this.lid);
    this.collider = physics.addCylinder(pos.x, pos.y + 0.5, pos.z, 0.5, 0.42);
    this.pose();
  }

  protected onTrigger(_ctx: InteractContext, hooks: InteractHooks, effects: Effects): void {
    effects.dust(this.position.clone().addScaledVector(this.dir, 0.6), 8, 0.8, 1.0, 0.18);
    hooks.distract(this.position, 13, "noise", 2.2);
    this.collider.setEnabled(false);
  }

  update(dt: number): void {
    if (this.used && this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / 0.4);
      this.pose();
    }
  }

  protected pose(): void {
    const t = easeOutCubic(clamp01(this.progress));
    // tip over around the base edge in the push direction
    const axis = new THREE.Vector3(this.dir.z, 0, -this.dir.x).normalize();
    const angle = t * (Math.PI / 2 - 0.08);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const pivot = this.dir.clone().multiplyScalar(0.42);
    const offset = pivot.clone().negate().applyQuaternion(q).add(pivot);
    this.can.quaternion.copy(q);
    this.can.position.copy(offset);
    // lid flies off and rolls
    const lt = clamp01(this.progress * 1.2);
    this.lid.position.set(this.dir.x * lt * 1.6, 1.03 * (1 - lt) + Math.sin(lt * Math.PI) * 0.4 + 0.05 * lt, this.dir.z * lt * 1.6);
    this.lid.rotation.set(lt * 1.4, lt * 3, lt * 0.6);
    if (!this.used) {
      this.collider.setEnabled(true);
      this.can.position.set(0, 0, 0);
      this.can.quaternion.identity();
      this.lid.position.set(0, 1.03, 0);
      this.lid.rotation.set(0, 0, 0);
    } else {
      this.collider.setEnabled(false);
    }
  }
}

// ---------------------------------------------------------------- pigeon feed
class PigeonFeed extends Interactable {
  readonly id = "pigeonFeed" as const;
  readonly label = "SPILL THE SEEDS";
  private readonly crate = new THREE.Group();
  private readonly seedsPile: THREE.Mesh;
  private readonly spilled: THREE.Mesh;

  constructor(pos: THREE.Vector3, mats: Materials) {
    super(pos);
    const wood = PALETTE.woodHoney;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 2; i++) {
      parts.push(place(lowPoly(box(0.8, 0.16, 0.05), wood), 0, 0.12 + i * 0.22, 0.3));
      parts.push(place(lowPoly(box(0.8, 0.16, 0.05), wood), 0, 0.12 + i * 0.22, -0.3));
      parts.push(place(lowPoly(box(0.05, 0.16, 0.6), wood), 0.38, 0.12 + i * 0.22, 0));
      parts.push(place(lowPoly(box(0.05, 0.16, 0.6), wood), -0.38, 0.12 + i * 0.22, 0));
    }
    parts.push(place(lowPoly(box(0.78, 0.04, 0.58), shade(wood, 0.8)), 0, 0.03, 0));
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) parts.push(place(lowPoly(box(0.07, 0.48, 0.07), shade(wood, 0.82)), cx * 0.38, 0.24, cz * 0.3));
    const crateMesh = new THREE.Mesh(merge(parts), mats.world);
    crateMesh.castShadow = true;
    this.crate.add(crateMesh);
    const seeds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 22; i++) seeds.push(place(lowPoly(ico(0.05, 0), i % 3 === 0 ? 0xd99d36 : 0xe9b949), (Math.random() - 0.5) * 0.6, 0.38 + Math.random() * 0.08, (Math.random() - 0.5) * 0.45));
    this.seedsPile = new THREE.Mesh(merge(seeds), mats.world);
    this.crate.add(this.seedsPile);
    const spill: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 1.1;
      spill.push(place(lowPoly(box(0.07, 0.04, 0.07), i % 3 === 0 ? 0xd99d36 : 0xe9b949), Math.cos(a) * r, 0.02, Math.sin(a) * r * 0.8 + 0.45, a));
    }
    this.spilled = new THREE.Mesh(merge(spill), mats.world);
    this.group.add(this.crate, this.spilled);
    this.pose();
  }

  protected onTrigger(_ctx: InteractContext, hooks: InteractHooks, effects: Effects): void {
    effects.seeds(this.position.clone().setY(this.position.y + 0.3), 30, this.position.y);
    hooks.burstPigeons(this.position, 9);
    hooks.distract(this.position, 11, "pigeons", 2.6);
  }

  update(dt: number): void {
    if (this.used && this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / 0.35);
      this.pose();
    }
  }

  protected pose(): void {
    const t = easeOutCubic(clamp01(this.progress));
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    this.crate.rotation.set(0, 0, 0);
    this.crate.rotation.y = yaw;
    this.crate.rotateX(t * 1.25);
    this.crate.position.set(this.dir.x * t * 0.25, t * 0.12, this.dir.z * t * 0.25);
    this.seedsPile.visible = t < 0.3;
    this.spilled.visible = t > 0.2;
    this.spilled.rotation.y = yaw;
    this.spilled.scale.setScalar(Math.max(0.01, t));
  }
}

// ---------------------------------------------------------------- fish scraps
class FishScraps extends Interactable {
  readonly id = "fishScraps" as const;
  readonly label = "SPILL THE SCRAPS";
  private readonly tray = new THREE.Group();
  private readonly spill: THREE.Mesh;

  constructor(pos: THREE.Vector3, mats: Materials) {
    super(pos);
    const metal = 0x5d6670;
    const parts = [
      lowPoly(box(0.8, 0.06, 0.55), metal),
      place(lowPoly(box(0.8, 0.14, 0.05), metal), 0, 0.08, 0.26),
      place(lowPoly(box(0.8, 0.14, 0.05), metal), 0, 0.08, -0.26),
      place(lowPoly(box(0.05, 0.14, 0.55), metal), 0.38, 0.08, 0),
      place(lowPoly(box(0.05, 0.14, 0.55), metal), -0.38, 0.08, 0),
    ];
    for (let i = 0; i < 6; i++) parts.push(place(lowPoly(cone(0.07, 0.14, 3), i % 2 ? 0xe07a6a : 0xf0e2c8), -0.25 + i * 0.1, 0.1, (Math.random() - 0.5) * 0.25, Math.random() * 3, 1.4, 0));
    const trayMesh = new THREE.Mesh(merge(parts), mats.world);
    trayMesh.castShadow = true;
    this.tray.add(trayMesh);
    const sp: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.8;
      sp.push(place(lowPoly(cone(0.07, 0.14, 3), i % 3 === 0 ? 0x3f6f86 : i % 2 ? 0xe07a6a : 0xf0e2c8), Math.cos(a) * r, 0.04, Math.sin(a) * r, a, 1.5, 0));
    }
    this.spill = new THREE.Mesh(merge(sp), mats.world);
    this.group.add(this.tray, this.spill);
    this.pose();
  }

  protected onTrigger(_ctx: InteractContext, hooks: InteractHooks, effects: Effects): void {
    effects.scraps(this.position.clone().setY(this.position.y + 0.15), 10, this.position.y);
    hooks.distract(this.position, 18, "scraps", 3.8, "mochi");
  }

  update(dt: number): void {
    if (this.used && this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / 0.3);
      this.pose();
    }
  }

  protected pose(): void {
    const t = easeOutCubic(clamp01(this.progress));
    this.tray.rotation.set(0, Math.atan2(this.dir.x, this.dir.z), 0);
    this.tray.rotateX(t * 0.6);
    this.tray.position.y = t * 0.08;
    this.spill.visible = t > 0.15;
    this.spill.scale.setScalar(Math.max(0.01, t));
  }
}

// ---------------------------------------------------------------- bottle
class Bottle extends Interactable {
  readonly id = "bottle" as const;
  readonly label = "KNOCK THE BOTTLE";
  private readonly bottle = new THREE.Group();

  constructor(pos: THREE.Vector3, mats: Materials) {
    super(pos);
    this.radius = 1.4;
    const glass = 0x2f8f86;
    const g = merge([
      lowPoly(cylUp(0.12, 0.12, 0.36, 8), glass, { variance: 0.08 }),
      place(lowPoly(cyl(0.05, 0.12, 0.12, 8), glass), 0, 0.42, 0),
      place(lowPoly(cylUp(0.045, 0.045, 0.12, 6), glass), 0, 0.47, 0),
      place(lowPoly(cylUp(0.05, 0.05, 0.06, 6), PALETTE.woodLight), 0, 0.58, 0),
    ]);
    const m = new THREE.Mesh(g, mats.glass);
    m.castShadow = true;
    this.bottle.add(m);
    this.group.add(this.bottle);
    this.pose();
  }

  protected onTrigger(_ctx: InteractContext, hooks: InteractHooks): void {
    hooks.distract(this.position, 7, "noise", 1.4);
  }

  update(dt: number): void {
    if (this.used && this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / 1.6);
      this.pose();
    }
  }

  protected pose(): void {
    const t = clamp01(this.progress);
    const fall = clamp01(t * 6);
    const roll = easeOutCubic(clamp01((t - 0.12) / 0.88));
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    this.bottle.rotation.set(0, 0, 0);
    this.bottle.rotation.y = yaw + Math.PI / 2;
    this.bottle.rotateZ(-fall * (Math.PI / 2));
    this.bottle.rotateY(roll * 14);
    this.bottle.position.set(this.dir.x * roll * 1.9, fall * 0.12, this.dir.z * roll * 1.9);
  }
}

// ---------------------------------------------------------------- laundry sheet
class Laundry extends Interactable {
  readonly id = "laundry" as const;
  readonly label = "DROP THE SHEET";
  private readonly sheet: THREE.Mesh;
  private readonly base: Float32Array;
  private time = 0;

  constructor(a: THREE.Vector3, b: THREE.Vector3, mats: Materials) {
    super(a.clone().lerp(b, 0.5));
    this.radius = 2.2;
    this.group.position.set(0, 0, 0);
    const len = a.distanceTo(b);
    const h = 2.3;
    // posts + rope
    const posts = merge([
      place(lowPoly(cylUp(0.08, 0.1, h + 0.1, 6), PALETTE.woodHoney), a.x, a.y, a.z),
      place(lowPoly(cylUp(0.08, 0.1, h + 0.1, 6), PALETTE.woodHoney), b.x, b.y, b.z),
      place(lowPoly(box(0.3, 0.12, 0.3), 0x8b8f93), a.x, a.y + 0.06, a.z),
      place(lowPoly(box(0.3, 0.12, 0.3), 0x8b8f93), b.x, b.y + 0.06, b.z),
      place(lowPoly(box(len, 0.03, 0.03), 0xd8c8a8), (a.x + b.x) / 2, a.y + h, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2),
    ]);
    const pm = new THREE.Mesh(posts, mats.world);
    pm.castShadow = true;
    this.group.add(pm);
    // the big cream sheet (cloth grid)
    const w = len * 0.72;
    const sh = 1.55;
    const geo = new THREE.PlaneGeometry(w, sh, 10, 6);
    geo.translate(0, -sh / 2, 0);
    const flat = lowPoly(geo, (c) => (c.y > -0.08 ? shade(PALETTE.sheetCream, 0.92) : PALETTE.sheetCream), { variance: 0.05 });
    this.base = new Float32Array((flat.getAttribute("position") as THREE.BufferAttribute).array);
    this.sheet = new THREE.Mesh(flat, mats.cloth);
    this.sheet.castShadow = true;
    this.sheet.position.set((a.x + b.x) / 2, a.y + h - 0.02, (a.z + b.z) / 2);
    this.sheet.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
    this.group.add(this.sheet);
    // pegs
    const pegs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) pegs.push(place(lowPoly(box(0.04, 0.12, 0.05), PALETTE.woodLight), -w / 2 + (i * w) / 3, 0.02, 0));
    const pg = new THREE.Mesh(merge(pegs), mats.world);
    this.sheet.add(pg);
  }

  protected onTrigger(_ctx: InteractContext, hooks: InteractHooks): void {
    hooks.tangle(this.position, 2.4, 2.2);
    hooks.distract(this.position, 6, "laundry", 1.2);
  }

  update(dt: number, time: number): void {
    this.time = time;
    if (this.used && this.progress < 1) this.progress = Math.min(1, this.progress + dt / 0.55);
    this.pose();
  }

  protected pose(): void {
    const t = clamp01(this.progress);
    const pos = this.sheet.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = easeOutCubic(t);
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.base[i];
      const y = this.base[i + 1];
      const z = this.base[i + 2];
      const depth = -y; // 0 at the rope, grows downward
      const wave = Math.sin(this.time * 2.4 + x * 1.6) * 0.07 * depth + Math.sin(this.time * 3.7 + x * 3) * 0.02;
      // dropped: fold down onto the roof
      const dropY = y - fall * (2.3 - depth * 0.85);
      const crumple = fall * Math.sin(x * 5 + depth * 4) * 0.12;
      arr[i] = x;
      arr[i + 1] = Math.max(dropY, -2.26 + Math.abs(crumple) * 0.5) * 1;
      arr[i + 2] = z + wave * (1 - fall) + crumple + fall * depth * 0.9;
    }
    pos.needsUpdate = true;
    this.sheet.geometry.computeBoundingSphere();
  }
}

/** Owns every interactable prop on Sardine Street. */
export class Interactables {
  readonly list: Interactable[];

  constructor(scene: THREE.Scene, mats: Materials, physics: PhysicsWorld) {
    const v = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);
    const I = INTERACTABLES;
    this.list = [
      new TrashCan(v(I.trashCan), mats, physics),
      new PigeonFeed(v(I.pigeonFeed), mats),
      new FishScraps(v(I.fishScraps), mats),
      new Bottle(v(I.bottle), mats),
      new Laundry(v(I.laundry.a), v(I.laundry.b), mats),
    ];
    for (const i of this.list) scene.add(i.group);
  }

  get(id: InteractableId): Interactable | undefined {
    return this.list.find((i) => i.id === id);
  }

  nearest(cat: CatActor): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const i of this.list) {
      if (!i.inRange(cat)) continue;
      const d = Math.hypot(cat.position.x - i.position.x, cat.position.z - i.position.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  update(dt: number, time: number): void {
    for (const i of this.list) i.update(dt, time);
  }

  /** Interact-by-id (used by Past You replays and AI). */
  trigger(id: string, cat: CatActor, hooks: InteractHooks, effects: Effects, bus: EventBus): boolean {
    const it = this.list.find((i) => i.id === id);
    if (!it || it.used) return false;
    const dir = new THREE.Vector3().subVectors(it.position, cat.position).setY(0);
    const ok = it.trigger({ cat, dir }, hooks, effects);
    if (ok) bus.emit("interact", { cat: cat.id, target: it.id, x: it.position.x, y: it.position.y, z: it.position.z });
    return ok;
  }
}

export type { Interactable };
