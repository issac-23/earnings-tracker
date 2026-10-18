"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonthYear, formatPct } from "@/lib/format";
import type { QuarterRow } from "@/lib/types";

// Categorical slots 1 (blue) and 2 (orange) from the dataviz palette, stepped per theme.
const THEME_VARS =
  "[--viz-surprise:#2a78d6] [--viz-reaction:#eb6834] [--viz-surface:#fcfcfb] [--viz-ink:#0b0b0b] [--viz-muted:#52514e] " +
  "dark:[--viz-surprise:#3987e5] dark:[--viz-reaction:#d95926] dark:[--viz-surface:#1a1a19] dark:[--viz-ink:#f0efec] dark:[--viz-muted:#c3c2b7]";

export function QuarterChart({ quarters }: { quarters: QuarterRow[] }) {
  const data = [...quarters].reverse().map((q) => ({
    label: formatMonthYear(q.fiscalDateEnding),
    surprise: q.surprisePct,
    reaction: q.moves.d1?.excess ?? null,
  }));
  const tick = { fontSize: 12, fill: "var(--viz-muted)" };
  return (
    <figure className={`${THEME_VARS} rounded-xl border border-zinc-200 p-4 dark:border-zinc-800`}>
      <figcaption className="mb-3 text-sm text-zinc-500">
        EPS surprise vs 1-day move vs S&amp;P 500 (%) — bars pointing opposite ways mean results and reaction disagreed
      </figcaption>
      <div
        className="h-72"
        role="img"
        aria-label="Bar chart comparing EPS surprise with the 1-day move versus the S&P 500 for each quarter. Exact values are in the table below."
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-muted)" strokeOpacity={0.2} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={8} />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ fill: "var(--viz-muted)", fillOpacity: 0.12 }}
              formatter={(v) => formatPct(typeof v === "number" ? v : null)}
              contentStyle={{
                background: "var(--viz-surface)",
                border: "1px solid var(--viz-muted)",
                borderRadius: 8,
                color: "var(--viz-ink)",
              }}
              labelStyle={{ color: "var(--viz-ink)" }}
              itemStyle={{ color: "var(--viz-ink)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => <span style={{ color: "var(--viz-ink)" }}>{value}</span>}
            />
            <ReferenceLine y={0} stroke="var(--viz-muted)" strokeOpacity={0.8} />
            <Bar dataKey="surprise" name="EPS surprise" fill="var(--viz-surprise)" radius={2} maxBarSize={18} />
            <Bar dataKey="reaction" name="1-day move vs S&P" fill="var(--viz-reaction)" radius={2} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
