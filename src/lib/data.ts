import priceDataset from '../../data/btc-price-daily.json';
import riskDataset from '../../data/risk-metrics.json';
import type { PriceDataset, RiskDataset } from '../../pipeline/schema';

/** Pipeline-committed datasets the whole site builds from. */
export const btcDaily = priceDataset as PriceDataset;
export const riskMetrics = riskDataset as RiskDataset;
