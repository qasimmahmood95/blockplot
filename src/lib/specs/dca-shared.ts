/**
 * The DCA chart's arithmetic, with no dependency on Plot.
 *
 * Separate from `dca.ts` because the simulator needs these two on the eager
 * path — the stat tiles and the legend are drawn on load and on every
 * keystroke, without fetching a charting library — and `dca.ts` imports Plot,
 * so a static import of it would put the whole 83 KB back on the critical
 * path. That is the same trap `charts.ts` documents for the header island.
 *
 * Keeping them here is also what stops the component re-inlining `wealthExtent`
 * for want of a Plot-free import, which is exactly the duplication the spec
 * split exists to prevent.
 */

export interface WealthPoint {
  date: Date;
  wealth: number;
}

/**
 * Three years back from the last close, clamped to the start of history.
 *
 * UTC arithmetic on purpose: a 29 February rolls to 1 March rather than
 * producing an invalid date. Shared with the client so the input's value and
 * the chart the build drew cannot disagree — the drift this avoids would show
 * as a chart that redraws differently the instant anything is typed.
 */
export function defaultStartDate(firstDate: string, lastDate: string): string {
  const last = new Date(`${lastDate}T00:00:00Z`);
  const back = new Date(Date.UTC(last.getUTCFullYear() - 3, last.getUTCMonth(), last.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return back >= firstDate ? back : firstDate;
}

/** The extent of the two simulated lines, which is what sets the y domain. */
export function wealthExtent(
  dcaPoints: readonly WealthPoint[],
  lumpPoints: readonly WealthPoint[],
): [number, number] {
  // Reduce rather than spread: these arrays run to thousands of points, and
  // Math.max(...arr) has an argument-count ceiling. The domain is the
  // simulated lines' own extent — pinning it to zero would silently rescale a
  // chart that is not part of this feature.
  let lo = Infinity;
  let hi = -Infinity;
  for (const point of dcaPoints) {
    if (point.wealth < lo) lo = point.wealth;
    if (point.wealth > hi) hi = point.wealth;
  }
  for (const point of lumpPoints) {
    if (point.wealth < lo) lo = point.wealth;
    if (point.wealth > hi) hi = point.wealth;
  }
  return [lo, hi];
}
