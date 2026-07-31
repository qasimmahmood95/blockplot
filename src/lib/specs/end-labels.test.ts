import { describe, expect, it } from 'vitest';
import { dodgeBy, dodgedEnds, extentOf, type DodgeOptions } from './end-labels';

/** A 250px drawing area over a 0–100 linear axis: 1 unit is 2.5px. */
const LINEAR: DodgeOptions = {
  scale: 'linear',
  domain: [0, 100],
  plotHeight: 250,
  minGap: 13,
};

/** Where a label ends up, in pixels from the top. */
const placed = (values: number[], options: DodgeOptions = LINEAR): number[] => {
  const [lo, hi] = options.domain;
  const dy = dodgeBy(values, options);
  return values.map((v, i) => ((hi - v) / (hi - lo)) * options.plotHeight + (dy[i] as number));
};

const gaps = (out: number[]): number[] =>
  [...out].sort((a, b) => a - b).slice(1).map((v, i) => v - [...out].sort((a, b) => a - b)[i]!);

describe('dodgeBy', () => {
  it('leaves labels alone when they already clear each other', () => {
    // 20 units is 50px, comfortably past the 13px minimum, so nothing moves.
    expect(dodgeBy([20, 40, 60], LINEAR)).toEqual([0, 0, 0]);
  });

  it('separates labels that would land on top of each other', () => {
    // The failure this exists for: three values within a rounding error of each
    // other print three labels in one place.
    const out = placed([50, 50.02, 49.98]);
    for (const gap of gaps(out)) expect(gap).toBeCloseTo(13, 6);
  });

  it('keeps the group centred on where the lines actually end', () => {
    // Pushing only downward would drift the whole set away from its lines. The
    // mean position is unchanged to within half a pixel, so a reader still
    // reads each label against roughly the right height.
    const values = [50, 50.02, 49.98];
    const before = placed(values, { ...LINEAR, minGap: 0 });
    const after = placed(values);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(after) - mean(before))).toBeLessThan(0.5);
  });

  it('does not reorder them', () => {
    // A label that moved past its neighbour would name the wrong line, which is
    // worse than the overlap it was fixing.
    const values = [10, 10.1, 10.2, 60];
    const out = placed(values);
    expect(out[0]).toBeGreaterThan(out[1] as number);
    expect(out[1]).toBeGreaterThan(out[2] as number);
    expect(out[2]).toBeGreaterThan(out[3] as number);
  });

  it('measures the gap in pixels on a log axis, not in value', () => {
    // 100 and 104 are 4 apart in value and about 2 apart in pixels on this
    // axis; a dodge that worked in value space would think they were fine.
    const log: DodgeOptions = { scale: 'log', domain: [100, 10_000], plotHeight: 250, minGap: 13 };
    expect(dodgeBy([100, 104], log).some((d) => d !== 0)).toBe(true);
    // And far apart in value but close in pixels is still close in pixels.
    expect(dodgeBy([1000, 1040], log).some((d) => d !== 0)).toBe(true);
    // While a full decade apart is 83px and needs nothing.
    expect(dodgeBy([100, 1000], log)).toEqual([0, 0]);
  });

  it('does nothing to a single label, or none', () => {
    expect(dodgeBy([42], LINEAR)).toEqual([0]);
    expect(dodgeBy([], LINEAR)).toEqual([]);
  });

  it('survives a degenerate axis rather than dividing by zero', () => {
    // Every series ending on the same value gives an empty domain; the labels
    // still have to be readable.
    const flat: DodgeOptions = { ...LINEAR, domain: [5, 5] };
    const out = dodgeBy([5, 5, 5], flat);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(gaps(out)).toEqual([13, 13]);
  });
});

describe('dodgedEnds', () => {
  it('pairs each datum with its own nudge, in input order', () => {
    const ends = [{ v: 50 }, { v: 50.01 }];
    const out = dodgedEnds(ends, (d) => d.v, LINEAR);
    expect(out.map((o) => o.datum)).toEqual(ends);
    expect(Math.abs((out[0]?.dy ?? 0) - (out[1]?.dy ?? 0))).toBeGreaterThan(12);
  });
});

describe('extentOf', () => {
  it('spans the values, lowest first', () => {
    expect(extentOf([{ v: 3 }, { v: -1 }, { v: 9 }], (d) => d.v)).toEqual([-1, 9]);
  });

  it('ignores the breaks a gapped series carries', () => {
    // `/real-returns` inserts non-finite values to split a line at a hole; an
    // extent that took them would be NaN and take every position with it.
    expect(extentOf([{ v: 3 }, { v: Number.NaN }, { v: 9 }], (d) => d.v)).toEqual([3, 9]);
  });

  it('falls back rather than returning an infinite span', () => {
    expect(extentOf([], (d: { v: number }) => d.v)).toEqual([0, 1]);
  });
});
