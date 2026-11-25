import type { QuarterRow, Summary } from "./types";

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(rows: QuarterRow[]): Summary {
  return {
    quartersWithEstimate: rows.filter((r) => r.outcome !== "unknown").length,
    beats: rows.filter((r) => r.outcome === "beat").length,
    medianSurprisePct: median(rows.flatMap((r) => (r.surprisePct === null ? [] : [r.surprisePct]))),
    avgD1Excess: mean(rows.flatMap((r) => (r.moves.d1 ? [r.moves.d1.excess] : []))),
    beatButFell: rows.filter((r) => r.flag === "beat-but-fell").length,
    excludedSmallEstimate: rows.filter((r) => r.surpriseUsd !== null).length,
  };
}
