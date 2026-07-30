/** BTC against the benchmarks, every series indexed to 100 at a shared base. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { PLOT_STYLE } from '../plot-theme';

export interface PerfPoint {
  asset: string;
  date: Date;
  index: number;
}

export type PerfScale = 'log' | 'linear';

/**
 * Labels and colours re-exported from the Plot-free module, so there is one
 * definition rather than two.
 *
 * They were declared here *and* in `perf-shared.ts` — this copy driving the SSR
 * legend and the end-of-line labels, that one the client legend, the stat tiles
 * and the crosshair. Identical, with nothing asserting it, which is the drift
 * class CLAUDE.md's spec rule exists to prevent and which would have surfaced as
 * the legend changing under the reader's cursor. The Plot-free module owns them,
 * because the island needs them on the eager path and this file imports Plot.
 */
export { PERF_ASSETS, PERF_LABELS, perfColor, perfDash } from '../perf-shared';
import { PERF_LABELS, perfColor, perfDash } from '../perf-shared';

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
      // One decimal above 1000. `toFixed(0)` labelled 1000, 1200 and 1400 all
      // as "1k" and 1600 as "2k" — three ticks with one label and a 25%
      // misstatement — which only shows up on the deepest range in linear.
      tickFormat: (value: number) =>
        value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`,
    },
    color: { domain: [...assets], range: assets.map(perfColor) },
    marks: [
      // No reference rule at 100. One was drawn in --ink-muted dashed, which is
      // gold's colour and DXY's dash — three marks sharing two attributes, where
      // the axis already carries gridlines and the caption already says what 100
      // is. Removing it costs nothing and removes the collision.
      // Two marks rather than one, because `strokeDasharray` is a constant in
      // Plot's options and not a channel. Dashed per asset rather than per
      // colour: DXY is the only line here that is not an investable asset, and
      // it needed distinguishing from gold without a fifth colour that clears
      // 3:1 in both themes.
      Plot.lineY(
        points.filter((d) => !perfDash(d.asset)),
        { x: 'date', y: 'index', stroke: 'asset', strokeWidth: 1.5 },
      ),
      Plot.lineY(
        points.filter((d) => perfDash(d.asset)),
        { x: 'date', y: 'index', stroke: 'asset', strokeWidth: 1.5, strokeDasharray: '6,3' },
      ),
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
