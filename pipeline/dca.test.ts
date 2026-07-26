import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  compareDcaVsLumpSum,
  purchaseDates,
  simulateDca,
  simulateLumpSum,
} from './dca';
import type { DailyPrice } from './schema';

// Daily January 2024 history with hand-picked purchase-day prices chosen so
// every buy of $99 net (after the 1% fee on $100) yields a terminating BTC
// amount: 99/100, 99/110, 99/90, 99/99, 99/120. Non-purchase days close at
// 100 except the 110 finish.
const january: DailyPrice[] = Array.from({ length: 31 }, (_, i) => {
  const date = `2024-01-${String(i + 1).padStart(2, '0')}`;
  const specials: Record<string, number> = {
    '2024-01-01': 100,
    '2024-01-08': 110,
    '2024-01-15': 90,
    '2024-01-22': 99,
    '2024-01-29': 120,
    '2024-01-31': 110,
  };
  return { date, priceUsd: specials[date] ?? 100 };
});

describe('addMonthsClamped', () => {
  it('keeps the day when possible and clamps to month length otherwise', () => {
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonthsClamped('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonthsClamped('2024-03-31', 1)).toBe('2024-04-30');
    expect(addMonthsClamped('2024-08-31', 6)).toBe('2025-02-28');
    expect(addMonthsClamped('2024-01-15', 2)).toBe('2024-03-15');
  });
});

describe('purchaseDates', () => {
  const dates = january.map((d) => d.date);

  it('schedules weekly from the start date', () => {
    expect(purchaseDates(dates, '2024-01-01', 'weekly')).toEqual([
      '2024-01-01',
      '2024-01-08',
      '2024-01-15',
      '2024-01-22',
      '2024-01-29',
    ]);
  });

  it('maps scheduled dates across history gaps to the next available day', () => {
    expect(purchaseDates(['2024-01-01', '2024-01-09', '2024-01-15'], '2024-01-01', 'weekly')).toEqual(
      ['2024-01-01', '2024-01-09', '2024-01-15'],
    );
  });

  it('collapses schedules landing on the same history date and stops at the end', () => {
    expect(purchaseDates(['2024-01-01', '2024-01-20'], '2024-01-01', 'weekly')).toEqual([
      '2024-01-01',
      '2024-01-20',
    ]);
    expect(purchaseDates(dates, '2024-02-01', 'weekly')).toEqual([]);
  });
});

describe('simulateDca', () => {
  const result = simulateDca(january, {
    startDate: '2024-01-01',
    amountUsd: 100,
    frequency: 'weekly',
    feePct: 1,
  });

  it('derives exact purchases, fees, and BTC accumulated', () => {
    expect(result.purchases.map((p) => p.btcBought)).toEqual([
      99 / 100,
      99 / 110,
      99 / 90,
      99 / 99,
      99 / 120,
    ]);
    expect(result.totalInvestedUsd).toBe(500);
    expect(result.totalFeesUsd).toBe(5);
    expect(result.btcAccumulated).toBe(4.815);
  });

  it('derives the exact final value and return', () => {
    expect(result.finalValueUsd).toBe(529.65); // 4.815 BTC × $110
    expect(result.returnPct).toBe(5.93);
  });

  it('counts undeployed cash toward wealth so the series starts at the full budget', () => {
    expect(result.series[0]).toEqual({ date: '2024-01-01', wealthUsd: 499 }); // 0.99×100 + 400
    const jan8 = result.series.find((p) => p.date === '2024-01-08');
    expect(jan8?.wealthUsd).toBe(507.9); // (0.99+0.9)×110 + 300
    expect(result.series.at(-1)?.wealthUsd).toBe(529.65);
    expect(result.series).toHaveLength(31);
  });

  it('handles monthly schedules with month-end clamping over a gapped history', () => {
    const gapped: DailyPrice[] = [
      { date: '2024-01-31', priceUsd: 100 },
      { date: '2024-02-29', priceUsd: 125 },
      { date: '2024-03-31', priceUsd: 80 },
      { date: '2024-04-30', priceUsd: 51 },
    ];
    const monthly = simulateDca(gapped, {
      startDate: '2024-01-31',
      amountUsd: 100,
      frequency: 'monthly',
      feePct: 0,
    });
    expect(monthly.purchases.map((p) => p.date)).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
      '2024-04-30',
    ]);
    expect(monthly.btcAccumulated).toBe(5.01078431); // 1 + 0.8 + 1.25 + 100/51, 8 dp
    expect(monthly.finalValueUsd).toBe(255.55);
    expect(monthly.returnPct).toBe(-36.11);
  });

  it('shrinks the invested budget when schedules collapse onto one day', () => {
    // Weekly schedules 01-08 and 01-15 both map to 01-20 and collapse, so
    // only 2 of 3 scheduled buys happen and the budget is 200, not 300 —
    // the lump sum then gets the same post-collapse budget.
    const sparse: DailyPrice[] = [
      { date: '2024-01-01', priceUsd: 100 },
      { date: '2024-01-20', priceUsd: 50 },
    ];
    const cmp = compareDcaVsLumpSum(sparse, {
      startDate: '2024-01-01',
      amountUsd: 100,
      frequency: 'weekly',
      feePct: 0,
    });
    expect(cmp.dca.purchases.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-20']);
    expect(cmp.dca.totalInvestedUsd).toBe(200);
    expect(cmp.dca.btcAccumulated).toBe(3); // 1 + 2
    expect(cmp.lumpSum.totalInvestedUsd).toBe(200);
    expect(cmp.lumpSum.btcAccumulated).toBe(2); // 200/100 at day one
  });

  it('rejects non-positive amounts, out-of-range fees, and starts beyond history', () => {
    const opts = { startDate: '2024-01-01', frequency: 'weekly' as const };
    expect(() => simulateDca(january, { ...opts, amountUsd: 0, feePct: 1 })).toThrow('positive');
    expect(() => simulateDca(january, { ...opts, amountUsd: 100, feePct: 100 })).toThrow('[0, 100)');
    expect(() =>
      simulateDca(january, { startDate: '2024-06-01', amountUsd: 100, frequency: 'weekly', feePct: 1 }),
    ).toThrow('no purchases');
  });
});

describe('simulateLumpSum and compareDcaVsLumpSum', () => {
  it('invests the whole budget once with the same fee rate', () => {
    const lump = simulateLumpSum(january, { startDate: '2024-01-01', totalUsd: 500, feePct: 1 });
    expect(lump.purchases).toHaveLength(1);
    expect(lump.btcAccumulated).toBe(4.95); // 495/100
    expect(lump.totalFeesUsd).toBe(5);
    expect(lump.finalValueUsd).toBe(544.5);
    expect(lump.returnPct).toBe(8.9);
  });

  it('compares both strategies over the same budget and start', () => {
    const cmp = compareDcaVsLumpSum(january, {
      startDate: '2024-01-01',
      amountUsd: 100,
      frequency: 'weekly',
      feePct: 1,
    });
    expect(cmp.dca.finalValueUsd).toBe(529.65);
    expect(cmp.lumpSum.finalValueUsd).toBe(544.5);
    expect(cmp.deltaUsd).toBe(14.85);
  });
});
