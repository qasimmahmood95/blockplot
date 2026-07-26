import benchmarkDataset from '../../data/benchmarks-daily.json';
import priceDataset from '../../data/btc-price-daily.json';
import historyDataset from '../../data/btc-price-history.json';
import correlationDataset from '../../data/correlations.json';
import dominanceDataset from '../../data/dominance.json';
import halvingDataset from '../../data/halving-cycles.json';
import riskDataset from '../../data/risk-metrics.json';
import stablecoinDataset from '../../data/stablecoins.json';
import type {
  BenchmarkDataset,
  CorrelationDataset,
  DominanceDataset,
  HalvingDataset,
  HistoryDataset,
  PriceDataset,
  RiskDataset,
  StablecoinDataset,
} from '../../pipeline/schema';

/** Pipeline-committed datasets the whole site builds from. */
export const btcDaily = priceDataset as PriceDataset;
export const benchmarksDaily = benchmarkDataset as BenchmarkDataset;
export const riskMetrics = riskDataset as RiskDataset;
export const halvingCycles = halvingDataset as HalvingDataset;
export const correlations = correlationDataset as CorrelationDataset;
export const btcHistory = historyDataset as HistoryDataset;
export const dominance = dominanceDataset as DominanceDataset;
export const stablecoins = stablecoinDataset as StablecoinDataset;
