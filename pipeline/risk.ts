import type {
  BenchmarkDay,
  DailyPrice,
  DrawdownPoint,
  RiskAssetStats,
  RiskDataset,
  VolPoint,
} from './schema';

/** Annualization bases: BTC trades every calendar day, market-hours assets ~252 days a year. */
export const CRYPTO_PERIODS_PER_YEAR = 365;
export const MARKET_PERIODS_PER_YEAR = 252;

/** Rolling realized-vol windows, in days; all three populate from the deep-history source. */
export const ROLLING_VOL_WINDOWS = [30, 90, 365];

/** A dated observation, source-agnostic. */
export interface SeriesPoint {
  date: string;
  value: number;
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalize -0 for stable JSON
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Daily log returns: r_i = ln(P_i / P_{i-1}). One entry fewer than the input. */
export function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev !== undefined && curr !== undefined) out.push(Math.log(curr / prev));
  }
  return out;
}

/** Sample standard deviation (n − 1 denominator). */
export function sampleStd(values: number[]): number {
  if (values.length < 2) throw new Error('sampleStd: need at least 2 values');
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/** Annualized realized volatility in %: sampleStd(returns) × √periodsPerYear × 100, 2 dp. */
export function annualizedVolPct(returns: number[], periodsPerYear: number): number {
  return round2(sampleStd(returns) * Math.sqrt(periodsPerYear) * 100);
}

/**
 * Rolling realized vol: the point at date d uses the `windowDays` daily
 * returns ending at d, so the series starts `windowDays` entries in and is
 * empty when the history is shorter than the window.
 */
export function rollingVol(
  points: SeriesPoint[],
  windowDays: number,
  periodsPerYear: number,
): VolPoint[] {
  const returns = logReturns(points.map((p) => p.value));
  const out: VolPoint[] = [];
  for (let i = windowDays; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    out.push({
      date: point.date,
      volPct: annualizedVolPct(returns.slice(i - windowDays, i), periodsPerYear),
    });
  }
  return out;
}

export interface DrawdownCurve {
  maxDrawdownPct: number;
  peakDate: string;
  troughDate: string;
  series: DrawdownPoint[];
}

/**
 * Decline from the running peak, in %, per day. The deepest drawdown keeps
 * the first date it was reached and the peak it fell from; ties resolve to
 * the earliest trough.
 */
export function drawdownCurve(points: SeriesPoint[]): DrawdownCurve {
  const first = points[0];
  if (!first) throw new Error('drawdownCurve: empty series');
  let peak = first.value;
  let peakDate = first.date;
  let maxDrawdown = 0;
  let maxPeakDate = first.date;
  let troughDate = first.date;
  const series = points.map(({ date, value }) => {
    if (value > peak) {
      peak = value;
      peakDate = date;
    }
    const drawdown = (value / peak - 1) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxPeakDate = peakDate;
      troughDate = date;
    }
    return { date, drawdownPct: round2(drawdown) };
  });
  return {
    maxDrawdownPct: round2(maxDrawdown),
    peakDate: maxPeakDate,
    troughDate,
    series,
  };
}

/** Annualized Sharpe ratio over a 0% risk-free rate; null when variance is zero. */
export function sharpeRatio(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const std = sampleStd(returns);
  if (std === 0) return null;
  return round2((mean(returns) / std) * Math.sqrt(periodsPerYear));
}

/**
 * Annualized Sortino ratio with a 0% target: downside deviation is
 * √(Σ min(r, 0)² / n) over ALL n returns (the target-downside-deviation
 * convention). Null when no return is negative.
 */
export function sortinoRatio(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const downside = Math.sqrt(returns.reduce((sum, r) => sum + Math.min(r, 0) ** 2, 0) / returns.length);
  if (downside === 0) return null;
  return round2((mean(returns) / downside) * Math.sqrt(periodsPerYear));
}

/** All comparison figures for one asset over its observations in the shared window. */
export function assetRiskStats(
  asset: RiskAssetStats['asset'],
  points: SeriesPoint[],
  periodsPerYear: RiskAssetStats['periodsPerYear'],
): RiskAssetStats {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 3) {
    throw new Error(`assetRiskStats: ${asset}: need at least 3 points in the window`);
  }
  const returns = logReturns(points.map((p) => p.value));
  return {
    asset,
    periodsPerYear,
    observations: points.length,
    firstDate: first.date,
    lastDate: last.date,
    totalReturnPct: round2((last.value / first.value - 1) * 100),
    annualizedVolPct: annualizedVolPct(returns, periodsPerYear),
    sharpe: sharpeRatio(returns, periodsPerYear),
    sortino: sortinoRatio(returns, periodsPerYear),
    maxDrawdownPct: drawdownCurve(points).maxDrawdownPct,
  };
}

/** Entries within [firstDate, lastDate], inclusive. */
export function clampToRange(points: SeriesPoint[], firstDate: string, lastDate: string): SeriesPoint[] {
  return points.filter((p) => p.date >= firstDate && p.date <= lastDate);
}

const toPoint = ({ date, close }: BenchmarkDay): SeriesPoint => ({ date, value: close });

/**
 * Assemble data/risk-metrics.json: BTC rolling vol and drawdown over the full
 * fetched window, plus per-asset comparison stats with each benchmark clamped
 * to BTC's date range (each asset keeps its own trading calendar within it).
 * When deep history is provided, all rolling-vol curves derive from it (so
 * the 365d window has enough pre-window returns) and are clipped to the
 * display window; drawdown and the comparison stay on the spot series.
 */
export function buildRiskDataset(
  btc: DailyPrice[],
  benchmarks: { sp500: BenchmarkDay[]; gold: BenchmarkDay[]; eth?: BenchmarkDay[] },
  opts: { fetchedAt: string; rollingWindows?: number[]; history?: DailyPrice[] },
): Omit<RiskDataset, 'currency'> {
  const points = btc.map(({ date, price }) => ({ date, value: price }));
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) throw new Error('buildRiskDataset: empty BTC series');
  const windows = opts.rollingWindows ?? ROLLING_VOL_WINDOWS;
  const history = opts.history ?? [];
  const volPoints = history.length
    ? history.map(({ date, price }) => ({ date, value: price }))
    : points;
  const sp500 = clampToRange(benchmarks.sp500.map(toPoint), first.date, last.date);
  const gold = clampToRange(benchmarks.gold.map(toPoint), first.date, last.date);
  // Optional so a Yahoo outage costs the ETH row rather than the whole file,
  // which is the same posture the run takes for every other benchmark. The
  // row is dropped entirely rather than emitted empty: `assetRiskStats`
  // needs three observations, and a table cell reading "—" against a column
  // of real figures invites the reading that ETH did nothing.
  const eth = benchmarks.eth
    ? clampToRange(benchmarks.eth.map(toPoint), first.date, last.date)
    : [];
  return {
    schemaVersion: 2,
    fetchedAt: opts.fetchedAt,
    asOf: last.date,
    windowDays: points.length,
    rollingVolSource: history.length ? 'blockchain.info' : 'coingecko',
    rollingVol: windows.map((windowDays) => ({
      windowDays,
      series: rollingVol(volPoints, windowDays, CRYPTO_PERIODS_PER_YEAR).filter(
        (p) => p.date >= first.date && p.date <= last.date,
      ),
    })),
    drawdown: drawdownCurve(points),
    comparison: [
      assetRiskStats('btc', points, CRYPTO_PERIODS_PER_YEAR),
      // ETH annualizes on 365 like BTC, not 252 like the market-hours assets:
      // it trades every day, and using the market base would overstate its
      // volatility by about 20% while still looking like a plausible number.
      ...(eth.length >= 3 ? [assetRiskStats('eth', eth, CRYPTO_PERIODS_PER_YEAR)] : []),
      assetRiskStats('sp500', sp500, MARKET_PERIODS_PER_YEAR),
      assetRiskStats('gold', gold, MARKET_PERIODS_PER_YEAR),
    ],
  };
}
