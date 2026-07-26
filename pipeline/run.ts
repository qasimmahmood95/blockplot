import { fetchBtcMarketChart, PRICE_RANGE_DAYS } from './coingecko';
import { writeJson } from './io';
import { computeStats, toDailySeries } from './prices';
import type { PriceDataset } from './schema';

const OUT = 'data/btc-price-daily.json';

const raw = await fetchBtcMarketChart();
const series = toDailySeries(raw.prices);
const dataset: PriceDataset = {
  schemaVersion: 1,
  source: 'coingecko',
  fetchedAt: new Date().toISOString(),
  rangeDays: PRICE_RANGE_DAYS,
  stats: computeStats(series),
  series,
};

await writeJson(OUT, dataset);
console.log(
  `${OUT}: ${series.length} days, latest ${dataset.stats.latestDate} at $${dataset.stats.latestPriceUsd}`,
);
