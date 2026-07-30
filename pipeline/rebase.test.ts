import { describe, expect, it } from 'vitest';
import { rebase, rebaseAll, totalReturnPct, type AssetSeries } from './rebase';

const rows = (...pairs: [string, number][]): AssetSeries['rows'] =>
  pairs.map(([date, value]) => ({ date, value }));

// BTC trades every day; the S&P does not. 2024-01-06 and 07 are a weekend.
const btc: AssetSeries = {
  asset: 'btc',
  rows: rows(
    ['2024-01-04', 100],
    ['2024-01-05', 110],
    ['2024-01-06', 120],
    ['2024-01-07', 130],
    ['2024-01-08', 140],
  ),
};
const sp500: AssetSeries = {
  asset: 'sp500',
  rows: rows(['2024-01-04', 4000], ['2024-01-05', 4040], ['2024-01-08', 4080]),
};

describe('rebase', () => {
  it('indexes to 100 at the first observation on or after the start', () => {
    const r = rebase(btc, '2024-01-05');
    expect(r?.baseDate).toBe('2024-01-05');
    expect(r?.baseValue).toBe(110);
    expect(r?.series).toEqual([
      { date: '2024-01-05', index: 100 },
      { date: '2024-01-06', index: 109.09 },
      { date: '2024-01-07', index: 118.18 },
      { date: '2024-01-08', index: 127.27 },
    ]);
  });

  it('skips forward to the next available day rather than interpolating', () => {
    // Asked for the Saturday, the S&P starts on the Monday. Inventing a
    // Saturday price would be inventing a session.
    const r = rebase(sp500, '2024-01-06');
    expect(r?.baseDate).toBe('2024-01-08');
    expect(r?.series).toEqual([{ date: '2024-01-08', index: 100 }]);
  });

  it('reports the final index, which is the total return plus 100', () => {
    const r = rebase(btc, '2024-01-04');
    expect(r?.finalIndex).toBe(140);
    expect(totalReturnPct(r!)).toBe(40);
  });

  it('handles a fall as readily as a rise', () => {
    const falling: AssetSeries = { asset: 'x', rows: rows(['2024-01-01', 200], ['2024-01-02', 150]) };
    const r = rebase(falling, '2024-01-01');
    expect(r?.finalIndex).toBe(75);
    expect(totalReturnPct(r!)).toBe(-25);
  });

  it('is null when the window holds nothing', () => {
    expect(rebase(btc, '2026-01-01')).toBeNull();
    expect(rebase({ asset: 'x', rows: [] }, '2024-01-01')).toBeNull();
  });

  it('is null on a non-positive base rather than dividing by it', () => {
    // An index is a ratio. A zero base gives Infinity and a negative one flips
    // every sign — both plot, and neither means anything.
    expect(rebase({ asset: 'x', rows: rows(['2024-01-01', 0], ['2024-01-02', 5]) }, '2024-01-01')).toBeNull();
    expect(rebase({ asset: 'x', rows: rows(['2024-01-01', -1], ['2024-01-02', 5]) }, '2024-01-01')).toBeNull();
  });

  it('keeps a single point at exactly 100', () => {
    const r = rebase({ asset: 'x', rows: rows(['2024-01-01', 42]) }, '2024-01-01');
    expect(r?.series).toEqual([{ date: '2024-01-01', index: 100 }]);
    expect(totalReturnPct(r!)).toBe(0);
  });
});

describe('rebaseAll', () => {
  it('bases every series on the first day all of them have a price', () => {
    // Asked for the Saturday: BTC could start there and the S&P could not, so
    // both start on the Monday. Otherwise BTC would carry two days of move the
    // S&P never had a chance to answer, permanently, in every later point.
    const out = rebaseAll([btc, sp500], '2024-01-06');
    expect(out?.baseDate).toBe('2024-01-08');
    expect(out?.series.map((s) => [s.asset, s.baseDate, s.finalIndex])).toEqual([
      ['btc', '2024-01-08', 100],
      ['sp500', '2024-01-08', 100],
    ]);
  });

  it('takes the latest first-available date, not the earliest', () => {
    const out = rebaseAll([btc, sp500], '2024-01-05');
    // BTC has the 5th, the S&P has the 5th too, so the base is the 5th.
    expect(out?.baseDate).toBe('2024-01-05');
    const btcOut = out?.series.find((s) => s.asset === 'btc');
    const spOut = out?.series.find((s) => s.asset === 'sp500');
    expect(btcOut?.baseValue).toBe(110);
    expect(spOut?.baseValue).toBe(4040);
    // Same window, so the comparison is like-for-like: BTC +27.27%, S&P +0.99%.
    expect(totalReturnPct(btcOut!)).toBe(27.27);
    expect(totalReturnPct(spOut!)).toBe(0.99);
  });

  it('records a base date later than the one asked for', () => {
    const late: AssetSeries = {
      asset: 'late',
      rows: rows(['2024-01-05', 10], ['2024-01-08', 11]),
    };
    const out = rebaseAll([btc, late], '2024-01-04');
    // Asked for the 4th; `late` has nothing until the 5th, so both start there.
    expect(out?.baseDate).toBe('2024-01-05');
    expect(out?.series.map((s) => s.baseDate)).toEqual(['2024-01-05', '2024-01-05']);
  });

  it('is null when the common base falls past the end of another series', () => {
    // `late` forces a base of 2024-02-01, which is past BTC's last point. There
    // is no day both traded, so there is no comparison — the same rule as a
    // series with nothing in the window, reached from the other direction.
    const late: AssetSeries = { asset: 'late', rows: rows(['2024-02-01', 10], ['2024-02-02', 11]) };
    expect(rebaseAll([btc, late], '2024-01-04')).toBeNull();
  });

  it('is null when any one series has nothing in the window', () => {
    // Not "drop that line": a shared base has to exist for every line, and a
    // chart of two lines where one silently vanished is worse than no chart.
    expect(rebaseAll([btc, { asset: 'empty', rows: [] }], '2024-01-04')).toBeNull();
    expect(rebaseAll([btc, sp500], '2030-01-01')).toBeNull();
  });

  it('is null on an empty input list, which has no common base to find', () => {
    expect(rebaseAll([], '2024-01-04')).toBeNull();
  });
});
