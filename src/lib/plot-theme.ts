/**
 * Chart colours and type, as CSS custom properties rather than resolved values.
 *
 * The charts used to read their palette through `cssVar()`, which resolves a
 * token to a hex string at render time in the browser. That has two costs. It
 * needs a DOM, so a chart could only ever be built client-side; and the colour
 * is then frozen into the markup, so every theme flip had to rebuild the whole
 * plot just to change a stroke.
 *
 * SVG presentation attributes are mapped to CSS properties, so `var()` resolves
 * in them exactly as it does in a stylesheet — `stroke="var(--accent)"` follows
 * the theme with no JavaScript at all. That is what lets a chart be rendered at
 * build time and still be correct in both themes, and it is why `themechange`
 * no longer forces a re-render.
 *
 * These are strings, not tokens read from anywhere: the point is that they are
 * never resolved here.
 */
export const INK = 'var(--ink)';
export const INK_MUTED = 'var(--ink-muted)';
export const LINE = 'var(--line)';
export const ACCENT = 'var(--accent)';
export const POS = 'var(--pos)';
export const NEG = 'var(--neg)';
export const CYCLE_RAMP = [
  'var(--cycle-1)',
  'var(--cycle-2)',
  'var(--cycle-3)',
  'var(--cycle-4)',
] as const;

/** The style block every chart shares, so type and muted ink stay consistent. */
export const PLOT_STYLE = {
  background: 'transparent',
  color: INK_MUTED,
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
} as const;

/**
 * The two widths the build draws every chart at.
 *
 * An SVG with a viewBox scales *uniformly*, so a single rendered width is a
 * size and not an aspect ratio: served at 720 and shown in a 301 px phone
 * container it became 301 x 142 with 4.6 px axis type and twelve overlapping
 * month labels. Laying the chart out twice and letting CSS pick keeps the
 * scale factor near 1 at both ends — a phone gets the narrow layout, with the
 * axis ticks Plot chose for that width rather than a shrunken copy of the
 * desktop ones.
 *
 * Two, not three: each variant is real markup, and the third would cost more
 * bytes than the fit it buys.
 */
export const NARROW_WIDTH = 400;
export const WIDE_WIDTH = 760;

/** The class each variant's wrapper carries; `global.css` shows one. */
export const NARROW_CLASS = 'chart-at-narrow';
export const WIDE_CLASS = 'chart-at-wide';
