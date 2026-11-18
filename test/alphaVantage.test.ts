import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureAvGate, resetAvGate } from "@/lib/avGate";
import { readFileSync } from "node:fs";
import { fetchEarnings, fetchRevenueEstimates, parseEarnings, parseIncomeStatement, parseRevenueEstimates } from "@/lib/sources/alphaVantage";
import type { DataError } from "@/lib/errors";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (e) { return (e as DataError).code; }
  return undefined;
}

const EARNINGS_JSON = {
  symbol: "TEST",
  quarterlyEarnings: [
    { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-27", reportedEPS: "1.05", estimatedEPS: "1.01", surprise: "0.04", surprisePercentage: "3.96", reportTime: "post-market" },
    { fiscalDateEnding: "2025-03-31", reportedDate: "2025-05-28", reportedEPS: "0.96", estimatedEPS: "None", surprise: "0", surprisePercentage: "None", reportTime: "pre-market" },
    { fiscalDateEnding: "2024-12-31", reportedDate: "2025-02-26", reportedEPS: "0.89", estimatedEPS: "0.85", surprise: "0.04", surprisePercentage: "4.7", reportTime: "" },
  ],
};

describe("parseEarnings", () => {
  it("parses numbers, None, and report timing", () => {
    expect(parseEarnings(EARNINGS_JSON, "TEST")).toEqual([
      { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-27", timing: "AMC", reportedEPS: 1.05, estimatedEPS: 1.01 },
      { fiscalDateEnding: "2025-03-31", reportedDate: "2025-05-28", timing: "BMO", reportedEPS: 0.96, estimatedEPS: null },
      { fiscalDateEnding: "2024-12-31", reportedDate: "2025-02-26", timing: "unknown", reportedEPS: 0.89, estimatedEPS: 0.85 },
    ]);
  });

  it("maps provider messages to error codes", () => {
    expect(codeOf(() => parseEarnings({ Information: "Our standard API rate limit is 25 requests per day." }, "T"))).toBe("RATE_LIMIT");
    expect(codeOf(() => parseEarnings({ Note: "Thank you for using Alpha Vantage! Please consider premium." }, "T"))).toBe("RATE_LIMIT");
    expect(codeOf(() => parseEarnings({ Information: "the parameter apikey is invalid or missing." }, "T"))).toBe("MISSING_KEY");
    expect(codeOf(() => parseEarnings({ "Error Message": "Invalid API call." }, "T"))).toBe("NOT_FOUND");
    expect(codeOf(() => parseEarnings({}, "T"))).toBe("NOT_FOUND");
  });

  it("uses the spec's not-found wording", () => {
    expect(() => parseEarnings({}, "XYZ")).toThrow("No earnings history found for XYZ.");
  });

  it("parses the real NVDA fixture", () => {
    const rows = parseEarnings(fixture("av-earnings-NVDA"), "NVDA");
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(r.reportedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["BMO", "AMC", "unknown"]).toContain(r.timing);
    }
    expect(rows.filter((r) => r.estimatedEPS !== null).length).toBeGreaterThanOrEqual(12);
  });

  it("treats the real bad-ticker fixture as not found", () => {
    expect(codeOf(() => parseEarnings(fixture("av-earnings-ZZZZZZ"), "ZZZZZZ"))).toBe("NOT_FOUND");
  });
});

describe("parseIncomeStatement", () => {
  it("maps fiscalDateEnding → totalRevenue, skipping None", () => {
    expect(parseIncomeStatement({
      quarterlyReports: [
        { fiscalDateEnding: "2025-06-30", totalRevenue: "46743000000" },
        { fiscalDateEnding: "2025-03-31", totalRevenue: "None" },
      ],
    })).toEqual({ "2025-06-30": 46743000000 });
  });

  it("returns {} when there are no reports or the symbol is unknown", () => {
    expect(parseIncomeStatement({})).toEqual({});
    expect(parseIncomeStatement({ "Error Message": "Invalid API call." })).toEqual({});
  });

  it("parses the real NVDA fixture", () => {
    expect(Object.keys(parseIncomeStatement(fixture("av-income-NVDA"))).length).toBeGreaterThanOrEqual(10);
  });
});

describe("fetchEarnings", () => {
  beforeEach(() => configureAvGate({ spacingMs: 0 }));
  afterEach(() => resetAvGate());

  it("calls the EARNINGS endpoint and parses the result", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(EARNINGS_JSON)));
    const rows = await fetchEarnings("TEST", "KEY", f as unknown as typeof fetch);
    expect(rows).toHaveLength(3);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("function=EARNINGS&symbol=TEST&apikey=KEY");
  });

  it("network failure → UPSTREAM", async () => {
    const f = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(fetchEarnings("TEST", "KEY", f)).rejects.toMatchObject({ code: "UPSTREAM", message: "Couldn't reach the data provider." });
  });

  describe("rate-limit retry", () => {
    const limited = { Information: "Our standard API rate limit is 25 requests per day." };
    const respond = (...bodies: unknown[]) => {
      const q = [...bodies];
      return vi.fn(async () => new Response(JSON.stringify(q.shift())));
    };

    it("retries once when throttled, then succeeds", async () => {
      const f = respond(limited, EARNINGS_JSON);
      const rows = await fetchEarnings("TEST", "KEY", f as unknown as typeof fetch);
      expect(rows).toHaveLength(3);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("rejects with RATE_LIMIT when still throttled after the retry", async () => {
      const f = respond(limited, limited);
      await expect(fetchEarnings("TEST", "KEY", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "RATE_LIMIT" });
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("does not retry NOT_FOUND", async () => {
      const f = respond({});
      await expect(fetchEarnings("TEST", "KEY", f as unknown as typeof fetch)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(f).toHaveBeenCalledTimes(1);
    });
  });
});

describe("parseRevenueEstimates", () => {
  const row = (date: string, horizon: string, rev: unknown) => ({ date, horizon, revenue_estimate_average: rev, eps_estimate_average: "1.00" });

  it("keeps only fiscal-quarter rows with a numeric revenue estimate", () => {
    const json = {
      symbol: "TEST",
      estimates: [
        row("2025-06-30", "fiscal quarter", "2679520000.00"),
        row("2025-12-31", "fiscal year", "9900000000.00"),
        row("2025-03-31", "fiscal quarter", null),
        row("2024-12-31", "fiscal quarter", "None"),
        row("2024-09-30", "fiscal quarter", "garbage"),
        row("2024-06-30", "fiscal quarter", 123),
        row("2024-03-31", "fiscal quarter", ""),
      ],
    };
    expect(parseRevenueEstimates(json)).toEqual({ "2025-06-30": 2679520000 });
  });

  it("returns {} for an unknown symbol or a missing list", () => {
    expect(parseRevenueEstimates({ "Error Message": "Invalid API call." })).toEqual({});
    expect(parseRevenueEstimates({ symbol: "T" })).toEqual({});
    expect(parseRevenueEstimates({ symbol: "T", estimates: "nope" })).toEqual({});
  });

  it("ignores rows without a valid date and tolerates non-object rows", () => {
    expect(parseRevenueEstimates({ estimates: [null, 5, row("soon", "fiscal quarter", "1.0")] })).toEqual({});
  });

  it("maps provider messages to error codes", () => {
    expect(codeOf(() => parseRevenueEstimates({ Information: "Our standard API rate limit is 25 requests per day." }))).toBe("RATE_LIMIT");
    expect(codeOf(() => parseRevenueEstimates({ Information: "the parameter apikey is invalid or missing." }))).toBe("MISSING_KEY");
    expect(codeOf(() => parseRevenueEstimates([]))).toBe("UPSTREAM");
  });

  it("parses the real NVDA fixture", () => {
    const out = parseRevenueEstimates(fixture("av-estimates-NVDA"));
    expect(Object.keys(out).length).toBeGreaterThanOrEqual(12);
    expect(out["2024-01-31"]).toBe(20_619_000_000);
    // fiscal-year rows must not leak in
    expect(out["2028-01-31"]).toBeUndefined();
  });

  it("lines up with the real NVDA earnings fixture: all of the last 12 quarters match by exact date", () => {
    const earnings = parseEarnings(fixture("av-earnings-NVDA"), "NVDA")
      .filter((r) => r.reportedEPS !== null)
      .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate))
      .slice(0, 12);
    const est = parseRevenueEstimates(fixture("av-estimates-NVDA"));
    expect(earnings.filter((r) => est[r.fiscalDateEnding] !== undefined)).toHaveLength(12);
  });
});

describe("fetchRevenueEstimates", () => {
  beforeEach(() => configureAvGate({ spacingMs: 0 }));
  afterEach(() => resetAvGate());

  it("calls EARNINGS_ESTIMATES and parses the result", async () => {
    const urls: string[] = [];
    const fetchFn = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ estimates: [{ date: "2025-06-30", horizon: "fiscal quarter", revenue_estimate_average: "5.0" }] }));
    }) as typeof fetch;
    expect(await fetchRevenueEstimates("TEST", "K", fetchFn)).toEqual({ "2025-06-30": 5 });
    expect(urls[0]).toContain("function=EARNINGS_ESTIMATES");
    expect(urls[0]).toContain("symbol=TEST");
  });

  it("retries once on a rate-limit message", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      return new Response(JSON.stringify(n === 1 ? { Information: "rate limit is 25 requests per day" } : { estimates: [{ date: "2025-06-30", horizon: "fiscal quarter", revenue_estimate_average: "5" }] }));
    }) as typeof fetch;
    expect(await fetchRevenueEstimates("TEST", "K", fetchFn)).toEqual({ "2025-06-30": 5 });
    expect(n).toBe(2);
  });
});
