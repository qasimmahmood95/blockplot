/**
 * The DCA comparison chart, and the default form state the build draws it at.
 *
 * The simulator is the one chart whose shape is chosen by the reader, so the
 * served SVG is the chart for the form's own defaults — which is exactly what
 * the page used to draw for itself on load, a tenth of a second later and 88 KB
 * more expensively. Touching any input replaces it with a live one.
 */
import * as Plot from '@observablehq/plot';
import { crosshairMarks } from '../crosshair-marks';
import { isoDay } from '../crosshair';
import { ACCENT, INK_MUTED, PLOT_STYLE, POS } from '../plot-theme';
import type { WealthPoint } from './dca-shared';

// Re-exported so the build can reach them through the spec it is already
// importing; the eager client path imports them from `dca-shared` directly,
// which is Plot-free.
export { defaultStartDate, wealthExtent, type WealthPoint } from './dca-shared';

export interface DcaSpecArgs {
  dcaPoints: readonly WealthPoint[];
  lumpPoints: readonly WealthPoint[];
  /** The reader's own stack. Never known at build time; empty there. */
  heldPoints: readonly WealthPoint[];
  wealthDomain: [number, number];
  width: number;
  axisMoney: (value: number) => string;
  tipMoney: (value: number) => string;
  interactive: boolean;
}

export function dcaSpec({
  dcaPoints,
  lumpPoints,
  heldPoints,
  wealthDomain,
  width,
  axisMoney,
  tipMoney,
  interactive,
}: DcaSpecArgs): Parameters<typeof Plot.plot>[0] {
  return {
    width,
    height: 320,
    marginLeft: 70,
    x: { label: null },
    y: {
      label: null,
      grid: true,
      // Domain comes from the two simulated lines only. The held stack is an
      // absolute figure with no relation to the chosen budget, and letting it
      // set the scale collapsed the comparison this chart exists for — a 500
      // BTC stack pushed DCA and lump sum onto the baseline. It is clipped
      // instead, and the legend says when.
      domain: wealthDomain,
      tickFormat: axisMoney,
    },
    marks: [
      Plot.lineY(lumpPoints, {
        x: 'date',
        y: 'wealth',
        stroke: INK_MUTED,
        strokeWidth: 1.25,
        strokeDasharray: '3,3',
      }),
      Plot.lineY(dcaPoints, { x: 'date', y: 'wealth', stroke: ACCENT, strokeWidth: 1.75 }),
      ...(heldPoints.length === 0
        ? []
        : [
            Plot.lineY(heldPoints, {
              x: 'date',
              y: 'wealth',
              stroke: POS,
              strokeWidth: 1.25,
              strokeDasharray: '1,3',
              clip: true,
            }),
          ]),
      // All three lines at the hovered date. The comparison is the point of the
      // page, and the tip used to report only the DCA line — so the one number
      // a reader actually wants, the gap between the strategies, had to be
      // eyeballed off the axis.
      ...(interactive
        ? crosshairMarks(
            [
              ...dcaPoints.map((d) => ({
                x: d.date,
                y: d.wealth,
                label: `DCA ${tipMoney(d.wealth)}`,
              })),
              ...lumpPoints.map((d) => ({
                x: d.date,
                y: d.wealth,
                label: `lump ${tipMoney(d.wealth)}`,
              })),
              ...heldPoints.map((d) => ({
                x: d.date,
                y: d.wealth,
                label: `held ${tipMoney(d.wealth)}`,
                // "held", matching the brevity of "DCA" and "lump": at 360px
                // "your BTC $11.79M" was one pixel over the budget and lost its
                // last digits. The legend spells out whose line it is.
                //
                // Clipped to the simulated lines' domain, so it may be far
                // outside the frame in either direction; it reports, it does
                // not anchor.
                anchor: false,
              })),
            ],
            isoDay,
            width,
          )
        : []),
    ],
    style: PLOT_STYLE,
  };
}
