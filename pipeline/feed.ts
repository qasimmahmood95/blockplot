import type { SignalsDataset } from './schema';

/**
 * The feed: one entry per confirmed signal transition.
 *
 * Not one per day. A daily entry saying nothing changed is noise in a reader,
 * and a feed nobody can skim is a feed nobody reads. What is worth an entry is
 * the thing the signals page exists to report — a band actually turning over,
 * which on this data happens four or five times a year per signal.
 *
 * Every entry is derived from the committed `history` arrays, so it is a pure
 * function of data already on disk. That matters more than it sounds: it means
 * a rebuild produces byte-identical entries with the dates they always had.
 * Stamping entries at build time instead would republish the whole feed as new
 * on every pipeline run, six-hourly, forever.
 *
 * Ids are derived the same way, from the signal and the date it turned, so an
 * entry keeps its identity across rebuilds and readers do not see duplicates.
 */

export interface FeedEntry {
  /** Stable across rebuilds: signal name plus the date of the transition. */
  id: string;
  /** The date the band turned, from the committed data — never build time. */
  date: string;
  title: string;
  summary: string;
}

const VOL_WORDING: Record<string, string> = {
  low: 'quiet',
  normal: 'ordinary',
  high: 'turbulent',
};

/**
 * Only ever called for a deepening move, so `state` is always a real band —
 * a recovery to 0 goes through the other branch, which words it as reaching
 * the peak. An earlier version handled '0' here too; it was unreachable, and
 * unreachable branches are where wrong behaviour hides.
 */
const deepenedWording = (state: string): string => `past ${state}% from the running peak`;

/**
 * Confirmed transitions, newest first.
 *
 * The first span of each history is skipped deliberately: it is where the
 * series starts, not something that happened. Reporting it would date a
 * "transition" to whichever day the data begins, which is an artefact of the
 * source's retention window and not an event in the market.
 */
export function signalFeed(
  signals: SignalsDataset,
  opts: { limit?: number } = {},
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const { volWindowDays, confirmDays } = signals.thresholds;

  const vol = signals.vol?.history ?? [];
  for (let i = 1; i < vol.length; i++) {
    const to = vol[i] as { state: string; since: string };
    const from = vol[i - 1] as { state: string };
    entries.push({
      id: `vol-${to.since}`,
      date: to.since,
      title: `Volatility turned ${VOL_WORDING[to.state] ?? to.state}`,
      summary:
        `${volWindowDays}-day realised volatility moved from the ${from.state} band to the ` +
        `${to.state} band, confirmed by ${confirmDays} consecutive readings and dated to the ` +
        `first of them.`,
    });
  }

  const dd = signals.drawdown?.history ?? [];
  for (let i = 1; i < dd.length; i++) {
    const to = dd[i] as { state: string; since: string };
    const from = dd[i - 1] as { state: string };
    const deepened = Number(to.state) < Number(from.state);
    entries.push({
      id: `drawdown-${to.since}`,
      date: to.since,
      title: deepened ? `Drawdown deepened ${deepenedWording(to.state)}` : `Drawdown recovered to ${to.state === '0' ? 'the peak' : `${to.state}%`}`,
      summary:
        `BTC moved from the ${from.state}% band to the ${to.state}% band, confirmed by ` +
        `${confirmDays} consecutive readings and dated to the first of them.`,
    });
  }

  // Descending by date; ties broken by id so the order is total and stable
  // rather than dependent on the order the two histories were walked.
  entries.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)));
  // Ids are a feed's identity: a duplicate guid makes readers merge two
  // distinct events into one, silently. The pipeline cannot produce one today
  // (span start dates are distinct by construction), but nothing in the schema
  // forbids it, so it fails the build rather than shipping.
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new Error('signalFeed: duplicate entry id — two spans share a start date');
  }
  return opts.limit === undefined ? entries : entries.slice(0, opts.limit);
}

/** XML text escaping. Titles and summaries are ours, but ours can change. */
export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * RFC-822 date for RSS, at midnight UTC on the entry's day.
 *
 * The data has day resolution and nothing finer, so inventing a time of day
 * would be a precision the dataset does not have.
 */
export function rfc822(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`rfc822: not a date: ${date}`);
  return d.toUTCString();
}
