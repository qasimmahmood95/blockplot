import { yearlyReturnsFromCloses } from './holding';
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
    lastClosePerMonth.set(day.date.slice(0, 7), day.price);
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

/**
 * Each calendar year's return, from the closes rather than from the months.
 *
 * This compounded the twelve monthly returns, which are already rounded to two
 * decimals, so the residue accumulated: measured against the direct ratio, 2013
 * came out 5327.45% against 5327.41%, 2017 1216.32% against 1216.38%, 2024
 * 119.77% against 119.83%. A quarter of a percentage point, and in the wrong
 * place — the holding-period matrix anchors on this definition so its diagonal
 * reconciles with the yearly totals published here, and that reconciliation has
 * to be exact or the two pages disagree with nothing saying which to believe.
 *
 * The definition lives in `holding.ts` and is called from both, so there is one
 * of it. The monthly figures stay rounded: they are what each cell displays.
 */
export function yearlyReturns(history: DailyPrice[]): YearlyReturn[] {
  return yearlyReturnsFromCloses(history);
}

export function buildMonthlyDataset(
  history: DailyPrice[],
  opts: { fetchedAt: string },
): Omit<MonthlyDataset, 'currency'> {
  const last = history.at(-1);
  if (!last) throw new Error('buildMonthlyDataset: empty history');
  const months = monthlyReturns(history);
  return {
    schemaVersion: 1,
    source: 'blockchain.info',
    fetchedAt: opts.fetchedAt,
    asOf: last.date,
    months,
    years: yearlyReturns(history),
  };
}
