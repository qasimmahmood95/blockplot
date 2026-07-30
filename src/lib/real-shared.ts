/**
 * The parts of the real-returns chart the build and the browser both compute.
 *
 * Plot-free, so the island can import it on the eager path — same reason
 * `perf-shared.ts` and `dca-shared.ts` exist. The caption, the legend and the
 * accessible name are drawn on load and again on every press, and a static
 * import of the spec module would put Plot back on the critical path.
 */
import { currencyFormatters, type Currency } from './currency';
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
 * `perf-shared.ts` records the measurements, including the two tokens that
 * looked usable and were not. Nominal takes the accent because it is the series
 * every other page draws in it; real takes the ink. Neither `--pos` nor `--neg`,
 * because a chart of a price is not a chart of a gain.
 */
export const realColor = (line: string): string =>
  line === 'nominal' ? 'var(--accent)' : 'var(--ink)';

/** The legend swatch for a line. */
export const realSwatch = (line: string): string => realColor(line);

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
  const { money, compact } = currencyFormatters(currency);
  return {
    // Sub-unit prices are the early history and compact notation renders them
    // as "$0.05" already; above a thousand it is "$1.2K". Both are what the axis
    // wants.
    tick: (value: number) => compact.format(value),
    // `money` carries no fraction digits, which is right for today's prices and
    // wrong for 2011's: at $0.87 it would read "$1". Below ten, show cents.
    tip: (value: number) => (Math.abs(value) < 10 ? compact.format(value) : money.format(value)),
  };
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
 * span — and the pipeline measured its windows on the *full* daily series while
 * the chart is drawn from a payload thinned to weekly before 730 days. Deriving
 * the presets here from the thinned rows would put the chart's 10y start up to
 * six days from the tile's, which is small, invisible, and exactly the kind of
 * disagreement that makes a reader distrust both numbers.
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

const pct = (value: number | null): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

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

/** The rows of both lines from a start date, as the spec's flat point list. */
export function realPoints(
  rows: readonly RealPointsInput[],
  start: string,
): { line: RealLine; date: Date; value: number }[] {
  const out: { line: RealLine; date: Date; value: number }[] = [];
  for (const line of REAL_LINES) {
    for (const row of rows) {
      if (row.date < start) continue;
      out.push({ line, date: new Date(row.date), value: row[line] });
    }
  }
  return out;
}
