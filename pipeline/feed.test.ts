import { describe, expect, it } from 'vitest';
import { escapeXml, rfc822, signalFeed } from './feed';
import type { SignalsDataset } from './schema';

const base = {
  schemaVersion: 1 as const,
  currency: 'usd' as const,
  fetchedAt: '2026-07-28T09:45:00.000Z',
  asOf: '2026-07-28',
  thresholds: {
    volWindowDays: 90,
    volLowPct: 35,
    volHighPct: 60,
    drawdownBandsPct: [-10, -20, -30, -50],
    confirmDays: 10,
  },
  vol: null,
  drawdown: null,
  ath: null,
  cycle: null,
  dominance: null,
};

const span = (state: string, since: string, observations = 30) => ({ state, since, observations });

describe('signalFeed', () => {
  it('emits one entry per transition, never one per day', () => {
    // The committed volatility history has four spans across a year. Three
    // transitions, not 365 entries.
    const signals: SignalsDataset = {
      ...base,
      vol: {
        state: 'normal',
        since: '2026-04-30',
        observations: 90,
        pending: null,
        history: [
          span('low', '2025-07-29', 90),
          span('normal', '2025-10-27', 163),
          span('high', '2026-04-08', 22),
          span('normal', '2026-04-30', 90),
        ],
      },
    };
    const feed = signalFeed(signals);
    expect(feed).toHaveLength(3);
    expect(feed.map((e) => e.date)).toEqual(['2026-04-30', '2026-04-08', '2025-10-27']);
  });

  it('skips the opening span, which is where the data starts, not an event', () => {
    // The 2025-07-29 span above is the first date the source retains. Dating a
    // "transition" to it would report the retention window as market news.
    const signals: SignalsDataset = {
      ...base,
      vol: {
        state: 'high',
        since: '2026-01-10',
        observations: 20,
        pending: null,
        history: [span('low', '2025-07-29'), span('high', '2026-01-10')],
      },
    };
    expect(signalFeed(signals).map((e) => e.date)).toEqual(['2026-01-10']);
  });

  it('reads the direction of a drawdown move', () => {
    const signals: SignalsDataset = {
      ...base,
      drawdown: {
        state: '-20',
        since: '2026-03-01',
        observations: 40,
        pending: null,
        history: [span('0', '2025-07-29'), span('-30', '2026-01-30'), span('-20', '2026-03-01')],
      },
    };
    const feed = signalFeed(signals);
    expect(feed[1]?.title).toBe('Drawdown deepened past -30% from the running peak');
    expect(feed[0]?.title).toBe('Drawdown recovered to -20%');
  });

  it('says "back at the peak" rather than "past 0%"', () => {
    const signals: SignalsDataset = {
      ...base,
      drawdown: {
        state: '0',
        since: '2026-05-01',
        observations: 10,
        pending: null,
        history: [span('-10', '2025-08-01'), span('0', '2026-05-01')],
      },
    };
    expect(signalFeed(signals)[0]?.title).toBe('Drawdown recovered to the peak');
  });

  it('gives every entry an id derived from its data, not its position', () => {
    // Ids have to survive a rebuild, or every reader sees the whole feed as
    // new on every six-hourly pipeline run.
    const signals: SignalsDataset = {
      ...base,
      vol: {
        state: 'high',
        since: '2026-01-10',
        observations: 20,
        pending: null,
        history: [span('low', '2025-07-29'), span('high', '2026-01-10')],
      },
    };
    expect(signalFeed(signals)[0]?.id).toBe('vol-2026-01-10');
    // Same input, same ids — the property that makes the feed stable.
    expect(signalFeed(signals)).toEqual(signalFeed(signals));
  });

  it('interleaves both signals newest-first, with a total order on ties', () => {
    const signals: SignalsDataset = {
      ...base,
      vol: {
        state: 'high',
        since: '2026-02-02',
        observations: 10,
        pending: null,
        history: [span('low', '2025-01-01'), span('high', '2026-02-02')],
      },
      drawdown: {
        state: '-10',
        since: '2026-02-02',
        observations: 10,
        pending: null,
        history: [span('0', '2025-01-01'), span('-10', '2026-02-02')],
      },
    };
    // Same date: ordered by id so the output does not depend on which history
    // happened to be walked first.
    expect(signalFeed(signals).map((e) => e.id)).toEqual(['drawdown-2026-02-02', 'vol-2026-02-02']);
  });

  it('limits without reordering', () => {
    const signals: SignalsDataset = {
      ...base,
      vol: {
        state: 'normal',
        since: '2026-04-30',
        observations: 90,
        pending: null,
        history: [
          span('low', '2025-07-29'),
          span('normal', '2025-10-27'),
          span('high', '2026-04-08'),
          span('normal', '2026-04-30'),
        ],
      },
    };
    expect(signalFeed(signals, { limit: 2 }).map((e) => e.date)).toEqual([
      '2026-04-30',
      '2026-04-08',
    ]);
  });

  it('is empty when nothing has ever turned', () => {
    expect(signalFeed(base)).toEqual([]);
    expect(
      signalFeed({
        ...base,
        vol: {
          state: 'low',
          since: '2025-07-29',
          observations: 300,
          pending: null,
          history: [span('low', '2025-07-29', 300)],
        },
      }),
    ).toEqual([]);
  });
});

describe('escapeXml', () => {
  it('escapes the five characters that break XML', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });

  it('escapes ampersands once, not twice', () => {
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });
});

describe('rfc822', () => {
  it('is midnight UTC on the day, because the data has no finer resolution', () => {
    expect(rfc822('2026-04-30')).toBe('Thu, 30 Apr 2026 00:00:00 GMT');
  });

  it('throws rather than emitting "Invalid Date" into a feed', () => {
    expect(() => rfc822('not-a-date')).toThrow('not a date');
  });
});
