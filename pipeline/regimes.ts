import type { CorrPoint, Regime, RegimeSegment } from './schema';

/**
 * Correlation regimes: the stretches over which a pair is meaningfully
 * co-moving, meaningfully inverse, or neither.
 *
 * A rolling correlation crossing a threshold does not make a regime. The 90d
 * curve oscillates, so a bare threshold test on BTC–S&P 500 yields dozens of
 * one-day "regimes" around every crossing — noise presented as structure. So a
 * candidate regime has to hold for CONFIRM_DAYS consecutive observations
 * before it replaces the incumbent, and the boundary is then dated at the
 * *first* of those observations, because that is when the change began, not
 * when it was confirmed. This is standard hysteresis; the cost is that the
 * final CONFIRM_DAYS − 1 observations of a series cannot yet start a regime,
 * which is the honest position — a fortnight of data cannot tell you a regime
 * has turned.
 */

/**
 * |corr| at or beyond which a pair counts as co-moving or inverse. 0.25 is a
 * deliberate middle: 0.5 would find almost nothing outside the 2020–22 macro
 * episode, and 0.1 is inside the noise band of a 60-odd observation window.
 */
export const REGIME_THRESHOLD = 0.25;

/**
 * Consecutive observations a candidate regime must hold. Roughly two trading
 * weeks — long enough to reject a single macro print, short enough that the
 * March 2020 flip is still dated to March 2020.
 */
export const REGIME_CONFIRM_DAYS = 10;

const DAY_MS = 86_400_000;

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Which regime a single correlation reading would imply on its own. */
export function regimeOf(corr: number, threshold = REGIME_THRESHOLD): Regime {
  if (corr >= threshold) return 'positive';
  if (corr <= -threshold) return 'negative';
  return 'neutral';
}

/** Inclusive calendar-day span, so a segment of one observation is 1 day. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * Split a rolling-correlation series into regime segments. The series must be
 * date-ascending, as everything the pipeline produces is.
 */
export function classifyRegimes(
  series: CorrPoint[],
  opts: { threshold?: number; confirmDays?: number } = {},
): RegimeSegment[] {
  const threshold = opts.threshold ?? REGIME_THRESHOLD;
  const confirmDays = opts.confirmDays ?? REGIME_CONFIRM_DAYS;
  const first = series[0];
  if (!first) return [];

  const segments: RegimeSegment[] = [];
  const emit = (regime: Regime, startIdx: number, endIdx: number): void => {
    const start = series[startIdx];
    const end = series[endIdx];
    if (!start || !end) return;
    let sum = 0;
    for (let i = startIdx; i <= endIdx; i++) sum += series[i]?.corr ?? 0;
    const observations = endIdx - startIdx + 1;
    segments.push({
      regime,
      startDate: start.date,
      endDate: end.date,
      observations,
      days: daysBetween(start.date, end.date),
      meanCorr: round2(sum / observations),
    });
  };

  let current = regimeOf(first.corr, threshold);
  let segmentStart = 0;
  // The candidate trying to unseat `current`, and where its run began.
  let pending: Regime | null = null;
  let pendingStart = 0;
  let pendingCount = 0;

  for (let i = 1; i < series.length; i++) {
    const point = series[i];
    if (!point) continue;
    const instant = regimeOf(point.corr, threshold);
    if (instant === current) {
      // A single reading back inside the incumbent regime breaks the run:
      // confirmation must be consecutive or it is not confirmation.
      pending = null;
      pendingCount = 0;
      continue;
    }
    if (instant === pending) {
      pendingCount += 1;
    } else {
      pending = instant;
      pendingStart = i;
      pendingCount = 1;
    }
    if (pendingCount >= confirmDays) {
      emit(current, segmentStart, pendingStart - 1);
      current = instant;
      segmentStart = pendingStart;
      pending = null;
      pendingCount = 0;
    }
  }
  emit(current, segmentStart, series.length - 1);
  return segments;
}
