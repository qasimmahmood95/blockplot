import usdBenchmarks from '../../data/benchmarks-daily.json';
import usdPrice from '../../data/btc-price-daily.json';
import usdHistory from '../../data/btc-price-history.json';
import usdCorrelations from '../../data/correlations.json';
import usdHalvings from '../../data/halving-cycles.json';
import usdMonthly from '../../data/monthly-returns.json';
import usdRisk from '../../data/risk-metrics.json';
import gbpBenchmarks from '../../data/gbp/benchmarks-daily.json';
import gbpPrice from '../../data/gbp/btc-price-daily.json';
import gbpHistory from '../../data/gbp/btc-price-history.json';
import gbpCorrelations from '../../data/gbp/correlations.json';
import gbpHalvings from '../../data/gbp/halving-cycles.json';
import gbpMonthly from '../../data/gbp/monthly-returns.json';
import gbpRisk from '../../data/gbp/risk-metrics.json';
import dominanceDataset from '../../data/dominance.json';
import networkDataset from '../../data/network.json';
import stablecoinDataset from '../../data/stablecoins.json';
import {
  benchmarkDatasetSchema,
  correlationDatasetSchema,
  dominanceDatasetSchema,
  halvingDatasetSchema,
  historyDatasetSchema,
  monthlyDatasetSchema,
  networkDatasetSchema,
  priceDatasetSchema,
  riskDatasetSchema,
  stablecoinDatasetSchema,
} from '../../pipeline/schema';
import type {
  BenchmarkDataset,
  CorrelationDataset,
  HalvingDataset,
  HistoryDataset,
  MonthlyDataset,
  PriceDataset,
  RiskDataset,
} from '../../pipeline/schema';
import type { Currency } from './currency';

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
  riskMetrics: RiskDataset;
  halvingCycles: HalvingDataset;
  correlations: CorrelationDataset;
  btcHistory: HistoryDataset;
  monthlyReturns: MonthlyDataset;
}

/** One currency's tree, each file named so a zod path is unambiguous. */
const currencyData = (dir: string, raw: Record<keyof CurrencyData, unknown>): CurrencyData => ({
  btcDaily: parseOne(`${dir}btc-price-daily.json`, priceDatasetSchema, raw.btcDaily),
  benchmarksDaily: parseOne(`${dir}benchmarks-daily.json`, benchmarkDatasetSchema, raw.benchmarksDaily),
  riskMetrics: parseOne(`${dir}risk-metrics.json`, riskDatasetSchema, raw.riskMetrics),
  halvingCycles: parseOne(`${dir}halving-cycles.json`, halvingDatasetSchema, raw.halvingCycles),
  correlations: parseOne(`${dir}correlations.json`, correlationDatasetSchema, raw.correlations),
  btcHistory: parseOne(`${dir}btc-price-history.json`, historyDatasetSchema, raw.btcHistory),
  monthlyReturns: parseOne(`${dir}monthly-returns.json`, monthlyDatasetSchema, raw.monthlyReturns),
});

const BY_CURRENCY: Record<Currency, CurrencyData> = {
  usd: currencyData('', {
    btcDaily: usdPrice,
    benchmarksDaily: usdBenchmarks,
    riskMetrics: usdRisk,
    halvingCycles: usdHalvings,
    correlations: usdCorrelations,
    btcHistory: usdHistory,
    monthlyReturns: usdMonthly,
  }),
  gbp: currencyData('gbp/', {
    btcDaily: gbpPrice,
    benchmarksDaily: gbpBenchmarks,
    riskMetrics: gbpRisk,
    halvingCycles: gbpHalvings,
    correlations: gbpCorrelations,
    btcHistory: gbpHistory,
    monthlyReturns: gbpMonthly,
  }),
};

/**
 * The currency-dependent datasets for one currency. GBP files are rebuilt
 * from closes converted at each day's rate, so their percentage metrics are
 * genuinely GBP-denominated rather than relabelled USD.
 */
export const dataFor = (currency: Currency): CurrencyData => BY_CURRENCY[currency];
