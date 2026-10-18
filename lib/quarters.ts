import { computeMove, flagOf, outcomeOf, surprisePct } from "./reactions";
import type { EarningsRecord, PriceBar, QuarterRow } from "./types";

export function buildQuarterRows(input: {
  earnings: EarningsRecord[];
  revenue: Record<string, number>;
  stock: PriceBar[];
  spy: PriceBar[];
  limit?: number;
}): QuarterRow[] {
  const spyByDate = new Map(input.spy.map((b) => [b.date, b.close]));
  return input.earnings
    .filter((e) => e.reportedEPS !== null)
    .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate))
    .slice(0, input.limit ?? 12)
    .map((e) => {
      const outcome = outcomeOf(e.reportedEPS, e.estimatedEPS);
      const move = (n: number) => computeMove(input.stock, spyByDate, e.reportedDate, e.timing, n);
      const d1 = move(1);
      return {
        fiscalDateEnding: e.fiscalDateEnding,
        reportedDate: e.reportedDate,
        timing: e.timing,
        estimatedEPS: e.estimatedEPS,
        reportedEPS: e.reportedEPS,
        surprisePct: surprisePct(e.reportedEPS, e.estimatedEPS),
        outcome,
        revenue: input.revenue[e.fiscalDateEnding] ?? null,
        moves: { d1, d3: move(3), d5: move(5) },
        flag: flagOf(outcome, d1),
      };
    });
}
