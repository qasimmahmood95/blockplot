/**
 * Prose against the pages it describes.
 *
 * Everything here is a sentence the site asserts about its own figures, checked
 * against the figures as built.
 *
 * The rule for what belongs here, from `dist.ts`: a claim that is *interpolated*
 * from `/data` cannot drift and needs nothing. A claim that asserts a
 * *relationship* between figures — this column equals that one, this line breaks
 * where that list says — is a literal no formatter can keep true, and that is
 * what these check.
 *
 * **Every test starts by finding its own sentence on the page.** The first
 * version of this file quoted each claim in a comment instead, which review
 * proved was decoration: "The lower-left half is empty" was reworded to "The
 * upper-right half is empty" — the exact opposite of both the grid and the
 * check below it — and the whole suite stayed green. A check tied to a claim by
 * a comment is not tied to it at all. `claim()` reads the sentence out of the
 * built page, so deleting or inverting it fails here first.
 *
 * Thresholds are written as literals rather than imported from the module that
 * defines them, for the reason `holding-shared.test.ts` records: importing
 * `HEAT_STEPS` and re-deriving the band from it made the whole colour check
 * pass under `[25, 60, 900]`, with the top band emptied and the page's own note
 * still reading 120.
 *
 * Both currency trees, every time. Three of this project's shipped defects were
 * in one tree only, because the branch that produced them ran on one tree only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertFresh, figure, isMultiple, page, textOf } from './dist';
import { CURRENCIES, CURRENCY_META } from '../../src/lib/currency';
import { realRangeOptions } from '../../src/lib/real-shared';
import { realReturnsDatasetSchema } from '../../pipeline/schema';

beforeAll(assertFresh);

const ROOT = new URL('../../', import.meta.url);

/** The bands the holding grid's note names, as literals. See the file header. */
const HEAT_STEPS = [25, 60, 120] as const;

/** Route prefix for a currency tree: '' for USD, '/gbp' for GBP. */
const prefixOf = (currency: (typeof CURRENCIES)[number]): string => {
  const segment = CURRENCY_META[currency].segment;
  return segment ? `/${segment}` : '';
};

/**
 * A committed dataset, read from the same file the build read and validated by
 * the same schema, so the page's own helpers can be called on it here.
 *
 * Returns null where the file is absent, which is a state the pipeline can
 * legitimately produce: `/real-returns` is written only when a live deflator
 * answers.
 */
const dataset = <T,>(
  currency: (typeof CURRENCIES)[number],
  name: string,
  schema: { parse: (input: unknown) => T },
): T | null => {
  const segment = CURRENCY_META[currency].segment;
  const path = new URL(`data/${segment ? `${segment}/` : ''}${name}.json`, ROOT);
  if (!existsSync(path)) return null;
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
};

/**
 * The sentence a check defends, read off the page, or a failure if it is gone.
 *
 * The anchor for every test below. Give it enough of the claim to be unique and
 * to break if the claim is negated — "lower-left half is empty", not "half is
 * empty" — and it returns the whole note so a failure quotes what the page
 * actually says now.
 */
const claim = (route: string, phrase: string): string => {
  const notes = [...page(route).querySelectorAll('p.method-note')].map(textOf);
  const found = notes.find((n) => n.includes(phrase));
  if (found === undefined) {
    throw new Error(
      `${route} no longer says "${phrase}". If the claim was deliberately reworded or ` +
        `dropped, this check goes with it; if it was inverted, the check below is what ` +
        `catches that. Notes on the page: ${notes.map((n) => `\n  · ${n.slice(0, 110)}…`).join('')}`,
    );
  }
  return found;
};

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
  // Every check below is written as "no cell disagrees", which is vacuously true
  // of no cells. If `th.num` ever stops matching, `columns` is empty, every
  // `sellYear` is NaN, and two of these tests pass while iterating nothing —
  // green on a page whose grid has no headers at all. So the shape the whole
  // file depends on is asserted once, here.
  if (columns.length < 10) throw new Error(`${route}: found ${columns.length} column headers`);
  const out: MatrixCell[] = [];
  for (const row of doc.querySelectorAll('table tbody tr')) {
    const buyYear = Number(textOf(row.querySelector('th')).replace('*', ''));
    [...row.querySelectorAll('td')].forEach((td, i) => {
      const sellYear = columns[i];
      if (sellYear === undefined) throw new Error(`${route}: row ${buyYear} has no column ${i}`);
      out.push({
        buyYear,
        sellYear,
        label: textOf(td),
        heat: [...td.classList].find((c) => c.startsWith('heat-')) ?? '',
        title: td.getAttribute('title') ?? '',
        blank: td.classList.contains('blank'),
      });
    });
  }
  if (out.length < 100) throw new Error(`${route}: found ${out.length} cells`);
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
    // The reason the page's years are anchored December-to-December rather than
    // on the first close of the buy year. A reader can check it in about ten
    // seconds by opening two tabs, so it has to survive being checked.
    //
    // What this can refute is narrower than the sentence sounds, and worth being
    // exact about: `monthly.yearlyReturns` delegates to the same
    // `yearlyReturnsFromCloses` the diagonal is built from, and
    // `pipeline/holding.test.ts` already pins that, so the two *values* cannot
    // disagree — all 17 deltas are exactly zero. What is unguarded, and what
    // this caught, is the rendering: at one decimal 2018 came out −69.4% here
    // against -69.3% there, because one side rounded through `toFixed` and the
    // other through `Intl`. It also holds the `MULTIPLE_ABOVE_PCT` boundary,
    // which is the one place the two pages are meant to diverge.
    claim(route, 'is exactly the yearly figure the');
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
      if (isMultiple(printed)) {
        const asPct = (figure(printed) - 1) * 100;
        const gap = Math.abs(asPct - figure(published));
        if (gap >= 100) disagreed.push(`${cell.buyYear}: ${printed} is ${asPct} vs ${published}`);
      } else if (printed !== published) {
        disagreed.push(`${cell.buyYear}: ${printed} vs ${published}`);
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
    claim(route, 'The lower-left half is empty');
    const wrong = matrix(route)
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
    //
    // Only one cell in one tree currently straddles a boundary under rounding,
    // and its value moves every six hours, so this check will go quiet without
    // saying so. `holding-shared.test.ts` pins the same rule at every band edge
    // against fixed values; this is the half that proves the page uses it.
    expect(claim(route, 'bands break at')).toContain(`${HEAT_STEPS.join('%, ')}%`);
    const wrong: string[] = [];
    for (const cell of matrix(route)) {
      if (cell.blank) continue;
      if (cell.label === '—') {
        if (cell.heat !== '') wrong.push(`${cell.buyYear}→${cell.sellYear} has no rate but ${cell.heat}`);
        continue;
      }
      // The sign comes from the glyph, not from the parsed value. `−0%` parses
      // to `-0`, and `-0 < 0` is false, so a rate anywhere in (−0.5, 0) would
      // have made this demand `heat-pos-1` of a page correctly printing
      // `heat-neg-1`. The nearest cell today is 2.6 points away, and 289 of them
      // are re-rolled every six hours.
      const negative = cell.label.startsWith('−');
      const magnitude = Math.abs(figure(cell.label));
      const step =
        magnitude >= HEAT_STEPS[2] ? 4 : magnitude >= HEAT_STEPS[1] ? 3 : magnitude >= HEAT_STEPS[0] ? 2 : 1;
      const want = `heat-${negative ? 'neg' : 'pos'}-${step}`;
      if (cell.heat !== want) {
        wrong.push(`${cell.buyYear}→${cell.sellYear} prints ${cell.label} but is ${cell.heat}, not ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps each cell’s rate, total and span consistent with each other', () => {
    // Not a sentence — the grid's own arithmetic, which nothing else here
    // reaches. Only the 17 diagonal cells are checked against another page, so
    // review set one of the other 136 to "+99.0% total · +11% a year" over six
    // years and the whole gate stayed green: label and colour both derive from
    // the same corrupted field, so they agreed with each other.
    //
    // Every cell states all three of total, rate and span, so each one can be
    // checked against itself — but only to the precision it prints them at, and
    // that precision is coarse where it matters most. The span is one decimal of
    // a year, so 487 days reads "1.3 years"; on a +6,237.5% total those missing
    // 0.033 years are 190 percentage points of implied rate. So the span is read
    // as the interval it stands for and the rate has to fall inside the implied
    // band, widened by its own rounding. Still an order of magnitude tighter
    // than the corruption it is here for: a cell reading "+99.0% total · +11% a
    // year" over six years, against a true 9,178%, is nowhere near.
    claim(route, 'description carries the total return and the number of years held');
    const wrong: string[] = [];
    for (const cell of matrix(route)) {
      if (cell.blank || cell.label === '—') continue;
      const parts = /·\s*([\d.]+)\s*years\s*·\s*(\S+)\s*total/.exec(cell.title);
      if (parts === null) continue; // spans under a year print days and carry no rate
      const years = Number(parts[1]);
      const printedTotal = parts[2] ?? '';
      const total = isMultiple(printedTotal) ? (figure(printedTotal) - 1) * 100 : figure(printedTotal);
      const impliedAt = (y: number): number => ((1 + total / 100) ** (1 / y) - 1) * 100;
      const bounds = [impliedAt(years - 0.05), impliedAt(years + 0.05)];
      const rate = figure(cell.label);
      const slack = Math.max(2, Math.abs(rate) * 0.02);
      if (rate < Math.min(...bounds) - slack || rate > Math.max(...bounds) + slack) {
        wrong.push(
          `${cell.buyYear}→${cell.sellYear}: ${printedTotal} over ${years}y implies ` +
            `${Math.min(...bounds).toFixed(0)}–${Math.max(...bounds).toFixed(0)}%/yr, ` +
            `cell prints ${cell.label}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('chains each row through the diagonal, so no cell floats free', () => {
    // The check that reaches the other 136 cells. Only the 17 on the diagonal
    // are held against another page, and the self-consistency check above
    // compares a cell's three figures to each other — so a cell whose total is
    // simply *wrong*, with a rate wrong to match, satisfies both. Review set
    // 2015→2020 to "+99.0% total · +11% a year" against a true +9,178.7%, and
    // the whole gate stayed green: 99% over six years really is about 11% a
    // year, and label and colour both came from the same corrupted field.
    //
    // A hold is a hold one year shorter, compounded by that last year's own
    // return — which the diagonal publishes, and which the overview publishes in
    // turn. So each cell is checked against its left-hand neighbour and the
    // diagonal cell of its sell year: two printed values, not a product across
    // the row, so the display rounding does not accumulate. Measured on the
    // committed data the worst disagreement is 0.08 points in absolute terms and
    // 0.43% in relative; the corruption above is off by 9,079.
    const totals = new Map<string, number>();
    for (const cell of matrix(route)) {
      const printed = /·\s*(\S+)\s*total\s*·/.exec(cell.title)?.[1];
      if (printed === undefined) continue;
      totals.set(
        `${cell.buyYear}-${cell.sellYear}`,
        isMultiple(printed) ? (figure(printed) - 1) * 100 : figure(printed),
      );
    }
    const wrong: string[] = [];
    let checked = 0;
    for (const [key, actual] of totals) {
      const [buy, sell] = key.split('-').map(Number) as [number, number];
      if (sell <= buy) continue;
      const shorter = totals.get(`${buy}-${sell - 1}`);
      const lastYear = totals.get(`${sell}-${sell}`);
      if (shorter === undefined || lastYear === undefined) continue;
      checked += 1;
      const implied = ((1 + shorter / 100) * (1 + lastYear / 100) - 1) * 100;
      if (Math.abs(implied - actual) > Math.max(0.5, Math.abs(actual) * 0.02)) {
        wrong.push(
          `${buy}→${sell}: ${buy}→${sell - 1} compounded by ${sell} implies ` +
            `${implied.toFixed(1)}%, cell says ${actual}%`,
        );
      }
    }
    expect(checked, 'chained pairs').toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  });

  it('says nothing reaches the deepest negative band, and nothing does', () => {
    // "The negative side uses the same numbers even though nothing here reaches
    //  −120%"
    //
    // An assertion about the data, in a sentence explaining a design decision —
    // so it is both the kind that drifts and the kind nobody re-reads. One bad
    // year would make it false while the surrounding argument stayed correct.
    expect(claim(route, 'nothing here reaches')).toContain(`−${HEAT_STEPS[2]}%`);
    const rates = matrix(route)
      .filter((c) => !c.blank && c.label !== '—')
      .map((c) => figure(c.label));
    // Seeded from the array, not from 0: a zero seed makes an empty grid report
    // a deepest rate of 0 and pass.
    expect(rates.length).toBeGreaterThan(100);
    const deepest = rates.reduce((a, b) => Math.min(a, b));
    expect(deepest, 'the deepest rate in the grid').toBeGreaterThan(-HEAT_STEPS[2]);
  });
});

// ---------------------------------------------------------------------------

describe.each(CURRENCIES)('%s: the overview heatmap', (currency) => {
  const route = `${prefixOf(currency)}/`;
  /** The monthly bands the overview's note names, as literals. */
  const MONTHLY_STEPS = [5, 15, 30] as const;

  it('colours every month by the band the figure it prints falls in', () => {
    // "Shading uses fixed magnitude bands (5/15/30%) rather than data-relative
    //  scaling, so a colour means the same thing in every row"
    //
    // The same defect the holding matrix had, one page over, and it had it for
    // longer: the thresholds were a literal inside the component *and* a
    // separate literal in this sentence, so re-banding the shading left the
    // sentence naming the old numbers with nothing to notice. Review changed
    // `intensity()` to 3/10/25 and the built page showed −4.9% in the second
    // step under a note still saying 5 — green everywhere.
    expect(claim(route, 'fixed magnitude bands')).toContain(`(${MONTHLY_STEPS.join('/')}%)`);
    const doc = page(route);
    const wrong: string[] = [];
    for (const td of doc.querySelectorAll('table.heatmap tbody td')) {
      const label = textOf(td);
      const heat = [...td.classList].find((c) => c.startsWith('heat-')) ?? '';
      // The Total column is not shaded, and a month with no data prints a dot.
      if (td.classList.contains('total') || td.classList.contains('empty')) continue;
      const magnitude = Math.abs(figure(label));
      const step =
        magnitude >= MONTHLY_STEPS[2] ? 4 : magnitude >= MONTHLY_STEPS[1] ? 3 : magnitude >= MONTHLY_STEPS[0] ? 2 : 1;
      const want = `heat-${label.startsWith('−') ? 'neg' : 'pos'}-${step}`;
      if (heat !== want) wrong.push(`${label} is ${heat}, not ${want}`);
    }
    expect(wrong.length, wrong.slice(0, 5).join('; ')).toBe(0);
  });

  it('labels the legend with the band the deepest swatch actually means', () => {
    // The legend's end caps say ±30%+, and they were a third copy of the same
    // number — a third place to forget.
    const caps = [...page(route).querySelectorAll('p.heat-legend span:not(.swatch)')].map(textOf);
    expect(caps).toEqual([`−${MONTHLY_STEPS[2]}%+`, `+${MONTHLY_STEPS[2]}%+`]);
  });
});

// ---------------------------------------------------------------------------

/**
 * The y a drawn line reaches, per pixel, without needing Plot's scale.
 *
 * Several claims below are about *ordering* or *equality* of positions rather
 * than about values, and those survive not knowing what a pixel is worth. It is
 * the same reason these checks can be strict: no scale to re-derive means
 * nothing to get wrong.
 */
const drawnLines = (route: string, svgIndex: number): { first: number; last: number }[] => {
  const svg = [...page(route).querySelectorAll('svg')][svgIndex];
  const out: { first: number; last: number }[] = [];
  for (const path of svg?.querySelectorAll('path[d]') ?? []) {
    const pts = [...(path.getAttribute('d') ?? '').matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    if (pts.length < 10) continue;
    out.push({ first: Number(pts[0]?.[2]), last: Number(pts[pts.length - 1]?.[2]) });
  }
  return out;
};

/** Absolute y of a `<text>`, summing the translate chain. */
const labelY = (el: Element): number => {
  let y = 0;
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== 'svg') {
    const m = /translate\(\s*[-\d.e+]+\s*[, ]\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*\)/i.exec(
      node.getAttribute('transform') ?? '',
    );
    if (m) y += Number(m[1]);
    node = node.parentElement;
  }
  return y;
};

describe.each(CURRENCIES)('%s: /performance', (currency) => {
  const route = `${prefixOf(currency)}/performance/`;

  it('starts every series at the same height, because they are all rebased to 100', () => {
    // "Every series is divided by its own close on the shared base date and
    //  multiplied by 100, so the lines are directly comparable whatever their
    //  units"
    //
    // Which means they all begin at 100, and 100 is one height — checkable
    // without knowing what the axis is worth. A series rebased to the wrong
    // date, or not rebased, starts somewhere else.
    claim(route, 'divided by its own close on the shared base date');
    for (const svgIndex of [0, 1]) {
      const lines = drawnLines(route, svgIndex);
      expect(lines.length, `svg ${svgIndex}`).toBeGreaterThan(2);
      const starts = [...new Set(lines.map((l) => l.first.toFixed(2)))];
      expect(starts, `svg ${svgIndex}: every line starts at the base`).toHaveLength(1);
    }
  });

  it('ranks its tiles the way the chart ranks its lines', () => {
    // The tiles report a final index; the chart draws where each line ends.
    // They come from one `rebaseCovering` call and the page says so — "the tiles
    // describe the same window the build drew, from the same function, so a
    // figure here and the height of a line cannot disagree". Nothing was
    // checking it, and a tile computed over a different window would still look
    // entirely plausible.
    //
    // Compared as an ordering rather than by converting pixels to values: the
    // asset with the highest index must be the line ending highest, all the way
    // down. Pairing is by each line's own end label, so this cannot be satisfied
    // by two lists that merely happen to be sorted.
    const doc = page(route);
    const tiles = [...doc.querySelectorAll('dl.stat-grid .stat')].map((stat) => ({
      name: textOf(stat.querySelector('dt')),
      index: Number(textOf(stat.querySelector('dd.sub')).replace(/\D+/g, '')),
    }));
    expect(tiles.length).toBeGreaterThan(2);
    // The wide variant, which is the one that carries end labels.
    const svg = [...doc.querySelectorAll('svg')][1];
    const names = new Set(tiles.map((t) => t.name));
    const labels = [...(svg?.querySelectorAll('text') ?? [])]
      .filter((t) => names.has(textOf(t)))
      .map((t) => ({ name: textOf(t), y: labelY(t) }));
    expect(labels.length, 'an end label per tile').toBe(tiles.length);
    const byIndex = [...tiles].sort((a, b) => b.index - a.index).map((t) => t.name);
    const byHeight = [...labels].sort((a, b) => a.y - b.y).map((l) => l.name);
    expect(byHeight).toEqual(byIndex);
  });
});

describe.each(CURRENCIES)('%s: /cycles', (currency) => {
  const route = `${prefixOf(currency)}/cycles/`;

  it('starts every epoch at the same height, because each is divided by its own halving close', () => {
    // "the daily close divided by that epoch's halving-day close"
    //
    // So every line starts at ×1 whatever the epoch did afterwards. An epoch
    // normalised against the wrong day starts somewhere else, and on a log axis
    // a wrong base is a vertical shift of the whole line — which looks like a
    // cycle that simply performed differently.
    claim(route, "divided by that epoch's halving-day close");
    for (const svgIndex of [0, 1]) {
      const lines = drawnLines(route, svgIndex);
      expect(lines.length, `svg ${svgIndex}`).toBeGreaterThan(2);
      expect([...new Set(lines.map((l) => l.first.toFixed(2)))], `svg ${svgIndex}`).toHaveLength(1);
    }
  });
});

describe.each(CURRENCIES)('%s: /volatility', (currency) => {
  const route = `${prefixOf(currency)}/volatility/`;

  it('prints one drawdown, in the tile and in the note beneath the chart', () => {
    // The figure and its two dates appear twice on the page, from one dataset.
    // Two renderings of one number is the shape of this project's most
    // expensive defect — `/holding-periods` printed −69.4% where the overview
    // printed -69.3% — so it is worth pinning wherever it recurs.
    const doc = page(route);
    const tile = [...doc.querySelectorAll('.stat')].find((s) =>
      /Max drawdown/.test(textOf(s.querySelector('dt'))),
    );
    const figure = textOf(tile?.querySelector('dd.num'));
    const dates = textOf(tile?.querySelector('dd.sub'));
    const note = claim(route, 'The deepest decline was');
    expect(note).toContain(figure);
    for (const date of dates.split('→').map((d) => d.trim())) {
      expect(note, `${date} from the tile`).toContain(date);
    }
    // And the drawdown is a fall: negative, and its peak before its trough.
    expect(figure.startsWith('−')).toBe(true);
    const [peak, trough] = dates.split('→').map((d) => d.trim());
    expect(String(peak) < String(trough), `${peak} before ${trough}`).toBe(true);
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
    const file = dataset(currency, 'real-returns', realReturnsDatasetSchema);
    if (file === null) {
      // The dataset is written only when a live deflator answers. With none
      // there is no chart to check and the page says so; `universal.test.ts`
      // still holds it to the route inventory.
      expect(textOf(page(route).querySelector('h2'))).toMatch(/not available/i);
      return;
    }
    const holes = file.deflator.missingMonths;
    if (holes.length > 0) claim(route, 'both lines are broken there');

    // The range the build actually drew, from the same function the page uses to
    // pick it — not the whole series. The chart opens on the 5y preset, and
    // `realPoints` drops any break older than its start, so measuring against
    // `series[0].date` demands a break the picture is right not to have. It
    // would have fired around October 2030, when 2025-10 leaves the window, or
    // the moment any older gap appeared — reading as a defect in whatever PR
    // happened to be open.
    const selected = realRangeOptions(file).find((o) => o.selected);
    const start = selected?.start ?? file.series[0]?.date ?? '';
    const last = file.series.at(-1)?.date ?? '';
    const inRange = holes.filter((month) => `${month}-15` >= start && `${month}-15` <= last);

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

    // And the note is present exactly when there is something to explain — it
    // names every hole, including any the drawn range does not reach.
    const notes = [...doc.querySelectorAll('p.method-note')].map(textOf);
    const note = notes.find((n) => n.includes('no observation')) ?? '';
    if (holes.length === 0) expect(note, 'a hole note with no holes').toBe('');
    else expect(note, 'no hole note despite holes').not.toBe('');
  });
});
