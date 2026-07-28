/**
 * The holdings value line.
 *
 * The one chart on the site with no server-rendered form, and it is not an
 * oversight: its only input is the reader's own BTC amount, held in
 * localStorage. The build cannot know it, and CLAUDE.md's rule is that it must
 * never leave the browser to be known. So this chart is drawn client-side —
 * but only once there is an amount to draw, which means a reader who has
 * entered nothing still never downloads Plot.
 */
import * as Plot from '@observablehq/plot';
import { crosshairMarks } from '../crosshair-marks';
import { isoDay } from '../crosshair';
import { ACCENT, PLOT_STYLE } from '../plot-theme';

export interface HoldingsPoint {
  date: Date;
  value: number;
}

export function holdingsSpec(
  points: readonly HoldingsPoint[],
  width: number,
  axisMoney: (value: number) => string,
  tipMoney: (value: number) => string,
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 300,
    marginLeft: 70,
    x: { label: null },
    y: { label: null, grid: true, type: 'log', tickFormat: axisMoney },
    marks: [
      Plot.lineY(points, { x: 'date', y: 'value', stroke: ACCENT, strokeWidth: 1.5 }),
      ...crosshairMarks(
        points.map((d) => ({ x: d.date, y: d.value, label: tipMoney(d.value) })),
        isoDay,
        width,
      ),
    ],
    style: PLOT_STYLE,
  };
}
