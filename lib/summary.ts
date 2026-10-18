import type { QuarterRow, Summary } from "./types";

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function summarize(rows: QuarterRow[]): Summary {
  return {
    quartersWithEstimate: rows.filter((r) => r.outcome !== "unknown").length,
    beats: rows.filter((r) => r.outcome === "beat").length,
    avgSurprisePct: mean(rows.flatMap((r) => (r.surprisePct === null ? [] : [r.surprisePct]))),
    avgD1Excess: mean(rows.flatMap((r) => (r.moves.d1 ? [r.moves.d1.excess] : []))),
    beatButFell: rows.filter((r) => r.flag === "beat-but-fell").length,
  };
}
