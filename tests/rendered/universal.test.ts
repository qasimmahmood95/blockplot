/**
 * Checks that need no per-page authoring, over every built route.
 *
 * These are the cheap half of the gate: they cost nothing to keep true as pages
 * are added, and they catch the two failure shapes that need no knowledge of
 * what a page *means* — a route that does not exist, and a figure that rendered
 * as nothing.
 */
import { describe, expect, it } from 'vitest';
import { assertFresh, page, routes, textOf } from './dist';
import { PAGES } from '../../src/lib/routes';
import {
  CURRENCIES,
  CURRENCY_META,
  GBP_DXY_NOTE,
  GBP_ETH_NOTE,
  GBP_METHOD_NOTE,
} from '../../src/lib/currency';

// At module scope, not in `beforeAll`: `routes()` is called while the `describe`
// blocks are being collected, which happens first. With `dist/` missing, the
// friendly "run npm run build" message lost to a raw ENOENT from `readdirSync`.
assertFresh();

describe('route inventory', () => {
  it('builds exactly the routes PAGES × CURRENCIES implies', () => {
    // Both directions. A page in the nav that was never built is the defect that
    // shipped as "this page is not built at all" — prose asserting an absence
    // that was not there — and a page built but absent from PAGES is dead weight
    // no link reaches.
    const expected = CURRENCIES.flatMap((currency) => {
      const segment = CURRENCY_META[currency].segment;
      const prefix = segment ? `/${segment}` : '';
      return PAGES.map(({ page: slug }) => `${prefix}/${slug ? `${slug}/` : ''}`);
    }).sort();
    // The 404 page has no currency tree and no nav entry, so it is excluded by
    // name rather than by pattern — a pattern would hide the next such page too.
    // Astro emits it flat, as `404.html`, which is why the name is not `/404/`.
    const built = routes().filter((r) => r !== '/404.html');
    expect(built).toEqual(expected);
  });
});

describe('figure residue', () => {
  /**
   * Nodes that carry a figure, rather than the whole document.
   *
   * Scoping is what makes this zero-noise: an unscoped scan finds the English
   * word "undefined" in a methodology sentence and trains people to ignore the
   * check. Scoped to the elements that print numbers, the current site has
   * exactly zero hits.
   */
  const FIGURE_NODES = '.num, td, th, dd, [title], text, meta[name="description"]';
  /**
   * No word boundaries, and no lookahead. Both were here and both were wrong:
   * the trailing `\b` after `[object Object]` sits between `]` and a non-word
   * character, where no boundary exists, so that alternative could never match
   * anything — including `a[object Object]`. And exempting `undefined` followed
   * by a space exempted exactly the shape template-literal residue takes in
   * this codebase, where these strings are assembled with spaces around their
   * holes: "held undefined days" went through.
   *
   * Neither guard was buying anything. The scoping above is what suppresses the
   * noise the lookahead was credited with, and this stricter pattern scores zero
   * hits across all 24 built routes.
   */
  const RESIDUE = /NaN|Infinity|\[object Object\]|\bundefined\b/;

  it.each(routes())('%s prints no NaN, Infinity or undefined in any figure', (route) => {
    const doc = page(route);
    const bad: string[] = [];
    for (const el of doc.querySelectorAll(FIGURE_NODES)) {
      const text = el.tagName === 'META' ? (el.getAttribute('content') ?? '') : textOf(el);
      const title = el.getAttribute?.('title') ?? '';
      for (const candidate of [text, title]) {
        if (RESIDUE.test(candidate)) bad.push(`<${el.tagName.toLowerCase()}> ${candidate.slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('currency trees', () => {
  const usdRoutes = routes().filter((r) => !r.startsWith('/gbp/') && r !== '/404.html');

  /**
   * Where the two trees legitimately differ, and why.
   *
   * A count table rather than a diff, because the trees are *supposed* to
   * differ: the GBP pages carry an FX note and a natively-quoted-ETH note the
   * USD ones do not, and the USD real-returns page carries a CPI-hole note the
   * GBP one does not. Committing the expected asymmetry means an *unexpected*
   * one fails — which is how a conditional branch firing on the wrong tree gets
   * noticed. Every entry is a measured fact with a reason.
   */
  const NOTE_DELTA: Record<string, number> = {
    // GBP adds: the FX conversion note, and the natively-quoted ETH note.
    '/methodology/': 2,
    // USD adds: the note naming October 2025's cancelled CPI release, which the
    // ONS series does not have.
    '/real-returns/': -1,
  };

  /**
   * The sterling-only sentences, by the text they actually carry.
   *
   * Counting elements cannot see these: `fxNote`, `ethNote` and `dxyNote` append
   * into an existing paragraph rather than adding one, so inverting the
   * condition on any of them leaves every count identical — the dollar pages
   * then explain that "a GBP reader sees the returns they actually experienced"
   * and the sterling pages do not, and the count ledger below stays green. Which
   * is the exact failure the ledger's own comment claims to catch.
   */
  const GBP_ONLY = [
    GBP_METHOD_NOTE.slice(0, 60),
    GBP_ETH_NOTE.slice(0, 60),
    GBP_DXY_NOTE.slice(0, 60),
  ];

  it.each(usdRoutes)('%s differs from its GBP twin only where expected', (route) => {
    const gbp = `/gbp${route}`;
    const count = (r: string, selector: string): number => page(r).querySelectorAll(selector).length;
    const delta = count(gbp, 'p.method-note') - count(route, 'p.method-note');
    expect(delta, `${route} vs ${gbp} method-note count`).toBe(NOTE_DELTA[route] ?? 0);
    // Nothing sterling-specific may appear in the dollar tree, on any page.
    const usdText = textOf(page(route).querySelector('main') ?? page(route).body);
    const strayed = GBP_ONLY.filter((phrase) => usdText.includes(phrase));
    expect(strayed, `${route} carries a GBP-only note`).toEqual([]);
    // Structure, which should never differ: the same sections and the same
    // number of charts and tables in both trees.
    for (const selector of ['section.chart-section', 'svg', 'table']) {
      expect(count(gbp, selector), `${route} vs ${gbp} ${selector}`).toBe(count(route, selector));
    }
  });
});
