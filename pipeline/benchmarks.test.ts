import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertDaily, parseFredCsv, parseYahooChart } from './benchmarks';
import { trimToLastDays } from './series';

const fredCsv = readFileSync(new URL('./fixtures/fred-sp500.csv', import.meta.url), 'utf8');
const yahooGold = JSON.parse(
  readFileSync(new URL('./fixtures/yahoo-gold.json', import.meta.url), 'utf8'),
) as unknown;

describe('parseFredCsv', () => {
  it('parses rows and skips "." market-holiday values', () => {
    expect(parseFredCsv(fredCsv, 'SP500')).toEqual([
      { date: '2024-02-29', close: 4990 },
      { date: '2024-03-01', close: 5000 },
      { date: '2024-03-04', close: 5100 },
      { date: '2024-03-06', close: 5150 },
      { date: '2024-03-07', close: 5100 },
      { date: '2024-03-08', close: 5253 },
    ]);
  });

  it('accepts the newer observation_date header variant', () => {
    const csv = 'observation_date,SP500\n2024-03-01,5000.00\n2024-03-04,5100.00\n';
    expect(parseFredCsv(csv, 'SP500')).toEqual([
      { date: '2024-03-01', close: 5000 },
      { date: '2024-03-04', close: 5100 },
    ]);
  });

  it('rejects a header for the wrong series and non-CSV bodies', () => {
    expect(() => parseFredCsv(fredCsv, 'DTWEXBGS')).toThrow('unexpected header');
    expect(() => parseFredCsv('Too Many Requests', 'SP500')).toThrow('unexpected header');
  });

  it('rejects malformed dates, non-positive closes, and non-ascending rows', () => {
    expect(() => parseFredCsv('DATE,SP500\n03/01/2024,5000\n', 'SP500')).toThrow('bad row');
    expect(() => parseFredCsv('DATE,SP500\n2024-03-01,-5\n', 'SP500')).toThrow('bad close');
    expect(() =>
      parseFredCsv('DATE,SP500\n2024-03-04,5100\n2024-03-01,5000\n', 'SP500'),
    ).toThrow('not strictly ascending');
    expect(() => parseFredCsv('DATE,SP500\n2024-03-01,.\n', 'SP500')).toThrow('no data rows');
  });
});

describe('parseYahooChart', () => {
  it('collapses bars to one close per UTC day, skipping null closes, last bar wins', () => {
    // Timestamps: 2024-03-01, 03-04, 03-05 (null close -> skipped), and two
    // bars on 03-08 (00:00 and 12:13 UTC) where the later one wins.
    expect(parseYahooChart(yahooGold)).toEqual([
      { date: '2024-03-01', close: 2050 },
      { date: '2024-03-04', close: 2080 },
      { date: '2024-03-08', close: 2046 },
    ]);
  });

  it('rejects error payloads, length mismatches, and non-positive closes', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } })).toThrow();
    expect(() => parseYahooChart({ chart: { result: [], error: null } })).toThrow();
    expect(() =>
      parseYahooChart({
        chart: {
          result: [
            { timestamp: [1709251200, 1709510400], indicators: { quote: [{ close: [2050] }] } },
          ],
        },
      }),
    ).toThrow('length mismatch');
    // A single non-positive bar is skipped, not fatal: at range=max these
    // series reach the 1980s, where one stray bar must not cost the whole
    // benchmark. A response of nothing but bad bars still throws, below.
    expect(
      parseYahooChart({
        chart: {
          result: [
            {
              timestamp: [1709251200, 1709337600],
              indicators: { quote: [{ close: [-1, 2050] }] },
            },
          ],
        },
      }),
    ).toEqual([{ date: '2024-03-02', close: 2050 }]);
    expect(() =>
      parseYahooChart({
        chart: {
          result: [{ timestamp: [1709251200], indicators: { quote: [{ close: [-1] }] } }],
        },
      }),
    ).toThrow('no data rows');
    expect(() =>
      parseYahooChart({
        chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] },
      }),
    ).toThrow('no data rows');
  });
});

describe('trimToLastDays', () => {
  it('keeps only entries within N calendar days of the last entry, exclusive at the cutoff', () => {
    const series = [
      { date: '2024-12-28', close: 1 },
      { date: '2024-12-29', close: 2 },
      { date: '2024-12-30', close: 3 },
      { date: '2024-12-31', close: 4 },
    ];
    // cutoff = 2024-12-31 − 2 d = 2024-12-29; strictly-after keeps the last 2 entries
    expect(trimToLastDays(series, 2)).toEqual(series.slice(2));
    expect(trimToLastDays([], 30)).toEqual([]);
  });
});

describe('assertDaily', () => {
  const at = (dates: string[]) => dates.map((date, i) => ({ date, close: 100 + i }));

  it('accepts a business-day series, whose gaps are 1 and 3', () => {
    const weekdays = at([
      '2024-03-01', // Fri
      '2024-03-04', // Mon, gap 3
      '2024-03-05',
      '2024-03-06',
      '2024-03-07',
      '2024-03-08',
    ]);
    expect(assertDaily(weekdays, 'test')).toBe(weekdays);
  });

  it('tolerates a long holiday gap inside an otherwise daily series', () => {
    // The median, not the mean: one two-week shutdown must not fail a series
    // that is daily everywhere else.
    const withGap = at([
      '2024-03-01',
      '2024-03-04',
      '2024-03-05',
      '2024-03-06',
      '2024-03-20', // 14-day gap
      '2024-03-21',
      '2024-03-22',
    ]);
    expect(assertDaily(withGap, 'test')).toBe(withGap);
  });

  it('rejects the monthly bars Yahoo serves for range=max', () => {
    // The shape that put 13 gold bars into a file that had held 316.
    const monthly = at(['2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01']);
    expect(() => assertDaily(monthly, 'GC=F')).toThrow('coarser bars than daily');
    const quarterly = at(['2025-07-01', '2025-10-01', '2026-01-01', '2026-04-01']);
    expect(() => assertDaily(quarterly, 'DX-Y.NYB')).toThrow('median gap');
  });

  it('passes through a series too short to judge', () => {
    const two = at(['2024-03-01', '2024-06-01']);
    expect(assertDaily(two, 'test')).toBe(two);
  });
});
