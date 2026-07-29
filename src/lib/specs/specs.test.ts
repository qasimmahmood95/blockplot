import { describe, expect, it } from 'vitest';
import {
  DCA_LEGEND_BASE,
  dcaFormatters,
  dcaLegendHtml,
  dcaTiles,
  dcaTilesHtml,
  defaultStartDate,
  legendSwatch,
  wealthExtent,
} from './dca-shared';
import { bandFill, pairLabel, regimeFrom, type Segment } from './correlation';
import { billions } from './flows';
import { volColor } from './vol';
import { cycleColor } from './cycles';

describe('defaultStartDate', () => {
  it('goes three years back from the last close', () => {
    expect(defaultStartDate('2010-07-18', '2026-07-28')).toBe('2023-07-28');
  });

  it('clamps to the start of history when three years reaches past it', () => {
    expect(defaultStartDate('2025-01-01', '2026-07-28')).toBe('2025-01-01');
  });

  it('rolls 29 February forward rather than producing an invalid date', () => {
    // 2021 has no 29 February; UTC arithmetic gives 1 March.
    expect(defaultStartDate('2010-01-01', '2024-02-29')).toBe('2021-03-01');
  });

  it('returns the first date when history is a single day', () => {
    expect(defaultStartDate('2026-07-28', '2026-07-28')).toBe('2026-07-28');
  });
});

describe('wealthExtent', () => {
  it('spans both series', () => {
    expect(
      wealthExtent(
        [
          { date: new Date(0), wealth: 10 },
          { date: new Date(0), wealth: 30 },
        ],
        [
          { date: new Date(0), wealth: 5 },
          { date: new Date(0), wealth: 50 },
        ],
      ),
    ).toEqual([5, 50]);
  });

  it('ignores the held stack by taking only the two it is given', () => {
    expect(wealthExtent([{ date: new Date(0), wealth: 7 }], [])).toEqual([7, 7]);
  });

  it('is unbounded on empty input, which the caller treats as no chart', () => {
    expect(wealthExtent([], [])).toEqual([Infinity, -Infinity]);
  });
});

describe('correlation helpers', () => {
  const segment = (over: Partial<Segment>): Segment => ({
    regime: 'positive',
    startDate: '2024-01-01',
    confirmedFrom: '2024-01-01',
    endDate: '2024-03-01',
    observations: 60,
    days: 60,
    meanCorr: 0.42,
    ...over,
  });

  it('paints co-moving and inverse, and deliberately not decoupled', () => {
    expect(bandFill('positive')).toBe('var(--pos)');
    expect(bandFill('negative')).toBe('var(--neg)');
    expect(bandFill('neutral')).toBeNull();
  });

  it('names a pair from the asset labels, falling back to the raw key', () => {
    expect(pairLabel({ a: 'btc', b: 'sp500' })).toBe('BTC – S&P 500');
    expect(pairLabel({ a: 'btc', b: 'nikkei' })).toBe('BTC – nikkei');
  });

  it('quotes the confirmation date only when it differs from the start', () => {
    expect(regimeFrom(segment({}))).toBe('2024-01-01');
    expect(regimeFrom(segment({ confirmedFrom: '2024-01-11' }))).toBe(
      '2024-01-01 (confirmed 2024-01-11)',
    );
  });
});

describe('axis formatting', () => {
  it('switches from billions to trillions at the threshold', () => {
    expect(billions(999e9)).toBe('$999B');
    expect(billions(1e12)).toBe('$1.00T');
    expect(billions(2.345e12)).toBe('$2.35T');
  });
});

describe('colour ramps', () => {
  it('maps each volatility window to its own step, and the unknown to ink', () => {
    expect(volColor('30d')).toBe('var(--cycle-2)');
    expect(volColor('90d')).toBe('var(--cycle-3)');
    expect(volColor('365d')).toBe('var(--cycle-4)');
    expect(volColor('7d')).toBe('var(--ink)');
  });

  it('walks the cycle ramp oldest to newest and falls back past its end', () => {
    expect([0, 1, 2, 3].map(cycleColor)).toEqual([
      'var(--cycle-1)',
      'var(--cycle-2)',
      'var(--cycle-3)',
      'var(--cycle-4)',
    ]);
    expect(cycleColor(4)).toBe('var(--accent)');
  });
});

describe('dcaTiles', () => {
  const money = (v: number): string => `$${v.toFixed(0)}`;
  const signedPct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const base = {
    totalInvested: 15700,
    totalFees: 79,
    buys: 157,
    btcAccumulated: 0.2488,
    dcaFinal: 15852,
    dcaReturnPct: 1,
    lumpFinal: 34068,
    lumpReturnPct: 117,
    delta: 18216,
  };
  const tiles = (over: Partial<typeof base> = {}): ReturnType<typeof dcaTiles> =>
    dcaTiles({ ...base, ...over }, money, signedPct);

  it('reports four figures, in the order the grid shows them', () => {
    expect(tiles().map((t) => t.label)).toEqual([
      'Invested',
      'BTC accumulated',
      'DCA value now',
      'Lump sum now',
    ]);
  });

  it('says which strategy leads, and by how much', () => {
    expect(tiles().at(-1)?.sub).toBe('+117.0% · leads by $18216');
    expect(tiles({ delta: -500 }).at(-1)?.sub).toBe('+117.0% · trails by $500');
  });

  it('calls a hair either way even, rather than leading by nothing', () => {
    // The threshold exists so a rounding-scale difference does not read as a
    // result; either side of it must still be reported as a direction.
    expect(tiles({ delta: 0.004 }).at(-1)?.sub).toContain('even with DCA');
    expect(tiles({ delta: -0.004 }).at(-1)?.sub).toContain('even with DCA');
    expect(tiles({ delta: 0.005 }).at(-1)?.sub).toContain('leads');
  });

  it('agrees with itself on singular and plural buys', () => {
    expect(tiles({ buys: 1 })[0]?.sub).toBe('1 buy · fees $79');
    expect(tiles({ buys: 2 })[0]?.sub).toBe('2 buys · fees $79');
    expect(tiles({ buys: 0 })[0]?.sub).toBe('0 buys · fees $79');
  });

  it('tones a loss down and a gain up, with zero counting as a gain', () => {
    expect(tiles({ dcaReturnPct: -0.1 })[2]?.tone).toBe('down');
    expect(tiles({ dcaReturnPct: 0 })[2]?.tone).toBe('up');
    expect(tiles({ lumpReturnPct: -50 }).at(-1)?.tone).toBe('down');
  });

  it('keeps BTC at four decimals, where the other figures are whole units', () => {
    // `toFixed` rounds the stored double, not the decimal as written, so an
    // exact-looking half can go either way: 0.24875 gives 0.2487 and 0.24885
    // gives 0.2488 — both down, neither "round half up". Pinned because the
    // figure a reader sees is the one this produces, and a future switch to a
    // different rounding helper would change published numbers.
    expect(tiles({ btcAccumulated: 0.24875 })[1]?.value).toBe('0.2487');
    expect(tiles({ btcAccumulated: 0.24885 })[1]?.value).toBe('0.2488');
    expect(tiles({ btcAccumulated: 0.12345 })[1]?.value).toBe('0.1235');
    expect(tiles()[0]?.value).toBe('$15700');
  });
});

describe('dcaFormatters', () => {
  it('gives both currencies the same shape, differing only in symbol', () => {
    expect(dcaFormatters('USD').money(15700)).toBe('$15,700');
    expect(dcaFormatters('GBP').money(15700)).toBe('£15,700');
  });

  it('signs a percentage on both sides of zero', () => {
    const { signedPct } = dcaFormatters('USD');
    expect(signedPct(1.04)).toBe('+1.0%');
    // -2.0%, not -2.1%: same binary-rounding characteristic as above.
    expect(signedPct(-2.05)).toBe('-2.0%');
    expect(signedPct(-2.06)).toBe('-2.1%');
    expect(signedPct(0)).toBe('+0.0%');
  });
});

describe('dcaTilesHtml', () => {
  it('emits the grid markup both renderers use, exactly', () => {
    // Pinned as a whole string rather than probed with selectors: the point of
    // this function is that one definition of the markup exists, so the test
    // that matters is the one a change to either renderer would have to update.
    expect(
      dcaTilesHtml([{ label: 'Invested', value: '$15,700', sub: '157 buys', tone: '' }]),
    ).toBe(
      '<div class="stat"><dt>Invested</dt><dd class="num">$15,700</dd>' +
        '<dd class="sub num">157 buys</dd></div>',
    );
  });

  it('carries the tone onto the value, and omits it when there is none', () => {
    expect(dcaTilesHtml([{ label: 'l', value: 'v', sub: 's', tone: 'down' }])).toContain(
      'class="num down"',
    );
    expect(dcaTilesHtml([{ label: 'l', value: 'v', sub: 's', tone: '' }])).toContain('class="num"');
  });

  it('concatenates tiles with nothing between them', () => {
    const one = { label: 'a', value: 'b', sub: 'c', tone: '' } as const;
    expect(dcaTilesHtml([one, one])).toBe(dcaTilesHtml([one]) + dcaTilesHtml([one]));
  });

  it('escapes text so a label can never open a tag', () => {
    expect(dcaTilesHtml([{ label: '<b>&"x"', value: 'v', sub: 's', tone: '' }])).toContain(
      '<dt>&lt;b&gt;&amp;&quot;x&quot;</dt>',
    );
  });
});

describe('dcaLegendHtml', () => {
  it('writes the swatch as an attribute, not through the CSSOM', () => {
    // `background:var(--accent)` with no space: assigning this through
    // `element.style` would re-serialize it as `background: var(--accent);`,
    // which never compares equal to the markup the build emits — the reason
    // the skip-if-unchanged guard was inert on this element.
    expect(dcaLegendHtml(DCA_LEGEND_BASE)).toBe(
      '<span class="legend-item"><span class="legend-swatch" style="background:var(--accent)">' +
        '</span>DCA</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:' +
        legendSwatch(DCA_LEGEND_BASE[1] as never) +
        '"></span>lump sum</span>',
    );
  });

  it('renders nothing for no entries, which is how the notice state clears it', () => {
    expect(dcaLegendHtml([])).toBe('');
  });
});

describe('legendSwatch', () => {
  it('paints a solid entry with the colour itself', () => {
    expect(legendSwatch({ label: 'DCA', color: 'var(--accent)', dash: '' })).toBe('var(--accent)');
  });

  it('gives dashed and dotted different periods, so they read apart', () => {
    const dashed = legendSwatch({ label: 'l', color: 'red', dash: 'dashed' });
    const dotted = legendSwatch({ label: 'h', color: 'red', dash: 'dotted' });
    expect(dashed).toContain('0 3px');
    expect(dotted).toContain('0 1px');
    expect(dashed).not.toBe(dotted);
  });
});
