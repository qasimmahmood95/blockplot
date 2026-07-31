import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { dodgeBy, dodgedEnds, extentOf, type DodgeOptions } from './end-labels';
import { renderChartSvg } from '../plot-ssr';
import { volSpec } from './vol';
import { cyclesSpec } from './cycles';
import { performanceSpec } from './performance';

/** A 250px drawing area over a 0–100 linear axis: 1 unit is 2.5px. */
const LINEAR: DodgeOptions = {
  scale: 'linear',
  domain: [0, 100],
  plotHeight: 250,
  minGap: 13,
};

/** Where a label ends up, in pixels from the top. */
const placed = (values: number[], options: DodgeOptions = LINEAR): number[] => {
  const [lo, hi] = options.domain;
  const dy = dodgeBy(values, options);
  return values.map((v, i) => ((hi - v) / (hi - lo)) * options.plotHeight + (dy[i] as number));
};

const gaps = (out: number[]): number[] =>
  [...out].sort((a, b) => a - b).slice(1).map((v, i) => v - [...out].sort((a, b) => a - b)[i]!);

describe('dodgeBy', () => {
  it('leaves labels alone when they already clear each other', () => {
    // 20 units is 50px, comfortably past the 13px minimum, so nothing moves.
    expect(dodgeBy([20, 40, 60], LINEAR)).toEqual([0, 0, 0]);
  });

  it('separates labels that would land on top of each other', () => {
    // The failure this exists for: three values within a rounding error of each
    // other print three labels in one place.
    const out = placed([50, 50.02, 49.98]);
    for (const gap of gaps(out)) expect(gap).toBeCloseTo(13, 6);
  });

  it('keeps the group centred on where the lines actually end', () => {
    // Pushing only downward would drift the whole set away from its lines. The
    // mean position is unchanged to within half a pixel, so a reader still
    // reads each label against roughly the right height.
    const values = [50, 50.02, 49.98];
    const before = placed(values, { ...LINEAR, minGap: 0 });
    const after = placed(values);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(after) - mean(before))).toBeLessThan(0.5);
  });

  it('does not reorder them', () => {
    // A label that moved past its neighbour would name the wrong line, which is
    // worse than the overlap it was fixing.
    const values = [10, 10.1, 10.2, 60];
    const out = placed(values);
    expect(out[0]).toBeGreaterThan(out[1] as number);
    expect(out[1]).toBeGreaterThan(out[2] as number);
    expect(out[2]).toBeGreaterThan(out[3] as number);
  });

  it('measures the gap in pixels on a log axis, not in value', () => {
    // 100 and 104 are 4 apart in value and about 2 apart in pixels on this
    // axis; a dodge that worked in value space would think they were fine.
    const log: DodgeOptions = { scale: 'log', domain: [100, 10_000], plotHeight: 250, minGap: 13 };
    expect(dodgeBy([100, 104], log).some((d) => d !== 0)).toBe(true);
    // And far apart in value but close in pixels is still close in pixels.
    expect(dodgeBy([1000, 1040], log).some((d) => d !== 0)).toBe(true);
    // While a full decade apart is 83px and needs nothing.
    expect(dodgeBy([100, 1000], log)).toEqual([0, 0]);
  });

  it('moves only the labels that actually crowd, not every label on the chart', () => {
    // The recentring is per run, not across the whole chart. Shifting everything
    // by the largest push anywhere moved labels that were never near anything:
    // four cycles 175px apart with two of them crowded had all four displaced
    // by 19px, and on `/cycles` two of those cannot overlap at any y because
    // they are 282px apart in x.
    expect(dodgeBy([50, 50.01, 20], LINEAR)).toEqual([6.49, -6.49, 0]);
    expect(dodgeBy([80, 79.9, 79.8, 79.7, 10], LINEAR).at(-1)).toBe(0);
  });

  it('does not let a lower run rise into the one above it', () => {
    // Each run rises by half its own overflow, which unclamped can be further
    // than the run above it moved — closing the gap the forward pass just
    // opened. One label, then six crowded just below it: the six want to rise
    // 32.5px into 1px of headroom, and taking it collapses a 13px separation to
    // 5.5px.
    const values = [90, 84.4, 84.4, 84.4, 84.4, 84.4, 84.4];
    for (const gap of gaps(placed(values))) expect(gap).toBeGreaterThanOrEqual(12.99);
  });

  it('sets aside a label with no position rather than losing every other one', () => {
    // `Math.max(NaN, …)` is NaN, so one non-finite value used to poison the
    // running floor and every label after it — and, because the overflow was
    // then NaN too, silently skip the recentring for the whole chart.
    const out = dodgeBy([50, Number.NaN, 50.01], LINEAR);
    expect(out[1]).toBe(0);
    expect(Number.isFinite(out[0] as number) && Number.isFinite(out[2] as number)).toBe(true);
    expect(Math.abs((out[0] as number) - (out[2] as number))).toBeGreaterThan(12.9);
  });

  it('does nothing to a single label, or none', () => {
    expect(dodgeBy([42], LINEAR)).toEqual([0]);
    expect(dodgeBy([], LINEAR)).toEqual([]);
  });

  it('survives a degenerate axis rather than dividing by zero', () => {
    // Every series ending on the same value gives an empty domain; the labels
    // still have to be readable.
    const flat: DodgeOptions = { ...LINEAR, domain: [5, 5] };
    const out = dodgeBy([5, 5, 5], flat);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(gaps(out)).toEqual([13, 13]);
  });
});

describe('dodgedEnds', () => {
  it('pairs each datum with its own nudge, in input order', () => {
    // Three, asymmetric. With two symmetric ones a reversed pairing is
    // invisible, and reversing is exactly the failure that puts a label on the
    // wrong line: [12.97, 0, −12.97] read backwards pushes the top label down
    // and the bottom one up.
    const ends = [{ v: 50 }, { v: 50.01 }, { v: 50.02 }];
    const out = dodgedEnds(ends, (d) => d.v, LINEAR);
    expect(out.map((o) => o.datum)).toEqual(ends);
    expect(out.map((o) => o.dy)).toEqual(dodgeBy(ends.map((d) => d.v), LINEAR));
  });
});

/**
 * The dodge against Plot, rather than against this module's own arithmetic.
 *
 * Everything above checks `dodgeBy` through a helper that re-implements the
 * same mapping, so the module is measured against itself — and the whole
 * argument for computing pixels outside the spec is that the mapping *is*
 * Plot's. Review proved that gap real: `Y_MARGINS` set to 250, the domain taken
 * from the ends instead of the points, and the log branch made linear all left
 * both suites green.
 *
 * So these render the actual specs, with the ends forced onto one value, and
 * read the separation back out of the SVG. Which is also the only thing that
 * pins the feature at all: on the committed data the labels do not collide
 * today, so deleting the dodge entirely leaves every other test passing.
 */
describe('against Plot, at a tie', () => {
  const baselines = (svg: string, labels: readonly string[]): number[] => {
    const { document } = parseHTML(`<div>${svg}</div>`);
    const at = (el: Element): number => {
      let y = 0;
      let node: Element | null = el;
      while (node && node.tagName.toLowerCase() !== 'svg') {
        const m = /translate\(\s*[-\d.e+]+\s*[, ]\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*\)/i.exec(
          node.getAttribute('transform') ?? '',
        );
        if (m) y += Number(m[1]);
        node = node.parentElement;
      }
      return y;
    };
    return [...document.querySelectorAll('text')]
      .filter((t) => labels.includes((t.textContent ?? '').trim()))
      .map(at)
      .sort((a, b) => a - b);
  };

  const separations = (ys: number[]): number[] => ys.slice(1).map((y, i) => y - (ys[i] as number));

  const days = (n: number): Date[] =>
    Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000));

  it('separates the volatility windows when all three end together', () => {
    const dates = days(40);
    const windows = ['30d', '90d', '365d'];
    const points = windows.flatMap((window, w) =>
      dates.map((date, i) => ({ date, window, volPct: 30 + w + Math.sin(i / 4) * 8 })),
    );
    // Every window ending on the same reading: the case that printed three
    // labels in one place.
    const lineEnds = windows.map((window) => ({ date: dates.at(-1) as Date, window, volPct: 42 }));
    const svg = renderChartSvg(volSpec(points, lineEnds, windows, 760));
    const gaps = separations(baselines(svg, windows));
    expect(gaps).toHaveLength(2);
    // 13 less the rounding the offsets and the SVG coordinates each carry.
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12.89);
  });

  it('separates the halving cycles on a log axis, where a tie is closest', () => {
    const cycles = ['2012', '2016', '2020', '2024'];
    const points = cycles.flatMap((cycle, c) =>
      Array.from({ length: 60 }, (_, day) => ({ cycle, day, multiple: 1 + day / 10 + c })),
    );
    const lineEnds = cycles.map((cycle) => ({ cycle, day: 59, multiple: 5 }));
    const svg = renderChartSvg(cyclesSpec(points, lineEnds, cycles, 'log', 760));
    const gaps = separations(baselines(svg, cycles));
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12.89);
  });

  it('separates all five performance labels, on both scales', () => {
    const assets = ['btc', 'eth', 'sp500', 'gold', 'dxy'];
    const labels = ['BTC', 'ETH', 'S&P 500', 'gold', 'DXY'];
    const dates = days(40);
    for (const scale of ['log', 'linear'] as const) {
      const points = assets.flatMap((asset, a) =>
        dates.map((date, i) => ({ asset, date, index: 100 + a * 10 + i })),
      );
      const lineEnds = assets.map((asset) => ({ asset, date: dates.at(-1) as Date, index: 140 }));
      const svg = renderChartSvg(performanceSpec(points, lineEnds, assets, scale, 760));
      const gaps = separations(baselines(svg, labels));
      expect(gaps, scale).toHaveLength(4);
      for (const gap of gaps) expect(gap, scale).toBeGreaterThanOrEqual(11.89);
    }
  });

  it('leaves volatility labels alone at a separation that does not need a nudge', () => {
    // A tie proves the dodge fires; it cannot prove the *projection* is right,
    // because at a tie every mapping agrees. This is the other half: two ends
    // far enough apart that nothing should move, so a wrong `plotHeight` — the
    // chart's height less its margins — compresses them into collision and the
    // labels shift. Review set `Y_MARGINS` to 250 and both suites stayed green.
    const dates = days(20);
    const windows = ['30d', '90d', '365d'];
    // Points span 30–80, so 5 percentage points is a tenth of the axis: 25px of
    // a 250px drawing area, comfortably clear of the 13px minimum.
    const points = windows.flatMap((window) =>
      dates.map((date, i) => ({ date, window, volPct: i === 0 ? 30 : i === 1 ? 80 : 50 })),
    );
    const at = [42, 47, 75];
    const lineEnds = windows.map((window, i) => ({
      date: dates.at(-1) as Date,
      window,
      volPct: at[i] as number,
    }));
    const svg = renderChartSvg(volSpec(points, lineEnds, windows, 760));
    const gaps = separations(baselines(svg, windows));
    // Sorted top-first, so the pair in question is the second gap: 5pp of a
    // 50pp span over 250px. It must be exactly that far apart — neither pushed
    // together nor pushed apart.
    expect(gaps[1]).toBeCloseTo(25, 0);
  });

  it('reads the cycles axis as log, where linear and log disagree about crowding', () => {
    // ×1.0 against ×1.6 is a tenth of a log axis running to ×90 — 34px, clear —
    // and 0.7% of the same axis read linearly, which would look like 2px and
    // trigger a nudge. Replacing the log branch with the linear value left every
    // other test in this file green.
    const cycles = ['2012', '2016', '2020', '2024'];
    const points = cycles.flatMap((cycle) =>
      Array.from({ length: 30 }, (_, day) => ({ cycle, day, multiple: day === 0 ? 1 : day === 1 ? 90 : 10 })),
    );
    const at = [1, 1.6, 20, 60];
    const lineEnds = cycles.map((cycle, i) => ({ cycle, day: 29, multiple: at[i] as number }));
    const svg = renderChartSvg(cyclesSpec(points, lineEnds, cycles, 'log', 760));
    const ys = baselines(svg, cycles);
    // The two lowest cycles are the pair in question; they must stay where the
    // log axis puts them.
    expect(separations(ys)[2]).toBeCloseTo(34.5, 0);
  });

  it('takes its domain from the points, not from the ends', () => {
    // The ends alone span a fraction of the axis, so a domain built from them
    // spreads two crowded labels across the whole chart and the nudge never
    // fires. Review made that substitution and both suites stayed green.
    const cycles = ['2012', '2016', '2020', '2024'];
    const points = cycles.flatMap((cycle) =>
      Array.from({ length: 30 }, (_, day) => ({ cycle, day, multiple: day === 0 ? 1 : day === 1 ? 90 : 10 })),
    );
    // Within 12% of each other on a log axis to ×90: about 8px apart, under the
    // 13px minimum, so all four have to move.
    const at = [5, 5.3, 5.6, 5.9];
    const lineEnds = cycles.map((cycle, i) => ({ cycle, day: 29, multiple: at[i] as number }));
    const svg = renderChartSvg(cyclesSpec(points, lineEnds, cycles, 'log', 760));
    for (const gap of separations(baselines(svg, cycles))) expect(gap).toBeGreaterThanOrEqual(12.89);
  });

  it('survives a non-positive point on a log axis without moving everything', () => {
    // A cycle that touches zero — the multiple is a ratio and the pipeline can
    // emit one — is not on a log axis at all, and Plot drops it. Taking it into
    // the domain makes the span infinite and collapses every label onto one
    // point, so the nudge fires on labels that are 100px apart.
    const cycles = ['2012', '2016', '2020', '2024'];
    const points = cycles.flatMap((cycle) =>
      Array.from({ length: 30 }, (_, day) => ({ cycle, day, multiple: day === 0 ? 0 : day === 1 ? 90 : 10 })),
    );
    const at = [1, 6, 30, 80];
    const lineEnds = cycles.map((cycle, i) => ({ cycle, day: 29, multiple: at[i] as number }));
    const svg = renderChartSvg(cyclesSpec(points, lineEnds, cycles, 'log', 760));
    // All four are decades apart; not one of them should be touched.
    for (const gap of separations(baselines(svg, cycles))) expect(gap).toBeGreaterThan(40);
  });

  it('gives every performance label its own theme token, not a CSS colour name', () => {
    // `fill: 'asset'` used to ride Plot's colour scale. One mark per label broke
    // it: Plot skips the scale when every value in a colour channel is already
    // a valid CSS colour, and a one-datum channel of ['gold'] is — so that one
    // label shipped painted literal `gold` while its line stayed
    // `var(--ink-muted)`, and stopped following the theme toggle.
    const assets = ['btc', 'eth', 'sp500', 'gold', 'dxy'];
    const dates = days(10);
    const points = assets.flatMap((asset, a) =>
      dates.map((date, i) => ({ asset, date, index: 100 + a * 10 + i })),
    );
    const lineEnds = assets.map((asset, a) => ({ asset, date: dates.at(-1) as Date, index: 109 + a * 10 }));
    const svg = renderChartSvg(performanceSpec(points, lineEnds, assets, 'log', 760));
    const { document } = parseHTML(`<div>${svg}</div>`);
    const labels = ['BTC', 'ETH', 'S&P 500', 'gold', 'DXY'];
    const found: string[] = [];
    for (const text of document.querySelectorAll('text')) {
      if (!labels.includes((text.textContent ?? '').trim())) continue;
      let node: Element | null = text;
      let fill: string | null = null;
      while (node && node.tagName.toLowerCase() !== 'svg' && fill === null) {
        fill = node.getAttribute('fill');
        node = node.parentElement;
      }
      found.push(`${(text.textContent ?? '').trim()}=${fill}`);
      expect(fill ?? '', (text.textContent ?? '').trim()).toMatch(/^var\(--/);
    }
    expect(found).toHaveLength(labels.length);
  });
});

describe('extentOf', () => {
  it('spans the values, lowest first', () => {
    expect(extentOf([{ v: 3 }, { v: -1 }, { v: 9 }], (d) => d.v)).toEqual([-1, 9]);
  });

  it('ignores the breaks a gapped series carries', () => {
    // `/real-returns` inserts non-finite values to split a line at a hole; an
    // extent that took them would be NaN and take every position with it.
    expect(extentOf([{ v: 3 }, { v: Number.NaN }, { v: 9 }], (d) => d.v)).toEqual([3, 9]);
  });

  it('drops non-positive values on a log axis, as Plot does', () => {
    // Plot has nowhere to put them, so they are not in its domain. Keeping
    // them puts this module's domain somewhere Plot's is not: `Math.log(0)` is
    // −Infinity, the span becomes infinite, and every label projects to the
    // same point — so the dodge separates labels that are nowhere near each
    // other and leaves ones that are.
    expect(extentOf([{ v: 0 }, { v: 3 }, { v: 9 }], (d) => d.v, 'log')).toEqual([3, 9]);
    expect(extentOf([{ v: -5 }, { v: 3 }], (d) => d.v, 'log')).toEqual([3, 3]);
    // On a linear axis they are ordinary values and stay.
    expect(extentOf([{ v: 0 }, { v: 3 }], (d) => d.v, 'linear')).toEqual([0, 3]);
  });

  it('falls back rather than returning an infinite span', () => {
    expect(extentOf([], (d: { v: number }) => d.v)).toEqual([0, 1]);
    // Every value dropped comes to the same thing as none at all.
    expect(extentOf([{ v: -1 }, { v: 0 }], (d) => d.v, 'log')).toEqual([0, 1]);
  });
});
