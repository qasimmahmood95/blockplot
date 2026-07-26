import { readFile } from 'node:fs/promises';
import { getJson } from './http';
import { parseBlockchainSeries } from './history';
import { trimToLastDays } from './series';
import {
  mempoolFeesSchema,
  networkDatasetSchema,
  type FeeTiers,
  type NetworkPoint,
} from './schema';

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

/** blockchain.com reports hash rate in TH/s; the site displays EH/s. */
export const TH_PER_EH = 1e6;

/**
 * Sanity band on the converted series. The network first passed 100 EH/s in
 * 2019 and has stayed above it since (bar the 2021 mining-ban dip), and sits
 * near 900 today — so a value outside this band means the source changed
 * units in one direction or the other. Both ends are guarded: shipping this
 * milestone already required one unit fix, and a wrong-but-plausible number
 * is worse than a failed run.
 */
const MIN_PLAUSIBLE_EH = 100;
const MAX_PLAUSIBLE_EH = 10_000;

export function toExahashes(series: NetworkPoint[]): NetworkPoint[] {
  const converted = series.map(({ date, value }) => ({
    date,
    value: Math.round((value / TH_PER_EH) * 100) / 100,
  }));
  const latest = converted.at(-1);
  if (latest && (latest.value < MIN_PLAUSIBLE_EH || latest.value > MAX_PLAUSIBLE_EH)) {
    throw new Error(
      `toExahashes: latest ${latest.value} EH/s is outside the plausible ${MIN_PLAUSIBLE_EH}-${MAX_PLAUSIBLE_EH} band — source units likely changed`,
    );
  }
  return converted;
}

export async function fetchHashRate(): Promise<NetworkPoint[]> {
  return toExahashes(await fetchChart('hash-rate'));
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

/** Index of the latest entry dated at or before `days` days before the series end. */
function baseIndex(series: NetworkPoint[], days: number): number {
  const last = series.at(-1);
  if (!last) return -1;
  const target = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (let i = series.length - 1; i >= 0; i--) {
    const point = series[i];
    if (point && point.date <= target) return i;
  }
  return -1;
}

const mean = (points: NetworkPoint[]): number =>
  points.reduce((sum, p) => sum + p.value, 0) / points.length;

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

/** Endpoint-to-endpoint change vs the closest entry at or before `days` back, %, 2 dp. */
export function changeOverDaysPct(series: NetworkPoint[], days: number): number | null {
  const last = series.at(-1);
  const i = baseIndex(series, days);
  const base = i >= 0 ? series[i] : undefined;
  if (!last || !base || base.value === 0) return null;
  return round2((last.value / base.value - 1) * 100);
}

/**
 * Change between trailing means rather than endpoints, %, 2 dp.
 *
 * Hash rate is not measured but *estimated* from block timing, so its daily
 * value swings ~8% on Poisson noise alone. An endpoint-to-endpoint 30d change
 * therefore says more about which two days the window happened to land on
 * than about the network: on this dataset the endpoint method reads −17.4%
 * while the underlying 30-day trend is −2.4%. Averaging both ends over
 * `window` days removes that artifact.
 */
export function smoothedChangePct(
  series: NetworkPoint[],
  days: number,
  window: number,
): number | null {
  if (window < 1 || series.length === 0) return null;
  const i = baseIndex(series, days);
  if (i < 0) return null;
  const baseWindow = series.slice(Math.max(0, i - window + 1), i + 1);
  const lastWindow = series.slice(-window);
  if (baseWindow.length === 0 || lastWindow.length === 0) return null;
  const baseMean = mean(baseWindow);
  if (baseMean === 0) return null;
  return round2((mean(lastWindow) / baseMean - 1) * 100);
}

/** Mean of the last `days` entries at `dp` decimals; null when empty or `days` < 1. */
export function trailingAverage(series: NetworkPoint[], days: number, dp = 0): number | null {
  if (days < 1) return null;
  const window = series.slice(-days);
  if (window.length === 0) return null;
  const factor = 10 ** dp;
  return Math.round(mean(window) * factor) / factor;
}

/**
 * Fee tiers from the previously committed dataset, so a mempool.space outage
 * doesn't block the hash-rate and transaction series (which refresh on a
 * 6-hourly cadence and have no other source).
 */
export async function readExistingFees(path: string): Promise<FeeTiers | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return networkDatasetSchema.parse(JSON.parse(raw)).fees.tiers;
}
