/**
 * The Plot half of the crosshair: turning anchors into marks.
 *
 * Separate from both `crosshair.ts` (pure, testable without a DOM) and
 * `charts.ts` (imported by the header island on every page, so it must not
 * drag Plot into the chartless routes). Only chart components import this.
 */
import * as Plot from '@observablehq/plot';
import { crosshairAnchors, type CrosshairAnchor, type CrosshairRow } from './crosshair';
import { cssVar } from './charts';

/**
 * A crosshair rule and a tooltip reporting every series at the hovered x.
 *
 * Every chart on the site goes through this, so hovering behaves the same
 * everywhere: a rule marking the position, and one tip listing what each
 * series was doing there. On a single-series chart that is the plain tooltip
 * it always had, plus the rule. On the volatility, cycles and DCA charts it is
 * the difference between reading one line and comparing them, which is the
 * only reason those series share an axis.
 *
 * `width` is the plot's width in pixels. Plot picks which side of the cursor
 * to put the tip on, but does not shrink one that is wider than the space it
 * chose — so on a phone a four-line tip with eight-figure amounts hung off the
 * left edge of the *window*, taking the date and the first line with it. The
 * cap keeps it inside the frame; the labels are what should be short enough
 * not to need it.
 *
 * Add the result last, so the rule draws over the lines and the tip over both.
 */
export function crosshairMarksFrom<X extends Date | number>(
  anchors: readonly CrosshairAnchor<X>[],
  width: number,
): Plot.Markish[] {
  // Plot measures lineWidth in ems against its own 10px default, not the
  // chart's font size. Leaving room for the tip's own padding and the left
  // margin, and never below a legible floor.
  const lineWidth = Math.max(9, Math.min(20, Math.floor((width - 96) / 7)));
  return [
    Plot.ruleX(anchors, Plot.pointerX({ x: 'x', stroke: cssVar('--ink-muted'), strokeOpacity: 0.4 })),
    Plot.tip(
      anchors,
      Plot.pointerX({ x: 'x', y: 'y', title: 'title', lineWidth, textOverflow: 'ellipsis-end' }),
    ),
  ];
}

/** Group and build in one step, for charts whose rows change per render. */
export function crosshairMarks<X extends Date | number>(
  rows: readonly CrosshairRow<X>[],
  head: (x: X) => string,
  width: number,
): Plot.Markish[] {
  return crosshairMarksFrom(crosshairAnchors(rows, head), width);
}
