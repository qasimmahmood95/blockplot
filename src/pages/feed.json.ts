import type { APIRoute } from 'astro';
import { signalFeed } from '../../pipeline/feed';
import { dataFor } from '../lib/data';

/**
 * JSON Feed 1.1 of the same transitions as `rss.xml`, for anything that would
 * rather not parse XML — which, for the automation this is actually useful to,
 * is most things.
 *
 * `date_published` comes from the committed data, so an entry keeps the date
 * it always had and a rebuild does not resurface it as new.
 */
export const GET: APIRoute = ({ site }) => {
  const { signals } = dataFor('usd');
  const entries = signalFeed(signals, { limit: 50 });
  const base = new URL(import.meta.env.BASE_URL, site ?? 'https://qasimmahmood95.github.io');
  const home = base.href.replace(/\/$/, '');

  const body = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'blockplot · signals',
    home_page_url: `${home}/`,
    feed_url: `${home}/feed.json`,
    description:
      'Confirmed changes in BTC volatility and drawdown regimes, computed from a committed daily dataset.',
    language: 'en',
    items: entries.map((entry) => ({
      id: `blockplot:${entry.id}`,
      url: `${home}/`,
      title: entry.title,
      content_text: entry.summary,
      date_published: `${entry.date}T00:00:00Z`,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/feed+json; charset=utf-8' },
  });
};
