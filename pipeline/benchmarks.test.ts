import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFredCsv, parseYahooChart } from './benchmarks';
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
