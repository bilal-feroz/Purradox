import { describe, expect, it } from "vitest";
import { FishGrip, MAX_GRIP } from "../src/fish/FishGrip";
import { GameState, StateMachine, TRANSITIONS } from "../src/core/GameState";
import { WorldHistory } from "../src/replay/WorldHistory";
import { angleDelta, formatClock, lerpAngle, wrapAngle } from "../src/core/math";

describe("FishGrip", () => {
  it("counts 3 → 2 → 1 → 0 and drops on the last point", () => {
    const g = new FishGrip();
    expect(g.value).toBe(MAX_GRIP);
    expect(g.damage().dropped).toBe(false);
    expect(g.damage().dropped).toBe(false);
    const last = g.damage();
    expect(last.after).toBe(0);
    expect(last.dropped).toBe(true);
    expect(g.damage().dropped).toBe(false); // already empty
  });

  it("lets helpers wear grip down without ever knocking the fish loose", () => {
    const g = new FishGrip();
    g.damage(1);
    g.damage(1);
    const r = g.damage(1);
    expect(g.value).toBe(1);
    expect(r.dropped).toBe(false);
  });
});

describe("Game state machine", () => {
  it("walks the full two-round loop", () => {
    const fsm = new StateMachine();
    const path = [
      GameState.MENU,
      GameState.INTRO,
      GameState.FISH_RUN,
      GameState.FISH_RUN_COMPLETE,
      GameState.ANALYZE_RUN,
      GameState.REWIND,
      GameState.CAT_SELECTION,
      GameState.HUNT,
      GameState.HUNT_COMPLETE,
      GameState.RESULTS,
      GameState.REWIND, // run it back
      GameState.CAT_SELECTION,
      GameState.HUNT,
      GameState.HUNT_COMPLETE,
      GameState.RESULTS,
      GameState.INTRO, // new run
    ];
    for (const s of path) fsm.transition(s);
    expect(fsm.state).toBe(GameState.INTRO);
  });

  it("offers Choose Your Thief from the menu and after results, never mid-round", () => {
    const fsm = new StateMachine();
    fsm.transition(GameState.MENU);
    fsm.transition(GameState.THIEF_SELECTION);
    expect(() => fsm.transition(GameState.HUNT)).toThrow();
    fsm.transition(GameState.INTRO);
    fsm.transition(GameState.FISH_RUN);
    expect(() => fsm.transition(GameState.THIEF_SELECTION)).toThrow();
    for (const st of [GameState.FISH_RUN_COMPLETE, GameState.ANALYZE_RUN, GameState.REWIND, GameState.CAT_SELECTION, GameState.HUNT, GameState.HUNT_COMPLETE, GameState.RESULTS]) fsm.transition(st);
    fsm.transition(GameState.THIEF_SELECTION); // NEW RUN after the first cycle
    fsm.transition(GameState.MENU); // back
    expect(fsm.state).toBe(GameState.MENU);
  });

  it("rejects illegal transitions", () => {
    const fsm = new StateMachine();
    expect(() => fsm.transition(GameState.HUNT)).toThrow();
    fsm.transition(GameState.MENU);
    expect(() => fsm.transition(GameState.RESULTS)).toThrow();
  });

  it("runs enter/exit hooks exactly once per transition", () => {
    const fsm = new StateMachine();
    const log: string[] = [];
    fsm.register(GameState.MENU, { enter: () => log.push("enter menu"), exit: () => log.push("exit menu") });
    fsm.register(GameState.INTRO, { enter: () => log.push("enter intro") });
    fsm.transition(GameState.MENU);
    fsm.transition(GameState.INTRO);
    expect(log).toEqual(["enter menu", "exit menu", "enter intro"]);
  });

  it("every state is reachable from BOOT", () => {
    const seen = new Set<GameState>([GameState.BOOT]);
    const queue = [GameState.BOOT];
    while (queue.length) {
      const s = queue.shift()!;
      for (const n of TRANSITIONS[s]) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(Object.keys(TRANSITIONS).length);
  });
});

describe("WorldHistory (rewind)", () => {
  it("interpolates captured states and wraps angles the short way", () => {
    const h = new WorldHistory(10);
    let x = 0;
    let yaw = 3.0;
    let applied: number[] = [];
    h.register({
      rewindId: "cat",
      angleIndices: [1],
      captureRewind: () => [x, yaw],
      applyRewind: (s) => {
        applied = [...s];
      },
    });
    h.tick(0, true);
    x = 10;
    yaw = -3.0; // crosses ±PI
    h.tick(1, true);
    h.apply(0.5);
    expect(applied[0]).toBeCloseTo(5, 6);
    expect(Math.abs(wrapAngle(applied[1]))).toBeGreaterThan(3.0);
  });
});

describe("math helpers", () => {
  it("wraps and lerps angles", () => {
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(0.5 + Math.PI * 4)).toBeCloseTo(0.5, 6);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 6);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 2);
  });

  it("formats the run clock like the UI bible", () => {
    expect(formatClock(42.8)).toBe("00:42.8");
    expect(formatClock(71.25)).toBe("01:11.3");
  });
});
