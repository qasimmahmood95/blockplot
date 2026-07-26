import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFredCsv, parseStooqCsv, trimToLastDays } from './benchmarks';

const fredCsv = readFileSync(new URL('./fixtures/fred-sp500.csv', import.meta.url), 'utf8');
const stooqCsv = readFileSync(new URL('./fixtures/stooq-xauusd.csv', import.meta.url), 'utf8');

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

describe('parseStooqCsv', () => {
  it('parses date and close from the OHLCV export', () => {
    expect(parseStooqCsv(stooqCsv)).toEqual([
      { date: '2024-02-29', close: 2100 },
      { date: '2024-03-01', close: 2050 },
      { date: '2024-03-05', close: 2080 },
      { date: '2024-03-08', close: 2044.16 },
    ]);
  });

  it('rejects rate-limit text bodies via the strict header check', () => {
    expect(() => parseStooqCsv('Exceeded the daily hits limit')).toThrow('unexpected header');
  });

  it('rejects short and malformed rows', () => {
    const header = 'Date,Open,High,Low,Close,Volume\n';
    expect(() => parseStooqCsv(`${header}2024-03-01,2048,2055\n`)).toThrow('bad row');
    expect(() => parseStooqCsv(`${header}2024-03-01,2048,2055,2040,zero,\n`)).toThrow('bad close');
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
