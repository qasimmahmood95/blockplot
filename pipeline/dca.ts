import type { DailyPrice } from './schema';

/**
 * Pure DCA / lump-sum simulation maths. Runs client-side in the simulator
 * island (the one interactive computation the architecture allows outside
 * the pipeline), but lives here so it is fixture-tested like every other
 * metric. No committed dataset: it consumes data/btc-price-history.json.
 */

export type DcaFrequency = 'weekly' | 'monthly';

export interface DcaOptions {
  /** First scheduled purchase date (UTC, YYYY-MM-DD). */
  startDate: string;
  /** USD spent per purchase, fee inclusive. */
  amountUsd: number;
  frequency: DcaFrequency;
  /** Fee per purchase as a percentage of the amount, e.g. 0.5. */
  feePct: number;
}

export interface DcaPurchase {
  date: string;
  priceUsd: number;
  feeUsd: number;
  btcBought: number;
}

export interface WealthPoint {
  date: string;
  /** BTC held valued at that day's close, plus undeployed cash. */
  wealthUsd: number;
}

export interface DcaResult {
  purchases: DcaPurchase[];
  /** Purchase count × amount: the budget both strategies start from. */
  totalInvestedUsd: number;
  totalFeesUsd: number;
  btcAccumulated: number;
  finalValueUsd: number;
  returnPct: number;
  series: WealthPoint[];
}

export interface DcaComparison {
  dca: DcaResult;
  lumpSum: DcaResult;
  /** lumpSum final value minus DCA final value, USD. */
  deltaUsd: number;
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

function assertOptions(amountUsd: number, feePct: number): void {
  if (!(amountUsd > 0)) throw new Error('dca: amountUsd must be positive');
  if (!(feePct >= 0 && feePct < 100)) throw new Error('dca: feePct must be in [0, 100)');
}

function buildResult(history: DailyPrice[], purchases: DcaPurchase[], amountUsd: number): DcaResult {
  const first = purchases[0];
  const final = history.at(-1);
  if (!first || !final) throw new Error('dca: no purchases within history');
  const budget = purchases.length * amountUsd;
  const byDate = new Map(purchases.map((p) => [p.date, p]));
  let btcHeld = 0;
  let spent = 0;
  const series: WealthPoint[] = [];
  for (const day of history) {
    if (day.date < first.date) continue;
    const purchase = byDate.get(day.date);
    if (purchase) {
      btcHeld += purchase.btcBought;
      spent += amountUsd;
    }
    series.push({ date: day.date, wealthUsd: round2(btcHeld * day.priceUsd + (budget - spent)) });
  }
  const btcAccumulated = round8(btcHeld);
  const finalValueUsd = round2(btcHeld * final.priceUsd + (budget - spent));
  return {
    purchases,
    totalInvestedUsd: round2(budget),
    totalFeesUsd: round2(purchases.reduce((s, p) => s + p.feeUsd, 0)),
    btcAccumulated,
    finalValueUsd,
    returnPct: round2((finalValueUsd / budget - 1) * 100),
    series,
  };
}

export function simulateDca(history: DailyPrice[], opts: DcaOptions): DcaResult {
  assertOptions(opts.amountUsd, opts.feePct);
  const priceByDate = new Map(history.map((p) => [p.date, p.priceUsd]));
  const dates = purchaseDates(
    history.map((p) => p.date),
    opts.startDate,
    opts.frequency,
  );
  const purchases: DcaPurchase[] = dates.map((date) => {
    const priceUsd = priceByDate.get(date) as number;
    const feeUsd = (opts.amountUsd * opts.feePct) / 100;
    return { date, priceUsd, feeUsd, btcBought: (opts.amountUsd - feeUsd) / priceUsd };
  });
  return buildResult(history, purchases, opts.amountUsd);
}

/** The whole budget invested at the first available date, same fee rate applied once. */
export function simulateLumpSum(
  history: DailyPrice[],
  opts: { startDate: string; totalUsd: number; feePct: number },
): DcaResult {
  assertOptions(opts.totalUsd, opts.feePct);
  const start = history.find((p) => p.date >= opts.startDate);
  if (!start) throw new Error('dca: no purchases within history');
  const feeUsd = (opts.totalUsd * opts.feePct) / 100;
  const purchase: DcaPurchase = {
    date: start.date,
    priceUsd: start.priceUsd,
    feeUsd,
    btcBought: (opts.totalUsd - feeUsd) / start.priceUsd,
  };
  return buildResult(history, [purchase], opts.totalUsd);
}

/** DCA and an equal-budget lump sum from the same start date, for the comparison view. */
export function compareDcaVsLumpSum(history: DailyPrice[], opts: DcaOptions): DcaComparison {
  const dca = simulateDca(history, opts);
  const lumpSum = simulateLumpSum(history, {
    startDate: opts.startDate,
    totalUsd: dca.totalInvestedUsd,
    feePct: opts.feePct,
  });
  return { dca, lumpSum, deltaUsd: round2(lumpSum.finalValueUsd - dca.finalValueUsd) };
}
