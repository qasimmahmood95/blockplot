import { z } from 'zod';
import { CURRENCIES, type Currency } from './currencies';

/** Raw response shape of CoinGecko `/coins/{id}/market_chart`. */
export const marketChartSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])).min(1),
});

export type MarketChart = z.infer<typeof marketChartSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Display currency of a derived dataset. USD is the source currency; GBP
 * files are rebuilt from closes converted at each day's rate, so every
 * percentage metric in them is genuinely GBP-denominated, not relabelled.
 */
export const currencySchema = z.enum(CURRENCIES);

export { CURRENCIES, type Currency };

/** Raw response shape of Frankfurter's ECB time-series endpoint. */
export const frankfurterSchema = z.object({
  rates: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.object({ USD: z.number().positive() }),
  ),
});

/** Rate feeds the merged GBP/USD series can draw on. */
export const fxSourceSchema = z.enum(['yahoo', 'fred', 'ecb']);

export type FxSource = z.infer<typeof fxSourceSchema>;

/** Versioned on-disk format of data/fx-gbpusd.json. */
export const fxDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  pair: z.literal('GBPUSD'),
  /**
   * Which feeds actually contributed to this file. Recorded rather than
   * hard-coded because each is individually optional: a run that lost the
   * ECB leg is still valid, just staler, and the file should say so.
   */
  sources: z.array(fxSourceSchema).min(1),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** USD per GBP, one entry per quoted weekday. */
  series: z
    .array(z.object({ date: isoDate, close: z.number().positive() }))
    .min(365),
});

export type FxDataset = z.infer<typeof fxDatasetSchema>;

/** superRefine body pinning strictly ascending dates on a series. */
function refineAscendingDates(series: { date: string }[], ctx: z.RefinementCtx): void {
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev && curr && curr.date <= prev.date) {
      ctx.addIssue({ code: 'custom', message: `dates not strictly ascending at ${curr.date}` });
    }
  }
}

/** One UTC calendar day of the BTC series, priced in the dataset's currency. */
const dailyPriceShape = z.object({
  /** UTC date, YYYY-MM-DD. */
  date: isoDate,
  price: z.number().positive(),
});

export type DailyPrice = z.infer<typeof dailyPriceShape>;

/** Headline figures derived from the daily series. Percentages are rounded to 2 dp. */
const priceStatsSchema = z.object({
  latestDate: isoDate,
  latestPrice: z.number().positive(),
  change7dPct: z.number().nullable(),
  change30dPct: z.number().nullable(),
  /** Highest close within the fetched range — not an all-time high. */
  rangeHigh: z.number().positive(),
  rangeHighDate: isoDate,
});

export type PriceStats = z.infer<typeof priceStatsSchema>;

/** Versioned on-disk format of data/btc-price-daily.json. */
export const priceDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('coingecko'),
  currency: currencySchema,
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** History window requested from the source, in days. */
  rangeDays: z.string(),
  stats: priceStatsSchema,
  series: z.array(dailyPriceShape).min(2).superRefine(refineAscendingDates),
});

export type PriceDataset = z.infer<typeof priceDatasetSchema>;

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

/** Versioned on-disk format of data/btc-price-history.json (full daily history). */
export const historyDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('blockchain.info'),
  currency: currencySchema,
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  series: z.array(dailyPriceShape).min(1000),
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
  basePrice: z.number().positive(),
  series: z.array(cyclePointSchema).min(1),
});

export type HalvingCycle = z.infer<typeof halvingCycleSchema>;

/** Versioned on-disk format of data/halving-cycles.json. */
export const halvingDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('blockchain.info'),
  currency: currencySchema,
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

/**
 * How far the natively-quoted ETH-GBP series sits from the same asset
 * converted through the committed rate, as measured by the run that wrote this
 * file. Present only in the GBP tree, and only when both routes were available.
 *
 * Committed rather than logged because the methodology page quotes these
 * figures, and that page's own contract is that every number on it is read from
 * the file that produced it. They were prose literals for one commit, including
 * a 95th percentile the check did not compute — a figure attributed to a
 * measurement that was not making it.
 */
const quoteDivergenceSchema = z.object({
  /** Dates both series carry. */
  days: z.number().int().positive(),
  medianPct: z.number().nonnegative(),
  p95Pct: z.number().nonnegative(),
  maxPct: z.number().nonnegative(),
  maxDate: isoDate,
  beyond1Pct: z.number().int().nonnegative(),
  /** The band the median is asserted against, so the page cannot quote a stale one. */
  bandPct: z.number().positive(),
});

export type QuoteDivergenceStats = z.infer<typeof quoteDivergenceSchema>;

/** Versioned on-disk format of data/benchmarks-daily.json. */
export const benchmarkDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  currency: currencySchema,
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Calendar days of history kept per series (trailing window). */
  keepDays: z.number().int().positive(),
  ethQuoteDivergence: quoteDivergenceSchema.optional(),
  benchmarks: z
    .array(
      z.object({
        asset: z.enum(['sp500', 'gold', 'dxy', 'eth']),
        source: z.enum(['fred', 'yahoo']),
        /** Identifier of the series at its source, e.g. the FRED series id. */
        sourceSeries: z.string().min(1),
        series: z.array(benchmarkDaySchema).min(2),
      }),
    )
    /**
     * The three original benchmarks are whole-or-nothing; ETH is allowed to be
     * missing.
     *
     * It was briefly `.length(4)`, which made a Yahoo ETH outage cost this
     * entire file — and `correlations.json` with it — while `risk-metrics.json`
     * was still rewritten without its ETH row. The site would then have shown
     * ETH in the benchmark sources and the correlation matrix, from yesterday's
     * files, and not in the risk table, with nothing anywhere saying why. Two
     * files silently a day older than the third is worse than one file with a
     * column missing, because only the second is visible.
     */
    .min(3)
    .max(4)
    .superRefine((benchmarks, ctx) => {
      const assets = new Set(benchmarks.map((b) => b.asset));
      if (assets.size !== benchmarks.length) {
        ctx.addIssue({ code: 'custom', message: 'duplicate benchmark asset' });
      }
      for (const required of ['sp500', 'gold', 'dxy'] as const) {
        if (!assets.has(required)) {
          ctx.addIssue({ code: 'custom', message: `missing benchmark asset ${required}` });
        }
      }
    }),
});

export type BenchmarkDataset = z.infer<typeof benchmarkDatasetSchema>;

/**
 * Versioned on-disk format of data/benchmarks-history.json.
 *
 * Separate from benchmarks-daily.json rather than an extension of it, because
 * the two answer different questions and are read by different pages. The daily
 * file is a 460-day window at full resolution, which is what the risk table
 * needs; this one reaches back a decade at mixed resolution, which is what a
 * rebased performance chart needs and what the risk table must never
 * accidentally read.
 *
 * The resolution rule is recorded in the file rather than left implicit in the
 * code that wrote it: a reader — or a later page — can tell that the early part
 * of a series is weekly without knowing which pipeline version produced it.
 */
export const benchmarkHistoryDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  currency: currencySchema,
  fetchedAt: z.string(),
  /** Calendar days at the end of each series kept at daily resolution. */
  dailyDays: z.number().int().positive(),
  /** How everything older than that is stored. */
  olderResolution: z.literal('weekly-last'),
  series: z
    .array(
      z.object({
        asset: z.enum(['btc', 'eth', 'sp500', 'gold', 'dxy']),
        /** Identifier at the source, or 'derived' for BTC's own history file. */
        sourceSeries: z.string().min(1),
        rows: z.array(benchmarkDaySchema).min(2).superRefine(refineAscendingDates),
      }),
    )
    .min(2)
    .superRefine((series, ctx) => {
      if (new Set(series.map((s) => s.asset)).size !== series.length) {
        ctx.addIssue({ code: 'custom', message: 'duplicate history asset' });
      }
      // BTC is the one series this file cannot be useful without: every other
      // line exists to be compared against it.
      if (!series.some((s) => s.asset === 'btc')) {
        ctx.addIssue({ code: 'custom', message: 'missing history asset btc' });
      }
    }),
});

export type BenchmarkHistoryDataset = z.infer<typeof benchmarkHistoryDatasetSchema>;

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
  asset: z.enum(['btc', 'eth', 'sp500', 'gold']),
  /**
   * Annualization base: 365 for the assets that trade every day (BTC, and ETH
   * from M17), 252 for market-hours assets. Not cosmetic — annualizing a
   * 7-day series on 252 periods would overstate its volatility by a factor of
   * sqrt(365/252), about 1.20, and the figure would still look plausible.
   */
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

/**
 * Raw response shape of CoinGecko `/global` (the parts we read).
 *
 * Everything beyond `btc` is optional, and deliberately so. This is one
 * request that already runs every six hours, so the extra fields cost nothing
 * — but they are not all equally guaranteed. `market_cap_percentage` is a
 * leaderboard, not a fixed record: it carries whichever coins are largest at
 * the time, so a stablecoin dropping out of the top ten would take its key
 * with it. Requiring `usdt` would then fail the whole flows fetch, and with it
 * the accreted dominance series' entry for that day — a day of history that
 * cannot be recovered later. A missing share is recorded as absent instead.
 *
 * `btc` stays required: it has been the largest holding since the endpoint
 * existed, and if it ever vanished the failure would be the correct outcome.
 *
 * Optional here means "absent OR unusable", not merely "absent" — hence the
 * `.catch(undefined)` on each. The first version of this reasoned carefully
 * about a *dropped key* and not at all about a *malformed value*, which is a
 * distinction only zod cares about and the accreted file pays for: review
 * demonstrated that `total_volume: {usd: null}`, a non-numeric share, or a
 * `total_volume` object carrying other currencies but not `usd` each failed
 * the whole parse, threw out of the flows fetch, and cost that UTC day
 * permanently — where the pre-M17 schema, which never looked at those fields,
 * kept the day. Widening what we read must not narrow what we can survive.
 */
const optionalShare = z.number().min(0).max(100).optional().catch(undefined);

export const coingeckoGlobalSchema = z.object({
  data: z.object({
    total_market_cap: z.object({ usd: z.number().positive() }),
    total_volume: z
      .object({ usd: z.number().nonnegative().optional().catch(undefined) })
      .optional()
      .catch(undefined),
    market_cap_percentage: z.object({
      btc: z.number().min(0).max(100),
      eth: optionalShare,
      usdt: optionalShare,
      usdc: optionalShare,
    }),
  }),
});

/** Raw response shape of DeFiLlama `/stablecoincharts/all` (the parts we read). */
export const defillamaStablecoinsSchema = z
  .array(
    z.object({
      /** Unix seconds, as a string. */
      date: z.string().regex(/^\d+$/),
      totalCirculatingUSD: z.object({ peggedUSD: z.number().optional() }).optional(),
    }),
  )
  .min(1);

/**
 * One accreted snapshot.
 *
 * Every field added after the first is optional, and stays optional forever.
 * The series accretes one entry per UTC day and earlier days are never
 * rewritten, so the points committed before a field existed genuinely do not
 * have it — there is no source to backfill them from. Marking a later field
 * required would reject the file's own history on the next read, and the
 * charts have to render a series that starts partway through regardless.
 */
const dominancePointSchema = z.object({
  date: isoDate,
  /** BTC share of total crypto market cap, %, 2 dp. */
  btcDominancePct: z.number().min(0).max(100),
  totalMcapUsd: z.number().positive(),
  /** ETH share of total crypto market cap, %, 2 dp. Captured from M17. */
  ethDominancePct: z.number().min(0).max(100).optional(),
  /**
   * USDT + USDC share of total crypto market cap, %, 2 dp. Captured from M17.
   *
   * The two summed rather than kept apart: the question this answers is how
   * much of the market is sitting in dollars, and splitting it by issuer
   * invites a reading about issuer market share that the number does not
   * support — CoinGecko's leaderboard can drop either key on any run.
   */
  stablecoinSharePct: z.number().min(0).max(100).optional(),
  /** Aggregate 24h volume across all tracked assets, whole USD. From M17. */
  volume24hUsd: z.number().nonnegative().optional(),
});

export type DominancePoint = z.infer<typeof dominancePointSchema>;

/**
 * Versioned on-disk format of data/dominance.json. Historical dominance has
 * no keyless source, so this series ACCRETES: each pipeline run appends (or
 * replaces) the entry for its own UTC day.
 */
export const dominanceDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('coingecko'),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  // The accreted file is load-bearing state: a mis-ordered series (bad
  // merge resolution, hand edit) must fail loudly, never trim silently.
  series: z.array(dominancePointSchema).min(1).superRefine(refineAscendingDates),
});

export type DominanceDataset = z.infer<typeof dominanceDatasetSchema>;

const stablecoinPointSchema = z.object({
  date: isoDate,
  /** Total circulating USD-pegged stablecoin value, whole USD. */
  totalUsd: z.number().positive(),
});

export type StablecoinPoint = z.infer<typeof stablecoinPointSchema>;

/** Versioned on-disk format of data/stablecoins.json. */
export const stablecoinDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('defillama'),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  /** Trailing calendar days kept. */
  keepDays: z.number().int().positive(),
  /** Change vs the closest entry at or before 30 days ago, %, 2 dp; null when history is short. */
  change30dPct: z.number().nullable(),
  series: z.array(stablecoinPointSchema).min(2),
});

export type StablecoinDataset = z.infer<typeof stablecoinDatasetSchema>;

/** Raw response shape of mempool.space `/api/v1/fees/recommended`. */
export const mempoolFeesSchema = z.object({
  fastestFee: z.number().positive(),
  halfHourFee: z.number().positive(),
  hourFee: z.number().positive(),
  economyFee: z.number().positive(),
  minimumFee: z.number().positive(),
});

/** Recommended fee tiers, sat/vB. */
export const feeTiersSchema = mempoolFeesSchema;

export type FeeTiers = z.infer<typeof feeTiersSchema>;

const networkPointSchema = z.object({ date: isoDate, value: z.number().positive() });

export type NetworkPoint = z.infer<typeof networkPointSchema>;

/** Versioned on-disk format of data/network.json. */
export const networkDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  asOf: isoDate,
  /** Trailing calendar days kept per series. */
  keepDays: z.number().int().positive(),
  hashRate: z.object({
    /** Exahashes per second, converted from the source's TH/s. */
    unit: z.literal('EH/s'),
    /** Trailing 7-entry mean, 1 dp — the headline level, since daily estimates swing ~8%. */
    average7d: z.number().positive().nullable(),
    /** Trailing 7-entry mean vs the 7-entry mean 30 days back, %, 2 dp. */
    change30dPct: z.number().nullable(),
    series: z.array(networkPointSchema).min(2).superRefine(refineAscendingDates),
  }),
  txCount: z.object({
    unit: z.literal('tx/day'),
    /** Mean of the trailing 30 entries, whole transactions. */
    average30d: z.number().positive().nullable(),
    /** Trailing 7-entry mean vs the 7-entry mean 30 days back, %, 2 dp. */
    change30dPct: z.number().nullable(),
    series: z.array(networkPointSchema).min(2).superRefine(refineAscendingDates),
  }),
  /**
   * Fee tiers move on a ~10-minute timescale, so this committed snapshot is a
   * floor that the network page's island refreshes live and falls back to.
   */
  fees: z.object({ source: z.literal('mempool.space'), tiers: feeTiersSchema }),
});

export type NetworkDataset = z.infer<typeof networkDatasetSchema>;

const monthlyReturnSchema = z.object({
  year: z.number().int().min(2009),
  month: z.number().int().min(1).max(12),
  /** Close-over-previous-month-close, %, 2 dp; the newest entry is month-to-date. */
  returnPct: z.number(),
});

export type MonthlyReturn = z.infer<typeof monthlyReturnSchema>;

const yearlyReturnSchema = z.object({
  year: z.number().int().min(2009),
  /** Compounded product of that year's available monthly returns, %, 2 dp. */
  returnPct: z.number(),
});

export type YearlyReturn = z.infer<typeof yearlyReturnSchema>;

/** Versioned on-disk format of data/monthly-returns.json. */
export const monthlyDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('blockchain.info'),
  currency: currencySchema,
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  asOf: isoDate,
  months: z.array(monthlyReturnSchema).min(1),
  years: z.array(yearlyReturnSchema).min(1),
});

export type MonthlyDataset = z.infer<typeof monthlyDatasetSchema>;

const corrPointSchema = z.object({
  date: isoDate,
  /** Pearson correlation of aligned daily log returns, 2 dp, in [-1, 1]. */
  corr: z.number().min(-1).max(1),
});

export type CorrPoint = z.infer<typeof corrPointSchema>;

/**
 * Regime of a rolling correlation: co-moving, inverse, or neither, after the
 * hysteresis in regimes.ts has rejected threshold-crossing noise.
 */
export const regimeSchema = z.enum(['positive', 'neutral', 'negative']);

export type Regime = z.infer<typeof regimeSchema>;

const regimeSegmentSchema = z.object({
  regime: regimeSchema,
  startDate: isoDate,
  /**
   * Where the regime was actually confirmed. Equal to `startDate` except on a
   * segment that absorbed an unconfirmed opening, where `startDate` reaches
   * back to the series start but the regime itself was only established here.
   */
  confirmedFrom: isoDate,
  endDate: isoDate,
  /** Correlation readings in the segment (shared trading days, not calendar days). */
  observations: z.number().int().positive(),
  /** Inclusive calendar-day span, so a one-observation segment is 1. */
  days: z.number().int().positive(),
  /**
   * Mean correlation over `confirmedFrom`..`endDate`, 2 dp — the readings that
   * established the regime, not the absorbed opening. Taking it over the whole
   * span would let a row label itself inverse while reporting a co-moving
   * average; `confirmedFrom` is published so the two numbers reconcile.
   */
  meanCorr: z.number().min(-1).max(1),
});

export type RegimeSegment = z.infer<typeof regimeSegmentSchema>;

const corrAsset = z.enum(['btc', 'eth', 'sp500', 'gold', 'dxy']);

/**
 * Every unordered pair, in the enumeration order `CORRELATION_ASSETS` produces.
 *
 * Five assets give ten pairs (M17 added ETH). Only `btc-eth` is carried at full
 * depth alongside the other BTC pairs; ETH's remaining three keep the 365-day
 * window, under the rule `NON_BTC_KEEP_DAYS` already states — this is a Bitcoin
 * site, and a pair with no BTC in it exists to fill one cell of the matrix.
 */
const pairIdSchema = z.enum([
  'btc-eth',
  'btc-sp500',
  'btc-gold',
  'btc-dxy',
  'eth-sp500',
  'eth-gold',
  'eth-dxy',
  'sp500-gold',
  'sp500-dxy',
  'gold-dxy',
]);

export type PairId = z.infer<typeof pairIdSchema>;

/** Versioned on-disk format of data/correlations.json. */
export const correlationDatasetSchema = z.object({
  // v2 (M11): series run the full shared history rather than a 365d window,
  // and each pair carries its regime segmentation.
  schemaVersion: z.literal(2),
  currency: currencySchema,
  /** ISO 8601 instant of the pipeline run that produced this file. */
  fetchedAt: z.string(),
  asOf: isoDate,
  /** Rolling window in calendar days, and the fewest aligned returns a window may hold. */
  windowDays: z.number().int().min(2),
  minObs: z.number().int().min(2),
  /** |corr| at or beyond which a reading is co-moving or inverse. */
  regimeThreshold: z.number().positive().max(1),
  /** Consecutive readings a candidate regime must hold before it takes over. */
  regimeConfirmDays: z.number().int().positive(),
  pairs: z.array(
    z.object({
      pair: pairIdSchema,
      a: corrAsset,
      b: corrAsset,
      /** Empty entries are allowed while a pair's sources lack shared history. */
      series: z.array(corrPointSchema),
      /**
       * Contiguous, gapless, and empty exactly when `series` is. Segments are
       * classified over the pair's full history, so on a clipped pair (see
       * NON_BTC_KEEP_DAYS) the first segment can start before `series` does
       * and count observations the shipped series omits — deliberately: the
       * regime's true start date is more useful than one truncated at the
       * display window.
       */
      regimes: z.array(regimeSegmentSchema),
    }),
  ),
});

export type CorrelationDataset = z.infer<typeof correlationDatasetSchema>;

/** Versioned on-disk format of data/risk-metrics.json. */
export const riskDatasetSchema = z.object({
  schemaVersion: z.literal(2),
  currency: currencySchema,
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

const bandSpanSchema = z.object({
  state: z.string().min(1),
  since: isoDate,
  observations: z.number().int().positive(),
});

/**
 * A confirmed band state plus the candidate queueing behind it. `pending` is
 * not decoration: it is what stops the page reporting "low" the day a reading
 * drifts a fraction under a threshold, while still admitting that it has.
 */
const bandSignalSchema = z.object({
  state: z.string().min(1),
  since: isoDate,
  observations: z.number().int().positive(),
  pending: bandSpanSchema.nullable(),
  history: z.array(bandSpanSchema).min(1),
});

/** Versioned on-disk format of data/signals.json. */
export const signalsDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  currency: currencySchema,
  fetchedAt: z.iso.datetime(),
  asOf: isoDate,
  /** Thresholds recorded alongside the states, so a reader can check the call. */
  thresholds: z.object({
    volWindowDays: z.number().int().positive(),
    volLowPct: z.number().positive(),
    volHighPct: z.number().positive(),
    drawdownBandsPct: z.array(z.number().negative()).min(1),
    confirmDays: z.number().int().positive(),
  }),
  /**
   * Spans a bare threshold test would produce over the same series. Committed
   * because the page cites it to justify the hysteresis, and a page must not
   * assert a number about its own data that nothing computed.
   */
  rawSpans: z.object({ vol: z.number().int().nonnegative(), drawdown: z.number().int().nonnegative() }),
  vol: bandSignalSchema.nullable(),
  drawdown: bandSignalSchema.nullable(),
  ath: z
    .object({
      date: isoDate,
      price: z.number().positive(),
      latestDate: isoDate,
      latestPrice: z.number().positive(),
      fromAthPct: z.number(),
      daysSince: z.number().int().nonnegative(),
      isNew: z.boolean(),
    })
    .nullable(),
  cycle: z
    .object({
      /** Halving that opened the running cycle. */
      halvingDate: isoDate,
      peakMultiple: z.number().positive(),
      peakDay: z.number().int().nonnegative(),
      latestMultiple: z.number().positive(),
      latestDay: z.number().int().nonnegative(),
      isNew: z.boolean(),
    })
    .nullable(),
  /**
   * Null until the accreted dominance series is deep enough to carry a signal.
   * Nullable rather than omitted so the absence is explicit in the file.
   */
  dominance: z
    .object({
      latestPct: z.number().positive(),
      latestDate: isoDate,
      changePp: z.number(),
      overDays: z.number().int().positive(),
      fromDate: isoDate,
    })
    .nullable(),
});

export type SignalsDataset = z.infer<typeof signalsDatasetSchema>;
