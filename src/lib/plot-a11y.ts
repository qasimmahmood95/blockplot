/**
 * Remove the ARIA labels Plot puts on its mark groups.
 *
 * Plot labels every mark group for its own debugging — `<g aria-label="line">`,
 * `"rule"`, `"tip"`, `"y-axis tick label"` — on a bare `<g>` with no role.
 * ARIA prohibits `aria-label` on an element with no valid role, so axe flags
 * every one of them and it is what held the chart pages at 0.96 accessibility
 * while the chartless pages sat at 1.00.
 *
 * Stripping them loses nothing. Each chart's container already carries
 * `role="img"` and a written description, which is the accessible name a
 * screen reader should get; "line" and "tip" underneath it are noise even
 * where they are legal. The alternative — adding `role="graphics-symbol"` to
 * satisfy the rule — would keep the labels and start announcing them.
 *
 * Written against the minimum of the DOM so it runs on linkedom during the
 * build and on the real thing after an upgrade.
 */
export interface AriaScrubbable {
  querySelectorAll(selectors: string): Iterable<{ removeAttribute(name: string): void }>;
}

export function stripMarkAriaLabels(root: AriaScrubbable): void {
  for (const el of root.querySelectorAll('g[aria-label]')) el.removeAttribute('aria-label');
}

/** Containers already under observation, so a redraw cannot stack another. */
const observed = new WeakSet<Element>();

/**
 * Keep them stripped once the chart is live.
 *
 * Stripping once is not enough after an upgrade: the pointer transform rebuilds
 * its rule and tip groups on every pointer move, and each rebuild arrives with
 * a fresh `aria-label`. Plot offers no way to decline them — `ariaLabel: null`,
 * `''` and `false` all still emit the mark's default — so the labels have to be
 * removed as they appear.
 *
 * Exactly one observer per container, for the container's lifetime. It watches
 * the container rather than the SVG precisely so it survives a redraw
 * replacing the children — which also means calling this again after each
 * redraw would attach another observer to the same element, and every observer
 * fires on every mutation, so the work would grow quadratically. Left
 * unguarded that reached 476 live observers and 7,245 callbacks eight seconds
 * into a single hover.
 *
 * Only added nodes are inspected, and removing an attribute raises no
 * childList record, so this cannot feed itself.
 */
export function keepMarkAriaLabelsStripped(container: Element): void {
  stripMarkAriaLabels(container);
  if (observed.has(container)) return;
  observed.add(container);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        node.removeAttribute('aria-label');
        stripMarkAriaLabels(node);
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
}
