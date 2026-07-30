import { describe, expect, it } from 'vitest';
import { isoWeekKey, thinOlderToWeekly, trimToLastDays } from './series';

describe('trimToLastDays', () => {
  it('keeps entries within N calendar days of the last entry', () => {
    const rows = [
      { date: '2024-12-28', close: 1 },
      { date: '2024-12-29', close: 2 },
      { date: '2024-12-30', close: 3 },
      { date: '2024-12-31', close: 4 },
    ];
    expect(trimToLastDays(rows, 2)).toEqual(rows.slice(2));
    expect(trimToLastDays([], 30)).toEqual([]);
  });
});

describe('isoWeekKey', () => {
  it('keys a week by the ISO year of its Thursday', () => {
    // 2021-01-01 is a Friday in ISO week 2020-W53; keying it by calendar year
    // would split one week across two years and leave a one-day stub.
    expect(isoWeekKey('2020-12-28')).toBe('2020-W53');
    expect(isoWeekKey('2021-01-01')).toBe('2020-W53');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2021-01-04')).toBe('2021-W01');
  });

  it('keys Monday and Sunday of the same week identically', () => {
    expect(isoWeekKey('2024-03-04')).toBe(isoWeekKey('2024-03-10'));
    expect(isoWeekKey('2024-03-10')).not.toBe(isoWeekKey('2024-03-11'));
  });
});

describe('thinOlderToWeekly', () => {
  const daily = (from: string, count: number): { date: string; close: number }[] =>
    Array.from({ length: count }, (_, i) => ({
      date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      close: i + 1,
    }));

  it('keeps the recent window daily and thins the rest to one point a week', () => {
    // 40 days ending 2024-02-09, keeping 14 daily.
    const out = thinOlderToWeekly(daily('2024-01-01', 40), 14);
    const cutoff = '2024-01-27';
    const kept = out.filter((r) => r.date >= cutoff);
    const thinned = out.filter((r) => r.date < cutoff);
    expect(kept.length).toBe(14);
    // Four ISO weeks are wholly or partly before the cutoff.
    expect(thinned.map((r) => r.date)).toEqual([
      '2024-01-07',
      '2024-01-14',
      '2024-01-21',
      '2024-01-26',
    ]);
  });

  it('takes each week\'s last point, never an average', () => {
    // An average is a number no market printed; rebasing it against a real
    // close would compare a synthetic value to a traded one.
    const out = thinOlderToWeekly(daily('2024-01-01', 40), 14);
    // 2024-01-07 is the Sunday of ISO week 1, so it is that week's last point,
    // and its close is the 7th value.
    expect(out[0]).toEqual({ date: '2024-01-07', close: 7 });
  });

  it('leaves the output ascending, so downstream date logic still holds', () => {
    const out = thinOlderToWeekly(daily('2024-01-01', 60), 14);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.date > out[i - 1]!.date).toBe(true);
    }
  });

  it('thins nothing when the whole series is inside the daily window', () => {
    const rows = daily('2024-01-01', 10);
    expect(thinOlderToWeekly(rows, 365)).toEqual(rows);
  });

  it('returns [] for an empty series rather than throwing on the cutoff', () => {
    expect(thinOlderToWeekly([], 730)).toEqual([]);
  });
});
