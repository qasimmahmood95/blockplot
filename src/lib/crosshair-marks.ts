/**
 * The Plot half of the crosshair: turning anchors into marks.
 *
 * Separate from both `crosshair.ts` (pure, testable without a DOM) and
 * `charts.ts` (imported by the header island on every page, so it must not
 * drag Plot into the chartless routes). Only chart components import this.
 */
import * as Plot from '@observablehq/plot';
import {
  crosshairAnchors,
  tipLineWidth,
  type CrosshairAnchor,
  type CrosshairRow,
} from './crosshair';
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
 * `width` is the plot's width in pixels; see `tipLineWidth` for what it buys.
 *
 * Add the result last, so the rule draws over the lines and the tip over both.
 */
export function crosshairMarksFrom<X extends Date | number>(
  anchors: readonly CrosshairAnchor<X>[],
  width: number,
): Plot.Markish[] {
  const lineWidth = tipLineWidth(width);
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
