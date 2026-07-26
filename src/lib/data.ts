import benchmarkDataset from '../../data/benchmarks-daily.json';
import priceDataset from '../../data/btc-price-daily.json';
import riskDataset from '../../data/risk-metrics.json';
import type { BenchmarkDataset, PriceDataset, RiskDataset } from '../../pipeline/schema';

/** Pipeline-committed datasets the whole site builds from. */
export const btcDaily = priceDataset as PriceDataset;
export const benchmarksDaily = benchmarkDataset as BenchmarkDataset;
export const riskMetrics = riskDataset as RiskDataset;
