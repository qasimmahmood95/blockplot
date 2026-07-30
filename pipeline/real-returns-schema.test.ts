/**
 * The real-returns schema's own refinements.
 *
 * Written because it had none. Review found every branch here unexercised —
 * including the one `run.ts` credits with catching a shipped bug — which is a bad
 * place for a blind spot: these checks exist precisely to catch a file whose
 * individual figures all look reasonable and whose claims about itself are false.
 */
import { describe, expect, it } from 'vitest';
import { realReturnsDatasetSchema } from './schema';

/** A document that validates, which every case below breaks in exactly one way. */
const doc = (): Record<string, unknown> => ({
  schemaVersion: 1,
  currency: 'usd',
  fetchedAt: '2026-07-30T00:00:00.000Z',
  asOf: '2026-06-30',
  pricesThrough: '2026-07-30',
  deflator: {
    source: 'fred',
    sourceSeries: 'CPIAUCSL',
    seasonalAdjustment: 'seasonally-adjusted',
    baseMonth: '2026-06',
    firstMonth: '1947-01',
    lastMonth: '2026-06',
    lagMonths: 1,
    maxLagMonths: 3,
    missingMonths: ['2025-10'],
  },
  dailyDays: 730,
  olderResolution: 'weekly-last',
  minAnnualiseDays: 360,
  windows: [
    {
      label: '1y',
      start: '2025-06-30',
      nominalPct: 20,
      realPct: 17.5,
      nominalCagrPct: 20,
      realCagrPct: 17.5,
      inflationPct: 2.1,
    },
  ],
  series: [
    { date: '2024-06-30', nominal: 40_000, real: 42_000 },
    { date: '2025-06-30', nominal: 60_000, real: 61_300 },
    { date: '2026-06-30', nominal: 72_000, real: 72_000 },
  ],
});

const parse = (over: (d: ReturnType<typeof doc>) => void): { ok: boolean; message: string } => {
  const d = doc();
  over(d);
  const result = realReturnsDatasetSchema.safeParse(d);
  return {
    ok: result.success,
    message: result.success ? '' : result.error.issues.map((i) => i.message).join(' | '),
  };
};

describe('realReturnsDatasetSchema', () => {
  it('accepts the shape the pipeline writes', () => {
    expect(realReturnsDatasetSchema.safeParse(doc()).success).toBe(true);
  });

  it('refuses an asOf that is not the last day of the series', () => {
    const { ok, message } = parse((d) => {
      d.asOf = '2026-06-29';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/not the last day of the series/);
  });

  it('refuses an asOf later than the prices it was cut from', () => {
    const { ok, message } = parse((d) => {
      d.pricesThrough = '2026-06-01';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/later than pricesThrough/);
  });

  it('refuses a series running past the last published month', () => {
    const { ok, message } = parse((d) => {
      (d.deflator as Record<string, unknown>).lastMonth = '2026-05';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/past the last published month/);
  });

  it('refuses a base month the deflator never published', () => {
    // The check the comment always claimed and the range tests never made: a month
    // inside `missingMonths` sits comfortably between first and last, and scales
    // every real figure by a number that does not exist.
    const { ok, message } = parse((d) => {
      (d.deflator as Record<string, unknown>).baseMonth = '2025-10';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/one of the unpublished months/);
  });

  it('refuses a base month outside the published range', () => {
    expect(
      parse((d) => {
        (d.deflator as Record<string, unknown>).baseMonth = '2026-07';
      }).message,
    ).toMatch(/beyond the last published month/);
    expect(
      parse((d) => {
        (d.deflator as Record<string, unknown>).firstMonth = '2026-06';
        (d.deflator as Record<string, unknown>).baseMonth = '2026-06';
        (d.series as { date: string }[]).forEach(() => undefined);
      }).ok,
    ).toBe(true);
  });

  it('refuses a deflator staler than its own stated threshold', () => {
    const { ok, message } = parse((d) => {
      (d.deflator as Record<string, unknown>).lagMonths = 4;
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/beyond 3/);
  });

  it('refuses a window anchored on a date the series does not contain', () => {
    // The case a range check misses. `2025-06-15` is inside the series' span and
    // is not one of its rows: measured on the committed file, the 3y, 5y and 10y
    // anchors were all of this shape when the pipeline measured before thinning,
    // and only the max window — which fell outside the range — was caught.
    const { ok, message } = parse((d) => {
      (d.windows as { start: string }[])[0]!.start = '2025-06-15';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/not a row in the series/);
  });

  it('refuses a window that does not end before the series does', () => {
    const { ok, message } = parse((d) => {
      (d.windows as { start: string }[])[0]!.start = '2026-06-30';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/not before asOf/);
  });

  it('refuses two points in one ISO week in the weekly section', () => {
    // `olderResolution` is otherwise a string nothing verifies — the same hole the
    // benchmark history schema closed after an ISO-week helper bug shipped.
    const { ok, message } = parse((d) => {
      (d.series as { date: string; nominal: number; real: number }[]).unshift(
        { date: '2020-01-06', nominal: 8000, real: 9000 },
        { date: '2020-01-08', nominal: 8100, real: 9100 },
      );
      (d.windows as { start: string }[])[0]!.start = '2025-06-30';
    });
    expect(ok).toBe(false);
    expect(message).toMatch(/more than one point in ISO week/);
  });

  it('refuses a series that is not ascending', () => {
    const { ok } = parse((d) => {
      (d.series as { date: string }[])[2]!.date = '2024-01-01';
      d.asOf = '2024-01-01';
    });
    expect(ok).toBe(false);
  });

  it('refuses a non-positive price on either leg', () => {
    expect(
      parse((d) => {
        (d.series as { real: number }[])[0]!.real = 0;
      }).ok,
    ).toBe(false);
    expect(
      parse((d) => {
        (d.series as { nominal: number }[])[0]!.nominal = -1;
      }).ok,
    ).toBe(false);
  });
});
