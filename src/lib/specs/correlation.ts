/** Rolling correlation for one pair, with its regime bands behind it. */
import * as Plot from '@observablehq/plot';
import { crosshairMarks } from '../crosshair-marks';
import { isoDay } from '../crosshair';
import { ACCENT, INK_MUTED, NEG, PLOT_STYLE, POS } from '../plot-theme';

export type Regime = 'positive' | 'neutral' | 'negative';

export interface Segment {
  regime: Regime;
  startDate: string;
  confirmedFrom: string;
  endDate: string;
  observations: number;
  days: number;
  meanCorr: number;
}

export interface Pair {
  pair: string;
  a: string;
  b: string;
  series: { date: string; corr: number }[];
  regimes: Segment[];
}

/**
 * Display names for the toggle buttons and table captions.
 *
 * `pairLabel` falls back to the raw key for anything missing, which is a
 * reasonable default and a poor failure: ETH shipped without an entry here and
 * four of the ten buttons read "BTC – eth" and "eth – gold", lowercase, beside
 * "BTC" and "S&P 500". A missing entry is invisible in review and obvious on
 * screen.
 */
export const ASSET_LABELS: Record<string, string> = {
  btc: 'BTC',
  eth: 'ETH',
  sp500: 'S&P 500',
  gold: 'gold',
  dxy: 'DXY',
};

export const REGIME_LABELS: Record<Regime, string> = {
  positive: 'co-moving',
  neutral: 'decoupled',
  negative: 'inverse',
};

export const REGIME_ORDER: readonly Regime[] = ['positive', 'neutral', 'negative'];

export const pairLabel = (p: Pick<Pair, 'a' | 'b'>): string =>
  `${ASSET_LABELS[p.a] ?? p.a} – ${ASSET_LABELS[p.b] ?? p.b}`;

/**
 * Bands are drawn on the pos/neg tokens at low opacity so the correlation line
 * stays the figure and the regime is context behind it. Decoupled is
 * deliberately unpainted: "no regime" should not look like a third state
 * competing for attention.
 */
export const bandFill = (regime: Regime): string | null =>
  regime === 'positive' ? POS : regime === 'negative' ? NEG : null;

/**
 * Where a segment absorbed an unconfirmed opening, `startDate` reaches back
 * further than the readings the mean is taken over. Say so, or the observation
 * count and the mean cannot be reconciled.
 */
export const regimeFrom = (s: Segment): string =>
  s.confirmedFrom === s.startDate ? s.startDate : `${s.startDate} (confirmed ${s.confirmedFrom})`;

// Plot.rect treats x2 as exclusive, so a segment of one observation would be a
// zero-width rect. Extending the end by a day gives it the width of the day it
// covers; correlation dates strictly increase, so the extended edge never
// reaches the next segment's start.
const dayAfter = (date: string): Date => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);

export function correlationSpec(
  pair: Pair,
  threshold: number,
  width: number,
  interactive: boolean,
): Parameters<typeof Plot.plot>[0] {
  const points = pair.series.map((p) => ({ date: new Date(p.date), corr: p.corr }));
  // Pairs without BTC ship a window of a series classified over full history,
  // so their first regime can legitimately have begun before the window opens.
  // The table keeps that true start date — it is information, not an error —
  // but the band is clamped, or Plot widens the x domain to a date the chart
  // has no data for.
  const first = pair.series[0]?.date ?? '';
  const bands = pair.regimes
    .map((r) => ({ ...r, fill: bandFill(r.regime) }))
    .filter((r): r is Segment & { fill: string } => r.fill !== null)
    .map((r) => ({ ...r, bandStart: r.startDate < first ? first : r.startDate }));

  return {
    width,
    height: 300,
    marginLeft: 44,
    x: { label: null },
    y: { label: null, grid: true, domain: [-1, 1] },
    marks: [
      Plot.rect(bands, {
        x1: (d: Segment & { bandStart: string }) => new Date(d.bandStart),
        x2: (d: Segment) => dayAfter(d.endDate),
        y1: -1,
        y2: 1,
        fill: (d: Segment & { fill: string }) => d.fill,
        fillOpacity: 0.09,
      }),
      Plot.ruleY([0], { stroke: INK_MUTED, strokeDasharray: '2,3' }),
      Plot.ruleY([threshold, -threshold], {
        stroke: INK_MUTED,
        strokeDasharray: '1,4',
        strokeOpacity: 0.7,
      }),
      Plot.lineY(points, { x: 'date', y: 'corr', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(interactive
        ? crosshairMarks(
            points.map((d) => ({
              x: d.date,
              y: d.corr,
              // The correlation alone, as on every other single-series chart
              // here. The pressed pair button directly above the chart names
              // the pair, so repeating it in the tooltip buys nothing and costs
              // the one thing the tooltip is for: an earlier version kept the
              // pair and "S&P 500 – gol…" was all that fitted at 320px,
              // cutting off the only figure on offer.
              //
              // Not justified by the heading or the aria-label — neither
              // mentions the assets. It is the button, and only the button.
              label: d.corr.toFixed(2),
            })),
            isoDay,
            width,
          )
        : []),
    ],
    style: PLOT_STYLE,
  };
}
