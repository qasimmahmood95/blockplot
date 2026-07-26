/** Keep only entries within `days` calendar days of the series' last entry. */
export function trimToLastDays<T extends { date: string }>(series: T[], days: number): T[] {
  const last = series.at(-1);
  if (!last) return [];
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return series.filter((entry) => entry.date > cutoff);
}
