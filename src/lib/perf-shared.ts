/**
 * The parts of the performance chart the build and the browser both compute.
 *
 * Plot-free, so the island can import it on the eager path. Same reason
 * `dca-shared.ts` exists: the caption and the legend are drawn on load and again
 * on every press, and a static import of a spec module would put Plot back on
 * the critical path.
 */
import type { AssetSeries, RebaseResult } from '../../pipeline/rebase';
import type { BenchmarkHistoryDataset } from '../../pipeline/schema';
import { earliestStartFor } from '../../pipeline/rebase';
import { isoWeekStart } from '../../pipeline/series';

/** Labels, duplicated from the spec so this module needs no Plot import. */
export const PERF_LABELS_CLIENT: Record<string, string> = {
  btc: 'BTC',
  eth: 'ETH',
  sp500: 'S&P 500',
  gold: 'gold',
  dxy: 'DXY',
};

/** Display order for the chart, legend and colour assignment. */
const ORDER = ['btc', 'eth', 'sp500', 'gold', 'dxy'];

/** The committed history as rebase input, in display order. */
export function toAssetSeries(history: BenchmarkHistoryDataset): AssetSeries[] {
  return [...history.series]
    .sort((a, b) => ORDER.indexOf(a.asset) - ORDER.indexOf(b.asset))
    .map((s) => ({
      asset: s.asset,
      rows: s.rows.map((r) => ({ date: r.date, value: r.close })),
    }));
}

export interface StartOption {
  label: string;
  start: string;
  selected: boolean;
}

const DAY_MS = 86_400_000;
const backFrom = (date: string, years: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - Math.round(years * 365.2425) * DAY_MS)
    .toISOString()
    .slice(0, 10);

/**
 * The range presets, derived from the data rather than written down.
 *
 * "max" is the earliest start at which *all* series exist, not the earliest date
 * in the file: BTC reaches 2010 and ETH begins in 2017, so a literal maximum
 * would draw one line for seven years and then five. The five-asset comparison
 * is the thing this page is for, so that is what "max" means, and the shorter
 * presets are ordinary windows off the last close.
 *
 * The default is 5y — long enough for the log scale to be doing work and short
 * enough that the benchmarks are not flat, which is the window the chart is
 * most legible at.
 */
export function perfStartOptions(
  assets: readonly AssetSeries[],
  dailyDays?: number,
): StartOption[] {
  const last = assets.reduce<string>((max, a) => {
    const end = a.rows.at(-1)?.date ?? '';
    return end > max ? end : max;
  }, '');
  const maxStart = earliestStartFor(assets, assets.length);
  if (!last || !maxStart) return [];
  // Inside the weekly section a start is only as precise as the grid it lands
  // on, so it is snapped to its ISO week's Monday. Without that, the window slid
  // a day per refresh while the base could only move a week at a time, and the
  // headline figures stepped: simulating consecutive refreshes moved the BTC 5y
  // tile 36.6 percentage points between two adjacent days, both labelled "5y",
  // with no market cause. Snapping makes the quantisation deliberate and stable
  // rather than an artefact of which weekday the pipeline last ran.
  const weeklyBefore = dailyDays === undefined ? null : backFrom(last, dailyDays / 365.2425);
  const snap = (start: string): string =>
    weeklyBefore !== null && start < weeklyBefore ? isoWeekStart(start) : start;
  const opts: StartOption[] = [];
  for (const years of [1, 3, 5]) {
    const start = snap(backFrom(last, years));
    // A preset reaching further back than the youngest series is dropped. Not
    // because it would duplicate "max" — it would draw four lines back to 2016,
    // which is a different chart — but because the five-asset comparison is what
    // this page is for, and a button labelled "5y" that quietly shows four lines
    // over a different window is worse than not offering it. A consequence worth
    // stating: every preset therefore starts after every series begins, so
    // `rebaseCovering` never actually excludes anything here. Its exclusion path
    // is a guard for a future preset or a shrinking source, not something a
    // reader meets today.
    if (start > maxStart) opts.push({ label: `${years}y`, start, selected: false });
  }
  // Deliberately not snapped. `maxStart` is the youngest series' own first date,
  // so moving it back to a Monday puts it before that series exists and "max"
  // then excludes the very asset that defines it — measured: snapping took max
  // to 2017-11-06 against ETH's 2017-11-12, and the built page dropped ETH from
  // the five-asset comparison. It needs no snapping anyway: it is a fixed date,
  // not a window sliding with each refresh, so it does not drift.
  opts.push({ label: 'max', start: maxStart, selected: false });
  const preferred = opts.find((o) => o.label === '5y') ?? opts.at(-1);
  if (preferred) preferred.selected = true;
  return opts;
}

/**
 * The line under the chart, naming what 100 is and what is missing.
 *
 * Both halves render this from the same function, because the caption is the
 * only place the base appears, and it is what every other number on the chart is
 * measured against. It names a day only when every series is indexed on the same
 * day, and the week otherwise — see the comment inside.
 */
export function captionOf(rebased: RebaseResult & { excluded: string[] }): string {
  // The exact day only when every series really is indexed on it. In the weekly
  // section of the history the crypto legs sit on Sundays and the market legs on
  // Fridays, so no such day exists — and the first version of this printed one
  // anyway, asserting that the S&P 500 was 100 on a Sunday it has never traded.
  // Naming the week is the honest form, and it is the same week for every line.
  const where = rebased.aligned
    ? `on ${rebased.baseDate}`
    : `in the week of ${rebased.baseWeekStart}`;
  const parts = [`100 = each series ${where}`];
  if (rebased.excluded.length > 0) {
    const names = rebased.excluded.map((a) => PERF_LABELS_CLIENT[a] ?? a);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    parts.push(
      `${list} ${names.length === 1 ? 'begins' : 'begin'} later and ${
        names.length === 1 ? 'is' : 'are'
      } not shown`,
    );
  }
  return parts.join(' · ');
}
