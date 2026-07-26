import { BENCHMARK_KEEP_DAYS, fetchDxy, fetchGold, fetchSp500, SP500_FRED_SERIES } from './benchmarks';
import { fetchBtcMarketChart, PRICE_RANGE_DAYS } from './coingecko';
import { buildCorrelationDataset } from './correlation';
import { buildHalvingDataset } from './halvings';
import { fetchBtcHistory } from './history';
import { writeJson } from './io';
import { computeStats, toDailySeries } from './prices';
import { buildRiskDataset } from './risk';
import {
  benchmarkDatasetSchema,
  correlationDatasetSchema,
  halvingDatasetSchema,
  historyDatasetSchema,
  riskDatasetSchema,
  type BenchmarkDataset,
  type PriceDataset,
} from './schema';

const fetchedAt = new Date().toISOString();
const [raw, sp500, goldFetch, dxyFetch, history] = await Promise.all([
  fetchBtcMarketChart(),
  fetchSp500(),
  fetchGold(),
  fetchDxy(),
  fetchBtcHistory(),
]);
const gold = goldFetch.series;
const dxy = dxyFetch.series;

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
    { asset: 'gold', source: 'yahoo', sourceSeries: goldFetch.ticker, series: gold },
    { asset: 'dxy', source: 'yahoo', sourceSeries: dxyFetch.ticker, series: dxy },
  ],
});
await writeJson('data/benchmarks-daily.json', benchmarks);
console.log(
  `data/benchmarks-daily.json: sp500 ${sp500.length} days, gold ${gold.length} days (${goldFetch.ticker}), dxy ${dxy.length} days (${dxyFetch.ticker})`,
);

const historyDataset = historyDatasetSchema.parse({
  schemaVersion: 1,
  source: 'blockchain.info',
  fetchedAt,
  series: history,
});
await writeJson('data/btc-price-history.json', historyDataset);
console.log(
  `data/btc-price-history.json: ${history.length} days from ${history[0]?.date} to ${history.at(-1)?.date}`,
);

const halvings = halvingDatasetSchema.parse(buildHalvingDataset(history, { fetchedAt }));
await writeJson('data/halving-cycles.json', halvings);
console.log(
  `data/halving-cycles.json: ${halvings.cycles.map((c) => `c${c.cycle}=${c.series.length}`).join(' ')}`,
);

// The clip only bounds the vol curves; if the history source lags the spot
// series the curves silently end early, so surface that in the run log.
const historyEnd = history.at(-1)?.date ?? '';
const spotEnd = series.at(-1)?.date ?? '';
if (historyEnd < spotEnd) {
  console.warn(`warning: history ends ${historyEnd}, before spot ${spotEnd} — vol curves stop there`);
}

const risk = riskDatasetSchema.parse(
  buildRiskDataset(series, { sp500, gold }, { fetchedAt, history }),
);
await writeJson('data/risk-metrics.json', risk);
console.log(
  `data/risk-metrics.json: as of ${risk.asOf}, max drawdown ${risk.drawdown.maxDrawdownPct}% (${risk.drawdown.peakDate} -> ${risk.drawdown.troughDate})`,
);

// BTC's leg uses the deep-history series and benchmarks keep a 460d trailing
// window, so every pair has a full 90d of pre-window returns at displayFrom.
const toPoints = (rows: { date: string; close: number }[]) =>
  rows.map(({ date, close }) => ({ date, value: close }));
const correlations = correlationDatasetSchema.parse(
  buildCorrelationDataset(
    {
      btc: history.map(({ date, priceUsd }) => ({ date, value: priceUsd })),
      sp500: toPoints(sp500),
      gold: toPoints(gold),
      dxy: toPoints(dxy),
    },
    { fetchedAt, asOf: risk.asOf, displayFrom: series[0]?.date ?? risk.asOf },
  ),
);
await writeJson('data/correlations.json', correlations);
console.log(
  `data/correlations.json: ${correlations.pairs.map((p) => `${p.pair}=${p.series.length}`).join(' ')}`,
);
