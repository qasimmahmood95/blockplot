import type { DailyPrice, MonthlyDataset, MonthlyReturn, YearlyReturn } from './schema';

/**
 * Monthly close-over-close returns from the full daily history: each month's
 * value is its last available close divided by the previous month's last
 * close (a month absent from the data makes the next present month's return
 * span the gap). The first month of data has no basis and emits nothing;
 * the current month is month-to-date by construction.
 */

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};

export function monthlyReturns(history: DailyPrice[]): MonthlyReturn[] {
  const lastClosePerMonth = new Map<string, number>();
  for (const day of history) {
    lastClosePerMonth.set(day.date.slice(0, 7), day.priceUsd);
  }
  const months = [...lastClosePerMonth.keys()].sort();
  const out: MonthlyReturn[] = [];
  for (let i = 1; i < months.length; i++) {
    const month = months[i];
    const prev = months[i - 1];
    if (!month || !prev) continue;
    const close = lastClosePerMonth.get(month) as number;
    const basis = lastClosePerMonth.get(prev) as number;
    out.push({
      year: Number(month.slice(0, 4)),
      month: Number(month.slice(5, 7)),
      returnPct: round2((close / basis - 1) * 100),
    });
  }
  return out;
}

/** Compounded product of each calendar year's available monthly returns, 2 dp. */
export function yearlyReturns(months: MonthlyReturn[]): YearlyReturn[] {
  const byYear = new Map<number, number>();
  for (const m of months) {
    byYear.set(m.year, (byYear.get(m.year) ?? 1) * (1 + m.returnPct / 100));
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, factor]) => ({ year, returnPct: round2((factor - 1) * 100) }));
}

export function buildMonthlyDataset(
  history: DailyPrice[],
  opts: { fetchedAt: string },
): MonthlyDataset {
  const last = history.at(-1);
  if (!last) throw new Error('buildMonthlyDataset: empty history');
  const months = monthlyReturns(history);
  return {
    schemaVersion: 1,
    source: 'blockchain.info',
    fetchedAt: opts.fetchedAt,
    asOf: last.date,
    months,
    years: yearlyReturns(months),
  };
}
