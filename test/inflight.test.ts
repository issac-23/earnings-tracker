import { describe, it, expect, vi } from "vitest";
import { coalesce } from "@/lib/inflight";

describe("coalesce", () => {
  it("shares one call between concurrent requests for the same key", async () => {
    const fn = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return { n: 1 }; });
    const [a, b] = await Promise.all([coalesce("k-share", fn), coalesce("k-share", fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("shares a rejection and clears the key afterwards", async () => {
    const fn = vi.fn(async (): Promise<string> => { await new Promise((r) => setTimeout(r, 5)); throw new Error("boom"); });
    const results = await Promise.allSettled([coalesce("k-fail", fn), coalesce("k-fail", fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    await expect(coalesce("k-fail", fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not share between different keys", async () => {
    const fn = vi.fn(async () => "x");
    await Promise.all([coalesce("k-a", fn), coalesce("k-b", fn)]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
