import { describe, expect, it } from 'vitest';
import {
  addMonths,
  annualisedPct,
  changePct,
  cpiFor,
  cpiLagMonths,
  CPI_CANDIDATES,
  daysBetween,
  deflate,
  inflationPct,
  isFreshEnough,
  MAX_CPI_GAP_MONTHS,
  MAX_CPI_LAG_MONTHS,
  MAX_CPI_MISSING_SHARE,
  MIN_ANNUALISE_DAYS,
  monthOf,
  monthsBetween,
  realWindows,
  REAL_WINDOWS,
  toMonthlyCpi,
  WINDOW_START_TOLERANCE_DAYS,
  type CpiPoint,
} from './cpi';
import { CURRENCIES } from './currencies';

const csv = (id: string, rows: [string, string][]): string =>
  [`observation_date,${id}`, ...rows.map(([date, value]) => `${date},${value}`)].join('\n');

/** Twelve months of a index rising exactly 1% a month from 100. */
const RISING: CpiPoint[] = Array.from({ length: 12 }, (_, i) => ({
  month: `2024-${String(i + 1).padStart(2, '0')}`,
  index: 100 * Math.pow(1.01, i),
}));

describe('month arithmetic', () => {
  it('reads the month a date falls in', () => {
    expect(monthOf('2024-03-17')).toBe('2024-03');
    expect(monthOf('2024-03-01')).toBe('2024-03');
    expect(monthOf('2024-12-31')).toBe('2024-12');
  });

  it('adds months across year boundaries in both directions', () => {
    expect(addMonths('2024-01', 1)).toBe('2024-02');
    expect(addMonths('2024-12', 1)).toBe('2025-01');
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(addMonths('2024-06', -18)).toBe('2022-12');
    expect(addMonths('2024-06', 30)).toBe('2026-12');
  });

  it('counts whole months, signed', () => {
    expect(monthsBetween('2024-01', '2024-02')).toBe(1);
    expect(monthsBetween('2024-12', '2025-01')).toBe(1);
    expect(monthsBetween('2025-01', '2024-12')).toBe(-1);
    expect(monthsBetween('2020-03', '2024-03')).toBe(48);
    expect(monthsBetween('2024-03', '2024-03')).toBe(0);
  });

  it('counts whole days between dates, across a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
});

/** `months` consecutive monthly rows from `from`, rising 1% a month from 100. */
const risingCsv = (id: string, from: string, months: number, skip: string[] = []): string =>
  csv(
    id,
    Array.from({ length: months }, (_, i) => {
      const month = addMonths(from, i);
      return [`${month}-01`, String(100 * Math.pow(1.01, i))] as [string, string];
    }).filter(([date]) => !skip.includes(date.slice(0, 7))),
  );

describe('toMonthlyCpi', () => {
  it('keys observations by month', () => {
    const out = toMonthlyCpi(
      csv('CPIAUCSL', [
        ['2024-01-01', '308.417'],
        ['2024-02-01', '310.326'],
      ]),
      'CPIAUCSL',
    );
    expect(out.series).toEqual([
      { month: '2024-01', index: 308.417 },
      { month: '2024-02', index: 310.326 },
    ]);
    expect(out.missingMonths).toEqual([]);
  });

  it('rejects observations not dated on the first of the month', () => {
    expect(() =>
      toMonthlyCpi(
        csv('CPIAUCSL', [
          ['2024-01-01', '100'],
          ['2024-01-02', '100.1'],
        ]),
        'CPIAUCSL',
      ),
    ).toThrow(/expected monthly data/);
  });

  it('records a short gap rather than rejecting it', () => {
    // The real case: no CPIAUCSL observation for 2025-10, because that release
    // was cancelled rather than delayed. A rule forbidding gaps forbids the data.
    const out = toMonthlyCpi(risingCsv('CPIAUCSL', '2024-01', 60, ['2025-10']), 'CPIAUCSL');
    expect(out.missingMonths).toEqual(['2025-10']);
    expect(out.series.some((p) => p.month === '2025-10')).toBe(false);
    expect(out.series).toHaveLength(59);
  });

  it('rejects a gap long enough to be a coarser frequency', () => {
    expect(() =>
      toMonthlyCpi(
        csv('CPIAUCSL', [
          ['2024-01-01', '100'],
          ['2024-06-01', '101'],
        ]),
        'CPIAUCSL',
      ),
    ).toThrow(new RegExp(`beyond ${MAX_CPI_GAP_MONTHS}`));
  });

  it('rejects a quarterly series wearing a monthly id', () => {
    const quarterly = csv(
      'CPIAUCSL',
      Array.from({ length: 40 }, (_, i) => [`${addMonths('2016-01', i * 3)}-01`, '100'] as [string, string]),
    );
    // Each two-month hole is inside the run-length limit, so the share rule is
    // what catches it: two thirds of the covered span is unpublished.
    expect(() => toMonthlyCpi(quarterly, 'CPIAUCSL')).toThrow(
      new RegExp(`beyond ${MAX_CPI_MISSING_SHARE * 100}%`),
    );
  });

  it('tolerates one hole in a long series but not a spray of them', () => {
    expect(() => toMonthlyCpi(risingCsv('X', '2020-01', 60, ['2022-06']), 'X')).not.toThrow();
    const many = ['2021-02', '2021-08', '2022-03', '2022-09'];
    expect(() => toMonthlyCpi(risingCsv('X', '2020-01', 60, many), 'X')).toThrow(/thinned response/);
  });

  it('rejects an empty series', () => {
    // parseFredCsv gets there first; either way it throws rather than yielding
    // an index with no base to deflate to.
    expect(() => toMonthlyCpi(csv('CPIAUCSL', []), 'CPIAUCSL')).toThrow(/no data rows/);
  });

  it('rejects a header for another series, which is how a wrong id shows up', () => {
    expect(() => toMonthlyCpi(csv('SP500', [['2024-01-01', '100']]), 'CPIAUCSL')).toThrow(
      /unexpected header/,
    );
  });

  it('counts the "." FRED writes for a missing observation as an unpublished month', () => {
    // parseFredCsv drops "." rows, so the month is simply absent from the output.
    // For a step deflator that is a hole, and it has to be reported as one.
    // Long enough that one hole is inside the share limit — the same shape the
    // real series has, where a single cancelled release sits in eighty years of
    // observations.
    const rows = Array.from({ length: 60 }, (_, i) => {
      const month = addMonths('2020-01', i);
      return [`${month}-01`, month === '2022-06' ? '.' : '100'] as [string, string];
    });
    const out = toMonthlyCpi(csv('CPIAUCSL', rows), 'CPIAUCSL');
    expect(out.missingMonths).toEqual(['2022-06']);
    expect(out.series).toHaveLength(59);
  });

  it('rejects a descending or repeated month', () => {
    expect(() =>
      toMonthlyCpi(
        csv('CPIAUCSL', [
          ['2024-02-01', '100'],
          ['2024-02-01', '101'],
        ]),
        'CPIAUCSL',
      ),
    ).toThrow();
  });
});

describe('isFreshEnough', () => {
  const at = (month: string): CpiPoint[] => [{ month, index: 100 }];

  it('accepts an ordinary publication lag', () => {
    expect(isFreshEnough(at('2026-06'), '2026-07-30')).toBe(true);
    expect(isFreshEnough(at('2026-05'), '2026-07-30')).toBe(true);
  });

  it('rejects a retired series, which is what a 16-month lag is', () => {
    // Measured: GBRCPIALLMINMEI parses perfectly and last publishes 2025-03,
    // sixteen months behind. Only this check distinguishes it from a late one.
    expect(isFreshEnough(at('2025-03'), '2026-07-30')).toBe(false);
  });
});

describe('cpiLagMonths', () => {
  it('measures the gap between the last observation and the prices', () => {
    const cpi: CpiPoint[] = [{ month: '2026-06', index: 100 }];
    expect(cpiLagMonths(cpi, '2026-06-30')).toBe(0);
    expect(cpiLagMonths(cpi, '2026-07-01')).toBe(1);
    expect(cpiLagMonths(cpi, '2026-08-15')).toBe(2);
    expect(cpiLagMonths(cpi, '2027-01-05')).toBe(7);
  });

  it('has a threshold no ordinary release schedule can reach', () => {
    // CPI lands two to three weeks after the month it covers, so a run sees
    // M-1 at best and M-2 before the release. 3 is the first unreachable value.
    expect(MAX_CPI_LAG_MONTHS).toBe(3);
  });
});

describe('cpiFor', () => {
  it('returns the observation for the month a date falls in', () => {
    expect(cpiFor(RISING, '2024-01-15')).toBe(100);
    expect(cpiFor(RISING, '2024-02-29')).toBeCloseTo(101, 10);
  });

  it('returns null for an unpublished month rather than the last known value', () => {
    // The whole point: holding forward would deflate July by June's index and
    // nothing on the page could say by how much.
    expect(cpiFor(RISING, '2025-01-02')).toBeNull();
    expect(cpiFor(RISING, '2023-12-31')).toBeNull();
  });
});

describe('deflate', () => {
  const rows = [
    { date: '2024-01-15', price: 100 },
    { date: '2024-06-15', price: 100 },
    { date: '2024-12-15', price: 100 },
  ];

  it('restates prices in the base month’s money', () => {
    const out = deflate(rows, RISING, '2024-12');
    // A flat nominal price under 1%/month inflation loses purchasing power, so
    // in December money the January and June points are worth more than 100.
    expect(out.map((r) => r.date)).toEqual(['2024-01-15', '2024-06-15', '2024-12-15']);
    expect(out[0]?.real).toBeCloseTo(100 * Math.pow(1.01, 11), 3);
    expect(out[1]?.real).toBeCloseTo(100 * Math.pow(1.01, 6), 3);
    expect(out[2]?.real).toBe(100);
    expect(out.every((r) => r.nominal === 100)).toBe(true);
  });

  it('is exact when the base month is the row’s own month', () => {
    const out = deflate([{ date: '2024-05-20', price: 4321 }], RISING, '2024-05');
    expect(out[0]?.real).toBe(4321);
  });

  it('is invariant to the index’s base period', () => {
    // Both figures are ratios of two observations of one series, so rescaling
    // the whole index cannot move them. This is why a 1982-84=100 US series and
    // a 2015=100 UK series need no reconciling.
    const rescaled = RISING.map((p) => ({ ...p, index: p.index * 2.7183 }));
    expect(deflate(rows, rescaled, '2024-12')).toEqual(deflate(rows, RISING, '2024-12'));
  });

  it('drops days in unpublished months rather than carrying the last index', () => {
    const out = deflate(
      [
        { date: '2024-12-15', price: 100 },
        { date: '2025-01-15', price: 100 },
      ],
      RISING,
      '2024-12',
    );
    expect(out.map((r) => r.date)).toEqual(['2024-12-15']);
  });

  it('throws when the base month has no observation', () => {
    expect(() => deflate(rows, RISING, '2025-03')).toThrow(/base month 2025-03/);
  });

  it('rounds both figures to six significant figures', () => {
    const out = deflate([{ date: '2024-02-10', price: 1 / 3 }], RISING, '2024-12');
    expect(out[0]?.nominal).toBe(0.333333);
    // Significant figures, not decimal places: the same rule has to hold for a
    // 2010 BTC price near 0.05 and a 2026 one near 100,000.
    const sigDigits = (v: number): number =>
      String(v).replace(/[-.]/g, '').replace(/^0+/, '').replace(/0+$/, '').length;
    expect(sigDigits(out[0]?.real ?? 0)).toBeLessThanOrEqual(6);
    expect(deflate([{ date: '2024-02-10', price: 123456.789 }], RISING, '2024-12')[0]?.nominal).toBe(
      123457,
    );
  });
});

describe('changePct and annualisedPct', () => {
  it('measures simple change to two decimals', () => {
    expect(changePct(100, 250)).toBe(150);
    expect(changePct(100, 50)).toBe(-50);
    expect(changePct(3, 4)).toBe(33.33);
  });

  it('returns null for a non-positive start', () => {
    expect(changePct(0, 10)).toBeNull();
    expect(changePct(-1, 10)).toBeNull();
  });

  it('compounds to an annual rate', () => {
    // Doubling over four calendar years is 2^(1/4) - 1 = 18.92%.
    expect(annualisedPct(100, 200, 1461)).toBe(18.92);
    // Exactly a year is the simple change.
    expect(annualisedPct(100, 150, 365)).toBeCloseTo(50, 1);
  });

  it('refuses to annualise a span under the floor', () => {
    expect(annualisedPct(100, 140, 90)).toBeNull();
    expect(annualisedPct(100, 140, MIN_ANNUALISE_DAYS - 1)).toBeNull();
    expect(annualisedPct(100, 140, MIN_ANNUALISE_DAYS)).not.toBeNull();
  });

  it('has a floor loose enough for a 1y window anchored a few days late', () => {
    expect(MIN_ANNUALISE_DAYS).toBeLessThan(365);
    expect(MIN_ANNUALISE_DAYS).toBeGreaterThan(300);
  });
});

describe('inflationPct', () => {
  it('measures cumulative inflation between two dates’ months', () => {
    // Eleven 1% steps from January to December.
    expect(inflationPct(RISING, '2024-01-31', '2024-12-01')).toBeCloseTo(11.57, 2);
  });

  it('is null when either month is unpublished', () => {
    expect(inflationPct(RISING, '2023-12-01', '2024-06-01')).toBeNull();
    expect(inflationPct(RISING, '2024-06-01', '2025-06-01')).toBeNull();
  });
});

describe('realWindows', () => {
  /** Daily rows from `from` to `to` at a constant nominal price. */
  const daily = (from: string, to: string, price: number): { date: string; price: number }[] => {
    const out: { date: string; price: number }[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      out.push({ date: new Date(t).toISOString().slice(0, 10), price });
    }
    return out;
  };

  /** A CPI rising 1% a month from `from` for `months` months. */
  const rising = (from: string, months: number): CpiPoint[] =>
    Array.from({ length: months }, (_, i) => ({
      month: addMonths(from, i),
      index: 100 * Math.pow(1.01, i),
    }));

  it('reports nominal above real when inflation is positive', () => {
    const cpi = rising('2014-01', 150); // to 2026-06
    const series = deflate(daily('2014-01-01', '2026-07-20', 100), cpi, '2026-06');
    const windows = realWindows(series, cpi);
    const one = windows.find((w) => w.label === '1y');
    expect(one).toBeDefined();
    // A flat nominal price is 0% nominal and negative in real terms.
    expect(one?.nominalPct).toBe(0);
    expect(one?.realPct).toBeLessThan(0);
    expect(one?.inflationPct).toBeGreaterThan(0);
  });

  it('ends every window on the last deflatable day, not the last price day', () => {
    const cpi = rising('2014-01', 150); // last month 2026-06
    const series = deflate(daily('2014-01-01', '2026-07-20', 100), cpi, '2026-06');
    expect(series.at(-1)?.date).toBe('2026-06-30');
    for (const window of realWindows(series, cpi)) {
      expect(window.start < '2026-06-30').toBe(true);
    }
  });

  it('drops a window the data does not reach back to', () => {
    const cpi = rising('2020-01', 78); // to 2026-06
    const series = deflate(daily('2020-01-01', '2026-06-30', 100), cpi, '2026-06');
    const labels = realWindows(series, cpi).map((w) => w.label);
    // Six and a half years of data: 1y, 3y and 5y fit, 10y does not.
    expect(labels).toEqual(['1y', '3y', '5y', 'max']);
  });

  it('keeps a window whose anchor row lands a little late', () => {
    const cpi = rising('2020-01', 78);
    const all = daily('2020-01-01', '2026-06-30', 100);
    // Drop the fortnight around the 5y target so the anchor row is late but
    // within tolerance.
    const target = '2021-06-30';
    const gapped = all.filter(
      (r) => !(r.date >= target && daysBetween(target, r.date) < WINDOW_START_TOLERANCE_DAYS - 10),
    );
    const series = deflate(gapped, cpi, '2026-06');
    expect(realWindows(series, cpi).map((w) => w.label)).toContain('5y');
  });

  it('anchors on the first row at or after the target, never before it', () => {
    const cpi = rising('2014-01', 150);
    const series = deflate(daily('2014-01-01', '2026-06-30', 100), cpi, '2026-06');
    for (const window of realWindows(series, cpi)) {
      if (window.label === 'max') continue;
      const years = REAL_WINDOWS.find((w) => w.label === window.label)?.years ?? 0;
      // The span may be shorter than the nominal window (anchored late) but
      // never longer, which is the mis-anchoring this guards.
      expect(daysBetween(window.start, '2026-06-30')).toBeLessThanOrEqual(
        Math.round(years * 365.2425),
      );
    }
  });

  it('has no annualised figure for a max window under the floor', () => {
    const cpi = rising('2026-01', 6);
    const series = deflate(daily('2026-01-01', '2026-06-30', 100), cpi, '2026-06');
    const max = realWindows(series, cpi).find((w) => w.label === 'max');
    expect(max?.nominalPct).toBe(0);
    expect(max?.nominalCagrPct).toBeNull();
    expect(max?.realCagrPct).toBeNull();
  });

  it('returns nothing for an empty series', () => {
    expect(realWindows([], RISING)).toEqual([]);
  });
});

describe('deflator configuration', () => {
  it('offers at least one candidate per currency, each with an adjustment', () => {
    for (const currency of CURRENCIES) {
      const candidates = CPI_CANDIDATES[currency];
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate.id).toMatch(/^[A-Z0-9]+$/);
        expect(candidate.seasonalAdjustment).toMatch(/^(seasonally-adjusted|not-adjusted)$/);
      }
      expect(new Set(candidates.map((c) => c.id)).size).toBe(candidates.length);
    }
  });

  it('does not deflate two currencies by the same index', () => {
    // The premise of the GBP tree is that a sterling reader sees their own
    // experience; one shared deflator would contradict it. Checked across every
    // candidate, not just the preferred one, because a fallback that crossed the
    // trees would be the same error arriving later and quieter.
    const ids = CURRENCIES.flatMap((c) => CPI_CANDIDATES[c].map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
