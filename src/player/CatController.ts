import * as THREE from "three";
import type { CatActor } from "../cats/CatActor";
import type { Input } from "../core/Input";
import type { CameraController } from "../rendering/CameraController";

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * Player input → cat intent. Movement is camera-relative; pounce aims along
 * input (or camera) with a soft auto-aim toward the best target in a cone;
 * hiss faces the most threatening opponent nearby.
 */
export class CatController {
  actor: CatActor | null = null;
  /** Opponents for aim assist. */
  targets: CatActor[] = [];
  aimAssist = true;
  interactPressed = false;
  scentPressed = false;

  constructor(
    private readonly input: Input,
    private readonly camera: CameraController,
  ) {}

  update(): void {
    const a = this.actor;
    this.interactPressed = false;
    this.scentPressed = false;
    if (!a) return;
    const axes = this.input.moveAxes();
    this.camera.forward(_f);
    this.camera.right(_r);
    _dir.set(0, 0, 0).addScaledVector(_f, axes.y).addScaledVector(_r, axes.x);
    const len = _dir.length();
    if (len > 1) _dir.divideScalar(len);
    a.intent.moveX = _dir.x;
    a.intent.moveZ = _dir.z;
    a.intent.sprint = this.input.isHeld("sprint");
    a.intent.jumpHeld = this.input.isHeld("jump");
    if (this.input.consume("jump", 0.15)) a.intent.jump = true;

    if (this.input.peek("pounce", 0.18) && a.canAct && !a.abilities.busy && a.abilities.pounceCooldown <= 0) {
      this.input.consume("pounce", 0.18);
      const aim = len > 0.2 ? _dir.clone().normalize() : _f.clone();
      if (this.aimAssist) this.assist(a, aim, 7, 0.62);
      a.pounceAim.copy(aim);
      a.wantPounce = true;
    }
    if (this.input.peek("hiss", 0.15) && a.canAct && a.abilities.hissReady && a.abilities.pounceState === "idle") {
      this.input.consume("hiss", 0.15);
      const aim = a.forward(new THREE.Vector3());
      if (!this.faceThreat(a, aim)) this.assist(a, aim, 5, 1.6);
      a.hissAim.copy(aim);
      a.wantHiss = true;
    }
    if (this.input.consume("interact", 0.15)) this.interactPressed = true;
    if (this.input.consume("scent", 0.15)) this.scentPressed = true;
  }

  /** Point `aim` at the nearest opponent winding up a pounce, from any side. */
  private faceThreat(a: CatActor, aim: THREE.Vector3): boolean {
    let best: CatActor | null = null;
    let bestD = 8;
    for (const t of this.targets) {
      if (t === a || !t.active || t.team === a.team) continue;
      const ps = t.abilities.pounceState;
      if (ps !== "windup" && !(ps === "active" && t.abilities.pounceT < 0.12)) continue;
      _to.subVectors(t.position, a.position);
      if (Math.abs(_to.y) > 1.4) continue;
      const d = Math.hypot(_to.x, _to.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return false;
    aim.subVectors(best.position, a.position).setY(0);
    if (aim.lengthSq() < 1e-4) a.forward(aim);
    aim.normalize();
    return true;
  }

  /** Bend `aim` toward the best opponent inside a cone (soft auto-aim). */
  private assist(a: CatActor, aim: THREE.Vector3, range: number, halfAngle: number): void {
    let best: CatActor | null = null;
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (t === a || !t.active || t.team === a.team) continue;
      _to.subVectors(t.position, a.position);
      const dy = Math.abs(_to.y);
      _to.setY(0);
      const d = _to.length();
      if (d > range || d < 0.05 || dy > 1.4) continue;
      _to.divideScalar(d);
      const ang = Math.acos(Math.max(-1, Math.min(1, _to.dot(aim))));
      if (ang > halfAngle) continue;
      const score = d + ang * 4;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      // lead the target slightly
      _to.copy(best.position).addScaledVector(best.velocity, 0.12).sub(a.position).setY(0).normalize();
      aim.lerp(_to, 0.85).normalize();
    }
  }
}
