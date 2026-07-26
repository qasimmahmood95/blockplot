import { describe, expect, it } from 'vitest';
import { marketChartSchema } from './schema';

describe('marketChartSchema', () => {
  it('accepts the documented shape and strips extra keys', () => {
    expect(
      marketChartSchema.parse({ prices: [[1704067200000, 42000]], market_caps: [] }),
    ).toEqual({ prices: [[1704067200000, 42000]] });
  });

  it('rejects malformed price points', () => {
    expect(() => marketChartSchema.parse({ prices: [[1704067200000, '42000']] })).toThrow();
    expect(() => marketChartSchema.parse({})).toThrow();
  });
});
