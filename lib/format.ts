export const DASH = "—";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPct(n: number | null, digits = 1): string {
  if (n === null) return DASH;
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}

export function formatEps(n: number | null): string {
  if (n === null) return DASH;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

/** True when a dollar amount displays as $0.00. */
export const isZeroUsd = (n: number): boolean => Math.round(Math.abs(n) * 100) === 0;

export function formatUsdDelta(n: number | null): string {
  if (n === null) return DASH;
  if (isZeroUsd(n)) return "$0.00";
  const cents = Math.round(Math.abs(n) * 100);
  return `${n > 0 ? "+" : "-"}$${(cents / 100).toFixed(2)}`;
}

export function formatRevenue(n: number | null): string {
  if (n === null) return DASH;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString("en-US")}`;
}

export function formatMonthYear(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}
