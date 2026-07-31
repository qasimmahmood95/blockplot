/**
 * The privacy note, checked by driving the built site rather than by reading it.
 *
 * CLAUDE.md asks for exactly this, and in exactly this way: "Adding or removing
 * a runtime fetch requires re-checking the holdings page's privacy note against
 * the built output — by driving `dist/` and recording the requests, not by
 * reading the diff." Until now the only thing enforcing it was somebody
 * remembering to.
 *
 * It is worth the browser the rest of this suite avoids, for the reason
 * CLAUDE.md gives: the note enumerates the site's requests and which pages make
 * them, so a change here silently makes it false — and that is worse than
 * having no note, because a reader can check this one. Every other claim on the
 * site costs a reader a wrong number. This one costs them a wrong belief about
 * where their own data went.
 *
 * What a static reading cannot answer, and this can:
 *
 *   - a request from a transitive dependency, or from a `<link rel=preconnect>`,
 *     or from a font that turned out not to be self-hosted;
 *   - a request made only *after* the reader types an amount;
 *   - whether the amount is in the URL, the body, or a header of anything at
 *     all — which is the claim the page leads with.
 *
 * The container has no outbound network, and that does not weaken this: a
 * request is recorded when it is *attempted*. Whether CoinGecko answers is not
 * the question.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { globSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Request } from 'playwright';
import { assertFresh, DIST } from './dist';

assertFresh();

/** The hosts the note says the site talks to, and what it says about each. */
const TICKER_HOST = 'api.coingecko.com';
const FEES_HOST = 'mempool.space';

/** Values distinctive enough to find anywhere they might leak. */
const AMOUNT = '3.14159265';
const COST = '271828.18';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * `dist/` served at the path it deploys to.
 *
 * At the root instead, every asset URL 404s and the page under test is a bare
 * HTML document that makes no requests at all — which would pass every
 * assertion here while testing nothing. `lighthouse.yml` records the same trap.
 */
const serve = (root: string, base: string): Promise<{ server: Server; origin: string }> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (!path.startsWith(base)) {
        res.writeHead(404).end();
        return;
      }
      path = path.slice(base.length) || '/';
      let file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });

/**
 * The browser to drive, preferring one the environment already has.
 *
 * A pinned Playwright expects one exact browser build and will refuse anything
 * else, so on a machine that ships its own — this container has 1194 against
 * Playwright's 1234 — the choice is to download a second copy or to point at
 * the one already there. CI has no `/opt/pw-browsers`, so it falls through to
 * Playwright's own, which `deploy.yml` and `ci.yml` install.
 */
const preinstalled = (): string | undefined => {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (root === undefined || root === '' || !existsSync(root)) return undefined;
  const found = globSync(`${root}/chromium-*/chrome-linux/chrome`);
  return found[0];
};

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  ({ server, origin } = await serve(DIST, '/blockplot'));
  const executablePath = preinstalled();
  browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

interface Seen {
  url: string;
  method: string;
  body: string;
  headers: string;
}

/**
 * Load a page, optionally enter an amount, and record everything it asks for.
 *
 * Waits on the network settling *and* a further beat, because the ticker's
 * first fetch is deferred — measuring only up to `load` would miss the one
 * request every page is claimed to make.
 */
const requestsFor = async (path: string, enterAmount = false): Promise<Seen[]> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen: Seen[] = [];
  page.on('request', (request: Request) => {
    seen.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? '',
      headers: JSON.stringify(request.headers()),
    });
  });
  await page.goto(`${origin}/blockplot${path}`, { waitUntil: 'load' });
  if (enterAmount) {
    // Both fields, because both are the reader's own: the holding and what it
    // cost. A check that filled only one would leave the other untested, and
    // the cost basis is the more sensitive of the two.
    const btc = page.locator('input[name="btc"]');
    const cost = page.locator('input[name="cost"]');
    await btc.waitFor({ state: 'visible', timeout: 15_000 });
    await btc.fill(AMOUNT);
    await cost.fill(COST);
    await cost.press('Enter').catch(() => undefined);
    await page.waitForTimeout(2000);
    // It has to have taken, or every assertion below passes on an empty form.
    expect(await btc.inputValue()).toBe(AMOUNT);
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).toContain(AMOUNT);
  }
  await page.waitForTimeout(2500);
  await context.close();
  return seen;
};

const crossOrigin = (seen: Seen[]): string[] => [
  ...new Set(
    seen
      .map((r) => {
        try {
          return new URL(r.url).host;
        } catch {
          return '';
        }
      })
      .filter((host) => host !== '' && !host.startsWith('127.0.0.1')),
  ),
];

describe('what the built site actually requests', () => {
  it(
    'asks only CoinGecko, on a page that is not /network',
    async () => {
      // "Every page — this one included — asks CoinGecko for the live BTC price
      //  about once a minute while the tab is visible, to keep the header
      //  ticker current"
      const seen = await requestsFor('/holdings/');
      expect(crossOrigin(seen)).toEqual([TICKER_HOST]);
    },
    120_000,
  );

  it(
    'asks mempool.space as well, and only on /network',
    async () => {
      // "the network page also asks mempool.space for fee tiers"
      const seen = await requestsFor('/network/');
      expect(crossOrigin(seen).sort()).toEqual([TICKER_HOST, FEES_HOST].sort());
    },
    120_000,
  );

  it(
    'sends nothing anywhere when an amount is entered',
    async () => {
      // "What you enter is written to this browser's localStorage and read back
      //  by this page. It is never transmitted."
      //
      // The strongest form: not that the amount is absent from the two known
      // requests, but that it is absent from *every* request the page makes,
      // in the URL, the body and the headers alike — and that entering it adds
      // no host the page was not already talking to.
      const seen = await requestsFor('/holdings/', true);
      const leaked = seen.filter((r) =>
        [AMOUNT, COST].some(
          (value) => r.url.includes(value) || r.body.includes(value) || r.headers.includes(value),
        ),
      );
      expect(leaked.map((r) => `${r.method} ${r.url}`)).toEqual([]);
      expect(crossOrigin(seen)).toEqual([TICKER_HOST]);
    },
    120_000,
  );

  it(
    'talks to no one else on any page',
    async () => {
      // "no server, no account, and no analytics, so there is nowhere for it to
      //  go even in principle"
      //
      // Every route, not a sample: the note says *every* page, and a single
      // page that had picked up a font host or a beacon would make it false.
      const routes = ['/', '/gbp/', '/methodology/', '/dca/', '/correlation/', '/performance/', '/cycles/'];
      const hosts = new Set<string>();
      for (const route of routes) for (const host of crossOrigin(await requestsFor(route))) hosts.add(host);
      expect([...hosts]).toEqual([TICKER_HOST]);
    },
    240_000,
  );
});
