"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TickerReport } from "@/lib/types";
import { QuarterChart } from "./QuarterChart";
import { QuarterTable } from "./QuarterTable";
import { SearchBox } from "./SearchBox";
import { SummaryStrip } from "./SummaryStrip";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; canRetry: boolean }
  | { status: "done"; report: TickerReport };

function Report({ report }: { report: TickerReport }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">{report.name ? `${report.name} (${report.symbol})` : report.symbol}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Last {report.quarters.length} quarters · 1D / 3D / 5D moves are the stock minus the S&amp;P 500, in %
        </p>
        {report.stale && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {"Showing saved data — the data provider couldn't be refreshed, so this may be out of date."}
          </p>
        )}
      </div>
      <SummaryStrip summary={report.summary} />
      <QuarterChart quarters={report.quarters} />
      <QuarterTable quarters={report.quarters} />
    </div>
  );
}

export function Tracker() {
  const router = useRouter();
  const symbol = (useSearchParams().get("t") ?? "").trim().toUpperCase();
  const [state, setState] = useState<State>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!symbol) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/ticker/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) setState({ status: "done", report: body as TickerReport });
        else
          setState({
            status: "error",
            message: body?.error?.message ?? "Something went wrong.",
            canRetry: body?.error?.code === "UPSTREAM",
          });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Couldn't reach the data provider.", canRetry: true });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, attempt]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Earnings Reaction Tracker</h1>
        <SearchBox
          key={symbol}
          initial={symbol}
          busy={state.status === "loading"}
          onSubmit={(s) => router.push(`/?t=${encodeURIComponent(s)}`)}
        />
      </header>
      <section className="mt-8" aria-live="polite">
        {state.status === "idle" && (
          <p className="max-w-prose text-zinc-600 dark:text-zinc-400">
            Type a ticker to see how its last 12 earnings reports compared with analyst expectations — and how the stock reacted.
          </p>
        )}
        {state.status === "loading" && <p className="text-zinc-600 dark:text-zinc-400">Loading {symbol}…</p>}
        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <p>{state.message}</p>
            {state.canRetry && (
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-3 font-medium underline">
                Try again
              </button>
            )}
          </div>
        )}
        {state.status === "done" && <Report report={state.report} />}
      </section>
    </main>
  );
}
