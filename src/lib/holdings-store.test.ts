import { describe, expect, it } from 'vitest';
import { parseHoldings } from './holdings-store';

/**
 * Stored holdings are untrusted input: localStorage is shared with anything
 * else on the origin, survives a deploy that changes this shape, and can be
 * edited by hand. Every one of these cases renders NaN or worse if it gets
 * through.
 */
describe('parseHoldings', () => {
  it('accepts a well-formed record', () => {
    expect(parseHoldings('{"btc":0.35,"cost":12000,"costCurrency":"gbp"}')).toEqual({
      btc: 0.35,
      cost: 12000,
      costCurrency: 'gbp',
    });
  });

  it('accepts a null cost, which is the no-cost-basis case', () => {
    expect(parseHoldings('{"btc":0.35,"cost":null,"costCurrency":"usd"}')).toEqual({
      btc: 0.35,
      cost: null,
      costCurrency: 'usd',
    });
  });

  it('is null for nothing stored', () => {
    expect(parseHoldings(null)).toBeNull();
    expect(parseHoldings('')).toBeNull();
  });

  it('is null for anything that is not a JSON object', () => {
    expect(parseHoldings('not json')).toBeNull();
    expect(parseHoldings('"a string"')).toBeNull();
    expect(parseHoldings('42')).toBeNull();
    expect(parseHoldings('null')).toBeNull();
    expect(parseHoldings('[1,2,3]')).toBeNull();
  });

  it('rejects a missing or non-numeric btc amount', () => {
    expect(parseHoldings('{"cost":1,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":"0.35","cost":1,"costCurrency":"usd"}')).toBeNull();
  });

  it('rejects negative and non-finite numbers', () => {
    // NaN and Infinity are not JSON literals, but 1e999 parses to Infinity and
    // a hand-edited value can be negative.
    expect(parseHoldings('{"btc":-1,"cost":null,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":1e999,"cost":null,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":1,"cost":-5,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":1,"cost":1e999,"costCurrency":"usd"}')).toBeNull();
  });

  it('rejects an unknown or missing cost currency', () => {
    expect(parseHoldings('{"btc":1,"cost":1,"costCurrency":"eur"}')).toBeNull();
    expect(parseHoldings('{"btc":1,"cost":1}')).toBeNull();
    expect(parseHoldings('{"btc":1,"cost":1,"costCurrency":null}')).toBeNull();
  });

  it('rejects values that are finite but overflow once multiplied', () => {
    // 1e308 passes Number.isFinite and is typeable into a number field; times
    // a price it is Infinity, which rendered as "$∞" in the header.
    expect(parseHoldings('{"btc":1e308,"cost":null,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":21000001,"cost":null,"costCurrency":"usd"}')).toBeNull();
    expect(parseHoldings('{"btc":1,"cost":1e308,"costCurrency":"usd"}')).toBeNull();
    // The supply cap itself is a legitimate entry.
    expect(parseHoldings('{"btc":21000000,"cost":null,"costCurrency":"usd"}')?.btc).toBe(21000000);
  });

  it('normalises -0, which would split the header from the panel', () => {
    // -0 < 0 is false, so it passed the guard; the header hides at btc <= 0
    // while the panel renders, leaving the two views disagreeing.
    const parsed = parseHoldings('{"btc":-0,"cost":-0,"costCurrency":"usd"}');
    expect(Object.is(parsed?.btc, -0)).toBe(false);
    expect(Object.is(parsed?.cost, -0)).toBe(false);
    expect(parsed?.btc).toBe(0);
  });

  it('rejects an array, which is an object to typeof', () => {
    expect(parseHoldings('[]')).toBeNull();
  });

  it('does not pollute the prototype', () => {
    parseHoldings('{"btc":1,"cost":null,"costCurrency":"usd","__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts zero for both figures', () => {
    // Zero BTC and zero cost are legitimate entries, not empty ones.
    expect(parseHoldings('{"btc":0,"cost":0,"costCurrency":"usd"}')).toEqual({
      btc: 0,
      cost: 0,
      costCurrency: 'usd',
    });
  });

  it('ignores extra keys rather than rejecting the record', () => {
    // A future version adding a field must not wipe an existing reader's data.
    expect(parseHoldings('{"btc":1,"cost":null,"costCurrency":"usd","note":"x"}')).toEqual({
      btc: 1,
      cost: null,
      costCurrency: 'usd',
    });
  });
});
