/**
 * The DCA chart's arithmetic, with no dependency on Plot.
 *
 * Separate from `dca.ts` because the simulator needs these two on the eager
 * path — the stat tiles and the legend are drawn on load and on every
 * keystroke, without fetching a charting library — and `dca.ts` imports Plot,
 * so a static import of it would put the whole 83 KB back on the critical
 * path. That is the same trap `charts.ts` documents for the header island.
 *
 * Keeping them here is also what stops the component re-inlining `wealthExtent`
 * for want of a Plot-free import, which is exactly the duplication the spec
 * split exists to prevent.
 */
import { formatPct } from '../format';

export interface WealthPoint {
  date: Date;
  wealth: number;
}

/**
 * Three years back from the last close, clamped to the start of history.
 *
 * UTC arithmetic on purpose: a 29 February rolls to 1 March rather than
 * producing an invalid date. Shared with the client so the input's value and
 * the chart the build drew cannot disagree — the drift this avoids would show
 * as a chart that redraws differently the instant anything is typed.
 */
export function defaultStartDate(firstDate: string, lastDate: string): string {
  const last = new Date(`${lastDate}T00:00:00Z`);
  const back = new Date(Date.UTC(last.getUTCFullYear() - 3, last.getUTCMonth(), last.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return back >= firstDate ? back : firstDate;
}

/** The extent of the two simulated lines, which is what sets the y domain. */
export function wealthExtent(
  dcaPoints: readonly WealthPoint[],
  lumpPoints: readonly WealthPoint[],
): [number, number] {
  // Reduce rather than spread: these arrays run to thousands of points, and
  // Math.max(...arr) has an argument-count ceiling. The domain is the
  // simulated lines' own extent — pinning it to zero would silently rescale a
  // chart that is not part of this feature.
  let lo = Infinity;
  let hi = -Infinity;
  for (const point of dcaPoints) {
    if (point.wealth < lo) lo = point.wealth;
    if (point.wealth > hi) hi = point.wealth;
  }
  for (const point of lumpPoints) {
    if (point.wealth < lo) lo = point.wealth;
    if (point.wealth > hi) hi = point.wealth;
  }
  return [lo, hi];
}

/** One stat tile, as both the build and the browser render it. */
export interface DcaTile {
  label: string;
  value: string;
  sub: string;
  tone: 'up' | 'down' | '';
}

export interface DcaTileInput {
  totalInvested: number;
  totalFees: number;
  buys: number;
  btcAccumulated: number;
  dcaFinal: number;
  dcaReturnPct: number;
  lumpFinal: number;
  lumpReturnPct: number;
  delta: number;
}

/**
 * The four figures beside the chart, as data rather than DOM.
 *
 * Shared for the same reason the chart specs are: the build renders these into
 * the markup and the browser re-renders them on every keystroke, and if the two
 * disagreed the page would visibly change the moment it became interactive.
 * Before this, the grid was empty in the markup and filled by script on load —
 * which pushed the chart down 204px and was the largest layout shift left on
 * the site.
 */
export function dcaTiles(
  input: DcaTileInput,
  money: (value: number) => string,
  signedPct: (value: number) => string,
): DcaTile[] {
  const deltaLabel =
    Math.abs(input.delta) < 0.005
      ? 'even with DCA'
      : `${input.delta > 0 ? 'leads' : 'trails'} by ${money(Math.abs(input.delta))}`;
  return [
    {
      label: 'Invested',
      value: money(input.totalInvested),
      sub: `${input.buys} ${input.buys === 1 ? 'buy' : 'buys'} · fees ${money(input.totalFees)}`,
      tone: '',
    },
    {
      label: 'BTC accumulated',
      value: input.btcAccumulated.toFixed(4),
      sub: 'BTC',
      tone: '',
    },
    {
      label: 'DCA value now',
      value: money(input.dcaFinal),
      sub: signedPct(input.dcaReturnPct),
      tone: input.dcaReturnPct < 0 ? 'down' : 'up',
    },
    {
      label: 'Lump sum now',
      value: money(input.lumpFinal),
      sub: `${signedPct(input.lumpReturnPct)} · ${deltaLabel}`,
      tone: input.lumpReturnPct < 0 ? 'down' : 'up',
    },
  ];
}

/**
 * The money and percent formatters, built once from a currency code.
 *
 * Both sides call this rather than each constructing their own. They were two
 * definitions with identical options, which is not the same as being the same:
 * review demonstrated that changing `maximumFractionDigits` on one alone
 * produced `$15,700` in the markup against `$15,700.00` after hydration — a
 * visible flicker on an `aria-live` grid — with lint, typecheck, all tests and
 * the Lighthouse gate still green. The figures agreeing was luck, not
 * structure. Now there is one definition to change.
 */
export function dcaFormatters(code: string): {
  money: (value: number) => string;
  signedPct: (value: number) => string;
} {
  const money = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  });
  return {
    money: (value) => money.format(value),
    signedPct: formatPct,
  };
}

/** One legend entry: a swatch style and its label. */
export interface DcaLegendEntry {
  label: string;
  color: string;
  dash: '' | 'dashed' | 'dotted';
}

/**
 * The two entries the build can draw. A third — the reader's own stack — is
 * appended client-side when there is one, because the build cannot know it.
 *
 * Server-rendered for the same reason the tiles are: left empty in the markup
 * and filled on load, this grew from 0 to 18px and pushed the chart down with
 * it. That was the whole of the residual shift the first version of this fix
 * left behind, one line below the line it fixed.
 */
export const DCA_LEGEND_BASE: readonly DcaLegendEntry[] = [
  { label: 'DCA', color: 'var(--accent)', dash: '' },
  { label: 'lump sum', color: 'var(--ink-muted)', dash: 'dashed' },
];

/** The swatch background for a legend entry, shared by both renderers. */
export function legendSwatch(entry: DcaLegendEntry): string {
  if (!entry.dash) return entry.color;
  const on = entry.dash === 'dotted' ? 1 : 3;
  const off = entry.dash === 'dotted' ? 3 : 6;
  return `repeating-linear-gradient(90deg, ${entry.color} 0 ${on}px, transparent ${on}px ${off}px)`;
}

/**
 * Escape a value for HTML text or a double-quoted attribute value.
 *
 * Nothing here is reader-supplied — the figures come from `Intl` and the only
 * variable label quotes a BTC amount out of `localStorage`, which `parseHoldings`
 * has already narrowed to a bounded number. Escaped anyway, so the builders do
 * not depend on every future caller knowing that.
 *
 * What it does not do, stated rather than implied: single quotes are left
 * alone, which is safe only because every attribute below is double-quoted;
 * and HTML-escaping a value into a `style` attribute is not CSS escaping. It
 * stops a value breaking out of the attribute, not a value that is valid CSS
 * and unwanted — `url(https://…)` inside a colour would be a runtime fetch,
 * and CLAUDE.md sanctions exactly two. Unreachable today: all three swatch
 * colours are literals in this file.
 */
const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The stat grid's inner markup, as a string both renderers emit verbatim.
 *
 * Sharing the *figures* was not enough. The element structure existed twice —
 * once as JSX in the component's template, once as `createElement` calls in its
 * island — and review demonstrated the consequence: adding a single class to
 * the template alone made the served and client markup disagree, which took
 * `#dca-stats` from zero writes on load to one. That is the aria-live
 * re-announcement this whole change exists to prevent, and lint, `astro check`,
 * all tests, the build and the Lighthouse gate stayed green through it, because
 * nothing in the repo compares the two. Now there is nothing to compare: one
 * function produces both.
 */
export function dcaTilesHtml(tiles: readonly DcaTile[]): string {
  return tiles
    .map(
      (t) =>
        `<div class="stat"><dt>${esc(t.label)}</dt>` +
        `<dd class="${esc(`num ${t.tone}`.trim())}">${esc(t.value)}</dd>` +
        `<dd class="sub num">${esc(t.sub)}</dd></div>`,
    )
    .join('');
}

/**
 * The legend's inner markup, on the same terms as the tiles.
 *
 * The swatch colour is written as an attribute string rather than assigned
 * through `element.style`. That is not a stylistic preference: the CSSOM
 * re-serializes `background:var(--accent)` as `background: var(--accent);`, so
 * an island that assigned the property could never compare equal to the markup
 * the build emitted, and the skip-if-unchanged guard was silently inert on this
 * element for exactly that reason.
 */
export function dcaLegendHtml(entries: readonly DcaLegendEntry[]): string {
  return entries
    .map(
      (entry) =>
        `<span class="legend-item">` +
        `<span class="legend-swatch" style="background:${esc(legendSwatch(entry))}"></span>` +
        `${esc(entry.label)}</span>`,
    )
    .join('');
}
