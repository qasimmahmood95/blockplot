import { getJson } from './http';
import { parseBlockchainSeries } from './history';
import { trimToLastDays } from './series';
import { mempoolFeesSchema, type FeeTiers, type NetworkPoint } from './schema';

/**
 * On-chain network metrics. Hash rate and transaction counts come from
 * blockchain.com's keyless charts API — the same source and payload shape as
 * the price history (M2), so parsing is shared. Fee tiers come from
 * mempool.space's keyless recommended-fees endpoint.
 */
const CHARTS_API = 'https://api.blockchain.info/charts';
const MEMPOOL_FEES_URL = 'https://mempool.space/api/v1/fees/recommended';

/** Trailing calendar days of network history kept on disk (~2 years of context). */
export const NETWORK_KEEP_DAYS = 730;

/** Fetch-level floor: far fewer points means a thinned or truncated response. */
const MIN_NETWORK_DAYS = 365;

async function fetchChart(slug: string): Promise<NetworkPoint[]> {
  const url = `${CHARTS_API}/${slug}?timespan=3years&sampled=false&format=json`;
  const series = parseBlockchainSeries(await getJson(url));
  if (series.length < MIN_NETWORK_DAYS) {
    throw new Error(`fetchChart(${slug}): only ${series.length} days returned`);
  }
  return trimToLastDays(series, NETWORK_KEEP_DAYS);
}

/**
 * Network hash rate. blockchain.com reports it in GH/s (giga-hashes per
 * second); the site displays EH/s, so convert once here — 1 EH/s = 1e9 GH/s —
 * and keep the on-disk unit explicit.
 */
export async function fetchHashRate(): Promise<NetworkPoint[]> {
  const series = await fetchChart('hash-rate');
  return series.map(({ date, value }) => ({
    date,
    value: Math.round((value / 1e9) * 100) / 100,
  }));
}

/** Confirmed transactions per day. */
export async function fetchTxCount(): Promise<NetworkPoint[]> {
  return (await fetchChart('n-transactions')).map(({ date, value }) => ({
    date,
    value: Math.round(value),
  }));
}

/**
 * Current recommended fee tiers, in sat/vB. These move on a ~10-minute
 * timescale, so the committed snapshot is a floor: the network page's island
 * refreshes it live and falls back to this value.
 */
export async function fetchFeeTiers(): Promise<FeeTiers> {
  const fees = mempoolFeesSchema.parse(await getJson(MEMPOOL_FEES_URL));
  return {
    fastestFee: fees.fastestFee,
    halfHourFee: fees.halfHourFee,
    hourFee: fees.hourFee,
    economyFee: fees.economyFee,
    minimumFee: fees.minimumFee,
  };
}

/** Change vs the closest entry at or before `days` days back, %, 2 dp; null when too short. */
export function changeOverDaysPct(series: NetworkPoint[], days: number): number | null {
  const last = series.at(-1);
  if (!last) return null;
  const target = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const base = [...series].reverse().find((p) => p.date <= target);
  if (!base || base.value === 0) return null;
  const change = Math.round((last.value / base.value - 1) * 100 * 100) / 100;
  return change === 0 ? 0 : change;
}

/** Mean of the last `days` entries, rounded to whole units; null when empty. */
export function trailingAverage(series: NetworkPoint[], days: number): number | null {
  const window = series.slice(-days);
  if (window.length === 0) return null;
  return Math.round(window.reduce((sum, p) => sum + p.value, 0) / window.length);
}
