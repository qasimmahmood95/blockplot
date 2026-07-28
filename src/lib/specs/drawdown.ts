/** Drawdown from the running peak. See `specs/price.ts` for why this is shared. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { LINE, NEG, PLOT_STYLE } from '../plot-theme';

export interface DrawdownPoint {
  date: Date;
  drawdownPct: number;
}

export function drawdownSpec(
  points: readonly DrawdownPoint[],
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 260,
    marginLeft: 48,
    x: { label: null },
    y: { label: null, grid: true, tickFormat: (value: number) => `${value}%` },
    marks: [
      Plot.areaY(points, { x: 'date', y: 'drawdownPct', fill: NEG, fillOpacity: 0.12 }),
      Plot.lineY(points, { x: 'date', y: 'drawdownPct', stroke: NEG, strokeWidth: 1.5 }),
      Plot.ruleY([0], { stroke: LINE }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
