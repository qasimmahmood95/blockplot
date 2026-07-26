import { BENCHMARK_KEEP_DAYS, fetchDxy, fetchGold, fetchSp500, SP500_FRED_SERIES } from './benchmarks';
import { fetchBtcMarketChart, PRICE_RANGE_DAYS } from './coingecko';
import { buildCorrelationDataset } from './correlation';
import {
  accreteDominance,
  fetchDominanceSnapshot,
  fetchStablecoins,
  readExistingDominance,
  STABLECOIN_KEEP_DAYS,
  stablecoinChange30dPct,
} from './flows';
import { buildHalvingDataset } from './halvings';
import { fetchBtcHistory } from './history';
import { writeJson } from './io';
import { computeStats, toDailySeries } from './prices';
import { buildRiskDataset } from './risk';
import {
  benchmarkDatasetSchema,
  correlationDatasetSchema,
  dominanceDatasetSchema,
  halvingDatasetSchema,
  historyDatasetSchema,
  priceDatasetSchema,
  riskDatasetSchema,
  stablecoinDatasetSchema,
} from './schema';

/**
 * Each source failure skips only the datasets that need it — the rest still
 * refresh (this matters most for the accreted dominance series, whose day
 * is lost if no run of the day writes it). Any failure still exits nonzero
 * so the workflow run shows red; the workflow commits partial output first.
 */
const now = new Date();
const fetchedAt = now.toISOString();

const failures: string[] = [];
async function attempt<T>(label: string, task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const [raw, sp500, goldFetch, dxyFetch, history, dominanceSnapshot, stablecoins] =
  await Promise.all([
    attempt('coingecko market chart', fetchBtcMarketChart()),
    attempt('fred sp500', fetchSp500()),
    attempt('yahoo gold', fetchGold()),
    attempt('yahoo dxy', fetchDxy()),
    attempt('blockchain.com history', fetchBtcHistory()),
    attempt('coingecko global', fetchDominanceSnapshot(now)),
    attempt('defillama stablecoins', fetchStablecoins()),
  ]);

const series = raw ? toDailySeries(raw.prices) : null;

if (series) {
  const prices = priceDatasetSchema.parse({
    schemaVersion: 1,
    source: 'coingecko',
    fetchedAt,
    rangeDays: PRICE_RANGE_DAYS,
    stats: computeStats(series),
    series,
  });
  await writeJson('data/btc-price-daily.json', prices);
  console.log(
    `data/btc-price-daily.json: ${series.length} days, latest ${prices.stats.latestDate} at $${prices.stats.latestPriceUsd}`,
  );
}

if (sp500 && goldFetch && dxyFetch) {
  const benchmarks = benchmarkDatasetSchema.parse({
    schemaVersion: 1,
    fetchedAt,
    keepDays: BENCHMARK_KEEP_DAYS,
    benchmarks: [
      { asset: 'sp500', source: 'fred', sourceSeries: SP500_FRED_SERIES, series: sp500 },
      { asset: 'gold', source: 'yahoo', sourceSeries: goldFetch.ticker, series: goldFetch.series },
      { asset: 'dxy', source: 'yahoo', sourceSeries: dxyFetch.ticker, series: dxyFetch.series },
    ],
  });
  await writeJson('data/benchmarks-daily.json', benchmarks);
  console.log(
    `data/benchmarks-daily.json: sp500 ${sp500.length} days, gold ${goldFetch.series.length} days (${goldFetch.ticker}), dxy ${dxyFetch.series.length} days (${dxyFetch.ticker})`,
  );
}

if (history) {
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
}

if (series && sp500 && goldFetch && history) {
  // The clip only bounds the vol curves; if the history source lags the spot
  // series the curves silently end early, so surface that in the run log.
  const historyEnd = history.at(-1)?.date ?? '';
  const spotEnd = series.at(-1)?.date ?? '';
  if (historyEnd < spotEnd) {
    console.warn(`warning: history ends ${historyEnd}, before spot ${spotEnd} — vol curves stop there`);
  }
  const risk = riskDatasetSchema.parse(
    buildRiskDataset(series, { sp500, gold: goldFetch.series }, { fetchedAt, history }),
  );
  await writeJson('data/risk-metrics.json', risk);
  console.log(
    `data/risk-metrics.json: as of ${risk.asOf}, max drawdown ${risk.drawdown.maxDrawdownPct}% (${risk.drawdown.peakDate} -> ${risk.drawdown.troughDate})`,
  );

  if (dxyFetch) {
    // BTC's leg uses the deep-history series and benchmarks keep a 460d
    // trailing window, so every pair has a full 90d of pre-window returns.
    const toPoints = (rows: { date: string; close: number }[]) =>
      rows.map(({ date, close }) => ({ date, value: close }));
    const correlations = correlationDatasetSchema.parse(
      buildCorrelationDataset(
        {
          btc: history.map(({ date, priceUsd }) => ({ date, value: priceUsd })),
          sp500: toPoints(sp500),
          gold: toPoints(goldFetch.series),
          dxy: toPoints(dxyFetch.series),
        },
        { fetchedAt, asOf: risk.asOf, displayFrom: series[0]?.date ?? risk.asOf },
      ),
    );
    await writeJson('data/correlations.json', correlations);
    console.log(
      `data/correlations.json: ${correlations.pairs.map((p) => `${p.pair}=${p.series.length}`).join(' ')}`,
    );
  }
}

if (dominanceSnapshot) {
  const dominance = dominanceDatasetSchema.parse({
    schemaVersion: 1,
    source: 'coingecko',
    fetchedAt,
    series: accreteDominance(await readExistingDominance('data/dominance.json'), dominanceSnapshot),
  });
  await writeJson('data/dominance.json', dominance);
  console.log(
    `data/dominance.json: ${dominance.series.length} accreted days, latest ${dominanceSnapshot.btcDominancePct}%`,
  );
}

if (stablecoins) {
  const stablecoinDataset = stablecoinDatasetSchema.parse({
    schemaVersion: 1,
    source: 'defillama',
    fetchedAt,
    keepDays: STABLECOIN_KEEP_DAYS,
    change30dPct: stablecoinChange30dPct(stablecoins),
    series: stablecoins,
  });
  await writeJson('data/stablecoins.json', stablecoinDataset);
  console.log(
    `data/stablecoins.json: ${stablecoins.length} days, latest $${stablecoins.at(-1)?.totalUsd}`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} source(s) failed; dependent datasets were skipped:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}
