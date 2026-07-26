/** Shared client-side helpers for Observable Plot chart islands. */

export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Render immediately, then again on resize (debounced) and color-scheme flips. */
export function responsiveChart(render: () => void): void {
  render();
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
}
