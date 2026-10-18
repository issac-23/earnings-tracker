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
