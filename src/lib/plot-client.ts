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

export function drawChart(container: Element, spec: Parameters<typeof plot>[0]): void {
  container.replaceChildren(plot(spec));
  keepMarkAriaLabelsStripped(container);
}
