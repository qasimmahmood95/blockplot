/** BTC against the benchmarks, every series indexed to 100 at a shared base. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { ACCENT, CYCLE_RAMP, INK_MUTED, PLOT_STYLE } from '../plot-theme';

export interface PerfPoint {
  asset: string;
  date: Date;
  index: number;
}

export type PerfScale = 'log' | 'linear';

/** Display order, which is also the legend order and the colour assignment. */
export const PERF_ASSETS = ['btc', 'eth', 'sp500', 'gold', 'dxy'] as const;

export const PERF_LABELS: Record<string, string> = {
  btc: 'BTC',
  eth: 'ETH',
  sp500: 'S&P 500',
  gold: 'gold',
  dxy: 'DXY',
};

/**
 * One colour per asset.
 *
 * BTC takes the accent, as the series every other line is here to be compared
 * against. The rest take ramp steps 0-1 and the two muted inks, and the choice
 * is constrained rather than free: the ramp deliberately includes the accent as
 * one of its own steps — `--cycle-3` in light, `--cycle-4` in dark — so a step
 * picked without checking both themes can come out identical to BTC's line. That
 * shipped once on /flows, where ETH and BTC rendered as the same hex in light
 * mode. Steps 0 and 1 are the only two that differ from the accent in both.
 */
export function perfColor(asset: string): string {
  if (asset === 'btc') return ACCENT;
  if (asset === 'eth') return CYCLE_RAMP[1];
  if (asset === 'sp500') return CYCLE_RAMP[0];
  return asset === 'gold' ? INK_MUTED : 'var(--line)';
}

/**
 * A log scale is the default, and that is a claim about the data rather than a
 * preference. Over a decade BTC's index reaches five figures while the S&P's
 * stays near 200: on a linear scale every benchmark is a flat line along the
 * bottom and the chart answers only "BTC went up a lot", which the reader knew.
 * Log makes equal vertical distances equal *ratios*, so the benchmarks have
 * shape and the comparison is legible. The toggle exists because a linear view
 * is the honest one for a short window, where ratios and differences agree.
 */
export function performanceSpec(
  points: readonly PerfPoint[],
  lineEnds: readonly PerfPoint[],
  assets: readonly string[],
  scale: PerfScale,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  const narrow = width < 500;
  return {
    width,
    height: 380,
    marginLeft: 52,
    // Room for the end-of-line labels, which is why they are dropped when the
    // chart is narrow: at 400px the labels take a quarter of the plot area and
    // overlap each other.
    marginRight: narrow ? 16 : 52,
    x: { label: null },
    y: {
      label: null,
      grid: true,
      type: scale,
      // No unit: the axis is an index, and "100" is the base date's value for
      // every series at once. The caption names the base date.
      tickFormat: (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`),
    },
    color: { domain: [...assets], range: assets.map(perfColor) },
    marks: [
      // The 100 line: where every series starts, so a line above it beat its own
      // base and a line below it did not. Cheaper to read than the axis.
      Plot.ruleY([100], { stroke: INK_MUTED, strokeDasharray: '2,3', strokeOpacity: 0.7 }),
      Plot.lineY(points, { x: 'date', y: 'index', stroke: 'asset', strokeWidth: 1.5 }),
      ...(narrow
        ? []
        : [
            Plot.text(lineEnds, {
              x: 'date',
              y: 'index',
              text: (d: PerfPoint) => PERF_LABELS[d.asset] ?? d.asset,
              fill: 'asset',
              textAnchor: 'start',
              dx: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
            }),
          ]),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
