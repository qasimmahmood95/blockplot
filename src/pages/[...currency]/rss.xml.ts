import type { APIRoute } from 'astro';
import { escapeXml, rfc822, signalFeed } from '../../../pipeline/feed';
import { CURRENCY_META, type Currency } from '../../lib/currency';
import { dataFor } from '../../lib/data';
import { currencyPaths } from '../../lib/routes';

export const getStaticPaths = currencyPaths;

/**
 * RSS of the signal transitions, one feed per currency.
 *
 * Per currency because the states genuinely differ, which the first version of
 * this file got wrong: it shipped a single USD feed on the reasoning that "the
 * two trees agree on every band, being the same series converted at each day's
 * rate". They do not. M9's rule is that GBP metrics are recomputed from
 * converted closes, so sterling's own volatility enters the band test — and on
 * the committed data USD reads `normal since 2026-04-30` while GBP reads `low
 * since 2026-07-18`, with a different number of spans. A GBP reader was being
 * offered a feed that contradicted the page it was linked from.
 *
 * `lastBuildDate` is the newest entry's date, not the build's. This is
 * regenerated every six hours by the scheduled pipeline; stamping it with
 * "now" would tell every subscriber the feed had changed, four times a day,
 * forever.
 */
export const GET: APIRoute = ({ props, site }) => {
  const currency = (props as { currency: Currency }).currency;
  const { signals } = dataFor(currency);
  const entries = signalFeed(signals, { limit: 50 });
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = (site ?? new URL('https://qasimmahmood95.github.io')).origin;
  const segment = CURRENCY_META[currency].segment;
  const home = `${origin}${base}${segment ? `/${segment}` : ''}`;
  const label = CURRENCY_META[currency].label;
  const latest = entries[0]?.date ?? signals.asOf;

  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(home)}/</link>
      <guid isPermaLink="false">blockplot:${escapeXml(currency)}:${escapeXml(entry.id)}</guid>
      <pubDate>${rfc822(entry.date)}</pubDate>
      <description>${escapeXml(entry.summary)}</description>
    </item>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>blockplot · signals · ${escapeXml(label)}</title>
    <link>${escapeXml(home)}/</link>
    <description>Confirmed changes in BTC volatility and drawdown regimes, measured in ${escapeXml(label)} and computed from a committed daily dataset.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  // In `output: 'static'` these headers are discarded — the host serves by
  // file extension — but they are correct for `astro dev` and for any future
  // adapter, and wrong headers here would be a trap for whoever adds one.
  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
};
