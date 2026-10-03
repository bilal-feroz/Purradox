import * as THREE from "three";
import { box, cone, ico, lowPoly, merge, place, sphere } from "../rendering/LowPoly";
import type { Materials } from "../rendering/Materials";
import type { CatActor } from "../cats/CatActor";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Resettable } from "./ResetManager";

// Personality details with no gameplay weight: a street dog asleep by the
// market wall that opens one eye when things get loud, and a loose
// newspaper that blows down the first alley when a cat dashes past. Both
// reset with the world and never touch the AI, physics or replays.

const FUR = 0xc99a68;
const FUR_DARK = 0x8a5b3a;
const BELLY = 0xead3ae;
const NOSE = 0x2b2220;

/** Asleep by the market wall. Opens one eye (and lifts its head a little) at chaos nearby. */
export class SleepingDog implements Resettable {
  readonly resetId = "ambient:dog";
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly eyeOpen: THREE.Group;
  private readonly eyeShut: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private awake = 0;
  private open = 0;
  private time = 0;
  /** Called every few seconds while the dog sleeps (for a little "zzz"). */
  onSnore: ((at: THREE.Vector3) => void) | null = null;
  private snoreT = 2;
  private readonly headWorld = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    mats: Materials,
    readonly position: THREE.Vector3,
    yaw: number,
  ) {
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    // body lying down (+z is the head end), belly on the cobbles
    const bodyGeo = merge([
      place(lowPoly(sphere(1, 10, 7), (c) => (c.y < -0.4 ? BELLY : FUR), { variance: 0.06 }), 0, 0.23, 0, 0, 0, 0, 0.34, 0.23, 0.6),
      // chest
      place(lowPoly(sphere(0.21, 8, 6), (c) => (c.z > 0.08 ? BELLY : FUR)), 0, 0.22, 0.42),
      // front legs stretched out under the chin
      place(lowPoly(sphere(1, 6, 4), FUR), 0.1, 0.06, 0.66, 0, 0, 0, 0.07, 0.06, 0.22),
      place(lowPoly(sphere(1, 6, 4), FUR), -0.1, 0.06, 0.64, 0, 0, 0, 0.07, 0.06, 0.22),
      place(lowPoly(sphere(0.06, 6, 4), BELLY), 0.1, 0.05, 0.86),
      place(lowPoly(sphere(0.06, 6, 4), BELLY), -0.1, 0.05, 0.84),
      // back leg tucked against the side
      place(lowPoly(sphere(1, 7, 5), FUR), 0.26, 0.15, -0.3, 0, 0, 0, 0.13, 0.15, 0.24),
      place(lowPoly(sphere(0.06, 6, 4), BELLY), 0.3, 0.05, -0.1),
      // a darker saddle patch
      place(lowPoly(sphere(1, 7, 5), FUR_DARK), 0.02, 0.36, -0.12, 0, 0, 0, 0.25, 0.09, 0.3),
    ]);
    this.body = new THREE.Mesh(bodyGeo, mats.world);
    this.body.castShadow = true;
    this.group.add(this.body);
    // head resting on the front paws
    const headGeo = merge([
      place(lowPoly(sphere(1, 8, 6), FUR, { variance: 0.05 }), 0, 0, 0, 0, 0, 0, 0.17, 0.15, 0.19),
      // snout and nose
      place(lowPoly(box(0.13, 0.1, 0.18), BELLY), 0, -0.04, 0.2),
      place(lowPoly(sphere(0.04, 6, 4), NOSE), 0, -0.01, 0.3),
      // long floppy ears hanging down the cheeks
      place(lowPoly(box(0.08, 0.22, 0.035), FUR_DARK), 0.16, -0.07, -0.02, 0, 0, 0.25),
      place(lowPoly(box(0.08, 0.22, 0.035), FUR_DARK), -0.16, -0.07, -0.02, 0, 0, -0.25),
    ]);
    const headMesh = new THREE.Mesh(headGeo, mats.world);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    this.head.position.set(0, 0.2, 0.68);
    this.group.add(this.head);
    // eyes: closed lines on both sides, and one eye that can open
    this.eyeShut = new THREE.Mesh(
      merge([place(lowPoly(box(0.055, 0.01, 0.01), NOSE), 0.075, 0.045, 0.15), place(lowPoly(box(0.055, 0.01, 0.01), NOSE), -0.075, 0.045, 0.15)]),
      mats.world,
    );
    this.head.add(this.eyeShut);
    this.eyeOpen = new THREE.Group();
    this.eyeOpen.add(new THREE.Mesh(lowPoly(ico(0.026, 1), 0xfaf4e6), mats.world));
    const pupil = new THREE.Mesh(lowPoly(ico(0.016, 1), NOSE), mats.world);
    pupil.position.set(0.004, 0, 0.014);
    this.eyeOpen.add(pupil);
    this.eyeOpen.position.set(0.075, 0.048, 0.135);
    this.eyeOpen.scale.set(1, 0.01, 1);
    this.head.add(this.eyeOpen);
    // tail resting on the ground
    this.tail = new THREE.Mesh(lowPoly(cone(0.055, 0.46, 6), FUR, { variance: 0.05 }), mats.world);
    this.tail.geometry.translate(0, 0.23, 0);
    this.tail.position.set(-0.14, 0.08, -0.56);
    this.tail.rotation.set(-1.45, 0, 0.9);
    this.group.add(this.tail);
    this.group.scale.setScalar(1.25);
    parent.add(this.group);
  }

  /** Something loud happened at `p` (only nearby chaos wakes it). */
  disturb(p: { x: number; y: number; z: number }, radius: number): void {
    const d = Math.hypot(p.x - this.position.x, p.z - this.position.z);
    if (d < radius) this.awake = Math.max(this.awake, 1.6 + (1 - d / radius) * 1.8);
  }

  update(dt: number, cats: readonly CatActor[]): void {
    this.time += dt;
    // a cat dashing right past it
    for (const c of cats) {
      if (!c.active) continue;
      const d = Math.hypot(c.position.x - this.position.x, c.position.z - this.position.z);
      if (d < 2.4 && Math.hypot(c.velocity.x, c.velocity.z) > 3) this.awake = Math.max(this.awake, 1.8);
    }
    this.awake = Math.max(0, this.awake - dt);
    const target = this.awake > 0 ? 1 : 0;
    this.open += (target - this.open) * Math.min(1, dt * (target ? 14 : 4));
    this.eyeOpen.scale.set(1, Math.max(0.01, this.open), 1);
    this.eyeShut.scale.set(this.open > 0.5 ? 0 : 1, 1, 1);
    // breathing; awake = head up a touch and a lazy tail thump
    const breathe = 1 + Math.sin(this.time * 1.6) * 0.035 * (1 - this.open);
    this.body.scale.set(1, breathe, 1);
    this.head.rotation.x = -0.22 * this.open + Math.sin(this.time * 1.6) * 0.02;
    this.head.position.y = 0.2 + 0.05 * this.open;
    this.tail.rotation.z = 0.9 + (this.open > 0.5 ? Math.sin(this.time * 7) * 0.2 : 0);
    // the odd snore while it's asleep
    if (this.open < 0.05) {
      this.snoreT -= dt;
      if (this.snoreT <= 0) {
        this.snoreT = 4 + Math.random() * 3;
        this.onSnore?.(this.head.getWorldPosition(this.headWorld));
      }
    }
  }

  reset(): void {
    this.awake = 0;
    this.open = 0;
    this.snoreT = 2;
    this.eyeOpen.scale.set(1, 0.01, 1);
    this.eyeShut.scale.set(1, 1, 1);
  }
}

/** A loose newspaper on the alley floor that tumbles away when disturbed. */
export class Newspaper implements Resettable {
  readonly resetId = "ambient:newspaper";
  readonly mesh: THREE.Mesh;
  private readonly home: THREE.Vector3;
  private readonly pos = new THREE.Vector3();
  private readonly wind: THREE.Vector3;
  private t = -1;
  private settleYaw = 0;
  private dist = 0;

  constructor(
    parent: THREE.Object3D,
    mats: Materials,
    home: THREE.Vector3,
    wind: THREE.Vector3,
    private readonly physics: PhysicsWorld,
  ) {
    this.home = home.clone();
    this.wind = wind.clone().setY(0).normalize();
    // two pages: a headline bar along the top, a photo on the right page
    const ink = (c: THREE.Vector3, right: boolean) => (c.z < -0.12 ? 0x6f6a62 : right && c.z < 0.04 && c.x > 0.05 ? 0x9fb3bb : 0xefe9da);
    const page = (x: number, tilt: number, right: boolean) =>
      place(lowPoly(box(0.26, 0.006, 0.36, 6, 1, 8), (c) => ink(c, right), { variance: 0.03 }), x, 0, 0, 0, 0, tilt);
    this.mesh = new THREE.Mesh(merge([page(-0.13, 0.08, false), page(0.13, -0.08, true)]), mats.world);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
    this.reset();
  }

  /** Something loud nearby (a crash, a burst of pigeons, a hiss right next to it). */
  disturb(p: { x: number; y: number; z: number }, radius: number): void {
    if (this.t >= 0) return;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < radius) this.lift();
  }

  private lift(): void {
    this.t = 0;
    this.dist = 4.5 + Math.random() * 2.5;
  }

  update(dt: number, cats: readonly CatActor[]): void {
    if (this.t < 0) {
      for (const c of cats) {
        if (!c.active) continue;
        if (Math.hypot(c.position.x - this.pos.x, c.position.z - this.pos.z) < 1.5 && Math.hypot(c.velocity.x, c.velocity.z) > 3.5) {
          this.lift();
          break;
        }
      }
      return;
    }
    const DUR = 2.4;
    this.t += dt;
    const u = Math.min(1, this.t / DUR);
    // drifts with the wind, fast at first, with a flutter
    const step = (this.dist / DUR) * 2 * (1 - u) * dt;
    this.pos.addScaledVector(this.wind, step);
    this.pos.x += Math.sin(this.t * 5.3) * 0.25 * dt;
    const ground = this.physics.groundHeight(this.pos.x, this.pos.y + 1.5, this.pos.z, 4) ?? this.home.y;
    const lift = Math.sin(Math.PI * u) * (0.9 + Math.sin(this.t * 3.1) * 0.15);
    this.mesh.position.set(this.pos.x, ground + 0.02 + lift, this.pos.z);
    this.mesh.rotation.set(Math.sin(this.t * 7.3) * 1.1 * (1 - u), this.settleYaw + this.t * 2.2 * (1 - u), Math.sin(this.t * 5.1) * 0.9 * (1 - u));
    if (u >= 1) {
      // settled: flat again, ready to be kicked up once more
      this.t = -1;
      this.pos.y = ground;
      this.settleYaw = this.mesh.rotation.y;
      this.mesh.rotation.set(0, this.settleYaw, 0);
      this.mesh.position.set(this.pos.x, ground + 0.02, this.pos.z);
    }
  }

  reset(): void {
    this.t = -1;
    this.pos.copy(this.home);
    this.settleYaw = 0.4;
    this.mesh.position.set(this.home.x, this.home.y + 0.02, this.home.z);
    this.mesh.rotation.set(0, this.settleYaw, 0);
  }
}
