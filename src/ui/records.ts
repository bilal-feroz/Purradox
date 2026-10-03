// Personal bests shown on the Level Select card. Browser storage can be
// unavailable (private mode, blocked site data), so every access is guarded
// and the game works the same without it.

const KEY = "purradox.records.v1";

export interface Records {
  /** Fastest Round 1 escape (seconds). */
  bestEscape: number | null;
  /** Earliest Round 2 steal from Past You (replay seconds). */
  fastestSteal: number | null;
}

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<Records>;
      return { bestEscape: num(r.bestEscape), fastestSteal: num(r.fastestSteal) };
    }
  } catch {
    // storage unavailable: no records
  }
  return { bestEscape: null, fastestSteal: null };
}

export function recordEscape(seconds: number): void {
  const r = loadRecords();
  if (r.bestEscape === null || seconds < r.bestEscape) save({ ...r, bestEscape: seconds });
}

export function recordSteal(seconds: number): void {
  const r = loadRecords();
  if (r.fastestSteal === null || seconds < r.fastestSteal) save({ ...r, fastestSteal: seconds });
}

function save(r: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // ignore
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

const PROGRESS_KEY = "purradox.progress.v1";

export interface Progress {
  /** Set after the first full Round 1 + Round 2 cycle (unlocks Choose Your Thief). */
  thiefUnlocked: boolean;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) return { thiefUnlocked: Boolean((JSON.parse(raw) as Partial<Progress>).thiefUnlocked) };
  } catch {
    // storage unavailable: behave like a first playthrough
  }
  return { thiefUnlocked: false };
}

export function markCycleComplete(): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ thiefUnlocked: true } satisfies Progress));
  } catch {
    // ignore
  }
}
