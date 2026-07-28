/** Hash rate and daily transaction count — the same shape, twice. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { ACCENT, PLOT_STYLE } from '../plot-theme';

export interface NetworkPoint {
  date: Date;
  value: number;
}

export const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const NETWORK_SERIES = {
  'hashrate-chart': {
    tick: (v: number) => compact.format(v),
    tip: (v: number) => `${v.toFixed(0)} EH/s`,
  },
  'txcount-chart': {
    tick: (v: number) => compact.format(v),
    tip: (v: number) => `${compact.format(v)} tx`,
  },
} as const;

export function networkSpec(
  points: readonly NetworkPoint[],
  tickFormat: (value: number) => string,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 260,
    marginLeft: 62,
    x: { label: null },
    y: { label: null, grid: true, tickFormat },
    marks: [
      Plot.areaY(points, { x: 'date', y: 'value', fill: ACCENT, fillOpacity: 0.08 }),
      Plot.lineY(points, { x: 'date', y: 'value', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
