import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataError } from "@/lib/errors";

vi.mock("@/lib/report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/report")>();
  return { ...actual, buildTickerReport: vi.fn() };
});

import { buildTickerReport } from "@/lib/report";
import { GET } from "@/app/api/ticker/[symbol]/route";

const mocked = vi.mocked(buildTickerReport);
const call = (symbol: string) =>
  GET(new Request(`http://localhost/api/ticker/${symbol}`), { params: Promise.resolve({ symbol }) });

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mocked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/ticker/[symbol]", () => {
  it("returns the report as JSON", async () => {
    const report = { symbol: "AAA", name: "A Corp", quarters: [], stale: false };
    mocked.mockResolvedValue(report as never);
    const res = await call("aaa");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(mocked).toHaveBeenCalledWith("aaa", expect.anything());
  });

  it.each([
    ["NOT_FOUND", 404],
    ["RATE_LIMIT", 429],
    ["MISSING_KEY", 500],
    ["UPSTREAM", 502],
  ] as const)("maps DataError %s to %i", async (code, status) => {
    mocked.mockRejectedValue(new DataError(code, `msg ${code}`));
    const res = await call("BBB");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: `msg ${code}` } });
  });

  it("maps unknown errors to a generic 500", async () => {
    mocked.mockRejectedValue(new Error("secret internals"));
    const res = await call("CCC");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "UPSTREAM", message: "Something went wrong." } });
  });

  it("shares one build between concurrent requests for the same symbol", async () => {
    mocked.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { symbol: "DDD" } as never;
    });
    const [a, b] = await Promise.all([call("ddd"), call("DDD")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  describe("Cache-Control", () => {
    it("lets the shared cache keep a fresh report for a day, with no browser max-age", async () => {
      mocked.mockResolvedValue({ symbol: "FFF", stale: false } as never);
      const res = await call("fff");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=86400, stale-while-revalidate=86400");
    });

    it("gives a stale report a short shared cache", async () => {
      mocked.mockResolvedValue({ symbol: "GGG", stale: true } as never);
      const res = await call("ggg");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300");
    });

    it("gives a degraded report a short shared cache", async () => {
      mocked.mockResolvedValue({ symbol: "GGD", stale: false, degraded: true } as never);
      const res = await call("ggd");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300");
    });

    it("caches NOT_FOUND for an hour", async () => {
      mocked.mockRejectedValue(new DataError("NOT_FOUND", "nope"));
      const res = await call("hhh");
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=3600");
    });

    it("caches NOT_ALLOWED for an hour", async () => {
      vi.stubEnv("ALLOWED_TICKERS", "aapl");
      const res = await call("iii");
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=3600");
    });

    it.each([
      ["RATE_LIMIT", 429],
      ["UPSTREAM", 502],
      ["MISSING_KEY", 500],
    ] as const)("does not cache %s", async (code, status) => {
      mocked.mockRejectedValue(new DataError(code, "x"));
      const res = await call("jjj");
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("does not cache an unexpected 500", async () => {
      mocked.mockRejectedValue(new Error("boom"));
      const res = await call("kkk");
      expect(res.status).toBe(500);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("ALLOWED_TICKERS", () => {
    it("rejects a ticker outside the list with 403 NOT_ALLOWED and builds nothing", async () => {
      vi.stubEnv("ALLOWED_TICKERS", "aapl, MSFT");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const res = await call("nvda");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "NOT_ALLOWED", message: "NVDA isn't available on this site. Available tickers: AAPL, MSFT." },
      });
      expect(mocked).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("serves a listed ticker, case-insensitively", async () => {
      vi.stubEnv("ALLOWED_TICKERS", " aapl,MSFT ");
      mocked.mockResolvedValue({ symbol: "AAPL" } as never);
      const res = await call("AaPl");
      expect(res.status).toBe(200);
      expect(mocked).toHaveBeenCalledTimes(1);
    });

    it("still shares one build between concurrent requests for a listed ticker", async () => {
      vi.stubEnv("ALLOWED_TICKERS", "eee");
      mocked.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { symbol: "EEE" } as never;
      });
      const [a, b] = await Promise.all([call("eee"), call("EEE")]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(mocked).toHaveBeenCalledTimes(1);
    });

    it("keeps the existing response for an invalid symbol", async () => {
      vi.stubEnv("ALLOWED_TICKERS", "aapl");
      mocked.mockRejectedValue(new DataError("NOT_FOUND", "bad"));
      const res = await call("1bad");
      expect(res.status).toBe(404);
    });

    it.each([[""], ["  "]])("treats %j as unset", async (v) => {
      vi.stubEnv("ALLOWED_TICKERS", v);
      mocked.mockResolvedValue({ symbol: "ZZZ" } as never);
      const res = await call("zzz");
      expect(res.status).toBe(200);
    });

    it("allows any ticker when unset", async () => {
      vi.stubEnv("ALLOWED_TICKERS", undefined);
      mocked.mockResolvedValue({ symbol: "ZZZ" } as never);
      const res = await call("zzz");
      expect(res.status).toBe(200);
    });
  });
});
