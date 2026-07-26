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

/** Raw response shape of blockchain.com `/charts/market-price` (the parts we read). */
export const blockchainChartSchema = z.object({
  values: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const dailyPriceSchema = z.object({ date: isoDate, priceUsd: z.number().positive() });

/** Versioned on-disk format of data/btc-price-history.json (full daily history). */
export const historyDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('blockchain.info'),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  series: z.array(dailyPriceSchema).min(1000),
});

export type HistoryDataset = z.infer<typeof historyDatasetSchema>;

const cyclePointSchema = z.object({
  /** Calendar days since the halving. */
  day: z.number().int().nonnegative(),
  /** Price as a multiple of the halving-day close, 4 dp. */
  multiple: z.number().positive(),
});

export type CyclePoint = z.infer<typeof cyclePointSchema>;

const halvingCycleSchema = z.object({
  cycle: z.number().int().positive(),
  halvingDate: isoDate,
  /** Next halving date, or null for the open current cycle. */
  endDate: isoDate.nullable(),
  basePriceUsd: z.number().positive(),
  series: z.array(cyclePointSchema).min(1),
});

export type HalvingCycle = z.infer<typeof halvingCycleSchema>;

/** Versioned on-disk format of data/halving-cycles.json. */
export const halvingDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('blockchain.info'),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Last history date the cycles run up to. */
  asOf: isoDate,
  cycles: z.array(halvingCycleSchema).min(1),
});

export type HalvingDataset = z.infer<typeof halvingDatasetSchema>;

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
      asset: z.enum(['sp500', 'gold', 'dxy']),
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

const corrPointSchema = z.object({
  date: isoDate,
  /** Pearson correlation of aligned daily log returns, 2 dp, in [-1, 1]. */
  corr: z.number().min(-1).max(1),
});

export type CorrPoint = z.infer<typeof corrPointSchema>;

const corrAsset = z.enum(['btc', 'sp500', 'gold', 'dxy']);

const pairIdSchema = z.enum([
  'btc-sp500',
  'btc-gold',
  'btc-dxy',
  'sp500-gold',
  'sp500-dxy',
  'gold-dxy',
]);

export type PairId = z.infer<typeof pairIdSchema>;

/** Versioned on-disk format of data/correlations.json. */
export const correlationDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  asOf: isoDate,
  /** Rolling window in calendar days, and the fewest aligned returns a window may hold. */
  windowDays: z.number().int().min(2),
  minObs: z.number().int().min(2),
  pairs: z.array(
    z.object({
      pair: pairIdSchema,
      a: corrAsset,
      b: corrAsset,
      /** Empty entries are allowed while a pair's sources lack shared history. */
      series: z.array(corrPointSchema),
    }),
  ),
});

export type CorrelationDataset = z.infer<typeof correlationDatasetSchema>;

/** Versioned on-disk format of data/risk-metrics.json. */
export const riskDatasetSchema = z.object({
  schemaVersion: z.literal(2),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Latest BTC date all metrics run up to. */
  asOf: isoDate,
  /** Calendar days in the BTC window the metrics are computed over. */
  windowDays: z.number().int().min(3),
  /** Price series the rolling-vol curves derive from (deep history enables the 365d window). */
  rollingVolSource: z.enum(['coingecko', 'blockchain.info']),
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
