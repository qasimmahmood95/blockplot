import { CURRENCIES, CURRENCY_META, type Currency } from './currency';

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
