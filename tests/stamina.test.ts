import { describe, expect, it } from "vitest";
import { fullStamina, STAMINA_RECOVER, STAMINA_REFILL_DELAY, STAMINA_REFILL_SECONDS, STAMINA_SPRINT_SECONDS, stepStamina, type StaminaState } from "../src/player/Stamina";

const DT = 1 / 60;
const fresh = (): StaminaState => ({ stamina: 1, winded: false, sinceSprint: 99 });
const run = (s: StaminaState, wants: boolean, seconds: number) => {
  let sprinted = 0;
  for (let t = 0; t < seconds - 1e-9; t += DT) if (stepStamina(s, wants, DT)) sprinted += DT;
  return sprinted;
};

describe("Sprint stamina", () => {
  it("a full bar lasts a few seconds of sprinting, then the cat is winded", () => {
    const s = fresh();
    const sprinted = run(s, true, STAMINA_SPRINT_SECONDS + 1);
    expect(sprinted).toBeCloseTo(STAMINA_SPRINT_SECONDS, 1);
    expect(s.winded).toBe(true);
    // it has been refilling since, but not enough to sprint again yet
    expect(s.stamina).toBeLessThan(STAMINA_RECOVER);
  });

  it("a winded cat cannot sprint until the bar refills a little", () => {
    const s = fresh();
    while (!s.winded) stepStamina(s, true, DT);
    // holding sprint does nothing while winded…
    const recoverAfter = STAMINA_REFILL_DELAY + STAMINA_RECOVER * STAMINA_REFILL_SECONDS;
    expect(run(s, true, recoverAfter - 0.15)).toBe(0);
    expect(s.winded).toBe(true);
    // …until the bar is back to the recovery point
    run(s, false, 0.3);
    expect(s.winded).toBe(false);
    expect(stepStamina(s, true, DT)).toBe(true);
  });

  it("refills after a short pause and never goes past full", () => {
    const s = fresh();
    run(s, true, 1);
    const after = s.stamina;
    run(s, false, STAMINA_REFILL_DELAY * 0.8);
    expect(s.stamina).toBeCloseTo(after, 6);
    run(s, false, STAMINA_REFILL_SECONDS * 2);
    expect(s.stamina).toBe(1);
  });

  it("not wanting to sprint costs nothing", () => {
    const s = fresh();
    expect(run(s, false, 5)).toBe(0);
    expect(s.stamina).toBe(1);
  });

  it("holding sprint the whole way averages roughly half the time sprinting", () => {
    const s = fresh();
    const sprinted = run(s, true, 40);
    expect(sprinted / 40).toBeGreaterThan(0.45);
    expect(sprinted / 40).toBeLessThan(0.65);
    fullStamina(s);
    expect(s).toEqual(fresh());
  });
});
