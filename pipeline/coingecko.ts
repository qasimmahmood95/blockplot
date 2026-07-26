import { marketChartSchema, type MarketChart } from './schema';

const API = 'https://api.coingecko.com/api/v3';

/**
 * The keyless CoinGecko tier caps historical queries at the past 365 days
 * (error 10012 beyond that) and auto-selects daily granularity for ranges
 * over 90 days. Sourcing pre-window history is an open question for M2.
 */
export const PRICE_RANGE_DAYS = '365';

async function get(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.ok) return res;
    lastError = new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw lastError;
  }
  throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed`);
}

export async function fetchBtcMarketChart(days = PRICE_RANGE_DAYS): Promise<MarketChart> {
  const res = await get(`${API}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`);
  return marketChartSchema.parse(await res.json());
}
