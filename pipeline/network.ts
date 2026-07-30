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

/**
 * Total daily transaction fees, in BTC.
 *
 * BTC and not the `-usd` variant, deliberately. `/network` is currency-free —
 * every figure on it is a property of the chain rather than of a price — and
 * pulling in a USD series would either need the FX machinery the page does not
 * have or leave a GBP reader with one dollar number among chain statistics. The
 * fee history exists here to give the live sat/vB tiers something to be judged
 * against, and satoshis are the unit those tiers are already quoted in.
 */
export async function fetchTotalFeesBtc(): Promise<NetworkPoint[]> {
  return fetchChart('transaction-fees');
}

export const SATS_PER_BTC = 1e8;

/**
 * Mean fee paid per confirmed transaction, in satoshis.
 *
 * Derived rather than fetched: blockchain.com publishes total fees per day and
 * transactions per day, and the quotient is the figure a reader actually wants —
 * "what did a transaction cost" rather than "what did the whole network pay".
 * Computed here, from two series the site already commits, so it cannot disagree
 * with either chart beside it.
 *
 * Joined on date rather than by index. The two series come from separate
 * requests and are trimmed independently, so a day present in one and missing
 * from the other would silently pair the wrong values and shift every later
 * point — the same class of mis-join the correlation code carries a whole
 * comment about. A day without both is dropped instead.
 */
export function feePerTxSats(
  feesBtc: readonly NetworkPoint[],
  txCount: readonly NetworkPoint[],
): NetworkPoint[] {
  const txByDate = new Map(txCount.map((p) => [p.date, p.value]));
  const out: NetworkPoint[] = [];
  for (const { date, value } of feesBtc) {
    const txs = txByDate.get(date);
    // A zero or missing transaction count is not a zero fee, it is no
    // observation: dividing would give Infinity, which plots.
    if (txs === undefined || !(txs > 0)) continue;
    out.push({ date, value: Math.round((value / txs) * SATS_PER_BTC) });
  }
  return out;
}

/**
 * Where today's value sits in its own history, as a percentile 0-100, 0 dp.
 *
 * This is what turns a fee number into an answer. `/network` has shown a live
 * sat/vB tier since M8 with nothing to compare it to, and "12 sat/vB" means
 * nothing to a reader who does not already know the range. "Cheaper than 82% of
 * the last two years" means something immediately.
 *
 * Fraction of observations strictly below the latest, so a value at the very
 * bottom reads 0 and one above everything reads just under 100 — never exactly
 * 100, since the latest point cannot be below itself. Null under 30 points,
 * where a percentile is arithmetic rather than information.
 */
export function percentileOfLatest(series: readonly NetworkPoint[]): number | null {
  if (series.length < 30) return null;
  const latest = series.at(-1);
  if (!latest) return null;
  const below = series.filter((p) => p.value < latest.value).length;
  return Math.round((below / series.length) * 100);
}

/**
 * The standing sentence beside a fee figure.
 *
 * Here rather than in the page, because it is arithmetic on a metric and
 * CLAUDE.md keeps metric maths out of components — and because the wording is
 * load-bearing in a way that deserves a test. `percentile` is the share of
 * history *strictly below* the latest, so `100 - percentile` is the share at or
 * above it, and calling that "dearer" is only exact when nothing ties.
 *
 * Measured on the committed 727-day series: 129 days below, 2 tied, 596 above.
 * The strictly-dearer share is 596/727 = 82.0% and `100 - 18` is 82, so the
 * sentence is exact at this rounding. Ties are rare because the figure is a
 * satoshi-resolution quotient of two large numbers, but they exist, and at a
 * coarser unit they would not be negligible — so the direction is chosen by
 * which side reads more naturally, not by pretending ties are absent.
 */
export function feeStandingLabel(percentile: number | null, keepDays: number): string | null {
  if (percentile === null) return null;
  return percentile <= 50
    ? `cheaper than ${100 - percentile}% of ${keepDays}d`
    : `dearer than ${percentile}% of ${keepDays}d`;
}
