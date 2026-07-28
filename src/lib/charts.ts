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
 *
 * Only for islands that have no server-rendered form and must build themselves
 * in the browser — the DCA simulator and the holdings chart, whose inputs are
 * the reader's. Charts drawn from committed data use `upgradeChart` instead.
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

/**
 * Take a build-rendered chart live, but not before something needs it to be.
 *
 * The served SVG is already the right chart: it carries a viewBox so it scales
 * with its container, and its colours are `var(--token)` so both themes and the
 * theme toggle are handled by CSS. Nothing about *looking* at it needs Plot.
 * What needs Plot is the crosshair — so that is what pays for it, on the first
 * pointer or touch that arrives over the chart.
 *
 * The upshot is that a reader who scrolls past a chart never downloads the
 * 88 KB, and one who stops to read a value waits about a tenth of a second
 * once. `render` is expected to `await import()` Plot itself; this decides
 * when, not what.
 *
 * Resize is deliberately not a trigger. Before the upgrade the static SVG
 * rescales on its own, so loading a charting library to redraw at an exact
 * width would buy a rounding difference. Afterwards there is a live chart to
 * keep in step, so it re-renders as it always did.
 */
export function upgradeChart(container: Element, render: () => Promise<void>): () => void {
  let state: 'static' | 'loading' | 'live' = 'static';

  const upgrade = (): void => {
    if (state === 'loading') return;
    if (state === 'live') {
      void render();
      return;
    }
    state = 'loading';
    void render().then(
      () => {
        state = 'live';
      },
      () => {
        // Leave the served SVG in place. It is the same chart minus the
        // crosshair, which is a better failure than an empty frame.
        state = 'static';
      },
    );
  };

  for (const event of ['pointerenter', 'touchstart', 'focusin']) {
    container.addEventListener(event, upgrade, { passive: true });
  }

  let raf = 0;
  window.addEventListener('resize', () => {
    if (state !== 'live') return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => void render());
  });

  // Returned for the charts with a control beside them rather than only a
  // hover: a scale toggle or a pair switch changes which chart is wanted, so it
  // has to be able to force the upgrade and then re-render on every later press.
  return upgrade;
}
