/**
 * The parts of the performance chart the build and the browser both compute.
 *
 * Plot-free, so the island can import it on the eager path. Same reason
 * `dca-shared.ts` exists: the caption and the legend are drawn on load and again
 * on every press, and a static import of a spec module would put Plot back on
 * the critical path.
 */
import type { AssetSeries, RebasedSeries } from '../../pipeline/rebase';
import type { BenchmarkHistoryDataset } from '../../pipeline/schema';
import { earliestStartFor } from '../../pipeline/rebase';

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
export function perfStartOptions(assets: readonly AssetSeries[]): StartOption[] {
  const last = assets.reduce<string>((max, a) => {
    const end = a.rows.at(-1)?.date ?? '';
    return end > max ? end : max;
  }, '');
  const maxStart = earliestStartFor(assets, assets.length);
  if (!last || !maxStart) return [];
  const opts: StartOption[] = [];
  for (const years of [1, 3, 5]) {
    const start = backFrom(last, years);
    // A preset earlier than every series' start is the same chart as "max", so
    // it is dropped rather than offered twice.
    if (start > maxStart) opts.push({ label: `${years}y`, start, selected: false });
  }
  opts.push({ label: 'max', start: maxStart, selected: false });
  const preferred = opts.find((o) => o.label === '5y') ?? opts.at(-1);
  if (preferred) preferred.selected = true;
  return opts;
}

/**
 * The line under the chart, naming what 100 is and what is missing.
 *
 * Both halves render this from the same function, because the caption is the
 * only place the base date appears: `rebaseCovering` can move the base forward
 * to the first day every drawn series has a price, and a caption stating the
 * date the reader pressed would then be wrong by up to a weekend — in a figure
 * every other number on the chart is measured against.
 */
export function captionOf(rebased: {
  baseDate: string;
  series: RebasedSeries[];
  excluded: string[];
}): string {
  const parts = [`100 = each series on ${rebased.baseDate}`];
  if (rebased.excluded.length > 0) {
    const names = rebased.excluded.map((a) => PERF_LABELS_CLIENT[a] ?? a);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    parts.push(`${list} ${names.length === 1 ? 'begins' : 'begin'} later and ${names.length === 1 ? 'is' : 'are'} not shown`);
  }
  return parts.join(' · ');
}
