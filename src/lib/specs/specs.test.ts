import { describe, expect, it } from 'vitest';
import { defaultStartDate, wealthExtent } from './dca';
import { bandFill, pairLabel, regimeFrom, type Segment } from './correlation';
import { billions } from './flows';
import { volColor } from './vol';
import { cycleColor } from './cycles';

describe('defaultStartDate', () => {
  it('goes three years back from the last close', () => {
    expect(defaultStartDate('2010-07-18', '2026-07-28')).toBe('2023-07-28');
  });

  it('clamps to the start of history when three years reaches past it', () => {
    expect(defaultStartDate('2025-01-01', '2026-07-28')).toBe('2025-01-01');
  });

  it('rolls 29 February forward rather than producing an invalid date', () => {
    // 2021 has no 29 February; UTC arithmetic gives 1 March.
    expect(defaultStartDate('2010-01-01', '2024-02-29')).toBe('2021-03-01');
  });

  it('returns the first date when history is a single day', () => {
    expect(defaultStartDate('2026-07-28', '2026-07-28')).toBe('2026-07-28');
  });
});

describe('wealthExtent', () => {
  it('spans both series', () => {
    expect(
      wealthExtent(
        [
          { date: new Date(0), wealth: 10 },
          { date: new Date(0), wealth: 30 },
        ],
        [
          { date: new Date(0), wealth: 5 },
          { date: new Date(0), wealth: 50 },
        ],
      ),
    ).toEqual([5, 50]);
  });

  it('ignores the held stack by taking only the two it is given', () => {
    expect(wealthExtent([{ date: new Date(0), wealth: 7 }], [])).toEqual([7, 7]);
  });

  it('is unbounded on empty input, which the caller treats as no chart', () => {
    expect(wealthExtent([], [])).toEqual([Infinity, -Infinity]);
  });
});

describe('correlation helpers', () => {
  const segment = (over: Partial<Segment>): Segment => ({
    regime: 'positive',
    startDate: '2024-01-01',
    confirmedFrom: '2024-01-01',
    endDate: '2024-03-01',
    observations: 60,
    days: 60,
    meanCorr: 0.42,
    ...over,
  });

  it('paints co-moving and inverse, and deliberately not decoupled', () => {
    expect(bandFill('positive')).toBe('var(--pos)');
    expect(bandFill('negative')).toBe('var(--neg)');
    expect(bandFill('neutral')).toBeNull();
  });

  it('names a pair from the asset labels, falling back to the raw key', () => {
    expect(pairLabel({ a: 'btc', b: 'sp500' })).toBe('BTC – S&P 500');
    expect(pairLabel({ a: 'btc', b: 'nikkei' })).toBe('BTC – nikkei');
  });

  it('quotes the confirmation date only when it differs from the start', () => {
    expect(regimeFrom(segment({}))).toBe('2024-01-01');
    expect(regimeFrom(segment({ confirmedFrom: '2024-01-11' }))).toBe(
      '2024-01-01 (confirmed 2024-01-11)',
    );
  });
});

describe('axis formatting', () => {
  it('switches from billions to trillions at the threshold', () => {
    expect(billions(999e9)).toBe('$999B');
    expect(billions(1e12)).toBe('$1.00T');
    expect(billions(2.345e12)).toBe('$2.35T');
  });
});

describe('colour ramps', () => {
  it('maps each volatility window to its own step, and the unknown to ink', () => {
    expect(volColor('30d')).toBe('var(--cycle-2)');
    expect(volColor('90d')).toBe('var(--cycle-3)');
    expect(volColor('365d')).toBe('var(--cycle-4)');
    expect(volColor('7d')).toBe('var(--ink)');
  });

  it('walks the cycle ramp oldest to newest and falls back past its end', () => {
    expect([0, 1, 2, 3].map(cycleColor)).toEqual([
      'var(--cycle-1)',
      'var(--cycle-2)',
      'var(--cycle-3)',
      'var(--cycle-4)',
    ]);
    expect(cycleColor(4)).toBe('var(--accent)');
  });
});
