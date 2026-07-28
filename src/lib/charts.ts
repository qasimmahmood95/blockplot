/** Shared client-side helpers for Observable Plot chart islands. */
import * as Plot from '@observablehq/plot';
import { crosshairAnchors, type CrosshairRow } from './crosshair';

/**
 * Read an island's dataset from the inline JSON the page embedded. Keeps
 * datasets out of client bundles and lets one island serve any currency.
 */
export function chartData<T>(id: string): T {
  const el = document.getElementById(id);
  if (!el?.textContent) throw new Error(`chartData: missing #${id}`);
  return JSON.parse(el.textContent) as T;
}

export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A crosshair rule and a tooltip reporting every series at the hovered x.
 *
 * Every chart on the site goes through this, so hovering behaves the same
 * everywhere: a rule marking the position, and one tip listing what each
 * series was doing there. On a single-series chart that is the plain tooltip
 * it always had, plus the rule. On the volatility, cycles and DCA charts it is
 * the difference between reading one line and comparing them, which is the
 * only reason those series share an axis.
 *
 * Add these last, so the rule draws over the lines and the tip over both.
 */
export function crosshairMarks<X extends Date | number>(
  rows: readonly CrosshairRow<X>[],
  head: (x: X) => string,
): Plot.Markish[] {
  const anchors = crosshairAnchors(rows, head);
  return [
    Plot.ruleX(anchors, Plot.pointerX({ x: 'x', stroke: cssVar('--ink-muted'), strokeOpacity: 0.4 })),
    Plot.tip(anchors, Plot.pointerX({ x: 'x', y: 'y', title: 'title' })),
  ];
}

/**
 * Render immediately, then again on resize (debounced), OS color-scheme
 * flips, and the header theme toggle's `themechange` event.
 */
export function responsiveChart(render: () => void): void {
  render();
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  window.addEventListener('themechange', render);
}
