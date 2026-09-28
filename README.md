# Earnings Reaction Tracker

Type a ticker, see its last 12 quarters: did EPS beat or miss analyst estimates, and how did the stock move vs the S&P 500 1, 3, and 5 trading days later.

## Setup
1. Get free API keys: https://www.alphavantage.co/support/#api-key and https://www.tiingo.com (Account → API → Token).
2. Copy `.env.example` to `.env.local` and paste both keys.
3. `npm install`
4. `npm run dev` → open http://localhost:3000

## Commands
- `npm test` — run tests
- `npm run probe -- NVDA` — live-check the data sources and save sample responses to `test/fixtures/`
