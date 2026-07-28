import { describe, expect, it } from 'vitest';
import { crosshairAnchors, isoDay, type CrosshairRow } from './crosshair';

const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('crosshairAnchors', () => {
  it('puts every series at one x into a single tooltip', () => {
    // The whole point: hovering 2024-01-02 reports all three windows, not
    // whichever line the cursor happened to be nearest.
    const rows: CrosshairRow<Date>[] = [
      { x: day('2024-01-01'), y: 30, label: '30d 30.0%' },
      { x: day('2024-01-02'), y: 31, label: '30d 31.0%' },
      { x: day('2024-01-01'), y: 50, label: '90d 50.0%' },
      { x: day('2024-01-02'), y: 52, label: '90d 52.0%' },
    ];
    const anchors = crosshairAnchors(rows, isoDay);
    expect(anchors).toHaveLength(2);
    expect(anchors[1]?.title).toBe('2024-01-02\n30d 31.0%\n90d 52.0%');
  });

  it('anchors at the topmost series, so the tip clears the lines below it', () => {
    const rows: CrosshairRow<Date>[] = [
      { x: day('2024-01-01'), y: 30, label: 'a' },
      { x: day('2024-01-01'), y: 90, label: 'b' },
      { x: day('2024-01-01'), y: 60, label: 'c' },
    ];
    expect(crosshairAnchors(rows, isoDay)[0]?.y).toBe(90);
  });

  it('keeps the caller’s order, for both groups and the lines within one', () => {
    // Series order is the legend's order and the ramp's order; a tooltip that
    // reshuffled them would read as a different chart.
    const rows: CrosshairRow<number>[] = [
      { x: 2, y: 1, label: 'first' },
      { x: 1, y: 1, label: 'second' },
      { x: 2, y: 1, label: 'third' },
    ];
    const anchors = crosshairAnchors(rows, (x) => `day ${x}`);
    expect(anchors.map((a) => a.x)).toEqual([2, 1]);
    expect(anchors[0]?.title).toBe('day 2\nfirst\nthird');
  });

  it('omits a series that has no value at that x rather than showing a zero', () => {
    // The halving cycles have different lengths and the newest is still
    // running: "no fourth cycle yet" is not "fourth cycle at zero".
    const rows: CrosshairRow<number>[] = [
      { x: 100, y: 2, label: '2012 ×2.00' },
      { x: 100, y: 3, label: '2024 ×3.00' },
      { x: 1400, y: 9, label: '2012 ×9.00' },
    ];
    const anchors = crosshairAnchors(rows, (x) => `day ${x}`);
    expect(anchors[1]?.title).toBe('day 1400\n2012 ×9.00');
    expect(anchors[1]?.title).not.toContain('2024');
  });

  it('skips a gap in a series instead of anchoring the tip on it', () => {
    // NaN is how a series says "no reading here"; Plot cannot place it, and
    // it must not win the max-y comparison either.
    const rows: CrosshairRow<number>[] = [
      { x: 1, y: Number.NaN, label: 'gap' },
      { x: 1, y: 5, label: 'real' },
      { x: 2, y: Number.POSITIVE_INFINITY, label: 'overflow' },
    ];
    const anchors = crosshairAnchors(rows, (x) => `day ${x}`);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toEqual({ x: 1, y: 5, title: 'day 1\nreal' });
  });

  it('groups equal dates that are distinct objects', () => {
    // Every caller builds `new Date(...)` per row, so identity grouping would
    // silently produce one anchor per series and change nothing on screen.
    const rows: CrosshairRow<Date>[] = [
      { x: day('2024-01-01'), y: 1, label: 'a' },
      { x: day('2024-01-01'), y: 2, label: 'b' },
    ];
    expect(crosshairAnchors(rows, isoDay)).toHaveLength(1);
  });

  it('lets a clipped series contribute a value without positioning the tip', () => {
    // The DCA chart clips the held-stack line to the simulated lines' domain,
    // so its wealth can be an order of magnitude above the top of the frame.
    // The reader still wants the figure; the tip still has to stay on-chart.
    const rows: CrosshairRow<number>[] = [
      { x: 1, y: 5000, label: 'DCA $5,000' },
      { x: 1, y: 4200, label: 'lump sum $4,200' },
      { x: 1, y: 9_000_000, label: 'your holdings $9,000,000', anchor: false },
    ];
    const anchors = crosshairAnchors(rows, (x) => `t${x}`);
    expect(anchors[0]?.y).toBe(5000);
    expect(anchors[0]?.title).toContain('your holdings $9,000,000');
  });

  it('takes the anchor from a real row that arrives after a clipped one', () => {
    // The order matters and negative data is the case that exposes it. With
    // the clipped row first the group starts with y = null, so the update has
    // to recover from null rather than compare against it: `row.y > null`
    // coerces to `row.y > 0`, which is true for every positive series — so a
    // chart of positive numbers cannot catch this, and the drawdown chart is
    // entirely negative.
    const rows: CrosshairRow<number>[] = [
      { x: 1, y: -5, label: 'clipped', anchor: false },
      { x: 1, y: -40, label: 'drawdown -40.0%' },
    ];
    const anchors = crosshairAnchors(rows, (x) => `t${x}`);
    expect(anchors[0]?.y).toBe(-40);
    expect(anchors[0]?.title).toBe('t1\nclipped\ndrawdown -40.0%');
  });

  it('takes the highest of several real rows even when negative', () => {
    const rows: CrosshairRow<number>[] = [
      { x: 1, y: -80, label: 'a' },
      { x: 1, y: -12, label: 'b' },
      { x: 1, y: -45, label: 'c' },
    ];
    expect(crosshairAnchors(rows, (x) => `t${x}`)[0]?.y).toBe(-12);
  });

  it('drops an x where nothing may position the tip', () => {
    // Before the held line's own start date there is only the clipped series.
    const rows: CrosshairRow<number>[] = [{ x: 1, y: 9e6, label: 'held', anchor: false }];
    expect(crosshairAnchors(rows, (x) => `t${x}`)).toEqual([]);
  });

  it('is empty for no rows', () => {
    expect(crosshairAnchors([], isoDay)).toEqual([]);
  });

  it('handles a single series, which is the majority of the charts', () => {
    const rows: CrosshairRow<Date>[] = [{ x: day('2024-03-01'), y: 42, label: '$42' }];
    expect(crosshairAnchors(rows, isoDay)[0]?.title).toBe('2024-03-01\n$42');
  });
});

describe('isoDay', () => {
  it('is the UTC calendar day, not the viewer’s', () => {
    // Every date in the committed data is a UTC calendar day; formatting in
    // local time would print the previous day west of Greenwich.
    expect(isoDay(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01');
    expect(isoDay(new Date('2024-01-01T23:59:59Z'))).toBe('2024-01-01');
  });
});
