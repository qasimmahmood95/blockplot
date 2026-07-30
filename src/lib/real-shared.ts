/**
 * The parts of the real-returns chart the build and the browser both compute.
 *
 * Plot-free, so the island can import it on the eager path — same reason
 * `perf-shared.ts` and `dca-shared.ts` exist. The caption, the legend and the
 * accessible name are drawn on load and again on every press, and a static
 * import of the spec module would put Plot back on the critical path.
 */
import { CURRENCY_META, type Currency } from './currency';
import type { RealReturnsDataset } from '../../pipeline/schema';

/** Draw order, which is also the legend order and the colour assignment. */
export const REAL_LINES = ['nominal', 'real'] as const;

export type RealLine = (typeof REAL_LINES)[number];

/**
 * One definition of the two labels, shared by the spec, the legend and the tiles.
 *
 * Deliberately short. The base month is what "real" means and it belongs in the
 * caption, not repeated in a legend chip and an axis label and five tiles — where
 * five copies of a monthly-moving value are five chances for one of them to be
 * last month's.
 */
export const REAL_LABELS: Record<string, string> = {
  nominal: 'nominal',
  real: 'real',
};

/**
 * Two colours, both of which clear 3:1 against the chart surface in both themes.
 *
 * The accent and the ink are the only two this site has established for that —
 * `perf-shared.ts` records the measurements, including the two tokens that looked
 * usable and were not. Nominal takes the accent because it is the series every
 * other page draws in it; real takes the ink. Neither `--pos` nor `--neg`, because
 * a chart of a price is not a chart of a gain.
 *
 * Contrast against the surface is not enough here, though, and a test caught it:
 * in dark mode `--accent` and `--ink` are only 2.39:1 against *each other*. On
 * `/performance` that is tolerable — five series, each with its own end label,
 * mostly far apart. These two hug each other for the whole recent history, which
 * is exactly where a reader looks, so colour alone would be doing the work at
 * 2.39:1. Hence the dash below.
 */
export const realColor = (line: string): string =>
  line === 'nominal' ? 'var(--accent)' : 'var(--ink)';

/**
 * Dash pattern for a line, empty when solid.
 *
 * Real is dashed, and not only to fix the dark-mode pair contrast: the nominal
 * line is what the market printed and the real one is a restatement of it, so a
 * derived line drawn differently from a quoted one says something true. The same
 * reasoning as DXY's dash on `/performance`, where the odd series out is the one
 * that is not an investable asset.
 */
export const realDash = (line: string): string => (line === 'real' ? '5,3' : '');

/** The legend swatch for a line: a solid bar, or a dashed one for real. */
export function realSwatch(line: string): string {
  const color = realColor(line);
  if (!realDash(line)) return color;
  return `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`;
}

/** `2026-06` as `June 2026`, for prose and the caption. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[Number(m) - 1] ?? month} ${year}`;
}

/**
 * Axis and tooltip formatters for a currency, built once and shared.
 *
 * Built here rather than inside the spec because both halves have to produce
 * byte-identical tick labels: the build draws the axis and the browser redraws it
 * on the first hover, and two `Intl.NumberFormat` instances configured
 * differently would move every tick a little as the cursor arrived.
 *
 * Compact on the axis, exact in the tooltip. A 2010 BTC price is $0.05 and a 2026
 * one is $100,000, so the axis needs the compact notation to fit five ticks in 66
 * pixels — while the tooltip is where a reader goes for the actual number.
 */
export function realFormatters(currency: Currency): {
  tick: (value: number) => string;
  tip: (value: number) => string;
} {
  const code = CURRENCY_META[currency].code;
  const exact = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  });
  // The symbol, taken from the formatter rather than written down, so a third
  // currency needs no table here.
  const symbol =
    exact.formatToParts(0).find((part) => part.type === 'currency')?.value ?? '';
  // For the early history, where a whole-unit format is not a rounding choice
  // but an error: BTC's first committed close is $0.0451, and "$0" states that
  // it was worthless.
  const sub = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return {
    tick: (value: number) => `${symbol}${compactDigits(value)}`,
    tip: (value: number) => (Math.abs(value) < 10 ? sub.format(value) : exact.format(value)),
  };
}

/**
 * The axis magnitude, done by arithmetic rather than by `Intl`.
 *
 * `Intl.NumberFormat` with `style: 'currency'` *and* `notation: 'compact'` does not
 * agree across runtimes. Measured on the same values: Node 22 gives `$20.0K`,
 * `$105.0`, `$0.0`; Chromium gives `$20K`, `$105`, `$0`. The build draws the axis in
 * Node and the first hover redraws it in the browser, so the ticks changed under
 * the reader's cursor — the exact failure the shared-spec rule exists to prevent,
 * arriving through the one part of the spec that was not shared code but a locale
 * database. (Plain compact without the currency style *does* agree in both, which
 * is why `/network`'s axis is unaffected; it was checked rather than assumed.)
 *
 * Chromium's version is also wrong for the early history: it renders BTC's first
 * committed close, 0.0451, as `$0`. Two significant figures below the unit keeps
 * the bottom of a log axis meaning something.
 */
export function compactDigits(value: number): string {
  const abs = Math.abs(value);
  const trim = (scaled: number): string => scaled.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  if (abs >= 10) return String(Math.round(value));
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return '0';
  return Number(value.toPrecision(2)).toString();
}

export interface RangeOption {
  label: string;
  start: string;
  selected: boolean;
}

/**
 * The chart's range presets, taken from the windows the pipeline measured.
 *
 * Not recomputed from the series. The tiles above the chart state a return for
 * each window and the chart draws one of them, so the two have to mean the same
 * span, and the way to guarantee that is to take the span from the same place the
 * figure came from. Deriving a "10y" start here — a fresh subtraction off the last
 * row — would land a few days from the one the pipeline anchored on, which is
 * small, invisible, and exactly the kind of disagreement that makes a reader
 * distrust both numbers. The pipeline anchors its windows on rows this file
 * contains (see the comment in `run.ts`), so every start here is a drawable point.
 *
 * The default is 5y: long enough for the deflator to have done something visible
 * and short enough that the two lines have not diverged into different orders of
 * magnitude, which is the window the comparison reads best at.
 */
export function realRangeOptions(dataset: RealReturnsDataset): RangeOption[] {
  const options = dataset.windows.map((window) => ({
    label: window.label,
    start: window.start,
    selected: false,
  }));
  const preferred = options.find((o) => o.label === '5y') ?? options.at(-1);
  if (preferred) preferred.selected = true;
  return options;
}

/** Whole days between two ISO dates. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The line under the chart: what "real" is measured in, and where both lines stop.
 *
 * Both halves render this from one function, because the base month is the whole
 * meaning of the real line and the truncation is the page's one real cost. The
 * lag is stated in days from the dataset's own two dates rather than described —
 * "the CPI release lags" is a fact about the world, "27 days" is a fact about
 * this file, and only the second one goes stale visibly.
 */
export function captionOf(dataset: RealReturnsDataset): string {
  const { asOf, pricesThrough, deflator } = dataset;
  const behind = daysBetween(asOf, pricesThrough);
  const parts = [
    `real values in ${monthLabel(deflator.baseMonth)} money`,
    `deflator ${deflator.sourceSeries}, published through ${monthLabel(deflator.lastMonth)}`,
  ];
  parts.push(
    behind > 0
      ? `both lines end ${asOf}, ${behind}d behind the last price (${pricesThrough})`
      : `both lines end ${asOf}, the last price`,
  );
  return parts.join(' · ');
}

/**
 * The chart's accessible name, which has to follow the chart.
 *
 * A fixed string here would tell a screen-reader user "5y" and "log" whatever
 * they had pressed — the defect this exists to avoid on `/performance`, written
 * down there too.
 */
export const chartLabel = (range: string, scale: string): string =>
  `Line chart of BTC's nominal and inflation-adjusted price, ${range} range, ${scale} scale`;

export interface RealTile {
  label: string;
  value: string;
  sub: string;
  tone: '' | 'up' | 'down';
}

/**
 * Above this, a return is stated as a multiple instead of a percentage.
 *
 * Not a style preference. The max window's real return is +56,293,498.9%, which is
 * twelve digits a reader has to count to place the decimal point, and the tile
 * beside it says +85,908,757.1% — two figures nobody can compare at a glance. As
 * multiples they are ×562,936 and ×859,088, which is also how anyone actually
 * talks about a return that size. The threshold sits above the deepest window that
 * still reads naturally as a percentage: 10y is +6,089.8% and stays one.
 */
export const MULTIPLE_ABOVE_PCT = 10_000;

const multiple = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const pct = (value: number | null): string => {
  if (value === null) return '—';
  if (value >= MULTIPLE_ABOVE_PCT) return `×${multiple.format(1 + value / 100)}`;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

/**
 * One tile per window, real first.
 *
 * The real figure leads and the nominal one is the subtitle, which is the
 * opposite of how a return tile usually reads and is the point of the page: a
 * reader who wants the nominal number has it on four other pages. The inflation
 * figure sits beside the nominal one so the gap between the two headline numbers
 * can be checked rather than taken — they are the same quantity twice, and the
 * third number is exactly what separates them.
 *
 * Annualised rates go on the tile only where they exist. Under a year they are an
 * extrapolation and the pipeline returns null rather than a figure describing a
 * future that has not happened.
 */
export function realTiles(dataset: RealReturnsDataset): RealTile[] {
  return dataset.windows.map((window) => {
    const cagr = window.realCagrPct === null ? '' : ` · ${pct(window.realCagrPct)}/yr real`;
    return {
      label: `${window.label} real`,
      value: pct(window.realPct),
      sub: `nominal ${pct(window.nominalPct)} · CPI ${pct(window.inflationPct)}${cagr}`,
      tone: window.realPct === null ? '' : window.realPct < 0 ? 'down' : 'up',
    };
  });
}

export interface RealPointsInput {
  date: string;
  nominal: number;
  real: number;
}

/**
 * The rows of both lines from a start date, as the spec's flat point list.
 *
 * `missingMonths` inserts a break rather than being cosmetic. Days in an
 * unpublished month are dropped by the pipeline, and a line mark drawn over the
 * remaining points joins straight across the hole — which draws a deflated value
 * for every day of a month the deflator does not cover. The method note under the
 * chart said "the lines have a gap there" while the chart had none, which is this
 * project's most-repeated defect in miniature: prose the picture contradicts.
 *
 * The break is a non-finite value at mid-month, which Plot's `lineY` treats as
 * undefined and splits the path on. Driven by the file's own record of which
 * months are missing, not by a distance heuristic — the weekly section has
 * seven-day steps everywhere by design, so any threshold would either miss a
 * one-month hole out there or shatter the whole early history.
 */
export function realPoints(
  rows: readonly RealPointsInput[],
  start: string,
  missingMonths: readonly string[] = [],
): { line: RealLine; date: Date; value: number }[] {
  const breaks = missingMonths
    .map((month) => `${month}-15`)
    .filter((date) => date >= start)
    .map((date) => new Date(date));
  const out: { line: RealLine; date: Date; value: number }[] = [];
  for (const line of REAL_LINES) {
    const points = rows
      .filter((row) => row.date >= start)
      .map((row) => ({ line, date: new Date(row.date), value: row[line] }));
    for (const date of breaks) points.push({ line, date, value: NaN });
    // Sorted after the breaks are added, because a line mark follows array order
    // and a break appended at the end would split the last segment instead of the
    // one it belongs to.
    points.sort((a, b) => a.date.getTime() - b.date.getTime());
    out.push(...points);
  }
  return out;
}
