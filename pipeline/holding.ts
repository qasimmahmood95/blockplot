/**
 * What a buy year and a sell year did to each other.
 *
 * Every cell is one hold: bought at the start of year X, sold at the end of year
 * Y. The matrix is triangular because a sell year before the buy year is not a
 * hold, and it is the one view on this site that answers "did entry timing
 * actually matter" without asking the reader to hold two charts in their head.
 */
import type { DailyPrice } from './schema';

/**
 * The anchor convention, which is the whole correctness question here.
 *
 * A hold starting in year X is priced from the **last close of December X-1**,
 * and one ending in year Y at the **last close of Y**. That is not the obvious
 * choice — "the first close of X" reads more naturally — and it is the right one,
 * because it is exactly what `monthly.ts` compounds: a calendar year's return
 * there is the telescoping product of its months' close-over-close returns, which
 * is `close(Dec Y) / close(Dec Y-1)`.
 *
 * The consequence is checkable and is checked: every diagonal cell's `totalPct`
 * must equal the yearly total the overview's heatmap already publishes. Anchoring
 * on the first close of X instead would put this page a few days out from a
 * figure the site states elsewhere, with nothing saying which to believe.
 *
 * `totalPct`, not `annualPct` — the distinction matters and the page once blurred
 * it. A calendar year is 365 days and `annualPct` divides by 365.2425, so a
 * one-year hold's rate lands a little above its own total: 2013 reads +5,342% a
 * year against a +5,327% total. That is the correct definition of an annual rate
 * over a period slightly shorter than a mean year, and it is the same definition
 * `/real-returns` uses, so it stays — but it means the *displayed* diagonal is not
 * the published figure, and the page says which one is.
 *
 * The first year of data is the exception, and it is the same exception
 * `monthlyReturns` makes: history begins mid-year, the first month has no basis
 * and emits no return, so that year is a partial one measured from its first
 * month's close. Handled here by falling back to the first month present rather
 * than by special-casing a year number.
 */
export interface YearAnchor {
  year: number;
  /** The close a hold beginning in this year is bought at. */
  basis: number;
  /** The date of that close, for the annualisation. */
  basisDate: string;
  /** The close a hold ending in this year is sold at. */
  close: number;
  /** The date of that close. */
  closeDate: string;
}

/** Last close of each `YYYY-MM` present in the history, in ascending month order. */
function lastClosePerMonth(history: readonly DailyPrice[]): Map<string, DailyPrice> {
  const byMonth = new Map<string, DailyPrice>();
  for (const day of history) byMonth.set(day.date.slice(0, 7), day);
  return new Map([...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** One anchor per calendar year the history covers. */
export function yearAnchors(history: readonly DailyPrice[]): YearAnchor[] {
  const byMonth = lastClosePerMonth(history);
  const months = [...byMonth.keys()];
  const out: YearAnchor[] = [];
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);
  for (const year of years) {
    const inYear = months.filter((m) => Number(m.slice(0, 4)) === year);
    const firstMonth = inYear[0];
    const lastMonth = inYear.at(-1);
    if (!firstMonth || !lastMonth) continue;
    const previous = months[months.indexOf(firstMonth) - 1];
    // No preceding month means this is the first year in the history, which is
    // partial. Its own first close is the basis, matching `monthlyReturns`.
    const basisDay = byMonth.get(previous ?? firstMonth);
    const closeDay = byMonth.get(lastMonth);
    if (!basisDay || !closeDay) continue;
    out.push({
      year,
      basis: basisDay.price,
      basisDate: basisDay.date,
      close: closeDay.price,
      closeDate: closeDay.date,
    });
  }
  return out;
}

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

/** Whole days between two ISO dates. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Each calendar year's return, straight from the closes.
 *
 * `monthly.ts` computed this by compounding twelve monthly returns that had
 * already been rounded to two decimals, which accumulates: measured against a
 * direct ratio, 2013 came out 5327.45% against 5327.41%, 2017 1216.32% against
 * 1216.38%, 2024 119.77% against 119.83%. Small, and small in the wrong place —
 * the holding-period matrix is anchored on exactly this definition so that its
 * diagonal reconciles with the yearly totals the site already publishes, and a
 * quarter of a percentage point of rounding residue would have made the two
 * pages disagree with nothing saying which to believe.
 *
 * One definition, used by both. The monthly returns themselves stay rounded —
 * they are displayed per cell — but the year is no longer their product.
 */
export function yearlyReturnsFromCloses(
  history: readonly DailyPrice[],
): { year: number; returnPct: number }[] {
  return yearAnchors(history).map((a) => ({
    year: a.year,
    returnPct: round2((a.close / a.basis - 1) * 100),
  }));
}

export interface HoldingCell {
  buyYear: number;
  sellYear: number;
  /** Total return over the hold, %. */
  totalPct: number;
  /**
   * Compound annual rate over the hold, %, or null under a year.
   *
   * Null rather than a number for the holds that can be shorter than a year: the
   * history is truncated at both ends, so buying and selling inside either of
   * those years is a hold of a few months. Annualising the first gives **+7,701%**
   * in the USD tree and **+7,476%** in the GBP one, measured — an extrapolation
   * that would take the "best hold" tile and the top of the colour scale for a
   * hold nobody could have made. The cell keeps its total and states no rate.
   */
  annualPct: number | null;
  /** Calendar days held, which the annualisation divides by. */
  days: number;
}

/** A hold shorter than this is not annualised. */
export const MIN_ANNUALISE_DAYS = 365;

/**
 * Every hold the history supports, buy year by sell year.
 *
 * Annualised as well as total, because the two answer different questions and
 * only one of them is comparable across the matrix: a 300% total is
 * extraordinary over one year and ordinary over ten, so a grid coloured by total
 * return would say almost nothing except "the deep past was good". The page
 * colours by the annual rate and states both.
 *
 * A hold of under a year gets no rate at all — see `annualPct`.
 */
export function holdingMatrix(anchors: readonly YearAnchor[]): HoldingCell[] {
  const out: HoldingCell[] = [];
  for (const buy of anchors) {
    for (const sell of anchors) {
      if (sell.year < buy.year) continue;
      const days = daysBetween(buy.basisDate, sell.closeDate);
      if (days <= 0 || !(buy.basis > 0)) continue;
      const growth = sell.close / buy.basis;
      out.push({
        buyYear: buy.year,
        sellYear: sell.year,
        totalPct: round2((growth - 1) * 100),
        annualPct:
          days < MIN_ANNUALISE_DAYS
            ? null
            : round2((Math.pow(growth, 365.2425 / days) - 1) * 100),
        days,
      });
    }
  }
  return out;
}

export interface HoldingSummary {
  /** Holds in the matrix. */
  count: number;
  /** How many ended above water. */
  positive: number;
  /** The best and worst holds by annual rate. */
  best: HoldingCell;
  worst: HoldingCell;
  /** The longest hold that still ended down, or null if none did. */
  longestLosing: HoldingCell | null;
  /** The shortest hold, in whole years, that was never a loss at any entry. */
  safeYears: number | null;
}

/**
 * The figures the tiles state, computed here rather than in the component.
 *
 * `safeYears` is the one worth explaining: the shortest hold length for which
 * *every* buy year in the matrix ended up. It is the honest version of "time in
 * the market beats timing the market" — a claim this data can support or refuse,
 * and which is worth stating as a number rather than a sentiment. It is also
 * survivorship-shaped, and the page says so: it describes the years this history
 * contains and nothing else.
 */
export function holdingSummary(cells: readonly HoldingCell[]): HoldingSummary | null {
  if (cells.length === 0) return null;
  // Ranked on holds that have a rate, so the partial first year cannot win by
  // extrapolation. Falls back to the whole set if somehow none does.
  const rated = cells.filter((c) => c.annualPct !== null);
  const pool = rated.length > 0 ? rated : cells;
  const rate = (c: HoldingCell): number => c.annualPct ?? c.totalPct;
  const best = pool.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  const worst = pool.reduce((a, b) => (rate(b) < rate(a) ? b : a));
  const losing = cells.filter((c) => c.totalPct < 0);
  // Longest, and worst among equals. Four holds tie at 730 days on the committed
  // data — 2018→2019 at −42.76%, 2021→2022 at −42.48%, 2014→2015 at −41.86% and
  // 2022→2023 at −10.58% — and a plain `>` kept the first it met, which is the
  // third of the four. The tile then names one hold as though it were unique, so
  // the tie-break has to pick the one a reader would mean.
  const longestLosing = losing.length
    ? losing.reduce((a, b) =>
        b.days > a.days || (b.days === a.days && b.totalPct < a.totalPct) ? b : a,
      )
    : null;
  // Hold length in whole calendar years, counting inclusively: buying in 2015 and
  // selling in 2015 is one year held.
  const span = (c: HoldingCell): number => c.sellYear - c.buyYear + 1;
  const lengths = [...new Set(cells.map(span))].sort((a, b) => a - b);
  const safeYears =
    lengths.find((n) => cells.filter((c) => span(c) === n).every((c) => c.totalPct >= 0)) ?? null;
  return {
    count: cells.length,
    positive: cells.filter((c) => c.totalPct >= 0).length,
    best,
    worst,
    longestLosing,
    safeYears,
  };
}
