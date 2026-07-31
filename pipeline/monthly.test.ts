import { describe, expect, it } from 'vitest';
import { buildMonthlyDataset, monthlyReturns, yearlyReturns } from './monthly';
import { monthlyDatasetSchema } from './schema';

// Sparse history: the last close of each month wins; December 2024 is absent
// so January 2025's return spans the gap. Ratios are exact: 99/110 = 0.9,
// 108.9/99 = 1.1, 119.79/108.9 = 1.1, 131.769/119.79 = 1.1.
const history = [
  { date: '2024-01-15', price: 100 },
  { date: '2024-01-31', price: 110 },
  { date: '2024-02-10', price: 105 },
  { date: '2024-02-29', price: 99 },
  { date: '2024-03-31', price: 108.9 },
  { date: '2024-04-10', price: 119.79 },
  { date: '2025-01-31', price: 131.769 },
];

describe('monthlyReturns', () => {
  it('takes each month\'s last close, skips the basis-less first month, spans gaps', () => {
    expect(monthlyReturns(history)).toEqual([
      { year: 2024, month: 2, returnPct: -10 },
      { year: 2024, month: 3, returnPct: 10 },
      { year: 2024, month: 4, returnPct: 10 },
      { year: 2025, month: 1, returnPct: 10 }, // Dec absent: spans Apr -> Jan
    ]);
  });

  it('is empty with fewer than two months of data', () => {
    expect(monthlyReturns(history.slice(0, 2))).toEqual([]);
  });
});

describe('yearlyReturns', () => {
  it('measures each calendar year from the closes, not from the rounded months', () => {
    // Same answer here, because the fixture's monthly returns are exact. On the
    // real history they differ: compounding twelve 2 dp figures put 2013 at
    // 5327.45% against a direct 5327.41%, and the holding-period matrix anchors
    // on this definition so the difference would have surfaced as two pages
    // disagreeing about the same year.
    expect(yearlyReturns(history)).toEqual([
      { year: 2024, returnPct: 8.9 }, // 0.9 × 1.1 × 1.1 − 1
      { year: 2025, returnPct: 10 },
    ]);
  });

  it('takes a partial first year from its own first close', () => {
    // What `monthlyReturns` does implicitly: the first month has no basis and
    // emits nothing, so the year is measured from that month's close.
    const partial = history.filter((d) => d.date >= '2024-01-31');
    expect(yearlyReturns(partial)[0]).toEqual({ year: 2024, returnPct: 8.9 });
  });
});

describe('buildMonthlyDataset', () => {
  it('assembles a schema-valid dataset with asOf from the last history day', () => {
    const dataset = buildMonthlyDataset(history, { fetchedAt: '2025-01-31T12:00:00.000Z' });
    expect(dataset.asOf).toBe('2025-01-31');
    expect(dataset.months).toHaveLength(4);
    expect(dataset.years).toHaveLength(2);
    expect(() => monthlyDatasetSchema.parse({ ...dataset, currency: 'usd' })).not.toThrow();
  });

  it('rejects empty history', () => {
    expect(() => buildMonthlyDataset([], { fetchedAt: 'x' })).toThrow('empty history');
  });
});
