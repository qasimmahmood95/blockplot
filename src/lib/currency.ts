export const CURRENCIES = ['usd', 'gbp'] as const;
export type Currency = (typeof CURRENCIES)[number];

interface CurrencyMeta {
  code: string;
  symbol: string;
  label: string;
  /** URL segment: USD is the default currency and lives at the site root. */
  segment: string;
}

export const CURRENCY_META: Record<Currency, CurrencyMeta> = {
  usd: { code: 'USD', symbol: '$', label: 'USD', segment: '' },
  gbp: { code: 'GBP', symbol: '£', label: 'GBP', segment: 'gbp' },
};

/**
 * Shown on every GBP page: the distinction between re-denomination and
 * relabelling is the whole reason these pages exist, so it is stated rather
 * than assumed.
 */
export const GBP_METHOD_NOTE =
  'GBP figures are not converted USD: each daily close is converted at that day’s GBP/USD rate ' +
  '(ECB reference rates, with the last quote carried across weekends and holidays) and every ' +
  'metric recomputed from the converted series, so a GBP reader sees the returns they actually ' +
  'experienced.';

/** The GBP note when the page is in GBP, otherwise nothing. */
export const fxNote = (currency: Currency): string =>
  currency === 'gbp' ? ` ${GBP_METHOD_NOTE}` : '';

/** Coerce a route param into a currency; anything unknown falls back to USD. */
export function toCurrency(value: string | undefined): Currency {
  return value === 'gbp' ? 'gbp' : 'usd';
}

/**
 * Path for a page in a currency. USD keeps the bare paths so existing links
 * and the canonical URLs are unchanged; GBP nests under /gbp/.
 */
export function currencyPath(base: string, currency: Currency, page: string): string {
  const root = base.replace(/\/$/, '');
  const segment = CURRENCY_META[currency].segment;
  const prefix = segment ? `${root}/${segment}` : root;
  return page ? `${prefix}/${page}/` : `${prefix}/`;
}

export function currencyFormatters(currency: Currency): {
  money: Intl.NumberFormat;
  compact: Intl.NumberFormat;
} {
  const code = CURRENCY_META[currency].code;
  return {
    money: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }),
    compact: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      notation: 'compact',
      maximumFractionDigits: 2,
    }),
  };
}
