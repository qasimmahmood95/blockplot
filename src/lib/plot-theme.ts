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
