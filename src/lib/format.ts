/**
 * The site's percentage: grouped, one decimal, U+2212 for the minus sign.
 *
 * One definition because there were five, and they disagreed in three ways at
 * once. `/holding-periods` says its diagonal prints "exactly the yearly figure
 * the overview heatmap publishes for the same year" — a claim a reader checks by
 * opening two tabs. On the same data the two tabs read:
 *
 *     2018    −69.4%   here      -69.3%   overview
 *     2011  +1,390.0%  here    +1390.0%   overview
 *
 * Neither difference is a number being wrong. `toFixed(1)` rounds the binary
 * double nearest −69.35 downward and `Intl` rounds it half-away-from-zero; one
 * formatter grouped thousands and the other did not; one wrote U+2212 and the
 * other an ASCII hyphen, so 201 figures on eleven routes used one minus sign and
 * 20 on two routes used another. A claim of exactness cannot survive being
 * checked against that, and the fix is not to soften the claim.
 *
 * U+2212 rather than the hyphen because these are figures in tabular mono, where
 * a hyphen is visibly short and sits low; it is also what a screen reader
 * announces as "minus" rather than as punctuation.
 */
const percent = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Signed percentage with one decimal, e.g. "+4.2%" or "−69.4%". */
export function formatPct(value: number): string {
  return `${value >= 0 ? '+' : '−'}${percent.format(Math.abs(value))}%`;
}

/** Unsigned percentage with one decimal, e.g. "48.3%". */
export function formatUnsignedPct(value: number): string {
  return `${percent.format(value)}%`;
}

/** Two-decimal ratio (Sharpe/Sortino); an em dash when the ratio is undefined. */
export function formatRatio(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

/** Price multiple, e.g. "×3.42"; an em dash when unavailable. */
export function formatMultiple(value: number | null): string {
  return value === null ? '—' : `×${value.toFixed(2)}`;
}

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Compact USD, e.g. "$2.42T" or "$138B". */
export function formatUsdCompact(value: number): string {
  return usdCompact.format(value);
}
