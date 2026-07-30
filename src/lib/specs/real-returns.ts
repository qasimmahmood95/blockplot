/** BTC's price twice: as it was quoted, and restated in one month's money. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { PLOT_STYLE } from '../plot-theme';

export interface RealChartPoint {
  line: string;
  date: Date;
  value: number;
}

export type RealScale = 'log' | 'linear';

/**
 * Labels and colours re-exported from the Plot-free module so there is one
 * definition rather than two — the drift class CLAUDE.md's spec rule exists to
 * prevent, and one this repo has already produced once by declaring the
 * performance labels in both places.
 */
export { REAL_LABELS, REAL_LINES, realColor, realDash } from '../real-shared';
import { REAL_LABELS, realColor, realDash, REAL_LINES } from '../real-shared';

export function realReturnsSpec(
  points: readonly RealChartPoint[],
  lineEnds: readonly RealChartPoint[],
  tickFormat: (value: number) => string,
  scale: RealScale,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  const narrow = width < 500;
  const lines = REAL_LINES.filter((line) => points.some((p) => p.line === line));
  return {
    width,
    height: 380,
    // Wider than the other charts' 52: these ticks are money, and at max range
    // they read $100k where an index reads 100.
    marginLeft: 66,
    // Room for the end-of-line labels, dropped when narrow — at 400px they take
    // a quarter of the plot area and overlap each other.
    marginRight: narrow ? 16 : 62,
    x: { label: null },
    y: { label: null, grid: true, type: scale, tickFormat },
    color: { domain: [...lines], range: lines.map(realColor) },
    marks: [
      // Two marks rather than one, because `strokeDasharray` is a constant in
      // Plot's options and not a channel — the same split `performance.ts`
      // carries, for the same reason.
      Plot.lineY(
        points.filter((d) => !realDash(d.line)),
        { x: 'date', y: 'value', stroke: 'line', strokeWidth: 1.5 },
      ),
      Plot.lineY(
        points.filter((d) => realDash(d.line)),
        { x: 'date', y: 'value', stroke: 'line', strokeWidth: 1.5, strokeDasharray: '5,3' },
      ),
      ...(narrow
        ? []
        : [
            Plot.text(lineEnds, {
              x: 'date',
              y: 'value',
              text: (d: RealChartPoint) => REAL_LABELS[d.line] ?? d.line,
              fill: 'line',
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
