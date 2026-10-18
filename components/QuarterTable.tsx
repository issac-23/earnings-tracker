import { formatDate, formatEps, formatMonthYear, formatPct, formatRevenue } from "@/lib/format";
import type { Move, QuarterRow } from "@/lib/types";

const tone = (n: number | null | undefined) =>
  n == null || Number(n.toFixed(1)) === 0 ? "" : n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";

const FLAG_LABEL = { "beat-but-fell": "Beat but fell", "missed-but-rose": "Missed but rose" } as const;
const TIMING_LABEL = { BMO: "before open", AMC: "after close", unknown: "timing unknown" } as const;

function MoveCell({ move }: { move: Move | null }) {
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${tone(move?.excess)}`}
      title={move ? `Stock ${formatPct(move.stock)} · S&P ${formatPct(move.spy)}` : "Not enough trading days yet"}
    >
      {formatPct(move?.excess ?? null)}
    </td>
  );
}

export function QuarterTable({ quarters }: { quarters: QuarterRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400 dark:bg-zinc-900">
          <tr>
            <th scope="col" className="px-3 py-2">Quarter ended</th>
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
            <tr key={q.fiscalDateEnding} className={q.flag ? "bg-amber-50 dark:bg-amber-950/40" : ""}>
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                {formatMonthYear(q.fiscalDateEnding)}
                {q.flag && (
                  <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
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
