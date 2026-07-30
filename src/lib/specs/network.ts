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
    scale: 'linear',
  },
  'txcount-chart': {
    tick: (v: number) => compact.format(v),
    tip: (v: number) => `${compact.format(v)} tx`,
    scale: 'linear',
  },
  'feepertx-chart': {
    tick: (v: number) => compact.format(v),
    tip: (v: number) => `${compact.format(v)} sats/tx`,
    // Log, because the range is the story. Fees sit in the low hundreds of
    // satoshis for months and spike into the tens of thousands, so on a linear
    // axis every quiet period is a flat line on the floor and the chart answers
    // only "there were spikes" — which is exactly the failure the reader came
    // here to avoid, one page over from a live tier with no context.
    scale: 'log',
  },
} as const;

/**
 * The scale a series can actually use.
 *
 * A log axis cannot plot a zero or a negative, so the preference degrades to
 * linear rather than producing an axis with no domain.
 *
 * It cannot currently fire, and the first version of this comment claimed
 * otherwise — that it existed "rather than drop a genuine zero-fee day".
 * `networkPointSchema` requires every value to be positive, so a zero-fee day
 * does not reach here: it fails validation and costs the whole file, which was
 * verified by injecting one and watching the build refuse it. This is
 * defence-in-depth for a future series whose zeros are legitimate, or for a
 * relaxed schema — not a path the committed data takes.
 *
 * Shared by the build and the browser regardless, so the two cannot pick
 * different axes for the same data — which would show as the chart changing
 * shape on hover.
 */
export function safeScale(
  points: readonly NetworkPoint[],
  preferred: 'log' | 'linear',
): 'log' | 'linear' {
  if (preferred === 'linear') return 'linear';
  return points.every((p) => p.value > 0) ? 'log' : 'linear';
}

export function networkSpec(
  points: readonly NetworkPoint[],
  tickFormat: (value: number) => string,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
  scale: 'log' | 'linear' = 'linear',
): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 260,
    marginLeft: 62,
    x: { label: null },
    y: { label: null, grid: true, tickFormat, type: safeScale(points, scale) },
    marks: [
      // No area fill under a log axis: the fill would run to the bottom of a
      // scale whose bottom is arbitrary, shading three orders of magnitude that
      // mean nothing.
      ...(safeScale(points, scale) === 'log'
        ? []
        : [Plot.areaY(points, { x: 'date', y: 'value', fill: ACCENT, fillOpacity: 0.08 })]),
      Plot.lineY(points, { x: 'date', y: 'value', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
