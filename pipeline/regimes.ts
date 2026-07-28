import { confirmSpans, leadConfirmed } from './hysteresis';
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
 *
 * The opening span is the one place confirmation has nothing to work with;
 * see the note at the end of classifyRegimes for how it is handled.
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

  // Collected as index spans, then materialised: the leading span needs
  // adjusting once the rest are known (see below), which is fiddly to do
  // against already-formatted dates.
  // `confirmedIdx` is where the regime itself was confirmed; `startIdx` can be
  // pulled earlier by absorption. meanCorr is taken from the former, so an
  // absorbed opening cannot drag a row's average across the threshold away
  // from its own label. It does not make label and mean agree in general, and
  // should not: a hysteretic regime is a state that persists until something
  // unseats it, not a restatement of its own average. A confirmed regime whose
  // later readings drift is still that regime — that is the whole point of
  // confirming it.
  //
  // The run-length machine itself is `pipeline/hysteresis.ts`, shared with the
  // volatility and drawdown bands, which flap just as badly on a bare
  // threshold. Everything below is what is specific to correlations.
  const stateOf = (point: CorrPoint): Regime => regimeOf(point.corr, threshold);
  const spans = confirmSpans(series, stateOf, confirmDays).map((span) => ({
    regime: span.state,
    startIdx: span.startIdx,
    confirmedIdx: span.confirmedIdx,
    endIdx: span.endIdx,
  }));

  /*
   * The opening regime is the one case confirmation cannot reach: at the first
   * reading there is no history to confirm against, so it was being taken from
   * that single reading — which reintroduces exactly the one-day regime the
   * hysteresis exists to prevent (a series opening 0.26 then sitting inside
   * the band produced a one-day "co-moving" segment).
   *
   * Every interior span is confirmed by construction: it opens at the first of
   * the confirmDays readings that confirmed it, and the next switch needs
   * confirmDays further readings after those. Only the leading span can be
   * unconfirmed, and an unconfirmed opening is not a regime change at all — it
   * is where the data starts. Absorbing it into the span that follows says the
   * honest thing: by the time this series begins, that was already the regime.
   */
  const lead = spans[0];
  const next = spans[1];
  if (lead && !leadConfirmed(series, { ...lead, state: lead.regime }, stateOf, confirmDays)) {
    if (next) {
      next.startIdx = lead.startIdx;
      spans.shift();
    } else {
      // Nothing to absorb into: the whole series never confirmed a regime.
      // Its first reading is not evidence of one, so label it by its mean —
      // the only summary available, and the only one that cannot contradict
      // the meanCorr printed beside it.
      let sum = 0;
      for (let i = lead.startIdx; i <= lead.endIdx; i++) sum += series[i]?.corr ?? 0;
      lead.regime = regimeOf(sum / (lead.endIdx - lead.startIdx + 1), threshold);
    }
  }

  return spans.map(({ regime, startIdx, confirmedIdx, endIdx }) => {
    const start = series[startIdx] as CorrPoint;
    const end = series[endIdx] as CorrPoint;
    let sum = 0;
    for (let i = confirmedIdx; i <= endIdx; i++) sum += series[i]?.corr ?? 0;
    return {
      regime,
      startDate: start.date,
      confirmedFrom: (series[confirmedIdx] as CorrPoint).date,
      endDate: end.date,
      observations: endIdx - startIdx + 1,
      days: daysBetween(start.date, end.date),
      meanCorr: round2(sum / (endIdx - confirmedIdx + 1)),
    };
  });
}
