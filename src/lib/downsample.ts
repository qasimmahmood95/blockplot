/**
 * Thin a series to what a given pixel width can actually draw.
 *
 * Only ever applied to the build-time SVG. The live chart keeps every point,
 * because a hovered figure has to be the real one — this decides which points
 * are worth *drawing*, never which are worth reporting.
 *
 * The rule is min/max per x bucket, not "keep every Nth point". Naive
 * decimation drops whichever samples fall between the ones it keeps, so a
 * single-day spike — exactly the kind of thing a Bitcoin chart exists to show —
 * disappears at some sampling rates and survives at others. Keeping the highest
 * and lowest value in each bucket preserves the drawn envelope *of that bucket*,
 * and the bucket's first and last points are kept too, so the line enters and
 * leaves it where it did before and no segment is redrawn across a gap it did
 * not span.
 *
 * ## What this does not promise, measured
 *
 * An earlier version of this comment said "for every column of the rendered
 * line, the same topmost and bottommost pixels are painted as would have been
 * with the full series". That is only true when a bucket *is* a rendered pixel
 * column, and for every caller this codebase would have, it is not:
 *
 * - the caller knows the SVG width, but Plot draws into the plot area, which is
 *   that width less the margins — `performanceSpec` at 400px gives an x range of
 *   [52, 384], so 332 columns take 400 buckets and the two grids never line up;
 * - the buckets here span each series' own x extent, while Plot's x scale spans
 *   the extent of *all* series together, and on this site they genuinely differ:
 *   the five benchmark series have three distinct start dates and three distinct
 *   end dates, because their sources publish on different schedules.
 *
 * Misaligned either way, a point that is the extreme of its pixel column need
 * not be the extreme of its bucket, so it can be dropped. Wired to
 * `/performance` and measured against the un-thinned render, column by column,
 * interpolating along each drawn segment rather than sampling its vertices: at
 * the preset the build draws, the ink moved by up to **12.5px on log and 19.8px
 * on linear at 400px**, for **2.3 KB gzipped**. Every row where nothing is
 * thinned reads 0.000px, which is the control that says the harness is not what
 * moved the line. `tests/downsample-ink.mjs` is that harness, committed so the
 * number can be re-run rather than taken on trust.
 *
 * So this stays unwired, and the way to wire it is to make a bucket a column:
 * bucket over the *shared* x extent, into *plot-area* columns rather than SVG
 * width. That needs the margins and the sibling series, neither of which this
 * signature carries. See PLAN.md.
 *
 * Monotonic y-transforms are safe: a log axis maps the largest value to the
 * highest pixel just as a linear one does, so the extremes found here are the
 * extremes drawn there. A transform that is *not* monotonic would need this
 * done in the transformed space instead.
 */

/**
 * Below this many points per bucket, skip the work.
 *
 * Two, and it stays two. Lowering it to one was tried on the argument that at
 * one point per bucket every bucket holds a single point, so the keep-set is the
 * whole series and the threshold only ever costs time — which is true of
 * *uniformly spaced* x and of nothing on this site. The series here have
 * weekends missing and a weekly section before a daily one, so at one point per
 * bucket on average some buckets hold five: `/performance` at 400px keeps 3,207
 * points at two and 2,895 at one, and at 760px 3,756 against 3,622. That is a
 * fidelity trade of 312 and 134 points, not a no-op, and it is not one worth
 * making while the module is unwired and the grids do not line up anyway.
 */
const POINTS_PER_PIXEL = 2;

export function envelopeByPixel<T>(
  points: readonly T[],
  x: (point: T) => number,
  y: (point: T) => number,
  width: number,
): readonly T[] {
  if (!(width > 0) || points.length <= width * POINTS_PER_PIXEL) return points;

  let lo = Infinity;
  let hi = -Infinity;
  for (const point of points) {
    const value = x(point);
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const span = hi - lo;
  if (!(span > 0)) return points;

  // Indices rather than points: a series may legitimately contain equal values,
  // and the output has to stay in the original order for the line to be drawn
  // in the right direction.
  const keep = new Set<number>();
  let bucket = 0;
  let start = 0;
  let minIdx = 0;
  let maxIdx = 0;

  const closeBucket = (end: number): void => {
    keep.add(start).add(end).add(minIdx).add(maxIdx);
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i] as T;
    const at = Math.min(width - 1, Math.floor(((x(point) - lo) / span) * width));
    if (i === 0) {
      bucket = at;
      start = minIdx = maxIdx = 0;
      continue;
    }
    if (at !== bucket) {
      closeBucket(i - 1);
      bucket = at;
      start = minIdx = maxIdx = i;
      continue;
    }
    if (y(point) < y(points[minIdx] as T)) minIdx = i;
    if (y(point) > y(points[maxIdx] as T)) maxIdx = i;
  }
  closeBucket(points.length - 1);

  return [...keep].sort((a, b) => a - b).map((i) => points[i] as T);
}
