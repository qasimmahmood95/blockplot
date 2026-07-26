import { describe, expect, it } from 'vitest';
import { changeOverDaysPct, toExahashes, trailingAverage } from './network';
import { mempoolFeesSchema, networkDatasetSchema } from './schema';

const series = [
  { date: '2026-06-20', value: 500 },
  { date: '2026-06-26', value: 520 },
  { date: '2026-07-20', value: 600 },
  { date: '2026-07-26', value: 650 },
];

describe('toExahashes', () => {
  it('converts the source TH/s to EH/s at 2 dp', () => {
    // 8.7e8 TH/s is ~870 EH/s, the 2026 order of magnitude.
    expect(
      toExahashes([
        { date: '2026-07-24', value: 8.5e8 },
        { date: '2026-07-25', value: 8.7e8 },
      ]),
    ).toEqual([
      { date: '2026-07-24', value: 850 },
      { date: '2026-07-25', value: 870 },
    ]);
  });

  it('fails loudly if the source silently changes units', () => {
    // GH/s values would convert to a nonsensically small EH/s figure.
    expect(() => toExahashes([{ date: '2026-07-25', value: 8.7e5 }])).toThrow('implausibly low');
  });
});

describe('changeOverDaysPct', () => {
  it('compares against the closest entry at or before the target date', () => {
    // 30d before 2026-07-26 is 2026-06-26 (exact hit): 650/520 − 1 = +25%.
    expect(changeOverDaysPct(series, 30)).toBe(25);
    // 36d back lands on 2026-06-20: 650/500 − 1 = +30%.
    expect(changeOverDaysPct(series, 36)).toBe(30);
  });

  it('is null when no entry precedes the target, and for an empty series', () => {
    expect(changeOverDaysPct(series, 365)).toBeNull();
    expect(changeOverDaysPct([], 30)).toBeNull();
  });
});

describe('trailingAverage', () => {
  it('averages the last N entries to whole units', () => {
    expect(trailingAverage([{ date: '2026-07-24', value: 100 }, ...series.slice(1)], 3)).toBe(590);
    expect(trailingAverage(series, 2)).toBe(625);
    // Window longer than the series averages everything present.
    expect(trailingAverage(series, 99)).toBe(568); // (500+520+600+650)/4 = 567.5 -> 568
    expect(trailingAverage([], 30)).toBeNull();
  });
});

describe('mempoolFeesSchema', () => {
  it('accepts the documented shape and rejects missing or non-positive tiers', () => {
    const valid = {
      fastestFee: 12,
      halfHourFee: 9,
      hourFee: 6,
      economyFee: 3,
      minimumFee: 1,
    };
    expect(mempoolFeesSchema.parse({ ...valid, extra: 'ignored' })).toEqual(valid);
    expect(() => mempoolFeesSchema.parse({ ...valid, hourFee: 0 })).toThrow();
    expect(() => mempoolFeesSchema.parse({ fastestFee: 12 })).toThrow();
  });
});

describe('networkDatasetSchema', () => {
  const valid = {
    schemaVersion: 1,
    fetchedAt: '2026-07-26T12:00:00.000Z',
    asOf: '2026-07-26',
    keepDays: 730,
    hashRate: {
      unit: 'EH/s',
      change30dPct: 25,
      series: [
        { date: '2026-07-25', value: 600 },
        { date: '2026-07-26', value: 650 },
      ],
    },
    txCount: {
      unit: 'tx/day',
      average30d: 400_000,
      change30dPct: -3.2,
      series: [
        { date: '2026-07-25', value: 410_000 },
        { date: '2026-07-26', value: 395_000 },
      ],
    },
    fees: {
      source: 'mempool.space',
      tiers: { fastestFee: 12, halfHourFee: 9, hourFee: 6, economyFee: 3, minimumFee: 1 },
    },
  };

  it('accepts the documented shape, including null change figures', () => {
    expect(networkDatasetSchema.parse(valid)).toEqual(valid);
    expect(() =>
      networkDatasetSchema.parse({
        ...valid,
        hashRate: { ...valid.hashRate, change30dPct: null },
      }),
    ).not.toThrow();
  });

  it('rejects a wrong unit and a mis-ordered series', () => {
    expect(() =>
      networkDatasetSchema.parse({ ...valid, hashRate: { ...valid.hashRate, unit: 'TH/s' } }),
    ).toThrow();
    expect(() =>
      networkDatasetSchema.parse({
        ...valid,
        txCount: { ...valid.txCount, series: [...valid.txCount.series].reverse() },
      }),
    ).toThrow('not strictly ascending');
  });
});
