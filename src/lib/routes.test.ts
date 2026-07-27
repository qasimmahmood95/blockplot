import { describe, expect, it } from 'vitest';
import { currencyPath } from './currency';
import { pageForPath } from './routes';

describe('pageForPath', () => {
  it('identifies the section a path is on, in either currency', () => {
    expect(pageForPath('/blockplot/volatility/')).toBe('volatility');
    expect(pageForPath('/blockplot/gbp/volatility/')).toBe('volatility');
    expect(pageForPath('/blockplot/network')).toBe('network');
  });

  it('falls back to the overview only for the roots', () => {
    // The overview slug is empty, so testing it first would match every
    // path and send the currency switcher home from every page.
    expect(pageForPath('/blockplot/')).toBe('');
    expect(pageForPath('/blockplot/gbp/')).toBe('');
    expect(pageForPath('/blockplot/nonsense/')).toBe('');
  });
});

describe('currencyPath round trip', () => {
  it('swaps currency while staying on the same section', () => {
    const path = '/blockplot/gbp/dca/';
    expect(currencyPath('/blockplot', 'usd', pageForPath(path))).toBe('/blockplot/dca/');
    expect(currencyPath('/blockplot', 'gbp', pageForPath('/blockplot/dca/'))).toBe(
      '/blockplot/gbp/dca/',
    );
    expect(currencyPath('/blockplot', 'gbp', pageForPath('/blockplot/'))).toBe('/blockplot/gbp/');
  });
});
