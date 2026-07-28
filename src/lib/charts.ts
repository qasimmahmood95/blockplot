/**
 * Shared client-side helpers for Observable Plot chart islands.
 *
 * Deliberately imports no Plot. The header ticker and holdings tile pull
 * `chartData` from here, and that island is in the layout — on every page,
 * including the chartless 404. Importing Plot here put it in the chunk those
 * pages depend on and took `404.html` from 4.6 KB of JS to 249 KB. The marks
 * that need Plot live in `crosshair-marks.ts`, which only charts import.
 */

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
