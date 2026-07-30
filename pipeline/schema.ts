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

/**
 * ISO week key, duplicated from `series.ts` rather than imported.
 *
 * schema.ts is imported by the site's data loader and by the pipeline; series.ts
 * is pipeline-only. Importing it here would pull the trimming helpers into every
 * page bundle to validate one refinement. Six lines, and the refinement it backs
 * is what stops the two definitions drifting: if this one were wrong, the
 * committed file would fail its own weekly-resolution check.
 */
function isoWeekKeyForSchema(date: string): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

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
        // Back-ported from the history schema, which had it and this did not:
        // the same file, the same source, the same failure available.
        series: z.array(benchmarkDaySchema).min(2).superRefine(refineAscendingDates),
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
})
  // `olderResolution` was a literal nothing verified: a build that wrote the
  // older section daily, or twice a week, while still stamping 'weekly-last'
  // would have validated. That is not hypothetical — the ISO-week helper had a
  // bug that kept two points for one week, and it was caught by a unit test
  // rather than here, which is the wrong layer for a claim the file makes about
  // itself.
  .superRefine((doc, ctx) => {
    for (const s of doc.series) {
      const last = s.rows.at(-1);
      if (!last) continue;
      const cutoff = new Date(
        Date.parse(`${last.date}T00:00:00Z`) - doc.dailyDays * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const weeks = new Set<string>();
      for (const row of s.rows) {
        if (row.date > cutoff) continue;
        if (weeks.has(isoWeekKeyForSchema(row.date))) {
          ctx.addIssue({
            code: 'custom',
            message: `${s.asset}: more than one point in ISO week ${isoWeekKeyForSchema(row.date)}, but olderResolution is weekly-last`,
          });
          return;
        }
        weeks.add(isoWeekKeyForSchema(row.date));
      }
    }
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
   * Mean fee per confirmed transaction, in satoshis — total daily fees divided
   * by daily transactions, both from blockchain.com.
   *
   * Optional, because it arrived in M19 and the pipeline writes this file even
   * when one source fails. Satoshis rather than a currency: `/network` carries
   * chain properties only, and the live tiers this contextualises are already
   * quoted in sat/vB.
   */
  feePerTx: z
    .object({
      unit: z.literal('sats/tx'),
      /** Mean of the trailing 30 entries, whole satoshis. */
      average30d: z.number().nonnegative().nullable(),
      /** Trailing 7-entry mean vs the 7-entry mean 30 days back, %, 2 dp. */
      change30dPct: z.number().nullable(),
      /**
       * Where the latest entry sits in this series' own distribution, 0-100.
       * Null under 30 observations. What turns a fee number into an answer.
       */
      percentile: z.number().min(0).max(100).nullable(),
      series: z.array(networkPointSchema).min(2).superRefine(refineAscendingDates),
    })
    .optional(),
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

const isoMonth = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * Versioned on-disk format of data/real-returns.json.
 *
 * Both figures for each day rather than the real one alone, and the deflator's
 * own metadata alongside them. The page states the base month, the source series
 * and the publication lag, and every one of those is read from here rather than
 * written into the markup — the class of defect this project keeps producing is
 * prose that the data contradicts, and a literal in a component is exactly how
 * that happens.
 */
export const realReturnsDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: currencySchema,
    fetchedAt: z.string(),
    /** Last day the deflator covers, which is where both series end. */
    asOf: isoDate,
    /** Last day prices exist for, which is later. The page states the gap. */
    pricesThrough: isoDate,
    deflator: z.object({
      /**
       * Which API served it. FRED for US CPI; ONS for the UK, because FRED has no
       * live monthly UK series — see CPI_CANDIDATES for the measured 404s.
       */
      source: z.enum(['fred', 'ons']),
      /** Series id at the source, e.g. CPIAUCSL. */
      sourceSeries: z.string().min(1),
      seasonalAdjustment: z.enum(['seasonally-adjusted', 'not-adjusted']),
      /** The month whose money every real figure is stated in. */
      baseMonth: isoMonth,
      firstMonth: isoMonth,
      lastMonth: isoMonth,
      /** Whole months the deflator trails the prices by. */
      lagMonths: z.number().int().nonnegative(),
      /** The lag at which the pipeline treats the series as retired, not late. */
      maxLagMonths: z.number().int().positive(),
      /**
       * Months inside the drawn range that the source did not publish, so the
       * page can name the hole in the line instead of leaving it unexplained.
       * US CPI has one: the October 2025 release was cancelled, not delayed.
       */
      missingMonths: z.array(isoMonth),
    }),
    /** Calendar days at the end of the series kept at daily resolution. */
    dailyDays: z.number().int().positive(),
    /** How everything older than that is stored. */
    olderResolution: z.literal('weekly-last'),
    /**
     * The shortest span the run was willing to annualise.
     *
     * Recorded rather than left in the code the page imports: a committed file
     * may have been produced under a different rule than the build that renders
     * it, and stating today's threshold over yesterday's figures is the inverse
     * of what this dataset exists for.
     */
    minAnnualiseDays: z.number().int().positive(),
    windows: z
      .array(
        z.object({
          label: z.string().min(1),
          start: isoDate,
          nominalPct: z.number().nullable(),
          realPct: z.number().nullable(),
          nominalCagrPct: z.number().nullable(),
          realCagrPct: z.number().nullable(),
          inflationPct: z.number().nullable(),
        }),
      )
      .min(1),
    series: z
      .array(
        z.object({
          date: isoDate,
          nominal: z.number().positive(),
          real: z.number().positive(),
        }),
      )
      .min(2)
      .superRefine(refineAscendingDates),
  })
  .superRefine((doc, ctx) => {
    // The file's own claims, checked here rather than trusted. Each of these is
    // a way the page could state something false while every individual figure
    // looked reasonable.
    if (doc.series.at(-1)?.date !== doc.asOf) {
      ctx.addIssue({
        code: 'custom',
        message: `asOf ${doc.asOf} is not the last day of the series (${doc.series.at(-1)?.date})`,
      });
    }
    if (doc.asOf > doc.pricesThrough) {
      ctx.addIssue({ code: 'custom', message: 'asOf is later than pricesThrough' });
    }
    // The base month is what "real" means here, and it has to be a month the
    // deflator actually published — otherwise every real figure is scaled by a
    // number that does not exist.
    //
    // The range checks are the weak half and were once the whole of it: the writer
    // sets `baseMonth` and `lastMonth` from the same expression, so neither can
    // fire, and neither establishes what the sentence above claims. A month inside
    // `missingMonths` sits comfortably in range and has no observation at all.
    if (doc.deflator.baseMonth > doc.deflator.lastMonth) {
      ctx.addIssue({ code: 'custom', message: 'baseMonth is beyond the last published month' });
    }
    if (doc.deflator.baseMonth < doc.deflator.firstMonth) {
      ctx.addIssue({ code: 'custom', message: 'baseMonth is before the first published month' });
    }
    if (doc.deflator.missingMonths.includes(doc.deflator.baseMonth)) {
      ctx.addIssue({
        code: 'custom',
        message: `baseMonth ${doc.deflator.baseMonth} is one of the unpublished months`,
      });
    }
    // The last day of the series must fall inside the last published month:
    // a later day would mean it was deflated by an index that does not cover it,
    // which is the carry-forward this dataset exists to refuse.
    if (doc.asOf.slice(0, 7) > doc.deflator.lastMonth) {
      ctx.addIssue({
        code: 'custom',
        message: `series runs to ${doc.asOf}, past the last published month ${doc.deflator.lastMonth}`,
      });
    }
    if (doc.deflator.lagMonths > doc.deflator.maxLagMonths) {
      ctx.addIssue({
        code: 'custom',
        message: `deflator lags by ${doc.deflator.lagMonths} months, beyond ${doc.deflator.maxLagMonths}`,
      });
    }
    // Every window has to be anchored on a row this file actually contains, and
    // end before the series does.
    //
    // Membership, not range. `window.start >= series[0].date` was the first
    // version and it is far weaker than it looks: it caught the max window when
    // the pipeline measured on the full daily series and committed the thinned
    // one, and it would have missed 3y, 5y and 10y in the same run, because their
    // targets sit comfortably inside the range while matching no row. The
    // property the tiles depend on is that every figure above the chart is
    // measured on a point the chart draws.
    const dates = new Set(doc.series.map((row) => row.date));
    for (const window of doc.windows) {
      if (window.start >= doc.asOf) {
        ctx.addIssue({
          code: 'custom',
          message: `window ${window.label} starts ${window.start}, not before asOf ${doc.asOf}`,
        });
      }
      if (!dates.has(window.start)) {
        ctx.addIssue({
          code: 'custom',
          message: `window ${window.label} starts ${window.start}, which is not a row in the series`,
        });
      }
    }
    // Same rule the benchmark history carries, and for the same reason: the
    // resolution claim is otherwise a string nothing verifies.
    const last = doc.series.at(-1);
    if (!last) return;
    const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - doc.dailyDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const weeks = new Set<string>();
    for (const row of doc.series) {
      if (row.date > cutoff) continue;
      const week = isoWeekKeyForSchema(row.date);
      if (weeks.has(week)) {
        ctx.addIssue({
          code: 'custom',
          message: `more than one point in ISO week ${week}, but olderResolution is weekly-last`,
        });
        return;
      }
      weeks.add(week);
    }
  });

export type RealReturnsDataset = z.infer<typeof realReturnsDatasetSchema>;

/**
 * Versioned on-disk format of data/holding-periods.json.
 *
 * The cells carry both figures. Only the annual rate is comparable across the
 * matrix — a 300% total is extraordinary over one year and ordinary over ten —
 * but the total is what a reader feels, so the grid colours by one and states
 * the other rather than making them choose a page.
 */
export const holdingDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    currency: currencySchema,
    fetchedAt: z.string(),
    /** Last day of history the matrix was built from. */
    asOf: isoDate,
    /** The shortest hold the run was willing to annualise. */
    minAnnualiseDays: z.number().int().positive(),
    /**
     * The years the matrix spans, ascending. Both axes use this, so a page
     * cannot render a row the cells do not cover.
     *
     * Each carries the two dates it is anchored on and whether it is a whole
     * calendar year. Both ends of the history are partial — it began mid-2010 and
     * the current year is year-to-date — and a cell saying "sold end of 2026" in
     * July is false. The page reads these dates rather than assuming December.
     */
    years: z
      .array(
        z.object({
          year: z.number().int(),
          /** Close a hold starting in this year is bought at. */
          basisDate: isoDate,
          /** Close a hold ending in this year is sold at. */
          closeDate: isoDate,
          /** False when the year is truncated at either end. */
          whole: z.boolean(),
        }),
      )
      .min(2),
    cells: z
      .array(
        z.object({
          buyYear: z.number().int(),
          sellYear: z.number().int(),
          totalPct: z.number(),
          annualPct: z.number().nullable(),
          days: z.number().int().positive(),
        }),
      )
      .min(1),
    summary: z.object({
      count: z.number().int().positive(),
      positive: z.number().int().nonnegative(),
      best: z.object({ buyYear: z.number().int(), sellYear: z.number().int(), annualPct: z.number() }),
      worst: z.object({ buyYear: z.number().int(), sellYear: z.number().int(), annualPct: z.number() }),
      longestLosing: z
        .object({
          buyYear: z.number().int(),
          sellYear: z.number().int(),
          totalPct: z.number(),
          days: z.number().int().positive(),
        })
        .nullable(),
      /** Shortest hold length, in whole years, that never ended down. */
      safeYears: z.number().int().positive().nullable(),
    }),
  })
  .superRefine((doc, ctx) => {
    // The file's claims about itself, checked rather than trusted — each of these
    // is a way the page could state something false while every cell looked fine.
    const years = new Set(doc.years.map((y) => y.year));
    const sorted = doc.years.every((y, i, a) => i === 0 || y.year > (a[i - 1]?.year ?? -Infinity));
    if (!sorted) ctx.addIssue({ code: 'custom', message: 'years are not ascending' });
    const seen = new Set<string>();
    for (const cell of doc.cells) {
      if (cell.sellYear < cell.buyYear) {
        ctx.addIssue({
          code: 'custom',
          message: `cell ${cell.buyYear}->${cell.sellYear} sells before it buys`,
        });
      }
      if (!years.has(cell.buyYear) || !years.has(cell.sellYear)) {
        ctx.addIssue({
          code: 'custom',
          message: `cell ${cell.buyYear}->${cell.sellYear} names a year outside the axis`,
        });
      }
      const key = `${cell.buyYear}-${cell.sellYear}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: `duplicate cell ${key}` });
      }
      seen.add(key);
      // A rate is either absent or measured over a year. A rate on a shorter hold
      // is an extrapolation, and this file exists partly to keep one out.
      if (cell.annualPct !== null && cell.days < doc.minAnnualiseDays) {
        ctx.addIssue({
          code: 'custom',
          message: `cell ${key} is annualised over ${cell.days} days, under ${doc.minAnnualiseDays}`,
        });
      }
      if (cell.annualPct === null && cell.days >= doc.minAnnualiseDays) {
        ctx.addIssue({
          code: 'custom',
          message: `cell ${key} spans ${cell.days} days and has no rate`,
        });
      }
    }
    // The matrix has to be complete: every pair the axis implies must be present,
    // or the page renders a hole a reader would read as "no data" rather than as
    // a missing row.
    // A year is whole only if it runs a full December to December. Deliberately
    // not the writer's expression rewritten — it was character-identical for one
    // commit, which cannot catch a wrong predicate, and the predicate is exactly
    // what was wrong: a December-month test marks the current year whole on any
    // run from the 1st to the 30th.
    for (const y of doc.years) {
      const whole =
        y.basisDate === `${y.year - 1}-12-31` || y.basisDate.slice(0, 7) === `${y.year - 1}-12`
          ? y.closeDate === `${y.year}-12-31`
          : false;
      if (whole !== y.whole) {
        ctx.addIssue({
          code: 'custom',
          message: `${y.year} is marked ${y.whole ? 'whole' : 'partial'} but runs ${y.basisDate} to ${y.closeDate}`,
        });
      }
      if (y.closeDate > doc.asOf) {
        ctx.addIssue({
          code: 'custom',
          message: `${y.year} closes ${y.closeDate}, after the dataset's asOf ${doc.asOf}`,
        });
      }
    }
    // The summary is what the four stat tiles print, and none of it was checked:
    // `positive: 153` on a matrix with ten losses validated cleanly and would have
    // rendered "153/153 holds ended up · 0 ended down". Every field here is one
    // derivation from `cells`, so the file's headline claims are now verified
    // against the file's own contents rather than trusted.
    const cells = doc.cells;
    const rated = cells.filter((c) => c.annualPct !== null);
    const positive = cells.filter((c) => c.totalPct >= 0).length;
    if (doc.summary.count !== cells.length) {
      ctx.addIssue({
        code: 'custom',
        message: `summary.count ${doc.summary.count} but ${cells.length} cells`,
      });
    }
    if (doc.summary.positive !== positive) {
      ctx.addIssue({
        code: 'custom',
        message: `summary.positive ${doc.summary.positive} but ${positive} cells are up`,
      });
    }
    const same = (a: { buyYear: number; sellYear: number }, b: { buyYear: number; sellYear: number }) =>
      a.buyYear === b.buyYear && a.sellYear === b.sellYear;
    const pool = rated.length > 0 ? rated : cells;
    const rate = (c: { annualPct: number | null; totalPct: number }) => c.annualPct ?? c.totalPct;
    const extremes: [string, { buyYear: number; sellYear: number; annualPct: number }, number][] = [
      ['best', doc.summary.best, Math.max(...pool.map(rate))],
      ['worst', doc.summary.worst, Math.min(...pool.map(rate))],
    ];
    for (const [label, claimed, target] of extremes) {
      // Looked up in `cells` rather than trusted: the summary carries only the two
      // years and a rate, so a hold that does not exist, or one whose rate has
      // been edited, is otherwise invisible here.
      const cell = pool.find((c) => same(c, claimed));
      if (!cell) {
        ctx.addIssue({
          code: 'custom',
          message: `summary.${label} names ${claimed.buyYear}→${claimed.sellYear}, which is not a rated hold`,
        });
      } else if (cell.annualPct !== claimed.annualPct) {
        ctx.addIssue({
          code: 'custom',
          message: `summary.${label} says ${claimed.annualPct}% but that hold is ${cell.annualPct}%`,
        });
      } else if (rate(cell) !== target) {
        ctx.addIssue({
          code: 'custom',
          message: `summary.${label} ${claimed.buyYear}→${claimed.sellYear} is not the ${label === 'best' ? 'highest' : 'lowest'}-rated hold`,
        });
      }
    }
    const losing = cells.filter((c) => c.totalPct < 0);
    if (doc.summary.longestLosing === null) {
      if (losing.length > 0) {
        ctx.addIssue({ code: 'custom', message: 'summary.longestLosing is null but holds lost' });
      }
    } else {
      const longest = Math.max(...losing.map((c) => c.days));
      const claimed = doc.summary.longestLosing;
      if (claimed.totalPct >= 0 || claimed.days !== longest) {
        ctx.addIssue({
          code: 'custom',
          message: `summary.longestLosing ${claimed.buyYear}→${claimed.sellYear} is not a longest losing hold`,
        });
      }
    }
    // The shortest span in which no hold lost, recomputed. `safeYears: 1` on a
    // matrix whose one-year holds include a −69% would otherwise validate.
    const span = (c: { buyYear: number; sellYear: number }) => c.sellYear - c.buyYear + 1;
    const spans = [...new Set(cells.map(span))].sort((a, b) => a - b);
    const safe =
      spans.find((n) => cells.filter((c) => span(c) === n).every((c) => c.totalPct >= 0)) ?? null;
    if (doc.summary.safeYears !== safe) {
      ctx.addIssue({
        code: 'custom',
        message: `summary.safeYears ${doc.summary.safeYears} but ${safe} is the shortest span with no loss`,
      });
    }
    // `days` is a subtraction of two dates this file already publishes, so a cell
    // claiming a different span is checkable rather than trusted.
    const anchorFor = new Map(doc.years.map((y) => [y.year, y]));
    for (const cell of cells) {
      const buy = anchorFor.get(cell.buyYear);
      const sell = anchorFor.get(cell.sellYear);
      if (!buy || !sell) continue;
      const days = Math.round(
        (Date.parse(`${sell.closeDate}T00:00:00Z`) - Date.parse(`${buy.basisDate}T00:00:00Z`)) /
          86_400_000,
      );
      if (days !== cell.days) {
        ctx.addIssue({
          code: 'custom',
          message: `${cell.buyYear}→${cell.sellYear} says ${cell.days} days, but its anchors are ${days} apart`,
        });
      }
      if (cell.annualPct === null && cell.days >= doc.minAnnualiseDays) {
        ctx.addIssue({
          code: 'custom',
          message: `${cell.buyYear}→${cell.sellYear} ran ${cell.days} days and carries no rate`,
        });
      }
    }
    const expected = (doc.years.length * (doc.years.length + 1)) / 2;
    if (doc.cells.length !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: `${doc.cells.length} cells for ${doc.years.length} years — expected ${expected}`,
      });
    }
    if (doc.summary.count !== doc.cells.length) {
      ctx.addIssue({ code: 'custom', message: 'summary.count disagrees with the cells' });
    }
    if (doc.summary.positive > doc.summary.count) {
      ctx.addIssue({ code: 'custom', message: 'more positive holds than holds' });
    }
  });

export type HoldingDataset = z.infer<typeof holdingDatasetSchema>;
