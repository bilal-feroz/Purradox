// Explicit game flow state machine. Every phase of the two-round loop is a
// named state with a whitelist of legal successors, so the flow can never end
// up in a half-reset limbo built from scattered boolean flags.

export enum GameState {
  BOOT = "BOOT",
  MENU = "MENU",
  /** Choose Your Thief (unlocked after the first full cycle). */
  THIEF_SELECTION = "THIEF_SELECTION",
  INTRO = "INTRO",
  FISH_RUN = "FISH_RUN",
  /** Round 1 defeat: a rival got away with the fish. */
  FISH_LOST = "FISH_LOST",
  FISH_RUN_COMPLETE = "FISH_RUN_COMPLETE",
  ANALYZE_RUN = "ANALYZE_RUN",
  REWIND = "REWIND",
  CAT_SELECTION = "CAT_SELECTION",
  HUNT = "HUNT",
  HUNT_COMPLETE = "HUNT_COMPLETE",
  RESULTS = "RESULTS",
}

export const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  [GameState.BOOT]: [GameState.MENU],
  [GameState.MENU]: [GameState.INTRO, GameState.THIEF_SELECTION],
  [GameState.THIEF_SELECTION]: [GameState.INTRO, GameState.MENU],
  [GameState.INTRO]: [GameState.FISH_RUN, GameState.MENU],
  [GameState.FISH_RUN]: [GameState.FISH_RUN_COMPLETE, GameState.FISH_LOST, GameState.INTRO, GameState.MENU],
  [GameState.FISH_LOST]: [GameState.INTRO, GameState.MENU],
  [GameState.FISH_RUN_COMPLETE]: [GameState.ANALYZE_RUN, GameState.MENU],
  [GameState.ANALYZE_RUN]: [GameState.REWIND, GameState.MENU],
  [GameState.REWIND]: [GameState.CAT_SELECTION, GameState.MENU],
  [GameState.CAT_SELECTION]: [GameState.HUNT, GameState.MENU],
  [GameState.HUNT]: [GameState.HUNT_COMPLETE, GameState.REWIND, GameState.INTRO, GameState.MENU],
  [GameState.HUNT_COMPLETE]: [GameState.RESULTS, GameState.MENU],
  [GameState.RESULTS]: [GameState.REWIND, GameState.INTRO, GameState.MENU, GameState.THIEF_SELECTION],
};

export interface StateHandlers {
  enter?: (from: GameState | null) => void;
  update?: (dt: number) => void;
  exit?: (to: GameState) => void;
}

export class StateMachine {
  private current: GameState = GameState.BOOT;
  private elapsed = 0;
  private readonly handlers = new Map<GameState, StateHandlers>();
  private readonly listeners: Array<(to: GameState, from: GameState) => void> = [];
  readonly history: GameState[] = [GameState.BOOT];

  get state(): GameState {
    return this.current;
  }

  /** Seconds spent in the current state (simulation or real, as fed to update). */
  get time(): number {
    return this.elapsed;
  }

  register(state: GameState, handlers: StateHandlers): void {
    this.handlers.set(state, handlers);
  }

  onChange(fn: (to: GameState, from: GameState) => void): void {
    this.listeners.push(fn);
  }

  canTransition(to: GameState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  transition(to: GameState): void {
    const from = this.current;
    if (!this.canTransition(to)) {
      throw new Error(`Illegal game state transition ${from} -> ${to}`);
    }
    this.handlers.get(from)?.exit?.(to);
    this.current = to;
    this.elapsed = 0;
    this.history.push(to);
    if (this.history.length > 64) this.history.shift();
    this.handlers.get(to)?.enter?.(from);
    for (const fn of this.listeners) fn(to, from);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.handlers.get(this.current)?.update?.(dt);
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }
}
