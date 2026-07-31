import { describe, expect, it } from 'vitest';
import { envelopeByPixel } from './downsample';

interface P {
  x: number;
  y: number;
}
const X = (p: P): number => p.x;
const Y = (p: P): number => p.y;
const run = (points: P[], width: number): readonly P[] => envelopeByPixel(points, X, Y, width);
const ramp = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

describe('envelopeByPixel', () => {
  it('leaves a series with no more points than pixels alone', () => {
    // Returns the same array, not a copy: at one point per pixel every bucket
    // holds one point and the keep-set is the whole series, so there is nothing
    // to do. The threshold was two, which is not a fidelity margin — it is a
    // "don't bother" guard, and at two it skipped `/performance` at 760px,
    // where the series carry 888 points.
    const points = ramp(100);
    expect(run(points, 100)).toBe(points);
    expect(run(points, 200)).toBe(points);
  });

  it('drops nothing from a bucket of two, however the threshold is set', () => {
    // Worth pinning, because it is why lowering the guard from two to one is
    // safe rather than merely cheap. A bucket contributes its first, last,
    // lowest and highest point; with two in it those are the same two, so the
    // series comes back whole. Thinning only bites where a column holds enough
    // points that some are neither an end nor an extreme.
    const points = ramp(150);
    expect(run(points, 100)).toHaveLength(150);
    // And the real series do have such columns: `/performance` at 760px keeps
    // 3,622 of 3,756 points, and at 400px 2,895 — measured on the committed
    // data at the preset the build draws.
    expect(run(ramp(1500), 100).length).toBeLessThan(1500);
  });

  it('thins one that is over', () => {
    const points = ramp(1000);
    const out = run(points, 100);
    expect(out.length).toBeLessThan(points.length);
    expect(out.length).toBeGreaterThan(0);
  });

  it('keeps the first and last point, so the line spans the same range', () => {
    const points = ramp(1000);
    const out = run(points, 100);
    expect(out[0]).toEqual(points[0]);
    expect(out.at(-1)).toEqual(points.at(-1));
  });

  it('preserves the original order', () => {
    const out = run(ramp(1000), 100);
    const xs = out.map(X);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('keeps a one-sample spike that decimation would drop', () => {
    // The case the whole approach exists for: a single extreme day inside a
    // column of otherwise flat data.
    const points = ramp(1000).map((p) => ({ ...p, y: 0 }));
    points[503] = { x: 503, y: 9999 };
    const out = run(points, 100);
    expect(out).toContainEqual({ x: 503, y: 9999 });
  });

  it('keeps both extremes when a column holds a spike and a trough', () => {
    const points = ramp(1000).map((p) => ({ ...p, y: 0 }));
    points[501] = { x: 501, y: 500 };
    points[507] = { x: 507, y: -500 };
    const out = run(points, 100);
    expect(out).toContainEqual({ x: 501, y: 500 });
    expect(out).toContainEqual({ x: 507, y: -500 });
  });

  it('never widens the y range it was given', () => {
    const points = ramp(2000).map((_, i) => ({ x: i, y: Math.sin(i / 7) * 100 }));
    const out = run(points, 120);
    const ys = points.map(Y);
    const kept = out.map(Y);
    expect(Math.min(...kept)).toBe(Math.min(...ys));
    expect(Math.max(...kept)).toBe(Math.max(...ys));
  });

  it('holds the extremes of a real-shaped series to the exact sample', () => {
    // Deterministic pseudo-series with a known argmax and argmin.
    const points: P[] = Array.from({ length: 5000 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 31) * 40 + Math.cos(i / 7) * 12,
    }));
    points[1234] = { x: 1234, y: 1000 };
    points[4321] = { x: 4321, y: -1000 };
    const out = run(points, 400);
    expect(out).toContainEqual({ x: 1234, y: 1000 });
    expect(out).toContainEqual({ x: 4321, y: -1000 });
    // Worth having in numbers: this is the reduction the milestone claims.
    expect(out.length).toBeLessThan(points.length * 0.85);
  });

  it('is a no-op when every x is identical, which would divide by a zero span', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({ x: 7, y: i }));
    expect(run(points, 100)).toBe(points);
  });

  it('is a no-op for a zero or negative width', () => {
    const points = ramp(1000);
    expect(run(points, 0)).toBe(points);
    expect(run(points, -5)).toBe(points);
  });

  it('handles an empty series', () => {
    expect(run([], 100)).toEqual([]);
  });

  it('is idempotent — thinning the result again changes nothing', () => {
    const once = run(ramp(4000), 200);
    expect(run([...once], 200)).toEqual(once);
  });
});
