import { describe, expect, it } from 'vitest';
import {
  convertCost,
  holdingsSeries,
  impliedRate,
  MAX_BTC,
  MAX_COST,
  valueHoldings,
} from './holdings';

// Latest BTC close in each currency, from the committed datasets. Their ratio
// is the implied GBP/USD rate.
const latest = { usd: 65042.86, gbp: 48816.32 };

describe('impliedRate', () => {
  it('is 1 between a currency and itself', () => {
    expect(impliedRate(latest, 'usd', 'usd')).toBe(1);
    expect(impliedRate(latest, 'gbp', 'gbp')).toBe(1);
  });

  it('reads the rate off the same BTC priced in each currency', () => {
    // 65042.86 / 48816.32 = 1.3323999023..., the GBP/USD rate those closes imply.
    expect(impliedRate(latest, 'gbp', 'usd')).toBeCloseTo(1.3323999023, 9);
    expect(impliedRate(latest, 'usd', 'gbp')).toBeCloseTo(1 / 1.3323999023, 9);
  });

  it('round-trips', () => {
    const there = impliedRate(latest, 'gbp', 'usd');
    const back = impliedRate(latest, 'usd', 'gbp');
    expect(there * back).toBeCloseTo(1, 12);
  });

  it('rejects a non-positive price rather than returning nonsense', () => {
    expect(() => impliedRate({ usd: 0, gbp: 1 }, 'gbp', 'usd')).toThrow('must be positive');
    expect(() => impliedRate({ usd: 1, gbp: -1 }, 'gbp', 'usd')).toThrow('must be positive');
  });
});

/**
 * The panel puts this figure in the cost field, and the figure in the field is
 * what gets written back to storage if the reader then edits on that route. So
 * the box and `valueHoldings` have to agree exactly, which is why this is
 * exported rather than re-derived in the component.
 */
describe('convertCost', () => {
  it('restates a cost in the other currency, to the cent', () => {
    // 12000 × (65042.86 / 48816.32) = 15988.7988..., which is 15988.80.
    expect(convertCost(12000, 'gbp', 'usd', latest)).toBe(15988.8);
    expect(convertCost(12000, 'usd', 'gbp', latest)).toBe(9006.31);
  });

  it('leaves a same-currency cost alone', () => {
    expect(convertCost(12000, 'usd', 'usd', latest)).toBe(12000);
    expect(convertCost(0, 'gbp', 'gbp', latest)).toBe(0);
  });

  it('agrees to the cent with what valueHoldings charges against the value', () => {
    const valued = valueHoldings(
      { btc: 0.35, cost: 12000, costCurrency: 'gbp' },
      65042.86,
      'usd',
      latest,
    );
    expect(valued.cost).toBe(convertCost(12000, 'gbp', 'usd', latest));
  });

  it('rounds a sub-cent cost to zero rather than to -0', () => {
    // Reachable only from a hand-edited store, but -0 formats as "-$0.00".
    expect(Object.is(convertCost(1e-9, 'gbp', 'usd', latest), 0)).toBe(true);
  });

  it('throws on a non-positive price rather than converting by NaN', () => {
    expect(() => convertCost(12000, 'gbp', 'usd', { usd: 0, gbp: 1 })).toThrow('must be positive');
  });
});

describe('valueHoldings', () => {
  // Expected values derived by hand before the implementation existed:
  // 0.35 × 65042.86 = 22765.001 -> 22765.00; minus 12000 -> 10765.00;
  // 22765.001 / 12000 − 1 = 89.7083...% -> 89.71; 12000 / 0.35 = 34285.71.
  it('values a stack and prices it against what was paid', () => {
    expect(
      valueHoldings({ btc: 0.35, cost: 12000, costCurrency: 'usd' }, 65042.86, 'usd', latest),
    ).toEqual({
      value: 22765,
      cost: 12000,
      pnl: 10765,
      pnlPct: 89.71,
      avgEntry: 34285.71,
      costConverted: false,
    });
  });

  it('reports a loss as a loss', () => {
    const result = valueHoldings({ btc: 1, cost: 90000, costCurrency: 'usd' }, 65042.86, 'usd', latest);
    expect(result.pnl).toBe(-24957.14);
    expect(result.pnlPct).toBe(-27.73);
  });

  it('values without a cost basis, leaving every derived figure null', () => {
    expect(
      valueHoldings({ btc: 0.35, cost: null, costCurrency: 'usd' }, 65042.86, 'usd', latest),
    ).toEqual({
      value: 22765,
      cost: null,
      pnl: null,
      pnlPct: null,
      avgEntry: null,
      costConverted: false,
    });
  });

  it('converts a cost entered in the other currency, and says that it did', () => {
    // 12000 GBP at the implied 1.3323999 rate is 15988.80 USD.
    const result = valueHoldings(
      { btc: 0.35, cost: 12000, costCurrency: 'gbp' },
      65042.86,
      'usd',
      latest,
    );
    expect(result.cost).toBe(15988.8);
    expect(result.costConverted).toBe(true);
    expect(result.pnl).toBe(6776.2);
  });

  it('leaves a same-currency cost untouched and unflagged', () => {
    const result = valueHoldings(
      { btc: 0.5, cost: 20000, costCurrency: 'gbp' },
      48816.32,
      'gbp',
      latest,
    );
    expect(result.cost).toBe(20000);
    expect(result.costConverted).toBe(false);
    expect(result.value).toBe(24408.16);
  });

  it('has no return or entry price to report at zero cost or zero BTC', () => {
    // Both reachable from the form, and both divide by zero if not guarded.
    // Zero cost has a real entry price — nothing per coin — but no return:
    // the gain is undefined against a zero base, not infinite.
    const freeCoins = valueHoldings({ btc: 1, cost: 0, costCurrency: 'usd' }, 65042.86, 'usd', latest);
    expect(freeCoins.pnl).toBe(65042.86);
    expect(freeCoins.pnlPct).toBeNull();
    expect(freeCoins.avgEntry).toBe(0);

    const nothing = valueHoldings({ btc: 0, cost: 500, costCurrency: 'usd' }, 65042.86, 'usd', latest);
    expect(nothing.value).toBe(0);
    expect(nothing.pnl).toBe(-500);
    expect(nothing.avgEntry).toBeNull();
  });

  it('rejects a holding beyond the supply cap, which would overflow to Infinity', () => {
    // 1e308 is finite and typeable into a number field; 1e308 × a price is not.
    // Before the bound this printed "$∞" in the header of every page.
    expect(() =>
      valueHoldings({ btc: 1e308, cost: null, costCurrency: 'usd' }, 65042.86, 'usd', latest),
    ).toThrow('between 0 and');
    expect(() =>
      valueHoldings({ btc: 1, cost: 1e308, costCurrency: 'usd' }, 65042.86, 'usd', latest),
    ).toThrow('between 0 and');
    expect(MAX_BTC).toBe(21_000_000);
    expect(MAX_COST).toBe(1e13);
    // The cap itself is allowed, and still finite.
    expect(
      Number.isFinite(
        valueHoldings({ btc: MAX_BTC, cost: null, costCurrency: 'usd' }, 65042.86, 'usd', latest).value,
      ),
    ).toBe(true);
  });

  it('rejects impossible inputs rather than printing NaN', () => {
    expect(() =>
      valueHoldings({ btc: -1, cost: null, costCurrency: 'usd' }, 65042.86, 'usd', latest),
    ).toThrow('between 0 and');
    expect(() =>
      valueHoldings({ btc: 1, cost: null, costCurrency: 'usd' }, 0, 'usd', latest),
    ).toThrow('price must be positive');
  });
});

describe('holdingsSeries', () => {
  const history = [
    { date: '2024-01-01', price: 40000 },
    { date: '2024-01-02', price: 44000 },
    { date: '2024-01-03', price: 42000 },
  ];

  it('values a constant stack at each daily close', () => {
    expect(holdingsSeries(history, 0.25)).toEqual([
      { date: '2024-01-01', value: 10000 },
      { date: '2024-01-02', value: 11000 },
      { date: '2024-01-03', value: 10500 },
    ]);
  });

  it('keeps sub-cent values rather than rounding them to zero', () => {
    // BTC opens at $0.07: rounding to 2 dp zeroes every early day for a small
    // stack, and the log axis then drops them off the chart entirely.
    const early = [{ date: '2010-07-18', price: 0.07 }];
    expect(holdingsSeries(early, 0.001)[0]?.value).toBeCloseTo(0.00007, 12);
    expect(holdingsSeries(early, 0.001)[0]?.value).toBeGreaterThan(0);
  });

  it('clips to a start date', () => {
    expect(holdingsSeries(history, 0.25, '2024-01-02').map((p) => p.date)).toEqual([
      '2024-01-02',
      '2024-01-03',
    ]);
  });

  it('is flat at zero and rejects a negative stack', () => {
    expect(holdingsSeries(history, 0).every((p) => p.value === 0)).toBe(true);
    expect(() => holdingsSeries(history, -0.1)).toThrow('between 0 and');
  });
});
