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
): { baseDate: string; series: RebasedSeries[] } | null {
  // No series is not "an empty chart", it is no comparison. Returning a
  // well-formed result with zero lines would hand the caller something that
  // renders as an axis with nothing on it.
  if (inputs.length === 0) return null;
  const firsts: string[] = [];
  for (const input of inputs) {
    const first = input.rows.find((r) => r.date >= startDate);
    // One series with no data in the window makes the *comparison* impossible,
    // not just that line: a common base has to exist for every line or the
    // lines are not comparable, which is the only reason to draw them together.
    if (!first) return null;
    firsts.push(first.date);
  }
  const baseDate = firsts.reduce((max, d) => (d > max ? d : max), firsts[0] ?? startDate);
  const series: RebasedSeries[] = [];
  for (const input of inputs) {
    const one = rebase(input, baseDate);
    if (!one) return null;
    series.push(one);
  }
  return { baseDate, series };
}

/**
 * Total return over the rebased window, %, 2 dp.
 *
 * Derived from the index rather than recomputed from prices, so the figure in
 * a stat tile and the height of the line at the right-hand edge cannot
 * disagree — they are the same number.
 */
export const totalReturnPct = (series: RebasedSeries): number => round2(series.finalIndex - 100);
