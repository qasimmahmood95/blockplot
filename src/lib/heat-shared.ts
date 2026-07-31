/**
 * The monthly heatmap's colour bands, in one place.
 *
 * Split out of the component for the reason `holding-shared.ts` gives: rules
 * that live in a `.astro` file are rules `vitest.config.ts` cannot reach. But
 * also for a reason specific to this pair — the thresholds were written twice,
 * once as literals inside the component's `intensity()` and once as the string
 * "(5/15/30%)" in the sentence under the table, with nothing tying them
 * together. Changing the shading left the sentence naming the old bands, which
 * is this project's most-repeated defect and the one the rendered-claims gate
 * exists for.
 */

/**
 * Where the four steps break, either side of zero.
 *
 * Monthly moves, not the annual rates the holding matrix bands: ±5/15/30 puts
 * an ordinary month in the first step and reserves the fourth for the ones
 * people remember. The negative side reuses the same numbers so a −30% and a
 * +30% read as the same magnitude.
 */
export const MONTHLY_HEAT_STEPS = [5, 15, 30] as const;

/**
 * The class for a monthly return, banded on the figure the cell prints.
 *
 * `formatPct` shows one decimal, so the rounding here is to one decimal too —
 * a cell reading "+30.0%" must not sit in the 15-to-30 colour while the note
 * under it tells the reader the bands break at 30.
 */
export function monthlyHeatClass(value: number): string {
  const magnitude = Math.round(Math.abs(value) * 10) / 10;
  const step =
    magnitude >= MONTHLY_HEAT_STEPS[2]
      ? 4
      : magnitude >= MONTHLY_HEAT_STEPS[1]
        ? 3
        : magnitude >= MONTHLY_HEAT_STEPS[0]
          ? 2
          : 1;
  return `heat-${value < 0 ? 'neg' : 'pos'}-${step}`;
}
