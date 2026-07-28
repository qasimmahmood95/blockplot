/**
 * The price chart, as one definition used by both the build and the browser.
 *
 * The split that matters is not server/client but static/interactive: the same
 * function describes the chart either way, and `anchors` is the only difference
 * between the SVG shipped in the HTML and the live one that replaces it on
 * hover. Two definitions would drift, and the drift would show as the chart
 * changing shape under the reader's cursor.
 */
import * as Plot from '@observablehq/plot';
import { crosshairMarksFrom } from '../crosshair-marks';
import type { CrosshairAnchor } from '../crosshair';
import { ACCENT, PLOT_STYLE } from '../plot-theme';

export interface PricePoint {
  date: Date;
  price: number;
}

/** Shared by both sides so the axis reads identically before and after upgrade. */
export function priceFormat(code: string): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  });
}

export function priceSpec(
  points: readonly PricePoint[],
  code: string,
  width: number,
  anchors?: readonly CrosshairAnchor<Date>[],
): Parameters<typeof Plot.plot>[0] {
  const money = priceFormat(code);
  return {
    width,
    height: 340,
    marginLeft: 70,
    x: { label: null },
    y: { label: null, grid: true, tickFormat: (value: number) => money.format(value) },
    marks: [
      Plot.lineY(points, { x: 'date', y: 'price', stroke: ACCENT, strokeWidth: 1.5 }),
      ...(anchors ? crosshairMarksFrom(anchors, width) : []),
    ],
    style: PLOT_STYLE,
  };
}
