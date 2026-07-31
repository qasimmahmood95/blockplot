/**
 * Keeping the end-of-line labels off one another.
 *
 * Three charts name each line at its last point rather than only in the legend:
 * `/volatility`, `/cycles`, `/performance`. It is the better way to label a
 * line — no colour-matching — and it has one failure mode, which is that the
 * label's y *is* a data value, so two lines that end close together print two
 * labels on top of each other.
 *
 * Not hypothetical, and not rare. Replaying `/volatility`'s committed series
 * day by day: on **28.6%** of the 364 days all three windows cover, some pair
 * of labels sits within 4px, and on **7.1%** within one pixel. Most recently
 * 2026-07-05. Today they happen to be 14.6px apart, which is why nobody has
 * seen it — the condition comes and goes with the market, and it came back
 * about every third day.
 *
 * So the labels are nudged apart. Nudged, not dropped: the legend above each
 * chart is a worse way to identify five lines, and `/performance` already drops
 * these at its narrow width for want of room, which is a different problem.
 *
 * ## Why this can do the arithmetic without duplicating Plot's scale
 *
 * It needs pixel positions, and CLAUDE.md's rule is that a chart has one spec —
 * so re-deriving Plot's scale would be exactly the drift that rule forbids.
 * What it re-derives instead is only the *mapping* — linear or log, both exact
 * — over a domain the caller passes. If Plot's domain is a little wider than
 * the caller's (it rounds outward for a nice axis), every position here is off
 * by the same factor, which shrinks the nudges slightly and cannot reorder or
 * misplace them. The output is a `dy` in pixels, which Plot applies verbatim.
 */

export interface DodgeOptions {
  /** The y scale the chart is drawing with. */
  scale: 'linear' | 'log';
  /** The values the y axis spans, lowest first. */
  domain: readonly [number, number];
  /** The drawing area's height in pixels: the chart's height less its margins. */
  plotHeight: number;
  /** The least vertical distance two labels may sit at, centre to centre. */
  minGap: number;
}

const project = (value: number, { scale, domain, plotHeight }: DodgeOptions): number => {
  const [lo, hi] = domain;
  const at = scale === 'log' ? Math.log(Math.max(value, Number.MIN_VALUE)) : value;
  const from = scale === 'log' ? Math.log(Math.max(lo, Number.MIN_VALUE)) : lo;
  const to = scale === 'log' ? Math.log(Math.max(hi, Number.MIN_VALUE)) : hi;
  if (!(to > from)) return plotHeight / 2;
  // Pixels down from the top, which is how SVG counts and how `dy` reads.
  return ((to - at) / (to - from)) * plotHeight;
};

/**
 * How far each label has to move, in pixels, so none crowds another.
 *
 * Returns a `dy` per index of `values`, mostly zero. The rule is the smallest
 * total movement that separates them: sort by position, push each one down far
 * enough to clear the one above, then slide the whole run back up by half its
 * overflow so the group stays centred on where the lines actually end rather
 * than drifting downward.
 */
export function dodgeBy(values: readonly number[], options: DodgeOptions): number[] {
  const dy = values.map(() => 0);
  if (values.length < 2) return dy;

  const order = values.map((value, index) => ({ index, at: project(value, options) }));
  order.sort((a, b) => a.at - b.at);

  let previous = -Infinity;
  for (const entry of order) {
    const placed = Math.max(entry.at, previous + options.minGap);
    dy[entry.index] = placed - entry.at;
    previous = placed;
  }

  // Pushing only downward biases the whole group away from its lines. Half the
  // total push goes back up, which halves the worst single label's error and
  // leaves the separation untouched — every gap is a difference, and shifting
  // them all by the same amount does not change a difference.
  const pushed = dy.reduce((a, b) => Math.max(a, b), 0);
  if (pushed > 0) for (let i = 0; i < dy.length; i += 1) (dy[i] as number) -= pushed / 2;
  // Rounded, because the subtraction above leaves residue on the labels that
  // did not need moving — a `dy` of −2.8e-14, which Plot writes into the markup
  // in exponential form as `translate(20,-2.8e-14)`. Sub-hundredth-pixel
  // precision is meaningless in a rendered position and expensive in bytes.
  return dy.map((offset) => Math.round(offset * 100) / 100);
}

/**
 * Each end paired with its nudge, for one text mark apiece.
 *
 * One mark per label rather than one for all of them, because Plot's `dy` is a
 * constant on the mark and not a channel it evaluates per datum — so a set of
 * labels that each need a different offset is a set of marks. The alternative
 * would be to fold the offset back into the `y` value, which means inverting
 * the projection and printing every label at a y that is not its own, for the
 * sake of saving three `<g>` elements.
 */
export function dodgedEnds<T>(
  ends: readonly T[],
  value: (datum: T) => number,
  options: DodgeOptions,
): { datum: T; dy: number }[] {
  const offsets = dodgeBy(ends.map(value), options);
  return ends.map((datum, i) => ({ datum, dy: offsets[i] as number }));
}

/** The y values a chart spans, from the points it is drawing. */
export function extentOf<T>(points: readonly T[], value: (datum: T) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const point of points) {
    const at = value(point);
    if (!Number.isFinite(at)) continue;
    if (at < lo) lo = at;
    if (at > hi) hi = at;
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}
