// Every resettable thing in the world registers here. A reset restores
// transforms, velocities, interaction state, AI state, fish, particles and
// animation state exactly — no page refresh, no leftover listeners.

export interface Resettable {
  readonly resetId: string;
  reset(): void;
}

export class ResetManager {
  private readonly items: Resettable[] = [];
  resetCount = 0;

  register(r: Resettable): void {
    if (this.items.some((i) => i.resetId === r.resetId)) throw new Error(`ResetManager: duplicate id ${r.resetId}`);
    this.items.push(r);
  }

  /** Register a closure as a resettable. */
  add(resetId: string, reset: () => void): void {
    this.register({ resetId, reset });
  }

  resetAll(): void {
    for (const r of this.items) r.reset();
    this.resetCount++;
  }

  get ids(): string[] {
    return this.items.map((i) => i.resetId);
  }
}
