import type { Holdings } from '../../pipeline/holdings';
import { CURRENCIES, type Currency } from '../../pipeline/schema';

/**
 * Reading and writing the holdings a reader has entered.
 *
 * This is the one thing on the site that is the reader's own data, so the
 * storage rules are the feature: it lives in this browser's localStorage, it is
 * never sent anywhere, and there is no account to attach it to. The site is
 * static — there is no server that could receive it.
 *
 * Every read is defensive. localStorage is shared with anything else on the
 * origin, survives deploys that change this shape, and can be edited by hand,
 * so a stored value is untrusted input: parse it, validate it, and fall back to
 * "no holdings" rather than rendering NaN.
 */
export const HOLDINGS_KEY = 'blockplot:holdings';

/** Emitted on this tab when the stored holdings change, so islands can re-render. */
export const HOLDINGS_EVENT = 'blockplot:holdingschange';

const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);

/**
 * Coerce anything into holdings, or null. Exported so it can be tested without
 * a DOM: the parsing is the part with edge cases, not the storage call.
 */
export function parseHoldings(raw: string | null): Holdings | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { btc, cost, costCurrency } = parsed as Record<string, unknown>;
  // Finite and non-negative: Infinity and NaN both survive JSON round-trips as
  // strings a hand edit could produce, and both render as garbage.
  if (typeof btc !== 'number' || !Number.isFinite(btc) || btc < 0) return null;
  if (cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) return null;
  if (!isCurrency(costCurrency)) return null;
  return { btc, cost: cost as number | null, costCurrency };
}

/** Stored holdings, or null when unset, unparseable, or invalid. */
export function readHoldings(): Holdings | null {
  try {
    return parseHoldings(localStorage.getItem(HOLDINGS_KEY));
  } catch {
    // Storage can throw outright when cookies are blocked.
    return null;
  }
}

/** Persist holdings and notify this tab. Storage failures degrade to session-only. */
export function writeHoldings(holdings: Holdings): void {
  try {
    localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
  } catch {
    // The figures still render for this page view.
  }
  window.dispatchEvent(new Event(HOLDINGS_EVENT));
}

/** Forget everything. The button that calls this is the point of the feature. */
export function clearHoldings(): void {
  try {
    localStorage.removeItem(HOLDINGS_KEY);
  } catch {
    // Nothing to do; the next read fails closed anyway.
  }
  window.dispatchEvent(new Event(HOLDINGS_EVENT));
}
