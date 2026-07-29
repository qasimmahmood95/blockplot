/**
 * Draw a live chart into a container, on the browser side of the upgrade.
 *
 * This module exists for its *import*, not just its body. Dynamically importing
 * the library directly — `await import('@observablehq/plot')` — asks for the
 * whole namespace object at runtime, so the bundler has to keep every export it
 * might hold: doing that took the on-demand chunk from 264 KB raw to 389 KB,
 * a 45% increase in what a reader downloads on first hover, for no new
 * behaviour. A static named import inside a module that is *itself* imported
 * dynamically gets both halves: the bundler sees exactly which bindings are
 * used and tree-shakes the rest, and the chunk still does not load until the
 * chart is wanted.
 *
 * It also puts the a11y scrub next to the insertion it belongs to, rather than
 * relying on nine components to remember it.
 */
import { plot } from '@observablehq/plot';
import { keepMarkAriaLabelsStripped } from './plot-a11y';
import { NARROW_CLASS, NARROW_WIDTH, WIDE_CLASS, WIDE_WIDTH } from './plot-theme';

/**
 * The variant wrapper CSS is currently showing, or null if there is none —
 * the holdings chart has no build-time form, so it has no wrappers.
 *
 * Read from computed style rather than from a media query in JavaScript. The
 * breakpoint lives in `global.css` and should live in exactly one place; asking
 * the browser which wrapper it is showing cannot drift from the rule that makes
 * it so.
 */
function visibleVariant(container: Element): HTMLElement | null {
  const wrappers = container.querySelectorAll<HTMLElement>(`.${NARROW_CLASS}, .${WIDE_CLASS}`);
  for (const wrapper of wrappers) {
    if (getComputedStyle(wrapper).display !== 'none') return wrapper;
  }
  return null;
}

/**
 * Render at the *nominal* width of the variant on screen, into that variant's
 * own wrapper — not at the container's pixel width.
 *
 * This is the whole trick, and the obvious alternative is wrong. The served SVG
 * is scaled by `width: 100%` on a 400- or 760-wide viewBox, so everything
 * inside it scales too: an 11px axis label is 8.3px on a phone, a 48px margin
 * is 36px. A live chart laid out at the container's true pixel width would have
 * *unscaled* margins and type — an 11% narrower plot area and a third larger
 * axis text, appearing at the moment of hover. Zero layout shift and a visible
 * change of shape.
 *
 * Rendering at the nominal width inside the same wrapper means CSS applies the
 * identical scale factor it was already applying. The box does not move and the
 * drawing does not change; the only difference is that the crosshair now works.
 *
 * The hidden variant keeps its static SVG. Crossing the breakpoint then shows a
 * correct chart immediately rather than a blank frame, and the resize handler
 * re-renders into whichever wrapper has become visible.
 */
export function drawChart(container: Element, build: (width: number) => Parameters<typeof plot>[0]): void {
  const wrapper = visibleVariant(container);
  if (wrapper) {
    const width = wrapper.classList.contains(NARROW_CLASS) ? NARROW_WIDTH : WIDE_WIDTH;
    wrapper.replaceChildren(plot(build(width)));
  } else {
    // No served variants: the holdings chart, which is built entirely in the
    // browser from an amount the build cannot know. Its true pixel width is
    // the right width, because nothing is scaling it.
    container.replaceChildren(plot(build(container.clientWidth || WIDE_WIDTH)));
  }
  keepMarkAriaLabelsStripped(container);
}
