/**
 * Compact a daily series for the wire, losslessly.
 *
 * The islands are handed their data as an array of objects — `{"date":
 * "2011-03-04","price":0.87}` — and the key names and date strings repeat once
 * per row. On the pages that carry a full history that repetition is most of
 * the document: 90% of `/holdings`, 61% of `/dca`, 36% of `/cycles`. gzip
 * removes some of it and not nearly all, because each date differs from the
 * last in a couple of digits and the compressor still has to encode the
 * difference.
 *
 * A daily series does not need its dates written down at all: they are the
 * start date plus the index. Encoding as a start plus an array of numbers
 * roughly halves the gzipped payload of both large series (measured 38.0 →
 * 19.7 KB and 28.4 → 14.6 KB), with no change to what the reader gets and no
 * new request.
 *
 * It is deliberately not clever beyond that. No deltas, no quantisation, no
 * base-N packing: those trade exactness or legibility for a few more percent
 * on a payload that is already off the critical path, and this data is the
 * thing the whole site is about being exact on.
 *
 * If the dates turn out not to be contiguous the encoder says so and stores
 * them, rather than silently shifting every reading by a day. `/data` is
 * pipeline-generated and currently gapless, but a gap is a data condition, not
 * an impossibility — the dominance series accretes one snapshot per UTC day
 * from a job that can miss a run.
 */

const DAY_MS = 86_400_000;

/** A start date plus one value per day, or the plain rows when they have gaps. */
export type DailySeries<K extends string> =
  | { from: string; values: number[] }
  | { rows: Record<K | 'date', string | number>[] };

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** True when every row is exactly one day after the one before it. */
export function isDailyContiguous(dates: readonly string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    if (toUtc(dates[i] as string) - toUtc(dates[i - 1] as string) !== DAY_MS) return false;
  }
  return true;
}

export function encodeDaily<K extends string>(
  rows: readonly Record<string, unknown>[],
  key: K,
): DailySeries<K> {
  const dates = rows.map((r) => r['date'] as string);
  if (rows.length === 0 || !isDailyContiguous(dates)) {
    return { rows: rows as Record<K | 'date', string | number>[] };
  }
  return { from: dates[0] as string, values: rows.map((r) => r[key] as number) };
}

export function decodeDaily<K extends string>(
  encoded: DailySeries<K>,
  key: K,
): Record<string, string | number>[] {
  if ('rows' in encoded) return encoded.rows as Record<string, string | number>[];
  const start = toUtc(encoded.from);
  return encoded.values.map((value, i) => ({ date: toIso(start + i * DAY_MS), [key]: value }));
}

/**
 * The same idea where x is already an integer — the cycles chart plots days
 * since halving, so only the first index needs writing down.
 */
export type IndexedSeries = { x0: number; values: number[] } | { rows: Record<string, number>[] };

export function encodeIndexed(
  rows: readonly Record<string, number>[],
  xKey: string,
  yKey: string,
): IndexedSeries {
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[xKey] ?? 0) - (rows[i - 1]?.[xKey] ?? 0) !== 1) return { rows: [...rows] };
  }
  if (rows.length === 0) return { rows: [] };
  return { x0: rows[0]?.[xKey] as number, values: rows.map((r) => r[yKey] as number) };
}

export function decodeIndexed(
  encoded: IndexedSeries,
  xKey: string,
  yKey: string,
): Record<string, number>[] {
  if ('rows' in encoded) return encoded.rows;
  return encoded.values.map((value, i) => ({ [xKey]: encoded.x0 + i, [yKey]: value }));
}
