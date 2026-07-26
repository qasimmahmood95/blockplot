import { getJson } from './http';
import { blockchainChartSchema, type DailyPrice } from './schema';

/**
 * Full BTC/USD price history (2010 onward) from blockchain.com's keyless
 * charts API — the free archival source decided in the M2 PR. `sampled=false`
 * requests full daily granularity rather than the auto-thinned long-range
 * series.
 */
const HISTORY_URL =
  'https://api.blockchain.info/charts/market-price?timespan=all&sampled=false&format=json';

/** Fetch-level floor: full history is ~5,800 daily points; far fewer means a thinned or truncated response. */
const MIN_HISTORY_DAYS = 3650;

/**
 * Collapse chart values into one price per UTC day: zero prices (pre-market
 * days at the series start) are dropped, and when two points share a day the
 * chronologically last wins, mirroring toDailySeries.
 */
export function parseBlockchainSeries(payload: unknown): { date: string; value: number }[] {
  const { values } = blockchainChartSchema.parse(payload);
  const byDate = new Map<string, number>();
  for (const { x, y } of [...values].sort((a, b) => a.x - b.x)) {
    // Defense-in-depth behind zod (which already rejects non-finite numbers):
    // finiteness first, so -Infinity fails loud instead of being zero-dropped.
    if (!Number.isFinite(y)) throw new Error(`parseBlockchainChart: bad price ${y}`);
    if (y <= 0) continue;
    byDate.set(new Date(x * 1000).toISOString().slice(0, 10), y);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({ date, value }));
}

export function parseBlockchainChart(payload: unknown): DailyPrice[] {
  const byDate = new Map<string, number>(
    parseBlockchainSeries(payload).map(({ date, value }) => [date, value]),
  );
  const out = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, priceUsd]) => ({ date, priceUsd }));
  if (out.length === 0) throw new Error('parseBlockchainChart: no positive-price rows');
  return out;
}

export async function fetchBtcHistory(): Promise<DailyPrice[]> {
  const series = parseBlockchainChart(await getJson(HISTORY_URL));
  if (series.length < MIN_HISTORY_DAYS) {
    throw new Error(
      `fetchBtcHistory: only ${series.length} days returned — expected full daily history`,
    );
  }
  return series;
}
