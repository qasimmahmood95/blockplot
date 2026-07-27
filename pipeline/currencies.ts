/**
 * The supported display currencies, in a module with no dependencies.
 *
 * Deliberately not in schema.ts: that file imports zod, and the holdings store
 * needs this list on the client. Importing it from schema.ts pulled zod and
 * every pipeline literal into the bundle of all 17 pages — 76 KB raw, 20 KB
 * gzipped — to obtain two strings. schema.ts builds its enum from this, so
 * there is still one source of truth.
 */
export const CURRENCIES = ['usd', 'gbp'] as const;

export type Currency = (typeof CURRENCIES)[number];
