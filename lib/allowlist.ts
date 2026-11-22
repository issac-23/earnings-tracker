const MAX_LISTED = 20;

/** Parse ALLOWED_TICKERS. Returns null (no restriction) when unset or empty. */
export function parseAllowlist(value: string | undefined): string[] | null {
  const symbols = (value ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? [...new Set(symbols)] : null;
}

export function isAllowed(symbol: string, list: string[] | null): boolean {
  return list === null || list.includes(symbol.toUpperCase());
}

export function notAllowedMessage(symbol: string, list: string[]): string {
  const shown = list.slice(0, MAX_LISTED).join(", ");
  return `${symbol} isn't available on this site. Available tickers: ${shown}${list.length > MAX_LISTED ? "…" : "."}`;
}
