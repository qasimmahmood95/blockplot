/**
 * The charts as drawn, checked as geometry rather than as pixels.
 *
 * PLAN.md's second polish item asked for visual-regression snapshots, on the
 * strength of two regressions that shipped past lint, typecheck, unit tests and
 * Lighthouse: two labels painted at identical coordinates at every range and
 * both scales, and 4.6px axis type on phones. Both are visual, and neither
 * needs a picture — since M15 the charts are server-rendered SVG, so where
 * every label sits and how big it is are facts in `dist/`.
 *
 * That is worth preferring to pixel baselines here, not merely cheaper. A
 * screenshot diff answers "did anything change", which on a site whose data
 * moves every six hours is answered "yes" on every run; these answer "is
 * anything illegible or on top of anything else", which is what the two
 * regressions actually were. Baselines would also have to be reconciled between
 * a container's font rendering and the runner's, which is a second gate to
 * maintain before the first one catches anything.
 *
 * The first version of this file passed ten of fifteen real regressions.
 * Everything below that reads as over-careful is there because one of them got
 * through: the size it measured was not the size the browser uses, the container
 * it divided by was not the container, the overlap it looked for was
 * co-location rather than intersection, and nothing looked at a `<path>` at all,
 * so a chart could render blank and stay green.
 *
 * What this still does not cover: colour, spacing, weight, and anything living
 * in CSS rather than in the SVG. PLAN.md keeps that open.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertFresh, page, routes } from './dist';

assertFresh();

/**
 * Whether `/real-returns` has a dataset to draw this run.
 *
 * The one chart on the site whose absence is a *designed* state rather than an
 * outage: the pipeline writes `real-returns.json` only when a CPI deflator is
 * both reachable and still publishing, and the page explains itself when there
 * is none. Every other empty-data branch — `/correlation`, `/network`,
 * `/performance` — fires only when a source has failed, and the count check
 * below is meant to go red on those.
 */
const hasRealReturns = (segment: string): boolean =>
  existsSync(new URL(`../../data/${segment}real-returns.json`, import.meta.url));

/**
 * Whether `/network` has a fee series to draw this run.
 *
 * The other designed absence, and a partial one: `network.json` is rewritten
 * whole on each run from three sibling blockchain.com endpoints, and
 * `transaction-fees` failing while the other two succeed omits `feePerTx`
 * rather than emitting it empty — the pipeline says so, and `NetworkCharts`
 * drops the section. That takes the page from six SVGs to four, which a written
 * -down count reads as a defect on the next unrelated push.
 */
const networkCharts = (): number => {
  // One file for both trees: chain statistics are the chain's, and only the fee
  // tiles are denominated.
  const file = JSON.parse(
    readFileSync(new URL('../../data/network.json', import.meta.url), 'utf8'),
  ) as { feePerTx?: { series?: unknown[] } };
  // The same expression `NetworkCharts.astro` renders from.
  return (file.feePerTx?.series?.length ?? 0) > 0 ? 6 : 4;
};

/**
 * The two rendered widths, as literals.
 *
 * Not imported from `plot-theme.ts`, which is what renders them: an expectation
 * taken from the code under test can only detect two call sites disagreeing,
 * never a wrong value. Written against the constants, `NARROW_WIDTH = 760`
 * passed this check with both variants identical.
 */
const NARROW = 400;
const WIDE = 760;

/**
 * The content box each variant is actually drawn into, from the CSS.
 *
 * `box-sizing: border-box` throughout. `body` is `padding: 0 1.25rem` (40px of
 * the viewport); `.chart-frame` adds a 1px border and `padding: 1rem` either
 * side (34px more). So:
 *
 *     narrow, at the 320px viewport it must survive:  320 − 40 − 34 = 246
 *     wide, from the 40rem breakpoint that shows it:  640 − 40 − 34 = 566
 *
 * The first version of this used 301 for the narrow container, which is not a
 * number anything on the page produces.
 */
const NARROW_CONTAINER = 246;
const WIDE_CONTAINER = 566;

/**
 * The smallest type anyone should have to read on a chart axis.
 *
 * The narrow variant lands at 11 × 246/400 = 6.8px and the wide at
 * 11 × 566/760 = 8.2px, so the margin on the narrow one is 0.8px — thin, and
 * the first version of this file put it at 1.5px by measuring the wrong size
 * against the wrong container, both errors flattering. Shrinking the shared
 * theme's type, or widening either rendered variant, fails here.
 */
const MIN_EFFECTIVE_PX = 6;

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  anchor: string;
  /** True for a tick label, false for a label a mark drew. See `linesOf`. */
  axis: boolean;
}

/**
 * The font size the browser will use, which is not the one Plot writes.
 *
 * Plot puts `font-size="10"` on the `<svg>` as a *presentation attribute*, and
 * `PLOT_STYLE` puts `font-size:11px` in the same element's inline `style`.
 * Inline style wins the cascade, so every label renders at 11px — and a check
 * reading the attribute cannot see the theme's size at all. Setting
 * `PLOT_STYLE.fontSize` to `'4px'` shipped 2.5px type on a phone, green.
 */
const fontSizeOf = (el: Element): number => {
  let node: Element | null = el;
  while (node) {
    const styled = /(?:^|;)\s*font-size\s*:\s*([^;]+)/.exec(node.getAttribute('style') ?? '');
    const raw = styled?.[1] ?? node.getAttribute('font-size');
    if (raw !== null && raw !== undefined && raw.trim() !== '') {
      const size = Number.parseFloat(raw);
      // Never fall through to a default. `Number('4px')` is `NaN`, and every
      // comparison below is false for `NaN`, so an unparseable size silently
      // exempted its label from all three geometry checks — the worst thing a
      // gate can do is skip without saying so.
      if (!Number.isFinite(size) || size <= 0) {
        throw new Error(`unreadable font-size "${raw}" on <${node.tagName.toLowerCase()}>`);
      }
      return size;
    }
    if (node.tagName.toLowerCase() === 'svg') break;
    node = node.parentElement;
  }
  throw new Error('no font-size anywhere up the chain');
};

/**
 * Whether a label is an axis tick rather than something a mark drew.
 *
 * By where its size comes from, which is exact here rather than a heuristic:
 * Plot sets `font-size` only on the `<svg>` root, so a tick label inherits it
 * from there, and every `Plot.text` mark in `src/lib/specs/` passes an explicit
 * `fontSize` that lands on the mark's own group. Verified across all eight
 * chart pages — 345 labels with no size below the root, 14 with one, and the 14
 * are exactly the end-of-line series labels.
 *
 * The distinction matters because the two behave completely differently under a
 * data refresh. A tick's position is Plot's decision and it lays them out to
 * fit; a series label's y *is* a data value, so two of them drift together and
 * apart on their own — measured over the committed history, some pair lands
 * within a pixel on 12.9% of days. Checking those would redden an unchanged
 * diff every eight days or so, which is the failure that teaches people to
 * ignore a gate. PLAN.md carries the overlap itself as an open spec defect.
 */
const isAxisLabel = (el: Element): boolean => {
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== 'svg') {
    if ((node.getAttribute('font-size') ?? '') !== '') return false;
    if (/(?:^|;)\s*font-size\s*:/.test(node.getAttribute('style') ?? '')) return false;
    node = node.parentElement;
  }
  return true;
};

/** An attribute as SVG resolves it: from the node, or the nearest ancestor. */
const inherited = (el: Element, attr: string): string | null => {
  let node: Element | null = el;
  while (node) {
    const value = node.getAttribute(attr);
    if (value !== null && value !== '') return value;
    if (node.tagName.toLowerCase() === 'svg') break;
    node = node.parentElement;
  }
  return null;
};

// Exponent notation included: a computed offset can round to something like
// -2.8e-14, and Plot writes it out that way rather than as a decimal.
const NUMBER = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`;
const TRANSLATE = new RegExp(String.raw`translate\(\s*(${NUMBER})\s*(?:[, ]\s*(${NUMBER})\s*)?\)`, 'i');

/**
 * Absolute position, summing the `translate` chain up to the `<svg>`.
 *
 * The y group is optional because Plot emits `translate(740)` for a horizontal
 * shift; the first version made the separator mandatory, so those contributed
 * (0, 0) silently.
 *
 * Anything other than a translate throws rather than being ignored. The extent
 * arithmetic below models a horizontal, unscaled label, so a `rotate` or a
 * `scale` makes every number here wrong — and `tickRotate: 90`, which ships the
 * date labels on their side running out of the box, was green because the regex
 * matched the translate and dropped the rotate beside it.
 */
const position = (el: Element): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== 'svg') {
    const transform = node.getAttribute('transform') ?? '';
    if (transform !== '') {
      const rest = transform.replace(TRANSLATE, '').trim();
      if (rest !== '') {
        throw new Error(`transform this cannot model: "${transform}"`);
      }
      const match = TRANSLATE.exec(transform);
      if (match === null) throw new Error(`unparseable transform: "${transform}"`);
      x += Number(match[1]);
      y += Number(match[2] ?? 0);
    }
    node = node.parentElement;
  }
  return { x, y };
};

/**
 * Every line of text an SVG draws, with its box.
 *
 * Per `<tspan>`, not per `<text>`: Plot splits a two-line date tick into
 * `<tspan>12 AM</tspan><tspan>Jul 26</tspan>`, and reading `textContent` gives
 * "12 AMJul 26" — an eleven-character label that does not exist, which the
 * first version measured as running off the right edge of `/flows`.
 *
 * Widths are 0.62em per character in the tabular mono the charts use. An
 * estimate, and the reason the overflow check allows real slack rather than
 * demanding the box fit exactly.
 */
const linesOf = (svg: Element): Line[] => {
  const out: Line[] = [];
  for (const text of svg.querySelectorAll('text')) {
    const size = fontSizeOf(text);
    const anchor = inherited(text, 'text-anchor') ?? 'start';
    const axis = isAxisLabel(text);
    const at = position(text);
    const spans = [...text.querySelectorAll('tspan')];
    const em = (value: string | null): number =>
      value === null ? 0 : value.endsWith('em') ? Number.parseFloat(value) * size : Number.parseFloat(value);
    if (spans.length === 0) {
      const label = (text.textContent ?? '').trim();
      if (label !== '') {
        out.push({ text: label, x: at.x, y: at.y + em(text.getAttribute('y')), size, anchor, axis });
      }
      continue;
    }
    let dy = 0;
    for (const span of spans) {
      // `y` sets the baseline for the first line and `dy` steps each one after,
      // both in ems. Dropping them put x-axis labels 7.7px above where they are
      // drawn and y-axis labels 3.3px — a 4.4px disagreement between the two
      // families, wider than the threshold that compares them.
      const yAttr = span.getAttribute('y');
      dy = yAttr !== null ? em(yAttr) : dy + em(span.getAttribute('dy'));
      const label = (span.textContent ?? '').trim();
      if (label === '') continue;
      out.push({
        text: label,
        x: at.x + Number(span.getAttribute('x') ?? 0),
        y: at.y + dy,
        size,
        anchor,
        axis,
      });
    }
  }
  return out;
};

/**
 * The box a label occupies, near enough to compare two of them.
 *
 * Horizontally 0.62em per character, which is an estimate. Vertically the ink
 * rather than the em box: digits and capitals reach about 0.72em above the
 * baseline and nothing in these labels descends. A full em was measurably too
 * tall — on a log y axis d3 blanks tick labels above a mantissa cutoff that
 * steps down as the span grows, and just before each step the two labels below
 * it are at their tightest: 0.30px apart on `/performance`'s real history, and
 * −0.60px over a sweep of reachable `/real-returns` domains. Charging the em box
 * for space the glyphs do not use turned that into a red on data alone.
 */
const box = (line: Line): { left: number; right: number; top: number; bottom: number } => {
  const width = line.text.length * line.size * 0.62;
  const left = line.anchor === 'end' ? line.x - width : line.anchor === 'middle' ? line.x - width / 2 : line.x;
  return { left, right: left + width, top: line.y - line.size * 0.72, bottom: line.y + line.size * 0.02 };
};

const chartRoutes = routes().filter((route) => page(route).querySelector('svg') !== null);

/** How many `<svg>` each route ships, so a chart that vanishes is a failure. */
const svgCount = (route: string): number => page(route).querySelectorAll('svg').length;

describe('server-rendered charts', () => {
  it('builds the charts it is supposed to, and no fewer', () => {
    // A count, not a floor. Several components render `''` rather than a chart
    // when their dataset is missing, and `pipeline.yml` fetches with
    // `continue-on-error`, so a source outage drops a route out of
    // `chartRoutes` entirely — a smaller loop, silently green, with a chart
    // gone from the built site.
    //
    // Two per chart, narrow and wide. Pinned per route so losing one of a
    // page's three charts fails rather than thinning the sample. `/real-returns`
    // `/real-returns` and `/network` are the two entries read from the data
    // rather than written down, because their absence is a designed state; see
    // `hasRealReturns` and `networkCharts`.
    const expected: Record<string, number> = {
      '/': 2,
      '/correlation/': 2,
      '/cycles/': 2,
      '/dca/': 2,
      '/flows/': 4,
      '/network/': networkCharts(),
      '/performance/': 2,
      '/volatility/': 4,
      '/gbp/': 2,
      '/gbp/correlation/': 2,
      '/gbp/cycles/': 2,
      '/gbp/dca/': 2,
      '/gbp/flows/': 4,
      '/gbp/network/': networkCharts(),
      '/gbp/performance/': 2,
      '/gbp/volatility/': 4,
    };
    if (hasRealReturns('')) expected['/real-returns/'] = 2;
    if (hasRealReturns('gbp/')) expected['/gbp/real-returns/'] = 2;
    expect(Object.fromEntries(chartRoutes.map((r) => [r, svgCount(r)]))).toEqual(expected);
  });

  it.each(chartRoutes)('%s ships both width variants of every chart', (route) => {
    // Not one SVG scaled by CSS, which is what a `viewBox` alone would give and
    // what made a 720px chart render 4.6px type in a 301px container. CLAUDE.md's
    // M15 rule is two rendered widths with CSS choosing between them; this is
    // that rule as an assertion about the built page rather than about the
    // helper that implements it.
    const doc = page(route);
    const narrow = [...doc.querySelectorAll('.chart-at-narrow > svg')];
    const wide = [...doc.querySelectorAll('.chart-at-wide > svg')];
    expect(narrow.length, 'narrow variants').toBe(wide.length);
    expect(narrow.length + wide.length, 'every svg is in one variant or the other').toBe(svgCount(route));
    for (const svg of narrow) expect(svg.getAttribute('width')).toBe(String(NARROW));
    for (const svg of wide) expect(svg.getAttribute('width')).toBe(String(WIDE));
  });

  it.each(chartRoutes)('%s keeps its axis type legible at both breakpoints', (route) => {
    // The 4.6px regression, as arithmetic, on both variants — the first version
    // checked only the narrow one, so widening `WIDE_WIDTH` to 1600 shipped
    // 3.9px type to every 640px viewport, green.
    const doc = page(route);
    const tooSmall: string[] = [];
    for (const [selector, container] of [
      ['.chart-at-narrow > svg', NARROW_CONTAINER],
      ['.chart-at-wide > svg', WIDE_CONTAINER],
    ] as const) {
      for (const svg of doc.querySelectorAll(selector)) {
        const width = Number(svg.getAttribute('width'));
        for (const line of linesOf(svg)) {
          const effective = (line.size * container) / width;
          if (effective < MIN_EFFECTIVE_PX) {
            tooSmall.push(`${line.size}px in ${width} shown at ${container} → ${effective.toFixed(1)}px`);
          }
        }
      }
    }
    expect([...new Set(tooSmall)]).toEqual([]);
  });

  it.each(chartRoutes)('%s draws no tick label over its neighbour', (route) => {
    // "Twelve overlapping month labels", from CLAUDE.md's account of the M15
    // regression. The first version compared anchor *points* within 3px, which
    // needs labels to be all but co-located: 52 week ticks on a 400px axis sit
    // 5.9px apart and are 13.6px wide, overlapping by more than half, and were
    // green. This compares boxes.
    //
    // Scoped to the axes — see `isAxisLabel` for why the series labels are out
    // and what PLAN.md carries in their place. Within the axes, grouped by the
    // shape an axis has rather than by a margin the markup does not carry: a
    // row of labels sharing a baseline is an x axis, a column sharing an x with
    // `text-anchor: end` is a y axis. The earlier version of this grouped *all*
    // labels that way, which let three series labels on a long-enough `/cycles`
    // round to one y and be compared as though they were an axis.
    const overlaps: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const lines = linesOf(svg).filter((line) => line.axis);
      // The scope must not be able to empty silently. Every chart here has two
      // axes; the fewest ticks any of them carries is well above this.
      expect(lines.length, 'axis labels found').toBeGreaterThan(3);
      const rows = new Map<number, Line[]>();
      const columns = new Map<number, Line[]>();
      for (const line of lines) {
        const row = Math.round(line.y);
        rows.set(row, [...(rows.get(row) ?? []), line]);
        if (line.anchor === 'end') {
          const column = Math.round(line.x);
          columns.set(column, [...(columns.get(column) ?? []), line]);
        }
      }
      for (const group of rows.values()) {
        if (group.length < 3) continue;
        const sorted = [...group].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i += 1) {
          const a = box(sorted[i - 1] as Line);
          const b = box(sorted[i] as Line);
          if (b.left < a.right) {
            overlaps.push(`"${sorted[i - 1]?.text}" and "${sorted[i]?.text}" share ${(a.right - b.left).toFixed(1)}px`);
          }
        }
      }
      for (const group of columns.values()) {
        if (group.length < 3) continue;
        const sorted = [...group].sort((a, b) => a.y - b.y);
        for (let i = 1; i < sorted.length; i += 1) {
          const a = box(sorted[i - 1] as Line);
          const b = box(sorted[i] as Line);
          if (b.top < a.bottom) {
            overlaps.push(`"${sorted[i - 1]?.text}" and "${sorted[i]?.text}" share ${(a.bottom - b.top).toFixed(1)}px`);
          }
        }
      }
    }
    expect([...new Set(overlaps)]).toEqual([]);
  });

  it.each(chartRoutes)('%s draws no two labels at the same point', (route) => {
    // The backstop the box comparison needs, for a stack the grouping above
    // cannot see — two ticks from different axes landing on one another, or two
    // series labels the dodge failed to separate.
    //
    // Every label now, axis and series alike. It was axis-only, because the
    // series labels take their y from the data and two lines ending close
    // together printed two labels in one place — on 12.9% of days, replayed
    // over the committed history. They are dodged in the spec now
    // (`end-labels.ts`), so the condition cannot arise and the exemption can
    // go; a check that had to skip the labels most likely to collide was the
    // wrong half of the problem to solve.
    const stacked: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const lines = linesOf(svg);
      for (let i = 0; i < lines.length; i += 1) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const a = lines[i] as Line;
          const b = lines[j] as Line;
          if (a.text === b.text) continue;
          if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1) {
            stacked.push(`"${a.text}" and "${b.text}" both at ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
          }
        }
      }
    }
    expect(stacked).toEqual([]);
  });

  it.each(chartRoutes)('%s keeps every label inside its chart', (route) => {
    // A label half outside the box is clipped, which reads as a truncated
    // number rather than as a bug. Both axes: the first version bounded only
    // left and right, so rotated date labels running off the bottom were green.
    //
    // The allowance is a share of the label rather than a fixed distance,
    // because the width is estimated from character count and so the error
    // grows with the label. A flat 12px failed at eleven characters: the y axis
    // on `/` and `/dca` is ours to format, and `"$10,000,000"` — BTC above $10M
    // — overflows the fixed margin by 14px purely as estimation error, while
    // `"$1,000,000"` clears it. As a share, that is 19% against the 27–77% the
    // real clipping regressions produce.
    const share = (line: Line): number => Math.max(8, line.text.length * line.size * 0.62 * 0.25);
    const strayed: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const width = Number(svg.getAttribute('width'));
      const height = Number(svg.getAttribute('height'));
      for (const line of linesOf(svg)) {
        const at = box(line);
        const SLACK = share(line);
        if (at.left < -SLACK || at.right > width + SLACK) {
          strayed.push(`"${line.text}" spans ${at.left.toFixed(0)}–${at.right.toFixed(0)} of ${width}`);
        }
        if (at.top < -SLACK || at.bottom > height + SLACK) {
          strayed.push(`"${line.text}" sits ${at.top.toFixed(0)}–${at.bottom.toFixed(0)} of ${height}`);
        }
      }
    }
    expect(strayed).toEqual([]);
  });

  it.each(chartRoutes)('%s draws its marks, and draws them inside the canvas', (route) => {
    // Nothing looked at a `<path>` at all, so two obvious defects were green: a
    // y domain that excludes the data drew all three volatility lines 783px
    // above a 300px canvas, and a mis-named y channel left the home page's
    // price chart a blank rectangle with four date labels. One check catches
    // both — the marks have to exist, and they have to be on the canvas.
    const SLACK = 24;
    /**
     * Vertices that make a path a series rather than a rule.
     *
     * Gridlines, the axis domain and tick marks are all two-point paths, so a
     * chart that loses its data mark entirely still ships a dozen of them —
     * measured on the blank price chart: twelve paths, every one of them two
     * vertices. The shortest real series on the site is `/flows`'s dominance
     * line at six, and it accretes one point per UTC day, so it only grows.
     */
    const SERIES_VERTICES = 3;
    const wrong: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const width = Number(svg.getAttribute('width'));
      const height = Number(svg.getAttribute('height'));
      let drawn = 0;
      for (const path of svg.querySelectorAll('path[d]')) {
        const d = path.getAttribute('d') ?? '';
        const numbers = [...d.matchAll(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g)];
        if (numbers.length < 2) continue;
        if (numbers.length >= SERIES_VERTICES) drawn += 1;
        const offset = position(path);
        const xs = numbers.map((m) => Number(m[1]) + offset.x);
        const ys = numbers.map((m) => Number(m[2]) + offset.y);
        const out = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (out[0]! < -SLACK || out[1]! > width + SLACK || out[2]! < -SLACK || out[3]! > height + SLACK) {
          wrong.push(
            `a path spans x ${out[0]!.toFixed(0)}–${out[1]!.toFixed(0)} of ${width}, ` +
              `y ${out[2]!.toFixed(0)}–${out[3]!.toFixed(0)} of ${height}`,
          );
        }
      }
      if (drawn === 0) wrong.push('no path longer than a gridline — the chart drew no series');
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});
