import { describe, expect, it } from 'vitest';
import { parseBlockchainChart } from './history';

describe('parseBlockchainChart', () => {
  it('drops zero-price rows, sorts, and collapses to one price per UTC day', () => {
    // 1279324800 = 2010-07-17T00:00:00Z; the second 2010-07-19 point (12:00) wins.
    expect(
      parseBlockchainChart({
        status: 'ok',
        values: [
          { x: 1279497600, y: 0.08 }, // 2010-07-19 00:00, out of order
          { x: 1279324800, y: 0 }, // pre-market day, dropped
          { x: 1279411200, y: 0.05 }, // 2010-07-18
          { x: 1279540800, y: 0.09 }, // 2010-07-19 12:00, same day, last wins
        ],
      }),
    ).toEqual([
      { date: '2010-07-18', price: 0.05 },
      { date: '2010-07-19', price: 0.09 },
    ]);
  });

  it('rejects payloads without values, all-zero series, and non-finite prices', () => {
    expect(() => parseBlockchainChart({ status: 'ok' })).toThrow();
    expect(() => parseBlockchainChart({ values: [] })).toThrow();
    expect(() => parseBlockchainChart({ values: [{ x: 1279324800, y: 0 }] })).toThrow(
      'no positive-price rows',
    );
    expect(() => parseBlockchainChart({ values: [{ x: 1279324800, y: Infinity }] })).toThrow();
  });
});
