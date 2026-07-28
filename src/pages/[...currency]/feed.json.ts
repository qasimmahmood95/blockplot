import type { APIRoute } from 'astro';
import { signalFeed } from '../../../pipeline/feed';
import { CURRENCY_META, type Currency } from '../../lib/currency';
import { dataFor } from '../../lib/data';
import { currencyPaths } from '../../lib/routes';

export const getStaticPaths = currencyPaths;

/**
 * JSON Feed 1.1 of the same transitions as `rss.xml`, for anything that would
 * rather not parse XML — which, for the automation this is actually useful to,
 * is most things. Per currency for the same reason; see `rss.xml.ts`.
 *
 * `date_published` comes from the committed data, so an entry keeps the date
 * it always had and a rebuild does not resurface it as new.
 */
export const GET: APIRoute = ({ props, site }) => {
  const currency = (props as { currency: Currency }).currency;
  const { signals } = dataFor(currency);
  const entries = signalFeed(signals, { limit: 50 });
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = (site ?? new URL('https://qasimmahmood95.github.io')).origin;
  const segment = CURRENCY_META[currency].segment;
  const home = `${origin}${base}${segment ? `/${segment}` : ''}`;

  const body = {
    version: 'https://jsonfeed.org/version/1.1',
    title: `blockplot · signals · ${CURRENCY_META[currency].label}`,
    home_page_url: `${home}/`,
    feed_url: `${home}/feed.json`,
    description: `Confirmed changes in BTC volatility and drawdown regimes, measured in ${CURRENCY_META[currency].label} and computed from a committed daily dataset.`,
    language: 'en',
    items: entries.map((entry) => ({
      id: `blockplot:${currency}:${entry.id}`,
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
