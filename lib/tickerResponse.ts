import type { TickerReport } from "./types";

export type TickerResult =
  | { status: "done"; report: TickerReport }
  | { status: "error"; message: string; canRetry: boolean };

/** Turn the ticker API response into what the page shows. A non-JSON body (a host's HTML 504 page, say) never reaches res.json(). */
export async function resultFromResponse(res: Response): Promise<TickerResult> {
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  if (!isJson) {
    return res.status === 504
      ? { status: "error", message: "The server took too long to answer. Try again.", canRetry: true }
      : { status: "error", message: "Something went wrong.", canRetry: true };
  }
  let body: { error?: { message?: string; code?: string } } | TickerReport;
  try {
    body = await res.json();
  } catch {
    return { status: "error", message: "Something went wrong.", canRetry: true };
  }
  if (res.ok) return { status: "done", report: body as TickerReport };
  const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
  return { status: "error", message: err?.message ?? "Something went wrong.", canRetry: err?.code === "UPSTREAM" || err?.code === "RATE_LIMIT" };
}
