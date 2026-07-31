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
 * A series with *gaps* gets the same treatment one step down: a start date plus
 * the number of days from each row to the next. Which is where most of the
 * remaining weight was, because the gapped series are the long ones — the
 * market pairs on `/correlation` carry 2,472 rows with 540 gaps each, since
 * equities and gold do not trade at weekends, so every one of them fell back to
 * writing out its dates. Measured on that page's payload: 47.3 KB gzipped as
 * rows, 21.9 as day offsets from the start, **11.4 as gaps to the next row**.
 *
 * The gap form supersedes a "no deltas" rule this file used to state, and the
 * reason it stated it does not apply: deltas were rejected as trading
 * "exactness or legibility for a few more percent", and whole-day gaps are
 * exact — `2` means two days, not an approximation of one — while 21.9 → 11.4
 * is not a few percent. What they do cost is that a date is now a running sum
 * rather than a lookup, which is why the round-trip tests carry a real gapped
 * series rather than a toy.
 *
 * Still deliberately not clever beyond that: no quantisation, no base-N
 * packing. Those trade exactness, and this data is the thing the whole site is
 * about being exact on.
 *
 * Anything the two forms cannot describe exactly — a repeated date, a
 * non-ascending one, a sub-day interval — falls back to storing the rows, rather
 * than silently shifting a reading.
 */

const DAY_MS = 86_400_000;

/**
 * A start date plus one value per day; the same plus the gaps between rows; or
 * the plain rows when neither describes the dates exactly.
 */
export type DailySeries<K extends string> =
  | { from: string; values: number[] }
  | { from: string; gaps: number[]; values: number[] }
  | { rows: Record<K | 'date', string | number>[] };

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Whether a date survives the round trip this codec puts it through.
 *
 * `Date.parse` is a parser, not a validator, and it *rolls over*: it reads
 * `2024-02-30` as 1 March. The pipeline's guard is shape-only — `isoDate` in
 * `pipeline/schema.ts` is a `\d{4}-\d{2}-\d{2}` regex — so a rolled-over date
 * gets into `/data` looking fine, and the strictly-ascending refinements pass
 * because 30 February really does sort between 28 February and 1 March.
 *
 * That was harmless while such a series failed the contiguity check and had its
 * dates written out verbatim. Adding the gap form made it harmful: the steps
 * around it are whole days, so it took the compact path and came back as
 * `2024-03-01`, duplicating the row after it. Silently shifting a reading is
 * the one thing this file promises not to do.
 *
 * Formatting the parse back and comparing catches that, and with it every other
 * input whose string is not exactly what the encoding would reproduce: a
 * non-padded `2024-1-1`, a full ISO timestamp, an empty string, a missing key.
 * Those went the compact path too when the series was a single row, where the
 * contiguity check has no pair to reject.
 */
const reproducible = (date: unknown): boolean =>
  typeof date === 'string' && Number.isFinite(toUtc(date)) && toIso(toUtc(date)) === date;

/** True when every row is exactly one day after the one before it. */
export function isDailyContiguous(dates: readonly string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    if (toUtc(dates[i] as string) - toUtc(dates[i - 1] as string) !== DAY_MS) return false;
  }
  return true;
}

/**
 * The whole-day steps between consecutive dates, or null if they are not that.
 *
 * Null covers every shape the gap form cannot reproduce exactly: a date that
 * repeats, one that goes backwards, and any interval that is not a whole number
 * of days. Dates that do not parse are already gone by here — `reproducible`
 * rejects the whole series before this runs, which it has to, because this loop
 * has no pair to inspect when the series is one row long.
 */
function dailyGaps(dates: readonly string[]): number[] | null {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const step = (toUtc(dates[i] as string) - toUtc(dates[i - 1] as string)) / DAY_MS;
    if (!Number.isInteger(step) || step <= 0) return null;
    gaps.push(step);
  }
  return gaps;
}

export function encodeDaily<K extends string>(
  rows: readonly Record<string, unknown>[],
  key: K,
): DailySeries<K> {
  const dates = rows.map((r) => r['date']);
  if (rows.length === 0 || !dates.every(reproducible)) {
    return { rows: rows as Record<K | 'date', string | number>[] };
  }
  const from = dates[0] as string;
  const values = rows.map((r) => r[key] as number);
  if (isDailyContiguous(dates as string[])) return { from, values };
  const gaps = dailyGaps(dates as string[]);
  if (gaps === null) return { rows: rows as Record<K | 'date', string | number>[] };
  return { from, gaps, values };
}

export function decodeDaily<K extends string>(
  encoded: DailySeries<K>,
  key: K,
): Record<string, string | number>[] {
  if ('rows' in encoded) return encoded.rows as Record<string, string | number>[];
  const start = toUtc(encoded.from);
  if (!('gaps' in encoded)) {
    return encoded.values.map((value, i) => ({ date: toIso(start + i * DAY_MS), [key]: value }));
  }
  let at = start;
  return encoded.values.map((value, i) => {
    // The first row sits on `from`; every one after it steps by its own gap, so
    // the step read here is the one *into* this row.
    // `gaps` is one shorter than `values`, so index i-1 always exists for i > 0.
    // It used to read `?? 0`, a default that could never fire from anything the
    // encoder emits and that would have quietly repeated a date if a payload
    // were ever truncated. A missing gap is a broken payload, not a zero.
    if (i > 0) at += (encoded.gaps[i - 1] as number) * DAY_MS;
    return { date: toIso(at), [key]: value };
  });
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
  if (rows.length === 0) return { rows: [] };
  // Every row must actually carry both keys. `?? 0` here let a row with no x
  // through the contiguity check and invented an index for it on decode.
  for (const row of rows) {
    if (typeof row[xKey] !== 'number' || typeof row[yKey] !== 'number') return { rows: [...rows] };
  }
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i]?.[xKey] as number) - (rows[i - 1]?.[xKey] as number) !== 1) {
      return { rows: [...rows] };
    }
  }
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
