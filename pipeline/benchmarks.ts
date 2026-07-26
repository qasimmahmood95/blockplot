import { getText } from './http';
import type { BenchmarkDay } from './schema';

/**
 * Benchmark sources. S&P 500 comes from FRED's keyless fredgraph.csv export
 * (the JSON API needs an account key; the CSV export does not). Gold cannot
 * come from FRED — its LBMA series were discontinued in 2022 when IBA pulled
 * redistribution rights — so it comes from stooq's keyless daily-CSV export
 * of XAU/USD instead.
 */
export const SP500_FRED_SERIES = 'SP500';
export const GOLD_STOOQ_SERIES = 'XAUUSD';

const FRED_CSV_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${SP500_FRED_SERIES}`;
const STOOQ_CSV_URL = `https://stooq.com/q/d/l/?s=${GOLD_STOOQ_SERIES.toLowerCase()}&i=d`;

/** Trailing calendar days of benchmark history kept on disk — covers the 365-day BTC window with margin. */
export const BENCHMARK_KEEP_DAYS = 400;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertAscending(series: BenchmarkDay[], context: string): BenchmarkDay[] {
  if (series.length === 0) throw new Error(`${context}: no data rows`);
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev && curr && curr.date <= prev.date) {
      throw new Error(`${context}: dates not strictly ascending at ${curr.date}`);
    }
  }
  return series;
}

/**
 * Parse a FRED fredgraph.csv export: a `DATE,<id>` header (`observation_date`
 * in newer exports) and one row per day, `.` marking market holidays (skipped).
 * Anything else — including FRED's HTML error pages — throws.
 */
export function parseFredCsv(csv: string, seriesId: string): BenchmarkDay[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((cell) => cell.trim());
  const dateCol = (header[0] ?? '').toLowerCase();
  if ((dateCol !== 'date' && dateCol !== 'observation_date') || header[1] !== seriesId) {
    throw new Error(`parseFredCsv: unexpected header "${lines[0] ?? ''}"`);
  }
  const out: BenchmarkDay[] = [];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(',').map((cell) => cell.trim());
    if (!date || !DATE_RE.test(date)) throw new Error(`parseFredCsv: bad row "${line}"`);
    if (value === undefined || value === '' || value === '.') continue;
    const close = Number(value);
    if (!Number.isFinite(close) || close <= 0) throw new Error(`parseFredCsv: bad close "${line}"`);
    out.push({ date, close });
  }
  return assertAscending(out, 'parseFredCsv');
}

/**
 * Parse a stooq daily-CSV export (`Date,Open,High,Low,Close,Volume`). The
 * strict header check doubles as the guard against stooq's plain-text
 * rate-limit responses.
 */
export function parseStooqCsv(csv: string): BenchmarkDay[] {
  const lines = csv.trim().split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== 'Date,Open,High,Low,Close,Volume') {
    throw new Error(`parseStooqCsv: unexpected header "${lines[0] ?? ''}"`);
  }
  const out: BenchmarkDay[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.trim());
    const date = cells[0];
    if (cells.length < 5 || !date || !DATE_RE.test(date)) {
      throw new Error(`parseStooqCsv: bad row "${line}"`);
    }
    const close = Number(cells[4]);
    if (!Number.isFinite(close) || close <= 0) throw new Error(`parseStooqCsv: bad close "${line}"`);
    out.push({ date, close });
  }
  return assertAscending(out, 'parseStooqCsv');
}

/** Keep only entries within `days` calendar days of the series' last entry. */
export function trimToLastDays(series: BenchmarkDay[], days: number): BenchmarkDay[] {
  const last = series.at(-1);
  if (!last) return [];
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return series.filter((day) => day.date > cutoff);
}

export async function fetchSp500(): Promise<BenchmarkDay[]> {
  return trimToLastDays(parseFredCsv(await getText(FRED_CSV_URL), SP500_FRED_SERIES), BENCHMARK_KEEP_DAYS);
}

export async function fetchGold(): Promise<BenchmarkDay[]> {
  return trimToLastDays(parseStooqCsv(await getText(STOOQ_CSV_URL)), BENCHMARK_KEEP_DAYS);
}
