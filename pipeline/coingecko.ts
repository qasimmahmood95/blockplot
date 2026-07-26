import { get } from './http';
import { marketChartSchema, type MarketChart } from './schema';

const API = 'https://api.coingecko.com/api/v3';

/**
 * The keyless CoinGecko tier caps historical queries at the past 365 days
 * (error 10012 beyond that) and auto-selects daily granularity for ranges
 * over 90 days. Sourcing pre-window history is an open question for M2.
 */
export const PRICE_RANGE_DAYS = '365';

export async function fetchBtcMarketChart(days = PRICE_RANGE_DAYS): Promise<MarketChart> {
  const res = await get(`${API}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`);
  return marketChartSchema.parse(await res.json());
}
