import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
