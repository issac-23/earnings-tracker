import path from "node:path";
import { createFileCache } from "@/lib/cache";
import { DataError, type DataErrorCode } from "@/lib/errors";
import { buildTickerReport } from "@/lib/report";

export const dynamic = "force-dynamic";

const STATUS: Record<DataErrorCode, number> = { NOT_FOUND: 404, RATE_LIMIT: 429, MISSING_KEY: 500, UPSTREAM: 502 };
const cache = createFileCache(path.join(process.cwd(), ".cache"));

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const report = await buildTickerReport(decodeURIComponent(symbol), {
      cache,
      avKey: process.env.ALPHAVANTAGE_API_KEY,
      tiingoKey: process.env.TIINGO_API_KEY,
    });
    return Response.json(report);
  } catch (err) {
    if (err instanceof DataError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code] });
    }
    console.error(err);
    return Response.json({ error: { code: "UPSTREAM", message: "Something went wrong." } }, { status: 500 });
  }
}
