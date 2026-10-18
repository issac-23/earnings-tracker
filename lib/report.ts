import type { Cache } from "./cache";

export interface ReportDeps {
  cache: Cache;
  avKey?: string;
  tiingoKey?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(s) ? s : null;
}
