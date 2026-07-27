import { describe, expect, it } from 'vitest';
import { buildHalvingDataset, HALVING_DATES } from './halvings';
import { halvingDatasetSchema } from './schema';

// Synthetic history around two fake halvings (2020-01-05 and 2020-01-10);
// expected multiples are exact ratios of hand-picked closes.
const history = [
  { date: '2020-01-01', price: 90 },
  { date: '2020-01-03', price: 95 },
  { date: '2020-01-05', price: 100 },
  { date: '2020-01-06', price: 110 },
  { date: '2020-01-07', price: 95 },
  { date: '2020-01-08', price: 120 },
  { date: '2020-01-09', price: 130 },
  // 2020-01-10 (second halving day) missing: base falls to the 11th
  { date: '2020-01-11', price: 200 },
  { date: '2020-01-12', price: 210 },
  { date: '2020-01-13', price: 190 },
];
const dataset = buildHalvingDataset(history, {
  fetchedAt: '2020-01-13T12:00:00.000Z',
  halvings: ['2020-01-05', '2020-01-10'],
});

describe('buildHalvingDataset', () => {
  it('slices epochs, normalises to the halving-day close, and leaves the last cycle open', () => {
    expect(dataset.asOf).toBe('2020-01-13');
    expect(dataset.cycles[0]).toEqual({
      cycle: 1,
      halvingDate: '2020-01-05',
      endDate: '2020-01-10',
      basePrice: 100,
      series: [
        { day: 0, multiple: 1 },
        { day: 1, multiple: 1.1 },
        { day: 2, multiple: 0.95 },
        { day: 3, multiple: 1.2 },
        { day: 4, multiple: 1.3 },
      ],
    });
  });

  it('bases a cycle on the first available day when the halving day is missing', () => {
    expect(dataset.cycles[1]).toEqual({
      cycle: 2,
      halvingDate: '2020-01-10',
      endDate: null,
      basePrice: 200,
      series: [
        { day: 1, multiple: 1 },
        { day: 2, multiple: 1.05 },
        { day: 3, multiple: 0.95 },
      ],
    });
  });

  it('produces output the on-disk schema accepts', () => {
    expect(() => halvingDatasetSchema.parse({ ...dataset, currency: 'usd' })).not.toThrow();
  });

  it('rejects history that ends before a halving', () => {
    expect(() =>
      buildHalvingDataset(history.slice(0, 3), {
        fetchedAt: 'x',
        halvings: ['2020-01-05', '2020-06-01'],
      }),
    ).toThrow('no history at or after halving 2020-06-01');
  });

  it('rounds non-terminating multiples to 4 decimals', () => {
    const built = buildHalvingDataset(
      [
        { date: '2020-01-01', price: 3 },
        { date: '2020-01-02', price: 1 },
      ],
      { fetchedAt: 'x', halvings: ['2020-01-01'] },
    );
    expect(built.cycles[0]?.series).toEqual([
      { day: 0, multiple: 1 },
      { day: 1, multiple: 0.3333 },
    ]);
  });

  it('ships the four real halving dates', () => {
    expect(HALVING_DATES).toEqual(['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20']);
  });
});
