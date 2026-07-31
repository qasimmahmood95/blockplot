/**
 * Reading the built site, so prose can be checked against the data it describes.
 *
 * Every page on this site is generated from `/data`, and most figures in its
 * prose are interpolated from there — but not all, and the ones that are not
 * have been this project's most expensive defect class by a wide margin. Across
 * three milestones: a page asserting it "is not built at all" while it plainly
 * was; a grid whose cells said "sold end of 2026" against a 30 July close; a note
 * claiming a line had a gap where the chart drew straight through; a hardcoded
 * `+7,701%` on the page whose own figure is `+7,476%`; and a reconciliation
 * claim naming the wrong page, the wrong quantity and a link that could not
 * confirm it. Every one was caught by a human reading rendered output. None was
 * caught by 609 unit tests, a clean build, or a 1.00 accessibility score.
 *
 * The mechanism they share: **a claim written as a copy of a fact rather than as
 * a projection of it.** Copies drift — and here they drift on a cron, because the
 * pipeline commits fresh data every six hours. So the useful sorting is:
 *
 * 1. *projected* — interpolated from `/data`, cannot drift;
 * 2. *asserted and checked* — a literal with an executable expectation here;
 * 3. *asserted only* — a literal nothing can refute.
 *
 * This file exists to move claims from 3 to 2, and every check written here is
 * an admission that a value should have been in 1. Where interpolating is
 * possible it is strictly better, and the check should be deleted with the
 * literal.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DIST = join(ROOT, 'dist');

const newestMtime = (dir: string, skip: (name: string) => boolean = () => false): number => {
  let newest = 0;
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      if (skip(entry)) continue;
      const child = join(path, entry);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else newest = Math.max(newest, stat.mtimeMs);
    }
  };
  walk(dir);
  return newest;
};

const oldestMtime = (dir: string): number => {
  let oldest = Infinity;
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else oldest = Math.min(oldest, stat.mtimeMs);
    }
  };
  walk(dir);
  return oldest;
};

/**
 * Refuse to run against a `dist/` older than its inputs.
 *
 * Not optional, and not defensive. A green run that silently asserted against
 * yesterday's HTML is worse than no gate at all — it is a gate that reports
 * success for a build nobody made. This bit the investigation that designed
 * these checks: a stale Vite cache produced a build failure contradicting the
 * file on disk, and the only way to tell was to ask which was newer.
 */
export function assertFresh(): void {
  let dist: number;
  try {
    dist = oldestMtime(DIST);
  } catch {
    throw new Error('dist/ is missing — run `npm run build` before `npm run test:rendered`');
  }
  const inputs = Math.max(
    newestMtime(join(ROOT, 'data')),
    newestMtime(join(ROOT, 'src'), (name) => name.endsWith('.test.ts')),
  );
  if (dist < inputs) {
    throw new Error(
      'dist/ is older than data/ or src/ — run `npm run build`. These checks read built ' +
        'output, so a stale artifact would let them pass on a page nobody generated.',
    );
  }
}

/** Every built route, as a site path: '/', '/gbp/dca/', … */
export function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const child = join(dir, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (entry === 'index.html') {
        const rel = relative(DIST, dir).replace(/\\/g, '/');
        out.push(rel === '' ? '/' : `/${rel}/`);
      }
    }
  };
  walk(DIST);
  return out.sort();
}

const parsed = new Map<string, Document>();

/**
 * One route's DOM, parsed once.
 *
 * Memoised because the whole of `dist/` parses in about a third of a second and
 * re-parsing per assertion would make this the slowest thing in CI for no reason.
 */
export function page(route: string): Document {
  const cached = parsed.get(route);
  if (cached) return cached;
  const file = join(DIST, route === '/' ? '' : route, 'index.html');
  const { document } = parseHTML(readFileSync(file, 'utf8'));
  parsed.set(route, document as unknown as Document);
  return document as unknown as Document;
}

/**
 * A number as this site prints it.
 *
 * The site's own glyphs, not a generic parse: U+2212 for minus (`formatRate`),
 * thousands separators from `Intl`, `%`, currency symbols, and `×` for a
 * multiple above 10,000% (`formatTotal`). A parser that missed the multiple form
 * would silently skip exactly the largest figures.
 */
export function figure(text: string): number {
  const cleaned = text
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/[,\s%$£×]/g, '');
  const value = Number(cleaned.replace(/[^0-9.eE+-]/g, ''));
  if (!Number.isFinite(value)) throw new Error(`figure: cannot read "${text}"`);
  return value;
}

/** True when a printed figure used the `×` multiple form rather than a percent. */
export const isMultiple = (text: string): boolean => text.includes('×');

/** Text content with whitespace collapsed, for prose assertions. */
export const textOf = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
