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
 * 153 committed holds are 49%, 103% and 173% a year, and the range runs from
 * −69% to +5,342%. Steps at 25/60/120 put roughly a quarter of the matrix in
 * each band and leave the top step for the genuinely extraordinary.
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

/** Whole years a hold spans, counting inclusively. */
export const spanYears = (buyYear: number, sellYear: number): number => sellYear - buyYear + 1;

/**
 * Every cell, keyed for lookup by the table.
 *
 * The title carries both figures and the span, because the cell itself can only
 * show one number and the annual rate is the one that compares across the grid.
 * A reader who wants to know what a hold actually returned gets it from the
 * cell's own description rather than from a second table.
 */
export function cellViews(dataset: HoldingDataset): Map<string, HoldingCellView> {
  const out = new Map<string, HoldingCellView>();
  for (const cell of dataset.cells) {
    const years = spanYears(cell.buyYear, cell.sellYear);
    const span = `${years} year${years === 1 ? '' : 's'}`;
    const rate =
      cell.annualPct === null
        ? `no annual rate — held ${cell.days} days, under a year`
        : `${formatRate(cell.annualPct)} a year`;
    out.set(`${cell.buyYear}-${cell.sellYear}`, {
      buyYear: cell.buyYear,
      sellYear: cell.sellYear,
      label: cell.annualPct === null ? '—' : formatRate(cell.annualPct),
      heat: heatClass(cell.annualPct),
      title:
        `Bought start of ${cell.buyYear}, sold end of ${cell.sellYear} · ${span} · ` +
        `${formatTotal(cell.totalPct)} total · ${rate}`,
    });
  }
  return out;
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
          : `across ${years.at(0)}–${years.at(-1)}`,
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
