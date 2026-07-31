import usdBenchmarks from '../../data/benchmarks-daily.json';
import usdBenchmarkHistory from '../../data/benchmarks-history.json';
import usdPrice from '../../data/btc-price-daily.json';
import usdHistory from '../../data/btc-price-history.json';
import usdCorrelations from '../../data/correlations.json';
import usdHalvings from '../../data/halving-cycles.json';
import usdHolding from '../../data/holding-periods.json';
import usdMonthly from '../../data/monthly-returns.json';
import usdRisk from '../../data/risk-metrics.json';
import usdSignals from '../../data/signals.json';
import gbpBenchmarks from '../../data/gbp/benchmarks-daily.json';
import gbpBenchmarkHistory from '../../data/gbp/benchmarks-history.json';
import gbpPrice from '../../data/gbp/btc-price-daily.json';
import gbpHistory from '../../data/gbp/btc-price-history.json';
import gbpCorrelations from '../../data/gbp/correlations.json';
import gbpHalvings from '../../data/gbp/halving-cycles.json';
import gbpHolding from '../../data/gbp/holding-periods.json';
import gbpMonthly from '../../data/gbp/monthly-returns.json';
import gbpRisk from '../../data/gbp/risk-metrics.json';
import gbpSignals from '../../data/gbp/signals.json';
import dominanceDataset from '../../data/dominance.json';
import networkDataset from '../../data/network.json';
import stablecoinDataset from '../../data/stablecoins.json';
import {
  benchmarkDatasetSchema,
  benchmarkHistoryDatasetSchema,
  correlationDatasetSchema,
  dominanceDatasetSchema,
  halvingDatasetSchema,
  historyDatasetSchema,
  holdingDatasetSchema,
  monthlyDatasetSchema,
  networkDatasetSchema,
  priceDatasetSchema,
  realReturnsDatasetSchema,
  riskDatasetSchema,
  signalsDatasetSchema,
  stablecoinDatasetSchema,
} from '../../pipeline/schema';
import type {
  BenchmarkDataset,
  BenchmarkHistoryDataset,
  CorrelationDataset,
  HalvingDataset,
  HistoryDataset,
  HoldingDataset,
  MonthlyDataset,
  PriceDataset,
  RealReturnsDataset,
  RiskDataset,
  SignalsDataset,
} from '../../pipeline/schema';
import { CURRENCIES, type Currency } from './currency';

/**
 * Every dataset is PARSED, not cast. A cast would let a `/data` tree that has
 * drifted from the code — a rename landing before the pipeline has
 * regenerated, a hand edit, a bad merge — build clean and publish `$NaN`,
 * because a missing field is `undefined` all the way to `Intl.format`. Parsing
 * turns that into a build failure, which is what CLAUDE.md means by the site
 * building from zod-validated JSON. It costs ~60 ms per build and nothing at
 * runtime: this runs in Astro's server phase, and no island imports it, so
 * zod never reaches a client bundle.
 *
 * Parsing must stay EAGER, at module scope. `astro check` cannot see through
 * these parses (the raw imports widen to `unknown`), so this eager pass is the
 * only thing standing between a drifted `/data` and a published `$NaN`. Moving
 * it behind a lazy getter would reopen that hole for any page that happens not
 * to read the broken file.
 */

/** Parse one file, naming it so the zod path below is unambiguous. */
const parseOne = <T>(file: string, schema: { parse(raw: unknown): T }, raw: unknown): T => {
  try {
    return schema.parse(raw);
  } catch (err) {
    throw new Error(
      `data/${file}: failed validation — run the pipeline to regenerate it.`,
      { cause: err },
    );
  }
};

/**
 * Currency-free datasets: stablecoin supply and total market cap are
 * USD-pegged by definition, and network metrics are denominated in hashes,
 * transactions and sat/vB.
 */
export const dominance = parseOne('dominance.json', dominanceDatasetSchema, dominanceDataset);
export const stablecoins = parseOne('stablecoins.json', stablecoinDatasetSchema, stablecoinDataset);
export const network = parseOne('network.json', networkDatasetSchema, networkDataset);

interface CurrencyData {
  btcDaily: PriceDataset;
  benchmarksDaily: BenchmarkDataset;
  benchmarksHistory: BenchmarkHistoryDataset;
  riskMetrics: RiskDataset;
  halvingCycles: HalvingDataset;
  holdingPeriods: HoldingDataset;
  correlations: CorrelationDataset;
  btcHistory: HistoryDataset;
  monthlyReturns: MonthlyDataset;
  signals: SignalsDataset;
}

/** One currency's tree, each file named so a zod path is unambiguous. */
const currencyData = (dir: string, raw: Record<keyof CurrencyData, unknown>): CurrencyData => ({
  btcDaily: parseOne(`${dir}btc-price-daily.json`, priceDatasetSchema, raw.btcDaily),
  benchmarksDaily: parseOne(`${dir}benchmarks-daily.json`, benchmarkDatasetSchema, raw.benchmarksDaily),
  benchmarksHistory: parseOne(
    `${dir}benchmarks-history.json`,
    benchmarkHistoryDatasetSchema,
    raw.benchmarksHistory,
  ),
  riskMetrics: parseOne(`${dir}risk-metrics.json`, riskDatasetSchema, raw.riskMetrics),
  halvingCycles: parseOne(`${dir}halving-cycles.json`, halvingDatasetSchema, raw.halvingCycles),
  holdingPeriods: parseOne(`${dir}holding-periods.json`, holdingDatasetSchema, raw.holdingPeriods),
  correlations: parseOne(`${dir}correlations.json`, correlationDatasetSchema, raw.correlations),
  btcHistory: parseOne(`${dir}btc-price-history.json`, historyDatasetSchema, raw.btcHistory),
  monthlyReturns: parseOne(`${dir}monthly-returns.json`, monthlyDatasetSchema, raw.monthlyReturns),
  signals: parseOne(`${dir}signals.json`, signalsDatasetSchema, raw.signals),
});

const BY_CURRENCY: Record<Currency, CurrencyData> = {
  usd: currencyData('', {
    btcDaily: usdPrice,
    benchmarksDaily: usdBenchmarks,
    benchmarksHistory: usdBenchmarkHistory,
    riskMetrics: usdRisk,
    halvingCycles: usdHalvings,
    holdingPeriods: usdHolding,
    correlations: usdCorrelations,
    btcHistory: usdHistory,
    monthlyReturns: usdMonthly,
    signals: usdSignals,
  }),
  gbp: currencyData('gbp/', {
    btcDaily: gbpPrice,
    benchmarksDaily: gbpBenchmarks,
    benchmarksHistory: gbpBenchmarkHistory,
    riskMetrics: gbpRisk,
    halvingCycles: gbpHalvings,
    holdingPeriods: gbpHolding,
    correlations: gbpCorrelations,
    btcHistory: gbpHistory,
    monthlyReturns: gbpMonthly,
    signals: gbpSignals,
  }),
};

/**
 * The currency-dependent datasets for one currency. GBP files are rebuilt
 * from closes converted at each day's rate, so their percentage metrics are
 * genuinely GBP-denominated rather than relabelled USD.
 */
export const dataFor = (currency: Currency): CurrencyData => BY_CURRENCY[currency];

/**
 * Real returns, which is the one dataset that may legitimately not exist.
 *
 * A glob rather than a static import, and the difference matters. Every file
 * above is imported by name, so a missing one is a build error — which is right
 * for them: they are the site. This one depends on a deflator that can be retired
 * out from under it by a statistical agency, and the whole point of the pipeline's
 * freshness gate is that it would rather write nothing than write stale money. A
 * static import would turn that careful refusal into a broken build, so a UK CPI
 * retirement would take down the USD tree, the network page and everything else.
 * A glob makes absence representable, and the page states it.
 *
 * `eager: true` keeps the parse at module scope, for the reason the comment at the
 * top of this file gives: `astro check` cannot see through these parses, so the
 * eager pass is the only thing standing between a drifted `/data` and a published
 * `$NaN`.
 */
const realReturnsFiles = import.meta.glob<{ default: unknown }>(
  '../../data/**/real-returns.json',
  { eager: true },
);

const REAL_BY_CURRENCY: Partial<Record<Currency, RealReturnsDataset>> = Object.fromEntries(
  Object.entries(realReturnsFiles).flatMap(([path, module]) => {
    // '../../data/real-returns.json' is USD; '../../data/gbp/real-returns.json'
    // is the gbp tree. Anything else is a file this function does not know how to
    // place, and guessing would attach one currency's figures to another.
    const match = /data\/(?:([a-z]{3})\/)?real-returns\.json$/.exec(path);
    const currency = (match?.[1] ?? 'usd') as Currency;
    if (!CURRENCIES.includes(currency)) return [];
    const file = currency === 'usd' ? 'real-returns.json' : `${currency}/real-returns.json`;
    return [[currency, parseOne(file, realReturnsDatasetSchema, module.default)]];
  }),
);

/** One currency's real-return dataset, or null when its deflator did not answer. */
export const realReturnsFor = (currency: Currency): RealReturnsDataset | null =>
  REAL_BY_CURRENCY[currency] ?? null;
