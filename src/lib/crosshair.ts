/**
 * Building a tooltip that reports every series at the position under the
 * cursor.
 *
 * Observable Plot's pointer transform selects a single datum: nearest in x,
 * then nearest in y. On a chart with one line that is exactly right. On a
 * chart with several it answers a question nobody asked — it reports whichever
 * line the cursor drifted closest to, when the only reason to put four cycles
 * or three volatility windows on one pair of axes is to compare them at the
 * same x. Reading the 90d window off the chart meant hovering the 90d line
 * precisely, and the 30d value at that date was simply unavailable.
 *
 * So the rows are grouped by x, and each group becomes one anchor row carrying
 * a pre-composed label for every series present there. Plot then has one datum
 * per x to select, which is the thing it does well.
 *
 * The grouping is here, apart from the marks, because it is ordinary data
 * manipulation with edge cases worth testing, and testing it should not
 * require a DOM or a plot.
 */

/** One series' value at one x. */
export interface CrosshairRow<X> {
  x: X;
  y: number;
  /** This series' line in the tooltip, e.g. "30d  34.7%". */
  label: string;
  /**
   * Whether this row may position the tip. Default true.
   *
   * False for a series drawn outside the y-domain: the DCA chart clips the
   * held-stack line, because a 500 BTC stack against a £100/week budget would
   * otherwise flatten the comparison the chart exists for. Its value still
   * belongs in the tooltip — the reader wants the gap — but letting it set the
   * anchor would put the tip somewhere off the top of the frame.
   */
  anchor?: boolean;
}

export interface CrosshairAnchor<X> {
  x: X;
  /** Topmost y at this x, so the tip sits above the lines rather than over them. */
  y: number;
  title: string;
}

/**
 * Collapse per-series rows into one anchor per x.
 *
 * Groups keep the order they first appear in, and so do the labels within a
 * group, so the tooltip's line order follows the caller's series order rather
 * than whatever the data happens to be sorted by.
 *
 * A series with no row at an x is simply absent from that label. The four
 * halving cycles have different lengths and the current one is still running,
 * so "no fourth cycle at day 1400" and "fourth cycle at zero" are different
 * claims and only one of them is true.
 */
export function crosshairAnchors<X extends Date | number>(
  rows: readonly CrosshairRow<X>[],
  head: (x: X) => string,
): CrosshairAnchor<X>[] {
  const groups = new Map<number, { x: X; y: number | null; labels: string[] }>();
  for (const row of rows) {
    // A NaN y is a gap in a series, not a value at zero: it must not anchor
    // the tip, and Plot would refuse to place it anyway.
    if (!Number.isFinite(row.y)) continue;
    const key = row.x instanceof Date ? row.x.getTime() : (row.x as number);
    const anchors = row.anchor !== false;
    const group = groups.get(key);
    if (group) {
      if (anchors && (group.y === null || row.y > group.y)) group.y = row.y;
      group.labels.push(row.label);
    } else {
      groups.set(key, { x: row.x, y: anchors ? row.y : null, labels: [row.label] });
    }
  }
  const out: CrosshairAnchor<X>[] = [];
  for (const { x, y, labels } of groups.values()) {
    // Nowhere to put the tip: every series here is one that cannot position
    // it. Better no tooltip at that x than one pinned to an arbitrary height.
    if (y === null) continue;
    out.push({ x, y, title: [head(x), ...labels].join('\n') });
  }
  return out;
}

/** The x heading most of these charts want: a plain ISO date. */
export const isoDay = (x: Date): string => x.toISOString().slice(0, 10);

/**
 * Plot's default tip `lineWidth`, in ems against its own 10px tip font — so
 * roughly a 200px wrap. Named because a cap must be *below* it to do anything:
 * the first attempt at this clamp bottomed out at exactly 20 for any plot
 * wider than 236px, which is every real viewport, and was therefore inert.
 */
const PLOT_DEFAULT_LINE_WIDTH = 20;

/**
 * Chrome around the tip's text: its own padding and border, in pixels.
 * Measured off the rendered chart (box 155px against 133px of text).
 */
const TIP_PADDING_PX = 22;

/**
 * The widest left margin any chart reserves for its y-axis, in pixels. The tip
 * may overlap it, but budgeting as if it may not is what keeps the box inside
 * the frame when the cursor is mid-plot and neither side has room.
 */
const MAX_PLOT_MARGIN_PX = 70;

/**
 * Pixels per em of wrap budget. Plot's `lineWidth` is in ems, but it measures
 * against a table built at **10px system-ui** — while every chart here renders
 * the tip at 11px IBM Plex Mono, whose advance is wider. Measured
 * underestimate on a real label: Plot 103px, rendered 125px, a factor of 1.22.
 * Marks pass `monospace: true`, which switches Plot to a fixed advance and
 * removes most of that error; this is the remaining allowance.
 */
const PX_PER_EM = 7;

/**
 * How wide the tooltip may wrap, in ems, for a plot of `width` pixels.
 *
 * Plot chooses which side of the cursor to put the tip on but does not shrink
 * one too wide for the side it chose. The SVG clips at its own frame, so an
 * oversized tip is not pushed off-screen so much as guillotined — the reader
 * gets "500 -0.04" where the label said "2019-01-02 / BTC – S&P 500 -0.04",
 * which is worse than a truncation they can see coming.
 *
 * Half the plot, less the axis margin and the tip's own chrome.
 *
 * Loosening this to half the *SVG* — on the reasoning that the tip may sit over
 * the axis labels, which it may — put the guillotine back: Plot flips the tip
 * to whichever side has room, and at 320px with the cursor mid-plot neither
 * side does. The budget has to assume the worst placement, not the best.
 *
 * The cost is that a genuinely long label truncates on a small phone. That is
 * the better failure: an ellipsis tells the reader something is missing, where
 * a clipped box hands them "500 -0.04" and lets them believe it.
 *
 * Floored at 8 ems so a very narrow chart truncates rather than becoming a
 * column of single words, and never above Plot's own default, so desktop is
 * untouched.
 *
 * The first version of this was arithmetically incapable of returning anything
 * but the default; the second ignored the padding and the font; the third
 * over-corrected, and the fourth under-corrected. The numbers are measured
 * against the built site, not derived.
 */
export function tipLineWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return PLOT_DEFAULT_LINE_WIDTH;
  const usable = (width - MAX_PLOT_MARGIN_PX) / 2 - TIP_PADDING_PX;
  return Math.max(8, Math.min(PLOT_DEFAULT_LINE_WIDTH, Math.round(usable / PX_PER_EM)));
}
