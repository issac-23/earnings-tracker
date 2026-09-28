export type ReportTiming = "BMO" | "AMC" | "unknown";

export interface EarningsRecord {
  fiscalDateEnding: string; // YYYY-MM-DD
  reportedDate: string; // YYYY-MM-DD
  timing: ReportTiming;
  reportedEPS: number | null;
  estimatedEPS: number | null;
}

/** One trading day. `close` is split/dividend-adjusted. Arrays are sorted oldest → newest. */
export interface PriceBar {
  date: string; // YYYY-MM-DD
  close: number;
}

/** Percent moves over the same trading days. */
export interface Move {
  stock: number;
  spy: number;
  excess: number; // stock − spy
}

export type Outcome = "beat" | "miss" | "inline" | "unknown";
export type Flag = "beat-but-fell" | "missed-but-rose" | null;

export interface QuarterRow {
  fiscalDateEnding: string;
  reportedDate: string;
  timing: ReportTiming;
  estimatedEPS: number | null;
  reportedEPS: number | null;
  surprisePct: number | null;
  outcome: Outcome;
  revenue: number | null;
  moves: { d1: Move | null; d3: Move | null; d5: Move | null };
  flag: Flag;
}

export interface Summary {
  quartersWithEstimate: number;
  beats: number;
  avgSurprisePct: number | null;
  avgD1Excess: number | null;
  beatButFell: number;
}

export interface TickerReport {
  symbol: string;
  name: string | null;
  quarters: QuarterRow[]; // newest first
  summary: Summary;
  fetchedAt: string; // ISO timestamp
  stale: boolean; // true if any core data came from an expired cache after a failed refresh
}
