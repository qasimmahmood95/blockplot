import type { DailyPrice, HalvingCycle, HalvingDataset } from './schema';

/** UTC dates of the four BTC halvings (blocks 210000, 420000, 630000, 840000). */
export const HALVING_DATES = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Slice history into one series per halving epoch, price normalised to the
 * close on the halving day (or the first available day after it), so cycles
 * overlay as multiples on a shared days-since-halving axis. The last cycle
 * is open-ended.
 */
export function buildHalvingDataset(
  history: DailyPrice[],
  opts: { fetchedAt: string; halvings?: string[] },
): HalvingDataset {
  const halvings = opts.halvings ?? HALVING_DATES;
  const last = history.at(-1);
  if (!last) throw new Error('buildHalvingDataset: empty history');
  const cycles: HalvingCycle[] = halvings.map((halvingDate, i) => {
    const endDate = halvings[i + 1] ?? null;
    const slice = history.filter(
      (p) => p.date >= halvingDate && (endDate === null || p.date < endDate),
    );
    const base = slice[0];
    if (!base) throw new Error(`buildHalvingDataset: no history at or after halving ${halvingDate}`);
    return {
      cycle: i + 1,
      halvingDate,
      endDate,
      basePriceUsd: base.priceUsd,
      series: slice.map((p) => ({
        day: daysBetween(halvingDate, p.date),
        multiple: round4(p.priceUsd / base.priceUsd),
      })),
    };
  });
  return {
    schemaVersion: 1,
    source: 'blockchain.info',
    fetchedAt: opts.fetchedAt,
    asOf: last.date,
    cycles,
  };
}
