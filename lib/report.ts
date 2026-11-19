import { cachedFetch, type Cache } from "./cache";
import { DataError } from "./errors";
import { buildQuarterRows } from "./quarters";
import { fetchEarnings, fetchRevenue, fetchRevenueEstimates } from "./sources/alphaVantage";
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
  if (!avKey) throw new DataError("MISSING_KEY", "Missing ALPHAVANTAGE_API_KEY. Set it in .env.local when running locally, or in the host's environment variables when deployed.");
  if (!tiingoKey) throw new DataError("MISSING_KEY", "Missing TIINGO_API_KEY. Set it in .env.local when running locally, or in the host's environment variables when deployed.");
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const start = new Date(now() - 4 * 365 * DAY).toISOString().slice(0, 10);
  const get = <T,>(key: string, maxAge: number, fn: () => Promise<T>) => cachedFetch(cache, key, maxAge, fn, now);

  // Earnings first: if this fails there is nothing to show, and it avoids spending other calls.
  const earnings = await get(`av-earnings-${symbol}`, DAY, () => fetchEarnings(symbol, avKey, fetchFn));
  type Numbers = Record<string, number>;
  // Revenue and estimates are secondary: a failure gives {} and never fails the report.
  // When earnings is stale Alpha Vantage just refused a refresh, so don't spend another call: reuse whatever is cached.
  const secondary = (key: string, fetcher: () => Promise<Numbers>) =>
    earnings.stale
      ? cache
          .get<Numbers>(key)
          .then((hit) => ({ data: hit?.data ?? ({} as Numbers), stale: false }))
          .catch(() => ({ data: {} as Numbers, stale: false }))
      : get(key, DAY, fetcher).catch(() => ({ data: {} as Numbers, stale: false }));
  const revenueP = secondary(`av-income-${symbol}`, () => fetchRevenue(symbol, avKey, fetchFn));
  // Chained after revenue so it is the third Alpha Vantage call (the gate spaces them in this order).
  const estimatesP = revenueP.then(() => secondary(`av-estimates-${symbol}`, () => fetchRevenueEstimates(symbol, avKey, fetchFn)));
  const [revenue, estimates, name, stock, spy] = await Promise.all([
    revenueP,
    estimatesP,
    get(`tiingo-meta-${symbol}`, 7 * DAY, () => fetchName(symbol, tiingoKey, fetchFn))
      .catch(() => ({ data: null as string | null, stale: false })),
    get(`tiingo-prices-${symbol}`, DAY, () => fetchPrices(symbol, start, tiingoKey, fetchFn)),
    get("tiingo-prices-SPY", DAY, () => fetchPrices("SPY", start, tiingoKey, fetchFn)),
  ]);

  const quarters = buildQuarterRows({ earnings: earnings.data, revenue: revenue.data, revenueEstimates: estimates.data, stock: stock.data, spy: spy.data });
  return {
    symbol,
    name: name.data,
    quarters,
    summary: summarize(quarters),
    fetchedAt: new Date(now()).toISOString(),
    stale: [earnings, revenue, estimates, stock, spy].some((r) => r.stale),
  };
}
