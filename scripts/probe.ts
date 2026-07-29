/**
 * Print the live shape of every source M17-M20 would depend on.
 *
 * Exists because the development environment has no outbound network, so the
 * field names and chart slugs in PLAN.md's M17-M21 section are recalled rather
 * than measured — and this project has shipped confident prose that the data
 * contradicted often enough that recalled is not good enough to plan against.
 *
 * Read-only. Fetches, prints, exits. It writes no file and commits nothing, so
 * it cannot disturb `/data` or the pipeline's authorship rules.
 *
 * Delete once M17 is planned against the output.
 */

export {};

const ok = (s: string): string => `  ok   ${s}`;
const bad = (s: string): string => `  FAIL ${s}`;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** What is actually in CoinGecko's /global beyond the two fields we keep. */
async function probeGlobal(): Promise<void> {
  console.log('\n=== CoinGecko /global ===');
  try {
    const payload = (await getJson('https://api.coingecko.com/api/v3/global')) as {
      data: Record<string, unknown>;
    };
    const data = payload.data;
    console.log(ok(`top-level keys: ${Object.keys(data).sort().join(', ')}`));

    const pct = data['market_cap_percentage'] as Record<string, number> | undefined;
    if (!pct) {
      console.log(bad('market_cap_percentage missing'));
    } else {
      const entries = Object.entries(pct).sort((a, b) => b[1] - a[1]);
      console.log(ok(`market_cap_percentage has ${entries.length} keys:`));
      for (const [k, v] of entries) console.log(`         ${k.padEnd(8)} ${v.toFixed(4)}`);
      // The three M17 wants, named explicitly so a miss is obvious.
      for (const k of ['btc', 'eth', 'usdt', 'usdc']) {
        console.log(k in pct ? ok(`  wanted "${k}" present`) : bad(`  wanted "${k}" ABSENT`));
      }
    }

    for (const k of ['total_market_cap', 'total_volume']) {
      const v = data[k] as Record<string, number> | undefined;
      console.log(
        v && typeof v['usd'] === 'number'
          ? ok(`${k}.usd = ${v['usd']}`)
          : bad(`${k}.usd missing or not a number`),
      );
    }
    console.log(
      typeof data['market_cap_change_percentage_24h_usd'] === 'number'
        ? ok(`market_cap_change_percentage_24h_usd = ${data['market_cap_change_percentage_24h_usd']}`)
        : bad('market_cap_change_percentage_24h_usd missing'),
    );
  } catch (error) {
    console.log(bad(`/global: ${String(error)}`));
  }
}

/**
 * Every blockchain.com slug M19 might use, checked for the same shape the two
 * already-ingested charts have: `{ values: [{ x: unixSeconds, y: number }] }`.
 */
async function probeBlockchainCharts(): Promise<void> {
  console.log('\n=== blockchain.com charts (shape + depth) ===');
  const slugs = [
    'hash-rate', // already ingested — the control
    'n-transactions', // already ingested — the control
    'transaction-fees',
    'transaction-fees-usd',
    'miners-revenue',
    'mempool-size',
    'difficulty',
    'total-bitcoins',
    'n-unique-addresses',
    'avg-block-size',
  ];
  for (const slug of slugs) {
    try {
      const payload = (await getJson(
        `https://api.blockchain.info/charts/${slug}?timespan=3years&sampled=false&format=json`,
      )) as { values?: { x: number; y: number }[]; unit?: string; period?: string };
      const values = payload.values ?? [];
      const first = values[0];
      const last = values[values.length - 1];
      if (values.length === 0 || !first || !last) {
        console.log(bad(`${slug.padEnd(22)} no values`));
        continue;
      }
      const day = (x: number): string => new Date(x * 1000).toISOString().slice(0, 10);
      // Measured spacing, not the self-reported `period`: total-bitcoins
      // claims period=day and returns ~132 points per day, so the field lies.
      const gaps = values.slice(1, 400).map((v, i) => v.x - (values[i] as { x: number }).x);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
      const spacing =
        median >= 86000 ? `${Math.round(median / 86400)}d` : `${Math.round(median / 60)}min`;
      console.log(
        ok(
          `${slug.padEnd(22)} n=${String(values.length).padStart(6)} ` +
            `${day(first.x)}..${day(last.x)} unit=${(payload.unit ?? '?').padEnd(18)} ` +
            `claims=${(payload.period ?? '?').padEnd(6)} MEASURED=${spacing.padEnd(6)} last=${last.y}`,
        ),
      );
    } catch (error) {
      console.log(bad(`${slug.padEnd(22)} ${String(error)}`));
    }
  }
}

/** CPI for M20, through the same keyless CSV export FRED already serves us. */
async function probeFredCpi(): Promise<void> {
  console.log('\n=== FRED CPIAUCSL (CSV export) ===');
  try {
    const res = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.trim().split('\n');
    console.log(ok(`header: ${lines[0]}`));
    console.log(ok(`rows: ${lines.length - 1}`));
    console.log(ok(`first: ${lines[1]}`));
    console.log(ok(`last:  ${lines[lines.length - 1]}`));
    // Monthly, not daily — which changes how it joins to a daily price series.
    console.log(ok(`second: ${lines[2]} (spacing tells us monthly vs daily)`));
  } catch (error) {
    console.log(bad(`CPIAUCSL: ${String(error)}`));
  }
}

/**
 * ETH-USD for M17, through the same Yahoo call gold and DXY actually make.
 *
 * The first version of this probe used `range=max`, which `benchmarks.ts:193`
 * documents as deliberately never used because Yahoo accepts it alongside
 * `interval=1d` and then serves weekly or monthly bars. Probing with the
 * known-bad parameter measured the parameter, not the ticker.
 */
async function probeYahooEth(): Promise<void> {
  console.log('\n=== Yahoo ETH (repo params: range=10y&interval=1d) ===');
  for (const ticker of ['ETH-USD', 'ETH=F', 'ETH-GBP']) {
    try {
      const payload = (await getJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`,
      )) as {
        chart: { result: { timestamp?: number[]; meta?: Record<string, unknown> }[] };
      };
      const result = payload.chart.result[0];
      const stamps = result?.timestamp ?? [];
      const day = (x: number): string => new Date(x * 1000).toISOString().slice(0, 10);
      const firstStamp = stamps[0];
      const lastStamp = stamps[stamps.length - 1];
      if (stamps.length < 2 || firstStamp === undefined || lastStamp === undefined) {
        console.log(bad(`${ticker.padEnd(8)} too few points (${stamps.length})`));
        continue;
      }
      // range=max is silently coarsened to monthly bars for some tickers — the
      // trap M11 already hit — so the gap between the first two points matters
      // more than the count.
      // Median over many points, not the first gap: a single weekend at the
      // start would read as coarsened.
      const gaps = stamps.slice(1, 200).map((t, i) => t - (stamps[i] as number));
      const gapDays = Math.round((([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0) / 86400));
      console.log(
        ok(
          `${ticker.padEnd(8)} n=${stamps.length} ${day(firstStamp)}..${day(lastStamp)} ` +
            `firstGap=${gapDays}d ${gapDays <= 4 ? '(daily)' : '(COARSENED — not daily)'}`,
        ),
      );
    } catch (error) {
      console.log(bad(`${ticker.padEnd(8)} ${String(error)}`));
    }
  }
}

console.log('blockplot source probe — read-only, commits nothing');
await probeGlobal();
await probeBlockchainCharts();
await probeFredCpi();
await probeYahooEth();
console.log('\ndone');
