/** Shared client-side helpers for Observable Plot chart islands. */

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
