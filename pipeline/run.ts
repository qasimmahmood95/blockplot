import {
  BENCHMARK_KEEP_DAYS,
  fetchDxy,
  fetchEth,
  fetchEthGbp,
  fetchGold,
  fetchSp500,
  recentWindow,
  SP500_FRED_SERIES,
} from './benchmarks';
import { fetchBtcMarketChart, PRICE_RANGE_DAYS } from './coingecko';
import { buildCorrelationDataset, correlationBtcLeg } from './correlation';
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
  MAX_MEDIAN_QUOTE_DIVERGENCE_PCT,
  quoteDivergence,
} from './fx';
import { buildHalvingDataset } from './halvings';
import type { DominancePoint, HalvingDataset, QuoteDivergenceStats } from './schema';
import { fetchBtcHistory } from './history';
import { writeJson } from './io';
import {
  athSignal,
  cycleHighSignal,
  dominanceSignal,
  drawdownSignal,
  rawSpanCounts,
  volSignal,
  DRAWDOWN_BANDS_PCT,
  SIGNAL_CONFIRM_DAYS,
  VOL_HIGH_PCT,
  VOL_LOW_PCT,
  VOL_WINDOW_DAYS,
} from './signals';
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
import { HISTORY_DAILY_DAYS, thinOlderToWeekly } from './series';
import { buildRiskDataset } from './risk';
import {
  benchmarkDatasetSchema,
  benchmarkHistoryDatasetSchema,
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
  signalsDatasetSchema,
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
  ethFetch,
  ethGbpFetch,
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
  attempt('yahoo eth', fetchEth()),
  // Its own request rather than a conversion, per the M17 decision. Optional
  // like every other source: if it fails, the GBP tree converts instead, which
  // the log below says explicitly rather than leaving to be inferred.
  attempt('yahoo eth-gbp', fetchEthGbp()),
  attempt('blockchain.com history', fetchBtcHistory()),
  attempt('coingecko global', fetchDominanceSnapshot(now)),
  attempt('defillama stablecoins', fetchStablecoins()),
  attempt('blockchain.com hash-rate', fetchHashRate()),
  attempt('blockchain.com n-transactions', fetchTxCount()),
  attempt('mempool.space fees', fetchFeeTiers()),
  attempt('yahoo gbpusd', fetchGbpUsd()),
]);

const series = raw ? toDailySeries(raw.prices) : null;

/**
 * The accreted dominance series, carried out for the signals below. Falls back
 * to what is already committed when today's snapshot fetch failed, so a
 * dominance signal does not disappear from the site because one request did.
 */
let dominanceSeries: DominancePoint[] = await readExistingDominance('data/dominance.json');

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
  dominanceSeries = dominance.series;
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
  let runningCycle: HalvingDataset['cycles'][number] | null = null;
  const spot = series ? convertSeries(series, rates, currency) : null;
  const deep = history ? convertSeries(history, rates, currency) : null;
  // Correlation gets its own BTC series: re-dated onto the session it closes
  // and only then converted, so both legs of a GBP pair are priced at the same
  // day's rate and the FX term cancels between them. The committed history
  // stays 00:00-UTC dated, because every other metric aggregates one series.
  const deepSession = history ? correlationBtcLeg(history, rates, currency) : null;
  // convertSeries drops days with no rate, so a rate floor later than the BTC
  // start would quietly give GBP a shorter history than USD — the heatmap and
  // cycle overlay would begin later with nothing anywhere saying why.
  // deepSession is checked too, not just deep: re-dating moves the BTC start a
  // day earlier, so it consumes a day of the very headroom this guard exists
  // to protect and would be the first of the two to lose history.
  for (const [label, converted] of [
    ['history', deep],
    ['correlation input', deepSession],
  ] as const) {
    if (converted && history && converted.length !== history.length) {
      throw new Error(
        `${currency} ${label}: converting dropped ${history.length - converted.length} days — ` +
          `the FX floor ${FX_HISTORY_FROM} is later than the BTC start ${history[0]?.date}`,
      );
    }
  }
  // Deep, for the correlation regimes; the 460d window below is what the risk
  // page and the benchmarks file need.
  const spAll = sp500 ? convertBenchmark(sp500, rates, currency) : null;
  const auAll = goldFetch ? convertBenchmark(goldFetch.series, rates, currency) : null;
  // DXY is a dollar index by construction, so it is never converted; the
  // correlation page notes that its pairs stay dollar-denominated.
  const dxyAll = dxyFetch?.series ?? null;
  // ETH is the one series in the GBP tree taken from its own market rather
  // than re-denominated (M17). `ethSource` records which route was actually
  // used, because the methodology page states it and a silent fallback would
  // make that page wrong — the failure this project keeps repeating.
  const ethConverted = ethFetch ? convertBenchmark(ethFetch.series, rates, currency) : null;
  const ethNative = currency === 'gbp' ? (ethGbpFetch?.series ?? null) : null;
  const ethAll = ethNative ?? ethConverted;
  const ethSource: 'native' | 'converted' | null =
    ethAll === null ? null : ethNative ? 'native' : 'converted';
  const ethTicker = ethNative ? ethGbpFetch?.ticker : ethFetch?.ticker;
  // The obligation attached to quoting natively: show that the two routes
  // agree. The median is asserted; the worst day is reported. See
  // MAX_MEDIAN_QUOTE_DIVERGENCE_PCT for why that split and not the other.
  // Only when the USD leg is spot. `ETH=F` is a sanctioned fallback, and
  // against it this would be comparing a sterling spot quote with a converted
  // dollar *future* — a basis, not a quote spread. Review measured that a
  // routine 1.5% front-month basis trips the throw, which would take out every
  // GBP dataset and network.json for a reason that is not a fault.
  const ethSpotUsd = ethFetch?.ticker === 'ETH-USD';
  let ethQuoteDivergence: QuoteDivergenceStats | undefined;
  if (ethNative && ethConverted && ethSpotUsd) {
    const divergence = quoteDivergence(ethNative, ethConverted);
    if (!divergence) {
      console.warn(`warning: ${currency} eth native and converted share no dates`);
    } else {
      ethQuoteDivergence = { ...divergence, bandPct: MAX_MEDIAN_QUOTE_DIVERGENCE_PCT };
      console.log(
        `${currency} eth native vs converted: ${divergence.days} shared days, ` +
          `median ${divergence.medianPct}%, p95 ${divergence.p95Pct}%, ` +
          `worst ${divergence.maxPct}% on ${divergence.maxDate}, ` +
          `${divergence.beyond1Pct} days beyond 1%`,
      );
      if (divergence.medianPct > MAX_MEDIAN_QUOTE_DIVERGENCE_PCT) {
        throw new Error(
          `${currency} eth: median native-vs-converted divergence ${divergence.medianPct}% ` +
            `exceeds ${MAX_MEDIAN_QUOTE_DIVERGENCE_PCT}% — a gap this wide in the median is a ` +
            `systematic fault (wrong ticker, inverted or stale rate, mis-joined dates), not a spread`,
        );
      }
    }
  }
  const sp = spAll ? recentWindow(spAll) : null;
  const au = auAll ? recentWindow(auAll) : null;
  const dxy = dxyAll ? recentWindow(dxyAll) : null;
  if (ethNative && ethConverted && !ethSpotUsd) {
    console.warn(
      `warning: ${currency} eth divergence check skipped — the USD leg came from ` +
        `${ethFetch?.ticker}, whose basis against spot is not a quote spread`,
    );
  }
  const eth = ethAll ? recentWindow(ethAll) : null;
  // A benchmark reaching further back than the FX record would silently
  // shorten the GBP view. It cannot happen while Yahoo caps daily history at
  // ten years — both routes currently start in 2016 — so this is a tripwire
  // for a future depth change rather than a live condition, and it reports
  // rather than throwing because the truncation would be expected, not a bug.
  if (currency !== 'usd') {
    for (const [label, converted, source] of [
      ['sp500', spAll, sp500],
      ['gold', auAll, goldFetch?.series],
    ] as const) {
      const dropped = (source?.length ?? 0) - (converted?.length ?? 0);
      if (dropped > 0) {
        console.log(
          `${currency} ${label}: ${dropped} days before the FX record (${FX_HISTORY_FROM}) dropped; ` +
            `its ${currency} correlations start at ${converted?.[0]?.date}`,
        );
      }
    }
  }

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
    if (!eth) {
      console.warn(
        `warning: ${currency} benchmarks written without ETH — every ETH source failed`,
      );
    }
    const benchmarks = benchmarkDatasetSchema.parse({
      schemaVersion: 1,
      currency,
      fetchedAt,
      keepDays: BENCHMARK_KEEP_DAYS,
      ...(ethQuoteDivergence ? { ethQuoteDivergence } : {}),
      benchmarks: [
        { asset: 'sp500', source: 'fred', sourceSeries: SP500_FRED_SERIES, series: sp },
        { asset: 'gold', source: 'yahoo', sourceSeries: goldFetch.ticker, series: au },
        { asset: 'dxy', source: 'yahoo', sourceSeries: dxyFetch.ticker, series: dxy },
        // The ticker recorded is the one that served the data, so a GBP file
        // built by conversion says ETH-USD and one quoted natively says
        // ETH-GBP. The methodology page reads this rather than asserting it.
        //
        // Omitted entirely when no ETH source answered, rather than costing the
        // file: the three original benchmarks are what this file has always
        // guaranteed, and dropping all of them because Yahoo was down would
        // leave the risk page a day fresher than the correlation page with
        // nothing saying so.
        ...(eth && ethTicker
          ? [{ asset: 'eth', source: 'yahoo', sourceSeries: ethTicker, series: eth }]
          : []),
      ],
    });
    await writeJson(`${dir}/benchmarks-daily.json`, benchmarks);
    console.log(
      `${dir}/benchmarks-daily.json: sp500 ${sp.length}, gold ${au.length}, dxy ${dxy.length}, ` +
        (eth ? `eth ${eth.length} days (${ethTicker}, ${ethSource})` : 'eth absent'),
    );
  }

  // The deep history the rebased comparison reads. Written from the same
  // untrimmed series the correlation dataset uses, so /performance and
  // /correlation cannot disagree about what a benchmark did — and thinned by one
  // stated rule, because a decade of five daily series is 92 KB gzipped and all
  // of it would have to be embedded (the reader picks the start date, and no
  // runtime fetch is sanctioned to go and fetch more).
  if (deep && spAll && auAll && dxyAll) {
    // Six significant figures, not two decimal places.
    //
    // The GBP tree keeps converted closes unrounded on purpose — a 2 dp round on
    // a sub-pound 2010 BTC price is an error of up to 11% that propagates into
    // the monthly heatmap — and those series stay in btc-price-history.json for
    // the metrics that need them. This file feeds one rebased index chart, where
    // full float precision buys nothing and costs a great deal: measured, the
    // GBP payload was 61.7 KB gzipped against USD's 40.8, and the whole 21 KB
    // difference was seventeen-digit conversion residue like
    // 1659.4724038315342. Significant figures rather than decimal places
    // because this file spans BTC at 0.0451 and the S&P at 5505 — a fixed
    // decimal place is either too coarse for one end or useless at the other.
    // At 6 s.f. the resulting index differs by less than one part in a million,
    // which is four orders of magnitude below the 2 dp it is displayed at.
    const rows = (series: { date: string; close: number }[]) =>
      thinOlderToWeekly(series, HISTORY_DAILY_DAYS).map(({ date, close }) => ({
        date,
        close: Number(close.toPrecision(6)),
      }));
    const history = benchmarkHistoryDatasetSchema.parse({
      schemaVersion: 1,
      currency,
      fetchedAt,
      dailyDays: HISTORY_DAILY_DAYS,
      olderResolution: 'weekly-last',
      series: [
        // BTC carries the same rule as the rest rather than being read from
        // btc-price-history.json at full resolution: one file, one rule, and a
        // chart whose lines are all sampled the same way.
        {
          asset: 'btc',
          sourceSeries: 'blockchain.info market-price',
          rows: rows(deep.map(({ date, price }) => ({ date, close: price }))),
        },
        { asset: 'sp500', sourceSeries: SP500_FRED_SERIES, rows: rows(spAll) },
        { asset: 'gold', sourceSeries: goldFetch?.ticker ?? 'yahoo', rows: rows(auAll) },
        { asset: 'dxy', sourceSeries: dxyFetch?.ticker ?? 'yahoo', rows: rows(dxyAll) },
        ...(ethAll && ethTicker
          ? [{ asset: 'eth', sourceSeries: ethTicker, rows: rows(ethAll) }]
          : []),
      ],
    });
    await writeJson(`${dir}/benchmarks-history.json`, history);
    console.log(
      `${dir}/benchmarks-history.json: ` +
        history.series.map((x) => `${x.asset} ${x.rows.length}`).join(', ') +
        ` (daily ${HISTORY_DAILY_DAYS}d, older weekly)`,
    );
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
    // Carried out of this block for the signals below, which are written from
    // the risk block once every input it needs exists.
    runningCycle = halvings.cycles.at(-1) ?? null;
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
      ...buildRiskDataset(
        spot,
        { sp500: sp, gold: au, ...(eth ? { eth } : {}) },
        { fetchedAt, history: deep },
      ),
      currency,
    });
    await writeJson(`${dir}/risk-metrics.json`, risk);
    console.log(`${dir}/risk-metrics.json: as of ${risk.asOf}, max drawdown ${risk.drawdown.maxDrawdownPct}%`);

    if (spAll && auAll && dxyAll && deepSession) {
      const toPoints = (rows: { date: string; close: number }[]) =>
        rows.map(({ date, close }) => ({ date, value: close }));
      const correlations = correlationDatasetSchema.parse({
        ...buildCorrelationDataset(
          {
            btc: deepSession,
            // No session-close shift: a Yahoo crypto bar is already dated on
            // the day it closes, measured against the committed CoinGecko
            // series. See CORRELATION_ASSETS for the numbers. Omitted when no
            // ETH source answered, which drops its four pairs rather than the
            // file.
            ...(ethAll ? { eth: toPoints(ethAll) } : {}),
            sp500: toPoints(spAll),
            gold: toPoints(auAll),
            dxy: toPoints(dxyAll),
          },
          { fetchedAt, asOf: risk.asOf },
        ),
        currency,
      });
      await writeJson(`${dir}/correlations.json`, correlations);
      console.log(
        `${dir}/correlations.json: ${correlations.pairs.map((p) => `${p.pair}=${p.series.length}/${p.regimes.length}r`).join(' ')}`,
      );
    }

    // Signals last in this block: they read what the others just computed, so
    // a failure here costs today's signals and nothing else.
    // Not `?? []`: the volatility signal reads a window that risk.ts must
    // actually produce, and the two constants are declared in different files.
    // If they ever diverge the tile silently disappears from the panel and half
    // the feed with it — while dominance, the other absent signal, gets a
    // sentence explaining itself. A missing window is a bug, not a data gap.
    const volWindow = risk.rollingVol.find((w) => w.windowDays === VOL_WINDOW_DAYS);
    if (!volWindow) {
      throw new Error(
        `signals: no ${VOL_WINDOW_DAYS}d rolling-vol window in risk-metrics — ` +
          `VOL_WINDOW_DAYS and ROLLING_VOL_WINDOWS have diverged`,
      );
    }
    const volSeries = volWindow.series;
    const signals = signalsDatasetSchema.parse({
      schemaVersion: 1,
      currency,
      fetchedAt,
      asOf: risk.asOf,
      thresholds: {
        volWindowDays: VOL_WINDOW_DAYS,
        volLowPct: VOL_LOW_PCT,
        volHighPct: VOL_HIGH_PCT,
        drawdownBandsPct: [...DRAWDOWN_BANDS_PCT],
        confirmDays: SIGNAL_CONFIRM_DAYS,
      },
      rawSpans: rawSpanCounts(volSeries, risk.drawdown.series),
      vol: volSignal(volSeries),
      drawdown: drawdownSignal(risk.drawdown.series),
      ath: athSignal(deep),
      cycle: runningCycle
        ? { halvingDate: runningCycle.halvingDate, ...cycleHighSignal(runningCycle.series) }
        : null,
      // Global, not per-currency — dominance is a share of market cap — but
      // written into both trees so a page never has to reach across them.
      dominance: dominanceSignal(dominanceSeries),
    });
    await writeJson(`${dir}/signals.json`, signals);
    console.log(
      `${dir}/signals.json: vol ${signals.vol?.state ?? 'n/a'} since ${signals.vol?.since ?? '-'}` +
        `${signals.vol?.pending ? ` (${signals.vol.pending.state} pending ${signals.vol.pending.observations})` : ''}` +
        `, drawdown ${signals.drawdown?.state ?? 'n/a'}%` +
        `, ${signals.ath?.daysSince ?? '?'}d since ATH` +
        `, dominance ${signals.dominance ? `${signals.dominance.changePp}pp/30d` : 'insufficient history'}`,
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
