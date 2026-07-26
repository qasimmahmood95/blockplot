import { describe, expect, it } from 'vitest';
import {
  accreteDominance,
  parseStablecoinChart,
  stablecoinChange30dPct,
  trimStablecoins,
} from './flows';
import { dominanceDatasetSchema, stablecoinDatasetSchema } from './schema';

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
    // No entry at/before the target -> null.
    expect(
      stablecoinChange30dPct([
        { date: '2024-02-15', totalUsd: 100 },
        { date: '2024-03-01', totalUsd: 110 },
      ]),
    ).toBeNull();
  });
});

describe('trimStablecoins', () => {
  it('keeps only entries within N calendar days of the last entry', () => {
    const series = [
      { date: '2024-12-28', totalUsd: 1 },
      { date: '2024-12-29', totalUsd: 2 },
      { date: '2024-12-30', totalUsd: 3 },
      { date: '2024-12-31', totalUsd: 4 },
    ];
    expect(trimStablecoins(series, 2)).toEqual(series.slice(2));
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
