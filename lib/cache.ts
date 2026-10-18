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
