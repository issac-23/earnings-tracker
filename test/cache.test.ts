import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cachedFetch, createFileCache } from "@/lib/cache";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "et-cache-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("createFileCache", () => {
  it("returns null for a missing key", async () => {
    expect(await createFileCache(dir).get("nope")).toBeNull();
  });

  it("round-trips data with savedAt", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ savedAt: 1000, data: { a: 1 } });
  });

  it("turns keys into safe filenames", async () => {
    await createFileCache(dir).set("a/b:c", 1);
    expect(await readdir(dir)).toEqual(["a_b_c.json"]);
  });
});

describe("cachedFetch", () => {
  it("uses a fresh cache hit without fetching", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    const fetcher = vi.fn(async () => "new");
    expect(await cachedFetch(cache, "k", 500, fetcher, () => 1200)).toEqual({ data: "old", stale: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refetches and stores when expired", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    expect(await cachedFetch(cache, "k", 500, async () => "new", () => 2000)).toEqual({ data: "new", stale: false });
    expect((await cache.get("k"))!.data).toBe("new");
  });

  it("serves stale data when refetch fails", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    const failing = async (): Promise<string> => { throw new Error("down"); };
    expect(await cachedFetch(cache, "k", 500, failing, () => 2000)).toEqual({ data: "old", stale: true });
  });

  it("rethrows when there is nothing cached", async () => {
    const failing = async (): Promise<string> => { throw new Error("down"); };
    await expect(cachedFetch(createFileCache(dir), "k", 500, failing)).rejects.toThrow("down");
  });
});
