import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodeDaily,
  decodeIndexed,
  encodeDaily,
  encodeIndexed,
  isDailyContiguous,
} from './series-codec';

describe('isDailyContiguous', () => {
  it('accepts consecutive days, including across a month and a leap day', () => {
    expect(isDailyContiguous(['2024-02-28', '2024-02-29', '2024-03-01'])).toBe(true);
    expect(isDailyContiguous(['2023-12-31', '2024-01-01'])).toBe(true);
  });

  it('rejects a gap, a repeat, and a step backwards', () => {
    expect(isDailyContiguous(['2024-01-01', '2024-01-03'])).toBe(false);
    expect(isDailyContiguous(['2024-01-01', '2024-01-01'])).toBe(false);
    expect(isDailyContiguous(['2024-01-02', '2024-01-01'])).toBe(false);
  });

  it('is vacuously true for zero or one date', () => {
    expect(isDailyContiguous([])).toBe(true);
    expect(isDailyContiguous(['2024-01-01'])).toBe(true);
  });
});

describe('encodeDaily / decodeDaily', () => {
  const rows = [
    { date: '2024-01-01', price: 42000 },
    { date: '2024-01-02', price: 42500.25 },
    { date: '2024-01-03', price: 41000 },
  ];

  it('drops the dates when they are implied by the index', () => {
    expect(encodeDaily(rows, 'price')).toEqual({
      from: '2024-01-01',
      values: [42000, 42500.25, 41000],
    });
  });

  it('round-trips exactly', () => {
    expect(decodeDaily(encodeDaily(rows, 'price'), 'price')).toEqual(rows);
  });

  it('keeps the rows verbatim when there is a gap, rather than shifting them', () => {
    // The failure this guards against is silent: re-dating by index would move
    // every reading after the gap a day earlier.
    const gapped = [
      { date: '2024-01-01', price: 1 },
      { date: '2024-01-03', price: 2 },
    ];
    expect(encodeDaily(gapped, 'price')).toEqual({ rows: gapped });
    expect(decodeDaily(encodeDaily(gapped, 'price'), 'price')).toEqual(gapped);
  });

  it('handles an empty series', () => {
    expect(decodeDaily(encodeDaily([], 'price'), 'price')).toEqual([]);
  });

  it('crosses a DST boundary without drifting, because it is all UTC', () => {
    // 2024-03-31 is the European DST switch; a local-time implementation
    // produces a 23-hour day here and drops or repeats a date.
    const march = Array.from({ length: 4 }, (_, i) => ({
      date: `2024-03-${29 + i}`.slice(0, 10),
      price: i,
    }));
    expect(decodeDaily(encodeDaily(march, 'price'), 'price')).toEqual(march);
  });
});

describe('encodeIndexed / decodeIndexed', () => {
  const rows = [
    { day: 0, multiple: 1 },
    { day: 1, multiple: 1.05 },
    { day: 2, multiple: 0.98 },
  ];

  it('keeps only the first index', () => {
    expect(encodeIndexed(rows, 'day', 'multiple')).toEqual({ x0: 0, values: [1, 1.05, 0.98] });
  });

  it('round-trips exactly', () => {
    expect(decodeIndexed(encodeIndexed(rows, 'day', 'multiple'), 'day', 'multiple')).toEqual(rows);
  });

  it('refuses a row missing either key, rather than inventing an index for it', () => {
    // `?? 0` here once let a keyless row through the contiguity check and
    // decoded it as a real day.
    const holed = [{ day: -1, multiple: 1 }, { multiple: 2 }, { day: 1, multiple: 3 }] as Record<
      string,
      number
    >[];
    expect(encodeIndexed(holed, 'day', 'multiple')).toEqual({ rows: holed });
    expect(decodeIndexed(encodeIndexed(holed, 'day', 'multiple'), 'day', 'multiple')).toEqual(holed);
  });

  it('falls back to rows when the index steps by more than one', () => {
    const gapped = [
      { day: 0, multiple: 1 },
      { day: 5, multiple: 2 },
    ];
    expect(encodeIndexed(gapped, 'day', 'multiple')).toEqual({ rows: gapped });
  });
});

describe('against the committed data', () => {
  const read = (f: string): unknown => JSON.parse(readFileSync(`data/${f}`, 'utf8'));
  const size = (v: unknown): number => gzipSync(Buffer.from(JSON.stringify(v))).length;

  it('round-trips the full BTC history exactly, and halves it', () => {
    const history = read('btc-price-history.json') as { series: { date: string; price: number }[] };
    const encoded = encodeDaily(history.series, 'price');
    expect(decodeDaily(encoded, 'price')).toEqual(history.series);
    // The claim the milestone makes, pinned so a regression in the encoder
    // shows up as a failing test rather than a slower page — but only when the
    // compact form was actually chosen. A gap in `/data` is a data condition
    // the encoder is designed to survive, and it must not turn into a red
    // build on main.
    if ('values' in encoded) expect(size(encoded)).toBeLessThan(size(history.series) * 0.6);
  });

  it('round-trips every halving cycle exactly, and halves them', () => {
    const cycles = read('halving-cycles.json') as {
      cycles: { series: { day: number; multiple: number }[] }[];
    };
    const encoded = cycles.cycles.map((c) => encodeIndexed(c.series, 'day', 'multiple'));
    encoded.forEach((e, i) => {
      expect(decodeIndexed(e, 'day', 'multiple')).toEqual(cycles.cycles[i]?.series);
    });
    if (encoded.every((e) => 'values' in e)) {
      expect(size(encoded)).toBeLessThan(size(cycles.cycles.map((c) => c.series)) * 0.6);
    }
  });

  it('round-trips the daily close series exactly', () => {
    const daily = read('btc-price-daily.json') as { series: { date: string; price: number }[] };
    expect(decodeDaily(encodeDaily(daily.series, 'price'), 'price')).toEqual(daily.series);
  });
});
