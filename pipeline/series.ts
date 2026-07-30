/** Keep only entries within `days` calendar days of the series' last entry. */
export function trimToLastDays<T extends { date: string }>(series: T[], days: number): T[] {
  const last = series.at(-1);
  if (!last) return [];
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return series.filter((entry) => entry.date > cutoff);
}

/**
 * Calendar days of a history series kept at daily resolution. Everything older
 * is thinned to one point per ISO week.
 *
 * Measured, not chosen by feel. A ten-year daily history of five assets is
 * 11,480 points and 92 KB gzipped — on its own larger than the heaviest page
 * the site has, and it would all have to be embedded, because the reader picks
 * the start date and CLAUDE.md sanctions no runtime fetch to go and get more.
 * Thinned entirely to weekly it is 19 KB, but then a reader asking for the last
 * three months gets thirteen points. Daily for two years and weekly before that
 * is 34 KB and 3,972 points: full resolution over the window anyone reads
 * closely, and a decade of shape for the price of a third of the daily file.
 */
export const HISTORY_DAILY_DAYS = 730;

/**
 * Thin the part of a series older than `days` to its last point per ISO week,
 * keeping everything newer untouched.
 *
 * The *last* close of each week rather than an average: an average is a number
 * no market ever printed, and rebasing it against a real close would compare a
 * synthetic value to a traded one. The last point also means the newest weekly
 * point abuts the daily section without a gap or an overlap.
 *
 * ISO weeks, so the year boundary cannot produce two stubs — a week 1 that
 * belongs to the previous December is keyed to the year it belongs to.
 */
export function thinOlderToWeekly<T extends { date: string }>(series: T[], days: number): T[] {
  const last = series.at(-1);
  if (!last) return [];
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const weekly = new Map<string, T>();
  const daily: T[] = [];
  for (const entry of series) {
    // Strictly newer than the cutoff, matching `trimToLastDays` above, so the
    // two helpers cannot disagree about which day a window starts on.
    if (entry.date > cutoff) {
      daily.push(entry);
      continue;
    }
    // Later entries overwrite earlier ones in the same week, so the map holds
    // each week's last point once the loop finishes.
    weekly.set(isoWeekKey(entry.date), entry);
  }
  return [...weekly.values(), ...daily];
}

/** `YYYY-Www` for the ISO week containing a date. */
export function isoWeekKey(date: string): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`));
  // Shift to the Thursday of this ISO week: the ISO year is the calendar year
  // of that Thursday, which is the whole reason ISO weeks avoid year-end stubs.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  // (elapsed days + 1) / 7, rounded up. The first attempt used `/ 7 + 0.5`,
  // which put Thursday 2024-01-25 and Friday 2024-01-26 in different weeks and
  // dated 2021-01-04 as W02 — so the thinning kept two points for one week.
  const week = Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
