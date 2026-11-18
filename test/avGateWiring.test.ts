import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { configureAvGate, resetAvGate } from "@/lib/avGate";
import { fetchEarnings, fetchRevenue } from "@/lib/sources/alphaVantage";

// A fake clock: sleeping just advances time, so nothing really waits.
let clock: number;
let slept: number[];
beforeEach(() => {
  clock = 1_000_000;
  slept = [];
  configureAvGate({
    spacingMs: 1500,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });
});
afterEach(() => resetAvGate());

describe("Alpha Vantage fetches go through the gate", () => {
  const okFetch = (log: [string, number][]) =>
    (async (input: string | URL | Request) => {
      log.push([String(input), clock]);
      const body = String(input).includes("INCOME_STATEMENT") ? { quarterlyReports: [] } : { quarterlyEarnings: [{ fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28" }] };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;

  it("two different tickers built concurrently are spaced and ordered", async () => {
    const log: [string, number][] = [];
    const f = okFetch(log);
    await Promise.all([fetchEarnings("AAA", "K", f), fetchEarnings("BBB", "K", f)]);
    expect(log.map(([u]) => u.match(/symbol=(\w+)/)![1])).toEqual(["AAA", "BBB"]);
    expect(log[1][1] - log[0][1]).toBeGreaterThanOrEqual(1500);
  });

  it("one lookup's EARNINGS and INCOME_STATEMENT calls are still spaced", async () => {
    const log: [string, number][] = [];
    const f = okFetch(log);
    await fetchEarnings("AAA", "K", f);
    await fetchRevenue("AAA", "K", f);
    expect(log[1][1] - log[0][1]).toBeGreaterThanOrEqual(1500);
  });

  it("a rate-limit retry waits through the gate too", async () => {
    const log: [string, number][] = [];
    const bodies = [{ Information: "rate limit" }, { quarterlyEarnings: [{ fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28" }] }];
    const f = vi.fn(async (input: string | URL | Request) => {
      log.push([String(input), clock]);
      return new Response(JSON.stringify(bodies.shift()));
    }) as unknown as typeof fetch;
    await fetchEarnings("AAA", "K", f);
    expect(log).toHaveLength(2);
    expect(log[1][1] - log[0][1]).toBeGreaterThanOrEqual(1500);
  });

  it("a failed fetch does not stall the next ticker", async () => {
    const log: [string, number][] = [];
    const bad = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(fetchEarnings("AAA", "K", bad)).rejects.toMatchObject({ code: "UPSTREAM" });
    await expect(fetchEarnings("BBB", "K", okFetch(log))).resolves.toHaveLength(1);
  });
});
