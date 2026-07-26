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
import { buildMonthlyDataset } from './monthly';
import {
  fetchFeeTiers,
  fetchHashRate,
  fetchTxCount,
  NETWORK_KEEP_DAYS,
  readExistingFees,
  smoothedChangePct,
  trailingAverage,
} from './network';
import { computeStats, toDailySeries } from './prices';
import { buildRiskDataset } from './risk';
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

const [
  raw,
  sp500,
  goldFetch,
  dxyFetch,
  history,
  dominanceSnapshot,
  stablecoins,
  hashRate,
  txCount,
  feeTiers,
] = await Promise.all([
  attempt('coingecko market chart', fetchBtcMarketChart()),
  attempt('fred sp500', fetchSp500()),
  attempt('yahoo gold', fetchGold()),
  attempt('yahoo dxy', fetchDxy()),
  attempt('blockchain.com history', fetchBtcHistory()),
  attempt('coingecko global', fetchDominanceSnapshot(now)),
  attempt('defillama stablecoins', fetchStablecoins()),
  attempt('blockchain.com hash-rate', fetchHashRate()),
  attempt('blockchain.com n-transactions', fetchTxCount()),
  attempt('mempool.space fees', fetchFeeTiers()),
]);

const series = raw ? toDailySeries(raw.prices) : null;

// State-bearing and independent datasets write FIRST: a bug or parse
// throw in a later derived block must never cost the accreted dominance
// series its day.
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

  const monthly = monthlyDatasetSchema.parse(buildMonthlyDataset(history, { fetchedAt }));
  await writeJson('data/monthly-returns.json', monthly);
  console.log(
    `data/monthly-returns.json: ${monthly.months.length} months over ${monthly.years.length} years`,
  );
}

// The clip only bounds the vol curves; if the history source lags the spot
// series the curves silently end early, so surface that in the run log.
if (series && history) {
  const historyEnd = history.at(-1)?.date ?? '';
  const spotEnd = series.at(-1)?.date ?? '';
  if (historyEnd < spotEnd) {
    console.warn(`warning: history ends ${historyEnd}, before spot ${spotEnd} — vol curves stop there`);
  }
}

// history is technically optional for buildRiskDataset, but a run without it
// would commit degraded vol curves over yesterday's full-quality file — so
// risk (and correlations, which must share its asOf) skip instead.
if (series && sp500 && goldFetch && history) {
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

// Network writes LAST: it is the newest block, so a bug here must not cost
// any earlier dataset its refresh (the same reasoning that puts the accreted
// dominance series first).
if (hashRate && txCount) {
  // Fees tolerate staleness by design — the page's island refreshes them —
  // so a mempool.space outage falls back to the committed tiers rather than
  // freezing the hash-rate and transaction series for six hours.
  const tiers = feeTiers ?? (await readExistingFees('data/network.json'));
  if (!tiers) {
    console.warn('warning: no fee tiers available and no committed fallback — skipping network.json');
  } else {
    const network = networkDatasetSchema.parse({
      schemaVersion: 1,
      fetchedAt,
      // The two series can end on different days; label the dataset with the
      // earlier one so no figure claims to be fresher than it is.
      asOf: [hashRate.at(-1)?.date, txCount.at(-1)?.date].filter(Boolean).sort()[0],
      keepDays: NETWORK_KEEP_DAYS,
      hashRate: {
        unit: 'EH/s',
        average7d: trailingAverage(hashRate, 7, 1),
        change30dPct: smoothedChangePct(hashRate, 30, 7),
        series: hashRate,
      },
      txCount: {
        unit: 'tx/day',
        average30d: trailingAverage(txCount, 30),
        change30dPct: smoothedChangePct(txCount, 30, 7),
        series: txCount,
      },
      fees: { source: 'mempool.space', tiers },
    });
    await writeJson('data/network.json', network);
    console.log(
      `data/network.json: hash rate ${network.hashRate.average7d} EH/s (7d mean), ${txCount.at(-1)?.value} tx on ${network.asOf}, fastest fee ${tiers.fastestFee} sat/vB${feeTiers ? '' : ' (committed fallback)'}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} source(s) failed; dependent datasets were skipped:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}
