import type { DailyPrice } from './schema';

/**
 * Pure DCA / lump-sum simulation maths. Runs client-side in the simulator
 * island (the one interactive computation the architecture allows outside
 * the pipeline), but lives here so it is fixture-tested like every other
 * metric. No committed dataset: it consumes data/btc-price-history.json.
 *
 * Every money figure is in the display currency of the history passed in —
 * the GBP page feeds it the GBP-converted history, so the same maths gives a
 * GBP investor their own numbers rather than converted USD ones.
 */

export type DcaFrequency = 'weekly' | 'monthly';

export interface DcaOptions {
  /** First scheduled purchase date (UTC, YYYY-MM-DD). */
  startDate: string;
  /** Spent per purchase, fee inclusive. */
  amount: number;
  frequency: DcaFrequency;
  /** Fee per purchase as a percentage of the amount, e.g. 0.5. */
  feePct: number;
}

export interface DcaPurchase {
  date: string;
  price: number;
  fee: number;
  btcBought: number;
}

export interface WealthPoint {
  date: string;
  /** BTC held valued at that day's close, plus undeployed cash. */
  wealth: number;
}

export interface DcaResult {
  purchases: DcaPurchase[];
  /** Purchase count × amount: the budget both strategies start from. */
  totalInvested: number;
  totalFees: number;
  btcAccumulated: number;
  finalValue: number;
  returnPct: number;
  series: WealthPoint[];
}

export interface DcaComparison {
  dca: DcaResult;
  lumpSum: DcaResult;
  /** lumpSum final value minus DCA final value. */
  delta: number;
}

const DAY_MS = 86_400_000;

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};
const round8 = (v: number): number => Math.round(v * 1e8) / 1e8;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Same day-of-month `months` later, clamped to the target month's length. */
export function addMonthsClamped(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Map the purchase schedule onto history: each scheduled date buys at the
 * first history date on or after it (skipping forward over gaps); schedules
 * past the last history date stop the series, and two schedules landing on
 * the same history date collapse into one purchase.
 */
export function purchaseDates(
  historyDates: string[],
  startDate: string,
  frequency: DcaFrequency,
): string[] {
  const last = historyDates.at(-1);
  if (!last || startDate > last) return [];
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const scheduled =
      frequency === 'weekly' ? addDays(startDate, 7 * k) : addMonthsClamped(startDate, k);
    if (scheduled > last) break;
    const mapped = historyDates.find((d) => d >= scheduled);
    if (!mapped) break;
    if (out.at(-1) !== mapped) out.push(mapped);
  }
  return out;
}

function assertOptions(amount: number, feePct: number): void {
  if (!(amount > 0)) throw new Error('dca: amount must be positive');
  if (!(feePct >= 0 && feePct < 100)) throw new Error('dca: feePct must be in [0, 100)');
}

function buildResult(history: DailyPrice[], purchases: DcaPurchase[], amount: number): DcaResult {
  const first = purchases[0];
  const final = history.at(-1);
  if (!first || !final) throw new Error('dca: no purchases within history');
  const budget = purchases.length * amount;
  const byDate = new Map(purchases.map((p) => [p.date, p]));
  let btcHeld = 0;
  let spent = 0;
  const series: WealthPoint[] = [];
  for (const day of history) {
    if (day.date < first.date) continue;
    const purchase = byDate.get(day.date);
    if (purchase) {
      btcHeld += purchase.btcBought;
      spent += amount;
    }
    series.push({ date: day.date, wealth: round2(btcHeld * day.price + (budget - spent)) });
  }
  const btcAccumulated = round8(btcHeld);
  const finalValue = round2(btcHeld * final.price + (budget - spent));
  return {
    purchases,
    totalInvested: round2(budget),
    totalFees: round2(purchases.reduce((s, p) => s + p.fee, 0)),
    btcAccumulated,
    finalValue,
    returnPct: round2((finalValue / budget - 1) * 100),
    series,
  };
}

export function simulateDca(history: DailyPrice[], opts: DcaOptions): DcaResult {
  assertOptions(opts.amount, opts.feePct);
  const priceByDate = new Map(history.map((p) => [p.date, p.price]));
  const dates = purchaseDates(
    history.map((p) => p.date),
    opts.startDate,
    opts.frequency,
  );
  const purchases: DcaPurchase[] = dates.map((date) => {
    // Safe: purchaseDates only returns members of the same history array.
    const price = priceByDate.get(date) as number;
    const fee = (opts.amount * opts.feePct) / 100;
    return { date, price, fee, btcBought: (opts.amount - fee) / price };
  });
  return buildResult(history, purchases, opts.amount);
}

/** The whole budget invested at the first available date, same fee rate applied once. */
export function simulateLumpSum(
  history: DailyPrice[],
  opts: { startDate: string; total: number; feePct: number },
): DcaResult {
  assertOptions(opts.total, opts.feePct);
  const start = history.find((p) => p.date >= opts.startDate);
  if (!start) throw new Error('dca: no purchases within history');
  const fee = (opts.total * opts.feePct) / 100;
  const purchase: DcaPurchase = {
    date: start.date,
    price: start.price,
    fee,
    btcBought: (opts.total - fee) / start.price,
  };
  return buildResult(history, [purchase], opts.total);
}

/** DCA and an equal-budget lump sum from the same start date, for the comparison view. */
export function compareDcaVsLumpSum(history: DailyPrice[], opts: DcaOptions): DcaComparison {
  const dca = simulateDca(history, opts);
  const lumpSum = simulateLumpSum(history, {
    startDate: opts.startDate,
    total: dca.totalInvested,
    feePct: opts.feePct,
  });
  return { dca, lumpSum, delta: round2(lumpSum.finalValue - dca.finalValue) };
}
