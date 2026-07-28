/** Halving cycles overlaid on days-since-halving, log or linear. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { CYCLE_RAMP, INK, PLOT_STYLE } from '../plot-theme';

export interface CyclePoint {
  cycle: string;
  day: number;
  multiple: number;
}

export type CycleScale = 'log' | 'linear';

/** Oldest cycle lightest, current cycle the strongest step. */
export const cycleColor = (index: number): string => CYCLE_RAMP[index] ?? 'var(--accent)';

export function cyclesSpec(
  points: readonly CyclePoint[],
  lineEnds: readonly CyclePoint[],
  domain: readonly string[],
  scale: CycleScale,
  width: number,
  anchors?: readonly CrosshairAnchor<number>[],
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 380,
    marginLeft: 48,
    marginRight: 44,
    x: { label: 'days since halving' },
    y: {
      label: null,
      grid: true,
      type: scale,
      tickFormat: (value: number) => `×${value >= 10 ? value.toFixed(0) : value}`,
    },
    color: { domain: [...domain], range: domain.map((_, i) => cycleColor(i)) },
    marks: [
      Plot.lineY(points, { x: 'day', y: 'multiple', stroke: 'cycle', strokeWidth: 1.5 }),
      Plot.text(lineEnds, {
        x: 'day',
        y: 'multiple',
        text: 'cycle',
        dx: 20,
        fill: INK,
        fontSize: 11,
      }),
      // Every cycle still running at this day, in ramp order. Cycles have
      // different lengths and the newest is incomplete, so the later days
      // legitimately list fewer than four.
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
