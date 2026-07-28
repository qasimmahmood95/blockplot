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
 * The served SVG is already the right chart: the build laid it out at two
 * widths and CSS shows the one that fits, and its colours are `var(--token)` so
 * both themes and the theme toggle are handled by CSS. Nothing about *looking*
 * at it needs Plot. What needs Plot is the crosshair — so that is what pays for
 * it, on the first pointer or touch that arrives over the chart.
 *
 * The upshot is that a reader who scrolls past a chart never downloads the
 * 88 KB, and one who stops to read a value waits about a tenth of a second
 * once. `render` is expected to `await import()` Plot itself; this decides
 * when, not what.
 *
 * Resize is deliberately not a trigger before the upgrade: the two served
 * variants already cover the range, and fetching a charting library mid-drag to
 * redraw at an exact width would trade 83 KB for a few pixels of fit.
 * Afterwards there is a live chart to keep in step, so it re-renders as it
 * always did.
 */
export function upgradeChart(
  container: Element,
  render: () => Promise<void>,
): () => Promise<void> {
  const EVENTS = ['pointerenter', 'touchstart', 'focusin'] as const;
  let state: 'static' | 'loading' | 'live' = 'static';

  const run = (): void => {
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

  /**
   * The DOM trigger: promote once, then get out of the way.
   *
   * This must never re-render an already-live chart, and the listeners are
   * removed the moment one is spent. Rendering replaces the container's
   * children, which destroys the node the pointer is over, so the browser
   * dispatches `pointerenter` again on the next frame — and a handler that
   * re-rendered on that event fed itself a 60 fps redraw loop for as long as
   * the cursor rested on the chart. Measured at 179 redraws in three
   * motionless seconds, and on /dca each one re-ran the whole simulation:
   * 1.98 s of scripting per 5 s of hover. That is the exact cost this
   * milestone set out to remove, moved from load to hover and made unbounded.
   */
  const promote = (): void => {
    for (const event of EVENTS) container.removeEventListener(event, promote);
    if (state !== 'static') return;
    run();
  };

  for (const event of EVENTS) {
    container.addEventListener(event, promote, { passive: true });
  }

  let raf = 0;
  window.addEventListener('resize', () => {
    if (state !== 'live') return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => void render());
  });

  /**
   * The control trigger, returned for charts with a toggle beside them.
   *
   * Unlike the DOM trigger this *does* redraw a live chart, because a scale
   * switch or a pair switch is a request for a different chart. It is only
   * ever called from a click handler, so it cannot self-feed.
   *
   * Returns the render's promise so the caller can undo its own state when the
   * chunk fails to arrive. A toggle that stays pressed over a chart that never
   * changed is the worst outcome available here: the served SVG is a perfectly
   * good chart of the *other* pair, and nothing on screen would say so.
   */
  return (): Promise<void> => {
    if (state === 'loading') return Promise.reject(new Error('chart upgrade in flight'));
    if (state === 'static') {
      state = 'loading';
      return render().then(
        () => {
          state = 'live';
        },
        (error: unknown) => {
          state = 'static';
          throw error;
        },
      );
    }
    return render();
  };
}
