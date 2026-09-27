import type { Flag, Move, Outcome, PriceBar, ReportTiming } from "./types";

export function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

export function outcomeOf(actual: number | null, estimate: number | null): Outcome {
  if (actual === null || estimate === null) return "unknown";
  if (actual > estimate) return "beat";
  if (actual < estimate) return "miss";
  return "inline";
}

/**
 * Index of the "base" close the reaction is measured from.
 * BMO: last close strictly before the report date.
 * AMC / unknown: close on the report date, or the last close before it if it wasn't a trading day.
 */
export function baseIndex(bars: PriceBar[], reportedDate: string, timing: ReportTiming): number | null {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    const d = bars[i].date;
    const before = timing === "BMO" ? d < reportedDate : d <= reportedDate;
    if (!before) break;
    idx = i;
  }
  return idx >= 0 ? idx : null;
}

export function computeMove(
  stock: PriceBar[],
  spyByDate: Map<string, number>,
  reportedDate: string,
  timing: ReportTiming,
  n: number,
): Move | null {
  const b = baseIndex(stock, reportedDate, timing);
  if (b === null || b + n >= stock.length) return null;
  const base = stock[b];
  const end = stock[b + n];
  const spyBase = spyByDate.get(base.date);
  const spyEnd = spyByDate.get(end.date);
  if (spyBase === undefined || spyEnd === undefined) return null;
  const stockPct = (end.close / base.close - 1) * 100;
  const spyPct = (spyEnd / spyBase - 1) * 100;
  return { stock: stockPct, spy: spyPct, excess: stockPct - spyPct };
}

export function flagOf(outcome: Outcome, d1: Move | null): Flag {
  if (!d1) return null;
  if (outcome === "beat" && d1.excess < 0) return "beat-but-fell";
  if (outcome === "miss" && d1.excess > 0) return "missed-but-rose";
  return null;
}
