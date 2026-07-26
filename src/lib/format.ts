const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** Signed percentage with one decimal, e.g. "+4.2%". */
export function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/** Unsigned percentage with one decimal, e.g. "48.3%". */
export function formatUnsignedPct(value: number): string {
  return `${value.toFixed(1)}%`;
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
