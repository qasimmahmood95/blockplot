import { describe, expect, it } from 'vitest';
import {
  captionOf,
  chartLabel,
  compactDigits,
  monthLabel,
  MULTIPLE_ABOVE_PCT,
  REAL_LINES,
  realColor,
  realDash,
  realFormatters,
  realPoints,
  realRangeOptions,
  realSwatch,
  realTiles,
} from './real-shared';
import { contrast, readTokens, resolveToken, type Theme } from './tokens.test-helper';
import type { RealReturnsDataset } from '../../pipeline/schema';

const dataset = (over: Partial<RealReturnsDataset> = {}): RealReturnsDataset =>
  ({
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
      missingMonths: [],
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
      {
        label: 'max',
        start: '2010-08-22',
        nominalPct: 1_000_000,
        realPct: 700_000,
        nominalCagrPct: 118,
        realCagrPct: 110,
        inflationPct: 48,
      },
    ],
    series: [
      { date: '2010-08-22', nominal: 0.07, real: 0.1 },
      { date: '2025-06-30', nominal: 60_000, real: 61_300 },
      { date: '2026-06-30', nominal: 72_000, real: 72_000 },
    ],
    ...over,
  }) as RealReturnsDataset;

describe('monthLabel', () => {
  it('names the month', () => {
    expect(monthLabel('2026-06')).toBe('June 2026');
    expect(monthLabel('1947-01')).toBe('January 1947');
    expect(monthLabel('2025-12')).toBe('December 2025');
  });
});

describe('realRangeOptions', () => {
  it('takes its starts from the measured windows rather than recomputing them', () => {
    // The tiles state a return per window and the chart draws one of them, so a
    // start derived here from the thinned rows would put the chart's span a few
    // days from the tile's — small, invisible, and enough to make a reader
    // distrust both numbers.
    const options = realRangeOptions(dataset());
    expect(options.map((o) => o.label)).toEqual(['1y', 'max']);
    expect(options.map((o) => o.start)).toEqual(['2025-06-30', '2010-08-22']);
  });

  it('falls back to the deepest window, not the last one listed', () => {
    // `at(-1)` agreed with "deepest" only because REAL_WINDOWS is listed
    // shortest-first; reversed, it selected the shortest window and the test that
    // named this behaviour still passed.
    const reversed = dataset({ windows: [...dataset().windows].reverse() });
    expect(realRangeOptions(reversed).find((o) => o.selected)?.label).toBe('max');
  });

  it('prefers 5y when it exists and falls back to the deepest window', () => {
    const withFive = dataset({
      windows: [
        ...dataset().windows.slice(0, 1),
        { ...dataset().windows[0]!, label: '5y', start: '2021-06-30' },
        ...dataset().windows.slice(1),
      ],
    });
    expect(realRangeOptions(withFive).find((o) => o.selected)?.label).toBe('5y');
    expect(realRangeOptions(dataset()).find((o) => o.selected)?.label).toBe('max');
  });
});

describe('captionOf', () => {
  it('states the base month, the deflator and where both lines stop', () => {
    expect(captionOf(dataset())).toBe(
      'real values in June 2026 money · deflator CPIAUCSL, published through June 2026 · ' +
        'both lines end 2026-06-30, 30d behind the last price (2026-07-30)',
    );
  });

  it('says so plainly when the deflator reaches the last price day', () => {
    const caught = dataset({ pricesThrough: '2026-06-30' });
    expect(captionOf(caught)).toContain('both lines end 2026-06-30, the last price');
    expect(captionOf(caught)).not.toContain('behind');
  });

  it('measures the lag from the file rather than describing it', () => {
    // "the CPI release lags" is a fact about the world; a day count is a fact
    // about this file, and only the second one goes stale visibly.
    expect(captionOf(dataset({ pricesThrough: '2026-08-15' }))).toContain('46d behind');
  });
});

describe('chartLabel', () => {
  it('carries the pressed range and scale, not the build defaults', () => {
    expect(chartLabel('max', 'linear')).toBe(
      "Line chart of BTC's nominal and inflation-adjusted price, max range, linear scale",
    );
  });
});

describe('realTiles', () => {
  it('leads with the real figure and carries nominal and CPI underneath', () => {
    const [one, max] = realTiles(dataset());
    expect(one?.label).toBe('1y real');
    expect(one?.value).toBe('+17.5%');
    expect(one?.sub).toBe('nominal +20.0% · CPI +2.1% · +17.5%/yr real');
    // Grouped on both sides of the threshold, so a tile row does not read
    // "+8473.6%" over a neighbour reading "×859,089".
    expect(realTiles(dataset({ windows: [{ ...dataset().windows[0]!, realPct: 8473.6 }] }))[0]
      ?.value).toBe('+8,473.6%');
    expect(one?.tone).toBe('up');
    // A max-window return is stated as a multiple: "+700000.0%" is six digits to
    // count before the decimal point means anything.
    expect(max?.value).toBe('×7,001');
    expect(max?.sub).toContain('nominal ×10,001');
  });

  it('keeps the annualised rate a percentage even when the rate itself is huge', () => {
    // The rate is the readable half of a deep window — 130%/yr is a figure where
    // the total it compounds to is a phone number. This passed for one commit on
    // the strength of a modest fixture: the rate went through the same formatter
    // as the total, so a large enough CAGR rendered "×101/yr real".
    expect(realTiles(dataset())[1]?.sub).toContain('+110.0%/yr real');
    const huge = dataset({
      windows: [{ ...dataset().windows[1]!, realCagrPct: MULTIPLE_ABOVE_PCT + 1 }],
    });
    // The nominal total on the same tile is still a multiple; it is only the rate
    // clause that must stay a percentage.
    const sub = realTiles(huge)[0]?.sub ?? '';
    expect(sub).toContain('+10,001.0%/yr real');
    expect(sub.split('·').at(-1)).not.toContain('×');
  });

  it('switches to a multiple only above the threshold', () => {
    const near = (value: number): string | undefined =>
      realTiles(
        dataset({
          windows: [{ ...dataset().windows[0]!, nominalPct: value, realPct: value }],
        }),
      )[0]?.value;
    expect(near(MULTIPLE_ABOVE_PCT - 0.1)).toBe('+9,999.9%');
    expect(near(MULTIPLE_ABOVE_PCT)).toBe('×101');
  });

  it('marks a negative real return down even when nominal is positive', () => {
    // The case the page exists for: a gain that is not a gain.
    const eroded = dataset({
      windows: [
        {
          label: '1y',
          start: '2025-06-30',
          nominalPct: 1.5,
          realPct: -1.2,
          nominalCagrPct: 1.5,
          realCagrPct: -1.2,
          inflationPct: 2.7,
        },
      ],
    });
    const [tile] = realTiles(eroded);
    expect(tile?.value).toBe('-1.2%');
    expect(tile?.tone).toBe('down');
  });

  it('omits the annualised clause where the pipeline returned null', () => {
    const short = dataset({
      windows: [
        {
          label: 'max',
          start: '2026-01-02',
          nominalPct: 4,
          realPct: 3,
          nominalCagrPct: null,
          realCagrPct: null,
          inflationPct: 1,
        },
      ],
    });
    expect(realTiles(short)[0]?.sub).toBe('nominal +4.0% · CPI +1.0%');
  });

  it('renders an em dash rather than NaN for a missing figure', () => {
    const missing = dataset({
      windows: [
        {
          label: '1y',
          start: '2025-06-30',
          nominalPct: null,
          realPct: null,
          nominalCagrPct: null,
          realCagrPct: null,
          inflationPct: null,
        },
      ],
    });
    const [tile] = realTiles(missing);
    expect(tile?.value).toBe('—');
    expect(tile?.sub).toBe('nominal — · CPI —');
    expect(tile?.tone).toBe('');
  });
});

describe('realPoints', () => {
  it('emits both lines from the start date, in draw order', () => {
    const points = realPoints(dataset().series, '2025-06-30');
    expect(points.map((p) => p.line)).toEqual(['nominal', 'nominal', 'real', 'real']);
    expect(points.map((p) => p.value)).toEqual([60_000, 72_000, 61_300, 72_000]);
    expect(points[0]?.date.toISOString().slice(0, 10)).toBe('2025-06-30');
  });

  it('drops nothing when the start precedes the series', () => {
    expect(realPoints(dataset().series, '1970-01-01')).toHaveLength(6);
  });

  it('breaks each line at an unpublished month instead of joining across it', () => {
    // Verified on the built page: the USD chart draws two subpaths per line at the
    // October 2025 hole, the GBP one draws a single subpath because ONS D7BT has
    // none.
    const points = realPoints(dataset().series, '1970-01-01', ['2020-05']);
    const nominal = points.filter((p) => p.line === 'nominal');
    expect(nominal).toHaveLength(4);
    const breakAt = nominal.findIndex((p) => !Number.isFinite(p.value));
    expect(breakAt).toBe(1);
    // Ordered, so the break splits the segment it belongs to rather than the last
    // one — appending it without sorting was the bug this pins.
    expect(nominal.map((p) => p.date.toISOString().slice(0, 10))).toEqual([
      '2010-08-22',
      '2020-05-15',
      '2025-06-30',
      '2026-06-30',
    ]);
  });

  it('ignores a missing month before the drawn range', () => {
    const points = realPoints(dataset().series, '2025-06-30', ['2020-05']);
    expect(points.every((p) => Number.isFinite(p.value))).toBe(true);
  });
});

describe('realColor', () => {
  // Read from tokens.css, not copied from it. The copied table was justified by a
  // comment saying a change to the stylesheet had to fail here — it did not,
  // because nothing in the repo read the stylesheet.
  const TOKENS = readTokens();
  const resolve = (value: string, theme: Theme): string => resolveToken(value, theme, TOKENS);
  const surface = (theme: Theme): string => TOKENS['--surface']?.[theme] ?? '';

  it('reads the tokens it measures from the stylesheet', () => {
    // Guards the guard: a rename or a restructure of tokens.css must fail loudly
    // here rather than silently resolve every colour to an empty string, which
    // would make every contrast assertion below vacuous.
    for (const theme of ['light', 'dark'] as const) {
      expect(surface(theme), theme).toMatch(/^#[0-9a-f]{6}$/i);
      for (const line of REAL_LINES) expect(resolve(realColor(line), theme)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(resolve('var(--accent)', 'light')).not.toBe(resolve('var(--accent)', 'dark'));
  });

  it('keeps both lines at 3:1 or better against the surface in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const line of REAL_LINES) {
        const c = contrast(resolve(realColor(line), theme), surface(theme));
        expect(c, `${line} in ${theme} is ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('separates the two lines by something other than colour where colour is weak', () => {
    // Measured: `--accent` against `--ink` is 4.19:1 in light and only 2.39:1 in
    // dark. These two lines overlap for the whole recent history, so in dark mode
    // colour alone would be carrying the distinction below the 3:1 floor. Whenever
    // that is true the pair must differ in dash as well — which is why real is
    // dashed, and this is the assertion that keeps it that way.
    for (const theme of ['light', 'dark'] as const) {
      const [a, b] = REAL_LINES.map((line) => resolve(realColor(line), theme));
      expect(a, theme).not.toBe(b);
      if (contrast(a ?? '', b ?? '') < 3) {
        expect(realDash('nominal'), theme).not.toBe(realDash('real'));
      }
    }
  });

  it('is the pair contrast that makes the dash necessary, not a preference', () => {
    // Pinning the measurement, so a token change that lifts the dark pair above
    // 3:1 shows up here rather than leaving the comment above wrong.
    const dark = REAL_LINES.map((line) => resolve(realColor(line), 'dark'));
    expect(contrast(dark[0] ?? '', dark[1] ?? '')).toBeCloseTo(2.39, 1);
  });

  it('draws the dashed line’s swatch dashed too, from the same pattern', () => {
    expect(realSwatch('nominal')).toBe(realColor('nominal'));
    expect(realSwatch('real')).toBe(
      'repeating-linear-gradient(90deg, var(--ink) 0 5px, transparent 5px 8px)',
    );
    // Derived, not written twice: changing the dash moves the swatch with it.
    expect(realSwatch('real')).toContain(`0 ${realDash('real').split(',')[0]}px`);
  });
});

describe('compactDigits', () => {
  it('is the arithmetic Intl could not be trusted with', () => {
    // Measured: `Intl` with style:'currency' AND notation:'compact' disagrees
    // between Node ("$20.0K", "$105.0", "$0.0") and Chromium ("$20K", "$105",
    // "$0"). The build draws the axis in one and the first hover redraws it in
    // the other, so the ticks moved under the cursor. These are plain string
    // operations, identical everywhere.
    expect(compactDigits(20_000)).toBe('20K');
    expect(compactDigits(1200)).toBe('1.2K');
    expect(compactDigits(72_431)).toBe('72.4K');
    expect(compactDigits(1_500_000)).toBe('1.5M');
    expect(compactDigits(2e9)).toBe('2B');
    expect(compactDigits(105)).toBe('105');
    expect(compactDigits(4.5)).toBe('4.50');
  });

  it('keeps a sub-unit price legible, where both runtimes render $0', () => {
    // BTC's first committed close. A log axis whose bottom three ticks all read
    // "$0" says the early history was worthless.
    expect(compactDigits(0.0451)).toBe('0.045');
    expect(compactDigits(0.87)).toBe('0.87');
    expect(compactDigits(0)).toBe('0');
  });

  it('handles negatives without losing the sign', () => {
    expect(compactDigits(-20_000)).toBe('-20K');
    expect(compactDigits(-0.0451)).toBe('-0.045');
  });
});

describe('realFormatters', () => {
  it('is compact on the axis and exact in the tooltip', () => {
    const { tick, tip } = realFormatters('usd');
    expect(tick(1200)).toBe('$1.2K');
    expect(tick(72_431)).toBe('$72.4K');
    expect(tick(0.0451)).toBe('$0.045');
    expect(tip(72_431)).toBe('$72,431');
  });

  it('keeps cents on a sub-unit price, where the exact format would read $1', () => {
    // The early history: BTC at $0.87 in 2011. A tooltip reading "$1" there is
    // wrong by 15% and looks like a rounding choice rather than an error.
    const { tip } = realFormatters('usd');
    expect(tip(0.87)).toBe('$0.87');
    expect(tip(0.0451)).not.toBe('$0');
  });

  it('follows the currency', () => {
    expect(realFormatters('gbp').tip(72_431)).toBe('£72,431');
  });
});
