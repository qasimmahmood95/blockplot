import { describe, expect, it } from 'vitest';
import { convertBenchmark, convertSeries, rateLookup } from './fx';

// FX quotes Fri 03-01 and Mon 03-04; the weekend carries Friday's rate.
const rates = [
  { date: '2024-03-01', close: 1.25 },
  { date: '2024-03-04', close: 1.28 },
];

// Deliberately unsorted input, to pin that the lookup sorts defensively.
const unsortedRates = [rates[1] as (typeof rates)[number], rates[0] as (typeof rates)[number]];

const btc = [
  { date: '2024-02-29', priceUsd: 50 }, // before the first quote
  { date: '2024-03-01', priceUsd: 100 },
  { date: '2024-03-02', priceUsd: 110 }, // Saturday: carries 1.25
  { date: '2024-03-03', priceUsd: 90 }, // Sunday: carries 1.25
  { date: '2024-03-04', priceUsd: 128 },
];

describe('rateLookup', () => {
  it('returns the rate quoted on or most recently before a date', () => {
    const lookup = rateLookup(rates);
    expect(lookup('2024-03-01')).toBe(1.25);
    expect(lookup('2024-03-02')).toBe(1.25);
    expect(lookup('2024-03-04')).toBe(1.28);
    expect(lookup('2024-06-01')).toBe(1.28); // still carrying the last quote
  });

  it('has no rate before the first quote', () => {
    expect(rateLookup(rates)('2024-02-29')).toBeNull();
    expect(rateLookup([])('2024-03-01')).toBeNull();
  });

  it('sorts unsorted input rather than trusting order', () => {
    expect(rateLookup(unsortedRates)('2024-03-02')).toBe(1.25);
  });
});

describe('convertSeries', () => {
  it('divides each close by that day\'s rate, carrying rates over weekends', () => {
    expect(convertSeries(btc, rates, 'gbp')).toEqual([
      { date: '2024-03-01', priceUsd: 80 }, // 100 / 1.25
      { date: '2024-03-02', priceUsd: 88 }, // 110 / 1.25 (carried)
      { date: '2024-03-03', priceUsd: 72 }, // 90 / 1.25 (carried)
      { date: '2024-03-04', priceUsd: 100 }, // 128 / 1.28
    ]);
  });

  it('drops days before the first quoted rate rather than inventing one', () => {
    expect(convertSeries(btc, rates, 'gbp').some((p) => p.date === '2024-02-29')).toBe(false);
  });

  it('returns the source series untouched for usd', () => {
    expect(convertSeries(btc, rates, 'usd')).toBe(btc);
  });

  it('rejects a non-positive rate', () => {
    expect(() => convertSeries(btc, [{ date: '2024-03-01', close: -1 }], 'gbp')).toThrow(
      'non-positive rate',
    );
  });
});

describe('convertBenchmark', () => {
  it('converts benchmark closes at 4 dp and passes usd through', () => {
    const sp500 = [
      { date: '2024-03-01', close: 5000 },
      { date: '2024-03-04', close: 5120 },
    ];
    expect(convertBenchmark(sp500, rates, 'gbp')).toEqual([
      { date: '2024-03-01', close: 4000 }, // 5000 / 1.25
      { date: '2024-03-04', close: 4000 }, // 5120 / 1.28
    ]);
    expect(convertBenchmark(sp500, rates, 'usd')).toBe(sp500);
  });
});
