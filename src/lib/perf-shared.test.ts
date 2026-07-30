import { describe, expect, it } from 'vitest';
import { captionOf, perfStartOptions, toAssetSeries } from './perf-shared';
import type { AssetSeries, RebasedSeries } from '../../pipeline/rebase';

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
  const s = (asset: string): RebasedSeries => ({
    asset,
    baseDate: '2021-08-02',
    baseValue: 1,
    finalIndex: 150,
    series: [],
  });

  it('names the base date the chart actually used', () => {
    expect(captionOf({ baseDate: '2021-08-02', series: [s('btc')], excluded: [] })).toBe(
      '100 = each series on 2021-08-02',
    );
  });

  it('names one excluded series in the singular', () => {
    expect(captionOf({ baseDate: '2021-08-02', series: [s('btc')], excluded: ['eth'] })).toBe(
      '100 = each series on 2021-08-02 · ETH begins later and is not shown',
    );
  });

  it('names several with a comma list and the plural', () => {
    expect(
      captionOf({ baseDate: '2021-08-02', series: [s('btc')], excluded: ['eth', 'gold', 'dxy'] }),
    ).toBe('100 = each series on 2021-08-02 · ETH, gold and DXY begin later and are not shown');
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
