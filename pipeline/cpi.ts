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
import { z } from 'zod';
import { parseFredCsv } from './benchmarks';
import { getJson, getText } from './http';
import { daysBetween } from './series';
import type { Currency } from './currencies';

/** Re-exported so callers of this module get the one definition. */
export { daysBetween };

export type SeasonalAdjustment = 'seasonally-adjusted' | 'not-adjusted';

export type CpiSource = 'fred' | 'ons';

export interface CpiCandidate {
  id: string;
  /**
   * Which API serves it, because the two answer in different shapes.
   *
   * FRED is a CSV through the existing `parseFredCsv`; ONS is JSON with its own
   * month encoding. Both end up in `monthlyFromPoints`, so the frequency and gap
   * rules are applied once rather than per source.
   */
  source: CpiSource;
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
 * The UK deflator comes from ONS rather than FRED, which was not the plan and is
 * what the data forced. FRED serves no live monthly UK CPI: measured, four
 * plausible OECD ids (`GBRCPALTT01IXOBSAM`, `GBRCPALTT01IXOBM`, `CPALTT01GBM661S`,
 * `CPALTT01GBM661N`) all 404, and `GBRCPIALLMINMEI`, which does exist and parses
 * perfectly, stops in March 2025 — OECD retired the MEI dataset they came from.
 * ONS is the body that publishes UK CPI in the first place, so going there is not
 * a workaround: `D7BT` is the headline all-items index, and the extra host buys
 * the GBP tree the only deflator that describes its reader.
 *
 * `GBRCPIALLMINMEI` is deliberately *not* kept here as a trailing fallback. It was
 * for one commit, with a comment claiming its rejection line would stand as a
 * record of the above — which was false twice over: the loop returns on the first
 * candidate that passes, so with `D7BT` healthy the fallback is never fetched,
 * never rejected and never logged, and being ranked below a working series it
 * could not be picked up again either. A dead entry that documents nothing and
 * cannot fire is worse than this paragraph.
 *
 * The two are not the same construction: US CPI-U is seasonally adjusted on a
 * 1982-84=100 base, ONS `D7BT` is unadjusted on 2015=100. Neither difference needs
 * reconciling — every figure here is a ratio of two observations of one series, so
 * the base cancels exactly, and there is a test asserting it. The adjustment is
 * recorded and stated on the page instead.
 */
export const CPI_CANDIDATES: Record<Currency, readonly CpiCandidate[]> = {
  usd: [
    { id: 'CPIAUCSL', source: 'fred', seasonalAdjustment: 'seasonally-adjusted' },
    { id: 'CPIAUCNS', source: 'fred', seasonalAdjustment: 'not-adjusted' },
  ],
  gbp: [{ id: 'D7BT', source: 'ons', seasonalAdjustment: 'not-adjusted' }],
};

const fredCsvUrl = (id: string): string =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;

/**
 * ONS's keyless timeseries endpoints, in the order they are tried.
 *
 * `mm23` is the consumer-price-inflation dataset; the series id selects the
 * measure within it. Two URLs because there are two published forms and the
 * obvious one is dead: `https://api.ons.gov.uk/timeseries/d7bt/dataset/mm23/data`
 * answers 404 today, measured. The website form — the series' own page with
 * `/data` appended — is the one that serves, and it needs the topic path.
 */
const onsUrls = (id: string): string[] => [
  `https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/${id.toLowerCase()}/mm23/data`,
  `https://api.ons.gov.uk/timeseries/${id.toLowerCase()}/dataset/mm23/data`,
];

/** The first ONS URL that answers, or a throw naming every one that did not. */
async function fetchOnsPayload(id: string): Promise<unknown> {
  const failures: string[] = [];
  for (const url of onsUrls(id)) {
    try {
      return await getJson(url);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`ons ${id}: ${failures.join('; ')}`);
}

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
 * Three admits a real interruption — the October 2025 US release was cancelled,
 * and a second cancelled month is not unimaginable — and refuses anything as
 * coarse as a semi-annual series. It does *not* on its own refuse a quarterly
 * one, whose two-month holes fit inside it; an earlier version of this comment
 * claimed otherwise while the test one file over asserted the opposite. The share
 * rule below is what catches a frequency change.
 */
export const MAX_CPI_GAP_MONTHS = 3;

/**
 * The share of months in the covered span that may be unpublished.
 *
 * Applied twice: over the whole series, and over `RECENT_CPI_MONTHS` at the end
 * of it. The whole-series test alone is nearly useless against the case that
 * matters, because eighty years of monthly observations drown anything recent —
 * measured: 930 good months followed by two years published quarterly comes to
 * 1.47% missing and passes, while two thirds of the last two years of prices
 * silently vanish from both lines. A deflator is used most heavily where it is
 * newest, so the newest part is where the frequency has to hold.
 */
export const MAX_CPI_MISSING_SHARE = 0.02;

/** The window the share rule is applied over a second time. */
export const RECENT_CPI_MONTHS = 60;

/**
 * The share of the recent window that may be unpublished.
 *
 * Much looser than the whole-series figure, on purpose. Over five years the two
 * things this rule must tell apart are far apart: a monthly series with two
 * cancelled releases is 3% missing, while quarterly is 67%, semi-annual 83% and
 * annual 92%. Reusing the 2% threshold here would allow exactly one hole in five
 * years and delete the entire dataset on the second — and a second cancelled
 * release is a thing statistical agencies do, not a corruption. 20% separates the
 * two cases with room on both sides.
 */
export const MAX_RECENT_MISSING_SHARE = 0.2;

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
  const points: CpiPoint[] = [];
  for (const { date, close } of rows) {
    if (!date.endsWith('-01')) {
      throw new Error(
        `toMonthlyCpi(${seriesId}): observation dated ${date} — expected monthly data ` +
          `dated on the first of the month`,
      );
    }
    points.push({ month: monthOf(date), index: close });
  }
  return monthlyFromPoints(points, seriesId);
}

/**
 * The frequency and gap rules, over observations already keyed by month.
 *
 * Shared by both sources so a hole in an ONS series is judged by the same rules as
 * a hole in a FRED one — two copies of this would be two chances to disagree about
 * what counts as monthly.
 */
export function monthlyFromPoints(points: readonly CpiPoint[], seriesId: string): MonthlyCpi {
  const series: CpiPoint[] = [];
  const missingMonths: string[] = [];
  for (const { month, index: close } of points) {
    const previous = series.at(-1);
    if (previous) {
      const step = monthsBetween(previous.month, month);
      if (step < 1) {
        throw new Error(`monthlyCpi(${seriesId}): ${month} follows ${previous.month} — not ascending`);
      }
      if (step - 1 > MAX_CPI_GAP_MONTHS) {
        throw new Error(
          `monthlyCpi(${seriesId}): ${step - 1} unpublished months between ${previous.month} ` +
            `and ${month} — beyond ${MAX_CPI_GAP_MONTHS}, which is a coarser frequency rather ` +
            `than an interrupted release`,
        );
      }
      for (let i = 1; i < step; i++) missingMonths.push(addMonths(previous.month, i));
    }
    if (!(close > 0) || !Number.isFinite(close)) {
      throw new Error(`monthlyCpi(${seriesId}): ${month} has index ${close}`);
    }
    series.push({ month, index: close });
  }
  if (series.length === 0) throw new Error(`monthlyCpi(${seriesId}): no observations`);
  const last = series[series.length - 1]?.month ?? '';
  const checkShare = (label: string, months: number, missing: number, share: number): void => {
    if (missing > months * share) {
      throw new Error(
        `monthlyCpi(${seriesId}): ${missing} of ${months} months unpublished ${label} — ` +
          `beyond ${share * 100}%, which is a coarser frequency rather than a series with holes`,
      );
    }
  };
  checkShare(
    'overall',
    series.length + missingMonths.length,
    missingMonths.length,
    MAX_CPI_MISSING_SHARE,
  );
  // Again over the recent tail, where a frequency change would otherwise be
  // diluted to nothing by decades of good history behind it. Only once the series
  // is long enough for the window to mean something.
  const from = addMonths(last, -(RECENT_CPI_MONTHS - 1));
  if (monthsBetween(series[0]?.month ?? last, last) >= RECENT_CPI_MONTHS) {
    checkShare(
      `in the ${RECENT_CPI_MONTHS} months to ${last}`,
      RECENT_CPI_MONTHS,
      missingMonths.filter((month) => month >= from).length,
      MAX_RECENT_MISSING_SHARE,
    );
  }
  return { series, missingMonths };
}

/**
 * ONS timeseries JSON. Only `months` is read.
 *
 * Reading `months` rather than merging the sibling `quarters` and `years` arrays is
 * the frequency guarantee at this source: there is no way for a quarterly figure to
 * arrive here wearing a monthly label, because the quarterly ones are in a
 * different array and this schema does not look at it.
 */
const onsTimeseriesSchema = z.object({
  months: z
    .array(z.object({ date: z.string().min(1), value: z.string().min(1) }))
    .min(1),
});

const ONS_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const ONS_MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/**
 * `2026 JUN` as `2026-06`, or a throw.
 *
 * The month token has to match a name *exactly*, in its three-letter or full
 * form. Prefix-matching was the first version, and it silently keyed
 * `2026 JAN-MAR` — the shape ONS uses for rolling three-month labels elsewhere in
 * its estate — to January, which would deflate a month of prices by a quarterly
 * average. Also `2026 JUNK`. The parse is the only place that can tell a month
 * from a period, so it refuses everything that is not one.
 */
export function onsMonthKey(date: string): string {
  const [year, name] = date.trim().split(/\s+/);
  const token = (name ?? '').toUpperCase();
  const index = token.length === 3 ? ONS_MONTHS.indexOf(token) : ONS_MONTH_NAMES.indexOf(token);
  if (!/^\d{4}$/.test(year ?? '') || index < 0) {
    throw new Error(`onsMonthKey: cannot read "${date}"`);
  }
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

/** An ONS timeseries payload as month-keyed observations, or a throw. */
export function toMonthlyOns(payload: unknown, seriesId: string): MonthlyCpi {
  const { months } = onsTimeseriesSchema.parse(payload);
  const points = months.map(({ date, value }) => ({
    month: onsMonthKey(date),
    index: Number(value),
  }));
  // ONS returns oldest-first today, but the order is not part of any contract this
  // code can rely on, and `monthlyFromPoints` reads adjacency to find holes — so
  // sort rather than assume, where the FRED path gets `assertAscending` for free.
  points.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return monthlyFromPoints(points, seriesId);
}

/**
 * How far behind the prices the deflator runs, in whole months.
 *
 * The number the page states, and the number the freshness check reads.
 */
export function cpiLagMonths(cpi: readonly CpiPoint[], through: string): number {
  const last = cpi.at(-1)?.month;
  // An empty series is infinitely stale, not perfectly fresh. It cannot arrive
  // from `monthlyFromPoints`, which throws first — but the previous fallback here
  // was `?? monthOf(through)`, yielding a lag of 0, so the one check whose entire
  // job is to fail closed would have failed open on the emptiest possible input.
  if (last === undefined) return Number.MAX_SAFE_INTEGER;
  return monthsBetween(last, monthOf(through));
}

/**
 * The largest lag a deflator may have and still be treated as late rather than
 * retired. The comparison is `<=`, so a lag of exactly this is accepted.
 *
 * CPI is published two to three weeks after the month it covers, so a run on any
 * day of month M sees M-1 at best, M-2 routinely, and M-3 when a release slips a
 * month — which is not hypothetical: the October 2025 US release was cancelled
 * outright. An earlier version of this comment called 3 "the first value that
 * cannot be reached by ordinary lateness" while the gate went on accepting it,
 * which is the comment being wrong rather than the constant: three months of
 * silence is a bad month at a statistical agency, and sixteen is a retirement.
 * The boundary is pinned by tests at 3 and 4 rather than left to this paragraph.
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
  source: CpiSource;
  sourceSeries: string;
  seasonalAdjustment: SeasonalAdjustment;
  series: CpiPoint[];
  missingMonths: string[];
  /** Candidates tried and rejected before this one, and why. */
  rejected: string[];
}

/** Fetch and normalise one candidate, whichever API serves it. */
async function loadCandidate(candidate: CpiCandidate): Promise<MonthlyCpi> {
  return candidate.source === 'fred'
    ? toMonthlyCpi(await getText(fredCsvUrl(candidate.id)), candidate.id)
    : toMonthlyOns(await fetchOnsPayload(candidate.id), candidate.id);
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
  for (const candidate of CPI_CANDIDATES[currency]) {
    const { id, source, seasonalAdjustment } = candidate;
    let parsed: MonthlyCpi;
    try {
      parsed = await loadCandidate(candidate);
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
      source,
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
 * How late a window's anchor row may be, as a share of the window itself.
 *
 * It was a flat 31 days, which is 0.85% of ten years and 8.5% of one — so a "1y"
 * tile could measure 336 days with nothing anywhere saying so. That is reachable
 * today, not hypothetical: an unpublished CPI month removes every day of that
 * month from the series, and if the 1y target lands inside one, the anchor is a
 * month late and the window is kept under a label it no longer deserves.
 *
 * One percent, floored at five days. The floor is what the weekly section needs —
 * an anchor out there can be up to six days from its target purely from the
 * resolution — and 1% covers that from three years out (11 days) while keeping 1y
 * to five.
 */
export const WINDOW_START_TOLERANCE_SHARE = 0.01;
export const WINDOW_START_TOLERANCE_FLOOR_DAYS = 5;

/** Days of slack allowed on a window of `years`. */
export const windowToleranceDays = (years: number): number =>
  Math.max(
    WINDOW_START_TOLERANCE_FLOOR_DAYS,
    Math.round(years * 365.2425 * WINDOW_START_TOLERANCE_SHARE),
  );

/**
 * The shortest span that may be annualised.
 *
 * Below a year the annualised figure is an extrapolation rather than a
 * measurement: a 40% gain over three months annualises to 284%, which describes
 * a future that has not happened. So the floor is a year — but not 365 days
 * exactly. A window is anchored on the first row at or after its target date, so
 * a "1y" window whose target lands on a day the series does not have measures
 * fewer than 365 days, and a floor of 365 would blank the tile for that reason
 * alone.
 *
 * The value is not chosen independently: it is exactly what a 1y window can
 * shrink to before `realWindows` drops it, so the two rules cannot disagree about
 * how much slack a year may have. They did — a 31-day anchor tolerance against a
 * 360-day floor left a five-week band where a window kept its percentages under a
 * "1y" label and lost both annualised figures, so the only signal that the span
 * was not a year was a *missing* number. A test pins the relationship.
 */
export const MIN_ANNUALISE_DAYS = 365 - windowToleranceDays(1);

/** Annualised (compound) rate over a span of days, or null under `MIN_ANNUALISE_DAYS`. */
export function annualisedPct(from: number, to: number, days: number): number | null {
  if (!(from > 0) || !(to > 0) || days < MIN_ANNUALISE_DAYS) return null;
  return round2((Math.pow(to / from, 365.2425 / days) - 1) * 100);
}


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
    // worse than no tile, because nothing on the page would say so. The same
    // applies to a "1y" tile measuring eleven months — see
    // `windowToleranceDays` for why the slack is proportional rather than flat.
    if (!start) continue;
    if (years !== null && daysBetween(target, start.date) > windowToleranceDays(years)) continue;
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
