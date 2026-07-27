import type { DailyPrice, PriceStats } from './schema';

/**
 * Collapse raw CoinGecko [unixMs, price] points into one entry per UTC day.
 * The feed is USD; conversion into other display currencies happens later, in
 * `fx.ts`, so nothing downstream of here is currency-specific.
 * The feed's midnight points and its trailing "now" point can share a date;
 * the chronologically last value for each day wins.
 */
export function toDailySeries(prices: [number, number][]): DailyPrice[] {
  const byDate = new Map<string, number>();
  for (const [ms, price] of [...prices].sort((a, b) => a[0] - b[0])) {
    byDate.set(new Date(ms).toISOString().slice(0, 10), price);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, price]) => ({ date, price }));
}

function pctChange(latest: number, past: number): number {
  return Math.round((latest / past - 1) * 100 * 100) / 100;
}

/**
 * Headline stats for the stat grid. Change figures compare the latest entry
 * with the one N positions earlier (the series holds one entry per day) and
 * are null when the series is too short. Range-high ties resolve to the
 * earliest day.
 */
export function computeStats(series: DailyPrice[]): PriceStats {
  const first = series[0];
  const latest = series.at(-1);
  if (!first || !latest) throw new Error('computeStats: empty series');

  const back = (days: number): DailyPrice | undefined => series[series.length - 1 - days];
  const week = back(7);
  const month = back(30);

  let high = first;
  for (const day of series) {
    if (day.price > high.price) high = day;
  }

  return {
    latestDate: latest.date,
    latestPrice: latest.price,
    change7dPct: week ? pctChange(latest.price, week.price) : null,
    change30dPct: month ? pctChange(latest.price, month.price) : null,
    rangeHigh: high.price,
    rangeHighDate: high.date,
  };
}
