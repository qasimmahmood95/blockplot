import type { Currency } from './currencies';
import type { DailyPrice } from './schema';

/**
 * Holdings maths: what a stack is worth, and how it has done against what was
 * paid for it.
 *
 * Lives here rather than in the island for the same reason the DCA maths does
 * — every figure the site prints is a fixture-tested pure function — but this
 * one never produces a committed dataset. The inputs are the reader's own, and
 * they never leave the browser.
 */

export interface Holdings {
  /** BTC held. */
  btc: number;
  /** Total paid, in `costCurrency`. Null when the reader has not entered one. */
  cost: number | null;
  /**
   * Currency the cost was entered in. Stored alongside the figure because the
   * reader can switch the page's currency afterwards, and a cost is a
   * historical fact in whichever currency it was actually spent.
   */
  costCurrency: Currency;
}

export interface HoldingsValue {
  /** Current worth of the stack, in the display currency. */
  value: number;
  /** Cost converted into the display currency, or null when none was entered. */
  cost: number | null;
  /** value − cost, or null. */
  pnl: number | null;
  /** Return on cost, %, or null. */
  pnlPct: number | null;
  /** Cost per BTC, in the display currency, or null. */
  avgEntry: number | null;
  /** True when `cost` was converted rather than entered in this currency. */
  costConverted: boolean;
}

/**
 * Bounds on what a reader can enter. 21 million is the supply cap, so no
 * honest holding exceeds it. The cost bound sits under 2^53/100 ≈ 9.0e13, the
 * largest figure at which a double still represents whole cents exactly, so
 * `round2` of a cost is exact below it. Both matter because `Number.isFinite`
 * on the inputs does not stop their product overflowing: 1e308 BTC is finite
 * and typeable, and printed "$∞" on every page before this.
 *
 * The guarantee stops at the inputs. `avgEntry` is cost/btc and is bounded by
 * neither, so a hand-edited store of 1e13 against 1e-8 BTC still prints float
 * noise in its low digits. That is unreachable from the form, and a ludicrous
 * figure for a ludicrous input is the right outcome — but the bound should not
 * be read as making every derived figure cent-exact.
 */
export const MAX_BTC = 21_000_000;
export const MAX_COST = 1e13;

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

/**
 * Rate between the two display currencies, implied by the same BTC priced in
 * each. Both datasets are built from one USD source, so the ratio of their
 * latest closes *is* the latest GBP/USD rate — which means converting a cost
 * basis needs no extra source and no extra committed file.
 *
 * That identity holds only while the two trees are the same day old. When the
 * FX fetch fails the run skips the GBP tree, and the ratio quietly becomes two
 * different days of BTC price divided by each other. Callers check the dates;
 * this function cannot, because it is only given prices.
 */
export function impliedRate(latest: Record<Currency, number>, from: Currency, to: Currency): number {
  if (from === to) return 1;
  const fromPrice = latest[from];
  const toPrice = latest[to];
  if (!(fromPrice > 0) || !(toPrice > 0)) {
    throw new Error('impliedRate: latest prices must be positive');
  }
  return toPrice / fromPrice;
}

/**
 * A cost basis restated in another currency, rounded to the cent.
 *
 * The same arithmetic `valueHoldings` does internally, exported because the
 * panel needs it too: when a cost entered on the other route is shown in this
 * one's field, the figure in the box has to be the figure the maths used. The
 * panel had its own copy of the multiply-and-round — metric maths in a UI
 * component, and the copy decided what got written back to storage when the
 * reader edited on the other route.
 */
export function convertCost(
  cost: number,
  from: Currency,
  to: Currency,
  latest: Record<Currency, number>,
): number {
  return round2(cost * impliedRate(latest, from, to));
}

/**
 * Value a stack and, if a cost was entered, price its performance.
 *
 * A cost entered in another currency is converted at today's implied rate, not
 * at the rate on the day it was spent — that day is not recorded, and inventing
 * it would be worse than saying so. `costConverted` is set so the page can.
 */
export function valueHoldings(
  holdings: Holdings,
  price: number,
  currency: Currency,
  latest: Record<Currency, number>,
): HoldingsValue {
  if (!(holdings.btc >= 0) || holdings.btc > MAX_BTC) {
    throw new Error(`valueHoldings: btc must be between 0 and ${MAX_BTC}`);
  }
  if (!(price > 0)) throw new Error('valueHoldings: price must be positive');
  if (holdings.cost !== null && (!(holdings.cost >= 0) || holdings.cost > MAX_COST)) {
    throw new Error(`valueHoldings: cost must be between 0 and ${MAX_COST}`);
  }
  const value = holdings.btc * price;
  // Backstop: the bounds above make this unreachable, but a figure that is not
  // finite must never reach a formatter, where it renders as "$∞".
  if (!Number.isFinite(value)) throw new Error('valueHoldings: value overflowed');
  const costConverted = holdings.cost !== null && holdings.costCurrency !== currency;
  const cost =
    holdings.cost === null
      ? null
      : holdings.cost * impliedRate(latest, holdings.costCurrency, currency);

  // A zero cost has no return to report — dividing by it would print Infinity —
  // and zero BTC has no entry price. Both are reachable from the form.
  const pnl = cost === null ? null : round2(value - cost);
  const pnlPct = cost === null || cost === 0 ? null : round2((value / cost - 1) * 100);
  const avgEntry = cost === null || holdings.btc === 0 ? null : round2(cost / holdings.btc);

  return { value: round2(value), cost: cost === null ? null : round2(cost), pnl, pnlPct, avgEntry, costConverted };
}

/**
 * What today's stack would have been worth across history, had it been held
 * throughout.
 *
 * Deliberately a constant BTC amount: the site does not know when any of it was
 * bought, so this is a "what this much BTC was worth" line, not a reconstruction
 * of the reader's actual position. The page says so — a line implying a purchase
 * history the data cannot support would be worse than no line.
 *
 * Unrounded, for the same reason `convertSeries` is: BTC opens at $0.07, so
 * rounding to 2 dp zeroes every value under half a cent, and the chart's log
 * axis then drops those days entirely. Precision is kept here and spent at
 * format time.
 */
export function holdingsSeries(
  history: DailyPrice[],
  btc: number,
  from?: string,
): { date: string; value: number }[] {
  if (!(btc >= 0) || btc > MAX_BTC) {
    throw new Error(`holdingsSeries: btc must be between 0 and ${MAX_BTC}`);
  }
  return history
    .filter((point) => from === undefined || point.date >= from)
    .map(({ date, price }) => ({ date, value: btc * price }));
}
