import { describe, expect, it } from 'vitest';
import {
  captionOf,
  chartLabel,
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
    expect(one?.tone).toBe('up');
    // A max-window return is stated as a multiple: "+700000.0%" is six digits to
    // count before the decimal point means anything.
    expect(max?.value).toBe('×7,001');
    expect(max?.sub).toContain('nominal ×10,001');
  });

  it('keeps the annualised rate a percentage even when the total is a multiple', () => {
    // The rate is the readable half of a max window — 130%/yr is a figure, where
    // the total it compounds to is a phone number.
    const [, max] = realTiles(dataset());
    expect(max?.sub).toContain('+110.0%/yr real');
  });

  it('switches to a multiple only above the threshold', () => {
    const near = (value: number): string | undefined =>
      realTiles(
        dataset({
          windows: [{ ...dataset().windows[0]!, nominalPct: value, realPct: value }],
        }),
      )[0]?.value;
    expect(near(MULTIPLE_ABOVE_PCT - 0.1)).toBe('+9999.9%');
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
});

describe('realColor', () => {
  // Straight out of tokens.css, duplicated for the same reason
  // perf-shared.test.ts duplicates it: a change there must fail here rather
  // than quietly drop a line below the contrast floor.
  const TOKENS: Record<string, { light: string; dark: string }> = {
    '--accent': { light: '#bf4a08', dark: '#e97328' },
    '--ink': { light: '#221d19', dark: '#eae4dc' },
    '--surface': { light: '#fcfaf7', dark: '#1e1a15' },
  };
  const lum = (hex: string): number => {
    const f = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (f[0] ?? 0) + 0.7152 * (f[1] ?? 0) + 0.0722 * (f[2] ?? 0);
  };
  const contrast = (a: string, b: string): number => {
    const pair = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((pair[0] ?? 0) + 0.05) / ((pair[1] ?? 0) + 0.05);
  };
  const resolve = (value: string, theme: 'light' | 'dark'): string =>
    TOKENS[/var\((--[a-z0-9-]+)\)/.exec(value)?.[1] ?? '']?.[theme] ?? '';

  it('keeps both lines at 3:1 or better against the surface in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const line of REAL_LINES) {
        const c = contrast(resolve(realColor(line), theme), TOKENS['--surface']?.[theme] ?? '');
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

  it('draws the dashed line’s swatch dashed too', () => {
    expect(realSwatch('nominal')).toBe(realColor('nominal'));
    expect(realSwatch('real')).toContain('repeating-linear-gradient');
    expect(realSwatch('real')).toContain(realColor('real'));
  });
});

describe('realFormatters', () => {
  it('is compact on the axis and exact in the tooltip', () => {
    const { tick, tip } = realFormatters('usd');
    expect(tick(1200)).toBe('$1.2K');
    expect(tick(72_431)).toBe('$72.4K');
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
