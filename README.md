# Earnings Reaction Tracker

Type a ticker, see its last 12 quarters: did EPS beat or miss analyst estimates, and how did the stock move compared with the S&P 500 in the days after the report.

## Setup
1. Get free API keys: https://www.alphavantage.co/support/#api-key and https://www.tiingo.com (Account → API → Token).
2. Copy `.env.example` to `.env.local` and paste both keys.
3. `npm install`
4. `npm run dev` → open http://localhost:3000

The app runs locally. Your keys are read on the server and never sent to the browser.

## Commands
- `npm run dev` — start the app
- `npm test` — run tests
- `npm run lint` — run ESLint
- `npm run probe -- NVDA` — live-check the data sources and save sample responses to `test/fixtures/`

## What the app shows
Enter a ticker (for example `NVDA`). You get a summary, a chart, and a table with one row per quarter, newest first.

Each quarter row has:
- EPS estimate → actual, and the surprise % (how far actual EPS landed from the estimate)
- Beat, miss or in line
- Revenue for that quarter
- The stock's move 1, 3 and 5 trading days after the report, measured against the S&P 500
- A flag when the reaction went against the result: **Beat but fell** or **Missed but rose**

The four summary numbers cover the quarters shown:
- **Beat rate**: quarters where EPS topped the estimate, out of quarters that have an estimate
- **Avg EPS surprise**
- **Avg 1-day move vs S&P**
- **Beat but fell**: beats where the stock lagged the S&P the next day, out of all beats

## How the numbers are worked out
- **Market**: SPY (an S&P 500 ETF) stands in for the S&P 500.
- **Base price**: the close the move is measured from.
  - Report before the open: the last close before the report date.
  - Report after the close, or timing unknown: the close on the report date.
  - Report date is not a trading day: the last close before it.
- **Day N**: N trading days after the base close, so weekends and holidays are skipped. For a before-open report, day 1 is the report-day close. For an after-close report, day 1 is the next trading day's close.
- **Excess move**: stock move minus SPY move over the same days. The 1/3/5-day figures in the table are excess moves.
- **Flags** use the 1-day excess move: a beat with a negative excess is "Beat but fell", a miss with a positive excess is "Missed but rose". Both compare to the market, not to zero.
- **Prices**: split-adjusted closes only. A move is left blank if the price history doesn't reach that far.
- **Quarters**: the 12 most recent quarters that have a reported EPS, newest first. A quarter with no estimate is shown but left out of the beat rate.
- **Surprise %**: (actual − estimate) / |estimate| × 100. Blank if there is no estimate or the estimate is exactly 0.

## Data sources and limits
- **Alpha Vantage** (free tier): earnings history (`EARNINGS`) and quarterly revenue (`INCOME_STATEMENT`). It allows 25 requests per day and throttles bursts, so each new ticker costs 2 of them and the app spaces the two calls out and retries once if throttled.
- **Tiingo** (free tier): daily prices for the ticker and for SPY, plus the company name.
- **Cache**: responses are saved as files in `.cache/` (git-ignored). Earnings, revenue and prices are reused for up to 24 hours, company names for 7 days. SPY prices are cached once and shared by every ticker. A ticker you've already looked up today costs no API calls.
- **"Stale"**: if a refresh fails (for example the daily quota is used up) and an older saved copy exists, the app shows it with the note "Showing saved data" instead of an error. The numbers may be out of date.

## Known limits
- Surprise % can be huge when the estimate is near $0 (for example a $0.01 estimate), so read the averages with care.
- ETFs such as SPY have no earnings, so they return "not found".
- Free-tier quota: after 25 Alpha Vantage requests in a day, new tickers fail until the quota resets. Tickers already cached keep working.
- Tickers must start with a letter and be at most 10 characters (letters, digits, `.` or `-`). Case doesn't matter.

## Project layout
- `app/` — Next.js pages and the `/api/ticker/[symbol]` route
- `components/` — search box, summary, chart and table
- `lib/` — the calculations (`reactions.ts`, `quarters.ts`, `summary.ts`), report assembly (`report.ts`) and the file cache
- `lib/sources/` — Alpha Vantage and Tiingo clients
- `test/` — Vitest tests and saved sample responses
- `scripts/` — the source probe script
- `docs/spec.md` — the design spec
