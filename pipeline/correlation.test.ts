import { describe, expect, it } from 'vitest';
import {
  alignReturns,
  buildCorrelationDataset,
  CORRELATION_ASSETS,
  pearson,
  rollingCorrelation,
} from './correlation';
import { correlationDatasetSchema } from './schema';

// Two calendars with a gap: y has no 2024-01-03, so the shared dates are
// 01, 02, 04, 05 and the 02->04 return spans the gap. Expected values were
// derived independently from the documented formulas.
const x = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-01-02', value: 110 },
  { date: '2024-01-03', value: 105 },
  { date: '2024-01-04', value: 121 },
  { date: '2024-01-05', value: 115 },
];
const y = [
  { date: '2024-01-01', value: 50 },
  { date: '2024-01-02', value: 55 },
  { date: '2024-01-04', value: 66 },
  { date: '2024-01-05', value: 60 },
];

describe('alignReturns', () => {
  it('intersects calendars and spans gaps with one multi-day return', () => {
    const aligned = alignReturns(x, y);
    expect(aligned.map((r) => r.date)).toEqual(['2024-01-02', '2024-01-04', '2024-01-05']);
    expect(aligned[0]?.ra).toBeCloseTo(Math.log(1.1), 12);
    expect(aligned[0]?.rb).toBeCloseTo(Math.log(1.1), 12);
    expect(aligned[1]?.ra).toBeCloseTo(Math.log(121 / 110), 12);
    expect(aligned[1]?.rb).toBeCloseTo(Math.log(1.2), 12);
    expect(aligned[2]?.rb).toBeCloseTo(Math.log(60 / 66), 12);
  });

  it('is empty with fewer than two shared dates', () => {
    expect(alignReturns(x, [{ date: '2024-01-02', value: 1 }])).toEqual([]);
  });
});

describe('pearson', () => {
  it('is 1 for identical return paths and -1 for inverted ones', () => {
    const closes = [100, 110, 105, 121, 115];
    const scaled = closes.map((v) => 2 * v);
    const inverted = closes.map((v) => 1_000_000 / v);
    const rets = (vals: number[]) => vals.slice(1).map((v, i) => Math.log(v / (vals[i] ?? 1)));
    expect(pearson(rets(closes), rets(scaled))).toBeCloseTo(1, 12);
    expect(pearson(rets(closes), rets(inverted))).toBeCloseTo(-1, 12);
  });

  it('is null below 2 observations, on length mismatch, and at zero variance', () => {
    expect(pearson([1], [1])).toBeNull();
    expect(pearson([1, 2], [1])).toBeNull();
    expect(pearson([1, 1], [1, 2])).toBeNull();
  });
});

describe('rollingCorrelation', () => {
  it('applies the calendar window, minObs floor, and zero-variance skip', () => {
    // Window 3 calendar days, minObs 2, over the aligned fixture returns:
    // 01-02 has 1 return (below minObs); 01-04's window holds the 01-02 and
    // 01-04 returns but x's are identical (zero variance) so it is skipped;
    // 01-05's window (> 01-02) holds the 01-04 and 01-05 returns -> corr 1.
    expect(rollingCorrelation(x, y, 3, 2)).toEqual([{ date: '2024-01-05', corr: 1 }]);
  });

  it('rounds interior correlations to 2 dp', () => {
    // Window wide enough to hold all three returns at 01-05: derived 0.9519... -> 0.95.
    expect(rollingCorrelation(x, y, 30, 3)).toEqual([{ date: '2024-01-05', corr: 0.95 }]);
  });
});

describe('buildCorrelationDataset', () => {
  const series = { btc: x, sp500: y, gold: x, dxy: y };
  const dataset = buildCorrelationDataset(series, {
    fetchedAt: '2024-01-05T12:00:00.000Z',
    asOf: '2024-01-05',
    displayFrom: '2024-01-05',
    windowDays: 30,
    minObs: 3,
  });

  it('enumerates all six pairs in fixed asset order', () => {
    expect(dataset.pairs.map((p) => p.pair)).toEqual([
      'btc-sp500',
      'btc-gold',
      'btc-dxy',
      'sp500-gold',
      'sp500-dxy',
      'gold-dxy',
    ]);
    expect(CORRELATION_ASSETS).toEqual(['btc', 'sp500', 'gold', 'dxy']);
  });

  it('clips to displayFrom and carries identical-series pairs at corr 1', () => {
    const btcGold = dataset.pairs.find((p) => p.pair === 'btc-gold');
    expect(btcGold?.series).toEqual([{ date: '2024-01-05', corr: 1 }]);
    const btcSp = dataset.pairs.find((p) => p.pair === 'btc-sp500');
    expect(btcSp?.series).toEqual([{ date: '2024-01-05', corr: 0.95 }]);
  });

  it('produces output the on-disk schema accepts', () => {
    expect(() => correlationDatasetSchema.parse({ ...dataset, currency: 'usd' })).not.toThrow();
  });
});
