/**
 * Spaces every Alpha Vantage HTTP call made by this server process, so lookups of different tickers
 * (and the two calls of one lookup) can't land back to back and trip the burst limit.
 * Each call waits until `spacingMs` has passed since the previous call started; waiters queue on a promise chain.
 */
const DEFAULT_SPACING_MS = 1500;

interface Gate {
  spacingMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaults = (): Gate => ({ spacingMs: DEFAULT_SPACING_MS, now: Date.now, sleep: realSleep });

let gate = defaults();
let tail: Promise<void> = Promise.resolve();
let lastStart = -Infinity;

/** Override the interval, clock or sleep (tests inject a fake clock so nothing really waits). */
export function configureAvGate(opts: Partial<Gate>): void {
  gate = { ...gate, ...opts };
}

/** Back to the 1.5s default with the real clock, and forget earlier calls. */
export function resetAvGate(): void {
  gate = defaults();
  tail = Promise.resolve();
  lastStart = -Infinity;
}

/** Run `task` once the spacing since the previous gated call has elapsed. A failing task doesn't affect later ones. */
export async function avGate<T>(task: () => Promise<T>): Promise<T> {
  const turn = tail.then(async () => {
    const wait = lastStart + gate.spacingMs - gate.now();
    if (wait > 0) await gate.sleep(wait);
    lastStart = gate.now();
  });
  tail = turn.catch(() => {});
  await turn;
  return task();
}
