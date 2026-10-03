import * as THREE from "three";
import { PIGEON_COLORS } from "../data/palette";
import { FOUNTAIN, H } from "../data/level";
import { Random } from "../core/Random";
import { box, cone, ico, lowPoly, merge, place, sphere } from "../rendering/LowPoly";
import type { Materials } from "../rendering/Materials";
import type { Rewindable } from "../replay/WorldHistory";
import type { CatActor } from "../cats/CatActor";
import type { EventBus } from "../core/EventBus";
import type { Effects } from "../rendering/Effects";
import type { Resettable } from "./ResetManager";

type PState = "ground" | "flying" | "perched" | "returning";

interface Pigeon {
  root: THREE.Group;
  body: THREE.Group;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  state: PState;
  t: number;
  target: THREE.Vector3;
  walkTarget: THREE.Vector3;
  walkT: number;
  peck: number;
  flap: number;
  seed: number;
}

/** Shared low-poly pigeon geometry built from the pigeon reference sheet. */
function pigeonGeometry(): { body: THREE.BufferGeometry; wing: THREE.BufferGeometry } {
  const C = PIGEON_COLORS;
  const body = merge([
    lowPoly(place(sphere(0.2, 8, 6), 0, 0.26, 0, 0, 0, 0, 0.85, 0.9, 1.25), (c) => (c.y < 0.2 && c.z > 0.05 ? C.wingLight : C.body), { variance: 0.05 }),
    lowPoly(place(sphere(0.12, 7, 5), 0, 0.4, 0.17, 0, 0, 0, 1, 1, 1), (c) => (c.y < 0.37 ? C.neck : C.body), { variance: 0.05 }),
    lowPoly(place(ico(0.1, 1), 0, 0.53, 0.24), C.head, { variance: 0.04 }),
    lowPoly(place(cone(0.035, 0.09, 4), 0, 0.51, 0.35, 0, Math.PI / 2, 0), C.beak),
    lowPoly(place(ico(0.026, 0), 0.07, 0.56, 0.29), C.eye),
    lowPoly(place(ico(0.026, 0), -0.07, 0.56, 0.29), C.eye),
    lowPoly(place(box(0.16, 0.04, 0.22), 0, 0.27, -0.3, 0, -0.25, 0), C.bands),
    lowPoly(place(box(0.025, 0.12, 0.025), 0.06, 0.07, 0.02), C.feet),
    lowPoly(place(box(0.025, 0.12, 0.025), -0.06, 0.07, 0.02), C.feet),
    lowPoly(place(box(0.07, 0.02, 0.1), 0.06, 0.01, 0.05), C.feet),
    lowPoly(place(box(0.07, 0.02, 0.1), -0.06, 0.01, 0.05), C.feet),
  ]);
  // wing: flat-ish slab with charcoal bands, pivot at the shoulder (x=0)
  const wing = merge([
    lowPoly(place(box(0.3, 0.035, 0.26, 3, 1, 2), 0.15, 0, -0.02), (c) => (c.z < -0.06 && c.z > -0.1 ? C.bands : c.z < 0.0 && c.z > -0.03 ? C.bands : C.wingLight), { variance: 0.06 }),
  ]);
  return { body, wing };
}

/**
 * Courtyard pigeons: peck and wander, burst into the air when startled
 * (feed spills, sprinting cats), perch on rooftops, then drift back down.
 */
export class PigeonFlock implements Resettable {
  readonly resetId = "pigeons";
  readonly pigeons: Pigeon[] = [];
  private readonly rng = new Random(321);
  private readonly perches: THREE.Vector3[];
  burstCount = 0;

  constructor(
    scene: THREE.Scene,
    mats: Materials,
    private readonly bus: EventBus,
    private readonly effects: Effects,
  ) {
    const { body, wing } = pigeonGeometry();
    const homes: Array<[number, number, number]> = [];
    const [fx, , fz] = FOUNTAIN.center;
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2 + this.rng.range(-0.2, 0.2);
      const r = FOUNTAIN.radius + 1.0 + this.rng.range(0, 3.2);
      homes.push([fx + Math.cos(a) * r, H.court, fz + Math.sin(a) * r]);
    }
    homes.push([20.5, H.court, -14.4], [19, H.court, -16.4], [21.2, H.court, -16]);
    homes.push([16, H.roof, -46], [33, H.roof, -52], [-20, H.market, 14], [-14, H.market, 18]);
    this.perches = [
      new THREE.Vector3(10, 5.5, -37.2),
      new THREE.Vector3(18, 5.5, -37.2),
      new THREE.Vector3(27, 5.5, -37.2),
      new THREE.Vector3(37.7, 7.6, -17),
      new THREE.Vector3(-6.2, 11.3, -16),
      new THREE.Vector3(15, 5.2, -21),
      new THREE.Vector3(24, 9.6, -60),
      new THREE.Vector3(-9.5, 13.4, -44.5),
    ];
    for (let i = 0; i < homes.length; i++) {
      const root = new THREE.Group();
      const bodyG = new THREE.Group();
      const bm = new THREE.Mesh(body, mats.world);
      bm.castShadow = true;
      bodyG.add(bm);
      const wingL = new THREE.Group();
      wingL.position.set(0.12, 0.3, 0.02);
      const wl = new THREE.Mesh(wing, mats.world);
      wl.castShadow = true;
      wingL.add(wl);
      const wingR = new THREE.Group();
      wingR.position.set(-0.12, 0.3, 0.02);
      const wr = new THREE.Mesh(wing, mats.world);
      wr.scale.x = -1;
      wingR.add(wr);
      bodyG.add(wingL, wingR);
      root.add(bodyG);
      root.scale.setScalar(this.rng.range(0.92, 1.1));
      scene.add(root);
      const home = new THREE.Vector3(...homes[i]);
      this.pigeons.push({
        root,
        body: bodyG,
        wingL,
        wingR,
        home,
        pos: home.clone(),
        vel: new THREE.Vector3(),
        yaw: this.rng.range(0, Math.PI * 2),
        state: "ground",
        t: 0,
        target: home.clone(),
        walkTarget: home.clone(),
        walkT: this.rng.range(0, 3),
        peck: 0,
        flap: 0,
        seed: this.rng.range(0, 100),
      });
    }
    this.reset();
  }

  reset(): void {
    const rng = new Random(321);
    for (const p of this.pigeons) {
      p.pos.copy(p.home);
      p.vel.set(0, 0, 0);
      p.state = "ground";
      p.t = 0;
      p.walkTarget.copy(p.home);
      p.walkT = rng.range(0, 3);
      p.yaw = rng.range(0, Math.PI * 2);
      p.flap = 0;
      this.pose(p, 0);
    }
    this.burstCount = 0;
  }

  /** Startle every grounded pigeon within radius. */
  burst(at: THREE.Vector3, radius: number): void {
    let n = 0;
    for (const p of this.pigeons) {
      if (p.state !== "ground" && p.state !== "returning") continue;
      if (p.pos.distanceTo(at) > radius) continue;
      this.takeOff(p, at);
      n++;
    }
    if (n > 0) {
      this.burstCount++;
      this.bus.emit("pigeonsBurst", { x: at.x, y: at.y, z: at.z, count: n });
    }
  }

  private takeOff(p: Pigeon, from: THREE.Vector3): void {
    p.state = "flying";
    p.t = 0;
    const away = new THREE.Vector3().subVectors(p.pos, from).setY(0);
    if (away.lengthSq() < 0.01) away.set(this.rng.range(-1, 1), 0, this.rng.range(-1, 1));
    away.normalize();
    // pick the perch most aligned with "away"
    let best = this.perches[0];
    let bestScore = -Infinity;
    for (const per of this.perches) {
      const d = new THREE.Vector3().subVectors(per, p.pos).setY(0);
      const score = d.normalize().dot(away) + this.rng.range(-0.6, 0.6);
      if (score > bestScore) {
        bestScore = score;
        best = per;
      }
    }
    p.target.copy(best).add(new THREE.Vector3(this.rng.range(-1.2, 1.2), 0, this.rng.range(-0.4, 0.4)));
    p.vel.set(away.x * 2.5, 4.5 + this.rng.range(0, 1.5), away.z * 2.5);
    this.effects.feathers(p.pos, 2);
  }

  update(dt: number, cats: CatActor[]): void {
    for (const p of this.pigeons) {
      p.t += dt;
      if (p.state === "ground") {
        // startle from close cats
        for (const c of cats) {
          if (!c.active) continue;
          const d = Math.hypot(c.position.x - p.pos.x, c.position.z - p.pos.z);
          const dy = Math.abs(c.position.y - p.pos.y);
          const fast = Math.hypot(c.velocity.x, c.velocity.z) > 6.2;
          if (dy < 1.2 && (d < 1.05 || (fast && d < 2.4))) {
            this.burst(p.pos.clone(), 2.6);
            break;
          }
        }
      }
      switch (p.state) {
        case "ground": {
          p.walkT -= dt;
          if (p.walkT <= 0) {
            p.walkT = this.rng.range(1.5, 4);
            p.walkTarget.set(p.home.x + this.rng.range(-1.2, 1.2), p.home.y, p.home.z + this.rng.range(-1.2, 1.2));
          }
          const dx = p.walkTarget.x - p.pos.x;
          const dz = p.walkTarget.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.1) {
            p.pos.x += (dx / d) * 0.45 * dt;
            p.pos.z += (dz / d) * 0.45 * dt;
            p.yaw = Math.atan2(dx, dz);
            p.peck = 0;
          } else {
            p.peck += dt;
          }
          p.flap = Math.max(0, p.flap - dt * 4);
          break;
        }
        case "flying": {
          const to = new THREE.Vector3().subVectors(p.target, p.pos);
          const dist = to.length();
          const desired = to.normalize().multiplyScalar(Math.min(7, 2.5 + dist));
          p.vel.lerp(desired, Math.min(1, dt * 1.6));
          if (p.t < 0.6) p.vel.y = Math.max(p.vel.y, 3.5);
          p.pos.addScaledVector(p.vel, dt);
          if (Math.hypot(p.vel.x, p.vel.z) > 0.2) p.yaw = Math.atan2(p.vel.x, p.vel.z);
          p.flap += dt * 22;
          if (dist < 0.4) {
            p.state = "perched";
            p.t = 0;
            p.pos.copy(p.target);
            p.vel.set(0, 0, 0);
          }
          break;
        }
        case "perched": {
          p.flap = 0;
          if (p.t > 5 + (p.seed % 4)) {
            p.state = "returning";
            p.t = 0;
            p.target.copy(p.home);
          }
          break;
        }
        case "returning": {
          const to = new THREE.Vector3().subVectors(p.target, p.pos);
          const dist = to.length();
          p.vel.lerp(to.normalize().multiplyScalar(Math.min(5, 1 + dist)), Math.min(1, dt * 2));
          p.pos.addScaledVector(p.vel, dt);
          if (Math.hypot(p.vel.x, p.vel.z) > 0.2) p.yaw = Math.atan2(p.vel.x, p.vel.z);
          p.flap += dt * 14;
          if (dist < 0.25) {
            p.state = "ground";
            p.pos.copy(p.home);
            p.t = 0;
          }
          break;
        }
      }
      this.pose(p, dt);
    }
  }

  private pose(p: Pigeon, _dt: number): void {
    p.root.position.copy(p.pos);
    p.root.rotation.y = p.yaw;
    const air = p.state === "flying" || p.state === "returning";
    const wingAng = air ? Math.sin(p.flap) * 1.1 + 0.3 : 0.05;
    p.wingL.rotation.set(0, 0, wingAng + (air ? 0 : -0.15));
    p.wingR.rotation.set(0, 0, -wingAng - (air ? 0 : -0.15));
    p.wingL.rotation.y = air ? -0.3 : 0;
    p.wingR.rotation.y = air ? 0.3 : 0;
    // pecking bob
    const peck = p.state === "ground" && p.peck > 0 ? Math.max(0, Math.sin((p.t + p.seed) * 7)) * 0.5 : 0;
    p.body.rotation.x = air ? -0.15 : peck;
  }

  /** Rewind support: the flock as one flat state array. */
  readonly rewind: Rewindable = {
    rewindId: "pigeons",
    captureRewind: () => {
      const out: number[] = [];
      for (const p of this.pigeons) out.push(p.pos.x, p.pos.y, p.pos.z, p.yaw, p.state === "ground" || p.state === "perched" ? 0 : 1);
      return out;
    },
    applyRewind: (s: number[]) => {
      this.pigeons.forEach((p, i) => {
        p.pos.set(s[i * 5], s[i * 5 + 1], s[i * 5 + 2]);
        p.yaw = s[i * 5 + 3];
        const flying = s[i * 5 + 4] > 0.5;
        p.state = flying ? "flying" : "ground";
        if (flying) p.flap += 0.6;
        p.peck = 0;
        this.pose(p, 0);
      });
    },
  };
}
