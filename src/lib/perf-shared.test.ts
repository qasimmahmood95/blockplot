import { describe, expect, it } from 'vitest';
import {
  captionOf,
  chartLabel,
  PERF_ASSETS,
  perfColor,
  perfDash,
  perfStartOptions,
  perfSwatch,
  toAssetSeries,
} from './perf-shared';
import type { AssetSeries, RebaseResult, RebasedSeries } from '../../pipeline/rebase';

const series = (asset: string, from: string, to: string): AssetSeries => {
  const rows: { date: string; value: number }[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    rows.push({ date: new Date(t).toISOString().slice(0, 10), value: 100 });
  }
  return { asset, rows };
};

describe('perfStartOptions', () => {
  const assets = [
    series('btc', '2016-01-01', '2026-07-30'),
    series('eth', '2019-01-01', '2026-07-30'),
  ];

  it('offers windows off the last close, plus a max all series share', () => {
    const opts = perfStartOptions(assets);
    expect(opts.map((o) => o.label)).toEqual(['1y', '3y', '5y', 'max']);
    // max is ETH's start, not BTC's: a chart with one line for three years and
    // then two is not the comparison this page is for.
    expect(opts.at(-1)?.start).toBe('2019-01-01');
  });

  it('selects 5y by default', () => {
    const selected = perfStartOptions(assets).filter((o) => o.selected);
    expect(selected.map((o) => o.label)).toEqual(['5y']);
  });

  it('drops a preset that would reach back further than max, not offer it twice', () => {
    // Both series start two years ago, so 3y and 5y would both clamp to the
    // same chart as max — three buttons drawing one thing.
    const shallow = [
      series('btc', '2024-08-01', '2026-07-30'),
      series('eth', '2024-08-01', '2026-07-30'),
    ];
    const opts = perfStartOptions(shallow);
    expect(opts.map((o) => o.label)).toEqual(['1y', 'max']);
    expect(new Set(opts.map((o) => o.start)).size).toBe(opts.length);
  });

  it('is empty when there is no shared start to offer', () => {
    expect(perfStartOptions([])).toEqual([]);
    expect(perfStartOptions([{ asset: 'x', rows: [] }])).toEqual([]);
  });
});

describe('captionOf', () => {
  const s = (asset: string, baseDate: string): RebasedSeries => ({
    asset,
    baseDate,
    baseValue: 1,
    finalIndex: 150,
    series: [],
  });
  const result = (over: Partial<RebaseResult> & { excluded?: string[] } = {}) => ({
    aligned: true,
    baseWeek: '2021-W30',
    baseWeekStart: '2021-07-26',
    baseDate: '2021-08-02',
    series: [s('btc', '2021-08-02')],
    excluded: [],
    ...over,
  });

  it('names the day when every series really is indexed on it', () => {
    expect(captionOf(result())).toBe('100 = each series on 2021-08-02');
  });

  it('names the week when the bases differ, rather than picking one', () => {
    // The weekly section puts BTC on Sundays and the S&P on Fridays, so no
    // shared day exists. Printing one asserted the S&P was 100 on a Sunday.
    expect(captionOf(result({ aligned: false }))).toBe(
      '100 = each series in the week of 2021-07-26',
    );
  });

  it('names one excluded series in the singular', () => {
    expect(captionOf(result({ excluded: ['eth'] }))).toBe(
      '100 = each series on 2021-08-02 · ETH begins later and is not shown',
    );
  });

  it('names several with a comma list and the plural', () => {
    expect(captionOf(result({ excluded: ['eth', 'gold', 'dxy'] }))).toBe(
      '100 = each series on 2021-08-02 · ETH, gold and DXY begin later and are not shown',
    );
  });
});

describe('toAssetSeries', () => {
  it('puts the series in display order regardless of file order', () => {
    const out = toAssetSeries({
      schemaVersion: 1,
      currency: 'usd',
      fetchedAt: 'x',
      dailyDays: 730,
      olderResolution: 'weekly-last',
      series: [
        { asset: 'gold', sourceSeries: 'GC=F', rows: [{ date: '2024-01-01', close: 2 }] },
        { asset: 'btc', sourceSeries: 'b', rows: [{ date: '2024-01-01', close: 1 }] },
      ],
    });
    expect(out.map((s) => s.asset)).toEqual(['btc', 'gold']);
    // close -> value, so rebase() reads one field name whatever the source.
    expect(out[0]?.rows[0]).toEqual({ date: '2024-01-01', value: 1 });
  });
});

describe('perfStartOptions weekly snapping', () => {
  const long = (asset: string, from: string): AssetSeries => {
    const rows: { date: string; value: number }[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse('2026-07-30T00:00:00Z'); t += 86_400_000) {
      rows.push({ date: new Date(t).toISOString().slice(0, 10), value: 100 });
    }
    return { asset, rows };
  };
  const assets = [long('btc', '2016-01-01'), long('eth', '2017-11-12')];

  it('snaps a preset in the weekly region to its ISO week Monday', () => {
    // Without this the window slid a day per refresh while the base could only
    // move a week, so headline figures stepped for no market reason.
    const opts = perfStartOptions(assets, 730);
    const five = opts.find((o) => o.label === '5y');
    expect(five?.start).toBe('2021-07-26');
    expect(new Date(`${five?.start}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('leaves a preset in the daily region alone', () => {
    const oneYear = perfStartOptions(assets, 730).find((o) => o.label === '1y');
    expect(oneYear?.start).toBe('2025-07-30');
  });

  it('never snaps max, which would exclude the series that defines it', () => {
    // Snapping max back to a Monday put it before ETH's first date, and the
    // built page dropped ETH from the five-asset comparison max exists for.
    const max = perfStartOptions(assets, 730).find((o) => o.label === 'max');
    expect(max?.start).toBe('2017-11-12');
  });

  it('snaps nothing when no daily window is given', () => {
    expect(perfStartOptions(assets).find((o) => o.label === '5y')?.start).toBe('2021-07-30');
  });
});

describe('perfColor and perfDash', () => {
  // Straight out of tokens.css. Duplicated deliberately: the point of this test
  // is that a change there cannot quietly drop a series below the floor, so it
  // has to fail when the two disagree.
  const TOKENS: Record<string, { light: string; dark: string }> = {
    '--accent': { light: '#bf4a08', dark: '#e97328' },
    '--cycle-1': { light: '#e69c62', dark: '#7f3f10' },
    '--cycle-2': { light: '#d47531', dark: '#a35415' },
    '--cycle-3': { light: '#bf4a08', dark: '#c9611c' },
    '--cycle-4': { light: '#93380a', dark: '#e97328' },
    '--ink': { light: '#221d19', dark: '#eae4dc' },
    '--ink-muted': { light: '#6e665e', dark: '#968c80' },
    '--line': { light: '#e2dbd1', dark: '#322c25' },
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
  const resolve = (value: string, theme: 'light' | 'dark'): string => {
    const token = /var\((--[a-z0-9-]+)\)/.exec(value)?.[1];
    return TOKENS[token ?? '']?.[theme] ?? '';
  };
  const surface = (theme: 'light' | 'dark'): string => TOKENS['--surface']?.[theme] ?? '';

  it('keeps every series at 3:1 or better against the surface, in both themes', () => {
    // The floor WCAG sets for graphical objects. Review measured the first
    // version at 2.17:1 for the S&P and 1.32:1 for DXY on `--line` — the
    // hairline token, indistinguishable from the gridlines it matches.
    for (const theme of ['light', 'dark'] as const) {
      for (const asset of PERF_ASSETS) {
        const c = contrast(resolve(perfColor(asset), theme), surface(theme));
        expect(c, `${asset} in ${theme} is ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('never gives a non-BTC series a colour that equals the accent in either theme', () => {
    // The ramp includes the accent as one of its own steps — cycle-3 in light,
    // cycle-4 in dark — which is how ETH and BTC shipped as the same hex on
    // /flows. Only BTC may resolve to it, because BTC is it.
    for (const theme of ['light', 'dark'] as const) {
      const accent = TOKENS['--accent']?.[theme];
      const matching = PERF_ASSETS.filter((a) => resolve(perfColor(a), theme) === accent);
      expect(matching, theme).toEqual(['btc']);
    }
  });

  it('separates the two series that share a colour by dash instead', () => {
    expect(perfColor('gold')).toBe(perfColor('dxy'));
    expect(perfDash('gold')).toBe('');
    expect(perfDash('dxy')).toBe('6,3');
  });

  it('gives every series a distinct colour-and-dash pair in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const keys = PERF_ASSETS.map((a) => `${resolve(perfColor(a), theme)}|${perfDash(a)}`);
      expect(new Set(keys).size, theme).toBe(PERF_ASSETS.length);
    }
  });

  it('renders a dashed swatch as a gradient and a solid one as the colour', () => {
    expect(perfSwatch('gold')).toBe('var(--ink-muted)');
    expect(perfSwatch('dxy')).toContain('repeating-linear-gradient');
  });
});

describe('chartLabel', () => {
  it('names the series, the range and the scale actually shown', () => {
    // It was a fixed string saying "log scale" and the build's default range, so
    // a screen-reader user pressing max and linear was told 5y and log.
    expect(chartLabel(['btc', 'sp500'], 'max', 'linear')).toBe(
      'Line chart of BTC, S&P 500 indexed to 100 at a shared start date, max range, linear scale',
    );
  });
});
