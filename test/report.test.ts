import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AvBusyError, configureAvGate, resetAvGate } from "@/lib/avGate";
import { createFileCache } from "@/lib/cache";
import { buildTickerReport, normalizeSymbol, type ReportDeps } from "@/lib/report";
import { STOCK, SPY_BARS } from "./helpers";

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const tiingoRows = (bars: { date: string; close: number }[]) =>
  bars.map((b) => ({ date: `${b.date}T00:00:00.000Z`, close: b.close, adjClose: b.close }));

const EARNINGS = {
  symbol: "TEST",
  quarterlyEarnings: [
    { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", reportedEPS: "1.05", estimatedEPS: "1.01", reportTime: "post-market" },
  ],
};

function makeRoutes(): Record<string, () => Response> {
  // Order matters: first substring match wins, so prices come before meta.
  return {
    // EARNINGS_ESTIMATES must come before EARNINGS: first substring match wins.
    "function=EARNINGS_ESTIMATES": json({ estimates: [
      { date: "2025-06-30", horizon: "fiscal quarter", revenue_estimate_average: "44000000000.00" },
      { date: "2026-03-31", horizon: "fiscal year", revenue_estimate_average: "1.00" },
    ] }),
    "function=EARNINGS": json(EARNINGS),
    "function=INCOME_STATEMENT": json({ quarterlyReports: [{ fiscalDateEnding: "2025-06-30", totalRevenue: "46700000000" }] }),
    "/daily/SPY/prices": json(tiingoRows(SPY_BARS)),
    "/daily/TEST/prices": json(tiingoRows(STOCK)),
    "/daily/TEST": json({ name: "Test Corp" }),
  };
}

let dir: string;
let routes: Record<string, () => Response>;
let calls: string[];
let times: number[];
let clock: number;
let deps: ReportDeps;

beforeEach(async () => {
  configureAvGate({ spacingMs: 0 });
  dir = await mkdtemp(path.join(tmpdir(), "et-report-"));
  routes = makeRoutes();
  calls = [];
  times = [];
  clock = Date.parse("2025-09-10T00:00:00Z");
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    times.push(performance.now());
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unrouted ${url}`);
    return hit[1]();
  }) as typeof fetch;
  deps = { cache: createFileCache(dir, () => clock), avKey: "AV", tiingoKey: "TI", fetchFn, now: () => clock };
});
afterEach(async () => {
  resetAvGate();
  await rm(dir, { recursive: true, force: true }); });

describe("normalizeSymbol", () => {
  it("uppercases and trims valid symbols, rejects junk", () => {
    expect(normalizeSymbol(" nvda ")).toBe("NVDA");
    expect(normalizeSymbol("BRK.B")).toBe("BRK.B");
    expect(normalizeSymbol("!!")).toBeNull();
    expect(normalizeSymbol("")).toBeNull();
  });
});

describe("buildTickerReport", () => {
  it("assembles a full report", async () => {
    const r = await buildTickerReport(" test ", deps);
    expect(r.symbol).toBe("TEST");
    expect(r.name).toBe("Test Corp");
    expect(r.quarters).toHaveLength(1);
    expect(r.quarters[0].flag).toBe("beat-but-fell");
    expect(r.quarters[0].revenue).toBe(46.7e9);
    expect(r.summary.beats).toBe(1);
    expect(r.stale).toBe(false);
    expect(r.fetchedAt).toBe("2025-09-10T00:00:00.000Z");
  });

  it("second lookup is served from cache", async () => {
    await buildTickerReport("TEST", deps);
    const before = calls.length;
    await buildTickerReport("TEST", deps);
    expect(calls.length).toBe(before);
  });

  it("revenue failure degrades to empty revenue", async () => {
    routes["function=INCOME_STATEMENT"] = json({}, 500);
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenue).toBeNull();
  });

  it("rejects bad symbols and missing keys", async () => {
    await expect(buildTickerReport("!!", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildTickerReport("TEST", { ...deps, avKey: "" })).rejects.toMatchObject({ code: "MISSING_KEY" });
    await expect(buildTickerReport("TEST", { ...deps, tiingoKey: undefined })).rejects.toMatchObject({ code: "MISSING_KEY" });
  });

  it("rate limit with no cache → RATE_LIMIT", async () => {
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    await expect(buildTickerReport("TEST", deps)).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("rate limit with old cache → stale report", async () => {
    await buildTickerReport("TEST", deps);
    clock += 2 * 24 * 60 * 60 * 1000;
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const r = await buildTickerReport("TEST", deps);
    expect(r.stale).toBe(true);
    expect(r.quarters).toHaveLength(1);
  });

  it("spaces the revenue call after the earnings call", async () => {
    let fake = 0;
    configureAvGate({ spacingMs: 1500, now: () => fake, sleep: async (ms) => { fake += ms; } });
    const f = deps.fetchFn!;
    const stamps: number[] = [];
    await buildTickerReport("TEST", { ...deps, fetchFn: ((u: string | URL | Request, o?: RequestInit) => { stamps.push(fake); return f(u, o); }) as typeof fetch });
    const e = calls.findIndex((u) => u.includes("function=EARNINGS"));
    const i = calls.findIndex((u) => u.includes("function=INCOME_STATEMENT"));
    expect(i).toBeGreaterThan(e);
    expect(stamps[i] - stamps[e]).toBeGreaterThanOrEqual(1500);
  });

  it("revenue rate limit degrades to empty revenue", async () => {
    routes["function=INCOME_STATEMENT"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenue).toBeNull();
  });

  it("adds the revenue estimate and surprise to the quarter", async () => {
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenueEstimate).toBe(44e9);
    expect(r.quarters[0].revenueSurprisePct).toBeCloseTo(((46.7e9 - 44e9) / 44e9) * 100, 9);
    expect(r.quarters[0].revenueOutcome).toBe("beat");
  });

  it("makes the estimates call third, after earnings and income, spaced by the gate", async () => {
    let fake = 0;
    configureAvGate({ spacingMs: 1500, now: () => fake, sleep: async (ms) => { fake += ms; } });
    const f = deps.fetchFn!;
    const stamps: number[] = [];
    await buildTickerReport("TEST", { ...deps, fetchFn: ((u: string | URL | Request, o?: RequestInit) => { stamps.push(fake); return f(u, o); }) as typeof fetch });
    const av = calls.map((u, i) => ({ u, t: stamps[i] })).filter((c) => c.u.includes("alphavantage"));
    expect(av.map((c) => c.u.match(/function=([A-Z_]+)/)![1])).toEqual(["EARNINGS", "INCOME_STATEMENT", "EARNINGS_ESTIMATES"]);
    expect(av[2].t - av[1].t).toBeGreaterThanOrEqual(1500);
  });

  it("serves the estimates from cache on a second lookup", async () => {
    await buildTickerReport("TEST", deps);
    const before = calls.length;
    const r = await buildTickerReport("TEST", deps);
    expect(calls.length).toBe(before);
    expect(r.quarters[0].revenueEstimate).toBe(44e9);
  });

  it.each([
    ["an HTTP error", json({}, 500)],
    ["a rate limit", json({ Information: "standard API rate limit is 25 requests per day" })],
    ["garbage", json([1, 2])],
  ])("estimates failing with %s degrades to no estimates", async (_n, route) => {
    routes["function=EARNINGS_ESTIMATES"] = route;
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenueEstimate).toBeNull();
    expect(r.quarters[0].revenueOutcome).toBe("unknown");
    expect(r.quarters[0].revenue).toBe(46.7e9);
    expect(r.stale).toBe(false);
  });

  it("marks the report stale when a secondary call finds the gate busy, so the CDN keeps it only briefly", async () => {
    routes["function=INCOME_STATEMENT"] = () => { throw new AvBusyError(); };
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenue).toBeNull();
    expect(r.stale).toBe(true);
  });

  it("does not spend the estimates call when earnings came back stale, and reuses the cache", async () => {
    await buildTickerReport("TEST", deps);
    clock += 2 * 24 * 60 * 60 * 1000;
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const before = calls.length;
    const r = await buildTickerReport("TEST", deps);
    expect(calls.slice(before).some((u) => u.includes("function=EARNINGS_ESTIMATES"))).toBe(false);
    expect(r.quarters[0].revenueEstimate).toBe(44e9);
  });

  it("stale earnings with nothing cached gives no estimates and no estimates call", async () => {
    await buildTickerReport("TEST", deps);
    for (const f of await readdir(dir)) if (f.includes("av-estimates")) await unlink(path.join(dir, f));
    clock += 2 * 24 * 60 * 60 * 1000;
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const before = calls.length;
    const r = await buildTickerReport("TEST", deps);
    expect(calls.slice(before).some((u) => u.includes("function=EARNINGS_ESTIMATES"))).toBe(false);
    expect(r.quarters[0].revenueEstimate).toBeNull();
  });

  it("does not refresh revenue when earnings came back stale", async () => {
    await buildTickerReport("TEST", deps);
    clock += 2 * 24 * 60 * 60 * 1000;
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const before = calls.length;
    const r = await buildTickerReport("TEST", deps);
    expect(calls.slice(before).some((u) => u.includes("function=INCOME_STATEMENT"))).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.quarters[0].revenue).toBe(46.7e9);
  });

  describe("unknown tickers", () => {
    const HOUR = 60 * 60 * 1000;
    const avCalls = () => calls.filter((u) => u.includes("alphavantage")).length;
    beforeEach(() => {
      routes["function=EARNINGS"] = json({});
    });

    it("remembers an unknown symbol for an hour without calling Alpha Vantage", async () => {
      await expect(buildTickerReport("ZZZ1", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const before = calls.length;
      expect(before).toBeGreaterThan(0);
      clock += HOUR - 1000;
      await expect(buildTickerReport("zzz1", deps)).rejects.toMatchObject({ code: "NOT_FOUND", message: "No earnings history found for ZZZ1." });
      expect(calls.length).toBe(before);
    });

    it("fetches again once the hour has passed", async () => {
      await expect(buildTickerReport("ZZZ1", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const before = avCalls();
      clock += HOUR + 1000;
      await expect(buildTickerReport("ZZZ1", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(avCalls()).toBe(before + 1);
    });

    it.each([
      ["RATE_LIMIT", json({ Information: "standard API rate limit is 25 requests per day" })],
      ["UPSTREAM", json({}, 500)],
    ])("does not remember a %s failure", async (code, route) => {
      routes["function=EARNINGS"] = route;
      await expect(buildTickerReport("ZZZ1", deps)).rejects.toMatchObject({ code });
      const perLookup = avCalls();
      expect(perLookup).toBeGreaterThan(0);
      await expect(buildTickerReport("ZZZ1", deps)).rejects.toMatchObject({ code });
      expect(avCalls()).toBe(perLookup * 2);
    });
  });
});

describe("buildTickerReport input echo", () => {
  it("truncates a long invalid input in the NOT_FOUND message", async () => {
    const cache = createFileCache(await mkdtemp(path.join(tmpdir(), "et-echo-")));
    const err = await buildTickerReport("x".repeat(5000), { cache, avKey: "a", tiingoKey: "t" }).catch((e) => e);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message.length).toBeLessThan(80);
    expect(err.message).toContain("…");
  });
});
