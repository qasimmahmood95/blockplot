/** The two flows charts: stablecoin supply and BTC dominance. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { ACCENT, PLOT_STYLE } from '../plot-theme';

export interface StablecoinPoint {
  date: Date;
  totalUsd: number;
}

export interface DominancePoint {
  date: Date;
  pct: number;
}

/** Shared by the axis and the tooltip so both round the same way. */
export const billions = (v: number): string =>
  v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(0)}B`;

export function stablecoinSpec(
  points: readonly StablecoinPoint[],
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 300,
    marginLeft: 56,
    x: { label: null },
    y: { label: null, grid: true, zero: true, tickFormat: billions },
    marks: [
      Plot.areaY(points, { x: 'date', y: 'totalUsd', fill: ACCENT, fillOpacity: 0.1 }),
      Plot.lineY(points, { x: 'date', y: 'totalUsd', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}

export function dominanceSpec(
  points: readonly DominancePoint[],
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 240,
    marginLeft: 48,
    x: { label: null },
    y: { label: null, grid: true, tickFormat: (value: number) => `${value}%` },
    marks: [
      // Dots keep a young accreted series visible before the line forms.
      Plot.dot(points, { x: 'date', y: 'pct', fill: ACCENT, r: 2 }),
      Plot.lineY(points, { x: 'date', y: 'pct', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
