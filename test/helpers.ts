import type { PriceBar } from "@/lib/types";

export const bars = (pairs: [string, number][]): PriceBar[] =>
  pairs.map(([date, close]) => ({ date, close }));

// Mon Aug 25 – Thu Sep 4, 2025. Mon Sep 1 is Labor Day (no trading).
export const STOCK = bars([
  ["2025-08-25", 100], ["2025-08-26", 102], ["2025-08-27", 104], ["2025-08-28", 110],
  ["2025-08-29", 99], ["2025-09-02", 105], ["2025-09-03", 106], ["2025-09-04", 108],
]);

// SPY flat at 400 except Thu Aug 28 at 404.
export const SPY_BARS: PriceBar[] = STOCK.map((b) => ({
  date: b.date,
  close: b.date === "2025-08-28" ? 404 : 400,
}));

export const spyMap = () => new Map(SPY_BARS.map((b) => [b.date, b.close]));
