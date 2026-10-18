import { formatDate, formatEps, formatMonthYear, formatPct, formatRevenue } from "@/lib/format";
import type { Move, QuarterRow } from "@/lib/types";

const tone = (n: number | null | undefined) =>
  n == null || Number(n.toFixed(1)) === 0 ? "" : n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";

const FLAG_LABEL = { "beat-but-fell": "Beat but fell", "missed-but-rose": "Missed but rose" } as const;
const TIMING_LABEL = { BMO: "before open", AMC: "after close", unknown: "timing unknown" } as const;

function MoveCell({ move }: { move: Move | null }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {move ? (
        <>
          <span className={tone(move.excess)}>{formatPct(move.excess)}</span>
          <span className="block whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
            Stock {formatPct(move.stock)} · S&amp;P {formatPct(move.spy)}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">not enough trading days yet</span>
        </>
      )}
    </td>
  );
}

export function QuarterTable({ quarters }: { quarters: QuarterRow[] }) {
  return (
    <div
      role="region"
      aria-label="Quarterly results"
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-800"
    >
      <table className="w-full min-w-[920px] text-sm">
        <caption className="sr-only">
          Earnings results by quarter: EPS estimate and actual, surprise, revenue, and 1, 3 and 5 day moves versus the S&amp;P 500
        </caption>
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400 dark:bg-zinc-900">
          <tr>
            <th scope="col" className="sticky left-0 bg-zinc-50 px-2 py-2 sm:px-3 dark:bg-zinc-900">Quarter ended</th>
            <th scope="col" className="px-3 py-2">Reported</th>
            <th scope="col" className="px-3 py-2 text-right">EPS est → actual</th>
            <th scope="col" className="px-3 py-2 text-right">Surprise</th>
            <th scope="col" className="px-3 py-2 text-right">Revenue</th>
            <th scope="col" className="px-3 py-2 text-right">1D</th>
            <th scope="col" className="px-3 py-2 text-right">3D</th>
            <th scope="col" className="px-3 py-2 text-right">5D</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {quarters.map((q) => (
            <tr key={q.fiscalDateEnding} className={q.flag ? "bg-amber-50 dark:bg-[#221007]" : "bg-background"}>
              <th scope="row" className="sticky left-0 whitespace-nowrap bg-inherit px-2 py-2 text-left font-medium sm:px-3">
                {formatMonthYear(q.fiscalDateEnding)}
                {q.flag && (
                  <span className="mt-0.5 block w-fit rounded bg-amber-200 px-1.5 py-0.5 text-[11px] sm:ml-2 sm:mt-0 sm:inline sm:text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    {FLAG_LABEL[q.flag]}
                  </span>
                )}
              </th>
              <td className="whitespace-nowrap px-3 py-2">
                {formatDate(q.reportedDate)} <span className="text-zinc-600 dark:text-zinc-400">· {TIMING_LABEL[q.timing]}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatEps(q.estimatedEPS)} → {formatEps(q.reportedEPS)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(q.surprisePct)}`}>{formatPct(q.surprisePct)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRevenue(q.revenue)}</td>
              <MoveCell move={q.moves.d1} />
              <MoveCell move={q.moves.d3} />
              <MoveCell move={q.moves.d5} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
