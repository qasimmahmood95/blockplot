import {
  BENCHMARK_KEEP_DAYS,
  fetchGold,
  fetchSp500,
  GOLD_STOOQ_SERIES,
  SP500_FRED_SERIES,
} from './benchmarks';
import { fetchBtcMarketChart, PRICE_RANGE_DAYS } from './coingecko';
import { writeJson } from './io';
import { computeStats, toDailySeries } from './prices';
import { buildRiskDataset } from './risk';
import {
  benchmarkDatasetSchema,
  riskDatasetSchema,
  type BenchmarkDataset,
  type PriceDataset,
} from './schema';

const fetchedAt = new Date().toISOString();
const [raw, sp500, gold] = await Promise.all([fetchBtcMarketChart(), fetchSp500(), fetchGold()]);

const series = toDailySeries(raw.prices);
const prices: PriceDataset = {
  schemaVersion: 1,
  source: 'coingecko',
  fetchedAt,
  rangeDays: PRICE_RANGE_DAYS,
  stats: computeStats(series),
  series,
};
await writeJson('data/btc-price-daily.json', prices);
console.log(
  `data/btc-price-daily.json: ${series.length} days, latest ${prices.stats.latestDate} at $${prices.stats.latestPriceUsd}`,
);

const benchmarks: BenchmarkDataset = benchmarkDatasetSchema.parse({
  schemaVersion: 1,
  fetchedAt,
  keepDays: BENCHMARK_KEEP_DAYS,
  benchmarks: [
    { asset: 'sp500', source: 'fred', sourceSeries: SP500_FRED_SERIES, series: sp500 },
    { asset: 'gold', source: 'stooq', sourceSeries: GOLD_STOOQ_SERIES, series: gold },
  ],
});
await writeJson('data/benchmarks-daily.json', benchmarks);
console.log(`data/benchmarks-daily.json: sp500 ${sp500.length} days, gold ${gold.length} days`);

const risk = riskDatasetSchema.parse(buildRiskDataset(series, { sp500, gold }, { fetchedAt }));
await writeJson('data/risk-metrics.json', risk);
console.log(
  `data/risk-metrics.json: as of ${risk.asOf}, max drawdown ${risk.drawdown.maxDrawdownPct}% (${risk.drawdown.peakDate} -> ${risk.drawdown.troughDate})`,
);
