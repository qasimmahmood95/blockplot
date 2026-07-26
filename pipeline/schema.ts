import { z } from 'zod';

/** Raw response shape of CoinGecko `/coins/{id}/market_chart`. */
export const marketChartSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])),
});

export type MarketChart = z.infer<typeof marketChartSchema>;

/** One UTC calendar day of the BTC/USD series. */
export interface DailyPrice {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  priceUsd: number;
}

/** Headline figures derived from the daily series. Percentages are rounded to 2 dp. */
export interface PriceStats {
  latestDate: string;
  latestPriceUsd: number;
  change7dPct: number | null;
  change30dPct: number | null;
  /** Highest close within the fetched range — not an all-time high. */
  rangeHighUsd: number;
  rangeHighDate: string;
}

/** Versioned on-disk format of data/btc-price-daily.json. */
export interface PriceDataset {
  schemaVersion: 1;
  source: 'coingecko';
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: string;
  /** History window requested from the source, in days. */
  rangeDays: string;
  stats: PriceStats;
  series: DailyPrice[];
}
