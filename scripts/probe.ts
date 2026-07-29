/**
 * M17 probe: the two things the first probe did not measure.
 *
 * The first probe established that ETH-USD, ETH-GBP and the extra /global
 * fields exist at the granularity M17 needs. Two questions it did not ask, and
 * both change the code rather than the prose:
 *
 * 1. HOW YAHOO DATES A CRYPTO BAR. `correlationBtcLeg` shifts the CoinGecko
 *    BTC series back one day because a 00:00-UTC snapshot dated d is the close
 *    of session d-1 — the fix that moved BTC-S&P from +0.09 to +0.44. ETH
 *    arrives through the Yahoo path, which may or may not date its bars the
 *    same way. Getting it wrong puts a one-day offset inside the BTC-ETH pair,
 *    where it would show up as a suspiciously low correlation between two
 *    assets that move together — a wrong number that looks plausible, which is
 *    the failure mode this repo keeps hitting.
 *
 *    Measured directly: fetch Yahoo BTC-USD and compare its closes against the
 *    committed CoinGecko series at lag -1, 0 and +1. Prices, not returns: at
 *    the right lag the two quote the same asset within a spread, and at the
 *    wrong lag they differ by a day of BTC volatility. There is no ambiguity
 *    to interpret.
 *
 * 2. HOW FAR NATIVE ETH-GBP DRIFTS FROM THE CONVERTED FIGURE. M17 takes ETH
 *    natively in the GBP tree, which makes it the only series there not
 *    re-denominated from one USD source. The decision came with an obligation:
 *    assert the two stay within a stated band. A band has to be measured
 *    before it can be stated.
 *
 * Read-only. Fetches, prints, exits. Writes no file.
 */

import { readFile } from 'node:fs/promises';

export {};

const ok = (s: string): string => `  ok   ${s}`;
const bad = (s: string): string => `  FAIL ${s}`;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

interface Bar {
  date: string;
  close: number;
}

/** One close per UTC day from a Yahoo chart payload, last bar of a day winning. */
async function yahooDaily(ticker: string, range = '10y'): Promise<Bar[]> {
  const payload = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`,
  )) as {
    chart: {
      result: [{ timestamp: number[]; indicators: { quote: [{ close: (number | null)[] }] } }];
    };
  };
  const result = payload.chart.result[0];
  const closes = result.indicators.quote[0].close;
  const byDate = new Map<string, number>();
  result.timestamp.forEach((ts, i) => {
    const close = closes[i];
    if (close === null || close === undefined || !Number.isFinite(close) || close <= 0) return;
    byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), close);
  });
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, close]) => ({ date, close }));
}

function pctStats(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  return `n=${sorted.length} median=${at(0.5).toFixed(3)}% p95=${at(0.95).toFixed(3)}% max=${at(1).toFixed(3)}%`;
}

/**
 * Q1: does a Yahoo crypto bar dated d hold the same price as CoinGecko's
 * snapshot dated d, or the one dated d+1?
 */
async function probeCryptoBarDating(): Promise<void> {
  console.log('\n=== Yahoo crypto bar dating vs the committed CoinGecko series ===');
  try {
    const committed = JSON.parse(await readFile('data/btc-price-daily.json', 'utf8')) as {
      series: { date: string; price: number }[];
    };
    const cg = new Map(committed.series.map((p) => [p.date, p.price]));
    const yahoo = await yahooDaily('BTC-USD');
    console.log(ok(`Yahoo BTC-USD: ${yahoo.length} bars ${yahoo[0]?.date} .. ${yahoo.at(-1)?.date}`));
    console.log(
      ok(
        `committed CoinGecko: ${committed.series.length} points ${committed.series[0]?.date} .. ${committed.series.at(-1)?.date}`,
      ),
    );
    for (const lag of [-1, 0, 1]) {
      const diffs: number[] = [];
      for (const bar of yahoo) {
        const shifted = new Date(Date.parse(`${bar.date}T00:00:00Z`) + lag * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const price = cg.get(shifted);
        if (price === undefined) continue;
        diffs.push(Math.abs(bar.close / price - 1) * 100);
      }
      if (diffs.length === 0) {
        console.log(bad(`lag ${lag}: no overlapping dates`));
        continue;
      }
      console.log(ok(`Yahoo(d) vs CoinGecko(d${lag >= 0 ? '+' : ''}${lag}): ${pctStats(diffs)}`));
    }
    console.log(
      '       The lag with the smallest median is how Yahoo dates a crypto bar.' +
        ' lag 0 means ETH needs the same toSessionClose shift BTC gets; lag +1 means it is already session-dated.',
    );
  } catch (error) {
    console.log(bad(`bar dating: ${String(error)}`));
  }
}

/** Q2: the spread between natively-quoted ETH-GBP and ETH-USD converted at the committed rate. */
async function probeNativeGbpSpread(): Promise<void> {
  console.log('\n=== ETH-GBP native vs ETH-USD converted at the committed rate ===');
  try {
    const fxFile = JSON.parse(await readFile('data/fx-gbpusd.json', 'utf8')) as {
      series: { date: string; close: number }[];
    };
    const fx = new Map(fxFile.series.map((p) => [p.date, p.close]));
    const [usd, gbp] = await Promise.all([yahooDaily('ETH-USD'), yahooDaily('ETH-GBP')]);
    console.log(ok(`ETH-USD ${usd.length} bars ${usd[0]?.date} .. ${usd.at(-1)?.date}`));
    console.log(ok(`ETH-GBP ${gbp.length} bars ${gbp[0]?.date} .. ${gbp.at(-1)?.date}`));
    const usdBy = new Map(usd.map((b) => [b.date, b.close]));
    const diffs: number[] = [];
    const worst: { date: string; pct: number }[] = [];
    for (const bar of gbp) {
      const u = usdBy.get(bar.date);
      const rate = fx.get(bar.date);
      if (u === undefined || rate === undefined) continue;
      const converted = u / rate;
      const pct = (bar.close / converted - 1) * 100;
      diffs.push(Math.abs(pct));
      worst.push({ date: bar.date, pct });
    }
    if (diffs.length === 0) {
      console.log(bad('no dates where both quotes and a committed FX rate exist'));
      return;
    }
    console.log(ok(`|native/converted - 1|: ${pctStats(diffs)}`));
    worst.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    console.log('       widest ten days:');
    for (const w of worst.slice(0, 10)) console.log(`         ${w.date}  ${w.pct.toFixed(2)}%`);
    for (const band of [0.5, 1, 2, 5]) {
      const over = diffs.filter((d) => d > band).length;
      console.log(`       beyond ${band}%: ${over} of ${diffs.length} (${((over / diffs.length) * 100).toFixed(2)}%)`);
    }
  } catch (error) {
    console.log(bad(`native GBP spread: ${String(error)}`));
  }
}

await probeCryptoBarDating();
await probeNativeGbpSpread();
console.log('\ndone');
