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
/**
 * Ether, spot first and CME futures as fallback (M17).
 *
 * `ETH=F` is a genuine fallback rather than a formality, but a shallow one:
 * measured at this repo's own parameters it serves 1,380 daily bars from
 * 2021-02-05 against ETH-USD's 3,185 from 2017-11-09. It clears the depth
 * floor, so a spot outage degrades the history rather than failing the run.
 *
 * Quoted natively in GBP as `ETH-GBP` rather than converted — see
 * `ETH_GBP_YAHOO_TICKERS`.
 */
export const ETH_YAHOO_TICKERS = ['ETH-USD', 'ETH=F'];
/**
 * Ether in sterling, taken from its own market instead of the committed
 * cross-rate. The one deliberate departure in the GBP tree, where every other
 * figure is a re-denomination of a single USD source.
 *
 * The reasoning is that a GBP holder's ether really does trade in GBP, and
 * there is no fallback ticker on purpose: a futures contract quoted in dollars
 * would defeat the point of quoting natively. If this fails, run.ts falls back
 * to converting, which is a stated, checked outcome rather than a silent one.
 */
export const ETH_GBP_YAHOO_TICKERS = ['ETH-GBP'];

const FRED_CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${SP500_FRED_SERIES}`;
const YAHOO_CHART_API = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Trailing calendar days kept in benchmarks-daily.json: the 365-day BTC
 * display window plus margin, which is what the risk page's comparison table
 * needs. Correlations no longer draw on this window — they read the full
 * fetched history — so this is now purely the risk page's number.
 */
export const BENCHMARK_KEEP_DAYS = 460;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reject a series that is not actually daily.
 *
 * Yahoo accepts `interval=1d` with `range=max` and then silently serves
 * coarser bars: on the first live run gold came back monthly (13 bars where
 * 316 were expected) and DXY quarterly (6). Nothing failed — the schema was
 * satisfied, the file was written, and the risk page computed Sharpe and
 * volatility for gold from thirteen observations. Wrong numbers that look
 * right are the worst failure available here, so granularity is checked
 * rather than assumed.
 *
 * Business-day series gap by 1 over the week and 3 over a weekend, so a
 * median gap above 4 days means the response is not daily. The median, not
 * the mean: a genuine daily series still contains long holiday gaps.
 */
export function assertDaily(series: BenchmarkDay[], context: string): BenchmarkDay[] {
  if (series.length < 2) return series;
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (!prev || !curr) continue;
    gaps.push(
      Math.round(
        (Date.parse(`${curr.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / 86_400_000,
      ),
    );
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 1;
  if (median > 4) {
    throw new Error(
      `${context}: median gap ${median} days — the source served coarser bars than daily`,
    );
  }
  return series;
}

/**
 * Minimum bars a benchmark response must carry. Depth is load-bearing now that
 * the correlation regimes read these series in full: a throttled or truncated
 * response would silently shorten the headline view rather than fail. Two
 * years of trading days is far below the ~2,500 a 10y daily range serves and
 * far above anything truncated.
 */
export const MIN_BENCHMARK_DAYS = 500;

export function assertDepth(series: BenchmarkDay[], context: string): BenchmarkDay[] {
  if (series.length < MIN_BENCHMARK_DAYS) {
    throw new Error(
      `${context}: only ${series.length} days (need ${MIN_BENCHMARK_DAYS})`,
    );
  }
  return series;
}

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
      // Skipped, not thrown: at range=max these series run to the 1980s, where
      // a stray zero or NaN bar in thin data is a source defect, not a reason
      // to lose the whole benchmark — including the 460d window and the risk
      // page's DXY column. An all-bad response still fails, via the empty
      // check in assertAscending.
      if (!Number.isFinite(close) || close <= 0) return;
      byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), close);
    });
  const out = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, close]) => ({ date, close }));
  return assertAscending(out, 'parseYahooChart');
}

/**
 * Full S&P 500 history FRED will serve: a rolling ten-year window. Gold and
 * DXY land in the same place, since 10y is the deepest range Yahoo serves at
 * daily granularity — so every BTC pair reaches about a decade.
 */
export async function fetchSp500(): Promise<BenchmarkDay[]> {
  const series = assertDaily(
    parseFredCsv(await getText(FRED_CSV_URL), SP500_FRED_SERIES),
    SP500_FRED_SERIES,
  );
  assertDepth(series, SP500_FRED_SERIES);
  return series;
}

/**
 * The trailing window benchmarks-daily.json and the risk page need.
 *
 * Re-asserts granularity on the slice rather than trusting the whole-series
 * check: a median over 2,500 daily bars stays 1 even if the last 20 turn
 * monthly, and the risk page reads only those last bars. The guarantee has to
 * hold where it is consumed.
 */
export const recentWindow = (series: BenchmarkDay[]): BenchmarkDay[] =>
  assertDaily(trimToLastDays(series, BENCHMARK_KEEP_DAYS), 'recentWindow');

export interface YahooFetch {
  /** The Yahoo ticker that actually served the data. */
  ticker: string;
  series: BenchmarkDay[];
}

/**
 * Fetch daily closes from Yahoo, trying tickers in preference order. Always
 * untrimmed: callers take `recentWindow` for the 460d files and the whole
 * series for the regime view, so one request serves both.
 *
 * `range=max` is deliberately not offered. Yahoo accepts it alongside
 * `interval=1d` and then serves monthly or quarterly bars, which is how the
 * first deep run put 13 gold bars into a file that had held 316. 10y is the
 * deepest range it serves daily, and every consumer here is bounded by a
 * shallower constraint anyway (FRED publishes the S&P 500 as a rolling
 * decade; the GBP/USD record starts in 2009).
 */
export async function fetchYahooDaily(
  tickers: string[],
  opts: { range?: '2y' | '10y' } = {},
): Promise<YahooFetch> {
  const range = opts.range ?? '10y';
  let lastError: unknown;
  for (const ticker of tickers) {
    const url = `${YAHOO_CHART_API}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    try {
      // Both checks run inside the loop so a coarse or truncated response from
      // the primary ticker falls through to the fallback — which is precisely
      // the throttling case the depth floor exists for.
      const series = assertDaily(parseYahooChart(await getJson(url)), ticker);
      return { ticker, series: range === '2y' ? series : assertDepth(series, ticker) };
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
export const fetchEth = (): Promise<YahooFetch> => fetchYahooDaily(ETH_YAHOO_TICKERS);
export const fetchEthGbp = (): Promise<YahooFetch> => fetchYahooDaily(ETH_GBP_YAHOO_TICKERS);
