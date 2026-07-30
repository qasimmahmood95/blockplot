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
import { realColor, realDash, REAL_LINES } from '../real-shared';

/**
 * No end-of-line labels, unlike `/performance`, and not for room.
 *
 * The two lines meet *exactly* at the right-hand edge, by construction: the base
 * month is the deflator's last published month and both series end inside it, so
 * `real(asOf) === nominal(asOf)` to the last digit — the committed files' final
 * rows are `60136.2 / 60136.2` and `45485.4 / 45485.4`. Two labels at identical
 * coordinates are one illegible smudge, at every range and both scales, and the
 * first version shipped exactly that with a comment claiming they only overlapped
 * when narrow. The legend names both lines and the crosshair reads both values,
 * so nothing is lost by dropping them.
 */
export function realReturnsSpec(
  points: readonly RealChartPoint[],
  tickFormat: (value: number) => string,
  scale: RealScale,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  const lines = REAL_LINES.filter((line) => points.some((p) => p.line === line));
  return {
    width,
    height: 380,
    // Wider than the other charts' 52: these ticks are money, and at max range
    // they read $100k where an index reads 100.
    marginLeft: 66,
    marginRight: 16,
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
        {
          x: 'date',
          y: 'value',
          stroke: 'line',
          strokeWidth: 1.5,
          // The one definition of the pattern, so the chart, the legend swatch
          // and the contrast argument that justifies it cannot drift apart.
          strokeDasharray: realDash('real'),
        },
      ),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
