import { describe, expect, it } from 'vitest';
import {
  athSignal,
  cycleHighSignal,
  dominanceSignal,
  drawdownBand,
  drawdownSignal,
  MIN_DOMINANCE_OBS,
  SIGNAL_CONFIRM_DAYS,
  volBand,
  volSignal,
  VOL_HIGH_PCT,
  VOL_LOW_PCT,
} from './signals';

/** 2024-01-01 upwards, so a span's dates can be read at a glance. */
const day = (n: number): string => `2024-01-${String(n).padStart(2, '0')}`;
const vol = (from: number, count: number, volPct: number): { date: string; volPct: number }[] =>
  Array.from({ length: count }, (_, i) => ({ date: day(from + i), volPct }));

describe('volBand', () => {
  it('splits at the band edges, exclusive of low and high', () => {
    expect(volBand(34.99)).toBe('low');
    expect(volBand(35)).toBe('normal');
    expect(volBand(60)).toBe('normal');
    expect(volBand(60.01)).toBe('high');
    expect(VOL_LOW_PCT).toBe(35);
    expect(VOL_HIGH_PCT).toBe(60);
  });

  it('takes custom bands', () => {
    expect(volBand(45, 50, 80)).toBe('low');
    expect(volBand(90, 50, 80)).toBe('high');
  });
});

describe('drawdownBand', () => {
  it('reports the deepest band reached, not the nearest', () => {
    expect(drawdownBand(-5)).toBe('0');
    expect(drawdownBand(-10)).toBe('-10');
    expect(drawdownBand(-29.9)).toBe('-20');
    expect(drawdownBand(-48.09)).toBe('-30');
    expect(drawdownBand(-72)).toBe('-50');
  });

  it('is 0 at the peak, where drawdown is zero', () => {
    expect(drawdownBand(0)).toBe('0');
  });
});

/**
 * Expected values derived by hand — a Python transcription of the rules —
 * before the implementation was run against them.
 */
describe('volSignal', () => {
  it('dates a confirmed switch at the first of its confirming readings', () => {
    // 12 normal then 12 low, confirmDays 5: the switch is confirmed on the
    // 17th but belongs to the 13th, which is when it began.
    const series = [...vol(1, 12, 50), ...vol(13, 12, 20)];
    expect(volSignal(series, { confirmDays: 5 })).toEqual({
      state: 'low',
      since: '2024-01-13',
      observations: 12,
      pending: null,
      history: [
        { state: 'normal', since: '2024-01-01', observations: 12 },
        { state: 'low', since: '2024-01-13', observations: 12 },
      ],
    });
  });

  it('holds the old state and reports the candidate when a run is too short', () => {
    // This is the case the whole design exists for. Three low readings do not
    // make a low regime, but saying nothing about them would hide that the
    // series has been sitting on the edge.
    const series = [...vol(1, 12, 50), ...vol(13, 3, 20)];
    expect(volSignal(series, { confirmDays: 5 })).toEqual({
      state: 'normal',
      since: '2024-01-01',
      observations: 15,
      pending: { state: 'low', since: '2024-01-13', observations: 3 },
      history: [{ state: 'normal', since: '2024-01-01', observations: 15 }],
    });
  });

  it('is not derailed by a single reading across the band', () => {
    // One print at 20% inside a normal stretch: confirmation has to be
    // consecutive, and the run resets.
    const series = [...vol(1, 8, 50), ...vol(9, 1, 20), ...vol(10, 8, 50)];
    const signal = volSignal(series, { confirmDays: 5 });
    expect(signal?.state).toBe('normal');
    expect(signal?.observations).toBe(17);
    expect(signal?.history).toHaveLength(1);
    expect(signal?.pending).toBeNull();
  });

  it('absorbs an unconfirmed opening reading rather than calling it a regime', () => {
    // A series opening on one low print then sitting normal: the opening is
    // where the data starts, not a state it passed through.
    const series = [...vol(1, 1, 20), ...vol(2, 15, 50)];
    expect(volSignal(series, { confirmDays: 5 })).toEqual({
      state: 'normal',
      since: '2024-01-01',
      observations: 16,
      pending: null,
      history: [{ state: 'normal', since: '2024-01-01', observations: 16 }],
    });
  });

  it('reports a high band as readily as a low one', () => {
    const series = [...vol(1, 10, 45), ...vol(11, 10, 80)];
    const signal = volSignal(series, { confirmDays: 5 });
    expect(signal?.state).toBe('high');
    expect(signal?.since).toBe('2024-01-11');
  });

  it('is null for an empty series rather than inventing a state', () => {
    expect(volSignal([])).toBeNull();
  });

  it('rejects bands that are not a band', () => {
    expect(() => volSignal(vol(1, 5, 40), { low: 60, high: 35 })).toThrow('below high');
  });

  it('defaults to ten confirming observations', () => {
    expect(SIGNAL_CONFIRM_DAYS).toBe(10);
    // Nine low readings after a normal stretch are not yet a switch.
    const nine = [...vol(1, 12, 50), ...vol(13, 9, 20)];
    expect(volSignal(nine)?.state).toBe('normal');
    const ten = [...vol(1, 12, 50), ...vol(13, 10, 20)];
    expect(volSignal(ten)?.state).toBe('low');
  });
});

describe('drawdownSignal', () => {
  it('tracks the band the same way, dated at the crossing', () => {
    const series = [
      ...Array.from({ length: 8 }, (_, i) => ({ date: day(i + 1), drawdownPct: -5 })),
      ...Array.from({ length: 8 }, (_, i) => ({ date: day(i + 9), drawdownPct: -35 })),
    ];
    const signal = drawdownSignal(series, { confirmDays: 5 });
    expect(signal?.state).toBe('-30');
    expect(signal?.since).toBe('2024-01-09');
    expect(signal?.history.map((h) => h.state)).toEqual(['0', '-30']);
  });

  it('does not step back out of a band on a single recovery print', () => {
    // The measured series changes band 42 times in a year on a raw test; this
    // is that in miniature.
    const series = [
      ...Array.from({ length: 6 }, (_, i) => ({ date: day(i + 1), drawdownPct: -32 })),
      { date: day(7), drawdownPct: -28 },
      ...Array.from({ length: 6 }, (_, i) => ({ date: day(i + 8), drawdownPct: -33 })),
    ];
    const signal = drawdownSignal(series, { confirmDays: 5 });
    expect(signal?.state).toBe('-30');
    expect(signal?.history).toHaveLength(1);
  });
});

describe('athSignal', () => {
  const history = [
    { date: '2024-01-01', price: 40000 },
    { date: '2024-03-01', price: 70000 },
    { date: '2024-06-01', price: 55000 },
  ];

  it('finds the peak and how far below it today sits', () => {
    // 55000 / 70000 − 1 = −21.4285...% -> −21.43; 2024-03-01 to 2024-06-01
    // is 92 days.
    expect(athSignal(history)).toEqual({
      date: '2024-03-01',
      price: 70000,
      latestDate: '2024-06-01',
      latestPrice: 55000,
      fromAthPct: -21.43,
      daysSince: 92,
      isNew: false,
    });
  });

  it('calls the latest close a new high when it is the peak', () => {
    const rising = [...history, { date: '2024-07-01', price: 80000 }];
    const signal = athSignal(rising);
    expect(signal?.isNew).toBe(true);
    expect(signal?.fromAthPct).toBe(0);
    expect(signal?.daysSince).toBe(0);
  });

  it('counts a tie as reaching the high, not missing it', () => {
    const tied = [...history, { date: '2024-07-01', price: 70000 }];
    expect(athSignal(tied)?.isNew).toBe(true);
  });

  it('is null for no history', () => {
    expect(athSignal([])).toBeNull();
  });
});

describe('cycleHighSignal', () => {
  const series = [
    { day: 0, multiple: 1 },
    { day: 100, multiple: 2.5 },
    { day: 200, multiple: 1.8 },
  ];

  it('reports the cycle’s own peak and whether today matches it', () => {
    expect(cycleHighSignal(series)).toEqual({
      peakMultiple: 2.5,
      peakDay: 100,
      latestMultiple: 1.8,
      latestDay: 200,
      isNew: false,
    });
  });

  it('is a new cycle high when the latest multiple is the peak', () => {
    expect(cycleHighSignal([...series, { day: 300, multiple: 3 }])?.isNew).toBe(true);
  });

  it('is null for an empty cycle', () => {
    expect(cycleHighSignal([])).toBeNull();
  });
});

describe('dominanceSignal', () => {
  const dom = (count: number, pct: (i: number) => number) =>
    Array.from({ length: count }, (_, i) => ({
      date: day(1 + i),
      btcDominancePct: pct(i),
      totalMcapUsd: 2e12,
    }));

  it('is null while the series is too short to mean anything', () => {
    // The committed file holds 3 observations, because the source has no
    // history endpoint and the pipeline accretes one per run. A signal over
    // three points is not a signal.
    expect(MIN_DOMINANCE_OBS).toBe(30);
    expect(dominanceSignal(dom(3, () => 56.5))).toBeNull();
    expect(dominanceSignal(dom(29, (i) => 50 + i * 0.1))).toBeNull();
  });

  it('reports the move once there is enough history', () => {
    // 40 points rising 0.1pp each: over 30 days that is exactly +3.00pp.
    const signal = dominanceSignal(dom(40, (i) => 50 + i * 0.1));
    expect(signal).toEqual({
      latestPct: 53.9,
      latestDate: '2024-01-40',
      changePp: 3,
      overDays: 30,
      fromDate: '2024-01-10',
    });
  });

  it('needs more observations than the window it looks back over', () => {
    // 31 points cannot answer a 60-day question, however many the guard allows.
    expect(dominanceSignal(dom(31, () => 56), { overDays: 60, minObs: 1 })).toBeNull();
  });

  it('signs a fall negative', () => {
    expect(dominanceSignal(dom(40, (i) => 60 - i * 0.1))?.changePp).toBe(-3);
  });
});
