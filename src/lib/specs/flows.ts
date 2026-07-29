/** The two flows charts: stablecoin supply and BTC dominance. */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { ACCENT, CYCLE_RAMP, PLOT_STYLE } from '../plot-theme';

export interface StablecoinPoint {
  date: Date;
  totalUsd: number;
}

export interface DominancePoint {
  date: Date;
  pct: number;
  /** Which share this point belongs to, which is what separates the lines. */
  share: ShareKey;
}

/** The three shares of total market cap the chart draws. */
export const SHARE_KEYS = ['BTC', 'ETH', 'stablecoins'] as const;
export type ShareKey = (typeof SHARE_KEYS)[number];

/**
 * One colour per share.
 *
 * BTC keeps the accent, since this is a Bitcoin site and it is the line the
 * page is about. The other two take ramp steps rather than pos/neg, which
 * carry a gain/loss meaning here that a market share does not have.
 */
export function shareColor(share: ShareKey): string {
  if (share === 'BTC') return ACCENT;
  return share === 'ETH' ? CYCLE_RAMP[2] : CYCLE_RAMP[1];
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
    // Not zero-based, and not shared across the three: BTC sits near 56% while
    // the stablecoin share is near 5%, so a domain wide enough for both would
    // flatten the movement in each. The reader is being shown how each share
    // moves, and the legend names which line is which.
    color: { domain: SHARE_KEYS, range: SHARE_KEYS.map(shareColor) },
    marks: [
      // Dots keep a young accreted series visible before the line forms. ETH
      // and the stablecoin share start at M17 while BTC reaches back to M5, so
      // for the first days after this ships they are single points — which is
      // honest about when capture started, and invisible without the dots.
      Plot.dot(points, { x: 'date', y: 'pct', fill: 'share', r: 2 }),
      Plot.lineY(points, { x: 'date', y: 'pct', stroke: 'share', strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
