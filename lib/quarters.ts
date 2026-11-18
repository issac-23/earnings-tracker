import { computeMove, flagOf, outcomeOf, revenueSurprisePct, surprisePct, surpriseUsd } from "./reactions";
import type { EarningsRecord, PriceBar, QuarterRow } from "./types";

export function buildQuarterRows(input: {
  earnings: EarningsRecord[];
  revenue: Record<string, number>;
  revenueEstimates?: Record<string, number>;
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
      const revenue = input.revenue[e.fiscalDateEnding] ?? null;
      const revenueEstimate = input.revenueEstimates?.[e.fiscalDateEnding] ?? null;
      return {
        fiscalDateEnding: e.fiscalDateEnding,
        reportedDate: e.reportedDate,
        timing: e.timing,
        estimatedEPS: e.estimatedEPS,
        reportedEPS: e.reportedEPS,
        surprisePct: surprisePct(e.reportedEPS, e.estimatedEPS),
        surpriseUsd: surpriseUsd(e.reportedEPS, e.estimatedEPS),
        outcome,
        revenue,
        revenueEstimate,
        revenueSurprisePct: revenueSurprisePct(revenue, revenueEstimate),
        // A non-positive estimate is not a usable consensus, so it gives no outcome.
        revenueOutcome: revenueEstimate !== null && revenueEstimate > 0 ? outcomeOf(revenue, revenueEstimate) : "unknown",
        moves: { d1, d3: move(3), d5: move(5) },
        flag: flagOf(outcome, d1),
      };
    });
}
