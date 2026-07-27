import { classifyRegimes, REGIME_CONFIRM_DAYS, REGIME_THRESHOLD } from './regimes';
import { trimToLastDays } from './series';
import type { CorrelationDataset, CorrPoint, PairId } from './schema';
import type { SeriesPoint } from './risk';

/** Fixed asset order for pair enumeration and the matrix display. */
export const CORRELATION_ASSETS = ['btc', 'sp500', 'gold', 'dxy'] as const;

/** Rolling correlation window (calendar days) and the minimum aligned returns it must hold. */
export const CORRELATION_WINDOW_DAYS = 90;
export const CORRELATION_MIN_OBS = 40;

/**
 * How much history a pair without BTC in it keeps.
 *
 * This is a Bitcoin site: the deep view exists to show how BTC's relationship
 * with each benchmark has moved. S&P 500 vs gold vs DXY are carried only to
 * fill the correlation matrix, which reads one number from each — and at full
 * depth those three pairs were more than half of the dataset (gold–DXY alone
 * reaches 2004, further back than BTC exists). They keep a window instead, so
 * the matrix is still exact and the page is not carrying megabytes of
 * inter-benchmark history nobody opened.
 */
export const NON_BTC_KEEP_DAYS = 365;

const DAY_MS = 86_400_000;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function dateMinusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Re-date a 00:00-UTC snapshot series onto the session it closes.
 *
 * BTC dailies are instantaneous snapshots at 00:00 UTC; the S&P 500, gold and
 * the dollar index are session closes around 21:00 UTC. So the BTC return
 * dated d spans the *previous* day's session, and correlating the two by
 * calendar date pairs BTC's Monday with the market's Tuesday.
 *
 * The consequence is not academic. The March 2020 crash ran through the US
 * session of the 12th; BTC's −49.7% lands on the snapshot dated the 13th,
 * where it met the S&P's +9.29% rebound, while BTC's flat 12th met the S&P's
 * −9.51%. One inverted outlier pair then dominated a 60-observation window for
 * three months, and the page reported BTC and equities as *inverse* through
 * the most famous co-crash on record. Correcting the offset moves the trailing
 * BTC–S&P 500 correlation from +0.09 to +0.44.
 *
 * Only correlation needs this: it is the one metric that pairs observations
 * across two series. Volatility, drawdown and the Sharpe comparison aggregate
 * each series on its own, where a uniform one-day relabelling changes nothing.
 */
export function toSessionClose(series: SeriesPoint[]): SeriesPoint[] {
  return series.map(({ date, value }) => ({
    date: new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10),
    value,
  }));
}

export interface AlignedReturn {
  /** The later of the two shared dates the return spans. */
  date: string;
  ra: number;
  rb: number;
}

/**
 * Pairwise-aligned daily log returns: intersect the two calendars, then take
 * returns between consecutive shared dates (a gap in either series makes one
 * multi-day return, dated at its end). Inputs must be date-ascending, as all
 * pipeline series are.
 */
export function alignReturns(a: SeriesPoint[], b: SeriesPoint[]): AlignedReturn[] {
  const bByDate = new Map(b.map((p) => [p.date, p.value]));
  const shared = a
    .filter((p) => bByDate.has(p.date))
    .map((p) => ({ date: p.date, va: p.value, vb: bByDate.get(p.date) as number }));
  const out: AlignedReturn[] = [];
  for (let i = 1; i < shared.length; i++) {
    const prev = shared[i - 1];
    const curr = shared[i];
    if (!prev || !curr) continue;
    out.push({
      date: curr.date,
      ra: Math.log(curr.va / prev.va),
      rb: Math.log(curr.vb / prev.vb),
    });
  }
  return out;
}

/**
 * Pearson correlation. Null when undefined: fewer than 2 observations or
 * zero variance on either side.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/**
 * Rolling Pearson correlation of aligned log returns: the point at date d
 * uses returns dated in (d − windowDays, d]. Dates whose window holds fewer
 * than minObs returns, or where either side has zero variance, emit nothing.
 */
export function rollingCorrelation(
  a: SeriesPoint[],
  b: SeriesPoint[],
  windowDays: number,
  minObs: number,
): CorrPoint[] {
  const aligned = alignReturns(a, b);
  const out: CorrPoint[] = [];
  // `start` only ever moves forward: the cutoff is monotonic in the end date,
  // so a return that has left one window can never re-enter a later one.
  let start = 0;
  for (let i = 0; i < aligned.length; i++) {
    const end = aligned[i];
    if (!end) continue;
    const cutoff = dateMinusDays(end.date, windowDays);
    while (start <= i && aligned[start] !== undefined && (aligned[start] as AlignedReturn).date <= cutoff) {
      start += 1;
    }
    const window = aligned.slice(start, i + 1);
    if (window.length < minObs) continue;
    const corr = pearson(
      window.map((r) => r.ra),
      window.map((r) => r.rb),
    );
    if (corr === null) continue;
    out.push({ date: end.date, corr: round2(corr) });
  }
  return out;
}

/**
 * Assemble data/correlations.json: every unordered pair of the fixed asset
 * list, rolling correlation over each pair's whole shared history, with the
 * regime segmentation that history supports.
 *
 * `series.btc` must be the raw 00:00-UTC-dated series; this function re-dates
 * it onto the session it closes (see toSessionClose) before correlating.
 *
 * Pairs containing BTC carry their whole shared history: a 365-day view of a
 * 90-day correlation shows barely three independent windows — enough to read
 * today's number, not enough to see that BTC decoupled from gold for two
 * years. They reach about a decade: FRED publishes SP500 as a rolling ten
 * years, and 10y is the deepest range Yahoo serves at daily granularity.
 * Pairs without BTC keep a window instead — see NON_BTC_KEEP_DAYS.
 */
export function buildCorrelationDataset(
  series: Record<(typeof CORRELATION_ASSETS)[number], SeriesPoint[]>,
  opts: {
    fetchedAt: string;
    asOf: string;
    windowDays?: number;
    minObs?: number;
    regimeThreshold?: number;
    regimeConfirmDays?: number;
    nonBtcKeepDays?: number;
  },
): Omit<CorrelationDataset, 'currency'> {
  const windowDays = opts.windowDays ?? CORRELATION_WINDOW_DAYS;
  const minObs = opts.minObs ?? CORRELATION_MIN_OBS;
  const regimeThreshold = opts.regimeThreshold ?? REGIME_THRESHOLD;
  const regimeConfirmDays = opts.regimeConfirmDays ?? REGIME_CONFIRM_DAYS;
  const nonBtcKeepDays = opts.nonBtcKeepDays ?? NON_BTC_KEEP_DAYS;
  // The btc series arrives 00:00-UTC dated; every benchmark is a session
  // close. Aligning them without this pairs BTC's move with the following
  // day's market move — see toSessionClose.
  const aligned = { ...series, btc: toSessionClose(series.btc) };
  const pairs: CorrelationDataset['pairs'] = [];
  for (let i = 0; i < CORRELATION_ASSETS.length; i++) {
    for (let j = i + 1; j < CORRELATION_ASSETS.length; j++) {
      const a = CORRELATION_ASSETS[i];
      const b = CORRELATION_ASSETS[j];
      if (!a || !b) continue;
      const full = rollingCorrelation(aligned[a], aligned[b], windowDays, minObs);
      // Regimes are classified on the full series first: segmenting a clipped
      // one would date the opening regime at the clip rather than at the
      // change, and the clipped pairs are exactly where that would show.
      const regimes = classifyRegimes(full, {
        threshold: regimeThreshold,
        confirmDays: regimeConfirmDays,
      });
      const deep = a === 'btc' || b === 'btc';
      const corrSeries = deep ? full : trimToLastDays(full, nonBtcKeepDays);
      const from = corrSeries[0]?.date;
      pairs.push({
        pair: `${a}-${b}` as PairId,
        a,
        b,
        // An empty series keeps no regimes: `regimes` is empty exactly when
        // `series` is, which the schema states as an invariant.
        series: corrSeries,
        regimes: from === undefined ? [] : regimes.filter((r) => r.endDate >= from),
      });
    }
  }
  return {
    schemaVersion: 2,
    fetchedAt: opts.fetchedAt,
    asOf: opts.asOf,
    windowDays,
    minObs,
    regimeThreshold,
    regimeConfirmDays,
    pairs,
  };
}
