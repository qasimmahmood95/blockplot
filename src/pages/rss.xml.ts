import type { APIRoute } from 'astro';
import { escapeXml, rfc822, signalFeed } from '../../pipeline/feed';
import { dataFor } from '../lib/data';

/**
 * RSS for the signal transitions.
 *
 * USD only, and deliberately so: a band is a property of BTC's own price
 * behaviour, and the two currency trees agree on every one of them because
 * they are built from the same USD series converted at each day's rate. Two
 * feeds saying the same thing on different URLs would only split subscribers.
 *
 * `lastBuildDate` is the newest entry's date, not the build's. This file is
 * regenerated every six hours by the scheduled pipeline; stamping it with
 * "now" would tell every reader the feed had changed, four times a day,
 * forever.
 */
export const GET: APIRoute = ({ site }) => {
  const { signals } = dataFor('usd');
  const entries = signalFeed(signals, { limit: 50 });
  const base = new URL(import.meta.env.BASE_URL, site ?? 'https://qasimmahmood95.github.io');
  const home = base.href.replace(/\/$/, '');
  const latest = entries[0]?.date ?? signals.asOf;

  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(home)}/</link>
      <guid isPermaLink="false">blockplot:${escapeXml(entry.id)}</guid>
      <pubDate>${rfc822(entry.date)}</pubDate>
      <description>${escapeXml(entry.summary)}</description>
    </item>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>blockplot · signals</title>
    <link>${escapeXml(home)}/</link>
    <description>Confirmed changes in BTC volatility and drawdown regimes, computed from a committed daily dataset.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
};
