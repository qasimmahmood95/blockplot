import { describe, expect, it } from 'vitest';
import { MONTHLY_HEAT_STEPS, monthlyHeatClass } from './heat-shared';
import { formatPct } from './format';

describe('monthlyHeatClass', () => {
  it('steps on the documented thresholds', () => {
    // Literals, not `MONTHLY_HEAT_STEPS[n]`, for the reason
    // `holding-shared.test.ts` records: written against the constant, every
    // assertion here is a tautology and re-banding the shading leaves them all
    // green. These three numbers are printed verbatim into the overview's
    // method note and into its legend.
    expect(MONTHLY_HEAT_STEPS).toEqual([5, 15, 30]);
    expect(monthlyHeatClass(0)).toBe('heat-pos-1');
    expect(monthlyHeatClass(5)).toBe('heat-pos-2');
    expect(monthlyHeatClass(15)).toBe('heat-pos-3');
    expect(monthlyHeatClass(30)).toBe('heat-pos-4');
    expect(monthlyHeatClass(41.2)).toBe('heat-pos-4');
  });

  it('bands on the figure the cell prints, not the one behind it', () => {
    // The cell shows one decimal, so the boundary has to be where the printed
    // figure crosses it — otherwise a cell reading "+30.0%" sits in the
    // 15-to-30 colour under a note saying the bands break at 30.
    expect(formatPct(29.96)).toBe('+30.0%');
    expect(monthlyHeatClass(29.96)).toBe('heat-pos-4');
    expect(formatPct(29.94)).toBe('+29.9%');
    expect(monthlyHeatClass(29.94)).toBe('heat-pos-3');
    expect(monthlyHeatClass(4.95)).toBe('heat-pos-2');
    expect(monthlyHeatClass(4.94)).toBe('heat-pos-1');
  });

  it('is symmetric about zero', () => {
    for (const value of [2, 9, 20, 55]) {
      expect(monthlyHeatClass(-value).replace('neg', 'X')).toBe(
        monthlyHeatClass(value).replace('pos', 'X'),
      );
    }
  });

  it('treats a zero return as the shallowest positive step', () => {
    // Not a special case, but worth pinning: a flat month has to take some
    // colour, and the alternative — an uncoloured cell — is what a *missing*
    // month uses.
    expect(monthlyHeatClass(0)).toBe('heat-pos-1');
    expect(monthlyHeatClass(-0.04)).toBe('heat-neg-1');
  });
});
