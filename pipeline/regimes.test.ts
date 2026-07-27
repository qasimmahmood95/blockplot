import { describe, expect, it } from 'vitest';
import { classifyRegimes, regimeOf, REGIME_CONFIRM_DAYS, REGIME_THRESHOLD } from './regimes';

const day = (n: number): string =>
  new Date(Date.UTC(2024, 0, n)).toISOString().slice(0, 10);

const points = (corrs: number[]): { date: string; corr: number }[] =>
  corrs.map((corr, i) => ({ date: day(i + 1), corr }));

describe('regimeOf', () => {
  it('splits on ±threshold, with the boundary inclusive', () => {
    expect(regimeOf(0.25, 0.25)).toBe('positive');
    expect(regimeOf(-0.25, 0.25)).toBe('negative');
    expect(regimeOf(0.24, 0.25)).toBe('neutral');
    expect(regimeOf(-0.24, 0.25)).toBe('neutral');
    expect(regimeOf(0, 0.25)).toBe('neutral');
  });

  it('defaults to the shipped threshold', () => {
    expect(REGIME_THRESHOLD).toBe(0.25);
    expect(regimeOf(0.3)).toBe('positive');
    expect(regimeOf(0.2)).toBe('neutral');
  });
});

describe('classifyRegimes', () => {
  it('has no regimes for an empty series', () => {
    expect(classifyRegimes([])).toEqual([]);
  });

  it('reports one segment when the series never leaves a regime', () => {
    expect(classifyRegimes(points([0.4, 0.5, 0.45]), { threshold: 0.25, confirmDays: 2 })).toEqual([
      {
        regime: 'positive',
        startDate: '2024-01-01',
        endDate: '2024-01-03',
        observations: 3,
        days: 3,
        meanCorr: 0.45,
      },
    ]);
  });

  // Expectations derived by hand before the implementation existed. The series
  // opens with three neutral readings (enough to stand as a segment of its
  // own), flips positive at 01-04 — the first of three consecutive positive
  // readings, not the third — and back at 01-10, while the isolated 01-08
  // neutral and 01-09 positive spikes are absorbed rather than starting
  // regimes of their own.
  it('confirms a switch only after confirmDays, dated at the first of them', () => {
    const series = points([0.1, 0.05, 0.08, 0.3, 0.4, 0.35, 0.5, 0.1, 0.6, 0.05, 0.0, -0.1, 0.05]);
    expect(classifyRegimes(series, { threshold: 0.25, confirmDays: 3 })).toEqual([
      {
        regime: 'neutral',
        startDate: '2024-01-01',
        endDate: '2024-01-03',
        observations: 3,
        days: 3,
        meanCorr: 0.08,
      },
      {
        regime: 'positive',
        startDate: '2024-01-04',
        endDate: '2024-01-09',
        observations: 6,
        days: 6,
        meanCorr: 0.38,
      },
      {
        regime: 'neutral',
        startDate: '2024-01-10',
        endDate: '2024-01-13',
        observations: 4,
        days: 4,
        meanCorr: 0,
      },
    ]);
  });

  it('breaks a candidate run on a single reading back in the incumbent regime', () => {
    // Two positives, one neutral, two positives: never three consecutive, so
    // the whole series stays the neutral regime it opened in.
    const series = points([0.0, 0.3, 0.4, 0.1, 0.3, 0.4]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 3 });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.regime).toBe('neutral');
  });

  it('carries a negative regime and its inclusive calendar span', () => {
    const series = points([-0.4, -0.5, -0.3]);
    expect(classifyRegimes(series, { threshold: 0.25, confirmDays: 2 })).toEqual([
      {
        regime: 'negative',
        startDate: '2024-01-01',
        endDate: '2024-01-03',
        observations: 3,
        days: 3,
        meanCorr: -0.4,
      },
    ]);
  });

  it('counts calendar days, not observations, across gaps', () => {
    // Weekends and holidays leave gaps in a shared-trading-day series: three
    // readings spanning 2024-01-01 to 2024-01-31 are 31 days, not 3.
    const series = [
      { date: '2024-01-01', corr: 0.4 },
      { date: '2024-01-15', corr: 0.5 },
      { date: '2024-01-31', corr: 0.6 },
    ];
    const segment = classifyRegimes(series, { threshold: 0.25, confirmDays: 2 })[0];
    expect(segment?.days).toBe(31);
    expect(segment?.observations).toBe(3);
  });

  it('leaves the tail in the incumbent regime until confirmDays have passed', () => {
    // Nine positives after a neutral open, with the shipped 10-reading
    // confirmation: not yet a regime change, and the segmentation says so
    // rather than guessing.
    expect(REGIME_CONFIRM_DAYS).toBe(10);
    const nine = classifyRegimes(points([0.0, ...Array<number>(9).fill(0.6)]));
    expect(nine).toHaveLength(1);
    expect(nine[0]?.regime).toBe('neutral');
    // One more positive reading tips it. The single opening neutral reading is
    // too short to stand as its own segment, so it is absorbed and the whole
    // series reads positive rather than gaining a one-day neutral row.
    const ten = classifyRegimes(points([0.0, ...Array<number>(10).fill(0.6)]));
    expect(ten).toHaveLength(1);
    expect(ten[0]).toMatchObject({ regime: 'positive', observations: 11 });
  });

  // The opening reading has no history to confirm against, so taking the
  // regime straight from it reintroduced the one-day segment the hysteresis
  // exists to prevent.
  it('does not let a single opening reading create a regime of its own', () => {
    const series = points([0.26, ...Array<number>(11).fill(0)]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 10 });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      regime: 'neutral',
      startDate: '2024-01-01',
      observations: 12,
    });
  });

  it('absorbs a short opening span into the first confirmed regime', () => {
    // Two neutral readings then a confirmed positive run: the segment is
    // positive and dated from the series start, because the opening is where
    // the data begins, not a regime that ended.
    const series = points([0.0, 0.1, ...Array<number>(12).fill(0.6)]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 3 });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      regime: 'positive',
      startDate: '2024-01-01',
      observations: 14,
    });
  });

  it('keeps an opening span that is already long enough to stand alone', () => {
    const series = points([...Array<number>(4).fill(0.0), ...Array<number>(4).fill(0.6)]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 3 });
    expect(segments.map((s) => s.regime)).toEqual(['neutral', 'positive']);
    expect(segments[0]?.observations).toBe(4);
  });

  it('leaves a lone short series as one segment rather than inventing a change', () => {
    const segments = classifyRegimes(points([0.6, 0.7]), { threshold: 0.25, confirmDays: 10 });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.observations).toBe(2);
  });

  it('never emits an interior segment shorter than confirmDays', () => {
    const series = points([0.0, 0.6, -0.6, 0.6, -0.6, ...Array<number>(6).fill(-0.6), 0.6, 0.6, 0.6, 0.6]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 3 });
    for (const segment of segments.slice(1)) {
      expect(segment.observations).toBeGreaterThanOrEqual(3);
    }
  });

  it('produces contiguous, gapless segments covering every observation', () => {
    const series = points([0.0, 0.3, 0.4, 0.5, 0.6, -0.5, -0.6, -0.7, -0.8, 0.0, 0.1]);
    const segments = classifyRegimes(series, { threshold: 0.25, confirmDays: 2 });
    expect(segments.reduce((n, s) => n + s.observations, 0)).toBe(series.length);
    expect(segments[0]?.startDate).toBe(series[0]?.date);
    expect(segments.at(-1)?.endDate).toBe(series.at(-1)?.date);
    for (let i = 1; i < segments.length; i++) {
      const prevEnd = segments[i - 1]?.endDate ?? '';
      const currStart = segments[i]?.startDate ?? '';
      expect(currStart > prevEnd).toBe(true);
      // No observation falls between two segments.
      const gap = series.filter((p) => p.date > prevEnd && p.date < currStart);
      expect(gap).toEqual([]);
    }
    // Adjacent segments always differ, or they would be one segment.
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]?.regime).not.toBe(segments[i - 1]?.regime);
    }
  });
});
