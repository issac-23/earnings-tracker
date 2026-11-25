import { describe, it, expect } from "vitest";
import { resultFromResponse } from "@/lib/tickerResponse";

const html = (status: number) => new Response("<html>Gateway Timeout</html>", { status, headers: { "content-type": "text/html" } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("resultFromResponse", () => {
  it("an HTML 504 says the server took too long and can retry", async () => {
    expect(await resultFromResponse(html(504))).toEqual({ status: "error", message: "The server took too long to answer. Try again.", canRetry: true });
  });

  it("other non-JSON responses get a generic retryable message", async () => {
    expect(await resultFromResponse(html(502))).toEqual({ status: "error", message: "Something went wrong.", canRetry: true });
  });

  it("a JSON content-type with a broken body is generic and retryable", async () => {
    const res = new Response("not json", { status: 500, headers: { "content-type": "application/json" } });
    expect(await resultFromResponse(res)).toEqual({ status: "error", message: "Something went wrong.", canRetry: true });
  });

  it("keeps the API's own error message, retrying only UPSTREAM", async () => {
    expect(await resultFromResponse(json(429, { error: { code: "RATE_LIMIT", message: "Too many lookups at once. Try again in a few seconds." } })))
      .toEqual({ status: "error", message: "Too many lookups at once. Try again in a few seconds.", canRetry: false });
    expect(await resultFromResponse(json(502, { error: { code: "UPSTREAM", message: "Down." } })))
      .toMatchObject({ canRetry: true });
  });

  it("a JSON success becomes the report", async () => {
    const report = { symbol: "AAA", quarters: [] };
    expect(await resultFromResponse(json(200, report))).toEqual({ status: "done", report });
  });
});
