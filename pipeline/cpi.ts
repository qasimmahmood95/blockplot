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

export type SeasonalAdjustment = 'seasonally-adjusted' | 'not-adjusted';

export interface CpiCandidate {
  id: string;
  /**
   * Whether the series is seasonally adjusted, for the methodology note.
   *
   * Not cosmetic, and per candidate rather than per currency because the two
   * treatments are published under different ids. Over a window of a year or
   * more they agree to a few hundredths of a percent — seasonal factors sum to
   * roughly nothing across twelve months — and over a shorter one they do not.
   * This page's shortest window is a year, so either is defensible and the page
   * states which one it got.
   */
  seasonalAdjustment: SeasonalAdjustment;
}

/**
 * The deflator candidates per currency, in order of preference.
 *
 * A list rather than one id, and the reason is measured rather than defensive.
 * Statistical agencies retire series, and FRED goes on serving a retired series'
 * historical CSV forever — same id, same header, same parser, no error. The first
 * version of this file named `GBRCPIALLMINMEI` alone; it is a discontinued OECD
 * MEI series whose last observation is 2025-03, and it parsed perfectly. Only the
 * freshness gate caught it. A single id is therefore a design that fails silently
 * on a schedule nobody controls, where an ordered list with a freshness gate
 * repairs itself and says what it did.
 *
 * Which id actually served is recorded in the dataset and read by the page, the
 * same arrangement `ethSource` has in `run.ts` — a silent fallback would make the
 * methodology note wrong, which is this project's most-repeated failure.
 *
 * All of them come from FRED so all of them go through `parseFredCsv`, already
 * tested, and no new host. They are not the same construction — US CPI-U is
 * published on a 1982-84=100 base and the OECD UK indices on 2015=100 — and that
 * needs no reconciling: every figure here is a ratio of two observations of one
 * series, so the base cancels exactly. There is a test asserting it.
 */
export const CPI_CANDIDATES: Record<Currency, readonly CpiCandidate[]> = {
  usd: [
    { id: 'CPIAUCSL', seasonalAdjustment: 'seasonally-adjusted' },
    { id: 'CPIAUCNS', seasonalAdjustment: 'not-adjusted' },
  ],
  gbp: [
    { id: 'GBRCPALTT01IXOBSAM', seasonalAdjustment: 'seasonally-adjusted' },
    { id: 'GBRCPALTT01IXOBM', seasonalAdjustment: 'not-adjusted' },
    { id: 'CPALTT01GBM661S', seasonalAdjustment: 'seasonally-adjusted' },
    { id: 'CPALTT01GBM661N', seasonalAdjustment: 'not-adjusted' },
    { id: 'GBRCPIALLMINMEI', seasonalAdjustment: 'not-adjusted' },
  ],
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
 * The longest run of unpublished months a series may have and still be monthly.
 *
 * A quarterly series read as monthly leaves two-month gaps forever, an annual one
 * eleven. Three admits a real interruption and refuses a different frequency
 * wearing a monthly id.
 */
export const MAX_CPI_GAP_MONTHS = 3;

/** The share of months in the covered span that may be unpublished. */
export const MAX_CPI_MISSING_SHARE = 0.02;

export interface MonthlyCpi {
  series: CpiPoint[];
  /**
   * Months inside the covered span with no observation.
   *
   * Not a fault, and the first version of this treated it as one — a hard throw
   * on any gap, which took out both real-return datasets on the first pipeline
   * run. `CPIAUCSL` has no observation for 2025-10, because that release was
   * cancelled rather than delayed, so a rule that forbids gaps forbids the
   * actual data.
   *
   * They are recorded instead, and the days in them are dropped rather than
   * deflated by a neighbouring month. The page names them: a hole in the line is
   * a thing a reader can see, and a caption saying which month the source did not
   * publish is the difference between an explained hole and a suspicious one.
   */
  missingMonths: string[];
}

/**
 * A FRED monthly export as month-keyed observations, or a throw.
 *
 * What is checked, and the way each of these goes wrong if it is not:
 *
 * - **Dated on the first.** A monthly FRED series is. A daily one is not, and
 *   `CPIAUCSL` has daily-frequency siblings in the same CSV shape — running this
 *   over the wrong id would produce twenty deflators for one month and keep the
 *   last silently.
 * - **Monthly, not something coarser wearing a monthly id.** Gaps are allowed
 *   but bounded, by run length and by share; see the two constants above.
 * - **Non-empty.** An index of nothing has no base to deflate to.
 */
export function toMonthlyCpi(csv: string, seriesId: string): MonthlyCpi {
  const rows = parseFredCsv(csv, seriesId);
  const series: CpiPoint[] = [];
  const missingMonths: string[] = [];
  for (const { date, close } of rows) {
    if (!date.endsWith('-01')) {
      throw new Error(
        `toMonthlyCpi(${seriesId}): observation dated ${date} — expected monthly data ` +
          `dated on the first of the month`,
      );
    }
    const month = monthOf(date);
    const previous = series.at(-1);
    if (previous) {
      const step = monthsBetween(previous.month, month);
      if (step < 1) {
        throw new Error(
          `toMonthlyCpi(${seriesId}): ${month} follows ${previous.month} — not ascending`,
        );
      }
      if (step - 1 > MAX_CPI_GAP_MONTHS) {
        throw new Error(
          `toMonthlyCpi(${seriesId}): ${step - 1} unpublished months between ${previous.month} ` +
            `and ${month} — beyond ${MAX_CPI_GAP_MONTHS}, which is a coarser frequency rather ` +
            `than an interrupted release`,
        );
      }
      for (let i = 1; i < step; i++) missingMonths.push(addMonths(previous.month, i));
    }
    series.push({ month, index: close });
  }
  if (series.length === 0) throw new Error(`toMonthlyCpi(${seriesId}): no observations`);
  const span = series.length + missingMonths.length;
  if (missingMonths.length > span * MAX_CPI_MISSING_SHARE) {
    throw new Error(
      `toMonthlyCpi(${seriesId}): ${missingMonths.length} of ${span} months unpublished — ` +
        `beyond ${MAX_CPI_MISSING_SHARE * 100}%, which is a thinned response rather than a ` +
        `series with holes`,
    );
  }
  return { series, missingMonths };
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
  seasonalAdjustment: SeasonalAdjustment;
  series: CpiPoint[];
  missingMonths: string[];
  /** Candidates tried and rejected before this one, and why. */
  rejected: string[];
}

/**
 * Whether a candidate is current enough to deflate with, given the last price day.
 *
 * Separated out so the rule is one function called by the fetch and by the tests,
 * rather than an inline comparison in a loop.
 */
export const isFreshEnough = (cpi: readonly CpiPoint[], through: string): boolean =>
  cpiLagMonths(cpi, through) <= MAX_CPI_LAG_MONTHS;

/**
 * The first candidate that parses as monthly and is not retired.
 *
 * `through` is the last day prices exist for, because "retired" is only
 * measurable against something: a series two months behind is late, and the same
 * series sixteen months behind is over.
 *
 * Every rejection is collected and returned rather than logged here, so the caller
 * prints them in one place and a run that fell through to the third candidate says
 * so out loud.
 */
export async function fetchCpi(currency: Currency, through: string): Promise<CpiFetch> {
  const rejected: string[] = [];
  for (const { id, seasonalAdjustment } of CPI_CANDIDATES[currency]) {
    let parsed: MonthlyCpi;
    try {
      parsed = toMonthlyCpi(await getText(fredCsvUrl(id)), id);
    } catch (err) {
      rejected.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!isFreshEnough(parsed.series, through)) {
      rejected.push(
        `${id}: last publishes ${parsed.series.at(-1)?.month}, ` +
          `${cpiLagMonths(parsed.series, through)} months behind prices through ${through} — ` +
          `beyond ${MAX_CPI_LAG_MONTHS}, so the series is retired rather than late`,
      );
      continue;
    }
    return {
      currency,
      sourceSeries: id,
      seasonalAdjustment,
      series: parsed.series,
      missingMonths: parsed.missingMonths,
      rejected,
    };
  }
  throw new Error(
    `fetchCpi(${currency}): no candidate deflator is both parseable and current — ` +
      rejected.join('; '),
  );
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
