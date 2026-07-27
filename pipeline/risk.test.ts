import { describe, expect, it } from 'vitest';
import { riskDatasetSchema } from './schema';
import {
  annualizedVolPct,
  assetRiskStats,
  buildRiskDataset,
  clampToRange,
  drawdownCurve,
  logReturns,
  rollingVol,
  sampleStd,
  sharpeRatio,
  sortinoRatio,
  type SeriesPoint,
} from './risk';

// 8-day fixture built from exact ratio steps 1.05, 0.9, 1.1, 1.0, 1.1, 0.92, 1.1,
// so every figure below is hand-derivable. Expected values were derived
// independently from the documented formulas (log returns, sample std,
// √ppy annualization, 0% risk-free/target, 2 dp rounding).
const dates = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08'];
const closes = [100, 105, 94.5, 103.95, 103.95, 114.345, 105.1974, 115.71714];
const btcFixture: SeriesPoint[] = dates.map((date, i) => ({ date, value: closes[i] ?? 0 }));

describe('logReturns', () => {
  it('computes daily log returns, one fewer than the input', () => {
    const returns = logReturns([100, 105, 94.5]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(Math.log(1.05), 12);
    expect(returns[1]).toBeCloseTo(Math.log(0.9), 12);
  });
});

describe('sampleStd', () => {
  it('uses the n − 1 denominator', () => {
    expect(sampleStd([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it('rejects fewer than 2 values', () => {
    expect(() => sampleStd([1])).toThrow('at least 2');
  });
});

describe('annualizedVolPct', () => {
  it('annualizes the sample std of ln(1.05), ln(0.9) by √365', () => {
    // std = 0.109000991…, ×√365×100 = 208.2461…
    expect(annualizedVolPct(logReturns([100, 105, 94.5]), 365)).toBe(208.25);
  });
});

describe('rollingVol', () => {
  it('starts windowDays entries in and matches hand-derived values', () => {
    expect(rollingVol(btcFixture, 3, 365)).toEqual([
      { date: '2024-03-04', volPct: 200.67 },
      { date: '2024-03-05', volPct: 191.77 },
      { date: '2024-03-06', volPct: 105.13 },
      { date: '2024-03-07', volPct: 170.82 },
      { date: '2024-03-08', volPct: 197.1 },
    ]);
  });

  it('is empty when the history is shorter than the window', () => {
    expect(rollingVol(btcFixture, 10, 365)).toEqual([]);
  });
});

describe('drawdownCurve', () => {
  it('tracks decline from the running peak and locates the deepest trough', () => {
    expect(drawdownCurve(btcFixture)).toEqual({
      maxDrawdownPct: -10, // 105 on 03-02 -> 94.5 on 03-03
      peakDate: '2024-03-02',
      troughDate: '2024-03-03',
      series: [
        { date: '2024-03-01', drawdownPct: 0 },
        { date: '2024-03-02', drawdownPct: 0 },
        { date: '2024-03-03', drawdownPct: -10 },
        { date: '2024-03-04', drawdownPct: -1 },
        { date: '2024-03-05', drawdownPct: -1 },
        { date: '2024-03-06', drawdownPct: 0 },
        { date: '2024-03-07', drawdownPct: -8 },
        { date: '2024-03-08', drawdownPct: 0 },
      ],
    });
  });

  it('resolves equal-depth troughs to the earliest one', () => {
    // Three exact -20% troughs (80/100, 80/100, 96/120); the first must win.
    const points = [100, 80, 90, 80, 120, 96].map((value, i) => ({
      date: `2024-04-0${i + 1}`,
      value,
    }));
    const curve = drawdownCurve(points);
    expect(curve.maxDrawdownPct).toBe(-20);
    expect(curve.peakDate).toBe('2024-04-01');
    expect(curve.troughDate).toBe('2024-04-02');
    expect(curve.series.map((p) => p.drawdownPct)).toEqual([0, -20, -10, -20, 0, -20]);
  });

  it('keeps the first date of a repeated peak value', () => {
    const points = [100, 90, 100, 85].map((value, i) => ({ date: `2024-05-0${i + 1}`, value }));
    expect(drawdownCurve(points)).toMatchObject({
      maxDrawdownPct: -15,
      peakDate: '2024-05-01',
      troughDate: '2024-05-04',
    });
  });

  it('rejects an empty series', () => {
    expect(() => drawdownCurve([])).toThrow('empty series');
  });
});

describe('sharpeRatio and sortinoRatio', () => {
  it('are null for a flat series (zero variance, no downside)', () => {
    const flat = logReturns([100, 100, 100, 100]);
    expect(sharpeRatio(flat, 365)).toBeNull();
    expect(sortinoRatio(flat, 365)).toBeNull();
  });

  it('sortino is null when no return is negative but sharpe is defined', () => {
    const rising = logReturns([100, 110, 132, 145.2]); // ratios 1.1, 1.2, 1.1
    expect(sharpeRatio(rising, 365)).toBe(47.28);
    expect(sortinoRatio(rising, 365)).toBeNull();
  });
});

describe('assetRiskStats', () => {
  it('derives the full BTC comparison row from the fixture', () => {
    expect(assetRiskStats('btc', btcFixture, 365)).toEqual({
      asset: 'btc',
      periodsPerYear: 365,
      observations: 8,
      firstDate: '2024-03-01',
      lastDate: '2024-03-08',
      totalReturnPct: 15.72,
      annualizedVolPct: 164.79,
      sharpe: 4.62,
      sortino: 7.85,
      maxDrawdownPct: -10,
    });
  });

  it('rejects a window with fewer than 3 observations', () => {
    expect(() => assetRiskStats('gold', btcFixture.slice(0, 2), 252)).toThrow('at least 3');
  });
});

describe('buildRiskDataset', () => {
  const btc = dates.map((date, i) => ({ date, priceUsd: closes[i] ?? 0 }));
  // Benchmark rows on their own trading calendars, with out-of-window rows
  // on 2024-02-29 that clamping must drop.
  const sp500 = [
    { date: '2024-02-29', close: 4990 },
    { date: '2024-03-01', close: 5000 },
    { date: '2024-03-04', close: 5100 },
    { date: '2024-03-05', close: 5050 },
    { date: '2024-03-06', close: 5150 },
    { date: '2024-03-07', close: 5100 },
    { date: '2024-03-08', close: 5253 },
  ];
  const gold = [
    { date: '2024-02-29', close: 2100 },
    { date: '2024-03-01', close: 2050 },
    { date: '2024-03-05', close: 2080 },
    { date: '2024-03-08', close: 2044.16 },
  ];
  const dataset = buildRiskDataset(btc, { sp500, gold }, {
    fetchedAt: '2024-03-08T12:00:00.000Z',
    rollingWindows: [3, 10],
  });

  it('produces output the on-disk schema accepts', () => {
    expect(() => riskDatasetSchema.parse({ ...dataset, currency: 'usd' })).not.toThrow();
  });

  it('derives rolling vol from deep history when provided, clipped to the window', () => {
    // Four pre-window days: enough for the 3d window to emit a 2024-02-29
    // point, which the clip must remove (the exact 8-element assertion below
    // proves it), and for the window to populate from 03-01 on. The first
    // three windows hold the same return multiset, so their vol is equal.
    const history = [
      { date: '2024-02-26', priceUsd: 100 },
      { date: '2024-02-27', priceUsd: 100 },
      { date: '2024-02-28', priceUsd: 105 },
      { date: '2024-02-29', priceUsd: 94.5 },
      ...btc,
    ];
    const withHistory = buildRiskDataset(btc, { sp500, gold }, {
      fetchedAt: '2024-03-08T12:00:00.000Z',
      rollingWindows: [3],
      history,
    });
    expect(withHistory.rollingVolSource).toBe('blockchain.info');
    expect(withHistory.rollingVol[0]?.series).toEqual([
      { date: '2024-03-01', volPct: 174.48 },
      { date: '2024-03-02', volPct: 174.48 },
      { date: '2024-03-03', volPct: 174.48 },
      { date: '2024-03-04', volPct: 200.67 },
      { date: '2024-03-05', volPct: 191.77 },
      { date: '2024-03-06', volPct: 105.13 },
      { date: '2024-03-07', volPct: 170.82 },
      { date: '2024-03-08', volPct: 197.1 },
    ]);
    // Drawdown and comparison stay on the spot series.
    expect(withHistory.drawdown).toEqual(dataset.drawdown);
    expect(withHistory.comparison).toEqual(dataset.comparison);
  });

  it('carries window metadata and the BTC drawdown curve', () => {
    expect(dataset.schemaVersion).toBe(2);
    expect(dataset.rollingVolSource).toBe('coingecko');
    expect(dataset.asOf).toBe('2024-03-08');
    expect(dataset.windowDays).toBe(8);
    expect(dataset.rollingVol.map((w) => [w.windowDays, w.series.length])).toEqual([
      [3, 5],
      [10, 0],
    ]);
    expect(dataset.drawdown.maxDrawdownPct).toBe(-10);
  });

  it('clamps each benchmark to the BTC date range on its own calendar', () => {
    expect(dataset.comparison.map((c) => [c.asset, c.observations, c.firstDate])).toEqual([
      ['btc', 8, '2024-03-01'],
      ['sp500', 6, '2024-03-01'],
      ['gold', 3, '2024-03-01'],
    ]);
  });

  it('derives exact benchmark comparison rows annualized by √252', () => {
    expect(dataset.comparison[1]).toEqual({
      asset: 'sp500',
      periodsPerYear: 252,
      observations: 6,
      firstDate: '2024-03-01',
      lastDate: '2024-03-08',
      totalReturnPct: 5.06,
      annualizedVolPct: 29.22,
      sharpe: 8.51,
      sortino: 25.27,
      maxDrawdownPct: -0.98, // 5100 on 03-04 -> 5050 on 03-05
    });
    expect(dataset.comparison[2]).toEqual({
      asset: 'gold',
      periodsPerYear: 252,
      observations: 3,
      firstDate: '2024-03-01',
      lastDate: '2024-03-08',
      totalReturnPct: -0.28,
      annualizedVolPct: 35.82,
      sharpe: -1,
      sortino: -1.84,
      maxDrawdownPct: -1.72, // 2080 on 03-05 -> 2044.16 on 03-08
    });
  });
});

describe('clampToRange', () => {
  it('is inclusive on both ends', () => {
    const points = [
      { date: '2024-01-01', value: 1 },
      { date: '2024-01-02', value: 2 },
      { date: '2024-01-03', value: 3 },
    ];
    expect(clampToRange(points, '2024-01-02', '2024-01-03')).toEqual(points.slice(1));
  });
});
