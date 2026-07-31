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
 * day by day — each day's axis domain taken from the points drawn up to that
 * day, as the chart does — some pair of labels sits within 4px on **20.6%** of
 * the 364 days all three windows cover, and within one pixel on **6.3%**. Most
 * recently 2026-07-05 and 2026-07-04. Today they are 14.1px apart, which is why
 * nobody had seen it: the condition comes and goes with the market, and came
 * back about one day in five.
 *
 * (An earlier version of these figures said 28.6% and 7.1%. That replay held
 * the domain at the full history's extent instead of letting it move with the
 * data, which is not what the chart does — it overstated the rate by a third.)
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

interface Placed {
  index: number;
  at: number;
  placed: number;
}

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
  // No clamp to `Number.MIN_VALUE`. It papered over a mismatch rather than
  // fixing one: Plot drops non-positive values from a log domain, so clamping
  // them here put `Math.log(5e-324) = −744` at one end of a domain Plot had
  // built from the positive values alone, squeezing every real label into a
  // 1.5px sliver. `extentOf` skips them on a log axis now, the same way Plot
  // does, and a non-finite result falls through to the guard in `dodgeBy`.
  const at = scale === 'log' ? Math.log(value) : value;
  const from = scale === 'log' ? Math.log(lo) : lo;
  const to = scale === 'log' ? Math.log(hi) : hi;
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

  const order: Placed[] = values.map((value, index) => ({
    index,
    at: project(value, options),
    placed: undefined as unknown as number,
  }));
  // A non-finite position cannot be ordered or separated, and letting one
  // through poisoned every label after it — `Math.max(NaN, …)` is NaN, so the
  // running floor became NaN and so did the rest. `extentOf` guards the same
  // hazard one function down; this did not.
  order.sort((a, b) => a.at - b.at);

  let previous = -Infinity;
  for (const entry of order) {
    if (!Number.isFinite(entry.at)) continue;
    const placed = Math.max(entry.at, previous + options.minGap);
    entry.placed = placed;
    dy[entry.index] = placed - entry.at;
    previous = placed;
  }

  // Pushing only downward biases a crowd away from its lines, so each crowd
  // slides back up by half its own overflow.
  //
  // Per *run*, not across the whole chart: shifting everything by the largest
  // push anywhere moved labels that never collided. Four cycles ending 175px
  // apart, two of them close together, had all four displaced by 19px — and on
  // `/cycles` the labels are not even in one column, so two of those could not
  // have overlapped whatever their y.
  //
  // A run is a maximal group the forward pass welded together at exactly
  // `minGap`. Runs settle top-first, and each one's rise is clamped by the one
  // above it: unclamped, a lower run can rise further than its neighbour and
  // close the gap the forward pass just opened — measured on
  // [100, 100, 89.6, 89.6, 89.6], where a 13px separation became 6.5px.
  const settled = order.filter((entry) => entry.placed !== undefined);
  let floor = -Infinity;
  for (let i = 0; i < settled.length; ) {
    let end = i;
    while (
      end + 1 < settled.length &&
      (settled[end + 1] as Placed).placed - (settled[end] as Placed).placed <= options.minGap + 1e-9
    ) {
      end += 1;
    }
    const last = settled[end] as Placed;
    const rise = Math.min((last.placed - last.at) / 2, (settled[i] as Placed).placed - floor);
    for (let j = i; j <= end; j += 1) {
      const entry = settled[j] as Placed;
      entry.placed -= rise;
      dy[entry.index] = entry.placed - entry.at;
    }
    floor = last.placed + options.minGap;
    i = end + 1;
  }
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

/**
 * The y values a chart spans, from the points it is drawing.
 *
 * Scale-aware, because Plot's domain is: on a log axis it drops non-positive
 * values, since they have no position there. Taking them would put this
 * function's domain somewhere Plot's is not, which is the one way the
 * projection above can disagree with the chart it is measuring.
 *
 * Non-finite values are skipped either way — `/real-returns` inserts them to
 * break a line at a hole in the deflator, and one of them would otherwise make
 * the whole extent `NaN`.
 */
export function extentOf<T>(
  points: readonly T[],
  value: (datum: T) => number,
  scale: DodgeOptions['scale'] = 'linear',
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const point of points) {
    const at = value(point);
    if (!Number.isFinite(at)) continue;
    if (scale === 'log' && at <= 0) continue;
    if (at < lo) lo = at;
    if (at > hi) hi = at;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}
