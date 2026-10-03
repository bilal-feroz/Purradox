import * as THREE from "three";
import { FISH_COLORS } from "../data/palette";
import { ico, loft, lowPoly, merge, place, sphere } from "../rendering/LowPoly";
import type { CatActor } from "../cats/CatActor";
import type { EventBus } from "../core/EventBus";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Effects } from "../rendering/Effects";
import { FishGrip, MAX_GRIP } from "./FishGrip";

export type FishState = "table" | "carried" | "flying" | "loose";

/** Hero fish model from the turnaround sheet. Local +X = head. */
export function buildHeroFish(mat: THREE.Material, eyeMat: THREE.Material): THREE.Group {
  const C = FISH_COLORS;
  const g = new THREE.Group();
  const bodyGeo = loft(
    [
      [-0.31, 0.028, 0.05, 0],
      [-0.24, 0.05, 0.09, 0],
      [-0.1, 0.08, 0.14, 0.004],
      [0.05, 0.092, 0.152, 0.004],
      [0.18, 0.082, 0.13, -0.004],
      [0.27, 0.056, 0.09, -0.012],
      [0.325, 0.022, 0.04, -0.018],
    ],
    9,
  );
  bodyGeo.rotateY(Math.PI / 2);
  const body = lowPoly(
    bodyGeo,
    (c) => {
      if (c.x > 0.16 && c.x < 0.2 && c.y > -0.07 && c.y < 0.08) return C.gill;
      if (c.y > 0.06) return C.back;
      if (c.y > -0.035) return C.body;
      return C.belly;
    },
    { variance: 0.05 },
  );
  // forked tail
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-0.2, 0.17);
  tailShape.lineTo(-0.15, 0.015);
  tailShape.lineTo(-0.2, -0.15);
  tailShape.closePath();
  const tail = lowPoly(new THREE.ExtrudeGeometry(tailShape, { depth: 0.024, bevelEnabled: false }), C.fins, { variance: 0.06 });
  tail.translate(-0.29, 0, -0.012);
  // dorsal fin
  const dShape = new THREE.Shape();
  dShape.moveTo(0.1, 0);
  dShape.lineTo(-0.05, 0.13);
  dShape.lineTo(-0.12, 0);
  dShape.closePath();
  const dorsal = lowPoly(new THREE.ExtrudeGeometry(dShape, { depth: 0.016, bevelEnabled: false }), C.fins, { variance: 0.05 });
  dorsal.translate(0, 0.13, -0.008);
  // belly fin
  const bShape = new THREE.Shape();
  bShape.moveTo(0.04, 0);
  bShape.lineTo(-0.06, -0.07);
  bShape.lineTo(-0.08, 0);
  bShape.closePath();
  const bellyFin = lowPoly(new THREE.ExtrudeGeometry(bShape, { depth: 0.014, bevelEnabled: false }), C.fins);
  bellyFin.translate(-0.08, -0.12, -0.007);
  const parts: THREE.BufferGeometry[] = [body, tail, dorsal, bellyFin];
  // pectoral fins
  for (const s of [1, -1]) {
    const pShape = new THREE.Shape();
    pShape.moveTo(0, 0);
    pShape.lineTo(-0.1, -0.05);
    pShape.lineTo(-0.07, 0.02);
    pShape.closePath();
    const pf = lowPoly(new THREE.ExtrudeGeometry(pShape, { depth: 0.01, bevelEnabled: false }), C.fins);
    place(pf, 0.13, -0.05, s * 0.085, s * 0.5);
    parts.push(pf);
  }
  // open mouth
  parts.push(place(lowPoly(sphere(0.03, 6, 4), C.gill), 0.322, -0.022, 0, 0, 0, 0, 0.6, 0.8, 1));
  const bodyMesh = new THREE.Mesh(merge(parts), mat);
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  // eyes
  const eyeParts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    eyeParts.push(place(lowPoly(sphere(0.046, 8, 6), C.eye, { variance: 0.04 }), 0.215, 0.03, s * 0.06, 0, 0, 0, 0.9, 1, 0.5));
    eyeParts.push(place(lowPoly(sphere(0.024, 6, 5), C.pupil, { variance: 0 }), 0.222, 0.03, s * 0.082, 0, 0, 0, 0.9, 1, 0.4));
    eyeParts.push(place(lowPoly(ico(0.009, 0), 0xffffff, { variance: 0 }), 0.232, 0.045, s * 0.088));
  }
  const eyes = new THREE.Mesh(merge(eyeParts), eyeMat);
  g.add(eyes);
  g.scale.setScalar(0.78);
  return g;
}

const _v = new THREE.Vector3();

/**
 * The single hero fish and its ownership rules: on the market table,
 * carried in a cat's mouth (with Fish Grip), flying after a drop, or
 * loose and collectible.
 */
export class FishSystem {
  readonly model: THREE.Group;
  state: FishState = "table";
  owner: CatActor | null = null;
  readonly grip = new FishGrip();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private readonly tablePos: THREE.Vector3;
  private bounces = 0;
  private looseTime = 0;
  private flopTimer = 0;
  /** Carried-fish flop bursts: seconds until the next one, and time left in the current one. */
  private carryFlopWait = 2;
  private carryFlop = 0;
  private sparkleTimer = 0;
  /** Round 2: only this cat may take the fish off the table. */
  reservedFor: CatActor | null = null;
  /** Who may pick the fish up at all. */
  canPickup: (cat: CatActor) => boolean = () => true;
  /** Grip a cat gets when it picks the fish up. */
  pickupGrip: (cat: CatActor, fromTable: boolean) => number = () => MAX_GRIP;
  private readonly lockouts = new Map<CatActor, number>();
  lastCarrier: CatActor | null = null;
  readonly beacon: THREE.Mesh;
  /** Called on every pickup (after state change). */
  onPickup: ((cat: CatActor, recovered: boolean, stolen: boolean) => void) | null = null;
  onDrop: ((from: CatActor, by: CatActor | null) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus,
    private readonly effects: Effects,
    mat: THREE.Material,
    eyeMat: THREE.Material,
    tablePos: THREE.Vector3,
  ) {
    this.model = buildHeroFish(mat, eyeMat);
    scene.add(this.model);
    this.tablePos = tablePos.clone();
    const ringGeo = new THREE.RingGeometry(0.42, 0.55, 20);
    ringGeo.rotateX(-Math.PI / 2);
    this.beacon = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    scene.add(this.beacon);
    this.reset();
  }

  get carried(): boolean {
    return this.state === "carried";
  }

  reset(): void {
    if (this.owner) this.owner.carrying = false;
    this.owner = null;
    this.lastCarrier = null;
    this.state = "table";
    this.grip.reset();
    this.position.copy(this.tablePos);
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.lockouts.clear();
    this.reservedFor = null;
    this.looseTime = 0;
    this.bounces = 0;
    this.placeOnTable();
  }

  private placeOnTable(): void {
    this.detachToScene();
    this.model.scale.setScalar(0.95);
    this.model.position.copy(this.tablePos);
    this.model.rotation.set(0, 0.35, 0);
  }

  private detachToScene(): void {
    const scene = this.beacon.parent;
    if (scene && this.model.parent !== scene) scene.attach(this.model);
  }

  /** Attach to a cat's mouth socket. */
  private attachTo(cat: CatActor): void {
    cat.rig.mouthSocket.add(this.model);
    this.model.position.set(0.03, -0.035, 0.0);
    this.model.rotation.set(0, Math.PI, 0.12);
    this.model.scale.setScalar(0.6 / cat.rig.def.proportions.scale);
  }

  pickup(cat: CatActor): void {
    const prev = this.lastCarrier;
    const fromTable = this.state === "table";
    this.state = "carried";
    this.owner = cat;
    cat.carrying = true;
    this.grip.reset(this.pickupGrip(cat, fromTable));
    this.attachTo(cat);
    const recovered = !fromTable && prev === cat;
    const stolen = !fromTable && prev !== null && prev !== cat;
    this.lastCarrier = cat;
    this.effects.sparkle(cat.center(_v).setY(cat.position.y + 0.7), 14, 0xfff3b0, 2.4, 0.6);
    this.effects.ring(cat.position, 1.6, 0xfff0b0, 0.4);
    this.bus.emit("fishPickup", { cat: cat.id, recovered, stolen, x: cat.position.x, y: cat.position.y, z: cat.position.z });
    this.bus.emit("gripChanged", { cat: cat.id, grip: this.grip.value });
    this.onPickup?.(cat, recovered, stolen);
  }

  /** A successful pounce on the carrier. Returns true if the fish dropped. */
  damageGrip(target: CatActor, attacker: CatActor | null, floor = 0): boolean {
    if (this.owner !== target || this.state !== "carried") return false;
    const r = this.grip.damage(floor);
    this.bus.emit("gripChanged", { cat: target.id, grip: r.after });
    if (r.dropped) {
      const away = new THREE.Vector3();
      if (attacker) away.subVectors(target.position, attacker.position).setY(0);
      if (away.lengthSq() < 1e-4) away.set(Math.sin(target.yaw), 0, Math.cos(target.yaw));
      away.normalize();
      // Knocked up and mostly sideways: it lands between the two cats, so
      // whoever reacts first (usually the attacker) gets it.
      const side = (Math.floor(this.position.x * 7 + this.position.z * 13) & 1) === 0 ? 1 : -1;
      const dir = new THREE.Vector3(-away.z * side, 0, away.x * side).multiplyScalar(0.85).addScaledVector(away, 0.2).normalize();
      this.drop(target, attacker, dir);
      return true;
    }
    return false;
  }

  drop(from: CatActor, by: CatActor | null, dir: THREE.Vector3): void {
    if (this.state !== "carried" || this.owner !== from) return;
    from.carrying = false;
    this.owner = null;
    this.state = "flying";
    this.model.getWorldPosition(this.position);
    this.detachToScene();
    this.model.scale.setScalar(0.78);
    // Pop up and a little sideways, so the attacker gets a fair grab.
    this.velocity.set(dir.x * 2.4 + from.velocity.x * 0.2, 6.4, dir.z * 2.4 + from.velocity.z * 0.2);
    this.spin.set(9, 4, 12);
    this.bounces = 0;
    // the cat that just lost it can't snatch it straight back
    this.lockouts.set(from, 1.8);
    this.effects.sparkle(this.position, 22, 0xfff3b0, 3.4, 0.8);
    this.bus.emit("fishDrop", { cat: from.id, by: by ? by.id : null, x: this.position.x, y: this.position.y, z: this.position.z });
    this.onDrop?.(from, by);
  }

  /** Force the fish back into a carrier's mouth (world reset, replays). */
  forceCarry(cat: CatActor, grip: number): void {
    if (this.owner && this.owner !== cat) this.owner.carrying = false;
    this.state = "carried";
    this.owner = cat;
    this.lastCarrier = cat;
    cat.carrying = true;
    this.grip.reset(grip);
    this.attachTo(cat);
  }

  /** Put the fish in a specific world pose (rewind playback). */
  setWorldPose(p: THREE.Vector3, state: FishState): void {
    if (this.owner) this.owner.carrying = false;
    this.owner = null;
    this.state = state;
    this.detachToScene();
    this.model.scale.setScalar(0.78);
    this.position.copy(p);
    this.model.position.copy(p);
  }

  update(dt: number, cats: CatActor[], time: number): void {
    for (const [cat, t] of this.lockouts) {
      const nt = t - dt;
      if (nt <= 0) this.lockouts.delete(cat);
      else this.lockouts.set(cat, nt);
    }
    this.beacon.visible = false;
    switch (this.state) {
      case "table": {
        this.model.position.copy(this.tablePos);
        this.model.position.y += 0.04 + Math.sin(time * 2.2) * 0.03;
        this.model.rotation.y = 0.35 + Math.sin(time * 0.9) * 0.25;
        // golden "steal me" ring on the ice
        this.beacon.visible = !this.reservedFor;
        this.beacon.position.set(this.tablePos.x, this.tablePos.y - 0.1, this.tablePos.z);
        this.beacon.scale.setScalar(1.25 + Math.sin(time * 4) * 0.12);
        this.sparkleTimer -= dt;
        if (this.sparkleTimer <= 0) {
          this.sparkleTimer = 0.17;
          this.effects.twinkle(_v.copy(this.tablePos).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 0.35, (Math.random() - 0.5) * 0.5)), 0xfff6c9, 0.13);
        }
        this.tryPickups(cats, 1.75, 1.5);
        break;
      }
      case "flying": {
        this.velocity.y -= 22 * dt;
        this.position.addScaledVector(this.velocity, dt);
        this.model.position.copy(this.position);
        this.model.rotation.x += this.spin.x * dt;
        this.model.rotation.y += this.spin.y * dt;
        this.model.rotation.z += this.spin.z * dt;
        if (this.velocity.y < 0) {
          const ground = this.physics.groundHeight(this.position.x, this.position.y + 0.6, this.position.z, 40);
          if (ground !== null && this.position.y <= ground + 0.08) {
            this.position.y = ground + 0.08;
            if (this.bounces === 0 && this.velocity.y < -3) {
              this.velocity.y *= -0.35;
              this.velocity.x *= 0.5;
              this.velocity.z *= 0.5;
              this.bounces++;
              this.effects.dust(this.position, 4, 0.4, 0.6, 0.1);
            } else {
              this.state = "loose";
              this.looseTime = 0;
              this.flopTimer = 0.4;
              this.velocity.set(0, 0, 0);
              this.effects.sparkle(this.position, 10, 0xfff3b0, 1.6, 0.6);
              this.bus.emit("fishLanded", { x: this.position.x, y: this.position.y, z: this.position.z });
            }
          }
        }
        if (this.position.y < -6) {
          // Lost to the sea — wash it back to the last carrier's position.
          const back = this.lastCarrier ? this.lastCarrier.movement.lastSafe : this.tablePos;
          this.position.copy(back).setY(back.y + 1.5);
          this.velocity.set(0, 2, 0);
        }
        // Mid-air catches near the end of the arc feel great.
        if (this.velocity.y < 0) this.tryPickups(cats, 0.9, 0.9);
        break;
      }
      case "loose": {
        this.looseTime += dt;
        this.flopTimer -= dt;
        // flop animation
        const flop = Math.max(0, Math.sin(this.looseTime * 9)) * Math.max(0, Math.sin(this.looseTime * 1.7));
        this.model.position.set(this.position.x, this.position.y + flop * 0.12, this.position.z);
        this.model.rotation.set(Math.PI / 2 + Math.sin(this.looseTime * 18) * 0.3 * flop, this.looseTime * 0.3, Math.sin(this.looseTime * 12) * 0.25);
        this.beacon.visible = true;
        this.beacon.position.set(this.position.x, this.position.y - 0.05, this.position.z);
        const pulse = 1 + Math.sin(time * 6) * 0.15;
        this.beacon.scale.setScalar(pulse);
        this.sparkleTimer -= dt;
        if (this.sparkleTimer <= 0) {
          this.sparkleTimer = 0.18;
          this.effects.twinkle(_v.copy(this.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.7)));
        }
        this.tryPickups(cats, 1.0, 1.3);
        break;
      }
      case "carried": {
        if (this.owner) {
          // gentle wiggle in the mouth, and every few seconds a proper flop
          this.carryFlopWait -= dt;
          if (this.carryFlopWait <= 0) {
            this.carryFlopWait = 1.8 + Math.random() * 2.6;
            this.carryFlop = 0.42;
          }
          this.carryFlop = Math.max(0, this.carryFlop - dt);
          const flop = this.carryFlop > 0 ? Math.sin((this.carryFlop / 0.42) * Math.PI) : 0;
          this.model.rotation.z = 0.12 + Math.sin(time * 9) * 0.06 + Math.sin(time * 23) * 0.22 * flop;
          this.model.rotation.y = Math.PI + Math.sin(time * 31) * 0.38 * flop;
          this.model.getWorldPosition(this.position);
        }
        break;
      }
    }
  }

  private tryPickups(cats: CatActor[], radius: number, vertical: number): void {
    let best: CatActor | null = null;
    let bestD = Infinity;
    for (const cat of cats) {
      if (!cat.active) continue;
      if (cat.staggerT > 0 || cat.forcedAction !== null) continue;
      if (this.lockouts.has(cat)) continue;
      if (this.state === "table" && this.reservedFor && this.reservedFor !== cat) continue;
      if (!this.canPickup(cat)) continue;
      // mouth is ahead of the body center
      const fx = cat.position.x + Math.sin(cat.yaw) * 0.35;
      const fz = cat.position.z + Math.cos(cat.yaw) * 0.35;
      const d = Math.hypot(this.position.x - fx, this.position.z - fz);
      const dy = Math.abs(this.position.y - (cat.position.y + 0.3));
      if (d < radius && dy < vertical && d < bestD) {
        best = cat;
        bestD = d;
      }
    }
    if (best) this.pickup(best);
  }
}
