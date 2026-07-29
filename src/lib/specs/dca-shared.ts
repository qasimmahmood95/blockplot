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

/** One stat tile, as both the build and the browser render it. */
export interface DcaTile {
  label: string;
  value: string;
  sub: string;
  tone: 'up' | 'down' | '';
}

export interface DcaTileInput {
  totalInvested: number;
  totalFees: number;
  buys: number;
  btcAccumulated: number;
  dcaFinal: number;
  dcaReturnPct: number;
  lumpFinal: number;
  lumpReturnPct: number;
  delta: number;
}

/**
 * The four figures beside the chart, as data rather than DOM.
 *
 * Shared for the same reason the chart specs are: the build renders these into
 * the markup and the browser re-renders them on every keystroke, and if the two
 * disagreed the page would visibly change the moment it became interactive.
 * Before this, the grid was empty in the markup and filled by script on load —
 * which pushed the chart down 204px and was the largest layout shift left on
 * the site.
 */
export function dcaTiles(
  input: DcaTileInput,
  money: (value: number) => string,
  signedPct: (value: number) => string,
): DcaTile[] {
  const deltaLabel =
    Math.abs(input.delta) < 0.005
      ? 'even with DCA'
      : `${input.delta > 0 ? 'leads' : 'trails'} by ${money(Math.abs(input.delta))}`;
  return [
    {
      label: 'Invested',
      value: money(input.totalInvested),
      sub: `${input.buys} ${input.buys === 1 ? 'buy' : 'buys'} · fees ${money(input.totalFees)}`,
      tone: '',
    },
    {
      label: 'BTC accumulated',
      value: input.btcAccumulated.toFixed(4),
      sub: 'BTC',
      tone: '',
    },
    {
      label: 'DCA value now',
      value: money(input.dcaFinal),
      sub: signedPct(input.dcaReturnPct),
      tone: input.dcaReturnPct < 0 ? 'down' : 'up',
    },
    {
      label: 'Lump sum now',
      value: money(input.lumpFinal),
      sub: `${signedPct(input.lumpReturnPct)} · ${deltaLabel}`,
      tone: input.lumpReturnPct < 0 ? 'down' : 'up',
    },
  ];
}
