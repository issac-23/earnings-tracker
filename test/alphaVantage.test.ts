import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchEarnings, parseEarnings, parseIncomeStatement } from "@/lib/sources/alphaVantage";
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
      const rows = await fetchEarnings("TEST", "KEY", f as unknown as typeof fetch, 0);
      expect(rows).toHaveLength(3);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("rejects with RATE_LIMIT when still throttled after the retry", async () => {
      const f = respond(limited, limited);
      await expect(fetchEarnings("TEST", "KEY", f as unknown as typeof fetch, 0)).rejects.toMatchObject({ code: "RATE_LIMIT" });
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("does not retry NOT_FOUND", async () => {
      const f = respond({});
      await expect(fetchEarnings("TEST", "KEY", f as unknown as typeof fetch, 0)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(f).toHaveBeenCalledTimes(1);
    });
  });
});
