import * as THREE from "three";
import type { CatStats } from "../data/cats";

export type PounceState = "idle" | "windup" | "active" | "recover";

export const POUNCE_WINDUP = 0.075;
/** Rivals telegraph their pounce for this long (readable Perfect Hiss tell). */
export const AI_POUNCE_WINDUP = 0.27;
export const POUNCE_RECOVER = 0.2;
export const HISS_WINDOW = 0.5;
/** Portion of the hiss window that counts as a Perfect Hiss. */
export const HISS_PERFECT = 0.34;
export const HISS_HALF_ANGLE = (75 * Math.PI) / 180;
export const SCENT_COOLDOWN = 7;

/**
 * Pounce / Hiss / Scent Memory timing. Pure state + timers; the combat
 * system resolves hits and the movement system applies the lunge.
 */
export class CatAbilities {
  pounceState: PounceState = "idle";
  pounceT = 0;
  pounceCooldown = 0;
  readonly pounceDir = new THREE.Vector3(0, 0, 1);
  pounceHit = false;
  /** Pounce was rejected by a Perfect Hiss (cancel lunge). */
  pounceRejected = false;

  hissT = 0;
  hissActive = false;
  hissCooldown = 0;
  readonly hissDir = new THREE.Vector3(0, 0, 1);
  /** Number of pounces this hiss has already rejected. */
  hissRejects = 0;

  scentCooldown = 0;
  /**
   * Anticipation before the lunge. The player gets an instant pounce; AI
   * rivals telegraph theirs so a well-timed Hiss can be learned.
   */
  windupTime = POUNCE_WINDUP;
  /** Cooldown lengths (seconds) for HUD fill. */
  pounceCooldownMax: number;
  hissCooldownMax: number;
  readonly scentCooldownMax = SCENT_COOLDOWN;

  constructor(public stats: CatStats) {
    this.pounceCooldownMax = stats.pounceCooldown;
    this.hissCooldownMax = stats.hissCooldown;
  }

  get pounceReady(): boolean {
    return this.pounceState === "idle" && this.pounceCooldown <= 0;
  }

  get hissReady(): boolean {
    return !this.hissActive && this.hissCooldown <= 0;
  }

  get scentReady(): boolean {
    return this.scentCooldown <= 0;
  }

  get busy(): boolean {
    return this.pounceState !== "idle";
  }

  /** Perfect window is the opening part of the hiss. */
  get hissPerfect(): boolean {
    return this.hissActive && this.hissT <= HISS_PERFECT;
  }

  tryPounce(dir: THREE.Vector3): boolean {
    if (!this.pounceReady) return false;
    this.pounceState = "windup";
    this.pounceT = 0;
    this.pounceDir.copy(dir).setY(0).normalize();
    this.pounceHit = false;
    this.pounceRejected = false;
    return true;
  }

  /** Start a pounce immediately in its active phase (replay-driven). */
  forcePounce(dir: THREE.Vector3): void {
    this.pounceState = "active";
    this.pounceT = 0;
    this.pounceDir.copy(dir).setY(0).normalize();
    this.pounceHit = false;
    this.pounceRejected = false;
    this.pounceCooldown = this.stats.pounceCooldown;
  }

  tryHiss(dir: THREE.Vector3): boolean {
    if (!this.hissReady) return false;
    this.forceHiss(dir);
    return true;
  }

  forceHiss(dir: THREE.Vector3): void {
    this.hissActive = true;
    this.hissT = 0;
    this.hissRejects = 0;
    this.hissDir.copy(dir).setY(0).normalize();
    this.hissCooldown = this.stats.hissCooldown;
  }

  tryScent(): boolean {
    if (!this.scentReady) return false;
    this.scentCooldown = SCENT_COOLDOWN;
    return true;
  }

  /** End the current pounce early (hit landed or rejected). */
  endPounce(): void {
    if (this.pounceState === "active" || this.pounceState === "windup") {
      this.pounceState = "recover";
      this.pounceT = 0;
      if (this.pounceCooldown <= 0) this.pounceCooldown = this.stats.pounceCooldown;
    }
  }

  cancelAll(): void {
    this.pounceState = "idle";
    this.pounceT = 0;
    this.hissActive = false;
    this.hissT = 0;
  }

  resetCooldowns(): void {
    this.cancelAll();
    this.pounceCooldown = 0;
    this.hissCooldown = 0;
    this.scentCooldown = 0;
  }

  /** Returns true on the frame the windup turns into the active lunge. */
  update(dt: number): boolean {
    let launched = false;
    if (this.pounceCooldown > 0) this.pounceCooldown -= dt;
    if (this.hissCooldown > 0) this.hissCooldown -= dt;
    if (this.scentCooldown > 0) this.scentCooldown -= dt;

    switch (this.pounceState) {
      case "windup":
        this.pounceT += dt;
        if (this.pounceT >= this.windupTime) {
          this.pounceState = "active";
          this.pounceT = 0;
          this.pounceCooldown = this.stats.pounceCooldown;
          launched = true;
        }
        break;
      case "active":
        this.pounceT += dt;
        if (this.pounceT >= this.stats.pounceDuration) {
          this.pounceState = "recover";
          this.pounceT = 0;
        }
        break;
      case "recover":
        this.pounceT += dt;
        if (this.pounceT >= POUNCE_RECOVER) {
          this.pounceState = "idle";
          this.pounceT = 0;
        }
        break;
      default:
        break;
    }
    if (this.hissActive) {
      this.hissT += dt;
      if (this.hissT >= HISS_WINDOW) {
        this.hissActive = false;
        this.hissT = 0;
      }
    }
    return launched;
  }
}
