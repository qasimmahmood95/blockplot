import { describe, expect, it } from 'vitest';
import {
  convertBenchmark,
  convertSeries,
  FX_HISTORY_FROM,
  fxLagDays,
  mergeRates,
  parseFrankfurter,
  rateLookup,
} from './fx';

// FX quotes Fri 03-01 and Mon 03-04; the weekend carries Friday's rate.
const rates = [
  { date: '2024-03-01', close: 1.25 },
  { date: '2024-03-04', close: 1.28 },
];

// Deliberately unsorted input, to pin that the lookup sorts defensively.
const unsortedRates = [rates[1] as (typeof rates)[number], rates[0] as (typeof rates)[number]];

const btc = [
  { date: '2024-02-29', price: 50 }, // before the first quote
  { date: '2024-03-01', price: 100 },
  { date: '2024-03-02', price: 110 }, // Saturday: carries 1.25
  { date: '2024-03-03', price: 90 }, // Sunday: carries 1.25
  { date: '2024-03-04', price: 128 },
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

  // The trap this lookup was rewritten to remove: a forward cursor that never
  // rewinds answers a later query correctly and then hands back that same
  // (too-late) rate for an earlier date. Every other case here queries in
  // ascending order, which the buggy version also passes.
  it('rewinds when a caller queries out of order', () => {
    const lookup = rateLookup(rates);
    expect(lookup('2024-03-04')).toBe(1.28);
    expect(lookup('2024-03-01')).toBe(1.25);
  });

  // Duplicates cannot reach here through mergeRates, but rateLookup is
  // exported, so pin the rule rather than leave it engine-defined: the sort is
  // stable, so the last entry for a date wins.
  it('resolves a duplicated date deterministically, last entry winning', () => {
    const dup = [
      { date: '2024-03-01', close: 1.25 },
      { date: '2024-03-01', close: 9.99 },
      { date: '2024-03-04', close: 1.28 },
    ];
    expect(rateLookup(dup)('2024-03-02')).toBe(9.99);
    expect(rateLookup([...dup].reverse())('2024-03-02')).toBe(1.25);
  });
});

describe('convertSeries', () => {
  it('divides each close by that day\'s rate, carrying rates over weekends', () => {
    expect(convertSeries(btc, rates, 'gbp')).toEqual([
      { date: '2024-03-01', price: 80 }, // 100 / 1.25
      { date: '2024-03-02', price: 88 }, // 110 / 1.25 (carried)
      { date: '2024-03-03', price: 72 }, // 90 / 1.25 (carried)
      { date: '2024-03-04', price: 100 }, // 128 / 1.28
    ]);
  });

  // The blocker this unrounding fixed: rounding a converted close to 2 dp is
  // an 11% error on a 2010 sub-dollar price, and it propagates straight into
  // the monthly heatmap's early rows.
  it('keeps full precision on sub-unit prices instead of rounding to pennies', () => {
    const early = [
      { date: '2024-03-01', price: 0.06 },
      { date: '2024-03-04', price: 0.09 },
    ];
    expect(convertSeries(early, rates, 'gbp')).toEqual([
      { date: '2024-03-01', price: 0.06 / 1.25 }, // 0.048, not 0.05
      { date: '2024-03-04', price: 0.09 / 1.28 }, // 0.0703125, not 0.07
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

describe('mergeRates', () => {
  it('lets later sources win per date and returns one ascending series', () => {
    const deep = [
      { date: '2024-03-01', close: 1.25 },
      { date: '2024-03-04', close: 1.26 },
    ];
    const fresh = [
      { date: '2024-03-04', close: 1.28 }, // corrects the deep source
      { date: '2024-03-05', close: 1.29 }, // extends the tail
    ];
    expect(mergeRates(deep, fresh)).toEqual([
      { date: '2024-03-01', close: 1.25 },
      { date: '2024-03-04', close: 1.28 },
      { date: '2024-03-05', close: 1.29 },
    ]);
  });
});

describe('fxLagDays', () => {
  it('measures how far the last quote trails a target date', () => {
    expect(fxLagDays(rates, '2024-03-04')).toBe(0);
    expect(fxLagDays(rates, '2024-03-13')).toBe(9);
    expect(fxLagDays([], '2024-03-04')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('convertBenchmark', () => {
  it('converts benchmark closes unrounded and passes usd through', () => {
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

describe('parseFrankfurter', () => {
  it('flattens the ECB time series into ascending daily rates', () => {
    expect(
      parseFrankfurter({
        base: 'GBP',
        rates: {
          '2024-03-04': { USD: 1.28 },
          '2024-03-01': { USD: 1.25 },
        },
      }),
    ).toEqual([
      { date: '2024-03-01', close: 1.25 },
      { date: '2024-03-04', close: 1.28 },
    ]);
  });

  it('rejects a malformed or empty payload', () => {
    expect(() => parseFrankfurter({ rates: { '2024-03-01': { EUR: 1.17 } } })).toThrow();
    expect(() => parseFrankfurter({})).toThrow();
    expect(() => parseFrankfurter({ rates: {} })).toThrow('no rates');
  });
});

describe('FX_HISTORY_FROM', () => {
  it('sits before any BTC close a source could return', () => {
    // blockchain.com's history starts 2010-07 at the earliest, and BTC had no
    // price at all before late 2009. run.ts enforces the real invariant — that
    // converting drops no day — and throws naming this constant if it ever
    // stops holding.
    expect(FX_HISTORY_FROM < '2010-01-01').toBe(true);
  });
});
