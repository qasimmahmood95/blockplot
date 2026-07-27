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
import type {
  BenchmarkDataset,
  CorrelationDataset,
  DominanceDataset,
  HalvingDataset,
  HistoryDataset,
  MonthlyDataset,
  NetworkDataset,
  PriceDataset,
  RiskDataset,
  StablecoinDataset,
} from '../../pipeline/schema';
import type { Currency } from './currency';

/**
 * Currency-free datasets: stablecoin supply and total market cap are
 * USD-pegged by definition, and network metrics are denominated in hashes,
 * transactions and sat/vB.
 */
export const dominance = dominanceDataset as DominanceDataset;
export const stablecoins = stablecoinDataset as StablecoinDataset;
export const network = networkDataset as NetworkDataset;

interface CurrencyData {
  btcDaily: PriceDataset;
  benchmarksDaily: BenchmarkDataset;
  riskMetrics: RiskDataset;
  halvingCycles: HalvingDataset;
  correlations: CorrelationDataset;
  btcHistory: HistoryDataset;
  monthlyReturns: MonthlyDataset;
}

const BY_CURRENCY: Record<Currency, CurrencyData> = {
  usd: {
    btcDaily: usdPrice as PriceDataset,
    benchmarksDaily: usdBenchmarks as BenchmarkDataset,
    riskMetrics: usdRisk as RiskDataset,
    halvingCycles: usdHalvings as HalvingDataset,
    correlations: usdCorrelations as CorrelationDataset,
    btcHistory: usdHistory as HistoryDataset,
    monthlyReturns: usdMonthly as MonthlyDataset,
  },
  gbp: {
    btcDaily: gbpPrice as PriceDataset,
    benchmarksDaily: gbpBenchmarks as BenchmarkDataset,
    riskMetrics: gbpRisk as RiskDataset,
    halvingCycles: gbpHalvings as HalvingDataset,
    correlations: gbpCorrelations as CorrelationDataset,
    btcHistory: gbpHistory as HistoryDataset,
    monthlyReturns: gbpMonthly as MonthlyDataset,
  },
};

/**
 * The currency-dependent datasets for one currency. GBP files are rebuilt
 * from closes converted at each day's rate, so their percentage metrics are
 * genuinely GBP-denominated rather than relabelled USD.
 */
export const dataFor = (currency: Currency): CurrencyData => BY_CURRENCY[currency];
