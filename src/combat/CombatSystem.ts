import * as THREE from "three";
import type { CatActor } from "../cats/CatActor";
import type { EventBus } from "../core/EventBus";
import type { GameTime } from "../core/Time";
import type { FishSystem } from "../fish/Fish";
import { HISS_HALF_ANGLE, HISS_WINDOW } from "../player/CatAbilities";
import type { CameraController } from "../rendering/CameraController";
import type { Effects } from "../rendering/Effects";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _mid = new THREE.Vector3();

export interface CombatRules {
  /** Lowest grip this attacker may reduce a carrier to (helpers stop at 1). */
  gripFloor: (attacker: CatActor, target: CatActor) => number;
  /** Camera feedback only for hits involving the local player. */
  isLocal: (cat: CatActor) => boolean;
}

/**
 * Resolves pounces and hisses between opposing cats.
 *   Pounce beats bad positioning.  Hiss beats a predictable pounce.
 *   Waiting beats a premature hiss.
 * A pounce that lands inside the target's hiss window and cone is a
 * PERFECT HISS: the attacker is rejected and staggered.
 */
/** Extra reach at which a hiss repels an incoming pounce (metres). */
const HISS_REPEL = 0.9;

export class CombatSystem {
  cats: CatActor[] = [];
  rules: CombatRules = { gripFloor: () => 0, isLocal: () => false };
  perfectHissCount = new Map<string, number>();

  constructor(
    private readonly bus: EventBus,
    private readonly fish: FishSystem,
    private readonly effects: Effects,
    private readonly time: GameTime,
    private readonly camera: CameraController,
  ) {
    bus.on("hissStart", (e) => {
      const hisser = this.cats.find((c) => c.id === e.cat);
      if (hisser) this.applyHissHesitation(hisser);
    });
  }

  resetStats(): void {
    this.perfectHissCount.clear();
  }

  update(): void {
    for (const a of this.cats) {
      if (!a.active || a.abilities.pounceState !== "active" || a.abilities.pounceHit) continue;
      a.forward(_d);
      _a.copy(a.position).addScaledVector(a.abilities.pounceDir, 0.42).setY(a.position.y + 0.42);
      for (const b of this.cats) {
        if (b === a || !b.active || b.team === a.team) continue;
        b.center(_b);
        const dy = Math.abs(_a.y - _b.y);
        if (dy > 0.95) continue;
        const dist = Math.hypot(_a.x - _b.x, _a.z - _b.z);
        let reach = a.stats.hitRadius + 0.3;
        // A hiss meets an incoming lunge early, so a well-timed hiss
        // reliably bounces the pouncer instead of letting it whiff.
        if (b.abilities.hissActive && b.abilities.hissT <= HISS_WINDOW && this.inHissCone(b, a, 0.35)) {
          const toward = (_b.x - _a.x) * a.abilities.pounceDir.x + (_b.z - _a.z) * a.abilities.pounceDir.z > 0;
          if (toward) reach += HISS_REPEL;
        }
        if (dist > reach) continue;
        this.resolve(a, b);
        break;
      }
    }
  }

  private inHissCone(hisser: CatActor, other: CatActor, extra = 0): boolean {
    _d.subVectors(other.position, hisser.position).setY(0);
    const len = _d.length();
    if (len < 1e-3) return true;
    _d.divideScalar(len);
    const dot = _d.dot(hisser.abilities.hissDir);
    return Math.acos(Math.max(-1, Math.min(1, dot))) <= HISS_HALF_ANGLE + extra;
  }

  private resolve(attacker: CatActor, target: CatActor): void {
    const ab = attacker.abilities;
    ab.pounceHit = true;
    _mid.copy(attacker.position).add(target.position).multiplyScalar(0.5).setY(Math.max(attacker.position.y, target.position.y) + 0.55);
    const dir = _d.subVectors(target.position, attacker.position).setY(0);
    if (dir.lengthSq() < 1e-4) dir.copy(ab.pounceDir);
    dir.normalize();
    const local = this.rules.isLocal(attacker) || this.rules.isLocal(target);

    // ---------------------------------------------------- PERFECT HISS
    if (target.abilities.hissActive && target.abilities.hissT <= HISS_WINDOW && this.inHissCone(target, attacker, 0.35)) {
      ab.pounceRejected = true;
      ab.endPounce();
      const back = dir.clone().multiplyScalar(-1);
      attacker.stagger(0.85, back, 7.5);
      target.abilities.hissRejects++;
      this.perfectHissCount.set(target.id, (this.perfectHissCount.get(target.id) ?? 0) + 1);
      this.effects.impact(_mid, true);
      this.effects.hissWave(target.position, Math.atan2(target.abilities.hissDir.x, target.abilities.hissDir.z), true);
      this.time.hitStop(0.11);
      if (local) {
        this.camera.addTrauma(0.38);
        this.camera.kick(back, 1.4);
      }
      this.bus.emit("perfectHiss", { hisser: target.id, attacker: attacker.id, x: _mid.x, y: _mid.y, z: _mid.z });
      return;
    }

    // ---------------------------------------------------- invulnerable target
    if (target.invulnT > 0) {
      ab.endPounce();
      return;
    }

    // ---------------------------------------------------- grip damage or stagger
    const carrier = this.fish.owner === target;
    let gripDamage = false;
    if (carrier) {
      const floor = this.rules.gripFloor(attacker, target);
      if (this.fish.grip.value > floor) {
        gripDamage = true;
        this.fish.damageGrip(target, attacker, floor);
      }
      target.stagger(0.3, dir, 3.2);
      // A short grace window so two rivals can't chain-strip the fish.
      target.invulnT = target.mode === "replay" ? 0.75 : 1.15;
    } else {
      target.stagger(0.62, dir, 5.6);
      target.invulnT = 0.45;
    }
    ab.endPounce();
    if (attacker.mode !== "replay") {
      // pouncer pops back a little so the hit reads
      attacker.movement.velocity.x = -dir.x * 2.2;
      attacker.movement.velocity.z = -dir.z * 2.2;
      attacker.movement.velocity.y = Math.max(attacker.movement.velocity.y, 2.4);
    }
    this.effects.impact(_mid, gripDamage);
    this.time.hitStop(gripDamage ? 0.09 : 0.07);
    if (local) {
      this.camera.addTrauma(gripDamage ? 0.32 : 0.22);
      this.camera.kick(dir, 1.1);
    }
    this.bus.emit("pounceHit", { attacker: attacker.id, target: target.id, gripDamage, x: _mid.x, y: _mid.y, z: _mid.z });
  }

  /** Normal hiss: nearby opponents in the cone hesitate (not mid-pounce). */
  private applyHissHesitation(hisser: CatActor): void {
    for (const o of this.cats) {
      if (o === hisser || !o.active || o.team === hisser.team) continue;
      const d = Math.hypot(o.position.x - hisser.position.x, o.position.z - hisser.position.z);
      if (d > hisser.stats.hissRange || Math.abs(o.position.y - hisser.position.y) > 1.2) continue;
      if (!this.inHissCone(hisser, o)) continue;
      if (o.abilities.pounceState === "active") continue;
      o.hesitate(0.9);
      this.bus.emit("hesitate", { cat: o.id, by: hisser.id });
    }
    this.effects.hissWave(hisser.position, Math.atan2(hisser.abilities.hissDir.x, hisser.abilities.hissDir.z), false);
  }
}
