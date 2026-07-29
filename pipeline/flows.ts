import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getJson } from './http';
import { trimToLastDays } from './series';
import {
  coingeckoGlobalSchema,
  defillamaStablecoinsSchema,
  dominanceDatasetSchema,
  type DominancePoint,
  type StablecoinPoint,
} from './schema';

/**
 * M5 sources. Stablecoin total supply has full keyless history at DeFiLlama.
 * BTC dominance does not (CoinGecko's global endpoint is current-only on the
 * keyless tier, its history pro-only), so the dominance series accretes one
 * snapshot per UTC day across pipeline runs. Exchange netflow was dropped:
 * no keyless source exists (decided in the M5 PR).
 */
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
const DEFILLAMA_STABLES_URL = 'https://stablecoins.llama.fi/stablecoincharts/all';

/** Trailing calendar days of stablecoin history kept, matching the benchmark buffer. */
export const STABLECOIN_KEEP_DAYS = 460;

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface DominanceSnapshot {
  date: string;
  btcDominancePct: number;
  totalMcapUsd: number;
  ethDominancePct?: number;
  stablecoinSharePct?: number;
  volume24hUsd?: number;
}

/**
 * Reduce a `/global` payload to the snapshot committed for one day.
 *
 * Pure and separately tested, because the interesting behaviour is what it
 * does with fields that are absent rather than what it does with fields that
 * are present. Every optional share is omitted from the result rather than
 * defaulted, so a day CoinGecko did not report one is distinguishable from a
 * day it reported zero. A `?? 0` here would write a real-looking figure into an
 * accreted file that can never be corrected — the same shape of bug as the
 * keyless row that once invented an index in the series codec.
 */
export function toDominanceSnapshot(
  global: z.infer<typeof coingeckoGlobalSchema>,
  date: string,
): DominanceSnapshot {
  const pct = global.data.market_cap_percentage;
  // Summed only over the keys actually present: with usdc missing, the honest
  // answer is USDT's share alone, not a total that silently omits a component
  // while looking like one. Absent entirely when neither is reported.
  const stables = [pct.usdt, pct.usdc].filter((v): v is number => v !== undefined);
  const volume = global.data.total_volume?.usd;
  return {
    date,
    btcDominancePct: round2(pct.btc),
    totalMcapUsd: Math.round(global.data.total_market_cap.usd),
    ...(pct.eth !== undefined ? { ethDominancePct: round2(pct.eth) } : {}),
    ...(stables.length > 0
      ? { stablecoinSharePct: round2(stables.reduce((a, b) => a + b, 0)) }
      : {}),
    ...(volume !== undefined ? { volume24hUsd: Math.round(volume) } : {}),
  };
}

export async function fetchDominanceSnapshot(now: Date): Promise<DominanceSnapshot> {
  const global = coingeckoGlobalSchema.parse(await getJson(COINGECKO_GLOBAL_URL));
  return toDominanceSnapshot(global, now.toISOString().slice(0, 10));
}

/**
 * Append a snapshot to the accreted series: same-day entries are replaced
 * (the last pipeline run of a day wins), earlier days are never rewritten.
 */
export function accreteDominance(
  existing: DominancePoint[],
  snapshot: DominanceSnapshot,
): DominancePoint[] {
  const last = existing.at(-1);
  if (last && snapshot.date < last.date) {
    throw new Error(`accreteDominance: snapshot ${snapshot.date} precedes series end ${last.date}`);
  }
  const kept = existing.filter((p) => p.date < snapshot.date);
  return [...kept, snapshot];
}

/** Load the committed accreted series, or an empty one on first run. */
export async function readExistingDominance(path: string): Promise<DominancePoint[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return dominanceDatasetSchema.parse(JSON.parse(raw)).series;
}

/**
 * Collapse DeFiLlama chart rows into one total per UTC day (last wins),
 * skipping rows without a positive peggedUSD total.
 */
export function parseStablecoinChart(payload: unknown): StablecoinPoint[] {
  const rows = defillamaStablecoinsSchema.parse(payload);
  const byDate = new Map<string, number>();
  for (const row of [...rows].sort((a, b) => Number(a.date) - Number(b.date))) {
    const total = row.totalCirculatingUSD?.peggedUSD;
    if (total === undefined || !Number.isFinite(total) || total <= 0) continue;
    byDate.set(new Date(Number(row.date) * 1000).toISOString().slice(0, 10), Math.round(total));
  }
  const out = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, totalUsd]) => ({ date, totalUsd }));
  if (out.length < 2) throw new Error('parseStablecoinChart: too few usable rows');
  return out;
}

/** Change vs the closest entry at or before 30 calendar days ago, %, 2 dp; null when too short. */
export function stablecoinChange30dPct(series: StablecoinPoint[]): number | null {
  const last = series.at(-1);
  if (!last) return null;
  const target = new Date(Date.parse(`${last.date}T00:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const base = [...series].reverse().find((p) => p.date <= target);
  if (!base) return null;
  return round2((last.totalUsd / base.totalUsd - 1) * 100);
}

export async function fetchStablecoins(): Promise<StablecoinPoint[]> {
  return trimToLastDays(parseStablecoinChart(await getJson(DEFILLAMA_STABLES_URL)), STABLECOIN_KEEP_DAYS);
}

/** One point of one share, flattened so a chart can separate lines by `share`. */
export interface SharePoint {
  date: string;
  pct: number;
  share: 'BTC' | 'ETH' | 'stablecoins';
}

/**
 * Flatten the accreted series into one list of share points.
 *
 * A day that never carried a share contributes nothing for it, which is the
 * whole reason the snapshot fields are optional: BTC dominance reaches back to
 * M5 and the other two begin at M17, so the ETH and stablecoin lines genuinely
 * start later. Emitting a zero to keep the arrays the same length would draw a
 * line claiming ETH had no market share until the day this shipped.
 */
export function sharePoints(series: readonly DominancePoint[]): SharePoint[] {
  const out: SharePoint[] = [];
  for (const point of series) {
    out.push({ date: point.date, pct: point.btcDominancePct, share: 'BTC' });
    if (point.ethDominancePct !== undefined) {
      out.push({ date: point.date, pct: point.ethDominancePct, share: 'ETH' });
    }
    if (point.stablecoinSharePct !== undefined) {
      out.push({ date: point.date, pct: point.stablecoinSharePct, share: 'stablecoins' });
    }
  }
  return out;
}

/**
 * 24h volume as a fraction of total market cap, %, 2 dp — how much of the
 * market changed hands today.
 *
 * Null rather than zero when either input is missing, because the two read
 * completely differently: a null is a day the figure was not captured, and a
 * zero would be a claim that nothing traded.
 */
export function turnoverPct(point: DominancePoint | undefined): number | null {
  if (!point || point.volume24hUsd === undefined || !(point.totalMcapUsd > 0)) return null;
  return round2((point.volume24hUsd / point.totalMcapUsd) * 100);
}
