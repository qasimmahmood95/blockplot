import { describe, expect, it } from 'vitest';
import { benchmarkDatasetSchema, correlationDatasetSchema, riskDatasetSchema } from './schema';
import { marketChartSchema, priceDatasetSchema } from './schema';

describe('marketChartSchema', () => {
  it('accepts the documented shape and strips extra keys', () => {
    expect(
      marketChartSchema.parse({ prices: [[1704067200000, 42000]], market_caps: [] }),
    ).toEqual({ prices: [[1704067200000, 42000]] });
  });

  it('rejects malformed price points and empty payloads', () => {
    expect(() => marketChartSchema.parse({ prices: [[1704067200000, '42000']] })).toThrow();
    expect(() => marketChartSchema.parse({})).toThrow();
    expect(() => marketChartSchema.parse({ prices: [] })).toThrow();
  });
});

describe('priceDatasetSchema', () => {
  const valid = {
    schemaVersion: 1,
    source: 'coingecko',
    fetchedAt: '2024-03-08T12:00:00.000Z',
    rangeDays: '365',
    stats: {
      latestDate: '2024-03-08',
      latestPriceUsd: 46620,
      change7dPct: 11,
      change30dPct: null,
      rangeHighUsd: 47000,
      rangeHighDate: '2024-03-07',
    },
    series: [
      { date: '2024-03-07', priceUsd: 47000 },
      { date: '2024-03-08', priceUsd: 46620 },
    ],
  };

  it('accepts the documented shape', () => {
    expect(priceDatasetSchema.parse(valid)).toEqual(valid);
  });

  it('rejects non-positive prices and mis-ordered series', () => {
    expect(() =>
      priceDatasetSchema.parse({
        ...valid,
        series: [valid.series[0], { date: '2024-03-08', priceUsd: 0 }],
      }),
    ).toThrow();
    expect(() =>
      priceDatasetSchema.parse({ ...valid, series: [...valid.series].reverse() }),
    ).toThrow('not strictly ascending');
  });
});

describe('benchmarkDatasetSchema', () => {
  const valid = {
    schemaVersion: 1,
    fetchedAt: '2024-03-08T12:00:00.000Z',
    keepDays: 400,
    benchmarks: [
      {
        asset: 'sp500',
        source: 'fred',
        sourceSeries: 'SP500',
        series: [
          { date: '2024-03-01', close: 5000 },
          { date: '2024-03-04', close: 5100 },
        ],
      },
      {
        asset: 'gold',
        source: 'yahoo',
        sourceSeries: 'GC=F',
        series: [
          { date: '2024-03-01', close: 2050 },
          { date: '2024-03-04', close: 2080 },
        ],
      },
      {
        asset: 'dxy',
        source: 'yahoo',
        sourceSeries: 'DX-Y.NYB',
        series: [
          { date: '2024-03-01', close: 104 },
          { date: '2024-03-04', close: 104.5 },
        ],
      },
    ],
  };

  it('accepts the documented shape', () => {
    expect(benchmarkDatasetSchema.parse(valid)).toEqual(valid);
  });

  it('requires exactly the three distinct assets', () => {
    expect(() =>
      benchmarkDatasetSchema.parse({ ...valid, benchmarks: valid.benchmarks.slice(0, 2) }),
    ).toThrow();
    expect(() =>
      benchmarkDatasetSchema.parse({
        ...valid,
        benchmarks: [valid.benchmarks[0], valid.benchmarks[1], valid.benchmarks[0]],
      }),
    ).toThrow('duplicate benchmark asset');
  });

  it('rejects unknown assets, bad dates, and non-positive closes', () => {
    expect(() =>
      benchmarkDatasetSchema.parse({
        ...valid,
        benchmarks: [{ ...valid.benchmarks[0], asset: 'oil' }],
      }),
    ).toThrow();
    expect(() =>
      benchmarkDatasetSchema.parse({
        ...valid,
        benchmarks: [{ ...valid.benchmarks[0], series: [{ date: '03/01/2024', close: 5000 }] }],
      }),
    ).toThrow();
    expect(() =>
      benchmarkDatasetSchema.parse({
        ...valid,
        benchmarks: [
          {
            ...valid.benchmarks[0],
            series: [
              { date: '2024-03-01', close: 0 },
              { date: '2024-03-04', close: 5100 },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('correlationDatasetSchema', () => {
  const valid = {
    schemaVersion: 1,
    fetchedAt: '2024-03-08T12:00:00.000Z',
    asOf: '2024-03-08',
    windowDays: 90,
    minObs: 40,
    pairs: [
      { pair: 'btc-sp500', a: 'btc', b: 'sp500', series: [{ date: '2024-03-08', corr: -0.27 }] },
      { pair: 'gold-dxy', a: 'gold', b: 'dxy', series: [] },
    ],
  };

  it('accepts the documented shape, including empty pair series', () => {
    expect(correlationDatasetSchema.parse(valid)).toEqual(valid);
  });

  it('rejects out-of-range correlations, unknown pair ids, and bad dates', () => {
    const withSeries = (series: unknown) => ({
      ...valid,
      pairs: [{ ...valid.pairs[0], series }],
    });
    expect(() => correlationDatasetSchema.parse(withSeries([{ date: '2024-03-08', corr: 1.5 }]))).toThrow();
    expect(() =>
      correlationDatasetSchema.parse({
        ...valid,
        pairs: [{ ...valid.pairs[0], pair: 'btc-oil' }],
      }),
    ).toThrow();
    expect(() => correlationDatasetSchema.parse(withSeries([{ date: '03/08/2024', corr: 0.5 }]))).toThrow();
  });
});

describe('riskDatasetSchema', () => {
  const valid = {
    schemaVersion: 2,
    fetchedAt: '2024-03-08T12:00:00.000Z',
    asOf: '2024-03-08',
    windowDays: 8,
    rollingVolSource: 'coingecko',
    rollingVol: [{ windowDays: 30, series: [{ date: '2024-03-08', volPct: 45.1 }] }],
    drawdown: {
      maxDrawdownPct: -10,
      peakDate: '2024-03-02',
      troughDate: '2024-03-03',
      series: [
        { date: '2024-03-02', drawdownPct: 0 },
        { date: '2024-03-03', drawdownPct: -10 },
      ],
    },
    comparison: [
      {
        asset: 'btc',
        periodsPerYear: 365,
        observations: 8,
        firstDate: '2024-03-01',
        lastDate: '2024-03-08',
        totalReturnPct: 15.72,
        annualizedVolPct: 164.79,
        sharpe: 4.62,
        sortino: null,
        maxDrawdownPct: -10,
      },
    ],
  };

  it('accepts the documented shape, including null ratios', () => {
    expect(riskDatasetSchema.parse(valid)).toEqual(valid);
  });

  it('rejects positive drawdowns, negative vol, and unknown annualization bases', () => {
    expect(() =>
      riskDatasetSchema.parse({
        ...valid,
        drawdown: { ...valid.drawdown, maxDrawdownPct: 10 },
      }),
    ).toThrow();
    expect(() =>
      riskDatasetSchema.parse({
        ...valid,
        rollingVol: [{ windowDays: 30, series: [{ date: '2024-03-08', volPct: -1 }] }],
      }),
    ).toThrow();
    expect(() =>
      riskDatasetSchema.parse({
        ...valid,
        comparison: [{ ...valid.comparison[0], periodsPerYear: 260 }],
      }),
    ).toThrow();
  });
});
