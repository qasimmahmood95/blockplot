import { describe, expect, it } from 'vitest';
import {
  holdingMatrix,
  holdingSummary,
  MIN_ANNUALISE_DAYS,
  yearAnchors,
  yearlyReturnsFromCloses,
  type HoldingCell,
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
    expect(stub?.days).toBe(31);
    expect(stub?.totalPct).toBe(25);
    expect(stub?.annualPct).toBeNull();
  });

  it('puts the cutoff at a year, tested on both sides of it', () => {
    // `expect(stub.days).toBeLessThan(MIN_ANNUALISE_DAYS)` compared the constant
    // with itself, so any cutoff between 32 and 365 passed — and the whole
    // `annualPct: null` design rests on this boundary being a year.
    expect(MIN_ANNUALISE_DAYS).toBe(365);
    const at = (from: string, to: string) =>
      holdingMatrix(yearAnchors(closes([[from, 100], [to, 200]])))[0];
    // 2021-01-01 → 2021-12-31 is 364 days: one short, and unrated.
    expect(at('2020-01-01', '2020-12-30')?.days).toBe(364);
    expect(at('2020-01-01', '2020-12-30')?.annualPct).toBeNull();
    expect(at('2020-01-01', '2020-12-31')?.days).toBe(365);
    expect(at('2020-01-01', '2020-12-31')?.annualPct).not.toBeNull();
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
    // The guard only bites when the unrated hold would otherwise win, so the
    // fixture has to make it win: a 31-day hold that trebles beats every annual
    // rate in the grid on `totalPct`, which is what the fallback would rank it by.
    const loaded = holdingMatrix(
      yearAnchors(closes([
        ['2019-11-30', 100],
        ['2019-12-31', 600],
        ['2020-12-31', 200],
      ])),
    );
    const stub = loaded.find((c) => c.buyYear === 2019 && c.sellYear === 2019);
    expect(stub?.annualPct).toBeNull();
    expect(stub?.totalPct).toBe(500);
    const summary = holdingSummary(loaded);
    expect(summary?.best.annualPct).not.toBeNull();
    // The stub's raw total beats every annual rate in the grid, so ranking on the
    // fallback would hand it the tile. It does not have a rate, so it cannot.
    expect(stub?.totalPct).toBeGreaterThan(summary?.best.annualPct ?? 0);
    expect(summary?.best.days).toBeGreaterThanOrEqual(MIN_ANNUALISE_DAYS);
  });

  it('finds the longest hold that still lost', () => {
    const summary = holdingSummary(cells);
    expect(summary?.longestLosing?.buyYear).toBe(2021);
    expect(summary?.longestLosing?.sellYear).toBe(2021);
  });

  it('picks the longest loss, not the first one it meets', () => {
    // The fixture above has exactly one losing hold, so the reduce never compares
    // two elements and reversing the comparison passed the whole suite. This one
    // falls three years running, so length actually decides.
    const falling = holdingMatrix(
      yearAnchors(closes([
        ['2018-12-31', 100],
        ['2019-12-31', 90],
        ['2020-12-31', 80],
        ['2021-12-31', 70],
      ])),
    );
    const cells = falling.filter((c) => c.totalPct < 0);
    const longest = holdingSummary(falling)?.longestLosing;
    expect(cells.length).toBeGreaterThan(2);
    expect(longest?.days).toBe(Math.max(...cells.map((c) => c.days)));
  });

  it('breaks a tie on length by taking the worse loss', () => {
    // Built directly rather than derived from prices, because the tie is the whole
    // point and a price fixture keeps producing near-ties instead. On the
    // committed data four holds sit at exactly 730 days — −42.76%, −42.48%,
    // −41.86% and −10.58% — and a plain `>` kept the first it met, which is the
    // third of the four, while the tile named it as though it were unique.
    const tied: HoldingCell[] = [
      { buyYear: 2018, sellYear: 2019, totalPct: -42.76, annualPct: -24.3, days: 730 },
      { buyYear: 2021, sellYear: 2022, totalPct: -42.48, annualPct: -24.1, days: 730 },
      { buyYear: 2014, sellYear: 2015, totalPct: -41.86, annualPct: -23.7, days: 730 },
      { buyYear: 2022, sellYear: 2023, totalPct: -10.58, annualPct: -5.4, days: 730 },
      { buyYear: 2016, sellYear: 2016, totalPct: -5, annualPct: -5, days: 366 },
    ];
    const longest = holdingSummary(tied)?.longestLosing;
    expect(longest?.days).toBe(730);
    expect(longest?.totalPct).toBe(-42.76);
    expect(longest?.buyYear).toBe(2018);
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
