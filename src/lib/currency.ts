import { CURRENCIES, type Currency } from '../../pipeline/currencies';

export { CURRENCIES, type Currency };

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
  '(central-bank reference rates, with the last quote carried across weekends and holidays) and every ' +
  'metric recomputed from the converted series, so a GBP reader sees the returns they actually ' +
  'experienced.';

/**
 * The exception to the note above, for the pages that show ether's figures.
 *
 * Ether is quoted natively as ETH-GBP rather than converted (M17). The note
 * says "each daily close is converted", which is true of everything except
 * that one series — so on the two pages that actually display ether numbers,
 * saying only the general rule states something the data contradicts. The
 * methodology page carried the exception and the pages carrying the figures did
 * not, which is the wrong way round.
 */
export const GBP_ETH_NOTE =
  'Ether is the one exception: it is quoted natively in GBP from its own market rather than ' +
  'converted, because a sterling holder’s ether really does trade in sterling. The pipeline ' +
  'checks the two routes against each other every run — see the methodology page.';

/** The ether caveat when the page is in GBP and actually shows ether, otherwise nothing. */
export const ethNote = (currency: Currency, hasEth: boolean): string =>
  currency === 'gbp' && hasEth ? ` ${GBP_ETH_NOTE}` : '';

/**
 * Correlation-page caveat. The dollar index measures the dollar itself, so
 * converting it into GBP would be meaningless; it stays as quoted while BTC,
 * the S&P 500 and gold are re-denominated.
 */
export const GBP_DXY_NOTE =
  'The dollar index is a measure of the dollar and is left unconverted, so its pairs compare a ' +
  'GBP-denominated series against a dollar-denominated one — which is exactly the exposure a GBP ' +
  'holder has to it.';

/** The DXY caveat when the page is in GBP, otherwise nothing. */
export const dxyNote = (currency: Currency): string =>
  currency === 'gbp' ? ` ${GBP_DXY_NOTE}` : '';

/** The GBP note when the page is in GBP, otherwise nothing. */
export const fxNote = (currency: Currency): string =>
  currency === 'gbp' ? ` ${GBP_METHOD_NOTE}` : '';

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
