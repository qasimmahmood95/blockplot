import { describe, expect, it } from 'vitest';
import {
  CORRELATION_ASSETS,
  alignReturns,
  buildCorrelationDataset,
  pearson,
  rollingCorrelation,
  toSessionClose,
} from './correlation';
import { correlationDatasetSchema } from './schema';

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
  const series = { btc: x, sp500: y, gold: x, dxy: y };
  const dataset = buildCorrelationDataset(series, {
    fetchedAt: '2024-01-05T12:00:00.000Z',
    asOf: '2024-01-05',
    windowDays: 30,
    minObs: 3,
  });

  it('enumerates all six pairs in fixed asset order', () => {
    expect(dataset.pairs.map((p) => p.pair)).toEqual([
      'btc-sp500',
      'btc-gold',
      'btc-dxy',
      'sp500-gold',
      'sp500-dxy',
      'gold-dxy',
    ]);
    expect(CORRELATION_ASSETS).toEqual(['btc', 'sp500', 'gold', 'dxy']);
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
