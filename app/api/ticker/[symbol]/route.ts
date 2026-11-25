import os from "node:os";
import { isAllowed, notAllowedMessage, parseAllowlist } from "@/lib/allowlist";
import { cacheDir, createFileCache } from "@/lib/cache";
import { DataError, type DataErrorCode } from "@/lib/errors";
import { coalesce } from "@/lib/inflight";
import { buildTickerReport, normalizeSymbol } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // a new ticker can queue behind the Alpha Vantage gate for several seconds

const STATUS: Record<DataErrorCode, number> = { NOT_FOUND: 404, RATE_LIMIT: 429, MISSING_KEY: 500, UPSTREAM: 502, NOT_ALLOWED: 403 };

// Shared-cache (CDN) only: s-maxage, no max-age, so browsers never hold old data.
const CACHE_REPORT = "public, s-maxage=86400, stale-while-revalidate=86400";
const CACHE_STALE_REPORT = "public, s-maxage=300"; // degraded data must not be pinned for a day
const CACHE_STABLE_ERROR = "public, s-maxage=3600"; // NOT_FOUND / NOT_ALLOWED
const CACHE_NONE = "no-store"; // transient or config errors
const ERROR_CACHE: Record<DataErrorCode, string> = {
  NOT_FOUND: CACHE_STABLE_ERROR,
  NOT_ALLOWED: CACHE_STABLE_ERROR,
  RATE_LIMIT: CACHE_NONE,
  UPSTREAM: CACHE_NONE,
  MISSING_KEY: CACHE_NONE,
};
const cache = createFileCache(cacheDir(process.env, process.cwd(), os.tmpdir()));

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    // Next already decodes the param; a second decode can throw on stray "%", so fall back to the raw value.
    let raw = symbol;
    try {
      raw = decodeURIComponent(symbol);
    } catch {}
    const build = () =>
      buildTickerReport(raw, {
        cache,
        avKey: process.env.ALPHAVANTAGE_API_KEY,
        tiingoKey: process.env.TIINGO_API_KEY,
      });
    // Invalid symbols skip coalescing and hit the normal error path inside buildTickerReport.
    const key = normalizeSymbol(raw);
    // Optional allowlist protects the shared API quota; checked before any cache read or fetch.
    const allowlist = parseAllowlist(process.env.ALLOWED_TICKERS);
    if (key && allowlist && !isAllowed(key, allowlist)) {
      throw new DataError("NOT_ALLOWED", notAllowedMessage(key, allowlist));
    }
    const report = await (key ? coalesce(key, build) : build());
    return Response.json(report, { headers: { "Cache-Control": report.stale || report.degraded ? CACHE_STALE_REPORT : CACHE_REPORT } });
  } catch (err) {
    if (err instanceof DataError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code], headers: { "Cache-Control": ERROR_CACHE[err.code] } });
    }
    console.error(err);
    return Response.json({ error: { code: "UPSTREAM", message: "Something went wrong." } }, { status: 500, headers: { "Cache-Control": CACHE_NONE } });
  }
}
