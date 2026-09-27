# Earnings Reaction Tracker — Version 1 Design

_Date: 2026-09-26 · Status: awaiting product-owner review_

## Goal

Pick a ticker and see its last 12 quarters: did the company beat or miss analyst EPS expectations, by how much, and how did the stock move vs the S&P 500 over the 1, 3, and 5 trading days after the report. The headline insight is the gap between results and reaction ("beat but fell").

Personal tool first, runs locally. Built so it can be deployed and shared later without a rewrite. Cost: $0.

## In scope (v1)

- Single page with a ticker search box.
- Summary strip (4 numbers): beat rate, average EPS surprise %, average 1-day move vs S&P, "beat but fell" count.
- Chart: per quarter, two bars side by side — EPS surprise % and 1-day move vs S&P.
- Table: one row per quarter — fiscal quarter, report date + timing (BMO/AMC), EPS estimate → actual, surprise %, reported revenue, 1D/3D/5D move vs S&P. Hover a move cell to see raw stock move and S&P move separately.
- Highlight rows where results and reaction disagree ("beat but fell", "missed but rose").
- Works on phone and desktop; looks right in light and dark system themes.

## Out of scope (v1, candidates for v2)

Watchlists / multi-ticker comparison, upcoming earnings calendar, revenue beat/miss (needs a paid estimates source), accounts, alerts.

## Data sources

| Need | Source | Notes |
|---|---|---|
| EPS actual, estimate, surprise, report date, report timing | Alpha Vantage `EARNINGS` (free key) | 25 requests/day limit |
| Reported quarterly revenue | Alpha Vantage `INCOME_STATEMENT` (free key) | Matched to quarters by fiscal date |
| Daily closing prices for ticker and SPY | Tiingo EOD prices (free key) | SPY stands in for the S&P 500 |

API keys live in `.env.local`, never in code or in the browser. All calls happen on the server side of the app.

**Caching:** every API response is saved locally in a `.cache/` folder. Earnings data is reused for 24 hours, then refreshed once per day at most. Price history is refreshed once per day at most. A ticker costs 2 Alpha Vantage calls the first time and 0 after that, so the 25/day limit only matters when looking up many new tickers in one day. The cache sits behind a small interface so it can be swapped for a hosted store when deployed.

**First build step verifies these sources** with real calls before any UI is built. If a source doesn't return what's described here, stop and bring options to the product owner.

## Calculations

- **Surprise %** = (actual − estimate) / |estimate| × 100. Beat if actual > estimate, miss if actual < estimate, in-line if equal. If the estimate is missing, the row shows "—" and is left out of the averages.
- **Day-1 alignment:**
  - BMO (before market open): base = close on the trading day *before* the report date; day 1 = close on the report date.
  - AMC (after market close): base = close on the report date; day 1 = close on the next trading day.
  - Timing unknown: treat as AMC and show a small "timing unknown" marker.
  - If the report date is not a trading day, base = last close before it; day 1 = first close after it.
- **N-day move** = (close on day N / base close − 1) × 100, counting trading days (days with a price), not calendar days.
- **Move vs S&P** = stock N-day move − SPY N-day move over the same days.
- **Beat but fell** = beat AND 1-day move vs S&P < 0. **Missed but rose** = miss AND 1-day move vs S&P > 0.
- If a recent report doesn't yet have N trading days after it, that cell shows "—".

## Architecture

Next.js (TypeScript) web app, Tailwind for styling, Recharts for the chart. Each unit has one job:

- `lib/sources/alphaVantage.ts` — fetches and cleans earnings + revenue data.
- `lib/sources/tiingo.ts` — fetches and cleans daily prices.
- `lib/cache.ts` — read/write cached responses with a max age.
- `lib/reactions.ts` — pure functions: day-1 alignment, N-day moves, vs-S&P, surprise, flags. No network calls.
- `lib/summary.ts` — pure functions: the 4 summary numbers from a list of quarters.
- `app/api/ticker/[symbol]/route.ts` — server endpoint that combines the above and returns one JSON result per ticker.
- `app/page.tsx` + components (`SearchBox`, `SummaryStrip`, `QuarterChart`, `QuarterTable`) — the screen.

Flow: user types a ticker → page calls the server endpoint → endpoint reads cache or calls APIs → computes quarters + summary → page renders.

## Error handling

| Situation | What the user sees |
|---|---|
| Unknown ticker / no earnings history (e.g. an ETF) | "No earnings history found for XYZ." |
| Alpha Vantage daily limit hit | Cached data if any is available, with a note; otherwise "Daily data limit reached — try again tomorrow or use a ticker you've looked up before." |
| Missing API key | Clear setup message naming which key is missing (local only). |
| Network/API failure | "Couldn't reach the data provider" plus a retry button. |
| Partial data (e.g. no revenue) | Row still shows; missing cells show "—". |

## Testing

- Unit tests (Vitest) for `reactions.ts` and `summary.ts`: BMO vs AMC alignment, weekend/holiday report dates, too-recent reports, missing estimates, beat/miss/in-line, flags.
- Source parsers tested against saved sample API responses (no live calls in tests).
- Manual check with 3 real tickers (e.g. NVDA, AAPL, one that has missed recently), spot-checking one quarter each against a public source.

## Location

`C:\Users\issac\Projects\earnings-tracker` (outside the Obsidian vault).

## Needed from the product owner

1. Free Alpha Vantage API key (alphavantage.co, ~2 minutes).
2. Free Tiingo API key (tiingo.com, ~2 minutes).
