/**
 * Spaces every Alpha Vantage HTTP call made by this server process, so lookups of different tickers
 * (and the two calls of one lookup) can't land back to back and trip the burst limit.
 * Each call waits until `spacingMs` has passed since the previous call started; waiters queue on a promise chain.
 * At most `maxQueue` calls (waiting or running) are allowed at once; a call that arrives beyond that is refused straight away.
 */
import { DataError } from "./errors";

const DEFAULT_SPACING_MS = 1500;
const DEFAULT_MAX_QUEUE = 6; // about two lookups' worth (3 calls each)

/** The gate is full. Distinct from Alpha Vantage's own rate-limit reply, so the source doesn't retry it. */
export class AvBusyError extends DataError {
  constructor() {
    super("RATE_LIMIT", "Too many lookups at once. Try again in a few seconds.");
    this.name = "AvBusyError";
  }
}

interface Gate {
  spacingMs: number;
  maxQueue: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaults = (): Gate => ({ spacingMs: DEFAULT_SPACING_MS, maxQueue: DEFAULT_MAX_QUEUE, now: Date.now, sleep: realSleep });

let gate = defaults();
let tail: Promise<void> = Promise.resolve();
let lastStart = -Infinity;
let pending = 0; // calls waiting for their turn or running

/** Override the interval, queue cap, clock or sleep (tests inject a fake clock so nothing really waits). */
export function configureAvGate(opts: Partial<Gate>): void {
  gate = { ...gate, ...opts };
}

/** Back to the 1.5s default with the real clock, and forget earlier calls. */
export function resetAvGate(): void {
  gate = defaults();
  tail = Promise.resolve();
  lastStart = -Infinity;
  pending = 0;
}

/**
 * Run `task` once the spacing since the previous gated call has elapsed. A failing task doesn't affect later ones.
 * Throws AvBusyError at once, without queueing, when `maxQueue` calls are already waiting or running.
 */
export async function avGate<T>(task: () => Promise<T>): Promise<T> {
  if (pending >= gate.maxQueue) throw new AvBusyError();
  pending++;
  try {
    const turn = tail.then(async () => {
      const wait = lastStart + gate.spacingMs - gate.now();
      if (wait > 0) await gate.sleep(wait);
      lastStart = gate.now();
    });
    tail = turn.catch(() => {});
    await turn;
    return await task();
  } finally {
    pending--;
  }
}
