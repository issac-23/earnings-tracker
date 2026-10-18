import { DataError } from "../errors";
import type { EarningsRecord, ReportTiming } from "../types";

const BASE = "https://www.alphavantage.co/query";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "" || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timingOf(v: unknown): ReportTiming {
  if (v === "pre-market") return "BMO";
  if (v === "post-market") return "AMC";
  return "unknown";
}

const notFound = (symbol: string) => new DataError("NOT_FOUND", `No earnings history found for ${symbol}.`);

const isErrorMessage = (json: unknown) =>
  !!json && typeof json === "object" && typeof (json as Record<string, unknown>)["Error Message"] === "string";

/** Throws for rate-limit / bad-key / malformed responses. Callers handle "Error Message" (unknown symbol) first. */
function assertAvOk(json: unknown): asserts json is Record<string, unknown> {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new DataError("UPSTREAM", "Unexpected response from Alpha Vantage.");
  }
  const o = json as Record<string, unknown>;
  const info = [o.Information, o.Note].find((v): v is string => typeof v === "string");
  if (info) {
    if (/apikey is invalid|apikey.*missing/i.test(info)) {
      throw new DataError("MISSING_KEY", "Alpha Vantage API key is invalid. Check ALPHAVANTAGE_API_KEY in .env.local.");
    }
    throw new DataError("RATE_LIMIT", "Daily data limit reached — try again tomorrow or use a ticker you've looked up before.");
  }
}

export function parseEarnings(json: unknown, symbol: string): EarningsRecord[] {
  if (isErrorMessage(json)) throw notFound(symbol);
  assertAvOk(json);
  const list: Record<string, unknown>[] = Array.isArray(json.quarterlyEarnings) ? json.quarterlyEarnings : [];
  const rows = list
    .map((q) => ({
      fiscalDateEnding: String(q.fiscalDateEnding ?? ""),
      reportedDate: String(q.reportedDate ?? ""),
      timing: timingOf(q.reportTime),
      reportedEPS: num(q.reportedEPS),
      estimatedEPS: num(q.estimatedEPS),
    }))
    .filter((r) => DATE.test(r.reportedDate) && DATE.test(r.fiscalDateEnding));
  if (rows.length === 0) throw notFound(symbol);
  return rows;
}

export function parseIncomeStatement(json: unknown): Record<string, number> {
  if (isErrorMessage(json)) return {};
  assertAvOk(json);
  const list: Record<string, unknown>[] = Array.isArray(json.quarterlyReports) ? json.quarterlyReports : [];
  const out: Record<string, number> = {};
  for (const r of list) {
    const v = num(r.totalRevenue);
    if (typeof r.fiscalDateEnding === "string" && v !== null) out[r.fiscalDateEnding] = v;
  }
  return out;
}

async function avGet(fn: string, symbol: string, apiKey: string, fetchFn: typeof fetch): Promise<unknown> {
  const url = `${BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetchFn(url, { cache: "no-store" });
  } catch {
    throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  }
  if (!res.ok) throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  return res.json();
}

export async function fetchEarnings(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<EarningsRecord[]> {
  return parseEarnings(await avGet("EARNINGS", symbol, apiKey, fetchFn), symbol);
}

export async function fetchRevenue(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Record<string, number>> {
  return parseIncomeStatement(await avGet("INCOME_STATEMENT", symbol, apiKey, fetchFn));
}
