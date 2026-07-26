import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStats, toDailySeries } from './prices';
import { marketChartSchema } from './schema';

// Hand-written raw feed: out-of-order points plus a same-day duplicate
// (a midnight close followed by an intraday "now" point on 2024-01-08).
const fixture = marketChartSchema.parse(
  JSON.parse(readFileSync(new URL('./fixtures/market-chart.json', import.meta.url), 'utf8')),
);

describe('toDailySeries', () => {
  it('sorts, collapses to one entry per UTC day, and lets the last value win', () => {
    expect(toDailySeries(fixture.prices)).toEqual([
      { date: '2024-01-01', priceUsd: 42000 },
      { date: '2024-01-02', priceUsd: 44100 },
      { date: '2024-01-03', priceUsd: 43000 },
      { date: '2024-01-04', priceUsd: 45000 },
      { date: '2024-01-05', priceUsd: 46000 },
      { date: '2024-01-06', priceUsd: 44500 },
      { date: '2024-01-07', priceUsd: 47000 },
      { date: '2024-01-08', priceUsd: 46620 },
    ]);
  });
});

describe('computeStats', () => {
  it('derives exact headline figures from the fixture series', () => {
    expect(computeStats(toDailySeries(fixture.prices))).toEqual({
      latestDate: '2024-01-08',
      latestPriceUsd: 46620,
      change7dPct: 11, // 42000 -> 46620
      change30dPct: null, // series shorter than 31 days
      rangeHighUsd: 47000,
      rangeHighDate: '2024-01-07',
    });
  });

  it('computes 30d change and resolves range-high ties to the earliest day', () => {
    const series = Array.from({ length: 31 }, (_, i) => ({
      date: `2024-03-${String(i + 1).padStart(2, '0')}`,
      priceUsd: i < 24 ? 100 : 110,
    }));
    expect(computeStats(series)).toEqual({
      latestDate: '2024-03-31',
      latestPriceUsd: 110,
      change7dPct: 10, // day 24 (100) -> day 31 (110)
      change30dPct: 10, // day 1 (100) -> day 31 (110)
      rangeHighUsd: 110,
      rangeHighDate: '2024-03-25',
    });
  });

  it('rejects an empty series', () => {
    expect(() => computeStats([])).toThrow('empty series');
  });
});
