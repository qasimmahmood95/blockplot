import { readFile } from 'node:fs/promises';
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
}

export async function fetchDominanceSnapshot(now: Date): Promise<DominanceSnapshot> {
  const global = coingeckoGlobalSchema.parse(await getJson(COINGECKO_GLOBAL_URL));
  return {
    date: now.toISOString().slice(0, 10),
    btcDominancePct: round2(global.data.market_cap_percentage.btc),
    totalMcapUsd: Math.round(global.data.total_market_cap.usd),
  };
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
