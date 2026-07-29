/**
 * Thin a series to what a given pixel width can actually draw.
 *
 * Only ever applied to the build-time SVG. The live chart keeps every point,
 * because a hovered figure has to be the real one — this decides which points
 * are worth *drawing*, never which are worth reporting.
 *
 * The rule is min/max per x-pixel bucket, not "keep every Nth point". Naive
 * decimation drops whichever samples fall between the ones it keeps, so a
 * single-day spike — exactly the kind of thing a Bitcoin chart exists to show —
 * disappears at some sampling rates and survives at others. Keeping the highest
 * and lowest value in each pixel column preserves the drawn envelope: for every
 * column of the rendered line, the same topmost and bottommost pixels are
 * painted as would have been with the full series.
 *
 * The bucket's first and last points are kept too, so the line enters and
 * leaves each column where it did before and no segment is redrawn across a
 * gap it did not span.
 *
 * Monotonic y-transforms are safe: a log axis maps the largest value to the
 * highest pixel just as a linear one does, so the extremes found here are the
 * extremes drawn there. A transform that is *not* monotonic would need this
 * done in the transformed space instead.
 */

/**
 * Below this many points per pixel a series is already at or under the screen's
 * resolution, and thinning it would cost fidelity for nothing.
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
