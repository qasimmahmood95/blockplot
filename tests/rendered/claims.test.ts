/**
 * Prose against the pages it describes.
 *
 * Everything here is a sentence the site asserts about its own figures, checked
 * against the figures as built. The sentences are quoted in each test so the
 * thing being defended is legible without opening the page — and so that
 * rewording the page without rewording the check shows up as a diff sitting
 * next to a stale quotation.
 *
 * The rule for what belongs here, from `dist.ts`: a claim that is *interpolated*
 * from `/data` cannot drift and needs nothing. A claim that asserts a
 * *relationship* between figures — this column equals that one, this line breaks
 * where that list says — is a literal no formatter can keep true, and that is
 * what these check.
 *
 * Both currency trees, every time. Three of this project's shipped defects were
 * in one tree only, because the branch that produced them ran on one tree only.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertFresh, page, textOf } from './dist';
import { CURRENCIES, CURRENCY_META } from '../../src/lib/currency';
import { HEAT_STEPS } from '../../src/lib/holding-shared';

beforeAll(assertFresh);

const ROOT = new URL('../../', import.meta.url);

/** Route prefix for a currency tree: '' for USD, '/gbp' for GBP. */
const prefixOf = (currency: (typeof CURRENCIES)[number]): string => {
  const segment = CURRENCY_META[currency].segment;
  return segment ? `/${segment}` : '';
};

/** A committed dataset, read from the same file the build read. */
const dataset = (currency: (typeof CURRENCIES)[number], name: string): Record<string, unknown> => {
  const segment = CURRENCY_META[currency].segment;
  const path = new URL(`data/${segment ? `${segment}/` : ''}${name}.json`, ROOT);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
};

/** A percentage as this site prints it, back to a number. */
const num = (text: string): number => {
  const value = Number(text.trim().replace(/[−–]/g, '-').replace(/[,\s%]/g, ''));
  if (!Number.isFinite(value)) throw new Error(`not a percentage: "${text}"`);
  return value;
};

/** The `p.method-note` on a page containing a phrase, for quoting in failures. */
const noteContaining = (route: string, phrase: string): string =>
  [...page(route).querySelectorAll('p.method-note')].map(textOf).find((n) => n.includes(phrase)) ??
  '';

// ---------------------------------------------------------------------------

/**
 * The holding matrix, read off the built table.
 *
 * By column header rather than by index arithmetic: the header row is what a
 * reader uses to find a cell, so a check that reconstructed the mapping some
 * other way could pass on a table whose headers were shifted by one.
 */
interface MatrixCell {
  buyYear: number;
  sellYear: number;
  /** The figure printed in the cell, or '—' where there is no rate. */
  label: string;
  /** The `heat-*` class, or '' where the cell carries none. */
  heat: string;
  /** The cell's accessible description. */
  title: string;
  blank: boolean;
}

const matrix = (route: string): MatrixCell[] => {
  const doc = page(route);
  const columns = [...doc.querySelectorAll('table thead th.num')].map(
    (th) => 2000 + Number(textOf(th).replace('*', '')),
  );
  const out: MatrixCell[] = [];
  for (const row of doc.querySelectorAll('table tbody tr')) {
    const buyYear = Number(textOf(row.querySelector('th')).replace('*', ''));
    [...row.querySelectorAll('td')].forEach((td, i) => {
      out.push({
        buyYear,
        sellYear: columns[i] ?? Number.NaN,
        label: textOf(td),
        heat: [...td.classList].find((c) => c.startsWith('heat-')) ?? '',
        title: td.getAttribute('title') ?? '',
        blank: td.classList.contains('blank'),
      });
    });
  }
  return out;
};

/** The Total column of the overview's monthly heatmap, by year. */
const overviewYearTotals = (route: string): Map<number, string> => {
  const out = new Map<number, string>();
  for (const row of page(route).querySelectorAll('table.heatmap tbody tr')) {
    const cells = [...row.querySelectorAll('td')];
    const last = cells.at(-1);
    if (last) out.set(Number(textOf(row.querySelector('th'))), textOf(last));
  }
  return out;
};

describe.each(CURRENCIES)('%s: /holding-periods', (currency) => {
  const prefix = prefixOf(currency);
  const route = `${prefix}/holding-periods/`;
  const overview = `${prefix}/`;

  it('prints, on its diagonal, the same total the overview publishes for that year', () => {
    // "the total return of each hold on the diagonal is exactly the yearly
    //  figure the overview heatmap publishes for the same year"
    //
    // The load-bearing claim of the page, and the reason its years are anchored
    // December-to-December rather than on the first close of the buy year. A
    // reader can check it in about ten seconds by opening two tabs, so it has to
    // survive being checked — including the part nobody thinks of as part of the
    // claim, that the two pages print the figure the same way. They did not: at
    // one decimal 2018 came out −69.4% here against -69.3% there, because one
    // side rounded through `toFixed` and the other through `Intl`.
    const totals = overviewYearTotals(overview);
    const diagonal = matrix(route).filter((c) => c.buyYear === c.sellYear && !c.blank);
    expect(diagonal.length).toBeGreaterThan(10);
    const disagreed: string[] = [];
    for (const cell of diagonal) {
      const printed = /·\s*([^·]+?)\s*total\s*·/.exec(cell.title)?.[1];
      const published = totals.get(cell.buyYear);
      if (printed === undefined) {
        disagreed.push(`${cell.buyYear}: no total in "${cell.title}"`);
        continue;
      }
      if (published === undefined) {
        disagreed.push(`${cell.buyYear}: the overview publishes no total for it`);
        continue;
      }
      // Above 10,000% the matrix prints a multiple and the heatmap a percentage,
      // which is deliberate — six figures of percent is not comparable at a
      // glance. The claim is then about the value rather than the glyphs, and a
      // multiple is rounded to a whole ×, so the tolerance is the last place it
      // can round to.
      if (printed.includes('×')) {
        expect(Math.abs((num(printed) - 1) * 100 - num(published)), `${cell.buyYear}`).toBeLessThan(
          100,
        );
      } else {
        disagreed.push(...(printed === published ? [] : [`${cell.buyYear}: ${printed} vs ${published}`]));
      }
    }
    expect(disagreed).toEqual([]);
  });

  it('leaves the lower-left half empty and fills every cell of the upper-right', () => {
    // "The lower-left half is empty because selling before you bought is not a
    //  hold."
    //
    // Cheap, and it is the structural claim the whole grid rests on: a filled
    // cell below the diagonal would be a hold sold before it was bought, and an
    // empty one above is a hold the page silently declines to report.
    const wrong = matrix(route)
      .filter((c) => Number.isFinite(c.sellYear))
      .filter((c) => (c.sellYear < c.buyYear ? !c.blank : c.blank))
      .map((c) => `${c.buyYear}→${c.sellYear} is ${c.blank ? 'empty' : 'filled'}`);
    expect(wrong).toEqual([]);
  });

  it('colours every cell by the band the rate it prints falls in', () => {
    // "Colour is fixed to the rate … bands break at 25%, 60%, 120% a year either
    //  side of zero."
    //
    // Checked against the *printed* rate rather than the underlying one, because
    // the printed rate is the reader's only access to the number: a cell reading
    // "+120%" in the 60–120 colour makes the sentence false to the only person
    // in a position to check it. That is what it did — 2011→2026 was 119.6,
    // rounded to +120% for display and coloured from 119.6.
    const wrong: string[] = [];
    for (const cell of matrix(route)) {
      if (cell.blank) continue;
      if (cell.label === '—') {
        if (cell.heat !== '') wrong.push(`${cell.buyYear}→${cell.sellYear} has no rate but ${cell.heat}`);
        continue;
      }
      const rate = num(cell.label);
      const magnitude = Math.abs(rate);
      const step =
        magnitude >= HEAT_STEPS[2] ? 4 : magnitude >= HEAT_STEPS[1] ? 3 : magnitude >= HEAT_STEPS[0] ? 2 : 1;
      const want = `heat-${rate < 0 ? 'neg' : 'pos'}-${step}`;
      if (cell.heat !== want) {
        wrong.push(`${cell.buyYear}→${cell.sellYear} prints ${cell.label} but is ${cell.heat}, not ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('says nothing reaches the deepest negative band, and nothing does', () => {
    // "The negative side uses the same numbers even though nothing here reaches
    //  −120%"
    //
    // An assertion about the data, in a sentence explaining a design decision —
    // so it is both the kind that drifts and the kind nobody re-reads. One bad
    // year would make it false while the surrounding argument stayed correct.
    const deepest = matrix(route)
      .filter((c) => !c.blank && c.label !== '—')
      .map((c) => num(c.label))
      .reduce((a, b) => Math.min(a, b), 0);
    expect(noteContaining(route, 'nothing here reaches')).toContain(`−${HEAT_STEPS[2]}%`);
    expect(deepest, 'the deepest rate in the grid').toBeGreaterThan(-HEAT_STEPS[2]);
  });
});

// ---------------------------------------------------------------------------

describe.each(CURRENCIES)('%s: /real-returns', (currency) => {
  const route = `${prefixOf(currency)}/real-returns/`;

  it('breaks both drawn lines exactly where it says the deflator has no month', () => {
    // "both lines are broken there rather than drawn straight across — a line
    //  joined over the hole would show a deflated price for every day of a month
    //  the deflator does not cover"
    //
    // The sentence this project has already got wrong once, in the other
    // direction: the note claimed a gap the chart drew straight through. It is
    // checkable because a break is visible in the markup — a line mark's `d`
    // restarts with `M` at each gap — so the count of segments is the count of
    // breaks plus one, and that is a fact about the picture rather than about
    // the array that produced it.
    const file = dataset(currency, 'real-returns');
    const series = file.series as { date: string }[] | undefined;
    if (series === undefined) {
      // The dataset is written only when a live deflator answers. With none
      // there is no chart to check and the page says so; `universal.test.ts`
      // still holds it to the route inventory.
      expect(textOf(page(route).querySelector('h2'))).toMatch(/not available/i);
      return;
    }
    const holes = (file.deflator as { missingMonths: string[] }).missingMonths;
    const first = series[0]?.date ?? '';
    const last = series.at(-1)?.date ?? '';
    // A hole outside the drawn range breaks nothing, which the note allows for:
    // "A short enough range may not reach back to it."
    const inRange = holes.filter((month) => `${month}-15` >= first && `${month}-15` <= last);

    const doc = page(route);
    // Two SVGs, one per width variant — the narrow one is not a thumbnail, it is
    // the chart a phone gets, and a break missing there is a break missing for
    // most readers.
    const svgs = [...doc.querySelectorAll('svg')];
    expect(svgs.length).toBe(2);
    for (const [i, svg] of svgs.entries()) {
      const lines = [...svg.querySelectorAll('path[d]')].filter(
        (p) => (p.getAttribute('d') ?? '').length > 200,
      );
      expect(lines.length, `svg ${i}: nominal and real`).toBe(2);
      for (const line of lines) {
        const segments = (line.getAttribute('d') ?? '').match(/M/g)?.length ?? 0;
        expect(segments, `svg ${i}, stroke ${line.getAttribute('stroke')}`).toBe(inRange.length + 1);
      }
    }

    // And the note is present exactly when there is something to explain.
    const note = noteContaining(route, 'no observation');
    if (holes.length === 0) expect(note).toBe('');
    else expect(note).not.toBe('');
  });
});
