import { describe, expect, it } from 'vitest';
import {
  CORRELATION_ASSETS,
  alignReturns,
  buildCorrelationDataset,
  correlationBtcLeg,
  pearson,
  rollingCorrelation,
  toSessionClose,
} from './correlation';
import { convertBenchmark, convertSeries } from './fx';
import { correlationDatasetSchema } from './schema';
import type { SeriesPoint } from './risk';

// Two calendars with a gap: y has no 2024-01-03, so the shared dates are
// 01, 02, 04, 05 and the 02->04 return spans the gap. Expected values were
// derived independently from the documented formulas.
const x = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-01-02', value: 110 },
  { date: '2024-01-03', value: 105 },
  { date: '2024-01-04', value: 121 },
  { date: '2024-01-05', value: 115 },
];
const y = [
  { date: '2024-01-01', value: 50 },
  { date: '2024-01-02', value: 55 },
  { date: '2024-01-04', value: 66 },
  { date: '2024-01-05', value: 60 },
];

describe('alignReturns', () => {
  it('intersects calendars and spans gaps with one multi-day return', () => {
    const aligned = alignReturns(x, y);
    expect(aligned.map((r) => r.date)).toEqual(['2024-01-02', '2024-01-04', '2024-01-05']);
    expect(aligned[0]?.ra).toBeCloseTo(Math.log(1.1), 12);
    expect(aligned[0]?.rb).toBeCloseTo(Math.log(1.1), 12);
    expect(aligned[1]?.ra).toBeCloseTo(Math.log(121 / 110), 12);
    expect(aligned[1]?.rb).toBeCloseTo(Math.log(1.2), 12);
    expect(aligned[2]?.rb).toBeCloseTo(Math.log(60 / 66), 12);
  });

  it('is empty with fewer than two shared dates', () => {
    expect(alignReturns(x, [{ date: '2024-01-02', value: 1 }])).toEqual([]);
  });
});

describe('pearson', () => {
  it('is 1 for identical return paths and -1 for inverted ones', () => {
    const closes = [100, 110, 105, 121, 115];
    const scaled = closes.map((v) => 2 * v);
    const inverted = closes.map((v) => 1_000_000 / v);
    const rets = (vals: number[]) => vals.slice(1).map((v, i) => Math.log(v / (vals[i] ?? 1)));
    expect(pearson(rets(closes), rets(scaled))).toBeCloseTo(1, 12);
    expect(pearson(rets(closes), rets(inverted))).toBeCloseTo(-1, 12);
  });

  it('is null below 2 observations, on length mismatch, and at zero variance', () => {
    expect(pearson([1], [1])).toBeNull();
    expect(pearson([1, 2], [1])).toBeNull();
    expect(pearson([1, 1], [1, 2])).toBeNull();
  });
});

describe('rollingCorrelation', () => {
  it('applies the calendar window, minObs floor, and zero-variance skip', () => {
    // Window 3 calendar days, minObs 2, over the aligned fixture returns:
    // 01-02 has 1 return (below minObs); 01-04's window holds the 01-02 and
    // 01-04 returns but x's are identical (zero variance) so it is skipped;
    // 01-05's window (> 01-02) holds the 01-04 and 01-05 returns -> corr 1.
    expect(rollingCorrelation(x, y, 3, 2)).toEqual([{ date: '2024-01-05', corr: 1 }]);
  });

  it('rounds interior correlations to 2 dp', () => {
    // Window wide enough to hold all three returns at 01-05: derived 0.9519... -> 0.95.
    expect(rollingCorrelation(x, y, 30, 3)).toEqual([{ date: '2024-01-05', corr: 0.95 }]);
  });
});

describe('buildCorrelationDataset', () => {
  // Every leg arrives already session-close dated — the caller owns the BTC
  // re-dating — so btc-gold is x against itself.
  const series = { btc: x, eth: x, sp500: y, gold: x, dxy: y };
  const dataset = buildCorrelationDataset(series, {
    fetchedAt: '2024-01-05T12:00:00.000Z',
    asOf: '2024-01-05',
    windowDays: 30,
    minObs: 3,
  });

  it('enumerates all ten pairs in fixed asset order', () => {
    expect(dataset.pairs.map((p) => p.pair)).toEqual([
      'btc-eth',
      'btc-sp500',
      'btc-gold',
      'btc-dxy',
      'eth-sp500',
      'eth-gold',
      'eth-dxy',
      'sp500-gold',
      'sp500-dxy',
      'gold-dxy',
    ]);
    // Pinned because the order is what builds every pair id: moving ETH later
    // in this list would silently rename pairs the committed data already uses.
    expect(CORRELATION_ASSETS).toEqual(['btc', 'eth', 'sp500', 'gold', 'dxy']);
  });

  it('omits a pair whose leg is missing, rather than emitting it empty', () => {
    // The schema permits an empty series — a pair whose sources share no
    // history yet — so an empty one here would be indistinguishable from that,
    // and a Yahoo outage would read as two assets that have never overlapped.
    // Dropping four pairs beats the alternative it replaced, which was writing
    // no correlations file at all while risk-metrics was rewritten without ETH.
    const without = buildCorrelationDataset(
      { btc: x, sp500: y, gold: x, dxy: y },
      { fetchedAt: '2024-01-05T12:00:00.000Z', asOf: '2024-01-05', windowDays: 30, minObs: 3 },
    );
    expect(without.pairs.map((p) => p.pair)).toEqual([
      'btc-sp500',
      'btc-gold',
      'btc-dxy',
      'sp500-gold',
      'sp500-dxy',
      'gold-dxy',
    ]);
    expect(without.pairs.some((p) => p.pair.includes('eth'))).toBe(false);
  });

  it('keeps btc-eth at full depth and clips eth\'s other pairs', () => {
    // The existing rule, not a new one: a pair containing BTC is deep, and
    // everything else keeps NON_BTC_KEEP_DAYS. Adding ETH beside BTC is what
    // makes btc-eth deep and eth-sp500 clipped without touching the rule.
    const deep = dataset.pairs.filter((p) => p.a === 'btc' || p.b === 'btc');
    expect(deep.map((p) => p.pair)).toEqual(['btc-eth', 'btc-sp500', 'btc-gold', 'btc-dxy']);
    expect(dataset.pairs.filter((p) => p.a === 'eth' && p.b !== 'btc')).toHaveLength(3);
  });

  it('carries the full shared range, identical-series pairs at corr 1', () => {
    // btc-gold is x against itself, so it aligns on x's own calendar and
    // reaches minObs a day earlier than btc-sp500, which aligns on x ∩ y.
    const btcGold = dataset.pairs.find((p) => p.pair === 'btc-gold');
    expect(btcGold?.series).toEqual([
      { date: '2024-01-04', corr: 1 },
      { date: '2024-01-05', corr: 1 },
    ]);
    const btcSp = dataset.pairs.find((p) => p.pair === 'btc-sp500');
    expect(btcSp?.series).toEqual([{ date: '2024-01-05', corr: 0.95 }]);
  });

  it('segments every pair, and the regimes span the series exactly', () => {
    for (const pair of dataset.pairs) {
      expect(pair.regimes.length > 0).toBe(pair.series.length > 0);
      if (pair.series.length === 0) continue;
      // Regimes are classified over full history, so a clipped pair's first
      // segment may start before its shipped window — but never after it, and
      // the last always ends with the series.
      expect((pair.regimes[0]?.startDate ?? '') <= (pair.series[0]?.date ?? '')).toBe(true);
      expect(pair.regimes.at(-1)?.endDate).toBe(pair.series.at(-1)?.date);
      if (pair.a === 'btc' || pair.b === 'btc') {
        expect(pair.regimes[0]?.startDate).toBe(pair.series[0]?.date);
        expect(pair.regimes.reduce((n, r) => n + r.observations, 0)).toBe(pair.series.length);
      }
    }
    // Both fixture pairs sit at corr >= 0.25 throughout.
    expect(dataset.pairs.find((p) => p.pair === 'btc-gold')?.regimes).toEqual([
      {
        regime: 'positive',
        startDate: '2024-01-04',
        confirmedFrom: '2024-01-04',
        endDate: '2024-01-05',
        observations: 2,
        days: 2,
        meanCorr: 1,
      },
    ]);
  });

  it('produces output the on-disk schema accepts', () => {
    expect(() => correlationDatasetSchema.parse({ ...dataset, currency: 'usd' })).not.toThrow();
  });
});

describe('correlationBtcLeg', () => {
  // The order of these two operations was a live bug worth 0.16 of correlation
  // against a 0.25 threshold, and it lived only in run.ts where no test ran it.
  // The invariant: converting both legs of a pair at the same day's rate makes
  // the FX term cancel, so the GBP-minus-USD return difference is identical on
  // each leg. Converting before re-dating breaks that and nothing else notices.
  const rates = [
    { date: '2024-01-01', close: 1.2 },
    { date: '2024-01-02', close: 1.25 },
    { date: '2024-01-03', close: 1.22 },
    { date: '2024-01-04', close: 1.3 },
    { date: '2024-01-05', close: 1.27 },
    { date: '2024-01-06', close: 1.24 },
  ];
  const history = [
    { date: '2024-01-02', price: 42000 },
    { date: '2024-01-03', price: 43500 },
    { date: '2024-01-04', price: 41800 },
    { date: '2024-01-05', price: 44100 },
    { date: '2024-01-06', price: 45000 },
  ];
  const benchmark = [
    { date: '2024-01-01', close: 4700 },
    { date: '2024-01-02', close: 4750 },
    { date: '2024-01-03', close: 4690 },
    { date: '2024-01-04', close: 4810 },
    { date: '2024-01-05', close: 4780 },
  ];

  const fxResidual = (btcGbp: SeriesPoint[], btcUsd: SeriesPoint[]): number => {
    const gbp = alignReturns(btcGbp, pts(convertBenchmark(benchmark, rates, 'gbp')));
    const usd = alignReturns(btcUsd, pts(convertBenchmark(benchmark, rates, 'usd')));
    let worst = 0;
    for (let i = 0; i < gbp.length; i++) {
      const g = gbp[i];
      const u = usd[i];
      if (!g || !u) continue;
      worst = Math.max(worst, Math.abs(g.ra - u.ra - (g.rb - u.rb)));
    }
    return worst;
  };
  const pts = (rows: { date: string; close: number }[]): SeriesPoint[] =>
    rows.map(({ date, close }) => ({ date, value: close }));

  it('re-dates before converting, so the FX term cancels between the legs', () => {
    const usd = correlationBtcLeg(history, rates, 'usd');
    const gbp = correlationBtcLeg(history, rates, 'gbp');
    expect(fxResidual(gbp, usd)).toBeLessThan(1e-12);
  });

  it('is broken by converting first — the ordering this pins', () => {
    // What run.ts used to do: convert, then re-date.
    const wrong = (currency: 'usd' | 'gbp'): SeriesPoint[] =>
      toSessionClose(convertSeries(history, rates, currency)).map(({ date, price }) => ({
        date,
        value: price,
      }));
    expect(fxResidual(wrong('gbp'), wrong('usd'))).toBeGreaterThan(1e-3);
  });

  it('leaves usd untouched apart from the re-dating', () => {
    expect(correlationBtcLeg(history, rates, 'usd')).toEqual(
      toSessionClose(history).map(({ date, price }) => ({ date, value: price })),
    );
  });
});

describe('toSessionClose', () => {
  it('re-dates a 00:00-UTC snapshot onto the session it closes', () => {
    expect(
      toSessionClose([
        { date: '2020-03-12', value: 7900 },
        { date: '2020-03-13', value: 3970 },
      ]),
    ).toEqual([
      { date: '2020-03-11', value: 7900 },
      { date: '2020-03-12', value: 3970 },
    ]);
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(toSessionClose([{ date: '2024-03-01', value: 1 }])[0]?.date).toBe('2024-02-29');
    expect(toSessionClose([{ date: '2024-01-01', value: 1 }])[0]?.date).toBe('2023-12-31');
  });

  // The defect this exists to remove, on the week it actually mattered: the
  // 00:00-UTC snapshot dated d carries the previous session's move, so
  // correlating on the raw date pairs BTC's crash with the market's rebound
  // and reports the two as inverse through the biggest co-crash on record.
  it('turns a spuriously inverse pairing into the co-movement that happened', () => {
    // BTC snapshots, one per calendar day: the 12th's crash lands on the 13th.
    const btc = [
      { date: '2020-03-11', value: 7900 },
      { date: '2020-03-12', value: 7950 },
      { date: '2020-03-13', value: 3975 },
      { date: '2020-03-14', value: 4094 },
      { date: '2020-03-15', value: 4050 },
      { date: '2020-03-16', value: 4000 },
      { date: '2020-03-17', value: 3890 },
    ];
    // S&P session closes: −9.5% on the 12th, +9.3% on the 13th, −12% on the 16th.
    const sp = [
      { date: '2020-03-11', value: 2741 },
      { date: '2020-03-12', value: 2481 },
      { date: '2020-03-13', value: 2711 },
      { date: '2020-03-16', value: 2386 },
    ];
    const corr = (a: typeof btc): number | null => {
      const rows = alignReturns(a, sp);
      return pearson(
        rows.map((r) => r.ra),
        rows.map((r) => r.rb),
      );
    };
    // The sign flip is the point. The corrected magnitude stays moderate
    // because BTC's crash is seven times the S&P's, which Pearson penalises
    // over three observations — but every pair now agrees in direction.
    expect(corr(btc)).toBeLessThan(0);
    expect(corr(toSessionClose(btc))).toBeGreaterThan(0.45);
    for (const row of alignReturns(toSessionClose(btc), sp)) {
      expect(Math.sign(row.ra)).toBe(Math.sign(row.rb));
    }
  });
});
