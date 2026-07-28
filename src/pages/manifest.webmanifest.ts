import type { APIRoute } from 'astro';

/**
 * PWA manifest, generated rather than static so the scope and icon paths
 * follow `BASE_URL` — this deploys under `/blockplot/`, and a manifest with a
 * root scope silently fails to install.
 *
 * `start_url` is the USD overview: the currency is a route, not a preference,
 * and an installed icon has to land somewhere specific.
 */
export const GET: APIRoute = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const body = {
    name: 'blockplot — Bitcoin analytics',
    short_name: 'blockplot',
    description:
      'Bitcoin financial analytics built from a versioned, pipeline-committed dataset.',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    // Matches --bg and --accent in tokens.css, dark pairing: an installed icon
    // sits on an arbitrary home screen and the dark base reads on both.
    background_color: '#16130f',
    theme_color: '#bf4a08',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      // A separate file: the same art at 'any' framing has ink 4.9% outside
      // the maskable safe zone, so Android crops the chart's corners.
      { src: `${base}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/manifest+json' },
  });
};
