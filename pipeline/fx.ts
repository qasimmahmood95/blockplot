import { fetchYahooDaily, parseFredCsv } from './benchmarks';
import { getJson, getText } from './http';
import { frankfurterSchema, type BenchmarkDay, type DailyPrice } from './schema';

/**
 * GBP/USD daily history, for re-denominating BTC metrics into GBP.
 *
 * Display conversion at today's rate would be wrong: a GBP investor's
 * drawdown, volatility and monthly returns genuinely differ from the USD
 * ones because the rate moves. So each daily close is converted at *that
 * day's* rate and every metric is recomputed from the converted series.
 *
 * Yahoo's `GBPUSD=X` reaches back further than FRED's 10-year `DEXUSUK`
 * window, so it leads and FRED is the fallback.
 */
export const GBPUSD_YAHOO_TICKERS = ['GBPUSD=X'];
export const GBPUSD_FRED_SERIES = 'DEXUSUK';

const FRED_CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${GBPUSD_FRED_SERIES}`;
/** ECB reference rates via Frankfurter: keyless and published every business day. */
const FRANKFURTER_URL = 'https://api.frankfurter.app/1999-01-04..?from=GBP&to=USD';

/** Supported display currencies. USD is the source currency and needs no rate. */
export const CURRENCIES = ['usd', 'gbp'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Fetch-level floor: FX history should cover the BTC series with room to spare. */
const MIN_FX_DAYS = 3650;

/**
 * Rate to divide a USD figure by, per date. FX markets close at weekends and
 * on bank holidays while BTC trades every day, so the last quoted rate is
 * carried forward — the standard convention, and the only one that lets a
 * daily BTC series be converted without inventing rates.
 */
export function rateLookup(rates: BenchmarkDay[]): (date: string) => number | null {
  const sorted = [...rates].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cursor = 0;
  let current: number | null = null;
  return (date: string): number | null => {
    // Callers walk dates forward, so the cursor only ever advances.
    while (cursor < sorted.length && (sorted[cursor] as BenchmarkDay).date <= date) {
      current = (sorted[cursor] as BenchmarkDay).close;
      cursor++;
    }
    return current;
  };
}

/**
 * Convert a USD daily series into `currency`. Days before the first quoted
 * rate are dropped (there is no honest rate to use); every other day uses
 * that day's rate, or the most recent earlier one.
 */
export function convertSeries(
  series: DailyPrice[],
  rates: BenchmarkDay[],
  currency: Currency,
): DailyPrice[] {
  if (currency === 'usd') return series;
  const lookup = rateLookup(rates);
  const out: DailyPrice[] = [];
  for (const { date, priceUsd } of series) {
    const rate = lookup(date);
    if (rate === null) continue;
    if (!(rate > 0)) throw new Error(`convertSeries: non-positive rate ${rate} at ${date}`);
    out.push({ date, priceUsd: Math.round((priceUsd / rate) * 100) / 100 });
  }
  return out;
}

/** Same conversion for benchmark closes (S&P 500, gold), which are also USD-quoted. */
export function convertBenchmark(
  series: BenchmarkDay[],
  rates: BenchmarkDay[],
  currency: Currency,
): BenchmarkDay[] {
  if (currency === 'usd') return series;
  const lookup = rateLookup(rates);
  const out: BenchmarkDay[] = [];
  for (const { date, close } of series) {
    const rate = lookup(date);
    if (rate === null) continue;
    if (!(rate > 0)) throw new Error(`convertBenchmark: non-positive rate ${rate} at ${date}`);
    out.push({ date, close: Math.round((close / rate) * 10_000) / 10_000 });
  }
  return out;
}

/** Merge rate series, later sources winning per date, sorted ascending. */
export function mergeRates(...sources: BenchmarkDay[][]): BenchmarkDay[] {
  const byDate = new Map<string, number>();
  for (const source of sources) {
    for (const { date, close } of source) byDate.set(date, close);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
}

/**
 * Days the rate series may lag the BTC series before the carry-forward rule
 * stops being a weekend convenience and starts silently pricing recent days
 * at a stale rate. A long weekend plus a bank holiday is 4 days.
 */
export const MAX_FX_LAG_DAYS = 5;

export function fxLagDays(rates: BenchmarkDay[], throughDate: string): number {
  const last = rates.at(-1);
  if (!last) return Number.POSITIVE_INFINITY;
  return Math.round(
    (Date.parse(`${throughDate}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / 86_400_000,
  );
}

/** Parse Frankfurter's `{ rates: { 'YYYY-MM-DD': { USD: n } } }` time series. */
export function parseFrankfurter(payload: unknown): BenchmarkDay[] {
  const { rates } = frankfurterSchema.parse(payload);
  const out = Object.entries(rates)
    .map(([date, quote]) => ({ date, close: quote.USD }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (out.length === 0) throw new Error('parseFrankfurter: no rates');
  return out;
}

/**
 * Rates come from three keyless sources because none is both deep and fresh:
 * Yahoo `range=max` reaches back to 1971 but its tail ran ten days stale on
 * the first live run, and FRED's `DEXUSUK` is published with a similar lag.
 * ECB reference rates (via Frankfurter) are published every business day and
 * supply the fresh end. Later sources win per date, so the merged series is
 * deep at the start and current at the tail.
 */
export async function fetchGbpUsd(): Promise<BenchmarkDay[]> {
  const parts: BenchmarkDay[][] = [];
  try {
    const deep = await fetchYahooDaily(GBPUSD_YAHOO_TICKERS, { range: 'max' });
    if (deep.series.length >= MIN_FX_DAYS) parts.push(deep.series);
  } catch {
    // deep history is optional if the fresher sources cover enough
  }
  try {
    parts.push(parseFredCsv(await getText(FRED_CSV_URL), GBPUSD_FRED_SERIES));
  } catch {
    // optional middle source
  }
  try {
    parts.push(parseFrankfurter(await getJson(FRANKFURTER_URL)));
  } catch {
    // optional; the lag guard in run.ts surfaces a stale tail
  }
  const merged = mergeRates(...parts);
  if (merged.length < 365) {
    throw new Error(`fetchGbpUsd: only ${merged.length} rate days available`);
  }
  return merged;
}
