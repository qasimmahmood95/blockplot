import type { CorrelationDataset, CorrPoint, PairId } from './schema';
import type { SeriesPoint } from './risk';

/** Fixed asset order for pair enumeration and the matrix display. */
export const CORRELATION_ASSETS = ['btc', 'sp500', 'gold', 'dxy'] as const;

/** Rolling correlation window (calendar days) and the minimum aligned returns it must hold. */
export const CORRELATION_WINDOW_DAYS = 90;
export const CORRELATION_MIN_OBS = 40;

const DAY_MS = 86_400_000;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function dateMinusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
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
 * multi-day return, dated at its end).
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
  for (let i = 0; i < aligned.length; i++) {
    const end = aligned[i];
    if (!end) continue;
    const cutoff = dateMinusDays(end.date, windowDays);
    const window = aligned.filter((r, j) => j <= i && r.date > cutoff);
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
 * list, rolling correlation clipped to dates >= displayFrom.
 */
export function buildCorrelationDataset(
  series: Record<(typeof CORRELATION_ASSETS)[number], SeriesPoint[]>,
  opts: {
    fetchedAt: string;
    asOf: string;
    displayFrom: string;
    windowDays?: number;
    minObs?: number;
  },
): CorrelationDataset {
  const windowDays = opts.windowDays ?? CORRELATION_WINDOW_DAYS;
  const minObs = opts.minObs ?? CORRELATION_MIN_OBS;
  const pairs: CorrelationDataset['pairs'] = [];
  for (let i = 0; i < CORRELATION_ASSETS.length; i++) {
    for (let j = i + 1; j < CORRELATION_ASSETS.length; j++) {
      const a = CORRELATION_ASSETS[i];
      const b = CORRELATION_ASSETS[j];
      if (!a || !b) continue;
      pairs.push({
        pair: `${a}-${b}` as PairId,
        a,
        b,
        series: rollingCorrelation(series[a], series[b], windowDays, minObs).filter(
          (p) => p.date >= opts.displayFrom,
        ),
      });
    }
  }
  return {
    schemaVersion: 1,
    fetchedAt: opts.fetchedAt,
    asOf: opts.asOf,
    windowDays,
    minObs,
    pairs,
  };
}
