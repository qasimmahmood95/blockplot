import { assertDaily, fetchYahooDaily, parseFredCsv } from './benchmarks';
import { getJson, getText } from './http';
import {
  frankfurterSchema,
  type BenchmarkDay,
  type Currency,
  type DailyPrice,
  type FxSource,
} from './schema';

/**
 * GBP/USD daily history, for re-denominating BTC metrics into GBP.
 *
 * Display conversion at today's rate would be wrong: a GBP investor's
 * drawdown, volatility and monthly returns genuinely differ from the USD
 * ones because the rate moves. So each daily close is converted at *that
 * day's* rate and every metric is recomputed from the converted series.
 */
export const GBPUSD_YAHOO_TICKERS = ['GBPUSD=X'];
export const GBPUSD_FRED_SERIES = 'DEXUSUK';

const FRED_CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${GBPUSD_FRED_SERIES}`;
/** ECB reference rates via Frankfurter: keyless and published every business day. */
const FRANKFURTER_URL = 'https://api.frankfurter.app/1999-01-04..?from=GBP&to=USD';

/**
 * Depth floor for the *Yahoo* leg alone: a short response there means the
 * ticker is being throttled or has changed shape, so it is dropped rather
 * than merged. FRED and ECB carry their own depth and are not gated by it.
 *
 * Yahoo now contributes a 10-year daily window rather than the whole record —
 * `range=max` returns coarser-than-daily bars, which is why this leg never
 * survived the old 3,650-day floor. FRED reaches 1971 and ECB publishes daily,
 * so Yahoo is a cross-check on the recent end rather than the depth source.
 */
const MIN_YAHOO_FX_DAYS = 2000;

/**
 * Days the rate series may lag the BTC series before the carry-forward rule
 * stops being a weekend convenience and starts silently pricing recent days
 * at a stale rate. A long weekend plus a bank holiday is 4 days.
 */
export const MAX_FX_LAG_DAYS = 5;

/**
 * Earliest rate worth committing. FRED reaches 1971, but BTC has no price
 * before late 2009 and blockchain.com's history starts in 2010, so everything
 * earlier is 800 KB of permanently committed JSON that can never convert a
 * close. The floor keeps a year of headroom in case a deeper BTC source ever
 * appears — days before the first quoted rate are dropped, not converted, so
 * the headroom is what stops a source change silently truncating history.
 */
export const FX_HISTORY_FROM = '2009-01-01';

/**
 * Total order on dates. Returning 0 for a tie matters: `-1 : 1` claims a > b
 * for equal dates, which breaks antisymmetry and lets duplicates land in an
 * engine-defined order. With 0 the sort is stable, so duplicates keep input
 * order and the last one wins — deterministic rather than arbitrary. Callers
 * pass `mergeRates` output, which is already deduped by date; this only
 * governs what a direct caller of `rateLookup` gets.
 */
const byDate = (a: { date: string }, b: { date: string }): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * Rate to divide a USD figure by, per date. FX markets close at weekends and
 * on bank holidays while BTC trades every day, so the last quote is carried
 * forward — the standard convention, and the only one that lets a daily BTC
 * series be converted without inventing rates.
 *
 * Binary search rather than a forward cursor: an earlier implementation kept
 * a cursor that never rewound, which returned a *later* rate if a caller ever
 * queried out of order. Order-independence removes that class of bug.
 */
export function rateLookup(rates: BenchmarkDay[]): (date: string) => number | null {
  const sorted = [...rates].sort(byDate);
  return (date: string): number | null => {
    let lo = 0;
    let hi = sorted.length - 1;
    let found: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = sorted[mid];
      if (!entry) break;
      if (entry.date <= date) {
        found = entry.close;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  };
}

/**
 * Convert a USD daily series into `currency`. Days before the first quoted
 * rate are dropped (there is no honest rate to use); every other day uses
 * that day's rate, or the most recent earlier one.
 *
 * Deliberately unrounded: BTC traded under $0.10 in 2010, where rounding a
 * converted price to 2 dp is an error of up to 11% that propagates into the
 * monthly heatmap. The metric builders round their own outputs, so precision
 * is kept here and spent there.
 */
export function convertSeries(
  series: DailyPrice[],
  rates: BenchmarkDay[],
  currency: Currency,
): DailyPrice[] {
  if (currency === 'usd') return series;
  const lookup = rateLookup(rates);
  const out: DailyPrice[] = [];
  for (const { date, price } of series) {
    const rate = lookup(date);
    if (rate === null) continue;
    if (!(rate > 0)) throw new Error(`convertSeries: non-positive rate ${rate} at ${date}`);
    out.push({ date, price: price / rate });
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
    out.push({ date, close: close / rate });
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
    .sort(byDate);
  if (out.length === 0) throw new Error('parseFrankfurter: no rates');
  return out;
}

export interface FxFetch {
  /** Which sources actually contributed, so the dataset can say so. */
  sources: FxSource[];
  series: BenchmarkDay[];
}

/**
 * Rates come from three keyless sources because none is both deep and fresh.
 * FRED's `DEXUSUK` reaches back to 1971 and Yahoo `range=max` matches it, but
 * both publish with a lag — Yahoo's tail ran ten days stale on the first live
 * run. ECB reference rates (via Frankfurter) start in 1999 but are published
 * every business day, supplying the fresh end. Later sources win per date, so
 * the merged series is deep at the start and current at the tail. Each leg is
 * individually optional; `sources` records which ones a given run got.
 */
export async function fetchGbpUsd(): Promise<FxFetch> {
  const parts: BenchmarkDay[][] = [];
  const sources: FxSource[] = [];
  try {
    const deep = await fetchYahooDaily(GBPUSD_YAHOO_TICKERS, { range: '10y' });
    if (deep.series.length >= MIN_YAHOO_FX_DAYS) {
      parts.push(deep.series);
      sources.push('yahoo');
    }
  } catch {
    // deep history is optional if the fresher sources cover enough
  }
  try {
    parts.push(assertDaily(parseFredCsv(await getText(FRED_CSV_URL), GBPUSD_FRED_SERIES), 'fred gbpusd'));
    sources.push('fred');
  } catch {
    // optional middle source
  }
  try {
    parts.push(assertDaily(parseFrankfurter(await getJson(FRANKFURTER_URL)), 'ecb gbpusd'));
    sources.push('ecb');
  } catch {
    // optional; the lag guard in run.ts surfaces a stale tail
  }
  const series = mergeRates(...parts).filter(({ date }) => date >= FX_HISTORY_FROM);
  if (series.length < 365) {
    throw new Error(`fetchGbpUsd: only ${series.length} rate days available`);
  }
  return { sources, series };
}

/**
 * How far a natively-quoted series sits from the same asset converted through
 * the committed rate.
 *
 * Exists because M17 takes ETH in GBP from its own market (`ETH-GBP`) rather
 * than re-denominating `ETH-USD`, which makes it the only series in that tree
 * whose sterling value does not come from the one USD source everything else
 * shares. That was a deliberate call — a GBP holder's ether really does trade
 * in GBP — and it came with an obligation: the two figures must be shown to
 * stay close, so a divergence surfaces as a data-quality signal instead of as
 * two numbers that quietly disagree.
 *
 * Compared only on dates both series carry. Rates carry forward over weekends,
 * so a converted figure exists every day, but comparing a weekend against a
 * Friday rate would measure the carry-forward convention rather than the
 * quotes.
 */
export interface QuoteDivergence {
  days: number;
  medianPct: number;
  maxPct: number;
  maxDate: string;
  beyond1Pct: number;
}

export function quoteDivergence(
  native: BenchmarkDay[],
  converted: BenchmarkDay[],
): QuoteDivergence | null {
  const convertedBy = new Map(converted.map((d) => [d.date, d.close]));
  const diffs: { date: string; pct: number }[] = [];
  for (const { date, close } of native) {
    const other = convertedBy.get(date);
    if (other === undefined || !(other > 0)) continue;
    diffs.push({ date, pct: Math.abs(close / other - 1) * 100 });
  }
  if (diffs.length === 0) return null;
  const sorted = [...diffs].sort((a, b) => a.pct - b.pct);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted.at(-1);
  if (!median || !worst) return null;
  return {
    days: diffs.length,
    medianPct: Math.round(median.pct * 1000) / 1000,
    maxPct: Math.round(worst.pct * 1000) / 1000,
    maxDate: worst.date,
    beyond1Pct: diffs.filter((d) => d.pct > 1).length,
  };
}

/**
 * The band the median divergence must stay inside.
 *
 * Set from measurement, not from taste. Over 2,531 overlapping days the median
 * came out at 0.174%, p95 at 0.711% and the single worst day at 2.910%
 * (2022-09-29, during the sterling crisis). So 1% leaves roughly a six-fold
 * margin on the statistic being asserted.
 *
 * The median is asserted and the maximum is not, and that split is the whole
 * design. A median this far from the band cannot be moved by one bad quote —
 * it takes a systematic fault: the wrong ticker, an inverted rate, a stale FX
 * tail, a mis-joined date. Those are bugs, and the build should stop. A single
 * day at 3% is the spread between two real markets on a day sterling moved,
 * and failing the build on it would make the site hostage to Yahoo's quote
 * quality on its worst afternoon. The worst day is reported instead, every
 * run, so a drift upward is visible before it becomes systematic.
 */
export const MAX_MEDIAN_QUOTE_DIVERGENCE_PCT = 1;
