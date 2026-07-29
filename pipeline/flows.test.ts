import { describe, expect, it } from 'vitest';
import {
  accreteDominance,
  parseStablecoinChart,
  sharePoints,
  stablecoinChange30dPct,
  toDominanceSnapshot,
  turnoverPct,
} from './flows';
import { coingeckoGlobalSchema, dominanceDatasetSchema, stablecoinDatasetSchema } from './schema';
import { trimToLastDays } from './series';

describe('accreteDominance', () => {
  const existing = [
    { date: '2026-07-24', btcDominancePct: 55.1, totalMcapUsd: 2_400_000_000_000 },
    { date: '2026-07-25', btcDominancePct: 55.4, totalMcapUsd: 2_410_000_000_000 },
  ];

  it('appends a new day', () => {
    const next = { date: '2026-07-26', btcDominancePct: 55.8, totalMcapUsd: 2_420_000_000_000 };
    expect(accreteDominance(existing, next)).toEqual([...existing, next]);
  });

  it('replaces the same day so the last run of a day wins', () => {
    const revised = { date: '2026-07-25', btcDominancePct: 55.6, totalMcapUsd: 2_415_000_000_000 };
    expect(accreteDominance(existing, revised)).toEqual([existing[0], revised]);
  });

  it('starts a fresh series from empty and rejects time going backwards', () => {
    const first = { date: '2026-07-26', btcDominancePct: 55.8, totalMcapUsd: 2_420_000_000_000 };
    expect(accreteDominance([], first)).toEqual([first]);
    expect(() =>
      accreteDominance(existing, { date: '2026-07-20', btcDominancePct: 50, totalMcapUsd: 1 }),
    ).toThrow('precedes series end');
  });
});

describe('toDominanceSnapshot', () => {
  const payload = (pct: Record<string, number>, volume?: number): unknown => ({
    data: {
      total_market_cap: { usd: 2_420_000_000_123 },
      ...(volume === undefined ? {} : { total_volume: { usd: volume } }),
      market_cap_percentage: pct,
    },
  });
  const snap = (pct: Record<string, number>, volume?: number) =>
    toDominanceSnapshot(coingeckoGlobalSchema.parse(payload(pct, volume)), '2026-07-29');

  it('keeps the four figures, rounding shares to 2dp and money to whole units', () => {
    expect(snap({ btc: 56.4321, eth: 12.3456, usdt: 4.111, usdc: 1.222 }, 98_765_432_198.7)).toEqual(
      {
        date: '2026-07-29',
        btcDominancePct: 56.43,
        totalMcapUsd: 2_420_000_000_123,
        ethDominancePct: 12.35,
        stablecoinSharePct: 5.33,
        volume24hUsd: 98_765_432_199,
      },
    );
  });

  it('omits a share CoinGecko did not report, rather than calling it zero', () => {
    // The distinction is load-bearing: this file accretes and is never
    // rewritten, so a defaulted 0 would be indistinguishable from a real
    // reading for as long as the series exists.
    const result = snap({ btc: 56.43 });
    expect(result).toEqual({
      date: '2026-07-29',
      btcDominancePct: 56.43,
      totalMcapUsd: 2_420_000_000_123,
    });
    expect('ethDominancePct' in result).toBe(false);
    expect('volume24hUsd' in result).toBe(false);
  });

  it('sums only the stablecoins present, so a dropped key does not deflate the share', () => {
    expect(snap({ btc: 50, usdt: 4.2 }).stablecoinSharePct).toBe(4.2);
    expect(snap({ btc: 50, usdc: 1.3 }).stablecoinSharePct).toBe(1.3);
    expect(snap({ btc: 50, usdt: 4.2, usdc: 1.3 }).stablecoinSharePct).toBe(5.5);
  });

  it('records a genuine zero volume as zero, which is not the same as absent', () => {
    expect(snap({ btc: 50 }, 0).volume24hUsd).toBe(0);
  });

  it('still requires btc, whose absence is a broken response rather than a gap', () => {
    expect(() => coingeckoGlobalSchema.parse(payload({ eth: 12 }))).toThrow();
  });

  it('rejects a share outside 0-100 instead of committing it', () => {
    expect(() => coingeckoGlobalSchema.parse(payload({ btc: 50, eth: 101 }))).toThrow();
  });
});

describe('parseStablecoinChart', () => {
  it('collapses rows to one total per UTC day, skipping unusable rows', () => {
    // 1709251200 = 2024-03-01T00:00Z; the 12:00 same-day row (1709294400) wins.
    expect(
      parseStablecoinChart([
        { date: '1709294400', totalCirculatingUSD: { peggedUSD: 138_000_000_100.4 } },
        { date: '1709251200', totalCirculatingUSD: { peggedUSD: 137_500_000_000 } },
        { date: '1709337600', totalCirculatingUSD: {} }, // 2024-03-02, missing total: skipped
        { date: '1709424000', totalCirculatingUSD: { peggedUSD: 139_000_000_000 } },
      ]),
    ).toEqual([
      { date: '2024-03-01', totalUsd: 138_000_000_100 },
      { date: '2024-03-03', totalUsd: 139_000_000_000 },
    ]);
  });

  it('rejects empty payloads, malformed rows, and all-unusable series', () => {
    expect(() => parseStablecoinChart([])).toThrow();
    expect(() => parseStablecoinChart([{ date: 'not-unix' }])).toThrow();
    expect(() =>
      parseStablecoinChart([
        { date: '1709251200', totalCirculatingUSD: { peggedUSD: 0 } },
        { date: '1709337600' },
      ]),
    ).toThrow('too few usable rows');
  });
});

describe('stablecoinChange30dPct', () => {
  it('compares against the closest entry at or before 30 days back, exactly', () => {
    // Base 2024-01-31 (exactly 30d before 2024-03-01): 110/100 − 1 = +10%.
    expect(
      stablecoinChange30dPct([
        { date: '2024-01-30', totalUsd: 90 },
        { date: '2024-01-31', totalUsd: 100 },
        { date: '2024-03-01', totalUsd: 110 },
      ]),
    ).toBe(10);
    // Exact 30d date absent: the closest earlier entry (01-28, 88) is chosen.
    expect(
      stablecoinChange30dPct([
        { date: '2024-01-28', totalUsd: 88 },
        { date: '2024-02-15', totalUsd: 100 },
        { date: '2024-03-01', totalUsd: 110 },
      ]),
    ).toBe(25);
    // No entry at/before the target -> null.
    expect(
      stablecoinChange30dPct([
        { date: '2024-02-15', totalUsd: 100 },
        { date: '2024-03-01', totalUsd: 110 },
      ]),
    ).toBeNull();
  });
});

describe('trimToLastDays (shared helper, stablecoin-shaped points)', () => {
  it('keeps only entries within N calendar days of the last entry, and [] stays []', () => {
    const series = [
      { date: '2024-12-28', totalUsd: 1 },
      { date: '2024-12-29', totalUsd: 2 },
      { date: '2024-12-30', totalUsd: 3 },
      { date: '2024-12-31', totalUsd: 4 },
    ];
    expect(trimToLastDays(series, 2)).toEqual(series.slice(2));
    expect(trimToLastDays([], 30)).toEqual([]);
  });
});

describe('flows dataset schemas', () => {
  it('accept documented shapes and reject out-of-range dominance', () => {
    expect(() =>
      dominanceDatasetSchema.parse({
        schemaVersion: 1,
        source: 'coingecko',
        fetchedAt: '2026-07-26T12:00:00.000Z',
        series: [{ date: '2026-07-26', btcDominancePct: 55.8, totalMcapUsd: 2_420_000_000_000 }],
      }),
    ).not.toThrow();
    expect(() =>
      dominanceDatasetSchema.parse({
        schemaVersion: 1,
        source: 'coingecko',
        fetchedAt: 'x',
        series: [{ date: '2026-07-26', btcDominancePct: 101, totalMcapUsd: 1 }],
      }),
    ).toThrow();
    // A series that starts before the M17 fields existed and gains them
    // partway through is the shape the committed file actually has, and will
    // keep having: accreted days are never rewritten, so there is nothing to
    // backfill the earlier ones from.
    expect(() =>
      dominanceDatasetSchema.parse({
        schemaVersion: 1,
        source: 'coingecko',
        fetchedAt: '2026-07-29T12:00:00.000Z',
        series: [
          { date: '2026-07-26', btcDominancePct: 55.8, totalMcapUsd: 2_420_000_000_000 },
          {
            date: '2026-07-29',
            btcDominancePct: 56.4,
            totalMcapUsd: 2_430_000_000_000,
            ethDominancePct: 12.3,
            stablecoinSharePct: 5.3,
            volume24hUsd: 98_000_000_000,
          },
        ],
      }),
    ).not.toThrow();
    // Mis-ordered accreted series must fail loudly, never trim silently.
    expect(() =>
      dominanceDatasetSchema.parse({
        schemaVersion: 1,
        source: 'coingecko',
        fetchedAt: 'x',
        series: [
          { date: '2026-07-26', btcDominancePct: 55, totalMcapUsd: 1 },
          { date: '2026-07-25', btcDominancePct: 55, totalMcapUsd: 1 },
        ],
      }),
    ).toThrow('not strictly ascending');
    expect(() =>
      stablecoinDatasetSchema.parse({
        schemaVersion: 1,
        source: 'defillama',
        fetchedAt: 'x',
        keepDays: 460,
        change30dPct: null,
        series: [
          { date: '2026-07-25', totalUsd: 1 },
          { date: '2026-07-26', totalUsd: 2 },
        ],
      }),
    ).not.toThrow();
  });
});

describe('sharePoints', () => {
  const base = { date: '2026-07-26', btcDominancePct: 55.8, totalMcapUsd: 2_400_000_000_000 };

  it('emits only the shares a day actually carried', () => {
    // The committed file genuinely looks like this: BTC reaches back to M5 and
    // the other two begin at M17, so the early days have one share and the
    // later ones three.
    expect(
      sharePoints([
        base,
        {
          ...base,
          date: '2026-07-29',
          ethDominancePct: 12.3,
          stablecoinSharePct: 5.3,
        },
      ]),
    ).toEqual([
      { date: '2026-07-26', pct: 55.8, share: 'BTC' },
      { date: '2026-07-29', pct: 55.8, share: 'BTC' },
      { date: '2026-07-29', pct: 12.3, share: 'ETH' },
      { date: '2026-07-29', pct: 5.3, share: 'stablecoins' },
    ]);
  });

  it('does not invent a zero for a share that was never captured', () => {
    // A zero would draw a line claiming ETH had no market share until the day
    // this shipped, which is a statement about the market rather than about
    // the data.
    expect(sharePoints([base]).map((p) => p.share)).toEqual(['BTC']);
  });

  it('keeps a genuine zero share, which is a reading and not a gap', () => {
    expect(sharePoints([{ ...base, ethDominancePct: 0 }]).at(-1)).toEqual({
      date: '2026-07-26',
      pct: 0,
      share: 'ETH',
    });
  });

  it('is empty for an empty series', () => {
    expect(sharePoints([])).toEqual([]);
  });
});

describe('turnoverPct', () => {
  it('reads volume against market cap, to 2 dp', () => {
    expect(
      turnoverPct({
        date: '2026-07-29',
        btcDominancePct: 55,
        totalMcapUsd: 2_000_000_000_000,
        volume24hUsd: 100_000_000_000,
      }),
    ).toBe(5);
  });

  it('is null when the volume was never captured, rather than zero', () => {
    expect(
      turnoverPct({ date: '2026-07-29', btcDominancePct: 55, totalMcapUsd: 2e12 }),
    ).toBeNull();
    expect(turnoverPct(undefined)).toBeNull();
  });

  it('keeps a real zero volume as zero', () => {
    expect(
      turnoverPct({
        date: '2026-07-29',
        btcDominancePct: 55,
        totalMcapUsd: 2e12,
        volume24hUsd: 0,
      }),
    ).toBe(0);
  });
});
