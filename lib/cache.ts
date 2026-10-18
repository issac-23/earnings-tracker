import { promises as fs } from "node:fs";
import path from "node:path";

export interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

export interface Cache {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, data: T): Promise<void>;
}

export function createFileCache(dir: string, now: () => number = Date.now): Cache {
  const file = (key: string) => path.join(dir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  return {
    async get<T>(key: string): Promise<CacheEntry<T> | null> {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8")) as CacheEntry<T>;
      } catch {
        return null;
      }
    },
    async set<T>(key: string, data: T): Promise<void> {
      await fs.mkdir(dir, { recursive: true });
      const entry: CacheEntry<T> = { savedAt: now(), data };
      await fs.writeFile(file(key), JSON.stringify(entry));
    },
  };
}

/** Return cached data if younger than maxAgeMs; otherwise fetch. If fetching fails, fall back to old cached data. */
export async function cachedFetch<T>(
  cache: Cache,
  key: string,
  maxAgeMs: number,
  fetcher: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ data: T; stale: boolean }> {
  const hit = await cache.get<T>(key);
  if (hit && now() - hit.savedAt < maxAgeMs) return { data: hit.data, stale: false };
  try {
    const data = await fetcher();
    await cache.set(key, data);
    return { data, stale: false };
  } catch (err) {
    if (hit) return { data: hit.data, stale: true };
    throw err;
  }
}
