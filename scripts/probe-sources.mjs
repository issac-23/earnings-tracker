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
