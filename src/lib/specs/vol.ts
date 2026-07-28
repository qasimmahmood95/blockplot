/** Rolling realised volatility, one line per window. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { INK, PLOT_STYLE } from '../plot-theme';

export interface VolPoint {
  window: string;
  date: Date;
  volPct: number;
}

/**
 * Shorter window, lighter accent step — the same validated ramp the cycles
 * chart uses. Shared with the legend so the swatch and the line cannot drift.
 */
const RAMP: Record<string, string> = {
  '30d': 'var(--cycle-2)',
  '90d': 'var(--cycle-3)',
  '365d': 'var(--cycle-4)',
};

export const volColor = (window: string): string => RAMP[window] ?? INK;

export function volSpec(
  points: readonly VolPoint[],
  lineEnds: readonly VolPoint[],
  domain: readonly string[],
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 300,
    marginLeft: 48,
    marginRight: 44,
    x: { label: null },
    y: { label: null, grid: true, tickFormat: (value: number) => `${value}%` },
    color: { domain: [...domain], range: domain.map(volColor) },
    marks: [
      Plot.lineY(points, { x: 'date', y: 'volPct', stroke: 'window', strokeWidth: 1.75 }),
      Plot.text(lineEnds, {
        x: 'date',
        y: 'volPct',
        text: 'window',
        dx: 20,
        fill: INK,
        fontSize: 11,
      }),
      // All three windows at the hovered date. Comparing them is the whole
      // reason they share an axis, and the per-point tip could only ever
      // report whichever line the cursor was nearest.
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
