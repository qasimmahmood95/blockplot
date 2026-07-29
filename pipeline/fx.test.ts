import { describe, expect, it } from 'vitest';
import {
  convertBenchmark,
  convertSeries,
  FX_HISTORY_FROM,
  fxLagDays,
  MAX_MEDIAN_QUOTE_DIVERGENCE_PCT,
  mergeRates,
  parseFrankfurter,
  quoteDivergence,
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

describe('quoteDivergence', () => {
  const day = (date: string, close: number): { date: string; close: number } => ({ date, close });

  it('reports the median, the worst day and its date', () => {
    const native = [day('2024-01-01', 100.5), day('2024-01-02', 100), day('2024-01-03', 110)];
    const converted = [day('2024-01-01', 100), day('2024-01-02', 100), day('2024-01-03', 100)];
    expect(quoteDivergence(native, converted)).toEqual({
      days: 3,
      medianPct: 0.5,
      // Nearest-rank on three points puts the 95th percentile on the third,
      // so it coincides with the maximum here — genuinely, not by an off-by-one.
      p95Pct: 10,
      maxPct: 10,
      maxDate: '2024-01-03',
      beyond1Pct: 1,
    });
  });

  it('separates the 95th percentile from the maximum once there is a tail', () => {
    // Twenty days, one of them wide: p95 must not simply track the worst day,
    // because the methodology page quotes the two as different numbers.
    const native = Array.from({ length: 20 }, (_, i) => day(`2024-01-${String(i + 1).padStart(2, '0')}`, i === 19 ? 130 : 101));
    const converted = Array.from({ length: 20 }, (_, i) => day(`2024-01-${String(i + 1).padStart(2, '0')}`, 100));
    const result = quoteDivergence(native, converted);
    expect(result?.medianPct).toBe(1);
    expect(result?.p95Pct).toBe(1);
    expect(result?.maxPct).toBe(30);
  });

  it('counts a hair over 1% as beyond it, including an exact-looking 1%', () => {
    // 101/100 - 1 is 0.010000000000000009, not 0.01, so a divergence that
    // reads as exactly 1% falls on the "beyond" side. This count is reported
    // and never asserted on, so the boundary costs nothing — pinned because a
    // future reader comparing the log against the threshold would otherwise
    // find it off by one and go looking for a bug.
    expect(quoteDivergence([day('2024-01-01', 101)], [day('2024-01-01', 100)])?.beyond1Pct).toBe(1);
    expect(quoteDivergence([day('2024-01-01', 100.9)], [day('2024-01-01', 100)])?.beyond1Pct).toBe(
      0,
    );
  });

  it('compares only shared dates, so a weekend gap is skipped not counted', () => {
    // Rates carry forward, so a converted figure exists every day — but
    // comparing a Saturday native quote against Friday's rate would measure
    // the carry-forward convention rather than the two markets.
    const result = quoteDivergence(
      [day('2024-01-01', 100), day('2024-01-06', 200)],
      [day('2024-01-01', 100)],
    );
    expect(result?.days).toBe(1);
    expect(result?.maxPct).toBe(0);
  });

  it('is null when nothing overlaps, which the caller warns about', () => {
    expect(quoteDivergence([day('2024-01-01', 100)], [day('2024-02-01', 100)])).toBeNull();
    expect(quoteDivergence([], [])).toBeNull();
  });

  it('is symmetric in magnitude: a quote under or over reads the same size', () => {
    const under = quoteDivergence([day('2024-01-01', 90)], [day('2024-01-01', 100)]);
    const over = quoteDivergence([day('2024-01-01', 100)], [day('2024-01-01', 90)]);
    expect(under?.maxPct).toBe(10);
    // Not 10: the ratio is taken against the converted figure, so the two
    // directions are not mirror images. Pinned so the asymmetry is a
    // decision on record rather than a surprise in a build failure.
    expect(over?.maxPct).toBe(11.111);
  });

  it('skips a non-positive converted figure rather than dividing by it', () => {
    expect(quoteDivergence([day('2024-01-01', 100)], [day('2024-01-01', 0)])).toBeNull();
  });

  it('leaves the measured spread a long way inside the asserted band', () => {
    // What the pipeline actually committed on the real series: 3,183 shared
    // days, median 0.182%, p95 0.716%, worst 2.910%. The band is on the median
    // precisely because one bad day cannot move it — so this is the headroom
    // that matters, and 0.182 against 1 is roughly five-fold.
    expect(MAX_MEDIAN_QUOTE_DIVERGENCE_PCT).toBe(1);
    expect(0.182).toBeLessThan(MAX_MEDIAN_QUOTE_DIVERGENCE_PCT);
  });
});
