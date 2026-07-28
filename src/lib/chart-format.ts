/**
 * Formatting rules for chart labels that are too easy to get wrong in a
 * component, and were.
 *
 * These live here rather than inside the island because `vitest.config.ts`
 * reaches `src/**` and cannot reach `.astro`. Both rules below shipped inside
 * `DcaSimulator.astro` first, where a mutation battery found that every single
 * mutation of them survived the suite — including one that disabled the
 * compact formatting entirely, which was the whole point of the change.
 */

/**
 * A money figure short enough to sit in a tooltip.
 *
 * Above seven figures the trailing digits are noise on a chart — nobody reads
 * a portfolio to the dollar off a hover — and spelling them out made the tip
 * wider than the plot area on a phone, at which point the SVG's `overflow:
 * hidden` guillotined the line and the reader saw `$4,839,398,…`. That is
 * strictly worse than a rounded figure: it is indistinguishable from $4.8bn,
 * $4.8tn, or anything between.
 *
 * Seven and not eight because eight was still too long. With the labels as
 * they now ship, `held $6,067,043` is 15 graphemes: it fits the 360px budget
 * of 15 but not the 320px budget of 14, so an eight-figure threshold left an
 * ordinary stack truncated on an iPhone SE. `held $6.07M` is 11. A threshold
 * that only catches the absurd cases leaves the ordinary ones broken.
 *
 * The exact figures stay on the stat tiles and the holdings page, which have
 * the room for them.
 */
export const COMPACT_ABOVE = 1e6;

export function compactMoney(
  value: number,
  exact: (value: number) => string,
  compact: (value: number) => string,
): string {
  return Math.abs(value) >= COMPACT_ABOVE ? compact(value) : exact(value);
}

/**
 * How much of the reader's own holdings line falls outside the chart's scale.
 *
 * The DCA chart's y-domain comes from the two simulated lines, because a large
 * stack would otherwise flatten the comparison the chart exists for. The held
 * line is clipped to that domain, so the legend has to say when what it names
 * is not fully on screen.
 *
 * Three cases, not two. Saying "runs off this scale" for any clipping at all
 * meant saying it always: every line here is proportional to price, so a stack
 * that is not exactly the lump sum's own BTC clips at one end by a point or
 * two. The threshold makes the caveat mean something; the "entirely" case is
 * exact count equality, because then there is nothing drawn at all.
 */
export const CLIP_NOTE_FRACTION = 0.01;

export function clipNote(outsideCount: number, total: number): string {
  if (total === 0 || outsideCount === 0) return '';
  if (outsideCount === total) return ' (entirely off this scale)';
  return outsideCount / total > CLIP_NOTE_FRACTION ? ' (runs off this scale)' : '';
}
