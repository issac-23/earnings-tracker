import { cachedFetch, type Cache } from "./cache";
import { DataError } from "./errors";
import { buildQuarterRows } from "./quarters";
import { fetchEarnings, fetchRevenue } from "./sources/alphaVantage";
import { fetchName, fetchPrices } from "./sources/tiingo";
import { summarize } from "./summary";
import type { TickerReport } from "./types";

const DAY = 24 * 60 * 60 * 1000;

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

export async function buildTickerReport(raw: string, deps: ReportDeps): Promise<TickerReport> {
  const symbol = normalizeSymbol(raw);
  if (!symbol) throw new DataError("NOT_FOUND", `"${raw.trim()}" doesn't look like a ticker symbol.`);
  const { cache, avKey, tiingoKey } = deps;
  if (!avKey) throw new DataError("MISSING_KEY", "Missing ALPHAVANTAGE_API_KEY in .env.local.");
  if (!tiingoKey) throw new DataError("MISSING_KEY", "Missing TIINGO_API_KEY in .env.local.");
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const start = new Date(now() - 4 * 365 * DAY).toISOString().slice(0, 10);
  const get = <T,>(key: string, maxAge: number, fn: () => Promise<T>) => cachedFetch(cache, key, maxAge, fn, now);

  // Earnings first: if this fails there is nothing to show, and it avoids spending other calls.
  const earnings = await get(`av-earnings-${symbol}`, DAY, () => fetchEarnings(symbol, avKey, fetchFn));
  const [revenue, name, stock, spy] = await Promise.all([
    get(`av-income-${symbol}`, DAY, () => fetchRevenue(symbol, avKey, fetchFn))
      .catch(() => ({ data: {} as Record<string, number>, stale: false })),
    get(`tiingo-meta-${symbol}`, 7 * DAY, () => fetchName(symbol, tiingoKey, fetchFn))
      .catch(() => ({ data: null as string | null, stale: false })),
    get(`tiingo-prices-${symbol}`, DAY, () => fetchPrices(symbol, start, tiingoKey, fetchFn)),
    get("tiingo-prices-SPY", DAY, () => fetchPrices("SPY", start, tiingoKey, fetchFn)),
  ]);

  const quarters = buildQuarterRows({ earnings: earnings.data, revenue: revenue.data, stock: stock.data, spy: spy.data });
  return {
    symbol,
    name: name.data,
    quarters,
    summary: summarize(quarters),
    fetchedAt: new Date(now()).toISOString(),
    stale: [earnings, stock, spy].some((r) => r.stale),
  };
}
