import { DataError } from "../errors";
import type { PriceBar } from "../types";

const BASE = "https://api.tiingo.com/tiingo/daily";

export function parsePrices(json: unknown): PriceBar[] {
  if (!Array.isArray(json)) throw new DataError("UPSTREAM", "Unexpected price data from Tiingo.");
  return (json as Record<string, unknown>[])
    .map((r) => ({ date: String(r.date ?? "").slice(0, 10), close: Number(r.adjClose ?? r.close) }))
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function tiingoGet(path: string, symbol: string, apiKey: string, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}${path}`, {
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  }
  if (res.status === 404) throw new DataError("NOT_FOUND", `No price history found for ${symbol}.`);
  if (res.status === 401 || res.status === 403) {
    throw new DataError("MISSING_KEY", "Tiingo API key is invalid. Check TIINGO_API_KEY in .env.local.");
  }
  if (res.status === 429) throw new DataError("RATE_LIMIT", "Price-data limit reached — wait an hour and try again.");
  if (!res.ok) throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  return res.json();
}

export async function fetchPrices(symbol: string, startDate: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<PriceBar[]> {
  return parsePrices(await tiingoGet(`/${encodeURIComponent(symbol)}/prices?startDate=${startDate}`, symbol, apiKey, fetchFn));
}

export async function fetchName(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const json = (await tiingoGet(`/${encodeURIComponent(symbol)}`, symbol, apiKey, fetchFn)) as { name?: unknown } | null;
  return typeof json?.name === "string" && json.name.trim() ? json.name.trim() : null;
}
