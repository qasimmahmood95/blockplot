/**
 * How the holding-period matrix is read: what each cell says and what colour it
 * takes.
 *
 * No island here. The matrix is a table of committed figures with no state a
 * reader can change, so the whole thing is server-rendered markup and the only
 * reason this file is not inside the component is that `vitest.config.ts` reaches
 * `src/**` and cannot reach `.astro` — the same reason `chart-format.ts` exists,
 * and the same lesson: rules that live in a component are rules nothing tests.
 */
import type { HoldingDataset } from '../../pipeline/schema';

export interface HoldingCellView {
  buyYear: number;
  sellYear: number;
  /** The figure in the cell. */
  label: string;
  /** Heat class, or '' for a cell with no rate to colour by. */
  heat: string;
  /** The accessible description, which carries both figures and the span. */
  title: string;
}

const percent = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** A rate as the cell prints it: signed, whole percent. */
export const formatRate = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${percent.format(Math.abs(value))}%`;

const total = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A total return, as a multiple once it stops reading as a percentage.
 *
 * The same threshold and reasoning as `/real-returns`: over a fifteen-year hold
 * BTC's total is six figures of percent, which nobody can compare at a glance.
 */
export const MULTIPLE_ABOVE_PCT = 10_000;

export function formatTotal(value: number): string {
  if (value >= MULTIPLE_ABOVE_PCT) return `×${percent.format(1 + value / 100)}`;
  return `${value >= 0 ? '+' : '−'}${total.format(Math.abs(value))}%`;
}

/**
 * Which heat step an annual rate takes.
 *
 * Fixed thresholds, not data-relative, for the reason the monthly heatmap gives:
 * the same colour has to mean the same magnitude every refresh. The steps are
 * chosen from the measured distribution of this matrix rather than copied from
 * the monthly one, whose ±5/15/30 are monthly moves — here the quartiles of the
 * 151 rated holds (of 153; two are under a year and carry no rate) are 50%, 103%
 * and 173% a year, and the range runs from −69% to +5,342%.
 *
 * The bands are not equal quarters, and an earlier version of this comment said
 * they were. Measured at 25/60/120: 15 holds, 27, 47, 62 — 10%, 18%, 31%, 41%.
 * The matrix leans hard positive because the asset did, and flattening the bands
 * to quartiles would mean a shade stopped denoting a magnitude, which is the one
 * thing a fixed scale is for.
 *
 * The negative side reuses the same numbers even though nothing reaches −120: an
 * asymmetric scale would make a −60% and a +60% look like different magnitudes,
 * which is the one thing a diverging scale exists to prevent.
 */
export const HEAT_STEPS = [25, 60, 120] as const;

export function heatClass(annualPct: number | null): string {
  if (annualPct === null) return '';
  const magnitude = Math.abs(annualPct);
  const step = magnitude >= HEAT_STEPS[2] ? 4 : magnitude >= HEAT_STEPS[1] ? 3 : magnitude >= HEAT_STEPS[0] ? 2 : 1;
  return `heat-${annualPct < 0 ? 'neg' : 'pos'}-${step}`;
}

/**
 * How long a hold actually ran, in words.
 *
 * From the day count, not from the year arithmetic. `sellYear - buyYear + 1` is
 * exact for every whole year — anchored December to December, buying in 2019 and
 * selling in 2020 really is two years — and wrong for the one row the history
 * starts mid-way through: the built page read "Bought start of 2010, sold end of
 * 2010 · 1 year · … held 122 days, under a year", a sentence contradicting itself
 * inside one cell. Days below a year and one decimal above it is true everywhere
 * and needs no exception.
 */
export function holdDuration(days: number): string {
  if (days < 365) return `${days} days`;
  return `${(days / 365.2425).toFixed(1)} years`;
}

/**
 * Every cell, keyed for lookup by the table.
 *
 * The title carries both figures and the span, because the cell itself can only
 * show one number and the annual rate is the one that compares across the grid.
 * A reader who wants to know what a hold actually returned gets it from the
 * cell's own description rather than from a second table.
 */
export function cellViews(dataset: HoldingDataset): Map<string, HoldingCellView> {
  const byYear = new Map(dataset.years.map((y) => [y.year, y]));
  const out = new Map<string, HoldingCellView>();
  for (const cell of dataset.cells) {
    const buy = byYear.get(cell.buyYear);
    const sell = byYear.get(cell.sellYear);
    const span = holdDuration(cell.days);
    const rate =
      cell.annualPct === null
        ? 'no annual rate, under a year'
        : `${formatRate(cell.annualPct)} a year`;
    out.set(`${cell.buyYear}-${cell.sellYear}`, {
      buyYear: cell.buyYear,
      sellYear: cell.sellYear,
      label: cell.annualPct === null ? '—' : formatRate(cell.annualPct),
      heat: heatClass(cell.annualPct),
      title:
        `Bought ${boughtPhrase(cell.buyYear, buy)}, sold ${soldPhrase(cell.sellYear, sell)} · ` +
        `${span} · ${formatTotal(cell.totalPct)} total · ${rate}`,
    });
  }
  return out;
}

type YearAnchor = HoldingDataset['years'][number];

/**
 * "start of 2015", or the actual date when that year is not a whole one.
 *
 * Both ends of the history are truncated: it begins in August 2010 and the
 * current year is year-to-date. The built page said "sold end of 2026" for every
 * hold in that column while the close was 30 July, which is simply false — and
 * false in the direction that flatters, since an unfinished year is being read as
 * a finished one.
 */
const boughtPhrase = (year: number, anchor: YearAnchor | undefined): string =>
  anchor === undefined || anchor.whole ? `start of ${year}` : `on ${anchor.basisDate}`;

const soldPhrase = (year: number, anchor: YearAnchor | undefined): string =>
  anchor === undefined || anchor.whole ? `end of ${year}` : `on ${anchor.closeDate}`;

/** Years the matrix covers that are not whole calendar years. */
export const partialYears = (dataset: HoldingDataset): number[] =>
  dataset.years.filter((y) => !y.whole).map((y) => y.year);

/**
 * How far the diagonal's displayed rate sits from the total it reconciles on.
 *
 * The page claims the diagonal reconciles with the yearly figures the overview
 * publishes, and that claim is about `totalPct` — but the cell *displays*
 * `annualPct`, and for a one-year hold the two differ: a calendar year is 365
 * days and the annualisation divides by 365.2425, so a 365-day hold is priced as
 * marginally short of a year and its rate lands marginally above its total. On
 * the committed data that reaches 14.4 points in 2013, where the total is 5,327%.
 *
 * Review caught the page asserting the reconciliation about the visible number.
 * Rather than soften the sentence into vagueness, the size is measured from the
 * file and stated — the difference is real, small, and explicable, and a reader
 * comparing the two pages deserves the actual figure rather than "a little".
 */
export function diagonalGap(dataset: HoldingDataset): { year: number; points: number } | null {
  const diagonal = dataset.cells.filter((c) => c.buyYear === c.sellYear && c.annualPct !== null);
  if (diagonal.length === 0) return null;
  const widest = diagonal.reduce((a, b) =>
    Math.abs((b.annualPct ?? 0) - b.totalPct) > Math.abs((a.annualPct ?? 0) - a.totalPct) ? b : a,
  );
  return {
    year: widest.buyYear,
    points: Math.round(((widest.annualPct ?? 0) - widest.totalPct) * 10) / 10,
  };
}

/** That gap as the sentence the page prints, or '' when there is no diagonal. */
export function diagonalGapNote(dataset: HoldingDataset): string {
  const gap = diagonalGap(dataset);
  if (gap === null) return 'the two agree wherever both exist';
  const size = Math.abs(gap.points).toFixed(1);
  return `the widest such gap here is ${gap.year}, ${size} points ${gap.points >= 0 ? 'above' : 'below'} its total`;
}

export interface HoldingTile {
  label: string;
  value: string;
  sub: string;
  tone: '' | 'up' | 'down';
}

/**
 * The four figures above the grid.
 *
 * `safeYears` leads because it is the only one that answers the question the
 * page is for. The others are the extremes and the base rate, which are what
 * make the first figure mean anything: "every 3-year hold was up" is worth
 * little without "and 10 of 153 holds were not".
 */
export function holdingTiles(dataset: HoldingDataset): HoldingTile[] {
  const { summary, years } = dataset;
  const { best, worst, longestLosing, safeYears } = summary;
  const losing = summary.count - summary.positive;
  return [
    {
      label: 'shortest hold never down',
      value: safeYears === null ? '—' : `${safeYears}y`,
      sub:
        safeYears === null
          ? 'every hold length includes a loss'
          : `across ${years.at(0)?.year}–${years.at(-1)?.year}`,
      tone: safeYears === null ? '' : 'up',
    },
    {
      label: 'holds that ended up',
      value: `${summary.positive}/${summary.count}`,
      sub: `${losing} ended down`,
      tone: '',
    },
    {
      label: 'best hold',
      value: formatRate(best.annualPct),
      sub: `a year · bought ${best.buyYear}, sold ${best.sellYear}`,
      tone: 'up',
    },
    {
      label: 'worst hold',
      value: formatRate(worst.annualPct),
      sub: longestLosing
        ? `a year · longest loss ${longestLosing.buyYear}–${longestLosing.sellYear}, ${formatTotal(longestLosing.totalPct)}`
        : `a year · bought ${worst.buyYear}, sold ${worst.sellYear}`,
      tone: 'down',
    },
  ];
}
