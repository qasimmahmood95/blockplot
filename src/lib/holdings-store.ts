import { MAX_BTC, MAX_COST, type Holdings } from '../../pipeline/holdings';
import { CURRENCIES, type Currency } from '../../pipeline/currencies';

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
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { btc, cost, costCurrency } = parsed as Record<string, unknown>;
  // Bounded, not merely finite: 1e999 parses to Infinity, and 1e308 is finite
  // but overflows the moment it is multiplied by a price.
  if (typeof btc !== 'number' || !Number.isFinite(btc) || btc < 0 || btc > MAX_BTC) return null;
  if (!isCurrency(costCurrency)) return null;
  // Narrowed by the compiler rather than asserted, so a later edit to this
  // guard cannot silently let a non-number through.
  let checkedCost: number | null = null;
  if (cost !== null) {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
      return null;
    }
    checkedCost = cost + 0;
  }
  // `+ 0` also normalises -0, which passes `< 0` and would otherwise leave the
  // header (hidden at `btc <= 0`) disagreeing with the panel (which renders).
  return { btc: btc + 0, cost: checkedCost, costCurrency };
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

/**
 * Mirror the browser's cross-tab `storage` event onto the same-tab one, so a
 * second tab updates instead of showing a figure that is quietly stale. Fires
 * only in tabs that did not make the change, which is exactly the gap the
 * custom event leaves.
 */
export function watchOtherTabs(): void {
  window.addEventListener('storage', (event) => {
    if (event.key === HOLDINGS_KEY) window.dispatchEvent(new Event(HOLDINGS_EVENT));
  });
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
