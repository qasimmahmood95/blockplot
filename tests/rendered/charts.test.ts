/**
 * The charts as drawn, checked as geometry rather than as pixels.
 *
 * PLAN.md's second polish item asked for visual-regression snapshots, on the
 * strength of two regressions that shipped past lint, typecheck, unit tests and
 * Lighthouse: two labels painted at identical coordinates at every range and
 * both scales, and 4.6px axis type on phones. Both are visual, and neither
 * needs a picture to detect — since M15 the charts are server-rendered SVG, so
 * where every label sits and how big it is are facts in `dist/`.
 *
 * That is worth preferring to pixel baselines here, not merely cheaper. A
 * screenshot diff answers "did anything change", which on a site whose data
 * moves every six hours is answered "yes" on every run; these answer "is
 * anything illegible or on top of anything else", which is what the two
 * regressions actually were. Baselines would also have to be reconciled between
 * a container's font rendering and the runner's, which is a second gate to
 * maintain before the first one catches anything.
 *
 * What this deliberately does not cover: colour, spacing, weight, and anything
 * that lives in CSS rather than in the SVG. Pixel snapshots are still the tool
 * for those, and PLAN.md keeps the item open.
 */
import { describe, expect, it } from 'vitest';
import { assertFresh, page, routes } from './dist';
import { NARROW_WIDTH, WIDE_WIDTH } from '../../src/lib/plot-theme';

assertFresh();

/**
 * The narrowest container a chart is drawn into, measured rather than assumed.
 *
 * A 320px viewport less the page's inline padding. This is the number the 4.6px
 * regression turned on: an SVG with a `viewBox` scales *uniformly*, so a chart
 * rendered at one width is a size rather than an aspect ratio, and the 760px
 * variant shown in a container this size renders its 10px type at 3.9px.
 */
const NARROW_CONTAINER = 301;

/**
 * The smallest type anyone should have to read on a chart axis.
 *
 * Below this it stops being a label. The narrow variant currently lands at
 * 10 × 301/400 = 7.5px, so there is real headroom; the point of the floor is
 * that widening `NARROW_WIDTH`, or showing the wide variant on a phone, fails
 * here instead of shipping.
 */
const MIN_EFFECTIVE_PX = 6;

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  anchor: string;
}

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

/** Absolute position, summing the `translate` chain up to the `<svg>`. */
const position = (el: Element): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== 'svg') {
    const match = /translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)?\s*\)/.exec(
      node.getAttribute('transform') ?? '',
    );
    if (match) {
      x += Number(match[1]);
      y += Number(match[2] ?? 0);
    }
    node = node.parentElement;
  }
  return { x, y };
};

/**
 * Every line of text an SVG draws.
 *
 * Per `<tspan>`, not per `<text>`: Plot splits a two-line date tick into
 * `<tspan>12 AM</tspan><tspan>Jul 26</tspan>`, and reading `textContent` gives
 * "12 AMJul 26" — an eleven-character label that does not exist, which the
 * first version of this measured as running off the right edge of `/flows`.
 */
const linesOf = (svg: Element): Line[] => {
  const out: Line[] = [];
  for (const text of svg.querySelectorAll('text')) {
    const size = Number(inherited(text, 'font-size') ?? 10);
    const anchor = inherited(text, 'text-anchor') ?? 'start';
    const at = position(text);
    const spans = [...text.querySelectorAll('tspan')];
    if (spans.length === 0) {
      const label = (text.textContent ?? '').trim();
      if (label !== '') out.push({ text: label, x: at.x, y: at.y, size, anchor });
      continue;
    }
    spans.forEach((span, i) => {
      const label = (span.textContent ?? '').trim();
      if (label === '') return;
      out.push({
        text: label,
        x: at.x + Number(span.getAttribute('x') ?? 0),
        // Lines below the first are offset by `dy` in ems; the exact value does
        // not matter here, only that they are not stacked at one point.
        y: at.y + i * size,
        size,
        anchor,
      });
    });
  }
  return out;
};

/**
 * How wide a label is, near enough.
 *
 * 0.62em per character in the tabular mono the charts use. An estimate, which
 * is why the overflow check below allows real slack rather than demanding the
 * box fit exactly: the tightest true margin on the site is 1.4px, well inside
 * the error of any formula that does not shape the text.
 */
const extent = (line: Line): { left: number; right: number } => {
  const width = line.text.length * line.size * 0.62;
  const left = line.anchor === 'end' ? line.x - width : line.anchor === 'middle' ? line.x - width / 2 : line.x;
  return { left, right: left + width };
};

const chartRoutes = routes().filter((route) => page(route).querySelector('svg') !== null);

describe('server-rendered charts', () => {
  it('draws a chart on the pages that have one, and none where there is not', () => {
    // Guards everything below from passing vacuously: if the selector or the
    // markup changed, `chartRoutes` empties and every `it.each` runs zero times.
    expect(chartRoutes.length).toBeGreaterThan(10);
  });

  it.each(chartRoutes)('%s ships both width variants of every chart', (route) => {
    // Not one SVG scaled by CSS, which is what a `viewBox` would give and what
    // made a 720px chart render 4.6px type in a 301px container. CLAUDE.M15's
    // rule is two rendered widths with CSS choosing; this is that rule as an
    // assertion about the built page rather than about the helper.
    const doc = page(route);
    const narrow = doc.querySelectorAll('.chart-at-narrow > svg');
    const wide = doc.querySelectorAll('.chart-at-wide > svg');
    expect(narrow.length, 'narrow variants').toBe(wide.length);
    expect(narrow.length).toBeGreaterThan(0);
    for (const svg of narrow) expect(svg.getAttribute('width')).toBe(String(NARROW_WIDTH));
    for (const svg of wide) expect(svg.getAttribute('width')).toBe(String(WIDE_WIDTH));
  });

  it.each(chartRoutes)('%s keeps its axis type legible on a phone', (route) => {
    // The 4.6px regression, as arithmetic: nominal size times the scale the
    // narrow container imposes.
    const tooSmall: string[] = [];
    for (const svg of page(route).querySelectorAll('.chart-at-narrow > svg')) {
      const width = Number(svg.getAttribute('width'));
      for (const line of linesOf(svg)) {
        const effective = (line.size * NARROW_CONTAINER) / width;
        if (effective < MIN_EFFECTIVE_PX) {
          tooSmall.push(`"${line.text}" at ${line.size}px in ${width} → ${effective.toFixed(1)}px`);
        }
      }
    }
    expect([...new Set(tooSmall)]).toEqual([]);
  });

  it.each(chartRoutes)('%s draws no two labels on top of each other', (route) => {
    // The other shipped regression: two labels at identical coordinates, at
    // every range and both scales, invisible to every check the repo had.
    // Different text within a few pixels is one label printed over another;
    // identical text is a repeat, which is a different (and harmless) thing.
    const overlaps: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const lines = linesOf(svg);
      for (let i = 0; i < lines.length; i += 1) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const a = lines[i];
          const b = lines[j];
          if (a === undefined || b === undefined || a.text === b.text) continue;
          if (Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 4) {
            overlaps.push(`"${a.text}" and "${b.text}" both at ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it.each(chartRoutes)('%s keeps every label inside its chart', (route) => {
    // A label half outside the box is clipped, which reads as a truncated
    // number rather than as a bug. Slack is generous because the width here is
    // estimated from character count: the tightest true margin on the site is
    // 1.4px, and the failure this is for — a label hanging off the edge — is
    // tens of pixels out.
    const SLACK = 12;
    const strayed: string[] = [];
    for (const svg of page(route).querySelectorAll('svg')) {
      const width = Number(svg.getAttribute('width'));
      for (const line of linesOf(svg)) {
        const { left, right } = extent(line);
        if (left < -SLACK || right > width + SLACK) {
          strayed.push(`"${line.text}" spans ${left.toFixed(0)}–${right.toFixed(0)} of ${width}`);
        }
      }
    }
    expect(strayed).toEqual([]);
  });
});
