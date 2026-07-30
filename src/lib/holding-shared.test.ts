import { describe, expect, it } from 'vitest';
import {
  cellViews,
  formatRate,
  formatTotal,
  heatClass,
  HEAT_STEPS,
  holdingTiles,
  holdDuration,
  MULTIPLE_ABOVE_PCT,
  partialYears,
} from './holding-shared';
import type { HoldingDataset } from '../../pipeline/schema';

const dataset = (over: Partial<HoldingDataset> = {}): HoldingDataset =>
  ({
    schemaVersion: 1,
    currency: 'usd',
    fetchedAt: '2026-07-30T00:00:00.000Z',
    asOf: '2026-07-30',
    minAnnualiseDays: 365,
    years: [
      { year: 2019, basisDate: '2019-11-30', closeDate: '2019-12-31', whole: false },
      { year: 2020, basisDate: '2019-12-31', closeDate: '2020-12-31', whole: true },
      { year: 2021, basisDate: '2020-12-31', closeDate: '2021-12-31', whole: true },
    ],
    cells: [
      { buyYear: 2019, sellYear: 2019, totalPct: 25, annualPct: null, days: 31 },
      { buyYear: 2019, sellYear: 2020, totalPct: 150, annualPct: 55.4, days: 397 },
      { buyYear: 2019, sellYear: 2021, totalPct: 25, annualPct: 10.8, days: 762 },
      { buyYear: 2020, sellYear: 2020, totalPct: 100, annualPct: 99.71, days: 366 },
      { buyYear: 2020, sellYear: 2021, totalPct: 0, annualPct: 0, days: 731 },
      { buyYear: 2021, sellYear: 2021, totalPct: -50, annualPct: -50.02, days: 365 },
    ],
    summary: {
      count: 6,
      positive: 5,
      best: { buyYear: 2020, sellYear: 2020, annualPct: 99.71 },
      worst: { buyYear: 2021, sellYear: 2021, annualPct: -50.02 },
      longestLosing: { buyYear: 2021, sellYear: 2021, totalPct: -50, days: 365 },
      safeYears: 2,
    },
    ...over,
  }) as HoldingDataset;

describe('formatRate', () => {
  it('is whole percent with an explicit sign', () => {
    expect(formatRate(99.71)).toBe('+100%');
    expect(formatRate(-50.02)).toBe('−50%');
    expect(formatRate(0)).toBe('+0%');
  });

  it('uses a minus sign, not a hyphen', () => {
    // The grid is tabular figures in a mono face; a hyphen there is narrower than
    // the digits it sits beside and breaks the column.
    expect(formatRate(-5)).toContain('−');
    expect(formatRate(-5)).not.toContain('-');
  });

  it('groups a rate large enough to need it', () => {
    expect(formatRate(5341.83)).toBe('+5,342%');
  });
});

describe('formatTotal', () => {
  it('is one decimal below the multiple threshold', () => {
    expect(formatTotal(150)).toBe('+150.0%');
    expect(formatTotal(-41.86)).toBe('−41.9%');
  });

  it('switches to a multiple above it, as /real-returns does', () => {
    expect(formatTotal(MULTIPLE_ABOVE_PCT - 0.1)).toBe('+9,999.9%');
    expect(formatTotal(MULTIPLE_ABOVE_PCT)).toBe('×101');
    expect(formatTotal(85_908_757.14)).toBe('×859,089');
  });
});

describe('heatClass', () => {
  it('steps on fixed thresholds, not on this dataset’s range', () => {
    expect(heatClass(0)).toBe('heat-pos-1');
    expect(heatClass(HEAT_STEPS[0] - 0.01)).toBe('heat-pos-1');
    expect(heatClass(HEAT_STEPS[0])).toBe('heat-pos-2');
    expect(heatClass(HEAT_STEPS[1])).toBe('heat-pos-3');
    expect(heatClass(HEAT_STEPS[2])).toBe('heat-pos-4');
    expect(heatClass(5341)).toBe('heat-pos-4');
  });

  it('is symmetric about zero', () => {
    // An asymmetric scale would make a −60% and a +60% look like different
    // magnitudes, which is the one thing a diverging scale exists to prevent.
    for (const value of [10, 30, 80, 200]) {
      expect(heatClass(-value).replace('neg', 'X')).toBe(heatClass(value).replace('pos', 'X'));
    }
  });

  it('gives an un-annualised hold no colour at all', () => {
    // It has no rate, so colouring it by anything would be colouring it by a
    // different quantity than every other cell.
    expect(heatClass(null)).toBe('');
  });
});

describe('holdDuration', () => {
  it('states days below a year and years above it', () => {
    expect(holdDuration(122)).toBe('122 days');
    expect(holdDuration(364)).toBe('364 days');
    expect(holdDuration(365)).toBe('1.0 years');
    expect(holdDuration(5799)).toBe('15.9 years');
  });

  it('never calls a sub-year hold a year', () => {
    // The built page read "1 year · … held 122 days, under a year" — one cell
    // contradicting itself — because the span came from the year numbers rather
    // than from the days.
    expect(holdDuration(122)).not.toContain('year');
  });
});

describe('cellViews', () => {
  const views = cellViews(dataset());

  it('keys every cell by buy and sell year', () => {
    expect(views.size).toBe(6);
    expect(views.get('2019-2020')?.label).toBe('+55%');
  });

  it('carries both figures and the span in the description', () => {
    expect(views.get('2019-2020')?.title).toBe(
      'Bought on 2019-11-30, sold end of 2020 · 1.1 years · +150.0% total · +55% a year',
    );
    expect(views.get('2020-2021')?.title).toContain('Bought start of 2020, sold end of 2021');
    expect(views.get('2020-2020')?.title).toContain('1.0 years ·');
  });

  it('names the date for a year that is not whole, rather than "end of" it', () => {
    // The built page said "sold end of 2026" for every hold in that column while
    // the close was 30 July — false, and false in the flattering direction, since
    // an unfinished year reads as a finished one.
    const dated = cellViews(
      dataset({
        years: [
          { year: 2019, basisDate: '2019-11-30', closeDate: '2019-12-31', whole: false },
          { year: 2020, basisDate: '2019-12-31', closeDate: '2020-12-31', whole: true },
          { year: 2021, basisDate: '2020-12-31', closeDate: '2021-07-30', whole: false },
        ],
      } as Partial<HoldingDataset>),
    );
    expect(dated.get('2020-2021')?.title).toContain('sold on 2021-07-30');
    expect(dated.get('2020-2021')?.title).not.toContain('end of 2021');
  });

  it('lists the years that are not whole', () => {
    expect(partialYears(dataset())).toEqual([2019]);
  });

  it('says why a cell has no rate rather than leaving it blank', () => {
    const stub = views.get('2019-2019');
    expect(stub?.label).toBe('—');
    expect(stub?.heat).toBe('');
    expect(stub?.title).toContain('31 days');
    expect(stub?.title).toContain('+25.0% total');
    expect(stub?.title).toContain('no annual rate, under a year');
    // And never both a day count and a year count for the same hold.
    expect(stub?.title).not.toMatch(/\d+ years/);
  });
});

describe('holdingTiles', () => {
  const tiles = holdingTiles(dataset());

  it('leads with the shortest hold that never lost', () => {
    expect(tiles[0]?.label).toBe('shortest hold never down');
    expect(tiles[0]?.value).toBe('2y');
    expect(tiles[0]?.sub).toBe('across 2019–2021');
    expect(tiles[0]?.tone).toBe('up');
  });

  it('states the base rate beside it', () => {
    // "Every 2-year hold was up" is worth little without "and 1 of 6 was not".
    expect(tiles[1]?.value).toBe('5/6');
    expect(tiles[1]?.sub).toBe('1 ended down');
  });

  it('names the best and worst holds by year', () => {
    expect(tiles[2]?.value).toBe('+100%');
    expect(tiles[2]?.sub).toBe('a year · bought 2020, sold 2020');
    expect(tiles[3]?.value).toBe('−50%');
    expect(tiles[3]?.sub).toBe('a year · longest loss 2021–2021, −50.0%');
  });

  it('says so plainly when no hold length was ever safe', () => {
    const never = dataset({
      summary: { ...dataset().summary, safeYears: null },
    } as Partial<HoldingDataset>);
    expect(holdingTiles(never)[0]?.value).toBe('—');
    expect(holdingTiles(never)[0]?.sub).toBe('every hold length includes a loss');
    expect(holdingTiles(never)[0]?.tone).toBe('');
  });

  it('falls back to the worst hold’s own years when nothing lost', () => {
    const clean = dataset({
      summary: { ...dataset().summary, longestLosing: null, positive: 6 },
    } as Partial<HoldingDataset>);
    expect(holdingTiles(clean)[3]?.sub).toBe('a year · bought 2021, sold 2021');
    expect(holdingTiles(clean)[1]?.sub).toBe('0 ended down');
  });
});
