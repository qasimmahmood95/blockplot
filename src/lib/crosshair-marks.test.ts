import { describe, expect, it } from 'vitest';

/**
 * `cssVar` reads from `document`, which does not exist here, and the module
 * under test is only ever imported by chart islands. Stubbing it keeps this a
 * unit test of the marks rather than a DOM test.
 */

const { crosshairMarks, crosshairMarksFrom } = await import('./crosshair-marks');
const { crosshairAnchors, tipLineWidth } = await import('./crosshair');

const anchors = [
  { x: 1, y: 10, title: 'day 1\na 10' },
  { x: 2, y: 20, title: 'day 2\na 20' },
];

/**
 * Thin, but it exists because it did not: a review found that deleting the
 * rule mark, or reverting `pointerX` to `pointer` — which undoes this
 * feature's entire point, one tip per x rather than nearest-in-xy — left every
 * test in the suite passing. Plot's mark constructors need no DOM, so there is
 * no excuse for the marks being the untested part.
 */
describe('crosshairMarksFrom', () => {
  it('returns both marks: the rule and the tip', () => {
    const marks = crosshairMarksFrom(anchors, 720);
    expect(marks).toHaveLength(2);
  });

  it('is a ruleX and a tip, in that order, so the tip draws on top', () => {
    const [rule, tip] = crosshairMarksFrom(anchors, 720) as { ariaLabel?: string }[];
    expect(rule?.ariaLabel).toBe('rule');
    expect(tip?.ariaLabel).toBe('tip');
  });

  it('hands both marks the anchors, not the raw rows', () => {
    // One datum per x is the feature. If the marks ever received per-series
    // rows again, Plot's pointer would be back to choosing between lines.
    const [rule, tip] = crosshairMarksFrom(anchors, 720) as { data?: unknown }[];
    expect(rule?.data).toBe(anchors);
    expect(tip?.data).toBe(anchors);
  });

  it('points the title channel at the field that holds the text', () => {
    // The single worst mutation found: changing `title: 'title'` to any other
    // field name makes every tooltip on the site silently fail to render —
    // no error, no tip — and the rest of this file passes, because it checks
    // the mark's identity, order and options but never what it reads.
    const [, tip] = crosshairMarksFrom(anchors, 720) as { channels?: Record<string, unknown> }[];
    expect(tip?.channels?.title).toBeDefined();
    expect((tip?.channels?.title as { value?: unknown })?.value).toBe('title');
  });

  it('tells Plot the tip is monospace, or its width budget is fiction', () => {
    // Plot measures against a 10px system-ui table; these charts render the
    // tip in IBM Plex Mono. Without this the underestimate is ~1.22x, which is
    // enough for a capped tip to overflow the frame and be clipped mid-word.
    const [, tip] = crosshairMarksFrom(anchors, 720) as { monospace?: boolean }[];
    expect(tip?.monospace).toBe(true);
  });

  // Not asserted here: that the transform is `pointerX` rather than `pointer`.
  // Reverting it undoes the whole feature — one tip per x becomes nearest in
  // x *and* y — but the two produce marks with no enumerable difference, since
  // the transform is a closure, so it cannot be caught at this level. It *is*
  // catchable in a browser (hold x, vary y, assert the heading does not move),
  // and that check is currently manual against dist/ rather than committed.
  // A browser-test layer is M14's job; this note is here so the gap is a known
  // one rather than an assumed absence.

  it('passes the width through to the tip’s wrap width', () => {
    const [, narrow] = crosshairMarksFrom(anchors, 306) as { lineWidth?: number }[];
    const [, wide] = crosshairMarksFrom(anchors, 900) as { lineWidth?: number }[];
    expect(narrow?.lineWidth).toBe(tipLineWidth(306));
    expect(wide?.lineWidth).toBe(tipLineWidth(900));
    expect(narrow?.lineWidth).toBeLessThan(wide?.lineWidth as number);
  });

  it('truncates rather than overflowing when a label will not fit', () => {
    const [, tip] = crosshairMarksFrom(anchors, 306) as { textOverflow?: string }[];
    expect(tip?.textOverflow).toBe('ellipsis-end');
  });

  it('renders nothing for no anchors rather than throwing', () => {
    expect(crosshairMarksFrom([], 720)).toHaveLength(2);
  });
});

describe('crosshairMarks', () => {
  it('groups and builds in one step, matching the two-step form', () => {
    const rows = [
      { x: 1, y: 10, label: 'a 10' },
      { x: 1, y: 4, label: 'b 4' },
    ];
    const head = (x: number): string => `day ${x}`;
    const [, oneStep] = crosshairMarks(rows, head, 720) as { data?: unknown }[];
    const [, twoStep] = crosshairMarksFrom(crosshairAnchors(rows, head), 720) as { data?: unknown }[];
    expect(oneStep?.data).toEqual(twoStep?.data);
    expect(oneStep?.data).toEqual([{ x: 1, y: 10, title: 'day 1\na 10\nb 4' }]);
  });
});
