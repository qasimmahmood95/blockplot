/**
 * The consumer price index, and the arithmetic that turns a nominal price series
 * into a real one.
 *
 * One deflator per display currency, because that is what the GBP tree is for. A
 * sterling reader's purchasing power is set by UK prices; deflating a GBP series
 * by US CPI would produce a figure describing nobody — neither a dollar
 * investor's real return nor a sterling one's. The cost is a second source and a
 * second set of caveats, and the alternative was quietly wrong.
 */
import { parseFredCsv } from './benchmarks';
import { getText } from './http';
import type { Currency } from './currencies';

/**
 * The deflator series, one per currency.
 *
 * Both come from FRED, so they go through `parseFredCsv` — already tested, and
 * one less host than fetching UK figures from ONS directly. They are not the
 * same construction, and the difference is recorded rather than smoothed over:
 * `CPIAUCSL` is US CPI-U for all items, seasonally adjusted, published on a
 * 1982-84=100 base; the UK series is an all-items index on a 2015=100 base.
 *
 * The bases do not need reconciling, which is worth stating because it looks
 * like they would. Every figure this module produces is a *ratio* of two
 * observations of the same series, so the base cancels exactly. What does not
 * cancel is seasonal adjustment, and it is asymmetric here: see
 * `SEASONAL_ADJUSTMENT` below.
 */
export const CPI_SERIES: Record<Currency, string> = {
  usd: 'CPIAUCSL',
  gbp: 'GBRCPIALLMINMEI',
};

/**
 * Whether each deflator is seasonally adjusted, for the methodology note.
 *
 * Not cosmetic. Over a window of a year or more the two treatments agree to a
 * few hundredths of a percent, because seasonal factors sum to roughly nothing
 * across twelve months. Over a shorter window they do not, and this page's
 * shortest window is a year — so the choice is defensible either way and the
 * page says which one it used rather than leaving a reader to assume.
 */
export const SEASONAL_ADJUSTMENT: Record<Currency, 'seasonally-adjusted' | 'not-adjusted'> = {
  usd: 'seasonally-adjusted',
  gbp: 'not-adjusted',
};

const fredCsvUrl = (id: string): string =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;

/** One published observation: the month it describes, and the index level. */
export interface CpiPoint {
  /** `YYYY-MM`. FRED dates monthly observations on the first of the month. */
  month: string;
  index: number;
}

/** The `YYYY-MM` a date falls in. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** Month key `n` months after `month`. */
export function addMonths(month: string, n: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + n;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to`, negative when `to` is earlier. */
export const monthsBetween = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/**
 * A FRED monthly export as month-keyed observations, or a throw.
 *
 * Three things are checked, and each of them has a way of being wrong that would
 * otherwise pass silently into the figures:
 *
 * - **Dated on the first.** A monthly FRED series is. A daily one is not, and
 *   `CPIAUCSL` has a daily sibling in the same shape — running this over the
 *   wrong id would produce twenty deflators for one month and keep the last.
 * - **Contiguous.** Gaps matter because `cpiFor` is a strict month lookup: a
 *   missing month drops those days from the real series rather than deflating
 *   them by a neighbour, so a thinned response would shorten the chart with
 *   nothing saying why.
 * - **Non-empty.** An index of nothing has no base to deflate to.
 */
export function toMonthlyCpi(csv: string, seriesId: string): CpiPoint[] {
  const rows = parseFredCsv(csv, seriesId);
  const out: CpiPoint[] = [];
  for (const { date, close } of rows) {
    if (!date.endsWith('-01')) {
      throw new Error(
        `toMonthlyCpi(${seriesId}): observation dated ${date} — expected monthly data ` +
          `dated on the first of the month`,
      );
    }
    const month = monthOf(date);
    const previous = out.at(-1);
    if (previous && monthsBetween(previous.month, month) !== 1) {
      throw new Error(
        `toMonthlyCpi(${seriesId}): ${previous.month} is followed by ${month} — the series ` +
          `has a gap, and a gap silently shortens the deflated range`,
      );
    }
    out.push({ month, index: close });
  }
  if (out.length === 0) throw new Error(`toMonthlyCpi(${seriesId}): no observations`);
  return out;
}

/**
 * How far behind the prices the deflator runs, in whole months.
 *
 * The number the page states, and the number the freshness check reads.
 */
export const cpiLagMonths = (cpi: readonly CpiPoint[], through: string): number =>
  monthsBetween(cpi.at(-1)?.month ?? monthOf(through), monthOf(through));

/**
 * The lag beyond which a deflator is treated as broken rather than late.
 *
 * CPI is published two to three weeks after the month it covers, so a run on any
 * day of month M sees M-1 at best and M-2 when the release has not landed yet.
 * Three months is the first value that cannot be reached by ordinary lateness.
 *
 * This check exists because of a specific failure mode, not as decoration.
 * Statistical agencies retire series, and FRED keeps serving a retired series'
 * historical CSV forever — same id, same header, same parser, no error. Without
 * a freshness assertion the truncation rule below would quietly cut the real
 * series off at whenever the series stopped, and the page would go on stating a
 * base month years in the past as though it were current. A loud failure that
 * skips one dataset is much cheaper than a plausible chart of stale money.
 */
export const MAX_CPI_LAG_MONTHS = 3;

export interface CpiFetch {
  currency: Currency;
  sourceSeries: string;
  series: CpiPoint[];
}

export async function fetchCpi(currency: Currency): Promise<CpiFetch> {
  const sourceSeries = CPI_SERIES[currency];
  const series = toMonthlyCpi(await getText(fredCsvUrl(sourceSeries)), sourceSeries);
  return { currency, sourceSeries, series };
}

/**
 * The index for the month a date falls in, or null when that month is unpublished.
 *
 * A strict month lookup, and deliberately not "the last observation on or before
 * this date". Holding the last value forward is the obvious way to cover the
 * publication lag and it is the wrong one here: it would deflate the most recent
 * weeks by an index that predates them, so the newest points on the chart — the
 * ones a reader looks at first — would be the least real, and nothing on the
 * page could say by how much. Returning null instead lets the caller drop those
 * days and name the date it stopped at.
 */
export function cpiFor(cpi: readonly CpiPoint[], date: string): number | null {
  const month = monthOf(date);
  return cpi.find((point) => point.month === month)?.index ?? null;
}

export interface RealPoint {
  date: string;
  nominal: number;
  real: number;
}

/**
 * Six significant figures, matching `benchmarks-history.json`.
 *
 * Same reason as there: this file spans BTC at 0.04 in 2010 and 100,000 today,
 * so a fixed decimal place is either useless at one end or wasteful at the
 * other. Real values are ratios of two 6 s.f. numbers, so they carry about 10
 * parts per million — four orders of magnitude below the two decimal places the
 * page displays.
 */
const sig6 = (value: number): number => Number(value.toPrecision(6));

/**
 * Nominal prices restated in the money of `baseMonth`.
 *
 * `real = nominal × cpi(base) / cpi(month of date)`, which is a ratio in both
 * terms — so the deflator's base period cancels and the two series' different
 * bases (1982-84=100 and 2015=100) need no reconciling.
 *
 * Days in an unpublished month are dropped rather than carried, and both figures
 * are kept for each surviving day rather than the real one alone: the chart draws
 * both lines and the tiles compare them, so recomputing either half in the
 * browser would be a second definition of the same arithmetic — the drift class
 * the spec rule in CLAUDE.md exists to prevent.
 */
export function deflate(
  rows: readonly { date: string; price: number }[],
  cpi: readonly CpiPoint[],
  baseMonth: string,
): RealPoint[] {
  const byMonth = new Map(cpi.map((point) => [point.month, point.index]));
  const base = byMonth.get(baseMonth);
  if (base === undefined) {
    throw new Error(`deflate: no CPI observation for base month ${baseMonth}`);
  }
  const out: RealPoint[] = [];
  for (const { date, price } of rows) {
    const index = byMonth.get(monthOf(date));
    if (index === undefined) continue;
    out.push({ date, nominal: sig6(price), real: sig6((price * base) / index) });
  }
  return out;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Percentage change between two levels, or null when the first is not positive. */
export function changePct(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return round2((to / from - 1) * 100);
}

/**
 * The shortest span that may be annualised.
 *
 * Below a year the annualised figure is an extrapolation rather than a
 * measurement: a 40% gain over three months annualises to 284%, which describes
 * a future that has not happened. So the floor is a year — but not 365 days
 * exactly. A window is anchored on the first row at or after its target date, so
 * a "1y" window whose target lands on a day the series does not have measures
 * 364 days, and a floor of 365 would blank the tile for that reason alone. 360
 * absorbs that without admitting anything a reader would not call a year.
 */
export const MIN_ANNUALISE_DAYS = 360;

/** Annualised (compound) rate over a span of days, or null under `MIN_ANNUALISE_DAYS`. */
export function annualisedPct(from: number, to: number, days: number): number | null {
  if (!(from > 0) || !(to > 0) || days < MIN_ANNUALISE_DAYS) return null;
  return round2((Math.pow(to / from, 365.2425 / days) - 1) * 100);
}

/** Whole days between two ISO dates. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Cumulative inflation between the months two dates fall in, or null when
 * either month is unpublished.
 *
 * Stated on the page beside each window's pair of returns, because it is the
 * whole difference between them: a reader who sees 180% nominal and 140% real
 * should be able to check the 17% that separates them rather than take it.
 */
export function inflationPct(
  cpi: readonly CpiPoint[],
  from: string,
  to: string,
): number | null {
  const start = cpiFor(cpi, from);
  const end = cpiFor(cpi, to);
  if (start === null || end === null) return null;
  return changePct(start, end);
}

export interface RealWindow {
  label: string;
  start: string;
  nominalPct: number | null;
  realPct: number | null;
  nominalCagrPct: number | null;
  realCagrPct: number | null;
  inflationPct: number | null;
}

/** The windows the page shows, shortest first. `null` years means "all of it". */
export const REAL_WINDOWS: readonly { label: string; years: number | null }[] = [
  { label: '1y', years: 1 },
  { label: '3y', years: 3 },
  { label: '5y', years: 5 },
  { label: '10y', years: 10 },
  { label: 'max', years: null },
];

/** How late a window's anchor row may be before the window is dropped. */
export const WINDOW_START_TOLERANCE_DAYS = 31;

const DAY_MS = 86_400_000;
const backFrom = (date: string, years: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - Math.round(years * 365.2425) * DAY_MS)
    .toISOString()
    .slice(0, 10);

/**
 * Nominal and real return over each window, measured on the deflated series.
 *
 * Both legs end on the same day, which is the last day the deflator covers and
 * not the last day prices exist. That costs the page a few weeks of currency and
 * buys the only thing it is for: a nominal figure and a real figure a reader can
 * subtract. Ending nominal at today and real a month earlier would put a
 * different market move in each column and label the difference "inflation".
 *
 * A window shorter than the data is anchored on the first row *at or after* the
 * target date, so a window is never quietly extended past its own name by
 * starting on the last row before it.
 */
export function realWindows(series: readonly RealPoint[], cpi: readonly CpiPoint[]): RealWindow[] {
  const last = series.at(-1);
  const first = series[0];
  if (!last || !first) return [];
  const out: RealWindow[] = [];
  for (const { label, years } of REAL_WINDOWS) {
    const target = years === null ? first.date : backFrom(last.date, years);
    const start = years === null ? first : series.find((row) => row.date >= target);
    // A window the data does not reach back to is dropped rather than shown
    // under a name it does not deserve: a "10y" tile measuring eight years is
    // worse than no tile, because nothing on the page would say so. The
    // tolerance is a month — enough for the anchor row to land a few days late
    // on a thinned or gapped series, far short of anything that would change
    // what the label means.
    if (!start) continue;
    if (years !== null && daysBetween(target, start.date) > WINDOW_START_TOLERANCE_DAYS) continue;
    const days = daysBetween(start.date, last.date);
    out.push({
      label,
      start: start.date,
      nominalPct: changePct(start.nominal, last.nominal),
      realPct: changePct(start.real, last.real),
      nominalCagrPct: annualisedPct(start.nominal, last.nominal, days),
      realCagrPct: annualisedPct(start.real, last.real, days),
      inflationPct: inflationPct(cpi, start.date, last.date),
    });
  }
  return out;
}
