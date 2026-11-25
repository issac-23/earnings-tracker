import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheDir, cachedFetch, createFileCache } from "@/lib/cache";

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

describe("createFileCache atomic writes", () => {
  it("leaves no temp files behind and reads back correctly", async () => {
    const cache = createFileCache(dir, () => 5);
    await Promise.all([cache.set("k", { a: 1 }), cache.set("k", { a: 2 }), cache.set("j", { b: 1 })]);
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files.sort()).toEqual(["j.json", "k.json"]);
    expect((await cache.get<{ a: number }>("k"))?.data.a).toBeGreaterThan(0);
  });

  it("removes the temp file and rejects when the rename fails", async () => {
    const cache = createFileCache(dir);
    // A directory at the target path makes rename fail.
    await mkdir(path.join(dir, "k.json"));
    await expect(cache.set("k", 1)).rejects.toThrow();
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
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

  it("returns fresh data even if the cache write fails", async () => {
    const base = createFileCache(dir, () => 1000);
    const cache = { get: base.get, set: async (): Promise<void> => { throw new Error("disk full"); } };
    expect(await cachedFetch(cache, "k", 500, async () => "fresh", () => 2000)).toEqual({ data: "fresh", stale: false });
  });
});

describe("cacheDir", () => {
  const cwd = path.join("work", "app");
  const tmp = path.join("os", "tmp");

  it("uses CACHE_DIR when set, even on Vercel", () => {
    expect(cacheDir({ CACHE_DIR: "/data/cache", VERCEL: "1" }, cwd, tmp)).toBe("/data/cache");
  });
  it("uses a folder under the OS temp dir on Vercel", () => {
    expect(cacheDir({ VERCEL: "1" }, cwd, tmp)).toBe(path.join(tmp, "earnings-tracker-cache"));
  });
  it("uses .cache in the working directory otherwise", () => {
    expect(cacheDir({}, cwd, tmp)).toBe(path.join(cwd, ".cache"));
  });
  it("ignores empty values", () => {
    expect(cacheDir({ CACHE_DIR: "", VERCEL: "" }, cwd, tmp)).toBe(path.join(cwd, ".cache"));
  });
});

describe("createFileCache directory handling", () => {
  it("creates a missing nested directory on first write", async () => {
    const nested = path.join(dir, "a", "b");
    const cache = createFileCache(nested);
    await cache.set("k", { x: 1 });
    expect((await cache.get<{ x: number }>("k"))?.data).toEqual({ x: 1 });
  });
});
