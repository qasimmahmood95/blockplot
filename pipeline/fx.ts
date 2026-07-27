import { fetchYahooDaily, parseFredCsv } from './benchmarks';
import { getText } from './http';
import type { BenchmarkDay, DailyPrice } from './schema';

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

export async function fetchGbpUsd(): Promise<BenchmarkDay[]> {
  try {
    const { series } = await fetchYahooDaily(GBPUSD_YAHOO_TICKERS, { range: 'max' });
    if (series.length >= MIN_FX_DAYS) return series;
  } catch {
    // fall through to FRED
  }
  const fred = parseFredCsv(await getText(FRED_CSV_URL), GBPUSD_FRED_SERIES);
  if (fred.length < 365) {
    throw new Error(`fetchGbpUsd: only ${fred.length} rate days available`);
  }
  return fred;
}
