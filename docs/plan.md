# Earnings Reaction Tracker v1 Implementation Plan

**Goal:** A local Next.js web app where you type a ticker and see its last 12 quarters of EPS beat/miss and the stock's 1/3/5-day move vs the S&P 500 after each report.

**Architecture:** Pure calculation functions (`lib/reactions.ts`, `lib/quarters.ts`, `lib/summary.ts`) are fed by two thin data-source modules (Alpha Vantage, Tiingo) behind a file cache. One server endpoint (`/api/ticker/[symbol]`) assembles a `TickerReport` JSON; a single client page renders it.

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind CSS, Recharts, Vitest. Node 24.

**Spec:** `docs/spec.md`

## Global Constraints

- Cost: $0. Only free Alpha Vantage and Tiingo keys.
- API keys are read only on the server from `.env.local` (`ALPHAVANTAGE_API_KEY`, `TIINGO_API_KEY`). Never expose them to the browser, never commit them.
- Cache lives in `.cache/` (git-ignored). Earnings/revenue/prices max age 24h; company name 7 days.
- Tests make no live network calls. Live calls happen only in `scripts/probe-sources.mjs`.
- Code lives at project root (`app/`, `lib/`, `components/`, `test/`), not `src/`. Import alias `@/*` → project root.
- `next build` type-checks every `.ts` file, including `test/` — test code must type-check too.
- Show missing values as "—" (em dash).
- User-facing error copy (verbatim from spec):
  - `No earnings history found for XYZ.`
  - `Daily data limit reached — try again tomorrow or use a ticker you've looked up before.`
  - `Couldn't reach the data provider.`
- 🛑 marks a product-owner checkpoint: stop, show the result, wait for a go-ahead.

## File Map

| File | Responsibility |
|---|---|
| `lib/types.ts` | Shared data types |
| `lib/errors.ts` | `DataError` with a code (`NOT_FOUND`, `RATE_LIMIT`, `MISSING_KEY`, `UPSTREAM`) |
| `lib/reactions.ts` | Surprise %, beat/miss, day-1 alignment, N-day moves, flags (pure) |
| `lib/quarters.ts` | Turn raw earnings + prices + revenue into `QuarterRow[]` (pure) |
| `lib/summary.ts` | The 4 summary numbers (pure) |
| `lib/cache.ts` | File cache + `cachedFetch` with max age and stale fallback |
| `lib/sources/alphaVantage.ts` | Fetch + parse earnings and revenue |
| `lib/sources/tiingo.ts` | Fetch + parse prices and company name |
| `lib/report.ts` | `buildTickerReport()` — combines everything |
| `lib/format.ts` | Display formatting (%, $, dates) |
| `app/api/ticker/[symbol]/route.ts` | Server endpoint, maps errors to HTTP status |
| `app/page.tsx`, `components/*.tsx` | The screen |
| `scripts/probe-sources.mjs` | Live check of data sources; saves fixtures |
| `test/*.test.ts`, `test/helpers.ts`, `test/fixtures/*.json` | Tests and saved sample responses |

---

### Task 1: Scaffold the app

**Files:**
- Create: Next.js scaffold (via `create-next-app`), `vitest.config.ts`, `test/smoke.test.ts`, `.env.example`, `README.md`
- Modify: `.gitignore`, `package.json` (scripts)

**Interfaces:**
- Produces: `npm run dev`, `npm test`, `npm run build`, `npm run lint`, `npm run probe` all exist.

- [ ] **Step 1: Scaffold Next.js into the existing folder**

Run (from `C:\Users\issac\Projects\earnings-tracker`):
```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes
```
Expected: dependencies install, `app/page.tsx` exists. If it refuses because the folder isn't empty, run it into `../earnings-tracker-scaffold` instead, copy everything except `.git` into this folder, and delete the scaffold folder.

- [ ] **Step 2: Install Recharts and Vitest**

```bash
npm install recharts
npm install -D vitest
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to `"scripts"` (keep existing ones):
```json
"test": "vitest run",
"probe": "node --env-file=.env.local scripts/probe-sources.mjs"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(fileURLToPath(new URL(".", import.meta.url))) } },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 5: Create `test/smoke.test.ts` and run it**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```
Run: `npm test` — Expected: 1 passed.

- [ ] **Step 6: Env + ignore files**

`.env.example`:
```
ALPHAVANTAGE_API_KEY=
TIINGO_API_KEY=
```
Append to `.gitignore`:
```
# local API response cache
.cache/
!.env.example
```

- [ ] **Step 7: Replace `README.md`**

```markdown
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
```

- [ ] **Step 8: Verify and commit**

Run: `npm run build` — Expected: build succeeds.
```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest"
```

---

### Task 2: Verify data sources with real calls 🛑

**Files:**
- Create: `scripts/probe-sources.mjs`, `test/fixtures/*.json` (generated)

**Interfaces:**
- Produces fixtures used by Tasks 6–7: `test/fixtures/av-earnings-NVDA.json`, `av-income-NVDA.json`, `av-earnings-ZZZZZZ.json`, `tiingo-meta-NVDA.json`, `tiingo-prices-NVDA.json`, `tiingo-prices-SPY.json`, `tiingo-prices-ZZZZZZ.json`.

- [ ] **Step 1: 🛑 Product owner creates `.env.local`**

Walk the product owner through: sign up at alphavantage.co (free key) and tiingo.com (free account → API token), copy `.env.example` to `.env.local`, and paste both keys into it themselves. Do not ask for keys in chat.

- [ ] **Step 2: Create `scripts/probe-sources.mjs`**

```js
import { mkdir, writeFile } from "node:fs/promises";

const AV = process.env.ALPHAVANTAGE_API_KEY;
const TI = process.env.TIINGO_API_KEY;
if (!AV || !TI) {
  console.error("Missing ALPHAVANTAGE_API_KEY or TIINGO_API_KEY in .env.local");
  process.exit(1);
}

const symbol = (process.argv[2] ?? "NVDA").toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = new Date(Date.now() - 4 * 365 * 864e5).toISOString().slice(0, 10);
await mkdir("test/fixtures", { recursive: true });

async function save(name, res) {
  const body = await res.text();
  await writeFile(`test/fixtures/${name}.json`, body);
  let json;
  try { json = JSON.parse(body); } catch { json = body; }
  return { status: res.status, json };
}
const av = (fn, s) => fetch(`https://www.alphavantage.co/query?function=${fn}&symbol=${s}&apikey=${AV}`);
const ti = (path) => fetch(`https://api.tiingo.com/tiingo/daily${path}`, { headers: { Authorization: `Token ${TI}` } });

const earn = await save(`av-earnings-${symbol}`, await av("EARNINGS", symbol));
await sleep(1500);
const inc = await save(`av-income-${symbol}`, await av("INCOME_STATEMENT", symbol));
await sleep(1500);
const bad = await save("av-earnings-ZZZZZZ", await av("EARNINGS", "ZZZZZZ"));
const meta = await save(`tiingo-meta-${symbol}`, await ti(`/${symbol}`));
const px = await save(`tiingo-prices-${symbol}`, await ti(`/${symbol}/prices?startDate=${start}`));
const spy = await save("tiingo-prices-SPY", await ti(`/SPY/prices?startDate=${start}`));
const tiBad = await save("tiingo-prices-ZZZZZZ", await ti(`/ZZZZZZ/prices?startDate=${start}`));

const q = earn.json.quarterlyEarnings ?? [];
const revDates = new Set((inc.json.quarterlyReports ?? []).map((r) => r.fiscalDateEnding));
console.log(JSON.stringify({
  earningsKeys: Object.keys(earn.json),
  quarters: q.length,
  sampleQuarter: q[0],
  reportTimes: [...new Set(q.map((x) => x.reportTime))],
  missingEstimatesInLast12: q.slice(0, 12).filter((x) => x.estimatedEPS === "None").length,
  revenueQuarters: revDates.size,
  revenueMatchedInLast12: q.slice(0, 12).filter((x) => revDates.has(x.fiscalDateEnding)).length,
  badTickerAV: bad.json,
  tiingoName: meta.json?.name,
  priceStatus: px.status,
  priceRows: Array.isArray(px.json) ? px.json.length : px.json,
  firstPrice: Array.isArray(px.json) ? px.json[0] : null,
  lastPriceDate: Array.isArray(px.json) ? px.json.at(-1)?.date : null,
  spyRows: Array.isArray(spy.json) ? spy.json.length : spy.json,
  badTickerTiingo: { status: tiBad.status, body: tiBad.json },
}, null, 2));
```

- [ ] **Step 3: Run the probe**

Run: `npm run probe -- NVDA`

Pass criteria:
- `quarters` ≥ 12 and `sampleQuarter` has `reportedDate`, `reportedEPS`, `estimatedEPS`, `reportTime`
- `reportTimes` contains `"pre-market"` and/or `"post-market"`
- `revenueMatchedInLast12` ≥ 10
- `priceRows` ≥ 900 and `firstPrice` has `date` and `adjClose`
- `spyRows` ≥ 900

- [ ] **Step 4: 🛑 Report to product owner**

Show the pass/fail for each criterion in plain language. If any criterion fails, STOP and present options (e.g. different field, different source) — do not improvise. Also note: exact shape of the bad-ticker responses (used in Tasks 6–7) and the exact wording of anything unexpected. If field names differ from the ones used in Tasks 6–7 (`quarterlyEarnings`, `reportTime` values `pre-market`/`post-market`, `quarterlyReports[].totalRevenue`, `adjClose`), update those tasks' code before executing them.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-sources.mjs test/fixtures
git commit -m "feat: add data-source probe and sample fixtures"
```

---

### Task 3: Types and reaction math

**Files:**
- Create: `lib/types.ts`, `lib/errors.ts`, `lib/reactions.ts`, `test/helpers.ts`, `test/reactions.test.ts`

**Interfaces:**
- Produces (`lib/types.ts`): `ReportTiming`, `EarningsRecord`, `PriceBar`, `Move`, `Outcome`, `Flag`, `QuarterRow`, `Summary`, `TickerReport` (exact definitions below).
- Produces (`lib/errors.ts`): `class DataError extends Error { code: DataErrorCode }`, `type DataErrorCode = "NOT_FOUND" | "RATE_LIMIT" | "MISSING_KEY" | "UPSTREAM"`.
- Produces (`lib/reactions.ts`):
  - `surprisePct(actual: number | null, estimate: number | null): number | null`
  - `outcomeOf(actual: number | null, estimate: number | null): Outcome`
  - `baseIndex(bars: PriceBar[], reportedDate: string, timing: ReportTiming): number | null`
  - `computeMove(stock: PriceBar[], spyByDate: Map<string, number>, reportedDate: string, timing: ReportTiming, n: number): Move | null`
  - `flagOf(outcome: Outcome, d1: Move | null): Flag`
- Produces (`test/helpers.ts`): `bars()`, `STOCK: PriceBar[]`, `SPY_BARS: PriceBar[]`, `spyMap(): Map<string, number>`.

- [ ] **Step 1: Create `lib/types.ts`**

```ts
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
```

- [ ] **Step 2: Create `lib/errors.ts`**

```ts
export type DataErrorCode = "NOT_FOUND" | "RATE_LIMIT" | "MISSING_KEY" | "UPSTREAM";

export class DataError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = "DataError";
    this.code = code;
  }
}
```

- [ ] **Step 3: Create `test/helpers.ts`**

```ts
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
```

- [ ] **Step 4: Write failing tests `test/reactions.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { surprisePct, outcomeOf, baseIndex, computeMove, flagOf } from "@/lib/reactions";
import { STOCK, spyMap } from "./helpers";

describe("surprisePct", () => {
  it("is (actual − estimate) / |estimate| × 100", () => {
    expect(surprisePct(1.05, 1.01)).toBeCloseTo(3.9604, 3);
  });
  it("handles negative estimates", () => {
    expect(surprisePct(-0.1, -0.2)).toBeCloseTo(50, 6);
  });
  it("is null when estimate is 0 or a value is missing", () => {
    expect(surprisePct(1, 0)).toBeNull();
    expect(surprisePct(null, 1)).toBeNull();
    expect(surprisePct(1, null)).toBeNull();
  });
});

describe("outcomeOf", () => {
  it("classifies beat / miss / inline / unknown", () => {
    expect(outcomeOf(1.05, 1.01)).toBe("beat");
    expect(outcomeOf(0.9, 1)).toBe("miss");
    expect(outcomeOf(1, 1)).toBe("inline");
    expect(outcomeOf(1, null)).toBe("unknown");
    expect(outcomeOf(1, 0)).toBe("beat");
  });
});

describe("baseIndex", () => {
  it("AMC: base is the report-date close", () => {
    expect(baseIndex(STOCK, "2025-08-27", "AMC")).toBe(2);
  });
  it("BMO: base is the prior trading day's close", () => {
    expect(baseIndex(STOCK, "2025-08-27", "BMO")).toBe(1);
  });
  it("non-trading report date: base is the last close before it", () => {
    expect(baseIndex(STOCK, "2025-08-30", "AMC")).toBe(4);
    expect(baseIndex(STOCK, "2025-08-30", "BMO")).toBe(4);
  });
  it("null when there is no earlier price", () => {
    expect(baseIndex(STOCK, "2025-08-01", "AMC")).toBeNull();
    expect(baseIndex(STOCK, "2025-08-25", "BMO")).toBeNull();
  });
});

describe("computeMove", () => {
  it("AMC day 1 vs S&P", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 1)!;
    expect(m.stock).toBeCloseTo(5.7692, 3);
    expect(m.spy).toBeCloseTo(1, 6);
    expect(m.excess).toBeCloseTo(4.7692, 3);
  });
  it("BMO day 1 uses the report day as day 1", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "BMO", 1)!;
    expect(m.stock).toBeCloseTo(1.9608, 3);
    expect(m.spy).toBeCloseTo(0, 6);
  });
  it("counts trading days, skipping the holiday", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 3)!;
    expect(m.stock).toBeCloseTo(0.9615, 3); // Aug 27 → Sep 2
  });
  it("weekend report: day 1 is the next trading day", () => {
    expect(computeMove(STOCK, spyMap(), "2025-08-30", "AMC", 1)!.stock).toBeCloseTo(6.0606, 3);
  });
  it("null when not enough trading days have passed", () => {
    expect(computeMove(STOCK, spyMap(), "2025-09-03", "AMC", 1)!.stock).toBeCloseTo(1.8868, 3);
    expect(computeMove(STOCK, spyMap(), "2025-09-03", "AMC", 3)).toBeNull();
  });
  it("unknown timing behaves like AMC", () => {
    expect(computeMove(STOCK, spyMap(), "2025-08-27", "unknown", 1)).toEqual(
      computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 1),
    );
  });
  it("null when SPY is missing a needed date", () => {
    const spy = spyMap();
    spy.delete("2025-08-28");
    expect(computeMove(STOCK, spy, "2025-08-27", "AMC", 1)).toBeNull();
  });
});

describe("flagOf", () => {
  const up = { stock: 2, spy: 1, excess: 1 };
  const down = { stock: -2, spy: 1, excess: -3 };
  it("flags disagreements between result and reaction", () => {
    expect(flagOf("beat", down)).toBe("beat-but-fell");
    expect(flagOf("miss", up)).toBe("missed-but-rose");
  });
  it("no flag when they agree, are inline, or move is missing", () => {
    expect(flagOf("beat", up)).toBeNull();
    expect(flagOf("inline", down)).toBeNull();
    expect(flagOf("beat", null)).toBeNull();
  });
});
```

- [ ] **Step 5: Run to confirm failure**

Run: `npm test -- reactions` — Expected: FAIL (cannot find `@/lib/reactions`).

- [ ] **Step 6: Implement `lib/reactions.ts`**

```ts
import type { Flag, Move, Outcome, PriceBar, ReportTiming } from "./types";

export function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

export function outcomeOf(actual: number | null, estimate: number | null): Outcome {
  if (actual === null || estimate === null) return "unknown";
  if (actual > estimate) return "beat";
  if (actual < estimate) return "miss";
  return "inline";
}

/**
 * Index of the "base" close the reaction is measured from.
 * BMO: last close strictly before the report date.
 * AMC / unknown: close on the report date, or the last close before it if it wasn't a trading day.
 */
export function baseIndex(bars: PriceBar[], reportedDate: string, timing: ReportTiming): number | null {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    const d = bars[i].date;
    const before = timing === "BMO" ? d < reportedDate : d <= reportedDate;
    if (!before) break;
    idx = i;
  }
  return idx >= 0 ? idx : null;
}

export function computeMove(
  stock: PriceBar[],
  spyByDate: Map<string, number>,
  reportedDate: string,
  timing: ReportTiming,
  n: number,
): Move | null {
  const b = baseIndex(stock, reportedDate, timing);
  if (b === null || b + n >= stock.length) return null;
  const base = stock[b];
  const end = stock[b + n];
  const spyBase = spyByDate.get(base.date);
  const spyEnd = spyByDate.get(end.date);
  if (spyBase === undefined || spyEnd === undefined) return null;
  const stockPct = (end.close / base.close - 1) * 100;
  const spyPct = (spyEnd / spyBase - 1) * 100;
  return { stock: stockPct, spy: spyPct, excess: stockPct - spyPct };
}

export function flagOf(outcome: Outcome, d1: Move | null): Flag {
  if (!d1) return null;
  if (outcome === "beat" && d1.excess < 0) return "beat-but-fell";
  if (outcome === "miss" && d1.excess > 0) return "missed-but-rose";
  return null;
}
```

- [ ] **Step 7: Run tests**

Run: `npm test -- reactions` — Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/errors.ts lib/reactions.ts test/helpers.ts test/reactions.test.ts
git commit -m "feat: add reaction math (surprise, day-1 alignment, moves vs S&P)"
```

---

### Task 4: Quarter rows and summary numbers

**Files:**
- Create: `lib/quarters.ts`, `lib/summary.ts`, `test/quarters.test.ts`

**Interfaces:**
- Consumes: `surprisePct`, `outcomeOf`, `computeMove`, `flagOf` (Task 3); types from `lib/types.ts`.
- Produces:
  - `buildQuarterRows(input: { earnings: EarningsRecord[]; revenue: Record<string, number>; stock: PriceBar[]; spy: PriceBar[]; limit?: number }): QuarterRow[]` — newest first, skips quarters with no reported EPS, default limit 12.
  - `summarize(rows: QuarterRow[]): Summary`

- [ ] **Step 1: Write failing tests `test/quarters.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildQuarterRows } from "@/lib/quarters";
import { summarize } from "@/lib/summary";
import type { EarningsRecord } from "@/lib/types";
import { STOCK, SPY_BARS } from "./helpers";

// Report dates are contrived to land inside the helper price window.
const EARNINGS: EarningsRecord[] = [
  { fiscalDateEnding: "2024-12-31", reportedDate: "2025-08-25", timing: "AMC", reportedEPS: 1.0, estimatedEPS: null },
  { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", timing: "AMC", reportedEPS: 1.05, estimatedEPS: 1.01 },
  { fiscalDateEnding: "2025-03-31", reportedDate: "2025-08-26", timing: "BMO", reportedEPS: 0.9, estimatedEPS: 1.0 },
  { fiscalDateEnding: "2025-09-30", reportedDate: "2025-11-19", timing: "AMC", reportedEPS: null, estimatedEPS: 1.2 },
];
const REVENUE = { "2025-06-30": 46.7e9 };
const rows = () => buildQuarterRows({ earnings: EARNINGS, revenue: REVENUE, stock: STOCK, spy: SPY_BARS });

describe("buildQuarterRows", () => {
  it("sorts newest first and skips unreported quarters", () => {
    expect(rows().map((r) => r.fiscalDateEnding)).toEqual(["2025-06-30", "2025-03-31", "2024-12-31"]);
  });

  it("beat but fell", () => {
    const r = rows()[0];
    expect(r.outcome).toBe("beat");
    expect(r.surprisePct).toBeCloseTo(3.9604, 3);
    expect(r.revenue).toBe(46.7e9);
    expect(r.moves.d1!.stock).toBeCloseTo(-10, 6);
    expect(r.moves.d1!.spy).toBeCloseTo(-0.9901, 3);
    expect(r.moves.d1!.excess).toBeCloseTo(-9.0099, 3);
    expect(r.moves.d3!.stock).toBeCloseTo(-3.6364, 3);
    expect(r.moves.d5).toBeNull();
    expect(r.flag).toBe("beat-but-fell");
  });

  it("missed but rose (BMO)", () => {
    const r = rows()[1];
    expect(r.outcome).toBe("miss");
    expect(r.moves.d1!.excess).toBeCloseTo(2, 6);
    expect(r.flag).toBe("missed-but-rose");
    expect(r.revenue).toBeNull();
  });

  it("missing estimate → unknown, no surprise, no flag", () => {
    const r = rows()[2];
    expect(r.outcome).toBe("unknown");
    expect(r.surprisePct).toBeNull();
    expect(r.flag).toBeNull();
  });

  it("respects limit", () => {
    expect(buildQuarterRows({ earnings: EARNINGS, revenue: {}, stock: STOCK, spy: SPY_BARS, limit: 2 })).toHaveLength(2);
  });
});

describe("summarize", () => {
  it("computes the four headline numbers", () => {
    const s = summarize(rows());
    expect(s.quartersWithEstimate).toBe(2);
    expect(s.beats).toBe(1);
    expect(s.avgSurprisePct).toBeCloseTo(-3.0198, 3);
    expect(s.avgD1Excess).toBeCloseTo(-1.67, 2);
    expect(s.beatButFell).toBe(1);
  });

  it("handles no rows", () => {
    expect(summarize([])).toEqual({
      quartersWithEstimate: 0, beats: 0, avgSurprisePct: null, avgD1Excess: null, beatButFell: 0,
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- quarters` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `lib/quarters.ts`**

```ts
import { computeMove, flagOf, outcomeOf, surprisePct } from "./reactions";
import type { EarningsRecord, PriceBar, QuarterRow } from "./types";

export function buildQuarterRows(input: {
  earnings: EarningsRecord[];
  revenue: Record<string, number>;
  stock: PriceBar[];
  spy: PriceBar[];
  limit?: number;
}): QuarterRow[] {
  const spyByDate = new Map(input.spy.map((b) => [b.date, b.close]));
  return input.earnings
    .filter((e) => e.reportedEPS !== null)
    .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate))
    .slice(0, input.limit ?? 12)
    .map((e) => {
      const outcome = outcomeOf(e.reportedEPS, e.estimatedEPS);
      const move = (n: number) => computeMove(input.stock, spyByDate, e.reportedDate, e.timing, n);
      const d1 = move(1);
      return {
        fiscalDateEnding: e.fiscalDateEnding,
        reportedDate: e.reportedDate,
        timing: e.timing,
        estimatedEPS: e.estimatedEPS,
        reportedEPS: e.reportedEPS,
        surprisePct: surprisePct(e.reportedEPS, e.estimatedEPS),
        outcome,
        revenue: input.revenue[e.fiscalDateEnding] ?? null,
        moves: { d1, d3: move(3), d5: move(5) },
        flag: flagOf(outcome, d1),
      };
    });
}
```

- [ ] **Step 4: Implement `lib/summary.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/quarters.ts lib/summary.ts test/quarters.test.ts
git commit -m "feat: build quarter rows and summary numbers"
```

---

### Task 5: File cache

**Files:**
- Create: `lib/cache.ts`, `test/cache.test.ts`

**Interfaces:**
- Produces:
  - `interface CacheEntry<T> { savedAt: number; data: T }`
  - `interface Cache { get<T>(key: string): Promise<CacheEntry<T> | null>; set<T>(key: string, data: T): Promise<void> }`
  - `createFileCache(dir: string, now?: () => number): Cache`
  - `cachedFetch<T>(cache: Cache, key: string, maxAgeMs: number, fetcher: () => Promise<T>, now?: () => number): Promise<{ data: T; stale: boolean }>`

- [ ] **Step 1: Write failing tests `test/cache.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cachedFetch, createFileCache } from "@/lib/cache";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "et-cache-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("createFileCache", () => {
  it("returns null for a missing key", async () => {
    expect(await createFileCache(dir).get("nope")).toBeNull();
  });

  it("round-trips data with savedAt", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ savedAt: 1000, data: { a: 1 } });
  });

  it("turns keys into safe filenames", async () => {
    await createFileCache(dir).set("a/b:c", 1);
    expect(await readdir(dir)).toEqual(["a_b_c.json"]);
  });
});

describe("cachedFetch", () => {
  it("uses a fresh cache hit without fetching", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    const fetcher = vi.fn(async () => "new");
    expect(await cachedFetch(cache, "k", 500, fetcher, () => 1200)).toEqual({ data: "old", stale: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refetches and stores when expired", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    expect(await cachedFetch(cache, "k", 500, async () => "new", () => 2000)).toEqual({ data: "new", stale: false });
    expect((await cache.get("k"))!.data).toBe("new");
  });

  it("serves stale data when refetch fails", async () => {
    const cache = createFileCache(dir, () => 1000);
    await cache.set("k", "old");
    const failing = async (): Promise<string> => { throw new Error("down"); };
    expect(await cachedFetch(cache, "k", 500, failing, () => 2000)).toEqual({ data: "old", stale: true });
  });

  it("rethrows when there is nothing cached", async () => {
    const failing = async (): Promise<string> => { throw new Error("down"); };
    await expect(cachedFetch(createFileCache(dir), "k", 500, failing)).rejects.toThrow("down");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- cache` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/cache.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

export interface Cache {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, data: T): Promise<void>;
}

export function createFileCache(dir: string, now: () => number = Date.now): Cache {
  const file = (key: string) => path.join(dir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  return {
    async get<T>(key: string): Promise<CacheEntry<T> | null> {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8")) as CacheEntry<T>;
      } catch {
        return null;
      }
    },
    async set<T>(key: string, data: T): Promise<void> {
      await fs.mkdir(dir, { recursive: true });
      const entry: CacheEntry<T> = { savedAt: now(), data };
      await fs.writeFile(file(key), JSON.stringify(entry));
    },
  };
}

/** Return cached data if younger than maxAgeMs; otherwise fetch. If fetching fails, fall back to old cached data. */
export async function cachedFetch<T>(
  cache: Cache,
  key: string,
  maxAgeMs: number,
  fetcher: () => Promise<T>,
  now: () => number = Date.now,
): Promise<{ data: T; stale: boolean }> {
  const hit = await cache.get<T>(key);
  if (hit && now() - hit.savedAt < maxAgeMs) return { data: hit.data, stale: false };
  try {
    const data = await fetcher();
    await cache.set(key, data);
    return { data, stale: false };
  } catch (err) {
    if (hit) return { data: hit.data, stale: true };
    throw err;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/cache.ts test/cache.test.ts
git commit -m "feat: add file cache with stale fallback"
```

---

### Task 6: Alpha Vantage source

**Files:**
- Create: `lib/sources/alphaVantage.ts`, `test/alphaVantage.test.ts`

**Interfaces:**
- Consumes: `DataError` (Task 3), `EarningsRecord`, `ReportTiming`; fixtures from Task 2.
- Produces:
  - `parseEarnings(json: unknown, symbol: string): EarningsRecord[]`
  - `parseIncomeStatement(json: unknown): Record<string, number>` (fiscalDateEnding → total revenue)
  - `fetchEarnings(symbol: string, apiKey: string, fetchFn?: typeof fetch): Promise<EarningsRecord[]>`
  - `fetchRevenue(symbol: string, apiKey: string, fetchFn?: typeof fetch): Promise<Record<string, number>>`

- [ ] **Step 1: Write failing tests `test/alphaVantage.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchEarnings, parseEarnings, parseIncomeStatement } from "@/lib/sources/alphaVantage";
import type { DataError } from "@/lib/errors";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (e) { return (e as DataError).code; }
  return undefined;
}

const EARNINGS_JSON = {
  symbol: "TEST",
  quarterlyEarnings: [
    { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-27", reportedEPS: "1.05", estimatedEPS: "1.01", surprise: "0.04", surprisePercentage: "3.96", reportTime: "post-market" },
    { fiscalDateEnding: "2025-03-31", reportedDate: "2025-05-28", reportedEPS: "0.96", estimatedEPS: "None", surprise: "0", surprisePercentage: "None", reportTime: "pre-market" },
    { fiscalDateEnding: "2024-12-31", reportedDate: "2025-02-26", reportedEPS: "0.89", estimatedEPS: "0.85", surprise: "0.04", surprisePercentage: "4.7", reportTime: "" },
  ],
};

describe("parseEarnings", () => {
  it("parses numbers, None, and report timing", () => {
    expect(parseEarnings(EARNINGS_JSON, "TEST")).toEqual([
      { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-27", timing: "AMC", reportedEPS: 1.05, estimatedEPS: 1.01 },
      { fiscalDateEnding: "2025-03-31", reportedDate: "2025-05-28", timing: "BMO", reportedEPS: 0.96, estimatedEPS: null },
      { fiscalDateEnding: "2024-12-31", reportedDate: "2025-02-26", timing: "unknown", reportedEPS: 0.89, estimatedEPS: 0.85 },
    ]);
  });

  it("maps provider messages to error codes", () => {
    expect(codeOf(() => parseEarnings({ Information: "Our standard API rate limit is 25 requests per day." }, "T"))).toBe("RATE_LIMIT");
    expect(codeOf(() => parseEarnings({ Note: "Thank you for using Alpha Vantage! Please consider premium." }, "T"))).toBe("RATE_LIMIT");
    expect(codeOf(() => parseEarnings({ Information: "the parameter apikey is invalid or missing." }, "T"))).toBe("MISSING_KEY");
    expect(codeOf(() => parseEarnings({ "Error Message": "Invalid API call." }, "T"))).toBe("NOT_FOUND");
    expect(codeOf(() => parseEarnings({}, "T"))).toBe("NOT_FOUND");
  });

  it("uses the spec's not-found wording", () => {
    expect(() => parseEarnings({}, "XYZ")).toThrow("No earnings history found for XYZ.");
  });

  it("parses the real NVDA fixture", () => {
    const rows = parseEarnings(fixture("av-earnings-NVDA"), "NVDA");
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(r.reportedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["BMO", "AMC", "unknown"]).toContain(r.timing);
    }
    expect(rows.filter((r) => r.estimatedEPS !== null).length).toBeGreaterThanOrEqual(12);
  });

  it("treats the real bad-ticker fixture as not found", () => {
    expect(codeOf(() => parseEarnings(fixture("av-earnings-ZZZZZZ"), "ZZZZZZ"))).toBe("NOT_FOUND");
  });
});

describe("parseIncomeStatement", () => {
  it("maps fiscalDateEnding → totalRevenue, skipping None", () => {
    expect(parseIncomeStatement({
      quarterlyReports: [
        { fiscalDateEnding: "2025-06-30", totalRevenue: "46743000000" },
        { fiscalDateEnding: "2025-03-31", totalRevenue: "None" },
      ],
    })).toEqual({ "2025-06-30": 46743000000 });
  });

  it("returns {} when there are no reports or the symbol is unknown", () => {
    expect(parseIncomeStatement({})).toEqual({});
    expect(parseIncomeStatement({ "Error Message": "Invalid API call." })).toEqual({});
  });

  it("parses the real NVDA fixture", () => {
    expect(Object.keys(parseIncomeStatement(fixture("av-income-NVDA"))).length).toBeGreaterThanOrEqual(10);
  });
});

describe("fetchEarnings", () => {
  it("calls the EARNINGS endpoint and parses the result", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(EARNINGS_JSON)));
    const rows = await fetchEarnings("TEST", "KEY", f as unknown as typeof fetch);
    expect(rows).toHaveLength(3);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("function=EARNINGS&symbol=TEST&apikey=KEY");
  });

  it("network failure → UPSTREAM", async () => {
    const f = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(fetchEarnings("TEST", "KEY", f)).rejects.toMatchObject({ code: "UPSTREAM", message: "Couldn't reach the data provider." });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- alphaVantage` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/sources/alphaVantage.ts`**

```ts
import { DataError } from "../errors";
import type { EarningsRecord, ReportTiming } from "../types";

const BASE = "https://www.alphavantage.co/query";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "" || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timingOf(v: unknown): ReportTiming {
  if (v === "pre-market") return "BMO";
  if (v === "post-market") return "AMC";
  return "unknown";
}

const notFound = (symbol: string) => new DataError("NOT_FOUND", `No earnings history found for ${symbol}.`);

const isErrorMessage = (json: unknown) =>
  !!json && typeof json === "object" && typeof (json as Record<string, unknown>)["Error Message"] === "string";

/** Throws for rate-limit / bad-key / malformed responses. Callers handle "Error Message" (unknown symbol) first. */
function assertAvOk(json: unknown): asserts json is Record<string, unknown> {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new DataError("UPSTREAM", "Unexpected response from Alpha Vantage.");
  }
  const o = json as Record<string, unknown>;
  const info = [o.Information, o.Note].find((v): v is string => typeof v === "string");
  if (info) {
    if (/apikey is invalid|apikey.*missing/i.test(info)) {
      throw new DataError("MISSING_KEY", "Alpha Vantage API key is invalid. Check ALPHAVANTAGE_API_KEY in .env.local.");
    }
    throw new DataError("RATE_LIMIT", "Daily data limit reached — try again tomorrow or use a ticker you've looked up before.");
  }
}

export function parseEarnings(json: unknown, symbol: string): EarningsRecord[] {
  if (isErrorMessage(json)) throw notFound(symbol);
  assertAvOk(json);
  const list: Record<string, unknown>[] = Array.isArray(json.quarterlyEarnings) ? json.quarterlyEarnings : [];
  const rows = list
    .map((q) => ({
      fiscalDateEnding: String(q.fiscalDateEnding ?? ""),
      reportedDate: String(q.reportedDate ?? ""),
      timing: timingOf(q.reportTime),
      reportedEPS: num(q.reportedEPS),
      estimatedEPS: num(q.estimatedEPS),
    }))
    .filter((r) => DATE.test(r.reportedDate) && DATE.test(r.fiscalDateEnding));
  if (rows.length === 0) throw notFound(symbol);
  return rows;
}

export function parseIncomeStatement(json: unknown): Record<string, number> {
  if (isErrorMessage(json)) return {};
  assertAvOk(json);
  const list: Record<string, unknown>[] = Array.isArray(json.quarterlyReports) ? json.quarterlyReports : [];
  const out: Record<string, number> = {};
  for (const r of list) {
    const v = num(r.totalRevenue);
    if (typeof r.fiscalDateEnding === "string" && v !== null) out[r.fiscalDateEnding] = v;
  }
  return out;
}

async function avGet(fn: string, symbol: string, apiKey: string, fetchFn: typeof fetch): Promise<unknown> {
  const url = `${BASE}?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetchFn(url, { cache: "no-store" });
  } catch {
    throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  }
  if (!res.ok) throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  return res.json();
}

export async function fetchEarnings(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<EarningsRecord[]> {
  return parseEarnings(await avGet("EARNINGS", symbol, apiKey, fetchFn), symbol);
}

export async function fetchRevenue(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Record<string, number>> {
  return parseIncomeStatement(await avGet("INCOME_STATEMENT", symbol, apiKey, fetchFn));
}
```

Note: if Task 2 showed different field names or bad-ticker shapes, adjust `parseEarnings`/`parseIncomeStatement` and the matching tests before this step.

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/sources/alphaVantage.ts test/alphaVantage.test.ts
git commit -m "feat: add Alpha Vantage earnings and revenue source"
```

---

### Task 7: Tiingo source

**Files:**
- Create: `lib/sources/tiingo.ts`, `test/tiingo.test.ts`

**Interfaces:**
- Consumes: `DataError`, `PriceBar`; fixtures from Task 2.
- Produces:
  - `parsePrices(json: unknown): PriceBar[]` (sorted oldest → newest, uses `adjClose`)
  - `fetchPrices(symbol: string, startDate: string, apiKey: string, fetchFn?: typeof fetch): Promise<PriceBar[]>`
  - `fetchName(symbol: string, apiKey: string, fetchFn?: typeof fetch): Promise<string | null>`

- [ ] **Step 1: Write failing tests `test/tiingo.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchName, fetchPrices, parsePrices } from "@/lib/sources/tiingo";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("parsePrices", () => {
  it("sorts, trims dates, prefers adjClose, drops bad rows", () => {
    expect(parsePrices([
      { date: "2025-08-27T00:00:00.000Z", close: 200, adjClose: 100 },
      { date: "2025-08-26T00:00:00.000Z", close: 198, adjClose: 99 },
      { date: "garbage", close: 1, adjClose: 1 },
      { date: "2025-08-28T00:00:00.000Z", close: null, adjClose: null },
    ])).toEqual([
      { date: "2025-08-26", close: 99 },
      { date: "2025-08-27", close: 100 },
    ]);
  });

  it("non-array → UPSTREAM", () => {
    let code: string | undefined;
    try { parsePrices({ detail: "x" }); } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("UPSTREAM");
  });

  it("parses the real NVDA fixture", () => {
    const rows = parsePrices(fixture("tiingo-prices-NVDA"));
    expect(rows.length).toBeGreaterThanOrEqual(900);
    expect(rows[0].date < rows.at(-1)!.date).toBe(true);
  });
});

describe("fetchPrices", () => {
  it("sends the token header and the start date", async () => {
    const f = respond(200, [{ date: "2025-08-26T00:00:00.000Z", close: 1, adjClose: 1 }]);
    await fetchPrices("NVDA", "2022-01-01", "KEY", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tiingo.com/tiingo/daily/NVDA/prices?startDate=2022-01-01");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token KEY");
  });

  it("maps HTTP errors to codes", async () => {
    for (const [status, code] of [[404, "NOT_FOUND"], [401, "MISSING_KEY"], [429, "RATE_LIMIT"], [500, "UPSTREAM"]] as const) {
      await expect(fetchPrices("X", "2022-01-01", "KEY", respond(status, {}) as unknown as typeof fetch))
        .rejects.toMatchObject({ code });
    }
  });
});

describe("fetchName", () => {
  it("returns the company name or null", async () => {
    expect(await fetchName("NVDA", "KEY", respond(200, { name: "NVIDIA Corp" }) as unknown as typeof fetch)).toBe("NVIDIA Corp");
    expect(await fetchName("NVDA", "KEY", respond(200, {}) as unknown as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- tiingo` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/sources/tiingo.ts`**

```ts
import { DataError } from "../errors";
import type { PriceBar } from "../types";

const BASE = "https://api.tiingo.com/tiingo/daily";

export function parsePrices(json: unknown): PriceBar[] {
  if (!Array.isArray(json)) throw new DataError("UPSTREAM", "Unexpected price data from Tiingo.");
  return (json as Record<string, unknown>[])
    .map((r) => ({ date: String(r.date ?? "").slice(0, 10), close: Number(r.adjClose ?? r.close) }))
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function tiingoGet(path: string, symbol: string, apiKey: string, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}${path}`, {
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  }
  if (res.status === 404) throw new DataError("NOT_FOUND", `No price history found for ${symbol}.`);
  if (res.status === 401 || res.status === 403) {
    throw new DataError("MISSING_KEY", "Tiingo API key is invalid. Check TIINGO_API_KEY in .env.local.");
  }
  if (res.status === 429) throw new DataError("RATE_LIMIT", "Price-data limit reached — wait an hour and try again.");
  if (!res.ok) throw new DataError("UPSTREAM", "Couldn't reach the data provider.");
  return res.json();
}

export async function fetchPrices(symbol: string, startDate: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<PriceBar[]> {
  return parsePrices(await tiingoGet(`/${encodeURIComponent(symbol)}/prices?startDate=${startDate}`, symbol, apiKey, fetchFn));
}

export async function fetchName(symbol: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const json = (await tiingoGet(`/${encodeURIComponent(symbol)}`, symbol, apiKey, fetchFn)) as { name?: unknown } | null;
  return typeof json?.name === "string" && json.name.trim() ? json.name.trim() : null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/sources/tiingo.ts test/tiingo.test.ts
git commit -m "feat: add Tiingo price and name source"
```

---

### Task 8: Assemble the report + server endpoint 🛑

**Files:**
- Create: `lib/report.ts`, `app/api/ticker/[symbol]/route.ts`, `test/report.test.ts`

**Interfaces:**
- Consumes: `cachedFetch`, `Cache`, `createFileCache` (Task 5); `fetchEarnings`, `fetchRevenue` (Task 6); `fetchPrices`, `fetchName` (Task 7); `buildQuarterRows`, `summarize` (Task 4); `DataError`.
- Produces:
  - `normalizeSymbol(raw: string): string | null`
  - `interface ReportDeps { cache: Cache; avKey?: string; tiingoKey?: string; fetchFn?: typeof fetch; now?: () => number }`
  - `buildTickerReport(raw: string, deps: ReportDeps): Promise<TickerReport>`
  - `GET /api/ticker/:symbol` → `200 TickerReport` or `{ error: { code, message } }` with status 404 / 429 / 500 / 502.

- [ ] **Step 1: Write failing tests `test/report.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileCache } from "@/lib/cache";
import { buildTickerReport, normalizeSymbol, type ReportDeps } from "@/lib/report";
import { STOCK, SPY_BARS } from "./helpers";

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const tiingoRows = (bars: { date: string; close: number }[]) =>
  bars.map((b) => ({ date: `${b.date}T00:00:00.000Z`, close: b.close, adjClose: b.close }));

const EARNINGS = {
  symbol: "TEST",
  quarterlyEarnings: [
    { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", reportedEPS: "1.05", estimatedEPS: "1.01", reportTime: "post-market" },
  ],
};

function makeRoutes(): Record<string, () => Response> {
  // Order matters: first substring match wins, so prices come before meta.
  return {
    "function=EARNINGS": json(EARNINGS),
    "function=INCOME_STATEMENT": json({ quarterlyReports: [{ fiscalDateEnding: "2025-06-30", totalRevenue: "46700000000" }] }),
    "/daily/SPY/prices": json(tiingoRows(SPY_BARS)),
    "/daily/TEST/prices": json(tiingoRows(STOCK)),
    "/daily/TEST": json({ name: "Test Corp" }),
  };
}

let dir: string;
let routes: Record<string, () => Response>;
let calls: string[];
let clock: number;
let deps: ReportDeps;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "et-report-"));
  routes = makeRoutes();
  calls = [];
  clock = Date.parse("2025-09-10T00:00:00Z");
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unrouted ${url}`);
    return hit[1]();
  }) as typeof fetch;
  deps = { cache: createFileCache(dir, () => clock), avKey: "AV", tiingoKey: "TI", fetchFn, now: () => clock };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("normalizeSymbol", () => {
  it("uppercases and trims valid symbols, rejects junk", () => {
    expect(normalizeSymbol(" nvda ")).toBe("NVDA");
    expect(normalizeSymbol("BRK.B")).toBe("BRK.B");
    expect(normalizeSymbol("!!")).toBeNull();
    expect(normalizeSymbol("")).toBeNull();
  });
});

describe("buildTickerReport", () => {
  it("assembles a full report", async () => {
    const r = await buildTickerReport(" test ", deps);
    expect(r.symbol).toBe("TEST");
    expect(r.name).toBe("Test Corp");
    expect(r.quarters).toHaveLength(1);
    expect(r.quarters[0].flag).toBe("beat-but-fell");
    expect(r.quarters[0].revenue).toBe(46.7e9);
    expect(r.summary.beats).toBe(1);
    expect(r.stale).toBe(false);
    expect(r.fetchedAt).toBe("2025-09-10T00:00:00.000Z");
  });

  it("second lookup is served from cache", async () => {
    await buildTickerReport("TEST", deps);
    const before = calls.length;
    await buildTickerReport("TEST", deps);
    expect(calls.length).toBe(before);
  });

  it("revenue failure degrades to empty revenue", async () => {
    routes["function=INCOME_STATEMENT"] = json({}, 500);
    const r = await buildTickerReport("TEST", deps);
    expect(r.quarters[0].revenue).toBeNull();
  });

  it("rejects bad symbols and missing keys", async () => {
    await expect(buildTickerReport("!!", deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildTickerReport("TEST", { ...deps, avKey: "" })).rejects.toMatchObject({ code: "MISSING_KEY" });
    await expect(buildTickerReport("TEST", { ...deps, tiingoKey: undefined })).rejects.toMatchObject({ code: "MISSING_KEY" });
  });

  it("rate limit with no cache → RATE_LIMIT", async () => {
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    await expect(buildTickerReport("TEST", deps)).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("rate limit with old cache → stale report", async () => {
    await buildTickerReport("TEST", deps);
    clock += 2 * 24 * 60 * 60 * 1000;
    routes["function=EARNINGS"] = json({ Information: "standard API rate limit is 25 requests per day" });
    const r = await buildTickerReport("TEST", deps);
    expect(r.stale).toBe(true);
    expect(r.quarters).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- report` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/report.ts`**

```ts
import { cachedFetch, type Cache } from "./cache";
import { DataError } from "./errors";
import { buildQuarterRows } from "./quarters";
import { fetchEarnings, fetchRevenue } from "./sources/alphaVantage";
import { fetchName, fetchPrices } from "./sources/tiingo";
import { summarize } from "./summary";
import type { TickerReport } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export interface ReportDeps {
  cache: Cache;
  avKey?: string;
  tiingoKey?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(s) ? s : null;
}

export async function buildTickerReport(raw: string, deps: ReportDeps): Promise<TickerReport> {
  const symbol = normalizeSymbol(raw);
  if (!symbol) throw new DataError("NOT_FOUND", `"${raw.trim()}" doesn't look like a ticker symbol.`);
  const { cache, avKey, tiingoKey } = deps;
  if (!avKey) throw new DataError("MISSING_KEY", "Missing ALPHAVANTAGE_API_KEY in .env.local.");
  if (!tiingoKey) throw new DataError("MISSING_KEY", "Missing TIINGO_API_KEY in .env.local.");
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const start = new Date(now() - 4 * 365 * DAY).toISOString().slice(0, 10);
  const get = <T,>(key: string, maxAge: number, fn: () => Promise<T>) => cachedFetch(cache, key, maxAge, fn, now);

  // Earnings first: if this fails there is nothing to show, and it avoids spending other calls.
  const earnings = await get(`av-earnings-${symbol}`, DAY, () => fetchEarnings(symbol, avKey, fetchFn));
  const [revenue, name, stock, spy] = await Promise.all([
    get(`av-income-${symbol}`, DAY, () => fetchRevenue(symbol, avKey, fetchFn))
      .catch(() => ({ data: {} as Record<string, number>, stale: false })),
    get(`tiingo-meta-${symbol}`, 7 * DAY, () => fetchName(symbol, tiingoKey, fetchFn))
      .catch(() => ({ data: null as string | null, stale: false })),
    get(`tiingo-prices-${symbol}`, DAY, () => fetchPrices(symbol, start, tiingoKey, fetchFn)),
    get("tiingo-prices-SPY", DAY, () => fetchPrices("SPY", start, tiingoKey, fetchFn)),
  ]);

  const quarters = buildQuarterRows({ earnings: earnings.data, revenue: revenue.data, stock: stock.data, spy: spy.data });
  return {
    symbol,
    name: name.data,
    quarters,
    summary: summarize(quarters),
    fetchedAt: new Date(now()).toISOString(),
    stale: [earnings, stock, spy].some((r) => r.stale),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Implement `app/api/ticker/[symbol]/route.ts`**

```ts
import path from "node:path";
import { createFileCache } from "@/lib/cache";
import { DataError, type DataErrorCode } from "@/lib/errors";
import { buildTickerReport } from "@/lib/report";

export const dynamic = "force-dynamic";

const STATUS: Record<DataErrorCode, number> = { NOT_FOUND: 404, RATE_LIMIT: 429, MISSING_KEY: 500, UPSTREAM: 502 };
const cache = createFileCache(path.join(process.cwd(), ".cache"));

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const report = await buildTickerReport(decodeURIComponent(symbol), {
      cache,
      avKey: process.env.ALPHAVANTAGE_API_KEY,
      tiingoKey: process.env.TIINGO_API_KEY,
    });
    return Response.json(report);
  } catch (err) {
    if (err instanceof DataError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code] });
    }
    console.error(err);
    return Response.json({ error: { code: "UPSTREAM", message: "Something went wrong." } }, { status: 500 });
  }
}
```

- [ ] **Step 6: Try it live**

Run `npm run dev`, then in another terminal:
```bash
curl -s http://localhost:3000/api/ticker/NVDA
curl -s -i http://localhost:3000/api/ticker/ZZZZZZ
```
Expected: NVDA returns JSON with ~12 `quarters` and a `summary`; ZZZZZZ returns 404 with `No earnings history found for ZZZZZZ.`

- [ ] **Step 7: 🛑 Product owner checkpoint**

Show the product owner NVDA's summary numbers and one quarter in plain language (e.g. "Aug 2025: beat by 4%, stock lagged the S&P by 0.8% next day"). Spot-check that quarter's EPS and estimate against a public source (company press release or Nasdaq/Zacks earnings page) and report whether they match.

- [ ] **Step 8: Commit**

```bash
git add lib/report.ts app/api/ticker test/report.test.ts
git commit -m "feat: add ticker report builder and API endpoint"
```

---

### Task 9: The screen — search, summary, table 🛑

**Files:**
- Create: `lib/format.ts`, `test/format.test.ts`, `components/Tracker.tsx`, `components/SearchBox.tsx`, `components/SummaryStrip.tsx`, `components/QuarterTable.tsx`
- Modify: `app/page.tsx` (replace), `app/layout.tsx` (metadata only)

**Interfaces:**
- Consumes: `TickerReport`, `Summary`, `QuarterRow`, `Move` types; `GET /api/ticker/:symbol` (Task 8).
- Produces (`lib/format.ts`): `DASH`, `formatPct(n: number | null, digits?: number): string`, `formatEps(n: number | null): string`, `formatRevenue(n: number | null): string`, `formatMonthYear(iso: string): string`, `formatDate(iso: string): string`.
- Produces: `components/Tracker.tsx` renders `<SummaryStrip>` then `<QuarterTable>` inside `Report`; Task 10 inserts `<QuarterChart>` between them.

- [ ] **Step 1: Write failing tests `test/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatDate, formatEps, formatMonthYear, formatPct, formatRevenue } from "@/lib/format";

describe("format", () => {
  it("formatPct", () => {
    expect(formatPct(3.9604)).toBe("+4.0%");
    expect(formatPct(-10)).toBe("-10.0%");
    expect(formatPct(0.04)).toBe("0.0%");
    expect(formatPct(-0.04)).toBe("0.0%");
    expect(formatPct(1.234, 2)).toBe("+1.23%");
    expect(formatPct(null)).toBe("—");
  });
  it("formatEps", () => {
    expect(formatEps(1.05)).toBe("$1.05");
    expect(formatEps(-0.1)).toBe("-$0.10");
    expect(formatEps(null)).toBe("—");
  });
  it("formatRevenue", () => {
    expect(formatRevenue(46_743_000_000)).toBe("$46.7B");
    expect(formatRevenue(812_300_000)).toBe("$812.3M");
    expect(formatRevenue(12_345)).toBe("$12,345");
    expect(formatRevenue(null)).toBe("—");
  });
  it("dates", () => {
    expect(formatMonthYear("2025-07-27")).toBe("Jul 2025");
    expect(formatDate("2025-08-27")).toBe("Aug 27, 2025");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- format` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/format.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all pass.

- [ ] **Step 5: Create `components/SearchBox.tsx`**

```tsx
"use client";

import { useState } from "react";

export function SearchBox({ initial, busy, onSubmit }: { initial: string; busy: boolean; onSubmit: (symbol: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      className="flex w-full gap-2 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim().toUpperCase();
        if (v) onSubmit(v);
      }}
    >
      <label htmlFor="ticker" className="sr-only">Ticker symbol</label>
      <input
        id="ticker"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ticker, e.g. NVDA"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-56 dark:border-zinc-700"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Loading…" : "Look up"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Create `components/SummaryStrip.tsx`**

```tsx
import { formatPct } from "@/lib/format";
import type { Summary } from "@/lib/types";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-zinc-500">{note}</dd>
    </div>
  );
}

export function SummaryStrip({ summary: s }: { summary: Summary }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Beat rate" value={`${s.beats} / ${s.quartersWithEstimate}`} note="quarters where EPS topped the estimate" />
      <Stat label="Avg EPS surprise" value={formatPct(s.avgSurprisePct)} note="how far actual EPS landed from the estimate" />
      <Stat label="Avg 1-day move vs S&P" value={formatPct(s.avgD1Excess)} note="stock minus S&P 500, first day after the report" />
      <Stat label="Beat but fell" value={`${s.beatButFell} / ${s.beats}`} note="beats where the stock lagged the S&P next day" />
    </dl>
  );
}
```

- [ ] **Step 7: Create `components/QuarterTable.tsx`**

```tsx
import { formatDate, formatEps, formatMonthYear, formatPct, formatRevenue } from "@/lib/format";
import type { Move, QuarterRow } from "@/lib/types";

const tone = (n: number | null | undefined) =>
  n == null || Number(n.toFixed(1)) === 0 ? "" : n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";

const FLAG_LABEL = { "beat-but-fell": "Beat but fell", "missed-but-rose": "Missed but rose" } as const;
const TIMING_LABEL = { BMO: "before open", AMC: "after close", unknown: "timing unknown" } as const;

function MoveCell({ move }: { move: Move | null }) {
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${tone(move?.excess)}`}
      title={move ? `Stock ${formatPct(move.stock)} · S&P ${formatPct(move.spy)}` : "Not enough trading days yet"}
    >
      {formatPct(move?.excess ?? null)}
    </td>
  );
}

export function QuarterTable({ quarters }: { quarters: QuarterRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th scope="col" className="px-3 py-2">Quarter ended</th>
            <th scope="col" className="px-3 py-2">Reported</th>
            <th scope="col" className="px-3 py-2 text-right">EPS est → actual</th>
            <th scope="col" className="px-3 py-2 text-right">Surprise</th>
            <th scope="col" className="px-3 py-2 text-right">Revenue</th>
            <th scope="col" className="px-3 py-2 text-right">1D</th>
            <th scope="col" className="px-3 py-2 text-right">3D</th>
            <th scope="col" className="px-3 py-2 text-right">5D</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {quarters.map((q) => (
            <tr key={q.fiscalDateEnding} className={q.flag ? "bg-amber-50 dark:bg-amber-950/40" : ""}>
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                {formatMonthYear(q.fiscalDateEnding)}
                {q.flag && (
                  <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    {FLAG_LABEL[q.flag]}
                  </span>
                )}
              </th>
              <td className="whitespace-nowrap px-3 py-2">
                {formatDate(q.reportedDate)} <span className="text-zinc-500">· {TIMING_LABEL[q.timing]}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatEps(q.estimatedEPS)} → {formatEps(q.reportedEPS)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(q.surprisePct)}`}>{formatPct(q.surprisePct)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatRevenue(q.revenue)}</td>
              <MoveCell move={q.moves.d1} />
              <MoveCell move={q.moves.d3} />
              <MoveCell move={q.moves.d5} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Create `components/Tracker.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TickerReport } from "@/lib/types";
import { QuarterTable } from "./QuarterTable";
import { SearchBox } from "./SearchBox";
import { SummaryStrip } from "./SummaryStrip";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; canRetry: boolean }
  | { status: "done"; report: TickerReport };

function Report({ report }: { report: TickerReport }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">{report.name ? `${report.name} (${report.symbol})` : report.symbol}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Last {report.quarters.length} quarters · 1D / 3D / 5D moves are the stock minus the S&amp;P 500, in %
        </p>
        {report.stale && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {"Showing saved data — the data provider couldn't be refreshed, so this may be out of date."}
          </p>
        )}
      </div>
      <SummaryStrip summary={report.summary} />
      <QuarterTable quarters={report.quarters} />
    </div>
  );
}

export function Tracker() {
  const router = useRouter();
  const symbol = (useSearchParams().get("t") ?? "").trim().toUpperCase();
  const [state, setState] = useState<State>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!symbol) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/ticker/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) setState({ status: "done", report: body as TickerReport });
        else
          setState({
            status: "error",
            message: body?.error?.message ?? "Something went wrong.",
            canRetry: body?.error?.code === "UPSTREAM",
          });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Couldn't reach the data provider.", canRetry: true });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, attempt]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Earnings Reaction Tracker</h1>
        <SearchBox
          key={symbol}
          initial={symbol}
          busy={state.status === "loading"}
          onSubmit={(s) => router.push(`/?t=${encodeURIComponent(s)}`)}
        />
      </header>
      <section className="mt-8" aria-live="polite">
        {state.status === "idle" && (
          <p className="max-w-prose text-zinc-500">
            Type a ticker to see how its last 12 earnings reports compared with analyst expectations — and how the stock reacted.
          </p>
        )}
        {state.status === "loading" && <p className="text-zinc-500">Loading {symbol}…</p>}
        {state.status === "error" && (
          <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <p>{state.message}</p>
            {state.canRetry && (
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-3 font-medium underline">
                Try again
              </button>
            )}
          </div>
        )}
        {state.status === "done" && <Report report={state.report} />}
      </section>
    </main>
  );
}
```

- [ ] **Step 9: Replace `app/page.tsx`; update metadata in `app/layout.tsx`**

`app/page.tsx`:
```tsx
import { Suspense } from "react";
import { Tracker } from "@/components/Tracker";

export default function Page() {
  return (
    <Suspense>
      <Tracker />
    </Suspense>
  );
}
```
In `app/layout.tsx`, change only the `metadata` export:
```ts
export const metadata: Metadata = {
  title: "Earnings Reaction Tracker",
  description: "Did the company beat expectations — and did the market care?",
};
```

- [ ] **Step 10: Verify**

Run: `npm test`, `npm run lint`, `npm run build` — Expected: all pass. If lint flags `setState` inside `useEffect` (react-hooks rule), report it rather than disabling the rule globally; a single-line disable comment on that effect is acceptable.

Run `npm run dev`, open `http://localhost:3000/?t=NVDA` in the browser pane. Check: summary strip shows 4 numbers, table shows ~12 rows, flagged rows highlighted, hover on a move cell shows raw stock/S&P moves. Check `?t=ZZZZZZ` shows the not-found message. Check at mobile width (375px): header stacks, table scrolls sideways.

- [ ] **Step 11: 🛑 Product owner checkpoint**

Screenshot the NVDA page and send it to the product owner. Ask for reactions before adding the chart.

- [ ] **Step 12: Commit**

```bash
git add lib/format.ts test/format.test.ts components app/page.tsx app/layout.tsx
git commit -m "feat: add ticker page with summary strip and quarter table"
```

---

### Task 10: The chart

**Files:**
- Create: `components/QuarterChart.tsx`
- Modify: `components/Tracker.tsx` (insert chart in `Report`)

**Interfaces:**
- Consumes: `QuarterRow`, `formatPct`, `formatMonthYear`.
- Produces: `QuarterChart({ quarters }: { quarters: QuarterRow[] })`.

- [ ] **Step 1: Read the dataviz skill**

REQUIRED: invoke the `dataviz` skill before writing chart code and follow its color and mark guidance. The colors below are defaults to replace if the skill's palette says otherwise.

- [ ] **Step 2: Create `components/QuarterChart.tsx`**

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonthYear, formatPct } from "@/lib/format";
import type { QuarterRow } from "@/lib/types";

export function QuarterChart({ quarters }: { quarters: QuarterRow[] }) {
  const data = [...quarters].reverse().map((q) => ({
    label: formatMonthYear(q.fiscalDateEnding),
    surprise: q.surprisePct,
    reaction: q.moves.d1?.excess ?? null,
  }));
  return (
    <figure className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <figcaption className="mb-3 text-sm text-zinc-500">
        EPS surprise vs 1-day move vs S&amp;P 500 (%) — bars pointing opposite ways mean results and reaction disagreed
      </figcaption>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "currentColor" }} />
            <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12, fill: "currentColor" }} width={48} />
            <Tooltip formatter={(v) => formatPct(typeof v === "number" ? v : null)} />
            <Legend />
            <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.4} />
            <Bar dataKey="surprise" name="EPS surprise" fill="#6366f1" />
            <Bar dataKey="reaction" name="1-day move vs S&P" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
```

- [ ] **Step 3: Insert into `components/Tracker.tsx`**

Add `import { QuarterChart } from "./QuarterChart";` and in `Report`, between `<SummaryStrip … />` and `<QuarterTable … />`:
```tsx
      <QuarterChart quarters={report.quarters} />
```

- [ ] **Step 4: Verify**

Run: `npm run lint`, `npm run build` — Expected: pass. Open `?t=NVDA`: chart shows 12 pairs of bars oldest → newest, tooltip shows formatted %, readable in light and dark mode, fits a 375px-wide screen.

- [ ] **Step 5: Commit**

```bash
git add components/QuarterChart.tsx components/Tracker.tsx
git commit -m "feat: add surprise vs reaction chart"
```

---

### Task 11: End-to-end check with real tickers 🛑

**Files:**
- Modify: none expected (fix-ups only if checks fail)

- [ ] **Step 1: Full test/lint/build**

Run: `npm test`, `npm run lint`, `npm run build` — Expected: all pass. Quote the pass counts.

- [ ] **Step 2: Three real tickers**

With `npm run dev`, load `?t=NVDA`, `?t=AAPL`, and one company that missed recently (pick from the probe or ask the product owner). For each: one quarter's EPS estimate/actual spot-checked against a public source; one quarter's 1-day move sanity-checked against the stock's known move that day (within ~0.5 percentage points).

- [ ] **Step 3: Error paths**

Check: `?t=ZZZZZZ` (not found), `?t=SPY` (ETF → not found), temporarily blank `TIINGO_API_KEY` in `.env.local` and restart (missing-key message), then restore it.

- [ ] **Step 4: 🛑 Product owner checkpoint**

Report results in plain language, with screenshots of NVDA on desktop and mobile width. Ask whether to move to Phase 4 (polish) or change anything first.

- [ ] **Step 5: Commit any fix-ups**

```bash
git add -A
git commit -m "fix: address end-to-end check findings"
```
(Skip if nothing changed.)
