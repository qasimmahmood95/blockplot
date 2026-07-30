import { describe, expect, it } from 'vitest';
import {
  holdingMatrix,
  holdingSummary,
  MIN_ANNUALISE_DAYS,
  yearAnchors,
  yearlyReturnsFromCloses,
} from './holding';
import { monthlyReturns } from './monthly';
import type { DailyPrice } from './schema';

/** A close on the last day of each named month, at the given price. */
const closes = (rows: [string, number][]): DailyPrice[] =>
  rows.map(([date, price]) => ({ date, price }));

/**
 * A partial 2019 then three whole years: doubling, halving, doubling.
 *
 * 2019 carries two months on purpose. With one it would be a zero-length year —
 * basis and close the same day — and `holdingMatrix` drops that hold rather than
 * dividing by nothing, which is right but makes a confusing fixture.
 */
const HISTORY = closes([
  ['2019-11-30', 80],
  ['2019-12-31', 100],
  ['2020-06-30', 150],
  ['2020-12-31', 200],
  ['2021-06-30', 150],
  ['2021-12-31', 100],
  ['2022-06-30', 150],
  ['2022-12-31', 200],
]);

describe('yearAnchors', () => {
  it('prices a year from the previous December and to its own last close', () => {
    const anchors = yearAnchors(HISTORY);
    expect(anchors.map((a) => a.year)).toEqual([2019, 2020, 2021, 2022]);
    const twenty = anchors.find((a) => a.year === 2020);
    expect(twenty).toMatchObject({
      basis: 100,
      basisDate: '2019-12-31',
      close: 200,
      closeDate: '2020-12-31',
    });
  });

  it('measures a partial first year from its own first close', () => {
    // The same exception `monthlyReturns` makes: the first month has no basis, so
    // it emits no return and the year starts from that month's close.
    const first = yearAnchors(HISTORY)[0];
    expect(first).toMatchObject({
      year: 2019,
      basis: 80,
      basisDate: '2019-11-30',
      close: 100,
      closeDate: '2019-12-31',
    });
  });

  it('uses the last close in a month, not the first', () => {
    const anchors = yearAnchors(
      closes([
        ['2019-12-01', 10],
        ['2019-12-31', 100],
        ['2020-12-31', 200],
      ]),
    );
    expect(anchors.find((a) => a.year === 2020)?.basis).toBe(100);
  });
});

describe('yearlyReturnsFromCloses', () => {
  it('is the direct ratio, not a product of rounded months', () => {
    expect(yearlyReturnsFromCloses(HISTORY)).toEqual([
      { year: 2019, returnPct: 25 },
      { year: 2020, returnPct: 100 },
      { year: 2021, returnPct: -50 },
      { year: 2022, returnPct: 100 },
    ]);
  });

  it('differs from compounding the rounded months, which is why it exists', () => {
    // This fixture reproduces the defect in miniature. 150 → 200 is +33.33% once
    // rounded to two decimals, and compounding 2020's two months from those gives
    // 99.995% where the closes say exactly 100%. On the real history the same
    // mechanism put 2013 at 5327.45% against a direct 5327.41%.
    const compounded = new Map<number, number>();
    for (const m of monthlyReturns(HISTORY)) {
      compounded.set(m.year, (compounded.get(m.year) ?? 1) * (1 + m.returnPct / 100));
    }
    const direct = new Map(yearlyReturnsFromCloses(HISTORY).map((y) => [y.year, y.returnPct]));
    expect(direct.get(2020)).toBe(100);
    expect(((compounded.get(2020) ?? 0) - 1) * 100).toBeCloseTo(99.995, 5);
    // Small, and the direct figure is the correct one — a year's return is a
    // ratio of two closes, not a product of display values.
    for (const [year, factor] of compounded) {
      expect(direct.get(year), `${year}`).toBeCloseTo((factor - 1) * 100, 1);
    }
  });
});

describe('holdingMatrix', () => {
  const cells = holdingMatrix(yearAnchors(HISTORY));
  const at = (buy: number, sell: number) =>
    cells.find((c) => c.buyYear === buy && c.sellYear === sell);

  it('is triangular: no hold sells before it buys', () => {
    expect(cells.every((c) => c.sellYear >= c.buyYear)).toBe(true);
    expect(at(2021, 2020)).toBeUndefined();
  });

  it('covers every buy/sell pair the history supports', () => {
    // Four years: 4 + 3 + 2 + 1.
    expect(cells).toHaveLength(10);
  });

  it('measures a multi-year hold end to end, not by compounding the years', () => {
    // 2020 doubled, 2021 halved, 2022 doubled: buying at the start of 2020 and
    // selling at the end of 2022 is exactly a double.
    expect(at(2020, 2022)?.totalPct).toBe(100);
    expect(at(2020, 2021)?.totalPct).toBe(0);
  });

  it('puts each year’s own return on the diagonal', () => {
    const yearly = new Map(yearlyReturnsFromCloses(HISTORY).map((y) => [y.year, y.returnPct]));
    for (const cell of cells.filter((c) => c.buyYear === c.sellYear)) {
      expect(cell.totalPct, `${cell.buyYear}`).toBe(yearly.get(cell.buyYear));
    }
  });

  it('annualises a hold of a year or more', () => {
    // Doubling over three calendar years (1096 days) is 2^(365.2425/1096) − 1.
    const three = at(2020, 2022);
    expect(three?.days).toBe(1096);
    expect(three?.annualPct).toBe(25.98);
    // 2020 is a leap year, so its own hold is 366 days and annualises just under
    // its total — exact, because a rate is a claim and 99.71 is the claim.
    expect(at(2020, 2020)?.days).toBe(366);
    expect(at(2020, 2020)?.totalPct).toBe(100);
    expect(at(2020, 2020)?.annualPct).toBe(99.71);
  });

  it('refuses to annualise a hold under a year', () => {
    // The partial first year is the only hold that can be this short, and
    // annualising it is where a "+7,701%/yr" headline came from.
    const stub = cells.find((c) => c.buyYear === 2019 && c.sellYear === 2019);
    expect(stub?.days).toBeLessThan(MIN_ANNUALISE_DAYS);
    expect(stub?.totalPct).toBe(25);
    expect(stub?.annualPct).toBeNull();
  });
});

describe('holdingSummary', () => {
  const cells = holdingMatrix(yearAnchors(HISTORY));

  it('counts the holds that ended above water', () => {
    const summary = holdingSummary(cells);
    expect(summary?.count).toBe(10);
    // 2021 is the only losing hold in this fixture.
    expect(summary?.positive).toBe(9);
  });

  it('ranks best and worst by the annual rate', () => {
    const summary = holdingSummary(cells);
    expect(summary?.best.annualPct).toBe(
      Math.max(...cells.map((c) => c.annualPct ?? -Infinity)),
    );
    expect(summary?.worst.buyYear).toBe(2021);
    expect(summary?.worst.sellYear).toBe(2021);
  });

  it('never ranks an un-annualised hold as best', () => {
    // 2019→2019 gained 25% in 31 days: extrapolated that is over +1,700%/yr,
    // which would take the tile. It has no rate, so it cannot. This is the
    // assertion that keeps the tile honest.
    const summary = holdingSummary(cells);
    expect(summary?.best.annualPct).not.toBeNull();
    expect(summary?.best.days).toBeGreaterThanOrEqual(MIN_ANNUALISE_DAYS);
  });

  it('finds the longest hold that still lost', () => {
    const summary = holdingSummary(cells);
    expect(summary?.longestLosing?.buyYear).toBe(2021);
    expect(summary?.longestLosing?.sellYear).toBe(2021);
  });

  it('reports no losing hold when every hold won', () => {
    const rising = holdingMatrix(
      yearAnchors(closes([
        ['2019-12-31', 100],
        ['2020-12-31', 200],
        ['2021-12-31', 300],
      ])),
    );
    expect(holdingSummary(rising)?.longestLosing).toBeNull();
  });

  it('reports the shortest hold length that never lost', () => {
    // One-year holds include 2021's -50%. Two-year holds are 2019→2020 (+150),
    // 2020→2021 (flat) and 2021→2022 (flat), none of them a loss.
    expect(holdingSummary(cells)?.safeYears).toBe(2);
  });

  it('reports no safe length when some hold of every length lost', () => {
    const falling = holdingMatrix(
      yearAnchors(closes([
        ['2019-12-31', 100],
        ['2020-12-31', 50],
        ['2021-12-31', 25],
      ])),
    );
    expect(holdingSummary(falling)?.safeYears).toBeNull();
  });

  it('is null for an empty matrix', () => {
    expect(holdingSummary([])).toBeNull();
  });
});
