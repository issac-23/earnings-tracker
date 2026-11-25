# Earnings Reaction Tracker

Type a ticker, see its last 12 quarters: did EPS beat or miss analyst estimates, and how did the stock move compared with the S&P 500 in the days after the report.

## Setup
1. Get free API keys: https://www.alphavantage.co/support/#api-key and https://www.tiingo.com (Account → API → Token).
2. Copy `.env.example` to `.env.local` and paste both keys.
3. `npm install`
4. `npm run dev` → open http://localhost:3000

Your keys are read on the server and never sent to the browser. To run it on the web instead of your own machine, see Deploy to Vercel below.

## Deploy to Vercel
The code is already in a public GitHub repo, so there is nothing to upload. The button names below are approximate; Vercel may word them differently.
1. On vercel.com, choose Add New → Project and import `issac-23/earnings-tracker`.
2. Vercel should detect Next.js on its own. Keep the default build settings.
3. Under Environment Variables, add `ALPHAVANTAGE_API_KEY` and `TIINGO_API_KEY`. Paste your own key for each. Never put keys in the repo. For a public site, also add `ALLOWED_TICKERS` (see the shared-quota note below), for example `NVDA,AAPL,MSFT`.
4. Click Deploy.

What to expect once it is live:
- **Lookups are cached at the edge.** Successful lookups are cached at Vercel's edge for a day (five minutes if some data is missing or saved), so repeat lookups of the same ticker don't spend Alpha Vantage quota. Errors that can recover, such as a rate limit, are not cached.
- **The cache is temporary.** On Vercel the only writable place is `/tmp`. The app saves its cache there, and `/tmp` belongs to one server instance and is wiped when that instance is recycled. Repeat lookups will go back to the data sources more often than they do locally.
- **The Alpha Vantage quota is shared.** The free tier allows 25 requests a day and each new ticker costs 3. A public URL that anyone can open draws from that one quota, so about 8 new tickers a day across all visitors. Once it runs out, new tickers fail until it resets. **Setting `ALLOWED_TICKERS` is strongly recommended for any public URL.** Set it to a comma-separated list such as `NVDA,AAPL,MSFT` (case and spaces don't matter). Any other ticker is refused with a 403 before it touches the cache or the API. Leave it unset or empty to allow any ticker, but then anyone can use up the quota. Unknown tickers are remembered for an hour, so repeating the same bad symbol doesn't spend quota, but each new bad symbol still costs one call.
- **The pause between calls is per instance.** The 1.5 second spacing between Alpha Vantage calls is kept in memory by each server instance. Two instances running at once do not coordinate, so throttling is more likely under heavy use. If too many lookups queue up at once, new ones get a quick "try again" instead of waiting, and lookups stop after 30 seconds.
- **Optional:** set `CACHE_DIR` to put the cache somewhere else. Without it, the cache goes in `/tmp` on Vercel and in `.cache/` when running locally.

## Commands
- `npm run dev` — start the app
- `npm test` — run tests
- `npm run lint` — run ESLint
- `npm run typecheck` — generate Next route types, then type-check with `tsc`
- `npm run probe -- NVDA` — live-check the data sources and save sample responses to `test/fixtures/`

## What the app shows
Enter a ticker (for example `NVDA`). You get a summary, a chart, and a table with one row per quarter, newest first.

Each quarter row has:
- EPS estimate → actual, and the surprise % (how far actual EPS landed from the estimate), or the surprise in dollars when the estimate is under $0.10
- Beat, miss or in line
- Revenue estimate → actual, and the revenue surprise % (how far actual revenue landed from the analyst consensus), colored like the EPS surprise
- The stock's move 1, 3 and 5 trading days after the report, measured against the S&P 500
- A flag when the reaction went against the result: **Beat but fell** or **Missed but rose**

The four summary numbers cover the quarters shown:
- **Beat rate**: quarters where EPS topped the estimate, out of quarters that have an estimate
- **Median EPS surprise**: the typical gap between actual EPS and the estimate. The median is used so one quarter with a tiny estimate can't swamp the rest
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
- **Revenue surprise %**: (actual revenue − estimate) / estimate × 100, matching each estimate to its quarter by exact fiscal quarter end date. Blank if either number is missing or the estimate is not positive. If the estimates call fails or the quota is used up, the table shows revenue without estimates.
- **Quarters**: the 12 most recent quarters that have a reported EPS, newest first. A quarter with no estimate is shown but left out of the beat rate.
- **Surprise %**: (actual − estimate) / |estimate| × 100. Blank if there is no estimate, or if the estimate is under $0.10 in absolute value (including exactly 0), because the percent blows up on tiny estimates. Those quarters show the dollar surprise (actual − estimate, for example +$0.28) instead, have no surprise bar in the chart, and are left out of the average surprise, which says how many quarters it excluded.

## Data sources and limits
- **Alpha Vantage** (free tier): earnings history (`EARNINGS`) quarterly revenue (`INCOME_STATEMENT`) and analyst revenue estimates (`EARNINGS_ESTIMATES`). It allows 25 requests per day and throttles bursts, so each new ticker costs 3 of them (about 8 new tickers a day instead of 12) and the app spaces the three calls out and retries once if throttled.
- **Tiingo** (free tier): daily prices for the ticker and for SPY, plus the company name.
- **Cache**: responses are saved as files in `.cache/` (git-ignored); on Vercel, in the temp folder instead (see Deploy to Vercel). Earnings, revenue, revenue estimates and prices are reused for up to 24 hours, company names for 7 days. SPY prices are cached once and shared by every ticker. A ticker you've already looked up today costs no API calls.
- **"Stale"**: if a refresh fails (for example the daily quota is used up) and an older saved copy exists, the app shows it with the note "Showing saved data" instead of an error. The numbers may be out of date.

## Known limits
- Quarters with an estimate under $0.10 show a dollar surprise instead of a percent, so the average surprise % only covers the other quarters. The beat rate still counts every quarter with an estimate.
- Past revenue estimates come from Alpha Vantage's estimate history; it isn't documented whether they are the final consensus before each report.
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
