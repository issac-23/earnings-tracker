import { formatPct } from "@/lib/format";
import type { Summary } from "@/lib/types";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-zinc-500">{note}</dd>
    </div>
  );
}

export function SummaryStrip({ summary: s }: { summary: Summary }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Beat rate" value={`${s.beats} / ${s.quartersWithEstimate}`} note="quarters where EPS topped the estimate" />
      <Stat label="Avg EPS surprise" value={formatPct(s.avgSurprisePct)} note="how far actual EPS landed from the estimate" />
      <Stat label="Avg 1-day move vs S&P" value={formatPct(s.avgD1Excess)} note="stock minus S&P 500, first day after the report" />
      <Stat label="Beat but fell" value={`${s.beatButFell} / ${s.beats}`} note="beats where the stock lagged the S&P next day" />
    </dl>
  );
}
