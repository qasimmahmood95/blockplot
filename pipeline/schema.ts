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

/** Raw response shape of Yahoo Finance `/v8/finance/chart/{ticker}` (the parts we read). */
export const yahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()),
          indicators: z.object({
            quote: z.array(z.object({ close: z.array(z.number().nullable()) })),
          }),
        }),
      )
      .min(1),
  }),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One daily close of a benchmark series. */
export const benchmarkDaySchema = z.object({
  date: isoDate,
  close: z.number().positive(),
});

export type BenchmarkDay = z.infer<typeof benchmarkDaySchema>;

/** Versioned on-disk format of data/benchmarks-daily.json. */
export const benchmarkDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Calendar days of history kept per series (trailing window). */
  keepDays: z.number().int().positive(),
  benchmarks: z.array(
    z.object({
      asset: z.enum(['sp500', 'gold']),
      source: z.enum(['fred', 'yahoo']),
      /** Identifier of the series at its source, e.g. the FRED series id. */
      sourceSeries: z.string().min(1),
      series: z.array(benchmarkDaySchema).min(2),
    }),
  ),
});

export type BenchmarkDataset = z.infer<typeof benchmarkDatasetSchema>;

const volPointSchema = z.object({
  date: isoDate,
  /** Annualized realized volatility over the trailing window, %, 2 dp. */
  volPct: z.number().nonnegative(),
});

export type VolPoint = z.infer<typeof volPointSchema>;

const drawdownPointSchema = z.object({
  date: isoDate,
  /** Decline from the running peak, %, 2 dp; 0 at a new high. */
  drawdownPct: z.number().nonpositive(),
});

export type DrawdownPoint = z.infer<typeof drawdownPointSchema>;

/** Risk figures for one asset over the shared comparison window. */
export const riskAssetStatsSchema = z.object({
  asset: z.enum(['btc', 'sp500', 'gold']),
  /** Annualization base: 365 for BTC (trades daily), 252 for market-hours assets. */
  periodsPerYear: z.union([z.literal(365), z.literal(252)]),
  observations: z.number().int().min(3),
  firstDate: isoDate,
  lastDate: isoDate,
  totalReturnPct: z.number(),
  annualizedVolPct: z.number().nonnegative(),
  /** Null when undefined (fewer than 2 returns, or zero variance). */
  sharpe: z.number().nullable(),
  /** Null when undefined (no negative returns in the window). */
  sortino: z.number().nullable(),
  maxDrawdownPct: z.number().nonpositive(),
});

export type RiskAssetStats = z.infer<typeof riskAssetStatsSchema>;

/** Versioned on-disk format of data/risk-metrics.json. */
export const riskDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Latest BTC date all metrics run up to. */
  asOf: isoDate,
  /** Calendar days in the BTC window the metrics are computed over. */
  windowDays: z.number().int().min(3),
  rollingVol: z.array(
    z.object({
      windowDays: z.number().int().min(2),
      /** Empty when the BTC history is shorter than the window. */
      series: z.array(volPointSchema),
    }),
  ),
  drawdown: z.object({
    maxDrawdownPct: z.number().nonpositive(),
    /** Date of the running peak the deepest drawdown fell from. */
    peakDate: isoDate,
    /** First date the deepest drawdown was reached. */
    troughDate: isoDate,
    series: z.array(drawdownPointSchema).min(2),
  }),
  comparison: z.array(riskAssetStatsSchema).min(1),
});

export type RiskDataset = z.infer<typeof riskDatasetSchema>;
