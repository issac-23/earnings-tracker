import { avGate } from "../avGate";
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
      throw new DataError("MISSING_KEY", "Alpha Vantage API key is invalid. Check ALPHAVANTAGE_API_KEY (.env.local when running locally, the host's environment variables when deployed).");
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

/** Fiscal-quarter consensus revenue by fiscal quarter end. Year rows, null and non-numeric values are skipped. */
export function parseRevenueEstimates(json: unknown): Record<string, number> {
  if (isErrorMessage(json)) return {};
  assertAvOk(json);
  const list: unknown[] = Array.isArray(json.estimates) ? json.estimates : [];
  const out: Record<string, number> = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const v = num(r.revenue_estimate_average);
    if (r.horizon === "fiscal quarter" && typeof r.date === "string" && DATE.test(r.date) && v !== null) out[r.date] = v;
  }
  return out;
}

async function avGet(fn: string, symbol: string, apiKey: string, fetchFn: typeof fetch): Promise<unknown> {
  const url = `${BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await avGate(() => fetchFn(url, { cache: "no-store" }));
  } catch {
    throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  }
  if (!res.ok) throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  return res.json();
}

/**
 * Alpha Vantage sometimes throttles a lone request with its rate-limit message; one retry usually succeeds.
 * Every call, the retry included, goes through lib/avGate.ts, which spaces all Alpha Vantage calls in this process,
 * so the retry waits out the gate's interval before it goes out.
 * Cost: AV sends the same message for the burst limit and the 25/day cap, so on a cap hit the retry wastes one call and the delay.
 */
async function withRateLimitRetry<T>(request: () => Promise<unknown>, parse: (json: unknown) => T): Promise<T> {
  try {
    return parse(await request());
  } catch (e) {
    if (!(e instanceof DataError) || e.code !== "RATE_LIMIT") throw e;
  }
  return parse(await request());
}

export function fetchEarnings(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<EarningsRecord[]> {
  return withRateLimitRetry(() => avGet("EARNINGS", symbol, apiKey, fetchFn), (j) => parseEarnings(j, symbol));
}

export function fetchRevenue(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Record<string, number>> {
  return withRateLimitRetry(() => avGet("INCOME_STATEMENT", symbol, apiKey, fetchFn), parseIncomeStatement);
}

export function fetchRevenueEstimates(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Record<string, number>> {
  return withRateLimitRetry(() => avGet("EARNINGS_ESTIMATES", symbol, apiKey, fetchFn), parseRevenueEstimates);
}
