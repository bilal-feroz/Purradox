/**
 * Sprint stamina (every cat, rivals included): a full bar is a few seconds
 * of sprinting; run it dry and the cat is winded until it has refilled a
 * little. Sprint in bursts.
 */
export const STAMINA_SPRINT_SECONDS = 3.6;
/** Seconds to refill an empty bar once the cat stops sprinting. */
export const STAMINA_REFILL_SECONDS = 2.4;
/** Pause after sprinting before the bar starts refilling (s). */
export const STAMINA_REFILL_DELAY = 0.45;
/** A winded cat can sprint again once the bar is back to this. */
export const STAMINA_RECOVER = 0.4;

export interface StaminaState {
  /** 0..1 */
  stamina: number;
  /** Ran the bar dry: no sprinting until it refills to STAMINA_RECOVER. */
  winded: boolean;
  /** Seconds since the cat last sprinted. */
  sinceSprint: number;
}

/** Advance one step. Returns whether the cat actually sprints this step. */
export function stepStamina(s: StaminaState, wantsSprint: boolean, dt: number): boolean {
  const sprinting = wantsSprint && !s.winded && s.stamina > 0;
  if (sprinting) {
    s.stamina = Math.max(0, s.stamina - dt / STAMINA_SPRINT_SECONDS);
    s.sinceSprint = 0;
    if (s.stamina <= 0) s.winded = true;
  } else {
    s.sinceSprint += dt;
    if (s.sinceSprint > STAMINA_REFILL_DELAY) s.stamina = Math.min(1, s.stamina + dt / STAMINA_REFILL_SECONDS);
    if (s.winded && s.stamina >= STAMINA_RECOVER) s.winded = false;
  }
  return sprinting;
}

export function fullStamina(s: StaminaState): void {
  s.stamina = 1;
  s.winded = false;
  s.sinceSprint = 99;
}
