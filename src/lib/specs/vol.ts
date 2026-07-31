/** Rolling realised volatility, one line per window. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { INK, PLOT_STYLE } from '../plot-theme';
import { dodgedEnds, extentOf } from './end-labels';

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

const PLOT_HEIGHT = 300;
/** Plot's default top and bottom margins, which the drawing area is short by. */
const Y_MARGINS = 50;

export function volSpec(
  points: readonly VolPoint[],
  lineEnds: readonly VolPoint[],
  domain: readonly string[],
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: PLOT_HEIGHT,
    marginLeft: 48,
    marginRight: 44,
    x: { label: null },
    y: { label: null, grid: true, tickFormat: (value: number) => `${value}%` },
    color: { domain: [...domain], range: domain.map(volColor) },
    marks: [
      Plot.lineY(points, { x: 'date', y: 'volPct', stroke: 'window', strokeWidth: 1.75 }),
      // One mark per label, because each needs its own `dy` and Plot's is a
      // constant rather than a channel. Nudged apart where the windows end
      // close together, which they do often: on 20.6% of the days this file
      // covers some pair of these labels would sit within 4px, and on 6.3%
      // within one. See `end-labels.ts`.
      ...dodgedEnds(lineEnds, (d) => d.volPct, {
        scale: 'linear',
        domain: extentOf(points, (d) => d.volPct),
        plotHeight: PLOT_HEIGHT - Y_MARGINS,
        minGap: 13,
      }).map(({ datum, dy }) =>
        Plot.text([datum], {
          x: 'date',
          y: 'volPct',
          text: 'window',
          dx: 20,
          dy,
          fill: INK,
          fontSize: 11,
        }),
      ),
      // All three windows at the hovered date. Comparing them is the whole
      // reason they share an axis, and the per-point tip could only ever
      // report whichever line the cursor was nearest.
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
