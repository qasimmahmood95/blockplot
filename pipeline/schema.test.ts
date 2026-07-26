import { describe, expect, it } from 'vitest';
import { benchmarkDatasetSchema, riskDatasetSchema } from './schema';
import { marketChartSchema } from './schema';

describe('marketChartSchema', () => {
  it('accepts the documented shape and strips extra keys', () => {
    expect(
      marketChartSchema.parse({ prices: [[1704067200000, 42000]], market_caps: [] }),
    ).toEqual({ prices: [[1704067200000, 42000]] });
  });

  it('rejects malformed price points', () => {
    expect(() => marketChartSchema.parse({ prices: [[1704067200000, '42000']] })).toThrow();
    expect(() => marketChartSchema.parse({})).toThrow();
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
    ],
  };

  it('accepts the documented shape', () => {
    expect(benchmarkDatasetSchema.parse(valid)).toEqual(valid);
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
