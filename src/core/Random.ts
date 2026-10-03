// Seeded PRNG (mulberry32). World decoration and AI use seeded streams so a
// given run is reproducible and the level always looks the same.

export class Random {
  private state: number;

  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
}

/** Deterministic hash → [0,1) for stable per-face/per-object variation. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.floor(x * 73.13) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(y * 51.71) | 0, 0x165667b1);
  h ^= Math.imul(Math.floor(z * 91.37) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
