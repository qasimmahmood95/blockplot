import { getJson, getText } from './http';
import { yahooChartSchema, type BenchmarkDay } from './schema';
import { trimToLastDays } from './series';

/**
 * Benchmark sources. S&P 500 comes from FRED's keyless fredgraph.csv export
 * (the JSON API needs an account key; the CSV export does not). Gold cannot
 * come from FRED — its LBMA series were discontinued in 2022 when IBA pulled
 * redistribution rights — and stooq's CSV export sits behind a JavaScript
 * bot-check for CI runner IPs (confirmed 2026-07-26), so gold comes from
 * Yahoo Finance's keyless chart API: XAU/USD spot first, COMEX front-month
 * futures as fallback.
 */
export const SP500_FRED_SERIES = 'SP500';
export const GOLD_YAHOO_TICKERS = ['XAUUSD=X', 'GC=F'];
/** ICE dollar index: the index itself, front-month futures as fallback. */
export const DXY_YAHOO_TICKERS = ['DX-Y.NYB', 'DX=F'];

const FRED_CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${SP500_FRED_SERIES}`;
const YAHOO_CHART_API = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Trailing calendar days of benchmark history kept on disk: the 365-day BTC
 * display window plus a full 90-day correlation warmup and a small margin,
 * so rolling windows are already full at the first display date.
 */
export const BENCHMARK_KEEP_DAYS = 460;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertAscending(series: BenchmarkDay[], context: string): BenchmarkDay[] {
  if (series.length === 0) throw new Error(`${context}: no data rows`);
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev && curr && curr.date <= prev.date) {
      throw new Error(`${context}: dates not strictly ascending at ${curr.date}`);
    }
  }
  return series;
}

/**
 * Parse a FRED fredgraph.csv export: a `DATE,<id>` header (`observation_date`
 * in newer exports) and one row per day, `.` marking market holidays (skipped).
 * Anything else — including FRED's HTML error pages — throws.
 */
export function parseFredCsv(csv: string, seriesId: string): BenchmarkDay[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((cell) => cell.trim());
  const dateCol = (header[0] ?? '').toLowerCase();
  if ((dateCol !== 'date' && dateCol !== 'observation_date') || header[1] !== seriesId) {
    throw new Error(`parseFredCsv: unexpected header "${lines[0] ?? ''}"`);
  }
  const out: BenchmarkDay[] = [];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(',').map((cell) => cell.trim());
    if (!date || !DATE_RE.test(date)) throw new Error(`parseFredCsv: bad row "${line}"`);
    if (value === undefined || value === '' || value === '.') continue;
    const close = Number(value);
    if (!Number.isFinite(close) || close <= 0) throw new Error(`parseFredCsv: bad close "${line}"`);
    out.push({ date, close });
  }
  return assertAscending(out, 'parseFredCsv');
}

/**
 * Collapse a Yahoo chart payload into one close per UTC day. Null closes
 * (market holidays / missing bars) are skipped; when two bars share a UTC
 * day the chronologically last one wins, mirroring toDailySeries.
 */
export function parseYahooChart(payload: unknown): BenchmarkDay[] {
  const result = yahooChartSchema.parse(payload).chart.result[0];
  if (!result) throw new Error('parseYahooChart: empty result');
  const closes = result.indicators.quote[0]?.close ?? [];
  if (closes.length !== result.timestamp.length) {
    throw new Error('parseYahooChart: timestamp/close length mismatch');
  }
  const byDate = new Map<string, number>();
  [...result.timestamp.keys()]
    .sort((a, b) => (result.timestamp[a] ?? 0) - (result.timestamp[b] ?? 0))
    .forEach((i) => {
      const ts = result.timestamp[i];
      const close = closes[i];
      if (ts === undefined || close === null || close === undefined) return;
      if (!Number.isFinite(close) || close <= 0) {
        throw new Error(`parseYahooChart: bad close ${close}`);
      }
      byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), close);
    });
  const out = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
  return assertAscending(out, 'parseYahooChart');
}

export async function fetchSp500(): Promise<BenchmarkDay[]> {
  return trimToLastDays(parseFredCsv(await getText(FRED_CSV_URL), SP500_FRED_SERIES), BENCHMARK_KEEP_DAYS);
}

export interface YahooFetch {
  /** The Yahoo ticker that actually served the data. */
  ticker: string;
  series: BenchmarkDay[];
}

/**
 * Fetch daily closes from Yahoo, trying tickers in preference order.
 * `range: 'max'` also skips the trailing-window trim, for callers (FX) that
 * need history reaching back as far as the BTC series.
 */
export async function fetchYahooDaily(
  tickers: string[],
  opts: { range?: '2y' | 'max' } = {},
): Promise<YahooFetch> {
  const range = opts.range ?? '2y';
  let lastError: unknown;
  for (const ticker of tickers) {
    const url = `${YAHOO_CHART_API}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    try {
      const parsed = parseYahooChart(await getJson(url));
      return { ticker, series: range === 'max' ? parsed : trimToLastDays(parsed, BENCHMARK_KEEP_DAYS) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchYahooDaily: all tickers failed (${tickers.join(', ')})`);
}

export const fetchGold = (): Promise<YahooFetch> => fetchYahooDaily(GOLD_YAHOO_TICKERS);
export const fetchDxy = (): Promise<YahooFetch> => fetchYahooDaily(DXY_YAHOO_TICKERS);
