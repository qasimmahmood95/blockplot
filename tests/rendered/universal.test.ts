/**
 * Checks that need no per-page authoring, over every built route.
 *
 * These are the cheap half of the gate: they cost nothing to keep true as pages
 * are added, and they catch the two failure shapes that need no knowledge of
 * what a page *means* — a route that does not exist, and a figure that rendered
 * as nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { assertFresh, page, routes, textOf } from './dist';
import { PAGES } from '../../src/lib/routes';
import { CURRENCIES, CURRENCY_META } from '../../src/lib/currency';

beforeAll(assertFresh);

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
    // 404 has no currency tree and no nav entry, so it is excluded by name
    // rather than by pattern — a pattern would hide the next such page too.
    const built = routes().filter((r) => r !== '/404/');
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
  const RESIDUE = /\b(NaN|Infinity|\[object Object\])\b|\bundefined\b(?![\s'"’])/;

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
  const usdRoutes = routes().filter((r) => !r.startsWith('/gbp/') && r !== '/404/');

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

  it.each(usdRoutes)('%s differs from its GBP twin only where expected', (route) => {
    const gbp = `/gbp${route}`;
    const count = (r: string, selector: string): number => page(r).querySelectorAll(selector).length;
    const delta = count(gbp, 'p.method-note') - count(route, 'p.method-note');
    expect(delta, `${route} vs ${gbp} method-note count`).toBe(NOTE_DELTA[route] ?? 0);
    // Structure, which should never differ: the same sections and the same
    // number of charts and tables in both trees.
    for (const selector of ['section.chart-section', 'svg', 'table']) {
      expect(count(gbp, selector), `${route} vs ${gbp} ${selector}`).toBe(count(route, selector));
    }
  });
});
