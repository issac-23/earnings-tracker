import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
let clock: number;
let deps: ReportDeps;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "et-report-"));
  routes = makeRoutes();
  calls = [];
  clock = Date.parse("2025-09-10T00:00:00Z");
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unrouted ${url}`);
    return hit[1]();
  }) as typeof fetch;
  deps = { cache: createFileCache(dir, () => clock), avKey: "AV", tiingoKey: "TI", fetchFn, now: () => clock };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

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
});
