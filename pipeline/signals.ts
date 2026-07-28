import { confirmSpans, leadConfirmed } from './hysteresis';
import type { CyclePoint, DailyPrice, DominancePoint, DrawdownPoint, VolPoint } from './schema';

/**
 * Daily signal states: the four or five things worth knowing about today
 * without reading five charts.
 *
 * Every signal here is a *state*, not an event, and states are hysteretic —
 * see `pipeline/hysteresis.ts` for why a bare threshold test is unusable on
 * this data. What that buys, concretely — as of writing, and the figures move
 * every six hours: the 90d volatility reading sat a fraction under the 35%
 * band edge. A raw test called that "low since the 20th"; a fractional move
 * the following week calls it normal again, and the page contradicts itself
 * for the rest of the month. The confirmed answer was "normal since
 * 2026-04-30, with a low reading pending" — stable, and more informative.
 *
 * So every band signal reports the unconfirmed candidate alongside the state.
 * Suppressing it would be the opposite mistake: the reader would see "normal"
 * with no hint that it has been on the edge for over a week.
 */

/** Bands for annualised realised volatility, in percent. */
export const VOL_LOW_PCT = 35;
export const VOL_HIGH_PCT = 60;

/**
 * Rolling window the volatility signal reads. 90d over 30d because the shorter
 * window crosses these bands on single-week moves; over 365d because a year of
 * lag is not a signal.
 */
export const VOL_WINDOW_DAYS = 90;

/**
 * Drawdown bands from the running peak, in percent. Deepest reached wins, so
 * the state is "how bad has it got" rather than a per-day reading.
 */
export const DRAWDOWN_BANDS_PCT = [-10, -20, -30, -50] as const;

/**
 * Consecutive observations a candidate must hold. Ten, matching the correlation
 * regimes, and for the same reason: about two trading weeks is long enough to
 * reject a single macro print and short enough that a real turn is still dated
 * to the fortnight it happened in.
 */
export const SIGNAL_CONFIRM_DAYS = 10;

/**
 * Observations the dominance series needs before it can carry a signal.
 *
 * Its source has no history endpoint, so `data/dominance.json` accretes one
 * point per pipeline run and started from nothing. At the time of writing it
 * holds three. A signal computed over three points is not a signal, so the rule
 * ships behind this guard and the page renders what it has — which means
 * dominance simply appears, on its own, once a month of history exists. An
 * absent signal with a stated reason beats a fabricated one, and beats dropping
 * a signal the plan named because today's data is thin.
 */
export const MIN_DOMINANCE_OBS = 30;

export type VolBand = 'low' | 'normal' | 'high';

/**
 * How many spans a bare threshold test would produce — the number hysteresis
 * exists to reduce, and the one the page quotes to justify itself.
 *
 * Derived rather than written down. The first version of the panel hardcoded
 * "9" and "42": both were run counts described as *change* counts, so both
 * were off by one, and the literal was rendered identically on the GBP page
 * where the volatility figure is 5 rather than 9. A number a page asserts
 * about its own data has to be computed from that data.
 */
export function rawSpanCount<T, S extends string>(
  series: readonly T[],
  stateOf: (item: T) => S,
): number {
  let spans = 0;
  let previous: S | null = null;
  for (const item of series) {
    const state = stateOf(item);
    if (state !== previous) spans += 1;
    previous = state;
  }
  return spans;
}

/** Raw span counts for the two band signals, for the page's own methodology note. */
export function rawSpanCounts(
  volSeries: readonly VolPoint[],
  drawdownSeries: readonly DrawdownPoint[],
  opts: { low?: number; high?: number; bands?: readonly number[] } = {},
): { vol: number; drawdown: number } {
  return {
    vol: rawSpanCount(volSeries, (p) => volBand(p.volPct, opts.low ?? VOL_LOW_PCT, opts.high ?? VOL_HIGH_PCT)),
    drawdown: rawSpanCount(drawdownSeries, (p) => drawdownBand(p.drawdownPct, opts.bands ?? DRAWDOWN_BANDS_PCT)),
  };
}

/** A confirmed state, and the candidate queueing up behind it. */
export interface BandSignal<S extends string> {
  /** The confirmed state as of the last observation. */
  state: S;
  /** Date the confirmed span began — the first of its confirming readings. */
  since: string;
  /** Observations the confirmed span spans, inclusive. */
  observations: number;
  /**
   * A run of readings that disagree with `state` but has not yet reached
   * `confirmDays`. Null when the latest reading agrees with the state.
   */
  pending: { state: S; since: string; observations: number } | null;
  /** Every confirmed transition, oldest first. Drives the feed. */
  history: { state: S; since: string; observations: number }[];
}

/** Which volatility band a single reading falls in. */
export function volBand(
  volPct: number,
  low = VOL_LOW_PCT,
  high = VOL_HIGH_PCT,
): VolBand {
  if (volPct < low) return 'low';
  if (volPct > high) return 'high';
  return 'normal';
}

/**
 * Deepest drawdown band a reading has reached, as a string key.
 *
 * A string rather than a number because it is a discrete state and the feed
 * prints it; `'0'` is "no band reached", not zero drawdown.
 */
export function drawdownBand(
  drawdownPct: number,
  bands: readonly number[] = DRAWDOWN_BANDS_PCT,
): string {
  let deepest = 0;
  for (const band of bands) if (drawdownPct <= band && band < deepest) deepest = band;
  return String(deepest);
}

/**
 * Turn a per-observation classification into a confirmed signal.
 *
 * The unconfirmed tail is computed here rather than by `confirmSpans`, which
 * deliberately knows nothing about "pending": it is a property of where the
 * series happens to stop, not of the segmentation.
 */
function bandSignal<T, S extends string>(
  series: readonly T[],
  dateOf: (item: T) => string,
  stateOf: (item: T) => S,
  confirmDays: number,
): BandSignal<S> | null {
  if (series.length === 0) return null;
  const spans = confirmSpans(series, stateOf, confirmDays);
  const lead = spans[0];
  const next = spans[1];
  // An opening span seeded from one reading is not a confirmed state. Absorb it
  // into what follows — by the time this series starts, that was already the
  // state — exactly as the correlation regimes do.
  if (lead && !leadConfirmed(series, lead, stateOf, confirmDays)) {
    if (next) {
      next.startIdx = lead.startIdx;
      spans.shift();
    } else {
      // Nothing to absorb into: no state ever held for confirmDays anywhere in
      // this series, so there is no confirmed state to report. Returning the
      // lead would publish index 0's reading as a state — the exact artefact
      // the hysteresis exists to prevent, and with `pending: null` implying
      // nothing was queued behind it. The caller renders a signal it has, and
      // omits one it does not.
      return null;
    }
  }
  const last = spans[spans.length - 1];
  if (!last) return null;

  // How long the latest disagreeing run has been going, if any.
  let pending: BandSignal<S>['pending'] = null;
  const lastItem = series[series.length - 1] as T;
  const latest = stateOf(lastItem);
  if (latest !== last.state) {
    let i = series.length - 1;
    while (i > 0) {
      const prev = series[i - 1];
      if (prev === undefined || stateOf(prev) !== latest) break;
      i -= 1;
    }
    pending = {
      state: latest,
      since: dateOf(series[i] as T),
      observations: series.length - i,
    };
  }

  return {
    state: last.state,
    since: dateOf(series[last.startIdx] as T),
    observations: last.endIdx - last.startIdx + 1,
    pending,
    history: spans.map((span) => ({
      state: span.state,
      since: dateOf(series[span.startIdx] as T),
      observations: span.endIdx - span.startIdx + 1,
    })),
  };
}

/** Confirmed volatility band, from a rolling-vol series. */
export function volSignal(
  series: readonly VolPoint[],
  opts: { low?: number; high?: number; confirmDays?: number } = {},
): BandSignal<VolBand> | null {
  const low = opts.low ?? VOL_LOW_PCT;
  const high = opts.high ?? VOL_HIGH_PCT;
  if (!(low < high)) throw new Error('volSignal: low band must be below high');
  return bandSignal(
    series,
    (p) => p.date,
    (p) => volBand(p.volPct, low, high),
    opts.confirmDays ?? SIGNAL_CONFIRM_DAYS,
  );
}

/** Confirmed drawdown band, from a drawdown series. */
export function drawdownSignal(
  series: readonly DrawdownPoint[],
  opts: { bands?: readonly number[]; confirmDays?: number } = {},
): BandSignal<string> | null {
  return bandSignal(
    series,
    (p) => p.date,
    (p) => drawdownBand(p.drawdownPct, opts.bands ?? DRAWDOWN_BANDS_PCT),
    opts.confirmDays ?? SIGNAL_CONFIRM_DAYS,
  );
}

const DAY_MS = 86_400_000;

export interface AthSignal {
  date: string;
  price: number;
  latestDate: string;
  latestPrice: number;
  /** Percent below the peak; 0 on the day a new peak is set. */
  fromAthPct: number;
  daysSince: number;
  /** True when the latest close *is* the running maximum. */
  isNew: boolean;
}

/**
 * All-time high, and how far below it today sits.
 *
 * No hysteresis: a new ATH is a fact about one number, not a classification
 * that can flap. Ties count as a new high — a close that equals the peak has
 * not failed to reach it.
 */
export function athSignal(history: readonly DailyPrice[]): AthSignal | null {
  const latest = history[history.length - 1];
  if (!latest) return null;
  let peak = history[0] as DailyPrice;
  for (const point of history) if (point.price >= peak.price) peak = point;
  const round2 = (v: number): number => {
    const r = Math.round(v * 100) / 100;
    return r === 0 ? 0 : r;
  };
  return {
    date: peak.date,
    price: peak.price,
    latestDate: latest.date,
    latestPrice: latest.price,
    fromAthPct: round2((latest.price / peak.price - 1) * 100),
    daysSince: Math.round(
      (Date.parse(`${latest.date}T00:00:00Z`) - Date.parse(`${peak.date}T00:00:00Z`)) / DAY_MS,
    ),
    isNew: latest.price >= peak.price,
  };
}

export interface CycleHighSignal {
  /** Multiple of the halving-day close at the cycle's peak so far. */
  peakMultiple: number;
  peakDay: number;
  latestMultiple: number;
  latestDay: number;
  isNew: boolean;
}

/**
 * Whether the running halving cycle is at its own high.
 *
 * Deliberately about the current cycle only. "Higher than any point in this
 * cycle" is a statement the data supports; comparing across cycles is what the
 * overlay chart is for.
 */
export function cycleHighSignal(series: readonly CyclePoint[]): CycleHighSignal | null {
  const latest = series[series.length - 1];
  if (!latest) return null;
  let peak = series[0] as CyclePoint;
  for (const point of series) if (point.multiple >= peak.multiple) peak = point;
  return {
    peakMultiple: peak.multiple,
    peakDay: peak.day,
    latestMultiple: latest.multiple,
    latestDay: latest.day,
    isNew: latest.multiple >= peak.multiple,
  };
}

export interface DominanceSignal {
  latestPct: number;
  latestDate: string;
  /** Change over the comparison window, in percentage points. */
  changePp: number;
  overDays: number;
  fromDate: string;
}

/**
 * BTC dominance move over a window, or null when there is not enough history.
 *
 * Returns null rather than throwing or improvising: the caller renders what it
 * gets, so a thin series omits the signal instead of publishing one computed
 * over three points. See `MIN_DOMINANCE_OBS`.
 */
export function dominanceSignal(
  series: readonly DominancePoint[],
  opts: { overDays?: number; minObs?: number } = {},
): DominanceSignal | null {
  const overDays = opts.overDays ?? 30;
  const minObs = opts.minObs ?? MIN_DOMINANCE_OBS;
  if (series.length < minObs || series.length <= overDays) return null;
  const latest = series[series.length - 1] as DominancePoint;
  const from = series[series.length - 1 - overDays] as DominancePoint;
  const change = latest.btcDominancePct - from.btcDominancePct;
  return {
    latestPct: latest.btcDominancePct,
    latestDate: latest.date,
    changePp: Math.round(change * 100) / 100,
    overDays,
    fromDate: from.date,
  };
}
