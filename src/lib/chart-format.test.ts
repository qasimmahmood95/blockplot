import { describe, expect, it } from 'vitest';
import { clipNote, compactMoney, COMPACT_ABOVE, CLIP_NOTE_FRACTION } from './chart-format';

const exact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const fmt = (v: number): string =>
  compactMoney(
    v,
    (x) => exact.format(x),
    (x) => compact.format(x),
  );

describe('compactMoney', () => {
  it('spells out figures a reader would want exactly', () => {
    expect(fmt(0)).toBe('$0');
    expect(fmt(23_486)).toBe('$23,486');
    expect(fmt(999_999)).toBe('$999,999');
  });

  it('switches to compact at seven figures, and not before', () => {
    // The boundary is the whole rule; a mutation moving it up silently
    // restores the overflow this exists to prevent. Measured: at 360px,
    // `$6,067,043` truncates and `$6.07M` does not.
    expect(COMPACT_ABOVE).toBe(1e6);
    expect(fmt(999_998)).toBe('$999,998');
    expect(fmt(6_067_043)).toBe('$6.07M');
    expect(fmt(23_486_210)).toBe('$23.49M');
    // Not an exact string: Node's ICU renders 1e6 as "$1.00M" and Chromium's
    // as "$1M", and only the browser's output is ever shown to anyone.
    // Asserting which *branch* was taken is the part that is ours to get right.
    expect(fmt(1e6)).toMatch(/^\$1(\.00)?M$/);
  });

  it('stays short at the sizes that broke the tooltip', () => {
    // 21M BTC — the supply cap, which the holdings store accepts — against a
    // five-figure price. Spelled out this is 27 characters and the tip was
    // guillotined by the SVG frame on a phone.
    expect(fmt(986_420_820_000)).toBe('$986.42B');
    expect(fmt(1_308_790_980_000)).toBe('$1.31T');
    expect(fmt(986_420_820_000).length).toBeLessThan(10);
  });

  it('applies to a lump-sum line too, which is where the real bug was', () => {
    // The claim that "only the held line can be large" was wrong: the budget
    // bounds what is *invested*, not what it grows to. $83,200 invested from
    // 2010 is $4.8bn of lump-sum wealth on the default form, with no holdings
    // entered at all.
    expect(fmt(4_839_398_898)).toBe('$4.84B');
  });

  it('treats a negative the same way, by magnitude', () => {
    // No line on these charts is negative today, but a `< COMPACT_ABOVE` test
    // would send -5e9 down the exact branch and reintroduce the overflow.
    expect(fmt(-4_839_398_898)).toBe('-$4.84B');
  });
});

describe('clipNote', () => {
  it('says nothing when the whole line is on screen', () => {
    expect(clipNote(0, 1097)).toBe('');
  });

  it('is exact about a line that is not drawn at all', () => {
    expect(clipNote(1097, 1097)).toBe(' (entirely off this scale)');
    expect(clipNote(1, 1)).toBe(' (entirely off this scale)');
  });

  it('warns once a real portion of the line is missing', () => {
    expect(clipNote(458, 1097)).toBe(' (runs off this scale)');
    expect(clipNote(12, 1097)).toBe(' (runs off this scale)');
  });

  it('stays quiet for the endpoint or two that almost always clip', () => {
    // Every line here is proportional to price, so a stack that is not exactly
    // the lump sum's own BTC clips somewhere. Warning on that meant warning
    // always, which says nothing. 10/1097 is the worst real case measured.
    expect(CLIP_NOTE_FRACTION).toBe(0.01);
    expect(clipNote(10, 1097)).toBe('');
    expect(clipNote(1, 1097)).toBe('');
    // Just over the line, and just under it.
    expect(clipNote(11, 1000)).toBe(' (runs off this scale)');
    expect(clipNote(10, 1000)).toBe('');
  });

  it('says nothing when there is no line', () => {
    expect(clipNote(0, 0)).toBe('');
  });
});
