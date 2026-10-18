import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchName, fetchPrices, parsePrices } from "@/lib/sources/tiingo";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("parsePrices", () => {
  it("sorts, trims dates, prefers adjClose, drops bad rows", () => {
    expect(parsePrices([
      { date: "2025-08-27T00:00:00.000Z", close: 200, adjClose: 100 },
      { date: "2025-08-26T00:00:00.000Z", close: 198, adjClose: 99 },
      { date: "garbage", close: 1, adjClose: 1 },
      { date: "2025-08-28T00:00:00.000Z", close: null, adjClose: null },
    ])).toEqual([
      { date: "2025-08-26", close: 99 },
      { date: "2025-08-27", close: 100 },
    ]);
  });

  it("non-array → UPSTREAM", () => {
    let code: string | undefined;
    try { parsePrices({ detail: "x" }); } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("UPSTREAM");
  });

  it("parses the real NVDA fixture", () => {
    const rows = parsePrices(fixture("tiingo-prices-NVDA"));
    expect(rows.length).toBeGreaterThanOrEqual(900);
    expect(rows[0].date < rows.at(-1)!.date).toBe(true);
  });
});

describe("fetchPrices", () => {
  it("sends the token header and the start date", async () => {
    const f = respond(200, [{ date: "2025-08-26T00:00:00.000Z", close: 1, adjClose: 1 }]);
    await fetchPrices("NVDA", "2022-01-01", "KEY", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tiingo.com/tiingo/daily/NVDA/prices?startDate=2022-01-01");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token KEY");
  });

  it("maps HTTP errors to codes", async () => {
    for (const [status, code] of [[404, "NOT_FOUND"], [401, "MISSING_KEY"], [429, "RATE_LIMIT"], [500, "UPSTREAM"]] as const) {
      await expect(fetchPrices("X", "2022-01-01", "KEY", respond(status, {}) as unknown as typeof fetch))
        .rejects.toMatchObject({ code });
    }
  });
});

describe("fetchName", () => {
  it("returns the company name or null", async () => {
    expect(await fetchName("NVDA", "KEY", respond(200, { name: "NVIDIA Corp" }) as unknown as typeof fetch)).toBe("NVIDIA Corp");
    expect(await fetchName("NVDA", "KEY", respond(200, {}) as unknown as typeof fetch)).toBeNull();
  });
});
