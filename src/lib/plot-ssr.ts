/**
 * Render a chart to SVG markup during the build.
 *
 * Server-only. Imported from component frontmatter and never from a client
 * script — it pulls in linkedom, which has no business in a browser bundle.
 *
 * Why the charts moved here: Observable Plot and its d3 dependencies are 88 KB
 * gzipped and cost ~190 ms of main-thread scripting in one long task, and the
 * site was paying that on first load of every page carrying a chart, purely to
 * draw a picture of data the build already had. Lighthouse put the chart pages
 * at a median 0.89 against 0.99 for the one page with no chart on it — the
 * whole of the gap. A chart of a dataset that only changes when the pipeline
 * commits is a static asset that happened to be built at the wrong time.
 *
 * So the SVG is rendered here, and Plot is not shipped at all until the reader
 * asks for something it is actually needed for. See `upgradeChart`.
 */
import { parseHTML } from 'linkedom';
import * as Plot from '@observablehq/plot';
import { stripMarkAriaLabels } from './plot-a11y';

/** Reused across every chart in a build; Plot only ever needs createElement. */
const { document } = parseHTML('<!doctype html><html><body></body></html>');

/**
 * Plot's options, minus the `document` this supplies.
 *
 * Typed as the argument of `Plot.plot` so a spec that would not compile in the
 * browser does not compile here either — the same object is handed to the same
 * function on both sides, which is the point of the split.
 */
export type ChartSpec = Parameters<typeof Plot.plot>[0];

export function renderChartSvg(spec: ChartSpec): string {
  const node = Plot.plot({ ...spec, document }) as unknown as {
    outerHTML: string;
    querySelectorAll(s: string): Iterable<{ removeAttribute(n: string): void }>;
  };
  stripMarkAriaLabels(node);
  return trimCoordinates(node.outerHTML);
}

/**
 * Round path coordinates to one decimal.
 *
 * Plot writes full float precision, which is invisible on screen and is most
 * of the served bytes on a long series: the cycles chart's four lines came to
 * 32.7 KB gzipped, and this takes roughly a third off. A tenth of a pixel is
 * far below what any display resolves, and the axis text — the part a reader
 * actually reads — is untouched.
 */
function trimCoordinates(svg: string): string {
  return svg.replace(/-?\d+\.\d{2,}/g, (n) => String(Math.round(Number(n) * 10) / 10));
}

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

/**
 * Render both variants, wrapped so `global.css` can show exactly one.
 *
 * Takes a builder rather than a spec because the width is an input to the
 * layout — Plot picks tick counts and margins from it, which is the whole
 * point of laying it out twice.
 */
export function renderResponsiveChart(build: (width: number) => ChartSpec): string {
  return (
    `<span class="chart-at-narrow">${renderChartSvg(build(NARROW_WIDTH))}</span>` +
    `<span class="chart-at-wide">${renderChartSvg(build(WIDE_WIDTH))}</span>`
  );
}
