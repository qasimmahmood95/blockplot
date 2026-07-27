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
import {
  convertBenchmark,
  convertSeries,
  fetchGbpUsd,
  FX_HISTORY_FROM,
  fxLagDays,
  MAX_FX_LAG_DAYS,
} from './fx';
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
  CURRENCIES,
  dominanceDatasetSchema,
  fxDatasetSchema,
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
  fxFetch,
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
  attempt('yahoo gbpusd', fetchGbpUsd()),
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

// Currency-dependent datasets are built once per currency. GBP is not a
// relabelling: each close is converted at that day's rate and every metric
// recomputed, because a GBP investor's drawdown and volatility genuinely
// differ from the USD ones. GBP files live under data/gbp/.
if (fxFetch) {
  const fx = fxDatasetSchema.parse({
    schemaVersion: 1,
    pair: 'GBPUSD',
    sources: fxFetch.sources,
    fetchedAt,
    series: fxFetch.series,
  });
  await writeJson('data/fx-gbpusd.json', fx);
  console.log(
    `data/fx-gbpusd.json: ${fx.series.length} quoted days to ${fx.series.at(-1)?.date} from ${fx.sources.join('+')}`,
  );
}

// Carry-forward is meant to bridge weekends, not to price a week of BTC
// closes at a stale rate — so surface a lagging FX feed rather than let it
// pass as fresh GBP figures.
const btcThrough = series?.at(-1)?.date ?? history?.at(-1)?.date;
if (fxFetch && btcThrough) {
  const lag = fxLagDays(fxFetch.series, btcThrough);
  if (lag > MAX_FX_LAG_DAYS) {
    console.warn(
      `warning: GBP/USD rates lag the BTC series by ${lag} days (last quote ${fxFetch.series.at(-1)?.date}) — recent GBP figures carry a stale rate`,
    );
  }
}

for (const currency of CURRENCIES) {
  if (currency === 'gbp' && !fxFetch) {
    console.warn('warning: no GBP/USD rates — skipping the GBP datasets');
    continue;
  }
  const rates = fxFetch?.series ?? [];
  const dir = currency === 'usd' ? 'data' : `data/${currency}`;
  const spot = series ? convertSeries(series, rates, currency) : null;
  const deep = history ? convertSeries(history, rates, currency) : null;
  // convertSeries drops days with no rate, so a rate floor later than the BTC
  // start would quietly give GBP a shorter history than USD — the heatmap and
  // cycle overlay would begin later with nothing anywhere saying why.
  if (deep && history && deep.length !== history.length) {
    throw new Error(
      `convertSeries dropped ${history.length - deep.length} ${currency} days: ` +
        `the FX floor ${FX_HISTORY_FROM} is later than the BTC start ${history[0]?.date}`,
    );
  }
  const sp = sp500 ? convertBenchmark(sp500, rates, currency) : null;
  const au = goldFetch ? convertBenchmark(goldFetch.series, rates, currency) : null;
  // DXY is a dollar index by construction, so it is never converted; the
  // correlation page notes that its pairs stay dollar-denominated.
  const dxy = dxyFetch?.series ?? null;

  if (spot) {
    const prices = priceDatasetSchema.parse({
      schemaVersion: 1,
      source: 'coingecko',
      currency,
      fetchedAt,
      rangeDays: PRICE_RANGE_DAYS,
      stats: computeStats(spot),
      series: spot,
    });
    await writeJson(`${dir}/btc-price-daily.json`, prices);
    console.log(
      `${dir}/btc-price-daily.json: ${spot.length} days, latest ${prices.stats.latestDate} at ${prices.stats.latestPrice}`,
    );
  }

  if (sp && au && dxy && goldFetch && dxyFetch) {
    const benchmarks = benchmarkDatasetSchema.parse({
      schemaVersion: 1,
      currency,
      fetchedAt,
      keepDays: BENCHMARK_KEEP_DAYS,
      benchmarks: [
        { asset: 'sp500', source: 'fred', sourceSeries: SP500_FRED_SERIES, series: sp },
        { asset: 'gold', source: 'yahoo', sourceSeries: goldFetch.ticker, series: au },
        { asset: 'dxy', source: 'yahoo', sourceSeries: dxyFetch.ticker, series: dxy },
      ],
    });
    await writeJson(`${dir}/benchmarks-daily.json`, benchmarks);
    console.log(`${dir}/benchmarks-daily.json: sp500 ${sp.length}, gold ${au.length}, dxy ${dxy.length} days`);
  }

  if (deep) {
    const historyDataset = historyDatasetSchema.parse({
      schemaVersion: 1,
      source: 'blockchain.info',
      currency,
      fetchedAt,
      series: deep,
    });
    await writeJson(`${dir}/btc-price-history.json`, historyDataset);
    console.log(`${dir}/btc-price-history.json: ${deep.length} days from ${deep[0]?.date}`);

    const halvings = halvingDatasetSchema.parse({
      ...buildHalvingDataset(deep, { fetchedAt }),
      currency,
    });
    await writeJson(`${dir}/halving-cycles.json`, halvings);
    console.log(
      `${dir}/halving-cycles.json: ${halvings.cycles.map((c) => `c${c.cycle}=${c.series.length}`).join(' ')}`,
    );

    const monthly = monthlyDatasetSchema.parse({
      ...buildMonthlyDataset(deep, { fetchedAt }),
      currency,
    });
    await writeJson(`${dir}/monthly-returns.json`, monthly);
    console.log(`${dir}/monthly-returns.json: ${monthly.months.length} months`);
  }

  if (spot && deep && sp && au) {
    const historyEnd = deep.at(-1)?.date ?? '';
    const spotEnd = spot.at(-1)?.date ?? '';
    if (historyEnd < spotEnd) {
      console.warn(`warning: ${currency} history ends ${historyEnd}, before spot ${spotEnd}`);
    }
    const risk = riskDatasetSchema.parse({
      ...buildRiskDataset(spot, { sp500: sp, gold: au }, { fetchedAt, history: deep }),
      currency,
    });
    await writeJson(`${dir}/risk-metrics.json`, risk);
    console.log(`${dir}/risk-metrics.json: as of ${risk.asOf}, max drawdown ${risk.drawdown.maxDrawdownPct}%`);

    if (dxy) {
      const toPoints = (rows: { date: string; close: number }[]) =>
        rows.map(({ date, close }) => ({ date, value: close }));
      const correlations = correlationDatasetSchema.parse({
        ...buildCorrelationDataset(
          {
            btc: deep.map(({ date, price }) => ({ date, value: price })),
            sp500: toPoints(sp),
            gold: toPoints(au),
            dxy: toPoints(dxy),
          },
          { fetchedAt, asOf: risk.asOf, displayFrom: spot[0]?.date ?? risk.asOf },
        ),
        currency,
      });
      await writeJson(`${dir}/correlations.json`, correlations);
      console.log(
        `${dir}/correlations.json: ${correlations.pairs.map((p) => `${p.pair}=${p.series.length}`).join(' ')}`,
      );
    }
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
