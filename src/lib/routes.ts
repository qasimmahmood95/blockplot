import { CURRENCIES, CURRENCY_META, type Currency } from './currency';

/** Site sections, in header order. The overview is the empty page slug. */
export const PAGES = [
  { page: '', label: 'overview' },
  { page: 'volatility', label: 'volatility & risk' },
  { page: 'cycles', label: 'halving cycles' },
  { page: 'correlation', label: 'correlation' },
  { page: 'dca', label: 'dca' },
  { page: 'flows', label: 'flows' },
  { page: 'network', label: 'network' },
  { page: 'holdings', label: 'holdings' },
] as const;

/**
 * Which section a pathname is on, so the currency switcher can offer the
 * same page in the other currency. The overview is the fallback and must be
 * matched last: testing it first would match every path, which is exactly
 * the bug this function was extracted to make testable.
 */
export function pageForPath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, '');
  return PAGES.find(({ page }) => page && trimmed.endsWith(`/${page}`))?.page ?? '';
}

/**
 * One built page per currency. USD keeps the bare paths (`/volatility/`) so
 * existing links and canonical URLs are unchanged; GBP nests under `/gbp/`.
 * Building per currency means each page ships only the dataset it renders —
 * a client-side toggle would have to ship both.
 */
export function currencyPaths(): { params: { currency: string | undefined }; props: { currency: Currency } }[] {
  return CURRENCIES.map((currency) => ({
    params: { currency: CURRENCY_META[currency].segment || undefined },
    props: { currency },
  }));
}
