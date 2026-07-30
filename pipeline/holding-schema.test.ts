/**
 * The holding dataset's refinements, against the file they are meant to guard.
 *
 * Written because it had none — the same gap `real-returns-schema.test.ts` closed
 * one milestone earlier, reopened. Review probed twelve mutations of the real
 * committed file and every one validated, including `summary.positive = 153` on a
 * matrix containing ten losses, which would have rendered "153/153 holds ended
 * up · 0 ended down". The refinement was spending its length on structural
 * properties the writer's nested loop cannot violate, and none on the four
 * figures the page leads with.
 *
 * So these cases are built by mutating the *committed* dataset rather than a
 * fixture: the point is that the guard fires on the real file, not on a toy.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holdingDatasetSchema } from './schema';

type Doc = Record<string, unknown>;

const committed = (): Doc =>
  JSON.parse(readFileSync(new URL('../data/holding-periods.json', import.meta.url), 'utf8')) as Doc;

const parse = (mutate: (d: Doc) => void): { ok: boolean; message: string } => {
  const doc = committed();
  mutate(doc);
  const result = holdingDatasetSchema.safeParse(doc);
  return {
    ok: result.success,
    message: result.success ? '' : result.error.issues.map((i) => i.message).join(' | '),
  };
};

interface Cell {
  buyYear: number;
  sellYear: number;
  totalPct: number;
  annualPct: number | null;
  days: number;
}
interface Summary {
  count: number;
  positive: number;
  best: { buyYear: number; sellYear: number; annualPct: number };
  worst: { buyYear: number; sellYear: number; annualPct: number };
  longestLosing: Cell | null;
  safeYears: number | null;
}
const cellsOf = (d: Doc): Cell[] => d.cells as Cell[];
const summaryOf = (d: Doc): Summary => d.summary as Summary;
const yearsOf = (d: Doc): { year: number; basisDate: string; closeDate: string; whole: boolean }[] =>
  d.years as { year: number; basisDate: string; closeDate: string; whole: boolean }[];

describe('holdingDatasetSchema', () => {
  it('accepts the committed file', () => {
    expect(holdingDatasetSchema.safeParse(committed()).success).toBe(true);
  });

  describe('the figures the tiles print', () => {
    it('refuses a positive count the cells do not support', () => {
      // The one that would have read "153/153 holds ended up · 0 ended down".
      const { ok, message } = parse((d) => {
        summaryOf(d).positive = summaryOf(d).count;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/summary\.positive/);
    });

    it('refuses a count that is not the number of cells', () => {
      expect(parse((d) => { summaryOf(d).count = 999; }).message).toMatch(/summary\.count/);
    });

    it('refuses a best hold that does not exist', () => {
      const { ok, message } = parse((d) => {
        summaryOf(d).best = { buyYear: 1999, sellYear: 1999, annualPct: 42 };
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/not a rated hold/);
    });

    it('refuses a best hold that is real but not the best', () => {
      const { ok, message } = parse((d) => {
        const worst = summaryOf(d).worst;
        summaryOf(d).best = { ...worst };
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/not the highest-rated hold/);
    });

    it('refuses an invented rate on a real hold', () => {
      const { ok, message } = parse((d) => {
        summaryOf(d).best = { ...summaryOf(d).best, annualPct: 99_999 };
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/but that hold is/);
    });

    it('refuses a worst hold that actually won', () => {
      const { ok, message } = parse((d) => {
        const best = summaryOf(d).best;
        summaryOf(d).worst = { ...best };
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/not the lowest-rated hold/);
    });

    it('refuses a safeYears shorter than the data supports', () => {
      const { ok, message } = parse((d) => {
        summaryOf(d).safeYears = 1;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/shortest span with no loss/);
    });

    it('refuses a safeYears longer than any hold', () => {
      expect(parse((d) => { summaryOf(d).safeYears = 99; }).ok).toBe(false);
    });

    it('refuses a longestLosing that made money', () => {
      const { ok, message } = parse((d) => {
        const winner = cellsOf(d).find((c) => c.totalPct > 0 && c.days > 700);
        summaryOf(d).longestLosing = winner ?? null;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/not a longest losing hold/);
    });

    it('refuses a longestLosing that is not the longest', () => {
      const { ok } = parse((d) => {
        const shorter = cellsOf(d)
          .filter((c) => c.totalPct < 0)
          .reduce((a, b) => (b.days < a.days ? b : a));
        summaryOf(d).longestLosing = shorter;
      });
      expect(ok).toBe(false);
    });

    it('refuses a null longestLosing while holds lost', () => {
      const { ok, message } = parse((d) => {
        summaryOf(d).longestLosing = null;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/null but holds lost/);
    });
  });

  describe('the cells', () => {
    it('refuses a day count its own anchors contradict', () => {
      const { ok, message } = parse((d) => {
        const cell = cellsOf(d)[50];
        if (cell) cell.days = 9999;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/days, but its anchors are/);
    });

    it('refuses a long hold carrying no rate', () => {
      const { ok, message } = parse((d) => {
        const cell = cellsOf(d).find((c) => c.days >= 1000);
        if (cell) cell.annualPct = null;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/carries no rate/);
    });
  });

  describe('the whole-year flag', () => {
    it('refuses a year marked whole that stops mid-December', () => {
      // The 30-day window the first version of this check left open: a pipeline
      // run on any day from 1 to 30 December saw a December close and marked the
      // current year finished, putting "sold end of 2026" back on that column.
      const { ok, message } = parse((d) => {
        const year = yearsOf(d).at(-1);
        if (year) {
          year.closeDate = `${year.year}-12-10`;
          year.whole = true;
        }
        d.asOf = `${yearsOf(d).at(-1)?.year}-12-10`;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/is marked whole/);
    });

    it('refuses a year marked whole whose basis is not the previous December', () => {
      const { ok, message } = parse((d) => {
        const year = yearsOf(d).find((y) => y.whole);
        if (year) year.basisDate = `${year.year - 1}-11-30`;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/is marked whole/);
    });

    it('refuses a close after the dataset says it stopped', () => {
      const { ok, message } = parse((d) => {
        const year = yearsOf(d).at(-1);
        if (year) year.closeDate = `${year.year}-12-31`;
      });
      expect(ok).toBe(false);
      expect(message).toMatch(/after the dataset's asOf|is marked partial/);
    });
  });
});
