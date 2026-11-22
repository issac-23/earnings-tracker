import os from "node:os";
import { isAllowed, notAllowedMessage, parseAllowlist } from "@/lib/allowlist";
import { cacheDir, createFileCache } from "@/lib/cache";
import { DataError, type DataErrorCode } from "@/lib/errors";
import { coalesce } from "@/lib/inflight";
import { buildTickerReport, normalizeSymbol } from "@/lib/report";

export const dynamic = "force-dynamic";

const STATUS: Record<DataErrorCode, number> = { NOT_FOUND: 404, RATE_LIMIT: 429, MISSING_KEY: 500, UPSTREAM: 502, NOT_ALLOWED: 403 };
const cache = createFileCache(cacheDir(process.env, process.cwd(), os.tmpdir()));

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const raw = decodeURIComponent(symbol);
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
    return Response.json(report);
  } catch (err) {
    if (err instanceof DataError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code] });
    }
    console.error(err);
    return Response.json({ error: { code: "UPSTREAM", message: "Something went wrong." } }, { status: 500 });
  }
}
