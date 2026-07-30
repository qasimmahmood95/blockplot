/**
 * Index every series to 100 at a chosen start, so they can be compared.
 *
 * The site has committed daily S&P 500, gold, DXY and (since M17) ETH series
 * for as long as it has existed, and has never drawn any of them. It computes
 * how BTC *co-moves* with them, on `/correlation`, and has never shown how it
 * *performed* against them. Rebasing is the whole of what that needs: divide
 * each series by its own value at the start and multiply by 100, and the lines
 * become directly readable against each other whatever their units — an index,
 * an ounce price, a dollar index and two coins.
 *
 * The arithmetic is trivial. What is not trivial, and is the reason this is a
 * tested pure function rather than three lines in a component, is which day
 * counts as the start for each series.
 */

import { isoWeekKey, isoWeekStart } from './series';

/** One point of a rebased series: 100 at the base date. */
export interface RebasePoint {
  date: string;
  index: number;
}

export interface RebasedSeries {
  asset: string;
  /** The day this series was actually indexed at — see `rebaseAll`. */
  baseDate: string;
  /** The raw value at `baseDate`, kept so the page can show what 100 means. */
  baseValue: number;
  /** Index at the last point, i.e. the whole-window total return plus 100. */
  finalIndex: number;
  series: RebasePoint[];
}

/** What `rebaseAll` returns: the series, and how honestly one date describes them. */
export interface RebaseResult {
  /** True when every series is indexed on the same calendar day. */
  aligned: boolean;
  /** The ISO week every series is indexed within. */
  baseWeek: string;
  /** Monday of `baseWeek`, the label to use when the days differ. */
  baseWeekStart: string;
  /** The single base date when `aligned`, otherwise the latest of them. */
  baseDate: string;
  series: RebasedSeries[];
}

export interface AssetSeries {
  asset: string;
  /** Ascending by date, one value per day the asset traded. */
  rows: readonly { date: string; value: number }[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Rebase one series from the first observation on or after `startDate`.
 *
 * Null when the series has nothing in the window, or when its base value is
 * not positive — an index is a ratio, and dividing by zero or a negative price
 * yields a number that would plot without meaning anything.
 */
export function rebase(input: AssetSeries, startDate: string): RebasedSeries | null {
  const from = input.rows.findIndex((r) => r.date >= startDate);
  if (from === -1) return null;
  const base = input.rows[from];
  if (!base || !(base.value > 0)) return null;
  const series = input.rows.slice(from).map((r) => ({
    date: r.date,
    index: round2((r.value / base.value) * 100),
  }));
  const final = series.at(-1);
  return {
    asset: input.asset,
    baseDate: base.date,
    baseValue: base.value,
    finalIndex: final?.index ?? 100,
    series,
  };
}

/**
 * Rebase several series onto a common base date.
 *
 * The subtlety this exists for: BTC and ETH trade every day, the S&P 500 and
 * gold do not. Asked to start on a Saturday, BTC would index at that Saturday
 * and the S&P at the following Monday — two days of divergence baked into the
 * comparison before it starts, permanently, because every later point is
 * measured against those bases. On a weekend at the start of a sharp move that
 * is not a rounding difference; it is the chart answering a slightly different
 * question for each line.
 *
 * So the base is the *latest* of the per-series first-available dates: the
 * first day on which every series has a price. Each series is then indexed at
 * its own value on that day, or the first it has after it — which for a
 * benchmark that was closed on the chosen base day is the next session, and
 * `baseDate` records it, so a caller can say so rather than implying otherwise.
 *
 * Returns the shared base alongside the series, because the page needs to name
 * it: a chart captioned with the date the reader picked, when the data starts
 * two days later, is a small lie that compounds with every figure read off it.
 */
export function rebaseAll(
  inputs: readonly AssetSeries[],
  startDate: string,
): RebaseResult | null {
  // No series is not "an empty chart", it is no comparison. Returning a
  // well-formed result with zero lines would hand the caller something that
  // renders as an axis with nothing on it.
  if (inputs.length === 0) return null;

  const firsts: { input: AssetSeries; date: string }[] = [];
  for (const input of inputs) {
    const first = input.rows.find((r) => r.date >= startDate);
    // One series with no data in the window makes the *comparison* impossible,
    // not just that line: a common base has to exist for every line or the
    // lines are not comparable, which is the only reason to draw them together.
    if (!first) return null;
    firsts.push({ input, date: first.date });
  }

  // `target` is the old rule: the latest of the per-series first-available
  // dates, i.e. the first day on which every series that shares a calendar has
  // a price. In the daily section of the history that is exactly right, and it
  // is what this returns.
  const target = firsts.reduce((max, f) => (f.date > max ? f.date : max), firsts[0]?.date ?? startDate);
  const targetWeek = isoWeekKey(target);

  // Where it is wrong is the weekly section, and the correction is what this
  // function now turns on. Thinning keeps each week's last close, and BTC and
  // ETH trade seven days where the S&P, gold and DXY trade five — so the crypto
  // legs land on Sundays and the market legs on Fridays, and their date sets
  // there are all but disjoint: 1 shared date in 418 weeks for BTC and the S&P,
  // none at all for BTC and gold.
  //
  // Taking the max then made things worse rather than safer. For a start falling
  // Monday to Friday it picked BTC's Sunday, and a Friday series had no point
  // until the *following* Friday — a five-day, cross-week offset, where leaving
  // each series on its own nearest point would have been two days inside one
  // week. Measured on the shipped 5y default, that put 6.78 percentage points
  // into gold's headline return and made the caption "100 = each series on
  // 2021-08-01" false for three of five lines: a Sunday the S&P has never traded.
  //
  // So a series whose next point after `target` would fall in a later ISO week
  // bases on its own last point *within* target's week instead. Every line then
  // starts within one week of every other, and none is pushed past it.
  const series: RebasedSeries[] = [];
  for (const { input } of firsts) {
    const next = input.rows.find((r) => r.date >= target);
    const base =
      next && isoWeekKey(next.date) === targetWeek
        ? next.date
        : (input.rows.filter((r) => r.date >= startDate && isoWeekKey(r.date) === targetWeek).at(-1)
            ?.date ?? next?.date);
    if (!base) return null;
    const one = rebase(input, base);
    if (!one) return null;
    series.push(one);
  }

  const bases = series.map((s) => s.baseDate);
  const aligned = new Set(bases).size === 1;
  return {
    aligned,
    baseWeek: targetWeek,
    baseWeekStart: isoWeekStart(bases[0] ?? startDate),
    // The latest of them when they differ, so a caller that wants one date gets
    // the conservative one; `aligned` says whether quoting it is honest.
    baseDate: bases.reduce((max, d) => (d > max ? d : max), bases[0] ?? startDate),
    series,
  };
}

/**
 * Total return over the rebased window, %, 2 dp.
 *
 * Derived from the index rather than recomputed from prices, so the figure in
 * a stat tile and the height of the line at the right-hand edge cannot
 * disagree — they are the same number.
 */
export const totalReturnPct = (series: RebasedSeries): number => round2(series.finalIndex - 100);

/**
 * Rebase only the series that actually reach back to the chosen start, and name
 * the ones that do not.
 *
 * `rebaseAll` insists on a base every series shares, which is right for
 * comparability and wrong as the only option here: BTC's history starts in 2010,
 * the benchmarks in 2016 (FRED publishes the S&P as a rolling decade) and ETH in
 * 2017. Under a shared base, a reader asking for 2012 would silently get a chart
 * beginning in November 2017, because ETH exists and has points after 2012 — the
 * youngest series would decide the question for every other line.
 *
 * A series *covers* a start date when its own history begins at or before it.
 * Those are rebased on a common base as usual; the rest are excluded and
 * returned by name, so the page can say "ETH and gold begin later and are not
 * shown" instead of quietly drawing three lines where the legend implies five.
 * Dropping a line silently is the failure this returns data to avoid.
 */
export function rebaseCovering(
  inputs: readonly AssetSeries[],
  startDate: string,
): (RebaseResult & { excluded: string[] }) | null {
  const covered: AssetSeries[] = [];
  const excluded: string[] = [];
  for (const input of inputs) {
    const first = input.rows[0];
    if (first && first.date <= startDate) covered.push(input);
    else excluded.push(input.asset);
  }
  const out = rebaseAll(covered, startDate);
  return out ? { ...out, excluded } : null;
}

/** The earliest start at which at least `min` of the series have history. */
export function earliestStartFor(inputs: readonly AssetSeries[], min: number): string | null {
  const firsts = inputs
    .map((i) => i.rows[0]?.date)
    .filter((d): d is string => d !== undefined)
    .sort();
  // The min-th earliest first-date: from that day forward, `min` series exist.
  return firsts[min - 1] ?? null;
}
